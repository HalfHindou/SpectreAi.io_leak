/**
 * MobileQuickStats - 2x2 grid of glass stat cards for the mobile Welcome page.
 * Shows Total Market Cap, Fear & Greed, BTC Dominance, and Alt Season.
 */
import React, { memo, useMemo } from 'react'
import IButton from '@/components/intelligence/IButton'
import './mobile-quick-stats.css'

/**
 * Format a large number into abbreviated form ($1.2T, $45.3B, $890M).
 * Falls back to the raw number if it's below 1M.
 */
const fmtLargeValue = (val) => {
  if (val == null || isNaN(val)) return '-'
  const n = Number(val)
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toLocaleString()}`
}

/**
 * Get Fear & Greed color based on value range.
 * 0-25: red, 26-46: orange, 47-53: gray, 54-75: green, 76-100: bright green
 */
const getFearGreedColor = (val) => {
  if (val == null) return 'rgba(245, 245, 247, 0.5)'
  if (val <= 25) return 'var(--bear, #EF4444)'
  if (val <= 46) return 'var(--amber, #F59E0B)'
  if (val <= 53) return 'rgba(245, 245, 247, 0.5)'
  if (val <= 75) return 'var(--bull, #10B981)'
  return 'var(--bull-bright, #34D399)'
}

/**
 * Day mode Fear & Greed colors (darker tones for readability on light bg).
 */
const getFearGreedColorDay = (val) => {
  if (val == null) return '#64748b'
  if (val <= 25) return '#dc2626'
  if (val <= 46) return '#d97706'
  if (val <= 53) return '#64748b'
  if (val <= 75) return '#16a34a'
  return '#059669'
}

const MobileQuickStats = ({
  topCoinPrices,
  fearGreed,
  marketDominance,
  altSeason,
  dayMode,
  t,
  onDominanceClick,
}) => {
  // Calculate total market cap from BTC market cap + dominance
  const totalMarketCap = useMemo(() => {
    const btcMcap = topCoinPrices?.BTC?.marketCap
    const btcDom = marketDominance?.btc
    if (btcMcap && btcDom > 0) {
      return btcMcap / (btcDom / 100)
    }
    return null
  }, [topCoinPrices?.BTC?.marketCap, marketDominance?.btc])

  // Market cap 24h change (derived from BTC change as proxy)
  const mcapChange = topCoinPrices?.BTC?.change != null ? Number(topCoinPrices.BTC.change) : null

  const fgValue = fearGreed?.value ?? null
  const fgClassification = fearGreed?.value_classification || fearGreed?.classification || ''
  const btcDom = marketDominance?.btc ?? null
  const altValue = typeof altSeason === 'number' ? altSeason : (altSeason?.value ?? null)

  const isLoading = !topCoinPrices?.BTC && fgValue == null

  return (
    <div className={`mobile-quick-stats${dayMode ? ' mobile-quick-stats--day' : ''}`}>
      {/* 1. Total Market Cap */}
      <div className="mobile-quick-stat-card">
        {isLoading ? (
          <StatSkeleton index={0} />
        ) : (
          <>
            <span className="mobile-quick-stat-label">
              {t?.('ui.cryptoMarketCap') || 'Market Cap'}
            </span>
            <span className="mobile-quick-stat-value">
              {totalMarketCap != null ? fmtLargeValue(totalMarketCap) : '-'}
              <IButton size="sm" metricType="market-cap" metricValue={totalMarketCap != null ? fmtLargeValue(totalMarketCap) : '-'} metricLabel="Total crypto market cap" />
            </span>
            {mcapChange != null && (
              <span className={`mobile-quick-stat-change${mcapChange >= 0 ? ' positive' : ' negative'}`}>
                {mcapChange >= 0 ? '+' : ''}{mcapChange.toFixed(1)}%
              </span>
            )}
          </>
        )}
      </div>

      {/* 2. Fear & Greed */}
      <div className="mobile-quick-stat-card">
        {fgValue == null ? (
          <StatSkeleton index={1} />
        ) : (
          <>
            <span className="mobile-quick-stat-label">
              {t?.('ui.fearAndGreed') || 'Fear & Greed'}
            </span>
            <span
              className="mobile-quick-stat-value"
              style={{ color: dayMode ? getFearGreedColorDay(fgValue) : getFearGreedColor(fgValue) }}
            >
              {fgValue}
              <IButton size="sm" metricType="fear-greed" metricValue={String(fgValue)} metricLabel="Fear & Greed Index" contextColor={dayMode ? getFearGreedColorDay(fgValue) : getFearGreedColor(fgValue)} />
            </span>
            <span className="mobile-quick-stat-sub">{fgClassification}</span>
          </>
        )}
      </div>

      {/* 3. BTC Dominance — tap opens TradingView popout */}
      <div
        className={`mobile-quick-stat-card${onDominanceClick && btcDom != null ? ' mobile-quick-stat-card--clickable' : ''}`}
        role={onDominanceClick && btcDom != null ? 'button' : undefined}
        tabIndex={onDominanceClick && btcDom != null ? 0 : undefined}
        onClick={onDominanceClick && btcDom != null ? onDominanceClick : undefined}
        onKeyDown={onDominanceClick && btcDom != null ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDominanceClick() } } : undefined}
        aria-label={onDominanceClick && btcDom != null ? 'Open Bitcoin Dominance chart' : undefined}
      >
        {btcDom == null ? (
          <StatSkeleton index={2} />
        ) : (
          <>
            <span className="mobile-quick-stat-label">
              {t?.('ui.btcDominance') || 'BTC Dominance'}
            </span>
            <span className="mobile-quick-stat-value">
              {btcDom.toFixed(1)}%
              <IButton size="sm" metricType="btc-dominance" metricValue={`${btcDom.toFixed(1)}%`} metricLabel="BTC Dominance" />
            </span>
            <div className="mobile-quick-stat-bar">
              <div
                className="mobile-quick-stat-bar-fill"
                style={{ width: `${Math.min(100, Math.max(0, btcDom))}%` }}
              />
            </div>
          </>
        )}
      </div>

      {/* 4. Alt Season */}
      <div className="mobile-quick-stat-card">
        {altValue == null ? (
          <StatSkeleton index={3} />
        ) : (
          <>
            <span className="mobile-quick-stat-label">
              {t?.('ui.altSeason') || 'Alt Season'}
            </span>
            <span className="mobile-quick-stat-value">
              {altValue}<span className="mobile-quick-stat-of">/100</span>
              <IButton size="sm" metricType="alt-season" metricValue={String(altValue)} metricLabel="Alt Season Index" />
            </span>
            <div className="mobile-quick-stat-bar">
              <div
                className="mobile-quick-stat-bar-fill alt"
                style={{ width: `${Math.min(100, Math.max(0, altValue))}%` }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Shimmer skeleton for a single stat cell.
 * Staggered by 50ms per cell index.
 */
const StatSkeleton = ({ index }) => (
  <div className="mobile-quick-stat-skeleton" style={{ animationDelay: `${index * 50}ms` }}>
    <div className="mobile-quick-stat-skeleton-label" />
    <div className="mobile-quick-stat-skeleton-value" />
  </div>
)

export default memo(MobileQuickStats, (prev, next) => {
  // Only re-render when meaningful data changes
  if (prev.dayMode !== next.dayMode) return false
  if (prev.fearGreed?.value !== next.fearGreed?.value) return false
  if (prev.marketDominance?.btc !== next.marketDominance?.btc) return false
  // Check topCoinPrices by BTC market cap (proxy for data load)
  const prevBtcMcap = prev.topCoinPrices?.BTC?.marketCap
  const nextBtcMcap = next.topCoinPrices?.BTC?.marketCap
  if (prevBtcMcap !== nextBtcMcap) return false
  // Check alt season value
  const prevAlt = typeof prev.altSeason === 'number' ? prev.altSeason : prev.altSeason?.value
  const nextAlt = typeof next.altSeason === 'number' ? next.altSeason : next.altSeason?.value
  if (prevAlt !== nextAlt) return false
  return true
})
