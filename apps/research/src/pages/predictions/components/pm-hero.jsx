/**
 * PmHero — the cinematic featured market. One full-width card, the canonical
 * story of the current category (highest-totalVolume event). Left pillar of
 * light, big stacked Yes/No odds bars that fill on reveal, the Signal Verdict
 * one-liner, and a glass CTA into the detail route.
 *
 * Only renders when an event is supplied — never a hollow shell.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PmSourceBadge from './pm-source-badge'
import { computeVerdict } from './lib/computeVerdict'
import { outcomeLabel, isPlaceholderName } from './pm-outcome-label'
import './pm-hero.css'

// "Will X win the 2028 ..." → "X"; strip the event title; drop trailing "?".

function PmHero({ event, onOpen, fmtVol }) {
  const { t } = useTranslation()
  const [filled, setFilled] = useState(false)
  const rafRef = useRef(0)

  // Stagger the odds-bar fill ~200ms after the card settles.
  useEffect(() => {
    setFilled(false)
    const id = setTimeout(() => { rafRef.current = requestAnimationFrame(() => setFilled(true)) }, 200)
    return () => { clearTimeout(id); cancelAnimationFrame(rafRef.current) }
  }, [event?.id])

  if (!event) return null

  const outcomes = Array.isArray(event.outcomes) ? event.outcomes : []
  const isMulti = outcomes.length > 1
  // Multi-outcome races (e.g. "Democratic Nominee" with 100+ candidates) must
  // NOT render as a binary Yes/No of one arbitrary candidate — that's the
  // nonsensical "1% Yes / 99% No". Feature the FRONT-RUNNERS by probability.
  // Exclude Polymarket's "Person P / the field / someone else" placeholder
  // outcomes — they sit at ~50% and would hijack the headline as a ghost leader.
  const isPlaceholder = (o) => isPlaceholderName(outcomeLabel(o, event))
  const realOutcomes = outcomes.filter((o) => !isPlaceholder(o))
  const rankPool = realOutcomes.length ? realOutcomes : outcomes
  const ranked = isMulti
    ? [...rankPool].sort((a, b) => (b.yesPct || 0) - (a.yesPct || 0)).slice(0, 4)
    : []
  const leadOutcome = isMulti ? ranked[0] : outcomes[0]
  const leadLabel = isMulti ? outcomeLabel(leadOutcome, event) : ''
  const yesPct = leadOutcome?.yesPct ?? 50
  const noPct = 100 - yesPct
  const delta = event._deltaPts ?? 0
  const verdict = computeVerdict({
    yesPct,
    delta,
    leadLabel,
    social: event._social || null,
    velocity: event.totalVolume ? (event.volume24h || 0) / event.totalVolume : 0,
  })
  const deltaGlyph = verdict.deltaSign === 'up' ? '▲' : verdict.deltaSign === 'down' ? '▼' : ''
  const leanText = verdict.lean === 'toss'
    ? t('predictionsPage.hero.tossUp', { defaultValue: 'Coin-flip' })
    : t('predictionsPage.hero.lean', { defaultValue: 'Lean {{lean}}', lean: verdict.leanWord })

  return (
    <article className="pm-hero animate-fade-up">
      <span className="pm-hero__pillar" aria-hidden="true" />

      <div className="pm-hero__eyebrow">
        <span className="pm-hero__cat" style={{ '--cat-color': 'var(--text-tertiary)' }}>{event.category}</span>
        <PmSourceBadge source={event.source || 'polymarket'} />
        <span className="pm-hero__live">
          <span className="pd-live-dot" />
          {t('predictionsPage.detail.live', { defaultValue: 'Live' })}
        </span>
      </div>

      <h2 className="pm-hero__title">{event.title}</h2>

      <div className={`pm-hero__odds${isMulti ? ' pm-hero__odds--multi' : ''}`}>
        {isMulti ? (
          ranked.map((o, i) => (
            <div className="pm-hero__bar" key={o.id || i}>
              <span className="pm-hero__bar-label">{outcomeLabel(o, event)}</span>
              <span className="pm-hero__track">
                <span
                  className={`pm-hero__fill pm-hero__fill--cand${i === 0 ? ' pm-hero__fill--lead' : ''}`}
                  style={{ width: filled ? `${o.yesPct}%` : '0%' }}
                />
              </span>
              <span className="pm-hero__pct mono">{o.yesPct}%</span>
            </div>
          ))
        ) : (
          <>
            <div className="pm-hero__bar">
              <span className="pm-hero__bar-label">{t('predictionsPage.outcome.yes', { defaultValue: 'Yes' })}</span>
              <span className="pm-hero__track">
                <span className="pm-hero__fill pm-hero__fill--yes" style={{ width: filled ? `${yesPct}%` : '0%' }} />
              </span>
              <span className="pm-hero__pct mono">{yesPct}%</span>
            </div>
            <div className="pm-hero__bar">
              <span className="pm-hero__bar-label">{t('predictionsPage.outcome.no', { defaultValue: 'No' })}</span>
              <span className="pm-hero__track">
                <span className="pm-hero__fill pm-hero__fill--no" style={{ width: filled ? `${noPct}%` : '0%' }} />
              </span>
              <span className="pm-hero__pct mono">{noPct}%</span>
            </div>
          </>
        )}
      </div>

      <div className="pm-hero__foot">
        <p className="pm-hero__verdict">
          {deltaGlyph && (
            <span className={`pm-hero__delta mono ${verdict.deltaSign === 'up' ? 'pm-bull' : 'pm-bear'}`}>
              {deltaGlyph} {Math.abs(Math.round(delta))} pts 24h
            </span>
          )}
          <span className="pm-hero__vol mono">{fmtVol ? fmtVol(event.totalVolume) : ''} volume</span>
          <span className={`pm-hero__lean ${verdict.lean === 'yes' ? 'pm-bull' : verdict.lean === 'no' ? 'pm-bear' : ''}`}>
            {leanText}
          </span>
          <span className="pm-hero__qual">— {verdict.qualifier}</span>
        </p>
        <button type="button" className="pm-hero__cta" onClick={() => onOpen?.(event)}>
          {t('predictionsPage.hero.open', { defaultValue: 'Open market' })} →
        </button>
      </div>
    </article>
  )
}

export default PmHero
