/**
 * TradingChart Component
 * Figma Reference: Chart with type buttons above timeframes
 * Professional candlestick chart
 * 
 * NOW WITH REAL-TIME DATA FROM CODEX API
 * TradingView mode uses Lightweight Charts library for professional charting
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Lock, CandlestickChart, LineChart as LineChartIcon, Users, TrendingUp, Activity, Maximize2, BarChart3, LayoutGrid, Waves, PenLine, ChevronDown, Minimize2 } from 'lucide-react'
import { track, Events } from '../services/analytics'
import { useChartData, prefetchChartBars, prefetchChartBarsMulti } from '../hooks/useCodexData'
import { formatLargeNumber, inferNetworkId, getDetailedTokenInfo, getPairInfo } from '../services/codexApi'

import { useSharedTokenDetails } from '../contexts/TokenDetailsContext'
// lightweight-charts is loaded ON DEMAND (55 kB gzip). The chart this file
// actually renders is TradingViewAdvanced (default) or the custom canvas one -
// neither touches this library. The ONLY live consumer left here is the Holders
// placeholder chart (chartType === 'holders'; the Types menu marks it Coming
// Soon, the "h" shortcut still reaches it), so a static import made every token
// page download a library it never ran.
// The pre-TradingViewAdvanced LW tier that used to sit below (a commented-out
// init block plus ~600 lines of effects keyed on refs that block alone assigned,
// so every one of them bailed on its first guard) was deleted with this change.
let LW = null
let lwPromise = null
const loadLightweightCharts = () => {
  if (!lwPromise) lwPromise = import('lightweight-charts').then(m => { LW = m; return m })
  return lwPromise
}
import useSpottedOrigin, { fmtSpottedMcap } from '../hooks/useSpottedOrigin'
import TradingViewAdvanced from './TradingViewAdvanced'
import { useCopyToast } from '../App'
import useSettingsStore from '../store/useSettingsStore'
import { getTokenColor } from '../utils/tokenColors'
import { resolveChartStyle } from '../lib/chartStyle'
import ChartStyleControl from './ChartStyleControl'
import ChartLoader from './ChartLoader'
import './TradingChart.css'

// Helper: hex/hsl color → {r, g, b}
const colorToRgbObj = (color) => {
  if (!color) return { r: 139, g: 92, b: 246 }
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) }
  }
  // rgb()/rgba() - the form getComputedStyle returns for an @property <color>
  // (e.g. the page's --accent channel resolves to `rgb(166, 0, 255)`, not #hex).
  if (color.startsWith('rgb')) {
    const m = color.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
    if (m) return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]) }
  }
  if (color.startsWith('hsl')) {
    const m = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/)
    if (m) {
      const h = parseInt(m[1]) / 360, s = parseInt(m[2]) / 100, l = parseInt(m[3]) / 100
      const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h * 6) % 2 - 1)), mm = l - c / 2
      let r, g, b
      if (h < 1/6) { r = c; g = x; b = 0 } else if (h < 2/6) { r = x; g = c; b = 0 } else if (h < 3/6) { r = 0; g = c; b = x }
      else if (h < 4/6) { r = 0; g = x; b = c } else if (h < 5/6) { r = x; g = 0; b = c } else { r = c; g = 0; b = x }
      return { r: Math.round((r + mm) * 255), g: Math.round((g + mm) * 255), b: Math.round((b + mm) * 255) }
    }
  }
  return { r: 139, g: 92, b: 246 }
}

// Lighten RGB by factor (0..1)
const lightenRgb = ({ r, g, b }, factor) => ({
  r: Math.min(255, Math.round(r + (255 - r) * factor)),
  g: Math.min(255, Math.round(g + (255 - g) * factor)),
  b: Math.min(255, Math.round(b + (255 - b) * factor)),
})

// Format price with appropriate decimal places
const formatTokenPrice = (price) => {
  const n = parseFloat(price)
  if (isNaN(n) || !isFinite(n)) return '0.00'
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.01) return n.toFixed(4)
  if (n >= 0.0001) return n.toFixed(6)
  return n.toFixed(8)
}

// Spectre mark for the canvas Spotted badge — module singleton, loads once.
const SPOTTED_LOGO_IMG = typeof Image !== 'undefined' ? new Image() : null
if (SPOTTED_LOGO_IMG) SPOTTED_LOGO_IMG.src = '/round-logo.png'

const TradingChart = ({ chartViewMode = 'trading', setChartViewMode, token, stats, isCollapsed = false, forceLightweight = false, alertLines = [], onAlertAtPrice }) => {
  const { triggerCopyToast } = useCopyToast()
  // Fetch real token data including circulating supply
  const { tokenData: liveTokenData } = useSharedTokenDetails()
  // Spectre "Spotted" receipt for this token (null when never spotted).
  // Keyed by cg id when the details context has one, else lowercase symbol —
  // the momentum-origin endpoint resolves both.
  // Key from liveTokenData FIRST: in embedded mode the token prop keeps the
  // boot default's symbol until a parent sync, while the details context
  // tracks the actually-loaded token — keying off the prop drew SPECTRE's
  // receipt on CASHCAT's chart (the frankendata class).
  const { spotted } = useSpottedOrigin({
    cgId: liveTokenData?.cgId || liveTokenData?.coingeckoId || token?.cgId,
    symbol: liveTokenData?.symbol || token?.symbol,
    address: token?.address,
  })
  const spottedRef = useRef(null)
  spottedRef.current = spotted
  // Day mode follows the RENDERED page theme (body.theme-light), not the
  // store's synced dayMode flag. The two can disagree: profile sync pulls
  // dayMode from the server (e.g. day mode used in the research app) while
  // the trading page theme is owned by Header's colorMode / the iframe
  // spectre:set-theme message - and then the chart painted light on a dark
  // terminal (or dark inside a day-mode research iframe). Observing the
  // body class keeps chart and page in lockstep across all three theme
  // write paths (header toggle, ?theme= param, parent postMessage).
  const [dayMode, setDayModeLocal] = useState(() =>
    typeof document !== 'undefined' && document.body.classList.contains('theme-light')
  )
  useEffect(() => {
    const sync = () => setDayModeLocal(document.body.classList.contains('theme-light'))
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])
  // Chart style — the chart's OWN appearance channel (lib/chartStyle.js),
  // set from the toolbar ChartStyleControl. Deliberately independent from
  // skins/tones/accents: equipping a skin never restyles the chart.
  const chartStyle = useSettingsStore((s) => s.chartStyle)
  // Needed only to keep the LINE chart on the TOKEN's brand color when a
  // user accent is active (the computed --accent then carries the user
  // accent, which must not leak into the chart).
  const accentColor = useSettingsStore((s) => s.accentColor)
  // "Apply tone to chart" mark (default ON): skins / background tones
  // re-tone the chart bg. bgTone/bgDepth subscribed only to repaint on
  // tone changes while the mark is on.
  const chartFollowsTheme = useSettingsStore((s) => s.chartFollowsTheme)
  const bgTone = useSettingsStore((s) => s.bgTone)
  const bgDepth = useSettingsStore((s) => s.bgDepth)
  const canvasRef = useRef(null)
  const containerRef = useRef(null)

  // v2 Observatory: price-tick light streak (FX1). On every change to
  // liveTokenData.price, write data-tick="up"|"down" directly to the
  // chart card's DOM root via a ref, then clear after 700ms. Zero React
  // state churn — the .tick-streak-host CSS picks up the attr and runs
  // a one-shot CSS keyframe animation across the top border.
  const chartRootRef = useRef(null)
  const lastPriceRef = useRef(null)
  const tickTimeoutRef = useRef(null)
  useEffect(() => {
    const p = liveTokenData?.price
    if (!p || !chartRootRef.current) return
    const prev = lastPriceRef.current
    if (prev != null && prev !== p) {
      const dir = p > prev ? 'up' : 'down'
      chartRootRef.current.dataset.tick = dir
      if (tickTimeoutRef.current) clearTimeout(tickTimeoutRef.current)
      tickTimeoutRef.current = setTimeout(() => {
        if (chartRootRef.current) delete chartRootRef.current.dataset.tick
      }, 720)
    }
    lastPriceRef.current = p
  }, [liveTokenData?.price])
  useEffect(() => () => { if (tickTimeoutRef.current) clearTimeout(tickTimeoutRef.current) }, [])
  
  // Top pair address for the authoritative live-bar stream (Codex onBarsUpdated
  // keys on the PAIR contract, not the token). `/api/token/details` always
  // returns topPairAddress server-side, but the client detail branches are
  // inconsistent (the CoinGecko-major branch hardcodes null), so resolve it
  // here from the module-cached getDetailedTokenInfo — a free cache hit on any
  // token whose details are already loaded. Prefer liveTokenData when present.
  const [resolvedPairAddress, setResolvedPairAddress] = useState(null)
  useEffect(() => {
    const addr = token?.address
    if (!addr) { setResolvedPairAddress(null); return }
    const fromLive = liveTokenData?.topPairAddress
    if (fromLive) { setResolvedPairAddress(fromLive); return }
    let cancelled = false
    getDetailedTokenInfo(addr, inferNetworkId(addr, token?.networkId))
      .then(d => { if (!cancelled && d?.topPairAddress) setResolvedPairAddress(d.topPairAddress) })
      .catch(() => { /* no pair - chart falls back to price-synth candles */ })
    return () => { cancelled = true }
  }, [token?.address, token?.networkId, liveTokenData?.topPairAddress])

  // Which side of that pair the token sits on ('token0' | 'token1'). The
  // authoritative bar stream (Codex onBarsUpdated) is priced PER SIDE, and the
  // wrong side streams the quote token (EMBER/SOL on token1 = SOL at ~$101,
  // measured 2026-09-11). pair-info already knows the side, and it is a
  // module-cached call the Liquidity/Info surfaces make anyway - so seed the
  // stream with it and skip the guess-token1-then-flip dance. Only trusted
  // when pair-info's pool IS the resolved pair; otherwise null = old behaviour.
  const [resolvedPairSide, setResolvedPairSide] = useState(null)
  useEffect(() => {
    const addr = token?.address
    setResolvedPairSide(null)
    if (!addr || !resolvedPairAddress) return
    let cancelled = false
    getPairInfo(addr, inferNetworkId(addr, token?.networkId))
      .then((info) => {
        if (cancelled || !info?.pairAddress || !info.tokenSide) return
        const norm = (a) => (String(a).startsWith('0x') ? String(a).toLowerCase() : String(a))
        if (norm(info.pairAddress) === norm(resolvedPairAddress)) setResolvedPairSide(info.tokenSide)
      })
      .catch(() => { /* side unknown - stream validates + flips on its own */ })
    return () => { cancelled = true }
  }, [token?.address, token?.networkId, resolvedPairAddress])

  // Persist timeframe and chartType in localStorage
  const [timeframe, setTimeframeState] = useState(() => {
    const saved = localStorage.getItem('spectre-timeframe')
    // Migrate old labels: minutes are now lowercase m. Uppercase 'M' is reserved
    // for months, so '1M' is NO LONGER migrated to '1m' (it's the monthly TF now).
    const MIGRATE = { '5M': '5m', '15M': '15m', '30M': '15m' }
    return (saved && (MIGRATE[saved] || saved)) || '1H'
  })
  const [chartType, setChartTypeState] = useState(() => {
    const saved = localStorage.getItem('spectre-chartType')
    return saved || 'candles'
  })
  const [showTradingView, setShowTradingViewState] = useState(() => {
    if (forceLightweight) return false
    // TradingView is the canonical default on every viewport, mobile included -
    // it renders correctly on real devices. (The "broken on mobile" axis
    // clipping/ghosting was a Chrome DevTools device-mode rasterization
    // artifact, NOT a real-hardware bug; on an actual phone TV is crisp and
    // matches reference apps.) Candles/Line stay selectable + touch-enabled in
    // the Types menu. Reset any stale 'false' ONCE (versioned flag, bumped to
    // v2 to undo the brief mobile-Candles-default) so everyone lands back on
    // TV; a deliberate Candles pick afterward still sticks.
    const TV_DEFAULT_FLAG = 'spectre-chartDefault-tv-v2'
    if (!localStorage.getItem(TV_DEFAULT_FLAG)) {
      localStorage.setItem(TV_DEFAULT_FLAG, '1')
      localStorage.setItem('spectre-showTradingView', 'true')
      return true
    }
    const saved = localStorage.getItem('spectre-showTradingView')
    return saved === 'true' || saved === null // Default to true (TradingView) if not set
  })

  // If the parent toggles forceLightweight after mount (e.g. viewport
  // crosses 768px), flip the local state to match.
  useEffect(() => {
    if (forceLightweight && showTradingView) {
      setShowTradingViewState(false)
    }
  }, [forceLightweight, showTradingView])
  const holdersChartContainerRef = useRef(null)
  const holdersLWChartRef = useRef(null)
  const holdersSeriesRef = useRef(null)
  // "Spotted" receipt — where Spectre's momentum ledger first recorded this
  // token (timestamp + entry mcap). Drawn on the TV Advanced chart via
  // createShape (handle captured in onChartReady).
  const tvAdvChartRef = useRef(null)
  const tvSpottedShapeRef = useRef(null)
  // Alert target lines (TradingView Advanced branch) — createShape ids for
  // the active price-target rules on this token, so they can be removed
  // before the next redraw (see the effect below).
  const tvAlertShapesRef = useRef([])
  const [tvChartEpoch, setTvChartEpoch] = useState(0)

  
  // AGE-AWARE TIMEFRAME CAP (2026-07-10). A saved COARSE timeframe on a
  // young token renders as "broken/missing candles": a 5-day-old token at
  // 4H has ~30 bars TOTAL, stretched across the pane, and the log scale
  // (needed for the launch move) compresses the recent small-range bars
  // into hairline dashes (VITALIK reports). DexScreener/GMGN default young
  // tokens to fine TFs for exactly this reason - their charts always look
  // dense. On token switch, cap the ACTIVE timeframe to the coarsest one
  // that still yields >= ~72 bars of token life. Only ever downshifts
  // (finer), never coarsens a saved fine TF; the SAVED preference is
  // untouched (no localStorage write) so the user's choice still applies
  // to mature tokens; a manual pick after the switch persists as always.
  const TF_AGE_LADDER = [['1m', 60], ['5m', 300], ['15m', 900], ['1H', 3600], ['4H', 14400], ['1D', 86400]]
  const MIN_LIFE_BARS = 72
  const capTimeframeForAge = (tf, ageSec) => {
    if (!ageSec || ageSec <= 0) return tf
    const idx = TF_AGE_LADDER.findIndex(([label]) => label === tf)
    if (idx < 0) return tf // 12H/1W/custom labels - leave alone
    let best = TF_AGE_LADDER[0][0]
    for (const [label, sec] of TF_AGE_LADDER) {
      if (ageSec / sec >= MIN_LIFE_BARS) best = label
      else break
    }
    const bestIdx = TF_AGE_LADDER.findIndex(([label]) => label === best)
    return bestIdx < idx ? best : tf
  }
  const tfCapAppliedRef = useRef(null)
  useEffect(() => {
    const addr = token?.address
    if (!addr || tfCapAppliedRef.current === addr) return
    const apply = (createdAt) => {
      if (!createdAt || tfCapAppliedRef.current === addr) return
      tfCapAppliedRef.current = addr
      const ageSec = Math.floor(Date.now() / 1000) - createdAt
      setTimeframeState(prev => capTimeframeForAge(prev, ageSec))
    }
    // Reactive path: token rows (trending/discovery clicks) and the details
    // hook (now that the normalisers preserve createdAt) - re-runs when
    // details land ~1s after a cold load.
    const known = Number(token?.createdAt) || Number(liveTokenData?.createdAt) || 0
    if (known) { apply(known); return }
    // Fallback: raw service payload (module-cached + deduped). A shared
    // in-flight promise can reject with another caller's AbortError during
    // the boot fan-out, so retry twice on a short backoff - by the second
    // attempt the details are a warm cache hit.
    let cancelled = false
    const tryFetch = (attempt) => {
      getDetailedTokenInfo(addr, inferNetworkId(addr, token?.networkId))
        .then(d => {
          if (cancelled) return
          const got = Number(d?.createdAt) || 0
          if (got) apply(got)
          else if (attempt < 2) setTimeout(() => { if (!cancelled) tryFetch(attempt + 1) }, 1500)
        })
        .catch(() => {
          if (!cancelled && attempt < 2) setTimeout(() => { if (!cancelled) tryFetch(attempt + 1) }, 1500)
        })
    }
    tryFetch(0)
    return () => { cancelled = true }
  }, [token?.address, token?.createdAt, liveTokenData?.createdAt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Wrapper functions to save to localStorage
  const setTimeframe = (tf) => {
    track(Events.CHART_INTERACTION, { action: 'timeframe_changed', value: tf })
    setTimeframeState(tf)
    localStorage.setItem('spectre-timeframe', tf)
  }
  const setChartType = (type) => {
    track(Events.CHART_INTERACTION, { action: 'type_changed', value: type })
    setChartTypeState(type)
    localStorage.setItem('spectre-chartType', type)
  }
  const setShowTradingView = (value) => {
    setShowTradingViewState(value)
    localStorage.setItem('spectre-showTradingView', value.toString())
    // Re-selecting TV must give it a FRESH attempt: a prior cold-load failure
    // latches tvNoData=true (falls back to Candles). Without this, picking TV
    // again kept showing Candles because effectiveShowTV stayed false.
    if (value) setTvNoData(false)
  }
  const [heatmapEnabled, setHeatmapEnabled] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  // GMGN-parity default: memecoin terminals (GMGN/Axiom/Photon) chart MARKET
  // CAP by default - traders think in MC. Falls back to price rendering
  // automatically wherever circSupply is unknown (every consumer guards
  // useMCap on circSupply > 0). The user's explicit toggle choice persists.
  const [yAxisMode, setYAxisModeState] = useState(() => {
    try {
      // 2026-09-11 (Gleb): MCap is the default for everyone, so a 'price'
      // stored before this date is dropped ONCE (marker below); toggles made
      // after it persist exactly as before.
      if (localStorage.getItem('spectre-yaxis-mode-mcap-default') !== '1') {
        localStorage.setItem('spectre-yaxis-mode-mcap-default', '1')
        localStorage.removeItem('spectre-yaxis-mode')
      }
      return localStorage.getItem('spectre-yaxis-mode') || 'mcap'
    } catch { return 'mcap' }
  })
  const setYAxisMode = (mode) => {
    setYAxisModeState(mode)
    try { localStorage.setItem('spectre-yaxis-mode', mode) } catch { /* private mode */ }
  }

  const [showATHLines, setShowATHLines] = useState(false) // Show ATH and local ATH lines
  const [showVWAP, setShowVWAP] = useState(() => {
    const saved = localStorage.getItem('spectre-showVWAP')
    return saved === 'true'
  })
  const [tvChartReady, setTvChartReady] = useState(false)
  // TradingView Advanced reported no data (or failed to build) for this token.
  // While true, force the lightweight-charts (canvas/LWC) render path so the
  // user still gets a chart instead of a blank pane. Reset on token change so
  // the next token gets a fresh TVA attempt.
  const [tvNoData, setTvNoData] = useState(false)
  // Show shimmer until chart is ready or 8s timeout (whichever comes first)
  const [chartShimmerVisible, setChartShimmerVisible] = useState(true)
  useEffect(() => {
    setChartShimmerVisible(true)
    // New token - give TradingView Advanced a fresh attempt before falling
    // back to the lightweight view.
    setTvNoData(false)
    const timer = setTimeout(() => setChartShimmerVisible(false), 8000)
    return () => clearTimeout(timer)
  }, [token?.address, token?.symbol])
  const [buttonTooltip, setButtonTooltip] = useState({ visible: false, text: '', x: 0, y: 0 })
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, data: null })
  const [crosshair, setCrosshair] = useState({ visible: false, x: 0, y: 0, price: null, time: null, candle: null, candleX: 0 })
  const [redrawTrigger, setRedrawTrigger] = useState(0)
  const [tfDropdownOpen, setTfDropdownOpen] = useState(false)
  const [tfDropdownPos, setTfDropdownPos] = useState({ top: 0, right: 0 })
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1400)
  const chartDimensionsRef = useRef(null)
  // Canvas hover (crosshair + volume tooltip) is rAF-coalesced - see applyHoverAt.
  const hoverFrameRef = useRef(null)
  const hoverPosRef = useRef(null)
  useEffect(() => () => {
    if (hoverFrameRef.current !== null) cancelAnimationFrame(hoverFrameRef.current)
  }, [])
  const tfDropdownBtnRef = useRef(null)
  // Overflow dropdowns: when the chart column narrows (both side panels open),
  // the locked "Coming Soon" type placeholders + tools collapse into these
  // "Types"/"Tools" menus instead of overlapping. Triggers are CSS-hidden until
  // their container-query breakpoint (see .chart-types-more / .chart-tools-more).
  const [typesMoreOpen, setTypesMoreOpen] = useState(false)
  const [toolsMoreOpen, setToolsMoreOpen] = useState(false)
  const typesMoreRef = useRef(null)
  const toolsMoreRef = useRef(null)

  // Close the overflow menus on any outside click.
  useEffect(() => {
    if (!typesMoreOpen && !toolsMoreOpen) return
    const onDown = (e) => {
      if (typesMoreRef.current && !typesMoreRef.current.contains(e.target)) setTypesMoreOpen(false)
      if (toolsMoreRef.current && !toolsMoreRef.current.contains(e.target)) setToolsMoreOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [typesMoreOpen, toolsMoreOpen])
  const [hoveredMention, setHoveredMention] = useState(null)

  // OHLCV legend - persistent data overlay
  const [ohlcvLegend, setOhlcvLegend] = useState(null)
  
  // Resizable chart height — persisted to localStorage
  const [chartHeight, setChartHeight] = useState(() => {
    try {
      const saved = localStorage.getItem('spectre-chart-height')
      const parsed = Number(saved)
      if (parsed >= 150 && parsed <= 800) return parsed
    } catch (e) { /* ignore */ }
    return 380
  })
  const [isResizing, setIsResizing] = useState(false)
  const chartHeightRef = useRef(chartHeight) // tracks latest for stale-closure-safe saves
  const resizeStartY = useRef(0)
  const resizeStartHeight = useRef(0)
  
  // Zoom and axis scaling - DexTools-like behavior
  // Default zoom shows ~100 candles (DexTools style - see more data, thinner candles)
  const [zoomLevel, setZoomLevel] = useState(() => {
    // Calculate initial zoom to show ~100 candles - DexTools style
    return Math.max(1, Math.ceil(1441 / 100)) // ~14x zoom for 1441 bars
  })
  const [priceZoom, setPriceZoom] = useState(1) // 1 = 100% (vertical/price zoom)
  const [tvResetNonce, setTvResetNonce] = useState(0) // bump to reset/fit the TV widget zoom
  const [tvDrawNonce, setTvDrawNonce] = useState(0) // bump to toggle the TV drawing rail (default-collapsed)
  const [tvZoomed, setTvZoomed] = useState(false) // user zoomed/panned the TV chart -> show Fit
  const fitZoomRef = useRef(null) // canvas: default zoomLevel, so Fit shows only once deviated
  const [autoFitPrice, setAutoFitPrice] = useState(true) // Auto-fit price to visible candles
  const [priceAxisWidth] = useState(75) // Slightly wider price axis for readability
  const [timeAxisHeight] = useState(50) // Reduced time axis for more chart space
  const [isDraggingPriceAxis, setIsDraggingPriceAxis] = useState(false)
  const [isDraggingTimeAxis, setIsDraggingTimeAxis] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, value: 0 })
  
  // Chart panning (horizontal + vertical scroll) with momentum - TradingView style
  const [panOffset, setPanOffset] = useState(0) // Horizontal offset in candles (positive = looking at older data)
  const [priceOffset, setPriceOffset] = useState(0) // Vertical offset as percentage of price range
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef({ x: 0, y: 0, offset: 0, priceOff: 0 })
  const panVelocityRef = useRef({ x: 0, y: 0 }) // Momentum velocity (x and y)
  const lastPanXRef = useRef(0) // Last pan position for velocity calculation
  const lastPanYRef = useRef(0) // Last pan Y position
  const lastPanTimeRef = useRef(0) // Last pan time
  const momentumAnimationRef = useRef(null) // Animation frame for momentum
  // Touch (mobile): track active gesture + initial pinch state.
  // touchModeRef = 'pan' | 'pinch' | null. pinchStartRef holds the finger
  // distance + zoom snapshot taken when the 2nd finger lands.
  const touchModeRef = useRef(null)
  const pinchStartRef = useRef({ dist: 0, zoom: 1, priceZoom: 1, vertical: false })

  // Long-press-to-create-alert (mobile canvas engine only). A ref mirror of
  // the onAlertAtPrice prop so the native touch handlers (useCallback, see
  // below) don't need it in their dep arrays - the caller passes an inline
  // arrow (new identity every render), and depending on it directly would
  // re-bind the native touchstart/move/end listener set (the effect at the
  // touch-binding useEffect below) on every parent re-render.
  const onAlertAtPriceRef = useRef(onAlertAtPrice)
  useEffect(() => { onAlertAtPriceRef.current = onAlertAtPrice }, [onAlertAtPrice])
  const longPressTimerRef = useRef(null)
  const longPressStartRef = useRef({ x: 0, y: 0 })
  const longPressFiredRef = useRef(false)
  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

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
    { value: 'all', label: 'All time', ms: null },
    { value: '5m', label: 'Last 5 minutes', ms: 5 * 60 * 1000 },
    { value: '30m', label: 'Last 30 minutes', ms: 30 * 60 * 1000 },
    { value: '1h', label: 'Last 1 hour', ms: 60 * 60 * 1000 },
    { value: '6h', label: 'Last 6 hours', ms: 6 * 60 * 60 * 1000 },
    { value: '24h', label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
    { value: '1w', label: 'Last 1 week', ms: 7 * 24 * 60 * 60 * 1000 },
    { value: '1M', label: 'Last 1 month', ms: 30 * 24 * 60 * 60 * 1000 },
    { value: '3M', label: 'Last 3 month', ms: 90 * 24 * 60 * 60 * 1000 },
    { value: '6M', label: 'Last 6 month', ms: 180 * 24 * 60 * 60 * 1000 },
    { value: '1y', label: 'Last 1 year', ms: 365 * 24 * 60 * 60 * 1000 },
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
        const timeOption = timeFilterOptions.find(t => t.value === timeFilter)
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
  const [viewMode, setViewMode] = useState('2D') // '2D' or '3D'
  
  // Bubbles zoom - separate from chart zoom
  const [bubblesZoom, setBubblesZoom] = useState(0.6) // Start zoomed out to show more bubbles
  
  // 2D Pan state - for moving around the bubble space
  const [bubblesPan, setBubblesPan] = useState({ x: 0, y: 0 })
  const [isBubblesPanning, setIsBubblesPanning] = useState(false)
  const bubblesPanStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const bubblesPanAnimationRef = useRef(null)
  const bubblesPanCurrentRef = useRef({ x: 0, y: 0 })

  // Handle pan end - defined early for accessibility
  const handleBubblesPanEnd = useCallback(() => {
    setIsBubblesPanning(false)
    // Final update to ensure state matches ref
    setBubblesPan({
      x: bubblesPanCurrentRef.current.x,
      y: bubblesPanCurrentRef.current.y
    })
  }, [])
  
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
      // Pause the physics setState loop while backgrounded - re-arm only.
      if (document.hidden) {
        animationRef.current = requestAnimationFrame(simulate)
        return
      }
      setBubblePhysics(prev => {
        const newState = prev.map(bubble => {
          // If being dragged, follow mouse with smooth easing
          if (draggingBubble === bubble.id) {
            // Account for pan offset - mouse is in container coords, bubble is in zoom area coords
            const targetX = mousePos.current.x - dragOffset.x - bubblesPan.x
            const targetY = mousePos.current.y - dragOffset.y - bubblesPan.y
            
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
    // Calculate mouse position as % of container
    const mouseX = ((e.clientX - rect.left) / rect.width) * 100
    const mouseY = ((e.clientY - rect.top) / rect.height) * 100
    
    // Account for pan offset - bubble position is relative to zoom area, mouse is relative to container
    // Visual position = bubble.x + pan.x, so dragOffset = mouseX - (bubble.x + pan.x)
    const visualBubbleX = bubble.x + bubblesPan.x
    const visualBubbleY = bubble.y + bubblesPan.y
    
    mousePos.current = { x: mouseX, y: mouseY }
    setDraggingBubble(bubbleId)
    setDragOffset({ x: mouseX - visualBubbleX, y: mouseY - visualBubbleY })
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

  // Handle 2D panning (moving the space around) - smooth version
  const handleBubblesPanStart = (e) => {
    // Only pan in 2D mode and when not dragging a bubble
    if (viewMode !== '2D' || draggingBubble !== null || chartViewMode !== 'xBubbles') return
    
    // Check if clicking on a bubble (don't pan if clicking on bubble)
    const target = e.target
    if (target.closest('.kol-bubble')) return
    
    e.preventDefault()
    e.stopPropagation()
    
    // Cancel any ongoing animation
    if (bubblesPanAnimationRef.current) {
      cancelAnimationFrame(bubblesPanAnimationRef.current)
      bubblesPanAnimationRef.current = null
    }
    
    setIsBubblesPanning(true)
    bubblesPanStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: bubblesPan.x,
      panY: bubblesPan.y
    }
    bubblesPanCurrentRef.current = { x: bubblesPan.x, y: bubblesPan.y }
  }

  // Smooth pan animation loop
  useEffect(() => {
    if (isBubblesPanning && viewMode === '2D') {
      const animate = () => {
        setBubblesPan({
          x: bubblesPanCurrentRef.current.x,
          y: bubblesPanCurrentRef.current.y
        })
        bubblesPanAnimationRef.current = requestAnimationFrame(animate)
      }
      bubblesPanAnimationRef.current = requestAnimationFrame(animate)
      
      return () => {
        if (bubblesPanAnimationRef.current) {
          cancelAnimationFrame(bubblesPanAnimationRef.current)
          bubblesPanAnimationRef.current = null
        }
      }
    }
  }, [isBubblesPanning, viewMode])

  // Global pan listeners - update ref smoothly
  useEffect(() => {
    if (isBubblesPanning && viewMode === '2D') {
      const handleMove = (e) => {
        if (!isBubblesPanning || viewMode !== '2D') return
        
        const deltaX = e.clientX - bubblesPanStartRef.current.x
        const deltaY = e.clientY - bubblesPanStartRef.current.y
        
        if (bubblesContainerRef.current) {
          const rect = bubblesContainerRef.current.getBoundingClientRect()
          // Convert pixel movement to percentage (pan is in % of container)
          // Divide by zoom to maintain consistent pan speed regardless of zoom level
          const panXPercent = (deltaX / rect.width) * 100 / bubblesZoom
          const panYPercent = (deltaY / rect.height) * 100 / bubblesZoom
          
          // Update ref directly for smooth animation
          bubblesPanCurrentRef.current = {
            x: bubblesPanStartRef.current.panX + panXPercent,
            y: bubblesPanStartRef.current.panY + panYPercent
          }
        }
      }
      
      const handleEnd = () => handleBubblesPanEnd()
      
      window.addEventListener('mousemove', handleMove, { passive: true })
      window.addEventListener('mouseup', handleEnd)
      window.addEventListener('mouseleave', handleEnd)
      
      return () => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleEnd)
        window.removeEventListener('mouseleave', handleEnd)
      }
    }
  }, [isBubblesPanning, viewMode, bubblesZoom])

  // Handle window resize for responsive timeframe selector - only setState on breakpoint change
  useEffect(() => {
    const handleResize = () => {
      const nowMobile = window.innerWidth < 1400
      setIsMobile(prev => prev === nowMobile ? prev : nowMobile)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Handle chart resize drag — uses direct DOM manipulation during drag to avoid
  // React re-render overhead and iframe pointer-event interference.
  // Only commits final height to React state on mouseup.
  const handleResizeStart = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()

    const startY = e.clientY
    const startHeight = chartHeightRef.current
    const chartArea = document.querySelector('.chart-content-area')
    const overlay = document.createElement('div')

    // Full-viewport transparent overlay blocks ALL elements (including iframes) from stealing events
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;cursor:ns-resize;'
    document.body.appendChild(overlay)
    document.body.style.userSelect = 'none'
    document.querySelector('.app')?.classList.add('resize-dragging')
    setIsResizing(true)

    const onMove = (ev) => {
      ev.preventDefault()
      const deltaY = ev.clientY - startY
      const h = Math.max(150, Math.min(800, startHeight + deltaY))
      chartHeightRef.current = h
      // Direct DOM update - no React re-render during drag
      if (chartArea) chartArea.style.height = h + 'px'
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseup', onUp, true)
      overlay.remove()
      document.body.style.userSelect = ''
      document.querySelector('.app')?.classList.remove('resize-dragging')
      // Commit final height to React state (single re-render)
      setChartHeight(chartHeightRef.current)
      setIsResizing(false)
      try { localStorage.setItem('spectre-chart-height', String(chartHeightRef.current)) } catch (ex) { /* ignore */ }
    }

    // Capture phase listeners - guaranteed to fire before any iframe can intercept
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseup', onUp, true)
  }, [])

  // Handle keyboard navigation for 3D mode + ESC for fullscreen
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!e || typeof e.key !== 'string') return
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
      // Synthetic KeyboardEvents (e.g. from the Privy modal) can carry no
      // key - crashing here tears down the whole chart error boundary.
      if (!e || typeof e.key !== 'string') return
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
    if (chartViewMode !== 'xBubbles') return
    
    e.preventDefault()
    e.stopPropagation()
    
    if (viewMode === '3D') {
      // 3D mode: adjust camera Z position
      setCamera(prev => {
        let z = prev.z + e.deltaY * 1.5
        z = Math.max(-500, Math.min(2000, z))
        return { ...prev, z }
      })
    } else {
      // 2D mode: adjust bubbles zoom
      setBubblesZoom(prev => {
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
        const newZoom = prev * zoomFactor
        return Math.max(0.2, Math.min(2.0, newZoom))
      })
    }
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

  // Force redraw after fullscreen transition
  useEffect(() => {
    // Immediate redraw
    setRedrawTrigger(prev => prev + 1)
    
    // Delayed redraw for CSS transition
    const timer = setTimeout(() => {
      setRedrawTrigger(prev => prev + 1)
    }, 100)
    
    return () => clearTimeout(timer)
  }, [isFullscreen])

  // First 6 render as inline buttons; the rest live in the "More" dropdown.
  // 1D is promoted to the visible row; 12H + 1M (monthly) sit in the dropdown.
  const timeframes = ['1m', '5m', '15m', '1H', '4H', '1D', '12H', '1W', '1M', 'All']
  const chartTypes = [
    { id: 'candles', label: 'Candles' },
    { id: 'line', label: 'Line' },
    { id: 'holders', label: 'Holders' },
    { id: 'x', label: '𝕏' },
  ]

  // Map timeframe to Codex resolution
  const timeframeToResolution = {
    '1m': '1',
    '5m': '5',
    '15m': '15',
    '1H': '60',
    '4H': '240',
    '12H': '720',
    '1D': '1D',
    '1W': '1W',
    '1M': '1M', // monthly - datafeed aggregates daily → calendar months
    'All': '1D', // full history rendered as daily candles
  }

  // Map timeframe to hours of data to fetch
  // API has a 1500 datapoint limit per request, so we stay under that
  // Lazy loading will fetch more history when user scrolls left
  const timeframeToPeriod = {
    '1m': 24,       // 1 day (~1440 candles) - max safe is ~25 hours
    '5m': 115,      // ~4.8 days (~1380 candles) - max safe is ~125 hours
    '15m': 350,     // ~14.5 days (~1400 candles) - max safe is ~375 hours
    '1H': 1400,     // ~58 days (~1400 candles) - max safe is ~1500 hours
    '4H': 5600,     // ~233 days (~1400 candles) - max safe is ~6000 hours
    '12H': 16800,   // ~700 days (~1400 candles)
    '1D': 33600,    // ~3.8 years (~1400 candles) - max safe is ~36000 hours
    '1W': 235200,   // ~27 years (~1400 candles) - essentially all history
    '1M': 235200,   // monthly: pull the full daily span, aggregate to months
    'All': 235200,  // full history (daily); getBars clamps the span to 3y
  }
  
  // Get address for chart data. ADDRESS-FIRST (2026-06-11 post-audit revert
  // of the ticker-first rule): the address is the unambiguous identity - a
  // DEX token whose symbol collides with a Binance ticker was charted as the
  // Binance asset. The server's registry reverse-map routes address-form
  // majors to Binance klines anyway; ticker only for address-less assets.
  const chartSymbol = token?.address || token?.symbol || 'SPECTRE'
  const chartNetworkId = inferNetworkId(token?.address, token?.networkId)

  // The line chart tints itself from the page's resolved --accent channel, which
  // useAccentTheme fills ASYNCHRONOUSLY (curated -> server KV -> canvas extraction).
  // The draw effect can't depend on a CSS var, so nudge a couple of repaints shortly
  // after the token changes to pick up the resolved brand colour (e.g. PAAL purple)
  // without waiting for the next price tick. Canvas mode only (TV has its own chart).
  useEffect(() => {
    if (showTradingView) return
    const t1 = setTimeout(() => setRedrawTrigger(p => p + 1), 450)
    const t2 = setTimeout(() => setRedrawTrigger(p => p + 1), 1400)
    return () => { clearTimeout(t1); clearTimeout(t2) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token?.address, token?.symbol, showTradingView])

  // Effective TV-vs-lightweight decision. When TradingView Advanced reports
  // no data (tvNoData), we fall back to the lightweight (canvas) chart even if
  // the user's saved preference is TV. The raw `showTradingView` still drives
  // the toggle button's active state + localStorage; `effectiveShowTV` drives
  // what actually renders + which data pipeline runs.
  const effectiveShowTV = showTradingView && !tvNoData

  // ── Codex-only Trading Platform: the multi-resolution fan-out that used to
  //    background-warm cheap-tier resolutions here is REMOVED. Under Codex-only
  //    every warmed resolution would bill metered Codex on a token the user only
  //    glanced at. Instead the TVA datafeed fetches just the visible timeframe
  //    and its client-side aggregation derives coarser timeframes for free; a
  //    switch to a non-derivable finer resolution fetches on demand (one Codex
  //    call). The single click-time prefetchChartBars on the TF buttons below
  //    still overlaps the next view's fetch with the click.

  // Fetch chart data from Codex - skip when TV chart is active (TV has its own datafeed)
  const { bars: liveBars, loading: chartLoading, loadingMore, hasMoreHistory, fetchMoreHistory, athPrice: trueATH } = useChartData(
    effectiveShowTV ? null : chartSymbol,
    timeframeToResolution[timeframe] || '60',
    chartNetworkId,
    timeframeToPeriod[timeframe] || 168
  )

  // Spotted receipt, TradingView Advanced branch. Uses an EXECUTION shape —
  // TV's native trade-arrow primitive — which anchors to the bar at a
  // timestamp with no price coordinate needed, so it always sits on the
  // visible scale (price-anchored createShape drew below the auto-scaled
  // range whenever the token ran hard after the spot, and returns undefined
  // when called before the widget has data). Drawn immediately AND on the
  // widget's onDataLoaded so whichever happens last wins.
  useEffect(() => {
    const chart = tvAdvChartRef.current
    if (!chart) return undefined
    let disposed = false

    const clear = () => {
      const prev = tvSpottedShapeRef.current
      tvSpottedShapeRef.current = null
      if (!prev) return
      try { typeof prev.remove === 'function' ? prev.remove() : chart.removeEntity(prev) } catch { /* widget rebuilt */ }
    }

    if (!spotted?.first_entered_at || !(Number(spotted.entry_market_cap) > 0)) {
      clear()
      return undefined
    }
    const entryMc = Number(spotted.entry_market_cap)
    const spTime = Math.floor(new Date(spotted.first_entered_at).getTime() / 1000)
    const label = `Spotted ${fmtSpottedMcap(entryMc)}`
    const color = dayMode ? '#0F172A' : '#F5F5F7'

    const draw = () => {
      if (disposed) return
      clear()
      try {
        const exec = chart.createExecutionShape()
        exec.setText(label)
          .setTime(spTime)
          .setDirection('buy')
          .setArrowColor(color)
          .setTextColor(color)
          .setArrowHeight(12)
          .setArrowSpacing(8)
        tvSpottedShapeRef.current = exec
      } catch { /* decoration only — never break the chart */ }
    }

    draw()
    let sub = null
    try {
      sub = chart.onDataLoaded()
      sub.subscribe(null, draw, true) // one-shot: redraw once real bars land
    } catch { /* older widget API — the immediate draw stands */ }

    return () => {
      disposed = true
      try { sub?.unsubscribeAll?.(null) } catch { /* noop */ }
    }
  }, [spotted, tvChartEpoch, dayMode])

  // Alert target lines, TradingView Advanced branch. Price-anchored
  // horizontal_line shapes (one per active rule on this token) - locked,
  // unselectable, not saved into the widget's own drawing storage. Removes
  // all previous shape ids before drawing the current set, same lifecycle
  // as the Spotted-receipt effect above. Every createShape/removeEntity
  // call is wrapped - the widget can be mid-teardown (chart swap, unmount).
  useEffect(() => {
    const chart = tvAdvChartRef.current
    if (!chart) return undefined

    const clearAll = () => {
      const prev = tvAlertShapesRef.current
      tvAlertShapesRef.current = []
      for (const id of prev) {
        try { chart.removeEntity(id) } catch { /* widget rebuilt */ }
      }
    }

    clearAll()
    if (!alertLines.length) return undefined

    const ids = []
    for (const line of alertLines) {
      if (!(line.price > 0)) continue
      try {
        const id = chart.createShape(
          { price: line.price },
          {
            shape: 'horizontal_line',
            lock: true,
            disableSelection: true,
            disableSave: true,
            overrides: {
              linecolor: '#8a8a8f',
              linestyle: 2,
              linewidth: 1,
              showLabel: true,
              text: 'ALERT',
              textcolor: '#8a8a8f',
              horzLabelsAlign: 'right',
            },
          }
        )
        if (id) ids.push(id)
      } catch { /* decoration only — never break the chart */ }
    }
    tvAlertShapesRef.current = ids

    return () => { clearAll() }
  }, [alertLines, tvChartEpoch])

  // Mirror scroll-back state into refs so handlePanMove (a useCallback that
  // intentionally does NOT depend on these, to avoid re-attaching window drag
  // listeners on every bars tick) reads FRESH values. Without this, a genesis
  // latch that doesn't change candleData.length leaves a stale closure that
  // re-fires fetchMoreHistory every cooldown (and re-hits the network).
  const hasMoreHistoryRef = useRef(hasMoreHistory)
  const loadingMoreRef = useRef(loadingMore)
  const fetchMoreHistoryRef = useRef(fetchMoreHistory)
  hasMoreHistoryRef.current = hasMoreHistory
  loadingMoreRef.current = loadingMore
  fetchMoreHistoryRef.current = fetchMoreHistory

  const [candleData, setCandleData] = useState([])

  // Stall guard (2026-06-14): the loading overlay below gates ONLY on
  // candleData.length === 0, so a bars request that hangs or returns nothing
  // left "Fetching market data" on screen forever (the "sometimes never loads"
  // report - a slow GeckoTerminal cascade past the user's patience). Flip to a
  // quiet empty state after a budget so the chart never sticks. Resets on every
  // token / timeframe change and clears the instant bars arrive.
  const [chartStalled, setChartStalled] = useState(false)
  useEffect(() => {
    if (candleData.length > 0) { setChartStalled(false); return }
    setChartStalled(false)
    // 18s budget: covers the hook's cold-fetch retry (a slow GeckoTerminal /
    // onchain cascade times out the first 12s attempt, then the warm retry
    // lands ~2-4s later) so the empty state never flashes before recovery.
    const t = setTimeout(() => setChartStalled(true), 18000)
    return () => clearTimeout(t)
  }, [chartSymbol, timeframe, candleData.length])

  // Track previous timeframe and symbol to detect actual changes vs lazy loading
  const prevTimeframeRef = useRef(timeframe)
  const prevSymbolRef = useRef(chartSymbol)
  const initialLoadDoneRef = useRef(false)
  
  // Track lazy loading state to prevent cascade fetches
  const lastFetchTimeRef = useRef(0)
  const initialDataLoadedRef = useRef(false)
  
  // Track which symbol the current candleData belongs to
  const candleDataSymbolRef = useRef(chartSymbol)

  // Update candle data when timeframe, token, or live data changes
  useEffect(() => {
    // Detect if this is a timeframe/symbol change vs lazy loading more data
    const isTimeframeChange = prevTimeframeRef.current !== timeframe
    const isSymbolChange = prevSymbolRef.current !== chartSymbol
    const isActualChange = isTimeframeChange || isSymbolChange || !initialLoadDoneRef.current

    // Clear stale data immediately on token switch so TV widget doesn't get old bars
    if (isSymbolChange) {
      setCandleData([])
      candleDataSymbolRef.current = chartSymbol
    }

    // Update refs
    prevTimeframeRef.current = timeframe
    prevSymbolRef.current = chartSymbol
    
    // Use live data if available and has sufficient data points
    if (liveBars && liveBars.length > 10) {
      const formattedBars = liveBars.map(bar => ({
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: typeof bar.volume === 'number' ? bar.volume : 0,
        date: new Date(bar.time)
      }))
      setCandleData(formattedBars)
      
      // Only reset zoom and pan when timeframe or symbol actually changes
      // NOT when lazy loading adds more historical data
      if (isActualChange) {
        // 'All' fits the ENTIRE loaded history (zoomLevel=1). Every other
        // timeframe opens at ~70 candles; the user zooms out for more.
        const targetVisible = 70
        const optimalZoom = timeframe === 'All'
          ? 1
          : Math.max(1, Math.ceil(formattedBars.length / targetVisible))
        fitZoomRef.current = optimalZoom // canvas default - Fit appears only when zoomLevel leaves this
        setZoomLevel(optimalZoom)
        setPanOffset(0) // Reset pan position to show latest data
        setPriceOffset(0) // Reset vertical pan
        setAutoFitPrice(true) // Re-enable auto price fitting
        initialLoadDoneRef.current = true
        
        // Only reset lazy loading flags for ACTUAL user-triggered timeframe/symbol changes
        // NOT for initial page load - this prevents double fetching on startup
        if (isTimeframeChange || isSymbolChange) {
          initialDataLoadedRef.current = false
          lastFetchTimeRef.current = 0
        }
      }
    } else {
      // No data available - keep empty state (will show loading)
    }
  }, [timeframe, liveBars, chartSymbol])

  // ── Canvas-mode timeframe warm (2026-07-23) ────────────────────────────────
  // TVA background-warms the visible TF row (warmTimeframes) so switches are
  // instant - but the CANVAS charts (Candles/Line, incl. the tvNoData fallback)
  // had no equivalent: every TF click paid a cold ~0.6-2.7s fetch unless the
  // mouse happened to dwell on the pill (hover prefetch). Warm the same visible
  // row once per symbol AFTER real candles paint, via the (previously orphaned)
  // prefetchChartBarsMulti - serial 250ms pacing, visibility/idle-gated,
  // TTL-deduped, writes the -countback keys useChartData's cache lookup reads,
  // so a switch paints from memory. Gated on candleData.length > 0 so sparse/
  // no-data tokens never trigger a fan-out of billed-empty Codex queries.
  // Spend parity: canvas and TVA are mutually exclusive surfaces, so a token
  // open costs the same ~5 warm fetches whichever chart engine is active.
  //
  // COLD-BOOT HOLD-OFF (2026-08-04) - twin of TradingViewAdvanced's
  // scheduleWarmOnce guard. "After real candles paint" is NOT late enough on a
  // cold boot: the chart paints ~1s in while the deep-fill, the tail
  // revalidation and the details/trades calls are still in flight, and the
  // browser's 6-connection cap then queues first-paint work behind 5 warm
  // fetches for resolutions nobody is looking at. Hold the FIRST pass until the
  // page is past its first-paint window; later token switches see
  // performance.now() past the mark and fire immediately, so TF switches stay
  // instant for every open after the boot.
  const CANVAS_WARM_BOOT_HOLDOFF_MS = 4000
  const canvasWarmRef = useRef({ symbol: '', cancel: null })
  useEffect(() => {
    if (effectiveShowTV || chartType === 'holders' || chartType === 'x') return undefined
    if (!chartSymbol || candleData.length === 0) return undefined
    if (canvasWarmRef.current.symbol === chartSymbol) return undefined
    canvasWarmRef.current.cancel?.()
    const active = timeframeToResolution[timeframe] || '60'
    const rest = ['1', '5', '15', '60', '240', '1D'].filter(r => r !== active)
    const holdOff = Math.max(0, CANVAS_WARM_BOOT_HOLDOFF_MS - performance.now())
    let cancelled = false
    let started = null
    const holdTimer = setTimeout(() => {
      if (cancelled) return
      started = prefetchChartBarsMulti(chartSymbol, chartNetworkId, rest)
    }, holdOff)
    canvasWarmRef.current = {
      symbol: chartSymbol,
      cancel: () => { cancelled = true; clearTimeout(holdTimer); started?.() },
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveShowTV, chartType, chartSymbol, chartNetworkId, candleData.length > 0])
  // Cancel any pending canvas warm on unmount (token switches re-key above).
  useEffect(() => () => { canvasWarmRef.current.cancel?.() }, [])

  // Holders chart - placeholder (Codex doesn't provide holder data yet)
  const holdersChartActive = chartType === 'holders' && !showTradingView
  const holdersChartData = []
  const holdersChartLoading = false

  // Holders lightweight chart - the one surface that still pulls the library in,
  // so it fetches the chunk itself instead of putting it on every token page.
  useEffect(() => {
    const container = holdersChartContainerRef.current
    if (!holdersChartActive || !container) {
      if (holdersLWChartRef.current) {
        holdersLWChartRef.current.remove()
        holdersLWChartRef.current = null
        holdersSeriesRef.current = null
      }
      return
    }
    if (holdersLWChartRef.current) return // already created

    let cancelled = false
    let teardown = null

    loadLightweightCharts().then(({ createChart, ColorType, CrosshairMode, LineSeries }) => {
      // The chunk lands a tick later - bail if the mode changed meanwhile.
      if (cancelled || !holdersChartContainerRef.current || holdersLWChartRef.current) return

      const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(245, 245, 247, 0.5)',
        fontFamily: '"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.05 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(255,255,255,0.15)', width: 1, style: 2 },
        horzLine: { color: 'rgba(255,255,255,0.15)', width: 1, style: 2 },
      },
    })

    const series = chart.addSeries(LineSeries, {
      color: 'rgba(139, 92, 246, 0.9)',
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v)) },
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    })

      holdersLWChartRef.current = chart
      holdersSeriesRef.current = series

      const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect
          if (width > 0 && height > 0) chart.applyOptions({ width, height })
        }
      })
      ro.observe(container)

      teardown = () => {
        ro.disconnect()
        chart.remove()
        holdersLWChartRef.current = null
        holdersSeriesRef.current = null
      }
      // Unmounted while the chunk was in flight - tear down immediately.
      if (cancelled) teardown()
    })

    return () => {
      cancelled = true
      if (teardown) teardown()
    }
  }, [holdersChartActive])

  // Update holders chart data
  useEffect(() => {
    const series = holdersSeriesRef.current
    const chart = holdersLWChartRef.current
    if (!series || !chart || !holdersChartData?.length) return
    const data = holdersChartData
      .map(d => ({
        time: Math.floor(new Date(d.bucket).getTime() / 1000),
        value: parseInt(d.holders) || 0,
      }))
      .filter(d => d.time > 0 && d.value > 0)
      .sort((a, b) => a.time - b.time)
    if (data.length > 0) {
      series.setData(data)
      chart.timeScale().fitContent()
    }
  }, [holdersChartData])

  // Persist the VWAP preference. The canvas renderer reads `showVWAP` directly
  // on every draw, so there is no series handle to toggle here.
  useEffect(() => {
    localStorage.setItem('spectre-showVWAP', showVWAP.toString())
  }, [showVWAP])

  // Track previous bar count + oldest-bar time to adjust panOffset when bars grow
  const prevBarsCountRef = useRef(candleData.length)
  const prevOldestTimeRef = useRef(candleData[0]?.date?.getTime?.() ?? 0)

  // Keep the view stable when candleData grows. Two cases, opposite handling
  // (the render uses endIndex = length - panOffset):
  //   - PREPEND (scroll-back: older bars added at the FRONT, oldest gets older):
  //     existing candles shift right by addedBars in index, so leaving panOffset
  //     UNCHANGED already keeps the same candles in view - AND leaves the user
  //     short of the new left edge so they can keep scrolling into the newly
  //     loaded history. Bumping here would JUMP the view to the new bars and
  //     re-pin the user at the edge (which previously fed a fetch loop).
  //   - APPEND (live bar added at the END, oldest unchanged): existing indices
  //     don't move, so a historical view needs panOffset += addedBars to stay put.
  useEffect(() => {
    const prevCount = prevBarsCountRef.current
    const newCount = candleData.length
    const newOldest = candleData[0]?.date?.getTime?.() ?? 0
    const prevOldest = prevOldestTimeRef.current

    if (newCount > prevCount && prevCount > 0) {
      const addedBars = newCount - prevCount
      const isPrepend = newOldest > 0 && prevOldest > 0 && newOldest < prevOldest
      if (!isPrepend) {
        // APPEND (or unknown): keep a scrolled-in historical view pinned.
        setPanOffset(prev => {
          const visibleCount = Math.max(1, Math.floor(newCount / zoomLevel))
          const scrollThreshold = visibleCount * 0.2
          return prev > scrollThreshold ? prev + addedBars : prev
        })
      }
      // PREPEND: leave panOffset as-is - the view stays on the same candles and
      // the freshly loaded older bars become scrollable to the left.
    }

    prevBarsCountRef.current = newCount
    prevOldestTimeRef.current = newOldest
  }, [candleData.length, zoomLevel])

  // Auto-fetch more history: (1) one-shot initial sparse-data fill, and (2) when
  // the user has SETTLED within a few bars of the oldest loaded candle (so a
  // plain scroll-to-the-edge loads more - no overscroll needed).
  //
  // The edge margin is a SMALL CAPPED ABSOLUTE (<=4 bars), NOT a fraction of the
  // visible count. The earlier `floor(visibleCount * 0.4)` margin exceeded the
  // whole scroll range when zoomed out, so "at edge" was true every frame and
  // this spun fetchMoreHistory in a runaway loop that pinned loadingMore=true and
  // blocked ALL scroll-back. `maxPossibleOffset > 8` guarantees real scroll range
  // so the test can never be always-true; and because a prepend no longer re-pins
  // panOffset at the edge (see the bump effect above), a successful load moves the
  // user away from the new edge -> the test goes false -> no re-fire loop.
  useEffect(() => {
    if (loadingMore || !hasMoreHistory || candleData.length === 0) return
    if (!initialDataLoadedRef.current && candleData.length < 150) {
      initialDataLoadedRef.current = true
      lastFetchTimeRef.current = Date.now()
      fetchMoreHistory()
      return
    }
    if (candleData.length >= 150) initialDataLoadedRef.current = true

    const visibleCount = Math.max(1, Math.floor(candleData.length / zoomLevel))
    const maxPossibleOffset = Math.max(0, candleData.length - visibleCount)
    // SETTLED backup only - a SMALL edge margin (not the drag handler's forward
    // look-ahead). A big settled margin could spin on a token whose windows keep
    // coming back empty (transient): the user sits within the margin, so it
    // re-fires every cooldown. The seamless ahead-of-the-wall top-up lives in the
    // drag handler, which is self-limiting (it only fires while the mouse moves).
    const edgeMargin = Math.min(8, Math.floor(maxPossibleOffset * 0.1))
    const willFire = maxPossibleOffset > 8 && panOffset >= maxPossibleOffset - edgeMargin
    if (willFire) {
      const now = Date.now()
      if (now - lastFetchTimeRef.current >= 600) {
        lastFetchTimeRef.current = now
        fetchMoreHistory()
      }
    }
  }, [panOffset, candleData.length, zoomLevel, loadingMore, hasMoreHistory, fetchMoreHistory])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Don't render native chart when TradingView is active (and not in
    // the no-data fallback - then we DO want the native canvas).
    if (effectiveShowTV) return

    // Don't render if no data
    if (candleData.length === 0) return

    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()

    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    // === DAY MODE + CHART-STYLE COLOR CONFIG ===
    // Canvas can't read CSS vars - build the palette from the dayMode store
    // value + the user's chart style (ChartStyleControl). Fields left null
    // keep the stock look exactly.
    const dm = !!dayMode
    const CS = resolveChartStyle(chartStyle, dm, { followTheme: chartFollowsTheme })
    const C = {
      bg:            CS.bg,
      grid:          chartStyle.grid ? CS.grid : (dm ? 'rgba(0,0,0,0.06)' : 'rgba(255, 255, 255, 0.04)'),
      axisText:      chartStyle.axis ? CS.axisText : (dm ? 'rgba(0,0,0,0.45)' : 'rgba(255, 255, 255, 0.45)'),
      timeText:      chartStyle.axis ? CS.axisText : (dm ? 'rgba(0,0,0,0.4)' : 'rgba(255, 255, 255, 0.4)'),
      timeHighlight: dm ? 'rgba(15, 23, 42, 0.9)': 'rgba(245, 245, 247, 0.9)',
      volGreenFill:  dm ? 'rgba(16, 185, 129, 0.32)' : 'rgba(16, 185, 129, 0.28)',
      volRedFill:    dm ? 'rgba(239, 68, 68, 0.32)'  : 'rgba(239, 68, 68, 0.28)',
    }

    // === CLEAN BACKGROUND ===
    ctx.fillStyle = C.bg
    ctx.fillRect(0, 0, rect.width, rect.height)

    // === CHART LAYOUT - DexTools style: more space for price action, tiny volume ===
    const chartTop = 15 // Minimal top padding
    const volumeAreaHeight = Math.max(50, rect.height * 0.12) // 12% of height for volume bars
    const chartBottom = rect.height - timeAxisHeight - volumeAreaHeight - 8 // More space for candles
    const chartHeight = chartBottom - chartTop
    const chartLeft = 12
    const chartRight = rect.width - priceAxisWidth

    // === CANDLE DIMENSIONS - DexTools style ===
    // Dynamic minimum candle width based on data density:
    // - For full-history views (1D/1W with 500+ candles): allow 1px min for full overview
    // - For intraday: keep 3px min for readability
    const isFullHistoryView = candleData.length > 400
    const minCandleWidth = isFullHistoryView ? 1 : 3
    const maxCandleWidth = 25 // Max width for readability at high zoom
    
    // Calculate chart width
    const chartWidth = chartRight - chartLeft
    
    // Calculate how many candles the user wants to see based on zoom
    const requestedCandles = Math.max(1, Math.floor(candleData.length / Math.max(0.1, zoomLevel)))
    
    // Calculate the actual candle width for requested candles
    const rawCandleWidth = chartWidth / requestedCandles
    
    // Clamp candle width to min/max bounds
    const candleWidth = Math.max(minCandleWidth, Math.min(maxCandleWidth, rawCandleWidth))
    
    // IMPORTANT: Recalculate visible candle count based on ACTUAL candle width
    // This ensures candles always fill the chart width
    const visibleCandleCount = Math.floor(chartWidth / candleWidth)
    
    // Body width: 60% of candle slot (DexTools has thinner bodies with gaps)
    const bodyWidth = Math.max(1, candleWidth * 0.6)
    
    // Calculate visible range based on zoom and pan offset
    // panOffset = 0 means current price (newest data) is at right edge
    // panOffset > 0 means looking at older data (scroll left into history)
    // panOffset < 0 means showing empty space on right (scroll right past newest)
    
    // Clamp panOffset to valid range to prevent rendering issues
    // Max: can scroll until oldest candle is at right edge (no further)
    const maxAllowedOffset = Math.max(0, candleData.length - visibleCandleCount)
    const minAllowedOffset = -Math.floor(visibleCandleCount * 0.5) // 50% empty space on right (future)
    const clampedPanOffset = Math.max(minAllowedOffset, Math.min(maxAllowedOffset, panOffset))
    
    // Calculate indices with clamped offset - ensures we always have valid data
    const rawEndIndex = candleData.length - Math.floor(clampedPanOffset)
    const endIndex = Math.max(visibleCandleCount, Math.min(candleData.length, rawEndIndex))
    const startIndex = Math.max(0, endIndex - visibleCandleCount)
    const actualEndIndex = Math.min(candleData.length, startIndex + visibleCandleCount)
    
    // Calculate empty space offsets for edge cases
    // Right empty: when scrolled past newest data (negative offset)
    const rightEmptyCandles = clampedPanOffset < 0 ? Math.abs(Math.floor(clampedPanOffset)) : 0
    // Left empty: when at oldest data and chart has room (shouldn't happen with proper clamping)
    const leftEmptyCandles = Math.max(0, visibleCandleCount - actualEndIndex + startIndex)
    
    // Get visible data slice
    const visibleData = candleData.slice(startIndex, actualEndIndex)

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
        const x = chartLeft + (leftEmptyCandles + candlesBeforeThisSegment) * candleWidth - (rightEmptyCandles * candleWidth)
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
    const dataMinPrice = Math.min(...prices)
    const dataMaxPrice = Math.max(...prices)
    const dataPriceRange = dataMaxPrice - dataMinPrice
    
    // Apply price zoom - zoom into the center of the price range
    const midPrice = (dataMaxPrice + dataMinPrice) / 2
    const zoomedRange = dataPriceRange / priceZoom
    
    // Apply vertical pan offset (priceOffset is percentage of zoomed range)
    // Positive priceOffset = seeing higher prices (panned up)
    const priceShift = (priceOffset / 100) * zoomedRange
    
    const minPrice = midPrice - zoomedRange / 2 + priceShift
    const maxPrice = midPrice + zoomedRange / 2 + priceShift
    const priceRange = maxPrice - minPrice

    const scaleY = (price) => chartTop + chartHeight - ((price - minPrice) / priceRange) * chartHeight

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
    // Body = --bull / --bear (full opacity, crisp on void). Wicks = --bull-bright /
    // --bear-bright so they stay legible when bodies pack tight. Day mode darkens both.
    // ChartStyleControl candle overrides win over both.
    const greenColor     = CS.up
    const redColor       = CS.down
    const greenWickColor = CS.wickUp
    const redWickColor   = CS.wickDown

    // === TOKEN BRAND COLOUR (line chart + current-price line) ===
    // Resolved once per draw and shared by BOTH the line chart and the dashed
    // current-price line so they carry the token's theme colour (Research Zone parity).
    // Prefer the page's resolved --accent channel (useAccentTheme: curated -> server KV
    // -> canvas extraction); --accent is an @property <color> so getComputedStyle returns
    // rgb(...), which colorToRgbObj parses. Fall back to the deterministic getTokenColor hash.
    let _brandHex = CS.line || getTokenColor(token?.symbol, token?.address)
    // The computed --accent carries the TOKEN accent only while no user
    // accent is active; with a user accent (skin) set it would leak the
    // skin color into the chart — the chart stays on the token's brand
    // unless the user picked an explicit chart line color.
    if (!CS.line && !accentColor) {
      try {
        // Read from .main-layout, NOT .app: in day mode .main-layout carries the
        // THEME-CORRECT accent (the onLight remap = a dark, readable brand tone),
        // while .app still holds the light dark-mode accent that goes invisible on
        // white. In dark mode both are identical (no remap), so this is safe.
        const _appEl = document.querySelector('.main-layout') || document.querySelector('.app')
        const _accent = _appEl ? getComputedStyle(_appEl).getPropertyValue('--accent').trim() : ''
        if (/^#[0-9a-fA-F]{6}$/.test(_accent) || /^rgb/i.test(_accent)) _brandHex = _accent
      } catch { /* keep hash fallback */ }
    }
    const brandRgb = colorToRgbObj(_brandHex)
    // The left→right gradient LIGHTENS the line so it glows on the black chart.
    // On the white day chart that fades the line to invisible - keep it a solid
    // readable tone (no lightening) in day mode.
    const brandLt1 = dayMode ? brandRgb : lightenRgb(brandRgb, 0.25)
    const brandLt2 = dayMode ? brandRgb : lightenRgb(brandRgb, 0.45)
    const brandLt3 = dayMode ? brandRgb : lightenRgb(brandRgb, 0.65)

    // === DRAW CHART BASED ON TYPE ===
    if (chartType === 'line') {
      // === STUNNING LINE CHART - PREMIUM GRADIENT ===
      
      // Build smooth curve points using closing prices (visible data only)
      // Offset x position: add leftEmptyCandles (if at oldest), subtract rightEmptyCandles (if past newest)
      const points = visibleData.length >= 2 ? visibleData.map((candle, i) => ({
        x: chartLeft + (leftEmptyCandles + i) * candleWidth + candleWidth / 2 - (rightEmptyCandles * candleWidth),
        y: scaleY(candle.close)
      })) : []

      // Calculate if overall trend is up or down (non-aborting - volume/axes still draw)
      const startPrice = visibleData.length > 0 ? visibleData[0].close : 0
      const endPrice = visibleData.length > 0 ? visibleData[visibleData.length - 1].close : 0
      const isOverallUp = endPrice >= startPrice

      // Line colour palette: brandRgb / brandLt1-3 are resolved once above (shared with
      // the current-price line). isOverallUp stays for any direction-aware bits below.

      const lineGradient = ctx.createLinearGradient(chartLeft, 0, chartRight, 0)
      lineGradient.addColorStop(0, `rgb(${brandRgb.r}, ${brandRgb.g}, ${brandRgb.b})`)
      lineGradient.addColorStop(0.4, `rgb(${brandLt1.r}, ${brandLt1.g}, ${brandLt1.b})`)
      lineGradient.addColorStop(0.7, `rgb(${brandLt2.r}, ${brandLt2.g}, ${brandLt2.b})`)
      lineGradient.addColorStop(1, `rgb(${brandLt3.r}, ${brandLt3.g}, ${brandLt3.b})`)

      // === AREA FILL GRADIENT ===
      const areaGradient = ctx.createLinearGradient(0, chartTop, 0, chartBottom)
      areaGradient.addColorStop(0, `rgba(${brandRgb.r}, ${brandRgb.g}, ${brandRgb.b}, 0.35)`)
      areaGradient.addColorStop(0.3, `rgba(${brandLt1.r}, ${brandLt1.g}, ${brandLt1.b}, 0.2)`)
      areaGradient.addColorStop(0.6, `rgba(${brandLt2.r}, ${brandLt2.g}, ${brandLt2.b}, 0.1)`)
      areaGradient.addColorStop(1, `rgba(${brandLt3.r}, ${brandLt3.g}, ${brandLt3.b}, 0)`)

      // === DRAW AREA FILL + LINE + DOT (sharp, clipped - research parity) ===
      if (points.length >= 2) {
        // Clip to chart area so out-of-range spikes can't bleed into volume/time rows
        ctx.save()
        ctx.beginPath()
        ctx.rect(chartLeft, chartTop, chartRight - chartLeft, chartBottom - chartTop)
        ctx.clip()

        // Area fill - sharp line-to through every point
        ctx.beginPath()
        ctx.moveTo(points[0].x, chartBottom)
        for (let i = 0; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        ctx.lineTo(points[points.length - 1].x, chartBottom)
        ctx.closePath()
        ctx.fillStyle = areaGradient
        ctx.fill()

        // Subtle glow (3x less than before)
        ctx.shadowColor = `rgba(${brandRgb.r}, ${brandRgb.g}, ${brandRgb.b}, 0.32)`
        ctx.shadowBlur = 4
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0

        // Main line - sharp, thin
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        ctx.strokeStyle = lineGradient
        ctx.lineWidth = 1.25
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke()

        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0

        // Current point - single crisp 3.5px dot, no halo/ring/gradient
        const lastPoint = points[points.length - 1]
        if (lastPoint && Number.isFinite(lastPoint.x) && Number.isFinite(lastPoint.y)) {
          ctx.fillStyle = `rgb(${brandRgb.r}, ${brandRgb.g}, ${brandRgb.b})`
          ctx.beginPath()
          ctx.arc(lastPoint.x, lastPoint.y, 3.5, 0, Math.PI * 2)
          ctx.fill()
        }

        ctx.restore()
      }

    } else {
      // === DRAW CANDLES - Batched by color for performance (research parity) ===
      // Batch all green/red wicks + bodies into 4 Path2D, then 4 draws total.
      ctx.save()
      ctx.beginPath()
      ctx.rect(chartLeft, chartTop, chartRight - chartLeft, chartBottom - chartTop)
      ctx.clip()

      const wickWidth = Math.max(1, bodyWidth * 0.12)
      const halfBody = bodyWidth / 2
      // Flat-candle (O==H==L==C) tick width: short centered mark, not a full bar.
      const flatTickHalfWidth = Math.max(2, bodyWidth * 0.18)

      const greenWickPath = new Path2D()
      const redWickPath = new Path2D()
      const greenBodyPath = new Path2D()
      const redBodyPath = new Path2D()

      for (let i = 0; i < visibleData.length; i++) {
        const candle = visibleData[i]
        // NOTE: research adds + panFracPx here; trading has no sub-pixel pan - omit it.
        const x = chartLeft + (leftEmptyCandles + i) * candleWidth + candleWidth / 2 - (rightEmptyCandles * candleWidth)

        const isGreen = candle.close >= candle.open
        const openY = scaleY(candle.open)
        const closeY = scaleY(candle.close)
        const highY = scaleY(candle.high)
        const lowY = scaleY(candle.low)
        const isFlat = candle.high === candle.low && candle.open === candle.close

        if (isFlat) {
          const bodyPath = isGreen ? greenBodyPath : redBodyPath
          bodyPath.rect(x - flatTickHalfWidth, closeY, flatTickHalfWidth * 2, 1)
          continue
        }

        const bodyTop = Math.min(openY, closeY)
        const bodyH = Math.max(1, Math.abs(closeY - openY))

        const wickPath = isGreen ? greenWickPath : redWickPath
        wickPath.moveTo(x, highY)
        wickPath.lineTo(x, lowY)

        const bodyPath = isGreen ? greenBodyPath : redBodyPath
        bodyPath.rect(x - halfBody, bodyTop, bodyWidth, bodyH)
      }

      ctx.lineWidth = wickWidth
      ctx.lineCap = 'butt'
      ctx.strokeStyle = greenWickColor
      ctx.stroke(greenWickPath)
      ctx.strokeStyle = redWickColor
      ctx.stroke(redWickPath)
      ctx.fillStyle = greenColor
      ctx.fill(greenBodyPath)
      ctx.fillStyle = redColor
      ctx.fill(redBodyPath)

      ctx.restore()
    }

    // === HELPER FUNCTIONS FOR MCAP MODE ===
    // Format large numbers for MCap display
    const formatMcap = (value) => {
      if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
      if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
      if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
      if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`
      return `$${value.toFixed(2)}`
    }
    
    // Use REAL circulating supply from API (liveTokenData), not hardcoded stats
    // The API returns the actual number (e.g., 900000000 for 900M tokens)
    const circSupply = liveTokenData?.circulatingSupply ? parseFloat(liveTokenData.circulatingSupply) : 0
    

    // === CURRENT PRICE LINE - ALWAYS SHOWS LIVE/LATEST PRICE ===
    // Use the actual latest candle from the FULL dataset, not just visible data
    // This ensures the current price line always shows the live price even when scrolled left
    const latestCandle = candleData[candleData.length - 1]
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
      // Line chart: match the token's brand colour (same as the line itself), not a
      // fixed cyan/violet. brandRgb is the resolved --accent (hoisted above).
      priceLineColor = `rgba(${brandRgb.r}, ${brandRgb.g}, ${brandRgb.b}, 0.6)`
      badgeBgColor = `rgba(${brandRgb.r}, ${brandRgb.g}, ${brandRgb.b}, 0.9)`
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

    // === PRICE LABEL - Bloomberg / Coinbase-Advanced style (research parity) ===
    // Compact dark pill, neutral warm-white text, no border, no highlight gradient.
    const priceFont = '600 11px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif'
    ctx.font = priceFont
    let badgePriceText
    if (yAxisMode === 'mcap' && circSupply > 0) {
      badgePriceText = formatMcap(currentPrice * circSupply)
    } else {
      badgePriceText = '$' + (currentPrice >= 1000
        ? currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : currentPrice >= 1 ? currentPrice.toFixed(2)
        : currentPrice >= 0.01 ? currentPrice.toFixed(4)
        : currentPrice.toFixed(6))
    }
    const badgeTextWidth = ctx.measureText(badgePriceText).width
    const padX = 8
    const badgeWidth = Math.max(58, badgeTextWidth + padX * 2)
    const badgeHeight = 18
    const badgeX = chartRight + 6
    const badgeY = clampedY - badgeHeight / 2
    const badgeR = 3

    // Solid dark pill body - NO border, NO highlight gradient
    ctx.fillStyle = dm ? 'rgba(255, 255, 255, 0.98)' : 'rgba(18, 18, 22, 0.96)'
    ctx.beginPath()
    ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, badgeR)
    ctx.fill()

    // Neutral warm-white text (line color already lives on the chart)
    ctx.fillStyle = dm ? '#0f172a' : '#f5f5f7'
    ctx.font = priceFont
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(badgePriceText, badgeX + badgeWidth / 2, clampedY + 0.5)
    ctx.textBaseline = 'alphabetic'

    // Off-screen direction arrows (half-size, fill = line color)
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

    // === ATH LINES (All-Time High & Local High) ===
    if (showATHLines && candleData.length > 0) {
      // For line chart, use close prices (what's actually drawn)
      // For candle chart, use high prices (wick tops)
      const priceField = chartType === 'line' ? 'close' : 'high'
      
      // Use trueATH from hook if available (fetched from all historical data)
      // Fall back to calculating from loaded candleData if not available yet
      let athPrice = trueATH
      if (!athPrice || athPrice <= 0) {
        const allHighs = candleData.map(c => {
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
        // Adaptive formatting for small prices
        if (price >= 1) {
          return `$${price.toFixed(2)}`
        } else if (price >= 0.01) {
          return `$${price.toFixed(4)}`
        } else if (price >= 0.0001) {
          return `$${price.toFixed(6)}`
        } else if (price >= 0.000001) {
          return `$${price.toFixed(8)}`
        } else {
          return `$${price.toFixed(10)}`
        }
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
        
        // ATH label on right side
        ctx.fillStyle = 'rgba(251, 191, 36, 0.95)'
        ctx.font = '600 11px "SF Pro Text", -apple-system, system-ui, sans-serif'
        ctx.textAlign = 'right'
        ctx.fillText(`ATH ${formatATHValue(athPrice)}`, chartRight - 8, athY - 5)
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
        
        // Local High label on right side
        ctx.fillStyle = 'rgba(34, 211, 238, 0.9)'
        ctx.font = '600 11px "SF Pro Text", -apple-system, system-ui, sans-serif'
        ctx.textAlign = 'right'
        ctx.fillText(`Local High ${formatATHValue(localHighPrice)}`, chartRight - 8, localHighY - 5)
      }
    }

    // === ALERT LINES ===
    // Horizontal dashed guide for each active price-target rule on this
    // token. Mirrors the ATH/Local-High dashed-line pattern above: same
    // scaleY transform, same setLineDash/restore discipline, right-edge
    // label. Neutral tone (not bull/bear) - these mark target levels, not
    // P&L direction. Only rules whose target sits inside the currently
    // visible price range (minPrice..maxPrice) are drawn.
    if (alertLines.length > 0) {
      for (const line of alertLines) {
        if (!(line.price > 0)) continue
        if (line.price < minPrice || line.price > maxPrice) continue
        const alertY = scaleY(line.price)
        ctx.strokeStyle = 'rgba(245, 245, 247, 0.4)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(chartLeft, alertY)
        ctx.lineTo(chartRight, alertY)
        ctx.stroke()
        ctx.setLineDash([])

        // ALERT label on right side
        ctx.fillStyle = 'rgba(245, 245, 247, 0.55)'
        ctx.font = '600 10px "SF Pro Text", -apple-system, system-ui, sans-serif'
        ctx.textAlign = 'right'
        ctx.fillText('ALERT', chartRight - 8, alertY - 5)
      }
    }

    // === SPOTTED RECEIPT BADGE (native canvas branch) ===
    // Branded receipt: a thin stem from the bar into a glass pill carrying
    // the Spectre mark + "Spotted $X.XM". Anchors to the NEAREST LOADED bar,
    // so a spot older than the loaded window clamps to the data edge. Flips
    // above the bar when there's no room below; day-mode palette swaps.
    const spottedNow = spottedRef.current
    if (spottedNow?.first_entered_at && Number(spottedNow.entry_market_cap) > 0 && visibleData.length > 0) {
      const spMs = new Date(spottedNow.first_entered_at).getTime()
      let spIdx = 0
      let bestD = Infinity
      for (let i = 0; i < candleData.length; i++) {
        // canvas bars carry `date` (Date); tolerate `time`/`unixTime` shapes
        const c = candleData[i]
        const t = c.date instanceof Date ? c.date.getTime()
          : Number(c.time) > 1e12 ? Number(c.time)
          : Number(c.unixTime) > 0 ? Number(c.unixTime) * 1000
          : 0
        const d = Math.abs(t - spMs)
        if (d < bestD) { bestD = d; spIdx = i }
      }
      if (spIdx >= startIndex && spIdx < actualEndIndex) {
        const vi = spIdx - startIndex
        const sx = chartLeft + (leftEmptyCandles + vi) * candleWidth - (rightEmptyCandles * candleWidth) + candleWidth / 2
        const bar = candleData[spIdx]
        const anchorLow = Number(bar.low) > 0 ? Number(bar.low) : Number(bar.close) || 0
        const anchorHigh = Number(bar.high) > 0 ? Number(bar.high) : anchorLow
        if (sx >= chartLeft && sx <= chartRight) {
          const spLabel = `Spotted ${fmtSpottedMcap(spottedNow.entry_market_cap)}`
          ctx.font = '600 10.5px "SF Pro Text", -apple-system, system-ui, sans-serif'
          const textW = ctx.measureText(spLabel).width
          const pillH = 22
          const iconSize = 14
          const padX = 7
          const gap = 6
          const pillW = padX + iconSize + gap + textW + padX + 1
          const stemLen = 10
          // Below the bar by default; flip above when the pill would clip.
          const lowY = scaleY(anchorLow)
          const below = lowY + stemLen + pillH <= chartBottom - 2
          const stemY1 = below ? lowY + 3 : scaleY(anchorHigh) - 3
          const stemY2 = below ? stemY1 + stemLen : stemY1 - stemLen
          const pillY = below ? stemY2 : stemY2 - pillH
          const pillX = Math.min(Math.max(sx - pillW / 2, chartLeft + 4), chartRight - pillW - 4)
          const ink = dm
          ctx.strokeStyle = ink ? 'rgba(15, 23, 42, 0.35)' : 'rgba(245, 245, 247, 0.35)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(sx, stemY1)
          ctx.lineTo(sx, stemY2)
          ctx.stroke()
          // Glass pill
          ctx.save()
          ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
          ctx.shadowBlur = ink ? 6 : 10
          ctx.shadowOffsetY = 2
          ctx.fillStyle = ink ? 'rgba(255, 255, 255, 0.97)' : 'rgba(17, 17, 19, 0.94)'
          ctx.beginPath()
          ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2)
          ctx.fill()
          ctx.restore()
          ctx.strokeStyle = ink ? 'rgba(15, 23, 42, 0.14)' : 'rgba(245, 245, 247, 0.18)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.roundRect(pillX + 0.5, pillY + 0.5, pillW - 1, pillH - 1, (pillH - 1) / 2)
          ctx.stroke()
          // Spectre mark — the round app icon, circularly clipped. Skipped
          // (text-only pill) until the module-level image finishes loading;
          // the next live-bar redraw picks it up.
          const iconX = pillX + padX
          const iconY = pillY + (pillH - iconSize) / 2
          let textX = iconX
          if (SPOTTED_LOGO_IMG?.complete && SPOTTED_LOGO_IMG.naturalWidth > 0) {
            ctx.save()
            ctx.beginPath()
            ctx.arc(iconX + iconSize / 2, iconY + iconSize / 2, iconSize / 2, 0, Math.PI * 2)
            ctx.clip()
            ctx.drawImage(SPOTTED_LOGO_IMG, iconX, iconY, iconSize, iconSize)
            ctx.restore()
            textX = iconX + iconSize + gap
          }
          ctx.font = '600 10.5px "SF Pro Text", -apple-system, system-ui, sans-serif'
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          ctx.fillStyle = ink ? '#0f172a' : '#f5f5f7'
          ctx.fillText(spLabel, textX, pillY + pillH / 2 + 0.5)
          ctx.textBaseline = 'alphabetic'
        }
      }
    }

    // === PRICE/MCAP LABELS (Y-axis) - RIGHT SIDE ===
    // Professional VC-backed Apple startup style axis labels
    ctx.fillStyle = C.axisText
    ctx.font = '500 11px "SF Pro Text", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'

    for (let i = 0; i <= 4; i++) {
      const price = minPrice + (priceRange / 4) * (4 - i)
      const y = chartTop + (chartHeight / 4) * i

      if (yAxisMode === 'mcap' && circSupply > 0) {
        const mcap = price * circSupply
        ctx.fillText(formatMcap(mcap), chartRight + 10, y + 4)
      } else {
        const formattedPrice = price >= 1000
          ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : price >= 1 ? price.toFixed(2)
          : price >= 0.01 ? price.toFixed(4)
          : price.toFixed(6)
        ctx.fillText(`$${formattedPrice}`, chartRight + 10, y + 4)
      }
    }

    // === VOLUME BARS - Batched by candle direction (green/red, research parity) ===
    const volumeTop = chartBottom + 4
    const volumeHeight = volumeAreaHeight - 6
    // Hoisted out of the draw block so it can ride along in chartDimensionsRef -
    // the hover handler used to recompute it per mousemove with a spread-Math.max
    // over every visible candle.
    let maxVolume = 0
    if (visibleData.length > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(chartLeft, volumeTop, chartRight - chartLeft, volumeHeight)
      ctx.clip()

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
        // Flush-left x base (no + candleWidth/2, no panFracPx) - matches hover hit-test.
        const x = chartLeft + (leftEmptyCandles + i) * candleWidth - (rightEmptyCandles * candleWidth)
        const hasVolume = candle.volume > 0 && maxVolume > 0
        if (hasVolume) {
          const barHeight = (candle.volume / maxVolume) * volumeHeight
          const barTop = volumeTop + volumeHeight - barHeight
          const isGreen = candle.close >= candle.open
          const path = isGreen ? greenVolPath : redVolPath
          path.rect(x + volXOffset, barTop, bodyWidth, barHeight)
        } else {
          placeholderPath.rect(x + volXOffset, volumeTop + volumeHeight - 1, bodyWidth, 1)
        }
      }
      if (maxVolume > 0) {
        ctx.fillStyle = C.volGreenFill
        ctx.fill(greenVolPath)
        ctx.fillStyle = C.volRedFill
        ctx.fill(redVolPath)
      }
      ctx.fillStyle = dm ? 'rgba(15, 23, 42, 0.18)' : 'rgba(245, 245, 247, 0.14)'
      ctx.fill(placeholderPath)
      ctx.restore()
    }

    // === TIME LABELS (X-axis) - separator + centered strip + dedup (research parity) ===
    ctx.font = '500 10px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif'
    ctx.textAlign = 'center'

    const getCandleDate = (c) => {
      if (c.date instanceof Date && !isNaN(c.date.getTime())) return c.date
      if (typeof c.time === 'number' && c.time > 0) return new Date(c.time)
      return null
    }

    const _firstD = visibleData.length > 0 ? getCandleDate(visibleData[0]) : null
    const _lastD = visibleData.length > 0 ? getCandleDate(visibleData[visibleData.length - 1]) : null
    const visibleSpansYears = !!(_firstD && _lastD && _firstD.getFullYear() !== _lastD.getFullYear())

    const formatTimeLabel = (date, tf) => {
      if (!date || isNaN(date.getTime())) return ''
      const hours = date.getHours().toString().padStart(2, '0')
      const minutes = date.getMinutes().toString().padStart(2, '0')
      const day = date.getDate()
      const month = date.toLocaleString('en', { month: 'short' })
      const year = date.getFullYear().toString().slice(-2)
      const dayLabel = visibleSpansYears ? `${month} ${day}, '${year}` : `${month} ${day}`
      switch (tf) {
        case '1m': case '5m': case '15m':
          return `${hours}:${minutes}`
        case '1H': case '4H': case '12H': case '24H':
          return `${month} ${day} ${hours}:${minutes}`
        case '1D': case '7D': case '30D': case 'YTD': case 'All':
          return dayLabel
        case '1W': case '90D':
          return `${month} ${day}, '${year}`
        case '1MO': case '1Y': case 'ALL':
          return `${month} '${year}`
        default:
          return dayLabel
      }
    }
    
    // Separator hairline above the time strip
    const timeAxisTopY = rect.height - timeAxisHeight
    ctx.strokeStyle = C.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(chartLeft, timeAxisTopY)
    ctx.lineTo(chartRight, timeAxisTopY)
    ctx.stroke()

    const labelY = rect.height - timeAxisHeight / 2 + 4

    const sampleWidth = ctx.measureText('Mar 03 12:00').width + 24
    const maxLabelsFromWidth = Math.max(2, Math.floor((chartRight - chartLeft) / sampleWidth))
    const targetLabelCount = Math.min(maxLabelsFromWidth, Math.max(3, 8))
    const labelInterval = Math.max(1, Math.ceil(visibleData.length / targetLabelCount))

    ctx.fillStyle = C.timeText
    let lastLabelRight = -Infinity
    let lastLabelText = ''
    for (let i = 0; i < visibleData.length; i += labelInterval) {
      const candle = visibleData[i]
      if (!candle) continue
      const date = getCandleDate(candle)
      if (!date) continue
      // NOTE: research adds + panFracPx; trading omits (matches candle x).
      const x = chartLeft + (leftEmptyCandles + i) * candleWidth + candleWidth / 2 - (rightEmptyCandles * candleWidth)
      if (x < chartLeft + 10 || x > chartRight - 10) continue
      const label = formatTimeLabel(date, timeframe)
      if (!label) continue
      if (label === lastLabelText) continue
      const labelWidth = ctx.measureText(label).width
      if (x - labelWidth / 2 < lastLabelRight + 8) continue
      ctx.fillText(label, x, labelY)
      lastLabelRight = x + labelWidth / 2
      lastLabelText = label
    }

    // Last candle's time in neutral accent (was purple)
    if (visibleData.length > 0) {
      const lastIdx = visibleData.length - 1
      const lastCandle = visibleData[lastIdx]
      const lastDate = getCandleDate(lastCandle)
      if (lastDate) {
        const x = chartLeft + (leftEmptyCandles + lastIdx) * candleWidth + candleWidth / 2 - (rightEmptyCandles * candleWidth)
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
      // Draw line chart overlay first
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.6)'
      ctx.lineWidth = 2
      visibleData.forEach((candle, i) => {
        const x = chartLeft + i * candleWidth + candleWidth / 2
        const y = scaleY(candle.close)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // Add glow effect to line
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.2)'
      ctx.lineWidth = 6
      candleData.forEach((candle, i) => {
        const x = chartLeft + i * candleWidth + candleWidth / 2
        const y = scaleY(candle.close)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // Draw vertical lines at mention points
      xMentions.forEach(mention => {
        if (mention.candleIndex < candleData.length) {
          const x = chartLeft + mention.candleIndex * candleWidth + candleWidth / 2
          const candle = candleData[mention.candleIndex]
          const y = scaleY(candle.close)

          // Vertical dotted line
          ctx.strokeStyle = mention.sentiment === 'bullish' ? 'rgba(34, 197, 94, 0.4)' : 
                           mention.sentiment === 'announcement' ? 'rgba(139, 92, 246, 0.6)' : 
                           'rgba(255, 255, 255, 0.3)'
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
                           'rgba(255, 255, 255, 0.2)'
          ctx.fillStyle = glowColor
          ctx.beginPath()
          ctx.arc(x, y - 40, 22, 0, Math.PI * 2)
          ctx.fill()

          // Ring around avatar position
          ctx.strokeStyle = mention.sentiment === 'bullish' ? '#22c55e' : 
                           mention.sentiment === 'announcement' ? '#8b5cf6' : 
                           '#ffffff'
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
      
      // Sora - Futuristic, tech startup vibes (subtle)
      ctx.globalAlpha = 0.035
      ctx.font = '500 60px "Sora", "Outfit", "Poppins", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#ffffff'
      
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
        
        // Zone colors
        let zoneColor, textColor
        if (zone.zoneType === 'bullish') {
          zoneColor = 'rgba(52, 211, 153, 0.95)'
          textColor = 'rgba(52, 211, 153, 1)'
        } else if (zone.zoneType === 'bearish') {
          zoneColor = 'rgba(251, 113, 133, 0.95)'
          textColor = 'rgba(251, 113, 133, 1)'
        } else {
          zoneColor = 'rgba(167, 139, 250, 0.8)'
          textColor = 'rgba(167, 139, 250, 0.9)'
        }
        
        // Position label in the upper portion of the chart area
        const labelY = 100
        const pillHeight = 44
        const pillWidth = Math.max(60, Math.min(zoneWidth - 16, 90))
        const pillX = centerX - pillWidth / 2
        const pillRadius = 8
        
        // Glassmorphic background
        const bgGradient = ctx.createLinearGradient(pillX, labelY, pillX, labelY + pillHeight)
        bgGradient.addColorStop(0, 'rgba(12, 12, 18, 0.92)')
        bgGradient.addColorStop(1, 'rgba(8, 8, 12, 0.95)')
        
        ctx.fillStyle = bgGradient
        ctx.beginPath()
        ctx.roundRect(pillX, labelY, pillWidth, pillHeight, pillRadius)
        ctx.fill()
        
        // Subtle border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
        ctx.lineWidth = 1
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
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
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

    // Store dimensions for hover detection
    chartDimensionsRef.current = {
      chartLeft,
      chartRight,
      chartTop,
      chartHeight,
      volumeTop,
      volumeHeight,
      candleWidth,
      bodyWidth,
      scaleY,
      minPrice,
      startIndex,
      visibleData,
      maxPrice,
      priceRange,
      rightEmptyCandles,
      leftEmptyCandles,
      maxVolume
    }

  }, [candleData, timeframe, chartType, heatmapEnabled, isFullscreen, redrawTrigger, chartViewMode, xMentions, zoomLevel, priceZoom, priceAxisWidth, timeAxisHeight, panOffset, priceOffset, yAxisMode, stats, showATHLines, liveTokenData, trueATH, effectiveShowTV, dayMode, chartStyle, accentColor, chartFollowsTheme, bgTone, bgDepth, spotted, alertLines])

  // Hover work for volume bar + crosshair. Called at most once per animation
  // frame from handleMouseMove - a raw mousemove binding ran this whole body
  // (a forced-layout getBoundingClientRect, a spread Math.max over every
  // visible candle, and up to three setStates reconciling this 5.8k-line
  // component) on every pointer sample, which is well above 60/s on a
  // high-report-rate mouse.
  const applyHoverAt = (clientX, clientY) => {
    const canvas = canvasRef.current
    if (!canvas || !chartDimensionsRef.current) return

    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top

    const { chartLeft, chartRight, chartTop, chartHeight, volumeTop, volumeHeight, candleWidth, bodyWidth, scaleY, priceRange, minPrice, maxPrice, visibleData: visData, rightEmptyCandles: emptyCandles = 0, leftEmptyCandles: leftEmpty = 0, maxVolume = 0 } = chartDimensionsRef.current
    const dataToUse = visData || candleData

    // Update crosshair if in chart area - TradingView-style snap to candle
    if (x >= chartLeft && x <= chartRight && y >= chartTop && y <= volumeTop + volumeHeight) {
      // Calculate price at Y position
      const priceAtY = maxPrice - ((y - chartTop) / chartHeight) * priceRange
      
      // Calculate candle index at X position (within visible data)
      // Account for both left and right empty space offsets
      const adjustedX = x + (emptyCandles * candleWidth) - (leftEmpty * candleWidth)
      const candleIndex = Math.floor((adjustedX - chartLeft) / candleWidth)
      
      // Get candle data if valid index
      const candle = candleIndex >= 0 && candleIndex < dataToUse.length 
        ? dataToUse[candleIndex] 
        : null
      
      // Calculate snapped X position (center of candle) - MUST match the draw's
      // per-candle x exactly: chartLeft + (leftEmpty + i)*cw + cw/2 - rightEmpty*cw.
      // The leftEmpty offset was missing, so when zoomed out far enough to leave
      // empty space on the left, the crosshair line drifted left of the candle it
      // was reporting (line said mid-Aug, OHLC said Feb).
      const snappedX = candle
        ? chartLeft + (leftEmpty + candleIndex) * candleWidth + candleWidth / 2 - (emptyCandles * candleWidth)
        : x
      
      setCrosshair(prev => (
        prev.visible && prev.x === snappedX && prev.y === y && prev.candle === candle
          ? prev
          : {
              visible: true,
              x: snappedX, // Snap to candle center
              y,
              price: priceAtY,
              time: candle?.date || null,
              candle, // Include full candle data for OHLCV display
              candleX: snappedX
            }
      ))
      // Update persistent OHLCV legend for native chart modes. Only the hovered
      // candle drives it, so moving WITHIN one candle must not re-render.
      if (candle) {
        setOhlcvLegend(prev => (
          prev && prev.time === candle.date && prev.close === candle.close
            ? prev
            : {
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: candle.volume || 0,
                time: candle.date,
              }
        ))
      }
    } else {
      setCrosshair(prev => (prev.visible ? { visible: false, x: 0, y: 0, price: null, time: null, candle: null, candleX: 0 } : prev))
    }

    // Check if mouse is in volume area
    if (y >= volumeTop && y <= volumeTop + volumeHeight && x >= chartLeft && x <= chartRight) {
      // Find which bar we're over (within visible data)
      // Account for both left and right empty candle offsets
      const adjustedX = x + (emptyCandles * candleWidth) - (leftEmpty * candleWidth)
      const barIndex = Math.floor((adjustedX - chartLeft) / candleWidth)
      
      if (barIndex >= 0 && barIndex < dataToUse.length) {
        const candle = dataToUse[barIndex]
        // Flush-left geometry matching the batched volume draw (x + volXOffset, width = bodyWidth).
        const volXOffset = candleWidth * 0.15
        const barLeft = chartLeft + (leftEmpty + barIndex) * candleWidth - (emptyCandles * candleWidth) + volXOffset
        const barHeight = (candle.volume / maxVolume) * volumeHeight
        const barTop = volumeTop + volumeHeight - barHeight

        // Check if actually over the bar (flush-left, width = bodyWidth)
        if (x >= barLeft && x <= barLeft + bodyWidth && y >= barTop) {
          const tipX = barLeft + bodyWidth / 2
          const tipY = barTop - 10
          setTooltip(prev => (
            prev.visible && prev.x === tipX && prev.y === tipY && prev.data?.date === candle.date
              ? prev
              : {
                  visible: true,
                  x: tipX,
                  y: tipY,
                  data: {
                    date: candle.date,
                    volume: candle.volume
                  }
                }
          ))
          return
        }
      }
    }

    setTooltip(prev => (prev.visible ? { visible: false, x: 0, y: 0, data: null } : prev))
  }

  // Coalesce pointer samples to one hover pass per frame. Only the latest
  // position matters - intermediate samples would compute state that is
  // overwritten before it ever paints.
  const handleMouseMove = (e) => {
    hoverPosRef.current = { x: e.clientX, y: e.clientY }
    if (hoverFrameRef.current !== null) return
    hoverFrameRef.current = requestAnimationFrame(() => {
      hoverFrameRef.current = null
      const pos = hoverPosRef.current
      if (pos) applyHoverAt(pos.x, pos.y)
    })
  }

  const cancelHoverFrame = () => {
    if (hoverFrameRef.current !== null) {
      cancelAnimationFrame(hoverFrameRef.current)
      hoverFrameRef.current = null
    }
    hoverPosRef.current = null
  }

  const handleMouseLeave = () => {
    // Drop any frame still queued, or it would re-show the crosshair after leave.
    cancelHoverFrame()
    setTooltip({ visible: false, x: 0, y: 0, data: null })
    setCrosshair({ visible: false, x: 0, y: 0, price: null, time: null, candle: null, candleX: 0 })
    setOhlcvLegend(null)
  }

  // Wheel handler for zoom - TradingView-style zoom centered on mouse position
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    
    const canvas = canvasRef.current
    if (!canvas) return
    
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const chartRight = rect.width - priceAxisWidth
    const chartLeft = 12
    
    // Check if mouse is over the price axis (right side)
    if (x > chartRight) {
      // Scroll on price axis = zoom price scale (vertical zoom)
      setAutoFitPrice(false)
      const delta = e.deltaY > 0 ? -0.12 : 0.12
      setPriceZoom(prev => Math.max(0.1, Math.min(10, prev + delta)))
    } else {
      // Scroll on chart area = zoom time scale (horizontal zoom) centered on mouse
      // TradingView-like: smooth 15% zoom per scroll
      const zoomFactor = e.deltaY > 0 ? 0.85 : 1.18
      
      // Zoom limits. Min zoom: show at least 20 candles (zoomed in). Max
      // zoom-out: the FULL loaded history on EVERY timeframe (was capped at 400
      // candles for non-1D, so users couldn't zoom out to a wide view even after
      // scroll-back loaded more history). The render clamps candle width to >=1px,
      // so the on-screen count is naturally bounded by the chart width.
      const minVisibleCandles = 20
      const maxVisibleCandles = Math.max(minVisibleCandles, candleData.length)
      const minZoom = candleData.length / maxVisibleCandles
      const maxZoom = candleData.length / minVisibleCandles
      // Allow zooming out slightly past full-fit (a little margin on the sides) on
      // all timeframes - matches what 1D always did.
      const minAllowedZoom = Math.min(0.5, minZoom)
      const newZoom = Math.max(minAllowedZoom, Math.min(maxZoom, zoomLevel * zoomFactor))
      
      // Calculate mouse position as percentage of chart width
      const chartWidth = chartRight - chartLeft
      const mouseRatio = Math.max(0, Math.min(1, (x - chartLeft) / chartWidth))
      
      // Use same calculation as rendering
      const isFullHistory = candleData.length > 400
      const minCandleW = isFullHistory ? 1 : 3
      const maxCandleW = 25
      
      const requestedBefore = Math.max(1, Math.floor(candleData.length / Math.max(0.1, zoomLevel)))
      const requestedAfter = Math.max(1, Math.floor(candleData.length / Math.max(0.1, newZoom)))
      const rawCandleWBefore = chartWidth / requestedBefore
      const rawCandleWAfter = chartWidth / requestedAfter
      const candleWBefore = Math.max(minCandleW, Math.min(maxCandleW, rawCandleWBefore))
      const candleWAfter = Math.max(minCandleW, Math.min(maxCandleW, rawCandleWAfter))
      const visibleCountBefore = Math.floor(chartWidth / candleWBefore)
      const visibleCountAfter = Math.floor(chartWidth / candleWAfter)
      const candleShift = (visibleCountAfter - visibleCountBefore) * mouseRatio
      
      // Update zoom and pan together for smooth centered zoom
      setZoomLevel(newZoom)
      setPanOffset(prev => {
        const maxOffset = Math.max(0, candleData.length - visibleCountAfter)
        const minOffset = -Math.floor(visibleCountAfter * 0.5)
        return Math.max(minOffset, Math.min(maxOffset, prev - candleShift))
      })
      // Zooming OUT can ask to show more candles than are loaded - top up history
      // (merges the prewarmed window from cache, ~instant) so the wider view fills
      // with real candles instead of empty space. Discrete per wheel tick + gated.
      if (newZoom < zoomLevel && hasMoreHistoryRef.current && !loadingMoreRef.current &&
          visibleCountAfter > candleData.length * 0.8) {
        const now = Date.now()
        if (now - lastFetchTimeRef.current >= 300) {
          lastFetchTimeRef.current = now
          fetchMoreHistoryRef.current()
        }
      }
    }
  }, [priceAxisWidth, zoomLevel, candleData.length])

  // Attach wheel event with passive: false to prevent page scroll
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [handleWheel])

  // Chart panning handlers - TradingView-style with momentum/inertia (horizontal + vertical)
  const handlePanStart = useCallback((e) => {
    if (e.button !== 0) return
    if (e.target.classList.contains('axis-drag-handle')) return
    
    // Cancel any existing momentum animation
    if (momentumAnimationRef.current) {
      cancelAnimationFrame(momentumAnimationRef.current)
      momentumAnimationRef.current = null
    }
    
    // Disable auto-fit when manually panning vertically
    setAutoFitPrice(false)
    
    setIsPanning(true)
    panStartRef.current = { x: e.clientX, y: e.clientY, offset: panOffset, priceOff: priceOffset }
    lastPanXRef.current = e.clientX
    lastPanYRef.current = e.clientY
    lastPanTimeRef.current = performance.now()
    panVelocityRef.current = { x: 0, y: 0 }
  }, [panOffset, priceOffset])

  const handlePanMove = useCallback((e) => {
    if (!isPanning) return
    
    const currentX = e.clientX
    const currentY = e.clientY
    const currentTime = performance.now()
    const deltaX = currentX - panStartRef.current.x
    const deltaY = currentY - panStartRef.current.y
    const instantDeltaX = currentX - lastPanXRef.current
    const instantDeltaY = currentY - lastPanYRef.current
    const deltaTime = currentTime - lastPanTimeRef.current
    
    // Calculate velocity for momentum (pixels per ms) - both X and Y
    if (deltaTime > 0) {
      // Very smooth velocity with weighted average (current 50%, previous 50%)
      const instantVelocityX = instantDeltaX / deltaTime
      const instantVelocityY = instantDeltaY / deltaTime
      panVelocityRef.current = {
        x: panVelocityRef.current.x * 0.5 + instantVelocityX * 0.5,
        y: panVelocityRef.current.y * 0.5 + instantVelocityY * 0.5
      }
    }
    
    lastPanXRef.current = currentX
    lastPanYRef.current = currentY
    lastPanTimeRef.current = currentTime
    
    // HORIZONTAL PAN - Same as vertical: drag direction = chart moves direction
    // Drag LEFT = chart moves LEFT = see older data (what's on the left)
    // Drag RIGHT = chart moves RIGHT = see newer data (what's on the right)
    const chartWidth = containerRef.current?.clientWidth || 800
    const priceAxisW = 75
    const actualChartWidth = chartWidth - priceAxisW - 12 // Match rendering calculation
    
    // Use same calculation as rendering
    const isFullHistory = candleData.length > 400
    const minCandleW = isFullHistory ? 1 : 3
    const maxCandleW = 25
    const requestedCandles = Math.max(1, Math.floor(candleData.length / Math.max(0.1, zoomLevel)))
    const rawCandleW = actualChartWidth / requestedCandles
    const candleW = Math.max(minCandleW, Math.min(maxCandleW, rawCandleW))
    const visibleCount = Math.floor(actualChartWidth / candleW)
    
    const pixelsPerCandle = candleW
    
    // Match vertical behavior: drag direction = view direction
    const deltaCandlesFloat = deltaX / pixelsPerCandle
    
    const newOffset = panStartRef.current.offset + deltaCandlesFloat
    
    // Clamp with boundaries - allow full historical access
    const maxOffset = Math.max(0, candleData.length - visibleCount) // Can scroll to oldest data
    const minOffset = -Math.floor(visibleCount * 0.5) // 50% empty space on right
    
    // SEAMLESS scroll-back: merge the next (prewarmed) older window BEFORE the
    // user reaches the wall, so maxOffset always stays ahead and there is no
    // edge to hit. The window is already warm in _histWindowCache, so the merge
    // is instant. Two triggers:
    //   - APPROACHING (within ~1 screen of the oldest loaded bar): the normal
    //     seamless top-up. Respects hasMoreHistory so it stops at genesis. The
    //     margin is CAPPED at 40% of the scroll range so it can never exceed it
    //     and become always-true (which previously spun a runaway fetch loop).
    //   - OVERSCROLL (dragged past the edge): the user explicitly asking for
    //     more, so it FORCES a fetch - recovering a hasMoreHistory latch that may
    //     have stuck false even though older bars exist.
    // The bump effect keeps the view stable on a prepend (no re-pin at the new
    // edge), so each top-up moves the user away from the edge -> no re-fire loop.
    const margin = Math.min(visibleCount, Math.floor(maxOffset * 0.4))
    const approaching = maxOffset > 0 && hasMoreHistoryRef.current && newOffset > maxOffset - margin
    const overscrolling = newOffset > maxOffset
    if ((approaching || overscrolling) && !loadingMoreRef.current) {
      const now = Date.now()
      if (now - lastFetchTimeRef.current >= 250) { // cache hits are instant; loadingMore guards cold ones
        lastFetchTimeRef.current = now
        fetchMoreHistoryRef.current(overscrolling)
      }
    }
    
    // Hard clamp (no elastic - more stable)
    const clampedOffset = Math.max(minOffset, Math.min(maxOffset, newOffset))
    
    setPanOffset(clampedOffset)
    
    // VERTICAL PAN - Unlimited panning (can go beyond chart data)
    // Drag up = see higher prices (chart moves up)
    // Drag down = see lower prices (chart moves down)
    const priceSensitivity = 8 // Responsive vertical movement
    const deltaPricePercent = deltaY / priceSensitivity
    
    const newPriceOffset = panStartRef.current.priceOff + deltaPricePercent
    
    // Allow unlimited vertical panning (no limits!)
    setPriceOffset(newPriceOffset)
  }, [isPanning, candleData.length, zoomLevel])

  const handlePanEnd = useCallback(() => {
    setIsPanning(false)
    
    // Apply gentle momentum animation for both X and Y
    // Only if velocity is significant (reduces jitter)
    const velocityX = panVelocityRef.current.x
    const velocityY = panVelocityRef.current.y
    const hasMomentum = Math.abs(velocityX) > 0.15 || Math.abs(velocityY) > 0.15 // Higher threshold
    
    if (hasMomentum) {
      // Use same calculation as rendering
      const chartWidth = containerRef.current?.clientWidth || 800
      const priceAxisW = 75
      const actualChartWidth = chartWidth - priceAxisW - 12
      const isFullHistory = candleData.length > 400
      const minCandleW = isFullHistory ? 1 : 3
      const maxCandleW = 25
      const requestedCandles = Math.max(1, Math.floor(candleData.length / Math.max(0.1, zoomLevel)))
      const rawCandleW = actualChartWidth / requestedCandles
      const candleW = Math.max(minCandleW, Math.min(maxCandleW, rawCandleW))
      const visibleCount = Math.floor(actualChartWidth / candleW)
      
      const maxOffset = Math.max(0, candleData.length - visibleCount)
      const minOffset = -Math.floor(visibleCount * 0.5)
      
      const pixelsPerCandle = candleW
      
      let currentVelocityX = velocityX * 0.5 // Reduce initial momentum by 50%
      let currentVelocityY = velocityY * 0.5 // Y momentum for vertical pan
      const friction = 0.92 // Faster deceleration (lower = stops quicker)
      
      const animateMomentum = () => {
        // Decelerate both axes
        currentVelocityX *= friction
        currentVelocityY *= friction
        
        // Stop when both velocities are negligible
        const xDone = Math.abs(currentVelocityX) < 0.02
        const yDone = Math.abs(currentVelocityY) < 0.02
        
        if (xDone && yDone) {
          momentumAnimationRef.current = null
          return
        }
        
        // Apply X velocity to pan offset (matching drag direction)
        if (!xDone) {
          const deltaCandles = (currentVelocityX * 16) / pixelsPerCandle
          
          setPanOffset(prev => {
            let newOffset = prev + deltaCandles
            
            // Hard stop at boundaries
            if (newOffset > maxOffset) {
              currentVelocityX = 0
              return maxOffset
            } else if (newOffset < minOffset) {
              currentVelocityX = 0
              return minOffset
            }
            
            return newOffset
          })
        }
        
        // Apply Y velocity to price offset (unlimited vertical pan)
        if (!yDone) {
          const deltaPricePercent = (currentVelocityY * 16) / 8
          
          setPriceOffset(prev => prev + deltaPricePercent) // No limits!
        }
        
        momentumAnimationRef.current = requestAnimationFrame(animateMomentum)
      }
      
      momentumAnimationRef.current = requestAnimationFrame(animateMomentum)
    }
  }, [candleData.length, zoomLevel])

  // Attach pan event listeners to document for smooth dragging (MOUSE only).
  // Touch is driven by a separate native non-passive listener set bound to the
  // chart container (see the touch effect below) because React attaches its
  // onTouch* props as PASSIVE at the root, which would make preventDefault a
  // no-op and let the page scroll under a chart pan/pinch.
  useEffect(() => {
    if (isPanning) {
      const onMove = (e) => handlePanMove(e)
      const onUp = () => handlePanEnd()

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)

      return () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
    }
  }, [isPanning, handlePanMove, handlePanEnd])

  // ── Touch (mobile) gesture handlers for the native canvas chart ──
  // One finger = pan (reuses the mouse pan path via a synthetic event that
  // skips the e.button check). Two fingers = pinch zoom (time scale on the
  // dominant horizontal axis; price scale when the pinch is mostly vertical).
  // Bound natively + non-passive on the container (see effect) so preventDefault
  // works and the page never scrolls under the gesture. Gated on
  // !effectiveShowTV at the binding effect, exactly like the mouse path.
  const getTouchDistance = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.hypot(dx, dy)
  }

  // Long-press-to-create-alert: 500ms hold, <10px movement, canvas engine
  // only, fires only when onAlertAtPrice is supplied (desktop never passes
  // it, so this whole feature is inert there). Converts the held touch's Y
  // to a price using the EXACT same transform applyHoverAt/the crosshair use
  // (maxPrice - ((y-chartTop)/chartHeight)*priceRange over the last-drawn
  // chartDimensionsRef snapshot), then hands the price to the caller.
  const LONG_PRESS_MS = 500
  const LONG_PRESS_MOVE_TOLERANCE = 10

  const fireLongPressAlert = useCallback((clientX, clientY) => {
    longPressTimerRef.current = null
    const onAlert = onAlertAtPriceRef.current
    if (!onAlert) return
    const canvas = canvasRef.current
    const dims = chartDimensionsRef.current
    if (!canvas || !dims) return
    const rect = canvas.getBoundingClientRect()
    const y = clientY - rect.top
    const { chartTop, chartHeight, priceRange, maxPrice } = dims
    if (!(chartHeight > 0) || !(priceRange > 0)) return
    const price = maxPrice - ((y - chartTop) / chartHeight) * priceRange
    if (!(price > 0) || !isFinite(price)) return
    longPressFiredRef.current = true
    onAlert(price)
  }, [])

  const handleChartTouchStart = useCallback((e) => {
    // Axis handles own their own touch gesture - don't double-handle.
    if (e.target?.classList?.contains?.('axis-drag-handle')) return

    // A fresh touchstart always supersedes any pending long-press from a
    // gesture that didn't clean up (defensive - touchend/touchmove already
    // cancel it in the normal path).
    cancelLongPress()

    if (e.touches.length === 1) {
      // Begin a one-finger pan. Build a mouse-shaped event so handlePanStart's
      // logic (momentum cancel, auto-fit off, velocity reset) runs unchanged,
      // minus the e.button guard which touch events don't carry. Note: touch
      // events keep targeting the start element for the whole gesture, so the
      // pan tracks even if the finger leaves the chart body - no document bind.
      touchModeRef.current = 'pan'
      const t = e.touches[0]
      handlePanStart({ button: 0, clientX: t.clientX, clientY: t.clientY, target: e.target })

      // Arm the long-press timer alongside the pan (both track the same
      // finger; a real pan/pinch cancels this via handleChartTouchMove /
      // the 2nd-finger branch below before the 500ms elapses). Only inside
      // the same plottable box applyHoverAt uses for the crosshair - a hold
      // on the volume strip or empty margin shouldn't spawn an alert.
      if (onAlertAtPriceRef.current) {
        const canvas = canvasRef.current
        const dims = chartDimensionsRef.current
        if (canvas && dims) {
          const rect = canvas.getBoundingClientRect()
          const x = t.clientX - rect.left
          const y = t.clientY - rect.top
          const { chartLeft, chartRight, chartTop, volumeTop, volumeHeight } = dims
          if (x >= chartLeft && x <= chartRight && y >= chartTop && y <= volumeTop + volumeHeight) {
            longPressStartRef.current = { x: t.clientX, y: t.clientY }
            longPressFiredRef.current = false
            longPressTimerRef.current = setTimeout(
              () => fireLongPressAlert(t.clientX, t.clientY),
              LONG_PRESS_MS
            )
          }
        }
      }
    } else if (e.touches.length === 2) {
      // Begin a pinch. Stop any in-flight pan + momentum, snapshot the finger
      // distance and current zoom levels.
      touchModeRef.current = 'pinch'
      setIsPanning(false)
      if (momentumAnimationRef.current) {
        cancelAnimationFrame(momentumAnimationRef.current)
        momentumAnimationRef.current = null
      }
      const dx = Math.abs(e.touches[0].clientX - e.touches[1].clientX)
      const dy = Math.abs(e.touches[0].clientY - e.touches[1].clientY)
      pinchStartRef.current = {
        dist: getTouchDistance(e.touches),
        zoom: zoomLevel,
        priceZoom: priceZoom,
        vertical: dy > dx, // mostly-vertical pinch -> price scale
      }
    }
  }, [handlePanStart, zoomLevel, priceZoom, cancelLongPress, fireLongPressAlert])

  const handleChartTouchMove = useCallback((e) => {
    // Any real movement (>10px) or a gesture that isn't a clean single-finger
    // hold anymore (pinch) kills a pending long-press before it can fire -
    // this is what keeps a pan/pinch from ever also opening the alert sheet.
    if (longPressTimerRef.current) {
      if (e.touches.length !== 1) {
        cancelLongPress()
      } else {
        const t0 = e.touches[0]
        const dx = t0.clientX - longPressStartRef.current.x
        const dy = t0.clientY - longPressStartRef.current.y
        if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) cancelLongPress()
      }
    }

    if (touchModeRef.current === 'pan') {
      if (e.touches.length !== 1) return
      if (e.cancelable) e.preventDefault()
      const t = e.touches[0]
      handlePanMove({ clientX: t.clientX, clientY: t.clientY })
      return
    }
    if (touchModeRef.current !== 'pinch') return
    if (e.touches.length !== 2) return
    if (e.cancelable) e.preventDefault()

    const start = pinchStartRef.current
    if (!start.dist) return
    const newDist = getTouchDistance(e.touches)
    const ratio = newDist / start.dist
    if (!isFinite(ratio) || ratio <= 0) return

    setAutoFitPrice(false)

    if (start.vertical) {
      // Vertical pinch -> price (Y) zoom. Match the wheel handler's 0.1..10
      // clamp. Spreading fingers apart (ratio > 1) zooms in.
      const next = Math.max(0.1, Math.min(10, start.priceZoom * ratio))
      setPriceZoom(next)
    } else {
      // Horizontal pinch -> time (X) zoom. Use the SAME zoom limits the wheel
      // handler computes so pinch and scroll agree on the bounds.
      const minVisibleCandles = 20
      const maxVisibleCandles = Math.max(minVisibleCandles, candleData.length)
      const minZoom = candleData.length / maxVisibleCandles
      const maxZoom = candleData.length / minVisibleCandles
      const minAllowedZoom = Math.min(0.5, minZoom)
      const next = Math.max(minAllowedZoom, Math.min(maxZoom, start.zoom * ratio))
      setZoomLevel(next)
    }
  }, [handlePanMove, candleData.length, cancelLongPress])

  const handleChartTouchEnd = useCallback((e) => {
    // Always clear a pending long-press on lift - a tap or a pan/pinch
    // release both end the gesture before the 500ms hold completes.
    cancelLongPress()
    if (longPressFiredRef.current) {
      // The hold already fired and opened the alert sheet - eat the
      // synthetic click some browsers dispatch ~300ms after touchend so it
      // can't land on whatever the sheet reveals underneath.
      longPressFiredRef.current = false
      if (e.cancelable) e.preventDefault()
    }
    if (touchModeRef.current === 'pan') {
      // End the pan (applies momentum). If a finger remains it's because the
      // user lifted one of two - fall through to re-evaluate below.
      if (e.touches.length === 0) {
        touchModeRef.current = null
        handlePanEnd()
        return
      }
    }
    if (touchModeRef.current === 'pinch') {
      touchModeRef.current = null
      pinchStartRef.current = { dist: 0, zoom: 1, priceZoom: 1, vertical: false }
    }
    // One finger left after a pinch (or after lifting one of two): hand off to a
    // fresh pan so pinch-then-drag stays continuous instead of going dead.
    if (e.touches.length === 1) {
      const t = e.touches[0]
      touchModeRef.current = 'pan'
      handlePanStart({ button: 0, clientX: t.clientX, clientY: t.clientY, target: e.target })
    } else if (e.touches.length === 0) {
      touchModeRef.current = null
      handlePanEnd()
    }
  }, [handlePanStart, handlePanEnd, cancelLongPress])

  // Bind the touch gesture set natively (non-passive) on the chart container so
  // preventDefault works (React's onTouch* props are passive at the root). Only
  // while the native canvas chart is showing - the TradingView iframe and the
  // holders chart own their own touch handling. Mirrors the wheel effect above.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (effectiveShowTV || holdersChartActive) return

    container.addEventListener('touchstart', handleChartTouchStart, { passive: false })
    container.addEventListener('touchmove', handleChartTouchMove, { passive: false })
    container.addEventListener('touchend', handleChartTouchEnd)
    container.addEventListener('touchcancel', handleChartTouchEnd)
    return () => {
      container.removeEventListener('touchstart', handleChartTouchStart)
      container.removeEventListener('touchmove', handleChartTouchMove)
      container.removeEventListener('touchend', handleChartTouchEnd)
      container.removeEventListener('touchcancel', handleChartTouchEnd)
      // A held finger mid-timer when the engine swaps (TV<->canvas) or the
      // component unmounts must not fire into a torn-down chart.
      cancelLongPress()
    }
  }, [effectiveShowTV, holdersChartActive, handleChartTouchStart, handleChartTouchMove, handleChartTouchEnd, cancelLongPress])

  // Cleanup momentum animation on unmount
  useEffect(() => {
    return () => {
      if (momentumAnimationRef.current) {
        cancelAnimationFrame(momentumAnimationRef.current)
      }
    }
  }, [])

  // Double-click to reset chart view (like TradingView)
  const handleDoubleClick = useCallback((e) => {
    // Fit to the SAME default the chart opens at: 'All' shows the entire history,
    // every other timeframe opens at ~70 candles. Reuses the load-time formula so
    // "Fit" returns to the opening view (and the Fit button hides afterwards).
    const optimalZoom = timeframe === 'All'
      ? 1
      : Math.max(1, Math.ceil(candleData.length / 70))
    fitZoomRef.current = optimalZoom
    setZoomLevel(optimalZoom)
    setPanOffset(0) // Reset to current price (newest data on right)
    setPriceOffset(0) // Reset vertical pan
    setPriceZoom(1)
    setAutoFitPrice(true)
  }, [candleData.length, timeframe])

  // Reset the TV "Fit" affordance when the chart context changes (new timeframe or
  // token) - the programmatic re-fit that follows must not read as a user zoom.
  useEffect(() => { setTvZoomed(false) }, [timeframe, token?.address])

  // Price axis drag handlers - drag up/down to zoom price scale
  const handlePriceAxisDragStart = (e) => {
    e.preventDefault()
    setIsDraggingPriceAxis(true)
    setAutoFitPrice(false) // Disable auto-fit when manually adjusting
    dragStartRef.current = { x: 0, y: e.clientY, value: priceZoom }
    document.addEventListener('mousemove', handlePriceAxisDrag)
    document.addEventListener('mouseup', handlePriceAxisDragEnd)
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
    document.removeEventListener('mousemove', handlePriceAxisDrag)
    document.removeEventListener('mouseup', handlePriceAxisDragEnd)
  }

  // Time axis drag handlers - drag left/right to zoom time scale
  const handleTimeAxisDragStart = (e) => {
    e.preventDefault()
    setIsDraggingTimeAxis(true)
    dragStartRef.current = { x: e.clientX, y: 0, value: zoomLevel }
    document.addEventListener('mousemove', handleTimeAxisDrag)
    document.addEventListener('mouseup', handleTimeAxisDragEnd)
  }

  const handleTimeAxisDrag = (e) => {
    const deltaX = e.clientX - dragStartRef.current.x
    // Drag right = zoom out (see more candles), drag left = zoom in (see fewer candles)
    // Use exponential scaling for smoother feel
    const zoomMultiplier = Math.pow(1.005, -deltaX) // Exponential zoom
    
    // Zoom limits - allow zooming out to the full loaded history on every
    // timeframe (was capped at 400 candles for non-1D). Render clamps candle
    // width >=1px so on-screen count stays bounded by the chart width.
    const maxVisibleCandles = Math.max(20, candleData.length)
    const minZoom = Math.min((timeframe === '1D' || timeframe === 'All') ? 0.1 : 0.5, candleData.length / maxVisibleCandles)
    const maxZoom = candleData.length / 20 // At least 20 candles visible

    const newZoom = Math.max(minZoom, Math.min(maxZoom, dragStartRef.current.value * zoomMultiplier))
    setZoomLevel(newZoom)
  }

  const handleTimeAxisDragEnd = () => {
    setIsDraggingTimeAxis(false)
    document.removeEventListener('mousemove', handleTimeAxisDrag)
    document.removeEventListener('mouseup', handleTimeAxisDragEnd)
  }

  // ── Touch variants of the axis-drag zoom handles (mobile) ──
  // Each reuses the existing mouse drag math by adapting touches[0] into the
  // {clientX, clientY} shape the *Drag handlers read, and binds touchmove/
  // touchend to document so the gesture tracks even past the handle's bounds.
  // Bound non-passive so preventDefault stops the page scrolling under it.
  const handlePriceAxisTouchMove = (e) => {
    if (e.touches.length !== 1) return
    if (e.cancelable) e.preventDefault()
    handlePriceAxisDrag({ clientY: e.touches[0].clientY })
  }
  const handlePriceAxisTouchEnd = () => {
    handlePriceAxisDragEnd()
    document.removeEventListener('touchmove', handlePriceAxisTouchMove)
    document.removeEventListener('touchend', handlePriceAxisTouchEnd)
    document.removeEventListener('touchcancel', handlePriceAxisTouchEnd)
  }
  const handlePriceAxisTouchStart = (e) => {
    if (e.touches.length !== 1) return
    // No preventDefault here - this is React's (passive) onTouchStart, so it
    // would no-op + warn. CSS `touch-action: none` on .axis-drag-handle stops
    // the page scroll; the non-passive touchmove below does the real blocking.
    setIsDraggingPriceAxis(true)
    setAutoFitPrice(false)
    dragStartRef.current = { x: 0, y: e.touches[0].clientY, value: priceZoom }
    document.addEventListener('touchmove', handlePriceAxisTouchMove, { passive: false })
    document.addEventListener('touchend', handlePriceAxisTouchEnd)
    document.addEventListener('touchcancel', handlePriceAxisTouchEnd)
  }

  const handleTimeAxisTouchMove = (e) => {
    if (e.touches.length !== 1) return
    if (e.cancelable) e.preventDefault()
    handleTimeAxisDrag({ clientX: e.touches[0].clientX })
  }
  const handleTimeAxisTouchEnd = () => {
    handleTimeAxisDragEnd()
    document.removeEventListener('touchmove', handleTimeAxisTouchMove)
    document.removeEventListener('touchend', handleTimeAxisTouchEnd)
    document.removeEventListener('touchcancel', handleTimeAxisTouchEnd)
  }
  const handleTimeAxisTouchStart = (e) => {
    if (e.touches.length !== 1) return
    // See note in handlePriceAxisTouchStart - no preventDefault on the passive
    // React touchstart; CSS touch-action + the non-passive touchmove handle it.
    setIsDraggingTimeAxis(true)
    dragStartRef.current = { x: e.touches[0].clientX, y: 0, value: zoomLevel }
    document.addEventListener('touchmove', handleTimeAxisTouchMove, { passive: false })
    document.addEventListener('touchend', handleTimeAxisTouchEnd)
    document.addEventListener('touchcancel', handleTimeAxisTouchEnd)
  }

  // Format volume value
  const formatVolume = (value) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`
    return `$${value.toFixed(0)}`
  }

  // Format date
  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    })
  }

  // Keyboard shortcuts - terminal-grade UX
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Skip if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      // Skip if modifier keys are held (allow browser shortcuts)
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const key = e.key.toLowerCase()
      const tfMap = { '1': '1m', '2': '5m', '3': '15m', '4': '1H', '5': '4H', '6': '1D', '7': '12H', '8': '1W', '9': '1M' }

      if (tfMap[key]) {
        e.preventDefault()
        setTimeframe(tfMap[key])
      } else if (key === 'c') {
        e.preventDefault()
        setChartType('candles')
        setShowTradingView(false) // Candles/Line use our custom canvas, not TV
      } else if (key === 'l') {
        e.preventDefault()
        setChartType('line')
        setShowTradingView(false)
      } else if (key === 'h') {
        e.preventDefault()
        setChartType('holders')
        setShowTradingView(false)
      } else if (key === 't') {
        e.preventDefault()
        setShowTradingView(true)
      } else if (key === 'f') {
        e.preventDefault()
        setIsFullscreen(prev => !prev)
      } else if (key === 'v') {
        e.preventDefault()
        setShowVWAP(prev => {
          const next = !prev
          localStorage.setItem('spectre-showVWAP', next.toString())
          return next
        })
      } else if (key === 'a') {
        e.preventDefault()
        setShowATHLines(prev => !prev)
      } else if (key === 'escape' && isFullscreen) {
        setIsFullscreen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen])

  return (
    <div
      ref={chartRootRef}
      className={`trading-chart tick-streak-host ${isFullscreen ? 'fullscreen' : ''} ${isCollapsed ? 'collapsed' : ''}`}
    >
      {/* v2 Observatory: tick-streak-host class enables FX1 (price-tick light
          streak across the top border). The effect above writes data-tick
          directly via ref — zero React state churn. Chart corner dot-pins
          deferred (collision with TV's native price axis + dense toolbar). */}
      {/* Close button for fullscreen mode - top right */}
      {isFullscreen && chartViewMode !== 'xBubbles' && (
        <button 
          className="fullscreen-close-btn"
          onClick={() => setIsFullscreen(false)}
          title="Exit Fullscreen (ESC)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
      {/* Chart Controls */}
      <div className={`chart-controls${tfDropdownOpen || typesMoreOpen || toolsMoreOpen ? ' controls-active' : ''}`}>
        {/* Left side: Chart types and timeframes */}
        <div className="chart-controls-left">
          {/* Chart Type Buttons - Clicking switches back to trading view */}
          <div className="chart-types">
            <button
              className={`type-btn tradingview-btn ${chartViewMode === 'trading' && effectiveShowTV ? 'active' : ''}`}
              onClick={() => {
                setShowTradingView(true)
                if (chartViewMode === 'xBubbles' && setChartViewMode) {
                  setChartViewMode('trading')
                }
              }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setButtonTooltip({ 
                  visible: true, 
                  text: 'TradingView Charts', 
                  x: rect.left + rect.width / 2, 
                  y: rect.top - 8 
                })
              }}
              onMouseLeave={() => setButtonTooltip({ visible: false, text: '', x: 0, y: 0 })}
            >
              <BarChart3 size={14} strokeWidth={1.75} />
            </button>
            <button
              className={`type-btn ${!effectiveShowTV && chartType === 'candles' ? 'active' : ''}`}
              title="Candles"
              onClick={() => { setChartType('candles'); setShowTradingView(false) }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setButtonTooltip({ visible: true, text: 'Candlestick', x: rect.left + rect.width / 2, y: rect.top - 8 })
              }}
              onMouseLeave={() => setButtonTooltip({ visible: false, text: '', x: 0, y: 0 })}
            >
              <CandlestickChart className="type-icon" size={14} strokeWidth={1.75} />
              <span className="type-label">Candles</span>
            </button>
            <button
              className={`type-btn ${!effectiveShowTV && chartType === 'line' ? 'active' : ''}`}
              title="Line"
              onClick={() => { setChartType('line'); setShowTradingView(false) }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setButtonTooltip({ visible: true, text: 'Line', x: rect.left + rect.width / 2, y: rect.top - 8 })
              }}
              onMouseLeave={() => setButtonTooltip({ visible: false, text: '', x: 0, y: 0 })}
            >
              <LineChartIcon className="type-icon" size={14} strokeWidth={1.75} />
              <span className="type-label">Line</span>
            </button>
            <button
              className="type-btn is-locked"
              title="Holders (Coming Soon)"
              aria-disabled="true"
              onClick={() => triggerCopyToast('Coming Soon')}
            >
              <Users className="type-icon" size={14} strokeWidth={1.75} />
              <span className="type-label">Holders</span>
              <Lock className="type-lock" size={9} strokeWidth={2.4} aria-hidden="true" />
            </button>
            
            {/* Overflow: collapses the locked Candles/Line/Holders placeholders
                into a menu when the toolbar narrows (CSS-shown at <=980). */}
            <div className="chart-types-more" ref={typesMoreRef}>
              <button
                type="button"
                className="tf-btn tf-more-trigger chart-more-trigger"
                aria-haspopup="menu"
                aria-expanded={typesMoreOpen}
                onClick={() => { setToolsMoreOpen(false); setTypesMoreOpen(v => !v) }}
              >
                Types
                <ChevronDown size={12} strokeWidth={2} className={`tf-chevron ${typesMoreOpen ? 'open' : ''}`} />
              </button>
              {typesMoreOpen && (
                <div className="tf-dropdown-menu chart-more-menu" role="menu">
                  {[
                    { label: 'Candles', value: 'candles', Icon: CandlestickChart, locked: false },
                    { label: 'Line', value: 'line', Icon: LineChartIcon, locked: false },
                    { label: 'Holders', value: 'holders', Icon: Users, locked: true },
                  ].map(({ label, value, Icon, locked }) => (
                    <button
                      key={label}
                      className={`tf-dropdown-item ${locked ? 'is-locked' : ''} ${!locked && !effectiveShowTV && chartType === value ? 'active' : ''}`}
                      role="menuitem"
                      onClick={() => {
                        if (locked) { triggerCopyToast('Coming Soon'); setTypesMoreOpen(false); return }
                        setChartType(value); setShowTradingView(false); setTypesMoreOpen(false)
                      }}
                    >
                      <span className="chart-more-item-label">
                        <Icon size={14} strokeWidth={2} aria-hidden="true" />
                        {label}
                      </span>
                      {locked && <Lock size={10} strokeWidth={2.4} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* MCap/Price Toggle - MCap first, it is the default. */}
            <div className="price-mcap-toggle">
              <button
                className={`toggle-btn ${yAxisMode === 'mcap' ? 'active' : ''}`}
                onClick={() => setYAxisMode('mcap')}
              >
                MCap
              </button>
              <span className="pm-sep" aria-hidden="true">/</span>
              <button
                className={`toggle-btn ${yAxisMode === 'price' ? 'active' : ''}`}
                onClick={() => setYAxisMode('price')}
              >
                Price
              </button>
            </div>
          </div>

          {/* Timeframe Selector - Show primary timeframes + dropdown for more */}
          <div className="timeframes">
            {/* Show first 6 timeframes as buttons (1m..12H), rest in dropdown */}
            {timeframes.slice(0, 6).map(tf => (
              <button
                key={tf}
                className={`tf-btn ${timeframe === tf ? 'active' : ''}`}
                onClick={() => setTimeframe(tf)}
                onMouseEnter={() => prefetchChartBars(chartSymbol, chartNetworkId, timeframeToResolution[tf] || '60')}
              >
                {tf}
              </button>
            ))}

            {/* Dropdown for remaining timeframes */}
            <div className="tf-more-dropdown">
              <button 
                ref={tfDropdownBtnRef}
                className={`tf-btn tf-more-trigger ${timeframes.slice(6).includes(timeframe) ? 'active' : ''}`}
                onClick={() => {
                  if (!tfDropdownOpen && tfDropdownBtnRef.current) {
                    const rect = tfDropdownBtnRef.current.getBoundingClientRect()
                    setTfDropdownPos({
                      top: rect.bottom + 8,
                      right: window.innerWidth - rect.right
                    })
                  }
                  setTfDropdownOpen(!tfDropdownOpen)
                }}
              >
                {timeframes.slice(6).includes(timeframe) ? timeframe : 'More'}
                <ChevronDown size={12} strokeWidth={2} className={`tf-chevron ${tfDropdownOpen ? 'open' : ''}`} />
              </button>
              {tfDropdownOpen && (
                <div 
                  className="tf-dropdown-menu tf-dropdown-fixed"
                  style={{ top: tfDropdownPos.top, right: tfDropdownPos.right }}
                >
                  {timeframes.slice(6).map(tf => (
                    <button
                      key={tf}
                      className={`tf-dropdown-item ${timeframe === tf ? 'active' : ''}`}
                      onClick={() => {
                        setTimeframe(tf)
                        setTfDropdownOpen(false)
                      }}
                      onMouseEnter={() => prefetchChartBars(chartSymbol, chartNetworkId, timeframeToResolution[tf] || '60')}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right side: Tools (always visible) */}
        <div className="chart-controls-right">
          {/* Chart's own style: background, candles, line, axis, grid —
              independent from the platform Appearance studio. Candles vs
              Line sections follow the active chart type; TV mode shows
              both (its series type is switched inside the widget). */}
          <ChartStyleControl chartType={chartType} isTV={effectiveShowTV} />
          {/* Overflow: collapses the locked tool placeholders (heatmap/ATH/VWAP/
              indicators/draw/fullscreen) into a menu when the toolbar narrows
              further (CSS-shown at <=890). */}
          <div className="chart-tools-more" ref={toolsMoreRef}>
            <button
              type="button"
              className="tf-btn tf-more-trigger chart-more-trigger"
              aria-haspopup="menu"
              aria-expanded={toolsMoreOpen}
              aria-label="Chart tools"
              onClick={() => { setTypesMoreOpen(false); setToolsMoreOpen(v => !v) }}
            >
              Tools
              <ChevronDown size={12} strokeWidth={2} className={`tf-chevron ${toolsMoreOpen ? 'open' : ''}`} />
            </button>
            {toolsMoreOpen && (
              <div className="tf-dropdown-menu tf-dropdown-menu--right chart-more-menu" role="menu">
                {[
                  { label: 'Heatmap', Icon: LayoutGrid },
                  { label: 'ATH', Icon: TrendingUp },
                  { label: 'VWAP', Icon: Activity },
                  { label: 'Indicators', Icon: Waves },
                  { label: 'Drawing', Icon: PenLine },
                  { label: 'Fullscreen', Icon: Maximize2 },
                ].map(({ label, Icon }) => (
                  <button
                    key={label}
                    className="tf-dropdown-item is-locked"
                    role="menuitem"
                    onClick={() => { triggerCopyToast('Coming Soon'); setToolsMoreOpen(false) }}
                  >
                    <span className="chart-more-item-label">
                      <Icon size={14} strokeWidth={2} aria-hidden="true" />
                      {label}
                    </span>
                    <Lock size={10} strokeWidth={2.4} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="chart-tools">
            <button
              className="tool-btn heatmap-btn is-locked"
              data-tooltip="Heatmap View (Coming Soon)"
              aria-disabled="true"
              onClick={() => triggerCopyToast('Coming Soon')}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setButtonTooltip({
                  visible: true,
                  text: 'Heatmap View (Coming Soon)',
                  x: rect.left + rect.width / 2,
                  y: rect.top - 8
                })
              }}
              onMouseLeave={() => setButtonTooltip({ visible: false, text: '', x: 0, y: 0 })}
            >
              <LayoutGrid size={14} strokeWidth={1.75} />
              <Lock className="tool-lock" size={8} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <button
              className="tool-btn ath-btn is-locked"
              data-tooltip="ATH & Local High (Coming Soon)"
              aria-disabled="true"
              onClick={() => triggerCopyToast('Coming Soon')}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setButtonTooltip({
                  visible: true,
                  text: 'ATH & Local High (Coming Soon)',
                  x: rect.left + rect.width / 2,
                  y: rect.top - 8
                })
              }}
              onMouseLeave={() => setButtonTooltip({ visible: false, text: '', x: 0, y: 0 })}
            >
              <TrendingUp size={14} strokeWidth={1.75} />
              <Lock className="tool-lock" size={8} strokeWidth={2.4} aria-hidden="true" />
            </button>
            {showTradingView && (
              <button
                className="tool-btn vwap-btn is-locked"
                data-tooltip="VWAP (Coming Soon)"
                aria-disabled="true"
                onClick={() => triggerCopyToast('Coming Soon')}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setButtonTooltip({
                    visible: true,
                    text: 'VWAP (Coming Soon)',
                    x: rect.left + rect.width / 2,
                    y: rect.top - 8
                  })
                }}
                onMouseLeave={() => setButtonTooltip({ visible: false, text: '', x: 0, y: 0 })}
              >
                <Activity size={14} strokeWidth={1.75} />
                <Lock className="tool-lock" size={8} strokeWidth={2.4} aria-hidden="true" />
              </button>
            )}
            <button
              className="tool-btn is-locked"
              data-tooltip="Indicators (Coming Soon)"
              aria-disabled="true"
              onClick={() => triggerCopyToast('Coming Soon')}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setButtonTooltip({
                  visible: true,
                  text: 'Indicators (Coming Soon)',
                  x: rect.left + rect.width / 2,
                  y: rect.top - 8
                })
              }}
              onMouseLeave={() => setButtonTooltip({ visible: false, text: '', x: 0, y: 0 })}
            >
              <Waves size={14} strokeWidth={1.75} />
              <Lock className="tool-lock" size={8} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <button
              className={`tool-btn draw-btn ${effectiveShowTV ? '' : 'is-locked'}`}
              data-tooltip={effectiveShowTV ? 'Drawing tools' : 'Drawing Tools (Coming Soon)'}
              aria-disabled={effectiveShowTV ? undefined : 'true'}
              onClick={() => {
                // TV mode: toggles the (default-collapsed) drawing rail.
                // Canvas modes have no drawing support yet.
                if (!effectiveShowTV) { triggerCopyToast('Coming Soon'); return }
                setTvDrawNonce(n => n + 1)
              }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setButtonTooltip({
                  visible: true,
                  text: effectiveShowTV ? 'Drawing tools' : 'Drawing Tools (Coming Soon)',
                  x: rect.left + rect.width / 2,
                  y: rect.top - 8
                })
              }}
              onMouseLeave={() => setButtonTooltip({ visible: false, text: '', x: 0, y: 0 })}
            >
              <PenLine size={14} strokeWidth={1.75} />
              {!effectiveShowTV && <Lock className="tool-lock" size={8} strokeWidth={2.4} aria-hidden="true" />}
            </button>
            <button
              className="tool-btn is-locked"
              data-tooltip="Fullscreen (Coming Soon)"
              aria-disabled="true"
              onClick={() => triggerCopyToast('Coming Soon')}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setButtonTooltip({
                  visible: true,
                  text: 'Fullscreen (Coming Soon)',
                  x: rect.left + rect.width / 2,
                  y: rect.top - 8
                })
              }}
              onMouseLeave={() => setButtonTooltip({ visible: false, text: '', x: 0, y: 0 })}
            >
              <Lock className="tool-lock" size={8} strokeWidth={2.4} aria-hidden="true" />
              {isFullscreen ? (
                <Minimize2 size={14} strokeWidth={1.75} />
              ) : (
                <Maximize2 size={14} strokeWidth={1.75} />
              )}
            </button>
          </div>
          
          {/* Single "Fit" button - appears ONLY once the user has zoomed/panned away
              from the default view, on EITHER chart. Canvas: zoomLevel/priceZoom/pan
              left the opening fit (fitZoomRef). TV: the widget reported a user range
              change (onVisibleRangeChanged, past the initial settle). Click fits back:
              canvas -> handleDoubleClick, TV -> chartReset via the nonce. */}
          {(() => {
            const canvasZoomed = fitZoomRef.current !== null && (
              zoomLevel !== fitZoomRef.current || priceZoom !== 1 || panOffset !== 0 || priceOffset !== 0
            )
            const showFit = effectiveShowTV ? tvZoomed : canvasZoomed
            if (!showFit) return null
            const onFit = effectiveShowTV
              ? () => { setTvResetNonce(n => n + 1); setTvZoomed(false) }
              : () => handleDoubleClick()
            return (
              <div className="zoom-indicators">
                <div
                  className="zoom-indicator"
                  onClick={onFit}
                  data-tooltip="Fit chart to view"
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    setButtonTooltip({ visible: true, text: 'Fit chart to view', x: rect.left + rect.width / 2, y: rect.top - 8 })
                  }}
                  onMouseLeave={() => setButtonTooltip({ visible: false, text: '', x: 0, y: 0 })}
                >
                  Fit
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {/* Chart Content Area - maintains consistent height */}
      <div className="chart-content-area" style={isFullscreen ? undefined : { height: `${chartHeight}px`, minHeight: 0, flex: 'none' }}>
        {/* OHLCV Data Legend - Bloomberg-style persistent overlay (native charts only, TV Advanced has its own) */}
        {!effectiveShowTV && chartViewMode === 'trading' && (chartType === 'candles' || chartType === 'line') && !isCollapsed && (
          <div className={`ohlcv-legend${ohlcvLegend ? ' ohlcv-legend--active' : ''}`}>
            <span className="ohlcv-legend-symbol">{token?.symbol || 'TOKEN'}</span>
            <span className="ohlcv-legend-tf">{timeframe}</span>
            {ohlcvLegend ? (
              <>
                <span className="ohlcv-legend-label">O</span>
                <span className={`ohlcv-legend-value${ohlcvLegend.close >= ohlcvLegend.open ? ' bull' : ' bear'}`}>
                  {formatTokenPrice(ohlcvLegend.open)}
                </span>
                <span className="ohlcv-legend-label">H</span>
                <span className={`ohlcv-legend-value${ohlcvLegend.close >= ohlcvLegend.open ? ' bull' : ' bear'}`}>
                  {formatTokenPrice(ohlcvLegend.high)}
                </span>
                <span className="ohlcv-legend-label">L</span>
                <span className={`ohlcv-legend-value${ohlcvLegend.close >= ohlcvLegend.open ? ' bull' : ' bear'}`}>
                  {formatTokenPrice(ohlcvLegend.low)}
                </span>
                <span className="ohlcv-legend-label">C</span>
                <span className={`ohlcv-legend-value${ohlcvLegend.close >= ohlcvLegend.open ? ' bull' : ' bear'}`}>
                  {formatTokenPrice(ohlcvLegend.close)}
                </span>
                <span className="ohlcv-legend-label">V</span>
                <span className="ohlcv-legend-value">
                  {formatLargeNumber(ohlcvLegend.volume)}
                </span>
                <span className={`ohlcv-legend-change${ohlcvLegend.close >= ohlcvLegend.open ? ' bull' : ' bear'}`}>
                  {ohlcvLegend.close >= ohlcvLegend.open ? '+' : ''}{(((ohlcvLegend.close - ohlcvLegend.open) / ohlcvLegend.open) * 100).toFixed(2)}%
                </span>
              </>
            ) : (
              <span className="ohlcv-legend-hint">Hover chart for OHLCV</span>
            )}
          </div>
        )}

        {/* X Bubbles View */}
        {chartViewMode === 'xBubbles' && (
          <div 
            className={`x-bubbles-container ${isDarkMode ? 'dark-theme' : 'light-theme'} ${isFullscreen ? 'fullscreen-bubbles' : ''} mode-${viewMode.toLowerCase()} ${isNavigating ? 'navigating' : ''} ${isBubblesPanning ? 'panning' : ''}`} 
            ref={bubblesContainerRef}
            onMouseDown={viewMode === '3D' ? handle3DMouseDown : (viewMode === '2D' ? handleBubblesPanStart : undefined)}
            onMouseMove={viewMode === '3D' ? handle3DMouseMove : undefined}
            onMouseUp={viewMode === '3D' ? handle3DMouseUp : undefined}
            onMouseLeave={viewMode === '3D' ? handle3DMouseUp : (viewMode === '2D' ? handleBubblesPanEnd : undefined)}
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
            style={{ 
              transform: viewMode === '2D' 
                ? `translate3d(${bubblesPan.x}%, ${bubblesPan.y}%, 0) scale(${bubblesZoom})`
                : `scale(${bubblesZoom})`,
              transformOrigin: 'center center',
              backfaceVisibility: 'hidden',
              perspective: 1000
            }}
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
                  <img src={bubble.avatar} alt={bubble.user} />
                </div>
                
                {selectedBubble === bubble.id && !isCenter && (
                  <div className="kol-bubble-tooltip">
                    <button className="tooltip-close" onClick={(e) => { e.stopPropagation(); setSelectedBubble(null); }}>×</button>
                    <div className="tooltip-header">
                      <img src={bubble.avatar} alt={bubble.user} className="tooltip-avatar" />
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
                <span>🕐</span> {timeFilterOptions.find(t => t.value === timeFilter)?.label || 'All time'}
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
                title="Exit Fullscreen"
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
                    onClick={() => setBubblesZoom(prev => Math.min(prev * 1.3, 2.0))}
                    title="Zoom In"
                  >+</button>
                  <span className="zoom-level">{Math.round(bubblesZoom * 100)}%</span>
                  <button 
                    className="zoom-btn" 
                    onClick={() => setBubblesZoom(prev => Math.max(prev * 0.7, 0.2))}
                    title="Zoom Out (show more bubbles)"
                  >−</button>
                  <button 
                    className="fit-btn"
                    onClick={() => {
                      setBubblesZoom(0.6)
                      setBubblesPan({ x: 0, y: 0 })
                    }}
                    title="Reset zoom and pan to center"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                      <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 01-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 01-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 011.414 1.414L6.414 15H8a1 1 0 010 2H4a1 1 0 01-1-1v-4zm13-1a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 010-2h1.586l-2.293-2.293a1 1 0 111.414-1.414L15 13.586V12a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                    Reset
                  </button>
                  {(bubblesPan.x !== 0 || bubblesPan.y !== 0) && (
                    <button 
                      className="fit-btn"
                      onClick={() => setBubblesPan({ x: 0, y: 0 })}
                      title="Reset pan to center"
                      style={{ marginLeft: '4px' }}
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                        <path d="M10 2L3 7v11h4v-6h6v6h4V7l-7-5z" />
                      </svg>
                      Center
                    </button>
                  )}
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

      {/* Chart Canvas */}
      <div
        className={`chart-body ${chartViewMode === 'xBubbles' ? 'hidden' : ''}`}
        ref={containerRef}
        onMouseMove={!effectiveShowTV ? handleMouseMove : undefined}
        onMouseLeave={!effectiveShowTV ? handleMouseLeave : undefined}
        onMouseDown={!effectiveShowTV ? handlePanStart : undefined}
        onDoubleClick={!effectiveShowTV ? handleDoubleClick : undefined}
        style={{ cursor: effectiveShowTV ? 'default' : (isPanning ? 'grabbing' : 'crosshair') }}
      >
        {/* TradingView Advanced Charting Library */}
        {effectiveShowTV && (
          <div
            className="tradingview-container tradingview-advanced"
            style={{
              width: '100%',
              height: '100%',
              position: 'absolute',
              top: 0,
              left: 0,
              zIndex: 1,
              borderRadius: '12px',
              overflow: 'hidden',
              pointerEvents: 'auto',
              cursor: 'default',
            }}
          >
            {/* Loading overlay while TradingView Advanced builds + fetches bars.
                Hides on onChartReady, or after the 8s shimmer budget. */}
            {!tvChartReady && chartShimmerVisible && <ChartLoader />}
            <TradingViewAdvanced
              symbol={token?.symbol || 'BTC'}
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              dayMode={dayMode}
              token={token}
              referencePrice={stats?.price ? parseFloat(stats.price) : undefined}
              onChartReady={(w, chart) => {
                // Capture the chart handle for the Spotted-receipt shape;
                // epoch bump re-runs the draw effect on every widget rebuild.
                tvAdvChartRef.current = chart || null
                tvSpottedShapeRef.current = null
                // Same reset for alert-line shapes — the old widget instance
                // is gone, so any ids from it are stale (removeEntity would
                // just no-op/throw against the new chart).
                tvAlertShapesRef.current = []
                setTvChartEpoch((e) => e + 1)
                setTvChartReady(true)
              }}
              onNoData={() => {
                // TV Advanced has no data (or failed to build) for this token.
                // Fall back to the lightweight chart. tvNoData resets on token
                // change so the next token retries TV. Drop the TV shimmer so
                // we don't stack two loading states.
                setTvNoData(true)
                setTvChartReady(true)
              }}
              yAxisMode={yAxisMode}
              circSupply={(() => {
                // Prefer explicit circulating supply; fall back to
                // marketCap / price (many tokens — SPECTRE included —
                // expose marketCap but not a circulatingSupply field, so
                // without this the MCap toggle would silently no-op).
                const cs = parseFloat(liveTokenData?.circulatingSupply) || 0
                if (cs > 0) return cs
                const mc = parseFloat(liveTokenData?.marketCap) || 0
                const px = parseFloat(liveTokenData?.price) || parseFloat(stats?.price) || parseFloat(token?.price) || 0
                return (mc > 0 && px > 0) ? mc / px : 0
              })()}
              resetNonce={tvResetNonce}
              drawNonce={tvDrawNonce}
              pairAddress={resolvedPairAddress}
              pairSide={resolvedPairSide}
              onUserZoom={() => setTvZoomed(true)}
            />
          </div>
        )}
        
        {/* Holders Lightweight Chart */}
        {holdersChartActive && (
          <div
            ref={holdersChartContainerRef}
            className="holders-inline-chart"
            style={{
              width: '100%',
              height: '100%',
              position: 'absolute',
              top: 0,
              left: 0,
              zIndex: 2,
              borderRadius: '12px',
              overflow: 'hidden',
            }}
          >
            {holdersChartLoading && !holdersChartData?.length && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, zIndex: 5 }}>
                <div style={{ width: 32, height: 32, border: '2px solid rgba(139, 92, 246, 0.2)', borderTopColor: 'rgba(139, 92, 246, 0.8)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <span style={{ color: 'rgba(245,245,247,0.4)', fontSize: 12, letterSpacing: '0.5px' }}>Loading holders...</span>
              </div>
            )}
          </div>
        )}

        {/* Native Canvas Chart */}
        <canvas
          ref={canvasRef}
          className="chart-canvas"
          style={{ display: (effectiveShowTV || holdersChartActive) ? 'none' : 'block' }}
        />
        {/* Spectre brand watermark - native-canvas mode only (behind the chart data) */}
        {!effectiveShowTV && !holdersChartActive && (
          <div className="chart-watermark" aria-hidden="true" />
        )}

        {/* Empty state - bars never arrived within the stall budget. Replaces
            the infinite "Fetching market data" loader so the chart can't hang. */}
        {candleData.length === 0 && chartStalled && !effectiveShowTV && (
          <div className="chart-loading-state chart-empty-state">
            <div className="loading-text">
              <span className="loading-title">No chart data</span>
              <span className="loading-subtitle">Market data unavailable for this timeframe</span>
            </div>
          </div>
        )}

        {/* Initial loading state - waiting for data */}
        {candleData.length === 0 && !chartStalled && <ChartLoader />}
        
        {/* Scroll-back history loads silently (no "Loading History" overlay). */}

        {/* Price Axis Drag Handle - drag up/down to zoom price scale */}
        <div
          className={`axis-drag-handle price-axis-handle ${isDraggingPriceAxis ? 'active' : ''}`}
          onMouseDown={handlePriceAxisDragStart}
          onTouchStart={handlePriceAxisTouchStart}
          onDoubleClick={() => { setPriceZoom(1); setPriceOffset(0); setAutoFitPrice(true); }}
          title="Drag up/down to zoom price scale • Double-click to auto-fit"
        />
        
        {/* Time Axis Drag Handle - drag left/right to zoom time scale */}
        <div
          className={`axis-drag-handle time-axis-handle ${isDraggingTimeAxis ? 'active' : ''}`}
          onMouseDown={handleTimeAxisDragStart}
          onTouchStart={handleTimeAxisTouchStart}
          onDoubleClick={() => {
            // 1D/All: reset to show all, other timeframes: reset to optimal view (~100 candles)
            const optimalZoom = (timeframe === '1D' || timeframe === 'All') ? 1 : Math.max(1, Math.ceil(candleData.length / 100))
            setZoomLevel(optimalZoom)
          }}
          title="Drag left/right to zoom time scale • Double-click to reset"
        />
        
        {/* Crosshair Overlay - TradingView style */}
        {!effectiveShowTV && crosshair.visible && chartDimensionsRef.current && (
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
              style={{ top: crosshair.y, right: priceAxisWidth - 65 }}
            >
              {(() => {
                const price = crosshair.price || 0
                // Use REAL circulating supply from API
                const circSupply = liveTokenData?.circulatingSupply ? parseFloat(liveTokenData.circulatingSupply) : 0
                if (yAxisMode === 'mcap' && circSupply > 0) {
                  const mcap = price * circSupply
                  // Format MCap
                  if (mcap >= 1e12) return `$${(mcap / 1e12).toFixed(2)}T`
                  if (mcap >= 1e9) return `$${(mcap / 1e9).toFixed(2)}B`
                  if (mcap >= 1e6) return `$${(mcap / 1e6).toFixed(2)}M`
                  if (mcap >= 1e3) return `$${(mcap / 1e3).toFixed(2)}K`
                  return `$${mcap.toFixed(2)}`
                }
                return `$${price.toFixed(6)}`
              })()}
            </div>
            {/* Time label on bottom axis */}
            {crosshair.time && (
              <div 
                className="crosshair-label crosshair-time"
                style={{ left: crosshair.x, bottom: timeAxisHeight - 15 }}
              >
                {typeof crosshair.time === 'string' ? crosshair.time : crosshair.time.toLocaleString('en-US', { 
                  month: 'short', 
                  day: 'numeric',
                  hour: '2-digit', 
                  minute: '2-digit'
                })}
              </div>
            )}
            {/* OHLCV now shown via persistent ohlcv-legend above the chart */}
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
                  <img src={mention.avatar} alt={mention.user} />
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
        
        {/* Volume Tooltip */}
        {tooltip.visible && tooltip.data && (
          <div 
            className="volume-tooltip"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: 'translate(-50%, -100%)'
            }}
          >
            <div className="tooltip-date">{formatDate(tooltip.data.date)}</div>
            <div className="tooltip-content">
              <div className="tooltip-accent"></div>
              <div className="tooltip-info">
                <span className="tooltip-label">Volume</span>
                <span className="tooltip-value">{formatVolume(tooltip.data.volume)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* Resize Handle */}
      {!isFullscreen && (
        <div 
          className={`chart-resize-handle ${isResizing ? 'active' : ''}`}
          onMouseDown={handleResizeStart}
        >
          <div className="resize-handle-bar" />
        </div>
      )}

      {/* Button Tooltip - Fixed Position */}
      {buttonTooltip.visible && buttonTooltip.text && (
        <div 
          className="button-tooltip-fixed"
          style={{
            position: 'fixed',
            left: `${buttonTooltip.x}px`,
            top: `${buttonTooltip.y}px`,
            pointerEvents: 'none',
            zIndex: 99999
          }}
        >
          {buttonTooltip.text}
        </div>
      )}
    </div>
  )
}

// MEMOIZED (2026-07-23): at 5,285 lines this is the largest component in the
// app, and it was re-rendering on every App render - alerts polling (30s), a
// watchlist edit, a panel collapse, a resize - on top of every context tick.
// Its props are stable by construction: chartViewMode/isCollapsed are
// primitives, stats is a never-updated useState, alertLines is useMemo'd, and
// setChartViewMode is now useCallback'd in App.jsx. The token prop changes on
// a real token switch, which SHOULD re-render.
export default React.memo(TradingChart)
