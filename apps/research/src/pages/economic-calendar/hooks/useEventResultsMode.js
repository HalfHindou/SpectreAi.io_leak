import { useState, useEffect, useCallback, useRef } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'

const RESET_HOUR = 5 // 5 AM local time

export default function useEventResultsMode(events, nextCriticalEvent) {
  const [mode, setMode] = useState('countdown') // 'countdown' | 'results'
  const [releasedEvents, setReleasedEvents] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [brief, setBrief] = useState(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const fetchedBriefs = useRef({})

  // Detect released critical/high events since last 5 AM reset
  useEffect(() => {
    const now = new Date()
    const resetTime = new Date(now)
    resetTime.setHours(RESET_HOUR, 0, 0, 0)
    // If we're before 5 AM, the reset boundary is yesterday's 5 AM
    if (now.getHours() < RESET_HOUR) {
      resetTime.setDate(resetTime.getDate() - 1)
    }

    const released = events
      .filter(e => {
        if (!e.actual) return false
        if (e.impact !== 'critical' && e.impact !== 'high') return false
        const eventTime = new Date(e.dateTime)
        return eventTime >= resetTime && eventTime <= now
      })
      .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime))

    if (released.length > 0) {
      setMode('results')
      setReleasedEvents(released)
      setCurrentIndex(0)
    } else {
      setMode('countdown')
      setReleasedEvents([])
      setCurrentIndex(0)
      setBrief(null)
    }
  }, [events])

  // Fetch AI brief for the currently displayed result event
  const currentEvent = mode === 'results' ? releasedEvents[currentIndex] : null

  useEffect(() => {
    if (!currentEvent) {
      setBrief(null)
      return
    }

    const cacheKey = `${currentEvent.name}-${currentEvent.actual}`
    if (fetchedBriefs.current[cacheKey]) {
      setBrief(fetchedBriefs.current[cacheKey])
      return
    }
    let cancelled = false
    setBriefLoading(true)
    const params = new URLSearchParams({ name: currentEvent.name, actual: String(currentEvent.actual) })
    if (currentEvent.forecast) params.set('forecast', String(currentEvent.forecast))
    if (currentEvent.previous) params.set('previous', String(currentEvent.previous))
    if (currentEvent.country) params.set('country', currentEvent.country)
    if (currentEvent.category) params.set('category', currentEvent.category)

    fetch(`/api/calendar/event-brief?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled && data?.brief) {
          fetchedBriefs.current[cacheKey] = data
          setBrief(data)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setBriefLoading(false) })

    return () => { cancelled = true }
  }, [currentEvent])

  // Check for 5 AM reset
  const checkReset = useCallback(() => {
    const now = new Date()
    const todayReset = new Date(now)
    todayReset.setHours(RESET_HOUR, 0, 0, 0)
    if (now >= todayReset) {
      // Check if all released events are from before today's reset
      const allBeforeReset = releasedEvents.every(e => new Date(e.dateTime) < todayReset)
      if (allBeforeReset) {
        setMode('countdown')
        setReleasedEvents([])
        setCurrentIndex(0)
        setBrief(null)
      }
    }
  }, [releasedEvents])

  useAdaptivePolling(checkReset, { interval: 60000, enabled: mode === 'results' })

  const goBack = useCallback(() => {
    setCurrentIndex(i => Math.min(i + 1, releasedEvents.length - 1))
  }, [releasedEvents.length])

  const goForward = useCallback(() => {
    setCurrentIndex(i => Math.max(i - 1, 0))
  }, [])

  return {
    mode,
    // Results mode data
    resultEvent: currentEvent,
    brief,
    briefLoading,
    releasedEvents,
    currentIndex,
    goBack,
    goForward,
    hasBack: currentIndex < releasedEvents.length - 1,
    hasForward: currentIndex > 0,
    totalResults: releasedEvents.length,
    // Countdown mode data
    countdownEvent: nextCriticalEvent,
  }
}
