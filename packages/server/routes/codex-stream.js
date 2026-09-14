/**
 * Codex Real-time Price Stream
 *
 * Server-side relay: maintains persistent WebSocket connections to Codex
 * Enterprise API (graphql-ws protocol), fans out price updates to browser
 * clients via Server-Sent Events (SSE).
 *
 * Architecture:
 *   Codex WS (wss://graph.codex.io/graphql)
 *     -> Express route manages subscriptions
 *     -> SSE fan-out to N browser EventSource connections
 *
 * Enterprise allows 300 WS connections, each supporting ~25 token subscriptions.
 * This module uses 1 connection with dynamic subscription management.
 */

const WebSocket = require('ws')
const { Router } = require('express')

const router = Router()

const CODEX_WS_URL = 'wss://graph.codex.io/graphql'
const CODEX_API_KEY = process.env.CODEX_API_KEY
// Codex key is origin-restricted; the WS handshake + REST fallback are
// server-to-server (no Origin -> rejected), so present the allowed origin.
const CODEX_ORIGIN = process.env.CODEX_ORIGIN || 'https://app.spectreai.io'
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000
const KEEPALIVE_MS = 25000 // graphql-ws expects pings within 30s

// State
let ws = null
let wsReady = false
let reconnectAttempts = 0
let reconnectTimer = null
let keepaliveTimer = null
let subIdCounter = 0

// Active subscriptions: subId -> { address, networkId, query }
const activeSubs = new Map()
// Token key -> subId mapping: "address:networkId" -> subId
const tokenToSubId = new Map()
// Token key -> latest price data
const latestPrices = new Map()
// A cached tick older than this is not replayed to a connecting client - the
// client's own poll is fresher than that (see the /stream connect block).
const PRICE_REPLAY_MAX_AGE_SEC = 120
// Connected SSE clients: Set of { res, tokens: Set<"address:networkId">, lastActivity: number }
const sseClients = new Set()

// ─── Zombie client reaper ──────────────────────────────────────────────────
// Sweep every 60s; close clients that haven't received a write in 90s.
const ZOMBIE_SWEEP_MS = 60000
const ZOMBIE_TIMEOUT_MS = 90000

setInterval(() => {
  const now = Date.now()
  let reaped = 0
  // Price SSE clients
  for (const client of sseClients) {
    if (now - (client.lastActivity || 0) > ZOMBIE_TIMEOUT_MS) {
      try { client.res.end() } catch {}
      sseClients.delete(client)
      reaped++
      // Unsubscribe orphaned tokens / pair feeds
      for (const key of client.tokens) {
        const v = client.via && client.via.get(key)
        if (v) { unsubscribeTrades(v.pairAddress, v.networkId); continue }
        const [address, networkId] = key.split(':')
        if (address && networkId) unsubscribeToken(address, parseInt(networkId))
      }
    }
  }
  // Bar SSE clients
  for (const client of barClients) {
    if (now - (client.lastActivity || 0) > ZOMBIE_TIMEOUT_MS) {
      try { client.res.end() } catch {}
      barClients.delete(client)
      reaped++
      unsubscribeBars(client.pairId, client.quoteToken || 'token1')
    }
  }
  // Trade SSE clients
  for (const client of tradeClients) {
    if (now - (client.lastActivity || 0) > ZOMBIE_TIMEOUT_MS) {
      try { client.res.end() } catch {}
      tradeClients.delete(client)
      reaped++
      const [addr, net] = client.tokenKey.split(':')
      if (addr && net) unsubscribeTrades(addr, parseInt(net))
    }
  }
  if (reaped > 0) console.log(`[codex-stream] Reaped ${reaped} zombie SSE client(s)`)
}, ZOMBIE_SWEEP_MS)

// ─── Subscription event counters (for Codex API monitoring) ─────────────────
const _subEventCounts = { onPricesUpdated: 0, onBarsUpdated: 0, onEventsCreated: 0, errors: 0 }
const _subEventCountsToday = { date: new Date().toISOString().slice(0, 10), onPricesUpdated: 0, onBarsUpdated: 0, onEventsCreated: 0, errors: 0 }

function _trackSubEvent(type) {
  _subEventCounts[type] = (_subEventCounts[type] || 0) + 1
  const today = new Date().toISOString().slice(0, 10)
  if (_subEventCountsToday.date !== today) {
    _subEventCountsToday.date = today
    _subEventCountsToday.onPricesUpdated = 0
    _subEventCountsToday.onBarsUpdated = 0
    _subEventCountsToday.onEventsCreated = 0
    _subEventCountsToday.errors = 0
  }
  _subEventCountsToday[type] = (_subEventCountsToday[type] || 0) + 1
  // Also feed into persistent daily metrics (injected from index.js)
  if (router._metricsTracker) router._metricsTracker(type)
}

// Per-pair delivery counters for the trade feed: Codex bills every message,
// and one hot pair can be 90+ a minute, so "which pair is costing us" has to
// be answerable in one curl. Minute buckets, kept for the last 60 minutes.
const _pairMinutes = new Map() // pairKey -> Map<minuteTs, msgs>
function _countPairMessage(pairKey) {
  const minute = Math.floor(Date.now() / 60000) * 60000
  let m = _pairMinutes.get(pairKey)
  if (!m) { m = new Map(); _pairMinutes.set(pairKey, m) }
  m.set(minute, (m.get(minute) || 0) + 1)
  if (m.size > 70) for (const k of m.keys()) { if (m.size <= 60) break; m.delete(k) }
}
function _pairRates() {
  const cutoff = Date.now() - 60 * 60000
  const out = []
  for (const [pairKey, m] of _pairMinutes) {
    let last1 = 0, last10 = 0, last60 = 0
    const now = Math.floor(Date.now() / 60000) * 60000
    for (const [minute, n] of m) {
      if (minute < cutoff) { m.delete(minute); continue }
      last60 += n
      if (minute >= now - 9 * 60000) last10 += n
      if (minute === now) last1 = n
    }
    if (m.size === 0) { _pairMinutes.delete(pairKey); continue }
    out.push({ pair: pairKey, lastMinute: last1, perMinute10: +(last10 / 10).toFixed(1), lastHour: last60, subscribed: tokenToTradeSubId.has(pairKey) })
  }
  return out.sort((a, b) => b.lastHour - a.lastHour)
}

/** Expose stream status for /api/codex/metrics endpoint */
router._getStreamStatus = function () {
  return {
    wsReady,
    priceSubscriptions: activeSubs.size,
    barSubscriptions: activeBarSubs.size,
    tradeSubscriptions: activeTradeSubs.size,
    sseClients: sseClients.size,
    barClients: barClients.size,
    tradeClients: tradeClients.size,
    cachedPrices: latestPrices.size,
    tokens: [...tokenToSubId.keys()],
    tradePairs: [...tokenToTradeSubId.keys()],
    eventCountsSession: { ..._subEventCounts },
    eventCountsToday: { ..._subEventCountsToday },
    pairRates: _pairRates(),
  }
}

