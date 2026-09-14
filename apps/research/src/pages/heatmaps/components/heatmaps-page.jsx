/**
 * HeatmapsPage - Dual-mode crypto/stock heatmap.
 * Apple Cinematic design — glass tiles, warm-white, cinematic depth.
 * Features: search, filters, pagination, 30D timeframe, tile click navigation.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { getCategories, getCategoryCoins, searchCoinsForROI } from '@/services/coinGeckoApi'
import { getSpectreHeatmap, getSpectreCoinsMarketsPage, getSpectreGlobalMetrics } from '@/services/spectreMarketApi'
import { getXDashRunnerCoins, XDASH_RUNNERS_CATEGORY } from '@/services/xdashRunners'
import { trackUi } from '@/services/analytics'
import { useCopyToast } from '@/contexts/CopyToastContext'
import LiquidityPulse from '@/components/liquidity-pulse'
import { computeLiquidityFlow, dollarFlow } from '@/lib/liquidity-flow'
import { getStockQuotes, getStockLogoUrl, getStockLogoFallback, POPULAR_STOCKS } from '@/services/stockApi'
import { useBinanceTopCoinPrices } from '@/hooks/useCodexData'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import { useCurrency } from '@/hooks/useCurrency'
import ShareXButton from '@/components/share-x-button'
const ShareXModal = lazy(() => import('@/components/share-x-modal'))
import InfoTip from '@/components/InfoTip'
import FreshnessTag from '@/components/freshness-tag'
import { renderShareCard, preloadLogos, roundRect, getSpectreLogo, CARD_PAD } from '@/lib/shareToX'
// FloatingChartWindow only mounts when user clicks a heatmap cell to
// open the chart popup. Lazy keeps its 12 KB + nested chart deps
// (CoinGeckoPriceChart 19 KB, CompareOverlayChart 18 KB, AdvancedCompare
// 14 KB) out of every heatmaps visit.
const FloatingChartWindow = lazy(() => import('./FloatingChartWindow'))
import TreemapView from './TreemapView'
import TreemapTooltip from './TreemapTooltip'
import MoneyFlowTreemap from '@/components/money-flow-treemap'
import './treemap.css'
import './heatmaps-page.css'
import './heatmaps-page.mobile.css'
import './heatmaps-polish.css'
import MobileBackButton from '@/components/mobile-back-button'

const formatChange = (change) => {
  const value = typeof change === 'number' ? change : parseFloat(change) || 0
  return value.toFixed(2)
}

/* ── Sector colors for stock mode ── */
const SECTOR_COLORS = {
  'Technology': '59, 130, 246',
  'Semiconductor': '0, 200, 220',
  'Financial': '234, 179, 8',
  'Healthcare': '16, 185, 129',
  'Consumer': '168, 85, 247',
  'Energy': '249, 115, 22',
  'Communication': '236, 72, 153',
  'Industrial': '107, 114, 128',
  'Automotive': '239, 68, 68',
  'RealEstate': '45, 212, 191',
  'Index': '139, 92, 246',
  'Commodity': '245, 158, 11',
}

/* Brand tint for a logo that never arrives. Curated first, sector second,
   slate last — never white, or the initial disappears into its own disc. */
const LOGO_TINT_FALLBACK = '100, 116, 139'
const logoTintRgb = (symbol, sector) =>
  TOKEN_ROW_COLORS[(symbol || '').toUpperCase()]?.bg
  || (sector ? SECTOR_COLORS[sector] : null)
  || LOGO_TINT_FALLBACK

/**
 * Token logo with a real fallback chain.
 *
 * Every view used to render `onError={e => e.target.style.display = 'none'}`,
 * which hides the <img> and leaves the disc behind it EMPTY — the grey circle
 * the founder screenshotted on the grid. Stock logos 404 on the primary CDN
 * routinely and coin images drop on flaky mobile links, so the miss is the
 * common case, not the edge case.
 *
 * Chain: primary URL → CompaniesMarketCap (stocks only) → initial on tint.
 */
function TokenTileLogo({ logo, symbol, sector, isStock, fallbackClassName }) {
  const [step, setStep] = useState(0)
  const sym = (symbol || '').toUpperCase()
  const src = step === 0 ? logo : (step === 1 && isStock ? getStockLogoFallback(sym) : null)

  if (!src) {
    return (
      <span className={fallbackClassName} style={{ '--tlf-rgb': logoTintRgb(sym, sector) }}>
        {sym.charAt(0) || '?'}
      </span>
    )
  }
  return (
    <img
      key={src}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setStep((s) => s + 1)}
    />
  )
}

/* ── Grid layout configs for different token counts ── */
const GRID_CONFIGS = {
  25: {
    cols: 6,
    areas: `
      "hero1 hero1 hero2 hero2 t2    t3"
      "hero1 hero1 hero2 hero2 t4    t5"
      "t6    t7    t8    t9    t10   t11"
      "t12   t13   t14   t15   t16   t17"
      "t18   t19   t20   t21   t22   t23"
      "t24   t24   .     .     .     ."`,
    minRows: 'repeat(6, minmax(80px, 1fr))',
  },
  50: { cols: 8, areas: null, minRows: null },
  100: { cols: 10, areas: null, minRows: null },
}

const TOKEN_COUNTS = [25, 50, 100, 200]
const STOCK_COUNTS = [25, 50, 100, 200]
const MOBILE_TOKEN_COUNTS = [15, 25, 50, 100]
const MOBILE_STOCK_COUNTS = [15, 25, 50, 100]
// tokenCount acts as items-per-page; pagination loads more data beyond it

const TIMEFRAMES = [
  { id: '1h', label: '1H', field: 'price_change_percentage_1h_in_currency' },
  { id: '24h', label: '24H', field: 'price_change_percentage_24h' },
  { id: '7d', label: '7D', field: 'price_change_percentage_7d_in_currency' },
  { id: '30d', label: '30D', field: 'price_change_percentage_30d_in_currency' },
]

const STOCK_TIMEFRAMES = [
  { id: '24h', labelKey: 'heatmaps.today', field: 'change24h' },
]

const THRESHOLD_OPTIONS = [1, 5, 10]

/* The Spectre /v1/heatmap feed carries no CoinGecko id — join real ids from
   the top-250 markets list (module-cached + LS-seeded upstream, so this is a
   warm read on any repeat visit). Keyed symbol|name to dodge ticker
   collisions; symbol-only fallback allowed only when the symbol is unique in
   the list. Best-effort: on failure rows just keep an empty cgId. */
let _cgIdJoinPromise = null
async function getCgIdJoinMap() {
  if (!_cgIdJoinPromise) {
    _cgIdJoinPromise = getSpectreCoinsMarketsPage(1, 250, { sparkline: false })
      .then((coins) => {
        const byFull = new Map()
        const bySymbol = new Map()
        for (const c of coins || []) {
          if (!c?.id || !c?.symbol) continue
          const sym = String(c.symbol).toUpperCase()
          byFull.set(`${sym}|${String(c.name || '').toLowerCase()}`, c.id)
          bySymbol.set(sym, bySymbol.has(sym) ? null : c.id) // null = ambiguous
        }
        return { byFull, bySymbol }
      })
      .catch(() => { _cgIdJoinPromise = null; return { byFull: new Map(), bySymbol: new Map() } })
  }
  return _cgIdJoinPromise
}

async function enrichHeatmapRowsWithCgIds(rows) {
  const { byFull, bySymbol } = await getCgIdJoinMap()
  return rows.map((r) => {
    if (r.coingecko_id || r.cgId || r.id) return r
    const sym = String(r.symbol || r.asset || '').toUpperCase()
    const id = byFull.get(`${sym}|${String(r.name || '').toLowerCase()}`) || bySymbol.get(sym) || null
    return id ? { ...r, coingecko_id: id } : r
  })
}
const STABLECOINS = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'USDD', 'GUSD', 'FRAX', 'LUSD', 'CRVUSD', 'PYUSD', 'FDUSD', 'USDE', 'USDS', 'USD0'])

