/**
 * PredictionWhale - Whale analysis card for prediction detail page.
 * Shows AI reasoning, key factors, sentiment badge, and whale stats.
 */
import { useTranslation } from 'react-i18next'
import './prediction-whale.css'

const SENTIMENT_KEYS = {
  bullish: { labelKey: 'predictionsPage.whale.sentimentBull', className: 'pd-whale-badge--bull' },
  bearish: { labelKey: 'predictionsPage.whale.sentimentBear', className: 'pd-whale-badge--bear' },
  neutral: { labelKey: 'predictionsPage.whale.sentimentNeutral', className: 'pd-whale-badge--neutral' },
}

const WhaleIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3c-4.97 0-9 3.58-9 8s4.03 8 9 8c1.5 0 2.92-.35 4.16-.97" />
    <path d="M21 12c0-1.66-.67-3.16-1.76-4.24" />
    <circle cx="8" cy="10" r="1" fill="currentColor" stroke="none" />
    <path d="M16 16l2 2 3-3" />
  </svg>
)

export default function PredictionWhale({ analysis, question, dayMode }) {
  const { t } = useTranslation()
  if (!analysis) return null

  const sentimentInfo = SENTIMENT_KEYS[analysis.sentiment] || SENTIMENT_KEYS.neutral
  const whale = analysis.whaleActivity || {}

  return (
    <div className="pd-whale-card">
      <div className="pd-whale-content">
        <div className="pd-whale-text">
          <div className="pd-whale-header">
            <WhaleIcon />
            <h2 className="pd-whale-title">{t('predictionsPage.whale.title')}</h2>
          </div>
          {analysis.reasoning && (
            <p className="pd-whale-reasoning">{analysis.reasoning}</p>
          )}
          {analysis.keyFactors?.length > 0 && (
            <ul className="pd-whale-factors">
              {analysis.keyFactors.map((factor, i) => (
                <li key={i} className="pd-whale-factor">{factor}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="pd-whale-stats">
          <span className={`pd-whale-badge${sentimentInfo.className ? ` ${sentimentInfo.className}` : ''}`}>
            {t(sentimentInfo.labelKey)}
          </span>
          <div className="pd-whale-stat">
            <span className="pd-whale-stat-label">{t('predictionsPage.whale.trades')}</span>
            <span className="pd-whale-stat-value mono">{whale.trades ?? '-'}</span>
          </div>
          <div className="pd-whale-stat">
            <span className="pd-whale-stat-label">{t('predictionsPage.whale.influencers')}</span>
            <span className="pd-whale-stat-value mono">{whale.influencers ?? '-'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
