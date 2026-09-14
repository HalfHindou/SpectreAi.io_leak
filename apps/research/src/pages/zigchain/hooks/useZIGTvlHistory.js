import { useEffect, useMemo, useState } from 'react'
import { isAppActive } from '@/lib/idleManager'

// 2026-05-28 hide-apis: was direct https://api.llama.fi/{lite/charts,v2/historicalChainTvl}/zigchain.
// Routed through same-origin extended-proxy raw passthroughs (60s cache).
const LITE_ENDPOINT = '/api/data-api?fn=extended-proxy&route=llama-lite-charts&chain=zigchain'
const HISTORICAL_FALLBACK = '/api/data-api?fn=extended-proxy&route=llama-chain-tvl-history&chain=zigchain'
const FETCH_TIMEOUT = 6000
// Persistent disk cache so revisits paint the chart instantly from the last
// successful response. Module memory is still the hot path; this is just a
// crash-cart for cold loads / hard reloads / new tabs.
const LS_KEY = 'spectre.zigtvl.series.v1'
const LS_MAX_AGE_MS = 6 * 60 * 60 * 1000 // 6h - older than this and we'd rather wait for fresh

const RANGE_DAYS = {
  '7D': 7,
  '30D': 30,
  '90D': 90,
  '1Y': 365,
  ALL: 365,
}

// DefiLlama's chain page exposes three "extra" buckets you can stack on top
// of the bare chain TVL: liquid staking, double-counted protocols, and active
// borrows. The combined chart matches the headline value defillama.com shows
// for the chain. Spectre exposes the same toggle so users can reconcile with
// either definition.
export const EXTRA_KEYS = ['liquidstaking', 'doublecounted', 'borrowed']
export const DEFAULT_EXTRAS = { liquidstaking: true, doublecounted: true, borrowed: true }

let _cache = null // { ts, series: { combined, base, liquidstaking, doublecounted, borrowed } }
let _inflight = null
// DefiLlama updates chain TVL on a daily cadence; intraday changes are
// rounding noise. The prior 15 s constants meant ~240 wasted upstream
// passthrough calls per hour per visitor for zero perceivable benefit.
// 5 min matches the upstream cache the extended-proxy already enforces.
const CACHE_TTL = 5 * 60 * 1000
const POLL_INTERVAL = 5 * 60 * 1000
const _subscribers = new Set()

// Hydrate the module cache from localStorage on first import so the very
// first render of the page already has data to draw.
function hydrateFromLS() {
  if (_cache || typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed || !parsed.ts || !parsed.series) return
    if (Date.now() - parsed.ts > LS_MAX_AGE_MS) return
    const s = parsed.series
    _cache = {
      ts: parsed.ts,
      series: {
        combined: new Map(s.combined || []),
        base: new Map(s.base || []),
        liquidstaking: new Map(s.liquidstaking || []),
        doublecounted: new Map(s.doublecounted || []),
        borrowed: new Map(s.borrowed || []),
      },
    }
  } catch (_) { /* corrupt cache, ignore */ }
}
hydrateFromLS()

function persistToLS(series) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      ts: Date.now(),
      series: {
        combined: Array.from(series.combined.entries()),
        base: Array.from(series.base.entries()),
        liquidstaking: Array.from(series.liquidstaking.entries()),
        doublecounted: Array.from(series.doublecounted.entries()),
        borrowed: Array.from(series.borrowed.entries()),
      },
    }))
  } catch (_) { /* quota/private-mode, ignore */ }
}

function notifySubscribers() {
  for (const fn of _subscribers) {
    try { fn() } catch (_) {}
  }
}

function parsePairs(arr) {
  if (!Array.isArray(arr)) return new Map()
  const m = new Map()
  for (const row of arr) {
    if (!Array.isArray(row) || row.length < 2) continue
    const ts = Number(row[0])
    const v = Number(row[1])
    if (Number.isFinite(ts) && Number.isFinite(v)) m.set(ts, v)
  }
  return m
}

function pairsFromHistorical(arr) {
  const m = new Map()
  if (!Array.isArray(arr)) return m
  for (const row of arr) {
    if (!row) continue
    const ts = Number(row.date)
    const v = Number(row.tvl)
    if (Number.isFinite(ts) && Number.isFinite(v)) m.set(ts, v)
  }
  return m
}

async function fetchLite() {
  const res = await fetch(LITE_ENDPOINT, {
    // credentials:'include' — the /api/data-api llama routes are gated (NOT
    // demo-safe). On the iOS home-screen PWA a same-origin fetch drops the
    // HttpOnly gate/privy cookie, so without this the request 401s and the
    // chart silently falls back to stale localStorage (the "broke / not
    // realtime" report). See auth-session-hardening.md + mobile-ibutton fix.
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })
  if (!res.ok) throw new Error(`DefiLlama lite ${res.status}`)
  const json = await res.json().catch(() => null)
  if (!json || !Array.isArray(json.tvl)) throw new Error('DefiLlama lite empty')

  // /lite/charts/{chain} returns `tvl` as the COMBINED series (base + every
  // extra). Keep the combined series verbatim so the "all extras on" view
  // matches DefiLlama exactly with zero derivation drift. Also derive the
  // bare-chain series for when individual extras are toggled off.
  const combined = parsePairs(json.tvl)
  const liquidstaking = parsePairs(json.liquidstaking)
  const doublecounted = parsePairs(json.doublecounted)
  const borrowed = parsePairs(json.borrowed)

  const base = new Map()
  for (const [ts, total] of combined) {
    const b = total
      - (liquidstaking.get(ts) || 0)
      - (doublecounted.get(ts) || 0)
      - (borrowed.get(ts) || 0)
    base.set(ts, Math.max(0, b))
  }
  return { combined, base, liquidstaking, doublecounted, borrowed }
}

