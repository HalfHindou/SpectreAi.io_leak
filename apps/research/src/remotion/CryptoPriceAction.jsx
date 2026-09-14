/**
 * CryptoPriceAction - Remotion Composition
 * Animated candlestick/line chart for crypto tokens (5-10 sec loop)
 *
 * Features:
 * - Animated price line drawing
 * - Glowing trail effect
 * - Brand color theming
 * - Particle burst on price peaks
 */
import React, { useMemo } from 'react'
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing
} from 'remotion'

// Generate realistic price data with volatility
const generatePriceData = (symbol, points = 60) => {
  const basePrice = {
    'BTC': 97500,
    'ETH': 3400,
    'SOL': 195,
    'BNB': 680,
    'XRP': 2.45,
    'ADA': 0.95,
    'DOGE': 0.32,
  }[symbol] || 100

  const volatility = 0.02 // 2% volatility
  const data = []
  let price = basePrice

  for (let i = 0; i < points; i++) {
    const change = (Math.random() - 0.48) * volatility * basePrice
    price = Math.max(price + change, basePrice * 0.9)
    price = Math.min(price, basePrice * 1.1)
    data.push(price)
  }

  return data
}

// Particle component for price peak bursts
const Particle = ({ x, y, delay, color, frame }) => {
  const progress = interpolate(
    frame - delay,
    [0, 30],
    [0, 1],
    { extrapolateRight: 'clamp' }
  )

  if (frame < delay) return null

  const angle = Math.random() * Math.PI * 2
  const distance = progress * 40
  const opacity = 1 - progress

  return (
    <div
      style={{
        position: 'absolute',
        left: x + Math.cos(angle) * distance,
        top: y + Math.sin(angle) * distance,
        width: 4,
        height: 4,
        borderRadius: '50%',
        background: color,
        opacity,
        boxShadow: `0 0 10px ${color}`,
      }}
    />
  )
}

// Main price line component
const PriceLine = ({ data, width, height, frame, fps, color, colorRGB }) => {
  const padding = 20
  const chartWidth = width - padding * 2
  const chartHeight = height - padding * 2

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  // Calculate points
  const points = useMemo(() => {
    return data.map((price, i) => ({
      x: padding + (i / (data.length - 1)) * chartWidth,
      y: padding + chartHeight - ((price - min) / range) * chartHeight,
      price,
    }))
  }, [data, chartWidth, chartHeight, min, range])

  // Animate line drawing
  const drawProgress = interpolate(
    frame,
    [0, fps * 2],
    [0, 1],
    { extrapolateRight: 'clamp' }
  )

  const visiblePoints = Math.floor(drawProgress * points.length)
  const visibleData = points.slice(0, visiblePoints + 1)

  // Create path
  const pathD = visibleData.length > 1
    ? `M ${visibleData.map(p => `${p.x},${p.y}`).join(' L ')}`
    : ''

  // Gradient fill path
  const fillD = visibleData.length > 1
    ? `${pathD} L ${visibleData[visibleData.length - 1].x},${height - padding} L ${padding},${height - padding} Z`
    : ''

  // Find local peaks for particles
  const peaks = useMemo(() => {
    return points.filter((p, i) => {
      if (i === 0 || i === points.length - 1) return false
      return p.price > points[i - 1].price && p.price > points[i + 1].price
    }).slice(0, 5)
  }, [points])

  // Glow pulse
  const glowIntensity = interpolate(
    Math.sin(frame * 0.1),
    [-1, 1],
    [0.5, 1]
  )

  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
      <defs>
        {/* Line gradient */}
        <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="50%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="0.8" />
        </linearGradient>

        {/* Fill gradient */}
        <linearGradient id="fillGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>

        {/* Glow filter */}
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={4 * glowIntensity} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Fill area */}
      {fillD && (
        <path
          d={fillD}
          fill="url(#fillGradient)"
          opacity={0.6}
        />
      )}

      {/* Main line with glow */}
      {pathD && (
        <>
          {/* Glow layer */}
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={6}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.3 * glowIntensity}
            filter="url(#glow)"
          />

          {/* Main line */}
          <path
            d={pathD}
            fill="none"
            stroke="url(#lineGradient)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}

      {/* Current price dot */}
      {visibleData.length > 0 && (
        <g>
          <circle
            cx={visibleData[visibleData.length - 1].x}
            cy={visibleData[visibleData.length - 1].y}
            r={8}
            fill={color}
            opacity={0.3}
          >
            <animate
              attributeName="r"
              values="8;14;8"
              dur="1s"
              repeatCount="indefinite"
            />
          </circle>
          <circle
            cx={visibleData[visibleData.length - 1].x}
            cy={visibleData[visibleData.length - 1].y}
            r={5}
            fill={color}
            filter="url(#glow)"
          />
        </g>
      )}
    </svg>
  )
}

// Grid background
const GridBackground = ({ width, height, color }) => {
  const gridSize = 40
  const lines = []

  // Vertical lines
  for (let x = gridSize; x < width; x += gridSize) {
    lines.push(
      <line key={`v${x}`} x1={x} y1={0} x2={x} y2={height} stroke={color} strokeOpacity={0.1} />
    )
  }

  // Horizontal lines
  for (let y = gridSize; y < height; y += gridSize) {
    lines.push(
      <line key={`h${y}`} x1={0} y1={y} x2={width} y2={y} stroke={color} strokeOpacity={0.1} />
    )
  }

  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
      {lines}
    </svg>
  )
}

// Main composition
export const CryptoPriceAction = ({
  symbol = 'BTC',
  brandColor = '#F7931A',
  brandColorRGB = '247, 147, 26',
}) => {
  const frame = useCurrentFrame()
  const { fps, width, height, durationInFrames } = useVideoConfig()

  // Generate price data once
  const priceData = useMemo(() => generatePriceData(symbol), [symbol])

  // Background pulse
  const bgPulse = interpolate(
    Math.sin(frame * 0.05),
    [-1, 1],
    [0.03, 0.08]
  )

  return (
    <div
      style={{
        width,
        height,
        background: `radial-gradient(ellipse at 50% 50%, rgba(${brandColorRGB}, ${bgPulse}) 0%, rgba(10, 10, 15, 0.98) 70%)`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Grid */}
      <GridBackground width={width} height={height} color={brandColor} />

      {/* Price line */}
      <PriceLine
        data={priceData}
        width={width}
        height={height}
        frame={frame}
        fps={fps}
        color={brandColor}
        colorRGB={brandColorRGB}
      />

      {/* Symbol label */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          fontSize: 24,
          fontWeight: 800,
          color: brandColor,
          textShadow: `0 0 20px rgba(${brandColorRGB}, 0.5)`,
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {symbol}
      </div>

      {/* Live indicator */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          fontWeight: 600,
          color: 'rgba(255, 255, 255, 0.7)',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#10b981',
            boxShadow: '0 0 10px #10b981',
            animation: 'pulse 1s infinite',
          }}
        />
        LIVE
      </div>
    </div>
  )
}

export default CryptoPriceAction
