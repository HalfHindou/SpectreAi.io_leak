/**
 * NewsTabPanel - shared News / X(Posts) tab for the horizontal Command Center
 *
 * Features:
 *   - AI News Digest (client-side summary of current news landscape)
 *   - News source favicons via Google Favicons API
 *   - Article image thumbnails (imageUrl from API)
 *   - 2-column grid with hero + regular cards
 *   - X/Posts toggle with mock tweet data
 *
 * Props:
 *   newsXToggle   - boolean (false = News, true = X/Posts)
 *   setNewsXToggle - setter
 *   newsItems     - array of news objects from cryptoNewsApi / stockNewsApi
 *   newsLoading   - boolean
 *   isStocks      - boolean (stocks vs crypto mode)
 *   t             - i18n translation function
 */
import React, { memo, useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { isDev } from '@/utils/env'

/* ── Linkify URLs in text (for tweet bodies) ── */
const URL_RE = /https?:\/\/[^\s<)}\]]+/g
function linkifyText(text) {
  if (!text || typeof text !== 'string') return text
  const parts = []
  let lastIndex = 0
  let match
  URL_RE.lastIndex = 0
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const url = match[0].replace(/[.,;:!?)]+$/, '')
    parts.push(
      <a key={match.index} className="news-feed-x-link" href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
        {url.replace(/^https?:\/\//, '').slice(0, 30)}{url.replace(/^https?:\/\//, '').length > 30 ? '…' : ''}
      </a>
    )
    lastIndex = match.index + url.length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts.length > 0 ? parts : text
}

/* ── News source → domain for favicon lookup ── */
const NEWS_SOURCE_DOMAINS = {
  coindesk: 'coindesk.com',
  'the block': 'theblock.co',
  theblock: 'theblock.co',
  bloomberg: 'bloomberg.com',
  reuters: 'reuters.com',
  decrypt: 'decrypt.co',
  cointelegraph: 'cointelegraph.com',
  cointelgraph: 'cointelegraph.com',
  'crypto briefing': 'cryptobriefing.com',
  'bitcoin magazine': 'bitcoinmagazine.com',
  blockworks: 'blockworks.co',
  defiant: 'thedefiant.io',
  'the defiant': 'thedefiant.io',
  dlnews: 'dlnews.com',
  unchained: 'unchainedcrypto.com',
  benzinga: 'benzinga.com',
  cnbc: 'cnbc.com',
  'wall street journal': 'wsj.com',
  wsj: 'wsj.com',
  'financial times': 'ft.com',
  ft: 'ft.com',
  'yahoo finance': 'finance.yahoo.com',
  yahoo: 'finance.yahoo.com',
  'market watch': 'marketwatch.com',
  marketwatch: 'marketwatch.com',
  'seeking alpha': 'seekingalpha.com',
  barrons: 'barrons.com',
  "barron's": 'barrons.com',
  investopedia: 'investopedia.com',
  fortune: 'fortune.com',
  forbes: 'forbes.com',
  cryptopanic: 'cryptopanic.com',
}

const getNewsSourceIcon = (source) => {
  if (!source) return null
  const key = source.toLowerCase().trim()
  const domain = NEWS_SOURCE_DOMAINS[key]
  if (domain) return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
  const guessed = key.replace(/\s+/g, '') + '.com'
  return `https://www.google.com/s2/favicons?domain=${guessed}&sz=32`
}

/* ── AI News Digest generator ── */
const CATEGORY_LABELS = {
  markets: 'Markets',
  defi: 'DeFi',
  regulation: 'Regulation',
  macro: 'Macro',
  technology: 'Technology',
  nft: 'NFTs',
  gaming: 'Gaming',
  layer2: 'Layer 2',
}

function generateDigest(items, isStocks) {
  if (!items || items.length === 0) return null

  // Freshness
  const newest = items[0]
  const ageSec = newest?.publishedOn ? Math.floor(Date.now() / 1000 - newest.publishedOn) : 0
  const freshLabel = ageSec < 60 ? 'Just now' : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m ago` : `${Math.floor(ageSec / 3600)}h ago`

  // Unique sources as tags
  const sources = [...new Set(items.map(n => (n.source || '').trim()).filter(Boolean))]
  const tags = sources.slice(0, 4).join(' \u00b7 ')

  return `${freshLabel}${tags ? ' - ' + tags : ''}`
}

/* ── AI Analysis generator - structured overview ── */
function generateAnalysis(items, isStocks) {
  if (!items || items.length < 2) return null

  const catCounts = {}
  const sourceCounts = {}
  let bullish = 0, bearish = 0

  items.forEach(n => {
    const cat = (n.categories?.[0] || 'markets').toLowerCase()
    catCounts[cat] = (catCounts[cat] || 0) + 1
    if (n.source) sourceCounts[n.source] = (sourceCounts[n.source] || 0) + 1

    // Use same regex as card-level getArticleSentiment for consistency
    const text = (n.title || '') + ' ' + (n.summary || '')
    const bull = BULLISH_RE.test(text)
    const bear = BEARISH_RE.test(text)
    if (bull && !bear) bullish++
    else if (bear && !bull) bearish++
    // mixed (both) and neutral (neither) → neither count
  })

  const neutral = items.length - bullish - bearish
  const total = items.length
  const sorted = Object.entries(catCounts).sort((a, b) => b[1] - a[1])
  const themes = sorted.slice(0, 3).map(([k, v]) => ({ label: CATEGORY_LABELS[k] || k, count: v }))
  const topSource = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0]?.[0]

  const sentiment = bullish > bearish + 1 ? 'bullish' : bearish > bullish + 1 ? 'bearish' : 'mixed'
  const sentimentLabel = sentiment === 'bullish' ? 'Bullish' : sentiment === 'bearish' ? 'Bearish' : 'Mixed'

  // Conviction score (0-100 based on sentiment clarity)
  const dominant = Math.max(bullish, bearish)
  const conviction = total > 0 ? Math.round((dominant / total) * 100) : 50

  // One-line editorial take
  const prefix = isStocks ? 'Stock' : 'Crypto'
  let headline
  if (sentiment === 'bullish') {
    headline = `${prefix} sentiment is leaning positive - ${topSource || 'major outlets'} driving optimism.`
  } else if (sentiment === 'bearish') {
    headline = `Caution in ${prefix.toLowerCase()} markets - negative signals outweigh positive coverage.`
  } else {
    headline = `${prefix} narratives are split - no clear directional consensus across sources.`
  }

  // Source count for coverage line
  const sourceCount = Object.keys(sourceCounts).length

  // Time span
  const newest = items[0]
  const oldest = items[items.length - 1]
  const spanHrs = newest?.publishedOn && oldest?.publishedOn
    ? Math.max(1, Math.round((newest.publishedOn - oldest.publishedOn) / 3600))
    : null

  return { sentiment, sentimentLabel, headline, themes, bullish, bearish, neutral, total, conviction, sourceCount, spanHrs }
}

/* ── Helpers ── */
const BULLISH_RE = /surge|rally|bullish|record|high|soar|gain|inflow|breakout|accelerat|recover|ath|all.time|boom|optimis/i
const BEARISH_RE = /crash|dump|bearish|decline|fall|drop|outflow|fear|sell|delay|reject|plunge|panic|capitulat|risk|warning|concern/i

function getArticleSentiment(news) {
  const text = (news?.title || '') + ' ' + (news?.summary || '')
  const bull = BULLISH_RE.test(text)
  const bear = BEARISH_RE.test(text)
  if (bull && !bear) return 'positive'
  if (bear && !bull) return 'negative'
  if (bull && bear) return 'mixed'
  return 'neutral'
}

const getImageUrl = (news, highRes = false) => {
  const url = news?.imageUrl || news?.image || null
  if (!url) return null
  // CryptoCompare images: upgrade to higher resolution
  if (url.includes('cryptocompare.com')) {
    // Strip any existing width param, request larger
    const base = url.replace(/[?&]width=\d+/g, '')
    const sep = base.includes('?') ? '&' : '?'
    return `${base}${sep}width=${highRes ? 840 : 480}`
  }
  // Unsplash images: upgrade w/h params for 4K crispness
  if (url.includes('unsplash.com')) {
    return url
      .replace(/w=\d+/, `w=${highRes ? 840 : 480}`)
      .replace(/h=\d+/, `h=${highRes ? 560 : 320}`)
  }
  return url
}

/* Category-based placeholders for cards without images. The gradient + icon
   live in `tab-panels.css` keyed off `data-category` so day mode can paint
   light backgrounds — inline styles win over .app-day-mode overrides. */
const CATEGORY_LIST = new Set(['markets', 'defi', 'regulation', 'macro', 'technology', 'nft'])

const CATEGORY_ICONS = {
  markets: '\u{1F4C8}',     // 📈
  defi: '\u{1F517}',        // 🔗
  regulation: '\u{2696}',   // ⚖️
  macro: '\u{1F30D}',       // 🌍
  technology: '\u{2699}',   // ⚙️
  nft: '\u{1F5BC}',         // 🖼️
}

function NewsThumb({ news, isHero }) {
  const img = getImageUrl(news, isHero)
  const rawCat = (news?.categories?.[0] || '').toLowerCase()
  const cat = CATEGORY_LIST.has(rawCat) ? rawCat : 'default'
  const cls = isHero ? 'news-card-thumb news-card-thumb-hero' : 'news-card-thumb'
  const icon = CATEGORY_ICONS[cat] || '\u{1F4F0}' // 📰

  // Recover blocked/hotlink-protected images: try the direct URL, then the
  // same-origin /api/img-proxy, and only THEN fall to the category placeholder.
  // Most "missing" news images are just referrer/CORS-blocked, not truly 404 —
  // the proxy fetches them server-side and serves them same-origin.
  const [stage, setStage] = useState(0) // 0 = direct, 1 = proxy, 2 = give up
  useEffect(() => { setStage(0) }, [img])
  const src = !img
    ? null
    : (stage === 0 ? img : stage === 1 ? `/api/img-proxy?url=${encodeURIComponent(img)}` : null)

  if (src) {
    return (
      <div
        className={`news-thumb-frame ${isHero ? 'hero' : ''}`}
        data-category={cat}
        data-placeholder-icon={icon}
      >
        <img
          key={stage}
          src={src}
          alt=""
          className={cls}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setStage((s) => s + 1)}
        />
        <div className="news-thumb-overlay" />
      </div>
    )
  }

  // No image, or both direct + proxy failed — category placeholder.
  return (
    <div
      className={`news-thumb-frame ${isHero ? 'hero' : ''} placeholder`}
      data-category={cat}
      data-placeholder-icon={icon}
    >
      <span className="news-thumb-placeholder-icon">{icon}</span>
    </div>
  )
}

const formatTimeAgo = (publishedOn) => {
  if (!publishedOn) return ''
  const diff = Math.floor(Date.now() / 1000 - publishedOn)
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

/* ── Hero Slider Card - renders a single Intelligence article ── */
function HeroSliderCard({ article, onClick }) {
  if (!article) return null
  const headline = (article.headline || article.title || '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s*/gm, '')
  // Build summary: prefer contentPreview (richer), fallback to summary. Strip headline echo.
  const raw = (article.contentPreview || article.summary || '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s*/gm, '').replace(/\n+/g, ' ').trim()
  const summary = raw.startsWith(headline) ? raw.slice(headline.length).trim() : raw
  const coverPhoto = article.coverImage || article.sourceArticle?.imageUrl || (!isDev && article.slug ? `/api/hero/${article.slug}` : null)
  const isBreaking = article.isBreaking
  const sentiment = article.sentiment
  const categoryLabel = (article.category || article.type || 'Markets').charAt(0).toUpperCase() + (article.category || article.type || 'Markets').slice(1)
  const CATEGORY_COLORS = {
    bitcoin: '#F7931A', ethereum: '#627EEA', eth: '#627EEA', defi: '#10B981', stocks: '#3B82F6',
    macro: '#F59E0B', regulation: '#EF4444', ai: '#A855F7', markets: '#6B7280',
    crypto: '#6B7280', daily: '#06B6D4', news: '#EF4444', research: '#06B6D4',
    exchange: '#F59E0B', business: '#3B82F6', technology: '#06B6D4', mining: '#10B981',
    trading: '#10B981', altcoin: '#627EEA', ico: '#EC4899', blockchain: '#3B82F6',
  }
  const catColor = CATEGORY_COLORS[(article.category || article.type || '').toLowerCase()] || '#6B7280'
  const isSpectre = article.isOriginal || article.sourceArticle?.source === 'Spectre AI'
  const sourceName = isSpectre ? 'Spectre AI' : (article.sourceArticle?.source || 'News Wire')

  // Time ago
  const publishedAt = article.publishedAt
  const time = (() => {
    if (!publishedAt) return ''
    const diff = Date.now() - new Date(publishedAt).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  })()

  return (
    <article className={`cc-hero-slide${isBreaking ? ' cc-hero-slide--breaking' : ''}`} onClick={onClick} role="button" tabIndex={0}>
      <div className="cc-hero-slide__inner">
        {/* Image side */}
        <div className="cc-hero-slide__image">
          {coverPhoto ? (
            <img src={coverPhoto} alt={headline} loading="eager" draggable={false} onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.classList.add('cc-hero-slide__image--fallback') }} />
          ) : (
            <div className="cc-hero-slide__image--fallback" style={{ background: `linear-gradient(135deg, ${catColor}22 0%, ${catColor}08 40%, rgba(0,0,0,0.3) 100%)` }}>
              <span style={{ color: `${catColor}88`, fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em' }}>SPECTRE</span>
            </div>
          )}
        </div>

        {/* Text side */}
        <div className="cc-hero-slide__text">
          {isBreaking ? (
            <div className="cc-hero-slide__badge cc-hero-slide__badge--breaking">
              <span className="cc-hero-slide__badge-dot" />
              BREAKING
              {sentiment && <span className={`cc-hero-slide__sentiment cc-hero-slide__sentiment--${sentiment}`}>{sentiment === 'bullish' ? '\u25B2' : sentiment === 'bearish' ? '\u25BC' : '\u2013'} {sentiment}</span>}
            </div>
          ) : (
            <div className="cc-hero-slide__badge">
              <span className="cc-hero-slide__badge-square" style={{ background: catColor }} />
              {categoryLabel.toUpperCase()}
            </div>
          )}
          <h3 className="cc-hero-slide__headline">{headline}</h3>
          {summary && <p className="cc-hero-slide__summary">{summary}</p>}
          <div className="cc-hero-slide__meta">
            <span className="cc-hero-slide__time">{time}</span>
            <span className="cc-hero-slide__sep" />
            <span className={`cc-hero-slide__source ${isSpectre ? 'cc-hero-slide__source--spectre' : ''}`}>
              {isSpectre ? '\u2605 Spectre AI' : `Via ${sourceName}`}
            </span>
          </div>
        </div>
      </div>
    </article>
  )
}

// 2026-05-26 beta-quality fix: removed 16 fabricated news cards (fake "BTC $89K" / "Fed rate cuts Q2" / "Hong Kong ETF" headlines).
// If upstream news feed returns empty, panel now renders no items rather than lying.
const FALLBACK_NEWS = []

/* ── Parse stat string and increment by 1 ── */
function incrementStat(val) {
  if (!val) return '1'
  const s = formatCount(val)
  if (s.endsWith('K') || s.endsWith('M')) return s // 2.4K + 1 is still 2.4K
  const n = parseInt(String(val).replace(/,/g, ''), 10)
  return isNaN(n) ? val : formatCount(n + 1)
}

/* ── Format large numbers for display (1500 → "1.5K", 284491 → "284K") ── */
function formatCount(n) {
  if (n == null) return '0'
  if (typeof n === 'string') return n
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return String(n)
}

/* ── Format tweet timestamp as relative time ("5m", "2h", "1d") ── */
function formatTweetTime(isoStr) {
  if (!isoStr) return ''
  const now = Date.now()
  const then = new Date(isoStr).getTime()
  if (isNaN(then)) return ''
  const diffSec = Math.floor((now - then) / 1000)
  if (diffSec < 60) return `${Math.max(0, diffSec)}s`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d`
}

function NewsTabPanel({ newsXToggle, setNewsXToggle, newsItems, newsLoading, isStocks, t, xPosts = [], xPostsLoading = false, xPostsError = null, onRetryXPosts, onSelectNewsDetail, hideToggle = false }) {
  const { t: tr } = useTranslation()
  const allNews = useMemo(() => newsItems.length > 0 ? newsItems : FALLBACK_NEWS, [newsItems])
  // Compute digest & analysis from all available articles
  const visibleNews = useMemo(() => allNews, [allNews])
  const digest = useMemo(() => generateDigest(visibleNews, isStocks), [visibleNews, isStocks])
  const analysis = useMemo(() => generateAnalysis(visibleNews, isStocks), [visibleNews, isStocks])

  const isMobile = useIsMobile()
  const [showAllPosts, setShowAllPosts] = useState(false)

  // ── News view mode: 'slider' (default) or 'list' ──
  const [newsViewMode, setNewsViewMode] = useState('list')

  const openNewsDetail = useCallback((newsItem) => {
    if (onSelectNewsDetail) onSelectNewsDetail({ type: 'news', data: newsItem })
  }, [onSelectNewsDetail])

  const openTweetDetail = useCallback((tweet) => {
    if (onSelectNewsDetail) onSelectNewsDetail({ type: 'tweet', data: tweet })
  }, [onSelectNewsDetail])

  // ── Slider articles derived from the same news as list view ──
  const sliderArticles = useMemo(() => allNews.map((n, i) => {
    const s = getArticleSentiment(n)
    return {
      title: n.title,
      headline: n.title,
      summary: n.summary,
      contentPreview: n.summary,
      coverImage: getImageUrl(n, true),
      sourceArticle: { source: n.source, imageUrl: getImageUrl(n, true) },
      publishedAt: n.publishedOn ? new Date(n.publishedOn * 1000).toISOString() : null,
      category: (n.categories?.[0] || 'markets').toLowerCase(),
      type: 'news',
      slug: `news-${n.id || i}`,
      url: n.url,
      isBreaking: i === 0,
      sentiment: s === 'positive' ? 'bullish' : s === 'negative' ? 'bearish' : null,
    }
  }), [allNews])

  const [heroIndex, setHeroIndex] = useState(0)
  const heroTimerRef = useRef(null)

  // Auto-rotate hero slider every 8 seconds
  useEffect(() => {
    if (newsViewMode !== 'slider' || sliderArticles.length <= 1) return
    heroTimerRef.current = setInterval(() => {
      // Skip advance while tab is hidden — re-render + image swap is wasteful.
      if (document.hidden) return
      setHeroIndex(prev => (prev + 1) % sliderArticles.length)
    }, 8000)
    return () => clearInterval(heroTimerRef.current)
  }, [newsViewMode, sliderArticles.length])

  // ── Drag / swipe to change slides ──
  const dragRef = useRef({ startX: 0, startY: 0, dragging: false, didSwipe: false })

  const onPointerDown = useCallback((e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, dragging: true, didSwipe: false }
  }, [])

  const onPointerUp = useCallback((e) => {
    if (!dragRef.current.dragging) return
    dragRef.current.dragging = false
    const dx = e.clientX - dragRef.current.startX
    const dy = Math.abs(e.clientY - dragRef.current.startY)
    const threshold = 40
    // Only trigger if horizontal swipe is dominant
    if (Math.abs(dx) < threshold || dy > Math.abs(dx)) return
    dragRef.current.didSwipe = true
    e.preventDefault()
    e.stopPropagation()
    const len = sliderArticles.length
    if (len <= 1) return
    const nextIdx = dx < 0
      ? (heroIndex + 1) % len        // drag left → next
      : (heroIndex - 1 + len) % len   // drag right → prev
    setHeroIndex(nextIdx)
    // Reset auto-rotate timer
    if (heroTimerRef.current) clearInterval(heroTimerRef.current)
    if (len > 1) {
      heroTimerRef.current = setInterval(() => {
        if (document.hidden) return
        setHeroIndex(prev => (prev + 1) % len)
      }, 8000)
    }
  }, [heroIndex, sliderArticles.length])

  const handleHeroDot = useCallback((idx) => {
    setHeroIndex(idx)
    if (heroTimerRef.current) clearInterval(heroTimerRef.current)
    if (sliderArticles.length > 1) {
      heroTimerRef.current = setInterval(() => {
        if (document.hidden) return
        setHeroIndex(prev => (prev + 1) % sliderArticles.length)
      }, 8000)
    }
  }, [sliderArticles.length])

  // Track liked / replied / reposted state per tweet (keyed by handle)
  const [tweetInteractions, setTweetInteractions] = useState({})
  const toggleInteraction = (id, type, e) => {
    e.stopPropagation()
    setTweetInteractions(prev => ({
      ...prev,
      [id]: { ...prev[id], [type]: !prev[id]?.[type] }
    }))
  }

  return (
    <div className="news-feed-panel">
      {/* News / X toggle header */}
      {!hideToggle && (
      <div className="news-feed-mode-bar-row">
        <div className="news-feed-mode-bar">
          <button className={`news-feed-mode-btn ${!newsXToggle ? 'active' : ''}`} onClick={() => setNewsXToggle(false)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/></svg>
            {tr('homePage.newsTabPanel.newstabpanel.news', "News")}
          </button>
          <button className={`news-feed-mode-btn ${newsXToggle ? 'active' : ''}`} onClick={() => setNewsXToggle(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            {tr('homePage.newsTabPanel.newstabpanel.posts', "Posts")}
          </button>
        </div>

        {/* Slider / List sub-toggle - only visible when News tab is active */}
        {!newsXToggle && (
          <div className="news-feed-view-toggle">
            <button className={`news-feed-view-btn ${newsViewMode === 'slider' ? 'active' : ''}`} onClick={() => setNewsViewMode('slider')} title={tr('homePage.newsTabPanel.newstabpanel.title', "Slider view")}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            </button>
            <button className={`news-feed-view-btn ${newsViewMode === 'list' ? 'active' : ''}`} onClick={() => setNewsViewMode('list')} title={tr('homePage.newsTabPanel.newstabpanel.title2', "List view")}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
          </div>
        )}
      </div>
      )}

      {/* View mode toggle when hideToggle is on and showing news */}
      {hideToggle && !newsXToggle && (
        <div className="news-feed-mode-bar-row">
          <div className="news-feed-view-toggle">
            <button className={`news-feed-view-btn ${newsViewMode === 'slider' ? 'active' : ''}`} onClick={() => setNewsViewMode('slider')} title={tr('homePage.newsTabPanel.newstabpanel.title', "Slider view")}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            </button>
            <button className={`news-feed-view-btn ${newsViewMode === 'list' ? 'active' : ''}`} onClick={() => setNewsViewMode('list')} title={tr('homePage.newsTabPanel.newstabpanel.title2', "List view")}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
          </div>
        </div>
      )}

      {!newsXToggle ? (
        newsViewMode === 'slider' ? (
          /* SLIDER VIEW - Same news as list, displayed as hero cards with rotation */
          <div
            className="cc-hero-slider-wrap"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            style={{ touchAction: 'pan-y' }}
          >
            {newsLoading || sliderArticles.length === 0 ? (
              <div className="cc-hero-slider-loading">
                <div className="news-feed-loading-shimmer" style={{ height: '200px', borderRadius: '14px' }} />
              </div>
            ) : (
              <>
                <HeroSliderCard
                  article={sliderArticles[heroIndex]}
                  onClick={() => {
                    if (dragRef.current.didSwipe) { dragRef.current.didSwipe = false; return }
                    // Open detail sidebar with the original news item
                    const originalNews = allNews[heroIndex]
                    if (originalNews) openNewsDetail(originalNews)
                  }}
                />
                {sliderArticles.length > 1 && (
                  <div className="cc-hero-dots">
                    {sliderArticles.map((a, i) => (
                      <button
                        key={a.slug}
                        className={`cc-hero-dot${i === heroIndex ? ' cc-hero-dot--active' : ''}`}
                        onClick={() => handleHeroDot(i)}
                        aria-label={`Show article ${i + 1}`}
                      >
                        {i === heroIndex && <span className="cc-hero-dot__progress" />}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
        /* NEWS LIST - AI digest + 2-column grid with hero card */
        <div className="news-feed-grid">
          {newsLoading ? (
            <>
              <div className="news-feed-loading-shimmer news-card-hero" />
              {[1,2,3,4,5].map(i => <div key={i} className="news-feed-loading-shimmer" />)}
            </>
          ) : (() => {
            const hero = allNews[0]
            const rest = allNews.slice(1)
            const heroTime = formatTimeAgo(hero?.publishedOn)
            const heroSentiment = getArticleSentiment(hero)
            return (
              <>
                {/* AI News Digest - top label */}
                {digest && (
                  <div className="news-ai-digest">
                    <svg className="news-ai-digest-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z"/>
                    </svg>
                    <span className="news-ai-digest-text">{digest}</span>
                  </div>
                )}

                {/* Hero / Featured story */}
                <div className="news-card news-card-hero" role="button" tabIndex={0} onClick={() => hero && openNewsDetail(hero)}>
                  <div className="news-card-hero-content">
                    <div className="news-card-live">
                      <span className="news-card-live-dot" />{tr('homePage.newsTabPanel.newstabpanel.breaking', "BREAKING")}
                    </div>
                    <h3 className="news-card-hero-title">{hero?.title}</h3>
                    <p className="news-card-hero-summary">{hero?.summary}</p>
                    <div className="news-card-meta">
                      <img src={getNewsSourceIcon(hero?.source)} alt="" className="news-card-source-icon" onError={(e) => { e.target.style.display = 'none' }} />
                      <span className="news-card-source">{hero?.source}</span>
                      <span className="news-card-time">{heroTime ? `${heroTime} ago` : ''}</span>
                      <span className={`news-card-sentiment ${heroSentiment}`} />
                      {hero?.categories?.[0] && <span className="news-feed-category">{hero.categories[0]}</span>}
                    </div>
                  </div>
                  <NewsThumb news={hero} isHero />
                </div>

                {/* Rest in 2-col grid */}
                {rest.map((news) => {
                  const timeAgo = formatTimeAgo(news.publishedOn)
                  const sentiment = getArticleSentiment(news)
                  return (
                    <div key={news.id} className="news-card" role="button" tabIndex={0} onClick={() => openNewsDetail(news)}>
                      <div className="news-card-top">
                        <div className="news-card-source-row">
                          <img src={getNewsSourceIcon(news.source)} alt="" className="news-card-source-icon" onError={(e) => { e.target.style.display = 'none' }} />
                          <span className="news-card-source">{news.source}</span>
                          <span className={`news-card-sentiment ${sentiment}`} />
                        </div>
                        <span className="news-card-time">{timeAgo}</span>
                      </div>
                      <div className="news-card-body">
                        <div className="news-card-text">
                          <h4 className="news-card-title">{news.title}</h4>
                          {news.summary && news.summary !== news.title && (
                            <p className="news-card-summary">{news.summary}</p>
                          )}
                        </div>
                        <NewsThumb news={news} />
                      </div>
                      {news.categories?.[0] && (
                        <div className="news-card-bottom">
                          <span className="news-feed-category">{news.categories[0]}</span>
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* AI Analysis - Sectors-style premium card */}
                {analysis && (
                  <div className={`news-ai-analysis bias-${analysis.sentiment === 'bullish' ? 'bullish' : analysis.sentiment === 'bearish' ? 'bearish' : 'neutral'}`}>
                    <div className="news-ai-analysis-glow" />

                    {/* Header: pulse + title + badge */}
                    <div className="news-ai-analysis-header">
                      <div className="news-ai-analysis-header-left">
                        <span className="news-ai-analysis-pulse" />
                        <span className="news-ai-analysis-title">{tr('homePage.newsTabPanel.newstabpanel.aiAnalysis', "AI Analysis")}</span>
                      </div>
                      <span className="news-ai-analysis-badge">{tr('homePage.newsTabPanel.newstabpanel.spectreAi', "Spectre AI")}</span>
                    </div>

                    {/* Editorial headline — main text */}
                    <p className="news-ai-analysis-text">{analysis.headline}</p>

                    {/* Sub-cards */}
                    <div className="news-ai-analysis-cards">
                      {/* Sentiment Breakdown card */}
                      <div className="news-ai-analysis-card">
                        <div className="news-ai-analysis-card-accent" />
                        <div className="news-ai-analysis-card-content">
                          <div className="news-ai-analysis-card-title">{tr('homePage.newsTabPanel.newstabpanel.sentimentBreakdown', "Sentiment Breakdown")}</div>
                          <div className="news-ai-analysis-bar">
                            {analysis.bullish > 0 && <span className="news-ai-analysis-bar-seg bullish" style={{ flex: analysis.bullish }} />}
                            {analysis.neutral > 0 && <span className="news-ai-analysis-bar-seg neutral" style={{ flex: analysis.neutral }} />}
                            {analysis.bearish > 0 && <span className="news-ai-analysis-bar-seg bearish" style={{ flex: analysis.bearish }} />}
                          </div>
                          <div className="news-ai-analysis-stats">
                            <span className="news-ai-analysis-stat positive">{analysis.bullish} positive</span>
                            <span className="news-ai-analysis-stat-sep" />
                            <span className="news-ai-analysis-stat neutral">{analysis.neutral} neutral</span>
                            <span className="news-ai-analysis-stat-sep" />
                            <span className="news-ai-analysis-stat negative">{analysis.bearish} negative</span>
                            <span className="news-ai-analysis-stat-sep" />
                            <span className="news-ai-analysis-conviction">{analysis.conviction}%</span>
                          </div>
                        </div>
                      </div>

                      {/* Coverage card */}
                      <div className="news-ai-analysis-card">
                        <div className="news-ai-analysis-card-accent" />
                        <div className="news-ai-analysis-card-content">
                          <div className="news-ai-analysis-card-title">{tr('homePage.newsTabPanel.newstabpanel.coverage', "Coverage")}</div>
                          <div className="news-ai-analysis-coverage-stats">
                            <span className="news-ai-analysis-coverage-stat">
                              <span className="news-ai-analysis-coverage-num">{analysis.sourceCount}</span> {tr('homePage.newsTabPanel.newstabpanel.sources', "sources")}
                            </span>
                            {analysis.spanHrs > 0 && (
                              <span className="news-ai-analysis-coverage-stat">
                                <span className="news-ai-analysis-coverage-num">{analysis.spanHrs}h</span> {tr('homePage.newsTabPanel.newstabpanel.window', "window")}
                              </span>
                            )}
                            <span className="news-ai-analysis-coverage-stat">
                              <span className="news-ai-analysis-coverage-num">{analysis.total}</span> {tr('homePage.newsTabPanel.newstabpanel.articles', "articles")}
                            </span>
                          </div>
                          {analysis.themes.length > 0 && (
                            <div className="news-ai-analysis-themes">
                              {analysis.themes.map(t => (
                                <span key={t.label} className="news-ai-analysis-tag">{t.label}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )
          })()}
        </div>
        )
      ) : (
        /* X / POSTS - card grid with profile pics, verified badges, previews */
        (() => {
          const postsToRender = xPosts || []

          // X Posts digest - freshness + unique handles
          const xDigest = (() => {
            if (postsToRender.length === 0) return ''
            const newest = postsToRender[0]
            const freshLabel = newest.time ? `${formatTweetTime(newest.time)} ago` : ''
            const handles = postsToRender.map(p => p.name).slice(0, 4).join(' \u00b7 ')
            return `${freshLabel}${handles ? ' - ' + handles : ''}`
          })()

          // X Posts AI Analysis - sentiment from post text
          const xAnalysis = (() => {
            if (postsToRender.length < 2) return null
            let bullish = 0, bearish = 0
            postsToRender.forEach(p => {
              const bull = BULLISH_RE.test(p.text)
              const bear = BEARISH_RE.test(p.text)
              if (bull && !bear) bullish++
              else if (bear && !bull) bearish++
            })
            const neutral = postsToRender.length - bullish - bearish
            const total = postsToRender.length
            const sentiment = bullish > bearish + 1 ? 'bullish' : bearish > bullish + 1 ? 'bearish' : 'mixed'
            const sentimentLabel = sentiment === 'bullish' ? 'Bullish' : sentiment === 'bearish' ? 'Bearish' : 'Mixed'
            const dominant = Math.max(bullish, bearish)
            const conviction = total > 0 ? Math.round((dominant / total) * 100) : 50
            const headline = sentiment === 'bullish'
              ? 'Crypto X sentiment is decisively positive - influencers loading positions.'
              : sentiment === 'bearish'
              ? 'Bearish signals dominating crypto X - caution across top accounts.'
              : 'Mixed signals across crypto X - no clear directional consensus.'
            const uniqueHandles = [...new Set(postsToRender.map(p => p.handle))].length
            return { sentiment, sentimentLabel, headline, bullish, bearish, neutral, total, conviction, uniqueHandles }
          })()

          return (
            <div className="news-feed-x-grid">
              {/* X Posts Digest - LIVE indicator + freshness + sources */}
              {postsToRender.length > 0 && xDigest && (
                <div className="news-ai-digest news-x-digest">
                  <span className="news-x-live-dot" />
                  <svg className="news-ai-digest-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  <span className="news-ai-digest-text">{xDigest}</span>
                </div>
              )}

              {/* Loading skeleton - tweet-shaped cards with staggered shimmer */}
              {xPostsLoading && postsToRender.length === 0 && Array.from({ length: 6 }).map((_, i) => (
                <div key={`skel-${i}`} className="news-x-card news-x-card--skeleton" style={{ animationDelay: `${i * 80}ms` }}>
                  <div className="news-x-card-head">
                    <div className="news-x-skel-avatar" />
                    <div className="news-x-skel-meta">
                      <div className="news-x-skel-line news-x-skel-line--name" />
                      <div className="news-x-skel-line news-x-skel-line--handle" />
                    </div>
                    <div className="news-x-skel-time" />
                  </div>
                  <div className="news-x-skel-body">
                    <div className="news-x-skel-line news-x-skel-line--text-1" />
                    <div className="news-x-skel-line news-x-skel-line--text-2" />
                    <div className="news-x-skel-line news-x-skel-line--text-3" />
                  </div>
                  {i % 3 === 0 && <div className="news-x-skel-media" />}
                  <div className="news-x-skel-actions">
                    <div className="news-x-skel-action" />
                    <div className="news-x-skel-action" />
                    <div className="news-x-skel-action" />
                    <div className="news-x-skel-action" />
                  </div>
                </div>
              ))}

              {/* Loaded fine, nothing to show. /api/welcome/x-tweets answers 200
                  with an empty list while the X feed rebuilds its index, which
                  matched neither the skeleton nor the error branch - so the tab
                  rendered a blank 640px void with no explanation at all. */}
              {!xPostsLoading && !xPostsError && postsToRender.length === 0 && (
                <div className="news-feed-error">
                  <p>{t('welcome.posts.empty', 'No posts right now - the X feed is rebuilding its index.')}</p>
                  {onRetryXPosts && <button className="news-feed-retry-btn" onClick={onRetryXPosts}>{t('common.retry', 'Retry')}</button>}
                </div>
              )}

              {/* Error state */}
              {xPostsError && !xPostsLoading && postsToRender.length === 0 && (
                <div className="news-feed-error">
                  <p>{tr('homePage.newsTabPanel.newstabpanel.failedToLoadPosts', "Failed to load posts")}</p>
                  {onRetryXPosts && <button className="news-feed-retry-btn" onClick={onRetryXPosts}>{tr('homePage.newsTabPanel.newstabpanel.retry', "Retry")}</button>}
                </div>
              )}

              {/* Post cards - limited to 5 on mobile */}
              {(() => {
                const MOBILE_POST_LIMIT = 5
                const visiblePosts = isMobile && !showAllPosts ? postsToRender.slice(0, MOBILE_POST_LIMIT) : postsToRender
                const hasMore = isMobile && !showAllPosts && postsToRender.length > MOBILE_POST_LIMIT
                return (
                  <>
                    {visiblePosts.map((tweet) => {
                      const tweetKey = tweet.id || tweet.handle
                      const mediaItem = tweet.media?.[0] || null
                      const mediaUrl = mediaItem?.type === 'video' ? mediaItem?.poster_url : mediaItem?.url
                      return (
                      <div key={tweetKey} className={`news-x-card${tweet.hot ? ' is-hot' : ''}`} role="button" tabIndex={0} onClick={() => openTweetDetail(tweet)}>
                        <div className="news-x-card-head">
                          {tweet.avatar ? (
                            <img className={`news-feed-x-avatar${tweet.profileShape === 'Square' ? ' shape-square' : ''}`} src={tweet.avatar} alt="" onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                          ) : (
                            <span style={{ display: 'none' }} />
                          )}
                          <div className={`news-feed-x-avatar-fallback${!tweet.avatar ? ' visible' : ''}${tweet.profileShape === 'Square' ? ' shape-square' : ''}`}>{(tweet.name || '?')[0]}</div>
                          <div className="news-feed-x-user">
                            <span className="news-feed-x-name-row">
                              <span className="news-feed-x-name">{tweet.name}</span>
                              {tweet.verified && <svg className="news-feed-x-verified" width="14" height="14" viewBox="0 0 22 22" fill="none"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.855-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.69-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.636.433 1.221.878 1.69.47.446 1.055.752 1.69.883.635.13 1.294.083 1.902-.141.27.587.7 1.086 1.24 1.44s1.167.551 1.813.568c.645-.016 1.27-.213 1.808-.567.537-.354.973-.853 1.247-1.44.606.223 1.264.27 1.897.14.634-.131 1.217-.437 1.687-.883.445-.47.751-1.054.882-1.69.13-.633.083-1.29-.14-1.896.587-.274 1.084-.705 1.438-1.246.355-.54.553-1.17.57-1.817zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="currentColor"/></svg>}
                              {tweet.hot && <span className="news-x-hot-badge"><span className="news-x-hot-dot" />{tr('homePage.newsTabPanel.newstabpanel.hot', "HOT")}</span>}
                            </span>
                            <span className="news-feed-x-handle">{tweet.handle}</span>
                          </div>
                          <span className="news-x-card-time">{formatTweetTime(tweet.time)}</span>
                          {tweet.xUrl && (
                            <a className="news-x-view-link" href={tweet.xUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={tr('homePage.newsTabPanel.newstabpanel.title3', "View on X")}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                            </a>
                          )}
                        </div>
                        <div className="news-feed-x-body">
                          <p className="news-feed-x-text">{linkifyText(tweet.text)}</p>
                          {mediaUrl && (
                            <div className="news-feed-x-preview">
                              <img src={mediaUrl} alt="" className="news-feed-x-preview-img" onError={e => { e.target.parentElement.style.display = 'none'; }} />
                              <div className="news-feed-x-preview-overlay" />
                            </div>
                          )}
                        </div>
                        <div className="news-feed-x-stats">
                          <button className={`news-feed-x-stat reply${tweetInteractions[tweetKey]?.replied ? ' active' : ''}`} onClick={(e) => toggleInteraction(tweetKey, 'replied', e)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                            {tweetInteractions[tweetKey]?.replied ? incrementStat(tweet.replies) : formatCount(tweet.replies)}
                          </button>
                          <button className={`news-feed-x-stat repost${tweetInteractions[tweetKey]?.reposted ? ' active' : ''}`} onClick={(e) => toggleInteraction(tweetKey, 'reposted', e)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                            {tweetInteractions[tweetKey]?.reposted ? incrementStat(tweet.reposts) : formatCount(tweet.reposts)}
                          </button>
                          <button className={`news-feed-x-stat like${tweetInteractions[tweetKey]?.liked ? ' active' : ''}`} onClick={(e) => toggleInteraction(tweetKey, 'liked', e)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                            {tweetInteractions[tweetKey]?.liked ? incrementStat(tweet.likes) : formatCount(tweet.likes)}
                          </button>
                          <span className="news-feed-x-stat news-feed-x-stat-views">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            {formatCount(tweet.views)}
                          </span>
                        </div>
                      </div>
                      )
                    })}
                    {hasMore && (
                      <button className="news-x-show-more" onClick={() => setShowAllPosts(true)}>
                        Show More ({postsToRender.length - MOBILE_POST_LIMIT} more posts)
                      </button>
                    )}
                    {isMobile && showAllPosts && postsToRender.length > MOBILE_POST_LIMIT && (
                      <button className="news-x-show-more" onClick={() => setShowAllPosts(false)}>
                        {tr('homePage.newsTabPanel.newstabpanel.showLess', "Show Less")}
                      </button>
                    )}
                  </>
                )
              })()}

              {/* AI Analysis - X Posts sentiment — Sectors-style */}
              {xAnalysis && (
              <div className={`news-ai-analysis bias-${xAnalysis.sentiment === 'bullish' ? 'bullish' : xAnalysis.sentiment === 'bearish' ? 'bearish' : 'neutral'}`}>
                <div className="news-ai-analysis-glow" />

                <div className="news-ai-analysis-header">
                  <div className="news-ai-analysis-header-left">
                    <span className="news-ai-analysis-pulse" />
                    <span className="news-ai-analysis-title">{tr('homePage.newsTabPanel.newstabpanel.aiAnalysis', "AI Analysis")}</span>
                  </div>
                  <span className="news-ai-analysis-badge">{tr('homePage.newsTabPanel.newstabpanel.spectreAi', "Spectre AI")}</span>
                </div>

                <p className="news-ai-analysis-text">{xAnalysis.headline}</p>

                <div className="news-ai-analysis-cards">
                  {/* Sentiment Breakdown card */}
                  <div className="news-ai-analysis-card">
                    <div className="news-ai-analysis-card-accent" />
                    <div className="news-ai-analysis-card-content">
                      <div className="news-ai-analysis-card-title">{tr('homePage.newsTabPanel.newstabpanel.sentimentBreakdown', "Sentiment Breakdown")}</div>
                      <div className="news-ai-analysis-bar">
                        {xAnalysis.bullish > 0 && <span className="news-ai-analysis-bar-seg bullish" style={{ flex: xAnalysis.bullish }} />}
                        {xAnalysis.neutral > 0 && <span className="news-ai-analysis-bar-seg neutral" style={{ flex: xAnalysis.neutral }} />}
                        {xAnalysis.bearish > 0 && <span className="news-ai-analysis-bar-seg bearish" style={{ flex: xAnalysis.bearish }} />}
                      </div>
                      <div className="news-ai-analysis-stats">
                        <span className="news-ai-analysis-stat positive">{xAnalysis.bullish} bullish</span>
                        <span className="news-ai-analysis-stat-sep" />
                        <span className="news-ai-analysis-stat neutral">{xAnalysis.neutral} neutral</span>
                        <span className="news-ai-analysis-stat-sep" />
                        <span className="news-ai-analysis-stat negative">{xAnalysis.bearish} bearish</span>
                        <span className="news-ai-analysis-stat-sep" />
                        <span className="news-ai-analysis-conviction">{xAnalysis.conviction}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Coverage card */}
                  <div className="news-ai-analysis-card">
                    <div className="news-ai-analysis-card-accent" />
                    <div className="news-ai-analysis-card-content">
                      <div className="news-ai-analysis-card-title">{tr('homePage.newsTabPanel.newstabpanel.coverage', "Coverage")}</div>
                      <div className="news-ai-analysis-coverage-stats">
                        <span className="news-ai-analysis-coverage-stat">
                          <span className="news-ai-analysis-coverage-num">{xAnalysis.uniqueHandles}</span> {tr('homePage.newsTabPanel.newstabpanel.accounts', "accounts")}
                        </span>
                        <span className="news-ai-analysis-coverage-stat">
                          <span className="news-ai-analysis-coverage-num">{xAnalysis.total}</span> {tr('homePage.newsTabPanel.newstabpanel.posts2', "posts")}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              )}
            </div>
          )
        })()
      )}
    </div>
  )
}

export default memo(NewsTabPanel)
