import { useRef, useEffect, useCallback } from 'react'
import './light-fx-bg.css'

/**
 * LightFxBg - Canvas-based animated background with soft light rays
 * and twinkling star particles. Designed for deep-black Spectre pages.
 *
 * Place inside any container with position: relative. The canvas fills
 * the container absolutely and sits behind content at z-index: 0.
 *
 * @param {string}  rayColor     - Base ray color, default 'blue'
 * @param {number}  starCount    - Number of star particles, default 70
 * @param {boolean} showStars    - Toggle stars on/off, default true
 * @param {number}  raySpeed     - Ray rotation speed multiplier, default 1
 * @param {string}  rayDirection - 'top-right' | 'top-left' | 'center', default 'top-right'
 */

/* Pre-defined ray color palettes keyed by name */
const RAY_PALETTES = {
  blue: {
    primary: [100, 180, 255],
    secondary: [200, 220, 255],
  },
  white: {
    primary: [220, 220, 230],
    secondary: [245, 245, 247],
  },
  cyan: {
    primary: [80, 200, 220],
    secondary: [160, 230, 240],
  },
}

/* Direction presets - origin point as fraction of canvas dimensions */
const DIRECTION_ORIGINS = {
  'top-right': { xFrac: 1.05, yFrac: -0.05 },
  'top-left': { xFrac: -0.05, yFrac: -0.05 },
  center: { xFrac: 0.5, yFrac: -0.1 },
}

/**
 * Generate star particle data once on mount. Each star has a fixed
 * position, base size, twinkle speed, and phase offset so they
 * shimmer independently.
 */
function generateStars(count, w, h) {
  const stars = new Array(count)
  for (let i = 0; i < count; i++) {
    stars[i] = {
      x: Math.random() * w,
      y: Math.random() * h,
      radius: 0.8 + Math.random() * 2.2,
      phase: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.7, // twinkle speed
      baseAlpha: 0.3 + Math.random() * 0.4,
    }
  }
  return stars
}

/**
 * Ray definition. Each ray has:
 * - angle: base sweep angle in radians
 * - length: how far the ray extends (fraction of diagonal)
 * - width: angular spread of the ray cone
 * - alpha: peak opacity
 * - speed: rotation speed offset
 */
function generateRays() {
  return [
    { angle: -0.52, length: 1.1, width: 0.18, alpha: 0.14, speed: 1.0 },
    { angle: -0.78, length: 0.95, width: 0.22, alpha: 0.09, speed: 0.7 },
    { angle: -0.35, length: 1.0, width: 0.14, alpha: 0.11, speed: 1.3 },
    { angle: -1.05, length: 0.85, width: 0.26, alpha: 0.06, speed: 0.5 },
  ]
}

