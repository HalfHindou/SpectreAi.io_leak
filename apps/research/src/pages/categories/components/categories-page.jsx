/**
 * CategoriesPage - Full-screen categories explorer with trending categories,
 * trending tokens, AI analysis widgets, and sortable data table.
 * Clicking a category shows a detail sub-view with tokens in that category.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { isAppActive } from '@/lib/idleManager'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { getCategories, getCategoryCoins } from '@/services/coinGeckoApi'
import { getStockQuotes, getStockLogoUrl, POPULAR_STOCKS, FALLBACK_STOCK_DATA } from '@/services/stockApi'
import ShareXButton from '@/components/share-x-button'
import ShareXModal from '@/components/share-x-modal'
import { renderShareCard, preloadLogos, truncateText, formatLargeNumber, drawCardDivider, getSpectreLogo, CARD_PAD } from '@/lib/shareToX'
import SpectreSparkline from '@/chart/SpectreSparkline'
import InfoTip from '@/components/InfoTip'
import FreshnessTag from '@/components/freshness-tag'
import useCategoryInsight, { useSectorLandscapeInsight } from './use-category-insight'
import useCategorySparklines from './use-category-sparklines'
// Default pageView is 'categories'. MomentumBoard only renders on
// 'trending' tab — lazy keeps it out of every default visit.
const MomentumBoard = lazy(() => import('./momentum-board'))
import './categories-page.css'
import './categories-page.mobile.css'
import './categories-polish.css'

/* ── String -> uint32 hash (FNV-1a) for deterministic per-row variation ── */
function hashStr(s) {
  let h = 0x811c9dc5
  const str = String(s || '')
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h >>> 0
}

/* ── Build a synthetic OHLC-like wave with per-row distinct shape ── */
function buildSyntheticWave(change, seedKey, pts = 72) {
  const positive = (change || 0) >= 0
  const h = hashStr(`${seedKey || 'default'}:${change}`)
  // Derive distinct frequencies, phases, and amplitudes per row
  const f1 = 0.18 + ((h & 0xff) / 255) * 0.55          // 0.18 - 0.73
  const f2 = 0.6 + (((h >> 8) & 0xff) / 255) * 1.6     // 0.6 - 2.2
  const f3 = 1.4 + (((h >> 16) & 0xff) / 255) * 2.4    // 1.4 - 3.8
  const f4 = 3.0 + (((h >> 24) & 0xff) / 255) * 3.5    // 3.0 - 6.5
  const ph1 = ((h >>> 4) & 0xfff) / 4095 * Math.PI * 2
  const ph2 = ((h >>> 9) & 0xfff) / 4095 * Math.PI * 2
  const ph3 = ((h >>> 14) & 0xfff) / 4095 * Math.PI * 2
  const ph4 = ((h >>> 19) & 0xfff) / 4095 * Math.PI * 2
  const baseAmp = Math.min(20, 7 + Math.abs(change || 0) * 0.32)
  // Random distribution of energy across harmonics (sums normalized)
  const w1 = 0.5 + ((h >> 2) & 0x7) / 14    // 0.5-1.0
  const w2 = 0.35 + ((h >> 5) & 0x7) / 20   // 0.35-0.7
  const w3 = 0.2 + ((h >> 11) & 0x7) / 35   // 0.2-0.4
  const w4 = 0.08 + ((h >> 17) & 0x7) / 100 // 0.08-0.15
  const trendStrength = 24 + ((h >> 21) & 0xf) * 1.2 // 24-42

  const data = []
  let drift = 0
  for (let i = 0; i < pts; i++) {
    const p = i / (pts - 1)
    // Slight non-linear trend (eased) so it doesn't look like a perfect ramp
    const eased = positive ? Math.pow(p, 0.85) : 1 - Math.pow(1 - p, 0.85)
    const trend = (positive ? 1 : -1) * eased * trendStrength
    // Random walk drift adds organic feel
    drift += (Math.sin(i * 0.7 + ph1 * 1.3) * 0.6) - drift * 0.05
    const wave =
      Math.sin(i * f1 + ph1) * baseAmp * w1 +
      Math.sin(i * f2 + ph2) * baseAmp * w2 +
      Math.cos(i * f3 + ph3) * baseAmp * w3 +
      Math.sin(i * f4 + ph4) * baseAmp * w4
    const v = Math.max(6, Math.min(94, 50 + trend + wave + drift * 2))
    data.push(v)
  }
  return data
}

/* ── Real sparkline from API price data ── */
const TokenSparkline = ({ prices, positive, seedKey }) => {
  if (!prices || prices.length < 2) {
    return <MiniSparkline change={positive ? 5 : -5} width={120} height={42} rich seedKey={seedKey} />
  }
  return <SpectreSparkline data={prices} width={120} height={42} color={positive ? '#22D3A0' : '#FB6C6C'} strokeWidth={1.4} filled relief className="cat-sparkline-svg" />
}

/* ── REAL category 7d trend (cap-weighted top-coin blend, see the hook) ── */
const CatTrendLine = ({ series, width = 120, height = 42 }) => {
  const positive = (series?.change7d || 0) >= 0
  return (
    <SpectreSparkline
      data={series.points}
      width={width}
      height={height}
      color={positive ? '#22D3A0' : '#FB6C6C'}
      strokeWidth={1.6}
      filled
      relief
      className="cat-sparkline-svg"
    />
  )
}

/* ── Honest fallback when no real series is derivable: a quiet centered
      momentum bar driven by the REAL 24h change - never a fake waveform. ── */
const CatMomentumBar = ({ change, width = 120 }) => {
  const ch = Number(change) || 0
  const positive = ch >= 0
  // 12% caps the scale - beyond that the bar is simply full.
  const mag = Math.min(1, Math.abs(ch) / 12)
  return (
    <div className="cat-momentum" style={{ width }} title={`${positive ? '+' : ''}${ch.toFixed(1)}% 24h`}>
      <div className="cat-momentum-track">
        <span className="cat-momentum-zero" aria-hidden />
        <span
          className={`cat-momentum-fill ${positive ? 'pos' : 'neg'}`}
          style={positive
            ? { left: '50%', width: `${mag * 50}%` }
            : { right: '50%', width: `${mag * 50}%` }}
        />
      </div>
      <span className="cat-momentum-tag">24H</span>
    </div>
  )
}

/* ── Mini sparkline for cards (rich, cinematic) ── */
const MiniSparkline = ({ change, width = 60, height = 24, rich = false, seedKey }) => {
  const positive = (change || 0) >= 0
  const pts = rich ? 72 : 22
  const data = buildSyntheticWave(change, seedKey ?? change, pts)
  return (
    <SpectreSparkline
      data={data}
      width={width}
      height={height}
      color={positive ? '#22D3A0' : '#FB6C6C'}
      strokeWidth={rich ? 1.6 : 2.4}
      filled
      relief={rich}
    />
  )
}

/* ── Sort icon ── */
const SortIcon = ({ active, direction }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" className={`cat-sort-icon ${active ? 'active' : ''}`}>
    <path d="M5 1L8 4.5H2L5 1Z" fill={active && direction === 'asc' ? 'currentColor' : 'rgba(255,255,255,0.15)'} />
    <path d="M5 9L2 5.5H8L5 9Z" fill={active && direction === 'desc' ? 'currentColor' : 'rgba(255,255,255,0.15)'} />
  </svg>
)

const ITEMS_PER_PAGE = 25
// Category detail token pages. 100/page (one cached CG call) instead of 25 so a
// category opens with real depth - counts, trending picks and sorts are computed
// over a meaningful slice instead of the first 25 rows.
const COINS_PER_PAGE = 100

