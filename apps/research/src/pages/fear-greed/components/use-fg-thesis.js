/**
 * useFgThesis — fetches the LLM-generated thesis card payload from
 * /api/fear-greed/thesis. Module-level cache + in-flight dedup mirror the
 * useMarketRegime pattern in fear-greed-page.jsx so multiple consumers on
 * the same page never hit the network twice.
 *
 * Refresh strategy:
 *   - Server (Express + Vercel) owns the smart cache: fingerprint of F&G zone
 *     + value bucket + regime label + BTC price bucket. Groq only fires when
 *     the fingerprint changes OR 24h pass.
 *   - Client TTL is shorter (10 min) so we POLL the server for invalidation
 *     events. The server response is cheap when the fingerprint is stable
 *     (no LLM call) — just upstream + a memoized payload.
 *   - This is the "auto-refresh on big events" loop: client checks every
 *     10 min, server short-circuits unless something material moved.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { getThesis } from '@/services/fearGreedApi'
import { isAppActive } from '@/lib/idleManager'

const TTL_MS = 10 * 60 * 1000
const _cache = { data: null, ts: 0 }
let _inflight = null

function _fetch() {
  if (_cache.data && Date.now() - _cache.ts < TTL_MS) {
    return Promise.resolve(_cache.data)
  }
  if (_inflight) return _inflight
  _inflight = getThesis()
    .then(json => {
      const payload = json?.data || null
      _cache.data = payload
      _cache.ts = Date.now()
      _inflight = null
      return payload
    })
    .catch(err => {
      _inflight = null
      throw err
    })
  return _inflight
}

export function useFgThesis({ enabled = true } = {}) {
  const [data, setData] = useState(_cache.data)
  const [loading, setLoading] = useState(_cache.data == null && enabled)
  const [error, setError] = useState(null)
  const intervalRef = useRef(null)

  // Pull on mount (or on cache hit, hand back the cached value instantly).
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    _fetch()
      .then(d => {
        if (cancelled) return
        setData(d)
        setLoading(false)
      })
      .catch(e => {
        if (cancelled) return
        setError(e)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [enabled])

  // Visibility-aware background refresh. Re-poll every TTL_MS while the tab
  // is foregrounded. The server short-circuits if its fingerprint is stable
  // (no Groq spend) so this is essentially free — it just propagates
  // server-side invalidations to the UI without the user having to refresh.
  // Skips when document.hidden per the visibility-gated fetching pattern.
  useEffect(() => {
    if (!enabled) return undefined
    const tick = () => {
      if (typeof document !== 'undefined' && (document.hidden || !isAppActive())) return
      _cache.data = null
      _cache.ts = 0
      _fetch()
        .then(d => { if (d) setData(d) })
        .catch(() => { /* keep showing whatever we have */ })
    }
    intervalRef.current = window.setInterval(tick, TTL_MS)
    // Also re-fetch when the tab becomes visible after being hidden longer
    // than the TTL — the user expects fresh content when they come back.
    const onVis = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        const age = Date.now() - _cache.ts
        if (age > TTL_MS) tick()
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVis)
    }
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVis)
      }
    }
  }, [enabled])

  // Manual refresh (refresh button). Forces cache invalidation client-side AND
  // server-side (the next call will see Date.now() > TTL on the server which
  // does NOT force regen — fingerprint guards that. So manual refresh just
  // re-reads whatever the server has, which may already be stale by design.
  // That's fine: the right way to truly force regen is to wait for the next
  // fingerprint change.)
  const refetch = useCallback(() => {
    _cache.data = null
    _cache.ts = 0
    setLoading(true)
    setError(null)
    return _fetch()
      .then(d => { setData(d); setLoading(false); return d })
      .catch(e => { setError(e); setLoading(false) })
  }, [])

  return { data, loading, error, refetch }
}
