// Visual boards: squarified treemap heatmap + packed bubble map → PNG.
// Same brand frame as chart.js (header, theme, watermark).
const { createCanvas, loadImage } = require('@napi-rs/canvas')
const { THEMES, DEFAULT_THEME } = require('./themes')

// token logo loader — CG CDN 503s CORS with ?query params, so strip them
const logoCache = new Map()
function getLogo(url) {
  if (!url) return Promise.resolve(null)
  const clean = String(url).split('?')[0]
  if (!logoCache.has(clean)) {
    logoCache.set(
      clean,
      loadImage(clean).catch(() => null),
    )
    if (logoCache.size > 400) logoCache.delete(logoCache.keys().next().value)
  }
  return logoCache.get(clean)
}

function drawLogoCircle(ctx, img, cx, cy, r) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2)
  ctx.restore()
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

const W = 2400
const H = 1350
const PAD = 40
const HEADER_H = 150
const FONT = '"Helvetica Neue", "Arial", "DejaVu Sans", sans-serif'

function frame(ctx, t, title, subtitle) {
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, t.bgTop)
  bg.addColorStop(1, t.bgBottom)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = t.text
  ctx.font = `800 58px ${FONT}`
  ctx.fillText(title, PAD, 78)
  ctx.fillStyle = t.subtext
  ctx.font = `500 28px ${FONT}`
  ctx.fillText(subtitle, PAD, 122)
  // brand right
  ctx.fillStyle = t.text
  ctx.font = `800 38px ${FONT}`
  let bx = W - PAD
  const brand = 'SPECTRE AI'
  const bw = [...brand].reduce((a, ch) => a + ctx.measureText(ch).width + 7, -7)
  let cx = W - PAD - bw
  for (const ch of brand) {
    ctx.fillText(ch, cx, 70)
    cx += ctx.measureText(ch).width + 7
  }
  ctx.font = `500 22px ${FONT}`
  ctx.fillStyle = t.subtext
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  ctx.fillText(ts, W - PAD - ctx.measureText(ts).width, 104)
  ctx.fillStyle = t.watermark
  ctx.font = `600 24px ${FONT}`
  ctx.fillText('app.spectreai.io', W - PAD - ctx.measureText('app.spectreai.io').width, H - 28)
}

// change % → tile/bubble color (red ← neutral → green), intensity capped at ±10%
function changeColor(change, alpha = 1) {
  const c = Math.max(-10, Math.min(10, change ?? 0)) / 10
  let r, g, b
  if (c >= 0) {
    r = Math.round(18 + (46 - 18) * c)
    g = Math.round(60 + (189 - 60) * c)
    b = Math.round(48 + (133 - 48) * c)
  } else {
    const a = -c
    r = Math.round(60 + (246 - 60) * a)
    g = Math.round(28 + (70 - 28) * a)
    b = Math.round(34 + (93 - 34) * a)
  }
  return `rgba(${r},${g},${b},${alpha})`
}

function fmtCompact(n) {
  if (n == null || !isFinite(n)) return ''
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T'
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K'
  return String(Math.round(n))
}

// ---- squarified treemap (Bruls et al.)
function squarify(items, x, y, w, h) {
  const rects = []
  let list = items.slice()
  const worst = (row, len) => {
    const sum = row.reduce((a, r) => a + r.area, 0)
    const max = Math.max(...row.map((r) => r.area))
    const min = Math.min(...row.map((r) => r.area))
    const s2 = sum * sum
    return Math.max((len * len * max) / s2, s2 / (len * len * min))
  }
  const layoutRow = (row, x0, y0, w0, h0) => {
    const sum = row.reduce((a, r) => a + r.area, 0)
    const horizontal = w0 >= h0
    const len = horizontal ? h0 : w0
    const thick = sum / len
    let off = 0
    for (const r of row) {
      const l = r.area / thick
      if (horizontal) rects.push({ ...r.item, x: x0, y: y0 + off, w: thick, h: l })
      else rects.push({ ...r.item, x: x0 + off, y: y0, w: l, h: thick })
      off += l
    }
    return horizontal ? [x0 + thick, y0, w0 - thick, h0] : [x0, y0 + thick, w0, h0 - thick]
  }
  let rect = [x, y, w, h]
  let row = []
  while (list.length) {
    const [, , w0, h0] = rect
    const len = Math.min(w0, h0)
    const next = list[0]
    if (!row.length || worst([...row, next], len) <= worst(row, len)) {
      row.push(list.shift())
    } else {
      rect = layoutRow(row, ...rect)
      row = []
    }
  }
  if (row.length) layoutRow(row, ...rect)
  return rects
}

/**
 * @param {Array} tiles [{label, value (weight), change, sub}] — value > 0
 */
