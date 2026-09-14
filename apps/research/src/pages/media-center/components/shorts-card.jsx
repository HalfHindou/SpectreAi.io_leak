/**
 * ShortsCard — clean 9:16 vertical short.
 * Full-bleed thumbnail + bottom scrim, 2-line title, view count,
 * channel/category chip, hover play glyph, hover bookmark.
 */
import { useTranslation } from 'react-i18next'
import { fmtCompact } from './media-format'
import './shorts-card.css'

const BookmarkIcon = ({ filled }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
)

const PlayGlyph = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <polygon points="6,4 20,12 6,20" fill="currentColor" />
  </svg>
)

const ShortsCard = ({ item, onPlay, onToggleSave, isSaved = false, index = 0 }) => {
  const { t } = useTranslation()
  if (!item) return null

  const views = fmtCompact(item.viewCount)
  const channel = item.channel?.name || ''
  const chipLabel = channel || item.category || ''
  const category = item.category || null

  return (
    <div
      className="mc-shorts-card"
      data-cat={category || undefined}
      style={{ '--i': index }}
      role="button"
      tabIndex={0}
      onClick={() => onPlay?.(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPlay?.(item)
        }
      }}
    >
      {/* ── Thumbnail ── */}
      {item.thumbnail ? (
        <img src={item.thumbnail} alt="" aria-hidden="true" className="mc-shorts-thumb-img" loading="lazy" />
      ) : (
        <div className="mc-shorts-thumb-img mc-shorts-thumb-img--ph" aria-hidden="true" />
      )}

      <div className="mc-shorts-scrim" aria-hidden="true" />

      {/* ── Hover play glyph ── */}
      <div className="mc-shorts-play" aria-hidden="true">
        <span className="mc-shorts-play-btn"><PlayGlyph /></span>
      </div>

      {/* ── Save (top-right, hover) ── */}
      {onToggleSave && (
        <button
          type="button"
          className={`mc-shorts-save${isSaved ? ' is-saved' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleSave(item) }}
          title={isSaved ? t('mediaCenter.mediaCard.removeSaved') : t('mediaCenter.mediaCard.saveForLater')}
          aria-label={isSaved ? t('mediaCenter.mediaCard.removeSaved') : t('mediaCenter.mediaCard.saveForLater')}
        >
          <BookmarkIcon filled={isSaved} />
        </button>
      )}

      {/* ── Bottom info ── */}
      <div className="mc-shorts-info">
        {chipLabel && (
          <span className="mc-shorts-chip">
            {category && <span className="mc-shorts-chip-dot" aria-hidden="true" />}
            {chipLabel}
          </span>
        )}
        <h4 className="mc-shorts-title">{item.title}</h4>
        {views && (
          <p className="mc-shorts-views">{views} {t('mediaCenter.views.label')}</p>
        )}
      </div>
    </div>
  )
}

export default ShortsCard
