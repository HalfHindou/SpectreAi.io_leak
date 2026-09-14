/**
 * FeaturedHero — the Discover marquee.
 * Left: large featured item (play, editorial title, thesis, meta, actions).
 * Right: "New Releases" side column (compact rows).
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import LiveBadge from './live-badge'
import SpotifyCard from './spotify-card'
import { fmtDuration, fmtMinutes, fmtCompact, relTime } from './media-format'

const ROTATE_MS = 8000

const PlayGlyph = ({ size = 20 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <polygon points="6,4 20,12 6,20" fill="currentColor" />
  </svg>
)

const BookmarkIcon = ({ filled }) => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
)

const SideRow = ({ item, onPlay, t }) => {
  if (!item) return null
  const when = relTime(item.publishedAt, t)
  const mins = fmtMinutes(item.duration)
  const art = item.thumbnail || item.channel?.avatar
  return (
    <button type="button" className="mcx-side-row" onClick={() => onPlay?.(item)}>
      <span className="mcx-side-thumb">
        {art ? <img src={art} alt="" loading="lazy" /> : <span className="mcx-side-thumb--ph" />}
        <span className="mcx-side-play"><PlayGlyph size={14} /></span>
        {item.type === 'live' && <LiveBadge className="mcx-side-live" />}
      </span>
      <span className="mcx-side-body">
        {item.category && <span className="mcx-side-cat" data-cat={item.category}>{item.category}</span>}
        <span className="mcx-side-title" title={item.title}>{item.title}</span>
        <span className="mcx-side-meta">
          {item.channel?.name}
          {when && <> · {when}</>}
          {mins > 0 && <> · {t('mediaCenter.discover.watch', { n: mins })}</>}
        </span>
      </span>
    </button>
  )
}

const FeaturedHero = ({ item, rotation, podcasts = [], onPlay, onToggleSave, isSaved }) => {
  const { t } = useTranslation()
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)

  // The rotation set: up to 5 freshest videos. Falls back to the single item.
  const slides = useMemo(() => {
    const list = (rotation && rotation.length ? rotation : [item]).filter(Boolean)
    const seen = new Set()
    return list.filter(v => v.id && !seen.has(v.id) && seen.add(v.id)).slice(0, 5)
  }, [rotation, item])

  // Auto-advance
  useEffect(() => {
    if (paused || slides.length < 2) return
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      setIdx(i => (i + 1) % slides.length)
    }, ROTATE_MS)
    return () => clearInterval(id)
  }, [paused, slides.length])

  const safeIdx = idx % Math.max(slides.length, 1)
  const active = slides[safeIdx] || item
  if (!active) return null

  const isLive = active.type === 'live'
  const duration = fmtDuration(active.duration)
  const mins = fmtMinutes(active.duration)
  const when = relTime(active.publishedAt, t)
  const views = fmtCompact(active.viewCount)

  return (
    <section className="mcx-hero">
      <div
        className="mcx-hero-main"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <button
          type="button"
          className="mcx-hero-stage"
          onClick={() => onPlay?.(active)}
          aria-label={t('mediaCenter.mediaCard.playAria', { title: active.title })}
        >
          {active.thumbnail
            ? <img key={active.id} src={active.thumbnail} alt="" className="mcx-hero-img mcx-hero-img--rotate" />
            : <span className="mcx-hero-img mcx-hero-img--ph" aria-hidden="true" />}
          <span className="mcx-hero-scrim" aria-hidden="true" />

          <span className="mcx-hero-badges">
            <span className="mcx-hero-flag">{t('mediaCenter.discover.featured')}</span>
            {active.category && <span className="mcx-cat mcx-cat--solid" data-cat={active.category}>{active.category}</span>}
          </span>

          {isLive ? <LiveBadge className="mcx-hero-live" /> : duration ? <span className="mcx-hero-dur">{duration}</span> : null}

          <span className="mcx-hero-overlay">
            <span className="mcx-hero-meta">
              <span className="mcx-hero-chan">{active.channel?.name}</span>
              {when && <span className="mcx-dotsep" aria-hidden="true">·</span>}
              {when && <span>{when}</span>}
              {views && <span className="mcx-dotsep" aria-hidden="true">·</span>}
              {views && <span>{views}</span>}
            </span>
            <h1 className="mcx-hero-title">{active.title}</h1>
            {active.description && <p className="mcx-hero-desc">{active.description}</p>}
          </span>

          {slides.length > 1 && (
            <span className="mcx-hero-dots" onClick={(e) => e.stopPropagation()}>
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  className={`mcx-hero-dot${i === safeIdx ? ' is-active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setIdx(i) }}
                  aria-label={t('mediaCenter.featuredSlide', 'Featured {{n}}', { n: i + 1 })}
                />
              ))}
            </span>
          )}
        </button>

        <div className="mcx-hero-cta">
          <button type="button" className="mcx-hero-play" onClick={() => onPlay?.(active)}>
            <PlayGlyph />
            <span>{t('mediaCenter.discover.playNow')}</span>
            {mins > 0 && <span className="mcx-hero-play-dur">{t('mediaCenter.discover.watch', { n: mins })}</span>}
          </button>
          <button
            type="button"
            className={`mcx-hero-save${isSaved && isSaved(active.id) ? ' is-saved' : ''}`}
            onClick={() => onToggleSave?.(active)}
            title={t('mediaCenter.mediaCard.saveForLater')}
          >
            <BookmarkIcon filled={isSaved && isSaved(active.id)} />
          </button>
        </div>
      </div>

      {podcasts.length > 0 && (
        <aside className="mcx-hero-side">
          <h2 className="mcx-side-head">{t('mediaCenter.spotify.bestPodcasts')}</h2>
          <div className="mcx-side-list mcx-side-list--sp">
            {podcasts.map((s, i) => <SpotifyCard key={s.id} show={s} variant="row" index={i} />)}
          </div>
        </aside>
      )}
    </section>
  )
}

export default FeaturedHero
