/**
 * RadialGauge — 270° arc gauge via inline SVG.
 *
 * Two stacked circles use stroke-dasharray + a 135° rotation so the gap
 * sits at the bottom. Color zones drive the arc color via the `zones`
 * prop. Center shows value + verdict label.
 *
 * Used by the Liquidity Vitals tile (zones thin/moderate/healthy).
 */
import React, { useMemo } from 'react'
import './RadialGauge.css'

function pickZone(value, zones) {
  for (const z of zones) {
    if (value <= z.to) return z
  }
  return zones[zones.length - 1]
}

function RadialGauge({
  value = 0,           // 0..1
  zones,               // [{to, color, label}]
  centerValue,
  centerLabel,
  size = 120,
  thickness = 10,
  className = '',
}) {
  const v = Math.max(0, Math.min(1, Number(value) || 0))
  const radius = (size - thickness) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * radius
  const arcLength = circumference * 0.75      // 270°
  const fillLength = arcLength * v

  const zone = useMemo(
    () => (zones && zones.length ? pickZone(v, zones) : null),
    [v, zones]
  )
  const color = zone?.color || 'var(--accent)'
  const verdict = centerLabel || zone?.label

  return (
    <div className={['gauge', className].filter(Boolean).join(' ')} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <g transform={`rotate(135 ${cx} ${cy})`}>
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="var(--glass-fill)"
            strokeWidth={thickness}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeLinecap="round"
          />
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeDasharray={`${fillLength} ${circumference}`}
            strokeLinecap="round"
            className="gauge-arc"
            style={{ filter: `drop-shadow(0 0 6px ${color})` }}
          />
        </g>
      </svg>
      <div className="gauge-core">
        {centerValue != null && <span className="gauge-value">{centerValue}</span>}
        {verdict && (
          <span className="gauge-verdict" style={{ color }}>
            {verdict}
          </span>
        )}
      </div>
    </div>
  )
}

export default React.memo(RadialGauge)
