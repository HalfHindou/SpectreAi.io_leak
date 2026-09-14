/**
 * useIsMobile — matchMedia-backed responsive flag.
 *
 * Returns true when the viewport is at or below the mobile breakpoint
 * (default 768px, matching the mobile-crypto-ux skill rules).
 *
 * SSR-safe: initial state returns false when `window` is undefined.
 *
 * Why a hook vs CSS media queries: the mobile-crypto-ux rules forbid
 * `display: none` toggles between desktop and mobile DOM trees. The
 * page must render a different component tree on mobile, not a CSS-
 * hidden duplicate. Use this hook to early-return mobile JSX from
 * page components.
 */
import { useState, useEffect } from 'react'

/* A phone turned sideways is still a phone: 932x430 clears the 768px
   width test, which used to swap the whole mobile tree for the desktop
   3-panel layout mid-session (and threw the user out of the fullscreen
   chart). The second clause keeps touch devices with a short viewport
   on the mobile tree; a tablet in landscape (>=768px tall) and any
   mouse-driven window are unaffected. */
export const MOBILE_MEDIA_QUERY = '(max-width: 768px), (max-height: 540px) and (pointer: coarse)'

const DEFAULT_QUERY = MOBILE_MEDIA_QUERY

export function useIsMobile(query = DEFAULT_QUERY) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const onChange = (e) => setIsMobile(e.matches)
    // Set on mount in case it changed between render and effect.
    setIsMobile(mql.matches)
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else mql.addListener(onChange)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange)
      else mql.removeListener(onChange)
    }
  }, [query])

  return isMobile
}

export default useIsMobile
