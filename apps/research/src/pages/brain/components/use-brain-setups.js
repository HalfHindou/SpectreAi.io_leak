/**
 * useBrainSetups — the desk's 5 daily trade setups, one per lens.
 *
 * Reads the ENGINE brain: GET /data-api/v1/brain/setups (through the /data-api
 * proxy, same as use-brain-desk.js). The `brain-setups` worker on the data-api
 * box writes one setup per lens (macro / onchain / social / degen / leverage)
 * with a live-marked P&L since entry, so every desk call is testable.
 *
 * The endpoint may 404 until the engine deploys — in that case the hook returns
 * an empty, non-loading, errored state and the section renders NOTHING (no
 * placeholder, no layout gap). Visibility-gated 5-min poll, AbortSignal timeout,
 * in-flight dedupe.
 */
import { useState, useEffect, useRef, useCallback } from 'react'

const POLL_MS = 5 * 60_000

async function getJson(url, ms = 15000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

export default function useBrainSetups() {
  const [state, setState] = useState({ loading: true, error: false, setups: [], scorecard: null, date: null, generatedAt: null })
  const cancelled = useRef(false)
  const inflight = useRef(false)

  const load = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    try {
      const res = await getJson('/data-api/v1/brain/setups')
      const d = res?.data || res
      if (cancelled.current) return
      if (!d || !Array.isArray(d.setups)) {
        setState((s) => ({ ...s, loading: false, error: true }))
        return
      }
      setState({
        loading: false,
        error: false,
        setups: d.setups,
        scorecard: d.scorecard || null,
        date: d.date || null,
        generatedAt: d.generated_at || d.generatedAt || null,
      })
    } finally {
      inflight.current = false
    }
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
