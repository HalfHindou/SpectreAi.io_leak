/**
 * ICS Export Utility
 * Generates RFC 5545 compliant .ics calendar files from economic events.
 * No external dependencies — pure string generation.
 */

/**
 * Format a Date to iCalendar DTSTART format: YYYYMMDDTHHmmssZ
 */
function formatICSDate(dateTime) {
  const d = new Date(dateTime)
  const pad = (n) => String(n).padStart(2, '0')
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  )
}

/**
 * Escape special characters for iCalendar text fields
 */
function escapeICS(text) {
  if (!text) return ''
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/**
 * Build a single VEVENT block
 */
function buildVEvent(event) {
  const start = formatICSDate(event.dateTime)
  // Events are point-in-time releases — 30 min duration
  const endDate = new Date(new Date(event.dateTime).getTime() + 30 * 60 * 1000)
  const end = formatICSDate(endDate)

  const descParts = []
  if (event.impact) descParts.push(`Impact: ${event.impact.toUpperCase()}`)
  if (event.country) descParts.push(`Country: ${event.country}`)
  if (event.category) descParts.push(`Category: ${event.category}`)
  if (event.previous != null) descParts.push(`Previous: ${event.previous}`)
  if (event.forecast != null) descParts.push(`Forecast: ${event.forecast}`)
  if (event.actual != null) descParts.push(`Actual: ${event.actual}`)
  if (event.analysis) descParts.push(`\\n${event.analysis}`)

  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.id}@spectre-ai`,
    `DTSTAMP:${formatICSDate(new Date())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeICS(event.name)}`,
    `DESCRIPTION:${escapeICS(descParts.join('\\n'))}`,
    `CATEGORIES:${escapeICS(event.category || 'Economic')}`,
  ]

  // Add alarm 15 minutes before for critical/high events
  if (event.impact === 'critical' || event.impact === 'high') {
    lines.push(
      'BEGIN:VALARM',
      'TRIGGER:-PT15M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeICS(event.name)} in 15 minutes`,
      'END:VALARM'
    )
  }

  lines.push('END:VEVENT')
  return lines.join('\r\n')
}

/**
 * Generate a complete ICS calendar string from events array
 */
export function generateICS(events) {
  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Spectre AI//Economic Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Spectre Economic Calendar',
    'X-WR-TIMEZONE:America/New_York',
  ].join('\r\n')

  const vevents = events.map(buildVEvent).join('\r\n')

  return header + '\r\n' + vevents + '\r\nEND:VCALENDAR\r\n'
}

/**
 * Download ICS file to user's device
 */
export function downloadICS(events, filename = 'spectre-calendar.ics') {
  const icsContent = generateICS(events)
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()

  setTimeout(() => {
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, 100)
}
