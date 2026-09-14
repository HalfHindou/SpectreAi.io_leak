/**
 * THE SPECTRE EDITION - Editorial Intelligence Page
 * /intelligence route - premium dark editorial publication layout.
 * Fetches news, analysis, breaking, daily brief, and market data.
 * No empty states. No SaaS dashboard. This is a publication.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { trackUi } from '@/services/analytics'
import { useIsMobile } from '@/hooks/useMediaQuery'
import useSettingsStore from '@/store/useSettingsStore'
import Masthead from './components/Masthead'
import CategoryFilter from './components/CategoryFilter'

/* The pill ids and the upstream taxonomy were never the same vocabulary.
   Measured 2026-09-02 across an 80-article stream, the feed emits
   crypto(31) · regulatory(18) · ai(15) · defi(7) · macro(7) · exchange · mining,
   while the pills ask for bitcoin / ethereum / stocks / regulation. Only defi,
   macro and ai ever matched: the other four filtered to zero on every click, and
   because the LATEST rail deliberately stays unfiltered and the Analysis column
   falls back to `analyses`, the page looked identical - so a dead pill read as
   "the click did nothing" rather than "no articles". */
const CATEGORY_ALIASES = {
  regulation: ['regulation', 'regulatory'],
  stocks: ['stocks', 'equities'],
  defi: ['defi'],
  macro: ['macro'],
  ai: ['ai'],
}

/* Asset pills have no upstream category at all - the feed files BTC and ETH
   stories under `crypto`. Match the article's extracted tickers instead, and
   only on an EXACT symbol: relatedAssets is a crude uppercase-word scrape that
   also yields "THAT" / "HIGHER" / "BEST", so a substring test would sweep in
   junk. */
const CATEGORY_ASSETS = { bitcoin: ['BTC'], ethereum: ['ETH'] }
import BreakingBanner from './components/BreakingBanner'
import HeroStory from './components/HeroStory'
import NewsTimeline from './components/NewsTimeline'
import AnalysisColumn from './components/AnalysisColumn'
import MarketPulse from './components/MarketPulse'
import DetectiveFeed from './components/DetectiveFeed'
import StoryGrid from './components/StoryGrid'
import DailyBriefBanner from './components/DailyBriefBanner'
import Footer from './components/Footer'
import { timeAgo, formatChange, getSourceInfo } from './utils'
import { useCurrency } from '@/hooks/useCurrency'
import { getFearGreedCurrent } from '@/services/fearGreedApi'
import { getSpectreIntelligenceSignals, getSpectreNews, getSpectrePricesBySymbols } from '@/services/spectreMarketApi'
import { cleanSyndicatedText } from '@/lib/notification-source'
import './Intelligence.css'
import './intelligence-page.mobile.css'

const API_BASE = '/api/intelligence'

const TODAY_OPTIONS = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }

const CATEGORIES = [
  { key: 'all',        labelKey: 'intelligencePage.categoryAll',        labelFallback: 'All',        color: '#8B5CF6' },
  { key: 'spectre',    labelKey: 'intelligencePage.categorySpectre',    labelFallback: 'Spectre AI', color: '#00E5A0' },
  { key: 'bitcoin',    labelKey: 'intelligencePage.categoryBitcoin',    labelFallback: 'Bitcoin',    color: '#F7931A' },
  { key: 'ethereum',   labelKey: 'intelligencePage.categoryEthereum',   labelFallback: 'Ethereum',   color: '#627EEA' },
  { key: 'defi',       labelKey: 'intelligencePage.categoryDefi',       labelFallback: 'DeFi',       color: '#10B981' },
  { key: 'stocks',     labelKey: 'intelligencePage.categoryStocks',     labelFallback: 'Stocks',     color: '#3B82F6' },
  { key: 'macro',      labelKey: 'intelligencePage.categoryMacro',      labelFallback: 'Macro',      color: '#F59E0B' },
  { key: 'regulation', labelKey: 'intelligencePage.categoryRegulation', labelFallback: 'Regulation', color: '#EF4444' },
  { key: 'ai',         labelKey: 'intelligencePage.categoryAi',         labelFallback: 'AI',         color: '#A855F7' },
]

// News feeds (RSS / WordPress / The Block / Cointelegraph) commonly serve
// titles with HTML numeric character references like &#8216; instead of
// raw Unicode "'", because that's the canonical encoding for an HTML
// document context. When we put those strings into a React text node
// (no dangerouslySetInnerHTML), React doesn't HTML-parse text — so the
// browser displays the literal 6-char string &#8216; instead of the
// curly quote it represents. Decode once at the normalization boundary
// so every downstream consumer (card, article page, breaking banner)
// shows clean text. Textarea trick is browser-safe (textarea content
// is text, no script execution).
function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string' || !str.includes('&')) return str
  if (typeof document === 'undefined') return str
  try {
    const ta = document.createElement('textarea')
    ta.innerHTML = str
    return ta.value
  } catch {
    return str
  }
}

