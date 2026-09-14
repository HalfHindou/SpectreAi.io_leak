/**
 * EventSnapshot
 * The one block of the expanded event panel that ALWAYS renders.
 *
 * Every other section (history, analysis, crypto impact, reaction chart)
 * returns null when the feed has nothing for that event, and for a second-tier
 * print or a speech that is most of them - the panel opened onto an empty
 * card. This block is built from the fields every event carries: the three
 * numbers, the timestamp, region, category, impact. Plus one derived sentence
 * that reads them for the user, so even a bare PMI opens to something worth
 * the click.
 */

import { useTranslation } from 'react-i18next'
import {
  formatValueWithUnit,
  formatRelativeTime,
  formatEventDate,
  getCountryFlag,
} from '../utils/formatters'
import { isReleased, resultTone } from '../utils/eventResult'
import { getEventStatus } from '../hooks/useEventStatus'
import './EventSnapshot.css'

function toNumber(v) {
  if (v == null || v === '') return null
  const x = parseFloat(String(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(x) ? x : null
}

// Δ between two prints, printed with the event's unit where that makes
// sense. Percent-point deltas keep one decimal; big-unit deltas (K, B) keep
// the unit so "+6K" reads as jobs, not a bare integer.
function formatDelta(a, b, unit) {
  const d = a - b
  if (!Number.isFinite(d)) return ''
  const abs = Math.abs(d)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  const num = abs.toFixed(digits).replace(/\.?0+$/, '')
  const u = unit && /^[%KMBT]$/i.test(String(unit).trim()) ? String(unit).trim() : ''
  return `${d > 0 ? '+' : '-'}${num}${u}`
}

function buildRead(event, t) {
  const actual = toNumber(event.actual)
  const forecast = toNumber(event.forecast)
  const previous = toNumber(event.previous)
  const unit = event.unit
  const released = isReleased(event)

  if (released && actual != null) {
    if (forecast != null) {
      const tone = resultTone(event)
      const delta = formatDelta(actual, forecast, unit)
      if (tone === 'inline') {
        return { tone: 'inline', text: t('economicCalendar.snapshot.readInline', 'Printed in line with consensus.') }
      }
      const key = tone === 'beat' ? 'readBeat' : 'readMiss'
      const fallback = tone === 'beat'
        ? 'Came in {{delta}} above consensus.'
        : 'Came in {{delta}} below consensus.'
      let text = t(`economicCalendar.snapshot.${key}`, fallback, { delta: delta.replace(/^[+-]/, '') })
      if (previous != null && previous !== actual) {
        text += ' ' + t(
          actual > previous ? 'economicCalendar.snapshot.readUpFromPrior' : 'economicCalendar.snapshot.readDownFromPrior',
          actual > previous ? 'Up from the prior print.' : 'Down from the prior print.',
        )
      }
      return { tone, text }
    }
    if (previous != null) {
      if (previous === actual) {
        return { tone: 'inline', text: t('economicCalendar.snapshot.readFlatVsPrior', 'Unchanged from the prior print. No consensus was published.') }
      }
      return {
        tone: actual > previous ? 'beat' : 'miss',
        text: t(
          actual > previous ? 'economicCalendar.snapshot.readUpNoFcst' : 'economicCalendar.snapshot.readDownNoFcst',
          actual > previous
            ? '{{delta}} above the prior print. No consensus was published.'
            : '{{delta}} below the prior print. No consensus was published.',
          { delta: formatDelta(actual, previous, unit).replace(/^[+-]/, '') },
        ),
      }
    }
    return { tone: '', text: t('economicCalendar.snapshot.readNoCompare', 'Printed with nothing to compare against - first release in the series.') }
  }

  // Not printed yet
  if (forecast != null && previous != null) {
    if (forecast === previous) {
      return { tone: '', text: t('economicCalendar.snapshot.readExpectFlat', 'Street expects no change from the prior print. A surprise either way is the story.') }
    }
    const up = forecast > previous
    return {
      tone: '',
      text: t(
        up ? 'economicCalendar.snapshot.readExpectUp' : 'economicCalendar.snapshot.readExpectDown',
        up
          ? 'Consensus sits {{delta}} above the prior print - the street is looking for a pickup.'
          : 'Consensus sits {{delta}} below the prior print - the street is looking for a slowdown.',
        { delta: formatDelta(forecast, previous, unit).replace(/^[+-]/, '') },
      ),
    }
  }
  if (forecast != null) {
    return { tone: '', text: t('economicCalendar.snapshot.readFcstOnly', 'Consensus is set. No prior print to measure it against.') }
  }
  if (previous != null) {
    return { tone: '', text: t('economicCalendar.snapshot.readPrevOnly', 'No consensus published - the print will be judged against the prior reading.') }
  }
  if (event.isSpeech) {
    return { tone: '', text: t('economicCalendar.snapshot.readSpeech', 'No data print. Markets trade the language - watch headlines for a shift in tone.') }
  }
  if (event.isReport) {
    return { tone: '', text: t('economicCalendar.snapshot.readReport', 'A report, not a single number. The detail inside sets the reaction.') }
  }
  return { tone: '', text: t('economicCalendar.snapshot.readNoNumbers', 'No numbers attached to this event. Reaction, if any, comes from the headline.') }
}

const EventSnapshot = ({ event, showSource = false }) => {
  const { t } = useTranslation()
  if (!event) return null

  const status = getEventStatus(event)
  const released = status === 'released'
  const unit = event.unit
  const prev = formatValueWithUnit(event.previous, unit)
  const fcst = formatValueWithUnit(event.forecast, unit)
  const act = released ? formatValueWithUnit(event.actual, unit) : null
  const hasAnyNumber = prev != null || fcst != null || act != null
  const tone = released ? resultTone(event) : ''
  const read = buildRead(event, t)

  let actualPlaceholder = null
  if (!released) {
    if (status === 'live') actualPlaceholder = t('economicCalendar.snapshot.live', 'Live')
    else if (status === 'passed') actualPlaceholder = t('economicCalendar.snapshot.awaiting', 'Awaiting')
    else actualPlaceholder = formatRelativeTime(event.dateTime) || t('economicCalendar.snapshot.pending', 'Pending')
  }

  const flag = event.country ? getCountryFlag(event.country) : ''
  const region = event.currency && event.currency !== event.country
    ? `${event.country || ''} · ${event.currency}`.replace(/^ · /, '')
    : (event.country || '')
  const impact = event.impact ? String(event.impact) : ''
  const nextRelease = event.nextReleaseDate ? formatEventDate(event.nextReleaseDate) : ''
  const flags = [
    event.isPreliminary && t('economicCalendar.snapshot.preliminary', 'Preliminary'),
    event.isTentative && t('economicCalendar.snapshot.tentative', 'Tentative'),
    event.isAllDay && t('economicCalendar.snapshot.allDay', 'All day'),
    event.revised != null && event.revised !== '' && t('economicCalendar.snapshot.revised', 'Prior revised to {{value}}', { value: formatValueWithUnit(event.revised, unit) }),
  ].filter(Boolean)

  return (
    <div className={`event-snapshot${tone ? ` event-snapshot--${tone}` : ''}`}>
      {hasAnyNumber ? (
        <div className="event-snapshot__numbers">
          <div className="event-snapshot__stat">
            <span className="event-snapshot__stat-label">{t('economicCalendar.snapshot.previous', 'Previous')}</span>
            <span className={`event-snapshot__stat-val mono${prev == null ? ' event-snapshot__stat-val--empty' : ''}`}>{prev ?? '—'}</span>
          </div>
          <div className="event-snapshot__stat">
            <span className="event-snapshot__stat-label">{t('economicCalendar.snapshot.forecast', 'Forecast')}</span>
            <span className={`event-snapshot__stat-val mono${fcst == null ? ' event-snapshot__stat-val--empty' : ''}`}>{fcst ?? '—'}</span>
          </div>
          <div className="event-snapshot__stat event-snapshot__stat--actual">
            <span className="event-snapshot__stat-label">{t('economicCalendar.snapshot.actual', 'Actual')}</span>
            {act != null ? (
              <span className={`event-snapshot__stat-val mono${tone ? ` event-snapshot__stat-val--${tone}` : ''}`}>{act}</span>
            ) : (
              <span className={`event-snapshot__stat-val event-snapshot__stat-val--wait${status === 'live' ? ' event-snapshot__stat-val--live' : ''}`}>
                {actualPlaceholder}
              </span>
            )}
          </div>
        </div>
      ) : null}

      <p className={`event-snapshot__read${read.tone ? ` event-snapshot__read--${read.tone}` : ''}`}>{read.text}</p>

      <div className="event-snapshot__meta">
        {!hasAnyNumber && actualPlaceholder && (
          <span className={`event-snapshot__chip${status === 'live' ? ' event-snapshot__chip--live' : ''}`}>{actualPlaceholder}</span>
        )}
        {region && (
          <span className="event-snapshot__chip">
            {flag && <span className="event-snapshot__flag" aria-hidden="true">{flag}</span>}
            {region}
          </span>
        )}
        {event.category && <span className="event-snapshot__chip">{event.category}</span>}
        {impact && (
          <span className={`event-snapshot__chip event-snapshot__chip--${impact.toLowerCase()}`}>
            {t(`economicCalendar.impact${impact.charAt(0).toUpperCase() + impact.slice(1).toLowerCase()}Upper`, impact.toUpperCase())}
            {' '}{t('economicCalendar.snapshot.impact', 'impact')}
          </span>
        )}
        {flags.map((f) => <span key={f} className="event-snapshot__chip">{f}</span>)}
        {nextRelease && (
          <span className="event-snapshot__chip event-snapshot__chip--muted">
            {t('economicCalendar.snapshot.next', 'Next')} {nextRelease}
          </span>
        )}
        {showSource && event.sourceUrl && (
          <a
            className="event-snapshot__chip event-snapshot__chip--link"
            href={event.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('economicCalendar.officialSource', 'Official source')}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 17 17 7" /><path d="M7 7h10v10" />
            </svg>
          </a>
        )}
      </div>
    </div>
  )
}

export default EventSnapshot
