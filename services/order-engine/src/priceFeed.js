/**
 * Layered price table for armed tokens - ZERO new Codex pollers:
 *
 *   L1  SSE push from the existing stream.spectreai.io relay (KD's box,
 *       zero marginal Codex cost, ~1-3s latency). One connection carrying
 *       every armed token (?tokens=addr:networkId,addr:networkId,...).
 *   L2  KV token-snapshot (codex:v1:tsnap:*, refreshed by the app's 3-min
 *       cron) - carries price + circulatingSupply + liquidity for mcap
 *       re-derivation and the liquidity floor.
 *   L3  bounded reconciler: GET {app}/api/token-snapshot?phase=fast (its
 *       own KV/cache lane) only when SSE is silent AND the snapshot is
 *       stale - hard-capped ORDER_ENGINE_CODEX_RPM (default 2) calls/min
 *       GLOBALLY.
 *
 * Exposes: getLive(address, networkId) -> { priceUsd, supply, liquidity,
 * priceTs, supplyTs } | null, plus setWatchlist() and sseConnected().
 */
const { EventSource } = require('eventsource')

const SSE_BASE = process.env.STREAM_BASE || 'https://stream.spectreai.io'
const APP_BASE = process.env.APP_BASE || 'https://spectre-trading.vercel.app'
// The prod /api/token-snapshot is auth-gated; the engine authenticates the
// price read with the internal key (token-snapshot honors it). Without this
// the reconciler 401s in prod and only SSE-streamed tokens ever get a price.
const INTERNAL_KEY = process.env.ORDER_ENGINE_INTERNAL_KEY || ''
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || ''
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''
const RECONCILER_RPM = Math.max(0, parseInt(process.env.ORDER_ENGINE_CODEX_RPM || '2', 10))

const SSE_SILENT_MS = 45_000
const SNAP_STALE_MS = 240_000

const _table = new Map() // addr:net -> { priceUsd, priceTs, supply, supplyTs, liquidity }
let _es = null
let _watchKey = ''
let _lastSseMsg = 0   // last PRICE message (drives staleness fallbacks)
let _lastSseEvent = 0 // last ANY event incl. 'connected' (drives health)
let _reconnects = 0
const _reconcilerCalls = [] // timestamps, minute window

// Table keys lowercase for lookup consistency; the SSE SUBSCRIPTION must
// preserve the ORIGINAL case - Solana mints are base58 (case-sensitive),
// a lowercased mint subscribes to a nonexistent token.
function key(address, networkId) { return `${String(address).toLowerCase()}:${networkId}` }

function entry(address, networkId) {
  const k = key(address, networkId)
  let e = _table.get(k)
  if (!e) { e = { priceUsd: null, priceTs: 0, supply: null, supplyTs: 0, liquidity: null }; _table.set(k, e) }
  return e
}

function sseConnected() {
  // Connection-alive (any event) - price ticks can legitimately be sparse
  // for quiet tokens; the price-staleness fallback uses _lastSseMsg instead.
  return !!_es && Date.now() - _lastSseEvent < 120_000
}

/** Reconfigure the single SSE connection for the current armed-token set. */
function setWatchlist(tokens) {
  // ORIGINAL-case address:networkId pairs for the subscription (base58 is
  // case-sensitive); dedupe on the lowercase table key.
  const seen = new Set()
  const pairs = []
  for (const t of tokens) {
    const k = key(t.address, t.networkId)
    if (seen.has(k)) continue
    seen.add(k)
    pairs.push(`${t.address}:${t.networkId}`)
  }
  const wanted = pairs.sort().join(',')
  if (wanted === _watchKey && _es) return
  _watchKey = wanted
  if (_es) { try { _es.close() } catch { /* ignore */ } _es = null }
  if (!wanted) return
  const url = `${SSE_BASE}/api/codex/stream?tokens=${encodeURIComponent(wanted)}`
  _es = new EventSource(url)
  _es.addEventListener('connected', () => { _lastSseEvent = Date.now() })
  _es.onmessage = (evt) => {
    _lastSseEvent = Date.now()
    try {
      const d = JSON.parse(evt.data)
      if (d.address && d.priceUsd !== undefined) {
        _lastSseMsg = Date.now()
        const e = entry(d.address, d.networkId)
        e.priceUsd = Number(d.priceUsd)
        e.priceTs = Date.now()
      }
    } catch { /* skip */ }
  }
  _es.onerror = () => {
    // eventsource auto-reconnects; count for /healthz visibility
    _reconnects++
  }
}

