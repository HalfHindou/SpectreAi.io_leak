/**
 * VolatilityBadge — Inline pill showing expected vs realized volatility.
 * Pre-release: ~2.1% VOL
 * Post-release: EXP 2.1% -> REA 3.4% (colored by exceeded/subdued)
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import './VolatilityBadge.css'

// Expected volatility lookup by category + impact
const VOL_TABLE = {
  'Interest Rate': { critical: 3.2, high: 2.4, medium: 1.5, low: 0.8 },
  Employment:      { critical: 2.8, high: 2.0, medium: 1.2, low: 0.6 },
  Inflation:       { critical: 2.5, high: 1.8, medium: 1.0, low: 0.5 },
  GDP:             { critical: 2.2, high: 1.6, medium: 0.9, low: 0.4 },
  Housing:         { critical: 1.5, high: 1.0, medium: 0.6, low: 0.3 },
  Consumer:        { critical: 1.8, high: 1.2, medium: 0.7, low: 0.4 },
  Manufacturing:   { critical: 1.6, high: 1.1, medium: 0.6, low: 0.3 },
  Trade:           { critical: 1.4, high: 1.0, medium: 0.5, low: 0.3 },
  Crypto:          { critical: 4.5, high: 3.2, medium: 2.0, low: 1.0 },
}

const DEFAULT_VOL = { critical: 2.0, high: 1.4, medium: 0.8, low: 0.4 }

function getExpectedVol(category, impact) {
  const table = VOL_TABLE[category] || DEFAULT_VOL
  return table[impact] || 1.0
}

// Values can arrive as strings ("-0.9%", "1234K"). Strip units and parse.
function toNumber(value) {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const cleaned = String(value).replace(/[^0-9.\-]/g, '')
  if (!cleaned) return null
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

// Simulate realized vol from actual deviation
function getRealizedVol(event, expected) {
  const actualNum = toNumber(event.actual)
  const forecastNum = toNumber(event.forecast)
  if (actualNum == null || forecastNum == null) return null
  const deviation = Math.abs(actualNum - forecastNum)
  const pct = forecastNum !== 0 ? (deviation / Math.abs(forecastNum)) * 100 : 0
  // Scale: actual deviation maps roughly to vol
  const rea = Math.max(0.1, expected * (0.5 + pct * 0.4))
  return Number.isFinite(rea) ? rea : null
}

const VolatilityBadge = ({ event }) => {
  const { t } = useTranslation()
  const { expected, realized, exceeded } = useMemo(() => {
    const exp = getExpectedVol(event.category, event.impact)
    const rea = getRealizedVol(event, exp)
    return {
      expected: exp,
      realized: rea,
      exceeded: rea != null ? rea > exp : null,
    }
  }, [event])

  if (realized != null) {
    return (
      <span className={`vol-badge vol-badge--${exceeded ? 'exceeded' : 'subdued'}`}>
        <span className="vol-badge__label">{t('economicCalendar.volatility.exp', 'EXP')}</span>
        <span className="vol-badge__num">{expected.toFixed(1)}%</span>
        <span className="vol-badge__arrow">{'\u2192'}</span>
        <span className="vol-badge__label">{t('economicCalendar.volatility.rea', 'REA')}</span>
        <span className="vol-badge__num">{realized.toFixed(1)}%</span>
      </span>
    )
  }

  return (
    <span className="vol-badge">
      <span className="vol-badge__tilde">~</span>
      <span className="vol-badge__num">{expected.toFixed(1)}%</span>
      <span className="vol-badge__label">{t('economicCalendar.volatility.vol', 'VOL')}</span>
    </span>
  )
}

export default VolatilityBadge
