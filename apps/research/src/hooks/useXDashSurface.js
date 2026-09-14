import { useCallback, useEffect, useRef, useState } from 'react'
import { isAppActive } from '@/lib/idleManager'

const CLIENT_CACHE = new Map()
const INFLIGHT = new Map()
const FETCH_TIMEOUT = 25000
const DEFAULT_TTL = 60000
const MAX_CACHE_ENTRIES = 80

function pruneCache() {
  if (CLIENT_CACHE.size <= MAX_CACHE_ENTRIES) return
  const oldest = CLIENT_CACHE.keys().next().value
  if (oldest !== undefined) CLIENT_CACHE.delete(oldest)
}

// localStorage instant-paint seed (opt-in via hookOptions.persist) - same
// Wave-1 C1 pattern as useXDashBootstrap, for the small always-mounted
// surfaces (hero-strip narratives) that shimmer on every cold reload.
// No slimming: these payloads are a few KB. Read is skipped when the caller
// runs ttlMs:0 (cache-bypass semantics stay intact).
const SEED_PREFIX = 'spectre-xdash-surf-v1:'
const SEED_TTL_MS = 10 * 60 * 1000
const SEED_MAX_BYTES = 200_000
function seedGet(key) {
  try {
    const raw = localStorage.getItem(SEED_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.ts || Date.now() - parsed.ts > SEED_TTL_MS) return null
    return parsed.data || null
  } catch { return null }
}
function seedPut(key, data) {
  try {
    const raw = JSON.stringify({ ts: Date.now(), data })
    if (raw.length > SEED_MAX_BYTES) return
    try {
      localStorage.setItem(SEED_PREFIX + key, raw)
    } catch {
      // Quota: free only OUR stale keys and retry once, then give up silently.
      const now = Date.now()
      for (const k of Object.keys(localStorage)) {
        if (!k.startsWith(SEED_PREFIX)) continue
        try {
          const parsed = JSON.parse(localStorage.getItem(k) || 'null')
          if (!parsed?.ts || now - parsed.ts > SEED_TTL_MS) localStorage.removeItem(k)
        } catch { localStorage.removeItem(k) }
      }
      localStorage.setItem(SEED_PREFIX + key, raw)
    }
  } catch { /* quota / private mode - seed is best-effort */ }
}

function buildQuery(params = {}) {
  const query = new URLSearchParams()
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value == null || value === '') return
    const apiKey = key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)
    query.set(apiKey, String(value))
  })
  const qs = query.toString()
  return qs ? `?${qs}` : ''
}

