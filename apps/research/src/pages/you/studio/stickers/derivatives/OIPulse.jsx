import { useState, useEffect, useRef } from 'react'

/**
 * OIPulse -- Open Interest value with sonar pulse animation on value changes.
 * Simulated value drifts between 38-48 billion every 4s.
 * Designed for ~200x80 sticker area.
 */

export default function OIPulse({ sticker, themeObj }) {
  const valueRef = useRef(38 + Math.random() * 10) // 38-48
  const [value, setValue] = useState(valueRef.current)
  const [prevValue, setPrevValue] = useState(valueRef.current)
  const [pulseKey, setPulseKey] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      const drift = (Math.random() - 0.5) * 0.6 // +-0.3
      const oldVal = valueRef.current
      valueRef.current = Math.max(38, Math.min(48, valueRef.current + drift))
      setPrevValue(oldVal)
      setValue(valueRef.current)
      setPulseKey((k) => k + 1)
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  const change = ((value - prevValue) / prevValue) * 100
  const isUp = change >= 0
  const changeColor = isUp ? '#10B981' : '#EF4444'

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '6px 10px',
        boxSizing: 'border-box',
        gap: 3,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Inline keyframes for pulse ring */}
      <style>{`
        @keyframes oi-pulse-ring-${sticker.id} {
          0% { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(1.5); opacity: 0; }
        }
      `}</style>

      {/* Label */}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: themeObj.stickerText.tertiary,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          lineHeight: 1,
        }}
      >
        Open Interest
      </span>

      {/* Value with pulse ring */}
      <div style={{ position: 'relative', display: 'inline-flex', alignSelf: 'flex-start' }}>
        {/* Pulse ring */}
        <div
          key={pulseKey}
          style={{
            position: 'absolute',
            inset: -6,
            border: `2px solid ${themeObj.accentColor}`,
            borderRadius: 8,
            pointerEvents: 'none',
            animation: `oi-pulse-ring-${sticker.id} 1s ease-out forwards`,
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 26,
            fontWeight: 700,
            color: themeObj.stickerText.primary,
            lineHeight: 1,
            position: 'relative',
          }}
        >
          ${value.toFixed(1)}B
        </span>
      </div>

      {/* Change */}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: changeColor,
          lineHeight: 1,
        }}
      >
        {isUp ? '+' : ''}{change.toFixed(1)}%
      </span>
    </div>
  )
}
