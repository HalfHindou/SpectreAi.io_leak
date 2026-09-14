/**
 * useBackDismiss — make the phone's BACK gesture close an overlay instead of
 * leaving the app.
 *
 * 🪤🪤 Nothing in this app listened for `popstate` (verified 2026-08-08: zero
 * hits repo-wide), so every sheet, drawer and modal was dismissed by the only
 * thing Android's back gesture actually does — a history pop. A user on a
 * Samsung with gesture navigation reported it exactly: open Mission Control,
 * swipe back, and the whole app closes with the sheet still open behind it.
 * On an installed PWA the app is simply gone. The overlay was un-dismissable
 * by the one control every Android user reaches for first.
 *
 * While an overlay is open we own a history entry. Back pops it, we close the
 * overlay, and the app never moves.
 *
 * 🪤 THE VERSION THAT CALLED `history.back()` IN CLEANUP WAS WRONG — do not
 * reintroduce it. It looks right (pop our entry when the user closes via the
 * scrim so their next back press isn't eaten) and it is not:
 *   - StrictMode mounts, cleans up and re-mounts every effect in development,
 *     so the cleanup fired on OPEN. Measured sequence was
 *     `push → back() → push → popstate {idx:0}` — that `idx` is React Router's
 *     state, i.e. the back() had already popped PAST our entry into the app's
 *     own history and walked the user backwards out of the app.
 *   - `history.back()` is async, so a push that lands before it resolves makes
 *     the pop hit whatever entry happens to be current. No token check fixes a
 *     race; the only fix is not to call it.
 * So: we never navigate. Instead the push is idempotent — if the current entry
 * is already ours, opening another overlay does not stack a second one. A UI
 * close leaves that single entry behind, which costs at most ONE absorbed back
 * press, and it can never accumulate or move the app.
 *
 * `pushState(state, '')` with NO url keeps the current URL, so React Router
 * sees no location change and nothing re-renders. It also slips past the
 * showcase-lock patch in App.jsx, which only inspects a url argument.
 *
 * @param {boolean} open      whether the overlay is currently showing
 * @param {Function} onClose  called when the user presses back
 */
import { useEffect, useRef } from 'react'

const MARK = '__spectreOverlay'

export default function useBackDismiss(open, onClose) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined

    // Idempotent: one overlay entry at a time, never a stack of them.
    if (!window.history.state?.[MARK]) {
      window.history.pushState({ ...(window.history.state || {}), [MARK]: 1 }, '')
    }

    const onPop = () => closeRef.current?.()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [open])
}
