/**
 * MonarchChart v2 — Immersive interactive chart for Monarch AI chat.
 * Inspired by Claude's interactive artifacts.
 *
 * Features:
 * - Stat cards row (key metrics with labels + big values)
 * - Chart type toggle (line / bar / area) — user can switch
 * - Interactive hover tooltip with crosshair
 * - Timeline slider for time-range data
 * - Source citation pills
 * - Multi-dataset legend with color dots
 * - ResizeObserver for fullscreen re-render
 * - Day mode auto-detection
 * - Annotation labels on chart data points
 *
 * Chart spec JSON:
 * {
 *   type: 'line' | 'area' | 'bar',
 *   title: string,
 *   labels: string[],
 *   datasets: [{ label, data: number[], color? }],
 *   source?: string,
 *   stats?: [{ label, value, detail?, color? }],
 *   sources?: [{ name, url? }],
 *   switchable?: boolean,      // show chart type toggle
 *   annotations?: [{ index, label }],  // labels on data points
 * }
 */
import { useRef, useEffect, useMemo, useState, useCallback, lazy, Suspense } from 'react'
import { drawSpectreWatermark } from '@/lib/chart-watermark'
import './monarch-chart.css'

// Real research-zone TradingView chart — lazy-loaded so we don't pay the
// charting_library cost on chat turns that don't need it.
const TradingViewAdvanced = lazy(() => import('@/components/TradingViewAdvanced'))

const TV_TIMEFRAMES = ['1M', '5M', '15M', '1H', '4H', '1D', '1W', 'ALL']
const DEFAULT_TV_TIMEFRAME = '1H'

// Bars cache shared across all asset-chart instances. Switching timeframes
// or remounting the chart bubble hits the cache instantly instead of waiting
// on /api/bars. 60-second TTL — long enough for fast tab-flipping, short
// enough that re-opening an old chat shows fresh data.
const _barsCache = new Map() // key: symbol|tf  -> { ts, bars }
const _barsInflight = new Map() // key: symbol|tf -> Promise<bars>
const BARS_TTL_MS = 60_000

const DEFAULT_COLORS = [
  '#10B981', '#3B82F6', '#F59E0B', '#EC4899',
  '#06B6D4', '#A78BFA', '#f5f5f7', '#F97316',
]

