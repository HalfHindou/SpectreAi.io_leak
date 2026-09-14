/**
 * SpectreSparkline - Shared canvas sparkline component
 *
 * Replaces 52+ inline canvas sparkline implementations across the app.
 * Uses raw <canvas> (NOT Lightweight Charts - overkill for 60px charts).
 *
 * Usage:
 *   <SpectreSparkline data={sparkline_in_7d.price} width={80} height={24} />
 *   <SpectreSparkline data={prices} color="#10B981" filled />
 */
import { useEffect, useRef, memo } from 'react'
import { drawSpectreWatermark } from '@/lib/chart-watermark'

const DEFAULT_COLOR_UP = '#22D3A0'   // brighter bull for sparklines
const DEFAULT_COLOR_DOWN = '#FB6C6C' // brighter bear for sparklines
const DEFAULT_COLOR_NEUTRAL = 'rgba(245, 245, 247, 0.7)'

function SpectreSparkline({
  data,
  width = 80,
  height = 24,
  color,
  strokeWidth = 2,
  filled = false,
  animate = false,
  relief = false,
  className = '',
}) {
  const canvasRef = useRef(null)
  const animFrameRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !data || data.length < 2) return

    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true })
    const dpr = Math.min(window.devicePixelRatio || 1, 2) // Cap at 2x — 3x overdraws on phones (10× pixel cost)

    // Set canvas dimensions with DPR
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    // Filter valid data points
    const points = data.filter(v => v != null && !isNaN(v) && isFinite(v))
    if (points.length < 2) return

    // Subsample for perf. relief mode keeps higher resolution for smoother curves
    const maxPoints = relief ? 120 : 48
    let sampled = points
    if (points.length > maxPoints) {
      const step = points.length / maxPoints
      sampled = []
      for (let i = 0; i < maxPoints; i++) {
        sampled.push(points[Math.floor(i * step)])
      }
      sampled.push(points[points.length - 1])
    }

    // Determine color from price direction if not explicit
    const lineColor = color || getAutoColor(sampled)

    // Calculate bounds
    const min = Math.min(...sampled)
    const max = Math.max(...sampled)
    const range = max - min || 1
    const padY = 3

    // Precompute points with pixel-aligned coordinates for crispness
    function computePts(count) {
      const stepX = (width - 2) / (sampled.length - 1)
      const pts = []
      for (let i = 0; i < count; i++) {
        const x = 1 + i * stepX
        const y = padY + ((max - sampled[i]) / range) * (height - padY * 2)
        pts.push([x, y])
      }
      return pts
    }

    // Monotone cubic interpolation for smooth but non-overshooting curves
    function drawSmoothPath(pts) {
      if (pts.length < 2) return
      ctx.moveTo(pts[0][0], pts[0][1])
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i]
        const p1 = pts[i]
        const p2 = pts[i + 1]
        const p3 = pts[i + 2] || p2
        const cp1x = p1[0] + (p2[0] - p0[0]) / 6
        const cp1y = p1[1] + (p2[1] - p0[1]) / 6
        const cp2x = p2[0] - (p3[0] - p1[0]) / 6
        const cp2y = p2[1] - (p3[1] - p1[1]) / 6
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1])
      }
    }

    function draw(progress = 1) {
      ctx.clearRect(0, 0, width, height)

      const drawCount = animate ? Math.max(2, Math.ceil(sampled.length * progress)) : sampled.length
      const pts = computePts(drawCount)

      // Gradient fill under curve
      if (filled && pts.length > 1) {
        ctx.beginPath()
        drawSmoothPath(pts)
        ctx.lineTo(pts[pts.length - 1][0], height)
        ctx.lineTo(pts[0][0], height)
        ctx.closePath()
        const grad = ctx.createLinearGradient(0, 0, 0, height)
        if (relief) {
          grad.addColorStop(0, hexToRgba(lineColor, 0.32))
          grad.addColorStop(0.5, hexToRgba(lineColor, 0.08))
          grad.addColorStop(1, hexToRgba(lineColor, 0))
        } else {
          grad.addColorStop(0, hexToRgba(lineColor, 0.38))
          grad.addColorStop(0.6, hexToRgba(lineColor, 0.1))
          grad.addColorStop(1, hexToRgba(lineColor, 0))
        }
        ctx.fillStyle = grad
        ctx.fill()
      }

      if (relief) {
        // Drop shadow beneath the stroke for embossed depth
        ctx.save()
        ctx.translate(0, 0.6)
        ctx.beginPath()
        drawSmoothPath(pts)
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
        ctx.lineWidth = strokeWidth
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.stroke()
        ctx.restore()

        // Soft glow halo (subtler than default)
        ctx.save()
        ctx.shadowColor = hexToRgba(lineColor, 0.55)
        ctx.shadowBlur = 4
        ctx.beginPath()
        drawSmoothPath(pts)
        ctx.strokeStyle = lineColor
        ctx.lineWidth = strokeWidth
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.stroke()
        ctx.restore()

        // Crisp stroke on top
        ctx.beginPath()
        drawSmoothPath(pts)
        ctx.strokeStyle = lineColor
        ctx.lineWidth = strokeWidth
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.stroke()

        // Highlight stroke on the top edge for embossed look
        ctx.save()
        ctx.translate(0, -0.5)
        ctx.beginPath()
        drawSmoothPath(pts)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
        ctx.lineWidth = Math.max(0.4, strokeWidth * 0.45)
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.stroke()
        ctx.restore()
      } else {
        // Strong glow beneath the stroke for sharp punch
        ctx.save()
        ctx.shadowColor = hexToRgba(lineColor, 0.85)
        ctx.shadowBlur = 7
        ctx.beginPath()
        drawSmoothPath(pts)
        ctx.strokeStyle = lineColor
        ctx.lineWidth = strokeWidth
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.stroke()
        ctx.restore()

        // Crisp stroke on top (no glow) for sharpness
        ctx.beginPath()
        drawSmoothPath(pts)
        ctx.strokeStyle = lineColor
        ctx.lineWidth = strokeWidth
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.stroke()
      }

      // End cap dot on the latest point
      if (pts.length > 0) {
        const [ex, ey] = pts[pts.length - 1]
        ctx.beginPath()
        ctx.arc(ex, ey, strokeWidth + 0.4, 0, Math.PI * 2)
        ctx.fillStyle = lineColor
        ctx.fill()
        ctx.beginPath()
        ctx.arc(ex, ey, strokeWidth + 1.8, 0, Math.PI * 2)
        ctx.fillStyle = hexToRgba(lineColor, 0.18)
        ctx.fill()
      }

      drawSpectreWatermark(ctx, { w: width, h: height, dark: true })
    }

    if (animate) {
      let start = null
      const duration = 600
      function step(ts) {
        if (!start) start = ts
        const progress = Math.min((ts - start) / duration, 1)
        draw(progress)
        if (progress < 1) {
          animFrameRef.current = requestAnimationFrame(step)
        }
      }
      animFrameRef.current = requestAnimationFrame(step)
    } else {
      draw()
    }

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [data, width, height, color, strokeWidth, filled, animate, relief])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ width: `${width}px`, height: `${height}px`, display: 'block' }}
    />
  )
}

function getAutoColor(points) {
  if (!points || points.length < 2) return DEFAULT_COLOR_NEUTRAL
  const first = points[0]
  const last = points[points.length - 1]
  if (last > first) return DEFAULT_COLOR_UP
  if (last < first) return DEFAULT_COLOR_DOWN
  return DEFAULT_COLOR_NEUTRAL
}

function hexToRgba(hex, alpha) {
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) {
    // Already rgb - inject alpha
    return hex.replace(/[\d.]+\)$/, `${alpha})`)
  }
  if (!hex.startsWith('#')) return `rgba(128, 128, 128, ${alpha})`
  const h = hex.slice(1)
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export default memo(SpectreSparkline)
