/**
 * useVcTweets — fresh X posts for a fund's handle via /api/tweets/official
 * (5-min server cache). Kept separate from the 6h intel/thesis cache so the
 * feed always shows current posts. Module-cached per handle.
 */
import { useState, useEffect } from 'react'

const _cache = new Map()
const _inflight = new Map()

export default function useVcTweets(handle) {
  const [state, setState] = useState(() => (handle && _cache.has(handle)
    ? { tweets: _cache.get(handle), loading: false }
    : { tweets: [], loading: !!handle }))

  useEffect(() => {
    if (!handle) { setState({ tweets: [], loading: false }); return undefined }
    if (_cache.has(handle)) { setState({ tweets: _cache.get(handle), loading: false }); return undefined }

    let cancelled = false
    setState((s) => ({ ...s, loading: true }))

    const run = _inflight.get(handle) || (async () => {
      try {
        const r = await fetch(`/api/tweets/official?username=${encodeURIComponent(handle)}`)
        if (!r.ok) return []
        const j = await r.json()
        const arr = j?.tweets || j?.data || (Array.isArray(j) ? j : [])
        const tweets = (arr || []).slice(0, 12).map((t) => ({
          text: t.tweet_text || t.full_text || t.text || '',
          date: t.date || null,
          created_at: t.created_at || null,
          likes: t.likes ?? null,
          views: t.views ?? null,
          retweets: t.retweets ?? null,
          id: t.tweet_id || t.id || null,
          username: t.username || handle,
          profile_image: t.profile_image || null,
          url: t.tweet_id ? `https://x.com/${t.username || handle}/status/${t.tweet_id}` : `https://x.com/${handle}`,
        })).filter((t) => t.text)
        _cache.set(handle, tweets)
        return tweets
      } finally {
        _inflight.delete(handle)
      }
    })()
    _inflight.set(handle, run)

    run.then((t) => { if (!cancelled) setState({ tweets: t, loading: false }) })
      .catch(() => { if (!cancelled) setState({ tweets: [], loading: false }) })

    return () => { cancelled = true }
  }, [handle])

  return state
}
