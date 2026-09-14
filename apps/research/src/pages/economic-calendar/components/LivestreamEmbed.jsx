/**
 * LivestreamEmbed Component
 * YouTube iframe embed for live economic events.
 * Shows watch-live button pre-event, auto-embeds during live, and recording link post-event.
 */

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import './LivestreamEmbed.css'

const LivestreamEmbed = ({ url, eventName = 'Event', isLive = false }) => {
  const { t } = useTranslation()
  const [showEmbed, setShowEmbed] = useState(isLive)

  const hasUrl = !!url

  // Extract YouTube video ID for embed
  const getEmbedUrl = (rawUrl) => {
    if (!rawUrl) return null
    // Handle youtu.be short links
    const shortMatch = rawUrl.match(/youtu\.be\/([a-zA-Z0-9_-]+)/)
    if (shortMatch) return `https://www.youtube.com/embed/${shortMatch[1]}?autoplay=1`
    // Handle standard youtube.com links
    const longMatch = rawUrl.match(/[?&]v=([a-zA-Z0-9_-]+)/)
    if (longMatch) return `https://www.youtube.com/embed/${longMatch[1]}?autoplay=1`
    // Already an embed URL
    if (rawUrl.includes('/embed/')) return rawUrl
    return rawUrl
  }

  const embedUrl = getEmbedUrl(url)

  // No stream available
  if (!hasUrl) {
    return (
      <div className="livestream-embed livestream-embed--empty">
        <div className="livestream-embed__empty-content">
          <svg className="livestream-embed__empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4V6.5l-4 4z" />
            <line x1="2" y1="2" x2="22" y2="22" />
          </svg>
          <span className="livestream-embed__empty-text">{t('economicCalendar.livestream.empty', 'No livestream available.')}</span>
          <a
            className="livestream-embed__x-link"
            href="https://x.com/search?q=%23FOMC"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('economicCalendar.livestream.followX', 'Follow live commentary on X →')}
          </a>
        </div>
      </div>
    )
  }

  // Show embed (live or clicked to watch)
  if (showEmbed && embedUrl) {
    return (
      <div className="livestream-embed livestream-embed--active">
        <div className="livestream-embed__iframe-container">
          <iframe
            className="livestream-embed__iframe"
            src={embedUrl}
            title={eventName}
            allow="autoplay; encrypted-media"
            allowFullScreen
            frameBorder="0"
          />
        </div>
        {isLive && (
          <div className="livestream-embed__live-indicator">
            <span className="livestream-embed__live-dot" />
            {t('economicCalendar.livestream.live', 'LIVE')}
          </div>
        )}
      </div>
    )
  }

  // Pre-event: Show watch button
  return (
    <div className="livestream-embed livestream-embed--preview">
      <div className="livestream-embed__preview-content">
        <span className="livestream-embed__source-label">{eventName}</span>
        <button
          className={`livestream-embed__watch-btn ${isLive ? 'livestream-embed__watch-btn--live' : ''}`}
          onClick={() => setShowEmbed(true)}
        >
          <svg className="livestream-embed__play-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
          {isLive ? t('economicCalendar.livestream.watchLive', 'Watch Live') : t('economicCalendar.livestream.viewRecording', 'View Recording')}
        </button>
        {!isLive && (
          <span className="livestream-embed__recording-hint">
            {t('economicCalendar.livestream.viewRecordingArrow', 'View Recording →')}
          </span>
        )}
      </div>
    </div>
  )
}

export default LivestreamEmbed
