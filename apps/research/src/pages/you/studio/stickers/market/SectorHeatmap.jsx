import { useState, useEffect, useRef } from 'react'

/**
 * SectorHeatmap -- Treemap-style grid of colored rectangles showing sector performance.
 * Each sector drifts +-0.5% every 4s within -10% to +10%.
 * Designed for ~320x200 sticker area.
 */

const SECTORS = [
  { id: 'defi',    label: 'DeFi',    weight: 0.25 },
  { id: 'l1s',     label: 'L1s',     weight: 0.25 },
  { id: 'ai',      label: 'AI',      weight: 0.15 },
  { id: 'meme',    label: 'Meme',    weight: 0.15 },
  { id: 'l2s',     label: 'L2s',     weight: 0.05 },
  { id: 'gaming',  label: 'Gaming',  weight: 0.05 },
  { id: 'rwa',     label: 'RWA',     weight: 0.05 },
  { id: 'privacy', label: 'Privacy', weight: 0.05 },
]

function initValues() {
  const vals = {}
  SECTORS.forEach((s) => {
    vals[s.id] = (Math.random() - 0.5) * 12 // -6 to +6 initial
  })
  return vals
}

function interpolateColor(pct) {
  // pct: -10 to +10
  const t = Math.max(-10, Math.min(10, pct))
  const norm = (t + 10) / 20 // 0 = full bear, 1 = full bull

  if (norm < 0.45) {
    // Red zone
    const r = 239
    const g = Math.round(68 * (norm / 0.45))
    const b = Math.round(68 * (norm / 0.45))
    return `rgb(${r},${g},${b})`
  }
  if (norm > 0.55) {
    // Green zone
    const strength = (norm - 0.55) / 0.45
    const r = Math.round(16 + (16 - 16) * strength)
    const g = Math.round(140 + (185 - 140) * strength)
    const b = Math.round(100 + (129 - 100) * strength)
    return `rgb(${r},${g},${b})`
  }
  // Neutral gray
  return 'rgb(100,100,100)'
}

export default function SectorHeatmap({ sticker, themeObj }) {
  const valuesRef = useRef(initValues())
  const [values, setValues] = useState({ ...valuesRef.current })

  useEffect(() => {
    const interval = setInterval(() => {
      SECTORS.forEach((s) => {
        const drift = (Math.random() - 0.5) * 1.0 // +-0.5%
        valuesRef.current[s.id] = Math.max(-10, Math.min(10, valuesRef.current[s.id] + drift))
      })
      setValues({ ...valuesRef.current })
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 2,
        padding: 2,
        boxSizing: 'border-box',
      }}
    >
      {SECTORS.map((sector) => {
        const pct = values[sector.id] || 0
        const bgColor = interpolateColor(pct)
        // Weight determines flex-basis. Container is ~316px wide (320 - 4px padding).
        // Two cells on the same row share the row width minus the gap.
        const basisPct = sector.weight * 100

        return (
          <div
            key={sector.id}
            style={{
              flexBasis: `calc(${basisPct}% - 2px)`,
              flexGrow: 1,
              minHeight: 40,
              backgroundColor: bgColor,
              borderRadius: 4,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              padding: '4px 2px',
              boxSizing: 'border-box',
              transition: 'background-color 0.8s ease',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                fontWeight: 700,
                color: '#ffffff',
                lineHeight: 1,
                textAlign: 'center',
              }}
            >
              {sector.label}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                fontWeight: 700,
                color: '#ffffff',
                lineHeight: 1,
                opacity: 0.85,
              }}
            >
              {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
            </span>
          </div>
        )
      })}
    </div>
  )
}
