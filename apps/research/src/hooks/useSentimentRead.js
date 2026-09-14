/**
 * useSentimentRead — client for the per-token AI sentiment read.
 *
 * GET /api/sentiment-read?symbol=&cgId= (tier3, gate cookie). Server caches
 * 20 min per asset with a 60s generation lock; a `pending: true` reply means
 * another instance is mid-generation, so we retry on a short backoff (max 5).
 *
 * credentials: 'include' is deliberate — on the iOS PWA the same-origin
 * default drops the HttpOnly gate cookie and the tier3 gate 401s a logged-in
 * user (the useInsight lesson, PR #1064).
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { isAppActive } from '@/lib/idleManager'

const CLIENT_CACHE = new Map()
const INFLIGHT = new Map()
const CLIENT_TTL = 5 * 60_000
const RETRY_MS = 4000
const MAX_RETRIES = 5

async function fetchRead(symbol, cgId, fresh = false) {
  const qs = new URLSearchParams({ symbol })
  if (cgId) qs.set('cgId', cgId)
  if (fresh) qs.set('fresh', '1')
  const r = await fetch(`/api/sentiment-read?${qs}`, {
    credentials: 'include',
    signal: AbortSignal.timeout(fresh ? 60_000 : 45_000),
  })
  if (!r.ok) throw new Error(`sentiment-read ${r.status}`)
  return r.json()
}

export default function useSentimentRead(symbol, cgId, { enabled = true } = {}) {
  const sym = String(symbol || '').toUpperCase()
  const [state, setState] = useState({ read: null, loading: !!(enabled && sym), error: null, cachedAt: null })
  const retriesRef = useRef(0)
  const timerRef = useRef(null)
  // keys whose background stale-revalidate has already fired this mount
  const refreshFiredRef = useRef(new Set())

  const load = useCallback(async (force = false) => {
    if (!sym) return
    const key = `${sym}:${cgId || ''}`

    if (!force) {
      const hit = CLIENT_CACHE.get(key)
      if (hit && Date.now() - hit.ts < CLIENT_TTL) {
        setState({ read: hit.read, loading: false, error: null, cachedAt: hit.ts })
        return
      }
    }

    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      let promise = INFLIGHT.get(key)
      if (!promise) {
        promise = fetchRead(sym, cgId)
        INFLIGHT.set(key, promise)
        promise.finally(() => INFLIGHT.delete(key))
      }
      const json = await promise

      if (json?.read?.thesis) {
        retriesRef.current = 0
        CLIENT_CACHE.set(key, { read: json.read, ts: Date.now() })
        setState({ read: json.read, loading: false, error: null, cachedAt: Date.now() })
        // Server served a last-good read instantly (stale-while-revalidate) —
        // regenerate in the background and swap in the fresh read when it
        // lands. Once per key per mount; skipped on hidden tabs.
        if (json.refresh && !refreshFiredRef.current.has(key)
          && !(typeof document !== 'undefined' && document.hidden)) {
          refreshFiredRef.current.add(key)
          fetchRead(sym, cgId, true)
            .then((j) => {
              if (!j?.read?.thesis) return
              CLIENT_CACHE.set(key, { read: j.read, ts: Date.now() })
              setState((s) => (s.read ? { ...s, read: j.read, cachedAt: Date.now() } : s))
            })
            .catch(() => {})
        }
        return
      }
      if (json?.pending && retriesRef.current < MAX_RETRIES) {
        retriesRef.current += 1
        timerRef.current = setTimeout(() => {
          if (typeof document !== 'undefined' && document.hidden) return
          load(true)
        }, RETRY_MS)
        return
      }
      setState({ read: null, loading: false, error: json?.error || 'unavailable', cachedAt: null })
    } catch (e) {
      setState({ read: null, loading: false, error: e.message || 'unavailable', cachedAt: null })
    }
  }, [sym, cgId])

  useEffect(() => {
    if (!enabled || !sym) {
      setState({ read: null, loading: false, error: null, cachedAt: null })
      return undefined
    }
    retriesRef.current = 0
    load()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [enabled, sym, cgId, load])

  const refetch = useCallback(() => {
    if (typeof document !== 'undefined' && document.hidden) return
    if (!isAppActive()) return
    retriesRef.current = 0
    // The Refresh button must force a TRUE regeneration (fresh=1) — a plain
    // re-fetch just returns the server's 20-min cache, so clicking it never
    // changed anything. Keep the current read on screen while it runs.
    const key = `${sym}:${cgId || ''}`
    setState((s) => ({ ...s, loading: true, error: null }))
    fetchRead(sym, cgId, true)
      .then((j) => {
        if (j?.read?.thesis) {
          CLIENT_CACHE.set(key, { read: j.read, ts: Date.now() })
          setState({ read: j.read, loading: false, error: null, cachedAt: Date.now() })
        } else {
          setState((s) => ({ ...s, loading: false }))
        }
      })
      .catch(() => setState((s) => ({ ...s, loading: false })))
  }, [sym, cgId])

  return { ...state, refetch }
}
