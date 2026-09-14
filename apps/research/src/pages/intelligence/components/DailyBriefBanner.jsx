/**
 * DailyBriefBanner - Full-width daily brief preview card.
 * Shows header with date, summary text, and "Read Full Brief" link.
 * Only renders if article prop exists.
 * Props: article
 */
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import '../Intelligence.css'

const DATE_OPTIONS = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }

function cleanText(text) {
  if (!text) return ''
  return text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s*/gm, '')
}

function formatBriefDate(dateStr, locale) {
  const loc = locale || 'en-US'
  if (!dateStr) {
    return new Date().toLocaleDateString(loc, DATE_OPTIONS).toUpperCase()
  }
  return new Date(dateStr).toLocaleDateString(loc, DATE_OPTIONS).toUpperCase()
}

export default function DailyBriefBanner({ article }) {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()

  if (!article) return null

  const dateLabel = formatBriefDate(article.publishedAt, i18n.language)
  const summary = cleanText(article.summary || '')
  const slug = article.slug

  const handleClick = () => {
    if (slug) {
      navigate(`/intelligence/daily/${slug}`)
    }
  }

  return (
    <section className="st-daily-brief" aria-label={t('intelligencePage.dailyMarketBrief', 'Daily Market Brief')}>
      <div className="st-daily-brief__inner">
        {/* Header */}
        <div className="st-daily-brief__header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span className="st-daily-brief__date">
            {t('intelligencePage.dailyMarketBriefUpper', 'DAILY MARKET BRIEF')} &middot; {dateLabel}
          </span>
        </div>

        {/* Summary */}
        {summary && (
          <p className="st-daily-brief__summary">{summary}</p>
        )}

        {/* CTA */}
        <button className="st-daily-brief__cta" onClick={handleClick}>
          {t('intelligencePage.readFullBrief', 'Read Full Brief')} →
        </button>
      </div>
    </section>
  )
}
