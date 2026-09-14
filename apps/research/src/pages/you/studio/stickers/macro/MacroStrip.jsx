import { useState, useEffect, useRef } from 'react'

/**
 * MacroStrip -- Horizontal row of 4 macro indicators (DXY, US10Y, SPX, GOLD)
 * with sparklines. Stretches to sticker width. Designed for ~600x70.
 */

const INDICATORS = [
  { key: 'DXY',   label: 'DXY',   base: 104.8, min: 104, max: 106, decimals: 1, prefix: '',  suffix: '', changeMode: 'pct' },
  { key: 'US10Y', label: 'US10Y', base: 4.32,   min: 4.2, max: 4.5, decimals: 2, prefix: '',  suffix: '%', changeMode: 'abs' },
  { key: 'SPX',   label: 'SPX',   base: 5842,   min: 5700, max: 5900, decimals: 0, prefix: '',  suffix: '', changeMode: 'pct' },
  { key: 'GOLD',  label: 'GOLD',  base: 2680,   min: 2600, max: 2750, decimals: 0, prefix: '$', suffix: '', changeMode: 'pct' },
]

function initData() {
  const data = {}
  INDICATORS.forEach(ind => {
    const value = ind.base + (Math.random() - 0.5) * (ind.max - ind.min) * 0.4
    const hist = []
    let p = value * (1 + (Math.random() - 0.5) * 0.01)
    for (let i = 0; i < 10; i++) {
      p += (Math.random() - 0.5) * (ind.max - ind.min) * 0.02
      p = Math.max(ind.min, Math.min(ind.max, p))
      hist.push(p)
    }
    const change = ind.changeMode === 'pct'
      ? ((value - hist[0]) / hist[0]) * 100
      : value - hist[0]
    data[ind.key] = { value, change, history: hist }
  })
  return data
}

export default function MacroStrip({ sticker, themeObj }) {
  const dataRef = useRef(initData())
  const [data, setData] = useState(dataRef.current)

  useEffect(() => {
    const interval = setInterval(() => {
      const next = { ...dataRef.current }
      INDICATORS.forEach(ind => {
        const prev = next[ind.key]
        const drift = (Math.random() - 0.5) * (ind.max - ind.min) * 0.008
        const newVal = Math.max(ind.min, Math.min(ind.max, prev.value + drift))
        const newHist = [...prev.history.slice(1), newVal]
        const newChange = ind.changeMode === 'pct'
          ? ((newVal - newHist[0]) / newHist[0]) * 100
          : newVal - newHist[0]
        next[ind.key] = { value: newVal, change: newChange, history: newHist }
      })
      dataRef.current = next
      setData({ ...next })
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '8px 12px',
      boxSizing: 'border-box',
    }}>
      {INDICATORS.map(ind => {
        const d = data[ind.key]
        if (!d) return null
        const isUp = d.change >= 0
        const changeColor = isUp ? '#10B981' : '#EF4444'
        const changeStr = ind.changeMode === 'pct'
          ? `${isUp ? '+' : ''}${d.change.toFixed(2)}%`
          : `${isUp ? '+' : ''}${d.change.toFixed(2)}`
        const valueStr = `${ind.prefix}${d.value.toLocaleString('en-US', {
          minimumFractionDigits: ind.decimals,
          maximumFractionDigits: ind.decimals,
        })}${ind.suffix}`

        // Sparkline from history
        const hist = d.history
        const minH = Math.min(...hist)
        const maxH = Math.max(...hist)
        const rangeH = maxH - minH || 1
        const sparkPoints = hist
          .map((v, i) => {
            const x = (i / (hist.length - 1)) * 40
            const y = 14 - ((v - minH) / rangeH) * 12
            return `${x},${y}`
          })
          .join(' ')

        return (
          <div key={ind.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: themeObj.stickerText.tertiary,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              lineHeight: 1,
            }}>
              {ind.label}
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 16,
                fontWeight: 700,
                color: themeObj.stickerText.primary,
                lineHeight: 1,
                whiteSpace: 'nowrap',
              }}>
                {valueStr}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: changeColor,
                lineHeight: 1,
                whiteSpace: 'nowrap',
              }}>
                {changeStr}
              </span>

              <svg width={40} height={14} viewBox="0 0 40 14" style={{ display: 'block', flexShrink: 0 }}>
                <polyline
                  points={sparkPoints}
                  fill="none"
                  stroke={themeObj.accentColor}
                  strokeOpacity={0.4}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        )
      })}
    </div>
  )
}
