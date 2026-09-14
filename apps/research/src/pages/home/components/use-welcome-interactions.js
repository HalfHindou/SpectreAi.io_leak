import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { track, Events } from '@/services/analytics'
import { resolveTradingViewSymbol } from '@/lib/tradingViewSymbols'
import { isStockAsset } from '@/lib/asset-identity'
import { buildWelcomeChartToken } from './welcome-chart-token'
import { getStockLogo } from '@/constants/stockData'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import { TOP_COINS, TOKEN_LOGOS } from './welcome-page-constants'

export default function useWelcomeInteractions({
  topCoinPrices,
  stockPrices,
  heatmapTokens,
  topCoinsTokens,
  isStocks,
  selectToken,
  onOpenResearchZone,
  onOpenAIScreener,
  addToWatchlist,
  isInWatchlist,
  watchlist,
  tabsOn,
  setTabsOn,
  binancePrices,
  t,
}) {
  const isMobile = useIsMobile()

  // Compare functionality
  const [compareMode, setCompareMode] = useState(false)
  const [compareTokens, setCompareTokens] = useState([])
  const [showCompareModal, setShowCompareModal] = useState(false)

  const toggleCompareToken = (token, e) => {
    e.stopPropagation()
    setCompareTokens(prev => {
      const exists = prev.find(t => t.address === token.address)
      if (exists) return prev.filter(t => t.address !== token.address)
      if (prev.length >= 4) return prev
      return [...prev, token]
    })
  }

  const isTokenSelected = (address) => compareTokens.some(t => t.address === address)
  const openCompareModal = () => { if (compareTokens.length >= 2) setShowCompareModal(true) }
  const closeCompareModal = () => setShowCompareModal(false)
  const exitCompareMode = () => { setCompareMode(false); setCompareTokens([]); setShowCompareModal(false) }

  // Tabs ON/OFF module
  const [activeDiscoverTab, setActiveDiscoverTab] = useState('discover')
  const [openTokenTabs, setOpenTokenTabs] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem('spectre_open_tabs'))
      if (!Array.isArray(v)) return []
      // Migrate: drop legacy entries that lack address/networkId AND aren't a known
      // major coin. These can't restore an on-chain chart and would render an empty
      // panel when re-clicked. Top coins (BTC/ETH/...) survive — their address is
      // re-derived from TOP_COINS at click time.
      return v.filter((t) => {
        if (!t || typeof t === 'string') return false
        if (!t.symbol) return false
        if (isStockAsset(t) || (t.address && t.networkId)) return true
        return TOP_COINS.some((c) => c.symbol === t.symbol)
      })
    } catch { return [] }
  })

  const addTokenTab = (token) => {
    const sym = token.symbol || token
    const name = typeof token === 'string' ? (TOP_COINS.find((c) => c.symbol === sym)?.name || sym) : (token.name || sym)
    // Persist full payload (address/networkId/logo/price) so re-opening
    // the tab restores the on-chain chart instead of falling back to an
    // empty SpectreChart with no metadata.
    const fullPayload = typeof token === 'string'
      ? { symbol: sym, name }
      : {
          symbol: sym,
          name,
          address: token.address || null,
          networkId: token.networkId ?? null,
          logo: token.logo || null,
          price: token.price ?? null,
          change: token.change ?? null,
          change24h: token.change24h ?? null,
          isStock: isStockAsset(token),
          exchange: token.exchange || null,
          sector: token.sector || null,
          type: token.type || null,
          assetClass: token.assetClass || null,
        }
    setOpenTokenTabs((prev) => {
      const idx = prev.findIndex((t) => (t.symbol || t).toUpperCase() === (sym || '').toUpperCase())
      if (idx >= 0) {
        // Refresh existing tab with latest data (price ticks, etc.)
        const next = prev.slice()
        next[idx] = { ...prev[idx], ...fullPayload }
        return next
      }
      return [...prev, fullPayload].slice(-5)
    })
    setActiveDiscoverTab(sym)
  }

  const removeTokenTab = (symbol) => {
    const nextTabs = openTokenTabs.filter((t) => (t.symbol || t) !== symbol)
    setOpenTokenTabs(nextTabs)
    if (activeDiscoverTab === symbol) {
      const fallback = nextTabs[nextTabs.length - 1]?.symbol || 'discover'
      setActiveDiscoverTab(fallback)
      if (fallback === 'discover') setChartPanelToken(null)
    }
  }

  const clearAllTabs = () => {
    setOpenTokenTabs([])
    setActiveDiscoverTab('discover')
    setChartPanelToken(null)
  }

  // Persist tabs state to localStorage
  useEffect(() => { try { localStorage.setItem('spectre_open_tabs', JSON.stringify(openTokenTabs)) } catch {} }, [openTokenTabs])

  // Chart pull-up overlay panel
  const [chartPanelToken, setChartPanelToken] = useState(null)
  const [chartOverlayTimeframe, setChartOverlayTimeframe] = useState('1m')
  const [chartOverlaySubTab, setChartOverlaySubTab] = useState('candles')
  const [chartOverlayYAxis, setChartOverlayYAxis] = useState('price')
  const [chartFullscreen, setChartFullscreen] = useState(false)

  const OVERLAY_TIMEFRAMES = [
    { id: '1m', label: '1m' },
    { id: '30m', label: '30m' },
    { id: '1h', label: '1h' },
    { id: '1d', label: '1d' },
    { id: 'all', label: t('topSection.allTime') },
    { id: '24h', label: '24h' },
    { id: '1w', label: '1w' },
    { id: '7d', label: '7d' },
    { id: '30d', label: '30d' },
  ]

  // ESC key to exit chart fullscreen
  useEffect(() => {
    if (!chartFullscreen) return
    const handleEsc = (e) => { if (e.key === 'Escape') setChartFullscreen(false) }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [chartFullscreen])

  // Reset fullscreen when chart panel closes
  useEffect(() => {
    if (!chartPanelToken) setChartFullscreen(false)
  }, [chartPanelToken])

  // 3-card popup: History | Live | Predictions
  const [tokenCardPopup, setTokenCardPopup] = useState(null)
  const [tokenCardExpandedCard, setTokenCardExpandedCard] = useState(null)

  const openChartOnly = (token) => {
    if (!token?.symbol) return
    const data = topCoinPrices?.[token.symbol] ?? topCoinPrices?.[token.symbol?.toUpperCase?.()]
    const payload = buildWelcomeChartToken(token, data, TOKEN_LOGOS[token.symbol])
    setChartPanelToken(payload)
    setChartOverlayTimeframe('1m')
    setChartOverlaySubTab('candles')
    addTokenTab(payload)
    setActiveDiscoverTab(payload.symbol)
  }

  // On-Chain row click handler
  const buildOnChainTokenPayload = (row) => {
    const coin = TOP_COINS.find((c) => c.symbol === row.symbol)
    return {
      symbol: row.symbol,
      name: row.name || row.symbol,
      address: row.address || coin?.address || null,
      networkId: row.networkId ?? coin?.networkId ?? 1,
      // Canonical CoinGecko id so cgId-only rows (Social tab majors like
      // JUP/INJ/ALGO that arrive with no contract address) still resolve in the
      // AI Screener. On-chain DEX rows resolve by address and won't carry this.
      cgId: row.cgId || row.coingecko_id || SYMBOL_TO_COINGECKO_ID[row.symbol?.toUpperCase?.()] || null,
      price: row.price,
      change: row.change24h ?? 0,
      // Prefer the actual Codex-provided logo for the row over the static
      // TOKEN_LOGOS map. Multiple tokens share the same symbol (e.g. LAB) and
      // the static map can't disambiguate them; row.logo is per-address.
      logo: row.logo || TOKEN_LOGOS[row.symbol] || null,
    }
  }

  const handleOnChainCoinClick = (row) => {
    const payload = buildOnChainTokenPayload(row)
    // On-chain tokens open the AI Screener (deep-links to the token by address).
    // These are DEX-native tokens with a contract address — the Screener is the
    // right surface, not the inline chart. Same behaviour on desktop + mobile.
    if (onOpenAIScreener) {
      onOpenAIScreener(payload)
      return
    }
    // Fallback (no screener nav wired): inline screener panel.
    if (!tabsOn) setTabsOn(true)
    setChartPanelToken(payload)
    setChartOverlayTimeframe('1m')
    setChartOverlaySubTab('screener')
    addTokenTab(payload)
    setActiveDiscoverTab(payload.symbol)
  }

  const handleTopCoinClick = (token) => {
    if (!token?.symbol) return
    const data = topCoinPrices?.[token.symbol] ?? topCoinPrices?.[token.symbol?.toUpperCase?.()]
    const payload = {
      symbol: token.symbol,
      name: token.name || token.symbol,
      address: token.address,
      networkId: token.networkId,
      // Canonical CoinGecko id - the RZ router prefers it for the slug and the
      // RZ identity seed needs it to beat same-ticker collisions (TSLA the
      // Robinhood tokenized stock vs a TSLA6900 memecoin; CASHCAT vs clones).
      // Spectre-bridge rows can arrive without an id - for majors, fall back
      // to the static symbol map so identity survives that path too.
      cgId: token.cgId || token.id || SYMBOL_TO_COINGECKO_ID[token.symbol?.toUpperCase?.()] || null,
      price: token.price,
      change: token.change,
      logo: token.logo || TOKEN_LOGOS[token.symbol],
      sparkline_7d: token.sparkline_7d ?? data?.sparkline_7d ?? null,
    }
    if ((isMobile || !tabsOn) && onOpenResearchZone) {
      onOpenResearchZone(payload)
      return
    }
    openChartOnly(token)
  }

  const handleStockClick = (stock) => {
    if (!stock?.symbol) return
    const data = stockPrices?.[stock.symbol]
    const payload = {
      symbol: stock.symbol,
      name: stock.name || stock.symbol,
      price: data?.price || stock.price || 0,
      change: data?.change || stock.change || 0,
      logo: getStockLogo(stock.symbol, stock.sector),
      type: 'stock',
      isStock: true,
      sector: stock.sector || data?.sector,
      exchange: stock.exchange || data?.exchange,
      marketCap: data?.marketCap,
      pe: data?.pe,
    }
    if (onOpenResearchZone) {
      onOpenResearchZone(payload)
    }
  }

  const openTokenCardPopup = (tokenOrSymbol, overlayOnly = false) => {
    let payload = null
    if (typeof tokenOrSymbol === 'string') {
      const symbol = (tokenOrSymbol && String(tokenOrSymbol).toUpperCase()) || tokenOrSymbol
      const coin = TOP_COINS.find((c) => c.symbol === symbol)
      const data = topCoinPrices?.[symbol] ?? topCoinPrices?.[symbol?.toUpperCase?.()]
      const heatmapCoin = heatmapTokens?.find((t) => t.symbol === symbol)
      const topCoin = topCoinsTokens?.find((t) => t.symbol === symbol)
      // Watchlist fallback for low-cap tokens not in TOP_COINS / heatmap / topCoins lists
      const wl = watchlist?.find?.((w) => w?.symbol === symbol || w?.symbol?.toUpperCase?.() === symbol)
      payload = {
        symbol,
        name: coin?.name || heatmapCoin?.name || topCoin?.name || wl?.name || symbol,
        address: coin?.address || wl?.address,
        networkId: coin?.networkId || wl?.networkId,
        price: (data?.price > 0) ? Number(data.price) : (heatmapCoin?.price > 0 ? Number(heatmapCoin.price) : (topCoin?.price > 0 ? Number(topCoin.price) : (wl?.price > 0 ? Number(wl.price) : null))),
        change: (data?.price > 0 && data?.change != null) ? Number(data.change) : (data?.change24 != null ? Number(data.change24) : (heatmapCoin?.change != null ? Number(heatmapCoin.change) : (topCoin?.change != null ? Number(topCoin.change) : (wl?.change != null ? Number(wl.change) : null)))),
        logo: TOKEN_LOGOS[symbol] ?? TOKEN_LOGOS[symbol?.toUpperCase?.()] ?? data?.logo ?? heatmapCoin?.logo ?? topCoin?.logo ?? wl?.logo ?? null,
        sparkline_7d: data?.sparkline_7d?.length > 0 ? data.sparkline_7d : (topCoin?.sparkline_7d?.length > 0 ? topCoin.sparkline_7d : (heatmapCoin?.sparkline_7d?.length > 0 ? heatmapCoin.sparkline_7d : (wl?.sparkline_7d?.length > 0 ? wl.sparkline_7d : null))),
        change1h: data?.change1h ?? topCoin?.change1h ?? heatmapCoin?.change1h ?? wl?.change1h ?? null,
        change7d: data?.change7d ?? topCoin?.change7d ?? heatmapCoin?.change7d ?? wl?.change7d ?? null,
        volume: data?.volume ?? heatmapCoin?.volume ?? topCoin?.volume ?? wl?.volume ?? null,
        marketCap: data?.marketCap ?? heatmapCoin?.marketCap ?? topCoin?.marketCap ?? wl?.marketCap ?? null,
      }
      setTokenCardPopup(payload)
    } else if (tokenOrSymbol && tokenOrSymbol.symbol) {
      const data = topCoinPrices?.[tokenOrSymbol.symbol] ?? topCoinPrices?.[tokenOrSymbol.symbol?.toUpperCase?.()]
      payload = {
        symbol: tokenOrSymbol.symbol,
        name: tokenOrSymbol.name || tokenOrSymbol.symbol,
        address: tokenOrSymbol.address,
        networkId: tokenOrSymbol.networkId,
        price: tokenOrSymbol.price,
        change: tokenOrSymbol.change,
        logo: tokenOrSymbol.logo || TOKEN_LOGOS[tokenOrSymbol.symbol],
        sparkline_7d: tokenOrSymbol.sparkline_7d ?? data?.sparkline_7d ?? null,
        change1h: tokenOrSymbol.change1h ?? data?.change1h ?? null,
        change7d: tokenOrSymbol.change7d ?? data?.change7d ?? null,
        volume: tokenOrSymbol.volume ?? data?.volume ?? null,
        marketCap: tokenOrSymbol.marketCap ?? data?.marketCap ?? null,
      }
      setTokenCardPopup(payload)
      setChartPanelToken(payload)
      setChartOverlayTimeframe('1m')
      setChartOverlaySubTab('candles')
      addTokenTab(payload)
      setActiveDiscoverTab(payload.symbol)
    }
  }

  const closeTokenCardPopup = () => {
    setTokenCardExpandedCard(null)
    setTokenCardPopup(null)
  }

  const handleSelectToken = (token, source = 'trending') => {
    track(Events.TOKEN_VIEWED, {
      symbol: token.symbol,
      source,
      token_name: token.name || null,
      token_address: token.address || null,
      network_id: token.networkId ?? null,
    })
    selectToken({
      symbol: token.symbol,
      name: token.name,
      address: token.address,
      networkId: token.networkId,
      price: token.price,
      change: token.change,
      logo: token.logo,
    })
  }

  const getTradingViewSymbol = (symbolOrToken) => {
    const token = typeof symbolOrToken === 'string'
      ? { symbol: symbolOrToken }
      : (symbolOrToken || {})
    const { symbol: resolved } = resolveTradingViewSymbol(token, isStocks ? 'stocks' : 'crypto')
    return resolved || `CRYPTO:${(token.symbol || '').toUpperCase()}USD`
  }

  const getTokenInitials = (symbol) => symbol?.slice(0, 2).toUpperCase() || '??'
  const getTokenLogo = (symbol) => TOKEN_LOGOS[symbol?.toUpperCase()] || null

  // Wrap isInWatchlist so it accepts a full token object
  const checkIsInWatchlist = isInWatchlist
    ? (token) => isInWatchlist(token?.address || token?.symbol)
    : (token) => !!watchlist?.some((w) => (w.symbol || '').toUpperCase() === (token?.symbol || '').toUpperCase() || (w.address || '') === (token?.address || ''))

  // Stable empty style object
  const EMPTY_STYLE = useMemo(() => ({}), [])

  return {
    // Compare
    compareMode, setCompareMode,
    compareTokens,
    showCompareModal,
    toggleCompareToken,
    isTokenSelected,
    openCompareModal,
    closeCompareModal,
    exitCompareMode,

    // Tabs
    activeDiscoverTab, setActiveDiscoverTab,
    openTokenTabs,
    addTokenTab,
    removeTokenTab,
    clearAllTabs,

    // Chart overlay
    chartPanelToken, setChartPanelToken,
    chartOverlayTimeframe, setChartOverlayTimeframe,
    chartOverlaySubTab, setChartOverlaySubTab,
    chartOverlayYAxis, setChartOverlayYAxis,
    chartFullscreen, setChartFullscreen,
    OVERLAY_TIMEFRAMES,

    // Token popup
    tokenCardPopup,
    tokenCardExpandedCard, setTokenCardExpandedCard,
    openTokenCardPopup,
    closeTokenCardPopup,

    // Click handlers
    openChartOnly,
    handleOnChainCoinClick,
    handleTopCoinClick,
    handleStockClick,
    handleSelectToken,

    // Utilities
    getTradingViewSymbol,
    getTokenInitials,
    getTokenLogo,
    checkIsInWatchlist,
    EMPTY_STYLE,
  }
}
