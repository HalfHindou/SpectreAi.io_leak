/**
 * WatchlistsPage Component
 * Full-page table with watchlist data. Token column uses same style as landing (avatar ring, hover gradient).
 * Supports both crypto and stock market modes.
 */
import React, { useState, useMemo, useRef, useEffect, useCallback, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useTranslation } from 'react-i18next'
import AppPortal from '@/components/app-portal'
import { useCurrency } from '@/hooks/useCurrency'
import { useTokenSearch } from '@/hooks/useCodexData'
import { useStockSearch, useStockPrices } from '@/hooks/useStockData'
import useDebouncedValue from '@/hooks/useDebouncedValue'
import { getStockLogo } from '@/constants/stockData'
import useWatchlistPrices from '@/hooks/useWatchlistPrices'
import { getTokenAvatarRingStyle } from '@/constants/tokenColors'
import { isMajorToken, MAJOR_SYMBOLS, MAJOR_TOKEN_INFO, SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import { getCgSearchHits, fetchCgMarketsByIds } from '@/services/cgSearchService'
import { buildMajorMatches, mergeTokenSearchResults } from '@/lib/search-merge'
import InfoTip from '@/components/InfoTip'
// Heatmap view is opt-in (default displayView is 'table'). Lazy keeps
// the treemap d3 code out of every watchlist visit.
const TreemapView = lazy(() => import('@/pages/heatmaps/components/TreemapView'))
const WatchlistAnalysisPanel = lazy(() => import('./wl-analysis-panel'))
import { forceSimulation, forceCollide, forceX, forceY, forceManyBody } from 'd3-force'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import '@/pages/bubbles/components/bubbles-page.css'
import '@/pages/heatmaps/components/heatmaps-page.css'
import MobileBottomSheet from './mobile-bottom-sheet'
import WatchlistRow from './watchlists-row'
import MobileWatchlistRow from './mobile-watchlist-row'
import MobileBackButton from '@/components/mobile-back-button'
import { isAppActive } from '@/lib/idleManager'
import {
  getChainName, MiniSparkline, getSparkPoints, getTokenLogo,
} from './watchlists-utils'

const WatchlistsPage = ({
  dayMode = false,
  watchlist = [],
  watchlistName = 'My Watchlist',
  watchlists = [],
  activeWatchlistId,
  onRenameWatchlist,
  onAddWatchlist,
  onRemoveWatchlist,
  onSwitchWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  togglePinWatchlist,
  reorderWatchlist,
  onTokenClick, // (token, viewMode) => void - navigates to Research Zone (major) or On-chain chart (onchain)
  marketMode = 'crypto', // 'crypto' | 'stocks'
  isMobile = false,
}) => {
  const { t, i18n } = useTranslation()
  const { fmtPrice, fmtLarge, fmtLargeShort } = useCurrency()
  const isStocks = marketMode === 'stocks'
  const [searchQuery, setSearchQuery] = useState('')
  const [sortColumn, setSortColumn] = useState('rank')
  const [sortDirection, setSortDirection] = useState('asc')
  const [draggedRowIndex, setDraggedRowIndex] = useState(null)
  const [dragOverRowIndex, setDragOverRowIndex] = useState(null)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(watchlistName)
  const [manageListOpen, setManageListOpen] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [editingListId, setEditingListId] = useState(null)
  const [editingListName, setEditingListName] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState(null)
  const [importDone, setImportDone] = useState(null)
  const [importMode, setImportMode] = useState('url') // 'url' or 'addresses'
  const [importAddresses, setImportAddresses] = useState('')
  const [importPreview, setImportPreview] = useState(null) // array of resolved tokens or null
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createListName, setCreateListName] = useState('')
  // Persist viewMode across page reloads + navigations so the user's filter
  // sticks (was: defaulted to 'all' every mount, leading to "why does my list
  // look different on each visit?" confusion).
  const [viewMode, setViewMode] = useState(() => {
    try {
      const saved = localStorage.getItem('spectre-watchlists-view-mode')
      if (saved === 'all' || saved === 'major' || saved === 'onchain') return saved
    } catch { /* ignore */ }
    return 'all'
  })
  useEffect(() => {
    try { localStorage.setItem('spectre-watchlists-view-mode', viewMode) } catch { /* ignore */ }
  }, [viewMode])
  const [displayView, setDisplayView] = useState('table') // 'table' | 'bubble' | 'heatmap' | 'analysis'
  const [heatmapTimeframe, setHeatmapTimeframe] = useState('24h')
  const [heatmapMode, setHeatmapMode] = useState('treemap') // 'treemap' | 'grid' | 'chart' | 'dual'
  const [heatmapSort, setHeatmapSort] = useState('market_cap') // 'market_cap' | 'volume' | 'change' | 'gainers' | 'losers'
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState(() => {
    const defaults = { chain: true, age: true, txns: true, volume: true, makers: true, holders: true, change5m: true, change1h: true, change6h: true, change24h: true, change1w: true, change1m: true, change1y: true, trend: true, liquidity: true, mcap: true }
    try {
      const raw = localStorage.getItem('spectre-wl-columns')
      if (!raw) return defaults
      const parsed = JSON.parse(raw)
      // Guard against corrupt/legacy entries (arrays, primitives, null) crashing mount.
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults
      // Merge so newly-added columns get their default visibility instead of being undefined.
      return { ...defaults, ...parsed }
    } catch {
      return defaults
    }
  })

  // Mobile state
  const [selectedToken, setSelectedToken] = useState(null)
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false)

  const searchContainerRef = useRef(null)
  const searchInputRef = useRef(null)
  const nameInputRef = useRef(null)
  const createInputRef = useRef(null)
  const columnsRef = useRef(null)

  // Bubble view refs
  const bubbleArenaRef = useRef(null)
  const bubbleSimRef = useRef(null)
  const bubbleLiveRef = useRef([])
  const bubbleTokenKeyRef = useRef('')
  const [bubbleContainerSize, setBubbleContainerSize] = useState({ width: 0, height: 0 })

  const toggleColumn = (col) => {
    setVisibleColumns(prev => {
      const next = { ...prev, [col]: !prev[col] }
      // Private mode / full storage throws — keep in-memory state valid.
      try { localStorage.setItem('spectre-wl-columns', JSON.stringify(next)) }
      catch { console.warn('[watchlists] localStorage quota exceeded') }
      return next
    })
  }

  // Close columns dropdown on outside click
  useEffect(() => {
    if (!columnsOpen) return
    const handle = (e) => { if (columnsRef.current && !columnsRef.current.contains(e.target)) setColumnsOpen(false) }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [columnsOpen])

  // Search - use stock search or crypto search based on mode
  const { results: cryptoSearchResults, loading: cryptoSearchLoading } = useTokenSearch(
    !isStocks ? searchQuery.trim() : '',
    300
  )
  const { results: stockSearchResults, loading: stockSearchLoading } = useStockSearch(
    isStocks ? searchQuery.trim() : '',
    300
  )
  const searchLoading = isStocks ? stockSearchLoading : cryptoSearchLoading

  // Settled search value so each keystroke doesn't fire two CG endpoints.
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 200)

  // CG-first search: priority pipeline is CG /search + /coins/markets. Any
  // token CG knows (canonical PaLM AI, real NEURAL on ETH, etc.) lands above
  // Codex pool clones. Codex stays as the fallback.
  const [cgSearchHits, setCgSearchHits] = useState([])
  useEffect(() => {
    if (isStocks) { setCgSearchHits([]); return }
    const q = debouncedSearchQuery.trim()
    if (!q || q.length < 1) { setCgSearchHits([]); return }
    let cancelled = false
    // Shared cached service — dedupes with the header + welcome surfaces.
    getCgSearchHits(q).then(hits => { if (!cancelled) setCgSearchHits(hits) })
    return () => { cancelled = true }
  }, [debouncedSearchQuery, isStocks])

  // Live Spectre /v1/prices data for major-symbol matches in the search.
  // Without this, BTC/ETH/SOL go through Codex (no wrapped contract -> no
  // mcap) and either show MC N/A or get buried under dust spam like
  // COIN_7C8QNA "Purple Bitcoin". Same pattern as header.jsx + welcome-page.jsx.
  const [watchlistPageMajorMarket, setWatchlistPageMajorMarket] = useState({})
  useEffect(() => {
    if (isStocks) return
    const q = debouncedSearchQuery.trim().toLowerCase()
    if (!q) return
    const matched = []
    const cgIds = []
    for (const sym of MAJOR_SYMBOLS) {
      const upper = sym.toUpperCase()
      const info = MAJOR_TOKEN_INFO[upper] || { symbol: upper, name: upper }
      if (upper.toLowerCase().includes(q) || (info.name || '').toLowerCase().includes(q)) {
        const cgId = SYMBOL_TO_COINGECKO_ID[upper]
        if (cgId) {
          matched.push(upper)
          cgIds.push(cgId)
        }
      }
    }
    if (cgIds.length === 0) return
    if (matched.every(s => watchlistPageMajorMarket[s])) return
    let cancelled = false
    // Shared cached markets fetcher (cg-proxy on Vercel with CG_API_KEY —
    // Hetzner /v1/prices was silently failing on this surface). Dedupes
    // with the header + welcome surfaces.
    fetchCgMarketsByIds(cgIds)
      .then(byId => {
        if (cancelled || byId.size === 0) return
        const next = { ...watchlistPageMajorMarket }
        for (const row of byId.values()) {
          const sym = String(row?.symbol || '').toUpperCase()
          if (!sym) continue
          next[sym] = {
            price: Number(row.current_price) || 0,
            change: Number(row.price_change_percentage_24h) || 0,
            marketCap: Number(row.market_cap) || 0,
            volume: Number(row.total_volume) || 0,
            image: row.image || null,
          }
        }
        setWatchlistPageMajorMarket(next)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchQuery, isStocks])

  const searchResults = useMemo(() => {
    if (isStocks) return stockSearchResults
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []

    // Shared merge pipeline (lib/search-merge.js): dust filter, majors
    // first, CG-canonical prepends, trust-ranked live rows, same-asset
    // folding and the stale-CG demotion. Same ranking as the header modal
    // (this also adds pasted-address matching, which this copy lacked).
    return mergeTokenSearchResults({
      query: searchQuery.trim(),
      majorRows: buildMajorMatches(q, watchlistPageMajorMarket),
      cgHits: cgSearchHits,
      liveRows: cryptoSearchResults || [],
    })
  }, [isStocks, stockSearchResults, cryptoSearchResults, searchQuery, watchlistPageMajorMarket, cgSearchHits])

  // Get stock watchlist symbols for price fetching
  const stockWatchlistSymbols = useMemo(() => {
    if (!isStocks) return []
    return watchlist.filter(t => t.isStock).map(t => t.symbol)
  }, [isStocks, watchlist])

  // Fetch stock prices for watchlist items
  const { prices: stockWatchlistPrices } = useStockPrices(stockWatchlistSymbols, 15000)

  // Handle token long-press/tap on mobile
  const handleTokenOptions = useCallback((token) => {
    setSelectedToken(token)
    setBottomSheetOpen(true)
  }, [])

  // Handle swipe actions
  const handleSwipeDelete = useCallback((token) => {
    removeFromWatchlist?.(token.address || token.symbol)
  }, [removeFromWatchlist])

  const handleSwipePin = useCallback((token) => {
    togglePinWatchlist?.(token.address || token.symbol)
  }, [togglePinWatchlist])

  // Get live watchlist data (same as landing page) - only for crypto
  const { watchlistWithLiveData, loading: pricesLoading, lastUpdated, refresh: refreshPrices } = useWatchlistPrices(
    isStocks ? [] : watchlist
  )

  // Table row data: map watchlist to full columns (placeholders for missing API fields)
  const tableTokens = useMemo(() => {
    // Stock mode: use watchlist with stock prices
    if (isStocks) {
      const stockItems = watchlist.filter(t => t.isStock)
      if (stockItems.length === 0) return []
      return stockItems.map((token, index) => {
        const livePrice = stockWatchlistPrices?.[token.symbol]
        const price = livePrice?.price ?? token.price ?? 0
        const change24h = livePrice?.change ?? token.change ?? 0
        const volume = livePrice?.volume ?? token.volume ?? 0
        const mcap = livePrice?.marketCap ?? token.marketCap ?? 0
        return {
          id: token.symbol || `stock-${index}`,
          rank: index + 1,
          symbol: token.symbol || 'UNKNOWN',
          name: token.name || token.symbol || 'Unknown Stock',
          logo: getStockLogo(token.symbol, token.sector),
          price,
          volume,
          change24h,
          mcap,
          sector: token.sector || livePrice?.sector || '',
          exchange: token.exchange || livePrice?.exchange || 'NYSE',
          pe: livePrice?.pe || token.pe || null,
          week52High: livePrice?.week52High ?? null,
          week52Low: livePrice?.week52Low ?? null,
          pinned: token.pinned || false,
          isStock: true,
        }
      })
    }

    // Crypto mode: use existing logic. Skip rows that have neither a symbol
    // nor a name resolved yet — they otherwise render as a blank shell row
    // (no icon, no ticker, but a sparkline + mcap if those came in early).
    if (!watchlistWithLiveData || watchlistWithLiveData.length === 0) return []
    return watchlistWithLiveData
      .filter((token) => {
        const sym = String(token.symbol || '').trim()
        const name = String(token.name || '').trim()
        if (token.address || token.pinned) return true
        return sym.length > 0 || name.length > 0
      })
      .map((token, index) => {
      const price = token.price || 0
      const change24h = token.change || 0
      const volume = token.volume24 || token.volume || 0
      const mcap = token.marketCap || 0
      return {
        cgId: token.coingeckoId || token.cgId || null,
        // Stable identity. Index-based fallbacks break the stable-sort
        // cache: when a token's address/symbol resolves later, the old
        // `token-7` id is orphaned in sortedIds and the row vanishes/
        // appends at bottom. Use the underlying watchlist row id as a last
        // resort instead.
        id: token.address || token.symbol || token._wlId || token.id || `wl-${token.networkId || 0}-${index}`,
        rank: index + 1,
        symbol: token.symbol || 'UNKNOWN',
        name: token.name || token.symbol || 'Unknown Token',
        logo: getTokenLogo(token.symbol, token.logo),
        price,
        age: token.age || '-',
        txns: token.txns ?? 0,
        volume,
        makers: token.makers ?? 0,
        holders: token.holders ?? 0,
        change5m: token.change5m ?? null,
        change1h: token.change1h ?? null,
        change6h: token.change6h ?? null,
        change24h: change24h,
        // Long windows fall back to null (renders as "-") instead of 0
        // so DexScreener-imported tokens — which have no 7d/30d/1y data —
        // don't show a misleading +0.00%.
        change1w: token.change7d ?? null,
        change1m: token.change30d ?? null,
        change1y: token.change1y ?? null,
        liquidity: token.liquidity ?? 0,
        mcap,
        address: token.address,
        networkId: token.networkId ?? 1,
        chain: getChainName(token.networkId ?? 1),
        pinned: token.pinned || false,
        // isMajor propagates from useWatchlistPrices - true for hardcoded majors
        // AND for tokens that resolve to a CoinGecko ID at runtime (PAAL, PI,
        // HYPE, etc). Falls back to the hardcoded allow-list when the hook
        // hasn't classified the token yet.
        isMajor: token.isMajor ?? isMajorToken((token.symbol || '').toUpperCase()),
        isStock: false,
      }
    })
  }, [isStocks, watchlist, watchlistWithLiveData, stockWatchlistPrices])

  // Missing-data sentinel. Sunny wants ∞ instead of '-' so it's clear the
  // value isn't "zero" — it's "the upstream couldn't give us this number"
  // (e.g. DexScreener doesn't expose 7d/30d/1y, Codex doesn't expose mcap
  // for some long-tail tokens, Spectre identity-only rows lack price).
  const EMPTY = '∞'
  const formatChange = (value) => {
    if (value === null || value === undefined || isNaN(value)) return EMPTY
    const num = typeof value === 'number' ? value : parseFloat(value)
    if (isNaN(num)) return EMPTY
    if (Math.abs(num) >= 10000) {
      const sign = num >= 0 ? '+' : '-'
      return `${sign}>9999%`
    }
    const sign = num >= 0 ? '+' : ''
    return `${sign}${num.toFixed(2)}%`
  }
  const formatAge = (age, symbol) => {
    const empty = age == null || age === '' || age === '-'
    return empty ? EMPTY : String(age)
  }
  const formatOptionalNumber = (value, symbol) => {
    const num = value != null ? Number(value) : 0
    const empty = num === 0 || isNaN(num)
    return empty ? EMPTY : new Intl.NumberFormat(i18n.language).format(num)
  }
  const formatOptionalLarge = (value, symbol) => {
    const num = value != null ? Number(value) : 0
    const empty = !num || isNaN(num)
    return empty ? EMPTY : fmtLarge(value)
  }

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(column)
      setSortDirection('desc')
    }
  }

  // Sort order is computed against a stable identity-only signature (the list
  // of token ids + pinned flags + sort column/direction). Live price/volume
  // updates do NOT trigger a resort — otherwise BTC↔ETH↔SOL would shuffle
  // positions on every Binance tick and the user would see rows physically
  // jump as they scroll. When the order needs refreshing (column click, add/
  // remove, rename), the signature changes and the sort re-runs against the
  // latest values via tableTokensRef.
  const tableTokensRef = useRef(tableTokens)
  useEffect(() => { tableTokensRef.current = tableTokens })

  const sortSignature = useMemo(() => {
    const ids = tableTokens.map(t => `${t.id}:${t.pinned ? 1 : 0}`).join('|')
    return `${ids}::${sortColumn}::${sortDirection}`
  }, [tableTokens, sortColumn, sortDirection])

  const sortedIds = useMemo(() => {
    // Read the CURRENT render's tokens, not the ref: the ref updates in an
    // effect AFTER render, so a pin toggle re-sorted with the PREVIOUS pin
    // flags — pin looked dead, and the unpin that followed surfaced the row
    // (founder, 08-05: "pin doesn't work… when I unpin then it shows on top").
    // Freshness on re-run is exactly the closure; the signature still keeps
    // price ticks from resorting.
    const list = tableTokens
    if (list.length === 0) return []
    const pinned = list.filter((t) => t.pinned)
    const unpinned = list.filter((t) => !t.pinned)
    const parseAge = (age) => {
      if (age === '-' || age == null) return 0
      const s = String(age)
      if (s.includes('y')) return parseInt(s, 10) * 12
      if (s.includes('mo')) return parseInt(s, 10)
      return parseInt(s, 10) || 0
    }
    if (sortColumn !== 'rank') {
      unpinned.sort((a, b) => {
        let aVal = a[sortColumn]
        let bVal = b[sortColumn]
        if (sortColumn === 'age') {
          aVal = parseAge(a.age)
          bVal = parseAge(b.age)
        }
        if (sortColumn === 'chain' || sortColumn === 'exchange' || sortColumn === 'sector') {
          aVal = (a[sortColumn] || '').toLowerCase()
          bVal = (b[sortColumn] || '').toLowerCase()
          return sortDirection === 'asc'
            ? (aVal < bVal ? -1 : aVal > bVal ? 1 : 0)
            : (bVal < aVal ? -1 : bVal > aVal ? 1 : 0)
        }
        if (sortColumn === 'pe') {
          aVal = a.pe ?? -Infinity
          bVal = b.pe ?? -Infinity
        }
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
        }
        return 0
      })
    }
    return [...pinned, ...unpinned].map(t => t.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortSignature])

  // Re-attach the latest live token values to the frozen sort order on every
  // price tick. Order is preserved; only the per-row fields update.
  const sortedTokens = useMemo(() => {
    if (sortedIds.length === 0) return []
    const byId = new Map(tableTokens.map(t => [t.id, t]))
    const out = []
    for (const id of sortedIds) {
      const tok = byId.get(id)
      if (tok) out.push(tok)
    }
    // Append any tokens that arrived after the last sort (newly added). They
    // sit at the bottom until the next resort.
    for (const t of tableTokens) {
      if (!sortedIds.includes(t.id)) out.push(t)
    }
    return out.map((t, i) => ({ ...t, rank: i + 1 }))
  }, [sortedIds, tableTokens])

  // All / Major / On-Chain are VIEW MODES that change which columns the
  // table emphasises — not row filters. Every mode renders every token in
  // the watchlist so the count never drops; the column toggles (chain,
  // age, txns, makers, holders) already differ per viewMode via the
  // `viewMode === 'onchain'` guards at the row render below.
  const mobileFilteredTokens = sortedTokens

  // Route mode for a token click: majors always go to Research Zone, pure on-chain
  // tokens go to the token chart page — independent of the current view toggle.
  const resolveRouteMode = (token) => {
    if (isStocks) return 'major'
    const isMajorEntry = token.isMajor === true || isMajorToken((token.symbol || '').toUpperCase())
    return isMajorEntry ? 'major' : 'onchain'
  }

  // Slow heartbeat for the summary block. The heat strip, top movers, health
  // score and avg-change pill don't need second-by-second freshness — they're
  // overview metrics. Recomputing every Binance tick made the 46-segment heat
  // strip and percentage pills shimmer visibly. We sample the latest values
  // once every 10 s plus whenever the token set itself changes.
  const [summaryTick, setSummaryTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden || !isAppActive()) return
      setSummaryTick((t) => (t + 1) % 1_000_000)
    }, 10_000)
    return () => clearInterval(id)
  }, [])
  // Identity-keyed snapshot — only changes when tokens are added/removed/
  // renamed/reordered or the slow tick fires. Heat strip / health score
  // memoise against this instead of the per-tick `sortedTokens` reference.
  const summaryTokensSnapshot = useMemo(
    () => sortedTokens,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortedIds, summaryTick],
  )

  // Portfolio intelligence metrics
  const summaryStats = useMemo(() => {
    if (!summaryTokensSnapshot.length) return null
    const tokens = summaryTokensSnapshot
    const totalMcap = tokens.reduce((sum, t) => sum + (t.mcap || 0), 0)
    const totalVolume = tokens.reduce((sum, t) => sum + (t.volume || 0), 0)
    const changes = tokens.map(t => t.change24h).filter(c => typeof c === 'number' && !isNaN(c))
    const avgChange = changes.length ? changes.reduce((s, c) => s + c, 0) / changes.length : 0
    const bullishCount = changes.filter(c => c >= 0).length
    const bullRatio = changes.length ? Math.round((bullishCount / changes.length) * 100) : 0
    const bestToken = tokens.reduce((best, t) => (!best || (t.change24h || 0) > (best.change24h || 0)) ? t : best, null)
    const worstToken = tokens.reduce((worst, t) => (!worst || (t.change24h || 0) < (worst.change24h || 0)) ? t : worst, null)
    // Portfolio health score: 0-100 based on bull ratio, avg change magnitude, and diversity
    const changeMag = Math.min(Math.abs(avgChange) / 10, 1) // 10% max scale
    const diversityScore = Math.min(tokens.length / 20, 1) // 20 tokens = full diversity
    const healthScore = Math.round(
      (bullRatio * 0.5) + (avgChange >= 0 ? changeMag * 30 : -changeMag * 15) + (diversityScore * 20)
    )
    const clampedHealth = Math.max(0, Math.min(100, healthScore))
    // Heat strip: per-token change data for the visual bar
    const heatStrip = tokens.map(t => ({ symbol: t.symbol, change: t.change24h || 0 }))
    // Volume/MCap ratio (trading activity relative to size)
    const vmRatio = totalMcap > 0 ? ((totalVolume / totalMcap) * 100) : 0
    // Total liquidity
    const totalLiquidity = tokens.reduce((sum, t) => sum + (t.liquidity || 0), 0)
    // Median change (more robust than avg)
    const sortedChanges = [...changes].sort((a, b) => a - b)
    const medianChange = sortedChanges.length
      ? sortedChanges.length % 2 === 0
        ? (sortedChanges[sortedChanges.length / 2 - 1] + sortedChanges[sortedChanges.length / 2]) / 2
        : sortedChanges[Math.floor(sortedChanges.length / 2)]
      : 0
    // Volatility (standard deviation of changes)
    const variance = changes.length > 1
      ? changes.reduce((sum, c) => sum + Math.pow(c - avgChange, 2), 0) / (changes.length - 1)
      : 0
    const volatility = Math.sqrt(variance)
    return {
      totalMcap, totalVolume, avgChange, medianChange, bullRatio,
      bestToken, worstToken, count: tokens.length,
      healthScore: clampedHealth, heatStrip, vmRatio,
      totalLiquidity, volatility
    }
  }, [summaryTokensSnapshot])

  const getHeatmapChange = useCallback((token) => {
    if (heatmapTimeframe === '1h') return token.change1h || 0
    if (heatmapTimeframe === '7d') return token.change7d || 0
    return token.change24h || 0
  }, [heatmapTimeframe])

  // ── Map watchlist tokens to format TreemapView/Bubbles expect ──
  const mappedTokens = useMemo(() => {
    const mapped = sortedTokens.map(token => ({
      ...token,
      marketCap: token.mcap || 0,
      change7d: token.change1w || 0,
      change30d: token.change1m || 0,
    }))
    // Apply heatmap sort
    if (heatmapSort === 'volume') {
      mapped.sort((a, b) => (b.volume || 0) - (a.volume || 0))
    } else if (heatmapSort === 'change') {
      mapped.sort((a, b) => Math.abs(getHeatmapChange(b)) - Math.abs(getHeatmapChange(a)))
    } else if (heatmapSort === 'gainers') {
      mapped.sort((a, b) => getHeatmapChange(b) - getHeatmapChange(a))
    } else if (heatmapSort === 'losers') {
      mapped.sort((a, b) => getHeatmapChange(a) - getHeatmapChange(b))
    }
    return mapped
  }, [sortedTokens, heatmapSort, getHeatmapChange])

  // ── Bubble view: prepareBubbleNodes (same as bubbles-page.jsx) ──
  const prepareBubbleNodes = useCallback((tokens, containerWidth, containerHeight) => {
    if (!tokens.length || !containerWidth || !containerHeight) return []
    const mcaps = tokens.map(t => t.marketCap || 1)
    const maxMcap = Math.max(...mcaps)
    const minMcap = Math.min(...mcaps)
    const logMax = Math.log(maxMcap)
    const logMin = Math.log(minMcap)
    const logRange = logMax - logMin || 1
    const MIN_R = isMobile ? 20 : 26
    const MAX_R = Math.min(90, containerWidth * 0.08, containerHeight * 0.13)
    const rawRadii = tokens.map(t => {
      const logNorm = (Math.log(t.marketCap || 1) - logMin) / logRange
      return MIN_R + Math.pow(logNorm, 0.55) * (MAX_R - MIN_R)
    })
    const totalCircleArea = rawRadii.reduce((sum, r) => sum + Math.PI * r * r, 0)
    const containerArea = containerWidth * containerHeight
    const packingTarget = containerArea * (isMobile ? 0.90 : 0.75)
    const scale = totalCircleArea > packingTarget ? Math.sqrt(packingTarget / totalCircleArea) : 1
    const cx = containerWidth / 2
    const cy = containerHeight / 2
    return tokens.map((t, i) => {
      const radius = Math.max(18, rawRadii[i] * scale)
      const angle = i * 2.399
      const dist = Math.sqrt(i + 1) * 22
      return { ...t, radius: Math.round(radius * 10) / 10, x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist }
    })
  }, [isMobile])

  const packedBubbles = useMemo(() => {
    if (!bubbleContainerSize.width || !bubbleContainerSize.height || !mappedTokens.length) return []
    return prepareBubbleNodes(mappedTokens, bubbleContainerSize.width, bubbleContainerSize.height)
  }, [mappedTokens, bubbleContainerSize, prepareBubbleNodes])

  // Pre-dampen the sizing metric for treemap so a single dominant token
  // doesn't eat the whole layout. useTreemapLayout applies pow(0.6) internally;
  // cbrt here gives total pow(0.20), capping any single token at ~20-25%.
  // The sizing metric follows the MCap/Vol toggle so the treemap actually
  // changes shape when the user flips between them.
  const treemapTokens = useMemo(() => {
    const useVolume = heatmapSort === 'volume'
    return mappedTokens.map(t => {
      const base = useVolume ? (t.volume || 0) : (t.marketCap || 0)
      return {
        ...t,
        marketCap: Math.cbrt(base || 1),
      }
    })
  }, [mappedTokens, heatmapSort])

  // ── Bubble view: ResizeObserver ──
  useEffect(() => {
    if (displayView !== 'bubble') return
    const el = bubbleArenaRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setBubbleContainerSize({ width: width - 4, height: height - 4 })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [displayView])

  // Stable key: only re-run simulation when token list or container actually changes
  const bubbleStableKey = useMemo(() => {
    if (!packedBubbles.length) return ''
    return packedBubbles.map(t => t.symbol).join(',') + `|${bubbleContainerSize.width}x${bubbleContainerSize.height}`
  }, [packedBubbles, bubbleContainerSize])

  // ── Bubble view: D3 force simulation (same pattern as bubbles-page.jsx) ──
  useEffect(() => {
    if (displayView !== 'bubble' || !packedBubbles.length || !bubbleStableKey) {
      if (bubbleSimRef.current) { bubbleSimRef.current.stop(); bubbleSimRef.current = null }
      return
    }
    // Skip if same token set + container size
    if (bubbleTokenKeyRef.current === bubbleStableKey && bubbleSimRef.current) return
    bubbleTokenKeyRef.current = bubbleStableKey

    if (bubbleSimRef.current) { bubbleSimRef.current.stop(); bubbleSimRef.current = null }

    const w = bubbleContainerSize.width
    const h = bubbleContainerSize.height
    if (!w || !h) return

    const cx = w / 2
    const cy = h / 2
    const nodes = packedBubbles.map((t, i) => ({ ...t, index: i, vx: 0, vy: 0 }))

    let cachedDomNodes = null
    const getDomNodes = () => {
      if (!cachedDomNodes || !cachedDomNodes[0]?.isConnected) {
        const el = bubbleArenaRef.current
        if (el) cachedDomNodes = el.querySelectorAll('.bubble-node')
      }
      return cachedDomNodes
    }

    const sim = forceSimulation(nodes)
      .force('x', forceX(cx).strength(0.008))
      .force('y', forceY(cy).strength(0.008))
      .force('charge', forceManyBody().strength(d => -d.radius * 0.25).distanceMax(220))
      .force('collide', forceCollide(d => d.radius + 3).strength(1.0).iterations(8))
      .alpha(0.35)
      .alphaDecay(0.004)
      .alphaMin(0.001)
      .velocityDecay(0.62)
      .on('tick', () => {
        const pad = 4
        const springK = 0.7
        for (const node of nodes) {
          const minX = node.radius + pad, maxX = w - node.radius - pad
          const minY = node.radius + pad, maxY = h - node.radius - pad
          if (node.x < minX) { node.vx += (minX - node.x) * springK; node.x = Math.max(node.x, minX) }
          else if (node.x > maxX) { node.vx += (maxX - node.x) * springK; node.x = Math.min(node.x, maxX) }
          if (node.y < minY) { node.vy += (minY - node.y) * springK; node.y = Math.max(node.y, minY) }
          else if (node.y > maxY) { node.vy += (maxY - node.y) * springK; node.y = Math.min(node.y, maxY) }
        }
        bubbleLiveRef.current = nodes.map(n => ({ x: n.x, y: n.y, r: n.radius }))
        const domNodes = getDomNodes()
        if (domNodes) {
          for (let i = 0; i < nodes.length && i < domNodes.length; i++) {
            const n = nodes[i]
            domNodes[i].style.transform = `translate3d(${n.x - n.radius}px, ${n.y - n.radius}px, 0)`
          }
        }
      })

    bubbleSimRef.current = sim

    // Staggered entrance animation
    const el = bubbleArenaRef.current
    if (el) {
      const domNodes = el.querySelectorAll('.bubble-node')
      for (let i = 0; i < domNodes.length; i++) domNodes[i].style.opacity = '0'
      for (let i = 0; i < domNodes.length; i++) {
        setTimeout(() => {
          if (domNodes[i]) {
            domNodes[i].style.transition = 'opacity 1s cubic-bezier(0.16, 1, 0.3, 1)'
            domNodes[i].style.opacity = '1'
          }
        }, 200 + i * 22)
      }
      const entranceDone = 200 + domNodes.length * 22 + 1200
      setTimeout(() => {
        for (let i = 0; i < domNodes.length; i++) {
          if (domNodes[i]) {
            domNodes[i].style.transition = ''
            domNodes[i].classList.add('settled')
            domNodes[i].style.setProperty('--breathe-delay', `${(i * 0.3) % 4}s`)
          }
        }
      }, entranceDone)
    }

    return () => { if (bubbleSimRef.current) { bubbleSimRef.current.stop(); bubbleSimRef.current = null } }
  }, [displayView, packedBubbles, bubbleContainerSize, bubbleStableKey])

  const handleDragStart = (e, index) => {
    setDraggedRowIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
    if (e.target) e.target.closest('tr')?.classList.add('watchlists-row-dragging')
  }
  const handleDragEnter = (e, index) => {
    e.preventDefault()
    if (draggedRowIndex !== null && index !== draggedRowIndex) setDragOverRowIndex(index)
  }
  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  const handleDragEnd = (e) => {
    e.target?.closest('tr')?.classList.remove('watchlists-row-dragging')
    setDraggedRowIndex(null)
    setDragOverRowIndex(null)
  }
  const handleDrop = (e, dropIndex) => {
    e.preventDefault()
    if (draggedRowIndex === null || draggedRowIndex === dropIndex || !reorderWatchlist) return
    const reordered = [...sortedTokens]
    const [removed] = reordered.splice(draggedRowIndex, 1)
    reordered.splice(dropIndex, 0, removed)
    // For stocks, map against the raw watchlist; for crypto, use watchlistWithLiveData
    const sourceList = isStocks ? watchlist : watchlistWithLiveData
    let newWatchlistOrder = reordered.map((tok) =>
      sourceList.find((w) => (w.address && w.address === tok.address) || (w.symbol && (w.symbol || '').toUpperCase() === (tok.symbol || '').toUpperCase()))
    ).filter(Boolean)
    // Pin always wins: enforce pinned first so drag can't override pin
    const pinnedFirst = [...newWatchlistOrder.filter((tok) => tok.pinned), ...newWatchlistOrder.filter((tok) => !tok.pinned)]
    if (pinnedFirst.length === reordered.length) reorderWatchlist(pinnedFirst)
    setDraggedRowIndex(null)
    setDragOverRowIndex(null)
  }

  // Refresh prices ONLY when the watchlist length changes after the initial
  // populate. The hook (useWatchlistPrices) already fetches on its own mount,
  // so firing here on mount too caused a redundant double full-pipeline fetch.
  // We hold refreshPrices in a ref (stable per-symbols-key) and skip the first
  // 0->N transition that the hook's mount fetch already covers — only true
  // add/remove length changes trigger a re-fetch.
  const refreshPricesRef = useRef(refreshPrices)
  useEffect(() => { refreshPricesRef.current = refreshPrices })
  const prevLenRef = useRef(null)
  useEffect(() => {
    const len = watchlist?.length ?? 0
    const prev = prevLenRef.current
    prevLenRef.current = len
    // First run (prev === null) is the initial populate — the hook's mount
    // fetch handles it, so don't double-fetch here.
    if (prev === null) return
    if (len > 0 && len !== prev) {
      refreshPricesRef.current?.()
    }
  }, [watchlist?.length])

  useEffect(() => {
    setNameInput(watchlistName)
  }, [watchlistName])

  useEffect(() => {
    if (editingName && nameInputRef.current) nameInputRef.current.focus()
  }, [editingName])

  const handleNameBlur = () => {
    setEditingName(false)
    const trimmed = (nameInput || '').trim()
    if (trimmed && trimmed !== watchlistName && onRenameWatchlist) onRenameWatchlist(activeWatchlistId, trimmed)
    else setNameInput(watchlistName)
  }

  const handleNameKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.target.blur()
    }
  }

  // Close search dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) setSearchQuery('')
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  const formatUpdatedAt = (ts) => {
    if (!ts || typeof ts !== 'number') return '-'
    const diff = Date.now() - ts
    if (diff < 60 * 1000) return t('watchlists.time.updatedJustNow', 'updated just now')
    if (diff < 60 * 60 * 1000) return t('watchlists.time.updatedMinAgo', 'updated {{n}} min ago', { n: Math.floor(diff / 60000) })
    if (diff < 24 * 60 * 60 * 1000) return t('watchlists.time.updatedHoursAgo', 'updated {{n}} hours ago', { n: Math.floor(diff / 3600000) })
    const days = Math.floor(diff / (24 * 60 * 60 * 1000))
    return t('watchlists.time.updatedDaysAgo', 'updated {{n}} days ago', { n: days })
  }

  const handleCreateList = () => {
    const name = newListName.trim()
    onAddWatchlist?.(name || undefined)
    setNewListName('')
    setManageListOpen(false)
  }

  const handleStartRename = (w) => {
    setEditingListId(w.id)
    setEditingListName(w.name || '')
  }

  const handleSaveRename = () => {
    if (editingListId != null) {
      onRenameWatchlist?.(editingListId, editingListName.trim() || 'Unnamed')
      setEditingListId(null)
      setEditingListName('')
    }
  }

  const extractDexScreenerWatchlistId = (urlOrId) => {
    const s = (urlOrId || '').trim()
    const m = s.match(/dexscreener\.com\/watchlist\/([a-zA-Z0-9_-]+)/i)
    if (m) return m[1]
    if (/^[a-zA-Z0-9_-]+$/.test(s)) return s
    return null
  }

  // Check if URL is a DexScreener pair URL (e.g., dexscreener.com/solana/abc123)
  const extractDexScreenerPair = (url) => {
    const s = (url || '').trim()
    const m = s.match(/dexscreener\.com\/([a-z]+)\/([a-zA-Z0-9]+)/i)
    if (m && m[1] !== 'watchlist') {
      return { chain: m[1], address: m[2] }
    }
    return null
  }

  const handleImportFromDexScreener = async () => {
    const url = (importUrl || '').trim()
    
    // Check if it's a pair URL first
    const pairInfo = extractDexScreenerPair(url)
    if (pairInfo) {
      setImportError(null)
      setImportDone(null)
      setImportLoading(true)
      try {
        const res = await fetch(`/api/dexscreener-pair/${pairInfo.chain}/${pairInfo.address}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setImportError(data.error || t('watchlists.import.errorPair', 'Failed to load pair'))
          return
        }
        const tok = data.token
        if (tok && addToWatchlist) {
          addToWatchlist({
            symbol: tok.symbol,
            name: tok.name,
            address: tok.address,
            networkId: tok.networkId ?? 1,
            price: tok.price,
            change: tok.change,
            marketCap: tok.marketCap,
            logo: tok.logo,
            pinned: false,
          })
          setImportDone(t('watchlists.import.doneSingle', 'Imported {{symbol}}.', { symbol: tok.symbol }))
          setImportUrl('')
          setTimeout(() => {
            setImportOpen(false)
            setImportDone(null)
          }, 1500)
        } else {
          setImportError(t('watchlists.import.errorExtract', 'Could not extract token from pair.'))
        }
      } catch (err) {
        setImportError(err.message || t('watchlists.import.errorFailed', 'Import failed.'))
      } finally {
        setImportLoading(false)
      }
      return
    }

    // Otherwise try watchlist import
    const id = extractDexScreenerWatchlistId(url)
    if (!id) {
      setImportError(t('watchlists.import.errorNoLink', 'Paste a DexScreener watchlist or pair link.'))
      return
    }
    setImportError(null)
    setImportDone(null)
    setImportLoading(true)
    try {
      const res = await fetch(`/api/dexscreener-watchlist/${encodeURIComponent(id)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setImportError(data.error || data.hint || res.statusText || t('watchlists.import.errorWatchlist', 'Failed to load watchlist'))
        return
      }
      const tokens = data.tokens || []
      if (tokens.length === 0) {
        setImportError(t('watchlists.import.errorEmpty', 'No tokens found in this watchlist.'))
        return
      }
      let added = 0
      tokens.forEach((tok) => {
        if (addToWatchlist) {
          addToWatchlist({
            symbol: tok.symbol,
            name: tok.name,
            address: tok.address,
            networkId: tok.networkId ?? 1,
            price: tok.price,
            change: tok.change,
            // DexScreener windows. Long windows (7d/30d/1y) intentionally
            // omitted — backend does not return them, frontend renders "-".
            change5m: tok.change5m ?? null,
            change1h: tok.change1h ?? null,
            change6h: tok.change6h ?? null,
            change24h: tok.change24h ?? tok.change ?? null,
            volume24: tok.volume24 ?? 0,
            liquidity: tok.liquidity ?? 0,
            marketCap: tok.marketCap,
            logo: tok.logo,
            pinned: false,
          })
          added += 1
        }
      })
      setImportDone(t('watchlists.import.doneMany', 'Imported {{count}} projects.', { count: added }))
      setImportUrl('')
      setTimeout(() => {
        setImportOpen(false)
        setImportDone(null)
      }, 1500)
    } catch (err) {
      const msg = err.message || ''
      setImportError(
        msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')
          ? t('watchlists.import.errorNetwork', 'Could not reach the server. Start the backend (e.g. npm run dev in /server) and try again.')
          : msg || t('watchlists.import.errorRetry', 'Import failed. Try again.')
      )
    } finally {
      setImportLoading(false)
    }
  }

  // DexScreener chainId -> Codex networkId
  const DEXSCREENER_CHAIN_MAP = {
    ethereum: 1, bsc: 56, solana: 1399811149, arbitrum: 42161,
    polygon: 137, base: 8453, avalanche: 43114, optimism: 10,
    fantom: 250, cronos: 25, blast: 81457, sui: 784,
  }

  const parseAddressInput = (raw) => {
    const cleaned = raw.replace(/[,\n\r\t]+/g, ' ').trim()
    if (!cleaned) return []
    return cleaned.split(/\s+/).filter(s =>
      /^0x[a-fA-F0-9]{40}$/.test(s) || /^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(s)
    )
  }

  const handleLookupAddresses = async () => {
    const addresses = parseAddressInput(importAddresses)
    if (addresses.length === 0) {
      setImportError(t('watchlists.import.errorNoAddresses', 'No valid contract addresses found. Paste EVM (0x...) or Solana addresses.'))
      return
    }
    setImportError(null)
    setImportDone(null)
    setImportLoading(true)
    setImportPreview(null)
    try {
      const batch = addresses.slice(0, 30)
      const results = await Promise.all(
        batch.map(async (addr) => {
          try {
            // 2026-05-28 hide-apis: same-origin /api/data-api?fn=dexscreener-proxy&route=search
            const res = await fetch(`/api/data-api?fn=dexscreener-proxy&route=search&q=${encodeURIComponent(addr)}`)
            if (!res.ok) return null
            const data = await res.json()
            if (!data.pairs || data.pairs.length === 0) return null
            const sorted = data.pairs
              .filter(p => p.baseToken.address.toLowerCase() === addr.toLowerCase())
              .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))
            const best = sorted[0] || data.pairs[0]
            return {
              address: best.baseToken.address,
              symbol: best.baseToken.symbol,
              name: best.baseToken.name,
              price: parseFloat(best.priceUsd) || 0,
              change: best.priceChange?.h24 || 0,
              marketCap: best.marketCap || best.fdv || 0,
              logo: best.info?.imageUrl || null,
              networkId: DEXSCREENER_CHAIN_MAP[best.chainId] || 1,
              chain: best.chainId,
            }
          } catch { return null }
        })
      )
      const found = results.filter(Boolean)
      const seen = new Set()
      const unique = found.filter(t => {
        const key = t.address.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      if (unique.length === 0) {
        setImportError(t('watchlists.import.errorNoTokens', 'No tokens found for those addresses.'))
      } else {
        setImportPreview(unique)
      }
    } catch (err) {
      setImportError(err.message || t('watchlists.import.errorLookup', 'Lookup failed.'))
    }
    setImportLoading(false)
  }

  const handleImportPreview = () => {
    if (!importPreview || !addToWatchlist) return
    let added = 0
    importPreview.forEach((tok) => {
      addToWatchlist({
        symbol: tok.symbol,
        name: tok.name,
        address: tok.address,
        networkId: tok.networkId ?? 1,
        price: tok.price,
        change: tok.change,
        marketCap: tok.marketCap,
        logo: tok.logo,
        pinned: false,
      })
      added++
    })
    setImportDone(t('watchlists.import.doneTokens', 'Imported {{count}} tokens.', { count: added }))
    setImportAddresses('')
    setImportPreview(null)
    setTimeout(() => {
      setImportOpen(false)
      setImportDone(null)
      setImportMode('url')
    }, 1500)
  }

  return (
    <div className={`watchlists-page${dayMode ? ' day-mode' : ''}${isMobile ? ' wl-mobile' : ''}`} data-day-mode={dayMode ? 'true' : undefined}>

      {/* =========== MOBILE LAYOUT =========== */}
      {isMobile && (
        <div className="wlm-container">
          {/* Mobile header */}
          <div className="wlm-header">
            <div className="wlm-title-row">
              <MobileBackButton className="wlm-back" />
              <h1 className="wlm-title">{watchlistName}</h1>
              {!pricesLoading && <span className="wl-live-dot" />}
              {pricesLoading && <span className="wl-loading-dot" />}
            </div>
            {summaryStats && (
              <div className="wlm-stats-row">
                <span className="wlm-stat">{t('watchlists.summary.assetCount', '{{count}} assets', { count: summaryStats.count })}</span>
                <span className="wlm-stat-sep" />
                <span className="wlm-stat">{t('watchlists.summary.capValue', '{{value}} cap', { value: fmtLarge(summaryStats.totalMcap) })}</span>
                <span className="wlm-stat-sep" />
                <span className={`wlm-stat ${summaryStats.avgChange >= 0 ? 'positive' : 'negative'}`}>
                  {t('watchlists.summary.avgValue', '{{value}} avg', { value: formatChange(summaryStats.avgChange) })}
                </span>
              </div>
            )}
          </div>

          {/* Watchlist tabs strip */}
          <div className="wlm-tabs-strip">
            {watchlists.map(w => (
              <button
                key={w.id}
                type="button"
                className={`wlm-tab${w.id === activeWatchlistId ? ' active' : ''}`}
                onClick={() => onSwitchWatchlist?.(w.id)}
              >
                <span className="wlm-tab-name">{typeof w.name === 'string' ? w.name : t('watchlists.unnamed', 'Unnamed')}</span>
                <span className="wlm-tab-count">{typeof w.tokenCount === 'number' ? w.tokenCount : 0}</span>
              </button>
            ))}
            <button
              type="button"
              className="wlm-tab wlm-tab-add"
              onClick={() => { setCreateListName(''); setCreateModalOpen(true); }}
              aria-label={t('watchlistPage.addWatchlist')}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>

          {/* Stat strip — the four watchlist reads on one hairline-separated
              row. This was a 2x2 grid of bordered tiles that cost ~430px of
              screen before a single token row appeared; the numbers are the
              same, the boxes are gone. */}
          {summaryStats && (
            <div className="wlm-statstrip">
              <div className="wlm-ss-cell">
                <span className="wlm-ss-label">{t('watchlists.quickStats.health', 'HEALTH')}</span>
                <span className="wlm-ss-value">{summaryStats.healthScore}</span>
                <span className={`wlm-ss-sub ${summaryStats.healthScore >= 70 ? 'positive' : summaryStats.healthScore >= 45 ? '' : 'negative'}`}>
                  {summaryStats.healthScore >= 70
                    ? t('watchlists.health.strong', 'Strong')
                    : summaryStats.healthScore >= 45
                      ? t('watchlists.health.moderate', 'Moderate')
                      : t('watchlists.health.weak', 'Weak')}
                </span>
              </div>
              <div className="wlm-ss-cell">
                <span className="wlm-ss-label">{t('watchlists.quickStats.dailyVolume', '24H VOL')}</span>
                <span className="wlm-ss-value">{fmtLargeShort(summaryStats.totalVolume)}</span>
                <span className="wlm-ss-sub">{t('watchlists.quickStats.vmRatio', 'V/MC {{pct}}%', { pct: summaryStats.vmRatio.toFixed(1) })}</span>
              </div>
              <div className="wlm-ss-cell">
                <span className="wlm-ss-label">{t('watchlists.quickStats.avgChange', 'AVG CHANGE')}</span>
                <span className={`wlm-ss-value ${summaryStats.avgChange >= 0 ? 'positive' : 'negative'}`}>{formatChange(summaryStats.avgChange)}</span>
                <span className="wlm-ss-sub">{t('watchlists.quickStats.greenRatio', '{{pct}}% green', { pct: summaryStats.bullRatio })}</span>
              </div>
              <div className="wlm-ss-cell">
                <span className="wlm-ss-label">{t('watchlists.quickStats.volatility', 'VOLATILITY')}</span>
                <span className="wlm-ss-value">{summaryStats.volatility.toFixed(1)}%</span>
                <span className="wlm-ss-sub">{t('watchlists.quickStats.stdDev', 'std dev')}</span>
              </div>
            </div>
          )}

          {/* Mobile toolbar */}
          <div className="wlm-toolbar">
            {/* View toggle */}
            {!isStocks && (
              <div className="wlm-view-toggle">
                <button
                  type="button"
                  className={`wlm-toggle-pill${viewMode === 'all' ? ' active' : ''}`}
                  onClick={() => setViewMode('all')}
                >
                  {t('watchlists.viewMode.all', 'All')}
                </button>
                <button
                  type="button"
                  className={`wlm-toggle-pill${viewMode === 'major' ? ' active' : ''}`}
                  onClick={() => setViewMode('major')}
                >
                  {t('watchlistPage.major')}
                </button>
                <button
                  type="button"
                  className={`wlm-toggle-pill${viewMode === 'onchain' ? ' active' : ''}`}
                  onClick={() => setViewMode('onchain')}
                >
                  {t('watchlistPage.onChain')}
                </button>
              </div>
            )}
            {/* Action buttons */}
            <div className="wlm-actions">
              <button type="button" className="wlm-action-btn ui-glass" onClick={() => { setImportError(null); setImportDone(null); setImportOpen(true); }} aria-label={t('watchlists.actions.import', 'Import')}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
              <button type="button" className="wlm-action-btn ui-glass" onClick={() => { setManageListOpen(true); setNewListName(''); setEditingListId(null); }} aria-label={t('watchlists.actions.manage', 'Manage')}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile search */}
          {addToWatchlist && (
            <div className="wlm-search-container" ref={searchContainerRef}>
              <div className="wlm-search-wrapper">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="wlm-search-icon">
                  <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="wlm-search-input"
                  placeholder={isStocks ? t('watchlistPage.searchStockToAdd') : t('watchlistPage.searchTokenToAdd')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button type="button" className="wlm-search-clear" onClick={() => setSearchQuery('')} aria-label={t('common.clear', 'Clear')}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              {searchQuery.trim().length >= 1 && (
                <div className="wlm-search-dropdown">
                  {searchLoading && searchResults.length === 0 ? (
                    <div className="wlm-search-loading">
                      {[1, 2, 3].map(i => <div key={i} className="wlm-search-shimmer" style={{ animationDelay: `${i * 50}ms` }} />)}
                    </div>
                  ) : searchResults.length > 0 ? (
                    searchResults.slice(0, 6).map((result, idx) => (
                      <button
                        key={isStocks ? `${result.symbol}-${idx}` : `${result.address || result.cgId || result.symbol}-${result.networkId}`}
                        type="button"
                        className="wlm-search-result"
                        onClick={() => {
                          if (isStocks) {
                            addToWatchlist({ symbol: result.symbol, name: result.name || result.symbol, price: result.price || 0, change: result.change || 0, marketCap: result.marketCap || 0, volume: result.volume || 0, logo: getStockLogo(result.symbol, result.sector), sector: result.sector || '', exchange: result.exchange || 'NYSE', pinned: false, isStock: true })
                          } else {
                            addToWatchlist({ symbol: result.symbol, name: result.name, cgId: result.cgId || null, address: result.address, networkId: result.networkId || 1, price: result.price, change: Number(result.change) || 0, marketCap: result.marketCap, logo: result.logo, pinned: false, isStock: false })
                          }
                          setSearchQuery('')
                        }}
                      >
                        <div className="wlm-sr-left">
                          {(isStocks ? getStockLogo(result.symbol, result.sector) : result.logo) && (
                            <img src={isStocks ? getStockLogo(result.symbol, result.sector) : result.logo} alt="" className="wlm-sr-logo" onError={(e) => { e.target.style.display = 'none' }} />
                          )}
                          <div className="wlm-sr-info">
                            <span className="wlm-sr-symbol">{result.symbol}</span>
                            <span className="wlm-sr-name">{result.name}</span>
                          </div>
                        </div>
                        <div className="wlm-sr-spark">
                          <MiniSparkline data={getSparkPoints(result)} width={48} height={18} positive={(Number(result.change) || 0) >= 0} />
                        </div>
                        <div className="wlm-sr-right">
                          <span className="wlm-sr-price">{result.formattedPrice || fmtPrice(result.price)}</span>
                          <span className={`wlm-sr-change ${(Number(result.change) || 0) >= 0 ? 'positive' : 'negative'}`}>
                            {(Number(result.change) || 0) >= 0 ? '+' : ''}{(Number(result.change) || 0).toFixed(2)}%
                          </span>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="wlm-search-empty">{t('common.noResults')}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Mobile token list */}
          {mobileFilteredTokens.length === 0 ? (
            <div className="wlm-empty">
              <p className="wlm-empty-text">
                {sortedTokens.length === 0
                  ? t('watchlistPage.noTokensInWatchlist')
                  : (viewMode === 'major'
                      ? t('watchlists.empty.noMajorTokens', 'No major tokens in this list.')
                      : t('watchlists.empty.noOnChainTokens', 'No on-chain tokens in this list.'))}
              </p>
              <button type="button" className="wlm-empty-btn" onClick={() => searchInputRef.current?.focus()}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>{t('watchlist.addToken')}</span>
              </button>
            </div>
          ) : (
            <div className="wlm-token-list">
              {mobileFilteredTokens.map((token) => (
                <MobileWatchlistRow
                  key={token.id}
                  token={token}
                  t={t}
                  lang={i18n.language}
                  fmtPrice={fmtPrice}
                  fmtLargeShort={fmtLargeShort}
                  onPin={handleSwipePin}
                  onDelete={handleSwipeDelete}
                  onOpen={(tk) => {
                    if (onTokenClick) {
                      onTokenClick(tk, resolveRouteMode(tk))
                    } else {
                      handleTokenOptions(tk)
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* =========== DESKTOP LAYOUT =========== */}
      {!isMobile && (
      <div className="wl-desktop-wrapper">
      {/* Header — compact: title + stats left, search right */}
      <div className="wl-header">
        <div className="wl-header-left">
          <div className="wl-title-row">
            <h1 className="wl-title">{t('watchlist.title')}<InfoTip text={t('watchlists.tooltips.title', 'Your personal portfolio tracker. Add tokens or stocks, monitor real-time prices, and track performance across multiple timeframes. Create multiple watchlists to organize by strategy or sector.')} position="bottom" /></h1>
            {!pricesLoading && <span className="wl-live-dot" title={t('watchlistPage.liveScanning')} />}
            {pricesLoading && <span className="wl-loading-dot" title={t('watchlistPage.updatingPrices')} />}
            <button
              type="button"
              className="wl-refresh-btn"
              onClick={refreshPrices}
              disabled={pricesLoading}
              title={t('watchlistPage.refreshPrices')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={pricesLoading ? 'spinning' : ''}>
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
            </button>
          </div>
          {summaryStats && (
            <div className="wl-header-stats">
              <span className="wl-stat-item">{t('watchlists.summary.assetCount', '{{count}} assets', { count: summaryStats.count })}<InfoTip text={t('watchlists.tooltips.assetCount', 'Total number of tokens or stocks currently in this watchlist.')} position="bottom" /></span>
              <span className="wl-stat-sep" />
              <span className="wl-stat-item">{t('watchlists.summary.capValue', '{{value}} cap', { value: fmtLarge(summaryStats.totalMcap) })}<InfoTip text={t('watchlists.tooltips.totalMcap', 'Combined market capitalization of all assets in your watchlist.')} position="bottom" /></span>
              <span className="wl-stat-sep" />
              <span className={`wl-stat-item ${summaryStats.avgChange >= 0 ? 'positive' : 'negative'}`}>
                {t('watchlists.summary.avgValue', '{{value}} avg', { value: formatChange(summaryStats.avgChange) })}<InfoTip text={t('watchlists.tooltips.avgChange', 'Average 24-hour price change across all watchlist assets. Green means your portfolio is trending up on average.')} position="bottom" />
              </span>
              <span className="wl-stat-sep" />
              <span className="wl-stat-item">{t('watchlists.summary.greenRatio', '{{pct}}% green', { pct: summaryStats.bullRatio })}<InfoTip text={t('watchlists.tooltips.greenRatio', 'Percentage of assets with positive 24h price change. Higher values indicate broad market strength in your portfolio.')} position="bottom" /></span>
              <span className="wl-stat-sep" />
              <span className="wl-stat-item">{t('watchlists.summary.volValue', 'Vol {{value}}', { value: fmtLarge(summaryStats.totalVolume) })}<InfoTip text={t('watchlists.tooltips.totalVolume', 'Total 24-hour trading volume across all assets. High volume signals strong market activity and liquidity.')} position="bottom" /></span>
            </div>
          )}
        </div>
        {addToWatchlist && (
          <div className="watchlists-search-container" ref={searchContainerRef}>
            <InfoTip text={t('watchlists.tooltips.search', 'Search for tokens or stocks to add to your watchlist. Type a name or symbol and select from the dropdown, or press the + button to quick-add the top result.')} position="left" />
            <div className="watchlists-search-wrapper">
              <svg className="wl-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="watchlists-search-input"
                  placeholder={isStocks ? t('watchlistPage.searchStockToAdd') : t('watchlistPage.searchTokenToAdd')}
                  aria-label={isStocks ? t('watchlistPage.searchStockToAdd') : t('watchlistPage.searchTokenToAdd')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <button
                  type="button"
                  className="watchlists-add-btn"
                  title={isStocks ? t('watchlistPage.addStock') : t('watchlist.addToken')}
                  aria-label={isStocks ? t('watchlistPage.addStock') : t('watchlist.addToken')}
                  onClick={() => {
                    if (searchQuery.trim().length >= 1 && searchResults.length > 0) {
                      const firstResult = searchResults[0]
                      if (isStocks) {
                        addToWatchlist({
                          symbol: firstResult.symbol,
                          name: firstResult.name || firstResult.symbol,
                          price: firstResult.price || 0,
                          change: firstResult.change || 0,
                          marketCap: firstResult.marketCap || 0,
                          volume: firstResult.volume || 0,
                          logo: getStockLogo(firstResult.symbol, firstResult.sector),
                          sector: firstResult.sector || '',
                          exchange: firstResult.exchange || 'NYSE',
                          pinned: false,
                          isStock: true,
                        })
                      } else {
                        addToWatchlist({
                          symbol: firstResult.symbol,
                          name: firstResult.name,
                          cgId: firstResult.cgId || null,
                          address: firstResult.address,
                          networkId: firstResult.networkId || 1,
                          price: firstResult.price,
                          change: firstResult.change,
                          marketCap: firstResult.marketCap,
                          logo: firstResult.logo,
                          pinned: false,
                          isStock: false,
                        })
                      }
                      setSearchQuery('')
                    }
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>
              {searchQuery.trim().length >= 1 && (
                <div className="watchlists-search-dropdown">
                  {searchLoading && searchResults.length === 0 ? (
                    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div className="animate-shimmer" style={{ height: '48px', borderRadius: '8px' }} />
                      <div className="animate-shimmer" style={{ height: '48px', borderRadius: '8px' }} />
                      <div className="animate-shimmer" style={{ height: '48px', borderRadius: '8px' }} />
                    </div>
                  ) : searchResults.length > 0 ? (
                    searchResults.slice(0, 8).map((result, idx) => (
                      <button
                        key={isStocks ? `${result.symbol}-${idx}` : `${result.address || result.cgId || result.symbol}-${result.networkId}`}
                        type="button"
                        className="watchlists-search-result"
                        onClick={() => {
                          if (isStocks) {
                            addToWatchlist({
                              symbol: result.symbol,
                              name: result.name || result.symbol,
                              price: result.price || 0,
                              change: result.change || 0,
                              marketCap: result.marketCap || 0,
                              volume: result.volume || 0,
                              logo: getStockLogo(result.symbol, result.sector),
                              sector: result.sector || '',
                              exchange: result.exchange || 'NYSE',
                              pinned: false,
                              isStock: true,
                            })
                          } else {
                            addToWatchlist({
                              symbol: result.symbol,
                              name: result.name,
                              cgId: result.cgId || null,
                              address: result.address,
                              networkId: result.networkId || 1,
                              price: result.price,
                              change: Number(result.change) || 0,
                              marketCap: result.marketCap,
                              logo: result.logo,
                              pinned: false,
                              isStock: false,
                            })
                          }
                          setSearchQuery('')
                        }}
                      >
                        <div className="search-result-left">
                          {(isStocks ? getStockLogo(result.symbol, result.sector) : result.logo) && (
                            <img src={isStocks ? getStockLogo(result.symbol, result.sector) : result.logo} alt="" className="watchlists-search-result-img" />
                          )}
                          <div className="search-result-info">
                            <div className="search-result-top">
                              <span className="watchlists-search-result-symbol">{result.symbol}</span>
                              {isStocks ? (
                                result.exchange && <span className="search-result-chain">{result.exchange}</span>
                              ) : (
                                result.network && <span className="search-result-chain">{result.network}</span>
                              )}
                            </div>
                            <span className="watchlists-search-result-name">{result.name}</span>
                          </div>
                        </div>
                        <div className="search-result-right">
                          <div className="search-result-price">{result.formattedPrice || fmtPrice(result.price)}</div>
                          <div className={`search-result-change ${(Number(result.change) || 0) >= 0 ? 'positive' : 'negative'}`}>
                            {(Number(result.change) || 0) >= 0 ? '↑' : '↓'} {Math.abs(Number(result.change) || 0).toFixed(2)}%
                          </div>
                        </div>
                        <div className="search-result-stats">
                          <span className="search-result-stat">MC {result.formattedMcap || fmtLarge(result.marketCap)}</span>
                          {isStocks ? (
                            <span className="search-result-stat">Vol {fmtLarge(result.volume)}</span>
                          ) : (() => {
                            const liq = Number(result.liquidity) || 0
                            const vol = Number(result.volume) || 0
                            if (liq > 0) return <span className="search-result-stat">Liq {result.formattedLiquidity || fmtLarge(liq)}</span>
                            if (vol > 0) return <span className="search-result-stat">Vol {fmtLarge(vol)}</span>
                            return null
                          })()}
                        </div>
                      </button>
                    ))
                  ) : (
                    <>
                      <div className="watchlists-search-empty">{t('common.noResults')}. {t('watchlist.addToken')}:</div>
                      {[
                        { symbol: 'BTC', name: 'Bitcoin' },
                        { symbol: 'ETH', name: 'Ethereum' },
                        { symbol: 'SOL', name: 'Solana' },
                        { symbol: 'PEPE', name: 'Pepe' },
                        { symbol: 'WIF', name: 'dogwifhat' },
                        { symbol: 'DOGE', name: 'Dogecoin' },
                      ].filter((tok) => !watchlist?.some((w) => (w.symbol || '').toUpperCase() === tok.symbol)).map((tok) => (
                        <button
                          key={tok.symbol}
                          type="button"
                          className="watchlists-search-result"
                          onClick={() => {
                            addToWatchlist({ symbol: tok.symbol, name: tok.name, pinned: false })
                            setSearchQuery('')
                          }}
                        >
                          <span className="watchlists-search-result-symbol">{tok.symbol}</span>
                          <span className="watchlists-search-result-name">{tok.name}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

      {/* Portfolio Intelligence — Glass metric cards */}
      {summaryStats && (
        <div className="wl-metrics">
          {/* Health */}
          <div className="wl-mc wl-mc-health">
            <div className="wl-mc-ring-wrap">
              <svg viewBox="0 0 40 40" className="wl-mc-ring">
                <circle cx="20" cy="20" r="17" className="wl-mc-ring-track" />
                <circle
                  cx="20" cy="20" r="17"
                  className={`wl-mc-ring-bar ${summaryStats.healthScore >= 60 ? 'bull' : summaryStats.healthScore >= 35 ? 'warn' : 'bear'}`}
                  strokeDasharray={`${(summaryStats.healthScore / 100) * 106.8} 106.8`}
                  transform="rotate(-90 20 20)"
                />
              </svg>
              <span className="wl-mc-ring-num">{summaryStats.healthScore}</span>
            </div>
            <div className="wl-mc-text">
              <span className="wl-mc-val">{summaryStats.healthScore >= 70
                ? t('watchlists.health.strong', 'Strong')
                : summaryStats.healthScore >= 45
                  ? t('watchlists.health.moderate', 'Moderate')
                  : t('watchlists.health.weak', 'Weak')}</span>
              <span className="wl-mc-label">{t('watchlists.metrics.portfolioHealth', 'Portfolio Health')}<InfoTip text={t('watchlists.tooltips.portfolioHealth', 'Composite score (0–100) based on diversification, volatility, and percentage of gaining assets. Above 70 is strong, below 45 is weak.')} position="bottom" /></span>
            </div>
          </div>

          {/* Market Cap */}
          <div className="wl-mc">
            <span className="wl-mc-label">{t('watchlists.metrics.marketCap', 'Market Cap')}<InfoTip text={t('watchlists.tooltips.marketCap', 'Combined market capitalization of every asset in this watchlist. Market cap = current price × circulating supply.')} position="bottom" /></span>
            <span className="wl-mc-num">{fmtLarge(summaryStats.totalMcap)}</span>
          </div>

          {/* Volume */}
          <div className="wl-mc">
            <span className="wl-mc-label">{t('watchlists.metrics.volume24h', '24h Volume')}<InfoTip text={t('watchlists.tooltips.volume24h', 'Total trading volume in the last 24 hours. The V/MC ratio below shows volume relative to market cap — higher ratios indicate more active trading.')} position="bottom" /></span>
            <span className="wl-mc-num">{fmtLarge(summaryStats.totalVolume)}</span>
            <span className="wl-mc-sub">{t('watchlists.quickStats.vmRatio', 'V/MC {{pct}}%', { pct: summaryStats.vmRatio.toFixed(1) })}</span>
          </div>

          {/* Liquidity */}
          <div className="wl-mc">
            <span className="wl-mc-label">{t('watchlists.metrics.liquidity', 'Liquidity')}<InfoTip text={t('watchlists.tooltips.liquidity', 'Total available liquidity in DEX pools for on-chain tokens. Higher liquidity means less slippage when trading.')} position="bottom" /></span>
            {/* '-' rather than the page's EMPTY sentinel: an "∞" under a Liquidity
                label reads as *infinite* liquidity, the opposite of "we don't
                have this number". Matches the column below it. */}
            <span className="wl-mc-num">{summaryStats.totalLiquidity > 0 ? fmtLarge(summaryStats.totalLiquidity) : '-'}</span>
          </div>

          {/* Avg Change */}
          <div className="wl-mc">
            <span className="wl-mc-label">{t('watchlists.metrics.avgChange', 'Avg Change')}<InfoTip text={t('watchlists.tooltips.avgChangeBar', 'Average 24h price change across all assets. The bar shows the bull/bear ratio — what percentage of your assets are in the green.')} position="bottom" /></span>
            <span className={`wl-mc-num ${summaryStats.avgChange >= 0 ? 'bull' : 'bear'}`}>
              {formatChange(summaryStats.avgChange)}
            </span>
            <div className="wl-mc-bar-row">
              <span className="wl-mc-bar-track">
                <span className="wl-mc-bar-fill" style={{ width: `${summaryStats.bullRatio}%` }} />
              </span>
              <span className="wl-mc-bar-pct">{summaryStats.bullRatio}%</span>
            </div>
          </div>

          {/* Volatility */}
          <div className="wl-mc">
            <span className="wl-mc-label">{t('watchlists.metrics.volatility', 'Volatility')}<InfoTip text={t('watchlists.tooltips.volatility', 'Standard deviation of 24h price changes across your assets. Higher volatility means wider price swings and potentially more risk.')} position="bottom" /></span>
            <span className="wl-mc-num">{summaryStats.volatility.toFixed(1)}%</span>
            <span className="wl-mc-sub">{t('watchlists.quickStats.stdDev', 'std dev')}</span>
          </div>

          {/* Assets */}
          <div className="wl-mc">
            <span className="wl-mc-label">{t('watchlists.metrics.assets', 'Assets')}<InfoTip text={t('watchlists.tooltips.assets', 'Total number of tokens or stocks in this watchlist, with the percentage currently in positive territory.')} position="bottom" /></span>
            <span className="wl-mc-num">{summaryStats.count}</span>
            <span className="wl-mc-sub">{t('watchlists.metrics.gainingRatio', '{{pct}}% gaining', { pct: summaryStats.bullRatio })}</span>
          </div>

          {/* Top Movers */}
          <div className="wl-mc wl-mc-movers">
            <span className="wl-mc-label">{t('watchlists.metrics.topMovers', 'Top Movers')}<InfoTip text={t('watchlists.tooltips.topMovers', 'Best and worst performing assets in the last 24 hours. Shows which tokens are leading gains and losses in your watchlist.')} position="bottom" /></span>
            <div className="wl-mc-mover-list">
              <div className="wl-mc-mover bull">
                {summaryStats.bestToken?.logo && <img src={summaryStats.bestToken.logo} alt="" className="wl-mc-mover-ava" />}
                <span className="wl-mc-mover-sym">{summaryStats.bestToken?.symbol || '-'}</span>
                <span className="wl-mc-mover-badge bull">{formatChange(summaryStats.bestToken?.change24h)}</span>
              </div>
              <div className="wl-mc-mover bear">
                {summaryStats.worstToken?.logo && <img src={summaryStats.worstToken.logo} alt="" className="wl-mc-mover-ava" />}
                <span className="wl-mc-mover-sym">{summaryStats.worstToken?.symbol || '-'}</span>
                <span className="wl-mc-mover-badge bear">{formatChange(summaryStats.worstToken?.change24h)}</span>
              </div>
            </div>
          </div>

          {/* Heat Strip */}
          <div className="wl-mc-heat" title={t('watchlists.heatStrip.title', 'Portfolio heat: green = gainers, red = losers')}><InfoTip text={t('watchlists.tooltips.heatStrip', 'Visual heat strip of your portfolio. Each segment represents one asset — green for gainers, red for losers. Brighter colors mean bigger moves.')} position="top" />
            {summaryStats.heatStrip.map((seg, i) => (
              <div
                key={`${seg.symbol}-${i}`}
                className={`wl-mc-heat-seg ${seg.change >= 0 ? 'bull' : 'bear'}`}
                style={{ flex: 1, opacity: 0.25 + Math.min(Math.abs(seg.change) / 12, 0.75) }}
                title={`${seg.symbol}: ${formatChange(seg.change)}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Toolbar — tabs + view toggle + actions, all one row */}
      <div className="wl-toolbar">
        <div className="wl-tabs-scroll">
          {watchlists.map(w => (
            <button
              key={w.id}
              type="button"
              className={`wl-tab ${w.id === activeWatchlistId ? 'active' : ''}`}
              onClick={() => onSwitchWatchlist?.(w.id)}
            >
              <span className="wl-tab-name">
                {editingName && w.id === activeWatchlistId ? (
                  <input
                    ref={nameInputRef}
                    type="text"
                    className="wl-tab-rename-input"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onBlur={handleNameBlur}
                    onKeyDown={handleNameKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    placeholder={t('watchlist.myWatchlist')}
                  />
                ) : (
                  typeof w.name === 'string' ? w.name : t('watchlists.unnamed', 'Unnamed')
                )}
              </span>
              <span className="wl-tab-count">{typeof w.tokenCount === 'number' ? w.tokenCount : 0}</span>
            </button>
          ))}
          <button
            type="button"
            className="wl-tab wl-tab-add"
            onClick={() => { setCreateListName(''); setCreateModalOpen(true); }}
            title={t('watchlistPage.addWatchlist')}
            aria-label={t('watchlistPage.addWatchlist')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>

        <div className="wl-toolbar-right">
          {/* View toggle — crypto only */}
          {!isStocks && (
          <div className="wl-view-toggle" role="tablist" aria-label={t('watchlists.viewMode.ariaLabel', 'View mode')}><InfoTip text={t('watchlists.tooltips.viewMode', 'All shows every token. Major shows top coins with weekly/monthly/yearly data. On-Chain shows DEX tokens with chain, age, transactions, makers, and holders.')} position="bottom" />
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'all'}
              className={`wl-toggle-btn ${viewMode === 'all' ? 'active' : ''}`}
              onClick={() => setViewMode('all')}
            >
              {t('watchlists.viewMode.all', 'All')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'major'}
              className={`wl-toggle-btn ${viewMode === 'major' ? 'active' : ''}`}
              onClick={() => setViewMode('major')}
            >
              {t('watchlistPage.major')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'onchain'}
              className={`wl-toggle-btn ${viewMode === 'onchain' ? 'active' : ''}`}
              onClick={() => setViewMode('onchain')}
            >
              {t('watchlistPage.onChain')}
            </button>
          </div>
          )}

          {/* Display view toggle */}
          <div className="wl-view-toggle wl-display-toggle" role="tablist" aria-label={t('watchlists.displayView.ariaLabel', 'Display view')}>
            <button type="button" role="tab" aria-selected={displayView === 'table'} className={`wl-toggle-btn${displayView === 'table' ? ' active' : ''}`} onClick={() => setDisplayView('table')} title={t('watchlists.displayView.table', 'Table view')} aria-label={t('watchlists.displayView.table', 'Table view')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M3 3h18v18H3z" /><path d="M3 9h18M3 15h18M9 3v18" /></svg>
            </button>
            <button type="button" role="tab" aria-selected={displayView === 'bubble'} className={`wl-toggle-btn${displayView === 'bubble' ? ' active' : ''}`} onClick={() => setDisplayView('bubble')} title={t('watchlists.displayView.bubble', 'Bubble view')} aria-label={t('watchlists.displayView.bubble', 'Bubble view')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><circle cx="10" cy="10" r="7" /><circle cx="18" cy="8" r="4" /><circle cx="16" cy="18" r="3.5" /></svg>
            </button>
            <button type="button" role="tab" aria-selected={displayView === 'heatmap'} className={`wl-toggle-btn${displayView === 'heatmap' ? ' active' : ''}`} onClick={() => setDisplayView('heatmap')} title={t('watchlists.displayView.heatmap', 'Heatmap view')} aria-label={t('watchlists.displayView.heatmap', 'Heatmap view')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><rect x="2" y="2" width="9" height="11" rx="1" /><rect x="13" y="2" width="9" height="6" rx="1" /><rect x="13" y="10" width="9" height="12" rx="1" /><rect x="2" y="15" width="9" height="7" rx="1" /></svg>
            </button>
            <button type="button" role="tab" aria-selected={displayView === 'analysis'} className={`wl-toggle-btn${displayView === 'analysis' ? ' active' : ''}`} onClick={() => setDisplayView('analysis')} title={t('watchlists.displayView.analysis', 'Analysis view')} aria-label={t('watchlists.displayView.analysis', 'Analysis view')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M3 3v18h18" strokeLinecap="round" /><path d="M7 14l3-3 3 3 5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>

          {/* Column customization */}
          {displayView === 'table' && (
            <div className="wl-columns-wrap" ref={columnsRef}>
              <button type="button" className={`wl-action-icon-btn${columnsOpen ? ' active' : ''}`} onClick={() => setColumnsOpen(v => !v)} title={t('watchlists.columns.customize', 'Customize columns')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                  <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
              {columnsOpen && (
                <div className="wl-columns-dropdown">
                  <div className="wl-columns-title">{t('watchlists.columns.title', 'Columns')}</div>
                  <div className="wl-columns-group">
                    <div className="wl-columns-group-label">{t('watchlists.columns.dataGroup', 'Data')}</div>
                    {[
                      { key: 'volume', label: t('watchlists.columns.volume', 'Volume') },
                      { key: 'liquidity', label: t('watchlists.columns.liquidity', 'Liquidity') },
                      { key: 'mcap', label: t('watchlists.columns.marketCap', 'Market Cap') },
                      { key: 'trend', label: t('watchlists.columns.trend', 'Trend') },
                    ].map(c => (
                      <label key={c.key} className="wl-columns-item">
                        <input type="checkbox" checked={visibleColumns[c.key]} onChange={() => toggleColumn(c.key)} />
                        <span>{c.label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="wl-columns-group">
                    <div className="wl-columns-group-label">{t('watchlists.columns.onChainGroup', 'On-Chain')}</div>
                    {[
                      { key: 'chain', label: t('watchlists.columns.chain', 'Chain') },
                      { key: 'age', label: t('watchlists.columns.age', 'Age') },
                      { key: 'txns', label: t('watchlists.columns.transactions', 'Transactions') },
                      { key: 'makers', label: t('watchlists.columns.makers', 'Makers') },
                      { key: 'holders', label: t('watchlists.columns.holders', 'Holders') },
                    ].map(c => (
                      <label key={c.key} className="wl-columns-item">
                        <input type="checkbox" checked={visibleColumns[c.key]} onChange={() => toggleColumn(c.key)} />
                        <span>{c.label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="wl-columns-group">
                    <div className="wl-columns-group-label">{t('watchlists.columns.timeframesGroup', 'Timeframes')}</div>
                    {[
                      { key: 'change5m', label: '5M' },
                      { key: 'change1h', label: '1H' },
                      { key: 'change6h', label: '6H' },
                      { key: 'change24h', label: '24H' },
                      { key: 'change1w', label: '1W' },
                      { key: 'change1m', label: '1M' },
                      { key: 'change1y', label: '1Y' },
                    ].map(c => (
                      <label key={c.key} className="wl-columns-item">
                        <input type="checkbox" checked={visibleColumns[c.key]} onChange={() => toggleColumn(c.key)} />
                        <span>{c.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="wl-toolbar-sep" />

          {/* Action icons */}
          <button
            type="button"
            className="wl-action-icon-btn"
            onClick={() => setEditingName(true)}
            title={t('watchlist.rename')}
            aria-label={t('watchlist.rename')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            type="button"
            className="wl-action-icon-btn"
            onClick={() => { setImportError(null); setImportDone(null); setImportOpen(true); }}
            title={t('watchlistPage.importFromDex')}
            aria-label={t('watchlistPage.importFromDex')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <button
            type="button"
            className="wl-action-icon-btn"
            onClick={() => { setManageListOpen(true); setNewListName(''); setEditingListId(null); }}
            title={t('watchlistPage.manageList')}
            aria-label={t('watchlistPage.manageList')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
            </svg>
          </button>
          <button
            type="button"
            className="wl-action-icon-btn wl-action-delete"
            onClick={() => watchlists.length > 1 && setDeleteConfirm({ id: activeWatchlistId, name: watchlistName || t('watchlists.unnamed', 'Unnamed') })}
            disabled={watchlists.length <= 1}
            title={watchlists.length <= 1 ? t('watchlistPage.keepAtLeastOne') : t('watchlistPage.removeWatchlist')}
            aria-label={watchlists.length <= 1 ? t('watchlistPage.keepAtLeastOne') : t('watchlistPage.removeWatchlist')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>

      {displayView === 'table' && (() => {
        const displayedTokens = isStocks ? sortedTokens : mobileFilteredTokens
        // Show skeleton rows while prices fetch for an already-populated watchlist.
        // Empty-state is reserved for when load completes with zero tokens.
        const showSkeleton = !isStocks && pricesLoading && watchlist.length > 0 && displayedTokens.length === 0
        const skeletonRowCount = Math.min(Math.max(watchlist.length, 5), 8)
        return <div className={`watchlists-table-container welcome-watchlist-widget${displayedTokens.length === 0 && !showSkeleton ? ' watchlists-table-container--empty' : ''}${dayMode ? ' watchlists-table-container-day' : ''}`}>
        {showSkeleton ? (
          <table className="watchlists-table">
            <tbody>
              {Array.from({ length: skeletonRowCount }).map((_, i) => (
                <tr key={`wl-skel-${i}`} className="watchlists-row watchlists-row--skeleton">
                  <td className="wl-skel-cell"><span className="wl-skel-block wl-skel-block--icon animate-shimmer" /></td>
                  <td className="wl-skel-cell"><span className="wl-skel-block wl-skel-block--num animate-shimmer" /></td>
                  <td className="wl-skel-cell">
                    <div className="wl-skel-token">
                      <span className="wl-skel-block wl-skel-block--logo animate-shimmer" />
                      <span className="wl-skel-block wl-skel-block--symbol animate-shimmer" />
                    </div>
                  </td>
                  <td className="wl-skel-cell"><span className="wl-skel-block wl-skel-block--price animate-shimmer" /></td>
                  <td className="wl-skel-cell"><span className="wl-skel-block wl-skel-block--pill animate-shimmer" /></td>
                  <td className="wl-skel-cell"><span className="wl-skel-block wl-skel-block--pill animate-shimmer" /></td>
                  <td className="wl-skel-cell"><span className="wl-skel-block wl-skel-block--spark animate-shimmer" /></td>
                  <td className="wl-skel-cell"><span className="wl-skel-block wl-skel-block--price animate-shimmer" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : displayedTokens.length === 0 ? (
          <div className="watchlists-empty-state-wrap">
            <div className="watchlists-empty-state-inner">
              <p className="watchlists-empty-state-text">{t('watchlistPage.noTokensInWatchlist')}</p>
              <button
                type="button"
                className="watchlists-empty-state-add-btn"
                onClick={() => searchInputRef.current?.focus()}
                title={t('watchlist.addToken')}
                aria-label={t('watchlist.addToken')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>{t('watchlist.addToken')}</span>
              </button>
            </div>
          </div>
        ) : (
        <table className="watchlists-table">
          <colgroup>
            {isStocks ? (
              <>
                {/* Actions | # | STOCK | PRICE | EXCHANGE | SECTOR | VOLUME | 24H | P/E | 52W RANGE | TREND | MCAP */}
                <col style={{ width: '3%' }} />
                <col style={{ width: '3.5%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '5%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '9%' }} />
              </>
            ) : (
              <>
                {/* Actions | # | TOKEN | PRICE | CHAIN | AGE | TXNS | VOLUME | MAKERS | HOLDERS | 5M | 1H | 6H | 24H | 1W | 1M | 1Y | TREND | LIQUIDITY | MCAP */}
                <col style={{ width: '3%' }} />
                <col style={{ width: '3.5%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '8%' }} />
                {viewMode === 'onchain' && <col style={{ width: '5.5%' }} />}
                {viewMode === 'onchain' && <col style={{ width: '4.5%' }} />}
                {viewMode === 'onchain' && <col style={{ width: '5.5%' }} />}
                <col style={{ width: '7%' }} />
                {viewMode === 'onchain' && <col style={{ width: '5.5%' }} />}
                {viewMode === 'onchain' && <col style={{ width: '5.5%' }} />}
                {viewMode === 'onchain' && <col style={{ width: '5.5%' }} />}
                <col style={{ width: '5.5%' }} />
                {viewMode === 'onchain' && <col style={{ width: '5.5%' }} />}
                <col style={{ width: '5.5%' }} />
                {viewMode !== 'onchain' && <col style={{ width: '5.5%' }} />}
                {viewMode !== 'onchain' && <col style={{ width: '5.5%' }} />}
                {viewMode !== 'onchain' && <col style={{ width: '5.5%' }} />}
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
              </>
            )}
          </colgroup>
          <thead>
            <tr>
              <th className="watchlists-th-actions" aria-label={t('watchlists.table.actions', 'Actions')} />
              <th onClick={() => handleSort('rank')}>
                # {sortColumn === 'rank' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
              </th>
              <th onClick={() => handleSort('symbol')}>
                {isStocks ? t('watchlists.table.stock', 'STOCK') : t('common.token').toUpperCase()} {sortColumn === 'symbol' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
              </th>
              <th onClick={() => handleSort('price')}>
                {t('common.price').toUpperCase()} {sortColumn === 'price' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
              </th>
              {isStocks ? (
                <>
                  <th onClick={() => handleSort('exchange')}>
                    {t('watchlists.table.exchange', 'EXCHANGE')} {sortColumn === 'exchange' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                  <th onClick={() => handleSort('sector')}>
                    {t('watchlists.table.sector', 'SECTOR')} {sortColumn === 'sector' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                  <th onClick={() => handleSort('volume')}>
                    {t('common.volume').toUpperCase()} {sortColumn === 'volume' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                  <th onClick={() => handleSort('change24h')}>
                    24H {sortColumn === 'change24h' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                  <th onClick={() => handleSort('pe')}>
                    P/E {sortColumn === 'pe' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                  <th onClick={() => handleSort('week52High')}>
                    {t('watchlists.table.range52w', '52W RANGE')} {sortColumn === 'week52High' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                  <th className="wl-th-trend">{t('watchlists.table.trend', 'TREND')}</th>
                  <th onClick={() => handleSort('mcap')}>
                    {t('common.marketCap').toUpperCase()} {sortColumn === 'mcap' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                </>
              ) : (
                <>
                  {viewMode === 'onchain' && visibleColumns.chain && (
                    <th className="wl-th-chain" onClick={() => handleSort('chain')}>
                      {t('common.chain').toUpperCase()} {sortColumn === 'chain' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  )}
                  {viewMode === 'onchain' && visibleColumns.age && (
                    <th onClick={() => handleSort('age')}>
                      {t('common.age').toUpperCase()} {sortColumn === 'age' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  )}
                  {viewMode === 'onchain' && visibleColumns.txns && (
                    <th onClick={() => handleSort('txns')}>
                      {t('watchlists.table.txns', 'TXNS')} {sortColumn === 'txns' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  )}
                  {visibleColumns.volume && (
                    <th onClick={() => handleSort('volume')}>
                      {t('common.volume').toUpperCase()} {sortColumn === 'volume' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  )}
                  {viewMode === 'onchain' && visibleColumns.makers && (
                    <th onClick={() => handleSort('makers')}>
                      {t('common.makers').toUpperCase()} {sortColumn === 'makers' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  )}
                  {viewMode === 'onchain' && visibleColumns.holders && (
                    <th onClick={() => handleSort('holders')}>
                      {t('common.holders').toUpperCase()} {sortColumn === 'holders' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  )}
                  {viewMode === 'onchain' && visibleColumns.change5m && <th onClick={() => handleSort('change5m')}>5M {sortColumn === 'change5m' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}</th>}
                  {visibleColumns.change1h && <th className="wl-col-1h" onClick={() => handleSort('change1h')}>1H {sortColumn === 'change1h' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}</th>}
                  {viewMode === 'onchain' && visibleColumns.change6h && <th onClick={() => handleSort('change6h')}>6H {sortColumn === 'change6h' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}</th>}
                  {visibleColumns.change24h && <th onClick={() => handleSort('change24h')}>24H {sortColumn === 'change24h' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}</th>}
                  {viewMode !== 'onchain' && visibleColumns.change1w && <th onClick={() => handleSort('change1w')}>1W {sortColumn === 'change1w' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}</th>}
                  {viewMode !== 'onchain' && visibleColumns.change1m && <th onClick={() => handleSort('change1m')}>1M {sortColumn === 'change1m' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}</th>}
                  {viewMode !== 'onchain' && visibleColumns.change1y && <th className="wl-col-1y" onClick={() => handleSort('change1y')}>1Y {sortColumn === 'change1y' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}</th>}
                  {visibleColumns.trend && <th className="wl-th-trend">{t('watchlists.table.trend', 'TREND')}</th>}
                  {visibleColumns.liquidity && (
                    <th onClick={() => handleSort('liquidity')}>
                      {t('common.liquidity').toUpperCase()} {sortColumn === 'liquidity' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  )}
                  {visibleColumns.mcap && (
                    <th onClick={() => handleSort('mcap')}>
                      {t('common.marketCap').toUpperCase()} {sortColumn === 'mcap' && <span className="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  )}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {(isStocks ? sortedTokens : mobileFilteredTokens).map((token, index) => (
                <WatchlistRow
                  key={token.id}
                  token={token}
                  index={index}
                  isStocks={isStocks}
                  viewMode={viewMode}
                  visibleColumns={visibleColumns}
                  dayMode={dayMode}
                  draggedRowIndex={draggedRowIndex}
                  dragOverRowIndex={dragOverRowIndex}
                  reorderWatchlist={reorderWatchlist}
                  onTokenClick={onTokenClick}
                  resolveRouteMode={resolveRouteMode}
                  removeFromWatchlist={removeFromWatchlist}
                  togglePinWatchlist={togglePinWatchlist}
                  handleDragStart={handleDragStart}
                  handleDragEnter={handleDragEnter}
                  handleDragOver={handleDragOver}
                  handleDragEnd={handleDragEnd}
                  handleDrop={handleDrop}
                  fmtPrice={fmtPrice}
                  fmtLarge={fmtLarge}
                  t={t}
                  locale={i18n.language}
                />
              ))}
          </tbody>
        </table>
        )}

      </div>
      })()}
      </div>
      )}

      {/* =========== BUBBLE VIEW (D3 force - same as bubbles page) =========== */}
      {!isMobile && displayView === 'bubble' && sortedTokens.length > 0 && (
        <div className="wl-bubbles-container" ref={bubbleArenaRef} style={{ height: Math.min(680, Math.max(360, sortedTokens.length * 14 + 200)) }}>
          <div className="bubbles-arena">
            {packedBubbles.map((token, idx) => {
              const change = token.change24h || 0
              const absChange = Math.abs(change)
              const isPositive = change >= 0
              const intensity = Math.min(1, absChange / 10)
              const cr = isPositive ? '16, 185, 129' : '239, 68, 68'
              const baseAlpha = 0.15 + intensity * 0.40
              const topAlpha = Math.max(0.06, baseAlpha * 0.5)
              const bottomAlpha = baseAlpha + 0.10
              const bgColor = `rgba(${cr}, ${baseAlpha.toFixed(3)})`
              const bgTop = `rgba(${cr}, ${topAlpha.toFixed(3)})`
              const bgBottom = `rgba(${cr}, ${bottomAlpha.toFixed(3)})`
              const borderColor = isPositive
                ? `rgba(16, 185, 129, ${(0.20 + intensity * 0.30).toFixed(3)})`
                : `rgba(239, 68, 68, ${(0.20 + intensity * 0.30).toFixed(3)})`
              const rowColors = TOKEN_ROW_COLORS[(token.symbol || '').toUpperCase()]
              const brandRgb = rowColors?.bg || '255, 255, 255'
              const r = token.radius || 30
              const showLogo = r > 28
              const showChange = r > 32
              const showName = r > 55
              return (
                <div
                  key={token.symbol || idx}
                  className={`bubble-node ${isPositive ? 'positive' : 'negative'}`}
                  style={{
                    width: r * 2, height: r * 2,
                    transform: `translate3d(${token.x - r}px, ${token.y - r}px, 0)`,
                    '--bubble-bg': bgColor, '--bubble-bg-top': bgTop, '--bubble-bg-bottom': bgBottom,
                    '--bubble-border': borderColor, '--bubble-brand-rgb': brandRgb,
                  }}
                  onClick={onTokenClick ? () => onTokenClick(token, resolveRouteMode(token)) : undefined}
                >
                  <div className="bubble-content">
                    {showLogo && (
                      <div className="bubble-logo" style={{ width: Math.max(16, r * 0.44), height: Math.max(16, r * 0.44) }}>
                        {token.logo ? (
                          <img
                            src={token.logo}
                            alt={token.symbol}
                            onError={(e) => {
                              const parent = e.target.parentElement
                              e.target.remove()
                              if (parent) {
                                const span = document.createElement('span')
                                span.textContent = (token.symbol?.[0] || '?')
                                parent.appendChild(span)
                              }
                            }}
                          />
                        ) : (
                          <span>{token.symbol?.[0] || '?'}</span>
                        )}
                      </div>
                    )}
                    <span className="bubble-symbol" style={{ fontSize: Math.max(9, r * 0.22) }}>{token.symbol}</span>
                    {showName && <span className="bubble-name" style={{ fontSize: Math.max(8, r * 0.14) }}>{token.name}</span>}
                    {showChange && (
                      <span className={`bubble-change ${isPositive ? 'pos' : 'neg'}`} style={{ fontSize: Math.max(8, r * 0.18) }}>
                        {isPositive ? '+' : ''}{change.toFixed(2)}%
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* =========== HEATMAP VIEW (4 modes - same as heatmaps page) =========== */}
      {!isMobile && displayView === 'heatmap' && sortedTokens.length > 0 && (
        <div className="wl-treemap-wrapper">
          <div className="wl-treemap-toolbar">
            <div className="wl-treemap-timeframes">
              {['1h', '24h', '7d'].map(tf => (
                <button key={tf} className={`wl-treemap-tf-btn${heatmapTimeframe === tf ? ' active' : ''}`} onClick={() => setHeatmapTimeframe(tf)}>
                  {tf.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="wl-heatmap-sort">
              {[
                ['market_cap', t('watchlists.heatmap.sortMcap', 'MCap')],
                ['volume', t('watchlists.heatmap.sortVol', 'Vol')],
                ['gainers', t('watchlists.heatmap.sortBest', 'Best %')],
                ['losers', t('watchlists.heatmap.sortWorst', 'Worst %')],
                ['change', t('watchlists.heatmap.sortChange', 'Change')],
              ].map(([key, label]) => (
                <button key={key} className={`wl-treemap-tf-btn${heatmapSort === key ? ' active' : ''}`} onClick={() => setHeatmapSort(key)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="wl-heatmap-views">
              <button className={`wl-heatmap-view-btn${heatmapMode === 'grid' ? ' active' : ''}`} onClick={() => setHeatmapMode('grid')} title={t('watchlists.heatmap.gridView', 'Grid view')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                </svg>
              </button>
              <button className={`wl-heatmap-view-btn${heatmapMode === 'treemap' ? ' active' : ''}`} onClick={() => setHeatmapMode('treemap')} title={t('watchlists.heatmap.treemapView', 'Treemap view')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="10" height="10" /><rect x="15" y="3" width="6" height="6" /><rect x="15" y="11" width="6" height="4" /><rect x="3" y="15" width="7" height="6" /><rect x="12" y="17" width="9" height="4" />
                </svg>
              </button>
              <button className={`wl-heatmap-view-btn${heatmapMode === 'chart' ? ' active' : ''}`} onClick={() => setHeatmapMode('chart')} title={t('watchlists.heatmap.chartView', 'Bar chart view')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </button>
              <button className={`wl-heatmap-view-btn${heatmapMode === 'dual' ? ' active' : ''}`} onClick={() => setHeatmapMode('dual')} title={t('watchlists.heatmap.dualView', 'Dual view')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="8" height="18" rx="1" /><rect x="13" y="3" width="8" height="18" rx="1" />
                </svg>
              </button>
            </div>
          </div>
          <div className="wl-treemap-container">
            {/* Treemap mode */}
            {heatmapMode === 'treemap' && (
              <Suspense fallback={null}>
                <TreemapView
                  tokens={treemapTokens}
                  getChange={getHeatmapChange}
                  fmtPrice={fmtPrice}
                  dayMode={dayMode}
                  isStocks={isStocks}
                  isFullscreen={false}
                  onTokenClick={onTokenClick ? (token) => onTokenClick(token, resolveRouteMode(token)) : undefined}
                  binancePrices={null}
                  timeframe={heatmapTimeframe}
                />
              </Suspense>
            )}

            {/* Grid mode */}
            {heatmapMode === 'grid' && (() => {
              const count = mappedTokens.length
              const cols = count <= 5 ? count : count <= 10 ? 5 : 10
              const maxVolume = Math.max(...mappedTokens.map(t => t.volume || 0), 1)
              return (
                <div className="heatmap-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                  {mappedTokens.map((token, idx) => {
                    const change = getHeatmapChange(token)
                    const absChange = Math.abs(change)
                    const isPositive = change >= 0
                    const intensity = Math.min(1, absChange / 10)
                    const bgColor = isPositive
                      ? `rgba(16, 185, 129, ${0.03 + intensity * 0.12})`
                      : `rgba(239, 68, 68, ${0.03 + intensity * 0.12})`
                    const borderColor = isPositive
                      ? `rgba(16, 185, 129, ${0.04 + intensity * 0.08})`
                      : `rgba(239, 68, 68, ${0.04 + intensity * 0.08})`
                    const accentAlpha = (0.15 + intensity * 0.55).toFixed(2)
                    const rowColors = TOKEN_ROW_COLORS[(token.symbol || '').toUpperCase()]
                    const brandRgb = rowColors?.bg || '255, 255, 255'
                    const volPct = ((token.volume || 0) / maxVolume * 100).toFixed(1)
                    return (
                      <div
                        key={token.symbol || idx}
                        className={`heatmap-tile ${isPositive ? 'is-positive' : 'is-negative'}${onTokenClick ? ' heatmap-tile--clickable' : ''}`}
                        style={{
                          '--tile-bg': bgColor,
                          '--tile-border': borderColor,
                          '--tile-brand-rgb': brandRgb,
                          '--tile-accent-alpha': accentAlpha,
                          '--tile-accent-rgb': isPositive ? '16, 185, 129' : '239, 68, 68',
                          animationDelay: `${Math.min(idx * 15, 600)}ms`,
                        }}
                        onClick={() => onTokenClick && onTokenClick(token, resolveRouteMode(token))}
                      >
                        <span className="heatmap-tile-rank">#{idx + 1}</span>
                        <div className="heatmap-tile-top">
                          <div className="heatmap-tile-logo">
                            {token.logo ? (
                              <img
                                src={token.logo}
                                alt={token.symbol}
                                onError={(e) => {
                                  // PWA CacheFirst (token-logos-v2) can still
                                  // serve a stale broken response. Swap the
                                  // img for the first-letter span so the
                                  // tile never renders as an empty circle.
                                  const parent = e.target.parentElement
                                  e.target.remove()
                                  if (parent) {
                                    const span = document.createElement('span')
                                    span.textContent = (token.symbol?.[0] || '?')
                                    parent.appendChild(span)
                                  }
                                }}
                              />
                            ) : (
                              <span>{token.symbol?.[0] || '?'}</span>
                            )}
                          </div>
                          <span className="heatmap-tile-symbol">{token.symbol}</span>
                        </div>
                        {count <= 50 && <div className="heatmap-tile-name">{token.name}</div>}
                        <div className="heatmap-tile-bottom">
                          <span className="heatmap-tile-price">{token.price ? fmtPrice(token.price) : '-'}</span>
                          <span className={`heatmap-tile-change ${isPositive ? 'positive' : 'negative'}`}>
                            {isPositive ? '+' : ''}{change.toFixed(2)}%
                          </span>
                        </div>
                        {count <= 50 && (
                          <div className="heatmap-tile-vol-bar">
                            <div className="heatmap-tile-vol-fill" style={{ width: `${volPct}%` }} />
                          </div>
                        )}
                        <div className="heatmap-tile-accent" />
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            {/* Chart mode (diverging horizontal bars sorted by change) */}
            {heatmapMode === 'chart' && (() => {
              const withChange = mappedTokens.map(token => ({
                token,
                change: getHeatmapChange(token),
              }))
              withChange.sort((a, b) => b.change - a.change)
              const maxAbs = Math.max(...withChange.map(e => Math.abs(e.change)), 1)
              return (
                <div className="heatmap-chart-view">
                  <div className="heatmap-chart-header">
                    <span className="heatmap-chart-header-token">{t('watchlists.heatmap.asset', 'Asset')}</span>
                    <span className="heatmap-chart-header-bar">{t('watchlists.heatmap.performance', 'Performance')}</span>
                    <span className="heatmap-chart-header-change">{t('watchlists.heatmap.change', 'Change')}</span>
                    <span className="heatmap-chart-header-price">{t('watchlists.heatmap.price', 'Price')}</span>
                  </div>
                  {withChange.map(({ token, change }, idx) => {
                    const isPositive = change >= 0
                    const barPct = Math.min(100, Math.max(2, (Math.abs(change) / maxAbs) * 100))
                    return (
                      <div
                        key={token.symbol || idx}
                        className={`heatmap-chart-row${isPositive ? ' is-positive' : ' is-negative'}${onTokenClick ? ' heatmap-chart-row--clickable' : ''}`}
                        onClick={() => onTokenClick && onTokenClick(token, resolveRouteMode(token))}
                        style={{ animationDelay: `${Math.min(idx * 12, 400)}ms` }}
                      >
                        <div className="heatmap-chart-token">
                          <span className="heatmap-chart-rank">#{idx + 1}</span>
                          <div className="heatmap-chart-logo">
                            {token.logo ? (
                              <img src={token.logo} alt={token.symbol} onError={(e) => { e.target.style.display = 'none' }} />
                            ) : (
                              <span className="heatmap-chart-logo-fallback">{token.symbol?.[0] || '?'}</span>
                            )}
                          </div>
                          <div className="heatmap-chart-token-info">
                            <span className="heatmap-chart-symbol">{token.symbol}</span>
                            <span className="heatmap-chart-name">{token.name}</span>
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
                          {isPositive ? '+' : ''}{change.toFixed(2)}%
                        </span>
                        <span className="heatmap-chart-price">{token.price ? fmtPrice(token.price) : '-'}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            {/* Dual mode (gainers left, losers right) */}
            {heatmapMode === 'dual' && (() => {
              const withChange = mappedTokens.map(token => ({
                token,
                change: getHeatmapChange(token),
              }))
              const allGainers = withChange.filter(e => e.change >= 0).sort((a, b) => b.change - a.change)
              const allLosers = withChange.filter(e => e.change < 0).sort((a, b) => a.change - b.change)
              const maxAbs = Math.max(...withChange.map(e => Math.abs(e.change)), 1)

              const renderColumn = (items, isGainer) => (
                <div className={`hdc-column${isGainer ? ' hdc-column--bull' : ' hdc-column--bear'}`}>
                  <div className="hdc-col-header">
                    <span className={`hdc-col-badge${isGainer ? ' hdc-col-badge--bull' : ' hdc-col-badge--bear'}`}>
                      {isGainer
                        ? t('watchlists.heatmap.gainerCount', '{{count}} Gainers', { count: items.length })
                        : t('watchlists.heatmap.loserCount', '{{count}} Losers', { count: items.length })}
                    </span>
                  </div>
                  <div className="hdc-col-rows">
                    {items.map(({ token, change }, idx) => {
                      const barPct = Math.min(100, Math.max(2, (Math.abs(change) / maxAbs) * 100))
                      return (
                        <div
                          key={token.symbol || idx}
                          className={`hdc-row${onTokenClick ? ' hdc-row--clickable' : ''}`}
                          onClick={() => onTokenClick && onTokenClick(token, resolveRouteMode(token))}
                          style={{ animationDelay: `${Math.min(idx * 15, 400)}ms` }}
                        >
                          {isGainer ? (
                            <>
                              <div className="hdc-row-token">
                                <div className="hdc-row-logo">
                                  {token.logo ? (
                                    <img src={token.logo} alt={token.symbol} onError={(e) => { e.target.style.display = 'none' }} />
                                  ) : (
                                    <span className="hdc-row-logo-fallback">{token.symbol?.[0] || '?'}</span>
                                  )}
                                </div>
                                <span className="hdc-row-symbol">{token.symbol}</span>
                              </div>
                              <div className="hdc-row-bar-area">
                                <div className="hdc-row-bar-track">
                                  <div className="hdc-row-bar bull" style={{ width: `${barPct}%` }} />
                                </div>
                              </div>
                              <span className="hdc-row-change positive">+{change.toFixed(2)}%</span>
                            </>
                          ) : (
                            <>
                              <span className="hdc-row-change negative">{change.toFixed(2)}%</span>
                              <div className="hdc-row-bar-area">
                                <div className="hdc-row-bar-track">
                                  <div className="hdc-row-bar bear" style={{ width: `${barPct}%` }} />
                                </div>
                              </div>
                              <div className="hdc-row-token hdc-row-token--right">
                                <span className="hdc-row-symbol">{token.symbol}</span>
                                <div className="hdc-row-logo">
                                  {token.logo ? (
                                    <img src={token.logo} alt={token.symbol} onError={(e) => { e.target.style.display = 'none' }} />
                                  ) : (
                                    <span className="hdc-row-logo-fallback">{token.symbol?.[0] || '?'}</span>
                                  )}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )

              return (
                <div className="heatmap-dual-container">
                  {renderColumn(allGainers, true)}
                  <div className="hdc-divider" />
                  {renderColumn(allLosers, false)}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* =========== ANALYSIS VIEW =========== */}
      {/* Portfolio holdings + connect-wallet are wired through props as
          stubs for now — the watchlist itself does NOT carry cost-basis or
          quantity data. Wire `holdings` to a real positions store and the
          two `on*` callbacks to your existing wallet/holdings flows when
          ready. Until then the Portfolio card renders the CTA. */}
      {!isMobile && displayView === 'analysis' && (
        <Suspense fallback={null}>
          <WatchlistAnalysisPanel
            tokens={sortedTokens}
            isActive={displayView === 'analysis'}
            holdings={null}
            onAddHoldings={() => { /* TODO: open manual-holdings modal */ }}
            onConnectWallet={() => { /* TODO: trigger Privy login flow */ }}
          />
        </Suspense>
      )}

      {/* =========== MODALS (render on both mobile & desktop) =========== */}
      {/* Manage List Modal */}
      {manageListOpen && (
        <AppPortal className={`watchlists-page${dayMode ? ' day-mode' : ''}`}>
        <div className="manage-list-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setManageListOpen(false); setEditingListId(null); } }} role="dialog" aria-modal="true" aria-labelledby="manage-list-title">
          <div className="manage-list-modal" onClick={(e) => e.stopPropagation()}>
            <div className="manage-list-header">
              <h2 id="manage-list-title" className="manage-list-title">{t('watchlistPage.manageLists')}</h2>
              <button type="button" className="manage-list-close" onClick={() => { setManageListOpen(false); setEditingListId(null); setNewListName(''); }} aria-label={t('common.close', 'Close')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="manage-list-new-row">
              <input type="text" className="manage-list-new-input" placeholder={t('watchlistPage.newList')} value={newListName} onChange={(e) => setNewListName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleCreateList(); }} />
              <button type="button" className="manage-list-create-btn" onClick={handleCreateList}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                <span>{t('watchlistPage.createList')}</span>
              </button>
            </div>
            <ul className="manage-list-list">
              {watchlists.map((w) => (
                <li key={w.id} className="manage-list-item">
                  <div className="manage-list-item-main" onClick={() => { if (editingListId !== w.id) { onSwitchWatchlist?.(w.id); setManageListOpen(false); } }}>
                    <span className="manage-list-item-drag" aria-hidden>
                      <svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="4" height="4" rx="0.5" /><rect x="10" y="3" width="4" height="4" rx="0.5" /><rect x="17" y="3" width="4" height="4" rx="0.5" /><rect x="3" y="10" width="4" height="4" rx="0.5" /><rect x="10" y="10" width="4" height="4" rx="0.5" /><rect x="17" y="10" width="4" height="4" rx="0.5" /><rect x="3" y="17" width="4" height="4" rx="0.5" /><rect x="10" y="17" width="4" height="4" rx="0.5" /><rect x="17" y="17" width="4" height="4" rx="0.5" /></svg>
                    </span>
                    <div className="manage-list-item-info">
                      {editingListId === w.id ? (
                        <input type="text" className="manage-list-item-rename-input" value={editingListName} onChange={(e) => setEditingListName(e.target.value)} onBlur={handleSaveRename} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveRename(); if (e.key === 'Escape') setEditingListId(null); }} onClick={(e) => e.stopPropagation()} autoFocus />
                      ) : (
                        <span className="manage-list-item-name">{w.name || t('watchlists.unnamed', 'Unnamed')}</span>
                      )}
                      <span className="manage-list-item-meta">{t('watchlists.manage.pairCount', '{{count}} pairs', { count: w.tokenCount ?? 0 })}, {formatUpdatedAt(w.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="manage-list-item-actions">
                    <button type="button" className="manage-list-item-btn manage-list-rename-btn" onClick={(e) => { e.stopPropagation(); editingListId === w.id ? handleSaveRename() : handleStartRename(w); }} title={t('watchlist.rename')} aria-label={t('watchlist.rename')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    </button>
                    <button type="button" className="manage-list-item-btn manage-list-delete-btn" onClick={(e) => { e.stopPropagation(); if (watchlists.length > 1) setDeleteConfirm({ id: w.id, name: w.name || t('watchlists.unnamed', 'Unnamed') }); }} disabled={watchlists.length <= 1} title={watchlists.length <= 1 ? t('watchlistPage.keepAtLeastOne') : t('watchlist.delete')} aria-label={t('watchlistPage.delete')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
        </AppPortal>
      )}

      {/* Delete watchlist confirmation */}
      {deleteConfirm && (
        <AppPortal className={`watchlists-page${dayMode ? ' day-mode' : ''}`}>
        <div className="manage-list-overlay delete-confirm-overlay" onClick={(e) => { if (e.target === e.currentTarget) setDeleteConfirm(null); }} role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
          <div className="delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h2 id="delete-confirm-title" className="delete-confirm-title">{t('watchlistPage.deleteWatchlist')}</h2>
            <p className="delete-confirm-message">{t('watchlistPage.deleteConfirm', { name: deleteConfirm.name })}</p>
            <div className="delete-confirm-actions">
              <button type="button" className="delete-confirm-cancel" onClick={() => setDeleteConfirm(null)}>{t('common.cancel')}</button>
              <button type="button" className="delete-confirm-delete" onClick={() => { onRemoveWatchlist?.(deleteConfirm.id); setDeleteConfirm(null); setManageListOpen(false); }}>{t('watchlistPage.delete')}</button>
            </div>
          </div>
        </div>
        </AppPortal>
      )}

      {/* Create Watchlist Modal */}
      {createModalOpen && (
        <AppPortal className={`watchlists-page${dayMode ? ' day-mode' : ''}`}>
        <div className="manage-list-overlay wl-create-overlay" onClick={(e) => { if (e.target === e.currentTarget) setCreateModalOpen(false); }} role="dialog" aria-modal="true" aria-labelledby="create-list-title">
          <div className="wl-create-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="wl-create-close" onClick={() => setCreateModalOpen(false)} aria-label={t('common.close', 'Close')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
            <div className="wl-create-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg></div>
            <h2 id="create-list-title" className="wl-create-title">{t('watchlists.create.title', 'New Watchlist')}</h2>
            <p className="wl-create-desc">{t('watchlists.create.description', 'Track tokens that matter to you.')}</p>
            <div className="wl-create-field">
              <label className="wl-create-label" htmlFor="wl-create-name">{t('watchlists.create.nameLabel', 'Name')}</label>
              <div className="wl-create-input-wrap">
                <input id="wl-create-name" ref={createInputRef} type="text" className="wl-create-input" placeholder={t('watchlists.create.placeholder', 'e.g. DeFi Blue Chips')} value={createListName} onChange={(e) => setCreateListName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && createListName.trim()) { onAddWatchlist?.(createListName.trim()); setCreateModalOpen(false); setCreateListName(''); } if (e.key === 'Escape') setCreateModalOpen(false); }} maxLength={32} autoFocus spellCheck={false} autoComplete="off" aria-label={t('watchlists.create.placeholder', 'e.g. DeFi Blue Chips')} />
                <span className="wl-create-counter">{createListName.length}/32</span>
              </div>
            </div>
            <div className="wl-create-actions">
              <button type="button" className="wl-create-cancel" onClick={() => setCreateModalOpen(false)}>{t('common.cancel')}</button>
              <button type="button" className="wl-create-submit" disabled={!createListName.trim()} onClick={() => { const name = createListName.trim(); if (!name) return; onAddWatchlist?.(name); setCreateModalOpen(false); setCreateListName(''); }}>{t('watchlists.create.submit', 'Create List')}</button>
            </div>
          </div>
        </div>
        </AppPortal>
      )}

      {/* DexScreener Import Modal */}
      {importOpen && (
        <AppPortal className={`watchlists-page${dayMode ? ' day-mode' : ''}`}>
        <div className="watchlists-import-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setImportOpen(false); setImportError(null); setImportDone(null); setImportUrl(''); setImportMode('url'); setImportAddresses(''); setImportPreview(null); } }} role="dialog" aria-modal="true" aria-labelledby="import-modal-title">
          <div className="watchlists-import-modal" onClick={(e) => e.stopPropagation()}>
            <div className="watchlists-import-modal-header">
              <h2 id="import-modal-title" className="watchlists-import-modal-title">{t('watchlistPage.importFromDex')}</h2>
              <button type="button" className="watchlists-import-modal-close" onClick={() => { setImportOpen(false); setImportError(null); setImportDone(null); setImportUrl(''); setImportMode('url'); setImportAddresses(''); setImportPreview(null); }} aria-label={t('common.close', 'Close')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Mode tabs */}
            <div className="watchlists-import-tabs">
              <button className={`watchlists-import-tab${importMode === 'url' ? ' active' : ''}`} onClick={() => { setImportMode('url'); setImportError(null); setImportPreview(null); }}>{t('watchlists.import.pasteUrl', 'Paste URL')}</button>
              <button className={`watchlists-import-tab${importMode === 'addresses' ? ' active' : ''}`} onClick={() => { setImportMode('addresses'); setImportError(null); setImportPreview(null); }}>{t('watchlists.import.pasteAddresses', 'Paste Addresses')}</button>
            </div>

            {importMode === 'url' && (
              <>
                <p className="watchlists-import-modal-hint">{t('watchlistPage.importHint')}</p>
                <input type="text" className="watchlists-import-input" placeholder={t('watchlistPage.pasteLink')} value={importUrl} onChange={(e) => setImportUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleImportFromDexScreener(); }} disabled={importLoading} aria-describedby="import-error import-done" />
              </>
            )}

            {importMode === 'addresses' && !importPreview && (
              <>
                <p className="watchlists-import-modal-hint">{t('watchlists.import.addressesHint', 'Paste contract addresses from DexScreener - one per line or comma separated.')}</p>
                <textarea className="watchlists-import-textarea" value={importAddresses} onChange={(e) => setImportAddresses(e.target.value)} placeholder={"0x6982508145454Ce325dDbE47a25d4ec3d2311933\nEKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzL...\n..."} rows={5} disabled={importLoading} />
              </>
            )}

            {importMode === 'addresses' && importPreview && importPreview.length > 0 && (
              <div className="watchlists-import-preview">
                <p className="watchlists-import-preview-count">{t('watchlists.import.tokensFound', '{{count}} tokens found', { count: importPreview.length })}</p>
                <div className="watchlists-import-preview-list">
                  {importPreview.map((tok) => (
                    <div key={tok.address} className="watchlists-import-preview-item">
                      <div className="watchlists-import-preview-avatar">
                        {tok.logo ? <img src={tok.logo} alt={tok.symbol} onError={(e) => { e.target.style.display = 'none' }} /> : <span>{(tok.symbol || '?')[0]}</span>}
                      </div>
                      <div className="watchlists-import-preview-info">
                        <span className="watchlists-import-preview-symbol">{tok.symbol}</span>
                        <span className="watchlists-import-preview-name">{tok.name}</span>
                      </div>
                      <span className="watchlists-import-preview-chain">{tok.chain}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {importError && <p id="import-error" className="watchlists-import-message watchlists-import-error" role="alert">{importError}</p>}
            {importDone && <p id="import-done" className="watchlists-import-message watchlists-import-done" role="status">{importDone}</p>}
            <div className="watchlists-import-modal-actions">
              <button type="button" className="watchlists-import-cancel-btn" onClick={() => { setImportOpen(false); setImportError(null); setImportDone(null); setImportUrl(''); setImportMode('url'); setImportAddresses(''); setImportPreview(null); }} disabled={importLoading}>{t('common.cancel')}</button>
              {importMode === 'url' && (
                <button type="button" className="watchlists-import-submit-btn" onClick={handleImportFromDexScreener} disabled={importLoading}>{importLoading ? (<><span className="watchlists-import-loading" aria-hidden />{t('watchlistPage.importing')}</>) : t('watchlistPage.import')}</button>
              )}
              {importMode === 'addresses' && !importPreview && (
                <button type="button" className="watchlists-import-submit-btn" onClick={handleLookupAddresses} disabled={importLoading || !importAddresses.trim()}>{importLoading ? (<><span className="watchlists-import-loading" aria-hidden />{t('watchlists.import.lookingUp', 'Looking up...')}</>) : t('watchlists.import.lookUp', 'Look up ({{count}})', { count: parseAddressInput(importAddresses).length })}</button>
              )}
              {importMode === 'addresses' && importPreview && importPreview.length > 0 && (
                <button type="button" className="watchlists-import-submit-btn" onClick={handleImportPreview} disabled={importLoading}>{t('watchlists.import.importTokens', 'Import {{count}} tokens', { count: importPreview.length })}</button>
              )}
            </div>
          </div>
        </div>
        </AppPortal>
      )}

      {/* Mobile Bottom Sheet - Token Options */}
      <MobileBottomSheet
        isOpen={bottomSheetOpen}
        onClose={() => { setBottomSheetOpen(false); setSelectedToken(null); }}
        title={selectedToken ? `${selectedToken.symbol} ${t('watchlistPage.options')}` : t('watchlistPage.options')}
      >
        {selectedToken && (
          <>
            {/* Token summary */}
            <div className="watchlists-sheet-token-summary">
              <div className="watchlists-sheet-token-avatar"
                style={getTokenAvatarRingStyle(selectedToken.symbol) || {}}
              >
                {selectedToken.logo ? (
                  <img src={selectedToken.logo} alt={selectedToken.symbol} onError={(e) => { e.target.style.display = 'none'; e.target.insertAdjacentHTML('afterend', `<span>${selectedToken.symbol?.[0] || '?'}</span>`) }} />
                ) : (
                  <span>{selectedToken.symbol?.[0] || '?'}</span>
                )}
              </div>
              <div className="watchlists-sheet-token-info">
                <span className="watchlists-sheet-token-name">{selectedToken.name}</span>
                <span className="watchlists-sheet-token-price">{fmtPrice(selectedToken.price)}</span>
              </div>
              <span className={`watchlists-sheet-token-change ${selectedToken.change24h > 0 ? 'positive' : selectedToken.change24h < 0 ? 'negative' : ''}`}>
                {formatChange(selectedToken.change24h)}
              </span>
            </div>

            {/* Actions */}
            <BottomSheetAction
              icon={
                <svg viewBox="0 0 24 24" fill={selectedToken.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                  <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v4.76z" />
                </svg>
              }
              label={selectedToken.pinned ? t('watchlistPage.unpinFromTop') : t('watchlistPage.pinToTop')}
              description={selectedToken.pinned ? t('watchlistPage.removeFromPinned') : t('watchlistPage.alwaysShowTop')}
              onClick={() => {
                togglePinWatchlist?.(selectedToken.address || selectedToken.symbol)
                setBottomSheetOpen(false)
                setSelectedToken(null)
              }}
            />

            <BottomSheetAction
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v8M8 12h8" />
                </svg>
              }
              label={t('watchlistPage.viewDetails')}
              description={t('watchlistPage.seeFullInfo')}
              onClick={() => {
                onTokenClick?.(selectedToken, resolveRouteMode(selectedToken))
                setBottomSheetOpen(false)
                setSelectedToken(null)
              }}
            />

            <BottomSheetAction
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              }
              label={t('watchlistPage.removeFromWatchlist')}
              description={t('watchlistPage.deleteFromList')}
              destructive
              onClick={() => {
                removeFromWatchlist?.(selectedToken.address || selectedToken.symbol)
                setBottomSheetOpen(false)
                setSelectedToken(null)
              }}
            />
          </>
        )}
      </MobileBottomSheet>
    </div>
  )
}

export default WatchlistsPage
