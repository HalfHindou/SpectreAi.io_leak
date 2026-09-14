/**
 * TokenDiscoveryTable - "The Deal Flow"
 * Bloomberg terminal meets angel investor deal pipeline.
 * Multi-timeframe change columns, liquidity, sticky glass toolbar.
 * 
 * Skills applied: dashboard-patterns, data-viz-2025, modern-ui-designer,
 *                 ios-glass-ui-designer, interaction-physics
 */
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTrendingTokens, useTopCoins, useMostVisited, prefetchTrending } from '../hooks/useCodexData'
import { prefetchTokenPageChunks } from '../utils/prefetch'
import { formatLargeNumber, formatPrice } from '../services/codexApi'
import {
  CATEGORIES, TIMEFRAMES, NETWORKS, NETWORK_LOOKUP, CHAIN_NET_IDS, ALL_TREND_CHAINS,
  TREND_DISPLAY_LIMIT, COIN_SECTORS, resolveNetwork, formatAge, mcapTier, fmtChange,
  fmtCount, getChangeForTimeframe, normalizeForSort, sortTokensByCategory,
} from '../lib/marketFormat'
import { generateSparkline, sparklineToPoints } from '../utils/sparkline'
import { isDev } from '../utils/env'
import { TOKEN_LOGOS, getTokenLogo } from '../data/alphaFeedData'
import InfoTip from './InfoTip'
import './TokenDiscoveryTable.css'

/* =========================================
   Constants
   ========================================= */
function getCategoryTip(catId, chainFilter) {
  const chain = chainFilter === 'all' ? null : NETWORKS.find(n => n.id === chainFilter)
  const scope = chain ? `on ${chain.label}` : 'across all chains'
  switch (catId) {
    case 'trending': return `Tokens with the most activity and interest right now ${scope}.`
    case 'top': return `Blue-chip and large-cap tokens ${scope}. The market leaders.`
    case 'gainers': return `Tokens with the largest price increase in the selected timeframe ${scope}.`
    case 'volume': return `Tokens with the highest trading volume ${scope} - where the most money is moving.`
    case 'new': return `Recently launched tokens ${scope}. Higher risk, higher potential reward.`
    case 'visited': return `Most viewed tokens on the platform ${scope} - what other traders are watching.`
    default: return ''
  }
}

// (MOCK_TOKENS removed 2026-07-23 - a hardcoded 10-token board with invented
// prices and TRUNCATED addresses. It was already unreferenced; deleting it so it
// cannot be revived as an "empty state". See the note in baseTokens below.)


/* =========================================
   MiniSparkline
   ========================================= */
