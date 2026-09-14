/**
 * useEventNotifications — Browser push notifications before critical events.
 * Schedules notifications at -15min and -5min before critical events.
 * Persists preferences to localStorage.
 */

import { useState, useEffect, useCallback, useRef } from 'react'

const STORAGE_KEY = 'spectre:calendar-notif-prefs'
const WARN_15_MS = 15 * 60 * 1000
const WARN_5_MS = 5 * 60 * 1000

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { enabled: false, dismissed: [] }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch { /* ignore */ }
}

export default function useEventNotifications(events = []) {
  const [enabled, setEnabled] = useState(() => loadPrefs().enabled)
  const timersRef = useRef([])
  const scheduledRef = useRef(new Set())

  const scheduledCount = useRef(0)
  const [count, setCount] = useState(0)

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return false
    if (Notification.permission === 'granted') {
      setEnabled(true)
      savePrefs({ ...loadPrefs(), enabled: true })
      return true
    }
    if (Notification.permission === 'denied') return false

    const result = await Notification.requestPermission()
    const granted = result === 'granted'
    setEnabled(granted)
    savePrefs({ ...loadPrefs(), enabled: granted })
    return granted
  }, [])

  const disable = useCallback(() => {
    setEnabled(false)
    savePrefs({ ...loadPrefs(), enabled: false })
    // Clear all scheduled timers
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    scheduledRef.current.clear()
    scheduledCount.current = 0
    setCount(0)
  }, [])

  // Schedule notifications for upcoming critical events
  useEffect(() => {
    if (!enabled || !('Notification' in window) || Notification.permission !== 'granted') return

    // Clear previous timers
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    scheduledRef.current.clear()
    scheduledCount.current = 0

    const now = Date.now()

    events.forEach((event) => {
      if (event.impact !== 'critical') return
      if (event.actual != null) return // Already released

      const eventTime = new Date(event.dateTime).getTime()
      if (eventTime <= now) return

      const deltas = [
        { ms: WARN_15_MS, label: '15 minutes' },
        { ms: WARN_5_MS, label: '5 minutes' },
      ]

      deltas.forEach(({ ms, label }) => {
        const fireAt = eventTime - ms
        const delay = fireAt - now
        if (delay <= 0 || delay > 24 * 60 * 60 * 1000) return // Skip past or >24h away

        const key = `${event.id}-${label}`
        if (scheduledRef.current.has(key)) return
        scheduledRef.current.add(key)
        scheduledCount.current++

        const timer = setTimeout(() => {
          try {
            const forecast = event.forecast ? ` — Forecast: ${event.forecast}` : ''
            new Notification(`${event.name} in ${label}`, {
              body: `${event.category} | ${event.country}${forecast}`,
              icon: '/spectre-icon.png',
              tag: key,
            })
          } catch { /* ignore */ }
        }, delay)

        timersRef.current.push(timer)
      })
    })

    setCount(scheduledCount.current)

    return () => {
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
    }
  }, [events, enabled])

  return {
    notificationsEnabled: enabled,
    requestPermission,
    disable,
    scheduledCount: count,
  }
}
