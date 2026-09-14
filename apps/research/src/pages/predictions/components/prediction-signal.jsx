/**
 * PredictionSignal — "THE READ": the one confident synthesis per market.
 *
 * Combines market odds + social momentum + whale/trade activity into a single
 * sentence and a directional lean, with a warm-white confidence meter. This is
 * the page's thesis — it sits at the TOP of the detail right rail, before the
 * trade box. No "AI" badge, no sparkle, no brain. Intelligence is invisible.
 *
 * Renders the rich verdict when `verdict` (from computeVerdict) is supplied.
 * The prose body prefers the LLM sentence (analysis.reasoning) and falls back
 * to a deterministic template assembled from the verdict descriptor, so it
 * never reads as hedge-everything slop and never shows a skeleton.
 */
import { useTranslation } from 'react-i18next'
import './prediction-signal.css'

const LEAN_LABEL_KEY = {
  yes: 'predictionsPage.verdict.leanYes',
  no: 'predictionsPage.verdict.leanNo',
  tossup: 'predictionsPage.verdict.tossup',
}

const QUALIFIER_KEY = {
  confirmed: 'predictionsPage.verdict.qConfirmed',
  vsSocial: 'predictionsPage.verdict.qVsSocial',
  thin: 'predictionsPage.verdict.qThin',
  aligned: 'predictionsPage.verdict.qAligned',
  crowd: 'predictionsPage.verdict.qCrowd',
  quiet: 'predictionsPage.verdict.qQuiet',
}

const QUALIFIER_FALLBACK = {
  confirmed: 'social-confirmed',
  vsSocial: 'vs social',
  thin: 'crowd-driven, thin',
  aligned: 'social-aligned',
  crowd: 'crowd-driven',
  quiet: 'quiet',
}

/* Deterministic prose when the LLM sentence is absent. Confident, specific,
   ends on a directional clause. */
function deterministicRead(verdict, leadLabel, yesPct, t) {
  const subject = leadLabel
    ? t('predictionsPage.verdict.subjectNamed', { defaultValue: '{{name}}', name: leadLabel })
    : null
  const leanWord =
    verdict.lean === 'tossup'
      ? t('predictionsPage.verdict.proseTossup', { defaultValue: 'is priced near a coin flip' })
      : verdict.lean === 'yes'
      ? t('predictionsPage.verdict.proseLeanYes', { defaultValue: 'leans Yes' })
      : t('predictionsPage.verdict.proseLeanNo', { defaultValue: 'leans No' })

  const head = subject
    ? t('predictionsPage.verdict.proseHeadNamed', {
        defaultValue: 'The market {{lean}} on {{name}} at {{pct}}%',
        lean: leanWord,
        name: leadLabel,
        pct: Math.round(yesPct),
      })
    : t('predictionsPage.verdict.proseHead', {
        defaultValue: 'The market {{lean}} at {{pct}}%',
        lean: leanWord,
        pct: Math.round(yesPct),
      })

  let move = ''
  if (verdict.deltaDir !== 'flat' && verdict.deltaAbs >= 0.5) {
    move =
      verdict.deltaDir === 'up'
        ? t('predictionsPage.verdict.proseUp', {
            defaultValue: ', up {{pts}} points in 24 hours',
            pts: verdict.deltaAbs,
          })
        : t('predictionsPage.verdict.proseDown', {
            defaultValue: ', down {{pts}} points in 24 hours',
            pts: verdict.deltaAbs,
          })
  }

  let tail
  switch (verdict.qualifier) {
    case 'confirmed':
      tail = t('predictionsPage.verdict.proseConfirmed', {
        defaultValue: 'Social momentum is heavy and aligned — {{kol}} high-reach accounts are carrying it. Conviction is building, not fading.',
        kol: verdict.kolCount || t('predictionsPage.verdict.several', { defaultValue: 'several' }),
      })
      break
    case 'vsSocial':
      tail = t('predictionsPage.verdict.proseVsSocial', {
        defaultValue: 'The crowd and the timeline disagree — watch for a snap.',
      })
      break
    case 'thin':
      tail = t('predictionsPage.verdict.proseThin', {
        defaultValue: 'Chatter is loud but the money behind it is thin — treat the move with caution.',
      })
      break
    case 'aligned':
      tail = t('predictionsPage.verdict.proseAligned', {
        defaultValue: 'Social chatter is pointing the same way the odds are.',
      })
      break
    case 'crowd':
      tail = t('predictionsPage.verdict.proseCrowd', {
        defaultValue: 'The timeline is active around this market.',
      })
      break
    default:
      tail = t('predictionsPage.verdict.proseQuiet', {
        defaultValue: 'Social is quiet. No clear edge from the conversation here.',
      })
  }

  return `${head}${move}. ${tail}`
}

