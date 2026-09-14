/**
 * ShortsViewer - full-screen vertical shorts viewer.
 * Arrow up/down (or left/right) to navigate, Escape to close.
 * Wheel + touch-swipe paging, lazy YouTube embed with a fallback CTA.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { fmtCompact, relTime } from './media-format'
import './shorts-viewer.css'

/* ── Extract YouTube video ID ────────────────────── */

function getYouTubeId(item) {
  if (!item) return null
  const id = item.id || ''
  if (id.startsWith('yt_')) return id.slice(3)
  if (id.length === 11) return id
  // Try URL
  if (item.url) {
    const match = item.url.match(/(?:youtu\.be\/|v=|\/shorts\/)([a-zA-Z0-9_-]{11})/)
    if (match) return match[1]
  }
  return id
}

/* ── Icons ───────────────────────────────────────── */

const IconUp = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 15l-6-6-6 6" />
  </svg>
)

const IconDown = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
)

const IconClose = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
)

/* ── ShortsViewer Component ──────────────────────── */

const ShortsViewer = ({ shorts = [], startIndex = 0, dayMode = false, onClose, onLoadMore, hasMore }) => {
  const { t } = useTranslation()
  const [currentIndex, setCurrentIndex] = useState(startIndex)
  const [transitioning, setTransitioning] = useState(false)
  const [direction, setDirection] = useState(null) // 'up' or 'down'
  const containerRef = useRef(null)
  const touchStartY = useRef(null)

  const currentShort = shorts[currentIndex]
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < shorts.length - 1

  /* ── Navigate ──────────────────────────────── */
  const goTo = useCallback((idx, dir) => {
    if (idx < 0 || idx >= shorts.length || transitioning) return
    setDirection(dir)
    setTransitioning(true)
    setTimeout(() => {
      setCurrentIndex(idx)
      setTransitioning(false)
      setDirection(null)
    }, 250)
    // Load more when near the end
    if (idx >= shorts.length - 3 && hasMore && onLoadMore) {
      onLoadMore()
    }
  }, [shorts.length, transitioning, hasMore, onLoadMore])

  const goNext = useCallback(() => {
    if (hasNext) goTo(currentIndex + 1, 'up')
  }, [currentIndex, hasNext, goTo])

  const goPrev = useCallback(() => {
    if (hasPrev) goTo(currentIndex - 1, 'down')
  }, [currentIndex, hasPrev, goTo])

  /* ── Keyboard ──────────────────────────────── */
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); goPrev() }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); goNext() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, goNext, goPrev])

  /* ── Scroll wheel ──────────────────────────── */
  useEffect(() => {
    let cooldown = false
    const handleWheel = (e) => {
      if (cooldown) return
      if (Math.abs(e.deltaY) < 30) return
      cooldown = true
      if (e.deltaY > 0) goNext()
      else goPrev()
      setTimeout(() => { cooldown = false }, 400)
    }
    const el = containerRef.current
    if (el) el.addEventListener('wheel', handleWheel, { passive: true })
    return () => { if (el) el.removeEventListener('wheel', handleWheel) }
  }, [goNext, goPrev])

  /* ── Touch swipe ───────────────────────────── */
  const handleTouchStart = useCallback((e) => {
    touchStartY.current = e.touches[0].clientY
  }, [])

  const handleTouchEnd = useCallback((e) => {
    if (touchStartY.current === null) return
    const diff = touchStartY.current - e.changedTouches[0].clientY
    touchStartY.current = null
    if (Math.abs(diff) < 50) return
    if (diff > 0) goNext()
    else goPrev()
  }, [goNext, goPrev])

  /* ── Lock body scroll ──────────────────────── */
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  if (!currentShort) return null

  const videoId = getYouTubeId(currentShort)
  const channelName = currentShort.channel?.name || currentShort.channel || ''
  const views = fmtCompact(currentShort.viewCount)
  const posted = relTime(currentShort.publishedAt, t)

  const transitionClass = transitioning
    ? direction === 'up' ? ' sv-exit-up' : ' sv-exit-down'
    : ' sv-enter'

  return createPortal(
    <div
      className={`sv-overlay${dayMode ? ' day-mode' : ''}`}
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Backdrop ────────────────────────── */}
      <div className="sv-backdrop" onClick={onClose} />

      {/* ── Close button ────────────────────── */}
      <button type="button" className="sv-close" onClick={onClose} aria-label={t('mediaCenter.shortsViewer.close')}>
        <IconClose />
      </button>

      {/* ── Counter ─────────────────────────── */}
      <div className="sv-counter">
        <span className="sv-counter-cur">{currentIndex + 1}</span>
        <span className="sv-counter-sep">/</span>
        <span className="sv-counter-total">{shorts.length}</span>
      </div>

      {/* ── Navigation arrows ───────────────── */}
      <div className="sv-nav">
        <button
          type="button"
          className={`sv-nav-btn${!hasPrev ? ' disabled' : ''}`}
          onClick={goPrev}
          disabled={!hasPrev}
          aria-label={t('mediaCenter.shortsViewer.previous')}
        >
          <IconUp />
        </button>
        <button
          type="button"
          className={`sv-nav-btn${!hasNext ? ' disabled' : ''}`}
          onClick={goNext}
          disabled={!hasNext}
          aria-label={t('mediaCenter.shortsViewer.next')}
        >
          <IconDown />
        </button>
      </div>

      {/* ── Video container ─────────────────── */}
      <div className={`sv-player-wrap${transitionClass}`}>
        <div className="sv-player">
          {videoId ? (
            <>
              {/* Thumbnail backdrop — visible if the iframe fails to load
                  (YouTube "This content is blocked" shows as a gray box
                  otherwise). Kept behind the iframe via z-index. */}
              {currentShort.thumbnail && (
                <img
                  src={currentShort.thumbnail}
                  alt=""
                  aria-hidden="true"
                  className="sv-art-backdrop"
                  loading="lazy"
                />
              )}
              <iframe
                key={videoId}
                src={`https://www.youtube.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1`}
                className="sv-iframe"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                title={currentShort.title}
              />
              {/* Always-visible "Watch on YouTube" escape hatch — docked at
                  bottom-center of the video area. If the embed plays fine,
                  users ignore it. If YouTube blocks the embed, this is the
                  primary way to still watch the video. */}
              <a
                className="sv-open-yt"
                href={`https://www.youtube.com/shorts/${videoId}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('mediaCenter.shortsViewer.watchOnYoutube')}
                onClick={(e) => e.stopPropagation()}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
                <span>{t('mediaCenter.shortsViewer.watchOnYoutube')}</span>
              </a>
            </>
          ) : (
            <div className="sv-no-video">
              <img src={currentShort.thumbnail} alt={currentShort.title} className="sv-fallback-img" />
            </div>
          )}
        </div>

        {/* ── Info overlay ────────────────────── */}
        <div className="sv-info">
          <h3 className="sv-title">{currentShort.title}</h3>
          <div className="sv-meta">
            {channelName && <span className="sv-channel">{channelName}</span>}
            {views && <span className="sv-views">{views} {t('mediaCenter.views.label')}</span>}
            {posted && <span className="sv-date">{posted}</span>}
          </div>
        </div>
      </div>

      {/* ── Keyboard hint ───────────────────── */}
      <div className="sv-hint">
        <kbd>↑</kbd><kbd>↓</kbd> {t('mediaCenter.shortsViewer.hintNavigate')} <kbd>Esc</kbd> {t('mediaCenter.shortsViewer.hintClose')}
      </div>
    </div>,
    document.body
  )
}

export default ShortsViewer
