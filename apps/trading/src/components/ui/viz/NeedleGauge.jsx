/**
 * NeedleGauge — semicircular sentiment gauge.
 *
 * 180° arc with three zones (Bearish coral / Neutral grey / Bullish
 * lime). Needle is a vertical line rotated by score-mapped angle, so
 * the rotation animates smoothly via CSS transform transition.
 *
 * Score 0 → needle hard left. Score 50 → straight up. Score 100 →
 * hard right.
 */
import React, { useMemo } from 'react'
import './NeedleGauge.css'

const DEFAULT_ZONES = [
  { from: 0,  to: 35,  color: 'var(--down)' },
  { from: 35, to: 65,  color: 'var(--neutral)' },
  { from: 65, to: 100, color: 'var(--accent)' },
]

function NeedleGauge({
  score = 50,           // 0..100
  size = 200,
  zones = DEFAULT_ZONES,
  verdict,              // optional override; else derived from zone
  className = '',
}) {
  const v = Math.max(0, Math.min(100, Number(score) || 0))
  const w = size
  const h = size / 2 + 16
  const cx = w / 2
  const cy = size / 2
  const r = size / 2 - 16
  const needleRotation = (v / 100) * 180 - 90 // -90 .. +90

  const zoneArcs = useMemo(
    () => zones.map((z, i) => {
      const startDeg = 180 - (z.from / 100) * 180
      const endDeg   = 180 - (z.to   / 100) * 180
      const sx = cx + Math.cos((startDeg * Math.PI) / 180) * r
      const sy = cy - Math.sin((startDeg * Math.PI) / 180) * r
      const ex = cx + Math.cos((endDeg * Math.PI) / 180) * r
      const ey = cy - Math.sin((endDeg * Math.PI) / 180) * r
      return (
        <path
          key={i}
          d={`M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`}
          fill="none"
          stroke={z.color}
          strokeWidth="10"
          strokeLinecap="butt"
          opacity="0.55"
        />
      )
    }),
    [zones, cx, cy, r]
  )

  const autoVerdict = useMemo(() => {
    if (verdict) return verdict
    if (v < 35) return 'Bearish'
    if (v <= 65) return 'Neutral'
    return 'Bullish'
  }, [v, verdict])

  return (
    <div className={['needle', className].filter(Boolean).join(' ')}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        {zoneArcs}
        <line
          x1={cx}
          y1={cy}
          x2={cx}
          y2={cy - (r - 8)}
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="needle-pointer"
          style={{
            transform: `rotate(${needleRotation}deg)`,
            transformOrigin: `${cx}px ${cy}px`,
            filter: 'drop-shadow(0 0 6px var(--accent-glow))',
          }}
        />
        <circle cx={cx} cy={cy} r="4" fill="var(--accent)" />
      </svg>
      <div className="needle-readout">
        <span className="needle-score">{Math.round(v)}</span>
        <span className="needle-verdict">{autoVerdict}</span>
      </div>
    </div>
  )
}

export default React.memo(NeedleGauge)
