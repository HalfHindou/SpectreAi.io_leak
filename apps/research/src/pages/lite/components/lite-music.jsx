/**
 * LITE ambience — optional sound for the Today screen.
 *
 * Founder call 2026-08-28: "like in GM, add option of adding music… a little
 * panel of choices. default is off but users can click play."
 *
 * TWO KINDS of source, deliberately labelled differently in the panel:
 *
 *   TRACKS are real audio files from /public/audio, played through an <audio>
 *     element exactly as GM does — HTML5 audio, not Web Audio, so iOS Safari's
 *     user-gesture autoplay rule is satisfied by the click on Play.
 *   ROOMS are synthesised live in the browser (filtered noise, slow pads). They
 *     exist because we only own two music files, and a room is honest about
 *     what it is: a texture, not a composition. They cost no bytes, never end,
 *     and never repeat.
 *
 * NOTHING here ever autoplays. The store remembers the last chosen source and
 * the volume; it deliberately does NOT remember "was playing" — a page that
 * starts making noise on load is the thing everyone hates. Playback always
 * begins with a click.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '@/hooks/useMediaQuery'
import useBackDismiss from '@/hooks/use-back-dismiss'
import { useSheetDrag } from './lite-edit-sheet'
import './lite-music.css'

export const MUSIC_SOURCES = [
  // Real files. Add another by dropping an mp3 in apps/research/public/audio
  // and adding one line here.
  { id: 'kulfi', kind: 'track', label: 'Kulfi', hint: 'Warm, slow', src: '/audio/magnific-kulfi.mp3' },
  { id: 'ashes', kind: 'track', label: 'Ashes', hint: 'Cinematic', src: '/audio/throne-of-ashes.mp3' },
  // Synthesised rooms. Every one is banded to stay audible on a laptop speaker
  // and mixed well under the tracks — see the traps on `warm` and `bells`.
  { id: 'rain', kind: 'room', label: 'Rain', hint: 'Soft, close', room: 'rain' },
  { id: 'waves', kind: 'room', label: 'Waves', hint: 'Slow swell', room: 'waves' },
  { id: 'wind', kind: 'room', label: 'Wind', hint: 'Distant air', room: 'wind' },
  { id: 'warm', kind: 'room', label: 'Warm', hint: 'Low pad', room: 'warm' },
  { id: 'bells', kind: 'room', label: 'Bells', hint: 'Pad and chimes', room: 'bells' },
  { id: 'room', kind: 'room', label: 'Room tone', hint: 'Almost silence', room: 'room' },
]

const FADE_MS = 700

/** Linear volume ramp on an <audio> element (GM's fadeAudio, same shape). */
function fadeAudio(el, target, ms, timerRef) {
  if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  const steps = 24
  const from = el.volume
  let i = 0
  timerRef.current = setInterval(() => {
    i += 1
    const v = Math.min(1, Math.max(0, from + (target - from) * (i / steps)))
    try { el.volume = v } catch { /* detached */ }
    if (i >= steps) { clearInterval(timerRef.current); timerRef.current = null }
  }, Math.max(8, ms / steps))
}

/* ── Synthesised rooms ─────────────────────────────────────────────────────
   Each returns a teardown. They share one AudioContext and one master gain so
   the volume slider and the fades work identically for tracks and rooms. */

function buildNoiseBuffer(ctx, seconds = 6) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  // Pink-ish noise (Voss-McCartney, cheap variant). White noise reads as hiss;
  // pink is what actually sounds like rain and wind.
  let b0 = 0, b1 = 0, b2 = 0
  for (let i = 0; i < len; i += 1) {
    const w = Math.random() * 2 - 1
    b0 = 0.99765 * b0 + w * 0.0990460
    b1 = 0.96300 * b1 + w * 0.2965164
    b2 = 0.57000 * b2 + w * 1.0526913
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.09
  }
  return buf
}

/** A looping noise bed shaped by a band, with a slow swell. */
function noiseBed(ctx, dest, { lo, hi, level, swellHz, swellDepth }) {
  const src = ctx.createBufferSource()
  src.buffer = buildNoiseBuffer(ctx, 8)
  src.loop = true
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = lo
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = hi
  const g = ctx.createGain()
  g.gain.value = level
  const lfo = ctx.createOscillator()
  lfo.frequency.value = swellHz
  const lg = ctx.createGain()
  lg.gain.value = level * swellDepth
  lfo.connect(lg).connect(g.gain)
  src.connect(hp).connect(lp).connect(g).connect(dest)
  src.start()
  lfo.start()
  return () => { try { src.stop(); lfo.stop() } catch { /* already stopped */ } }
}

