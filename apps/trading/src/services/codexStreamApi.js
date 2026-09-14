/**
 * Codex Real-time Price Stream Client
 *
 * Connects to the Express SSE relay at /api/codex/stream to receive
 * real-time Codex price updates. Singleton pattern - one connection
 * shared across all consumers.
 *
 * Key design: the EventSource is opened ONCE and only replaced when the
 * token set genuinely changes AND the new connection successfully opens.
 * This prevents rapid React lifecycle churn (strict mode double-effects,
 * HMR, component remounts) from thrashing the connection.
 *
 * Usage:
 *   import { subscribe, getLatestPrice } from './codexStreamApi'
 *   const unsub = subscribe(['0xC02a...Cc2:1', 'So111...112:1399811149'], (price) => {
 *     console.log(price.address, price.priceUsd)
 *   })
 *   // later: unsub()
 */

import { subscribeActivity } from '../lib/idleManager'

// Active listeners: callback -> Set of tokenKeys
const _listeners = new Map()
// All token keys currently needed: tokenKey -> refcount
const _tokenRefs = new Map()
// Latest price cache: tokenKey -> { address, networkId, priceUsd, timestamp }
const _prices = new Map()
// EventSource connection
let _es = null
let _esTokenSet = '' // Sorted token set string of the active connection
let _esVia = ''      // `via` param the active connection was opened with
// tokenKey -> "pairAddress:side". Tokens registered here are served by the
// relay from their PAIR's onEventsCreated feed (one Codex subscription shared
// with the trades tape) instead of a separate onPricesUpdated subscription -
// see the pair-feed note in the relay. Ticks then arrive per TRADE and carry
// `tradeUsd`, which the chart uses to grow the forming candle's volume.
const _via = new Map()

function _viaParamFor(tokenSetStr) {
  if (!tokenSetStr) return ''
  return tokenSetStr.split(',')
    .filter((k) => _via.has(k))
    .map((k) => `${k}@${_via.get(k)}`)
    .join(',')
}
let _reconnectTimer = null
let _reconnectAttempts = 0
let _connectTimer = null
const RECONNECT_BASE_MS = 2000
const RECONNECT_MAX_MS = 30000
const CONNECT_DEBOUNCE_MS = 150

function _currentTokenSet() {
  const keys = [..._tokenRefs.keys()]
  if (keys.length === 0) return ''
  return keys.sort().join(',')
}

function _deliver(data) {
  if (!data || !data.address || data.priceUsd === undefined) return
  const key = `${data.address}:${data.networkId}`
  _prices.set(key, data)
  for (const [cb, tokenSet] of _listeners) {
    if (tokenSet.has(key)) {
      try { cb(data) } catch { /* listener error */ }
    }
  }
}

// A tick older than this is a replay of something the poll already
// superseded, never a live price. The relay caches the last tick per token
// and replays it on connect; before the relay gated that by age, a quiet
// pair could hand a new connection a twelve-hour-old launch buy (REVINU:
// 0.000198 replayed onto a 0.000014 token, header + MCap + forming candle
// all 14x). Belt and braces: the client refuses it too, so an older relay
// build or a relay clock skew cannot put a stale number on the money path.
const TICK_MAX_AGE_SEC = 300

function _handleMessage(event) {
  try {
    const tick = JSON.parse(event.data)
    const ts = Number(tick?.timestamp) || 0
    if (ts > 0 && Math.floor(Date.now() / 1000) - ts > TICK_MAX_AGE_SEC) return
    _deliver(tick)
  } catch { /* parse error */ }
}

