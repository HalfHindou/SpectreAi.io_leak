/**
 * TradingChart Component
 * Figma Reference: Chart with type buttons above timeframes
 * Professional candlestick chart
 * 
 * NOW WITH REAL-TIME DATA FROM CODEX API
 */
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useImperativeHandle, forwardRef, memo, Suspense } from 'react'
import lazyWithRetry from '@/lib/lazy-with-retry'
import lazy from '@/lib/lazy-with-retry'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useAnchoredMenu } from '@/hooks/useAnchoredMenu'
import { getDefaultChartZoom, hasCustomChartView } from '@/lib/chart-default-view'
import { MIN_CHART_ZOOM, OVERSCROLL_RIGHT, computeChartGeometry, computeOffsetBounds, computeChartWindow } from '@/lib/chart-viewport'
import { resolveChartPanMode } from '@/lib/chart-pan-gesture'
import { useResponsiveChartFrame } from '@/hooks/useResponsiveChartFrame'
import { useCurrency } from '@/hooks/useCurrency'
import { useChartData, useTokenDetails } from '@/hooks/useCodexData'
import { useRealtimeOhlcv } from '@/hooks/useOnchainData'
import { isOnchainSupported } from '@/services/onchainApi'
import { computeSRLevels } from '@/lib/sr-levels'
import { drawSRZonesOnTvChart, clearTvZoneEntities } from '@/lib/sr-levels-tv'
import { drawTaOverlay, makeChartMapping, formatDuration } from './chart-ta-overlay'
import { drawTaOnTvChart, clearTaTvEntities, startTvDrawTool, getTvVisibleRange, getTvPlotRect, getTvResolutionMinutes } from '@/lib/chart-ta-tv'
import { getTokenChart as getSpectreTokenChart } from '@/services/spectreDataApi'
import { resolveTradingViewSymbol, resolveDexTradingViewSymbol, searchTradingViewSymbol } from '@/lib/tradingViewSymbols'
import useSettingsStore from '@/store/useSettingsStore'
import useChartVoiceControl from '@/hooks/useChartVoiceControl'
import RzPriceHistoryBars from '@/pages/research-zone/components/rz-price-history-bars'
import { getNoteIcon } from '@/pages/research-zone/components/note-icons'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import useTokenBrandColor from '@/hooks/useTokenBrandColor'
// 2026-06-03: was lazyWithRetry() so the TradingViewAdvanced chunk could be
// dropped from the main bundle when the user never opens a chart in TV
// mode. The lazy() approach kept failing because every chart-related deploy
// invalidates the chunk hash and any browser holding a stale tab requests
// the old 404'd URL. We tried a one-shot reload retry (PR #741) but the
// reload itself disrupts the user (their click "did nothing") + still
// leaves a window where the page is blank.
//
// Cost of direct import: TradingViewAdvanced wrapper component ships in
// the main JS bundle (~30-80KB gzip). The TradingView charting_library
// itself still loads via a separate <script> tag in TradingViewAdvanced
// on demand — that's not part of the JS bundle either way. The trade-off
// is a slightly bigger main bundle in exchange for zero stale-chunk class
// of bugs. Worth it.
//
// Other lazy-load sites for TVA (monarch-chart.jsx, embed-chart.jsx) still
// use lazy() — those flows are less hot and less affected by the issue.
import TradingViewAdvanced from './TradingViewAdvanced'
import ChartIframeEmbed from './chart-iframe-embed'
import ChartWatermark from '@/components/chart-watermark'
import { getStockCandles } from '@/services/stockApi'

import RzCompareView from '@/pages/research-zone/components/rz-compare-view'
import './trading-chart.css'

/* ── Technical Indicator Calculations ────────────────────────────────────── */

function calcSMA(data, period) {
  const result = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += data[j].close
    result.push(sum / period)
  }
  return result
}

function calcEMA(data, period) {
  const result = []
  const k = 2 / (period + 1)
  let ema = null
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue }
    if (ema === null) {
      // Seed EMA with SMA of first `period` values
      let sum = 0
      for (let j = i - period + 1; j <= i; j++) sum += data[j].close
      ema = sum / period
    } else {
      ema = data[i].close * k + ema * (1 - k)
    }
    result.push(ema)
  }
  return result
}

function calcBollingerBands(data, period = 20, mult = 2) {
  const sma = calcSMA(data, period)
  const upper = []
  const lower = []
  for (let i = 0; i < data.length; i++) {
    if (sma[i] === null) { upper.push(null); lower.push(null); continue }
    let variance = 0
    for (let j = i - period + 1; j <= i; j++) {
      const diff = data[j].close - sma[i]
      variance += diff * diff
    }
    const stdDev = Math.sqrt(variance / period)
    upper.push(sma[i] + mult * stdDev)
    lower.push(sma[i] - mult * stdDev)
  }
  return { middle: sma, upper, lower }
}

function calcVWAP(data) {
  const result = []
  let cumVolPrice = 0
  let cumVol = 0
  for (let i = 0; i < data.length; i++) {
    const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3
    const vol = data[i].volume || 0
    cumVolPrice += typicalPrice * vol
    cumVol += vol
    result.push(cumVol > 0 ? cumVolPrice / cumVol : null)
  }
  return result
}

// Indicator visual config: color, label, lineWidth
const INDICATOR_STYLES = {
  ema9:   { color: '#f59e0b', label: 'EMA 9',   width: 1.5 },
  ema21:  { color: '#3b82f6', label: 'EMA 21',  width: 1.5 },
  ema50:  { color: '#8b5cf6', label: 'EMA 50',  width: 1.5 },
  ema200: { color: '#ef4444', label: 'EMA 200', width: 2 },
  sma20:  { color: '#06b6d4', label: 'SMA 20',  width: 1.5 },
  sma50:  { color: '#ec4899', label: 'SMA 50',  width: 1.5 },
  sma200: { color: '#14b8a6', label: 'SMA 200', width: 2 },
  bb:     { color: '#06b6d4', label: 'BB (20,2)', width: 1.5 },
  vwap:   { color: '#a78bfa', label: 'VWAP',    width: 1.5 },
  srzones: { color: '#10b981', label: 'S/R Zones', width: 1 }, // bands, not a line — drawn in its own pass
}

// Real brand-logo gradients for the "Logo" line-color mode. Keyed by uppercase
// symbol. Each is a 4-stop base->light ramp that reflects the token's actual
// logo colors (Solana is purple->green, not a single hue). Tokens NOT listed
// fall back to the single-hue brand-color gradient (same as "Auto").
const LOGO_GRADIENTS = {
  SOL:   ['#9945FF', '#7B5BEC', '#41C6C0', '#14F195'], // official purple -> green
  BTC:   ['#F7931A', '#F9A63C', '#FBB85E', '#FDCB80'],
  ETH:   ['#627EEA', '#7C93EE', '#98AAF2', '#B4C1F6'],
  BNB:   ['#F0B90B', '#F3C531', '#F6D157', '#F9DD7D'],
  ADA:   ['#0033AD', '#1A4EC2', '#3369D6', '#4D84EB'],
  AVAX:  ['#E84142', '#EC5B5C', '#F07576', '#F38F90'],
  DOGE:  ['#C2A633', '#CFB44E', '#DCC26A', '#E9D086'],
  DOT:   ['#E6007A', '#EC338F', '#F166A5', '#F599BB'],
  LINK:  ['#2A5ADA', '#3E6DE0', '#6389E8', '#87A5EF'],
  MATIC: ['#8247E5', '#9460EA', '#A97FEF', '#BE9EF4'],
  POL:   ['#8247E5', '#9460EA', '#A97FEF', '#BE9EF4'],
  NEAR:  ['#00EC97', '#2AF0AB', '#54F4BF', '#7EF8D3'],
  SUI:   ['#4DA2FF', '#5DB0FF', '#7CC4FF', '#9AD5FF'],
  APT:   ['#06B6A9', '#1EC7BA', '#3AD8CC', '#57E9DE'],
  TON:   ['#0098EA', '#22A9EF', '#48BAF4', '#6ECBF8'],
  ARB:   ['#28A0F0', '#4AB0F3', '#6CC0F6', '#8ED0F9'],
  OP:    ['#FF0420', '#FF2C42', '#FF5464', '#FF7C86'],
  TRX:   ['#EF0027', '#F2333C', '#F55C6E', '#F885A0'],
  INJ:   ['#00A3FF', '#1AB0FF', '#33BDFF', '#4DCAFF'],
  PEPE:  ['#4CAF50', '#66BB6A', '#81C784', '#A5D6A7'],
  WIF:   ['#FFAFC9', '#FFC0D5', '#FFD1E1', '#FFE2ED'],
  SHIB:  ['#FFA409', '#FFB431', '#FFC459', '#FFD481'],
  BONK:  ['#FFB800', '#FFC633', '#FFD466', '#FFE299'],
  SEI:   ['#B23A34', '#C6564F', '#DA716B', '#EE8C86'],
}

// The Y-axis label font, shared by the draw pass and the gutter measurement so
// the two can never drift apart (a wider font with the old flat 75px gutter is
// exactly how labels started getting clipped).
const AXIS_LABEL_FONT = '600 12.5px "SF Pro Text", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'

