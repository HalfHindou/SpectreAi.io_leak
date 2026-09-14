/**
 * Media Center Mini Player — Apple Cinematic
 * Portal-based floating YouTube player, bottom-right.
 * Appears when theater is closed while a video is still playing.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import useMediaStore from '@/store/useMediaStore'
import './mini-player.css'

function renderMiniPlayer(item, t) {
  const source = item.source || 'youtube'

  switch (source) {
    case 'youtube': {
      const videoId = item.id?.startsWith('yt_') ? item.id.slice(3) : item.id
      return (
        <div className="mc-mini-media">
          <iframe
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
            title={item.title || t('mediaCenter.miniPlayer.videoPlayer')}
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="mc-mini-iframe"
          />
        </div>
      )
    }
    case 'twitch':
      return (
        <div className="mc-mini-media">
          <iframe
            src={item.url}
            title={item.title || t('mediaCenter.miniPlayer.liveStream')}
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
            allowFullScreen
            className="mc-mini-iframe"
          />
        </div>
      )
    case 'podcast-index':
      return (
        <div className="mc-mini-audio">
          <img
            src={item.thumbnail}
            alt=""
            className="mc-mini-audio-art"
          />
          <div className="mc-mini-audio-info">
            <span className="mc-mini-audio-title">{item.title}</span>
            <audio
              src={item.audioUrl}
              controls
              autoPlay
              className="mc-mini-audio-player"
            />
          </div>
        </div>
      )
    default: {
      // Legacy fallback
      return (
        <div className="mc-mini-media">
          <iframe
            src={`https://www.youtube.com/embed/${item.id}?autoplay=1&rel=0`}
            title={item.title || t('mediaCenter.miniPlayer.videoPlayer')}
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="mc-mini-iframe"
          />
        </div>
      )
    }
  }
}

const MiniPlayer = ({ dayMode = false }) => {
  const { t } = useTranslation()
  const activeVideo = useMediaStore(s => s.activeVideo)
  const miniPlayerOpen = useMediaStore(s => s.miniPlayerOpen)
  const openTheater = useMediaStore(s => s.openTheater)
  const closeMiniPlayer = useMediaStore(s => s.closeMiniPlayer)

  if (!miniPlayerOpen || !activeVideo) return null

  const content = (
    <div className={`mc-mini${dayMode ? ' day-mode' : ''}`}>
      {/* ── Source-based player ──────────────── */}
      {renderMiniPlayer(activeVideo, t)}

      {/* ── Controls bar ─────────────────────── */}
      <div className="mc-mini-controls">
        <p className="mc-mini-title">{activeVideo.title}</p>
        <div className="mc-mini-actions">
          {/* Expand — reopen theater */}
          <button
            type="button"
            className="mc-mini-btn"
            onClick={openTheater}
            title={t('mediaCenter.miniPlayer.expand')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>

          {/* Close — stop video entirely */}
          <button
            type="button"
            className="mc-mini-btn mc-mini-btn-close"
            onClick={closeMiniPlayer}
            title={t('mediaCenter.miniPlayer.close')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}

export default MiniPlayer
