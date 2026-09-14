/**
 * Welcome Renderer — Branded /start landing card.
 * Only canvas-rendered image in the bot. Everything else is live app screenshots.
 */

const { createCanvas } = require('@napi-rs/canvas')

const W = 900
const H = 1100
const PAD = 40

const COMMANDS = [
  { cmd: '/gm',          desc: 'GM Dashboard' },
  { cmd: '/price BTC',   desc: 'Token research page' },
  { cmd: '/heatmap',     desc: 'Crypto heatmaps' },
  { cmd: '/liquidation', desc: 'Liquidation heatmap' },
  { cmd: '/news',        desc: 'News feed' },
  { cmd: '/feargreed',   desc: 'Fear & Greed index' },
  { cmd: '/market',      desc: 'Market overview' },
  { cmd: '/trending',    desc: 'Trending & discovery' },
  { cmd: '/brief',       desc: 'AI market brief' },
  { cmd: '/sectors',     desc: 'Sector performance' },
  { cmd: '/flows',       desc: 'Exchange flows' },
  { cmd: '/bubbles',     desc: 'Crypto bubbles' },
  { cmd: '/calendar',    desc: 'Economic calendar' },
  { cmd: '/categories',  desc: 'Token categories' },
  { cmd: '/mindshare',   desc: 'Mindshare metrics' },
  { cmd: '/wallets',     desc: 'Whale wallets' },
  { cmd: '/app [page]',  desc: 'Screenshot any page' },
]

async function renderWelcome() {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  // ── Background ──
  ctx.fillStyle = '#09090b'
  ctx.fillRect(0, 0, W, H)

  const glow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.7)
  glow.addColorStop(0, 'rgba(245, 245, 247, 0.04)')
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H / 2)

  // ── Top accent line ──
  const lineGrad = ctx.createLinearGradient(PAD, 0, W - PAD, 0)
  lineGrad.addColorStop(0, 'rgba(245, 245, 247, 0)')
  lineGrad.addColorStop(0.3, 'rgba(245, 245, 247, 0.15)')
  lineGrad.addColorStop(0.7, 'rgba(245, 245, 247, 0.15)')
  lineGrad.addColorStop(1, 'rgba(245, 245, 247, 0)')
  ctx.fillStyle = lineGrad
  ctx.fillRect(PAD, 50, W - PAD * 2, 1)

  // ── Logo ──
  ctx.fillStyle = '#f5f5f7'
  ctx.font = '700 52px -apple-system, BlinkMacSystemFont, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('SPECTRE', W / 2, 120)

  ctx.fillStyle = 'rgba(245, 245, 247, 0.4)'
  ctx.font = '300 16px -apple-system, BlinkMacSystemFont, sans-serif'
  ctx.fillText('C R Y P T O   I N T E L L I G E N C E', W / 2, 155)

  // ── Tagline ──
  ctx.fillStyle = 'rgba(245, 245, 247, 0.55)'
  ctx.font = '400 16px -apple-system, BlinkMacSystemFont, sans-serif'
  ctx.fillText('Every response is a live screenshot from the Spectre app.', W / 2, 200)

  // ── Divider ──
  const divY = 235
  ctx.fillStyle = lineGrad
  ctx.fillRect(PAD + 80, divY, W - PAD * 2 - 160, 1)

  ctx.fillStyle = 'rgba(245, 245, 247, 0.3)'
  ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('COMMANDS', W / 2, divY + 28)

  // ── Command Grid ──
  const gridTop = divY + 48
  const cardW = (W - PAD * 2 - 16) / 2
  const cardH = 44
  const gap = 8

  COMMANDS.forEach((item, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const cx = PAD + col * (cardW + 16)
    const cy = gridTop + row * (cardH + gap)

    // Card
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)'
    roundRect(ctx, cx, cy, cardW, cardH, 10)
    ctx.fill()

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)'
    ctx.lineWidth = 1
    roundRect(ctx, cx, cy, cardW, cardH, 10)
    ctx.stroke()

    // Command
    ctx.textAlign = 'left'
    ctx.fillStyle = '#f5f5f7'
    ctx.font = '600 13px "JetBrains Mono", monospace'
    ctx.fillText(item.cmd, cx + 14, cy + 19)

    // Desc
    ctx.fillStyle = 'rgba(245, 245, 247, 0.35)'
    ctx.font = '400 11px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.fillText(item.desc, cx + 14, cy + 35)
  })

  // ── Footer ──
  ctx.fillStyle = 'rgba(245, 245, 247, 0.12)'
  ctx.font = '400 11px -apple-system, BlinkMacSystemFont, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('spectreai.io — Real UI, real-time data', W / 2, H - 20)

  return canvas.toBuffer('image/png')
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

module.exports = { renderWelcome }
