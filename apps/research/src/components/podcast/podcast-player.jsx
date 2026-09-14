/**
 * PodcastPlayer — the app-wide podcast surface.
 *
 * Mounted ONCE in AppShell, outside the router Outlet, so audio survives
 * navigation: leaving the AI Media Center collapses the immersive view to the
 * docked bar and the <audio> element is never unmounted. That element lives
 * OUTSIDE the mini/immersive branch below for the same reason — moving it
 * between two subtrees would remount it and restart playback at 0:00.
 *
 * Two faces, one element:
 *   · docked bar  — always-visible transport while you browse the app
 *   · immersive   — full-screen: art, transport, and the live caption rail
 *
 * Captions are REAL: cues come from the show's own <podcast:transcript> feed,
 * parsed server-side (/api/media/podcasts/transcript). Most shows publish none,
 * and in that case the rail says so rather than inventing lines.
 */
import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import useMediaStore from '@/store/useMediaStore'
import * as mediaApi from '@/services/mediaApi'
import { fmtDuration, fmtEpLength, relTime } from '@/pages/media-center/components/media-format'
import MediaSynthesis from '@/pages/media-center/components/media-synthesis'
import useDockDrag from './use-dock-drag'
import PodcastVisualizer from './podcast-visualizer'
import './podcast-player.css'

const SKIP_BACK = 15
const SKIP_FWD = 30
const RATES = [0.8, 1, 1.2, 1.5, 1.75, 2]

/* ── Icons (12–20px stroke marks, currentColor only) ─────── */
const I = {
  play: (s = 18) => (
    <svg viewBox="0 0 24 24" width={s} height={s} fill="currentColor" aria-hidden="true"><path d="M8 5.14v14l11-7-11-7z" /></svg>
  ),
  pause: (s = 18) => (
    <svg viewBox="0 0 24 24" width={s} height={s} fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
  ),
  back: (s = 18) => (
    <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4 6 8l5 4" /><path d="M6 8h7a5 5 0 1 1 0 10h-1" />
    </svg>
  ),
  fwd: (s = 18) => (
    <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m13 4 5 4-5 4" /><path d="M18 8h-7a5 5 0 1 0 0 10h1" />
    </svg>
  ),
  prev: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /><path d="M19 5 9 12l10 7V5z" /></svg>
  ),
  next: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M18 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /><path d="M5 5l10 7L5 19V5z" /></svg>
  ),
  expand: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 14 6 6M4 20h6v-6M20 10l-6-6M20 4h-6v6" /></svg>
  ),
  // A second `minimize` was declared here and silently won; the 16px variant
  // above never rendered. Kept the one that was actually in use.
  minimize: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 15h12" />
    </svg>
  ),
  spark: (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  /* Snap the dragged player back to where CSS wants it. */
  recenter: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="13" width="16" height="7" rx="2" />
      <path d="M12 9V3M9 6l3-3 3 3" />
    </svg>
  ),
  close: (s = 15) => (
    <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
  ),
  captions: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M9 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3" />
    </svg>
  ),
  volume: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5z" /><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />
    </svg>
  ),
  mute: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5z" /><path d="m16 10 5 4M21 10l-5 4" />
    </svg>
  ),
  bookmark: (filled) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></svg>
  ),
  follow: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
  ),
}

/* ── Caption rail ────────────────────────────────────────── */
/* Memoized: the player writes time to the DOM 4x/second, but this list only
   re-renders when the ACTIVE CUE changes (~once every few seconds). A 3,000-cue
   transcript re-rendering per tick would be the whole page's frame budget. */
