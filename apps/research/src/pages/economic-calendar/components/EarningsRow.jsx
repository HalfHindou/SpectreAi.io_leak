/**
 * EarningsRow — Compact earnings event card.
 * Shows ticker, company, EPS/Rev estimates, and crypto relevance badge.
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import { formatEventTime } from '../utils/formatters'
import './EarningsRow.css'

const relevanceColors = {
  critical: { bg: 'rgba(239, 68, 68, 0.08)', color: '#ef4444', labelKey: 'impactCriticalUpper', fallback: 'CRITICAL' },
  high: { bg: 'rgba(245, 158, 11, 0.08)', color: '#f59e0b', labelKey: 'impactHighUpper', fallback: 'HIGH' },
  medium: { bg: 'rgba(245, 245, 247, 0.06)', color: 'rgba(245,245,247,0.6)', labelKey: 'earnings.med', fallback: 'MED' },
  low: { bg: 'rgba(245, 245, 247, 0.04)', color: 'rgba(245,245,247,0.4)', labelKey: 'impactLowUpper', fallback: 'LOW' },
}

const EarningsRow = ({ earning }) => {
  const { t } = useTranslation()
  const rel = relevanceColors[earning.crypto_relevance] || relevanceColors.low

  return (
    <div className="earnings-row">
      <div className="earnings-row__left">
        <span className="earnings-row__ticker">{earning.ticker}</span>
        <span className="earnings-row__name">{earning.name}</span>
        <span className="earnings-row__relevance" style={{ background: rel.bg, color: rel.color }}>
          {t(`economicCalendar.${rel.labelKey}`, rel.fallback)}
        </span>
      </div>
      <div className="earnings-row__right">
        <div className="earnings-row__estimates">
          <span className="earnings-row__est">
            <span className="earnings-row__est-label">{t('economicCalendar.earnings.eps', 'EPS')}</span>
            <span className="earnings-row__est-val">{earning.epsEstimate}</span>
          </span>
          <span className="earnings-row__est-sep">&middot;</span>
          <span className="earnings-row__est">
            <span className="earnings-row__est-label">{t('economicCalendar.earnings.rev', 'Rev')}</span>
            <span className="earnings-row__est-val">{earning.revenueEstimate}</span>
          </span>
        </div>
        <span className="earnings-row__time">
          {formatEventTime(earning.dateTime)}
        </span>
      </div>
    </div>
  )
}

export default EarningsRow
