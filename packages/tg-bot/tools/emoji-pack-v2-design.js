// Spectre premium emoji pack v2 — 24 icons × {dark, light} variants.
// Bold filled geometry, gradient fills, glow (dark) / ink outline (light).
// Masters render at 200px (2x scale), pack files downscale to 100×100.
const fs = require('fs')
const { createCanvas } = require('@napi-rs/canvas')

const OUT = '/opt/spectre-tg-bot/assets/emoji-pack-v2'
const FONT = '"Helvetica Neue", "Arial", "DejaVu Sans", sans-serif'

const PAL = {
  gold: ['#ffe9a8', '#f5c542', '#9a6a00'],
  emerald: ['#b8ffd8', '#2ecc71', '#0b6b3a'],
  red: ['#ffb9b0', '#e74c3c', '#8a1f15'],
  cyan: ['#c9f3ff', '#38c7e8', '#0e5f80'],
  ice: ['#f0fbff', '#8fd8ff', '#2b6ea8'],
  fire: ['#ffd27d', '#ff7a3c', '#b91c1c'],
}
const INK = '#12151c'

function grad(x, colors, y0 = 14, y1 = 88) {
  const g = x.createLinearGradient(0, y0, 0, y1)
  g.addColorStop(0, colors[0])
  g.addColorStop(0.55, colors[1])
  g.addColorStop(1, colors[2])
  return g
}

// fill the current path with premium treatment for the mode
function paint(x, mode, colors, { glowBoost = 1 } = {}) {
  x.save()
  if (mode === 'dark') {
    x.shadowColor = colors[1]
    x.shadowBlur = 10 * glowBoost
  } else {
    x.shadowColor = 'rgba(0,0,0,0.22)'
    x.shadowBlur = 5
    x.shadowOffsetY = 2
  }
  x.fillStyle = grad(x, colors)
  x.fill()
  x.shadowBlur = 0
  x.shadowOffsetY = 0
  if (mode === 'light') {
    x.lineWidth = 4.5
    x.lineJoin = 'round'
    x.strokeStyle = INK
    x.stroke()
  } else {
    x.lineWidth = 2
    x.lineJoin = 'round'
    x.strokeStyle = 'rgba(255,255,255,0.35)'
    x.stroke()
  }
  x.restore()
}

// accent stroke/fill color that reads in both modes
const accent = (mode) => (mode === 'dark' ? 'rgba(255,255,255,0.92)' : INK)

const R = (x, ...a) => x.roundRect(...a)

