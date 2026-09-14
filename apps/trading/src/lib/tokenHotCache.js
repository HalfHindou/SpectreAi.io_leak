/**
 * tokenHotCache — module-level LRU of the last 8 tokens' fully hydrated
 * state. Mirrors GMGN's multichart cache so re-clicking a recently viewed
 * token paints instantly (no network round-trip, banner + chart show
 * real data on first frame).
 *
 * Survives unmount. GP7: a SMALL slice additionally persists to
 * localStorage ('spectre-hot-cache') so hard-refresh / next-session visits
 * to a recent token paint real banner numbers, the correct accent colour
 * and a real price curve on the literal first frame.
 *
 * STRICT persisted-consumption contract - the disk slice may ONLY feed:
 *   (a) the App.jsx deep-link initial-state seeder (payload, 24h gate -
 *       same staleness precedent as 'spectre-selected-token'),
 *   (b) the accent pipeline via seedColorCache (color),
 *   (c) sparkBars: previously the line-curve chart placeholder (removed
 *       2026-07-09 per Gleb - candles pop in directly now); the slice is
 *       still persisted (tiny) for any future instant-paint consumer.
 * NEVER seed the live data hooks (useChartData / useLatestTrades /
 * useSharedTokenDetails) from disk - they must always re-fetch.
 *
 * Keyed by lowercase address. Values: { payload, snapshot, ts }
 *   - payload: the lightweight click-time row data (symbol, name,
 *     logo, price, change, marketCap) — what selectToken receives.
 *   - snapshot: the full /api/token/snapshot response if available
 *     (details + bars + trades + color). Optional.
 *   - ts: write timestamp for TTL gating.
 *
 * Consumers:
 *   - apps/trading/src/App.jsx selectToken — writes payload on every
 *     token click + writes snapshot when fetchTokenSnapshot resolves.
 *   - apps/trading/src/App.jsx initial-state seeder — reads payload
 *     on deep-link mount before localStorage fallback.
 *   - apps/trading/src/hooks/useCodexData.js useChartData /
 *     useLatestTrades / useSharedTokenDetails initial seeders — read
 *     snapshot.bars / snapshot.trades / snapshot.details to skip
 *     fetches when the cache is warm.
 *
 * Kill switch: HOT_CACHE_ENABLED = false → every read returns null,
 * client falls back to existing per-call cold path.
 */

const HOT_CACHE_ENABLED = true
const MAX_ENTRIES = 8
const FRESH_TTL = 5 * 60 * 1000 // 5min — payload stays usable; snapshot still refreshes via TokenDetailsContext poll.

// LRU implementation via Map insertion order. set() deletes-then-sets
// to bump recency.
const _cache = new Map()

// ── GP7: localStorage persistence (small slice, idle write-through) ──
const PERSIST_KEY = 'spectre-hot-cache'
const PERSIST_VERSION = 1
const PERSIST_MAX_ENTRIES = 4
const PERSIST_MAX_BYTES = 32 * 1024
let _persistScheduled = false
let _persistStore // undefined = not loaded yet; null = absent/invalid

function _loadPersisted() {
  if (_persistStore !== undefined) return _persistStore
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    // Version mismatch discards wholesale - no migrations for a paint cache.
    _persistStore = (parsed && parsed.v === PERSIST_VERSION && parsed.entries) ? parsed : null
  } catch {
    _persistStore = null
  }
  return _persistStore
}

// <=60 downsampled closes - just enough for the placeholder curve.
function _downsampleCloses(snapshot) {
  const raw = snapshot?.bars?.bars || snapshot?.bars
  if (!Array.isArray(raw) || raw.length === 0) return null
  const closes = raw
    .map(b => Array.isArray(b) ? (parseFloat(b[4]) || 0) : (parseFloat(b?.c ?? b?.close) || 0))
    .filter(v => v > 0)
  if (closes.length < 2) return null
  if (closes.length <= 60) return closes
  const step = closes.length / 60
  const out = []
  for (let i = 0; i < 60; i++) out.push(closes[Math.floor(i * step)])
  return out
}