function _openConnection(tokenSet) {
  // Close existing connection
  if (_es) {
    _es.close()
    _es = null
  }
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer)
    _reconnectTimer = null
  }

  if (!tokenSet) {
    _esTokenSet = ''
    _esVia = ''
    return
  }

  // In production, connect directly to OVH SSE relay (persistent server).
  // In dev, go through Vite proxy to Express.
  const sseBase = import.meta.env.PROD ? 'https://stream.spectreai.io' : ''
  const via = _viaParamFor(tokenSet)
  const url = `${sseBase}/api/codex/stream?tokens=${tokenSet}${via ? `&via=${encodeURIComponent(via)}` : ''}`
  _esTokenSet = tokenSet
  _esVia = via
  _es = new EventSource(url)

  _es.onmessage = _handleMessage

  _es.addEventListener('connected', () => {
    _reconnectAttempts = 0
  })

  _es.onerror = () => {
    if (_es?.readyState === EventSource.CLOSED) {
      _esTokenSet = ''
      _scheduleReconnect()
    }
  }
}

function _scheduleReconnect() {
  if (_reconnectTimer) return
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, _reconnectAttempts), RECONNECT_MAX_MS)
  _reconnectAttempts++
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null
    // Hidden or idle: nobody is looking, the stream stays closed (the
    // visibility / activity handlers reopen it). See the pausing note below.
    if (typeof document !== 'undefined' && document.hidden) return
    if (_idlePaused) return
    const tokenSet = _currentTokenSet()
    if (tokenSet) _openConnection(tokenSet)
  }, delay)
}

/**
 * Debounced check: do we need to open/change our EventSource?
 * Called after subscribe/unsubscribe. Coalesces rapid changes.
 */
function _maybeReconnect() {
  if (_connectTimer) clearTimeout(_connectTimer)
  _connectTimer = setTimeout(() => {
    _connectTimer = null

    // Hidden or idle tab: no stream. The tab title is fed by the background
    // poll instead (see _enterBackground); a resume reopens everything. A
    // subscriber that arrives while already hidden (the token page mounting
    // in a background tab) starts that poll here.
    if (typeof document !== 'undefined' && document.hidden) {
      if (_bgToken && _tokenRefs.has(_bgToken) && !_bgPollTimer) _enterBackground()
      return
    }
    if (_idlePaused) return

    const needed = _currentTokenSet()

    // No tokens needed - shut down
    if (!needed) {
      if (_es) { _es.close(); _es = null; _esTokenSet = '' }
      return
    }

    // A pair registration that the open connection does not carry yet must
    // reopen: that is what moves the token off onPricesUpdated on the relay.
    const viaChanged = _es && _es.readyState !== EventSource.CLOSED && _viaParamFor(_esTokenSet) !== _esVia

    // Connection exists and covers the exact same tokens - keep it
    if (!viaChanged && needed === _esTokenSet && _es && _es.readyState !== EventSource.CLOSED) {
      return
    }

    // Connection exists with a SUPERSET of needed tokens - keep it
    // (server sends extra data we just ignore, cheaper than reconnecting)
    if (!viaChanged && _es && _es.readyState !== EventSource.CLOSED && _esTokenSet) {
      const activeTokens = new Set(_esTokenSet.split(','))
      const neededTokens = needed.split(',')
      if (neededTokens.every(t => activeTokens.has(t))) {
        return // All needed tokens are already subscribed
      }
    }

    // Need a new connection (new tokens added that server doesn't know about)
    _openConnection(needed)
  }, CONNECT_DEBOUNCE_MS)
}

/**
 * Subscribe to real-time price updates for a set of tokens.
 * @param {string[]} tokenKeys - Array of "address:networkId" strings
 * @param {function} callback - Called with { address, networkId, priceUsd, timestamp }
 * @returns {function} Unsubscribe function
 */
