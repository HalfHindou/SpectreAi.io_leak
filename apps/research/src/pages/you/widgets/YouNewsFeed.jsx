/**
 * YouNewsFeed — Crypto news feed with scrollable items.
 * Shows sentiment dot, source badge, title, category pill, and timestamp.
 * Fetches from /ext-api/news/rss with auto-refresh every 60s.
 * Supports remix modes: feed (default), headlines, cards.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'

const RSS_API_URL = '/api/news/rss'
const REMIX_KEY = 'spectre:you-remix-news'
const REMIX_MODES = ['feed', 'headlines', 'cards']

// 2026-05-26 beta-quality fix: removed 8 hardcoded fake headlines
// ("Bitcoin Surges Past $89K...") that rendered as real news if RSS failed.
const FALLBACK_NEWS = []

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
  const diff = Math.max(0, now - ts)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const BULLISH_KEYWORDS = ['surge', 'rally', 'bull', 'gain', 'high', 'record', 'inflow', 'adoption', 'approval', 'launch', 'growth']
const BEARISH_KEYWORDS = ['crash', 'drop', 'bear', 'fall', 'low', 'decline', 'outflow', 'hack', 'ban', 'loss', 'sell', 'hawkish']

function deriveSentiment(title = '', summary = '') {
  const text = (title + ' ' + summary).toLowerCase()
  const bullCount = BULLISH_KEYWORDS.filter(k => text.includes(k)).length
  const bearCount = BEARISH_KEYWORDS.filter(k => text.includes(k)).length
  if (bullCount > bearCount) return 'bullish'
  if (bearCount > bullCount) return 'bearish'
  return 'neutral'
}

function deriveCategory(categories = [], title = '') {
  if (categories.length > 0) return categories[0]
  const t = title.toLowerCase()
  if (t.includes('defi') || t.includes('lending') || t.includes('tvl')) return 'DeFi'
  if (t.includes('regulation') || t.includes('sec') || t.includes('etf')) return 'Regulation'
  if (t.includes('fed') || t.includes('macro') || t.includes('rate')) return 'Macro'
  if (t.includes('chain') || t.includes('dex') || t.includes('volume')) return 'On-Chain'
  if (t.includes(' ai ') || t.includes('artificial')) return 'AI'
  if (t.includes('mining') || t.includes('hash')) return 'Mining'
  return 'Markets'
}

export default function YouNewsFeed() {
  const [news, setNews] = useState(FALLBACK_NEWS)
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

  const fetchNews = useCallback(async (signal, showLoading = true) => {
    try {
      if (showLoading) setLoading(true)
      const res = await fetch(RSS_API_URL, { signal })
      if (!res.ok) throw new Error(`RSS API error: ${res.status}`)
      const data = await res.json()
      const results = data?.results || []
      if (results.length > 0 && !signal?.aborted && mountedRef.current) {
        const items = results.map((item, i) => ({
          id: item.id || item.title || i,
          source: item.source || '',
          title: decodeHtml(item.title) || '',
          summary: decodeHtml(item.summary) || '',
          time: relativeTime(item.publishedOn || item.publishedAt),
          category: deriveCategory(item.categories, item.title),
          sentiment: deriveSentiment(item.title, item.summary),
          url: item.url || '#',
        }))
        setNews(items)
      }
      if (!signal?.aborted && mountedRef.current) setLoading(false)
    } catch (e) {
      if (e.name === 'AbortError') return
      if (!signal?.aborted && mountedRef.current) {
        setNews(prev => prev.length > 0 ? prev : FALLBACK_NEWS)
        setLoading(false)
      }
    }
  }, [])

  const pollNews = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    fetchNews(ctrl.signal, false)
  }, [fetchNews])

  useEffect(() => {
    mountedRef.current = true
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    fetchNews(controller.signal, true)

    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchNews])

  useAdaptivePolling(pollNews, { interval: 60_000 })

  const sentimentColor = {
    bullish: 'var(--bull)',
    bearish: 'var(--bear)',
    neutral: 'var(--text-muted)',
  }

  const categoryColors = {
    Markets: '#3b82f6',
    DeFi: '#8b5cf6',
    Macro: '#f59e0b',
    'On-Chain': '#06b6d4',
    Regulation: '#6366f1',
    AI: '#ec4899',
    Mining: '#78716c',
  }

  // Shimmer loading state
  if (loading && news === FALLBACK_NEWS) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%', padding: '2px 0' }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 0',
            borderBottom: i < 5 ? '1px solid rgba(255,255,255,0.04)' : 'none',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', flexShrink: 0, marginTop: 4 }} />
            <div style={{ flex: 1 }}>
              <div style={{ height: 10, width: '30%', borderRadius: 4, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)', backgroundSize: '200% 100%', animation: 'shimmer 2s infinite', marginBottom: 6 }} />
              <div style={{ height: 12, width: '90%', borderRadius: 4, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)', backgroundSize: '200% 100%', animation: 'shimmer 2s infinite', animationDelay: `${i * 50}ms`, marginBottom: 4 }} />
              <div style={{ height: 10, width: '60%', borderRadius: 4, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)', backgroundSize: '200% 100%', animation: 'shimmer 2s infinite', animationDelay: `${i * 80}ms` }} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  // --- REMIX: headlines ---
  if (remix === 'headlines') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%', padding: '2px 0', position: 'relative' }}>
        <button onClick={cycleRemix} className="you-remix-btn">headlines</button>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {news.map((item, i) => (
            <div key={item.id} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0',
              borderBottom: i < news.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
              cursor: 'pointer',
            }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: sentimentColor[item.sentiment], flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.title}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>
                {item.time}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // --- REMIX: cards ---
  if (remix === 'cards') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%', padding: '2px 0', position: 'relative' }}>
        <button onClick={cycleRemix} className="you-remix-btn">cards</button>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
          {news.map((item) => (
            <div key={item.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
              background: 'rgba(255,255,255,0.02)', borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}>
              {/* Source icon circle */}
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: (categoryColors[item.category] || '#555') + '20',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
                color: categoryColors[item.category] || 'var(--text-secondary)',
              }}>
                {(item.source || '?')[0]}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.title}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                  {item.source} &middot; {item.time}
                </div>
              </div>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: sentimentColor[item.sentiment], flexShrink: 0 }} />
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
      gap: 0,
      height: '100%',
      padding: '2px 0',
      position: 'relative',
    }}>
      <button onClick={cycleRemix} className="you-remix-btn">feed</button>
      {/* Scrollable news list */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {news.map((item, i) => (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '10px 0',
              borderBottom: i < news.length - 1
                ? '1px solid rgba(255,255,255,0.04)'
                : 'none',
              cursor: 'pointer',
            }}
          >
            {/* Sentiment dot */}
            <div style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: sentimentColor[item.sentiment],
              flexShrink: 0,
              marginTop: 4,
            }} />

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Source + Category row */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 3,
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text-muted)',
                }}>
                  {item.source}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  padding: '2px 8px',
                  borderRadius: 20,
                  background: (categoryColors[item.category] || '#555') + '18',
                  color: categoryColors[item.category] || 'var(--text-secondary)',
                  letterSpacing: '0.03em',
                }}>
                  {item.category}
                </span>
              </div>

              {/* Title */}
              <div style={{
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--text-primary)',
                lineHeight: 1.4,
                marginBottom: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}>
                {item.title}
              </div>

              {/* Summary */}
              <div style={{
                fontFamily: 'var(--font-body)',
                fontSize: 10,
                color: 'var(--text-muted)',
                lineHeight: 1.4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {item.summary}
              </div>
            </div>

            {/* Time */}
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--text-muted)',
              flexShrink: 0,
              marginTop: 2,
              whiteSpace: 'nowrap',
            }}>
              {item.time}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
