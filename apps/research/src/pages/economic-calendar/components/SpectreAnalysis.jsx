/**
 * SpectreAnalysis Component
 * AI analysis block with accent left border and mono label.
 * Used in both NextUpHero and EventDetail.
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import InfoTip from '@/components/InfoTip'
import './SpectreAnalysis.css'

const SpectreAnalysis = ({ analysis, eventName }) => {
  const { t } = useTranslation()
  if (!analysis) return null

  return (
    <div className="spectre-analysis">
      <div className="spectre-analysis__header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        <span className="spectre-analysis__label">{t('economicCalendar.spectreAnalysis.label', 'SPECTRE ANALYSIS')}</span>
        <InfoTip text={t('economicCalendar.spectreAnalysis.tooltip', "AI-generated analysis of this event's market significance. Considers historical patterns, current market regime, and positioning data.")} position="right" />
      </div>
      <p className="spectre-analysis__body">{analysis}</p>
    </div>
  )
}

export default SpectreAnalysis
