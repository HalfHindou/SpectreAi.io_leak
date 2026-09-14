/**
 * useTouchScrub — finger-drag scrubbing for the hover-driven canvases.
 *
 * 🪤 The liquidation canvases only listened for `onMouseMove`, so on a phone the
 * crosshair could never follow the finger: mobile browsers synthesize a single
 * mouse event AFTER a tap ends and none at all during a drag. Tapping parked the
 * tooltip on one level and dragging did nothing — "не могу слайдить график".
 *
 * Two rules make the drag coexist with the page scroll:
 *  - the plot must carry `touch-action: pan-y` in CSS, so the browser keeps
 *    vertical scrolling and hands us the horizontal gesture. React attaches
 *    touchmove passively at the root, so preventDefault() is NOT an option.
 *  - the first ~8px of movement pick the axis. Horizontal-dominant = scrub;
 *    vertical-dominant = the user is scrolling the page, so drop the crosshair
 *    and stay out of the way for the rest of the gesture.
 *
 * The crosshair survives the lift (no clear on touchend): on touch there is no
 * hover, so the last placed position is what you read the numbers from.
 */
import { useCallback, useRef } from 'react'

const AXIS_LOCK_PX = 8

export default function useTouchScrub(onScrub, onCancel) {
  const gesture = useRef(null)

  const onTouchStart = useCallback((e) => {
    const t = e.touches[0]
    if (!t) return
    const r = e.currentTarget.getBoundingClientRect()
    gesture.current = { x0: t.clientX, y0: t.clientY, mode: 'undecided' }
    onScrub(t.clientX - r.left, t.clientY - r.top)
  }, [onScrub])

  const onTouchMove = useCallback((e) => {
    const g = gesture.current
    const t = e.touches[0]
    if (!g || !t || g.mode === 'scroll') return
    if (g.mode === 'undecided') {
      const dx = Math.abs(t.clientX - g.x0), dy = Math.abs(t.clientY - g.y0)
      if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return
      if (dy > dx) { g.mode = 'scroll'; onCancel?.(); return }
      g.mode = 'scrub'
    }
    const r = e.currentTarget.getBoundingClientRect()
    onScrub(t.clientX - r.left, t.clientY - r.top)
  }, [onScrub, onCancel])

  const onTouchEnd = useCallback(() => { gesture.current = null }, [])

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd }
}
