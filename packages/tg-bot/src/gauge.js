// Fear & Greed — faithful recreation of the app's /fear-greed chart:
// 1 year of the index, continuously color-graded by value, BTC overlaid in
// grey with its own price axis, zone labels on the right edge, month ticks.
// Data: alternative.me daily (free, 365d) + Binance daily closes (public),
// falling back to our 1d lane. Cached 15 min.
const { createCanvas } = require('@napi-rs/canvas')
const api = require('./spectre-api')

const W = 1400
const H = 720
const FONT = '"Helvetica Neue", "Arial", "DejaVu Sans", sans-serif'
const BG = '#0b0b0f'
const TEXT = '#f5f1e8'
const SUB = 'rgba(245,241,232,0.5)'
const GRID = 'rgba(245,241,232,0.05)'

// continuous value → color ramp (the app look: red → orange → yellow → green)
const STOPS = [
  [0, [246, 70, 93]],
  [35, [255, 159, 10]],
  [52, [232, 194, 104]],
  [68, [156, 204, 101]],
  [100, [46, 189, 133]],
]
function rampColor(v) {
  const x = Math.max(0, Math.min(100, v))
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [a, ca] = STOPS[i]
    const [b, cb] = STOPS[i + 1]
    if (x >= a && x <= b) {
      const t = (x - a) / (b - a || 1)
      const c = ca.map((ch, k) => Math.round(ch + (cb[k] - ch) * t))
      return `rgb(${c[0]},${c[1]},${c[2]})`
    }
  }
  return 'rgb(46,189,133)'
}

let _fg = { at: 0, rows: null }
async function fgDaily() {
  if (_fg.rows && Date.now() - _fg.at < 15 * 60e3) return _fg.rows
  const res = await fetch('https://api.alternative.me/fng/?limit=365&format=json', { signal: AbortSignal.timeout(12e3) }).catch(() => null)
  const data = res?.ok ? (await res.json().catch(() => null))?.data || [] : []
  const rows = data
    .map((d) => ({ ts: Number(d.timestamp) * 1000, value: Number(d.value) }))
    .filter((d) => isFinite(d.value))
    .sort((a, b) => a.ts - b.ts)
  if (rows.length) _fg = { at: Date.now(), rows }
  return rows
}

let _btc = { at: 0, rows: null }
async function btcDaily() {
  if (_btc.rows && Date.now() - _btc.at < 15 * 60e3) return _btc.rows
  // Binance public klines first (365 real daily closes), our 1d lane as fallback
  const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=365', { signal: AbortSignal.timeout(12e3) }).catch(() => null)
  let rows = null
  if (res?.ok) {
    const k = await res.json().catch(() => null)
    if (Array.isArray(k)) rows = k.map((b) => ({ ts: b[0], close: Number(b[4]) })).filter((b) => b.close > 0)
  }
  if (!rows || rows.length < 30) {
    const ohlcv = await api.ohlcv('BTC', '1d').catch(() => null)
    const bars = Array.isArray(ohlcv) ? ohlcv : ohlcv?.candles || ohlcv?.bars || []
    rows = bars.map((b) => ({ ts: (b.t || b.time) * (b.t > 1e12 ? 1 : 1000), close: Number(b.c ?? b.close) })).filter((b) => b.close > 0)
  }
  if (rows?.length) _btc = { at: Date.now(), rows }
  return rows || []
}

const kFmt = (n) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n)))

function spaced(ctx, text, x, y, gap) {
  let cx = x
  for (const ch of text) {
    ctx.fillText(ch, cx, y)
    cx += ctx.measureText(ch).width + gap
  }
}

