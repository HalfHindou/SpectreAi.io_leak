/**
 * MobileSideRail — edge-handle action tab hugging the left screen edge.
 *
 *   ▏▦   ← open the Markets drawer (token discovery)
 *
 * A single tab: token Info is now a bottom-nav view, so the rail is just the
 * Markets entry. Flush to the left edge, rounded on the right only, like a
 * handle built into the screen. No grip: hold-and-drag anywhere to move it
 * up/down (position persists as a 0..1 fraction of the usable track); a tap
 * opens. Portals to <body> so the TradingView iframe's stacking context
 * can't paint over it.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './MobileSideRail.css'

const STORE_KEY = 'spectre-mobile-siderail-frac'
const TOP_INSET = 64    // clear the global header
const TOP_ZONE = 0.45   // keep the rail in the lower half of the viewport
// Clear the two-bar bottom dock (Buy/Sell + view-nav ≈ 109px, --mtp-dock-h)
// plus safe-area headroom. Kept in sync with --mtp-dock-h in design-tokens.css.
const BOTTOM_INSET = 132
const MARGIN = 8
const DRAG_THRESHOLD = 6 // px before a press becomes a drag (vs a tap)

const clamp01 = (v) => Math.min(1, Math.max(0, v))
const readFrac = () => {
  try {
    const v = parseFloat(localStorage.getItem(STORE_KEY))
    return Number.isFinite(v) ? clamp01(v) : 0.5
  } catch { return 0.5 }
}

export default function MobileSideRail({ onOpenDrawer }) {
  const railRef = useRef(null)
  const topRef = useRef(null)
  const draggedRef = useRef(false) // set true on a real drag so the trailing click is swallowed
  const cleanupRef = useRef(null)
  const [topPx, setTopPx] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [pressed, setPressed] = useState(false) // reveal the glass while touched

  const setTop = useCallback((v) => { topRef.current = v; setTopPx(v) }, [])

  const bounds = useCallback(() => {
    const railH = railRef.current?.offsetHeight || 96
    const maxTop = Math.max(TOP_INSET, window.innerHeight - BOTTOM_INSET - railH - MARGIN)
    const minTop = Math.min(maxTop, Math.max(TOP_INSET, Math.round(window.innerHeight * TOP_ZONE)))
    return { minTop, maxTop }
  }, [])

  // Position from the stored fraction on mount + on resize.
  useLayoutEffect(() => {
    const apply = () => {
      const { minTop, maxTop } = bounds()
      setTop(minTop + readFrac() * (maxTop - minTop))
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [bounds, setTop])

  // Press anywhere on the rail: distinguish tap from drag by movement.
  const onPointerDown = useCallback((e) => {
    if (e.button != null && e.button !== 0) return
    draggedRef.current = false
    setPressed(true)
    const railTop = railRef.current?.getBoundingClientRect().top ?? e.clientY
    const grabOffset = e.clientY - railTop
    const startY = e.clientY
    let moved = false

    const onMove = (ev) => {
      if (!moved && Math.abs(ev.clientY - startY) > DRAG_THRESHOLD) {
        moved = true
        setDragging(true)
      }
      if (moved) {
        const { minTop, maxTop } = bounds()
        setTop(Math.min(maxTop, Math.max(minTop, ev.clientY - grabOffset)))
      }
    }
    const finish = () => {
      setPressed(false)
      if (moved) {
        draggedRef.current = true
        const { minTop, maxTop } = bounds()
        const f = maxTop > minTop ? (topRef.current - minTop) / (maxTop - minTop) : 0.5
        try { localStorage.setItem(STORE_KEY, String(clamp01(f))) } catch {}
        setDragging(false)
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      cleanupRef.current = null
    }
    cleanupRef.current = finish
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }, [bounds, setTop])

  // Detach any active drag listeners if we unmount mid-drag.
  useEffect(() => () => cleanupRef.current?.(), [])

  // Tap handler — no-op if the press was actually a drag.
  const onTap = useCallback((fn) => () => {
    if (draggedRef.current) { draggedRef.current = false; return }
    fn?.()
  }, [])

  return createPortal(
    <div
      ref={railRef}
      className={`msr ${pressed ? 'msr--active' : ''} ${dragging ? 'msr--dragging' : ''}`}
      style={topPx != null ? { top: `${topPx}px` } : undefined}
      onPointerDown={onPointerDown}
      role="toolbar"
      aria-label="Token quick actions"
    >
      <button
        type="button"
        className="msr-tab"
        onClick={onTap(onOpenDrawer)}
        aria-label="Open markets"
      >
        <span className="msr-tab-label">Markets</span>
      </button>
    </div>,
    document.body
  )
}
