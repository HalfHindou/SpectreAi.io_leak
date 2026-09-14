/**
 * MicroBars — n-bar histogram via inline SVG <rect>s.
 *
 * Used by the 24h Volume Vitals tile (24 bars, color per close-vs-open)
 * and by the per-row momentum 3-bar gauge in Living Market List rows.
 */
import React, { useMemo } from 'react'
import './MicroBars.css'

function MicroBars({
  data,                  // [{ value, color?, live? }]
  width = 96,
  height = 32,
  gap = 1.5,
  className = '',
}) {
  const max = useMemo(() => {
    if (!data || data.length === 0) return 1
    let m = 0
    for (const d of data) if ((d.value || 0) > m) m = d.value || 0
    return m || 1
  }, [data])

  if (!data || data.length === 0) {
    return (
      <svg
        className={['mbars', className].filter(Boolean).join(' ')}
        width={width}
        height={height}
        aria-hidden="true"
      />
    )
  }

  const n = data.length
  const barW = (width - gap * (n - 1)) / n

  return (
    <svg
      className={['mbars', className].filter(Boolean).join(' ')}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {data.map((d, i) => {
        const v = Math.max(0, d.value || 0)
        const h = (v / max) * height
        const x = i * (barW + gap)
        const y = height - h
        return (
          <rect
            key={i}
            x={x.toFixed(2)}
            y={y.toFixed(2)}
            width={Math.max(0.5, barW).toFixed(2)}
            height={Math.max(0.5, h).toFixed(2)}
            rx={0.75}
            fill={d.color || 'var(--text-3)'}
            className={d.live ? 'mbars-bar mbars-bar--live' : 'mbars-bar'}
            style={d.live ? { filter: 'drop-shadow(0 0 4px var(--accent-glow))' } : undefined}
          />
        )
      })}
    </svg>
  )
}

export default React.memo(MicroBars)