const ICONS = {
  '01_new_buy': (x, m) => {
    x.beginPath()
    x.arc(50, 50, 35, 0, Math.PI * 2)
    paint(x, m, PAL.emerald)
    x.beginPath()
    x.moveTo(50, 28)
    x.lineTo(68, 50)
    x.lineTo(57, 50)
    x.lineTo(57, 70)
    x.lineTo(43, 70)
    x.lineTo(43, 50)
    x.lineTo(32, 50)
    x.closePath()
    x.fillStyle = accent(m)
    x.fill()
  },
  '02_new_sell': (x, m) => {
    x.beginPath()
    x.arc(50, 50, 35, 0, Math.PI * 2)
    paint(x, m, PAL.red)
    x.beginPath()
    x.moveTo(50, 72)
    x.lineTo(32, 50)
    x.lineTo(43, 50)
    x.lineTo(43, 30)
    x.lineTo(57, 30)
    x.lineTo(57, 50)
    x.lineTo(68, 50)
    x.closePath()
    x.fillStyle = accent(m)
    x.fill()
  },
  '03_amount': (x, m) => {
    for (const [i, cy] of [[0, 66], [1, 52], [2, 38]]) {
      x.beginPath()
      x.ellipse(50, cy, 28, 13, 0, 0, Math.PI * 2)
      paint(x, m, PAL.gold, { glowBoost: i === 2 ? 1 : 0.3 })
    }
    x.beginPath()
    x.ellipse(50, 36, 20, 8, 0, 0, Math.PI * 2)
    x.fillStyle = m === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.65)'
    x.fill()
  },
  '04_total_value': (x, m) => {
    x.beginPath()
    R(x, 16, 28, 68, 46, 9)
    paint(x, m, PAL.gold)
    x.fillStyle = m === 'dark' ? 'rgba(0,0,0,0.42)' : 'rgba(0,0,0,0.55)'
    x.fillRect(16, 38, 68, 9)
    x.beginPath()
    R(x, 24, 54, 15, 11, 3)
    x.fillStyle = accent(m)
    x.fill()
  },
  '05_price': (x, m) => {
    x.save()
    x.translate(50, 50)
    x.rotate(-Math.PI / 5)
    x.beginPath()
    x.moveTo(-32, -14)
    x.lineTo(12, -14)
    x.lineTo(32, 0)
    x.lineTo(12, 14)
    x.lineTo(-32, 14)
    x.closePath()
    // roundish tag left edge
    paint(x, m, PAL.gold)
    x.beginPath()
    x.arc(-22, 0, 5.5, 0, Math.PI * 2)
    x.fillStyle = accent(m)
    x.fill()
    x.restore()
  },
  '06_market_cap': (x, m) => {
    for (const [bx, by] of [[22, 54], [43, 42], [64, 28]]) {
      x.beginPath()
      R(x, bx, by, 14, 78 - by, 5)
      paint(x, m, PAL.gold, { glowBoost: 0.5 })
    }
    x.beginPath()
    x.moveTo(22, 40)
    x.lineTo(58, 22)
    x.lineTo(54, 36)
    x.moveTo(58, 22)
    x.lineTo(44, 24)
    x.strokeStyle = m === 'dark' ? PAL.emerald[1] : INK
    x.lineWidth = 6
    x.lineCap = 'round'
    x.lineJoin = 'round'
    x.stroke()
  },
  '07_liquidity': (x, m) => {
    x.beginPath()
    x.moveTo(50, 16)
    x.bezierCurveTo(50, 16, 24, 48, 24, 62)
    x.arc(50, 62, 26, Math.PI, 0, true)
    x.bezierCurveTo(76, 48, 50, 16, 50, 16)
    x.closePath()
    paint(x, m, PAL.cyan)
    x.beginPath()
    x.arc(41, 62, 6, 0, Math.PI * 2)
    x.fillStyle = 'rgba(255,255,255,0.7)'
    x.fill()
  },
  '08_volume': (x, m) => {
    for (const [i, h] of [[0, 26], [1, 46], [2, 62], [3, 40], [4, 22]]) {
      x.beginPath()
      R(x, 18 + i * 14, 50 - h / 2, 10, h, 5)
      paint(x, m, PAL.gold, { glowBoost: 0.4 })
    }
  },
  '09_momentum': (x, m) => {
    x.save()
    if (m === 'light') {
      x.lineWidth = 15
      x.strokeStyle = INK
      x.lineCap = 'round'
      x.lineJoin = 'round'
      pulse(x)
      x.stroke()
    }
    x.lineWidth = 9
    x.strokeStyle = grad(x, PAL.cyan)
    x.lineCap = 'round'
    x.lineJoin = 'round'
    if (m === 'dark') {
      x.shadowColor = PAL.cyan[1]
      x.shadowBlur = 10
    }
    pulse(x)
    x.stroke()
    x.restore()
  },
  '10_ai_score': (x, m) => {
    poly(x, 50, 50, 36, 6, -Math.PI / 2)
    paint(x, m, PAL.cyan)
    spark(x, 50, 50, 15, accent(m))
  },
  '11_ai_read': (x, m) => {
    x.beginPath()
    x.moveTo(50, 32)
    x.bezierCurveTo(40, 24, 26, 24, 18, 28)
    x.lineTo(18, 72)
    x.bezierCurveTo(26, 68, 40, 68, 50, 76)
    x.bezierCurveTo(60, 68, 74, 68, 82, 72)
    x.lineTo(82, 28)
    x.bezierCurveTo(74, 24, 60, 24, 50, 32)
    x.closePath()
    paint(x, m, PAL.gold)
    x.beginPath()
    x.moveTo(50, 32)
    x.lineTo(50, 76)
    x.strokeStyle = m === 'dark' ? 'rgba(0,0,0,0.4)' : INK
    x.lineWidth = 3.5
    x.stroke()
    spark(x, 50, 14, 9, m === 'dark' ? PAL.cyan[1] : INK)
  },
  '12_wallet': (x, m) => {
    x.beginPath()
    R(x, 16, 30, 68, 44, 10)
    paint(x, m, PAL.gold)
    x.beginPath()
    R(x, 60, 44, 24, 16, 7)
    x.fillStyle = m === 'dark' ? 'rgba(0,0,0,0.45)' : INK
    x.fill()
    x.beginPath()
    x.arc(72, 52, 4.5, 0, Math.PI * 2)
    x.fillStyle = m === 'dark' ? PAL.gold[0] : '#ffffff'
    x.fill()
  },
  '13_whale': (x, m) => {
    x.beginPath()
    x.moveTo(18, 56)
    x.bezierCurveTo(22, 38, 44, 30, 60, 34)
    x.bezierCurveTo(74, 37, 82, 46, 82, 54)
    x.bezierCurveTo(82, 62, 74, 68, 64, 68)
    x.lineTo(32, 68)
    x.bezierCurveTo(24, 68, 18, 62, 18, 56)
    x.closePath()
    paint(x, m, PAL.cyan)
    // tail
    x.beginPath()
    x.moveTo(78, 48)
    x.bezierCurveTo(84, 40, 86, 36, 86, 28)
    x.bezierCurveTo(92, 36, 92, 48, 84, 56)
    x.closePath()
    paint(x, m, PAL.cyan, { glowBoost: 0.3 })
    x.beginPath()
    x.arc(34, 50, 4, 0, Math.PI * 2)
    x.fillStyle = accent(m)
    x.fill()
  },
  '14_smart_money': (x, m) => {
    x.beginPath()
    x.moveTo(34, 26)
    x.lineTo(66, 26)
    x.lineTo(80, 44)
    x.lineTo(50, 80)
    x.lineTo(20, 44)
    x.closePath()
    paint(x, m, PAL.ice)
    x.beginPath()
    x.moveTo(20, 44)
    x.lineTo(80, 44)
    x.moveTo(34, 26)
    x.lineTo(44, 44)
    x.lineTo(50, 80)
    x.moveTo(66, 26)
    x.lineTo(56, 44)
    x.lineTo(50, 80)
    x.strokeStyle = m === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(18,21,28,0.6)'
    x.lineWidth = 2.5
    x.stroke()
  },
  '15_new_holder': (x, m) => {
    x.beginPath()
    x.arc(44, 34, 14, 0, Math.PI * 2)
    paint(x, m, PAL.gold)
    x.beginPath()
    x.moveTo(18, 78)
    x.bezierCurveTo(18, 58, 30, 52, 44, 52)
    x.bezierCurveTo(58, 52, 70, 58, 70, 78)
    x.closePath()
    paint(x, m, PAL.gold, { glowBoost: 0.4 })
    x.beginPath()
    x.arc(76, 34, 14, 0, Math.PI * 2)
    paint(x, m, PAL.emerald)
    x.beginPath()
    x.moveTo(76, 27)
    x.lineTo(76, 41)
    x.moveTo(69, 34)
    x.lineTo(83, 34)
    x.strokeStyle = '#ffffff'
    x.lineWidth = 5
    x.lineCap = 'round'
    x.stroke()
  },
  '16_contract': (x, m) => {
    x.beginPath()
    x.moveTo(28, 24)
    x.lineTo(60, 24)
    x.lineTo(74, 38)
    x.lineTo(74, 78)
    x.bezierCurveTo(74, 81, 71, 84, 68, 84)
    x.lineTo(34, 84)
    x.bezierCurveTo(31, 84, 28, 81, 28, 78)
    x.closePath()
    paint(x, m, PAL.gold)
    x.beginPath()
    x.moveTo(60, 24)
    x.lineTo(60, 38)
    x.lineTo(74, 38)
    x.fillStyle = m === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(18,21,28,0.55)'
    x.fill()
    x.fillStyle = m === 'dark' ? 'rgba(0,0,0,0.42)' : INK
    for (const ly of [48, 58, 68]) x.fillRect(36, ly, ly === 68 ? 20 : 30, 4.5)
  },
  '17_onchain': (x, m) => {
    x.save()
    x.translate(50, 50)
    x.rotate(-Math.PI / 6)
    for (const dx of [-15, 15]) {
      x.beginPath()
      R(x, dx - 16, -12, 32, 24, 12)
      x.lineWidth = 9
      x.strokeStyle = grad(x, PAL.gold, -12, 12)
      if (m === 'dark') {
        x.shadowColor = PAL.gold[1]
        x.shadowBlur = 8
      }
      x.stroke()
      x.shadowBlur = 0
      if (m === 'light') {
        x.lineWidth = 2.5
        x.strokeStyle = INK
        x.beginPath()
        R(x, dx - 20.5, -16.5, 41, 33, 16)
        x.stroke()
        x.beginPath()
        R(x, dx - 11.5, -7.5, 23, 15, 7.5)
        x.stroke()
      }
    }
    x.restore()
  },
  '18_lp_locked': (x, m) => {
    x.beginPath()
    x.arc(50, 42, 17, Math.PI, 0)
    x.lineWidth = 9
    x.strokeStyle = m === 'dark' ? 'rgba(255,255,255,0.75)' : INK
    x.stroke()
    x.beginPath()
    R(x, 24, 42, 52, 38, 9)
    paint(x, m, PAL.gold)
    x.beginPath()
    x.arc(50, 58, 6, 0, Math.PI * 2)
    x.fillStyle = m === 'dark' ? 'rgba(0,0,0,0.55)' : INK
    x.fill()
    x.fillRect(47, 60, 6, 12)
  },
  '19_renounced': (x, m) => {
    x.beginPath()
    x.moveTo(50, 14)
    x.bezierCurveTo(60, 21, 70, 23, 79, 23)
    x.bezierCurveTo(79, 52, 68, 72, 50, 85)
    x.bezierCurveTo(32, 72, 21, 52, 21, 23)
    x.bezierCurveTo(30, 23, 40, 21, 50, 14)
    x.closePath()
    paint(x, m, PAL.emerald)
    x.beginPath()
    x.moveTo(38, 50)
    x.lineTo(47, 60)
    x.lineTo(64, 39)
    x.strokeStyle = '#ffffff'
    x.lineWidth = 8
    x.lineCap = 'round'
    x.lineJoin = 'round'
    x.stroke()
  },
  '20_observation': (x, m) => {
    x.beginPath()
    x.moveTo(14, 50)
    x.bezierCurveTo(28, 30, 72, 30, 86, 50)
    x.bezierCurveTo(72, 70, 28, 70, 14, 50)
    x.closePath()
    paint(x, m, PAL.gold)
    x.beginPath()
    x.arc(50, 50, 13, 0, Math.PI * 2)
    x.fillStyle = m === 'dark' ? INK : '#ffffff'
    x.fill()
    if (m === 'light') {
      x.lineWidth = 3
      x.strokeStyle = INK
      x.stroke()
    }
    x.beginPath()
    x.arc(50, 50, 6, 0, Math.PI * 2)
    x.fillStyle = m === 'dark' ? PAL.cyan[1] : INK
    x.fill()
  },
  '21_narrative': (x, m) => {
    x.beginPath()
    x.moveTo(46, 18)
    x.bezierCurveTo(49, 38, 56, 45, 74, 48)
    x.bezierCurveTo(56, 51, 49, 58, 46, 78)
    x.bezierCurveTo(43, 58, 36, 51, 18, 48)
    x.bezierCurveTo(36, 45, 43, 38, 46, 18)
    x.closePath()
    paint(x, m, PAL.gold)
    spark(x, 76, 24, 10, m === 'dark' ? PAL.gold[0] : INK)
  },
  '22_scan': (x, m) => {
    x.beginPath()
    x.moveTo(62, 62)
    x.lineTo(80, 80)
    x.lineWidth = 13
    x.lineCap = 'round'
    x.strokeStyle = m === 'dark' ? 'rgba(255,255,255,0.8)' : INK
    x.stroke()
    x.beginPath()
    x.arc(44, 44, 24, 0, Math.PI * 2)
    paint(x, m, PAL.gold)
    x.beginPath()
    x.arc(44, 44, 13, 0, Math.PI * 2)
    x.fillStyle = m === 'dark' ? 'rgba(0,0,0,0.45)' : '#ffffff'
    x.fill()
    if (m === 'light') {
      x.lineWidth = 3
      x.strokeStyle = INK
      x.stroke()
    }
  },
  '23_catalyst': (x, m) => {
    x.beginPath()
    x.moveTo(52, 14)
    x.bezierCurveTo(58, 30, 74, 36, 74, 56)
    x.bezierCurveTo(74, 71, 63, 82, 50, 82)
    x.bezierCurveTo(37, 82, 26, 71, 26, 56)
    x.bezierCurveTo(26, 44, 36, 40, 39, 26)
    x.bezierCurveTo(43, 34, 49, 33, 52, 14)
    x.closePath()
    paint(x, m, PAL.fire)
    x.beginPath()
    x.moveTo(50, 46)
    x.bezierCurveTo(55, 54, 62, 57, 62, 66)
    x.bezierCurveTo(62, 74, 56, 78, 50, 78)
    x.bezierCurveTo(44, 78, 38, 74, 38, 66)
    x.bezierCurveTo(38, 59, 45, 54, 50, 46)
    x.closePath()
    x.fillStyle = m === 'dark' ? '#ffe9a8' : '#ffd27d'
    x.fill()
  },
  '24_high_conviction': (x, m) => {
    star(x, 50, 52, 36, 15, 5)
    paint(x, m, PAL.gold, { glowBoost: 1.4 })
  },
}

