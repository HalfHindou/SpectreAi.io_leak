/**
 * sparklineFetch.js — shared 24h close-price fetcher for per-row
 * sparklines on both Watchlist (LeftPanel) and TokenScreener.
 *
 * PR-S-C: the per-row `getBars` fan-out (20+ individual /api/bars round trips
 * that saturated dev HTTP/1.1 and blew the bars 60-req/min bucket) is replaced
 * by an internal MICROBATCH. Callers still use the same public API; internally
 * requested keys are collected for ~50ms (or until 40 accumulate) and flushed as
 * ONE request to the batch sparklines endpoint. Results fan back out to each
 * caller's promise. If the batch endpoint is unavailable (old-server skew: non-OK
 * / 404), we fall back per-key to the individual /api/bars path so nothing breaks
 * during a deploy window. Module-level Map cache, 2-min TTL — unchanged.
 */

import { getBars } from '../services/codexApi'

// 5 min. These are 15-min-bar lines (SPARK_RES below), so nothing a 2-min
// refetch returned could differ visibly; the server now holds them for the
// full 15-min bucket, so a shorter client TTL only re-downloads cached JSON.
const SPARKLINE_TTL = 300_000
const _cache = new Map()

// Per-key promise dedup: the watchlist (LeftPanel) and the screener
// (TokenScreener) frequently want the SAME address in the same load. Coalesce
// to one entry instead of two near-simultaneous ones.
const _inflight = new Map()

// Prod hits /api/codex?action=sparklines; dev hits the Express /api/tokens/
// twin (mirrors codexApi's isDev switch).
const isDev = typeof window !== 'undefined'
  && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

const BATCH_MAX = 40          // server caps ids at 40 (400s past that)
const BATCH_DELAY_MS = 50     // collect a render's worth of rows, then flush
const SPARK_RES = '15'        // 15-min bars
const SPARK_SPAN = 86400      // 24h window

// Normalize the networkId exactly like the server does (a Solana address passed
// with net 1 becomes 1399811149) so our cache/response keys line up with the
// batch endpoint's `<addrLower>:<net>` keys.
function _normNet(address, networkId) {
  const isSol = address && !address.startsWith('0x') && address.length >= 32 && address.length <= 44
  let net = networkId || 1
  if (isSol && net === 1) net = 1399811149
  return net
}

function _keyFor(address, networkId) {
  return `${(address || '').toLowerCase()}:${_normNet(address, networkId)}`
}

// Pending microbatch: key -> { address, networkId, resolvers: [] }
let _pending = new Map()
let _flushTimer = null

function _scheduleFlush() {
  if (_flushTimer) return
  _flushTimer = setTimeout(_flush, BATCH_DELAY_MS)
}

function _flushNow() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
  _flush()
}

// Individual-bars fallback (the pre-PR-S-C path) for a single token. Used only
// when the batch endpoint itself is unavailable, so a deploy-skew window never
// blanks the lines.
async function _fallbackSingle(address, networkId) {
  try {
    const now = Math.floor(Date.now() / 1000)
    const from = now - SPARK_SPAN
    const result = await getBars(address, SPARK_RES, from, now, networkId)
    const bars = result?.getBars || []
    if (bars.length < 2) return null
    const prices = bars.map((b) => parseFloat(b.close ?? b.c ?? 0)).filter((p) => p > 0)
    return prices.length >= 2 ? prices : null
  } catch {
    return null
  }
}

async function _flush() {
  _flushTimer = null
  if (_pending.size === 0) return
  // Swap synchronously so keys added during the awaits below land in the next batch.
  const batch = _pending
  _pending = new Map()
  const entries = [...batch.entries()] // [key, { address, networkId, resolvers }]

  const ids = entries.map(([, e]) => `${e.address}:${e.networkId}`).join(',')
  const qs = `ids=${encodeURIComponent(ids)}&res=${SPARK_RES}&span=${SPARK_SPAN}`
  const url = isDev ? `/api/tokens/sparklines?${qs}` : `/api/codex?action=sparklines&${qs}`

  let sparks = null
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (r.ok) {
      const json = await r.json()
      sparks = json?.sparks || {}
    }
  } catch {
    sparks = null
  }

  if (sparks) {
    // Batch succeeded — fan each key out. A key missing from the response is an
    // honest "no data" (null), not a fake line.
    for (const [key, e] of entries) {
      const arr = sparks[key]
      const prices = Array.isArray(arr) && arr.length >= 2 ? arr : null
      if (prices) _cache.set(key, { prices, ts: Date.now() })
      for (const resolve of e.resolvers) resolve(prices)
    }
    return
  }

  // Whole request failed (non-OK / 404 / old server) — per-key /api/bars fallback.
  await Promise.all(entries.map(async ([key, e]) => {
    const prices = await _fallbackSingle(e.address, e.networkId)
    if (prices) _cache.set(key, { prices, ts: Date.now() })
    for (const resolve of e.resolvers) resolve(prices)
  }))
}

/**
 * fetchSparklineBars(address, networkId) → number[] | null
 *
 * Returns the 24h close-price series (15-min resolution, ≤48 points).
 * Resolves to `null` when the address is unknown or the endpoint returns
 * fewer than 2 valid closes — honest fallback per the brief's
 * "never fake the line" rule.
 */
export async function fetchSparklineBars(address, networkId) {
  // No address = nothing to chart. Without this guard, watchlist rows for
  // address-less assets fired /api/bars?symbol=undefined on every token-page
  // open (7 junk requests observed in one load, 2026-06-11).
  if (!address || address === 'undefined') return null
  const key = _keyFor(address, networkId)
  const cached = _cache.get(key)
  if (cached && Date.now() - cached.ts < SPARKLINE_TTL) return cached.prices

  // Coalesce concurrent requests for the same token across both rails.
  const existing = _inflight.get(key)
  if (existing) return existing

  const promise = new Promise((resolve) => {
    let entry = _pending.get(key)
    if (!entry) {
      entry = { address, networkId: _normNet(address, networkId), resolvers: [] }
      _pending.set(key, entry)
    }
    entry.resolvers.push(resolve)
    if (_pending.size >= BATCH_MAX) _flushNow()
    else _scheduleFlush()
  })
  _inflight.set(key, promise)
  promise.finally(() => _inflight.delete(key))
  return promise
}

/** Same key shape as `fetchSparklineBars`. Used for fast-path lookups. */
export function getSparklineFromCache(address, networkId) {
  const key = _keyFor(address, networkId)
  const cached = _cache.get(key)
  return cached && Date.now() - cached.ts < SPARKLINE_TTL ? cached.prices : null
}
