import { useState, useEffect, useCallback, useRef } from 'react'
import { isAppActive } from '@/lib/idleManager'

const CLIENT_CACHE = new Map()
const CLIENT_CACHE_TTL = 30000
const INFLIGHT = new Map()
const FETCH_TIMEOUT = 15000
const MAX_CACHE_ENTRIES = 50

function getCacheKey(cgId, opts) {
  return [
    'token',
    cgId,
    opts.authorScope || '',
    opts.authorId || '',
    opts.timeframe || '',
    opts.page || '',
    opts.perPage || '',
    opts.force ? '1' : '0',
    opts.includeIntel === false ? 'raw' : 'intel',
  ].join(':')
}

function pruneCache() {
  if (CLIENT_CACHE.size <= MAX_CACHE_ENTRIES) return
  const oldest = CLIENT_CACHE.keys().next().value
  if (oldest !== undefined) CLIENT_CACHE.delete(oldest)
}

export function useXDashToken(cgId, opts = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(!!cgId)
  const [error, setError] = useState(null)
  const cgIdRef = useRef(cgId)
  const optsRef = useRef(opts)
  const dataRef = useRef(null)

  const setDataState = useCallback((nextData) => {
    dataRef.current = nextData
    setData(nextData)
  }, [])

  const fetchToken = useCallback(async (id, fetchOpts, requestOptions = {}) => {
    if (!id) {
      setDataState(null)
      setLoading(false)
      return
    }

    const key = getCacheKey(id, fetchOpts)
    const shouldBypassCache = requestOptions.bypassCache === true || fetchOpts.force
    const isBackgroundRefresh = requestOptions.background === true

    // Client cache check (skip if force refresh)
    if (!shouldBypassCache) {
      const cached = CLIENT_CACHE.get(key)
      if (cached && Date.now() - cached.ts < CLIENT_CACHE_TTL) {
        setDataState(cached.data)
        setLoading(false)
        return
      }
    } else {
      CLIENT_CACHE.delete(key)
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

    const queryParts = []
    if (fetchOpts.authorScope) queryParts.push(`author_scope=${encodeURIComponent(fetchOpts.authorScope)}`)
    if (fetchOpts.authorId) queryParts.push(`author_id=${encodeURIComponent(fetchOpts.authorId)}`)
    if (fetchOpts.timeframe) queryParts.push(`timeframe=${encodeURIComponent(fetchOpts.timeframe)}`)
    if (fetchOpts.page) queryParts.push(`page=${encodeURIComponent(fetchOpts.page)}`)
    if (fetchOpts.perPage) queryParts.push(`per_page=${encodeURIComponent(fetchOpts.perPage)}`)
    if (fetchOpts.force || requestOptions.force) queryParts.push('force=1')
    const qs = queryParts.length ? `?${queryParts.join('&')}` : ''
    const intelQs = fetchOpts.timeframe ? `?timeframe=${encodeURIComponent(fetchOpts.timeframe)}` : ''

    const includeIntel = fetchOpts.includeIntel !== false
    const tokenRequest = fetch(`/api/xdash/token/${encodeURIComponent(id)}${qs}`, { credentials: 'include',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
      .then(res => {
        if (!res.ok) throw new Error('Token social data unavailable')
        return res.json()
      })

    const intelRequest = includeIntel
      ? fetch(`/api/xdash/intel/token/${encodeURIComponent(id)}${intelQs}`, { credentials: 'include',
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      })
        .then(res => (res.ok ? res.json() : null))
        .catch(() => null)
      : Promise.resolve(null)

    const promise = Promise.all([tokenRequest, intelRequest])
      .then(([tokenResult, intelResult]) => {
        const result = intelResult
          ? {
            ...tokenResult,
            state: tokenResult?.state || intelResult?.current_state || {},
            intelligence: intelResult,
            intel: intelResult,
          }
          : tokenResult
        pruneCache()
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
    cgIdRef.current = cgId
    optsRef.current = opts
    fetchToken(cgId, opts)
  }, [cgId, opts.authorScope, opts.authorId, opts.timeframe, opts.page, opts.perPage, opts.force, opts.includeIntel, fetchToken])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const refetch = useCallback((requestOptions = {}) => {
    fetchToken(cgIdRef.current, optsRef.current, {
      bypassCache: true,
      ...requestOptions,
    })
  }, [fetchToken])

  useEffect(() => {
    const refreshIntervalMs = opts.refreshIntervalMs || 0
    const refreshOnFocus = opts.refreshOnFocus === true
    if (!cgId || (!refreshIntervalMs && !refreshOnFocus)) return undefined

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
  }, [cgId, opts.refreshIntervalMs, opts.refreshOnFocus, refetch])

  return { data, loading, error, refetch }
}
