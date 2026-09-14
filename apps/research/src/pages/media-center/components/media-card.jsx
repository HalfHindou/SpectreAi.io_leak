import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import LiveBadge from './live-badge'
import './media-card.css'

/* ── Helper functions ──────────────────────────────────── */

function formatDuration(seconds) {
  if (!seconds) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

/* Compact-number views, localized via Intl. Views are item counts (not money),
   so we don't use the currency formatter. */
function formatViewCount(count, locale, t) {
  if (!count) return ''
  if (count >= 1_000_000) {
    return t('mediaCenter.views.million', { n: (count / 1_000_000).toFixed(1) })
  }
  if (count >= 1_000) {
    return t('mediaCenter.views.thousand', { n: (count / 1_000).toFixed(1) })
  }
  const formatted = new Intl.NumberFormat(locale || undefined).format(count)
  return t('mediaCenter.views.exact', { count: formatted })
}

function timeAgo(isoDate, t) {
  if (!isoDate) return ''
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('mediaCenter.time.justNow')
  if (mins < 60) return t('mediaCenter.time.mAgo', { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('mediaCenter.time.hAgo', { n: hrs })
  const days = Math.floor(hrs / 24)
  if (days < 30) return t('mediaCenter.time.dAgo', { n: days })
  return t('mediaCenter.time.moAgo', { n: Math.floor(days / 30) })
}

/* ── Source badge ──────────────────────────────────────── */

const SourceBadge = ({ source }) => {
  if (source === 'youtube') return <span className="mc-media-source-badge mc-media-source-yt">YT</span>
  if (source === 'twitch')  return <span className="mc-media-source-badge mc-media-source-tw">TW</span>
  return null
}

/* ── MediaCard ─────────────────────────────────────────── */

const MediaCard = memo(({ item, isSaved, onPlay, onToggleSave, onAddToQueue, index = 0 }) => {
  const { t, i18n } = useTranslation()
  const duration = formatDuration(item.duration)
  const viewCount = formatViewCount(item.viewCount, i18n.language, t)
  const publishedAgo = timeAgo(item.publishedAt, t)

  const channelAvatarStyle = item.channel?.avatar
    ? { backgroundImage: `url(${item.channel.avatar})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {}

  return (
    <div
      className={`mc-media-card${isSaved ? ' mc-media-card--saved' : ''}`}
      style={{ animationDelay: `${0.04 + index * 0.06}s` }}
    >
      {/* ── Thumbnail ── */}
      <div className="mc-media-thumb-wrap">
        <button
          type="button"
          className="mc-media-thumb-btn"
          onClick={() => onPlay(item)}
          aria-label={t('mediaCenter.mediaCard.playAria', { title: item.title })}
        >
          {item.thumbnail ? (
            <img
              src={item.thumbnail}
              alt=""
              className="mc-media-thumb-img"
              loading="lazy"
            />
          ) : (
            <div className="mc-media-thumb-placeholder" />
          )}

          {/* Play overlay — always rendered, fades in on hover */}
          <div className="mc-media-play-overlay">
            <div className="mc-media-play-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="26" height="26" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5,3 19,12 5,21" fill="currentColor" stroke="none" />
              </svg>
            </div>
          </div>

          {/* Duration / Live badge */}
          {item.type === 'live' ? (
            <LiveBadge className="mc-media-live-badge-pos" />
          ) : duration ? (
            <span className="mc-media-duration">{duration}</span>
          ) : null}
        </button>
      </div>

      {/* ── Info ── */}
      <div className="mc-media-info">

        {/* Channel row */}
        <div className="mc-media-channel-row">
          <div className="mc-media-avatar" style={channelAvatarStyle}>
            {!item.channel?.avatar && item.channel?.name
              ? item.channel.name.charAt(0).toUpperCase()
              : null
            }
          </div>
          <span className="mc-media-channel-name">{item.channel?.name}</span>
          <SourceBadge source={item.source} />
        </div>

        {/* Title */}
        <p className="mc-media-title">{item.title}</p>

        {/* Meta row: views + time + tags */}
        <div className="mc-media-meta-row">
          <div className="mc-media-stats">
            {viewCount && <span className="mc-media-views">{viewCount}</span>}
            {viewCount && publishedAgo && <span className="mc-media-dot" aria-hidden="true">·</span>}
            {publishedAgo && <span className="mc-media-time">{publishedAgo}</span>}
          </div>

          {item.tags && item.tags.length > 0 && (
            <div className="mc-media-tags">
              {item.tags.slice(0, 3).map(tag => (
                <span key={tag} className="mc-media-tag">{tag}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Action buttons — appear on card hover ── */}
      <div className="mc-media-actions">
        <button
          type="button"
          className="mc-media-action-btn"
          onClick={() => onAddToQueue(item)}
          title={t('mediaCenter.mediaCard.addToQueue')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>

        <button
          type="button"
          className={`mc-media-save-btn${isSaved ? ' saved' : ''}`}
          onClick={() => onToggleSave(item)}
          title={isSaved ? t('mediaCenter.mediaCard.removeSaved') : t('mediaCenter.mediaCard.saveForLater')}
        >
          <svg viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" width="14" height="14" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
          </svg>
        </button>
      </div>
    </div>
  )
})

MediaCard.displayName = 'MediaCard'

export default MediaCard
