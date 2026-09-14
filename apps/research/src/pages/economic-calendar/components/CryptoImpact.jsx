/**
 * CryptoImpact Component
 * Asset impact section showing average market moves on beat/miss/inline
 * with horizontal bar visualizations and correlation analysis.
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import InfoTip from '@/components/InfoTip'
import './CryptoImpact.css'

/**
 * Get the correlation strength label.
 */
function getCorrelationLabel(value) {
  const abs = Math.abs(value)
  if (value < -0.3) return 'inverse'
  if (abs >= 0.6) return 'high'
  if (abs >= 0.3) return 'moderate'
  return 'low'
}

/**
 * Render a single scenario row (Beat / Miss / In-line).
 */
const ScenarioRow = ({ label, labelClass, moves, maxAbsValue }) => {
  const assets = Object.entries(moves || {})

  return (
    <div className="crypto-impact__scenario">
      <span className={`crypto-impact__scenario-label ${labelClass}`}>{label}</span>
      <div className="crypto-impact__moves">
        {assets.map(([asset, rawValue]) => {
          const value = Number(rawValue) || 0
          const isPositive = value >= 0
          const barWidth = maxAbsValue > 0 ? (Math.abs(value) / maxAbsValue) * 100 : 0

          return (
            <div key={asset} className="crypto-impact__move">
              <span className="crypto-impact__asset-name">{asset}</span>
              <div className="crypto-impact__bar-container">
                <div
                  className={`crypto-impact__bar ${isPositive ? 'crypto-impact__bar--bull' : 'crypto-impact__bar--bear'}`}
                  style={{ width: `${Math.min(barWidth, 100)}%` }}
                />
              </div>
              <span className={`crypto-impact__move-value ${isPositive ? 'crypto-impact__move-value--bull' : 'crypto-impact__move-value--bear'}`}>
                {isPositive ? '+' : ''}{value}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const CryptoImpact = ({ cryptoImpact }) => {
  const { t } = useTranslation()
  // 2026-06-11: real data only. This component used to merge a canned
  // DEFAULT_DATA fallback, so EVERY event — Swedish industrial production
  // included — showed the same "BTC -3.1% on miss" numbers. Render only
  // when the event actually carries curated impact data.
  const data = cryptoImpact || null
  const hasScenarios = data && (data.btcAvgMoveBeat || data.btcAvgMoveMiss || data.btcAvgMoveInline)
  if (!hasScenarios) return null

  // Compute max absolute value across all scenarios for bar scaling
  const allValues = [
    ...Object.values(data.btcAvgMoveBeat || {}),
    ...Object.values(data.btcAvgMoveMiss || {}),
    ...Object.values(data.btcAvgMoveInline || {}),
  ].map(v => Number(v) || 0)
  const maxAbsValue = Math.max(...allValues.map(Math.abs), 0.1)

  const correlations = data.correlations || {}

  return (
    <div className="crypto-impact">
      <div className="crypto-impact__header">
        <span className="crypto-impact__title">{t('economicCalendar.assetImpact', 'ASSET IMPACT')}</span>
        <InfoTip text={t('economicCalendar.assetImpactTooltip', 'Shows how BTC and correlated assets historically react in the 4 hours after this type of data release. Based on last 12 months of data.')} position="right" />
        <span className="crypto-impact__subtitle">{t('economicCalendar.postReleaseAverages', '(4h post-release averages)')}</span>
      </div>

      <div className="crypto-impact__scenarios">
        <ScenarioRow
          label={t('economicCalendar.onBeat', 'On BEAT:')}
          labelClass="crypto-impact__scenario-label--beat"
          moves={data.btcAvgMoveBeat}
          maxAbsValue={maxAbsValue}
        />
        <ScenarioRow
          label={t('economicCalendar.onMiss', 'On MISS:')}
          labelClass="crypto-impact__scenario-label--miss"
          moves={data.btcAvgMoveMiss}
          maxAbsValue={maxAbsValue}
        />
        <ScenarioRow
          label={t('economicCalendar.inLine', 'In-line:')}
          labelClass="crypto-impact__scenario-label--inline"
          moves={data.btcAvgMoveInline}
          maxAbsValue={maxAbsValue}
        />
      </div>

      {/* Correlations */}
      {Object.keys(correlations).length > 0 && (
        <div className="crypto-impact__correlations">
          <span className="crypto-impact__corr-label">{t('economicCalendar.correlation', 'Correlation:')}</span>
          {Object.entries(correlations).map(([asset, rawValue], i, arr) => {
            const value = Number(rawValue) || 0
            const label = getCorrelationLabel(value)
            return (
              <span key={asset} className="crypto-impact__corr-item">
                <span className="crypto-impact__corr-asset">{asset}:</span>
                <span className={`crypto-impact__corr-value crypto-impact__corr-value--${label}`}>
                  {value > 0 ? '+' : ''}{value.toFixed(2)}
                </span>
                <span className="crypto-impact__corr-strength">({label})</span>
                {i < arr.length - 1 && <span className="crypto-impact__corr-sep">|</span>}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default CryptoImpact