function pulse(x) {
  x.beginPath()
  x.moveTo(14, 56)
  x.lineTo(32, 56)
  x.lineTo(42, 32)
  x.lineTo(56, 74)
  x.lineTo(66, 50)
  x.lineTo(86, 50)
}
function poly(x, cx, cy, r, n, rot = 0) {
  x.beginPath()
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n
    i ? x.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)) : x.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
  }
  x.closePath()
}
function star(x, cx, cy, ro, ri, n) {
  x.beginPath()
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? ro : ri
    const a = -Math.PI / 2 + (i * Math.PI) / n
    i ? x.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)) : x.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
  }
  x.closePath()
}
function spark(x, cx, cy, r, color) {
  x.beginPath()
  x.moveTo(cx, cy - r)
  x.bezierCurveTo(cx + r * 0.15, cy - r * 0.15, cx + r * 0.15, cy - r * 0.15, cx + r, cy)
  x.bezierCurveTo(cx + r * 0.15, cy + r * 0.15, cx + r * 0.15, cy + r * 0.15, cx, cy + r)
  x.bezierCurveTo(cx - r * 0.15, cy + r * 0.15, cx - r * 0.15, cy + r * 0.15, cx - r, cy)
  x.bezierCurveTo(cx - r * 0.15, cy - r * 0.15, cx - r * 0.15, cy - r * 0.15, cx, cy - r)
  x.closePath()
  x.fillStyle = color
  x.fill()
}

