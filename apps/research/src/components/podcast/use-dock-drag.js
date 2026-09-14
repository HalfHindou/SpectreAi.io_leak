/**
 * useDockDrag — pick the floating player up and put it where you want it.
 *
 * The dock is a persistent overlay: whatever it covers, it covers for the whole
 * session. A fixed position is therefore a guess about which corner of the app
 * the user does not need, and it is wrong often enough that the player has to be
 * movable rather than merely well-placed.
 *
 * Contract:
 *  - `bind` goes on the DRAG HANDLE, not the card. Anything interactive inside
 *    the card keeps working because the handle never covers it.
 *  - `style` goes on the card. Until the user drags, it is empty and the card
 *    keeps whatever position CSS gave it — so the default placement stays a CSS
 *    decision and this hook only expresses the OVERRIDE.
 *  - `moved` is true once a gesture passes the slop threshold, so a caller can
 *    swallow the click that a drag would otherwise fire.
 *
 * 🪤 Position is stored as a distance from the nearest EDGES, not as left/top.
 * A card pinned 24px from the right edge of a 2560px monitor is off-screen on a
 * 1440px laptop if you replay the same left/top. Storing the offsets and
 * re-clamping on resize keeps it reachable on every screen the session touches.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const KEY = 'spectre-podcast-dock-pos-v1'
const SLOP = 4      // px of travel before a press becomes a drag
const MARGIN = 8    // never let the card sit flush against a viewport edge

function readStored() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (typeof v?.right !== 'number' || typeof v?.bottom !== 'number') return null
    return v
  } catch {
    return null // private mode, cleared storage, corrupt value — all mean "no preference"
  }
}

export default function useDockDrag({ enabled = true } = {}) {
  const cardRef = useRef(null)
  const [pos, setPos] = useState(() => readStored())
  const [dragging, setDragging] = useState(false)
  const movedRef = useRef(false)
  const originRef = useRef(null)

  /* Clamp into view on mount and on resize. A stored position from a wider
     monitor must not strand the player off-screen. */
  useEffect(() => {
    if (!enabled) return
    const clamp = () => {
      setPos(prev => {
        if (!prev) return prev
        const el = cardRef.current
        const w = el?.offsetWidth || 0
        const h = el?.offsetHeight || 0
        const maxRight = Math.max(MARGIN, window.innerWidth - w - MARGIN)
        const maxBottom = Math.max(MARGIN, window.innerHeight - h - MARGIN)
        const right = Math.min(Math.max(MARGIN, prev.right), maxRight)
        const bottom = Math.min(Math.max(MARGIN, prev.bottom), maxBottom)
        return right === prev.right && bottom === prev.bottom ? prev : { right, bottom }
      })
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [enabled])

  const onPointerDown = useCallback((e) => {
    if (!enabled) return
    // Controls keep their own pointer behaviour — except ones that opt in, so
    // the now-playing block can be both "open the player" and "grab here".
    const control = e.target.closest('button, a, input, [role="slider"]')
    if (control && !control.hasAttribute('data-drag-handle')) return
    if (e.button != null && e.button !== 0) return
    const el = cardRef.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    originRef.current = {
      x: e.clientX,
      y: e.clientY,
      right: window.innerWidth - rect.right,
      bottom: window.innerHeight - rect.bottom,
      w: rect.width,
      h: rect.height,
    }
    movedRef.current = false

    const move = (ev) => {
      const o = originRef.current
      if (!o) return
      const dx = ev.clientX - o.x
      const dy = ev.clientY - o.y
      if (!movedRef.current && Math.hypot(dx, dy) < SLOP) return
      if (!movedRef.current) { movedRef.current = true; setDragging(true) }
      // dragging right/down REDUCES the right/bottom offsets
      const maxRight = Math.max(MARGIN, window.innerWidth - o.w - MARGIN)
      const maxBottom = Math.max(MARGIN, window.innerHeight - o.h - MARGIN)
      setPos({
        right: Math.min(Math.max(MARGIN, o.right - dx), maxRight),
        bottom: Math.min(Math.max(MARGIN, o.bottom - dy), maxBottom),
      })
    }

    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      originRef.current = null
      setDragging(false)
      if (movedRef.current) {
        setPos(p => {
          try { if (p) localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* storage full or blocked */ }
          return p
        })
        // let the click that follows this pointerup be swallowed, then re-arm
        setTimeout(() => { movedRef.current = false }, 0)
      }
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }, [enabled])

  const reset = useCallback(() => {
    setPos(null)
    try { localStorage.removeItem(KEY) } catch { /* nothing to clear */ }
  }, [])

  /* Empty until the user has actually moved it — the CSS default stands. */
  const style = enabled && pos
    ? { right: `${pos.right}px`, bottom: `${pos.bottom}px`, left: 'auto', top: 'auto' }
    : undefined

  return {
    cardRef,
    style,
    dragging,
    moved: () => movedRef.current,
    reset,
    hasCustomPos: !!pos,
    bind: { onPointerDown },
  }
}
