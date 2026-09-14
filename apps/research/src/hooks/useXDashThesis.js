/**
 * useXDashThesis — fetches the "Social Market Read" thesis for the X Dash page.
 *
 * Backend contract (Spectre Data API /v1/social/thesis, proxied via
 * /api/xdash/thesis?scope=general|24h|combined):
 *   {
 *     generated_at, reference_now, stale?,
 *     regime: { label, fear_greed, btc_dominance, summary },
 *     general_7d:    { headline, narrative, whats_working[], conviction_plays[],
 *                      froth_warnings[], sector_rotation[] },
 *     timeframed_24h:{ ...same shape... },
 *     proof: { pg_win_rate_pct, pg_sample, top_fresh[] },
 *     sources: [...]
 *   }
 *
 * Always pulls scope=combined (one round-trip) so the panel's general/24h
 * toggle can switch instantly between general_7d and timeframed_24h without a
 * refetch. Polls every ~5 min in the foreground; skips when the tab is hidden
 * or the user is idle (matches useXDashBootstrap's cost-defense pattern).
 *
 * Returns an object (never an array), per the house hook convention.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { isAppActive } from '@/lib/idleManager'

const CLIENT_CACHE = new Map()
const CLIENT_CACHE_TTL = 300_000 // 5 min — matches the proxy s-maxage
const INFLIGHT = new Map()
const FETCH_TIMEOUT = 25_000
const POLL_INTERVAL_MS = 300_000 // ~5 min

export function useXDashThesis(scope = 'combined') {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const dataRef = useRef(null)
  const scopeRef = useRef(scope)

  const setDataState = useCallback((next) => {
    dataRef.current = next
    setData(next)
  }, [])

  const fetchThesis = useCallback(async (fetchScope, requestOptions = {}) => {
    const key = `thesis:${fetchScope}`
    const bypass = requestOptions.bypassCache === true
    const isBackground = requestOptions.background === true

    if (bypass) CLIENT_CACHE.delete(key)

    const cached = bypass ? null : CLIENT_CACHE.get(key)
    if (cached && Date.now() - cached.ts < CLIENT_CACHE_TTL) {
      setDataState(cached.data)
      setLoading(false)
      return
    }

    if (INFLIGHT.has(key)) {
      try {
        const result = await INFLIGHT.get(key)
        setDataState(result)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
      return
    }

    if (!isBackground || !dataRef.current) setLoading(true)
    setError(null)

    const promise = fetch(`/api/xdash/thesis?scope=${encodeURIComponent(fetchScope)}`, { credentials: 'include',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Social market read unavailable')
        return res.json()
      })
      .then((result) => {
        CLIENT_CACHE.set(key, { data: result, ts: Date.now() })
        INFLIGHT.delete(key)
        return result
      })
      .catch((err) => {
        INFLIGHT.delete(key)
        throw err
      })

    INFLIGHT.set(key, promise)

    try {
      const result = await promise
      setDataState(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [setDataState])

  useEffect(() => {
    scopeRef.current = scope
    fetchThesis(scope)
  }, [scope, fetchThesis])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const refetch = useCallback((requestOptions = {}) => {
    fetchThesis(scopeRef.current, { bypassCache: true, ...requestOptions })
  }, [fetchThesis])

  // Foreground polling — skip when backgrounded or idle (cost defense).
  useEffect(() => {
    const refresh = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      if (!isAppActive()) return
      refetch({ background: true })
    }
    const intervalId = window.setInterval(refresh, POLL_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [refetch])

  // Derived: backend may mark stale, or the fallback shape carries stale:true.
  const stale = Boolean(data?.stale) || Boolean(data?._source === 'fallback')

  return { data, loading, error, stale, refetch }
}

export default useXDashThesis
