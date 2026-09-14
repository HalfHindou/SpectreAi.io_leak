import { useRef, useCallback, useEffect } from 'react'

/**
 * 3D tilt + spotlight glow effect (adapted from Framer GlowCard + GlowingShadow).
 * Tracks mouse position → sets CSS custom properties for:
 *   - 3D perspective tilt toward cursor
 *   - Radial gradient spotlight on card surface
 *   - Colored border glow that follows cursor (via ::before/::after in CSS)
 *
 * Each card needs its own instance (separate refs per card).
 */
export default function useTiltEffect({
  maxTilt = 4,
  perspective = 900,
  scale = 1.01,
  glowEnabled = true,
} = {}) {
  const ref = useRef(null)
  const glowRef = useRef(null)

  const handleMouseMove = useCallback((e) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width   // 0-1
    const y = (e.clientY - rect.top) / rect.height    // 0-1
    const tiltX = (0.5 - y) * maxTilt * 2
    const tiltY = (x - 0.5) * maxTilt * 2

    el.style.transform = `perspective(${perspective}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale3d(${scale},${scale},${scale})`

    // Set CSS custom properties for spotlight border glow (used by ::before/::after in CSS)
    el.style.setProperty('--spot-x', `${(x * 100).toFixed(1)}%`)
    el.style.setProperty('--spot-y', `${(y * 100).toFixed(1)}%`)
    el.style.setProperty('--spot-opacity', '1')

    if (glowEnabled && glowRef.current) {
      glowRef.current.style.opacity = '1'
      glowRef.current.style.background = `radial-gradient(600px circle at ${x * 100}% ${y * 100}%, rgba(139,92,246,0.06) 0%, rgba(255,255,255,0.03) 25%, transparent 60%)`
    }
  }, [maxTilt, perspective, scale, glowEnabled])

  const handleMouseLeave = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.transform = ''
    el.style.setProperty('--spot-opacity', '0')
    if (glowRef.current) {
      glowRef.current.style.opacity = '0'
    }
  }, [])

  // Initialize CSS custom properties on the DOM element
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--spot-x', '50%')
    el.style.setProperty('--spot-y', '50%')
    el.style.setProperty('--spot-opacity', '0')
  }, [])

  const tiltProps = {
    ref,
    onMouseMove: handleMouseMove,
    onMouseLeave: handleMouseLeave,
    style: {
      transformStyle: 'preserve-3d',
      transition: 'transform 0.15s ease-out, border-color 0.25s cubic-bezier(0.16,1,0.3,1), box-shadow 0.25s cubic-bezier(0.16,1,0.3,1)',
      willChange: 'transform',
      '--spot-x': '50%',
      '--spot-y': '50%',
      '--spot-opacity': '0',
    },
  }

  return { tiltProps, glowRef }
}
