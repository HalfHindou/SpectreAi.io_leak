import React from 'react'
import { useTranslation } from 'react-i18next'
import './channel-card.css'
import { fmtCompact } from './media-format'

/* ── Source badge — YT / TW, no logos, no neon ──────── */

const SOURCE_META = {
  youtube: { label: 'YT', cls: 'mc-show-src--yt' },
  twitch:  { label: 'TW', cls: 'mc-show-src--tw' },
}

/* ── Avatar fallback with first letter ──────────────── */

function AvatarFallback({ name }) {
  const letter = name ? name.trim().charAt(0).toUpperCase() : '?'
  return <span className="mc-show-avatar-fallback" aria-hidden="true">{letter}</span>
}

/* ── Chevron affordance ─────────────────────────────── */

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

/* ── ChannelCard — premium "show" card ──────────────── */

const ChannelCard = ({ channel, onClick, index = 0 }) => {
  const { t } = useTranslation()
  if (!channel) return null

  const src = SOURCE_META[channel.source] || null
  const subs = channel.subscriberCount > 0 ? fmtCompact(channel.subscriberCount) : ''
  const vids = channel.videoCount > 0 ? fmtCompact(channel.videoCount) : ''
  const clickable = !!onClick

  const activate = () => { if (onClick) onClick(channel) }
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      activate()
    }
  }

  return (
    <div
      className={`mc-show-card${clickable ? ' mc-show-card--clickable' : ''}`}
      style={{ '--mc-show-i': index }}
      data-cat={channel.category || undefined}
      onClick={activate}
      onKeyDown={handleKeyDown}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `${channel.name} — ${t('mediaCenter.channelCard.viewChannel')}` : undefined}
    >
      {/* Header strip — banner if present, else brand-gradient tinted by category */}
      <div className="mc-show-header">
        {channel.banner ? (
          <img className="mc-show-banner" src={channel.banner} alt="" loading="lazy" aria-hidden="true" />
        ) : (
          <span className="mc-show-banner mc-show-banner--ph" aria-hidden="true" />
        )}
        <span className="mc-show-header-scrim" aria-hidden="true" />

        {src && <span className={`mc-show-src ${src.cls}`}>{src.label}</span>}
        {channel.isLive && (
          <span className="mc-show-live">
            <span className="mc-show-live-dot" />
            {t('mediaCenter.tabs.live').toUpperCase()}
          </span>
        )}

        <span className="mc-show-avatar">
          {channel.avatar ? (
            <img
              className="mc-show-avatar-img"
              src={channel.avatar}
              alt={channel.name}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <AvatarFallback name={channel.name} />
          )}
        </span>
      </div>

      {/* Body */}
      <div className="mc-show-body">
        <h4 className="mc-show-name" title={channel.name}>{channel.name}</h4>

        {channel.description ? (
          <p className="mc-show-desc">{channel.description}</p>
        ) : (
          <p className="mc-show-desc mc-show-desc--empty" aria-hidden="true" />
        )}

        <div className="mc-show-foot">
          <div className="mc-show-stats">
            {subs && (
              <span className="mc-show-stat">
                <span className="mc-show-stat-val">{subs}</span>
                <span className="mc-show-stat-lbl">{t('mediaCenter.channelCard.subscribers')}</span>
              </span>
            )}
            {vids && (
              <span className="mc-show-stat">
                <span className="mc-show-stat-val">{vids}</span>
                <span className="mc-show-stat-lbl">{t('mediaCenter.channelCard.videos')}</span>
              </span>
            )}
          </div>

          <span className="mc-show-cta">
            <span className="mc-show-cta-text">{t('mediaCenter.channelCard.viewChannel')}</span>
            <Chevron />
          </span>
        </div>
      </div>
    </div>
  )
}

export default React.memo(ChannelCard)