const LABELS = {
  '01_new_buy': 'New Buy', '02_new_sell': 'New Sell', '03_amount': 'Amount', '04_total_value': 'Total Value',
  '05_price': 'Price', '06_market_cap': 'Market Cap', '07_liquidity': 'Liquidity', '08_volume': 'Volume',
  '09_momentum': 'Momentum', '10_ai_score': 'AI Score', '11_ai_read': 'AI Read', '12_wallet': 'Wallet',
  '13_whale': 'Whale', '14_smart_money': 'Smart Money', '15_new_holder': 'New Holder', '16_contract': 'Contract',
  '17_onchain': 'Onchain', '18_lp_locked': 'LP Locked', '19_renounced': 'Renounced', '20_observation': 'Observation',
  '21_narrative': 'Narrative', '22_scan': 'Scan', '23_catalyst': 'Catalyst', '24_high_conviction': 'High Conviction',
}

function renderIcon(slug, mode) {
  const c = createCanvas(200, 200)
  const x = c.getContext('2d')
  x.scale(2, 2)
  ICONS[slug](x, mode)
  return c
}

function main() {
  for (const mode of ['dark', 'light']) {
    fs.mkdirSync(`${OUT}/${mode}`, { recursive: true })
    const masters = {}
    for (const slug of Object.keys(ICONS)) {
      const master = renderIcon(slug, mode)
      masters[slug] = master
      const small = createCanvas(100, 100)
      small.getContext('2d').drawImage(master, 0, 0, 100, 100)
      fs.writeFileSync(`${OUT}/${mode}/${slug}.png`, small.toBuffer('image/png'))
    }
    // preview grid: 6×4, icons at 120px + label
    const COLS = 6
    const CELL = 176
    const W = COLS * CELL + 60
    const H = 4 * (CELL + 26) + 120
    const c = createCanvas(W, H)
    const x = c.getContext('2d')
    x.fillStyle = mode === 'dark' ? '#0b0e14' : '#f2f3f6'
    x.fillRect(0, 0, W, H)
    x.font = `800 40px ${FONT}`
    x.fillStyle = mode === 'dark' ? 'rgba(255,255,255,0.92)' : INK
    x.fillText(`Spectre Emoji Pack v2 — ${mode.toUpperCase()} chats`, 30, 62)
    Object.keys(ICONS).forEach((slug, i) => {
      const gx = 30 + (i % COLS) * CELL
      const gy = 100 + Math.floor(i / COLS) * (CELL + 26)
      x.drawImage(masters[slug], gx + 22, gy, 132, 132)
      x.font = `600 20px ${FONT}`
      x.fillStyle = mode === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(18,21,28,0.7)'
      const tw = x.measureText(LABELS[slug]).width
      x.fillText(LABELS[slug], gx + (CELL - tw) / 2, gy + 158)
    })
    fs.writeFileSync(`${OUT}/preview-${mode}.png`, c.toBuffer('image/png'))
  }
  console.log('rendered 48 icons + 2 previews →', OUT)
}
main()
