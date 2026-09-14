/**
 * InfoTip - Educational tooltip for info mode.
 * Renders a pulsing amber dot next to elements.
 * Hover (desktop) or tap (mobile) to see a glass tooltip with a
 * plain-English explanation.
 *
 * Visibility is CSS-driven: hidden by default,
 * shown only when body.info-mode is active.
 *
 * Bubble is portalled to document.body so it escapes
 * any parent overflow:hidden.
 *
 * The dot swallows its own pointer events so it can live inside a
 * clickable row/card without triggering the row's onClick. On touch
 * (no hover) a tap toggles the bubble; an outside tap or Escape closes it.
 */
import React, { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import './InfoTip.css'

function InfoTip({ text, position = 'top' }) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState(null)
  const hideTimer = useRef(null)
  const dotRef = useRef(null)
  const bubbleRef = useRef(null)
  const pausedEl = useRef(null)

  const show = useCallback(() => {
    clearTimeout(hideTimer.current)
    setVisible(true)
  }, [])

  const hide = useCallback(() => {
    hideTimer.current = setTimeout(() => setVisible(false), 120)
  }, [])

  // Tap/click toggles (mobile has no hover). Always stop the press from
  // falling through to a clickable parent row/card.
  const toggle = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    clearTimeout(hideTimer.current)
    setVisible((v) => !v)
  }, [])

  const swallow = useCallback((e) => { e.stopPropagation() }, [])

  useLayoutEffect(() => {
    if (!visible || !dotRef.current) {
      if (pausedEl.current) {
        pausedEl.current.style.animationPlayState = ''
        pausedEl.current = null
      }
      setCoords(null)
      return
    }

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

  // While open (mostly tap-opened on touch), close on an outside press or Escape.
  useEffect(() => {
    if (!visible) return
    const onDocDown = (e) => {
      if (dotRef.current?.contains(e.target) || bubbleRef.current?.contains(e.target)) return
      setVisible(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setVisible(false) }
    document.addEventListener('pointerdown', onDocDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDocDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [visible])

  return (
    <span className="infotip" onClick={swallow} onMouseDown={swallow}>
      <span
        ref={dotRef}
        className="infotip-dot"
        role="button"
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={toggle}
        onMouseDown={swallow}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(e) }}
        aria-label={t('common.info', 'Info')}
      >
        {/* A clear circled-"i" info glyph (matches the header Info toggle), not
            an amber dot - the old amber dot was mistaken for the coloured %-change
            legend dots. */}
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </span>
      {visible && coords && createPortal(
        <span
          ref={bubbleRef}
          // The bubble is portalled to <body>, outside the `.app.app-day-mode`
          // wrapper, so it can't inherit day mode via an ancestor selector.
          // Tag it directly so the day-mode bubble styles apply.
          className={`infotip-bubble infotip-bubble--${position === 'top' && coords.dotTop < 120 ? 'bottom' : position}${isDayMode() ? ' day-mode' : ''}`}
          style={getBubbleStyle(position, coords)}
          onMouseEnter={show}
          onMouseLeave={hide}
          onClick={swallow}
          onMouseDown={swallow}
        >
          {text}
        </span>,
        document.body
      )}
    </span>
  )
}

const ARROW_CENTER = 19

// Day mode lives on the `.app` wrapper as `app-day-mode`. The bubble is
// portalled to <body> (outside `.app`), so it reads the flag directly rather
// than inheriting it through an ancestor selector.
function isDayMode() {
  if (typeof document === 'undefined') return false
  return !!document.querySelector('.app.app-day-mode')
}

const BUBBLE_W = 240 // keep in sync with .infotip-bubble width in InfoTip.css

// Keep a top/bottom bubble fully on-screen horizontally (it's 240px wide and
// anchored by its left edge). Without this, a dot near the right edge - e.g. a
// right-column stat tile inside a drawer - would push the bubble off-screen.
function clampLeft(x) {
  if (typeof window === 'undefined') return x
  return Math.max(8, Math.min(x, window.innerWidth - BUBBLE_W - 8))
}

function getBubbleStyle(position, c) {
  const base = { position: 'fixed', zIndex: 99999 }
  // Auto-flip: if position is 'top' but dot is near viewport top, flip to 'bottom'
  const resolved = position === 'top' && c.dotTop < 120 ? 'bottom' : position
  switch (resolved) {
    case 'bottom':
      return { ...base, top: c.dotBottom + 10, left: clampLeft(c.dotCenterX - ARROW_CENTER) }
    case 'right':
      return { ...base, top: c.dotCenterY, left: c.dotRight + 6, transform: 'translateY(-50%)' }
    case 'left':
      return { ...base, top: c.dotCenterY, left: c.dotLeft - 6, transform: 'translate(-100%, -50%)' }
    case 'top':
    default:
      return { ...base, bottom: `calc(100vh - ${c.dotTop}px + 10px)`, left: clampLeft(c.dotCenterX - ARROW_CENTER) }
  }
}

export default InfoTip
