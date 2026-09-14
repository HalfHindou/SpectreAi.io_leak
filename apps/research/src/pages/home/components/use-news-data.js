/**
 * useNewsData - Fetches crypto or stock news when the News CC tab or ticker news mode is active.
 * Returns { newsItems, newsLoading, newsError }
 *
 * Crypto mode: fetches from external RSS endpoint directly.
 * Stocks mode: uses the existing getMarketNews service via /api proxy.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getMarketNews } from '@/services/stockNewsApi'
import { getSpectreNews } from '@/services/spectreMarketApi'

// 2026-05-26 beta-quality fix: removed 16 hardcoded "news" cards (fabricated BTC $67K / ETH L2 stats / SEC ETF rumors).
// They aged into "live news" within 25 min of any cold load. Empty state replaces them.
const FALLBACK_NEWS = []

const RSS_API_URL = '/api/news/rss'

// Instant-paint seed: persist the last-loaded feed so a returning user sees real
// cards immediately instead of an empty panel while the network fetch runs.
const NEWS_SEED_TTL = 10 * 60 * 1000 // 10 min
const newsSeedKey = (isStocks) => `spectre-cc-news-v1:${isStocks ? 'stocks' : 'crypto'}`
function readNewsSeed(isStocks) {
  try {
    const raw = localStorage.getItem(newsSeedKey(isStocks))
    if (!raw) return []
    const { ts, items } = JSON.parse(raw)
    if (!Array.isArray(items) || Date.now() - ts > NEWS_SEED_TTL) return []
    return items
  } catch { return [] }
}
function writeNewsSeed(isStocks, items) {
  try {
    const slim = items.slice(0, 30).map((n) => ({
      id: n.id, title: n.title, summary: (n.summary || '').slice(0, 280),
      source: n.source, url: n.url, imageUrl: n.imageUrl || null,
      publishedOn: n.publishedOn, categories: n.categories || [],
    }))
    localStorage.setItem(newsSeedKey(isStocks), JSON.stringify({ ts: Date.now(), items: slim }))
  } catch { /* quota / private mode - ignore */ }
}

function decodeHtml(str) {
  if (!str || typeof str !== 'string') return str
  const el = typeof document !== 'undefined' && document.createElement('textarea')
  if (!el) return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  el.innerHTML = str
  return el.value
}

