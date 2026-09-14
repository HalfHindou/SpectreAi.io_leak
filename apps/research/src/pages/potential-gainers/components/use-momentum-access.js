/*
 * useMomentumAccess - single source of truth for Potential Gainers gating.
 *
 * The research app currently has NO paid-tier / subscription concept (AuthGate
 * is a team password, Privy is optional wallet identity). Until a real
 * entitlement signal exists, this hook returns a single `isPaid` boolean.
 *
 * TODO: wire `isPaid` to the real subscription state once it exists. The
 * cleanest future home is the Privy-synced server profile (profileSync.js /
 * useSettingsStore.profile) - e.g. `profile.plan === 'pro'`. When that lands,
 * replace the default below and delete the dev-unlock escape hatch.
 *
 * CURRENT STATE: the board is forced UNLOCKED for everyone (see
 * `isPaidFromSubscription` below) because no real paid-tier signal exists
 * yet - gating it now would just lock the whole team and reviewers out of a
 * surface that has no way to be unlocked. Flip it back to `false` the moment
 * a real subscription check is wired in.
 *
 * Dev / QA escape hatch: `?unlock=1` in the URL flips it to unlocked for
 * this tab only (sessionStorage), so the full board can be reviewed without
 * a real subscription. This is intentionally NOT a real entitlement - it is
 * a preview switch and should be removed when real gating is wired.
 */
import { useMemo } from 'react'

const PREVIEW_UNLOCK_KEY = 'pg-preview-unlock'

function readPreviewUnlock() {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('unlock') === '1') {
      window.sessionStorage.setItem(PREVIEW_UNLOCK_KEY, '1')
      return true
    }
    if (params.get('unlock') === '0') {
      window.sessionStorage.removeItem(PREVIEW_UNLOCK_KEY)
      return false
    }
    return window.sessionStorage.getItem(PREVIEW_UNLOCK_KEY) === '1'
  } catch {
    return false
  }
}

export function useMomentumAccess() {
  return useMemo(() => {
    // Real subscription state goes here. Forced `true` (unlocked) until a
    // real paid-tier signal exists - flip to `false` when gating is wired.
    const isPaidFromSubscription = true
    const previewUnlock = readPreviewUnlock()
    const isPaid = isPaidFromSubscription || previewUnlock
    return {
      isPaid,
      // True when the only reason the board is visible is the dev preview
      // switch - lets the UI show a subtle "preview mode" hint if wanted.
      isPreviewUnlock: previewUnlock && !isPaidFromSubscription,
    }
  }, [])
}

export default useMomentumAccess
