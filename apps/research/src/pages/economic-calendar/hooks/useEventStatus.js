/**
 * Event Status Hook
 * Determines the current status of an economic event based on time and data.
 * Statuses: 'released' | 'live' | 'passed' | 'upcoming'
 */

import { isReleased } from '../utils/eventResult'

export function getEventStatus(event) {
  if (!event) return 'upcoming'
  // Shares ONE definition of "printed" with the result colouring — a
  // placeholder zero on a scheduled event is not a release (see isReleased).
  if (isReleased(event)) return 'released'

  const now = Date.now()
  const eventTime = new Date(event.dateTime).getTime()
  const diff = eventTime - now

  // Within +/- 5 minutes of event time
  if (Math.abs(diff) < 5 * 60 * 1000) return 'live'

  // More than 1 hour in the past with no actual value
  if (diff < -60 * 60 * 1000) return 'passed'

  return 'upcoming'
}

export default function useEventStatus(event) {
  return getEventStatus(event)
}
