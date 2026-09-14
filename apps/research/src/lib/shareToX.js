/**
 * shareToX - Universal "Share to X" canvas pipeline.
 *
 * Provides:
 * - renderShareCard(): creates a branded 4x retina canvas, returns dataURL
 * - preloadLogos(): CORS-safe logo loading with proxy fallback
 * - getSharePalette(): light/dark theme palette
 * - drawShareHeader() / drawShareFooter(): shared card chrome
 * - Canvas helpers: drawGlow, drawDivider, truncateText, roundRect, drawPill
 */

import { isDev } from '@/utils/env'

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif"
const FONT_MONO = "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif"
const CARD_W = 640
const CARD_PAD = 36
const CARD_SCALE = 4
const HEADER_H = 88
const FOOTER_H = 78

/* ────────────────────────────────────────────
   Theme palette
   ──────────────────────────────────────────── */

export function getSharePalette() {
  const isLight = document.documentElement.classList.contains('app-day-mode')
  return isLight ? {
    isLight: true,
    bg: '#f5f5f7',
    bgSub: '#efeff1',
    glow1: 'rgba(0,0,0,0.018)',
    glow2: 'rgba(120,120,128,0.04)',
    edgeHL: 'rgba(0,0,0,0.06)',
    logoFallback: '#1d1d1f',
    tagline: 'rgba(0,0,0,0.32)',
    tfBadgeBg: 'rgba(0,0,0,0.05)',
    tfBadgeText: '#48484a',
    catBadgeBg: '#1d1d1f',
    catBadgeText: '#ffffff',
    accentLow: 'rgba(0,0,0,0.035)',
    accentHigh: 'rgba(0,0,0,0.09)',
    thColor: 'rgba(0,0,0,0.32)',
    rowAlt: 'rgba(0,0,0,0.022)',
    rank: 'rgba(0,0,0,0.22)',
    fallbackBg: 'rgba(0,0,0,0.05)',
    fallbackText: 'rgba(0,0,0,0.4)',
    symbol: '#1d1d1f',
    name: 'rgba(0,0,0,0.42)',
    price: '#1d1d1f',
    bull: '#059669',
    bear: '#dc2626',
    neutral: 'rgba(0,0,0,0.25)',
    muted: 'rgba(0,0,0,0.38)',
    footSepLow: 'rgba(0,0,0,0.025)',
    footSepHigh: 'rgba(0,0,0,0.07)',
    url: '#1d1d1f',
    date: 'rgba(0,0,0,0.3)',
    handle: 'rgba(0,0,0,0.22)',
    copy: 'rgba(0,0,0,0.15)',
    border: 'rgba(0,0,0,0.08)',
    cardBorder: 'rgba(0,0,0,0.06)',
    cardBg: 'rgba(0,0,0,0.02)',
    white: '#1d1d1f',
    whiteAlpha: (a) => `rgba(0,0,0,${a})`,
  } : {
    isLight: false,
    bg: '#09090b',
    bgSub: '#0f0f12',
    glow1: 'rgba(255,255,255,0.012)',
    glow2: 'rgba(200,200,220,0.025)',
    edgeHL: 'rgba(255,255,255,0.05)',
    logoFallback: '#f5f5f7',
    tagline: 'rgba(255,255,255,0.28)',
    tfBadgeBg: 'rgba(255,255,255,0.06)',
    tfBadgeText: 'rgba(255,255,255,0.48)',
    catBadgeBg: '#f5f5f7',
    catBadgeText: '#09090b',
    accentLow: 'rgba(255,255,255,0.03)',
    accentHigh: 'rgba(255,255,255,0.08)',
    thColor: 'rgba(255,255,255,0.28)',
    rowAlt: 'rgba(255,255,255,0.018)',
    rank: 'rgba(255,255,255,0.22)',
    fallbackBg: 'rgba(255,255,255,0.05)',
    fallbackText: 'rgba(255,255,255,0.4)',
    symbol: '#f5f5f7',
    name: 'rgba(255,255,255,0.4)',
    price: 'rgba(255,255,255,0.82)',
    bull: '#34d399',
    bear: '#f87171',
    neutral: 'rgba(255,255,255,0.25)',
    muted: 'rgba(255,255,255,0.38)',
    footSepLow: 'rgba(255,255,255,0.025)',
    footSepHigh: 'rgba(255,255,255,0.07)',
    url: '#f5f5f7',
    date: 'rgba(255,255,255,0.28)',
    handle: 'rgba(255,255,255,0.18)',
    copy: 'rgba(255,255,255,0.12)',
    border: 'rgba(255,255,255,0.06)',
    cardBorder: 'rgba(255,255,255,0.05)',
    cardBg: 'rgba(255,255,255,0.02)',
    white: '#f5f5f7',
    whiteAlpha: (a) => `rgba(255,255,255,${a})`,
  }
}

