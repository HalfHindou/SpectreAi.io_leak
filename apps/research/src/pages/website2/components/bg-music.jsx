import { useEffect, useState } from 'react'

// Module-level audio singleton so music survives route changes between
// /website2 and /lp. Lazy-created on first access; only a single <audio>
// exists at a time and both pages subscribe to the same play/pause state.
let audioEl = null
const subscribers = new Set()

function getAudio() {
  if (typeof window === 'undefined') return null
  if (!audioEl) {
    audioEl = new Audio('/audio/throne-of-ashes.mp3')
    audioEl.loop = true
    audioEl.volume = 0.35
    audioEl.preload = 'auto'
    const notify = () => subscribers.forEach((fn) => fn(!audioEl.paused))
    audioEl.addEventListener('play', notify)
    audioEl.addEventListener('pause', notify)
    audioEl.addEventListener('ended', notify)
  }
  return audioEl
}

export function useBgMusic() {
  const [playing, setPlaying] = useState(() => {
    const a = getAudio()
    return a ? !a.paused : false
  })
  useEffect(() => {
    subscribers.add(setPlaying)
    return () => {
      subscribers.delete(setPlaying)
    }
  }, [])
  const toggle = () => {
    const a = getAudio()
    if (!a) return
    if (a.paused) {
      const p = a.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    } else {
      a.pause()
    }
  }
  return { playing, toggle }
}

// Drop-in drawer row that matches the rest of the w2-mobile-drawer-link styling.
export default function BgMusicToggle({ onActivate }) {
  const { playing, toggle } = useBgMusic()
  return (
    <button
      type="button"
      className="w2-mobile-drawer-link"
      onClick={() => {
        toggle()
        if (onActivate) onActivate()
      }}
      aria-pressed={playing}
    >
      <span className="w2-mobile-drawer-link-icon" aria-hidden="true">
        {playing ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="6 4 20 12 6 20 6 4" />
          </svg>
        )}
      </span>
      <span className="w2-mobile-drawer-link-label">{playing ? 'Pause music' : 'Play music'}</span>
      <svg className="w2-mobile-drawer-link-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {playing ? <path d="M19 12H5" /> : <path d="M9 18l6-6-6-6" />}
      </svg>
    </button>
  )
}