function ConfidenceMeter({ strength }) {
  const filled = Math.max(0, Math.min(5, Math.round(strength / 20)))
  return (
    <span className="pm-verdict__meter" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`pm-verdict__seg${i < filled ? ' pm-verdict__seg--on' : ''}`}
          style={{ '--seg': i }}
        />
      ))}
    </span>
  )
}

export default function PredictionSignal({ analysis, verdict, leadLabel, yesPct = 50, dayMode }) {
  const { t } = useTranslation()

  // Rich verdict path — the new "THE READ" synthesis.
  if (verdict) {
    const leanLabelKey = LEAN_LABEL_KEY[verdict.lean] || LEAN_LABEL_KEY.tossup
    const leanCls =
      verdict.lean === 'yes'
        ? ' pm-verdict__lean--yes'
        : verdict.lean === 'no'
        ? ' pm-verdict__lean--no'
        : ' pm-verdict__lean--toss'
    const leanText = leadLabel
      ? t('predictionsPage.verdict.leanNamed', { defaultValue: 'Lean {{name}}', name: leadLabel })
      : t(leanLabelKey, {
          defaultValue:
            verdict.lean === 'yes' ? 'Lean Yes' : verdict.lean === 'no' ? 'Lean No' : 'Toss-up',
        })
    const qualText = t(QUALIFIER_KEY[verdict.qualifier], {
      defaultValue: QUALIFIER_FALLBACK[verdict.qualifier],
    })

    const body =
      (analysis?.reasoning || analysis?.analysis || '').trim() ||
      deterministicRead(verdict, leadLabel, yesPct, t)

    return (
      <div className={`pm-verdict pm-verdict--${verdict.tone}`}>
        <div className="pm-verdict__top">
          <span className="pm-verdict__label">
            {t('predictionsPage.verdict.label', { defaultValue: 'THE READ' })}
          </span>
          <span className="pm-verdict__strength">
            <ConfidenceMeter strength={verdict.strength} />
            <span className="pm-verdict__score mono">{verdict.strength}</span>
          </span>
        </div>
        <div className="pm-verdict__lean-row">
          <span className={`pm-verdict__dot${leanCls}`} />
          <span className={`pm-verdict__lean${leanCls}`}>{leanText}</span>
          <span className="pm-verdict__sep">·</span>
          <span className={`pm-verdict__qual pm-verdict__qual--${verdict.tone}`}>{qualText}</span>
        </div>
        <p className="pm-verdict__text">{body}</p>
      </div>
    )
  }

  // Legacy fallback — sentiment pills (kept for callers without verdict input).
  if (!analysis) return null

  const sentiment = analysis.sentiment || 'neutral'
  const confidence = Number.isFinite(analysis.confidence) ? analysis.confidence : null
  const whale = analysis.whaleActivity || {}

  return (
    <div className="pd-signal-card">
      <div className="pd-signal-header">
        <div className="pd-signal-title-row">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12h4l3-9 6 18 3-9h4" />
          </svg>
          <span className="pd-signal-title">{t('predictionsPage.signal.title')}</span>
        </div>
        <span className="pd-signal-confidence mono">{confidence != null ? `${confidence}%` : '—'}</span>
      </div>
      <div className="pd-signal-pills">
        <span className={`pd-signal-pill${sentiment === 'bullish' ? ' pd-signal-pill--yes' : ''}`}>
          {t('predictionsPage.signal.yes')}
        </span>
        <span className={`pd-signal-pill${sentiment === 'neutral' ? ' pd-signal-pill--neutral' : ''}`}>
          {t('predictionsPage.signal.neutral')}
        </span>
        <span className={`pd-signal-pill${sentiment === 'bearish' ? ' pd-signal-pill--no' : ''}`}>
          {t('predictionsPage.signal.no')}
        </span>
      </div>
      {whale.summary && (
        <p className="pd-signal-summary">{whale.summary}</p>
      )}
    </div>
  )
}
