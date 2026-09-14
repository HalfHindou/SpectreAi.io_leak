/**
 * FedSentimentMeter Component
 * Hawkish <-> Dovish horizontal gauge for central bank events.
 * Red (hawkish) through gray (neutral) to green (dovish).
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import './FedSentimentMeter.css'

const SENTIMENT_POSITIONS = {
  'hawkish': 5,
  'slightly-hawkish': 25,
  'neutral': 50,
  'slightly-dovish': 75,
  'dovish': 95,
}

const SENTIMENT_LABEL_KEYS = {
  'hawkish': { key: 'fedSentiment.hawkish', fallback: 'Hawkish' },
  'slightly-hawkish': { key: 'fedSentiment.slightlyHawkish', fallback: 'Slightly Hawkish' },
  'neutral': { key: 'fedSentiment.neutral', fallback: 'Neutral' },
  'slightly-dovish': { key: 'fedSentiment.slightlyDovish', fallback: 'Slightly Dovish' },
  'dovish': { key: 'fedSentiment.dovish', fallback: 'Dovish' },
}

const FedSentimentMeter = ({ sentiment = 'neutral', lastDecision, marketExpecting }) => {
  const { t } = useTranslation()
  const position = SENTIMENT_POSITIONS[sentiment] ?? 50
  const labelEntry = SENTIMENT_LABEL_KEYS[sentiment] || SENTIMENT_LABEL_KEYS.neutral
  const label = t(`economicCalendar.${labelEntry.key}`, labelEntry.fallback)

  const resolvedLast = lastDecision || t('economicCalendar.fedSentiment.lastDecisionFallback', 'Slightly Hawkish')
  const resolvedExpecting = marketExpecting || t('economicCalendar.fedSentiment.marketExpectingFallback', 'Neutral to Dovish')

  return (
    <div className="fed-sentiment-meter">
      {/* Gauge bar */}
      <div className="fed-sentiment-meter__bar-container">
        <div className="fed-sentiment-meter__labels-top">
          <span className="fed-sentiment-meter__label-end fed-sentiment-meter__label-end--hawk">{t('economicCalendar.fedSentiment.hawkish', 'Hawkish')}</span>
          <span className="fed-sentiment-meter__label-end fed-sentiment-meter__label-end--dove">{t('economicCalendar.fedSentiment.dovish', 'Dovish')}</span>
        </div>
        <div className="fed-sentiment-meter__bar">
          <div
            className="fed-sentiment-meter__marker"
            style={{ left: `${position}%` }}
          >
            <div className="fed-sentiment-meter__marker-dot" />
            <span className="fed-sentiment-meter__marker-label">{label}</span>
          </div>
        </div>
      </div>

      {/* Context lines */}
      <div className="fed-sentiment-meter__context">
        <span className="fed-sentiment-meter__context-line">
          {t('economicCalendar.fedSentiment.lastDecision', 'Last decision:')} <strong>{resolvedLast}</strong>
        </span>
        <span className="fed-sentiment-meter__context-line">
          {t('economicCalendar.fedSentiment.marketExpecting', 'Market expecting:')} <strong>{resolvedExpecting}</strong>
        </span>
      </div>
    </div>
  )
}

export default FedSentimentMeter
