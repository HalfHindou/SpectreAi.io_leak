/**
 * vt-overlay-card.jsx — several platforms on one axis.
 *
 * The comparison chart has one hard problem: Tether earns $482m a month and a
 * challenger earns $2m, so plotted in dollars the challenger is a flat line
 * along the floor and the chart says nothing. Two modes solve it honestly:
 *
 *   INDEXED (default) — every series rebased to 100 at the start of the window,
 *     so the chart compares TRAJECTORY. This is the one that answers "who is
 *     pulling ahead".
 *   DOLLARS — the true scale, for when absolute size is the point. Kept because
 *     an indexed chart flatters a small platform, and hiding that would be the
 *     dishonest half of the trade.
 *
 * The mode is always labelled on the axis, so a reader can never mistake "up
 * 180 index" for "$180".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSettingsStore from '@/store/useSettingsStore'
import { drawSpectreWatermark } from '@/lib/chart-watermark'
import VtSeg from './vt-seg'
import { usd, shortDate, SERIES_OVERLAY } from './vt-format'

const METRICS = [
  { id: 'fees', label: 'Fees' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'dexVolume', label: 'Volume' },
]
const MODES = [
  { id: 'indexed', label: 'Indexed' },
  { id: 'absolute', label: 'Dollars' },
]
const RANGES = [
  { id: '30d', label: '30D', days: 30 },
  { id: '90d', label: '90D', days: 90 },
  { id: '180d', label: '180D', days: 180 },
]

/**
 * Four platforms, four hues — the page's all-pairs-validated overlay set.
 *
 * Warm white used to lead, on the argument that the first platform you pick is
 * the one you are asking about. It reads as chrome, not as a series, and it made
 * the compare board another greyscale chart. Identity comes from the legend and
 * the colour; primacy comes from the order of the chips above the chart.
 *
 * The set does not depend on the theme: every step sits inside BOTH the light
 * and the dark lightness band, so a line does not change identity when the
 * lights go on. (See SERIES_OVERLAY in vt-format for the validator run.)
 */
export const seriesColors = () => SERIES_OVERLAY

const PAD = { top: 18, right: 14, bottom: 28, left: 68 }

/* The hover panel, same contract as the tide's: a FIXED width, so the flip
   maths is exact on the same frame as the move rather than measured a frame
   late and jumping. */
const READOUT_W = 200
const READOUT_GAP = 16

