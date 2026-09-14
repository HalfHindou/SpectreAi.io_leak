/**
 * useBrainWorld — the macro-politics world-state doc.
 *
 * GET /data-api/v1/brain/world → { version, ts, doc: {...}, diff }.
 * Visibility-gated 15-min poll, in-flight-deduped. Empty/404 → null doc
 * (the strip renders nothing).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { brainGet } from './brain-fetch'

const POLL_MS = 15 * 60_000

export default function useBrainWorld() {
  const [state, setState] = useState({ loading: true, doc: null, diff: null })
  const cancelled = useRef(false)

  const load = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return
    const d = await brainGet('/data-api/v1/brain/world')
    if (cancelled.current) return
    const doc = d?.doc && typeof d.doc === 'object' ? d.doc : null
    setState({ loading: false, doc, diff: typeof d?.diff === 'string' ? d.diff : null })
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