function toSpectreArticle(item, index = 0) {
  const slug = item.slug || item.id || `spectre-${index}`
  const realImage = safeNewsImageUrl(item)
  // Pass a stable key so the placeholder image stays the same across re-renders.
  const imageUrl = realImage || getCategoryFallbackImage(item.category, slug || item.url || item.title)
  // Syndicated wire items arrive wrapped in their origin —
  // `@WSJ (@WSJ): "Alibaba Group is selling…"`. That envelope became the
  // masthead headline, the hero H1 and the breaking banner. The Edition is our
  // paper: it prints the event, not the byline of the account that relayed it.
  const headline = cleanSyndicatedText(decodeHtmlEntities(item.headline || item.title || ''))
  return {
    ...item,
    id: slug,
    slug,
    headline,
    title: cleanSyndicatedText(decodeHtmlEntities(item.title || item.headline || '')),
    summary: cleanSyndicatedText(decodeHtmlEntities(item.summary || '')),
    category: item.category || 'crypto',
    publishedAt: item.publishedAt || item.time || new Date().toISOString(),
    imageUrl,
    coverImage: realImage || null,
    sourceArticle: {
      source: decodeHtmlEntities(item.source || 'Spectre'),
      url: item.url || '#',
      imageUrl,
    },
  }
}

// Cover art only. An avatar or a favicon (see normalizeNewsItem's imageKind)
// is an identity mark — stretched into a hero it reads as a broken image, and
// unavatar answers 404/429 for anything it can't resolve, which is what left
// the Edition's hero showing a bare gradient placeholder.
function safeNewsImageUrl(item) {
  if (!item) return null
  const url = typeof item === 'string' ? item : item.imageUrl
  if (!url) return null
  // Older callers pass a bare string and carry no provenance; trust those.
  if (typeof item === 'string') return url
  if (item.imageKind && item.imageKind !== 'article') return null
  return url
}

// Category-based fallback images for articles without RSS images
const CATEGORY_FALLBACK_IMAGES = {
  bitcoin:    ['https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800&h=500&fit=crop', 'https://images.unsplash.com/photo-1621761191319-c6fb62004040?w=800&h=500&fit=crop'],
  ethereum:   ['https://images.unsplash.com/photo-1622630998477-20aa696ecb05?w=800&h=500&fit=crop'],
  crypto:     ['https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800&h=500&fit=crop', 'https://images.unsplash.com/photo-1621761191319-c6fb62004040?w=800&h=500&fit=crop', 'https://images.unsplash.com/photo-1622630998477-20aa696ecb05?w=800&h=500&fit=crop'],
  defi:       ['https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800&h=500&fit=crop'],
  stocks:     ['https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&h=500&fit=crop', 'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=800&h=500&fit=crop'],
  macro:      ['https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=800&h=500&fit=crop', 'https://images.unsplash.com/photo-1559589689-577aabd1db4f?w=800&h=500&fit=crop'],
  regulation: ['https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=800&h=500&fit=crop'],
  ai:         ['https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=500&fit=crop', 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800&h=500&fit=crop'],
  markets:    ['https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&h=500&fit=crop'],
  research:   ['https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=500&fit=crop'],
}
// Deterministic hash so the same article always maps to the same placeholder.
// Avoids image churn on every render / poll cycle from a module-level counter.
const _hashStr = (s = '') => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
function getCategoryFallbackImage(category, key = '') {
  const cat = (category || 'crypto').toLowerCase()
  const pool = CATEGORY_FALLBACK_IMAGES[cat] || CATEGORY_FALLBACK_IMAGES.crypto
  return pool[_hashStr(String(key)) % pool.length]
}

const CATEGORY_COLORS = {
  bitcoin: '#F7931A', ethereum: '#627EEA', defi: '#10B981', stocks: '#3B82F6',
  macro: '#F59E0B', regulation: '#EF4444', ai: '#A855F7', markets: '#8B5CF6',
  crypto: '#8B5CF6', daily: '#06B6D4', news: '#EF4444', research: '#8B5CF6',
}

function cleanHeadline(text) {
  if (!text) return ''
  return text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s*/gm, '')
}

function getCategoryColor(article) {
  const cat = (article.category || article.type || '').toLowerCase()
  return CATEGORY_COLORS[cat] || '#8B5CF6'
}

function getCategoryLabel(article) {
  const cat = article.category || article.type || 'Markets'
  return cat.charAt(0).toUpperCase() + cat.slice(1)
}

async function fetchWithTimeout(url, ms = 5000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(id)
    return res
  } catch (_) {
    clearTimeout(id)
    throw _
  }
}

async function fetchJson(url) {
  try {
    const res = await fetchWithTimeout(url)
    if (!res.ok) return null
    return await res.json()
  } catch (_) {
    return null
  }
}

function sentimentDotColor(sentiment) {
  if (sentiment === 'bullish') return 'var(--bull, #10B981)'
  if (sentiment === 'bearish') return 'var(--bear, #EF4444)'
  return 'rgba(245, 245, 247, 0.15)'
}

// Defers mounting (and thus self-fetching/polling) of below-fold children
// until they scroll near the viewport. Used to gate DetectiveFeed, a
// right-rail sidebar that self-fetches + polls on mount. minHeight reserves
// space so the IO trigger isn't satisfied instantly and layout doesn't jump.
function IOGate({ children, minHeight = 200, rootMargin = '300px' }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (visible) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true)
        io.disconnect()
      }
    }, { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [visible, rootMargin])
  if (visible) return children
  return <div ref={ref} style={{ minHeight }} aria-hidden="true" />
}

