/**
 * use-news-brief — the grounded "why is this happening" read for an article.
 *
 * Backed by /api/news/brief (see api/_lib/handlers/news-brief.js for the why).
 * The handler owns resolution, grounding, the LLM call, the cache and the
 * deterministic floor; this hook is only transport + lifecycle.
 *
 * Two things worth knowing:
 *  - `pending: true` means another request is generating this same article's
 *    brief right now (the handler holds a short lock so a story going viral
 *    generates ONCE, not once per reader). We poll a couple of times rather
 *    than showing a dead end, because the generation takes about a second.
 *  - a brief is per ARTICLE and a published article does not change, so once
 *    it is warm every later reader gets it from cache instantly.
 */
import { useEffect, useState } from 'react'

const POLL_MS = 1500
const MAX_POLLS = 4

export function useNewsBrief(articleId) {
  const [brief, setBrief] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setBrief(null)
    if (!articleId) { setLoading(false); return }

    let cancelled = false
    let timer = null
    let polls = 0
    setLoading(true)

    async function run() {
      try {
        const res = await fetch(`/api/news/brief?id=${encodeURIComponent(articleId)}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(25000),
        })
        if (cancelled) return
        const json = await res.json().catch(() => null)
        if (cancelled) return

        if (json?.brief?.why) {
          setBrief(json.brief)
          setLoading(false)
          return
        }
        // someone else is generating it - come back for it shortly
        if (json?.pending && polls < MAX_POLLS) {
          polls += 1
          timer = setTimeout(run, POLL_MS)
          return
        }
        setLoading(false)
      } catch {
        if (!cancelled) setLoading(false)
      }
    }
    run()

    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [articleId])

  return { brief, loading }
}

export default useNewsBrief