async function heatmapPng({ tiles, title, subtitle, themeName }) {
  const t = THEMES[themeName] || THEMES[DEFAULT_THEME]
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  frame(ctx, t, title, subtitle)

  const px = PAD
  const py = HEADER_H
  const pw = W - PAD * 2
  const ph = H - HEADER_H - 64
  const total = tiles.reduce((a, x) => a + x.value, 0)
  const items = tiles
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((item) => ({ item, area: (item.value / total) * pw * ph }))
  const rects = squarify(items, px, py, pw, ph)
  const logos = await Promise.all(rects.map((r) => getLogo(r.logo)))

  rects.forEach((r, i) => {
    const x = r.x + 4
    const y = r.y + 4
    const w = Math.max(r.w - 8, 2)
    const h = Math.max(r.h - 8, 2)
    // glass tile: rounded, vertical gradient, hairline border
    const grad = ctx.createLinearGradient(0, y, 0, y + h)
    grad.addColorStop(0, changeColor(r.change, 0.98))
    grad.addColorStop(1, changeColor(r.change, 0.78))
    ctx.fillStyle = grad
    roundRectPath(ctx, x, y, w, h, 18)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth = 2
    ctx.stroke()

    const minDim = Math.min(w, h)
    if (minDim < 46 || w < 70) return
    const symSize = Math.max(20, Math.min(64, minDim * 0.28, w / (r.label.length * 0.62)))
    const cx = x + w / 2
    const cy = y + h / 2
    const logo = logos[i]
    const hasPct = minDim >= 76
    const hasLogo = logo && minDim >= 130
    const logoR = Math.min(34, minDim * 0.14)
    if (hasLogo) drawLogoCircle(ctx, logo, cx, cy - symSize * 0.9 - logoR * 0.6, logoR)
    ctx.fillStyle = 'rgba(255,255,255,0.97)'
    ctx.font = `800 ${symSize}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText(r.label, cx, hasPct ? cy + (hasLogo ? symSize * 0.25 : -symSize * 0.15) : cy + symSize * 0.35)
    if (hasPct) {
      ctx.font = `600 ${Math.max(18, symSize * 0.52)}px ${FONT}`
      ctx.fillStyle = 'rgba(255,255,255,0.88)'
      const pct = `${r.change >= 0 ? '+' : ''}${(r.change ?? 0).toFixed(1)}%`
      ctx.fillText(pct, cx, cy + symSize * (hasLogo ? 0.95 : 0.62))
      if (r.sub && minDim >= 130) {
        ctx.font = `500 ${Math.max(16, symSize * 0.38)}px ${FONT}`
        ctx.fillStyle = 'rgba(255,255,255,0.62)'
        ctx.fillText(r.sub, cx, cy + symSize * (hasLogo ? 1.45 : 1.15))
      }
    }
    ctx.textAlign = 'left'
  })
  return canvas.toBuffer('image/png')
}

/**
 * @param {Array} items [{label, size (weight), change, sub}]
 */
async function bubblesPng({ items, title, subtitle, themeName }) {
  const t = THEMES[themeName] || THEMES[DEFAULT_THEME]
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  frame(ctx, t, title, subtitle)

  const cx0 = W / 2
  const cy0 = (H + HEADER_H) / 2 - 20
  const maxSize = Math.max(...items.map((i) => i.size))
  const sorted = items
    .slice()
    .sort((a, b) => b.size - a.size)
    .map((i) => ({ ...i, r: 42 + 130 * Math.sqrt(i.size / maxSize) }))

  // spiral packing
  const placed = []
  for (const b of sorted) {
    if (!placed.length) {
      b.x = cx0
      b.y = cy0
      placed.push(b)
      continue
    }
    let t0 = 0
    while (t0 < 220) {
      const ang = t0 * 0.55
      const rad = 8 * t0
      const x = cx0 + Math.cos(ang) * rad
      const y = cy0 + Math.sin(ang) * rad * 0.62 // flatten to canvas aspect
      if (
        x - b.r > PAD &&
        x + b.r < W - PAD &&
        y - b.r > HEADER_H + 6 &&
        y + b.r < H - 50 &&
        placed.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + b.r + 6)
      ) {
        b.x = x
        b.y = y
        break
      }
      t0 += 1
    }
    if (b.x == null) continue
    placed.push(b)
  }

  const logos = await Promise.all(placed.map((b) => getLogo(b.logo)))
  placed.forEach((b, i) => {
    // outer glow — the app's bubble look
    ctx.save()
    ctx.shadowColor = changeColor(b.change, 0.8)
    ctx.shadowBlur = 34
    const grad = ctx.createRadialGradient(b.x, b.y, b.r * 0.15, b.x, b.y, b.r)
    grad.addColorStop(0, changeColor(b.change, 0.16))
    grad.addColorStop(0.78, changeColor(b.change, 0.42))
    grad.addColorStop(1, changeColor(b.change, 0.9))
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    ctx.strokeStyle = changeColor(b.change, 1)
    ctx.lineWidth = 3.5
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
    ctx.stroke()
    // inner highlight rim (glass)
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.r - 5, 0, Math.PI * 2)
    ctx.stroke()

    const symSize = Math.max(18, Math.min(52, b.r * 0.4, (b.r * 1.7) / (b.label.length * 0.6)))
    const logo = logos[i]
    const hasLogo = logo && b.r >= 66
    const logoR = Math.min(30, b.r * 0.3)
    if (hasLogo) drawLogoCircle(ctx, logo, b.x, b.y - b.r * 0.44, logoR)
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(255,255,255,0.97)'
    ctx.font = `800 ${symSize}px ${FONT}`
    ctx.fillText(b.label, b.x, b.y + (hasLogo ? symSize * 0.45 : -b.r * 0.02))
    ctx.font = `600 ${symSize * 0.62}px ${FONT}`
    ctx.fillStyle = 'rgba(255,255,255,0.87)'
    ctx.fillText(`${b.change >= 0 ? '+' : ''}${(b.change ?? 0).toFixed(1)}%`, b.x, b.y + symSize * (hasLogo ? 1.2 : 0.85))
    if (b.sub && b.r > 92) {
      ctx.font = `500 ${symSize * 0.42}px ${FONT}`
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.fillText(b.sub, b.x, b.y + symSize * (hasLogo ? 1.85 : 1.5))
    }
    ctx.textAlign = 'left'
  })
  return canvas.toBuffer('image/png')
}

module.exports = { heatmapPng, bubblesPng, fmtCompact }