// ─── graphql-ws protocol helpers ────────────────────────────────────────────

function connectCodexWs() {
  if (!CODEX_API_KEY) {
    console.warn('[codex-stream] CODEX_API_KEY not set - streaming disabled')
    return
  }

  try {
    ws = new WebSocket(CODEX_WS_URL, 'graphql-transport-ws', { origin: CODEX_ORIGIN })
  } catch (err) {
    console.error('[codex-stream] WS creation failed:', err.message)
    scheduleReconnect()
    return
  }

  ws.on('open', () => {
    // Step 1: connection_init with auth
    ws.send(JSON.stringify({
      type: 'connection_init',
      payload: { Authorization: CODEX_API_KEY },
    }))
  })

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }

    switch (msg.type) {
      case 'connection_ack':
        wsReady = true
        reconnectAttempts = 0
        console.log('[codex-stream] Connected to Codex WS')
        startKeepalive()
        // Re-subscribe any active tokens
        resubscribeAll()
        break

      case 'next': {
        const subId = msg.id

        // Price update from onPricesUpdated subscription
        const price = msg.payload?.data?.onPricesUpdated
        if (price) {
          _trackSubEvent('onPricesUpdated')
          const key = `${price.address}:${price.networkId}`
          latestPrices.set(key, {
            address: price.address,
            networkId: price.networkId,
            priceUsd: price.priceUsd,
            timestamp: price.timestamp,
          })
          broadcastPrice(key, latestPrices.get(key))
        }

        // Bar update from onBarsUpdated subscription. The quoteToken this
        // message is priced for comes from the subscription record (keyed by
        // msg.id) - a pair can be subscribed for BOTH token0 and token1, and
        // only clients that asked for this side must receive it (else a token1
        // token gets the token0 side's price = broken candles).
        const barUpdate = msg.payload?.data?.onBarsUpdated
        if (barUpdate) {
          _trackSubEvent('onBarsUpdated')
          const pairId = `${barUpdate.pairAddress}:${barUpdate.networkId}`
          const quoteToken = activeBarSubs.get(msg.id)?.quoteToken || 'token1'
          if (process.env.CODEX_STREAM_DEBUG === '1') {
            const matching = [...barClients].filter(c => c.pairId === pairId && (c.quoteToken || 'token1') === quoteToken).length
            console.log('[codex-stream][dbg] bar push id=%s pair=%s side=%s subRec=%s clients=%d', msg.id, pairId.slice(0, 12), quoteToken, JSON.stringify(activeBarSubs.get(msg.id) || null), matching)
          }
          broadcastBarUpdate(pairId, quoteToken, barUpdate)
        }

        // Trade events from onEventsCreated subscription
        const pairEvents = msg.payload?.data?.onEventsCreated
        if (pairEvents) {
          _trackSubEvent('onEventsCreated')
          const pairKey = normPairKey(pairEvents.address, pairEvents.networkId)
          _countPairMessage(pairKey)
          broadcastTradeEvents(pairKey, pairEvents.events)
          // The same batch is the PRICE feed for every token page that
          // registered its pair (`via=` on /stream) - see broadcastDerivedPrices.
          broadcastDerivedPrices(pairKey, pairEvents.events)
        }

        // Debug: log unhandled next messages
        if (!price && !barUpdate && !pairEvents && msg.payload?.data) {
          const keys = Object.keys(msg.payload.data)
          console.log('[codex-stream] Unhandled next message keys:', keys, 'subId:', msg.id)
        }
        break
      }

      case 'error':
        _trackSubEvent('errors')
        console.error('[codex-stream] Subscription error:', msg.id, msg.payload)
        break

      case 'complete':
        // Subscription ended server-side
        console.log('[codex-stream] Subscription completed:', msg.id)
        if (msg.id && activeSubs.has(msg.id)) {
          const sub = activeSubs.get(msg.id)
          const key = `${sub.address}:${sub.networkId}`
          activeSubs.delete(msg.id)
          tokenToSubId.delete(key)
        }
        if (msg.id && activeTradeSubs.has(msg.id)) {
          const sub = activeTradeSubs.get(msg.id)
          activeTradeSubs.delete(msg.id)
          tokenToTradeSubId.delete(sub.tokenKey)
          console.log('[codex-stream] Trade subscription completed:', sub.tokenKey)
        }
        break

      case 'ping':
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pong' }))
        }
        break

      case 'pong':
        // Response to our keepalive ping
        break
    }
  })

  ws.on('close', () => {
    wsReady = false
    stopKeepalive()
    console.warn('[codex-stream] WS closed - reconnecting')
    scheduleReconnect()
  })

  ws.on('error', (err) => {
    console.error('[codex-stream] WS error:', err.message)
    // close event will fire after error, triggering reconnect
  })
}

function scheduleReconnect() {
  if (reconnectTimer) return
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS)
  reconnectAttempts++
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectCodexWs()
  }, delay)
}

function startKeepalive() {
  stopKeepalive()
  keepaliveTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }))
    }
  }, KEEPALIVE_MS)
}

function stopKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer)
    keepaliveTimer = null
  }
}

// ─── Subscription management ────────────────────────────────────────────────

function subscribeToken(address, networkId) {
  const key = `${address}:${networkId}`
  if (tokenToSubId.has(key)) return // already subscribed

  const id = String(++subIdCounter)
  const payload = {
    type: 'subscribe',
    id,
    payload: {
      query: `subscription OnPricesUpdated($input: [OnPricesUpdatedInput!]!) {
        onPricesUpdated(input: $input) {
          address
          networkId
          priceUsd
          timestamp
        }
      }`,
      variables: {
        input: [{ address, networkId: parseInt(networkId) }],
      },
    },
  }

  activeSubs.set(id, { address, networkId: parseInt(networkId) })
  tokenToSubId.set(key, id)

  if (wsReady && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

function unsubscribeToken(address, networkId) {
  const key = `${address}:${networkId}`
  const subId = tokenToSubId.get(key)
  if (!subId) return

  // Only unsubscribe if no SSE client still needs onPricesUpdated for this
  // token. A client that registered a pair feed (`via`) for it is served from
  // onEventsCreated instead and does not count.
  let stillWatched = false
  for (const client of sseClients) {
    if (client.tokens.has(key) && !(client.via && client.via.has(key))) { stillWatched = true; break }
  }
  if (stillWatched) return

  if (wsReady && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'complete', id: subId }))
  }
  activeSubs.delete(subId)
  tokenToSubId.delete(key)
  latestPrices.delete(key)
}

