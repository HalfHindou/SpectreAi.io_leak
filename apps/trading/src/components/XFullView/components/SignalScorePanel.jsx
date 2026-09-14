import { memo } from 'react'

import {
  computeSignalScore,
  clamp01,
  SIGNAL_TIER_LABEL,
  SIGNAL_PART_LABELS,
  SIGNAL_PART_ORDER,
} from '../signal-score'

/**
 * SignalScorePanel — the hero "verdict" number for the X Dash column.
 *
 * One 0-100 attention-quality score (the same engine the research X Dash
 * dossier uses) with a warm-white ring gauge + the 5-part breakdown bars that
 * compose it: velocity, novelty, clean signal, author breadth, engagement.
 *
 * Tier color comes from a class modifier (`xdc-sig--<tier>`) so day mode can
 * flip the warm-white ramp to a dark ramp — the ring stroke + score text use
 * `currentColor`.
 */
function SignalScorePanel({ intel }) {
  if (!intel) return null

  const { score, tier, parts, hasData } = computeSignalScore(intel)
  if (!hasData) return null

  // Ring geometry — r=26 on a 64 viewBox, stroke 5.
  const R = 26
  const CIRC = 2 * Math.PI * R
  const filled = CIRC * (Math.max(0, Math.min(100, score)) / 100)

  return (
    <div className={`xfv-panel xdc-sig xdc-sig--${tier}`}>
      <div className="xfv-panel-header">
        <div
          className="xfv-panel-title xfv-tip"
          data-xfv-tip="One hero number fusing clean signal, author breadth, velocity, novelty and engagement into a 0-100 attention-quality score. Quality of attention is weighted above raw volume."
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span>Signal Score</span>
        </div>
        <span className="xdc-sig-tier">{SIGNAL_TIER_LABEL[tier]}</span>
      </div>

      <div className="xfv-panel-body xdc-sig-body">
        <div className="xdc-sig-ring" role="img" aria-label={`Signal score ${score} of 100`}>
          <svg viewBox="0 0 64 64" width="64" height="64">
            <circle className="xdc-sig-ring-bg" cx="32" cy="32" r={R} fill="none" strokeWidth="5" />
            <circle
              className="xdc-sig-ring-fg"
              cx="32"
              cy="32"
              r={R}
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${filled} ${CIRC}`}
              transform="rotate(-90 32 32)"
            />
          </svg>
          <div className="xdc-sig-score">{score}</div>
        </div>

        <div className="xdc-sig-parts">
          {SIGNAL_PART_ORDER.map((k) => {
            const pct = Math.round(clamp01(parts[k]) * 100)
            return (
              <div key={k} className="xdc-sig-part">
                <span className="xdc-sig-part-label">{SIGNAL_PART_LABELS[k]}</span>
                <span className="xdc-sig-part-track">
                  <span className="xdc-sig-part-fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="xdc-sig-part-val">{pct}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default memo(SignalScorePanel)
