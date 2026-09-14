/**
 * vt-tide.jsx — THE TIDE, the VITALS hero.
 *
 * Daily protocol fees: the top earners as named bands, with everything else as
 * the floor beneath them. It answers the page's first question — whose money is
 * this? — as a picture rather than a table, and every pixel is a real daily
 * figure. No ambient decoration.
 *
 * FOUR MODES over the same series (see MODES): stacked dollars, share of day,
 * a streamgraph, and unstacked lines. They differ only in where each band's
 * baseline sits and what the vertical axis is allowed to claim — one `geom`
 * memo computes that, and draw() is the same code for all four.
 *
 * Canvas rather than SVG: ~730 days x 9 bands is ~6,500 points per repaint and
 * the crosshair follows the cursor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSettingsStore from '@/store/useSettingsStore'
import { drawSpectreWatermark } from '@/lib/chart-watermark'
import VtSeg from './vt-seg'
import { usd, pct, shortDate, hexToRgba, SERIES, SERIES_MAX, restTone } from './vt-format'

const RANGES = [
  { id: '90d', label: '90D', days: 90 },
  { id: '1y', label: '1Y', days: 365 },
  { id: '2y', label: '2Y', days: 730 },
]

/**
 * FOUR WAYS TO READ THE SAME DAYS. One stacked area answers exactly one
 * question — how big is the whole thing — and buries three others: who is
 * taking share, what the shape of the market is, and how any two platforms
 * compare head to head. Each mode below is the same nine series; only the
 * baseline and the scale change.
 */
const MODES = [
  { id: 'stack', label: 'Stacked', title: 'Absolute dollars, stacked to the daily total' },
  { id: 'share', label: 'Share', title: 'Each day normalised to 100% — who is taking share' },
  { id: 'stream', label: 'Stream', title: 'Stacked around a floating centre — the shape of the market' },
  { id: 'lines', label: 'Lines', title: 'Unstacked, one line each — compare two platforms directly' },
]

// Real gutters: values live in the LEFT gutter like every other chart on this
// page, dates get a 30px band under the plot. The stat rail used to float over
// the bottom 104px of the canvas and sat directly on top of the date labels.
const PAD = { top: 18, right: 18, bottom: 30, left: 68 }

// Room for the end-of-band labels. Below this the canvas is too narrow to carry
// them and they collapse back into the legend row.
const LABEL_GUTTER = 138
const LABEL_MIN_W = 560

/* The hover panel. Its width is fixed so the flip maths can be exact rather
   than measured a frame late, and the gap is the distance it keeps from the
   crosshair it is describing. */
const READOUT_W = 236
const READOUT_GAP = 18
/* How many bands the panel names before it folds the tail into one line. */
const READOUT_ROWS = 6

/**
 * The bands wear the page's SERIES palette, in slot order.
 *
 * This chart used to paint itself with a warm-white luminance ramp — bronze at
 * the floor, cream at the crest — on the argument that a stack is one quantity
 * cut into layers, so hue would be decoration. It is not: each band is a
 * different company, which is identity, and identity is exactly the job a
 * categorical palette exists to do. What the ramp actually produced was nine
 * shades of the same brown, the largest object on the page wearing no
 * information at all (founder: "this is terrible color in vitals").
 *
 * The order in vt-format is chosen so that ADJACENT slots stay apart under
 * simulated colour blindness, which is the only adjacency a stack can create.
 * See SERIES there for the validator run.
 */


/**
 * The standfirst is part of the chart, not decoration around it: the same
 * picture means four different things in the four modes, and a reader who is
 * told "stacked" while looking at a normalised chart is being misled.
 */
const MODE_COPY = {
  stack: 'Daily protocol fees, stacked. Each band is labelled with the platform and what it earned on the last day; the floor is everyone else we track.',
  share: 'Every day normalised to 100%. Height is share of that day’s fees, not dollars — so a band that widens is taking ground, even in a shrinking market.',
  stream: 'The same stack hung off a floating centre. Nothing here is measured off the vertical axis; it is the shape of the market — where it thickened, and who thickened it.',
  lines: 'Unstacked: one line per platform, all from zero, and the long tail left out — “everyone else” is seventeen hundred platforms added up, which is not a platform you can compare anything to.',
}

