/**
 * AnalysisColumn - Center column for latest analysis/research articles.
 * Shows crypto + stock + spectre analysis articles mixed.
 * Props: articles (array)
 */
import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { timeAgo, getSourceInfo } from '../utils'
import '../Intelligence.css'

const MAX_ITEMS = 4

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
  const cat = article.category || article.type || 'Analysis'
  return cat.charAt(0).toUpperCase() + cat.slice(1)
}

function AnalysisColumn({ articles = [] }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const items = articles.slice(0, MAX_ITEMS)

  const handleClick = (article) => {
    if (!article.slug) return
    const type = article.type || 'crypto'
    navigate(`/intelligence/${type}/${article.slug}`)
  }

  return (
    <section className="st-analysis" aria-label={t('intelligencePage.latestAnalysis', 'Latest analysis')}>
      <div className="st-analysis__header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
        <span className="st-analysis__title">{t('intelligencePage.analysisUpper', 'ANALYSIS')}</span>
      </div>

      <div className="st-analysis__list">
        {items.map((article, i) => {
          const color = getCategoryColor(article)
          const label = getCategoryLabel(article)
          const headline = cleanHeadline(article.headline || article.title)
          const summary = article.summary || ''

          const coverPhoto = article.coverImage
            || article.sourceArticle?.imageUrl
            || article.imageUrl
            || (article.slug ? `/api/hero/${article.slug}` : null)

          return (
            <article
              key={article.slug || i}
              className="st-analysis__card"
              onClick={() => handleClick(article)}
              role="button"
              tabIndex={0}
            >
              {/* Hero image */}
              {coverPhoto && (
                <div className="st-analysis__image">
                  <img
                    src={coverPhoto}
                    alt={headline}
                    loading="lazy"
                    onError={(e) => { e.target.parentElement.style.display = 'none' }}
                  />
                  <div className="st-analysis__image-fade" aria-hidden="true" />
                </div>
              )}

              {/* Category badge */}
              <div className="st-analysis__badge">
                <span
                  className="st-analysis__badge-square"
                  style={{ background: color }}
                  aria-hidden="true"
                />
                <span className="st-analysis__badge-label">{label.toUpperCase()}</span>
              </div>

              {/* Headline */}
              <h3 className="st-analysis__headline">{headline}</h3>

              {/* Source attribution */}
              {(() => {
                const { isSpectre, sourceName } = getSourceInfo(article)
                return (
                  <span className={`st-analysis__source ${isSpectre ? 'st-analysis__source--spectre' : ''}`}>
                    {isSpectre ? '★ Spectre AI' : sourceName}
                  </span>
                )
              })()}

              {/* Summary snippet */}
              {summary && (
                <p className="st-analysis__summary">{summary}</p>
              )}

              {/* CTA link */}
              <span className="st-analysis__cta">{t('intelligencePage.readAnalysis', 'Read Analysis →')}</span>

              {/* Divider (not on last item) */}
              {i < items.length - 1 && (
                <div className="st-analysis__divider" aria-hidden="true" />
              )}
            </article>
          )
        })}
      </div>

      {/* View all */}
      {articles.length > MAX_ITEMS && (
        <button
          className="st-analysis__view-all"
          onClick={() => navigate('/intelligence?tab=crypto')}
        >
          {t('intelligencePage.viewAllResearch', 'View All Research →')}
        </button>
      )}
    </section>
  )
}

export default memo(AnalysisColumn)
