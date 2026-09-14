import { useState, useEffect, useCallback, useRef } from 'react'
import { isAppActive } from '@/lib/idleManager'

const CLIENT_CACHE = new Map()
const CLIENT_CACHE_TTL = 60000
const INFLIGHT = new Map()
const FETCH_TIMEOUT = 15000

function getCacheKey(params) {
  return `kols:${JSON.stringify(params || {})}`
}

export function useXDashCreators(params = null, hookOptions = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(Boolean(params))
  const [error, setError] = useState(null)
  const paramsRef = useRef(params)
  const dataRef = useRef(null)
  const setDataState = useCallback((nextData) => {
    dataRef.current = nextData
    setData(nextData)
  }, [])

  const fetchCreators = useCallback(async (fetchParams, requestOptions = {}) => {
    if (!fetchParams) {
      setDataState(null)
      setLoading(false)
      setError(null)
      return
    }

    const key = getCacheKey(fetchParams)
    const shouldBypassCache = requestOptions.bypassCache === true
    const isBackgroundRefresh = requestOptions.background === true
    if (shouldBypassCache) CLIENT_CACHE.delete(key)

    const cached = shouldBypassCache ? null : CLIENT_CACHE.get(key)
    if (cached && Date.now() - cached.ts < CLIENT_CACHE_TTL) {
      setDataState(cached.data)
      setLoading(false)
      return
    }

    if (INFLIGHT.has(key)) {
      try {
        const result = await INFLIGHT.get(key)
        setDataState(result)
        setLoading(false)
      } catch (e) {
        setError(e.message)
        setLoading(false)
      }
      return
    }

    if (!isBackgroundRefresh || !dataRef.current) {
      setLoading(true)
    }
    setError(null)

    const query = new URLSearchParams({
      page: fetchParams.page || '1',
      per_page: fetchParams.perPage || '12',
      timeframe: fetchParams.timeframe || '24h',
      sort: fetchParams.sort || 'activity',
    })
    if (fetchParams.query) query.set('query', fetchParams.query)

    const promise = fetch(`/api/xdash/kols?${query}`, { credentials: 'include',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
      .then(res => {
        if (!res.ok) throw new Error('Creator board unavailable')
        return res.json()
      })
      .then(result => {
        CLIENT_CACHE.set(key, { data: result, ts: Date.now() })
        INFLIGHT.delete(key)
        return result
      })
      .catch(err => {
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
    paramsRef.current = params
    fetchCreators(params)
  }, [params?.page, params?.perPage, params?.timeframe, params?.sort, params?.query, fetchCreators])

  const refetch = useCallback(() => {
    fetchCreators(paramsRef.current, { bypassCache: true })
  }, [fetchCreators])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  useEffect(() => {
    const refreshIntervalMs = hookOptions.refreshIntervalMs || 0
    const refreshOnFocus = hookOptions.refreshOnFocus === true
    if (!params || (!refreshIntervalMs && !refreshOnFocus)) return undefined

    const refresh = () => {
      // Cost defense: skip the poll when the tab is hidden OR the user is idle.
      if (typeof document !== 'undefined' && document.hidden) return
      if (!isAppActive()) return
      fetchCreators(paramsRef.current, { bypassCache: true, background: true })
    }

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        refresh()
      }
    }

    const handleWindowFocus = () => {
      refresh()
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
  }, [params, hookOptions.refreshIntervalMs, hookOptions.refreshOnFocus, fetchCreators])

  return { data, loading, error, refetch }
}
