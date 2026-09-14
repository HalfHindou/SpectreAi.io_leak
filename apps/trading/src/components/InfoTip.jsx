/**
 * InfoTip - Educational tooltip for info mode.
 * Renders a pulsing amber dot next to elements.
 * Hover to see a glass tooltip with plain-English explanation.
 *
 * Visibility is CSS-driven: hidden by default,
 * shown only when body.info-mode is active.
 *
 * Bubble is portalled to document.body so it escapes
 * any parent overflow:hidden (e.g. scrolling marquees).
 *
 * When visible, pauses any CSS-animated scrolling ancestor
 * (e.g. .smt-track marquee) FIRST, then measures position.
 */
import React, { useState, useRef, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import './InfoTip.css'

function InfoTip({ text, position = 'top' }) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState(null)
  const hideTimer = useRef(null)
  const dotRef = useRef(null)
  const pausedEl = useRef(null)

  const show = useCallback(() => {
    clearTimeout(hideTimer.current)
    setVisible(true)
  }, [])

  const hide = useCallback(() => {
    hideTimer.current = setTimeout(() => setVisible(false), 120)
  }, [])

  // Single effect: pause animation first, then measure dot position
  useLayoutEffect(() => {
    if (!visible || !dotRef.current) {
      // Resume animation when hiding
      if (pausedEl.current) {
        pausedEl.current.style.animationPlayState = ''
        pausedEl.current = null
      }
      setCoords(null)
      return
    }

    // Step 1: Pause any animated scrolling ancestor
    let el = dotRef.current.parentElement
    while (el && el !== document.body) {
      const style = getComputedStyle(el)
      if (style.animationName && style.animationName !== 'none') {
        el.style.animationPlayState = 'paused'
        pausedEl.current = el
        break
      }
      el = el.parentElement
    }

    // Step 2: Wait one frame for the pause to take effect, then measure
    // Use raw viewport coords - bubble uses position:fixed
    const raf = requestAnimationFrame(() => {
      if (!dotRef.current) return
      const rect = dotRef.current.getBoundingClientRect()
      setCoords({
        dotTop: rect.top,
        dotBottom: rect.bottom,
        dotLeft: rect.left,
        dotRight: rect.right,
        dotCenterX: rect.left + rect.width / 2,
        dotCenterY: rect.top + rect.height / 2,
      })
    })

    return () => {
      cancelAnimationFrame(raf)
      if (pausedEl.current) {
        pausedEl.current.style.animationPlayState = ''
        pausedEl.current = null
      }
    }
  }, [visible])

  return (
    <span className="infotip">
      <span
        ref={dotRef}
        className="infotip-dot"
        onMouseEnter={show}
        onMouseLeave={hide}
        aria-label="Info"
      />
      {visible && coords && createPortal(
        <span
          className={`infotip-bubble infotip-bubble--${position}`}
          style={getBubbleStyle(position, coords)}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          {text}
        </span>,
        document.body
      )}
    </span>
  )
}

/* Arrow is 10px wide, rotated 45deg.
   For top/bottom: arrow at CSS left:14px, visual center = 14+5 = 19px.
   For right/left: arrow tip protrudes ~7px from bubble edge (half diagonal
   of 10px square). Gap must be <= 7px so the arrow connects to the dot. */
const ARROW_CENTER = 19

function getBubbleStyle(position, c) {
  const base = { position: 'fixed', zIndex: 99999 }
  switch (position) {
    case 'bottom':
      return { ...base, top: c.dotBottom + 10, left: c.dotCenterX - ARROW_CENTER }
    case 'right':
      return { ...base, top: c.dotCenterY, left: c.dotRight + 6, transform: 'translateY(-50%)' }
    case 'left':
      return { ...base, top: c.dotCenterY, left: c.dotLeft - 6, transform: 'translate(-100%, -50%)' }
    case 'top':
    default:
      return { ...base, bottom: `calc(100vh - ${c.dotTop}px + 10px)`, left: c.dotCenterX - ARROW_CENTER }
  }
}

export default InfoTip