const HeatmapsPage = ({ dayMode = false, isMobile = false, onBack, marketMode = 'crypto', onTokenClick, onOpenScreener }) => {
  const { t } = useTranslation()
  const { fmtPrice, fmtLarge } = useCurrency()
  const { triggerCopyToast } = useCopyToast()
  const isStocks = marketMode === 'stocks'

  const [allTokens, setAllTokens] = useState([])
  const [loading, setLoading] = useState(true)
  // Tracks the latest token-data refresh for the FreshnessTag in the hero.
  const [lastUpdated, setLastUpdated] = useState(null)
  const [error, setError] = useState(null)
  const [tokenCount, setTokenCount] = useState(isMobile ? 25 : (isStocks ? 100 : 100))
  const [timeframe, setTimeframeRaw] = useState('24h')
  const [fullscreen, setFullscreen] = useState(false)
  const [viewMode, setViewModeRaw] = useState('treemap')
  // tracked setters - every remaining call site is a user click; programmatic
  // resets (mode switch, runners lock) call the raw setters so analytics only
  // sees real interactions
  const setTimeframe = (v) => { trackUi('heatmap_timeframe', v); setTimeframeRaw(v) }
  const setViewMode = (v) => { trackUi('heatmap_view', v); setViewModeRaw(v) }
  const [chartToken, setChartToken] = useState(null)
  const [chartPinned, setChartPinned] = useState(true)
  const [compareMode, setCompareMode] = useState(false)
  const [compareTokens, setCompareTokens] = useState([])
  const [sortBy, setSortBy] = useState('market_cap')
  const containerRef = useRef(null)
  const gridTopRef = useRef(null)
  const [isHeatmapShareExporting, setIsHeatmapShareExporting] = useState(false)
  const [heatShareModalOpen, setHeatShareModalOpen] = useState(false)
  const [heatShareImageUrl, setHeatShareImageUrl] = useState(null)
  const [heatShareDescription, setHeatShareDescription] = useState('')

  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState('all') // 'all' | 'gainers' | 'losers'
  const [minChangeThreshold, setMinChangeThreshold] = useState(null) // null | 1 | 5 | 10
  const [currentPage, setCurrentPage] = useState(1)

  // Category state
  const [categories, setCategories] = useState([])
  const [selectedCategory, setSelectedCategory] = useState(null) // null = all, or category id
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false)
  const categoryDropdownRef = useRef(null)


  // Hover tooltip state. _livePrice/_change are kept in a ref (not on the
  // token object) so the per-tile hover handlers never have to spread
  // {...token} on every mousemove — that fresh object per tile, ~100 tiles
  // every 10s price tick, was defeating any tile memoization.
  const [hoveredToken, setHoveredToken] = useState(null)
  const [hoverPos, setHoverPos] = useState(null)
  const hoverScalarsRef = useRef({ livePrice: null, change: null })
  const hoverTimerRef = useRef(null)
  // rAF-throttle for the tooltip-follow position update. Moving the cursor
  // within a tile fires mousemove many times per frame; each setHoverPos
  // re-renders the whole tile list. Coalesce to ≤1 update per animation frame.
  const hoverRafRef = useRef(null)
  const hoverPosRef = useRef(null)

  // Track mount state so async polls/fetches that resolve after unmount don't
  // call setState on a dead component (a source of intermittent navigation
  // errors when leaving the page while a request was in flight).
  const mountedRef = useRef(true)
  useEffect(() => () => {
    mountedRef.current = false
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    if (hoverRafRef.current) cancelAnimationFrame(hoverRafRef.current)
  }, [])

  useEffect(() => {
    setTokenCount(isMobile ? 25 : (isStocks ? 100 : 100))
    setTimeframeRaw('24h')
    setSortBy('market_cap')
    setSearchQuery('')
    setFilterMode('all')
    setMinChangeThreshold(null)
    setCurrentPage(1)
    setSelectedCategory(null)
  }, [isStocks]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page when filters/sort/count/category change
  useEffect(() => { setCurrentPage(1) }, [searchQuery, filterMode, minChangeThreshold, sortBy, tokenCount, timeframe, selectedCategory])

  // X Dash runners carry only a 24h change — lock the timeframe while active
  // (the TF pills are hidden in this mode) so the color scale stays honest.
  const isRunnersMode = selectedCategory === XDASH_RUNNERS_CATEGORY
  useEffect(() => {
    if (isRunnersMode) {
      setTimeframeRaw('24h')
      // Runners count pills are 25/50/100 — snap an out-of-range count to 50.
      setTokenCount((c) => ([25, 50, 100].includes(c) ? c : 50))
    }
  }, [isRunnersMode])

  // Subscribe Binance only to the symbols currently visible on the active page.
  // Replaces a flat top-100 subscription that was firing tickers for tiles the
  // user wasn't looking at. Symbol set is recomputed below from paginatedTokens.
  const [visibleSymbols, setVisibleSymbols] = useState([])
  const { prices: binancePrices } = useBinanceTopCoinPrices(isStocks ? [] : visibleSymbols, isStocks ? null : 10000)

  /* ── Categories — load eagerly (crypto) so the dropdown is ready on open,
     not fetched mid-click (which flashed an empty "All Categories" list). ── */
  const categoriesLoadedRef = useRef(false)
  useEffect(() => {
    if (isStocks) return
    if (categoriesLoadedRef.current) return
    categoriesLoadedRef.current = true
    getCategories().then(cats => {
      if (Array.isArray(cats) && cats.length > 0 && mountedRef.current) setCategories(cats)
      else categoriesLoadedRef.current = false
    }).catch(() => { categoriesLoadedRef.current = false })
  }, [isStocks])

  // Close dropdown on outside click
  useEffect(() => {
    if (!categoryDropdownOpen) return
    const handleClick = (e) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target)) {
        setCategoryDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [categoryDropdownOpen])

  // Maps CoinGecko coin shape to heatmap token.
  // `period` is the active timeframe the data was fetched for - the Spectre
  // data-api /v1/heatmap returns `change` as a single flat number reflecting
  // that period (not a nested {1h,24h,7d,30d} object). The CoinGecko fallback
  // returns flat price_change_percentage_* fields for all periods.
  const mapCgCoins = useCallback((coins, period = '24h') => {
    return (coins || []).map((coin, index) => {
      // NO ticker fallback here: the Spectre /v1/heatmap rows carry no CG id,
      // and seeding cgId with the raw symbol ("LEO") poisoned every consumer
      // downstream (RZ slug, /api/bars ?cgId=, the CG chart fallback) — the
      // "chart takes 5-10s / unavailable" class. Missing id stays empty and
      // navigation falls back to a symbol slug that RZ resolves properly.
      const cgId = coin.coingecko_id || coin.cgId || coin.id || ''
      const flatChange = typeof coin.change === 'number' ? coin.change : undefined
      // Spectre data-api: pct_change_24h is only emitted when period=24h.
      // CoinGecko fallback: price_change_percentage_24h is always present.
      const cg24h = Number(coin.price_change_percentage_24h ?? coin.pct_change_24h)
      const cg1h = Number(coin.price_change_percentage_1h_in_currency)
      const cg7d = Number(coin.price_change_percentage_7d_in_currency)
      const cg30d = Number(coin.price_change_percentage_30d_in_currency)
      const periodValue = Number.isFinite(flatChange) ? flatChange : NaN

      return {
        rank: coin.market_cap_rank || index + 1,
        symbol: (coin.symbol || coin.asset || '').toUpperCase(),
        name: coin.name || coin.asset || '',
        logo: coin.image || coin.logo_url || null,
        id: cgId,
        cgId,
        address: coin.address || coin.contract || null,
        networkId: coin.networkId || coin.network_id || null,
        price: Number(coin.current_price ?? coin.price) || 0,
        // Windows the lane did not deliver are null, not 0 - a 0 here reads as
        // "flat" downstream (AdvancedCompare printed "+0.00% BEST" three times).
        // Tile colour/sort go through getChange(), which coerces with || 0.
        change24h: Number.isFinite(cg24h) ? cg24h : (period === '24h' && Number.isFinite(periodValue) ? periodValue : 0),
        change1h: Number.isFinite(cg1h) ? cg1h : (period === '1h' && Number.isFinite(periodValue) ? periodValue : null),
        change7d: Number.isFinite(cg7d) ? cg7d : (period === '7d' && Number.isFinite(periodValue) ? periodValue : null),
        change30d: Number.isFinite(cg30d) ? cg30d : (period === '30d' && Number.isFinite(periodValue) ? periodValue : null),
        marketCap: Number(coin.market_cap ?? coin.marketCap) || 0,
        volume: Number(coin.total_volume ?? coin.volume_24h ?? coin.volume) || 0,
      }
    })
  }, [])

  const fetchCryptoHeatmapRows = useCallback(async () => {
    // X Dash runners — the social momentum board rendered as a heatmap. One
    // 100-row fetch; the token-count pills (25/50/100) slice client-side.
    if (selectedCategory === XDASH_RUNNERS_CATEGORY) {
      return getXDashRunnerCoins(100)
    }
    const category = selectedCategory || ''
    // Pool size must cover filter+sort+pagination but stay close to what the
    // page actually shows. 250 desktop / 100 mobile is plenty for search and
    // gainers/losers filters; the previous 500 was ~2x the desktop max page.
    const poolLimit = isMobile ? 100 : 250
    // Spectre data-api /v1/heatmap only supports 1h, 24h, 7d. For 30d we go
    // to the Hetzner-cached /coins/markets passthrough (sparkline disabled —
    // heatmaps don't render them) instead of slamming public CoinGecko.
    const dataApiSupported = timeframe === '1h' || timeframe === '24h' || timeframe === '7d'
    if (dataApiSupported) {
      getCgIdJoinMap() // warm the id join concurrently with the heatmap fetch
      const heatmapRows = await getSpectreHeatmap({ period: timeframe, limit: poolLimit, category })
      if (heatmapRows.length > 0) return enrichHeatmapRowsWithCgIds(heatmapRows)
    }

    if (!category) {
      return getSpectreCoinsMarketsPage(1, poolLimit, { sparkline: false })
    }

    return getCategoryCoins(category, 1, Math.min(poolLimit, 100))
  }, [selectedCategory, timeframe, isMobile])

  /* ── Fetch data ── */
  useEffect(() => {
    let cancelled = false

    const fetchCrypto = async () => {
      setLoading(true)
      setError(null)
      try {
        if (cancelled) return
        const coins = await fetchCryptoHeatmapRows()

        setAllTokens(mapCgCoins(coins, timeframe)); setLastUpdated(Date.now())
        setLoading(false)
      } catch (err) {
        if (!cancelled) { setError(t('common.error')); setLoading(false) }
      }
    }

    const fetchStocks = async () => {
      // Live-only: never seed the heatmap with fabricated/stale fallback prices.
      // The loading shimmer shows until real quotes arrive; any stock without a
      // live price is omitted so we never render a $0 or pre-split tile.
      setLoading(true)
      setError(null)
      try {
        const allSymbols = POPULAR_STOCKS.map(s => s.symbol)
        const quotes = await getStockQuotes(allSymbols)
        if (cancelled) return
        const liveMapped = POPULAR_STOCKS
          .map((stock) => {
            const q = quotes[stock.symbol]
            if (!q || !(q.price > 0)) return null
            return {
              symbol: stock.symbol,
              name: q.name || stock.name,
              logo: getStockLogoUrl(stock.symbol),
              price: q.price, change24h: q.change ?? 0,
              change1h: null, change7d: null, change30d: null,
              marketCap: q.marketCap || 0, volume: q.volume || 0,
              sector: q.sector || stock.sector || '',
              pe: q.pe ?? null, isStock: true,
            }
          })
          .filter(Boolean)
          .map((row, i) => ({ ...row, rank: i + 1 }))
        setAllTokens(liveMapped); setLastUpdated(Date.now())
      } catch (err) {
        if (!cancelled) setError(t('common.error'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    if (isStocks) fetchStocks()
    else fetchCrypto()

    return () => { cancelled = true }
  }, [isStocks, fetchCryptoHeatmapRows, mapCgCoins])

  // Polling callback for heatmap refresh
  const pollHeatmapTokens = useCallback(async () => {
    if (isStocks) {
      try {
        const allSymbols = POPULAR_STOCKS.map(s => s.symbol)
        const quotes = await getStockQuotes(allSymbols)
        if (!mountedRef.current) return
        const liveMapped = POPULAR_STOCKS
          .map((stock) => {
            const q = quotes[stock.symbol]
            if (!q || !(q.price > 0)) return null
            return {
              symbol: stock.symbol,
              name: q.name || stock.name,
              logo: getStockLogoUrl(stock.symbol),
              price: q.price, change24h: q.change ?? 0,
              change1h: null, change7d: null, change30d: null,
              marketCap: q.marketCap || 0, volume: q.volume || 0,
              sector: q.sector || stock.sector || '',
              pe: q.pe ?? null, isStock: true,
            }
          })
          .filter(Boolean)
          .map((row, i) => ({ ...row, rank: i + 1 }))
        if (liveMapped.length > 0) setAllTokens(liveMapped)
      } catch {}
    } else {
      try {
        const coins = await fetchCryptoHeatmapRows()
        if (!mountedRef.current) return
        setAllTokens(mapCgCoins(coins, timeframe)); setLastUpdated(Date.now())
      } catch {}
    }
  }, [isStocks, fetchCryptoHeatmapRows, mapCgCoins, timeframe])

  // Adaptive polling for heatmap data
  useAdaptivePolling(pollHeatmapTokens, { interval: isStocks ? 2 * 60 * 1000 : 5 * 60 * 1000 })

  useEffect(() => {
    if (!fullscreen) return
    const handleEsc = (e) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [fullscreen])

  const getChange = useCallback((token) => {
    if (isStocks) return token.change24h || 0
    if (timeframe === '1h') return token.change1h || 0
    if (timeframe === '7d') return token.change7d || 0
    if (timeframe === '30d') return token.change30d || 0
    return token.change24h || 0
  }, [timeframe, isStocks])

  /* ── Filter + sort pipeline (runs on ALL tokens, stablecoins excluded) ── */
  const filteredTokens = useMemo(() => {
    let tokens = allTokens.filter(t => !STABLECOINS.has((t.symbol || '').toUpperCase()))

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      tokens = tokens.filter(t =>
        (t.symbol || '').toLowerCase().includes(q) ||
        (t.name || '').toLowerCase().includes(q)
      )
    }

    // Gainers/losers filter
    if (filterMode === 'gainers') {
      tokens = tokens.filter(t => getChange(t) > 0)
    } else if (filterMode === 'losers') {
      tokens = tokens.filter(t => getChange(t) < 0)
    }

    // Min change threshold
    if (minChangeThreshold != null) {
      tokens = tokens.filter(t => Math.abs(getChange(t)) >= minChangeThreshold)
    }

    // Sort
    if (sortBy === 'change') {
      tokens.sort((a, b) => Math.abs(getChange(b)) - Math.abs(getChange(a)))
    } else if (sortBy === 'volume') {
      tokens.sort((a, b) => (b.volume || 0) - (a.volume || 0))
    } else if (sortBy === 'sector' && isStocks) {
      tokens.sort((a, b) => (a.sector || '').localeCompare(b.sector || ''))
    }

    return tokens
  }, [allTokens, searchQuery, filterMode, minChangeThreshold, sortBy, getChange, isStocks])

  // When the search finds nothing in the loaded top-N pool (e.g. SPECTRE, which
  // sits outside the top 250 by mcap), resolve it globally via CoinGecko so the
  // user can jump to where the token actually lives (Research Zone) instead of a
  // dead "no match".
  const [globalSearchResults, setGlobalSearchResults] = useState([])
  useEffect(() => {
    const q = searchQuery.trim()
    if (isStocks || q.length < 2 || filteredTokens.length > 0) { setGlobalSearchResults([]); return undefined }
    let cancelled = false
    const id = setTimeout(() => {
      searchCoinsForROI(q)
        .then((rows) => { if (!cancelled) setGlobalSearchResults(Array.isArray(rows) ? rows.slice(0, 12) : []) })
        .catch(() => { if (!cancelled) setGlobalSearchResults([]) })
    }, 250)
    return () => { cancelled = true; clearTimeout(id) }
  }, [searchQuery, filteredTokens.length, isStocks])

  /* ── Pagination — tokenCount = items per page ── */
  const totalPages = Math.max(1, Math.ceil(filteredTokens.length / tokenCount))
  const needsPagination = totalPages > 1
  const safeCurrentPage = Math.min(currentPage, totalPages)

  const paginatedTokens = useMemo(() => {
    const start = (safeCurrentPage - 1) * tokenCount
    return filteredTokens.slice(start, start + tokenCount)
  }, [filteredTokens, safeCurrentPage, tokenCount])

  // Use paginatedTokens for the grid
  const heatmapTokens = paginatedTokens

  // Keep Binance subscription in sync with the symbols on screen. Recomputed
  // when the user paginates, filters, or switches timeframe.
  useEffect(() => {
    if (isStocks) { setVisibleSymbols([]); return }
    const syms = heatmapTokens.map(t => (t.symbol || '').toUpperCase()).filter(Boolean)
    setVisibleSymbols((prev) => {
      if (prev.length === syms.length && prev.every((s, i) => s === syms[i])) return prev
      return syms
    })
  }, [heatmapTokens, isStocks])

  const goToPage = useCallback((page) => {
    const p = Math.max(1, Math.min(page, totalPages))
    setCurrentPage(p)
    gridTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

  /* ── Stats (computed from all filtered tokens, not just current page) ── */
  const stats = useMemo(() => {
    if (!filteredTokens.length) return null
    // Use the same live (Binance-overlaid) 24h change the tiles render, so the
    // gainers/losers/avg header counts track live instead of lagging on the
    // 5-min polled value.
    const liveChange = (t) => {
      if (!isStocks && timeframe === '24h') {
        const live = binancePrices?.[t.symbol] || binancePrices?.[t.symbol?.toUpperCase?.()] || {}
        if (live.change != null) return Number(live.change) || 0
      }
      return getChange(t)
    }
    const total = filteredTokens.length
    const gains = filteredTokens.filter(t => liveChange(t) > 0).length
    const losses = total - gains
    const avgChange = filteredTokens.reduce((s, t) => s + liveChange(t), 0) / total
    const totalMcap = filteredTokens.reduce((s, t) => s + (t.marketCap || 0), 0)
    const totalVol = filteredTokens.reduce((s, t) => s + (t.volume || 0), 0)
    const best = [...filteredTokens].sort((a, b) => liveChange(b) - liveChange(a))[0]
    const worst = [...filteredTokens].sort((a, b) => liveChange(a) - liveChange(b))[0]
    const sentiment = avgChange > 1 ? 'bullish' : avgChange < -1 ? 'bearish' : 'neutral'
    const breadth = total > 0 ? (gains / total) * 100 : 50
    return { total, gains, losses, avgChange, totalMcap, totalVol, best, worst, sentiment, breadth }
  }, [filteredTokens, getChange, isStocks, timeframe, binancePrices])

  // ── Liquidity Pulse: money in / money out over the active timeframe ──
  // Cell-sum from the visible names — every timeframe, both asset classes.
  const liquidityFlow = useMemo(
    () => computeLiquidityFlow(filteredTokens, getChange, { topN: 3 }),
    [filteredTokens, getChange]
  )

  const [globalMetrics, setGlobalMetrics] = useState(null)
  const refreshGlobalMetrics = useCallback(() => {
    if (isStocks) return
    getSpectreGlobalMetrics()
      .then((m) => { if (m) setGlobalMetrics(m) })
      .catch(() => {})
  }, [isStocks])
  useEffect(() => { refreshGlobalMetrics() }, [refreshGlobalMetrics])
  useAdaptivePolling(refreshGlobalMetrics, { interval: 5 * 60 * 1000, enabled: !isStocks })

  const liquidityPulse = useMemo(() => {
    // ONE arithmetic, every timeframe, both asset classes: sum the dollar move
    // of the names actually on this board.
    //
    // 🪤 Crypto @24h used to be overridden with CoinGecko's global
    // `market_cap_change_percentage_24h_usd`, which the old comment called
    // "authoritative". It is not — it is a different aggregate on a different
    // clock, and on 2026-09-03 it read +1.34% while this board's own BTC tile
    // read +5.25%. The header printed "$35.99B added" directly above a BTC tile
    // worth +$81B on its own, and the same market measured off our tape was
    // +$116B. A headline that contradicts the tiles under it is worse than no
    // headline, so the override is gone: what you see summed is what you see.
    if (!liquidityFlow || liquidityFlow.coverage <= 0) return null
    return {
      net: liquidityFlow.net,
      coverageLabel: isStocks
        ? t('heatmaps.liquidityStocks', '{{count}} stocks', { count: liquidityFlow.coverage })
        : t('heatmaps.liquidityTopTokens', 'the top {{count}} tokens', { count: liquidityFlow.coverage }),
      contributors: liquidityFlow?.contributors || [],
    }
  }, [liquidityFlow, isStocks, t])

  const activeTimeframes = isStocks ? STOCK_TIMEFRAMES : TIMEFRAMES
  const activeTf = activeTimeframes.find(tf => tf.id === timeframe)
  const tfLabel = activeTf?.labelKey ? t(activeTf.labelKey) : (activeTf?.label || 'Today')
  // Prefer the authoritative whole-market cap (global feed) over the sum of the
  // visible tiles — otherwise the header understates the true total (e.g. $1.9T
  // of shown tokens vs the real ~$2.25T crypto market).
  const wholeMarketCap = !isStocks && globalMetrics?.totalMarketCap > 0 ? globalMetrics.totalMarketCap : null
  const primarySizeMetric = stats && !isStocks && !wholeMarketCap && stats.totalMcap <= 0 && stats.totalVol > 0
    ? { label: t('common.volume24h'), value: stats.totalVol, tip: 'Combined 24h trading volume for the assets shown. The current Spectre heatmap feed does not include market caps for every tile yet, so volume is the honest sizing aggregate.' }
    : { label: t('heatmaps.totalMcap'), value: wholeMarketCap || stats?.totalMcap || 0, tip: wholeMarketCap ? 'Total market capitalization of the entire crypto market (live global feed), not just the tiles shown.' : 'Combined market capitalization of all assets shown on the heatmap.' }
  const activeCounts = isRunnersMode
    ? [25, 50, 100] // the X Dash board tops out at 100 runners
    : isMobile
      ? (isStocks ? MOBILE_STOCK_COUNTS : MOBILE_TOKEN_COUNTS)
      : (isStocks ? STOCK_COUNTS : TOKEN_COUNTS)

  // Active filters count (for showing "clear all" or badge)
  const activeFiltersCount = (searchQuery.trim() ? 1 : 0) + (filterMode !== 'all' ? 1 : 0) + (minChangeThreshold != null ? 1 : 0) + (selectedCategory ? 1 : 0)

  const clearAllFilters = useCallback(() => {
    setSearchQuery('')
    setFilterMode('all')
    setMinChangeThreshold(null)
    setSelectedCategory(null)
  }, [])

  const selectedCategoryName = useMemo(() => {
    if (!selectedCategory) return null
    if (selectedCategory === XDASH_RUNNERS_CATEGORY) return t('heatmaps.xRunners', 'X Runners')
    return categories.find(c => c.id === selectedCategory)?.name || selectedCategory
  }, [selectedCategory, categories, t])

  /* ── Tile click handler — single or compare mode ── */
  const handleTileClick = useCallback((token) => {
    if (token.isStock) return
    if (compareMode) {
      // Toggle token in compare list (max 8)
      setCompareTokens(prev => {
        const exists = prev.find(t => t.symbol === token.symbol)
        if (exists) return prev.filter(t => t.symbol !== token.symbol)
        if (prev.length >= 3) return prev
        return [...prev, token]
      })
      // Ensure window is open
      if (!chartToken) setChartToken(token)
      return
    }
    // A tile click opens the floating chart (drag / pin / unpin) above the
    // map, so the user stays on the page. Leaving for the Research Zone or the
    // AI Screener is the chart window's "View token" button (handleGoToToken).
    // Same token again closes the window.
    setChartToken(prev => prev?.symbol === token.symbol ? null : token)
  }, [compareMode, chartToken])

  /* ── Toggle compare mode ── */
  const handleToggleCompare = useCallback(() => {
    setCompareMode(prev => {
      if (!prev && chartToken) {
        // Entering compare: seed with current token
        setCompareTokens(curr => curr.length === 0 ? [chartToken] : curr)
      }
      return !prev
    })
  }, [chartToken])

  /* ── Remove token from compare ── */
  const handleRemoveCompareToken = useCallback((symbol) => {
    setCompareTokens(prev => prev.filter(t => t.symbol !== symbol))
  }, [])

  /* ── Navigate to full token page (from chart panel) ──
     Ranked (top-3000 class) tokens go to the Research Zone; X Dash runners
     (degen on-chain) go to the AI Screener by contract. The screener is the
     trading terminal with no mobile experience yet — on mobile a runner reads
     "coming soon" instead of dropping into a broken iframe. */
  const handleGoToToken = useCallback(() => {
    if (!chartToken) return
    if (isRunnersMode && chartToken.address) {
      if (isMobile) {
        triggerCopyToast('AI Screener — coming soon on mobile')
        return
      }
      if (onOpenScreener) {
        onOpenScreener({
          symbol: chartToken.symbol,
          name: chartToken.name,
          cgId: chartToken.cgId || chartToken.id || null,
          address: chartToken.address,
          networkId: chartToken.networkId ?? null,
          logo: chartToken.logo || null,
        })
        return
      }
    }
    if (!onTokenClick) return
    onTokenClick({
      symbol: chartToken.symbol,
      name: chartToken.name,
      logo: chartToken.logo,
      id: chartToken.id,
      cgId: chartToken.cgId || chartToken.id,
    })
  }, [chartToken, isRunnersMode, isMobile, onOpenScreener, onTokenClick, triggerCopyToast])

  /* ── Tile hover handler (rich tooltip) ── */
  // Receives the raw token reference plus the two computed scalars (livePrice,
  // change) as separate args — never a spread copy. Scalars are stashed in a
  // ref and read by the tooltip, so the hot mousemove path allocates nothing.
  const handleTileHover = useCallback((token, livePrice, change, e) => {
    clearTimeout(hoverTimerRef.current)
    if (!token) {
      hoverTimerRef.current = setTimeout(() => {
        setHoveredToken(null)
        setHoverPos(null)
      }, 50)
    } else if (hoveredToken?.symbol !== token.symbol) {
      hoverScalarsRef.current = { livePrice, change }
      hoverTimerRef.current = setTimeout(() => {
        setHoveredToken(token)
        setHoverPos({ x: e.clientX, y: e.clientY })
      }, 100)
    } else {
      // Same token still hovered: keep its scalars fresh as live prices tick.
      hoverScalarsRef.current = { livePrice, change }
      // Same token, cursor moving inside the tile: coalesce the tooltip-follow
      // position to one setState per frame so a fast mousemove doesn't re-render
      // the whole list on every event.
      hoverPosRef.current = { x: e.clientX, y: e.clientY }
      if (hoverRafRef.current) return
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null
        if (mountedRef.current) setHoverPos(hoverPosRef.current)
      })
    }
  }, [hoveredToken])

  // ── Share heatmap to X ──
  const handleShareHeatmap = useCallback(async () => {
    if (isHeatmapShareExporting) return
    setIsHeatmapShareExporting(true)
    setHeatShareImageUrl(null)
    setHeatShareModalOpen(true)

    try {
      const tokens = (heatmapTokens || []).slice(0, 25)
      const modeLabel = isStocks ? t('heatmaps.shareModeStock', 'STOCK') : t('heatmaps.shareModeCrypto', 'CRYPTO')

      // 2026-05-26 beta-quality fix: guard against undefined best/worst symbols so
      // the share text never renders "Top: $undefined" when stats is partially populated.
      const bestLine = stats?.best?.symbol
        ? `${t('heatmaps.shareTop', { symbol: stats.best.symbol, pct: formatChange(getChange(stats.best)), defaultValue: 'Top: ${{symbol}} +{{pct}}%' })}\n`
        : ''
      const worstLine = stats?.worst?.symbol
        ? `${t('heatmaps.shareBottom', { symbol: stats.worst.symbol, pct: formatChange(getChange(stats.worst)), defaultValue: 'Bottom: ${{symbol}} {{pct}}%' })}\n`
        : ''
      const countsLine = stats
        ? t('heatmaps.shareCounts', { gains: stats.gains, losses: stats.losses, defaultValue: '{{gains}} gaining \u00B7 {{losses}} losing' })
        : ''
      const heading = t('heatmaps.shareHeading', { mode: modeLabel, tf: tfLabel, defaultValue: '\u{1F7E9}\u{1F7E5} {{mode}} Heatmap - {{tf}}' })
      setHeatShareDescription(`${heading}\n\n${bestLine}${worstLine}${countsLine}\n\n@Spectre__Ai #crypto`)

      const [logoMap, spectreLogo] = await Promise.all([
        preloadLogos(tokens, (t) => t.logo),
        getSpectreLogo(),
      ])

      const dataUrl = renderShareCard(
        (ctx, w, contentTop, c, fonts) => {
          const pad = CARD_PAD
          let gy = contentTop + 4

          const ambGlow = ctx.createRadialGradient(w * 0.35, gy + 120, 0, w * 0.35, gy + 120, 300)
          ambGlow.addColorStop(0, c.isLight ? 'rgba(16, 185, 129, 0.03)' : 'rgba(52, 211, 153, 0.05)')
          ambGlow.addColorStop(0.5, c.isLight ? 'rgba(239, 68, 68, 0.015)' : 'rgba(248, 113, 113, 0.03)')
          ambGlow.addColorStop(1, 'transparent')
          ctx.fillStyle = ambGlow
          ctx.fillRect(0, contentTop, w, 500)

          const accentGrad = ctx.createLinearGradient(pad, 0, w - pad, 0)
          accentGrad.addColorStop(0, 'transparent')
          accentGrad.addColorStop(0.2, c.isLight ? 'rgba(5, 150, 105, 0.3)' : 'rgba(52, 211, 153, 0.3)')
          accentGrad.addColorStop(0.5, c.isLight ? 'rgba(220, 38, 38, 0.2)' : 'rgba(248, 113, 113, 0.2)')
          accentGrad.addColorStop(0.8, c.isLight ? 'rgba(5, 150, 105, 0.25)' : 'rgba(52, 211, 153, 0.25)')
          accentGrad.addColorStop(1, 'transparent')
          ctx.fillStyle = accentGrad
          ctx.fillRect(pad, gy, w - pad * 2, 1.5)
          gy += 14

          const cols = 5
          const rows = Math.ceil(tokens.length / cols)
          const gap = 6
          const tileW = (w - pad * 2 - gap * (cols - 1)) / cols
          const tileH = 78

          tokens.forEach((token, i) => {
            const col = i % cols
            const row = Math.floor(i / cols)
            const tx = pad + col * (tileW + gap)
            const ty = gy + row * (tileH + gap)
            const ch = getChange(token)
            const intensity = Math.min(1, Math.abs(ch) / 10)

            const cr = ch >= 0 ? (c.isLight ? 16 : 52) : (c.isLight ? 220 : 248)
            const cg = ch >= 0 ? (c.isLight ? 185 : 211) : (c.isLight ? 38 : 113)
            const cb = ch >= 0 ? (c.isLight ? 129 : 153) : (c.isLight ? 38 : 113)

            ctx.save()
            roundRect(ctx, tx, ty, tileW, tileH, 10)
            ctx.clip()

            const tileBg = ctx.createLinearGradient(tx, ty, tx + tileW, ty + tileH)
            tileBg.addColorStop(0, c.isLight ? 'rgba(0, 0, 0, 0.025)' : 'rgba(255, 255, 255, 0.04)')
            tileBg.addColorStop(1, c.isLight ? 'rgba(0, 0, 0, 0.012)' : 'rgba(255, 255, 255, 0.018)')
            ctx.fillStyle = tileBg
            ctx.fillRect(tx, ty, tileW, tileH)

            ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${0.05 + intensity * 0.16})`
            ctx.fillRect(tx, ty, tileW, tileH)

            const shimmer = ctx.createLinearGradient(tx, ty, tx + tileW, ty + tileH)
            shimmer.addColorStop(0, c.isLight ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.06)')
            shimmer.addColorStop(0.4, 'transparent')
            shimmer.addColorStop(0.6, 'transparent')
            shimmer.addColorStop(1, c.isLight ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.025)')
            ctx.fillStyle = shimmer
            ctx.fillRect(tx, ty, tileW, tileH)

            ctx.fillStyle = c.isLight ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.08)'
            ctx.fillRect(tx, ty, tileW, 1)

            ctx.restore()

            roundRect(ctx, tx, ty, tileW, tileH, 10)
            ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${0.10 + intensity * 0.18})`
            ctx.lineWidth = 1
            ctx.stroke()

            ctx.textAlign = 'center'
            const cx = tx + tileW / 2

            const sym = (token.symbol || '').toUpperCase()
            const tLogo = logoMap[sym] || logoMap[token.symbol]
            const logoS = 18
            if (tLogo) {
              ctx.save()
              ctx.beginPath()
              ctx.arc(cx, ty + 16, logoS / 2, 0, Math.PI * 2)
              ctx.clip()
              ctx.drawImage(tLogo, cx - logoS / 2, ty + 16 - logoS / 2, logoS, logoS)
              ctx.restore()
              ctx.beginPath()
              ctx.arc(cx, ty + 16, logoS / 2, 0, Math.PI * 2)
              ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, 0.18)`
              ctx.lineWidth = 0.5
              ctx.stroke()
            } else {
              ctx.font = `700 10px ${fonts.body}`
              ctx.fillStyle = c.symbol
              ctx.fillText(sym.charAt(0), cx, ty + 20)
            }

            ctx.font = `600 9.5px ${fonts.body}`
            ctx.fillStyle = c.symbol
            ctx.fillText(sym, cx, ty + 36)

            ctx.font = `700 13px ${fonts.mono}`
            ctx.fillStyle = ch >= 0 ? c.bull : c.bear
            ctx.fillText(`${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%`, cx, ty + 52)

            ctx.font = `400 8px ${fonts.mono}`
            ctx.fillStyle = c.muted
            const price = token.price != null ? fmtPrice(token.price) : ''
            ctx.fillText(price, cx, ty + 66)

            const glowGrad = ctx.createLinearGradient(tx + tileW * 0.15, 0, tx + tileW * 0.85, 0)
            glowGrad.addColorStop(0, 'transparent')
            glowGrad.addColorStop(0.5, `rgba(${cr}, ${cg}, ${cb}, ${0.12 + intensity * 0.22})`)
            glowGrad.addColorStop(1, 'transparent')
            ctx.fillStyle = glowGrad
            ctx.fillRect(tx + 4, ty + tileH - 2, tileW - 8, 1.5)
          })

          return 4 + 14 + rows * (tileH + gap) + 16
        },
        {
          title: isStocks ? t('heatmaps.stockHeatmap') : t('heatmaps.cryptoHeatmap'),
          badges: [
            { text: tfLabel, filled: false },
            { text: t('heatmaps.heatmapBadge', 'HEATMAP'), filled: true },
          ],
          subtitle: t('heatmaps.shareTopN', { count: tokens.length, defaultValue: 'Top {{count}}' }),
          logo: spectreLogo,
        },
      )
      setHeatShareImageUrl(dataUrl)
    } catch (err) {
      console.error('Heatmap share failed:', err)
      setHeatShareModalOpen(false)
    }
    setIsHeatmapShareExporting(false)
  }, [isHeatmapShareExporting, heatmapTokens, isStocks, tfLabel, stats, getChange, fmtPrice, t])

  // Max volume for relative bar sizing — volume is static per token (not a
  // live-price input), so this only recomputes when the token set changes.
  const maxVolume = useMemo(
    () => heatmapTokens.reduce((m, t) => (t.volume || 0) > m ? (t.volume || 0) : m, 1),
    [heatmapTokens],
  )

  /* ── Render heatmap grid ── */
  const renderHeatmapGrid = useCallback((isFullscreenView) => {
    const count = heatmapTokens.length
    const useNamedAreas = count === 25 && !needsPagination
    // Column counts chosen to divide evenly: 25→5, 50→10, 100→10
    const cols = useNamedAreas ? 6 : tokenCount <= 25 ? 5 : 10

    const gridStyle = {
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
    }
    if (useNamedAreas) {
      gridStyle.gridTemplateAreas = GRID_CONFIGS[25].areas
      gridStyle.gridTemplateRows = isFullscreenView ? 'repeat(5, 1fr)' : 'repeat(5, minmax(90px, 1fr))'
    }

    return (
      <div
        className={`heatmap-grid ${isFullscreenView ? 'heatmap-grid--fullscreen' : ''} ${isStocks ? 'heatmap-grid--stocks' : ''}`}
        style={gridStyle}
      >
        {heatmapTokens.map((token, idx) => {
          const liveData = !isStocks ? (binancePrices?.[token.symbol] || binancePrices?.[token.symbol?.toUpperCase?.()] || {}) : {}
          const livePrice = isStocks ? token.price : (liveData.price > 0 ? liveData.price : token.price)
          const liveChange24h = !isStocks && liveData.change != null ? liveData.change : token.change24h
          const change = !isStocks && timeframe === '24h' ? (Number(liveChange24h) || 0) : getChange(token)
          const absChange = Math.abs(change)
          const isPositive = change >= 0
          const intensity = Math.min(1, absChange / 10)

          // Premium glass: deep base green/red (not neon) with a soft gradient.
          // Enough colour that even flat tiles read (never gray), refined at the
          // top so strong movers deepen rather than glow.
          // Day mode: SOLID clean hsl tints (translucent emerald over white
          // greys out and becomes indistinguishable from the red side). Green
          // anchored on #16C784's hue, red on coral — light enough for the
          // dark text, saturated enough to read green-vs-red at a glance.
          const tintRgb = isPositive
            ? (dayMode ? '5, 150, 105' : '16, 185, 129')
            : (dayMode ? '220, 38, 38' : '239, 68, 68')
          const bgColor = dayMode
            ? (isPositive
              ? `linear-gradient(160deg, hsl(158 ${(62 + intensity * 16).toFixed(1)}% ${(76 - intensity * 16).toFixed(1)}%) 0%, hsl(158 ${(58 + intensity * 14).toFixed(1)}% ${(84 - intensity * 12).toFixed(1)}%) 100%)`
              : `linear-gradient(160deg, hsl(3 ${(72 + intensity * 12).toFixed(1)}% ${(82 - intensity * 14).toFixed(1)}%) 0%, hsl(3 ${(66 + intensity * 10).toFixed(1)}% ${(88 - intensity * 10).toFixed(1)}%) 100%)`)
            : `linear-gradient(160deg, rgba(${tintRgb}, ${(0.15 + intensity * 0.26).toFixed(3)}) 0%, rgba(${tintRgb}, ${(0.055 + intensity * 0.11).toFixed(3)}) 100%)`
          const borderColor = `rgba(${tintRgb}, ${((dayMode ? 0.32 : 0.10) + intensity * (dayMode ? 0.28 : 0.16)).toFixed(3)})`

          // Accent bar glow intensity
          const accentAlpha = ((dayMode ? 0.35 : 0.15) + intensity * 0.55).toFixed(2)

          // Brand color for hover glow
          let brandRgb = '255, 255, 255'
          if (isStocks) {
            brandRgb = SECTOR_COLORS[token.sector] || '139, 92, 246'
          } else {
            const rowColors = TOKEN_ROW_COLORS[(token.symbol || '').toUpperCase()]
            brandRgb = rowColors?.bg || '255, 255, 255'
          }

          // Volume bar width (relative)
          const volPct = ((token.volume || 0) / maxVolume * 100).toFixed(1)

          const gridArea = useNamedAreas
            ? (idx === 0 ? 'hero1' : idx === 1 ? 'hero2' : `t${idx}`)
            : undefined
          const isHero = useNamedAreas && idx < 2

          return (
            <div
              key={token.symbol || idx}
              className={`heatmap-tile ${isHero ? 'heatmap-tile--hero' : ''} ${isPositive ? 'is-positive' : 'is-negative'} ${isStocks ? 'heatmap-tile--stock' : ''} ${!token.isStock && onTokenClick ? 'heatmap-tile--clickable' : ''}`}
              style={{
                gridArea,
                '--tile-bg': bgColor,
                '--tile-border': borderColor,
                '--tile-brand-rgb': brandRgb,
                '--tile-accent-alpha': accentAlpha,
                '--tile-accent-rgb': tintRgb,
                animationDelay: `${Math.min(idx * 15, 600)}ms`,
              }}
              onClick={() => handleTileClick(token)}
              onMouseEnter={(e) => handleTileHover(token, livePrice, change, e)}
              onMouseMove={(e) => handleTileHover(token, livePrice, change, e)}
              onMouseLeave={() => handleTileHover(null)}
            >
              {/* Rank badge */}
              <span className="heatmap-tile-rank">#{token.rank || idx + 1}</span>

              <div className="heatmap-tile-top">
                <div className={`heatmap-tile-logo ${isStocks ? 'heatmap-tile-logo--stock' : ''}`}>
                  <TokenTileLogo
                    logo={token.logo}
                    symbol={token.symbol}
                    sector={token.sector}
                    isStock={isStocks}
                    fallbackClassName="heatmap-tile-logo-fallback"
                  />
                </div>
                <span className="heatmap-tile-symbol">{token.symbol}</span>
                {isStocks && token.sector && (isHero || isFullscreenView || count <= 50) && (
                  <span className="heatmap-tile-sector" style={{ color: `rgb(${SECTOR_COLORS[token.sector] || '139,92,246'})` }}>
                    {token.sector}
                  </span>
                )}
              </div>

              {(isHero || isFullscreenView || count <= 50) && (
                <div className="heatmap-tile-name">{token.name}</div>
              )}

              <div className="heatmap-tile-bottom">
                <span className="heatmap-tile-price">
                  {livePrice ? fmtPrice(livePrice) : '-'}
                </span>
                <span className={`heatmap-tile-change ${isPositive ? 'positive' : 'negative'}`}>
                  {isPositive ? '+' : ''}{formatChange(change)}%
                </span>
              </div>

              {/* Volume micro-bar (hero tiles and <=50 view). Width driven by a
                  CSS custom property so the inline value is a scalar string,
                  not a fresh style object per tile per render. */}
              {(isHero || isFullscreenView || count <= 50) && (
                <div className="heatmap-tile-vol-bar">
                  <div className="heatmap-tile-vol-fill heatmap-tile-vol-fill--share" style={{ '--share': `${volPct}%` }} />
                </div>
              )}

              {/* Bottom accent glow bar */}
              <div className="heatmap-tile-accent" />
            </div>
          )
        })}
      </div>
    )
  }, [heatmapTokens, binancePrices, timeframe, getChange, isStocks, fmtPrice, needsPagination, handleTileClick, handleTileHover, onTokenClick, tokenCount, maxVolume, dayMode])

  /* ── Resolve live change for a token (single source of truth) ── */
  const getLiveChange = useCallback((token) => {
    if (isStocks) return getChange(token)
    const live = binancePrices?.[token.symbol] || binancePrices?.[token.symbol?.toUpperCase?.()] || {}
    if (timeframe === '24h' && live.change != null) return Number(live.change) || 0
    return getChange(token)
  }, [isStocks, binancePrices, timeframe, getChange])

  const getLivePrice = useCallback((token) => {
    if (isStocks) return token.price
    const live = binancePrices?.[token.symbol] || binancePrices?.[token.symbol?.toUpperCase?.()] || {}
    return live.price > 0 ? live.price : token.price
  }, [isStocks, binancePrices])

  // Chart view: precompute live change/price + sort + maxAbs once per
  // data/price change instead of in the render closure on every render.
  // getLiveChange/getLivePrice are useCallback-stable (rebuilt only when their
  // own deps change), so keying on them tracks the real live-price inputs.
  const chartViewData = useMemo(() => {
    if (viewMode !== 'chart') return { rows: [], maxAbs: 1 } // skip the map+sort on every price tick when this view isn't shown
    const rows = heatmapTokens.map(token => ({
      token,
      change: getLiveChange(token),
      livePrice: getLivePrice(token),
    }))
    rows.sort((a, b) => b.change - a.change)
    const maxAbs = rows.reduce((m, e) => Math.abs(e.change) > m ? Math.abs(e.change) : m, 1)
    return { rows, maxAbs }
  }, [viewMode, heatmapTokens, getLiveChange, getLivePrice])

  // Dual view: split into gainers/losers (each sorted) + maxAbs, equal-length
  // columns. Same memo treatment as chart view.
  const dualViewData = useMemo(() => {
    if (viewMode !== 'dual') return { gainers: [], losers: [], maxAbs: 1 } // skip on every tick when not the active view
    const withChange = heatmapTokens.map(token => ({
      token,
      change: getLiveChange(token),
      livePrice: getLivePrice(token),
    }))
    const allGainers = withChange.filter(e => e.change >= 0).sort((a, b) => b.change - a.change)
    const allLosers = withChange.filter(e => e.change < 0).sort((a, b) => a.change - b.change)
    const equalCount = Math.min(allGainers.length, allLosers.length) || Math.max(allGainers.length, allLosers.length)
    const maxAbs = withChange.reduce((m, e) => Math.abs(e.change) > m ? Math.abs(e.change) : m, 1)
    return {
      gainers: allGainers.slice(0, equalCount),
      losers: allLosers.slice(0, equalCount),
      maxAbs,
    }
  }, [viewMode, heatmapTokens, getLiveChange, getLivePrice])

  // Money Flow view: the same live change the other views use, reshaped for
  // the shared treemap. Gated on the active view so a price tick doesn't
  // rebuild ~200 rows for a map nobody is looking at.
  // 🪤 This read `heatmapTokens` — i.e. ONE PAGE of the pagination — and then
  // the treemap called the sum "added to US stocks today". Measured 2026-08-07:
  // the header two inches above said $402.10B across 202 names while this said
  // $391.14B, because page 1 of the stock list is 43 index funds (market cap 0,
  // dropped) plus 57 equities. Paginating, or moving the 25/50/100/200 selector,
  // silently changed a number that reads as a market total. A money-flow MAP is
  // not a paginated table: it takes the whole filtered universe, exactly like
  // the LiquidityPulse header, so the two can no longer disagree.
  const flowRows = useMemo(() => {
    if (viewMode !== 'flows') return []
    return filteredTokens.map((token) => ({
      id: `${token.symbol}-${token.id || token.cgId || token.rank}`,
      symbol: token.symbol,
      name: token.name,
      logo: token.logo,
      logoFallback: token.isStock ? getStockLogoFallback(token.symbol) : null,
      marketCap: Number(token.marketCap) || 0,
      change: getLiveChange(token),
      price: getLivePrice(token),
      _token: token,
    }))
  }, [viewMode, filteredTokens, getLiveChange, getLivePrice])

  // "today" is only honest on the 24h window — say what the tiles measure.
  const flowPeriodLabel = useMemo(() => {
    if (isStocks) return t('moneyFlow.periodToday', 'today')
    if (timeframe === '1h') return t('moneyFlow.periodHour', 'this hour')
    if (timeframe === '7d') return t('moneyFlow.periodWeek', 'this week')
    if (timeframe === '30d') return t('moneyFlow.periodMonth', 'this month')
    return t('moneyFlow.periodToday', 'today')
  }, [isStocks, timeframe, t])

  const renderFlowsView = useCallback((isFullscreenView) => (
    <MoneyFlowTreemap
      rows={flowRows}
      marketLabel={isStocks ? t('moneyFlow.marketStocks', 'US stocks') : t('moneyFlow.marketCrypto', 'crypto')}
      periodLabel={flowPeriodLabel}
      // The skipped rows here are index + commodity funds, which report a cap
      // of 0 on purpose: their assets ARE the constituent shares, so counting
      // them would add the same dollars to the market twice.
      scopeNote={isStocks ? t('moneyFlow.scopeFunds', 'index funds hold the same shares, so they are not counted twice') : ''}
      light={dayMode}
      fill={isFullscreenView}
      compact={isMobile && !isFullscreenView}
      onSelect={(row) => handleTileClick(row._token || row)}
    />
  ), [flowRows, isStocks, flowPeriodLabel, dayMode, isMobile, handleTileClick, t])

  /* ── Render chart view (diverging horizontal bars sorted by change) ── */
  const renderChartView = useCallback((isFullscreenView) => {
    const { rows: withChange, maxAbs } = chartViewData

    return (
      <div className={`heatmap-chart-view${isFullscreenView ? ' heatmap-chart-view--fullscreen' : ''}`}>
        <div className="heatmap-chart-header">
          <span className="heatmap-chart-header-token">{t('heatmaps.asset', 'Asset')}</span>
          <span className="heatmap-chart-header-bar">{t('heatmaps.performance', 'Performance')}</span>
          <span className="heatmap-chart-header-change">{t('heatmaps.change')}</span>
          <span className="heatmap-chart-header-price">{t('common.price')}</span>
        </div>
        {withChange.map(({ token, change, livePrice }, idx) => {
          const isPositive = change >= 0
          const barPct = Math.min(100, Math.max(2, (Math.abs(change) / maxAbs) * 100))

          return (
            <div
              key={token.symbol || idx}
              className={`heatmap-chart-row${isPositive ? ' is-positive' : ' is-negative'}${!token.isStock && onTokenClick ? ' heatmap-chart-row--clickable' : ''}`}
              onClick={() => handleTileClick(token)}
              onMouseEnter={(e) => handleTileHover(token, livePrice, change, e)}
              onMouseMove={(e) => handleTileHover(token, livePrice, change, e)}
              onMouseLeave={() => handleTileHover(null)}
              style={{ animationDelay: `${Math.min(idx * 12, 400)}ms` }}
            >
              <div className="heatmap-chart-token">
                <span className="heatmap-chart-rank">#{token.rank || idx + 1}</span>
                <div className="heatmap-chart-logo">
                  <TokenTileLogo
                    logo={token.logo}
                    symbol={token.symbol}
                    sector={token.sector}
                    isStock={isStocks}
                    fallbackClassName="heatmap-chart-logo-fallback"
                  />
                </div>
                <div className="heatmap-chart-token-info">
                  <span className="heatmap-chart-symbol">{token.symbol}</span>
                  {(isFullscreenView || heatmapTokens.length <= 50) && (
                    <span className="heatmap-chart-name">{token.name}</span>
                  )}
                </div>
              </div>
              <div className="heatmap-chart-bar-area">
                <div className="heatmap-chart-bar-track">
                  <div
                    className={`heatmap-chart-bar ${isPositive ? 'bull' : 'bear'}`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>
              </div>
              <span className={`heatmap-chart-change ${isPositive ? 'positive' : 'negative'}`}>
                {isPositive ? '+' : ''}{formatChange(change)}%
              </span>
              <span className="heatmap-chart-price">{livePrice ? fmtPrice(livePrice) : '-'}</span>
            </div>
          )
        })}
      </div>
    )
  }, [chartViewData, heatmapTokens, fmtPrice, handleTileClick, handleTileHover, onTokenClick, t])

  /* ── Render dual view (gainers left, losers right) ── */
  const renderDualView = useCallback((isFullscreenView) => {
    const { gainers, losers, maxAbs } = dualViewData

    const renderColumn = (items, isGainer) => (
      <div className={`hdc-column${isGainer ? ' hdc-column--bull' : ' hdc-column--bear'}`}>
        <div className="hdc-col-header">
          <span className={`hdc-col-badge${isGainer ? ' hdc-col-badge--bull' : ' hdc-col-badge--bear'}`}>
            {isGainer
              ? t('heatmaps.gainersCount', { count: gainers.length, defaultValue: '{{count}} Gainers' })
              : t('heatmaps.losersCount', { count: losers.length, defaultValue: '{{count}} Losers' })}
          </span>
        </div>
        <div className="hdc-col-rows">
          {items.map(({ token, change, livePrice }, idx) => {
            const barPct = Math.min(100, Math.max(2, (Math.abs(change) / maxAbs) * 100))
            return (
              <div
                key={token.symbol || idx}
                className={`hdc-row${!token.isStock && onTokenClick ? ' hdc-row--clickable' : ''}`}
                onClick={() => handleTileClick(token)}
                onMouseEnter={(e) => handleTileHover(token, livePrice, change, e)}
                onMouseMove={(e) => handleTileHover(token, livePrice, change, e)}
                onMouseLeave={() => handleTileHover(null)}
                style={{ animationDelay: `${Math.min(idx * 15, 400)}ms` }}
              >
                {isGainer ? (
                  <>
                    <div className="hdc-row-token">
                      <div className="hdc-row-logo">
                        <TokenTileLogo
                          logo={token.logo}
                          symbol={token.symbol}
                          sector={token.sector}
                          isStock={isStocks}
                          fallbackClassName="hdc-row-logo-fallback"
                        />
                      </div>
                      <span className="hdc-row-symbol">{token.symbol}</span>
                    </div>
                    <div className="hdc-row-bar-area">
                      <div className="hdc-row-bar-track">
                        <div className="hdc-row-bar bull" style={{ width: `${barPct}%` }} />
                      </div>
                    </div>
                    <span className="hdc-row-change positive">+{formatChange(change)}%</span>
                  </>
                ) : (
                  <>
                    <span className="hdc-row-change negative">{formatChange(change)}%</span>
                    <div className="hdc-row-bar-area">
                      <div className="hdc-row-bar-track hdc-row-bar-track--reversed">
                        <div className="hdc-row-bar bear" style={{ width: `${barPct}%` }} />
                      </div>
                    </div>
                    <div className="hdc-row-token hdc-row-token--end">
                      <div className="hdc-row-logo">
                        <TokenTileLogo
                          logo={token.logo}
                          symbol={token.symbol}
                          sector={token.sector}
                          isStock={isStocks}
                          fallbackClassName="hdc-row-logo-fallback"
                        />
                      </div>
                      <span className="hdc-row-symbol">{token.symbol}</span>
                    </div>
                  </>
                )}
              </div>
            )
          })}
          {items.length === 0 && (
            <div className="hdc-col-empty">
              {isGainer ? t('heatmaps.noGainers') : t('heatmaps.noLosers')}
            </div>
          )}
        </div>
      </div>
    )

    return (
      <div className={`hdc-view${isFullscreenView ? ' hdc-view--fullscreen' : ''}`}>
        {renderColumn(gainers, true)}
        <div className="hdc-divider" />
        {renderColumn(losers, false)}
      </div>
    )
  }, [dualViewData, handleTileClick, handleTileHover, onTokenClick, t])

  const fullscreenBtn = (
    <button
      className="heatmap-fullscreen-btn"
      onClick={() => setFullscreen(f => !f)}
      title={fullscreen ? t('heatmaps.exitFullscreen') : t('heatmaps.fullscreen')}
    >
      {fullscreen ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      )}
    </button>
  )

  // Showing range text
  const showingStart = needsPagination ? (safeCurrentPage - 1) * tokenCount + 1 : 1
  const showingEnd = needsPagination ? Math.min(safeCurrentPage * tokenCount, filteredTokens.length) : filteredTokens.length

  /* ════════════════════════════════════════════════════════
     MOBILE RENDER
     ════════════════════════════════════════════════════════ */
  if (isMobile) {
    return (
      <div className={`heatmaps-page mhm-page${dayMode ? ' day-mode' : ''}${isStocks ? ' stocks-mode' : ''}`}>
        <div className="mhm-content">
          <div className="mhm-header-spacer" aria-hidden="true" />

          {/* Hero - section label + stats */}
          <div className="mhm-section">
            <div className="mhm-hero">
              <div className="mhm-title-row">
                <MobileBackButton className="mhm-back" />
                <span className="mhm-section-label">
                  {isStocks ? t('heatmaps.stockHeatmap') : t('heatmaps.cryptoHeatmap')}
                </span>
                {/* The count rides beside the label instead of orphaning its
                    own line under the title — one tight two-row band. */}
                <span className="mhm-title-dot" aria-hidden="true">·</span>
                <span className="mhm-subtitle">
                  {isStocks
                    ? t('heatmaps.stocksCount', { count: tokenCount, defaultValue: '{{count}} stocks' })
                    : activeFiltersCount > 0
                      ? t('heatmaps.filteredOfTotal', { shown: filteredTokens.length, total: allTokens.length, defaultValue: '{{shown}} of {{total}}' })
                      : t('heatmaps.tokensCount', { count: allTokens.length, defaultValue: '{{count}} tokens' })}
                </span>
                {/* View switch lives in the title row so it's visible the
                    instant the page opens — buried at the end of the scroll
                    pills it was effectively undiscoverable. */}
                <div className="mhm-views" role="group" aria-label="View mode">
                  <button className={`mhm-view-btn${viewMode === 'grid' ? ' active' : ''}`} aria-label="Grid view" onClick={() => setViewMode('grid')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                    </svg>
                  </button>
                  <button className={`mhm-view-btn${viewMode === 'treemap' ? ' active' : ''}`} aria-label="Treemap view" onClick={() => setViewMode('treemap')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="10" height="10" /><rect x="15" y="3" width="6" height="6" /><rect x="15" y="11" width="6" height="4" /><rect x="3" y="15" width="7" height="6" /><rect x="12" y="17" width="9" height="4" />
                    </svg>
                  </button>
                  <button className={`mhm-view-btn${viewMode === 'chart' ? ' active' : ''}`} aria-label="Bars view" onClick={() => setViewMode('chart')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
                    </svg>
                  </button>
                  <button className={`mhm-view-btn${viewMode === 'dual' ? ' active' : ''}`} aria-label="Dual view" onClick={() => setViewMode('dual')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="8" height="18" rx="1" /><rect x="13" y="3" width="8" height="18" rx="1" />
                    </svg>
                  </button>
                  <button className={`mhm-view-btn${viewMode === 'flows' ? ' active' : ''}`} aria-label={t('heatmaps.flowsView', 'Money Flow')} onClick={() => setViewMode('flows')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" />
                    </svg>
                  </button>
                </div>
              </div>
              {liquidityPulse && (
                <LiquidityPulse
                  netFlow={liquidityPulse.net}
                  timeframeLabel={tfLabel}
                  coverageLabel={liquidityPulse.coverageLabel}
                  fmtLarge={fmtLarge}
                  dayMode={dayMode}
                  align="left"
                />
              )}
            </div>

            {stats && (
              <div className="mhm-stats">
                <div className={`mhm-stat-badge mhm-sentiment-${stats.sentiment}`}>
                  <span className="mhm-stat-dot" />
                  {stats.sentiment.toUpperCase()}
                </div>
                <div className="mhm-stat">
                  <span className="mhm-stat-label">{primarySizeMetric.label}</span>
                  <span className="mhm-stat-value">{fmtLarge(primarySizeMetric.value)}</span>
                </div>
                <div className="mhm-stat">
                  <span className="mhm-stat-label">{t('heatmaps.avg')} {tfLabel}</span>
                  <span className={`mhm-stat-value${stats.avgChange >= 0 ? ' pos' : ' neg'}`}>
                    {stats.avgChange >= 0 ? '+' : ''}{stats.avgChange.toFixed(2)}%
                  </span>
                </div>
                <div className="mhm-stat">
                  <span className="mhm-stat-label">{t('common.gainers')}</span>
                  <span className="mhm-stat-value pos">{stats.gains}</span>
                </div>
                <div className="mhm-stat">
                  <span className="mhm-stat-label">{t('common.losers')}</span>
                  <span className="mhm-stat-value neg">{stats.losses}</span>
                </div>
              </div>
            )}
          </div>

          {/* Controls - horizontal scroll pills */}
          <div className="mhm-section-flush">
            <div className="mhm-controls">
              <div className="mhm-pills-row">
                {/* Filter pills */}
                {['all', 'gainers', 'losers'].map(mode => (
                  <button
                    key={mode}
                    className={`mhm-pill${filterMode === mode ? ' active' : ''}`}
                    onClick={() => setFilterMode(mode)}
                  >
                    {t(`heatmaps.${mode}`)}
                  </button>
                ))}
                <span className="mhm-pill-divider" />
                {/* Timeframes */}
                {/* Runners carry only a 24h change — show a locked 24H chip
                    instead of dead timeframe pills. */}
                {!isStocks && (isRunnersMode ? (
                  <button className="mhm-pill active" disabled>24H</button>
                ) : (
                  TIMEFRAMES.map(tf => (
                    <button
                      key={tf.id}
                      className={`mhm-pill${timeframe === tf.id ? ' active' : ''}`}
                      onClick={() => setTimeframe(tf.id)}
                    >
                      {tf.label}
                    </button>
                  ))
                ))}
                <span className="mhm-pill-divider" />
                {/* Token count */}
                {activeCounts.map(c => (
                  <button
                    key={c}
                    className={`mhm-pill${tokenCount === c ? ' active' : ''}`}
                    onClick={() => setTokenCount(c)}
                  >
                    {c}
                  </button>
                ))}
                <span className="mhm-pill-divider" />
                {/* Sort */}
                <button className={`mhm-pill${sortBy === 'market_cap' ? ' active' : ''}`} onClick={() => setSortBy('market_cap')}>{t('common.marketCap')}</button>
                <button className={`mhm-pill${sortBy === 'change' ? ' active' : ''}`} onClick={() => setSortBy('change')}>{t('heatmaps.change')}</button>
                <button className={`mhm-pill${sortBy === 'volume' ? ' active' : ''}`} onClick={() => setSortBy('volume')}>{t('common.volume')}</button>
                {isStocks && (
                  <button className={`mhm-pill${sortBy === 'sector' ? ' active' : ''}`} onClick={() => setSortBy('sector')}>{t('heatmaps.sector')}</button>
                )}
              </div>
            </div>

            {/* Category / threshold row */}
            <div className="mhm-controls">
              <div className="mhm-pills-row">
                {THRESHOLD_OPTIONS.map(thr => (
                  <button
                    key={thr}
                    className={`mhm-pill${minChangeThreshold === thr ? ' active' : ''}`}
                    onClick={() => setMinChangeThreshold(minChangeThreshold === thr ? null : thr)}
                  >
                    &gt;{thr}%
                  </button>
                ))}
                {!isStocks && (
                  <>
                    <span className="mhm-pill-divider" />
                    <button
                      className={`mhm-pill${!selectedCategory ? ' active' : ''}`}
                      onClick={() => setSelectedCategory(null)}
                    >
                      All
                    </button>
                    <button
                      className={`mhm-pill mhm-pill-runners${isRunnersMode ? ' active' : ''}`}
                      onClick={() => setSelectedCategory(isRunnersMode ? null : XDASH_RUNNERS_CATEGORY)}
                    >
                      𝕏 Runners
                    </button>
                    {categories.slice(0, 12).map(cat => (
                      <button
                        key={cat.id}
                        className={`mhm-pill${selectedCategory === cat.id ? ' active' : ''}`}
                        onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </>
                )}
                {activeFiltersCount > 0 && (
                  <button className="mhm-pill mhm-pill-clear" onClick={clearAllFilters}>
                    {t('common.clear')}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="mhm-section">
            <div className="mhm-search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="mhm-search-input"
                placeholder={isStocks ? t('heatmaps.searchStocks') : t('heatmaps.searchTokens')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="mhm-search-clear" onClick={() => setSearchQuery('')}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Heatmap visualization */}
          <div className="mhm-section-flush">
            {loading ? (
              <div className="mhm-loading">
                <div className="mhm-loading-shimmer" />
                <div className="mhm-loading-shimmer mhm-loading-shimmer-2" />
              </div>
            ) : error ? (
              <div className="mhm-error">
                <span>{error}</span>
                <button type="button" onClick={() => window.location.reload()}>{t('common.retry')}</button>
              </div>
            ) : heatmapTokens.length === 0 ? (
              <div className="mhm-empty">
                <span>{t('heatmaps.noMatch')}</span>
                <button className="mhm-pill active" onClick={clearAllFilters}>{t('common.clearFilters', 'Clear filters')}</button>
              </div>
            ) : viewMode === 'flows' ? (
              renderFlowsView(false)
            ) : viewMode === 'treemap' ? (
              <TreemapView
                tokens={heatmapTokens}
                getChange={getChange}
                fmtPrice={fmtPrice}
                dayMode={dayMode}
                isStocks={isStocks}
                isFullscreen={false}
                onTokenClick={handleTileClick}
                binancePrices={binancePrices}
                timeframe={timeframe}
              />
            ) : viewMode === 'chart' ? (
              renderChartView(false)
            ) : viewMode === 'dual' ? (
              renderDualView(false)
            ) : (
              renderHeatmapGrid(false)
            )}
          </div>

          {/* Pagination */}
          {needsPagination && totalPages > 1 && (
            <div className="mhm-section">
              <div className="mhm-pagination">
                <button className="mhm-page-btn" disabled={safeCurrentPage === 1} onClick={() => goToPage(safeCurrentPage - 1)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <span className="mhm-page-info">{safeCurrentPage} / {totalPages}</span>
                <button className="mhm-page-btn" disabled={safeCurrentPage === totalPages} onClick={() => goToPage(safeCurrentPage + 1)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Top movers */}
          {stats && stats.best && (
            <div className="mhm-section">
              <div className="mhm-movers">
                <div className="mhm-mover">
                  <span className="mhm-mover-label">{t('heatmaps.topGainer')}</span>
                  <span className="mhm-mover-token">
                    {stats.best.logo && <img src={stats.best.logo} alt="" loading="lazy" decoding="async" className="mhm-mover-logo" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
                    {stats.best.symbol}
                  </span>
                  <span className="mhm-mover-change pos">+{formatChange(getChange(stats.best))}%</span>
                </div>
                <div className="mhm-mover">
                  <span className="mhm-mover-label">{t('heatmaps.topLoser')}</span>
                  <span className="mhm-mover-token">
                    {stats.worst.logo && <img src={stats.worst.logo} alt="" loading="lazy" decoding="async" className="mhm-mover-logo" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
                    {stats.worst.symbol}
                  </span>
                  <span className="mhm-mover-change neg">{formatChange(getChange(stats.worst))}%</span>
                </div>
                <div className="mhm-mover">
                  <span className="mhm-mover-label">{isStocks ? t('common.volume') : t('common.volume24h')}</span>
                  <span className="mhm-mover-val">{fmtLarge(stats.totalVol)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="mhm-bottom-spacer" />
        </div>

        {/* Hover tooltip (portalled to body). Scalars come from the ref set at
            hover time — augmented token is built once here, not per tile. */}
        {hoveredToken && hoverPos && (
          <TreemapTooltip
            token={{ ...hoveredToken, _livePrice: hoverScalarsRef.current.livePrice, _change: hoverScalarsRef.current.change }}
            position={hoverPos}
            getChange={(t) => t._change != null ? t._change : getChange(t)}
            fmtPrice={(p) => fmtPrice(p)}
            isStocks={isStocks}
            dayMode={dayMode}
          />
        )}
      </div>
    )
  }

  /* ════════════════════════════════════════════════════════
     DESKTOP RENDER
     ════════════════════════════════════════════════════════ */
  return (
    <div className={`heatmaps-page ${dayMode ? 'day-mode' : ''} ${isStocks ? 'stocks-mode' : ''}`}>
      {/* Hero */}
      <div className={`heatmaps-hero${stats ? ` bias-${stats.sentiment}` : ''}`}>
        <div className="heatmaps-hero-inner">
          <div className="heatmaps-hero-left">
            <h1 className="heatmaps-title">
              {isStocks ? t('heatmaps.stockHeatmap') : t('heatmaps.cryptoHeatmap')}
              <FreshnessTag timestamp={lastUpdated} tier="hot" />
              <InfoTip text="Visual map of market performance. Each tile represents an asset sized by market cap. Color intensity shows price change — green for gains, red for losses. Larger tiles = larger market cap." position="right" />
            </h1>
            <p className="heatmaps-subtitle">
              {isStocks
                ? t('heatmaps.subtitleStocks', { count: tokenCount, unit: t('heatmaps.stocks'), metric: t('heatmaps.marketCapSize'), tf: tfLabel })
                : activeFiltersCount > 0
                  ? t('heatmaps.subtitleFiltered', { shown: filteredTokens.length, total: allTokens.length, unit: t('heatmaps.tokens'), tf: tfLabel })
                  : t('heatmaps.subtitleAll', { count: allTokens.length, unit: t('heatmaps.tokens'), metric: t('heatmaps.marketCapSize'), tf: tfLabel, perPage: tokenCount })
              }
            </p>
          </div>
          {liquidityPulse && (
            <LiquidityPulse
              netFlow={liquidityPulse.net}
              timeframeLabel={tfLabel}
              coverageLabel={liquidityPulse.coverageLabel}
              fmtLarge={fmtLarge}
              dayMode={dayMode}
            />
          )}
          {stats && (
            <div className="heatmaps-hero-stats">
              <div className={`heatmaps-sentiment-badge bias-${stats.sentiment}`}>
                <span className="heatmaps-sentiment-dot" />
                {t(`heatmaps.${stats.sentiment}`, { defaultValue: stats.sentiment.toUpperCase() })}
                <InfoTip text="Overall market bias based on the ratio of gainers to losers. Bullish = more gainers, Bearish = more losers, Neutral = roughly balanced." position="bottom" />
              </div>
              <div className="heatmaps-hero-stat">
                <span className="heatmaps-hero-stat-val">{fmtLarge(primarySizeMetric.value)}</span>
                <span className="heatmaps-hero-stat-lbl">{primarySizeMetric.label}<InfoTip text={primarySizeMetric.tip} position="bottom" /></span>
              </div>
              <div className="heatmaps-hero-stat">
                <span className={`heatmaps-hero-stat-val ${stats.avgChange >= 0 ? 'val-green' : 'val-red'}`}>
                  {stats.avgChange >= 0 ? '+' : ''}{stats.avgChange.toFixed(2)}%
                </span>
                <span className="heatmaps-hero-stat-lbl">{t('heatmaps.avg')} {tfLabel}<InfoTip text="Mean price change across all displayed assets for the selected timeframe. Positive = market trending up on average, negative = trending down." position="bottom" /></span>
              </div>
              <div className="heatmaps-hero-stat">
                <span className="heatmaps-hero-stat-val val-green">{stats.gains}</span>
                <span className="heatmaps-hero-stat-lbl">{t('common.gainers')}<InfoTip text="Number of assets with a positive price change in the selected timeframe." position="bottom" /></span>
              </div>
              <div className="heatmaps-hero-stat">
                <span className="heatmaps-hero-stat-val val-red">{stats.losses}</span>
                <span className="heatmaps-hero-stat-lbl">{t('common.losers')}<InfoTip text="Number of assets with a negative price change in the selected timeframe." position="bottom" /></span>
              </div>
            </div>
          )}
        </div>

        {/* Market breadth bar */}
        {stats && (
          <div className="heatmaps-breadth">
            <div className="heatmaps-breadth-bar">
              <div className="heatmaps-breadth-fill" style={{ width: `${stats.breadth}%` }} />
            </div>
            <div className="heatmaps-breadth-labels">
              <span className="heatmaps-breadth-label green">{stats.breadth.toFixed(0)}% {t('common.gainers').toLowerCase()}</span>
              <InfoTip text="Market breadth — the percentage split between gainers and losers. Breadth above 60% signals strong bullish participation; below 40% signals widespread selling." position="bottom" />
              <span className="heatmaps-breadth-label red">{(100 - stats.breadth).toFixed(0)}% {t('common.losers').toLowerCase()}</span>
            </div>
          </div>
        )}
      </div>

      {/* Toolbar — search + filters + timeframe/tokens/sort + view controls, one panel */}
      <div className="heatmaps-toolbar">
        <div className="heatmaps-search-wrapper">
          <svg className="heatmaps-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="heatmaps-search-input"
            placeholder={isStocks ? t('heatmaps.searchStocks') : t('heatmaps.searchTokens')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="heatmaps-search-clear" onClick={() => setSearchQuery('')}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="heatmaps-toolbar-groups">
          <div className="heatmaps-filter-group">
            <div className="heatmaps-pills">
              {['all', 'gainers', 'losers'].map(mode => (
                <button
                  key={mode}
                  className={`heatmaps-pill ${filterMode === mode ? 'active' : ''} ${mode === 'gainers' ? 'pill-green' : mode === 'losers' ? 'pill-red' : ''}`}
                  onClick={() => setFilterMode(mode)}
                >
                  {t(`heatmaps.${mode}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="heatmaps-filter-group">
            <span className="heatmaps-pill-label">{t('heatmaps.min')}</span>
            <div className="heatmaps-pills">
              {THRESHOLD_OPTIONS.map(thr => (
                <button
                  key={thr}
                  className={`heatmaps-pill ${minChangeThreshold === thr ? 'active' : ''}`}
                  onClick={() => setMinChangeThreshold(minChangeThreshold === thr ? null : thr)}
                >
                  &gt;{thr}%
                </button>
              ))}
            </div>
          </div>

          {/* Category dropdown (crypto only) */}
          {!isStocks && (
            <div className="heatmaps-category-dropdown" ref={categoryDropdownRef}>
              <button
                className={`heatmaps-pill heatmaps-category-trigger ${selectedCategory ? 'active' : ''}`}
                onClick={() => setCategoryDropdownOpen(o => !o)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                </svg>
                {selectedCategoryName || t('heatmaps.category')}
                <svg className="heatmaps-category-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: categoryDropdownOpen ? 'rotate(180deg)' : 'none' }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {categoryDropdownOpen && (
                <div className="heatmaps-category-list">
                  <button
                    className={`heatmaps-category-item ${!selectedCategory ? 'active' : ''}`}
                    onClick={() => { setSelectedCategory(null); setCategoryDropdownOpen(false) }}
                  >
                    {t('heatmaps.allCategories')}
                  </button>
                  <button
                    className={`heatmaps-category-item ${isRunnersMode ? 'active' : ''}`}
                    onClick={() => { setSelectedCategory(XDASH_RUNNERS_CATEGORY); setCategoryDropdownOpen(false) }}
                  >
                    <span className="heatmaps-category-name">𝕏 {t('heatmaps.xRunners', 'X Runners')}</span>
                  </button>
                  {categories.map(cat => (
                    <button
                      key={cat.id}
                      className={`heatmaps-category-item ${selectedCategory === cat.id ? 'active' : ''}`}
                      onClick={() => { setSelectedCategory(cat.id); setCategoryDropdownOpen(false) }}
                    >
                      <span className="heatmaps-category-name">{cat.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <span className="heatmaps-toolbar-divider" aria-hidden="true" />

          {!isStocks && (
            <div className="heatmaps-pill-group">
              <span className="heatmaps-pill-label">{t('heatmaps.timeframe')}<InfoTip text="Time window for price change. 1H = last hour, 24H = last day, 7D = last week, 30D = last month. Longer timeframes smooth out noise and show broader trends." position="bottom" /></span>
              <div className="heatmaps-pills">
                {isRunnersMode ? (
                  <button className="heatmaps-pill active" disabled>24H</button>
                ) : (
                  TIMEFRAMES.map(tf => (
                    <button
                      key={tf.id}
                      className={`heatmaps-pill ${timeframe === tf.id ? 'active' : ''}`}
                      onClick={() => setTimeframe(tf.id)}
                    >
                      {tf.label}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="heatmaps-pill-group">
            <span className="heatmaps-pill-label">{isStocks ? t('nav.stocks') : t('common.tokens')}</span>
            <div className="heatmaps-pills">
              {activeCounts.map(c => (
                <button
                  key={c}
                  className={`heatmaps-pill ${tokenCount === c ? 'active' : ''}`}
                  onClick={() => setTokenCount(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="heatmaps-pill-group">
            <span className="heatmaps-pill-label">{t('heatmaps.sort')}<InfoTip text="Order tiles by market cap (default — largest first), by price change magnitude, or by trading volume. Sector sort groups stocks by industry." position="bottom" /></span>
            <div className="heatmaps-pills">
              <button className={`heatmaps-pill ${sortBy === 'market_cap' ? 'active' : ''}`} onClick={() => setSortBy('market_cap')}>{t('common.marketCap')}</button>
              <button className={`heatmaps-pill ${sortBy === 'change' ? 'active' : ''}`} onClick={() => setSortBy('change')}>{t('heatmaps.change')}</button>
              <button className={`heatmaps-pill ${sortBy === 'volume' ? 'active' : ''}`} onClick={() => setSortBy('volume')}>{t('common.volume')}</button>
              {isStocks && (
                <button className={`heatmaps-pill ${sortBy === 'sector' ? 'active' : ''}`} onClick={() => setSortBy('sector')}>{t('heatmaps.sector')}</button>
              )}
            </div>
          </div>

          {activeFiltersCount > 0 && (
            <button className="heatmaps-clear-filters" onClick={clearAllFilters}>
              {t('heatmaps.clearFilters')}
            </button>
          )}
        </div>

        <div className="heatmaps-controls-right">
          {/* View mode toggle */}
          <div className="heatmaps-view-toggle">
            <button
              className={`heatmaps-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title={t('heatmaps.gridView')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
              </svg>
            </button>
            <button
              className={`heatmaps-view-btn ${viewMode === 'treemap' ? 'active' : ''}`}
              onClick={() => setViewMode('treemap')}
              title={t('heatmaps.treemapView')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="10" height="10" /><rect x="15" y="3" width="6" height="6" /><rect x="15" y="11" width="6" height="4" /><rect x="3" y="15" width="7" height="6" /><rect x="12" y="17" width="9" height="4" />
              </svg>
            </button>
            <button
              className={`heatmaps-view-btn ${viewMode === 'chart' ? 'active' : ''}`}
              onClick={() => setViewMode('chart')}
              title={t('heatmaps.barChartView')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            </button>
            <button
              className={`heatmaps-view-btn ${viewMode === 'dual' ? 'active' : ''}`}
              onClick={() => setViewMode('dual')}
              title={t('heatmaps.dualView')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="8" height="18" rx="1" /><rect x="13" y="3" width="8" height="18" rx="1" />
              </svg>
            </button>
            <button
              className={`heatmaps-view-btn ${viewMode === 'flows' ? 'active' : ''}`}
              onClick={() => setViewMode('flows')}
              title={t('heatmaps.flowsView', 'Money Flow')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" />
              </svg>
            </button>
          </div>

          {/* Color scale legend */}
          <div className="heatmaps-legend">
            <span className="heatmaps-legend-label">-10%</span>
            <div className="heatmaps-legend-gradient" />
            <span className="heatmaps-legend-label">+10%</span>
            <InfoTip text="Color scale mapping price change to tile color. Deep red = -10% or worse, deep green = +10% or better. Neutral gray = near 0% change. Colors are clamped at ±10%." position="left" />
          </div>
          <ShareXButton onClick={handleShareHeatmap} isExporting={isHeatmapShareExporting} compact />
          {fullscreenBtn}
        </div>
      </div>

      {/* Result count */}
      {!loading && !error && (
        <div className="heatmaps-result-count" ref={gridTopRef}>
          {(() => {
            const unit = isStocks ? t('heatmaps.stocks') : t('heatmaps.tokens')
            if (needsPagination) {
              return t('heatmaps.showingRange', { start: showingStart, end: showingEnd, total: filteredTokens.length, unit })
            }
            if (activeFiltersCount > 0) {
              return t('heatmaps.filteredOf', { shown: filteredTokens.length, total: allTokens.length, unit })
            }
            return `${filteredTokens.length} ${unit}`
          })()}
        </div>
      )}

      {/* Floating chart window — portaled to body (unpinned) */}
      {chartToken && !loading && !error && !chartPinned && (
        <Suspense fallback={null}>
          <FloatingChartWindow
            token={chartToken}
            compareTokens={compareTokens}
            compareMode={compareMode}
            onToggleCompare={handleToggleCompare}
            onRemoveCompareToken={handleRemoveCompareToken}
            dayMode={dayMode}
            livePrice={getLivePrice(chartToken)}
            liveChange={getLiveChange(chartToken)}
            fmtPrice={fmtPrice}
            pinned={false}
            onTogglePinned={() => setChartPinned(true)}
            onClose={() => { setChartToken(null); setCompareMode(false); setCompareTokens([]); setChartPinned(true) }}
            onViewToken={(onTokenClick || onOpenScreener) ? handleGoToToken : null}
            onCompareViewToken={onTokenClick || null}
          />
        </Suspense>
      )}

      {/* Pinned chart — inline above heatmap */}
      {chartToken && !loading && !error && chartPinned && (
        <Suspense fallback={null}>
          <FloatingChartWindow
            token={chartToken}
            compareTokens={compareTokens}
            compareMode={compareMode}
            onToggleCompare={handleToggleCompare}
            onRemoveCompareToken={handleRemoveCompareToken}
            dayMode={dayMode}
            livePrice={getLivePrice(chartToken)}
            liveChange={getLiveChange(chartToken)}
            fmtPrice={fmtPrice}
            pinned={true}
            onTogglePinned={() => setChartPinned(false)}
            onClose={() => { setChartToken(null); setCompareMode(false); setCompareTokens([]); setChartPinned(true) }}
            onViewToken={(onTokenClick || onOpenScreener) ? handleGoToToken : null}
            onCompareViewToken={onTokenClick || null}
          />
        </Suspense>
      )}

      {/* Heatmap */}
      {loading ? (
        <div className="heatmaps-loading">
          <div className="heatmaps-loading-spinner" />
          <span>{t('common.loading')}</span>
        </div>
      ) : error ? (
        <div className="heatmaps-error">
          <span>{error}</span>
          <button type="button" onClick={() => window.location.reload()}>{t('common.retry')}</button>
        </div>
      ) : (
        <div className={`heatmaps-grid-container${viewMode === 'treemap' ? ' heatmaps-grid-container--treemap' : ''}`} ref={containerRef}>
          {heatmapTokens.length === 0 ? (
            <div className="heatmaps-empty">
              {globalSearchResults.length > 0 ? (
                <div className="heatmaps-search-results">
                  <div className="hsr-head">
                    <span className="hsr-title">Not in the top {allTokens.length} by market cap</span>
                    <span className="hsr-sub">Open “{searchQuery.trim()}” in Research Zone</span>
                  </div>
                  <div className="hsr-list">
                    {globalSearchResults.map((r) => (
                      <button
                        key={r.id || r.symbol}
                        type="button"
                        className="hsr-item"
                        onClick={() => onTokenClick?.({ cgId: r.id, id: r.id, symbol: r.symbol, name: r.name, logo: r.large || r.thumb })}
                      >
                        {(r.large || r.thumb) && <img className="hsr-logo" src={r.large || r.thumb} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />}
                        <span className="hsr-sym">{r.symbol}</span>
                        <span className="hsr-name">{r.name}</span>
                        {Number.isFinite(r.rank) && <span className="hsr-rank">#{r.rank}</span>}
                        <svg className="hsr-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H7M17 7v10" /></svg>
                      </button>
                    ))}
                  </div>
                  <button className="heatmaps-clear-filters" onClick={clearAllFilters}>{t('common.clearFilters', 'Clear filters')}</button>
                </div>
              ) : (
                <>
                  <span>{t('heatmaps.noMatch')}</span>
                  <button className="heatmaps-clear-filters" onClick={clearAllFilters}>{t('common.clearFilters', 'Clear filters')}</button>
                </>
              )}
            </div>
          ) : viewMode === 'flows' ? (
            renderFlowsView(false)
          ) : viewMode === 'treemap' ? (
            <TreemapView
              tokens={heatmapTokens}
              getChange={getChange}
              fmtPrice={fmtPrice}
              dayMode={dayMode}
              isStocks={isStocks}
              isFullscreen={false}
              onTokenClick={handleTileClick}
              binancePrices={binancePrices}
              timeframe={timeframe}
            />
          ) : viewMode === 'chart' ? (
            renderChartView(false)
          ) : viewMode === 'dual' ? (
            renderDualView(false)
          ) : (
            renderHeatmapGrid(false)
          )}
        </div>
      )}

      {/* Pagination */}
      {needsPagination && totalPages > 1 && (
        <div className="heatmaps-pagination">
          <button className="heatmaps-page-btn heatmaps-page-nav" disabled={safeCurrentPage === 1} onClick={() => goToPage(1)} title={t('heatmaps.firstPage')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" />
            </svg>
          </button>
          <button className="heatmaps-page-btn heatmaps-page-nav" disabled={safeCurrentPage === 1} onClick={() => goToPage(safeCurrentPage - 1)} title={t('heatmaps.previous')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          {getPageNumbers().map((page, i) =>
            page === '...' ? (
              <span key={`ellipsis-${i}`} className="heatmaps-page-ellipsis">...</span>
            ) : (
              <button
                key={page}
                className={`heatmaps-page-btn heatmaps-page-num ${page === safeCurrentPage ? 'active' : ''}`}
                onClick={() => goToPage(page)}
              >
                {page}
              </button>
            )
          )}

          <button className="heatmaps-page-btn heatmaps-page-nav" disabled={safeCurrentPage === totalPages} onClick={() => goToPage(safeCurrentPage + 1)} title={t('heatmaps.next')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button className="heatmaps-page-btn heatmaps-page-nav" disabled={safeCurrentPage === totalPages} onClick={() => goToPage(totalPages)} title={t('heatmaps.lastPage')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" />
            </svg>
          </button>
        </div>
      )}

      {/* Top movers strip */}
      {stats && stats.best && (
        <div className="heatmaps-movers">
          <div className="heatmaps-mover-item">
            <span className="heatmaps-mover-label">{t('heatmaps.topGainer')}<InfoTip text="The single best-performing asset in the current view for the selected timeframe." position="top" /></span>
            <span className="heatmaps-mover-token">
              {stats.best.logo && <img src={stats.best.logo} alt="" loading="lazy" decoding="async" className={`heatmaps-mover-logo ${isStocks ? 'heatmaps-mover-logo--stock' : ''}`} />}
              {stats.best.symbol}
            </span>
            <span className="heatmaps-mover-change pos">+{formatChange(getChange(stats.best))}%</span>
          </div>
          <div className="heatmaps-movers-divider" />
          <div className="heatmaps-mover-item">
            <span className="heatmaps-mover-label">{t('heatmaps.topLoser')}<InfoTip text="The single worst-performing asset in the current view for the selected timeframe." position="top" /></span>
            <span className="heatmaps-mover-token">
              {stats.worst.logo && <img src={stats.worst.logo} alt="" loading="lazy" decoding="async" className={`heatmaps-mover-logo ${isStocks ? 'heatmaps-mover-logo--stock' : ''}`} />}
              {stats.worst.symbol}
            </span>
            <span className="heatmaps-mover-change neg">{formatChange(getChange(stats.worst))}%</span>
          </div>
          <div className="heatmaps-movers-divider" />
          <div className="heatmaps-mover-item">
            <span className="heatmaps-mover-label">{isStocks ? t('common.volume') : t('common.volume24h')}<InfoTip text="Total combined trading volume across all displayed assets. High volume confirms price trends; low volume may signal weak moves." position="top" /></span>
            <span className="heatmaps-mover-val">{fmtLarge(stats.totalVol)}</span>
          </div>
          <div className="heatmaps-movers-divider" />
          <div className="heatmaps-mover-item">
            <span className="heatmaps-mover-label">{t('heatmaps.breadth')}<InfoTip text="Percentage of assets in positive territory. Above 50% = majority gaining. A useful quick-read of how many assets are participating in the move." position="top" /></span>
            <span className={`heatmaps-mover-val ${stats.breadth >= 50 ? 'val-green' : 'val-red'}`}>{stats.breadth.toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* Hover tooltip (portalled to body). Scalars come from the ref set at
          hover time — augmented token is built once here, not per tile. */}
      {hoveredToken && hoverPos && (
        <TreemapTooltip
          token={{ ...hoveredToken, _livePrice: hoverScalarsRef.current.livePrice, _change: hoverScalarsRef.current.change }}
          position={hoverPos}
          getChange={(t) => t._change != null ? t._change : getChange(t)}
          fmtPrice={(p) => fmtPrice(p)}
          isStocks={isStocks}
          dayMode={dayMode}
        />
      )}

      {/* Fullscreen portal */}
      {fullscreen && createPortal(
        <div className="heatmaps-fullscreen-overlay" onClick={() => setFullscreen(false)}>
          <div className={`heatmaps-fullscreen-container ${dayMode ? 'day-mode' : ''} ${isStocks ? 'stocks-mode' : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className="heatmaps-fullscreen-toolbar">
              <span className="heatmaps-fullscreen-title">
                Spectre {isStocks ? t('heatmaps.stockHeatmap') : t('heatmaps.cryptoHeatmap')} {'\u00B7'} {isStocks ? '' : `${t('heatmaps.top')} `}{tokenCount}
              </span>
              <div className="heatmaps-fullscreen-controls">
                {!isStocks && (isRunnersMode ? (
                  <button className="heatmaps-pill active" disabled>24H</button>
                ) : TIMEFRAMES.map(tf => (
                  <button
                    key={tf.id}
                    className={`heatmaps-pill ${timeframe === tf.id ? 'active' : ''}`}
                    onClick={() => setTimeframe(tf.id)}
                  >
                    {tf.label}
                  </button>
                )))}
                {!isStocks && <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.06)', margin: '0 4px' }} />}
                {activeCounts.map(c => (
                  <button
                    key={c}
                    className={`heatmaps-pill ${tokenCount === c ? 'active' : ''}`}
                    onClick={() => setTokenCount(c)}
                  >
                    {c}
                  </button>
                ))}
                <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.06)', margin: '0 4px' }} />
                <div className="heatmaps-view-toggle">
                  <button className={`heatmaps-view-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')} title={t('heatmaps.gridView')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
                  </button>
                  <button className={`heatmaps-view-btn ${viewMode === 'treemap' ? 'active' : ''}`} onClick={() => setViewMode('treemap')} title={t('heatmaps.treemapView')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="10" height="10" /><rect x="15" y="3" width="6" height="6" /><rect x="15" y="11" width="6" height="4" /><rect x="3" y="15" width="7" height="6" /><rect x="12" y="17" width="9" height="4" /></svg>
                  </button>
                  <button className={`heatmaps-view-btn ${viewMode === 'chart' ? 'active' : ''}`} onClick={() => setViewMode('chart')} title={t('heatmaps.barChartView')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
                  </button>
                  <button className={`heatmaps-view-btn ${viewMode === 'dual' ? 'active' : ''}`} onClick={() => setViewMode('dual')} title={t('heatmaps.dualView')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="8" height="18" rx="1" /><rect x="13" y="3" width="8" height="18" rx="1" /></svg>
                  </button>
                  <button className={`heatmaps-view-btn ${viewMode === 'flows' ? 'active' : ''}`} onClick={() => setViewMode('flows')} title={t('heatmaps.flowsView', 'Money Flow')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>
                  </button>
                </div>
                {fullscreenBtn}
              </div>
            </div>
            {viewMode === 'flows' ? (
              renderFlowsView(true)
            ) : viewMode === 'treemap' ? (
              <TreemapView
                tokens={heatmapTokens}
                getChange={getChange}
                fmtPrice={fmtPrice}
                dayMode={dayMode}
                isStocks={isStocks}
                isFullscreen={true}
                onTokenClick={handleTileClick}
                binancePrices={binancePrices}
                timeframe={timeframe}
              />
            ) : viewMode === 'chart' ? (
              renderChartView(true)
            ) : viewMode === 'dual' ? (
              renderDualView(true)
            ) : (
              renderHeatmapGrid(true)
            )}
          </div>
        </div>,
        document.body
      )}
      {heatShareModalOpen && (
        <Suspense fallback={null}>
          <ShareXModal
            open={heatShareModalOpen}
            onClose={() => { setHeatShareModalOpen(false); setHeatShareImageUrl(null) }}
            imageUrl={heatShareImageUrl}
            defaultDescription={heatShareDescription}
            filename={`spectre_heatmap_${tfLabel.toLowerCase()}.png`}
          />
        </Suspense>
      )}
    </div>
  )
}

export default HeatmapsPage
