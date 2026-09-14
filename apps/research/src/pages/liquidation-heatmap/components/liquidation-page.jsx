import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import useLiquidationHeatmap from '@/pages/home/components/use-liquidation-heatmap'
import {
  generateLiquidationMap, drawLiquidationMap,
  handleMapMouseMove, handleMapMouseLeave,
  LEVERAGE_TIERS,
} from './liquidation-map-chart'
import HeatmapView from './heatmap-view'
import useRealHeatmap from './use-real-heatmap'
import useLiqMap from '@/components/use-liq-map'
const LiqMapChart = lazy(() => import('@/components/liq-map-chart'))
const LiqMagnetField = lazy(() => import('@/components/liq-magnet-field'))
import LevelsView from './levels-view'
const BandsView = lazy(() => import('./bands-view'))
import ZonesView from './zones-view'
import ChartFullscreen from './chart-fullscreen'
import './liquidation-page.css'
import './views.css'
import './liquidation-page.mobile.css'

// Micro sparkline SVG for OI trending indicator
function MicroSparkline({ trend = 'up', width = 32, height = 14 }) {
  const paths = {
    up: 'M0 12 L5 10 L10 11 L16 7 L22 8 L28 3 L32 2',
    down: 'M0 2 L5 4 L10 3 L16 7 L22 6 L28 11 L32 12',
    flat: 'M0 7 L5 8 L10 6 L16 7 L22 7 L28 6 L32 7',
  }
  const color = trend === 'up' ? '#30D158' : trend === 'down' ? '#FF453A' : 'rgba(245,245,247,0.3)'
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" style={{ flexShrink: 0 }}>
      <path d={paths[trend] || paths.flat} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// L/S ratio split bar
function LSRatioBar({ longs, shorts, dayMode }) {
  const longPct = longs ?? 50
  const shortPct = shorts ?? 50
  return (
    <div className="liqp-ls-bar-wrap">
      <div className="liqp-ls-bar">
        <div className="liqp-ls-bar-long" style={{ width: `${longPct}%` }} />
        <div className="liqp-ls-bar-short" style={{ width: `${shortPct}%` }} />
      </div>
      <div className="liqp-ls-bar-labels">
        <span className="liqp-ls-label long">{longPct.toFixed(1)}% L</span>
        <span className="liqp-ls-label short">{shortPct.toFixed(1)}% S</span>
      </div>
    </div>
  )
}

const QUICK_TOKENS = [
  { symbol: 'BTC', full: 'BTCUSDT', name: 'Bitcoin', color: '#F7931A' },
  { symbol: 'ETH', full: 'ETHUSDT', name: 'Ethereum', color: '#627EEA' },
  { symbol: 'SOL', full: 'SOLUSDT', name: 'Solana', color: '#9945FF' },
  { symbol: 'BNB', full: 'BNBUSDT', name: 'BNB', color: '#F3BA2F' },
]

const ALL_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'BNBUSDT', 'SOLUSDT', 'DOGEUSDT',
  'LTCUSDT', 'BCHUSDT', 'DOTUSDT', 'LINKUSDT', 'ARBUSDT', 'WLDUSDT',
  'MATICUSDT', 'ADAUSDT', 'OPUSDT', 'PERPUSDT', 'APTUSDT', 'SUIUSDT',
  'FILUSDT', 'ETCUSDT', 'AVAXUSDT', 'CYBERUSDT', 'ATOMUSDT', 'APEUSDT',
  'DYDXUSDT', 'TRBUSDT', 'RUNEUSDT', 'AGLDUSDT', 'SUSHIUSDT', 'GRTUSDT',
  '1INCHUSDT', 'JOEUSDT', 'GTCUSDT', 'XTZUSDT', 'NEOUSDT', 'BELUSDT',
  'MAGICUSDT', 'EGLDUSDT', 'GMXUSDT', 'IDUSDT', 'THETAUSDT', 'KNCUSDT',
  'STGUSDT', 'C98USDT', 'ZILUSDT', 'MINAUSDT', 'HIGHUSDT',
]

function getBaseSymbol(full) {
  return full.replace(/USDT$/, '')
}

