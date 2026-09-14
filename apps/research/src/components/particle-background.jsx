/**
 * Ambient floating particles - Apple cinematic warm-white orbs.
 * Soft radial-gradient dots that drift slowly like dust in a keynote spotlight.
 * Pure white only, no color. 4K-smooth at 60 fps.
 */
import { useEffect, useRef, memo } from 'react'
import { isAppActive, subscribeActivity } from '@/lib/idleManager'
import './particle-background.css'

const PARTICLE_COUNT = 28

function createParticle(w, h) {
  const baseRadius = Math.random() * 1.2 + 0.4 // 0.4 - 1.6
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    baseRadius,
    // Very slow drift - cinematic float
    vx: (Math.random() - 0.5) * 0.08,
    vy: (Math.random() - 0.5) * 0.06,
    // Breathing pulse
    phase: Math.random() * Math.PI * 2,
    phaseSpeed: 0.003 + Math.random() * 0.004,
    // Each particle gets its own peak opacity (warm-white range)
    opacity: 0.12 + Math.random() * 0.18, // 0.12 - 0.30
  }
}

const ParticleBackground = () => {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (typeof window !== 'undefined' && window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }
    const ctx = canvas.getContext('2d', { alpha: true })
    let raf = null
    let W, H
    // Throttle ambient background to 20fps. Every redraw forces the GPU to
    // re-upload the full-viewport canvas texture AND re-filter every
    // backdrop-filter element sitting above it (~30-48 blurred surfaces:
    // header, cards, buttons) - measured as the app's dominant standing
    // GPU load (fans/heat on Macs). 20fps on a slow dust-drift is
    // indistinguishable; MOTION_SCALE keeps the 30fps-era drift pace.
    const FRAME_MS = 1000 / 20
    const MOTION_SCALE = 1.5
    let lastFrame = 0

    const resize = () => {
      // Render at 1x, not retina: this is a soft radial-gradient glow field
      // at opacity 0.8 behind content - upscaling blur is invisible, and a
      // 1x buffer quarters the pixels the GPU re-composites every frame.
      const dpr = 1
      W = window.innerWidth
      H = window.innerHeight
      canvas.width = W * dpr
      canvas.height = H * dpr
      canvas.style.width = W + 'px'
      canvas.style.height = H + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    // Init particles
    const particles = []
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(createParticle(W, H))
    }

    const draw = (now) => {
      raf = requestAnimationFrame(draw)
      if (now - lastFrame < FRAME_MS) return
      lastFrame = now

      ctx.clearRect(0, 0, W, H)

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]

        // Update
        p.x += p.vx * MOTION_SCALE
        p.y += p.vy * MOTION_SCALE
        p.phase += p.phaseSpeed * MOTION_SCALE

        // Wrap edges with padding so glow doesn't pop
        if (p.x < -20) p.x = W + 20
        if (p.x > W + 20) p.x = -20
        if (p.y < -20) p.y = H + 20
        if (p.y > H + 20) p.y = -20

        // Breathing radius
        const breath = 0.7 + Math.sin(p.phase) * 0.3 // 0.4 - 1.0
        const r = p.baseRadius * breath

        // Soft glow radius (the visible halo)
        const glowR = r * 6

        // Radial gradient: bright core fading to transparent
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR)
        grad.addColorStop(0, `rgba(245, 245, 247, ${p.opacity})`)
        grad.addColorStop(0.15, `rgba(245, 245, 247, ${p.opacity * 0.6})`)
        grad.addColorStop(0.5, `rgba(240, 238, 235, ${p.opacity * 0.15})`)
        grad.addColorStop(1, 'rgba(240, 238, 235, 0)')

        ctx.beginPath()
        ctx.fillStyle = grad
        ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const start = () => {
      if (raf) return
      lastFrame = 0
      raf = requestAnimationFrame(draw)
    }
    const stop = () => {
      if (raf) { cancelAnimationFrame(raf); raf = null }
    }
    // Pause when the tab is hidden OR the user has been idle 5min with the
    // tab visible (second-monitor / walked-away case) - no reason to burn
    // GPU on ambient dust nobody is watching. Resumes on any interaction.
    const syncRunning = () => {
      if (document.hidden || !isAppActive()) stop()
      else start()
    }
    document.addEventListener('visibilitychange', syncRunning)
    const unsubIdle = subscribeActivity(syncRunning)
    syncRunning()

    return () => {
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', syncRunning)
      unsubIdle()
      stop()
    }
  }, [])

  return <canvas ref={canvasRef} className="particle-background" />
}

// perf: takes no props - memo makes it render exactly once. It's a self-driving
// rAF canvas; without memo it re-rendered whenever AppShell re-rendered (toast,
// notification poll, market tick) even though nothing about it changed.
export default memo(ParticleBackground)
