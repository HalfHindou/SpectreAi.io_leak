/**
 * AgentOrbFace - the agent's FACE at the top of the panel: a compact
 * waveform orb that animates while Jarvis speaks (the brief) or thinks,
 * and breathes while idle. Voice-first identity - the agent is a voice
 * that happens to have a transcript, not a chatbox with a speaker.
 *
 * Purely synthetic animation (no microphone here - the mic belongs to the
 * live session overlay); tapping the face starts the voice conversation
 * when it is available, so "Jarvis speaking to you" is also the door in.
 */
import { useEffect, useRef } from 'react'
import { Mic } from 'lucide-react'
import { drawOrb, makeOrbParticles, isDayModeNow } from './voiceOrb'
import './AgentOrbFace.css'

const SIZE = 148

export default function AgentOrbFace({ speaking, thinking, canTalk, onTalk, statusText }) {
  const canvasRef = useRef(null)
  const frameRef = useRef(0)
  const particlesRef = useRef(makeOrbParticles(16, 52))
  // State mirror for the [] rAF loop.
  const modeRef = useRef('idle')
  modeRef.current = speaking ? 'speaking' : thinking ? 'thinking' : 'idle'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const dpr = window.devicePixelRatio || 1
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr

    let cancelled = false
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

    const tick = () => {
      if (cancelled) return
      const now = performance.now()
      const mode = modeRef.current
      // The face uses the session orb's synthetic waveforms: 'speaking'
      // full choir, otherwise the slow idle wave.
      drawOrb(canvas, null, particlesRef.current, mode === 'speaking' ? 'speaking' : 'processing', mode === 'speaking' ? 0.35 : 0, now, isDayModeNow(), {
        scale: 0.56,
        innerRadius: 46,
        maxBarHeight: 30,
        barCount: 48,
      })
      frameRef.current = requestAnimationFrame(tick)
    }

    if (reduced) {
      // One static frame - no perpetual animation under reduced motion.
      drawOrb(canvas, null, particlesRef.current, 'processing', 0, 0, isDayModeNow(), { scale: 0.56, innerRadius: 46, maxBarHeight: 30, barCount: 48 })
    } else {
      tick()
    }
    return () => { cancelled = true; cancelAnimationFrame(frameRef.current) }
  }, [])

  return (
    <div className={`saface saface--${speaking ? 'speaking' : thinking ? 'thinking' : 'idle'}`}>
      <button
        type="button"
        className="saface__orb"
        onClick={canTalk ? onTalk : undefined}
        disabled={!canTalk}
        title={canTalk ? 'Talk to the agent' : undefined}
        aria-label={canTalk ? 'Start voice conversation' : 'Agent'}
      >
        <canvas ref={canvasRef} className="saface__canvas" style={{ width: SIZE, height: SIZE }} />
        <span className="saface__core" aria-hidden="true" />
        {canTalk && (
          <span className="saface__mic" aria-hidden="true"><Mic size={11} /></span>
        )}
      </button>
      {statusText && <div className="saface__status">{statusText}</div>}
    </div>
  )
}