/**
 * Align every band onto one day axis.
 * The upstream series start on different days and skip quiet ones, so a naive
 * index-based stack would slide bands sideways relative to each other.
 */
function buildStack(tide, stacks, days, restColor) {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86_400
  const tideMap = new Map()
  for (const p of tide || []) if (Array.isArray(p) && p[0] >= cutoff) tideMap.set(p[0], p[1] || 0)
  if (!tideMap.size) return null

  const axis = [...tideMap.keys()].sort((a, b) => a - b)
  // Eight named slots, never a ninth generated hue: anything past the palette
  // folds into the floor with the rest of the long tail, where it was already
  // being counted anyway.
  const bands = (stacks || []).slice(0, SERIES_MAX).map((s, i) => {
    const m = new Map()
    for (const p of s.points || []) if (Array.isArray(p)) m.set(p[0], p[1] || 0)
    return { slug: s.slug, name: s.name, color: SERIES[i], values: axis.map((t) => m.get(t) || 0) }
  })

  // The floor is the total minus the named bands — never negative, because the
  // total and the per-protocol series are separate upstream aggregations and
  // can disagree by a hair on any given day.
  const rest = axis.map((t, i) => {
    const named = bands.reduce((a, b) => a + b.values[i], 0)
    return Math.max(0, (tideMap.get(t) || 0) - named)
  })

  // Rest first so it paints as the FLOOR the copy promises. Painting it last put
  // a grey slab on top of the named bands and buried the story.
  const series = [{ slug: '__rest', name: 'Everyone else', color: restColor, values: rest }, ...bands]
  const totals = axis.map((t, i) => series.reduce((a, s) => a + s.values[i], 0))
  return { axis, series, totals, max: Math.max(...totals, 1) }
}