/* ────────────────────────────────────────────
   Logo pre-loading with CORS proxy fallback
   ──────────────────────────────────────────── */

export async function preloadLogos(tokens, getLogoUrl) {
  const proxyBase = isDev ? 'http://localhost:3001/api/img-proxy' : '/api/img-proxy'

  const tryLoadImg = (src, ms = 4000) => new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const timer = setTimeout(() => { img.src = ''; reject(new Error('timeout')) }, ms)
    img.onload = () => { clearTimeout(timer); resolve(img) }
    img.onerror = () => { clearTimeout(timer); reject(new Error('failed')) }
    img.src = src
  })

  const logoMap = {}
  await Promise.all(tokens.map(async (token) => {
    const url = getLogoUrl(token)
    if (!url || url.startsWith('/')) return
    try {
      const img = await Promise.any([
        tryLoadImg(url, 4000),
        tryLoadImg(`${proxyBase}?url=${encodeURIComponent(url)}`, 4000),
      ])
      logoMap[token.symbol || token] = img
    } catch { /* letter fallback */ }
  }))
  return logoMap
}

/* ────────────────────────────────────────────
   Spectre logo preloader (cached)
   ──────────────────────────────────────────── */

let _spectreLogoCache = null

export async function getSpectreLogo() {
  if (_spectreLogoCache) return _spectreLogoCache
  try {
    const isLight = document.documentElement.classList.contains('app-day-mode')
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = isLight ? '/logo-day-mode.png' : '/logo-dark-mode.png'
    })
    _spectreLogoCache = img
    return img
  } catch {
    return null
  }
}

/* ────────────────────────────────────────────
   Shared card header / footer drawing
   ──────────────────────────────────────────── */

