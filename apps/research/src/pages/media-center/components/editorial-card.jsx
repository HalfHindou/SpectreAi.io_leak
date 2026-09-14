/**
 * EditorialCard — premium Rollup-style content card.
 * Fuller layout: date eyebrow · big title · accent thesis · tag row
 * (category + overflow + watch-time + bookmark). Used in rails + All Content.
 */
import { useTranslation } from 'react-i18next'
import LiveBadge from './live-badge'
import { fmtDuration, fmtMinutes, fmtCompact, relTime } from './media-format'

const BookmarkIcon = ({ filled }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
)

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const PlayGlyph = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <polygon points="6,4 20,12 6,20" fill="currentColor" />
  </svg>
)

const EditorialCard = ({ item, isSaved, onPlay, onToggleSave, onAddToQueue, variant = 'grid', index = 0 }) => {
  const { t } = useTranslation()
  if (!item) return null

  const isLive = item.type === 'live'
  const duration = fmtDuration(item.duration)
  const mins = fmtMinutes(item.duration)
  const when = relTime(item.publishedAt, t)
  const views = fmtCompact(item.viewCount)
  const extraTags = (item.tags || []).filter(tg => tg && tg !== item.category)

  return (
    <article className={`mcx-card mcx-card--${variant}`} style={{ '--i': index }}>
      <button
        type="button"
        className="mcx-card-thumb"
        onClick={() => onPlay?.(item)}
        aria-label={t('mediaCenter.mediaCard.playAria', { title: item.title })}
      >
        {item.thumbnail
          ? <img src={item.thumbnail} alt="" loading="lazy" className="mcx-card-img" />
          : <span className="mcx-card-img mcx-card-img--ph" aria-hidden="true" />}
        <span className="mcx-thumb-scrim" aria-hidden="true" />

        {isLive
          ? <LiveBadge className="mcx-thumb-live" />
          : duration ? <span className="mcx-dur">{duration}</span> : null}

        <span className="mcx-play"><PlayGlyph /></span>

        {onAddToQueue && !isLive && (
          <span
            role="button"
            tabIndex={0}
            className="mcx-thumb-add"
            onClick={(e) => { e.stopPropagation(); onAddToQueue(item) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onAddToQueue(item) } }}
            title={t('mediaCenter.mediaCard.addToQueue')}
          >
            <PlusIcon />
          </span>
        )}
      </button>

      <div className="mcx-card-body">
        <div className="mcx-eyebrow">
          {item.channel?.name && <span className="mcx-eyebrow-chan">{item.channel.name}</span>}
          {item.channel?.name && when && <span className="mcx-dotsep" aria-hidden="true">·</span>}
          {when && <span className="mcx-eyebrow-when">{when}</span>}
          {views && <><span className="mcx-dotsep" aria-hidden="true">·</span><span>{views}</span></>}
        </div>

        <h3 className="mcx-card-title" title={item.title}>{item.title}</h3>

        {item.description && <p className="mcx-card-thesis">{item.description}</p>}

        <div className="mcx-tagrow">
          {item.category && (
            <span className="mcx-tag-pill" data-cat={item.category}>
              <span className="mcx-tag-dot" aria-hidden="true" />{item.category}
            </span>
          )}
          {extraTags.length > 0 && (
            <span className="mcx-tag-more" title={extraTags.join(', ')}>+{extraTags.length}</span>
          )}
          {!isLive && mins > 0 && (
            <span className="mcx-tag-watch">{t('mediaCenter.discover.watch', { n: mins })}</span>
          )}
          {isLive && <span className="mcx-tag-watch mcx-tag-watch--live">{t('mediaCenter.discover.liveNow')}</span>}
          <button
            type="button"
            className={`mcx-tag-save${isSaved ? ' is-saved' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleSave?.(item) }}
            title={isSaved ? t('mediaCenter.mediaCard.removeSaved') : t('mediaCenter.mediaCard.saveForLater')}
          >
            <BookmarkIcon filled={isSaved} />
          </button>
        </div>
      </div>
    </article>
  )
}

export default EditorialCard
