const path = require('path')
const { createCanvas, loadImage } = require('@napi-rs/canvas')
const { THEMES } = require('./themes')

// Branded /start hero. Static content — rendered once, cached for the process lifetime.
const fs = require('fs')
const BUNDLED = path.resolve(__dirname, '../assets/spectre-logo.png')
const APP_ICON = path.resolve(__dirname, '../../../apps/research/public/icon-512x512.png')
const LOGO = fs.existsSync(BUNDLED) ? BUNDLED : APP_ICON
const W = 1600
const H = 900
const FONT = '"Helvetica Neue", "Arial", "DejaVu Sans", sans-serif'

let cached = null

function spacedText(ctx, text, x, y, spacing) {
  let cx = x
  for (const ch of text) {
    ctx.fillText(ch, cx, y)
    cx += ctx.measureText(ch).width + spacing
  }
  return cx - x - spacing
}

async function welcomeCard() {
  if (cached) return cached
  const t = THEMES.spectre
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, t.bgTop)
  bg.addColorStop(1, t.bgBottom)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // soft radial glow behind the logo
  const glow = ctx.createRadialGradient(W / 2, 320, 40, W / 2, 320, 420)
  glow.addColorStop(0, 'rgba(245, 241, 232, 0.10)')
  glow.addColorStop(1, 'rgba(245, 241, 232, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  try {
    const logo = await loadImage(LOGO)
    const size = 300
    ctx.drawImage(logo, (W - size) / 2, 120, size, size)
  } catch {
    /* logo missing — logotype below still carries the card */
  }

  ctx.fillStyle = t.text
  ctx.font = `800 76px ${FONT}`
  ctx.textAlign = 'left'
  const brand = 'SPECTRE AI'
  let bw = 0
  for (const ch of brand) bw += ctx.measureText(ch).width + 14
  spacedText(ctx, brand, (W - (bw - 14)) / 2, 540, 14)

  ctx.fillStyle = t.subtext
  ctx.font = `600 34px ${FONT}`
  const sub = 'INTELLIGENCE'
  let sw = 0
  for (const ch of sub) sw += ctx.measureText(ch).width + 20
  spacedText(ctx, sub, (W - (sw - 20)) / 2, 596, 20)

  ctx.fillStyle = t.subtext
  ctx.font = `500 30px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText('charts · scans · brain desk · X attention · alerts', W / 2, 668)

  // command chips
  const chips = ['/c btc — chart', '/x sol — scan', '/desk — brain', '/xd — X board']
  ctx.font = `600 26px ${FONT}`
  const gap = 24
  const widths = chips.map((c) => ctx.measureText(c).width + 48)
  const total = widths.reduce((a, b) => a + b, 0) + gap * (chips.length - 1)
  let x = (W - total) / 2
  for (let i = 0; i < chips.length; i++) {
    const w = widths[i]
    ctx.fillStyle = 'rgba(245, 241, 232, 0.07)'
    ctx.beginPath()
    ctx.roundRect ? ctx.roundRect(x, 716, w, 56, 14) : ctx.rect(x, 716, w, 56)
    ctx.fill()
    ctx.fillStyle = t.text
    ctx.fillText(chips[i], x + w / 2, 753)
    x += w + gap
  }

  ctx.fillStyle = t.watermark
  ctx.font = `600 24px ${FONT}`
  ctx.fillText('app.spectreai.io', W / 2, 848)
  ctx.textAlign = 'left'

  cached = canvas.toBuffer('image/png')
  return cached
}

module.exports = { welcomeCard }