const TradingChart = forwardRef(({ chartViewMode = 'trading', setChartViewMode, token, stats, isCollapsed = false, embedHeight, dayMode, livePrice, initialChartType, embedMode = false, responsiveControls = false, barsChartProps = null, tradeMarkers = null, onNoData = null, onSymbolChange = null, onVoiceStateChange = null, extraTypeTabs = null, extraToolButtons = null, annotations = null, noteModeActive = false, onCanvasAnnotateClick = null, onAnnotationClick = null, compareViewActive = false, compareViewProps = null, taMode = 'off', taSelection = null, onTaSelectionChange = null, taDrawings = null, onTaDrawingAdd = null, taRevealKey = 0, onFullscreenChange = null, identityPending = false }, ref) => {
  const { t } = useTranslation()
  const { fmtPrice: hookFmtPrice, fmtLarge: hookFmtLarge, currencySymbol } = useCurrency()
  const tokenColoring = useSettingsStore((s) => s.tokenColoring)
  // Fetch real token data including circulating supply
  const { tokenData: liveTokenData } = useTokenDetails(
    token?.address,
    token?.networkId || 1,
    60000 // Refresh every 60 seconds (price updates come via livePrice prop)
  )
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const chartFrameRef = useRef(null)
  const chartControlsRef = useRef(null)
  const livePulseRef = useRef(null)
  const livePointRef = useRef(null) // {x, y, color} of the current live price point
  
  // Timeframe and chartType persisted via Zustand
  const timeframe = useSettingsStore((s) => s.chartTimeframe)
  const setTimeframe = useSettingsStore((s) => s.setChartTimeframe)
  // Chart type is stored PER FORM FACTOR. A phone pays 4.4MB for TradingView's
  // library before it can draw anything, so it opens on our own canvas chart;
  // a desktop keeps the deliberate 2026-06-03 default. Whichever the user then
  // picks sticks to the device they picked it on rather than following them
  // across, which is the only reading of "remember my choice" that is not
  // surprising on one of the two.
  const isPhone = typeof window !== 'undefined'
    && window.matchMedia?.('(max-width: 768px)').matches
  const storedChartTypeDesktop = useSettingsStore((s) => s.chartType)
  const storedChartTypeMobile = useSettingsStore((s) => s.chartTypeMobile)
  const setChartTypeDesktop = useSettingsStore((s) => s.setChartType)
  const setChartTypeMobile = useSettingsStore((s) => s.setChartTypeMobile)
  const storedChartType = isPhone ? (storedChartTypeMobile || 'candles') : storedChartTypeDesktop
  const setChartType = isPhone ? setChartTypeMobile : setChartTypeDesktop

  const [heatmapEnabled, setHeatmapEnabled] = useState(false)
  const [tvNoData, setTvNoData] = useState(false) // TradingView reported no data for this token
  // 2026-06-10: self-hosted TV (UDF cascade) had no data for this DEX token —
  // fall back to the free iframe embed (DexScreener) instead of a blank chart.
  const [tvEmbedFallback, setTvEmbedFallback] = useState(false)
  useEffect(() => { setTvEmbedFallback(false) }, [token?.address, token?.symbol])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [yAxisMode, setYAxisMode] = useState('price') // 'price' or 'mcap'
  // Price-axis scale, user-controlled (TradingView model). Default LINEAR -
  // the old auto-log (>3x range) surprised users by flipping wide views like
  // SPECTRE ALL to a log axis ($0.03 -> $7.46 = 259x). Linear is the expected
  // default everywhere; log is one click away for parabolic/wide-range tokens
  // where linear squashes the action into a baseline. (Gleb 2026-06-12)
  const [priceScale, setPriceScale] = useState('linear') // 'linear' | 'log'
  // Timeframe overflow dropdown ("More" — holds the less-used resolutions so
  // the main row stays the 7 the user asked for). Portaled to body: the
  // toolbar is overflow-x:auto (which forces overflow-y to clip), so an
  // in-flow absolute menu got cut off by the chart below. (Gleb 2026-06-14)
  const [tfMenuOpen, setTfMenuOpen] = useState(false)
  const [tfMenuPos, setTfMenuPos] = useState(null)
  const tfMoreRef = useRef(null)        // trigger button wrapper
  const tfMenuDropdownRef = useRef(null) // portaled menu
  const responsiveTfStyle = useAnchoredMenu({ open: responsiveControls && tfMenuOpen, isSheet: false, triggerRef: tfMoreRef, maxHeight: 352 })
  const [showATHLines, setShowATHLines] = useState(false) // Show ATH and local ATH lines
  // Technical indicators overlay. Persisted to localStorage so a user's
  // toggles survive reload (Sunny 2026-07-02: unchecking S/R Zones didn't
  // stick — it reverted to the default-ON on every refresh). srzones defaults
  // ON for first-time users; any saved choice wins.
  // Sunny 2026-07-02: the earlier default-ON S/R Zones was "perma" — impossible
  // to get rid of across reloads. ALL indicators (incl. srzones) now default
  // OFF (opt-in). Storage key bumped v1->v2 so any stale saved `srzones:true`
  // from the default-ON build is discarded — clean OFF slate for everyone; a
  // saved choice still wins after.
  const INDICATOR_DEFAULTS = {
    ema9: false, ema21: false, ema50: false, ema200: false,
    sma20: false, sma50: false, sma200: false,
    bb: false, vwap: false, srzones: false,
  }
  const [activeIndicators, setActiveIndicators] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('spectre-chart-indicators-v2') || 'null')
      if (saved && typeof saved === 'object') return { ...INDICATOR_DEFAULTS, ...saved }
    } catch { /* ignore */ }
    return INDICATOR_DEFAULTS
  })
  useEffect(() => {
    try {
      localStorage.setItem('spectre-chart-indicators-v2', JSON.stringify(activeIndicators))
      localStorage.removeItem('spectre-chart-indicators-v1') // drop stale default-ON state
    } catch { /* quota */ }
  }, [activeIndicators])
  const [indicatorDropdownOpen, setIndicatorDropdownOpen] = useState(false)
  const indicatorDropdownRef = useRef(null)
  const indicatorTriggerRef = useRef(null)
  const [indicatorDropdownPos, setIndicatorDropdownPos] = useState(null)
  // Mobile-only "Settings" dropdown — packs the desktop tool row (Heatmap,
  // ATH, Indicators, Voice, plus any extraToolButtons) behind a single gear
  // icon. Desktop hides this via CSS @media; mobile-2026.css shows it.
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const mobileSettingsRef = useRef(null)
  const mobileSettingsTriggerRef = useRef(null)
  // Derived showVWAP for KD code compatibility
  const showVWAP = activeIndicators.vwap
  const setShowVWAP = (val) => setActiveIndicators(prev => ({ ...prev, vwap: typeof val === 'function' ? val(prev.vwap) : val }))
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, data: null })
  const [crosshair, setCrosshair] = useState({ visible: false, x: 0, y: 0, price: null, time: null, candle: null, candleX: 0 })
  const [redrawTrigger, setRedrawTrigger] = useState(0)
  const responsiveFrame = useResponsiveChartFrame(responsiveControls, chartFrameRef, chartControlsRef, setRedrawTrigger)
  const [tfDropdownOpen, setTfDropdownOpen] = useState(false)
  const [tfDropdownPos, setTfDropdownPos] = useState({ top: 0, right: 0 })
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1400)
  const chartDimensionsRef = useRef(null)
  // ── TA layer (highlight-to-analyse + drawing tools) ───────────────────────
  // The live drag lives in a ref so a marquee costs zero re-renders; only the
  // committed selection and its screen rect (for the floating action bar)
  // reach React state.
  const taDragRef = useRef(null)
  const [taSelRect, setTaSelRect] = useState(null)
  const taSelRectRef = useRef(null)
  const taRevealRef = useRef(1)
  const taRevealRafRef = useRef(null)
  const taGleamRef = useRef(1)
  const taGleamRafRef = useRef(null)
  const annotationPinsRef = useRef([])
  // DOM-rendered note-pin positions. Mirrors annotationPinsRef so we can
  // paint icons + CSS animations instead of a flat canvas circle.
  const [domPins, setDomPins] = useState([])
  const domPinsRef = useRef([])
  // IDs that have already been rendered — used to mark a pin as "new" exactly
  // once so the entrance animation only plays on first appearance.
  const seenPinIdsRef = useRef(new Set())
  const tfDropdownBtnRef = useRef(null)
  const [hoveredMention, setHoveredMention] = useState(null)
  
  // Zoom and axis scaling
  // Default zoom = 1 = full view (shows ALL candles). User zooms in from here.
  const [zoomLevel, setZoomLevel] = useState(1)
  const [priceZoom, setPriceZoom] = useState(1) // 1 = 100% (vertical/price zoom)
  const [autoFitPrice, setAutoFitPrice] = useState(true) // Auto-fit price to visible candles
  const [priceAxisWidth, setPriceAxisWidth] = useState(75)
  const [timeAxisHeight] = useState(50) // Reduced time axis for more chart space
  const [isDraggingPriceAxis, setIsDraggingPriceAxis] = useState(false)
  const [isDraggingTimeAxis, setIsDraggingTimeAxis] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, value: 0 })
  
  // Chart panning (horizontal + vertical scroll) with momentum - TradingView style
  const [panOffset, setPanOffset] = useState(0) // Horizontal offset in candles (positive = looking at older data)
  const [priceOffset, setPriceOffset] = useState(0) // Vertical offset as percentage of price range
  // Pan-active flag is a REF, not state: setState here re-rendered the whole
  // component AT DRAG START, and the early pointermoves were dropped while the
  // render was pending (the move guard read stale state) - every drag began
  // with a dead zone. The ref flips synchronously inside pointerdown, so the
  // very first move pans. Cursor feedback is applied imperatively.
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0, offset: 0, priceOff: 0 })
  const panModeRef = useRef(null)
  const panVelocityRef = useRef({ x: 0, y: 0 }) // Momentum velocity (x and y)
  const lastPanXRef = useRef(0) // Last pan position for velocity calculation
  const lastPanYRef = useRef(0) // Last pan Y position
  const lastPanTimeRef = useRef(0) // Last pan time
  const momentumAnimationRef = useRef(null) // Animation frame for momentum
  const scrollToNowAnimRef = useRef(null) // Animation frame for "scroll to latest" button
  // Refs for RAF-throttled pan rendering (avoid state update per mouse move)
  const panOffsetRef = useRef(0)
  const priceOffsetRef = useRef(0)
  const rafPanRef = useRef(null)
  const drawChartRef = useRef(null) // Holds canvas draw function for direct RAF calls
  // Multi-pointer tracking for touch: single-finger pan + 2-finger pinch-zoom
  const activePointersRef = useRef(new Map())
  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 1, anchorRatio: 0.5, startPanOffset: 0 })
  // Refs mirroring zoom state so wheel handler can update at 60fps via RAF
  // without queuing a React state update (and full re-render) per wheel event
  const resetTimeViewRef = useRef(() => {})
  const zoomLevelRef = useRef(1)
  const priceZoomRef = useRef(1)
  const rafZoomRef = useRef(null)
  const zoomSyncTimerRef = useRef(null)
  useEffect(() => { zoomLevelRef.current = zoomLevel }, [zoomLevel])
  useEffect(() => { priceZoomRef.current = priceZoom }, [priceZoom])
  const liveTokenDataRef = useRef(liveTokenData) // Avoid canvas redraw on every token data poll
  if (liveTokenData) liveTokenDataRef.current = liveTokenData

  // Line chart color themes - small dropdown picker
  const LINE_THEMES = [
    { id: 'auto',   label: 'Auto',   colors: null }, // uses trend-based cyan/violet
    { id: 'logo',   label: 'Logo',   colors: null, kind: 'logo' },     // real logo gradient (SOL purple->green)
    { id: 'updown', label: 'Up / Down', colors: null, kind: 'baseline' }, // green above / red below the period open
    { id: 'cyan',   label: 'Cyan',   colors: ['#06b6d4', '#14b8a6', '#2dd4bf', '#5eead4'] },
    { id: 'purple', label: 'Purple', colors: ['#a855f7', '#8b5cf6', '#c084fc', '#d8b4fe'] },
    { id: 'green',  label: 'Green',  colors: ['#22c55e', '#16a34a', '#4ade80', '#86efac'] },
    { id: 'gold',   label: 'Gold',   colors: ['#f59e0b', '#d97706', '#fbbf24', '#fde68a'] },
    { id: 'rose',   label: 'Rose',   colors: ['#f43f5e', '#e11d48', '#fb7185', '#fda4af'] },
    { id: 'blue',   label: 'Blue',   colors: ['#3b82f6', '#2563eb', '#60a5fa', '#93c5fd'] },
    { id: 'white',  label: 'White',  colors: ['#e2e8f0', '#cbd5e1', '#f1f5f9', '#f8fafc'] },
    { id: 'black',  label: 'Black',  colors: ['#1e293b', '#334155', '#475569', '#64748b'] },
  ]
  const [lineColorTheme, setLineColorTheme] = useState('auto')
  const [lineColorOpen, setLineColorOpen] = useState(false)
  const [lineColorPos, setLineColorPos] = useState(null)
  const lineColorRef = useRef(null)
  const lineColorDropdownRef = useRef(null)

  // Chart brightness lever — a CSS filter on the canvas (GPU-cheap, no redraw).
  // Lets the user lift the deliberately-dark chart to taste, or dim it. Persisted.
  const [chartBrightness, setChartBrightness] = useState(() => {
    const v = parseFloat(localStorage.getItem('spectre-chart-brightness'))
    return Number.isFinite(v) && v >= 0.7 && v <= 1.6 ? v : 1
  })
  const [brightnessOpen, setBrightnessOpen] = useState(false)
  const [brightnessPos, setBrightnessPos] = useState(null)
  const brightnessRef = useRef(null)
  const brightnessPopRef = useRef(null)
  useEffect(() => {
    try { localStorage.setItem('spectre-chart-brightness', String(chartBrightness)) } catch { /* private mode */ }
  }, [chartBrightness])
  // Outside-click close — the popover is portalled to <body>, so check BOTH the
  // trigger and the popover (else dragging the slider would close it).
  useEffect(() => {
    if (!brightnessOpen) return
    const onDown = (e) => {
      const inTrigger = brightnessRef.current && brightnessRef.current.contains(e.target)
      const inPop = brightnessPopRef.current && brightnessPopRef.current.contains(e.target)
      if (!inTrigger && !inPop) setBrightnessOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [brightnessOpen])
  // Anchor the portalled popover to the trigger (the toolbar has overflow:hidden,
  // so an in-flow absolute popover gets clipped — same reason the line-color
  // dropdown portals to body).
  useEffect(() => {
    if (!brightnessOpen) return
    const update = () => {
      const el = brightnessRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const POP_W = 184
      const left = Math.max(8, Math.min(r.right - POP_W, window.innerWidth - POP_W - 8))
      setBrightnessPos({ top: r.bottom + 8, left })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [brightnessOpen])
  // Brightness lever: a CSS filter on the CANVAS (only). Mode-aware so it never
  // muddies the backdrop (2026-07-02):
  //  - Dark mode: brightness + saturate → the bright DATA (line/candles/volume)
  //    pops while the near-black bg barely moves.
  //  - Day mode: brightness() would darken the WHITE bg to gray (the bug Sunny
  //    hit at 70%). Use contrast() instead → the dark line pops on white and the
  //    white background stays white.
  const chartFilter = chartBrightness === 1
    ? undefined
    : dayMode
      // Day: NEVER dim contrast below 1 (that greyed the white bg at <100%). The
      // dim direction only desaturates the line (white has no saturation to lose,
      // so the backdrop stays pure white); the pop direction adds contrast.
      ? `contrast(${Math.max(1, 1 + (chartBrightness - 1) * 0.55).toFixed(3)}) saturate(${(1 + (chartBrightness - 1) * 0.5).toFixed(3)})`
      : `brightness(${chartBrightness}) saturate(${(1 + (chartBrightness - 1) * 0.45).toFixed(3)})`

  // Close line color dropdown on outside click
  useEffect(() => {
    if (!lineColorOpen) return
    const handleClickOutside = (e) => {
      const inTrigger = lineColorRef.current && lineColorRef.current.contains(e.target)
      const inDropdown = lineColorDropdownRef.current && lineColorDropdownRef.current.contains(e.target)
      if (!inTrigger && !inDropdown) {
        setLineColorOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [lineColorOpen])

  // Reposition line-color dropdown anchored to its trigger button (uses portal
  // to escape chart overflow:hidden / lower stacking context)
  useEffect(() => {
    if (!lineColorOpen) return
    const update = () => {
      const el = lineColorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setLineColorPos({ top: r.bottom + 6, left: r.left + r.width / 2 })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [lineColorOpen])

  // Close indicator dropdown on outside click
  useEffect(() => {
    if (!indicatorDropdownOpen) return
    const handleClickOutside = (e) => {
      const inDropdown = indicatorDropdownRef.current && indicatorDropdownRef.current.contains(e.target)
      const inTrigger = indicatorTriggerRef.current && indicatorTriggerRef.current.contains(e.target)
      if (!inDropdown && !inTrigger) {
        setIndicatorDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [indicatorDropdownOpen])

  // Reposition indicator dropdown anchored to its trigger button
  useEffect(() => {
    if (!indicatorDropdownOpen) return
    const update = () => {
      const el = indicatorTriggerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setIndicatorDropdownPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [indicatorDropdownOpen])

  // Mobile settings dropdown — same lifecycle as indicators
  useEffect(() => {
    if (!mobileSettingsOpen) return
    const handleClickOutside = (e) => {
      const inMenu = mobileSettingsRef.current && mobileSettingsRef.current.contains(e.target)
      const inTrigger = mobileSettingsTriggerRef.current && mobileSettingsTriggerRef.current.contains(e.target)
      if (!inMenu && !inTrigger) setMobileSettingsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [mobileSettingsOpen])

  // Body-scroll lock while the settings sheet is open (bottom-sheet UX).
  useEffect(() => {
    if (!mobileSettingsOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mobileSettingsOpen])

  useEffect(() => {
    if (!mobileSettingsOpen || !responsiveControls) return
    const sheet = mobileSettingsRef.current
    const previousFocus = document.activeElement
    sheet?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setMobileSettingsOpen(false)
      } else if (event.key === 'Tab') {
        const items = Array.from(sheet?.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]') || [])
        const first = items[0], last = items[items.length - 1]
        if (!first) { event.preventDefault(); sheet?.focus(); return }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
          event.preventDefault(); last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      // An action may have opened another sheet; do not steal its focus.
      if (!document.activeElement || document.activeElement === document.body || sheet?.contains(document.activeElement)) {
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
      }
    }
  }, [mobileSettingsOpen, responsiveControls])

  // Voice control — full chart control via speech commands
  const { isListening: voiceListening, isSupported: voiceSupported, lastCommand: voiceCommand, toggleVoice } = useChartVoiceControl({
    // Timeframe & chart type
    onTimeframe: (tf) => setTimeframe(tf),
    onChartType: (type) => {
      setChartType(type)
      if (chartViewMode === 'xBubbles' && setChartViewMode) setChartViewMode('trading')
    },
    // View mode (trading / xChart / xBubbles)
    onChartViewMode: (mode) => { if (setChartViewMode) setChartViewMode(mode) },
    // Token switching
    onSymbolChange: (sym) => { if (onSymbolChange) onSymbolChange(sym) },
    // Line color theme
    onLineColor: (color) => setLineColorTheme(color),
    // Toggles
    onToggleHeatmap: () => setHeatmapEnabled(h => !h),
    onToggleATH: () => setShowATHLines(a => !a),
    onToggleFullscreen: () => setIsFullscreen(true),
    onExitFullscreen: () => setIsFullscreen(false),
    // Y-axis
    onYAxisMode: (mode) => setYAxisMode(mode),
    // Zoom
    onZoomIn: () => setZoomLevel(z => Math.max(MIN_CHART_ZOOM, Math.min(z * 1.5, 20))),
    onZoomOut: () => setZoomLevel(z => Math.max(z / 1.5, MIN_CHART_ZOOM)),
    onResetZoom: () => { resetTimeViewRef.current(); setPriceZoom(1); setPriceOffset(0); priceOffsetRef.current = 0; setAutoFitPrice(true) },
    // Pan / scroll
    onScrollLeft: () => setPanOffset(p => { const v = p + 20; panOffsetRef.current = v; return v }),
    onScrollRight: () => setPanOffset(p => { const v = Math.max(0, p - 20); panOffsetRef.current = v; return v }),
    // X Bubbles view & camera
    onSet3D: () => setViewMode('3D'),
    onSet2D: () => setViewMode('2D'),
    onResetCamera: () => setCamera({ x: 0, y: 0, z: 800, rotX: 0, rotY: 0 }),
    // Auto-fit
    onAutoFit: () => { setPriceZoom(1); setPriceOffset(0); priceOffsetRef.current = 0; setAutoFitPrice(true) },
    // Indicators
    onAddIndicator: (key) => setActiveIndicators(prev => ({ ...prev, [key]: true })),
    onRemoveIndicator: (key) => setActiveIndicators(prev => ({ ...prev, [key]: false })),
    onClearIndicators: () => setActiveIndicators({ ema9: false, ema21: false, ema50: false, ema200: false, sma20: false, sma50: false, sma200: false, bb: false, vwap: false, srzones: false }),
  })

  // Stable ref for toggleVoice so it doesn't trigger re-render loops
  const toggleVoiceRef = useRef(toggleVoice)
  toggleVoiceRef.current = toggleVoice

  // TA context is read through a ref, not captured in the handle's closure —
  // the handle is memoized on the voice deps, so a captured candleData would
  // go stale the moment new bars merge in.
  const taContextRef = useRef({ bars: [], resolution: '60', timeframe: '1H' })

  // Expose voice control + the TA read to the parent via imperative handle
  useImperativeHandle(ref, () => ({
    voice: { isListening: voiceListening, isSupported: voiceSupported, lastCommand: voiceCommand, toggleVoice },
    /** The bars the user is actually looking at, with the resolution they were
     *  fetched at. In TV mode the visible window comes from TV, not from our
     *  canvas geometry — the two engines frame different ranges. */
    getTaContext: () => {
      const base = taContextRef.current
      if (!base?.isTv) return base
      const tvRes = getTvResolutionMinutes(tvChartApiRef.current)
      return {
        ...base,
        visibleRange: getTvVisibleRange(tvChartApiRef.current),
        // TV's own interval wins over the app's timeframe setting here.
        resolution: tvRes ? String(tvRes) : base.resolution,
      }
    },
    /**
     * Drive the chart to a time window. This is what lets the agent take the
     * wheel in Play mode — zoom to the pattern it is describing instead of
     * asking the reader to find it.
     */
    focusRange: ({ fromTs, toTs } = {}) => {
      if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || toTs <= fromTs) return
      const base = taContextRef.current
      if (base?.isTv) {
        try { tvChartApiRef.current?.setVisibleRange({ from: Math.round(fromTs / 1000), to: Math.round(toTs / 1000) }) } catch { /* TV busy */ }
        return
      }
      const bars = base?.bars || []
      if (bars.length < 5) return
      const tsOfBar = (b) => (b?.date instanceof Date ? b.date.getTime() : (typeof b?.date === 'number' ? b.date : null))
      let iFrom = 0, iTo = bars.length - 1
      let dF = Infinity, dT = Infinity
      for (let i = 0; i < bars.length; i++) {
        const t = tsOfBar(bars[i])
        if (t == null) continue
        const a1 = Math.abs(t - fromTs); if (a1 < dF) { dF = a1; iFrom = i }
        const a2 = Math.abs(t - toTs);   if (a2 < dT) { dT = a2; iTo = i }
      }
      if (iTo <= iFrom) return
      // A little air either side so the pattern is not flush against the edges.
      const pad = Math.max(2, Math.round((iTo - iFrom) * 0.12))
      const from = Math.max(0, iFrom - pad)
      const to = Math.min(bars.length - 1, iTo + pad)
      const visible = Math.max(12, to - from + 1)
      const zoom = Math.max(MIN_CHART_ZOOM, bars.length / visible)
      const pan = Math.max(0, bars.length - 1 - to)
      zoomLevelRef.current = zoom
      panOffsetRef.current = pan
      setZoomLevel(zoom)
      setPanOffset(pan)
      setAutoFitPrice(true)
      if (drawChartRef.current) drawChartRef.current()
    },

    /** Remove every TradingView shape this feature put on the chart. */
    clearTaShapes: () => {
      const chart = tvChartApiRef.current
      if (!chart) return
      clearTaTvEntities(chart, tvTaIdsRef)
      for (const ids of [tvSelIdsRef, tvDrawIdsRef]) {
        for (const id of ids.current) { try { chart.removeEntity(id) } catch { /* already gone */ } }
        ids.current = []
      }
    },
  }), [voiceListening, voiceSupported, voiceCommand, toggleVoice])

  // Notify parent of voice state changes — only primitive values in deps
  const onVoiceStateChangeRef = useRef(onVoiceStateChange)
  onVoiceStateChangeRef.current = onVoiceStateChange
  useEffect(() => {
    onVoiceStateChangeRef.current?.({ isListening: voiceListening, isSupported: voiceSupported, lastCommand: voiceCommand, toggleVoice: toggleVoiceRef.current })
  }, [voiceListening, voiceSupported, voiceCommand])

  // X Mentions data - KOL and community mentions mapped to price action
  const xMentions = [
    { id: 1, user: 'Crypto Banter', avatar: 'https://api.dicebear.com/7.x/lorelei/svg?seed=CryptoBanter&backgroundColor=ff6b35', candleIndex: 8, sentiment: 'bullish', content: 'Just reviewed @Spectre__AI - legit project!', likes: 2341 },
    { id: 2, user: 'Lark Davis', avatar: 'https://api.dicebear.com/7.x/lorelei/svg?seed=LarkDavis&backgroundColor=2563eb', candleIndex: 15, sentiment: 'bullish', content: 'AI-assisted trading is the future 👀', likes: 1892 },
    { id: 3, user: 'CryptoWhale', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=whale&backgroundColor=6366f1', candleIndex: 22, sentiment: 'bullish', content: 'Accumulated more $SPECTRE 🔥', likes: 567 },
    { id: 4, user: 'Altcoin Daily', avatar: 'https://api.dicebear.com/7.x/lorelei/svg?seed=AltcoinDaily&backgroundColor=dc2626', candleIndex: 28, sentiment: 'bullish', content: 'Bloomberg Terminal for crypto!', likes: 3456 },
    { id: 5, user: 'DeFi Marcus', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=marcus&backgroundColor=8b5cf6', candleIndex: 35, sentiment: 'neutral', content: 'Saved me from a rug pull', likes: 423 },
    { id: 6, user: 'Coin Bureau', avatar: 'https://api.dicebear.com/7.x/lorelei/svg?seed=CoinBureau&backgroundColor=0ea5e9', candleIndex: 42, sentiment: 'bullish', content: 'Rug pull detection is impressive!', likes: 4521 },
    { id: 7, user: 'Spectre AI', avatar: '/round-logo.png', candleIndex: 48, sentiment: 'announcement', content: '🚀 New feature: AI analytics live!', likes: 1247 },
    { id: 8, user: 'AlphaSeeker', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alpha&backgroundColor=06b6d4', candleIndex: 52, sentiment: 'bullish', content: '4 out of 5 trades profitable 📈', likes: 312 },
  ]

  // X Bubbles initial data - KOL network connections
  // Categories: 'main' (green), 'project' (pink), 'top5' (yellow), 'kol100k' (orange), 'kolUnder100k' (purple)
  const initialBubblesData = [
    { id: 0, user: 'Spectre AI', handle: '@Spectre__AI', avatar: '/logo.png', followers: '125K', followersNum: 125000, size: 'center', x: 50, y: 50, category: 'main', timestamp: Date.now() - 3600000 },
    { id: 1, user: 'Crypto Banter', handle: '@CryptoBanter', avatar: 'https://api.dicebear.com/7.x/lorelei/svg?seed=CryptoBanter&backgroundColor=ff6b35', followers: '892K', followersNum: 892000, size: 'large', x: 75, y: 25, category: 'top5', timestamp: Date.now() - 7200000 },
    { id: 2, user: 'Lark Davis', handle: '@TheCryptoLark', avatar: 'https://api.dicebear.com/7.x/lorelei/svg?seed=LarkDavis&backgroundColor=2563eb', followers: '456K', followersNum: 456000, size: 'large', x: 85, y: 55, category: 'top5', timestamp: Date.now() - 1800000 },
    { id: 3, user: 'Altcoin Daily', handle: '@AltcoinDailyio', avatar: 'https://api.dicebear.com/7.x/lorelei/svg?seed=AltcoinDaily&backgroundColor=dc2626', followers: '1.2M', followersNum: 1200000, size: 'xlarge', x: 70, y: 75, category: 'top5', timestamp: Date.now() - 86400000 },
    { id: 4, user: 'Coin Bureau', handle: '@coinbureau', avatar: 'https://api.dicebear.com/7.x/lorelei/svg?seed=CoinBureau&backgroundColor=0ea5e9', followers: '2.1M', followersNum: 2100000, size: 'xlarge', x: 25, y: 70, category: 'top5', timestamp: Date.now() - 172800000 },
    { id: 5, user: 'CryptoWhale', handle: '@cryptowhale_io', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=whale&backgroundColor=6366f1', followers: '234K', followersNum: 234000, size: 'medium', x: 15, y: 40, category: 'kol100k', timestamp: Date.now() - 3600000 },
    { id: 6, user: 'DeFi Marcus', handle: '@defi_marcus', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=marcus&backgroundColor=8b5cf6', followers: '87K', followersNum: 87000, size: 'small', x: 20, y: 15, category: 'kolUnder100k', timestamp: Date.now() - 300000 },
    { id: 7, user: 'AlphaSeeker', handle: '@alpha_seeker', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alpha&backgroundColor=06b6d4', followers: '156K', followersNum: 156000, size: 'medium', x: 40, y: 20, category: 'kol100k', timestamp: Date.now() - 600000 },
    { id: 8, user: 'Trader Joe', handle: '@traderjoe_eth', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=joe&backgroundColor=10b981', followers: '45K', followersNum: 45000, size: 'small', x: 90, y: 80, category: 'kolUnder100k', timestamp: Date.now() - 1800000 },
    { id: 9, user: 'Wizz', handle: '@WizzCrypto', avatar: 'https://api.dicebear.com/7.x/lorelei/svg?seed=Wizz&backgroundColor=f59e0b', followers: '14.1K', followersNum: 14100, size: 'small', x: 60, y: 85, category: 'kolUnder100k', timestamp: Date.now() - 2592000000 },
    { id: 10, user: 'Palm AI', handle: '@PalmAI_', avatar: 'https://api.dicebear.com/7.x/shapes/svg?seed=PalmAI&backgroundColor=22c55e', followers: '67K', followersNum: 67000, size: 'medium', x: 35, y: 80, category: 'project', timestamp: Date.now() - 604800000 },
  ]
  
  // X Bubbles Filter State
  const [legendFilter, setLegendFilter] = useState({
    main: true,
    project: true,
    top5: true,
    kol100k: true,
    kolUnder100k: true
  })
  const [timeFilter, setTimeFilter] = useState('all')
  const [followersRange, setFollowersRange] = useState({ min: '', max: '' })
  const [legendDropdownOpen, setLegendDropdownOpen] = useState(false)
  const [timeDropdownOpen, setTimeDropdownOpen] = useState(false)
  const [followersDropdownOpen, setFollowersDropdownOpen] = useState(false)
  
  // Time filter options
  const timeFilterOptions = [
    { value: 'all', label: t('chart.allTime'), ms: null },
    { value: '5m', label: t('chart.last5min'), ms: 5 * 60 * 1000 },
    { value: '30m', label: t('chart.last30min'), ms: 30 * 60 * 1000 },
    { value: '1h', label: t('chart.last1hour'), ms: 60 * 60 * 1000 },
    { value: '6h', label: t('chart.last6hours'), ms: 6 * 60 * 60 * 1000 },
    { value: '24h', label: t('chart.last24hours'), ms: 24 * 60 * 60 * 1000 },
    { value: '1w', label: t('chart.last1week'), ms: 7 * 24 * 60 * 60 * 1000 },
    { value: '1M', label: t('chart.last1month'), ms: 30 * 24 * 60 * 60 * 1000 },
    { value: '3M', label: t('chart.last3months'), ms: 90 * 24 * 60 * 60 * 1000 },
    { value: '6M', label: t('chart.last6months'), ms: 180 * 24 * 60 * 60 * 1000 },
    { value: '1y', label: t('chart.last1year'), ms: 365 * 24 * 60 * 60 * 1000 },
  ]

  // Connections between bubbles [from, to]
  const bubbleConnections = [
    [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9], [0, 10], // All connect to center
    [1, 2], // Crypto Banter <-> Lark Davis
    [1, 7], // Crypto Banter <-> AlphaSeeker
    [2, 3], // Lark Davis <-> Altcoin Daily
    [3, 4], // Altcoin Daily <-> Coin Bureau
    [4, 5], // Coin Bureau <-> CryptoWhale
    [5, 6], // CryptoWhale <-> DeFi Marcus
    [6, 7], // DeFi Marcus <-> AlphaSeeker
    [8, 9], // Trader Joe <-> Wizz
    [9, 10], // Wizz <-> Palm AI
    [3, 9], // Altcoin Daily <-> Wizz
    [4, 10], // Coin Bureau <-> Palm AI
  ]

  // Physics simulation state - bubbles are stable by default
  // Spread bubbles across a larger 3D space for space flight experience
  const [bubblePhysics, setBubblePhysics] = useState(() => 
    initialBubblesData.map((b, index) => ({
      ...b,
      vx: 0, // velocity x - starts at 0 (stable)
      vy: 0, // velocity y - starts at 0 (stable)
      vz: 0, // velocity z - for 3D mode
      // Spread bubbles in a sphere around center, with center bubble at origin
      z: b.size === 'center' ? 0 : (Math.random() - 0.5) * 800,
      // Also randomize x/y slightly for 3D mode
      x3d: b.x + (b.size === 'center' ? 0 : (Math.random() - 0.5) * 20),
      y3d: b.y + (b.size === 'center' ? 0 : (Math.random() - 0.5) * 20),
    }))
  )
  
  // Filter bubbles based on all filters
  const getFilteredBubbles = useCallback(() => {
    if (!bubblePhysics || bubblePhysics.length === 0) return []
    
    return bubblePhysics.filter(bubble => {
      // Category filter - if category doesn't exist, show the bubble
      const category = bubble.category || 'kolUnder100k'
      if (legendFilter[category] === false) return false
      
      // Time filter - skip if 'all' time selected
      if (timeFilter && timeFilter !== 'all') {
        const timeOption = timeFilterOptions.find(opt => opt.value === timeFilter)
        if (timeOption && timeOption.ms && bubble.timestamp) {
          const now = Date.now()
          if (now - bubble.timestamp > timeOption.ms) return false
        }
      }
      
      // Followers range filter - skip if not set
      if (followersRange.min !== '' || followersRange.max !== '') {
        const followerCount = bubble.followersNum || 0
        const minFollowers = followersRange.min !== '' ? parseInt(followersRange.min) : 0
        const maxFollowers = followersRange.max !== '' ? parseInt(followersRange.max) : Infinity
        if (followerCount < minFollowers || followerCount > maxFollowers) return false
      }
      
      return true
    })
  }, [bubblePhysics, legendFilter, timeFilter, followersRange, timeFilterOptions])
  
  // Get category color for bubble border
  const getCategoryColor = (category) => {
    const colors = {
      main: '#22c55e',      // Green
      project: '#ec4899',   // Pink
      top5: '#eab308',      // Yellow
      kol100k: '#f97316',   // Orange
      kolUnder100k: '#a855f7' // Purple
    }
    return colors[category] || '#8b5cf6'
  }
  
  // Close filter dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      // Ignore clicks on share dropdown (rendered via portal)
      if (e.target.closest('.share-dropdown')) return
      
      if (!e.target.closest('.bubble-filter-dropdown')) {
        setLegendDropdownOpen(false)
        setTimeDropdownOpen(false)
        setFollowersDropdownOpen(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])
  
  const [selectedBubble, setSelectedBubble] = useState(null)
  const [draggingBubble, setDraggingBubble] = useState(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [viewMode, setViewMode] = useState('3D') // '2D' or '3D'
  
  // 3D Camera state - expanded range for space flight
  const [camera, setCamera] = useState({ x: 0, y: 0, z: 800, rotX: 0, rotY: 0 })
  const [isNavigating, setIsNavigating] = useState(false)
  const [navigationMode, setNavigationMode] = useState(null) // 'pan', 'rotate', 'forward'
  const [flightSpeed, setFlightSpeed] = useState(0) // Current forward velocity for smooth flight
  const [isWarpSpeed, setIsWarpSpeed] = useState(false) // Warp drive effect
  const [flightControlsCollapsed, setFlightControlsCollapsed] = useState(false)
  const lastMousePos = useRef({ x: 0, y: 0 })
  const keysPressed = useRef(new Set())
  
  const bubblesContainerRef = useRef(null)
  const animationRef = useRef(null)
  const mousePos = useRef({ x: 0, y: 0 })
  
  // Physics constants - tuned to match Bubblemaps feel
  const SPRING_STRENGTH = 0.008    // How strongly connected bubbles pull together
  const SPRING_LENGTH = 120        // Ideal distance between connected bubbles
  const REPULSION_STRENGTH = 800   // How strongly bubbles push apart
  const DAMPING = 0.92             // Friction (0.9 = bouncy, 0.99 = sluggish)
  const CENTER_GRAVITY = 0.0005    // Gentle pull toward center
  const MAX_VELOCITY = 8           // Speed limit

  // Physics simulation - only runs when dragging or settling
  useEffect(() => {
    if (chartViewMode !== 'xBubbles') {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      return
    }

    // When not dragging, gently settle any remaining movement
    if (draggingBubble === null) {
      // Check if any bubbles are still moving
      const stillMoving = bubblePhysics.some(b => Math.abs(b.vx) > 0.01 || Math.abs(b.vy) > 0.01)
      
      if (stillMoving) {
        // Smooth settle animation
        const settleFrame = () => {
          setBubblePhysics(prev => {
            const hasMotion = prev.some(b => Math.abs(b.vx) > 0.01 || Math.abs(b.vy) > 0.01)
            if (!hasMotion) return prev
            
            return prev.map(b => ({
              ...b,
              vx: b.vx * 0.88, // Gradual slowdown
              vy: b.vy * 0.88,
              x: b.x + b.vx * 0.6,
              y: b.y + b.vy * 0.6,
            }))
          })
        }
        
        // Run settle animation for a few frames
        const settleInterval = setInterval(settleFrame, 16)
        setTimeout(() => clearInterval(settleInterval), 500)
      }
      return
    }

    const simulate = () => {
      setBubblePhysics(prev => {
        const newState = prev.map(bubble => {
          // If being dragged, follow mouse with smooth easing
          if (draggingBubble === bubble.id) {
            const targetX = mousePos.current.x - dragOffset.x
            const targetY = mousePos.current.y - dragOffset.y
            
            // Smooth easing - slower, more organic follow (0.12 = very smooth)
            const easing = 0.12
            const newX = bubble.x + (targetX - bubble.x) * easing
            const newY = bubble.y + (targetY - bubble.y) * easing
            
            return {
              ...bubble,
              x: newX,
              y: newY,
              vx: (newX - bubble.x) * 0.8, // Gentle momentum transfer
              vy: (newY - bubble.y) * 0.8,
            }
          }

          let fx = 0, fy = 0 // Forces

          // 1. Spring forces - gentle pull toward connected bubbles
          bubbleConnections.forEach(([from, to]) => {
            let other = null
            if (from === bubble.id) other = prev.find(b => b.id === to)
            else if (to === bubble.id) other = prev.find(b => b.id === from)
            
            if (other) {
              const dx = other.x - bubble.x
              const dy = other.y - bubble.y
              const dist = Math.sqrt(dx * dx + dy * dy) || 1
              
              // Gentler spring force for organic movement
              const isConnectedToDragged = other.id === draggingBubble
              const springMult = isConnectedToDragged ? 1.5 : 0.5
              const force = (dist - SPRING_LENGTH / 5) * SPRING_STRENGTH * 0.5 * springMult
              
              fx += (dx / dist) * force
              fy += (dy / dist) * force
            }
          })

          // 2. Soft repulsion - very gentle push apart
          prev.forEach(other => {
            if (other.id === bubble.id) return
            const dx = bubble.x - other.x
            const dy = bubble.y - other.y
            const distSq = dx * dx + dy * dy || 1
            const dist = Math.sqrt(distSq)
            const minDist = 6
            
            if (dist < minDist * 2) {
              const force = (REPULSION_STRENGTH * 0.15) / distSq
              fx += (dx / dist) * force
              fy += (dy / dist) * force
            }
          })

          // 3. Apply forces with heavy damping for smooth movement
          let vx = (bubble.vx * 0.92 + fx * 0.5) // Blend velocity with force
          let vy = (bubble.vy * 0.92 + fy * 0.5)

          // 4. Lower max velocity for slower movement
          const maxSpeed = 3
          const speed = Math.sqrt(vx * vx + vy * vy)
          if (speed > maxSpeed) {
            vx = (vx / speed) * maxSpeed
            vy = (vy / speed) * maxSpeed
          }
          
          // Stop tiny movements
          if (Math.abs(vx) < 0.005) vx = 0
          if (Math.abs(vy) < 0.005) vy = 0

          // 5. Update position smoothly
          let newX = bubble.x + vx
          let newY = bubble.y + vy

          // 6. Soft bounds (ease back instead of hard clamp)
          if (newX < 8) newX = newX + (8 - newX) * 0.1
          if (newX > 92) newX = newX - (newX - 92) * 0.1
          if (newY < 10) newY = newY + (10 - newY) * 0.1
          if (newY > 90) newY = newY - (newY - 90) * 0.1

          return { ...bubble, x: newX, y: newY, vx, vy }
        })

        return newState
      })

      animationRef.current = requestAnimationFrame(simulate)
    }

    animationRef.current = requestAnimationFrame(simulate)
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [chartViewMode, draggingBubble, dragOffset])

  // Handle bubble drag start
  const handleBubbleMouseDown = (e, bubbleId) => {
    e.preventDefault()
    e.stopPropagation()
    
    const bubble = bubblePhysics.find(b => b.id === bubbleId)
    if (!bubble || !bubblesContainerRef.current) return

    const rect = bubblesContainerRef.current.getBoundingClientRect()
    const mouseX = ((e.clientX - rect.left) / rect.width) * 100
    const mouseY = ((e.clientY - rect.top) / rect.height) * 100
    
    mousePos.current = { x: mouseX, y: mouseY }
    setDraggingBubble(bubbleId)
    setDragOffset({ x: mouseX - bubble.x, y: mouseY - bubble.y })
  }

  // Track mouse movement globally
  const handleGlobalMouseMove = (e) => {
    if (!bubblesContainerRef.current) return
    const rect = bubblesContainerRef.current.getBoundingClientRect()
    mousePos.current = {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    }
  }

  const handleBubbleDragEnd = () => {
    setDraggingBubble(null)
  }

  // Global mouse listeners
  useEffect(() => {
    if (draggingBubble !== null) {
      window.addEventListener('mousemove', handleGlobalMouseMove)
      window.addEventListener('mouseup', handleBubbleDragEnd)
      return () => {
        window.removeEventListener('mousemove', handleGlobalMouseMove)
        window.removeEventListener('mouseup', handleBubbleDragEnd)
      }
    }
  }, [draggingBubble])

  // Get connected bubble IDs for styling
  const getConnectedBubbles = (bubbleId) => {
    const connected = new Set()
    bubbleConnections.forEach(([from, to]) => {
      if (from === bubbleId) connected.add(to)
      if (to === bubbleId) connected.add(from)
    })
    return connected
  }

  // Handle window resize for responsive timeframe selector
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1400)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Handle keyboard navigation for 3D mode + ESC for fullscreen
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false)
        return
      }
      
      // 3D Navigation keys (only in 3D mode and xBubbles view)
      if (viewMode === '3D' && chartViewMode === 'xBubbles') {
        keysPressed.current.add(e.key.toLowerCase())
      }
    }
    
    const handleKeyUp = (e) => {
      keysPressed.current.delete(e.key.toLowerCase())
    }
    
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [isFullscreen, viewMode, chartViewMode])
  
  // 3D Space Flight animation loop
  useEffect(() => {
    if (viewMode !== '3D' || chartViewMode !== 'xBubbles') return
    
    let animId
    const baseSpeed = 2
    const rotSpeed = 0.4
    const acceleration = 0.3
    const deceleration = 0.95
    const maxSpeed = 25
    const warpMultiplier = 4
    
    let currentVelocity = { x: 0, y: 0, z: 0 }
    
    const animate = () => {
      const keys = keysPressed.current
      const isWarp = keys.has('shift')
      setIsWarpSpeed(isWarp)
      
      const speedMult = isWarp ? warpMultiplier : 1
      
      // Target velocities based on input
      let targetVx = 0, targetVy = 0, targetVz = 0
      
      // Forward/Back (W/S) - main flight controls
      if (keys.has('w')) targetVz = baseSpeed * speedMult * 3
      if (keys.has('s')) targetVz = -baseSpeed * speedMult * 2
      
      // Strafe (A/D)
      if (keys.has('a')) targetVx = -baseSpeed * speedMult
      if (keys.has('d')) targetVx = baseSpeed * speedMult
      
      // Up/Down (Q/E) 
      if (keys.has('q')) targetVy = -baseSpeed * speedMult
      if (keys.has('e')) targetVy = baseSpeed * speedMult
      
      // Boost forward/backward (R/F)
      if (keys.has('r')) targetVz = baseSpeed * speedMult * 5
      if (keys.has('f')) targetVz = -baseSpeed * speedMult * 3
      
      // Smooth acceleration toward target
      currentVelocity.x += (targetVx - currentVelocity.x) * acceleration
      currentVelocity.y += (targetVy - currentVelocity.y) * acceleration
      currentVelocity.z += (targetVz - currentVelocity.z) * acceleration
      
      // Decelerate when no input
      if (targetVx === 0) currentVelocity.x *= deceleration
      if (targetVy === 0) currentVelocity.y *= deceleration
      if (targetVz === 0) currentVelocity.z *= deceleration
      
      // Clamp velocity
      currentVelocity.x = Math.max(-maxSpeed, Math.min(maxSpeed, currentVelocity.x))
      currentVelocity.y = Math.max(-maxSpeed, Math.min(maxSpeed, currentVelocity.y))
      currentVelocity.z = Math.max(-maxSpeed * 2, Math.min(maxSpeed * 2, currentVelocity.z))
      
      // Update flight speed for UI
      setFlightSpeed(Math.abs(currentVelocity.z))
      
      // Apply velocity and rotation
      const hasMovement = Math.abs(currentVelocity.x) > 0.01 || 
                          Math.abs(currentVelocity.y) > 0.01 || 
                          Math.abs(currentVelocity.z) > 0.01 ||
                          keys.size > 0
      
      if (hasMovement) {
        setCamera(prev => {
          let { x, y, z, rotX, rotY } = prev
          
          // Rotation with arrow keys (intuitive: arrow direction = look direction)
          if (keys.has('arrowleft')) rotY += rotSpeed
          if (keys.has('arrowright')) rotY -= rotSpeed
          if (keys.has('arrowup')) rotX -= rotSpeed
          if (keys.has('arrowdown')) rotX += rotSpeed
          
          // Clamp rotation (allow more freedom for space feel)
          rotX = Math.max(-80, Math.min(80, rotX))
          rotY = Math.max(-80, Math.min(80, rotY))
          
          // Convert rotation to radians for direction calculation
          const radX = (rotX * Math.PI) / 180
          const radY = (rotY * Math.PI) / 180
          
          // Transform velocity based on camera rotation (fly where you're looking)
          // W = fly toward center of screen, S = fly backward
          const forwardX = Math.sin(radY) * currentVelocity.z
          const forwardY = -Math.sin(radX) * currentVelocity.z
          const forwardZ = -Math.cos(radY) * Math.cos(radX) * currentVelocity.z
          
          // Strafe (X velocity) moves perpendicular to camera facing
          const strafeX = Math.cos(radY) * currentVelocity.x
          const strafeZ = Math.sin(radY) * currentVelocity.x
          
          // Up/down (Y velocity) stays in world space
          const verticalY = currentVelocity.y
          
          // Apply transformed velocity
          x += forwardX + strafeX
          y += forwardY + verticalY
          z += forwardZ + strafeZ
          
          // Extended Z range for deep space exploration
          z = Math.max(-500, Math.min(2000, z))
          
          // Extended X/Y range
          x = Math.max(-500, Math.min(500, x))
          y = Math.max(-500, Math.min(500, y))
          
          return { x, y, z, rotX, rotY }
        })
      }
      
      animId = requestAnimationFrame(animate)
    }
    
    animate()
    return () => cancelAnimationFrame(animId)
  }, [viewMode, chartViewMode])
  
  // 3D Mouse navigation handlers
  const handle3DMouseDown = (e) => {
    if (viewMode !== '3D') return
    
    e.preventDefault()
    lastMousePos.current = { x: e.clientX, y: e.clientY }
    
    if (e.button === 0) { // Left click - rotate
      setNavigationMode('rotate')
    } else if (e.button === 2) { // Right click - pan
      setNavigationMode('pan')
    } else if (e.button === 1) { // Middle click - forward/back
      setNavigationMode('forward')
    }
    setIsNavigating(true)
  }
  
  const handle3DMouseMove = (e) => {
    if (!isNavigating || viewMode !== '3D') return
    
    const dx = e.clientX - lastMousePos.current.x
    const dy = e.clientY - lastMousePos.current.y
    lastMousePos.current = { x: e.clientX, y: e.clientY }
    
    setCamera(prev => {
      let { x, y, z, rotX, rotY } = prev
      
      if (navigationMode === 'rotate') {
        // Intuitive: drag right = look right, drag up = look up
        rotY -= dx * 0.3
        rotX += dy * 0.3
        rotX = Math.max(-60, Math.min(60, rotX))
        rotY = Math.max(-60, Math.min(60, rotY))
      } else if (navigationMode === 'pan') {
        x -= dx * 0.5
        y -= dy * 0.5
      } else if (navigationMode === 'forward') {
        z -= dy * 2
        z = Math.max(100, Math.min(1500, z))
      }
      
      return { x, y, z, rotX, rotY }
    })
  }
  
  const handle3DMouseUp = () => {
    setIsNavigating(false)
    setNavigationMode(null)
  }
  
  const handle3DWheel = useCallback((e) => {
    if (viewMode !== '3D' || chartViewMode !== 'xBubbles') return
    
    e.preventDefault()
    e.stopPropagation()
    setCamera(prev => {
      let z = prev.z + e.deltaY * 1.5
      z = Math.max(-500, Math.min(2000, z))
      return { ...prev, z }
    })
  }, [viewMode, chartViewMode])
  
  // Attach wheel event to X Bubbles container with passive: false to prevent page scroll
  useEffect(() => {
    const container = bubblesContainerRef.current
    if (!container || chartViewMode !== 'xBubbles') return
    
    container.addEventListener('wheel', handle3DWheel, { passive: false })
    return () => {
      container.removeEventListener('wheel', handle3DWheel)
    }
  }, [handle3DWheel, chartViewMode])
  
  // Reset 3D camera - return to starting position
  const resetCamera = () => {
    setCamera({ x: 0, y: 0, z: 800, rotX: 0, rotY: 0 })
    setFlightSpeed(0)
  }
  
  // Handle ESC key to exit fullscreen (kept for backwards compatibility)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen])

  // Add/remove body class for fullscreen mode to hide other page elements
  useEffect(() => {
    if (isFullscreen) {
      if (chartViewMode === 'xBubbles') {
        document.body.classList.add('x-bubbles-fullscreen')
        document.body.classList.remove('chart-fullscreen')
      } else {
        document.body.classList.add('chart-fullscreen')
        document.body.classList.remove('x-bubbles-fullscreen')
      }
    } else {
      document.body.classList.remove('x-bubbles-fullscreen')
      document.body.classList.remove('chart-fullscreen')
    }
    return () => {
      document.body.classList.remove('x-bubbles-fullscreen')
      document.body.classList.remove('chart-fullscreen')
    }
  }, [isFullscreen, chartViewMode])

  // Force redraw after fullscreen toggle — need multiple redraws because
  // the browser may not have completed layout by the time useEffect fires
  useEffect(() => {
    // Immediate redraw (DOM committed but layout may still be pending)
    setRedrawTrigger(prev => prev + 1)

    // Second redraw after browser has completed layout
    const t1 = requestAnimationFrame(() => {
      setRedrawTrigger(prev => prev + 1)
    })

    // Safety redraw for slower browsers / transition edge cases
    const t2 = setTimeout(() => {
      setRedrawTrigger(prev => prev + 1)
    }, 350)

    return () => {
      cancelAnimationFrame(t1)
      clearTimeout(t2)
    }
  }, [isFullscreen])

  // Timeframe presets — CoinGecko line-only data uses range-based presets
  // (24H/7D/30D/90D/1Y) since CG market_chart granularity is determined by
  // the `days` query, not by sub-hour resolutions.
  const CRYPTO_TIMEFRAMES = ['1M', '5M', '15M', '30M', '1H', '4H', '12H', '1D', '1W', '1MO', '1Y', 'YTD', 'ALL']
  const CG_TIMEFRAMES = ['24H', '7D', '30D', '90D', '1Y', 'YTD', 'ALL']
  // Display labels (key → button text). Decouples the internal key from the
  // shown label so minutes read lowercase (1m/5m), the daily candle reads
  // "24h", and the NEW monthly key '1MO' shows as "1M" - the TradingView
  // convention (lowercase m = minute, uppercase M = month). (Gleb 2026-06-14)
  const TF_LABELS = {
    '1S': '1s', '1M': '1m', '5M': '5m', '15M': '15m', '30M': '30m',
    '1H': '1h', '4H': '4h', '12H': '12h', '1D': '24h', '1W': '1W',
    '1MO': '1M', '1Y': '1Y', 'YTD': 'YTD', 'ALL': 'ALL',
    '24H': '24H', '7D': '7D', '30D': '30D', '90D': '90D',
  }
  // Primary (always-visible) vs overflow ("More" dropdown) split per family.
  const CRYPTO_PRIMARY = ['5M', '1H', '1D', '1W', '1MO', '1Y', 'ALL']
  const CRYPTO_MORE = ['1M', '15M', '30M', '4H', '12H', 'YTD']
  const CG_PRIMARY = ['24H', '7D', '30D', '1Y', 'ALL']
  const CG_MORE = ['90D', 'YTD']
  const chartTypes = [
    { id: 'candles', label: t('chart.candles') },
    { id: 'line', label: t('chart.line') },
    { id: 'tradingview', label: t('chart.tradingView') },
    { id: 'x', label: '𝕏' },
  ]

  // TradingView embed - universal symbol resolution via centralized resolver
  // Supports: major crypto (CRYPTO:BTCUSD), CEX tokens (BINANCE:XXXUSDT),
  //           stocks (NASDAQ:AAPL), DEX tokens (UNISWAP:SPECTREWETH_8A6D95.USD)
  const sym = (token?.symbol || 'BTC').toUpperCase()

  // Synchronous resolution (covers ~95% of cases instantly)
  const syncTvResolution = useMemo(() =>
    resolveTradingViewSymbol(token, token?.isStock ? 'stocks' : 'crypto'),
    [token?.symbol, token?.address, token?.networkId, token?.isStock, token?.exchange]
  )

  // Async resolution: DEX tokens (Codex API) + universal TV search (any asset worldwide)
  const [asyncTvSymbol, setAsyncTvSymbol] = useState(null)
  const [tvLoading, setTvLoading] = useState(false)
  const tvFetchedRef = useRef(null)

  useEffect(() => {
    const source = syncTvResolution.source

    // Already resolved confidently - no async needed
    if (source !== 'needs-dex-resolution' && source !== 'needs-tv-search') {
      setAsyncTvSymbol(null)
      tvFetchedRef.current = null
      return
    }

    // Unique key for this resolution (avoid duplicate fetches)
    const fetchKey = source === 'needs-dex-resolution'
      ? `dex:${token?.address}`
      : `tv:${sym}:${token?.isStock ? 'stock' : 'crypto'}`
    if (tvFetchedRef.current === fetchKey) return
    tvFetchedRef.current = fetchKey

    setTvLoading(true)

    if (source === 'needs-dex-resolution') {
      // DEX token: resolve via Codex API, fallback to TV search
      const addr = token?.address
      if (!addr) { setTvLoading(false); return }
      resolveDexTradingViewSymbol(addr, token?.networkId || 1, sym)
        .then(data => {
          if (data.supported && data.symbol) {
            setAsyncTvSymbol(data.symbol)
          } else {
            // DEX resolution failed - try universal TV search as fallback
            return searchTradingViewSymbol(sym, 'crypto').then(tv => {
              setAsyncTvSymbol(tv.found ? tv.symbol : null)
            })
          }
        })
        .catch(() => setAsyncTvSymbol(null))
        .finally(() => setTvLoading(false))
    } else {
      // Unknown token/stock: resolve via TradingView search API
      const type = token?.isStock ? 'stock' : 'crypto'
      searchTradingViewSymbol(sym, type)
        .then(data => setAsyncTvSymbol(data.found ? data.symbol : null))
        .catch(() => setAsyncTvSymbol(null))
        .finally(() => setTvLoading(false))
    }
  }, [token?.address, token?.networkId, token?.isStock, sym, syncTvResolution.source])

  const hasTradingViewSupport = syncTvResolution.confident || !!asyncTvSymbol || !!token?.address
  const tradingViewSymbol = syncTvResolution.confident
    ? syncTvResolution.symbol
    : (asyncTvSymbol || syncTvResolution.symbol || `CRYPTO:${sym}USD`)
  const tradingViewTheme = dayMode ? 'light' : 'dark'
  const tradingViewToolbarBg = dayMode ? '%23f8fafc' : '%2313161c'
  const tradingViewEmbedUrl = `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tradingViewSymbol)}&interval=60&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=${tradingViewToolbarBg}&studies=%5B%5D&theme=${tradingViewTheme}&style=1&locale=en`


  // Map timeframe to Codex resolution
  const timeframeToResolution = {
    '1S': '1S',
    '1M': '1',
    '5M': '5',
    '15M': '15',
    '30M': '30',
    '1H': '60',
    '4H': '240',
    '12H': '720',
    // Range presets (Sunny 2026-07-01): these buttons are labelled as RANGES
    // ("24h"/"1W"/"1M"), so each fetches+shows exactly its labelled window with a
    // sensible intraday/daily resolution instead of daily/weekly candles over the
    // FULL multi-year history (which made "24h" start at $20k two years back).
    '1D': '5',     // "24h" -> 5m candles over the last 24h
    '1W': '60',    // "1W"  -> 1h candles over the last 7d
    '1MO': '240',  // "1M"  -> 4h candles over the last 30d
    // CoinGecko range presets — resolution maps to the CG market_chart bucket
    // implied by the `days` query (1d→5min, 2-90d→hourly, >90d→daily).
    '24H': '5',
    '7D': '60',
    '30D': '60',
    '90D': '240',
    '1Y': '1D',
    // Long-range presets — daily bars since Jan 1 / weekly bars for full history
    'YTD': '1D',
    'ALL': '1W',
  }
  // Resolution in MINUTES for the TA layer (the '1D'/'1W' strings above are
  // Codex resolution tokens, not durations — the brief needs real minutes so it
  // can say "12 × 4H bars" honestly).
  const RES_MINUTES = { '1S': 1 / 60, '1': 1, '5': 5, '15': 15, '30': 30, '60': 60, '240': 240, '720': 720, '1D': 1440, '1W': 10080 }

  // Hours elapsed since Jan 1 of the current year (min 24 so a Jan 1st visit
  // still fetches a day of data)
  const ytdHours = Math.max(24, Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 3600000))

  // Map timeframe to hours of data to fetch
  // API has a 1500 datapoint limit per request, so we stay under that
  // Lazy loading will fetch more history when user scrolls left
  const timeframeToPeriod = {
    '1S': 0.5,      // 30 min (~1800 candles)
    '1M': 24,       // 1 day (~1440 candles) - max safe is ~25 hours
    '5M': 115,      // ~4.8 days (~1380 candles) - max safe is ~125 hours
    '15M': 350,     // ~14.5 days (~1400 candles) - max safe is ~375 hours
    '30M': 700,     // ~29 days (~1400 candles)
    '1H': 1400,     // ~58 days (~1400 candles) - max safe is ~1500 hours
    '4H': 5600,     // ~233 days (~1400 candles) - max safe is ~6000 hours
    '12H': 16800,   // ~2 years (~1400 candles)
    // Fetch a generous BUFFER (~4x the labelled range) so the user can scroll /
    // zoom back into it; the chart still DEFAULT-views exactly the labelled range
    // (see RANGE_VISIBLE below). Lazy-load extends past the buffer.
    '1D': 96,       // "24h": fetch 4d of 5m (1152), default-view last 24h (288)
    '1W': 720,      // "1W":  fetch 30d of 1h (720), default-view last 7d (168)
    '1MO': 2880,    // "1M":  fetch 120d of 4h (720), default-view last 30d (180)
    // CoinGecko range presets in hours
    '24H': 24,
    '7D': 168,
    '30D': 720,
    '90D': 2160,
    '1Y': 26280,    // fetch 3y of daily (~1095), default-view last 1y (365) so you
                    // can scroll/zoom PAST a year into older history (+ lazy-load)
    'YTD': ytdHours,
    'ALL': 235200,  // ~27 years of weekly bars - full history for any asset
  }

  // Period length in ms (for congruent live candle: only update last bar if still in same period)
  const timeframeToPeriodMs = {
    '1S': 1000,
    '1M': 1 * 60 * 1000,
    '5M': 5 * 60 * 1000,
    '15M': 15 * 60 * 1000,
    '30M': 30 * 60 * 1000,
    '1H': 60 * 60 * 1000,
    '4H': 4 * 60 * 60 * 1000,
    '12H': 12 * 60 * 60 * 1000,
    '1D': 5 * 60 * 1000,       // 5m candle ("24h" range)
    '1W': 60 * 60 * 1000,      // 1h candle ("1W" range)
    '1MO': 4 * 60 * 60 * 1000, // 4h candle ("1M" range)
    '24H': 24 * 60 * 60 * 1000,
    '7D': 7 * 24 * 60 * 60 * 1000,
    '30D': 30 * 24 * 60 * 60 * 1000,
    '90D': 90 * 24 * 60 * 60 * 1000,
    '1Y': 365 * 24 * 60 * 60 * 1000,
    'YTD': 24 * 60 * 60 * 1000,
    'ALL': 7 * 24 * 60 * 60 * 1000,
  }
  
  // Get symbol for chart data.
  // RULE (2026-06-11, post-audit): ADDRESS-FIRST. address:networkId whenever
  // the token has an on-chain address; bare ticker only for address-less
  // assets (XRP-class). The server's reverse-map (registry bundled via
  // vercel.json includeFiles, #aa15431e) routes address-form majors to the
  // Binance tier - WBTC's contract serves BTCUSDT klines. A ticker-first
  // client rule was tried and REVERTED same day: any DEX token whose symbol
  // collides with a Binance ticker (a degen named "SOL") got charted as the
  // Binance asset, and ticker-keyed bars mixed with address-keyed SSE ticks.
  // The address is unambiguous; let the server decide the data source.
  const tokenSymbol = (token?.symbol || '').toUpperCase()
  const tokenAddress = token?.address || null
  const chartNetworkId = token?.networkId || 1
  const chartSymbol = tokenAddress
    ? `${tokenAddress}:${chartNetworkId}`
    : (tokenSymbol || 'SPECTRE')

  // IDENTITY STILL RESOLVING (2026-08-26, the "Chart unavailable" flash).
  // The page mounts this chart before the parent's resolve chain has an
  // address, so we used to fire a BARE-TICKER /api/bars, get no_data, and
  // paint a hard "Chart unavailable / CHART DATA UNAVAILABLE FOR THIS TOKEN"
  // — a lie that corrects itself a second later when the address lands
  // (founder report on USYC). It also latched the TV widget's no-data
  // fail-open onto the DexScreener embed for that moment.
  // While the parent says "still resolving" AND we have no address to chart
  // by: fetch nothing, mount nothing, show the shimmer. `identityPending` is
  // opt-in, so every other surface (home panel, traders-corner, heatmaps)
  // behaves exactly as before.
  const identityUnready = !!identityPending && !tokenAddress

  // Token brand color: curated → server KV → canvas extraction → hash.
  // Used for TradingView chart line + Canvas line/area gradient fallback.
  const tokenBrand = useTokenBrandColor(tokenSymbol, token?.logo, tokenAddress)
  const tokenBrandHex = tokenBrand.hex
  const tokenBrandRgb = tokenBrand.rgb

  // CSS background for a line-theme swatch/dot (dropdown + trigger). Handles the
  // gradient-preview themes (auto = brand, logo = real logo gradient, updown =
  // green/red split) that have no single `colors[0]`.
  const lineThemeSwatch = (id) => {
    if (id === 'auto') {
      return (tokenColoring && tokenBrand.gradient)
        ? tokenBrand.gradient
        : 'linear-gradient(135deg, #06b6d4, #8b5cf6)'
    }
    if (id === 'logo') {
      const stops = LOGO_GRADIENTS[tokenSymbol]
      if (stops) return `linear-gradient(135deg, ${stops[0]}, ${stops[1]}, ${stops[stops.length - 1]})`
      if (tokenColoring && tokenBrand.gradient) return tokenBrand.gradient
      return 'linear-gradient(135deg, #9945FF, #14F195)'
    }
    if (id === 'updown') {
      return 'linear-gradient(135deg, #10B981 0%, #10B981 48%, #EF4444 52%, #EF4444 100%)'
    }
    return LINE_THEMES.find(t => t.id === id)?.colors?.[0] || '#06b6d4'
  }

  // Fetch real chart data from Codex API using the selected token (crypto only)
  const isStock = !!token?.isStock
  const tokenCgId = token?.cgId || null
  const tokenBinancePair = token?.binancePair || null
  // Cost guard: when the live TradingView iframe is the active chart (it's the
  // default), TV renders its own UDF data — fetching Codex getBars here is pure
  // waste, billed on every token open. Skip Codex while the TV iframe is live.
  // Re-enable the moment TV reports no data (tvNoData) and the chart falls back
  // to candles/line, which DO need Codex bars. Mirrors the existing isStock skip.
  const tvIframeLive = (initialChartType || storedChartType) === 'tradingview' && !tvNoData
  const { bars: liveBars, loading: chartLoading, loadingMore, hasMoreHistory, fetchMoreHistory, athPrice: trueATH, error: chartError, chartSource, lineOnly } = useChartData(
    (isStock || tvIframeLive || identityUnready) ? null : chartSymbol,  // Skip Codex for stocks + live TV iframe + unresolved identity
    timeframeToResolution[timeframe] || '60',
    chartNetworkId,
    timeframeToPeriod[timeframe] || 168,
    tokenCgId,
    tokenSymbol,  // ticker symbol for Binance klines (BTC not 0x2260...:1)
    tokenBinancePair,  // Binance pair from token resolve (e.g. 'XMRUSDT') for non-registry tokens
    // preferOhlc: the user explicitly chose an OHLC view - the sparse-bar
    // detector must NOT silently swap their candles for a CG line (C2).
    {
      preferOhlc: (initialChartType || storedChartType) === 'candles' || (initialChartType || storedChartType) === 'tradingview' || (initialChartType || storedChartType) === 'bars',
      // CG-line has no scroll-past buffer, so it must fetch exactly the labelled
      // range. Only '1Y' inflates periodHours (26280h = 3y buffer for candle
      // sources); a CG line at 1Y should fetch 365d, else it renders 3 years
      // under the "1Y" button. Other CG presets already match their label.
      cgPeriodHours: timeframe === '1Y' ? 8760 : undefined,
    }
  )

  // CoinGecko line data has no OHLCV → swap the timeframe bar to range presets
  // (24H/7D/30D/90D/1Y) which match CG market_chart granularity.
  const isCgSource = !isStock && (chartSource === 'coingecko-chart' || lineOnly)

  // LATCH REMOVED (2026-06-11, the a899b79b lesson): this used to WRITE the
  // coerced preset into the persisted settings store (setTimeframe('7D')) -
  // one visit to a CG-line token latched '7D' globally, and any token whose
  // candles path didn't know that preset rendered a blank pane on EVERY
  // token until the store was hand-cleared. Automation must never persist:
  // `effectiveTimeframe` is DERIVED for rendering (active button, preset
  // list, window clamps); only explicit user clicks persist via setTimeframe.
  // The data fetch above safely uses the raw persisted timeframe - the
  // resolution/period maps cover BOTH preset families.
  const effectiveTimeframe = isCgSource
    ? (CG_TIMEFRAMES.includes(timeframe) ? timeframe : '7D')
    : (CRYPTO_TIMEFRAMES.includes(timeframe) ? timeframe : '1H')

  // Determine effective chartType: respect initialChartType prop
  // Auto-force line mode when data source is CoinGecko market_chart (no real OHLC)
  // Auto-fallback from TradingView to candles when UDF has no data for this token
  const chartType = useMemo(() => {
    const userChoice = initialChartType || storedChartType
    // Mobile parity (was #1147): touch devices used to be coerced away from the
    // self-hosted TV library because it could blank without firing onNoData.
    // TradingViewAdvanced now fail-opens (script onerror, widget-create throw,
    // and a painted-canvas probe all fire onNoData), so a genuine mount failure
    // falls back to the iframe embed on its own - mobile renders the same
    // chart as desktop.
    const tvUnavailable = tvNoData
    // TradingView uses its own data source (TV/DEX feeds), NOT useChartData —
    // it must stay reachable even when our canvas data is line-only. Only
    // fall away from TV when TV itself is unavailable for the symbol.
    if (userChoice === 'tradingview' && !tvUnavailable) return 'tradingview'
    // Line-only tokens (CoinGecko data, no OHLCV) - force line mode
    if (lineOnly) return 'line'
    // TradingView fallback: if TV is unavailable, use candles instead
    if (userChoice === 'tradingview' && tvUnavailable) return 'candles'
    // For canvas charts, fall back to line when only CoinGecko data available (no OHLC)
    if (chartSource === 'coingecko-chart' && userChoice === 'candles') return 'line'
    return userChoice
  }, [initialChartType, storedChartType, chartSource, tvNoData, lineOnly])

  // Stock candle data from Yahoo Finance (via server proxy)
  const [stockBars, setStockBars] = useState(null)
  const [stockLoading, setStockLoading] = useState(false)
  const [stockError, setStockError] = useState(null)
  const stockFetchRef = useRef(null)

  useEffect(() => {
    // Clearing the de-dupe key with the bars is what makes returning to a stock
    // work: the key outlived the data, so stock -> crypto -> the SAME stock at
    // the same timeframe matched a fetch whose result had already been thrown
    // away, short-circuited, and left the pane on the crypto token's candles.
    if (!isStock) { setStockBars(null); stockFetchRef.current = null; return }
    // Extract raw ticker from TV-formatted symbol (e.g. "NASDAQ:PLTR" → "PLTR")
    const rawTicker = tokenSymbol.includes(':') ? tokenSymbol.split(':').pop() : tokenSymbol
    if (!rawTicker) return
    const resolution = timeframeToResolution[timeframe] || '60'
    const fetchKey = `${rawTicker}-${resolution}-${timeframe}`
    if (stockFetchRef.current === fetchKey) return
    stockFetchRef.current = fetchKey

    setStockLoading(true)
    setStockError(null)
    getStockCandles(rawTicker, resolution)
      .then(data => {
        const bars = data?.getBars || []
        if (bars.length > 0) {
          setStockBars(bars.map(b => ({
            open: b.o, high: b.h, low: b.l, close: b.c,
            volume: b.v || 0,
            time: (b.t || 0) * 1000,
          })))
        } else {
          setStockBars([])
          setStockError('CHART DATA UNAVAILABLE FOR THIS TOKEN')
        }
      })
      .catch(err => {
        // silently handled
        setStockBars([])
        setStockError(err.message)
      })
      .finally(() => setStockLoading(false))
  }, [isStock, tokenSymbol, timeframe])

  // Unified bar source: stocks use Yahoo Finance, crypto uses Codex
  const effectiveBarsRawSource = isStock ? stockBars : liveBars
  // DROP SERVER GAP-FILL (2026-08-24, founder report on ZIG 24h). The
  // GeckoTerminal tier fabricates a candle for every empty bucket
  // (o=h=l=c=prev close, v=0) - on a thin token that is most of the series
  // (ZIG 1m measured 673 of 706), and a zero-range candle renders as a flat
  // tick, so quiet stretches drew as long dashed shelves. This canvas plots by
  // INDEX, so dropping them collapses the quiet stretches (the CMC look) and
  // only real trades are drawn. Same treatment the TV widget got.
  //   - stocks are exempt: a flat zero-volume session bar is a real artifact
  //     there, and session gaps are a separate (unhandled) concern;
  //   - CG-line sources are exempt: their bars are close-only (o=h=l=c, v=0)
  //     by construction, so the test would wipe the whole series;
  //   - if NOTHING real remains, keep the payload as-is rather than blank the
  //     pane - a fully quiet window must still render.
  const effectiveBarsRaw = useMemo(() => {
    if (isStock || isCgSource || !Array.isArray(effectiveBarsRawSource)) return effectiveBarsRawSource
    const real = effectiveBarsRawSource.filter(b => !(
      !(b.volume > 0 || b.v > 0)
      && (b.open ?? b.o) === (b.high ?? b.h)
      && (b.open ?? b.o) === (b.low ?? b.l)
      && (b.open ?? b.o) === (b.close ?? b.c)
    ))
    return real.length > 0 ? real : effectiveBarsRawSource
  }, [effectiveBarsRawSource, isStock, isCgSource])
  // Monthly (1M) candles are rolled up CLIENT-SIDE from the daily bars the
  // '1MO' timeframe fetches (no upstream serves a month bucket). Pure transform
  // over whatever daily bars are present, so live updates + scroll-back history
  // re-aggregate naturally. Calendar months in UTC: o=first day's open,
  // h=max, l=min, c=last day's close, v=sum. Other timeframes pass through
  // unchanged (same ref → no extra work downstream). (Gleb 2026-06-14)
  // '1MO' is now a 30-day range (4h candles), so bars pass through unchanged -
  // no calendar-month roll-up. (The old monthly aggregation showed ~5y of
  // history under the "1M" label, which read as broken.)
  const effectiveBars = effectiveBarsRaw
  const effectiveLoading = isStock ? stockLoading : chartLoading
  const effectiveError = isStock ? stockError : chartError

  const [candleData, setCandleData] = useState([])
  const defaultTimeZoom = useMemo(() => getDefaultChartZoom(candleData, timeframe, isCgSource), [candleData, timeframe, isCgSource])
  const customTimeView = hasCustomChartView(zoomLevel, defaultTimeZoom, panOffset)
  const customChartView = customTimeView || priceZoom !== 1 || Math.abs(priceOffset) > 0.01
  resetTimeViewRef.current = () => {
    if (momentumAnimationRef.current) cancelAnimationFrame(momentumAnimationRef.current)
    if (scrollToNowAnimRef.current) cancelAnimationFrame(scrollToNowAnimRef.current)
    zoomLevelRef.current = defaultTimeZoom
    panOffsetRef.current = 0
    setZoomLevel(defaultTimeZoom)
    setPanOffset(0)
  }

  // Render-time mirror: the bars-update effect compares incoming bars against
  // the CURRENT committed candleData to detect prepends for zoom compensation.
  const candleDataZoomRef = useRef(candleData)
  candleDataZoomRef.current = candleData
  // Keep the TA read pointed at the live bars + the resolution they came from.
  taContextRef.current = {
    bars: candleData,
    resolution: String(RES_MINUTES[timeframeToResolution[timeframe] || '60'] ?? 60),
    timeframe,
    visible: chartDimensionsRef.current?.visibleData || null,
    isTv: chartType === 'tradingview',
    // In TradingView mode the parent deliberately SKIPS the bars fetch — TVA
    // runs its own datafeed, and paying for a second Codex pull per chart open
    // is the cost-war regression the waterfall exists to avoid. So the TA layer
    // gets the identifiers instead and fetches only when the user asks for a
    // read (through the same module-cached, deduped fetcher the Technicals tab
    // uses, so it is usually already warm).
    fetchParams: {
      symbol: tokenSymbol || chartSymbol,
      address: tokenAddress || null,
      networkId: chartNetworkId,
      cgId: tokenCgId,
      binancePair: tokenBinancePair,
      resolution: timeframeToResolution[timeframe] || '60',
      assetClass: isStock ? 'stock' : null,
    },
  }

  // Dynamic price axis width — MEASURED, not guessed. The old rule only knew
  // about micro-caps (8 decimals -> 105px) and left everything else on a flat
  // 75px gutter, which fits "$1,234.56" and nothing longer: a six-figure BTC
  // label is ~70px at the axis font and fillText starts at chartRight + 10, so
  // every tick lost its last character or two off the right edge of the canvas.
  // Same font string as the axis draw pass below — keep them in step.
  const axisMeasureRef = useRef(null)
  useEffect(() => {
    if (candleData.length === 0) return
    const lastClose = candleData[candleData.length - 1]?.close || 0
    let needed = (lastClose > 0 && lastClose < 0.0001) ? 105 : 75
    if (typeof document !== 'undefined' && lastClose > 0) {
      const cvs = axisMeasureRef.current || (axisMeasureRef.current = document.createElement('canvas'))
      const mctx = cvs.getContext('2d')
      if (mctx) {
        mctx.font = AXIS_LABEL_FONT
        // The top gridline sits above the last close, so it can carry a digit
        // the close doesn't — measure the headroom too, not just today's price.
        const fmt = (v) => String(yAxisMode === 'mcap' ? hookFmtLarge(v * 1e9) : hookFmtPrice(v))
        const widest = Math.max(
          mctx.measureText(fmt(lastClose)).width,
          mctx.measureText(fmt(lastClose * 1.3)).width,
        )
        // 10px lead-in (where the label starts) + the text + 10px so the last
        // glyph never touches the canvas edge.
        needed = Math.max(needed, Math.ceil(widest) + 20)
      }
    }
    needed = Math.min(needed, 130)
    setPriceAxisWidth(prev => responsiveControls ? Math.max(prev, needed) : needed)
  }, [candleData, yAxisMode, hookFmtPrice, hookFmtLarge, responsiveControls])

  const [chartFading, setChartFading] = useState(false) // Fade transition on timeframe switch

  // Track previous timeframe/symbol AND bars reference to detect real data changes
  const prevTimeframeRef = useRef(timeframe)
  const prevSymbolRef = useRef(chartSymbol)
  const prevBarsRef = useRef(null) // Track actual bars reference
  const initialLoadDoneRef = useRef(false)
  const pendingTimeframeChangeRef = useRef(false) // True when waiting for new data after TF switch
  const fadeTimerRef = useRef(null) // Track fade timeout for cleanup

  // Track lazy loading state to prevent cascade fetches
  const lastFetchTimeRef = useRef(0)
  const initialDataLoadedRef = useRef(false)

  // Sanitize bar data: filter zeros/NaN, sort + dedup by time, clamp spike outliers
  const sanitizeBars = useCallback((bars) => {
    // 1. Remove candles with zero or invalid OHLC values
    const validBars = bars.filter(bar =>
      Number.isFinite(bar.open) && bar.open > 0 &&
      Number.isFinite(bar.high) && bar.high > 0 &&
      Number.isFinite(bar.low) && bar.low > 0 &&
      Number.isFinite(bar.close) && bar.close > 0 &&
      bar.date instanceof Date && !Number.isNaN(bar.date.getTime())
    )

    // 2. Sort ascending by time and dedup (lazy-loaded prepends and WS upserts
    // can introduce overlaps; chart positions candles by array index, so any
    // out-of-order bar creates a visible gap or displaced cluster).
    validBars.sort((a, b) => a.date.getTime() - b.date.getTime())
    const seen = new Set()
    const dedupedBars = []
    for (const bar of validBars) {
      const t = bar.date.getTime()
      if (seen.has(t)) continue
      seen.add(t)
      dedupedBars.push(bar)
    }

    // 3. Trim stray leading "straggler" bars. Mixed-source series for thin
    // tokens can carry a few ancient bars (e.g. one April daily snapshot)
    // followed by a huge gap before the dense recent body. Combined with
    // gap-fill this fabricated a months-long flat prefix and repeated one
    // axis label across the chart (Sunny 2026-06-10: DSYNC YTD "Apr 9" x7).
    // If a gap > 30x the dominant cadence sits inside the first 10% of the
    // series, everything before it is stale noise - drop it.
    //
    // 4. Gap-fill ONLY small internal holes (<= 5 missing buckets) with flat
    // synthetic candles (O=H=L=C=prev close, zero volume). The chart positions
    // candles by ARRAY INDEX, so small holes distort the time axis (audit
    // 2026-06-10: PALM 1M). Large holes stay holes: fabricating long flat
    // runs reads as a fake price line, which is worse than a compressed axis.
    if (dedupedBars.length >= 3) {
      const deltas = []
      for (let i = 1; i < dedupedBars.length; i++) {
        const d = dedupedBars[i].date.getTime() - dedupedBars[i - 1].date.getTime()
        if (d > 0) deltas.push(d)
      }
      deltas.sort((a, b) => a - b)
      const interval = deltas[Math.floor(deltas.length / 2)] // median = dominant cadence
      if (interval > 0) {
        const stragglerWindow = Math.max(3, Math.floor(dedupedBars.length * 0.1))
        let bodyStart = 0
        for (let i = 1; i <= stragglerWindow && i < dedupedBars.length; i++) {
          const gap = dedupedBars[i].date.getTime() - dedupedBars[i - 1].date.getTime()
          if (gap > interval * 30) bodyStart = i
        }
        if (bodyStart > 0) dedupedBars.splice(0, bodyStart)

        // CLIENT GAP-FILL REMOVED (2026-08-24, same founder report as the
        // server-synthetic drop at `effectiveBarsRaw`). This used to fabricate
        // up to 5 candles per hole (o=h=l=c=prev close, v=0, `synthetic:true`)
        // so the index-based x-axis stayed roughly time-proportional across
        // small holes. But a zero-range candle renders as a flat tick, so the
        // fill IS the "empty bars" being reported - and re-adding them here
        // would have partly undone the upstream drop. The `synthetic` flag it
        // set was never read anywhere, so nothing downstream depended on it.
        // Quiet stretches now collapse; only real trades are drawn.
      }
    }

    // 5. Clamp spike anomalies: if a candle's price jumps > 2x or < 0.5x from reference
    if (dedupedBars.length < 3) return dedupedBars
    return dedupedBars.map((bar, i) => {
      if (i === 0) return bar
      let reference
      if (i === dedupedBars.length - 1) {
        // Live edge: reference = median of [i-1, i-2]
        reference = (dedupedBars[i - 1].close + dedupedBars[i - 2].close) / 2
      } else {
        // Interior: reference = average of immediate neighbors
        reference = (dedupedBars[i - 1].close + dedupedBars[i + 1].close) / 2
      }
      const ratio = bar.close / reference
      if (ratio > 2 || ratio < 0.5) {
        // CONTINUATION TEST (2026-08-25, PR #1422 rule, same as bars-router
        // sanitizeBars / TVA clampBarOutliers): the neighbour reference CANNOT
        // tell a bad print from a real violent move — on a rug/pump the
        // reference straddles both regimes and this rewrite "corrected" the
        // one candle carrying the move (MemeCore 25 Jun '26). A bad print is
        // an island the next bar ignores; a real move chains into the next
        // bar's traded range.
        const nxt = dedupedBars[i + 1]
        const follows = nxt
          ? (nxt.low > 0 && nxt.high > 0 && bar.close >= nxt.low / 25 && bar.close <= nxt.high * 25)
          : ((bar.volume || 0) > 0) // live edge: trades are the only witness
        if (follows) return bar
        const clampedClose = reference
        const clampedOpen = (dedupedBars[i - 1].close + clampedClose) / 2
        return {
          ...bar,
          open: clampedOpen,
          high: Math.max(clampedOpen, clampedClose) * 1.002,
          low: Math.min(clampedOpen, clampedClose) * 0.998,
          close: clampedClose
        }
      }
      return bar
    })
  }, [])

  // Step 1: When timeframe/symbol changes, start fade-out immediately (don't wait for data)
  useEffect(() => {
    const isTimeframeChange = prevTimeframeRef.current !== timeframe
    const isSymbolChange = prevSymbolRef.current !== chartSymbol

    if ((isTimeframeChange || isSymbolChange) && candleData.length > 0) {
      pendingTimeframeChangeRef.current = true
      setChartFading(true) // Fade out immediately on user action
    }

    // Reset TradingView fallback flags on symbol change so new token gets a
    // fresh attempt (tvEmbedFallback otherwise latches the iframe for every
    // later token in this mount).
    if (isSymbolChange) { setTvNoData(false); setTvEmbedFallback(false) }

    prevTimeframeRef.current = timeframe
    prevSymbolRef.current = chartSymbol
  }, [timeframe, chartSymbol])

  // Step 2: When actual bar data arrives, process and swap in with animation
  useEffect(() => {
    const barsChanged = effectiveBars !== prevBarsRef.current
    const isInitialLoad = !initialLoadDoneRef.current
    const isPendingChange = pendingTimeframeChangeRef.current

    prevBarsRef.current = effectiveBars

    if (!effectiveBars || effectiveBars.length <= 2) {
      return
    }

    // Skip if bars reference hasn't changed (no new data)
    if (!barsChanged && !isInitialLoad) return

    // FAST PATH - live-tail update (Gleb 2026-07-03 "flickering"). SSE ticks
    // and poll head-refreshes change only the LAST bar (or append one), but
    // the full path below re-sanitizes and re-processes the ENTIRE buffer
    // (up to 50k bars) plus every indicator memo downstream - dozens of
    // heavy full-pipeline renders per minute, felt as flicker/jank at idle.
    // When the update is tail-only, patch the tail candles in place and skip
    // sanitize entirely (the tail comes from already-clean head sources).
    if (!isPendingChange && !isInitialLoad) {
      const prevData = candleDataZoomRef.current
      const prevLen = prevData.length
      const newLen = effectiveBars.length
      if (
        prevLen > 10 && newLen >= prevLen && newLen - prevLen <= 2 &&
        effectiveBars[0]?.time === prevData[0]?.date?.getTime?.()
      ) {
        const tailRaw = effectiveBars.slice(prevLen - 1)
        const tailOk = tailRaw.every(b =>
          Number.isFinite(b.open) && b.open > 0 && Number.isFinite(b.high) && b.high > 0 &&
          Number.isFinite(b.low) && b.low > 0 && Number.isFinite(b.close) && b.close > 0)
        if (tailOk) {
          const tailMapped = tailRaw.map(bar => ({
            open: bar.open, high: bar.high, low: bar.low, close: bar.close,
            volume: typeof bar.volume === 'number' ? bar.volume : 0,
            date: new Date(bar.time),
          }))
          setCandleData(prevData.slice(0, prevLen - 1).concat(tailMapped))
          return
        }
      }
    }

    const rawBars = effectiveBars.map(bar => ({
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: typeof bar.volume === 'number' ? bar.volume : 0,
      date: new Date(bar.time)
    }))
    const sanitizedFull = sanitizeBars(rawBars)

    // Window clamp (2026-06-10): preset timeframes share a resolution with
    // wider presets (YTD / 1Y / ALL all fetch '1D' bars), and the per-
    // (symbol, resolution) bars cache returns the WIDEST window previously
    // loaded — switching ALL→YTD rendered 15 months under a YTD label
    // (DSYNC, first axis tick "Mar 17 '25"). Presets with an explicit
    // window clamp to it at render time regardless of what the cache holds.
    //
    // SWITCH-TIME ONLY (Gleb 2026-07-03): the clamp used to run on EVERY
    // bars update, which silently amputated all scroll-back history - the
    // hook's background extender loaded candles to 2014 but the render
    // filter cut everything older than the preset window, so the chart
    // walled at "now - 3y" no matter how much data existed ("still can't
    // move left past 2023"). Now the clamp shapes only the INITIAL view
    // after a preset/symbol switch (which also anchors the initial zoom);
    // subsequent updates keep the full buffer so panning left reaches
    // everything the extender loaded. The minCandleW floor in the renderer
    // keeps the visible span sane as the array grows.
    let sanitizedBars = sanitizedFull
    const WINDOW_CLAMP_TFS = { '24H': 1, '7D': 1, '30D': 1, '90D': 1, '1Y': 1, 'YTD': 1 }
    if ((isPendingChange || isInitialLoad) && WINDOW_CLAMP_TFS[effectiveTimeframe] && timeframeToPeriod[effectiveTimeframe]) {
      const cutoff = Date.now() - timeframeToPeriod[effectiveTimeframe] * 3600_000
      const windowed = sanitizedFull.filter((b) => b.date.getTime() >= cutoff)
      if (windowed.length >= 2) sanitizedBars = windowed
    }

    // Clear any pending fade timer
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current)
      fadeTimerRef.current = null
    }

    if (isPendingChange || isInitialLoad) {
      // Data arrived after timeframe/symbol change — swap data then fade in
      pendingTimeframeChangeRef.current = false

      // Small delay to ensure fade-out is visible before swapping
      const delay = chartFading ? 150 : 0
      fadeTimerRef.current = setTimeout(() => {
        setCandleData(sanitizedBars)
        // PR-6 (perf): verification mark - first real chart data committed.
        // Zero UI footprint; consumed by the perf measurement harness.
        try { performance.mark('rz:candles-painted') } catch { /* ignore */ }
        // Default zoom shows ~120 most recent candles for readable density on
        // high-resolution crypto candle data (a 1M timeframe is ~1440 bars that
        // would otherwise squeeze thin). But CoinGecko-line range presets
        // (24H/7D/30D/90D/1Y) ARE the intended window — 24H→90D all come back as
        // hourly series, so capping to the latest 120 made 7D, 30D and 90D show
        // the same last-~5-days slice and look identical across timeframes. For
        // line-only data, show the full fetched window (zoom=1) so each preset
        // renders its own range.
        // Long-range timeframes (1D/1W/YTD/ALL/1Y) exist to show the FULL
        // fetched window — defaulting them to the last 120 bars forced users
        // to zoom-correct manually to see multi-year history (Sunny 2026-06-10).
        const initialZoom = getDefaultChartZoom(sanitizedBars, timeframe, isCgSource)
        setZoomLevel(initialZoom)
        zoomLevelRef.current = initialZoom
        setPanOffset(0)
        setPriceOffset(0)
        panOffsetRef.current = 0
        priceOffsetRef.current = 0
        setAutoFitPrice(true)
        initialLoadDoneRef.current = true
        initialDataLoadedRef.current = false
        lastFetchTimeRef.current = 0
        // Fade back in
        requestAnimationFrame(() => setChartFading(false))
      }, delay)
    } else {
      // Normal data update (live refresh, lazy loading) — no animation.
      // ZOOM COMPENSATION on prepends (Gleb 2026-07-03: "chart moves by
      // itself for the first seconds"): zoomLevel is a RATIO — the renderer
      // computes the visible span as length/zoom — so when the background
      // extender grows the buffer (1k -> 40k bars) at a fixed zoom, the
      // visible span widens on every merge and the left edge visibly crawls
      // deeper into history for the whole prefetch burst. Scaling zoom by
      // the growth factor keeps length/zoom CONSTANT: the view is pixel-
      // stable while history loads silently behind it (panOffset counts
      // from the right edge, so the window itself is already anchored).
      const prevData = candleDataZoomRef.current
      const prevLen = prevData.length
      const newLen = sanitizedBars.length
      const isPrepend = prevLen > 2 && newLen > prevLen &&
        sanitizedBars[0]?.date?.getTime?.() < prevData[0]?.date?.getTime?.()
      if (isPrepend) {
        const grownZoom = zoomLevelRef.current * (newLen / prevLen)
        // State only - do NOT write zoomLevelRef here. The canvas effect below
        // also re-fires in THIS commit (its deps include hasMoreHistory /
        // loadingMore, which the extender flips alongside the bars), and it
        // paints from zoomLevelRef + candleData. Writing the ref synchronously
        // made that paint use the GROWN zoom against the OLD (shorter) buffer:
        // 1000 bars / 10.14 = 98 candles on screen instead of 288, one frame
        // of a zoomed-in chart, then the next commit snapped back - the
        // "chart blinks / jerks on reload" report (Evgeniy 2026-09-07), once
        // per history window for the first seconds. setZoomLevel +
        // setCandleData batch into ONE render, and the zoomLevel -> ref sync
        // effect (declared above the canvas effect) lands the new zoom in the
        // same commit as the new bars, so length/zoom stays constant on every
        // painted frame.
        setZoomLevel(grownZoom)
      }
      setCandleData(sanitizedBars)
    }
  }, [effectiveBars, chartSymbol, isStock, effectiveLoading, sanitizeBars, effectiveTimeframe])

  // ═══════════════════════════════════════════════════════════════════════════
  // Real-time OHLCV via WebSocket (live candle updates — 1s latency)
  // ═══════════════════════════════════════════════════════════════════════════
  const timeframeToWsInterval = {
    '1M': '1m', '5M': '5m', '15M': '15m', '30M': '15m', '1H': '1h', '4H': '4h', '12H': '4h', '1D': '5m', '1W': '1h',
    '1MO': '4h', '1Y': '1d', 'YTD': '1d', 'ALL': '1d',
  }
  const wsInterval = timeframeToWsInterval[timeframe] || '1m'

  // Close the timeframe "More" dropdown on outside click / Escape. The menu is
  // portaled to body, so "outside" must check BOTH the trigger and the menu.
  useEffect(() => {
    if (!tfMenuOpen) return
    const onDown = (e) => {
      const inTrigger = tfMoreRef.current && tfMoreRef.current.contains(e.target)
      const inMenu = tfMenuDropdownRef.current && tfMenuDropdownRef.current.contains(e.target)
      if (!inTrigger && !inMenu) setTfMenuOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setTfMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [tfMenuOpen])

  // Anchor the portaled "More" menu to its trigger; track scroll/resize.
  useEffect(() => {
    if (!tfMenuOpen) return
    const update = () => {
      const el = tfMoreRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setTfMenuPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [tfMenuOpen])
  const wsPoolAddress = liveTokenData?.primaryPool || null
  const wsOhlcvEnabled = !!wsPoolAddress && isOnchainSupported(chartNetworkId)
  const { data: wsOhlcvData } = useRealtimeOhlcv(wsPoolAddress, chartNetworkId, wsInterval, wsOhlcvEnabled)

  // Apply WS candle updates to candleData state
  useEffect(() => {
    if (!wsOhlcvData?.length || !candleData.length) return
    const periodMs = timeframeToPeriodMs[timeframe] ?? 60 * 60 * 1000

    setCandleData(prev => {
      if (!prev.length) return prev
      let changed = false
      let updated = null
      for (const bar of wsOhlcvData) {
        const t = bar.bucket || bar.time
        if (!t) continue
        const barTime = typeof t === 'number' ? t * 1000 : new Date(t).getTime()
        if (!barTime || barTime <= 0) continue

        const o = parseFloat(bar.open) || 0
        const h = parseFloat(bar.high) || 0
        const l = parseFloat(bar.low) || 0
        const c = parseFloat(bar.close) || 0
        const v = parseFloat(bar.volume_usd || bar.volume || bar.v) || 0
        if (!o || !h || !l || !c) continue

        if (!updated) updated = [...prev]
        const last = updated[updated.length - 1]
        const lastTime = last.date instanceof Date ? last.date.getTime() : 0
        // Same period as last bar — update in place only if values actually changed
        if (Math.abs(barTime - lastTime) < periodMs * 0.5) {
          const newHigh = Math.max(last.high, h)
          const newLow = Math.min(last.low, l)
          if (last.close !== c || last.high !== newHigh || last.low !== newLow) {
            updated[updated.length - 1] = { ...last, high: newHigh, low: newLow, close: c, volume: v || last.volume }
            changed = true
          }
        } else if (barTime > lastTime) {
          // New bar after last — append
          updated.push({ open: o, high: h, low: l, close: c, volume: v, date: new Date(barTime) })
          changed = true
        }
      }
      return changed && updated ? updated : prev
    })
  }, [wsOhlcvData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time last candle: merge livePrice only when congruent with timeframe (same period as last bar, or append new forming candle)
  const displayCandleData = useMemo(() => {
    if (!candleData.length) return candleData
    const price = livePrice != null && Number.isFinite(livePrice) ? Number(livePrice) : null
    if (price == null || price <= 0) return candleData
    // Spike guard: reject livePrice if it's > 5x or < 0.2x the last close (likely stale/bad data)
    const lastClose = candleData[candleData.length - 1]?.close
    if (lastClose > 0) {
      const ratio = price / lastClose
      if (ratio > 5 || ratio < 0.2) return candleData
    }
    const periodMs = timeframeToPeriodMs[timeframe] ?? 60 * 60 * 1000
    const now = Date.now()
    const last = candleData[candleData.length - 1]
    const lastBarStart = last.date instanceof Date ? last.date.getTime() : last.time ?? 0
    const lastBarEnd = lastBarStart + periodMs
    const stillInLastPeriod = now < lastBarEnd
    if (stillInLastPeriod) {
      const updatedLast = {
        ...last,
        close: price,
        high: Math.max(last.high, price),
        low: Math.min(last.low, price),
      }
      return [...candleData.slice(0, -1), updatedLast]
    }
    const currentPeriodStart = Math.floor(now / periodMs) * periodMs
    const open = last.close
    const formingCandle = {
      open,
      high: Math.max(open, price),
      low: Math.min(open, price),
      close: price,
      volume: 0,
      date: new Date(currentPeriodStart),
    }
    return [...candleData, formingCandle]
  }, [candleData, livePrice, timeframe])

  // Calculate active indicator data from the full dataset
  const indicatorData = useMemo(() => {
    if (!displayCandleData || displayCandleData.length < 2) return {}
    const result = {}
    if (activeIndicators.ema9)   result.ema9   = calcEMA(displayCandleData, 9)
    if (activeIndicators.ema21)  result.ema21  = calcEMA(displayCandleData, 21)
    if (activeIndicators.ema50)  result.ema50  = calcEMA(displayCandleData, 50)
    if (activeIndicators.ema200) result.ema200 = calcEMA(displayCandleData, 200)
    if (activeIndicators.sma20)  result.sma20  = calcSMA(displayCandleData, 20)
    if (activeIndicators.sma50)  result.sma50  = calcSMA(displayCandleData, 50)
    if (activeIndicators.sma200) result.sma200 = calcSMA(displayCandleData, 200)
    if (activeIndicators.bb)     result.bb     = calcBollingerBands(displayCandleData, 20, 2)
    if (activeIndicators.vwap)   result.vwap   = calcVWAP(displayCandleData)
    return result
  }, [displayCandleData, activeIndicators])

  // Force an immediate canvas repaint on ANY indicator toggle. The main draw
  // effect only depended on `activeIndicators.srzones` + `srZoneData`, so
  // toggling an EMA/SMA/BB/VWAP line — or unchecking S/R Zones and having a
  // stale imperative redraw fire first — could leave the old drawing on the
  // canvas until an unrelated trigger repainted it ("supply/demand lines
  // don't clear", Sunny 2026-07-02). Bumping redrawTrigger (already a draw
  // dep) guarantees the canvas clears + redraws the instant indicators change.
  useEffect(() => {
    setRedrawTrigger((t) => t + 1)
  }, [activeIndicators, indicatorData])

  // ── S/R zones: daily series anchors the MAJOR levels regardless of the
  // selected timeframe; local levels come from the displayed bars. Fetch is
  // deduped + TTL'd in spectreDataApi; DEX-only tokens without CG daily data
  // fall back to same-series majors inside computeSRLevels.
  const [srDailyBars, setSrDailyBars] = useState(null)
  useEffect(() => {
    if (!activeIndicators.srzones) return
    const sym = (token?.symbol || '').toUpperCase().split(':')[0]
    if (!sym) { setSrDailyBars(null); return }
    let cancelled = false
    getSpectreTokenChart(sym, '1d')
      .then(res => {
        if (cancelled) return
        const bars = (Array.isArray(res?.bars) ? res.bars : [])
          .map(b => ({
            t: Number(b.t ?? b.time) || 0,
            h: Number(b.h ?? b.high) || 0,
            l: Number(b.l ?? b.low) || 0,
            c: Number(b.c ?? b.close) || 0,
          }))
          .filter(b => Number.isFinite(b.c) && b.c > 0)
          .sort((a, b) => a.t - b.t)
        setSrDailyBars(bars.length >= 30 ? bars : null)
      })
      .catch(() => { if (!cancelled) setSrDailyBars(null) })
    return () => { cancelled = true }
  }, [token?.symbol, activeIndicators.srzones])

  const srZoneData = useMemo(() => {
    if (!activeIndicators.srzones || !displayCandleData || displayCandleData.length < 40) return null
    const bars = displayCandleData.map(c => ({
      t: (c.date instanceof Date ? c.date.getTime() : Number(c.time) || 0) / 1000,
      h: c.high, l: c.low, c: c.close,
    })).filter(b => Number.isFinite(b.c) && b.c > 0)
    if (bars.length < 40) return null
    const price = bars[bars.length - 1].c
    try {
      const levels = computeSRLevels(bars, srDailyBars, price)
      const first = bars[0].t
      const last = bars[bars.length - 1].t
      // range: the TV-shape draw needs a time span for the band rectangles
      return { ...levels, range: { from: first, to: last + Math.max(1, last - first) * 0.35 } }
    } catch (_) {
      return null
    }
  }, [displayCandleData, srDailyBars, activeIndicators.srzones])

  // TradingView mode: the canvas pass above never runs, so draw the same
  // zones as TV shapes once the widget is ready (mirrors rz-technicals-tab).
  const tvChartApiRef = useRef(null)
  const tvZoneIdsRef = useRef([])
  const [tvChartEpoch, setTvChartEpoch] = useState(0)
  const tvWidgetApiRef = useRef(null)
  const tvTaIdsRef = useRef([])
  const tvSelIdsRef = useRef([])
  // Arming TradingView's drawing tool must NOT depend on a callback identity —
  // re-running the effect cancels whatever the user is mid-way through drawing.
  const onTaSelectionChangeRef = useRef(onTaSelectionChange)
  onTaSelectionChangeRef.current = onTaSelectionChange
  const handleTvChartReady = useCallback((widget, chart) => {
    tvChartApiRef.current = chart
    tvWidgetApiRef.current = widget
    tvZoneIdsRef.current = []
    tvTaIdsRef.current = []
    tvSelIdsRef.current = []
    setTvChartEpoch(e => e + 1)
  }, [])

  // ── TA layer on TradingView ──────────────────────────────────────────────
  // TV owns its surface, so the same data-space drawings are rendered through
  // its shape API instead of our canvas overlay. One source of drawings, two
  // renderers — the engines cannot disagree about what a level is.
  useEffect(() => {
    const chart = tvChartApiRef.current
    if (!chart || chartType !== 'tradingview') return
    // TV rejects shapes for a beat after a resolution/symbol switch.
    const tid = setTimeout(() => {
      drawTaOnTvChart(chart, taDrawings || [], { dayMode }, tvTaIdsRef)
    }, 350)
    return () => {
      clearTimeout(tid)
      clearTaTvEntities(chart, tvTaIdsRef)
    }
  }, [taDrawings, dayMode, chartType, tvChartEpoch, taRevealKey])

  // ── Highlight on TradingView ─────────────────────────────────────────────
  // Captured on OUR overlay, positioned exactly over TV's price pane, because
  // TV's own rectangle tool does not reliably emit a shape here (see
  // getTvPlotRect). x maps to time through TV's getVisibleRange(), so the
  // window we analyse is exactly the one under the box.
  const [tvPlot, setTvPlot] = useState(null)
  const [tvSel, setTvSel] = useState(null)
  const tvSelDragRef = useRef(null)

  useEffect(() => {
    if (chartType !== 'tradingview' || taMode !== 'select') { setTvPlot(null); return }
    const measure = () => {
      const rect = getTvPlotRect(containerRef.current || document)
      if (!rect) return
      const host = containerRef.current?.getBoundingClientRect?.()
      if (!host) return
      setTvPlot(prev => {
        const next = { left: rect.left - host.left, top: rect.top - host.top, width: rect.width, height: rect.height }
        if (prev && Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.top - next.top) < 0.5 &&
            Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.height - next.height) < 0.5) return prev
        return next
      })
    }
    measure()
    // TV lays out asynchronously after a resolution/size change; re-measure a
    // few times rather than trusting one read.
    const id = setInterval(measure, 500)
    window.addEventListener('resize', measure)
    return () => { clearInterval(id); window.removeEventListener('resize', measure) }
  }, [chartType, taMode, tvChartEpoch])

  const tvSelPointerDown = useCallback((e) => {
    if (!tvPlot) return
    const host = containerRef.current?.getBoundingClientRect?.()
    if (!host) return
    const x = e.clientX - host.left
    const y = e.clientY - host.top
    tvSelDragRef.current = { x0: x, y0: y }
    setTvSel({ x0: x, y0: y, x1: x, y1: y })
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch (_) {}
    e.preventDefault()
  }, [tvPlot])

  const tvSelPointerMove = useCallback((e) => {
    const d = tvSelDragRef.current
    if (!d) return
    const host = containerRef.current?.getBoundingClientRect?.()
    if (!host) return
    setTvSel({ x0: d.x0, y0: d.y0, x1: e.clientX - host.left, y1: e.clientY - host.top })
  }, [])

  const tvSelPointerUp = useCallback((e) => {
    const d = tvSelDragRef.current
    tvSelDragRef.current = null
    try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch (_) {}
    if (!d || !tvPlot) { setTvSel(null); return }
    const host = containerRef.current?.getBoundingClientRect?.()
    const x1 = host ? e.clientX - host.left : d.x0
    if (Math.abs(x1 - d.x0) < 8) { setTvSel(null); return } // a click, not a drag
    const range = getTvVisibleRange(tvChartApiRef.current)
    if (!range) { setTvSel(null); return }
    const toTime = (px) => {
      const f = Math.max(0, Math.min(1, (px - tvPlot.left) / Math.max(1, tvPlot.width)))
      return range.fromTs + f * (range.toTs - range.fromTs)
    }
    const a = toTime(d.x0)
    const b = toTime(x1)
    setTvSel(null)
    onTaSelectionChangeRef.current?.({ fromTs: Math.min(a, b), toTs: Math.max(a, b) }, 'analyze')
  }, [tvPlot])

  // Draw tools on TV hand off to TradingView's native line tools — the user
  // gets TV's handles, snapping and magnet for free. But a shape drawn that way
  // belongs to TV, not to us, so Clear could not reach it. While our tool is
  // armed we diff TV's shape list and remember what appeared, and only those
  // ids are removed on Clear — a drawing the user made with TV's OWN toolbar is
  // never touched.
  const tvDrawIdsRef = useRef([])
  useEffect(() => {
    if (chartType !== 'tradingview' || !taMode.startsWith('draw:')) return
    const chart = tvChartApiRef.current
    const dispose = startTvDrawTool(tvWidgetApiRef.current, taMode)
    const list = () => { try { return (chart?.getAllShapes() || []).map(x => x.id) } catch { return [] } }
    const baseline = new Set(list())
    const poll = setInterval(() => {
      for (const id of list()) {
        if (baseline.has(id)) continue
        baseline.add(id)
        tvDrawIdsRef.current.push(id)
      }
    }, 400)
    return () => { clearInterval(poll); dispose?.() }
  }, [chartType, taMode, tvChartEpoch])
  useEffect(() => {
    const chart = tvChartApiRef.current
    if (!chart || chartType !== 'tradingview') return
    clearTvZoneEntities(chart, tvZoneIdsRef)
    if (!activeIndicators.srzones || !srZoneData) return
    const tid = setTimeout(() => {
      drawSRZonesOnTvChart(chart, srZoneData, dayMode, tvZoneIdsRef)
    }, 400)
    return () => clearTimeout(tid)
  }, [srZoneData, activeIndicators.srzones, dayMode, chartType, tvChartEpoch])

  // Track previous bar count + first bar timestamp so we can distinguish
  // prepend (older history loaded on scroll-left) from append (live polling).
  // NO pan compensation on history prepends - REMOVED 2026-07-03 (Gleb:
  // "chart moves to the left by auto"). panOffset counts candles from the
  // RIGHT edge (endIndex = length - panOffset in drawCanvas), so prepending
  // K older bars raises every existing bar's index by K AND raises endIndex
  // by K - the SAME time window stays in view with an UNCHANGED offset.
  // Prepends are self-anchoring. The old effect here added the prepended
  // count to panOffset "to keep candles anchored", which actually DOUBLE-
  // shifted the view K candles deeper into history on every merge - barely
  // noticeable when merges only happened at the wall, but a constant
  // leftward auto-drift once the background extender started merging
  // 3-window rounds every few hundred ms.

  // Geometry for the interaction clamps + the history trigger, measured off the
  // LAST PAINT (the renderer publishes chartWidth into chartDimensionsRef).
  // Falls back to the container width only before the first draw.
  // Declared HERE, above its first consumer: a `const` referenced in a dep array
  // before its declaration is a render-time TDZ crash, not a lint nit.
  const readPanGeometry = useCallback((zoom) => {
    const dims = chartDimensionsRef.current
    const chartWidth = dims?.chartWidth || Math.max(1, (containerRef.current?.clientWidth || 800) - 75 - 12)
    return computeChartGeometry(candleData.length, zoom, chartWidth, timeframe)
  }, [candleData.length, timeframe])

  // Track when user is trying to scroll past the left edge
  const edgeScrollAttemptsRef = useRef(0)
  const lastPanOffsetRef = useRef(panOffset)
  
  // Auto-fetch more history when user scrolls to the left edge (oldest data)
  useEffect(() => {
    if (loadingMore || !hasMoreHistory || candleData.length === 0) return
    
    // Shared geometry, NOT length/zoom: the raw ratio ignores the candle-width
    // clamps, so this effect's idea of "the left edge" sat thousands of candles
    // away from the one the canvas draws and the at-edge fetch never fired.
    const { visibleCount } = readPanGeometry(zoomLevel)
    const { baseMaxOffset: maxPossibleOffset } = computeOffsetBounds(candleData.length, visibleCount, true)

    // Only do initial data fill ONCE and only if we have very little data (mock data)
    if (!initialDataLoadedRef.current && candleData.length < 150) {
      initialDataLoadedRef.current = true
      lastFetchTimeRef.current = Date.now()
      fetchMoreHistory()
      return
    }
    
    // Mark initial load as done once we have real data
    if (candleData.length >= 150) {
      initialDataLoadedRef.current = true
    }
    
    // Detect if user is at the left edge
    const atLeftEdge = panOffset >= maxPossibleOffset - 3
    
    // Track edge scroll attempts - if panOffset hasn't changed but user is at edge, count it
    if (atLeftEdge && panOffset === lastPanOffsetRef.current && panOffset > 0) {
      edgeScrollAttemptsRef.current += 1
    } else {
      edgeScrollAttemptsRef.current = 0
    }
    lastPanOffsetRef.current = panOffset
    
    // Trigger fetch if at left edge (either just arrived or been there trying to
    // scroll). No `maxPossibleOffset > 0` requirement: when the whole buffer
    // already fits the pane that value IS 0, and demanding it non-zero muted the
    // trigger in precisely the state where the user is staring at the data wall.
    if (atLeftEdge && panOffset > 0) {
      const now = Date.now()
      const timeSinceLastFetch = now - lastFetchTimeRef.current
      // 400ms, not 2s: the in-flight `loadingMore` guard already serializes
      // requests, so the cooldown only exists to absorb effect re-fires. The
      // old 2s value added dead wait BETWEEN consecutive history windows on a
      // deep scroll - the single biggest "chart loads slow" factor.
      const cooldownMs = 400

      if (timeSinceLastFetch >= cooldownMs) {
        lastFetchTimeRef.current = now
        edgeScrollAttemptsRef.current = 0
        fetchMoreHistory()
      }
    }
  }, [panOffset, candleData.length, zoomLevel, loadingMore, hasMoreHistory, fetchMoreHistory, readPanGeometry])

  useEffect(() => {
    const drawCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Don't render if no data
    if (candleData.length === 0) return

    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()

    // 🪤 Writing canvas.width/height RE-ALLOCATES the backing store and drops
    // the GPU texture — even when the value written is identical to the one
    // already there. This ran on EVERY draw, and the chart draws on every live
    // price tick (SSE, ~2s), every pan frame, every hover and every indicator
    // toggle. On a phone GPU that re-allocation lands as a blank frame: the
    // "spectre charts flicker on mobile" report (founder 2026-08-12). Size only
    // when the size actually changed; otherwise reset the transform explicitly
    // (the width write used to be what reset it) and clear.
    // Floor, not round: assigning to canvas.width truncates, so flooring here
    // keeps the comparison honest and the raster identical to before.
    const wantW = Math.floor(rect.width * dpr)
    const wantH = Math.floor(rect.height * dpr)
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width = wantW
      canvas.height = wantH
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // The background fill below is translucent under the PRO glass skins, so a
    // clear is required — without the re-allocation nothing else empties it.
    ctx.clearRect(0, 0, rect.width, rect.height)

    // === DAY MODE COLOR CONFIG ===
    // Canvas can't read CSS variables, so we build a palette from the dayMode prop
    const dm = !!dayMode
    // PRO theme studio (test): under glass/paper the chart plane is the one
    // opaque slab left on screen - paint a translucent fill instead so the
    // frosted container (and the backdrop behind it) blends through while
    // candles keep their contrast.
    const proGlassOn = typeof document !== 'undefined' && !!document.querySelector('.app.pro-glass')
    const proPaperOn = typeof document !== 'undefined' && !!document.querySelector('.app.pro-paper')
    const C = {
      bg:            dm ? ((proPaperOn || proGlassOn) ? 'rgba(255, 255, 255, 0.68)' : '#ffffff') : (proGlassOn ? 'rgba(8, 9, 13, 0.62)' : '#0c0c0f'),
      grid:          dm ? 'rgba(15,23,42,0.10)'      : 'rgba(255, 255, 255, 0.04)',
      // Axis labels were near-illegible (0.45/0.4). Bumped to CMC-grade contrast
      // so price / mcap / date read clearly against the dark chart (Sunny 2026-07-01).
      axisText:      dm ? 'rgba(15, 23, 42, 0.88)'   : 'rgba(245, 245, 247, 0.92)',
      timeText:      dm ? 'rgba(15, 23, 42, 0.80)'   : 'rgba(245, 245, 247, 0.82)',
      timeHighlight: dm ? 'rgba(15, 23, 42, 0.9)'    : 'rgba(245, 245, 247, 0.9)',
      textStrong:    dm ? '#0f172a'                   : '#ffffff',
      textMedium:    dm ? 'rgba(0,0,0,0.7)'          : 'rgba(255, 255, 255, 0.95)',
      badgeText:     dm ? '#ffffff'                   : '#ffffff', // badge text stays white on colored bg
      watermark:     dm ? '#0f172a'                   : '#ffffff',
      heatmapPillBg1: dm ? '#ffffff'                 : 'rgba(12, 12, 18, 0.92)',
      heatmapPillBg2: dm ? '#eef1f6'                 : 'rgba(8, 8, 12, 0.95)',
      heatmapBorder: dm ? 'rgba(15,23,42,0.18)'      : 'rgba(255, 255, 255, 0.08)',
      heatmapPct:    dm ? 'rgba(15,23,42,0.95)'      : 'rgba(255, 255, 255, 0.95)',
      mentionNeutralLine: dm ? 'rgba(0,0,0,0.2)'     : 'rgba(255, 255, 255, 0.3)',
      mentionNeutralGlow: dm ? 'rgba(0,0,0,0.1)'     : 'rgba(255, 255, 255, 0.2)',
      mentionNeutralRing: dm ? '#334155'              : '#ffffff',
      dotCenter:     dm ? '#0f172a'                   : '#ffffff',
      volGreenFill:  dm ? 'rgba(5, 150, 105, 0.55)'  : 'rgba(16, 185, 129, 0.28)',
      volRedFill:    dm ? 'rgba(220, 38, 38, 0.55)'  : 'rgba(239, 68, 68, 0.28)',
    }

    // === CLEAN BACKGROUND ===
    ctx.fillStyle = C.bg
    ctx.fillRect(0, 0, rect.width, rect.height)

    // === CHART LAYOUT ===
    const chartTop = 15 // Minimal top padding
    const volumeAreaHeight = Math.max(50, rect.height * 0.12) // Volume bar area below candles
    const chartBottom = rect.height - timeAxisHeight - volumeAreaHeight - 8
    const volumeTop = chartBottom + 4 // Small gap between candles and volume
    const volumeHeight = volumeAreaHeight - 8
    const chartHeight = chartBottom - chartTop
    const chartLeft = 12
    const chartRight = rect.width - priceAxisWidth

    // === CANDLE DIMENSIONS - DexTools style ===
    // Geometry comes from the SHARED helper (see top of file) so the drag,
    // momentum and zoom clamps land on exactly the same visible window this
    // paint uses. Zoom is read from the ref so RAF redraws during a smooth
    // wheel zoom pick up the latest value without waiting on the state debounce.
    const chartWidth = chartRight - chartLeft
    const geometry = computeChartGeometry(candleData.length, zoomLevelRef.current, chartWidth, timeframe)
    const candleWidth = geometry.candleWidth
    const visibleCandleCount = geometry.visibleCount

    // Body width: 60% of candle slot (DexTools has thinner bodies with gaps)
    const bodyWidth = Math.max(1, candleWidth * 0.6)
    
    // Calculate visible range based on zoom and pan offset
    // panOffset = 0 means current price (newest data) is at right edge
    // panOffset > 0 means looking at older data (scroll left into history)
    // panOffset < 0 means showing empty space on right (scroll right past newest)
    
    // Clamp panOffset to valid range. When more history can still be loaded,
    // allow extending past the oldest candle so the user can keep dragging into
    // empty space while the next batch streams in (TradingView-style).
    // Small overscroll past the oldest bar so a drag can continue while the next
    // history batch streams in — but only a SLIVER (12%), not half the view, which
    // left a big blank "past emptiness" void when panned to the edge (Sunny).
    const { clampedPanOffset, startIndex, endIndex: actualEndIndex, leftEmptyCandles, rightEmptyCandles } =
      computeChartWindow(candleData.length, visibleCandleCount, panOffsetRef.current, hasMoreHistory || loadingMore)

    // Sub-candle pan: the index window below floors to whole candles, which
    // made dragging advance in candleWidth-sized jumps (up to 25px when zoomed
    // in) instead of gliding. The fractional remainder becomes a pixel shift
    // applied to every index-positioned x (candles, line, volume, indicators,
    // time labels, pins) so the chart tracks the cursor 1:1 like TV mode.
    const panFracPx = (clampedPanOffset - Math.floor(clampedPanOffset)) * candleWidth

    // Get visible data slice (use displayCandleData so last candle reflects livePrice)
    const visibleData = displayCandleData.slice(startIndex, actualEndIndex)

    // === PRICE ACTION HEATMAP BACKGROUND (Optional) - Now uses VISIBLE data ===
    // Calculate the actual width where candles exist (excluding empty space on right)
    const actualCandleAreaWidth = visibleData.length * candleWidth
    const heatmapLeft = chartLeft
    // Heatmap should only cover where candles actually are
    const heatmapRight = Math.min(chartRight, chartLeft + actualCandleAreaWidth)
    const heatmapWidth = Math.max(0, heatmapRight - heatmapLeft)
    
    if (heatmapEnabled && visibleData.length > 0 && heatmapWidth > 0) {
      const segmentCount = Math.min(10, visibleData.length) // 10 segments across visible data
      const segmentSize = Math.ceil(visibleData.length / segmentCount)
      const totalCandles = visibleData.length
      
      // Store raw segment data
      const rawSegments = []
      
      for (let s = 0; s < segmentCount; s++) {
        const startIdx = s * segmentSize
        const endIdx = Math.min(startIdx + segmentSize, visibleData.length)
        const segmentData = visibleData.slice(startIdx, endIdx)
        
        if (segmentData.length < 1) continue
        
        // Calculate momentum for this segment
        const segStartPrice = segmentData[0].open
        const segEndPrice = segmentData[segmentData.length - 1].close
        const momentum = segStartPrice > 0 ? (segEndPrice - segStartPrice) / segStartPrice : 0
        
        // Calculate volatility (price range) for intensity
        const highs = segmentData.map(c => c.high)
        const lows = segmentData.map(c => c.low)
        const volatility = segStartPrice > 0 ? (Math.max(...highs) - Math.min(...lows)) / segStartPrice : 0
        const intensity = Math.min(0.12, volatility * 1.5)
        
        // Position - based on actual candle positions, matching how candles are drawn
        // Each segment corresponds to actual candle positions
        // Apply same offset as candles: leftEmptyCandles (at oldest) and rightEmptyCandles (past newest)
        const candlesBeforeThisSegment = startIdx
        const x = chartLeft + (leftEmptyCandles + candlesBeforeThisSegment) * candleWidth - (rightEmptyCandles * candleWidth) + panFracPx
        const segmentWidth = segmentData.length * candleWidth
        
        // Determine zone type
        let zoneType = 'neutral'
        if (momentum > 0.005) zoneType = 'bullish'
        else if (momentum < -0.005) zoneType = 'bearish'
        
        // Create vertical gradient based on momentum
        const gradient = ctx.createLinearGradient(x, 0, x, rect.height)
        
        if (zoneType === 'bullish') {
          gradient.addColorStop(0, `rgba(52, 211, 153, ${intensity * 0.2})`)
          gradient.addColorStop(0.4, `rgba(52, 211, 153, ${intensity * 0.4})`)
          gradient.addColorStop(0.8, `rgba(52, 211, 153, ${intensity * 0.15})`)
          gradient.addColorStop(1, 'rgba(52, 211, 153, 0)')
        } else if (zoneType === 'bearish') {
          gradient.addColorStop(0, `rgba(251, 113, 133, ${intensity * 0.2})`)
          gradient.addColorStop(0.4, `rgba(251, 113, 133, ${intensity * 0.4})`)
          gradient.addColorStop(0.8, `rgba(251, 113, 133, ${intensity * 0.15})`)
          gradient.addColorStop(1, 'rgba(251, 113, 133, 0)')
        } else {
          gradient.addColorStop(0, `rgba(139, 92, 246, ${intensity * 0.1})`)
          gradient.addColorStop(0.5, `rgba(139, 92, 246, ${intensity * 0.08})`)
          gradient.addColorStop(1, 'rgba(139, 92, 246, 0)')
        }
        
        // Only draw if segment is within visible chart area
        if (x + segmentWidth > chartLeft && x < chartRight) {
        ctx.fillStyle = gradient
          ctx.fillRect(
            Math.max(x, chartLeft), 
            0, 
            Math.min(segmentWidth + 1, chartRight - Math.max(x, chartLeft)), 
            rect.height - timeAxisHeight
          )
        }
        
        rawSegments.push({
          x,
          segmentWidth,
          candleCount: segmentData.length,
          startPrice: segStartPrice,
          endPrice: segEndPrice,
          momentum,
          zoneType,
          intensity
        })
      }
      
      // Merge consecutive zones of the same type
      const mergedZones = []
      let currentZone = null
      
      rawSegments.forEach((seg, idx) => {
        if (!currentZone || currentZone.zoneType !== seg.zoneType) {
          // Start a new zone
          if (currentZone) mergedZones.push(currentZone)
          currentZone = {
            zoneType: seg.zoneType,
            startX: seg.x,
            endX: seg.x + seg.segmentWidth,
            candleCount: seg.candleCount,
            startPrice: seg.startPrice,
            endPrice: seg.endPrice,
            segmentCount: 1
          }
        } else {
          // Extend current zone
          currentZone.endX = seg.x + seg.segmentWidth
          currentZone.candleCount += seg.candleCount
          currentZone.endPrice = seg.endPrice
          currentZone.segmentCount++
        }
      })
      if (currentZone) mergedZones.push(currentZone)
      
      // Store merged zones for drawing labels later (on top of chart)
      // Use chartLeft/chartRight for clipping labels to visible area
      window._heatmapMergedZones = { zones: mergedZones, totalCandles, heatmapLeft: chartLeft, heatmapRight: chartRight }
    } else {
      // Clear heatmap data when disabled
      window._heatmapMergedZones = null
    }

    // === CALCULATE RANGES (based on visible data with price zoom + vertical pan) ===
    const prices = visibleData.flatMap(d => [d.high, d.low])

    // Include live price in range calculation to prevent axis/chart mismatch
    // (handles stale / differently-scaled API data) - but ONLY while the live
    // bar is actually on screen. When scrolled back into history the newest
    // candle is sliced out (clampedPanOffset > 0), so folding the CURRENT price
    // into the autoscale would stretch the old window toward an off-screen
    // price and crush the visible candles into a thin band.
    const liveBarVisible = actualEndIndex >= displayCandleData.length
    const effectiveLivePrice = liveBarVisible && livePrice != null && Number.isFinite(livePrice) && livePrice > 0 ? livePrice : null
    if (effectiveLivePrice) prices.push(effectiveLivePrice)

    const dataMinPrice = Math.min(...prices)
    const dataMaxPrice = Math.max(...prices)
    const dataPriceRange = dataMaxPrice - dataMinPrice

    // Price-axis scale is USER-CONTROLLED now (LOG/LIN toggle), default linear.
    // The previous >3x auto-log flipped wide views (e.g. SPECTRE ALL, 259x) to
    // a log axis unprompted, which read as a bug. Log still requires positive
    // bounds to be drawable.
    const useLogScale = priceScale === 'log' && dataMinPrice > 0 && dataMaxPrice > 0

    // Apply price zoom + vertical pan around the data midpoint. Use refs so
    // RAF redraws during smooth wheel zoom stay in sync before React state
    // catches up. On LOG charts the zoom/pan happens in LOG space: priceOffset
    // is % of the visible window, so one pixel of drag moves the chart one
    // pixel at any price level. (Shifting linear dollars on a log chart
    // slammed candles near the bottom around while the top barely moved -
    // vertical pan felt stuck on 100x-range tokens like PALM 1D.) The log
    // window is unbounded: drag freely into empty space above or below.
    // Breathing room so the tallest candle's wick never jams against the top
    // (nor the lowest against the bottom) edge - a real intraday spike rendered
    // flush to the frame reads as a clipped / broken candle. Pad the data range
    // ~8% on each side before zoom/pan. Default zoom=1 previously set
    // min/max EXACTLY to the data extremes, leaving zero headroom.
    const PRICE_PAD_FRAC = 0.08
    let minPrice, maxPrice, logMin, logMax
    if (useLogScale) {
      const dataLogMin = Math.log(dataMinPrice)
      const dataLogMax = Math.log(dataMaxPrice)
      const logMid = (dataLogMin + dataLogMax) / 2
      const paddedLogRange = (dataLogMax - dataLogMin) * (1 + 2 * PRICE_PAD_FRAC)
      const zoomedLogRange = Math.max(1e-9, paddedLogRange / priceZoomRef.current)
      const logShift = (priceOffsetRef.current / 100) * zoomedLogRange
      logMin = logMid - zoomedLogRange / 2 + logShift
      logMax = logMid + zoomedLogRange / 2 + logShift
      minPrice = Math.exp(logMin)
      maxPrice = Math.exp(logMax)
    } else {
      const midPrice = (dataMaxPrice + dataMinPrice) / 2
      // Flat / single-value window -> fall back to a small band around the price
      // so it still renders sensibly instead of collapsing to a zero-height line.
      const paddedRange = dataPriceRange > 0
        ? dataPriceRange * (1 + 2 * PRICE_PAD_FRAC)
        : Math.max(midPrice * 0.1, 1e-9)
      const zoomedRange = paddedRange / priceZoomRef.current
      const priceShift = (priceOffsetRef.current / 100) * zoomedRange
      minPrice = midPrice - zoomedRange / 2 + priceShift
      maxPrice = midPrice + zoomedRange / 2 + priceShift
      // Prices can't go negative — when vertical zoom/pan pushes the window
      // below zero, shift it up so the axis never prints "$-0.29" labels.
      if (minPrice < 0) {
        maxPrice -= minPrice
        minPrice = 0
      }
      logMin = 0
      logMax = 0
    }
    const priceRange = maxPrice - minPrice
    const logRange = useLogScale ? (logMax - logMin) : 1

    const scaleY = (price) => {
      if (useLogScale && price > 0) {
        return chartTop + chartHeight - ((Math.log(price) - logMin) / logRange) * chartHeight
      }
      return chartTop + chartHeight - ((price - minPrice) / priceRange) * chartHeight
    }

    // === SUBTLE GRID ===
    ctx.strokeStyle = C.grid
    ctx.lineWidth = 1
    
    for (let i = 1; i < 5; i++) {
      const y = chartTop + (chartHeight / 5) * i
      ctx.beginPath()
      ctx.moveTo(chartLeft, y)
      ctx.lineTo(chartRight, y)
      ctx.stroke()
    }

    // === DESIGN SYSTEM TRADING COLORS ===
    // Body uses --bull / --bear (full opacity = crisp, readable on dark void).
    // Wicks use --bull-bright / --bear-bright so they stay legible when bodies
    // are tightly packed (zoomed-out 1H view). Day mode darkens both a touch.
    const greenColor = dm ? '#059669' : '#10B981'           // --bull
    const redColor   = dm ? '#DC2626' : '#EF4444'           // --bear
    const greenWickColor = dm ? '#10B981' : '#34D399'       // --bull-bright
    const redWickColor   = dm ? '#EF4444' : '#F87171'       // --bear-bright

    // === DRAW CHART BASED ON TYPE ===
    // Clip the index-positioned passes (line/candles/indicators) to the chart
    // area: with the sub-candle pixel shift the right-most candle can extend
    // past chartRight and would otherwise bleed under the price-axis gutter.
    ctx.save()
    ctx.beginPath()
    ctx.rect(chartLeft, 0, chartRight - chartLeft, rect.height)
    ctx.clip()
    if (chartType === 'line') {
      // === STUNNING LINE CHART - PREMIUM GRADIENT ===

      // Guard: need at least 2 data points to draw a line
      if (visibleData.length < 2) {
        // Draw nothing — fall through to volume/price sections below
      }

      const points = visibleData.length >= 2 ? visibleData.map((candle, i) => ({
        x: chartLeft + (leftEmptyCandles + i) * candleWidth + candleWidth / 2 - (rightEmptyCandles * candleWidth) + panFracPx,
        y: scaleY(candle.close)
      })) : []

      // Calculate if overall trend is up or down
      const startPrice = visibleData.length > 0 ? visibleData[0].close : 0
      const endPrice = visibleData.length > 0 ? visibleData[visibleData.length - 1].close : 0
      const isOverallUp = endPrice >= startPrice

      // === LINE COLOR THEME ===
      const activeLineTheme = LINE_THEMES.find(t => t.id === lineColorTheme)
      const themeKind = activeLineTheme?.kind || null
      // 'baseline' (Up/Down) draws green-above / red-below the period open instead
      // of a single gradient. 'logo' uses the token's real multi-hue logo gradient.
      const isBaseline = themeKind === 'baseline'
      const hexToRgb = (hex) => {
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        return { r, g, b }
      }

      // Resolve colors: if theme is 'auto', use trend-based or token brand; otherwise use theme colors
      // In day mode, 'auto' uses darker shades and 'white' becomes dark slate
      let themeColors
      if (!activeLineTheme?.colors) {
        // Auto mode: token brand color always wins over the bearish/bullish trend gradient.
        // useTokenBrandColor resolves curated → server KV → canvas extraction → hash, so
        // tokenBrandRgb is always non-null for any non-stock token.
        const brandRgbStr = tokenBrandRgb

        if (brandRgbStr) {
          // Build 4-stop gradient from token brand color (base → progressively lighter)
          const [br, bg, bb] = brandRgbStr.split(',').map(s => parseInt(s.trim(), 10))
          const lighten = (r, g, b, f) => {
            const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)))
            const lr = clamp(r + (255 - r) * f)
            const lg = clamp(g + (255 - g) * f)
            const lb = clamp(b + (255 - b) * f)
            return `#${lr.toString(16).padStart(2,'0')}${lg.toString(16).padStart(2,'0')}${lb.toString(16).padStart(2,'0')}`
          }
          if (dm) {
            // Day mode: keep the ramp deep/saturated - lightening toward white
            // washed the line out on the white background.
            themeColors = [
              lighten(br, bg, bb, -0.28),
              lighten(br, bg, bb, -0.12),
              lighten(br, bg, bb, 0.02),
              lighten(br, bg, bb, 0.14),
            ]
          } else {
            themeColors = [
              lighten(br, bg, bb, 0),
              lighten(br, bg, bb, 0.2),
              lighten(br, bg, bb, 0.4),
              lighten(br, bg, bb, 0.6),
            ]
          }
        } else if (dm) {
          themeColors = isOverallUp
            ? ['#0891b2', '#0d9488', '#14b8a6', '#2dd4bf']
            : ['#7c3aed', '#8b5cf6', '#a78bfa', '#c4b5fd']
        } else {
          themeColors = isOverallUp
            ? ['#06b6d4', '#14b8a6', '#2dd4bf', '#5eead4']
            : ['#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe']
        }
      } else if (activeLineTheme.id === 'white' && dm) {
        // "White" theme in day mode: use dark slate colors so line is visible
        themeColors = ['#1e293b', '#334155', '#475569', '#64748b']
      } else if (activeLineTheme.id === 'black' && !dm) {
        // "Black" theme in dark mode: use light slate colors so line is visible
        themeColors = ['#e2e8f0', '#cbd5e1', '#f1f5f9', '#f8fafc']
      } else {
        themeColors = activeLineTheme.colors
      }

      // Logo mode: prefer the token's real logo gradient (SOL = purple->green),
      // otherwise keep the single-hue brand gradient resolved above as a fallback.
      if (themeKind === 'logo' && LOGO_GRADIENTS[tokenSymbol]) {
        themeColors = LOGO_GRADIENTS[tokenSymbol]
      }

      const lineGradient = ctx.createLinearGradient(chartLeft, 0, chartRight, 0)
      lineGradient.addColorStop(0, themeColors[0])
      lineGradient.addColorStop(0.4, themeColors[1])
      lineGradient.addColorStop(0.7, themeColors[2])
      lineGradient.addColorStop(1, themeColors[3])

      // === AREA FILL GRADIENT (derived from theme) ===
      const baseRgb = hexToRgb(themeColors[0])
      const midRgb = hexToRgb(themeColors[1])
      const lightRgb = hexToRgb(themeColors[2])
      const paleRgb = hexToRgb(themeColors[3])

      // Day mode washes out on white, so the fill needs more presence than on
      // black — deeper top alpha + a longer solid body before it fades.
      const aTop = dm ? 0.58 : 0.35
      const aMid = dm ? 0.40 : 0.2
      const aLow = dm ? 0.18 : 0.1
      const areaGradient = ctx.createLinearGradient(0, chartTop, 0, chartBottom)
      areaGradient.addColorStop(0, `rgba(${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}, ${aTop})`)
      areaGradient.addColorStop(0.3, `rgba(${midRgb.r}, ${midRgb.g}, ${midRgb.b}, ${aMid})`)
      areaGradient.addColorStop(0.6, `rgba(${lightRgb.r}, ${lightRgb.g}, ${lightRgb.b}, ${aLow})`)
      areaGradient.addColorStop(1, `rgba(${paleRgb.r}, ${paleRgb.g}, ${paleRgb.b}, 0)`)

      // === DRAW AREA FILL ===
      if (points.length >= 2 && isBaseline) {
        // === UP / DOWN BASELINE (CMC-style: green above the period open, red below) ===
        const basePrice = visibleData[0]?.close
        const rawBaseY = Number.isFinite(basePrice) ? scaleY(basePrice) : chartBottom
        const baseY = Math.max(chartTop, Math.min(chartBottom, rawBaseY))
        const upHex = dm ? '#059669' : '#10B981'
        const dnHex = dm ? '#DC2626' : '#EF4444'
        const up = hexToRgb(upHex)
        const dn = hexToRgb(dnHex)

        // area polygon: the price line closed back to the baseline (not the axis)
        const traceToBaseline = () => {
          ctx.beginPath()
          ctx.moveTo(points[0].x, baseY)
          for (let i = 0; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
          ctx.lineTo(points[points.length - 1].x, baseY)
          ctx.closePath()
        }
        const traceLine = () => {
          ctx.beginPath()
          ctx.moveTo(points[0].x, points[0].y)
          for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
        }

        ctx.save()
        ctx.beginPath()
        ctx.rect(chartLeft, chartTop, chartRight - chartLeft, chartBottom - chartTop)
        ctx.clip()

        // Day mode washes on white — deepen the fill peak so green/red read.
        const bFillPeak = dm ? 0.42 : 0.30

        // GREEN fill — region above the baseline
        ctx.save()
        ctx.beginPath(); ctx.rect(chartLeft, chartTop, chartRight - chartLeft, baseY - chartTop); ctx.clip()
        traceToBaseline()
        const gGrad = ctx.createLinearGradient(0, chartTop, 0, baseY)
        gGrad.addColorStop(0, `rgba(${up.r}, ${up.g}, ${up.b}, ${bFillPeak})`)
        gGrad.addColorStop(1, `rgba(${up.r}, ${up.g}, ${up.b}, 0.02)`)
        ctx.fillStyle = gGrad; ctx.fill()
        ctx.restore()

        // RED fill — region below the baseline
        ctx.save()
        ctx.beginPath(); ctx.rect(chartLeft, baseY, chartRight - chartLeft, chartBottom - baseY); ctx.clip()
        traceToBaseline()
        const rGrad = ctx.createLinearGradient(0, baseY, 0, chartBottom)
        rGrad.addColorStop(0, `rgba(${dn.r}, ${dn.g}, ${dn.b}, 0.02)`)
        rGrad.addColorStop(1, `rgba(${dn.r}, ${dn.g}, ${dn.b}, ${bFillPeak})`)
        ctx.fillStyle = rGrad; ctx.fill()
        ctx.restore()

        // dashed baseline guide at the period open
        ctx.strokeStyle = dm ? 'rgba(15,23,42,0.35)' : 'rgba(235,238,245,0.28)'
        ctx.lineWidth = 1; ctx.setLineDash([4, 4])
        ctx.beginPath(); ctx.moveTo(chartLeft, baseY); ctx.lineTo(chartRight, baseY); ctx.stroke(); ctx.setLineDash([])

        // line — green where above the baseline, red where below (two clipped strokes)
        ctx.lineWidth = dm ? 1.9 : 1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
        ctx.save(); ctx.beginPath(); ctx.rect(chartLeft, chartTop, chartRight - chartLeft, baseY - chartTop); ctx.clip(); ctx.strokeStyle = upHex; traceLine(); ctx.stroke(); ctx.restore()
        ctx.save(); ctx.beginPath(); ctx.rect(chartLeft, baseY, chartRight - chartLeft, chartBottom - baseY); ctx.clip(); ctx.strokeStyle = dnHex; traceLine(); ctx.stroke(); ctx.restore()

        ctx.restore()

        // live dot — colored by which side of the baseline the last point sits on
        const lastPoint = points[points.length - 1]
        if (lastPoint && Number.isFinite(lastPoint.x) && Number.isFinite(lastPoint.y)) {
          const dotHex = lastPoint.y <= baseY ? upHex : dnHex
          livePointRef.current = { x: lastPoint.x, y: lastPoint.y, color: dotHex }
          ctx.fillStyle = dotHex
          ctx.beginPath(); ctx.arc(lastPoint.x, lastPoint.y, 3.5, 0, Math.PI * 2); ctx.fill()
        }
      } else if (points.length >= 2) {
      // Clip to chart drawing area so out-of-range spikes can't bleed into
      // the volume row or time axis row below.
      ctx.save()
      ctx.beginPath()
      ctx.rect(chartLeft, chartTop, chartRight - chartLeft, chartBottom - chartTop)
      ctx.clip()

      ctx.beginPath()
      ctx.moveTo(points[0].x, chartBottom)

      // Sharp line-to-line through all points — accurate price representation
      for (let i = 0; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y)
      }
      ctx.lineTo(points[points.length - 1].x, chartBottom)
      ctx.closePath()
      ctx.fillStyle = areaGradient
      ctx.fill()

      // === SUBTLE GLOW EFFECT ===
      // On white the colored blur reads as a fuzzy/faded halo, so day mode gets a
      // crisp line (no glow); dark mode keeps the soft glow it looks good with.
      ctx.shadowColor = dm ? 'transparent' : `rgba(${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}, 0.32)`
      ctx.shadowBlur = dm ? 0 : 4
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0

      // === DRAW MAIN LINE ===
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)

      // Direct point-to-point — crisp, readable price action
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y)
      }

      ctx.strokeStyle = lineGradient
      ctx.lineWidth = dm ? 1.9 : 1.25 // thicker on white so the line holds presence
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()

      ctx.restore()

      // Reset shadow
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0

      // === CURRENT POINT - SINGLE CRISP DOT ===
      // Just one dot. No reticle, no halo, no pulse. Bloomberg-style restraint.
      const lastPoint = points[points.length - 1]

      if (lastPoint && Number.isFinite(lastPoint.x) && Number.isFinite(lastPoint.y)) {
        livePointRef.current = { x: lastPoint.x, y: lastPoint.y, color: themeColors[0] }

        const accentColor = themeColors[0]

        ctx.fillStyle = accentColor
        ctx.beginPath()
        ctx.arc(lastPoint.x, lastPoint.y, 3.5, 0, Math.PI * 2)
        ctx.fill()
      }
      } // end points.length >= 2 guard

    } else {
      // === DRAW CANDLES - Batched by color for performance ===
      // Instead of per-candle state changes, batch all green/red wicks and bodies
      // into single paths. Reduces canvas operations from O(n*10) to O(n)+4 draws.
      ctx.save()
      ctx.beginPath()
      ctx.rect(chartLeft, chartTop, chartRight - chartLeft, chartBottom - chartTop)
      ctx.clip()

      const wickWidth = Math.max(1, bodyWidth * 0.12)
      const halfBody = bodyWidth / 2
      // Tick width for flat candles (O==H==L==C) - short centered mark, not a full-width bar.
      // Stops sparse line-only data (CoinGecko market_chart fallback) from rendering as
      // a confusing dashed pattern across the chart.
      const flatTickHalfWidth = Math.max(2, bodyWidth * 0.18)

      // Pre-compute candle geometry in a single pass
      const greenWickPath = new Path2D()
      const redWickPath = new Path2D()
      const greenBodyPath = new Path2D()
      const redBodyPath = new Path2D()

      for (let i = 0; i < visibleData.length; i++) {
        const candle = visibleData[i]
        const x = chartLeft + (leftEmptyCandles + i) * candleWidth + candleWidth / 2 - (rightEmptyCandles * candleWidth) + panFracPx

        const isGreen = candle.close >= candle.open
        const openY = scaleY(candle.open)
        const closeY = scaleY(candle.close)
        const highY = scaleY(candle.high)
        const lowY = scaleY(candle.low)
        const isFlat = candle.high === candle.low && candle.open === candle.close

        if (isFlat) {
          // Doji-style centered tick: short horizontal mark, no wick, no full-width body.
          const bodyPath = isGreen ? greenBodyPath : redBodyPath
          bodyPath.rect(x - flatTickHalfWidth, closeY, flatTickHalfWidth * 2, 1)
          continue
        }

        const bodyTop = Math.min(openY, closeY)
        const bodyH = Math.max(1, Math.abs(closeY - openY))

        // Add wick to the appropriate path
        const wickPath = isGreen ? greenWickPath : redWickPath
        wickPath.moveTo(x, highY)
        wickPath.lineTo(x, lowY)

        // Add body to the appropriate path
        const bodyPath = isGreen ? greenBodyPath : redBodyPath
        bodyPath.rect(x - halfBody, bodyTop, bodyWidth, bodyH)
      }

      // Draw all wicks (2 strokes instead of n)
      ctx.lineWidth = wickWidth
      ctx.lineCap = 'butt'

      ctx.strokeStyle = greenWickColor
      ctx.stroke(greenWickPath)

      ctx.strokeStyle = redWickColor
      ctx.stroke(redWickPath)

      // Draw all bodies (2 fills instead of n)
      ctx.fillStyle = greenColor
      ctx.fill(greenBodyPath)

      ctx.fillStyle = redColor
      ctx.fill(redBodyPath)

      ctx.restore()
    }

    // === INDICATOR OVERLAYS ===
    // Draw inside clipped chart area
    if (Object.values(activeIndicators).some(v => v)) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(chartLeft, chartTop, chartRight - chartLeft, chartBottom - chartTop)
      ctx.clip()

      // Helper: draw a line series on the chart
      const drawIndicatorLine = (values, visibleStartIdx, style) => {
        ctx.strokeStyle = style.color
        ctx.lineWidth = style.width
        ctx.globalAlpha = 0.8
        ctx.beginPath()
        let started = false
        for (let i = 0; i < visibleData.length; i++) {
          const dataIdx = visibleStartIdx + i
          if (dataIdx < 0 || dataIdx >= values.length) continue
          const val = values[dataIdx]
          if (val === null || val === undefined) { started = false; continue }
          const x = chartLeft + (leftEmptyCandles + i) * candleWidth + candleWidth / 2 - (rightEmptyCandles * candleWidth) + panFracPx
          const y = scaleY(val)
          if (!started) { ctx.moveTo(x, y); started = true }
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      // startIndex is already the offset into displayCandleData for the visible window
      const visibleStartIdx = startIndex

      // Draw each active indicator (EMA/SMA lines)
      for (const [key, style] of Object.entries(INDICATOR_STYLES)) {
        if (key === 'bb') continue // BB drawn separately below
        if (!activeIndicators[key] || !indicatorData[key]) continue
        drawIndicatorLine(indicatorData[key], visibleStartIdx, style)
      }

      // Bollinger Bands — draw upper, middle, lower + filled band
      if (activeIndicators.bb && indicatorData.bb) {
        const bb = indicatorData.bb
        const bbColor = '#06b6d4'
        // Fill between upper and lower bands
        ctx.fillStyle = dayMode ? 'rgba(6, 182, 212, 0.06)' : 'rgba(6, 182, 212, 0.04)'
        ctx.beginPath()
        let bandStarted = false
        const upperPoints = []
        for (let i = 0; i < visibleData.length; i++) {
          const dataIdx = visibleStartIdx + i
          if (dataIdx < 0 || dataIdx >= bb.upper.length) continue
          if (bb.upper[dataIdx] === null) continue
          const x = chartLeft + (leftEmptyCandles + i) * candleWidth + candleWidth / 2 - (rightEmptyCandles * candleWidth) + panFracPx
          const yUp = scaleY(bb.upper[dataIdx])
          const yLo = scaleY(bb.lower[dataIdx])
          upperPoints.push({ x, yUp, yLo })
          if (!bandStarted) { ctx.moveTo(x, yUp); bandStarted = true }
          else ctx.lineTo(x, yUp)
        }
        // Trace back along lower band
        for (let i = upperPoints.length - 1; i >= 0; i--) {
          ctx.lineTo(upperPoints[i].x, upperPoints[i].yLo)
        }
        ctx.closePath()
        ctx.fill()

        // Draw upper and lower lines
        drawIndicatorLine(bb.upper, visibleStartIdx, { color: bbColor, width: 1 })
        drawIndicatorLine(bb.lower, visibleStartIdx, { color: bbColor, width: 1 })
        // Middle (SMA 20) line
        drawIndicatorLine(bb.middle, visibleStartIdx, { color: bbColor, width: 1.5 })
      }

      // VWAP
      if (activeIndicators.vwap && indicatorData.vwap) {
        drawIndicatorLine(indicatorData.vwap, visibleStartIdx, INDICATOR_STYLES.vwap)
      }

      ctx.restore()
    }

    // === HELPER FUNCTIONS FOR MCAP MODE ===
    // Format large numbers for MCap display
    const formatMcap = (value) => hookFmtLarge(value)
    
    // Use REAL circulating supply from API (via ref to avoid redraw on every poll)
    // The API returns the actual number (e.g., 900000000 for 900M tokens).
    // Fallback chain: circulatingSupply → totalSupply → marketCap/price → fdv/price.
    // Both the chart's own useTokenDetails hook AND the parent's `stats` prop are
    // probed — the parent often has supply data the chart's hook misses (e.g.
    // tokens whose onchain endpoint omits circulating_supply but research-zone
    // has already merged it from CoinGecko / Spectre profile).
    const _td = liveTokenDataRef.current
    const _price = parseFloat(_td?.price) || parseFloat(stats?.price) || 0
    const _circ = parseFloat(_td?.circulatingSupply)
      || parseFloat(stats?.circulatingSupply)
      || parseFloat(stats?.circulating)
      || 0
    const _total = parseFloat(_td?.totalSupply) || parseFloat(stats?.totalSupply) || 0
    const _mcap = parseFloat(_td?.marketCap)
      || parseFloat(stats?.marketCap)
      || parseFloat(stats?.mcap)
      || 0
    const _fdv = parseFloat(_td?.fullyDilutedValuation)
      || parseFloat(_td?.fdv)
      || parseFloat(stats?.fullyDilutedValuation)
      || parseFloat(stats?.fdv)
      || 0
    const circSupply = _circ
      || _total
      || (_mcap > 0 && _price > 0 ? _mcap / _price : 0)
      || (_fdv > 0 && _price > 0 ? _fdv / _price : 0)

    // End of index-positioned clip — price line/labels/axis draw in the gutter.
    ctx.restore()

    // === CURRENT PRICE LINE - ALWAYS SHOWS LIVE/LATEST PRICE ===
    // Use the actual latest candle from the FULL dataset, not just visible data
    // This ensures the current price line always shows the live price even when scrolled left
    const latestCandle = displayCandleData[displayCandleData.length - 1]
    const currentPrice = latestCandle?.close
    
    // Skip price line rendering if data is invalid
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      // Skip the entire price line section if price is invalid
    } else {
    const currentY = scaleY(currentPrice)
    const isUp = latestCandle.close >= latestCandle.open
    
    // Only draw the price line if it's within the visible price range (or close to it)
    const isPriceInView = currentY >= chartTop - 50 && currentY <= chartBottom + 50
    
    // Different color schemes for Line chart vs Candle chart
    let priceLineColor, badgeBgColor
    if (chartType === 'line') {
      // Line chart: use selected theme color, token brand, or auto trend-based
      const activeTheme = LINE_THEMES.find(t => t.id === lineColorTheme)
      const themeBase = activeTheme?.colors?.[0]
      if (activeTheme?.kind === 'baseline') {
        // Up/Down mode: badge + line follow the side of the period open
        const base = visibleData[0]?.close
        const above = Number.isFinite(base) ? currentPrice >= base : isUp
        priceLineColor = above ? '#10B981' : '#EF4444'
        badgeBgColor = above ? 'rgba(16, 185, 129, 0.9)' : 'rgba(239, 68, 68, 0.9)'
      } else if (themeBase) {
        priceLineColor = themeBase
        const _rgb = parseInt(themeBase.slice(1), 16)
        badgeBgColor = `rgba(${(_rgb >> 16) & 255}, ${(_rgb >> 8) & 255}, ${_rgb & 255}, 0.9)`
      } else {
        // Auto mode: token brand color (curated → server KV → canvas → hash)
        const brandRgbStr = tokenBrandRgb
        if (brandRgbStr) {
          const [_br, _bg, _bb] = brandRgbStr.split(',').map(s => parseInt(s.trim(), 10))
          priceLineColor = `rgb(${_br}, ${_bg}, ${_bb})`
          badgeBgColor = `rgba(${_br}, ${_bg}, ${_bb}, 0.9)`
        } else {
          priceLineColor = isUp ? '#14b8a6' : '#8b5cf6'
          badgeBgColor = isUp ? 'rgba(20, 184, 166, 0.9)' : 'rgba(139, 92, 246, 0.9)'
        }
      }
    } else {
      // Candle chart: Muted green/red
      priceLineColor = isUp ? 'rgba(52, 199, 89, 0.6)' : 'rgba(239, 83, 80, 0.55)'
      badgeBgColor = isUp ? 'rgba(52, 199, 89, 0.8)' : 'rgba(239, 83, 80, 0.75)'
    }

    // Simple, elegant dashed line - always visible
    ctx.strokeStyle = priceLineColor
    ctx.globalAlpha = isPriceInView ? 0.5 : 0.3
    ctx.lineWidth = 1
    ctx.setLineDash([6, 6])
    ctx.beginPath()
    // Clamp Y position to visible area but still show the line
    const clampedY = Math.max(chartTop, Math.min(chartBottom, currentY))
    ctx.moveTo(chartLeft, clampedY)
    ctx.lineTo(chartRight, clampedY)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1

    // === PRICE LABEL - BLOOMBERG / COINBASE-ADVANCED STYLE ===
    // Compact dark pill. Colored mono text. No fill, no notch, no shadow.
    // Sits naturally in line with the Y-axis tick labels.
    const priceFont = '600 11px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif'
    ctx.font = priceFont
    const badgePriceText = yAxisMode === 'mcap' && circSupply > 0
      ? formatMcap(currentPrice * circSupply)
      : hookFmtPrice(currentPrice)
    const badgeTextWidth = ctx.measureText(badgePriceText).width
    const padX = 8
    const badgeWidth = Math.max(58, badgeTextWidth + padX * 2)
    const badgeHeight = 18
    // Fit the actual currency-formatted labels, including the live pill's padding.
    // Grow only, so live updates cannot make the plot jitter horizontally.
    if (responsiveControls) {
      ctx.save()
      ctx.font = '600 12.5px "SF Pro Text", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
      let needed = Math.max(75, badgeWidth + 14)
      for (let i = 0; i <= 4; i++) {
        const fraction = (4 - i) / 4
        const value = useLogScale ? Math.exp(logMin + fraction * logRange) : minPrice + priceRange * fraction
        const label = yAxisMode === 'mcap' && circSupply > 0 ? formatMcap(value * circSupply) : hookFmtPrice(value)
        needed = Math.max(needed, ctx.measureText(label).width + 20)
      }
      ctx.restore()
      const measuredWidth = Math.ceil(needed)
      if (measuredWidth > priceAxisWidth) setPriceAxisWidth(previous => Math.max(previous, measuredWidth))
    }
    const badgeX = responsiveControls ? Math.min(chartRight + 6, rect.width - badgeWidth - 8) : chartRight + 6
    const badgeY = clampedY - badgeHeight / 2
    const badgeR = 3

    // Live pill carries a touch of the line/trend color (CMC-style) so it reads
    // as THE live value, distinct from the neutral warm-white scale ticks. Text
    // color auto-picks for contrast so any brand hue (light gold or dark navy)
    // stays legible. No left-edge accent bar (that reads as AI slop).
    const _pillRgb = (() => {
      const c = priceLineColor
      if (!c) return { r: 120, g: 120, b: 130 }
      if (c[0] === '#') {
        const n = parseInt(c.slice(1, 7), 16)
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
      }
      const m = c.match(/\d+(\.\d+)?/g)
      return (m && m.length >= 3) ? { r: +m[0], g: +m[1], b: +m[2] } : { r: 120, g: 120, b: 130 }
    })()
    ctx.fillStyle = `rgba(${_pillRgb.r}, ${_pillRgb.g}, ${_pillRgb.b}, ${dm ? 0.92 : 0.95})`
    ctx.beginPath()
    ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, badgeR)
    ctx.fill()

    // Auto-contrast text (relative luminance): dark text on light pills, white on dark
    const _pillLum = 0.299 * _pillRgb.r + 0.587 * _pillRgb.g + 0.114 * _pillRgb.b
    ctx.fillStyle = _pillLum > 150 ? '#0b0b0d' : '#ffffff'
    ctx.font = priceFont
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(badgePriceText, badgeX + badgeWidth / 2, clampedY + 0.5)
    ctx.textBaseline = 'alphabetic'

    // Off-screen direction arrows
    if (currentY < chartTop) {
      ctx.fillStyle = priceLineColor
      ctx.beginPath()
      ctx.moveTo(badgeX + badgeWidth / 2 - 3.5, badgeY - 3)
      ctx.lineTo(badgeX + badgeWidth / 2 + 3.5, badgeY - 3)
      ctx.lineTo(badgeX + badgeWidth / 2, badgeY - 8)
      ctx.closePath()
      ctx.fill()
    } else if (currentY > chartBottom) {
      ctx.fillStyle = priceLineColor
      ctx.beginPath()
      ctx.moveTo(badgeX + badgeWidth / 2 - 3.5, badgeY + badgeHeight + 3)
      ctx.lineTo(badgeX + badgeWidth / 2 + 3.5, badgeY + badgeHeight + 3)
      ctx.lineTo(badgeX + badgeWidth / 2, badgeY + badgeHeight + 8)
      ctx.closePath()
      ctx.fill()
    }
    } // End of currentPrice validity check

    // === S/R ZONES (detected swing levels: local = this timeframe, major = daily anchor) ===
    if (activeIndicators.srzones && srZoneData && chartViewMode === 'trading') {
      const zonesToDraw = [...(srZoneData.local || []), ...(srZoneData.major || [])]
      ctx.save()
      ctx.font = '600 10px "SF Pro Text", -apple-system, system-ui, sans-serif'
      for (const z of zonesToDraw) {
        const isMajor = z.kind === 'major'
        const isRes = z.side === 'resistance'
        const rgb = isRes ? '239, 68, 68' : '16, 185, 129'
        const yA = scaleY(z.high)
        const yB = scaleY(z.low)
        const top = Math.min(yA, yB)
        const bot = Math.max(yA, yB)
        if (bot < chartTop || top > chartBottom) continue
        const clampTop = Math.max(chartTop, top)
        const clampBot = Math.min(chartBottom, bot)

        // Band fill (majors stronger)
        ctx.fillStyle = `rgba(${rgb}, ${isMajor ? (dayMode ? 0.10 : 0.07) : (dayMode ? 0.055 : 0.04)})`
        ctx.fillRect(chartLeft, clampTop, chartRight - chartLeft, Math.max(1, clampBot - clampTop))

        // Mid line for majors (dashed) so the level reads even when zoomed out
        if (isMajor) {
          const midY = scaleY(z.mid)
          if (midY >= chartTop && midY <= chartBottom) {
            ctx.strokeStyle = `rgba(${rgb}, ${dayMode ? 0.45 : 0.35})`
            ctx.lineWidth = 1
            ctx.setLineDash([6, 4])
            ctx.beginPath()
            ctx.moveTo(chartLeft, midY)
            ctx.lineTo(chartRight, midY)
            ctx.stroke()
            ctx.setLineDash([])
          }
        }

        // Left-edge label: "Major R ×3" / "R ×5"
        const labelY = clampTop + 11
        if (labelY < chartBottom - 2) {
          ctx.fillStyle = `rgba(${rgb}, ${dayMode ? 0.85 : 0.7})`
          ctx.textAlign = 'left'
          ctx.fillText(`${isMajor ? 'Major ' : ''}${isRes ? 'R' : 'S'}${z.touches ? ` ×${z.touches}` : ''}`, chartLeft + 6, labelY)
        }
      }
      ctx.restore()
    }

    // === ATH LINES (All-Time High & Local High) ===
    if (showATHLines && displayCandleData.length > 0) {
      // For line chart, use close prices (what's actually drawn)
      // For candle chart, use high prices (wick tops)
      const priceField = chartType === 'line' ? 'close' : 'high'
      
      // Use trueATH from hook if available (fetched from all historical data)
      // Fall back to calculating from loaded candleData if not available yet
      let athPrice = trueATH
      if (!athPrice || athPrice <= 0) {
        const allHighs = displayCandleData.map(c => {
          const val = c[priceField]
          return typeof val === 'number' && Number.isFinite(val) ? val : 0
        }).filter(v => v > 0)
        athPrice = allHighs.length > 0 ? Math.max(...allHighs) : 0
      }
      const athY = scaleY(athPrice)
      
      // Calculate Local High (highest in visible data)
      const visibleHighs = visibleData.map(c => {
        const val = c[priceField]
        return typeof val === 'number' && Number.isFinite(val) ? val : 0
      }).filter(v => v > 0)
      
      const localHighPrice = visibleHighs.length > 0 ? Math.max(...visibleHighs) : 0
      const localHighY = scaleY(localHighPrice)
      
      
      // Format value based on yAxisMode (price or mcap)
      // Use adaptive decimal places for small prices
      const formatATHValue = (price) => {
        if (yAxisMode === 'mcap' && circSupply > 0) {
          const mcapValue = price * circSupply
          return formatMcap(mcapValue)
        }
        return hookFmtPrice(price)
      }
      
      // Draw ATH line (gold/yellow color)
      if (athY >= chartTop - 20 && athY <= chartBottom + 20) {
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)' // Amber/gold
        ctx.lineWidth = 1
        ctx.setLineDash([6, 4])
        ctx.beginPath()
        ctx.moveTo(chartLeft, athY)
        ctx.lineTo(chartRight, athY)
        ctx.stroke()
        ctx.setLineDash([])

        // ATH label on right side (clamped inside the pane so it never
        // paints above chartTop when the line sits near the top edge)
        ctx.fillStyle = 'rgba(251, 191, 36, 0.95)'
        ctx.font = '600 11px "SF Pro Text", -apple-system, system-ui, sans-serif'
        ctx.textAlign = 'right'
        ctx.fillText(`ATH ${formatATHValue(athPrice)}`, chartRight - 8, Math.max(athY - 5, chartTop + 12))
      } else if (athPrice > 0) {
        // ATH is OUTSIDE the visible price range (common on short timeframes
        // where price sits far below ATH). The old code drew NOTHING, so
        // toggling the button appeared broken. Anchor a direction hint at the
        // pane edge instead - TradingView-style off-screen level affordance.
        const above = athY < chartTop - 20
        const edgeY = above ? chartTop + 12 : chartBottom - 6
        ctx.fillStyle = 'rgba(251, 191, 36, 0.9)'
        ctx.font = '600 11px "SF Pro Text", -apple-system, system-ui, sans-serif'
        ctx.textAlign = 'right'
        ctx.fillText(`ATH ${formatATHValue(athPrice)} ${above ? '↑' : '↓'}`, chartRight - 8, edgeY)
      }

      // Draw Local High line (cyan/teal color) - only if significantly different from ATH
      if (localHighPrice < athPrice * 0.995 && localHighY >= chartTop - 20 && localHighY <= chartBottom + 20) {
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.5)' // Cyan
        ctx.lineWidth = 1
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(chartLeft, localHighY)
        ctx.lineTo(chartRight, localHighY)
        ctx.stroke()
        ctx.setLineDash([])

        // Local High label on right side. Clamped: the local high is usually
        // the very TOP of the visible range, so an unclamped `y - 5` painted
        // the label above chartTop where it was clipped - "local high doesn't
        // work". Also dodge the ATH label when both sit at the top edge.
        ctx.fillStyle = 'rgba(34, 211, 238, 0.9)'
        ctx.font = '600 11px "SF Pro Text", -apple-system, system-ui, sans-serif'
        ctx.textAlign = 'right'
        const athAtTop = athY < chartTop + 24 // ATH line/hint occupies the top strip
        const lhLabelY = Math.max(localHighY - 5, chartTop + (athAtTop ? 26 : 12))
        ctx.fillText(`Local High ${formatATHValue(localHighPrice)}`, chartRight - 8, lhLabelY)
      }
    }

    // === PRICE/MCAP LABELS (Y-axis) - RIGHT SIDE ===
    ctx.fillStyle = C.axisText
    ctx.font = AXIS_LABEL_FONT
    ctx.textAlign = responsiveControls ? 'right' : 'left'
    const axisLabelX = responsiveControls ? rect.width - 8 : chartRight + 10

    // Smart de-collision: the live price/mcap pill (drawn above) always shows the
    // exact current value, so a scale tick sitting on the same row is redundant
    // AND overlaps it (the "$49.66B / $44.65B" stack). Suppress any gridline label
    // whose Y lands within the pill's band so the live value reads cleanly.
    const liveLabelY = (Number.isFinite(currentPrice) && currentPrice > 0)
      ? Math.max(chartTop, Math.min(chartBottom, scaleY(currentPrice)))
      : null
    const LABEL_COLLIDE_PX = 13 // ~ pill half-height + a hair of margin

    for (let i = 0; i <= 4; i++) {
      const fraction = (4 - i) / 4
      const price = useLogScale
        ? Math.exp(logMin + fraction * logRange)
        : minPrice + priceRange * fraction
      const y = chartTop + (chartHeight / 4) * i

      // Skip the tick colliding with the live pill (live value wins, even at the
      // top/bottom edge — the pill shows a more precise value on that same row).
      if (liveLabelY != null && Math.abs(y - liveLabelY) < LABEL_COLLIDE_PX) continue

      if (yAxisMode === 'mcap' && circSupply > 0) {
        const mcap = price * circSupply
        ctx.fillText(formatMcap(mcap), axisLabelX, y + 4)
      } else {
        ctx.fillText(hookFmtPrice(price), axisLabelX, y + 4)
      }
    }

    // === VOLUME BARS - Batched by color ===
    // Bars with volume = 0/null (e.g. CoinGecko market_chart fallback returns no
    // per-bar volume) get a faint 1px placeholder tick so the row stays visually
    // continuous instead of leaving a confusing empty gap.
    if (visibleData.length > 0) {
      // Same chart-area clip as the candle pass (sub-candle pixel shift).
      ctx.save()
      ctx.beginPath()
      ctx.rect(chartLeft, 0, chartRight - chartLeft, rect.height)
      ctx.clip()
      let maxVolume = 0
      for (let i = 0; i < visibleData.length; i++) {
        const v = visibleData[i].volume || 0
        if (v > maxVolume) maxVolume = v
      }
      const greenVolPath = new Path2D()
      const redVolPath = new Path2D()
      const placeholderPath = new Path2D()
      const volXOffset = candleWidth * 0.15
      for (let i = 0; i < visibleData.length; i++) {
        const candle = visibleData[i]
        if (!candle) continue
        // MUST match the candle x-formula (leftEmpty/rightEmpty pan offsets).
        // This was the lone renderer without them: panned to the historical
        // data edge (leftEmptyCandles > 0, e.g. while older bars stream in),
        // candles shifted right but volume drew flush-left - volume bars
        // landed under empty columns and the chart read as "history candles
        // missing" (PALM repro, 2026-06-11). The hover hit-test at
        // handleMouseMove already assumed THIS formula.
        const x = chartLeft + (leftEmptyCandles + i) * candleWidth - (rightEmptyCandles * candleWidth) + panFracPx
        const hasVolume = candle.volume > 0 && maxVolume > 0
        if (hasVolume) {
          const barHeight = (candle.volume / maxVolume) * volumeHeight
          const barTop = volumeTop + volumeHeight - barHeight
          const isGreen = candle.close >= candle.open
          const path = isGreen ? greenVolPath : redVolPath
          path.rect(x + volXOffset, barTop, bodyWidth, barHeight)
        } else {
          // Placeholder: 1px tick at the bottom of the volume row
          placeholderPath.rect(x + volXOffset, volumeTop + volumeHeight - 1, bodyWidth, 1)
        }
      }
      if (maxVolume > 0) {
        ctx.fillStyle = C.volGreenFill
        ctx.fill(greenVolPath)
        ctx.fillStyle = C.volRedFill
        ctx.fill(redVolPath)
      }
      // Placeholder ticks — faint, not bull/bear-coded (data is missing, not bearish)
      ctx.fillStyle = dm ? 'rgba(15, 23, 42, 0.18)' : 'rgba(245, 245, 247, 0.14)'
      ctx.fill(placeholderPath)
      ctx.restore()
    }

    // === TIME LABELS (X-axis) - Using actual candle dates/timestamps ===
    ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif'
    ctx.textAlign = 'center'

    // Helper: get Date from candle (handles both .date and .time fields)
    const getCandleDate = (c) => {
      if (c.date instanceof Date && !isNaN(c.date.getTime())) return c.date
      if (typeof c.time === 'number' && c.time > 0) return new Date(c.time)
      return null
    }

    // Labels MUST carry the year when the visible window (a) crosses a year
    // boundary OR (b) sits in a PAST year entirely — deep scroll-back on an
    // intraday chart showed "Jul 4 18:00" with no way to tell 2024 from 2026
    // except the hover crosshair (Gleb 2026-07-03; original spans-years rule
    // Sunny 2026-06-10).
    const _firstD = visibleData.length > 0 ? getCandleDate(visibleData[0]) : null
    const _lastD = visibleData.length > 0 ? getCandleDate(visibleData[visibleData.length - 1]) : null
    const _nowYear = new Date().getFullYear()
    const showAxisYear = !!(_firstD && _lastD && (
      _firstD.getFullYear() !== _lastD.getFullYear() ||
      _lastD.getFullYear() !== _nowYear
    ))

    // Format date/time based on timeframe
    const formatTimeLabel = (date, tf) => {
      if (!date || isNaN(date.getTime())) return ''

      const hours = date.getHours().toString().padStart(2, '0')
      const minutes = date.getMinutes().toString().padStart(2, '0')
      const day = date.getDate()
      const month = date.toLocaleString('en', { month: 'short' })
      const year = date.getFullYear().toString().slice(-2)
      const dayLabel = showAxisYear ? `${month} ${day}, '${year}` : `${month} ${day}`

      switch(tf) {
        case '1M':
        case '5M':
        case '15M':
        case '30M':
          // Scrolled into a past year: bare HH:MM is meaningless context.
          return showAxisYear ? `${month} ${day} '${year} ${hours}:${minutes}` : `${hours}:${minutes}`
        case '1H':
        case '4H':
        case '12H':
        case '24H':
        case '1D': // "24h" range: 5m candles -> show intraday time
          return showAxisYear ? `${month} ${day} '${year} ${hours}:${minutes}` : `${month} ${day} ${hours}:${minutes}`
        case '1W':  // "1W" range: 1h candles -> day-level
        case '1MO': // "1M" range: 4h candles -> day-level
        case '7D':
        case '30D':
        case 'YTD':
          return dayLabel
        case '90D':
          return `${month} ${day}, '${year}`
        case '1Y':
        case 'ALL':
          return `${month} '${year}`
        default:
          return dayLabel
      }
    }

    // Subtle separator line above time axis
    const timeAxisTopY = rect.height - timeAxisHeight
    ctx.strokeStyle = C.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(chartLeft, timeAxisTopY)
    ctx.lineTo(chartRight, timeAxisTopY)
    ctx.stroke()

    // Position labels centered in time axis area
    const labelY = rect.height - timeAxisHeight / 2 + 4

    // Smart label count: measure widest possible label to avoid overlaps
    // (year-suffixed labels are wider - fewer ticks, no collisions)
    const sampleWidth = ctx.measureText(showAxisYear ? "Mar 03 '25 12:00" : 'Mar 03 12:00').width + 24
    const maxLabelsFromWidth = Math.max(2, Math.floor((chartRight - chartLeft) / sampleWidth))
    const targetLabelCount = Math.min(maxLabelsFromWidth, Math.max(3, 8))
    const labelInterval = Math.max(1, Math.ceil(visibleData.length / targetLabelCount))

    // Draw time labels aligned with candle positions (includes pan offsets)
    ctx.fillStyle = C.timeText
    let lastLabelRight = -Infinity // Track label positions to prevent overlap
    let lastLabelText = '' // Dedup by TEXT too: dense same-day bars otherwise
                           // repeat one label across the axis ("Apr 9" x7,
                           // Sunny 2026-06-10) since pixel spacing alone passes
    for (let i = 0; i < visibleData.length; i += labelInterval) {
      const candle = visibleData[i]
      if (!candle) continue
      const date = getCandleDate(candle)
      if (!date) continue

      const x = chartLeft + (leftEmptyCandles + i) * candleWidth + candleWidth / 2 - (rightEmptyCandles * candleWidth) + panFracPx
      if (x < chartLeft + 10 || x > chartRight - 10) continue // clip to chart area with margin

      const label = formatTimeLabel(date, timeframe)
      if (!label) continue
      if (label === lastLabelText) continue
      const labelWidth = ctx.measureText(label).width
      if (x - labelWidth / 2 < lastLabelRight + 8) continue // skip if too close to previous

      ctx.fillText(label, x, labelY)
      lastLabelRight = x + labelWidth / 2
      lastLabelText = label
    }

    // Always show the last candle's time (most recent) in accent color
    if (visibleData.length > 0) {
      const lastIdx = visibleData.length - 1
      const lastCandle = visibleData[lastIdx]
      const lastDate = getCandleDate(lastCandle)
      if (lastDate) {
        const x = chartLeft + (leftEmptyCandles + lastIdx) * candleWidth + candleWidth / 2 - (rightEmptyCandles * candleWidth) + panFracPx
        const label = formatTimeLabel(lastDate, timeframe)
        if (label && x >= chartLeft && x <= chartRight) {
          ctx.fillStyle = C.timeHighlight
          ctx.fillText(label, x, labelY)
          ctx.fillStyle = C.timeText
        }
      }
    }

    // === X CHART OVERLAY - Show social mentions on price chart ===
    if (chartViewMode === 'xChart') {
      // Draw line chart overlay first (pan offsets MUST match the candle
      // x-formula - same class of bug as the volume bars, 2026-06-11)
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.6)'
      ctx.lineWidth = 2
      visibleData.forEach((candle, i) => {
        const x = chartLeft + (leftEmptyCandles + i) * candleWidth + candleWidth / 2 - (rightEmptyCandles * candleWidth) + panFracPx
        const y = scaleY(candle.close)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // Add glow effect to line (was iterating displayCandleData - the FULL
      // series - which ignored panning entirely; use the visible slice)
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.2)'
      ctx.lineWidth = 6
      visibleData.forEach((candle, i) => {
        const x = chartLeft + (leftEmptyCandles + i) * candleWidth + candleWidth / 2 - (rightEmptyCandles * candleWidth) + panFracPx
        const y = scaleY(candle.close)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // Draw vertical lines at mention points
      xMentions.forEach(mention => {
        if (mention.candleIndex < displayCandleData.length) {
          const x = chartLeft + mention.candleIndex * candleWidth + candleWidth / 2
          const candle = displayCandleData[mention.candleIndex]
          const y = scaleY(candle.close)

          // Vertical dotted line
          ctx.strokeStyle = mention.sentiment === 'bullish' ? 'rgba(34, 197, 94, 0.4)' :
                           mention.sentiment === 'announcement' ? 'rgba(139, 92, 246, 0.6)' :
                           C.mentionNeutralLine
          ctx.lineWidth = 1
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(x, chartTop)
          ctx.lineTo(x, y - 25)
          ctx.stroke()
          ctx.setLineDash([])

          // Glow behind avatar
          const glowColor = mention.sentiment === 'bullish' ? 'rgba(34, 197, 94, 0.3)' :
                           mention.sentiment === 'announcement' ? 'rgba(139, 92, 246, 0.4)' :
                           C.mentionNeutralGlow
          ctx.fillStyle = glowColor
          ctx.beginPath()
          ctx.arc(x, y - 40, 22, 0, Math.PI * 2)
          ctx.fill()

          // Ring around avatar position
          ctx.strokeStyle = mention.sentiment === 'bullish' ? '#22c55e' :
                           mention.sentiment === 'announcement' ? '#8b5cf6' :
                           C.mentionNeutralRing
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(x, y - 40, 18, 0, Math.PI * 2)
          ctx.stroke()
        }
      })
    }

    // === SPECTRE AI WATERMARK ===
    // Note: Watermark disabled by default. Enable showWatermark for chart sharing feature.
    const showWatermark = false // Set to true when user shares chart
    if (showWatermark && (chartType === 'candles' || chartType === 'line')) {
      ctx.save()
      
      // Center position
      const wmX = (chartLeft + chartRight) / 2
      const wmY = (chartTop + chartBottom) / 2
      
      // Premium Apple system font watermark (subtle)
      ctx.globalAlpha = 0.035
      ctx.font = '500 60px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = C.watermark

      // Simple centered text
      ctx.fillText('Spectre AI', wmX, wmY)
      
      ctx.restore()
    }

    // === HEATMAP ZONE LABELS (drawn on top of everything) ===
    if (heatmapEnabled && window._heatmapMergedZones) {
      const { zones: mergedZones, totalCandles, heatmapLeft: hmLeft, heatmapRight: hmRight } = window._heatmapMergedZones
      
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      
      mergedZones.forEach((zone) => {
        const zoneWidth = zone.endX - zone.startX
        const centerX = zone.startX + zoneWidth / 2
        
        // Skip zones that are completely outside the visible area
        if (zone.endX < hmLeft || zone.startX > hmRight) return
        
        // Skip if center is outside visible area (label would be cut off)
        if (centerX < hmLeft + 30 || centerX > hmRight - 30) return
        
        const longevityPercent = ((zone.candleCount / totalCandles) * 100).toFixed(0)
        const priceChange = zone.startPrice > 0 
          ? ((zone.endPrice - zone.startPrice) / zone.startPrice * 100).toFixed(1) 
          : '0.0'
        const sign = parseFloat(priceChange) >= 0 ? '+' : ''
        
        // Zone colors. Day mode uses deeper hues so the accent line + change-%
        // read with contrast on the white pill (the light neon washed out).
        let zoneColor, textColor
        if (zone.zoneType === 'bullish') {
          zoneColor = dm ? '#059669' : 'rgba(52, 211, 153, 0.95)'
          textColor = dm ? '#047857' : 'rgba(52, 211, 153, 1)'
        } else if (zone.zoneType === 'bearish') {
          zoneColor = dm ? '#DC2626' : 'rgba(251, 113, 133, 0.95)'
          textColor = dm ? '#B91C1C' : 'rgba(251, 113, 133, 1)'
        } else {
          zoneColor = dm ? '#7C3AED' : 'rgba(167, 139, 250, 0.8)'
          textColor = dm ? '#6D28D9' : 'rgba(167, 139, 250, 0.9)'
        }
        
        // Position label in the upper portion of the chart area
        const labelY = 100
        const pillHeight = 44
        const pillWidth = Math.max(60, Math.min(zoneWidth - 16, 90))
        const pillX = centerX - pillWidth / 2
        const pillRadius = 8
        
        // Glassmorphic background
        const bgGradient = ctx.createLinearGradient(pillX, labelY, pillX, labelY + pillHeight)
        bgGradient.addColorStop(0, C.heatmapPillBg1)
        bgGradient.addColorStop(1, C.heatmapPillBg2)
        
        // Day mode: float the pill above the white chart with a soft drop
        // shadow — near-white on white was invisible. Cleared before the border.
        if (dm) { ctx.shadowColor = 'rgba(15,23,42,0.22)'; ctx.shadowBlur = 12; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 3 }
        ctx.fillStyle = bgGradient
        ctx.beginPath()
        ctx.roundRect(pillX, labelY, pillWidth, pillHeight, pillRadius)
        ctx.fill()
        if (dm) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0 }

        // Subtle border
        ctx.strokeStyle = C.heatmapBorder
        ctx.lineWidth = dm ? 1.25 : 1
        ctx.stroke()
        
        // Colored accent line at top
        ctx.strokeStyle = zoneColor
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(pillX + pillRadius, labelY + 1)
        ctx.lineTo(pillX + pillWidth - pillRadius, labelY + 1)
        ctx.stroke()
        
        // Longevity percentage (main number)
        ctx.font = '700 16px "SF Pro Display", -apple-system, sans-serif'
        ctx.fillStyle = C.heatmapPct
        ctx.fillText(`${longevityPercent}%`, centerX, labelY + 16)
        
        // Price change (below)
        ctx.font = '600 11px "SF Pro Text", -apple-system, sans-serif'
        ctx.fillStyle = textColor
        ctx.fillText(`${sign}${priceChange}%`, centerX, labelY + 34)
        
        // If zone spans multiple segments, show a subtle range indicator below the pill
        if (zone.segmentCount > 1) {
          const rangeY = labelY + pillHeight + 6
          // Clamp line drawing to visible area
          const lineStartX = Math.max(zone.startX + 8, hmLeft)
          const lineEndX = Math.min(zone.endX - 8, hmRight)
          
          if (lineEndX > lineStartX) {
          ctx.strokeStyle = zoneColor
          ctx.lineWidth = 1.5
          ctx.setLineDash([3, 3])
          ctx.beginPath()
            ctx.moveTo(lineStartX, rangeY)
            ctx.lineTo(lineEndX, rangeY)
          ctx.stroke()
          ctx.setLineDash([])
          
            // Small dots at ends (only if within visible area)
          ctx.fillStyle = zoneColor
            if (zone.startX + 8 >= hmLeft && zone.startX + 8 <= hmRight) {
          ctx.beginPath()
          ctx.arc(zone.startX + 8, rangeY, 2, 0, Math.PI * 2)
          ctx.fill()
            }
            if (zone.endX - 8 >= hmLeft && zone.endX - 8 <= hmRight) {
          ctx.beginPath()
          ctx.arc(zone.endX - 8, rangeY, 2, 0, Math.PI * 2)
          ctx.fill()
            }
          }
        }
      })
    }

    // === Annotation pins (rendered last so they overlay everything) ===
    if (Array.isArray(annotations) && annotations.length > 0 && visibleData.length > 0) {
      const firstTs = visibleData[0]?.date instanceof Date
        ? visibleData[0].date.getTime()
        : (typeof visibleData[0]?.date === 'number' ? visibleData[0].date : null)
      const lastTs = visibleData[visibleData.length - 1]?.date instanceof Date
        ? visibleData[visibleData.length - 1].date.getTime()
        : (typeof visibleData[visibleData.length - 1]?.date === 'number' ? visibleData[visibleData.length - 1].date : null)

      const pinPositionsLocal = []
      for (const a of annotations) {
        if (!Number.isFinite(a?.ts) || !Number.isFinite(a?.price)) continue
        if (firstTs == null || lastTs == null) continue
        if (a.ts < firstTs - 60_000 || a.ts > lastTs + 60_000) continue

        // Find nearest candle index by ts
        let nearestIdx = 0
        let bestDiff = Infinity
        for (let i = 0; i < visibleData.length; i++) {
          const d = visibleData[i]?.date
          const t = d instanceof Date ? d.getTime() : (typeof d === 'number' ? d : null)
          if (t == null) continue
          const diff = Math.abs(t - a.ts)
          if (diff < bestDiff) { bestDiff = diff; nearestIdx = i }
        }
        const px = chartLeft + (leftEmptyCandles + nearestIdx) * candleWidth + candleWidth / 2 - (rightEmptyCandles * candleWidth) + panFracPx
        const py = scaleY(a.price)
        if (px < chartLeft - 16 || px > chartRight + 16) continue
        if (py < chartTop - 16 || py > chartBottom + 16) continue

        const color = a.color || '#10B981'

        // Vertical drop line from pin to candle (icon itself is rendered as DOM
        // overlay so it can use SVG + CSS animations).
        ctx.save()
        ctx.beginPath()
        ctx.strokeStyle = color
        ctx.globalAlpha = 0.35
        ctx.setLineDash([2, 4])
        ctx.lineWidth = 1
        ctx.moveTo(px, py)
        ctx.lineTo(px, chartBottom)
        ctx.stroke()
        ctx.restore()

        pinPositionsLocal.push({ id: a.id, x: px, y: py, color, icon: a.icon || 'pin' })
      }
      annotationPinsRef.current = pinPositionsLocal
    } else {
      annotationPinsRef.current = []
    }

    // Sync DOM pins state — only when positions or membership change to avoid
    // a setState→redraw loop.
    {
      const next = annotationPinsRef.current
      const prev = domPinsRef.current
      let changed = next.length !== prev.length
      if (!changed) {
        for (let i = 0; i < next.length; i++) {
          const a = next[i], b = prev[i]
          if (!b || a.id !== b.id || a.icon !== b.icon || a.color !== b.color || Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5) {
            changed = true
            break
          }
        }
      }
      if (changed) {
        const seen = seenPinIdsRef.current
        const annotated = next.map(p => {
          const isNew = !seen.has(p.id)
          if (isNew) seen.add(p.id)
          return { ...p, isNew }
        })
        domPinsRef.current = annotated
        setDomPins(annotated)
      }
    }

    // === TA layer: highlight marquee + drawings ===
    // Painted inside the chart's own draw pass so it stays glued to the candles
    // through pan/zoom RAF redraws (a separate DOM overlay would lag, because
    // the pan path bypasses React entirely).
    if (taMode !== 'off' || taSelection || (taDrawings && taDrawings.length)) {
      const taDims = {
        chartLeft, chartRight, chartTop, chartHeight,
        candleWidth, visibleData,
        leftEmptyCandles, rightEmptyCandles, panFracPx,
        minPrice, priceRange, useLogScale, logMin, logRange, scaleY,
      }
      const live = taDragRef.current?.kind === 'select' ? taDragRef.current.region : null
      const rect = drawTaOverlay(ctx, taDims, {
        selection: taSelection,
        pending: live,
        drawings: taDrawings || [],
        pendingDraw: taDragRef.current?.kind === 'draw' ? taDragRef.current.preview : null,
        dayMode,
        reveal: taRevealRef.current,
        gleam: taGleamRef.current,
      })
      // The action bar follows the committed selection only — during a live
      // drag it would fight the finger, and during a pan a setState per frame
      // would re-render this component 60×/s (the pan path deliberately
      // bypasses React). It re-syncs on the first redraw after the pan ends.
      if (!live && !isPanningRef.current) {
        const prev = taSelRectRef.current
        const changed = (!rect !== !prev) || (rect && prev && (
          Math.abs(rect.x - prev.x) > 0.5 || Math.abs(rect.y - prev.y) > 0.5 ||
          Math.abs(rect.w - prev.w) > 0.5 || Math.abs(rect.h - prev.h) > 0.5
        ))
        if (changed) { taSelRectRef.current = rect; setTaSelRect(rect) }
      }
    } else if (taSelRectRef.current) {
      taSelRectRef.current = null
      setTaSelRect(null)
    }

    // Store dimensions for hover detection
    chartDimensionsRef.current = {
      chartLeft,
      chartRight,
      chartTop,
      chartBottom,
      chartHeight,
      volumeTop,
      volumeHeight,
      candleWidth,
      // Published so the interaction handlers clamp against the width this
      // paint actually used (their own clientWidth math drifts by a few px).
      chartWidth,
      visibleCandleCount,
      bodyWidth,
      scaleY,
      minPrice,
      startIndex,
      visibleData,
      maxPrice,
      priceRange,
      rightEmptyCandles,
      leftEmptyCandles,
      panFracPx,
      useLogScale,
      logMin,
      logMax,
      logRange,
    }

    } // end drawCanvas
    drawChartRef.current = drawCanvas
    drawCanvas()
    // Sync the CSS-animated pulse overlay to the live point coords
    const pulseEl = livePulseRef.current
    const lp = livePointRef.current
    if (pulseEl) {
      if (lp && chartType === 'line') {
        pulseEl.style.left = `${lp.x}px`
        pulseEl.style.top = `${lp.y}px`
        pulseEl.style.setProperty('--pulse-color', lp.color)
        pulseEl.style.display = 'block'
      } else {
        pulseEl.style.display = 'none'
      }
    }
  }, [displayCandleData, candleData, timeframe, chartType, heatmapEnabled, isFullscreen, redrawTrigger, chartViewMode, xMentions, zoomLevel, priceZoom, priceAxisWidth, timeAxisHeight, yAxisMode, priceScale, stats, showATHLines, showVWAP, trueATH, lineColorTheme, annotations, hasMoreHistory, loadingMore, embedHeight, srZoneData, activeIndicators.srzones, taMode, taSelection, taDrawings, dayMode, responsiveControls])

  // Mouse move handler for volume bar hover and crosshair
  const handleMouseMove = (e) => {
    // No crosshair / hover tooltip on touch - it is a desktop hover affordance,
    // and on a finger-drag the two lines just trail the candles. Mobile gets no
    // crosshair at all (per user); desktop mouse keeps the snapped crosshair.
    if (e && e.pointerType === 'touch') return
    // Skip crosshair/tooltip updates during a (mouse) pan to avoid extra re-renders.
    if (isPanningRef.current) return

    const canvas = canvasRef.current
    if (!canvas || !chartDimensionsRef.current) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const { chartLeft, chartRight, chartTop, chartHeight, volumeTop, volumeHeight, candleWidth, bodyWidth, scaleY, priceRange, minPrice, maxPrice, visibleData: visData, rightEmptyCandles: emptyCandles = 0, leftEmptyCandles: leftEmpty = 0, panFracPx: dimFracPx = 0, useLogScale: dimLog = false, logMin: dimLogMin = 0, logMax: dimLogMax = 0, logRange: dimLogRange = 1 } = chartDimensionsRef.current
    const dataToUse = visData || candleData
    const maxVolume = Math.max(...dataToUse.map(d => d.volume))

    // Update crosshair if in chart area - TradingView-style snap to candle
    if (x >= chartLeft && x <= chartRight && y >= chartTop && y <= volumeTop + volumeHeight) {
      // Calculate price at Y position
      const priceAtY = dimLog
        ? Math.exp(dimLogMax - ((y - chartTop) / chartHeight) * dimLogRange)
        : maxPrice - ((y - chartTop) / chartHeight) * priceRange
      
      // Calculate candle index at X position (within visible data).
      // Inverse of the candle render formula:
      //   candleX = chartLeft + (leftEmpty + i) * cw + cw/2 - rightEmpty * cw
      // → i = floor((x - chartLeft + rightEmpty*cw - leftEmpty*cw) / cw)
      const adjustedX = x - dimFracPx + (emptyCandles * candleWidth) - (leftEmpty * candleWidth)
      const candleIndex = Math.floor((adjustedX - chartLeft) / candleWidth)

      // Get candle data if valid index
      const candle = candleIndex >= 0 && candleIndex < dataToUse.length
        ? dataToUse[candleIndex]
        : null

      // Snap to candle center using the EXACT same formula as the candle renderer.
      // (Previously missing the `leftEmpty * cw` term, which caused the crosshair
      // to drift right of the cursor when leftEmpty > 0, e.g. zoomed-out 1D view.)
      const snappedX = candle
        ? chartLeft + (leftEmpty + candleIndex) * candleWidth + candleWidth / 2 - (emptyCandles * candleWidth) + dimFracPx
        : x
      
      setCrosshair({
        visible: true,
        x: snappedX, // Snap to candle center
        y,
        price: priceAtY,
        time: candle?.date || null,
        candle, // Include full candle data for OHLCV display
        candleX: snappedX
      })
    } else {
      setCrosshair({ visible: false, x: 0, y: 0, price: null, time: null, candle: null, candleX: 0 })
    }

    // Check if mouse is in volume area
    if (y >= volumeTop && y <= volumeTop + volumeHeight && x >= chartLeft && x <= chartRight) {
      // Find which bar we're over (within visible data)
      // Account for both left and right empty candle offsets
      const adjustedX = x - dimFracPx + (emptyCandles * candleWidth) - (leftEmpty * candleWidth)
      const barIndex = Math.floor((adjustedX - chartLeft) / candleWidth)
      
      if (barIndex >= 0 && barIndex < dataToUse.length) {
        const candle = dataToUse[barIndex]
        const barX = chartLeft + (leftEmpty + barIndex) * candleWidth + candleWidth / 2 - (emptyCandles * candleWidth) + dimFracPx
        const barHeight = (candle.volume / maxVolume) * volumeHeight
        const barTop = volumeTop + volumeHeight - barHeight
        const volBarWidth = Math.max(3, bodyWidth * 0.85)

        // Check if actually over the bar
        if (x >= barX - volBarWidth && x <= barX + volBarWidth && y >= barTop) {
          setTooltip({
            visible: true,
            x: barX,
            y: barTop - 10,
            data: {
              date: candle.date,
              volume: candle.volume
            }
          })
          return
        }
      }
    }
    
    setTooltip({ visible: false, x: 0, y: 0, data: null })
  }

  const handleMouseLeave = () => {
    setTooltip({ visible: false, x: 0, y: 0, data: null })
    setCrosshair({ visible: false, x: 0, y: 0, price: null, time: null, candle: null, candleX: 0 })
  }

  // Click handler for annotations (delegated to canvas pin OR note-mode add)
  const handleCanvasClick = (e) => {
    if (chartType === 'tradingview') return
    const canvas = canvasRef.current
    const dims = chartDimensionsRef.current
    if (!canvas || !dims) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Existing pin click? (use cached pin positions)
    const pins = annotationPinsRef.current || []
    for (const pin of pins) {
      const dx = pin.x - x
      const dy = pin.y - y
      if (dx * dx + dy * dy <= 81) { // 9px hit radius
        if (typeof onAnnotationClick === 'function') {
          onAnnotationClick({ id: pin.id, screenX: e.clientX, screenY: e.clientY })
          e.stopPropagation()
        }
        return
      }
    }

    if (!noteModeActive || typeof onCanvasAnnotateClick !== 'function') return
    const { chartLeft, chartRight, chartTop, chartHeight, candleWidth, priceRange, minPrice, visibleData: vData, rightEmptyCandles: rEmpty = 0, leftEmptyCandles: lEmpty = 0, useLogScale: dimLog2 = false, logMin: dimLogMin2 = 0, logRange: dimLogRange2 = 1 } = dims
    if (x < chartLeft || x > chartRight || y < chartTop || y > chartTop + chartHeight) return

    const adjX = x + (rEmpty * candleWidth) - (lEmpty * candleWidth)
    const idx = Math.floor((adjX - chartLeft) / candleWidth)
    const candle = idx >= 0 && idx < vData.length ? vData[idx] : null
    if (!candle) return
    const ts = candle.date instanceof Date ? candle.date.getTime() : (typeof candle.date === 'number' ? candle.date : Date.now())
    const price = dimLog2
      ? Math.exp(dimLogMin2 + (1 - (y - chartTop) / chartHeight) * dimLogRange2)
      : minPrice + (1 - (y - chartTop) / chartHeight) * priceRange
    if (!Number.isFinite(price)) return
    onCanvasAnnotateClick({ ts, price, screenX: e.clientX, screenY: e.clientY })
    e.stopPropagation()
  }

  // Wheel handler for zoom - TradingView-style zoom centered on mouse position.
  // Smooth path: mutate refs immediately, redraw via RAF, debounce React state sync.
  // This avoids a full re-render per wheel tick (trackpads fire 60+ events/sec).
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const chartRight = rect.width - priceAxisWidth
    const chartLeft = 12

    // Continuous zoom factor: trackpad pinches send tiny deltaY values,
    // mice send ~100. Scale to a perceptual ~6%/tick floor and 18%/tick ceiling.
    // Derivation: factor = 1 + clamped(deltaY / 500). Clamp keeps mouse wheels
    // from yanking the chart and lets trackpads glide smoothly.
    const rawStep = -e.deltaY / 500
    const clampedStep = Math.max(-0.18, Math.min(0.18, rawStep))

    if (x > chartRight) {
      // Price axis: vertical zoom
      setAutoFitPrice(false)
      const next = Math.max(0.1, Math.min(10, priceZoomRef.current + clampedStep))
      priceZoomRef.current = next
    } else {
      // Chart area: horizontal zoom centered on mouse
      const zoomFactor = 1 + clampedStep
      const cur = zoomLevelRef.current

      const minVisibleCandles = 20
      const maxZoom = candleData.length / minVisibleCandles
      // zoom=1 is the documented full-view baseline. Never clamp above 1 or the
      // first wheel tick snaps from 1 -> minZoom on large histories.
      const minAllowedZoom = MIN_CHART_ZOOM
      const newZoom = Math.max(minAllowedZoom, Math.min(maxZoom, cur * zoomFactor))

      const chartWidth = chartRight - chartLeft
      const mouseRatio = Math.max(0, Math.min(1, (x - chartLeft) / chartWidth))

      const visibleBefore = computeChartGeometry(candleData.length, cur, chartWidth, timeframe).visibleCount
      const visibleAfter = computeChartGeometry(candleData.length, newZoom, chartWidth, timeframe).visibleCount
      // Anchor zoom on the data index under the cursor.
      // Visible window: startIdx = length - panOffset - visibleCount, so the data
      // index under cursor is length - panOffset - (1 - mouseRatio) * visibleCount.
      // Holding that fixed gives: newOffset = oldOffset + (1 - mouseRatio) * (visibleBefore - visibleAfter)
      const rightRatio = 1 - mouseRatio
      const candleShift = (visibleBefore - visibleAfter) * rightRatio

      const maxOffset = Math.max(0, candleData.length - visibleAfter)
      const minOffset = -Math.floor(visibleAfter * OVERSCROLL_RIGHT)
      const nextOffset = Math.max(minOffset, Math.min(maxOffset, panOffsetRef.current + candleShift))

      zoomLevelRef.current = newZoom
      panOffsetRef.current = nextOffset
    }

    // RAF-batch the redraw so multiple wheel ticks per frame collapse to one paint
    if (!rafZoomRef.current) {
      rafZoomRef.current = requestAnimationFrame(() => {
        rafZoomRef.current = null
        if (drawChartRef.current) drawChartRef.current()
      })
    }

    // Sync to React state on the trailing edge so other deps (effects, indicators)
    // pick up the final value once the user stops scrolling
    if (zoomSyncTimerRef.current) clearTimeout(zoomSyncTimerRef.current)
    zoomSyncTimerRef.current = setTimeout(() => {
      zoomSyncTimerRef.current = null
      setZoomLevel(zoomLevelRef.current)
      setPriceZoom(priceZoomRef.current)
      setPanOffset(panOffsetRef.current)
    }, 120)
  }, [priceAxisWidth, candleData.length, timeframe])

  // Attach wheel event with passive: false to prevent page scroll
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      container.removeEventListener('wheel', handleWheel)
      if (rafZoomRef.current) {
        cancelAnimationFrame(rafZoomRef.current)
        rafZoomRef.current = null
      }
      if (zoomSyncTimerRef.current) {
        clearTimeout(zoomSyncTimerRef.current)
        zoomSyncTimerRef.current = null
      }
    }
  }, [handleWheel])

  // Chart panning handlers - TradingView-style with momentum/inertia (horizontal + vertical)
  // ── TA layer pointer handling ───────────────────────────────────────────
  // While a TA tool is armed the chart does NOT pan: a drag means "select this
  // region" or "draw this line". Panning resumes the moment the tool is off.
  const taPointFromEvent = useCallback((e) => {
    const canvas = canvasRef.current
    const dims = chartDimensionsRef.current
    if (!canvas || !dims) return null
    const map = makeChartMapping(dims)
    if (!map) return null
    const rect = canvas.getBoundingClientRect()
    const x = Math.max(map.chartLeft, Math.min(map.chartRight, e.clientX - rect.left))
    const y = Math.max(map.chartTop, Math.min(map.chartBottom, e.clientY - rect.top))
    const ts = map.xToTs(x)
    const price = map.yToPrice(y)
    if (!Number.isFinite(ts) || !Number.isFinite(price)) return null
    return { x, y, ts, price }
  }, [])

  const taRegionLabel = useCallback((a, b) => {
    const dur = formatDuration(Math.abs(b.ts - a.ts))
    // Change is measured left→right in time, not drag direction — a right-to-
    // left drag must not report the move backwards.
    const [from, to] = a.ts <= b.ts ? [a, b] : [b, a]
    const dims = chartDimensionsRef.current
    const vd = dims?.visibleData || []
    let open = null, close = null
    for (const bar of vd) {
      const bt = bar?.date instanceof Date ? bar.date.getTime() : (typeof bar?.date === 'number' ? bar.date : null)
      if (bt == null) continue
      if (bt >= from.ts && open == null) open = bar.open
      if (bt <= to.ts) close = bar.close
    }
    if (!Number.isFinite(open) || !Number.isFinite(close) || open === 0) return dur
    const chg = ((close - open) / open) * 100
    return `${dur} · ${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%`
  }, [])

  const handleTaPointerDown = useCallback((e) => {
    const p = taPointFromEvent(e)
    if (!p) return false
    if (taMode === 'select') {
      taDragRef.current = { kind: 'select', a: p, region: null }
    } else if (taMode.startsWith('draw:')) {
      taDragRef.current = { kind: 'draw', tool: taMode.slice(5), a: p, preview: null }
    } else {
      return false
    }
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch (_) {}
    return true
  }, [taMode, taPointFromEvent])

  const handleTaPointerMove = useCallback((e) => {
    const drag = taDragRef.current
    if (!drag) return false
    const p = taPointFromEvent(e)
    if (!p) return true
    if (drag.kind === 'select') {
      drag.region = {
        fromTs: Math.min(drag.a.ts, p.ts),
        toTs: Math.max(drag.a.ts, p.ts),
        hiPrice: Math.max(drag.a.price, p.price),
        loPrice: Math.min(drag.a.price, p.price),
        label: taRegionLabel(drag.a, p),
      }
    } else {
      const tool = drag.tool
      drag.preview = tool === 'hline'
        ? { id: 'ta-preview', source: 'user', tool: 'hline', style: 'user', price: p.price }
        : { id: 'ta-preview', source: 'user', tool, style: 'user', a: { ts: drag.a.ts, price: drag.a.price }, b: { ts: p.ts, price: p.price } }
    }
    if (drawChartRef.current) drawChartRef.current()
    return true
  }, [taPointFromEvent, taRegionLabel])

  const handleTaPointerUp = useCallback((e) => {
    const drag = taDragRef.current
    if (!drag) return false
    taDragRef.current = null
    try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch (_) {}
    const p = taPointFromEvent(e)

    if (drag.kind === 'select') {
      const region = drag.region
      // A stray click is not a selection — it would hand the agent a one-bar
      // window and read as a broken tool.
      const wideEnough = region && Math.abs(p ? p.x - drag.a.x : 0) > 8
      if (region && wideEnough) {
        onTaSelectionChange?.(region)
      } else if (drawChartRef.current) {
        drawChartRef.current()
      }
      return true
    }

    // draw
    const tool = drag.tool
    if (p) {
      const moved = Math.abs(p.x - drag.a.x) > 4 || Math.abs(p.y - drag.a.y) > 4
      if (tool === 'hline') {
        onTaDrawingAdd?.({ id: `u-${Date.now().toString(36)}`, source: 'user', tool: 'hline', style: 'user', price: p.price })
      } else if (moved) {
        onTaDrawingAdd?.({
          id: `u-${Date.now().toString(36)}`, source: 'user', tool, style: 'user',
          a: { ts: drag.a.ts, price: drag.a.price },
          b: { ts: p.ts, price: p.price },
        })
      }
    }
    if (drawChartRef.current) drawChartRef.current()
    return true
  }, [taPointFromEvent, onTaSelectionChange, onTaDrawingAdd])

  // The chart's fullscreen layer covers the whole app, so any surface that
  // hosts an agent elsewhere (the RZ sidebar) needs to know when to bring it
  // inside. Ref'd callback: this must not re-fire on every parent render.
  const onFullscreenChangeRef = useRef(onFullscreenChange)
  onFullscreenChangeRef.current = onFullscreenChange
  useEffect(() => { onFullscreenChangeRef.current?.(isFullscreen) }, [isFullscreen])

  // One light sweep across the read window when it lands. Deliberately a
  // SINGLE pass driven by its own terminating rAF: a perpetual shimmer would
  // repaint the entire candle pass every frame, which is the documented
  // GPU-heat trap (ParticleBackground / AuroraField).
  const runGleam = useCallback(() => {
    if (taGleamRafRef.current) cancelAnimationFrame(taGleamRafRef.current)
    const start = performance.now()
    const DUR = 1150
    const step = () => {
      const p = Math.min(1, (performance.now() - start) / DUR)
      taGleamRef.current = p
      if (drawChartRef.current) drawChartRef.current()
      if (p < 1) taGleamRafRef.current = requestAnimationFrame(step)
      else { taGleamRafRef.current = null; taGleamRef.current = 1 }
    }
    taGleamRef.current = 0
    taGleamRafRef.current = requestAnimationFrame(step)
  }, [])

  useEffect(() => {
    if (!taSelection) return
    runGleam()
    return () => {
      if (taGleamRafRef.current) cancelAnimationFrame(taGleamRafRef.current)
      taGleamRafRef.current = null
      taGleamRef.current = 1
    }
  }, [taSelection, runGleam])

  // AI / pattern lines sweep in one after another rather than snapping into
  // existence — the point of the feature is watching the read get drawn.
  useEffect(() => {
    if (!taRevealKey) { taRevealRef.current = 1; return }
    if (taRevealRafRef.current) cancelAnimationFrame(taRevealRafRef.current)
    const start = performance.now()
    const DUR = 1600
    const step = () => {
      const p = Math.min(1, (performance.now() - start) / DUR)
      taRevealRef.current = p
      if (drawChartRef.current) drawChartRef.current()
      if (p < 1) taRevealRafRef.current = requestAnimationFrame(step)
      else taRevealRafRef.current = null
    }
    taRevealRef.current = 0
    taRevealRafRef.current = requestAnimationFrame(step)
    return () => {
      if (taRevealRafRef.current) cancelAnimationFrame(taRevealRafRef.current)
      taRevealRafRef.current = null
      taRevealRef.current = 1
    }
  }, [taRevealKey])

  const handlePanStart = useCallback((e) => {
    // Mouse: ignore non-primary buttons. Touch/pen: button is 0 anyway.
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // A TA tool owns the drag while it is armed — but only the FIRST pointer.
    // A second finger must still reach the pinch-zoom path below, or two-finger
    // zoom silently becomes a giant selection box on a phone.
    if (taMode !== 'off' && activePointersRef.current.size === 0 && !e.target?.closest?.('button, .axis-drag-handle, [data-no-pan]')) {
      if (handleTaPointerDown(e)) return
    }
    // A second finger cancels an in-flight TA drag and hands over to pinch.
    if (taDragRef.current && activePointersRef.current.size >= 1) {
      taDragRef.current = null
      if (drawChartRef.current) drawChartRef.current()
    }
    // Skip pan if the gesture started on an interactive child (scroll-to-now,
    // note pins, axis handles). Without this, setPointerCapture on .chart-body
    // would eat the child's click event.
    if (e.target.closest && e.target.closest('button, .axis-drag-handle, [data-no-pan]')) return
    if (e.target.classList && e.target.classList.contains('axis-drag-handle')) return

    // Track this pointer for multi-touch (pinch detection)
    if (e.pointerId != null) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }

    // 2nd pointer arrived → switch from pan to pinch-zoom
    if (activePointersRef.current.size >= 2) {
      // Cancel any in-flight pan
      if (rafPanRef.current) { cancelAnimationFrame(rafPanRef.current); rafPanRef.current = null }
      if (momentumAnimationRef.current) { cancelAnimationFrame(momentumAnimationRef.current); momentumAnimationRef.current = null }
      isPanningRef.current = false
      if (containerRef.current) containerRef.current.style.cursor = 'crosshair'
      const pts = [...activePointersRef.current.values()]
      const dx = pts[0].x - pts[1].x
      const dy = pts[0].y - pts[1].y
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
      // Anchor zoom around the midpoint between the two fingers (chart-relative)
      const canvas = canvasRef.current
      const rect = canvas?.getBoundingClientRect()
      const midX = (pts[0].x + pts[1].x) / 2
      const chartLeft = 12
      const chartRight = (rect?.width || 800) - priceAxisWidth
      const relX = rect ? midX - rect.left : midX
      const anchorRatio = Math.max(0, Math.min(1, (relX - chartLeft) / Math.max(1, chartRight - chartLeft)))
      pinchRef.current = {
        active: true,
        startDist: dist,
        startZoom: zoomLevelRef.current,
        anchorRatio,
        startPanOffset: panOffsetRef.current,
      }
      return
    }

    // Capture this single pointer so we keep receiving move/up even if it leaves the element
    try { e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId) } catch (_) {}

    // Cancel any existing momentum animation
    if (momentumAnimationRef.current) {
      cancelAnimationFrame(momentumAnimationRef.current)
      momentumAnimationRef.current = null
    }

    isPanningRef.current = true
    panModeRef.current = null
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
    panStartRef.current = { x: e.clientX, y: e.clientY, offset: panOffsetRef.current, priceOff: priceOffsetRef.current }
    lastPanXRef.current = e.clientX
    lastPanYRef.current = e.clientY
    lastPanTimeRef.current = performance.now()
    panVelocityRef.current = { x: 0, y: 0 }
    // Hide the crosshair + volume tooltip for the duration of the drag.
    // handleMouseMove skips their updates while panning (perf: no React
    // re-render per move), so without this the two overlay lines FREEZE at
    // the drag-start point and trail the gesture. One state write per drag
    // start; the next mousemove after release re-shows them at the cursor.
    // (Gleb 2026-07-03)
    setCrosshair(c => (c.visible ? { visible: false, x: 0, y: 0, price: null, time: null, candle: null, candleX: 0 } : c))
    setTooltip(t => (t.visible ? { visible: false, x: 0, y: 0, data: null } : t))
  }, [priceAxisWidth, taMode, handleTaPointerDown])

  const handlePanMove = useCallback((e) => {
    if (!isPanningRef.current) return
    
    const currentX = e.clientX
    const currentY = e.clientY
    const currentTime = performance.now()
    const deltaX = currentX - panStartRef.current.x
    const deltaY = currentY - panStartRef.current.y
    const previousPanMode = panModeRef.current
    panModeRef.current = resolveChartPanMode(previousPanMode, deltaX, deltaY)
    const panPrice = panModeRef.current === 'free'
    if (panPrice && !previousPanMode) setAutoFitPrice(false)
    const instantDeltaX = currentX - lastPanXRef.current
    const instantDeltaY = currentY - lastPanYRef.current
    const deltaTime = currentTime - lastPanTimeRef.current
    
    // Calculate velocity for momentum (pixels per ms) - both X and Y.
    // Weight the CURRENT sample heavily (70/30) so the release velocity matches
    // the hand at the moment of letting go - a 50/50 average lagged fast flicks.
    if (deltaTime > 0) {
      const instantVelocityX = instantDeltaX / deltaTime
      const instantVelocityY = instantDeltaY / deltaTime
      panVelocityRef.current = {
        x: panVelocityRef.current.x * 0.3 + instantVelocityX * 0.7,
        y: panPrice ? panVelocityRef.current.y * 0.3 + instantVelocityY * 0.7 : 0
      }
    }
    
    lastPanXRef.current = currentX
    lastPanYRef.current = currentY
    lastPanTimeRef.current = currentTime
    
    // HORIZONTAL PAN - Same as vertical: drag direction = chart moves direction
    // Drag LEFT = chart moves LEFT = see older data (what's on the left)
    // Drag RIGHT = chart moves RIGHT = see newer data (what's on the right)
    // SAME geometry the renderer used for the current paint - not a re-derived
    // copy. A drag clamped against a different visible count than the canvas
    // draws is a dead drag: the finger moves panOffset somewhere the render
    // clamp immediately throws away.
    const { candleWidth: candleW, visibleCount } = readPanGeometry(zoomLevel)
    const pixelsPerCandle = candleW
    
    // Match vertical behavior: drag direction = view direction
    const deltaCandlesFloat = deltaX / pixelsPerCandle
    
    const newOffset = panStartRef.current.offset + deltaCandlesFloat

    // Clamp with boundaries. Allow extending past the oldest loaded candle
    // when more history can stream in — empty space appears on the left and
    // fills in progressively (TradingView-style infinite scroll).
    const { baseMaxOffset: baseMaxOffsetPan, maxOffset, minOffset } =
      computeOffsetBounds(candleData.length, visibleCount, hasMoreHistory || loadingMore)

    // Preemptively fetch more history once the user nears the data wall
    // (rather than waiting until they hit it) so panning stays continuous.
    // 0.6 screens ahead (was 0.25): a fast drag covers a quarter-screen in
    // well under a fetch round-trip, so the old trigger fired too late and
    // the user sat at the wall. 400ms cooldown matches the at-edge trigger -
    // the `loadingMore` guard serializes actual requests.
    const fetchTriggerOffset = baseMaxOffsetPan - Math.floor(visibleCount * 0.6)
    if (newOffset > fetchTriggerOffset && hasMoreHistory && !loadingMore) {
      const now = Date.now()
      const timeSinceLastFetch = now - lastFetchTimeRef.current
      if (timeSinceLastFetch >= 400) {
        lastFetchTimeRef.current = now
        fetchMoreHistory()
      }
    }

    // Hard clamp (no elastic - more stable)
    const clampedOffset = Math.max(minOffset, Math.min(maxOffset, newOffset))

    // VERTICAL PAN - Unlimited panning (can go beyond chart data)
    // Drag up = see higher prices (chart moves up)
    // Drag down = see lower prices (chart moves down)
    // 1:1 tracking: the renderer consumes priceOffset as a % of the visible
    // range spread over chartHeight px, so percent = deltaY / chartHeight * 100
    // keeps the price under the cursor glued to it. (The old fixed /8 divisor
    // was only ~right for 800px-tall charts and felt floaty elsewhere.)
    const chartPxHeight = Math.max(1, chartDimensionsRef.current?.chartHeight || 400)
    const deltaPricePercent = panPrice ? (deltaY / chartPxHeight) * 100 : 0

    const newPriceOffset = panStartRef.current.priceOff + deltaPricePercent

    // Update refs immediately, redraw canvas directly via RAF (bypasses React entirely)
    panOffsetRef.current = clampedOffset
    priceOffsetRef.current = newPriceOffset
    if (!rafPanRef.current) {
      rafPanRef.current = requestAnimationFrame(() => {
        rafPanRef.current = null
        if (drawChartRef.current) drawChartRef.current()
      })
    }
  }, [candleData.length, zoomLevel, hasMoreHistory, loadingMore, fetchMoreHistory, readPanGeometry])

  const handlePanEnd = useCallback(() => {
    // Flush any pending RAF and sync final offset to state
    if (rafPanRef.current) {
      cancelAnimationFrame(rafPanRef.current)
      rafPanRef.current = null
    }
    setPanOffset(panOffsetRef.current)
    setPriceOffset(priceOffsetRef.current)
    isPanningRef.current = false
    if (containerRef.current) containerRef.current.style.cursor = 'crosshair'
    
    // Apply momentum animation for both X and Y. Low trigger threshold so most
    // releases get a short glide (TradingView-feel) instead of a dead stop.
    const velocityX = panVelocityRef.current.x
    const velocityY = panModeRef.current === 'free' ? panVelocityRef.current.y : 0
    const hasMomentum = Math.abs(velocityX) > 0.06 || Math.abs(velocityY) > 0.06
    
    if (hasMomentum) {
      // Same shared geometry as the render + the drag (see readPanGeometry)
      const { candleWidth: candleW, visibleCount } = readPanGeometry(zoomLevel)

      const { maxOffset, minOffset } =
        computeOffsetBounds(candleData.length, visibleCount, hasMoreHistory || loadingMore)

      const pixelsPerCandle = candleW
      
      let currentVelocityX = velocityX * 0.85 // Carry most of the release speed
      let currentVelocityY = velocityY * 0.85 // Y momentum for vertical pan
      const friction = 0.945 // Premium glide (higher = longer coast)
      const chartPxHeightM = Math.max(1, chartDimensionsRef.current?.chartHeight || 400)

      const animateMomentum = () => {
        // Decelerate both axes
        currentVelocityX *= friction
        currentVelocityY *= friction

        // Stop when both velocities are negligible
        const xDone = Math.abs(currentVelocityX) < 0.012
        const yDone = Math.abs(currentVelocityY) < 0.012
        
        if (xDone && yDone) {
          momentumAnimationRef.current = null
          // Sync final values to state
          setPanOffset(panOffsetRef.current)
          setPriceOffset(priceOffsetRef.current)
          return
        }

        // Apply X velocity to pan offset (matching drag direction)
        if (!xDone) {
          const deltaCandles = (currentVelocityX * 16) / pixelsPerCandle

          let newOffset = panOffsetRef.current + deltaCandles

          // Hard stop at boundaries
          if (newOffset > maxOffset) {
            currentVelocityX = 0
            newOffset = maxOffset
          } else if (newOffset < minOffset) {
            currentVelocityX = 0
            newOffset = minOffset
          }

          panOffsetRef.current = newOffset
        }

        // Apply Y velocity to price offset (unlimited vertical pan) - same
        // pixel-true mapping as the live drag (% of range over chartHeight px).
        if (!yDone) {
          const deltaPricePercent = ((currentVelocityY * 16) / chartPxHeightM) * 100
          priceOffsetRef.current = priceOffsetRef.current + deltaPricePercent
        }

        // Redraw canvas directly without React state updates
        if (drawChartRef.current) drawChartRef.current()
        momentumAnimationRef.current = requestAnimationFrame(animateMomentum)
      }

      momentumAnimationRef.current = requestAnimationFrame(animateMomentum)
    }
  }, [candleData.length, zoomLevel, readPanGeometry, hasMoreHistory, loadingMore])

  // Apply a pinch-zoom delta. Mirrors handleWheel's anchor math but uses the
  // midpoint between the two fingers as the anchor instead of the cursor.
  const applyPinch = useCallback((newDist) => {
    const pinch = pinchRef.current
    if (!pinch.active || !pinch.startDist) return
    const ratio = newDist / pinch.startDist
    const minVisibleCandles = 20
    const maxZoom = Math.max(1, candleData.length / minVisibleCandles)
    const minAllowedZoom = MIN_CHART_ZOOM
    const newZoom = Math.max(minAllowedZoom, Math.min(maxZoom, pinch.startZoom * ratio))

    const canvas = canvasRef.current
    const rect = canvas?.getBoundingClientRect()
    const chartLeft = 12
    const chartRight = (rect?.width || 800) - priceAxisWidth
    const chartWidth = Math.max(1, chartRight - chartLeft)

    const visibleBefore = computeChartGeometry(candleData.length, pinch.startZoom, chartWidth, timeframe).visibleCount
    const visibleAfter = computeChartGeometry(candleData.length, newZoom, chartWidth, timeframe).visibleCount
    const rightRatio = 1 - pinch.anchorRatio
    const candleShift = (visibleBefore - visibleAfter) * rightRatio
    const maxOffset = Math.max(0, candleData.length - visibleAfter)
    const minOffset = -Math.floor(visibleAfter * OVERSCROLL_RIGHT)
    const nextOffset = Math.max(minOffset, Math.min(maxOffset, pinch.startPanOffset + candleShift))

    zoomLevelRef.current = newZoom
    panOffsetRef.current = nextOffset

    if (!rafZoomRef.current) {
      rafZoomRef.current = requestAnimationFrame(() => {
        rafZoomRef.current = null
        if (drawChartRef.current) drawChartRef.current()
      })
    }
    if (zoomSyncTimerRef.current) clearTimeout(zoomSyncTimerRef.current)
    zoomSyncTimerRef.current = setTimeout(() => {
      zoomSyncTimerRef.current = null
      setZoomLevel(zoomLevelRef.current)
      setPanOffset(panOffsetRef.current)
    }, 120)
  }, [candleData.length, priceAxisWidth, timeframe])

  // Unified pointer move: routes between pinch-zoom, pan, and crosshair.
  const handlePointerMove = useCallback((e) => {
    // A live TA drag owns the pointer.
    if (taDragRef.current) { handleTaPointerMove(e); return }
    // Update tracked pointer position for multi-touch
    if (e.pointerId != null && activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }
    // Pinch in progress → recompute zoom from current finger distance
    if (pinchRef.current.active && activePointersRef.current.size >= 2) {
      const pts = [...activePointersRef.current.values()]
      const dx = pts[0].x - pts[1].x
      const dy = pts[0].y - pts[1].y
      applyPinch(Math.max(1, Math.sqrt(dx * dx + dy * dy)))
      return
    }
    // Single-pointer drag → pan
    if (isPanningRef.current) {
      handlePanMove(e)
      return
    }
    // Otherwise → crosshair / volume tooltip
    handleMouseMove(e)
  }, [applyPinch, handlePanMove, handleTaPointerMove])

  // Unified pointer up/cancel: ends pinch or pan as appropriate.
  const handlePointerUp = useCallback((e) => {
    if (taDragRef.current) { handleTaPointerUp(e); return }
    if (e.pointerId != null) activePointersRef.current.delete(e.pointerId)
    try { e.currentTarget.releasePointerCapture && e.currentTarget.releasePointerCapture(e.pointerId) } catch (_) {}
    if (pinchRef.current.active) {
      if (activePointersRef.current.size < 2) {
        pinchRef.current.active = false
        // Flush final zoom/pan state
        setZoomLevel(zoomLevelRef.current)
        setPanOffset(panOffsetRef.current)
      }
      return
    }
    if (isPanningRef.current) handlePanEnd()
    // After pointer capture is released, pointerleave may not fire on touch —
    // explicitly hide the crosshair so it doesn't get stuck after the finger lifts.
    if (e.pointerType === 'touch') handleMouseLeave()
  }, [handlePanEnd, handleTaPointerUp])

  // Attach pan event listeners to document as a safety net (in case pointer
  // capture is lost — e.g. another element grabs it). Uses pointer events so
  // it works for mouse, touch, and pen alike.
  useEffect(() => {
    const onMove = (e) => { if (isPanningRef.current) handlePanMove(e) }
    const onUp = () => { if (isPanningRef.current) handlePanEnd() }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }
  }, [handlePanMove, handlePanEnd])

  // Cleanup momentum + pan RAF on unmount
  useEffect(() => {
    return () => {
      if (momentumAnimationRef.current) {
        cancelAnimationFrame(momentumAnimationRef.current)
      }
      if (rafPanRef.current) {
        cancelAnimationFrame(rafPanRef.current)
      }
      if (scrollToNowAnimRef.current) {
        cancelAnimationFrame(scrollToNowAnimRef.current)
      }
    }
  }, [])

  // Reset both axes and stop pending gestures so momentum cannot displace the
  // chart again after the reset. Older history remains available by panning.
  const handleResetView = useCallback(() => {
    for (const animation of [rafPanRef, rafZoomRef, momentumAnimationRef, scrollToNowAnimRef]) {
      if (animation.current) cancelAnimationFrame(animation.current)
      animation.current = null
    }
    if (zoomSyncTimerRef.current) clearTimeout(zoomSyncTimerRef.current)
    zoomSyncTimerRef.current = null
    isPanningRef.current = false
    panModeRef.current = null
    panVelocityRef.current = { x: 0, y: 0 }
    activePointersRef.current.clear()
    pinchRef.current.active = false
    if (containerRef.current) containerRef.current.style.cursor = 'crosshair'
    resetTimeViewRef.current()
    setPriceOffset(0)
    priceOffsetRef.current = 0
    setPriceZoom(1)
    priceZoomRef.current = 1
    setAutoFitPrice(true)
    if (drawChartRef.current) drawChartRef.current()
  }, [])

  // Smooth animated scroll back to the most recent candle (panOffset -> 0).
  // Used by the "scroll to latest" button that appears after the user has
  // panned into history. Uses RAF + ease-out so the chart glides instead of
  // snapping. Cancels any in-flight momentum animation first.
  const handleScrollToNow = useCallback(() => {
    if (momentumAnimationRef.current) {
      cancelAnimationFrame(momentumAnimationRef.current)
      momentumAnimationRef.current = null
    }
    if (scrollToNowAnimRef.current) {
      cancelAnimationFrame(scrollToNowAnimRef.current)
      scrollToNowAnimRef.current = null
    }
    const startOffset = panOffsetRef.current
    if (startOffset <= 0) return
    const startTime = performance.now()
    const duration = Math.min(800, 220 + Math.sqrt(startOffset) * 18)
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)
    const tick = (now) => {
      const elapsed = now - startTime
      const t = Math.min(1, elapsed / duration)
      const eased = easeOutCubic(t)
      const value = startOffset * (1 - eased)
      panOffsetRef.current = value
      if (drawChartRef.current) drawChartRef.current()
      if (t < 1) {
        scrollToNowAnimRef.current = requestAnimationFrame(tick)
      } else {
        scrollToNowAnimRef.current = null
        panOffsetRef.current = 0
        setPanOffset(0)
        if (drawChartRef.current) drawChartRef.current()
      }
    }
    scrollToNowAnimRef.current = requestAnimationFrame(tick)
  }, [])

  // Price axis drag handlers - drag up/down to zoom price scale
  const handlePriceAxisDragStart = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    try { e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId) } catch (_) {}
    setIsDraggingPriceAxis(true)
    setAutoFitPrice(false) // Disable auto-fit when manually adjusting
    dragStartRef.current = { x: 0, y: e.clientY, value: priceZoom }
    document.addEventListener('pointermove', handlePriceAxisDrag)
    document.addEventListener('pointerup', handlePriceAxisDragEnd)
    document.addEventListener('pointercancel', handlePriceAxisDragEnd)
  }

  const handlePriceAxisDrag = (e) => {
    const deltaY = e.clientY - dragStartRef.current.y
    // Drag up = zoom in (increase), drag down = zoom out (decrease) - more sensitive
    const sensitivity = 200
    const zoomDelta = -deltaY / sensitivity
    const newZoom = Math.max(0.1, Math.min(10, dragStartRef.current.value + zoomDelta))
    setPriceZoom(newZoom)
  }

  const handlePriceAxisDragEnd = () => {
    setIsDraggingPriceAxis(false)
    document.removeEventListener('pointermove', handlePriceAxisDrag)
    document.removeEventListener('pointerup', handlePriceAxisDragEnd)
    document.removeEventListener('pointercancel', handlePriceAxisDragEnd)
  }

  // Time axis drag handlers - drag left/right to zoom time scale
  const handleTimeAxisDragStart = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    try { e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId) } catch (_) {}
    setIsDraggingTimeAxis(true)
    dragStartRef.current = { x: e.clientX, y: 0, value: zoomLevel }
    document.addEventListener('pointermove', handleTimeAxisDrag)
    document.addEventListener('pointerup', handleTimeAxisDragEnd)
    document.addEventListener('pointercancel', handleTimeAxisDragEnd)
  }

  const handleTimeAxisDrag = (e) => {
    const deltaX = e.clientX - dragStartRef.current.x
    // Drag right = zoom out (see more candles), drag left = zoom in (see fewer candles)
    // Use exponential scaling for smoother feel
    const zoomMultiplier = Math.pow(1.005, -deltaX) // Exponential zoom
    
    // Calculate zoom limits based on timeframe
    const maxVisibleCandles = timeframe === '1D' ? candleData.length : Math.min(400, candleData.length)
    const minZoom = timeframe === '1D' ? MIN_CHART_ZOOM : Math.max(MIN_CHART_ZOOM, candleData.length / Math.max(1, maxVisibleCandles))
    const maxZoom = candleData.length / 20 // At least 20 candles visible
    
    const newZoom = Math.max(minZoom, Math.min(maxZoom, dragStartRef.current.value * zoomMultiplier))
    setZoomLevel(newZoom)
  }

  const handleTimeAxisDragEnd = () => {
    setIsDraggingTimeAxis(false)
    document.removeEventListener('pointermove', handleTimeAxisDrag)
    document.removeEventListener('pointerup', handleTimeAxisDragEnd)
    document.removeEventListener('pointercancel', handleTimeAxisDragEnd)
  }

  // Format volume value
  const formatVolume = (value) => hookFmtLarge(value)

  // Format date
  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    })
  }

  return (
    <div ref={chartFrameRef} data-chart-type={chartType} data-chart-day={dayMode ? 'true' : 'false'} className={`trading-chart ${isFullscreen ? 'fullscreen' : ''} ${isCollapsed ? 'collapsed' : ''}${responsiveControls ? ` rz-chart-responsive${responsiveFrame.compact ? ' rz-chart-compact' : ''}` : ''}`} style={!isFullscreen && embedHeight ? { height: `${responsiveControls ? Math.max(embedHeight, responsiveFrame.toolbarHeight + 260) : embedHeight}px` } : undefined}>
      {/* Close button for fullscreen mode - top right */}
      {isFullscreen && chartViewMode !== 'xBubbles' && (
        <button 
          className="fullscreen-close-btn"
          onClick={() => setIsFullscreen(false)}
          title={t('ui.exitFullscreen')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
      {/* Chart Controls */}
      <div className="chart-controls" ref={chartControlsRef}>
        {/* Next Gen tabs: Trading | Chart Overlay | X Bubbles */}
        {setChartViewMode && (
          <div className="nextgen-tabs-wrap">
            <span className="nextgen-tabs-label">{t('ui.nextGen')}</span>
            <div className="nextgen-tabs">
              <button
                type="button"
                className={`nextgen-tab ${chartViewMode === 'trading' ? 'active' : ''}`}
                onClick={() => setChartViewMode('trading')}
              >
                {t('ui.trading')}
              </button>
              <button
                type="button"
                className={`nextgen-tab ${chartViewMode === 'xChart' ? 'active' : ''}`}
                onClick={() => setChartViewMode('xChart')}
                title={t('chart.socialOverlay')}
              >
                {t('ui.chartOverlay')}
              </button>
              <button
                type="button"
                className={`nextgen-tab ${chartViewMode === 'xBubbles' ? 'active' : ''}`}
                onClick={() => setChartViewMode('xBubbles')}
              >
                {t('ui.xBubbles')}
              </button>
            </div>
          </div>
        )}
        {/* Left side: Chart types and timeframes */}
        <div className="chart-controls-left">
          {/* Chart Type Buttons - Clicking switches back to trading view */}
          <div className="chart-types">
            {/* Unify 2026-06-10: buttons are always rendered for crypto.
                Candles disables (not hides) on line-only data so mode
                availability stops looking random per token. */}
            <button
              className={`type-btn ${chartViewMode === 'trading' && chartType === 'candles' ? 'active' : ''} ${lineOnly ? 'disabled' : ''}`}
              aria-pressed={chartViewMode === 'trading' && chartType === 'candles'}
              disabled={lineOnly}
              title={lineOnly ? 'Candle data unavailable for this token — line data only' : undefined}
              onClick={() => {
                if (lineOnly) return
                setChartType('candles')
                // If in xBubbles mode, switch back to trading
                if (chartViewMode === 'xBubbles' && setChartViewMode) {
                  setChartViewMode('trading')
                }
              }}
            >
              <svg className="type-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="2" x2="5" y2="14" />
                <rect x="3.25" y="4.5" width="3.5" height="6" rx="0.5" fill="currentColor" stroke="none" />
                <line x1="11" y1="2" x2="11" y2="14" />
                <rect x="9.25" y="6" width="3.5" height="4.5" rx="0.5" fill="currentColor" stroke="none" />
              </svg>
              <span className="type-label">{t('chart.candles')}</span>
            </button>
            <button
              className={`type-btn ${chartViewMode === 'trading' && chartType === 'line' ? 'active' : ''}`}
              aria-pressed={chartViewMode === 'trading' && chartType === 'line'}
              onClick={() => {
                setChartType('line')
                if (chartViewMode === 'xBubbles' && setChartViewMode) {
                  setChartViewMode('trading')
                }
              }}
            >
              <svg className="type-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 11.5L5.5 7L8 9L13.5 3.5" />
                <path d="M10 3.5h3.5V7" />
              </svg>
              <span className="type-label">{t('chart.line')}</span>
            </button>
            {/* Bars chart type - only when barsChartProps provided */}
            {barsChartProps && (
              <button
                className={`type-btn ${chartViewMode === 'trading' && chartType === 'bars' ? 'active' : ''}`}
                onClick={() => {
                  setChartType('bars')
                  if (chartViewMode === 'xBubbles' && setChartViewMode) {
                    setChartViewMode('trading')
                  }
                }}
              >
                <svg className="type-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                </svg>
                <span className="type-label">Bars</span>
              </button>
            )}
            {/* Line color picker - only visible when line chart active */}
            {chartType === 'line' && chartViewMode === 'trading' && (
              <div className="line-color-picker" ref={lineColorRef}>
                <button
                  className="line-color-trigger"
                  onClick={() => setLineColorOpen(!lineColorOpen)}
                  title="Line color"
                >
                  <span
                    className="line-color-dot"
                    style={{ background: lineThemeSwatch(lineColorTheme) }}
                  />
                  <svg viewBox="0 0 10 6" fill="currentColor" width="8" height="5" className={`line-color-chevron ${lineColorOpen ? 'open' : ''}`}>
                    <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {lineColorOpen && lineColorPos && createPortal(
                  <div
                    ref={lineColorDropdownRef}
                    className="line-color-dropdown line-color-dropdown--portal"
                    style={{ top: lineColorPos.top, left: lineColorPos.left }}
                  >
                    {LINE_THEMES.map(th => (
                      <button
                        key={th.id}
                        className={`line-color-option ${lineColorTheme === th.id ? 'active' : ''}`}
                        onClick={() => { setLineColorTheme(th.id); setLineColorOpen(false) }}
                      >
                        <span
                          className="line-color-swatch"
                          style={{ background: lineThemeSwatch(th.id) }}
                        />
                        <span className="line-color-label">{th.label}</span>
                      </button>
                    ))}
                  </div>,
                  document.body
                )}
              </div>
            )}

            {/* TV has its own data source (TV/DEX feeds) — never hidden by
                lineOnly. Disabled only when the symbol truly can't resolve. */}
            <button
              className={`type-btn tradingview-btn ${chartViewMode === 'trading' && chartType === 'tradingview' ? 'active' : ''} ${(!hasTradingViewSupport && !tvLoading) ? 'disabled' : ''}`}
              aria-pressed={chartViewMode === 'trading' && chartType === 'tradingview'}
              onClick={() => {
                if (!hasTradingViewSupport && !tvLoading) return
                setChartType('tradingview')
                if (chartViewMode === 'xBubbles' && setChartViewMode) {
                  setChartViewMode('trading')
                }
              }}
              title={tvLoading ? 'Resolving TradingView symbol...' : (hasTradingViewSupport ? 'TradingView chart' : 'TradingView not available for this token')}
              disabled={!hasTradingViewSupport && !tvLoading}
            >
              <svg className="type-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.8654 8.2789c0 1.3541 -1.0978 2.4519 -2.452 2.4519 -1.354 0 -2.4519 -1.0978 -2.4519 -2.452 0 -1.354 1.0978 -2.4518 2.452 -2.4518 1.3541 0 2.4519 1.0977 2.4519 2.4519zM9.75 6H0v4.9038h4.8462v7.2692H9.75Zm8.5962 0H24l-5.1058 12.173h-5.6538z"/>
              </svg>
              <span className="type-label">{t('chart.tradingView')}</span>
            </button>

            {/* Price/MCap Toggle */}
            <div className="price-mcap-toggle">
              <button
                className={`toggle-btn ${yAxisMode === 'price' ? 'active' : ''}`}
                onClick={() => setYAxisMode('price')}
              >
                {t('chart.price')}
              </button>
              <button
                className={`toggle-btn ${yAxisMode === 'mcap' ? 'active' : ''}`}
                onClick={() => setYAxisMode('mcap')}
              >
                {t('chart.mCap')}
              </button>
            </div>

            {/* Linear/Log price-scale toggle (TradingView model). Default LIN;
                LOG for parabolic/wide-range tokens. Hidden in TradingView mode
                (the embedded widget has its own scale control). */}
            {chartType !== 'tradingview' && (
              <div className="price-mcap-toggle price-scale-toggle">
                <button
                  className={`toggle-btn ${priceScale === 'linear' ? 'active' : ''}`}
                  onClick={() => setPriceScale('linear')}
                  title="Linear price scale"
                >
                  LIN
                </button>
                <button
                  className={`toggle-btn ${priceScale === 'log' ? 'active' : ''}`}
                  onClick={() => setPriceScale('log')}
                  title="Logarithmic price scale"
                >
                  LOG
                </button>
              </div>
            )}
          </div>

          {/* Timeframe Selector - hidden when TradingView is active (it has its own built-in controls).
              Primary row = the always-visible timeframes; the rest live under a
              "More" dropdown so the bar stays compact (Gleb 2026-06-14). */}
          {chartType !== 'tradingview' && (
            <div className="timeframes">
              {(isCgSource ? CG_PRIMARY : CRYPTO_PRIMARY).map(tf => (
                <button
                  key={tf}
                  className={`tf-btn ${effectiveTimeframe === tf ? 'active' : ''}`}
                  onClick={() => setTimeframe(tf)}
                >
                  {TF_LABELS[tf] || tf}
                </button>
              ))}
              {(() => {
                const primary = isCgSource ? CG_PRIMARY : CRYPTO_PRIMARY
                const more = isCgSource ? CG_MORE : CRYPTO_MORE
                // The dropdown lists ALL timeframes, not just the overflow set:
                // on narrow panels the container queries hide inline tf buttons
                // progressively, so every timeframe must stay reachable through
                // the dropdown alone. The trigger always shows the ACTIVE
                // timeframe (TradingView-style current-interval control) so the
                // user never loses orientation when the inline row collapses.
                const allTfs = [...primary, ...more]
                const activeInMore = more.includes(effectiveTimeframe)
                return (
                  <div className="tf-more" ref={tfMoreRef}>
                    <button
                      type="button"
                      className={`tf-btn tf-more-btn ${activeInMore ? 'active' : ''} ${tfMenuOpen ? 'open' : ''}`}
                      onClick={() => setTfMenuOpen(o => !o)}
                      aria-haspopup="true"
                      aria-expanded={tfMenuOpen}
                      title="All timeframes"
                    >
                      {TF_LABELS[effectiveTimeframe] || effectiveTimeframe}
                      <svg className="tf-more-caret" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                    </button>
                    {tfMenuOpen && (responsiveControls ? responsiveTfStyle : tfMenuPos) && createPortal(
                      <div
                        className={`tf-more-menu tf-more-menu--portal${responsiveControls ? ` rz-chart-timeframes${dayMode ? ' rz-chart-timeframes--day' : ''}` : ''}`}
                        role="menu"
                        ref={tfMenuDropdownRef}
                        style={responsiveControls ? { position: 'fixed', ...responsiveTfStyle } : { position: 'fixed', top: tfMenuPos.top, right: tfMenuPos.right }}
                      >
                        {allTfs.map(tf => (
                          <button
                            key={tf}
                            type="button"
                            role="menuitem"
                            className={`tf-more-item ${effectiveTimeframe === tf ? 'active' : ''}`}
                            onClick={() => { setTimeframe(tf); setTfMenuOpen(false) }}
                          >
                            {TF_LABELS[tf] || tf}
                          </button>
                        ))}
                      </div>,
                      document.body
                    )}
                  </div>
                )
              })()}
            </div>
          )}
        </div>

        {/* Right side: Tools (always visible) */}
        <div className="chart-controls-right">
          {/* Mobile-only: separate Fullscreen + Settings dropdown.
              Hidden on desktop via @media in trading-chart.css. */}
          <button
            type="button"
            className={`tool-btn mobile-chart-fs-btn ${isFullscreen ? 'active' : ''}`}
            onClick={() => setIsFullscreen(!isFullscreen)}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2v4H2" /><path d="M10 2v4h4" /><path d="M6 14v-4H2" /><path d="M10 14v-4h4" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 6V2h4" /><path d="M14 6V2h-4" /><path d="M2 10v4h4" /><path d="M14 10v4h-4" />
              </svg>
            )}
          </button>
          <div className="mobile-chart-settings-wrap">
            <button
              ref={mobileSettingsTriggerRef}
              type="button"
              className={`tool-btn mobile-chart-settings-btn ${mobileSettingsOpen ? 'active' : ''}`}
              onClick={() => setMobileSettingsOpen(o => !o)}
              aria-label="Chart tools"
              aria-expanded={mobileSettingsOpen}
              aria-haspopup="dialog"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
              {responsiveControls && <span className="rz-chart-tools-label">Tools</span>}
            </button>
            {mobileSettingsOpen && createPortal(
              <>
              <div
                className={`mobile-chart-settings-backdrop${responsiveControls ? ' rz-chart-tools-backdrop' : ''}`}
                onClick={() => setMobileSettingsOpen(false)}
                aria-hidden="true"
              />
              <div
                ref={mobileSettingsRef}
                className={`mobile-chart-settings-menu${responsiveControls ? ` rz-chart-tools-sheet${dayMode ? ' rz-chart-tools-sheet--day' : ''}` : ''}`}
                role="dialog"
                aria-modal={responsiveControls || undefined}
                aria-label="Chart tools"
                tabIndex={-1}
              >
                <div className="mobile-chart-settings-grip" aria-hidden="true" />
                <div className="mobile-chart-settings-titlebar">
                  <span className="mobile-chart-settings-title">{responsiveControls ? 'Chart tools' : 'Chart settings'}</span>
                  <button
                    type="button"
                    className="mobile-chart-settings-close"
                    onClick={() => setMobileSettingsOpen(false)}
                    aria-label="Close"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                {Array.isArray(extraToolButtons) && extraToolButtons.map(btn => (
                  <button
                    key={btn.key}
                    type="button"
                    className={`mobile-chart-settings-item ${btn.active ? 'active' : ''} ${btn.disabled ? 'disabled' : ''}`}
                    onClick={btn.disabled ? undefined : (event) => { btn.onClick?.(event); setMobileSettingsOpen(false) }}
                    disabled={!!btn.disabled}
                  >
                    <span className="mobile-chart-settings-item-icon">{btn.icon}</span>
                    <span className="mobile-chart-settings-item-label">{btn.label || btn.title || btn.key}</span>
                    {btn.active && <span className="mobile-chart-settings-item-check">✓</span>}
                  </button>
                ))}
                {/* Brightness lever */}
                <div className="mobile-chart-settings-section">Brightness</div>
                <div className="mobile-chart-bright-row">
                  <input
                    type="range" min="0.7" max="1.6" step="0.02"
                    value={chartBrightness}
                    onChange={(e) => setChartBrightness(parseFloat(e.target.value))}
                    className="chart-brightness-slider"
                    aria-label="Chart brightness"
                  />
                  <span className="mobile-chart-bright-val">{Math.round(chartBrightness * 100)}%</span>
                </div>
                <div className="mobile-chart-settings-sep" />
                {/* Line color options — the desktop picker is hidden on mobile,
                    so surface Auto/Logo/Up-Down/etc here when a line chart is up. */}
                {chartType === 'line' && chartViewMode === 'trading' && (
                  <>
                    <div className="mobile-chart-settings-section">Line color</div>
                    {LINE_THEMES.map((th) => (
                      <button
                        key={th.id}
                        type="button"
                        className={`mobile-chart-settings-item ${lineColorTheme === th.id ? 'active' : ''}`}
                        onClick={() => { setLineColorTheme(th.id); setMobileSettingsOpen(false) }}
                      >
                        <span className="mobile-chart-settings-item-icon">
                          <span style={{ display: 'block', width: '16px', height: '16px', borderRadius: '5px', background: lineThemeSwatch(th.id), border: '1px solid rgba(128,128,128,0.28)' }} />
                        </span>
                        <span className="mobile-chart-settings-item-label">{th.label}</span>
                        {lineColorTheme === th.id && <span className="mobile-chart-settings-item-check">✓</span>}
                      </button>
                    ))}
                    <div className="mobile-chart-settings-sep" />
                  </>
                )}
                <button
                  type="button"
                  className={`mobile-chart-settings-item ${heatmapEnabled ? 'active' : ''}`}
                  onClick={() => setHeatmapEnabled(!heatmapEnabled)}
                >
                  <span className="mobile-chart-settings-item-icon">
                    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
                      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" />
                    </svg>
                  </span>
                  <span className="mobile-chart-settings-item-label">Heatmap</span>
                  {heatmapEnabled && <span className="mobile-chart-settings-item-check">✓</span>}
                </button>
                <button
                  type="button"
                  className={`mobile-chart-settings-item ${showATHLines ? 'active' : ''}`}
                  onClick={() => setShowATHLines(!showATHLines)}
                >
                  <span className="mobile-chart-settings-item-icon">
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                      <line x1="3" y1="6" x2="17" y2="6" strokeDasharray="2.5,2" />
                      <path d="M5 11l3-3 3 3 4-5" fill="none" />
                      <circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none" />
                    </svg>
                  </span>
                  <span className="mobile-chart-settings-item-label">ATH / Local highs</span>
                  {showATHLines && <span className="mobile-chart-settings-item-check">✓</span>}
                </button>
                <button
                  type="button"
                  className={`mobile-chart-settings-item ${showVWAP ? 'active' : ''}`}
                  onClick={() => setShowVWAP(!showVWAP)}
                >
                  <span className="mobile-chart-settings-item-icon">
                    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12l3-6 3 4 3-8 3 6" />
                    </svg>
                  </span>
                  <span className="mobile-chart-settings-item-label">VWAP</span>
                  {showVWAP && <span className="mobile-chart-settings-item-check">✓</span>}
                </button>
                <div className="mobile-chart-settings-sep" />
                <div className="mobile-chart-settings-section">Indicators</div>
                {Object.keys(INDICATOR_STYLES).map((key) => {
                  const style = INDICATOR_STYLES[key]
                  const active = !!activeIndicators[key]
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`mobile-chart-settings-item ${active ? 'active' : ''}`}
                      onClick={() => setActiveIndicators((prev) => ({ ...prev, [key]: !prev[key] }))}
                    >
                      <span className="mobile-chart-settings-item-dot" style={{ background: style.color }} />
                      <span className="mobile-chart-settings-item-label">{style.label}</span>
                      {active && <span className="mobile-chart-settings-item-check">✓</span>}
                    </button>
                  )
                })}
                {voiceSupported && (
                  <>
                    <div className="mobile-chart-settings-sep" />
                    <button
                      type="button"
                      className={`mobile-chart-settings-item ${voiceListening ? 'active' : ''}`}
                      onClick={toggleVoice}
                    >
                      <span className="mobile-chart-settings-item-icon">
                        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="6" y="2" width="4" height="8" rx="2" />
                          <path d="M3.5 7.5a4.5 4.5 0 009 0" />
                          <line x1="8" y1="12" x2="8" y2="14.5" />
                          <line x1="6" y1="14.5" x2="10" y2="14.5" />
                        </svg>
                      </span>
                      <span className="mobile-chart-settings-item-label">Voice control</span>
                      {voiceListening && <span className="mobile-chart-settings-item-check">●</span>}
                    </button>
                  </>
                )}
              </div>
              </>,
              document.body
            )}
          </div>
          <div className="chart-tools">
            {/* Extra tool buttons injected by parent (e.g. Compare, Note) */}
            {Array.isArray(extraToolButtons) && extraToolButtons.map(btn => (
              <button
                key={btn.key}
                className={`tool-btn ${btn.active ? 'active' : ''} ${btn.disabled ? 'disabled' : ''}`}
                onClick={btn.disabled ? undefined : btn.onClick}
                disabled={!!btn.disabled}
                type="button"
                aria-label={btn.label || btn.title}
                data-tool-key={btn.key}
                data-tooltip={btn.title || btn.label}
                ref={btn.btnRef}
              >
                {btn.icon}
                {responsiveControls && btn.key.startsWith('ta-') && (
                  <span className="rz-chart-direct-label">{btn.label}</span>
                )}
              </button>
            ))}
            <div className="chart-brightness-wrap" ref={brightnessRef}>
              <button
                className={`tool-btn ${brightnessOpen || chartBrightness !== 1 ? 'active' : ''}`}
                data-tooltip="Chart brightness"
                onClick={() => setBrightnessOpen(o => !o)}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="10" cy="10" r="3.4" />
                  <line x1="10" y1="1.8" x2="10" y2="3.8" /><line x1="10" y1="16.2" x2="10" y2="18.2" />
                  <line x1="1.8" y1="10" x2="3.8" y2="10" /><line x1="16.2" y1="10" x2="18.2" y2="10" />
                  <line x1="4.1" y1="4.1" x2="5.5" y2="5.5" /><line x1="14.5" y1="14.5" x2="15.9" y2="15.9" />
                  <line x1="4.1" y1="15.9" x2="5.5" y2="14.5" /><line x1="14.5" y1="5.5" x2="15.9" y2="4.1" />
                </svg>
              </button>
              {brightnessOpen && brightnessPos && createPortal(
                <div
                  ref={brightnessPopRef}
                  className="chart-brightness-pop chart-brightness-pop--portal"
                  style={{ top: brightnessPos.top, left: brightnessPos.left }}
                >
                  <div className="chart-brightness-pop__head">
                    <span>Brightness</span>
                    <span className="chart-brightness-pop__val">{Math.round(chartBrightness * 100)}%</span>
                  </div>
                  <input
                    type="range" min="0.7" max="1.6" step="0.02"
                    value={chartBrightness}
                    onChange={(e) => setChartBrightness(parseFloat(e.target.value))}
                    className="chart-brightness-slider"
                    aria-label="Chart brightness"
                  />
                  <div className="chart-brightness-pop__foot">
                    <button type="button" onClick={() => setChartBrightness(1)}>Reset</button>
                  </div>
                </div>,
                document.body
              )}
            </div>
            <button
              className={`tool-btn heatmap-btn ${heatmapEnabled ? 'active' : ''}`}
              data-tooltip={t('ui.heatmapView')}
              onClick={() => setHeatmapEnabled(!heatmapEnabled)}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
                <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
                <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
                <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
              </svg>
            </button>
            <button
              className={`tool-btn ath-btn ${showATHLines ? 'active' : ''}`}
              data-tooltip={t('ui.athLocalHigh')}
              onClick={() => setShowATHLines(!showATHLines)}
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <line x1="3" y1="6" x2="17" y2="6" strokeDasharray="2.5,2" />
                <path d="M5 11l3-3 3 3 4-5" fill="none" />
                <circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none" />
              </svg>
            </button>
            <div className="indicator-dropdown-wrap">
              <button
                ref={indicatorTriggerRef}
                className={`tool-btn ${Object.values(activeIndicators).some(Boolean) ? 'active' : ''}`}
                data-tooltip={t('chart.indicators')}
                onClick={() => setIndicatorDropdownOpen(o => !o)}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 13L5 8.5L7.5 11L11 5L13.5 8.5" />
                  <circle cx="5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="11" cy="5" r="1.2" fill="currentColor" stroke="none" />
                </svg>
              </button>
              {indicatorDropdownOpen && indicatorDropdownPos && createPortal(
                <div
                  ref={indicatorDropdownRef}
                  className="indicator-dropdown indicator-dropdown--portal"
                  style={{ top: indicatorDropdownPos.top, right: indicatorDropdownPos.right }}
                >
                  <div className="indicator-dropdown-title">{t('chart.indicators')}</div>
                  {Object.keys(INDICATOR_STYLES).map((key) => {
                    const style = INDICATOR_STYLES[key]
                    const active = !!activeIndicators[key]
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`indicator-option ${active ? 'active' : ''}`}
                        onClick={() => setActiveIndicators((prev) => ({ ...prev, [key]: !prev[key] }))}
                      >
                        <span className="indicator-option-dot" style={{ background: style.color }} />
                        <span className="indicator-option-label">{style.label}</span>
                        {active && (
                          <svg className="indicator-option-check" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M2 6.5L5 9.5L10 3.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    )
                  })}
                  {Object.values(activeIndicators).some(Boolean) && (
                    <button
                      type="button"
                      className="indicator-option indicator-clear"
                      onClick={() => setActiveIndicators({ ema9: false, ema21: false, ema50: false, ema200: false, sma20: false, sma50: false, sma200: false, bb: false, vwap: false })}
                    >
                      Clear all
                    </button>
                  )}
                </div>,
                document.body
              )}
            </div>
            <button 
              className={`tool-btn ${isFullscreen ? 'active' : ''}`} 
              data-tooltip={isFullscreen ? t('ui.exitFullscreen') : t('chart.fullscreen')}
              onClick={() => setIsFullscreen(!isFullscreen)}
            >
              {isFullscreen ? (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2v4H2" />
                  <path d="M10 2v4h4" />
                  <path d="M6 14v-4H2" />
                  <path d="M10 14v-4h4" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 6V2h4" />
                  <path d="M14 6V2h-4" />
                  <path d="M2 10v4h4" />
                  <path d="M14 10v4h-4" />
                </svg>
              )}
            </button>
            {/* Voice control button */}
            {voiceSupported && (
              <button
                className={`tool-btn voice-btn ${voiceListening ? 'listening' : ''}`}
                data-tooltip={voiceListening ? 'Stop voice control' : 'Voice control'}
                onClick={toggleVoice}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="2" width="4" height="8" rx="2" />
                  <path d="M3.5 7.5a4.5 4.5 0 009 0" />
                  <line x1="8" y1="12" x2="8" y2="14.5" />
                  <line x1="6" y1="14.5" x2="10" y2="14.5" />
                </svg>
                {voiceListening && <span className="voice-listening-dot" />}
              </button>
            )}
          </div>

          {/* Zoom indicators - one-click reset for time / price zoom */}
          {customChartView && (
            <div className="zoom-indicators">
              <button
                type="button"
                className="zoom-indicator chart-reset-view"
                onClick={handleResetView}
                aria-label="Custom chart view. Reset to selected time range and fit prices"
                title="Custom view — reset to the selected time range and fit prices"
              >
                <span className="chart-custom-label">Custom view</span>
                <span>Reset view</span>
              </button>
              {priceZoom !== 1 && (
                <button
                  type="button"
                  className="zoom-indicator"
                  onClick={() => { setPriceZoom(1); setPriceOffset(0); priceOffsetRef.current = 0; setAutoFitPrice(true) }}
                  data-tooltip="Reset price zoom"
                >
                  P: {Math.round(priceZoom * 100)}%
                </button>
              )}
            </div>
          )}

          {/* Voice command feedback toast */}
          {voiceCommand && (
            <div className="voice-command-toast">
              <svg className="voice-command-toast-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <span className="voice-command-toast-text">{voiceCommand.action}</span>
              <span className="voice-command-toast-raw">&ldquo;{voiceCommand.text}&rdquo;</span>
            </div>
          )}

        </div>
      </div>

      {/* Chart Content Area - maintains consistent height; embedHeight for overlay/compact (e.g. On-Chain panel) */}
      <div className="chart-content-area" style={isFullscreen ? { minHeight: 'auto' } : undefined}>
        {/* X Bubbles View */}
        {chartViewMode === 'xBubbles' && (
          <div 
            className={`x-bubbles-container ${isDarkMode ? 'dark-theme' : 'light-theme'} ${isFullscreen ? 'fullscreen-bubbles' : ''} mode-${viewMode.toLowerCase()} ${isNavigating ? 'navigating' : ''}`} 
            ref={bubblesContainerRef}
            onMouseDown={viewMode === '3D' ? handle3DMouseDown : undefined}
            onMouseMove={viewMode === '3D' ? handle3DMouseMove : undefined}
            onMouseUp={viewMode === '3D' ? handle3DMouseUp : undefined}
            onMouseLeave={viewMode === '3D' ? handle3DMouseUp : undefined}
            onContextMenu={(e) => e.preventDefault()}
          >
          {/* Space environment - particles and stars */}
          {viewMode === '3D' && (
            <>
              {/* Floating orbs - reduced count */}
              <div className="space-particles">
                {[...Array(6)].map((_, i) => (
                  <div 
                    key={i} 
                    className={`space-particle sp-${(i % 4) + 1}`}
                    style={{
                      left: `${10 + (i * 15)}%`,
                      top: `${15 + (i * 12)}%`,
                      animationDelay: `${-i * 8}s`,
                    }}
                  />
                ))}
              </div>
              
              {/* Subtle stars */}
              <div className="space-stars-subtle">
                {[...Array(15)].map((_, i) => (
                  <div 
                    key={i} 
                    className="subtle-star"
                    style={{
                      left: `${Math.random() * 100}%`,
                      top: `${Math.random() * 100}%`,
                      animationDelay: `${-Math.random() * 20}s`,
                      width: `${2 + Math.random() * 2}px`,
                      height: `${2 + Math.random() * 2}px`,
                    }}
                  />
                ))}
              </div>
            </>
          )}
          
          {/* Warp speed effect */}
          {isWarpSpeed && viewMode === '3D' && (
            <div className="warp-effect">
              {[...Array(30)].map((_, i) => (
                <div 
                  key={i} 
                  className="warp-line"
                  style={{
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                    animationDuration: `${0.3 + Math.random() * 0.3}s`,
                    animationDelay: `${Math.random() * 0.2}s`
                  }}
                />
              ))}
            </div>
          )}
          
          {/* 3D Scene wrapper */}
          <div 
            className="scene-3d"
            style={viewMode === '3D' ? {
              transform: `
                perspective(${2000}px)
                rotateX(${camera.rotX}deg)
                rotateY(${camera.rotY}deg)
                translateX(${-camera.x}px)
                translateY(${-camera.y}px)
                translateZ(${800 - camera.z}px)
              `,
              transformStyle: 'preserve-3d'
            } : {}}
          >
          
          {/* Floating energy particles */}
          <div className="energy-particles">
            <div className="energy-particle" />
            <div className="energy-particle" />
            <div className="energy-particle" />
            <div className="energy-particle" />
            <div className="energy-particle" />
            <div className="energy-particle" />
            <div className="energy-particle" />
          </div>
          
          {/* Zoomable content area */}
          <div 
            className="bubbles-zoom-area"
            style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}
          >
            {/* Background ambient bubbles - static positions for smooth effect */}
            <div className={`ambient-bubbles ${draggingBubble !== null ? 'is-dragging' : ''}`}>
              <div className="ambient-bubble ab-1" style={{ left: '8%', top: '15%', width: '80px', height: '80px' }} />
              <div className="ambient-bubble ab-2" style={{ left: '85%', top: '20%', width: '60px', height: '60px' }} />
              <div className="ambient-bubble ab-3" style={{ left: '75%', top: '70%', width: '100px', height: '100px' }} />
              <div className="ambient-bubble ab-4" style={{ left: '10%', top: '75%', width: '70px', height: '70px' }} />
              <div className="ambient-bubble ab-5" style={{ left: '45%', top: '5%', width: '50px', height: '50px' }} />
              <div className="ambient-bubble ab-6" style={{ left: '92%', top: '50%', width: '55px', height: '55px' }} />
              <div className="ambient-bubble ab-7" style={{ left: '5%', top: '45%', width: '45px', height: '45px' }} />
              <div className="ambient-bubble ab-8" style={{ left: '60%', top: '90%', width: '65px', height: '65px' }} />
            </div>
          
          {/* Drag trail effect */}
          {draggingBubble !== null && (
            <div className="drag-trail-container">
              <div className="drag-ripple ripple-1" style={{ 
                left: `${bubblePhysics.find(b => b.id === draggingBubble)?.x || 50}%`,
                top: `${bubblePhysics.find(b => b.id === draggingBubble)?.y || 50}%`
              }} />
              <div className="drag-ripple ripple-2" style={{ 
                left: `${bubblePhysics.find(b => b.id === draggingBubble)?.x || 50}%`,
                top: `${bubblePhysics.find(b => b.id === draggingBubble)?.y || 50}%`
              }} />
              <div className="drag-ripple ripple-3" style={{ 
                left: `${bubblePhysics.find(b => b.id === draggingBubble)?.x || 50}%`,
                top: `${bubblePhysics.find(b => b.id === draggingBubble)?.y || 50}%`
              }} />
            </div>
          )}

          {/* Connection lines (SVG) */}
          <svg className="bubble-connections" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              {/* Arrow marker - compact */}
              <marker
                id="arrowhead"
                markerWidth="2.5"
                markerHeight="2"
                refX="2"
                refY="1"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <polygon points="0 0, 2.5 1, 0 2" fill="url(#arrowGradient)" />
              </marker>
              <marker
                id="arrowheadLight"
                markerWidth="2.5"
                markerHeight="2"
                refX="2"
                refY="1"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <polygon points="0 0, 2.5 1, 0 2" fill="url(#arrowGradientLight)" />
              </marker>
              
              {/* Gradients */}
              <linearGradient id="connectionGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.8" />
                <stop offset="50%" stopColor="#A855F7" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#EC4899" stopOpacity="0.4" />
              </linearGradient>
              <linearGradient id="arrowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#A855F7" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#EC4899" stopOpacity="0.7" />
              </linearGradient>
              <linearGradient id="connectionGlow" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#EC4899" stopOpacity="0.15" />
              </linearGradient>
              
              {/* Light theme gradients */}
              <linearGradient id="connectionGradientLight" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.7" />
                <stop offset="50%" stopColor="#8B5CF6" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#A855F7" stopOpacity="0.4" />
              </linearGradient>
              <linearGradient id="arrowGradientLight" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#A855F7" stopOpacity="0.6" />
              </linearGradient>
              
              {/* Glow filter */}
              <filter id="connectionGlowFilter" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="0.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            
            {(() => {
              const visibleBubbles = getFilteredBubbles()
              const visibleIds = new Set(visibleBubbles.map(b => b.id))
              return bubbleConnections.map(([fromId, toId], index) => {
              // Only show connection if both bubbles are visible
              if (!visibleIds.has(fromId) || !visibleIds.has(toId)) return null
              const fromBubble = visibleBubbles.find(b => b.id === fromId)
              const toBubble = visibleBubbles.find(b => b.id === toId)
              if (!fromBubble || !toBubble) return null
              
              // Calculate direction and shorten line for arrow
              const dx = toBubble.x - fromBubble.x
              const dy = toBubble.y - fromBubble.y
              const length = Math.sqrt(dx * dx + dy * dy)
              const offsetRatio = 2.5 / length // Stop before bubble edge
              const endX = toBubble.x - dx * offsetRatio
              const endY = toBubble.y - dy * offsetRatio
              
              // Theme-based styles
              const gradientId = isDarkMode ? 'connectionGradient' : 'connectionGradientLight'
              const arrowId = isDarkMode ? 'arrowhead' : 'arrowheadLight'
              
              return (
                <g key={index} className="connection-group">
                  {/* Glow line (behind) */}
                  <line
                    x1={fromBubble.x}
                    y1={fromBubble.y}
                    x2={endX}
                    y2={endY}
                    stroke="url(#connectionGlow)"
                    strokeWidth="1.5"
                    className="connection-glow"
                  />
                  {/* Main connection line with arrow */}
                  <line
                    x1={fromBubble.x}
                    y1={fromBubble.y}
                    x2={endX}
                    y2={endY}
                    stroke={`url(#${gradientId})`}
                    strokeWidth="0.4"
                    strokeDasharray="1.5 0.8"
                    markerEnd={`url(#${arrowId})`}
                    className="connection-line"
                    filter="url(#connectionGlowFilter)"
                  />
                  {/* Animated particle along line */}
                  <circle r="0.4" fill={isDarkMode ? "#A855F7" : "#7C3AED"} className="connection-particle">
                    <animateMotion
                      dur={`${3 + index * 0.5}s`}
                      repeatCount="indefinite"
                      path={`M${fromBubble.x},${fromBubble.y} L${endX},${endY}`}
                    />
                  </circle>
                </g>
              )
            })
            })()}
          </svg>

          {/* All bubbles (including center) - rendered as planets in space */}
          {getFilteredBubbles().map(bubble => {
            const isCenter = bubble.size === 'center'
            const isDragging = draggingBubble === bubble.id
            const isConnectedToDragging = draggingBubble !== null && getConnectedBubbles(draggingBubble).has(bubble.id)
            const isMoving = Math.abs(bubble.vx) > 0.1 || Math.abs(bubble.vy) > 0.1
            const categoryColor = getCategoryColor(bubble.category)
            
            // 3D Space depth calculations - relative to camera
            const bubbleZ = bubble.z || 0
            const relativeZ = bubbleZ - (800 - camera.z) // Distance from camera
            
            // More dramatic scaling based on distance (like real perspective)
            const perspectiveScale = viewMode === '3D' 
              ? Math.max(0.1, Math.min(4, 400 / Math.max(100, 400 + relativeZ)))
              : 1
            
            // Opacity based on distance (far objects fade)
            const depthOpacity = viewMode === '3D' 
              ? Math.max(0.2, Math.min(1, 1 - Math.abs(relativeZ) / 1200))
              : 1
            
            // Blur only for very far objects (not close ones)
            const depthBlur = viewMode === '3D' && relativeZ < -200
              ? Math.max(0, Math.min(4, (-relativeZ - 200) / 200))
              : 0
            
            // Check if bubble is "behind" camera (don't render)
            if (viewMode === '3D' && relativeZ > 600) return null
            
            // Determine if this planet is close (for "passing by" effect)
            const isClose = viewMode === '3D' && Math.abs(relativeZ) < 150
            
            return (
              <div
                key={bubble.id}
                className={`kol-bubble ${bubble.size} ${selectedBubble === bubble.id ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isConnectedToDragging ? 'following' : ''} ${isMoving ? 'in-motion' : ''} ${isClose ? 'planet-close' : ''}`}
                data-category={bubble.category}
                style={{
                  left: `${viewMode === '3D' ? (bubble.x3d || bubble.x) : bubble.x}%`,
                  top: `${viewMode === '3D' ? (bubble.y3d || bubble.y) : bubble.y}%`,
                  cursor: isDragging ? 'grabbing' : (viewMode === '3D' ? 'default' : 'grab'),
                  zIndex: isDragging ? 100 : (isCenter ? 50 : (selectedBubble === bubble.id ? 60 : Math.round(500 - relativeZ))),
                  transition: isDragging ? 'none' : 'opacity 0.3s ease',
                  transform: viewMode === '3D' 
                    ? `translateZ(${bubbleZ}px) scale(${perspectiveScale})`
                    : undefined,
                  opacity: depthOpacity,
                  filter: depthBlur > 0.5 ? `blur(${depthBlur}px)` : undefined,
                  '--category-color': categoryColor,
                  pointerEvents: viewMode === '3D' ? 'none' : 'auto', // Disable drag in 3D flight mode
                }}
                onMouseDown={(e) => viewMode !== '3D' && handleBubbleMouseDown(e, bubble.id)}
                onClick={() => viewMode !== '3D' && !isDragging && setSelectedBubble(selectedBubble === bubble.id ? null : bubble.id)}
              >
                {/* Title above bubble */}
                <span className="kol-bubble-title">{bubble.user}</span>
                
                <div className="kol-bubble-glow" />
                <div className="kol-bubble-ring" />
                <div className="kol-bubble-inner">
                  <img src={bubble.avatar} alt={bubble.user} loading="lazy" decoding="async" width="48" height="48" />
                </div>
                
                {selectedBubble === bubble.id && !isCenter && (
                  <div className="kol-bubble-tooltip">
                    <button className="tooltip-close" onClick={(e) => { e.stopPropagation(); setSelectedBubble(null); }}>×</button>
                    <div className="tooltip-header">
                      <img src={bubble.avatar} alt={bubble.user} loading="lazy" decoding="async" width="40" height="40" className="tooltip-avatar" />
                      <div className="tooltip-info">
                        <span className="tooltip-name">{bubble.user}</span>
                        <span className="tooltip-followers">{bubble.followers} followers</span>
                      </div>
                    </div>
                    <div className="tooltip-socials">
                      <button className="social-btn">𝕏</button>
                      <button className="social-btn">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                      </button>
                      <button className="social-btn">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                      </button>
                      <button className="social-btn">🌐</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          </div> {/* End bubbles-zoom-area */}
          </div> {/* End scene-3d */}
          
          {/* Flight HUD */}
          {viewMode === '3D' && (
            <div className="flight-hud">
              {/* Crosshair */}
              <div className="hud-crosshair">
                <div className="crosshair-ring" />
                <div className="crosshair-dot" />
                <div className="crosshair-line crosshair-h" />
                <div className="crosshair-line crosshair-v" />
              </div>
              
              {/* Speed indicator - bottom center */}
              <div className="hud-speed-bottom">
                <div className={`speed-display ${isWarpSpeed ? 'warp' : ''}`}>
                  <span className="speed-value">{Math.round(flightSpeed * 10)}</span>
                  <span className="speed-unit">m/s</span>
                  {isWarpSpeed && <span className="warp-badge">WARP</span>}
                </div>
              </div>
              
              {/* Position indicator */}
              <div className="hud-position">
                <div className="pos-label">POSITION</div>
                <div className="pos-coords">
                  <span>X: {Math.round(camera.x)}</span>
                  <span>Y: {Math.round(camera.y)}</span>
                  <span>Z: {Math.round(camera.z)}</span>
                </div>
              </div>
              
              {/* Compass */}
              <div className="hud-compass">
                <div 
                  className="compass-ring"
                  style={{ transform: `rotate(${-camera.rotY}deg)` }}
                >
                  <span className="compass-n">N</span>
                  <span className="compass-e">E</span>
                  <span className="compass-s">S</span>
                  <span className="compass-w">W</span>
                </div>
              </div>
            </div>
          )}
          
          {/* Flight Controls Help - Collapsible */}
          {viewMode === '3D' && (
            <div className={`nav-help-3d ${flightControlsCollapsed ? 'collapsed' : ''}`}>
              <div className="nav-help-header">
                <div className="nav-help-title">🚀 Flight Controls</div>
                <button 
                  className="nav-collapse-btn"
                  onClick={() => setFlightControlsCollapsed(!flightControlsCollapsed)}
                >
                  {flightControlsCollapsed ? '▶' : '◀'}
                </button>
              </div>
              {!flightControlsCollapsed && (
                <div className="nav-help-content">
                  <div className="nav-help-item"><kbd>W</kbd> Fly Forward</div>
                  <div className="nav-help-item"><kbd>S</kbd> Fly Backward</div>
                  <div className="nav-help-item"><kbd>A</kbd><kbd>D</kbd> Strafe</div>
                  <div className="nav-help-item"><kbd>Q</kbd><kbd>E</kbd> Up / Down</div>
                  <div className="nav-help-item"><kbd>R</kbd> Boost Forward</div>
                  <div className="nav-help-item"><kbd>Shift</kbd> Warp Speed</div>
                  <div className="nav-help-divider" />
                  <div className="nav-help-item"><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> Look Around</div>
                  <div className="nav-help-divider" />
                  <div className="nav-help-item">🖱️ Drag to look</div>
                  <div className="nav-help-item">🖱️ Scroll to zoom</div>
                  <button className="nav-reset-btn" onClick={resetCamera}>
                    🏠 Return to Base
                  </button>
                </div>
              )}
            </div>
          )}
          
          {/* 3D Depth Indicator */}
          {viewMode === '3D' && (
            <div className="depth-indicator">
              <div className="depth-label">DEPTH</div>
              <div className="depth-bar">
                <div 
                  className="depth-marker" 
                  style={{ bottom: `${Math.max(0, Math.min(100, ((2000 - camera.z) / 2500) * 100))}%` }}
                />
                {/* Planet markers on depth bar */}
                {bubblePhysics.slice(0, 5).map((bubble, i) => (
                  <div 
                    key={i}
                    className="depth-planet-marker"
                    style={{ 
                      bottom: `${Math.max(0, Math.min(100, ((2000 - (bubble.z || 0)) / 2500) * 100))}%`,
                      opacity: 0.6
                    }}
                    title={bubble.user}
                  />
                ))}
              </div>
              <div className="depth-value">{Math.round(camera.z)}m</div>
            </div>
          )}

          {/* Top Left Controls */}
          <div className="bubbles-controls-top">
            {/* Legend Filter Dropdown */}
            <div className="bubble-filter-dropdown">
              <button 
                className={`bubble-control-btn legend ${legendDropdownOpen ? 'active' : ''}`}
                onClick={() => {
                  setLegendDropdownOpen(!legendDropdownOpen)
                  setTimeDropdownOpen(false)
                  setFollowersDropdownOpen(false)
                }}
              >
                <span>🎨</span> X Bubbles Legend
                <svg viewBox="0 0 20 20" fill="currentColor" className={legendDropdownOpen ? 'rotated' : ''}>
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
                </svg>
            </button>
              {legendDropdownOpen && (
                <div className="filter-dropdown-menu legend-menu">
                  <div className="filter-legend-item">
                    <label className="toggle-switch-label">
                      <input 
                        type="checkbox" 
                        checked={legendFilter.main}
                        onChange={() => setLegendFilter(prev => ({ ...prev, main: !prev.main }))}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                    <span className="legend-color" style={{ background: '#22c55e' }}></span>
                    <span className="legend-label"><strong>Green</strong> Main Project</span>
                  </div>
                  <div className="filter-legend-item">
                    <label className="toggle-switch-label">
                      <input 
                        type="checkbox" 
                        checked={legendFilter.project}
                        onChange={() => setLegendFilter(prev => ({ ...prev, project: !prev.project }))}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                    <span className="legend-color" style={{ background: '#ec4899' }}></span>
                    <span className="legend-label"><strong>Pink</strong> Projects</span>
                  </div>
                  <div className="filter-legend-item">
                    <label className="toggle-switch-label">
                      <input 
                        type="checkbox" 
                        checked={legendFilter.top5}
                        onChange={() => setLegendFilter(prev => ({ ...prev, top5: !prev.top5 }))}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                    <span className="legend-color" style={{ background: '#eab308' }}></span>
                    <span className="legend-label"><strong>Yellow</strong> TOP 5 KOLs by followers</span>
                  </div>
                  <div className="filter-legend-item">
                    <label className="toggle-switch-label">
                      <input 
                        type="checkbox" 
                        checked={legendFilter.kol100k}
                        onChange={() => setLegendFilter(prev => ({ ...prev, kol100k: !prev.kol100k }))}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                    <span className="legend-color" style={{ background: '#f97316' }}></span>
                    <span className="legend-label"><strong>Orange</strong> KOLs with 100k+ followers</span>
                  </div>
                  <div className="filter-legend-item">
                    <label className="toggle-switch-label">
                      <input 
                        type="checkbox" 
                        checked={legendFilter.kolUnder100k}
                        onChange={() => setLegendFilter(prev => ({ ...prev, kolUnder100k: !prev.kolUnder100k }))}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                    <span className="legend-color" style={{ background: '#a855f7' }}></span>
                    <span className="legend-label"><strong>Purple</strong> KOLs with less than 100k followers</span>
                  </div>
                </div>
              )}
            </div>
            
            {/* Time Filter Dropdown */}
            <div className="bubble-filter-dropdown">
              <button 
                className={`bubble-control-btn ${timeDropdownOpen ? 'active' : ''}`}
                onClick={() => {
                  setTimeDropdownOpen(!timeDropdownOpen)
                  setLegendDropdownOpen(false)
                  setFollowersDropdownOpen(false)
                }}
              >
                <span>🕐</span> {timeFilterOptions.find(opt => opt.value === timeFilter)?.label || t('chart.allTime')}
                <svg viewBox="0 0 20 20" fill="currentColor" className={timeDropdownOpen ? 'rotated' : ''}>
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
                </svg>
            </button>
              {timeDropdownOpen && (
                <div className="filter-dropdown-menu time-menu">
                  {timeFilterOptions.map(option => (
                    <div 
                      key={option.value}
                      className={`filter-time-item ${timeFilter === option.value ? 'active' : ''}`}
                      onClick={() => {
                        setTimeFilter(option.value)
                        setTimeDropdownOpen(false)
                      }}
                    >
                      {timeFilter === option.value && <span className="check-mark">✓</span>}
                      {option.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Followers Range Filter Dropdown */}
            <div className="bubble-filter-dropdown">
              <button 
                className={`bubble-control-btn ${followersDropdownOpen ? 'active' : ''}`}
                onClick={() => {
                  setFollowersDropdownOpen(!followersDropdownOpen)
                  setLegendDropdownOpen(false)
                  setTimeDropdownOpen(false)
                }}
              >
                <span>≡</span> Followers range
                <svg viewBox="0 0 20 20" fill="currentColor" className={followersDropdownOpen ? 'rotated' : ''}>
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
                </svg>
            </button>
              {followersDropdownOpen && (
                <div className="filter-dropdown-menu followers-menu">
                  <div className="filter-followers-title">Filtering by followers range</div>
                  <div className="filter-followers-inputs">
                    <div className="follower-input-group">
                      <span className="input-icon">👤</span>
                      <input 
                        type="text" 
                        placeholder="Min"
                        value={followersRange.min}
                        onChange={(e) => setFollowersRange(prev => ({ ...prev, min: e.target.value.replace(/\D/g, '') }))}
                      />
                    </div>
                    <div className="follower-input-group">
                      <span className="input-icon">👤</span>
                      <input 
                        type="text" 
                        placeholder="Max"
                        value={followersRange.max}
                        onChange={(e) => setFollowersRange(prev => ({ ...prev, max: e.target.value.replace(/\D/g, '') }))}
                      />
                    </div>
                  </div>
                  <button 
                    className="filter-apply-btn"
                    onClick={() => setFollowersDropdownOpen(false)}
                  >
                    ✓ Apply
            </button>
                </div>
              )}
            </div>
          </div>

          {/* Top Right - Theme Toggle + Close (in fullscreen) */}
          <div className="bubbles-controls-top-right">
            {isFullscreen && (
              <button 
                className="close-fullscreen-btn"
                onClick={() => setIsFullscreen(false)}
                title={t('ui.exitFullscreen')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
            {/* View Mode Toggle */}
            <div className="view-mode-toggle">
              <button 
                className={`view-mode-btn ${viewMode === '2D' ? 'active' : ''}`}
                onClick={() => setViewMode('2D')}
              >
                2D
              </button>
              <button 
                className={`view-mode-btn ${viewMode === '3D' ? 'active' : ''}`}
                onClick={() => setViewMode('3D')}
              >
                3D
              </button>
            </div>
            
            <div className="theme-toggle" onClick={() => setIsDarkMode(!isDarkMode)}>
              <span className={isDarkMode ? 'active' : ''}>dark</span>
              <div className={`toggle-switch ${isDarkMode ? '' : 'light-mode'}`}>
                <span className="toggle-dot" />
              </div>
              <span className={!isDarkMode ? 'active' : ''}>light</span>
            </div>
          </div>

          {/* Bottom Controls */}
          <div className="bubbles-controls-bottom">
            <div className="bubbles-branding">
              <span>X Bubbles for <strong>Spectre</strong></span>
              <span className="divider">|</span>
              <span>powered by <strong>Spectre AI</strong></span>
            </div>
            <div className="zoom-controls">
              {viewMode === '2D' ? (
                <>
                  <button 
                    className="zoom-btn" 
                    onClick={() => setZoomLevel(prev => Math.max(MIN_CHART_ZOOM, Math.min(prev * 1.3, candleData.length / 20)))}
                    title="Zoom In"
                  >+</button>
                  <span className="zoom-level">{zoomLevel >= 1 ? `${Math.round(zoomLevel * 100)}%` : `${Math.round(candleData.length / zoomLevel)} bars`}</span>
                  <button 
                    className="zoom-btn" 
                    onClick={() => {
                      // Long-range timeframes: allow full zoom out, intraday: limit to ~400 candles max
                      const isLongRange = ['1D', '1W', '1Y', 'YTD', 'ALL'].includes(timeframe)
                      const maxVisibleCandles = isLongRange ? candleData.length : Math.min(400, candleData.length)
                      const minZoom = isLongRange ? MIN_CHART_ZOOM : Math.max(MIN_CHART_ZOOM, candleData.length / Math.max(1, maxVisibleCandles))
                      setZoomLevel(prev => Math.max(prev * 0.7, minZoom))
                    }}
                    title="Zoom Out (show more data)"
                  >−</button>
                  <button 
                    className="fit-btn"
                    onClick={() => {
                      // Long-range timeframes: fit all data, intraday: fit to ~400 candles max
                      const isLongRange = ['1D', '1W', '1Y', 'YTD', 'ALL'].includes(timeframe)
                      const maxVisibleCandles = isLongRange ? candleData.length : Math.min(400, candleData.length)
                      const targetZoom = isLongRange ? MIN_CHART_ZOOM : Math.max(MIN_CHART_ZOOM, candleData.length / Math.max(1, maxVisibleCandles))
                      setZoomLevel(targetZoom)
                      setPanOffset(0)
                      panOffsetRef.current = 0
                      setAutoFitPrice(true)
                    }}
                    title={['1D', '1W', '1Y', 'YTD', 'ALL'].includes(timeframe) ? "Fit All Data on Screen" : "Fit to max view (drag to see more history)"}
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                      <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 01-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 01-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 011.414 1.414L6.414 15H8a1 1 0 010 2H4a1 1 0 01-1-1v-4zm13-1a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 010-2h1.586l-2.293-2.293a1 1 0 111.414-1.414L15 13.586V12a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                    All
                  </button>
                </>
              ) : (
                <>
                  <button 
                    className="zoom-btn" 
                    onClick={() => setCamera(prev => ({ ...prev, z: Math.max(-500, prev.z - 100) }))}
                    title="Fly Forward"
                  >🚀</button>
                  <span className="zoom-level" style={{ minWidth: '80px' }}>
                    {Math.round(flightSpeed * 10)}m/s
                  </span>
                  <button 
                    className="zoom-btn" 
                    onClick={() => setCamera(prev => ({ ...prev, z: Math.min(2000, prev.z + 100) }))}
                    title="Fly Back"
                  >⬅️</button>
                  <button 
                    className="fit-btn"
                    onClick={resetCamera}
                    title="Return to Base"
                  >
                    🏠 Base
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bars Chart - full replacement when bars type is active */}
      {chartType === 'bars' && barsChartProps && (
        <div className="chart-body chart-body-bars" style={{ height: embedHeight || 500 }}>
          <RzPriceHistoryBars
            currentPrice={barsChartProps.currentPrice}
            atl={barsChartProps.atl}
            ath={barsChartProps.ath}
            dayMode={dayMode}
            tokenColor={barsChartProps.tokenColor}
            height={embedHeight || 500}
          />
        </div>
      )}

      {/* Chart Canvas or TradingView embed */}
      <div
        className={`chart-body ${chartViewMode === 'xBubbles' ? 'hidden' : ''} ${chartType === 'tradingview' ? 'chart-body-tradingview' : ''} ${chartType === 'bars' ? 'hidden' : ''} ${compareViewActive ? 'chart-body-compare' : ''}`}
        ref={containerRef}
        onPointerMove={(chartType === 'tradingview' || compareViewActive) ? undefined : handlePointerMove}
        onPointerLeave={(chartType === 'tradingview' || compareViewActive) ? undefined : handleMouseLeave}
        onPointerDown={(chartType === 'tradingview' || compareViewActive) ? undefined : handlePanStart}
        onPointerUp={(chartType === 'tradingview' || compareViewActive) ? undefined : handlePointerUp}
        onPointerCancel={(chartType === 'tradingview' || compareViewActive) ? undefined : handlePointerUp}
        onDoubleClick={(chartType === 'tradingview' || compareViewActive) ? undefined : handleResetView}
        onClick={(chartType === 'tradingview' || compareViewActive) ? undefined : handleCanvasClick}
        style={{ cursor: (chartType === 'tradingview' || compareViewActive) ? 'default' : (taMode !== 'off' ? 'crosshair' : (noteModeActive ? 'copy' : 'crosshair')) }}
      >
        {compareViewActive && compareViewProps ? (
          <RzCompareView {...compareViewProps} dayMode={dayMode} />
        ) : chartType === 'tradingview' ? (
          // ALL crypto renders the SELF-HOSTED TradingView charting_library
          // (UDF -> /api/bars cascade: Binance -> Hetzner candle store -> GT
          // -> Codex last-resort). History: the 2026-06-03 cost-war sent
          // everything to free iframes; 2026-06-10 restored self-hosted for
          // DEX tokens but left Binance-pair MAJORS on the hosted TV widget
          // iframe - so BTC/ETH, the most-viewed charts, lost drawing tools,
          // our theming and the custom datafeed. The cost reason is gone for
          // majors: the UDF cascade serves them from FREE Binance klines
          // (Gleb 2026-07-03: "why TV iframe? we prev used the Advanced
          // library - fix it").
          // Iframe stays for: STOCKS (TV's own stock dataset beats our
          // Yahoo cascade) and the onNoData fail-open below. Touch devices
          // render the same self-hosted widget as desktop (was #1147) - the
          // widget's own fail-open probe fires onNoData on a silent mount
          // failure, which lands here as tvEmbedFallback.
          // Identity still resolving: mounting either the widget or the embed
          // here charts a BARE TICKER (or latches the embed via the widget's
          // no-data fail-open) for the second before the address lands. Hold
          // the shimmer instead — same rule as the canvas path above.
          identityUnready ? (
            <div className="chart-loading-state">
              <div className="chart-loading-shimmer animate-shimmer" />
            </div>
          ) : (!token?.isStock && !tvEmbedFallback) ? (
            <TradingViewAdvanced
              preserveVerticalPageScroll={responsiveControls}
              symbol={tokenSymbol || 'SPECTRE'}
              token={token}
              timeframe={timeframe}
              dayMode={dayMode}
              tokenColor={tokenBrandHex}
              // Cold-load cost cut: the parent already knows the price, so hand
              // it to the datafeed. resolveSymbol derives the pricescale from
              // this ref (computePricescaleFromPrice) instead of firing an extra
              // serial /api/bars probe purely to detect the scale — kills one
              // cold-path round-trip on the Codex cost waterfall per chart open.
              referencePrice={Number(livePrice) || Number(liveTokenData?.price) || Number(stats?.price) || undefined}
              onNoData={() => setTvEmbedFallback(true)}
              onChartReady={handleTvChartReady}
            />
          ) : (
            <ChartIframeEmbed
              token={token}
              timeframe={timeframe}
              dayMode={dayMode}
            />
          )
        ) : (
          <>
        <canvas ref={canvasRef} className={`chart-canvas${chartFading ? ' chart-canvas--fading' : ''}`} style={chartFilter ? { filter: chartFilter } : undefined} />
        {/* Inset past the axes so the brand lockup lands INSIDE the plot instead
            of on top of the gutters. Bottom-right of `.chart-body` is the time-axis
            strip, where the final "Jul 31 22:00" label is drawn centred on the last
            candle — measured 62x10px of overlap at every chart width. padY lifts the
            mark above the axis separator, padX keeps it clear of the price scale. */}
        <ChartWatermark padX={priceAxisWidth + 12} padY={timeAxisHeight + 8} />
        <span ref={livePulseRef} className="chart-live-pulse" aria-hidden="true" />

        {/* DOM-rendered annotation pins — note icon + entrance animation. Canvas
            still draws the dotted drop-line; this layer just paints the head. */}
        {domPins.length > 0 && chartType !== 'tradingview' && (
          <div className="chart-note-pins">
            {domPins.map(pin => (
              <button
                key={pin.id}
                type="button"
                className={`chart-note-pin${pin.isNew ? ' chart-note-pin--enter' : ''}`}
                style={{ left: pin.x, top: pin.y, '--pin-color': pin.color }}
                onClick={(e) => {
                  e.stopPropagation()
                  if (typeof onAnnotationClick === 'function') {
                    onAnnotationClick({ id: pin.id, screenX: e.clientX, screenY: e.clientY })
                  }
                }}
                aria-label="Open note"
              >
                <span className="chart-note-pin-halo" aria-hidden="true" />
                <span className="chart-note-pin-body chart-note-pin-body--ico" aria-hidden="true">
                  {getNoteIcon(pin.icon).svg}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Active indicator legend overlay */}
        {Object.entries(activeIndicators).some(([, v]) => v) && chartType !== 'tradingview' && chartViewMode === 'trading' && (
          <div className="indicator-legend">
            {Object.entries(activeIndicators).filter(([, v]) => v).map(([key]) => {
              const style = INDICATOR_STYLES[key]
              if (!style) return null
              return (
                <span key={key} className="indicator-legend-item" style={{ '--ind-color': style.color }}>
                  <span className="indicator-legend-dot" />
                  {style.label}
                </span>
              )
            })}
          </div>
        )}

        {/* Initial loading state - waiting for data */}
        {candleData.length === 0 && (
          <div className="chart-loading-state">
            {!effectiveLoading && effectiveError && !identityUnready ? (
              <div className="loading-text">
                <span className="loading-title">Chart unavailable</span>
                <span className="loading-subtitle">{effectiveError}</span>
              </div>
            ) : (
              <div className="chart-loading-shimmer animate-shimmer" />
            )}
          </div>
        )}

        {/* Refetch indicator - thin top progress bar shown whenever bars are in
            flight while existing candles are still on screen: a timeframe/source
            change (effectiveLoading) OR a scroll-back history fetch (loadingMore).
            loadingMore is set only by fetchMoreHistory, i.e. by the user's own
            pan into history - the silent background buffer-extender never sets
            it, so this never lights up for prefetch the user didn't ask for. */}
        {(effectiveLoading || loadingMore) && candleData.length > 0 && (
          <div className="chart-refetch-bar" aria-hidden="true">
            <div className="chart-refetch-bar-track" />
          </div>
        )}

        {/* History-loading pill, top-left like TradingView's own indicator: near
            the edge the incoming candles land at, so it reads as "older bars are
            coming" rather than a generic busy state, without covering the price
            action. Shimmer, not a spinner (design system: no loading wheels). */}
        {loadingMore && candleData.length > 0 && (
          <div className="chart-history-loading" role="status">
            <span className="chart-history-loading-track" aria-hidden="true" />
            <span>Loading history</span>
          </div>
        )}
        
        {/* Scroll-to-latest button: appears when the user has panned into history.
            Shown only for canvas charts (TradingView has its own jump-to-now control)
            and uses panOffset (in candle units) as the trigger so the threshold scales
            with zoom level — ~20 candles into the past is enough to feel "scrolled". */}
        {chartType !== 'tradingview' && panOffset > 20 && !chartLoading && candleData.length > 0 && (
          <button
            type="button"
            className="chart-scroll-to-now"
            onClick={handleScrollToNow}
            title="Scroll to latest candle"
            aria-label="Scroll to latest candle"
            style={{ right: priceAxisWidth + 12 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}

        {/* TA selection action bar — anchored to the committed marquee. It only
            renders for a settled selection (never mid-drag), and the selection
            is cleared on zoom/timeframe change, so it cannot drift off its box. */}
        {taSelRect && taSelection && (
          <div
            className="chart-ta-actions"
            data-no-pan
            style={{
              left: Math.max(4, taSelRect.x + taSelRect.w / 2),
              top: Math.max(4, taSelRect.y + taSelRect.h - 52),
            }}
          >
            {taSelection.label && <span className="chart-ta-readout">{taSelection.label}</span>}
            <button type="button" className="chart-ta-action chart-ta-action--primary" onClick={() => onTaSelectionChange?.(taSelection, 'analyze')}>
              <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 2.6l1.5 3.4 3.7.4-2.8 2.5.8 3.6L10 10.7l-3.2 1.8.8-3.6-2.8-2.5 3.7-.4z" />
                <path d="M4 16.4h12" opacity="0.45" />
              </svg>
              Read this window
            </button>
            <button type="button" className="chart-ta-action chart-ta-action--ghost" onClick={() => onTaSelectionChange?.(null)} aria-label="Dismiss">
              <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          </div>
        )}

        {/* Price Axis Drag Handle - drag up/down to zoom price scale */}
        <div
          className={`axis-drag-handle price-axis-handle ${isDraggingPriceAxis ? 'active' : ''}`}
          style={responsiveControls ? { width: priceAxisWidth } : undefined}
          onPointerDown={handlePriceAxisDragStart}
          onDoubleClick={() => { setPriceZoom(1); setPriceOffset(0); priceOffsetRef.current = 0; setAutoFitPrice(true); }}
          title="Drag up/down to zoom price scale • Double-click to auto-fit"
        />

        {/* Time Axis Drag Handle - drag left/right to zoom time scale */}
        <div
          className={`axis-drag-handle time-axis-handle ${isDraggingTimeAxis ? 'active' : ''}`}
          onPointerDown={handleTimeAxisDragStart}
          onDoubleClick={() => {
            setZoomLevel(1) // Reset to full view
            setPanOffset(0)
            panOffsetRef.current = 0
            setAutoFitPrice(true)
          }}
          title="Drag left/right to zoom time scale • Double-click to reset"
        />
        
        {/* Crosshair Overlay - TradingView style */}
        {crosshair.visible && chartDimensionsRef.current && (
          <div className="crosshair-overlay">
            {/* Vertical line - snapped to candle center */}
            <div
              className="crosshair-line crosshair-vertical"
              style={{ left: crosshair.x }}
            />
            {/* Horizontal line */}
            <div
              className="crosshair-line crosshair-horizontal"
              style={{ top: crosshair.y }}
            />
            {/* Price/MCap label on right axis */}
            <div
              className="crosshair-label crosshair-price"
              style={{ top: crosshair.y, right: 4, minWidth: priceAxisWidth - 8 }}
            >
              {(() => {
                const price = crosshair.price || 0
                // Robust supply fallback (matches main chart calculation):
                // circulatingSupply → totalSupply → marketCap/price → fdv/price
                // Falls back to parent `stats` prop too — onchain API often
                // omits supply for tokens that research-zone has already merged.
                const td = liveTokenData
                const tdPrice = parseFloat(td?.price) || parseFloat(stats?.price) || 0
                const circ = parseFloat(td?.circulatingSupply)
                  || parseFloat(stats?.circulatingSupply)
                  || parseFloat(stats?.circulating)
                  || 0
                const total = parseFloat(td?.totalSupply) || parseFloat(stats?.totalSupply) || 0
                const mc = parseFloat(td?.marketCap)
                  || parseFloat(stats?.marketCap)
                  || parseFloat(stats?.mcap)
                  || 0
                const fdv = parseFloat(td?.fullyDilutedValuation)
                  || parseFloat(td?.fdv)
                  || parseFloat(stats?.fullyDilutedValuation)
                  || parseFloat(stats?.fdv)
                  || 0
                const circSupply = circ
                  || total
                  || (mc > 0 && tdPrice > 0 ? mc / tdPrice : 0)
                  || (fdv > 0 && tdPrice > 0 ? fdv / tdPrice : 0)
                if (yAxisMode === 'mcap' && circSupply > 0) {
                  const mcap = price * circSupply
                  return hookFmtLarge(mcap)
                }
                return hookFmtPrice(price)
              })()}
            </div>
            {/* Time label on bottom axis */}
            {crosshair.time && (
              <div
                className="crosshair-label crosshair-time"
                style={{ left: crosshair.x, bottom: 4 }}
              >
                {typeof crosshair.time === 'string' ? crosshair.time : crosshair.time.toLocaleString('en-US', { 
                  month: 'short', 
                  day: 'numeric',
                  hour: '2-digit', 
                  minute: '2-digit'
                })}
              </div>
            )}
            {/* OHLCV Data Tooltip - TradingView style. Hidden for line-only sources
                (CoinGecko) where O=H=L=C — replaced by the floating cursor tooltip below. */}
            {crosshair.candle && !lineOnly && (
              <div className="crosshair-ohlcv" style={{ left: 15, top: 8 }}>
                <span className="ohlcv-pair" style={{ display: responsiveControls ? 'inline-flex' : 'contents' }}><span className="ohlcv-label">O</span>
                <span className={`ohlcv-value ${crosshair.candle.close >= crosshair.candle.open ? 'bullish' : 'bearish'}`}>
                  {hookFmtPrice(crosshair.candle.open)}
                </span></span>
                <span className="ohlcv-pair" style={{ display: responsiveControls ? 'inline-flex' : 'contents' }}><span className="ohlcv-label">H</span>
                <span className={`ohlcv-value ${crosshair.candle.close >= crosshair.candle.open ? 'bullish' : 'bearish'}`}>
                  {hookFmtPrice(crosshair.candle.high)}
                </span></span>
                <span className="ohlcv-pair" style={{ display: responsiveControls ? 'inline-flex' : 'contents' }}><span className="ohlcv-label">L</span>
                <span className={`ohlcv-value ${crosshair.candle.close >= crosshair.candle.open ? 'bullish' : 'bearish'}`}>
                  {hookFmtPrice(crosshair.candle.low)}
                </span></span>
                <span className="ohlcv-pair" style={{ display: responsiveControls ? 'inline-flex' : 'contents' }}><span className="ohlcv-label">C</span>
                <span className={`ohlcv-value ${crosshair.candle.close >= crosshair.candle.open ? 'bullish' : 'bearish'}`}>
                  {hookFmtPrice(crosshair.candle.close)}
                </span></span>
                <span className="ohlcv-pair" style={{ display: responsiveControls ? 'inline-flex' : 'contents' }}><span className="ohlcv-label">Vol</span>
                <span className="ohlcv-value volume">
                  {hookFmtLarge(crosshair.candle.volume)}
                </span></span>
              </div>
            )}
            {/* Floating cursor tooltip — line-only mode (CoinGecko). Shows price,
                volume and timestamp near the cursor, clamped to the plot rect so
                it never escapes the chart edges. */}
            {crosshair.candle && lineOnly && chartDimensionsRef.current && (() => {
              const dims = chartDimensionsRef.current
              const TT_W = 168    // approx tooltip width (matches min-width + padding)
              const TT_H = 96     // approx tooltip height (time + 1-2 rows + padding)
              const GAP = 14      // distance from cursor
              const PAD = 8       // breathing room from chart edges
              const left0 = dims.chartLeft ?? 0
              const right0 = dims.chartRight ?? 0
              const top0 = dims.chartTop ?? 0
              const bottom0 = dims.chartBottom ?? 0
              // Prefer right of cursor; flip left if it would overflow.
              let x = crosshair.x + GAP
              if (x + TT_W > right0 - PAD) x = crosshair.x - GAP - TT_W
              // Clamp to the chart's horizontal bounds.
              x = Math.max(left0 + PAD, Math.min(x, right0 - TT_W - PAD))
              // Prefer below cursor; flip above if it would overflow.
              let y = crosshair.y + GAP
              if (y + TT_H > bottom0 - PAD) y = crosshair.y - GAP - TT_H
              y = Math.max(top0 + PAD, Math.min(y, bottom0 - TT_H - PAD))
              const tooltipStyle = { left: x, top: y, width: TT_W }
              const c = crosshair.candle
              const vol = parseFloat(c.volume) || 0
              const timeLabel = (() => {
                if (!crosshair.time) return ''
                if (typeof crosshair.time === 'string') return crosshair.time
                return crosshair.time.toLocaleString('en-US', {
                  month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })
              })()
              return (
                <div className="chart-cursor-tooltip" style={tooltipStyle}>
                  <div className="cursor-tooltip-time">{timeLabel}</div>
                  <div className="cursor-tooltip-row">
                    <span className="cursor-tooltip-label">Price</span>
                    <span className="cursor-tooltip-value">{hookFmtPrice(c.close)}</span>
                  </div>
                  {vol > 0 && (
                    <div className="cursor-tooltip-row">
                      <span className="cursor-tooltip-label">Volume</span>
                      <span className="cursor-tooltip-value">{hookFmtLarge(vol)}</span>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )}
        
        {/* X Chart Avatar Overlays */}
        {chartViewMode === 'xChart' && chartDimensionsRef.current && (
          <div className="x-chart-overlay">
            {xMentions.map(mention => {
              if (mention.candleIndex >= candleData.length) return null
              const { chartLeft, candleWidth, scaleY } = chartDimensionsRef.current
              const candle = candleData[mention.candleIndex]
              const x = chartLeft + mention.candleIndex * candleWidth + candleWidth / 2
              const y = scaleY(candle.close) - 40
              
              return (
                <div
                  key={mention.id}
                  className={`x-mention-avatar ${mention.sentiment} ${hoveredMention === mention.id ? 'hovered' : ''}`}
                  style={{
                    left: x,
                    top: y,
                    transform: 'translate(-50%, -50%)'
                  }}
                  onMouseEnter={() => setHoveredMention(mention.id)}
                  onMouseLeave={() => setHoveredMention(null)}
                >
                  <img src={mention.avatar} alt={mention.user} loading="lazy" decoding="async" width="32" height="32" />
                  {hoveredMention === mention.id && (
                    <div className="mention-tooltip">
                      <div className="mention-header">
                        <span className="mention-user">{mention.user}</span>
                        <span className="mention-likes">❤️ {mention.likes.toLocaleString()}</span>
                      </div>
                      <p className="mention-content">{mention.content}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        
        {/* Volume Tooltip - compact glass card, warm-white only */}
        {tooltip.visible && tooltip.data && (
          <div
            className="volume-tooltip"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: 'translate(-50%, -100%)'
            }}
            role="tooltip"
          >
            <span className="volume-tooltip-date">{formatDate(tooltip.data.date)}</span>
            <span className="volume-tooltip-row">
              <span className="volume-tooltip-label">VOL</span>
              <span className="volume-tooltip-value">{formatVolume(tooltip.data.volume)}</span>
            </span>
          </div>
        )}
          </>
        )}

        {/* TradingView highlight capture — our own overlay over TV's price pane */}
        {chartType === 'tradingview' && taMode === 'select' && tvPlot && (
          <div
            className="chart-ta-tv-capture"
            data-no-pan
            style={{ left: tvPlot.left, top: tvPlot.top, width: tvPlot.width, height: tvPlot.height }}
            onPointerDown={tvSelPointerDown}
            onPointerMove={tvSelPointerMove}
            onPointerUp={tvSelPointerUp}
            onPointerCancel={tvSelPointerUp}
          >
            {tvSel && Math.abs(tvSel.x1 - tvSel.x0) > 2 && (() => {
              const l = Math.min(tvSel.x0, tvSel.x1) - tvPlot.left
              const w = Math.abs(tvSel.x1 - tvSel.x0)
              // Same grammar as the canvas: dim outside, keep the window lit.
              return (
                <>
                  <div className="chart-ta-tv-dim" style={{ left: 0, width: Math.max(0, l) }} />
                  <div className="chart-ta-tv-dim" style={{ left: l + w, right: 0 }} />
                  <div className="chart-ta-tv-window" style={{ left: l, width: w }} />
                </>
              )
            })()}
            <span className="chart-ta-tv-hint">Drag across the candles to read that window</span>
          </div>
        )}
      </div>
      </div>

    </div>
  )
})

TradingChart.displayName = 'TradingChart'

export default memo(TradingChart)
