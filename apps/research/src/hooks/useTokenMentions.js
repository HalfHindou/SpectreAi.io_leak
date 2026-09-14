/**
 * useTokenMentions — cross-platform mention aggregator for an asset.
 *
 * Hits /api/social/mentions/{asset} with sane defaults; auto-refreshes
 * every 60s; visibility-aware. Used by the sentiment-tab live panel and
 * the project-tab pinned-message strip.
 */
import { useEffect, useState } from 'react'
import { isAppActive } from '@/lib/idleManager'

// 2026-06-02 cost defense: 60s -> 120s. Mentions are a slow-drifting feed
// (social posts accumulate over minutes), not a real-time signal. Combined
// with the idle-pause + document.hidden gates below, this halves backend
// load (Spectre social API) at zero UX cost.
const REFRESH_MS = 120_000

export default function useTokenMentions({ asset, sinceMinutes = 1440, limit = 80, platforms = null, enabled = true } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled || !asset) return
    // Reset on token switch: the previous asset's mentions must never render
    // under the new symbol, and must not persist if the new fetch errors.
    setData(null)
    setError(null)
    // Per-effect closure flag (NOT a hook-scope ref): the hook stays mounted
    // across token switches, so a shared ref would be reset to false by the
    // next effect run and let token A's slow in-flight response setData onto B.
    let cancelled = false
    let timer

    const params = new URLSearchParams()
    params.set('since', String(sinceMinutes))
    params.set('limit', String(limit))
    if (platforms) params.set('platforms', platforms)
    const url = `/api/social/mentions/${encodeURIComponent(asset)}?${params.toString()}`

    const tick = async () => {
      setLoading(true)
      try {
        // credentials: 'include' — the prod route (social-api?fn=xdash) sits
        // behind the gate cookie; the same-origin default drops the HttpOnly
        // cookie on the iOS PWA (the useInsight 401 lesson, PR #1064).
        const r = await fetch(url, { credentials: 'include' })
        if (cancelled) return
        if (!r.ok) {
          setError(`HTTP ${r.status}`)
        } else {
          const j = await r.json()
          if (cancelled) return
          setData(j?.data || null)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'fetch failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    tick()
    timer = setInterval(() => {
      // Skip when tab is hidden OR user has gone idle (>5min no input).
      // idleManager matches the Phase J pattern used by watchlist + trading
      // pollers, so all background tabs stop costing money simultaneously.
      if (typeof document !== 'undefined' && document.hidden) return
      if (!isAppActive()) return
      tick()
    }, REFRESH_MS)

    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [enabled, asset, sinceMinutes, limit, platforms])

  return { data, loading, error }
}
