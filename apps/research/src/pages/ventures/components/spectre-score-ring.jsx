/**
 * SpectreScoreRing - SVG arc visualization for Spectre Score (0-100)
 * Reusable component with mini and large variants.
 * Arc math adapted from SentimentPulse.jsx describeArc pattern.
 */
import React, { useEffect, useRef, useState } from 'react'

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

function getScoreColor(score) {
  if (score >= 75) return '#10B981'
  if (score >= 60) return '#06B6D4'
  if (score >= 40) return '#F59E0B'
  return '#EF4444'
}

const SpectreScoreRing = ({
  score = 0,
  size = 120,
  strokeWidth,
  showLabel = true,
  showValue = true,
  label,
  animate = true,
  dayMode = false,
}) => {
  const [animatedScore, setAnimatedScore] = useState(animate ? 0 : score)
  const rafRef = useRef(null)
  const startTimeRef = useRef(null)

  useEffect(() => {
    if (!animate) {
      setAnimatedScore(score)
      return
    }
    startTimeRef.current = performance.now()
    const duration = 600
    const tick = (now) => {
      const elapsed = now - startTimeRef.current
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setAnimatedScore(score * eased)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [score, animate])

  const sw = strokeWidth || (size <= 48 ? 4 : size <= 80 ? 6 : 8)
  const cx = size / 2
  const cy = size / 2
  const radius = (size - sw * 2) / 2

  // 270-degree arc (3/4 circle), starting from bottom-left
  const startAngle = Math.PI * 0.75
  const totalAngle = Math.PI * 1.5
  const endAngle = startAngle + totalAngle
  const fillAngle = startAngle + (animatedScore / 100) * totalAngle

  const trackPath = describeArc(cx, cy, radius, startAngle, endAngle)
  const fillPath = animatedScore > 0 ? describeArc(cx, cy, radius, startAngle, fillAngle) : ''
  const color = getScoreColor(score)

  const trackColor = dayMode ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const textColor = dayMode ? '#1e293b' : '#ffffff'
  const labelColor = dayMode ? '#64748b' : 'rgba(255,255,255,0.5)'

  const fontSize = size <= 48 ? 14 : size <= 80 ? 20 : 28
  const labelFontSize = size <= 48 ? 8 : size <= 80 ? 10 : 11

  const glowId = `score-glow-${size}-${score}`

  return (
    <div className="spectre-score-ring" style={{ width: size, height: size, position: 'relative' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
        <defs>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation={sw * 1.2} result="blur" />
            <feComposite in="blur" in2="SourceGraphic" operator="over" />
          </filter>
        </defs>
        <path
          d={trackPath}
          fill="none"
          stroke={trackColor}
          strokeWidth={sw}
          strokeLinecap="round"
        />
        {fillPath && (
          <>
            <path
              d={fillPath}
              fill="none"
              stroke={color}
              strokeWidth={sw * 2.5}
              strokeLinecap="round"
              opacity="0.15"
              filter={`url(#${glowId})`}
            />
            <path
              d={fillPath}
              fill="none"
              stroke={color}
              strokeWidth={sw}
              strokeLinecap="round"
            />
          </>
        )}
        {showValue && (
          <text
            x={cx}
            y={showLabel && label ? cy - 2 : cy + 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill={textColor}
            fontSize={fontSize}
            fontFamily="var(--font-mono)"
            fontWeight="700"
          >
            {Math.round(animatedScore)}
          </text>
        )}
        {showLabel && label && (
          <text
            x={cx}
            y={cy + fontSize * 0.6 + 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill={labelColor}
            fontSize={labelFontSize}
            fontFamily="'Inter', sans-serif"
            fontWeight="500"
            textTransform="uppercase"
            letterSpacing="0.5"
          >
            {label}
          </text>
        )}
      </svg>
    </div>
  )
}

export default SpectreScoreRing
