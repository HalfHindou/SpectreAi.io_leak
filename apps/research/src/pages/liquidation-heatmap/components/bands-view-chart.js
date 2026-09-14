/**
 * Liquidation Bands — pure canvas renderer.
 *
 * The third read on the same model the Heatmap view paints. Where the heatmap
 * answers "how much standing liquidation sits here" with one intensity ramp,
 * this answers "WHICH SIDE gets hit" — every band is coloured by whether it
 * sits below spot (leveraged longs get liquidated on a flush) or above it
 * (shorts get squeezed), with the price path drawn over the top.
 *
 * Same `{ rows, cols, grid, timeArray, priceArray }` model as
 * real-heatmap-chart.js, so it needs no new data lane:
 *   • grid is SPARSE — a list of { row, col, value }, not a dense matrix
 *   • row 0 is the LOWEST price (priceArray is ascending), so the y mapping
 *     flips; getting this backwards silently mirrors the whole chart
 *   • value is standing notional, not a delta
 */
import { drawSpectreWatermark } from '@/lib/chart-watermark'

const LONG_RGB = [239, 83, 80]   // below spot — longs liquidate on the way down
const SHORT_RGB = [38, 166, 154] // above spot — shorts liquidate on the way up

/* Same recipe as the heatmap's tone mapping: cut everything under the 85th
   percentile of nonzero density to nothing, then log-map the survivors. Without
   it the pane is a barcode of noise rather than the handful of levels that
   actually matter. */
const LIQUIDITY_THRESHOLD = 0.85

const TIME_AXIS_H = 26
const TOP_PAD = 14

