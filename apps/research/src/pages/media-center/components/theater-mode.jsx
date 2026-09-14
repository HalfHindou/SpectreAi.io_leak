/**
 * Theater Mode – full-screen immersive video playback overlay
 * Portal-based, reads all state from useMediaStore
 * Apple Cinematic design: deep overlay, glass controls, queue sidebar
 */
import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import spectreIcons from '@/icons/spectreIcons'
import useMediaStore from '@/store/useMediaStore'
import MediaComments from './media-comments'
import MediaSynthesis from './media-synthesis'
import { flattenDiscover, fmtDuration } from './media-format'
import './theater-mode.css'

/* Player size cycle */
const SIZES = ['default', 'large', 'cinema']

const IconSize = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
  </svg>
)

/* Compact card for the "More to watch" rail */
const MoreCard = ({ video, onPlay }) => (
  <button type="button" className="mc-theater-more-card" onClick={() => onPlay(video)}>
    <span className="mc-theater-more-thumb">
      {video.thumbnail
        ? <img src={video.thumbnail} alt="" loading="lazy" />
        : <span className="mc-theater-more-thumb--ph" />}
      {video.type === 'live'
        ? <span className="mc-theater-more-live">LIVE</span>
        : (video.duration ? <span className="mc-theater-more-dur">{fmtDuration(video.duration)}</span> : null)}
    </span>
    <span className="mc-theater-more-meta">
      <span className="mc-theater-more-title">{video.title}</span>
      <span className="mc-theater-more-chan">{video.channel?.name || video.channel}</span>
    </span>
  </button>
)

/* ── Inline SVG icons for transport controls ─────────────── */

const IconPrev = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
    <path d="M6 4v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    <path d="M18 4l-10 8 10 8V4z" />
  </svg>
)

const IconNext = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
    <path d="M18 4v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    <path d="M6 4l10 8-10 8V4z" />
  </svg>
)

const IconClose = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
)

const IconPlay = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
    <path d="M8 5.14v14l11-7-11-7z" />
  </svg>
)

/* ── Source-based player renderer ────────────────────────── */

// YouTube embed URL. enablejsapi=1 (needed for the onStateChange auto-advance)
// REQUIRES the page origin — without it YouTube throws "Error 153 / Video
// player configuration error" and the player is black.
function ytEmbedSrc(videoId) {
  const origin = typeof window !== 'undefined' ? encodeURIComponent(window.location.origin) : ''
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1&enablejsapi=1&origin=${origin}`
}

function renderPlayer(item, playNext) {
  // Backward compat: old saved items may not have .source
  const source = item.source || 'youtube'

  switch (source) {
    case 'youtube': {
      // Extract YouTube ID: could be "yt_abc123" or just "abc123" (legacy)
      const videoId = item.id?.startsWith('yt_') ? item.id.slice(3) : item.id
      return (
        <iframe
          src={ytEmbedSrc(videoId)}
          title={item.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="mc-theater-iframe"
        />
      )
    }
    case 'twitch':
      return (
        <iframe
          src={item.url}
          title={item.title}
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
          className="mc-theater-iframe"
        />
      )
    case 'podcast-index':
      return (
        <div className="mc-theater-audio">
          <img src={item.thumbnail} alt="" className="mc-theater-audio-art" />
          <h3 className="mc-theater-audio-title">{item.title}</h3>
          <span className="mc-theater-audio-channel">{item.channel?.name}</span>
          <audio
            src={item.audioUrl}
            controls
            autoPlay
            onEnded={playNext}
            className="mc-theater-audio-player"
          />
        </div>
      )
    default: {
      // Legacy fallback: try YouTube embed
      return (
        <iframe
          src={ytEmbedSrc(item.id)}
          title={item.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="mc-theater-iframe"
        />
      )
    }
  }
}

/* ── Queue Item ──────────────────────────────────────────── */

const QueueItem = ({ video, index, isActive, onPlay }) => (
  <button
    type="button"
    className={`mc-theater-queue-item${isActive ? ' active' : ''}`}
    onClick={() => onPlay(index)}
  >
    <div className="mc-theater-queue-thumb">
      <img
        src={video.thumbnail || `https://img.youtube.com/vi/${video.id}/mqdefault.jpg`}
        alt=""
        loading="lazy"
      />
      {isActive && (
        <div className="mc-theater-queue-playing">
          <span className="mc-theater-queue-bar" />
          <span className="mc-theater-queue-bar" />
          <span className="mc-theater-queue-bar" />
        </div>
      )}
    </div>
    <div className="mc-theater-queue-meta">
      <p className="mc-theater-queue-title">{video.title}</p>
      <span className="mc-theater-queue-channel">{video.channel?.name || video.channel}</span>
    </div>
  </button>
)

