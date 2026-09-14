import { useState, useEffect, useRef } from 'react'

/**
 * FundingStrip -- Horizontal bar showing the current 8-hour funding rate.
 * Positive = green extending right, negative = red extending left from center.
 * Simulated value drifts between -0.05% and +0.06% every 5s.
 * Designed for ~260x50 sticker area.
 */

export default function FundingStrip({ sticker, themeObj }) {
  const rateRef = useRef((Math.random() - 0.45) * 0.08) // start around -0.04 to +0.04
  const [rate, setRate] = useState(rateRef.current)

  useEffect(() => {
    const interval = setInterval(() => {
      const drift = (Math.random() - 0.5) * 0.01 // +-0.005
      rateRef.current = Math.max(-0.05, Math.min(0.06, rateRef.current + drift))
      setRate(rateRef.current)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  const isPositive = rate >= 0
  const barColor = isPositive ? '#10B981' : '#EF4444'
  const maxRate = 0.06
  const barWidthPct = (Math.abs(rate) / maxRate) * 50 // max 50% of total width

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '4px 8px',
        boxSizing: 'border-box',
        gap: 5,
      }}
    >
      {/* Top row: label + value */}
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
          Funding Rate &middot; 8H
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 16,
            fontWeight: 700,
            color: barColor,
            lineHeight: 1,
          }}
        >
          {isPositive ? '+' : ''}{(rate * 100).toFixed(3)}%
        </span>
      </div>

      {/* Bar with center line */}
      <div
        style={{
          width: '100%',
          height: 6,
          position: 'relative',
          backgroundColor: `${themeObj.stickerText.tertiary}0d`,
          borderRadius: 3,
        }}
      >
        {/* Center tick */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: -1,
            width: 1,
            height: 8,
            backgroundColor: themeObj.stickerText.tertiary,
            opacity: 0.25,
            transform: 'translateX(-0.5px)',
          }}
        />

        {/* Rate bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            height: '100%',
            backgroundColor: barColor,
            borderRadius: 3,
            transition: 'width 0.8s ease, left 0.8s ease',
            ...(isPositive
              ? { left: '50%', width: `${barWidthPct}%` }
              : { left: `${50 - barWidthPct}%`, width: `${barWidthPct}%` }),
          }}
        />
      </div>
    </div>
  )
}
