import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { MARKET_FILTERS } from '../data/rz-constants'
import { getLatestTrades } from '@/services/codexApi'
import { isOnchainSupported, getLatestTrades as onchainGetLatestTrades } from '@/services/onchainApi'
import { getPredictionMarketsForToken } from '@/services/polymarketApi'
import { IPO_REFERENCE } from '@/constants/stockData'
import { getInsiderActivity } from '@/services/stockApi'
import { isAwaitingFigures } from './rz-earnings-banner'
import { daysUntil } from '@/lib/earnings-countdown'
import { getExchangeIcon, EXCHANGE_DOMAINS } from '@/lib/exchangeIcons'

/** Check if a string looks like an address (0x hex, Solana base58, or any long alphanumeric hash) */
const isAddress = (s) => /^0x[a-fA-F0-9]{10,}/i.test(s) || (/^[a-zA-Z0-9]{20,}$/.test(s) && !/^[A-Z0-9]{2,10}$/.test(s))

/** Truncate an address: 0x2AF5...6CC2 or JUPYi...DT1V */
const truncAddr = (s, head = 6, tail = 4) => {
  if (typeof s !== 'string' || s.length <= head + tail) return s || ''
  return `${s.slice(0, head)}...${s.slice(-tail)}`
}

/** Shorten one side of a pair so a single row can never blow out the column.
    Handles three shapes:
      0x2AF5…6CC2            plain address        -> truncAddr
      coin.zig109f7…2.stzig  cosmos factory denom -> the trailing ticker (stzig)
      someVeryLongTicker     anything else long   -> middle-truncated          */
const MAX_PART = 14
function shortenPart(p, tight) {
  const head = tight ? 4 : 6
  if (isAddress(p)) return { text: truncAddr(p, head), cut: true }
  // Cosmos/IBC style denom: the last dot-segment is the human ticker.
  if (p.includes('.')) {
    const tail = p.split('.').filter(Boolean).pop() || ''
    if (tail && tail.length <= 12 && !isAddress(tail)) return { text: tail, cut: true }
  }
  if (p.length > MAX_PART) return { text: truncAddr(p, head), cut: true }
  return { text: p, cut: false }
}

/** Format a pair - shorten address/denom parts, keep normal symbols as-is */
function formatPair(pair) {
  // The markets array is explicitly untrusted (server cache race can yield
  // partial rows). A row with a null/non-string `pair` would throw on .split
  // and blank the whole Markets tab - guard it.
  if (typeof pair !== 'string' || !pair) return { display: '-', hasAddr: false, full: '' }
  const raw = pair.split('/')
  // Two raw addresses side by side is the widest shape this column can hit —
  // trim harder there so one DEX row can't set the width for the whole table.
  const tight = raw.filter(isAddress).length > 1
  const parts = raw.map(p => shortenPart(p, tight))
  const display = parts.map(p => p.text).join('/')
  // `hasAddr` drives the full-value tooltip + copy button: any shortened part
  // means the displayed text is lossy, so the full string must stay reachable.
  const hasAddr = parts.some(p => p.cut)
  return { display, hasAddr, full: pair }
}

/** Full-precision USD — CMC-style readability. "$1,406,578,120" beats "$1.42B"
    for scanning market depth/volume; abbreviations stay in compact columns. */
const fmtFullUsd = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '-'
  return `$${Math.round(n).toLocaleString('en-US')}`
}

/** Extract quote currency from a trading pair (e.g. "BTC/USDT" → "USDT") */
function getQuoteCurrency(pair) {
  if (typeof pair !== 'string' || !pair) return null
  const parts = pair.split('/')
  if (parts.length < 2) return null
  const quote = parts[1].trim().toUpperCase()
  if (isAddress(quote)) return null
  return quote
}

/** Volume threshold presets */
const VOLUME_THRESHOLDS = [
  { id: 'any', label: 'Any', value: 0 },
  { id: '100k', label: '$100K+', value: 100_000 },
  { id: '1m', label: '$1M+', value: 1_000_000 },
  { id: '10m', label: '$10M+', value: 10_000_000 },
  { id: '100m', label: '$100M+', value: 100_000_000 },
  { id: '1b', label: '$1B+', value: 1_000_000_000 },
]

/** Sort column definitions */
const SORT_COLUMNS = [
  { id: 'volume', label: 'Volume', key: 'volume24h' },
  { id: 'price', label: 'Price', key: 'price' },
  { id: 'liquidity', label: 'Liquidity', key: 'liquidity' },
  { id: 'volumePct', label: 'Vol %', key: 'volumePct' },
  { id: 'depth', label: 'Depth', key: 'depthPlus2' },
  { id: 'openInterest', label: 'Open Interest', key: 'openInterest' },
  { id: 'fundingRate', label: 'Funding Rate', key: 'fundingRate' },
]

/** Tiny copy button with tooltip */
function PairCopyBtn({ text }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback((e) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])

  return (
    <button type="button" className="rz-pair-copy-btn" onClick={handleCopy} title={copied ? 'Copied!' : text} aria-label={t('researchPro.markets.paircopybtn.ariaCopyPairAddress', "Copy pair address")}>
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      )}
    </button>
  )
}

/** Sort arrow indicator */
function SortArrow({ column, sortBy, sortDir }) {
  if (sortBy !== column) return <span className="rz-sort-arrow rz-sort-arrow--inactive" aria-hidden>&#8597;</span>
  return <span className="rz-sort-arrow rz-sort-arrow--active" aria-hidden>{sortDir === 'desc' ? '↓' : '↑'}</span>
}

/** Format time-ago string for news items */
function timeAgo(dateStr) {
  if (!dateStr) return ''
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = Math.max(0, now - then)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Get source favicon */
// Generate a gradient for news thumbnails based on source name
const SOURCE_GRADIENTS = {
  'Yahoo Finance': ['#6001d2', '#4a00a0'],
  'Forbes': ['#b5121b', '#8a0e15'],
  'Investing.com': ['#d17a22', '#a55f1a'],
  'MarketWatch': ['#0d8c2e', '#097022'],
  'CNBC': ['#005594', '#003d6b'],
  'Reuters': ['#ff8200', '#cc6800'],
  'Bloomberg': ['#1a1a1a', '#333333'],
  'Barrons': ['#0080c6', '#00609a'],
  'Seeking Alpha': ['#f57b20', '#c46219'],
  'The Motley Fool': ['#105cba', '#0c4790'],
  'Benzinga': ['#0098d5', '#007aaa'],
  'Trefis': ['#2563eb', '#1d4ed8'],
  'Investor\'s Business Daily': ['#1e3a5f', '#162d4a'],
  'Quiver Quantitative': ['#7c3aed', '#6d28d9'],
  'MarketBeat': ['#16a34a', '#15803d'],
};
function sourceGradient(source) {
  if (!source) return ['#6366f1', '#4f46e5'];
  const entry = SOURCE_GRADIENTS[source];
  if (entry) return entry;
  // Generate consistent color from source name hash
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = source.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash % 360);
  return [`hsl(${hue}, 55%, 38%)`, `hsl(${hue}, 55%, 28%)`];
}

// Publisher name → primary domain, for logos/favicons. The old multi-replace
// approach mangled multi-word sources ("Yahoo Finance" → "yahoo.comfinance").
const SOURCE_DOMAINS = {
  'yahoo finance': 'finance.yahoo.com', 'yahoo': 'yahoo.com',
  'reuters': 'reuters.com', 'bloomberg': 'bloomberg.com', 'cnbc': 'cnbc.com',
  'cnn': 'cnn.com', 'wsj': 'wsj.com', 'the wall street journal': 'wsj.com',
  'seeking alpha': 'seekingalpha.com', 'forbes': 'forbes.com',
  'marketwatch': 'marketwatch.com', 'barrons': 'barrons.com', "barron's": 'barrons.com',
  'trefis': 'trefis.com', 'benzinga': 'benzinga.com', 'investing.com': 'investing.com',
  'the motley fool': 'fool.com', 'motley fool': 'fool.com', 'fool': 'fool.com',
  "investor's business daily": 'investors.com', 'business insider': 'businessinsider.com',
  'financial times': 'ft.com', 'techcrunch': 'techcrunch.com', 'the verge': 'theverge.com',
  'axios': 'axios.com', 'fortune': 'fortune.com', 'quartz': 'qz.com', 'qz': 'qz.com',
  'the information': 'theinformation.com', 'quiver quantitative': 'quiverquant.com',
  'marketbeat': 'marketbeat.com', 'investopedia': 'investopedia.com', 'nasdaq': 'nasdaq.com',
  'associated press': 'apnews.com', 'ap news': 'apnews.com', 'the guardian': 'theguardian.com',
  'investorplace': 'investorplace.com', 'zacks': 'zacks.com', 'tipranks': 'tipranks.com',
}
function sourceDomain(source) {
  if (!source) return null
  // Strip a trailing " - Section" / " | Brand" qualifier Google News sometimes adds.
  const key = String(source).trim().toLowerCase().replace(/\s*[-–|].*$/, '').trim()
  if (SOURCE_DOMAINS[key]) return SOURCE_DOMAINS[key]
  const cleaned = key.replace(/[^a-z0-9.]/g, '')
  if (!cleaned) return null
  return cleaned.includes('.') ? cleaned : `${cleaned}.com`
}
function sourceFavicon(source, sz = 32) {
  const d = sourceDomain(source)
  return d ? `https://www.google.com/s2/favicons?domain=${d}&sz=${sz}` : null
}
// Larger, crisper publisher logo for the story thumbnail (vs the tiny meta favicon).
function sourceLogo(source) {
  return sourceFavicon(source, 128)
}
// Best image for a story card: a real article photo if the feed gave one
// (crypto/CryptoCompare), otherwise the publisher's logo (Google News gives no
// images). Returns { src, kind } or null → letter tile.
function storyThumb(item) {
  if (item?.imageUrl) return { src: item.imageUrl, kind: 'photo' }
  const logo = sourceLogo(item?.source)
  return logo ? { src: logo, kind: 'logo' } : null
}