export function drawShareHeader(ctx, c, w, pad, { title, subtitle, badges = [], logo } = {}) {
  // Background
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, w, HEADER_H + pad + 12)

  // Cinematic ambient glow
  const glow1 = ctx.createRadialGradient(pad + 60, pad + 20, 0, pad + 60, pad + 20, 220)
  glow1.addColorStop(0, c.glow2)
  glow1.addColorStop(1, 'transparent')
  ctx.fillStyle = glow1
  ctx.fillRect(0, 0, w, HEADER_H + pad + 12)

  const glow2 = ctx.createRadialGradient(w - 120, pad + 30, 0, w - 120, pad + 30, 160)
  glow2.addColorStop(0, c.glow1)
  glow2.addColorStop(1, 'transparent')
  ctx.fillStyle = glow2
  ctx.fillRect(0, 0, w, HEADER_H + pad + 12)

  // Top edge shimmer
  const topEdge = ctx.createLinearGradient(0, 0, w, 0)
  topEdge.addColorStop(0, 'transparent')
  topEdge.addColorStop(0.15, c.edgeHL)
  topEdge.addColorStop(0.5, c.isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)')
  topEdge.addColorStop(0.85, c.edgeHL)
  topEdge.addColorStop(1, 'transparent')
  ctx.fillStyle = topEdge
  ctx.fillRect(0, 0, w, 1)

  // Spectre branded logo banner (phoenix + "Spectre AI" metallic text)
  if (logo && logo.naturalWidth > 0) {
    // Banner image is ~2048x541 (~3.78:1 ratio). Scale to fit header height.
    const bannerH = 32
    const bannerW = bannerH * (logo.naturalWidth / logo.naturalHeight)
    const bannerX = pad
    const bannerY = pad + 4

    ctx.drawImage(logo, bannerX, bannerY, bannerW, bannerH)

    // Tagline below banner
    ctx.fillStyle = c.tagline
    ctx.font = `400 11px ${FONT}`
    ctx.textAlign = 'left'
    ctx.fillText(title || 'AI Market Intelligence', pad, pad + 52)

    // Secondary label (page context) if title overrides default
    if (title && title !== 'AI Market Intelligence') {
      ctx.fillStyle = c.muted
      ctx.font = `400 9.5px ${FONT}`
      ctx.fillText('AI Market Intelligence', pad, pad + 66)
    }
  } else {
    // Fallback: plain text if logo fails to load
    ctx.fillStyle = c.logoFallback
    ctx.font = `700 20px ${FONT}`
    ctx.textAlign = 'left'
    ctx.fillText('Spectre AI', pad, pad + 28)

    ctx.fillStyle = c.tagline
    ctx.font = `400 11px ${FONT}`
    ctx.fillText(title || 'AI Market Intelligence', pad, pad + 46)
  }

  // Badges (right-aligned)
  let bx = w - pad
  badges.forEach((badge, i) => {
    ctx.font = `600 10px ${FONT}`
    const tw = ctx.measureText(badge.text.toUpperCase()).width + 20
    bx -= tw + (i > 0 ? 8 : 0)
    ctx.fillStyle = badge.filled ? c.catBadgeBg : c.tfBadgeBg
    ctx.beginPath(); ctx.roundRect(bx, pad + 8, tw, 22, 6); ctx.fill()
    ctx.fillStyle = badge.filled ? c.catBadgeText : c.tfBadgeText
    ctx.textAlign = 'left'
    ctx.fillText(badge.text.toUpperCase(), bx + 10, pad + 23)
  })

  // Subtitle (right-aligned, below badges)
  if (subtitle) {
    ctx.font = `400 10.5px ${FONT}`
    ctx.fillStyle = c.muted
    ctx.textAlign = 'right'
    ctx.fillText(subtitle, w - pad, pad + 54)
  }

  // Accent line
  const accentY = HEADER_H + 12
  const grad = ctx.createLinearGradient(0, 0, w, 0)
  grad.addColorStop(0, 'transparent')
  grad.addColorStop(0.08, c.accentLow)
  grad.addColorStop(0.5, c.accentHigh)
  grad.addColorStop(0.92, c.accentLow)
  grad.addColorStop(1, 'transparent')
  ctx.fillStyle = grad
  ctx.fillRect(pad, accentY, w - pad * 2, 1)

  return accentY + 1
}

export function drawShareFooter(ctx, c, w, H, pad) {
  const fy = H - pad - FOOTER_H + 18
  // Separator
  const footGrad = ctx.createLinearGradient(0, 0, w, 0)
  footGrad.addColorStop(0, 'transparent')
  footGrad.addColorStop(0.08, c.footSepLow)
  footGrad.addColorStop(0.5, c.footSepHigh)
  footGrad.addColorStop(0.92, c.footSepLow)
  footGrad.addColorStop(1, 'transparent')
  ctx.fillStyle = footGrad
  ctx.fillRect(pad, fy, w - pad * 2, 1)

  // Row 1: URL + Date
  ctx.textAlign = 'left'
  ctx.fillStyle = c.url
  ctx.font = `500 11.5px ${FONT}`
  ctx.fillText('spectreai.io', pad + 8, fy + 24)
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  ctx.textAlign = 'right'
  ctx.fillStyle = c.date
  ctx.font = `400 11px ${FONT}`
  ctx.fillText(dateStr, w - pad - 8, fy + 24)

  // Row 2: @handle + copyright
  ctx.textAlign = 'left'
  ctx.fillStyle = c.handle
  ctx.font = `400 10.5px ${FONT}`
  ctx.fillText('@Spectre__Ai', pad + 8, fy + 44)
  ctx.textAlign = 'right'
  const copyText = `\u00A9 ${new Date().getFullYear()} Spectre AI`
  ctx.fillStyle = c.copy
  ctx.fillText(copyText, w - pad - 8, fy + 44)
}

/* ────────────────────────────────────────────
   Centre watermark - survives a crop
   ──────────────────────────────────────────── */

