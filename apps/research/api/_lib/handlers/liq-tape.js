/**
 * Real liquidation tape client — Spectre data-api box.
 *
 * The box runs 24/7 collectors on Bybit's `allLiquidation` WebSocket (ALL
 * liquidations, not the old 1/sec sample) + OKX, and serves the event tape at
 * /v1/derivatives/liquidations (asset filter, offset pagination, ~7d history —
 * probed 2026-07-28: BTC offset 5000 reached 7 days back).
 *
 * Consumers: /api/charts/liq-prints (real-prints overlay) and the heatmap
 * synthesizer's leverage calibration (liq-heatmap-binance.js).
 *
 * Fail-soft: every function returns what it has on error — never throws to
 * the route level.
 */

const SPECTRE_API_BASE = (process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850').replace(/\/+$/, '')
const SPECTRE_API_KEY = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY || ''

const PAGE_SIZE = 500
const MAX_PAGES = 6
const MAX_PRINTS = 1500

export function symbolToAsset(symbol) {
  let s = String(symbol || 'BTCUSDT').toUpperCase().replace(/USDT$|USDC$|USD$/, '')
  // Binance-style multiplier prefixes: 1000PEPE / 1000000MOG → PEPE / MOG
  s = s.replace(/^1000000/, '').replace(/^1000/, '')
  return s || 'BTC'
}

function tapeHeaders() {
  const h = { accept: 'application/json' }
  if (SPECTRE_API_KEY) h['X-API-Key'] = SPECTRE_API_KEY
  return h
}

// One call = MAX_PAGES parallel queries against the box (3,000 rows). The
// heatmap and the prints overlay both want the same asset, and a timeframe or
// exchange flip re-enters here, so an unguarded route could fire a dozen of
// those in a second. Short in-process cache + in-flight dedupe: the CDN layer
// already holds 60s, this covers the warm-lambda / long-lived-dev-server case
// behind it. Bypassed whenever a custom fetchImpl is injected (tests).
const TAPE_TTL_MS = 60_000
const _tapeCache = new Map()   // key -> { ts, events }
const _tapeInflight = new Map() // key -> Promise

export async function fetchTapeEvents(asset, hours = 72, { fetchImpl = fetch } = {}) {
  if (fetchImpl === fetch) {
    const key = `${asset}|${hours}`
    const hit = _tapeCache.get(key)
    if (hit && Date.now() - hit.ts < TAPE_TTL_MS) return hit.events
    const pending = _tapeInflight.get(key)
    if (pending) return pending
    const p = _fetchTapeEvents(asset, hours, fetchImpl)
      .then((events) => {
        _tapeCache.set(key, { ts: Date.now(), events })
        // The box serves a handful of assets; a hard cap keeps a warm lambda
        // from growing this map without bound.
        if (_tapeCache.size > 40) _tapeCache.delete(_tapeCache.keys().next().value)
        return events
      })
      .finally(() => { _tapeInflight.delete(key) })
    _tapeInflight.set(key, p)
    return p
  }
  return _fetchTapeEvents(asset, hours, fetchImpl)
}

async function _fetchTapeEvents(asset, hours, fetchImpl) {
  const cutoff = Date.now() - hours * 3600_000
  const events = []
  try {
    // All pages in parallel — a cold box makes a sequential walk take 10-15s+
    // (measured), which blows every client budget. Parallel is one round-trip.
    // Slight waste when the window ends early (later pages fetched anyway);
    // 6 cheap LIMIT/OFFSET queries are fine for the box.
    const pages = await Promise.allSettled(
      Array.from({ length: MAX_PAGES }, (_, i) =>
        fetchImpl(
          `${SPECTRE_API_BASE}/v1/derivatives/liquidations?asset=${encodeURIComponent(asset)}&limit=${PAGE_SIZE}&offset=${i * PAGE_SIZE}`,
          { headers: tapeHeaders(), signal: AbortSignal.timeout(8000) }
        ).then(res => (res.ok ? res.json() : null))
      )
    )
    for (const pg of pages) {
      const rows = pg.status === 'fulfilled' ? pg.value?.data : null
      if (!Array.isArray(rows)) continue
      for (const r of rows) {
        const t = Number(r.time_unix) * 1000 || Date.parse(r.time)
        if (!Number.isFinite(t) || t < cutoff) continue
        const usd = Number(r.usd_value)
        const price = Number(r.price)
        if (!(usd > 0) || !(price > 0)) continue
        events.push({ t, p: price, side: r.side === 'short' ? 'short' : 'long', usd, ex: String(r.exchange || '').toLowerCase() })
      }
    }
  } catch { /* fail-soft: return what we have */ }
  return events
}

export function shapePrintsPayload(events, hours) {
  const truncated = events.length > MAX_PRINTS
  let out = events
  if (truncated) {
    out = [...events].sort((a, b) => b.usd - a.usd).slice(0, MAX_PRINTS)
  }
  out = [...out].sort((a, b) => a.t - b.t)
  let oldest = Infinity
  for (const e of events) if (e.t < oldest) oldest = e.t
  return {
    events: out,
    count: out.length,
    truncated,
    window_covered_hours: Number.isFinite(oldest)
      ? Math.round(((Date.now() - oldest) / 3600_000) * 10) / 10
      : 0,
    requested_hours: hours,
  }
}
