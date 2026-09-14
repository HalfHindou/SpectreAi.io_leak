/**
 * MarketOverview - Remotion Composition
 * Hero section background showing market heatmap animation
 *
 * Features:
 * - Animated crypto heatmap grid
 * - Flowing energy lines between tokens
 * - Pulsing market sentiment visualization
 * - Particle field background
 */
import React, { useMemo } from 'react'
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing
} from 'remotion'

// Token data for heatmap
const TOKENS = [
  { symbol: 'BTC', change: 2.5, color: '#F7931A' },
  { symbol: 'ETH', change: 3.2, color: '#627EEA' },
  { symbol: 'SOL', change: -1.8, color: '#00FFA3' },
  { symbol: 'BNB', change: 1.1, color: '#F0B90B' },
  { symbol: 'XRP', change: 5.4, color: '#00AAE4' },
  { symbol: 'ADA', change: -0.5, color: '#0033AD' },
  { symbol: 'DOGE', change: 8.2, color: '#C2A633' },
  { symbol: 'AVAX', change: -2.1, color: '#E84142' },
  { symbol: 'DOT', change: 1.7, color: '#E6007A' },
  { symbol: 'MATIC', change: 4.3, color: '#8247E5' },
  { symbol: 'LINK', change: 2.8, color: '#2A5ADA' },
  { symbol: 'UNI', change: -3.2, color: '#FF007A' },
]

// Particle field
const ParticleField = ({ width, height, frame, count = 50 }) => {
  const particles = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      x: Math.random() * width,
      y: Math.random() * height,
      size: 1 + Math.random() * 3,
      speed: 0.2 + Math.random() * 0.5,
      opacity: 0.1 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
    }))
  }, [width, height, count])

  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
      {particles.map(p => {
        const y = (p.y + frame * p.speed) % height
        const pulse = Math.sin(frame * 0.05 + p.phase) * 0.5 + 0.5

        return (
          <circle
            key={p.id}
            cx={p.x}
            cy={y}
            r={p.size * (0.5 + pulse * 0.5)}
            fill="#8b5cf6"
            opacity={p.opacity * pulse}
          />
        )
      })}
    </svg>
  )
}

// Heatmap cell
const HeatmapCell = ({ token, x, y, size, frame, index }) => {
  const { symbol, change, color } = token

  // Staggered animation
  const delay = index * 3
  const entryProgress = spring({
    frame: frame - delay,
    fps: 30,
    config: { damping: 12, stiffness: 100 },
  })

  // Pulse animation
  const pulse = Math.sin(frame * 0.08 + index) * 0.1 + 1

  // Color based on change
  const bgColor = change >= 0
    ? `rgba(16, 185, 129, ${0.2 + Math.abs(change) * 0.05})`
    : `rgba(239, 68, 68, ${0.2 + Math.abs(change) * 0.05})`

  const borderColor = change >= 0
    ? `rgba(16, 185, 129, ${0.4 + Math.abs(change) * 0.1})`
    : `rgba(239, 68, 68, ${0.4 + Math.abs(change) * 0.1})`

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: size,
        height: size,
        transform: `scale(${entryProgress * pulse})`,
        opacity: entryProgress,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 12,
          background: bgColor,
          border: `1px solid ${borderColor}`,
          backdropFilter: 'blur(10px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${color}, ${color}88)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 800,
            color: '#fff',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          {symbol.slice(0, 2)}
        </div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: change >= 0 ? '#10b981' : '#ef4444',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          {change >= 0 ? '+' : ''}{change.toFixed(1)}%
        </div>
      </div>
    </div>
  )
}

// Energy flow lines between tokens
const EnergyFlows = ({ width, height, frame }) => {
  const flows = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => ({
      id: i,
      startX: Math.random() * width * 0.3,
      startY: Math.random() * height,
      endX: width * 0.7 + Math.random() * width * 0.3,
      endY: Math.random() * height,
      phase: i * 0.5,
      speed: 0.02 + Math.random() * 0.02,
    }))
  }, [width, height])

  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0" />
          <stop offset="50%" stopColor="#8b5cf6" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
        <filter id="flowGlow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {flows.map(flow => {
        const progress = ((frame * flow.speed + flow.phase) % 1)
        const dashOffset = interpolate(progress, [0, 1], [1000, 0])

        // Control points for curve
        const cpX = (flow.startX + flow.endX) / 2
        const cpY = flow.startY + Math.sin(frame * 0.03 + flow.phase) * 100

        const pathD = `M ${flow.startX} ${flow.startY} Q ${cpX} ${cpY} ${flow.endX} ${flow.endY}`

        return (
          <path
            key={flow.id}
            d={pathD}
            fill="none"
            stroke="url(#flowGradient)"
            strokeWidth={2}
            strokeDasharray="20 30"
            strokeDashoffset={dashOffset}
            filter="url(#flowGlow)"
            opacity={0.5}
          />
        )
      })}
    </svg>
  )
}

// Central sentiment orb
const SentimentOrb = ({ width, height, frame }) => {
  const centerX = width / 2
  const centerY = height / 2

  const pulse = Math.sin(frame * 0.05) * 0.15 + 1
  const rotation = frame * 0.5

  return (
    <div
      style={{
        position: 'absolute',
        left: centerX - 80,
        top: centerY - 80,
        width: 160,
        height: 160,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(139, 92, 246, 0.3) 0%, transparent 70%)',
        transform: `scale(${pulse})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Orbital rings */}
      {[0, 1, 2].map(i => (
        <div
          key={i}
          style={{
            position: 'absolute',
            inset: 20 + i * 15,
            borderRadius: '50%',
            border: '1px solid rgba(139, 92, 246, 0.3)',
            transform: `rotate(${rotation + i * 30}deg)`,
          }}
        />
      ))}

      {/* Core */}
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.8) 0%, rgba(139, 92, 246, 0.4) 100%)',
          boxShadow: '0 0 40px rgba(139, 92, 246, 0.6)',
        }}
      />
    </div>
  )
}

// Main composition
export const MarketOverview = () => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  // Calculate heatmap grid
  const cellSize = 80
  const gridCols = 4
  const gridRows = 3
  const gridWidth = gridCols * cellSize
  const gridHeight = gridRows * cellSize
  const startX = (width - gridWidth) / 2
  const startY = (height - gridHeight) / 2

  return (
    <div
      style={{
        width,
        height,
        background: 'radial-gradient(ellipse at 50% 50%, rgba(20, 15, 35, 1) 0%, rgba(5, 5, 8, 1) 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Particle field */}
      <ParticleField width={width} height={height} frame={frame} />

      {/* Energy flows */}
      <EnergyFlows width={width} height={height} frame={frame} />

      {/* Heatmap grid */}
      {TOKENS.map((token, i) => {
        const row = Math.floor(i / gridCols)
        const col = i % gridCols
        const x = startX + col * cellSize + (cellSize - 70) / 2
        const y = startY + row * cellSize + (cellSize - 70) / 2

        return (
          <HeatmapCell
            key={token.symbol}
            token={token}
            x={x}
            y={y}
            size={70}
            frame={frame}
            index={i}
          />
        )
      })}

      {/* Title */}
      <div
        style={{
          position: 'absolute',
          bottom: 30,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 14,
          fontWeight: 600,
          color: 'rgba(255, 255, 255, 0.5)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        Market Overview
      </div>
    </div>
  )
}

export default MarketOverview