function resubscribeAll() {
  // Runs on every Codex connection_ack (first connect AND every reconnect).
  // It used to reset subIdCounter to 0 and re-send ONLY the price subs - two
  // bugs in one: (a) bar + trade subscriptions registered before the ack (any
  // client that connected while the WS was still opening, e.g. right after a
  // restart) were never sent to Codex at all, and (b) the counter reset made
  // the re-issued price ids collide with the bar/trade records still keyed by
  // their old ids, so `activeBarSubs.get(msg.id)` resolved the wrong side and
  // the fan-out dropped every bar (measured 2026-09-11: Codex pushed 87 bars,
  // the SSE client received 0). Ids stay unique for the process lifetime and
  // EVERY subscription kind is re-issued from its client set.

  // Prices - rebuilt from what SSE clients are watching.
  const needed = new Set()
  for (const client of sseClients) {
    for (const key of client.tokens) needed.add(key)
  }
  activeSubs.clear()
  tokenToSubId.clear()
  for (const key of needed) {
    const [address, networkId] = key.split(':')
    subscribeToken(address, parseInt(networkId))
  }

  // Bars - one subscription per pair+side any bar client is watching.
  const barSides = new Map()
  for (const client of barClients) {
    if (client.pairId) barSides.set(`${client.pairId}|${client.quoteToken || 'token1'}`, { pairId: client.pairId, quoteToken: client.quoteToken || 'token1' })
  }
  activeBarSubs.clear()
  pairToBarSubId.clear()
  for (const { pairId, quoteToken } of barSides.values()) subscribeBars(pairId, quoteToken)

  // Trades - one subscription per pair any trade client is watching, plus
  // every pair a price client is served through (`via`).
  const tradePairs = new Set()
  for (const client of tradeClients) {
    if (client.tokenKey) tradePairs.add(client.tokenKey)
  }
  for (const client of sseClients) {
    if (client.via) for (const v of client.via.values()) tradePairs.add(v.pairKey)
  }
  activeTradeSubs.clear()
  tokenToTradeSubId.clear()
  for (const key of tradePairs) {
    const i = key.lastIndexOf(':')
    subscribeTrades(key.slice(0, i), parseInt(key.slice(i + 1)))
  }
}

// ─── SSE fan-out ────────────────────────────────────────────────────────────

function broadcastPrice(tokenKey, data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) {
    if (client.tokens.has(tokenKey)) {
      try { client.res.write(payload); client.lastActivity = Date.now() } catch { /* client disconnected */ }
    }
  }
}

// ─── Pair feed: ONE Codex subscription per pair serves prices too ───────────
// A token page used to hold three Codex subscriptions on its pair - prices
// (onPricesUpdated), bars (onBarsUpdated) and trades (onEventsCreated) - and
// Codex bills every delivered message. All three describe the same swap. So a
// /stream client may register the token's pair + side (`via=`), and its price
// ticks are then DERIVED from the pair's onEventsCreated batch: the side's
// per-swap USD price (`tokenXSwapValueUsd`, verified side-exact 2026-09-11:
// EMBER/SOL token0 = $0.0279, token1 = $101) plus the swap's USD size, so the
// chart's forming candle can accumulate real volume. One billed message per
// swap batch instead of three, and the tick is per trade, not per block.

// Pair key: EVM addresses fold case, Solana base58 does not.
function normPairAddr(a) {
  const s = String(a || '')
  return s.startsWith('0x') ? s.toLowerCase() : s
}
function normPairKey(pairAddress, networkId) {
  return `${normPairAddr(pairAddress)}:${parseInt(networkId)}`
}

// Native (quote-side) decimals by network - the quote side's raw amount is
// what sizes the trade in USD.
const NATIVE_DECIMALS = { 1399811149: 9, 1: 18, 56: 18, 137: 18, 42161: 18, 8453: 18, 4663: 18 }

// USD size of one swap event. Codex sizes it for us: SwapEventData.priceUsdTotal
// is the USD value of the non-liquidity side with decimals already applied.
// The raw-amount estimate below is the FALLBACK only - it assumes the quote is
// the chain's native token (9 decimals on Solana), which is wrong for every
// stable/token-quoted pool. Measured 2026-09-11 on TOKABU/DKNG (Raydium CPMM,
// DKNG = 6 decimals): a $101 buy left here as $0.10, every trade 1000x small,
// and the tape's sub-cent dust gate dropped the whole live feed - prod tape
// "stuck" while the REST poll had backed off to its live cadence.
function tradeUsdOf(e, networkId) {
  const total = parseFloat(e.data?.priceUsdTotal)
  if (Number.isFinite(total) && total > 0) return total
  const t0Usd = parseFloat(e.token0SwapValueUsd) || 0
  const t1Usd = parseFloat(e.token1SwapValueUsd) || 0
  const swapData = e.data || {}
  const rawA0 = Math.abs(parseFloat(swapData.amount0) || 0) || (Math.abs(parseFloat(swapData.amount0In) || 0) + Math.abs(parseFloat(swapData.amount0Out) || 0))
  const rawA1 = Math.abs(parseFloat(swapData.amount1) || 0) || (Math.abs(parseFloat(swapData.amount1In) || 0) + Math.abs(parseFloat(swapData.amount1Out) || 0))
  const decimals = NATIVE_DECIMALS[parseInt(networkId)] || 18
  let amountUSD = Math.max(t0Usd, t1Usd)
  if (rawA0 > 0 && rawA1 > 0) {
    amountUSD = t1Usd > t0Usd
      ? (rawA1 / Math.pow(10, decimals)) * t1Usd
      : (rawA0 / Math.pow(10, decimals)) * t0Usd
  }
  return amountUSD
}

// Does any /stream client take this pair's feed as a price source?
function pairFeedHasPriceClients(pairKey) {
  for (const client of sseClients) {
    if (!client.via) continue
    for (const v of client.via.values()) if (v.pairKey === pairKey) return true
  }
  return false
}

function broadcastDerivedPrices(pairKey, events) {
  if (!events?.length || !pairFeedHasPriceClients(pairKey)) return
  const networkId = parseInt(pairKey.slice(pairKey.lastIndexOf(':') + 1))
  for (const e of events) {
    if (e.eventDisplayType !== 'Buy' && e.eventDisplayType !== 'Sell') continue
    const p0 = parseFloat(e.token0SwapValueUsd) || 0
    const p1 = parseFloat(e.token1SwapValueUsd) || 0
    const tradeUsd = tradeUsdOf(e, networkId)
    for (const client of sseClients) {
      if (!client.via) continue
      for (const [tokenKey, v] of client.via) {
        if (v.pairKey !== pairKey) continue
        const priceUsd = v.side === 'token0' ? p0 : p1
        if (!(priceUsd > 0)) continue
        const tick = {
          address: tokenKey.slice(0, tokenKey.lastIndexOf(':')),
          networkId,
          priceUsd: String(priceUsd),
          timestamp: e.timestamp,
          // Extra vs onPricesUpdated: the swap's size + side, so the chart's
          // forming candle accumulates real volume.
          tradeUsd,
          side: e.eventDisplayType,
          derived: true,
        }
        latestPrices.set(tokenKey, tick)
        try { client.res.write(`data: ${JSON.stringify(tick)}\n\n`); client.lastActivity = Date.now() } catch { /* client disconnected */ }
      }
    }
  }
}

