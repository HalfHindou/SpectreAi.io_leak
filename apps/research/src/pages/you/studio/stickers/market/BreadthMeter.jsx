import { useState, useEffect, useRef } from 'react'

/**
 * BreadthMeter -- Simple market health gauge showing percentage of green vs red coins.
 * Simulated value drifts between 55-80 every 4s.
 * Designed for ~260x60 sticker area.
 */

const TOTAL_COINS = 200

export default function BreadthMeter({ sticker, themeObj }) {
  const pctRef = useRef(55 + Math.random() * 25) // 55-80
  const [greenPct, setGreenPct] = useState(Math.round(pctRef.current))

  useEffect(() => {
    const interval = setInterval(() => {
      const drift = (Math.random() - 0.5) * 2.0 // +-1%
      pctRef.current = Math.max(55, Math.min(80, pctRef.current + drift))
      setGreenPct(Math.round(pctRef.current))
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  const greenCount = Math.round((greenPct / 100) * TOTAL_COINS)
  const isHealthy = greenPct >= 60

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '6px 8px',
        boxSizing: 'border-box',
        gap: 4,
      }}
    >
      {/* Top row: title + value */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
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
          Market Breadth
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 14,
            fontWeight: 700,
            color: isHealthy ? '#10B981' : '#EF4444',
            lineHeight: 1,
          }}
        >
          {greenPct}% Green
        </span>
      </div>

      {/* Horizontal bar */}
      <div
        style={{
          width: '100%',
          height: 8,
          borderRadius: 3,
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${greenPct}%`,
            height: '100%',
            backgroundColor: '#10B981',
            transition: 'width 0.8s ease',
          }}
        />
        <div
          style={{
            width: `${100 - greenPct}%`,
            height: '100%',
            backgroundColor: '#EF4444',
            transition: 'width 0.8s ease',
          }}
        />
      </div>

      {/* Bottom label */}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: themeObj.stickerText.tertiary,
          lineHeight: 1,
        }}
      >
        {greenCount} / {TOTAL_COINS} coins
      </span>
    </div>
  )
}
