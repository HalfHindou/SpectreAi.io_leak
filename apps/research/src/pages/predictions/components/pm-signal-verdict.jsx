/**
 * PmSignalVerdict — the Signal Verdict, rendered two ways.
 *
 *  - compact (`variant="chip"`): one pill row under a grid card's outcomes.
 *      ◐ Lean Yes · social-confirmed
 *  - full    (`variant="full"`): the "THE READ" block (hero / detail).
 *      label + confidence meter + one-paragraph synthesis.
 *
 * The lean/qualifier/strength are deterministic (lib/computeVerdict). Pass a
 * pre-computed verdict in, or { yesPct, delta, ... } and we compute it.
 * Degrades gracefully: with no social loaded the chip shows odds-only lean.
 */
import { computeVerdict } from './lib/computeVerdict'
import './pm-signal-verdict.css'

function resolve(props) {
  return props.verdict || computeVerdict(props)
}

// Qualifier tone → the colour class for the qualifier text.
function toneClass(tone) {
  if (tone === 'confirm' || tone === 'align') return 'pm-vd-q--confirm'
  if (tone === 'diverge') return 'pm-vd-q--diverge' // the second sanctioned amber (text only)
  return 'pm-vd-q--muted'
}

function leanDotClass(lean) {
  return lean === 'yes' ? 'pm-vd-dot--bull' : lean === 'no' ? 'pm-vd-dot--bear' : 'pm-vd-dot--neutral'
}

export function PmVerdictChip(props) {
  const v = resolve(props)
  const leadLabel = props.leadLabel
  // Multi-outcome chips read "Lean Hassett", binary read "Lean Yes".
  const leanText = v.lean === 'toss' ? 'Toss-up' : `Lean ${v.leanWord}`
  return (
    <div className="pm-card-verdict" title={v.text}>
      <span className={`pm-card-verdict__dot ${leanDotClass(v.lean)}`} />
      <span className={`pm-card-verdict__lean ${v.lean === 'yes' ? 'pm-bull' : v.lean === 'no' ? 'pm-bear' : ''}`}>
        {leanText}
      </span>
      <span className="pm-card-verdict__sep">·</span>
      <span className={`pm-card-verdict__qual ${toneClass(v.qualifierTone)}`}>{v.qualifier}</span>
    </div>
  )
}

export function PmVerdictFull(props) {
  const v = resolve(props)
  const filled = Math.round(v.strength / 20)
  // Split the synthesis so the leading clause carries the bull/bear colour.
  return (
    <div className="pm-verdict">
      <div className="pm-verdict__head">
        <span className="pm-verdict__label">{props.label || 'The Read'}</span>
        <div className="pm-verdict__meter" aria-label={`Conviction ${v.strength} of 100`}>
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className={`pm-verdict__seg${i < filled ? ' pm-verdict__seg--on' : ''}`} style={{ '--seg-index': i }} />
          ))}
          <span className="pm-verdict__score mono">{v.strength}</span>
        </div>
      </div>
      <p className="pm-verdict__text">{v.text}</p>
    </div>
  )
}

export default PmVerdictChip
