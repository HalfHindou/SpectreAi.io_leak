/**
 * useBrainHunter — the autonomous edge-search feed (Phase 3, `brain-hunter` worker).
 *
 * Reads the hunter output: a time-ordered list of `edges` (anomaly / new-listing /
 * narrative-onset / prediction-swing / divergence detections) plus per-detector
 * `detector_stats` (7d counts + honest hit-rate once graded).
 *
 * Source: /data-api/v1/brain/hunter — the engine worker on the data-api box,
 * reached through the same /data-api proxy as useBrainDesk's /v1/brain/desk.
 * The endpoint 404s until the worker deploys; that resolves to an empty feed and
 * the rail renders nothing (graceful absence).
 *
 * Visibility-gated 2-min poll, AbortSignal.timeout, module-level inflight dedupe.
 */
import { useState, useEffect, useRef, useCallback } from 'react'

const POLL_MS = 2 * 60_000
const TIMEOUT_MS = 15000

// Module-level inflight dedupe — concurrent mounts/polls share one request.
let inflight = null

function fetchHunter() {
  if (inflight) return inflight
  const p = (async () => {
    try {
      const r = await fetch('/data-api/v1/brain/hunter', { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!r.ok) return null
      return await r.json()
    } catch {
      return null
    }
  })()
  inflight = p
  p.finally(() => { if (inflight === p) inflight = null })
  return p
}

export default function useBrainHunter() {
  const [state, setState] = useState({ loading: true, edges: [], stats: [] })
  const cancelled = useRef(false)

  const load = useCallback(async () => {
    const json = await fetchHunter()
    if (cancelled.current) return
    const data = json?.data || json
    setState({
      loading: false,
      edges: Array.isArray(data?.edges) ? data.edges : [],
      stats: Array.isArray(data?.detector_stats) ? data.detector_stats : [],
    })
  }, [])

  useEffect(() => {
    cancelled.current = false
    load()
    const timer = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled.current = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  return { ...state, refetch: load }
}
