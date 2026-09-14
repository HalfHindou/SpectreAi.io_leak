import { useRef, useEffect, useState } from 'react'

// Max time the warp may stay on screen. The warp is a brief "graph is settling"
// flourish — if the force sim never reports settled (crawl-mode rebuild thrash),
// this hard cap guarantees the loader can NEVER stick and black out the board.
const MAX_WARP_MS = 2600

export default function LightspeedLoader({ active, dayMode }) {
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  // Hard safety valve: self-hide after MAX_WARP_MS even if `active` never drops.
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    if (!active) { setExpired(false); return }
    const t = setTimeout(() => setExpired(true), MAX_WARP_MS)
    return () => clearTimeout(t)
  }, [active])

  const showing = active && !expired

  useEffect(() => {
    if (!showing) return
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    // dpr 1: the warp is soft streaks over a fade trail — a retina buffer
    // quadruples the pixels the full-canvas trail fill repaints EVERY frame
    // for zero visible gain (same call as the ParticleBackground fix).
    const dpr = 1

    // Stars
    const stars = Array.from({ length: 120 }, () => ({
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: Math.random(),
      pz: 0,
    }))

    let running = true
    const speed = 0.008

    // Measure once + on resize — a per-frame getBoundingClientRect forces a
    // layout reflow 60×/s, which is what made the warp itself stutter.
    let w = canvas.clientWidth || 1
    let h = canvas.clientHeight || 1
    const ro = new ResizeObserver(() => {
      w = canvas.clientWidth || 1
      h = canvas.clientHeight || 1
    })
    ro.observe(canvas)

    function draw() {
      if (!running) return
      if (document.hidden) {
        rafRef.current = requestAnimationFrame(draw)
        return
      }

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Fade trail by ERASING the previous frame, not painting black over it.
      // The old `fillRect(rgba(9,9,11,0.06))` composited near-black every frame,
      // so a stuck-active loader accumulated into an opaque black sheet that
      // buried the graph underneath (the "X Bubbles went black" bug). destination-out
      // just decays existing streak alpha — the canvas stays transparent where
      // there are no streaks, so the graph below always reads through.
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0,0,0,0.16)'
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'

      const cx = w / 2
      const cy = h / 2

      for (const star of stars) {
        star.pz = star.z
        star.z -= speed

        if (star.z <= 0) {
          star.x = (Math.random() - 0.5) * 2
          star.y = (Math.random() - 0.5) * 2
          star.z = 1
          star.pz = 1
        }

        const sx = (star.x / star.z) * w * 0.5 + cx
        const sy = (star.y / star.z) * h * 0.5 + cy
        const px = (star.x / star.pz) * w * 0.5 + cx
        const py = (star.y / star.pz) * h * 0.5 + cy

        const size = (1 - star.z) * 1.8
        const alpha = (1 - star.z) * 0.5

        ctx.strokeStyle = dayMode
          ? `rgba(100,116,139,${alpha})`
          : `rgba(245,245,247,${alpha})`
        ctx.lineWidth = size
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(sx, sy)
        ctx.stroke()
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      running = false
      ro.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [showing, dayMode])

  if (!showing) return null

  return (
    <canvas
      ref={canvasRef}
      className="xi-lightspeed"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 5,
        pointerEvents: 'none',
      }}
    />
  )
}
