/**
 * Masthead - "THE SPECTRE EDITION" newspaper-style masthead.
 * Centered Playfair Display title, date line, AI badge, back arrow, double-line divider.
 */
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import '../Intelligence.css'

const TODAY_OPTIONS = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }

function formatMastheadDate(locale) {
  return new Date().toLocaleDateString(locale || 'en-US', TODAY_OPTIONS).toUpperCase()
}

export default function Masthead() {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()

  return (
    <header className="st-masthead">
      {/* Left: back arrow */}
      <nav className="st-masthead__left">
        <button
          className="st-masthead__back"
          onClick={() => navigate('/')}
          aria-label={t('intelligencePage.backToHome', 'Back to home')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
      </nav>

      {/* Center: title + date */}
      <div className="st-masthead__center">
        <h1 className="st-masthead__title">{t('intelligencePage.mastheadTitle', 'THE SPECTRE EDITION')}</h1>
        <span className="st-masthead__date">{formatMastheadDate(i18n.language)}</span>
      </div>

      {/* Right: AI badge */}
      <div className="st-masthead__right">
        <span className="st-masthead__badge">
          <span className="st-masthead__badge-dot" />
          {t('intelligencePage.marketIntelligence', 'Market Intelligence')}
        </span>
      </div>

      {/* Double-line divider */}
      <div className="st-masthead__divider" aria-hidden="true" />
    </header>
  )
}