const MiniSparkline = React.memo(function MiniSparkline({ data, positive, width = 72, height = 28 }) {
  const points = sparklineToPoints(data, width, height)
  const color = positive ? 'var(--bull)' : 'var(--bear)'
  const fillColor = positive ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'

  const pointsArr = points.split(' ')
  const firstX = pointsArr[0]?.split(',')[0] || '0'
  const lastX = pointsArr[pointsArr.length - 1]?.split(',')[0] || String(width)
  const fillPoints = `${points} ${lastX},${height} ${firstX},${height}`

  return (
    <svg width={width} height={height} className="mini-sparkline" viewBox={`0 0 ${width} ${height}`}>
      <polygon points={fillPoints} fill={fillColor} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
})


/* =========================================
   NetworkBadge
   ========================================= */
function NetworkBadge({ network }) {
  const net = resolveNetwork(network)
  if (!net) return null
  return (
    <span className="chain-badge">
      <span className="chain-dot" style={{ background: net.color }} />
      {net.abbrev}
    </span>
  )
}


/* =========================================
   ChainFilter (horizontal pills, not dropdown)
   ========================================= */
function ChainFilter({ value, onChange, onHoverChain }) {
  return (
    <div className="chain-filter" role="radiogroup" aria-label="Filter by blockchain">
      {NETWORKS.map(net => (
        <button
          key={net.id}
          className={`chain-pill${value === net.id ? ' active' : ''}`}
          onClick={() => onChange(net.id)}
          onMouseEnter={() => onHoverChain?.(net.id)}
          role="radio"
          aria-checked={value === net.id}
        >
          {net.color && <span className="chain-dot" style={{ background: net.color }} />}
          {net.id === 'all' ? 'All' : net.abbrev}
        </button>
      ))}
    </div>
  )
}


/* =========================================
   SectorFilter (horizontal pills for Top Coins)
   ========================================= */
function SectorFilter({ value, onChange }) {
  return (
    <div className="chain-filter" role="radiogroup" aria-label="Filter by sector">
      {COIN_SECTORS.map(sec => (
        <button
          key={sec.id}
          className={`chain-pill${value === sec.id ? ' active' : ''}`}
          onClick={() => onChange(sec.id)}
          role="radio"
          aria-checked={value === sec.id}
        >
          {sec.color && <span className="chain-dot" style={{ background: sec.color }} />}
          {sec.label}
        </button>
      ))}
    </div>
  )
}


/* =========================================
   ChangeCell - colored percentage
   ========================================= */
function ChangeCell({ value }) {
  const { text, cls } = fmtChange(value)
  return <span className={`change-cell ${cls}`}>{text}</span>
}


/* =========================================
   TxnsCell - 24h txn count + buy/sell pressure bar
   ========================================= */
function TxnsCell({ token }) {
  const txns = token.txnCount24
  const buys = token.buys24
  const sells = token.sells24
  // Buy share for the pressure bar - only when both sides are present.
  const total = (buys != null && sells != null) ? (buys + sells) : 0
  const buyPct = total > 0 ? (buys / total) * 100 : null

  return (
    <span className="tdt-txns">
      <span className="tdt-txns-count">{fmtCount(txns)}</span>
      {buyPct != null && (
        <span
          className="tdt-txns-bar"
          title={`${fmtCount(buys)} buys / ${fmtCount(sells)} sells`}
        >
          <span className="tdt-txns-bar-buy" style={{ width: `${buyPct}%` }} />
        </span>
      )}
    </span>
  )
}


/* =========================================
   TokenRow (list view)
   ========================================= */
const TokenRow = React.memo(function TokenRow({
  token, rank, onClick, compareMode, isSelected, onToggleCompare, animDelay, isTopCoins, mcapBands,
}) {
  const isPositive = (token.change24h ?? token.change) >= 0
  const sparkData = useMemo(() => generateSparkline(token.change24h ?? token.change), [token.change24h, token.change])
  const logoUrl = token.logo || getTokenLogo(token.symbol)

  return (
    <div
      className={`tdt-row${isSelected ? ' is-selected' : ''}`}
      onClick={compareMode ? () => onToggleCompare(token) : () => onClick(token)}
      onMouseEnter={prefetchTokenPageChunks}
      style={{ animationDelay: `${animDelay}ms` }}
    >
      {compareMode && (
        <label className="tdt-checkbox" onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={isSelected} onChange={() => onToggleCompare(token)} />
          <span className="tdt-check-mark" />
        </label>
      )}

      {/* Rank - hidden when checkbox overlays it */}
      <span className="tdt-rank" style={compareMode ? { visibility: 'hidden' } : undefined}>{rank}</span>

      {/* Project - logo + symbol + name + chain */}
      <div className="tdt-project">
        {logoUrl ? (
          <img
            className="tdt-logo"
            src={logoUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
          />
        ) : null}
        <span className="tdt-logo-fallback" style={logoUrl ? { display: 'none' } : {}}>
          {token.symbol?.charAt(0) || '?'}
        </span>
        <div className="tdt-project-text">
          <span className="tdt-symbol">{token.symbol}</span>
          <span className="tdt-name">{token.name}</span>
        </div>
        <NetworkBadge network={token.network} />
      </div>

      {/* Price */}
      <span className="tdt-price">{formatPrice(token.price)}</span>

      {/* Market Cap - after price, colored by size-rank tier within the list */}
      <span className={`tdt-mcap tdt-mcap--${mcapTier(token.marketCap, mcapBands)}`}>{formatLargeNumber(token.marketCap)}</span>

      {/* Multi-timeframe change columns */}
      {!isTopCoins && <ChangeCell value={token.change5m} />}
      <ChangeCell value={token.change1h} />
      {!isTopCoins && <ChangeCell value={token.change6h} />}
      <ChangeCell value={token.change24h ?? token.change} />
      {isTopCoins && <ChangeCell value={token.change7d} />}

      {/* Volume */}
      <span className="tdt-volume">{formatLargeNumber(token.volume24h || token.volume)}</span>

      {/* TXNS - 24h txn count + buy/sell pressure bar (DexScreener-enriched) */}
      {!isTopCoins && <TxnsCell token={token} />}

      {/* Liquidity */}
      {!isTopCoins && <span className="tdt-liquidity">{token.liquidity > 0 ? formatLargeNumber(token.liquidity) : '-'}</span>}

      {/* Age */}
      {!isTopCoins && <span className="tdt-age">{formatAge(token.createdAt)}</span>}

      {/* Sparkline */}
      <div className="tdt-sparkline">
        <MiniSparkline data={sparkData} positive={isPositive} />
      </div>
    </div>
  )
})


/* =========================================
   TokenCard (grid view)
   ========================================= */
const TokenCard = React.memo(function TokenCard({
  token, rank, onClick, compareMode, isSelected, onToggleCompare, animDelay, isTopCoins,
}) {
  const isPositive = (token.change24h ?? token.change) >= 0
  const sparkData = useMemo(() => generateSparkline(token.change24h ?? token.change, 20), [token.change24h, token.change])
  const logoUrl = token.logo || getTokenLogo(token.symbol)
  const { text: changeText, cls: changeCls } = fmtChange(token.change24h ?? token.change)

  return (
    <div
      className={`tdt-card${isSelected ? ' is-selected' : ''}`}
      onClick={compareMode ? () => onToggleCompare(token) : () => onClick(token)}
      style={{ animationDelay: `${animDelay}ms` }}
    >
      {/* Header */}
      <div className="tdt-card-head">
        <div className="tdt-card-rank-area">
          {compareMode && (
            <label className="tdt-checkbox tdt-checkbox--card" onClick={e => e.stopPropagation()}>
              <input type="checkbox" checked={isSelected} onChange={() => onToggleCompare(token)} />
              <span className="tdt-check-mark" />
            </label>
          )}
          <span className="tdt-card-rank">#{rank}</span>
          {!isTopCoins && (
            <div className="tdt-card-identity">
              {logoUrl ? (
                <img
                  className="tdt-logo"
                  src={logoUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
                />
              ) : null}
              <span className="tdt-logo-fallback" style={logoUrl ? { display: 'none' } : {}}>
                {token.symbol?.charAt(0) || '?'}
              </span>
              <div className="tdt-card-names">
                <span className="tdt-symbol">{token.symbol}</span>
                <span className="tdt-name">{token.name}</span>
              </div>
            </div>
          )}
        </div>
        {isTopCoins && (
          <div className="tdt-card-identity">
            {logoUrl ? (
              <img
                className="tdt-logo"
                src={logoUrl}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
              />
            ) : null}
            <span className="tdt-logo-fallback" style={logoUrl ? { display: 'none' } : {}}>
              {token.symbol?.charAt(0) || '?'}
            </span>
            <div className="tdt-card-names">
              <span className="tdt-symbol">{token.symbol}</span>
              <span className="tdt-name">{token.name}</span>
            </div>
          </div>
        )}
        <NetworkBadge network={token.network} />
      </div>

      {/* Price + Change */}
      <div className="tdt-card-price">
        <span className="tdt-price">{formatPrice(token.price)}</span>
        <span className={`change-cell ${changeCls}`}>{changeText}</span>
      </div>

      {/* Sparkline */}
      <div className="tdt-card-chart">
        <MiniSparkline data={sparkData} positive={isPositive} width={260} height={48} />
      </div>

      {/* Stats footer */}
      <div className="tdt-card-stats">
        <div className="tdt-card-stat">
          <span className="tdt-card-stat-label">Vol</span>
          <span className="tdt-card-stat-value">{formatLargeNumber(token.volume24h || token.volume)}</span>
        </div>
        {!isTopCoins && token.txnCount24 != null && (
          <div className="tdt-card-stat">
            <span className="tdt-card-stat-label">Txns</span>
            <span className="tdt-card-stat-value">{fmtCount(token.txnCount24)}</span>
          </div>
        )}
        {!isTopCoins && (
          <div className="tdt-card-stat">
            <span className="tdt-card-stat-label">Liq</span>
            <span className="tdt-card-stat-value">{token.liquidity > 0 ? formatLargeNumber(token.liquidity) : '-'}</span>
          </div>
        )}
        <div className="tdt-card-stat">
          <span className="tdt-card-stat-label">MCap</span>
          <span className="tdt-card-stat-value">{formatLargeNumber(token.marketCap)}</span>
        </div>
      </div>
    </div>
  )
})


/* =========================================
   Main: TokenDiscoveryTable
   ========================================= */
export default function TokenDiscoveryTable({
  selectToken,
  compareMode,
  compareTokens,
  onToggleCompare,
  onExitCompare,
}) {
  const [activeCategory, setActiveCategory] = useState('trending')
  const [chainFilter, setChainFilter] = useState('all')
  const [activeTimeframe, setActiveTimeframe] = useState('24h')
  const [viewMode, setViewMode] = useState('list')
  const [localCompareMode, setLocalCompareMode] = useState(false)

  // Column header sorting (works across all tabs)
  const [colSortKey, setColSortKey] = useState(null)  // null = default tab order
  const [colSortDir, setColSortDir] = useState('desc')

  // Top Coins sector filter
  const [topSectorFilter, setTopSectorFilter] = useState('all')

  const effectiveCompareMode = compareMode || localCompareMode

  // Fetch live data for the SELECTED chain (so every chain chip returns real
  // data instead of client-filtering a Solana-dominated global list to empty).
  // Pass timeframe so the API ranks tokens by the selected period.
  const trendingNetworkIds = CHAIN_NET_IDS[chainFilter] || ALL_TREND_CHAINS
  const { tokens: apiTokens, loading } = useTrendingTokens(60000, trendingNetworkIds, activeTimeframe)

  // Fetch top coins via Spectre trending API - only while the "Top" tab is
  // actually open. This used to fire unconditionally on mount, adding a wasted
  // request in parallel with the trending fetch on the default tab's first paint.
  const { tokens: topCoinsData, loading: topCoinsLoading } = useTopCoins(50, 60000, '', { enabled: activeCategory === 'top' })

  // Real "Most Visited" - actual Trading Platform token-page visits, server-ranked
  // by 24h view count (recorded via recordTokenView). Only fetched/polled while
  // the Most Visited tab is open. On the "All" filter pass NO chains (= every
  // chain) so a viewed BASE/ARB/etc token shows up too - the trending "All" set
  // is only ETH/BSC/SOL, too narrow for a personal visit history.
  const visitedNetworkIds = chainFilter === 'all' ? [] : trendingNetworkIds
  const { tokens: visitedTokens, loading: visitedLoading } = useMostVisited(
    visitedNetworkIds,
    activeCategory === 'visited' ? 60000 : 0,
    TREND_DISPLAY_LIMIT,
    activeTimeframe,
  )

  // Prefetch every chain's board in the background so switching chains is
  // INSTANT. The slow part is the server's cold compute + DexScreener enrich
  // (~4-5s); warming it here (off the click path) means a switch hits the shared
  // cache. Idle-gated + staggered to avoid a request burst; re-runs on timeframe
  // change (the cache key includes it). prefetchTrending no-ops on already-warm
  // / in-flight chains, so this is cheap on re-runs.
  useEffect(() => {
    if (activeCategory === 'top') return
    let cancelled = false
    const idle = (cb) => (typeof window !== 'undefined' && window.requestIdleCallback)
      ? window.requestIdleCallback(cb, { timeout: 1800 })
      : setTimeout(cb, 700)
    const handle = idle(async () => {
      // Warm chains ONE AT A TIME (gentle on the server + DexScreener) so a switch
      // lands on a warm cache. Hover-prefetch jumps the queue on demand.
      for (const ids of Object.values(CHAIN_NET_IDS)) {
        if (cancelled) break
        // background:true - skip chains a recent successful fetch found empty.
        // Measured cold (prod, 2026-08-04): ARB/AVAX/OP/HOOD returned 0 rows
        // for ~6.2s of combined upstream work, re-paid on every load because
        // an empty board was never cached. Hover/click prefetch is user intent
        // and still fetches those chains on demand.
        try { await prefetchTrending(ids, activeTimeframe, { background: true }) } catch { /* best-effort */ }
      }
    })
    return () => {
      cancelled = true
      if (typeof window !== 'undefined' && window.cancelIdleCallback && typeof handle === 'number') window.cancelIdleCallback(handle)
    }
  }, [activeTimeframe, activeCategory])

  const baseTokens = useMemo(() => {
    if (!apiTokens || apiTokens.length === 0) {
      // 2026-05-26 beta-quality fix: don't fall back to placeholder tokens on API
      // empty/error — render empty (the page-level empty state handles UX).
      return []
    }
    // Trust the server. The /api/tokens/trending engine already excludes
    // stablecoins / wrapped / LST / base-coin / tokenized stocks / majors,
    // quality-gates (liquidity + recent activity + momentum), dedupes copycats
    // by symbol+name+chain (keeping DISTINCT same-symbol projects like the three
    // "SPCX" launches), and orders by trendScore. The old client filter dropped
    // every sub-$100k-mcap token (i.e. exactly the fresh degens this table is for)
    // and the symbol-only dedup collapsed distinct projects + re-biased to volume.
    return apiTokens
  }, [apiTokens])

  // Most Visited source: ONLY real platform visits (server view-ranked order).
  // No trending padding - an honest leaderboard. When empty/sparse the table
  // renders a "no visits yet" empty state rather than borrowing trending rows.
  const visitedBase = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const t of (visitedTokens || [])) {
      const k = (t.address || '').toLowerCase()
      if (k && !seen.has(k)) { seen.add(k); out.push(t) }
    }
    return out
  }, [visitedTokens])

  // Toggle column sort - works for all tabs
  const handleColSort = useCallback((key) => {
    if (colSortKey === key) {
      setColSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setColSortKey(key)
      setColSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }, [colSortKey])

  // Shared column sort helper (normalizeForSort imported from lib/marketFormat)
  const applyColSort = useCallback((tokens) => {
    if (!colSortKey) return tokens
    const dir = colSortDir === 'asc' ? 1 : -1
    return [...tokens].sort((a, b) => {
      if (colSortKey === 'name') {
        return dir * (a.name || '').localeCompare(b.name || '')
      }
      const av = normalizeForSort(a[colSortKey], colSortKey)
      const bv = normalizeForSort(b[colSortKey], colSortKey)
      return dir * (av - bv)
    })
  }, [colSortKey, colSortDir])

  // Filter + sort
  const filteredTokens = useMemo(() => {
    // Top Coins uses its own data source
    if (activeCategory === 'top') {
      return applyColSort(topCoinsData || [])
    }

    // Most Visited draws from real platform visits (padded w/ trending); every
    // other tab draws from the trending board.
    const source = activeCategory === 'visited' ? visitedBase : baseTokens
    let tokens = [...source].filter(t => t.symbol?.trim() && t.name?.trim())

    // Chain filter
    if (chainFilter !== 'all') {
      const net = NETWORK_LOOKUP[chainFilter]
      if (net) {
        tokens = tokens.filter(t => {
          const raw = (t.network || '').toLowerCase()
          return raw === net.label.toLowerCase() ||
                 raw === (net.abbrev || '').toLowerCase() ||
                 raw === net.id
        })
      }
    }

    // Category sort/filter - only if no column sort is active. Shared with the
    // token-page rail (TokenScreener) via sortTokensByCategory so both surfaces
    // order identically. Exactly 30 per chain/tab (server fills toward 30).
    if (!colSortKey) {
      return sortTokensByCategory(tokens, activeCategory, activeTimeframe).slice(0, TREND_DISPLAY_LIMIT)
    }

    return applyColSort(tokens).slice(0, TREND_DISPLAY_LIMIT)
  }, [baseTokens, visitedBase, topCoinsData, chainFilter, activeCategory, activeTimeframe, applyColSort, colSortKey])

  // MCap colour bands = the 33rd / 66th percentile mcap of the currently-shown
  // list, so the three colours split the list into even thirds by SIZE RANK
  // (robust to a few mega-cap outliers that would skew an average). Adapts per
  // chain/tab. Falls back to null (everything blue) for very short lists.
  const mcapBands = useMemo(() => {
    const caps = filteredTokens.map(t => Number(t.marketCap) || 0).filter(m => m > 0).sort((a, b) => a - b)
    if (caps.length < 4) return null
    const at = (p) => caps[Math.min(caps.length - 1, Math.floor((caps.length - 1) * p))]
    return { p33: at(1 / 3), p66: at(2 / 3) }
  }, [filteredTokens])

  // Per-tab loading flag + empty message. Most Visited has its own loading
  // (useMostVisited) and an honest "no visits yet" empty state - it does NOT
  // borrow trending rows, so before any token is opened it shows the empty hint.
  const tableLoading = activeCategory === 'top'
    ? topCoinsLoading
    : activeCategory === 'visited'
      ? visitedLoading
      : loading
  const emptyMessage = activeCategory === 'visited'
    ? 'No visits tracked yet. Open any token and it shows up here.'
    : 'No tokens match this filter.'

  const handleSelect = useCallback(token => {
    if (selectToken) selectToken(token)
  }, [selectToken])

  /* ── Share on X ── */
  const [isCapturing, setIsCapturing] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [shareImageUrl, setShareImageUrl] = useState(null)
  const [shareDescription, setShareDescription] = useState('')
  const [imageCopied, setImageCopied] = useState(false)
  const [postedToX, setPostedToX] = useState(false)
  const shareLogoDarkBgRef = useRef(null)  // Silver text - for dark backgrounds
  const shareLogoLightBgRef = useRef(null) // Dark text - for light backgrounds

  // Pre-load Spectre logos for the share card. Deferred to idle: the share
  // card lives behind a button, so these must not compete with the board's own
  // first paint. They still land long before anyone can click Share, and
  // renderShareCard already falls back to a text logo if a ref is still null.
  useEffect(() => {
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 1500))
    const handle = idle(() => {
      const dark = new Image()
      dark.src = '/Spectre Logo Light.png'
      dark.onload = () => { shareLogoDarkBgRef.current = dark }
      const light = new Image()
      light.src = '/Spectre Logo Dark.png'
      light.onload = () => { shareLogoLightBgRef.current = light }
    }, { timeout: 4000 })
    return () => {
      if (window.cancelIdleCallback && typeof handle === 'number') window.cancelIdleCallback(handle)
    }
  }, [])

  const categoryLabel = CATEGORIES.find(c => c.id === activeCategory)?.label || 'Trending'
  const chainLabel = chainFilter === 'all' ? 'All Chains' : (NETWORKS.find(n => n.id === chainFilter)?.label || chainFilter)
  const shareTokens = filteredTokens.slice(0, 10)

  // Open modal instantly, capture card behind opaque overlay, then show preview
  // Canvas 2D renderer - draws the branded share card directly (no html2canvas)
  const renderShareCard = useCallback((tokens, catLabel, chLabel, timeframe, logoMap = {}, mode = 'list', isTopCoins = false) => {
    // 4K retina: 4x scale for ultra-crisp output
    const scale = 4
    const W = 640, pad = 36, cornerR = 0
    const headerH = 88, accentY = headerH + 12
    const footerH = 78

    // Font stacks matching the actual UI
    const fBody = "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif"
    const fDisplay = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif"
    const fMono = "var(--font-mono), var(--font-mono), 'Monaco', monospace"

    // Raw change value getter - no normalization, matches what ChangeCell receives.
    // fmtChange handles the ×100 normalization itself; getChangeForTimeframe also
    // normalizes, so using it here would cause double-multiplication (100x inflation).
    const rawChangeFor = (token, tf) => {
      switch (tf) {
        case '5m': return token.change5m
        case '1h': return token.change1h
        case '6h': return token.change6h
        case '7d': return token.change7d
        default: return token.change24h ?? token.change
      }
    }

    // Grid mode: 2 columns of cards
    const isGrid = mode === 'grid'
    const gridCols = 2, cardGap = 14, cardPad = 16
    const cardW = (W - pad * 2 - cardGap) / gridCols
    const cardH = isTopCoins ? 118 : 130
    const gridRows = Math.ceil(tokens.length / gridCols)

    const rowH = 44
    const theadY = accentY + 22, theadH = 30
    const tableTop = theadY + theadH
    const bodyH = isGrid
      ? gridRows * (cardH + cardGap) - cardGap + 24
      : theadH + tokens.length * rowH
    const H = pad + headerH + 16 + bodyH + footerH + pad

    // Detect light mode
    const isLight = document.body.classList.contains('theme-light')

    // Theme palette - Apple cinematic minimalism
    const c = isLight ? {
      bg: '#f5f5f7',
      bgSub: '#efeff1',
      glow1: 'rgba(0,0,0,0.018)',
      glow2: 'rgba(120,120,128,0.04)',
      edgeHL: 'rgba(0,0,0,0.06)',
      logoFallback: '#1d1d1f',
      tagline: 'rgba(0,0,0,0.32)',
      tfBadgeBg: 'rgba(0,0,0,0.05)',
      tfBadgeText: '#48484a',
      catBadgeBg: '#1d1d1f',
      catBadgeText: '#ffffff',
      chain: 'rgba(0,0,0,0.38)',
      accentLow: 'rgba(0,0,0,0.035)',
      accentHigh: 'rgba(0,0,0,0.09)',
      thColor: 'rgba(0,0,0,0.32)',
      rowAlt: 'rgba(0,0,0,0.022)',
      rowHover: 'rgba(0,0,0,0.04)',
      rank: 'rgba(0,0,0,0.22)',
      fallbackBg: 'rgba(0,0,0,0.05)',
      fallbackText: 'rgba(0,0,0,0.4)',
      symbol: '#1d1d1f',
      name: 'rgba(0,0,0,0.42)',
      price: '#1d1d1f',
      bull: '#059669',
      bear: '#dc2626',
      neutral: 'rgba(0,0,0,0.25)',
      muted: 'rgba(0,0,0,0.38)',
      footSepLow: 'rgba(0,0,0,0.025)',
      footSepHigh: 'rgba(0,0,0,0.07)',
      url: '#1d1d1f',
      date: 'rgba(0,0,0,0.3)',
      handle: 'rgba(0,0,0,0.22)',
      copy: 'rgba(0,0,0,0.15)',
      border: 'rgba(0,0,0,0.08)',
      cardBorder: 'rgba(0,0,0,0.06)',
      cardBg: 'rgba(0,0,0,0.02)',
    } : {
      bg: '#09090b',
      bgSub: '#0f0f12',
      glow1: 'rgba(255,255,255,0.012)',
      glow2: 'rgba(200,200,220,0.025)',
      edgeHL: 'rgba(255,255,255,0.05)',
      logoFallback: '#f5f5f7',
      tagline: 'rgba(255,255,255,0.28)',
      tfBadgeBg: 'rgba(255,255,255,0.06)',
      tfBadgeText: 'rgba(255,255,255,0.48)',
      catBadgeBg: '#f5f5f7',
      catBadgeText: '#09090b',
      chain: 'rgba(255,255,255,0.32)',
      accentLow: 'rgba(255,255,255,0.03)',
      accentHigh: 'rgba(255,255,255,0.08)',
      thColor: 'rgba(255,255,255,0.28)',
      rowAlt: 'rgba(255,255,255,0.018)',
      rowHover: 'rgba(255,255,255,0.04)',
      rank: 'rgba(255,255,255,0.22)',
      fallbackBg: 'rgba(255,255,255,0.05)',
      fallbackText: 'rgba(255,255,255,0.4)',
      symbol: '#f5f5f7',
      name: 'rgba(255,255,255,0.4)',
      price: 'rgba(255,255,255,0.82)',
      bull: '#34d399',
      bear: '#f87171',
      neutral: 'rgba(255,255,255,0.25)',
      muted: 'rgba(255,255,255,0.38)',
      footSepLow: 'rgba(255,255,255,0.025)',
      footSepHigh: 'rgba(255,255,255,0.07)',
      url: '#f5f5f7',
      date: 'rgba(255,255,255,0.28)',
      handle: 'rgba(255,255,255,0.18)',
      copy: 'rgba(255,255,255,0.12)',
      border: 'rgba(255,255,255,0.06)',
      cardBorder: 'rgba(255,255,255,0.05)',
      cardBg: 'rgba(255,255,255,0.02)',
    }

    const canvas = document.createElement('canvas')
    canvas.width = W * scale
    canvas.height = H * scale
    const ctx = canvas.getContext('2d')
    ctx.scale(scale, scale)

    // Rounded corners clip
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(0, 0, W, H, cornerR)
    ctx.clip()

    // Background
    ctx.fillStyle = c.bg
    ctx.fillRect(0, 0, W, H)

    // Cinematic ambient glow - dual radial for depth
    const glow1 = ctx.createRadialGradient(pad + 60, pad + 20, 0, pad + 60, pad + 20, 220)
    glow1.addColorStop(0, c.glow2)
    glow1.addColorStop(1, 'transparent')
    ctx.fillStyle = glow1
    ctx.fillRect(0, 0, W, headerH + pad + 12)

    const glow2 = ctx.createRadialGradient(W - 120, pad + 30, 0, W - 120, pad + 30, 160)
    glow2.addColorStop(0, c.glow1)
    glow2.addColorStop(1, 'transparent')
    ctx.fillStyle = glow2
    ctx.fillRect(0, 0, W, headerH + pad + 12)

    // Top edge highlight - cinematic film-grain shimmer
    const topEdge = ctx.createLinearGradient(0, 0, W, 0)
    topEdge.addColorStop(0, 'transparent')
    topEdge.addColorStop(0.15, c.edgeHL)
    topEdge.addColorStop(0.5, isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)')
    topEdge.addColorStop(0.85, c.edgeHL)
    topEdge.addColorStop(1, 'transparent')
    ctx.fillStyle = topEdge
    ctx.fillRect(0, 0, W, 1)

    // -- Header: Spectre AI logo --
    const logo = isLight ? shareLogoLightBgRef.current : shareLogoDarkBgRef.current
    if (logo) {
      const logoH = 34
      const logoW = (logo.naturalWidth / logo.naturalHeight) * logoH
      ctx.drawImage(logo, pad, pad + 4, logoW, logoH)
      if (!isLight) {
        const ix = pad, iy = pad + 4, iS = logoH, cr = 8
        ctx.fillStyle = c.bg
        ctx.fillRect(ix, iy, cr, cr)
        ctx.fillRect(ix + iS - cr, iy, cr, cr)
        ctx.fillRect(ix, iy + iS - cr, cr, cr)
        ctx.fillRect(ix + iS - cr, iy + iS - cr, cr, cr)
        ctx.save()
        ctx.beginPath(); ctx.roundRect(ix, iy, iS, iS, 7); ctx.clip()
        ctx.drawImage(logo, pad, pad + 4, logoW, logoH)
        ctx.restore()
      }
    } else {
      ctx.fillStyle = c.logoFallback
      ctx.font = `700 20px ${fDisplay}`
      ctx.fillText('Spectre AI', pad, pad + 28)
    }

    // Tagline
    ctx.fillStyle = c.tagline
    ctx.font = `400 11px ${fBody}`
    ctx.fillText('DeFi Discovery Terminal', pad, pad + 56)

    // Timeframe badge (right-aligned, top row)
    const tfText = timeframe.toUpperCase()
    ctx.font = `600 10px ${fBody}`
    const tfW = ctx.measureText(tfText).width + 20
    const tfX = W - pad - tfW
    ctx.fillStyle = c.tfBadgeBg
    ctx.beginPath(); ctx.roundRect(tfX, pad + 8, tfW, 22, 6); ctx.fill()
    ctx.fillStyle = c.tfBadgeText
    ctx.fillText(tfText, tfX + 10, pad + 23)

    // Category badge
    const catText = catLabel.toUpperCase()
    ctx.font = `600 10px ${fBody}`
    const catW = ctx.measureText(catText).width + 20
    const catX = tfX - catW - 8
    ctx.fillStyle = c.catBadgeBg
    ctx.beginPath(); ctx.roundRect(catX, pad + 8, catW, 22, 6); ctx.fill()
    ctx.fillStyle = c.catBadgeText
    ctx.fillText(catText, catX + 10, pad + 23)

    // Chain label
    ctx.font = `400 10.5px ${fBody}`
    ctx.fillStyle = c.chain
    const chainText = chLabel || 'All Chains'
    const chainTW = ctx.measureText(chainText).width
    ctx.fillText(chainText, W - pad - chainTW, pad + 54)

    // -- Accent line --
    const grad = ctx.createLinearGradient(0, 0, W, 0)
    grad.addColorStop(0, 'transparent')
    grad.addColorStop(0.08, c.accentLow)
    grad.addColorStop(0.5, c.accentHigh)
    grad.addColorStop(0.92, c.accentLow)
    grad.addColorStop(1, 'transparent')
    ctx.fillStyle = grad
    ctx.fillRect(pad, accentY, W - pad * 2, 1)

    // -- Shared text helper --
    const drawText = (text, col, y, font, color) => {
      ctx.font = font
      ctx.fillStyle = color
      const tw = ctx.measureText(text).width
      let tx = col.x
      if (col.align === 'right') tx = col.x + col.w - tw
      else if (col.align === 'center') tx = col.x + (col.w - tw) / 2
      ctx.fillText(text, tx, y)
    }

    if (isGrid) {
      // ── Grid layout: 2-column cards ──
      const gridTop = accentY + 22
      tokens.forEach((token, i) => {
        const col = i % gridCols
        const row = Math.floor(i / gridCols)
        const cx = pad + col * (cardW + cardGap)
        const cy = gridTop + row * (cardH + cardGap)

        // Card bg with subtle gradient
        const cardBgGrad = ctx.createLinearGradient(cx, cy, cx + cardW, cy + cardH)
        cardBgGrad.addColorStop(0, c.cardBg)
        cardBgGrad.addColorStop(1, 'transparent')
        ctx.fillStyle = cardBgGrad
        ctx.beginPath(); ctx.roundRect(cx, cy, cardW, cardH, 12); ctx.fill()
        // Card border
        ctx.strokeStyle = c.cardBorder
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.roundRect(cx + 0.5, cy + 0.5, cardW - 1, cardH - 1, 12); ctx.stroke()

        // Rank
        ctx.fillStyle = c.rank
        ctx.font = `500 11px ${fMono}`
        ctx.fillText(`#${i + 1}`, cx + cardPad, cy + 22)

        // Logo
        const lx = cx + cardPad + 30, ly = cy + 8, ls = 26
        const tokenLogo = logoMap[token.symbol]
        if (tokenLogo) {
          ctx.save()
          ctx.beginPath(); ctx.roundRect(lx, ly, ls, ls, 7); ctx.clip()
          ctx.drawImage(tokenLogo, lx, ly, ls, ls)
          ctx.restore()
        } else {
          ctx.fillStyle = c.fallbackBg
          ctx.beginPath(); ctx.roundRect(lx, ly, ls, ls, 7); ctx.fill()
          ctx.fillStyle = c.fallbackText
          ctx.font = `700 11px ${fBody}`
          const ini = (token.symbol || '?').charAt(0)
          ctx.fillText(ini, lx + ls / 2 - ctx.measureText(ini).width / 2, ly + 18)
        }

        // Symbol + name
        const nx = lx + ls + 10
        ctx.fillStyle = c.symbol
        ctx.font = `600 13px ${fBody}`
        ctx.fillText(token.symbol || '', nx, cy + 20)
        ctx.fillStyle = c.name
        ctx.font = `400 10px ${fBody}`
        const nameStr = (token.name || '').length > 14 ? (token.name || '').slice(0, 13) + '\u2026' : (token.name || '')
        ctx.fillText(nameStr, nx, cy + 33)

        // Price
        ctx.fillStyle = c.price
        ctx.font = `500 13px ${fMono}`
        ctx.fillText(formatPrice(token.price), cx + cardPad, cy + 58)

        // Change (use raw value - fmtChange handles normalization)
        // For Top Coins, fall back through available timeframes if selected one is null
        let change = rawChangeFor(token, timeframe)
        if (isTopCoins && (change == null || change === 0)) {
          change = token.change24h ?? token.change1h ?? token.change7d ?? null
        }
        if (change != null) {
          const { text: changeText, cls: changeCls } = fmtChange(change)
          const chColor = changeCls === 'bull' ? c.bull : changeCls === 'bear' ? c.bear : c.neutral
          ctx.fillStyle = chColor
          ctx.font = `600 13px ${fMono}`
          const chTW = ctx.measureText(changeText).width
          ctx.fillText(changeText, cx + cardW - cardPad - chTW, cy + 58)
        }

        // Volume/Sparkline + MCap
        if (isTopCoins && token.sparkline && token.sparkline.length > 2) {
          // Mini sparkline chart for Top Coins
          const spkData = token.sparkline
          const spkX = cx + cardPad, spkY = cy + 66, spkW = cardW * 0.48, spkH = 22
          const spkMin = Math.min(...spkData), spkMax = Math.max(...spkData)
          const spkRange = spkMax - spkMin || 1
          const spkIsUp = spkData[spkData.length - 1] >= spkData[0]
          const spkColor = spkIsUp ? c.bull : c.bear

          ctx.save()
          ctx.beginPath()
          for (let si = 0; si < spkData.length; si++) {
            const sx = spkX + (si / (spkData.length - 1)) * spkW
            const sy = spkY + spkH - ((spkData[si] - spkMin) / spkRange) * spkH
            si === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy)
          }
          ctx.strokeStyle = spkColor
          ctx.lineWidth = 1.5
          ctx.lineJoin = 'round'
          ctx.lineCap = 'round'
          ctx.stroke()

          // Fill under the line
          ctx.lineTo(spkX + spkW, spkY + spkH)
          ctx.lineTo(spkX, spkY + spkH)
          ctx.closePath()
          const spkGrad = ctx.createLinearGradient(0, spkY, 0, spkY + spkH)
          spkGrad.addColorStop(0, spkIsUp ? (isLight ? 'rgba(5,150,105,0.12)' : 'rgba(52,211,153,0.12)') : (isLight ? 'rgba(220,38,38,0.12)' : 'rgba(248,113,113,0.12)'))
          spkGrad.addColorStop(1, 'transparent')
          ctx.fillStyle = spkGrad
          ctx.fill()
          ctx.restore()

          // Vol + MCap right-aligned, stacked
          ctx.font = `500 10px ${fBody}`
          ctx.fillStyle = c.muted
          const volStr = `Vol ${formatLargeNumber(token.volume24h || token.volume || 0)}`
          const volW = ctx.measureText(volStr).width
          ctx.fillText(volStr, cx + cardW - cardPad - volW, cy + 80)
          const mcStr = `MCap ${formatLargeNumber(token.marketCap || 0)}`
          const mcW = ctx.measureText(mcStr).width
          ctx.fillText(mcStr, cx + cardW - cardPad - mcW, cy + 96)
        } else {
          // Full-width sparkline (matches UI card layout)
          const synthChange = token.change24h ?? token.change ?? 0
          const synthData = generateSparkline(synthChange, 24)
          const spkX = cx + cardPad, spkY = cy + 64, spkW = cardW - cardPad * 2, spkH = 28
          const spkMin = Math.min(...synthData), spkMax = Math.max(...synthData)
          const spkRange = spkMax - spkMin || 1
          const spkIsUp = synthChange >= 0
          const spkColor = spkIsUp ? c.bull : c.bear

          ctx.save()
          ctx.beginPath()
          for (let si = 0; si < synthData.length; si++) {
            const sx = spkX + (si / (synthData.length - 1)) * spkW
            const sy = spkY + spkH - ((synthData[si] - spkMin) / spkRange) * spkH
            si === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy)
          }
          ctx.strokeStyle = spkColor
          ctx.lineWidth = 1.5
          ctx.lineJoin = 'round'
          ctx.lineCap = 'round'
          ctx.stroke()

          ctx.lineTo(spkX + spkW, spkY + spkH)
          ctx.lineTo(spkX, spkY + spkH)
          ctx.closePath()
          const spkGrad = ctx.createLinearGradient(0, spkY, 0, spkY + spkH)
          spkGrad.addColorStop(0, spkIsUp ? (isLight ? 'rgba(5,150,105,0.12)' : 'rgba(52,211,153,0.12)') : (isLight ? 'rgba(220,38,38,0.12)' : 'rgba(248,113,113,0.12)'))
          spkGrad.addColorStop(1, 'transparent')
          ctx.fillStyle = spkGrad
          ctx.fill()
          ctx.restore()

          // Stats footer: Vol (left) | Liq (center) | MCap (right) - evenly spaced
          const footY = cy + 108
          const labelFont = `500 8px ${fBody}`
          const valueFont = `500 10px ${fMono}`
          const footLeft = cx + cardPad
          const footCenter = cx + cardW / 2
          const footRight = cx + cardW - cardPad

          // Vol - left-aligned
          ctx.font = labelFont; ctx.fillStyle = c.thColor
          ctx.fillText('Vol', footLeft, footY)
          ctx.font = valueFont; ctx.fillStyle = c.muted
          ctx.fillText(formatLargeNumber(token.volume24h || token.volume || 0), footLeft, footY + 13)

          // Liq - center-aligned
          ctx.font = labelFont; ctx.fillStyle = c.thColor
          const liqLabel = 'Liq'
          ctx.fillText(liqLabel, footCenter - ctx.measureText(liqLabel).width / 2, footY)
          ctx.font = valueFont; ctx.fillStyle = c.muted
          const liqVal = token.liquidity > 0 ? formatLargeNumber(token.liquidity) : '-'
          ctx.fillText(liqVal, footCenter - ctx.measureText(liqVal).width / 2, footY + 13)

          // MCap - right-aligned
          ctx.font = labelFont; ctx.fillStyle = c.thColor
          const mcLabel = 'MCap'
          ctx.fillText(mcLabel, footRight - ctx.measureText(mcLabel).width, footY)
          ctx.font = valueFont; ctx.fillStyle = c.muted
          const mcVal = formatLargeNumber(token.marketCap || 0)
          ctx.fillText(mcVal, footRight - ctx.measureText(mcVal).width, footY + 13)
        }

        // Network badge - header area (right-aligned)
        const net = resolveNetwork(token.network)
        if (net) {
          ctx.font = `400 8.5px ${fBody}`
          const nW = ctx.measureText(net.abbrev).width
          const netX = cx + cardW - cardPad - nW
          const netBadgeY = cy + 16
          ctx.fillStyle = net.color
          ctx.beginPath(); ctx.arc(netX - 8, netBadgeY, 3, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = c.muted
          ctx.fillText(net.abbrev, netX, netBadgeY + 3.5)
        }
      })
    } else {
      // ── Table layout (with sparkline chart as last column) ──
      // 7 columns sized to content width, uniform 13px gaps
      // #(24) TOKEN(120) PRICE(90) CHANGE(62) VOL(55) MCAP(70) CHART(65) = 486px + 4+78 gaps = 568
      const cols = [
        { x: pad + 4,   w: 24,  align: 'center' },  // #
        { x: pad + 41,  w: 120, align: 'left' },     // TOKEN
        { x: pad + 174, w: 90,  align: 'right' },    // PRICE
        { x: pad + 277, w: 62,  align: 'right' },    // CHANGE
        { x: pad + 352, w: 55,  align: 'right' },    // VOLUME
        { x: pad + 420, w: 70,  align: 'right' },    // MCAP
        { x: pad + 503, w: 65,  align: 'center' },   // CHART (sparkline - last column)
      ]

      // Measure widest value in change, volume & mcap columns so headers center over actual data
      const changeFont = `600 13px ${fMono}`
      const volFont = `500 12px ${fMono}`
      const mcapFont = `500 12px ${fMono}`
      let maxChangeW = 0, maxVolW = 0, maxMcapW = 0
      tokens.forEach(token => {
        ctx.font = changeFont
        const chW = ctx.measureText(fmtChange(rawChangeFor(token, timeframe)).text).width
        if (chW > maxChangeW) maxChangeW = chW
        ctx.font = volFont
        const vW = ctx.measureText(formatLargeNumber(token.volume24h || token.volume || 0)).width
        if (vW > maxVolW) maxVolW = vW
        ctx.font = mcapFont
        const mW = ctx.measureText(formatLargeNumber(token.marketCap || 0)).width
        if (mW > maxMcapW) maxMcapW = mW
      })

      // Table header
      const thY = theadY + 20
      const thFont = `600 9.5px ${fBody}`
      const tfUpper = timeframe.toUpperCase()
      const rightEdge3 = cols[3].x + cols[3].w
      const rightEdge4 = cols[4].x + cols[4].w
      const rightEdge5 = cols[5].x + cols[5].w
      drawText('#', cols[0], thY, thFont, c.thColor)
      drawText('TOKEN', cols[1], thY, thFont, c.thColor)
      drawText('PRICE', cols[2], thY, thFont, c.thColor)
      drawText(tfUpper, { x: rightEdge3 - maxChangeW, w: maxChangeW, align: 'center' }, thY, thFont, c.thColor)
      drawText('VOLUME', { x: rightEdge4 - maxVolW, w: maxVolW, align: 'center' }, thY, thFont, c.thColor)
      drawText('MCAP', { x: rightEdge5 - maxMcapW, w: maxMcapW, align: 'center' }, thY, thFont, c.thColor)
      drawText('7D', cols[6], thY, thFont, c.thColor)

      // Data rows
      tokens.forEach((token, i) => {
        const ry = tableTop + i * rowH
        if (i % 2 === 0) {
          ctx.fillStyle = c.rowAlt
          ctx.beginPath(); ctx.roundRect(pad, ry, W - pad * 2, rowH, 8); ctx.fill()
        }
        const textY = ry + 27
        // Rank
        drawText(String(i + 1), cols[0], textY, `500 12px ${fMono}`, c.rank)
        // Logo
        const tokenLogo = logoMap[token.symbol]
        const logoSize = 24, logoRad = 6
        if (tokenLogo) {
          ctx.save()
          ctx.beginPath(); ctx.roundRect(cols[1].x, ry + 10, logoSize, logoSize, logoRad); ctx.clip()
          ctx.drawImage(tokenLogo, cols[1].x, ry + 10, logoSize, logoSize)
          ctx.restore()
        } else {
          ctx.fillStyle = c.fallbackBg
          ctx.beginPath(); ctx.roundRect(cols[1].x, ry + 10, logoSize, logoSize, logoRad); ctx.fill()
          ctx.fillStyle = c.fallbackText
          ctx.font = `700 10px ${fBody}`
          const initial = (token.symbol || '?').charAt(0)
          ctx.fillText(initial, cols[1].x + logoSize / 2 - ctx.measureText(initial).width / 2, ry + 26)
        }
        // Symbol
        drawText(token.symbol || '', { x: cols[1].x + 30, w: cols[1].w - 30, align: 'left' }, textY, `600 14px ${fBody}`, c.symbol)
        // Price
        drawText(formatPrice(token.price), cols[2], textY, `500 13px ${fMono}`, c.price)
        // Change (use raw value - fmtChange handles normalization)
        const change = rawChangeFor(token, timeframe)
        const { text: changeText, cls: changeCls } = fmtChange(change)
        const chColor = changeCls === 'bull' ? c.bull : changeCls === 'bear' ? c.bear : c.neutral
        drawText(changeText, cols[3], textY, `600 13px ${fMono}`, chColor)
        // Volume
        drawText(formatLargeNumber(token.volume24h || token.volume || 0), cols[4], textY, `500 12px ${fMono}`, c.muted)
        // MCap
        drawText(formatLargeNumber(token.marketCap || 0), cols[5], textY, `500 12px ${fMono}`, c.muted)

        // Sparkline chart (last column) - matches MiniSparkline in the UI table
        const spkData = (token.sparkline && token.sparkline.length > 2)
          ? token.sparkline
          : generateSparkline(token.change24h ?? token.change ?? 0, 20)
        const spkW = 64, spkH = 28
        const spkX = cols[6].x + (cols[6].w - spkW) / 2
        const spkY = ry + (rowH - spkH) / 2
        const spkMin = Math.min(...spkData), spkMax = Math.max(...spkData)
        const spkRange = spkMax - spkMin || 1
        const spkIsUp = spkData[spkData.length - 1] >= spkData[0]
        const spkStroke = spkIsUp ? c.bull : c.bear
        const spkFill = spkIsUp
          ? (isLight ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.08)')
          : (isLight ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.08)')

        ctx.save()
        ctx.beginPath()
        for (let si = 0; si < spkData.length; si++) {
          const sx = spkX + (si / (spkData.length - 1)) * spkW
          const sy = spkY + spkH - ((spkData[si] - spkMin) / spkRange) * spkH
          si === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy)
        }
        ctx.strokeStyle = spkStroke
        ctx.lineWidth = 1.5
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.stroke()

        // Fill polygon under the line (matches MiniSparkline <polygon>)
        ctx.lineTo(spkX + spkW, spkY + spkH)
        ctx.lineTo(spkX, spkY + spkH)
        ctx.closePath()
        ctx.fillStyle = spkFill
        ctx.fill()
        ctx.restore()
      })
    }

    // -- Footer --
    const fy = H - pad - footerH + 18
    // Separator
    const footGrad = ctx.createLinearGradient(0, 0, W, 0)
    footGrad.addColorStop(0, 'transparent')
    footGrad.addColorStop(0.08, c.footSepLow)
    footGrad.addColorStop(0.5, c.footSepHigh)
    footGrad.addColorStop(0.92, c.footSepLow)
    footGrad.addColorStop(1, 'transparent')
    ctx.fillStyle = footGrad
    ctx.fillRect(pad, fy, W - pad * 2, 1)

    // Row 1: URL + Date
    ctx.fillStyle = c.url
    ctx.font = `500 11.5px ${fBody}`
    ctx.fillText('spectreai.io', pad + 8, fy + 24)
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    ctx.fillStyle = c.date
    ctx.font = `400 11px ${fBody}`
    ctx.fillText(dateStr, W - pad - ctx.measureText(dateStr).width - 8, fy + 24)

    // Row 2: @handle + copyright
    ctx.fillStyle = c.handle
    ctx.font = `400 10.5px ${fBody}`
    ctx.fillText('@Spectre__AI', pad + 8, fy + 44)
    const copyText = `\u00A9 ${new Date().getFullYear()} Spectre AI`
    ctx.fillStyle = c.copy
    ctx.fillText(copyText, W - pad - ctx.measureText(copyText).width - 8, fy + 44)

    // Subtle border
    ctx.strokeStyle = c.border
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.rect(0.5, 0.5, W - 1, H - 1)
    ctx.stroke()

    ctx.restore()

    return canvas.toDataURL('image/png')
  }, [])

  const handleShareClick = useCallback(async () => {
    if (isCapturing || shareTokens.length === 0) return
    setIsCapturing(true)
    setShareImageUrl(null)
    const tfLabel = activeTimeframe === '5m' ? '5 min' : activeTimeframe === '1h' ? '1 hour' : activeTimeframe === '6h' ? '6 hour' : '24 hour'
    const chainPart = chainFilter === 'all' ? '' : ` on ${chainLabel}`
    setShareDescription(`Top 10 ${categoryLabel} tokens by ${tfLabel} price change${chainPart}.\n\n\nvia @Spectre__AI\nhttps://trade.spectreai.io/lite`)
    setShareModalOpen(true)

    try {
      // Pre-load token logos - race direct (CORS) vs proxy, first success wins
      const proxyBase = '/api/img-proxy'
      const tryLoadImg = (src, ms) => new Promise((resolve, reject) => {
        const i = new Image()
        i.crossOrigin = 'anonymous'
        const t = setTimeout(() => { i.src = ''; reject(new Error('timeout')) }, ms)
        i.onload = () => { clearTimeout(t); resolve(i) }
        i.onerror = () => { clearTimeout(t); reject(new Error('failed')) }
        i.src = src
      })
      const logoMap = {}
      await Promise.all(shareTokens.map(async (token) => {
        // Prefer Codex imageThumbUrl, skip placeholder URLs, fall back to TOKEN_LOGOS map
        const raw = token.logo
        const isPlaceholder = !raw || raw.includes('placeholder.com') || raw.startsWith('data:')
        const url = isPlaceholder ? getTokenLogo(token.symbol) : raw
        if (!url || url.startsWith('/')) return
        // img-proxy SSRF guard requires https. Skip the proxy race for
        // non-https URLs or it'll return 400 and show a red line in the
        // network panel for every fallback logo.
        const isHttps = /^https:\/\//i.test(url)
        try {
          // Race: direct load (fast if CORS-friendly) vs proxy (handles blocked CDNs)
          const img = await Promise.any(isHttps ? [
            tryLoadImg(url, 4000),
            tryLoadImg(`${proxyBase}?url=${encodeURIComponent(url)}`, 4000),
          ] : [
            tryLoadImg(url, 4000),
          ])
          logoMap[token.symbol] = img
        } catch { /* both failed - letter fallback */ }
      }))

      // Direct Canvas 2D render with pre-loaded logos
      const dataUrl = renderShareCard(shareTokens, categoryLabel, chainLabel, activeTimeframe, logoMap, viewMode, activeCategory === 'top')
      setShareImageUrl(dataUrl)
    } catch (err) {
      console.error('Share capture failed:', err)
      setShareModalOpen(false)
    } finally {
      setIsCapturing(false)
    }
  }, [isCapturing, shareTokens, categoryLabel, chainLabel, activeTimeframe, chainFilter, renderShareCard, viewMode])

  // Step 2: Copy image to clipboard + open X intent
  const handlePostToX = useCallback(async () => {
    if (!shareImageUrl) return
    // Copy image to clipboard as PNG blob
    try {
      const res = await fetch(shareImageUrl)
      const blob = await res.blob()
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ])
    } catch (err) {
      // silently handled
    }
    // Open X intent - ensure mandatory footer is always present
    let postText = shareDescription.trim()
    if (!postText.includes('@Spectre__AI')) postText += '\n\nvia @Spectre__AI'
    if (!postText.includes('trade.spectreai.io')) postText += '\nhttps://trade.spectreai.io/lite'
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(postText)}`, '_blank', 'noopener')
    setPostedToX(true)
  }, [shareImageUrl, shareDescription])

  const handleCloseShareModal = useCallback(() => {
    setShareModalOpen(false)
    setShareImageUrl(null)
    setImageCopied(false)
    setPostedToX(false)
  }, [])

  return (
    <div className="tdt-section">
      {/* Section header */}
      <div className="tdt-section-header">
        <h2 className="tdt-section-title">Project Discovery<InfoTip text="Real-time token screener pulling live data across multiple blockchains. Filter by momentum, volume, or liquidity to find opportunities early." position="right" /></h2>
        <p className="tdt-section-desc">
          Real-time market data across chains. Sort by momentum, volume, or liquidity to surface
          opportunities before they hit mainstream radar.
        </p>
      </div>

      <div className="tdt">
      {/* ---- Sticky Toolbar ---- */}
      <div className="tdt-toolbar">
        {/* Row 1: Categories + Controls */}
        <div className="tdt-toolbar-row">
          <div className="tdt-categories" role="tablist" aria-label="Token categories">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                className={`tdt-cat${activeCategory === cat.id ? ' is-active' : ''}`}
                onClick={() => { setActiveCategory(cat.id); setColSortKey(null); setColSortDir('desc'); setTopSectorFilter('all') }}
                role="tab"
                aria-selected={activeCategory === cat.id}
              >
                {cat.label}<InfoTip text={getCategoryTip(cat.id, chainFilter)} position="bottom" />
              </button>
            ))}
          </div>

          <div className="tdt-controls">
            {/* Timeframe pills */}
            <div className="tdt-timeframes" role="radiogroup" aria-label="Timeframe">
              {TIMEFRAMES.map(tf => (
                <button
                  key={tf.id}
                  className={`tdt-tf${activeTimeframe === tf.id ? ' is-active' : ''}`}
                  onClick={() => setActiveTimeframe(tf.id)}
                  role="radio"
                  aria-checked={activeTimeframe === tf.id}
                >
                  {tf.label}
                </button>
              ))}
            </div>

            {/* View toggle */}
            <div className="tdt-view-toggle">
              <button
                className={`tdt-view-btn${viewMode === 'list' ? ' is-active' : ''}`}
                onClick={() => setViewMode('list')}
                aria-label="List view"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="1" y="2" width="12" height="1.5" rx=".75" fill="currentColor"/>
                  <rect x="1" y="6.25" width="12" height="1.5" rx=".75" fill="currentColor"/>
                  <rect x="1" y="10.5" width="12" height="1.5" rx=".75" fill="currentColor"/>
                </svg>
              </button>
              <button
                className={`tdt-view-btn${viewMode === 'grid' ? ' is-active' : ''}`}
                onClick={() => setViewMode('grid')}
                aria-label="Grid view"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor"/>
                  <rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor"/>
                  <rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor"/>
                  <rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor"/>
                </svg>
              </button>
            </div>

            {/* Compare toggle */}
            <button
              className={`tdt-compare-btn${effectiveCompareMode ? ' is-active' : ''}`}
              onClick={() => {
                if (effectiveCompareMode) {
                  setLocalCompareMode(false)
                  if (onExitCompare) onExitCompare()
                } else {
                  setLocalCompareMode(true)
                }
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
              </svg>
              Compare
            </button>

            {/* Share on X */}
            <button
              className={`tdt-share-btn${isCapturing ? ' is-capturing' : ''}`}
              onClick={handleShareClick}
              disabled={isCapturing || shareTokens.length === 0}
              aria-label="Share on X"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              {isCapturing ? 'Capturing...' : 'Share'}
            </button>
          </div>
        </div>

        {/* Row 2: Chain/Sector filter pills */}
        <div className="tdt-toolbar-row tdt-toolbar-row--chains">
          {activeCategory === 'top'
            ? <SectorFilter value={topSectorFilter} onChange={setTopSectorFilter} />
            : <ChainFilter value={chainFilter} onChange={setChainFilter} onHoverChain={(id) => prefetchTrending(CHAIN_NET_IDS[id], activeTimeframe)} />
          }
        </div>
      </div>

      {/* ---- Table (list view) ---- */}
      {viewMode === 'list' ? (
        <div className={`tdt-table${activeCategory === 'top' ? ' tdt-top-coins' : ''}`} role="table" aria-label="Token discovery table">
          {/* Header */}
          <div className="tdt-header" role="row">
            <span className="th th-rank">#</span>
            <span className="th th-project th-sortable" onClick={() => handleColSort('name')}>
              Project{colSortKey === 'name' && <span className={`th-sort-arrow ${colSortDir}`} />}
            </span>
            <span className="th th-price th-sortable" onClick={() => handleColSort('price')}>
              Price{colSortKey === 'price' && <span className={`th-sort-arrow ${colSortDir}`} />}
            </span>
            <span className="th th-mcap th-sortable" onClick={() => handleColSort('marketCap')}>
              MCap{colSortKey === 'marketCap' && <span className={`th-sort-arrow ${colSortDir}`} />}
            </span>
            {activeCategory !== 'top' && (
              <span className="th th-change th-sortable" onClick={() => handleColSort('change5m')}>
                5m{colSortKey === 'change5m' && <span className={`th-sort-arrow ${colSortDir}`} />}
              </span>
            )}
            <span className="th th-change th-sortable" onClick={() => handleColSort('change1h')}>
              1h{colSortKey === 'change1h' && <span className={`th-sort-arrow ${colSortDir}`} />}
            </span>
            {activeCategory !== 'top' && (
              <span className="th th-change th-sortable" onClick={() => handleColSort('change6h')}>
                6h{colSortKey === 'change6h' && <span className={`th-sort-arrow ${colSortDir}`} />}
              </span>
            )}
            <span className="th th-change th-sortable" onClick={() => handleColSort('change24h')}>
              24h{colSortKey === 'change24h' && <span className={`th-sort-arrow ${colSortDir}`} />}
            </span>
            {activeCategory === 'top' && (
              <span className="th th-change th-sortable" onClick={() => handleColSort('change7d')}>
                7d{colSortKey === 'change7d' && <span className={`th-sort-arrow ${colSortDir}`} />}
              </span>
            )}
            <span className="th th-volume th-sortable" onClick={() => handleColSort('volume24h')}>
              Volume{colSortKey === 'volume24h' && <span className={`th-sort-arrow ${colSortDir}`} />}
            </span>
            {activeCategory !== 'top' && (
              <span className="th th-txns th-sortable" onClick={() => handleColSort('txnCount24')}>
                Txns{colSortKey === 'txnCount24' && <span className={`th-sort-arrow ${colSortDir}`} />}
              </span>
            )}
            {activeCategory !== 'top' && (
              <span className="th th-liquidity th-sortable" onClick={() => handleColSort('liquidity')}>
                Liquidity{colSortKey === 'liquidity' && <span className={`th-sort-arrow ${colSortDir}`} />}
              </span>
            )}
            {activeCategory !== 'top' && (
              <span className="th th-age th-sortable" onClick={() => handleColSort('createdAt')}>
                Age{colSortKey === 'createdAt' && <span className={`th-sort-arrow ${colSortDir}`} />}
              </span>
            )}
            <span className="th th-sparkline">7d</span>
          </div>

          {/* Rows - scrollable body */}
          <div className="tdt-scroll-body">
             {tableLoading && filteredTokens.length === 0 ? (
              <div className="tdt-loading">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="tdt-row-skeleton" style={{ animationDelay: `${i * 80}ms` }} />
                ))}
              </div>
            ) : filteredTokens.length === 0 ? (
              <div className="tdt-empty">{emptyMessage}</div>
            ) : (
              filteredTokens.map((token, i) => (
                <TokenRow
                  key={token.address || `${token.symbol}-${i}`}
                  token={token}
                  rank={i + 1}
                  onClick={handleSelect}
                  compareMode={effectiveCompareMode}
                  isSelected={compareTokens?.some(t => t.address === token.address)}
                  onToggleCompare={onToggleCompare}
                  animDelay={i * 40}
                  isTopCoins={activeCategory === 'top'}
                  mcapBands={mcapBands}
                />
              ))
            )}
          </div>
        </div>
      ) : (
        /* ---- Grid view ---- */
        <div className={`tdt-grid tdt-scroll-body tdt-scroll-body--grid${activeCategory === 'top' ? ' tdt-top-coins' : ''}`}>
          {tableLoading && filteredTokens.length === 0 ? (
            Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="tdt-card-skeleton" style={{ animationDelay: `${i * 60}ms` }} />
            ))
          ) : filteredTokens.length === 0 ? (
            <div className="tdt-empty">{emptyMessage}</div>
          ) : (
            filteredTokens.map((token, i) => (
              <TokenCard
                key={token.address || `${token.symbol}-${i}`}
                token={token}
                rank={i + 1}
                onClick={handleSelect}
                compareMode={effectiveCompareMode}
                isSelected={compareTokens?.some(t => t.address === token.address)}
                onToggleCompare={onToggleCompare}
                animDelay={i * 50}
                isTopCoins={activeCategory === 'top'}
              />
            ))
          )}
        </div>
      )}
      </div>

      {/* Share preview modal */}
      {shareModalOpen && createPortal(
        <div className="share-modal-overlay" onClick={handleCloseShareModal}>
          <div className="share-modal" onClick={e => e.stopPropagation()}>
            {/* Close button */}
            <button className="share-modal-close" onClick={handleCloseShareModal} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            {/* Header */}
            <div className="share-modal-header">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="share-modal-x-icon">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span className="share-modal-title">Share on X</span>
            </div>

            {/* Image preview */}
            <div className="share-modal-preview">
              {shareImageUrl ? (
                <img src={shareImageUrl} alt="Share preview" className="share-modal-image" />
              ) : (
                <div className="share-modal-placeholder">
                  <div className="share-modal-spinner" />
                  <span className="share-modal-loading-text">Generating preview...</span>
                </div>
              )}
            </div>

            {/* Description */}
            <label className="share-modal-label">Post Description</label>
            <textarea
              className="share-modal-textarea"
              value={shareDescription}
              onChange={e => setShareDescription(e.target.value)}
              placeholder="Write your post..."
              rows={3}
              maxLength={280}
            />
            <div className="share-modal-char-count">
              <span className={shareDescription.length > 260 ? 'is-warn' : ''}>{shareDescription.length}</span>/280
            </div>

            {/* Actions */}
            <div className="share-modal-actions">
              <button className="share-modal-download" onClick={() => {
                if (!shareImageUrl) return
                const link = document.createElement('a')
                link.download = `spectre-${activeCategory}-${new Date().toISOString().slice(0, 10)}.png`
                link.href = shareImageUrl
                link.click()
              }} disabled={!shareImageUrl}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Save
              </button>
              <button className={`share-modal-copy${imageCopied ? ' is-copied' : ''}`} onClick={async () => {
                if (!shareImageUrl) return
                try {
                  const res = await fetch(shareImageUrl)
                  const blob = await res.blob()
                  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                  setImageCopied(true)
                  setTimeout(() => setImageCopied(false), 2000)
                } catch (err) { /* silently handled */ }
              }} disabled={!shareImageUrl}>
                {imageCopied ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                )}
                {imageCopied ? 'Copied!' : 'Copy'}
              </button>
              <button className="share-modal-post" onClick={handlePostToX} disabled={!shareImageUrl}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                Post on X
              </button>
            </div>

            <p className="share-modal-paste-hint">
              Once the image is ready, click Post on X - the image is copied to your clipboard automatically. Paste it (Ctrl+V) directly into your post.
            </p>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
