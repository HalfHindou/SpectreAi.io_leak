/**
 * W-013 · Liquidation Timeline Widget
 * Historical liquidation volume over time as stacked bars.
 * Long liqs in red, short liqs in green, stacked.
 */
import { useState, useEffect, useMemo } from 'react'
import './LiquidationTimeline.css'

const TIMEFRAME_OPTIONS = [
  { label: '1H', key: '1h' },
  { label: '4H', key: '4h' },
  { label: '1D', key: '1d' },
  { label: '7D', key: '7d' },
]

/* 24-point demo time series. No free hourly realized-liquidation feed exists
 * (Coinglass liq history is paid), so this is deterministic sample data — a
 * sine-modulated baseline with fixed spikes — not random churn. */
function generateTimeSeries() {
  const now = Date.now()
  const points = []
  for (let i = 0; i < 24; i++) {
    const timestamp = now - (23 - i) * 3600000 // hourly intervals
    // Smooth, repeatable baseline so the chart is stable between renders.
    const longBase = 12 + 14 * (0.5 + 0.5 * Math.sin(i * 0.6))
    const shortBase = 10 + 11 * (0.5 + 0.5 * Math.sin(i * 0.6 + 1.2))
    const isSpike = i === 7 || i === 15 || i === 20
    const longVol = isSpike ? longBase * 3.5 : longBase
    const shortVol = isSpike ? shortBase * 2.8 : shortBase
    points.push({
      timestamp,
      longVol: longVol * 1e6,
      shortVol: shortVol * 1e6,
      hour: new Date(timestamp).getHours(),
      isSpike: (longVol + shortVol) * 1e6 > 50e6,
    })
  }
  return points
}

// Deterministic shimmer widths so the loading skeleton doesn't flicker.
const SHIMMER_WIDTHS = ['68%', '52%', '81%', '59%']

