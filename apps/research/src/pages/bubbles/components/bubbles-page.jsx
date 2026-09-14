/**
 * BubblesPage - Market Bubblemap visualization.
 * Shows top tokens/stocks as circle-packed bubbles sized by market cap,
 * colored by price change, with glass tooltip and fullscreen mode.
 * Supports both Crypto and Stocks market modes.
 *
 * The second view is the SPECTRE COSMOS (src/components/cosmos/) — a lazy-loaded
 * WebGL universe where the market leader is the sun and every token orbits by
 * performance. three.js loads only when that view opens (never on boot).
 */
import React, { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getCategoryCoins } from '@/services/coinGeckoApi'
import { getSpectreCoinsMarketsPage, getSpectreGlobalMetrics } from '@/services/spectreMarketApi'
import { getXDashRunnerCoins, XDASH_RUNNERS_CATEGORY } from '@/services/xdashRunners'
import { trackUi } from '@/services/analytics'
import LiquidityPulse from '@/components/liquidity-pulse'
import { computeLiquidityFlow, dollarFlow } from '@/lib/liquidity-flow'
import { useBinanceTopCoinPrices } from '@/hooks/useCodexData'
import { getStockQuotes, POPULAR_STOCKS, FALLBACK_STOCK_DATA, getStockLogoUrl } from '@/services/stockApi'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import { useCurrency } from '@/hooks/useCurrency'
import ShareXButton from '@/components/share-x-button'
import VisitConfirm from '@/components/visit-confirm'
const ShareXModal = lazy(() => import('@/components/share-x-modal'))
// The Cosmos view pulls in three.js — lazy so the vendor-three chunk loads
// only when the user opens the Cosmos tab.
const CosmosView = lazy(() => import('@/components/cosmos/cosmos-view'))
import { renderShareCard, preloadLogos, getSpectreLogo, CARD_PAD } from '@/lib/shareToX'
import { forceSimulation, forceCollide, forceX, forceY, forceManyBody } from 'd3-force'
import './bubbles-page.css'
import './bubbles-page.mobile.css'
import './bubbles-polish.css'

const formatChange = (change) => {
  const value = typeof change === 'number' ? change : parseFloat(change) || 0
  return value.toFixed(2)
}

/* ── Sector colors for stocks ── */
const SECTOR_COLORS = {
  Technology: '59, 130, 246',      // blue
  Semiconductor: '0, 200, 220',    // cyan
  Financial: '168, 85, 247',       // purple
  Healthcare: '16, 185, 129',      // emerald
  Consumer: '251, 146, 60',        // orange
  Communication: '236, 72, 153',   // pink
  Energy: '234, 179, 8',           // yellow
  Industrial: '148, 163, 184',     // slate
  Automotive: '239, 68, 68',       // red
  RealEstate: '45, 212, 191',      // teal
  Commodity: '212, 175, 55',       // gold
  Index: '99, 102, 241',           // indigo
}
const DEFAULT_SECTOR_COLOR = '148, 163, 184' // slate

/* ── Constants ── */
const TIMEFRAMES = [
  { id: '1h', label: '1H' },
  { id: '24h', label: '24H' },
  { id: '7d', label: '7D' },
]
// Stocks only have today's change - show a single "Today" timeframe
const STOCK_TIMEFRAMES = [
  { id: 'today', labelKey: 'bubbles.today' },
]
// One hundred tokens per view, including mobile; only the chosen page is fetched.
const PAGE_RANGES = Array.from({ length: 20 }, (_, index) => ({
  id: index + 1,
  label: `${index * 100 + 1} – ${(index + 1) * 100}`,
  start: index * 100 + 1,
  end: (index + 1) * 100,
}))
// X Dash runners board sizes — the count pills shown in runners mode.
const RUNNERS_COUNTS = [25, 50, 100]
const STOCK_SECTOR_FILTERS = [
  { id: 'all', labelKey: 'bubbles.allSectors' },
  { id: 'Technology', labelKey: 'bubbles.tech' },
  { id: 'Semiconductor', labelKey: 'bubbles.chips' },
  { id: 'Financial', labelKey: 'bubbles.finance' },
  { id: 'Healthcare', labelKey: 'bubbles.health' },
  { id: 'Consumer', labelKey: 'bubbles.consumer' },
  { id: 'Energy', labelKey: 'bubbles.energy' },
  { id: 'Industrial', labelKey: 'bubbles.industrial' },
  { id: 'Communication', labelKey: 'bubbles.media' },
  { id: 'RealEstate', labelKey: 'bubbles.realEstate' },
  { id: 'Automotive', labelKey: 'bubbles.auto' },
  { id: 'Index', labelKey: 'bubbles.etfs' },
]
const CRYPTO_CATEGORIES = [
  { id: 'all', labelKey: 'bubbles.categories.all', fallback: 'All' },
  { id: XDASH_RUNNERS_CATEGORY, labelKey: 'bubbles.categories.xrunners', fallback: '𝕏 Runners' },
  { id: 'artificial-intelligence', labelKey: 'bubbles.categories.ai', fallback: 'AI' },
  { id: 'ai-agents', labelKey: 'bubbles.categories.aiAgents', fallback: 'AI Agents' },
  { id: 'meme-token', labelKey: 'bubbles.categories.meme', fallback: 'Meme' },
  { id: 'real-world-assets-rwa', labelKey: 'bubbles.categories.rwa', fallback: 'RWA' },
  { id: 'decentralized-finance-defi', labelKey: 'bubbles.categories.defi', fallback: 'DeFi' },
  { id: 'gaming', labelKey: 'bubbles.categories.gaming', fallback: 'Gaming' },
  { id: 'layer-2', labelKey: 'bubbles.categories.l2', fallback: 'L2' },
]
const SORT_OPTIONS = [
  { id: 'market_cap', labelKey: 'bubbles.sortMarketCap' },
  { id: 'change', labelKey: 'bubbles.sortChange' },
  { id: 'volume', labelKey: 'bubbles.sortVolume' },
]

/* ── Mini sparkline SVG path generator (with memoization cache) ── */
const _sparklineCache = new Map()
const SPARKLINE_CACHE_MAX = 500

function sparklinePath(data, w, h) {
  if (!data || data.length < 2) return ''

  // Cache key from dimensions + data fingerprint (include interior points to avoid collisions)
  const mid = Math.floor(data.length / 2)
  const q1 = Math.floor(data.length / 4)
  const q3 = Math.floor(data.length * 3 / 4)
  const cacheKey = `${w}_${h}_${data.length}_${data[0]}_${data[q1]}_${data[mid]}_${data[q3]}_${data[data.length - 1]}`
  const cached = _sparklineCache.get(cacheKey)
  if (cached) return cached

  // Downsample to ~24 points for performance
  const step = Math.max(1, Math.floor(data.length / 24))
  const pts = []
  for (let i = 0; i < data.length; i += step) pts.push(data[i])
  if (pts[pts.length - 1] !== data[data.length - 1]) pts.push(data[data.length - 1])
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const range = max - min || 1
  const result = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  // Evict oldest entries if cache grows too large
  if (_sparklineCache.size >= SPARKLINE_CACHE_MAX) {
    const firstKey = _sparklineCache.keys().next().value
    _sparklineCache.delete(firstKey)
  }
  _sparklineCache.set(cacheKey, result)

  return result
}

/* ── Memoized bubble-node leaf ──
 * One node per token. Receives fully-computed primitive props + STABLE handlers
 * (hoisted in the parent via useCallback). React.memo + stable handlers means a
 * node only re-renders when ITS OWN values change (position/price/change), not
 * on every live-price tick across the whole 100-300 node arena. Node identity
 * (idx/isFs) travels via data- attributes that the parent's stable handlers read
 * off event.currentTarget. */
