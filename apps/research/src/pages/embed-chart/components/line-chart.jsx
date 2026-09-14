/**
 * LineChart — native 2D canvas line chart for the embed.
 * Props:
 *   data:  Array<{ t: number, v: number }>  - full series
 *   range: { start: number, end: number }   - normalized [0,1] viewport
 *
 * Features: adaptive min/max downsampling when data is dense, smooth
 * monotone cubic interpolation, dashed horizontal grid with nice Y-ticks,
 * X-axis time labels, subtle line glow, and cursor crosshair.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/contexts/I18nCurrencyContext'

const PAD_RIGHT = 56  // space for Y-axis labels
const PAD_BOTTOM = 22 // space for X-axis labels
const PAD_TOP = 8
const PAD_LEFT = 6

function formatTime(ms, locale) {
  const d = new Date(ms)
  return d.toLocaleString(locale || undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatAxisTime(ms, spanMs, locale) {
  const d = new Date(ms)
  if (spanMs <= 24 * 3600 * 1000) {
    // ≤1d → HH:MM
    return d.toLocaleTimeString(locale || undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  if (spanMs <= 7 * 24 * 3600 * 1000) {
    // ≤7d → Mon 14
    return d.toLocaleDateString(locale || undefined, { weekday: 'short', day: 'numeric' })
  }
  if (spanMs <= 120 * 24 * 3600 * 1000) {
    // ≤4mo → Mar 14
    return d.toLocaleDateString(locale || undefined, { month: 'short', day: 'numeric' })
  }
  // >4mo → Mar '26
  return d.toLocaleDateString(locale || undefined, { month: 'short', year: '2-digit' })
}

/** Compute "nice" round tick values between min and max. */
function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min]
  const range = max - min
  const roughStep = range / (count - 1)
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const norm = roughStep / mag
  let step
  if (norm < 1.5)      step = 1 * mag
  else if (norm < 3)   step = 2 * mag
  else if (norm < 7)   step = 5 * mag
  else                 step = 10 * mag
  const first = Math.ceil(min / step) * step
  const ticks = []
  for (let v = first; v <= max + step * 0.5; v += step) ticks.push(v)
  return ticks
}

/**
 * When data is denser than ~2 points per pixel, bucket adjacent samples and
 * keep min+max per bucket. Preserves spikes while reducing crosshatching
 * zigzag noise that plagues tight-liquidity CG data.
 */
function bucketMinMax(points, targetCount) {
  if (points.length <= targetCount) return points
  const out = []
  const bucketSize = points.length / targetCount
  for (let b = 0; b < targetCount; b++) {
    const i0 = Math.floor(b * bucketSize)
    const i1 = Math.min(points.length, Math.floor((b + 1) * bucketSize))
    if (i0 >= i1) continue
    let lo = points[i0], hi = points[i0]
    for (let i = i0 + 1; i < i1; i++) {
      if (points[i].v < lo.v) lo = points[i]
      if (points[i].v > hi.v) hi = points[i]
    }
    // Preserve temporal order within the bucket
    if (lo.t <= hi.t) { out.push(lo); if (hi !== lo) out.push(hi) }
    else              { out.push(hi); if (hi !== lo) out.push(lo) }
  }
  return out
}

/** Draw a smooth monotone cubic path through points. */
function drawSmoothPath(ctx, pts) {
  if (pts.length < 2) return
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y)
  }
}

