import { useState, useEffect, useCallback, useRef } from 'react'

import escapeContainingBlocks from '@/lib/escape-containing-block'

/**
 * useChartFullscreen — one fullscreen mechanism for every chart on this page.
 *
 * Browser Fullscreen API first, CSS-fixed overlay as the fallback: on iOS Safari
 * requestFullscreen is a no-op on non-video elements, and installed PWAs reject
 * it outright. Both paths end up flipping the same `isFullscreen` flag, so the
 * caller only ever deals with one boolean.
 *
 * Usage: put `ref` on the element to blow up, `isFullscreen` on its class, and
 * `toggle` on the button.
 */
export default function useChartFullscreen() {
  const ref = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [cssFullscreen, setCssFullscreen] = useState(false)

  const toggle = useCallback(() => {
    const el = ref.current
    if (!el) return
    // Already in CSS fullscreen? exit it.
    if (cssFullscreen) { setCssFullscreen(false); return }
    // Exit only if WE are the fullscreen element — this used to test the global
    // `document.fullscreenElement`, so with any other element fullscreen the
    // button would close that one instead of opening ours.
    if (document.fullscreenElement === el) { document.exitFullscreen?.().catch(() => {}); return }
    if (typeof el.requestFullscreen !== 'function') { setCssFullscreen(true); return }
    const req = el.requestFullscreen()
    if (req && typeof req.catch === 'function') {
      req.catch(() => { setCssFullscreen(true) })
    }
  }, [cssFullscreen])

  useEffect(() => {
    // Scoped to OUR element: every chart on the page mounts its own copy of this
    // hook, and a global `!!document.fullscreenElement` made all of them flag
    // themselves fullscreen the moment any one of them opened.
    const mine = () => !!ref.current && document.fullscreenElement === ref.current
    const onChange = () => setIsFullscreen(mine() || cssFullscreen)
    document.addEventListener('fullscreenchange', onChange)
    setIsFullscreen(mine() || cssFullscreen)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [cssFullscreen])

  // Scroll lock + Escape + the containing-block unwind are only ours in the
  // CSS-fallback path; the browser Fullscreen API promotes the element to the
  // top layer and owns all three itself.
  useEffect(() => {
    if (!cssFullscreen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') setCssFullscreen(false) }
    document.addEventListener('keydown', onKey)

    // The containing-block + stacking-context unwind is shared with the
    // Research Zone agent chat's pop-out window — see the module for the
    // measurements behind every line of it.
    const restoreAncestors = escapeContainingBlocks(ref.current)

    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
      restoreAncestors()
    }
  }, [cssFullscreen])

  return { ref, isFullscreen, toggle }
}
