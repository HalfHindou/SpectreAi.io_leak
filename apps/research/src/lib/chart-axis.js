/**
 * chart-axis — the shared right-hand value axis + date axis for our own canvas
 * line charts (the OTHERS2 lines in the Command Center and on /alt-rotation).
 *
 * Why a module: both charts had their own copy of the axis code and both had
 * the same two flaws — the value labels were flushed to the canvas edge (a wide
 * gap between the plot and its own scale, which read as a stray column of
 * numbers) and the gutter was a fixed 58px regardless of how wide the formatted
 * label actually was. Here the gutter is MEASURED from the labels, the scale
 * sits right next to the plot behind a hairline rule, and the live value gets a
 * tinted tag so the axis has an anchor.
 */

// nice round tick values between lo and hi
export function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) return [lo]
  const step0 = (hi - lo) / (n - 1)
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const norm = step0 / mag
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : norm >= 1 ? 1 : 0.5) * mag
  const ticks = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 0.001; v += step) ticks.push(v)
  return ticks
}

// evenly-spaced date ticks; label granularity adapts to the window length
export function dateTicks(tMin, tMax, n = 6) {
  const spanDays = (tMax - tMin) / 864e5
  const opts = spanDays > 500 ? { year: 'numeric' }
    : spanDays > 120 ? { month: 'short', year: '2-digit' }
      : spanDays > 3 ? { month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric', hour: 'numeric' }
  const out = []
  for (let i = 0; i < n; i++) {
    const ts = tMin + (tMax - tMin) * (i / (n - 1))
    out.push({ ts, label: new Date(ts).toLocaleDateString('en-US', opts) })
  }
  return out
}

export const AXIS_FONT = '600 11px -apple-system, BlinkMacSystemFont, Inter, "Segoe UI", sans-serif'

/** Width to reserve on the right for the value scale, measured from the labels. */
export function axisGutter(ctx, labels, { min = 52, max = 104, pad = 20 } = {}) {
  ctx.font = AXIS_FONT
  let widest = 0
  for (const l of labels) widest = Math.max(widest, ctx.measureText(l).width)
  return Math.round(Math.max(min, Math.min(max, widest + pad)))
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/**
 * Horizontal gridlines + the right-hand value scale, sitting just outside the
 * plot behind a hairline rule.
 *   plot: { x, y, w, h } in CSS px · ticks: values · Y(v) → px · fmt(v) → label
 */
export function drawValueAxis(ctx, { plot, ticks, Y, fmt, ink = '245,245,247', hideNearY = null }) {
  const axisX = plot.x + plot.w
  ctx.save()
  ctx.font = AXIS_FONT
  ctx.lineWidth = 1
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  for (const v of ticks) {
    const y = Math.round(Y(v)) + 0.5
    if (y < plot.y - 1 || y > plot.y + plot.h + 1) continue
    ctx.strokeStyle = `rgba(${ink},0.055)`
    ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(axisX, y); ctx.stroke()
    // the live-value tag owns its slot on the scale — a tick label printed
    // underneath it just reads as two overlapping numbers
    if (hideNearY != null && Math.abs(y - hideNearY) < 13) continue
    ctx.fillStyle = `rgba(${ink},0.42)`
    ctx.fillText(fmt(v), axisX + 9, y)
  }
  ctx.strokeStyle = `rgba(${ink},0.07)`
  ctx.beginPath(); ctx.moveTo(axisX + 0.5, plot.y); ctx.lineTo(axisX + 0.5, plot.y + plot.h); ctx.stroke()
  ctx.restore()
}

/** Date ticks along the bottom, with faint vertical guides. */
export function drawDateAxis(ctx, { plot, ticks, X, ink = '245,245,247', baseline }) {
  ctx.save()
  ctx.font = AXIS_FONT
  ctx.lineWidth = 1
  ctx.textBaseline = 'alphabetic'
  ctx.strokeStyle = `rgba(${ink},0.04)`
  const y = baseline != null ? baseline : plot.y + plot.h + 16
  ticks.forEach((d, i) => {
    const x = Math.round(X(d.ts)) + 0.5
    ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke()
    ctx.fillStyle = `rgba(${ink},0.42)`
    ctx.textAlign = i === 0 ? 'left' : i === ticks.length - 1 ? 'right' : 'center'
    ctx.fillText(d.label, x, y)
  })
  ctx.restore()
}

/**
 * The live value, tagged on the value axis in the series colour (plus a dot on
 * the last point). Gives the right-hand scale a reason to exist.
 */
export function drawLastValueTag(ctx, { plot, x, y, label, rgb, canvasW }) {
  const axisX = plot.x + plot.w
  ctx.save()
  ctx.font = '700 11px -apple-system, BlinkMacSystemFont, Inter, "Segoe UI", sans-serif'
  const tagH = 18
  const maxW = Math.max(0, (canvasW ?? axisX + 80) - axisX - 9)
  const tagW = Math.min(maxW, Math.round(ctx.measureText(label).width) + 12)
  if (tagW > 22) {
    const ty = Math.max(plot.y + tagH / 2, Math.min(plot.y + plot.h - tagH / 2, y))
    ctx.setLineDash([3, 4])
    ctx.strokeStyle = `rgba(${rgb},0.3)`
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(plot.x, Math.round(y) + 0.5); ctx.lineTo(axisX, Math.round(y) + 0.5); ctx.stroke()
    ctx.setLineDash([])
    roundRect(ctx, axisX + 5, ty - tagH / 2, tagW, tagH, 5)
    ctx.fillStyle = `rgba(${rgb},0.16)`; ctx.fill()
    ctx.strokeStyle = `rgba(${rgb},0.42)`; ctx.stroke()
    ctx.fillStyle = `rgb(${rgb})`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(label, axisX + 5 + tagW / 2, ty)
  }
  ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2)
  ctx.fillStyle = `rgb(${rgb})`; ctx.fill()
  ctx.strokeStyle = 'rgba(9,9,11,0.85)'; ctx.lineWidth = 1.5; ctx.stroke()
  ctx.restore()
}
