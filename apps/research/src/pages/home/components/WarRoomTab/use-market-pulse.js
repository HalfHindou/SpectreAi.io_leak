/**
 * useMarketPulse — the data engine for the Market Summary tab.
 *
 * Reworked (2026-07-09, dense pass): the tab is a glanceable market dashboard.
 * Four slices:
 *   1. outlook   — getMarketOutlook() (macro LLM brief on Fed/geopolitics/politics/
 *                  cross-asset) as the thesis; getBrainDesk() only for BTC/ETH/SOL
 *                  levels. The prose engine is unchanged.
 *   2. news      — getMarketNews(): a DIVERSE market-news board (crypto + stocks +
 *                  commodities + macro), ~20 items, each category-tagged. Replaces
 *                  the old ~2-item editorial-filtered crypto-only feed.
 *   3. markets   — macro instruments (S&P 500, Nasdaq, Gold, Oil, VIX, DXY) from the
 *                  Express /api/stocks/quotes route (dev+prod parity, clean, real —
 *                  no fabrication) + crypto majors from the desk levels + Fear & Greed.
 *   4. fearGreed — forwarded from the home shell with a self-fetch fallback.
 *
 * Gated to when the Market Summary tab is active (`enabled`). localStorage
 * instant-paint seeds so a returning user paints real content immediately.
 *
 * Returns an OBJECT (never an array), per hook conventions.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import {
  getBrainDesk,
  getMarketOutlook,
  getMarketNews,
  getSpectreFearGreedCurrent,
} from '@/services/spectreMarketApi'
import { getStockQuotes } from '@/services/stockApi'

// ── Instant-paint seeds ──────────────────────────────────────────────────────
const OUTLOOK_SEED_KEY = 'spectre-market-outlook-v1'
const NEWS_SEED_KEY = 'spectre-market-pulse-news-v2'
const MARKETS_SEED_KEY = 'spectre-market-pulse-markets-v1'
const OUTLOOK_SEED_TTL = 15 * 60 * 1000 // 15 min — desk regenerates per Brain cycle
const NEWS_SEED_TTL = 10 * 60 * 1000 // 10 min
const MARKETS_SEED_TTL = 10 * 60 * 1000 // 10 min

// Poll cadences — everything here is slow-moving and cheap.
const OUTLOOK_INTERVAL = 7 * 60 * 1000 // desk regenerates roughly per Brain cycle
const NEWS_INTERVAL = 5 * 60 * 1000
const MARKETS_INTERVAL = 60 * 1000 // macro quotes move; 60s is plenty for a summary
const FG_INTERVAL = 5 * 60 * 1000

const NEWS_LIMIT = 20

// Macro instruments — ETF/index proxies the thesis actually references. Yahoo
// symbols via /api/stocks/quotes (has a serverless twin, so dev + prod parity).
const MACRO_INSTRUMENTS = [
  { symbol: 'SPY', label: 'S&P 500' },
  { symbol: 'QQQ', label: 'Nasdaq' },
  { symbol: 'GLD', label: 'Gold' },
  { symbol: 'USO', label: 'Oil (WTI)' },
  { symbol: '^VIX', label: 'VIX' },
  { symbol: 'DX-Y.NYB', label: 'DXY' },
]
const MACRO_SYMBOLS = MACRO_INSTRUMENTS.map((m) => m.symbol)

function readSeed(key, ttl) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { ts, data } = JSON.parse(raw)
    if (Date.now() - ts > ttl) return null
    return data
  } catch { return null }
}
function writeSeed(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })) }
  catch { /* quota / private mode — ignore */ }
}

// Normalize the Fear & Greed shape the shell passes in vs. what the API returns.
function normalizeFg(fg) {
  if (!fg) return null
  const value = Number(fg.value)
  if (!Number.isFinite(value)) return null
  return {
    value,
    label: fg.classification || fg.label || fg.value_classification || '',
  }
}

// Shape a market-news item for the news board. Carries the whole record as
// router state (in case a consumer wants the in-app reader) plus the external
// url (these are bare RSS headlines with no in-app body — see MarketPulse.jsx).
function shapeNewsItem(item) {
  const title = String(item?.title || '').trim()
  if (!title) return null
  const id = String(item?.id || item?.url || title)
  const category = ['crypto', 'stocks', 'commodities', 'macro'].includes(item?.category) ? item.category : 'macro'
  return {
    id,
    title,
    source: item?.source || 'RSS',
    category,
    url: item?.url || '#',
    publishedAt: item?.publishedAt || null,
    article: {
      id,
      title,
      summary: '',
      content: '',
      source: item?.source || 'RSS',
      sourceType: category === 'crypto' ? 'crypto' : 'stocks',
      url: item?.url || '#',
      imageUrl: null,
      publishedAt: item?.publishedAt || new Date().toISOString(),
      category,
    },
  }
}

// Map raw stock-quote rows into the compact markets shape the strip renders.
function shapeMarkets(quotes) {
  if (!quotes || typeof quotes !== 'object') return []
  return MACRO_INSTRUMENTS.map(({ symbol, label }) => {
    const q = quotes[symbol]
    const px = Number(q?.price)
    if (!Number.isFinite(px) || px <= 0) return null
    const chg = Number(q?.change)
    return { symbol, label, px, chg24h: Number.isFinite(chg) ? chg : null }
  }).filter(Boolean)
}