export default function VtOverlayCard({ series, columns }) {
  const dayMode = useSettingsStore((s) => s.dayMode)
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  const [metric, setMetric] = useState('fees')
  const [mode, setMode] = useState('indexed')
  const [range, setRange] = useState('90d')
  const [hover, setHover] = useState(null)
  // Left offset of the floating panel, in canvas pixels. null = no hover.
  const [readoutX, setReadoutX] = useState(null)

  const colorOf = useMemo(() => {
    const m = new Map()
    // The set no longer consults the theme — every step is legible on both
    // surfaces — so a column keeps its colour when the lights go on.
    const palette = seriesColors()
    columns.forEach((c, i) => m.set(c.slug, palette[i % palette.length]))
    return m
  }, [columns])

  const model = useMemo(() => {
    const block = series?.[metric]
    if (!block) return null
    const src = mode === 'indexed' ? block.indexed : block.absolute
    if (!src || !Array.isArray(src.t) || src.t.length < 2) return null

    const days = RANGES.find((r) => r.id === range)?.days ?? 90
    const cutoff = Math.floor(Date.now() / 1000) - days * 86_400
    const keep = src.t.map((t, i) => [t, i]).filter(([t]) => t >= cutoff)
    if (keep.length < 2) return null
    const t = keep.map(([tt]) => tt)
    const idx = keep.map(([, i]) => i)

    // Rebase INSIDE the visible window: an indexed chart whose 100 sits 180 days
    // off-screen is telling the reader about a period they cannot see.
    const lines = columns.map((c) => {
      const raw = idx.map((i) => src.values[c.slug]?.[i] ?? null)
      if (mode !== 'indexed') return { slug: c.slug, name: c.name, color: colorOf.get(c.slug), values: raw }
      const base = raw.find((v) => Number.isFinite(v) && v > 0)
      return {
        slug: c.slug, name: c.name, color: colorOf.get(c.slug),
        values: base ? raw.map((v) => (Number.isFinite(v) ? (v / base) * 100 : null)) : raw.map(() => null),
      }
    }).filter((l) => l.values.some((v) => Number.isFinite(v)))

    if (!lines.length) return null
    const flat = lines.flatMap((l) => l.values).filter((v) => Number.isFinite(v))
    return { t, lines, min: Math.min(...flat, mode === 'indexed' ? 100 : 0), max: Math.max(...flat, 1) }
  }, [series, metric, mode, range, columns, colorOf])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !model) return

    const rect = wrap.getBoundingClientRect()
    const w = Math.max(260, Math.round(rect.width))
    const h = Math.max(220, Math.round(rect.height))
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    // Guarded: reassigning width/height reallocates the backing store even when
    // the value is identical, which shows up as a flicker on every redraw.
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`
    }

    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const plotW = w - PAD.left - PAD.right
    const plotH = h - PAD.top - PAD.bottom
    const grid = dayMode ? 'rgba(15,23,42,0.09)' : 'rgba(255,255,255,0.07)'
    const axisText = dayMode ? 'rgba(15,23,42,0.62)' : 'rgba(245,245,247,0.62)'
    const span = model.max - model.min || 1
    const y = (v) => PAD.top + plotH - ((v - model.min) / span) * plotH
    const x = (i) => PAD.left + (i / Math.max(1, model.t.length - 1)) * plotW

    ctx.font = '11px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'right'
    for (let g = 0; g <= 4; g++) {
      const v = model.min + (span / 4) * g
      const yy = Math.round(y(v)) + 0.5
      ctx.strokeStyle = grid
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(PAD.left, yy); ctx.lineTo(w - PAD.right, yy); ctx.stroke()
      ctx.fillStyle = axisText
      ctx.fillText(mode === 'indexed' ? Math.round(v).toString() : usd(v, { decimals: 0 }), PAD.left - 9, yy)
    }

    // The 100 line is the whole reference frame in indexed mode — draw it solid.
    if (mode === 'indexed' && model.min <= 100 && model.max >= 100) {
      const yy = Math.round(y(100)) + 0.5
      ctx.strokeStyle = dayMode ? 'rgba(15,23,42,0.28)' : 'rgba(255,255,255,0.26)'
      ctx.setLineDash([4, 4])
      ctx.beginPath(); ctx.moveTo(PAD.left, yy); ctx.lineTo(w - PAD.right, yy); ctx.stroke()
      ctx.setLineDash([])
    }

    for (const line of model.lines) {
      ctx.beginPath()
      let started = false
      line.values.forEach((v, i) => {
        if (!Number.isFinite(v)) return
        if (!started) { ctx.moveTo(x(i), y(v)); started = true } else ctx.lineTo(x(i), y(v))
      })
      ctx.strokeStyle = line.color
      ctx.lineWidth = 1.8
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.stroke()
    }

    if (hover != null && model.t[hover] != null) {
      const hx = Math.round(x(hover)) + 0.5
      ctx.strokeStyle = dayMode ? 'rgba(15,23,42,0.3)' : 'rgba(255,255,255,0.3)'
      ctx.beginPath(); ctx.moveTo(hx, PAD.top); ctx.lineTo(hx, PAD.top + plotH); ctx.stroke()
      for (const line of model.lines) {
        const v = line.values[hover]
        if (!Number.isFinite(v)) continue
        ctx.fillStyle = line.color
        ctx.beginPath(); ctx.arc(hx, y(v), 3, 0, Math.PI * 2); ctx.fill()
      }
    }

    ctx.textAlign = 'center'
    ctx.fillStyle = axisText
    const ticks = Math.min(6, model.t.length)
    for (let k = 0; k < ticks; k++) {
      const i = Math.round((k / Math.max(1, ticks - 1)) * (model.t.length - 1))
      const d = new Date(model.t[i] * 1000)
      ctx.fillText(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }), x(i), h - PAD.bottom + 14)
    }

    // Drawn LAST so the mark sits over the data, never under it.
    drawSpectreWatermark(ctx, { w, h, dark: !dayMode, plot: { x: PAD.left, y: PAD.top, w: plotW, h: plotH } })
  }, [model, dayMode, hover, mode])

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(draw) })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [draw])

  const onMove = (e) => {
    const wrap = wrapRef.current
    if (!wrap || !model) return
    const rect = wrap.getBoundingClientRect()
    const plotW = rect.width - PAD.left - PAD.right
    const i = Math.round(((e.clientX - rect.left - PAD.left) / Math.max(1, plotW)) * (model.t.length - 1))
    if (i < 0 || i >= model.t.length) { setHover(null); setReadoutX(null); return }
    setHover(i)

    // The crosshair used to be the whole of the hover: the values it was
    // pointing at printed in the legend ~90px BELOW the card, so reading a
    // point meant looking away from the point. The panel follows the crosshair
    // and flips to whichever side has room, bounded by the plot rather than the
    // canvas so it never sits over the axis gutter.
    const cx = PAD.left + (i / Math.max(1, model.t.length - 1)) * plotW
    const rightBound = rect.width - PAD.right
    let left = cx + READOUT_GAP
    if (left + READOUT_W > rightBound) left = cx - READOUT_GAP - READOUT_W
    setReadoutX(Math.max(PAD.left, Math.min(left, Math.max(PAD.left, rightBound - READOUT_W))))
  }

  /** Touch is the same gesture with a different event shape. */
  const onTouchPoint = (e) => { const t = e.touches[0]; if (t) onMove({ clientX: t.clientX }) }

  const hoverDate = hover != null && model?.t[hover]
    ? shortDate(new Date(model.t[hover] * 1000).toISOString().slice(0, 10))
    : null

  return (
    <div className="vt-chart vt-overlay">
      <div className="vt-chart__controls">
        <div className="vt-chart__title">
          <h3>Side by side</h3>
          <span>
            {mode === 'indexed'
              ? 'Each platform rebased to 100 at the start of the window — this compares trajectory, not size.'
              : 'True dollar scale — the biggest platform dominates the axis, which is the point.'}
          </span>
        </div>
        <div className="vt-chart__ctl">
          <VtSeg size="sm" label="Metric" value={metric} onChange={setMetric} items={METRICS} />
          <VtSeg size="sm" label="Scale" value={mode} onChange={setMode} items={MODES} />
          <div className="vt-chart__ranges" role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button key={r.id} type="button"
                className={`vt-pill vt-pill--sm${range === r.id ? ' is-active' : ''}`}
                onClick={() => setRange(r.id)} aria-pressed={range === r.id}>{r.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="vt-chart__canvas" ref={wrapRef} onMouseMove={onMove}
        onMouseLeave={() => { setHover(null); setReadoutX(null) }}
        /* A finger reads the same chart. onMove only ever looks at clientX, so
           one synthetic point is the whole bridge; touch-action: pan-y (mobile
           sheet) keeps a vertical drag scrolling the page and gives us the
           horizontal one. Never preventDefault — React's listeners are passive
           and the axis is decided in CSS, not by cancelling the gesture. */
        onTouchStart={onTouchPoint} onTouchMove={onTouchPoint}
        onTouchEnd={() => { setHover(null); setReadoutX(null) }}>
        <canvas ref={canvasRef} aria-label="Platform comparison" />
        {model && hover != null && readoutX != null ? (
          <div className="vt-overlay__readout" aria-hidden="true" style={{ left: `${readoutX}px` }}>
            <span className="vt-overlay__readout-date">{hoverDate}</span>
            <ul>
              {model.lines.map((l) => {
                const v = l.values[hover]
                if (!Number.isFinite(v)) return null
                return (
                  <li key={l.slug}>
                    <i style={{ background: l.color }} aria-hidden="true" />
                    <span className="vt-overlay__readout-name">{l.name}</span>
                    <span className="vt-overlay__readout-val">
                      {mode === 'indexed' ? Math.round(v) : usd(v)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
        {!model ? <p className="vt-empty">No overlapping history for this metric.</p> : null}
      </div>

      <ul className="vt-overlay__legend">
        {(model?.lines || []).map((l) => (
          <li key={l.slug}>
            <i style={{ background: l.color }} aria-hidden="true" />
            <span className="vt-overlay__name">{l.name}</span>
            {hover != null && Number.isFinite(l.values[hover]) ? (
              <span className="vt-overlay__val">
                {mode === 'indexed' ? Math.round(l.values[hover]) : usd(l.values[hover])}
              </span>
            ) : null}
          </li>
        ))}
        {hoverDate ? <li className="vt-overlay__date">{hoverDate}</li> : null}
      </ul>
    </div>
  )
}