export function subscribe(tokenKeys, callback) {
  if (!tokenKeys?.length || !callback) return () => {}

  const keySet = new Set(tokenKeys)
  _listeners.set(callback, keySet)

  // Track ref counts
  let hasNewTokens = false
  for (const key of keySet) {
    const count = _tokenRefs.get(key) || 0
    _tokenRefs.set(key, count + 1)
    if (count === 0) hasNewTokens = true
  }

  // Send cached prices immediately
  for (const key of keySet) {
    const cached = _prices.get(key)
    if (cached) {
      try { callback(cached) } catch { /* ok */ }
    }
  }

  if (hasNewTokens) _maybeReconnect()

  // Return unsubscribe function
  return () => {
    _listeners.delete(callback)
    for (const key of keySet) {
      const count = _tokenRefs.get(key) || 0
      if (count <= 1) {
        _tokenRefs.delete(key)
        _prices.delete(key)
      } else {
        _tokenRefs.set(key, count - 1)
      }
    }
    // Only reconnect check if ALL tokens gone (to disconnect)
    // Otherwise keep existing connection - server sends extra data harmlessly
    if (_tokenRefs.size === 0) _maybeReconnect()
  }
}

/**
 * Register the pair (+ the side the token sits on) a token's price should be
 * derived from. The relay then serves this token from the pair's trade feed
 * (one Codex subscription instead of two) and the ticks carry `tradeUsd`.
 * Idempotent; a change reconnects the stream so the relay learns it.
 * @param {string} tokenKey - "address:networkId"
 * @param {string|null} pairAddress - null clears the registration
 * @param {'token0'|'token1'} side
 */
export function setTokenPair(tokenKey, pairAddress, side) {
  if (!tokenKey) return
  const next = pairAddress ? `${pairAddress}:${side === 'token0' ? 'token0' : 'token1'}` : null
  const prev = _via.get(tokenKey) || null
  if (next === prev) return
  if (next) _via.set(tokenKey, next)
  else _via.delete(tokenKey)
  if (_tokenRefs.has(tokenKey)) _maybeReconnect()
}

/**
 * Get the latest cached price for a token.
 * @param {string} address
 * @param {number} networkId
 * @returns {{ address, networkId, priceUsd, timestamp } | null}
 */
export function getLatestPrice(address, networkId) {
  return _prices.get(`${address}:${networkId}`) || null
}

/**
 * Get all cached prices.
 * @returns {Map<string, { address, networkId, priceUsd, timestamp }>}
 */
export function getAllPrices() {
  return new Map(_prices)
}

/**
 * Check if the stream is connected.
 * @returns {boolean}
 */
export function isConnected() {
  return _es?.readyState === EventSource.OPEN
}

/** Read-only snapshot of the client state - for the console, never for UI. */
export function getStreamDebug() {
  return {
    connected: _es?.readyState === EventSource.OPEN,
    tokenSet: _esTokenSet,
    via: _esVia,
    refs: [..._tokenRefs.keys()],
    bgToken: _bgToken,
    bgPolling: !!_bgPollTimer,
    bgExhausted: _bgExhausted,
    visibilityPaused: _visibilityPaused,
    idlePaused: _idlePaused,
  }
}

// ─── Visibility- and idle-aware pausing ────────────────────────────────────
// Codex bills every delivered subscription message, and a hot launch trades
// 60-100 times a minute - so a pair feed nobody is watching is the most
// expensive thing this client can do. The stream therefore lives only while
// the tab is VISIBLE and the user is ACTIVE (idleManager: 5 min without
// input). Both pauses are cheap to undo: the relay shares one Codex
// subscription per pair across every viewer, so reopening is a fresh SSE and
// the next tick, never a cold start. Prices Map retains last-known values so
// the UI never flashes on resume.
//
// THE TAB TITLE is the one thing that must keep moving while hidden - GMGN's
// tab reads "CATE ↑ $58.74K" from another tab. It used to keep the pair feed
// open for that (narrowed to the pinned token, 30-min budget); on a hot pair
// that was up to ~90 billed messages a minute to move one title. Now the
// hidden tab polls the price once a minute instead - the same cadence Chrome
// throttles hidden timers to anyway - which is one cheap query per minute, on
// the same 30-min budget. A tab left open overnight still bills nothing.
let _visibilityPaused = false
let _idlePaused = false
let _bgToken = null
let _bgPollTimer = null
let _bgBudgetTimer = null
// The token whose hidden-tab budget already ran out - never restarted by a
// late subscribe/pair registration; only a visible tab or a new token resets it.
let _bgExhausted = null
const BG_STREAM_MS = 30 * 60_000
const BG_POLL_MS = 60_000

