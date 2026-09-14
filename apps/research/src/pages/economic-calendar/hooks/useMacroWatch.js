/**
 * useMacroWatch — derives the Inflation & Jobs watch from the live event feed.
 *
 * No new network: the calendar already fetches a ~3-month-back → forward window
 * with actuals filled in, so every tracked series has real past prints (a trend)
 * plus its next scheduled release. We group those events per series and compute:
 *   - latest released print (actual vs forecast + surprise → hawkish/dovish lean)
 *   - next upcoming release (dateTime; the UI ticks the countdown)
 *   - recent-prints trend (chronological, up to TREND_POINTS)
 *
 * Lean is the readiness signal: under a data-dependent Fed, a hot CPI or a
 * soft jobs print is what actually moves cut odds.
 */

import { useMemo } from 'react'
import {
  TRACKED_SERIES,
  SERIES_FAMILIES,
  matchSeries,
  getNextFomc,
} from '../data/macroWatch'

const TREND_POINTS = 6
// Surprises smaller than this (relative to the forecast magnitude) read as
// "in line" rather than a directional beat/miss — filters out rounding noise.
const INLINE_REL_THRESHOLD = 0.005

function parseMetricNum(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  const m = s.match(/-?[\d,]*\.?\d+/)
  if (!m) return null
  let n = parseFloat(m[0].replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  if (/\bk\b|k$/i.test(s)) n *= 1e3
  else if (/\bm\b|m$/i.test(s)) n *= 1e6
  else if (/\bb\b|b$/i.test(s)) n *= 1e9
  return n
}

function inferUnit(...vals) {
  for (const v of vals) {
    if (typeof v === 'string') {
      if (v.includes('%')) return '%'
      if (/k$/i.test(v.trim())) return 'K'
      if (/m$/i.test(v.trim())) return 'M'
      if (/b$/i.test(v.trim())) return 'B'
    }
  }
  return ''
}

const UNIT_FACTORS = { K: 1e3, M: 1e6, B: 1e9 }

// Normalize a metric value to BASE units regardless of payload shape. The feed
// historically mixed magnitudes inside one event (actual 57 scaled-K next to a
// forecast of 110000 raw jobs) and edge/LS caches can keep serving that shape
// for a while - so treat small plain numbers as scaled-per-unit and large ones
// as already-raw instead of trusting either blindly.
function toBaseUnits(v, unit) {
  if (v == null || v === '') return null
  if (typeof v === 'string' && /[kmb]\s*$/i.test(v.trim())) return parseMetricNum(v)
  const n = typeof v === 'number' ? (Number.isFinite(v) ? v : null) : parseMetricNum(v)
  if (n == null) return null
  const f = UNIT_FACTORS[String(unit || '').trim().charAt(0).toUpperCase()]
  if (!f) return n
  return Math.abs(n) < 1e5 ? n * f : n
}

// Human display for a metric: "57K", "110K exp", "4.2%" - never "110000K".
export function fmtMetric(v, unit) {
  if (v == null || v === '') return null
  const u = String(unit || '').trim()
  if (u.startsWith('%') || (typeof v === 'string' && v.includes('%'))) {
    const n = parseMetricNum(v)
    return n == null ? String(v) : `${n}%`
  }
  const base = toBaseUnits(v, u)
  if (base == null) return String(v)
  const abs = Math.abs(base)
  const trim = (x) => String(Math.round(x * 10) / 10)
  if (abs >= 1e9) return `${trim(base / 1e9)}B`
  if (abs >= 1e6) return `${trim(base / 1e6)}M`
  if (abs >= 1e3) return `${trim(base / 1e3)}K`
  return trim(base)
}

function computeLean(series, actualNum, forecastNum) {
  if (actualNum == null || forecastNum == null) return 'na'
  const diff = actualNum - forecastNum
  const rel = Math.abs(diff) / (Math.abs(forecastNum) || 1)
  if (diff === 0 || rel < INLINE_REL_THRESHOLD) return 'inline'
  const higher = diff > 0
  return higher === series.hawkishIfHigher ? 'hawkish' : 'dovish'
}

function buildSeries(series, events) {
  let matches = events.filter((e) => matchSeries(e) === series.id)
  if (series.prefer && matches.length > 1) {
    const pref = matches.filter((e) => series.prefer.test(String(e.name || e.title || '')))
    if (pref.length) matches = pref
  }
  if (matches.length === 0) {
    return {
      id: series.id,
      label: series.label,
      fullName: series.fullName,
      blurb: series.blurb,
      family: series.family,
      hawkishIfHigher: series.hawkishIfHigher,
      unit: '',
      latest: null,
      next: null,
      trend: [],
    }
  }

  const byTime = [...matches].sort(
    (a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime()
  )
  const now = Date.now()
  const released = byTime.filter((e) => e.actual !== null && e.actual !== undefined && e.actual !== '')
  const upcoming = byTime.filter(
    (e) => (e.actual === null || e.actual === undefined || e.actual === '') &&
      new Date(e.dateTime).getTime() > now
  )

  const latestEvent = released.length ? released[released.length - 1] : null
  const nextEvent = upcoming.length ? upcoming[0] : null

  const unit = inferUnit(
    latestEvent?.actual, latestEvent?.forecast, nextEvent?.forecast, latestEvent?.previous
  ) || (latestEvent?.unit || nextEvent?.unit || '')

  let latest = null
  if (latestEvent) {
    // Base-units on BOTH sides: the surprise math must never compare a
    // scaled actual (57 = 57K) against a raw forecast (110000).
    const actualNum = toBaseUnits(latestEvent.actual, unit)
    const forecastNum = toBaseUnits(latestEvent.forecast, unit)
    latest = {
      eventId: latestEvent.id,
      dateTime: latestEvent.dateTime,
      actual: latestEvent.actual,
      forecast: latestEvent.forecast ?? null,
      previous: latestEvent.previous ?? null,
      actualNum,
      forecastNum,
      actualDisplay: fmtMetric(latestEvent.actual, unit),
      forecastDisplay: fmtMetric(latestEvent.forecast, unit),
      lean: computeLean(series, actualNum, forecastNum),
    }
  }

  const trend = released
    .slice(-TREND_POINTS)
    .map((e) => ({ dateTime: e.dateTime, num: toBaseUnits(e.actual, unit), raw: e.actual }))
    .filter((p) => p.num != null)

  return {
    id: series.id,
    label: series.label,
    fullName: series.fullName,
    blurb: series.blurb,
    family: series.family,
    hawkishIfHigher: series.hawkishIfHigher,
    unit,
    latest,
    next: nextEvent ? { eventId: nextEvent.id, dateTime: nextEvent.dateTime, forecast: nextEvent.forecast ?? null } : null,
    trend,
  }
}

export default function useMacroWatch(events) {
  return useMemo(() => {
    const list = Array.isArray(events) ? events : []
    const series = TRACKED_SERIES.map((s) => buildSeries(s, list))
    const byFamily = SERIES_FAMILIES.map((f) => ({
      ...f,
      series: series.filter((s) => s.family === f.id),
    }))
    // Has anything actually populated? Drives the empty/loading state.
    const hasData = series.some((s) => s.latest || s.next)
    return {
      series,
      families: byFamily,
      inflation: series.filter((s) => s.family === 'inflation'),
      employment: series.filter((s) => s.family === 'employment'),
      nextFomc: getNextFomc(),
      hasData,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events])
}
