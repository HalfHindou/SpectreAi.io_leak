/**
 * Spectre Newsroom - CoinDesk-Style Publication
 * Standalone full-screen editorial layout with hero images, article grid, and live data.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import NewsroomHeader from './components/NewsroomHeader'
import BreakingBanner from './components/BreakingBanner'
import PriceTickerStrip from './components/PriceTickerStrip'
import CategoryNav from './components/CategoryNav'
import NewsTimeline from './components/NewsTimeline'
import FeaturedSection from './components/FeaturedSection'
import MarketSidebar from './components/MarketSidebar'
import NewsroomFooter from './components/NewsroomFooter'
import LightFxBg from '@/components/light-fx-bg'
import { getFearGreedCurrent } from '@/services/fearGreedApi'
import { getSpectreNews, getSpectrePricesBySymbols } from '@/services/spectreMarketApi'
import { isDev } from '@/utils/env'
import './Newsroom.css'

const API_BASE = '/api/intelligence'

async function fetchJson(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.json()
  } catch (_) {
    return null
  }
}

function toNewsroomArticle(item, index = 0) {
  const slug = item.slug || item.id || `spectre-${index}`
  return {
    ...item,
    id: slug,
    slug,
    headline: item.headline || item.title || '',
    title: item.title || item.headline || '',
    summary: item.summary || '',
    category: item.category || 'crypto',
    publishedAt: item.publishedAt || item.time || new Date().toISOString(),
    imageUrl: item.imageUrl || null,
    // Cards/hero read `ogImage`; getSpectreNews only emits `imageUrl`, so without
    // this alias every card showed the placeholder and the hero always fell back.
    ogImage: item.imageUrl || null,
    // Breaking styling (FeaturedSection hero branch + --breaking classes) keyed
    // off `isBreaking`, which the feed never set - derive it from importance.
    isBreaking: item.importance === 'high' || item.breaking === true,
    sourceArticle: {
      source: item.source || 'Spectre',
      url: item.url || '#',
      imageUrl: item.imageUrl || null,
    },
  }
}

export default function NewsroomPage() {
  // Raw fetched articles (unfiltered). Timeline + featured rail derive from
  // this single /v1/news call. Breaking stays a separate call - /v1/news/breaking
  // is a distinct source that also carries signal items (orderbook-anomaly,
  // onchain-event) which the plain /news list does not include.
  const [allArticles, setAllArticles] = useState([])
  const [news, setNews] = useState([])
  const [featured, setFeatured] = useState([])
  const [breaking, setBreaking] = useState([])
  const [dailyBrief, setDailyBrief] = useState(null)
  const [prices, setPrices] = useState([])
  const [fearGreed, setFearGreed] = useState(null)
  const [category, setCategory] = useState('all')
  const [loading, setLoading] = useState(true)

  // ── FETCH DATA ──

  // One /v1/news call feeds the timeline + featured rail (was two calls:
  // limit 30 + limit 12). Featured takes the top items; the timeline gets the
  // full list (filtered by category here and in handleCategoryChange).
  const fetchNews = useCallback(async (cat) => {
    const rows = await getSpectreNews({ limit: 50 }).catch(() => [])
    if (!rows.length) return
    const articles = rows.map(toNewsroomArticle)
    setAllArticles(articles)
    setFeatured(articles.slice(0, 5))

    setNews(cat && cat !== 'all'
      ? articles.filter((a) => String(a.category || '').toLowerCase() === String(cat).toLowerCase())
      : articles)
  }, [])

  // Breaking - separate source (/v1/news/breaking), includes signal items.
  const fetchBreaking = useCallback(async () => {
    const rows = await getSpectreNews({ breaking: true, limit: 8 }).catch(() => [])
    if (rows.length) setBreaking(rows.map(toNewsroomArticle))
  }, [])

  const fetchDailyBrief = useCallback(async () => {
    if (isDev) return
    const data = await fetchJson(`${API_BASE}/daily/latest`)
    if (data && data.slug) setDailyBrief(data)
  }, [])

  // Sidebar "Newsroom" + "Agent Status" stats, derived from the already-fetched
  // articles. (Previously fetchStats hit the signals endpoint every 120s and set
  // {signalCount, updatedAt} - fields the sidebar never reads, so both panels
  // showed 0 / "Idle" forever. Deriving from allArticles is truthful + free.)
  const stats = useMemo(() => {
    if (!allArticles.length) return null
    const now = Date.now()
    const DAY = 86_400_000
    let totalToday = 0
    let lastGeneration = 0
    const coverage = {}
    for (const a of allArticles) {
      const ts = new Date(a.publishedAt).getTime()
      if (Number.isFinite(ts)) {
        if (now - ts < DAY) totalToday++
        if (ts > lastGeneration) lastGeneration = ts
      }
      const c = String(a.category || 'news').toLowerCase()
      coverage[c] = (coverage[c] || 0) + 1
    }
    return {
      totalToday,
      totalArticles: allArticles.length,
      coverage,
      agentsActive: allArticles.length > 0,
      lastGeneration: lastGeneration || null,
    }
  }, [allArticles])

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
        setFearGreed({
          value: data.value,
          value_classification: data.classification || data.value_classification,
          classification: data.classification || data.value_classification,
        })
      }
    } catch (_) { console.error(_) }
  }, [])

  // ── INITIAL LOAD ──

  // Keep the active category available to the (stable) polling callbacks
  // without re-arming the timers each time it changes.
  const categoryRef = useRef('all')
  useEffect(() => { categoryRef.current = category }, [category])

  useEffect(() => {
    async function init() {
      setLoading(true)
      // Above-fold rail (featured derives from fetchNews; breaking is its own
      // call) now resolves with first paint. fetchPrices/fetchFearGreed feed the
      // sticky ticker + sidebar gauge, also above fold.
      await Promise.allSettled([
        fetchNews(categoryRef.current),
        fetchBreaking(),
        fetchDailyBrief(),
        fetchPrices(),
        fetchFearGreed(),
      ])
      setLoading(false)
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── POLLING (idle-aware via useAdaptivePolling) ──

  const pollNews = useCallback(() => fetchNews(categoryRef.current), [fetchNews])
  useAdaptivePolling(pollNews, { interval: 120000 })
  useAdaptivePolling(fetchBreaking, { interval: 60000 })
  useAdaptivePolling(fetchPrices, { interval: 30000 })

  // ── CATEGORY CHANGE ──

  // Filter the already-fetched list client-side - no extra /v1/news call.
  const handleCategoryChange = useCallback((cat) => {
    setCategory(cat)
    setNews(cat && cat !== 'all'
      ? allArticles.filter((a) => String(a.category || '').toLowerCase() === String(cat).toLowerCase())
      : allArticles)
  }, [allArticles])

  // ── RENDER ──

  if (loading) {
    return (
      <div className="newsroom">
        <NewsroomHeader />
        <div className="newsroom-loading">
          <div className="newsroom-loading__shimmer animate-shimmer" style={{ width: '60%', height: 32, marginBottom: 12, borderRadius: 8 }} />
          <div className="newsroom-loading__shimmer animate-shimmer" style={{ width: '40%', height: 16, borderRadius: 8 }} />
        </div>
      </div>
    )
  }

  return (
    <div className="newsroom" style={{ position: 'relative' }}>
      <LightFxBg rayColor="blue" starCount={80} rayDirection="top-right" />
      <NewsroomHeader />
      <BreakingBanner articles={breaking} />
      <PriceTickerStrip prices={prices} />
      <CategoryNav active={category} onChange={handleCategoryChange} />
      <div className="nr-three-col">
        <NewsTimeline articles={news} />
        <FeaturedSection articles={news} featured={featured} dailyBrief={dailyBrief} />
        <MarketSidebar prices={prices} fearGreed={fearGreed} stats={stats} />
      </div>
      <NewsroomFooter />
    </div>
  )
}
