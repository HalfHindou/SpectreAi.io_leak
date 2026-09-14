/**
 * useAgentVoice - the brief SPEAKS. Fetches the server-synthesized MP3
 * (/api/agent/brief-audio, Google Chirp3-HD Charon) and plays it; falls
 * back to browser speechSynthesis when the server says so; falls silent
 * to text-only when neither works. Never blocks the text brief - audio is
 * strictly additive.
 *
 * Behavior contract (Gleb 2026-07-22): voice AUTO-SPEAKS each new brief
 * after a ONE-TIME opt-in ("Enable voice briefings?"). Browser autoplay
 * rules apply: in-SPA token switches follow a user gesture so play()
 * succeeds; a cold direct-URL load without prior interaction rejects ->
 * status 'blocked' and the control degrades to tap-to-hear.
 *
 * agentVoice.enabled: null = never asked (surface the opt-in prompt),
 * true/false = the user's standing answer (persisted, device-local).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import useSettingsStore from '../store/useSettingsStore'
import { getDemoToken } from '../services/demoSession'
import { isVoiceSessionLive } from './useVoiceSession'
import { track, Events } from '../services/analytics'

const _playedHashes = new Set() // briefHash -> already auto-spoken this session

export function useAgentVoice(token, brief, { surface = 'desktop' } = {}) {
  const agentVoice = useSettingsStore((s) => s.agentVoice)
  const setAgentVoice = useSettingsStore((s) => s.setAgentVoice)

  // idle | loading | playing | paused | blocked | error
  const [status, setStatus] = useState('idle')
  const audioRef = useRef(null)
  const blobUrlRef = useRef(null)
  const abortRef = useRef(null)
  const speakingRef = useRef(false) // webspeech active
  const tokenKeyRef = useRef('')

  const enabled = agentVoice?.enabled === true
  const needsOptIn = agentVoice?.enabled == null
  const voiceId = agentVoice?.voice || 'charon'
  const briefHash = brief?.meta?.briefHash || null

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    const a = audioRef.current
    if (a) { try { a.pause(); a.src = '' } catch { /* detached */ } }
    audioRef.current = null
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null }
    if (speakingRef.current) { try { window.speechSynthesis?.cancel() } catch { /* no api */ } speakingRef.current = false }
    setStatus('idle')
  }, [])

  const speakFallback = useCallback((text) => {
    if (!text || typeof window === 'undefined' || !window.speechSynthesis) { setStatus('error'); return }
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 1.0
      const voices = window.speechSynthesis.getVoices() || []
      const pick = voices.find((v) => /en[-_]US/i.test(v.lang) && /male|david|daniel|guy/i.test(v.name))
        || voices.find((v) => /en[-_]US/i.test(v.lang))
      if (pick) u.voice = pick
      u.onend = () => { speakingRef.current = false; setStatus('idle') }
      u.onerror = () => { speakingRef.current = false; setStatus('error') }
      speakingRef.current = true
      setStatus('playing')
      window.speechSynthesis.speak(u)
      track(Events.AGENT_VOICE_PLAYED, { surface, provider: 'webspeech' })
    } catch { setStatus('error') }
  }, [surface])

  const play = useCallback(async () => {
    if (!token?.address || !briefHash) return
    // Mark the hash as spoken at PLAY time, not only in the auto-speak
    // effect - enable()'s play + the enabled-flip re-running the effect
    // otherwise double-fetch and restart the same audio (review-confirmed).
    _playedHashes.add(briefHash)
    // Resume a paused element instead of refetching.
    const existing = audioRef.current
    if (existing && existing.paused && existing.currentTime > 0 && !existing.ended) {
      try { await existing.play(); setStatus('playing'); return } catch { /* fall through to refetch */ }
    }
    stop()
    setStatus('loading')
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const params = new URLSearchParams({
        address: token.address,
        networkId: String(token.networkId),
        voice: voiceId,
        hash: briefHash,
      })
      const headers = {}
      if (surface === 'embed') {
        const demo = getDemoToken()
        if (demo) headers['x-demo-token'] = demo
      }
      // Cold synthesis of a full script runs ~20-30s server-side; warm/CDN
      // hits are instant. The control shows loading either way.
      const res = await fetch(`/api/agent/brief-audio?${params}`, { headers, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      if (res.status === 503) {
        const j = await res.json().catch(() => null)
        if (j?.fallback === 'webspeech') { speakFallback(j.speech || brief?.speech); return }
        throw new Error('tts 503')
      }
      if (!res.ok) throw new Error(`audio ${res.status}`)
      const blob = await res.blob()
      if (ctrl.signal.aborted) return
      const url = URL.createObjectURL(blob)
      blobUrlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => setStatus('idle')
      audio.onpause = () => { if (!audio.ended && audio.currentTime > 0) setStatus('paused') }
      audio.onplay = () => setStatus('playing')
      try {
        await audio.play()
        track(Events.AGENT_VOICE_PLAYED, { surface, symbol: token.symbol })
      } catch (err) {
        // Autoplay policy: no user activation yet (cold load) -> tap-to-hear.
        if (err?.name === 'NotAllowedError') { setStatus('blocked'); return }
        throw err
      }
    } catch (err) {
      if (err?.name === 'AbortError') return
      // Server unreachable entirely: try the browser voice before silence.
      if (brief?.speech) speakFallback(brief.speech)
      else setStatus('error')
    }
  }, [token?.address, token?.networkId, token?.symbol, briefHash, voiceId, surface, stop, speakFallback, brief?.speech])

  const pause = useCallback(() => {
    const a = audioRef.current
    if (a && !a.paused) { a.pause(); return }
    if (speakingRef.current) { try { window.speechSynthesis?.cancel() } catch { /* gone */ } speakingRef.current = false; setStatus('idle') }
  }, [])

  const toggle = useCallback(() => {
    if (status === 'playing') pause()
    else play()
  }, [status, pause, play])

  // One-time opt-in answers. Enabling inside the click IS the unlock gesture.
  const enable = useCallback(() => {
    setAgentVoice({ enabled: true })
    track(Events.AGENT_VOICE_OPTIN, { surface, answer: 'enabled' })
    play()
  }, [setAgentVoice, surface, play])

  const decline = useCallback(() => {
    setAgentVoice({ enabled: false })
    track(Events.AGENT_VOICE_OPTIN, { surface, answer: 'declined' })
  }, [setAgentVoice, surface])
  const disable = useCallback(() => { stop(); setAgentVoice({ enabled: false }) }, [stop, setAgentVoice])

  // Token switch: kill any running audio immediately.
  const tokenKey = `${String(token?.address || '').toLowerCase()}:${token?.networkId}`
  useEffect(() => {
    if (tokenKeyRef.current && tokenKeyRef.current !== tokenKey) stop()
    tokenKeyRef.current = tokenKey
  }, [tokenKey, stop])

  useEffect(() => () => { stop() }, [stop])

  // Auto-speak: a NEW brief + voice enabled -> play once per brief hash.
  // Skipped when the tab is hidden or the user asked for data saving.
  useEffect(() => {
    if (!enabled || !briefHash) return
    if (_playedHashes.has(briefHash)) return
    if (isVoiceSessionLive()) return // never talk over a live conversation
    if (typeof document !== 'undefined' && document.hidden) return
    if (typeof navigator !== 'undefined' && navigator.connection?.saveData) return
    _playedHashes.add(briefHash)
    play()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefHash, enabled])

  return { status, enabled, needsOptIn, play, pause, toggle, stop, enable, decline, disable }
}