function priceAxisWidthFor(w) { return w < 520 ? 58 : 72 }
// On a phone the axis gutter is ~58px, and the host's own formatter hands back
// "$67,546.92" — which clips. Narrow canvases get their own, shorter figure
// rather than a wider gutter eating the plot.
function compactPrice(p) {
  if (!Number.isFinite(p)) return '—'
  const a = Math.abs(p)
  if (a >= 100000) return `$${(p / 1000).toFixed(0)}K`
  if (a >= 1000) return `$${Math.round(p).toLocaleString('en-US')}`
  if (a >= 1) return `$${p.toFixed(2)}`
  return `$${p.toFixed(5)}`
}
function defaultFmtPrice(p) {
  if (!Number.isFinite(p)) return '—'
  if (p >= 1000) return `$${Math.round(p).toLocaleString('en-US')}`
  if (p >= 1) return `$${p.toFixed(2)}`
  return `$${p.toFixed(5)}`
}
function fmtUsd(n) {
  if (!Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${Math.round(n)}`
}
// Hour-only labels are ambiguous the moment the window crosses midnight, and
// this view routinely shows 2-3 days: "15:00 … 1:00 … 11:30" reads as going
// backwards. Past a day, lead with the date.
const fmtClockFor = (spanMs) => (ts) => {
  const d = new Date(ts)
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  return spanMs > 26 * 3600 * 1000 ? `${d.getDate()}/${d.getMonth() + 1} ${hm}` : hm
}

/**
 * @returns {{ hit: object|null, layout: object }|null}
 */
export function drawBandsChart(canvas, container, data, klines, opts = {}) {
  if (!canvas || !container || !data?.grid?.length) return null
  const W = container.clientWidth
  // 🪤 The canvas is a CHILD of the box we measure, so if that box ever loses
  // its own height (a stylesheet that failed to load, a host that drops the
  // rule) the two feed each other through the ResizeObserver and the pane grows
  // every frame. Clamping makes that failure a slightly-wrong chart instead of
  // a 3,700px column.
  const H = Math.min(container.clientHeight, 1400)
  if (W < 80 || H < 80) return null

  const dark = !opts.dayMode
  const side = opts.side || 'both'
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const backW = Math.round(W * dpr), backH = Math.round(H * dpr)
  if (canvas.width !== backW || canvas.height !== backH) {
    canvas.width = backW; canvas.height = backH
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)

  const ink = dark ? '245,245,247' : '15,23,42'
  const axisW = priceAxisWidthFor(W)
  const chartL = 0
  const chartR = W - axisW
  const chartT = TOP_PAD
  const chartB = H - TIME_AXIS_H
  const chartW = chartR - chartL
  const chartH = chartB - chartT
  if (chartW < 40 || chartH < 40) return null

  const axisFmt = W < 520 ? compactPrice : (opts.fmtPrice || defaultFmtPrice)

  // Plate. Deliberately a touch darker/lighter than the card so the bands have
  // something to sit on; the card itself is painted by CSS.
  ctx.fillStyle = dark ? '#0a0b12' : '#ffffff'
  ctx.fillRect(0, 0, W, H)

  const { cols, grid, timeArray, priceArray } = data
  const rows = priceArray.length
  if (!rows || !cols) return null

  // Spot: the last close we have, falling back to the middle of the band range.
  const lastK = Array.isArray(klines) && klines.length ? klines[klines.length - 1] : null
  const spot = Number.isFinite(opts.spot) ? opts.spot
    : lastK ? Number(lastK.close ?? lastK.c ?? lastK[4]) : (priceArray[0] + priceArray[rows - 1]) / 2

  // ── Tone mapping over the visible cells ──
  const mags = []
  for (const g of grid) {
    const v = Math.abs(g.value)
    if (v > 0) mags.push(v)
  }
  if (!mags.length) return null
  mags.sort((a, b) => a - b)
  const cut = mags[Math.floor(mags.length * LIQUIDITY_THRESHOLD)] || mags[0]
  const top = mags[Math.floor(mags.length * 0.995)] || mags[mags.length - 1]
  const lnCut = Math.log(cut)
  const invRange = 1 / Math.max(1e-6, Math.log(Math.max(top, cut * 1.001)) - lnCut)

  // ── Price window ──
  // The server's price grid spans far wider than anything is happening in — on
  // BTC it handed back ~$57k-$71k around a $65k spot, so the bands and the
  // price path were squeezed into the middle third and the rest of the pane was
  // empty. Frame on what actually survived the threshold, unioned with the
  // price path, and pad. This is what makes it read like a chart rather than a
  // strip in a box.
  // Percentiles, not min/max: a single faint band 10% away from everything else
  // stretched the axis and pushed the real cluster into a strip. p2/p98 over the
  // surviving cells drops the loners and keeps anything dense.
  const survivors = []
  for (const g of grid) {
    if (Math.abs(g.value) <= cut) continue
    const p = priceArray[g.row]
    if (Number.isFinite(p)) survivors.push(p)
  }
  survivors.sort((a, b) => a - b)
  let lo = Infinity, hi = -Infinity
  if (survivors.length) {
    lo = survivors[Math.floor(survivors.length * 0.02)]
    hi = survivors[Math.min(survivors.length - 1, Math.ceil(survivors.length * 0.98))]
  }
  if (Array.isArray(klines)) {
    for (const k of klines) {
      const c = Number(k.close ?? k.c ?? k[4])
      if (!Number.isFinite(c)) continue
      if (c < lo) lo = c
      if (c > hi) hi = c
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    lo = priceArray[0]; hi = priceArray[rows - 1]
  }
  // Keep spot in frame even if it sits outside the surviving cluster range.
  if (Number.isFinite(spot)) { lo = Math.min(lo, spot); hi = Math.max(hi, spot) }
  const pad = (hi - lo) * 0.06 || Math.abs(spot) * 0.01 || 1
  const pLo = lo - pad
  const pHi = hi + pad
  const pSpan = pHi - pLo || 1
  // row 0 = lowest price = BOTTOM of the pane.
  const Y = (p) => chartB - ((p - pLo) / pSpan) * chartH
  const colW = chartW / cols
  // A level painted at its true 1-row height is a hairline once the window is
  // cropped; 2.5px is the floor at which a band still reads as a band.
  const rowH = Math.max(2.5, (chartH / rows) * (priceArray[rows - 1] - priceArray[0]) / pSpan)

  // ── Bands ──
  // Painted per cell rather than per run: a level's liquidity is not constant
  // across time, and drawing one flat bar per row would throw that away.
  ctx.save()
  ctx.beginPath()
  ctx.rect(chartL, chartT, chartW, chartH)
  ctx.clip()

  let shownLong = 0, shownShort = 0
  for (const g of grid) {
    const v = Math.abs(g.value)
    if (v <= cut) continue
    const price = priceArray[g.row]
    if (!Number.isFinite(price)) continue
    const isLong = price < spot
    if (side === 'long' && !isLong) continue
    if (side === 'short' && isLong) continue

    // 0.18 floor so a surviving band is always visible, 1.0 for a true magnet.
    const t = 0.18 + 0.82 * Math.min(1, (Math.log(v) - lnCut) * invRange)
    const rgb = isLong ? LONG_RGB : SHORT_RGB
    const a = dark ? t : t * 0.8
    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`
    const x = chartL + g.col * colW
    const y = Y(price) - rowH / 2
    ctx.fillRect(x, y, Math.max(1, colW + 0.5), rowH)
    if (isLong) shownLong += v; else shownShort += v
  }

  // ── Price path ──
  // Warm-white, not the reference's green: a price line is chrome here, and a
  // green line next to teal short-liquidation bands reads as a market signal it
  // is not making. Colour on this pane means SIDE, nothing else.
  if (Array.isArray(klines) && klines.length > 1) {
    const t0 = timeArray[0]
    const t1 = timeArray[cols - 1] || (t0 + 1)
    const tSpan = t1 - t0 || 1
    const X = (ts) => chartL + ((ts - t0) / tSpan) * chartW
    ctx.beginPath()
    let started = false
    for (const k of klines) {
      const ts = Number(k.time ?? k.t ?? k[0])
      const c = Number(k.close ?? k.c ?? k[4])
      if (!Number.isFinite(ts) || !Number.isFinite(c)) continue
      const x = X(ts), y = Y(c)
      if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y)
    }
    if (started) {
      ctx.strokeStyle = dark ? 'rgba(245,245,247,0.92)' : 'rgba(15,23,42,0.9)'
      ctx.lineWidth = 1.6
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.stroke()
    }
  }
  ctx.restore()

  // ── Spot line + label ──
  const spotY = Y(spot)
  if (spotY > chartT && spotY < chartB) {
    ctx.save()
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = 'rgba(245,158,11,0.75)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(chartL, spotY); ctx.lineTo(chartR, spotY); ctx.stroke()
    ctx.restore()

    const lbl = axisFmt(spot)
    ctx.font = '700 10.5px -apple-system, BlinkMacSystemFont, Inter, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    const lw = Math.min(axisW - 6, ctx.measureText(lbl).width + 12)
    ctx.fillStyle = '#f59e0b'
    ctx.beginPath()
    ctx.roundRect(chartR + 3, spotY - 8, lw, 16, 4)
    ctx.fill()
    ctx.fillStyle = '#0a0b12'
    ctx.fillText(lbl, chartR + 3 + lw / 2, spotY)
  }

  // ── Price axis ──
  ctx.font = '600 10px -apple-system, BlinkMacSystemFont, Inter, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  const nP = Math.max(2, Math.min(7, Math.floor(chartH / 56)))
  for (let i = 0; i <= nP; i++) {
    const p = pLo + (pSpan * i) / nP
    const y = Y(p)
    if (Math.abs(y - spotY) < 11) continue // never collide with the spot pill
    ctx.strokeStyle = `rgba(${ink},0.045)`
    ctx.beginPath(); ctx.moveTo(chartL, Math.round(y) + 0.5); ctx.lineTo(chartR, Math.round(y) + 0.5); ctx.stroke()
    ctx.fillStyle = `rgba(${ink},0.42)`
    ctx.fillText(axisFmt(p), chartR + 6, y)
  }

  // ── Time axis ──
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = `rgba(${ink},0.4)`
  const tSpanMs = (timeArray[cols - 1] || 0) - (timeArray[0] || 0)
  const fmtClock = fmtClockFor(tSpanMs)
  const nT = Math.max(2, Math.min(6, Math.floor(chartW / (tSpanMs > 26 * 3600 * 1000 ? 128 : 96))))
  for (let i = 0; i <= nT; i++) {
    const idx = Math.min(cols - 1, Math.round((cols - 1) * (i / nT)))
    const ts = timeArray[idx]
    if (!Number.isFinite(ts)) continue
    const x = chartL + idx * colW
    ctx.textAlign = i === 0 ? 'left' : i === nT ? 'right' : 'center'
    ctx.fillText(fmtClock(ts), Math.max(chartL + 2, Math.min(chartR - 2, x)), H - 9)
  }

  drawSpectreWatermark(ctx, {
    w: W, h: H, dark, corner: 'tl',
    plot: { x: chartL, y: chartT, w: chartW, h: chartH },
  })

  // ── Hover ──
  let hit = null
  const m = opts.mouse
  if (m && m.x >= chartL && m.x <= chartR && m.y >= chartT && m.y <= chartB) {
    const col = Math.max(0, Math.min(cols - 1, Math.floor((m.x - chartL) / colW)))
    const price = pLo + ((chartB - m.y) / chartH) * pSpan
    let best = null, bd = Infinity
    for (const g of grid) {
      if (g.col !== col) continue
      const p = priceArray[g.row]
      const d = Math.abs(p - price)
      if (d < bd) { bd = d; best = { price: p, value: Math.abs(g.value), ts: timeArray[col] } }
    }
    ctx.save()
    ctx.strokeStyle = `rgba(${ink},0.25)`
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(m.x, chartT); ctx.lineTo(m.x, chartB); ctx.stroke()
    ctx.restore()
    if (best && bd < pSpan * 0.02) {
      hit = { ...best, side: best.price < spot ? 'long' : 'short' }
    }
  }

  return {
    hit,
    totals: { long: shownLong, short: shownShort, spot },
  }
}

export { fmtUsd as fmtBandsUsd }
