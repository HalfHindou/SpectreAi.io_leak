import { memo } from 'react'

/**
 * Inline sparkline tile showing mention velocity.
 * Renders a small SVG path of mention counts over time, plus the current
 * value and delta vs the previous period.
 *
 * Props:
 *   label    string  - displayed above the value (e.g. "MENTIONS 24H")
 *   value    number  - current value
 *   delta    number  - signed percentage delta vs previous period (e.g. 340 = +340%)
 *   series   array<number>  - data points for the sparkline (oldest -> newest)
 */
function MentionVelocityTile({ label, value, delta, series }) {
  const points = Array.isArray(series) ? series.filter((n) => Number.isFinite(n)) : []
  const showSpark = points.length >= 2
  const direction = !Number.isFinite(delta) ? 'flat' : delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat'

  // Build SVG path normalized to viewBox 0..100 wide, 0..28 tall
  let path = ''
  let area = ''
  if (showSpark) {
    const min = Math.min(...points)
    const max = Math.max(...points)
    const range = max - min || 1
    const w = 100
    const h = 28
    const step = w / (points.length - 1)
    const coords = points.map((p, i) => {
      const x = i * step
      const y = h - ((p - min) / range) * h
      return [x, y]
    })
    path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c[0].toFixed(1)} ${c[1].toFixed(1)}`).join(' ')
    area = `${path} L ${w} ${h} L 0 ${h} Z`
  }

  const strokeColor = direction === 'up' ? '#34d399' : direction === 'down' ? '#f87171' : 'rgba(245,245,247,0.4)'
  const fillColor = direction === 'up' ? 'rgba(52,211,153,0.12)' : direction === 'down' ? 'rgba(248,113,113,0.10)' : 'rgba(255,255,255,0.04)'

  return (
    <div className="xfv-hero-cell xfv-hero-cell--metric">
      <div className="xfv-hero-label">{label}</div>
      <div className="xfv-hero-value">{formatValue(value)}</div>
      {Number.isFinite(delta) && (
        <div className={`xfv-hero-delta xfv-hero-delta--${direction}`}>
          {direction === 'up' ? '▲' : direction === 'down' ? '▼' : '·'} {Math.abs(delta).toFixed(0)}%
        </div>
      )}
      {showSpark ? (
        <svg className="xfv-hero-spark" viewBox="0 0 100 28" preserveAspectRatio="none">
          <path d={area} fill={fillColor} />
          <path d={path} fill="none" stroke={strokeColor} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <div className="xfv-hero-spark" />
      )}
    </div>
  )
}

function formatValue(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  const n = Number(v)
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString('en-US')
}

export default memo(MentionVelocityTile)
