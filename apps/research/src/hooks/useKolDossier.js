/**
 * useKolDossier — the KOL dossier drawer feed.
 *
 * GET /api/kol/:handle
 *   -> { kol:KolRow, recent_follows:[FollowEvent], pushes:[...],
 *        following_sample:[Account], stats:{following_tracked,new_follows_7d,projects_followed} }
 *
 * {data,loading,error} + refetch. 60s client cache + in-flight dedup. Fetches
 * only when a handle is open (drawer URL-driven by the view), so no polling.
 */
import { useState, useEffect, useCallback, useRef } from 'react'

const CLIENT_CACHE = new Map()
const CLIENT_CACHE_TTL = 60000
const INFLIGHT = new Map()
const FETCH_TIMEOUT = 20000

function cacheKey(handle) {
  return `kol-dossier:${String(handle || '').toLowerCase()}`
}

export function useKolDossier(handle) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(Boolean(handle))
  const [error, setError] = useState(null)
  const handleRef = useRef(handle)
  const dataRef = useRef(null)

  const fetchDossier = useCallback(async (target, requestOptions = {}) => {
    if (!target) {
      setData(null)
      dataRef.current = null
      setLoading(false)
      return
    }
    const key = cacheKey(target)
    const bypass = requestOptions.bypassCache === true
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

    if (!dataRef.current) setLoading(true)
    setError(null)

    const promise = fetch(`/api/kol/${encodeURIComponent(target)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Dossier unavailable')
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
    handleRef.current = handle
    dataRef.current = null
    if (handle) {
      setData(null)
      fetchDossier(handle)
    } else {
      setData(null)
      setLoading(false)
    }
  }, [handle, fetchDossier])

  const refetch = useCallback(() => {
    fetchDossier(handleRef.current, { bypassCache: true })
  }, [fetchDossier])

  return { data, loading, error, refetch }
}

export default useKolDossier
