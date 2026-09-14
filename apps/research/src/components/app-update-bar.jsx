/**
 * "A new version is ready" — the visible half of the update flow.
 *
 * The service worker already installs a new build on its own and reloads the
 * page the next time the app is backgrounded. That silent path is good: nobody
 * wants a view yanked away mid-read. What it could not handle is somebody who
 * simply keeps the app open — they run old code indefinitely, ask why a shipped
 * change is missing, and then, when they finally do background it, come back to
 * a page that reloaded behind them and lost their place.
 *
 * So the swap becomes an offer instead of a surprise: one quiet bar, one tap to
 * take it, one tap to dismiss. Dismissing is not a refusal — the silent
 * background reload still applies — it just stops the bar nagging.
 *
 * Deliberately not a modal, not a full-width banner, and never over the bottom
 * nav: an update is the least urgent thing on screen and must not cover a
 * control or block a read.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import './app-update-bar.css'

const DISMISS_KEY = 'spectre-update-dismissed-until'
/** A dismissal lasts the session, not forever — the next deploy asks again. */
const QUIET_MS = 6 * 60 * 60 * 1000

export default function AppUpdateBar() {
  const [state, setState] = useState('idle') // idle | offered | applying
  const timerRef = useRef(0)

  useEffect(() => {
    const onReady = () => {
      try {
        const until = Number(sessionStorage.getItem(DISMISS_KEY) || 0)
        if (until && Date.now() < until) return
      } catch (_) { /* private mode — just show it */ }
      // A beat before appearing: arriving in the same frame as the swap makes
      // it read as an error toast rather than an offer.
      timerRef.current = setTimeout(() => setState('offered'), 900)
    }
    window.addEventListener('spectre:update-ready', onReady)
    return () => {
      window.removeEventListener('spectre:update-ready', onReady)
      clearTimeout(timerRef.current)
    }
  }, [])

  const apply = useCallback(() => {
    setState('applying')
    // The new worker is already in control (skipWaiting + clientsClaim), so a
    // plain reload is enough to pick up the new shell.
    window.location.reload()
  }, [])

  const dismiss = useCallback(() => {
    try { sessionStorage.setItem(DISMISS_KEY, String(Date.now() + QUIET_MS)) } catch (_) { /* noop */ }
    setState('idle')
  }, [])

  if (state === 'idle') return null

  return (
    <div className="aub" role="status" aria-live="polite">
      <div className="aub__inner">
        <span className="aub__dot" aria-hidden="true" />
        <span className="aub__text">
          {state === 'applying' ? 'Updating…' : 'A new version is ready'}
        </span>
        <button
          type="button"
          className="aub__action"
          onClick={apply}
          disabled={state === 'applying'}
        >
          Refresh
        </button>
        <button
          type="button"
          className="aub__close"
          onClick={dismiss}
          aria-label="Dismiss update notice"
          disabled={state === 'applying'}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
            strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
