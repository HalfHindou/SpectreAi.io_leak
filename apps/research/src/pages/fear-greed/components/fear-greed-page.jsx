/**
 * Fear & Greed Index — Full Dashboard
 * Real data via CMC/CoinGecko/Alternative.me through server proxy
 * Apple Cinematic design system
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { getMarketIndices } from '@/services/stockApi'
import { useFearGreedData } from './useFearGreedData'
import FearGreedGauge from './FearGreedGauge'
import FearGreedChart from './FearGreedChart'
import GlobalMetricsRow from './GlobalMetricsRow'
import ContributingFactors from './ContributingFactors'
import MarketThesis from './MarketThesis'
import InfoTip from '@/components/InfoTip'
import FreshnessTag from '@/components/freshness-tag'
import './fear-greed-page.css'
import './fear-greed-page.mobile.css'

// VIX-to-Fear/Greed mapping for stock mode
function vixToFearGreed(vix) {
  if (vix == null) return { value: 50, classification: 'Neutral' }
  if (vix <= 12) return { value: 95, classification: 'Extreme Greed' }
  if (vix <= 15) return { value: Math.round(80 + ((15 - vix) / 3) * 15), classification: 'Greed' }
  if (vix <= 20) return { value: Math.round(60 + ((20 - vix) / 5) * 20), classification: 'Greed' }
  if (vix <= 25) return { value: Math.round(40 + ((25 - vix) / 5) * 20), classification: 'Neutral' }
  if (vix <= 30) return { value: Math.round(15 + ((30 - vix) / 5) * 25), classification: 'Fear' }
  if (vix <= 40) return { value: Math.round(5 + ((40 - vix) / 10) * 10), classification: 'Extreme Fear' }
  return { value: 5, classification: 'Extreme Fear' }
}

function fgClassification(v) {
  if (v <= 25) return 'Extreme Fear'
  if (v <= 45) return 'Fear'
  if (v <= 55) return 'Neutral'
  if (v <= 75) return 'Greed'
  return 'Extreme Greed'
}

function fgBadgeColor(v) {
  if (v <= 25) return { bg: 'rgba(239,68,68,0.85)', text: '#fff' }
  if (v <= 45) return { bg: 'rgba(249,115,22,0.85)', text: '#fff' }
  if (v <= 55) return { bg: 'rgba(234,179,8,0.25)', text: '#eab308' }
  if (v <= 75) return { bg: 'rgba(132,204,22,0.25)', text: '#84cc16' }
  return { bg: 'rgba(16,185,129,0.25)', text: '#10b981' }
}

// Market regime fetcher — module-scope cache + in-flight dedup (mirrors the
// pattern in services/fearGreedApi.js). Backs the fear-greed Reason card via
// /api/market/regime (proxied to spectre-data-api). If the upstream returns
// empty / errors, the card is hidden — never falls back to placeholder copy.
const _regimeCache = { data: null, ts: 0 }
let _regimeInflight = null
const REGIME_TTL_MS = 5 * 60 * 1000

function fetchMarketRegime() {
  if (_regimeCache.data !== null && Date.now() - _regimeCache.ts < REGIME_TTL_MS) {
    return Promise.resolve(_regimeCache.data)
  }
  if (_regimeInflight) return _regimeInflight
  _regimeInflight = fetch('/api/market/regime', { signal: AbortSignal.timeout(8000) })
    .then(r => (r.ok ? r.json() : null))
    .then(json => {
      const data = json?.data || null
      _regimeCache.data = data
      _regimeCache.ts = Date.now()
      _regimeInflight = null
      return data
    })
    .catch(() => {
      _regimeInflight = null
      return null
    })
  return _regimeInflight
}

function useMarketRegime() {
  const [data, setData] = useState(_regimeCache.data)
  const [loading, setLoading] = useState(_regimeCache.data == null)
  useEffect(() => {
    let cancelled = false
    fetchMarketRegime().then(result => {
      if (cancelled) return
      setData(result)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])
  return { data, loading }
}

function HistoricalValuesCard({ history, t }) {
  const len = history?.length || 0
  const periods = [
    { label: t('fearGreed.yesterday'), offset: 2 },
    { label: t('fearGreed.lastWeek'), offset: 8 },
    { label: t('fearGreed.lastMonth'), offset: 31 },
  ]

  return (
    <div className="fg-hero-snapshot fg-card">
      <span className="fg-section-label fg-section-label--bold">{t('fearGreed.historicalValues')}<InfoTip text={t('fearGreedPage.historicalValuesTip')} position="right" /></span>
      <div className="fg-snapshot-stats">
        {periods.map(({ label, offset }) => {
          const idx = len - offset
          const val = idx >= 0 ? history[idx]?.value : null
          if (val == null) return (
            <div className="fg-snapshot-stat" key={label}>
              <span className="fg-snapshot-label">{label}</span>
              <span className="fg-snapshot-value fg-snapshot-value--dim">—</span>
            </div>
          )
          const cls = fgClassification(val)
          const colors = fgBadgeColor(val)
          return (
            <div className="fg-snapshot-stat" key={label}>
              <span className="fg-snapshot-label">{label}</span>
              <span
                className="fg-historical-badge"
                style={{ background: colors.bg, color: colors.text }}
              >
                {cls} — {val}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Distribution buckets ──
const DIST_BUCKETS = [
  { min: 0, max: 10, label: '0-10' },
  { min: 10, max: 20, label: '10-20' },
  { min: 20, max: 30, label: '20-30' },
  { min: 30, max: 40, label: '30-40' },
  { min: 40, max: 50, label: '40-50' },
  { min: 50, max: 60, label: '50-60' },
  { min: 60, max: 70, label: '60-70' },
  { min: 70, max: 80, label: '70-80' },
  { min: 80, max: 90, label: '80-90' },
  { min: 90, max: 100, label: '90-100' },
]

// Factor config for mobile inline rendering
const FACTOR_CONFIG = [
  { key: 'momentum', i18nKey: 'fearGreed.factorMomentum', icon: '\u2197' },
  { key: 'volatility', i18nKey: 'fearGreed.factorVolatility', icon: '\u27E1' },
  { key: 'volume', i18nKey: 'fearGreed.factorVolume', icon: '\u25C8' },
  { key: 'dominance', i18nKey: 'fearGreed.factorDominance', icon: '\u25C9' },
]

function bucketColor(min) {
  const mid = min + 5
  if (mid <= 25) return '#ef4444'
  if (mid <= 45) return '#ea580c'
  if (mid <= 55) return '#eab308'
  if (mid <= 75) return '#84cc16'
  return '#22c55e'
}

function HistoricalDistribution({ history, currentValue }) {
  const { t } = useTranslation()
  const data = useMemo(() => {
    if (!history?.length) return null
    const counts = new Array(DIST_BUCKETS.length).fill(0)
    history.forEach(h => {
      const v = Number(h.value)
      const idx = Math.min(DIST_BUCKETS.length - 1, Math.max(0, Math.floor(v / 10)))
      counts[idx]++
    })
    const total = history.length
    const maxPct = Math.max(...counts.map(c => c / total))
    return DIST_BUCKETS.map((b, i) => ({
      ...b,
      pct: ((counts[i] / total) * 100).toFixed(1),
      width: maxPct > 0 ? (counts[i] / total) / maxPct : 0,
    }))
  }, [history])

  // Compute percentile: % of historical readings at or below currentValue.
  // NOTE: these useMemos MUST stay above the `if (!data) return null` early
  // return - a conditional return between hooks violates the Rules of Hooks
  // (hook count changes when `data` is null) and crashes React.
  const percentile = useMemo(() => {
    if (currentValue == null || !history?.length) return null
    const below = history.filter(h => Number(h.value) <= currentValue).length
    return Math.round((below / history.length) * 100)
  }, [history, currentValue])

  // Earliest year in data
  const sinceYear = useMemo(() => {
    if (!history?.length) return null
    const firstTs = parseInt(history[0]?.timestamp, 10)
    return firstTs ? new Date(firstTs * 1000).getFullYear() : null
  }, [history])

  if (!data) return null

  const currentBucket = currentValue != null
    ? Math.min(DIST_BUCKETS.length - 1, Math.max(0, Math.floor(currentValue / 10)))
    : -1

  return (
    <div className="fg-dist-card fg-card">
      <h3 className="fg-dist-title">{t('fearGreedPage.historicalDistribution', 'Historical Distribution').toUpperCase()}<InfoTip text={t('fearGreedPage.distributionTip')} position="right" /></h3>
      <div className="fg-dist-bars">
        {data.map((d, i) => (
          <div key={d.label} className={`fg-dist-row${i === currentBucket ? ' fg-dist-row--current' : ''}`}>
            <span className="fg-dist-label">{d.label}</span>
            <div className="fg-dist-track">
              <div
                className="fg-dist-bar"
                style={{ width: `${d.width * 100}%`, background: bucketColor(d.min) }}
              />
            </div>
            <span className="fg-dist-pct">{d.pct}%</span>
          </div>
        ))}
      </div>
      <div className="fg-dist-footer">
        {percentile != null && (() => {
          const text = t('fearGreedPage.distributionFooterMain', 'You are in the bottom {{percentile}}% of all historical readings', { percentile })
          const m = text.match(/^(.*?)(bottom \d+%)(.*)$/)
          return (
            <p className="fg-dist-footer-main">
              {m ? <>{m[1]}<strong>{m[2]}</strong>{m[3]}</> : text}
            </p>
          )
        })()}
        {sinceYear && (
          <p className="fg-dist-footer-sub">{t('fearGreedPage.distributionFooterSub', 'Based on {{count}} days of data since {{year}}', { count: history.length, year: sinceYear })}</p>
        )}
      </div>
    </div>
  )
}

// ── Forward return zones (labels resolved via i18n at render) ──
const FWD_ZONES = [
  { key: 'capitulation', labelKey: 'fearGreedPage.zoneCapitulation', range: '0-20', min: 0, max: 20, color: '#ef4444' },
  { key: 'fear', labelKey: 'fearGreedPage.zoneFear', range: '20-40', min: 20, max: 40, color: '#ea580c' },
  { key: 'neutral', labelKey: 'fearGreedPage.zoneNeutral', range: '40-60', min: 40, max: 60, color: '#eab308' },
  { key: 'greed', labelKey: 'fearGreedPage.zoneGreed', range: '60-80', min: 60, max: 80, color: '#84cc16' },
  { key: 'euphoria', labelKey: 'fearGreedPage.zoneEuphoria', range: '80-100', min: 80, max: 100, color: '#22c55e' },
]

function HistoricalForwardReturns({ history, btcHistory, currentValue }) {
  const { t } = useTranslation()
  const data = useMemo(() => {
    if (!history?.length || !btcHistory?.prices?.length) return null

    // Build a ts→price lookup from BTC data
    const prices = btcHistory.prices.map(([ts, p]) => ({ ts: Math.floor(ts / 1000), price: p }))
    if (prices.length < 30) return null

    // Binary search helper
    const findPrice = (targetTs) => {
      let lo = 0, hi = prices.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (prices[mid].ts < targetTs) lo = mid + 1
        else hi = mid
      }
      // Find closest
      if (lo > 0 && Math.abs(prices[lo - 1].ts - targetTs) < Math.abs(prices[lo].ts - targetTs)) lo--
      return prices[lo]?.price ?? null
    }

    const periods = [
      { key: '7d', days: 7 },
      { key: '30d', days: 30 },
      { key: '60d', days: 60 },
      { key: '90d', days: 90 },
    ]

    return FWD_ZONES.map(zone => {
      const points = history.filter(h => {
        const v = Number(h.value)
        return v >= zone.min && v < zone.max
      })

      const returns = {}
      periods.forEach(({ key, days }) => {
        const validReturns = []
        points.forEach(h => {
          const ts = parseInt(h.timestamp, 10)
          const entryPrice = findPrice(ts)
          const exitPrice = findPrice(ts + days * 86400)
          if (entryPrice && exitPrice && entryPrice > 0) {
            validReturns.push(((exitPrice - entryPrice) / entryPrice) * 100)
          }
        })
        returns[key] = validReturns.length >= 3
          ? validReturns.reduce((s, v) => s + v, 0) / validReturns.length
          : null
      })

      return { ...zone, returns }
    })
  }, [history, btcHistory])

  if (!data) return null

  const currentZoneIdx = currentValue != null
    ? FWD_ZONES.findIndex(z => currentValue >= z.min && currentValue < z.max)
    : -1

  return (
    <div className="fg-fwd-card fg-card">
      <h3 className="fg-fwd-title">{t('fearGreedPage.historicalForwardReturns', 'Historical Forward Returns').toUpperCase()}<InfoTip text={t('fearGreedPage.forwardReturnsTip')} position="right" /></h3>
      <p className="fg-fwd-subtitle">{t('fearGreedPage.forwardReturnsSubtitle', 'When F&G was in this range, BTC returned on average...')}</p>
      <div className="fg-fwd-table">
        <div className="fg-fwd-header">
          <span className="fg-fwd-hcell fg-fwd-hcell--zone">{t('fearGreedPage.zone', 'Zone').toUpperCase()}</span>
          <span className="fg-fwd-hcell">7D</span>
          <span className="fg-fwd-hcell">30D</span>
          <span className="fg-fwd-hcell">60D</span>
          <span className="fg-fwd-hcell">90D</span>
        </div>
        {data.map((zone, i) => (
          <div key={zone.key} className={`fg-fwd-row${i === currentZoneIdx ? ' fg-fwd-row--current' : ''}`}>
            <div className="fg-fwd-zone-cell">
              <span className="fg-fwd-zone-dot" style={{ background: zone.color }} />
              <div className="fg-fwd-zone-info">
                <span className="fg-fwd-zone-name">{t(zone.labelKey)}</span>
                {i === currentZoneIdx && <span className="fg-fwd-current-badge">{t('fearGreedPage.current', 'Current').toUpperCase()}</span>}
                <span className="fg-fwd-zone-range">{zone.range}</span>
              </div>
            </div>
            {['7d', '30d', '60d', '90d'].map(key => {
              const val = zone.returns[key]
              if (val == null) return <span key={key} className="fg-fwd-val fg-fwd-val--na">—</span>
              const positive = val >= 0
              return (
                <span key={key} className={`fg-fwd-val ${positive ? 'fg-fwd-val--pos' : 'fg-fwd-val--neg'}`}>
                  {positive ? '+' : ''}{val.toFixed(1)}%
                </span>
              )
            })}
          </div>
        ))}
      </div>
      <p className="fg-fwd-footer">{t('fearGreedPage.forwardReturnsFooter', 'Based on historical data since 2025. Past performance does not predict future results.')}</p>
    </div>
  )
}

const FearGreedPage = ({ dayMode = false, isMobile = false, onBack, marketMode = 'crypto', onTokenClick }) => {
  const { t } = useTranslation()
  const { fmtLarge } = useCurrency()
  const isStocks = marketMode === 'stocks'

  // ── Crypto mode: use CMC-based hook ──
  const { current, history, global, movers, factors, btcHistory, loading, error, refetch, lastUpdated } = useFearGreedData(120000)

  // ── Stock mode: VIX-based fear/greed ──
  const [stockFG, setStockFG] = useState({ value: null, classification: '', loading: true })
  const [vixValue, setVixValue] = useState(null)

  const isStocksRef = useRef(isStocks)
  useEffect(() => { isStocksRef.current = isStocks }, [isStocks])

  const fetchVix = useCallback(async () => {
    const startMode = isStocksRef.current
    try {
      const indices = await getMarketIndices()
      if (isStocksRef.current !== startMode || !isStocksRef.current) return
      const vix = indices?.find?.(i => i.symbol === '^VIX' || i.symbol === 'VIX')
      if (vix?.price) {
        setVixValue(vix.price)
        const fg = vixToFearGreed(vix.price)
        setStockFG({ value: fg.value, classification: fg.classification, loading: false })
      } else {
        const fg = vixToFearGreed(22)
        setVixValue(22)
        setStockFG({ value: fg.value, classification: fg.classification, loading: false })
      }
    } catch (err) {
      console.error('VIX fetch error:', err)
      if (isStocksRef.current !== startMode || !isStocksRef.current) return
      const fg = vixToFearGreed(22)
      setVixValue(22)
      setStockFG({ value: fg.value, classification: fg.classification, loading: false })
    }
  }, [])

  // Initial VIX fetch on stock mode
  useEffect(() => {
    if (!isStocks) return
    fetchVix()
  }, [isStocks, fetchVix])

  // Adaptive polling for VIX data (2 min)
  useAdaptivePolling(fetchVix, { interval: 2 * 60 * 1000, enabled: isStocks })

  // Resolve which data to show
  const displayValue = isStocks ? stockFG.value : current?.value
  const displayClass = isStocks ? stockFG.classification : current?.classification
  const displayLoading = isStocks ? stockFG.loading : loading
  const displayHistory = isStocks ? [] : history

  // Live market-regime feed powers the Reason card (crypto mode only).
  // Hook always runs; card auto-hides when description is empty.
  const { data: regime, loading: regimeLoading } = useMarketRegime()
  const regimeReason = regime?.description || null
  const regimeLabel = regime?.label || null
  const regimeConfidence = typeof regime?.confidence === 'number' ? regime.confidence : null
  const regimeColor = regime?.color || null

  // Helper: format large USD values for mobile metrics via the user's currency
  const fmtLg = (n) => {
    if (n == null || n === 0) return '—'
    return fmtLarge(n)
  }

  // Normalize classification for display
  const normalizedDisplayClass = displayClass
    ? displayClass.replace(/\b\w/g, c => c.toUpperCase())
    : ''

  // Sentiment color for mobile
  const mSentimentColor = (v) => {
    if (v == null) return '#eab308'
    if (v <= 25) return '#ef4444'
    if (v <= 45) return '#f97316'
    if (v <= 55) return '#eab308'
    if (v <= 75) return '#84cc16'
    return '#10b981'
  }

  // Distribution data (used by both mobile inline and desktop HistoricalDistribution)
  const mobileDistData = useMemo(() => {
    if (!history?.length) return null
    const counts = new Array(DIST_BUCKETS.length).fill(0)
    history.forEach(h => {
      const v = Number(h.value)
      const idx = Math.min(DIST_BUCKETS.length - 1, Math.max(0, Math.floor(v / 10)))
      counts[idx]++
    })
    const total = history.length
    const maxPct = Math.max(...counts.map(c => c / total))
    return DIST_BUCKETS.map((b, i) => ({
      ...b,
      pct: ((counts[i] / total) * 100).toFixed(1),
      width: maxPct > 0 ? (counts[i] / total) / maxPct : 0,
    }))
  }, [history])

  const currentBucket = displayValue != null
    ? Math.min(DIST_BUCKETS.length - 1, Math.max(0, Math.floor(displayValue / 10)))
    : -1

  /* ═══════════════════════════════════════════
     MOBILE LAYOUT
     ═══════════════════════════════════════════ */
  if (isMobile) {
    const sc = mSentimentColor(displayValue)

    // Historical snapshot data
    const histLen = history?.length || 0
    const histPeriods = [
      { label: t('fearGreed.yesterday'), offset: 2 },
      { label: t('fearGreed.lastWeek'), offset: 8 },
      { label: t('fearGreed.lastMonth'), offset: 31 },
    ]

    // Metrics for horizontal scroll
    const mobileMetrics = []
    if (global) {
      if (global.totalMarketCap) mobileMetrics.push({ label: t('fearGreedPage.marketCapShort'), value: fmtLg(global.totalMarketCap), change: global.marketCapChange24h })
      if (global.btcDominance) mobileMetrics.push({ label: t('fearGreedPage.btcDomShort'), value: `${global.btcDominance.toFixed(1)}%`, bar: global.btcDominance })
      if (global.ethDominance) mobileMetrics.push({ label: t('fearGreedPage.ethDomShort'), value: `${global.ethDominance.toFixed(1)}%`, bar: global.ethDominance })
      if (global.totalVolume) mobileMetrics.push({ label: t('fearGreedPage.volume24hShort'), value: fmtLg(global.totalVolume) })
      if (global.activeCryptos) mobileMetrics.push({ label: t('fearGreedPage.activeShort'), value: global.activeCryptos.toLocaleString() })
    }

    return (
      <div className={`fg-page mfg-page${dayMode ? ' day-mode' : ''}`}>
        <div className="mfg-content">
          {/* Header spacer */}
          <div className="mfg-header-spacer" aria-hidden="true" />

          {/* Error state */}
          {error && !current && (
            <div className="mfg-section">
              <div className="mfg-error">
                <p>{t('errors.failedToLoad') || 'Unable to load market data'}</p>
                <button type="button" className="mfg-retry-btn" onClick={refetch}>
                  {t('common.retry') || 'Retry'}
                </button>
              </div>
            </div>
          )}

          {/* Gauge */}
          <div className="mfg-section">
            <div className="mfg-gauge-wrap">
              <FearGreedGauge
                value={displayValue}
                classification={displayClass}
                history={displayHistory}
                loading={displayLoading}
                dayMode={dayMode}
              />
            </div>
          </div>

          {/* Historical values */}
          {!isStocks && !displayLoading && history?.length > 0 && (
            <div className="mfg-section">
              <span className="mfg-section-label">{t('fearGreed.historicalValues')}</span>
              <div className="mfg-hist-row">
                {histPeriods.map(({ label, offset }) => {
                  const idx = histLen - offset
                  const val = idx >= 0 ? history[idx]?.value : null
                  const cls = val != null ? fgClassification(val) : null
                  const clr = val != null ? mSentimentColor(val) : null
                  return (
                    <div className="mfg-hist-card" key={label}>
                      <span className="mfg-hist-label">{label}</span>
                      {val != null ? (
                        <span className="mfg-hist-badge" style={{ color: clr }}>{val} - {cls}</span>
                      ) : (
                        <span className="mfg-hist-badge mfg-hist-badge--dim">—</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Reason card - live market regime */}
          {!isStocks && !displayLoading && displayValue != null && (regimeLoading ? (
            <div className="mfg-section">
              <span className="mfg-section-label">{t('fearGreedPage.reason', 'Reason')}</span>
              <div className="fg-skeleton-text" style={{ width: '70%', height: 16, borderRadius: 6, marginTop: 6 }} />
            </div>
          ) : regimeReason ? (
            <div className="mfg-section fg-reason-card">
              <span className="fg-reason-label">{t('fearGreedPage.reason', 'Reason')}</span>
              {regimeLabel && (
                <div className="fg-reason-regime">
                  {regimeColor && (
                    <span className="fg-reason-dot" style={{ background: regimeColor }} aria-hidden="true" />
                  )}
                  <span className="fg-reason-regime-label">{regimeLabel}</span>
                </div>
              )}
              <p className="fg-reason-text">{regimeReason}</p>
              {regimeConfidence != null && (
                <span className="fg-reason-confidence">{t('fearGreedPage.confidence', { value: regimeConfidence })}</span>
              )}
            </div>
          ) : null)}

          {/* Market Thesis — LLM narrative (read · thesis · bull · bear · mean
              reversion · watchlist). Crypto only; hides on stocks via the
              !isStocks gate that already wraps the surrounding mobile sections. */}
          {!isStocks && (
            <div className="mfg-section">
              <MarketThesis />
            </div>
          )}

          {/* Chart */}
          <div className="mfg-section-flush">
            <div className="mfg-chart-wrap">
              <FearGreedChart
                history={displayHistory}
                current={isStocks ? null : current}
                btcHistory={isStocks ? null : btcHistory}
                dayMode={dayMode}
              />
            </div>
          </div>

          {/* Market Pulse - horizontal scroll */}
          {!isStocks && mobileMetrics.length > 0 && (
            <div className="mfg-section-flush">
              <div className="mfg-section mfg-metrics-header">
                <span className="mfg-section-label">{t('fearGreedPage.marketPulse')}</span>
              </div>
              <div className="mfg-metrics-scroll">
                {mobileMetrics.map((m, i) => (
                  <div key={i} className="mfg-metric-chip">
                    <span className="mfg-metric-chip-label">{m.label}</span>
                    <span className="mfg-metric-chip-value">{m.value}</span>
                    {m.change != null && (
                      <span className={`mfg-metric-chip-change${m.change >= 0 ? ' pos' : ' neg'}`}>
                        {m.change >= 0 ? '+' : ''}{m.change.toFixed(2)}%
                      </span>
                    )}
                    {m.bar != null && (
                      <div className="mfg-metric-chip-bar">
                        <div className="mfg-metric-chip-bar-fill" style={{ width: `${Math.min(100, m.bar)}%` }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contributing Factors - 2x2 grid */}
          {!isStocks && (
            <div className="mfg-section">
              <span className="mfg-section-label">{t('fearGreed.contributingFactors')}</span>
              <div className="mfg-factors-grid">
                {FACTOR_CONFIG.map((cfg) => {
                  const factor = factors?.[cfg.key] || { value: 0, sentiment: 'neutral' }
                  if (displayLoading) {
                    return (
                      <div key={cfg.key} className="mfg-factor-card">
                        <span className="mfg-factor-icon">{cfg.icon}</span>
                        <span className="mfg-factor-title">{t(cfg.i18nKey)}</span>
                        <div className="mfg-skeleton" style={{ width: 40, height: 20, borderRadius: 4 }} />
                      </div>
                    )
                  }
                  const fColor = mSentimentColor(factor.value)
                  return (
                    <div key={cfg.key} className="mfg-factor-card">
                      <div className="mfg-factor-head">
                        <span className="mfg-factor-icon">{cfg.icon}</span>
                        <span className="mfg-factor-title">{t(cfg.i18nKey)}</span>
                      </div>
                      <span className="mfg-factor-value" style={{ color: fColor }}>{factor.value}</span>
                      <span className={`mfg-factor-sentiment mfg-factor-sentiment--${factor.sentiment}`}>
                        {factor.sentiment === 'greed' ? t('fearGreed.greed') : factor.sentiment === 'fear' ? t('fearGreed.fear') : t('fearGreed.neutral')}
                      </span>
                      <div className="mfg-factor-bar">
                        <div className="mfg-factor-bar-fill" style={{ width: `${factor.value}%`, background: fColor }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Historical Distribution */}
          {!isStocks && mobileDistData && (
            <div className="mfg-section">
              <span className="mfg-section-label">{t('fearGreedPage.distribution')}</span>
              <div className="mfg-dist-bars">
                {mobileDistData.map((d, i) => (
                  <div key={d.label} className={`mfg-dist-row${i === currentBucket ? ' mfg-dist-row--current' : ''}`}>
                    <span className="mfg-dist-label">{d.label}</span>
                    <div className="mfg-dist-track">
                      <div className="mfg-dist-bar" style={{ width: `${d.width * 100}%`, background: bucketColor(d.min) }} />
                    </div>
                    <span className="mfg-dist-pct">{d.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Forward Returns */}
          {!isStocks && history?.length > 0 && btcHistory?.prices?.length > 0 && (
            <div className="mfg-section">
              <span className="mfg-section-label">{t('fearGreedPage.forwardReturns')}</span>
              <p className="mfg-fwd-subtitle">{t('fearGreedPage.forwardReturnsShortSubtitle')}</p>
              <HistoricalForwardReturns history={history} btcHistory={btcHistory} currentValue={displayValue} />
            </div>
          )}

          {/* Bottom spacer for nav clearance */}
          <div className="mfg-bottom-spacer" />
        </div>
      </div>
    )
  }

  /* ═══════════════════════════════════════════
     DESKTOP LAYOUT
     ═══════════════════════════════════════════ */
  return (
    <div className={`fg-page ${dayMode ? 'day-mode' : ''}`}>
      {/* Header */}
      <header className="fg-header">
        {onBack && (
          <button type="button" className="fg-back-btn" onClick={onBack} aria-label={t('common.back')}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {t('common.back')}
          </button>
        )}
        <h1 className="fg-title">
          {isStocks ? t('fearGreed.vixTitle') : t('fearGreed.title')}
          <FreshnessTag timestamp={lastUpdated} tier="warm" className="fg-fresh" />
        </h1>
        <p className="fg-subtitle">
          {isStocks
            ? `${t('fearGreed.vixSubtitle')}${vixValue != null ? ` — VIX: ${vixValue.toFixed(1)}` : ''}`
            : t('fearGreed.researchSubtitle', 'Track the mood of the crypto market and how it moves with price.')}
        </p>
      </header>

      {error && !current && (
        <div className="fg-error-state">
          <svg className="fg-error-icon" width="32" height="32" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <p className="fg-error-msg">{t('errors.failedToLoad', t('fearGreedPage.unableToLoad', 'Unable to load market data'))}</p>
          <button type="button" className="fg-retry-btn" onClick={refetch}>
            {t('common.retry') || 'Retry'}
          </button>
        </div>
      )}

      {/* Hero: Gauge + Snapshot | Chart */}
      <section className="fg-hero">
        <div className="fg-hero-left">
          <FearGreedGauge
            value={displayValue}
            classification={displayClass}
            history={displayHistory}
            loading={displayLoading}
            dayMode={dayMode}
          />
          {!isStocks && (displayLoading ? (
            <div className="fg-hero-snapshot fg-card">
              <span className="fg-section-label fg-section-label--bold">{t('fearGreed.historicalValues')}</span>
              <div className="fg-snapshot-stats">
                {[t('fearGreed.yesterday'), t('fearGreed.lastWeek'), t('fearGreed.lastMonth')].map(label => (
                  <div className="fg-snapshot-stat" key={label}>
                    <span className="fg-snapshot-label">{label}</span>
                    <div className="fg-skeleton-text" style={{ width: 120, height: 24, borderRadius: 20 }} />
                  </div>
                ))}
              </div>
            </div>
          ) : history?.length > 0 && (
            <HistoricalValuesCard history={history} t={t} />
          ))}
          {!isStocks && !displayLoading && displayValue != null && (regimeLoading ? (
            <div className="fg-reason-card fg-card">
              <span className="fg-reason-label">{t('fearGreedPage.reason', 'Reason')}</span>
              <div className="fg-skeleton-text" style={{ width: '70%', height: 18, borderRadius: 6, marginTop: 4 }} />
            </div>
          ) : regimeReason ? (
            <div className="fg-reason-card fg-card">
              <span className="fg-reason-label">{t('fearGreedPage.reason', 'Reason')}<InfoTip text={t('fearGreedPage.reasonTip')} position="right" /></span>
              {regimeLabel && (
                <div className="fg-reason-regime">
                  {regimeColor && (
                    <span className="fg-reason-dot" style={{ background: regimeColor }} aria-hidden="true" />
                  )}
                  <span className="fg-reason-regime-label">{regimeLabel}</span>
                </div>
              )}
              <p className="fg-reason-text">{regimeReason}</p>
              {regimeConfidence != null && (
                <span className="fg-reason-confidence">{t('fearGreedPage.confidence', { value: regimeConfidence })}</span>
              )}
            </div>
          ) : null)}
        </div>
        <FearGreedChart
          history={displayHistory}
          current={isStocks ? null : current}
          btcHistory={isStocks ? null : btcHistory}
          dayMode={dayMode}
        />
      </section>

      {/* Market Thesis — LLM narrative card. Hero-prominent: directly under
          the gauge/chart row, before global metrics. Crypto only; the F&G
          number on this page is crypto-specific. */}
      {!isStocks && (
        <section className="fg-thesis-row">
          <MarketThesis />
        </section>
      )}

      {/* Global Market Metrics (crypto only) */}
      {!isStocks && (
        <GlobalMetricsRow data={global} loading={loading} dayMode={dayMode} />
      )}

      {/* Historical Distribution + Forward Returns */}
      {!isStocks && history?.length > 0 && (
        <section className="fg-analytics-row">
          <HistoricalDistribution history={history} currentValue={displayValue} />
          <HistoricalForwardReturns history={history} btcHistory={btcHistory} currentValue={displayValue} />
        </section>
      )}

      {/* Contributing Factors (crypto only) */}
      {!isStocks && (
        <ContributingFactors factors={factors} loading={loading} />
      )}


    </div>
  )
}

export default FearGreedPage

// Shared visual language with the Research Zone.
import '@/styles/research-refresh.css'
