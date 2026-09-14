import { useState, useEffect, useCallback, useRef } from 'react'
import { isAppActive } from '@/lib/idleManager'

const CLIENT_CACHE = new Map()
const CLIENT_CACHE_TTL = 60000
const INFLIGHT = new Map()
const FETCH_TIMEOUT = 15000

function getCacheKey(category, params) {
  return `cat-tokens:${category}:${JSON.stringify(params)}`
}

export function useXDashCategoryTokens(category, params = {}, hookOptions = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(!!category)
  const [error, setError] = useState(null)
  const categoryRef = useRef(category)
  const paramsRef = useRef(params)
  const dataRef = useRef(null)

  const setDataState = useCallback((nextData) => {
    dataRef.current = nextData
    setData(nextData)
  }, [])

  const fetchCategoryTokens = useCallback(async (cat, fetchParams, requestOptions = {}) => {
    if (!cat) {
      setDataState(null)
      setLoading(false)
      return
    }

    const key = getCacheKey(cat, fetchParams)
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

    const query = new URLSearchParams({
      category: cat,
      mode: fetchParams.mode || 'chatter',
      timeframe: fetchParams.timeframe || '24h',
      market: fetchParams.market || 'all',
      min_kols: fetchParams.minKols || '1',
      category_scope: fetchParams.categoryScope || 'primary',
      page: fetchParams.page || '1',
      per_page: fetchParams.perPage || '40',
    })

    const promise = fetch(`/api/xdash/category-tokens?${query}`, { credentials: 'include',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
      .then(res => {
        if (!res.ok) throw new Error('Category tokens unavailable')
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
    categoryRef.current = category
    paramsRef.current = params
    fetchCategoryTokens(category, params)
  }, [category, params.mode, params.timeframe, params.market, params.minKols, params.categoryScope, params.page, params.perPage, fetchCategoryTokens])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const refetch = useCallback((requestOptions = {}) => {
    fetchCategoryTokens(categoryRef.current, paramsRef.current, {
      bypassCache: true,
      ...requestOptions,
    })
  }, [fetchCategoryTokens])

  useEffect(() => {
    const refreshIntervalMs = hookOptions.refreshIntervalMs || 0
    const refreshOnFocus = hookOptions.refreshOnFocus === true
    if (!category || (!refreshIntervalMs && !refreshOnFocus)) return undefined

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
  }, [category, hookOptions.refreshIntervalMs, hookOptions.refreshOnFocus, refetch])

  return { data, loading, error, refetch }
}
