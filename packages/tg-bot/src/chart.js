const { createCanvas } = require('@napi-rs/canvas')
const { ema, rsi } = require('./indicators')
const { THEMES, DEFAULT_THEME } = require('./themes')

// Rendered at 2x for Telegram's JPEG recompression: high contrast, text ≥22px.
const W = 2400
const H = 1350
const PAD = 48
const HEADER_H = 170
const AXIS_W = 200
const TIME_AXIS_H = 76
const RSI_H = 150
const VOL_H = 160
const GAP = 24

const FONT = '"Helvetica Neue", "Arial", "DejaVu Sans", sans-serif'

function fmtAxisPrice(v, step) {
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (v >= 1) return v.toFixed(step < 0.05 ? 3 : 2)
  const digits = Math.max(2, 2 - Math.floor(Math.log10(Math.max(v, 1e-12))))
  return v.toFixed(Math.min(digits + 1, 10))
}

function niceStep(rough) {
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  const n = rough / mag
  if (n <= 1) return mag
  if (n <= 2) return 2 * mag
  if (n <= 2.5) return 2.5 * mag
  if (n <= 5) return 5 * mag
  return 10 * mag
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function spacedText(ctx, text, x, y, spacing) {
  let cx = x
  for (const ch of text) {
    ctx.fillText(ch, cx, y)
    cx += ctx.measureText(ch).width + spacing
  }
  return cx - x - spacing
}

function spacedWidth(ctx, text, spacing) {
  let w = 0
  for (const ch of text) w += ctx.measureText(ch).width + spacing
  return w - spacing
}

function fmtTick(date, intraday) {
  const d = new Date(date)
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  if (!intraday) return `${d.getUTCDate()} ${mon}`
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return hh === '00' && mm === '00' ? `${d.getUTCDate()} ${mon}` : `${hh}:${mm}`
}

/**
 * Render a candlestick chart PNG.
 * @param {object} p
 * @param {string} p.symbol       e.g. 'BTC'
 * @param {string} p.tfLabel      e.g. '1H'
 * @param {Array}  p.candles      ascending [{time, open, high, low, close, volume}]
 * @param {string} [p.themeName]
 * @param {number} [p.change24h]  optional 24h % for the header (falls back to window change)
 * @returns {Buffer} PNG
 */
function renderChart({ symbol, tfLabel, candles, themeName, change24h, intraday: intradayOpt, pairLabel }) {
  const t = THEMES[themeName] || THEMES[DEFAULT_THEME]
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  // ---- background
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, t.bgTop)
  bg.addColorStop(1, t.bgBottom)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // ---- layout
  const plotX = PAD
  const plotW = W - PAD - AXIS_W
  const chartTop = HEADER_H
  const chartBottom = H - TIME_AXIS_H
  const rsiTop = chartBottom - RSI_H
  const volTop = rsiTop - GAP - VOL_H
  const priceTop = chartTop
  const priceBottom = volTop - GAP
  const priceH = priceBottom - priceTop

  const closes = candles.map((c) => c.close)
  const ema20 = ema(closes, 20)
  const ema50 = ema(closes, 50)
  const rsi14 = rsi(closes, 14)
  const last = candles[candles.length - 1]
  const first = candles[0]
  const lastUp = last.close >= (candles[candles.length - 2]?.close ?? last.open)
  const windowChange = ((last.close - first.open) / first.open) * 100
  const headChange = isFinite(change24h) && change24h != null ? change24h : windowChange
  const headChangeLabel = isFinite(change24h) && change24h != null ? '24h' : `${tfLabel} window`

  // ---- price scale
  let lo = Infinity
  let hi = -Infinity
  for (const c of candles) {
    if (c.low < lo) lo = c.low
    if (c.high > hi) hi = c.high
  }
  for (const arr of [ema20, ema50]) {
    for (const v of arr) {
      if (v == null) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  const padPct = (hi - lo) * 0.06 || hi * 0.01
  lo -= padPct
  hi += padPct
  const py = (v) => priceTop + ((hi - v) / (hi - lo)) * priceH

  // ---- faint centered logotype watermark behind the candles
  ctx.save()
  ctx.fillStyle = t.watermark
  ctx.globalAlpha = 0.35
  ctx.font = `800 150px ${FONT}`
  const wmText = 'SPECTRE'
  const wmW = spacedWidth(ctx, wmText, 44)
  spacedText(ctx, wmText, plotX + (plotW - wmW) / 2, priceTop + priceH / 2 + 50, 44)
  ctx.restore()

  // ---- horizontal grid + right axis labels
  const step = niceStep((hi - lo) / 6)
  const gridStart = Math.ceil(lo / step) * step
  ctx.font = `500 26px ${FONT}`
  for (let v = gridStart; v <= hi; v += step) {
    const y = py(v)
    ctx.strokeStyle = t.grid
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(plotX, y)
    ctx.lineTo(plotX + plotW, y)
    ctx.stroke()
    ctx.fillStyle = t.axis
    ctx.fillText(fmtAxisPrice(v, step), plotX + plotW + 18, y + 9)
  }

  // ---- vertical grid + time labels
  const intraday = intradayOpt ?? ['15m', '1H', '4H'].includes(tfLabel)
  const n = candles.length
  const slot = plotW / n
  const tickEvery = Math.max(1, Math.round(n / 6))
  ctx.font = `500 25px ${FONT}`
  for (let i = 0; i < n; i += tickEvery) {
    const x = plotX + slot * (i + 0.5)
    ctx.strokeStyle = t.grid
    ctx.beginPath()
    ctx.moveTo(x, chartTop)
    ctx.lineTo(x, chartBottom)
    ctx.stroke()
    ctx.fillStyle = t.axis
    const label = fmtTick(candles[i].time, intraday)
    ctx.fillText(label, x - ctx.measureText(label).width / 2, chartBottom + 44)
  }

  // ---- volume pane
  let volMax = 0
  for (const c of candles) if (c.volume > volMax) volMax = c.volume
  if (volMax > 0) {
    for (let i = 0; i < n; i++) {
      const c = candles[i]
      const x = plotX + slot * i + slot * 0.19
      const bw = Math.max(slot * 0.62, 2)
      const bh = (c.volume / volMax) * (VOL_H * 0.92)
      ctx.fillStyle = c.close >= c.open ? t.volUp : t.volDown
      ctx.fillRect(x, volTop + VOL_H - bh, bw, bh)
    }
  }
  ctx.fillStyle = t.subtext
  ctx.font = `600 24px ${FONT}`
  ctx.fillText('VOLUME', plotX + 6, volTop + 30)

  // ---- candles
  const bodyW = Math.max(slot * 0.62, 3)
  const wickW = Math.max(slot * 0.1, 2)
  for (let i = 0; i < n; i++) {
    const c = candles[i]
    const up = c.close >= c.open
    const cx = plotX + slot * (i + 0.5)
    const color = up ? t.up : t.down
    const fill = up ? t.upFill : t.downFill
    // wick
    ctx.fillStyle = color
    ctx.fillRect(cx - wickW / 2, py(c.high), wickW, Math.max(py(c.low) - py(c.high), 1))
    // body
    const yO = py(c.open)
    const yC = py(c.close)
    const top = Math.min(yO, yC)
    const hgt = Math.max(Math.abs(yO - yC), 2.5)
    ctx.fillStyle = fill
    ctx.fillRect(cx - bodyW / 2, top, bodyW, hgt)
    if (fill !== color) {
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.strokeRect(cx - bodyW / 2, top, bodyW, hgt)
    }
  }

  // ---- EMA overlays
  const drawLine = (series, color) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 3.5
    ctx.lineJoin = 'round'
    ctx.beginPath()
    let started = false
    for (let i = 0; i < n; i++) {
      if (series[i] == null) continue
      const x = plotX + slot * (i + 0.5)
      const y = py(series[i])
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  drawLine(ema20, t.ema20)
  drawLine(ema50, t.ema50)

  // ---- EMA legend
  const lastE20 = ema20[n - 1]
  const lastE50 = ema50[n - 1]
  ctx.font = `600 26px ${FONT}`
  let lx = plotX + 6
  const ly = priceTop + 34
  for (const [label, val, color] of [
    ['EMA20', lastE20, t.ema20],
    ['EMA50', lastE50, t.ema50],
  ]) {
    if (val == null) continue
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(lx + 9, ly - 9, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = t.subtext
    const text = `${label} ${fmtAxisPrice(val, step)}`
    ctx.fillText(text, lx + 28, ly)
    lx += 28 + ctx.measureText(text).width + 36
  }

  // ---- last price dashed line + axis tag
  const lpy = py(last.close)
  ctx.save()
  ctx.strokeStyle = t.lastPrice
  ctx.lineWidth = 2
  ctx.setLineDash([10, 10])
  ctx.beginPath()
  ctx.moveTo(plotX, lpy)
  ctx.lineTo(plotX + plotW, lpy)
  ctx.stroke()
  ctx.restore()
  const tagColor = lastUp ? t.up : t.down
  const tagText = fmtAxisPrice(last.close, step)
  ctx.font = `700 27px ${FONT}`
  const tagW = ctx.measureText(tagText).width + 28
  roundRect(ctx, plotX + plotW + 8, lpy - 24, tagW, 48, 8)
  ctx.fillStyle = tagColor
  ctx.fill()
  ctx.fillStyle = themeName === 'noir' ? '#000000' : '#ffffff'
  ctx.fillText(tagText, plotX + plotW + 22, lpy + 10)

  // ---- RSI pane
  ctx.strokeStyle = t.grid
  ctx.lineWidth = 2
  ctx.strokeRect(plotX, rsiTop, plotW, RSI_H)
  const ry = (v) => rsiTop + ((100 - v) / 100) * RSI_H
  ctx.save()
  ctx.setLineDash([8, 8])
  ctx.strokeStyle = t.rsiGuide
  for (const g of [30, 70]) {
    ctx.beginPath()
    ctx.moveTo(plotX, ry(g))
    ctx.lineTo(plotX + plotW, ry(g))
    ctx.stroke()
  }
  ctx.restore()
  ctx.strokeStyle = t.rsi
  ctx.lineWidth = 3
  ctx.beginPath()
  let rStarted = false
  for (let i = 0; i < n; i++) {
    if (rsi14[i] == null) continue
    const x = plotX + slot * (i + 0.5)
    if (!rStarted) {
      ctx.moveTo(x, ry(rsi14[i]))
      rStarted = true
    } else ctx.lineTo(x, ry(rsi14[i]))
  }
  ctx.stroke()
  const lastRsi = rsi14[n - 1]
  ctx.fillStyle = t.subtext
  ctx.font = `600 24px ${FONT}`
  ctx.fillText(`RSI 14 ${lastRsi != null ? '· ' + lastRsi.toFixed(1) : ''}`, plotX + 6, rsiTop + 32)
  ctx.fillStyle = t.axis
  ctx.font = `500 22px ${FONT}`
  ctx.fillText('70', plotX + plotW + 18, ry(70) + 8)
  ctx.fillText('30', plotX + plotW + 18, ry(30) + 8)

  // ---- header
  ctx.fillStyle = t.text
  ctx.font = `800 64px ${FONT}`
  const pair = pairLabel || `${symbol.toUpperCase()}/USD`
  ctx.fillText(pair, PAD, 84)
  const pairW = ctx.measureText(pair).width
  // timeframe chip
  ctx.font = `700 30px ${FONT}`
  const chipW = ctx.measureText(tfLabel).width + 36
  roundRect(ctx, PAD + pairW + 26, 46, chipW, 48, 10)
  ctx.fillStyle = t.grid
  ctx.fill()
  ctx.fillStyle = t.subtext
  ctx.fillText(tfLabel, PAD + pairW + 44, 80)
  // price + change
  ctx.fillStyle = t.text
  ctx.font = `700 52px ${FONT}`
  const priceStr = last.close >= 1000
    ? '$' + last.close.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : '$' + fmtAxisPrice(last.close, step)
  ctx.fillText(priceStr, PAD, 148)
  const pW = ctx.measureText(priceStr).width
  ctx.fillStyle = headChange >= 0 ? t.up : t.down
  ctx.font = `700 40px ${FONT}`
  const chStr = `${headChange >= 0 ? '▲' : '▼'} ${headChange >= 0 ? '+' : ''}${headChange.toFixed(2)}%`
  ctx.fillText(chStr, PAD + pW + 28, 146)
  const chW = ctx.measureText(chStr).width
  ctx.fillStyle = t.subtext
  ctx.font = `500 28px ${FONT}`
  ctx.fillText(headChangeLabel, PAD + pW + 28 + chW + 16, 144)

  // ---- brand block (top right)
  ctx.fillStyle = t.text
  ctx.font = `800 42px ${FONT}`
  const brand = 'SPECTRE AI'
  const brandW = spacedWidth(ctx, brand, 8)
  spacedText(ctx, brand, W - PAD - brandW, 76, 8)
  ctx.fillStyle = t.subtext
  ctx.font = `600 22px ${FONT}`
  const sub = 'INTELLIGENCE'
  const subW = spacedWidth(ctx, sub, 12)
  spacedText(ctx, sub, W - PAD - subW, 112, 12)
  ctx.font = `500 22px ${FONT}`
  const ts = new Date(last.time).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  ctx.fillText(ts, W - PAD - ctx.measureText(ts).width, 148)

  // ---- footer watermark
  ctx.fillStyle = t.watermark
  ctx.font = `600 26px ${FONT}`
  ctx.fillText('app.spectreai.io', plotX + plotW - ctx.measureText('app.spectreai.io').width, volTop - 10)

  return canvas.toBuffer('image/png')
}

module.exports = { renderChart }