export default function VtTide({ tide, stacks, totals, boardTotal, loading }) {
  // Both derived from `totals` alone, so a figure and its second fact can never
  // disagree about which universe they are counting.
  const vsAvg = totals?.fees24h && totals?.fees30d
    ? (totals.fees24h / (totals.fees30d / 30) - 1) * 100
    : null
  const keptShare = totals?.revenue30d && totals?.fees30d
    ? (totals.revenue30d / totals.fees30d) * 100
    : null
  const dayMode = useSettingsStore((s) => s.dayMode)
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const [range, setRange] = useState('1y')
  const [mode, setMode] = useState('stack')
  const [hover, setHover] = useState(null)
  // Left edge of the hover panel, in canvas pixels. null = let the stylesheet
  // place it (narrow canvases, where there is no room to flip).
  const [readoutX, setReadoutX] = useState(null)
  const [muted, setMuted] = useState(() => new Set())
  const rafRef = useRef(0)

  const days = RANGES.find((r) => r.id === range)?.days || 365
  // The floor is the remainder, not an identity, so it stays neutral while the
  // named bands carry the palette — and a neutral has to change with the theme.
  const restColor = restTone(dayMode)
  const stack = useMemo(() => buildStack(tide, stacks, days, restColor), [tide, stacks, days, restColor])

  const visible = useMemo(() => {
    if (!stack) return null
    // In LINES the floor is dropped, not just un-stacked. "Everyone else" is
    // seventeen hundred platforms added together, so as a line it is bigger than
    // every real platform on the chart and squashes all eight of them into the
    // bottom tenth of the plot — the exact comparison this mode exists to make.
    // It is also not an entity: there is nothing to compare it TO.
    const series = stack.series.filter((s) => !muted.has(s.slug) && !(mode === 'lines' && s.slug === '__rest'))
    if (!series.length) return null
    const totalsV = stack.axis.map((_, i) => series.reduce((a, s) => a + s.values[i], 0))
    return { ...stack, series, totals: totalsV, max: Math.max(...totalsV, 1) }
  }, [stack, muted, mode])

  /**
   * The mode's geometry, in DATA units — where each band's lower and upper edge
   * sits on any given day, plus the domain those edges live in.
   *
   * Kept out of draw() so the four modes differ in one place instead of four,
   * and so a repaint on hover does not re-walk 6,500 points to find the same
   * answer it found last frame.
   */
  const geom = useMemo(() => {
    if (!visible) return null
    const n = visible.axis.length
    const S = visible.series.length
    if (!n || !S) return null

    if (mode === 'lines') {
      // Unstacked: every line starts at zero, so the domain is the single
      // biggest DAY of the single biggest band, not the sum of all of them.
      let hi = 0
      for (const s of visible.series) for (const v of s.values) if (v > hi) hi = v
      return { kind: 'lines', lo: 0, hi: hi || 1 }
    }

    const lower = visible.series.map(() => new Float64Array(n))
    const upper = visible.series.map(() => new Float64Array(n))
    let lo = 0
    let hi = 0
    for (let i = 0; i < n; i++) {
      const total = visible.totals[i] || 0
      // Share divides the day by its own total; stream hangs the same stack off
      // a centred baseline so the silhouette reads as a shape rather than a
      // pile. Stacked is the plain case: floor at zero.
      const denom = mode === 'share' ? (total || 1) : 1
      let base = mode === 'stream' ? -(total / 2) : 0
      if (base < lo) lo = base
      for (let k = 0; k < S; k++) {
        lower[k][i] = base
        base += visible.series[k].values[i] / denom
        upper[k][i] = base
      }
      if (base > hi) hi = base
    }
    return { kind: 'area', lower, upper, lo, hi: hi || 1 }
  }, [visible, mode])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !visible || !geom) return

    const rect = wrap.getBoundingClientRect()
    const w = Math.max(240, Math.round(rect.width))
    const h = Math.max(180, Math.round(rect.height))
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    // Only re-allocate the backing store when it actually changes — assigning
    // canvas.width every frame reallocates it and flickers.
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }

    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // The right gutter carries the band labels. A narrow canvas can't hold them,
    // so it falls back to the legend row and spends the pixels on the plot.
    const labelled = w >= LABEL_MIN_W
    const padR = labelled ? LABEL_GUTTER : PAD.right
    const plotW = w - PAD.left - padR
    const plotH = h - PAD.top - PAD.bottom
    const n = visible.axis.length
    if (n < 2 || plotW <= 0 || plotH <= 0) return

    const x = (i) => PAD.left + (i / (n - 1)) * plotW
    // ONE domain for four modes: stacked runs 0..total, share runs 0..1, stream
    // straddles zero, lines run 0..biggest single band.
    const span = (geom.hi - geom.lo) || 1
    const y = (v) => PAD.top + plotH - ((v - geom.lo) / span) * plotH
    const plotR = PAD.left + plotW

    const grid = dayMode ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.06)'
    const axisText = dayMode ? 'rgba(15,23,42,0.45)' : 'rgba(245,245,247,0.42)'
    const FONT = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif'

    // A PRO theme puts a PHOTOGRAPH behind this card. With a transparent plot the
    // wallpaper reads straight through the bands and the chart stops being
    // legible - so the plot lays its own ground: sheer enough to keep the glass,
    // solid enough that the data always sits on a surface we chose.
    ctx.fillStyle = dayMode ? 'rgba(255,255,255,0.72)' : 'rgba(10,10,12,0.62)'
    ctx.fillRect(PAD.left, PAD.top, plotW, plotH)

    // horizontal grid + value axis
    ctx.font = `11px ${FONT}`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'right' // value labels sit in the left gutter, outside the plot
    // The axis belongs to the mode. Dollars while the stack is absolute, percent
    // once the day is normalised — and NOTHING in stream, where the baseline
    // floats and a height therefore has no reading. A streamgraph that printed
    // dollars up its side would be inviting the reader to measure something that
    // does not exist; it states its scale in words instead.
    const streaming = mode === 'stream'
    for (let g = 0; g <= 4; g++) {
      const v = geom.lo + (span / 4) * g
      const yy = Math.round(y(v)) + 0.5
      ctx.strokeStyle = grid
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD.left, yy)
      ctx.lineTo(plotR, yy)
      ctx.stroke()
      if (g > 0 && !streaming) {
        ctx.fillStyle = axisText
        ctx.fillText(mode === 'share' ? `${Math.round((v / span) * 100)}%` : usd(v, { decimals: 0 }), PAD.left - 11, yy)
      }
    }

    // The bands. Fills are near-OPAQUE on purpose: a stack is a set of distinct
    // quantities, not overlapping transparencies, and eight translucent slabs on
    // top of each other turn the whole chart to mud.
    //
    // The separator between two bands is drawn in the SURFACE colour rather than
    // as a translucent white line. A white hairline is a fourth colour laid over
    // whichever two it lands between, and it disappeared on the bright end of the
    // old ramp — exactly where bands are thinnest. A surface-coloured hairline
    // reads as a GAP, which is what it is, and works on every pair in the
    // palette without knowing anything about them.
    const seam = dayMode ? 'rgba(255,255,255,0.9)' : 'rgba(10,10,12,0.85)'
    const tags = []

    if (geom.kind === 'lines') {
      // Unstacked. No fills: nine areas sharing one baseline is mud, and the
      // whole reason to be in this mode is reading two curves against each other.
      for (const s of visible.series) {
        ctx.strokeStyle = s.color
        ctx.lineWidth = 1.75
        ctx.lineJoin = 'round'
        ctx.beginPath()
        for (let i = 0; i < n; i++) {
          const px = x(i)
          const py = y(s.values[i])
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
        }
        ctx.stroke()
        const at = y(s.values[n - 1])
        // No thickness test here — a line has none, and every line earns its label.
        tags.push({ name: s.name, color: s.color, value: s.values[n - 1], anchor: at, at, thick: Infinity })
      }
    } else {
      for (let k = 0; k < visible.series.length; k++) {
        const s = visible.series[k]
        const lowerK = geom.lower[k]
        const upperK = geom.upper[k]

        ctx.beginPath()
        for (let i = 0; i < n; i++) {
          const px = x(i)
          const py = y(upperK[i])
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
        }
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(x(i), y(lowerK[i]))
        ctx.closePath()

        const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + plotH)
        grad.addColorStop(0, hexToRgba(s.color, 0.96))
        grad.addColorStop(1, hexToRgba(s.color, dayMode ? 0.86 : 0.78))
        ctx.fillStyle = grad
        ctx.fill()

        ctx.strokeStyle = seam
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let i = 0; i < n; i++) {
          const px = x(i)
          const py = y(upperK[i])
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
        }
        ctx.stroke()

        // The band's thickness at the LAST day, for the label rail.
        const yb = y(lowerK[n - 1])
        const yt = y(upperK[n - 1])
        tags.push({
          name: s.name,
          color: s.color,
          value: s.values[n - 1],
          anchor: (yb + yt) / 2,
          at: (yb + yt) / 2,
          thick: yb - yt,
        })
      }
    }

    // Stream has no value axis, so it says its scale here instead of pretending
    // the gutter means something.
    if (streaming) {
      ctx.textAlign = 'left'
      ctx.fillStyle = axisText
      ctx.fillText(`Peak ${usd(Math.max(...visible.totals))} a day`, PAD.left + 12, PAD.top + 13)
      ctx.textAlign = 'right'
    }

    // END-OF-BAND LABELS. The chart used to name its bands in exactly two places:
    // a hover readout and a pill row at the very bottom, disconnected from the
    // shapes - so you could not tell what was being compared without hovering.
    // Each band that owns enough pixels to point at now says its own name and its
    // latest figure, right where the band ends.
    if (labelled) {
      const slots = tags.filter((t) => t.thick >= 7).sort((a, b) => a.at - b.at)
      const STEP = 26
      for (let i = 1; i < slots.length; i++) {
        if (slots[i].at - slots[i - 1].at < STEP) slots[i].at = slots[i - 1].at + STEP
      }
      // ...then settle back upward so a crowded stack can't run off the bottom.
      const floor = PAD.top + plotH - 8
      for (let i = slots.length - 1; i >= 0; i--) {
        const cap = i === slots.length - 1 ? floor : slots[i + 1].at - STEP
        if (slots[i].at > cap) slots[i].at = cap
      }

      const lx = plotR + 14
      const maxTextW = w - lx - 6
      for (const tg of slots) {
        ctx.strokeStyle = hexToRgba(tg.color, 0.55)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(plotR + 1, tg.anchor)
        ctx.lineTo(lx - 6, tg.at)
        ctx.stroke()

        ctx.fillStyle = tg.color
        ctx.fillRect(lx - 4, tg.at - 5, 3, 10)

        ctx.textAlign = 'left'
        ctx.font = `600 11px ${FONT}`
        ctx.fillStyle = dayMode ? '#0f172a' : '#f5f5f7'
        let label = tg.name
        while (label.length > 4 && ctx.measureText(label).width > maxTextW) {
          label = `${label.slice(0, -2)}\u2026`
        }
        ctx.fillText(label, lx + 4, tg.at - 5)

        ctx.font = `11px ${FONT}`
        ctx.fillStyle = axisText
        ctx.fillText(usd(tg.value, { decimals: 0 }), lx + 4, tg.at + 7)
      }
    }

    // time axis
    ctx.textAlign = 'center'
    ctx.fillStyle = axisText
    // Fewer ticks on a narrow canvas, or six month labels collide into a smear.
    const ticks = Math.max(2, Math.min(w < 460 ? 4 : 6, n))
    for (let t = 0; t < ticks; t++) {
      const i = Math.round((t / (ticks - 1)) * (n - 1))
      const d = new Date(visible.axis[i] * 1000)
      const label = d.toLocaleDateString('en-US', { month: 'short', year: days > 200 ? '2-digit' : undefined, timeZone: 'UTC' })
      // Centre-aligned labels overhang the plot at both ends — the first one was
      // being clipped by the canvas edge ("Aug 25" rendering as "ug 25").
      const half = ctx.measureText(label).width / 2 + 2
      const cx = Math.min(Math.max(x(i), half), plotR - half)
      ctx.fillText(label, cx, h - PAD.bottom + 14)
    }

    // crosshair
    if (hover != null && hover >= 0 && hover < n) {
      const px = Math.round(x(hover)) + 0.5
      ctx.strokeStyle = dayMode ? 'rgba(15,23,42,0.3)' : 'rgba(245,245,247,0.35)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(px, PAD.top)
      ctx.lineTo(px, PAD.top + plotH)
      ctx.stroke()

      // A dot on the crest: without it the reader has to guess which day the
      // floating readout is describing. It rides the TOP OF THE STACK AS DRAWN —
      // reading it off the absolute total would park it off-plot in share mode
      // and above the silhouette in stream.
      if (geom.kind === 'area') {
        const top = geom.upper[geom.upper.length - 1]
        ctx.fillStyle = dayMode ? '#0f172a' : '#f5f5f7'
        ctx.beginPath()
        ctx.arc(px, y(top[hover]), 3, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Drawn LAST so the mark sits over the data, never under it.
    // Anchored to the PLOT, not the canvas: canvas-anchored, the corner mark
    // parks on the date axis and eats the last label.
    drawSpectreWatermark(ctx, { w, h, dark: !dayMode, plot: { x: PAD.left, y: PAD.top, w: plotW, h: plotH } })
  }, [visible, geom, mode, dayMode, hover, days])

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
    if (!wrap || !visible) return
    const rect = wrap.getBoundingClientRect()
    // Must mirror draw()'s gutter, or the crosshair drifts off the cursor by the
    // whole width of the label rail.
    const labelled = rect.width >= LABEL_MIN_W
    const padR = labelled ? LABEL_GUTTER : PAD.right
    const plotW = rect.width - PAD.left - padR
    const rel = (e.clientX - rect.left - PAD.left) / Math.max(1, plotW)
    const i = Math.round(rel * (visible.axis.length - 1))
    if (i < 0 || i >= visible.axis.length) { setHover(null); return }
    setHover(i)

    // The panel was parked in the top-right corner of the scene — which is the
    // 138px gutter the chart reserves for its end-of-band labels, so it printed
    // straight over "Uniswap $8m / Pump $6m / ..." every time it opened, and it
    // sat a screen away from the crosshair it was describing.
    //
    // It follows the crosshair now and flips to whichever side has room. The
    // right bound is the PLOT edge, not the canvas edge, so it never enters the
    // label rail. Below LABEL_MIN_W there is no rail and no room to flip, and
    // the stylesheet's full-width strip stands instead.
    if (!labelled) { setReadoutX(null); return }
    const cx = PAD.left + (i / Math.max(1, visible.axis.length - 1)) * plotW
    const rightBound = rect.width - padR
    let left = cx + READOUT_GAP
    if (left + READOUT_W > rightBound) left = cx - READOUT_GAP - READOUT_W
    setReadoutX(Math.max(PAD.left, Math.min(left, rightBound - READOUT_W)))
  }

  const onLeave = () => { setHover(null); setReadoutX(null) }

  /** Touch is the same gesture with a different event shape — onMove only
   *  ever reads clientX, so one synthetic point bridges it. */
  const onTouchPoint = (e) => { const t = e.touches[0]; if (t) onMove({ clientX: t.clientX }) }

  const toggle = (slug) => setMuted((prev) => {
    const next = new Set(prev)
    if (next.has(slug)) next.delete(slug); else next.add(slug)
    return next
  })

  const point = useMemo(() => {
    if (hover == null || !visible || hover >= visible.axis.length) return null
    const all = visible.series
      .map((s) => ({ name: s.name, color: s.color, value: s.values[hover] }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
    const tail = all.slice(READOUT_ROWS)
    return {
      date: new Date(visible.axis[hover] * 1000).toISOString().slice(0, 10),
      total: visible.totals[hover],
      rows: all.slice(0, READOUT_ROWS),
      // The list was capped at six and the rest simply vanished, so on a day
      // where nine bands earned money the panel's own rows did not add up to
      // the total printed directly above them. The tail is folded, not dropped.
      restCount: tail.length,
      restValue: tail.reduce((a, r) => a + r.value, 0),
    }
  }, [hover, visible])

  return (
    <section className="vt-tide">
      {/* The copy used to float ON the chart under a heavy black scrim, and the
          stat bar was pinned over the bottom of the canvas — where it landed
          exactly on the date axis. Header, chart, numbers and legend are now
          four stacked bands: the chart still runs edge to edge, but nothing
          overlaps anything. */}
      <header className="vt-tide__head">
        <div className="vt-tide__headtext">
          <span className="vt-eyebrow">The tide</span>
          <h2>Where crypto&rsquo;s fees actually land</h2>
          <p className="vt-tide__sub">{MODE_COPY[mode]}</p>
        </div>
        <div className="vt-tide__tools">
          {/* Same segmented control the platform charts use, so "change how this
              chart is drawn" is one affordance everywhere on the page. */}
          <VtSeg size="sm" label="Chart mode" value={mode} onChange={setMode} items={MODES} />
          <div className="vt-tide__ranges" role="group" aria-label="Chart range">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`vt-pill${range === r.id ? ' is-active' : ''}`}
                onClick={() => setRange(r.id)}
                aria-pressed={range === r.id}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="vt-tide__scene">
        <div className="vt-tide__glow" aria-hidden="true" />
        <div className="vt-tide__canvas" ref={wrapRef}
          onMouseMove={onMove} onMouseLeave={onLeave}
          onTouchStart={onTouchPoint} onTouchMove={onTouchPoint} onTouchEnd={onLeave}>
          <canvas ref={canvasRef} aria-label="Stacked daily protocol fees" />
        </div>

        {loading && !visible ? <div className="vt-tide__skeleton" aria-hidden="true" /> : null}
        {!loading && !visible ? <p className="vt-empty vt-tide__empty">Fee history unavailable right now.</p> : null}

        {point ? (
          <div className="vt-tide__readout" aria-live="off"
            style={readoutX != null ? { left: `${readoutX}px`, right: 'auto' } : undefined}>
            <span className="vt-tide__readout-date">{shortDate(point.date)}</span>
            <span className="vt-tide__readout-total">{usd(point.total)}</span>
            <ul>
              {point.rows.map((r) => (
                <li key={r.name}>
                  <i style={{ background: r.color }} aria-hidden="true" />
                  <span className="vt-tide__readout-name">{r.name}</span>
                  <span className="vt-tide__readout-val">{usd(r.value)}</span>
                </li>
              ))}
              {point.restCount ? (
                <li className="is-rest">
                  <i aria-hidden="true" />
                  <span className="vt-tide__readout-name">{point.restCount} more</span>
                  <span className="vt-tide__readout-val">{usd(point.restValue)}</span>
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>

      {/* Four figures with nothing under them said how big, never whether that
          was a lot. Each now carries ONE exact second fact, and every one of
          them is arithmetic on the numbers in this same object — the daily
          series behind the chart above sums 6-10% away from these totals (a
          different denominator), so a day-over-day taken from IT and printed
          under a figure from HERE would be quietly wrong. */}
      <dl className="vt-tide__hud">
        <div className="vt-stat">
          <dt className="vt-stat__label">Fees · 24h</dt>
          <dd className="vt-stat__value">{usd(totals?.fees24h)}</dd>
          {/* Today against this window's own daily average — the honest way to
              say "busy day" without reaching for a series that does not agree. */}
          {vsAvg != null ? (
            <span className={`vt-stat__note vt-tone--${vsAvg >= 0 ? 'up' : 'down'}`}>
              {pct(vsAvg)} vs the 30-day average
            </span>
          ) : null}
        </div>
        <div className="vt-stat">
          <dt className="vt-stat__label">Fees · 30d</dt>
          <dd className="vt-stat__value">{usd(totals?.fees30d)}</dd>
          {totals?.fees30d ? (
            <span className="vt-stat__note">{usd(totals.fees30d / 30)} a day</span>
          ) : null}
        </div>
        <div className="vt-stat">
          <dt className="vt-stat__label">Kept by protocols</dt>
          <dd className="vt-stat__value">{usd(totals?.revenue30d)}</dd>
          {keptShare != null ? (
            <span className="vt-stat__note">{keptShare.toFixed(0)}% of the fees charged</span>
          ) : null}
        </div>
        <div className="vt-stat">
          <dt className="vt-stat__label">Platforms</dt>
          <dd className="vt-stat__value">{totals?.tracked ? totals.tracked.toLocaleString('en-US') : '—'}</dd>
          {/* 2,009 tracked is not 2,009 earning: the fee board's own total is
              how many cleared the window with a fee to report. */}
          {boardTotal ? (
            <span className="vt-stat__note">{boardTotal.toLocaleString('en-US')} earned a fee</span>
          ) : null}
        </div>
      </dl>

      {stack ? (
        <ul className="vt-tide__legend">
          {stack.series.map((s) => {
            const off = mode === 'lines' && s.slug === '__rest'
            return (
            <li key={s.slug}>
              <button
                type="button"
                className={`vt-legend-btn${muted.has(s.slug) || off ? ' is-muted' : ''}`}
                onClick={() => toggle(s.slug)}
                disabled={off}
                title={off ? 'The long tail is not drawn in Lines' : undefined}
                aria-pressed={!off && !muted.has(s.slug)}
              >
                <i style={{ background: s.color }} aria-hidden="true" />
                {s.name}
              </button>
            </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
