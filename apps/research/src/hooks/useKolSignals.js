/**
 * useKolSignals — the hero "Smart Signals" convergence board.
 *
 * GET /api/kol/signals?scope=all|mine&window_hours=&min_kols=
 *   -> { signals:[ConvergenceSignal], generated_at_utc }
 *
 * ConvergenceSignal: { id, target, project, kols:[...], kol_count,
 *   first_followed_at, last_followed_at, window_hours, score, status,
 *   is_pre_push, first_mention_at|null, lead_time_hours|null }
 *
 * {data,loading,error} + 60s client cache + in-flight dedup + visibility-gated
 * adaptive polling (signals move slowly; default 90s when enabled).
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'

const CLIENT_CACHE = new Map()
const CLIENT_CACHE_TTL = 60000
const INFLIGHT = new Map()
const FETCH_TIMEOUT = 20000

function cacheKey(params) {
  return `kol-signals:${JSON.stringify(params)}`
}

function buildQuery(params) {
  const q = new URLSearchParams()
  q.set('scope', params.scope || 'all')
  q.set('window_hours', String(params.windowHours || 72))
  q.set('min_kols', String(params.minKols || 2))
  return q.toString()
}

export function useKolSignals(params = {}, hookOptions = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const paramsRef = useRef(params)
  const dataRef = useRef(null)

  const fetchSignals = useCallback(async (fetchParams, requestOptions = {}) => {
    const key = cacheKey(fetchParams)
    const bypass = requestOptions.bypassCache === true
    const background = requestOptions.background === true
    if (bypass) CLIENT_CACHE.delete(key)

    const cached = bypass ? null : CLIENT_CACHE.get(key)
    if (cached && Date.now() - cached.ts < CLIENT_CACHE_TTL) {
      dataRef.current = cached.data
      setData(cached.data)
      setLoading(false)
      return
    }

    if (INFLIGHT.has(key)) {
      try {
        const result = await INFLIGHT.get(key)
        dataRef.current = result
        setData(result)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
      return
    }

    if (!background || !dataRef.current) setLoading(true)
    setError(null)

    const promise = fetch(`/api/kol/signals?${buildQuery(fetchParams)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Smart signals unavailable')
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
      dataRef.current = result
      setData(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    paramsRef.current = params
    fetchSignals(params)
  }, [params.scope, params.windowHours, params.minKols, fetchSignals])

  const refetch = useCallback((opts = {}) => {
    fetchSignals(paramsRef.current, { bypassCache: true, ...opts })
  }, [fetchSignals])

  useAdaptivePolling(
    () => refetch({ background: true }),
    {
      interval: hookOptions.refreshIntervalMs || 90000,
      enabled: hookOptions.poll !== false,
    },
  )

  return { data, loading, error, refetch }
}

export default useKolSignals
