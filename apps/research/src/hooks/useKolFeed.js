/**
 * useKolFeed — the live "New Follows" feed.
 *
 * GET /api/kol/feed?scope=all|mine&since=&page=&per_page=
 *   -> { events:[FollowEvent], pagination } (newest first)
 *
 * FollowEvent: { id, kol:{screen_name,name,avatar_url}, target:Account,
 *   followed_at, is_project, project|null }
 *
 * {data,loading,error} + 45s client cache + in-flight dedup + visibility-gated
 * adaptive polling (default 60s when enabled).
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'

const CLIENT_CACHE = new Map()
const CLIENT_CACHE_TTL = 45000
const INFLIGHT = new Map()
const FETCH_TIMEOUT = 20000

function cacheKey(params) {
  return `kol-feed:${JSON.stringify(params)}`
}

function buildQuery(params) {
  const q = new URLSearchParams()
  q.set('scope', params.scope || 'all')
  q.set('page', String(params.page || 1))
  q.set('per_page', String(params.perPage || 40))
  if (params.since) q.set('since', params.since)
  return q.toString()
}

export function useKolFeed(params = {}, hookOptions = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const paramsRef = useRef(params)
  const dataRef = useRef(null)

  const fetchFeed = useCallback(async (fetchParams, requestOptions = {}) => {
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

    const promise = fetch(`/api/kol/feed?${buildQuery(fetchParams)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Follow feed unavailable')
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
    fetchFeed(params)
  }, [params.scope, params.page, params.perPage, params.since, fetchFeed])

  const refetch = useCallback((opts = {}) => {
    fetchFeed(paramsRef.current, { bypassCache: true, ...opts })
  }, [fetchFeed])

  useAdaptivePolling(
    () => refetch({ background: true }),
    {
      interval: hookOptions.refreshIntervalMs || 60000,
      enabled: hookOptions.poll !== false,
    },
  )

  return { data, loading, error, refetch }
}

export default useKolFeed
