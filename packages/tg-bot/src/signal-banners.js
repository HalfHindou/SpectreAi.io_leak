// Branded category banners for signal cards. Every alert ships as a photo
// card: token banner from DexScreener when the team uploaded one, otherwise
// one of these. Categories with studio art in assets/signal-banners/ use it;
// the rest fall back to the rendered dark-glass canvas. Either way the image
// is loaded once per category per process; after the first send the Telegram
// file_id is reused so the upload cost is paid exactly once.
const fs = require('fs')
const path = require('path')
const { createCanvas, loadImage } = require('@napi-rs/canvas')
const { THEMES } = require('./themes')

const LOGO = path.resolve(__dirname, '../assets/spectre-logo.png')
const ART_DIR = path.resolve(__dirname, '../assets/signal-banners')
const W = 1200
const H = 400
const FONT = '"Helvetica Neue", "Arial", "DejaVu Sans", sans-serif'

const CAT_STYLE = {
  breaking: { title: 'BREAKING', accent: '#f6465d' },
  runners: { title: 'DEGEN RUNNER', accent: '#8b5cf6' },
  social: { title: 'SOCIAL SURGE', accent: '#38bdf8' },
  brain: { title: 'AI DESK CALL', accent: '#c9a0f0' },
  risk: { title: 'RISK ALERT', accent: '#fb923c' },
  stocks: { title: 'EQUITY EVENT', accent: '#2ebd85' },
  data: { title: 'DATA SIGNAL', accent: '#6aa2f7' },
  pulse: { title: 'MARKET PULSE', accent: '#e8c268' },
}

const buffers = new Map()
const fileIds = new Map()

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

function spaced(ctx, text, x, y, gap) {
  let cx = x
  for (const ch of text) {
    ctx.fillText(ch, cx, y)
    cx += ctx.measureText(ch).width + gap
  }
  return cx - x - gap
}

function measureSpaced(ctx, text, gap) {
  let w = 0
  for (const ch of text) w += ctx.measureText(ch).width + gap
  return w - gap
}

async function categoryBanner(cat) {
  const key = CAT_STYLE[cat] ? cat : 'pulse'
  if (buffers.has(key)) return buffers.get(key)
  // studio art beats the rendered banner whenever the asset exists
  try {
    const art = fs.readFileSync(path.join(ART_DIR, `${key}.png`))
    buffers.set(key, art)
    return art
  } catch { /* no art for this category — render the canvas banner */ }
  const s = CAT_STYLE[key]
  const t = THEMES.spectre
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, t.bgTop)
  bg.addColorStop(1, t.bgBottom)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // fine grid, brand-faint
  ctx.strokeStyle = t.grid
  ctx.lineWidth = 1
  for (let x = 0.5; x <= W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
  for (let y = 0.5; y <= H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

  // accent atmosphere: radial glow left, hairline horizon behind the title
  const glow = ctx.createRadialGradient(180, H / 2, 20, 180, H / 2, 520)
  glow.addColorStop(0, hexA(s.accent, 0.26))
  glow.addColorStop(1, hexA(s.accent, 0))
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // faint phoenix, right side
  try {
    const logo = await loadImage(LOGO)
    ctx.globalAlpha = 0.12
    const size = 380
    ctx.drawImage(logo, W - size - 40, (H - size) / 2, size, size)
    ctx.globalAlpha = 1
  } catch { /* logotype alone still carries the banner */ }

  // kicker
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = `600 26px ${FONT}`
  ctx.fillStyle = t.subtext
  spaced(ctx, 'SPECTRE INTELLIGENCE', 92, 150, 12)

  // title + accent underbar sized to the type
  ctx.font = `800 86px ${FONT}`
  ctx.fillStyle = t.text
  const tw = spaced(ctx, s.title, 90, 252, 6)
  const bar = ctx.createLinearGradient(90, 0, 90 + tw, 0)
  bar.addColorStop(0, s.accent)
  bar.addColorStop(1, hexA(s.accent, 0))
  ctx.fillStyle = bar
  ctx.fillRect(90, 286, tw, 7)

  // live tick, bottom left
  ctx.font = `600 24px ${FONT}`
  ctx.fillStyle = hexA(s.accent, 0.9)
  ctx.beginPath()
  ctx.arc(101, 341, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = t.subtext
  spaced(ctx, 'LIVE SIGNAL', 122, 350, 8)

  // bottom accent edge
  const edge = ctx.createLinearGradient(0, 0, W, 0)
  edge.addColorStop(0, hexA(s.accent, 0.85))
  edge.addColorStop(0.6, hexA(s.accent, 0.15))
  edge.addColorStop(1, hexA(s.accent, 0))
  ctx.fillStyle = edge
  ctx.fillRect(0, H - 4, W, 4)

  const buf = canvas.toBuffer('image/png')
  buffers.set(key, buf)
  return buf
}

const cachedFileId = (cat) => fileIds.get(CAT_STYLE[cat] ? cat : 'pulse') || null
const rememberFileId = (cat, id) => { if (id) fileIds.set(CAT_STYLE[cat] ? cat : 'pulse', id) }

module.exports = { categoryBanner, cachedFileId, rememberFileId, measureSpaced }
