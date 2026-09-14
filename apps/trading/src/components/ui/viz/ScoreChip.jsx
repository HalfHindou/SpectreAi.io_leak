/**
 * ScoreChip — label + 0-100 value + micro radial OR micro-bar + grade.
 *
 * Used by the AI Intelligence Card for the three derived metrics
 * (Momentum / Liquidity / Holder Trust). The `limited` flag marks
 * scores computed from incomplete data (e.g. Holder Trust before §II.9
 * server payload extension lands).
 */
import React from 'react'
import './ScoreChip.css'

function ScoreChip({
  label,
  score = 0,           // 0..100
  glyph = 'radial',    // 'radial' | 'bar'
  limited = false,
  className = '',
}) {
  const v = Math.max(0, Math.min(100, Number(score) || 0))
  const grade = v >= 80 ? 'A' : v >= 65 ? 'B' : v >= 50 ? 'C' : v >= 35 ? 'D' : 'F'

  return (
    <div
      className={['score-chip', limited && 'score-chip--limited', className]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="score-chip-label">{label}</span>
      <div className="score-chip-row">
        <span className="score-chip-value">{Math.round(v)}</span>
        {glyph === 'radial' ? <MicroRadial value={v / 100} /> : <MicroBar value={v / 100} />}
      </div>
      <span className="score-chip-grade" data-grade={grade}>
        {grade}{limited && '*'}
      </span>
    </div>
  )
}

function MicroRadial({ value = 0 }) {
  const r = 9
  const circ = 2 * Math.PI * r
  const fill = circ * Math.max(0, Math.min(1, value))
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r={r} fill="none" stroke="var(--glass-fill)" strokeWidth="2.5" />
      <circle
        cx="11"
        cy="11"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.5"
        strokeDasharray={`${fill} ${circ - fill}`}
        strokeLinecap="round"
        transform="rotate(-90 11 11)"
        className="score-chip-radial-fill"
      />
    </svg>
  )
}

function MicroBar({ value = 0 }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <span className="micro-bar">
      <span className="micro-bar-fill" style={{ width: `${pct}%` }} />
    </span>
  )
}

export default React.memo(ScoreChip)
