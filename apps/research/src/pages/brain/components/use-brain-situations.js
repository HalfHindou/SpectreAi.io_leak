/**
 * useBrainSituations — the street-desk situations feed.
 *
 * GET /data-api/v1/brain/situations → { situations: [...], generated_at }.
 * Visibility-gated 3-min poll, in-flight-deduped. Empty/404 → empty list
 * (the section renders nothing).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { brainGet } from './brain-fetch'

const POLL_MS = 3 * 60_000

export default function useBrainSituations() {
  const [state, setState] = useState({ loading: true, situations: [] })
  const cancelled = useRef(false)

  const load = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return
    const d = await brainGet('/data-api/v1/brain/situations')
    if (cancelled.current) return
    setState({ loading: false, situations: Array.isArray(d?.situations) ? d.situations : [] })
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