function _schedulePersist() {
  if (!HOT_CACHE_ENABLED || _persistScheduled || typeof window === 'undefined') return
  _persistScheduled = true
  const run = () => {
    _persistScheduled = false
    try {
      const entries = {}
      // Map insertion order = LRU order; keep the most recent N.
      const keys = Array.from(_cache.keys()).slice(-PERSIST_MAX_ENTRIES)
      for (const k of keys) {
        const v = _cache.get(k)
        if (!v?.payload) continue
        entries[k] = {
          payload: v.payload,
          color: v.snapshot?.color || v.payload?.dominantColor || null,
          sparkBars: _downsampleCloses(v.snapshot),
          ts: v.ts,
        }
      }
      const json = JSON.stringify({ v: PERSIST_VERSION, entries })
      if (json.length > PERSIST_MAX_BYTES) return // size guard - skip, don't thrash
      localStorage.setItem(PERSIST_KEY, json)
      _persistStore = undefined // invalidate the read memo
    } catch { /* QuotaExceeded / private mode - persistence is best-effort */ }
  }
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 2000 })
  else setTimeout(run, 500)
}

/**
 * Read the PERSISTED slice for `address`: { payload, color, sparkBars, ts }
 * or null. maxAgeMs gates staleness (callers: 24h for the banner payload
 * seed, 6h for sparkBars). See the consumption contract in the header -
 * never feed this into live data hooks.
 */
export function readPersistedHot(address, { maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  if (!HOT_CACHE_ENABLED) return null
  const k = _key(address)
  if (!k) return null
  const store = _loadPersisted()
  const e = store?.entries?.[k]
  if (!e?.payload) return null
  if (Date.now() - (e.ts || 0) > maxAgeMs) return null
  return e
}

function _bump(key) {
  if (!_cache.has(key)) return
  const val = _cache.get(key)
  _cache.delete(key)
  _cache.set(key, val)
}

function _evict() {
  while (_cache.size > MAX_ENTRIES) {
    const firstKey = _cache.keys().next().value
    if (firstKey === undefined) break
    _cache.delete(firstKey)
  }
}

function _key(address) {
  return typeof address === 'string' ? address.toLowerCase() : null
}

/**
 * Read a hot-cache entry. Returns { payload, snapshot, ts } or null.
 * Caller decides freshness via ts.
 */
export function readHotEntry(address) {
  if (!HOT_CACHE_ENABLED) return null
  const k = _key(address)
  if (!k) return null
  const entry = _cache.get(k)
  if (!entry) return null
  _bump(k)
  return entry
}

/**
 * Return the click-time payload for `address` if it's still fresh.
 * Falls back to null. Used by the App.jsx initial-state seeder so a
 * deep-link mount of a hot token paints with real banner data on
 * frame 1.
 */
export function readHotPayload(address) {
  const entry = readHotEntry(address)
  if (!entry) return null
  if (Date.now() - entry.ts > FRESH_TTL) return null
  return entry.payload || null
}

/**
 * Return the full snapshot ({ details, bars, trades, color }) for
 * `address` if cached. Used by useChartData / useLatestTrades /
 * useSharedTokenDetails initial seeders to skip fetches.
 */
export function readHotSnapshot(address) {
  const entry = readHotEntry(address)
  if (!entry) return null
  if (Date.now() - entry.ts > FRESH_TTL) return null
  return entry.snapshot || null
}

/**
 * Write the click-time payload. Called on every selectToken so re-
 * mounts (hash navigation, hard-refresh of same token within 5min)
 * read back full-fidelity initial state.
 */
export function writeHotPayload(address, payload) {
  if (!HOT_CACHE_ENABLED) return
  const k = _key(address)
  if (!k || !payload) return
  const existing = _cache.get(k)
  const next = {
    payload: { ...payload },
    snapshot: existing?.snapshot || null,
    ts: Date.now(),
  }
  _cache.delete(k)
  _cache.set(k, next)
  _evict()
  _schedulePersist()
}

/**
 * Write the full snapshot. Called once the /api/token/snapshot fetch
 * returns. Preserves the existing payload — they layer.
 */
export function writeHotSnapshot(address, snapshot) {
  if (!HOT_CACHE_ENABLED) return
  const k = _key(address)
  if (!k || !snapshot) return
  const existing = _cache.get(k)
  const next = {
    payload: existing?.payload || null,
    snapshot,
    ts: Date.now(),
  }
  _cache.delete(k)
  _cache.set(k, next)
  _evict()
  _schedulePersist()
}

/**
 * Optional dev tool: dump current cache state.
 */
export function _debugHotCache() {
  if (typeof console === 'undefined') return
  console.info('[hotCache]', Array.from(_cache.entries()).map(([k, v]) => ({
    address: k,
    hasPayload: !!v.payload,
    hasSnapshot: !!v.snapshot,
    ageMs: Date.now() - v.ts,
  })))
}
