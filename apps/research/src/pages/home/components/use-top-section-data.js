import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { snapPeek, snapPut } from '@/lib/snapshotCache'
import { getTopCoinsMarketsPage, getCategoryCoins } from '@/services/coinGeckoApi'
import { useTrendingTokens } from '@/hooks/useCodexData'
import useLivePrices, { tokenKey } from '@/hooks/useLivePrices'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getPredictionMarkets } from '@/services/polymarketApi'
import { TOP_STOCKS, getStockLogo } from '@/constants/stockData'
import { TOP_COINS, TOKEN_LOGOS, AI_AGENTS_MOCK, AI_MODELS_MOCK, TOPCOINS_CHAINS } from './welcome-page-constants'

const DEFAULT_PAGE_SIZE = 50
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]
const TOTAL_TOP_COINS = 2000

// Stable map of category ID → CoinGecko category slug (avoids depending on translated CATEGORY_TABS array)
const CATEGORY_CG_MAP = {
  defi: 'decentralized-finance-defi',
  ai: 'artificial-intelligence',
  meme: 'meme-token',
  rwa: 'real-world-assets-rwa',
  robinhood: 'robinhood-ecosystem',
  gamefi: 'gaming',
  infra: 'infrastructure',
  solanaMeme: 'solana-meme-coins',
  privacy: 'privacy-coins',
  nft: 'non-fungible-tokens-nft',
  lending: 'lending-borrowing',
  // "More" dropdown categories (verified CG slugs - keep in sync with
  // MORE_CATEGORY_TABS in welcome-page.jsx)
  layer1: 'layer-1',
  layer2: 'layer-2',
  aiAgents: 'ai-agents',
  aiMeme: 'ai-meme-coins',
  depin: 'depin',
  dex: 'decentralized-exchange',
  exchange: 'exchange-based-tokens',
  stablecoins: 'stablecoins',
  liquidStaking: 'liquid-staking-tokens',
  restaking: 'restaking',
  oracles: 'oracle',
  zk: 'zero-knowledge-zk',
  storage: 'storage',
  payments: 'payment-solutions',
  socialfi: 'socialfi',
  metaverse: 'metaverse',
  bitcoinEco: 'bitcoin-ecosystem',
  dogMeme: 'dog-themed-coins',
  catMeme: 'cat-themed-coins',
  baseMeme: 'base-meme-coins',
  politifi: 'politifi',
  predictionMarkets: 'prediction-markets',
  fanTokens: 'fan-token',
  gold: 'tokenized-gold',
  madeInUsa: 'made-in-usa',
  gamblefi: 'gambling',
}

// Range-filter shape (all bounds optional, plain numbers):
// { mcapMin, mcapMax, fdvMin, fdvMax, priceMin, priceMax, chgMin, chgMax, volMin, volMax }
export function topCoinsRangesActive(r) {
  return !!r && Object.values(r).some((v) => v != null && v !== '')
}

function passesRanges(row, r) {
  if (!r) return true
  const checks = [
    [r.mcapMin, r.mcapMax, row.marketCap],
    [r.fdvMin, r.fdvMax, row.fdv],
    [r.priceMin, r.priceMax, row.price],
    [r.chgMin, r.chgMax, row.change],
    [r.volMin, r.volMax, row.volume],
  ]
  for (const [min, max, val] of checks) {
    const hasMin = min != null && min !== ''
    const hasMax = max != null && max !== ''
    if (!hasMin && !hasMax) continue
    const n = Number(val)
    if (!Number.isFinite(n)) return false
    if (hasMin && n < Number(min)) return false
    if (hasMax && n > Number(max)) return false
  }
  return true
}

