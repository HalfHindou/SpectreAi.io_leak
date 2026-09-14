/*
 * useMomentumData - data hooks for the Potential Gainers premium surface.
 *
 * Four SWR-style hooks, modelled on useXDashSurface:
 *   useMomentumSetups       -> GET /api/momentum/setups          (current board)
 *   useMomentumReceipts     -> GET /api/momentum/setups/receipts (timestamped proof)
 *   useMomentumPerformance  -> GET /api/momentum/setups/performance (WR tracker)
 *   useMomentumHistory      -> GET /api/momentum/setups/history   (hourly snapshots)
 *
 * Each returns { data, loading, error, refetch } - an object, never an array.
 * Shared infra: a module-level TTL cache, in-flight dedup, a generation
 * stale-guard so a fast filter switch never lets an old response overwrite a
 * newer one, and optional refresh-on-focus / refresh-interval.
 *
 * The upstream lives at /api/momentum/* (NOT /api/xdash/*). In dev the
 * dedicated /api/momentum Vite proxy hits the dashboard API directly; in
 * prod vercel.json rewrites /api/momentum/* to the social-api function.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { isAppActive } from '@/lib/idleManager'

const CLIENT_CACHE = new Map()
const INFLIGHT = new Map()
const FETCH_TIMEOUT = 16000
const MAX_CACHE_ENTRIES = 60

function pruneCache() {
  if (CLIENT_CACHE.size <= MAX_CACHE_ENTRIES) return
  const oldest = CLIENT_CACHE.keys().next().value
  if (oldest !== undefined) CLIENT_CACHE.delete(oldest)
}

// localStorage write-through seed (10-min TTL) for the board surfaces. The
// module CLIENT_CACHE is memory-only, so a cold reload shimmered the whole
// Potential Gainers board even though a 10-min-old snapshot would paint fine.
// Opt-in via { persist: true }; we hydrate the snapshot instantly, then
// revalidate in the background per the normal TTL. All access is try/catch
// (quota / private-mode safe). Mirrors the C1 fetchBaseJson seed.
const PERSIST_PREFIX = 'spectre-momentum-v1:'
const PERSIST_TTL = 10 * 60 * 1000 // 10min

function persistLoad(key) {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(`${PERSIST_PREFIX}${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.ts !== 'number') return null
    if (Date.now() - parsed.ts > PERSIST_TTL) return null
    return parsed.data
  } catch {
    return null
  }
}

function persistSave(key, data) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(`${PERSIST_PREFIX}${key}`, JSON.stringify({ data, ts: Date.now() }))
  } catch {
    // quota exceeded / private mode - silently ignore
  }
}

function buildQuery(params = {}) {
  const query = new URLSearchParams()
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value == null || value === '') return
    query.set(key, String(value))
  })
  const qs = query.toString()
  return qs ? `?${qs}` : ''
}

/*
 * Generic momentum surface hook. `path` is the API path, `params` the query
 * object, `ttlMs` the client cache window. Consumers below are thin wrappers
 * that pin the path + sensible defaults.
 */
function useMomentumSurface(path, params, hookOptions = {}) {
  const enabled = hookOptions.enabled !== false && Boolean(path)
  const ttlMs = hookOptions.ttlMs ?? 60000
  const persist = hookOptions.persist === true
  const paramsKey = JSON.stringify(params || {})

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState(null)

  const dataRef = useRef(null)
  const pathRef = useRef(path)
  const paramsRef = useRef(params)
  const genRef = useRef(0)

  const setDataState = useCallback((next) => {
    dataRef.current = next
    setData(next)
  }, [])

  const fetchSurface = useCallback(async (nextPath, nextParams, requestOptions = {}) => {
    if (!nextPath || hookOptions.enabled === false) {
      setDataState(null)
      setLoading(false)
      setError(null)
      return
    }

    const key = `${nextPath}:${JSON.stringify(nextParams || {})}`
    const bypassCache = requestOptions.bypassCache === true || ttlMs === 0
    const isBackground = requestOptions.background === true
    const gen = genRef.current
    const isCurrent = () => gen === genRef.current

    if (bypassCache) CLIENT_CACHE.delete(key)

    const cached = bypassCache ? null : CLIENT_CACHE.get(key)
    if (cached && Date.now() - cached.ts < ttlMs) {
      if (isCurrent()) {
        setDataState(cached.data)
        setLoading(false)
      }
      return
    }

    if (INFLIGHT.has(key)) {
      try {
        const result = await INFLIGHT.get(key)
        if (isCurrent()) setDataState(result)
      } catch (e) {
        if (isCurrent()) setError(e.message)
      } finally {
        if (isCurrent()) setLoading(false)
      }
      return
    }

    // Instant-paint: hydrate a fresh-enough localStorage snapshot while the
    // network revalidates. Paints the board immediately on cold reload.
    let seeded = false
    if (persist && !bypassCache && !dataRef.current) {
      const seed = persistLoad(key)
      if (seed && isCurrent()) {
        setDataState(seed)
        setLoading(false)
        seeded = true
      }
    }

    if (isCurrent() && !seeded && (!isBackground || !dataRef.current)) setLoading(true)
    if (isCurrent()) setError(null)

    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const url = `${nextPath}${buildQuery(nextParams)}`
    const promise = fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
      .then((res) => {
        if (!res.ok) throw new Error('Momentum surface unavailable')
        return res.json()
      })
      .then((result) => {
        pruneCache()
        if (ttlMs > 0) CLIENT_CACHE.set(key, { data: result, ts: Date.now() })
        if (persist) persistSave(key, result)
        INFLIGHT.delete(key)
        return result
      })
      .catch((err) => {
        INFLIGHT.delete(key)
        const dur = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)
        console.error('[momentum] fetch failed', {
          endpoint: url,
          errorName: err?.name || 'Error',
          errorMessage: err?.message || '',
          durationMs: dur,
        })
        throw err
      })

    INFLIGHT.set(key, promise)

    try {
      const result = await promise
      if (isCurrent()) setDataState(result)
    } catch (e) {
      if (isCurrent()) setError(e.message)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [hookOptions.enabled, setDataState, ttlMs, persist])

  useEffect(() => {
    pathRef.current = path
    paramsRef.current = params
    genRef.current += 1
    fetchSurface(path, params)
    return () => {
      genRef.current += 1
    }
  }, [path, paramsKey, fetchSurface])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const refetch = useCallback((requestOptions = {}) => {
    fetchSurface(pathRef.current, paramsRef.current, { bypassCache: true, ...requestOptions })
  }, [fetchSurface])

  useEffect(() => {
    const refreshIntervalMs = hookOptions.refreshIntervalMs || 0
    const refreshOnFocus = hookOptions.refreshOnFocus === true
    if (!enabled || (!refreshIntervalMs && !refreshOnFocus)) return undefined

    const refresh = () => {
      // Skip background polls on a hidden OR visible-but-abandoned tab (5min idle).
      if (typeof document !== 'undefined' && document.hidden) return
      if (!isAppActive()) return
      refetch({ background: true })
    }
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) refetch({ background: true })
    }

    let intervalId
    if (refreshIntervalMs > 0) intervalId = window.setInterval(refresh, refreshIntervalMs)
    if (refreshOnFocus && typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility)
      window.addEventListener('focus', handleVisibility)
    }
    return () => {
      if (intervalId) window.clearInterval(intervalId)
      if (refreshOnFocus && typeof window !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility)
        window.removeEventListener('focus', handleVisibility)
      }
    }
  }, [enabled, hookOptions.refreshIntervalMs, hookOptions.refreshOnFocus, refetch])

  return { data, loading, error, refetch }
}

