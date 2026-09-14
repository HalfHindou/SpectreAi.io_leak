/**
 * useBrainPatterns — the Brain's self-knowledge (mined conditional-hit patterns).
 *
 * GET /data-api/v1/brain/patterns → { patterns: [...], episodes_n, last_mined }.
 * Visibility-gated 10-min poll, in-flight-deduped. Empty/404 → empty list
 * (the strip renders nothing).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { brainGet } from './brain-fetch'

const POLL_MS = 10 * 60_000

export default function useBrainPatterns() {
  const [state, setState] = useState({ loading: true, patterns: [], episodesN: null })
  const cancelled = useRef(false)

  const load = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return
    const d = await brainGet('/data-api/v1/brain/patterns')
    if (cancelled.current) return
    setState({
      loading: false,
      patterns: Array.isArray(d?.patterns) ? d.patterns : [],
      episodesN: d?.episodes_n ?? null,
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
