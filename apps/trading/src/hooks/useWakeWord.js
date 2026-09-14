/**
 * useWakeWord - "Hey Spectre" hands-free activation (the Hey-Siri moment).
 * A background SpeechRecognition loop listens for the wake phrase while the
 * agent panel is CLOSED and fires onWake - no button needed.
 *
 * Guardrails:
 *  - NEVER prompts for the microphone: arms only when permission is already
 *    'granted' (the voice opt-in flow grants it); otherwise stays silent.
 *  - Stops while the tab is hidden (no background burn) and must be
 *    disabled by the caller while any voice session runs (Chrome allows
 *    ONE SpeechRecognition per page - the session owns the mic then).
 *  - Chrome recycles continuous recognitions (~60s / on silence): the loop
 *    re-arms with backoff, resetting on every successful start, and CARRIES
 *    the transcript tail across the recycle - "hey" [pause] "Spectre"
 *    lands in two recognizer instances and still wakes.
 *  - Phrase matching lives in lib/wakeMatch.js (pure, tested): together,
 *    paused, filler-separated, run-together, bare-name-after-silence, and
 *    the common ASR respellings all trigger.
 */
import { useEffect, useRef, useState } from 'react'
import { matchesWake } from '../lib/wakeMatch'

const SRCls = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

// A pause-split phrase half stays usable for this long.
const CARRY_MS = 5_000

export function useWakeWord({ enabled, onWake, onArmed }) {
  const [armed, setArmed] = useState(false)
  const onWakeRef = useRef(onWake)
  useEffect(() => { onWakeRef.current = onWake }, [onWake])
  const onArmedRef = useRef(onArmed)
  useEffect(() => { onArmedRef.current = onArmed }, [onArmed])

  useEffect(() => {
    if (!enabled || !SRCls) { setArmed(false); return undefined }

    let cancelled = false
    let rec = null
    let retryMs = 600
    let retryTimer = 0
    let armedOnce = false // onArmed fires once per enable cycle (pre-warm hook)
    // Cross-instance phrase memory: "hey" heard just before a silence
    // recycle must still pair with the "Spectre" the NEXT instance hears.
    let carry = ''
    let carryAt = 0
    let lastSeen = ''

    const start = () => {
      if (cancelled || document.hidden) { setArmed(false); return }
      try {
        rec = new SRCls()
        rec.continuous = true
        rec.interimResults = true
        rec.lang = 'en-US'
        rec.maxAlternatives = 1
        rec.onstart = () => {
          retryMs = 600
          if (cancelled) return
          setArmed(true)
          if (!armedOnce) { armedOnce = true; onArmedRef.current?.() }
        }
        rec.onresult = (e) => {
          if (cancelled) return
          let text = ''
          for (let i = 0; i < e.results.length; i++) text += ` ${e.results[i][0]?.transcript || ''}`
          lastSeen = text
          // Tail only - an old accumulated match must not re-fire forever.
          const fresh = Date.now() - carryAt < CARRY_MS ? carry : ''
          if (matchesWake(text.slice(-80), fresh)) {
            // Halt this instance's whole loop (abort fires onend, which
            // would otherwise re-arm in 600ms and race the voice session's
            // own SpeechRecognition). The enabled flip re-arms us later.
            cancelled = true
            carry = ''
            const r = rec
            rec = null
            try { r.abort() } catch { /* winding down */ }
            setArmed(false)
            onWakeRef.current?.()
          }
        }
        rec.onerror = (e) => {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            cancelled = true
            setArmed(false)
          }
          // everything else: onend re-arms with backoff
        }
        rec.onend = () => {
          rec = null
          if (cancelled) return
          if (lastSeen.trim()) { carry = lastSeen.slice(-40); carryAt = Date.now() }
          lastSeen = ''
          setArmed(false)
          retryTimer = setTimeout(() => { if (!cancelled) start() }, retryMs)
          retryMs = Math.min(Math.round(retryMs * 1.6), 4_000)
        }
        rec.start()
      } catch {
        retryTimer = setTimeout(() => { if (!cancelled) start() }, 2_000)
      }
    }

    const arm = async () => {
      // Permission pre-check: a background listener must never surprise the
      // user with a mic prompt. No Permissions API -> stay off.
      try {
        const st = await navigator.permissions?.query?.({ name: 'microphone' })
        if (!st || st.state !== 'granted') { setArmed(false); return }
      } catch { setArmed(false); return }
      if (!cancelled) start()
    }

    const onVis = () => {
      if (document.hidden) {
        const r = rec
        rec = null
        if (r) { try { r.onend = null; r.abort() } catch { /* gone */ } }
        setArmed(false)
      } else if (!rec && !cancelled) {
        start()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    arm()

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      document.removeEventListener('visibilitychange', onVis)
      const r = rec
      rec = null
      if (r) { try { r.onend = null; r.abort() } catch { /* gone */ } }
      setArmed(false)
    }
  }, [enabled])

  return { armed, supported: !!SRCls }
}
