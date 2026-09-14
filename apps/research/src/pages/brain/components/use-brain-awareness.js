/**
 * useBrainAwareness — fetches /api/brain/awareness/full on a visibility-gated
 * 60s poll. Returns the 26-domain cross-context snapshot the Brain uses to
 * synthesize. This is the "what the Brain sees right now" layer.
 *
 * Response shape (per Hetzner AIXBT_BEAT_PLAYBOOK.md):
 *   {
 *     generated_at: string,
 *     macro_confluence: { domain, ts, params, items: [{...}] },
 *     crypto:           { ..., items: [{ asset, price_usd, change_24h_pct, mcap_rank }] },
 *     trenches:         { ..., items: [{ asset, name, mentions_24h, ... }] },
 *     kol:              { ..., items: [{ asset, mention_count, kol_count, top_kols[] }] },
 *     derivatives:      { ..., items: [{ funding_extremes[] }] },
 *     ...26 domains in all
 *   }
 *
 * Each domain card consumes `data[domainKey]` and renders a tight summary.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const REFRESH_MS = 60_000
const ENDPOINT = '/api/brain/awareness/full'
const FETCH_TIMEOUT_MS = 25_000

export function useBrainAwareness({ enabled = true } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // lastUpdated = when WE last got a successful response (connection evidence).
  // generatedAt = the payload's own timestamp (data age). They are different
  // claims — a cached proxy can hand us an old payload on a fresh response.
  const [lastUpdated, setLastUpdated] = useState(null)
  const [generatedAt, setGeneratedAt] = useState(null)
  const cancelledRef = useRef(false)

  const load = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return
    try {
      const ctrl = new AbortController()
      const id = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
      const res = await fetch(ENDPOINT, { signal: ctrl.signal })
      clearTimeout(id)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (cancelledRef.current) return
      // Unwrap { data, meta } envelope if present.
      const root = json?.data || json
      setData(root)
      setError(null)
      setLastUpdated(Date.now())
      const gen = Date.parse(root?.generated_at || 0)
      setGeneratedAt(Number.isFinite(gen) && gen > 0 ? gen : null)
    } catch (err) {
      if (cancelledRef.current) return
      setError(err?.message || 'failed')
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    cancelledRef.current = false
    load()
    const id = setInterval(load, REFRESH_MS)
    const onVisibility = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelledRef.current = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, load])

  return { data, loading, error, lastUpdated, generatedAt, refresh: load }
}
