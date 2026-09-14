/**
 * W-041 · Portfolio Ring Widget
 * SVG donut chart showing portfolio allocation with legend and hover tooltip.
 * Uses simulated portfolio data with realistic crypto allocations.
 */
import { useState, useEffect, useCallback } from 'react'
import './PortfolioRing.css'

/* ---------- data ---------- */

const ASSETS = [
  { token: 'BTC', color: '#F7931A', basePct: 42 },
  { token: 'ETH', color: '#627EEA', basePct: 28 },
  { token: 'SOL', color: '#14F195', basePct: 18 },
  { token: 'BNB', color: '#F0B90B', basePct: 12 },
]

// Demo portfolio (no wallet/exchange source wired). Deterministic so it does
// not flicker between renders. Guarded against a zero total.
function generatePortfolio() {
  const total = ASSETS.reduce((s, a) => s + a.basePct, 0)
  const normalized = total > 0
    ? ASSETS.map(a => ({ ...a, pct: (a.basePct / total) * 100 }))
    : ASSETS.map(a => ({ ...a, pct: 0 }))

  const totalValue = 128400

  return { assets: normalized, totalValue }
}

/* ---------- helpers ---------- */

function formatValue(raw) {
  const num = Number(raw)
  if (!num || isNaN(num)) return '$0'
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`
  return `$${num.toFixed(0)}`
}

/* ---------- donut ---------- */

function DonutChart({ assets, totalValue, hoveredIndex, onHover }) {
  const size = 120
  const cx = size / 2
  const cy = size / 2
  const outerR = 52
  const innerR = 36
  const gapAngle = 0.02 // Small gap between segments in radians

  let cumAngle = -Math.PI / 2 // Start at top
  const segments = assets.map((asset, i) => {
    const angle = (asset.pct / 100) * (Math.PI * 2) - gapAngle
    const startAngle = cumAngle + gapAngle / 2
    const endAngle = startAngle + angle
    cumAngle = startAngle + angle + gapAngle / 2

    const x1Outer = cx + outerR * Math.cos(startAngle)
    const y1Outer = cy + outerR * Math.sin(startAngle)
    const x2Outer = cx + outerR * Math.cos(endAngle)
    const y2Outer = cy + outerR * Math.sin(endAngle)
    const x1Inner = cx + innerR * Math.cos(endAngle)
    const y1Inner = cy + innerR * Math.sin(endAngle)
    const x2Inner = cx + innerR * Math.cos(startAngle)
    const y2Inner = cy + innerR * Math.sin(startAngle)

    const largeArc = angle > Math.PI ? 1 : 0

    const d = [
      `M ${x1Outer} ${y1Outer}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2Outer} ${y2Outer}`,
      `L ${x1Inner} ${y1Inner}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x2Inner} ${y2Inner}`,
      'Z',
    ].join(' ')

    return { d, color: asset.color, index: i }
  })

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {segments.map((seg) => (
        <path
          key={seg.index}
          d={seg.d}
          fill={seg.color}
          opacity={hoveredIndex != null && hoveredIndex !== seg.index ? 0.35 : 1}
          style={{ transition: 'opacity 0.2s ease', cursor: 'pointer' }}
          onMouseEnter={() => onHover(seg.index)}
          onMouseLeave={() => onHover(null)}
        />
      ))}
      {/* Center text */}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 14,
          fontWeight: 700,
          fill: 'var(--text-primary)',
        }}
      >
        {formatValue(totalValue)}
      </text>
      <text
        x={cx}
        y={cy + 12}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 8,
          fill: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        TOTAL
      </text>
    </svg>
  )
}

/* ---------- component ---------- */

export default function PortfolioRing() {
  const [data, setData] = useState(null)
  const [hoveredIndex, setHoveredIndex] = useState(null)

  const refresh = useCallback(() => {
    setData(generatePortfolio())
  }, [])

  useEffect(() => {
    const t = setTimeout(refresh, 400)
    return () => { clearTimeout(t) }
  }, [refresh])

  return (
    <div className="tcpr">
      {!data ? (
        <div className="tcpr-loading">
          <div className="tcw-shimmer tcpr-ring-skeleton" />
          <div className="tcpr-legend-skeleton">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="tcw-shimmer" style={{ width: 80, height: 14 }} />
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Donut */}
          <div className="tcpr-donut">
            <DonutChart
              assets={data.assets}
              totalValue={data.totalValue}
              hoveredIndex={hoveredIndex}
              onHover={setHoveredIndex}
            />

            {/* Tooltip on hover */}
            {hoveredIndex != null && (
              <div className="tcpr-tooltip">
                <span className="tcpr-tooltip-token" style={{ color: data.assets[hoveredIndex].color }}>
                  {data.assets[hoveredIndex].token}
                </span>
                <span className="tcpr-tooltip-value">
                  {formatValue(data.totalValue * data.assets[hoveredIndex].pct / 100)}
                </span>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="tcpr-legend">
            {data.assets.map((asset, i) => (
              <div
                key={asset.token}
                className={`tcpr-legend-row${hoveredIndex != null && hoveredIndex !== i ? ' tcpr-legend-row--dim' : ''}`}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {/* Color dot */}
                <div className="tcpr-dot" style={{ background: asset.color }} />

                {/* Token name */}
                <span className="tcpr-token">{asset.token}</span>

                {/* Percentage */}
                <span className="tcpr-pct">{Number(asset.pct || 0).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
