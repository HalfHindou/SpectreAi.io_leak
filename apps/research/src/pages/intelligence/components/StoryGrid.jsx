/**
 * StoryGrid - 2x3 grid of story cards with OG image thumbnails.
 * Glass background, category badge, image, Playfair headline, source + time.
 * Props: articles (array, uses first 6)
 */
import { useState, useCallback, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { timeAgo, getSourceInfo } from '../utils'
import '../Intelligence.css'

const MAX_ITEMS = 6

const CATEGORY_COLORS = {
  bitcoin:    '#F7931A',
  ethereum:   '#627EEA',
  defi:       '#10B981',
  stocks:     '#3B82F6',
  macro:      '#F59E0B',
  regulation: '#EF4444',
  ai:         '#A855F7',
  markets:    '#8B5CF6',
  crypto:     '#8B5CF6',
  daily:      '#06B6D4',
  news:       '#EF4444',
}

function cleanHeadline(text) {
  if (!text) return ''
  return text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s*/gm, '')
}

function getCategoryColor(article) {
  const cat = (article.category || article.type || '').toLowerCase()
  return CATEGORY_COLORS[cat] || '#8B5CF6'
}

function getCategoryLabel(article) {
  const cat = article.category || article.type || 'Markets'
  return cat.charAt(0).toUpperCase() + cat.slice(1)
}

const StoryCard = memo(function StoryCard({ article, onClick, t }) {
  const [imgError, setImgError] = useState(false)
  const color = getCategoryColor(article)
  const label = getCategoryLabel(article)
  const headline = cleanHeadline(article.headline || article.title)
  const time = timeAgo(article.publishedAt, { t })
  // Prefer real cover photo from RSS, fallback to generated hero image
  const coverPhoto = article.coverImage || article.sourceArticle?.imageUrl || article.imageUrl || (article.slug ? `/api/hero/${article.slug}` : null)
  const hasPhoto = coverPhoto && !imgError
  const { isSpectre, sourceName } = getSourceInfo(article, { t })

  return (
    <article
      className="st-story-card"
      onClick={() => onClick(article)}
      role="button"
      tabIndex={0}
    >
      {/* Cover image or gradient placeholder */}
      <div className="st-story-card__image">
        {hasPhoto ? (
          <img
            src={coverPhoto}
            alt={headline}
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div
            className="st-story-card__gradient"
            style={{
              background: `linear-gradient(135deg, ${color}20 0%, ${color}08 50%, rgba(0,0,0,0.2) 100%)`,
            }}
          >
            <span className="st-story-card__gradient-icon" style={{ color }}>◆</span>
          </div>
        )}
      </div>

      {/* Category badge */}
      <div className="st-story-card__badge">
        <span
          className="st-story-card__badge-square"
          style={{ background: color }}
          aria-hidden="true"
        />
        <span className="st-story-card__badge-label">{label.toUpperCase()}</span>
      </div>

      {/* Headline */}
      <h3 className="st-story-card__headline">{headline}</h3>

      {/* Meta row: source + time */}
      <div className="st-story-card__meta">
        <span className={`st-source-badge ${isSpectre ? 'st-source-badge--spectre' : 'st-source-badge--external'}`}>
          {isSpectre ? '★ Spectre' : sourceName}
        </span>
        <span className="st-story-card__meta-sep" aria-hidden="true">·</span>
        <span className="st-story-card__time">{time}</span>
      </div>
    </article>
  )
})

function StoryGrid({ articles = [] }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const items = articles.slice(0, MAX_ITEMS)

  const handleClick = useCallback((article) => {
    if (!article.slug) return
    const type = article.type || 'news'
    navigate(`/intelligence/${type}/${article.slug}`)
  }, [navigate])

  if (items.length === 0) return null

  return (
    <section className="st-story-grid" aria-label={t('intelligencePage.moreStories', 'More Stories')}>
      {items.map((article, i) => (
        <StoryCard
          key={article.slug || i}
          article={article}
          onClick={handleClick}
          t={t}
        />
      ))}
    </section>
  )
}

export default memo(StoryGrid)
