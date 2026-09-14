/**
 * YouCryptoTwitter — Crypto X/Twitter feed widget.
 * Scrollable list of posts with handle, text, time, and sentiment dot.
 * Fetches from /ext-api/welcome_x_tweet with auto-refresh every 2 minutes.
 * Supports remix modes: feed (default), compact, highlight.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'

const X_POSTS_API_URL = '/api/welcome/x-tweets'
const REMIX_KEY = 'spectre:you-remix-twitter'
const REMIX_MODES = ['feed', 'compact', 'highlight']

// 2026-05-26 beta-quality fix: removed 6 fabricated tweets from invented
// accounts (@100xAnalyst, @BearishTakes, etc.). Visible if welcome/x-tweets
// failed. Pretending fake handles tweeted real prices ($78K gap, $42M flow)
// is a wrong-entity data leak.
const FALLBACK_FEED = []

const BULLISH_KEYWORDS = ['bullish', 'surge', 'rally', 'moon', 'pump', 'strong', 'higher', 'accumulation', 'inflow', 'breakout', 'buy']
const BEARISH_KEYWORDS = ['bearish', 'dump', 'crash', 'drop', 'sell', 'weak', 'lower', 'outflow', 'breakdown', 'short', 'gap']

function decodeHtml(str) {
  if (!str || typeof str !== 'string') return str
  const el = typeof document !== 'undefined' && document.createElement('textarea')
  if (!el) return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  el.innerHTML = str
  return el.value
}

function relativeTime(timestamp) {
  if (!timestamp) return ''
  const now = Date.now()
  const ts = typeof timestamp === 'number'
    ? (timestamp < 1e12 ? timestamp * 1000 : timestamp)
    : new Date(timestamp).getTime()
  if (isNaN(ts)) return ''
  const diff = Math.max(0, now - ts)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function deriveSentiment(text = '') {
  const t = text.toLowerCase()
  const bull = BULLISH_KEYWORDS.filter(k => t.includes(k)).length
  const bear = BEARISH_KEYWORDS.filter(k => t.includes(k)).length
  if (bull > bear) return 'bullish'
  if (bear > bull) return 'bearish'
  return 'neutral'
}

function formatEngagement(n) {
  if (!n || n < 1) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

export default function YouCryptoTwitter() {
  const [feed, setFeed] = useState(FALLBACK_FEED)
  const [loading, setLoading] = useState(true)
  const [remix, setRemix] = useState(() => {
    try { return localStorage.getItem(REMIX_KEY) || 'feed' } catch { return 'feed' }
  })
  const abortRef = useRef(null)
  const intervalRef = useRef(null)
  const mountedRef = useRef(true)

  const cycleRemix = useCallback(() => {
    setRemix(prev => {
      const next = REMIX_MODES[(REMIX_MODES.indexOf(prev) + 1) % REMIX_MODES.length]
      try { localStorage.setItem(REMIX_KEY, next) } catch {}
      return next
    })
  }, [])

  const fetchPosts = useCallback(async (signal, showLoading = true) => {
    try {
      if (showLoading) setLoading(true)
      const res = await fetch(X_POSTS_API_URL, { signal })
      if (!res.ok) throw new Error(`X Posts API error: ${res.status}`)
      const data = await res.json()
      const tweets = Array.isArray(data) ? data : (data?.results || [])
      if (tweets.length > 0 && !signal?.aborted && mountedRef.current) {
        const mapped = tweets.map((tweet, i) => ({
          id: tweet.tweet_id || String(i),
          handle: tweet.handle || (tweet.username ? `@${tweet.username}` : '@unknown'),
          text: decodeHtml(tweet.text) || '',
          time: relativeTime(tweet.created_at_iso || tweet.created_at),
          likes: tweet.like_count || 0,
          reposts: tweet.retweet_count || 0,
          sentiment: deriveSentiment(tweet.text),
          engagementScore: tweet.engagement_score || (tweet.like_count || 0) + (tweet.retweet_count || 0) * 2,
        }))
        setFeed(mapped)
      }
      if (!signal?.aborted && mountedRef.current) setLoading(false)
    } catch (e) {
      if (e.name === 'AbortError') return
      if (!signal?.aborted && mountedRef.current) {
        setFeed(prev => prev.length > 0 ? prev : FALLBACK_FEED)
        setLoading(false)
      }
    }
  }, [])

  const pollPosts = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    fetchPosts(ctrl.signal, false)
  }, [fetchPosts])

  useEffect(() => {
    mountedRef.current = true
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    fetchPosts(controller.signal, true)

    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchPosts])

  useAdaptivePolling(pollPosts, { interval: 2 * 60_000 })

  const sentimentColor = {
    bullish: 'var(--bull)',
    bearish: 'var(--bear)',
    neutral: 'var(--text-muted)',
  }

  // Shimmer loading
  if (loading && feed === FALLBACK_FEED) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', padding: '2px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--text-secondary)">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Crypto X</span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} style={{ padding: '10px 0', borderBottom: i < 4 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
                <div style={{ height: 11, width: '30%', borderRadius: 4, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)', backgroundSize: '200% 100%', animation: 'shimmer 2s infinite', animationDelay: `${i * 50}ms` }} />
              </div>
              <div style={{ height: 11, width: '85%', borderRadius: 4, marginLeft: 12, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)', backgroundSize: '200% 100%', animation: 'shimmer 2s infinite', animationDelay: `${i * 80}ms`, marginBottom: 4 }} />
              <div style={{ height: 11, width: '60%', borderRadius: 4, marginLeft: 12, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)', backgroundSize: '200% 100%', animation: 'shimmer 2s infinite', animationDelay: `${i * 110}ms` }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // --- REMIX: compact ---
  if (remix === 'compact') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', padding: '2px 0', position: 'relative' }}>
        <button onClick={cycleRemix} className="you-remix-btn">compact</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--text-secondary)">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Crypto X</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {feed.map((post, i) => (
            <div key={post.id} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0',
              borderBottom: i < feed.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
              cursor: 'pointer',
            }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: sentimentColor[post.sentiment], flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', flexShrink: 0, width: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {post.handle}
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--text-secondary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {post.text}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>
                {post.time}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // --- REMIX: highlight ---
  if (remix === 'highlight') {
    const top3 = [...feed].sort((a, b) => (b.engagementScore || b.likes || 0) - (a.engagementScore || a.likes || 0)).slice(0, 3)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', padding: '2px 0', position: 'relative' }}>
        <button onClick={cycleRemix} className="you-remix-btn">highlight</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--text-secondary)">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Top Posts</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {top3.map((post) => (
            <div key={post.id} style={{
              padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: sentimentColor[post.sentiment] }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
                  {post.handle}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>
                  {post.time}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)', marginBottom: 8 }}>
                {post.text}
              </div>
              <div style={{ display: 'flex', gap: 12, fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>
                <span>{formatEngagement(post.likes)} likes</span>
                <span>{formatEngagement(post.reposts)} reposts</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // --- REMIX: feed (default) ---
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      height: '100%',
      padding: '2px 0',
      position: 'relative',
    }}>
      <button onClick={cycleRemix} className="you-remix-btn">feed</button>
      {/* Header: X logo + title */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        {/* X logo */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--text-secondary)">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-secondary)',
        }}>
          Crypto X
        </span>
      </div>

      {/* Scrollable feed */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {feed.map((post, i) => (
          <div
            key={post.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '10px 0',
              borderBottom: i < feed.length - 1
                ? '1px solid rgba(255,255,255,0.04)'
                : 'none',
              cursor: 'pointer',
            }}
          >
            {/* Top row: handle + time + sentiment */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              {/* Sentiment dot */}
              <div style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: sentimentColor[post.sentiment],
                flexShrink: 0,
              }} />

              {/* Handle */}
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-primary)',
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {post.handle}
              </span>

              {/* Time */}
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: 'var(--text-muted)',
                flexShrink: 0,
              }}>
                {post.time}
              </span>
            </div>

            {/* Post text */}
            <div style={{
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              lineHeight: 1.5,
              color: 'var(--text-secondary)',
              paddingLeft: 12,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
            }}>
              {post.text}
            </div>

            {/* Engagement row */}
            {(post.likes > 0 || post.reposts > 0) && (
              <div style={{
                display: 'flex', gap: 10, paddingLeft: 12,
                fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)',
              }}>
                {post.likes > 0 && <span>{formatEngagement(post.likes)} likes</span>}
                {post.reposts > 0 && <span>{formatEngagement(post.reposts)} reposts</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