const CaptionRail = memo(function CaptionRail({ transcript, activeIndex, onSeek, query, t }) {
  const listRef = useRef(null)
  const [follow, setFollow] = useState(true)
  const userScrolledRef = useRef(false)

  // Auto-scroll the active cue into view — unless the reader has scrolled away,
  // in which case following is handed back to them behind an explicit button.
  useEffect(() => {
    if (!follow || activeIndex < 0 || !listRef.current) return
    const el = listRef.current.querySelector(`[data-cue="${activeIndex}"]`)
    if (!el) return
    userScrolledRef.current = true
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const id = setTimeout(() => { userScrolledRef.current = false }, 700)
    return () => clearTimeout(id)
  }, [activeIndex, follow])

  const onScroll = useCallback(() => {
    if (userScrolledRef.current) return
    setFollow(false)
  }, [])

  const cues = transcript?.cues || []
  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () => (q ? cues.map((c, i) => ({ c, i })).filter(({ c }) => c.t.toLowerCase().includes(q)) : cues.map((c, i) => ({ c, i }))),
    [cues, q],
  )

  if (!cues.length) return null

  return (
    <div className="spp-caps">
      <div className="spp-caps-list" ref={listRef} onScroll={onScroll}>
        {shown.length === 0 && (
          <p className="spp-caps-none">{t('mediaCenter.podcastPlayer.noCaptionMatch', { q: query })}</p>
        )}
        {shown.map(({ c, i }) => (
          <button
            key={i}
            type="button"
            data-cue={i}
            className={`spp-cue${i === activeIndex ? ' is-active' : ''}${i < activeIndex ? ' is-past' : ''}`}
            onClick={() => onSeek(c.s)}
          >
            <span className="spp-cue-time">{fmtDuration(c.s) || '0:00'}</span>
            <span className="spp-cue-body">
              {c.sp && <span className="spp-cue-speaker">{c.sp}</span>}
              {c.t}
            </span>
          </button>
        ))}
      </div>
      {!follow && (
        <button type="button" className="spp-caps-follow" onClick={() => setFollow(true)}>
          {I.follow}{t('mediaCenter.podcastPlayer.followAlong')}
        </button>
      )}
    </div>
  )
})

/* ── Episode row (up next / more from show) ──────────────── */
const EpisodeRow = memo(function EpisodeRow({ ep, active, onPlay }) {
  return (
    <button type="button" className={`spp-eprow${active ? ' is-active' : ''}`} onClick={() => onPlay(ep)}>
      <span className="spp-eprow-art">
        {ep.thumbnail ? <img src={ep.thumbnail} alt="" loading="lazy" /> : <span className="spp-eprow-ph" />}
      </span>
      <span className="spp-eprow-body">
        <span className="spp-eprow-title">{ep.title}</span>
        <span className="spp-eprow-meta">
          {ep.channel?.name}
          {ep.duration ? <> · {fmtEpLength(ep.duration)}</> : null}
        </span>
      </span>
    </button>
  )
})

/* ── Main ────────────────────────────────────────────────── */

