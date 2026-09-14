/**
 * useLiquidationHeatmap — All liquidation heatmap state, data fetching, canvas rendering,
 * and interactive pan/zoom/drag handlers.
 * Returns state + refs + handlers needed by LiquidationTabPanel.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { getBinanceKlines } from '@/services/binanceApi'
import {
  generateLiquidationMatrix as _generateLiqMatrix,
  drawLiquidationCanvas as _drawLiqCanvas,
  drawCandleChart as _drawCandleChart,
  handleLiqMouseMove as _handleLiqMouseMove,
  handleLiqMouseLeave as _handleLiqMouseLeave,
  analyzeLiquidationMatrix,
} from './liquidation-heatmap'

const TF_CONFIG = {
  '24h': { resolution: '15', seconds: 24 * 3600 },
  '3d':  { resolution: '60', seconds: 3 * 24 * 3600 },
  '7d':  { resolution: '240', seconds: 7 * 24 * 3600 },
}

const MARGINS = { LEFT: 44, RIGHT: 65, TOP: 8, BOTTOM: 28 }
const MOMENTUM_FRICTION = 0.92
const MIN_VELOCITY = 0.3
const RUBBER_BAND_FACTOR = 0.3
const RUBBER_BAND_MAX = 15
const ZOOM_ANIM_DURATION = 120 // ms

export default function useLiquidationHeatmap(marketAiTab, fmtPrice, symbol = 'BTC', dayMode = false, keyboardEnabled = true) {
  // --- Core state ---
  const [liqHeatmapData, setLiqHeatmapData] = useState(null)
  const [liqTimeframe, setLiqTimeframe] = useState('24h')
  const [liqFullscreen, setLiqFullscreen] = useState(false)
  const [liqTooltip, setLiqTooltip] = useState({ visible: false, x: 0, y: 0, price: 0, densityPct: 0, amount: 0, isCluster: false, bar: null, time: '', snappedX: 0, crosshairY: 0, dims: null })
  const [liqLoading, setLiqLoading] = useState(false)
  const [sensitivity, setSensitivity] = useState('low') // 'low' | 'med' | 'high'
  const [chartMode, setChartMode] = useState('heatmap') // 'heatmap' | 'candles'

  // --- Pan/Zoom state ---
  const [panOffset, setPanOffset] = useState(0)       // Horizontal offset in candles (0 = newest at right)
  const [priceOffset, setPriceOffset] = useState(0)    // Vertical pan as % of visible price range
  const [timeZoom, setTimeZoom] = useState(1)           // 1 = show all, >1 = zoomed in
  const [priceZoom, setPriceZoom] = useState(1)           // 1 = show full price range
  const [isPanning, setIsPanning] = useState(false)
  const [dragMode, setDragMode] = useState(null)  // 'chart' | 'priceAxis' | 'timeAxis'
  const [liqError, setLiqError] = useState(null)

  // --- Refs ---
  const liqCanvasRef = useRef(null)
  const liqCanvasFullRef = useRef(null)
  const liqContainerRef = useRef(null)
  const liqContainerFullRef = useRef(null)
  const panStartRef = useRef({ x: 0, y: 0, panOff: 0, priceOff: 0 })
  const panVelocityRef = useRef({ x: 0, y: 0 })
  const lastPanRef = useRef({ x: 0, y: 0, time: 0 })
  const momentumRef = useRef(null)
  const allBarsRef = useRef([])
  const prevBarsCountRef = useRef(0)
  const dragModeRef = useRef(null) // 'chart' | 'priceAxis' | 'timeAxis'
  const touchRef = useRef({ startTouches: null, mode: null, initialPinchDist: 0, initialTimeZoom: 1, initialPriceZoom: 1 })
  const zoomAnimRef = useRef(null)
  const rubberBandRef = useRef(null)
  const cursorRatioRef = useRef(0.5) // 0 = left edge, 1 = right edge — defaults to center

  // --- Live state ref for closures (avoids stale captures in mousedown handlers) ---
  const stateRef = useRef({ panOffset: 0, priceOffset: 0, timeZoom: 1, priceZoom: 1, numCols: 0 })
  useEffect(() => {
    stateRef.current = { panOffset, priceOffset, timeZoom, priceZoom, numCols: liqHeatmapData?.numCols ?? 0 }
  })

  // Escape key to close liquidation fullscreen
  useEffect(() => {
    if (!liqFullscreen) return
    const handleEsc = (e) => { if (e.key === 'Escape') setLiqFullscreen(false) }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [liqFullscreen])

  const generateLiquidationMatrix = useCallback((bars) => _generateLiqMatrix(bars), [])

  // Fetch BTC klines on tab activation or timeframe change
  useEffect(() => {
    if (marketAiTab !== 'liquidation') return
    let cancelled = false
    setLiqLoading(true)
    setLiqError(null)
    // Reset viewport on timeframe change
    setPanOffset(0)
    setPriceOffset(0)
    setTimeZoom(1)
    setPriceZoom(1)
    const now = Math.floor(Date.now() / 1000)
    const { resolution, seconds } = TF_CONFIG[liqTimeframe] || TF_CONFIG['24h']
    getBinanceKlines(symbol, resolution, now - seconds, now)
      .then(({ getBars }) => {
        if (cancelled) return
        if (!getBars || getBars.length === 0) { setLiqLoading(false); return }
        allBarsRef.current = getBars
        prevBarsCountRef.current = getBars.length
        setLiqHeatmapData(generateLiquidationMatrix(getBars))
        setLiqLoading(false)
      })
      .catch(() => { if (!cancelled) { setLiqError('Failed to load BTC data'); setLiqLoading(false) } })
    return () => { cancelled = true }
  }, [marketAiTab, liqTimeframe, generateLiquidationMatrix, symbol])

  // --- Viewport computation ---
  const viewport = useMemo(() => {
    if (!liqHeatmapData) return null
    const { numCols, priceMin, priceMax } = liqHeatmapData
    const visibleCount = Math.max(20, Math.floor(numCols / Math.max(1, timeZoom)))
    const maxOffset = Math.max(0, numCols - visibleCount)
    const clampedPan = Math.max(0, Math.min(maxOffset, Math.round(panOffset)))
    const endCol = numCols - clampedPan
    const startCol = Math.max(0, endCol - visibleCount)
    // Price viewport
    const fullRange = priceMax - priceMin
    const midPrice = (priceMax + priceMin) / 2
    const zoomedRange = fullRange / Math.max(0.25, priceZoom)
    const shift = (priceOffset / 100) * zoomedRange
    return {
      startCol,
      endCol: Math.min(numCols, startCol + visibleCount),
      visiblePriceMin: midPrice - zoomedRange / 2 + shift,
      visiblePriceMax: midPrice + zoomedRange / 2 + shift,
      visibleCount,
    }
  }, [liqHeatmapData, panOffset, priceOffset, timeZoom, priceZoom])

  // --- Draw with viewport (heatmap or candle chart) ---
  const drawLiquidationCanvas = useCallback((canvas, container) => {
    if (chartMode === 'candles' && allBarsRef.current?.length) {
      _drawCandleChart(canvas, container, allBarsRef.current, fmtPrice, viewport, liqTimeframe, dayMode, liqHeatmapData)
    } else {
      _drawLiqCanvas(canvas, container, liqHeatmapData, fmtPrice, viewport, sensitivity, liqTimeframe, dayMode)
    }
  }, [liqHeatmapData, fmtPrice, viewport, sensitivity, liqTimeframe, chartMode, dayMode])

  // Draw on data/viewport change
  useEffect(() => {
    drawLiquidationCanvas(liqCanvasRef.current, liqContainerRef.current)
  }, [drawLiquidationCanvas])

  // Draw fullscreen on toggle
  useEffect(() => {
    if (liqFullscreen) drawLiquidationCanvas(liqCanvasFullRef.current, liqContainerFullRef.current)
  }, [liqFullscreen, drawLiquidationCanvas])

  // --- Cancel momentum ---
  const cancelMomentum = useCallback(() => {
    if (momentumRef.current) { cancelAnimationFrame(momentumRef.current); momentumRef.current = null }
    if (zoomAnimRef.current) { cancelAnimationFrame(zoomAnimRef.current); zoomAnimRef.current = null }
    if (rubberBandRef.current) { cancelAnimationFrame(rubberBandRef.current); rubberBandRef.current = null }
  }, [])

  // Cleanup on unmount
  useEffect(() => () => cancelMomentum(), [cancelMomentum])

  // --- Get canvas dims for coordinate mapping ---
  const getCanvasDims = useCallback((e) => {
    const container = liqFullscreen ? liqContainerFullRef.current : liqContainerRef.current
    if (!container) return null
    const rect = container.getBoundingClientRect()
    return {
      rect,
      cL: MARGINS.LEFT,
      cR: rect.width - MARGINS.RIGHT,
      cT: MARGINS.TOP,
      cB: rect.height - MARGINS.BOTTOM,
      cW: rect.width - MARGINS.LEFT - MARGINS.RIGHT,
      cH: rect.height - MARGINS.TOP - MARGINS.BOTTOM,
    }
  }, [liqFullscreen])

  // --- Determine drag region ---
  const getDragRegion = useCallback((e) => {
    const dims = getCanvasDims(e)
    if (!dims) return 'chart'
    const rect = dims.rect
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (x > dims.cR) return 'priceAxis'
    if (y > dims.cB) return 'timeAxis'
    return 'chart'
  }, [getCanvasDims])

  // --- Rubber-band spring-back ---
  const springBack = useCallback(() => {
    if (rubberBandRef.current) cancelAnimationFrame(rubberBandRef.current)
    const animate = () => {
      // Abandon spring-back when tab is hidden — user won't see the in-flight
      // animation anyway, and a paused-then-resumed rAF wastes CPU on every poll.
      if (document.hidden) { rubberBandRef.current = null; return }
      const { panOffset: p, numCols, timeZoom: tz } = stateRef.current
      const visibleCount = Math.max(20, Math.floor(numCols / Math.max(1, tz)))
      const maxOff = Math.max(0, numCols - visibleCount)
      let needsSpring = false
      if (p < 0) { setPanOffset(v => { const nv = v + (-v) * 0.15; return Math.abs(nv) < 0.5 ? 0 : nv }); needsSpring = true }
      else if (p > maxOff) { setPanOffset(v => { const nv = v - (v - maxOff) * 0.15; return Math.abs(nv - maxOff) < 0.5 ? maxOff : nv }); needsSpring = true }
      if (needsSpring) rubberBandRef.current = requestAnimationFrame(animate)
      else rubberBandRef.current = null
    }
    rubberBandRef.current = requestAnimationFrame(animate)
  }, [])

  // --- Momentum loop (with rubber-band) ---
  const startMomentum = useCallback(() => {
    const animate = () => {
      if (document.hidden) {
        panVelocityRef.current = { x: 0, y: 0 }
        momentumRef.current = null
        return
      }
      const vx = panVelocityRef.current.x
      const vy = panVelocityRef.current.y
      if (Math.abs(vx) < MIN_VELOCITY && Math.abs(vy) < MIN_VELOCITY) {
        panVelocityRef.current = { x: 0, y: 0 }
        momentumRef.current = null
        // Check bounds and spring back if over-scrolled
        springBack()
        return
      }
      // Allow over-scroll during momentum with rubber-band resistance
      setPanOffset(p => {
        const raw = p + vx
        const { numCols, timeZoom: tz } = stateRef.current
        const visibleCount = Math.max(20, Math.floor(numCols / Math.max(1, tz)))
        const maxOff = Math.max(0, numCols - visibleCount)
        if (raw < 0) return Math.max(-RUBBER_BAND_MAX, raw * RUBBER_BAND_FACTOR)
        if (raw > maxOff) return maxOff + Math.min(RUBBER_BAND_MAX, (raw - maxOff) * RUBBER_BAND_FACTOR)
        return raw
      })
      setPriceOffset(p => p + vy)
      panVelocityRef.current = {
        x: vx * MOMENTUM_FRICTION,
        y: vy * MOMENTUM_FRICTION,
      }
      momentumRef.current = requestAnimationFrame(animate)
    }
    momentumRef.current = requestAnimationFrame(animate)
  }, [springBack])

  // --- Chart pan handlers ---
  const handleChartPanStart = useCallback((e) => {
    if (e.button !== 0) return
    const region = getDragRegion(e)
    dragModeRef.current = region
    setDragMode(region)
    cancelMomentum()
    setIsPanning(true)
    // Read current values from stateRef to avoid stale closure
    const { panOffset: po, priceOffset: pOff } = stateRef.current
    panStartRef.current = { x: e.clientX, y: e.clientY, panOff: po, priceOff: pOff }
    lastPanRef.current = { x: e.clientX, y: e.clientY, time: performance.now() }
    panVelocityRef.current = { x: 0, y: 0 }

    const handleMove = (ev) => {
      const dx = ev.clientX - panStartRef.current.x
      const dy = ev.clientY - panStartRef.current.y
      const dims = getCanvasDims(ev)
      if (!dims || !stateRef.current.numCols) return

      const mode = dragModeRef.current
      if (mode === 'priceAxis') {
        // Y-axis drag: zoom price (functional updater to avoid stale closure)
        const sens = 0.008
        setPriceZoom(z => Math.max(0.25, Math.min(10, z * (1 - dy * sens))))
        panStartRef.current.y = ev.clientY
      } else if (mode === 'timeAxis') {
        // X-axis drag: zoom time — drag right = zoom in, drag left = zoom out
        const sens = 0.005
        const factor = 1 - dx * sens
        if (factor > 0) setTimeZoom(z => Math.max(1, Math.min(10, z * factor)))
        panStartRef.current.x = ev.clientX
      } else {
        // Chart body drag: pan both axes — read live values from stateRef
        const { timeZoom: tz, priceZoom: pz, numCols: nc } = stateRef.current
        const colW = dims.cW / Math.max(20, Math.floor(nc / Math.max(1, tz)))
        const panDelta = dx / colW
        const priceDelta = dy / dims.cH * 100 / Math.max(0.25, pz)

        // Rubber-band: allow slight over-scroll
        const rawPan = panStartRef.current.panOff + panDelta
        const visibleCount = Math.max(20, Math.floor(nc / Math.max(1, tz)))
        const maxOff = Math.max(0, nc - visibleCount)
        let clampedPan = rawPan
        if (rawPan < 0) clampedPan = Math.max(-RUBBER_BAND_MAX, rawPan * RUBBER_BAND_FACTOR)
        else if (rawPan > maxOff) clampedPan = maxOff + Math.min(RUBBER_BAND_MAX, (rawPan - maxOff) * RUBBER_BAND_FACTOR)
        setPanOffset(clampedPan)
        setPriceOffset(panStartRef.current.priceOff + priceDelta)

        // Track velocity
        const now = performance.now()
        const dt = now - lastPanRef.current.time
        if (dt > 0) {
          const vx = (ev.clientX - lastPanRef.current.x) / colW / dt * 16
          const vy = (ev.clientY - lastPanRef.current.y) / dims.cH * 100 / Math.max(0.25, pz) / dt * 16
          panVelocityRef.current = { x: vx, y: vy }
        }
        lastPanRef.current = { x: ev.clientX, y: ev.clientY, time: now }
      }
    }

    const handleUp = () => {
      setIsPanning(false)
      setDragMode(null)
      dragModeRef.current = null
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      // Start momentum for chart pan (not axis drag)
      if (Math.abs(panVelocityRef.current.x) > MIN_VELOCITY || Math.abs(panVelocityRef.current.y) > MIN_VELOCITY) {
        startMomentum()
      } else {
        // No momentum — spring back immediately if over-scrolled
        springBack()
      }
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [getDragRegion, getCanvasDims, cancelMomentum, startMomentum, springBack])

  // --- Mouse wheel handler ---
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const { numCols } = stateRef.current
    if (!numCols) return
    const region = getDragRegion(e)
    const delta = e.deltaY > 0 ? 0.92 : 1.08 // scroll down = zoom out, scroll up = zoom in

    if (region === 'priceAxis') {
      setPriceZoom(z => Math.max(0.25, Math.min(10, z * delta)))
    } else {
      // Zoom time axis centered on cursor — use functional updater to read live timeZoom
      const dims = getCanvasDims(e)
      if (!dims) return
      const rect = dims.rect
      const mouseX = e.clientX - rect.left
      const cursorRatio = (mouseX - dims.cL) / dims.cW
      setTimeZoom(oldZoom => {
        const newZoom = Math.max(1, Math.min(10, oldZoom * delta))
        const oldVisible = Math.floor(numCols / Math.max(1, oldZoom))
        const newVisible = Math.floor(numCols / Math.max(1, newZoom))
        const panShift = (1 - cursorRatio) * (oldVisible - newVisible)
        setPanOffset(p => Math.max(0, p + panShift))
        return newZoom
      })
    }
  }, [getDragRegion, getCanvasDims])

  // --- Double-click to reset ---
  const handleDoubleClick = useCallback(() => {
    cancelMomentum()
    setPanOffset(0)
    setPriceOffset(0)
    setTimeZoom(1)
    setPriceZoom(1)
  }, [cancelMomentum])

  // --- Tooltip handlers (only when not panning) ---
  const handleLiqMouseMove = useCallback((e) => {
    // Track cursor position as ratio within chart area for zoom-to-cursor
    const dims = getCanvasDims(e)
    if (dims) {
      const mouseX = e.clientX - dims.rect.left
      cursorRatioRef.current = Math.max(0, Math.min(1, (mouseX - dims.cL) / dims.cW))
    }
    if (isPanning) return
    _handleLiqMouseMove(e, setLiqTooltip)
  }, [isPanning, getCanvasDims])

  const handleLiqMouseLeave = useCallback(() => {
    cursorRatioRef.current = 0.5 // Reset to center when cursor leaves chart
    _handleLiqMouseLeave(setLiqTooltip)
  }, [])

  // AI insights derived from the density matrix
  const liqAiInsights = useMemo(() => analyzeLiquidationMatrix(liqHeatmapData), [liqHeatmapData])

  // --- ResizeObserver: redraw when container resizes ---
  useEffect(() => {
    const container = liqFullscreen ? liqContainerFullRef.current : liqContainerRef.current
    if (!container) return
    let raf = null
    const redraw = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const canvas = liqFullscreen ? liqCanvasFullRef.current : liqCanvasRef.current
        drawLiquidationCanvas(canvas, container)
      })
    }
    const observer = new ResizeObserver(redraw)
    observer.observe(container)
    // Initial draw — covers cases where refs weren't ready during the draw effect
    redraw()
    return () => { observer.disconnect(); if (raf) cancelAnimationFrame(raf) }
  }, [liqFullscreen, drawLiquidationCanvas])

  // --- Animated zoom utility (centers on cursor position) ---
  const animateZoomTo = useCallback((targetTimeZoom, targetPriceZoom) => {
    if (zoomAnimRef.current) cancelAnimationFrame(zoomAnimRef.current)
    const { timeZoom: startTZ, priceZoom: startPZ, numCols: nc, panOffset: startPan } = stateRef.current
    const cursorR = cursorRatioRef.current
    // Pre-compute pan shift so the column under the cursor stays in place
    const oldVisible = Math.floor(nc / Math.max(1, startTZ))
    const newVisible = Math.floor(nc / Math.max(1, targetTimeZoom))
    const targetPan = Math.max(0, startPan + (1 - cursorR) * (oldVisible - newVisible))
    const start = performance.now()
    const animate = () => {
      if (document.hidden) {
        // Snap to target and stop — user can't see the tween anyway.
        setTimeZoom(targetTimeZoom)
        setPriceZoom(targetPriceZoom)
        setPanOffset(targetPan)
        zoomAnimRef.current = null
        return
      }
      const elapsed = performance.now() - start
      const t = Math.min(1, elapsed / ZOOM_ANIM_DURATION)
      const ease = 1 - Math.pow(1 - t, 3) // ease-out cubic
      setTimeZoom(startTZ + (targetTimeZoom - startTZ) * ease)
      setPriceZoom(startPZ + (targetPriceZoom - startPZ) * ease)
      setPanOffset(startPan + (targetPan - startPan) * ease)
      if (t < 1) zoomAnimRef.current = requestAnimationFrame(animate)
      else zoomAnimRef.current = null
    }
    zoomAnimRef.current = requestAnimationFrame(animate)
  }, [])

  // --- Zoom in/out button handlers ---
  const handleZoomIn = useCallback(() => {
    const tz = Math.min(10, stateRef.current.timeZoom * 1.15)
    animateZoomTo(tz, stateRef.current.priceZoom)
  }, [animateZoomTo])

  const handleZoomOut = useCallback(() => {
    const tz = Math.max(1, stateRef.current.timeZoom * 0.87)
    animateZoomTo(tz, stateRef.current.priceZoom)
  }, [animateZoomTo])

  // --- Touch handlers ---
  const handleTouchStart = useCallback((e) => {
    const touches = e.touches
    cancelMomentum()
    if (touches.length === 2) {
      // Pinch start
      e.preventDefault()
      const dx = touches[1].clientX - touches[0].clientX
      const dy = touches[1].clientY - touches[0].clientY
      touchRef.current = {
        mode: 'pinch',
        startTouches: null,
        initialPinchDist: Math.hypot(dx, dy),
        initialTimeZoom: stateRef.current.timeZoom,
        initialPriceZoom: stateRef.current.priceZoom,
      }
    } else if (touches.length === 1) {
      // Single touch — prepare for pan (10px threshold)
      touchRef.current = {
        mode: 'pending',
        startTouches: { x: touches[0].clientX, y: touches[0].clientY },
        panOff: stateRef.current.panOffset,
        priceOff: stateRef.current.priceOffset,
        initialPinchDist: 0,
        initialTimeZoom: 1,
        initialPriceZoom: 1,
      }
      lastPanRef.current = { x: touches[0].clientX, y: touches[0].clientY, time: performance.now() }
      panVelocityRef.current = { x: 0, y: 0 }
    }
  }, [cancelMomentum])

  const handleTouchMove = useCallback((e) => {
    const touches = e.touches
    const tr = touchRef.current
    if (tr.mode === 'pinch' && touches.length === 2) {
      e.preventDefault()
      const dx = touches[1].clientX - touches[0].clientX
      const dy = touches[1].clientY - touches[0].clientY
      const dist = Math.hypot(dx, dy)
      const scale = dist / Math.max(1, tr.initialPinchDist)
      setTimeZoom(Math.max(1, Math.min(10, tr.initialTimeZoom * scale)))
      setPriceZoom(Math.max(0.25, Math.min(10, tr.initialPriceZoom * scale)))
    } else if (touches.length === 1) {
      const dx = touches[0].clientX - (tr.startTouches?.x ?? 0)
      const dy = touches[0].clientY - (tr.startTouches?.y ?? 0)
      if (tr.mode === 'pending') {
        // Check 10px movement threshold
        if (Math.hypot(dx, dy) >= 10) {
          tr.mode = 'pan'
          setIsPanning(true)
        } else return
      }
      if (tr.mode === 'pan') {
        e.preventDefault()
        const dims = getCanvasDims(e)
        if (!dims || !stateRef.current.numCols) return
        const { timeZoom: tz, priceZoom: pz, numCols: nc } = stateRef.current
        const colW = dims.cW / Math.max(20, Math.floor(nc / Math.max(1, tz)))
        const panDelta = dx / colW
        const priceDelta = dy / dims.cH * 100 / Math.max(0.25, pz)
        // Rubber-band pan
        const rawPan = tr.panOff + panDelta
        const visibleCount = Math.max(20, Math.floor(nc / Math.max(1, tz)))
        const maxOff = Math.max(0, nc - visibleCount)
        let clampedPan = rawPan
        if (rawPan < 0) clampedPan = Math.max(-RUBBER_BAND_MAX, rawPan * RUBBER_BAND_FACTOR)
        else if (rawPan > maxOff) clampedPan = maxOff + Math.min(RUBBER_BAND_MAX, (rawPan - maxOff) * RUBBER_BAND_FACTOR)
        setPanOffset(clampedPan)
        setPriceOffset(tr.priceOff + priceDelta)
        // Velocity tracking
        const now = performance.now()
        const dt = now - lastPanRef.current.time
        if (dt > 0) {
          const vx = (touches[0].clientX - lastPanRef.current.x) / colW / dt * 16
          const vy = (touches[0].clientY - lastPanRef.current.y) / dims.cH * 100 / Math.max(0.25, pz) / dt * 16
          panVelocityRef.current = { x: vx, y: vy }
        }
        lastPanRef.current = { x: touches[0].clientX, y: touches[0].clientY, time: now }
      }
    }
  }, [getCanvasDims])

  const handleTouchEnd = useCallback((e) => {
    const tr = touchRef.current
    if (tr.mode === 'pan') {
      setIsPanning(false)
      if (Math.abs(panVelocityRef.current.x) > MIN_VELOCITY || Math.abs(panVelocityRef.current.y) > MIN_VELOCITY) {
        startMomentum()
      } else {
        springBack()
      }
    }
    if (e.touches.length === 0) {
      touchRef.current = { startTouches: null, mode: null, initialPinchDist: 0, initialTimeZoom: 1, initialPriceZoom: 1 }
    }
  }, [startMomentum, springBack])

  // --- Minimap drag handler (click + drag the blue viewport indicator) ---
  const handleMinimapMouseDown = useCallback((e) => {
    if (!liqHeatmapData) return
    e.preventDefault()
    e.stopPropagation() // Prevent chart pan handler from taking over
    cancelMomentum()
    const bar = e.currentTarget
    const barRect = bar.getBoundingClientRect()
    const { numCols } = liqHeatmapData

    const jumpTo = (clientX) => {
      const ratio = Math.max(0, Math.min(1, (clientX - barRect.left) / barRect.width))
      const tz = stateRef.current.timeZoom
      const visibleCount = Math.max(20, Math.floor(numCols / Math.max(1, tz)))
      const maxOff = Math.max(0, numCols - visibleCount)
      const newPan = numCols * (1 - ratio) - visibleCount / 2
      setPanOffset(Math.max(0, Math.min(maxOff, Math.round(newPan))))
    }

    // Jump immediately on click
    jumpTo(e.clientX)

    const onMove = (ev) => jumpTo(ev.clientX)
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [liqHeatmapData, cancelMomentum])

  // --- Keyboard shortcuts ---
  // keyboardEnabled=false when the consumer doesn't render this hook's chart
  // canvas (e.g. the dedicated /liquidation-heatmap page mounts the hook headless
  // for data) - otherwise arrow/Home keys preventDefault page scroll for an
  // invisible chart.
  useEffect(() => {
    if (marketAiTab !== 'liquidation' || !keyboardEnabled) return
    const handleKey = (e) => {
      // Don't intercept if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      switch (e.key) {
        case '+': case '=':
          e.preventDefault()
          handleZoomIn()
          break
        case '-': case '_':
          e.preventDefault()
          handleZoomOut()
          break
        case 'ArrowLeft':
          e.preventDefault()
          setPanOffset(p => Math.max(0, p + 3))
          break
        case 'ArrowRight':
          e.preventDefault()
          setPanOffset(p => Math.max(0, p - 3))
          break
        case 'ArrowUp':
          e.preventDefault()
          setPriceOffset(p => p + 2)
          break
        case 'ArrowDown':
          e.preventDefault()
          setPriceOffset(p => p - 2)
          break
        case 'Home':
          e.preventDefault()
          cancelMomentum()
          setPanOffset(0); setPriceOffset(0); setTimeZoom(1); setPriceZoom(1)
          break
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [marketAiTab, keyboardEnabled, cancelMomentum, handleZoomIn, handleZoomOut])

  return {
    liqHeatmapData, liqTimeframe, setLiqTimeframe,
    liqFullscreen, setLiqFullscreen,
    liqTooltip, liqLoading, liqError,
    liqCanvasRef, liqCanvasFullRef,
    liqContainerRef, liqContainerFullRef,
    handleLiqMouseMove, handleLiqMouseLeave,
    liqAiInsights,
    // Interactive chart props
    viewport, isPanning, dragMode,
    panOffset, priceOffset, timeZoom, priceZoom,
    sensitivity, setSensitivity,
    chartMode, setChartMode,
    candleBars: allBarsRef.current,
    handleChartPanStart, handleWheel, handleDoubleClick,
    // New interaction handlers
    handleZoomIn, handleZoomOut,
    handleTouchStart, handleTouchMove, handleTouchEnd,
    handleMinimapMouseDown,
  }
}