export default function useMarketPulse({ enabled = true, fearGreed: fearGreedProp = null } = {}) {
  const [outlook, setOutlook] = useState(() => readSeed(OUTLOOK_SEED_KEY, OUTLOOK_SEED_TTL))
  const [news, setNews] = useState(() => readSeed(NEWS_SEED_KEY, NEWS_SEED_TTL) || [])
  const [markets, setMarkets] = useState(() => readSeed(MARKETS_SEED_KEY, MARKETS_SEED_TTL) || [])
  const [fearGreed, setFearGreed] = useState(() => normalizeFg(fearGreedProp))
  const [outlookLoading, setOutlookLoading] = useState(!outlook)
  const [newsLoading, setNewsLoading] = useState(() => (readSeed(NEWS_SEED_KEY, NEWS_SEED_TTL) || []).length === 0)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  const hasOutlookRef = useRef(Boolean(outlook))
  const hasNewsRef = useRef(news.length > 0)
  const hasMarketsRef = useRef(markets.length > 0)

  // Adopt the F&G the home shell already fetched — no redundant request.
  useEffect(() => {
    const next = normalizeFg(fearGreedProp)
    if (next) setFearGreed((prev) => (prev && prev.value === next.value && prev.label === next.label ? prev : next))
  }, [fearGreedProp])

  // ── Outlook (the thesis + crypto levels) ──
  const fetchOutlook = useCallback(async () => {
    if (!hasOutlookRef.current) setOutlookLoading(true)
    try {
      const [macro, desk] = await Promise.all([
        getMarketOutlook().catch(() => null),
        getBrainDesk().catch(() => null),
      ])
      const levels = desk?.levels || []
      const next = macro
        ? { title: macro.title, regime: macro.regime, brief: macro.sentences, levels, asOf: macro.generatedAt }
        : (desk ? { title: desk.title, regime: desk.regime, brief: desk.brief, levels: desk.levels } : null)
      if (next && (next.brief?.length || next.levels?.length)) {
        setOutlook(next)
        hasOutlookRef.current = true
        writeSeed(OUTLOOK_SEED_KEY, next)
        setError(null)
      } else if (!hasOutlookRef.current) {
        setError('Outlook unavailable')
      }
      setLastUpdated(Date.now())
    } catch {
      if (!hasOutlookRef.current) setError('Outlook unavailable')
    } finally {
      setOutlookLoading(false)
    }
  }, [])

  // ── News (diverse categorized board) ──
  const fetchNews = useCallback(async () => {
    if (!hasNewsRef.current) setNewsLoading(true)
    try {
      const rows = await getMarketNews({ limit: NEWS_LIMIT }).catch(() => [])
      const items = (Array.isArray(rows) ? rows : []).map(shapeNewsItem).filter(Boolean).slice(0, NEWS_LIMIT)
      if (items.length) {
        setNews(items)
        hasNewsRef.current = true
        writeSeed(NEWS_SEED_KEY, items)
      }
    } catch { /* keep last-good news */ }
    finally { setNewsLoading(false) }
  }, [])

  // ── Markets (macro instruments strip) ──
  const fetchMarkets = useCallback(async () => {
    try {
      const quotes = await getStockQuotes(MACRO_SYMBOLS).catch(() => ({}))
      const shaped = shapeMarkets(quotes)
      if (shaped.length) {
        setMarkets(shaped)
        hasMarketsRef.current = true
        writeSeed(MARKETS_SEED_KEY, shaped)
      }
    } catch { /* keep last-good markets */ }
  }, [])

  // ── Fear & Greed fallback (only if the shell didn't supply it) ──
  const fetchFearGreed = useCallback(async () => {
    if (normalizeFg(fearGreedProp)) return // shell already has it
    try {
      const fg = await getSpectreFearGreedCurrent().catch(() => null)
      const next = normalizeFg(fg)
      if (next) setFearGreed(next)
    } catch { /* keep last-good */ }
  }, [fearGreedProp])

  // Fire on activation.
  useEffect(() => {
    if (!enabled) return
    fetchOutlook()
    fetchNews()
    fetchMarkets()
    fetchFearGreed()
  }, [enabled, fetchOutlook, fetchNews, fetchMarkets, fetchFearGreed])

  // Adaptive polling — gated on `enabled`, paused when tab hidden/idle.
  useAdaptivePolling(fetchOutlook, { interval: OUTLOOK_INTERVAL, enabled })
  useAdaptivePolling(fetchNews, { interval: NEWS_INTERVAL, enabled })
  useAdaptivePolling(fetchMarkets, { interval: MARKETS_INTERVAL, enabled })
  useAdaptivePolling(fetchFearGreed, { interval: FG_INTERVAL, enabled })

  return {
    outlook,
    news,
    markets,
    fearGreed,
    outlookLoading,
    newsLoading,
    error,
    lastUpdated,
  }
}