const PodcastPlayer = ({ dayMode = false }) => {
  const { t } = useTranslation()
  const episode = useMediaStore(s => s.podcastEpisode)
  const playing = useMediaStore(s => s.podcastPlaying)
  const immersive = useMediaStore(s => s.podcastImmersive)
  const rate = useMediaStore(s => s.podcastRate)
  const volume = useMediaStore(s => s.podcastVolume)
  const captionsOn = useMediaStore(s => s.podcastCaptionsOn)
  const queue = useMediaStore(s => s.podcastQueue)
  const queueIndex = useMediaStore(s => s.podcastQueueIndex)
  const resume = useMediaStore(s => s.podcastResume)
  const savedItems = useMediaStore(s => s.savedItems)

  const setPlaying = useMediaStore(s => s.setPodcastPlaying)
  const togglePlay = useMediaStore(s => s.togglePodcastPlay)
  const openImmersive = useMediaStore(s => s.openPodcastImmersive)
  const closeImmersive = useMediaStore(s => s.closePodcastImmersive)
  const stopPodcast = useMediaStore(s => s.stopPodcast)
  const savePosition = useMediaStore(s => s.savePodcastPosition)
  const setRate = useMediaStore(s => s.setPodcastRate)
  const setVolume = useMediaStore(s => s.setPodcastVolume)
  const toggleCaptions = useMediaStore(s => s.togglePodcastCaptions)
  const podcastNext = useMediaStore(s => s.podcastNext)
  const podcastPrev = useMediaStore(s => s.podcastPrev)
  const playPodcast = useMediaStore(s => s.playPodcast)
  const toggleSave = useMediaStore(s => s.toggleSave)

  const audioRef = useRef(null)
  const isWide = typeof window !== 'undefined'
    ? window.matchMedia('(min-width: 860px)').matches
    : true
  const dock = useDockDrag({ enabled: isWide })
  /* Minimised is a per-session choice, not a preference worth persisting: the
     next episode deserves to announce itself. */
  const [minimized, setMinimized] = useState(false)
  const [synOpen, setSynOpen] = useState(false)

  const fillRef = useRef(null)
  const miniFillRef = useRef(null)
  const timeLabelRef = useRef(null)
  const seekRef = useRef(null)
  const lastSaveRef = useRef(0)

  const [duration, setDuration] = useState(0)
  const [activeCue, setActiveCue] = useState(-1)
  const [transcript, setTranscript] = useState(null)
  const [transcriptState, setTranscriptState] = useState('idle') // idle | loading | ready | none
  const [rail, setRail] = useState('captions')
  const [capQuery, setCapQuery] = useState('')
  const [showEpisodes, setShowEpisodes] = useState([])
  const [ratesOpen, setRatesOpen] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  /* 'probing' → no src yet · 'cors' → safe to tap the waveform · 'plain' → play
     without crossOrigin (the visualizer falls back to ambient motion). */
  const [audioMode, setAudioMode] = useState('cors')

  const epId = episode?.id
  const isSaved = useMemo(() => !!epId && savedItems.some(s => s.id === epId), [savedItems, epId])

  /* ── Write playback position straight to the DOM ───────────
     4 ticks/second through React state would re-render this whole tree (and
     the caption list with it). The scrubber is a transform and the clock is a
     textContent write — zero React commits while the audio plays. */
  const paint = useCallback((cur, dur) => {
    const p = dur > 0 ? Math.min(1, cur / dur) : 0
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`
    if (miniFillRef.current) miniFillRef.current.style.transform = `scaleX(${p})`
    if (timeLabelRef.current) timeLabelRef.current.textContent = fmtDuration(cur) || '0:00'
  }, [])

  /* ── Episode change: reset, then seek to the saved position ── */
  useEffect(() => {
    if (!episode) return
    setActiveCue(-1)
    setCapQuery('')
    setRail('captions')
    setTranscript(null)
    setTranscriptState('idle')
    setShowEpisodes([])
    setDuration(episode.duration || 0)
    paint(0, episode.duration || 0)
    const el = audioRef.current
    if (!el) return
    const saved = resume[episode.id]?.t
    if (saved && saved > 15) {
      // Applied on loadedmetadata too — Safari ignores currentTime before the
      // media has a duration.
      try { el.currentTime = saved } catch { /* not seekable yet */ }
      paint(saved, episode.duration || 0)
    }
    // `resume` is intentionally not a dep: re-reading it on every position save
    // would re-run this reset mid-episode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode?.id, paint])

  /* ── play/pause, rate, volume follow the store ───────────── */
  useEffect(() => {
    const el = audioRef.current
    if (!el || !episode) return
    if (playing) {
      const p = el.play()
      if (p?.catch) p.catch(() => setPlaying(false)) // autoplay blocked / bad url
    } else {
      el.pause()
    }
    // `audioMode` is a dep because the CORS fallback swaps the src: without it
    // the element reloads and then sits there paused while the store still says
    // it is playing.
  }, [playing, episode?.id, audioMode, setPlaying])

  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate }, [rate, episode?.id])
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume }, [volume, episode?.id])

  /* ── Can we read this waveform? ────────────────────────────
     A real visualizer needs an untainted stream, which needs CORS. Rather than
     probing first (a redirecting URL fails a cors-mode fetch even when the
     final response allows it — measured on the dev sample), attempt CORS
     OPTIMISTICALLY and drop to a plain load on the error event. The retry costs
     nothing audible: it happens before the first frame of audio has played. */
  useEffect(() => { setAudioMode('cors') }, [episode?.id])
  useEffect(() => { setMinimized(false); setSynOpen(false) }, [episode?.id])

  /* ── Transcript: the caption source ──────────────────────── */
  useEffect(() => {
    if (!episode) return
    const src = episode.transcripts?.[0]
    if (!src?.url) { setTranscriptState('none'); return }
    let cancelled = false
    setTranscriptState('loading')
    mediaApi.getTranscript(src.url, src.type)
      .then(res => {
        if (cancelled) return
        if (res?.kind === 'timed' || res?.kind === 'text') {
          setTranscript(res)
          setTranscriptState('ready')
        } else {
          setTranscriptState('none')
        }
      })
      .catch(() => { if (!cancelled) setTranscriptState('none') })
    return () => { cancelled = true }
  }, [episode?.id])

  /* ── More from this show (only once the rail is opened) ──── */
  useEffect(() => {
    if (rail !== 'show' || !episode?.feedId || showEpisodes.length) return
    let cancelled = false
    mediaApi.getShowEpisodes(episode.feedId, { max: 20 })
      .then(r => { if (!cancelled) setShowEpisodes((r?.items || []).filter(e => e.id !== episode.id)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [rail, episode?.feedId, episode?.id, showEpisodes.length])

  /* ── Transport helpers ───────────────────────────────────── */
  const seekTo = useCallback((seconds) => {
    const el = audioRef.current
    if (!el) return
    const d = el.duration || duration || 0
    const next = Math.max(0, Math.min(d ? d - 0.5 : seconds, seconds))
    try { el.currentTime = next } catch { /* not seekable */ }
    paint(next, d)
  }, [duration, paint])

  const skip = useCallback((delta) => {
    const el = audioRef.current
    if (el) seekTo((el.currentTime || 0) + delta)
  }, [seekTo])

  const cues = transcript?.kind === 'timed' ? transcript.cues : null

  const onTimeUpdate = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    const cur = el.currentTime || 0
    const dur = el.duration || duration || 0
    if (!scrubbing) paint(cur, dur)

    if (cues && cues.length) {
      // Binary search — a linear scan over 3k cues, 4x/second, is real work.
      let lo = 0, hi = cues.length - 1, found = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (cues[mid].s <= cur) { found = mid; lo = mid + 1 } else { hi = mid - 1 }
      }
      if (found !== -1 && cur > cues[found].e + 4) found = -1 // long gap: nothing is being said
      setActiveCue(prev => (prev === found ? prev : found))
    }

    // Position memory, throttled — this is the only store write while playing.
    const now = Date.now()
    if (now - lastSaveRef.current > 8000) {
      lastSaveRef.current = now
      savePosition(episode?.id, cur, dur)
    }
  }, [cues, duration, paint, savePosition, episode?.id, scrubbing])

  const onLoadedMeta = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    const d = el.duration && Number.isFinite(el.duration) ? el.duration : (episode?.duration || 0)
    setDuration(d)
    const saved = resume[episode?.id]?.t
    if (saved && saved > 15 && Math.abs((el.currentTime || 0) - saved) > 2) {
      try { el.currentTime = saved } catch { /* ignore */ }
    }
    paint(el.currentTime || 0, d)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode?.id, episode?.duration, paint])

  const onEnded = useCallback(() => {
    savePosition(episode?.id, duration, duration)
    podcastNext()
  }, [savePosition, episode?.id, duration, podcastNext])

  /* ── Scrub interaction ───────────────────────────────────── */
  const seekFromEvent = useCallback((clientX) => {
    const bar = seekRef.current
    const el = audioRef.current
    if (!bar || !el) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const d = el.duration || duration || 0
    if (!d) return
    seekTo(ratio * d)
  }, [duration, seekTo])

  const onSeekPointerDown = useCallback((e) => {
    e.preventDefault()
    setScrubbing(true)
    seekFromEvent(e.clientX)
    const move = (ev) => seekFromEvent(ev.clientX)
    const up = () => {
      setScrubbing(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [seekFromEvent])

  /* ── Persist position on pause / unload ──────────────────── */
  useEffect(() => {
    if (playing) return
    const el = audioRef.current
    if (el && episode) savePosition(episode.id, el.currentTime || 0, el.duration || duration || 0)
  }, [playing, episode, duration, savePosition])

  useEffect(() => {
    const flush = () => {
      const el = audioRef.current
      const ep = useMediaStore.getState().podcastEpisode
      if (el && ep) savePosition(ep.id, el.currentTime || 0, el.duration || 0)
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flush)
    }
  }, [savePosition])

  /* ── OS media controls (lock screen, headset buttons) ────── */
  useEffect(() => {
    if (!episode || !('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: episode.title || '',
        artist: episode.channel?.name || '',
        album: 'Spectre AI Media Center',
        artwork: episode.thumbnail ? [{ src: episode.thumbnail, sizes: '512x512', type: 'image/jpeg' }] : [],
      })
      navigator.mediaSession.setActionHandler('play', () => setPlaying(true))
      navigator.mediaSession.setActionHandler('pause', () => setPlaying(false))
      navigator.mediaSession.setActionHandler('seekbackward', () => skip(-SKIP_BACK))
      navigator.mediaSession.setActionHandler('seekforward', () => skip(SKIP_FWD))
      navigator.mediaSession.setActionHandler('nexttrack', () => podcastNext())
      navigator.mediaSession.setActionHandler('previoustrack', () => podcastPrev())
    } catch { /* MediaMetadata unsupported */ }
  }, [episode, setPlaying, skip, podcastNext, podcastPrev])

  useEffect(() => {
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused' } catch { /* ignore */ }
    }
  }, [playing])

  /* ── Keyboard (immersive only, never steals from inputs) ─── */
  useEffect(() => {
    if (!immersive || !episode) return
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return
      if (e.key === 'Escape') { closeImmersive(); return }
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); skip(-SKIP_BACK); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); skip(SKIP_FWD) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [immersive, episode, closeImmersive, togglePlay, skip])

  /* ── Tell the app a bar is docked ────────────────────────
     The bar is fixed to the bottom edge, so the floating chrome (Monarch FAB,
     video mini player) and the page's own bottom padding step over it. */
  useEffect(() => {
    const docked = !!episode && !immersive
    document.body.classList.toggle('spectre-podcast-docked', docked)
    return () => document.body.classList.remove('spectre-podcast-docked')
  }, [episode, immersive])

  /* ── Lock body scroll behind the immersive layer ─────────── */
  useEffect(() => {
    if (!immersive || !episode) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [immersive, episode])

  if (!episode) return null

  const showName = episode.channel?.name || episode.showTitle || ''
  const upNext = queue.slice(queueIndex + 1)
  const totalLabel = fmtDuration(duration || episode.duration || 0) || '--:--'

  const transportBtn = (
    <button
      type="button"
      className="spp-play"
      onClick={togglePlay}
      aria-label={playing ? t('mediaCenter.podcastPlayer.pause') : t('mediaCenter.podcastPlayer.play')}
    >
      {playing ? I.pause(20) : I.play(20)}
    </button>
  )

  /* ── The audio element: mounted once, never inside a branch ── */
  const audio = (
    <audio
      ref={audioRef}
      src={episode.audioUrl}
      crossOrigin={audioMode === 'cors' ? 'anonymous' : undefined}
      preload="metadata"
      onTimeUpdate={onTimeUpdate}
      onLoadedMetadata={onLoadedMeta}
      onDurationChange={onLoadedMeta}
      onEnded={onEnded}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onError={() => {
        // A host without CORS headers refuses to load at all under
        // crossOrigin="anonymous". Fall back to a plain load (the element
        // reloads with the attribute removed) and keep the visualizer ambient.
        if (audioMode === 'cors') { setAudioMode('plain'); return }
        setPlaying(false)
      }}
    />
  )

  /* ── Docked player ───────────────────────────────────────
     A floating card on desktop (the same language as the Spotify dock it sits
     beside), a full-width bar on a phone. It is draggable because it is a
     persistent overlay: whatever corner it defaults to, it covers that corner
     for the whole session, and only the user knows which corner they need. */
  const miniBar = (
    <div
      className={`spp-mini${dock.dragging ? ' is-dragging' : ''}${dock.hasCustomPos ? ' is-moved' : ''}${minimized ? ' is-min' : ''}${synOpen ? ' has-syn' : ''}`}
      role="region"
      aria-label={t('mediaCenter.podcastPlayer.nowPlaying')}
      ref={dock.cardRef}
      style={dock.style}
      {...dock.bind}
    >
      <div className="spp-mini-track" aria-hidden="true">
        <span className="spp-mini-fill" ref={miniFillRef} />
      </div>
      {synOpen && !minimized && (
        <div className="spp-mini-syn">
          <MediaSynthesis
            kind="podcast"
            id={episode.id}
            title={episode.title}
            source={showName}
            variant="inline"
            autoLoad
            dayMode={dayMode}
          />
        </div>
      )}
      <button
        type="button"
        className="spp-mini-open"
        data-drag-handle=""
        onClick={(e) => { if (dock.moved()) { e.preventDefault(); return } openImmersive() }}
      >
        <span className="spp-mini-art">
          {episode.thumbnail ? <img src={episode.thumbnail} alt="" draggable="false" /> : <span className="spp-eprow-ph" />}
          <span className="spp-mini-expand">{I.expand}</span>
        </span>
        <span className="spp-mini-meta">
          <span className="spp-mini-title">{episode.title}</span>
          <span className="spp-mini-show">{showName}</span>
        </span>
      </button>
      {/* The dock used to carry a 2px progress hairline and no numbers at all,
          so "how long is this and where am I" was unanswerable without opening
          the immersive. Same seek control as the immersive — same refs, same
          handler — because only one of the two views is ever mounted. */}
      <div className="spp-mini-seek">
        <span className="spp-time" ref={timeLabelRef}>0:00</span>
        <div
          className="spp-seek-bar"
          ref={seekRef}
          onPointerDown={onSeekPointerDown}
          role="slider"
          aria-label={t('mediaCenter.podcastPlayer.seek')}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration || 0)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); skip(-SKIP_BACK) }
            if (e.key === 'ArrowRight') { e.preventDefault(); skip(SKIP_FWD) }
          }}
        >
          <span className="spp-seek-fill" ref={fillRef} />
        </div>
        <span className="spp-time spp-time--total">{totalLabel}</span>
      </div>
      <div className="spp-mini-controls">
        <button type="button" className="spp-icon spp-hide-sm" onClick={() => skip(-SKIP_BACK)} aria-label={t('mediaCenter.podcastPlayer.back15')}>{I.back(16)}</button>
        {transportBtn}
        <button type="button" className="spp-icon spp-hide-sm" onClick={() => skip(SKIP_FWD)} aria-label={t('mediaCenter.podcastPlayer.fwd30')}>{I.fwd(16)}</button>
        {/* The same AI read the Spotify dock offers, on the same component — a
            podcast should not be the one place in the app without it. */}
        <button
          type="button"
          className={`spp-icon spp-hide-sm spp-mini-syn-btn${synOpen ? ' is-on' : ''}`}
          onClick={() => { setSynOpen(v => !v); setMinimized(false) }}
          aria-pressed={synOpen}
          aria-label={t('mediaCenter.podcastPlayer.aiSummary', 'AI summary')}
          title={t('mediaCenter.podcastPlayer.aiSummary', 'AI summary')}
        >{I.spark}</button>
        <button
          type="button"
          className="spp-icon spp-hide-sm"
          onClick={() => setMinimized(v => !v)}
          aria-label={minimized ? t('mediaCenter.podcastPlayer.restore', 'Restore player') : t('mediaCenter.podcastPlayer.minimize', 'Minimise player')}
          title={minimized ? t('mediaCenter.podcastPlayer.restore', 'Restore player') : t('mediaCenter.podcastPlayer.minimize', 'Minimise player')}
        >{minimized ? I.expand : I.minimize}</button>
        {dock.hasCustomPos && (
          <button type="button" className="spp-icon spp-hide-sm" onClick={dock.reset} aria-label={t('mediaCenter.podcastPlayer.resetPosition', 'Reset position')} title={t('mediaCenter.podcastPlayer.resetPosition', 'Reset position')}>{I.recenter}</button>
        )}
        <button type="button" className="spp-icon spp-mini-close" onClick={stopPodcast} aria-label={t('mediaCenter.podcastPlayer.stop')}>{I.close(14)}</button>
      </div>
    </div>
  )

  /* ── Immersive ───────────────────────────────────────────── */
  const railTabs = [
    { id: 'captions', label: t('mediaCenter.podcastPlayer.captions') },
    { id: 'ai', label: t('mediaCenter.podcastPlayer.aiRead') },
    { id: 'notes', label: t('mediaCenter.podcastPlayer.notes') },
    { id: 'next', label: t('mediaCenter.podcastPlayer.upNext'), count: upNext.length },
    { id: 'show', label: t('mediaCenter.podcastPlayer.moreFromShow') },
  ]

  const immersiveView = (
    <div className="spp-full" role="dialog" aria-modal="true" aria-label={episode.title}>
      {/* Cinematic backdrop: the episode art, blurred behind a scrim */}
      <div className="spp-bg" aria-hidden="true">
        {episode.thumbnail && <img src={episode.thumbnail} alt="" />}
        <span className="spp-bg-scrim" />
      </div>

      <div className="spp-full-top">
        <button type="button" className="spp-minimize" onClick={closeImmersive}>
          {I.minimize}<span>{t('mediaCenter.podcastPlayer.minimize')}</span>
        </button>
        <span className="spp-live-label">{t('mediaCenter.podcastPlayer.nowPlaying')}</span>
        <button type="button" className="spp-close" onClick={stopPodcast} aria-label={t('mediaCenter.podcastPlayer.stop')}>{I.close(18)}</button>
      </div>

      <div className="spp-full-body">
        {/* Left — the episode + transport */}
        <div className="spp-stage">
          <div className="spp-art">
            {episode.thumbnail ? <img src={episode.thumbnail} alt="" /> : <span className="spp-eprow-ph" />}
          </div>
          <div className="spp-stage-meta">
            {showName && <span className="spp-show">{showName}</span>}
            <h2 className="spp-title">{episode.title}</h2>
            <div className="spp-pills">
              {episode.category && <span className="spp-pill">{episode.category}</span>}
              {episode.duration ? <span className="spp-pill">{fmtEpLength(episode.duration)}</span> : null}
              {episode.publishedAt && <span className="spp-pill">{relTime(episode.publishedAt, t)}</span>}
              {transcriptState === 'ready' && transcript?.kind === 'timed' && (
                <span className="spp-pill spp-pill--cap">{I.captions}{t('mediaCenter.podcastPlayer.captionsAvailable')}</span>
              )}
            </div>
          </div>

          {/* ── The stage: what is being said, over the voice ──
              A transcript exists for a minority of shows, so this degrades in
              three steps rather than disappearing: lyric lines when we have
              timed cues, the episode line when we do not, and the band alone
              when captions are switched off. */}
          <div className={`spp-stagelive${cues && captionsOn ? ' has-cues' : ''}`}>
            <div className="spp-lyrics" aria-live="polite">
              {cues && captionsOn ? (
                <>
                  <button
                    type="button"
                    className="spp-lyric spp-lyric--prev"
                    disabled={activeCue <= 0}
                    onClick={() => activeCue > 0 && seekTo(cues[activeCue - 1].s)}
                  >
                    {activeCue > 0 ? cues[activeCue - 1].t : ''}
                  </button>
                  <p className="spp-lyric spp-lyric--now">
                    {activeCue >= 0 ? (
                      <>
                        {cues[activeCue].sp && <span className="spp-lyric-sp">{cues[activeCue].sp}</span>}
                        {cues[activeCue].t}
                      </>
                    ) : (
                      <span className="spp-lyric-idle">{playing ? '…' : t('mediaCenter.podcastPlayer.pressPlay')}</span>
                    )}
                  </p>
                  <button
                    type="button"
                    className="spp-lyric spp-lyric--next"
                    disabled={activeCue < 0 || activeCue >= cues.length - 1}
                    onClick={() => activeCue >= 0 && activeCue < cues.length - 1 && seekTo(cues[activeCue + 1].s)}
                  >
                    {activeCue >= 0 && activeCue < cues.length - 1 ? cues[activeCue + 1].t : ''}
                  </button>
                </>
              ) : (
                <p className="spp-lyric spp-lyric--now spp-lyric--plain">
                  {transcriptState === 'loading'
                    ? t('mediaCenter.podcastPlayer.loadingCaptions')
                    : episode.title}
                </p>
              )}
            </div>
            <PodcastVisualizer
              audioRef={audioRef}
              playing={playing}
              dayMode={dayMode}
              live={audioMode === 'cors'}
              height={cues && captionsOn ? 72 : 104}
            />
          </div>

          <div className="spp-seek">
            <span className="spp-time" ref={timeLabelRef}>0:00</span>
            <div
              className="spp-seek-bar"
              ref={seekRef}
              onPointerDown={onSeekPointerDown}
              role="slider"
              aria-label={t('mediaCenter.podcastPlayer.seek')}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration || 0)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') { e.preventDefault(); skip(-SKIP_BACK) }
                if (e.key === 'ArrowRight') { e.preventDefault(); skip(SKIP_FWD) }
              }}
            >
              <span className="spp-seek-fill" ref={fillRef} />
            </div>
            <span className="spp-time spp-time--total">{totalLabel}</span>
          </div>

          <div className="spp-transport">
            <button type="button" className="spp-icon" onClick={podcastPrev} disabled={queueIndex <= 0} aria-label={t('mediaCenter.podcastPlayer.previous')}>{I.prev}</button>
            <button type="button" className="spp-icon spp-icon--lg" onClick={() => skip(-SKIP_BACK)} aria-label={t('mediaCenter.podcastPlayer.back15')}>{I.back(20)}</button>
            {transportBtn}
            <button type="button" className="spp-icon spp-icon--lg" onClick={() => skip(SKIP_FWD)} aria-label={t('mediaCenter.podcastPlayer.fwd30')}>{I.fwd(20)}</button>
            <button type="button" className="spp-icon" onClick={podcastNext} disabled={queueIndex >= queue.length - 1} aria-label={t('mediaCenter.podcastPlayer.next')}>{I.next}</button>
          </div>

          <div className="spp-tools">
            <div className="spp-rate-wrap">
              <button type="button" className="spp-chip" onClick={() => setRatesOpen(o => !o)} aria-expanded={ratesOpen}>
                {rate}×
              </button>
              {ratesOpen && (
                <div className="spp-rate-menu">
                  {RATES.map(r => (
                    <button key={r} type="button" className={`spp-rate${r === rate ? ' is-active' : ''}`} onClick={() => { setRate(r); setRatesOpen(false) }}>
                      {r}×
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className={`spp-chip${captionsOn ? ' is-on' : ''}`}
              onClick={toggleCaptions}
              aria-pressed={captionsOn}
            >
              {I.captions}<span>{t('mediaCenter.podcastPlayer.captions')}</span>
            </button>
            <button type="button" className={`spp-chip${isSaved ? ' is-on' : ''}`} onClick={() => toggleSave(episode)}>
              {I.bookmark(isSaved)}<span>{isSaved ? t('mediaCenter.podcastPlayer.saved') : t('mediaCenter.podcastPlayer.save')}</span>
            </button>
            <div className="spp-vol">
              <button type="button" className="spp-icon" onClick={() => setVolume(volume > 0 ? 0 : 1)} aria-label={t('mediaCenter.podcastPlayer.volume')}>
                {volume > 0 ? I.volume : I.mute}
              </button>
              <input
                type="range" min="0" max="1" step="0.05" value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="spp-vol-range"
                aria-label={t('mediaCenter.podcastPlayer.volume')}
              />
            </div>
          </div>
        </div>

        {/* Right — captions and everything else about this episode */}
        <div className="spp-rail">
          <div className="spp-rail-tabs" role="tablist">
            {railTabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={rail === tab.id}
                className={`spp-rail-tab${rail === tab.id ? ' is-active' : ''}`}
                onClick={() => setRail(tab.id)}
              >
                {tab.label}
                {tab.count > 0 && <span className="spp-rail-count">{tab.count}</span>}
              </button>
            ))}
          </div>

          <div className="spp-rail-body">
            {rail === 'captions' && (
              <>
                {transcriptState === 'loading' && (
                  <div className="spp-rail-loading">
                    {[0, 1, 2, 3, 4].map(i => (
                      <div key={i} className="spp-skel animate-shimmer" style={{ animationDelay: `${i * 0.06}s`, width: `${92 - i * 9}%` }} />
                    ))}
                  </div>
                )}

                {transcriptState === 'ready' && transcript?.kind === 'timed' && (
                  <>
                    <div className="spp-caps-search">
                      {I.search}
                      <input
                        type="text"
                        value={capQuery}
                        onChange={(e) => setCapQuery(e.target.value)}
                        placeholder={t('mediaCenter.podcastPlayer.searchCaptions')}
                        className="spp-caps-input"
                      />
                      {capQuery && (
                        <button type="button" className="spp-icon" onClick={() => setCapQuery('')} aria-label={t('mediaCenter.podcastPlayer.clear')}>{I.close(12)}</button>
                      )}
                    </div>
                    <CaptionRail
                      transcript={transcript}
                      activeIndex={captionsOn ? activeCue : -1}
                      onSeek={seekTo}
                      query={capQuery}
                      t={t}
                    />
                  </>
                )}

                {transcriptState === 'ready' && transcript?.kind === 'text' && (
                  <div className="spp-transcript-text">
                    <p className="spp-rail-note">{t('mediaCenter.podcastPlayer.untimedTranscript')}</p>
                    {transcript.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
                  </div>
                )}

                {transcriptState === 'none' && (
                  <div className="spp-rail-empty">
                    <p className="spp-rail-empty-title">{t('mediaCenter.podcastPlayer.noCaptionsTitle')}</p>
                    <p className="spp-rail-empty-desc">{t('mediaCenter.podcastPlayer.noCaptionsDesc')}</p>
                    <div className="spp-rail-empty-actions">
                      <button type="button" className="spp-chip is-on" onClick={() => setRail('ai')}>
                        {t('mediaCenter.podcastPlayer.aiRead')}
                      </button>
                      <button type="button" className="spp-chip" onClick={() => setRail('notes')}>
                        {t('mediaCenter.podcastPlayer.readNotes')}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {rail === 'ai' && (
              <div className="spp-ai">
                <MediaSynthesis
                  kind="podcast"
                  id={episode.id}
                  title={episode.title}
                  source={showName}
                  variant="panel"
                  autoLoad
                  dayMode={dayMode}
                />
              </div>
            )}

            {rail === 'notes' && (
              <div className="spp-notes">
                {episode.notes || episode.description
                  ? <p className="spp-notes-body">{episode.notes || episode.description}</p>
                  : <p className="spp-rail-empty-desc">{t('mediaCenter.podcastPlayer.noNotes')}</p>}
                {episode.tags?.length > 0 && (
                  <div className="spp-tags">
                    {episode.tags.map(tag => <span key={tag} className="spp-tag">${tag}</span>)}
                  </div>
                )}
                {episode.url && (
                  <a className="spp-chip" href={episode.url} target="_blank" rel="noopener noreferrer">
                    {t('mediaCenter.podcastPlayer.openEpisode')}
                  </a>
                )}
              </div>
            )}

            {rail === 'next' && (
              upNext.length
                ? <div className="spp-eplist">{upNext.map(ep => <EpisodeRow key={ep.id} ep={ep} onPlay={(e) => playPodcast(e, queue)} />)}</div>
                : <p className="spp-rail-empty-desc">{t('mediaCenter.podcastPlayer.queueEmpty')}</p>
            )}

            {rail === 'show' && (
              showEpisodes.length
                ? <div className="spp-eplist">{showEpisodes.map(ep => <EpisodeRow key={ep.id} ep={ep} onPlay={(e) => playPodcast(e, showEpisodes)} />)}</div>
                : <div className="spp-rail-loading">
                    {[0, 1, 2].map(i => <div key={i} className="spp-skel spp-skel--row animate-shimmer" style={{ animationDelay: `${i * 0.06}s` }} />)}
                  </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(
    <div className={`spp-root${dayMode ? ' day-mode' : ''}`}>
      {audio}
      {immersive ? immersiveView : miniBar}
    </div>,
    document.body,
  )
}

export default PodcastPlayer
