/**
 * GlobalMetricsRow — 5 glass metric cards showing global crypto market data
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import InfoTip from '@/components/InfoTip'
import { useCurrency } from '@/hooks/useCurrency'

const METRIC_TIP_KEYS = {
  'fearGreed.totalMarketCap': 'fearGreedPage.metricTipTotalMarketCap',
  'fearGreed.btcDominance': 'fearGreedPage.metricTipBtcDominance',
  'fearGreed.ethDominance': 'fearGreedPage.metricTipEthDominance',
  'fearGreed.volume24h': 'fearGreedPage.metricTipVolume24h',
  'fearGreed.activeCryptos': 'fearGreedPage.metricTipActiveCryptos',
  'fearGreed.defiMarketCap': 'fearGreedPage.metricTipDefiMarketCap',
  'fearGreed.defiVolume24h': 'fearGreedPage.metricTipDefiVolume24h',
  'fearGreed.stablecoinVolume24h': 'fearGreedPage.metricTipStablecoinVolume24h',
}

function formatPercent(v) {
  if (v == null) return '—'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function GlobalMetricsRow({ data, loading, dayMode }) {
  const { t } = useTranslation()
  const { fmtLarge } = useCurrency()

  const formatLargeNumber = (n) => {
    if (n == null || n === 0) return '—'
    return fmtLarge(n)
  }

  const SKELETON_LABELS = [
    'fearGreed.totalMarketCap',
    'fearGreed.btcDominance',
    'fearGreed.ethDominance',
    'fearGreed.volume24h',
    'fearGreed.activeCryptos',
  ]

  if (loading) {
    return (
      <section className="fg-metrics-section">
        <h2 className="fg-section-title">{t('fearGreedPage.marketPulse')}</h2>
        <div className="fg-metrics-row">
          {SKELETON_LABELS.map((key, i) => (
            <div key={i} className="fg-metric-card fg-card" style={{ animationDelay: `${160 + i * 80}ms` }}>
              <span className="fg-metric-label">{t(key)}</span>
              <div className="fg-metric-value-row">
                <div className="fg-skeleton-text fg-skeleton-value" />
              </div>
              <div className="fg-metric-bar">
                <div className="fg-skeleton-bar" />
              </div>
            </div>
          ))}
        </div>
      </section>
    )
  }

  const metrics = [
    {
      label: t('fearGreed.totalMarketCap'),
      tipKey: 'fearGreed.totalMarketCap',
      value: formatLargeNumber(data?.totalMarketCap),
      change: data?.marketCapChange24h,
      hasChange: true,
    },
    {
      label: t('fearGreed.btcDominance'),
      tipKey: 'fearGreed.btcDominance',
      value: data?.btcDominance ? `${data.btcDominance.toFixed(1)}%` : '—',
      barValue: data?.btcDominance || 0,
      hasBar: true,
    },
    {
      label: t('fearGreed.ethDominance'),
      tipKey: 'fearGreed.ethDominance',
      value: data?.ethDominance ? `${data.ethDominance.toFixed(1)}%` : '—',
      barValue: data?.ethDominance || 0,
      hasBar: true,
    },
    {
      label: t('fearGreed.volume24h'),
      tipKey: 'fearGreed.volume24h',
      value: formatLargeNumber(data?.totalVolume),
    },
    {
      label: t('fearGreed.activeCryptos'),
      tipKey: 'fearGreed.activeCryptos',
      value: data?.activeCryptos ? data.activeCryptos.toLocaleString() : '—',
    },
  ]

  // DeFi / Stablecoin metrics (only when available from CMC)
  if (data?.defiMarketCap) {
    metrics.push({
      label: t('fearGreed.defiMarketCap'),
      tipKey: 'fearGreed.defiMarketCap',
      value: formatLargeNumber(data.defiMarketCap),
    })
  }
  if (data?.defiVolume24h) {
    metrics.push({
      label: t('fearGreed.defiVolume24h'),
      tipKey: 'fearGreed.defiVolume24h',
      value: formatLargeNumber(data.defiVolume24h),
    })
  }
  if (data?.stablecoinVolume24h) {
    metrics.push({
      label: t('fearGreed.stablecoinVolume24h'),
      tipKey: 'fearGreed.stablecoinVolume24h',
      value: formatLargeNumber(data.stablecoinVolume24h),
    })
  }

  return (
    <section className="fg-metrics-section">
      <h2 className="fg-section-title">{t('fearGreedPage.marketPulse')}<InfoTip text={t('fearGreedPage.marketPulseTip')} position="right" /></h2>
      <div className="fg-metrics-row">
        {metrics.map((m, i) => (
          <div key={i} className="fg-metric-card fg-card" style={{ animationDelay: `${160 + i * 80}ms` }}>
            <span className="fg-metric-label">{m.label}{m.tipKey && METRIC_TIP_KEYS[m.tipKey] && <InfoTip text={t(METRIC_TIP_KEYS[m.tipKey])} position="bottom" />}</span>
            <div className="fg-metric-value-row">
              <span className="fg-metric-value">{m.value}</span>
              {m.hasChange && m.change != null && (
                <span className={`fg-metric-change ${m.change >= 0 ? 'positive' : 'negative'}`}>
                  {formatPercent(m.change)}
                </span>
              )}
            </div>
            {m.hasBar && (
              <div className="fg-metric-bar">
                <div className="fg-metric-bar-fill" style={{ width: `${Math.min(100, m.barValue)}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

export default React.memo(GlobalMetricsRow)