export default function IntelligencePage() {
  const { t, i18n } = useTranslation()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const { fmtPrice: formatPrice } = useCurrency()

  // ── STATE ──
  const [news, setNews] = useState([])
  // `news` may be category-filtered (e.g. ?category=spectre returns only
  // originals). `allNews` is the unfiltered stream — used by the LATEST
  // timeline so it always shows the fresh news pulse regardless of which
  // category the user is filtering the main feed by.
  const [allNews, setAllNews] = useState([])
  // `featured` used to come from a second /v1/news?limit=40 call. That was a
  // strict subset of fetchNews (limit=80, same editorial filter), so it was
  // ~165 ms / 26 KB of duplicated network on every page mount. Now derived
  // from allNews via useMemo below — also stays in sync with the 2-min
  // news poll, which the old state-bag version did not.
  const [breaking, setBreaking] = useState([])
  const [dailyBrief, setDailyBrief] = useState(null)
  const [analyses, setAnalyses] = useState([])
  const [stats, setStats] = useState(null)
  const [prices, setPrices] = useState([])
  // Seed F&G from a localStorage snapshot for instant paint. getFearGreedCurrent
  // has a 30s TTL but is polled at 60s with no shared boot cache, so a fresh
  // session would otherwise show an empty gauge until the first fetch lands.
  const [fearGreed, setFearGreed] = useState(() => {
    try {
      const raw = localStorage.getItem('intel-fg-snapshot')
      if (raw) {
        const snap = JSON.parse(raw)
        if (snap && snap.value != null) return snap
      }
    } catch (_) {}
    return null
  })
  // Seed category from ?category= URL param (validated) so deep links work.
  const [category, setCategory] = useState(() => {
    const param = searchParams.get('category')
    return param && CATEGORIES.some(c => c.key === param) ? param : 'all'
  })
  const [loading, setLoading] = useState(true)

  // Respect back/forward navigation that changes the category param after mount.
  // Depend on the query string (stable across renders) not the searchParams
  // object (fresh identity from useSearchParams on every parent render).
  const searchString = searchParams.toString()
  useEffect(() => {
    const param = new URLSearchParams(searchString).get('category')
    const next = param && CATEGORIES.some(c => c.key === param) ? param : 'all'
    setCategory(prev => (prev === next ? prev : next))
  }, [searchString])

  // ── FETCH FUNCTIONS ──

  // Pure category filter — lifted out of fetchNews so handleCategoryChange
  // can re-derive `news` from the cached `allNews` instead of re-firing a
  // network call. fetchNews still pulls the unfiltered editorial stream
  // (limit=80) and filters it the same way; tab clicks just re-run this
  // function on whatever is already in state.
  const applyCategoryFilter = useCallback((articles, cat) => {
    if (!articles?.length) return []
    if (cat === 'spectre') {
      return articles.filter(
        (a) => a.isOriginal
          || a.sourceArticle?.source === 'Spectre AI'
          || a.sourceArticle?.source === 'Spectre'
      )
    }
    if (cat && cat !== 'all') {
      const want = String(cat).toLowerCase()
      const wantedCats = CATEGORY_ALIASES[want] || [want]
      const wantedAssets = CATEGORY_ASSETS[want] || null
      return articles.filter((a) => {
        if (wantedCats.includes(String(a.category || '').toLowerCase())) return true
        if (!wantedAssets) return false
        const tickers = Array.isArray(a.relatedAssets) ? a.relatedAssets : []
        return tickers.some((x) => wantedAssets.includes(String(x).toUpperCase()))
      })
    }
    return articles
  }, [])

  // fetchNews owns the unfiltered editorial stream only — `news` is derived
  // from `allNews` + `category` in the effect below. This lets URL deep
  // links (?category=…) and back/forward navigation re-filter immediately
  // without firing a redundant /v1/news request. cat param kept for the
  // polling callsite's stable identity (it ignores it).
  const fetchNews = useCallback(async (_cat) => {
    const rows = await getSpectreNews({ limit: 80 }).catch(() => [])
    if (rows.length) {
      // Filter out SEC EDGAR filings - regulatory noise, not editorial content
      const editorial = rows.filter(r => !/sec edgar/i.test(r.source || ''))
      setAllNews(editorial.map(toSpectreArticle))
    }
  }, [])

  // Derive the visible `news` slice from the cached stream + current
  // category. Runs on: initial mount (no-op, both empty), poll refresh
  // (allNews changes), user tab click (category changes), and back/forward
  // navigation (category changes via the URL effect above).
  useEffect(() => {
    setNews(applyCategoryFilter(allNews, category))
  }, [allNews, category, applyCategoryFilter])

  // Featured rail is now derived from `allNews` (see useMemo below). The
  // standalone fetchFeatured() was eliminated — it was a duplicate /v1/news
  // call that returned a strict subset of fetchNews(limit=80).

  const fetchBreaking = useCallback(async () => {
    const rows = await getSpectreNews({ breaking: true, limit: 8 }).catch(() => [])
    if (rows.length) setBreaking(rows.map(toSpectreArticle))
  }, [])

  const fetchDailyBrief = useCallback(async () => {
    const data = await fetchJson(`${API_BASE}/daily/latest`)
    if (data && data.slug) setDailyBrief(data)
  }, [])

  const fetchAnalyses = useCallback(async () => {
    // Fetch editorial + signals in parallel. Editorial is still preferred —
    // signals only top up when editorial is sparse — but firing both at once
    // saves the 200-300ms we used to lose awaiting signals AFTER editorial
    // resolved on the sparse-editorial path.
    const editorialP = fetch(`${API_BASE}/featured`)
      .then(res => (res.ok ? res.json() : null))
      .catch(() => null)
    const signalsP = getSpectreIntelligenceSignals({ limit: 8 }).catch(() => [])
    const [editorialRes, signalsRes] = await Promise.allSettled([editorialP, signalsP])

    const items = []
    const data = editorialRes.status === 'fulfilled' ? editorialRes.value : null
    const rows = Array.isArray(data?.articles) ? data.articles : Array.isArray(data) ? data : []
    rows.slice(0, 8).forEach((a, i) => items.push(toSpectreArticle({
      ...a,
      source: a.sourceArticle?.source || 'Spectre AI',
      isOriginal: true,
    }, i)))

    // Top up with intelligence signals only if editorial content is sparse.
    if (items.length < 4) {
      const signals = signalsRes.status === 'fulfilled' && Array.isArray(signalsRes.value)
        ? signalsRes.value : []
      signals.forEach((signal, index) => items.push(toSpectreArticle({
        id: `signal-${signal.id || index}`,
        title: signal.headline || signal.title || signal.signalType || 'Market signal',
        summary: signal.detail || signal.summary || '',
        category: signal.category || 'research',
        publishedAt: signal.createdAt || signal.time || new Date().toISOString(),
        source: 'Spectre Intelligence',
        url: '#',
      }, items.length + index)))
    }
    items.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    setAnalyses(items)
  }, [])

  // Stats are derived from current state, not fetched separately
  useEffect(() => {
    if (!news.length && !breaking.length) return
    setStats({
      totalArticles: news.length,
      breakingCount: breaking.length,
      signalCount: analyses.length,
      updatedAt: new Date().toISOString(),
    })
  }, [news.length, breaking.length, analyses.length])

  const fetchPrices = useCallback(async () => {
    try {
      const rows = await getSpectrePricesBySymbols(['BTC', 'ETH', 'SOL'])
      const list = ['BTC', 'ETH', 'SOL'].map((symbol) => {
        const row = rows[symbol]
        return row ? { symbol, price: row.price, change: row.change24h ?? row.change } : null
      }).filter(Boolean)
      setPrices(list)
    } catch (_) { console.error(_) }
  }, [])

  const fetchFearGreed = useCallback(async () => {
    try {
      const data = await getFearGreedCurrent()
      if (data?.value != null) {
        // Normalize CMC classification to title case
        const cls = (data.classification || '').replace(/\b\w/g, c => c.toUpperCase())
        const snap = {
          value: String(data.value),
          value_classification: cls,
          classification: cls,
        }
        setFearGreed(snap)
        // Persist for next-session instant paint (see seed in useState above).
        try { localStorage.setItem('intel-fg-snapshot', JSON.stringify(snap)) } catch (_) {}
      }
    } catch (_) { console.error(_) }
  }, [])

  // ── INITIAL LOAD ──

  useEffect(() => {
    async function init() {
      setLoading(true)
      // Only fetchNews is on the critical path — every other slot has its
      // own skeleton / empty state and can populate progressively. Spinner
      // flips off as soon as news lands (~230 ms cold) instead of waiting
      // for max(news, breaking, dailyBrief, analyses) ~380 ms.
      await fetchNews(category)
      setLoading(false)
      // Fire the rest in parallel without holding back the spinner. Each
      // surface fades in when its data lands.
      Promise.allSettled([fetchBreaking(), fetchDailyBrief(), fetchAnalyses()])
      // External market data — purely decorative, never blocking.
      // fetchFearGreed is driven by its own fireImmediately poll below.
      fetchPrices()
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Adaptive polling for data refreshes (replaces raw setInterval). prices
  // bumped 30 s → 60 s — 3 ticker prices in the masthead don't need finer
  // resolution than that, and the page is news-first, not trading.
  useAdaptivePolling(fetchBreaking, { interval: 60000 })
  useAdaptivePolling(() => fetchNews(category), { interval: 120000 })
  useAdaptivePolling(fetchPrices, { interval: 60000 })
  useAdaptivePolling(fetchAnalyses, { interval: 300000 })
  // F&G refreshes on a 60s poll and fires immediately so the seeded snapshot
  // (or empty gauge) is replaced with live data right away. getFearGreedCurrent
  // has its own 30s TTL + inflight dedup, so this doesn't double-fetch.
  useAdaptivePolling(fetchFearGreed, { interval: 60000, fireImmediately: true })

  // ── CATEGORY CHANGE ──

  // The re-filter effect above watches `category`, so this is just a
  // setter. No /v1/news request fires on a tab click.
  const handleCategoryChange = useCallback((cat) => {
    trackUi('intel_category', cat)
    setCategory(cat)
  }, [])

  // ── HERO ROTATION (5 articles) ──
  const [heroIndex, setHeroIndex] = useState(0)
  const heroTimerRef = useRef(null)

  // Featured rail = first 8 of allNews (editorial-filtered + ordered by
  // recency upstream). Replaces the prior dedicated /v1/news?limit=40 fetch.
  // Stays in sync with the 2-min news poll automatically because allNews is
  // the polled state slice.
  const featured = useMemo(() => allNews.slice(0, 8), [allNews])

  // Build hero rotation pool: breaking first, then freshest across featured/research/analyses/news.
  // CRITICAL: filters out stale content (>7 days old) so Feb articles never slot into hero while
  // today's news exists. Sort by publishedAt desc to guarantee freshness wins over type priority.
  // Memoised so unrelated state changes (hover, key press) don't re-walk 80+ articles.
  const heroPool = useMemo(() => {
    const FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
    const now = Date.now()
    const isFresh = (a) => {
      const t = new Date(a?.publishedAt || 0).getTime()
      return t > 0 && (now - t) < FRESH_WINDOW_MS
    }
    // Hero-worthy: real articles with images from editorial sources (CoinDesk, The Block, etc.)
    // Exclude raw TA signals and orderbook alerts — those belong in the breaking banner / analysis column.
    const hasRealContent = (a) => {
      if (!a) return false
      // Skip signal-type content (orderbook imbalances, volume spikes, etc.)
      const src = (a.sourceArticle?.source || a.source || '').toLowerCase()
      if (/orderbook|signal|intelligence/i.test(src)) return false
      // Skip SEC EDGAR filings - regulatory noise, not editorial
      if (/sec edgar/i.test(src)) return false
      const title = (a.headline || a.title || '').toLowerCase()
      if (/^(btc|eth|sol|xrp|bnb|ada|doge)\s+(orderbook|rsi|macd|volume|social volume)/i.test(title)) return false
      // Skip SEC filing patterns (8-K, 10-K, etc.)
      if (/^\d+-[a-z]/i.test(title) || /\(filer\)/i.test(title)) return false
      return true
    }
    // Prefer articles with real RSS/source images over category fallbacks
    const hasRealImage = (a) => Boolean(a?.coverImage)

    const pool = []
    const seen = new Set()
    const add = (a) => { if (a && a.slug && !seen.has(a.slug)) { seen.add(a.slug); pool.push(a) } }

    // 1. Real breaking with real images first (not orderbook alerts)
    breaking.filter(a => hasRealContent(a) && hasRealImage(a)).forEach(add)

    // 2. All fresh articles sorted: real images first, then by recency
    const rest = [...featured, ...news]
      .filter(a => isFresh(a) && hasRealContent(a))
      .sort((a, b) => {
        const aImg = hasRealImage(a) ? 1 : 0
        const bImg = hasRealImage(b) ? 1 : 0
        if (aImg !== bImg) return bImg - aImg
        return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)
      })
    rest.forEach(add)

    // 3. If still sparse, add remaining breaking (even without images)
    if (pool.length < 3) {
      breaking.filter(a => hasRealContent(a)).forEach(add)
    }

    return pool.slice(0, 5)
  }, [breaking, featured, news])

  // Auto-rotate every 8 seconds
  useEffect(() => {
    if (heroPool.length <= 1) return
    heroTimerRef.current = setInterval(() => {
      setHeroIndex(prev => (prev + 1) % heroPool.length)
    }, 8000)
    return () => clearInterval(heroTimerRef.current)
  }, [heroPool.length])

  const handleHeroDot = useCallback((idx) => {
    setHeroIndex(idx)
    // Reset timer on manual selection
    if (heroTimerRef.current) clearInterval(heroTimerRef.current)
    heroTimerRef.current = setInterval(() => {
      setHeroIndex(prev => (prev + 1) % heroPool.length)
    }, 8000)
  }, [heroPool.length])

  const heroArticle = heroPool[heroIndex] || heroPool[0] || null

  // ── DERIVE CONTENT ──

  const heroSlugs = useMemo(() => new Set(heroPool.map(a => a.slug)), [heroPool])

  const gridArticles = useMemo(
    () => news.filter(a => !heroSlugs.has(a.slug)).slice(0, 6),
    [news, heroSlugs]
  )

  // LATEST timeline always reflects the full editorial stream. If the user
  // is filtering by category (which narrows `news`), LATEST stays broad so
  // the page still feels alive instead of showing an empty rail.
  const timelineSource = allNews.length > 0 ? allNews : news
  const timelineArticles = useMemo(() => timelineSource.slice(0, 15), [timelineSource])

  // Analysis: editorial originals + quality news, then signals as fallback
  const analysisItems = useMemo(() => {
    const QUALITY_SOURCES = /coindesk|the block|blockworks|decrypt|bloomberg|reuters|cnbc/i
    const spectreOriginals = news.filter(a => a.isOriginal || a.sourceArticle?.source === 'Spectre AI' || a.sourceArticle?.source === 'Spectre')
    const qualityArticles = news.filter(a =>
      !a.isOriginal && QUALITY_SOURCES.test(a.sourceArticle?.source || a.source || '')
    )
    return [...spectreOriginals, ...qualityArticles, ...analyses]
      .filter((a, i, arr) => arr.findIndex(x => x.slug === a.slug) === i)
      .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
      .slice(0, 4)
  }, [news, analyses])

  // ── NAVIGATION HELPER ──
  const handleArticleClick = useCallback((article) => {
    if (!article?.slug) return
    const type = article.type || 'news'
    navigate(`/intelligence/${type}/${article.slug}`)
  }, [navigate])

  // ── LOADING (MOBILE) ──

  if (loading && isMobile) {
    return (
      <div className="st-page mint-page">
        <div className="mint-content">
          <div className="mint-header-spacer" aria-hidden="true" />
          <div className="mint-section">
            <div className="mint-skeleton mint-skeleton--line" style={{ width: '50%', marginTop: 12 }} />
            <div className="mint-skeleton mint-skeleton--line-short" style={{ marginBottom: 16 }} />
            <div className="mint-skeleton mint-skeleton--hero" />
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="mint-skeleton mint-skeleton--row" style={{ animationDelay: `${i * 100}ms` }} />
            ))}
          </div>
          <div className="mint-bottom-spacer" />
        </div>
      </div>
    )
  }

  // ── LOADING (DESKTOP) ──

  if (loading) {
    return (
      <div className="st-page">
        <Masthead />
        <div className="st-section-divider" aria-hidden="true" />
        <section className="st-hero-section">
          <div className="st-skel st-skel--hero animate-shimmer" />
        </section>
        <div className="st-section-divider" aria-hidden="true" />
        <section className="st-three-col">
          <div className="st-three-col__left">
            <div className="st-skel st-skel--label animate-shimmer" />
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="st-skel st-skel--news-item animate-shimmer" />
            ))}
          </div>
          <div className="st-three-col__center">
            <div className="st-skel st-skel--label animate-shimmer" />
            {[0, 1, 2].map(i => (
              <div key={i} className="st-skel st-skel--analysis-card animate-shimmer" />
            ))}
          </div>
          <div className="st-three-col__right">
            <div className="st-skel st-skel--label animate-shimmer" />
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="st-skel st-skel--pulse-row animate-shimmer" />
            ))}
          </div>
        </section>
      </div>
    )
  }

  // ════════════════════════════════════════════════════════
  // MOBILE RENDER
  // ════════════════════════════════════════════════════════
  if (isMobile) {
    const leadBreaking = breaking[0]

    return (
      <div className={`st-page mint-page${dayMode ? ' day-mode' : ''}`}>
        <div className="mint-content">
          <div className="mint-header-spacer" aria-hidden="true" />

          {/* Masthead - simplified */}
          <div className="mint-section">
            <div className="mint-masthead">
              <h1 className="mint-masthead-title">{t('intelligencePage.title', 'The Spectre Edition').toUpperCase()}</h1>
              <span className="mint-masthead-date">
                {new Date().toLocaleDateString(i18n.language, TODAY_OPTIONS).toUpperCase()}
              </span>
              <div className="mint-masthead-divider" aria-hidden="true" />
            </div>
          </div>

          {/* Category pills - L4 ghost capsules */}
          <div className="mint-section-flush">
            <nav className="mint-categories" aria-label={t('intelligencePage.filterByCategory', 'Filter by category')}>
              {CATEGORIES.map(cat => (
                <button
                  key={cat.key}
                  className={`mint-pill${category === cat.key ? ' mint-pill--active' : ''}`}
                  onClick={() => handleCategoryChange(cat.key)}
                  aria-pressed={category === cat.key}
                >
                  <span className="mint-pill-dot" style={{ background: cat.color }} aria-hidden="true" />
                  {t(cat.labelKey, cat.labelFallback)}
                </button>
              ))}
            </nav>
          </div>

          {/* Breaking banner */}
          {leadBreaking && (
            <div className="mint-section-flush">
              <div
                className="mint-breaking"
                onClick={() => handleArticleClick(leadBreaking)}
                role="alert"
              >
                <span className="mint-breaking-dot" />
                <span className="mint-breaking-label">{t('intelligencePage.breaking', 'Breaking').toUpperCase()}</span>
                <h2 className="mint-breaking-headline">
                  {cleanHeadline(leadBreaking.headline || leadBreaking.title)}
                </h2>
              </div>
            </div>
          )}

          {/* Hero card */}
          {heroArticle && (
            <div className="mint-section">
              <div className="mint-hero" onClick={() => handleArticleClick(heroArticle)}>
                <div className="mint-hero-image">
                  {(() => {
                    const coverPhoto = heroArticle.coverImage || heroArticle.sourceArticle?.imageUrl || heroArticle.imageUrl || (heroArticle.slug ? `/api/hero/${heroArticle.slug}` : null)
                    if (coverPhoto) {
                      return (
                        <img
                          // The hero rotates through ONE mounted <img>, and the
                          // error handler writes `display:none` straight onto
                          // the element — so without a per-article key the first
                          // broken image hid every hero that followed it.
                          key={heroArticle.slug}
                          src={coverPhoto}
                          alt={cleanHeadline(heroArticle.headline || heroArticle.title)}
                          loading="eager"
                          onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling && (e.target.nextElementSibling.style.display = 'flex') }}
                        />
                      )
                    }
                    return null
                  })()}
                  <div className="mint-hero-gradient" style={{
                    display: (heroArticle.coverImage || heroArticle.sourceArticle?.imageUrl || heroArticle.imageUrl || heroArticle.slug) ? 'none' : 'flex',
                    background: `linear-gradient(135deg, ${getCategoryColor(heroArticle)}22 0%, ${getCategoryColor(heroArticle)}08 40%, rgba(0,0,0,0.3) 100%)`,
                  }}>
                    <span className="mint-hero-gradient-label">{t('intelligencePage.spectreUpper')}</span>
                    <span className="mint-hero-gradient-category" style={{ color: getCategoryColor(heroArticle) }}>
                      {getCategoryLabel(heroArticle).toUpperCase()}
                    </span>
                  </div>
                </div>

                <div className="mint-hero-body">
                  <div className="mint-hero-category">
                    <span className="mint-hero-category-dot" style={{ background: getCategoryColor(heroArticle) }} />
                    <span className="mint-hero-category-label">{getCategoryLabel(heroArticle).toUpperCase()}</span>
                  </div>
                  <h2 className="mint-hero-headline">
                    {cleanHeadline(heroArticle.headline || heroArticle.title)}
                  </h2>
                  {heroArticle.summary && (
                    <p className="mint-hero-summary">{heroArticle.summary}</p>
                  )}
                  <div className="mint-hero-meta">
                    <span className="mint-hero-time">{timeAgo(heroArticle.publishedAt, { t })}</span>
                    {(() => {
                      const { isSpectre, sourceName } = getSourceInfo(heroArticle, { t })
                      return (
                        <span className={`mint-hero-source${isSpectre ? ' mint-hero-source--spectre' : ''}`}>
                          {isSpectre ? 'Spectre AI' : sourceName}
                        </span>
                      )
                    })()}
                  </div>
                </div>
              </div>

              {/* Hero rotation dots */}
              {heroPool.length > 1 && (
                <div className="mint-hero-dots">
                  {heroPool.map((a, i) => (
                    <button
                      key={a.slug}
                      className={`mint-hero-dot${i === heroIndex ? ' mint-hero-dot--active' : ''}`}
                      onClick={() => handleHeroDot(i)}
                      aria-label={t('intelligencePage.showArticle', 'Show article {{n}}', { n: i + 1 })}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Market pulse strip */}
          {prices.length > 0 && (
            <div className="mint-section-flush">
              <div className="mint-pulse">
                {prices.map(p => (
                  <div className="mint-pulse-chip" key={p.symbol}>
                    <span className="mint-pulse-symbol">{p.symbol}</span>
                    <span className="mint-pulse-price">{formatPrice(p.price)}</span>
                    <span className={`mint-pulse-change${p.change > 0 ? ' mint-pulse-change--up' : p.change < 0 ? ' mint-pulse-change--down' : ''}`}>
                      {formatChange(p.change)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* News feed */}
          {timelineArticles.length > 0 && (
            <div className="mint-section">
              <div className="mint-section-label">{t('intelligencePage.latest', 'Latest')}</div>
              {timelineArticles.slice(0, 10).map((article, i) => {
                const { isSpectre, sourceName } = getSourceInfo(article, { t })
                return (
                  <div
                    key={article.slug || i}
                    className="mint-news-item"
                    onClick={() => handleArticleClick(article)}
                  >
                    <h4 className="mint-news-headline">
                      {cleanHeadline(article.headline || article.title)}
                    </h4>
                    <div className="mint-news-meta">
                      <span className="mint-news-time">{timeAgo(article.publishedAt, { t })}</span>
                      <span className={`mint-news-source${isSpectre ? ' mint-news-source--spectre' : ''}`}>
                        {isSpectre ? 'Spectre AI' : sourceName}
                      </span>
                      <span
                        className="mint-news-sentiment"
                        style={{ background: sentimentDotColor(article.sentiment) }}
                        aria-label={`${t('intelligencePage.sentiment')}: ${
                          article.sentiment === 'bullish'
                            ? t('intelligencePage.sentimentBullish')
                            : article.sentiment === 'bearish'
                              ? t('intelligencePage.sentimentBearish')
                              : t('intelligencePage.sentimentNeutral')
                        }`}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Analysis */}
          {analysisItems.length > 0 && (
            <div className="mint-section">
              <div className="mint-section-label">{t('intelligencePage.analysis', 'Analysis')}</div>
              {analysisItems.map((article, i) => {
                const { isSpectre, sourceName } = getSourceInfo(article, { t })
                return (
                  <div
                    key={article.slug || i}
                    className="mint-analysis-card"
                    onClick={() => handleArticleClick(article)}
                  >
                    <div className="mint-analysis-badge">
                      <span className="mint-analysis-badge-dot" style={{ background: getCategoryColor(article) }} />
                      <span className="mint-analysis-badge-label">{getCategoryLabel(article).toUpperCase()}</span>
                    </div>
                    <h3 className="mint-analysis-headline">
                      {cleanHeadline(article.headline || article.title)}
                    </h3>
                    {article.summary && (
                      <p className="mint-analysis-summary">{article.summary}</p>
                    )}
                    <span className={`mint-analysis-source${isSpectre ? ' mint-analysis-source--spectre' : ''}`}>
                      {isSpectre ? 'Spectre AI' : sourceName}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Story cards - horizontal scroll strip */}
          {gridArticles.length > 0 && (
            <div className="mint-section-flush">
              <div className="mint-section" style={{ paddingBottom: 0 }}>
                <div className="mint-section-label">{t('intelligencePage.moreStories', 'More Stories')}</div>
              </div>
              <div className="mint-stories">
                {gridArticles.map((article, i) => {
                  const coverPhoto = article.coverImage || article.sourceArticle?.imageUrl || article.imageUrl || (article.slug ? `/api/hero/${article.slug}` : null)
                  const { isSpectre, sourceName } = getSourceInfo(article, { t })
                  return (
                    <div
                      key={article.slug || i}
                      className="mint-story-card"
                      onClick={() => handleArticleClick(article)}
                    >
                      <div className="mint-story-image">
                        {coverPhoto ? (
                          <img
                            src={coverPhoto}
                            alt={cleanHeadline(article.headline || article.title)}
                            loading="lazy"
                            onError={(e) => { e.target.style.display = 'none' }}
                          />
                        ) : (
                          <div className="mint-story-gradient" style={{
                            background: `linear-gradient(135deg, ${getCategoryColor(article)}20 0%, ${getCategoryColor(article)}08 50%, rgba(0,0,0,0.2) 100%)`
                          }}>
                            <span className="mint-story-gradient-icon" style={{ color: getCategoryColor(article) }}>&#9670;</span>
                          </div>
                        )}
                      </div>
                      <h3 className="mint-story-headline">
                        {cleanHeadline(article.headline || article.title)}
                      </h3>
                      <div className="mint-story-meta">
                        <span className="mint-story-source">
                          {isSpectre ? 'Spectre AI' : sourceName}
                        </span>
                        <span className="mint-story-time">{timeAgo(article.publishedAt, { t })}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Daily brief */}
          {dailyBrief && (
            <div className="mint-section">
              <div
                className="mint-brief"
                onClick={() => navigate(`/intelligence/daily/${dailyBrief.slug}`)}
              >
                <div className="mint-brief-eyebrow">
                  {t('intelligencePage.dailyMarketBrief', 'Daily Market Brief').toUpperCase()} &middot; {new Date(dailyBrief.publishedAt || Date.now()).toLocaleDateString(i18n.language, TODAY_OPTIONS).toUpperCase()}
                </div>
                {dailyBrief.summary && (
                  <p className="mint-brief-summary">
                    {dailyBrief.summary.replace(/\*\*/g, '').replace(/\*/g, '')}
                  </p>
                )}
                <span className="mint-brief-cta">{t('intelligencePage.readFullBrief', 'Read Full Brief')} &rarr;</span>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="mint-section">
            <div className="mint-footer">
              <p className="mint-footer-pub">{t('intelligencePage.publishedBy', 'The Spectre Edition - Published by Spectre AI Agents')}</p>
              <p className="mint-footer-copy">{t('intelligencePage.copyright', '(c) 2026 Spectre AI - AI-generated research. Not financial advice.')}</p>
            </div>
          </div>

          <div className="mint-bottom-spacer" />
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════════
  // DESKTOP RENDER
  // ════════════════════════════════════════════════════════
  return (
    <div className="st-page">
      <Masthead />
      <CategoryFilter active={category} onChange={handleCategoryChange} />

      <div className="st-breaking-shell">
        <BreakingBanner articles={breaking} />
      </div>

      <div className="st-section-divider" aria-hidden="true" />

      <section className="st-hero-section">
        <HeroStory article={heroArticle} prices={prices} />
        {heroPool.length > 1 && (
          <div className="st-hero-dots">
            {heroPool.map((a, i) => (
              <button
                key={a.slug}
                className={`st-hero-dot${i === heroIndex ? ' st-hero-dot--active' : ''}`}
                onClick={() => handleHeroDot(i)}
                aria-label={t('intelligencePage.showArticle', 'Show article {{n}}', { n: i + 1 })}
              >
                {i === heroIndex && <span className="st-hero-dot__progress" />}
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="st-section-divider" aria-hidden="true" />

      <section className="st-three-col">
        <div className="st-three-col__left">
          <NewsTimeline articles={timelineArticles} />
        </div>
        <div className="st-three-col__center">
          <AnalysisColumn articles={analysisItems} />
        </div>
        <div className="st-three-col__right">
          <MarketPulse prices={prices} fearGreed={fearGreed} stats={stats} />
          <div style={{ height: 12 }} />
          {/* IO-gated: DetectiveFeed self-fetches + polls on mount, but it's a
              below-fold right-rail. Mount only when scrolled near view. */}
          <IOGate minHeight={240}>
            <DetectiveFeed />
          </IOGate>
        </div>
      </section>

      <div className="st-section-divider" aria-hidden="true" />

      <section className="st-stories-section">
        <StoryGrid articles={gridArticles} />
      </section>

      {dailyBrief && (
        <>
          <div className="st-section-divider" aria-hidden="true" />
          <section className="st-daily-section">
            <DailyBriefBanner article={dailyBrief} />
          </section>
        </>
      )}

      <div className="st-section-divider" aria-hidden="true" />
      <Footer />
    </div>
  )
}
