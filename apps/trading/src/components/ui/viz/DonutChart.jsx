/**
 * DonutChart — multi-segment composition ring via SVG strokes.
 *
 * Used by the Supply Vitals tile (circ vs total) and possibly the
 * Liquidity Pool composition (when pair-reserve data exists).
 */
import React, { useMemo } from 'react'
import './DonutChart.css'

function DonutChart({
  segments = [],
  size = 120,
  thickness = 12,
  legend = false,
  className = '',
  children,            // rendered in the donut core
}) {
  const radius = (size - thickness) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * radius

  const total = useMemo(
    () => segments.reduce((s, x) => s + (Number(x.value) || 0), 0) || 1,
    [segments]
  )

  let offset = 0
  const arcs = segments.map((seg, i) => {
    const len = ((Number(seg.value) || 0) / total) * circumference
    const segOffset = offset
    offset += len
    return (
      <circle
        key={i}
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke={seg.color || 'var(--accent)'}
        strokeWidth={thickness}
        strokeDasharray={`${len} ${circumference - len}`}
        strokeDashoffset={-segOffset}
        className="donut-seg"
      />
    )
  })

  return (
    <div className={['donut', className].filter(Boolean).join(' ')}>
      <div className="donut-ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <g transform={`rotate(-90 ${cx} ${cy})`}>
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke="var(--glass-fill)"
              strokeWidth={thickness}
            />
            {arcs}
          </g>
        </svg>
        {children && <div className="donut-core">{children}</div>}
      </div>
      {legend && segments.length > 0 && (
        <ul className="donut-legend">
          {segments.map((seg, i) => (
            <li key={i} className="donut-legend-row">
              <span
                className="donut-swatch"
                style={{ background: seg.color || 'var(--accent)' }}
              />
              <span className="donut-legend-label">{seg.label}</span>
              <span className="donut-legend-value">
                {(((Number(seg.value) || 0) / total) * 100).toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default React.memo(DonutChart)