/** A sustained chord of soft sines. Frequencies must stay ABOVE ~110Hz — see
    the note on `warm` below. */
function padVoices(ctx, dest, freqs, level) {
  const nodes = []
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    // A few cents of detune per voice makes them beat against each other very
    // slowly, which is what stops a chord sounding like a test tone.
    osc.frequency.value = f * (1 + (i - 1) * 0.0013)
    const g = ctx.createGain()
    g.gain.value = level / (i + 1.4)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.021 + i * 0.013
    const lg = ctx.createGain()
    lg.gain.value = g.gain.value * 0.35
    lfo.connect(lg).connect(g.gain)
    osc.connect(g).connect(dest)
    osc.start(); lfo.start()
    nodes.push(osc, lfo)
  })
  return () => nodes.forEach((n) => { try { n.stop() } catch { /* already stopped */ } })
}

function startRain(ctx, dest) {
  // Was a 2.6kHz-wide bed at 0.16 — that is the "aggressive" one. Rain heard
  // from inside is mostly low: band it down and drop the level.
  return noiseBed(ctx, dest, { lo: 120, hi: 1100, level: 0.5, swellHz: 0.05, swellDepth: 0.12 })
}

function startWaves(ctx, dest) {
  // Same bed, but the swell IS the sound — one breath every ~11s.
  return noiseBed(ctx, dest, { lo: 90, hi: 700, level: 0.5, swellHz: 0.09, swellDepth: 0.75 })
}

function startWind(ctx, dest) {
  const stop = noiseBed(ctx, dest, { lo: 200, hi: 900, level: 0.42, swellHz: 0.037, swellDepth: 0.5 })
  return stop
}

function startWarm(ctx, dest) {
  // 🪤 The old "Deep" ran a 55Hz fundamental (A1). Laptop and phone speakers
  // roll off hard below ~150Hz, so it measured fine and was INAUDIBLE on the
  // hardware anyone actually uses — it read as "doesn't work". A2 + fifth +
  // octave keeps the same calm weight inside the range a small speaker
  // reproduces.
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 900
  lp.connect(dest)
  const stop = padVoices(ctx, lp, [110, 164.81, 220, 329.63], 0.15)
  return () => { stop(); try { lp.disconnect() } catch { /* detached */ } }
}

function startBells(ctx, dest) {
  // 🪤 The old "Night" was bells ALONE, every 1.8-5s. Press play, hear nothing
  // for seconds, conclude it is broken. It now sits on a quiet pad so there is
  // always something, and the first notes are scheduled immediately rather
  // than waiting on a timer.
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1600
  lp.connect(dest)
  const stopPad = padVoices(ctx, lp, [110, 164.81, 220], 0.07)

  const scale = [220, 261.63, 329.63, 392, 440, 523.25]
  let stopped = false
  let timer = null
  const strike = (at) => {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = scale[Math.floor(Math.random() * scale.length)]
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, at)
    // A 0.5s swell instead of the old 40ms attack — that hard edge was the
    // "ping" that made it read as aggressive.
    g.gain.linearRampToValueAtTime(0.1, at + 0.5)
    g.gain.exponentialRampToValueAtTime(0.0004, at + 7)
    osc.connect(g).connect(lp)
    osc.start(at)
    osc.stop(at + 7.5)
  }
  // Seed a few so the room is alive the instant it starts (and so an offline
  // render, which has no timers, still produces signal).
  const t0 = ctx.currentTime
  ;[0.2, 3.4, 7.1].forEach((o) => strike(t0 + o))
  const walk = () => {
    if (stopped) return
    strike(ctx.currentTime + 0.05)
    timer = setTimeout(walk, 3400 + Math.random() * 4200)
  }
  timer = setTimeout(walk, 10500)
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    stopPad()
    try { lp.disconnect() } catch { /* detached */ }
  }
}

function startRoom(ctx, dest) {
  // Plain room tone — the quietest option, for people who want the silence to
  // have a floor rather than an atmosphere.
  return noiseBed(ctx, dest, { lo: 60, hi: 420, level: 0.34, swellHz: 0.017, swellDepth: 0.25 })
}

