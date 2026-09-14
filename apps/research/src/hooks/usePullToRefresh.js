/**
 * usePullToRefresh - iOS-style pull-to-refresh for mobile scroll containers.
 *
 * Detects vertical pull-down gesture when the scroll parent is at the top,
 * shows a pull indicator, and calls an async onRefresh callback.
 *
 * The hook attaches touch handlers to the container element but checks
 * scrollTop on the nearest scroll ancestor (the element with overflow-y:auto).
 * On Spectre mobile, .app is the scroll container, not the page content div.
 *
 * Uses CSS touch-action toggling (not preventDefault) to avoid passive
 * listener violations in React. Direction is locked after a 15px dead zone.
 *
 * Usage:
 *   const { pullState, pullDistance, containerProps } = usePullToRefresh({
 *     onRefresh: async () => { await refetchData() },
 *   })
 *   return (
 *     <div {...containerProps} className="my-content">
 *       {pullState !== 'idle' && <PullIndicator ... />}
 *       ...
 *     </div>
 *   )
 */
import { useState, useRef, useCallback, useEffect } from 'react'

const DEAD_ZONE = 15        // px before committing direction
const DEFAULT_THRESHOLD = 64 // px to trigger refresh
const MAX_PULL = 120         // max visual pull distance (rubber-band cap)
const RUBBER_BAND = 0.4      // resistance factor past threshold

/**
 * Walk up the DOM to find the nearest scroll ancestor.
 * Returns the element whose overflow-y is 'auto' or 'scroll'.
 */
function findScrollParent(el) {
  let node = el?.parentElement
  while (node && node !== document.documentElement) {
    const style = getComputedStyle(node)
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
      return node
    }
    node = node.parentElement
  }
  return document.documentElement
}

export default function usePullToRefresh({
  onRefresh,
  threshold = DEFAULT_THRESHOLD,
  enabled = true,
} = {}) {
  // 'idle' | 'pulling' | 'threshold' | 'refreshing'
  const [pullState, setPullState] = useState('idle')
  const [pullDistance, setPullDistance] = useState(0)

  const startY = useRef(0)
  const startX = useRef(0)
  const directionLocked = useRef(null)
  const isActive = useRef(false)
  const containerRef = useRef(null)
  const scrollParentRef = useRef(null)
  const currentDistance = useRef(0)
  const pullStateRef = useRef('idle')
  // Set true when a gesture begins inside an interactive chart, so a chart
  // pan/pinch (which the chart consumes via Pointer events, but whose Touch
  // stream still bubbles up here) never starts a pull-to-refresh.
  const suppressedRef = useRef(false)

  const onTouchStart = useCallback((e) => {
    if (!enabled) return
    if (pullStateRef.current === 'refreshing') return

    const el = containerRef.current
    if (!el) return

    // Ignore gestures that start on the chart (canvas pan/pinch-zoom).
    if (e.target?.closest?.('.trading-chart, .rzm-chart-wrap, .chart-content-area, .chart-body')) {
      suppressedRef.current = true
      return
    }
    suppressedRef.current = false

    // Find scroll parent on first touch
    if (!scrollParentRef.current) {
      scrollParentRef.current = findScrollParent(el)
    }

    // Only activate if scroll parent is at the top
    const scroller = scrollParentRef.current
    if (scroller.scrollTop > 0) return

    startY.current = e.touches[0].clientY
    startX.current = e.touches[0].clientX
    directionLocked.current = null
    isActive.current = false
    currentDistance.current = 0
  }, [enabled])

  const onTouchMove = useCallback((e) => {
    if (!enabled) return
    if (suppressedRef.current) return // gesture began on the chart
    if (pullStateRef.current === 'refreshing') return

    const el = containerRef.current
    if (!el) return

    const scroller = scrollParentRef.current
    if (!scroller) return

    const deltaY = e.touches[0].clientY - startY.current
    const deltaX = e.touches[0].clientX - startX.current

    // Lock direction after dead zone
    if (directionLocked.current === null) {
      if (Math.abs(deltaX) > DEAD_ZONE) {
        directionLocked.current = 'horizontal'
        isActive.current = false
        return
      }
      if (deltaY > DEAD_ZONE && scroller.scrollTop <= 0) {
        directionLocked.current = 'vertical'
        isActive.current = true
      } else if (Math.abs(deltaY) > DEAD_ZONE) {
        directionLocked.current = 'scroll'
        isActive.current = false
        return
      } else {
        return
      }
    }

    if (!isActive.current) return

    // Prevent browser from scrolling while pulling
    if (el) {
      el.style.touchAction = 'none'
    }

    // Calculate pull distance with rubber-band resistance
    let distance = deltaY
    if (distance > threshold) {
      distance = threshold + (distance - threshold) * RUBBER_BAND
    }
    distance = Math.min(distance, MAX_PULL)
    distance = Math.max(0, distance)

    currentDistance.current = distance
    setPullDistance(distance)
    const newState = distance >= threshold ? 'threshold' : 'pulling'
    pullStateRef.current = newState
    setPullState(newState)
  }, [enabled, threshold])

  const onTouchEnd = useCallback(async () => {
    // Restore touch-action
    const el = containerRef.current
    if (el) {
      el.style.touchAction = ''
    }

    if (!isActive.current) return
    isActive.current = false
    directionLocked.current = null

    const distance = currentDistance.current

    if (distance >= threshold && onRefresh) {
      pullStateRef.current = 'refreshing'
      setPullState('refreshing')
      setPullDistance(threshold * 0.6)
      try {
        await onRefresh()
      } catch (_) {
        // silently handled
      }
      pullStateRef.current = 'idle'
      setPullState('idle')
      setPullDistance(0)
    } else {
      pullStateRef.current = 'idle'
      setPullState('idle')
      setPullDistance(0)
    }
    currentDistance.current = 0
  }, [threshold, onRefresh])

  // 🪤 A pull sets `touch-action: none` ON THE PAGE CONTAINER and only
  // `touchend` took it off. iOS ends a sequence with `touchcancel` whenever the
  // system takes the gesture over (an incoming call, the edge-swipe, a
  // scroll handed to the compositor) — and then the style stuck, leaving the
  // whole page unscrollable by touch until something happened to re-render it.
  // That is the intermittent half of the founder's "i cant scroll at times".
  // Cancel now unwinds exactly like end, and the effect below is the backstop:
  // whenever no pull is in flight, the container may not be holding the style.
  const onTouchCancel = useCallback(() => {
    const el = containerRef.current
    if (el) el.style.touchAction = ''
    isActive.current = false
    directionLocked.current = null
    currentDistance.current = 0
    pullStateRef.current = 'idle'
    setPullState('idle')
    setPullDistance(0)
  }, [])

  useEffect(() => {
    if (pullState !== 'idle') return undefined
    const el = containerRef.current
    if (el && el.style.touchAction) el.style.touchAction = ''
    return () => { if (el) el.style.touchAction = '' }
  }, [pullState])

  const containerProps = {
    ref: containerRef,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  }

  return { pullState, pullDistance, containerProps }
}