// Resolution map: client resolution string -> Codex aggregates key
const RES_MAP = { '1': 'r1', '5': 'r5', '15': 'r15', '60': 'r60', '240': 'r240', '1D': 'r1D', 'D': 'r1D' }

function broadcastBarUpdate(pairId, quoteToken, barUpdate) {
  for (const client of barClients) {
    if (client.pairId !== pairId) continue
    if ((client.quoteToken || 'token1') !== quoteToken) continue
    const resKey = RES_MAP[client.resolution] || 'r60'
    const agg = barUpdate.aggregates?.[resKey]?.usd
    if (!agg) continue
    const bar = {
      time: barUpdate.timestamp,
      open: parseFloat(agg.o) || 0,
      high: parseFloat(agg.h) || 0,
      low: parseFloat(agg.l) || 0,
      close: parseFloat(agg.c) || 0,
      volume: parseFloat(agg.volume) || 0,
    }
    try { client.res.write(`data: ${JSON.stringify(bar)}\n\n`); client.lastActivity = Date.now() } catch {}
  }
}

// ─── SSE endpoint ───────────────────────────────────────────────────────────

/**
 * GET /api/codex/stream?tokens=addr1:net1,addr2:net2
 *
 * Opens an SSE connection. Sends real-time price updates for requested tokens.
 * Client can update watched tokens by reconnecting with different params.
 *
 * Events:
 *   data: { address, networkId, priceUsd, timestamp }
 *   event: connected  (initial connection confirmation)
 */
router.get('/stream', (req, res) => {
  const tokensParam = req.query.tokens || ''
  const tokenKeys = tokensParam.split(',').filter(Boolean)

  if (tokenKeys.length === 0) {
    return res.status(400).json({ error: 'tokens query required (format: address:networkId,address:networkId)' })
  }

  // SSE headers (CORS for dev: browser connects directly to Express, bypassing Vite proxy)
  const origin = req.headers.origin
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...(origin && { 'Access-Control-Allow-Origin': origin }),
  })

  // `via=<tokenKey>@<pairAddress>:<side>[,...]` - tokens served from their
  // pair's onEventsCreated feed instead of onPricesUpdated (see the pair-feed
  // note above). Malformed entries are ignored (that token stays on prices).
  const via = new Map()
  for (const entry of String(req.query.via || '').split(',').filter(Boolean)) {
    const at = entry.indexOf('@')
    if (at <= 0) continue
    const tokenKey = entry.slice(0, at)
    const rest = entry.slice(at + 1)
    const colon = rest.lastIndexOf(':')
    if (colon <= 0) continue
    const pairAddress = normPairAddr(rest.slice(0, colon))
    const side = rest.slice(colon + 1) === 'token0' ? 'token0' : 'token1'
    const networkId = parseInt(tokenKey.slice(tokenKey.lastIndexOf(':') + 1))
    if (!pairAddress || !networkId || !tokenKeys.includes(tokenKey)) continue
    via.set(tokenKey, { pairAddress, networkId, side, pairKey: `${pairAddress}:${networkId}` })
  }

  // Register client
  const client = { res, tokens: new Set(tokenKeys), via: via.size ? via : null, lastActivity: Date.now() }
  sseClients.add(client)

  // Subscribe: pair feed for `via` tokens, onPricesUpdated for the rest
  for (const key of tokenKeys) {
    const v = via.get(key)
    if (v) { subscribeTrades(v.pairAddress, v.networkId); continue }
    const [address, networkId] = key.split(':')
    if (address && networkId) {
      subscribeToken(address, parseInt(networkId))
    }
  }

  // Send connected event + any cached prices that are still CURRENT.
  //
  // The cache is the last tick seen for a token, and on a quiet pair that can
  // be hours old: REVINU's cache held a $15 launch buy at 0.000198 (MCap
  // $198K) twelve hours after the token had settled at 0.000014 ($14K), and
  // every fresh connection got it replayed as if it were live - header,
  // MCap tile and the chart's forming candle all jumped 14x until the next
  // real trade. A replay is only a head start over the poll, so it is worth
  // sending only while it is younger than the poll it would be replacing.
  res.write(`event: connected\ndata: ${JSON.stringify({ subscribed: tokenKeys.length, wsReady })}\n\n`)

  const nowSec = Math.floor(Date.now() / 1000)
  for (const key of tokenKeys) {
    const cached = latestPrices.get(key)
    if (!cached) continue
    const ageSec = nowSec - (Number(cached.timestamp) || 0)
    if (ageSec > PRICE_REPLAY_MAX_AGE_SEC) { latestPrices.delete(key); continue }
    res.write(`data: ${JSON.stringify(cached)}\n\n`)
  }

  // Keepalive comment every 15s to prevent proxy timeouts
  const sseKeepAlive = setInterval(() => {
    try { res.write(': keepalive\n\n'); client.lastActivity = Date.now() } catch { /* disconnected */ }
  }, 15000)

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(sseKeepAlive)
    sseClients.delete(client)

    // Unsubscribe tokens / pair feeds no longer watched by any client
    for (const key of tokenKeys) {
      const v = via.get(key)
      if (v) { unsubscribeTrades(v.pairAddress, v.networkId); continue }
      const [address, networkId] = key.split(':')
      if (address && networkId) {
        unsubscribeToken(address, parseInt(networkId))
      }
    }
  })
})

// ─── Bars (OHLCV) streaming ─────────────────────────────────────────────────

// Active bar subscriptions: barSubId -> { pairId, resolution }
const activeBarSubs = new Map()
// pairId -> barSubId
const pairToBarSubId = new Map()
// SSE clients for bars: Set of { res, pairId, resolution }
const barClients = new Set()

function subscribeBars(pairId, quoteToken = 'token1') {
  // Key by pairId+quoteToken so token0 and token1 sides of the same pair can
  // coexist (different charts may want different sides).
  const subKey = `${pairId}|${quoteToken}`
  if (pairToBarSubId.has(subKey)) return

  const id = String(++subIdCounter)
  const payload = {
    type: 'subscribe',
    id,
    payload: {
      query: `subscription OnBarsUpdated($pairId: String!, $quoteToken: QuoteToken) {
        onBarsUpdated(pairId: $pairId, quoteToken: $quoteToken) {
          pairAddress
          networkId
          timestamp
          aggregates {
            r1 { usd { o h l c volume } }
            r5 { usd { o h l c volume } }
            r15 { usd { o h l c volume } }
            r60 { usd { o h l c volume } }
            r240 { usd { o h l c volume } }
            r1D { usd { o h l c volume } }
          }
        }
      }`,
      variables: { pairId, quoteToken },
    },
  }

  activeBarSubs.set(id, { pairId, quoteToken })
  pairToBarSubId.set(subKey, id)

  if (wsReady && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

function unsubscribeBars(pairId, quoteToken = 'token1') {
  const subKey = `${pairId}|${quoteToken}`
  const subId = pairToBarSubId.get(subKey)
  if (!subId) return

  // Only unsubscribe if no client is watching this pair+side
  let stillWatched = false
  for (const client of barClients) {
    if (client.pairId === pairId && (client.quoteToken || 'token1') === quoteToken) { stillWatched = true; break }
  }
  if (stillWatched) return

  if (wsReady && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'complete', id: subId }))
  }
  activeBarSubs.delete(subId)
  pairToBarSubId.delete(subKey)
}

