/**
 * voiceOrb - the Jarvis waveform orb renderer, shared by the full voice
 * session overlay (AgentVoiceSession) and the compact speaking face at the
 * top of the agent panel (AgentOrbFace). Warm-white, zero saturation.
 * Ported from the research rz-agent-chat visualizer.
 *
 * States: 'listening' draws real FFT data (smoothData), 'speaking' a
 * synthetic sine choir + audioLevel, anything else a slow idle wave.
 */

export function makeOrbParticles(count = 24, baseRadius = 58) {
  return Array.from({ length: count }, () => ({
    angle: Math.random() * Math.PI * 2,
    radius: baseRadius + Math.random() * 34,
    speed: 0.002 + Math.random() * 0.004,
    size: 0.6 + Math.random() * 1.3,
    alpha: 0.12 + Math.random() * 0.25,
  }))
}

export function drawOrb(canvas, smoothData, particles, state, audioLevel, time, isDayMode, opts = {}) {
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const w = canvas.width / dpr
  const h = canvas.height / dpr
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(dpr, dpr)

  const cx = w / 2
  const cy = h / 2
  const scale = opts.scale ?? 1
  const barCount = opts.barCount ?? 64
  const innerRadius = (opts.innerRadius ?? 44) * scale
  const maxBarHeight = (opts.maxBarHeight ?? 26) * scale
  const rotation = time * 0.00015

  for (let i = 0; i < barCount; i++) {
    const angle = (i / barCount) * Math.PI * 2 + rotation - Math.PI / 2
    let value
    if (state === 'listening' && smoothData) {
      const idx = Math.floor((i / barCount) * Math.min(smoothData.length, 64))
      value = smoothData[idx] || 0
    } else if (state === 'speaking') {
      value = 0.25 + 0.3 * Math.sin(time * 0.004 + i * 0.28) + 0.15 * Math.sin(time * 0.007 + i * 0.6) + audioLevel * 0.3
    } else {
      value = 0.08 + 0.07 * Math.sin(time * 0.002 + i * 0.15)
    }
    value = Math.max(0, Math.min(1, value))
    const barH = Math.max(1.5, value * maxBarHeight)
    const inH = barH * 0.35

    const ox1 = cx + Math.cos(angle) * innerRadius
    const oy1 = cy + Math.sin(angle) * innerRadius
    const ox2 = cx + Math.cos(angle) * (innerRadius + barH)
    const oy2 = cy + Math.sin(angle) * (innerRadius + barH)
    const ix1 = cx + Math.cos(angle) * (innerRadius - inH)
    const iy1 = cy + Math.sin(angle) * (innerRadius - inH)

    const lightness = isDayMode ? (35 + value * 15) : (78 + value * 14)
    const alpha = 0.12 + value * 0.6

    ctx.beginPath()
    ctx.moveTo(ix1, iy1)
    ctx.lineTo(ox2, oy2)
    ctx.strokeStyle = `hsla(0, 0%, ${lightness}%, ${alpha})`
    ctx.lineWidth = Math.max(1.2, 2 * scale)
    ctx.lineCap = 'round'
    ctx.stroke()

    if (value > 0.35) {
      ctx.beginPath()
      ctx.moveTo(ox1, oy1)
      ctx.lineTo(ox2, oy2)
      ctx.strokeStyle = `hsla(0, 0%, ${isDayMode ? 50 : 92}%, ${value * 0.22})`
      ctx.lineWidth = 4.5 * scale
      ctx.stroke()
    }
  }

  for (const p of particles) {
    p.angle += p.speed * (1 + audioLevel * 3)
    const dist = p.radius * scale + audioLevel * 12
    const px = cx + Math.cos(p.angle) * dist
    const py = cy + Math.sin(p.angle) * dist
    ctx.beginPath()
    ctx.arc(px, py, p.size * (0.8 + audioLevel * 0.5) * scale, 0, Math.PI * 2)
    ctx.fillStyle = isDayMode ? `rgba(15, 23, 42, ${p.alpha * 0.45})` : `rgba(245, 245, 247, ${p.alpha})`
    ctx.fill()
  }
  ctx.restore()
}

export const isDayModeNow = () =>
  typeof document !== 'undefined' && document.body.classList.contains('theme-light')
