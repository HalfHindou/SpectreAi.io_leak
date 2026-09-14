/**
 * useAlertsSeen - shared "unseen triggered alerts" watermark.
 *
 * One localStorage timestamp per device. A triggered record is unseen when its
 * triggeredAt is newer than the watermark. Extracted from MobileHomeShell so
 * the desktop header bell badge and the mobile Alerts tab badge are computed
 * from one definition and can never disagree.
 *
 * Mount this ONCE (App.jsx) and pass the result down - two instances would
 * hold separate React state and only one would re-render on markSeen().
 */

import { useState, useCallback, useMemo } from 'react'

// Pre-existing key - do not rename, it would reset every user's watermark
// and re-badge alerts they have already read.
const ALERTS_SEEN_KEY = 'spectre-alerts-seen-ts'

function readSeenTs() {
  try {
    return parseInt(localStorage.getItem(ALERTS_SEEN_KEY) || '0', 10) || 0
  } catch {
    return 0 // private mode / storage disabled
  }
}

export default function useAlertsSeen(triggered) {
  const [seenTs, setSeenTs] = useState(readSeenTs)

  const unseenCount = useMemo(() => (
    (Array.isArray(triggered) ? triggered : [])
      .filter(t => (t?.triggeredAt || 0) > seenTs)
      .length
  ), [triggered, seenTs])

  const markSeen = useCallback(() => {
    const now = Date.now()
    setSeenTs(now)
    try { localStorage.setItem(ALERTS_SEEN_KEY, String(now)) } catch { /* private mode */ }
  }, [])

  return { unseenCount, markSeen, seenTs }
}