/**
 * GET /api/codex/bars-stream?pairId=addr:netId&resolution=60&quoteToken=token1
 *
 * SSE stream for real-time OHLCV candle updates.
 * Resolution: 1, 5, 15, 60, 240, 1D
 * quoteToken: token0 | token1 (which side of the pair the target token is the
 * QUOTE for; the client auto-detects the correct side and re-requests if the
 * default produced the wrong price scale).
 */
router.get('/bars-stream', (req, res) => {
  const { pairId, resolution = '60' } = req.query
  const quoteToken = req.query.quoteToken === 'token0' ? 'token0' : 'token1'
  if (!pairId) {
    return res.status(400).json({ error: 'pairId required (format: pairAddress:networkId)' })
  }

  const origin = req.headers.origin
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...(origin && { 'Access-Control-Allow-Origin': origin }),
  })

  const client = { res, pairId, resolution, quoteToken, lastActivity: Date.now() }
  barClients.add(client)

  subscribeBars(pairId, quoteToken)

  res.write(`event: connected\ndata: ${JSON.stringify({ pairId, resolution, quoteToken, wsReady })}\n\n`)

  // The keepalive is a WRITE the socket accepted - it must stamp lastActivity
  // (the price stream does), or the zombie reaper closes every client whose
  // pair is quiet for 90s and the browser reconnects in a loop.
  const keepAlive = setInterval(() => {
    try { res.write(': keepalive\n\n'); client.lastActivity = Date.now() } catch {}
  }, 15000)

  req.on('close', () => {
    clearInterval(keepAlive)
    barClients.delete(client)
    unsubscribeBars(pairId, quoteToken)
  })
})

// ─── Trades (onTokenEventsCreated) streaming ────────────────────────────────

// Active trade subscriptions: tradeSubId -> { tokenKey }
const activeTradeSubs = new Map()
// tokenKey -> tradeSubId
const tokenToTradeSubId = new Map()
// SSE clients for trades: Set of { res, tokenKey }
const tradeClients = new Set()

function subscribeTrades(pairAddress, networkId) {
  const key = normPairKey(pairAddress, networkId)
  if (tokenToTradeSubId.has(key)) return

  const subId = String(++subIdCounter)
  const pairId = key
  const payload = {
    type: 'subscribe',
    id: subId,
    payload: {
      query: `subscription OnEventsCreated($pairId: String!) {
        onEventsCreated(id: $pairId) {
          address
          networkId
          events {
            eventType
            eventDisplayType
            timestamp
            transactionHash
            token0SwapValueUsd
            token1SwapValueUsd
            data {
              ... on SwapEventData {
                priceUsdTotal
                amount0
                amount0In
                amount0Out
                amount1
                amount1In
                amount1Out
              }
            }
            maker
            tradeSource { id displayName }
          }
        }
      }`,
      variables: { pairId },
    },
  }

  console.log('[codex-stream] Subscribing trades for pair:', pairId, 'subId:', subId, 'wsReady:', wsReady)
  activeTradeSubs.set(subId, { tokenKey: key })
  tokenToTradeSubId.set(key, subId)

  if (wsReady && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

function unsubscribeTrades(address, networkId) {
  const key = normPairKey(address, networkId)
  const subId = tokenToTradeSubId.get(key)
  if (!subId) return

  // The pair feed stays up while a tape client OR a price client served via
  // this pair still needs it.
  let stillWatched = false
  for (const client of tradeClients) {
    if (client.tokenKey === key) { stillWatched = true; break }
  }
  if (!stillWatched && pairFeedHasPriceClients(key)) stillWatched = true
  if (stillWatched) return

  if (wsReady && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'complete', id: subId }))
  }
  activeTradeSubs.delete(subId)
  tokenToTradeSubId.delete(key)
}

function broadcastTradeEvents(pairKey, events) {
  if (!events?.length) return
  const networkId = parseInt(pairKey.slice(pairKey.lastIndexOf(':') + 1))
  const trades = events
    .filter(e => e.eventDisplayType === 'Buy' || e.eventDisplayType === 'Sell')
    .map(e => {
      // Trade USD = quote-side raw amount x quote price (see tradeUsdOf).
      const amountUSD = tradeUsdOf(e, networkId)
      return {
        type: e.eventDisplayType,
        timestamp: e.timestamp,
        txHash: e.transactionHash,
        amountUSD,
        maker: e.maker,
        // Same shape the polled /api/token/trades rows carry (see the
        // normalizeTradeSource helper in index.js): the app the swap was
        // placed through, or null when Codex has no identifying signal.
        source: e.tradeSource?.id
          ? { id: String(e.tradeSource.id), name: e.tradeSource.displayName ? String(e.tradeSource.displayName) : String(e.tradeSource.id) }
          : null,
      }
    })
  if (!trades.length) return

  const payload = `data: ${JSON.stringify({ trades })}\n\n`
  for (const client of tradeClients) {
    if (client.tokenKey === pairKey) {
      try { client.res.write(payload); client.lastActivity = Date.now() } catch {}
    }
  }
}

/**
 * GET /api/codex/trades-stream?pairAddress=...&networkId=...
 *
 * SSE stream for real-time trade events (buys/sells) on a pair.
 * Uses Codex onEventsCreated subscription.
 */
router.get('/trades-stream', (req, res) => {
  const { pairAddress, networkId } = req.query
  if (!pairAddress || !networkId) {
    return res.status(400).json({ error: 'pairAddress and networkId required' })
  }

  const tokenKey = normPairKey(pairAddress, networkId)
  const origin = req.headers.origin

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...(origin && { 'Access-Control-Allow-Origin': origin }),
  })

  const client = { res, tokenKey, lastActivity: Date.now() }
  tradeClients.add(client)

  subscribeTrades(pairAddress, parseInt(networkId))

  res.write(`event: connected\ndata: ${JSON.stringify({ pairAddress, wsReady })}\n\n`)

  // Stamp lastActivity on the keepalive (see /bars-stream): measured on the
  // dev server 2026-09-11, a quiet pair's tape client was reaped every 90s
  // and reconnected 3x in one second - the whole /trades-stream churn seen in
  // the network log.
  const keepAlive = setInterval(() => {
    try { res.write(': keepalive\n\n'); client.lastActivity = Date.now() } catch {}
  }, 15000)

  req.on('close', () => {
    clearInterval(keepAlive)
    tradeClients.delete(client)
    unsubscribeTrades(pairAddress, parseInt(networkId))
  })
})

