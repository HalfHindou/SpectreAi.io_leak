import { useState, useEffect, useCallback, useRef } from 'react'
import { isAppActive } from '@/lib/idleManager'

const CLIENT_CACHE = new Map()
const CLIENT_CACHE_TTL = 120000
const INFLIGHT = new Map()
const FETCH_TIMEOUT = 15000

function getCacheKey(mode, params) {
  return `cat:${mode}:${JSON.stringify(params)}`
}

export function useXDashCategories(mode = 'chatter', params = {}, hookOptions = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const modeRef = useRef(mode)
  const paramsRef = useRef(params)
  const dataRef = useRef(null)

  const setDataState = useCallback((nextData) => {
    dataRef.current = nextData
    setData(nextData)
  }, [])

  const fetchCategories = useCallback(async (fetchMode, fetchParams, requestOptions = {}) => {
    const key = getCacheKey(fetchMode, fetchParams)
    const shouldBypassCache = requestOptions.bypassCache === true
    const isBackgroundRefresh = requestOptions.background === true

    if (shouldBypassCache) {
      CLIENT_CACHE.delete(key)
    }

    // Client cache check
    const cached = shouldBypassCache ? null : CLIENT_CACHE.get(key)
    if (cached && Date.now() - cached.ts < CLIENT_CACHE_TTL) {
      setDataState(cached.data)
      setLoading(false)
      return
    }

    // Deduplicate
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

    const endpoint = fetchMode === 'momentum' ? 'category-momentum' : 'category-chatter'
    const query = new URLSearchParams({
      page: fetchParams.page || '1',
      per_page: fetchParams.perPage || '8',
      timeframe: fetchParams.timeframe || '24h',
      category_scope: fetchParams.categoryScope || 'primary',
    })

    const promise = fetch(`/api/xdash/${endpoint}?${query}`, { credentials: 'include',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
      .then(res => {
        if (!res.ok) throw new Error('Category data unavailable')
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
    modeRef.current = mode
    paramsRef.current = params
    fetchCategories(mode, params)
  }, [mode, params.page, params.perPage, params.timeframe, params.categoryScope, fetchCategories])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const refetch = useCallback((requestOptions = {}) => {
    fetchCategories(modeRef.current, paramsRef.current, {
      bypassCache: true,
      ...requestOptions,
    })
  }, [fetchCategories])

  useEffect(() => {
    const refreshIntervalMs = hookOptions.refreshIntervalMs || 0
    const refreshOnFocus = hookOptions.refreshOnFocus === true
    if (!refreshIntervalMs && !refreshOnFocus) return undefined

    const refresh = () => {
      // Cost defense: skip the poll when the tab is hidden OR the user is idle.
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
  }, [hookOptions.refreshIntervalMs, hookOptions.refreshOnFocus, refetch])

  return { data, loading, error, refetch }
}
