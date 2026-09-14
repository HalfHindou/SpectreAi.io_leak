/**
 * RelatedQuestions — "People Also Ask" but tighter.
 *
 * 2-col grid of glass pills. Each click triggers a new search via the URL
 * (?q=…) so back-button history works.
 */
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import './related-questions.css'

function RelatedQuestions({ stream }) {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const related = stream.related || []

  if (!related.length) return null

  const handleClick = (question) => {
    const next = new URLSearchParams(searchParams)
    next.set('q', question)
    next.set('v', '2')
    setSearchParams(next)
  }

  return (
    <section className="se2-related-section">
      <header className="se2-related-header">
        <h3 className="se2-related-title">{t('searchEngineV2.related.title', 'RELATED')}</h3>
      </header>
      <div className="se2-related-grid">
        {related.slice(0, 6).map((q, i) => (
          <button
            key={`${q}-${i}`}
            type="button"
            className="se2-related-pill"
            onClick={() => handleClick(q)}
          >
            <span className="se2-related-pill-text">{q}</span>
            <svg viewBox="0 0 16 16" className="se2-related-pill-icon" aria-hidden="true">
              <path d="M5 3l8 5-8 5V3z" fill="currentColor" />
            </svg>
          </button>
        ))}
      </div>
    </section>
  )
}

export default memo(RelatedQuestions, (prev, next) => (
  prev.stream.related === next.stream.related
))
