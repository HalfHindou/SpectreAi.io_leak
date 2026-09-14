/**
 * usePreIPO — data hook for the Private Markets › Pre-IPO tab.
 *
 * Returns { roster, summary, loading, featured, lastUpdated, refresh } per
 * .claude/rules/coding-standards.md H (objects, never arrays).
 *
 * - roster   : the curated pre-IPO companies (sorted by valuation desc)
 * - featured : the hero company's merged tweet rail ({ author, tweets, loading })
 * Visibility-aware: skips fetches while the tab is hidden.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getPreIPO, searchTweets, getOfficialTweets } from './private-markets-api'
import { FEATURED } from './preipo-constants'

const REFRESH_MS = 5 * 60 * 1000

// Engagement score used to rank a merged tweet rail. Retweets weighted highest
// (strongest signal of spread), then replies, then likes; views as a faint
// tiebreaker so fresh-but-viral posts still surface.
export function tweetScore(t) {
  return (t.retweets || 0) * 3 + (t.replies || 0) * 2 + (t.likes || 0) + (t.views || 0) / 1000
}

// Dedupe by id, drop empty, rank by engagement.
export function mergeTweets(lists) {
  const seen = new Set()
  const out = []
  for (const t of lists) {
    if (!t || !t.id || seen.has(t.id)) continue
    if (!t.text && !t.url) continue
    seen.add(t.id)
    out.push(t)
  }
  return out.sort((a, b) => tweetScore(b) - tweetScore(a))
}

export default function usePreIPO() {
  const [roster, setRoster] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [featured, setFeatured] = useState({ author: null, tweets: [], loading: true })
  const [lastUpdated, setLastUpdated] = useState(null)
  const cancelledRef = useRef(false)

  const loadRoster = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return
    const { roster: r, summary: s } = await getPreIPO()
    if (cancelledRef.current) return
    if (r.length) {
      setRoster(r)
      setSummary(s)
      setLastUpdated(Date.now())
    }
    setLoading(false)
  }, [])

  const loadFeaturedTweets = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return
    const related = FEATURED.relatedAccounts || []
    const queries = FEATURED.searchQueries || []
    const results = await Promise.all([
      getOfficialTweets(FEATURED.twitter, { limit: 8 }),
      ...related.map((h) => getOfficialTweets(h, { limit: 8 })),
      ...queries.map((q) => searchTweets(q, { limit: 18 })),
    ])
    if (cancelledRef.current) return

    const primary = results[0]
    const relatedOfficials = results.slice(1, 1 + related.length)
    const searches = results.slice(1 + related.length)
    const re = FEATURED.relevance

    // The primary account is on-topic by definition; the big related accounts
    // (Elon, Nasdaq, Watcher Guru) post about everything, so keep only their
    // posts that actually mention the company / ticker. Engagement ranking then
    // floats the major IPO tweets to the top.
    const relatedTweets = relatedOfficials.flatMap((o) =>
      (o.tweets || []).filter((tw) => !re || re.test(tw.text || ''))
    )
    const merged = mergeTweets([
      ...(primary.tweets || []),
      ...relatedTweets,
      ...searches.flat(),
    ])
    setFeatured({ author: primary.author, tweets: merged, loading: false })
  }, [])

  const refresh = useCallback(() => {
    loadRoster()
    loadFeaturedTweets()
  }, [loadRoster, loadFeaturedTweets])

  useEffect(() => {
    cancelledRef.current = false
    // Roster paints the hero + grid — fetch it immediately.
    loadRoster()
    // The featured tweet rail fans out to ~7 tweet requests below the fold.
    // Defer it to idle (fallback setTimeout) so the roster isn't blocked by it.
    const ric = typeof requestIdleCallback === 'function'
      ? requestIdleCallback(() => loadFeaturedTweets(), { timeout: 2000 })
      : setTimeout(() => loadFeaturedTweets(), 300)
    return () => {
      cancelledRef.current = true
      if (typeof cancelIdleCallback === 'function' && typeof ric === 'number') {
        cancelIdleCallback(ric)
      } else {
        clearTimeout(ric)
      }
    }
  }, [loadRoster, loadFeaturedTweets])

  useAdaptivePolling(refresh, { interval: REFRESH_MS })

  return { roster, summary, loading, featured, lastUpdated, refresh }
}
