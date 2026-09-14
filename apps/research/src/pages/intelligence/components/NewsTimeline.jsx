/**
 * NewsTimeline - Left column chronological news feed (~280px).
 * "LATEST" header, sentiment dots, time in mono, clickable headlines.
 * Props: articles (array)
 */
import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { timeAgo, getSourceInfo } from '../utils'
import '../Intelligence.css'

const MAX_ITEMS = 12

function cleanHeadline(text) {
  if (!text) return ''
  return text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s*/gm, '')
}

function sentimentDotColor(sentiment) {
  if (sentiment === 'bullish') return 'var(--bull)'
  if (sentiment === 'bearish') return 'var(--bear)'
  return 'var(--text-muted)'
}

function NewsTimeline({ articles = [] }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const items = articles.slice(0, MAX_ITEMS)

  const handleClick = (article) => {
    if (!article.slug) return
    const type = article.type || 'news'
    navigate(`/intelligence/${type}/${article.slug}`)
  }

  return (
    <aside className="st-timeline" aria-label={t('intelligencePage.latestNewsTimeline', 'Latest news timeline')}>
      {/* Header */}
      <div className="st-timeline__header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="st-timeline__title">{t('intelligencePage.latestUpper', 'LATEST')}</span>
      </div>

      {/* Items */}
      <div className="st-timeline__list">
        {items.map((article, i) => (
          <div
            key={article.slug || i}
            className="st-timeline__item"
            onClick={() => handleClick(article)}
            role="button"
            tabIndex={0}
          >
            <div className="st-timeline__item-top">
              <span className="st-timeline__time">{timeAgo(article.publishedAt, { t })}</span>
              {(() => {
                const { isSpectre, sourceName } = getSourceInfo(article, { t })
                return (
                  <span className={`st-timeline__source ${isSpectre ? 'st-timeline__source--spectre' : ''}`}>
                    {isSpectre ? '★' : sourceName}
                  </span>
                )
              })()}
              <span
                className="st-timeline__dot"
                style={{ background: sentimentDotColor(article.sentiment) }}
                aria-label={`${t('intelligencePage.sentiment', 'Sentiment')}: ${article.sentiment || t('intelligencePage.neutral', 'neutral')}`}
              />
            </div>
            <div className="st-timeline__item-main">
              <h4 className="st-timeline__headline">
                {cleanHeadline(article.headline || article.title)}
              </h4>
              {/* Only genuine cover art earns a thumbnail. `coverImage` is the
                  article-image-only field (see normalizeNewsItem's imageKind),
                  so a favicon or an X avatar can never end up here — and rows
                  without art stay clean text rather than carrying a placeholder. */}
              {article.coverImage && (
                <div className="st-timeline__thumb">
                  <img
                    src={article.coverImage}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={(e) => { e.target.parentElement.style.display = 'none' }}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* View all link */}
      {articles.length > MAX_ITEMS && (
        <button
          className="st-timeline__view-all"
          onClick={() => navigate('/intelligence?tab=news')}
        >
          {t('intelligencePage.viewAll', 'View All →')}
        </button>
      )}
    </aside>
  )
}

export default memo(NewsTimeline)