const CategoriesPage = ({ dayMode = false, onBack, marketMode = 'crypto', isMobile = false, initialCategoryId = null }) => {
  const { t } = useTranslation()
  const { fmtPrice, fmtLarge } = useCurrency()
  const isStocks = marketMode === 'stocks'

  // ── Categories list state ──
  // Top-level view toggle: Categories (default) vs Trending (momentum board)
  const [pageView, setPageView] = useState('categories')
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState('market_cap')
  const [sortDirection, setSortDirection] = useState('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const trendingRef = useRef(null)
  const tableRef = useRef(null)

  // ── Mobile category list state ──
  const [mobileShowAll, setMobileShowAll] = useState(false)
  const [mobileCatFilter, setMobileCatFilter] = useState('all')

  // ── Category detail sub-view state ──
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [categoryCoins, setCategoryCoins] = useState([])
  const [categoryCoinsLoading, setCategoryCoinsLoading] = useState(false)
  const [categoryCoinsError, setCategoryCoinsError] = useState(null)
  const [categoryCoinsPage, setCategoryCoinsPage] = useState(1)
  const [lastPageSize, setLastPageSize] = useState(COINS_PER_PAGE)
  const [refetchKey, setRefetchKey] = useState(0)
  const [coinSearchQuery, setCoinSearchQuery] = useState('')
  const [coinSortField, setCoinSortField] = useState('market_cap')
  const [coinSortDir, setCoinSortDir] = useState('desc')
  const detailTableRef = useRef(null)
  const [isCatShareExporting, setIsCatShareExporting] = useState(false)
  const [catShareModalOpen, setCatShareModalOpen] = useState(false)
  const [catShareImageUrl, setCatShareImageUrl] = useState(null)
  const [catShareDescription, setCatShareDescription] = useState('')

  // ── Share category detail to X ──
  const handleShareCategory = useCallback(async () => {
    if (isCatShareExporting || !selectedCategory) return
    setIsCatShareExporting(true)
    setCatShareImageUrl(null)
    setCatShareModalOpen(true)

    try {
      const coins = [...categoryCoins].sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0)).slice(0, 20)
      const catName = selectedCategory.name || 'Category'
      const catChange = selectedCategory.market_cap_change_24h || 0
      const catMcap = selectedCategory.market_cap || 0

      setCatShareDescription(`📂 ${catName} - ${catChange >= 0 ? '+' : ''}${catChange.toFixed(1)}% today\n\nMarket Cap: ${catMcap >= 1e12 ? `$${(catMcap / 1e12).toFixed(2)}T` : `$${(catMcap / 1e9).toFixed(1)}B`}\nTop ${coins.length} tokens inside\n\n@Spectre__Ai #crypto`)

      // Pre-load logos
      const spectreLogo = await getSpectreLogo()
      const logoMap = await preloadLogos(coins, (c) => c.image)

      const dataUrl = renderShareCard(
        (ctx, w, contentTop, c, fonts) => {
          const pad = CARD_PAD
          let y = contentTop + 4

          // Category stats
          ctx.textAlign = 'center'
          ctx.font = `500 11px ${fonts.body}`
          ctx.fillStyle = c.muted
          const mcapStr = formatLargeNumber(catMcap)
          ctx.fillText(`Market Cap: ${mcapStr}`, w / 2 - 60, y + 10)
          ctx.fillStyle = catChange >= 0 ? c.bull : c.bear
          ctx.fillText(`${catChange >= 0 ? '+' : ''}${catChange.toFixed(1)}% 24h`, w / 2 + 60, y + 10)
          y += 26

          drawCardDivider(ctx, y, w, c, pad)
          y += 14

          // Table header
          ctx.font = `600 9.5px ${fonts.body}`
          ctx.fillStyle = c.thColor
          ctx.textAlign = 'left'
          ctx.fillText('#', pad + 4, y + 10)
          ctx.fillText('TOKEN', pad + 41, y + 10)
          ctx.textAlign = 'right'
          ctx.fillText('PRICE', pad + 240, y + 10)
          ctx.fillText('24H', pad + 320, y + 10)
          ctx.fillText('7D', pad + 395, y + 10)
          ctx.fillText('MCAP', w - pad - 4, y + 10)
          y += 24

          const rowH = 40
          coins.forEach((coin, i) => {
            const ry = y + i * rowH
            if (i % 2 === 0) {
              ctx.fillStyle = c.rowAlt
              ctx.beginPath(); ctx.roundRect(pad, ry, w - pad * 2, rowH, 6); ctx.fill()
            }
            const textY = ry + 25
            // Rank
            ctx.textAlign = 'center'
            ctx.font = `500 11px ${fonts.mono}`
            ctx.fillStyle = c.rank
            ctx.fillText(String(i + 1), pad + 16, textY)
            // Logo
            const sym = (coin.symbol || '').toUpperCase()
            const logo = logoMap[sym] || logoMap[coin.symbol]
            const lx = pad + 41, ls = 22, lr = 5
            if (logo) {
              ctx.save()
              ctx.beginPath(); ctx.roundRect(lx, ry + 9, ls, ls, lr); ctx.clip()
              ctx.drawImage(logo, lx, ry + 9, ls, ls)
              ctx.restore()
            } else {
              ctx.fillStyle = c.fallbackBg
              ctx.beginPath(); ctx.roundRect(lx, ry + 9, ls, ls, lr); ctx.fill()
              ctx.fillStyle = c.fallbackText
              ctx.font = `700 9px ${fonts.body}`
              ctx.textAlign = 'center'
              ctx.fillText(sym.charAt(0), lx + ls / 2, ry + 23)
            }
            // Symbol + Name
            ctx.textAlign = 'left'
            ctx.font = `600 12px ${fonts.body}`
            ctx.fillStyle = c.symbol
            ctx.fillText(sym, lx + 28, textY - 2)
            ctx.font = `400 9px ${fonts.body}`
            ctx.fillStyle = c.name
            ctx.fillText(truncateText(ctx, coin.name || '', 80), lx + 28, textY + 10)
            // Price
            ctx.textAlign = 'right'
            ctx.font = `500 12px ${fonts.mono}`
            ctx.fillStyle = c.price
            ctx.fillText(fmtPrice(coin.current_price), pad + 240, textY)
            // 24H Change
            const ch24 = coin.price_change_percentage_24h || 0
            ctx.font = `600 12px ${fonts.mono}`
            ctx.fillStyle = ch24 >= 0 ? c.bull : c.bear
            ctx.fillText(`${ch24 >= 0 ? '+' : ''}${ch24.toFixed(1)}%`, pad + 320, textY)
            // 7D Change
            const ch7d = coin.price_change_percentage_7d_in_currency || 0
            ctx.fillStyle = ch7d >= 0 ? c.bull : c.bear
            ctx.fillText(`${ch7d >= 0 ? '+' : ''}${ch7d.toFixed(1)}%`, pad + 395, textY)
            // MCap
            ctx.font = `500 11px ${fonts.mono}`
            ctx.fillStyle = c.muted
            ctx.fillText(formatLargeNumber(coin.market_cap || 0), w - pad - 4, textY)
          })

          return (y - contentTop) + coins.length * rowH + 16
        },
        {
          title: 'Category Analysis',
          logo: spectreLogo,
          badges: [
            { text: '24H', filled: false },
            { text: catName.length > 18 ? catName.slice(0, 17) + '\u2026' : catName, filled: true },
          ],
          subtitle: `${coins.length} Tokens`,
        },
      )
      setCatShareImageUrl(dataUrl)
    } catch (err) {
      console.error('Category share failed:', err)
      setCatShareModalOpen(false)
    }
    setIsCatShareExporting(false)
  }, [isCatShareExporting, selectedCategory, categoryCoins, fmtPrice])

  /* ── Handshake: auto-open a category if the user arrived from another
       page (e.g., Mindshare sector pill) that wrote `spectre-category-target`
       into sessionStorage. We resolve once categories have loaded. ── */
  useEffect(() => {
    if (!categories || categories.length === 0) return
    const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    // URL deep-link: /categories/:categoryId (App.jsx route). Resolve it against
    // the loaded list so a shared link opens the detail, not just the list.
    if (initialCategoryId && !selectedCategory) {
      const wantId = String(initialCategoryId).toLowerCase()
      const wantKey = norm(wantId)
      const urlMatch = categories.find((c) => c.id === wantId || norm(c.id) === wantKey)
      if (urlMatch) { setSelectedCategory(urlMatch); return }
    }
    let raw = null
    try { raw = sessionStorage.getItem('spectre-category-target') } catch (_) { return }
    if (!raw) return
    let target = null
    try { target = JSON.parse(raw) } catch (_) { target = null }
    try { sessionStorage.removeItem('spectre-category-target') } catch (_) {}
    if (!target) return
    // Expire stale handshakes (e.g., refreshed tab much later) after 5 min.
    if (target.ts && Date.now() - target.ts > 5 * 60 * 1000) return
    const targetId = String(target.id || '').toLowerCase()
    const targetName = String(target.name || '').toLowerCase()
    const idKey = norm(targetId)
    const nameKey = norm(targetName)
    const match = categories.find((c) => {
      if (targetId && (c.id === targetId || norm(c.id) === idKey)) return true
      if (targetName && norm(c.name) === nameKey) return true
      return false
    })
    if (match) setSelectedCategory(match)
  }, [categories, initialCategoryId])

  /* ── Fetch categories (crypto) or build sectors (stocks) ── */
  const fetchCryptoCategories = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getCategories()
      setCategories(data)
      setLoading(false)
    } catch (err) {
      setError(t('errors.failedToLoad'))
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    let cancelled = false

    const fetchStockSectors = async () => {
      // Instant: build sectors from POPULAR_STOCKS + FALLBACK_STOCK_DATA
      const sectorMap = {}
      POPULAR_STOCKS.forEach(stock => {
        const sector = stock.sector || 'Other'
        if (!sectorMap[sector]) sectorMap[sector] = { stocks: [] }
        const fb = FALLBACK_STOCK_DATA[stock.symbol]
        sectorMap[sector].stocks.push({
          symbol: stock.symbol,
          name: stock.name,
          price: fb?.price || 0,
          change: fb?.change || 0,
          marketCap: fb?.marketCap || 0,
          volume: fb?.volume || 0,
          sector,
          logo: getStockLogoUrl(stock.symbol),
        })
      })

      const sectorCategories = Object.entries(sectorMap).map(([sector, data]) => {
        const stocks = data.stocks
        const totalMcap = stocks.reduce((s, st) => s + (st.marketCap || 0), 0)
        const totalVol = stocks.reduce((s, st) => s + (st.volume || 0), 0)
        const avgChange = stocks.length > 0
          ? stocks.reduce((s, st) => s + (st.change || 0), 0) / stocks.length
          : 0
        return {
          id: sector.toLowerCase().replace(/\s+/g, '-'),
          name: sector,
          market_cap: totalMcap,
          volume_24h: totalVol,
          market_cap_change_24h: avgChange,
          top_3_coins: stocks.slice(0, 3).map(s => getStockLogoUrl(s.symbol)),
          stockCount: stocks.length,
          stocks,
          isStockSector: true,
        }
      }).sort((a, b) => b.market_cap - a.market_cap)

      if (!cancelled) {
        setCategories(sectorCategories)
        setLoading(false)
      }

      // Upgrade with live prices
      try {
        const allSymbols = POPULAR_STOCKS.map(s => s.symbol)
        const quotes = await getStockQuotes(allSymbols)
        if (cancelled || Object.keys(quotes).length === 0) return

        const liveSectorMap = {}
        POPULAR_STOCKS.forEach(stock => {
          const sector = stock.sector || 'Other'
          if (!liveSectorMap[sector]) liveSectorMap[sector] = { stocks: [] }
          const q = quotes[stock.symbol]
          const fb = FALLBACK_STOCK_DATA[stock.symbol]
          liveSectorMap[sector].stocks.push({
            symbol: stock.symbol,
            name: q?.name || stock.name,
            price: q?.price || fb?.price || 0,
            change: q?.change || fb?.change || 0,
            marketCap: q?.marketCap || fb?.marketCap || 0,
            volume: q?.volume || fb?.volume || 0,
            sector,
            pe: q?.pe || fb?.pe || null,
            logo: getStockLogoUrl(stock.symbol),
          })
        })

        const liveSectorCategories = Object.entries(liveSectorMap).map(([sector, data]) => {
          const stocks = data.stocks
          const totalMcap = stocks.reduce((s, st) => s + (st.marketCap || 0), 0)
          const totalVol = stocks.reduce((s, st) => s + (st.volume || 0), 0)
          const avgChange = stocks.length > 0
            ? stocks.reduce((s, st) => s + (st.change || 0), 0) / stocks.length
            : 0
          return {
            id: sector.toLowerCase().replace(/\s+/g, '-'),
            name: sector,
            market_cap: totalMcap,
            volume_24h: totalVol,
            market_cap_change_24h: avgChange,
            top_3_coins: stocks.slice(0, 3).map(s => getStockLogoUrl(s.symbol)),
            stockCount: stocks.length,
            stocks,
            isStockSector: true,
          }
        }).sort((a, b) => b.market_cap - a.market_cap)

        setCategories(liveSectorCategories)
      } catch (err) {
        console.warn('[categories] stock quotes fetch failed:', err?.message)
      }
    }

    if (isStocks) {
      fetchStockSectors()
    } else {
      fetchCryptoCategories()
    }

    return () => { cancelled = true }
  }, [isStocks, fetchCryptoCategories])

  // Polling callback for categories refresh.
  // useAdaptivePolling already gates the interval on document.hidden; the
  // isAppActive() check adds the idle guard so a visible-but-abandoned tab
  // stops burning the stock/categories upstream quota after ~5 min idle.
  const pollCategories = useCallback(async () => {
    if (isAppActive && !isAppActive()) return
    if (isStocks) {
      try {
        const allSymbols = POPULAR_STOCKS.map(s => s.symbol)
        const quotes = await getStockQuotes(allSymbols)
        if (Object.keys(quotes).length === 0) return
        const liveSectorMap = {}
        POPULAR_STOCKS.forEach(stock => {
          const sector = stock.sector || 'Other'
          if (!liveSectorMap[sector]) liveSectorMap[sector] = { stocks: [] }
          const q = quotes[stock.symbol]
          const fb = FALLBACK_STOCK_DATA[stock.symbol]
          liveSectorMap[sector].stocks.push({
            symbol: stock.symbol, name: q?.name || stock.name,
            price: q?.price || fb?.price || 0, change: q?.change || fb?.change || 0,
            marketCap: q?.marketCap || fb?.marketCap || 0, volume: q?.volume || fb?.volume || 0,
            sector, pe: q?.pe || fb?.pe || null, logo: getStockLogoUrl(stock.symbol),
          })
        })
        const cats = Object.entries(liveSectorMap).map(([sector, data]) => {
          const stocks = data.stocks
          const totalMcap = stocks.reduce((s, st) => s + (st.marketCap || 0), 0)
          const totalVol = stocks.reduce((s, st) => s + (st.volume || 0), 0)
          const avgChange = stocks.length > 0
            ? stocks.reduce((s, st) => s + (st.change || 0), 0) / stocks.length : 0
          return {
            id: sector.toLowerCase().replace(/\s+/g, '-'), name: sector,
            market_cap: totalMcap, volume_24h: totalVol, market_cap_change_24h: avgChange,
            top_3_coins: stocks.slice(0, 3).map(s => getStockLogoUrl(s.symbol)),
            stockCount: stocks.length, stocks, isStockSector: true,
          }
        }).sort((a, b) => b.market_cap - a.market_cap)
        setCategories(cats)
      } catch (e) {
        console.warn('[categories] stock sector polling failed:', e?.message)
      }
    } else {
      try {
        const data = await getCategories()
        if (data) setCategories(data)
      } catch (e) {
        console.warn('[categories] categories polling failed:', e?.message)
      }
    }
  }, [isStocks])

  // Adaptive polling for categories data (5 min)
  useAdaptivePolling(pollCategories, { interval: 5 * 60 * 1000 })

  /* ── Fetch category coins when detail view active ── */
  useEffect(() => {
    if (!selectedCategory) return
    let cancelled = false

    if (isStocks && selectedCategory.isStockSector) {
      // Stock mode: stocks are already in the category object
      const stocks = selectedCategory.stocks || []
      const mapped = stocks.map((st, i) => ({
        id: st.symbol,
        symbol: st.symbol,
        name: st.name,
        image: st.logo || getStockLogoUrl(st.symbol),
        current_price: st.price,
        price_change_percentage_24h: st.change,
        price_change_percentage_7d_in_currency: 0,
        market_cap: st.marketCap,
        total_volume: st.volume,
        market_cap_rank: i + 1,
        pe: st.pe,
        sector: st.sector,
        sparkline_in_7d: null,
        isStock: true,
      }))
      setCategoryCoins(mapped)
      setCategoryCoinsLoading(false)
      return
    }

    // Capture the category id at fetch start so a response for category A
    // can't land into category B after a rapid switch (the reset-page effect
    // races against this fetch effect when both selectedCategory and
    // categoryCoinsPage change).
    const fetchedCategoryId = selectedCategory.id
    const fetchedPage = categoryCoinsPage
    const fetchCoins = async () => {
      setCategoryCoinsLoading(true)
      setCategoryCoinsError(null)
      try {
        // sparkline: true - the detail table's "Last 7 Days" column draws the
        // coins' REAL 7d arrays (synthetic waves are gone). cgOnly: the Spectre
        // bridge carries no sparkline arrays, so a bridge race-win would blank
        // every chart back to fakes; CG is the canonical membership list anyway.
        const data = await getCategoryCoins(fetchedCategoryId, fetchedPage, COINS_PER_PAGE, { sparkline: true, cgOnly: true })
        if (cancelled) return
        if (fetchedCategoryId !== selectedCategory.id) return
        const rows = Array.isArray(data) ? data : []
        setCategoryCoins(prev => fetchedPage === 1 ? rows : [...prev, ...rows])
        setLastPageSize(rows.length)
        setCategoryCoinsLoading(false)
      } catch (err) {
        if (!cancelled && fetchedCategoryId === selectedCategory.id) {
          setCategoryCoinsError(t('errors.failedToLoad'))
          setCategoryCoinsLoading(false)
        }
      }
    }
    fetchCoins()
    return () => { cancelled = true }
  }, [selectedCategory, categoryCoinsPage, isStocks, refetchKey, t])

  // Reset coin page when category changes
  useEffect(() => {
    setCategoryCoinsPage(1)
    setCategoryCoins([])
    setLastPageSize(COINS_PER_PAGE)
    setCoinSearchQuery('')
    setCoinSortField('market_cap')
    setCoinSortDir('desc')
  }, [selectedCategory?.id])

  /* ── Category list sort handler ── */
  const handleSort = useCallback((field) => {
    setSortField(prev => {
      if (prev === field) {
        setSortDirection(d => d === 'desc' ? 'asc' : 'desc')
        return field
      }
      setSortDirection('desc')
      return field
    })
  }, [])

  /* ── Coin sort handler ── */
  const handleCoinSort = useCallback((field) => {
    setCoinSortField(prev => {
      if (prev === field) {
        setCoinSortDir(d => d === 'desc' ? 'asc' : 'desc')
        return field
      }
      setCoinSortDir('desc')
      return field
    })
  }, [])

  /* ── Filter + sort categories ── */
  const filteredCategories = useMemo(() => {
    let result = [...categories]
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(c => (c.name || '').toLowerCase().includes(q))
    }
    result.sort((a, b) => {
      if (sortField === 'name') {
        const cmp = (a.name || '').localeCompare(b.name || '')
        return sortDirection === 'asc' ? cmp : -cmp
      }
      const aVal = a[sortField] || 0
      const bVal = b[sortField] || 0
      return sortDirection === 'desc' ? bVal - aVal : aVal - bVal
    })
    return result
  }, [categories, searchQuery, sortField, sortDirection])

  /* ── Mobile: filter + limit categories ── */
  const MOBILE_INITIAL_COUNT = 10
  const mobileFilteredCategories = useMemo(() => {
    let result = filteredCategories
    if (mobileCatFilter === 'gainers') {
      result = result.filter(c => (c.market_cap_change_24h || 0) > 0)
    } else if (mobileCatFilter === 'losers') {
      result = result.filter(c => (c.market_cap_change_24h || 0) < 0)
    } else if (mobileCatFilter === 'large') {
      result = result.filter(c => (c.market_cap || 0) >= 1e10)
    } else if (mobileCatFilter === 'small') {
      result = result.filter(c => (c.market_cap || 0) < 1e10 && (c.market_cap || 0) > 0)
    }
    return result
  }, [filteredCategories, mobileCatFilter])

  const mobileVisibleCategories = mobileShowAll
    ? mobileFilteredCategories
    : mobileFilteredCategories.slice(0, MOBILE_INITIAL_COUNT)

  const mobileHasMore = mobileFilteredCategories.length > MOBILE_INITIAL_COUNT

  // Reset show-all when filter or search changes
  useEffect(() => { setMobileShowAll(false) }, [mobileCatFilter, searchQuery])

  /* ── Categories pagination ── */
  const totalPages = Math.max(1, Math.ceil(filteredCategories.length / ITEMS_PER_PAGE))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const pageStart = (safeCurrentPage - 1) * ITEMS_PER_PAGE
  const paginatedCategories = filteredCategories.slice(pageStart, pageStart + ITEMS_PER_PAGE)

  useEffect(() => { setCurrentPage(1) }, [searchQuery, sortField, sortDirection])

  const goToPage = useCallback((page) => {
    const p = Math.max(1, Math.min(page, totalPages))
    setCurrentPage(p)
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [totalPages])

  const getPageNumbers = useCallback(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const pages = []
    if (safeCurrentPage <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i)
      pages.push('...')
      pages.push(totalPages)
    } else if (safeCurrentPage >= totalPages - 3) {
      pages.push(1)
      pages.push('...')
      for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      pages.push('...')
      for (let i = safeCurrentPage - 1; i <= safeCurrentPage + 1; i++) pages.push(i)
      pages.push('...')
      pages.push(totalPages)
    }
    return pages
  }, [totalPages, safeCurrentPage])

  /* ── Derived data for category list widgets ── */
  const trendingCategories = useMemo(() => {
    if (!categories.length) return []
    return [...categories]
      .filter(c => c.market_cap > 0)
      .sort((a, b) => Math.abs(b.market_cap_change_24h || 0) - Math.abs(a.market_cap_change_24h || 0))
      .slice(0, 12)
  }, [categories])

  const topGainers = useMemo(() => {
    if (!categories.length) return []
    return [...categories]
      .filter(c => (c.market_cap_change_24h || 0) > 0 && c.market_cap > 100000000)
      .sort((a, b) => (b.market_cap_change_24h || 0) - (a.market_cap_change_24h || 0))
      .slice(0, 5)
  }, [categories])

  const topLosers = useMemo(() => {
    if (!categories.length) return []
    return [...categories]
      .filter(c => (c.market_cap_change_24h || 0) < 0 && c.market_cap > 100000000)
      .sort((a, b) => (a.market_cap_change_24h || 0) - (b.market_cap_change_24h || 0))
      .slice(0, 5)
  }, [categories])

  const aiInsight = useMemo(() => {
    if (!categories.length) return null
    const total = categories.filter(c => c.market_cap > 0).length
    const bullish = categories.filter(c => (c.market_cap_change_24h || 0) > 0).length
    const bearish = total - bullish
    const bullPct = total > 0 ? Math.round((bullish / total) * 100) : 0
    const avgChange = categories.reduce((s, c) => s + (c.market_cap_change_24h || 0), 0) / (total || 1)
    const topCat = [...categories].filter(c => c.market_cap > 0).sort((a, b) => (b.market_cap_change_24h || 0) - (a.market_cap_change_24h || 0))[0]
    const bottomCat = [...categories].filter(c => c.market_cap > 0).sort((a, b) => (a.market_cap_change_24h || 0) - (b.market_cap_change_24h || 0))[0]
    const sentiment = avgChange > 1 ? 'bullish' : avgChange < -1 ? 'bearish' : 'neutral'
    return { total, bullish, bearish, bullPct, avgChange, topCat, bottomCat, sentiment }
  }, [categories])

  /* ── Derived data for category detail view ── */
  const trendingInCategory = useMemo(() => {
    if (!categoryCoins.length) return []
    return [...categoryCoins]
      .filter(c => c.current_price > 0)
      .sort((a, b) => Math.abs(b.price_change_percentage_24h || 0) - Math.abs(a.price_change_percentage_24h || 0))
      .slice(0, 10)
  }, [categoryCoins])

  const categoryAiInsight = useMemo(() => {
    if (!categoryCoins.length) return null
    const coins = categoryCoins.filter(c => c.current_price > 0)
    const total = coins.length
    const bullish = coins.filter(c => (c.price_change_percentage_24h || 0) > 0).length
    const bearish = total - bullish
    const bullPct = total > 0 ? Math.round((bullish / total) * 100) : 0
    const avgChange = coins.reduce((s, c) => s + (c.price_change_percentage_24h || 0), 0) / (total || 1)
    const avgChange7d = coins.reduce((s, c) => s + (c.price_change_percentage_7d_in_currency || 0), 0) / (total || 1)
    const topCoin = [...coins].sort((a, b) => (b.price_change_percentage_24h || 0) - (a.price_change_percentage_24h || 0))[0]
    const bottomCoin = [...coins].sort((a, b) => (a.price_change_percentage_24h || 0) - (b.price_change_percentage_24h || 0))[0]
    const volLeader = [...coins].sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0))[0]
    const totalVolume = coins.reduce((s, c) => s + (c.total_volume || 0), 0)
    const volLeaderShare = totalVolume > 0 && volLeader ? Math.round(((volLeader.total_volume || 0) / totalVolume) * 100) : 0
    const sentiment = avgChange > 1 ? 'bullish' : avgChange < -1 ? 'bearish' : 'neutral'
    return { total, bullish, bearish, bullPct, avgChange, avgChange7d, topCoin, bottomCoin, volLeader, volLeaderShare, sentiment }
  }, [categoryCoins])

  // Real LLM read for the open category - upgrades the computed panel in place.
  const { insight: catLlmInsight, updatedAt: catLlmInsightTs } = useCategoryInsight({
    category: selectedCategory,
    coins: categoryCoins,
    enabled: !isStocks && !selectedCategory?.isStockSector,
  })

  // One LLM read across the whole sector landscape (list view AI panel).
  const { insight: landscapeInsight, updatedAt: landscapeInsightTs } = useSectorLandscapeInsight({
    categories,
    enabled: !isStocks && pageView === 'categories',
  })

  // Real 7d proxy lines for category cards/rows (cap-weighted top-coin blend).
  const catSparklines = useCategorySparklines(categories, { enabled: !isStocks })

  const sortedCategoryCoins = useMemo(() => {
    let coins = [...categoryCoins]
    if (coinSearchQuery.trim()) {
      const q = coinSearchQuery.trim().toLowerCase()
      coins = coins.filter(c => (c.name || '').toLowerCase().includes(q) || (c.symbol || '').toLowerCase().includes(q))
    }
    coins.sort((a, b) => {
      if (coinSortField === 'name') {
        const cmp = (a.name || '').localeCompare(b.name || '')
        return coinSortDir === 'asc' ? cmp : -cmp
      }
      const aVal = a[coinSortField] || 0
      const bVal = b[coinSortField] || 0
      return coinSortDir === 'desc' ? bVal - aVal : aVal - bVal
    })
    return coins
  }, [categoryCoins, coinSearchQuery, coinSortField, coinSortDir])

  const isLastCoinPage = lastPageSize < COINS_PER_PAGE

  /* ════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════ */
  return (
    <div className={`categories-page ${dayMode ? 'day-mode' : ''} ${isStocks ? 'stocks-mode' : ''}`}>

      {/* ═══════════════════════════════════════════════════
          MOBILE LAYOUT
          ═══════════════════════════════════════════════════ */}
      {isMobile && (
        <div className="mcat-content">
          {/* Categories / Trending page-view toggle (hidden inside a category detail) */}
          {!selectedCategory && (
            <div className="mcat-section mcat-pageview-section">
              <div className="cat-pageview-toggle mcat-pageview-toggle" role="tablist" aria-label="Categories view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={pageView === 'categories'}
                  className={`cat-pageview-btn${pageView === 'categories' ? ' active' : ''}`}
                  onClick={() => setPageView('categories')}
                >
                  {isStocks ? t('categories.tabSectors', 'Sectors') : t('categories.tabCategories', 'Categories')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={pageView === 'trending'}
                  className={`cat-pageview-btn${pageView === 'trending' ? ' active' : ''}`}
                  onClick={() => setPageView('trending')}
                >
                  <span className="cat-pageview-dot" aria-hidden />
                  {t('categories.tabTrending', 'Trending')}
                </button>
              </div>
            </div>
          )}

          {!selectedCategory && pageView === 'trending' ? (
            /* ── Mobile Trending (Momentum Board) ── */
            <div className="mcat-section-flush">
              <Suspense fallback={null}>
                <MomentumBoard enabled={pageView === 'trending'} />
              </Suspense>
            </div>
          ) : selectedCategory ? (
            /* ── Mobile Category Detail ── */
            <>
              {/* Back + Title */}
              <div className="mcat-section">
                <button type="button" className="mcat-back-btn" onClick={() => setSelectedCategory(null)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  {t('categories.allCategories', 'All Categories')}
                </button>
              </div>

              <div className="mcat-detail-hero">
                <div className="mcat-detail-logos">
                  {(selectedCategory.top_3_coins || []).slice(0, 3).map((img, i) => (
                    <img key={`m-detail-logo-${i}`} src={img} alt="" className="mcat-detail-logo" onError={(e) => { e.target.style.display = 'none' }} />
                  ))}
                </div>
                <h1 className="mcat-detail-title">{selectedCategory.name}</h1>
                <div className="mcat-detail-meta">
                  <span className={`mcat-change-pill ${(selectedCategory.market_cap_change_24h || 0) >= 0 ? 'pos' : 'neg'}`}>
                    {(selectedCategory.market_cap_change_24h || 0) >= 0 ? '+' : ''}{(selectedCategory.market_cap_change_24h || 0).toFixed(1)}%
                  </span>
                  <span className="mcat-detail-count">
                    {categoryCoins.length > 0 ? t('categories.tokensCount', { count: categoryCoins.length, defaultValue: `${categoryCoins.length} tokens` }) : t('categories.loading', 'Loading')}
                  </span>
                </div>
              </div>

              {/* Detail stats */}
              <div className="mcat-section">
                <div className="mcat-stats-grid">
                  <div className="mcat-stat-card">
                    <span className="mcat-stat-label">{t('common.marketCap')}</span>
                    <span className="mcat-stat-value">{fmtLarge(selectedCategory.market_cap || 0)}</span>
                  </div>
                  <div className="mcat-stat-card">
                    <span className="mcat-stat-label">{t('common.volume24h')}</span>
                    <span className="mcat-stat-value">{fmtLarge(selectedCategory.volume_24h || 0)}</span>
                  </div>
                  {categoryAiInsight && (
                    <>
                      <div className="mcat-stat-card">
                        <span className="mcat-stat-label">{t('categories.sentiment', 'Sentiment')}</span>
                        <span className={`mcat-stat-value ${categoryAiInsight.sentiment === 'bullish' ? 'bull' : categoryAiInsight.sentiment === 'bearish' ? 'bear' : ''}`}>
                          {t('categories.percentBullish', { n: categoryAiInsight.bullPct, defaultValue: `${categoryAiInsight.bullPct}% Bullish` })}
                        </span>
                      </div>
                      <div className="mcat-stat-card">
                        <span className="mcat-stat-label">{t('categories.topMover', 'Top Mover')}</span>
                        <span className="mcat-stat-value bull">{categoryAiInsight.topCoin?.symbol?.toUpperCase()}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Trending tokens in category */}
              {trendingInCategory.length > 0 && (
                <div className="mcat-section-flush">
                  <div className="mcat-section-header mcat-section-header--padded">
                    <span className="mcat-section-label">{t('common.trending')}</span>
                  </div>
                  <div className="mcat-trending-scroll">
                    {trendingInCategory.map((coin) => {
                      const ch = coin.price_change_percentage_24h || 0
                      return (
                        <div key={coin.id} className="mcat-trending-card">
                          <img src={coin.image} alt="" className="mcat-trending-logo" onError={(e) => { e.target.style.display = 'none' }} />
                          <span className="mcat-trending-symbol">{(coin.symbol || '').toUpperCase()}</span>
                          <span className="mcat-trending-price">{fmtPrice(coin.current_price)}</span>
                          <span className={`mcat-trending-change ${ch >= 0 ? 'pos' : 'neg'}`}>{ch >= 0 ? '+' : ''}{ch.toFixed(1)}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* AI Analysis */}
              {categoryAiInsight && (
                <div className="mcat-section">
                  <div className="mcat-section-header">
                    <span className="mcat-section-label">{t('categories.aiAnalysis')}</span>
                    <span className="mcat-live-badge">
                      <span className="mcat-live-dot" />{t('ticker.live', 'Live')}
                    </span>
                  </div>
                  <div className="mcat-ai-card">
                    <p className="mcat-ai-output">
                      {categoryAiInsight.sentiment === 'bullish' ? t('categories.bullish') : categoryAiInsight.sentiment === 'bearish' ? t('categories.bearish') : t('categories.neutral')} {t('categories.aiSentimentLeadIn', { count: categoryAiInsight.total, defaultValue: `sentiment across ${categoryAiInsight.total} tokens` })}.
                      {' '}{t('categories.tokensPositive', { bullish: categoryAiInsight.bullish, bullPct: categoryAiInsight.bullPct, bearish: categoryAiInsight.bearish })}.
                      {' '}{t('categories.avgChange', { change: `${categoryAiInsight.avgChange >= 0 ? '+' : ''}${categoryAiInsight.avgChange.toFixed(2)}` })}.
                    </p>
                    {catLlmInsight && (
                      <div className="mcat-ai-read">
                        {/* The LLM read is cached (10 min TTL) - stamp its real
                            age so a cached body is never presented as live. */}
                        {catLlmInsightTs && <FreshnessTag timestamp={catLlmInsightTs} tier="warm" label="AI read" />}
                        <p className="mcat-ai-headline">{catLlmInsight.title}</p>
                        <p className="mcat-ai-read-body">{catLlmInsight.body}</p>
                      </div>
                    )}
                    <div className="mcat-ai-meter">
                      <div className="mcat-ai-meter-labels"><span>{t('categories.bear', 'Bear')}</span><span>{t('categories.bull', 'Bull')}</span></div>
                      <div className="mcat-ai-meter-track">
                        <div className="mcat-ai-meter-fill" style={{ width: `${categoryAiInsight.bullPct}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Token list */}
              <div className="mcat-section">
                <div className="mcat-section-header">
                  <span className="mcat-section-label">{t('categories.tokens', 'Tokens')}</span>
                  <span className="mcat-count-badge">{sortedCategoryCoins.length}</span>
                </div>

                <div className="mcat-search-wrap">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    className="mcat-search"
                    type="text"
                    placeholder={t('categories.searchInCategory', { name: selectedCategory.name, defaultValue: `Search in ${selectedCategory.name}...` })}
                    value={coinSearchQuery}
                    onChange={(e) => setCoinSearchQuery(e.target.value)}
                  />
                  {coinSearchQuery && (
                    <button type="button" className="mcat-search-clear" aria-label="Clear search" onClick={() => setCoinSearchQuery('')}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>

                {categoryCoinsLoading ? (
                  <div className="mcat-token-list">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={`m-skel-${i}`} className="mcat-token-row mcat-skeleton-row" style={{ animationDelay: `${i * 0.05}s` }}>
                        <div className="mcat-skel-circle" />
                        <div className="mcat-skel-lines">
                          <div className="mcat-skel-line" style={{ width: '60%' }} />
                          <div className="mcat-skel-line short" style={{ width: '40%' }} />
                        </div>
                        <div className="mcat-skel-right">
                          <div className="mcat-skel-line" style={{ width: '70%' }} />
                          <div className="mcat-skel-line short" style={{ width: '50%' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mcat-token-list">
                    {sortedCategoryCoins.map((coin, index) => {
                      const ch24 = coin.price_change_percentage_24h || 0
                      return (
                        <div key={coin.id} className="mcat-token-row">
                          <span className="mcat-token-rank">
                            {index + 1}
                            {coin.market_cap_rank != null && coin.market_cap_rank !== index + 1 && (
                              <span className="mcat-rank-global">#{coin.market_cap_rank}</span>
                            )}
                          </span>
                          <img src={coin.image} alt="" className="mcat-token-logo" onError={(e) => { e.target.style.display = 'none' }} />
                          <div className="mcat-token-info">
                            <span className="mcat-token-name">{coin.name}</span>
                            <span className="mcat-token-symbol">{(coin.symbol || '').toUpperCase()}</span>
                          </div>
                          <div className="mcat-token-spark">
                            {coin.sparkline_in_7d?.price?.length > 1 ? (
                              <SpectreSparkline data={coin.sparkline_in_7d.price} width={44} height={20} color={ch24 >= 0 ? '#22D3A0' : '#FB6C6C'} strokeWidth={1.4} />
                            ) : (
                              <MiniSparkline change={ch24} width={44} height={20} />
                            )}
                          </div>
                          <div className="mcat-token-right">
                            <span className="mcat-token-price">{fmtPrice(coin.current_price)}</span>
                            <span className={`mcat-token-change ${ch24 >= 0 ? 'pos' : 'neg'}`}>
                              {ch24 >= 0 ? '+' : ''}{ch24.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      )
                    })}
                    {sortedCategoryCoins.length === 0 && !categoryCoinsLoading && (
                      <div className="mcat-empty">{coinSearchQuery ? t('categories.noTokensFoundFor', { q: coinSearchQuery, defaultValue: `No tokens found for "${coinSearchQuery}"` }) : t('categories.noTokensFound', 'No tokens found')}</div>
                    )}
                  </div>
                )}

                {!isLastCoinPage && (
                  <button className="mcat-load-more" onClick={() => setCategoryCoinsPage(p => p + 1)}>
                    {t('categories.loadMoreTokens', 'Load More Tokens')}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                )}
              </div>
            </>
          ) : (
            /* ── Mobile Category List ── */
            <>
              {/* Page title */}
              <div className="mcat-section">
                <div className="mcat-page-header">
                  <h1 className="mcat-page-title">{isStocks ? t('categories.stockSectors') : t('categories.title')}</h1>
                  {aiInsight && (
                    <span className={`mcat-sentiment-badge bias-${aiInsight.sentiment}`}>
                      <span className="mcat-sentiment-dot" />
                      {aiInsight.sentiment.toUpperCase()}
                    </span>
                  )}
                </div>
              </div>

              {/* Quick stats */}
              {aiInsight && (
                <div className="mcat-section">
                  <div className="mcat-stats-grid">
                    <div className="mcat-stat-card">
                      <span className="mcat-stat-label">{t('categories.bullish')}</span>
                      <span className="mcat-stat-value">{aiInsight.bullPct}%</span>
                    </div>
                    <div className="mcat-stat-card">
                      <span className="mcat-stat-label">{t('categories.avg24h')}</span>
                      <span className={`mcat-stat-value ${aiInsight.avgChange >= 0 ? 'bull' : 'bear'}`}>
                        {aiInsight.avgChange >= 0 ? '+' : ''}{aiInsight.avgChange.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mcat-stat-card">
                      <span className="mcat-stat-label">{t('categories.total')}</span>
                      <span className="mcat-stat-value">{aiInsight.total}</span>
                    </div>
                    <div className="mcat-stat-card">
                      <span className="mcat-stat-label">{t('categories.bestSector', 'Best Sector')}</span>
                      <span className={`mcat-stat-value bull${(aiInsight.topCat?.name?.length || 0) > 12 ? ' mcat-stat-value--long' : ''}`}>
                        {aiInsight.topCat?.name}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Trending categories */}
              {trendingCategories.length > 0 && (
                <div className="mcat-section-flush">
                  <div className="mcat-section-header mcat-section-header--padded">
                    <span className="mcat-section-label">{t('common.trending')}</span>
                  </div>
                  <div className="mcat-trending-scroll">
                    {trendingCategories.map((cat) => {
                      const ch = cat.market_cap_change_24h || 0
                      return (
                        <div key={cat.id} className="mcat-trending-card" onClick={() => setSelectedCategory(cat)}>
                          <div className="mcat-trending-logos">
                            {(cat.top_3_coins || []).slice(0, 3).map((img, i) => (
                              <img key={`m-trend-${i}`} src={img} alt="" className="mcat-trending-logo" onError={(e) => { e.target.style.display = 'none' }} />
                            ))}
                          </div>
                          <span className="mcat-trending-name">{cat.name}</span>
                          <div className="mcat-trending-bottom">
                            <span className={`mcat-trending-change ${ch >= 0 ? 'pos' : 'neg'}`}>{ch >= 0 ? '+' : ''}{ch.toFixed(1)}%</span>
                            {(() => {
                              const series = catSparklines.get(cat.id || cat.name) || null
                              return series
                                ? <CatTrendLine series={series} width={40} height={16} />
                                : <CatMomentumBar change={ch} width={40} />
                            })()}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Gainers & Losers */}
              <div className="mcat-section">
                <div className="mcat-movers-row">
                  {/* Gainers */}
                  <div className="mcat-movers-card">
                    <span className="mcat-section-label">{t('welcome.topGainers')}</span>
                    <div className="mcat-movers-list">
                      {topGainers.slice(0, 3).map((cat, i) => {
                        const ch = cat.market_cap_change_24h || 0
                        return (
                          <div key={cat.id} className="mcat-mover-row" onClick={() => setSelectedCategory(cat)}>
                            <span className="mcat-mover-rank">{i + 1}</span>
                            <span className="mcat-mover-name">{cat.name?.length > 14 ? cat.name.slice(0, 13) + '\u2026' : cat.name}</span>
                            <span className="mcat-mover-change pos">+{ch.toFixed(1)}%</span>
                          </div>
                        )
                      })}
                      {topGainers.length === 0 && <span className="mcat-movers-empty">{t('categories.noGainers', 'No gainers')}</span>}
                    </div>
                  </div>
                  {/* Losers */}
                  <div className="mcat-movers-card">
                    <span className="mcat-section-label">{t('welcome.topLosers')}</span>
                    <div className="mcat-movers-list">
                      {topLosers.slice(0, 3).map((cat, i) => {
                        const ch = cat.market_cap_change_24h || 0
                        return (
                          <div key={cat.id} className="mcat-mover-row" onClick={() => setSelectedCategory(cat)}>
                            <span className="mcat-mover-rank">{i + 1}</span>
                            <span className="mcat-mover-name">{cat.name?.length > 14 ? cat.name.slice(0, 13) + '\u2026' : cat.name}</span>
                            <span className="mcat-mover-change neg">{ch.toFixed(1)}%</span>
                          </div>
                        )
                      })}
                      {topLosers.length === 0 && <span className="mcat-movers-empty">{t('categories.noLosers', 'No losers')}</span>}
                    </div>
                  </div>
                </div>
              </div>

              {/* AI Analysis */}
              {aiInsight && (
                <div className="mcat-section">
                  <div className="mcat-section-header">
                    <span className="mcat-section-label">{t('categories.aiAnalysis')}</span>
                    <span className="mcat-live-badge">
                      <span className="mcat-live-dot" />{t('ticker.live', 'Live')}
                    </span>
                  </div>
                  <div className="mcat-ai-card">
                    <p className="mcat-ai-output">
                      {(aiInsight.sentiment === 'bullish' ? t('categories.bullish') : aiInsight.sentiment === 'bearish' ? t('categories.bearish') : t('categories.neutral'))} {t('categories.aiSentimentLeadInCats', { count: aiInsight.total, defaultValue: `sentiment across ${aiInsight.total} categories` })}.
                      {' '}{t('categories.tokensPositive', { bullish: aiInsight.bullish, bullPct: aiInsight.bullPct, bearish: aiInsight.bearish })}.
                      {' '}{t('categories.avgShort', { change: `${aiInsight.avgChange >= 0 ? '+' : ''}${aiInsight.avgChange.toFixed(2)}`, defaultValue: `Avg: ${aiInsight.avgChange >= 0 ? '+' : ''}${aiInsight.avgChange.toFixed(2)}%` })}.
                    </p>
                    {aiInsight.topCat && (
                      <p className="mcat-ai-output">
                        <span className="mcat-ai-highlight-green">{t('categories.bestLabel', 'Best')}:</span> {aiInsight.topCat.name} ({aiInsight.topCat.market_cap_change_24h >= 0 ? '+' : ''}{(aiInsight.topCat.market_cap_change_24h || 0).toFixed(1)}%).
                        {' '}<span className="mcat-ai-highlight-red">{t('categories.worstLabel', 'Worst')}:</span> {aiInsight.bottomCat?.name} ({(aiInsight.bottomCat?.market_cap_change_24h || 0).toFixed(1)}%).
                      </p>
                    )}
                    <div className="mcat-ai-meter">
                      <div className="mcat-ai-meter-labels"><span>{t('categories.bear', 'Bear')}</span><span>{t('categories.bull', 'Bull')}</span></div>
                      <div className="mcat-ai-meter-track">
                        <div className="mcat-ai-meter-fill" style={{ width: `${aiInsight.bullPct}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Category list / search */}
              <div className="mcat-section">
                <div className="mcat-section-header">
                  <span className="mcat-section-label">{isStocks ? t('categories.allSectors', 'All Sectors') : t('categories.allCategories', 'All Categories')}</span>
                  <span className="mcat-count-badge">{mobileFilteredCategories.length}</span>
                </div>

                <div className="mcat-search-wrap">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    className="mcat-search"
                    type="text"
                    placeholder={isStocks ? t('categories.searchSectors') : t('categories.searchCategories')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button type="button" className="mcat-search-clear" aria-label="Clear search" onClick={() => setSearchQuery('')}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Filter chips */}
                <div className="mcat-filter-scroll">
                  {[
                    { key: 'all', label: t('categories.filterAll', 'All') },
                    { key: 'gainers', label: t('categories.filterGainers', 'Gainers') },
                    { key: 'losers', label: t('categories.filterLosers', 'Losers') },
                    { key: 'large', label: t('categories.filterLargeCap', 'Large Cap') },
                    { key: 'small', label: t('categories.filterSmallCap', 'Small Cap') },
                  ].map(f => (
                    <button
                      key={f.key}
                      type="button"
                      className={`mcat-filter-chip${mobileCatFilter === f.key ? ' active' : ''}`}
                      onClick={() => setMobileCatFilter(f.key)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {loading ? (
                  <div className="mcat-token-list">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={`m-cat-skel-${i}`} className="mcat-token-row mcat-skeleton-row" style={{ animationDelay: `${i * 0.05}s` }}>
                        <div className="mcat-skel-circle" />
                        <div className="mcat-skel-lines">
                          <div className="mcat-skel-line" style={{ width: '70%' }} />
                          <div className="mcat-skel-line short" style={{ width: '45%' }} />
                        </div>
                        <div className="mcat-skel-right">
                          <div className="mcat-skel-line" style={{ width: '60%' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : error ? (
                  <div className="mcat-empty">
                    <span>{error}</span>
                    <button type="button" className="mcat-retry-btn" onClick={() => { if (isStocks) { setRefetchKey(k => k + 1) } else { fetchCryptoCategories() } }}>{t('common.retry')}</button>
                  </div>
                ) : (
                  <>
                    <div className="mcat-token-list">
                      {mobileVisibleCategories.map((cat) => {
                        const change = cat.market_cap_change_24h || 0
                        return (
                          <div key={cat.id} className="mcat-cat-row" onClick={() => setSelectedCategory(cat)}>
                            <div className="mcat-cat-logos">
                              {(cat.top_3_coins || []).slice(0, 2).map((imgUrl, i) => (
                                <img key={`m-top-${i}`} src={imgUrl} alt="" className="mcat-cat-logo" onError={(e) => { e.target.style.display = 'none' }} />
                              ))}
                            </div>
                            <div className="mcat-cat-info">
                              <span className="mcat-cat-name">{cat.name}</span>
                              <span className="mcat-cat-mcap">{cat.market_cap ? fmtLarge(cat.market_cap) : '-'}</span>
                            </div>
                            <div className="mcat-cat-right">
                              <span className={`mcat-cat-change ${change >= 0 ? 'pos' : 'neg'}`}>
                                {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                              </span>
                              {(() => {
                                const series = catSparklines.get(cat.id || cat.name) || null
                                return series
                                  ? <CatTrendLine series={series} width={40} height={16} />
                                  : <CatMomentumBar change={change} width={40} />
                              })()}
                            </div>
                          </div>
                        )
                      })}
                      {mobileFilteredCategories.length === 0 && !loading && (
                        <div className="mcat-empty">{searchQuery ? t('categories.noCategoriesFoundFor', { q: searchQuery, defaultValue: `No categories found for "${searchQuery}"` }) : t('categories.noCategoriesFound', 'No categories found')}</div>
                      )}
                    </div>
                    {mobileHasMore && !mobileShowAll && (
                      <button
                        type="button"
                        className="mcat-show-more"
                        onClick={() => setMobileShowAll(true)}
                      >
                        {t('categories.showMoreCount', { n: mobileFilteredCategories.length - MOBILE_INITIAL_COUNT, defaultValue: `Show More (${mobileFilteredCategories.length - MOBILE_INITIAL_COUNT} more)` })}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          DESKTOP LAYOUT
          ═══════════════════════════════════════════════════ */}
      {!isMobile && (selectedCategory ? (
        <>
          {/* Detail Hero — Unified glass card with stats */}
          <div className="catdetail-hero">
            {/* Top row: back + share */}
            <div className="catdetail-hero-topbar">
              <button type="button" className="catdetail-back-btn" onClick={() => setSelectedCategory(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                {t('categories.allCategories')}
              </button>
              <ShareXButton onClick={handleShareCategory} isExporting={isCatShareExporting} />
            </div>

            {/* Title area */}
            <div className="catdetail-hero-main">
              <div className="catdetail-logos">
                {(selectedCategory.top_3_coins || []).slice(0, 3).map((img, i) => (
                  <img key={`detail-logo-${i}-${img.slice(-20)}`} src={img} alt="" className="catdetail-logo" onError={(e) => { e.target.style.display = 'none' }} />
                ))}
              </div>
              <div className="catdetail-title-group">
                <h1 className="catdetail-title">{selectedCategory.name}<InfoTip text={t('categories.tooltip.categoryDetail', 'Detailed view of this category. Shows all tokens in the sector, their performance, market cap, volume, and AI-generated analysis.')} position="bottom" /></h1>
                <div className="catdetail-change-badge-wrap">
                  <span className={`catdetail-change-badge ${(selectedCategory.market_cap_change_24h || 0) >= 0 ? 'pos' : 'neg'}`}>
                    {(selectedCategory.market_cap_change_24h || 0) >= 0 ? '+' : ''}{(selectedCategory.market_cap_change_24h || 0).toFixed(1)}%
                  </span>
                  <span className="catdetail-subtitle">
                    {categoryCoins.length > 0 ? t('categories.tokensCount', { count: categoryCoins.length, defaultValue: `${categoryCoins.length} tokens` }) : t('categories.loading', 'Loading')}
                  </span>
                </div>
              </div>
            </div>

            {/* Stats row inside hero */}
            <div className="catdetail-hero-stats">
              <div className="catdetail-stat">
                <span className="catdetail-stat-lbl">{t('common.marketCap')}<InfoTip text={t('categories.tooltip.marketCap', 'Total market capitalization of all tokens in this category. Represents the combined value of the entire sector.')} position="bottom" /></span>
                <span className="catdetail-stat-val">{fmtLarge(selectedCategory.market_cap || 0)}</span>
              </div>
              <div className="catdetail-stat-divider" />
              <div className="catdetail-stat">
                <span className="catdetail-stat-lbl">{t('common.volume24h')}<InfoTip text={t('categories.tooltip.volume24h', 'Total 24-hour trading volume across all tokens in this category. High volume indicates strong market interest in this sector.')} position="bottom" /></span>
                <span className="catdetail-stat-val">{fmtLarge(selectedCategory.volume_24h || 0)}</span>
              </div>
              {categoryAiInsight && (
                <>
                  <div className="catdetail-stat-divider" />
                  <div className="catdetail-stat">
                    <span className="catdetail-stat-lbl">{t('categories.sentiment', 'Sentiment')}<InfoTip text={t('categories.tooltip.sentiment', 'AI-calculated sentiment for this category based on the percentage of tokens with positive price action in the last 24 hours.')} position="bottom" /></span>
                    <span className={`catdetail-stat-val ${categoryAiInsight.sentiment === 'bullish' ? 'bull' : categoryAiInsight.sentiment === 'bearish' ? 'bear' : ''}`}>
                      {categoryAiInsight.bullPct}% {t('categories.bullish')}
                    </span>
                  </div>
                  <div className="catdetail-stat-divider" />
                  <div className="catdetail-stat">
                    <span className="catdetail-stat-lbl">{t('categories.topMover', 'Top Mover')}<InfoTip text={t('categories.tooltip.topMover', 'The token with the strongest positive price movement in the last 24 hours within this category.')} position="bottom" /></span>
                    <span className="catdetail-stat-val bull">{categoryAiInsight.topCoin?.name}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Trending tokens in category */}
          {trendingInCategory.length > 0 && (
            <div className="catdetail-trending-section">
              <h3 className="cat-section-title">{t('categories.trendingIn', { name: selectedCategory.name, defaultValue: `Trending in ${selectedCategory.name}` })}<InfoTip text={t('categories.tooltip.trendingInCategory', 'Top trending tokens within this category based on trading volume and price momentum over the last 24 hours.')} position="bottom" /></h3>
              <div className="cat-trending-scroll">
                {trendingInCategory.map((coin) => {
                  const ch = coin.price_change_percentage_24h || 0
                  return (
                    <div key={coin.id} className="cat-trending-card catdetail-token-card">
                      <div className="catdetail-token-card-top">
                        <img src={coin.image} alt="" className="catdetail-token-card-logo" onError={(e) => { e.target.style.display = 'none' }} />
                        <span className={`catdetail-token-card-badge ${ch >= 0 ? 'pos' : 'neg'}`}>{ch >= 0 ? '+' : ''}{ch.toFixed(1)}%</span>
                      </div>
                      <div className="cat-trending-name">{coin.name}</div>
                      <div className="catdetail-token-card-symbol">{(coin.symbol || '').toUpperCase()}</div>
                      <div className="cat-trending-bottom">
                        <span className="catdetail-token-card-price">{fmtPrice(coin.current_price)}</span>
                        {coin.sparkline_in_7d?.price?.length > 1 ? (
                          <SpectreSparkline data={coin.sparkline_in_7d.price} width={48} height={20} color={ch >= 0 ? '#22D3A0' : '#FB6C6C'} strokeWidth={1.4} />
                        ) : (
                          <MiniSparkline change={ch} width={48} height={20} />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* AI Analysis for this category */}
          {categoryAiInsight && (
            <div className="catdetail-ai-section">
              <div className="cat-widget cat-widget-ai">
                <div className="cat-widget-header cat-header-ai">
                  <span className="cat-widget-header-title">{t('categories.aiAnalysis')}<InfoTip text={t('categories.tooltip.aiCategoryAnalysis', 'AI-generated analysis specific to this category. Summarizes sentiment, key performers, and the bull/bear balance among tokens in this sector.')} position="bottom" /></span>
                  <span className="cat-ai-live"><span className="cat-ai-live-dot" />{t('ticker.live')}</span>
                </div>
                <div className="cat-ai-body">
                  <div className="cat-ai-terminal">
                    <p className="cat-ai-output">
                      {categoryAiInsight.sentiment === 'bullish' ? t('categories.bullish') : categoryAiInsight.sentiment === 'bearish' ? t('categories.bearish') : t('categories.neutral')} {t('categories.sentimentAcross', { count: categoryAiInsight.total, type: t('categories.tokens') })}.
                      {' '}{t('categories.tokensPositive', { bullish: categoryAiInsight.bullish, bullPct: categoryAiInsight.bullPct, bearish: categoryAiInsight.bearish })}.
                      {' '}{t('categories.avgChange', { change: `${categoryAiInsight.avgChange >= 0 ? '+' : ''}${categoryAiInsight.avgChange.toFixed(2)}` })}.
                      {Number.isFinite(categoryAiInsight.avgChange7d) && (
                        <> {t('categories.avg7d', { change: `${categoryAiInsight.avgChange7d >= 0 ? '+' : ''}${categoryAiInsight.avgChange7d.toFixed(2)}`, defaultValue: `7d average {{change}}%` })}.</>
                      )}
                    </p>
                    {categoryAiInsight.topCoin && (
                      <p className="cat-ai-output">
                        <span className="cat-ai-highlight-green">{t('categories.topPerformer')}:</span> {categoryAiInsight.topCoin.name} ({(categoryAiInsight.topCoin.price_change_percentage_24h || 0) >= 0 ? '+' : ''}{(categoryAiInsight.topCoin.price_change_percentage_24h || 0).toFixed(1)}%).
                        {' '}<span className="cat-ai-highlight-red">{t('categories.worstPerformer')}:</span> {categoryAiInsight.bottomCoin?.name} ({(categoryAiInsight.bottomCoin?.price_change_percentage_24h || 0).toFixed(1)}%).
                        {categoryAiInsight.volLeader && categoryAiInsight.volLeaderShare > 0 && (
                          <> {t('categories.volumeLeader', { symbol: (categoryAiInsight.volLeader.symbol || '').toUpperCase(), share: categoryAiInsight.volLeaderShare, defaultValue: `{{symbol}} carries {{share}}% of category volume` })}.</>
                        )}
                      </p>
                    )}
                  </div>
                  {catLlmInsight && (
                    <div className="cat-ai-read">
                      {/* The LLM read is cached (10 min TTL) - stamp its real
                          age so a cached body is never presented as live. */}
                      {catLlmInsightTs && <FreshnessTag timestamp={catLlmInsightTs} tier="warm" label="AI read" />}
                      <h4 className="cat-ai-headline">{catLlmInsight.title}</h4>
                      <p className="cat-ai-read-body">{catLlmInsight.body}</p>
                      {catLlmInsight.historical && (
                        <p className="cat-ai-read-historical">{catLlmInsight.historical}</p>
                      )}
                      {catLlmInsight.actions?.length > 0 && (
                        <div className="cat-ai-actions">
                          {catLlmInsight.actions.map((a, i) => (
                            <div key={`cat-ai-action-${i}-${a.type}`} className={`cat-ai-action ${a.type}`}>
                              <span className="cat-ai-action-dot" aria-hidden />
                              <span className="cat-ai-action-text">{a.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="cat-ai-meter">
                    <div className="cat-ai-meter-labels"><span>{t('categories.bear', 'Bear')}</span><span>{t('categories.bull', 'Bull')}</span></div>
                    <div className="cat-ai-meter-track">
                      <div className="cat-ai-meter-fill" style={{ width: `${categoryAiInsight.bullPct}%` }} />
                      <div className="cat-ai-meter-thumb" style={{ left: `${categoryAiInsight.bullPct}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Token table */}
          <div className="categories-table-section">
            <div className="categories-controls">
              <div className="categories-search-wrap">
                <svg className="categories-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  className="categories-search"
                  type="text"
                  placeholder={t('categories.searchInCategory', { name: selectedCategory.name, defaultValue: `Search in ${selectedCategory.name}...` })}
                  value={coinSearchQuery}
                  onChange={(e) => setCoinSearchQuery(e.target.value)}
                />
                {coinSearchQuery && (
                  <button type="button" className="categories-search-clear" onClick={() => setCoinSearchQuery('')} aria-label={t('categories.clearSearchAria', 'Clear search')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="categories-count">
                {t('categories.tokensCount', { count: sortedCategoryCoins.length, defaultValue: `${sortedCategoryCoins.length} tokens` })} · {t('categories.pageN', { n: categoryCoinsPage, defaultValue: `Page ${categoryCoinsPage}` })}
              </div>
            </div>

            {categoryCoinsLoading ? (
              <div className="categories-table-wrap">
                <div className="categories-table">
                  <div className="categories-table-header catdetail-tokens-header">
                    <span className="cat-col catdetail-col-rank">#</span>
                    <span className="cat-col catdetail-col-name">{t('common.name')}</span>
                    <span className="cat-col catdetail-col-price">{t('common.price')}</span>
                    <span className="cat-col catdetail-col-change">{t('categories.col24hPct', '24h %')}</span>
                    <span className="cat-col catdetail-col-change7d">{t('categories.col7dPct', '7d %')}</span>
                    <span className="cat-col catdetail-col-mcap">{t('common.marketCap')}</span>
                    <span className="cat-col catdetail-col-vol">{t('common.volume24h')}</span>
                    <span className="cat-col catdetail-col-spark">{t('categories.last7Days')}</span>
                  </div>
                  {[68, 55, 72, 60, 78, 63, 70, 58].map((nameW, i) => (
                    <div key={`detail-skel-${i}-${nameW}`} className="categories-skeleton-row" style={{ animationDelay: `${i * 0.05}s` }}>
                      <div className="categories-skeleton-cell" style={{ width: '24px', height: '12px' }} />
                      <div className="categories-skeleton-cell" style={{ width: `${nameW}%` }} />
                      <div className="categories-skeleton-cell" style={{ width: '60%' }} />
                      <div className="categories-skeleton-cell" style={{ width: '45%' }} />
                      <div className="categories-skeleton-cell" style={{ width: '45%' }} />
                      <div className="categories-skeleton-cell" style={{ width: '70%' }} />
                      <div className="categories-skeleton-cell" style={{ width: '55%' }} />
                      <div className="categories-skeleton-cell" style={{ width: '100%' }} />
                    </div>
                  ))}
                </div>
              </div>
            ) : categoryCoinsError ? (
              <div className="categories-error">
                <span>{categoryCoinsError}</span>
                <button type="button" onClick={() => setRefetchKey(k => k + 1)}>{t('common.retry')}</button>
              </div>
            ) : (
              <>
              <div className="categories-table-wrap" ref={detailTableRef}>
                <div className="categories-table">
                  <div className="categories-table-header catdetail-tokens-header">
                    <span className="cat-col catdetail-col-rank">#</span>
                    <span className="cat-col catdetail-col-name" onClick={() => handleCoinSort('name')}>
                      {t('common.name')} <SortIcon active={coinSortField === 'name'} direction={coinSortDir} />
                    </span>
                    <span className="cat-col catdetail-col-price" onClick={() => handleCoinSort('current_price')}>
                      {t('common.price')} <SortIcon active={coinSortField === 'current_price'} direction={coinSortDir} />
                    </span>
                    <span className="cat-col catdetail-col-change" onClick={() => handleCoinSort('price_change_percentage_24h')}>
                      {t('categories.col24hPct', '24h %')} <SortIcon active={coinSortField === 'price_change_percentage_24h'} direction={coinSortDir} />
                    </span>
                    <span className="cat-col catdetail-col-change7d" onClick={() => handleCoinSort('price_change_percentage_7d_in_currency')}>
                      {t('categories.col7dPct', '7d %')} <SortIcon active={coinSortField === 'price_change_percentage_7d_in_currency'} direction={coinSortDir} />
                    </span>
                    <span className="cat-col catdetail-col-mcap" onClick={() => handleCoinSort('market_cap')}>
                      {t('common.marketCap')} <SortIcon active={coinSortField === 'market_cap'} direction={coinSortDir} />
                    </span>
                    <span className="cat-col catdetail-col-vol" onClick={() => handleCoinSort('total_volume')}>
                      {t('common.volume24h')} <SortIcon active={coinSortField === 'total_volume'} direction={coinSortDir} />
                    </span>
                    <span className="cat-col catdetail-col-spark">{t('categories.last7Days')}</span>
                  </div>

                  {sortedCategoryCoins.map((coin, index) => {
                    const ch24 = coin.price_change_percentage_24h || 0
                    const ch7d = coin.price_change_percentage_7d_in_currency || 0
                    const sparkPrices = coin.sparkline_in_7d?.price || null
                    return (
                      <div key={coin.id} className="categories-table-row catdetail-tokens-row">
                        <span className="cat-col catdetail-col-rank">
                          <span className="catdetail-rank-pos">{index + 1}</span>
                          {coin.market_cap_rank != null && coin.market_cap_rank !== index + 1 && (
                            <span className="catdetail-rank-global">#{coin.market_cap_rank}</span>
                          )}
                        </span>
                        <div className="cat-col catdetail-col-name">
                          <img src={coin.image} alt="" className="catdetail-coin-logo" onError={(e) => { e.target.style.display = 'none' }} />
                          <div className="catdetail-coin-meta">
                            <span className="cat-name-text">{coin.name}</span>
                            <span className="catdetail-coin-symbol">{(coin.symbol || '').toUpperCase()}</span>
                          </div>
                        </div>
                        <span className="cat-col catdetail-col-price">{fmtPrice(coin.current_price)}</span>
                        <span className={`cat-col catdetail-col-change ${ch24 >= 0 ? 'positive' : 'negative'}`}>
                          {ch24 >= 0 ? '+' : ''}{ch24.toFixed(1)}%
                        </span>
                        <span className={`cat-col catdetail-col-change7d ${ch7d >= 0 ? 'positive' : 'negative'}`}>
                          {ch7d >= 0 ? '+' : ''}{ch7d.toFixed(1)}%
                        </span>
                        <span className="cat-col catdetail-col-mcap">{coin.market_cap ? fmtLarge(coin.market_cap) : '-'}</span>
                        <span className="cat-col catdetail-col-vol">{coin.total_volume ? fmtLarge(coin.total_volume) : '-'}</span>
                        <div className="cat-col catdetail-col-spark">
                          <TokenSparkline prices={sparkPrices} positive={ch7d >= 0} seedKey={coin.id} />
                        </div>
                      </div>
                    )
                  })}

                  {sortedCategoryCoins.length === 0 && !categoryCoinsLoading && (
                    <div className="categories-empty">{coinSearchQuery ? t('categories.noTokensFoundFor', { q: coinSearchQuery, defaultValue: `No tokens found for "${coinSearchQuery}"` }) : t('categories.noTokensFound', 'No tokens found')}</div>
                  )}
                </div>
              </div>

              {/* Load More */}
              {!isLastCoinPage && (
                <div className="catdetail-load-more-wrap">
                  <button
                    className="catdetail-load-more-btn"
                    onClick={() => setCategoryCoinsPage(p => p + 1)}
                  >
                    <span className="catdetail-load-more-text">{t('categories.loadMoreTokens', 'Load More Tokens')}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  <span className="catdetail-showing-count">
                    {t('categories.showingTokensCount', { count: sortedCategoryCoins.length, defaultValue: `Showing ${sortedCategoryCoins.length} tokens` })}
                  </span>
                </div>
              )}
              </>
            )}
          </div>
        </>

      ) : (

        /* ═══════════════════════════════════════════════════
           CATEGORIES / TRENDING VIEW
           Top-level toggle switches between the Categories grid
           and the Momentum Board (trending by social signal).
           ═══════════════════════════════════════════════════ */
        <>
          {/* Page-view toggle */}
          <div className="cat-pageview-bar">
            <div className="cat-pageview-toggle" role="tablist" aria-label="Categories view">
              <button
                type="button"
                role="tab"
                aria-selected={pageView === 'categories'}
                className={`cat-pageview-btn${pageView === 'categories' ? ' active' : ''}`}
                onClick={() => setPageView('categories')}
              >
                {isStocks ? t('categories.tabSectors', 'Sectors') : t('categories.tabCategories', 'Categories')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pageView === 'trending'}
                className={`cat-pageview-btn${pageView === 'trending' ? ' active' : ''}`}
                onClick={() => setPageView('trending')}
              >
                <span className="cat-pageview-dot" aria-hidden />
                {t('categories.tabTrending', 'Trending')}
              </button>
            </div>
          </div>

          {pageView === 'trending' ? (
            <Suspense fallback={null}>
              <MomentumBoard enabled={pageView === 'trending'} />
            </Suspense>
          ) : (
          <>
          {/* Header row */}
          <div className="categories-header-row">
            <div className="categories-header-left">
              <h1 className="categories-page-title">{isStocks ? t('categories.stockSectors') : t('categories.title')}<InfoTip text={t('categories.tooltip.explore', 'Explore crypto market sectors and stock sectors. Each category groups related tokens — click any row to see its tokens, trending coins, and in-depth analysis.')} position="bottom" /></h1>
              <p className="categories-subtitle">
                {isStocks ? t('categories.subtitleSectors', 'Sector performance across major exchanges') : t('categories.subtitleCategories', 'Real-time market intelligence across every sector')}
              </p>
            </div>
            {aiInsight && (
              <div className={`categories-header-sentiment bias-${aiInsight.sentiment}`}>
                <span className="categories-hero-sent-dot" />
                {aiInsight.sentiment.toUpperCase()}<InfoTip text={t('categories.tooltip.overallSentiment', 'Overall market sentiment derived from the ratio of gaining vs losing categories. Bullish means most sectors are positive, bearish means most are negative.')} position="left" />
              </div>
            )}
          </div>

          {/* Metrics row */}
          {aiInsight && (
            <div className="categories-metrics">
              <div className="cat-mc">
                <span className="cat-mc-label">{t('categories.bullish')}<InfoTip text={t('categories.tooltip.bullishPct', 'Percentage of categories with positive 24h market cap change. Higher values mean broad-based market strength across sectors.')} position="bottom" /></span>
                <span className="cat-mc-num">{aiInsight.bullPct}%</span>
              </div>
              <div className="cat-mc">
                <span className="cat-mc-label">{t('categories.avg24h')}<InfoTip text={t('categories.tooltip.avg24h', 'Average 24-hour market cap change across all categories. Indicates whether the overall market is trending up or down.')} position="bottom" /></span>
                <span className={`cat-mc-num ${aiInsight.avgChange >= 0 ? 'bull' : 'bear'}`}>{aiInsight.avgChange >= 0 ? '+' : ''}{aiInsight.avgChange.toFixed(1)}%</span>
              </div>
              <div className="cat-mc">
                <span className="cat-mc-label">{t('categories.total')}<InfoTip text={t('categories.tooltip.total', 'Total number of market categories tracked. Categories group tokens by use case, blockchain, or sector.')} position="bottom" /></span>
                <span className="cat-mc-num">{aiInsight.total}</span>
              </div>
              <div className="cat-mc">
                <span className="cat-mc-label">{t('categories.bestSector', 'Best Sector')}<InfoTip text={t('categories.tooltip.bestSector', 'The category with the highest 24h market cap growth. Leading sectors often signal where capital is flowing.')} position="bottom" /></span>
                <span className="cat-mc-num bull">{aiInsight.topCat?.name?.length > 16 ? aiInsight.topCat.name.slice(0, 15) + '\u2026' : aiInsight.topCat?.name}</span>
              </div>
              <div className="cat-mc">
                <span className="cat-mc-label">{t('categories.worstSector', 'Worst Sector')}<InfoTip text={t('categories.tooltip.worstSector', 'The category with the largest 24h market cap decline. Lagging sectors may indicate capital rotation or sector-specific risk.')} position="bottom" /></span>
                <span className="cat-mc-num bear">{aiInsight.bottomCat?.name?.length > 16 ? aiInsight.bottomCat.name.slice(0, 15) + '\u2026' : aiInsight.bottomCat?.name}</span>
              </div>
            </div>
          )}

          {/* Widgets */}
          <div className="categories-widgets">
            {/* Trending Categories */}
            <div className="cat-section">
              <h3 className="cat-section-title">{t('common.trending')}<InfoTip text={t('categories.tooltip.trendingCategories', 'Categories with the highest trading activity and momentum right now. These sectors are attracting the most attention from traders.')} position="bottom" /></h3>
              <div className="cat-trending-scroll" ref={trendingRef}>
                {trendingCategories.map((cat) => {
                  const ch = cat.market_cap_change_24h || 0
                  const series = catSparklines.get(cat.id || cat.name) || null
                  return (
                    <div key={cat.id} className="cat-trending-card cat-trending-card--v2" onClick={() => setSelectedCategory(cat)}>
                      <div className="cat-trending-top">
                        <div className="cat-trending-logos">
                          {(cat.top_3_coins || []).slice(0, 3).map((img, i) => (
                            <img key={`trend-logo-${i}-${img.slice(-20)}`} src={img} alt="" className="cat-trending-logo" onError={(e) => { e.target.style.display = 'none' }} />
                          ))}
                        </div>
                        <span className={`cat-trending-change ${ch >= 0 ? 'pos' : 'neg'}`}>{ch >= 0 ? '+' : ''}{ch.toFixed(1)}%</span>
                      </div>
                      <div className="cat-trending-name">{cat.name}</div>
                      <div className="cat-trending-chart">
                        {series ? (
                          <CatTrendLine series={series} width={150} height={44} />
                        ) : (
                          <CatMomentumBar change={ch} width={150} />
                        )}
                      </div>
                      <div className="cat-trending-meta">
                        <span className="cat-trending-mcap">{fmtLarge(cat.market_cap || 0)}</span>
                        {series && (
                          <span className={`cat-trending-7d ${series.change7d >= 0 ? 'pos' : 'neg'}`}>
                            7D {series.change7d >= 0 ? '+' : ''}{series.change7d.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Gainers / Losers + AI Analysis */}
            <div className="cat-widgets-row">
              {/* Top Gainers */}
              <div className="cat-widget cat-widget-movers">
                <div className="cat-widget-header cat-header-gainers">
                  <span className="cat-widget-header-title">{t('welcome.topGainers')}<InfoTip text={t('categories.tooltip.topGainers', 'Categories with the largest positive 24h market cap change. These sectors are outperforming the broader market right now.')} position="bottom" /></span>
                </div>
                <div className="cat-movers-list">
                  {topGainers.map((cat, i) => {
                    const ch = cat.market_cap_change_24h || 0
                    return (
                      <div key={cat.id} className="cat-mover-row" onClick={() => setSelectedCategory(cat)}>
                        <span className="cat-mover-rank">{i + 1}</span>
                        <div className="cat-mover-logos">
                          {(cat.top_3_coins || []).slice(0, 2).map((img, j) => (
                            <img key={j} src={img} alt="" className="cat-mover-logo" onError={(e) => { e.target.style.display = 'none' }} />
                          ))}
                        </div>
                        <span className="cat-mover-name">{cat.name}</span>
                        <span className="cat-mover-change pos">+{ch.toFixed(1)}%</span>
                      </div>
                    )
                  })}
                  {topGainers.length === 0 && <div className="cat-movers-empty">{t('categories.noGainers', 'No gainers')}</div>}
                </div>
              </div>

              {/* Top Losers */}
              <div className="cat-widget cat-widget-movers">
                <div className="cat-widget-header cat-header-losers">
                  <span className="cat-widget-header-title">{t('welcome.topLosers')}<InfoTip text={t('categories.tooltip.topLosers', 'Categories with the largest negative 24h market cap change. These sectors are underperforming and may signal risk-off sentiment.')} position="bottom" /></span>
                </div>
                <div className="cat-movers-list">
                  {topLosers.map((cat, i) => {
                    const ch = cat.market_cap_change_24h || 0
                    return (
                      <div key={cat.id} className="cat-mover-row" onClick={() => setSelectedCategory(cat)}>
                        <span className="cat-mover-rank">{i + 1}</span>
                        <div className="cat-mover-logos">
                          {(cat.top_3_coins || []).slice(0, 2).map((img, j) => (
                            <img key={j} src={img} alt="" className="cat-mover-logo" onError={(e) => { e.target.style.display = 'none' }} />
                          ))}
                        </div>
                        <span className="cat-mover-name">{cat.name}</span>
                        <span className="cat-mover-change neg">{ch.toFixed(1)}%</span>
                      </div>
                    )
                  })}
                  {topLosers.length === 0 && <div className="cat-movers-empty">No losers</div>}
                </div>
              </div>

              {/* AI Category Analysis */}
              <div className="cat-widget cat-widget-ai">
                <div className="cat-widget-header cat-header-ai">
                  <span className="cat-widget-header-title">{t('categories.aiAnalysis')}<InfoTip text="AI-generated market summary based on real-time category data. Shows overall sentiment, best/worst performers, and the bull/bear meter across all tracked sectors." position="bottom" /></span>
                  <span className="cat-ai-live"><span className="cat-ai-live-dot" />{t('ticker.live')}</span>
                </div>
                {aiInsight ? (
                  <div className="cat-ai-body">
                    <div className="cat-ai-terminal">
                      <p className="cat-ai-output">
                        Market shows {aiInsight.sentiment} sentiment across {aiInsight.total} categories.
                        {' '}{aiInsight.bullish} categories are positive ({aiInsight.bullPct}%), {aiInsight.bearish} are negative.
                        {' '}Average change is {aiInsight.avgChange >= 0 ? '+' : ''}{aiInsight.avgChange.toFixed(2)}%.
                      </p>
                      {aiInsight.topCat && (
                        <p className="cat-ai-output">
                          <span className="cat-ai-highlight-green">Best performer:</span> {aiInsight.topCat.name} ({aiInsight.topCat.market_cap_change_24h >= 0 ? '+' : ''}{(aiInsight.topCat.market_cap_change_24h || 0).toFixed(1)}%).
                          {' '}<span className="cat-ai-highlight-red">Worst performer:</span> {aiInsight.bottomCat?.name} ({(aiInsight.bottomCat?.market_cap_change_24h || 0).toFixed(1)}%).
                        </p>
                      )}
                    </div>
                    {landscapeInsight && (
                      <div className="cat-ai-read">
                        {/* Cached up to 10 min - show the read's real age. */}
                        {landscapeInsightTs && <FreshnessTag timestamp={landscapeInsightTs} tier="warm" label="AI read" />}
                        <h4 className="cat-ai-headline">{landscapeInsight.title}</h4>
                        <p className="cat-ai-read-body">{landscapeInsight.body}</p>
                        {landscapeInsight.historical && (
                          <p className="cat-ai-read-historical">{landscapeInsight.historical}</p>
                        )}
                        {landscapeInsight.actions?.length > 0 && (
                          <div className="cat-ai-actions">
                            {landscapeInsight.actions.map((a, i) => (
                              <div key={`cat-lai-${i}-${a.type}`} className={`cat-ai-action ${a.type}`}>
                                <span className="cat-ai-action-dot" aria-hidden />
                                <span className="cat-ai-action-text">{a.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="cat-ai-meter">
                      <div className="cat-ai-meter-labels"><span>{t('categories.bear', 'Bear')}</span><span>{t('categories.bull', 'Bull')}</span></div>
                      <div className="cat-ai-meter-track">
                        <div className="cat-ai-meter-fill" style={{ width: `${aiInsight.bullPct}%` }} />
                        <div className="cat-ai-meter-thumb" style={{ left: `${aiInsight.bullPct}%` }} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="cat-ai-body">
                    <div className="cat-ai-terminal">
                      <div className="categories-skeleton-cell" style={{ width: '80%', height: '12px', marginBottom: '8px' }} />
                      <div className="categories-skeleton-cell" style={{ width: '60%', height: '12px', marginBottom: '8px' }} />
                      <div className="categories-skeleton-cell" style={{ width: '70%', height: '12px' }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Table Section */}
          <div className="categories-table-section">
            <div className="categories-controls">
              <div className="categories-search-wrap">
                <svg className="categories-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  className="categories-search"
                  type="text"
                  placeholder={isStocks ? t('categories.searchSectors') : t('categories.searchCategories')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button type="button" className="categories-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear search">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="categories-count">
                {filteredCategories.length} of {categories.length} {isStocks ? 'sectors' : 'categories'} · Page {safeCurrentPage} of {totalPages}
              </div>
            </div>

            {loading ? (
              <div className="categories-table-wrap">
                <div className="categories-table">
                  <div className="categories-table-header">
                    <span className="cat-col cat-col-rank">#</span>
                    <span className="cat-col cat-col-name">{isStocks ? t('heatmaps.sector') : t('categories.category')}</span>
                    <span className="cat-col cat-col-top">{t('categories.topCoins')}</span>
                    <span className="cat-col cat-col-change">{t('categories.col24hPct', '24h %')}</span>
                    <span className="cat-col cat-col-mcap">{t('common.marketCap')}</span>
                    <span className="cat-col cat-col-vol">{t('common.volume24h')}</span>
                    <span className="cat-col cat-col-spark">{t('categories.last7Days')}</span>
                  </div>
                  {[72, 58, 65, 80, 55, 70, 62, 75, 68, 60].map((nameW, i) => (
                    <div key={`main-skel-${i}-${nameW}`} className="categories-skeleton-row" style={{ animationDelay: `${i * 0.05}s` }}>
                      <div className="categories-skeleton-cell" style={{ width: '24px', height: '12px' }} />
                      <div className="categories-skeleton-cell" style={{ width: `${nameW}%` }} />
                      <div className="categories-skeleton-cell" style={{ width: '70%' }} />
                      <div className="categories-skeleton-cell" style={{ width: '50%' }} />
                      <div className="categories-skeleton-cell" style={{ width: '80%' }} />
                      <div className="categories-skeleton-cell" style={{ width: '60%' }} />
                      <div className="categories-skeleton-cell" style={{ width: '100%' }} />
                    </div>
                  ))}
                </div>
              </div>
            ) : error ? (
              <div className="categories-error">
                <span>{error}</span>
                <button type="button" onClick={() => window.location.reload()}>{t('common.retry')}</button>
              </div>
            ) : (
              <>
              <div className="categories-table-wrap" ref={tableRef}>
                <div className="categories-table">
                  <div className="categories-table-header">
                    <span className="cat-col cat-col-rank">#</span>
                    <span className="cat-col cat-col-name" onClick={() => handleSort('name')}>
                      {isStocks ? t('heatmaps.sector') : t('categories.category')} <SortIcon active={sortField === 'name'} direction={sortDirection} />
                    </span>
                    <span className="cat-col cat-col-top">{t('categories.topCoins')}</span>
                    <span className="cat-col cat-col-change" onClick={() => handleSort('market_cap_change_24h')}>
                      {t('categories.col24hPct', '24h %')} <SortIcon active={sortField === 'market_cap_change_24h'} direction={sortDirection} />
                    </span>
                    <span className="cat-col cat-col-mcap" onClick={() => handleSort('market_cap')}>
                      {t('common.marketCap')} <SortIcon active={sortField === 'market_cap'} direction={sortDirection} />
                    </span>
                    <span className="cat-col cat-col-vol" onClick={() => handleSort('volume_24h')}>
                      {t('common.volume24h')} <SortIcon active={sortField === 'volume_24h'} direction={sortDirection} />
                    </span>
                    <span className="cat-col cat-col-spark">{t('categories.last7Days')}</span>
                  </div>

                  {paginatedCategories.map((cat, index) => {
                    const change = cat.market_cap_change_24h || 0
                    return (
                      <div key={cat.id} className="categories-table-row" onClick={() => setSelectedCategory(cat)}>
                        <span className="cat-col cat-col-rank">{pageStart + index + 1}</span>
                        <div className="cat-col cat-col-name"><span className="cat-name-text">{cat.name}</span></div>
                        <div className="cat-col cat-col-top">
                          <div className="cat-top-coins-stack">
                            {(cat.top_3_coins || []).slice(0, 3).map((imgUrl, i) => (
                              <img key={`top-coin-${i}-${imgUrl.slice(-20)}`} src={imgUrl} alt="" className={`cat-top-coin-img ${isStocks ? 'cat-top-coin-img--stock' : ''}`} loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />
                            ))}
                          </div>
                          {isStocks && cat.stockCount && (
                            <span className="cat-stock-count">{cat.stockCount} stocks</span>
                          )}
                        </div>
                        <span className={`cat-col cat-col-change ${change >= 0 ? 'positive' : 'negative'}`}>
                          {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                        </span>
                        <span className="cat-col cat-col-mcap">{cat.market_cap ? fmtLarge(cat.market_cap) : '-'}</span>
                        <span className="cat-col cat-col-vol">{cat.volume_24h ? fmtLarge(cat.volume_24h) : '-'}</span>
                        <div className="cat-col cat-col-spark">
                          {(() => {
                            const series = catSparklines.get(cat.id || cat.name) || null
                            return series
                              ? <CatTrendLine series={series} width={120} height={42} />
                              : <CatMomentumBar change={change} width={120} />
                          })()}
                        </div>
                      </div>
                    )
                  })}

                  {filteredCategories.length === 0 && !loading && (
                    <div className="categories-empty">No categories found{searchQuery ? ` for "${searchQuery}"` : ''}</div>
                  )}
                </div>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="categories-pagination">
                  <button className="cat-page-btn cat-page-nav" disabled={safeCurrentPage === 1} onClick={() => goToPage(1)} title="First page">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" />
                    </svg>
                  </button>
                  <button className="cat-page-btn cat-page-nav" disabled={safeCurrentPage === 1} onClick={() => goToPage(safeCurrentPage - 1)} title="Previous page">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>

                  {getPageNumbers().map((page, i) =>
                    page === '...' ? (
                      <span key={`ellipsis-${i}`} className="cat-page-ellipsis">...</span>
                    ) : (
                      <button
                        key={page}
                        className={`cat-page-btn cat-page-num ${page === safeCurrentPage ? 'active' : ''}`}
                        onClick={() => goToPage(page)}
                      >
                        {page}
                      </button>
                    )
                  )}

                  <button className="cat-page-btn cat-page-nav" disabled={safeCurrentPage === totalPages} onClick={() => goToPage(safeCurrentPage + 1)} title="Next page">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                  <button className="cat-page-btn cat-page-nav" disabled={safeCurrentPage === totalPages} onClick={() => goToPage(totalPages)} title="Last page">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" />
                    </svg>
                  </button>
                </div>
              )}
              </>
            )}
          </div>
          </>
          )}
        </>
      ))}
      <ShareXModal
        open={catShareModalOpen}
        onClose={() => { setCatShareModalOpen(false); setCatShareImageUrl(null) }}
        imageUrl={catShareImageUrl}
        defaultDescription={catShareDescription}
        filename={`spectre_${(selectedCategory?.name || 'category').toLowerCase().replace(/\s+/g, '_')}.png`}
      />
    </div>
  )
}

export default CategoriesPage
