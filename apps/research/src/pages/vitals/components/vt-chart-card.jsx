/**
 * vt-chart-card.jsx — one chart, with its own controls.
 *
 * The project dashboard is a grid of these rather than one chart with a global
 * toolbar, so two charts can sit side by side on different intervals and the
 * reader can compare shapes instead of remembering them.
 *
 * Controls: interval (daily / weekly / monthly) and form (bars / line / area /
 * cumulative). Aggregation happens here, on real daily values — a "weekly" bar
 * is the sum of its days, never a resampled point.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSettingsStore from '@/store/useSettingsStore'
import { drawSpectreWatermark } from '@/lib/chart-watermark'
import VtSeg from './vt-seg'
import { usd, count, shortDate, SERIES_LEAD } from './vt-format'

const RANGES = [
  { id: '30d', label: '30D', days: 30 },
  { id: '90d', label: '90D', days: 90 },
  { id: '1y', label: '1Y', days: 365 },
  { id: 'all', label: 'All', days: 99_999 },
]

const INTERVALS = [
  { id: 'day', label: 'Daily' },
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
]

const FORMS = [
  { id: 'bars', label: 'Bars' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'cumulative', label: 'Cumulative' },
]

const PAD = { top: 16, right: 10, bottom: 26, left: 64 }

/* The hover panel. Width is FIXED and matched in the stylesheet, because the
   side-flip runs on the same frame as the move — a measured width lands a frame
   late and the panel jumps into place. */
const RO_W = 118
const RO_GAP = 14
// Losses are red wherever a series straddles zero — the accent tone alone
// would print a drawdown in the same colour as a record day. Design-system
// --bear, so a losing bar here is the same red as a losing row on the ladder.
// Reserved: no series in the palette wears it, so red here always means down.
const DOWN = '#F87171'

/** Sum daily points into calendar buckets. */
function bucket(points, interval) {
  if (interval === 'day') return points
  const out = new Map()
  for (const [t, v] of points) {
    const d = new Date(t * 1000)
    let key
    if (interval === 'week') {
      // ISO-ish week key: back up to Monday in UTC.
      const day = (d.getUTCDay() + 6) % 7
      const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day) / 1000
      key = monday
    } else {
      key = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
    }
    out.set(key, (out.get(key) || 0) + (v || 0))
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0])
}

