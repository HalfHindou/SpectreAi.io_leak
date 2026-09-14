/**
 * useDetectiveFeed — REST poll + SSE merge for autonomous detective
 * verdicts. Bootstraps from /api/detective/feed; live updates flow in
 * via the Brain SSE stream (event: verdict).
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { isAppActive } from '@/lib/idleManager'

const DEFAULT_TTL_MS = 30_000
const MAX_ROWS = 80

function safeJson(s) { try { return JSON.parse(s) } catch { return null } }

export default function useDetectiveFeed({ enabled = true, onlyAutonomous = true, sinceMinutes = 1440, limit = 50, ttlMs = DEFAULT_TTL_MS } = {}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const cancelRef = useRef(false)

  const merge = useCallback((incoming) => {
    if (!incoming?.length) return
    setRows((cur) => {
      const map = new Map()
      for (const r of cur) {
        const key = String(r.id ?? `${r.asset}-${r.created_at || r.ts}`)
        map.set(key, r)
      }
      for (const r of incoming) {
        const key = String(r.id ?? `${r.asset}-${r.created_at || r.ts}`)
        // newer payload wins
        const prev = map.get(key)
        map.set(key, prev ? { ...prev, ...r } : r)
      }
      return Array.from(map.values())
        .sort((a, b) => new Date(b.created_at || b.ts).getTime() - new Date(a.created_at || a.ts).getTime())
        .slice(0, MAX_ROWS)
    })
  }, [])

  // Initial bootstrap + slow poll
  useEffect(() => {
    if (!enabled) return
    cancelRef.current = false
    let timer

    const url = `/api/detective/feed?onlyAutonomous=${onlyAutonomous ? '1' : '0'}&since=${sinceMinutes}&limit=${limit}`
    const tick = async () => {
      setLoading(true)
      try {
        // Same as useDossierProject: /api/detective/* is behind the edge
        // auth gate, and omitting credentials 401s every request.
        const r = await fetch(url)
        if (cancelRef.current) return
        if (!r.ok) {
          setError(`HTTP ${r.status}`)
        } else {
          const j = await r.json()
          if (cancelRef.current) return
          merge(j?.data || [])
          setUpdatedAt(Date.now())
          setError(null)
        }
      } catch (e) {
        if (!cancelRef.current) setError(e?.message || 'fetch failed')
      } finally {
        if (!cancelRef.current) setLoading(false)
      }
    }
    tick()
    timer = setInterval(() => {
      if ((typeof document !== 'undefined' && document.hidden) || !isAppActive()) return
      tick()
    }, ttlMs)

    return () => { cancelRef.current = true; if (timer) clearInterval(timer) }
  }, [enabled, onlyAutonomous, sinceMinutes, limit, ttlMs, merge])

  // Live merge from SSE — separate connection so it doesn't fight with
  // useBrainStream consumers elsewhere on the page.
  useEffect(() => {
    if (!enabled) return
    let alive = true, backoff = 1000, es
    const open = () => {
      if (!alive) return
      es = new EventSource('/api/brain/stream')
      es.addEventListener('open', () => { backoff = 1000 })
      es.addEventListener('error', () => {
        if (!alive) return
        try { es.close() } catch {}
        setTimeout(open, backoff)
        backoff = Math.min(30_000, Math.round(backoff * 1.7))
      })
      es.addEventListener('verdict', (e) => {
        const d = safeJson(e.data); if (!d) return
        // shape mismatch: SSE pushes {ts, asset, ...}; REST returns {created_at, asset, ...}.
        // Normalize so merge() dedupes correctly.
        merge([{ ...d, created_at: d.ts || d.created_at }])
      })
    }
    open()
    return () => { alive = false; try { es?.close() } catch {} }
  }, [enabled, merge])

  return { rows, loading, error, updatedAt }
}
