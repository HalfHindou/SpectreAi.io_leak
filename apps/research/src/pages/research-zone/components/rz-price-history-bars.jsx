/**
 * RzPriceHistoryBars
 * Animated vertical bar chart showing daily price history from ATL to ATH.
 * Each bar represents a day's close price, scaled against the full ATL→ATH range.
 * Bars animate in with staggered entrance + gradient coloring (pink/purple → cyan/green).
 */
import React, { useMemo, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import './rz-price-history-bars.css'

// Get color for a bar based on its position in ATL→ATH range
const getBarGradient = (ratio) => {
  // ratio 0 = ATL (pink/magenta), 0.5 = middle (white/purple), 1.0 = ATH (cyan/green)
  if (ratio < 0.25) {
    // Deep pink → hot pink
    const t = ratio / 0.25
    const r = Math.round(200 + t * 55)
    const g = Math.round(30 + t * 40)
    const b = Math.round(130 + t * 70)
    return `rgb(${r}, ${g}, ${b})`
  } else if (ratio < 0.5) {
    // Hot pink → lavender/white
    const t = (ratio - 0.25) / 0.25
    const r = Math.round(255 - t * 55)
    const g = Math.round(70 + t * 130)
    const b = Math.round(200 + t * 55)
    return `rgb(${r}, ${g}, ${b})`
  } else if (ratio < 0.75) {
    // Lavender → cyan
    const t = (ratio - 0.5) / 0.25
    const r = Math.round(200 - t * 180)
    const g = Math.round(200 + t * 40)
    const b = Math.round(255 - t * 15)
    return `rgb(${r}, ${g}, ${b})`
  } else {
    // Cyan → green
    const t = (ratio - 0.75) / 0.25
    const r = Math.round(20 - t * 10)
    const g = Math.round(240 + t * 15)
    const b = Math.round(240 - t * 100)
    return `rgb(${r}, ${g}, ${b})`
  }
}

const getBarGlow = (ratio) => {
  if (ratio < 0.3) return 'rgba(255, 70, 180, 0.4)'
  if (ratio < 0.6) return 'rgba(180, 130, 255, 0.35)'
  return 'rgba(0, 240, 255, 0.4)'
}

const RzPriceHistoryBars = ({
  dailyBars = null,
  currentPrice = 0,
  atl = 0,
  ath = 0,
  dayMode = false,
  tokenColor = '#00f0ff',
  height = 420,
}) => {
  const { t } = useTranslation()
  const [animated, setAnimated] = useState(false)
  const containerRef = useRef(null)

  const bars = useMemo(() => {
    if (dailyBars && dailyBars.length > 0) {
      return dailyBars.slice(-30)
    }
    return []
  }, [dailyBars])

  // Compute ATL/ATH from bars if not provided
  const range = useMemo(() => {
    const effectiveAtl = atl > 0 ? atl : Math.min(...bars.map(b => b.low || b.close))
    const effectiveAth = ath > 0 ? ath : Math.max(...bars.map(b => b.high || b.close))
    return { atl: effectiveAtl, ath: effectiveAth, spread: effectiveAth - effectiveAtl }
  }, [bars, atl, ath])

  // Trigger animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 100)
    return () => clearTimeout(timer)
  }, [])

  // Reset animation when bars change
  useEffect(() => {
    setAnimated(false)
    const timer = setTimeout(() => setAnimated(true), 100)
    return () => clearTimeout(timer)
  }, [bars.length])

  if (bars.length === 0 || range.spread <= 0) {
    return (
      <div className={`rzphb-container ${dayMode ? 'day-mode' : ''}`} style={{ height }}>
        <div className="rzphb-empty">30D price history unavailable</div>
      </div>
    )
  }

  // Current price position as ratio
  const currentRatio = range.spread > 0
    ? Math.max(0, Math.min(1, (currentPrice - range.atl) / range.spread))
    : 0.5

  // Format price for labels
  const fmtPrice = (p) => {
    if (!p || p <= 0) return '–'
    if (p >= 1000) return `$${(p / 1000).toFixed(1)}K`
    if (p >= 1) return `$${p.toFixed(2)}`
    if (p >= 0.01) return `$${p.toFixed(4)}`
    return `$${p.toFixed(6)}`
  }

  return (
    <div
      ref={containerRef}
      className={`rzphb-container ${dayMode ? 'day-mode' : ''} ${animated ? 'rzphb-animated' : ''}`}
      style={{ height, '--token-color': tokenColor }}
    >
      {/* Header label */}
      <div className="rzphb-header">
        <span className="rzphb-title">{t('researchPro.priceHistoryBars.rzpricehistorybars.priceRange', "Price Range")}</span>
        <span className="rzphb-subtitle">ATL → ATH · 30D</span>
      </div>

      {/* Y-axis labels */}
      <div className="rzphb-y-axis">
        <span className="rzphb-y-label rzphb-y-ath">{fmtPrice(range.ath)}</span>
        <span className="rzphb-y-label rzphb-y-mid">{fmtPrice((range.ath + range.atl) / 2)}</span>
        <span className="rzphb-y-label rzphb-y-atl">{fmtPrice(range.atl)}</span>
      </div>

      {/* Bar area */}
      <div className="rzphb-chart-area">
        {/* Grid lines */}
        <div className="rzphb-gridline" style={{ bottom: '25%' }} />
        <div className="rzphb-gridline" style={{ bottom: '50%' }} />
        <div className="rzphb-gridline" style={{ bottom: '75%' }} />

        {/* Current price line */}
        <div
          className="rzphb-price-line"
          style={{ bottom: `${currentRatio * 100}%` }}
        >
          <span className="rzphb-price-tag">{fmtPrice(currentPrice)}</span>
        </div>

        {/* Bars */}
        <div className="rzphb-bars">
          {bars.map((bar, i) => {
            const ratio = range.spread > 0
              ? (bar.close - range.atl) / range.spread
              : 0.5
            const clampedRatio = Math.max(0.02, Math.min(0.98, ratio))
            const barColor = getBarGradient(clampedRatio)
            const glowColor = getBarGlow(clampedRatio)
            const delay = i * 0.035 // stagger

            return (
              <div
                key={i}
                className="rzphb-bar-wrapper"
                style={{ '--bar-delay': `${delay}s` }}
              >
                <div
                  className="rzphb-bar"
                  style={{
                    '--bar-height': `${clampedRatio * 100}%`,
                    '--bar-color': barColor,
                    '--bar-glow': glowColor,
                  }}
                >
                  {/* Inner glow pip at top */}
                  <div className="rzphb-bar-pip" />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Bottom gradient accent */}
      <div className="rzphb-bottom-glow" />
    </div>
  )
}

// React.memo: receives live currentPrice/data and is mounted on the default
// view - without memo it re-renders on every parent price tick.
export default React.memo(RzPriceHistoryBars)