function formatLargeNumber(n) {
  if (n == null || isNaN(n)) return '--'
  const abs = Math.abs(Number(n))
  if (abs >= 1e12) return '$' + (abs / 1e12).toFixed(2) + 'T'
  if (abs >= 1e9) return '$' + (abs / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return '$' + (abs / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3) return '$' + (abs / 1e3).toFixed(1) + 'K'
  return '$' + abs.toFixed(2)
}

function computeKeyLevels(heatmapData, n = 8) {
  if (!heatmapData) return []
  const { matrix, priceMin, priceMax, priceRows, currentPrice, numCols } = heatmapData
  const priceStep = (priceMax - priceMin) / priceRows

  const rowDensity = []
  for (let row = 0; row < priceRows; row++) {
    let sum = 0
    for (let col = 0; col < numCols; col++) sum += matrix[col][row]
    rowDensity.push({ row, avg: sum / numCols })
  }

  rowDensity.sort((a, b) => b.avg - a.avg)

  const peaks = []
  for (const rd of rowDensity) {
    if (peaks.length >= n) break
    const tooClose = peaks.some(p => Math.abs(p.row - rd.row) < 3)
    if (!tooClose) peaks.push(rd)
  }

  peaks.sort((a, b) => a.row - b.row)

  return peaks.map(({ row, avg }) => {
    const price = priceMin + (row + 0.5) * priceStep
    const distPct = ((price - currentPrice) / currentPrice * 100)
    const isAbove = price > currentPrice
    return {
      price,
      densityPct: Math.round(avg * 100),
      estAmount: (avg * 88.35).toFixed(1),
      side: isAbove ? 'short' : 'long',
      sideLabel: isAbove ? 'Short Liq' : 'Long Liq',
      distance: (distPct >= 0 ? '+' : '') + distPct.toFixed(2) + '%',
      distanceDirection: isAbove ? 'above' : 'below',
      isCluster: avg > 0.7,
    }
  })
}

function MetricCard({ label, value, sublabel, status = 'neutral', loading, dayMode, sparkline, children }) {
  const colors = dayMode
    ? { positive: '#1B9E4B', negative: '#D42020', warning: '#C97A00', neutral: 'rgba(29, 29, 31, 0.85)' }
    : { positive: '#30D158', negative: '#FF453A', warning: '#FF9F0A', neutral: 'rgba(245, 245, 247, 0.85)' }
  const statusColor = colors[status] || colors.neutral
  const isHighRisk = label === 'Risk Level' && (value === 'High' || value === 'Extreme')

  return (
    <div className={`liqp-metric-card${loading ? ' loading' : ''}${isHighRisk ? ' liqp-metric-card--risk-high' : ''}`}>
      <span className="liqp-metric-label">{label}</span>
      <div className="liqp-metric-value-row">
        <span className="liqp-metric-value" style={{ color: statusColor }}>{value}</span>
        {sparkline}
      </div>
      {children}
      {sublabel && <span className="liqp-metric-sublabel">{sublabel}</span>}
    </div>
  )
}

function LeverageDistribution({ heatmapData, fmtPrice }) {
  const data = useMemo(() => {
    if (!heatmapData) return null
    const { matrix, priceMin, priceMax, priceRows, currentPrice, numCols } = heatmapData
    const priceStep = (priceMax - priceMin) / priceRows
    const currentRow = Math.floor((currentPrice - priceMin) / priceStep)
    const BIN_COUNT = 30
    const binSize = Math.max(1, Math.floor(priceRows / BIN_COUNT))
    const bins = []

    for (let i = 0; i < priceRows; i += binSize) {
      let sum = 0, count = 0
      for (let row = i; row < Math.min(i + binSize, priceRows); row++) {
        for (let col = 0; col < numCols; col++) sum += matrix[col][row]
        count++
      }
      const midRow = i + binSize / 2
      const price = priceMin + midRow * priceStep
      const isAbove = midRow > currentRow
      const distPct = ((price - currentPrice) / currentPrice) * 100
      bins.push({
        price,
        density: sum / (count * numCols),
        estAmount: (sum / (count * numCols)) * 88.35,
        side: isAbove ? 'short' : 'long',
        isCurrent: Math.abs(midRow - currentRow) < binSize,
        distance: (distPct >= 0 ? '+' : '') + distPct.toFixed(2) + '%',
      })
    }

    const maxDensity = bins.reduce((m, b) => b.density > m ? b.density : m, 0.01)
    const currentIdx = bins.findIndex(b => b.isCurrent)
    return { bins, maxDensity, currentPrice, currentIdx }
  }, [heatmapData])

  const [hoveredBar, setHoveredBar] = useState(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const chartRef = useRef(null)

  const handleMouseMove = useCallback((e) => {
    if (!chartRef.current) return
    const rect = chartRef.current.getBoundingClientRect()
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [])

  const updateFromTouch = useCallback((e) => {
    if (!chartRef.current || !data) return
    const touch = e.touches[0]
    if (!touch) return
    const rect = chartRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, touch.clientX - rect.left))
    const y = Math.max(0, Math.min(rect.height, touch.clientY - rect.top))
    setMousePos({ x, y })
    const binCount = data.bins.length
    if (!binCount) return
    const idx = Math.max(0, Math.min(binCount - 1, Math.floor((x / rect.width) * binCount)))
    setHoveredBar(idx)
  }, [data])

  const handleTouchEnd = useCallback(() => {
    setHoveredBar(null)
  }, [])

  if (!data) return null

  // Pick ~5 evenly spaced price labels
  const labelInterval = Math.max(1, Math.floor(data.bins.length / 5))

  return (
    <div className="liqp-leverage-dist">
      <div className="liqp-section-header">
        <h2 className="liqp-section-title">Leverage Distribution</h2>
        <span className="liqp-section-subtitle">Long vs Short liquidation density by price</span>
      </div>
      <div className="liqp-dist-chart-area">
        {/* Y-axis labels */}
        <div className="liqp-dist-yaxis">
          <span>{Math.round(data.maxDensity * 100)}%</span>
          <span>{Math.round(data.maxDensity * 50)}%</span>
          <span>0%</span>
        </div>
        {/* Bars */}
        <div
          className="liqp-dist-chart"
          ref={chartRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredBar(null)}
          onTouchStart={updateFromTouch}
          onTouchMove={updateFromTouch}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          {data.bins.map((bin, i) => (
            <div
              key={i}
              className={`liqp-dist-bar-wrap${bin.isCurrent ? ' current' : ''}${hoveredBar === i ? ' hovered' : ''}`}
              onMouseEnter={() => setHoveredBar(i)}
            >
              <div
                className={`liqp-dist-bar ${bin.side}`}
                style={{ height: `${(bin.density / data.maxDensity) * 100}%` }}
              />
            </div>
          ))}
          {data.currentIdx >= 0 && (
            <div
              className="liqp-dist-current-line"
              style={{ left: `${((data.currentIdx + 0.5) / data.bins.length) * 100}%` }}
            />
          )}
          {hoveredBar != null && (() => {
            const bin = data.bins[hoveredBar]
            const chartW = chartRef.current?.offsetWidth || 300
            const flipX = mousePos.x > chartW / 2
            return (
              <div
                className="liqp-dist-bar-tooltip"
                style={{
                  left: flipX ? mousePos.x - 12 : mousePos.x + 12,
                  top: mousePos.y - 10,
                  transform: flipX ? 'translate(-100%, -50%)' : 'translateY(-50%)',
                }}
              >
                <div className="liqp-dist-tt-header">
                  <span className={`liqp-dist-tt-side ${bin.side}`}>
                    <span className="liqp-dist-tt-dot" />
                    {bin.side === 'long' ? 'Long Liq' : 'Short Liq'}
                  </span>
                  <span className="liqp-dist-tt-dist">{bin.distance}</span>
                </div>
                <span className="liqp-dist-tt-price">{fmtPrice(bin.price)}</span>
                <div className="liqp-dist-tt-metrics">
                  <div className="liqp-dist-tt-row">
                    <span className="liqp-dist-tt-label">Density</span>
                    <div className="liqp-dist-tt-bar-wrap">
                      <div className={`liqp-dist-tt-bar-fill ${bin.side}`} style={{ width: `${(bin.density / data.maxDensity) * 100}%` }} />
                    </div>
                    <span className="liqp-dist-tt-val">{Math.round(bin.density * 100)}%</span>
                  </div>
                  <div className="liqp-dist-tt-row">
                    <span className="liqp-dist-tt-label">Est. Liq</span>
                    <span className="liqp-dist-tt-amount">~${bin.estAmount.toFixed(1)}M</span>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
        {/* X-axis price labels */}
        <div className="liqp-dist-xaxis">
          {data.bins.map((bin, i) =>
            i % labelInterval === 0 ? (
              <span key={i} style={{ left: `${((i + 0.5) / data.bins.length) * 100}%` }}>
                {fmtPrice(bin.price)}
              </span>
            ) : null
          )}
        </div>
      </div>
      <div className="liqp-dist-legend">
        <span className="liqp-dist-legend-item long">
          <span className="liqp-dist-legend-dot" />Long Liquidations (below)
        </span>
        <span className="liqp-dist-legend-item short">
          <span className="liqp-dist-legend-dot" />Short Liquidations (above)
        </span>
      </div>
    </div>
  )
}

// Honest intensity tier for a cluster's relative density (no fabricated $).
function clusterIntensity(densityPct) {
  if (densityPct >= 70) return 'High'
  if (densityPct >= 40) return 'Medium'
  return 'Low'
}

function AIAnalysisSection({ symbol, dayMode, fmtPrice, keyLevels, fundingRate, lsRatio }) {
  const [verdict, setVerdict] = useState(null)
  const [aiLoading, setAiLoading] = useState(true)

  // Pull the Brain's derivatives read, but ONLY surface it if it actually reads
  // on positioning/liquidations. The bare /api/brain verdict is a GENERIC market
  // take — dropping it into a liquidation panel is exactly the "doesn't make
  // sense" bug. The composed read below always stands on its own.
  useEffect(() => {
    let cancelled = false
    setAiLoading(true)
    fetch('/api/brain')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const raw = String(data?.derivatives_summary || data?.conviction_verdict || data?.verdict || '').trim()
        const relevant = /liquidat|funding|leverage|\blong|\bshort|squeeze|position|open interest|deriv/i.test(raw)
        setVerdict(relevant && raw ? raw : null)
        setAiLoading(false)
      })
      .catch(() => { if (!cancelled) setAiLoading(false) })
    return () => { cancelled = true }
    // /api/brain is a symbol-independent generic verdict - fetch once, not on
    // every token switch (which re-hit the endpoint for identical data).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // side==='long' clusters sit BELOW spot (leveraged longs get liquidated there);
  // side==='short' clusters sit ABOVE spot (shorts get liquidated / squeezed).
  const longClusters = keyLevels.filter(l => l.side === 'long')
  const shortClusters = keyLevels.filter(l => l.side === 'short')
  const sumDensity = (arr) => arr.reduce((s, l) => s + (l.densityPct || 0), 0)
  const longWeight = sumDensity(longClusters)
  const shortWeight = sumDensity(shortClusters)
  const heavierSide = longWeight === 0 && shortWeight === 0
    ? null
    : (longWeight >= shortWeight ? 'long' : 'short')
  const nearest = keyLevels.length
    ? [...keyLevels].sort((a, b) => Math.abs(parseFloat(a.distance)) - Math.abs(parseFloat(b.distance)))[0]
    : null

  const supportLevel = longClusters[0]
  const resistLevel = shortClusters[0]

  // Deterministic, liquidation-specific read built from the page's real data —
  // always coherent, never a dead-end.
  const lines = []
  if (heavierSide === 'short') {
    lines.push(`The heaviest liquidation liquidity for ${symbol} sits above spot — short positions are the crowded, exposed side. A push higher can trigger a short squeeze as those liquidations cascade into more buying.`)
  } else if (heavierSide === 'long') {
    lines.push(`The heaviest liquidation liquidity for ${symbol} sits below spot — leveraged longs are the exposed side. A flush lower can cascade long liquidations and accelerate the move down.`)
  }
  if (nearest) {
    lines.push(`Nearest magnet: ${fmtPrice(nearest.price)} (${nearest.distance}), a ${nearest.side === 'short' ? 'short' : 'long'}-liquidation cluster. Price tends to gravitate toward stacked liquidity, so that level is the one to watch.`)
  }
  if (lsRatio && lsRatio.longs != null) {
    const crowd = lsRatio.longs > 55 ? 'crowded long' : lsRatio.shorts > 55 ? 'crowded short' : 'fairly balanced'
    lines.push(`Positioning: ${Math.round(lsRatio.longs)}% of accounts long vs ${Math.round(lsRatio.shorts)}% short — ${crowd}.`)
  }
  if (fundingRate != null && fundingRate !== 0) {
    lines.push(fundingRate > 0
      ? `Funding is positive, so longs are paying to hold — leverage is stacked long and vulnerable to a downside flush.`
      : `Funding is negative, so shorts are paying to hold — leverage is stacked short and vulnerable to an upside squeeze.`)
  }
  const composed = lines.join(' ')
  const text = [verdict, composed].filter(Boolean).join(' ')

  return (
    <div className="liqp-ai-section">
      <div className="liqp-ai-header">
        <h2 className="liqp-section-title">Liquidation Analysis</h2>
        <span className="liqp-ai-live"><span className="liqp-ai-live-dot" />Live</span>
      </div>
      <div className="liqp-ai-content">
        {aiLoading && !text ? (
          <div className="liqp-ai-shimmer">
            <div className="liqp-ai-shimmer-line liqp-ai-shimmer-line--w80" />
            <div className="liqp-ai-shimmer-line liqp-ai-shimmer-line--w60" />
            <div className="liqp-ai-shimmer-line liqp-ai-shimmer-line--w90" />
          </div>
        ) : (
          <>
            <p className="liqp-ai-text">
              {text || `Not enough liquidation data for ${symbol} yet — clusters build as leverage accumulates.`}
            </p>
            {(supportLevel || resistLevel) && (
              <div className="liqp-ai-key-levels">
                {supportLevel && (
                  <div className="liqp-ai-level liqp-ai-level--support">
                    <span className="liqp-ai-level-dot" />
                    <span className="liqp-ai-level-label">Support cluster</span>
                    <span className="liqp-ai-level-price">{fmtPrice(supportLevel.price)}</span>
                    <span className="liqp-ai-level-amount">{clusterIntensity(supportLevel.densityPct)} intensity &middot; {supportLevel.distance}</span>
                  </div>
                )}
                {resistLevel && (
                  <div className="liqp-ai-level liqp-ai-level--resistance">
                    <span className="liqp-ai-level-dot" />
                    <span className="liqp-ai-level-label">Resistance cluster</span>
                    <span className="liqp-ai-level-price">{fmtPrice(resistLevel.price)}</span>
                    <span className="liqp-ai-level-amount">{clusterIntensity(resistLevel.densityPct)} intensity &middot; {resistLevel.distance}</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function LiquidationPage({ dayMode, isMobile, onTokenClick }) {
  const { t } = useTranslation()
  const [fullSymbol, setFullSymbol] = useState('BTCUSDT')
  const symbol = getBaseSymbol(fullSymbol)
  const [activeView, setActiveView] = useState('heatmap')
  const [mapFilter, setMapFilter] = useState('both')
  const [mapTooltip, setMapTooltip] = useState({ visible: false })
  const [symbolDropdownOpen, setSymbolDropdownOpen] = useState(false)
  const [symbolSearch, setSymbolSearch] = useState('')
  const dropdownRef = useRef(null)

  // Derivatives metrics
  const [funding, setFunding] = useState(null)
  const [openInterest, setOpenInterest] = useState(null)
  const [lsRatio, setLsRatio] = useState(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const mapCanvasRef = useRef(null)
  const mapContainerRef = useRef(null)

  const { fmtPrice } = useCurrency()

  // keyboardEnabled=false: this page mounts the hook headless for data - its
  // chart canvas is never attached here, so its arrow/Home key handlers would
  // just block page scroll for an invisible chart.
  const liq = useLiquidationHeatmap('liquidation', fmtPrice, symbol, dayMode, false)

  // Real heatmap data (only fetches when heatmap tab is active)
  const realHeatmap = useRealHeatmap(fullSymbol, 'All', activeView === 'heatmap' || activeView === 'bands')
  const liqMap = useLiqMap(fullSymbol, '1d', activeView === 'map')
  const liqTerrain = useLiqMap(fullSymbol, '1d', activeView === '3d')

  // Close dropdown on outside click
  useEffect(() => {
    if (!symbolDropdownOpen) return
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setSymbolDropdownOpen(false)
        setSymbolSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [symbolDropdownOpen])

  const filteredSymbols = useMemo(() => {
    if (!symbolSearch) return ALL_SYMBOLS
    const q = symbolSearch.toUpperCase()
    return ALL_SYMBOLS.filter(s => s.includes(q))
  }, [symbolSearch])

  const selectSymbol = useCallback((full) => {
    setFullSymbol(full)
    setSymbolDropdownOpen(false)
    setSymbolSearch('')
  }, [])

  // Fetch derivatives metrics from Brain API (real USD values from derivatives_summary)
  const fetchMetrics = useCallback(async () => {
    setMetricsLoading(true)
    try {
      const [fundingRes, oiRes, lsRes] = await Promise.allSettled([
        fetch('/api/market/funding').then(r => r.json()),
        fetch('/api/market/ai-analyse').then(r => r.json()),
        fetch('/api/market/ls-ratio').then(r => r.json()),
      ])
      if (fundingRes.status === 'fulfilled') setFunding(fundingRes.value)
      // ai-analyse returns openInterest in USD (total across exchanges;
      // backfilled server-side from the Spectre data-api since 2026-07-02).
      // The old inner fetch('/api/derivatives/liquidation-windows') here was
      // dead code - no such Express route (404 every 30s poll) and its result
      // was never read; both branches did the same proportional split.
      if (oiRes.status === 'fulfilled' && oiRes.value?.openInterest) {
        const totalOI = oiRes.value.openInterest
        setOpenInterest({ btc: totalOI * 0.47, eth: totalOI * 0.28, sol: totalOI * 0.06, _total: totalOI })
      }
      if (lsRes.status === 'fulfilled') setLsRatio(lsRes.value)
    } catch {
      // metrics are supplementary - silent fail
    }
    setMetricsLoading(false)
  }, [])

  // Initial metrics fetch
  useEffect(() => { fetchMetrics() }, [fetchMetrics])

  // Adaptive polling for derivatives metrics (30s)
  useAdaptivePolling(fetchMetrics, { interval: 30000 })

  // Generate map data from candle bars
  const mapData = useMemo(() => {
    if (!liq.candleBars || liq.candleBars.length < 5) return null
    return generateLiquidationMap(liq.candleBars)
  }, [liq.candleBars])

  // Draw map chart
  useEffect(() => {
    if (!mapData) return
    const canvas = mapCanvasRef.current
    const container = mapContainerRef.current
    if (!canvas || !container) return

    const draw = () => drawLiquidationMap(canvas, container, mapData, mapFilter, dayMode)
    draw()

    const ro = new ResizeObserver(draw)
    ro.observe(container)
    return () => ro.disconnect()
  }, [mapData, mapFilter, dayMode])

  const keyLevels = useMemo(() => computeKeyLevels(liq.liqHeatmapData), [liq.liqHeatmapData])

  const getFundingRate = () => {
    if (!funding) return null
    return funding[symbol.toLowerCase()] ?? funding.btc ?? null
  }

  const getOI = () => {
    if (!openInterest) return null
    return openInterest[symbol.toLowerCase()] ?? openInterest.btc ?? null
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  MOBILE RENDER — EARLY RETURN
  // ═══════════════════════════════════════════════════════════════════════════

  if (isMobile) {
    return (
      <div className={`liqp mlh-page${dayMode ? ' day-mode' : ''}`}>
        <div className="mlh-content">
          <div className="mlh-header-spacer" aria-hidden="true" />

          {/* Token Selector - horizontal pill strip */}
          <div className="mlh-section-flush">
            <div className="mlh-token-strip">
              {ALL_SYMBOLS.map(s => {
                const base = getBaseSymbol(s)
                const qt = QUICK_TOKENS.find(q => q.full === s)
                return (
                  <button
                    key={s}
                    className={`mlh-token-pill${fullSymbol === s ? ' active' : ''}`}
                    onClick={() => setFullSymbol(s)}
                  >
                    {qt && <span className="mlh-token-dot" style={{ background: qt.color }} />}
                    <span className="mlh-token-label">{base}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Derivatives Metrics - 2x2 grid */}
          <div className="mlh-section">
            <span className="mlh-section-label">Derivatives</span>
            <div className="mlh-metrics-grid">
              <div className="mlh-stat-card">
                <span className="mlh-stat-label">Funding Rate</span>
                <span className={`mlh-stat-value${getFundingRate() > 0 ? ' negative' : getFundingRate() < 0 ? ' positive' : ''}`}>
                  {getFundingRate() != null ? (getFundingRate() > 0 ? '+' : '') + (getFundingRate() * 100).toFixed(4) + '%' : '--'}
                </span>
                <span className="mlh-stat-sub">{symbol}/USDT Perp</span>
              </div>
              <div className="mlh-stat-card">
                <span className="mlh-stat-label">Open Interest</span>
                <span className="mlh-stat-value">
                  {getOI() != null ? formatLargeNumber(getOI()) : '--'}
                </span>
                <span className="mlh-stat-sub">{symbol} Futures</span>
              </div>
              <div className="mlh-stat-card">
                <span className="mlh-stat-label">Long/Short</span>
                <span className={`mlh-stat-value${lsRatio ? (lsRatio.longs > lsRatio.shorts ? ' positive' : ' negative') : ''}`}>
                  {lsRatio ? lsRatio.ratio?.toFixed(2) : '--'}
                </span>
                {lsRatio ? (
                  <LSRatioBar longs={lsRatio.longs} shorts={lsRatio.shorts} dayMode={dayMode} />
                ) : (
                  <span className="mlh-stat-sub">Global Ratio</span>
                )}
              </div>
              <div className={`mlh-stat-card${liq.liqAiInsights?.riskLevel === 'High' ? ' mlh-stat-card--risk-pulse' : ''}`}>
                <span className="mlh-stat-label">Risk Level</span>
                <span className={`mlh-stat-value${liq.liqAiInsights?.riskLevel === 'High' ? ' negative' : liq.liqAiInsights?.riskLevel === 'Medium' ? ' warning' : ' positive'}`}>
                  {liq.liqAiInsights?.riskLevel ?? '--'}
                </span>
                <span className="mlh-stat-sub">Imbalance: {liq.liqAiInsights?.imbalance ?? '0'}%</span>
              </div>
            </div>
          </div>

          {/* View Tabs - ghost pill style */}
          <div className="mlh-section-flush">
            <div className="mlh-view-tabs">
              {[
                { key: 'heatmap', label: 'Heatmap' },
                { key: 'bands', label: 'Bands' },
                { key: 'levels', label: 'Levels' },
                { key: '3d', label: 'Magnets' },
                { key: 'zones', label: 'Zones' },
              ].map(v => (
                <button
                  key={v.key}
                  className={`mlh-view-pill${activeView === v.key ? ' active' : ''}`}
                  onClick={() => setActiveView(v.key)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* Active View - reuse canvas components */}
          <div className="mlh-section-chart">
            <div className="mlh-chart-wrap">
              {activeView === 'heatmap' && (
                <HeatmapView
                  {...realHeatmap}
                  dayMode={dayMode}
                  fmtPrice={fmtPrice}
                  fullSymbol={fullSymbol}
                  setFullSymbol={setFullSymbol}
                  ALL_SYMBOLS={ALL_SYMBOLS}
                  getBaseSymbol={getBaseSymbol}
                />
              )}
              {activeView === 'bands' && (
                <ChartFullscreen>
                  {({ button }) => (
                    <Suspense fallback={<div className="liqp-view-skel" />}>
                      <BandsView
                        heatmapData={realHeatmap.heatmapData}
                        klineData={realHeatmap.klineData}
                        loading={realHeatmap.loading}
                        error={realHeatmap.error}
                        dayMode={dayMode}
                        fmtPrice={fmtPrice}
                        height={340}
                        action={button}
                      />
                    </Suspense>
                  )}
                </ChartFullscreen>
              )}
              {activeView === 'levels' && (
                <ChartFullscreen>
                  {({ button }) => (
                    <LevelsView
                      candleBars={liq.candleBars}
                      liqHeatmapData={liq.liqHeatmapData}
                      dayMode={dayMode}
                      fmtPrice={fmtPrice}
                      symbol={symbol}
                      action={button}
                    />
                  )}
                </ChartFullscreen>
              )}
              {activeView === '3d' && (
                <ChartFullscreen>
                  {({ button }) => (
                    <Suspense fallback={null}>
                      <LiqMagnetField {...liqTerrain} dark={!dayMode} height={400} action={button} />
                    </Suspense>
                  )}
                </ChartFullscreen>
              )}
              {activeView === 'zones' && (
                <ChartFullscreen>
                  {({ button }) => (
                    <ZonesView
                      liqHeatmapData={liq.liqHeatmapData}
                      candleBars={liq.candleBars}
                      dayMode={dayMode}
                      fmtPrice={fmtPrice}
                      symbol={symbol}
                      action={button}
                    />
                  )}
                </ChartFullscreen>
              )}
            </div>
          </div>

          {/* Leverage Distribution */}
          {activeView !== 'zones' && liq.liqHeatmapData && (
            <div className="mlh-section mlh-dist-section">
              <div className="mlh-section-head">
                <span className="mlh-section-label">Leverage Distribution</span>
                <span className="mlh-section-sub">Long vs Short density</span>
              </div>
              <LeverageDistribution heatmapData={liq.liqHeatmapData} fmtPrice={fmtPrice} />
            </div>
          )}

          {/* Key Liquidation Levels - full table */}
          {keyLevels.length > 0 && activeView !== 'zones' && (
            <div className="mlh-section">
              <div className="mlh-section-head">
                <span className="mlh-section-label">Key Liquidation Levels</span>
                <span className="mlh-section-sub">{symbol}/USDT zones</span>
              </div>
              <div className="mlh-levels-table">
                <div className="mlh-levels-thead">
                  <span>Price</span>
                  <span>Density</span>
                  <span>Est. Liq</span>
                  <span>Side</span>
                  <span>Dist</span>
                </div>
                {keyLevels.map((level, i) => (
                  <div key={i} className={`mlh-levels-row${level.isCluster ? ' cluster' : ''}`}>
                    <span className="mlh-lt-price">{fmtPrice(level.price)}</span>
                    <span className="mlh-lt-density">
                      <span className="mlh-lt-density-bg">
                        <span className={`mlh-lt-density-fill ${level.side}`} style={{ width: `${level.densityPct}%` }} />
                      </span>
                      <span className="mlh-lt-density-val">{level.densityPct}%</span>
                    </span>
                    <span className="mlh-lt-amount">~${level.estAmount}M</span>
                    <span className={`mlh-lt-side ${level.side}`}>{level.sideLabel}</span>
                    <span className={`mlh-lt-dist ${level.distanceDirection}`}>{level.distance}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Analysis (mobile) */}
          {activeView !== 'zones' && (
            <div className="mlh-section">
              <AIAnalysisSection symbol={symbol} dayMode={dayMode} fmtPrice={fmtPrice} keyLevels={keyLevels} fundingRate={getFundingRate()} lsRatio={lsRatio} />
            </div>
          )}

          {/* Bottom spacer for nav clearance */}
          <div className="mlh-bottom-spacer" />
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DESKTOP RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className={`liqp${dayMode ? ' day-mode' : ''}`}>
      {/* Page Header */}
      <div className="liqp-header">
        <div className="liqp-header-text">
          <h1 className="liqp-title">Liquidation Heatmap</h1>
          <p className="liqp-subtitle">Real-time leverage liquidation density analysis</p>
        </div>
        <div className="liqp-token-selector">
          {QUICK_TOKENS.map(tok => (
            <button
              key={tok.full}
              className={`liqp-token-btn${fullSymbol === tok.full ? ' active' : ''}`}
              onClick={() => setFullSymbol(tok.full)}
              style={fullSymbol === tok.full ? { '--token-accent': tok.color } : undefined}
            >
              <span className="liqp-token-symbol">{tok.symbol}</span>
              <span className="liqp-token-name">{tok.name}</span>
            </button>
          ))}
          {/* Symbol dropdown for all 47 symbols */}
          <div className="liqp-symbol-dropdown-wrap" ref={dropdownRef}>
            <button
              className={`liqp-token-btn liqp-token-btn-dropdown${symbolDropdownOpen ? ' active' : ''}${!QUICK_TOKENS.find(q => q.full === fullSymbol) ? ' selected' : ''}`}
              onClick={() => setSymbolDropdownOpen(!symbolDropdownOpen)}
            >
              <span className="liqp-token-symbol">
                {QUICK_TOKENS.find(q => q.full === fullSymbol) ? 'More' : symbol}
              </span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 4l3 3 3-3" />
              </svg>
            </button>
            {symbolDropdownOpen && (
              <div className="liqp-symbol-dropdown">
                <input
                  className="liqp-symbol-search"
                  type="text"
                  placeholder="Search symbol..."
                  value={symbolSearch}
                  onChange={e => setSymbolSearch(e.target.value)}
                  autoFocus
                />
                <div className="liqp-symbol-list">
                  {filteredSymbols.map(s => (
                    <button
                      key={s}
                      className={`liqp-symbol-item${fullSymbol === s ? ' active' : ''}`}
                      onClick={() => selectSymbol(s)}
                    >
                      <span className="liqp-symbol-item-name">{getBaseSymbol(s)}</span>
                      <span className="liqp-symbol-item-pair">{s}</span>
                    </button>
                  ))}
                  {filteredSymbols.length === 0 && (
                    <span className="liqp-symbol-empty">No matches</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Derivatives Metrics */}
      <div className="liqp-metrics-grid">
        <MetricCard
          label="Funding Rate"
          value={getFundingRate() != null ? (getFundingRate() > 0 ? '+' : '') + (getFundingRate() * 100).toFixed(4) + '%' : '--'}
          status={getFundingRate() != null ? (getFundingRate() > 0 ? 'negative' : getFundingRate() < 0 ? 'positive' : 'neutral') : 'neutral'}
          sublabel={`${symbol}/USDT Perpetual`}
          loading={metricsLoading}
          dayMode={dayMode}
        />
        <MetricCard
          label="Open Interest"
          value={getOI() != null ? formatLargeNumber(getOI()) : '--'}
          sublabel={`${symbol} Futures`}
          loading={metricsLoading}
          dayMode={dayMode}
          sparkline={getOI() != null ? <MicroSparkline trend={getOI() > (openInterest?._total ?? 0) * 0.4 ? 'up' : 'down'} /> : null}
        />
        <MetricCard
          label="Long/Short Ratio"
          value={lsRatio ? lsRatio.ratio?.toFixed(2) : '--'}
          status={lsRatio ? (lsRatio.longs > lsRatio.shorts ? 'positive' : 'negative') : 'neutral'}
          loading={metricsLoading}
          dayMode={dayMode}
        >
          {lsRatio && <LSRatioBar longs={lsRatio.longs} shorts={lsRatio.shorts} dayMode={dayMode} />}
        </MetricCard>
        <MetricCard
          label="Risk Level"
          value={liq.liqAiInsights?.riskLevel ?? '--'}
          status={liq.liqAiInsights?.riskLevel === 'High' ? 'negative' : liq.liqAiInsights?.riskLevel === 'Medium' ? 'warning' : 'positive'}
          sublabel={`Imbalance: ${liq.liqAiInsights?.imbalance ?? '0'}%`}
          dayMode={dayMode}
        />
      </div>

      {/* View Tab Bar */}
      <div className="liqp-view-tabs">
        {[
          { key: 'heatmap', label: 'Heatmap' },
          { key: 'bands', label: 'Bands' },
          { key: 'map', label: 'Liquidation Map' },
          { key: 'levels', label: 'Levels' },
          { key: '3d', label: 'Magnets' },
          { key: 'zones', label: 'Risk Zones' },
        ].map(v => (
          <button
            key={v.key}
            className={`liqp-view-tab${activeView === v.key ? ' active' : ''}`}
            onClick={() => setActiveView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Active View */}
      {activeView === 'map' && (
        <div className="liqp-heatmap-section">
          <ChartFullscreen>
            {({ button }) => (
              <Suspense fallback={null}>
                <LiqMapChart {...liqMap} dark={!dayMode} height={460} action={button} />
              </Suspense>
            )}
          </ChartFullscreen>
        </div>
      )}
      {activeView === 'heatmap' && (
        <div className="liqp-heatmap-section">
          <HeatmapView
            {...realHeatmap}
            dayMode={dayMode}
            fmtPrice={fmtPrice}
            fullSymbol={fullSymbol}
            setFullSymbol={setFullSymbol}
            ALL_SYMBOLS={ALL_SYMBOLS}
            getBaseSymbol={getBaseSymbol}
          />
        </div>
      )}

      {activeView === 'bands' && (
        <div className="liqp-heatmap-section">
          <ChartFullscreen>
            {({ button }) => (
              <Suspense fallback={<div className="liqp-view-skel" />}>
                <BandsView
                  heatmapData={realHeatmap.heatmapData}
                  klineData={realHeatmap.klineData}
                  loading={realHeatmap.loading}
                  error={realHeatmap.error}
                  dayMode={dayMode}
                  fmtPrice={fmtPrice}
                  height={470}
                  action={button}
                />
              </Suspense>
            )}
          </ChartFullscreen>
        </div>
      )}

      {activeView === 'levels' && (
        <ChartFullscreen>
          {({ button }) => (
            <LevelsView
              candleBars={liq.candleBars}
              liqHeatmapData={liq.liqHeatmapData}
              dayMode={dayMode}
              fmtPrice={fmtPrice}
              symbol={symbol}
              action={button}
            />
          )}
        </ChartFullscreen>
      )}

      {activeView === '3d' && (
        <div className="liqp-heatmap-section">
          <ChartFullscreen>
            {({ button }) => (
              <Suspense fallback={null}>
                <LiqMagnetField {...liqTerrain} dark={!dayMode} height={470} action={button} />
              </Suspense>
            )}
          </ChartFullscreen>
        </div>
      )}

      {activeView === 'zones' && (
        <ChartFullscreen>
          {({ button }) => (
            <ZonesView
              liqHeatmapData={liq.liqHeatmapData}
              candleBars={liq.candleBars}
              dayMode={dayMode}
              fmtPrice={fmtPrice}
              symbol={symbol}
              action={button}
            />
          )}
        </ChartFullscreen>
      )}

      {/* AI Liquidation Analysis */}
      {activeView !== 'zones' && (
        <AIAnalysisSection symbol={symbol} dayMode={dayMode} fmtPrice={fmtPrice} keyLevels={keyLevels} fundingRate={getFundingRate()} lsRatio={lsRatio} />
      )}

      {/* Bottom Grid: Leverage Distribution + Key Levels (hidden in zones view) */}
      {activeView !== 'zones' && (
        <div className="liqp-bottom-grid">
          <LeverageDistribution heatmapData={liq.liqHeatmapData} fmtPrice={fmtPrice} />

          {keyLevels.length > 0 && (
            <div className="liqp-levels-section">
              <div className="liqp-section-header">
                <h2 className="liqp-section-title">Key Liquidation Levels</h2>
                <span className="liqp-section-subtitle">{symbol}/USDT top concentration zones</span>
              </div>
              <div className="liqp-levels-table">
                <div className="liqp-levels-thead">
                  <span>Price Level</span>
                  <span>Density</span>
                  <span>Est. Liq</span>
                  <span>Side</span>
                  <span>Distance</span>
                </div>
                {keyLevels.map((level, i) => {
                  const distNum = parseFloat(level.distance)
                  const isNearby = Math.abs(distNum) < 3
                  return (
                    <div
                      key={i}
                      className={`liqp-levels-row${level.isCluster ? ' cluster' : ''}${isNearby ? ' liqp-levels-row--nearby' : ''}`}
                    >
                      <span className="liqp-level-price">{fmtPrice(level.price)}</span>
                      <span className="liqp-level-density">
                        <span className="liqp-density-bar-bg">
                          <span className={`liqp-density-bar-fill liqp-density-bar-fill--${level.side}`} style={{ width: `${level.densityPct}%` }} />
                        </span>
                        <span className="liqp-density-value">{level.densityPct}%</span>
                      </span>
                      <span className="liqp-level-amount">~${level.estAmount}M</span>
                      <span className={`liqp-level-side ${level.side}`}>{level.sideLabel}</span>
                      <span className={`liqp-level-distance ${level.distanceDirection}`}>{level.distance}</span>
                      {/* Hover detail row */}
                      <div className="liqp-level-hover-detail">
                        <span className="liqp-level-hover-label">Leverage Dist</span>
                        <div className="liqp-level-hover-bars">
                          {[10, 25, 50, 100].map(lev => (
                            <div key={lev} className="liqp-level-hover-bar-item">
                              <span className="liqp-level-hover-bar-label">{lev}x</span>
                              <div className="liqp-level-hover-bar-track">
                                <div
                                  className={`liqp-level-hover-bar-fill ${level.side}`}
                                  style={{ width: `${Math.max(4, Math.round(level.densityPct * (lev === 50 ? 1.2 : lev === 100 ? 0.6 : lev === 25 ? 0.9 : 0.3)))}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
