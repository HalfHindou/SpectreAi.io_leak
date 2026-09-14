import { useState, useEffect, useRef } from 'react'

/**
 * CorrelationBreakdown -- BTC correlation to traditional assets.
 * 3 horizontal bars: SPX, GOLD, DXY. Positive = blue, negative = red.
 * Designed for ~240x120 sticker area.
 */

const ASSETS = [
  { key: 'SPX',  label: 'SPX',  base: 0.72 },
  { key: 'GOLD', label: 'GOLD', base: 0.34 },
  { key: 'DXY',  label: 'DXY',  base: -0.58 },
]

function initCorrelations() {
  const out = {}
  ASSETS.forEach(a => {
    out[a.key] = Math.max(-1, Math.min(1, a.base + (Math.random() - 0.5) * 0.1))
  })
  return out
}

export default function CorrelationBreakdown({ sticker, themeObj }) {
  const dataRef = useRef(initCorrelations())
  const [values, setValues] = useState(dataRef.current)

  useEffect(() => {
    const interval = setInterval(() => {
      const next = {}
      ASSETS.forEach(a => {
        const drift = (Math.random() - 0.5) * 0.06
        next[a.key] = Math.max(-1, Math.min(1, dataRef.current[a.key] + drift))
      })
      dataRef.current = next
      setValues({ ...next })
    }, 6000)
    return () => clearInterval(interval)
  }, [])

  const BAR_MAX = 110 // max bar width in px

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      padding: '8px 12px',
      boxSizing: 'border-box',
      gap: 10,
    }}>
      {/* Title */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        color: themeObj.stickerText.tertiary,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        lineHeight: 1,
      }}>
        BTC Correlation
      </div>

      {/* Rows */}
      {ASSETS.map(asset => {
        const val = values[asset.key]
        const isPositive = val >= 0
        const barColor = isPositive ? '#627EEA' : '#EF4444'
        const barWidth = Math.abs(val) * BAR_MAX

        return (
          <div key={asset.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Label */}
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: themeObj.stickerText.secondary,
              width: 40,
              flexShrink: 0,
              lineHeight: 1,
            }}>
              {asset.label}
            </span>

            {/* Value */}
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              fontWeight: 700,
              color: themeObj.stickerText.primary,
              width: 42,
              flexShrink: 0,
              textAlign: 'right',
              lineHeight: 1,
            }}>
              {val >= 0 ? '+' : ''}{val.toFixed(2)}
            </span>

            {/* Bar container with center line */}
            <div style={{
              flex: 1,
              height: 10,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
            }}>
              {/* Center line */}
              <div style={{
                position: 'absolute',
                left: '50%',
                top: 0,
                bottom: 0,
                width: 1,
                backgroundColor: themeObj.stickerText.tertiary,
                opacity: 0.15,
              }} />

              {/* Bar */}
              <div style={{
                position: 'absolute',
                height: 8,
                borderRadius: 4,
                backgroundColor: barColor,
                transition: 'width 0.8s ease, left 0.8s ease, right 0.8s ease',
                ...(isPositive
                  ? { left: '50%', width: barWidth }
                  : { right: '50%', width: barWidth, left: `calc(50% - ${barWidth}px)` }
                ),
              }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
