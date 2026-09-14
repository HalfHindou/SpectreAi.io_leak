/**
 * Live hunter edges + per-detector grades from the brain engine
 * (/v1/brain/hunter — latest edges + 7d detector_stats). Feeds the universe's
 * signal chips: contagion (rotation watch) and distribution (voices leaving),
 * each carrying its detector's graded hit rate — "no record yet" until the
 * grader has spoken, never a fabricated confidence.
 */
import { useEffect, useState } from 'react'
import { isAppActive } from '@/lib/idleManager'

const TTL_MS = 120_000
const POLL_MS = 180_000
let _cache = { t: 0, data: null }

export default function useHunterSignals(enabled = true) {
  const [data, setData] = useState(_cache.data)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const load = async (force = false) => {
      if (!force && _cache.data && Date.now() - _cache.t < TTL_MS) {
        setData(_cache.data)
        return
      }
      try {
        const r = await fetch('/data-api/v1/brain/hunter', {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        })
        if (!r.ok) return
        const j = await r.json()
        const d = j?.data ?? j
        if (cancelled || !Array.isArray(d?.edges)) return
        _cache = { t: Date.now(), data: d }
        setData(d)
      } catch { /* transient — chips just stay as they were */ }
    }
    load()
    const iv = setInterval(() => {
      if (document.hidden || !isAppActive()) return
      load(true)
    }, POLL_MS)
    return () => { cancelled = true; clearInterval(iv) }
  }, [enabled])

  return data // { edges: [...], detector_stats: [...] } | null
}