// Exported for the offline audibility check — a room that renders silent is a
// room a user will report as broken.
export const ROOMS = {
  rain: startRain,
  waves: startWaves,
  wind: startWind,
  warm: startWarm,
  bells: startBells,
  room: startRoom,
}

/* ── The control ──────────────────────────────────────────────────────────── */

export default function LiteMusic({ sourceId, setSourceId, volume, setVolume }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [playing, setPlaying] = useState(false)
  const wrapRef = useRef(null)
  const popRef = useRef(null)
  const audioRef = useRef(null)
  const fadeRef = useRef(null)
  const ctxRef = useRef(null)
  const masterRef = useRef(null)
  const roomStopRef = useRef(null)

  const active = MUSIC_SOURCES.find((s) => s.id === sourceId) || MUSIC_SOURCES[0]
  const vol = typeof volume === 'number' ? volume : 0.45

  const stopAll = useCallback(() => {
    if (roomStopRef.current) { roomStopRef.current(); roomStopRef.current = null }
    const el = audioRef.current
    if (el) {
      if (fadeRef.current) { clearInterval(fadeRef.current); fadeRef.current = null }
      try { el.pause(); el.src = ''; el.load() } catch { /* detached */ }
      audioRef.current = null
    }
  }, [])

  // Stop on unmount — leaving Lite must not leave sound running behind the app.
  useEffect(() => () => {
    stopAll()
    if (ctxRef.current) { try { ctxRef.current.close() } catch { /* already closed */ } ctxRef.current = null }
  }, [stopAll])

  // Keep a live player at the current volume.
  useEffect(() => {
    if (audioRef.current) { try { audioRef.current.volume = vol } catch { /* detached */ } }
    if (masterRef.current && ctxRef.current) {
      masterRef.current.gain.setTargetAtTime(vol, ctxRef.current.currentTime, 0.1)
    }
  }, [vol])

  // Keep the panel on screen. It is anchored to a pill that can sit anywhere in
  // a wrapping row, so neither `right: 0` nor `left: 0` is safe at every width —
  // at 390px the right-anchored panel hung 32px off the left edge. Measure once
  // on open and shift it back inside; CSS alone cannot clamp against a viewport
  // it has no reference to.
  // Phones: the anchored popover becomes a bottom sheet (same chrome as the
  // Edit sheet - scrim, grab handle, footer Done). The placement + outside-
  // click effects below are desktop-only; the sheet is fixed and portaled.
  const isMobile = useIsMobile()
  const { sheetRef, closing, close: closeSheet, headProps } = useSheetDrag(() => setOpen(false), open)
  useBackDismiss(open && isMobile, () => setOpen(false))
  useEffect(() => {
    if (!open || !isMobile || typeof document === 'undefined') return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open, isMobile])

  useEffect(() => {
    if (!open || isMobile) return undefined
    const el = popRef.current
    if (!el) return undefined
    const place = () => {
      el.style.setProperty('--pop-shift', '0px')
      const r = el.getBoundingClientRect()
      const pad = 12
      let shift = 0
      if (r.left < pad) shift = pad - r.left
      else if (r.right > window.innerWidth - pad) shift = (window.innerWidth - pad) - r.right
      if (shift) el.style.setProperty('--pop-shift', `${Math.round(shift)}px`)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, isMobile])

  useEffect(() => {
    if (!open || isMobile) return undefined
    const onDoc = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open, isMobile])

  const play = useCallback((source) => {
    stopAll()
    if (source.kind === 'track') {
      const el = new Audio()
      el.src = source.src
      el.loop = true
      el.preload = 'auto'
      el.volume = 0
      audioRef.current = el
      el.play()
        .then(() => { setPlaying(true); fadeAudio(el, vol, FADE_MS, fadeRef) })
        // A rejected play() is almost always a missing gesture or a 404 — either
        // way the honest response is to show the button as not playing.
        .catch(() => { setPlaying(false); audioRef.current = null })
      return
    }
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) { setPlaying(false); return }
    if (!ctxRef.current) {
      ctxRef.current = new Ctx()
      masterRef.current = ctxRef.current.createGain()
      masterRef.current.gain.value = 0
      // One gentle roll-off across every room, so no single one can get shrill
      // and they all sit at a comparable brightness.
      const tame = ctxRef.current.createBiquadFilter()
      tame.type = 'lowpass'
      tame.frequency.value = 2200
      masterRef.current.connect(tame).connect(ctxRef.current.destination)
    }
    const ctx = ctxRef.current
    // Safari starts contexts suspended until a gesture resumes them.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    roomStopRef.current = ROOMS[source.room](ctx, masterRef.current)
    // ~2s to reach level. The old 0.23s constant meant a room arrived at full
    // volume almost instantly, which is half of why they felt aggressive.
    masterRef.current.gain.setTargetAtTime(vol, ctx.currentTime, 0.7)
    setPlaying(true)
  }, [stopAll, vol])

  const toggle = useCallback(() => {
    if (playing) { stopAll(); setPlaying(false); return }
    play(active)
  }, [playing, stopAll, play, active])

  const pick = useCallback((source) => {
    setSourceId?.(source.id)
    if (playing) play(source)
  }, [setSourceId, playing, play])

  const playBtn = (
    <button type="button" className={`lite-music-play${playing ? ' is-playing' : ''}`} onClick={toggle}>
      {playing ? t('lite.music.stop', 'Stop') : t('lite.music.play', 'Play')}
    </button>
  )
  const content = (
    <>
      <p className="lite-music-group">{t('lite.music.tracks', 'Tracks')}</p>
      {MUSIC_SOURCES.filter((s) => s.kind === 'track').map((s) => (
        <button
          key={s.id}
          type="button"
          className={`lite-music-row${s.id === active.id ? ' is-active' : ''}`}
          onClick={() => pick(s)}
        >
          <span className="lite-music-row-label">{s.label}</span>
          <span className="lite-music-row-hint">{s.hint}</span>
        </button>
      ))}

      <p className="lite-music-group">{t('lite.music.rooms', 'Rooms')}</p>
      {MUSIC_SOURCES.filter((s) => s.kind === 'room').map((s) => (
        <button
          key={s.id}
          type="button"
          className={`lite-music-row${s.id === active.id ? ' is-active' : ''}`}
          onClick={() => pick(s)}
        >
          <span className="lite-music-row-label">{s.label}</span>
          <span className="lite-music-row-hint">{s.hint}</span>
        </button>
      ))}

      <label className="lite-music-vol">
        <span>{t('lite.music.volume', 'Volume')}</span>
        <input
          type="range"
          className="lite-range"
          min="0"
          max="100"
          value={Math.round(vol * 100)}
          style={{ '--fill': `${Math.round(vol * 100)}%` }}
          onChange={(e) => setVolume?.(Number(e.target.value) / 100)}
          aria-label={t('lite.music.volume', 'Volume')}
        />
      </label>
    </>
  )

  return (
    <div className="lite-musicwrap" ref={wrapRef}>
      <button
        type="button"
        className={`lite-pill lite-music-btn${playing ? ' is-playing' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={t('lite.music.title', 'Ambience')}
      >
        {playing ? (
          <span className="lite-music-eq" aria-hidden><i /><i /><i /></span>
        ) : (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
          </svg>
        )}
        {playing ? active.label : t('lite.music.label', 'Sound')}
      </button>

      {open && !isMobile && (
        <div className="lite-musicpop" ref={popRef} role="group" aria-label={t('lite.music.title', 'Ambience')}>
          <div className="lite-musicpop-head">
            <p className="lite-editpop-title">{t('lite.music.title', 'Ambience')}</p>
            {playBtn}
          </div>
          {content}
        </div>
      )}
      {open && isMobile && createPortal(
        <>
          <div className={`lite-editpop-scrim${closing ? ' closing' : ''}`} onClick={closeSheet} aria-hidden />
          <div ref={sheetRef} className={`lite-editpop lite-editpop--sheet lite-music-sheet${closing ? ' closing' : ''}`} role="dialog" aria-modal="true" aria-label={t('lite.music.title', 'Ambience')}>
            <div className="lite-editpop-head" {...headProps}>
              <span className="lite-editpop-grab" aria-hidden />
              <div className="lite-editpop-headrow">
                <strong className="lite-editpop-heading">{t('lite.music.title', 'Ambience')}</strong>
                {playBtn}
              </div>
            </div>
            <div className="lite-editpop-body">{content}</div>
            <div className="lite-editpop-foot">
              <button type="button" className="lite-editpop-done" onClick={closeSheet}>{t('lite.done', 'Done')}</button>
            </div>
          </div>
        </>,
        document.querySelector('.lite-root') || document.body,
      )}
    </div>
  )
}
