/**
 * RoiPriceChart — the token's price history as a clean canvas area chart.
 *
 * Data comes from the same path the Research Zone chart uses — Codex OHLCV via
 * getBars (see use-roi-chart.js) — so short ranges render with intraday
 * granularity instead of CoinGecko's one-point-per-day series. The line is
 * drawn with monotone-cubic smoothing (premium feel, no overshoot past the
 * data), a soft glow, and a left-to-right reveal on load / range change. The
 * chart auto-scales to the visible price range (no far-away ATH marker — the
 * ATH lives in the page's left card). Hovering reveals a crosshair + a tooltip
 * that floats next to the cursor; the x-axis carries several date ticks aligned
 * to the data.
 *
 * While bars load (first paint AND every uncached range switch) the chart body
 * is replaced by an animated ghost-line loader (ChartLoader) — the header and
 * range tabs stay live so switching stays responsive.
 *
 * Line + fill are coloured bull/bear by the in-view direction (first vs last
 * price). Returns null when the coin has no usable history.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRoiChart } from './use-roi-chart'

const RANGES = [
  { key: '1d', label: '1D' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: '6m', label: '6M' },
  { key: '1y', label: '1Y' },
  { key: 'max', label: 'Max' },
]

const TT_W = 118 // tooltip width estimate (for clamping)
const TT_H = 46 // tooltip height estimate

function ChartLoader() {
  return (
    <div className="rpc-loader" aria-hidden>
      <span className="rpc-loader__grid" />
      <span className="rpc-loader__grid" />
      <span className="rpc-loader__grid" />
      <div className="rpc-loader__shimmer" />
    </div>
  )
}

function fmtPriceTick(p) {
  if (!Number.isFinite(p) || p <= 0) return '—'
  if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (p >= 0.01) return '$' + p.toFixed(4)
  if (p >= 0.0001) return '$' + p.toFixed(6)
  return '$' + p.toExponential(2)
}

// Full date for the hover tooltip (intraday ranges show the time too).
function fmtHoverDate(ts, range) {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  if (range === '1d') {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Compact axis tick — granularity adapts to the range.
function fmtAxisTick(ts, range) {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  if (range === '1d') return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (range === '7d' || range === '30d') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (range === '90d' || range === '6m') return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  if (range === '1y') return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  return String(d.getUTCFullYear())
}

// Monotone-cubic (Fritsch–Carlson) path through pts=[{x,y}]. Issues canvas
// path commands only (caller handles begin/fill/stroke). Guarantees the curve
// never overshoots the data — critical for honest price charts.
function tracePath(ctx, pts) {
  const n = pts.length
  if (n === 0) return
  ctx.moveTo(pts[0].x, pts[0].y)
  if (n < 3) {
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y)
    return
  }
  const dx = new Array(n - 1)
  const slope = new Array(n - 1)
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x
    slope[i] = dx[i] !== 0 ? (pts[i + 1].y - pts[i].y) / dx[i] : 0
  }
  const m = new Array(n)
  m[0] = slope[0]
  m[n - 1] = slope[n - 2]
  for (let i = 1; i < n - 1; i++) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; continue }
    const a = m[i] / slope[i]
    const b = m[i + 1] / slope[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * slope[i]
      m[i + 1] = t * b * slope[i]
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]
    ctx.bezierCurveTo(
      pts[i].x + h / 3, pts[i].y + (m[i] * h) / 3,
      pts[i + 1].x - h / 3, pts[i + 1].y - (m[i + 1] * h) / 3,
      pts[i + 1].x, pts[i + 1].y,
    )
  }
}

function RoiPriceChart({ selected, dayMode = false }) {
  // Default to the full history — on the "ROI to ATH" page the whole price
  // journey is the most relevant view.
  const [range, setRange] = useState('max')
  const [hover, setHover] = useState(null) // { x, y, ts, price }
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const plotRef = useRef(null) // { points: [{x,y,ts,price}] } for hover hit-testing
  const progressRef = useRef(1) // reveal animation 0→1
  const rafRef = useRef(0)

  const cgId = selected?.id || null
  const symbol = selected?.symbol?.toUpperCase() || ''

  const { series, loading } = useRoiChart({ symbol, cgId, range })

  useEffect(() => { setHover(null) }, [range, cgId])

  // Series is already range-scoped by the hook.
  const view = series && series.length >= 2 ? series : null

  const stats = useMemo(() => {
    if (!view) return null
    let min = Infinity
    let max = -Infinity
    for (const [, p] of view) {
      if (p < min) min = p
      if (p > max) max = p
    }
    const first = view[0][1]
    const last = view[view.length - 1][1]
    const changePct = first > 0 ? ((last - first) / first) * 100 : 0
    return { min, max, first, last, changePct, up: changePct >= 0 }
  }, [view])

  // X-axis ticks aligned to the data (fraction across the plot). Drop
  // consecutive duplicate labels (e.g. repeated years on Max).
  const axisTicks = useMemo(() => {
    if (!view) return []
    const t0 = view[0][0]
    const t1 = view[view.length - 1][0]
    const span = t1 - t0 || 1
    const N = 6
    const raw = []
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1)
      raw.push({ f, label: fmtAxisTick(t0 + f * span, range) })
    }
    return raw.filter((t, i) => i === 0 || t.label !== raw[i - 1].label)
  }, [view, range])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !view || !stats) return
    const { w, h } = sizeRef.current
    if (w < 2 || h < 2) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const padL = 6
    const padR = 6
    const padT = 12
    const padB = 10
    const plotW = w - padL - padR
    const plotH = h - padT - padB

    const t0 = view[0][0]
    const t1 = view[view.length - 1][0]
    const tSpan = Math.max(1, t1 - t0)
    const pMin = stats.min
    const pSpan = Math.max(1e-12, stats.max - pMin)

    const xFor = (ts) => padL + ((ts - t0) / tSpan) * plotW
    const yFor = (p) => padT + (1 - (p - pMin) / pSpan) * plotH

    const up = stats.up
    const line = up ? '#10B981' : '#EF4444'
    const lineBright = up ? '#34D399' : '#F87171'

    // Build path points (also cached for hover hit-testing — full, not clipped).
    const points = view.map(([ts, p]) => ({ x: xFor(ts), y: yFor(p), ts, price: p }))
    plotRef.current = { points }

    const prog = Math.max(0, Math.min(1, progressRef.current))
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, padL + plotW * prog + 2, h) // left-to-right reveal
    ctx.clip()

    // Area fill (smoothed)
    ctx.beginPath()
    tracePath(ctx, points)
    ctx.lineTo(points[points.length - 1].x, padT + plotH)
    ctx.lineTo(points[0].x, padT + plotH)
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH)
    grad.addColorStop(0, up ? 'rgba(16,185,129,0.24)' : 'rgba(239,68,68,0.24)')
    grad.addColorStop(1, up ? 'rgba(16,185,129,0.00)' : 'rgba(239,68,68,0.00)')
    ctx.fillStyle = grad
    ctx.fill()

    // Line stroke (smoothed) with a soft glow
    ctx.beginPath()
    tracePath(ctx, points)
    ctx.lineWidth = 1.9
    ctx.strokeStyle = line
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.shadowColor = up ? 'rgba(16,185,129,0.45)' : 'rgba(239,68,68,0.45)'
    ctx.shadowBlur = 7
    ctx.shadowOffsetY = 1
    ctx.stroke()
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0

    // Last-price dot
    const lastPt = points[points.length - 1]
    ctx.beginPath()
    ctx.arc(lastPt.x, lastPt.y, 3, 0, Math.PI * 2)
    ctx.fillStyle = lineBright
    ctx.fill()
    ctx.beginPath()
    ctx.arc(lastPt.x, lastPt.y, 5.5, 0, Math.PI * 2)
    ctx.fillStyle = up ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.18)'
    ctx.fill()

    ctx.restore()
  }, [view, stats]) // dayMode dropped: draw hardcodes bull/bear colors, never reads it

  // Reveal animation on load / range / token change (runs once, then stops).
  const drawRef = useRef(draw)
  drawRef.current = draw
  useEffect(() => {
    if (!view || loading) return undefined
    cancelAnimationFrame(rafRef.current)
    progressRef.current = 0
    const start = performance.now()
    const DUR = 480
    const tick = (now) => {
      const t = Math.min(1, (now - start) / DUR)
      progressRef.current = 1 - Math.pow(1 - t, 3) // easeOutCubic
      drawRef.current()
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [view, loading])

  // Resize observer + redraw (only while the canvas is mounted, i.e. not loading)
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || loading) return undefined
    const measure = () => {
      const r = wrap.getBoundingClientRect()
      sizeRef.current = { w: r.width, h: r.height }
      draw()
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [draw, loading])

  useEffect(() => { if (!loading) draw() }, [draw, loading])

  const onMove = useCallback((e) => {
    const plot = plotRef.current
    const canvas = canvasRef.current
    if (!plot || !canvas || !plot.points.length) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    let best = plot.points[0]
    let bestD = Infinity
    for (const pt of plot.points) {
      const d = Math.abs(pt.x - x)
      if (d < bestD) { bestD = d; best = pt }
    }
    setHover({ x: best.x, y: best.y, ts: best.ts, price: best.price })
  }, [])

  const onLeave = useCallback(() => setHover(null), [])

  // No data and not loading → hide entirely (page degrades cleanly).
  if (!loading && (!view || !stats)) return null

  const ready = !!(view && stats)
  const { w } = sizeRef.current
  // Tooltip floats next to the cursor: centred on the point, above it, clamped
  // to the chart; flips below when there's no room up top.
  let ttLeft = 0
  let ttTop = 0
  let ttBelow = false
  if (hover) {
    ttLeft = Math.max(4, Math.min((w || 0) - TT_W - 4, hover.x - TT_W / 2))
    ttTop = hover.y - TT_H - 12
    if (ttTop < 2) { ttTop = hover.y + 14; ttBelow = true }
  }

  return (
    <div className={`rpc${dayMode ? ' rpc--day' : ''}`}>
      <div className="rpc-head">
        <div className="rpc-head__left">
          <span className="rpc-head__eyebrow">PRICE HISTORY</span>
          <h3 className="rpc-head__title">
            {symbol || selected?.name || '—'}
            {ready && !loading ? (
              <span className={`rpc-head__chg${stats.up ? ' is-up' : ' is-down'}`}>
                {stats.up ? '+' : ''}{stats.changePct.toFixed(1)}%
              </span>
            ) : (
              <span className="rpc-head__chg-skel" aria-hidden />
            )}
          </h3>
        </div>
        <div className="rpc-ranges" role="tablist" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={range === r.key}
              className={`rpc-range${range === r.key ? ' is-active' : ''}`}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <ChartLoader />
      ) : (
        <div
          ref={wrapRef}
          className="rpc-canvas-wrap"
          onMouseMove={onMove}
          onMouseLeave={onLeave}
        >
          <canvas ref={canvasRef} className="rpc-canvas" />
          {hover && (
            <>
              <span className="rpc-crosshair" style={{ left: `${hover.x}px` }} aria-hidden />
              <span className="rpc-hover-dot" style={{ left: `${hover.x}px`, top: `${hover.y}px` }} aria-hidden />
              <div className={`rpc-tooltip${ttBelow ? ' rpc-tooltip--below' : ''}`} style={{ left: `${ttLeft}px`, top: `${ttTop}px` }}>
                <span className="rpc-tooltip__price">{fmtPriceTick(hover.price)}</span>
                <span className="rpc-tooltip__date">{fmtHoverDate(hover.ts, range)}</span>
              </div>
            </>
          )}
        </div>
      )}

      {ready && !loading && axisTicks.length > 0 && (
        <div className="rpc-xaxis" aria-hidden>
          {axisTicks.map((t, i) => (
            <span
              key={i}
              className="rpc-xaxis__tick"
              style={{
                left: `${t.f * 100}%`,
                transform: t.f === 0 ? 'none' : (t.f === 1 ? 'translateX(-100%)' : 'translateX(-50%)'),
              }}
            >
              {t.label}
            </span>
          ))}
        </div>
      )}

      <div className="rpc-foot">
        <span className="rpc-foot__item">
          <span className="rpc-foot__label">Low</span>
          <span className="rpc-foot__val">{ready && !loading ? fmtPriceTick(stats.min) : '—'}</span>
        </span>
        <span className="rpc-foot__item">
          <span className="rpc-foot__label">High</span>
          <span className="rpc-foot__val">{ready && !loading ? fmtPriceTick(stats.max) : '—'}</span>
        </span>
      </div>
    </div>
  )
}

// memo: parent re-renders on every amount/what-if keystroke; props (selected,
// dayMode) are unchanged so a shallow memo skips the wasted reconcile.
export default React.memo(RoiPriceChart)
