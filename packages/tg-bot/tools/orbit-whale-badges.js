// draw Orbit-style whale + new-holder badges (steel disc, orbit ring, navy glyph)
const fs = require('fs')
const { createCanvas } = require('@napi-rs/canvas')
const OUT = '/opt/spectre-tg-bot/assets/emoji-pack-orbit-hd'

function badgeBase(x) {
  // steel disc
  const disc = x.createRadialGradient(43, 40, 6, 50, 50, 50)
  disc.addColorStop(0, '#ffffff')
  disc.addColorStop(0.55, '#eef1f5')
  disc.addColorStop(0.85, '#cfd6de')
  disc.addColorStop(1, '#b7bfc9')
  x.beginPath()
  x.arc(50, 50, 47, 0, Math.PI * 2)
  x.fillStyle = disc
  x.fill()
  x.lineWidth = 2.6
  x.strokeStyle = '#39404d'
  x.stroke()
  // orbit ring + satellite dots
  x.save()
  x.translate(50, 50)
  x.rotate(-0.42)
  x.beginPath()
  x.ellipse(0, 0, 44, 27, 0, 0, Math.PI * 2)
  x.lineWidth = 1.7
  x.strokeStyle = 'rgba(45,52,66,0.8)'
  x.stroke()
  for (const a of [0.55, 2.4, 4.35]) {
    x.beginPath()
    x.arc(44 * Math.cos(a), 27 * Math.sin(a), 3, 0, Math.PI * 2)
    x.fillStyle = '#2d3442'
    x.fill()
    x.lineWidth = 1.2
    x.strokeStyle = '#ffffff'
    x.stroke()
  }
  x.restore()
}

const navy = (x) => {
  const g = x.createLinearGradient(0, 30, 0, 74)
  g.addColorStop(0, '#2b3850')
  g.addColorStop(1, '#141b28')
  return g
}

function whale(x) {
  badgeBase(x)
  // body
  x.beginPath()
  x.moveTo(24, 56)
  x.bezierCurveTo(27, 42, 43, 36, 55, 39)
  x.bezierCurveTo(65, 41, 71, 48, 71, 54)
  x.bezierCurveTo(71, 60, 65, 64, 58, 64)
  x.lineTo(34, 64)
  x.bezierCurveTo(28, 64, 24, 61, 24, 56)
  x.closePath()
  x.fillStyle = navy(x)
  x.fill()
  // tail (flipped up-right)
  x.beginPath()
  x.moveTo(68, 50)
  x.bezierCurveTo(72, 44, 74, 41, 74, 35)
  x.bezierCurveTo(79, 41, 79, 50, 73, 56)
  x.closePath()
  x.fillStyle = navy(x)
  x.fill()
  // spout
  x.beginPath()
  x.moveTo(33, 38)
  x.bezierCurveTo(31, 33, 29, 31, 26, 30)
  x.moveTo(33, 38)
  x.bezierCurveTo(34, 33, 36, 30, 39, 29)
  x.lineWidth = 2.6
  x.lineCap = 'round'
  x.strokeStyle = '#2d3442'
  x.stroke()
  // eye
  x.beginPath()
  x.arc(33, 52, 2.4, 0, Math.PI * 2)
  x.fillStyle = '#ffffff'
  x.fill()
}

function newHolder(x) {
  badgeBase(x)
  // head + shoulders
  x.beginPath()
  x.arc(46, 40, 10, 0, Math.PI * 2)
  x.fillStyle = navy(x)
  x.fill()
  x.beginPath()
  x.moveTo(28, 68)
  x.bezierCurveTo(28, 54, 36, 50, 46, 50)
  x.bezierCurveTo(56, 50, 64, 54, 64, 68)
  x.closePath()
  x.fillStyle = navy(x)
  x.fill()
  // plus badge
  x.beginPath()
  x.arc(66, 42, 10, 0, Math.PI * 2)
  x.fillStyle = '#2d3442'
  x.fill()
  x.lineWidth = 1.6
  x.strokeStyle = '#ffffff'
  x.stroke()
  x.beginPath()
  x.moveTo(66, 37)
  x.lineTo(66, 47)
  x.moveTo(61, 42)
  x.lineTo(71, 42)
  x.lineWidth = 2.8
  x.lineCap = 'round'
  x.strokeStyle = '#ffffff'
  x.stroke()
}

for (const [name, draw] of [['13_whale_orbit', whale], ['15_new_holder_orbit', newHolder]]) {
  const master = createCanvas(200, 200)
  const mx = master.getContext('2d')
  mx.scale(2, 2)
  draw(mx)
  const small = createCanvas(100, 100)
  small.getContext('2d').drawImage(master, 0, 0, 100, 100)
  fs.writeFileSync(`${OUT}/${name}.png`, small.toBuffer('image/png'))
}
console.log('badges written')
