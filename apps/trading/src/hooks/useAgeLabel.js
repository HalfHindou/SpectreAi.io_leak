import { useEffect, useState } from 'react'

/**
 * A self-ticking relative-time label ("12s ago") for memoised rows.
 *
 * The transactions tape memoises its rows on the trade object, so a
 * component-level "re-render every second" tick never reached the age cells:
 * React handed the <tbody> the same row elements and skipped it, and the ages
 * only moved when a new trade (or a price tick) happened to rebuild the rows.
 * On a quiet tape the column simply froze.
 *
 * One 1s interval is shared by every label on screen. Each label re-renders
 * only when its own text changes (setState bails on an equal string), so a
 * 150-row tape costs 150 string compares a second, not 150 row renders, and
 * the memoised rows around it are never touched. Paused while the tab is
 * hidden; the first tick after it returns catches every label up.
 */
const subscribers = new Set()
let timer = null

function tick() {
  if (typeof document !== 'undefined' && document.hidden) return
  for (const fn of subscribers) fn()
}

function subscribe(fn) {
  subscribers.add(fn)
  if (!timer) timer = setInterval(tick, 1000)
  return () => {
    subscribers.delete(fn)
    if (subscribers.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

export default function useAgeLabel(timestamp, format, enabled = true) {
  const [label, setLabel] = useState(() => format(timestamp))
  useEffect(() => {
    setLabel(format(timestamp))
    if (!enabled) return undefined
    return subscribe(() => {
      setLabel((prev) => {
        const next = format(timestamp)
        return next === prev ? prev : next
      })
    })
  }, [timestamp, format, enabled])
  return label
}
