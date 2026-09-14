/**
 * PodcastVisualizer — a REAL voice visualizer.
 *
 * Web Audio AnalyserNode tapped off the player's own <audio> element, so the
 * band moves with the actual speech rather than to a timer.
 *
 * 🪤 createMediaElementSource RE-ROUTES the element's audio into the graph. If
 *    the graph is not connected through to ctx.destination the podcast goes
 *    SILENT — the element still reports playing and nothing looks wrong.
 * 🪤 It can only be called ONCE per element; a second call throws. The node is
 *    cached on the element itself.
 * 🪤 A cross-origin media file whose host sends no CORS headers taints the
 *    stream and the analyser returns all zeros forever. Setting
 *    crossOrigin="anonymous" blindly is worse — a host without CORS then fails
 *    to LOAD at all, which would break playback for those shows. The player
 *    probes the URL first and only opts in when the host allows it; when it
 *    does not, this falls back to an ambient motion that is deliberately
 *    slower and softer, and never claims to be the waveform.
 */
import { useEffect, useRef, memo } from 'react'

const BARS = 64
/* Voice sits in the low-mid band; the top of the spectrum is nearly empty on
   speech, so a linear bin→bar map renders as a tall left edge decaying into a
   dead right half. Bars are mapped with a curve (more resolution where the
   voice actually is) and the natural spectral rolloff is compensated per bar,
   so the whole band moves. Shaping of a real signal — the DATA is still the
   live waveform. */
const BIN_START = 2
const BIN_END = 72
const BIN_CURVE = 1.7

const sharedCtxRef = { ctx: null }

function getAnalyser(el) {
  if (!el) return null
  if (el.__spectreAudioTap) return el.__spectreAudioTap
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!AC) return null
  try {
    const ctx = sharedCtxRef.ctx || (sharedCtxRef.ctx = new AC())
    const source = ctx.createMediaElementSource(el)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.82
    source.connect(analyser)
    // MUST reach the speakers — see the trap note above.
    analyser.connect(ctx.destination)
    const tap = { ctx, analyser, data: new Uint8Array(analyser.frequencyBinCount) }
    el.__spectreAudioTap = tap
    return tap
  } catch {
    // Already tapped by another instance, or the browser refused. Ornament only.
    return null
  }
}

const PodcastVisualizer = memo(function PodcastVisualizer({ audioRef, playing, dayMode, live = true, height = 84 }) {
  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  const levelsRef = useRef(new Float32Array(BARS))
  const phaseRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    let stopped = false

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      // dpr capped at 2 — this canvas is small, but the app has a documented
      // thermal incident from an uncapped full-viewport buffer.
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(rect.width * dpr))
      const h = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      return { w: rect.width, h: rect.height, dpr }
    }

    const draw = () => {
      if (stopped) return
      // A hidden tab renders nothing and must not hold a rAF loop.
      if (document.hidden) { rafRef.current = requestAnimationFrame(draw); return }

      const { w, h, dpr } = resize()
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx2d.clearRect(0, 0, w, h)

      const el = audioRef?.current
      const tap = live && el ? getAnalyser(el) : null
      const levels = levelsRef.current

      if (tap && playing) {
        if (tap.ctx.state === 'suspended') tap.ctx.resume().catch(() => {})
        tap.analyser.getByteFrequencyData(tap.data)
        const span = BIN_END - BIN_START
        for (let i = 0; i < BARS; i++) {
          const from = BIN_START + Math.floor(Math.pow(i / BARS, BIN_CURVE) * span)
          const to = BIN_START + Math.floor(Math.pow((i + 1) / BARS, BIN_CURVE) * span)
          let sum = 0, n = 0
          for (let b = from; b < Math.max(to, from + 1); b++) { sum += tap.data[b]; n++ }
          // Rolloff compensation only — enough that the right half moves, not
          // so much that every bar pins to the ceiling and the band reads as a
          // solid block. Headroom left so peaks still peak.
          const gain = 1 + 0.95 * Math.pow(i / BARS, 1.2)
          const target = n ? Math.min(1, ((sum / n) / 255) * gain * 0.82) : 0
          // Rise fast, fall slow — speech reads as syllables, not strobing.
          levels[i] += (target - levels[i]) * (target > levels[i] ? 0.45 : 0.12)
        }
      } else {
        // Ambient: a slow travelling swell. Deliberately unlike speech — this is
        // ornament for when the waveform is unreadable or paused, not a fake
        // reading of the audio.
        phaseRef.current += playing ? 0.016 : 0.005
        const p = phaseRef.current
        for (let i = 0; i < BARS; i++) {
          const x = i / BARS
          const target = (playing ? 0.16 : 0.06)
            * (0.6 + 0.4 * Math.sin(p * 1.6 + x * Math.PI * 3))
            * (0.5 + 0.5 * Math.sin(p * 0.7 + x * Math.PI * 1.2))
            + (playing ? 0.03 : 0.012)
          levels[i] += (target - levels[i]) * 0.08
        }
      }

      const mid = h / 2
      const gap = 3
      const barW = Math.max(1.5, (w - gap * (BARS - 1)) / BARS)
      const ink = dayMode ? '15, 23, 42' : '245, 245, 247'

      for (let i = 0; i < BARS; i++) {
        const v = Math.max(0.02, Math.min(1, levels[i]))
        const barH = Math.max(2, v * (h * 0.92))
        const x = i * (barW + gap)
        // Louder reads brighter — one channel, no hue, per the design system.
        ctx2d.fillStyle = `rgba(${ink}, ${(0.18 + v * 0.62).toFixed(3)})`
        const r = Math.min(barW / 2, 2)
        const y = mid - barH / 2
        if (ctx2d.roundRect) {
          ctx2d.beginPath()
          ctx2d.roundRect(x, y, barW, barH, r)
          ctx2d.fill()
        } else {
          ctx2d.fillRect(x, y, barW, barH)
        }
      }

      // The quiet centre line keeps the band legible when nothing is being said.
      ctx2d.fillStyle = `rgba(${ink}, 0.10)`
      ctx2d.fillRect(0, mid - 0.5, w, 1)

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => { stopped = true; cancelAnimationFrame(rafRef.current) }
  }, [audioRef, playing, dayMode, live])

  return (
    <canvas
      ref={canvasRef}
      className="spp-viz"
      style={{ height }}
      aria-hidden="true"
    />
  )
})

export default PodcastVisualizer
