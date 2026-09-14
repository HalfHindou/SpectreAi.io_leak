/**
 * AgentVoiceSession - the live voice-conversation overlay (Jarvis open
 * dialog). Replaces the chat list while a session runs: canvas orb with a
 * live circular waveform (ported from the research rz-agent-chat
 * visualizer - warm-white, zero saturation), status + live transcript +
 * last reply caption, End / keyboard controls. Trade/order confirm cards
 * are MIRRORED here so the overlay never occludes a 60s-expiry card while
 * the user's eyes are off the thread.
 *
 * Mounts ONLY while the session is open (mic + AudioContext cost nothing
 * when closed); useVoiceSession starts on mount, tears down on unmount.
 */
import { useCallback, useEffect, useRef } from 'react'
import { X, Keyboard, MicOff } from 'lucide-react'
import { useVoiceSession } from '../../hooks/useVoiceSession'
import { refreshBluetoothAudio } from '../../lib/audioRoute'
import { drawOrb, makeOrbParticles } from './voiceOrb'
import AgentPresentation from './AgentPresentation'
import AgentTradeCard from './AgentTradeCard'
import AgentOrderTicket from './AgentOrderTicket'
import './AgentVoiceSession.css'

const STATUS_LABELS = {
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  blocked: 'Microphone blocked',
  idle: 'Paused',
}

