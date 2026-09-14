/**
 * InflationJobsWatch — the data-dependent-Fed readiness surface.
 *
 * Elevates the US inflation and labor releases that now drive rate-cut odds:
 * each series shows its next-release countdown, latest actual vs forecast, a
 * hawkish/dovish read of the surprise, and a recent-prints trend. A Fed-regime
 * strip frames why these prints matter (Warsh: talk less, guided by data).
 *
 * Pure presentation over useMacroWatch(events) — no network of its own.
 * `compact` renders the condensed home-panel variant.
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import InfoTip from '@/components/InfoTip'
import useMacroWatch from '../hooks/useMacroWatch'
import useCountdown from '../hooks/useCountdown'
import { FED_REGIME } from '../data/macroWatch'
import './InflationJobsWatch.css'

const LEAN_META = {
  hawkish: { label: 'Hawkish', tip: 'Hotter than forecast — leans against rate cuts (headwind for risk).' },
  dovish: { label: 'Dovish', tip: 'Softer than forecast — leans toward rate cuts (tailwind for risk).' },
  inline: { label: 'In line', tip: 'Printed in line with forecast.' },
}

function leadString(tl) {
  if (!tl || tl.isExpired) return 'now'
  if (tl.days >= 1) return `${tl.days}d ${tl.hours}h`
  if (tl.hours >= 1) return `${tl.hours}h ${tl.minutes}m`
  return `${tl.minutes}m`
}

// Live ticking label — only mounted for imminent releases so far-out cards
// don't subscribe to the 1Hz clock for no reason.
const LiveLead = ({ target, prefix = 'in ' }) => {
  const tl = useCountdown(target)
  return <>{prefix}{leadString(tl)}</>
}

const FomcCountdown = ({ next }) => {
  const tl = useCountdown(next?.decision)
  if (!next) return null
  const live = tl && !tl.isExpired
  return (
    <span className="ijw-fomc" title={next.sep ? 'Includes Summary of Economic Projections' : 'Statement + press conference'}>
      <span className="ijw-fomc__label">Next FOMC</span>
      <span className="ijw-fomc__val mono">{next.label}</span>
      {live && <span className="ijw-fomc__cd mono">{leadString(tl)}</span>}
    </span>
  )
}

function nextReleaseNode(next) {
  if (!next?.dateTime) return <span className="ijw-card__next ijw-card__next--tbd">TBD</span>
  const target = new Date(next.dateTime).getTime()
  const days = (target - Date.now()) / 86400000
  if (days <= 0) {
    return <span className="ijw-card__next ijw-card__next--live">due</span>
  }
  if (days <= 2) {
    return <span className="ijw-card__next ijw-card__next--soon mono"><LiveLead target={next.dateTime} /></span>
  }
  const label = new Date(next.dateTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return <span className="ijw-card__next mono">{label}</span>
}

// Tiny bar trend of recent prints. Last bar is emphasized; a caret shows
// whether the series is rising or falling over the window.
const TrendBars = ({ trend }) => {
  if (!trend || trend.length < 2) return <div className="ijw-trend ijw-trend--empty" aria-hidden="true" />
  const nums = trend.map((p) => p.num)
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const span = max - min || 1
  const rising = nums[nums.length - 1] > nums[0]
  return (
    <div className="ijw-trend" aria-hidden="true">
      <div className="ijw-trend__bars">
        {trend.map((p, i) => {
          const h = 16 + ((p.num - min) / span) * 14
          const last = i === trend.length - 1
          return (
            <span
              key={p.dateTime || i}
              className={`ijw-trend__bar${last ? ' ijw-trend__bar--last' : ''}`}
              style={{ height: `${h}px` }}
            />
          )
        })}
      </div>
      <span className={`ijw-trend__caret ijw-trend__caret--${rising ? 'up' : 'down'}`}>
        {rising ? '↗' : '↘'}
      </span>
    </div>
  )
}

const SeriesCard = ({ s, onSelect }) => {
  const latest = s.latest
  const lean = latest?.lean && latest.lean !== 'na' ? latest.lean : null
  const leanMeta = lean ? LEAN_META[lean] : null
  const unit = s.unit || ''
  // Prefer the hook's normalized display ("57K", "4.2%") - the raw
  // string+unit concat rendered "110000K" when the feed carried raw units.
  const actualStr = latest?.actualDisplay
    ?? (latest?.actual != null
      ? `${latest.actual}${typeof latest.actual === 'string' && latest.actual.match(/[%kmb]/i) ? '' : unit}`
      : '—')
  const eventId = latest?.eventId || s.next?.eventId || null
  const interactive = Boolean(onSelect && eventId)

  return (
    <button
      type="button"
      className={`ijw-card${lean ? ` ijw-card--${lean}` : ''}${interactive ? '' : ' ijw-card--static'}`}
      onClick={interactive ? () => onSelect(eventId) : undefined}
      title={s.fullName}
    >
      <div className="ijw-card__top">
        <span className="ijw-card__label">{s.label}</span>
        {nextReleaseNode(s.next)}
      </div>

      <div className="ijw-card__mid">
        <span className="ijw-card__actual mono">{actualStr}</span>
        {latest?.forecast != null && (
          <span className="ijw-card__vs mono">vs {latest.forecastDisplay ?? latest.forecast} exp</span>
        )}
        {!latest && <span className="ijw-card__vs">awaiting first print</span>}
      </div>

      <div className="ijw-card__bottom">
        <TrendBars trend={s.trend} />
        {leanMeta && (
          <span className={`ijw-lean ijw-lean--${lean}`} title={leanMeta.tip}>{leanMeta.label}</span>
        )}
      </div>
    </button>
  )
}

const InflationJobsWatch = ({ events, loading = false, compact = false, variant, onSeriesClick }) => {
  const { t } = useTranslation()
  const watch = useMacroWatch(events)
  // 'page' = full-width family groups, 'rail' = right-column 2-col grid,
  // 'compact' = home horizontal scroll. `compact` prop kept for back-compat.
  const v = variant || (compact ? 'compact' : 'page')

  if (loading && !watch.hasData) {
    return (
      <section className={`ijw ijw--${v}`} aria-busy="true">
        <div className="ijw__head">
          <span className="ijw__title">{t('economicCalendar.inflationJobs.title', 'Inflation & Jobs Watch')}</span>
        </div>
        <div className="ijw__skeleton">
          {Array.from({ length: v === 'compact' ? 4 : 8 }).map((_, i) => (
            <div key={i} className="ijw-card ijw-card--skeleton animate-shimmer" />
          ))}
        </div>
      </section>
    )
  }

  if (!watch.hasData) return null

  return (
    <section className={`ijw ijw--${v}`}>
      <div className="ijw__head">
        <div className="ijw__titlewrap">
          <span className="ijw__title">{t('economicCalendar.inflationJobs.title', 'Inflation & Jobs Watch')}</span>
          <InfoTip
            text={t('economicCalendar.inflationJobs.tooltip', 'The US inflation and labor releases that move Fed rate-cut odds. We track the latest print vs forecast, a hawkish/dovish read of the surprise, and the recent trend.')}
            position="right"
          />
        </div>
        <div className="ijw__regime">
          <span className="ijw__regime-chip" title={`Chair ${FED_REGIME.chair} · ${FED_REGIME.comms}`}>
            <span className="ijw__regime-dot" />
            {t('economicCalendar.inflationJobs.fedStance', 'Fed: data-dependent')}
          </span>
          <span className="ijw__regime-rate mono" title={`Held ${FED_REGIME.lastDecision.date} · ${FED_REGIME.lastDecision.summary}`}>{FED_REGIME.rateBand}</span>
          <FomcCountdown next={watch.nextFomc} />
        </div>
      </div>

      {v !== 'compact' && <p className="ijw__why">{FED_REGIME.why}</p>}

      {v === 'compact' ? (
        <div className="ijw__grid ijw__grid--scroll">
          {watch.series.map((s) => (
            <SeriesCard key={s.id} s={s} onSelect={onSeriesClick} />
          ))}
        </div>
      ) : (
        watch.families.map((fam) => (
          <div key={fam.id} className="ijw__group">
            <span className="ijw__group-label">{fam.label}</span>
            <div className="ijw__grid">
              {fam.series.map((s) => (
                <SeriesCard key={s.id} s={s} onSelect={onSeriesClick} />
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  )
}

export default React.memo(InflationJobsWatch)