function formatVol(raw) {
  const num = Number(raw)
  if (!num || isNaN(num)) return '$0'
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`
  if (num >= 1e6) return `$${(num / 1e6).toFixed(0)}M`
  return `$${(num / 1e3).toFixed(0)}K`
}

export default function LiquidationTimeline() {
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [activeTimeframe, setActiveTimeframe] = useState('1d')
  const [hoveredBar, setHoveredBar] = useState(null)

  const data = useMemo(() => generateTimeSeries(), [])

  useEffect(() => {
    const loadTimer = setTimeout(() => setLoading(false), 500)
    const mountTimer = setTimeout(() => setMounted(true), 700)
    return () => { clearTimeout(loadTimer); clearTimeout(mountTimer) }
  }, [])

  /* SVG dimensions */
  const W = 400
  const H = 180
  const PAD_L = 44
  const PAD_R = 12
  const PAD_T = 16
  const PAD_B = 28
  const CHART_W = W - PAD_L - PAD_R
  const CHART_H = H - PAD_T - PAD_B

  const maxTotal = Math.max(...data.map(d => d.longVol + d.shortVol))
  const barWidth = (CHART_W / data.length) * 0.7
  const barGap = (CHART_W / data.length) * 0.3

  /* Y axis ticks */
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(pct => ({
    value: maxTotal * pct,
    y: PAD_T + CHART_H * (1 - pct),
  }))

  if (loading) {
    return (
      <div className="tclt-loading">
        {SHIMMER_WIDTHS.map((w, i) => (
          <div
            key={i}
            className="tcw-shimmer tclt-skeleton"
            style={{ width: w, animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="tclt">
      {/* Header with timeframe controls */}
      <div className="tclt-header">
        <div className="tclt-legend">
          <span className="tclt-legend-item">
            <span className="tclt-legend-swatch tclt-legend-swatch--long" />
            Longs
          </span>
          <span className="tclt-legend-item">
            <span className="tclt-legend-swatch tclt-legend-swatch--short" />
            Shorts
          </span>
        </div>

        {/* Timeframe pills */}
        <div className="tclt-tf">
          {TIMEFRAME_OPTIONS.map((tf) => {
            const isActive = activeTimeframe === tf.key
            return (
              <button
                key={tf.key}
                onClick={() => setActiveTimeframe(tf.key)}
                className={`tclt-tf-btn${isActive ? ' tclt-tf-btn--active' : ''}`}
              >
                {tf.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Chart */}
      <div className="tclt-chart">
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="tclt-svg"
        >
          {/* Gradient definitions */}
          <defs>
            <linearGradient id="liq-tl-long-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(239,68,68,0.6)" />
              <stop offset="100%" stopColor="rgba(239,68,68,0.2)" />
            </linearGradient>
            <linearGradient id="liq-tl-short-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(16,185,129,0.6)" />
              <stop offset="100%" stopColor="rgba(16,185,129,0.2)" />
            </linearGradient>
          </defs>

          {/* Y axis grid lines and labels */}
          {yTicks.map((tick) => (
            <g key={tick.value}>
              <line
                x1={PAD_L}
                y1={tick.y}
                x2={W - PAD_R}
                y2={tick.y}
                stroke="rgba(255,255,255,0.03)"
                strokeWidth={1}
              />
              <text
                x={PAD_L - 6}
                y={tick.y + 3}
                textAnchor="end"
                className="tclt-axis-label"
              >
                {formatVol(tick.value)}
              </text>
            </g>
          ))}

          {/* Stacked bars */}
          {data.map((d, i) => {
            const x = PAD_L + i * (CHART_W / data.length) + barGap / 2
            const totalH = mounted ? ((d.longVol + d.shortVol) / maxTotal) * CHART_H : 0
            const longH = mounted ? (d.longVol / maxTotal) * CHART_H : 0
            const shortH = mounted ? (d.shortVol / maxTotal) * CHART_H : 0
            const barY = PAD_T + CHART_H - totalH
            const isHovered = hoveredBar === i

            return (
              <g
                key={i}
                onMouseEnter={() => setHoveredBar(i)}
                onMouseLeave={() => setHoveredBar(null)}
                className="tclt-bar-group"
              >
                {/* Hit area */}
                <rect
                  x={x}
                  y={PAD_T}
                  width={barWidth}
                  height={CHART_H}
                  fill="transparent"
                />

                {/* Short (bottom, green) */}
                <rect
                  x={x}
                  y={PAD_T + CHART_H - shortH}
                  width={barWidth}
                  height={shortH}
                  rx={2}
                  fill="url(#liq-tl-short-grad)"
                  opacity={d.isSpike ? 0.9 : 0.5}
                  style={{
                    transition: `height 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 0.03}s, y 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 0.03}s`,
                  }}
                />

                {/* Long (top, red) stacked above short */}
                <rect
                  x={x}
                  y={PAD_T + CHART_H - shortH - longH}
                  width={barWidth}
                  height={longH}
                  rx={2}
                  fill="url(#liq-tl-long-grad)"
                  opacity={d.isSpike ? 0.9 : 0.5}
                  style={{
                    transition: `height 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 0.03}s, y 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 0.03}s`,
                  }}
                />

                {/* Spike indicator */}
                {d.isSpike && mounted && (
                  <circle
                    cx={x + barWidth / 2}
                    cy={barY - 6}
                    r={2.5}
                    fill="var(--amber)"
                    opacity={0.8}
                  />
                )}

                {/* Tooltip on hover */}
                {isHovered && (
                  <g>
                    <rect
                      x={Math.min(x - 20, W - PAD_R - 80)}
                      y={barY - 32}
                      width={80}
                      height={24}
                      rx={4}
                      fill="var(--bg-elevated)"
                      stroke="var(--border-strong)"
                      strokeWidth={0.5}
                    />
                    <text
                      x={Math.min(x - 20, W - PAD_R - 80) + 40}
                      y={barY - 16}
                      textAnchor="middle"
                      className="tclt-tooltip-text"
                    >
                      {formatVol(d.longVol + d.shortVol)}
                    </text>
                  </g>
                )}
              </g>
            )
          })}

          {/* X axis time labels (every 4th) */}
          {data.filter((_, i) => i % 4 === 0).map((d, idx) => {
            const i = idx * 4
            const x = PAD_L + i * (CHART_W / data.length) + barWidth / 2
            return (
              <text
                key={i}
                x={x}
                y={H - 6}
                textAnchor="middle"
                className="tclt-axis-label"
              >
                {`${d.hour}:00`}
              </text>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
