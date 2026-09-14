/**
 * Serenity — a market break.
 *
 * Founder 2026-08-28: "a blue sponge button that slightly breathes… if someone
 * clicks it they take a market break… a visualisation of calmness with nice
 * quotes for when it gets too much for traders or they're overthinking."
 *
 * Two pieces: the button that lives in the Today head, and the room it opens.
 *
 * The room is deliberately NOT another Spectre surface. Every other screen in
 * this app is trying to tell you something; this one is trying to stop telling
 * you things. No numbers, no tickers, no live anything — the market is still
 * there when you close it. That absence IS the feature, so resist adding data
 * here later.
 *
 * The breath is a real one: 4s in, 2s hold, 6s out. A longer exhale than inhale
 * is the part that actually settles a nervous system, which is why the ring is
 * not a symmetric pulse. The orb, the ring and the three labels all run off ONE
 * 12s CSS timeline so they cannot drift out of sync with each other the way a
 * JS-driven version would.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import useSettingsStore from '@/store/useSettingsStore'
import LiteMusic from './lite-music'
import SerenityOrbCanvas from './lite-serenity-orb'
import './lite-serenity.css'

/**
 * Quotes carry their real source. Two registers on purpose — the market ones
 * say "this feeling is part of the job", the human ones say "and you are not
 * only your positions". Anything whose attribution is genuinely traditional is
 * labelled as such rather than pinned on a person.
 */
const QUOTES = [
  { t: 'The stock market is a device for transferring money from the impatient to the patient.', a: 'Warren Buffett' },
  { t: 'The investor’s chief problem — and even his worst enemy — is likely to be himself.', a: 'Benjamin Graham' },
  { t: 'In the short run the market is a voting machine, but in the long run it is a weighing machine.', a: 'Benjamin Graham' },
  { t: 'You get recessions, you have stock market declines. If you don’t understand that’s going to happen, then you’re not ready.', a: 'Peter Lynch' },
  { t: 'The four most dangerous words in investing are: this time it’s different.', a: 'Sir John Templeton' },
  { t: 'Risk comes from not knowing what you are doing.', a: 'Warren Buffett' },
  { t: 'You have power over your mind — not outside events. Realize this, and you will find strength.', a: 'Marcus Aurelius' },
  { t: 'We suffer more often in imagination than in reality.', a: 'Seneca' },
  { t: 'Feelings come and go like clouds in a windy sky. Conscious breathing is my anchor.', a: 'Thich Nhat Hanh' },
  { t: 'The quieter you become, the more you are able to hear.', a: 'Ram Dass' },
  { t: 'Almost everything will work again if you unplug it for a few minutes — including you.', a: 'Anne Lamott' },
  { t: 'Nature does not hurry, yet everything is accomplished.', a: 'Attributed to Lao Tzu' },
  { t: 'Tension is who you think you should be. Relaxation is who you are.', a: 'Chinese proverb' },
]

const QUOTE_MS = 15000 // ~ one breath cycle plus a beat, so they never race

/* ── The button ───────────────────────────────────────────────────────────── */

export function SerenityButton({ onOpen }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className="lite-pill lite-serenity-btn"
      onClick={onOpen}
      title={t('lite.serenity.hint', 'Take a market break')}
    >
      <span className="lite-serenity-orb" aria-hidden />
      {t('lite.serenity.label', 'Serenity')}
    </button>
  )
}

/* ── The room ─────────────────────────────────────────────────────────────── */