const BubbleNode = React.memo(function BubbleNode({
  idx, isFs, token, isStocks, r, px, py,
  change, isPositive, bgColor, bgTop, bgBottom, borderColor, brandRgb,
  showLogo, showChange, showName, showSector, spark,
  onMouseDown, onTouchStart, onTouchEnd, onMouseEnter, onMouseMove, onMouseLeave,
}) {
  return (
    <div
      data-idx={idx}
      data-fs={isFs ? '1' : '0'}
      className={`bubble-node ${isPositive ? 'positive' : 'negative'} ${isStocks ? 'stock-bubble' : ''}`}
      style={{
        width: r * 2,
        height: r * 2,
        transform: `translate3d(${px - r}px, ${py - r}px, 0)`,
        '--bubble-bg': bgColor,
        '--bubble-bg-top': bgTop,
        '--bubble-bg-bottom': bgBottom,
        '--bubble-border': borderColor,
        '--bubble-brand-rgb': brandRgb,
      }}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <div className="bubble-content">
        {showLogo && (
          <div className="bubble-logo" style={{ width: Math.max(16, r * 0.44), height: Math.max(16, r * 0.44) }}>
            {token.logo ? (
              <img src={token.logo} alt={token.symbol} onError={(e) => { e.target.style.display = 'none' }} />
            ) : (
              <span className={isStocks ? 'stock-ticker-letter' : ''}>{token.symbol?.[0] || '?'}</span>
            )}
          </div>
        )}
        <span className="bubble-symbol" style={{ fontSize: Math.max(9, r * 0.22) }}>
          {token.symbol}
        </span>
        {showName && (
          <span className="bubble-name" style={{ fontSize: Math.max(8, r * 0.14) }}>
            {token.name}
          </span>
        )}
        {showSector && (
          <span className="bubble-sector" style={{ fontSize: Math.max(7, r * 0.11), color: `rgb(${SECTOR_COLORS[token.sector] || DEFAULT_SECTOR_COLOR})` }}>
            {token.sector}
          </span>
        )}
        {showChange && (
          <span className={`bubble-change ${isPositive ? 'pos' : 'neg'}`}
                style={{ fontSize: Math.max(8, r * 0.18) }}>
            {isPositive ? '+' : ''}{formatChange(change)}%
          </span>
        )}
        {r > 50 && spark && spark.length > 2 && (
          <svg className="bubble-sparkline" viewBox={`0 0 ${Math.round(r * 1.1)} ${Math.round(r * 0.35)}`}
               style={{ width: Math.round(r * 1.1), height: Math.round(r * 0.35) }}>
            <path d={sparklinePath(spark, Math.round(r * 1.1), Math.round(r * 0.35))}
                  fill="none" stroke={isPositive ? 'rgba(52, 211, 153, 0.5)' : 'rgba(248, 113, 113, 0.5)'}
                  strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>
  )
})

/* ── Prepare bubble nodes with radii (D3 force handles positioning) ── */
function prepareBubbleNodes(tokens, containerWidth, containerHeight) {
  if (!tokens.length || !containerWidth || !containerHeight) return []

  let maxMcap = -Infinity, minMcap = Infinity
  for (const t of tokens) {
    const m = t.marketCap || 1
    if (m > maxMcap) maxMcap = m
    if (m < minMcap) minMcap = m
  }
  if (!isFinite(maxMcap)) maxMcap = 1
  if (!isFinite(minMcap)) minMcap = 1
  const logMax = Math.log(maxMcap)
  const logMin = Math.log(minMcap)
  const logRange = logMax - logMin || 1

  const isMobile = containerWidth < 500
  const MIN_R = isMobile ? 24 : 34
  const MAX_R = Math.min(155, containerWidth * 0.12, containerHeight * 0.19)

  // First pass: compute raw radii
  const rawRadii = tokens.map(t => {
    const logNorm = (Math.log(t.marketCap || 1) - logMin) / logRange
    return MIN_R + Math.pow(logNorm, 0.55) * (MAX_R - MIN_R)
  })

  // Area-based fitting: shrink all radii if total circle area exceeds container
  const totalCircleArea = rawRadii.reduce((sum, r) => sum + Math.PI * r * r, 0)
  const containerArea = containerWidth * containerHeight
  const packingTarget = containerArea * (isMobile ? 0.94 : 0.85)
  const scale = totalCircleArea > packingTarget
    ? Math.sqrt(packingTarget / totalCircleArea)
    : 1

  const cx = containerWidth / 2
  const cy = containerHeight / 2

  return tokens.map((t, i) => {
    const radius = Math.max(20, rawRadii[i] * scale)
    const angle = i * 2.399
    const dist = Math.sqrt(i + 1) * 22
    return {
      ...t,
      radius: Math.round(radius * 10) / 10,
      x: cx + Math.cos(angle) * dist,
      y: cy + Math.sin(angle) * dist,
    }
  })
}

/* ══════════════════════════════════════════════════════
   COMPONENT
   ══════════════════════════════════════════════════════ */

const BubblesPage = ({ dayMode = false, isMobile = false, marketMode = 'crypto', onBack, compact = false, onTokenClick }) => {
  const { t } = useTranslation()
  const { fmtPrice, fmtLarge } = useCurrency()
  const isStocks = marketMode === 'stocks'

  const [allTokens, setAllTokens] = useState([])
  // Sparklines arrive in a deferred phase-2 fetch (see fetchTokens). Stored in
  // a symbol-keyed map, NOT merged into allTokens — merging would change the
  // sortedTokens reference and force prepareBubbleNodes / initSolarBodies to
  // re-pack and re-run the physics sim, reflowing every bubble. The render
  // reads sparklineMap[symbol] so positions stay frozen when sparklines land.
  const [sparklineMap, setSparklineMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pageRange, setPageRange] = useState(PAGE_RANGES[0])
  const [timeframe, setTimeframeRaw] = useState(isStocks ? 'today' : '24h')
  const [sortBy, setSortByRaw] = useState('market_cap')
  // tracked setters - remaining call sites are user clicks; programmatic
  // resets (mode switch, runners lock) call setTimeframeRaw directly
  const setTimeframe = (v) => { trackUi('bubbles_timeframe', v); setTimeframeRaw(v) }
  const setSortBy = (v) => { trackUi('bubbles_metric', v); setSortByRaw(v) }
  const [sectorFilter, setSectorFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [runnersCount, setRunnersCount] = useState(50)
  const [fullscreen, setFullscreen] = useState(false)
  // Pending bubble navigation awaiting the VisitConfirm bar ({ token }).
  const [pendingVisit, setPendingVisit] = useState(null)
  const [hoveredToken, setHoveredToken] = useState(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  // rAF-throttled tooltip position writes — mousemove fires per pixel, so
  // committing setState every event triggers a full React reconcile each
  // frame on every bubble hover.
  const tooltipFrameRef = useRef(null)
  const pendingTooltipPosRef = useRef(null)
  const scheduleTooltipPos = useCallback((x, y) => {
    pendingTooltipPosRef.current = { x, y }
    if (tooltipFrameRef.current != null) return
    tooltipFrameRef.current = requestAnimationFrame(() => {
      tooltipFrameRef.current = null
      if (pendingTooltipPosRef.current) setTooltipPos(pendingTooltipPosRef.current)
    })
  }, [])
  useEffect(() => () => {
    if (tooltipFrameRef.current != null) cancelAnimationFrame(tooltipFrameRef.current)
  }, [])
  const [viewMode, setViewModeRaw] = useState('bubbles') // 'bubbles' | 'cosmos'
  const setViewMode = (v) => { trackUi('bubbles_view', v); setViewModeRaw(v) }
  const containerRef = useRef(null)
  const fullscreenArenaRef = useRef(null)
  const [isBubblesShareExporting, setIsBubblesShareExporting] = useState(false)
  const [bubShareModalOpen, setBubShareModalOpen] = useState(false)
  const [bubShareImageUrl, setBubShareImageUrl] = useState(null)
  const [bubShareDescription, setBubShareDescription] = useState('')
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [fsSize, setFsSize] = useState({ width: 0, height: 0 })

  // ── D3 force simulation refs ──
  const simRef = useRef(null)
  const simNodesRef = useRef([])
  const fsSimRef = useRef(null)
  const fsSimNodesRef = useRef([])
  const liveRef = useRef([])
  const fsLiveRef = useRef([])
  const dragRef2 = useRef({
    active: false, idx: -1, isFs: false, rect: null,
    grabX: 0, grabY: 0, prevX: 0, prevY: 0, prevTime: 0, vx: 0, vy: 0,
  })

  // Refs for stable access in drag-end closure (useEffect has [] deps)
  const onTokenClickRef = useRef(onTokenClick)
  onTokenClickRef.current = onTokenClick
  const sortedTokensRef = useRef([])

  // VisitConfirm handlers — confirm hands the token to the nav prop, cancel
  // just clears. Stable identities so the confirm bar never re-arms its timer.
  const cancelPendingVisit = useCallback(() => setPendingVisit(null), [])
  const confirmPendingVisit = useCallback(() => {
    setPendingVisit((pv) => {
      if (pv?.token && onTokenClickRef.current) onTokenClickRef.current(pv.token)
      return null
    })
  }, [])
  // True when the active pointer interaction is touch. Mobile fires synthetic
  // mouseenter -> mouseleave right after a tap; without this the detail opened
  // on the synthetic mouseenter and was killed one tick later by the synthetic
  // mouseleave ("opens then instantly closes"). We open on touchend instead and
  // suppress the synthetic mouse handlers while this is set.
  const wasTouchRef = useRef(false)
  // Timestamp of the last touch interaction. Browsers fire synthesized mouse
  // events (~300ms after touchend) which would re-enter handleBubbleGrab as a
  // mouse event, reset wasTouchRef to false, and hide the tooltip we just
  // opened in onTouchEnd. We swallow mouse events that arrive shortly after.
  const lastTouchTimeRef = useRef(0)

  // Per-node hover payload, keyed by arena ('main' | 'fs') then bubble index.
  // The bubble-node handlers are hoisted to ONE stable identity each (so the
  // memo'd node leaf actually holds across live-price ticks); they read the
  // node identity from e.currentTarget.dataset and the hover payload (token +
  // live price + change) from this ref instead of from a per-node closure.
  const nodePayloadRef = useRef({ main: [], fs: [] })

  const readNodeMeta = useCallback((el) => {
    const idx = Number(el?.dataset?.idx)
    const isFs = el?.dataset?.fs === '1'
    const payload = nodePayloadRef.current[isFs ? 'fs' : 'main'][idx]
    return { idx, isFs, payload }
  }, [])

  const onBubbleMouseDown = useCallback((e) => {
    const { idx, isFs } = readNodeMeta(e.currentTarget)
    handleBubbleGrabRef.current(e, idx, isFs)
  }, [readNodeMeta])

  const onBubbleTouchStart = useCallback((e) => {
    const { idx, isFs } = readNodeMeta(e.currentTarget)
    handleBubbleGrabRef.current(e, idx, isFs)
  }, [readNodeMeta])

  const onBubbleTouchEnd = useCallback((e) => {
    const { payload } = readNodeMeta(e.currentTarget)
    if (!payload) return
    const ds = dragRef2.current
    const tp = e.changedTouches?.[0]
    if (!tp) return
    lastTouchTimeRef.current = Date.now()
    const moved = Math.hypot(tp.clientX - (ds.startClientX ?? tp.clientX), tp.clientY - (ds.startClientY ?? tp.clientY))
    if (moved < 5) {
      wasTouchRef.current = true
      setTooltipPos({ x: tp.clientX, y: tp.clientY })
      setHoveredToken({ ...payload.token, livePrice: payload.livePrice, change: payload.change })
    }
  }, [readNodeMeta])

  const onBubbleMouseEnter = useCallback((e) => {
    if (wasTouchRef.current) return
    if (dragRef2.current.active) return
    const { payload } = readNodeMeta(e.currentTarget)
    if (!payload) return
    setHoveredToken({ ...payload.token, livePrice: payload.livePrice, change: payload.change })
    setTooltipPos({ x: e.clientX, y: e.clientY })
  }, [readNodeMeta])

  const onBubbleMouseMove = useCallback((e) => {
    if (!wasTouchRef.current && !dragRef2.current.active) scheduleTooltipPos(e.clientX, e.clientY)
  }, [scheduleTooltipPos])

  const onBubbleMouseLeave = useCallback(() => {
    if (!wasTouchRef.current && !dragRef2.current.active) setHoveredToken(null)
  }, [])

  // Reset state when market mode switches
  useEffect(() => {
    setAllTokens([])
    setSparklineMap({})
    setLoading(true)
    setError(null)
    setHoveredToken(null)
    setTimeframeRaw(isStocks ? 'today' : '24h')
    setSectorFilter('all')
    setCategoryFilter('all')
  }, [isStocks])

  // Mobile: a tapped-open token card is STICKY (kept on touch so the finger
  // doesn't hide it). Without a global dismiss it stayed stuck - it's a
  // pointer-events:none portal at z-index 99999, so it visually covered empty
  // space, the header, and even whatever you navigated to via the bottom nav.
  // Close it on the NEXT touch anywhere; a real bubble tap re-opens it via the
  // per-bubble touchend handler that fires after this pointerdown. Touch-only,
  // so desktop hover behaviour is untouched.
  useEffect(() => {
    const dismiss = (e) => {
      if (e.pointerType && e.pointerType !== 'touch') return
      setHoveredToken((cur) => (cur ? null : cur))
    }
    document.addEventListener('pointerdown', dismiss, true)
    return () => document.removeEventListener('pointerdown', dismiss, true)
  }, [])

  // Belt-and-suspenders: clear the card on any route change too (a nav that
  // unmounts the page already drops the portal, but this covers same-route
  // overlays/drawers that open on top).
  const bubbleLocation = useLocation()
  useEffect(() => { setHoveredToken(null) }, [bubbleLocation.pathname])

  // X Dash runners carry only a 24h change — lock the timeframe while active
  // (the TF pills are hidden in this mode) so the color scale stays honest.
  const isRunnersMode = !isStocks && categoryFilter === XDASH_RUNNERS_CATEGORY
  useEffect(() => {
    if (isRunnersMode) setTimeframeRaw('24h')
  }, [isRunnersMode])

  // Live prices (crypto only - stocks refresh via fetch interval)
  const symbols = useMemo(() => {
    if (isStocks) return []
    return allTokens.map(t => (t.symbol || '').toUpperCase()).filter(Boolean)
  }, [allTokens, isStocks])
  const { prices: binancePrices } = useBinanceTopCoinPrices(symbols, isStocks ? null : 5000)
  // Mirror live prices into a ref so the Cosmos view can read the freshest
  // price at hover/focus time WITHOUT `binancePrices` re-rendering the scene.
  const binancePricesRef = useRef(binancePrices)
  useEffect(() => { binancePricesRef.current = binancePrices }, [binancePrices])

  /* ── Fetch CRYPTO data (top coins or category) ── */
  useEffect(() => {
    if (isStocks) return
    let cancelled = false
    const mapCoin = (coin, index, startRank = 1) => ({
      rank: coin.market_cap_rank || (startRank + index),
      symbol: (coin.symbol || '').toUpperCase(),
      name: coin.name || '',
      logo: coin.image || null,
      price: Number(coin.current_price) || 0,
      change24h: Number(coin.price_change_percentage_24h) || 0,
      change1h: Number(coin.price_change_percentage_1h_in_currency) || 0,
      change7d: Number(coin.price_change_percentage_7d_in_currency) || 0,
      marketCap: Number(coin.market_cap) || 0,
      volume: Number(coin.total_volume) || 0,
      sparkline_7d: Array.isArray(coin.sparkline_in_7d?.price) ? coin.sparkline_in_7d.price : null,
      _type: 'crypto',
    })

    const fetchTokens = async () => {
      setLoading(true)
      setError(null)
      setSparklineMap({})
      const wanted = pageRange.end - pageRange.start + 1

      const reveal = (coins, rankStart) => {
        if (cancelled) return
        const mapped = coins.slice(0, wanted).map((coin, i) => mapCoin(coin, i, rankStart))
        setAllTokens(mapped)
        setLoading(false)
      }

      try {
        if (categoryFilter === XDASH_RUNNERS_CATEGORY) {
          // X Dash runners — the social momentum board rendered as bubbles. One
          // fetch (25/50/100) of CG-market-shaped rows so mapCoin works untouched.
          const coins = await getXDashRunnerCoins(runnersCount)
          if (cancelled) return
          if (Array.isArray(coins) && coins.length > 0) {
            setAllTokens(coins.map((coin, i) => mapCoin(coin, i, 1)))
            setLoading(false)
          } else {
            setError(t('common.error')); setLoading(false)
          }
          return
        }
        if (categoryFilter !== 'all') {
          // Categories still need pagination (CG `/coins/markets?category=` caps at 250 per page).
          // Stream: show each page as it arrives.
          const pageCount = Math.ceil(wanted / 25)
          const slots = new Array(pageCount).fill(null)
          let revealedFirst = false
          let anySettled = false
          const fetchOne = (slotIdx) => getCategoryCoins(categoryFilter, 1 + slotIdx, 25)
            .then((coins) => {
              if (cancelled) return
              slots[slotIdx] = Array.isArray(coins) ? coins : []
              anySettled = true
              const merged = slots.flatMap((s) => s || []).slice(0, wanted)
                .map((coin, i) => mapCoin(coin, i, 1))
              setAllTokens(merged)
              if (!revealedFirst && merged.length > 0) {
                revealedFirst = true
                setLoading(false)
              }
            }).catch(() => {})
          await Promise.all(Array.from({ length: pageCount }, (_, i) => fetchOne(i)))
          if (cancelled) return
          if (!anySettled) { setError(t('common.error')); setLoading(false) }
        } else {
          // Top coins: one Hetzner-cached call returns the whole range.
          // PHASE 1: fetch WITHOUT sparklines (~86KB vs ~394KB) so the bubbles
          // paint on the smaller payload. Sparklines are pulled in phase 2.
          const apiPage = Math.ceil(pageRange.start / 100)
          const coins = await getSpectreCoinsMarketsPage(apiPage, wanted, { sparkline: false })
          if (cancelled) return
          if (Array.isArray(coins) && coins.length > 0) {
            reveal(coins, pageRange.start)
            // PHASE 2: after first paint, refetch WITH sparklines on idle and
            // merge ONLY into sparklineMap (symbol -> price[]). allTokens is
            // untouched, so no re-pack, no re-sim.
            const runPhase2 = () => {
              if (cancelled) return
              getSpectreCoinsMarketsPage(apiPage, wanted, { sparkline: true })
                .then((withSpark) => {
                  if (cancelled || !Array.isArray(withSpark)) return
                  const next = {}
                  for (const c of withSpark) {
                    const sym = (c.symbol || '').toUpperCase()
                    const sp = Array.isArray(c.sparkline_in_7d?.price) ? c.sparkline_in_7d.price : null
                    if (sym && sp) next[sym] = sp
                  }
                  if (Object.keys(next).length > 0) setSparklineMap((prev) => ({ ...prev, ...next }))
                })
                .catch(() => {})
            }
            if (typeof window !== 'undefined' && window.requestIdleCallback) {
              window.requestIdleCallback(runPhase2, { timeout: 2500 })
            } else {
              setTimeout(runPhase2, 600)
            }
          } else {
            setError(t('common.error'))
            setLoading(false)
          }
        }
      } catch (err) {
        if (!cancelled) { setError(t('common.error')); setLoading(false) }
      }
    }
    fetchTokens()
    return () => { cancelled = true }
  }, [pageRange, isStocks, categoryFilter, runnersCount])

  /* ── Helper: map quotes + POPULAR_STOCKS into display format ── */
  const mapStocksToTokens = useCallback((quotes) => {
    const mapped = POPULAR_STOCKS.map((stock, index) => {
      const quote = quotes[stock.symbol] || {}
      const fallback = FALLBACK_STOCK_DATA[stock.symbol]
      const price = quote.price || (fallback?.price || 0)
      const change = quote.change != null ? quote.change : (fallback?.change || 0)
      const mcap = quote.marketCap || (fallback?.marketCap || 0)
      const volume = quote.volume || (fallback?.volume || 0)
      if (price <= 0 && !fallback) return null
      return {
        rank: index + 1,
        symbol: stock.symbol,
        name: quote.name || stock.name,
        logo: getStockLogoUrl(stock.symbol),
        price,
        change24h: change,
        change1h: 0,
        change7d: 0,
        marketCap: mcap,
        volume,
        sector: quote.sector || stock.sector || '',
        exchange: quote.exchange || stock.exchange || '',
        pe: quote.pe || (fallback?.pe || null),
        week52High: quote.week52High || null,
        week52Low: quote.week52Low || null,
        marketState: quote.marketState || 'CLOSED',
        _type: 'stock',
      }
    }).filter(Boolean).filter(s => s.price > 0)
    mapped.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
    mapped.forEach((s, i) => { s.rank = i + 1 })
    return mapped
  }, [])

  /* ── Fetch STOCK data - instant fallback + live upgrade ── */
  useEffect(() => {
    if (!isStocks) return
    let cancelled = false

    // 1. Show fallback data IMMEDIATELY (no loading spinner)
    const instant = mapStocksToTokens({})
    if (instant.length > 0) {
      setAllTokens(instant)
      setLoading(false)
    }

    // 2. Try to get live data in background
    const fetchLive = async () => {
      try {
        const stockSymbols = POPULAR_STOCKS.map(s => s.symbol)
        const quotes = await getStockQuotes(stockSymbols)
        if (cancelled) return
        if (Object.keys(quotes).length > 0) {
          const updated = mapStocksToTokens(quotes)
          if (updated.length > 0) {
            setAllTokens(updated)
          }
        }
      } catch (err) {
        // Fallback already displayed, just log
        // silently handled
      } finally {
        // ALWAYS clear the loading shimmer once the live fetch settles, even
        // when the instant fallback was empty. FALLBACK_STOCK_DATA entries can
        // lack price fields (the fabricated prices were stripped server-side),
        // which makes `instant` empty → setLoading(false) never ran (it lived
        // only in the instant block above) → the page stuck on the shimmer
        // showing "0 stocks" forever even though live data had arrived. The
        // live setAllTokens above populates the bubbles; this reveals them.
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    fetchLive()
    return () => { cancelled = true }
  }, [isStocks, mapStocksToTokens])

  // Polling callback for crypto bubble data
  const pollCryptoBubbles = useCallback(async () => {
    const mapCoin = (coin, index, startRank = 1) => ({
      rank: coin.market_cap_rank || (startRank + index),
      symbol: (coin.symbol || '').toUpperCase(),
      name: coin.name || '', logo: coin.image || null,
      price: Number(coin.current_price) || 0,
      change24h: Number(coin.price_change_percentage_24h) || 0,
      change1h: Number(coin.price_change_percentage_1h_in_currency) || 0,
      change7d: Number(coin.price_change_percentage_7d_in_currency) || 0,
      marketCap: Number(coin.market_cap) || 0,
      volume: Number(coin.total_volume) || 0,
      sparkline_7d: Array.isArray(coin.sparkline_in_7d?.price) ? coin.sparkline_in_7d.price : null,
      _type: 'crypto',
    })
    try {
      const wanted = pageRange.end - pageRange.start + 1
      let all
      if (categoryFilter === XDASH_RUNNERS_CATEGORY) {
        // Runners board refresh — same shared 60s-cached fetch, no category proxy.
        const coins = await getXDashRunnerCoins(runnersCount)
        all = (Array.isArray(coins) ? coins : []).map((coin, i) => mapCoin(coin, i, 1))
      } else if (categoryFilter !== 'all') {
        const pageCount = Math.ceil(wanted / 25)
        const promises = []
        for (let p = 1; p <= pageCount; p++) promises.push(getCategoryCoins(categoryFilter, p, 25))
        const results = await Promise.all(promises)
        all = results.flat().slice(0, wanted).map((coin, i) => mapCoin(coin, i, 1))
      } else {
        // Poll refreshes price/marketCap only — sparklines already live in
        // sparklineMap from phase 2, so fetch the smaller no-sparkline payload.
        const apiPage = Math.ceil(pageRange.start / 100)
        const coins = await getSpectreCoinsMarketsPage(apiPage, wanted, { sparkline: false })
        all = (Array.isArray(coins) ? coins : []).slice(0, wanted)
          .map((coin, i) => mapCoin(coin, i, pageRange.start))
      }
      if (all?.length > 0) setAllTokens(all)
    } catch {}
  }, [pageRange, categoryFilter, runnersCount])

  // Polling callback for stock bubble data
  const pollStockBubbles = useCallback(async () => {
    try {
      const stockSymbols = POPULAR_STOCKS.map(s => s.symbol)
      const quotes = await getStockQuotes(stockSymbols)
      if (Object.keys(quotes).length > 0) {
        const updated = mapStocksToTokens(quotes)
        if (updated.length > 0) setAllTokens(updated)
      }
    } catch {}
  }, [mapStocksToTokens])

  // Adaptive polling for bubble data. Crypto bumped 5min → 15min: top-coin
  // market cap / 24h change moves slowly, and the page is sticky enough that
  // 5min was burning CG egress per user. 2026-05-15 cost defense.
  useAdaptivePolling(pollCryptoBubbles, { interval: 15 * 60 * 1000, enabled: !isStocks })
  useAdaptivePolling(pollStockBubbles, { interval: 3 * 60 * 1000, enabled: isStocks })

  // Escape closes fullscreen
  useEffect(() => {
    if (!fullscreen) return
    const handleEsc = (e) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [fullscreen])

  /* ── Container size measurement ── */
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      // contentRect already excludes CSS padding; small inset for visual breathing room
      setContainerSize({ width: width - 4, height: height - 4 })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading, isMobile])

  // Fullscreen arena size
  useLayoutEffect(() => {
    const el = fullscreenArenaRef.current
    if (!el || !fullscreen) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setFsSize({ width, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fullscreen, isMobile])

  /* ── Computed data ── */
  const getChange = useCallback((token) => {
    if (isStocks) return token.change24h || 0
    if (timeframe === '1h') return token.change1h || 0
    if (timeframe === '7d') return token.change7d || 0
    return token.change24h || 0
  }, [timeframe, isStocks])

  // Apply sector filter for stocks
  const filteredTokens = useMemo(() => {
    if (!isStocks || sectorFilter === 'all') return allTokens
    return allTokens.filter(t => t.sector === sectorFilter)
  }, [allTokens, isStocks, sectorFilter])

  const sortedTokens = useMemo(() => {
    let tokens = [...filteredTokens]
    if (sortBy === 'change') {
      tokens.sort((a, b) => Math.abs(getChange(b)) - Math.abs(getChange(a)))
    } else if (sortBy === 'volume') {
      tokens.sort((a, b) => (b.volume || 0) - (a.volume || 0))
    }
    return tokens
  }, [filteredTokens, sortBy, getChange])

  sortedTokensRef.current = sortedTokens

  const packedBubbles = useMemo(() => {
    if (!containerSize.width || !containerSize.height || !sortedTokens.length) return []
    return prepareBubbleNodes(sortedTokens, containerSize.width, containerSize.height)
  }, [sortedTokens, containerSize])

  const fsBubbles = useMemo(() => {
    if (!fsSize.width || !fsSize.height || !sortedTokens.length) return []
    return prepareBubbleNodes(sortedTokens, fsSize.width, fsSize.height)
  }, [sortedTokens, fsSize])

  // ── Helper: create D3 force simulation with organic physics ──
  const createSimulation = useCallback((bubbles, w, h, nodesRef, liveRefTarget, containerElGetter) => {
    const cx = w / 2
    const cy = h / 2

    const nodes = bubbles.map((t, i) => ({
      ...t, index: i, x: t.x, y: t.y, vx: 0, vy: 0,
    }))
    nodesRef.current = nodes

    // Cache DOM nodes for the tick handler — re-query if nodes are detached (stale after React re-render)
    let cachedDomNodes = null
    const getDomNodes = () => {
      // Re-query if cache is stale (nodes detached from DOM)
      if (!cachedDomNodes || !cachedDomNodes[0]?.isConnected) {
        const el = containerElGetter()
        if (el) cachedDomNodes = el.querySelectorAll('.bubble-node')
      }
      return cachedDomNodes
    }

    // mobile: the ~24s settle window (alpha 0.35→0.001 at decay 0.004) burned
    // 60fps of force math + DOM writes on phones — settle ~3x faster with
    // lighter collision; the landed layout is visually identical
    const mobileSim = w < 500
    const sim = forceSimulation(nodes)
      // Very gentle centering — just prevents drift
      .force('x', forceX(cx).strength(0.008))
      .force('y', forceY(cy).strength(0.008))
      // Light repulsion for organic spacing
      .force('charge', forceManyBody().strength(d => -d.radius * 0.25).distanceMax(220))
      // Collision: high iterations prevent overlap
      .force('collide', forceCollide(d => d.radius + 3).strength(1.0).iterations(mobileSim ? 5 : 8))
      .alpha(0.35)
      .alphaDecay(mobileSim ? 0.012 : 0.004)
      .alphaMin(0.001)
      .velocityDecay(0.62)
      .on('tick', () => {
        // Rubber-band boundary: soft spring pulls back instead of hard clamp
        const pad = 2
        const springK = 0.3 // spring stiffness — how fast it pulls back
        for (const node of nodes) {
          const minX = node.radius + pad
          const maxX = w - node.radius - pad
          const minY = node.radius + pad
          const maxY = h - node.radius - pad
          if (node.x < minX) { node.vx += (minX - node.x) * springK; node.x = Math.max(node.x, minX - node.radius * 0.3) }
          else if (node.x > maxX) { node.vx += (maxX - node.x) * springK; node.x = Math.min(node.x, maxX + node.radius * 0.3) }
          if (node.y < minY) { node.vy += (minY - node.y) * springK; node.y = Math.max(node.y, minY - node.radius * 0.3) }
          else if (node.y > maxY) { node.vy += (maxY - node.y) * springK; node.y = Math.min(node.y, maxY + node.radius * 0.3) }
        }
        liveRefTarget.current = nodes.map(n => ({ x: n.x, y: n.y, r: n.radius }))
        // GPU-accelerated positioning via transform: translate3d (cached DOM nodes)
        const domNodes = getDomNodes()
        if (domNodes) {
          for (let i = 0; i < nodes.length && i < domNodes.length; i++) {
            const n = nodes[i]
            domNodes[i].style.transform = `translate3d(${n.x - n.radius}px, ${n.y - n.radius}px, 0)`
          }
        }
      })

    // Staggered opacity entrance — cinematic but SNAPPY. The old version
    // chained one setTimeout per bubble at 22ms apart with 1s fades: on 100
    // bubbles the last one didn't START until ~2.4s and settle landed at
    // ~3.8s — felt like load lag. Now the whole field reveals inside ~1s
    // regardless of count: per-node transition-delay does the staggering
    // natively, one synchronous flip starts it, one timer settles it.
    const staggerTimers = []
    const el = containerElGetter()
    if (el) {
      const domNodes = el.querySelectorAll('.bubble-node')
      const n = Math.max(1, domNodes.length)
      const BASE = 80    // ms before the first bubble
      const WINDOW = 480 // ms across which the field reveals
      const DUR = 450    // ms per-bubble fade
      for (let i = 0; i < domNodes.length; i++) {
        const d = domNodes[i]
        d.style.opacity = '0'
        d.style.transition = `opacity ${DUR}ms cubic-bezier(0.16, 1, 0.3, 1) ${Math.round(BASE + (i / n) * WINDOW)}ms`
      }
      // commit the hidden state so the transition animates from it
      void el.offsetWidth
      for (let i = 0; i < domNodes.length; i++) {
        domNodes[i].style.opacity = '1'
      }
      // After entrance finishes: remove inline transition, add breathing class
      staggerTimers.push(setTimeout(() => {
        for (let i = 0; i < domNodes.length; i++) {
          if (domNodes[i] && domNodes[i].isConnected) {
            domNodes[i].style.transition = ''
            domNodes[i].classList.add('settled')
            // Stagger breathing so bubbles don't pulse in sync
            domNodes[i].style.setProperty('--breathe-delay', `${(i * 0.3) % 4}s`)
          }
        }
      }, BASE + WINDOW + DUR + 120))
    }
    sim._staggerTimers = staggerTimers

    return sim
  }, [])

  // ── Helper: fade out existing bubbles then create new simulation ──
  const transitionSimulation = useCallback((bubbles, w, h, nodesRef, liveRefTarget, containerElGetter, simRefTarget) => {
    const el = containerElGetter()
    const existing = el?.querySelectorAll('.bubble-node')
    const hasExisting = existing && existing.length > 0 && existing[0].style.opacity === '1'

    if (hasExisting) {
      // Fade out current bubbles (fast — this runs on every filter change)
      for (let i = 0; i < existing.length; i++) {
        existing[i].style.transition = 'opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
        existing[i].style.opacity = '0'
        existing[i].classList.remove('settled')
      }
      // After fade-out, stop old sim and create new
      const tid = setTimeout(() => {
        if (simRefTarget.current) {
          simRefTarget.current._staggerTimers?.forEach(clearTimeout)
          simRefTarget.current.stop()
        }
        simRefTarget.current = createSimulation(bubbles, w, h, nodesRef, liveRefTarget, containerElGetter)
      }, 220)
      return () => clearTimeout(tid)
    } else {
      // No existing bubbles — just create directly
      if (simRefTarget.current) {
        simRefTarget.current._staggerTimers?.forEach(clearTimeout)
        simRefTarget.current.stop()
      }
      simRefTarget.current = createSimulation(bubbles, w, h, nodesRef, liveRefTarget, containerElGetter)
      return undefined
    }
  }, [createSimulation])

  // ── D3 force simulation: regular view ──
  useEffect(() => {
    if (viewMode !== 'bubbles' || !packedBubbles.length) {
      if (simRef.current) {
        simRef.current._staggerTimers?.forEach(clearTimeout)
        simRef.current.stop()
        simRef.current = null
      }
      return
    }
    const w = containerSize.width
    const h = containerSize.height
    if (!w || !h) return

    const cleanup = transitionSimulation(packedBubbles, w, h, simNodesRef, liveRef, () => containerRef.current, simRef)
    return () => {
      cleanup?.()
      if (simRef.current) {
        simRef.current._staggerTimers?.forEach(clearTimeout)
        simRef.current.stop()
        simRef.current = null
      }
    }
  }, [packedBubbles, containerSize, viewMode, transitionSimulation])

  // ── D3 force simulation: fullscreen view ──
  useEffect(() => {
    if (viewMode !== 'bubbles' || !fsBubbles.length || !fullscreen) {
      if (fsSimRef.current) {
        fsSimRef.current._staggerTimers?.forEach(clearTimeout)
        fsSimRef.current.stop()
        fsSimRef.current = null
      }
      return
    }
    const w = fsSize.width
    const h = fsSize.height
    if (!w || !h) return

    const cleanup = transitionSimulation(fsBubbles, w, h, fsSimNodesRef, fsLiveRef, () => fullscreenArenaRef.current, fsSimRef)
    return () => {
      cleanup?.()
      if (fsSimRef.current) {
        fsSimRef.current._staggerTimers?.forEach(clearTimeout)
        fsSimRef.current.stop()
        fsSimRef.current = null
      }
    }
  }, [fsBubbles, fsSize, viewMode, fullscreen, transitionSimulation])

  /* ── Bubble drag handlers (integrated with D3 force simulation) ── */
  const handleBubbleGrab = useCallback((e, idx, isFs) => {
    if (viewMode !== 'bubbles') return
    const isTouch = !!(e.touches || e.changedTouches)
    // Ignore the synthesized mousedown that fires ~300ms after a touch tap.
    // Without this guard it would reset wasTouchRef and kill the tooltip.
    if (!isTouch && Date.now() - lastTouchTimeRef.current < 500) return
    // React 18 attaches onTouchStart as passive at the root, so preventDefault
    // is a no-op and warns. Only call it for mouse events where it works.
    if (!isTouch) e.preventDefault()
    e.stopPropagation()
    if (isTouch) lastTouchTimeRef.current = Date.now()
    wasTouchRef.current = isTouch

    const sim = isFs ? fsSimRef.current : simRef.current
    const nodesArr = isFs ? fsSimNodesRef.current : simNodesRef.current
    const node = nodesArr[idx]
    if (!sim || !node) return

    const containerEl = isFs ? fullscreenArenaRef.current : containerRef.current
    const rect = containerEl?.getBoundingClientRect()
    if (!rect) return

    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY

    // Pin node in place — forces stay intact so neighbors hold position
    node.fx = node.x
    node.fy = node.y

    // Gentle reheat so collision responds to the moving node
    sim.alphaTarget(0.05).restart()

    dragRef2.current = {
      active: true, idx, isFs, rect,
      grabX: clientX - rect.left - node.x,
      grabY: clientY - rect.top - node.y,
      prevX: node.x, prevY: node.y, prevTime: performance.now(),
      vx: 0, vy: 0, svx: 0, svy: 0,
      startClientX: clientX, startClientY: clientY,
      draggedYet: false,
    }

    const domNodes = containerEl.querySelectorAll('.bubble-node')
    if (domNodes[idx]) {
      domNodes[idx].classList.add('dragging')
      domNodes[idx].classList.remove('settled')
    }

    // Hide the tooltip when a MOUSE drag starts. On touch we keep it: the tap
    // is opened in the bubble's onTouchEnd below, and clearing here would just
    // flicker it off and on within the same gesture.
    if (!wasTouchRef.current) setHoveredToken(null)
  }, [viewMode])

  // Stable ref so the hoisted onBubbleMouseDown/onBubbleTouchStart handlers
  // (defined above handleBubbleGrab) call the latest version without re-creating.
  const handleBubbleGrabRef = useRef(handleBubbleGrab)
  handleBubbleGrabRef.current = handleBubbleGrab

  useEffect(() => {
    const onMove = (e) => {
      const ds = dragRef2.current
      if (!ds.active) return
      e.preventDefault()

      const nodesArr = ds.isFs ? fsSimNodesRef.current : simNodesRef.current
      const node = nodesArr[ds.idx]
      if (!node) return

      const clientX = e.touches ? e.touches[0].clientX : e.clientX
      const clientY = e.touches ? e.touches[0].clientY : e.clientY

      // First frame past the tap-vs-drag threshold: close any open tooltip so
      // grabbing a different bubble immediately dismisses the previous one.
      if (!ds.draggedYet) {
        const dist = Math.hypot(clientX - ds.startClientX, clientY - ds.startClientY)
        if (dist > 5) {
          ds.draggedYet = true
          setHoveredToken(null)
        }
      }

      // Re-read the container rect each move so a sidebar toggle or window
      // resize mid-drag doesn't strand the bubble at stale coordinates. Fall
      // back to the rect captured at grab time if the container is gone.
      const containerEl = ds.isFs ? fullscreenArenaRef.current : containerRef.current
      const rect = containerEl?.getBoundingClientRect() || ds.rect

      const newX = clientX - rect.left - ds.grabX
      const newY = clientY - rect.top - ds.grabY
      const w = rect.width
      const h = rect.height

      // EMA-smoothed velocity for consistent throws
      const now = performance.now()
      const dt = Math.max(1, now - ds.prevTime)
      const rawVx = ((newX - ds.prevX) / dt) * 16
      const rawVy = ((newY - ds.prevY) / dt) * 16
      const ema = 0.35
      ds.svx = ds.svx * ema + rawVx * (1 - ema)
      ds.svy = ds.svy * ema + rawVy * (1 - ema)
      ds.vx = rawVx
      ds.vy = rawVy
      ds.prevX = newX
      ds.prevY = newY
      ds.prevTime = now

      node.fx = Math.max(node.radius, Math.min(w - node.radius, newX))
      node.fy = Math.max(node.radius, Math.min(h - node.radius, newY))
    }

    const onUp = (e) => {
      const ds = dragRef2.current
      if (!ds.active) return

      const relIdx = ds.idx
      const relFs = ds.isFs
      ds.active = false

      // Detect click (minimal drag distance < 5px)
      const endX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX
      const endY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY
      const dist = Math.hypot(endX - ds.startClientX, endY - ds.startClientY)
      const isClick = dist < 5

      const sim = relFs ? fsSimRef.current : simRef.current
      const nodesArr = relFs ? fsSimNodesRef.current : simNodesRef.current
      const node = nodesArr[relIdx]

      const containerEl = relFs ? fullscreenArenaRef.current : containerRef.current
      const domNodes = containerEl?.querySelectorAll('.bubble-node')
      if (domNodes?.[relIdx]) {
        domNodes[relIdx].classList.remove('dragging')
        domNodes[relIdx].classList.add('settled')
      }

      if (!sim || !node) return

      // Unpin — let forces take over naturally
      node.fx = null
      node.fy = null

      if (isClick && onTokenClickRef.current) {
        const token = sortedTokensRef.current[relIdx]
        // Ask before navigating — dragging/panning the bubble field invites
        // accidental clicks, so the VisitConfirm bar gates the jump to RZ.
        if (token?.symbol) setPendingVisit({ token })
        sim.alphaTarget(0)
        return
      }

      // Gentle throw velocity
      const amp = 1.0
      const maxV = 18
      node.vx = Math.max(-maxV, Math.min(maxV, ds.svx * amp))
      node.vy = Math.max(-maxV, Math.min(maxV, ds.svy * amp))

      // Stop reheating — simulation cools down naturally
      sim.alphaTarget(0)
    }

    document.addEventListener('mousemove', onMove, { passive: false })
    document.addEventListener('mouseup', onUp)
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onUp)
    }
  }, [])

  const stats = useMemo(() => {
    if (!sortedTokens.length) return null
    const total = sortedTokens.length
    // Live (Binance-overlaid) 24h change so gainers/losers/avg track the bubbles
    // instead of lagging on the polled value.
    const liveChange = (token) => {
      if (!isStocks && timeframe === '24h') {
        const live = binancePrices?.[token.symbol] || binancePrices?.[token.symbol?.toUpperCase?.()] || {}
        if (live.change != null) return Number(live.change) || 0
      }
      return getChange(token)
    }
    // Single O(n) pass: gains/sums + best/worst in one reduce
    let gains = 0
    let sumChange = 0
    let totalMcap = 0
    let totalVol = 0
    let best = sortedTokens[0]
    let worst = sortedTokens[0]
    let bestC = liveChange(best)
    let worstC = bestC
    for (let i = 0; i < total; i++) {
      const tok = sortedTokens[i]
      const c = liveChange(tok)
      if (c > 0) gains++
      sumChange += c
      totalMcap += tok.marketCap || 0
      totalVol += tok.volume || 0
      if (c > bestC) { bestC = c; best = tok }
      if (c < worstC) { worstC = c; worst = tok }
    }
    const losses = total - gains
    const avgChange = sumChange / total
    const sentiment = avgChange > 1 ? 'bullish' : avgChange < -1 ? 'bearish' : 'neutral'
    return { total, gains, losses, avgChange, totalMcap, totalVol, best, worst, sentiment }
  }, [sortedTokens, getChange, isStocks, timeframe, binancePrices])

  // ── Liquidity Pulse: money in / money out over the active timeframe ──
  const liquidityFlow = useMemo(
    () => computeLiquidityFlow(sortedTokens, getChange, { topN: 3 }),
    [sortedTokens, getChange]
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
    // Sum the bubbles on screen — same arithmetic as the heatmap. The
    // CoinGecko global aggregate that used to override crypto @24h reads a
    // different clock and contradicted the bubbles beneath it (see
    // heatmaps-page.jsx for the measurement). The whole-market CAP is still
    // shown; only the FLOW is summed from the tape.
    const hasGlobal = !isStocks && globalMetrics?.totalMarketCap > 0
    if (!liquidityFlow || liquidityFlow.coverage <= 0) return null
    const coverageLabel = isStocks
      ? t('heatmaps.liquidityStocks', '{{count}} stocks', { count: liquidityFlow.coverage })
      : t('heatmaps.liquidityTopTokens', 'the top {{count}} tokens', { count: liquidityFlow.coverage })
    return {
      net: liquidityFlow.net,
      coverageLabel,
      contributors: liquidityFlow?.contributors || [],
      totalMarketCap: hasGlobal ? globalMetrics.totalMarketCap : null,
      totalVolume: hasGlobal ? globalMetrics.totalVolume : null,
      changePct: hasGlobal ? globalMetrics.marketCapChange24h : null,
    }
  }, [liquidityFlow, isStocks, timeframe, globalMetrics, sortedTokens.length, t])

  // Whole-market cap for the hero stat — the sum of the shown bubbles
  // understates the true market (top-100 ≈ $1.87T vs the real ~$2.25T).
  const heroTotalMcap = !isStocks && globalMetrics?.totalMarketCap > 0
    ? globalMetrics.totalMarketCap
    : (stats?.totalMcap || 0)

  const activeTimeframes = isStocks ? STOCK_TIMEFRAMES : TIMEFRAMES
  const tfLabel = isStocks ? t('bubbles.today') : (TIMEFRAMES.find(tf => tf.id === timeframe)?.label || '24H')

  // Resolve a category by id and return its localized label (used by canvas/share/JSX)
  const catLabel = useCallback((id) => {
    const c = CRYPTO_CATEGORIES.find(x => x.id === id)
    if (!c) return ''
    return t(c.labelKey, c.fallback)
  }, [t])
  const activeCategoryLabel = !isStocks && categoryFilter !== 'all' ? catLabel(categoryFilter) : ''

  // ── Share bubbles to X ──
  const handleShareBubbles = useCallback(async () => {
    if (isBubblesShareExporting) return
    setIsBubblesShareExporting(true)
    setBubShareImageUrl(null)
    setBubShareModalOpen(true)

    try {
      const tokens = (sortedTokens || []).slice(0, 25)
      const modeLabel = isStocks
        ? t('bubbles.shareModeStock', 'STOCK')
        : t('bubbles.shareModeCrypto', 'CRYPTO')

      {
        const headLine = t('bubbles.shareHeading', '🫧 {{mode}} Bubbles - {{tf}}', { mode: modeLabel, tf: tfLabel })
        const statsBlock = stats
          ? [
              t('bubbles.shareBiggest', 'Biggest: ${{sym}}', { sym: stats.best?.symbol || '' }),
              t('bubbles.shareTop', 'Top: ${{sym}} +{{pct}}%', { sym: stats.best?.symbol || '', pct: formatChange(getChange(stats.best)) }),
              t('bubbles.shareCounts', '{{gains}} gaining · {{losses}} losing', { gains: stats.gains, losses: stats.losses }),
            ].join('\n')
          : ''
        setBubShareDescription(`${headLine}\n\n${statsBlock}\n\n@Spectre__Ai #crypto`)
      }

      // Pre-load token logos + Spectre logo
      const [logoMap, spectreLogo] = await Promise.all([
        preloadLogos(tokens, (t) => t.logo),
        getSpectreLogo(),
      ])

      const dataUrl = renderShareCard(
        (ctx, w, contentTop, c, fonts) => {
          const pad = CARD_PAD
          const areaH = 400
          const centerX = w / 2
          const centerY = contentTop + areaH / 2

          // ── Ambient brand glow behind bubble field ──
          const ambGlow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 260)
          ambGlow.addColorStop(0, c.isLight ? 'rgba(139, 92, 246, 0.025)' : 'rgba(139, 92, 246, 0.05)')
          ambGlow.addColorStop(1, 'transparent')
          ctx.fillStyle = ambGlow
          ctx.fillRect(0, contentTop, w, areaH)

          const maxR = 56
          const minR = 14
          const maxMcap = tokens.reduce((m, t) => (t.marketCap || 0) > m ? (t.marketCap || 0) : m, 0) || 1

          tokens.forEach((token, i) => {
            const mcapRatio = Math.sqrt((token.marketCap || 0) / maxMcap)
            const r = minR + mcapRatio * (maxR - minR)
            const ch = getChange(token)
            const intensity = Math.min(1, Math.abs(ch) / 8)

            // Spiral positioning
            const angle = i * 2.4
            const dist = i === 0 ? 0 : 30 + i * 9.5
            let bx = centerX + Math.cos(angle) * dist
            let by = centerY + Math.sin(angle) * dist
            bx = Math.max(pad + r + 6, Math.min(w - pad - r - 6, bx))
            by = Math.max(contentTop + r + 6, Math.min(contentTop + areaH - r - 6, by))

            const cr = ch >= 0 ? (c.isLight ? 16 : 52) : (c.isLight ? 220 : 248)
            const cg = ch >= 0 ? (c.isLight ? 185 : 211) : (c.isLight ? 38 : 113)
            const cb = ch >= 0 ? (c.isLight ? 129 : 153) : (c.isLight ? 38 : 113)

            // ─ Brand glow aura (outer ring glow) ─
            ctx.save()
            ctx.beginPath()
            ctx.arc(bx, by, r + 10, 0, Math.PI * 2)
            const aura = ctx.createRadialGradient(bx, by, r * 0.6, bx, by, r + 10)
            aura.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${0.06 + intensity * 0.10})`)
            aura.addColorStop(1, 'transparent')
            ctx.fillStyle = aura
            ctx.fill()

            // ─ Drop shadow ─
            ctx.shadowColor = `rgba(0, 0, 0, ${c.isLight ? 0.12 : 0.32})`
            ctx.shadowBlur = 10
            ctx.shadowOffsetX = 1
            ctx.shadowOffsetY = 3

            // ─ Core glass orb - 3-layer background ─
            ctx.beginPath()
            ctx.arc(bx, by, r, 0, Math.PI * 2)
            const coreGrad = ctx.createLinearGradient(bx - r, by - r, bx + r * 0.6, by + r)
            coreGrad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${0.12 + intensity * 0.22})`)
            coreGrad.addColorStop(0.5, `rgba(${cr}, ${cg}, ${cb}, ${0.06 + intensity * 0.12})`)
            coreGrad.addColorStop(1, `rgba(${Math.max(0, cr - 30)}, ${Math.max(0, cg - 30)}, ${Math.max(0, cb - 30)}, ${0.10 + intensity * 0.15})`)
            ctx.fillStyle = coreGrad
            ctx.fill()
            ctx.shadowColor = 'transparent'

            // Bottom-right depth shadow
            ctx.beginPath()
            ctx.arc(bx, by, r, 0, Math.PI * 2)
            const depthGrad = ctx.createRadialGradient(bx + r * 0.22, by + r * 0.32, 0, bx, by, r)
            depthGrad.addColorStop(0, `rgba(0, 0, 0, ${c.isLight ? 0.08 : 0.22})`)
            depthGrad.addColorStop(0.6, 'transparent')
            ctx.fillStyle = depthGrad
            ctx.fill()

            // Specular hot-spot (top-left white crescent)
            ctx.beginPath()
            ctx.arc(bx, by, r, 0, Math.PI * 2)
            const specGrad = ctx.createRadialGradient(bx - r * 0.3, by - r * 0.35, 0, bx - r * 0.05, by - r * 0.05, r * 0.85)
            specGrad.addColorStop(0, c.isLight ? 'rgba(255, 255, 255, 0.50)' : 'rgba(255, 255, 255, 0.22)')
            specGrad.addColorStop(0.3, c.isLight ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.06)')
            specGrad.addColorStop(1, 'transparent')
            ctx.fillStyle = specGrad
            ctx.fill()

            // Secondary rim light (top-right)
            ctx.beginPath()
            ctx.arc(bx, by, r, 0, Math.PI * 2)
            const rimGrad = ctx.createRadialGradient(bx + r * 0.45, by - r * 0.5, 0, bx + r * 0.3, by - r * 0.3, r * 0.5)
            rimGrad.addColorStop(0, c.isLight ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.04)')
            rimGrad.addColorStop(1, 'transparent')
            ctx.fillStyle = rimGrad
            ctx.fill()

            // Bottom ambient reflection
            ctx.beginPath()
            ctx.arc(bx, by, r, 0, Math.PI * 2)
            const bottomRef = ctx.createRadialGradient(bx, by + r * 0.65, 0, bx, by + r * 0.5, r * 0.5)
            bottomRef.addColorStop(0, c.isLight ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.02)')
            bottomRef.addColorStop(1, 'transparent')
            ctx.fillStyle = bottomRef
            ctx.fill()

            // ─ Beveled border ring ─
            ctx.beginPath()
            ctx.arc(bx, by, r, 0, Math.PI * 2)
            ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${0.15 + intensity * 0.20})`
            ctx.lineWidth = 1.5
            ctx.stroke()

            // Top highlight arc
            ctx.beginPath()
            ctx.arc(bx, by, r - 0.5, -Math.PI * 0.85, -Math.PI * 0.15)
            ctx.strokeStyle = c.isLight ? 'rgba(255, 255, 255, 0.30)' : 'rgba(255, 255, 255, 0.10)'
            ctx.lineWidth = 1
            ctx.stroke()

            ctx.restore()

            // ─ Logo + text content ─
            if (r > 16) {
              const sym = (token.symbol || '').toUpperCase()
              const bLogo = logoMap[sym] || logoMap[token.symbol]
              const showLogo = r > 28 && bLogo
              ctx.textAlign = 'center'

              if (showLogo) {
                // Draw logo above text
                const logoS = Math.max(12, Math.min(24, r * 0.44))
                const logoY = by - logoS * 0.6 - 4
                ctx.save()
                ctx.beginPath()
                ctx.arc(bx, logoY, logoS / 2, 0, Math.PI * 2)
                ctx.clip()
                ctx.drawImage(bLogo, bx - logoS / 2, logoY - logoS / 2, logoS, logoS)
                ctx.restore()

                // Symbol below logo
                const fs = Math.max(8, Math.min(12, r * 0.26))
                ctx.font = `700 ${fs}px ${fonts.body}`
                ctx.fillStyle = c.symbol
                ctx.fillText(sym, bx, by + logoS * 0.2 + 2)

                // Change % below symbol
                const fsSmall = Math.max(7, Math.min(10, r * 0.22))
                ctx.font = `600 ${fsSmall}px ${fonts.mono}`
                ctx.fillStyle = ch >= 0 ? c.bull : c.bear
                ctx.fillText(`${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%`, bx, by + logoS * 0.2 + fs + 2)
              } else {
                const fs = Math.max(9, Math.min(15, r * 0.38))
                ctx.font = `700 ${fs}px ${fonts.body}`
                ctx.fillStyle = c.symbol
                ctx.fillText(sym, bx, by - 1)

                const fsSmall = Math.max(7, Math.min(11, r * 0.24))
                ctx.font = `600 ${fsSmall}px ${fonts.mono}`
                ctx.fillStyle = ch >= 0 ? c.bull : c.bear
                ctx.fillText(`${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%`, bx, by + fs * 0.55 + 3)
              }
            }
          })

          return areaH + 16
        },
        {
          title: isStocks
            ? t('bubbles.shareCardTitleStock', 'Stock Bubble Map')
            : t('bubbles.shareCardTitleCrypto', 'Crypto Bubble Map'),
          badges: [
            { text: tfLabel, filled: false },
            { text: t('bubbles.shareBadge', 'BUBBLES'), filled: true },
          ],
          subtitle: t('bubbles.shareSubtitle', 'Top {{count}}', { count: tokens.length }),
          logo: spectreLogo,
        },
      )
      setBubShareImageUrl(dataUrl)
    } catch (err) {
      console.error('Bubbles share failed:', err)
      setBubShareModalOpen(false)
    }
    setIsBubblesShareExporting(false)
  }, [isBubblesShareExporting, sortedTokens, isStocks, tfLabel, stats, getChange, t])

  /* ── Get market state badge for stocks ── */
  const marketStateBadge = useMemo(() => {
    if (!isStocks || !allTokens.length) return null
    const state = allTokens[0]?.marketState || 'CLOSED'
    const labels = { REGULAR: t('bubbles.marketOpen'), PRE: t('bubbles.preMarket'), POST: t('bubbles.afterHours'), CLOSED: t('bubbles.marketClosed') }
    const colors = { REGULAR: 'val-green', PRE: 'val-yellow', POST: 'val-yellow', CLOSED: 'val-dim' }
    return { label: labels[state] || t('bubbles.marketClosed', 'Closed'), color: colors[state] || 'val-dim' }
  }, [isStocks, allTokens, t])

  /* ── Render bubbles ── */
  const renderBubbles = useCallback((bubbles, isFs) => {
    const livePos = isFs ? fsLiveRef.current : liveRef.current
    // Reset this arena's hover-payload slot; rebuilt below per node so the stable
    // handlers can look up {token, livePrice, change} by index.
    const payloadSlot = []
    nodePayloadRef.current[isFs ? 'fs' : 'main'] = payloadSlot

    return (
      <div
        className="bubbles-arena"
        onTouchStart={(e) => { if (e.target === e.currentTarget) setHoveredToken(null) }}
      >
        {bubbles.map((token, idx) => {
          // Use live position if available (for drag), else packed position
          const pos = livePos[idx]
          const px = pos ? pos.x : token.x
          const py = pos ? pos.y : token.y
          // Live price: for crypto use Binance, for stocks use fetched data directly
          let livePrice, liveChange24h
          if (isStocks) {
            livePrice = token.price
            liveChange24h = token.change24h
          } else {
            const liveData = binancePrices?.[token.symbol] || binancePrices?.[token.symbol?.toUpperCase?.()] || {}
            livePrice = liveData.price > 0 ? liveData.price : token.price
            liveChange24h = liveData.change != null ? liveData.change : token.change24h
          }
          const change = (isStocks || timeframe === '24h') ? (Number(liveChange24h) || 0) : getChange(token)
          const absChange = Math.abs(change)
          const isPositive = change >= 0
          const intensity = Math.min(1, absChange / (isStocks ? 5 : 10))

          // Day mode reads on white — needs bolder day-green/red + a higher
          // alpha floor so bubbles aren't washed-out pastels.
          const cr = isPositive
            ? (dayMode ? '5, 150, 105' : '16, 185, 129')
            : (dayMode ? '220, 38, 38' : '239, 68, 68')

          const baseAlpha = dayMode ? 0.70 + intensity * 0.25 : 0.15 + intensity * 0.40
          const topAlpha = dayMode ? baseAlpha * 0.90 : Math.max(0.06, baseAlpha * 0.5)
          const bottomAlpha = Math.min(1, baseAlpha + 0.10)
          const bgColor = `rgba(${cr}, ${baseAlpha.toFixed(3)})`
          const bgTop = `rgba(${cr}, ${topAlpha.toFixed(3)})`
          const bgBottom = `rgba(${cr}, ${bottomAlpha.toFixed(3)})`
          const borderColor = `rgba(${cr}, ${((dayMode ? 0.48 : 0.20) + intensity * 0.30).toFixed(3)})`

          let brandRgb
          if (isStocks) {
            brandRgb = SECTOR_COLORS[token.sector] || DEFAULT_SECTOR_COLOR
          } else {
            const rowColors = TOKEN_ROW_COLORS[(token.symbol || '').toUpperCase()]
            brandRgb = rowColors?.bg || '255, 255, 255'
          }

          const r = token.radius || 30
          const showLogo = r > 28
          const showChange = r > 32
          const showName = r > 55
          const showSector = isStocks && r > 65
          const spark = sparklineMap[token.symbol] || token.sparkline_7d

          // Stash the per-node hover payload; the stable handlers read it by index.
          payloadSlot[idx] = { token, livePrice, change }

          return (
            <BubbleNode
              key={token.symbol || idx}
              idx={idx}
              isFs={isFs}
              token={token}
              isStocks={isStocks}
              r={r}
              px={px}
              py={py}
              change={change}
              isPositive={isPositive}
              bgColor={bgColor}
              bgTop={bgTop}
              bgBottom={bgBottom}
              borderColor={borderColor}
              brandRgb={brandRgb}
              showLogo={showLogo}
              showChange={showChange}
              showName={showName}
              showSector={showSector}
              spark={spark}
              onMouseDown={onBubbleMouseDown}
              onTouchStart={onBubbleTouchStart}
              onTouchEnd={onBubbleTouchEnd}
              onMouseEnter={onBubbleMouseEnter}
              onMouseMove={onBubbleMouseMove}
              onMouseLeave={onBubbleMouseLeave}
            />
          )
        })}
      </div>
    )
  }, [binancePrices, timeframe, getChange, isStocks, sparklineMap, dayMode,
      onBubbleMouseDown, onBubbleTouchStart, onBubbleTouchEnd,
      onBubbleMouseEnter, onBubbleMouseMove, onBubbleMouseLeave])

  /* ── Tooltip ── */
  const renderTooltip = () => {
    if (!hoveredToken) return null
    const ht = hoveredToken
    const isPositive = (ht.change || 0) >= 0
    const priceFormatter = fmtPrice
    // When the VisitConfirm bar is up (a bubble was tapped), keep the price card
    // clear of it. Both appear on the same tap, and a low-bubble tap otherwise
    // clamps the card to the bottom edge - burying the "Visit" CTA underneath.
    // Reserve = the bar's bottom offset + height + gap (mobile clears the docked
    // bottom nav; see visit-confirm.css). Card sits above it instead.
    const visitBarReserve = pendingVisit ? (window.innerWidth <= 768 ? 176 : 96) : 0

    return createPortal(
      <div
        className={`bubble-tooltip ${dayMode ? 'day-mode' : ''} ${isStocks ? 'stock-tooltip' : ''}`}
        style={{
          position: 'fixed',
          left: Math.min(tooltipPos.x + 16, window.innerWidth - 280),
          top: Math.min(tooltipPos.y - 10, window.innerHeight - 240 - visitBarReserve),
          zIndex: 99999,
          // Desktop tooltip follows the cursor and must stay click-through so the
          // hover under it keeps firing. On mobile it's tap-driven and static, so
          // make it swallow the tap to close - otherwise the tap falls through to
          // a bubble behind and instantly re-opens the card.
          pointerEvents: isMobile ? 'auto' : 'none',
          cursor: isMobile ? 'pointer' : undefined,
        }}
        onPointerDown={isMobile ? (e) => { e.stopPropagation(); setHoveredToken(null) } : undefined}
      >
        <div className="bubble-tooltip-header">
          {ht.logo && <img src={ht.logo} alt="" className="bubble-tooltip-logo" />}
          <div>
            <div className="bubble-tooltip-name">{ht.name}</div>
            <div className="bubble-tooltip-rank">
              {isStocks ? (
                <>{ht.symbol} · {ht.exchange || 'NYSE'}</>
              ) : (
                <>#{ht.rank} · {ht.symbol}</>
              )}
            </div>
          </div>
        </div>
        <div className="bubble-tooltip-grid">
          <div className="bubble-tooltip-row">
            <span>{t('common.price')}</span><span>{priceFormatter(ht.livePrice || ht.price)}</span>
          </div>
          <div className="bubble-tooltip-row">
            <span>{tfLabel} {t('heatmaps.change')}</span>
            <span className={isPositive ? 'pos' : 'neg'}>
              {isPositive ? '+' : ''}{formatChange(ht.change)}%
            </span>
          </div>
          <div className="bubble-tooltip-row">
            <span>{t('common.marketCap')}</span><span>{fmtLarge(ht.marketCap)}</span>
          </div>
          <div className="bubble-tooltip-row">
            <span>{isStocks ? t('common.volume') : t('common.volume24h')}</span><span>{fmtLarge(ht.volume)}</span>
          </div>
          {isStocks && ht.pe && (
            <div className="bubble-tooltip-row">
              <span>{t('bubbles.peRatio')}</span><span>{typeof ht.pe === 'number' ? ht.pe.toFixed(1) : '-'}</span>
            </div>
          )}
          {isStocks && ht.sector && (
            <div className="bubble-tooltip-row">
              <span>{t('heatmaps.sector')}</span>
              <span style={{ color: `rgb(${SECTOR_COLORS[ht.sector] || DEFAULT_SECTOR_COLOR})` }}>{ht.sector}</span>
            </div>
          )}
        </div>
      </div>,
      document.body
    )
  }

  /* ── Render the Spectre Cosmos (lazy WebGL universe) ── */
  const renderCosmos = () => (
    <Suspense fallback={<div className="cosmos-fallback" />}>
      <CosmosView
        tokens={sortedTokens}
        getChange={getChange}
        tfLabel={tfLabel}
        isStocks={isStocks}
        dayMode={dayMode}
        isMobile={isMobile}
        fmtPrice={fmtPrice}
        fmtLarge={fmtLarge}
        onTokenClick={onTokenClick}
        livePricesRef={binancePricesRef}
        sparklineMap={sparklineMap}
        t={t}
      />
    </Suspense>
  )

  /* ── View Toggle ── */
  const viewToggle = (
    <div className="bubbles-view-toggle">
      <button
        className={`bubbles-pill ${viewMode === 'bubbles' ? 'active' : ''}`} aria-pressed={viewMode === 'bubbles'}
        onClick={() => setViewMode('bubbles')}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="9" r="5"/><circle cx="18" cy="16" r="4"/><circle cx="7" cy="19" r="3"/>
        </svg>
        {t('bubbles.view.bubbles', 'Bubbles')}
      </button>
      <button
        className={`bubbles-pill ${viewMode === 'cosmos' ? 'active' : ''}`} aria-pressed={viewMode === 'cosmos'}
        onClick={() => setViewMode('cosmos')}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <ellipse cx="12" cy="12" rx="9" ry="4" strokeOpacity="0.5"/>
          <circle cx="19.5" cy="9.5" r="1.5"/>
        </svg>
        {t('bubbles.view.cosmos', 'Cosmos')}
      </button>
    </div>
  )

  /* ── Fullscreen button ── */
  const rangeSelector = (
    <select
      className="bubbles-range-select"
      aria-label={t('bubbles.tokenRange', 'Token range')}
      value={pageRange.id}
      onChange={(event) => {
        const next = PAGE_RANGES.find(range => range.id === Number(event.target.value))
        if (next) setPageRange(next)
      }}
    >
      {PAGE_RANGES.map(range => (
        <option key={range.id} value={range.id}>{range.label}</option>
      ))}
    </select>
  )

  const fullscreenBtn = (
    <button className="bubble-fullscreen-btn" onClick={() => setFullscreen(f => !f)} title={fullscreen ? t('bubbles.exitFullscreen') : t('bubbles.fullscreen')}>
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

  /* ════════════════════════════════════════════
     MOBILE LAYOUT
     ════════════════════════════════════════════ */
  if (isMobile && !compact) {
    return (
      <div className={`bubbles-page mbb-page${dayMode ? ' day-mode' : ''}${isStocks ? ' stocks-mode' : ''}${viewMode === 'cosmos' ? ' cosmos-active' : ''}`}>
        <div className="mbb-content">
          <div className="mbb-header-spacer" aria-hidden="true" />

          {/* Section label + stats */}
          <div className="mbb-section">
            {/* View switch lives in the title row so bubbles/cosmos/fullscreen
                are visible the instant the page opens — buried at the end of the
                scroll pills they were effectively undiscoverable. */}
            <div className="mbb-title-row">
              <span className="mbb-section-label">
                {isStocks ? t('bubbles.stockBubbles') : t('bubbles.cryptoBubbles')}
              </span>
              <div className="mbb-views" role="group" aria-label="View mode">
                <button className={`mbb-view-btn${viewMode === 'bubbles' ? ' active' : ''}`} aria-pressed={viewMode === 'bubbles'} aria-label="Bubbles view" onClick={() => setViewMode('bubbles')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="9" cy="9" r="5"/><circle cx="18" cy="16" r="4"/><circle cx="7" cy="19" r="3"/>
                  </svg>
                </button>
                <button className={`mbb-view-btn${viewMode === 'cosmos' ? ' active' : ''}`} aria-pressed={viewMode === 'cosmos'} aria-label="Cosmos view" onClick={() => setViewMode('cosmos')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <circle cx="12" cy="12" r="8" strokeDasharray="3 3" strokeOpacity="0.4"/>
                    <circle cx="19" cy="8" r="1.5"/><circle cx="5" cy="16" r="1.5"/>
                  </svg>
                </button>
                <button className="mbb-view-btn" aria-label="Fullscreen" onClick={() => setFullscreen(true)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="mbb-hero">
              <span className="mbb-subtitle">
                {isStocks
                  ? `${sectorFilter === 'all' ? t('bubbles.allSectors') : sectorFilter} · ${sortedTokens.length}`
                  : isRunnersMode
                    ? `${activeCategoryLabel} · ${sortedTokens.length}`
                    : categoryFilter !== 'all'
                      ? `${activeCategoryLabel} · ${sortedTokens.length}`
                      : `${pageRange.label} · ${tfLabel}`}
              </span>
            </div>

            {stats && (
              <div className="mbb-stats">
                {isStocks && marketStateBadge && (
                  <div className={`mbb-stat-badge ${marketStateBadge.color}`}>
                    <span className="mbb-stat-dot" />
                    {marketStateBadge.label}
                  </div>
                )}
                {!isStocks && (
                  <div className={`mbb-stat-badge mbb-sentiment-${stats.sentiment}`}>
                    <span className="mbb-stat-dot" />
                    {t(`bubbles.sentiment.${stats.sentiment}`, stats.sentiment.toUpperCase())}
                  </div>
                )}
                <div className="mbb-stat">
                  <span className="mbb-stat-label">{t('heatmaps.totalMcap')}</span>
                  <span className="mbb-stat-value">{fmtLarge(heroTotalMcap)}</span>
                </div>
                <div className="mbb-stat">
                  <span className="mbb-stat-label">{t('heatmaps.avg')} {tfLabel}</span>
                  <span className={`mbb-stat-value ${stats.avgChange >= 0 ? 'pos' : 'neg'}`}>
                    {stats.avgChange >= 0 ? '+' : ''}{stats.avgChange.toFixed(2)}%
                  </span>
                </div>
                <div className="mbb-stat">
                  <span className="mbb-stat-label">{t('common.gainers')}</span>
                  <span className="mbb-stat-value pos">{stats.gains}</span>
                </div>
                <div className="mbb-stat">
                  <span className="mbb-stat-label">{t('common.losers')}</span>
                  <span className="mbb-stat-value neg">{stats.losses}</span>
                </div>
              </div>
            )}
          </div>

          {/* Controls - horizontal scroll pills */}
          <div className="mbb-section-flush">
            <div className="mbb-controls">
              <div className="mbb-pills-row">
                {/* Runners carry only a 24h change — show a locked 24H chip
                    instead of dead timeframe pills. */}
                {isRunnersMode ? (
                  <button className="mbb-pill active" disabled>24H</button>
                ) : (
                  activeTimeframes.map(tf => (
                    <button key={tf.id} className={`mbb-pill${timeframe === tf.id ? ' active' : ''}`}
                            onClick={() => setTimeframe(tf.id)}>
                      {tf.labelKey ? t(tf.labelKey) : tf.label}
                    </button>
                  ))
                )}
                <span className="mbb-pill-divider" />
                {!isStocks && categoryFilter === 'all' && rangeSelector}
                {isRunnersMode && RUNNERS_COUNTS.map(n => (
                  <button key={n} className={`mbb-pill${runnersCount === n ? ' active' : ''}`}
                          onClick={() => setRunnersCount(n)}>
                    {n}
                  </button>
                ))}
                <span className="mbb-pill-divider" />
                {SORT_OPTIONS.map(s => (
                  <button key={s.id} className={`mbb-pill${sortBy === s.id ? ' active' : ''}`}
                          onClick={() => setSortBy(s.id)}>
                    {t(s.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            {/* Category / Sector row */}
            <div className="mbb-controls">
              <div className="mbb-pills-row">
                {isStocks ? (
                  STOCK_SECTOR_FILTERS.map(sf => (
                    <button key={sf.id} className={`mbb-pill${sectorFilter === sf.id ? ' active' : ''}`}
                            onClick={() => setSectorFilter(sf.id)}>
                      {t(sf.labelKey)}
                    </button>
                  ))
                ) : (
                  CRYPTO_CATEGORIES.map(cat => (
                    <button key={cat.id} className={`mbb-pill${categoryFilter === cat.id ? ' active' : ''}`}
                            onClick={() => { setCategoryFilter(cat.id); if (cat.id !== 'all') setPageRange(PAGE_RANGES[0]) }}>
                      {t(cat.labelKey, cat.fallback)}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Visualization */}
          <div className="mbb-section-flush">
            {loading ? (
              <div className="mbb-loading">
                <div className="mbb-loading-shimmer" />
                <div className="mbb-loading-shimmer mbb-loading-shimmer-2" />
              </div>
            ) : error ? (
              <div className="mbb-error">
                <span>{error}</span>
                <button type="button" onClick={() => window.location.reload()}>{t('common.retry')}</button>
              </div>
            ) : (
              <div className={`bubbles-container${viewMode === 'cosmos' ? ' cosmos-mode' : ''}`} ref={containerRef}>
                {viewMode === 'cosmos'
                  ? (!fullscreen && renderCosmos())
                  : renderBubbles(packedBubbles, false)}
              </div>
            )}
          </div>

          {/* Top Movers */}
          {stats && stats.best && (
            <div className="mbb-section">
              <div className="mbb-movers">
                <div className="mbb-mover">
                  <span className="mbb-mover-label">{t('heatmaps.topGainer')}</span>
                  <span className="mbb-mover-token">
                    {stats.best.logo && <img src={stats.best.logo} alt="" className="mbb-mover-logo" />}
                    {stats.best.symbol}
                  </span>
                  <span className="mbb-mover-change pos">+{formatChange(getChange(stats.best))}%</span>
                </div>
                <div className="mbb-mover">
                  <span className="mbb-mover-label">{t('heatmaps.topLoser')}</span>
                  <span className="mbb-mover-token">
                    {stats.worst.logo && <img src={stats.worst.logo} alt="" className="mbb-mover-logo" />}
                    {stats.worst.symbol}
                  </span>
                  <span className="mbb-mover-change neg">{formatChange(getChange(stats.worst))}%</span>
                </div>
                <div className="mbb-mover">
                  <span className="mbb-mover-label">{isStocks ? t('common.volume') : t('common.volume24h')}</span>
                  <span className="mbb-mover-val">{fmtLarge(stats.totalVol)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="mbb-bottom-spacer" />
        </div>

        <VisitConfirm
          token={pendingVisit?.token}
          destLabel={t('nav.researchZone', 'Research Zone')}
          onConfirm={confirmPendingVisit}
          onCancel={cancelPendingVisit}
        />

        {/* Fullscreen Portal - reuse desktop */}
        {fullscreen && createPortal(
          <div className={`bubbles-fullscreen-overlay${viewMode === 'cosmos' ? ' cosmos-fs' : ''}`} onClick={() => setFullscreen(false)}>
            <div className={`bubbles-fullscreen-container ${dayMode ? 'day-mode' : ''} ${isStocks ? 'stocks-mode' : ''} ${viewMode === 'cosmos' ? 'cosmos-mode' : ''}`} onClick={(e) => e.stopPropagation()}>
              <div className="bubbles-fullscreen-toolbar">
                <div className="bubbles-fullscreen-controls">
                  {viewToggle}
                  {isRunnersMode ? (
                    <button className="bubbles-pill active" disabled>24H</button>
                  ) : (
                    activeTimeframes.map(tf => (
                      <button key={tf.id} className={`bubbles-pill ${timeframe === tf.id ? 'active' : ''}`}
                              onClick={() => setTimeframe(tf.id)}>{tf.labelKey ? t(tf.labelKey) : tf.label}</button>
                    ))
                  )}
                  {isStocks ? (
                    STOCK_SECTOR_FILTERS.slice(0, 5).map(sf => (
                      <button key={sf.id} className={`bubbles-pill ${sectorFilter === sf.id ? 'active' : ''}`}
                              onClick={() => setSectorFilter(sf.id)}>{t(sf.labelKey)}</button>
                    ))
                  ) : (
                    CRYPTO_CATEGORIES.slice(0, 5).map(cat => (
                      <button key={cat.id} className={`bubbles-pill ${categoryFilter === cat.id ? 'active' : ''}`}
                              onClick={() => { setCategoryFilter(cat.id); if (cat.id !== 'all') setPageRange(PAGE_RANGES[0]) }}>{t(cat.labelKey, cat.fallback)}</button>
                    ))
                  )}
                  {!isStocks && categoryFilter === 'all' && rangeSelector}
                  {isRunnersMode && RUNNERS_COUNTS.map(n => (
                    <button key={n} className={`bubbles-pill ${runnersCount === n ? 'active' : ''}`}
                            onClick={() => setRunnersCount(n)}>{n}</button>
                  ))}
                  {fullscreenBtn}
                </div>
              </div>
              <div className={`bubbles-fullscreen-arena${viewMode === 'cosmos' ? ' cosmos-mode' : ''}`} ref={fullscreenArenaRef}>
                {viewMode === 'cosmos'
                  ? renderCosmos()
                  : (fsBubbles.length > 0 && renderBubbles(fsBubbles, true))}
              </div>
            </div>
          </div>,
          document.body
        )}

        {renderTooltip()}
        {bubShareModalOpen && (
          <Suspense fallback={null}>
            <ShareXModal
              open={bubShareModalOpen}
              onClose={() => { setBubShareModalOpen(false); setBubShareImageUrl(null) }}
              imageUrl={bubShareImageUrl}
              defaultDescription={bubShareDescription}
              filename={`spectre_bubbles_${tfLabel.toLowerCase()}.png`}
            />
          </Suspense>
        )}
      </div>
    )
  }

  /* ════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════ */
  return (
    <div className={`bubbles-page ${dayMode ? 'day-mode' : ''} ${isStocks ? 'stocks-mode' : ''} ${compact ? 'compact' : ''} ${viewMode === 'cosmos' ? 'cosmos-active' : ''}`}>
      {/* Hero */}
      {!compact && <div className="bubbles-hero">
        <div className="bubbles-hero-inner">
          <div className="bubbles-hero-left">
            <h1 className="bubbles-title">
              <span className="bubbles-title-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" /><circle cx="19" cy="5" r="2.5" />
                </svg>
              </span>
              {isStocks ? t('bubbles.stockBubbles') : t('bubbles.cryptoBubbles')}
            </h1>
            <p className="bubbles-subtitle">
              {isStocks
                ? `${sectorFilter === 'all' ? t('bubbles.allSectors') : sectorFilter} · ${sortedTokens.length} ${t('nav.stocks').toLowerCase()} · ${t('bubbles.realTime')}`
                : categoryFilter !== 'all'
                  ? t('bubbles.subtitleCategory', '{{cat}} · {{count}} tokens · {{tf}} performance', { cat: activeCategoryLabel, count: sortedTokens.length, tf: tfLabel })
                  : t('bubbles.subtitleTop', 'Top {{range}} tokens by market cap · {{tf}} performance', { range: pageRange.label, tf: tfLabel })
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
            <div className="bubbles-hero-stats">
              {isStocks && marketStateBadge && (
                <div className={`bubbles-market-state ${marketStateBadge.color}`}>
                  <span className="bubbles-market-state-dot" />
                  {marketStateBadge.label}
                </div>
              )}
              {!isStocks && (
                <div className={`bubbles-sentiment-badge bias-${stats.sentiment}`}>
                  <span className="bubbles-sentiment-dot" />
                  {t(`bubbles.sentiment.${stats.sentiment}`, stats.sentiment.toUpperCase())}
                </div>
              )}
              <div className="bubbles-hero-stat">
                <span className="bubbles-hero-stat-val">{fmtLarge(heroTotalMcap)}</span>
                <span className="bubbles-hero-stat-lbl">{t('heatmaps.totalMcap')}</span>
              </div>
              <div className="bubbles-hero-stat">
                <span className={`bubbles-hero-stat-val ${stats.avgChange >= 0 ? 'val-green' : 'val-red'}`}>
                  {stats.avgChange >= 0 ? '+' : ''}{stats.avgChange.toFixed(2)}%
                </span>
                <span className="bubbles-hero-stat-lbl">{t('heatmaps.avg')} {tfLabel}</span>
              </div>
              <div className="bubbles-hero-stat">
                <span className="bubbles-hero-stat-val val-green">{stats.gains}</span>
                <span className="bubbles-hero-stat-lbl">{t('common.gainers')}</span>
              </div>
              <div className="bubbles-hero-stat">
                <span className="bubbles-hero-stat-val val-red">{stats.losses}</span>
                <span className="bubbles-hero-stat-lbl">{t('common.losers')}</span>
              </div>
            </div>
          )}
        </div>
      </div>}

      {/* Controls */}
      {!compact && <div className="bubbles-controls">
        {/* Row 1: Timeframe + Range + Sort + actions */}
        <div className="bubbles-controls-row">
          <div className="bubbles-pill-group">
            <span className="bubbles-pill-label">{t('heatmaps.timeframe')}</span>
            <div className="bubbles-pills">
              {/* Runners carry only a 24h change — locked 24H chip. */}
              {isRunnersMode ? (
                <button className="bubbles-pill active" disabled>24H</button>
              ) : (
                activeTimeframes.map(tf => (
                  <button key={tf.id} className={`bubbles-pill ${timeframe === tf.id ? 'active' : ''}`}
                          onClick={() => setTimeframe(tf.id)}>{tf.labelKey ? t(tf.labelKey) : tf.label}</button>
                ))
              )}
            </div>
          </div>
          {!isStocks && categoryFilter === 'all' && (
            <div className="bubbles-pill-group">
              <span className="bubbles-pill-label">{t('bubbles.range')}</span>
              <div className="bubbles-pills">
                {rangeSelector}
              </div>
            </div>
          )}
          {isRunnersMode && (
            <div className="bubbles-pill-group">
              <span className="bubbles-pill-label">{t('bubbles.range')}</span>
              <div className="bubbles-pills">
                {RUNNERS_COUNTS.map(n => (
                  <button key={n} className={`bubbles-pill ${runnersCount === n ? 'active' : ''}`}
                          onClick={() => setRunnersCount(n)}>{n}</button>
                ))}
              </div>
            </div>
          )}
          <div className="bubbles-pill-group">
            <span className="bubbles-pill-label">{t('heatmaps.sort')}</span>
            <div className="bubbles-pills">
              {SORT_OPTIONS.map(s => (
                <button key={s.id} className={`bubbles-pill ${sortBy === s.id ? 'active' : ''}`}
                        onClick={() => setSortBy(s.id)}>{t(s.labelKey)}</button>
              ))}
            </div>
          </div>
          <div className="bubbles-controls-right">
            {viewMode !== 'cosmos' && (
              <ShareXButton onClick={handleShareBubbles} isExporting={isBubblesShareExporting} compact />
            )}
            {viewToggle}
            {fullscreenBtn}
          </div>
        </div>
        {/* Row 2: Category / Sector */}
        <div className="bubbles-controls-row bubbles-category-row">
          {isStocks ? (
            <div className="bubbles-pill-group">
              <span className="bubbles-pill-label">{t('heatmaps.sector')}</span>
              <div className="bubbles-pills">
                {STOCK_SECTOR_FILTERS.map(sf => (
                  <button key={sf.id} className={`bubbles-pill ${sectorFilter === sf.id ? 'active' : ''}`}
                          onClick={() => setSectorFilter(sf.id)}>{t(sf.labelKey)}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="bubbles-pill-group">
              <span className="bubbles-pill-label">{t('categories.category')}</span>
              <div className="bubbles-pills">
                {CRYPTO_CATEGORIES.map(cat => (
                  <button key={cat.id} className={`bubbles-pill ${categoryFilter === cat.id ? 'active' : ''}`}
                          onClick={() => { setCategoryFilter(cat.id); if (cat.id !== 'all') setPageRange(PAGE_RANGES[0]) }}>{t(cat.labelKey, cat.fallback)}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>}

      {/* Visualization */}
      {loading ? (
        <div className="bubbles-loading">
          <div className="bubbles-skeleton" />
        </div>
      ) : error ? (
        <div className="bubbles-error">
          <span>{error}</span>
          <button type="button" onClick={() => window.location.reload()}>{t('common.retry')}</button>
        </div>
      ) : (
        <div className={`bubbles-container${viewMode === 'cosmos' ? ' cosmos-mode' : ''}`} ref={containerRef}>
          {viewMode === 'cosmos'
            ? (!fullscreen && renderCosmos())
            : renderBubbles(packedBubbles, false)}
        </div>
      )}

      {/* Top Movers Strip */}
      {!compact && stats && stats.best && (
        <div className="bubbles-movers">
          <div className="bubbles-mover-item">
            <span className="bubbles-mover-label">{t('heatmaps.topGainer')}</span>
            <span className="bubbles-mover-token">
              {stats.best.logo && <img src={stats.best.logo} alt="" className="bubbles-mover-logo" />}
              {stats.best.symbol}
            </span>
            <span className="bubbles-mover-change pos">+{formatChange(getChange(stats.best))}%</span>
          </div>
          <div className="bubbles-movers-divider" />
          <div className="bubbles-mover-item">
            <span className="bubbles-mover-label">{t('heatmaps.topLoser')}</span>
            <span className="bubbles-mover-token">
              {stats.worst.logo && <img src={stats.worst.logo} alt="" className="bubbles-mover-logo" />}
              {stats.worst.symbol}
            </span>
            <span className="bubbles-mover-change neg">{formatChange(getChange(stats.worst))}%</span>
          </div>
          <div className="bubbles-movers-divider" />
          <div className="bubbles-mover-item">
            <span className="bubbles-mover-label">{isStocks ? t('common.volume') : t('common.volume24h')}</span>
            <span className="bubbles-mover-val">{fmtLarge(stats.totalVol)}</span>
          </div>
        </div>
      )}

      <VisitConfirm
        token={pendingVisit?.token}
        destLabel={t('nav.researchZone', 'Research Zone')}
        onConfirm={confirmPendingVisit}
        onCancel={cancelPendingVisit}
      />

      {/* Fullscreen Portal */}
      {!compact && fullscreen && createPortal(
        <div className={`bubbles-fullscreen-overlay${viewMode === 'cosmos' ? ' cosmos-fs' : ''}`} onClick={() => setFullscreen(false)}>
          <div className={`bubbles-fullscreen-container ${dayMode ? 'day-mode' : ''} ${isStocks ? 'stocks-mode' : ''} ${viewMode === 'cosmos' ? 'cosmos-mode' : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className="bubbles-fullscreen-toolbar">
              <span className="bubbles-fullscreen-title">
                {viewMode === 'cosmos'
                  ? (isStocks
                      ? t('bubbles.cosmos.fsTitleStock', 'Spectre Stock Cosmos')
                      : t('bubbles.cosmos.fsTitle', 'Spectre Cosmos'))
                  : isStocks
                    ? t('bubbles.fsTitleStockBubbles', 'Spectre Stock Bubbles')
                    : categoryFilter !== 'all'
                      ? t('bubbles.fsTitleBubblemap', 'Spectre Bubblemap · {{cat}}', { cat: activeCategoryLabel })
                      : t('bubbles.fsTitleMarketBubblemap', 'Spectre Market Bubblemap · Top {{range}}', { range: pageRange.label })}
              </span>
              <div className="bubbles-fullscreen-controls">
                {viewToggle}
                <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
                {isRunnersMode ? (
                  <button className="bubbles-pill active" disabled>24H</button>
                ) : (
                  activeTimeframes.map(tf => (
                    <button key={tf.id} className={`bubbles-pill ${timeframe === tf.id ? 'active' : ''}`}
                            onClick={() => setTimeframe(tf.id)}>{tf.labelKey ? t(tf.labelKey) : tf.label}</button>
                  ))
                )}
                <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
                {isStocks ? (
                  STOCK_SECTOR_FILTERS.slice(0, 5).map(sf => (
                    <button key={sf.id} className={`bubbles-pill ${sectorFilter === sf.id ? 'active' : ''}`}
                            onClick={() => setSectorFilter(sf.id)}>{t(sf.labelKey)}</button>
                  ))
                ) : (
                  <>
                    {CRYPTO_CATEGORIES.map(cat => (
                      <button key={cat.id} className={`bubbles-pill ${categoryFilter === cat.id ? 'active' : ''}`}
                              onClick={() => { setCategoryFilter(cat.id); if (cat.id !== 'all') setPageRange(PAGE_RANGES[0]) }}>{t(cat.labelKey, cat.fallback)}</button>
                    ))}
                    {categoryFilter === 'all' && (
                      <>
                        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
                        {rangeSelector}
                      </>
                    )}
                    {isRunnersMode && (
                      <>
                        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
                        {RUNNERS_COUNTS.map(n => (
                          <button key={n} className={`bubbles-pill ${runnersCount === n ? 'active' : ''}`}
                                  onClick={() => setRunnersCount(n)}>{n}</button>
                        ))}
                      </>
                    )}
                  </>
                )}
                {fullscreenBtn}
              </div>
            </div>
            <div className={`bubbles-fullscreen-arena${viewMode === 'cosmos' ? ' cosmos-mode' : ''}`} ref={fullscreenArenaRef}>
              {viewMode === 'cosmos'
                ? renderCosmos()
                : (fsBubbles.length > 0 && renderBubbles(fsBubbles, true))}
            </div>
          </div>
        </div>,
        document.body
      )}

      {renderTooltip()}
      {bubShareModalOpen && (
        <Suspense fallback={null}>
          <ShareXModal
            open={bubShareModalOpen}
            onClose={() => { setBubShareModalOpen(false); setBubShareImageUrl(null) }}
            imageUrl={bubShareImageUrl}
            defaultDescription={bubShareDescription}
            filename={`spectre_bubbles_${tfLabel.toLowerCase()}.png`}
          />
        </Suspense>
      )}
    </div>
  )
}

export default BubblesPage