export default function VtChartCard({
  title, subtitle, series, tone, defaultRange = '90d', defaultForm = 'bars', height,
  kind = 'usd',
}) {
  // Not every series on this page is money — an address count formatted as
  // dollars reads as a currency figure and is simply wrong.
  const fmt = kind === 'count' ? (v) => count(v) : (v) => usd(v)
  const fmtAxis = kind === 'count' ? (v) => count(v) : (v) => usd(v, { decimals: 0 })
  const dayMode = useSettingsStore((s) => s.dayMode)
  // A chart with no tone of its own takes SLOT ONE, not the theme's ink. It used
  // to fall through to leadTone — warm white on black, near-black on paper —
  // which is how a platform page rendered as three white bar charts in a row
  // (founder: "we had amazing colors here it all went gray and white now").
  // Slot one also survives the theme flip without changing, so a card does not
  // change identity when the lights go on.
  const ink = tone || SERIES_LEAD
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  const [range, setRange] = useState(defaultRange)
  const [interval, setInterval] = useState('day')
  const [form, setForm] = useState(defaultForm)
  const [hover, setHover] = useState(null)
  // Left offset of the panel in canvas px; null parks it in the corner.
  const [readoutX, setReadoutX] = useState(null)

  const points = useMemo(() => {
    const days = RANGES.find((r) => r.id === range)?.days ?? 90
    const cutoff = Math.floor(Date.now() / 1000) - days * 86_400
    const raw = (series || []).filter((p) => Array.isArray(p) && p[0] >= cutoff && p[1] != null)
    const bucketed = bucket(raw, interval)
    if (form !== 'cumulative') return bucketed
    let acc = 0
    return bucketed.map(([t, v]) => { acc += v || 0; return [t, acc] })
  }, [series, range, interval, form])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const rect = wrap.getBoundingClientRect()
    const w = Math.max(240, Math.round(rect.width))
    const h = Math.max(180, Math.round(rect.height))
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }

    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (points.length < 2) return

    const plotW = w - PAD.left - PAD.right
    const plotH = h - PAD.top - PAD.bottom
    const vals = points.map((p) => p[1])
    // A series that can go negative — trader PnL is the obvious one — was scaled
    // against `max` alone with the floor pinned at zero, so every losing day was
    // drawn BELOW the plot: the line ran out through the date axis and off the
    // bottom of the card. The domain now always contains zero and stretches to
    // whichever side the data actually reaches.
    const lo = Math.min(0, ...vals)
    const hi = Math.max(0, ...vals)
    const span = (hi - lo) || 1
    const hasNeg = lo < 0
    const grid = dayMode ? 'rgba(15,23,42,0.09)' : 'rgba(255,255,255,0.07)'
    const zeroLine = dayMode ? 'rgba(15,23,42,0.28)' : 'rgba(255,255,255,0.24)'
    const axisText = dayMode ? 'rgba(15,23,42,0.6)' : 'rgba(245,245,247,0.6)'

    const x = (i) => PAD.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * plotW)
    const y = (v) => PAD.top + plotH - ((v - lo) / span) * plotH
    const yZero = y(0)

    ctx.font = '11px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'right'
    for (let g = 0; g <= 4; g++) {
      const v = lo + (span / 4) * g
      const gy = Math.round(y(v)) + 0.5
      ctx.strokeStyle = grid
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD.left, gy)
      ctx.lineTo(w - PAD.right, gy)
      ctx.stroke()
      // The bottom gridline is the frame, not a reading — except when the floor
      // is a real negative number, where suppressing it would hide the depth.
      // Skip any tick that would print on top of the zero label below.
      const collidesWithZero = hasNeg && Math.abs(gy - yZero) < 12
      if ((g > 0 || hasNeg) && !collidesWithZero) {
        ctx.fillStyle = axisText
        ctx.fillText(fmtAxis(v), PAD.left - 9, gy)
      }
    }

    // Zero has to be legible as zero once the chart straddles it.
    if (hasNeg) {
      const zy = Math.round(yZero) + 0.5
      ctx.strokeStyle = zeroLine
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD.left, zy)
      ctx.lineTo(w - PAD.right, zy)
      ctx.stroke()
      ctx.fillStyle = axisText
      ctx.fillText(fmtAxis(0), PAD.left - 9, zy)
    }

    const bw = Math.max(1, plotW / points.length - (points.length > 120 ? 0 : 1.5))

    // THE CROSSHAIR. The only thing marking the hovered point was the bar
    // brightening, and on a ninety-bar chart that is not findable: the panel
    // said "Jul 19" and the reader had to count columns to see which one.
    // Drawn BEFORE the series, so the bar sits on top of it and the line reads
    // as a pointer down to the bar rather than a stroke slicing through it.
    if (hover != null && points[hover]) {
      const hx = Math.round(form === 'bars'
        ? PAD.left + (hover / points.length) * plotW + bw / 2
        : x(hover)) + 0.5
      ctx.strokeStyle = dayMode ? 'rgba(15,23,42,0.28)' : 'rgba(255,255,255,0.26)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(hx, PAD.top)
      ctx.lineTo(hx, PAD.top + plotH)
      ctx.stroke()
    }

    if (form === 'bars') {
      points.forEach((p, i) => {
        const bx = PAD.left + (i / points.length) * plotW
        const v = p[1] || 0
        const down = v < 0
        // Bars used to be Math.max(1, v/max*plotH) tall from the floor, so a loss
        // rendered as a 1px stub and read as "roughly nothing".
        const top = down ? yZero : y(v)
        const bh = Math.max(1, Math.abs(y(v) - yZero))
        const on = hover === i
        const paint = down ? DOWN : ink
        const g = ctx.createLinearGradient(0, down ? top + bh : top, 0, down ? top : top + bh)
        // A hovered bar brightens on black and DARKENS on paper; a hard white
        // highlight in day mode simply erased the bar under the cursor.
        g.addColorStop(0, on ? (dayMode ? '#000000' : '#ffffff') : paint)
        g.addColorStop(1, `${paint}22`)
        ctx.fillStyle = g
        ctx.fillRect(bx, top, bw, bh)
      })
    } else {
      const path = new Path2D()
      points.forEach((p, i) => { const px = x(i); const py = y(p[1]); if (i === 0) path.moveTo(px, py); else path.lineTo(px, py) })

      if (form === 'area' || form === 'cumulative') {
        const fill = new Path2D(path)
        fill.lineTo(x(points.length - 1), yZero)
        fill.lineTo(x(0), yZero)
        fill.closePath()
        const g = ctx.createLinearGradient(0, PAD.top, 0, yZero)
        g.addColorStop(0, `${ink}66`)
        g.addColorStop(1, `${ink}05`)
        ctx.fillStyle = g
        ctx.fill(fill)
      }

      ctx.strokeStyle = ink
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.shadowColor = `${ink}88`
      ctx.shadowBlur = 10
      ctx.stroke(path)
      ctx.shadowBlur = 0
    }

    ctx.textAlign = 'center'
    ctx.fillStyle = axisText
    const ticks = Math.min(6, points.length)
    for (let t = 0; t < ticks; t++) {
      const i = Math.round((t / Math.max(1, ticks - 1)) * (points.length - 1))
      const d = new Date(points[i][0] * 1000)
      const label = interval === 'month'
        ? d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
        : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
      ctx.fillText(label, PAD.left + (i / Math.max(1, points.length)) * plotW, h - PAD.bottom + 13)
    }

    // Drawn LAST so the mark sits over the data, never under it.
    drawSpectreWatermark(ctx, { w, h, dark: !dayMode, plot: { x: PAD.left, y: PAD.top, w: plotW, h: plotH } })
  }, [points, dayMode, hover, form, interval, ink, fmtAxis])

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(draw)
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [draw])

  const onMove = (e) => {
    const wrap = wrapRef.current
    if (!wrap || !points.length) return
    const rect = wrap.getBoundingClientRect()
    const plotW = rect.width - PAD.left - PAD.right
    const i = Math.floor(((e.clientX - rect.left - PAD.left) / Math.max(1, plotW)) * points.length)
    if (i < 0 || i >= points.length) { setHover(null); setReadoutX(null); return }
    setHover(i)

    // Parked in the corner the panel was a fixed address: hovering a bar on the
    // left of a 90-day chart put its date and figure the width of the card away
    // from the bar they describe. It follows the bar now and flips to whichever
    // side has room.
    const cx = PAD.left + ((i + 0.5) / points.length) * plotW
    let left = cx + RO_GAP
    if (left + RO_W > rect.width - 6) left = cx - RO_GAP - RO_W
    setReadoutX(Math.max(6, Math.min(left, Math.max(6, rect.width - 6 - RO_W))))
  }

  /** Touch is the same gesture with a different event shape. */
  const onTouchPoint = (e) => { const t = e.touches[0]; if (t) onMove({ clientX: t.clientX }) }

  const hp = hover != null && points[hover] ? points[hover] : null

  return (
    <div className="vt-chart" style={height ? { '--vt-chart-h': height } : undefined}>
      <div className="vt-chart__controls">
        <div className="vt-chart__title">
          <h3>{title}</h3>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        <div className="vt-chart__ctl">
          <VtSeg size="sm" label="Interval" value={interval} onChange={setInterval} items={INTERVALS} />
          <VtSeg size="sm" label="Form" value={form} onChange={setForm} items={FORMS} />
          <div className="vt-chart__ranges" role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button key={r.id} type="button"
                className={`vt-pill vt-pill--sm${range === r.id ? ' is-active' : ''}`}
                onClick={() => setRange(r.id)} aria-pressed={range === r.id}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="vt-chart__canvas" ref={wrapRef} onMouseMove={onMove}
        onMouseLeave={() => { setHover(null); setReadoutX(null) }}
        onTouchStart={onTouchPoint} onTouchMove={onTouchPoint}
        onTouchEnd={() => { setHover(null); setReadoutX(null) }}>
        <canvas ref={canvasRef} aria-label={title} />
        {/* One point draws nothing — draw() needs two to make a line — and the
            old guard only caught zero, so a thin series left a silent blank
            card that read as a chart that failed to load. */}
        {points.length < 2 ? (
          <p className="vt-empty">
            {series?.length
              ? 'Not enough history in this range — try a longer window.'
              : 'No series for this metric.'}
          </p>
        ) : null}
        {hp ? (
          <div className="vt-chart__readout"
            style={readoutX != null ? { left: `${readoutX}px`, right: 'auto' } : undefined}>
            <span>{shortDate(new Date(hp[0] * 1000).toISOString().slice(0, 10))}</span>
            <strong>{fmt(hp[1])}</strong>
          </div>
        ) : null}
      </div>
    </div>
  )
}
