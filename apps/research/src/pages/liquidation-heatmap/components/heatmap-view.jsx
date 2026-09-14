import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { drawRealHeatmap, fmtK, isNarrowCanvas, priceAxisWidthFor, TIME_AXIS_H } from './real-heatmap-chart'
import { buildResearchZoneLocation } from '@/lib/research-zone-routing'
import ShareXModal from '@/components/share-x-modal'
import useChartFullscreen from './use-chart-fullscreen'
import { FullscreenIcon } from './chart-fullscreen'

function stripUSDT(s) { return s ? s.replace(/USDT$/, '') : '' }

export default function HeatmapView({
  heatmapData, klineData, loading, error, retry,
  timeframe, setTimeframe, TIMEFRAMES,
  dayMode, fmtPrice,
  fullSymbol, setFullSymbol, ALL_SYMBOLS = [], getBaseSymbol = stripUSDT,
  printsData, exchange, setExchange,
  leverage, setLeverage,
}) {
  // Fullscreen: shared with the other four views via useChartFullscreen
  // (browser Fullscreen API, CSS-fixed fallback where it is a no-op).
  const { ref: wrapRef, isFullscreen, toggle: toggleFullscreen } = useChartFullscreen()
  const boxRef = useRef(null)
  const canvasRef = useRef(null)
  // dragRegion: 'chart' | 'priceAxis' | 'timeAxis' | null
  // priceZoom: vertical zoom factor (1 = fit, >1 = zoomed in)
  // priceOffset: vertical pan in price units (chart-body drag), 0 = anchored
  const viewRef = useRef({ start: 0, end: -1, dragging: false, dragX: 0, dragY: 0, dragRegion: null, priceZoom: 1, priceOffset: 0 })
  const [dims, setDims] = useState({ w: 800, h: 400 })
  const [mouse, setMouse] = useState(null)
  const [symbolOpen, setSymbolOpen] = useState(false)
  const [tfOpen, setTfOpen] = useState(false)
  const [levOpen, setLevOpen] = useState(false)
  const [symbolSearch, setSymbolSearch] = useState('')
  const symRef = useRef(null)
  const tfRef = useRef(null)
  const levRef = useRef(null)
  // Δ view: paint per-column CHANGE in liquidity instead of absolute level.
  const [deltaMode, setDeltaMode] = useState(false)
  // Replay: sliding-window playback over the loaded history.
  // { playing, col (window end, absolute), span (window width in cols) }
  const [replay, setReplay] = useState(null)
  const replayStateRef = useRef(null)
  const replaySavedRef = useRef(null)   // view window to restore on exit
  useEffect(() => { replayStateRef.current = replay }, [replay])
  // Share-to-X composed poster (data URL) — null = modal closed.
  const [shareUrl, setShareUrl] = useState(null)
  const navigate = useNavigate()
  // Off by default — the bubbles bury the candles; power users toggle them on.
  const [showPrints, setShowPrints] = useState(false)
  // CoinGlass "Liquidity Threshold": percentile cut, their UI default 0.85.
  const [threshold, setThreshold] = useState(0.85)
  const [pins, setPins] = useState([])
  // Phone-width control sheet. At --xs the header keeps only symbol + timeframe;
  // every power control (exchange, threshold, prints, delta, leverage, replay,
  // zoom, share, RZ jump) lives here instead of wrapping into four toolbar rows
  // above a 440px chart.
  const [sheetOpen, setSheetOpen] = useState(false)
  const geomRef = useRef(null)          // last draw geometry (for click→price)
  const downPosRef = useRef(null)       // mousedown pos to tell click from drag

  // Filter symbols by search
  const filteredSymbols = useMemo(() => {
    if (!symbolSearch) return ALL_SYMBOLS
    const q = symbolSearch.toUpperCase()
    return ALL_SYMBOLS.filter(s => s.includes(q))
  }, [symbolSearch, ALL_SYMBOLS])

  // Close dropdowns on outside click
  useEffect(() => {
    if (!symbolOpen && !tfOpen && !levOpen) return
    const handleClick = (e) => {
      if (symbolOpen && symRef.current && !symRef.current.contains(e.target)) {
        setSymbolOpen(false)
        setSymbolSearch('')
      }
      if (tfOpen && tfRef.current && !tfRef.current.contains(e.target)) {
        setTfOpen(false)
      }
      if (levOpen && levRef.current && !levRef.current.contains(e.target)) {
        setLevOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [symbolOpen, tfOpen, levOpen])

  // ResizeObserver
  useEffect(() => {
    if (!boxRef.current) return
    // Seed from the live rect first: until the observer delivers, dims sits at
    // its {800,400} placeholder, so the canvas draws at 800px and gets stretched
    // by CSS, and the container-width tier below picks the wrong bucket. RO
    // normally fires on observe(), but not before the first rendering step.
    const r0 = boxRef.current.getBoundingClientRect()
    if (r0.width > 0 && r0.height > 0) {
      setDims(d => (d.w === Math.floor(r0.width) && d.h === Math.floor(r0.height))
        ? d : { w: Math.floor(r0.width), h: Math.floor(r0.height) })
    }
    const ro = new ResizeObserver(entries => {
      const cr = entries[0].contentRect
      if (cr.width > 0 && cr.height > 0) setDims({ w: Math.floor(cr.width), h: Math.floor(cr.height) })
    })
    ro.observe(boxRef.current)
    return () => ro.disconnect()
  }, [])

  // Layout comes from real-heatmap-chart.js so the pointer hit-test bands can
  // never drift from what is actually painted.
  const narrow = isNarrowCanvas(dims.w)
  // Phone tier: the header sheds its power controls into the sheet (see below).
  const isXs = dims.w < 560
  const SIDEBAR_W = narrow ? 0 : 84
  const PRICE_AXIS_W = priceAxisWidthFor(dims.w)
  const chartAreaW = dims.w - SIDEBAR_W - PRICE_AXIS_W
  const chartAreaH = dims.h - TIME_AXIS_H

  // Classify a pointer position (relative to the canvas) into a drag region.
  // The price axis is the RIGHTMOST band — the cumulative-liquidity sidebar
  // sits between the chart and the axis, so the axis test must be anchored to
  // the canvas right edge, not to chartAreaW (that was the sidebar, and made
  // the visible price axis undraggable).
  const getRegion = useCallback((x, y) => {
    if (x >= dims.w - PRICE_AXIS_W) return 'priceAxis'
    if (y > chartAreaH) return 'timeAxis'
    return 'chart'
  }, [dims.w, chartAreaH])

  // Reset view when data changes; a running replay is over stale columns → exit.
  useEffect(() => {
    if (heatmapData) {
      viewRef.current = { ...viewRef.current, start: 0, end: heatmapData.cols - 1 }
      replaySavedRef.current = null
      setReplay(null)
    }
  }, [heatmapData])

  // Clear pins + vertical pan when the symbol changes (both are price levels
  // of THAT asset — an offset in BTC dollars would pin an ETH view to the
  // grid edge).
  useEffect(() => {
    setPins([])
    viewRef.current = { ...viewRef.current, priceOffset: 0 }
  }, [fullSymbol])

  // Trigger a re-render after zoom/pan changes viewRef.
  // rAF-coalesced: mousemove/wheel fire faster than the display refreshes, and
  // every state bump here costs a FULL canvas repaint (field rebuild + two
  // percentile sorts). Collapsing to one commit per frame is what makes
  // dragging smooth instead of flickery. Crosshair updates ride the same
  // frame so mouse + view never commit as two separate renders.
  const [viewTick, forceRender] = useState(0)
  const rafRef = useRef(0)
  const mouseNextRef = useRef(undefined)   // undefined = no pending change
  const scheduleFrame = useCallback((mouseVal) => {
    if (mouseVal !== undefined) mouseNextRef.current = mouseVal
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      if (mouseNextRef.current !== undefined) {
        setMouse(mouseNextRef.current)
        mouseNextRef.current = undefined
      }
      forceRender(n => n + 1)
    })
  }, [])
  const scheduleRender = useCallback(() => scheduleFrame(), [scheduleFrame])
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  // Main render - direct draw on every dep change
  useEffect(() => {
    if (!canvasRef.current || !heatmapData) return
    geomRef.current = drawRealHeatmap(
      canvasRef.current, dims, heatmapData, klineData,
      mouse, viewRef.current, fmtPrice,
      {
        hideSidebar: narrow,
        dayMode,
        prints: printsData,
        showPrints,
        exchangeFilter: exchange && exchange !== 'All' ? exchange.toLowerCase() : null,
        pins,
        threshold,
        deltaMode,
      }
    )
  }, [heatmapData, klineData, dims, mouse, fmtPrice, viewTick, dayMode, printsData, showPrints, exchange, pins, threshold, deltaMode])

  // Zoom helper - anchored to a fraction of the chart.
  // X-zoom is owned by the replay engine while a replay runs.
  const applyZoom = useCallback((factor, anchorFrac = 0.5) => {
    if (!heatmapData || replayStateRef.current) return
    const vw = viewRef.current
    const span = vw.end - vw.start
    const newSpan = Math.max(10, Math.min(heatmapData.cols - 1, Math.round(span * factor)))
    if (newSpan === span) return
    const anchor = vw.start + anchorFrac * span
    const newStart = Math.max(0, Math.round(anchor - anchorFrac * newSpan))
    const newEnd = Math.min(heatmapData.cols - 1, newStart + newSpan)
    viewRef.current = { ...vw, start: newStart, end: newEnd }
    scheduleRender()
  }, [heatmapData, scheduleRender])

  // Button zoom
  const zoomIn = useCallback(() => applyZoom(0.7), [applyZoom])
  const zoomOut = useCallback(() => applyZoom(1.4), [applyZoom])
  const zoomReset = useCallback(() => {
    if (!heatmapData) return
    viewRef.current = { ...viewRef.current, start: 0, end: heatmapData.cols - 1, priceZoom: 1, priceOffset: 0 }
    scheduleRender()
  }, [heatmapData, scheduleRender])

  // NOTE: must stay a real boolean — `{isZoomed && <button/>}` renders a
  // literal "0" if a && chain leaks a numeric 0 (priceOffset) into JSX.
  const isZoomed = !!(heatmapData && (viewRef.current.start > 0 ||
    (viewRef.current.end >= 0 && viewRef.current.end < heatmapData.cols - 1) ||
    (viewRef.current.priceZoom != null && viewRef.current.priceZoom !== 1) ||
    (viewRef.current.priceOffset != null && viewRef.current.priceOffset !== 0)))

  // ── Nearest magnets ───────────────────────────────────────────────────────
  // Read the picture for the user: cluster the LATEST column's standing
  // liquidity into level zones and surface the strongest 2 above (shorts,
  // fuel for a squeeze up) and below (longs, fuel for a flush) the price.
  // Limited to ±10% — the far low-leverage bands are structure, not magnets.
  const magnets = useMemo(() => {
    if (!heatmapData?.grid?.length || !klineData?.length || !heatmapData.priceArray?.length) return null
    const { rows, cols, grid, priceArray } = heatmapData
    const lastCol = cols - 1
    const rowSum = new Float64Array(rows)
    for (const g of grid) {
      if (g.col === lastCol && g.row >= 0 && g.row < rows) rowSum[g.row] += Math.abs(g.value)
    }
    const lastPrice = klineData[klineData.length - 1].close
    if (!lastPrice) return null
    const tick = priceArray.length > 1 ? priceArray[1] - priceArray[0] : 1
    // Merge adjacent non-empty rows (gap ≤ 2 rows) into one level zone.
    const clusters = []
    let cur = null
    let gap = 0
    for (let r = 0; r < rows; r++) {
      const v = rowSum[r]
      if (v > 0) {
        if (!cur) cur = { sum: 0, peakV: 0, peakRow: r }
        cur.sum += v
        if (v > cur.peakV) { cur.peakV = v; cur.peakRow = r }
        gap = 0
      } else if (cur && ++gap > 2) {
        clusters.push(cur)
        cur = null
      }
    }
    if (cur) clusters.push(cur)
    const enriched = clusters
      .map(c => {
        const price = priceArray[c.peakRow] + tick / 2
        return { price, usd: c.sum, dist: (price - lastPrice) / lastPrice }
      })
      .filter(c => Math.abs(c.dist) > 0.001 && Math.abs(c.dist) <= 0.10)
    const above = enriched.filter(c => c.dist > 0).sort((a, b) => b.usd - a.usd).slice(0, 2)
    const below = enriched.filter(c => c.dist < 0).sort((a, b) => b.usd - a.usd).slice(0, 2)
    above.sort((a, b) => a.dist - b.dist)   // nearest first
    below.sort((a, b) => b.dist - a.dist)
    return { above, below, lastPrice }
  }, [heatmapData, klineData])

  // Same near-toggle the canvas click uses, callable from a magnet chip.
  const togglePinAt = useCallback((price) => {
    const g = geomRef.current
    const pxPerPrice = g ? (g.chartB - g.chartT) / (g.maxP - g.minP) : 0
    setPins(prev => {
      const nearIdx = prev.findIndex(p => (pxPerPrice ? Math.abs(p - price) * pxPerPrice < 8 : p === price))
      if (nearIdx >= 0) return prev.filter((_, i) => i !== nearIdx)
      return [...prev, price]
    })
  }, [])

  const isPinnedNear = useCallback((price) => {
    const g = geomRef.current
    const pxPerPrice = g ? (g.chartB - g.chartT) / (g.maxP - g.minP) : 0
    return pins.some(p => (pxPerPrice ? Math.abs(p - price) * pxPerPrice < 8 : p === price))
  }, [pins])

  // ── Replay engine ─────────────────────────────────────────────────────────
  // Sliding fixed-width window over the loaded history. Everything the draw
  // renders is already window-scoped (field, candles, prints, price pill,
  // cumulative rail), so moving the window IS the time machine.
  const startReplay = useCallback(() => {
    if (!heatmapData) return
    const cols = heatmapData.cols
    const span = Math.max(20, Math.round(cols * 0.35))
    if (span >= cols) return
    const col0 = span - 1
    replaySavedRef.current = { start: viewRef.current.start, end: viewRef.current.end }
    viewRef.current = { ...viewRef.current, start: 0, end: col0 }
    setReplay({ playing: true, col: col0, span })
    scheduleFrame(null)
  }, [heatmapData, scheduleFrame])

  const stopReplay = useCallback(() => {
    const saved = replaySavedRef.current
    replaySavedRef.current = null
    if (saved && heatmapData) {
      viewRef.current = {
        ...viewRef.current,
        start: Math.max(0, saved.start),
        end: Math.min(saved.end < 0 ? heatmapData.cols - 1 : saved.end, heatmapData.cols - 1),
      }
    }
    setReplay(null)
    scheduleFrame(null)
  }, [heatmapData, scheduleFrame])

  const setReplayCol = useCallback((colRaw, playingOverride) => {
    const r = replayStateRef.current
    if (!r || !heatmapData) return
    const c = Math.max(r.span - 1, Math.min(heatmapData.cols - 1, Math.round(colRaw)))
    viewRef.current = { ...viewRef.current, start: c - r.span + 1, end: c }
    setReplay({ ...r, col: c, playing: playingOverride ?? r.playing })
    scheduleFrame(null)
  }, [heatmapData, scheduleFrame])

  const toggleReplayPlay = useCallback(() => {
    const r = replayStateRef.current
    if (!r || !heatmapData) return
    // Play pressed at the end → restart from the beginning.
    if (!r.playing && r.col >= heatmapData.cols - 1) {
      setReplayCol(r.span - 1, true)
      return
    }
    setReplay({ ...r, playing: !r.playing })
  }, [heatmapData, setReplayCol])

  // Play loop: ~12s for a full sweep regardless of column count. Fractional
  // progress lives in the closure; scrubbing pauses (col in deps would
  // restart the closure every frame, so playback re-reads via setReplayCol).
  useEffect(() => {
    if (!replay?.playing || !heatmapData) return
    let raf = 0
    let last = performance.now()
    let frac = replayStateRef.current?.col ?? replay.col
    const colsPerMs = Math.max((heatmapData.cols - replay.span) / 12000, 0.0005)
    const tick = (now) => {
      const dt = Math.min(now - last, 100)
      last = now
      frac += dt * colsPerMs
      if (frac >= heatmapData.cols - 1) {
        setReplayCol(heatmapData.cols - 1, false)  // reached now → pause
        return
      }
      if (Math.floor(frac) !== replayStateRef.current?.col) setReplayCol(frac, true)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay?.playing, heatmapData])

  // ── Share poster + Research Zone jump ────────────────────────────────────
  const handleShare = useCallback(() => {
    const src = canvasRef.current
    if (!src || !src.width) return
    const dpr = window.devicePixelRatio || 1
    const headH = 56
    const out = document.createElement('canvas')
    out.width = src.width
    out.height = src.height + Math.round(headH * dpr)
    const ctx = out.getContext('2d')
    const wCss = src.width / dpr
    ctx.scale(dpr, dpr)
    ctx.fillStyle = dayMode ? '#ffffff' : '#09090b'
    ctx.fillRect(0, 0, wCss, headH + src.height / dpr)
    ctx.textBaseline = 'middle'
    ctx.fillStyle = dayMode ? '#0f172a' : '#f5f5f7'
    ctx.font = '600 18px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
    ctx.fillText(`${getBaseSymbol(fullSymbol)} Liquidation Heatmap`, 16, headH / 2 - 9)
    ctx.fillStyle = dayMode ? 'rgba(71, 85, 105, 0.9)' : 'rgba(245, 245, 247, 0.5)'
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
    const stamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    const tfLabel = TIMEFRAMES.find(t => t.key === timeframe)?.label || timeframe
    ctx.fillText(
      `${tfLabel} · ${exchange || 'All'}${deltaMode ? ' · Δ delta' : ''}${leverage ? ` · ${leverage}x` : ''} · ${stamp} · SPECTRE AI`,
      16, headH / 2 + 12
    )
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(src, 0, Math.round(headH * dpr))
    setShareUrl(out.toDataURL('image/png'))
  }, [dayMode, fullSymbol, getBaseSymbol, exchange, deltaMode, leverage, TIMEFRAMES, timeframe])

  const openInResearchZone = useCallback(() => {
    const loc = buildResearchZoneLocation({ symbol: getBaseSymbol(fullSymbol) })
    navigate(loc.pathname + loc.search)
  }, [fullSymbol, getBaseSymbol, navigate])

  // Chart-body pan shared by mouse + touch. X pans in whole columns with the
  // fractional remainder banked in dragX (no snap-jitter, no lost sub-column
  // deltas); Y pans the price window via priceOffset, clamped to the grid so
  // dragging past the edge never banks phantom travel (rebase on clamp).
  const applyChartPan = useCallback((clientX, clientY) => {
    const vw = viewRef.current
    if (!heatmapData) return
    let next = vw
    const dx = clientX - vw.dragX
    const span = vw.end - vw.start + 1
    const pxPerCol = chartAreaW / Math.max(1, span)
    // While a replay runs, the time window belongs to the playhead — X pan is
    // suspended (Y pan below stays live so price can still be explored).
    const colShift = replayStateRef.current ? 0 : Math.trunc(dx / pxPerCol)
    if (colShift !== 0) {
      const maxStart = Math.max(0, heatmapData.cols - span)
      const newStart = Math.min(maxStart, Math.max(0, vw.start - colShift))
      const clamped = (vw.start - newStart) !== colShift
      next = {
        ...next, start: newStart, end: newStart + span - 1,
        dragX: clamped ? clientX : vw.dragX + colShift * pxPerCol,
      }
    }
    const dy = clientY - vw.dragY
    const g = geomRef.current
    if (dy !== 0) {
      if (g && g.gridLo != null) {
        const pricePerPx = (g.maxP - g.minP) / Math.max(1, g.chartB - g.chartT)
        const dP = Math.max(g.gridLo - g.minP, Math.min(g.gridHi - g.maxP, dy * pricePerPx))
        next = { ...next, priceOffset: (vw.priceOffset || 0) + dP, dragY: clientY }
      } else {
        next = { ...next, dragY: clientY }
      }
    }
    viewRef.current = next
  }, [heatmapData, chartAreaW])

  const setCursor = useCallback((cursor) => {
    const c = canvasRef.current
    if (c && c.style.cursor !== cursor) c.style.cursor = cursor
  }, [])

  // After a touch, the browser replays the gesture as compatibility MOUSE
  // events (mousedown/mouseup/click at the lift point). Those reached
  // onMouseUp, where a zero-distance down→up reads as a click — so on a phone
  // EVERY tap and every pan dropped a pin, and the chart filled with a stack of
  // pin labels the user never asked for. Ignore mouse events that arrive in the
  // shadow of a touch; the touch handlers already did the work.
  const lastTouchRef = useRef(0)
  const isGhostMouse = useCallback(() => Date.now() - lastTouchRef.current < 700, [])

  // Price under a canvas-relative y, or null if outside the plotted band.
  const priceAtY = useCallback((y) => {
    const g = geomRef.current
    if (!g || y < g.chartT || y > g.chartB) return null
    return g.minP + (1 - (y - g.chartT) / (g.chartB - g.chartT)) * (g.maxP - g.minP)
  }, [])

  // Mouse handlers
  const onMouseMove = useCallback((e) => {
    if (isGhostMouse()) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const vw = viewRef.current

    if (vw.dragging && heatmapData) {
      const dx = e.clientX - vw.dragX
      const dy = e.clientY - vw.dragY
      // Right-axis drag = vertical price zoom (drag up zooms in, down out)
      if (vw.dragRegion === 'priceAxis') {
        if (dy !== 0) {
          const factor = 1 - dy * 0.008
          const newZoom = Math.max(0.25, Math.min(10, (vw.priceZoom || 1) * factor))
          viewRef.current = { ...vw, priceZoom: newZoom, dragY: e.clientY }
        }
        scheduleFrame(null)
        return
      }
      // Bottom-axis drag = horizontal time zoom
      if (vw.dragRegion === 'timeAxis') {
        if (dx !== 0) {
          const span = vw.end - vw.start + 1
          const factor = 1 - dx * 0.005
          const newSpan = Math.max(10, Math.min(heatmapData.cols - 1, Math.round(span * factor)))
          if (newSpan !== span) {
            const center = vw.start + span / 2
            const newStart = Math.max(0, Math.round(center - newSpan / 2))
            const newEnd = Math.min(heatmapData.cols - 1, newStart + newSpan)
            viewRef.current = { ...vw, start: newStart, end: newEnd, dragX: e.clientX }
          }
        }
        scheduleFrame(null)
        return
      }
      // Chart body drag = 2D pan. Crosshair + tooltip stay hidden while
      // panning — their per-frame repaint under the cursor is the flicker.
      applyChartPan(e.clientX, e.clientY)
      scheduleFrame(null)
      return
    }
    const region = getRegion(x, y)
    setCursor(region === 'priceAxis' ? 'ns-resize' : region === 'timeAxis' ? 'ew-resize' : 'crosshair')
    scheduleFrame({ x, y })
  }, [heatmapData, applyChartPan, getRegion, setCursor, scheduleFrame, isGhostMouse])

  const onMouseDown = useCallback((e) => {
    if (isGhostMouse()) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    downPosRef.current = { x, y }
    const region = getRegion(x, y)
    if (region === 'chart') setCursor('grabbing')
    viewRef.current = { ...viewRef.current, dragging: true, dragX: e.clientX, dragY: e.clientY, dragRegion: region }
  }, [getRegion, setCursor, isGhostMouse])

  const onMouseUp = useCallback((e) => {
    if (isGhostMouse()) return
    viewRef.current = { ...viewRef.current, dragging: false, dragRegion: null }
    setCursor('crosshair')
    // Click (not drag) inside the chart body → toggle a pinned level.
    const rect = canvasRef.current?.getBoundingClientRect()
    const down = downPosRef.current
    downPosRef.current = null
    if (rect) scheduleFrame({ x: e.clientX - rect.left, y: e.clientY - rect.top })  // crosshair back after pan
    if (!rect || !down || !geomRef.current) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (Math.hypot(x - down.x, y - down.y) > 4) return          // it was a drag
    const g = geomRef.current
    if (x < g.chartL || x > g.chartR || y < g.chartT || y > g.chartB) return
    const price = g.minP + (1 - (y - g.chartT) / (g.chartB - g.chartT)) * (g.maxP - g.minP)
    // Near an existing pin (±8px) → unpin it; otherwise pin the new level.
    const pxPerPrice = (g.chartB - g.chartT) / (g.maxP - g.minP)
    setPins(prev => {
      const nearIdx = prev.findIndex(p => Math.abs(p - price) * pxPerPrice < 8)
      if (nearIdx >= 0) return prev.filter((_, i) => i !== nearIdx)
      return [...prev, price]
    })
  }, [setCursor, scheduleFrame, isGhostMouse])

  const onMouseLeave = useCallback(() => {
    if (isGhostMouse()) return
    viewRef.current = { ...viewRef.current, dragging: false, dragRegion: null }
    setCursor('crosshair')
    scheduleFrame(null)
  }, [setCursor, scheduleFrame, isGhostMouse])

  // Touch handlers - 1 finger: crosshair + pan, 2 fingers: pinch-zoom,
  // long-press: pin the level (tap must stay non-destructive — it is also how
  // you scroll and inspect).
  const pinchRef = useRef({ active: false, startDist: 0, startSpan: 0, startStart: 0, anchorFrac: 0.5 })
  const longPressRef = useRef({ timer: 0, x: 0, y: 0 })
  const cancelLongPress = useCallback(() => {
    if (longPressRef.current.timer) {
      clearTimeout(longPressRef.current.timer)
      longPressRef.current.timer = 0
    }
  }, [])
  useEffect(() => cancelLongPress, [cancelLongPress])

  const onTouchStart = useCallback((e) => {
    lastTouchRef.current = Date.now()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    if (e.touches.length === 2) {
      cancelLongPress()
      // Begin pinch
      const t1 = e.touches[0], t2 = e.touches[1]
      const dx = t2.clientX - t1.clientX
      const dy = t2.clientY - t1.clientY
      const dist = Math.hypot(dx, dy)
      const vw = viewRef.current
      const midX = ((t1.clientX + t2.clientX) / 2) - rect.left
      const anchorFrac = Math.max(0, Math.min(1, (midX - 0) / chartAreaW))
      pinchRef.current = {
        active: true,
        startDist: dist,
        startSpan: (vw.end - vw.start) || 1,
        startStart: vw.start,
        anchorFrac,
      }
      setMouse(null) // hide crosshair during pinch
      return
    }
    const touch = e.touches[0]
    if (!touch) return
    const tx = touch.clientX - rect.left
    const ty = touch.clientY - rect.top
    const region = getRegion(tx, ty)
    // 1-finger pan: reuse view drag state, remember region so axis drag scales.
    viewRef.current = { ...viewRef.current, dragging: true, dragX: touch.clientX, dragY: touch.clientY, dragRegion: region }
    setMouse({ x: tx, y: ty })
    // Hold still on the chart body for 500ms to pin/unpin that level.
    cancelLongPress()
    if (region === 'chart') {
      longPressRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        timer: setTimeout(() => {
          longPressRef.current.timer = 0
          const price = priceAtY(ty)
          if (price == null) return
          togglePinAt(price)
          if (navigator.vibrate) navigator.vibrate(10)
        }, 500),
      }
    }
  }, [chartAreaW, getRegion, cancelLongPress, priceAtY, togglePinAt])

  const onTouchMove = useCallback((e) => {
    lastTouchRef.current = Date.now()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    if (longPressRef.current.timer) {
      const t0 = e.touches[0]
      if (e.touches.length !== 1 || !t0 ||
        Math.hypot(t0.clientX - longPressRef.current.x, t0.clientY - longPressRef.current.y) > 8) {
        cancelLongPress()
      }
    }
    if (e.touches.length === 2 && pinchRef.current.active && heatmapData) {
      const t1 = e.touches[0], t2 = e.touches[1]
      const dx = t2.clientX - t1.clientX
      const dy = t2.clientY - t1.clientY
      const dist = Math.hypot(dx, dy) || 1
      const p = pinchRef.current
      const scale = p.startDist / dist // bigger spread → smaller span → zoom in
      const newSpan = Math.max(10, Math.min(heatmapData.cols - 1, Math.round(p.startSpan * scale)))
      const anchorCol = p.startStart + p.anchorFrac * p.startSpan
      const newStart = Math.max(0, Math.round(anchorCol - p.anchorFrac * newSpan))
      const newEnd = Math.min(heatmapData.cols - 1, newStart + newSpan)
      viewRef.current = { ...viewRef.current, start: newStart, end: newEnd, dragging: false }
      scheduleRender()
      return
    }
    const touch = e.touches[0]
    if (!touch) return
    const x = touch.clientX - rect.left
    const y = touch.clientY - rect.top
    const vw = viewRef.current
    if (vw.dragging && heatmapData && !pinchRef.current.active) {
      const dy = touch.clientY - (vw.dragY || touch.clientY)
      const dx = touch.clientX - vw.dragX
      if (vw.dragRegion === 'priceAxis') {
        if (Math.abs(dy) > 0) {
          const factor = 1 - dy * 0.008
          const newZoom = Math.max(0.25, Math.min(10, (vw.priceZoom || 1) * factor))
          viewRef.current = { ...vw, priceZoom: newZoom, dragY: touch.clientY }
        }
        scheduleFrame(null)
        return
      }
      if (vw.dragRegion === 'timeAxis') {
        if (Math.abs(dx) > 0) {
          const span = vw.end - vw.start + 1
          const factor = 1 - dx * 0.005
          const newSpan = Math.max(10, Math.min(heatmapData.cols - 1, Math.round(span * factor)))
          if (newSpan !== span) {
            const center = vw.start + span / 2
            const newStart = Math.max(0, Math.round(center - newSpan / 2))
            const newEnd = Math.min(heatmapData.cols - 1, newStart + newSpan)
            viewRef.current = { ...vw, start: newStart, end: newEnd, dragX: touch.clientX }
          }
        }
        scheduleFrame(null)
        return
      }
      applyChartPan(touch.clientX, touch.clientY)
    }
    scheduleFrame({ x, y })
  }, [heatmapData, applyChartPan, scheduleFrame, cancelLongPress])

  const onTouchEnd = useCallback((e) => {
    lastTouchRef.current = Date.now()
    cancelLongPress()
    if (e.touches.length === 0) {
      pinchRef.current.active = false
      viewRef.current = { ...viewRef.current, dragging: false, dragRegion: null }
      scheduleFrame(null)
    } else if (e.touches.length === 1 && pinchRef.current.active) {
      // Pinch ended, one finger still down — stay silent, no crosshair
      pinchRef.current.active = false
    }
  }, [scheduleFrame, cancelLongPress])

  const onWheel = useCallback((e) => {
    e.preventDefault()
    if (!heatmapData) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const region = getRegion(x, y)
    // Smooth: smaller steps, trackpad pinch sends small deltaY
    const delta = Math.abs(e.deltaY) < 4 ? e.deltaY * 3 : e.deltaY

    if (region === 'priceAxis') {
      // Wheel over the price axis scales Y only.
      const vw = viewRef.current
      const factor = 1 - delta * 0.002
      const newZoom = Math.max(0.25, Math.min(10, (vw.priceZoom || 1) * factor))
      viewRef.current = { ...vw, priceZoom: newZoom }
      scheduleRender()
      return
    }
    const anchorFrac = Math.max(0, Math.min(1, x / chartAreaW))
    const factor = 1 + delta * 0.002
    applyZoom(Math.max(0.5, Math.min(2, factor)), anchorFrac)
  }, [heatmapData, chartAreaW, applyZoom, getRegion, scheduleRender])

  // Wheel zoom must preventDefault to keep the PAGE from scrolling under the
  // gesture — React attaches onWheel as a PASSIVE listener (preventDefault is
  // silently ignored there), so bind a native non-passive listener instead.
  // onWheel's identity changes when heatmapData lands, so this rebinds after
  // the canvas conditionally mounts.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [onWheel])

  const currentTfLabel = TIMEFRAMES.find(t => t.key === timeframe)?.label || timeframe

  // Escape closes the control sheet; growing back out of the phone tier closes
  // it too (its trigger goes away with the tier).
  useEffect(() => {
    if (!sheetOpen) return
    if (!isXs) { setSheetOpen(false); return }
    const onKey = (e) => { if (e.key === 'Escape') setSheetOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheetOpen, isXs])

  // Toolbar collapse tier from the CONTAINER width, not the viewport. The same
  // panel renders in a ~1085px Command Center card, a narrower traders-corner
  // slot and the full page, so a media query can't tell when the header is about
  // to overflow (it measured 1800px viewport / 700px card and did nothing).
  // dims.w comes from the ResizeObserver on the canvas box = the panel's width.
  const sizeClass = isXs ? ' liqp-real-heatmap--xs'
    : dims.w < 760 ? ' liqp-real-heatmap--sm'
    : dims.w < 980 ? ' liqp-real-heatmap--md'
    : ''

  // 🪤 The light treatment for this card used to live on THREE host-side
  // selectors (`.app.app-day-mode`, `.lhp--day`, `.liqp.day-mode`) that each
  // covered a different subset, so a host could end up with a light plate under
  // a dark header whose controls had already been given dark slate ink — the
  // 2026-08-10 report. It hangs off the root now, stamped from the SAME prop the
  // canvas paints from (`dark={!dayMode}` in real-heatmap-chart), so the chrome
  // and the chart can never disagree again. See liquidation-page.css.
  const dayClass = dayMode ? ' liqp-real-heatmap--day' : ''

  return (
    <div className={`liqp-real-heatmap${sizeClass}${dayClass}${isFullscreen ? ' liqp-real-heatmap--fullscreen' : ''}`} ref={wrapRef}>
      {/* Compact header bar: title + token dropdown + timeframe dropdown + fullscreen */}
      <div className="liqp-hm-header">
        <span className="liqp-hm-title">Liquidation Heatmap</span>

        {/* Token selector dropdown */}
        <div className="liqp-hm-dropdown-wrap" ref={symRef}>
          <button
            className={`liqp-hm-dropdown-btn${symbolOpen ? ' open' : ''}`}
            onClick={() => { setSymbolOpen(!symbolOpen); setTfOpen(false) }}
          >
            <span>{getBaseSymbol(fullSymbol)}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 4l2.5 2.5 2.5-2.5" /></svg>
          </button>
          {symbolOpen && (
            <div className="liqp-hm-dropdown-panel">
              <input
                className="liqp-hm-dropdown-search"
                type="text"
                placeholder="Search..."
                value={symbolSearch}
                onChange={e => setSymbolSearch(e.target.value)}
                autoFocus
              />
              <div className="liqp-hm-dropdown-list">
                {filteredSymbols.map(s => (
                  <button
                    key={s}
                    className={`liqp-hm-dropdown-item${fullSymbol === s ? ' active' : ''}`}
                    onClick={() => { setFullSymbol(s); setSymbolOpen(false); setSymbolSearch('') }}
                  >
                    {getBaseSymbol(s)}
                  </button>
                ))}
                {filteredSymbols.length === 0 && (
                  <span className="liqp-hm-dropdown-empty">No matches</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Jump to the token's Research Zone */}
        <button
          className="liqp-hm-rz-btn"
          title={`Open ${getBaseSymbol(fullSymbol)} in Research Zone`}
          onClick={openInResearchZone}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M9 7h8v8" /></svg>
        </button>

        {/* Timeframe selector dropdown */}
        <div className="liqp-hm-dropdown-wrap" ref={tfRef}>
          <button
            className={`liqp-hm-dropdown-btn${tfOpen ? ' open' : ''}`}
            onClick={() => { setTfOpen(!tfOpen); setSymbolOpen(false) }}
          >
            <span>{currentTfLabel}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 4l2.5 2.5 2.5-2.5" /></svg>
          </button>
          {tfOpen && (
            <div className="liqp-hm-dropdown-panel liqp-hm-dropdown-panel--narrow">
              <div className="liqp-hm-dropdown-list">
                {TIMEFRAMES.map(tf => (
                  <button
                    key={tf.key}
                    className={`liqp-hm-dropdown-item${timeframe === tf.key ? ' active' : ''}`}
                    onClick={() => { setTimeframe(tf.key); setTfOpen(false) }}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Exchange filter pills */}
        <div className="liqp-hm-ex-pills">
          {['All', 'Binance', 'Bybit', 'OKX'].map(ex => (
            <button
              key={ex}
              className={`liqp-hm-ex-pill${exchange === ex ? ' active' : ''}`}
              onClick={() => setExchange?.(ex)}
            >
              {ex}
            </button>
          ))}
        </div>
        {exchange === 'OKX' && <span className="liqp-hm-model-note">model: all venues</span>}

        {/* Liquidity Threshold slider (CoinGlass parity) */}
        <div className="liqp-hm-threshold" title="Liquidity Threshold — hides cells below this percentile">
          <span className="liqp-hm-threshold-label">Threshold</span>
          <input
            type="range" min="0.5" max="1" step="0.01" value={threshold}
            onChange={e => setThreshold(parseFloat(e.target.value))}
          />
          <span className="liqp-hm-threshold-val">{threshold.toFixed(2)}</span>
        </div>

        {/* Real prints toggle */}
        <button
          className={`liqp-hm-prints-btn${showPrints ? ' active' : ''}${!printsData?.events?.length ? ' disabled' : ''}`}
          title={printsData?.events?.length ? 'Real liquidations overlay' : 'No real liquidation data for this asset'}
          onClick={() => printsData?.events?.length && setShowPrints(v => !v)}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="4" cy="7" r="2.4" opacity="0.9"/><circle cx="8.6" cy="4" r="1.6" opacity="0.6"/></svg>
          <span>Liqs</span>
        </button>

        <div className="liqp-hm-spacer" />

        {loading && <span className="liqp-hm-loading" />}

        {/* Zoom controls */}
        <div className="liqp-hm-zoom-controls">
          <button className="liqp-hm-zoom-btn" onClick={zoomIn} title="Zoom in">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button className="liqp-hm-zoom-btn" onClick={zoomOut} title="Zoom out">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14" /></svg>
          </button>
          {isZoomed && (
            <button className="liqp-hm-zoom-btn liqp-hm-zoom-reset" onClick={zoomReset} title="Reset zoom">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
            </button>
          )}
        </div>

        {/* Share poster */}
        <button className="liqp-hm-share-btn" title="Share to X" onClick={handleShare} disabled={!heatmapData}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" />
          </svg>
        </button>

        {/* Phone-tier control sheet trigger (CSS shows it only at --xs) */}
        <button
          className={`liqp-hm-tune-btn${sheetOpen ? ' active' : ''}`}
          title="Chart controls"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(v => !v)}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
            <circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" />
          </svg>
        </button>

        {/* Fullscreen button */}
        <button className="liqp-hm-fullscreen-btn" title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'} onClick={toggleFullscreen}>
          <FullscreenIcon active={isFullscreen} />
        </button>
      </div>

      {/* Sub-bar: magnet chips + view controls */}
      <div className="liqp-hm-subbar">
        {magnets && (magnets.above.length > 0 || magnets.below.length > 0) && (
          <div className="liqp-hm-magnets">
            <span className="liqp-hm-magnets-label">Magnets</span>
            {magnets.above.map(m => (
              <button
                key={`up-${m.price}`}
                className={`liqp-hm-magnet up${isPinnedNear(m.price) ? ' active' : ''}`}
                title="Standing short liquidations above price — click to pin the level"
                onClick={() => togglePinAt(m.price)}
              >
                <span className="liqp-hm-magnet-arrow">▲</span>
                <span className="liqp-hm-magnet-price">{fmtPrice ? fmtPrice(m.price) : '$' + Math.round(m.price).toLocaleString()}</span>
                <span className="liqp-hm-magnet-usd">{fmtK(m.usd)}</span>
                <span className="liqp-hm-magnet-dist">+{(m.dist * 100).toFixed(1)}%</span>
              </button>
            ))}
            {magnets.below.map(m => (
              <button
                key={`dn-${m.price}`}
                className={`liqp-hm-magnet down${isPinnedNear(m.price) ? ' active' : ''}`}
                title="Standing long liquidations below price — click to pin the level"
                onClick={() => togglePinAt(m.price)}
              >
                <span className="liqp-hm-magnet-arrow">▼</span>
                <span className="liqp-hm-magnet-price">{fmtPrice ? fmtPrice(m.price) : '$' + Math.round(m.price).toLocaleString()}</span>
                <span className="liqp-hm-magnet-usd">{fmtK(m.usd)}</span>
                <span className="liqp-hm-magnet-dist">{(m.dist * 100).toFixed(1)}%</span>
              </button>
            ))}
          </div>
        )}

        {/* Pinned levels are easy to add and, before this, impossible to clear
            in bulk — one control empties them. */}
        {pins.length > 0 && (
          <button
            className="liqp-hm-pins-clear"
            title="Clear pinned levels"
            onClick={() => setPins([])}
          >
            <span>{pins.length} pin{pins.length > 1 ? 's' : ''}</span>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        )}

        <div className="liqp-hm-subbar-spacer" />

        {/* Δ delta view toggle */}
        <button
          className={`liqp-hm-delta-btn${deltaMode ? ' active' : ''}`}
          title="Delta view — where liquidity was added (green) vs consumed (red)"
          onClick={() => setDeltaMode(v => !v)}
        >
          Δ
        </button>

        {/* Leverage tier filter */}
        {typeof setLeverage === 'function' && (
          <div className="liqp-hm-dropdown-wrap" ref={levRef}>
            <button
              className={`liqp-hm-dropdown-btn liqp-hm-lev-btn${levOpen ? ' open' : ''}${leverage ? ' filtered' : ''}`}
              title="Show a single leverage tier of the model"
              onClick={() => { setLevOpen(!levOpen); setSymbolOpen(false); setTfOpen(false) }}
            >
              <span>{leverage ? `${leverage}x` : 'All lev'}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 4l2.5 2.5 2.5-2.5" /></svg>
            </button>
            {levOpen && (
              <div className="liqp-hm-dropdown-panel liqp-hm-dropdown-panel--narrow">
                <div className="liqp-hm-dropdown-list">
                  {[null, 10, 25, 50, 100].map(l => (
                    <button
                      key={l ?? 'all'}
                      className={`liqp-hm-dropdown-item${(leverage ?? null) === l ? ' active' : ''}`}
                      onClick={() => { setLeverage(l); setLevOpen(false) }}
                    >
                      {l ? `${l}x` : 'All leverage'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Replay toggle */}
        <button
          className={`liqp-hm-replay-toggle${replay ? ' active' : ''}`}
          title="Replay — watch the liquidity build over the loaded history"
          onClick={() => (replay ? stopReplay() : startReplay())}
          disabled={!heatmapData}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          <span>Replay</span>
        </button>
      </div>

      {/* Canvas area */}
      <div ref={boxRef} className={`liqp-real-heatmap-canvas-wrap${loading && heatmapData ? ' is-refetching' : ''}`}>
        {loading && !heatmapData ? (
          <div className="liqp-real-heatmap-shimmer animate-shimmer" />
        ) : error && !heatmapData ? (
          <div className="liqp-real-heatmap-error">
            <span className="liqp-error-text">Failed to load heatmap data</span>
            <button className="liqp-error-retry" onClick={retry}>Retry</button>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            style={{
              width: '100%', height: '100%', display: 'block', cursor: 'crosshair', touchAction: 'none',
              // Long-press pins a level — keep iOS from raising its own
              // selection callout over the gesture.
              userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
            }}
            onMouseMove={onMouseMove}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          />
        )}
        {/* Refetch overlay — timeframe/symbol/exchange switch keeps the old
            chart on screen for the 2-4s fetch; the dimmed pane + sweep bar +
            pill say "working" so it never reads as broken. The 150ms fade-in
            delay keeps fast cache hits overlay-free. */}
        {loading && heatmapData && (
          <div className="liqp-hm-refetch">
            <div className="liqp-hm-refetch-bar" />
            <div className="liqp-hm-refetch-pill">
              <span className="liqp-hm-refetch-track" />
              <span className="liqp-hm-refetch-text">Loading {currentTfLabel}</span>
            </div>
          </div>
        )}

        {/* Replay control bar */}
        {replay && heatmapData && (
          <div className="liqp-hm-replay-bar">
            <span className="liqp-hm-replay-tag">REPLAY</span>
            <button className="liqp-hm-replay-play" onClick={toggleReplayPlay} title={replay.playing ? 'Pause' : 'Play'}>
              {replay.playing ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>
            <input
              className="liqp-hm-replay-scrub"
              type="range"
              min={replay.span - 1}
              max={heatmapData.cols - 1}
              step="1"
              value={replay.col}
              onChange={e => setReplayCol(parseFloat(e.target.value), false)}
            />
            <span className="liqp-hm-replay-time">
              {heatmapData.timeArray?.[replay.col]
                ? new Date(heatmapData.timeArray[replay.col]).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '--'}
            </span>
            <button className="liqp-hm-replay-close" onClick={stopReplay} title="Exit replay">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
        )}
      </div>

      {/* ── Phone control sheet ──────────────────────────────────────────────
          Same handlers as the desktop toolbar, laid out as labelled rows. The
          leverage picker becomes pills here: a dropdown popover inside a sheet
          would open past its own edge. */}
      {isXs && sheetOpen && (
        <>
          <div className="liqp-hm-sheet-scrim" onClick={() => setSheetOpen(false)} />
          <div className="liqp-hm-sheet" role="dialog" aria-label="Chart controls">
            <div className="liqp-hm-sheet-grip" />

            <div className="liqp-hm-sheet-row">
              <span className="liqp-hm-sheet-label">Exchange</span>
              <div className="liqp-hm-ex-pills">
                {['All', 'Binance', 'Bybit', 'OKX'].map(ex => (
                  <button
                    key={ex}
                    className={`liqp-hm-ex-pill${exchange === ex ? ' active' : ''}`}
                    onClick={() => setExchange?.(ex)}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            <div className="liqp-hm-sheet-row">
              <span className="liqp-hm-sheet-label">Threshold</span>
              <div className="liqp-hm-threshold">
                <input
                  type="range" min="0.5" max="1" step="0.01" value={threshold}
                  onChange={e => setThreshold(parseFloat(e.target.value))}
                />
                <span className="liqp-hm-threshold-val">{threshold.toFixed(2)}</span>
              </div>
            </div>

            <div className="liqp-hm-sheet-row">
              <span className="liqp-hm-sheet-label">Leverage</span>
              <div className="liqp-hm-ex-pills">
                {[null, 10, 25, 50, 100].map(l => (
                  <button
                    key={l ?? 'all'}
                    className={`liqp-hm-ex-pill${(leverage ?? null) === l ? ' active' : ''}`}
                    onClick={() => setLeverage?.(l)}
                    disabled={typeof setLeverage !== 'function'}
                  >
                    {l ? `${l}x` : 'All'}
                  </button>
                ))}
              </div>
            </div>

            <div className="liqp-hm-sheet-row">
              <span className="liqp-hm-sheet-label">Overlays</span>
              <div className="liqp-hm-sheet-actions">
                <button
                  className={`liqp-hm-prints-btn liqp-hm-sheet-btn${showPrints ? ' active' : ''}${!printsData?.events?.length ? ' disabled' : ''}`}
                  title={printsData?.events?.length ? 'Real liquidations overlay' : 'No real liquidation data for this asset'}
                  onClick={() => printsData?.events?.length && setShowPrints(v => !v)}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="4" cy="7" r="2.4" opacity="0.9"/><circle cx="8.6" cy="4" r="1.6" opacity="0.6"/></svg>
                  <span>Liqs</span>
                </button>
                <button
                  className={`liqp-hm-prints-btn liqp-hm-sheet-btn${deltaMode ? ' active' : ''}`}
                  title="Delta view — where liquidity was added (green) vs consumed (red)"
                  onClick={() => setDeltaMode(v => !v)}
                >
                  <span>Δ Delta</span>
                </button>
              </div>
            </div>

            <div className="liqp-hm-sheet-row">
              <span className="liqp-hm-sheet-label">View</span>
              <div className="liqp-hm-sheet-actions">
                <button className="liqp-hm-prints-btn liqp-hm-sheet-btn" onClick={zoomIn} title="Zoom in">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </button>
                <button className="liqp-hm-prints-btn liqp-hm-sheet-btn" onClick={zoomOut} title="Zoom out">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14" /></svg>
                </button>
                <button className={`liqp-hm-prints-btn liqp-hm-sheet-btn${isZoomed ? '' : ' disabled'}`} onClick={zoomReset} title="Reset zoom">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                  <span>Reset</span>
                </button>
              </div>
            </div>

            <div className="liqp-hm-sheet-row liqp-hm-sheet-row--last">
              <span className="liqp-hm-sheet-label">Actions</span>
              <div className="liqp-hm-sheet-actions">
                <button
                  className={`liqp-hm-prints-btn liqp-hm-sheet-btn${replay ? ' active' : ''}`}
                  onClick={() => { replay ? stopReplay() : startReplay(); setSheetOpen(false) }}
                  disabled={!heatmapData}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  <span>{replay ? 'Stop' : 'Replay'}</span>
                </button>
                <button
                  className="liqp-hm-prints-btn liqp-hm-sheet-btn"
                  onClick={() => { handleShare(); setSheetOpen(false) }}
                  disabled={!heatmapData}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" /></svg>
                  <span>Share</span>
                </button>
                <button className="liqp-hm-prints-btn liqp-hm-sheet-btn" onClick={openInResearchZone}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M9 7h8v8" /></svg>
                  <span>Research</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <ShareXModal
        open={!!shareUrl}
        onClose={() => setShareUrl(null)}
        imageUrl={shareUrl}
        defaultDescription={`$${getBaseSymbol(fullSymbol)} liquidation heatmap (${currentTfLabel}) — where the leverage is stacked.\n\nvia Spectre AI`}
        filename={`spectre_liq_heatmap_${getBaseSymbol(fullSymbol)}.png`}
        contentType="liq-heatmap"
      />
    </div>
  )
}
