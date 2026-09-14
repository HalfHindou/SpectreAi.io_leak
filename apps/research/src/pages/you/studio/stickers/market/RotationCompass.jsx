import { useState, useEffect, useRef } from 'react'

/**
 * RotationCompass -- Radar/spider chart showing capital flow direction across 6 sectors.
 * Current and previous period polygons drift over time.
 * Designed for ~200x200 sticker area.
 */

const AXES = ['DeFi', 'L1', 'L2', 'Meme', 'AI', 'Infra']
const AXIS_COUNT = AXES.length
const CX = 100
const CY = 100
const R = 80
const ANGLE_OFFSET = -Math.PI / 2 // Start from top

function initValues() {
  return AXES.map(() => 0.3 + Math.random() * 0.6)
}

function polarToXY(index, value) {
  const angle = ANGLE_OFFSET + (index / AXIS_COUNT) * Math.PI * 2
  const r = R * value
  return {
    x: CX + r * Math.cos(angle),
    y: CY + r * Math.sin(angle),
  }
}

function buildPolygonPoints(values) {
  return values
    .map((v, i) => {
      const pt = polarToXY(i, v)
      return `${pt.x},${pt.y}`
    })
    .join(' ')
}

export default function RotationCompass({ sticker, themeObj }) {
  const currentRef = useRef(initValues())
  const previousRef = useRef(initValues())
  const [current, setCurrent] = useState([...currentRef.current])
  const [previous, setPrevious] = useState([...previousRef.current])

  useEffect(() => {
    const interval = setInterval(() => {
      // Shift previous toward old current
      previousRef.current = currentRef.current.map((v) => v)

      // Drift current values
      currentRef.current = currentRef.current.map((v) => {
        const drift = (Math.random() - 0.5) * 0.1
        return Math.max(0.3, Math.min(0.9, v + drift))
      })

      setCurrent([...currentRef.current])
      setPrevious([...previousRef.current])
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // Axis lines
  const axisLines = AXES.map((_, i) => {
    const outer = polarToXY(i, 1)
    return (
      <line
        key={`axis-${i}`}
        x1={CX}
        y1={CY}
        x2={outer.x}
        y2={outer.y}
        stroke={themeObj.stickerText.tertiary}
        strokeOpacity={0.15}
        strokeWidth={1}
      />
    )
  })

  // Axis labels
  const axisLabels = AXES.map((label, i) => {
    const pt = polarToXY(i, 1.15)
    return (
      <text
        key={`label-${i}`}
        x={pt.x}
        y={pt.y}
        textAnchor="middle"
        dominantBaseline="central"
        fill={themeObj.stickerText.tertiary}
        style={{ fontFamily: 'var(--font-mono)', fontSize: 9 }}
      >
        {label}
      </text>
    )
  })

  // Grid circles
  const gridCircles = [40, 60, 80].map((r) => (
    <circle
      key={`grid-${r}`}
      cx={CX}
      cy={CY}
      r={r}
      fill="none"
      stroke={themeObj.stickerText.tertiary}
      strokeOpacity={0.08}
      strokeWidth={1}
    />
  ))

  const prevPoints = buildPolygonPoints(previous)
  const currPoints = buildPolygonPoints(current)

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg
        viewBox="0 0 200 200"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        {/* Grid circles */}
        {gridCircles}

        {/* Axis lines */}
        {axisLines}

        {/* Previous period polygon (dotted) */}
        <polygon
          points={prevPoints}
          fill={themeObj.stickerText.tertiary}
          fillOpacity={0.05}
          stroke={themeObj.stickerText.tertiary}
          strokeOpacity={0.15}
          strokeWidth={1}
          strokeDasharray="4 3"
          style={{ transition: 'all 1s ease' }}
        />

        {/* Current period polygon */}
        <polygon
          points={currPoints}
          fill={themeObj.accentColor}
          fillOpacity={0.15}
          stroke={themeObj.accentColor}
          strokeOpacity={0.6}
          strokeWidth={1.5}
          style={{ transition: 'all 1s ease' }}
        />

        {/* Data point dots on current */}
        {current.map((v, i) => {
          const pt = polarToXY(i, v)
          return (
            <circle
              key={`dot-${i}`}
              cx={pt.x}
              cy={pt.y}
              r={2.5}
              fill={themeObj.accentColor}
              style={{ transition: 'cx 1s ease, cy 1s ease' }}
            />
          )
        })}

        {/* Axis labels */}
        {axisLabels}
      </svg>
    </div>
  )
}
