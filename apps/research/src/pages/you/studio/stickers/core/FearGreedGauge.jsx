import { useState, useEffect, useRef } from 'react'

/**
 * FearGreedGauge — Semi-circular arc gauge showing Fear & Greed Index.
 * Simulated value drifts between 30-85 every 5 seconds.
 * Designed for ~180x120 sticker area.
 */
export default function FearGreedGauge({ sticker, themeObj }) {
  const valueRef = useRef(Math.floor(Math.random() * 56) + 30) // 30-85
  const [value, setValue] = useState(valueRef.current)

  useEffect(() => {
    const interval = setInterval(() => {
      const drift = (Math.random() - 0.5) * 4
      valueRef.current = Math.max(30, Math.min(85, valueRef.current + drift))
      setValue(Math.round(valueRef.current))
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // Arc geometry
  const cx = 90
  const cy = 95
  const r = 65

  // Needle angle: value 0 => -90deg (left), value 100 => +90deg (right)
  const needleAngle = ((value / 100) * 180) - 90

  // Needle tip position (for the dot)
  const needleRad = (needleAngle - 90) * (Math.PI / 180)
  const tipX = cx + r * Math.cos(needleRad)
  const tipY = cy + r * Math.sin(needleRad)

  // Label based on value
  const label = value > 55 ? 'Greed' : value < 45 ? 'Fear' : 'Neutral'

  // Arc segment colors (5 equal segments spanning 180 degrees)
  const segmentColors = ['#EF4444', '#F59E0B', '#EAB308', '#10B981', '#34D399']
  const segmentCount = segmentColors.length
  const startAngleDeg = 180 // leftmost (SVG: 180deg = pointing left)
  const totalSweep = 180

  function polarToCartesian(cxp, cyp, radius, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180
    return {
      x: cxp + radius * Math.cos(rad),
      y: cyp + radius * Math.sin(rad),
    }
  }

  function describeArc(cxp, cyp, radius, startDeg, endDeg) {
    const start = polarToCartesian(cxp, cyp, radius, endDeg)
    const end = polarToCartesian(cxp, cyp, radius, startDeg)
    const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
    return `M ${start.x},${start.y} A ${radius},${radius} 0 ${largeArc} 0 ${end.x},${end.y}`
  }

  const arcSegments = segmentColors.map((color, i) => {
    const segStart = startAngleDeg + (i * totalSweep) / segmentCount
    const segEnd = startAngleDeg + ((i + 1) * totalSweep) / segmentCount
    return (
      <path
        key={i}
        d={describeArc(cx, cy, r, segStart, segEnd)}
        fill="none"
        stroke={color}
        strokeWidth={14}
        strokeLinecap={i === 0 ? 'round' : i === segmentCount - 1 ? 'round' : 'butt'}
      />
    )
  })

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg
        viewBox="0 0 180 120"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        {/* Arc segments */}
        {arcSegments}

        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={tipX}
          y2={tipY}
          stroke={themeObj.stickerText.primary}
          strokeWidth={2}
          strokeLinecap="round"
          style={{
            transition: 'x2 1s ease-out, y2 1s ease-out',
          }}
        />

        {/* Needle tip dot */}
        <circle
          cx={tipX}
          cy={tipY}
          r={3.5}
          fill={themeObj.accentColor}
          style={{
            transition: 'cx 1s ease-out, cy 1s ease-out',
          }}
        />

        {/* Center pivot dot */}
        <circle
          cx={cx}
          cy={cy}
          r={3}
          fill={themeObj.stickerText.tertiary}
        />
      </svg>

      {/* Value number */}
      <div
        style={{
          position: 'absolute',
          bottom: 18,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: 32,
          fontWeight: 700,
          color: themeObj.stickerText.primary,
          lineHeight: 1,
          pointerEvents: 'none',
        }}
      >
        {value}
      </div>

      {/* Label */}
      <div
        style={{
          position: 'absolute',
          bottom: 4,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: themeObj.stickerText.tertiary,
          lineHeight: 1,
          pointerEvents: 'none',
        }}
      >
        {label}
      </div>
    </div>
  )
}
