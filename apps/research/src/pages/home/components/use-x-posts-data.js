/**
 * useXPostsData - Fetches X/Twitter posts from the external API.
 * Only fetches when the Posts tab is visible (active = true).
 * Returns { xPosts, xPostsLoading, xPostsError, refetchXPosts }
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'

const X_POSTS_API_URL = '/api/welcome/x-tweets'

// Instant-paint seed: show the last-loaded posts immediately on a return visit
// instead of an empty panel while the (sometimes cold) fetch runs.
const X_SEED_KEY = 'spectre-cc-xposts-v1'
const X_SEED_TTL = 5 * 60 * 1000 // 5 min
function readXSeed() {
  try {
    const raw = localStorage.getItem(X_SEED_KEY)
    if (!raw) return []
    const { ts, items } = JSON.parse(raw)
    if (!Array.isArray(items) || Date.now() - ts > X_SEED_TTL) return []
    return items
  } catch { return [] }
}
function writeXSeed(items) {
  try {
    localStorage.setItem(X_SEED_KEY, JSON.stringify({ ts: Date.now(), items: items.slice(0, 30) }))
  } catch { /* quota / private mode - ignore */ }
}

/* Decode HTML entities like &amp; &lt; &gt; &quot; &#39; */
function decodeHtml(str) {
  if (!str || typeof str !== 'string') return str
  const el = typeof document !== 'undefined' && document.createElement('textarea')
  if (!el) return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  el.innerHTML = str
  return el.value
}

function mapTweet(tweet) {
  // Avatar fallback: when upstream tweet payload doesn't carry author.avatar_url
  // (some sources strip it), synthesize via unavatar.io which resolves any
  // X handle to its current profile picture for free, no API key. The
  // ?fallback=false param tells unavatar to 404 (not return a generic default)
  // if the handle doesn't exist, so the existing onError fallback to the
  // letter avatar still kicks in for truly invalid handles.
  const username = tweet.username || (tweet.handle ? tweet.handle.replace(/^@/, '') : null)
  const avatar = tweet.author?.avatar_url
    || (username ? `https://unavatar.io/twitter/${username}?fallback=false` : null)
  return {
    id: tweet.tweet_id,
    handle: tweet.handle || (tweet.username ? `@${tweet.username}` : '@unknown'),
    name: decodeHtml(tweet.author?.name || tweet.username) || 'Unknown',
    avatar,
    verified: tweet.author?.is_blue_verified || tweet.author?.verification_type === 'Business' || false,
    profileShape: tweet.author?.profile_image_shape || 'Circle',
    text: decodeHtml(tweet.text) || '',
    time: tweet.created_at_iso || null,
    likes: tweet.like_count || 0,
    replies: tweet.reply_count || 0,
    reposts: tweet.retweet_count || 0,
    views: tweet.view_count || 0,
    bookmarks: tweet.bookmark_count || 0,
    engagementScore: tweet.engagement_score || 0,
    hot: (tweet.engagement_score || 0) >= 8,
    media: tweet.media || [],
    xUrl: tweet.x_url || (tweet.username && tweet.tweet_id ? `https://x.com/${tweet.username}/status/${tweet.tweet_id}` : null),
    cashtags: tweet.cashtags || [],
  }
}

// 2026-05-26 beta-quality fix: removed 12 fabricated tweets (fake @Vitalik / @CryptoHayes / @Blknoiz06 posts
// with invented engagement numbers). When /api/welcome/x-tweets returns empty, render empty state.
const FALLBACK_POSTS = []

export default function useXPostsData(active) {
  const [xPosts, setXPosts] = useState(() => readXSeed())
  const [xPostsLoading, setXPostsLoading] = useState(false)
  const [xPostsError, setXPostsError] = useState(null)
  const abortRef = useRef(null)
  // Do we already have posts on screen (seed or prior fetch)? Gates the shimmer.
  const hasPostsRef = useRef(xPosts.length > 0)

  const fetchPosts = useCallback(async (signal, showLoading = true) => {
    try {
      // Only shimmer when the panel is actually empty.
      if (showLoading && !hasPostsRef.current) setXPostsLoading(true)
      setXPostsError(null)
      const res = await fetch(X_POSTS_API_URL, { signal })
      if (!res.ok) throw new Error(`X Posts API error: ${res.status}`)
      const data = await res.json()
      const tweets = Array.isArray(data) ? data : (data?.results || [])
      if (!signal?.aborted) {
        const mapped = tweets.map(mapTweet)
        setXPosts(mapped.length > 0 ? mapped : FALLBACK_POSTS)
        if (mapped.length > 0) { writeXSeed(mapped); hasPostsRef.current = true }
        setXPostsLoading(false)
        setXPostsError(null)
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        // Normally a newer fetch already owns the state. When nothing took over
        // (this controller is still the latest), clearing the flag is the only
        // thing standing between the reader and an endless shimmer.
        if (abortRef.current?.signal === signal) setXPostsLoading(false)
        return
      }
      if (!signal?.aborted) {
        setXPostsError(e.message || 'Failed to load posts')
        setXPostsLoading(false)
        setXPosts(prev => prev.length > 0 ? prev : FALLBACK_POSTS)
      }
    }
  }, [])

  const refetchXPosts = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    fetchPosts(controller.signal, true)
  }, [fetchPosts])

  const pollPosts = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    fetchPosts(ctrl.signal, false)
  }, [fetchPosts])

  // 2026-06-03 cost war: removed unconditional prewarm on Welcome mount.
  // X-Dash is rate-limited per-IP and the Vercel edge cache claim doesn't
  // hold for cookie-bearing requests (auth-gate). Tab-activation effect
  // below fires the fetch when the user actually clicks Posts. Cold-click
  // latency goes from "instant" to ~500ms-2s, worth the cut at this scale.

  // Refresh on activation if data is stale (>60s old). Init to 0 so the
  // FIRST activation always passes the staleness check — initializing to
  // Date.now() made `Date.now() - lastFetchRef.current` ~0 on first click,
  // which blocked the fetch and left the user staring at empty content for
  // up to 120s waiting on useAdaptivePolling (fireImmediately: false) to
  // tick. Same regression as use-news-data.js from the 2026-06-03 cost war.
  const lastFetchRef = useRef(0)
  useEffect(() => {
    if (!active) return
    if (Date.now() - lastFetchRef.current < 60_000) return
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    // Cold, no seed -> shimmer. Warm (seed on screen) -> silent background refresh.
    // Stamp only a fetch that actually COMPLETED. An aborted one (tab switch,
    // StrictMode remount) used to stamp too, so the 60s staleness guard above
    // then suppressed the retry while xPostsLoading was still true from the
    // aborted attempt - the Posts panel shimmered for a full minute with no
    // request in flight, which is exactly how it read: permanently loading.
    fetchPosts(controller.signal, !hasPostsRef.current).finally(() => {
      if (!controller.signal.aborted) lastFetchRef.current = Date.now()
    })
    return () => { controller.abort() }
  }, [active, fetchPosts])

  useAdaptivePolling(pollPosts, { interval: 120_000, enabled: active })

  return { xPosts, xPostsLoading, xPostsError, refetchXPosts }
}
