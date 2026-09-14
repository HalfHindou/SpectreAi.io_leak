/*
 * PGTour - first-visit guided tour for Potential Gainers.
 *
 * A spotlight (a transparent frame with a 9999px box-shadow) dims the page
 * and frames the active zone; a tooltip explains it. Targets are found by
 * the data-tour="<id>" attribute and scrolled into view.
 *
 * Viewport-safe: a zone can be far taller than the screen (the board, the
 * track record). The spotlight frame is CLAMPED to the viewport so it always
 * reads as a highlight, and the tooltip is measured and positioned so it is
 * ALWAYS fully on-screen - below the frame, above it, or docked - never run
 * off the bottom of a tall section.
 */
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import './pg-tour.css'

const TIP_MARGIN = 14
const EDGE_PAD = 8

export default function PGTour({
  steps,
  isActive,
  currentStep,
  onNext,
  onBack,
  onSkip,
  dayMode = false,
}) {
  const [rect, setRect] = useState(null)
  const [tipH, setTipH] = useState(190)
  const tipRef = useRef(null)

  const step = Array.isArray(steps) ? steps[currentStep] : null
  const selector = step ? `[data-tour="${step.id}"]` : null

  const measure = useCallback(() => {
    if (!selector) { setRect(null); return }
    const el = document.querySelector(selector)
    if (!el) { setRect(null); return }
    const r = el.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [selector])

  /* scroll the active zone into view, then track it through scroll / resize.
     Tall zones align to their top so the zone header is what gets framed.
     Instant scroll (not smooth) - a crisp jump per step, and it does not
     depend on an animation frame; the spotlight's own CSS transition glides. */
  useEffect(() => {
    if (!isActive || !selector) return undefined
    const el = document.querySelector(selector)
    if (el) {
      const tall = el.getBoundingClientRect().height > window.innerHeight * 0.85
      el.scrollIntoView({ behavior: 'auto', block: tall ? 'start' : 'center' })
    }
    measure()
    const settle = setTimeout(measure, 420)
    const ro = new ResizeObserver(measure)
    if (el) ro.observe(el)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      clearTimeout(settle)
      ro.disconnect()
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [isActive, selector, currentStep, measure])

  /* Escape skips the tour */
  useEffect(() => {
    if (!isActive) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onSkip?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isActive, onSkip])

  /* measure the rendered tooltip so it can be kept fully on-screen */
  useLayoutEffect(() => {
    if (tipRef.current) {
      const h = tipRef.current.offsetHeight
      if (h && Math.abs(h - tipH) > 1) setTipH(h)
    }
  })

  if (!isActive || !step) return null

  const VW = window.innerWidth
  const VH = window.innerHeight
  const last = currentStep >= steps.length - 1

  /* Clamp the spotlight frame to the viewport - a zone taller than the
     screen still reads as a framed highlight instead of running off-screen. */
  let spot = null
  if (rect) {
    const top = Math.max(EDGE_PAD, rect.top)
    const bottom = Math.min(VH - EDGE_PAD, rect.top + rect.height)
    if (bottom - top > 24) {
      spot = { top, left: rect.left, width: rect.width, height: bottom - top }
    }
  }

  /* Place the tooltip below the frame, else above it, else docked - then
     always clamp it fully inside the viewport. */
  let tipTop
  let tipLeft = VW / 2
  if (spot) {
    tipLeft = Math.min(Math.max(spot.left + spot.width / 2, 196), VW - 196)
    if (spot.top + spot.height + TIP_MARGIN + tipH + EDGE_PAD <= VH) {
      tipTop = spot.top + spot.height + TIP_MARGIN
    } else if (spot.top - TIP_MARGIN - tipH - EDGE_PAD >= 0) {
      tipTop = spot.top - TIP_MARGIN - tipH
    } else {
      tipTop = VH - tipH - 16
    }
  } else {
    tipTop = (VH - tipH) / 2
  }
  tipTop = Math.max(12, Math.min(tipTop, VH - tipH - 12))

  return createPortal(
    <div
      className={`pg-tour${dayMode ? ' pg-tour--day' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Potential Gainers tour"
    >
      {/* Outside click dismisses - the backdrop is pointer-events:auto, so
          without a handler it just ate the click and Escape was the only exit. */}
      <div
        className={`pg-tour__backdrop${spot ? '' : ' pg-tour__backdrop--full'}`}
        onClick={onSkip}
        aria-hidden="true"
      />
      {spot && (
        <div
          className="pg-tour__spotlight"
          style={{ top: spot.top, left: spot.left - 6, width: spot.width + 12, height: spot.height }}
          aria-hidden="true"
        />
      )}
      <div
        ref={tipRef}
        className={`pg-tour__tip${spot ? '' : ' pg-tour__tip--center'}`}
        style={{ top: tipTop, left: tipLeft }}
      >
        <span className="pg-tour__step">Step {currentStep + 1} of {steps.length}</span>
        <h3 className="pg-tour__title">{step.title}</h3>
        <p className="pg-tour__desc">{step.description}</p>
        <div className="pg-tour__actions">
          <button type="button" className="pg-tour__skip" onClick={onSkip}>Skip</button>
          <div className="pg-tour__nav">
            {currentStep > 0 && (
              <button type="button" className="pg-tour__btn pg-tour__btn--back" onClick={onBack}>
                Back
              </button>
            )}
            <button type="button" className="pg-tour__btn pg-tour__btn--next" onClick={onNext}>
              {last ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