async function fearGreedChart({ current, classification }) {
  let [fg, btc] = await Promise.all([fgDaily(), btcDaily()])
  if (fg.length < 30) return null
  // copy-on-write: fgDaily() hands back its 15-min cache — mutating it in
  // place would burn this request's `current` into every other render
  if (current != null && isFinite(Number(current))) fg = [...fg.slice(0, -1), { ...fg[fg.length - 1], value: Number(current) }]

  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)

  // plot frame
  const px0 = 110
  const px1 = W - 170
  const py0 = 150
  const py1 = H - 80
  const t0 = fg[0].ts
  const t1 = fg[fg.length - 1].ts
  const xFor = (ts) => px0 + ((ts - t0) / Math.max(1, t1 - t0)) * (px1 - px0)
  const yFg = (v) => py1 - (Math.max(0, Math.min(100, v)) / 100) * (py1 - py0)

  // horizontal grid
  ctx.strokeStyle = GRID
  ctx.lineWidth = 1
  for (const v of [0, 25, 50, 75, 100]) {
    ctx.beginPath()
    ctx.moveTo(px0, yFg(v))
    ctx.lineTo(px1, yFg(v))
    ctx.stroke()
  }

  // month ticks
  ctx.font = `500 20px ${FONT}`
  ctx.fillStyle = SUB
  ctx.textAlign = 'center'
  const seen = new Set()
  for (const d of fg) {
    const dt = new Date(d.ts)
    if (dt.getUTCDate() !== 1) continue
    const key = `${dt.getUTCFullYear()}-${dt.getUTCMonth()}`
    if (seen.has(key) || dt.getUTCMonth() % 2 !== 0) continue
    seen.add(key)
    const label = dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    ctx.fillText(label, xFor(d.ts), py1 + 36)
    ctx.strokeStyle = GRID
    ctx.beginPath()
    ctx.moveTo(xFor(d.ts), py0)
    ctx.lineTo(xFor(d.ts), py1)
    ctx.stroke()
  }

  // BTC overlay in grey, own scale + left price axis
  const btcIn = btc.filter((b) => b.ts >= t0 && b.ts <= t1)
  if (btcIn.length > 20) {
    const lo = Math.min(...btcIn.map((b) => b.close))
    const hi = Math.max(...btcIn.map((b) => b.close))
    const pad = (hi - lo) * 0.08
    const yBtc = (c) => py1 - ((c - (lo - pad)) / (hi - lo + pad * 2)) * (py1 - py0)
    ctx.strokeStyle = 'rgba(245,245,247,0.5)'
    ctx.lineWidth = 2.5
    ctx.lineJoin = 'round'
    ctx.beginPath()
    btcIn.forEach((b, i) => {
      if (i === 0) ctx.moveTo(xFor(b.ts), yBtc(b.close))
      else ctx.lineTo(xFor(b.ts), yBtc(b.close))
    })
    ctx.stroke()
    // left axis price labels
    ctx.font = `500 20px ${FONT}`
    ctx.fillStyle = SUB
    ctx.textAlign = 'right'
    for (let i = 0; i <= 4; i++) {
      const v = lo - pad + ((hi - lo + pad * 2) * i) / 4
      ctx.fillText(kFmt(v), px0 - 14, yBtc(v) + 7)
    }
  }

  // F&G line — continuous color grade, glow pass then core pass
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const [width, alpha] of [
    [9, 0.16],
    [3.5, 1],
  ]) {
    ctx.lineWidth = width
    ctx.globalAlpha = alpha
    for (let i = 1; i < fg.length; i++) {
      ctx.strokeStyle = rampColor((fg[i - 1].value + fg[i].value) / 2)
      ctx.beginPath()
      ctx.moveTo(xFor(fg[i - 1].ts), yFg(fg[i - 1].value))
      ctx.lineTo(xFor(fg[i].ts), yFg(fg[i].value))
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1

  // right-edge zone labels (app signature)
  ctx.font = `600 17px ${FONT}`
  ctx.textAlign = 'left'
  for (const [v, name] of [
    [84, 'EUPHORIA'],
    [64, 'GREED'],
    [49, 'NEUTRAL'],
    [12, 'CAPITULATION'],
  ]) {
    ctx.fillStyle = rampColor(v)
    spaced(ctx, name, px1 + 16, yFg(v) + 6, 1.5)
  }

  // endpoint dot + value chip
  const last = fg[fg.length - 1]
  const ex = xFor(last.ts)
  const ey = yFg(last.value)
  const col = rampColor(last.value)
  ctx.fillStyle = col
  ctx.beginPath()
  ctx.arc(ex, ey, 7, 0, Math.PI * 2)
  ctx.fill()
  const chipW = 58
  ctx.beginPath()
  ctx.roundRect(ex + 12, ey - 19, chipW, 38, 9)
  ctx.fill()
  ctx.fillStyle = BG
  ctx.font = `800 24px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText(String(Math.round(last.value)), ex + 12 + chipW / 2, ey + 8)

  // header: title + legend left, current value right
  ctx.textAlign = 'left'
  ctx.font = `600 21px ${FONT}`
  ctx.fillStyle = SUB
  spaced(ctx, 'SPECTRE INTELLIGENCE', 60, 54, 8)
  ctx.font = `800 42px ${FONT}`
  ctx.fillStyle = TEXT
  ctx.fillText('Fear & Greed Index', 60, 104)
  // legend flows from the MEASURED title width — hardcoded x positions sat
  // inside the 42px title and overlapped it (founder screenshot 07-16)
  const titleW = ctx.measureText('Fear & Greed Index').width
  ctx.font = `500 21px ${FONT}`
  let lx = 60 + titleW + 40
  ctx.fillStyle = rampColor(55)
  ctx.fillText('●', lx, 100)
  ctx.fillStyle = SUB
  ctx.fillText('Crypto F&G', lx + 22, 100)
  lx += 22 + ctx.measureText('Crypto F&G').width + 34
  ctx.fillStyle = 'rgba(245,245,247,0.5)'
  ctx.fillText('●', lx, 100)
  ctx.fillStyle = SUB
  ctx.fillText('Bitcoin Price   ·   1Y', lx + 22, 100)

  const v = current != null ? Number(current) : last.value
  ctx.textAlign = 'right'
  ctx.font = `800 76px ${FONT}`
  ctx.fillStyle = rampColor(v)
  ctx.fillText(String(Math.round(v)), W - 64, 96)
  ctx.font = `700 24px ${FONT}`
  ctx.fillText(String(classification || '').toUpperCase(), W - 64, 128)

  ctx.font = `500 19px ${FONT}`
  ctx.fillStyle = 'rgba(245,241,232,0.25)'
  ctx.fillText('app.spectreai.io', W - 64, H - 30)

  return canvas.toBuffer('image/png')
}

module.exports = { fearGreedChart }