export default function LightFxBg({
  rayColor = 'blue',
  starCount = 70,
  showStars = true,
  raySpeed = 1,
  rayDirection = 'top-right',
}) {
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const starsRef = useRef(null)
  const raysRef = useRef(null)
  const startTimeRef = useRef(null)
  const sizeRef = useRef({ w: 0, h: 0 })

  const palette = RAY_PALETTES[rayColor] || RAY_PALETTES.blue
  const origin = DIRECTION_ORIGINS[rayDirection] || DIRECTION_ORIGINS['top-right']

  /**
   * Draw a single soft ray from the origin point outward.
   * Uses a cone-shaped path filled with a radial gradient that
   * fades from the ray color to transparent. The ctx.filter blur
   * gives it the diffused, fog-light-beam quality.
   */
  const drawRay = useCallback(
    (ctx, ray, time, ox, oy, diagonal) => {
      const wobble = Math.sin(time * 0.15 * ray.speed * raySpeed) * 0.06
      const currentAngle = ray.angle + wobble
      const len = ray.length * diagonal
      const halfSpread = ray.width * 0.5

      // Cone endpoints
      const leftAngle = currentAngle - halfSpread
      const rightAngle = currentAngle + halfSpread
      const lx = ox + Math.cos(leftAngle) * len
      const ly = oy + Math.sin(leftAngle) * len
      const rx = ox + Math.cos(rightAngle) * len
      const ry = oy + Math.sin(rightAngle) * len

      // Radial gradient from origin outward
      const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, len * 0.85)

      const [pr, pg, pb] = palette.primary
      const [sr, sg, sb] = palette.secondary

      // Core glow near origin
      grad.addColorStop(0, `rgba(${sr}, ${sg}, ${sb}, ${ray.alpha * 1.2})`)
      // Mid-ray primary color
      grad.addColorStop(0.25, `rgba(${pr}, ${pg}, ${pb}, ${ray.alpha * 0.8})`)
      // Fade out
      grad.addColorStop(0.6, `rgba(${pr}, ${pg}, ${pb}, ${ray.alpha * 0.3})`)
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)')

      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      ctx.filter = 'blur(50px)'
      ctx.beginPath()
      ctx.moveTo(ox, oy)
      ctx.lineTo(lx, ly)
      ctx.lineTo(rx, ry)
      ctx.closePath()
      ctx.fillStyle = grad
      ctx.fill()
      ctx.restore()
    },
    [palette, raySpeed]
  )

  /**
   * Draw a single twinkling star. Uses a tiny radial gradient
   * for the glow halo effect rather than plain arc fill.
   */
  const drawStar = useCallback((ctx, star, time) => {
    const twinkle =
      star.baseAlpha +
      (1 - star.baseAlpha) * ((Math.sin(time * star.speed + star.phase) + 1) * 0.5)

    const r = star.radius
    const grad = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, r * 2.5)
    grad.addColorStop(0, `rgba(220, 230, 255, ${twinkle})`)
    grad.addColorStop(0.4, `rgba(200, 215, 245, ${twinkle * 0.5})`)
    grad.addColorStop(1, 'rgba(200, 215, 245, 0)')

    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(star.x, star.y, r * 2.5, 0, Math.PI * 2)
    ctx.fill()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = rect.width
      const h = rect.height
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      sizeRef.current = { w, h }
      // Regenerate stars when canvas resizes so they fill the space
      starsRef.current = generateStars(starCount, w, h)
    }

    resize()
    raysRef.current = generateRays()
    startTimeRef.current = performance.now()

    const ro = new ResizeObserver(resize)
    ro.observe(canvas.parentElement)

    // Throttle ambient ray/star background to 30fps — saves CPU/GPU.
    const FRAME_MS = 1000 / 30
    let lastFrame = 0

    const frame = (now) => {
      rafRef.current = requestAnimationFrame(frame)
      if (now - lastFrame < FRAME_MS) return
      lastFrame = now

      const { w, h } = sizeRef.current
      if (w === 0 || h === 0) return

      const elapsed = (now - startTimeRef.current) / 1000
      const diagonal = Math.sqrt(w * w + h * h)
      const ox = w * origin.xFrac
      const oy = h * origin.yFrac

      // Clear
      ctx.clearRect(0, 0, w, h)

      // Draw rays
      const rays = raysRef.current
      for (let i = 0; i < rays.length; i++) {
        drawRay(ctx, rays[i], elapsed, ox, oy, diagonal)
      }

      // Draw stars
      if (showStars && starsRef.current) {
        ctx.globalCompositeOperation = 'screen'
        const stars = starsRef.current
        for (let i = 0; i < stars.length; i++) {
          drawStar(ctx, stars[i], elapsed)
        }
        ctx.globalCompositeOperation = 'source-over'
      }
    }

    const start = () => {
      if (rafRef.current) return
      lastFrame = 0
      rafRef.current = requestAnimationFrame(frame)
    }
    const stop = () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    }
    const onVis = () => { if (document.hidden) stop(); else start() }
    document.addEventListener('visibilitychange', onVis)
    if (!document.hidden) start()

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
      ro.disconnect()
    }
  }, [starCount, showStars, raySpeed, drawRay, drawStar, origin])

  return (
    <div className="light-fx-bg">
      <canvas ref={canvasRef} />
    </div>
  )
}