export default function AgentVoiceSession({ chat, tokenSymbol, surface = 'desktop', onClose }) {
  const voice = useVoiceSession(chat, { tokenSymbol, surface })
  const { state, stateRef, transcript, lastReply, startSession, endSession, tapOrb } = voice

  // Barge-in decisions moved OFF raw mic energy (a cough or whisper was
  // interrupting the agent - live-test feedback) and into useVoiceSession's
  // transcript-based barge-watch. The analyser below is visualize-only.

  const canvasRef = useRef(null)
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const streamRef = useRef(null)
  const frameRef = useRef(0)
  const smoothDataRef = useRef(new Float32Array(64))
  const particlesRef = useRef(makeOrbParticles())

  // Session starts on mount, ends on unmount (mount-gating = the mic gate).
  useEffect(() => {
    startSession()
    return () => endSession('unmount', { silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (state === 'blocked') {
      // Give the user a beat to read the blocked state, then close.
      const id = setTimeout(() => onClose?.(), 2500)
      return () => clearTimeout(id)
    }
    return undefined
  }, [state, onClose])

  /* Visualizer: mic analyser (visualize-only - never VAD) with a CSS-time
     fallback when getUserMedia is refused. Day mode = body.theme-light
     (the rz source hardcoded false - wired here). */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const dpr = window.devicePixelRatio || 1
    canvas.width = 260 * dpr
    canvas.height = 260 * dpr

    let cancelled = false
    const isDay = () => document.body.classList.contains('theme-light')

    // Mic-free idle animation - used when the mic is refused AND on
    // Bluetooth audio (holding capture all session pins a BT speaker in
    // the hands-free profile, degrading the agent's voice to call quality).
    const fallbackTick = () => {
      if (cancelled) return
      const now = performance.now()
      if (canvasRef.current) drawOrb(canvasRef.current, null, particlesRef.current, stateRef.current, 0, now, isDay())
      frameRef.current = requestAnimationFrame(fallbackTick)
    }

    const startTracking = async () => {
      try {
        // echoCancellation is the barge-in enabler: the browser's AEC strips
        // the agent's own speaker output from this capture, so sustained
        // energy while 'speaking' means the USER is talking over him.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        // With the grant in hand, device labels are readable - if a
        // Bluetooth audio device is present, release the mic immediately
        // and animate without it.
        if (await refreshBluetoothAudio()) {
          stream.getTracks().forEach((t) => t.stop())
          if (!cancelled) fallbackTick()
          return
        }
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.75
        source.connect(analyser)
        audioCtxRef.current = ctx
        analyserRef.current = analyser
        const raw = new Uint8Array(analyser.frequencyBinCount)

        const tick = () => {
          if (cancelled || !analyserRef.current) return
          const now = performance.now()
          analyserRef.current.getByteFrequencyData(raw)
          const sd = smoothDataRef.current
          for (let i = 0; i < raw.length && i < sd.length; i++) {
            const target = raw[i] / 255
            sd[i] = target > sd[i] ? sd[i] + (target - sd[i]) * 0.45 : sd[i] + (target - sd[i]) * 0.08
          }
          let sum = 0
          const s = 2
          const e = Math.min(40, raw.length)
          for (let i = s; i < e; i++) sum += raw[i]
          const level = (sum / ((e - s) * 255)) * 2.5

          if (canvasRef.current) drawOrb(canvasRef.current, sd, particlesRef.current, stateRef.current, level, now, isDay())
          frameRef.current = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        // Mic refused for the VISUALIZER only - draw the idle animation.
        fallbackTick()
      }
    }
    startTracking()

    return () => {
      cancelled = true
      cancelAnimationFrame(frameRef.current)
      analyserRef.current = null
      try { audioCtxRef.current?.close() } catch { /* closed */ }
      audioCtxRef.current = null
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleEnd = useCallback(() => {
    endSession('user', { silent: true })
    onClose?.()
  }, [endSession, onClose])

  // Mirror the newest confirm card (60s expiry - eyes are on the orb) and
  // the turn's presentation: while the agent narrates, the drawn scenes
  // (chart, X accounts) take the stage in sync with his speech and the orb
  // steps back. Scenes stay up through the follow-up listen; a new turn
  // without visuals restores the orb.
  const lastMsg = chat.messages[chat.messages.length - 1]
  const liveProposal = lastMsg?.proposal
  const liveTicket = lastMsg?.ticket
  const liveVisuals = lastMsg?.visuals

  return (
    <div className={`savoice savoice--${state}${liveVisuals?.length ? ' savoice--visual' : ''}`} role="dialog" aria-label="Voice conversation">
      <div className="savoice__top">
        <span className="savoice__title">Voice - {tokenSymbol || 'token'}</span>
        <button type="button" className="sagent-panel__iconbtn" aria-label="Close voice" onClick={handleEnd}>
          <X size={15} />
        </button>
      </div>

      <div className="savoice__stage">
        <button
          type="button"
          className="savoice__orbwrap"
          onClick={tapOrb}
          title={state === 'speaking' ? 'Tap to interrupt' : state === 'listening' ? 'Tap when you are done talking' : undefined}
        >
          <canvas ref={canvasRef} className="savoice__canvas" style={{ width: 260, height: 260 }} />
          <span className={`savoice__core savoice__core--${state}`} aria-hidden="true" />
        </button>

        <div className="savoice__status">
          {state === 'blocked' && <MicOff size={12} aria-hidden="true" />}
          {STATUS_LABELS[state] || state}
          {chat.toolActivity?.name ? ` - ${String(chat.toolActivity.name).replace(/^get_/, '').replace(/_/g, ' ')}` : ''}
        </div>

        {/* The presentation: scenes drawing themselves in sync with the
            speech (chart zones/EMA, X account cards), a beat label naming
            what just drew, stat chips when there is nothing to draw. NEVER
            the spoken text itself. */}
        {(liveVisuals?.length > 0 || (state === 'speaking' && lastReply)) && (
          <div className="savoice__visualcard">
            <AgentPresentation
              text={lastReply}
              durationMs={voice.speechDurationMs}
              getProgress={voice.getSpeechProgress}
              visuals={liveVisuals}
              state={state}
              symbol={tokenSymbol}
            />
          </div>
        )}

        {/* Persistent slot across speaking<->listening so the stage never
            reflows when the state flips (content swaps, height holds). */}
        {(state === 'listening' || state === 'speaking') && (
          <div className="savoice__transcript">
            {state === 'listening' ? (transcript || voice.ackText || 'Say something...') : ' '}
          </div>
        )}
        {state === 'blocked' && (
          <div className="savoice__blocked">Microphone access is blocked for this site - enable it in the browser bar to talk.</div>
        )}

        {(liveProposal || liveTicket) && (
          <div className="savoice__card">
            {liveProposal && <AgentTradeCard proposal={liveProposal} surface={surface} />}
            {liveTicket && <AgentOrderTicket ticket={liveTicket} surface={surface} />}
          </div>
        )}
      </div>

      <div className="savoice__foot">
        <button type="button" className="savoice__end" onClick={handleEnd}>End conversation</button>
        <button type="button" className="savoice__kbd" title="Back to typing" onClick={handleEnd}>
          <Keyboard size={13} /> Type instead
        </button>
      </div>
    </div>
  )
}