/*
 * The current Potential Gainers board + headline performance proof.
 * timeframe: '7d' (default) | '24h'. limit max 20.
 */
export function useMomentumSetups({
  timeframe = '7d',
  limit = 10,
  scanLimit = 500,
  includeReversals = false,
  enabled = true,
} = {}) {
  return useMomentumSurface(
    '/api/momentum/setups',
    {
      timeframe,
      limit,
      scan_limit: scanLimit,
      include_reversals: includeReversals ? 'true' : 'false',
      include_performance: 'true',
    },
    { enabled, ttlMs: 60000, refreshIntervalMs: 120000, refreshOnFocus: true, persist: true },
  )
}

/*
 * The persistent Potential Gainers signal board. Unlike useMomentumSetups
 * (the hourly ranked snapshot), this carries EVERY PG signal forward with a
 * lifecycle phase - fresh / developing / runner / already_ran /
 * matured_positive / stalled / drawdown - each tracked from its first PG
 * timestamp (signal mcap, current mcap, return + peak since signal).
 * Signals land under data.tokens; phase tallies under data.phase_counts.
 */
export function useMomentumSignals({
  timeframe = '7d',
  bucket = 'top10',
  watchDays = 10,
  limit = 50,
  enabled = true,
} = {}) {
  return useMomentumSurface(
    '/api/momentum/setups/signals',
    { timeframe, bucket, watch_days: watchDays, limit },
    { enabled, ttlMs: 60000, refreshIntervalMs: 120000, refreshOnFocus: true, persist: true },
  )
}

/*
 * Daily win-rate / PnL tracker - the performance-proof module. Daily rows
 * land under data.rows (NOT data.performance).
 */
export function useMomentumPerformance({
  timeframe = '7d',
  days = 21,
  model = 'daily_unique',
  enabled = true,
} = {}) {
  return useMomentumSurface(
    '/api/momentum/setups/performance',
    { timeframe, days, model },
    { enabled, ttlMs: 300000, refreshOnFocus: true },
  )
}

/*
 * Timestamped receipts - the "Called Before The Move" trust layer. Each
 * receipt is a token's FIRST-EVER Potential Gainers appearance plus the
 * returns measured ONLY after that first appearance. Receipts land under
 * data.receipts. This is the page's primary proof surface, so it is NOT
 * gated - free users see it too.
 */
export function useMomentumReceipts({
  timeframe = '7d',
  days = 21,
  bucket = 'top10',
  model = 'first_ever',
  limit = 50,
  enabled = true,
} = {}) {
  return useMomentumSurface(
    '/api/momentum/setups/receipts',
    { timeframe, days, bucket, model, limit },
    { enabled, ttlMs: 300000, refreshOnFocus: true },
  )
}

/*
 * Hourly snapshot history - the "previous calls" board. Snapshots land under
 * data.snapshots, each { snapshot_at, tokens }.
 */
export function useMomentumHistory({
  timeframe = '7d',
  days = 21,
  bucket = 'top10',
  limitSnapshots = 48,
  enabled = true,
} = {}) {
  return useMomentumSurface(
    '/api/momentum/setups/history',
    { timeframe, days, bucket, limit_snapshots: limitSnapshots },
    { enabled, ttlMs: 300000 },
  )
}