function _closeConnection() {
  if (_es) {
    _es.close()
    _es = null
    _esTokenSet = ''
  }
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer)
    _reconnectTimer = null
  }
  if (_connectTimer) {
    clearTimeout(_connectTimer)
    _connectTimer = null
  }
}

async function _bgPollTick() {
  const key = _bgToken
  if (!key || !_tokenRefs.has(key)) return
  const i = key.lastIndexOf(':')
  const address = key.slice(0, i)
  const networkId = Number(key.slice(i + 1))
  try {
    // Lazy import: codexApi is the heavier module and this is the only
    // reason the stream client needs it.
    const { getTokenPricesBatch } = await import('./codexApi')
    const rows = await getTokenPricesBatch([{ address, networkId }])
    const row = Array.isArray(rows) ? rows[0] : null
    const priceUsd = Number(row?.priceUsd)
    // Still hidden and still pinned - deliver through the stream path so the
    // title (and any other listener) sees it exactly like a tick.
    if (priceUsd > 0 && _bgToken === key && typeof document !== 'undefined' && document.hidden) {
      _deliver({ address, networkId, priceUsd, timestamp: row.timestamp || Math.floor(Date.now() / 1000) })
    }
  } catch { /* next tick retries */ }
}

function _clearBgTimer() {
  if (_bgPollTimer) {
    clearInterval(_bgPollTimer)
    _bgPollTimer = null
  }
  if (_bgBudgetTimer) {
    clearTimeout(_bgBudgetTimer)
    _bgBudgetTimer = null
  }
}

function _enterBackground() {
  _clearBgTimer()
  _closeConnection()
  _visibilityPaused = true
  // Keep the title moving for the pinned token (it must still have a live
  // subscriber - the token page - or there is nobody to deliver to).
  if (_bgToken && _tokenRefs.has(_bgToken) && _bgToken !== _bgExhausted) {
    const budgetFor = _bgToken
    _bgPollTimer = setInterval(_bgPollTick, BG_POLL_MS)
    _bgBudgetTimer = setTimeout(() => { _clearBgTimer(); _bgExhausted = budgetFor }, BG_STREAM_MS)
  }
}

/**
 * Pin the ONE token whose price should keep streaming while the tab is
 * hidden (drives the live tab title). Pass null to unpin. Safe to call on
 * every render - a no-op unless the key actually changes.
 * @param {string|null} tokenKey - "address:networkId"
 */
export function setBackgroundToken(tokenKey) {
  const next = tokenKey || null
  if (next === _bgToken) return
  _bgToken = next
  if (next !== _bgExhausted) _bgExhausted = null
  if (typeof document === 'undefined' || !document.hidden) return
  // Pinned/unpinned while already hidden: apply immediately.
  if (_bgToken) _enterBackground()
  else { _clearBgTimer(); _closeConnection(); _visibilityPaused = true }
}

// Idle (5 min without input, tab still visible): close the stream. Activity
// reopens it at once - the first mouse move brings the feed back before the
// eye has found the price. Hidden tabs are the visibility handler's business.
if (typeof document !== 'undefined') {
  subscribeActivity((active) => {
    if (!active) {
      if (document.hidden) return
      _idlePaused = true
      _closeConnection()
    } else if (_idlePaused) {
      _idlePaused = false
      _reconnectAttempts = 0
      _maybeReconnect()
    }
  })
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      _enterBackground()
    } else if (_visibilityPaused) {
      // Tab visible again - reconnect if there are active subscribers.
      _clearBgTimer()
      _bgExhausted = null
      _visibilityPaused = false
      _reconnectAttempts = 0
      _maybeReconnect()
    }
  })
}