const RzMarketsSection = React.memo(function RzMarketsSection({
  reportedEarnings,
  isStock,
  symbol,
  tokenName,
  tokenData,
  marketsSectionTab,
  setMarketsSectionTab,
  marketFilter,
  setMarketFilter,
  icons,
  fmtPrice,
  fmtLarge,
  markets,
  marketsLoading,
  newsItems,
  activeTokenInfo,
  filtersPortalRef,
  onMakerFilter,
}) {
  const { t } = useTranslation()

  // Filter panel state
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sortBy, setSortBy] = useState('volume')
  const [sortDir, setSortDir] = useState('desc')
  const [quoteCurrency, setQuoteCurrency] = useState('all')
  const [minVolume, setMinVolume] = useState(0)
  const [marketsPage, setMarketsPage] = useState(0)
  const MARKETS_PER_PAGE = 10
  const filtersRef = useRef(null)

  // ── Onchain trades state ───────────────────────────────────────────────
  const isOnchain = !isStock && activeTokenInfo?.address && activeTokenInfo.address.length > 10
  const [trades, setTrades] = useState([])
  const [tradesLoading, setTradesLoading] = useState(false)
  const tradesLoadedRef = useRef(null) // track which address we loaded
  const [makerFilter, setMakerFilter] = useState(null)

  useEffect(() => {
    if (!isOnchain || marketsSectionTab !== 'trades') return
    // Don't re-fetch if already loaded for this address
    if (tradesLoadedRef.current === activeTokenInfo.address) return
    let cancelled = false
    setTradesLoading(true)
    // 2026-05-08 cost migration: try Spectre onchain trades first (free), fall back to Codex.
    const netId = activeTokenInfo.networkId ?? 1
    ;(async () => {
      try {
        if (isOnchainSupported(netId)) {
          const sp = await onchainGetLatestTrades(activeTokenInfo.address, netId, 50)
          if (sp?.success && Array.isArray(sp.data) && sp.data.length > 0) {
            if (!cancelled) {
              setTrades(sp.data)
              tradesLoadedRef.current = activeTokenInfo.address
              setTradesLoading(false)
            }
            return
          }
        }
        // Codex fallback
        const result = await getLatestTrades(activeTokenInfo.address, netId, 50)
        if (cancelled) return
        setTrades(result?.trades || [])
        tradesLoadedRef.current = activeTokenInfo.address
      } catch {
        if (!cancelled) setTrades([])
      } finally {
        if (!cancelled) setTradesLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [isOnchain, marketsSectionTab, activeTokenInfo?.address, activeTokenInfo?.networkId])

  // Reset trades when token changes; fall back to exchanges if trades unavailable
  useEffect(() => {
    tradesLoadedRef.current = null
    setTrades([])
    setMakerFilter(null)
    onMakerFilter?.(null)
    const tokenIsOnchain = !isStock && activeTokenInfo?.address && activeTokenInfo.address.length > 10
    if (!tokenIsOnchain && marketsSectionTab === 'trades') {
      setMarketsSectionTab('markets')
    }
  }, [activeTokenInfo?.address])

  // Filter trades by maker
  const filteredTrades = useMemo(() => {
    if (!makerFilter) return trades
    return trades.filter(t => t.maker === makerFilter)
  }, [trades, makerFilter])

  // Native token symbol (ETH/SOL) and max USD for impact bar
  const nativeSym = trades[0]?.isSolana ? 'SOL' : 'ETH'
  const maxTradeUsd = useMemo(() => filteredTrades.reduce((max, t) => Math.max(max, t.amountUSD || 0), 1), [filteredTrades])

  // Per-maker trade counts, precomputed once. The row render previously did
  // `trades.filter(t => t.maker === trade.maker).length` for EVERY row — O(n^2)
  // over the full trades list on every render. A single Map pass is O(n).
  const makerTxCounts = useMemo(() => {
    const counts = new Map()
    for (const t of trades) {
      if (!t?.maker) continue
      counts.set(t.maker, (counts.get(t.maker) || 0) + 1)
    }
    return counts
  }, [trades])

  // Notify parent when maker filter changes (for chart markers)
  const handleMakerFilter = useCallback((maker) => {
    const next = makerFilter === maker ? null : maker
    setMakerFilter(next)
    // Pass filtered trades to parent for chart markers
    if (next) {
      const walletTrades = trades.filter(t => t.maker === next)
      onMakerFilter?.(walletTrades)
    } else {
      onMakerFilter?.(null)
    }
  }, [makerFilter, trades, onMakerFilter])

  // Close filters panel on click outside
  useEffect(() => {
    if (!filtersOpen) return
    const handleClick = (e) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target)) {
        setFiltersOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [filtersOpen])

  // Use API data - filter out stale data from wrong token (server cache race condition)
  const rawMarkets = useMemo(() => {
    if (!markets || markets.length === 0) return []
    const sym = (symbol || '').toUpperCase()
    if (!sym) return markets
    // Check first market's pair base currency matches current token
    const firstPair = markets[0]?.pair || ''
    const base = firstPair.split('/')[0].toUpperCase()
    if (base && base !== sym && sym !== 'BTC' && base === 'BTC') return []
    return markets
  }, [markets, symbol])

  // Extract unique quote currencies from the data
  const availableQuotes = useMemo(() => {
    const quotes = new Set()
    rawMarkets.forEach(m => {
      const q = getQuoteCurrency(m.pair)
      if (q) quotes.add(q)
    })
    // Sort by frequency (most common first)
    const counts = {}
    rawMarkets.forEach(m => {
      const q = getQuoteCurrency(m.pair)
      if (q) counts[q] = (counts[q] || 0) + 1
    })
    return Array.from(quotes).sort((a, b) => (counts[b] || 0) - (counts[a] || 0))
  }, [rawMarkets])

  // Count active advanced filters
  const activeFilterCount = (quoteCurrency !== 'all' ? 1 : 0) + (minVolume > 0 ? 1 : 0) + (sortBy !== 'volume' || sortDir !== 'desc' ? 1 : 0)

  // ── Stock: related Polymarket prediction markets. The service call is the
  // same cached+LS-seeded events blob the /predictions page uses (3-min TTL,
  // shared inflight), so a warm session costs zero extra requests. Empty
  // result = card simply doesn't render — never fabricated rows.
  const [stockPredictions, setStockPredictions] = useState(null)
  useEffect(() => {
    if (!isStock || !symbol) { setStockPredictions(null); return undefined }
    let cancelled = false
    // Strip the legal suffix so 'Tesla Inc.' matches Polymarket's 'Tesla ...'
    const companyName = (tokenName || '').replace(/,?\s+(inc|corp|corporation|company|co|ltd|plc|class [a-c])\.?$/i, '').trim()
    getPredictionMarketsForToken(symbol, companyName, 4)
      .then(rows => { if (!cancelled) setStockPredictions(Array.isArray(rows) ? rows : []) })
      .catch(() => { if (!cancelled) setStockPredictions([]) })
    return () => { cancelled = true }
  }, [isStock, symbol, tokenName])

  // SEC EDGAR insider activity (Form 4) — real filings only; null/empty = no
  // card, never fabricated rows. Server+module caches keep this cheap.
  const [insiders, setInsiders] = useState(null)
  useEffect(() => {
    if (!isStock || !symbol) { setInsiders(null); return undefined }
    let cancelled = false
    getInsiderActivity(symbol)
      .then(data => { if (!cancelled) setInsiders(data) })
      .catch(() => { if (!cancelled) setInsiders(null) })
    return () => { cancelled = true }
  }, [isStock, symbol])

  const handleSort = useCallback((colId) => {
    if (sortBy === colId) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(colId)
      setSortDir('desc')
    }
    setMarketsPage(0)
  }, [sortBy])

  const resetFilters = useCallback(() => {
    setSortBy('volume')
    setSortDir('desc')
    setQuoteCurrency('all')
    setMinVolume(0)
    setMarketsPage(0)
  }, [])

  // Apply type filter → quote filter → volume filter → sort
  const filteredMarkets = useMemo(() => {
    let result = rawMarkets

    // Type filter (CEX/DEX/Spot/etc.)
    if (marketFilter === 'cex') result = result.filter(m => m.type !== 'dex')
    else if (marketFilter === 'dex') result = result.filter(m => m.type === 'dex')
    else if (marketFilter === 'spot') result = result.filter(m => !m.isDerivative)
    else if (marketFilter === 'perpetual') result = result.filter(m => m.isDerivative && m.derivativeType === 'perpetual')
    else if (marketFilter === 'futures') result = result.filter(m => m.isDerivative && m.derivativeType === 'futures')

    // Quote currency filter
    if (quoteCurrency !== 'all') {
      result = result.filter(m => getQuoteCurrency(m.pair) === quoteCurrency)
    }

    // Min volume filter
    if (minVolume > 0) {
      result = result.filter(m => (m.volume24h || 0) >= minVolume)
    }

    // Sort. Volume ranking is DEPTH-VERIFIED: an exchange's reported 24h
    // volume is trusted only up to 50x its posted ±2% order-book depth.
    // Wash-trading venues print enormous volume on a thin book (Ourbit
    // "outranking" Binance on BTC) — depth is the expensive part to fake.
    // Displayed numbers stay raw; only the ordering is adjusted. Rows with
    // no depth data (derivatives, DEX pools) pass through unadjusted.
    const depthVerifiedVolume = (m) => {
      const vol = Number(m.volume24h) || 0
      const depth = (Number(m.depthPlus2) || 0) + (Number(m.depthMinus2) || 0)
      if (depth <= 0) return vol
      return Math.min(vol, depth * 50)
    }
    const col = SORT_COLUMNS.find(c => c.id === sortBy)
    if (col) {
      result = [...result].sort((a, b) => {
        const va = col.id === 'volume' ? depthVerifiedVolume(a) : (a[col.key] || 0)
        const vb = col.id === 'volume' ? depthVerifiedVolume(b) : (b[col.key] || 0)
        return sortDir === 'desc' ? vb - va : va - vb
      })
    }

    return result
  }, [rawMarkets, marketFilter, quoteCurrency, minVolume, sortBy, sortDir])

  return (
    <section className="research-zone-lite-markets" aria-labelledby="markets-heading">
      <div className="research-zone-lite-markets-header">
        {/* Stock mode: show title + full sub-tabs */}
        {isStock && (
          <>
            <h2 id="markets-heading" className="research-zone-lite-markets-title">
              <span className="research-zone-lite-markets-title-icon" aria-hidden>{icons.sector}</span>
              {t('researchLite.markets')}
            </h2>
            <div className="research-zone-lite-markets-tabs" role="tablist" aria-label={t('researchPro.markets.rzmarkets.ariaStockDataTabs', "Stock data tabs")}>
              {[
                { id: 'markets', label: t('researchLite.fundamentals') },
                { id: 'overview', label: 'Overview' },
                { id: 'financials', label: 'Financials' },
                { id: 'earnings', label: 'Earnings' },
                { id: 'holders', label: 'Holders' },
                { id: 'historical-data', label: 'Historical Data' },
              ].map(tab => (
                <button key={tab.id} type="button" role="tab" aria-selected={marketsSectionTab === tab.id} className={`research-zone-lite-markets-tab ${marketsSectionTab === tab.id ? 'active' : ''}`} onClick={() => setMarketsSectionTab(tab.id)}>
                  {tab.label}
                </button>
              ))}
            </div>
          </>
        )}
        {/* Crypto mode: CMC-style title + inline filters */}
        {!isStock && (
          <>
            <div className="rz-markets-title-row">
              <h2 id="markets-heading" className="research-zone-lite-markets-title">{tokenName} Markets</h2>
              <div className="research-zone-lite-markets-filters">
                <div className="rz-mkt-filter-group">
                  {MARKET_FILTERS.filter(f => ['all', 'cex', 'dex'].includes(f.id)).map((f) => (
                    <button key={f.id} type="button" className={`research-zone-lite-market-filter ${marketFilter === f.id ? 'active' : ''}`} onClick={() => { setMarketFilter(f.id); setMarketsPage(0) }}>
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="rz-mkt-filter-group">
                  {MARKET_FILTERS.filter(f => ['spot', 'perpetual', 'futures'].includes(f.id)).map((f) => (
                    <button key={f.id} type="button" className={`research-zone-lite-market-filter ${marketFilter === f.id ? 'active' : ''}`} onClick={() => { setMarketFilter(f.id); setMarketsPage(0) }}>
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="rz-filters-dropdown-anchor" ref={filtersRef}>
                  <button type="button" className={`research-zone-lite-filters-btn ${filtersOpen ? 'active' : ''} ${activeFilterCount > 0 ? 'has-filters' : ''}`} title={t('researchPro.markets.rzmarkets.title', "Filters")} aria-label={t('researchPro.markets.rzmarkets.ariaFilters', "Filters")} onClick={() => setFiltersOpen(o => !o)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    {t('common.filters')}
                    {activeFilterCount > 0 && <span className="rz-filters-badge">{activeFilterCount}</span>}
                  </button>
                  {filtersOpen && (
                    <div className="rz-filters-dropdown">
                      <div className="rz-filters-dropdown-header">
                        <span className="rz-filters-dropdown-title">{t('researchPro.markets.rzmarkets.advancedFilters', "Advanced Filters")}</span>
                        {activeFilterCount > 0 && (
                          <button type="button" className="rz-filters-reset-btn" onClick={resetFilters}>{t('researchPro.markets.rzmarkets.resetAll', "Reset all")}</button>
                        )}
                      </div>
                      <div className="rz-filters-group">
                        <label className="rz-filters-label">{t('researchPro.markets.rzmarkets.sortBy', "Sort by")}</label>
                        <div className="rz-filters-pills">
                          {SORT_COLUMNS.map(col => (
                            <button key={col.id} type="button" className={`rz-filters-pill ${sortBy === col.id ? 'active' : ''}`} onClick={() => handleSort(col.id)}>
                              {col.label}
                              {sortBy === col.id && <span className="rz-filters-pill-dir">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                            </button>
                          ))}
                        </div>
                      </div>
                      {availableQuotes.length > 1 && (
                        <div className="rz-filters-group">
                          <label className="rz-filters-label">{t('researchPro.markets.rzmarkets.quoteCurrency', "Quote currency")}</label>
                          <div className="rz-filters-pills">
                            <button type="button" className={`rz-filters-pill ${quoteCurrency === 'all' ? 'active' : ''}`} onClick={() => { setQuoteCurrency('all'); setMarketsPage(0) }}>{t('researchPro.markets.rzmarkets.all', "All")}</button>
                            {availableQuotes.slice(0, 6).map(q => (
                              <button key={q} type="button" className={`rz-filters-pill ${quoteCurrency === q ? 'active' : ''}`} onClick={() => { setQuoteCurrency(quoteCurrency === q ? 'all' : q); setMarketsPage(0) }}>{q}</button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="rz-filters-group">
                        <label className="rz-filters-label">Min volume (24h)</label>
                        <div className="rz-filters-pills">
                          {VOLUME_THRESHOLDS.map(v => (
                            <button key={v.id} type="button" className={`rz-filters-pill ${minVolume === v.value ? 'active' : ''}`} onClick={() => { setMinVolume(v.value); setMarketsPage(0) }}>
                              {v.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      {/* ── Stock: Fundamentals tab ── */}
      {isStock && marketsSectionTab === 'markets' && (
        <div className="research-zone-lite-stock-fundamentals">
          <div className="research-zone-lite-stock-fundamentals-grid">
            {[
              { label: t('common.marketCap'), value: tokenData.mcap ? fmtLarge(tokenData.mcap) : '-' },
              { label: t('researchLite.peRatio'), value: tokenData.pe != null ? tokenData.pe.toFixed(1) : '-' },
              { label: t('researchLite.eps'), value: tokenData.eps != null ? fmtPrice(tokenData.eps) : '-' },
              { label: t('common.volume'), value: tokenData.volume24h ? fmtLarge(tokenData.volume24h) : '-' },
              { label: t('researchLite.avgVolume'), value: tokenData.avgVolume ? fmtLarge(tokenData.avgVolume) : '-' },
              { label: t('researchLite.week52High'), value: tokenData.week52High ? fmtPrice(tokenData.week52High) : '-' },
              { label: t('researchLite.week52Low'), value: tokenData.week52Low ? fmtPrice(tokenData.week52Low) : '-' },
              { label: t('researchLite.sector'), value: tokenData.sector || '-' },
              { label: t('researchLite.exchange'), value: tokenData.exchange || '-' },
            ].map((item) => (
              <div key={item.label} className="research-zone-lite-stock-fund-item">
                <span className="research-zone-lite-stock-fund-label">{item.label}</span>
                <span className="research-zone-lite-stock-fund-value">{item.value}</span>
              </div>
            ))}
          </div>

          {/* ── IPO milestone — newly-listed names get their first-trade
              reference; crossing below it is a KEY EVENT the page must say
              out loud (SPCX broke $150 on 2026-07-13 and this page said
              nothing). Computed live from IPO_REFERENCE + the quote. */}
          {(() => {
            const ref = IPO_REFERENCE[String(tokenData.symbol || '').toUpperCase()]
            const px = Number(tokenData.price)
            if (!ref || !Number.isFinite(px) || px <= 0) return null
            const pct = ((px / ref.price) - 1) * 100
            const below = px < ref.price
            return (
              <div className="rz-stk-card">
                <div className="rz-stk-card-head">
                  <span className="rz-stk-card-title">{t('researchPro.markets.rzmarkets.ipoReference', "IPO Reference")}</span>
                  <span className="rz-stk-card-sub">{fmtPrice(ref.price)} · listed {ref.date}</span>
                  <span className={`rz-stk-rec ${below ? 'rz-stk-rec--bear' : 'rz-stk-rec--neutral'}`}>
                    {below ? `${Math.abs(pct).toFixed(1)}% below IPO` : `+${pct.toFixed(1)}% vs IPO`}
                  </span>
                </div>
                {below && (
                  <p className="rz-stk-note">
                    Trading under the IPO print — every IPO allocation that held is underwater. Broken-IPO names
                    often chop until a fresh catalyst; the {fmtPrice(ref.price)} level now acts as overhead supply.
                  </p>
                )}
                {ref.lockup && (() => {
                  const ld = daysUntil(ref.lockup)
                  if (ld == null) return null
                  const lockStr = new Date(ref.lockup).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  const expired = ld < 0
                  const soon = !expired && ld <= 21
                  return (
                    <div className="rz-ipo-lockup">
                      <div className="rz-ipo-lockup-row">
                        <span className="rz-ipo-lockup-label">{t('researchPro.markets.rzmarkets.lockupExpiry', "Lockup expiry")}</span>
                        <span className="rz-ipo-lockup-date">{lockStr}</span>
                        <span className={`rz-stk-rec ${soon ? 'rz-stk-rec--bear' : 'rz-stk-rec--neutral'}`}>
                          {expired ? 'expired' : ld === 0 ? 'today' : ld === 1 ? 'tomorrow' : `in ${ld} days`}
                        </span>
                      </div>
                      <p className="rz-stk-note">
                        {expired
                          ? 'Insider & early-investor shares are now free to sell — the post-IPO supply overhang is live.'
                          : 'Insider & early-investor shares unlock on this date — a wave of newly-sellable supply that can pressure the price into and after it.'}
                      </p>
                    </div>
                  )
                })()}
              </div>
            )
          })()}

          {/* ── Analyst Consensus — real Street data (Yahoo financialData +
              recommendationTrend). The /api/stocks/analysts route existed for
              months but nothing ever rendered analyst data. */}
          {(tokenData.targetMeanPrice != null || tokenData.recTrend) && (() => {
            const price = Number(tokenData.price) || null
            const mean = Number(tokenData.targetMeanPrice) || null
            const upside = (price && mean) ? ((mean - price) / price) * 100 : null
            const rt = tokenData.recTrend
            const total = rt ? (rt.strongBuy + rt.buy + rt.hold + rt.sell + rt.strongSell) : 0
            const recKey = tokenData.recommendationKey || ''
            const recLabel = recKey.replace(/_/g, ' ')
            const recTone = /buy/.test(recKey) ? 'bull' : /sell|underperform/.test(recKey) ? 'bear' : 'neutral'
            const segs = (rt && total > 0) ? [
              { label: 'Strong Buy', cls: 'sb', v: rt.strongBuy },
              { label: 'Buy', cls: 'b', v: rt.buy },
              { label: 'Hold', cls: 'h', v: rt.hold },
              { label: 'Sell', cls: 's', v: rt.sell },
              { label: 'Strong Sell', cls: 'ss', v: rt.strongSell },
            ].filter(s => s.v > 0) : []
            return (
              <div className="rz-stk-card">
                <div className="rz-stk-card-head">
                  <span className="rz-stk-card-title">{t('researchPro.markets.rzmarkets.analystConsensus', "Analyst Consensus")}</span>
                  <span className="rz-stk-card-sub">{tokenData.analystCount ? `${tokenData.analystCount} analysts · ` : ''}Yahoo Finance</span>
                  {recLabel && <span className={`rz-stk-rec rz-stk-rec--${recTone}`}>{recLabel}</span>}
                </div>
                {segs.length > 0 && (
                  <>
                    <div className="rz-stk-recbar" role="img" aria-label={`Ratings: ${segs.map(s => `${s.v} ${s.label}`).join(', ')}`}>
                      {segs.map(s => (
                        <span key={s.label} className={`rz-stk-recbar-seg rz-stk-recbar-seg--${s.cls}`} style={{ width: `${(s.v / total) * 100}%` }} />
                      ))}
                    </div>
                    <div className="rz-stk-recbar-legend">
                      {segs.map(s => (
                        <span key={s.label} className="rz-stk-recbar-item">
                          <span className={`rz-stk-recbar-dot rz-stk-recbar-dot--${s.cls}`} />
                          {s.label} <span className="mono">{s.v}</span>
                        </span>
                      ))}
                    </div>
                  </>
                )}
                {mean != null && (
                  <div className="rz-stk-targets">
                    <div className="rz-stk-target">
                      <span className="rz-stk-target-label">{t('researchPro.markets.rzmarkets.lowTarget', "Low target")}</span>
                      <span className="rz-stk-target-value mono">{tokenData.targetLowPrice != null ? fmtPrice(tokenData.targetLowPrice) : '-'}</span>
                    </div>
                    <div className="rz-stk-target rz-stk-target--mean">
                      <span className="rz-stk-target-label">{t('researchPro.markets.rzmarkets.meanTarget', "Mean target")}</span>
                      <span className="rz-stk-target-value mono">{fmtPrice(mean)}</span>
                      {upside != null && (
                        <span className={`rz-stk-target-upside mono ${upside >= 0 ? 'rz-stk-up' : 'rz-stk-down'}`}>
                          {upside >= 0 ? '+' : ''}{upside.toFixed(1)}% vs price
                        </span>
                      )}
                    </div>
                    <div className="rz-stk-target">
                      <span className="rz-stk-target-label">{t('researchPro.markets.rzmarkets.highTarget', "High target")}</span>
                      <span className="rz-stk-target-value mono">{tokenData.targetHighPrice != null ? fmtPrice(tokenData.targetHighPrice) : '-'}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── Insider Activity — SEC Form 4 (EDGAR, keyless). Net 90d flow
              counts only open-market buys (P) and sales (S); exercises/awards/
              tax withholding are comp mechanics, not conviction. */}
          {insiders?.filings?.length > 0 && (() => {
            const s = insiders.summary || {}
            const net = Number(s.netFlow90d) || 0
            const hasFlow = (s.buys90d || 0) > 0 || (s.sells90d || 0) > 0
            const rows = insiders.filings.filter(f => f.value != null).slice(0, 5)
            if (!rows.length && !hasFlow) return null
            return (
              <div className="rz-stk-card">
                <div className="rz-stk-card-head">
                  <span className="rz-stk-card-title">{t('researchPro.markets.rzmarkets.insiderActivity', "Insider Activity")}</span>
                  <span className="rz-stk-card-sub">SEC Form 4 · 90d</span>
                  <span className={`rz-stk-rec ${!hasFlow ? 'rz-stk-rec--neutral' : net > 0 ? 'rz-stk-rec--bull' : net < 0 ? 'rz-stk-rec--bear' : 'rz-stk-rec--neutral'}`}>
                    {!hasFlow ? 'no open-market trades' : `${net > 0 ? 'net buying' : 'net selling'} ${fmtLarge(Math.abs(net))}`}
                  </span>
                </div>
                <div className="rz-stk-targets">
                  {rows.map((f, i) => (
                    <div key={`${f.owner}-${f.date}-${i}`} className="rz-stk-target">
                      <span className="rz-stk-target-label">
                        {f.owner}{f.title ? ` · ${f.title}` : ''}
                      </span>
                      <span className="rz-stk-target-value mono" style={{ color: f.code === 'P' ? 'var(--bull)' : f.code === 'S' ? 'var(--bear)' : undefined }}>
                        {f.kind} {fmtLarge(f.value)}{f.date ? ` · ${f.date}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Next Earnings moved up: it now renders as RzEarningsBanner above the
              price chart (research-zone-lite.jsx) so the gap-risk lead is the
              first thing on the page, not buried at the bottom of Markets. */}

          {/* ── Related prediction markets — live Polymarket odds (real rows
              only; the card disappears when no market references this name) */}
          {stockPredictions && stockPredictions.length > 0 && (
            <div className="rz-stk-card">
              <div className="rz-stk-card-head">
                <span className="rz-stk-card-title">{t('researchPro.markets.rzmarkets.predictionMarkets', "Prediction Markets")}</span>
                <span className="rz-stk-card-sub">Live odds · Polymarket</span>
              </div>
              <div className="rz-stk-pred-list">
                {stockPredictions.map(p => (
                  <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="rz-stk-pred-row">
                    <span className="rz-stk-pred-q">{p.question}</span>
                    <span className={`rz-stk-pred-yes mono ${p.yesPct >= 50 ? 'rz-stk-up' : 'rz-stk-down'}`}>{p.yesPct}%</span>
                    <span className="rz-stk-pred-meta mono">${p.volume >= 1e6 ? `${(p.volume / 1e6).toFixed(1)}M` : `${Math.round(p.volume / 1e3)}K`} · {p.endDate}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Stock: Overview tab → AI Analysis + Stories ── */}
      {isStock && marketsSectionTab === 'overview' && (
        <div className="rz-stock-news-section">
          {/* AI Analysis Card — editorial narrative */}
          {tokenData.price > 0 && (() => {
            const price = tokenData.price;
            const chg = tokenData.change24h || 0;
            const high52 = tokenData.week52High;
            const low52 = tokenData.week52Low;
            const pe = tokenData.pe;
            const mcap = tokenData.mcap;
            const volume = tokenData.volume24h;
            const avgVol = tokenData.avgVolume;
            const sector = tokenData.sector || '';
            const bullish = chg > 0;
            const rangePct = high52 && low52 ? ((price - low52) / (high52 - low52) * 100) : null;
            const fromHigh = high52 ? (((price - high52) / high52) * 100) : null;

            // Build editorial narrative
            const direction = bullish ? 'higher' : 'lower';
            const magnitude = Math.abs(chg) > 3 ? 'sharply' : Math.abs(chg) > 1.5 ? 'notably' : 'modestly';
            const capTier = mcap > 500e9 ? 'mega-cap' : mcap > 100e9 ? 'large-cap' : mcap > 10e9 ? 'mid-cap' : 'small-cap';
            const sectorContext = sector ? ` within the ${sector.toLowerCase()} sector` : '';
            const volSignal = volume && avgVol && volume > avgVol * 1.3 ? ' on above-average volume' : volume && avgVol && volume < avgVol * 0.7 ? ' on lighter-than-usual volume' : '';

            let rangeContext = '';
            if (rangePct !== null) {
              if (rangePct >= 80) rangeContext = ` The stock is trading near the upper end of its 52-week range, suggesting strong momentum.`;
              else if (rangePct <= 20) rangeContext = ` Shares are hovering near the lower end of their 52-week range, which may attract value-oriented investors.`;
              else rangeContext = ` The stock sits at ${rangePct.toFixed(0)}% of its 52-week range, between ${fmtPrice(low52)} and ${fmtPrice(high52)}.`;
            }

            let valContext = '';
            if (pe) {
              if (pe > 60) valContext = ` At ${pe.toFixed(1)}x earnings, the valuation reflects significant growth expectations priced into the stock.`;
              else if (pe > 25) valContext = ` With a P/E of ${pe.toFixed(1)}x, the stock carries a growth-oriented valuation.`;
              else if (pe > 15) valContext = ` Trading at ${pe.toFixed(1)}x earnings, the valuation appears reasonable relative to sector peers.`;
              else valContext = ` At just ${pe.toFixed(1)}x earnings, the stock trades at a discount that could signal opportunity.`;
            }

            let fromHighContext = '';
            if (fromHigh !== null && fromHigh < -10) {
              fromHighContext = ` Shares remain ${Math.abs(fromHigh).toFixed(1)}% below their 52-week high of ${fmtPrice(high52)}, leaving room for recovery if conditions improve.`;
            }

            const narrative = `${tokenName} shares are trading ${magnitude} ${direction}${volSignal}, moving ${bullish ? '+' : ''}${chg.toFixed(2)}% to ${fmtPrice(price)}${sectorContext}. The ${capTier} name carries a market capitalization of ${fmtLarge(mcap)}.${rangeContext}${valContext}${fromHighContext}`;

            return (
              <div className={`rz-ai-analysis-card ${bullish ? 'rz-ai-analysis--bull' : 'rz-ai-analysis--bear'}`}>
                {/* Honesty fix: this narrative is DETERMINISTIC template prose
                    composed from real quote fields — it is not an LLM read and
                    it is not live-streaming. "AI Analysis · LIVE" was the same
                    fabrication class the Command Center fix killed (PR #1173).
                    The grounded LLM desk read replaces this card in Phase 2. */}
                <div className="rz-ai-analysis-header">
                  <span className="rz-ai-analysis-icon">{icons.signal || icons.chart}</span>
                  <span className="rz-ai-analysis-title">{t('researchPro.markets.rzmarkets.snapshot', "Snapshot")}</span>
                </div>
                <div className="rz-ai-analysis-body">
                  <p className="rz-ai-analysis-summary">{narrative}</p>
                </div>
              </div>
            );
          })()}

          {newsItems && newsItems.length > 0 ? (
            <>
              <h3 className="rz-stock-news-heading">Stories & Analysis</h3>
              <div className="rz-stock-news-grid">
                {newsItems.slice(0, 4).map((item, i) => {
                  const [g1, g2] = sourceGradient(item.source);
                  return (
                    <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="rz-stock-news-card">
                      <div className="rz-stock-news-card-body">
                        <span className="rz-stock-news-card-title">{item.title}</span>
                        <span className="rz-stock-news-card-meta">
                          {sourceFavicon(item.source) && <img src={sourceFavicon(item.source)} alt="" className="rz-stock-news-favicon" onError={(e) => { e.target.style.display = 'none' }} />}
                          {item.source || 'News'} · {timeAgo(item.publishedOn ? item.publishedOn * 1000 : (item.publishedAt || item.time))}
                        </span>
                      </div>
                      {(() => {
                        const thumb = storyThumb(item)
                        return (
                          <div className="rz-stock-news-card-thumb" style={{ background: `linear-gradient(135deg, ${g1}, ${g2})` }}>
                            <span className="rz-stock-news-card-thumb-letter">{(item.source || 'N').charAt(0)}</span>
                            {thumb && (
                              <img src={thumb.src} alt="" loading="lazy" className={`rz-stock-news-card-thumb-img rz-stock-news-card-thumb-img--${thumb.kind}`} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                            )}
                          </div>
                        )
                      })()}
                    </a>
                  );
                })}
              </div>
              {newsItems.length > 4 && (
                <div className="rz-stock-news-grid" style={{ marginTop: 10 }}>
                  {newsItems.slice(4, 8).map((item, i) => {
                    const [g1, g2] = sourceGradient(item.source);
                    return (
                      <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="rz-stock-news-card">
                        <div className="rz-stock-news-card-body">
                          <span className="rz-stock-news-card-title">{item.title}</span>
                          <span className="rz-stock-news-card-meta">
                            {sourceFavicon(item.source) && <img src={sourceFavicon(item.source)} alt="" className="rz-stock-news-favicon" onError={(e) => { e.target.style.display = 'none' }} />}
                            {item.source || 'News'} · {timeAgo(item.publishedOn ? item.publishedOn * 1000 : (item.publishedAt || item.time))}
                          </span>
                        </div>
                        {(() => {
                          const thumb = storyThumb(item)
                          return (
                            <div className="rz-stock-news-card-thumb" style={{ background: `linear-gradient(135deg, ${g1}, ${g2})` }}>
                              <span className="rz-stock-news-card-thumb-letter">{(item.source || 'N').charAt(0)}</span>
                              {thumb && (
                                <img src={thumb.src} alt="" loading="lazy" className={`rz-stock-news-card-thumb-img rz-stock-news-card-thumb-img--${thumb.kind}`} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                              )}
                            </div>
                          )
                        })()}
                      </a>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="rz-stock-tab-placeholder">
              <span className="rz-stock-tab-placeholder-icon">{icons.sector}</span>
              <span>{t('researchPro.markets.rzmarkets.loadingNews', "Loading news...")}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Stock: Other tabs (placeholders) ── */}
      {isStock && marketsSectionTab === 'financials' && (
        <div className="rz-stock-tab-placeholder">
          <span className="rz-stock-tab-placeholder-icon">{icons.sector}</span>
          <span>{t('researchPro.markets.rzmarkets.financialStatementsComingSo', "Financial statements coming soon")}</span>
        </div>
      )}
      {isStock && marketsSectionTab === 'earnings' && (() => {
        // ── The read beside the table ──────────────────────────────────────
        // Everything here is computed from the rows already on the page. No
        // LLM, no forecast, no "expected move" — a surprise history and a
        // countdown are facts; anything past that would be invention. When the
        // history is too thin to support a claim the panel says which claim it
        // cannot make, rather than printing a confident number off n=1.
        const buildEarningsRead = (rows, r) => {
          const graded = rows
            .map((h) => {
              const est = h.epsEstimate, act = h.epsActual
              if (est == null || act == null || Math.abs(est) < 1e-9) return null
              return { surprise: ((act - est) / Math.abs(est)) * 100, beat: act >= est, quarter: h.date || h.quarter }
            })
            .filter(Boolean)

          const notes = []
          const beats = graded.filter((g) => g.beat).length
          const avg = graded.length ? graded.reduce((s, g) => s + g.surprise, 0) / graded.length : null
          // Consistency = how tightly the Street has modelled this name. A wide
          // spread means the consensus on the next print is a weak anchor.
          const spread = graded.length >= 3
            ? Math.sqrt(graded.reduce((s, g) => s + (g.surprise - avg) ** 2, 0) / graded.length)
            : null

          if (!graded.length) {
            notes.push(rows.length
              ? `${rows.length} reported quarter${rows.length > 1 ? 's' : ''} on record, but no Street estimate against them — no surprise history to read yet.`
              : 'No reported quarters on record yet.')
          }
          // A streak is only a streak if it is unbroken and long enough to mean
          // something — 2 of the last 2 is a coin flip with a narrative.
          let streak = 0
          for (const g of graded) { if (g.beat === graded[0].beat) streak++; else break }

          return { graded, beats, avg, spread, streak, streakDir: graded[0]?.beat, notes }
        }
        return (() => {
        const hist = Array.isArray(tokenData.earningsHistory) ? tokenData.earningsHistory : []
        const hasNext = !!tokenData.earningsDate
        if (!hasNext && hist.length === 0) {
          return (
            <div className="rz-stock-tab-placeholder">
              <span className="rz-stock-tab-placeholder-icon">{icons.sector}</span>
              <span>{t('researchPro.markets.rzmarkets.noEarningsDataAvailableFor', "No earnings data available for this ticker.")}</span>
            </div>
          )
        }
        const days = hasNext ? daysUntil(tokenData.earningsDate) : null
        const nextDateStr = hasNext
          ? new Date(tokenData.earningsDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
          : null
        const countLabel = days == null ? null : days < 0 ? 'reported' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
        const rows = hist.slice().reverse() // most recent first
        // The print has happened but the vendor hasn't published its row yet.
        // On 2026-08-04 SPCX reported at 20:00 UTC and this table still showed
        // nothing newer than Mar 2026 an hour later — the page looked stale on
        // the one night it mattered (founder: "shouldn't earnings show in
        // research zone for spcx?"). It wasn't wrong, it just said nothing.
        // Read from the banner module so the hero rail and this tab can never
        // disagree about whether a company has reported.
        const awaitingFigures = isAwaitingFigures(tokenData.earningsDate, hist)
        const read = buildEarningsRead(rows, tokenData)
        const rep = reportedEarnings && reportedEarnings.status === 'reported' ? reportedEarnings : null
        const repGrowth = rep?.revenueGrowthPct?.value ?? null
        const repRev = rep?.revenue ?? null
        const repEps = rep?.eps ?? null
        const repVerdict = rep?.verdict?.value ?? null
        return (
          <div className="rz-earn-tab">
            <div className="rz-earn-main">
            {rep && (
              <div className={`rz-earn-reported is-${repVerdict || 'neutral'}`}>
                <div className="rz-earn-rep-head">
                  <span className="rz-earn-eyebrow">{t('researchPro.markets.rzmarkets.reported', "Reported")}</span>
                  {repVerdict && (
                    <span className={`rz-earn-rep-verdict is-${repVerdict}`}>
                      {repVerdict === 'beat' ? 'Beat' : repVerdict === 'miss' ? 'Miss' : 'Mixed'}
                    </span>
                  )}
                  <span className="rz-earn-hint">from the wire · vendor figures follow</span>
                </div>
                <div className="rz-earn-rep-grid">
                  {repGrowth != null && (
                    <div className="rz-earn-rep-stat">
                      <span>{t('researchPro.markets.rzmarkets.revenueGrowth', "Revenue growth")}</span>
                      <b className={`mono ${repGrowth >= 0 ? 'up' : 'down'}`}>{repGrowth >= 0 ? '+' : ''}{repGrowth}%</b>
                    </div>
                  )}
                  {repRev?.value != null && (
                    <div className="rz-earn-rep-stat">
                      <span>{t('researchPro.markets.rzmarkets.revenue', "Revenue")}</span>
                      <b className="mono">{fmtLarge(repRev.value)}</b>
                      {repRev.surprisePct != null && (
                        <i className={repRev.surprisePct >= 0 ? 'up' : 'down'}>
                          {repRev.surprisePct >= 0 ? '+' : ''}{repRev.surprisePct}% vs Street
                        </i>
                      )}
                    </div>
                  )}
                  {repEps?.value != null && (
                    <div className="rz-earn-rep-stat">
                      <span>{t('researchPro.markets.rzmarkets.eps', "EPS")}</span>
                      <b className="mono">{Number(repEps.value).toFixed(2)}</b>
                      {repEps.surprisePct != null && (
                        <i className={repEps.surprisePct >= 0 ? 'up' : 'down'}>
                          {repEps.surprisePct >= 0 ? '+' : ''}{repEps.surprisePct}% vs Street
                        </i>
                      )}
                    </div>
                  )}
                </div>
                {/* Provenance is not a footnote here — it is the reason the
                    number is on screen before the vendor has it. */}
                <p className="rz-earn-rep-src">
                  Reported by {(rep.revenueGrowthPct?.attribution || rep.revenue?.attribution || []).join(', ') || `${rep.verdict?.sources || 1} source${(rep.verdict?.sources || 1) > 1 ? 's' : ''}`}
                  {rep.verdict?.sources > 1 ? ` · ${rep.verdict.sources} sources agree` : ''}. Not yet vendor-confirmed.
                </p>
              </div>
            )}
            {hasNext && (
              <div className="rz-earn-next">
                <div className="rz-earn-next-top">
                  <span className="rz-earn-eyebrow">{t('researchPro.markets.rzmarkets.nextEarnings', "Next Earnings")}</span>
                  <span className="rz-earn-date">{nextDateStr}</span>
                  {countLabel && (
                    <span className={`rz-earn-count${days >= 0 && days <= 7 ? ' is-soon' : ''}`}>{countLabel}</span>
                  )}
                </div>
                {(tokenData.earningsAvg != null || tokenData.revenueAvg != null) && (
                  <div className="rz-earn-ests">
                    {tokenData.earningsAvg != null && (
                      <div className="rz-earn-est"><span>{t('researchPro.markets.rzmarkets.estEps', "Est. EPS")}</span><b className="mono">{Number(tokenData.earningsAvg).toFixed(2)}</b></div>
                    )}
                    {tokenData.revenueAvg != null && (
                      <div className="rz-earn-est"><span>{t('researchPro.markets.rzmarkets.estRevenue', "Est. Revenue")}</span><b className="mono">{fmtLarge(tokenData.revenueAvg)}</b></div>
                    )}
                  </div>
                )}
                {awaitingFigures && (
                  <div className="rz-earn-pending">
                    Reported — confirmed figures not published yet. The estimates above are the Street's going in.
                  </div>
                )}
              </div>
            )}
            {rows.length > 0 && (
              <div className="rz-earn-hist">
                <div className="rz-earn-hist-head">
                  <span className="rz-earn-eyebrow">{t('researchPro.markets.rzmarkets.earningsHistory', "Earnings History")}</span>
                  <span className="rz-earn-hint">EPS · estimate vs actual</span>
                </div>
                <table className="rz-earn-tbl">
                  <thead>
                    <tr><th>{t('researchPro.markets.rzmarkets.quarter', "Quarter")}</th><th>{t('researchPro.markets.rzmarkets.est', "Est.")}</th><th>{t('researchPro.markets.rzmarkets.actual', "Actual")}</th><th>{t('researchPro.markets.rzmarkets.surprise', "Surprise")}</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((h, i) => {
                      const est = h.epsEstimate, act = h.epsActual
                      const surprise = (est != null && act != null && Math.abs(est) > 1e-9) ? ((act - est) / Math.abs(est)) * 100 : null
                      const beat = surprise == null ? null : surprise >= 0
                      const q = h.date
                        ? new Date(h.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                        : (h.quarter || '—')
                      return (
                        <tr key={i}>
                          <td className="rz-earn-q">{q}</td>
                          <td className="mono">{est != null ? Number(est).toFixed(2) : '—'}</td>
                          <td className="mono rz-earn-actual">{act != null ? Number(act).toFixed(2) : '—'}</td>
                          <td className={`mono rz-earn-surp ${beat == null ? '' : beat ? 'up' : 'down'}`}>
                            {surprise != null ? `${beat ? '▲' : '▼'} ${surprise >= 0 ? '+' : ''}${surprise.toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            </div>

            <aside className="rz-earn-read">
              <div className="rz-earn-read-head">
                <span className="rz-earn-eyebrow">{t('researchPro.markets.rzmarkets.analysis', "Analysis")}</span>
                <span className="rz-earn-hint">{t('researchPro.markets.rzmarkets.measuredNotForecast', "measured, not forecast")}</span>
              </div>

              {/* When a print has just landed, the result IS the analysis — leading
                  with track-record trivia while the beat sits unmentioned above
                  reads as though the page has not noticed. */}
              {rep && (
                <p className="rz-earn-read-note is-flag">
                  {repVerdict === 'beat' ? 'Beat the Street' : repVerdict === 'miss' ? 'Missed the Street' : 'Reported'}
                  {repGrowth != null ? ` — revenue ${repGrowth >= 0 ? 'up' : 'down'} ${Math.abs(repGrowth)}% on the quarter` : ''}.
                  {' '}Figures are from the wire and not yet vendor-confirmed, so the history table below still shows the last confirmed quarter.
                </p>
              )}
              {read.graded.length > 0 ? (
                <>
                  <div className="rz-earn-read-stat">
                    <span className="rz-earn-read-k">{t('researchPro.markets.rzmarkets.trackRecord', "Track record")}</span>
                    <b className="mono">{read.beats}/{read.graded.length}</b>
                    <span className="rz-earn-read-sub">{t('researchPro.markets.rzmarkets.beatsOnRecord', "beats on record")}</span>
                  </div>
                  <div className="rz-earn-read-stat">
                    <span className="rz-earn-read-k">{t('researchPro.markets.rzmarkets.averageSurprise', "Average surprise")}</span>
                    <b className={`mono ${read.avg >= 0 ? 'up' : 'down'}`}>
                      {read.avg >= 0 ? '+' : ''}{read.avg.toFixed(1)}%
                    </b>
                    <span className="rz-earn-read-sub">{t('researchPro.markets.rzmarkets.vsStreetEps', "vs Street EPS")}</span>
                  </div>
                  {read.spread != null && (
                    <div className="rz-earn-read-stat">
                      <span className="rz-earn-read-k">{t('researchPro.markets.rzmarkets.consistency', "Consistency")}</span>
                      <b className="mono">±{read.spread.toFixed(1)}%</b>
                      <span className="rz-earn-read-sub">
                        {read.spread > 25
                          ? 'the Street models this name loosely — treat the estimate as a weak anchor'
                          : 'the Street models this name tightly'}
                      </span>
                    </div>
                  )}
                  {read.streak >= 3 && (
                    <p className="rz-earn-read-note">
                      {read.streak} straight {read.streakDir ? 'beats' : 'misses'} — the pattern is in the table, not a prediction of the next one.
                    </p>
                  )}
                </>
              ) : (
                <p className="rz-earn-read-note">{read.notes[0]}</p>
              )}

              {days != null && days >= 0 && days <= 7 && (
                <p className="rz-earn-read-note is-flag">
                  Prints {countLabel}. A print is binary gap risk — position size is the only thing you control into it.
                </p>
              )}
              {awaitingFigures && (
                <p className="rz-earn-read-note is-flag">
                  The print has happened; confirmed figures aren't published yet. Nothing here reflects it.
                </p>
              )}
            </aside>
          </div>
        )
        })()
      })()}
      {isStock && marketsSectionTab === 'holders' && (
        <div className="rz-stock-tab-placeholder">
          <span className="rz-stock-tab-placeholder-icon">{icons.sector}</span>
          <span>{t('researchPro.markets.rzmarkets.institutionalHoldersComingS', "Institutional holders coming soon")}</span>
        </div>
      )}
      {isStock && marketsSectionTab === 'historical-data' && (
        <div className="rz-stock-tab-placeholder">
          <span className="rz-stock-tab-placeholder-icon">{icons.sector}</span>
          <span>{t('researchPro.markets.rzmarkets.historicalDataComingSoon', "Historical data coming soon")}</span>
        </div>
      )}

      {/* ── Crypto: Markets table ── */}
      {!isStock && marketsSectionTab === 'markets' && (
          <>
            <div className="research-zone-lite-markets-table-wrap">
              {marketsLoading ? (
                <div className="rz-markets-skeleton-rows">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="rz-markets-skeleton-row">
                      <span className="rz-skeleton" />
                      <span className="rz-skeleton" />
                      <span className="rz-skeleton" />
                      <span className="rz-skeleton" />
                      <span className="rz-skeleton" />
                      <span className="rz-skeleton" />
                    </div>
                  ))}
                </div>
              ) : filteredMarkets.length === 0 ? (
                <div className="rz-markets-empty">
                  <span>No {marketFilter !== 'all' ? marketFilter.toUpperCase() + ' ' : ''}markets found for {symbol}</span>
                  {marketFilter !== 'all' && (
                    <button type="button" className="rz-markets-empty-btn" onClick={() => setMarketFilter('all')}>
                      {t('researchPro.markets.rzmarkets.showAllMarkets', "Show all markets")}
                    </button>
                  )}
                </div>
              ) : (
                <>
                <table className="research-zone-lite-markets-table">
                  <thead>
                    <tr>
                      <th className="rz-th-rank">#</th>
                      <th className="rz-th-exchange">{t('researchLite.exchange')}</th>
                      <th className="rz-th-pair">{t('common.pair')}</th>
                      <th className="rz-th-num rz-th-sortable" onClick={() => handleSort('price')}>{t('common.price')} <SortArrow column="price" sortBy={sortBy} sortDir={sortDir} /></th>
                      {(marketFilter === 'perpetual' || marketFilter === 'futures') ? (
                        <>
                          <th className="rz-th-num">{t('researchPro.markets.rzmarkets.spread', "Spread")}</th>
                          <th className="rz-th-num rz-th-sortable" onClick={() => handleSort('fundingRate')}>{t('researchPro.markets.rzmarkets.fundingRate', "Funding Rate")} <SortArrow column="fundingRate" sortBy={sortBy} sortDir={sortDir} /></th>
                          <th className="rz-th-num rz-th-sortable" onClick={() => handleSort('volume')}>{t('common.volume24h')} <SortArrow column="volume" sortBy={sortBy} sortDir={sortDir} /></th>
                          <th className="rz-th-num rz-th-sortable" onClick={() => handleSort('volumePct')}>{t('researchLite.volumePercent')} <SortArrow column="volumePct" sortBy={sortBy} sortDir={sortDir} /></th>
                          <th className="rz-th-num rz-th-sortable" onClick={() => handleSort('openInterest')}>{t('researchPro.markets.rzmarkets.openInterest', "Open Interest")} <SortArrow column="openInterest" sortBy={sortBy} sortDir={sortDir} /></th>
                        </>
                      ) : (
                        <>
                          <th className="rz-th-depth rz-th-sortable" onClick={() => handleSort('depth')}>{t('researchLite.depth')} <SortArrow column="depth" sortBy={sortBy} sortDir={sortDir} /></th>
                          <th className="rz-th-num rz-th-sortable" onClick={() => handleSort('volume')}>{t('common.volume24h')} <SortArrow column="volume" sortBy={sortBy} sortDir={sortDir} /></th>
                          <th className="rz-th-num rz-th-sortable" onClick={() => handleSort('volumePct')}>{t('researchLite.volumePercent')} <SortArrow column="volumePct" sortBy={sortBy} sortDir={sortDir} /></th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMarkets.slice(marketsPage * MARKETS_PER_PAGE, (marketsPage + 1) * MARKETS_PER_PAGE).map((row, i) => {
                      const globalIdx = marketsPage * MARKETS_PER_PAGE + i
                      return (
                        <tr key={`${row.exchange}-${row.pair}`} className={globalIdx < 3 ? 'rz-top-rank' : ''}>
                          <td className="rz-td-rank">{globalIdx + 1}</td>
                          <td className="rz-td-exchange">
                            {(() => {
                              const iconUrl = getExchangeIcon(row.exchange)
                              return iconUrl
                                ? <img src={iconUrl} alt="" className="rz-exchange-icon" onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling && (e.target.nextElementSibling.style.display = 'inline-flex') }} />
                                : null
                            })()}
                            {!getExchangeIcon(row.exchange) && <span className="rz-exchange-icon-fallback">{(row.exchange || '?').charAt(0)}</span>}
                            {row.exchange}
                            {row.type && <span className={`rz-exchange-type rz-exchange-type--${row.type}`}>{row.type === 'dex' ? 'DEX' : 'CEX'}</span>}
                          </td>
                          <td className="rz-td-pair">
                            {(() => {
                              const { display, hasAddr, full } = formatPair(row.pair)
                              const linkUrl = row.tradeUrl || (EXCHANGE_DOMAINS[row.exchange] ? `https://${EXCHANGE_DOMAINS[row.exchange]}` : null)
                              return (
                                <>
                                  {linkUrl ? (
                                    /* The badge IS the link - a second external-link anchor beside it
                                       pointed at the same URL, which read as noise and widened the
                                       column. The arrow now lives inside the chip. */
                                    <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="rz-pair-badge rz-pair-badge--link" title={hasAddr ? full : `Trade on ${row.exchange}`}>
                                      <span className="rz-pair-badge-text">{display}</span>
                                      <svg className="rz-pair-badge-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                    </a>
                                  ) : (
                                    <span className="rz-pair-badge" title={hasAddr ? full : undefined}>{display}</span>
                                  )}
                                  {!linkUrl && hasAddr && <PairCopyBtn text={full} />}
                                </>
                              )
                            })()}
                          </td>
                          <td className="rz-td-price">{fmtPrice(row.price)}</td>
                          {(marketFilter === 'perpetual' || marketFilter === 'futures') ? (
                            <>
                              <td className="rz-td-num">{row.spread != null ? `${row.spread.toFixed(2)}%` : '-'}</td>
                              <td className="rz-td-num">{row.fundingRate != null ? `${row.fundingRate.toFixed(4)}%` : '-'}</td>
                              <td className="rz-td-num"><span className="rz-vol-chip">{fmtFullUsd(row.volume24h)}</span></td>
                              <td className="rz-td-volpct" style={{ '--vol-pct': `${row.volumePct}` }}>
                                <span className="rz-volpct-bar" />
                                <span className="rz-volpct-text">{row.volumePct}%</span>
                              </td>
                              <td className="rz-td-num">{row.openInterest ? fmtFullUsd(row.openInterest) : '-'}</td>
                            </>
                          ) : (
                            <>
                              <td className="rz-td-depth">
                                {(row.depthPlus2 > 0 || row.depthMinus2 > 0) ? (
                                  <span className="rz-depth-chip">
                                    <span className="rz-depth-buy">{fmtFullUsd(row.depthPlus2)}</span>
                                    <span className="rz-depth-sep">/</span>
                                    <span className="rz-depth-sell">{fmtFullUsd(row.depthMinus2)}</span>
                                  </span>
                                ) : (
                                  <span className="rz-depth-na">-</span>
                                )}
                              </td>
                              <td className="rz-td-num"><span className="rz-vol-chip">{fmtFullUsd(row.volume24h)}</span></td>
                              <td className="rz-td-volpct" style={{ '--vol-pct': `${row.volumePct}` }}>
                                <span className="rz-volpct-bar" />
                                <span className="rz-volpct-text">{row.volumePct}%</span>
                              </td>
                            </>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {/* Pagination footer */}
                {filteredMarkets.length > MARKETS_PER_PAGE && (() => {
                  const totalPages = Math.ceil(filteredMarkets.length / MARKETS_PER_PAGE)
                  const from = marketsPage * MARKETS_PER_PAGE + 1
                  const to = Math.min((marketsPage + 1) * MARKETS_PER_PAGE, filteredMarkets.length)
                  return (
                    <div className="rz-markets-pagination">
                      <span className="rz-markets-page-info">Showing {from} - {to} out of {filteredMarkets.length}</span>
                      <div className="rz-markets-page-controls">
                        <button type="button" className="rz-markets-page-btn" disabled={marketsPage === 0} onClick={() => setMarketsPage(p => p - 1)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </button>
                        {Array.from({ length: totalPages }, (_, i) => i).filter(i => {
                          if (totalPages <= 7) return true
                          if (i === 0 || i === totalPages - 1) return true
                          if (Math.abs(i - marketsPage) <= 1) return true
                          return false
                        }).reduce((acc, i, idx, arr) => {
                          if (idx > 0 && i - arr[idx - 1] > 1) acc.push('...')
                          acc.push(i)
                          return acc
                        }, []).map((item, idx) => (
                          item === '...'
                            ? <span key={`dots-${idx}`} className="rz-markets-page-dots">...</span>
                            : <button key={item} type="button" className={`rz-markets-page-btn${marketsPage === item ? ' rz-markets-page-btn--active' : ''}`} onClick={() => setMarketsPage(item)}>{item + 1}</button>
                        ))}
                        <button type="button" className="rz-markets-page-btn" disabled={marketsPage >= totalPages - 1} onClick={() => setMarketsPage(p => p + 1)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </button>
                      </div>
                    </div>
                  )
                })()}
                </>
              )}
            </div>
          </>
      )}
      {/* ── Crypto: Onchain Trades table ── */}
      {!isStock && marketsSectionTab === 'trades' && isOnchain && (
        <div className="research-zone-lite-markets-table-wrap">
          {tradesLoading ? (
            <div className="rz-markets-skeleton-rows">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rz-markets-skeleton-row">
                  <span className="rz-skeleton" />
                  <span className="rz-skeleton" />
                  <span className="rz-skeleton" />
                  <span className="rz-skeleton" />
                  <span className="rz-skeleton" />
                  <span className="rz-skeleton" />
                </div>
              ))}
            </div>
          ) : trades.length === 0 ? (
            <div className="rz-markets-empty">
              <span>No recent trades found for {symbol}</span>
            </div>
          ) : (
            <table className="research-zone-lite-markets-table rz-trades-table">
              <thead>
                <tr>
                  <th className="rz-th-age">{t('researchPro.markets.rzmarkets.age', "Age")}</th>
                  <th className="rz-th-type">{t('researchPro.markets.rzmarkets.type', "Type")}</th>
                  <th className="rz-th-num">{t('researchPro.markets.rzmarkets.price', "Price")}</th>
                  <th className="rz-th-num">{t('researchPro.markets.rzmarkets.amount', "Amount")}</th>
                  <th className="rz-th-num">{nativeSym}</th>
                  <th className="rz-th-num">USD</th>
                  <th className="rz-th-maker">
                    <span className="rz-th-maker-content">
                      {t('researchPro.markets.rzmarkets.maker', "Maker")}
                      <svg className="rz-th-filter-icon" viewBox="0 0 16 16" fill="currentColor" width="11" height="11">
                        <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z"/>
                      </svg>
                    </span>
                    {makerFilter && (
                      <span className="rz-maker-filter-badge">
                        {`${makerFilter.slice(0, 6)}...${makerFilter.slice(-4)}`}
                        <button type="button" className="rz-maker-filter-badge-close" onClick={() => handleMakerFilter(makerFilter)}>×</button>
                      </span>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.map((trade, i) => {
                  const isBuy = trade.type === 'Buy'
                  const typeClass = isBuy ? 'buy' : 'sell'
                  const usdValue = trade.amountUSD || 0
                  let sizeTier = ''
                  if (usdValue >= 50000) sizeTier = 'whale'
                  else if (usdValue >= 10000) sizeTier = 'large'
                  else if (usdValue >= 1000) sizeTier = 'medium'

                  const timeStr = trade.timestamp ? timeAgo(new Date(trade.timestamp * 1000).toISOString()) : ''
                  const makerShort = trade.maker ? `${trade.maker.slice(0, 6)}...${trade.maker.slice(-4)}` : '-'
                  const txCount = trade.maker ? (makerTxCounts.get(trade.maker) || 0) : 0
                  const barWidth = usdValue > 0 ? Math.min(100, Math.max(4, (usdValue / maxTradeUsd) * 100)) : 0
                  const nativeAmount = trade.amountOther || 0

                  const explorerBase = trade.isSolana
                    ? 'https://solscan.io/tx/'
                    : 'https://etherscan.io/tx/'
                  const addressExplorer = trade.isSolana
                    ? 'https://solscan.io/account/'
                    : 'https://etherscan.io/address/'

                  return (
                    <tr key={trade.txHash || i} className={`rz-trade-row ${typeClass} ${sizeTier}`}>
                      <td className="rz-td-age">{timeStr}</td>
                      <td className="rz-td-type">
                        <span className={`rz-trade-badge rz-trade-badge--${typeClass}`}>
                          {trade.type}
                        </span>
                      </td>
                      <td className="rz-td-price">{fmtPrice(trade.priceUSD)}</td>
                      <td className="rz-td-amount">
                        {trade.amountToken > 1000
                          ? fmtLarge(trade.amountToken)
                          : trade.amountToken?.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                      </td>
                      <td className="rz-td-native">
                        {nativeAmount > 0
                          ? `${nativeAmount.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${nativeSym}`
                          : '-'}
                      </td>
                      <td className="rz-td-usd">
                        <div className="rz-usd-impact">
                          <div
                            className={`rz-impact-bar rz-impact-bar--${typeClass}`}
                            style={{ width: `${barWidth}%` }}
                          />
                          <span className="rz-usd-value">
                            {sizeTier === 'whale' && '🐋 '}
                            {sizeTier === 'large' && '💎 '}
                            {usdValue > 0 ? `$${usdValue.toLocaleString('en-US', { minimumFractionDigits: usdValue < 10 ? 2 : 1, maximumFractionDigits: usdValue < 10 ? 2 : 1 })}` : '-'}
                          </span>
                        </div>
                      </td>
                      <td className="rz-td-maker-cell">
                        <span className={`rz-maker-tx-count ${txCount > 5 ? 'high' : ''}`}>
                          {txCount}
                        </span>
                        <a
                          href={`${addressExplorer}${trade.maker}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rz-maker-address"
                          title={trade.maker}
                        >
                          {makerShort}
                        </a>
                        <button
                          type="button"
                          className="rz-maker-action-btn"
                          title={t('researchPro.markets.rzmarkets.title2', "Copy address")}
                          onClick={(e) => {
                            e.stopPropagation()
                            navigator.clipboard.writeText(trade.maker)
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                        </button>
                        {trade.txHash && (
                          <a
                            href={`${explorerBase}${trade.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rz-maker-action-btn rz-maker-action-btn--explorer"
                            title={t('researchPro.markets.rzmarkets.title3', "View transaction")}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="6"/><path d="M21 21l-4.35-4.35"/></svg>
                          </a>
                        )}
                        <button
                          type="button"
                          className={`rz-maker-action-btn rz-maker-action-btn--filter ${makerFilter === trade.maker ? 'active' : ''}`}
                          title={makerFilter === trade.maker ? 'Clear wallet filter' : 'Filter by this wallet'}
                          onClick={() => handleMakerFilter(trade.maker)}
                        >
                          <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                            <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z"/>
                          </svg>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
})

export default RzMarketsSection
