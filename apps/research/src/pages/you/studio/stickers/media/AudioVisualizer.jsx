import { useEffect, useRef } from 'react'

/**
 * AudioVisualizer -- Ambient animated bars, purely decorative.
 * 48 vertical bars oscillating with sine waves via requestAnimationFrame.
 * Designed for ~300x80 sticker area.
 */

const BAR_COUNT = 48
const BAR_WIDTH = 3
const BAR_GAP = 3
const SVG_WIDTH = 300
const SVG_HEIGHT = 80
const MIN_HEIGHT = 5
const MAX_HEIGHT = 60

// Pre-compute stable per-bar speeds
const BAR_SPEEDS = Array.from({ length: BAR_COUNT }, (_, i) => {
  // Deterministic pseudo-random based on index (no Math.random for stability)
  const seed = Math.sin(i * 9.1 + 3.7) * 0.5 + 0.5
  return 0.002 + seed * 0.003
})

function hexToRgba(hex, alpha) {
  const cleaned = hex.replace('#', '')
  const r = parseInt(cleaned.substring(0, 2), 16)
  const g = parseInt(cleaned.substring(2, 4), 16)
  const b = parseInt(cleaned.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export default function AudioVisualizer({ sticker, themeObj }) {
  const svgRef = useRef(null)
  const rafRef = useRef(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    // Create rect elements once
    const rects = []
    const totalWidth = BAR_COUNT * (BAR_WIDTH + BAR_GAP) - BAR_GAP
    const offsetX = (SVG_WIDTH - totalWidth) / 2

    const barColor = hexToRgba(themeObj.accentColor || '#8b5cf6', 0.4)

    for (let i = 0; i < BAR_COUNT; i++) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      rect.setAttribute('x', String(offsetX + i * (BAR_WIDTH + BAR_GAP)))
      rect.setAttribute('width', String(BAR_WIDTH))
      rect.setAttribute('rx', '1.5')
      rect.setAttribute('fill', barColor)
      svg.appendChild(rect)
      rects.push(rect)
    }

    function animate(time) {
      // Skip the 48 SVG attribute writes while the tab is backgrounded; rAF is
      // throttled (not always fully paused) when hidden, so re-arm and bail.
      if (document.hidden) {
        rafRef.current = requestAnimationFrame(animate)
        return
      }
      for (let i = 0; i < BAR_COUNT; i++) {
        const phase = (i / BAR_COUNT) * Math.PI * 2
        const normalized = Math.sin(time * BAR_SPEEDS[i] + phase) * 0.5 + 0.5
        const height = MIN_HEIGHT + normalized * (MAX_HEIGHT - MIN_HEIGHT)
        const y = SVG_HEIGHT - height
        rects[i].setAttribute('y', String(y))
        rects[i].setAttribute('height', String(height))
      }
      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      // Clean up rects
      rects.forEach(r => {
        if (r.parentNode) r.parentNode.removeChild(r)
      })
    }
  }, [themeObj.accentColor])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
    </div>
  )
}
