/**
 * BreakingBanner - Conditional breaking news banner with red pulse.
 * Only renders if articles prop has items.
 * Props: articles (array of breaking news articles)
 */
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { timeAgo } from '../utils'
import '../Intelligence.css'

function cleanHeadline(text) {
  if (!text) return ''
  return text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s*/gm, '')
}

export default function BreakingBanner({ articles = [] }) {
  const navigate = useNavigate()
  const { t } = useTranslation()

  if (!articles || articles.length === 0) return null

  const lead = articles[0]
  const slug = lead.slug
  const type = lead.type || 'news'
  const headline = cleanHeadline(lead.headline || lead.title)
  const time = timeAgo(lead.publishedAt, { t })

  const handleClick = () => {
    if (slug) {
      // Pass the full breaking item so the article page can render immediately -
      // breaking items live in a separate feed (/news/breaking) and may not be
      // resolvable via the editorial or default news endpoints.
      navigate(`/intelligence/${type}/${slug}`, { state: { article: lead } })
    }
  }

  return (
    <section
      className="st-breaking"
      role="alert"
      aria-label={t('intelligencePage.breakingNews', 'Breaking news')}
      onClick={handleClick}
      style={{ cursor: slug ? 'pointer' : 'default' }}
    >
      <div className="st-breaking__pulse" aria-hidden="true" />
      <div className="st-breaking__content">
        <span className="st-breaking__label" aria-label={t('intelligencePage.breakingNewsIndicator', 'Breaking news indicator')}>
          <span className="st-breaking__dot" />
          {t('intelligencePage.breakingUpper', 'BREAKING')}
        </span>
        <h2 className="st-breaking__headline">{headline}</h2>
      </div>
      <span className="st-breaking__time">{time}</span>
    </section>
  )
}
