/**
 * useNow — a once-per-MINUTE `Date` tick, aligned to the minute boundary.
 *
 * Lifted out of Header.jsx so EnvironmentCapsule and any future
 * surface needing live wall-clock time can share the same interval.
 *
 * WHY A MINUTE, NOT A SECOND: the only consumer (EnvironmentCapsule)
 * renders `hour: 'numeric', minute: '2-digit'` - no seconds anywhere.
 * A 1s tick therefore re-rendered the Header subtree 60x per minute to
 * produce IDENTICAL output 59 of those times. Measured on prod at a
 * 440px viewport: a perfectly flat 1.0 React commit/sec on every screen
 * (gaps 1000/1000/999/1001ms) with ZERO DOM mutations - 100% waste, and
 * it never stopped because the Header is mounted app-wide. Worse on
 * phones: `.env-capsule` is `display: none` under 480px (Header.css),
 * so the component was re-rendering once a second to paint nothing at
 * all - CSS hiding does not stop React from rendering.
 *
 * Aligning to the minute boundary also makes the clock MORE correct
 * than the old 1s tick: it flips exactly when the user's OS clock does.
 *
 * If a future surface needs seconds precision, give it its own hook -
 * do NOT lower this interval back to 1s for a display that shows minutes.
 *
 * Pauses on tab hidden — no point updating a clock the user can't see.
 */

import { useEffect, useState } from 'react'

export default function useNow() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const MINUTE_MS = 60_000
    let id = 0
    const start = () => {
      // Align ticks to minute boundaries so the clock changes exactly
      // when the user expects (instead of drifting against their OS clock).
      const align = MINUTE_MS - (Date.now() % MINUTE_MS)
      const kick = setTimeout(() => {
        setNow(new Date())
        id = setInterval(() => setNow(new Date()), MINUTE_MS)
      }, align)
      return () => { clearTimeout(kick); if (id) clearInterval(id) }
    }
    const stop = () => { if (id) { clearInterval(id); id = 0 } }
    let cleanup = start()

    const onVis = () => {
      if (document.hidden) {
        cleanup?.()
        stop()
      } else {
        // Re-sync immediately on tab focus (might have drifted minutes)
        setNow(new Date())
        cleanup = start()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      cleanup?.()
      stop()
    }
  }, [])

  return now
}