async function fetchHistoricalOnly() {
  const res = await fetch(HISTORICAL_FALLBACK, {
    credentials: 'include', // gated route — attach cookie on the PWA (see fetchLite)
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })
  if (!res.ok) throw new Error(`DefiLlama ${res.status}`)
  const arr = await res.json().catch(() => null)
  const base = pairsFromHistorical(arr)
  return { combined: new Map(base), base, liquidstaking: new Map(), doublecounted: new Map(), borrowed: new Map() }
}

async function fetchSeries({ force = false } = {}) {
  if (!force && _cache && Date.now() - _cache.ts < CACHE_TTL) return _cache.series
  if (_inflight) return _inflight
  _inflight = (async () => {
    let series
    try {
      series = await fetchLite()
    } catch (e) {
      console.warn('[zigtvl] lite fetch failed, falling back:', e.message)
      series = await fetchHistoricalOnly()
    }
    _cache = { ts: Date.now(), series }
    persistToLS(series)
    notifySubscribers()
    return series
  })().finally(() => { _inflight = null })
  return _inflight
}

function compose(series, extras) {
  if (!series) return []
  const allOn = !!(extras?.liquidstaking && extras?.doublecounted && extras?.borrowed)
  // When every extra is on, the combined series IS the answer DefiLlama
  // publishes — use it verbatim so the headline matches penny-for-penny.
  // Only fall back to base + selected extras when the user has toggled
  // something off (where a different number is the WHOLE POINT).
  const out = []
  if (allOn) {
    for (const [ts, v] of series.combined) out.push({ ts, tvl: v })
  } else {
    for (const [ts, base] of series.base) {
      let v = base
      if (extras?.liquidstaking) v += series.liquidstaking.get(ts) || 0
      if (extras?.doublecounted) v += series.doublecounted.get(ts) || 0
      if (extras?.borrowed) v += series.borrowed.get(ts) || 0
      out.push({ ts, tvl: v })
    }
  }
  return out.sort((a, b) => a.ts - b.ts)
}

/**
 * useZIGTvlHistory(range, opts)
 *
 * Returns the daily TVL history for ZIGChain windowed to the given range.
 * `opts.extras` toggles the optional buckets DefiLlama stacks onto chain TVL
 * (liquid staking / double-counted / borrowed). Defaults to all on so the
 * headline matches defillama.com.
 */
export function useZIGTvlHistory(range = '90D', opts = {}) {
  const extras = opts.extras || DEFAULT_EXTRAS
  const extrasKey = `${extras.liquidstaking ? 1 : 0}-${extras.doublecounted ? 1 : 0}-${extras.borrowed ? 1 : 0}`

  // Seed state from the module cache so the very first render already has
  // data when we have a warm cache (in-memory or hydrated from localStorage).
  const [series, setSeries] = useState(() => _cache?.series || null)
  const [loading, setLoading] = useState(() => !_cache)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    const apply = (s) => {
      if (cancelled) return
      setSeries(s)
      setError(null)
    }
    const fail = (err) => {
      if (cancelled) return
      setError(err?.message || 'Failed to load TVL history')
    }

    const refresh = (force = false) => {
      if (typeof document !== 'undefined' && (document.hidden || !isAppActive())) return
      fetchSeries({ force })
        .then(apply)
        .catch(fail)
        .finally(() => { if (!cancelled) setLoading(false) })
    }

    // Don't flip loading back to true on subsequent visits when we already
    // have cached data - the user shouldn't see a spinner over real numbers.
    if (!_cache) setLoading(true)
    refresh(false)

    const onChange = () => { if (_cache) apply(_cache.series) }
    _subscribers.add(onChange)

    const intervalId = setInterval(() => refresh(true), POLL_INTERVAL)

    const onVis = () => {
      if (typeof document !== 'undefined' && !document.hidden) refresh(true)
    }
    const onFocus = () => refresh(true)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis)
    if (typeof window !== 'undefined') window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      clearInterval(intervalId)
      _subscribers.delete(onChange)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis)
      if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus)
    }
  }, [])

  const all = useMemo(() => compose(series, extras), [series, extrasKey])

  const windowed = useMemo(() => {
    if (!all.length) return []
    if (range === 'ALL') return all
    const days = RANGE_DAYS[range] || 90
    const cutoff = all[all.length - 1].ts - days * 86400
    return all.filter((p) => p.ts >= cutoff)
  }, [all, range])

  const stats = useMemo(() => {
    if (!windowed.length) return null
    const first = windowed[0]
    const last = windowed[windowed.length - 1]
    const min = windowed.reduce((m, p) => (p.tvl < m.tvl ? p : m), windowed[0])
    const max = windowed.reduce((m, p) => (p.tvl > m.tvl ? p : m), windowed[0])
    const change = first.tvl ? ((last.tvl - first.tvl) / first.tvl) * 100 : 0
    return { first, last, min, max, change, count: windowed.length, current: last.tvl }
  }, [windowed])

  return { points: windowed, all, loading, error, stats, range, extras }
}

export default useZIGTvlHistory