async function kvGetJson(k) {
  if (!KV_URL || !KV_TOKEN) return null
  try {
    const res = await fetch(KV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', k]),
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const raw = (await res.json()).result
    if (!raw) return null
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch { return null }
}

function adoptSnapshot(address, networkId, snap) {
  const d = snap?.data?.details || snap?.details
  if (!d) return false
  const e = entry(address, networkId)
  const now = Date.now()
  if (Number(d.price) > 0 && now - e.priceTs > 30_000) { e.priceUsd = Number(d.price); e.priceTs = now }
  if (Number(d.circulatingSupply) > 0) { e.supply = Number(d.circulatingSupply); e.supplyTs = now }
  if (d.liquidity != null) e.liquidity = Number(d.liquidity)
  return true
}

/** L2: read the app's KV token snapshot (written by the 3-min cron). */
async function refreshFromKvSnapshot(address, networkId) {
  const snap = await kvGetJson(`codex:v1:tsnap:${String(address).toLowerCase()}:${networkId}:60`)
  return snap ? adoptSnapshot(address, networkId, snap) : false
}

/** L3: bounded reconciler through the app's own cached snapshot lane.
    Prod serves /api/token-snapshot (serverless), dev Express serves
    /api/token/snapshot - try prod path first, fall back once on 404. */
let _snapshotPath = '/api/token-snapshot'
async function reconcile(address, networkId) {
  const now = Date.now()
  while (_reconcilerCalls.length && now - _reconcilerCalls[0] > 60_000) _reconcilerCalls.shift()
  if (_reconcilerCalls.length >= RECONCILER_RPM) return false
  _reconcilerCalls.push(now)
  try {
    const url = (path) => `${APP_BASE}${path}?address=${encodeURIComponent(address)}&networkId=${networkId}&phase=fast`
    const fetchOpts = { signal: AbortSignal.timeout(9000), ...(INTERNAL_KEY ? { headers: { 'x-spectre-internal': INTERNAL_KEY } } : {}) }
    let res = await fetch(url(_snapshotPath), fetchOpts)
    if (res.status === 404 && _snapshotPath === '/api/token-snapshot') {
      _snapshotPath = '/api/token/snapshot' // dev Express - remember for the process
      res = await fetch(url(_snapshotPath), fetchOpts)
    }
    if (!res.ok) return false
    return adoptSnapshot(address, networkId, await res.json())
  } catch { return false }
}

/**
 * Best current view of a token. Refreshes L2/L3 lazily when stale; L1
 * updates arrive via SSE push.
 */
async function getLive(address, networkId) {
  const e = entry(address, networkId)
  const now = Date.now()
  const priceStale = now - e.priceTs > SSE_SILENT_MS
  const supplyStale = now - e.supplyTs > SNAP_STALE_MS
  if (priceStale || supplyStale) {
    await refreshFromKvSnapshot(address, networkId)
  }
  // Reconcile whenever the PRICE is still stale - a fresh supply stamp
  // must not block the price path (they are independent staleness axes).
  if (now - e.priceTs > SSE_SILENT_MS) {
    await reconcile(address, networkId)
  }
  if (e.priceUsd == null) return null
  return { priceUsd: e.priceUsd, priceTs: e.priceTs, supply: e.supply, supplyTs: e.supplyTs, liquidity: e.liquidity }
}

function stats() {
  return { watched: _table.size, sseConnected: sseConnected(), lastSseMsg: _lastSseMsg, reconnects: _reconnects, reconcilerLastMin: _reconcilerCalls.length }
}

module.exports = { setWatchlist, getLive, sseConnected, stats }