/**
 * GET /api/codex/stream/status
 * Returns current stream state for debugging.
 */
router.get('/stream/status', (_req, res) => {
  res.json({
    wsReady,
    activeSubscriptions: activeSubs.size + activeBarSubs.size + activeTradeSubs.size,
    connectedClients: sseClients.size,
    barClients: barClients.size,
    tradeClients: tradeClients.size,
    cachedPrices: latestPrices.size,
    tokens: [...tokenToSubId.keys()],
    pairs: [...pairToBarSubId.keys()],
    tradeStreams: [...tokenToTradeSubId.keys()],
    derivedPriceTokens: [...new Set([...sseClients].flatMap(c => c.via ? [...c.via.keys()] : []))],
  })
})

// ─── Screener (filterTokens with advanced filters) ──────────────────────────

// ─── GeckoTerminal token info (About column on GT-only chains) ──────────────
// The client used to hit api.geckoterminal.com directly for per-token
// description/socials, but the free tier is 30 req/min PER IP and the board's
// own pools calls already spend most of it - measured 2026-08-18, only ~2 of
// 27 Robinhood rows resolved before 429, while the SAME tokens through the
// CoinGecko Pro onchain mirror (500/min) returned 9-of-12 with real metadata
// and zero 404s. So the server proxies with the pro key. 24h per-address
// cache - token profiles are near-static. Keep in sync with the prod twin
// (apps/trading/api/codex.js case 'gt-token-info').
const GT_INFO_TTL = 24 * 60 * 60 * 1000
const _gtInfoCache = new Map() // `${slug}:${addrLower}` -> { v, ts }
const _GT_SLUG_RE = /^[a-z0-9_-]{1,30}$/
const _GT_ADDR_RE = /^0x[a-fA-F0-9]{40}$/

// DexScreener latest-profiles ACCUMULATOR - the description fallback.
// DS descriptions live in their paid CMS profile, server-rendered into the
// site HTML with NO per-token API (probed 2026-08-18: every per-token profile
// path 404s, and the site itself is Cloudflare-challenged for server egress).
// The ONE public window is `token-profiles/latest/v1`: the ~30 newest profiles
// globally, each with description + links. On a young chain that is exactly
// the fresh tokens users ask about (13 of 30 were Robinhood when measured).
// So: refetch it at most every 5min and ACCUMULATE entries across the server's
// uptime - coverage grows monotonically while the process lives. Old profiles
// (e.g. CASHCAT, profiled 2 months ago) can never be recovered through this
// window; those stay dash-honest.
const _dsProfiles = new Map() // `${chain}:${addrLower}` -> { description, website, twitter, telegram }
let _dsProfilesOkTs = 0
let _dsProfilesFailTs = 0
async function refreshDsProfiles() {
  // Success holds for 5min; a FAILURE only for 60s - stamping the long window
  // on a 429 (which is how this was first written) blanked the merge for five
  // minutes after every cold start that landed during a rate-limit spell.
  if (Date.now() - _dsProfilesOkTs < 5 * 60 * 1000) return
  if (Date.now() - _dsProfilesFailTs < 60 * 1000) return
  try {
    const r = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) { _dsProfilesFailTs = Date.now(); return }
    _dsProfilesOkTs = Date.now()
    const arr = await r.json()
    for (const p of Array.isArray(arr) ? arr : []) {
      if (!p || !p.chainId || !p.tokenAddress) continue
      const links = Array.isArray(p.links) ? p.links : []
      const byType = (t) => (links.find((l) => l && l.type === t) || {}).url || null
      const website = (links.find((l) => l && !l.type && l.url) || {}).url ||
        (links.find((l) => l && String(l.label || '').toLowerCase().includes('website')) || {}).url || null
      _dsProfiles.set(`${p.chainId}:${String(p.tokenAddress).toLowerCase()}`, {
        description: (p.description || '').trim() || null,
        website,
        twitter: byType('twitter'),
        telegram: byType('telegram'),
      })
    }
    if (_dsProfiles.size > 3000) {
      _dsProfiles.delete(_dsProfiles.keys().next().value)
    }
  } catch { _dsProfilesFailTs = Date.now() /* best-effort - GT remains the primary */ }
}

