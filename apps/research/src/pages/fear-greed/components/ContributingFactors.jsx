/**
 * ContributingFactors — 4 factor cards with real computed scores and progress bars
 */
import React from 'react'
import spectreIcons from '@/icons/spectreIcons'
import { useTranslation } from 'react-i18next'
import InfoTip from '@/components/InfoTip'
import IButton from '@/components/intelligence/IButton'

const FACTOR_TIP_KEYS = {
  momentum: 'fearGreedPage.factorTipMomentum',
  volatility: 'fearGreedPage.factorTipVolatility',
  volume: 'fearGreedPage.factorTipVolume',
  dominance: 'fearGreedPage.factorTipDominance',
}

const FACTOR_CONFIG = [
  { key: 'momentum', i18nKey: 'fearGreed.factorMomentum', icon: spectreIcons.trending },
  { key: 'volatility', i18nKey: 'fearGreed.factorVolatility', icon: spectreIcons.technical },
  { key: 'volume', i18nKey: 'fearGreed.factorVolume', icon: spectreIcons.volume },
  { key: 'dominance', i18nKey: 'fearGreed.factorDominance', icon: spectreIcons.sector },
]

function sentimentLabel(s, t) {
  if (s === 'greed') return t('fearGreed.greed')
  if (s === 'fear') return t('fearGreed.fear')
  return t('fearGreed.neutral')
}

function ContributingFactors({ factors, loading }) {
  const { t } = useTranslation()

  return (
    <div className="fg-factors-section">
      <h2 className="fg-section-title">{t('fearGreed.contributingFactors')}<InfoTip text={t('fearGreedPage.factorsSectionTip')} position="right" /></h2>
      <div className="fg-factors-row">
        {FACTOR_CONFIG.map((cfg, i) => {
          if (loading) {
            return (
              <div
                key={cfg.key}
                className="fg-factor-card fg-card"
                style={{ animationDelay: `${320 + i * 80}ms` }}
              >
                <div className="fg-factor-head">
                  <span className="fg-factor-icon" aria-hidden="true">{cfg.icon}</span>
                  <span className="fg-factor-title">{t(cfg.i18nKey)}</span>
                </div>
                <div className="fg-factor-body">
                  <div className="fg-skeleton-text fg-skeleton-factor-value" />
                  <div className="fg-skeleton-text fg-skeleton-factor-label" />
                </div>
                <div className="fg-factor-bar">
                  <div className="fg-skeleton-bar" />
                </div>
              </div>
            )
          }
          // 2026-05-26 beta-quality fix: when factor data is missing (API failure)
          // render an em-dash placeholder instead of synthesising a "0 / neutral" score
          // that looks like real momentum/volatility readings.
          const factor = factors?.[cfg.key] || null
          const factorValue = factor?.value
          const factorSentiment = factor?.sentiment || 'neutral'
          const hasValue = factor != null && factorValue != null && isFinite(factorValue)
          return (
            <div
              key={cfg.key}
              className="fg-factor-card fg-card"
              data-sentiment={factorSentiment}
              style={{ animationDelay: `${320 + i * 80}ms` }}
            >
              <div className="fg-factor-head">
                <span className="fg-factor-icon" aria-hidden="true">{cfg.icon}</span>
                <span className="fg-factor-title">{t(cfg.i18nKey)}<InfoTip text={t(FACTOR_TIP_KEYS[cfg.key])} position="bottom" /></span>
              </div>

              <div className="fg-factor-body">
                <span className="fg-factor-value">{hasValue ? factorValue : '—'}</span>
                {hasValue && (
                  <IButton size="sm" metricType={`fg_${cfg.key}`} metricValue={`${factorValue}/100 — ${sentimentLabel(factorSentiment, t)}`} metricLabel={t(cfg.i18nKey)} />
                )}
                <span className={`fg-factor-sentiment fg-factor-sentiment--${factorSentiment}`}>
                  {hasValue ? sentimentLabel(factorSentiment, t) : '—'}
                </span>
              </div>

              <div className="fg-factor-bar">
                <div
                  className={`fg-factor-bar-fill fg-factor-bar-fill--${factorSentiment}`}
                  style={{ width: hasValue ? `${factorValue}%` : '0%' }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default React.memo(ContributingFactors)
