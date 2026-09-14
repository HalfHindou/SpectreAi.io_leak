/**
 * SentimentPulse - Remotion Composition
 * Animated sentiment gauge visualization
 *
 * Features:
 * - Circular gauge with gradient arc
 * - Animated needle with physics
 * - Pulsing sentiment indicators
 * - Fear/Greed color transitions
 */
import React, { useMemo } from 'react'
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing
} from 'remotion'

// Sentiment levels
const SENTIMENT_LEVELS = [
  { label: 'Extreme Fear', color: '#ef4444', min: 0, max: 20 },
  { label: 'Fear', color: '#f97316', min: 20, max: 40 },
  { label: 'Neutral', color: '#eab308', min: 40, max: 60 },
  { label: 'Greed', color: '#22c55e', min: 60, max: 80 },
  { label: 'Extreme Greed', color: '#10b981', min: 80, max: 100 },
]

// Get sentiment info from value
const getSentimentInfo = (value) => {
  return SENTIMENT_LEVELS.find(s => value >= s.min && value < s.max) || SENTIMENT_LEVELS[4]
}

// Arc path generator
const describeArc = (x, y, radius, startAngle, endAngle) => {
  const start = {
    x: x + radius * Math.cos(startAngle),
    y: y + radius * Math.sin(startAngle),
  }
  const end = {
    x: x + radius * Math.cos(endAngle),
    y: y + radius * Math.sin(endAngle),
  }
  const largeArcFlag = endAngle - startAngle <= Math.PI ? 0 : 1

  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`
}

// Gauge arc component
const GaugeArc = ({ cx, cy, radius, value, frame }) => {
  const startAngle = Math.PI * 0.75  // 135 degrees
  const endAngle = Math.PI * 2.25    // 405 degrees
  const totalAngle = endAngle - startAngle

  // Animated value
  const animatedValue = spring({
    frame,
    fps: 30,
    config: { damping: 15, stiffness: 50 },
  }) * value

  const valueAngle = startAngle + (animatedValue / 100) * totalAngle

  return (
    <g>
      {/* Background arc */}
      <path
        d={describeArc(cx, cy, radius, startAngle, endAngle)}
        fill="none"
        stroke="rgba(255, 255, 255, 0.1)"
        strokeWidth={12}
        strokeLinecap="round"
      />

      {/* Gradient arc segments */}
      {SENTIMENT_LEVELS.map((level, i) => {
        const segmentStart = startAngle + (level.min / 100) * totalAngle
        const segmentEnd = startAngle + (level.max / 100) * totalAngle

        return (
          <path
            key={level.label}
            d={describeArc(cx, cy, radius, segmentStart, segmentEnd)}
            fill="none"
            stroke={level.color}
            strokeWidth={12}
            strokeLinecap="round"
            opacity={0.3}
          />
        )
      })}

      {/* Active arc (up to current value) */}
      {animatedValue > 0 && (
        <path
          d={describeArc(cx, cy, radius, startAngle, valueAngle)}
          fill="none"
          stroke={getSentimentInfo(animatedValue).color}
          strokeWidth={12}
          strokeLinecap="round"
          filter="url(#arcGlow)"
        />
      )}

      {/* Tick marks */}
      {[0, 25, 50, 75, 100].map(tick => {
        const tickAngle = startAngle + (tick / 100) * totalAngle
        const innerRadius = radius - 20
        const outerRadius = radius + 8

        return (
          <line
            key={tick}
            x1={cx + innerRadius * Math.cos(tickAngle)}
            y1={cy + innerRadius * Math.sin(tickAngle)}
            x2={cx + outerRadius * Math.cos(tickAngle)}
            y2={cy + outerRadius * Math.sin(tickAngle)}
            stroke="rgba(255, 255, 255, 0.3)"
            strokeWidth={2}
          />
        )
      })}
    </g>
  )
}

// Needle component
const Needle = ({ cx, cy, value, frame }) => {
  const startAngle = Math.PI * 0.75
  const totalAngle = Math.PI * 1.5

  // Spring animation for needle
  const animatedValue = spring({
    frame,
    fps: 30,
    config: { damping: 12, stiffness: 80 },
  }) * value

  // Add subtle wobble
  const wobble = Math.sin(frame * 0.15) * 2

  const angle = startAngle + ((animatedValue + wobble) / 100) * totalAngle
  const needleLength = 70

  const tipX = cx + needleLength * Math.cos(angle)
  const tipY = cy + needleLength * Math.sin(angle)

  return (
    <g>
      {/* Needle shadow */}
      <line
        x1={cx + 2}
        y1={cy + 2}
        x2={tipX + 2}
        y2={tipY + 2}
        stroke="rgba(0, 0, 0, 0.3)"
        strokeWidth={4}
        strokeLinecap="round"
      />

      {/* Needle */}
      <line
        x1={cx}
        y1={cy}
        x2={tipX}
        y2={tipY}
        stroke={getSentimentInfo(animatedValue).color}
        strokeWidth={4}
        strokeLinecap="round"
        filter="url(#needleGlow)"
      />

      {/* Center cap */}
      <circle
        cx={cx}
        cy={cy}
        r={12}
        fill="rgba(20, 20, 30, 1)"
        stroke={getSentimentInfo(animatedValue).color}
        strokeWidth={3}
      />
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fill={getSentimentInfo(animatedValue).color}
      />
    </g>
  )
}

// Pulsing indicator dots
const PulsingIndicators = ({ cx, cy, radius, value, frame }) => {
  const startAngle = Math.PI * 0.75
  const totalAngle = Math.PI * 1.5

  return (
    <g>
      {[0, 20, 40, 60, 80, 100].map((tick, i) => {
        const angle = startAngle + (tick / 100) * totalAngle
        const x = cx + (radius + 25) * Math.cos(angle)
        const y = cy + (radius + 25) * Math.sin(angle)
        const isActive = value >= tick

        const pulse = Math.sin(frame * 0.1 + i) * 0.3 + 0.7

        return (
          <circle
            key={tick}
            cx={x}
            cy={y}
            r={isActive ? 6 * pulse : 4}
            fill={isActive ? getSentimentInfo(tick).color : 'rgba(255, 255, 255, 0.2)'}
            opacity={isActive ? pulse : 0.5}
          />
        )
      })}
    </g>
  )
}

// Main composition
export const SentimentPulse = ({
  sentimentValue = 65, // 0-100
  symbol = 'BTC',
}) => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  const cx = width / 2
  const cy = height / 2 + 20
  const radius = Math.min(width, height) * 0.35

  const sentiment = getSentimentInfo(sentimentValue)

  // Animated value display
  const displayValue = Math.round(
    spring({
      frame,
      fps: 30,
      config: { damping: 15, stiffness: 50 },
    }) * sentimentValue
  )

  // Background pulse
  const bgPulse = Math.sin(frame * 0.03) * 0.02 + 0.05

  return (
    <div
      style={{
        width,
        height,
        background: `radial-gradient(ellipse at 50% 60%, rgba(${sentiment.color === '#10b981' ? '16, 185, 129' : sentiment.color === '#ef4444' ? '239, 68, 68' : '139, 92, 246'}, ${bgPulse}) 0%, rgba(10, 10, 15, 1) 70%)`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <svg width={width} height={height}>
        <defs>
          <filter id="arcGlow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="needleGlow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Gauge arc */}
        <GaugeArc cx={cx} cy={cy} radius={radius} value={sentimentValue} frame={frame} />

        {/* Pulsing indicators */}
        <PulsingIndicators cx={cx} cy={cy} radius={radius} value={sentimentValue} frame={frame} />

        {/* Needle */}
        <Needle cx={cx} cy={cy} value={sentimentValue} frame={frame} />
      </svg>

      {/* Value display */}
      <div
        style={{
          position: 'absolute',
          left: cx - 60,
          top: cy + 40,
          width: 120,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 48,
            fontWeight: 800,
            color: sentiment.color,
            textShadow: `0 0 30px ${sentiment.color}`,
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          {displayValue}
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: sentiment.color,
            opacity: 0.8,
            marginTop: 4,
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          {sentiment.label}
        </div>
      </div>

      {/* Symbol label */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 16,
          fontWeight: 700,
          color: 'rgba(255, 255, 255, 0.7)',
          letterSpacing: '0.05em',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {symbol} Sentiment Index
      </div>
    </div>
  )
}

export default SentimentPulse
