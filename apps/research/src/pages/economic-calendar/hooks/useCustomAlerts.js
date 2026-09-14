/**
 * useCustomAlerts — Custom alert conditions with browser notifications.
 * localStorage persistence: spectre:calendar-custom-alerts
 */

import { useState, useCallback, useEffect, useRef } from 'react'

const STORAGE_KEY = 'spectre:calendar-custom-alerts'

function loadAlerts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveAlerts(alerts) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts))
  } catch { /* ignore */ }
}

let alertIdCounter = Date.now()

export default function useCustomAlerts(events = []) {
  const [alerts, setAlerts] = useState(loadAlerts)
  const firedRef = useRef(new Set())

  const addAlert = useCallback(({ eventName, operator, threshold, method = 'notification' }) => {
    const newAlert = {
      id: String(alertIdCounter++),
      eventName,
      operator, // '>' | '<' | '='
      threshold: Number(threshold),
      method,
      createdAt: new Date().toISOString(),
      active: true,
    }
    setAlerts(prev => {
      const next = [...prev, newAlert]
      saveAlerts(next)
      return next
    })
  }, [])

  const removeAlert = useCallback((id) => {
    setAlerts(prev => {
      const next = prev.filter(a => a.id !== id)
      saveAlerts(next)
      return next
    })
  }, [])

  const toggleAlert = useCallback((id) => {
    setAlerts(prev => {
      const next = prev.map(a => a.id === id ? { ...a, active: !a.active } : a)
      saveAlerts(next)
      return next
    })
  }, [])

  // Evaluate alerts against current events
  useEffect(() => {
    if (alerts.length === 0 || events.length === 0) return

    for (const alert of alerts) {
      if (!alert.active) continue
      if (firedRef.current.has(alert.id)) continue

      const matchingEvent = events.find(e =>
        e.name.toLowerCase().includes(alert.eventName.toLowerCase()) &&
        e.actual != null
      )
      if (!matchingEvent) continue

      let triggered = false
      const actual = matchingEvent.actual
      if (alert.operator === '>' && actual > alert.threshold) triggered = true
      if (alert.operator === '<' && actual < alert.threshold) triggered = true
      if (alert.operator === '=' && Math.abs(actual - alert.threshold) < 0.01) triggered = true

      if (triggered) {
        firedRef.current.add(alert.id)

        if (alert.method === 'notification' && 'Notification' in window && Notification.permission === 'granted') {
          new Notification(`Spectre Alert: ${matchingEvent.name}`, {
            body: `Actual ${actual} ${alert.operator} ${alert.threshold} triggered`,
            icon: '/favicon.ico',
          })
        }
      }
    }
  }, [alerts, events])

  return {
    alerts,
    addAlert,
    removeAlert,
    toggleAlert,
    activeCount: alerts.filter(a => a.active).length,
  }
}