export default function LineChart({ data, range = { start: 0, end: 1 } }) {
  const { i18n } = useTranslation()
  const { fmtPrice } = useCurrency()
  const locale = i18n.language || undefined
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const [hover, setHover] = useState(null) // { x, y, point }
  const [lastPt, setLastPt] = useState(null) // { x, y, v, up } — for the sticky last-price pill
  const scalesRef = useRef(null) // stores { plot, min, max, sliced } for hover math

  // Slice data to viewport — memoized so draw effect doesn't churn on every parent render
  const sliced = useMemo(() => {
    if (!data?.length) return []
    const i0 = Math.max(0, Math.floor(range.start * (data.length - 1)))
    const i1 = Math.min(data.length - 1, Math.ceil(range.end * (data.length - 1)))
    return data.slice(i0, i1 + 1)
  }, [data, range.start, range.end])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = wrap.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, w, h)

      if (sliced.length < 2) return

      // Plot area (inside axis padding)
      const plot = {
        x: PAD_LEFT,
        y: PAD_TOP,
        w: Math.max(0, w - PAD_LEFT - PAD_RIGHT),
        h: Math.max(0, h - PAD_TOP - PAD_BOTTOM),
      }

      // Y-axis domain
      let min = Infinity, max = -Infinity
      for (const p of sliced) { if (p.v < min) min = p.v; if (p.v > max) max = p.v }
      if (min === max) { min -= 1; max += 1 }
      const pad = (max - min) * 0.08
      const vMin = min - pad
      const vMax = max + pad
      const yAt = (v) => plot.y + plot.h - ((v - vMin) / (vMax - vMin)) * plot.h

      // Downsample by x-pixel resolution (min+max bucketing)
      const targetPoints = Math.max(64, Math.floor(plot.w * 1.6))
      const drawSeries = bucketMinMax(sliced, targetPoints)
      const xAt = (i) => plot.x + (i / Math.max(1, drawSeries.length - 1)) * plot.w
      const pts = drawSeries.map((p, i) => ({ x: xAt(i), y: yAt(p.v), t: p.t, v: p.v }))

      // Save for hover lookups
      scalesRef.current = {
        plot,
        vMin, vMax,
        drawSeries,
        originalSliced: sliced,
      }

      const isUp = sliced[sliced.length - 1].v >= sliced[0].v
      const accent = isUp
        ? getComputedStyle(document.documentElement).getPropertyValue('--bull').trim() || '#10B981'
        : getComputedStyle(document.documentElement).getPropertyValue('--bear').trim() || '#EF4444'

      // ── Grid lines + Y-axis labels ── (dotted for a cleaner cinematic feel)
      const ticks = niceTicks(vMin, vMax, 5)
      const useCompact = vMax >= 10_000
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx.lineWidth = 1
      ctx.setLineDash([1, 3])
      ctx.beginPath()
      for (const t of ticks) {
        const y = yAt(t)
        if (y < plot.y - 0.5 || y > plot.y + plot.h + 0.5) continue
        ctx.moveTo(plot.x, y)
        ctx.lineTo(plot.x + plot.w, y)
      }
      ctx.stroke()
      ctx.setLineDash([])

      ctx.font = '10.5px "JetBrains Mono", "SF Mono", Monaco, monospace'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.fillStyle = 'rgba(245,245,247,0.32)'
      for (const t of ticks) {
        const y = yAt(t)
        if (y < plot.y || y > plot.y + plot.h) continue
        ctx.fillText(fmtPrice(t), plot.x + plot.w + 8, y)
      }
      ctx.restore()

      // ── X-axis time labels ──
      const xTickCount = Math.max(3, Math.min(6, Math.floor(plot.w / 110)))
      const t0 = sliced[0].t
      const t1 = sliced[sliced.length - 1].t
      const spanMs = t1 - t0
      ctx.save()
      ctx.font = '10.5px "JetBrains Mono", "SF Mono", Monaco, monospace'
      ctx.textBaseline = 'top'
      ctx.fillStyle = 'rgba(245,245,247,0.32)'
      for (let k = 0; k < xTickCount; k++) {
        const frac = xTickCount === 1 ? 0.5 : k / (xTickCount - 1)
        const tx = plot.x + frac * plot.w
        const ts = t0 + frac * spanMs
        const label = formatAxisTime(ts, spanMs, locale)
        ctx.textAlign = k === 0 ? 'left' : k === xTickCount - 1 ? 'right' : 'center'
        ctx.fillText(label, tx, plot.y + plot.h + 8)
      }
      ctx.restore()

      // ── Gradient fill under line ──
      ctx.save()
      const grad = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.h)
      grad.addColorStop(0, `${accent}2e`)
      grad.addColorStop(0.75, `${accent}05`)
      grad.addColorStop(1, `${accent}00`)
      ctx.beginPath()
      drawSmoothPath(ctx, pts)
      ctx.lineTo(pts[pts.length - 1].x, plot.y + plot.h)
      ctx.lineTo(pts[0].x, plot.y + plot.h)
      ctx.closePath()
      ctx.fillStyle = grad
      ctx.fill()
      ctx.restore()

      // ── Line — glow underlay + crisp top pass ──
      ctx.save()
      ctx.beginPath()
      drawSmoothPath(ctx, pts)
      ctx.lineWidth = 1.6
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = accent
      ctx.shadowColor = accent
      ctx.shadowBlur = 14
      ctx.globalAlpha = 0.85
      ctx.stroke()
      ctx.restore()

      ctx.save()
      ctx.beginPath()
      drawSmoothPath(ctx, pts)
      ctx.lineWidth = 1.4
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = accent
      ctx.stroke()
      ctx.restore()

      // ── Sticky last-price pill (DOM overlay) — publish coords ──
      const endP = pts[pts.length - 1]
      if (endP) {
        setLastPt(prev => {
          const next = { x: endP.x, y: endP.y, v: sliced[sliced.length - 1].v, up: isUp, right: plot.x + plot.w }
          if (prev && prev.x === next.x && prev.y === next.y && prev.v === next.v && prev.up === next.up) return prev
          return next
        })
      }

      // ── Crosshair + hover dot ──
      if (hover?.point) {
        ctx.save()
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 4])
        ctx.beginPath(); ctx.moveTo(hover.x, plot.y); ctx.lineTo(hover.x, plot.y + plot.h); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(plot.x, hover.y); ctx.lineTo(plot.x + plot.w, hover.y); ctx.stroke()
        ctx.setLineDash([])
        // Dot: outer ring (subtle) + solid inner
        ctx.fillStyle = `${accent}30`
        ctx.beginPath(); ctx.arc(hover.x, hover.y, 6, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = accent
        ctx.beginPath(); ctx.arc(hover.x, hover.y, 3, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#f5f5f7'
        ctx.beginPath(); ctx.arc(hover.x, hover.y, 1.2, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [sliced, hover, fmtPrice, locale])

  const onMove = (e) => {
    const wrap = wrapRef.current
    const scales = scalesRef.current
    if (!wrap || !scales || sliced.length < 2) return
    const rect = wrap.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    if (mx < scales.plot.x || mx > scales.plot.x + scales.plot.w) { setHover(null); return }

    // Find nearest ORIGINAL sliced point (not bucketed) by x fraction
    const frac = (mx - scales.plot.x) / scales.plot.w
    const i = Math.max(0, Math.min(sliced.length - 1, Math.round(frac * (sliced.length - 1))))
    const p = sliced[i]
    const x = scales.plot.x + (i / (sliced.length - 1)) * scales.plot.w
    const y = scales.plot.y + scales.plot.h - ((p.v - scales.vMin) / (scales.vMax - scales.vMin)) * scales.plot.h
    setHover({ x, y, point: p, mouseY: my, wrapW: rect.width, wrapH: rect.height })
  }

  const onLeave = () => setHover(null)

  const tooltipStyle = hover?.point ? (() => {
    const flipX = hover.x > hover.wrapW - 160
    const flipY = hover.y < 56
    return {
      left: hover.x,
      top: hover.y,
      transform: `translate(${flipX ? 'calc(-100% - 14px)' : '14px'}, ${flipY ? '14px' : 'calc(-100% - 14px)'})`,
    }
  })() : null

  const lastTrendClass = lastPt?.up ? 'embed-last-price--bull' : 'embed-last-price--bear'

  return (
    <div ref={wrapRef} className="embed-line-wrap" onMouseMove={onMove} onMouseLeave={onLeave}>
      <canvas ref={canvasRef} className="embed-line-canvas" />
      {lastPt ? (
        <>
          <span
            className={`embed-last-dot ${lastTrendClass}`}
            style={{ left: `${lastPt.x}px`, top: `${lastPt.y}px` }}
            aria-hidden
          />
          <span
            className={`embed-last-tag mono ${lastTrendClass}`}
            style={{ top: `${lastPt.y}px` }}
          >{fmtPrice(lastPt.v)}</span>
        </>
      ) : null}
      {hover?.point ? (
        <div className="embed-tooltip" style={tooltipStyle}>
          <div className="embed-tooltip-price mono">{fmtPrice(hover.point.v)}</div>
          <div className="embed-tooltip-time mono">{formatTime(hover.point.t, locale)}</div>
        </div>
      ) : null}
    </div>
  )
}