export function SerenityRoom({ onClose }) {
  const { t } = useTranslation()
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * QUOTES.length))
  const [shown, setShown] = useState(true)
  const musicSource = useSettingsStore((s) => s.liteMusicSource)
  const setMusicSource = useSettingsStore((s) => s.setLiteMusicSource)
  const musicVolume = useSettingsStore((s) => s.liteMusicVolume)
  const setMusicVolume = useSettingsStore((s) => s.setLiteMusicVolume)
  const closeRef = useRef(null)
  const [immersive, setImmersive] = useState(false)
  const immersiveRef = useRef(false)

  // Rotate the quote: fade out, swap, fade in. Never repeats the current one.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return
      setShown(false)
      window.setTimeout(() => {
        setIdx((i) => (i + 1 + Math.floor(Math.random() * (QUOTES.length - 1))) % QUOTES.length)
        setShown(true)
      }, 900)
    }, QUOTE_MS)
    return () => window.clearInterval(id)
  }, [])

  // Immersive asks the browser for real fullscreen — the chrome around the
  // window is part of what makes this feel like an app rather than a place.
  // The request needs a user gesture, which the button click provides.
  const toggleImmersive = useCallback(() => {
    setImmersive((on) => {
      const next = !on
      try {
        if (next && !document.fullscreenElement) document.documentElement.requestFullscreen?.()
        else if (!next && document.fullscreenElement) document.exitFullscreen?.()
      } catch { /* fullscreen refused — the layout change still applies */ }
      return next
    })
  }, [])

  // The browser can leave fullscreen without us (its own Esc, the F11 key, a
  // window change). Follow it, or the layout claims to be immersive when the
  // chrome is back.
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setImmersive(false) }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // Escape closes, and focus starts on the way out — a calm room should never
  // feel like something you are trapped in.
  useEffect(() => {
    // 🪤 Lite binds its OWN Escape to onExit (lite-page.jsx), so a plain
    // bubble-phase listener closed the room AND dropped the user out of Lite
    // entirely — measured: /lite -> /. Claim the key in CAPTURE so nothing
    // below sees it. The fullscreen TV overlay in the same file already does
    // this; it is the house pattern for any Lite overlay with an Escape.
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      // One step at a time: immersive first, the room second. Escaping straight
      // out of a fullscreen breath back to a trading screen is a jolt.
      if (immersiveRef.current) {
        setImmersive(false)
        try { if (document.fullscreenElement) document.exitFullscreen?.() } catch { /* noop */ }
        return
      }
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    closeRef.current?.focus()
    // The page behind must not scroll while the room is up.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prev
    }
  }, [onClose])

  useEffect(() => { immersiveRef.current = immersive }, [immersive])

  const quote = QUOTES[idx]

  return createPortal(
    <div className={`lsr${immersive ? ' lsr--immersive' : ''}`} role="dialog" aria-modal="true" aria-label={t('lite.serenity.label', 'Serenity')}>
      <div className="lsr-sky" aria-hidden />

      {/* The room breathes, not just the orb. An aurora field that swells on the
          same 12s timeline, and waves that leave the centre on each inhale and
          travel past the edge of the screen — so at 2000px wide the breath owns
          the whole field instead of being a dot in a void. All transform and
          opacity, no backdrop-filter: this has to stay free to composite. */}
      <div className="lsr-field" aria-hidden>
        <span className="lsr-blob lsr-blob--1" />
        <span className="lsr-blob lsr-blob--2" />
        <span className="lsr-blob lsr-blob--3" />
      </div>
      <div className="lsr-stars" aria-hidden>
        <span className="lsr-starlayer lsr-starlayer--far" />
        <span className="lsr-starlayer lsr-starlayer--mid" />
        <span className="lsr-starlayer lsr-starlayer--near" />
      </div>

      <div className="lsr-stage">
        {/* The breath. aria-hidden: a screen reader gets the written guide
            below instead of a decorative ring. */}
        <div className="lsr-breath">
          {/* No track, no marker. The moving surface IS the progress now; a
              ring around it read as a loading spinner. */}
          <span className="lsr-orb" aria-hidden>
            {/* The moving marble surface. Falls back to the CSS glass below it
                when WebGL is missing or motion is reduced. */}
            <SerenityOrbCanvas />
            <span className="lsr-orb-spec" />
            <span className="lsr-orb-rim" />
          </span>
          {/* The cue sits INSIDE the glass, like the reference. */}
          <div className="lsr-guide" aria-live="off">
            <span className="lsr-cue lsr-cue--in">{t('lite.serenity.in', 'Breathe in')}</span>
            <span className="lsr-cue lsr-cue--hold">{t('lite.serenity.hold', 'Hold')}</span>
            <span className="lsr-cue lsr-cue--out">{t('lite.serenity.out', 'Breathe out')}</span>
          </div>
        </div>

        <figure className={`lsr-quote${shown ? ' is-shown' : ''}`}>
          <blockquote>{quote.t}</blockquote>
          <figcaption>{quote.a}</figcaption>
        </figure>
      </div>

      <div className="lsr-foot">
        <button
          type="button"
          className={`lsr-close lsr-immerse${immersive ? ' is-on' : ''}`}
          onClick={toggleImmersive}
          aria-pressed={immersive}
        >
          {immersive
            ? t('lite.serenity.exitImmersive', 'Leave immersive')
            : t('lite.serenity.immersive', 'Go deeper')}
        </button>
        <LiteMusic
          sourceId={musicSource}
          setSourceId={setMusicSource}
          volume={musicVolume}
          setVolume={setMusicVolume}
        />
        <button ref={closeRef} type="button" className="lsr-close" onClick={onClose}>
          {t('lite.serenity.back', 'Back to the market')}
        </button>
      </div>
    </div>,
    document.body,
  )
}

/** Button + room together, with the open state owned here. */
export default function LiteSerenity() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const room = useMemo(() => (open ? <SerenityRoom onClose={close} /> : null), [open, close])
  return (
    <>
      <SerenityButton onOpen={() => setOpen(true)} />
      {room}
    </>
  )
}