/* ── Theater Mode Component ──────────────────────────────── */

const TheaterMode = ({ dayMode }) => {
  const { t } = useTranslation()
  const overlayRef = useRef(null)
  const [railOpen, setRailOpen] = useState(true)
  const [railTab, setRailTab] = useState('chat')
  const [size, setSize] = useState('large')

  /* Store selectors */
  const activeVideo = useMediaStore(s => s.activeVideo)
  const queue = useMediaStore(s => s.queue)
  const queueIndex = useMediaStore(s => s.queueIndex)
  const autoPlay = useMediaStore(s => s.autoPlay)
  const savedItems = useMediaStore(s => s.savedItems)
  const recentlyWatched = useMediaStore(s => s.recentlyWatched)
  const videosItems = useMediaStore(s => s.videosItems)
  const discoverData = useMediaStore(s => s.discoverData)

  /* Store actions */
  const closeTheater = useMediaStore(s => s.closeTheater)
  const stopVideo = useMediaStore(s => s.stopVideo)
  const playVideo = useMediaStore(s => s.playVideo)
  const playNext = useMediaStore(s => s.playNext)
  const playPrevious = useMediaStore(s => s.playPrevious)
  const toggleSave = useMediaStore(s => s.toggleSave)
  const addToQueue = useMediaStore(s => s.addToQueue)
  const playFromQueue = useMediaStore(s => s.playFromQueue)
  const setAutoPlay = useMediaStore(s => s.setAutoPlay)

  /* Derived */
  const isSaved = activeVideo ? savedItems.some(v => v.id === activeVideo.id) : false
  const hasNext = queueIndex < queue.length - 1
  const hasPrev = queueIndex > 0

  /* "More to watch" — pool from everything the user has been browsing */
  const moreVideos = useMemo(() => {
    const pool = [
      ...flattenDiscover(discoverData),
      ...(videosItems || []),
      ...(recentlyWatched || []),
      ...(queue || []),
    ]
    const seen = new Set(activeVideo ? [activeVideo.id] : [])
    const out = []
    for (const v of pool) {
      if (!v || !v.id || seen.has(v.id) || v.type === 'short') continue
      seen.add(v.id)
      out.push(v)
      if (out.length >= 16) break
    }
    return out
  }, [discoverData, videosItems, recentlyWatched, queue, activeVideo])

  const cycleSize = useCallback(() => {
    setSize(s => SIZES[(SIZES.indexOf(s) + 1) % SIZES.length])
  }, [])

  /* Escape key handler */
  useEffect(() => {
    if (!activeVideo) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeTheater()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [activeVideo, closeTheater])

  /* Body scroll lock */
  useEffect(() => {
    if (!activeVideo) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [activeVideo])

  /* YouTube postMessage listener for video end */
  useEffect(() => {
    if (!activeVideo) return
    const onMessage = (e) => {
      /* YouTube sends state changes via postMessage when enablejsapi=1 */
      try {
        if (typeof e.data === 'string') {
          const data = JSON.parse(e.data)
          /* YouTube player states: 0 = ended */
          if (
            data?.event === 'onStateChange' &&
            data?.info === 0
          ) {
            playNext()
          }
        }
      } catch {
        /* ignore non-JSON messages */
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [activeVideo, playNext])

  /* Overlay click to close */
  const handleOverlayClick = useCallback((e) => {
    if (e.target === overlayRef.current) closeTheater()
  }, [closeTheater])

  /* Early exit */
  if (!activeVideo) return null

  const content = (
    <div
      ref={overlayRef}
      className={`mc-theater mc-theater--${size}${dayMode ? ' day-mode' : ''}${railOpen ? ' queue-open' : ''}`}
      onClick={handleOverlayClick}
    >
      {/* Close button */}
      <button
        type="button"
        className="mc-theater-close"
        onClick={closeTheater}
        aria-label={t('mediaCenter.theater.close')}
      >
        <IconClose />
      </button>

      {/* Main content area */}
      <div className="mc-theater-main">
        {/* Video / audio container */}
        <div className="mc-theater-video-wrap">
          <div className="mc-theater-video">
            {renderPlayer(activeVideo, playNext)}
          </div>
        </div>

        {/* Controls bar */}
        <div className="mc-theater-controls">
          <div className="mc-theater-controls-left">
            <button
              type="button"
              className="mc-theater-btn"
              onClick={playPrevious}
              disabled={!hasPrev}
              aria-label={t('mediaCenter.theater.previous')}
            >
              <IconPrev />
            </button>
            <button
              type="button"
              className="mc-theater-btn"
              onClick={playNext}
              disabled={!hasNext}
              aria-label={t('mediaCenter.theater.next')}
            >
              <IconNext />
            </button>
          </div>

          <div className="mc-theater-controls-center">
            <h3 className="mc-theater-title">{activeVideo.title}</h3>
            <span className="mc-theater-channel">{activeVideo.channel?.name || activeVideo.channel}</span>
          </div>

          <div className="mc-theater-controls-right">
            <button
              type="button"
              className="mc-theater-btn mc-theater-size-btn"
              onClick={cycleSize}
              aria-label={t('mediaCenter.theater.size')}
              title={t(`mediaCenter.theater.sizes.${size}`)}
            >
              <IconSize />
              <span className="mc-theater-size-label">{t(`mediaCenter.theater.sizes.${size}`)}</span>
            </button>

            <button
              type="button"
              className={`mc-theater-btn mc-theater-save${isSaved ? ' saved' : ''}`}
              onClick={() => toggleSave(activeVideo)}
              aria-label={isSaved ? t('mediaCenter.theater.unsave') : t('mediaCenter.theater.save')}
            >
              {spectreIcons.star}
            </button>

            <button
              type="button"
              className={`mc-theater-btn mc-theater-queue-btn${railOpen ? ' active' : ''}`}
              onClick={() => setRailOpen(o => !o)}
              aria-label={t('mediaCenter.theater.queue')}
            >
              {spectreIcons.list}
              {queue.length > 0 && (
                <span className="mc-theater-queue-count">{queue.length}</span>
              )}
            </button>

            <div className="mc-theater-autoplay">
              <span className="mc-theater-autoplay-label">{t('mediaCenter.theater.auto')}</span>
              <button
                type="button"
                className={`mc-theater-toggle${autoPlay ? ' on' : ''}`}
                onClick={() => setAutoPlay(!autoPlay)}
                role="switch"
                aria-checked={autoPlay}
                aria-label={t('mediaCenter.theater.autoPlay')}
              >
                <span className="mc-theater-toggle-thumb" />
              </button>
            </div>
          </div>
        </div>

        {/* AI synthesis — fast TL;DR of the current video (YouTube only; Twitch streams have no description) */}
        {activeVideo.type !== 'audio' && activeVideo.source !== 'twitch' && (
          <div className="mc-theater-syn">
            <MediaSynthesis
              kind="video"
              id={activeVideo.id?.startsWith('yt_') ? activeVideo.id.slice(3) : activeVideo.id}
              title={activeVideo.title}
              source={activeVideo.channel?.name || activeVideo.channel}
              variant="panel"
              dayMode={dayMode}
            />
          </div>
        )}

        {/* More to watch — fills the space + keeps the session going */}
        {moreVideos.length > 0 && (
          <section className="mc-theater-more">
            <h4 className="mc-theater-more-head">{t('mediaCenter.theater.moreToWatch')}</h4>
            <div className="mc-theater-more-grid">
              {moreVideos.map(v => <MoreCard key={v.id} video={v} onPlay={playVideo} />)}
            </div>
          </section>
        )}
      </div>

      {/* Side rail — live chat / comments + queue */}
      {railOpen && (
        <aside className="mc-theater-sidebar">
          <div className="mctc-tabs">
            <button
              type="button"
              className={`mctc-tab${railTab === 'chat' ? ' active' : ''}`}
              onClick={() => setRailTab('chat')}
            >
              {activeVideo.type === 'live' ? t('mediaCenter.player.liveChat') : t('mediaCenter.player.comments')}
            </button>
            <button
              type="button"
              className={`mctc-tab${railTab === 'queue' ? ' active' : ''}`}
              onClick={() => setRailTab('queue')}
            >
              {t('mediaCenter.theater.upNext')}
              {queue.length > 0 && <span className="mctc-tab-count">{queue.length}</span>}
            </button>
          </div>

          {railTab === 'chat' ? (
            <MediaComments item={activeVideo} />
          ) : (
            <div className="mc-theater-sidebar-list">
              {queue.length === 0 ? (
                <p className="mctc-queue-empty">{t('mediaCenter.drawer.queueEmpty')}</p>
              ) : queue.map((video, i) => (
                <QueueItem
                  key={`${video.id}-${i}`}
                  video={video}
                  index={i}
                  isActive={i === queueIndex}
                  onPlay={playFromQueue}
                />
              ))}
            </div>
          )}
        </aside>
      )}
    </div>
  )

  return createPortal(content, document.body)
}

export default TheaterMode
