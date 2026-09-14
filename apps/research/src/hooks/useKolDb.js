/**
 * useKolDb — the Giga KOL DB grid feed.
 *
 * GET /api/kol/db?q=&tier=&narrative=&sort=&page=&per_page=
 *   -> { kols:[KolRow], pagination:{page,per_page,page_count,filtered_count,returned_count}, generated_at_utc }
 *
 * Mirrors the useXDashBootstrap contract: {data,loading,error} + module-level
 * client cache (60s TTL) + in-flight dedup + a stable cache key over the query
 * params, plus a refetch(). Visibility-gated polling is opt-in via hookOptions
 * (the page leaves it off — the DB is browsed, not streamed).
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { isAppActive } from '@/lib/idleManager'

const CLIENT_CACHE = new Map()
const CLIENT_CACHE_TTL = 60000
const INFLIGHT = new Map()
const FETCH_TIMEOUT = 20000

function cacheKey(params) {
  return `kol-db:${JSON.stringify(params)}`
}

function buildQuery(params) {
  const q = new URLSearchParams()
  if (params.q) q.set('q', params.q)
  if (params.tier && params.tier !== 'all') q.set('tier', params.tier)
  if (params.narrative && params.narrative !== 'all') q.set('narrative', params.narrative)
  q.set('sort', params.sort || 'influence')
  q.set('page', String(params.page || 1))
  q.set('per_page', String(params.perPage || 30))
  return q.toString()
}

export function useKolDb(params = {}, hookOptions = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const paramsRef = useRef(params)
  const dataRef = useRef(null)

  const fetchDb = useCallback(async (fetchParams, requestOptions = {}) => {
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

    const promise = fetch(`/api/kol/db?${buildQuery(fetchParams)}`, { credentials: 'include',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
      .then((res) => {
        if (!res.ok) throw new Error('KOL database unavailable')
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
    fetchDb(params)
  }, [
    params.q, params.tier, params.narrative, params.sort,
    params.page, params.perPage, fetchDb,
  ])

  const refetch = useCallback((opts = {}) => {
    fetchDb(paramsRef.current, { bypassCache: true, ...opts })
  }, [fetchDb])

  useEffect(() => {
    const ms = hookOptions.refreshIntervalMs || 0
    if (!ms) return undefined
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      if (!isAppActive()) return
      refetch({ background: true })
    }
    const id = window.setInterval(tick, ms)
    return () => window.clearInterval(id)
  }, [hookOptions.refreshIntervalMs, refetch])

  return { data, loading, error, refetch }
}

export default useKolDb
