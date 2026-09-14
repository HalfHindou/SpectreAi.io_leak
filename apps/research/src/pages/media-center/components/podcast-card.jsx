/**
 * PodcastCard — premium podcast episode card.
 * `row`  variant: compact list row (Trending Podcasts, Rollup-style)
 * `grid` variant: square-art card (Podcasts tab grid + Discover rail)
 */
import { useTranslation } from 'react-i18next'
import { fmtMinutes, relTime } from './media-format'

const BookmarkIcon = ({ filled }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
)

const PlayCircle = ({ size = 34 }) => (
  <svg viewBox="0 0 36 36" width={size} height={size} aria-hidden="true">
    <circle cx="18" cy="18" r="17" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
    <polygon points="14,11 26,18 14,25" fill="currentColor" />
  </svg>
)

const HeadphonesIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
  </svg>
)

const PodcastCard = ({ item, isSaved, onPlay, onToggleSave, variant = 'grid', index = 0 }) => {
  const { t } = useTranslation()
  if (!item) return null

  const mins = fmtMinutes(item.duration)
  const when = relTime(item.publishedAt, t)
  const art = item.thumbnail || item.channel?.avatar

  if (variant === 'row') {
    return (
      <article className="mcx-pod-row" style={{ '--i': index }}>
        <button type="button" className="mcx-pod-row-art" onClick={() => onPlay?.(item)} aria-label={t('mediaCenter.mediaCard.playAria', { title: item.title })}>
          {art ? <img src={art} alt="" loading="lazy" /> : <span className="mcx-pod-art--ph">{(item.channel?.name || '?').charAt(0)}</span>}
          <span className="mcx-pod-row-play"><PlayCircle size={30} /></span>
        </button>
        <div className="mcx-pod-row-body">
          <span className="mcx-pod-show">{item.channel?.name}</span>
          <h4 className="mcx-pod-row-title" title={item.title}>{item.title}</h4>
          <div className="mcx-pod-row-meta">
            <HeadphonesIcon />
            {mins > 0 && <span>{t('mediaCenter.podcasts.duration', { m: mins })}</span>}
            {mins > 0 && when && <span className="mcx-dotsep" aria-hidden="true">·</span>}
            {when && <span>{when}</span>}
          </div>
        </div>
        <button
          type="button"
          className={`mcx-act mcx-pod-row-save${isSaved ? ' is-saved' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleSave?.(item) }}
          title={isSaved ? t('mediaCenter.mediaCard.removeSaved') : t('mediaCenter.mediaCard.saveForLater')}
        >
          <BookmarkIcon filled={isSaved} />
        </button>
      </article>
    )
  }

  return (
    <article className={`mcx-pod mcx-pod--${variant}`} style={{ '--i': index }}>
      <button
        type="button"
        className="mcx-pod-art"
        onClick={() => onPlay?.(item)}
        aria-label={t('mediaCenter.mediaCard.playAria', { title: item.title })}
      >
        {art ? <img src={art} alt="" loading="lazy" /> : <span className="mcx-pod-art--ph">{(item.channel?.name || '?').charAt(0)}</span>}
        <span className="mcx-thumb-scrim" aria-hidden="true" />
        <span className="mcx-pod-play"><PlayCircle /></span>
        <span className="mcx-pod-badge"><HeadphonesIcon /></span>
      </button>
      <div className="mcx-pod-body">
        <span className="mcx-pod-show">{item.channel?.name}</span>
        <h3 className="mcx-pod-title" title={item.title}>{item.title}</h3>
        <div className="mcx-pod-meta">
          {mins > 0 && <span>{t('mediaCenter.podcasts.duration', { m: mins })}</span>}
          {mins > 0 && when && <span className="mcx-dotsep" aria-hidden="true">·</span>}
          {when && <span>{when}</span>}
        </div>
      </div>
      <button
        type="button"
        className={`mcx-act mcx-pod-save${isSaved ? ' is-saved' : ''}`}
        onClick={(e) => { e.stopPropagation(); onToggleSave?.(item) }}
        title={isSaved ? t('mediaCenter.mediaCard.removeSaved') : t('mediaCenter.mediaCard.saveForLater')}
      >
        <BookmarkIcon filled={isSaved} />
      </button>
    </article>
  )
}

export default PodcastCard