/**
 * Draw the Spectre mark across the middle of a card.
 *
 * Beta report (ChainROI, 2026-08-19): "this pic is easy to crop, then no info
 * it belongs to Spectre." A corner lockup is one crop away from gone, so every
 * exported card also carries the mark through its centre — faint enough that
 * the numbers stay first, present enough that a cropped screenshot still says
 * who made it.
 */
export function drawCenterWatermark(ctx, w, h, c, logo, { alpha, maxWidth = 320 } = {}) {
  const a = alpha != null ? alpha : (c.isLight ? 0.085 : 0.07)
  const cx = w / 2
  const cy = h / 2

  ctx.save()
  ctx.globalAlpha = a
  ctx.textAlign = 'center'

  let markBottom = cy
  if (logo && logo.naturalWidth > 0) {
    const bw = Math.min(w * 0.52, maxWidth)
    const bh = bw * (logo.naturalHeight / logo.naturalWidth)
    ctx.drawImage(logo, cx - bw / 2, cy - bh / 2 - 6, bw, bh)
    markBottom = cy - bh / 2 - 6 + bh
  } else {
    ctx.fillStyle = c.white
    ctx.font = `800 30px ${FONT}`
    ctx.fillText('SPECTRE AI', cx, cy)
    markBottom = cy + 10
  }

  // Domain under the mark — the half a cropper is most likely to keep.
  ctx.globalAlpha = a * 1.15
  ctx.fillStyle = c.white
  ctx.font = `600 12px ${FONT}`
  ctx.fillText('app.spectreai.io', cx, markBottom + 20)

  ctx.restore()
}

/* ────────────────────────────────────────────
   Core card renderer - returns dataURL
   ──────────────────────────────────────────── */

/**
 * Render a branded share card. Returns a PNG dataURL.
 *
 * @param {(ctx, w, contentTop, c, fonts) => number} drawContentFn
 *   Custom draw function. Receives canvas context, card width, Y-offset where
 *   content area starts (after header), palette, and font stacks.
 *   Must return the total content-area height in logical pixels.
 *
 * @param {{ title?: string, subtitle?: string, badges?: Array }} headerOpts
 *   Header configuration.
 *
 * @returns {string} dataURL of the rendered card
 */
export function renderShareCard(drawContentFn, headerOpts = {}) {
  const c = getSharePalette()
  const pad = CARD_PAD
  const w = CARD_W
  const fonts = { body: FONT, mono: FONT_MONO }

  // First pass: measure content height with a temp canvas
  const measureCanvas = document.createElement('canvas')
  measureCanvas.width = w * CARD_SCALE
  measureCanvas.height = 4000 // tall enough for measurement
  const measureCtx = measureCanvas.getContext('2d')
  measureCtx.scale(CARD_SCALE, CARD_SCALE)
  const contentTop = pad + HEADER_H + 14
  const contentH = drawContentFn(measureCtx, w, contentTop, c, fonts)

  // Calculate total height
  const totalH = contentTop + contentH + FOOTER_H + pad

  // Real render
  const canvas = document.createElement('canvas')
  canvas.width = w * CARD_SCALE
  canvas.height = totalH * CARD_SCALE
  const ctx = canvas.getContext('2d')
  ctx.scale(CARD_SCALE, CARD_SCALE)

  // Clip + background
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(0, 0, w, totalH, 0)
  ctx.clip()

  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, w, totalH)

  // Header
  drawShareHeader(ctx, c, w, pad, headerOpts)

  // Content
  drawContentFn(ctx, w, contentTop, c, fonts)

  // Centre watermark — drawn over the content so a crop anywhere still
  // carries the brand. Opt out with { watermark: false } in headerOpts.
  if (headerOpts.watermark !== false) {
    drawCenterWatermark(ctx, w, totalH, c, headerOpts.logo, headerOpts.watermarkOpts)
  }

  // Footer
  drawShareFooter(ctx, c, w, totalH, pad)

  // Border
  ctx.strokeStyle = c.border
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.rect(0.5, 0.5, w - 1, totalH - 1)
  ctx.stroke()

  ctx.restore()

  return canvas.toDataURL('image/png')
}

/* ────────────────────────────────────────────
   Canvas helpers - shared across all draw fns
   ──────────────────────────────────────────── */

