/**
 * How a released print landed against its forecast.
 *
 * One implementation for every calendar surface — the PRO page's week/month
 * grids, the Command Center panel and LITE all used to answer this
 * differently (or not at all), so the same release could read green in one
 * place, plain in another, and be invisible in a third.
 *
 * Note this is deliberately "vs consensus", NOT "good for risk": a hot CPI is
 * a beat on the number and a problem for the tape. Direction is the reader's
 * to interpret; the colour only says which side of the estimate it came in.
 */

function toNumber(v) {
  if (v == null || v === '') return null
  const x = parseFloat(String(v).replace(/[^\d.\-]/g, ''))
  return Number.isFinite(x) ? x : null
}

/**
 * Has this actually PRINTED?
 *
 * Not simply "is `actual` non-null". Scheduled events — a symposium, a speech,
 * a set of meeting accounts — come through the feed carrying a placeholder
 * ZERO with no forecast and no previous beside it, and a naive null-check read
 * that as a released print: a Jackson Hole three days in the FUTURE rendered
 * "ACT 0" under a RELEASED chip. A zero with nothing to compare it against is
 * not a number, it's an empty field. (Same call LITE's `calNumbersMeaningful`
 * makes on the same feed.)
 */
export function isReleased(event) {
  if (!event) return false
  const { actual, forecast, previous } = event
  if (actual == null || actual === '') return false
  const n = parseFloat(String(actual).replace(/[^\d.\-]/g, ''))
  if (n === 0 && forecast == null && previous == null) return false
  return true
}

/**
 * '' (no comparison possible) | 'beat' | 'miss' | 'inline'
 * Inside 1% of the estimate counts as in line — a 0.01 wobble on a 4.9% print
 * is not a surprise and shouldn't be painted like one.
 */
export function resultTone(event) {
  const actual = toNumber(event?.actual)
  const forecast = toNumber(event?.forecast)
  if (actual == null || forecast == null) return ''
  const denom = Math.abs(forecast) || 1
  if (Math.abs(actual - forecast) / denom < 0.01) return 'inline'
  return actual > forecast ? 'beat' : 'miss'
}

/** Class suffix for the shared `.cal-result` chip in calendar-temporal.css. */
export function resultClass(event) {
  const tone = resultTone(event)
  return tone === 'beat' || tone === 'miss' ? ` cal-result--${tone}` : ''
}

/** Where an event sits relative to now: 'past' | 'today' | 'ahead'. */
export function dayPhase(date, now = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  if (isNaN(d.getTime())) return 'ahead'
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (a === b) return 'today'
  return a < b ? 'past' : 'ahead'
}
