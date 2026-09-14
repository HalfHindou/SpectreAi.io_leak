import { useState, useEffect, useCallback, useRef } from 'react'
import { isAppActive } from '@/lib/idleManager'

const CLIENT_CACHE = new Map()
const CLIENT_CACHE_TTL = 30000
const INFLIGHT = new Map()
const FETCH_TIMEOUT = 15000
const MAX_CACHE_ENTRIES = 60

function getCacheKey(authorId, opts) {
  return `author:${authorId}:${JSON.stringify({
    identityHistoryLimit: opts?.identityHistoryLimit || 0,
    profileHistoryLimit: opts?.profileHistoryLimit || 0,
    includeIntel: opts?.includeIntel === false ? 0 : 1,
  })}`
}

function pruneCache() {
  if (CLIENT_CACHE.size <= MAX_CACHE_ENTRIES) return
  const oldest = CLIENT_CACHE.keys().next().value
  if (oldest !== undefined) CLIENT_CACHE.delete(oldest)
}

function buildQuery(fetchOpts = {}) {
  const query = new URLSearchParams()
  if (fetchOpts.identityHistoryLimit) query.set('identity_history_limit', String(fetchOpts.identityHistoryLimit))
  if (fetchOpts.profileHistoryLimit) query.set('profile_history_limit', String(fetchOpts.profileHistoryLimit))
  const qs = query.toString()
  return qs ? `?${qs}` : ''
}

async function fetchAuthorRequest(authorId, fetchOpts = {}, requestOptions = {}) {
  if (!authorId) return null

  const key = getCacheKey(authorId, fetchOpts)
  const shouldBypassCache = requestOptions.bypassCache === true

  if (shouldBypassCache) {
    CLIENT_CACHE.delete(key)
  } else {
    const cached = CLIENT_CACHE.get(key)
    if (cached && Date.now() - cached.ts < CLIENT_CACHE_TTL) {
      return cached.data
    }
  }

  if (INFLIGHT.has(key)) {
    return INFLIGHT.get(key)
  }

  const authorRequest = fetch(`/api/xdash/author/${encodeURIComponent(authorId)}${buildQuery(fetchOpts)}`, { credentials: 'include',
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })
    .then((res) => {
      if (!res.ok) throw new Error('Creator detail unavailable')
      return res.json()
    })

  const intelRequest = fetchOpts.includeIntel === false
    ? Promise.resolve(null)
    : fetch(`/api/xdash/intel/author/${encodeURIComponent(authorId)}`, { credentials: 'include',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)

  const promise = Promise.all([authorRequest, intelRequest])
    .then(([authorResult, intelResult]) => {
      const result = intelResult
        ? {
          ...authorResult,
          author: {
            ...(authorResult?.author || {}),
            ...(intelResult?.author || {}),
          },
          history: authorResult?.history || intelResult?.history || null,
          intelligence: intelResult,
          intel: intelResult,
        }
        : authorResult
      pruneCache()
      CLIENT_CACHE.set(key, { data: result, ts: Date.now() })
      INFLIGHT.delete(key)
      return result
    })
    .catch((err) => {
      INFLIGHT.delete(key)
      throw err
    })

  INFLIGHT.set(key, promise)
  return promise
}

export function prefetchXDashAuthor(authorId, opts = {}) {
  return fetchAuthorRequest(authorId, opts).catch(() => null)
}

export function useXDashAuthor(authorId, opts = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(Boolean(authorId))
  const [error, setError] = useState(null)
  const authorIdRef = useRef(authorId)
  const optsRef = useRef(opts)
  const dataRef = useRef(null)

  const setDataState = useCallback((nextData) => {
    dataRef.current = nextData
    setData(nextData)
  }, [])

  const fetchAuthor = useCallback(async (id, fetchOpts, requestOptions = {}) => {
    if (!id) {
      setDataState(null)
      setLoading(false)
      setError(null)
      return
    }

    const isBackgroundRefresh = requestOptions.background === true

    if (!isBackgroundRefresh || !dataRef.current) {
      setLoading(true)
    }
    setError(null)

    try {
      const result = await fetchAuthorRequest(id, fetchOpts, requestOptions)
      setDataState(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [setDataState])

  useEffect(() => {
    authorIdRef.current = authorId
    optsRef.current = opts
    fetchAuthor(authorId, opts)
  }, [authorId, opts?.identityHistoryLimit, opts?.profileHistoryLimit, opts?.includeIntel, fetchAuthor])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const refetch = useCallback((requestOptions = {}) => {
    fetchAuthor(authorIdRef.current, optsRef.current, {
      bypassCache: true,
      ...requestOptions,
    })
  }, [fetchAuthor])

  useEffect(() => {
    const refreshIntervalMs = opts.refreshIntervalMs || 0
    const refreshOnFocus = opts.refreshOnFocus === true
    if (!authorId || (!refreshIntervalMs && !refreshOnFocus)) return undefined

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
  }, [authorId, opts.refreshIntervalMs, opts.refreshOnFocus, refetch])

  return { data, loading, error, refetch }
}