export default function useNewsData(marketAiTab, isStocks, tickerMode) {
  const [newsItems, setNewsItems] = useState(() => readNewsSeed(isStocks))
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsError, setNewsError] = useState(null)
  const abortRef = useRef(null)
  // Tracks whether we currently have SOMETHING to show, so we only flash the
  // shimmer when the panel would otherwise be empty (not on background refresh).
  const hasItemsRef = useRef(newsItems.length > 0)

  const isActive = marketAiTab === 'news' || tickerMode === 'news'

  // Re-seed from cache when switching crypto<->stocks so the other mode paints
  // instantly from its own seed instead of blanking during the refetch.
  useEffect(() => {
    const seed = readNewsSeed(isStocks)
    if (seed.length) { setNewsItems(seed); hasItemsRef.current = true }
  }, [isStocks])

  const fetchNews = useCallback(async (signal) => {
    // Show the shimmer only when there's nothing on screen yet.
    if (!hasItemsRef.current && !signal?.aborted) setNewsLoading(true)
    try {
      let items
      if (isStocks) {
        // Stock mode: existing service via /api proxy
        items = await getMarketNews('general')
        items = items.map(item => ({
          id: item.id,
          title: item.title,
          summary: item.summary,
          source: item.source,
          url: item.url,
          imageUrl: item.image,
          publishedOn: item.publishedAt ? Math.floor(new Date(item.publishedAt).getTime() / 1000) : Math.floor(Date.now() / 1000),
          categories: [item.category || 'Market'],
        }))
      } else {
        // Crypto mode: merge the curated Spectre pipeline (same source as the
        // News page - editorial filtering + real article thumbnails via
        // normalizeNewsItem's image fallback chain) with the RSS feed that
        // carries mainstream breaking headlines (CNBC/BBC/Investing). RSS
        // alone shipped mostly imageless items, so the CC tab rendered gray
        // placeholder boxes next to the News page's rich cards (2026-06-10).
        const [spectreRows, rssResults] = await Promise.all([
          getSpectreNews({ limit: 24 }).catch(() => []),
          fetch(RSS_API_URL, { signal })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => d?.results || [])
            .catch(() => []),
        ])
        const merged = spectreRows.map((n) => ({
          id: n.id,
          title: n.title,
          summary: n.summary || '',
          source: n.source || '',
          url: n.url || '#',
          imageUrl: n.imageUrl || null,
          publishedOn: n.publishedOn || Math.floor(Date.now() / 1000),
          categories: n.categories?.length ? n.categories : (n.category ? [n.category] : []),
        }))
        const seenTitles = new Set(merged.map((i) => i.title.toLowerCase().trim()))
        for (const item of rssResults) {
          const title = decodeHtml(item.title)
          const key = String(title || '').toLowerCase().trim()
          if (!key || seenTitles.has(key)) continue
          seenTitles.add(key)
          merged.push({
            id: item.id || item.title,
            title,
            summary: decodeHtml(item.summary) || '',
            source: item.source || '',
            url: item.url || '#',
            imageUrl: item.imageUrl || null,
            publishedOn: item.publishedOn || (item.publishedAt ? Math.floor(new Date(item.publishedAt).getTime() / 1000) : Math.floor(Date.now() / 1000)),
            categories: item.categories || [],
          })
        }
        if (merged.length === 0) throw new Error('No news sources available')
        items = merged
          .sort((a, b) => (b.publishedOn || 0) - (a.publishedOn || 0))
          .slice(0, 40)
      }
      if (!items || items.length === 0) items = FALLBACK_NEWS
      if (!signal?.aborted) {
        setNewsItems(items)
        hasItemsRef.current = items.length > 0
        if (items.length > 0) writeNewsSeed(isStocks, items)
        setNewsLoading(false)
        setNewsError(null)
      }
    } catch (e) {
      if (e.name === 'AbortError') return
      // silently handled
      if (!signal?.aborted) {
        setNewsError(e.message || 'Failed to load news')
        setNewsLoading(false)
        // Fall back to existing items or fallback data
        setNewsItems(prev => prev.length > 0 ? prev : FALLBACK_NEWS)
      }
    }
  }, [isStocks])

  const pollNews = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    fetchNews(ctrl.signal)
  }, [fetchNews])

  // 2026-06-03 cost war: removed unconditional prewarm on Welcome mount.
  // CryptoPanic + CryptoCompare both bill on origin requests; the
  // "marginal cost ~0" claim only held until the bill exceeded the cap.
  // Tab-activation refresh below still fires when the user actually clicks
  // News, plus tab-activation is fast on Vercel edge cache. Cold-click
  // latency goes from "instant" to ~300-500ms, worth the spend cut.

  // Refresh on tab activation if data is stale (>30s since last fetch).
  // Init to 0 so the FIRST activation always passes the staleness check —
  // initializing to Date.now() made `Date.now() - lastFetchRef.current` ~0 on
  // first click, which blocked the fetch behind the 30s guard. The user then
  // waited up to 60s for useAdaptivePolling (fireImmediately: false) to kick
  // in before any news appeared. Regression from the 2026-06-03 cost war that
  // removed the unconditional mount prewarm.
  const lastFetchRef = useRef(0)
  useEffect(() => {
    if (!isActive) return
    if (Date.now() - lastFetchRef.current < 30_000) return
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    fetchNews(controller.signal).finally(() => { lastFetchRef.current = Date.now() })
    return () => { controller.abort() }
  }, [isActive, fetchNews])

  useAdaptivePolling(pollNews, { interval: 60_000, enabled: isActive })

  return { newsItems, newsLoading, newsError }
}
