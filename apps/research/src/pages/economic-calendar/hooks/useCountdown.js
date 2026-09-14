import { useState, useEffect } from 'react'

function calcTimeLeft(target, now = Date.now()) {
  const diff = Math.max(0, new Date(target).getTime() - now)
  const totalSeconds = Math.floor(diff / 1000)
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
    totalSeconds,
    isExpired: diff <= 0,
    isUrgent: totalSeconds > 0 && totalSeconds < 3600,
    isCritical: totalSeconds > 0 && totalSeconds < 300,
  }
}

// Shared 1Hz clock — one setInterval for the entire page, no matter how many
// countdown timers mount. Auto-pauses when the tab is hidden.
const subscribers = new Set()
let intervalId = null
let visibilityBound = false

function tick() {
  if (typeof document !== 'undefined' && document.hidden) return
  const now = Date.now()
  subscribers.forEach((fn) => fn(now))
}

function ensureRunning() {
  if (intervalId != null) return
  intervalId = setInterval(tick, 1000)
  if (!visibilityBound && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) tick()
    })
    visibilityBound = true
  }
}

function subscribe(fn) {
  subscribers.add(fn)
  ensureRunning()
  return () => {
    subscribers.delete(fn)
    if (subscribers.size === 0 && intervalId != null) {
      clearInterval(intervalId)
      intervalId = null
    }
  }
}

export function useCountdown(targetDateTime) {
  const [timeLeft, setTimeLeft] = useState(() => calcTimeLeft(targetDateTime))

  useEffect(() => {
    if (!targetDateTime) return undefined
    setTimeLeft(calcTimeLeft(targetDateTime))
    return subscribe((now) => setTimeLeft(calcTimeLeft(targetDateTime, now)))
  }, [targetDateTime])

  return timeLeft
}

export default useCountdown