/** Soft radial glow behind the content */
export function drawGlow(ctx, w, h, rgb = '139, 92, 246', cy = 0.3) {
  const g = ctx.createRadialGradient(w * 0.5, h * cy, 0, w * 0.5, h * (cy + 0.1), w * 0.5)
  g.addColorStop(0, `rgba(${rgb}, 0.14)`)
  g.addColorStop(1, 'transparent')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

/** Thin horizontal divider line */
export function drawDivider(ctx, y, w, alpha = 0.07) {
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(60, y)
  ctx.lineTo(w - 60, y)
  ctx.stroke()
}

/** Theme-aware divider */
export function drawCardDivider(ctx, y, w, c, pad = 36) {
  const grad = ctx.createLinearGradient(0, 0, w, 0)
  grad.addColorStop(0, 'transparent')
  grad.addColorStop(0.08, c.accentLow)
  grad.addColorStop(0.5, c.accentHigh)
  grad.addColorStop(0.92, c.accentLow)
  grad.addColorStop(1, 'transparent')
  ctx.fillStyle = grad
  ctx.fillRect(pad, y, w - pad * 2, 1)
}

/** Truncate string to fit maxWidth, appending ... */
export function truncateText(ctx, text, maxWidth) {
  if (!text) return ''
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 0 && ctx.measureText(t + '\u2026').width > maxWidth) t = t.slice(0, -1)
  return t + '\u2026'
}

/** Draw a rounded rectangle (ctx.roundRect polyfill) */
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

/** Draw a small pill badge (e.g. "24H", "BTC") */
export function drawPill(ctx, text, x, y, { bg = 'rgba(255,255,255,0.08)', color = 'rgba(255,255,255,0.7)', font = `600 13px ${FONT}`, paddingX = 14, paddingY = 6, radius = 8 } = {}) {
  ctx.font = font
  const tw = ctx.measureText(text).width
  const pw = tw + paddingX * 2
  const ph = 26

  roundRect(ctx, x, y - ph / 2, pw, ph, radius)
  ctx.fillStyle = bg
  ctx.fill()

  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.fillText(text, x + pw / 2, y + 5)

  return pw
}

/** Generate synthetic sparkline data from a change value */
export function generateSparkline(change, points = 24) {
  const data = []
  let v = 50
  const trend = (change || 0) >= 0 ? 1 : -1
  for (let i = 0; i < points; i++) {
    const p = i / (points - 1)
    v = Math.max(10, Math.min(90, 50 + trend * p * 22 + Math.sin(i * 0.9 + (change || 0)) * 7 + Math.cos(i * 1.4) * 4))
    data.push(v)
  }
  return data
}

/** Draw a mini sparkline chart */
export function drawSparkline(ctx, data, x, y, w, h, c, isUp) {
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const color = isUp ? c.bull : c.bear

  ctx.save()
  ctx.beginPath()
  for (let i = 0; i < data.length; i++) {
    const sx = x + (i / (data.length - 1)) * w
    const sy = y + h - ((data[i] - min) / range) * h
    i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy)
  }
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()

  // Fill under line
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x, y + h)
  ctx.closePath()
  const grad = ctx.createLinearGradient(0, y, 0, y + h)
  const bullFill = c.isLight ? 'rgba(5,150,105,0.12)' : 'rgba(52,211,153,0.12)'
  const bearFill = c.isLight ? 'rgba(220,38,38,0.12)' : 'rgba(248,113,113,0.12)'
  grad.addColorStop(0, isUp ? bullFill : bearFill)
  grad.addColorStop(1, 'transparent')
  ctx.fillStyle = grad
  ctx.fill()
  ctx.restore()
}

/** Draw text with column alignment */
export function drawAlignedText(ctx, text, col, y, font, color) {
  ctx.font = font
  ctx.fillStyle = color
  const tw = ctx.measureText(text).width
  let tx = col.x
  if (col.align === 'right') tx = col.x + col.w - tw
  else if (col.align === 'center') tx = col.x + (col.w - tw) / 2
  ctx.textAlign = 'left'
  ctx.fillText(text, tx, y)
}

/** Format large number to abbreviated string */
export function formatLargeNumber(n) {
  if (n == null || n === 0) return '$0'
  const abs = Math.abs(n)
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

export { FONT, FONT_MONO, CARD_W, CARD_PAD, CARD_SCALE, HEADER_H, FOOTER_H }