const BAR_COLORS = [
  '#10B981', '#3B82F6', '#F59E0B', '#EC4899',
  '#06B6D4', '#A78BFA', '#F97316', '#f5f5f7',
  '#14B8A6', '#8B5CF6', '#EF4444', '#22D3EE',
]

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function fmtValue(val) {
  if (val == null) return '?'
  const abs = Math.abs(val)
  if (abs >= 1e12) return `$${(val / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `$${(val / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(val / 1e6).toFixed(2)}M`
  if (abs >= 1000) return `$${(val / 1000).toFixed(1)}K`
  if (abs >= 1) return `$${val.toFixed(2)}`
  return `$${val.toFixed(4)}`
}

function fmtCompact(val) {
  if (val == null) return '?'
  const abs = Math.abs(val)
  if (abs >= 1e9) return `${(val / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(val / 1e6).toFixed(1)}M`
  if (abs >= 1000) return `${(val / 1000).toFixed(1)}K`
  if (abs >= 1) return val.toFixed(1)
  return val.toFixed(2)
}

/* ── Chart type icons ── */
const ChartTypeIcon = ({ type, active }) => {
  const cls = `monarch-chart-type-icon ${active ? 'active' : ''}`
  if (type === 'line') return (
    <svg className={cls} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M2 14l5-6 4 3 7-8" />
    </svg>
  )
  if (type === 'bar') return (
    <svg className={cls} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <rect x="2" y="10" width="3" height="8" rx="0.5" /><rect x="8.5" y="6" width="3" height="12" rx="0.5" /><rect x="15" y="2" width="3" height="16" rx="0.5" />
    </svg>
  )
  if (type === 'area') return (
    <svg className={cls} viewBox="0 0 20 20" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M2 14l5-6 4 3 7-8v15H2z" fill="currentColor" opacity="0.35" />
      <path d="M2 14l5-6 4 3 7-8" stroke="currentColor" />
    </svg>
  )
  return null
}

export default function MonarchChart({ spec, onExpand }) {
  const canvasRef = useRef(null)
  const [renderKey, setRenderKey] = useState(0)
  const [activeType, setActiveType] = useState(null)
  const [hoverIndex, setHoverIndex] = useState(-1)
  const [sliderValue, setSliderValue] = useState(100) // percentage of data to show
  const [tvTimeframe, setTvTimeframe] = useState(spec?.timeframe && TV_TIMEFRAMES.includes(spec.timeframe) ? spec.timeframe : DEFAULT_TV_TIMEFRAME)

  const {
    type: specType = 'line',
    title,
    labels: allLabels = [],
    datasets: allDatasets = [],
    source,
    stats,
    sources,
    switchable,
    annotations,
    symbol: assetSymbol,
    bare = false,
  } = spec || {}

  // ── Asset chart mode ──────────────────────────────────────────────
  // For single-major-asset turns (`type: 'spectre_asset'`) we render a
  // dedicated sub-component that handles the 3-way render-mode toggle
  // (Spectre canvas / plain Line / embedded TradingView).
  if (specType === 'spectre_asset' && assetSymbol) {
    return <MonarchAssetChart spec={spec} onExpand={onExpand} />
  }
  // ──────────────────────────────────────────────────────────────────

  // Active chart type — user can override via toggle
  // Reset activeType when spec changes to avoid stale type on new chart
  const type = activeType || specType

  // Reset active type when a new chart spec arrives (different title/data)
  useEffect(() => {
    setActiveType(null)
  }, [title, allLabels.length])

  // Sliced data based on slider (timeline feature)
  const hasSlider = allLabels.length > 8
  const sliceEnd = Math.max(2, Math.round(allLabels.length * (sliderValue / 100)))
  const labels = hasSlider ? allLabels.slice(0, sliceEnd) : allLabels
  const datasets = hasSlider
    ? allDatasets.map(d => ({ ...d, data: (d.data || []).slice(0, sliceEnd) }))
    : allDatasets

  // Compute chart data bounds
  const chartData = useMemo(() => {
    if (!datasets.length || !labels.length) return null
    const allValues = datasets.flatMap(d => d.data || [])
    const min = Math.min(...allValues)
    const max = Math.max(...allValues)
    const range = max - min || 1
    return { min, max, range, allValues }
  }, [datasets, labels])

  // Day mode detection
  const isDayMode = useCallback(() => {
    const el = canvasRef.current
    if (!el) return false
    return !!el.closest('.app-day-mode') || !!el.closest('.monarch-page-day')
  }, [])

  // ResizeObserver — re-render when container size changes (fullscreen, responsive)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => setRenderKey(k => k + 1))
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  // ── Canvas hover handler for tooltip crosshair ──
  const handleCanvasMove = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas || !labels.length || type === 'bar') return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const padLeft = rect.height > 350 ? 60 : 48
    const padRight = rect.height > 350 ? 24 : 16
    const chartW = rect.width - padLeft - padRight
    const relX = (x - padLeft) / chartW
    const idx = Math.round(relX * (labels.length - 1))
    if (idx >= 0 && idx < labels.length) {
      setHoverIndex(idx)
    }
  }, [labels, type])

  const handleCanvasLeave = useCallback(() => setHoverIndex(-1), [])

  // ── Main canvas drawing ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !chartData) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const dayMode = isDayMode()

    // Polyfill roundRect for browsers that don't support it
    if (!ctx.roundRect) {
      ctx.roundRect = function(x, y, w, h, radii) {
        const r = Array.isArray(radii) ? radii[0] || 0 : radii || 0
        this.beginPath()
        this.moveTo(x + r, y)
        this.lineTo(x + w - r, y)
        this.quadraticCurveTo(x + w, y, x + w, y + r)
        this.lineTo(x + w, y + h - r)
        this.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
        this.lineTo(x + r, y + h)
        this.quadraticCurveTo(x, y + h, x, y + h - r)
        this.lineTo(x, y + r)
        this.quadraticCurveTo(x, y, x + r, y)
        this.closePath()
      }
    }

    try { // Wrap entire drawing in try/catch to prevent render crashes

    const gridColor = dayMode ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.04)'
    const labelColor = dayMode ? 'rgba(15, 23, 42, 0.5)' : 'rgba(245, 245, 247, 0.3)'
    const xLabelColor = dayMode ? 'rgba(15, 23, 42, 0.55)' : 'rgba(245, 245, 247, 0.4)'
    const zeroLineColor = dayMode ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.12)'
    const dotCenterColor = dayMode ? '#0f172a' : '#ffffff'
    const crosshairColor = dayMode ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.08)'
    const tooltipBg = dayMode ? 'rgba(255, 255, 255, 0.95)' : 'rgba(22, 22, 28, 0.95)'
    const tooltipText = dayMode ? '#0f172a' : '#f5f5f7'
    const tooltipBorder = dayMode ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'

    const rect = canvas.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)

    const isLarge = h > 350
    // RZ-style layout: Y-axis labels live on the RIGHT edge for line/area
    // (matches the research-zone chart). Bar charts keep more left-side
    // breathing room since bar labels render under bars and value labels
    // float above each bar.
    const isBarMode = type === 'bar'
    const padLeft = isBarMode ? (isLarge ? 60 : 48) : (isLarge ? 22 : 14)
    const padRight = isBarMode ? (isLarge ? 24 : 16) : (isLarge ? 62 : 52)
    const padTop = isLarge ? 16 : 12
    const padBottom = isLarge ? 36 : 28
    const chartW = w - padLeft - padRight
    const chartH = h - padTop - padBottom

    ctx.clearRect(0, 0, w, h)
    const { min, range } = chartData
    const toY = (val) => padTop + chartH - ((val - min) / range) * chartH
    const toX = (i) => padLeft + (i / Math.max(labels.length - 1, 1)) * chartW

    const baseFontSize = isLarge ? 12 : 10
    const smallFontSize = isLarge ? 11 : 9

    // Grid
    const gridLines = 4
    ctx.strokeStyle = gridColor
    ctx.lineWidth = 1
    for (let i = 0; i <= gridLines; i++) {
      const y = padTop + (i / gridLines) * chartH
      ctx.beginPath()
      ctx.moveTo(padLeft, y)
      ctx.lineTo(w - padRight, y)
      ctx.stroke()
    }

    // Y-axis labels — right side for line/area (RZ parity), left side for bars
    ctx.font = `${baseFontSize}px Inter, -apple-system, system-ui, sans-serif`
    ctx.fillStyle = labelColor
    if (isBarMode) {
      ctx.textAlign = 'right'
      for (let i = 0; i <= gridLines; i++) {
        const y = padTop + (i / gridLines) * chartH
        const val = min + (1 - i / gridLines) * range
        ctx.fillText(fmtCompact(val), padLeft - 8, y + 4)
      }
    } else {
      ctx.textAlign = 'left'
      for (let i = 0; i <= gridLines; i++) {
        const y = padTop + (i / gridLines) * chartH
        const val = min + (1 - i / gridLines) * range
        ctx.fillText(fmtCompact(val), w - padRight + 8, y + 4)
      }
    }

    // X-axis labels (skip for bar — drawn inside bar block)
    if (type !== 'bar') {
      ctx.fillStyle = xLabelColor
      ctx.textAlign = 'center'
      const labelStep = Math.max(1, Math.floor(labels.length / 6))
      for (let i = 0; i < labels.length; i += labelStep) {
        ctx.fillText(labels[i], toX(i), h - 6)
      }
    }

    // ── Draw by type ──
    datasets.forEach((dataset, di) => {
      const data = dataset.data || []
      if (data.length < 2 && type !== 'bar') return
      if (!data.length) return
      const color = dataset.color || DEFAULT_COLORS[di % DEFAULT_COLORS.length]

      if (type === 'bar') {
        if (!data.length) return
        const barGap = Math.max(4, chartW / Math.max(data.length, 1) * 0.2)
        const barWidth = Math.max(8, (chartW - barGap * (data.length + 1)) / Math.max(data.length, 1))
        const hasNeg = data.some(v => v < 0)
        const zeroY = hasNeg ? toY(0) : toY(min)
        // Sign-aware coloring when the series mixes positive + negative values
        // (e.g., 1h/24h/7d/30d % change). Red for negative, green for positive.
        // For all-positive series (volume, market cap), keep the dataset color
        // or the rotational palette.
        const useSignColors = hasNeg
        const POS_COLOR = '#10B981'
        const NEG_COLOR = '#EF4444'

        data.forEach((val, i) => {
          const barColor = useSignColors
            ? (val < 0 ? NEG_COLOR : POS_COLOR)
            : (dataset.color || BAR_COLORS[i % BAR_COLORS.length])
          const x = padLeft + barGap + i * (barWidth + barGap)
          const yVal = toY(val)
          const isNeg = val < 0
          const barTop = isNeg ? zeroY : yVal
          const barH = isNeg ? (yVal - zeroY) : (zeroY - yVal)
          if (barH < 1) return

          const grad = ctx.createLinearGradient(x, barTop, x, barTop + barH)
          grad.addColorStop(0, hexToRgba(barColor, dayMode ? 0.9 : 0.85))
          grad.addColorStop(0.5, hexToRgba(barColor, dayMode ? 0.65 : 0.55))
          grad.addColorStop(1, hexToRgba(barColor, dayMode ? 0.3 : 0.2))
          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.roundRect(x, barTop, barWidth, barH, [4, 4, 0, 0])
          ctx.fill()

          // Glow
          ctx.save()
          ctx.shadowColor = hexToRgba(barColor, dayMode ? 0.15 : 0.25)
          ctx.shadowBlur = 6
          ctx.shadowOffsetY = 2
          ctx.fillStyle = 'transparent'
          ctx.beginPath()
          ctx.roundRect(x, barTop, barWidth, barH, [4, 4, 0, 0])
          ctx.fill()
          ctx.restore()

          // Value label
          ctx.font = `${smallFontSize}px Inter, -apple-system, system-ui, sans-serif`
          ctx.fillStyle = dayMode ? hexToRgba(barColor, 1) : hexToRgba(barColor, 0.9)
          ctx.textAlign = 'center'
          ctx.fillText(fmtCompact(val), x + barWidth / 2, barTop - 5)
        })

        // X labels under bars
        ctx.font = `${smallFontSize}px Inter, -apple-system, system-ui, sans-serif`
        ctx.fillStyle = xLabelColor
        ctx.textAlign = 'center'
        labels.forEach((label, i) => {
          const barGap2 = Math.max(4, chartW / data.length * 0.2)
          const barWidth2 = Math.max(8, (chartW - barGap2 * (data.length + 1)) / data.length)
          const x = padLeft + barGap2 + i * (barWidth2 + barGap2) + barWidth2 / 2
          ctx.fillText(label, x, h - 4)
        })

        if (hasNeg) {
          ctx.strokeStyle = zeroLineColor
          ctx.lineWidth = 1
          ctx.setLineDash([4, 4])
          ctx.beginPath()
          ctx.moveTo(padLeft, zeroY)
          ctx.lineTo(w - padRight, zeroY)
          ctx.stroke()
          ctx.setLineDash([])
        }
        return
      }

      // Area fill — ONLY when type === 'area' (was leaking into 'line' which
      // made line and area visually identical — see RZ chart for reference:
      // pure line has no fill, area has a gradient wash below).
      if (type === 'area') {
        const areaGrad = ctx.createLinearGradient(0, padTop, 0, padTop + chartH)
        areaGrad.addColorStop(0, hexToRgba(color, dayMode ? 0.22 : 0.18))
        areaGrad.addColorStop(0.5, hexToRgba(color, dayMode ? 0.09 : 0.06))
        areaGrad.addColorStop(1, hexToRgba(color, 0))

        ctx.beginPath()
        ctx.moveTo(toX(0), toY(data[0]))
        for (let i = 1; i < data.length; i++) {
          const prevX = toX(i - 1)
          const midX = (prevX + toX(i)) / 2
          ctx.quadraticCurveTo(prevX, toY(data[i - 1]), midX, (toY(data[i - 1]) + toY(data[i])) / 2)
        }
        ctx.quadraticCurveTo(toX(data.length - 2), toY(data[data.length - 2]), toX(data.length - 1), toY(data[data.length - 1]))
        ctx.lineTo(toX(data.length - 1), padTop + chartH)
        ctx.lineTo(toX(0), padTop + chartH)
        ctx.closePath()
        ctx.fillStyle = areaGrad
        ctx.fill()
      }

      // Line stroke — 1:1 with research-zone/trading-chart.jsx:2023-2046:
      // single pass, lineWidth 1.25, shadowBlur 4, shadowColor 0.32 opacity.
      // No blurred underlay (that was the "foggy" issue), no second glow
      // layer. One thin sharp line with a tight halo. Sharp = RZ-sharp.
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(toX(0), toY(data[0]))
      for (let i = 1; i < data.length; i++) {
        const prevX = toX(i - 1)
        const midX = (prevX + toX(i)) / 2
        ctx.quadraticCurveTo(prevX, toY(data[i - 1]), midX, (toY(data[i - 1]) + toY(data[i])) / 2)
      }
      ctx.quadraticCurveTo(toX(data.length - 2), toY(data[data.length - 2]), toX(data.length - 1), toY(data[data.length - 1]))
      ctx.strokeStyle = color
      ctx.lineWidth = isLarge ? 1.5 : 1.25
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.shadowColor = hexToRgba(color, 0.32)
      ctx.shadowBlur = 4
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0
      ctx.stroke()
      ctx.restore()

      // Intermediate data points — REMOVED to match RZ chart aesthetic.
      // Dots on every point made small series look "AI-built". Only the
      // current/last-point marker survives. If a series has annotations
      // (event labels), the annotation pass below paints those dots.

      // Last point — keep as a clean endpoint anchor
      const lastX = toX(data.length - 1)
      const lastY = toY(data[data.length - 1])

      // RZ-parity crosshair: dashed horizontal line at the current/last
      // value, with a small value chip on the right edge. Only paint for
      // the first dataset (di === 0) to avoid stacking lines for multi-
      // dataset charts. Suppressed when bare=true (Line mode in the asset
      // chart — minimal aesthetic).
      if (!bare && di === 0 && data.length >= 2) {
        ctx.save()
        ctx.strokeStyle = hexToRgba(color, dayMode ? 0.35 : 0.45)
        ctx.lineWidth = 1
        ctx.setLineDash([3, 4])
        ctx.beginPath()
        ctx.moveTo(padLeft, lastY)
        ctx.lineTo(w - padRight, lastY)
        ctx.stroke()
        ctx.setLineDash([])

        // Value chip on the right edge (matches RZ's right-side price pill)
        const lastVal = data[data.length - 1]
        const chipText = fmtCompact(lastVal)
        ctx.font = `600 ${smallFontSize}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`
        const tw = ctx.measureText(chipText).width
        const chipPadX = 6, chipH = isLarge ? 18 : 16
        const chipW = tw + chipPadX * 2
        const chipX = w - padRight - chipW + 2
        const chipY = lastY - chipH / 2
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.roundRect(chipX, chipY, chipW, chipH, 4)
        ctx.fill()
        ctx.fillStyle = dayMode ? '#0f172a' : '#0a0a0a'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(chipText, chipX + chipW / 2, chipY + chipH / 2 + 0.5)
        ctx.textBaseline = 'alphabetic'
        ctx.restore()
      }

      if (!bare) {
        ctx.beginPath(); ctx.arc(lastX, lastY, isLarge ? 7 : 5.5, 0, Math.PI * 2); ctx.fillStyle = hexToRgba(color, 0.18); ctx.fill()
        ctx.beginPath(); ctx.arc(lastX, lastY, isLarge ? 3.5 : 2.75, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
        ctx.beginPath(); ctx.arc(lastX, lastY, isLarge ? 1.3 : 1, 0, Math.PI * 2); ctx.fillStyle = dotCenterColor; ctx.fill()
      }
    })

    // ── Annotations — labeled data points ──
    if (annotations && annotations.length > 0 && type !== 'bar') {
      const firstData = datasets[0]?.data || []
      ctx.font = `bold ${smallFontSize}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`
      ctx.textAlign = 'center'

      annotations.forEach(ann => {
        const idx = ann.index
        if (idx < 0 || idx >= firstData.length) return
        const x = toX(idx)
        const y = toY(firstData[idx])

        // Annotation bubble
        const text = ann.label
        const metrics = ctx.measureText(text)
        const bw = metrics.width + 14
        const bh = 20
        const bx = x - bw / 2
        const by = y - bh - 10

        ctx.fillStyle = dayMode ? 'rgba(255,255,255,0.92)' : 'rgba(22,22,28,0.92)'
        ctx.beginPath()
        ctx.roundRect(bx, by, bw, bh, 6)
        ctx.fill()
        ctx.strokeStyle = dayMode ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
        ctx.lineWidth = 1
        ctx.stroke()

        ctx.fillStyle = dayMode ? '#0f172a' : '#f5f5f7'
        ctx.fillText(text, x, by + 14)
      })
    }

    // ── Hover crosshair + tooltip ──
    if (hoverIndex >= 0 && hoverIndex < labels.length && type !== 'bar') {
      const hx = toX(hoverIndex)

      // Vertical crosshair
      ctx.strokeStyle = crosshairColor
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(hx, padTop)
      ctx.lineTo(hx, padTop + chartH)
      ctx.stroke()
      ctx.setLineDash([])

      // Highlighted dots on each dataset
      datasets.forEach((dataset, di) => {
        const data = dataset.data || []
        if (hoverIndex >= data.length) return
        const color = dataset.color || DEFAULT_COLORS[di % DEFAULT_COLORS.length]
        const y = toY(data[hoverIndex])
        ctx.beginPath(); ctx.arc(hx, y, 7, 0, Math.PI * 2); ctx.fillStyle = hexToRgba(color, 0.25); ctx.fill()
        ctx.beginPath(); ctx.arc(hx, y, 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
        ctx.beginPath(); ctx.arc(hx, y, 1.5, 0, Math.PI * 2); ctx.fillStyle = dotCenterColor; ctx.fill()
      })

      // Tooltip box
      const tooltipLines = [labels[hoverIndex]]
      datasets.forEach((dataset, di) => {
        const data = dataset.data || []
        if (hoverIndex >= data.length) return
        const dLabel = dataset.label || `Dataset ${di + 1}`
        tooltipLines.push(`${dLabel}: ${fmtCompact(data[hoverIndex])}`)
      })

      ctx.font = `${smallFontSize}px Inter, -apple-system, system-ui, sans-serif`
      const maxLineW = Math.max(...tooltipLines.map(l => ctx.measureText(l).width))
      const tw = maxLineW + 20
      const th = tooltipLines.length * 16 + 12
      let tx = hx + 12
      if (tx + tw > w - 8) tx = hx - tw - 12

      ctx.fillStyle = tooltipBg
      ctx.beginPath()
      ctx.roundRect(tx, padTop + 8, tw, th, 8)
      ctx.fill()
      ctx.strokeStyle = tooltipBorder
      ctx.lineWidth = 1
      ctx.stroke()

      ctx.fillStyle = tooltipText
      tooltipLines.forEach((line, li) => {
        ctx.font = li === 0
          ? `bold ${smallFontSize}px -apple-system, system-ui, sans-serif`
          : `${smallFontSize}px Inter, -apple-system, system-ui, sans-serif`
        ctx.textAlign = 'left'
        ctx.fillText(line, tx + 10, padTop + 22 + li * 16)
      })
    }

    drawSpectreWatermark(ctx, { w, h, dark: !dayMode })
    } catch (err) {
      // Silently handle draw errors — prevents chart type switching crashes
      console.warn('MonarchChart draw error:', err.message)
    }
  }, [chartData, type, labels, datasets, renderKey, isDayMode, hoverIndex, annotations])

  if (!spec || !chartData) return null

  const legend = datasets.length > 1 ? datasets.map((d, i) => ({
    label: d.label,
    color: d.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
  })) : null

  const chartTypes = ['line', 'bar', 'area']

  return (
    <div className="monarch-chart-card">
      {/* ── Stat cards row ── */}
      {stats && stats.length > 0 && (
        <div className="monarch-chart-stats">
          {stats.map((s, i) => (
            <div key={i} className="monarch-chart-stat">
              <span className="monarch-chart-stat-label">{s.label}</span>
              <span className="monarch-chart-stat-value" style={s.color ? { color: s.color } : undefined}>
                {s.value}
              </span>
              {s.detail && <span className="monarch-chart-stat-detail">{s.detail}</span>}
            </div>
          ))}
        </div>
      )}

      {/* ── Header + chart type toggle ── */}
      <div className="monarch-chart-header">
        <div className="monarch-chart-header-left">
          {title && <span className="monarch-chart-title">{title}</span>}
          {source && <span className="monarch-chart-source">{source}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {(switchable !== false) && (
            <div className="monarch-chart-type-toggle">
              {chartTypes.map(ct => (
                <button
                  key={ct}
                  className={`monarch-chart-type-btn ${type === ct ? 'monarch-chart-type-btn-active' : ''}`}
                  onClick={() => { setActiveType(ct); setHoverIndex(-1) }}
                  title={ct.charAt(0).toUpperCase() + ct.slice(1)}
                >
                  <ChartTypeIcon type={ct} active={type === ct} />
                </button>
              ))}
            </div>
          )}
          {onExpand && (
            <button
              className="monarch-chart-type-btn monarch-chart-expand-btn"
              onClick={() => onExpand(spec)}
              title="Fullscreen"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Legend ── */}
      {legend && (
        <div className="monarch-chart-legend">
          {legend.map((l, i) => (
            <span key={i} className="monarch-chart-legend-item">
              <span className="monarch-chart-legend-dot" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}

      {/* ── Canvas ── */}
      <canvas
        ref={canvasRef}
        className="monarch-chart-canvas"
        onMouseMove={handleCanvasMove}
        onMouseLeave={handleCanvasLeave}
      />

      {/* ── Timeline slider ── */}
      {hasSlider && (
        <div className="monarch-chart-slider-wrap">
          <span className="monarch-chart-slider-label">{allLabels[0]}</span>
          <input
            type="range"
            min="10"
            max="100"
            value={sliderValue}
            onChange={(e) => setSliderValue(Number(e.target.value))}
            className="monarch-chart-slider"
          />
          <span className="monarch-chart-slider-label">{allLabels[sliceEnd - 1]}</span>
        </div>
      )}

      {/* ── Source pills ── */}
      {sources && sources.length > 0 && (
        <div className="monarch-chart-sources">
          {sources.map((s, i) => (
            <span key={i} className="monarch-chart-source-pill">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="10" height="10">
                <path d="M6 8.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5l-1 1" />
                <path d="M10 7.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5l1-1" />
              </svg>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>
              ) : (
                s.name
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// MonarchAssetChart — render mode toggle: Spectre / Line / TradingView
// ────────────────────────────────────────────────────────────────────
// Three ways to look at the same asset:
//   - 'spectre'    : sharp canvas, area-fill, crosshair, right-axis, last-
//                    value chip (the RZ-style polish we just built).
//   - 'line'       : plain canvas line — minimal, no glow, no fill.
//   - 'tradingview': embedded TradingView Advanced widget.
//
// Spectre + Line modes fetch real bars from `/api/bars` (Binance for majors,
// Codex for long-tail). TradingView fetches its own series via the widget's
// /api/tradingview/udf/history datafeed.

const TF_TO_RESOLUTION = {
  '1M': '1', '5M': '5', '15M': '15', '1H': '60', '4H': '240', '1D': '1D', '1W': '1W',
  ALL: '1W', // weekly resolution for the all-time view
}
const TF_TO_RANGE_HOURS = {
  '1M': 6, '5M': 24, '15M': 72, '1H': 168, '4H': 24 * 30, '1D': 24 * 180, '1W': 24 * 365,
}
// Sentinel "since inception" start dates per major asset (UTC seconds).
// Falls back to 2010-01-01 for anything we don't know about — Binance/Codex
// will simply return as far back as they have data.
const INCEPTION_SECONDS = {
  BTC: Math.floor(Date.UTC(2010, 6, 17) / 1000),   // Mt. Gox launch — earliest reliable BTC data
  ETH: Math.floor(Date.UTC(2015, 7, 7) / 1000),    // ETH genesis week
  SOL: Math.floor(Date.UTC(2020, 3, 11) / 1000),   // SOL launch
  BNB: Math.floor(Date.UTC(2017, 6, 14) / 1000),
  XRP: Math.floor(Date.UTC(2013, 7, 4) / 1000),
  ADA: Math.floor(Date.UTC(2017, 9, 1) / 1000),
  DOGE: Math.floor(Date.UTC(2013, 11, 6) / 1000),
  AVAX: Math.floor(Date.UTC(2020, 8, 22) / 1000),
}
const DEFAULT_INCEPTION = Math.floor(Date.UTC(2010, 0, 1) / 1000)

function fetchBars(symbol, tf) {
  const key = `${symbol}|${tf}`
  const cached = _barsCache.get(key)
  if (cached && (Date.now() - cached.ts) < BARS_TTL_MS) return Promise.resolve(cached.bars)
  if (_barsInflight.has(key)) return _barsInflight.get(key)
  const now = Math.floor(Date.now() / 1000)
  const from = tf === 'ALL'
    ? (INCEPTION_SECONDS[symbol] || DEFAULT_INCEPTION)
    : now - (TF_TO_RANGE_HOURS[tf] || 168) * 3600
  const resolution = TF_TO_RESOLUTION[tf] || '60'
  const url = `/api/bars?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${now}&resolution=${resolution}`
  const p = fetch(url, { signal: AbortSignal.timeout(12000) })
    .then((r) => r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)))
    .then((d) => {
      const pts = Array.isArray(d?.linePoints) ? d.linePoints
                : Array.isArray(d?.bars) ? d.bars.map((b) => ({ t: b.t, c: b.c }))
                : []
      _barsCache.set(key, { ts: Date.now(), bars: pts })
      return pts
    })
    .finally(() => { _barsInflight.delete(key) })
  _barsInflight.set(key, p)
  return p
}

function MonarchAssetChart({ spec, onExpand }) {
  const symbol = String(spec.symbol || 'BTC').toUpperCase()
  const initialTf = TV_TIMEFRAMES.includes(spec.timeframe) ? spec.timeframe : DEFAULT_TV_TIMEFRAME
  const [tf, setTf] = useState(initialTf)
  const [mode, setMode] = useState('spectre') // 'spectre' | 'line' | 'tradingview'
  const [bars, setBars] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const stats = Array.isArray(spec.stats) ? spec.stats : []
  const sources = Array.isArray(spec.sources) ? spec.sources : []
  const title = spec.title
  const source = spec.source

  const dayMode = typeof document !== 'undefined'
    && (document.body.classList.contains('app-day-mode') || document.querySelector('.monarch-page-day'))

  // Fetch bars via the shared cache. If the (symbol, tf) pair is already
  // cached, the promise resolves synchronously on the next tick and the
  // canvas re-renders without flashing the skeleton. If not cached, we
  // KEEP showing the previous bars while the new fetch is in flight —
  // the canvas just dims slightly via the `.is-loading` class.
  useEffect(() => {
    if (mode === 'tradingview') return
    let cancelled = false
    const cacheKey = `${symbol}|${tf}`
    const cached = _barsCache.get(cacheKey)
    if (cached && (Date.now() - cached.ts) < BARS_TTL_MS) {
      // Instant hit
      setBars(cached.bars); setLoading(false); setError(null)
      return
    }
    setLoading(true); setError(null)
    fetchBars(symbol, tf)
      .then((pts) => { if (!cancelled) setBars(pts) })
      .catch((err) => { if (!cancelled) setError(err?.message || 'fetch failed') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [symbol, tf, mode])

  // Build a sub-spec for the canvas variant when mode is spectre/line.
  const canvasSpec = useMemo(() => {
    if (mode === 'tradingview' || !Array.isArray(bars) || bars.length < 2) return null
    const labels = bars.map((b) => {
      const d = new Date((b.t || 0) * 1000)
      // ALL: year only (e.g. "2018", "2022") so the multi-year axis is
      //      readable instead of cluttered with dates.
      // 1D/1W: short date (e.g. "May 11").
      // <=4H: 24-hour clock label (e.g. "14:00").
      if (tf === 'ALL') return String(d.getUTCFullYear())
      if (tf === '1D' || tf === '1W') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return `${String(d.getHours()).padStart(2, '0')}:00`
    })
    const data = bars.map((b) => b.c ?? b.close ?? 0)
    return {
      // Both Spectre and Line modes use a sharp line render. The
      // distinction is now subtler: Spectre keeps the dashed crosshair +
      // right-axis price chip + last-point marker (the RZ flourishes);
      // Line strips those for an even more minimal look. Done via the
      // `bare` flag below — the canvas inner branch reads it.
      type: 'line',
      title: '',
      labels,
      datasets: [{ label: symbol, data, color: '#F59E0B' }],
      switchable: false,
      bare: mode === 'line',
    }
  }, [bars, mode, symbol, tf])

  return (
    <div className="monarch-chart-card monarch-chart-card-asset">
      {/* Stats row */}
      {stats.length > 0 && (
        <div className="monarch-chart-stats">
          {stats.map((s, i) => (
            <div key={i} className="monarch-chart-stat">
              <span className="monarch-chart-stat-label">{s.label}</span>
              <span className="monarch-chart-stat-value" style={s.color ? { color: s.color } : undefined}>
                {s.value}
              </span>
              {s.detail && <span className="monarch-chart-stat-detail">{s.detail}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Header — title + mode toggle + timeframe pills */}
      <div className="monarch-chart-header">
        <div className="monarch-chart-header-left">
          {title && <span className="monarch-chart-title">{title}</span>}
          {source && <span className="monarch-chart-source">{source}</span>}
        </div>
        <div className="monarch-chart-asset-controls">
          {/* Render-mode toggle */}
          <div className="monarch-chart-mode-toggle">
            {[
              { id: 'spectre', label: 'Spectre' },
              { id: 'line', label: 'Line' },
              { id: 'tradingview', label: 'TradingView' },
            ].map((m) => (
              <button
                key={m.id}
                className={`monarch-chart-mode-btn ${mode === m.id ? 'monarch-chart-mode-btn-active' : ''}`}
                onClick={() => setMode(m.id)}
                title={m.label}
              >
                {m.label}
              </button>
            ))}
          </div>
          {/* Timeframe pills */}
          <div className="monarch-chart-tf-pills">
            {TV_TIMEFRAMES.map((label) => (
              <button
                key={label}
                className={`monarch-chart-tf-pill ${tf === label ? 'monarch-chart-tf-pill-active' : ''}`}
                onClick={() => setTf(label)}
                title={label}
              >
                {label}
              </button>
            ))}
            {onExpand && (
              <button
                className="monarch-chart-tf-pill monarch-chart-tf-expand"
                onClick={() => onExpand(spec)}
                title="Fullscreen"
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                  <path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Chart area */}
      <div className={`monarch-chart-tv-wrap ${loading && canvasSpec ? 'is-loading' : ''}`}>
        {mode === 'tradingview' ? (
          <Suspense fallback={<div className="monarch-chart-tv-skeleton" />}>
            <TradingViewAdvanced
              symbol={symbol}
              timeframe={tf === 'ALL' ? '1W' : tf}
              dayMode={!!dayMode}
              height={440}
            />
          </Suspense>
        ) : error && !canvasSpec ? (
          <div className="monarch-chart-tv-error">Couldn't load price bars: {error}</div>
        ) : canvasSpec ? (
          /* Keep showing the previous canvas during refetch; .is-loading
             on the wrapper dims it slightly so the user sees motion. */
          <MonarchChart spec={canvasSpec} />
        ) : (
          <div className="monarch-chart-tv-skeleton" />
        )}
      </div>

      {/* Sources */}
      {sources.length > 0 && (
        <div className="monarch-chart-sources">
          {sources.map((s, i) => (
            <span key={i} className="monarch-chart-source-pill">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
                <path d="M6.5 9.5a2.5 2.5 0 003.5 0l2-2a2.5 2.5 0 00-3.5-3.5l-1 1" />
                <path d="M9.5 6.5a2.5 2.5 0 00-3.5 0l-2 2a2.5 2.5 0 003.5 3.5l1-1" />
              </svg>
              {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a> : s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
