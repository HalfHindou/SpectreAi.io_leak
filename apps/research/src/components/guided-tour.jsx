/*
 * GuidedTour - a reusable first-look spotlight tour.
 *
 * Generalised from the Potential Gainers tour (pg-tour). A spotlight (a
 * transparent frame with a 9999px box-shadow) dims the page and frames the
 * active zone; a tooltip explains it. Targets are found by the
 * data-tour="<id>" attribute and scrolled into view.
 *
 * Controlled: the host page owns the active flag + step index and passes them
 * in, so a page can drive the tour from a button, persist a "seen" flag, etc.
 *
 * Viewport-safe: a zone can be far taller than the screen. The spotlight frame
 * is CLAMPED to the viewport so it always reads as a highlight, and the tooltip
 * is measured and positioned so it is ALWAYS fully on-screen - below the frame,
 * above it, or docked - never run off the bottom of a tall section.
 *
 * A step with no matching data-tour target renders as a centred card (used for
 * the closing "you're all set" step).
 */
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import './guided-tour.css'

const TIP_MARGIN = 14
const EDGE_PAD = 8

/*
 * TourLaunchButton - the slim "?" pill that opens a GuidedTour.
 * `pulse` draws a one-shot attention ring (pass !tourSeen) so first-time
 * visitors notice it without an intrusive auto-popup.
 */
export function TourLaunchButton({ onClick, pulse = false, label = 'Tour', title = 'Take a quick tour' }) {
  return (
    <button
      type="button"
      className={`gtour-launch${pulse ? ' gtour-launch--pulse' : ''}`}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      <span className="gtour-launch__glyph" aria-hidden="true">?</span>
      {label && <span className="gtour-launch__label">{label}</span>}
    </button>
  )
}

export default function GuidedTour({
  steps,
  isActive,
  currentStep,
  onNext,
  onBack,
  onSkip,
  onChoose,
  dayMode = false,
  ariaLabel = 'Guided tour',
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

  /* Locate the step's target, scroll it into view, then track it through
     scroll / resize. Crucial: a target can mount LATE (a lazy view, a section
     that renders once data lands). We POLL for it - and wait until it's
     actually sized - before giving up. Without this, a not-yet-mounted target
     made the step fall back to a centred card ("just a popup, no highlight").
     Only when the target truly never appears do we render the centred card. */
  useEffect(() => {
    if (!isActive || !selector) { setRect(null); return undefined }

    let cancelled = false
    let ro = null
    let pollTimer = 0
    let settleTimer = 0
    let scrolledFor = null

    const attach = (el) => {
      if (scrolledFor !== el) {
        scrolledFor = el
        const r = el.getBoundingClientRect()
        // Only scroll if the target isn't already comfortably on-screen. The
        // global tour frames always-visible shell elements (header, sidebar,
        // top market bar); scrolling a fixed/visible element just jerks the page
        // and reads as "laggy" highlight movement.
        const fullyVisible = r.top >= 4 && r.left >= 0
          && r.bottom <= window.innerHeight - 4 && r.right <= window.innerWidth
        if (!fullyVisible) {
          const tall = r.height > window.innerHeight * 0.85
          el.scrollIntoView({ behavior: 'auto', block: tall ? 'start' : 'center' })
        }
      }
      measure()
      // re-measure once layout settles (fonts / images / post-scroll reflow)
      settleTimer = window.setTimeout(measure, 320)
      ro = new ResizeObserver(measure)
      ro.observe(el)
    }

    // ~24 * 90ms ≈ 2.2s window for a lazy/late target to appear + get sized.
    const tick = (attemptsLeft) => {
      if (cancelled) return
      const el = document.querySelector(selector)
      const sized = el && (el.offsetWidth > 0 || el.offsetHeight > 0)
      if (sized) { attach(el); return }
      if (attemptsLeft > 0) {
        pollTimer = window.setTimeout(() => tick(attemptsLeft - 1), 90)
      } else {
        setRect(null) // genuinely absent -> centred card
      }
    }

    setRect(null)       // clear the previous step's spotlight while relocating
    tick(24)

    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      cancelled = true
      clearTimeout(pollTimer)
      clearTimeout(settleTimer)
      if (ro) ro.disconnect()
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

  /* Clamp the spotlight frame to the viewport. */
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
      className={`gtour${dayMode ? ' gtour--day' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {/* Clicking outside the tooltip dismisses the tour. The backdrop already
          had pointer-events:auto, so it SWALLOWED outside clicks without doing
          anything - Escape was the only way out, which read as a stuck modal on
          the "Quick tour or full walkthrough?" chooser. */}
      <div
        className={`gtour__backdrop${spot ? '' : ' gtour__backdrop--full'}`}
        onClick={onSkip}
        aria-hidden="true"
      />
      {spot && (
        <div
          className="gtour__spotlight"
          style={{ top: spot.top, left: spot.left - 6, width: spot.width + 12, height: spot.height }}
          aria-hidden="true"
        />
      )}
      <div
        ref={tipRef}
        className={`gtour__tip${spot ? '' : ' gtour__tip--center'}`}
        style={{ top: tipTop, left: tipLeft }}
      >
        {step.eyebrow
          ? <span className="gtour__step gtour__step--eyebrow">{step.eyebrow}</span>
          : <span className="gtour__step">Step {currentStep + 1} of {steps.length}</span>}
        <h3 className="gtour__title">{step.title}</h3>
        <p className="gtour__desc">{step.description}</p>
        {Array.isArray(step.choices) ? (
          /* Length-picker step: buttons pick a tour variant (short/full) via
             onChoose instead of the default Next. */
          <div className="gtour__choices">
            {step.choices.map((c) => (
              <button
                key={c.mode || c.label}
                type="button"
                className={`gtour__choice${c.primary ? ' gtour__choice--primary' : ''}`}
                onClick={() => onChoose?.(c)}
              >
                <span className="gtour__choice-label">{c.label}</span>
                {c.hint && <span className="gtour__choice-hint">{c.hint}</span>}
              </button>
            ))}
            <button type="button" className="gtour__skip gtour__skip--center" onClick={onSkip}>
              Maybe later
            </button>
          </div>
        ) : (
          <div className="gtour__actions">
            <button type="button" className="gtour__skip" onClick={onSkip}>
              {last ? 'Close' : 'Skip'}
            </button>
            <div className="gtour__nav">
              <span className="gtour__dots" aria-hidden="true">
                {steps.map((s, i) => (
                  <span key={s.id || i} className={`gtour__dot${i === currentStep ? ' gtour__dot--on' : ''}`} />
                ))}
              </span>
              {currentStep > 0 && (
                <button type="button" className="gtour__btn gtour__btn--back" onClick={onBack}>
                  Back
                </button>
              )}
              <button type="button" className="gtour__btn gtour__btn--next" onClick={onNext}>
                {last ? 'Got it' : 'Next'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
