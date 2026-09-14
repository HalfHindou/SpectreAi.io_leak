/**
 * ImpactBadge Component
 * Displays 1-4 colored dots + impact label text based on event severity.
 * Critical impact pulses with a glowing animation.
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import InfoTip from '@/components/InfoTip'
import './ImpactBadge.css'

const ImpactBadge = ({ impact = 'low' }) => {
  const { t } = useTranslation()

  // Tiers rank CRYPTO relevance, not global-macro importance: what reprices the
  // US rate path sits above what a Frankfurt macro desk would rank first. The
  // wording here must keep matching tvImpact() in
  // apps/research/api/_lib/handlers/calendar-api.js.
  const IMPACT_TOOLTIPS = {
    critical: t('economicCalendar.impactTooltipCritical', 'Critical: reprices the Fed path outright. Expect 2-5% BTC swings. US CPI/PCE/PPI, NFP, FOMC decisions -- and the Fed Chair speaking, including Jackson Hole.'),
    high: t('economicCalendar.impactTooltipHigh', 'High: moves the tape on the day, rarely the rate path. US second-tier data (jobless claims, retail sales, ISM/PMI, durable goods, Michigan) and non-US rate decisions, minutes and accounts.'),
    medium: t('economicCalendar.impactTooltipMedium', 'Medium: context, not a catalyst. Surveys and soft data (Ifo, GfK, ZEW, consumer confidence outside the US), regional Fed and other central-bank speakers.'),
    low: t('economicCalendar.impactTooltipLow', 'Low: minor release. Rarely moves crypto unless it feeds a narrative. Bill auctions, sub-indices, Redbook.'),
  }

  const IMPACT_CONFIG = {
    low: {
      dots: 1,
      color: 'var(--text-muted)',
      label: t('economicCalendar.impactLowUpper', 'LOW'),
    },
    medium: {
      dots: 2,
      color: 'var(--amber)',
      label: t('economicCalendar.impactMediumUpper', 'MEDIUM'),
    },
    high: {
      dots: 3,
      color: '#F97316',
      label: t('economicCalendar.impactHighUpper', 'HIGH'),
    },
    critical: {
      dots: 4,
      color: 'var(--bear)',
      label: t('economicCalendar.impactCriticalUpper', 'CRITICAL'),
    },
  }

  const config = IMPACT_CONFIG[impact] || IMPACT_CONFIG.low

  return (
    <div className={`impact-badge impact-badge--${impact}`}>
      <div className="impact-badge__dots">
        {Array.from({ length: config.dots }, (_, i) => (
          <span
            key={i}
            className={`impact-badge__dot${impact === 'critical' ? ' impact-badge__dot--pulse' : ''}`}
            style={{ backgroundColor: config.color }}
          />
        ))}
      </div>
      <span
        className="impact-badge__label"
        style={{ color: config.color }}
      >
        {config.label}
      </span>
      <InfoTip text={IMPACT_TOOLTIPS[impact] || IMPACT_TOOLTIPS.low} position="right" />
    </div>
  )
}

export default ImpactBadge
