/**
 * useProjectDossier — client for the per-token Project Dossier.
 *
 * GET /api/project-dossier?symbol=&cgId= (tier3, gate cookie). The server
 * caches 24h per asset (fundamentals barely move) with a 60s generation lock.
 * The response ALWAYS carries deterministic `facts` + a distilled `summary`
 * — so even a `pending: true` reply (LLM read still generating) paints
 * a real panel immediately, and we retry on a short backoff to upgrade in the
 * punchy AI `read`.
 *
 * localStorage instant-paint seed (6h) makes returning views paint before the
 * network. credentials: 'include' is deliberate — on the iOS PWA the same-origin
 * default drops the HttpOnly gate cookie and the tier3 gate 401s (the useInsight
 * / sentiment-read lesson).
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { isAppActive } from '@/lib/idleManager'

const CLIENT_CACHE = new Map()
const INFLIGHT = new Map()
const CLIENT_TTL = 30 * 60_000
const SEED_PREFIX = 'spectre-dossier-v1:'
const SEED_TTL = 6 * 60 * 60_000
const RETRY_MS = 4000
const MAX_RETRIES = 4

function loadSeed(key) {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(`${SEED_PREFIX}${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || Date.now() - parsed.ts > SEED_TTL) return null
    return parsed.dossier || null
  } catch {
    return null
  }
}

function saveSeed(key, dossier) {
  if (typeof window === 'undefined' || !dossier?.facts) return
  try {
    window.localStorage.setItem(`${SEED_PREFIX}${key}`, JSON.stringify({ ts: Date.now(), dossier }))
  } catch {
    // quota / private mode — non-fatal
  }
}

async function fetchDossier(symbol, cgId) {
  const qs = new URLSearchParams({ symbol })
  if (cgId) qs.set('cgId', cgId)
  const r = await fetch(`/api/project-dossier?${qs}`, {
    credentials: 'include',
    signal: AbortSignal.timeout(30_000),
  })
  if (!r.ok) throw new Error(`project-dossier ${r.status}`)
  return r.json()
}

export default function useProjectDossier(symbol, cgId, { enabled = true } = {}) {
  const sym = String(symbol || '').toUpperCase()
  const key = `${sym}:${cgId || ''}`
  const [state, setState] = useState({ dossier: null, loading: !!(enabled && sym), error: null })
  const retriesRef = useRef(0)
  const timerRef = useRef(null)

  const load = useCallback(async (force = false) => {
    if (!sym) return
    const k = `${sym}:${cgId || ''}`

    if (!force) {
      const hit = CLIENT_CACHE.get(k)
      if (hit && Date.now() - hit.ts < CLIENT_TTL) {
        setState({ dossier: hit.dossier, loading: false, error: null })
        return
      }
      const seed = loadSeed(k)
      if (seed) setState({ dossier: seed, loading: !seed.read, error: null })
    }

    setState((s) => ({ ...s, loading: !s.dossier?.read }))
    try {
      let promise = INFLIGHT.get(k)
      if (!promise) {
        promise = fetchDossier(sym, cgId)
        INFLIGHT.set(k, promise)
        promise.finally(() => INFLIGHT.delete(k))
      }
      const json = await promise
      const dossier = json?.dossier || null

      if (dossier?.facts) {
        // A dossier with the LLM read is final; cache + seed it. A facts-only
        // (pending) dossier still paints, but keep retrying for the read.
        if (dossier.read) {
          retriesRef.current = 0
          CLIENT_CACHE.set(k, { dossier, ts: Date.now() })
          saveSeed(k, dossier)
          setState({ dossier, loading: false, error: null })
          return
        }
        setState({ dossier, loading: false, error: null })
        if ((json?.pending || !dossier.read) && retriesRef.current < MAX_RETRIES) {
          retriesRef.current += 1
          timerRef.current = setTimeout(() => {
            if (typeof document !== 'undefined' && document.hidden) return
            load(true)
          }, RETRY_MS)
        }
        return
      }
      setState((s) => ({ dossier: s.dossier, loading: false, error: json?.error || 'unavailable' }))
    } catch (e) {
      setState((s) => ({ dossier: s.dossier, loading: false, error: e.message || 'unavailable' }))
    }
  }, [sym, cgId])

  useEffect(() => {
    if (!enabled || !sym) {
      setState({ dossier: null, loading: false, error: null })
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
    CLIENT_CACHE.delete(key)
    load(true)
  }, [load, key])

  return { ...state, refetch }
}
