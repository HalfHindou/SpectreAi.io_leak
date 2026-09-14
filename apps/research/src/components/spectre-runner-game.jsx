/**
 * Spectre Runner – Chrome Dino-style endless runner with the Spectre logo.
 * Canvas-based for smooth 60fps rendering. Retina-aware.
 */
import React, { useRef, useEffect, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import './spectre-runner-game.css'

/* ── constants ──────────────────────────────────────────── */
const W = 980           // canvas logical width
const H = 340           // canvas logical height
const GROUND_Y = 278    // ground line y
const GRAVITY = 0.42
const JUMP_VEL = -12.5
const INITIAL_SPEED = 3.5
const MAX_SPEED = 10
const SPEED_INC = 0.0004
const PLAYER_SIZE = 48
const PLAYER_X = 80
const CLOUD_COUNT = 6
const STAR_COUNT = 40
const MIN_SPAWN_DIST = 280  // min distance between obstacles (easy!)
const COIN_CHANCE = 0.35    // chance to spawn a coin after an obstacle

/* ── draw helpers ───────────────────────────────────────── */

// single bearish candle
function drawSmallCandle(ctx, x, y, w, h) {
  const cw = w * 0.55
  const cx = x + (w - cw) / 2
  ctx.fillStyle = 'rgba(239, 68, 68, 0.35)'
  ctx.fillRect(cx + cw / 2 - 1, y - h * 0.3, 2, h * 0.3)
  ctx.fillRect(cx + cw / 2 - 1, y + h, 2, h * 0.2)
  const grad = ctx.createLinearGradient(cx, y, cx, y + h)
  grad.addColorStop(0, 'rgba(239, 68, 68, 0.85)')
  grad.addColorStop(1, 'rgba(185, 28, 28, 0.7)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.roundRect(cx, y, cw, h, 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
  ctx.fillRect(cx + 1, y + 1, cw * 0.3, h - 2)
}

// double bearish candle cluster
function drawDoubleCandle(ctx, x, y, w, h) {
  const cw = w * 0.35
  const gap = 6
  const lx = x
  ctx.fillStyle = 'rgba(239, 68, 68, 0.3)'
  ctx.fillRect(lx + cw / 2 - 1, y - h * 0.25, 2, h * 0.25)
  ctx.fillRect(lx + cw / 2 - 1, y + h, 2, h * 0.12)
  const g1 = ctx.createLinearGradient(lx, y, lx, y + h)
  g1.addColorStop(0, 'rgba(239, 68, 68, 0.8)')
  g1.addColorStop(1, 'rgba(185, 28, 28, 0.65)')
  ctx.fillStyle = g1
  ctx.beginPath()
  ctx.roundRect(lx, y, cw, h, 2)
  ctx.fill()
  const rh = h * 0.65
  const ry = y + (h - rh)
  const rx = lx + cw + gap
  ctx.fillStyle = 'rgba(239, 68, 68, 0.3)'
  ctx.fillRect(rx + cw / 2 - 1, ry - rh * 0.18, 2, rh * 0.18)
  const g2 = ctx.createLinearGradient(rx, ry, rx, ry + rh)
  g2.addColorStop(0, 'rgba(220, 50, 50, 0.7)')
  g2.addColorStop(1, 'rgba(160, 20, 20, 0.6)')
  ctx.fillStyle = g2
  ctx.beginPath()
  ctx.roundRect(rx, ry, cw, rh, 2)
  ctx.fill()
}

// flying bear token
function drawBear(ctx, x, y, w, h, frame) {
  ctx.save()
  ctx.translate(x + w / 2, y + h / 2)
  const bob = Math.sin(frame * 0.12) * 4
  ctx.translate(0, bob)
  ctx.rotate(Math.sin(frame * 0.06) * 0.12)
  const s = w * 0.42
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, s)
  grad.addColorStop(0, 'rgba(251, 191, 36, 0.9)')
  grad.addColorStop(1, 'rgba(217, 119, 6, 0.55)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.moveTo(0, -s)
  ctx.lineTo(s, 0)
  ctx.lineTo(0, s)
  ctx.lineTo(-s, 0)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
  ctx.beginPath()
  ctx.moveTo(0, -s * 0.5)
  ctx.lineTo(s * 0.3, 0)
  ctx.lineTo(0, s * 0.2)
  ctx.lineTo(-s * 0.3, 0)
  ctx.closePath()
  ctx.fill()
  ctx.shadowColor = 'rgba(251, 191, 36, 0.25)'
  ctx.shadowBlur = 8
  ctx.beginPath()
  ctx.arc(0, 0, 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.restore()
}

// collectible green coin
function drawCoin(ctx, x, y, w, h, frame) {
  ctx.save()
  const cx = x + w / 2
  const cy = y + h / 2
  const r = w * 0.4
  const bob = Math.sin(frame * 0.1 + x * 0.01) * 3
  ctx.translate(0, bob)
  // glow
  ctx.shadowColor = 'rgba(34, 197, 94, 0.4)'
  ctx.shadowBlur = 12
  const grad = ctx.createRadialGradient(cx - 2, cy - 2, 0, cx, cy, r)
  grad.addColorStop(0, 'rgba(74, 222, 128, 0.95)')
  grad.addColorStop(1, 'rgba(22, 163, 74, 0.8)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0
  // $ symbol
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.font = `bold ${Math.round(r * 1.1)}px "SF Pro Display", Inter, system-ui`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('$', cx, cy + 1)
  ctx.textAlign = 'start'
  ctx.textBaseline = 'alphabetic'
  // ring
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

const OBSTACLE_DEFS = [
  { type: 'small', w: 20, h: 36, draw: drawSmallCandle, weight: 4 },
  { type: 'double', w: 44, h: 46, draw: drawDoubleCandle, weight: 3 },
  { type: 'bear', w: 28, h: 28, draw: drawBear, flying: true, weight: 1 },
]

function pickObstacle(score) {
  // only small candles for first 5 points, then add variety
  const available = score < 5
    ? OBSTACLE_DEFS.filter(o => o.type === 'small')
    : score < 15
      ? OBSTACLE_DEFS.filter(o => o.type !== 'bear')
      : OBSTACLE_DEFS
  const total = available.reduce((s, o) => s + o.weight, 0)
  let r = Math.random() * total
  for (const def of available) {
    r -= def.weight
    if (r <= 0) return def
  }
  return available[0]
}

/* ── component ──────────────────────────────────────────── */
export default function SpectreRunnerGame({ onClose }) {
  const { t } = useTranslation()
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const stateRef = useRef(null)
  const logoRef = useRef(null)
  const rafRef = useRef(null)
  const [score, setScore] = useState(0)
  const [hi, setHi] = useState(() => {
    // Silent: localStorage may be unavailable in private browsing - default to 0
    try { return parseInt(localStorage.getItem('spectre-runner-hi') || '0', 10) } catch { return 0 }
  })

  /* ── init game state ────────────────────────────────── */
  const initState = useCallback(() => {
    const clouds = Array.from({ length: CLOUD_COUNT }, (_, i) => ({
      x: (W / CLOUD_COUNT) * i + Math.random() * 140,
      y: 20 + Math.random() * 70,
      w: 50 + Math.random() * 50,
      h: 6 + Math.random() * 5,
      speed: 0.12 + Math.random() * 0.12,
    }))
    const stars = Array.from({ length: STAR_COUNT }, () => ({
      x: Math.random() * W,
      y: Math.random() * (GROUND_Y - 50),
      size: 0.5 + Math.random() * 1.5,
      twinkle: Math.random() * Math.PI * 2,
      speed: 0.02 + Math.random() * 0.03,
    }))
    const chartPoints = []
    for (let px = 0; px < W + 300; px += 8) {
      chartPoints.push(GROUND_Y + 10 + Math.sin(px * 0.025) * 6 + Math.sin(px * 0.07) * 3 + Math.random() * 3)
    }
    return {
      playing: false,
      gameOver: false,
      playerY: GROUND_Y - PLAYER_SIZE,
      velY: 0,
      jumping: false,
      speed: INITIAL_SPEED,
      obstacles: [],
      coins: [],
      clouds,
      stars,
      chartPoints,
      groundOffset: 0,
      chartOffset: 0,
      score: 0,
      frame: 0,
      distSinceLastObstacle: 300,
      particles: [],
      milestoneFlash: 0,
      coinFlash: 0,
      screenShake: 0,
    }
  }, [])

  /* ── jump ───────────────────────────────────────────── */
  const jump = useCallback(() => {
    const s = stateRef.current
    if (!s) return
    if (s.gameOver) {
      stateRef.current = initState()
      stateRef.current.playing = true
      setScore(0)
      return
    }
    if (!s.playing) {
      s.playing = true
      return
    }
    if (!s.jumping) {
      s.velY = JUMP_VEL
      s.jumping = true
      for (let i = 0; i < 5; i++) {
        s.particles.push({
          x: PLAYER_X + PLAYER_SIZE / 2,
          y: GROUND_Y,
          vx: (Math.random() - 0.5) * 2.5,
          vy: -Math.random() * 2.5 - 0.5,
          life: 18 + Math.random() * 12,
          maxLife: 30,
          size: 2 + Math.random() * 2,
          color: 'purple',
        })
      }
    }
  }, [initState])

  /* ── load logo ──────────────────────────────────────── */
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = '/round-logo.png'
    img.onload = () => { logoRef.current = img }
    img.onerror = () => {
      const img2 = new Image()
      img2.src = '/spectre-logo-dark.png'
      img2.onload = () => { logoRef.current = img2 }
    }
  }, [])

  /* ── game loop ──────────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = W * dpr
    canvas.height = H * dpr
    canvas.style.width = W + 'px'
    canvas.style.height = H + 'px'
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    stateRef.current = initState()

    function spawnObstacle(s) {
      const template = pickObstacle(s.score)
      const y = template.flying
        ? GROUND_Y - template.h - 35 - Math.random() * 30
        : GROUND_Y - template.h
      s.obstacles.push({ ...template, x: W + 40, y, scored: false })
      s.distSinceLastObstacle = 0
      // maybe spawn a coin after the obstacle
      if (Math.random() < COIN_CHANCE) {
        const coinX = W + 40 + template.w + 60 + Math.random() * 80
        s.coins.push({
          x: coinX,
          y: GROUND_Y - 50 - Math.random() * 40,
          w: 22,
          h: 22,
          collected: false,
        })
      }
    }

    function update(s) {
      s.frame++

      for (const star of s.stars) {
        star.twinkle += star.speed
      }

      if (s.screenShake > 0) s.screenShake--
      if (s.coinFlash > 0) s.coinFlash--

      if (!s.playing || s.gameOver) return

      s.speed = Math.min(MAX_SPEED, s.speed + SPEED_INC)
      s.groundOffset = (s.groundOffset + s.speed) % 24
      s.chartOffset += s.speed
      s.distSinceLastObstacle += s.speed

      if (s.milestoneFlash > 0) s.milestoneFlash--

      // clouds
      for (const c of s.clouds) {
        c.x -= s.speed * c.speed
        if (c.x + c.w < -20) {
          c.x = W + 20 + Math.random() * 100
          c.y = 20 + Math.random() * 70
        }
      }

      // particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i]
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.12
        p.life--
        if (p.life <= 0) s.particles.splice(i, 1)
      }

      // player physics
      s.velY += GRAVITY
      s.playerY += s.velY
      if (s.playerY >= GROUND_Y - PLAYER_SIZE) {
        s.playerY = GROUND_Y - PLAYER_SIZE
        s.velY = 0
        s.jumping = false
      }

      // spawn obstacles — generous gap that slowly tightens
      const gapThreshold = Math.max(180, MIN_SPAWN_DIST - s.speed * 5)
      if (s.distSinceLastObstacle > gapThreshold + Math.random() * 120) {
        spawnObstacle(s)
      }

      // update obstacles
      for (let i = s.obstacles.length - 1; i >= 0; i--) {
        const o = s.obstacles[i]
        o.x -= s.speed
        if (o.x + o.w < -30) { s.obstacles.splice(i, 1); continue }

        if (!o.scored && o.x + o.w < PLAYER_X) {
          o.scored = true
          s.score++
          if (s.score % 10 === 0) s.milestoneFlash = 35
        }

        // collision — very generous hitbox padding
        const pad = 11
        const px = PLAYER_X + pad
        const py = s.playerY + pad
        const pw = PLAYER_SIZE - pad * 2
        const ph = PLAYER_SIZE - pad * 2
        if (px < o.x + o.w - 3 && px + pw > o.x + 3 && py < o.y + o.h - 3 && py + ph > o.y + 3) {
          s.gameOver = true
          s.playing = false
          s.screenShake = 12
          for (let j = 0; j < 14; j++) {
            s.particles.push({
              x: PLAYER_X + PLAYER_SIZE / 2,
              y: s.playerY + PLAYER_SIZE / 2,
              vx: (Math.random() - 0.5) * 7,
              vy: (Math.random() - 0.5) * 7,
              life: 25 + Math.random() * 20,
              maxLife: 45,
              size: 2 + Math.random() * 3,
              color: 'red',
            })
          }
          if (s.score > hi) {
            setHi(s.score)
            // Silent: localStorage may be unavailable in private browsing - non-critical
            try { localStorage.setItem('spectre-runner-hi', String(s.score)) } catch {}
          }
        }
      }

      // update coins
      for (let i = s.coins.length - 1; i >= 0; i--) {
        const c = s.coins[i]
        c.x -= s.speed
        if (c.x + c.w < -20) { s.coins.splice(i, 1); continue }
        if (c.collected) continue
        // coin collision — generous
        const pad = 4
        const px = PLAYER_X + pad
        const py = s.playerY + pad
        const pw = PLAYER_SIZE - pad * 2
        const ph = PLAYER_SIZE - pad * 2
        if (px < c.x + c.w && px + pw > c.x && py < c.y + c.h && py + ph > c.y) {
          c.collected = true
          s.score += 3
          s.coinFlash = 20
          for (let j = 0; j < 8; j++) {
            s.particles.push({
              x: c.x + c.w / 2,
              y: c.y + c.h / 2,
              vx: (Math.random() - 0.5) * 4,
              vy: (Math.random() - 0.5) * 4,
              life: 20 + Math.random() * 15,
              maxLife: 35,
              size: 2 + Math.random() * 2,
              color: 'green',
            })
          }
        }
      }

      setScore(s.score)
    }

    function draw(s) {
      ctx.save()

      // screen shake
      if (s.screenShake > 0) {
        const sx = (Math.random() - 0.5) * s.screenShake * 0.8
        const sy = (Math.random() - 0.5) * s.screenShake * 0.8
        ctx.translate(sx, sy)
      }

      ctx.clearRect(-10, -10, W + 20, H + 20)

      // background
      const bg = ctx.createLinearGradient(0, 0, 0, H)
      bg.addColorStop(0, '#060610')
      bg.addColorStop(0.5, '#0a0a16')
      bg.addColorStop(1, '#08080e')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)

      // stars
      for (const star of s.stars) {
        const alpha = 0.12 + Math.sin(star.twinkle) * 0.1
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
        ctx.beginPath()
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2)
        ctx.fill()
      }

      // clouds
      for (const c of s.clouds) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.025)'
        ctx.beginPath()
        ctx.ellipse(c.x + c.w / 2, c.y, c.w / 2, c.h, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.ellipse(c.x + c.w * 0.3, c.y + 2, c.w * 0.28, c.h * 0.6, 0, 0, Math.PI * 2)
        ctx.fill()
      }

      // chart silhouette (below ground)
      ctx.save()
      ctx.globalAlpha = 0.05
      ctx.beginPath()
      const startIdx = Math.floor(s.chartOffset / 8) % s.chartPoints.length
      for (let i = 0; i < Math.ceil(W / 8) + 2; i++) {
        const idx = (startIdx + i) % s.chartPoints.length
        const px = i * 8 - (s.chartOffset % 8)
        const py = s.chartPoints[idx]
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.lineTo(W, H)
      ctx.lineTo(0, H)
      ctx.closePath()
      ctx.fillStyle = 'rgba(139, 92, 246, 1)'
      ctx.fill()
      ctx.restore()

      // ground line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, GROUND_Y + 0.5)
      ctx.lineTo(W, GROUND_Y + 0.5)
      ctx.stroke()

      // ground texture
      ctx.fillStyle = 'rgba(255, 255, 255, 0.035)'
      for (let gx = -s.groundOffset; gx < W; gx += 24) {
        ctx.fillRect(gx, GROUND_Y + 5, 10, 1)
      }
      for (let gx = -s.groundOffset * 0.6; gx < W; gx += 50) {
        ctx.fillRect(gx + 12, GROUND_Y + 10, 6, 1)
      }

      // obstacles
      for (const o of s.obstacles) {
        if (o.flying) {
          o.draw(ctx, o.x, o.y, o.w, o.h, s.frame)
        } else {
          o.draw(ctx, o.x, o.y, o.w, o.h)
        }
      }

      // coins
      for (const c of s.coins) {
        if (!c.collected) {
          drawCoin(ctx, c.x, c.y, c.w, c.h, s.frame)
        }
      }

      // particles
      for (const p of s.particles) {
        const alpha = p.life / p.maxLife
        const color = p.color === 'green'
          ? `rgba(74, 222, 128, ${alpha * 0.8})`
          : p.color === 'red'
            ? `rgba(239, 68, 68, ${alpha * 0.7})`
            : `rgba(139, 92, 246, ${alpha * 0.7})`
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2)
        ctx.fill()
      }

      // player shadow on ground
      const py = s.playerY
      if (py < GROUND_Y - PLAYER_SIZE) {
        const shadowScale = 1 - (GROUND_Y - PLAYER_SIZE - py) / 140
        if (shadowScale > 0) {
          ctx.fillStyle = `rgba(139, 92, 246, ${shadowScale * 0.07})`
          ctx.beginPath()
          ctx.ellipse(PLAYER_X + PLAYER_SIZE / 2, GROUND_Y + 3, PLAYER_SIZE * 0.38 * shadowScale, 3, 0, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // ghost trail when jumping
      if (s.jumping && s.playing) {
        ctx.globalAlpha = 0.12
        if (logoRef.current) {
          ctx.drawImage(logoRef.current, PLAYER_X - 5, py + 8, PLAYER_SIZE * 0.8, PLAYER_SIZE * 0.8)
        }
        ctx.globalAlpha = 1
      }

      // player — Spectre logo
      if (logoRef.current) {
        ctx.shadowColor = 'rgba(139, 92, 246, 0.35)'
        ctx.shadowBlur = 18
        ctx.drawImage(logoRef.current, PLAYER_X, py, PLAYER_SIZE, PLAYER_SIZE)
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
      } else {
        // fallback circle with "S"
        const cx = PLAYER_X + PLAYER_SIZE / 2
        const cy = py + PLAYER_SIZE / 2
        const r = PLAYER_SIZE / 2
        ctx.shadowColor = 'rgba(139, 92, 246, 0.4)'
        ctx.shadowBlur = 18
        const pg = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r)
        pg.addColorStop(0, 'rgba(167, 139, 250, 0.95)')
        pg.addColorStop(1, 'rgba(109, 40, 217, 0.85)')
        ctx.fillStyle = pg
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
        ctx.font = `bold ${Math.round(PLAYER_SIZE * 0.48)}px "SF Pro Display", Inter, system-ui`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('S', cx, cy + 1)
        ctx.textAlign = 'start'
        ctx.textBaseline = 'alphabetic'
      }

      // in-canvas HI score + current score
      ctx.font = '600 14px var(--font-mono)'
      ctx.textAlign = 'right'
      // HI
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
      ctx.fillText('HI ' + String(hi).padStart(5, '0'), W - 120, 28)
      // current score
      const scoreStr = String(s.score).padStart(5, '0')
      if (s.milestoneFlash > 0) {
        ctx.fillStyle = `rgba(139, 92, 246, ${0.5 + s.milestoneFlash / 35 * 0.5})`
      } else if (s.coinFlash > 0) {
        ctx.fillStyle = `rgba(74, 222, 128, ${0.5 + s.coinFlash / 20 * 0.5})`
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
      }
      ctx.fillText(scoreStr, W - 16, 28)
      ctx.textAlign = 'start'

      // speed indicator (small bar)
      const speedPct = (s.speed - INITIAL_SPEED) / (MAX_SPEED - INITIAL_SPEED)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
      ctx.fillRect(16, 20, 60, 4)
      const speedGrad = ctx.createLinearGradient(16, 0, 76, 0)
      speedGrad.addColorStop(0, 'rgba(139, 92, 246, 0.5)')
      speedGrad.addColorStop(1, 'rgba(239, 68, 68, 0.5)')
      ctx.fillStyle = speedGrad
      ctx.fillRect(16, 20, 60 * speedPct, 4)

      // "PRESS SPACE" start screen
      if (!s.playing && !s.gameOver) {
        const logoSize = 72
        const logoX = W / 2 - logoSize / 2
        const logoY = H / 2 - logoSize / 2 - 28
        if (logoRef.current) {
          ctx.shadowColor = 'rgba(139, 92, 246, 0.3)'
          ctx.shadowBlur = 24
          ctx.globalAlpha = 0.55 + Math.sin(s.frame * 0.04) * 0.2
          ctx.drawImage(logoRef.current, logoX, logoY, logoSize, logoSize)
          ctx.globalAlpha = 1
          ctx.shadowBlur = 0
        }
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
        ctx.font = '600 16px "SF Pro Display", Inter, system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('SPECTRE RUNNER', W / 2, H / 2 + 30)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
        ctx.font = '400 13px "SF Pro Display", Inter, system-ui, sans-serif'
        ctx.fillText(t('spectreRunner.pressSpace', 'Press SPACE or tap to start'), W / 2, H / 2 + 52)
        // controls hint
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
        ctx.font = '400 11px "SF Pro Display", Inter, system-ui, sans-serif'
        ctx.fillText('Jump over red candles  •  Collect green coins for +3', W / 2, H / 2 + 74)
        ctx.textAlign = 'start'
      }

      // GAME OVER
      if (s.gameOver) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
        ctx.fillRect(0, 0, W, H)
        // red vignette
        const vL = ctx.createLinearGradient(0, 0, 100, 0)
        vL.addColorStop(0, 'rgba(239, 68, 68, 0.1)')
        vL.addColorStop(1, 'rgba(239, 68, 68, 0)')
        ctx.fillStyle = vL
        ctx.fillRect(0, 0, 100, H)
        const vR = ctx.createLinearGradient(W, 0, W - 100, 0)
        vR.addColorStop(0, 'rgba(239, 68, 68, 0.1)')
        vR.addColorStop(1, 'rgba(239, 68, 68, 0)')
        ctx.fillStyle = vR
        ctx.fillRect(W - 100, 0, 100, H)

        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
        ctx.font = '700 28px "SF Pro Display", Inter, system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(t('spectreRunner.gameOver', 'GAME OVER'), W / 2, H / 2 - 24)
        // score
        ctx.fillStyle = 'rgba(139, 92, 246, 0.8)'
        ctx.font = '700 20px var(--font-mono)'
        ctx.fillText(String(s.score).padStart(5, '0'), W / 2, H / 2 + 10)
        // new high score?
        if (s.score >= hi && s.score > 0) {
          ctx.fillStyle = 'rgba(251, 191, 36, 0.7)'
          ctx.font = '600 12px "SF Pro Display", Inter, system-ui, sans-serif'
          ctx.fillText('NEW HIGH SCORE!', W / 2, H / 2 + 32)
        }
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
        ctx.font = '400 14px "SF Pro Display", Inter, system-ui, sans-serif'
        ctx.fillText(t('spectreRunner.restart', 'Press SPACE or tap to restart'), W / 2, H / 2 + 56)
        ctx.textAlign = 'start'
      }

      ctx.restore()
    }

    function loop() {
      const s = stateRef.current
      if (!s) return
      // Freeze the game while backgrounded - don't advance physics or repaint,
      // just re-arm so it resumes cleanly when the tab is visible again.
      if (document.hidden) {
        rafRef.current = requestAnimationFrame(loop)
        return
      }
      update(s)
      draw(s)
      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [initState, hi, t])

  /* ── keyboard / touch ───────────────────────────────── */
  useEffect(() => {
    const handleKey = (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault()
        jump()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [jump])

  return (
    <div className="spectre-runner-overlay" onClick={(e) => e.target.classList.contains('spectre-runner-overlay') && onClose?.()}>
      <div className="spectre-runner-modal">
        <div className="spectre-runner-header">
          <div className="spectre-runner-title-area">
            <img src="/round-logo.png" alt="" className="spectre-runner-logo" />
            <h2 className="spectre-runner-title">{t('spectreRunner.title', 'Spectre Runner')}</h2>
          </div>
          <button type="button" className="spectre-runner-close" onClick={onClose} aria-label={t('common.close')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div
          ref={wrapRef}
          className="spectre-runner-canvas-wrap"
          tabIndex={0}
          onClick={jump}
          onTouchStart={jump}
        >
          <canvas ref={canvasRef} />
        </div>

        <div className="spectre-runner-footer">
          <p className="spectre-runner-hint">{t('spectreRunner.hint', 'SPACE / tap to jump — avoid the red candles')}</p>
          <div className="spectre-runner-scores">
            <span className="spectre-runner-score">HI <span>{String(hi).padStart(5, '0')}</span></span>
            <span className="spectre-runner-score"><span>{String(score).padStart(5, '0')}</span></span>
          </div>
        </div>
      </div>
    </div>
  )
}