export function useXDashSurface(path, params = {}, hookOptions = {}) {
  const enabled = hookOptions.enabled !== false && Boolean(path)
  const ttlMs = hookOptions.ttlMs ?? DEFAULT_TTL
  const paramsKey = JSON.stringify(params || {})
  const cacheKey = `${path}:${paramsKey}`

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(enabled)
  // Sticky until a fetch SUCCEEDS - clearing at fetch start made auto-retries
  // flip the view error -> shimmer -> error (outage flicker). errorRef mirrors
  // the value so fetchSurface can read it without a stale closure.
  const [error, setError] = useState(null)
  const errorRef = useRef(null)
  const setErrorState = useCallback((message) => {
    errorRef.current = message
    setError(message)
  }, [])
  const dataRef = useRef(null)
  const pathRef = useRef(path)
  const paramsRef = useRef(params)
  // Static per mount site - captured once so fetchSurface deps stay stable.
  const persistRef = useRef(hookOptions.persist === true)

  const setDataState = useCallback((nextData) => {
    dataRef.current = nextData
    setData(nextData)
    setErrorState(null)
  }, [setErrorState])

  const fetchSurface = useCallback(async (nextPath, nextParams, requestOptions = {}) => {
    if (!nextPath || hookOptions.enabled === false) {
      setDataState(null)
      setLoading(false)
      return
    }

    const nextKey = `${nextPath}:${JSON.stringify(nextParams || {})}`
    const shouldBypassCache = requestOptions.bypassCache === true || ttlMs === 0
    const isBackgroundRefresh = requestOptions.background === true

    if (shouldBypassCache) CLIENT_CACHE.delete(nextKey)

    const cached = shouldBypassCache ? null : CLIENT_CACHE.get(nextKey)
    if (cached && Date.now() - cached.ts < ttlMs) {
      setDataState(cached.data)
      setLoading(false)
      return
    }

    // Instant-paint: paint the persisted snapshot on a cold mount, then fall
    // through to the network fetch which revalidates it (no shimmer flash).
    let seededNow = false
    if (persistRef.current && !shouldBypassCache && !dataRef.current) {
      const seed = seedGet(nextKey)
      if (seed) {
        setDataState(seed)
        setLoading(false)
        seededNow = true
      }
    }

    if (INFLIGHT.has(nextKey)) {
      try {
        const result = await INFLIGHT.get(nextKey)
        setDataState(result)
      } catch (e) {
        setErrorState(e.message)
      } finally {
        setLoading(false)
      }
      return
    }

    // While the error panel is up, retries must not flip loading back on -
    // the panel IS the loading state during an outage.
    if ((!isBackgroundRefresh || !dataRef.current) && !errorRef.current && !seededNow) setLoading(true)

    // credentials:'include' - the iOS standalone PWA drops the HttpOnly gate
    // cookie on same-origin-default fetches (useInsight lesson, PR #1064).
    const promise = fetch(`${nextPath}${buildQuery(nextParams)}`, {
      credentials: 'include',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
      .then(async (res) => {
        // Defensive parse: a killed/timed-out serverless fn returns a non-JSON
        // gateway page (HTML 5xx). Raw res.json() would throw a cryptic
        // SyntaxError; read text then JSON.parse so every X Dash view degrades
        // to a clean error/last-good state instead. The HTTP-200 degraded
        // envelope { data:null, status:'degraded' } parses fine and flows through.
        const text = await res.text()
        let json = null
        try { json = text ? JSON.parse(text) : null } catch { /* non-JSON gateway page */ }
        if (!res.ok || json == null) throw new Error('X Dash surface unavailable')
        return json
      })
      .then((result) => {
        pruneCache()
        if (ttlMs > 0) CLIENT_CACHE.set(nextKey, { data: result, ts: Date.now() })
        if (persistRef.current && ttlMs > 0) seedPut(nextKey, result)
        INFLIGHT.delete(nextKey)
        return result
      })
      .catch((err) => {
        INFLIGHT.delete(nextKey)
        throw err
      })

    INFLIGHT.set(nextKey, promise)

    try {
      const result = await promise
      setDataState(result)
    } catch (e) {
      setErrorState(e.message)
    } finally {
      setLoading(false)
    }
  }, [hookOptions.enabled, setDataState, setErrorState, ttlMs])

  useEffect(() => {
    pathRef.current = path
    paramsRef.current = params
    fetchSurface(path, params)
  }, [path, paramsKey, fetchSurface])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const refetch = useCallback((requestOptions = {}) => {
    fetchSurface(pathRef.current, paramsRef.current, {
      bypassCache: true,
      ...requestOptions,
    })
  }, [fetchSurface])

  useEffect(() => {
    const refreshIntervalMs = hookOptions.refreshIntervalMs || 0
    const refreshOnFocus = hookOptions.refreshOnFocus === true
    if (!enabled || (!refreshIntervalMs && !refreshOnFocus)) return undefined

    const refresh = () => {
      // Cost defense: skip the poll when the tab is hidden OR the user is idle
      // (>5min no input). Matches the bootstrap / watchlist guard. This is the
      // always-mounted hero ticker surface, so it has the highest reach.
      if (typeof document !== 'undefined' && document.hidden) return
      if (!isAppActive()) return
      refetch({ background: true })
    }

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        refetch({ background: true })
      }
    }

    const handleWindowFocus = () => {
      refetch({ background: true })
    }

    let intervalId
    if (refreshIntervalMs > 0) {
      intervalId = window.setInterval(refresh, refreshIntervalMs)
    }

    if (refreshOnFocus && typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
      window.addEventListener('focus', handleWindowFocus)
    }

    return () => {
      if (intervalId) window.clearInterval(intervalId)
      if (refreshOnFocus && typeof window !== 'undefined' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        window.removeEventListener('focus', handleWindowFocus)
      }
    }
  }, [enabled, hookOptions.refreshIntervalMs, hookOptions.refreshOnFocus, refetch])

  return { data, loading, error, refetch }
}
