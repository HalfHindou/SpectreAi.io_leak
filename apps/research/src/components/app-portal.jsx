import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import './app-portal.css'

/**
 * AppPortal — render a full-viewport overlay on <body>, with the app's theme
 * classes intact.
 * ─────────────────────────────────────────────────────────────────────────
 * WHY overlays have to leave the page tree at all. Two ancestors sit between
 * every routed page and the viewport, and each one breaks a different half of
 * `position: fixed`:
 *
 * 1. `.page-layout` used to carry `transform: translateZ(0)`, which made it the
 *    containing block — an `inset: 0` scrim resolved to the page column, not
 *    the viewport. That transform is gone (page-layout.css, 2026-08-27), so
 *    geometry is fixed for everyone.
 * 2. `.app-main-content` is `position: relative; z-index: 1` — a STACKING
 *    CONTEXT. Nothing rendered inside a page can ever paint above the header
 *    (`--z-header: 300`) or the nav sidebar (101), however big its own z-index
 *    is. Measured on /watchlists: the Manage List scrim covered the sidebar
 *    geometrically and still painted under it. A stacking context cannot be
 *    escaped by out-bidding it; the element has to leave.
 *
 * WHY the class carrier. Every theme rule in this app is scoped `.app…`
 * (`.app.app-day-mode .x`, `.app.pro-paper .x`, cinema/PWA/Telegram variants).
 * A bare `createPortal(node, document.body)` drops out of `.app` and silently
 * loses all of them — the overlay renders in dark colours on a day-mode page.
 * So we wrap in a box-less carrier (`display: contents`, so <body> gains no
 * second full-height layout block) that mirrors the live class list off the
 * real `.app` element.
 *
 * 🪤 MIRROR the classes, never recompute them. `appClassName` in app-shell.jsx
 * is a nine-flag template string that grows; a hand-copied subset (the pattern
 * rz-quick-switcher.jsx still uses) drifts the moment a flag is added. Reading
 * `.app`'s className and watching it with a MutationObserver stays correct for
 * free, including a day-mode toggle while the overlay is open.
 *
 * @param {React.ReactNode} children the overlay content (keep `position: fixed`
 *   on your own root, and give it a z-index above `--z-nav` / 400)
 * @param {string} [className] extra classes for the carrier itself
 */
export default function AppPortal({ children, className = '' }) {
  const [appClass, setAppClass] = useState('app')

  useEffect(() => {
    const app = document.querySelector('.app')
    if (!app) return undefined
    setAppClass(app.className)
    const obs = new MutationObserver(() => setAppClass(app.className))
    obs.observe(app, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className={`app-portal-root ${appClass} ${className}`.trim()}>{children}</div>,
    document.body,
  )
}
