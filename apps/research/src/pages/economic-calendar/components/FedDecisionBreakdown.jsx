/**
 * FedDecisionBreakdown Component
 * FOMC-specific decision breakdown panel with rate decision,
 * statement changes, dot plot, market probabilities, and key phrases.
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import FedSentimentMeter from './FedSentimentMeter'
import './FedDecisionBreakdown.css'

// 2026-05-26 beta-quality fix (pass 7): MOCK_STATEMENT_CHANGES / MOCK_DOT_PLOT /
// MOCK_PROBABILITIES / MOCK_KEY_PHRASES removed. Each section now renders only
// when the live `event.fedDecision.{statementChanges|dotPlot|probabilities|keyPhrases}`
// payload contains real data.

const SIGNAL_CONFIG = {
  hawkish: { color: 'var(--amber)', icon: '\u26A0' },
  dovish: { color: 'var(--bull)', icon: '\u2713' },
  neutral: { color: 'var(--text-muted)', icon: '\u2014' },
}

const FedDecisionBreakdown = ({ event }) => {
  const { t } = useTranslation()
  // 2026-05-26 beta-quality fix (pass 7): tightened the gate. Was only checking
  // event.fedDecision truthiness, so any "true" flag from backend rendered the
  // MOCK_STATEMENT_CHANGES / MOCK_DOT_PLOT / MOCK_PROBABILITIES / MOCK_KEY_PHRASES
  // constants as if they were live. Now require real arrays/objects from the
  // upstream payload, fall through to live values when present, else hide.
  const fd = event?.fedDecision
  if (!fd || typeof fd !== 'object') return null

  const statementChanges = Array.isArray(fd.statementChanges) ? fd.statementChanges : null
  const dotPlot = fd.dotPlot && typeof fd.dotPlot === 'object' ? fd.dotPlot : null
  const probabilities = Array.isArray(fd.probabilities) ? fd.probabilities : null
  const keyPhrases = Array.isArray(fd.keyPhrases) ? fd.keyPhrases : null
  // If NONE of the live arrays are present, hide entirely rather than render mocks
  if (!statementChanges && !dotPlot && !probabilities && !keyPhrases) return null

  const rateDecision = event?.rateDecision || fd.rateDecision || '—'
  const asExpected = (event?.asExpected ?? fd.asExpected) !== false
  const sentiment = event?.sentiment || fd.sentiment || 'neutral'

  return (
    <div className="fed-breakdown">
      <div className="fed-breakdown__header">
        <span className="fed-breakdown__title">{t('economicCalendar.fedDecision.title', 'FED DECISION BREAKDOWN')}</span>
      </div>

      {/* Rate Decision */}
      <div className="fed-breakdown__section">
        <div className="fed-breakdown__rate-row">
          <span className="fed-breakdown__section-label">{t('economicCalendar.fedDecision.rateDecision', 'Rate Decision')}</span>
          <div className="fed-breakdown__rate-value">
            <span className="fed-breakdown__rate">{rateDecision}</span>
            {asExpected && (
              <span className="fed-breakdown__expected-badge">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5l2.5 2.5L8 3" stroke="var(--bull)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t('economicCalendar.fedDecision.asExpected', 'As Expected')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Statement Changes */}
      {statementChanges && statementChanges.length > 0 && (
        <div className="fed-breakdown__section">
          <span className="fed-breakdown__section-label">{t('economicCalendar.fedDecision.statementChanges', 'Statement Changes')}</span>
          <ul className="fed-breakdown__changes-list">
            {statementChanges.map((change, i) => (
              <li key={i} className="fed-breakdown__change-item">
                <span className="fed-breakdown__change-bullet" />
                {change}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Dot Plot Summary */}
      {dotPlot && Object.keys(dotPlot).length > 0 && (
        <div className="fed-breakdown__section">
          <span className="fed-breakdown__section-label">{t('economicCalendar.fedDecision.dotPlot', 'Dot Plot Summary')}</span>
          <div className="fed-breakdown__dot-plot">
            {Object.entries(dotPlot).map(([label, value]) => (
              <div key={label} className="fed-breakdown__dot-row">
                <span className="fed-breakdown__dot-label">{label}</span>
                <span className="fed-breakdown__dot-value">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Market Probability */}
      {probabilities && probabilities.length > 0 && (
        <div className="fed-breakdown__section">
          <span className="fed-breakdown__section-label">{t('economicCalendar.fedDecision.marketProbability', 'Market Probability (pre-meeting)')}</span>
          <div className="fed-breakdown__probabilities">
            {probabilities.map((p) => (
              <div key={p.action} className="fed-breakdown__prob-row">
                <span className="fed-breakdown__prob-action">{p.action}</span>
                <div className="fed-breakdown__prob-bar-track">
                  <div
                    className="fed-breakdown__prob-bar-fill"
                    style={{ width: `${p.probability}%` }}
                  />
                </div>
                <span className="fed-breakdown__prob-value">{p.probability}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sentiment Meter */}
      {sentiment && sentiment !== 'neutral' && (
        <div className="fed-breakdown__section">
          <span className="fed-breakdown__section-label">{t('economicCalendar.fedDecision.toneAssessment', 'Tone Assessment')}</span>
          <FedSentimentMeter sentiment={sentiment} />
        </div>
      )}

      {/* Key Phrases */}
      {keyPhrases && keyPhrases.length > 0 && (
        <div className="fed-breakdown__section">
          <span className="fed-breakdown__section-label">{t('economicCalendar.fedDecision.keyPhrases', 'Key Phrases')}</span>
          <div className="fed-breakdown__phrases">
            {keyPhrases.map((kp, i) => {
            const config = SIGNAL_CONFIG[kp.signal] || SIGNAL_CONFIG.neutral
            return (
              <div key={i} className="fed-breakdown__phrase-row">
                <span className="fed-breakdown__phrase-text">{kp.phrase}</span>
                <span
                  className="fed-breakdown__phrase-tag"
                  style={{
                    color: config.color,
                    borderColor: config.color,
                  }}
                >
                  {config.icon} {kp.label}
                </span>
              </div>
            )
          })}
          </div>
        </div>
      )}
    </div>
  )
}

export default FedDecisionBreakdown
