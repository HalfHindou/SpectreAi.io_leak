import { useState, useEffect, useRef } from 'react'

/**
 * SmartMoneyFlow -- Capital flow direction indicator.
 * Large SVG arrow with label and intensity bar.
 * Simulated direction changes every 8-12s. Designed for ~200x100.
 */

const DIRECTIONS = [
  { key: 'accumulating', label: 'Accumulating', color: '#10B981', arrow: 'up' },
  { key: 'distributing', label: 'Distributing', color: '#EF4444', arrow: 'down' },
  { key: 'neutral',      label: 'Neutral',      color: '#F59E0B', arrow: 'right' },
]

function initFlow() {
  const dirIdx = Math.floor(Math.random() * DIRECTIONS.length)
  const intensity = 0.4 + Math.random() * 0.5 // 0.4-0.9
  return { dirIdx, intensity }
}

function ArrowSVG({ direction, color }) {
  if (direction === 'up') {
    return (
      <svg width={40} height={40} viewBox="0 0 40 40" style={{ display: 'block' }}>
        <polygon points="20,4 36,30 4,30" fill={color} />
      </svg>
    )
  }
  if (direction === 'down') {
    return (
      <svg width={40} height={40} viewBox="0 0 40 40" style={{ display: 'block' }}>
        <polygon points="20,36 4,10 36,10" fill={color} />
      </svg>
    )
  }
  // right (neutral)
  return (
    <svg width={40} height={40} viewBox="0 0 40 40" style={{ display: 'block' }}>
      <polygon points="36,20 10,4 10,36" fill={color} />
    </svg>
  )
}

export default function SmartMoneyFlow({ sticker, themeObj }) {
  const dataRef = useRef(initFlow())
  const [flow, setFlow] = useState(dataRef.current)

  useEffect(() => {
    function scheduleNext() {
      const delay = 8000 + Math.random() * 4000 // 8-12s
      return setTimeout(() => {
        const prev = dataRef.current
        // Maybe change direction (40% chance), always drift intensity
        let nextDir = prev.dirIdx
        if (Math.random() < 0.4) {
          nextDir = Math.floor(Math.random() * DIRECTIONS.length)
        }
        const nextIntensity = Math.max(0.4, Math.min(0.9,
          prev.intensity + (Math.random() - 0.5) * 0.15
        ))
        dataRef.current = { dirIdx: nextDir, intensity: nextIntensity }
        setFlow({ ...dataRef.current })
        timerRef.current = scheduleNext()
      }, delay)
    }
    const timerRef = { current: scheduleNext() }
    return () => clearTimeout(timerRef.current)
  }, [])

  const dir = DIRECTIONS[flow.dirIdx]
  const barWidthPct = Math.round(flow.intensity * 100)

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '8px 12px',
      boxSizing: 'border-box',
      gap: 8,
    }}>
      {/* Arrow */}
      <ArrowSVG direction={dir.arrow} color={dir.color} />

      {/* Label */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: dir.color,
        lineHeight: 1,
        textAlign: 'center',
        transition: 'color 0.5s ease',
      }}>
        Smart Money: {dir.label}
      </div>

      {/* Intensity bar */}
      <div style={{
        width: '100%',
        height: 6,
        borderRadius: 3,
        backgroundColor: themeObj.stickerText.tertiary + '1a', // ~0.1 opacity
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${barWidthPct}%`,
          height: '100%',
          borderRadius: 3,
          backgroundColor: dir.color,
          transition: 'width 0.8s ease, background-color 0.5s ease',
        }} />
      </div>
    </div>
  )
}
