/**
 * Google Calendar deep-link builder.
 * Generates a URL to create a Google Calendar event.
 */

function pad(n) {
  return String(n).padStart(2, '0')
}

function toGoogleDate(date) {
  const d = new Date(date)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`
}

export function buildGoogleCalendarUrl(event) {
  const start = new Date(event.dateTime)
  const end = new Date(start.getTime() + 30 * 60 * 1000)

  const title = `${event.name}${event.currency ? ` (${event.currency})` : ''}`
  const details = [
    event.impact ? `Impact: ${event.impact.toUpperCase()}` : '',
    event.forecast != null ? `Forecast: ${event.forecast}` : '',
    event.previous != null ? `Previous: ${event.previous}` : '',
    'Source: Spectre AI Economic Calendar',
  ].filter(Boolean).join('\n')

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${toGoogleDate(start)}/${toGoogleDate(end)}`,
    details,
  })

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