export default function useTopSectionData({ topSectionTab, isStocks, categoryFilter, topCoinsChain = 'all', topCoinsRanges = null, stockPrices, topCoinPrices }) {
  // Top Coins: paginated from API (top 2000, user-selectable page size)
  const [topCoinsPage, setTopCoinsPage] = useState(1)
  const [topCoinsPageSize, setTopCoinsPageSizeState] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem('spectre-top-coins-page-size'), 10)
      return PAGE_SIZE_OPTIONS.includes(saved) ? saved : DEFAULT_PAGE_SIZE
    } catch (_) { return DEFAULT_PAGE_SIZE }
  })
  // PR-4 (perf): hydrate page 1 of the unfiltered top-coins table from the
  // last visit so rows render at first commit; the mount fetch replaces them
  // in place. Only when landing unfiltered on page 1 (the default view).
  const [topCoinsTokens, setTopCoinsTokens] = useState(() => {
    // 'all' is the default view (not a real category) - it shares the same
    // unfiltered page-1 snapshot that the fetch effect writes below, so seed
    // from it. Only ACTUAL category filters skip the seed (they have their own
    // payload that we don't persist). Treating 'all' as truthy here meant the
    // default Top Coins tab never consumed the snapshot - it was written every
    // visit but read on none, so every cold reload shimmered + refetched.
    if (categoryFilter && categoryFilter !== 'all') return []
    try {
      const saved = parseInt(localStorage.getItem('spectre-top-coins-page-size'), 10)
      const size = PAGE_SIZE_OPTIONS.includes(saved) ? saved : DEFAULT_PAGE_SIZE
      const snap = snapPeek(`top-coins:p1:${size}`)
      return Array.isArray(snap?.data) && snap.data.length > 0 ? snap.data : []
    } catch (_) { return [] }
  })
  const [topCoinsLoading, setTopCoinsLoading] = useState(false)
  // Background-refresh ticker for the chain/category views (the Robinhood chain
  // fetch is otherwise one-shot). Bumped by the adaptive poll below.
  const [topCoinsRefreshTick, setTopCoinsRefreshTick] = useState(0)
  // Signature of the last fetch (filters + page). A poll re-runs the fetch
  // effect with the same signature → treat it as a silent refresh (no skeleton).
  const lastFetchSigRef = useRef('')
  const [hasMorePages, setHasMorePages] = useState(true)
  const [totalCategoryPages, setTotalCategoryPages] = useState(null)
  const prevPageRef = useRef(1)
  // Holds the combined filters key (category|chain|ranges) of the last reset —
  // must match the format built in the reset effect below or the mount tick
  // false-positives and blanks the instant-paint seed.
  const prevCategoryRef = useRef(`${categoryFilter}|${topCoinsChain || 'all'}|${topCoinsRangesActive(topCoinsRanges) ? JSON.stringify(topCoinsRanges) : ''}`)

  const setTopCoinsPageSize = useCallback((next) => {
    const safe = PAGE_SIZE_OPTIONS.includes(next) ? next : DEFAULT_PAGE_SIZE
    // Keep the existing token list visible during the in-flight fetch — the
    // fetch effect replaces it on resolve. Blanking here causes a flash + the
    // staggered card animation to re-run for every card.
    setTopCoinsPageSizeState(safe)
    setTopCoinsPage(1)
    prevPageRef.current = 1
    try { localStorage.setItem('spectre-top-coins-page-size', String(safe)) } catch (_) { /* ignore */ }
  }, [])

  const TOTAL_TOP_COINS_PAGES = Math.max(1, Math.ceil(TOTAL_TOP_COINS / topCoinsPageSize))

  // Stable identity key of the range-filter object (referential identity is
  // useless as a dep — the popover Apply always builds a fresh object).
  const rangesKey = useMemo(
    () => (topCoinsRangesActive(topCoinsRanges) ? JSON.stringify(topCoinsRanges) : ''),
    [topCoinsRanges]
  )

  // Reset page to 1 when category / chain / range filters change
  useEffect(() => {
    const filtersKey = `${categoryFilter}|${topCoinsChain || 'all'}|${rangesKey}`
    if (prevCategoryRef.current !== filtersKey) {
      prevCategoryRef.current = filtersKey
      setTopCoinsPage(1)
      prevPageRef.current = 1
      // Seed from the last visit's category snapshot for instant paint while
      // the (possibly CG-queue-delayed) fetch revalidates in the background.
      // Blanking to [] left the table empty for the full queue wait.
      // Only for the plain single-category case: chain-intersected or
      // range-filtered views must not paint an unfiltered seed.
      const cgId = CATEGORY_CG_MAP[categoryFilter] || null
      const plainCategory = cgId && (topCoinsChain === 'all' || !topCoinsChain) && !rangesKey
      const snap = plainCategory ? snapPeek(`top-coins:cat:${cgId}`) : null
      setTopCoinsTokens(Array.isArray(snap?.data) && snap.data.length > 0
        ? snap.data.slice(0, topCoinsPageSize)
        : [])
      setTotalCategoryPages(null)
    }
  }, [categoryFilter, topCoinsChain, rangesKey, topCoinsPageSize])

  // Load next page callback for infinite scroll on mobile
  const loadNextTopCoinsPage = useCallback(() => {
    if (hasMorePages && !topCoinsLoading) {
      setTopCoinsPage(prev => prev + 1)
    }
  }, [hasMorePages, topCoinsLoading])

  // Jump directly to a specific server page (mobile pagination).
  // Resets the append marker so the fetched page REPLACES the current list
  // instead of being appended to whatever was accumulated.
  const jumpToTopCoinsPage = useCallback((n) => {
    const target = Math.max(1, Math.floor(n) || 1)
    if (topCoinsLoading || target === topCoinsPage) return
    prevPageRef.current = target
    setTopCoinsPage(target)
  }, [topCoinsLoading, topCoinsPage])

  // On-Chain filters
  const [onChainChainFilter, setOnChainChainFilter] = useState('all')
  const [onChainTimeframe, setOnChainTimeframe] = useState('24h')
  const [onChainRankBy, setOnChainRankBy] = useState('trending-6h')
  const [onChainViewMode, setOnChainViewMode] = useState('list')

  // Trending tier for the top-of-page ticker. Since #1148 the tiers are
  // client-side slices of the single Codex on-chain feed (welcome-page
  // tickerTokens memo) - 'social' had no equivalent there and was dropped;
  // a persisted 'social' pick falls back to 'majors' below.
  // Persisted to localStorage so the user's last pick survives reloads.
  const VALID_TIERS = useRef(new Set(['majors', 'sub500m', 'sub50m', 'onchain'])).current
  const [trendingTier, setTrendingTierState] = useState(() => {
    try {
      const saved = localStorage.getItem('spectre-trending-tier')
      return saved && VALID_TIERS.has(saved) ? saved : 'majors'
    } catch (_) { return 'majors' }
  })
  const setTrendingTier = useCallback((next) => {
    const safe = VALID_TIERS.has(next) ? next : 'majors'
    setTrendingTierState(safe)
    try { localStorage.setItem('spectre-trending-tier', safe) } catch (_) { /* ignore */ }
  }, [VALID_TIERS])

  // Predictions
  const [predictionsCategoryFilter, setPredictionsCategoryFilter] = useState('all')
  const [predictionsData, setPredictionsData] = useState([])
  const [predictionsLoading, setPredictionsLoading] = useState(false)
  const predictionsInitRef = useRef(false)

  // AI Agents filters
  const [aiAgentCategoryFilter, setAiAgentCategoryFilter] = useState('all')
  const [aiAgentSortBy, setAiAgentSortBy] = useState('revenue30d')
  const [aiAgentSortDir, setAiAgentSortDir] = useState('desc')

  // AI Models filters
  const [aiModelCategoryFilter, setAiModelCategoryFilter] = useState('all')
  const [aiModelProviderFilter, setAiModelProviderFilter] = useState('all')
  const [aiModelViewMode, setAiModelViewMode] = useState('table')
  const [aiModelSortBy, setAiModelSortBy] = useState('mindsharePct')
  const [aiModelSortDir, setAiModelSortDir] = useState('desc')
  const [aiModelQualityFilter, setAiModelQualityFilter] = useState('all')

  const getNetworkName = (networkId) => {
    const map = {
      1: 'Ethereum', 56: 'BNB Chain', 1399811149: 'Solana',
      42161: 'Arbitrum', 10: 'Optimism', 137: 'Polygon',
      8453: 'Base', 43114: 'Avalanche', 4663: 'Robinhood',
    }
    return map[networkId] ?? 'Unknown'
  }

  // Top Coins tab: fetch current page from CoinGecko.
  // Category tabs (2026-07-02): ONE cached 250-row fetch per category serves
  // the page count AND every page client-side. The old shape (a 250-row
  // page-count probe PLUS a per-page fetch, both racing through the serial CG
  // proxy queue behind the home page's other CG calls) cost two queued
  // upstream round-trips per category click — the table sat empty ~20s.
  // Chain filter + range filters (2026-07-02) ride the same machinery:
  //   category+chain  -> two cached 250-row category fetches, intersected
  //   chain only      -> the chain's ecosystem category list
  //   ranges on "all" -> the shared top-250 page-1 fetch as the universe
  // All three page client-side exactly like a category.
  useEffect(() => {
    if (topSectionTab !== 'topcoins' || isStocks) return
    let cancelled = false
    // A background poll re-runs this effect with the SAME filters/page. Keep the
    // current rows visible (no skeleton flash) and just swap in fresh data; only
    // a real filter/page change shows the loading state.
    const fetchSig = `${categoryFilter}|${topCoinsChain || 'all'}|${rangesKey}|${topCoinsPage}|${topCoinsPageSize}`
    const isBackgroundRefresh = lastFetchSigRef.current === fetchSig
    lastFetchSigRef.current = fetchSig
    if (!isBackgroundRefresh) setTopCoinsLoading(true)
    const activeCgId = CATEGORY_CG_MAP[categoryFilter] || null
    const chainCgId = TOPCOINS_CHAINS.find((c) => c.id === topCoinsChain)?.cg || null
    const rangesOn = topCoinsRangesActive(topCoinsRanges)
    const clientPaged = !!(activeCgId || chainCgId || rangesOn)

    const mapMarketRow = (coin, rank) => {
      // 7D: prefer CoinGecko's window. When it's absent (thin / brand-new
      // Robinhood-chain listings CG hasn't backfilled) derive it from the real
      // 7-day sparkline (first→last point) so the column shows an actual number
      // instead of an em dash. 30D/1Y have no underlying series to derive from,
      // so they honestly stay null rather than showing a fabricated value.
      const spark7d = Array.isArray(coin.sparkline_in_7d?.price) ? coin.sparkline_in_7d.price : null
      const cg7d = coin.price_change_percentage_7d_in_currency
      const derived7d = (cg7d == null && spark7d && spark7d.length > 1 && spark7d[0] > 0)
        ? ((spark7d[spark7d.length - 1] - spark7d[0]) / spark7d[0]) * 100
        : null
      return {
      rank,
      // True CoinGecko market-cap rank. In category/chain views `rank` is the
      // in-category position (1,2,3...) - this keeps the global standing
      // visible next to it (SPECTRE reads #~1700 inside the AI tab).
      globalRank: coin.market_cap_rank != null ? coin.market_cap_rank : null,
      symbol: (coin.symbol || '').toUpperCase(),
      name: coin.name || coin.symbol || '',
      // CoinGecko slug (e.g. 'leo-token'). Needed by useChartData line-mode
      // fallback for tokens with no Codex/Binance bars.
      cgId: coin.id || null,
      address: coin._gt_address || null,
      networkId: coin._gt_network_id || 1,
      network: getNetworkName(1),
      logo: coin.image || TOKEN_LOGOS[(coin.symbol || '').toUpperCase()] || null,
      price: Number(coin.current_price) || 0,
      change: Number(coin.price_change_percentage_24h) || 0,
      // History windows stay null when CG has no data (brand-new listings -
      // Robinhood Chain tokens are days old) so the table renders an em dash
      // instead of a fake +0.00%. The cell renderer + sorters are null-aware.
      change1h: coin.price_change_percentage_1h_in_currency != null ? Number(coin.price_change_percentage_1h_in_currency) : null,
      change7d: cg7d != null ? Number(cg7d) : derived7d,
      change30d: coin.price_change_percentage_30d_in_currency != null ? Number(coin.price_change_percentage_30d_in_currency) : null,
      change1y: coin.price_change_percentage_1y_in_currency != null ? Number(coin.price_change_percentage_1y_in_currency) : null,
      volume: Number(coin.total_volume) || 0,
      marketCap: Number(coin.market_cap) || 0,
      fdv: Number(coin.fully_diluted_valuation) || null,
      circulatingSupply: Number(coin.circulating_supply) || null,
      athChangePct: Number.isFinite(Number(coin.ath_change_percentage)) && coin.ath_change_percentage != null
        ? Number(coin.ath_change_percentage)
        : null,
      liquidity: Number(coin.total_volume) || 0,
      holders: 0,
      age: '-',
      sparkline_7d: spark7d,
      }
    }

    // Chain (ecosystem) categories bypass the Spectre-first race — the Spectre
    // bridge doesn't serve them and its symbol-fallback would shrink the universe.
    const rowKeyOf = (c) => c?.id || c?.cgId || (c?.symbol || '').toUpperCase()
    let fetchPromise
    if (activeCgId && chainCgId) {
      fetchPromise = Promise.all([
        getCategoryCoins(activeCgId, 1, 250),
        getCategoryCoins(chainCgId, 1, 250, { cgOnly: true }),
      ]).then(([cat, chain]) => {
        // Match on id OR symbol: Spectre-normalized category rows can carry
        // synthetic ids while the chain list is raw CG.
        const inChain = new Set()
        for (const c of chain || []) {
          if (c?.id) inChain.add(c.id)
          if (c?.symbol) inChain.add(String(c.symbol).toUpperCase())
        }
        return (cat || []).filter((c) => inChain.has(rowKeyOf(c)) || inChain.has(String(c?.symbol || '').toUpperCase()))
      })
    } else if (chainCgId && !activeCgId) {
      fetchPromise = getCategoryCoins(chainCgId, 1, 250, { cgOnly: true })
    } else if (activeCgId) {
      fetchPromise = getCategoryCoins(activeCgId, 1, 250)
    } else if (rangesOn) {
      // The shared, LS-seeded top-250 page-1 fetch (dedupes with home/discover).
      fetchPromise = getTopCoinsMarketsPage(1, 250)
    } else {
      fetchPromise = getTopCoinsMarketsPage(topCoinsPage, topCoinsPageSize)
    }

    fetchPromise
      .then((allMarkets) => {
        if (cancelled) return
        const baseRank = (topCoinsPage - 1) * topCoinsPageSize
        let list
        if (clientPaged) {
          const positional = !!(activeCgId || chainCgId)
          const mappedAll = (allMarkets || []).map((coin, index) => mapMarketRow(
            coin,
            positional ? index + 1 : (coin.market_cap_rank != null ? coin.market_cap_rank : index + 1)
          ))
          const universe = rangesOn ? mappedAll.filter((r) => passesRanges(r, topCoinsRanges)) : mappedAll
          // Positional modes re-rank after filtering so page slices stay contiguous
          const ranked = positional ? universe.map((r, i) => ({ ...r, rank: i + 1 })) : universe
          list = ranked.slice(baseRank, baseRank + topCoinsPageSize)
          const total = ranked.length
          setTotalCategoryPages(Math.max(1, Math.ceil(total / topCoinsPageSize)))
          setHasMorePages(baseRank + topCoinsPageSize < total)
          // Persist the whole mapped category list (minus sparklines) so the
          // next visit to this tab paints instantly from the seed above.
          // Plain single-category views only: chain-intersected / range-filtered
          // lists must not poison the category seed.
          if (activeCgId && !chainCgId && !rangesOn && topCoinsPage === 1 && total > 0) {
            snapPut(`top-coins:cat:${activeCgId}`, ranked.map((row) => ({ ...row, sparkline_7d: null })))
          }
        } else {
          list = (allMarkets || []).map((coin, index) => mapMarketRow(
            coin,
            coin.market_cap_rank != null ? coin.market_cap_rank : baseRank + index + 1
          ))
          setHasMorePages(topCoinsPage < TOTAL_TOP_COINS_PAGES)
          // PR-4 (perf): persist page 1 of the unfiltered top-coins list (minus
          // the bulky sparklines) so the next visit renders the table instantly.
          if (topCoinsPage === 1 && list.length > 0) {
            snapPut(`top-coins:p1:${topCoinsPageSize}`, list.map(({ sparkline_7d, ...rest }) => rest))
          }
        }
        // Append when page increased, replace when page reset or filters changed
        const shouldAppend = topCoinsPage > 1 && prevPageRef.current < topCoinsPage
        if (shouldAppend) {
          setTopCoinsTokens(prev => [...prev, ...list])
        } else {
          setTopCoinsTokens(list)
        }
        prevPageRef.current = topCoinsPage
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Top Coins page fetch failed:', err)
          setTopCoinsTokens([])
        }
      })
      .finally(() => {
        if (!cancelled) setTopCoinsLoading(false)
      })
    return () => { cancelled = true }
  }, [topSectionTab, topCoinsPage, topCoinsPageSize, isStocks, categoryFilter, topCoinsChain, rangesKey, topCoinsRefreshTick])

  // Keep Top Coins fresh — including the chain/category views (e.g. the
  // Robinhood chain) whose fetch is otherwise one-shot. Visibility-guarded via
  // useAdaptivePolling; page 1 only, so it never disrupts accumulated
  // infinite-scroll pages or a mid-list read on a deeper page.
  useAdaptivePolling(() => setTopCoinsRefreshTick((n) => n + 1), {
    interval: 60_000,
    enabled: topSectionTab === 'topcoins' && !isStocks && topCoinsPage === 1,
  })

  // Trending tokens (on-chain)
  // Always fetched — feeds both the On-Chain tab table AND the top-of-page
  // TokenTicker which is rendered unconditionally on desktop. The live-price
  // overlay (useLivePrices below) still gates on tab visibility, so the
  // expensive SSE/poll work only fires when the table is on-screen.
  const onChainActive = topSectionTab === 'onchain'
  const trendingNetworkIds = useMemo(() => {
    // 4663 = Robinhood Chain. Codex has no coverage there, so useTrendingTokens
    // splits it out to GeckoTerminal and merges the rows back in - without it in
    // the "All" set the chain carrying a big slice of the day's on-chain volume
    // was simply absent from the default board.
    if (onChainChainFilter === 'all') return [1, 56, 137, 42161, 8453, 4663, 1399811149]
    return [onChainChainFilter]
  }, [onChainChainFilter])
  // The On-Chain tab is a real DEX leaderboard — always pull the Codex on-chain
  // feed (real per-window changes 5m/1h/4h/24h, real liquidity, correct
  // networkId per chain). The old mcap-tier routing (majors/sub500m/…) fell
  // through to the CG-tiered feed which fakes liquidity=volume, zeroes 5m/4h,
  // and stamps networkId=1 on every row — nonsense on an on-chain board. Rank
  // (Trending/Gainers/Losers/Volume/Mcap) and cap-band filtering are applied
  // client-side in DiscoverySection over this single honest dataset.
  const { tokens: trendingTokens, loading: onChainLoading } = useTrendingTokens(
    trendingNetworkIds,
    'onchain',
    { enabled: true }
  )

  // Subscribe live priceUsd via Codex SSE for the currently-loaded trending
  // tokens. The `priceMap` returned here is the same priceUsd that feeds the
  // chart's last bar, so the table and the chart always agree on price.
  // Pass [] when the tab is inactive: useLivePrices treats an empty signature
  // as "stop polling and clear the map".
  const livePriceMap = useLivePrices(onChainActive ? trendingTokens : [])

  // Filtered on-chain data — overlay live price + rebase EVERY change column
  // from the historical anchor implied by the snapshot. For each window:
  //   anchor = snapshot.price / (1 + snapshot.changeWindow/100)
  //   newChangeWindow = (livePrice - anchor) / anchor * 100
  // Without this, only `price` would tick and the 5M/1H/4H/24H columns would
  // stay frozen at the moment the screener row was last fetched.
  const filteredOnChain = useMemo(() => {
    if (!trendingTokens || trendingTokens.length === 0) return []
    if (livePriceMap.size === 0) return trendingTokens
    return trendingTokens.map((row) => {
      const k = tokenKey(row)
      const livePrice = k ? livePriceMap.get(k) : null
      if (!livePrice || livePrice <= 0) return row
      const basePrice = row.price > 0 ? row.price : null
      if (!basePrice) {
        return { ...row, price: livePrice }
      }

      const rebase = (baseChange) => {
        if (!Number.isFinite(baseChange)) return baseChange
        if (baseChange === 0) {
          // No prior change snapshot — use the live drift from current snapshot
          return ((livePrice - basePrice) / basePrice) * 100
        }
        const past = basePrice / (1 + baseChange / 100)
        if (!(past > 0)) return baseChange
        return ((livePrice - past) / past) * 100
      }

      const next5m = rebase(row.change5m ?? 0)
      const next1h = rebase(row.change1h ?? 0)
      const next4h = rebase(row.change4h ?? 0)
      const next12h = rebase(row.change12h ?? 0)
      const next24h = rebase(row.change24h ?? row.change ?? 0)

      return {
        ...row,
        price: livePrice,
        change: next24h,
        change5m: next5m,
        change1h: next1h,
        change4h: next4h,
        change12h: next12h,
        change24h: next24h,
      }
    })
  }, [trendingTokens, livePriceMap])

  // Prediction Markets — lazy: only fetch when user opens the tab
  useEffect(() => {
    if (topSectionTab !== 'predictions') return
    if (predictionsInitRef.current) return
    let cancelled = false
    setPredictionsLoading(true)
    getPredictionMarkets('all', 30)
      .then(rows => {
        if (cancelled) return
        predictionsInitRef.current = true
        setPredictionsData(rows && rows.length > 0 ? rows : [])
      })
      .catch(() => {
        if (!cancelled) setPredictionsData([])
      })
      .finally(() => { if (!cancelled) setPredictionsLoading(false) })
    return () => { cancelled = true }
  }, [topSectionTab])

  const filteredPredictions = useMemo(() => {
    if (predictionsCategoryFilter === 'all') return predictionsData
    return predictionsData.filter(row => (row.category || '').toLowerCase() === predictionsCategoryFilter)
  }, [predictionsCategoryFilter, predictionsData])

  // Filtered AI agents
  const filteredAiAgents = useMemo(() => {
    let result = aiAgentCategoryFilter === 'all' ? [...AI_AGENTS_MOCK] : AI_AGENTS_MOCK.filter(a => a.category === aiAgentCategoryFilter)
    result.sort((a, b) => {
      let aVal = a[aiAgentSortBy] ?? 0
      let bVal = b[aiAgentSortBy] ?? 0
      if (typeof aVal === 'string') { aVal = aVal.toLowerCase(); bVal = (bVal || '').toLowerCase() }
      if (aVal < bVal) return aiAgentSortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return aiAgentSortDir === 'asc' ? 1 : -1
      return 0
    })
    return result
  }, [aiAgentCategoryFilter, aiAgentSortBy, aiAgentSortDir])

  // Filtered AI models
  const filteredAiModels = useMemo(() => {
    let result = AI_MODELS_MOCK.filter(m => {
      const catMatch = aiModelCategoryFilter === 'all' || m.category === aiModelCategoryFilter
      const provMatch = aiModelProviderFilter === 'all' || m.provider === aiModelProviderFilter
      const qualMatch = aiModelQualityFilter === 'all'
        || (aiModelQualityFilter === 'elite' && m.qualityScore >= 90)
        || (aiModelQualityFilter === 'high' && m.qualityScore >= 80 && m.qualityScore < 90)
        || (aiModelQualityFilter === 'mid' && m.qualityScore >= 70 && m.qualityScore < 80)
        || (aiModelQualityFilter === 'budget' && m.qualityScore < 70)
      return catMatch && provMatch && qualMatch
    })
    result.sort((a, b) => {
      let aVal = a[aiModelSortBy] ?? 0
      let bVal = b[aiModelSortBy] ?? 0
      if (typeof aVal === 'string') aVal = aVal.toLowerCase()
      if (typeof bVal === 'string') bVal = bVal.toLowerCase()
      if (aVal < bVal) return aiModelSortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return aiModelSortDir === 'asc' ? 1 : -1
      return 0
    })
    return result
  }, [aiModelCategoryFilter, aiModelProviderFilter, aiModelQualityFilter, aiModelSortBy, aiModelSortDir])

  // Filtered top coins (includes stocks mode)
  const filteredTopCoins = useMemo(() => {
    if (isStocks) {
      const mapped = TOP_STOCKS.map((stock) => {
        const priceData = stockPrices?.[stock.symbol]
        return {
          ...stock,
          logo: getStockLogo(stock.symbol, stock.sector),
          price: priceData?.price || 0,
          change: priceData?.change || 0,
          marketCap: priceData?.marketCap || 0,
          volume: priceData?.volume || 0,
          pe: priceData?.pe,
          eps: priceData?.eps,
          type: 'stock',
        }
      })
      // Feature the biggest companies first: rank by live market cap descending.
      // ETFs / commodity futures carry no Yahoo market cap (→ 0), so they fall
      // to the tail of "All Sectors" while still reachable via their sector tab.
      mapped.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
      return mapped
        .filter((stock) => {
          if (categoryFilter !== 'all') {
            return (stock.sector || '').toLowerCase() === categoryFilter.toLowerCase()
          }
          return true
        })
        .map((stock, index) => ({ ...stock, rank: index + 1 }))
    }
    if (!topCoinPrices || Object.keys(topCoinPrices).length === 0) return [...topCoinsTokens]
    return topCoinsTokens.map((row) => {
      const live = topCoinPrices[row.symbol]
      if (!live || !(live.price > 0)) return row
      return {
        ...row,
        price: Number(live.price) || row.price,
        change: Number(live.change ?? live.change24 ?? row.change),
      }
    })
  }, [topCoinsTokens, categoryFilter, isStocks, stockPrices, topCoinPrices])

  // Build tokens from prices (for fallback discover list)
  const buildTokensFromPrices = useCallback((priceMap) => {
    if (!priceMap || typeof priceMap !== 'object') return []
    return TOP_COINS.map((coin, index) => {
      const data = priceMap[coin.symbol]
      const price = data?.price != null ? Number(data.price) : 0
      const change = data?.change != null ? Number(data.change) : (data?.change24 != null ? Number(data.change24) : 0)
      const volume = data?.volume != null ? Number(data.volume) : 0
      const marketCap = data?.marketCap != null ? Number(data.marketCap) : 0
      const liquidity = data?.liquidity != null ? Number(data.liquidity) : 0
      const change1h = data?.change1h != null ? Number(data.change1h) : 0
      const change7d = data?.change7d != null ? Number(data.change7d) : 0
      const change30d = data?.change30d != null ? Number(data.change30d) : 0
      const change1y = data?.change1y != null ? Number(data.change1y) : 0
      return {
        rank: index + 1,
        symbol: coin.symbol,
        name: coin.name,
        address: coin.address,
        networkId: coin.networkId,
        network: getNetworkName(coin.networkId),
        logo: TOKEN_LOGOS[coin.symbol] || null,
        price: Number.isFinite(price) ? price : 0,
        change: Number.isFinite(change) ? change : 0,
        change1h: Number.isFinite(change1h) ? change1h : 0,
        change7d: Number.isFinite(change7d) ? change7d : 0,
        change30d: Number.isFinite(change30d) ? change30d : 0,
        change1y: Number.isFinite(change1y) ? change1y : 0,
        volume: Number.isFinite(volume) ? volume : 0,
        marketCap: Number.isFinite(marketCap) ? marketCap : 0,
        liquidity: Number.isFinite(liquidity) ? liquidity : 0,
        holders: 0,
        age: '-',
      }
    })
  }, [])

  return {
    // Top coins
    topCoinsPage, setTopCoinsPage,
    topCoinsTokens,
    topCoinsLoading,
    hasMorePages,
    totalCategoryPages,
    filteredTopCoins,
    buildTokensFromPrices,
    loadNextTopCoinsPage,
    jumpToTopCoinsPage,
    topCoinsPageSize,
    setTopCoinsPageSize,
    TOP_COINS_PAGE_SIZE: topCoinsPageSize,
    TOP_COINS_PAGE_SIZE_OPTIONS: PAGE_SIZE_OPTIONS,
    TOTAL_TOP_COINS_PAGES,

    // On-chain
    trendingTokens,
    onChainLoading,
    onChainChainFilter, setOnChainChainFilter,
    onChainTimeframe, setOnChainTimeframe,
    onChainRankBy, setOnChainRankBy,
    onChainViewMode, setOnChainViewMode,
    filteredOnChain,
    trendingTier, setTrendingTier,

    // Predictions
    predictionsCategoryFilter, setPredictionsCategoryFilter,
    filteredPredictions,
    predictionsLoading,

    // AI agents
    aiAgentCategoryFilter, setAiAgentCategoryFilter,
    aiAgentSortBy, setAiAgentSortBy,
    aiAgentSortDir, setAiAgentSortDir,
    filteredAiAgents,

    // AI models
    aiModelCategoryFilter, setAiModelCategoryFilter,
    aiModelProviderFilter, setAiModelProviderFilter,
    aiModelViewMode, setAiModelViewMode,
    aiModelSortBy, setAiModelSortBy,
    aiModelSortDir, setAiModelSortDir,
    aiModelQualityFilter, setAiModelQualityFilter,
    filteredAiModels,
  }
}
