/**
 * useBrainGraph — the consciousness map data (nodes + links + self-audit).
 *
 * Reads /data-api/v1/brain/graph: the engine-side assembly of everything the
 * Brain currently knows (projects w/ graded records, narratives, reinforced
 * intel, mined patterns, lessons, hunted signals) plus open wiki-lint
 * findings. Server caches 3 min; we poll gently and only when visible.
 */
import { useState, useEffect, useRef, useCallback } from 'react'

// Founder call 2026-08-25 ("shouldn't there be more realtime stuff?"): poll at
// the server's own reassembly cadence (90s cache, self-warming) instead of 2
// min — each new assembly reaches the page within a minute of existing.
const POLL_MS = 60_000

/* one line of the inner voice — shared by the Mind sky and the Cortex feed */
export function streamLine(e) {
  const sym = e.sym ? `$${e.sym}` : ''
  if (e.t === 'news') return { chip: 'NEWS', tone: '', text: `${e.source ? `${e.source}: ` : ''}${e.text}${sym ? ` → ${sym}` : ''}` }
  if (e.t === 'post') return { chip: 'POST', tone: e.stance === 'bull' ? 'up' : e.stance === 'bear' ? 'down' : '', text: `@${e.author}${e.stance ? ` ${e.stance}` : ''}${sym ? ` ${sym}` : ''} — ${e.text || ''}` }
  if (e.t === 'fact') return { chip: 'FACT', tone: '', text: `reinforced ×${e.obs}${sym ? ` ${sym}` : ''} — ${e.text}` }
  if (e.t === 'call') return { chip: 'CALL', tone: e.direction === 'bear' ? 'down' : 'up', text: `${e.direction} ${sym}${e.tier === 'shadow' ? ` · shadowed${e.gate ? ` (${e.gate})` : ''}` : ' · published'}` }
  if (e.t === 'grade') return { chip: 'GRADE', tone: e.hit ? 'up' : 'down', text: `${sym} ${e.direction} → ${e.hit ? 'hit' : 'miss'}${e.pnl != null ? ` ${e.pnl > 0 ? '+' : ''}${e.pnl}%` : ''}` }
  if (e.t === 'cycle') return { chip: 'THINK', tone: '', text: `new read — ${(e.changed || []).length} shifted · ${(e.confirmed || []).length} confirmed · ${(e.fading || []).length} fading` }
  return { chip: e.t, tone: '', text: e.text || '' }
}

/* The live cognition stream — real percepts/thoughts of the last minutes
   (headlines, posts, facts, calls, grades, think-cycles). 20s poll. */
export function useBrainActivity() {
  const [feed, setFeed] = useState([])
  const seen = useRef(new Set())
  const fresh = useRef([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch('/data-api/v1/brain/graph/activity', { signal: AbortSignal.timeout(15000) })
        if (!r.ok) return
        const j = await r.json()
        const events = (j?.data || j)?.events
        if (cancelled || !Array.isArray(events)) return
        const news = []
        for (const e of events) {
          if (!e || !e.id || seen.current.has(e.id)) continue
          seen.current.add(e.id)
          news.push(e)
        }
        if (news.length) {
          fresh.current = news
          setFeed((f) => [...news, ...f].slice(0, 60))
        }
      } catch { /* next poll retries */ }
    }
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, 12_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  // one-shot consumer: the canvas engine drains fresh events for animation
  const drain = useCallback(() => {
    const out = fresh.current
    fresh.current = []
    return out
  }, [])

  return { feed, drain }
}

export default function useBrainGraph() {
  const [state, setState] = useState({ loading: true, error: false, data: null })
  const cancelled = useRef(false)

  const load = useCallback(async () => {
    // Two bounded attempts with a short timeout: in dev the browser's
    // per-origin connection cap can queue this fetch behind the page's other
    // feeds — a stuck first attempt must retry, never hang the tab.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch('/data-api/v1/brain/graph', { signal: AbortSignal.timeout(12000) })
        if (!r.ok) throw new Error(String(r.status))
        const j = await r.json()
        const d = j?.data || j
        if (cancelled.current) return
        if (!d || !Array.isArray(d.nodes)) throw new Error('bad shape')
        setState({ loading: false, error: false, data: d })
        return
      } catch {
        if (cancelled.current) return
        if (attempt === 0) await new Promise((res) => setTimeout(res, 1200))
      }
    }
    if (!cancelled.current) setState((s) => ({ ...s, loading: false, error: !s.data }))
  }, [])

  useEffect(() => {
    cancelled.current = false
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    return () => { cancelled.current = true; clearInterval(t) }
  }, [load])

  return { ...state, refetch: load }
}