async function fetchGtInfoUpstream(slug, addr) {
  const cgKey = process.env.COINGECKO_API_KEY
  const url = cgKey
    ? `https://pro-api.coingecko.com/api/v3/onchain/networks/${slug}/tokens/${addr}/info`
    : `https://api.geckoterminal.com/api/v2/networks/${slug}/tokens/${addr}/info`
  const r = await fetch(url, {
    headers: cgKey ? { 'x-cg-pro-api-key': cgKey, accept: 'application/json' } : { accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!r.ok) return null
  const a = (await r.json())?.data?.attributes || {}
  const out = {
    description: (a.description || '').trim() || null,
    website: Array.isArray(a.websites) && a.websites[0] ? a.websites[0] : null,
    twitter: a.twitter_handle ? `https://x.com/${a.twitter_handle}` : null,
    telegram: a.telegram_handle ? `https://t.me/${a.telegram_handle}` : null,
  }
  // CoinGecko-listing fallthrough: GT's /info does NOT forward the CG coin
  // description, so a CG-listed token (info carries coingecko_coin_id) gets a
  // second read from /coins/{id}. Full-source audit 2026-08-18 for the record:
  // of 23 description-less Robinhood board tokens, 12 were CG-listed and ALL
  // 12 had left their CG description blank too - the chain's teams write prose
  // only into DexScreener's paid CMS profile, which has no API and 403s server
  // egress (TLS fingerprint, browser UA insufficient - measured). So this arm
  // yields nothing TODAY on that chain; it exists because it completes every
  // legitimate source and picks up tokens the moment their teams fill in the
  // CG page. Cached with the entry (24h) - at most one extra CG call per
  // description-less listed token per day.
  if (!out.description && cgKey && a.coingecko_coin_id) {
    try {
      const rc = await fetch(
        `https://pro-api.coingecko.com/api/v3/coins/${encodeURIComponent(a.coingecko_coin_id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`,
        { headers: { 'x-cg-pro-api-key': cgKey, accept: 'application/json' }, signal: AbortSignal.timeout(8000) }
      )
      if (rc.ok) {
        const j = await rc.json()
        out.description = ((j.description && j.description.en) || '').trim() || null
        const links = j.links || {}
        if (!out.website && Array.isArray(links.homepage) && links.homepage[0]) out.website = links.homepage[0]
        if (!out.twitter && links.twitter_screen_name) out.twitter = `https://x.com/${links.twitter_screen_name}`
        if (!out.telegram && links.telegram_channel_identifier) out.telegram = `https://t.me/${links.telegram_channel_identifier}`
      }
    } catch { /* best-effort */ }
  }
  return out
}

// Codex token-metadata batch for a GT-only chain. IMPORTANT correction
// (2026-09-01): "Codex has no coverage of networkId 4663" is true ONLY for
// market screening (filterTokens by network returns empty) - token METADATA is
// indexed. Measured on the live Robinhood board: Codex carries descriptions
// for 9 of 37 tokens (incl. ARROW/CLAN/DELTA/BONER/HOOKR, which GT lacks) and
// socials for 27. One filterTokens(tokens:[...]) call covers the whole batch,
// so the metered cost is a single Codex query per cold board per 24h cache.
async function fetchCodexInfoBatch(networkId, addrs) {
  const out = new Map()
  const CODEX_KEY = process.env.CODEX_API_KEY
  if (!CODEX_KEY || !Number.isInteger(networkId) || networkId <= 0 || !addrs.length) return out
  try {
    const ids = addrs.map((a) => `"${a}:${networkId}"`).join(',')
    const q = `query{filterTokens(tokens:[${ids}] limit:${addrs.length}){results{token{address info{description} socialLinks{twitter telegram website}}}}}`
    const r = await fetch('https://graph.codex.io/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: CODEX_KEY, Origin: CODEX_ORIGIN },
      body: JSON.stringify({ query: q }),
      signal: AbortSignal.timeout(10000),
    })
    const j = await r.json()
    for (const x of j?.data?.filterTokens?.results || []) {
      const t = x.token || {}
      const addr = String(t.address || '').toLowerCase()
      if (!addr) continue
      out.set(addr, {
        description: ((t.info && t.info.description) || '').trim() || null,
        website: (t.socialLinks && t.socialLinks.website) || null,
        twitter: (t.socialLinks && t.socialLinks.twitter) || null,
        telegram: (t.socialLinks && t.socialLinks.telegram) || null,
      })
    }
  } catch { /* best-effort - GT/DS/CG legs still run */ }
  return out
}

router.get('/', async (req, res) => {
  if (req.query.action === 'gt-token-info') {
    try {
      const slug = String(req.query.network || '')
      if (!_GT_SLUG_RE.test(slug)) return res.status(400).json({ error: 'Invalid network' })
      const netId = parseInt(req.query.networkId)
      const addrs = String(req.query.addresses || '')
        .split(',').map((a) => a.trim().toLowerCase()).filter((a) => _GT_ADDR_RE.test(a)).slice(0, 40)
      const infos = {}
      const todo = []
      for (const addr of addrs) {
        const key = `${slug}:${addr}`
        const hit = _gtInfoCache.get(key)
        if (hit && Date.now() - hit.ts < GT_INFO_TTL) {
          if (hit.v) infos[addr] = hit.v
        } else {
          todo.push({ addr, key })
        }
      }
      // All sources in parallel; merged field-by-field below. Codex first (our
      // own API, best measured coverage), GT fills, DS/CG fill after that.
      const gtMap = new Map()
      const gtFailed = new Set()
      let i = 0
      const worker = async () => {
        while (i < todo.length) {
          const { addr } = todo[i++]
          try {
            const v = await fetchGtInfoUpstream(slug, addr)
            if (v) gtMap.set(addr, v)
          } catch { gtFailed.add(addr) /* transient - retried next call */ }
        }
      }
      const [codexMap] = await Promise.all([
        fetchCodexInfoBatch(Number.isInteger(netId) ? netId : 0, todo.map((t) => t.addr)),
        worker(), worker(), worker(), worker(),
        refreshDsProfiles(),
      ])
      const pickField = (f, ...srcs) => { for (const s of srcs) { if (s && s[f]) return s[f] } return null }
      for (const { addr, key } of todo) {
        const cx = codexMap.get(addr)
        const gt = gtMap.get(addr)
        const merged = {
          description: pickField('description', cx, gt),
          website: pickField('website', cx, gt),
          twitter: pickField('twitter', cx, gt),
          telegram: pickField('telegram', cx, gt),
        }
        const v = (merged.description || merged.website || merged.twitter || merged.telegram) ? merged : null
        // A transient GT failure with nothing from Codex must NOT pin a 24h
        // null - leave it uncached so the next board visit retries.
        if (v || !gtFailed.has(addr)) _gtInfoCache.set(key, { v, ts: Date.now() })
        if (v) infos[addr] = v
      }
      // DS profile fallback: fill only what GT left null. DS chain slugs match
      // the GT slugs we use ('robinhood'), so the key aligns.
      for (const addr of addrs) {
        const ds = _dsProfiles.get(`${slug}:${addr}`)
        if (!ds) continue
        const cur = infos[addr] || {}
        const merged = {
          description: cur.description || ds.description,
          website: cur.website || ds.website,
          twitter: cur.twitter || ds.twitter,
          telegram: cur.telegram || ds.telegram,
        }
        if (merged.description || merged.website || merged.twitter || merged.telegram) infos[addr] = merged
      }
      if (_gtInfoCache.size > 2000) {
        _gtInfoCache.delete(_gtInfoCache.keys().next().value)
      }
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200')
      return res.json({ infos })
    } catch (err) {
      return res.status(200).json({ infos: {}, error: err.message })
    }
  }
  if (req.query.action !== 'screener') return res.status(404).json({ error: 'Unknown action' })

  try {
    const { filters: filtersJson, sort, sortDir, networks, limit } = req.query
    const filters = filtersJson ? JSON.parse(filtersJson) : {}
    const networkIds = networks ? networks.split(',').map(n => parseInt(n)).filter(n => !isNaN(n)) : [1, 56, 1399811149, 42161, 8453]
    const effectiveLimit = Math.min(parseInt(limit) || 50, 100)

    const tokenFilters = { network: networkIds }
    const numberFilterMap = {
      marketCap: 'marketCap', liquidity: 'liquidity', volume24h: 'volume24',
      holders: 'holders', priceUsd: 'priceUSD',
      change5m: 'change5m', change1h: 'change1', change4h: 'change4',
      change12h: 'change12', change24h: 'change24',
      txnCount24h: 'txnCount24', buyCount24h: 'buyCount24', sellCount24h: 'sellCount24',
    }

    for (const [key, codexField] of Object.entries(numberFilterMap)) {
      if (filters[key]) {
        const f = {}
        if (filters[key].gte !== undefined) f.gte = parseFloat(filters[key].gte)
        if (filters[key].lte !== undefined) f.lte = parseFloat(filters[key].lte)
        if (Object.keys(f).length > 0) tokenFilters[codexField] = f
      }
    }

    const query = `
      query ScreenTokens($filters: TokenFilters, $limit: Int, $rankings: [TokenRanking]) {
        filterTokens(filters: $filters, limit: $limit, rankings: $rankings) {
          results {
            token {
              address symbol name networkId
              info { imageThumbUrl description }
              socialLinks { twitter telegram website }
            }
            priceUSD volume24 liquidity marketCap holders
            change5m change1 change4 change12 change24
            txnCount24 createdAt
          }
        }
      }
    `

    const response = await fetch('https://graph.codex.io/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': CODEX_API_KEY, 'Origin': CODEX_ORIGIN },
      body: JSON.stringify({
        query,
        variables: {
          filters: tokenFilters,
          limit: effectiveLimit,
          rankings: [{ attribute: sort || 'volume24', direction: sortDir === 'ASC' ? 'ASC' : 'DESC' }],
        },
      }),
    })

    const data = await response.json()
    if (data.errors) throw new Error(data.errors[0]?.message || 'GraphQL error')

    // Excluded symbols - stablecoins, wrapped assets, LSTs, bridge tokens
    const EXCLUDED = new Set([
      // Stablecoins
      'USDT','USDC','DAI','BUSD','TUSD','USDP','GUSD','FRAX','LUSD','USDD','PYUSD','EURC',
      'EURS','USDE','SUSDS','CUSD','XAUT','CRVUSD','USDTB','USD1','USDT0','REUSD','SUSD','USDS',
      'FDUSD','USDX','GHO','DOLA','MIM','MAI','CEUR','ALUSD',
      // Wrapped natives (on any chain)
      'WETH','WBTC','WBNB','WMATIC','WAVAX','WSOL','WFTM','WCRO',
      // LSTs and liquid staking
      'CBBTC','CBETH','STETH','WSTETH','RETH','SFRXETH','METH','EZETH','RSETH','WEETH','TBTC',
      'MSETH','SWETH','OETH','ANKRETH','FRXETH','LSETH','BETH',
      // Bridge tokens
      'BTCB','JLP',
    ])

    const SPAM_PATTERNS = [
      'pool prime','boost','rush','swap','node','instruct','superform',
      'indexer','gravit','velocity','sidechain','modular','wrapped e',
      'wrapped s','wrapped b','usd stablecoin','usd coin',
    ]

    const raw = (data.data?.filterTokens?.results || [])
    const results = raw
      .map(r => ({
        address: r.token?.address || '',
        symbol: (r.token?.symbol || '').toUpperCase(),
        name: r.token?.name || '',
        networkId: r.token?.networkId || 1,
        logo: r.token?.info?.imageThumbUrl || null,
        // Feeds the trending board's About column (replaced AI Read 2026-08-17).
        // Same-request Codex metadata - selecting these fields costs nothing extra.
        description: r.token?.info?.description || null,
        twitter: r.token?.socialLinks?.twitter || null,
        telegram: r.token?.socialLinks?.telegram || null,
        website: r.token?.socialLinks?.website || null,
        price: parseFloat(r.priceUSD) || 0,
        volume24h: parseFloat(r.volume24) || 0,
        liquidity: parseFloat(r.liquidity) || 0,
        marketCap: parseFloat(r.marketCap) || 0,
        holders: parseInt(r.holders) || 0,
        change5m: parseFloat(r.change5m) || 0,
        change1h: parseFloat(r.change1) || 0,
        change4h: parseFloat(r.change4) || 0,
        change24h: parseFloat(r.change24) || 0,
        txnCount24h: parseInt(r.txnCount24) || 0,
        createdAt: r.createdAt ? Number(r.createdAt) : null,
      }))
      .filter(t => {
        // Exclude stablecoins, wrapped, LSTs
        if (EXCLUDED.has(t.symbol)) return false
        // Exclude native assets on wrong chains (bridged SOL on Base, ETH on BSC, etc.)
        const NATIVE_CHAIN = { 'SOL': 1399811149, 'ETH': 1, 'BTC': 1, 'BNB': 56, 'MATIC': 137, 'AVAX': 43114, 'FTM': 250 }
        if (NATIVE_CHAIN[t.symbol] && t.networkId !== NATIVE_CHAIN[t.symbol]) return false
        // Exclude spam names
        const nameLower = t.name.toLowerCase()
        if (SPAM_PATTERNS.some(p => nameLower.includes(p))) return false
        // Exclude symbols > 10 chars (spam)
        if (t.symbol.length > 10) return false
        // Exclude overflow/fake data
        if (t.volume24h > 1e15 || t.marketCap > 1e15 || t.liquidity > 1e15 || t.price > 1e12) return false
        // Exclude honeypots (volume/mcap ratio > 200 - extreme wash trading)
        if (t.marketCap > 0 && t.volume24h / t.marketCap > 200) return false
        // NAME impersonation of stables/majors: the symbol check above missed a
        // fake "USDT" whose SYMBOL was "U" but whose NAME was "USDT" ($731B
        // fabricated mcap, measured live 2026-08-18). Normalize the name and
        // run it through the same exclusion set. Ticker-squats of equities
        // (GameStop/Apple clones) are deliberately NOT excluded here - the
        // engine's impersonation detector badges those instead.
        if (EXCLUDED.has(t.name.toUpperCase().replace(/\s+/g, ''))) return false
        // Fabricated-supply + wash gates, cap-tiered - keep in sync with
        // mcapLiqDropLimit (lib/token-safety.js) and isCleanRow (TrendingHub).
        // Measured 2026-08-18 on the live BSC fill: kills fake USDT (5887x
        // mcap/liq), M21NT (1872x), BTW (3087x), QUQ (214x vol/liq), DEBIT
        // (151x); highest legit survivor 1021x mcap/liq, 27x vol/liq.
        if (t.liquidity > 0) {
          if (t.volume24h > 0 && t.volume24h / t.liquidity > 100) return false
          const mlLimit = t.marketCap < 1_000_000 ? 200 : t.marketCap < 20_000_000 ? 300 : 1500
          if (t.marketCap > 0 && t.marketCap / t.liquidity > mlLimit) return false
        }
        // Exclude dead tokens (zero change across all timeframes)
        if (t.change5m === 0 && t.change1h === 0 && t.change4h === 0 && t.change24h === 0 && t.volume24h < 50000) return false
        // Exclude tokens with absurd change (> 10000% in any timeframe - data errors)
        if (Math.abs(t.change1h) > 100 || Math.abs(t.change4h) > 100 || Math.abs(t.change24h) > 100) return false
        return true
      })
      .map((t, i) => ({ ...t, rank: i + 1 }))

    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=20')
    res.json({ results, count: results.length })
  } catch (err) {
    const msg = err?.message || ''
    console.warn('[screener] returning empty results:', msg)
    // Graceful degradation: dev Codex keys often lack filterTokens scope
    // ("Your API key is not activated"). 200 + empty array keeps the
    // frontend discovery list quiet instead of throwing console errors.
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ results: [], count: 0, degraded: true, reason: /not activated|429|403/i.test(msg) ? msg : 'screener_unavailable' })
  }
})

// ─── Initialize ─────────────────────────────────────────────────────────────

// Connect on first import (lazy - only if CODEX_API_KEY exists)
if (CODEX_API_KEY) {
  connectCodexWs()
} else {
  console.warn('[codex-stream] CODEX_API_KEY not set - real-time streaming disabled')
}

module.exports = router
