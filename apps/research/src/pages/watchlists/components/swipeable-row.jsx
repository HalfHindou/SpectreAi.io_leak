/**
 * SwipeableRow - swipe-to-reveal actions, iOS Mail model.
 *
 * 🪤 Two bugs made this feel broken and look cheap (founder, 08-03: "sliders
 * either dont work or not UX fluent and just look ugly no premium"):
 *
 *   1. The snap distance was HARDCODED at 72px per action while the rail's real
 *      width comes from CSS — the watchlist overrides it to 64px. The content
 *      therefore came to rest 8px past the rail and the container showed
 *      through as a grey band between the button and the row. The rail is now
 *      MEASURED, so the row always lands exactly on its edge whatever the CSS
 *      says.
 *   2. `.dragging` revealed BOTH rails, so a swipe in either direction lit up
 *      Unpin AND Delete at once. Reveal is now scoped to the direction of
 *      travel.
 *
 * Also: pointer events (so a trackpad drag works), rubber-band past the rail
 * instead of a hard stop, and transform written inside rAF rather than per
 * event, because these rows sit in a live-price list that re-renders often.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react'
import './swipeable-row.css'

const SwipeableRow = ({
  children,
  leftActions = [], // [{icon, label, color, onClick}]
  rightActions = [], // [{icon, label, color, onClick}]
  onSwipeStart,
  onSwipeEnd,
  className = '',
}) => {
  const rowRef = useRef(null)
  const contentRef = useRef(null)
  const leftRailRef = useRef(null)
  const rightRailRef = useRef(null)
  const drag = useRef({ active: false, startX: 0, startY: 0, offset: 0, base: 0, axis: null, frame: 0, t0: 0 })
  const [revealed, setRevealed] = useState(null) // 'left' | 'right' | null

  // The rail's rendered width IS the snap point. Measured, never assumed.
  const railWidth = (side) => {
    const el = side === 'left' ? leftRailRef.current : rightRailRef.current
    return el ? el.getBoundingClientRect().width : 0
  }

  const applyTransform = useCallback((offset, animate) => {
    const el = contentRef.current
    if (!el) return
    el.style.transition = animate ? 'transform 320ms cubic-bezier(0.32, 0.72, 0, 1)' : 'none'
    el.style.transform = offset ? `translateX(${offset}px)` : ''
    drag.current.offset = offset
  }, [])

  const close = useCallback((animate = true) => {
    applyTransform(0, animate)
    setRevealed(null)
    rowRef.current?.removeAttribute('data-swipe')
  }, [applyTransform])

  const onPointerDown = useCallback((e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (e.target.closest('.swipeable-row-actions')) return
    const d = drag.current
    d.active = true
    d.startX = e.clientX
    d.startY = e.clientY
    d.base = revealed === 'left' ? railWidth('left') : revealed === 'right' ? -railWidth('right') : 0
    d.axis = null
    d.t0 = performance.now()
    if (contentRef.current) contentRef.current.style.transition = 'none'
  }, [revealed])

  const onPointerMove = useCallback((e) => {
    const d = drag.current
    if (!d.active) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY

    // Lock the axis once. A vertical intent must stay a page scroll, so we bail
    // out entirely rather than fight the scroller for the gesture.
    if (!d.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (d.axis === 'y') { d.active = false; return }
      rowRef.current?.classList.add('dragging')
      onSwipeStart?.()
    }

    let next = d.base + dx
    const maxL = leftActions.length ? railWidth('left') : 0
    const maxR = rightActions.length ? railWidth('right') : 0
    // Rubber-band past the rail (and immediately, on a side with no actions)
    // instead of stopping dead — the dead stop is what read as "doesn't work".
    if (next > maxL) next = maxL + (next - maxL) * 0.22
    if (next < -maxR) next = -maxR + (next + maxR) * 0.22

    // Only the rail being pulled open is allowed to show.
    rowRef.current?.setAttribute('data-swipe', next > 0 ? 'left' : next < 0 ? 'right' : '')

    if (d.frame) return
    d.frame = requestAnimationFrame(() => {
      d.frame = 0
      if (drag.current.active) applyTransform(next, false)
    })
  }, [applyTransform, leftActions.length, rightActions.length, onSwipeStart])

  const onPointerUp = useCallback(() => {
    const d = drag.current
    if (!d.active) { d.axis = null; return }
    d.active = false
    if (d.frame) { cancelAnimationFrame(d.frame); d.frame = 0 }
    rowRef.current?.classList.remove('dragging')

    const offset = d.offset
    const velocity = (offset - d.base) / Math.max(1, performance.now() - d.t0)
    const maxL = leftActions.length ? railWidth('left') : 0
    const maxR = rightActions.length ? railWidth('right') : 0
    // Open past HALF the rail, or on a decisive flick — matching the sheet's
    // dismiss feel so the whole app swipes the same way.
    const openLeft = maxL > 0 && (offset > maxL / 2 || velocity > 0.45)
    const openRight = maxR > 0 && (offset < -maxR / 2 || velocity < -0.45)

    if (openLeft) {
      applyTransform(maxL, true); setRevealed('left'); rowRef.current?.setAttribute('data-swipe', 'left')
    } else if (openRight) {
      applyTransform(-maxR, true); setRevealed('right'); rowRef.current?.setAttribute('data-swipe', 'right')
    } else {
      close(true)
    }
    // 🪤 A pointerup is followed by a synthetic click, and the click handler
    // closes an open row — so the row snapped shut the instant the swipe that
    // opened it finished. Swallow that one click.
    if (d.axis === 'x') d.suppressClickUntil = performance.now() + 400
    d.axis = null
    onSwipeEnd?.()
  }, [applyTransform, close, leftActions.length, rightActions.length, onSwipeEnd])

  // An open row must close when the user taps anywhere else, or rows pile up
  // open behind each other.
  useEffect(() => {
    if (!revealed) return
    const onDocDown = (e) => { if (!rowRef.current?.contains(e.target)) close(true) }
    document.addEventListener('pointerdown', onDocDown, true)
    return () => document.removeEventListener('pointerdown', onDocDown, true)
  }, [revealed, close])

  const onContentClickCapture = useCallback((e) => {
    const d = drag.current
    // The click synthesised by the swipe's own pointerup: eat it so it neither
    // opens the token nor closes the row it just opened.
    if (d.suppressClickUntil && performance.now() < d.suppressClickUntil) {
      d.suppressClickUntil = 0
      e.stopPropagation()
      e.preventDefault()
      return
    }
    // A genuine tap while open closes, and must not fall through to the token.
    if (revealed) {
      e.stopPropagation()
      e.preventDefault()
      close(true)
    }
  }, [revealed, close])

  const handleActionClick = useCallback((action, e) => {
    if (e) { e.preventDefault(); e.stopPropagation() }
    action.onClick?.()
    close(true)
  }, [close])

  const renderRail = (actions, side) => (
    <div
      ref={side === 'left' ? leftRailRef : rightRailRef}
      className={`swipeable-row-actions swipeable-row-actions-${side}`}
    >
      {actions.map((action, i) => (
        <button
          key={i}
          type="button"
          className="swipeable-row-action"
          style={{ '--swa-color': action.color || (side === 'left' ? '#3b82f6' : '#ef4444') }}
          onClick={(e) => handleActionClick(action, e)}
          aria-label={action.label}
        >
          {action.icon && <span className="swipeable-row-action-icon">{action.icon}</span>}
          <span className="swipeable-row-action-label">{action.label}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div ref={rowRef} className={`swipeable-row ${revealed ? 'revealed' : ''} ${className}`}>
      {leftActions.length > 0 && renderRail(leftActions, 'left')}

      <div
        ref={contentRef}
        className="swipeable-row-content"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onContentClickCapture}
      >
        {children}
      </div>

      {rightActions.length > 0 && renderRail(rightActions, 'right')}
    </div>
  )
}

export default SwipeableRow
