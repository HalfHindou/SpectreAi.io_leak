/**
 * daysUntil — CALENDAR-day difference between now and a date, not elapsed-time.
 *
 * The naive `Math.ceil((target - now) / 86_400_000)` reads an event later TODAY
 * (e.g. an earnings print at 20:00 UTC viewed at 15:00) as "1 day away" — every
 * countdown came out one day too high. This strips the time-of-day on both ends
 * (local midnight to local midnight) so a print today = 0, tomorrow = 1, etc.
 *
 * Returns null for a missing/invalid date.
 */
export function daysUntil(dateInput) {
  if (!dateInput) return null
  const target = new Date(dateInput)
  if (Number.isNaN(target.getTime())) return null
  const now = new Date()
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((startOf(target) - startOf(now)) / 86_400_000)
}

/** Short countdown label: "today" / "tomorrow" / "in N days" (or "reported"). */
export function countdownLabel(days) {
  if (days == null) return ''
  if (days < 0) return 'reported'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}
