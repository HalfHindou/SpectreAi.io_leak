/**
 * MobileChartCard — TradingChart + a desktop-styled compact toolbar +
 * a touch-aware drag handle for resizing the chart.
 *
 * The desktop `.chart-controls` bar is hidden (replaced by the compact
 * MobileChartToolbar above). The desktop `.chart-resize-handle` only
 * binds mouse events, so we render our own thin drag bar below the
 * chart and resize `.chart-content-area` directly via touch.
 */
import React, { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import lazy from '../../lib/lazy-with-retry'
import MobileChartToolbar from './MobileChartToolbar'
import MobileTimeframeRow from './MobileTimeframeRow'
import './MobileChartCard.css'

const TradingChart = lazy(() => import('../TradingChart'))

// Widest range the handle will ever offer. The ACTUAL range is measured per
// drag (see measureRange) because the per-view rules in MobileTokenPage.css
// clamp the chart's height on top of --mcc-chart-h.
const HARD_MIN_H = 220
const HARD_MAX_H = 800

// Breathing room between the chart's bottom edge and the Buy/Sell dock.
const CHART_FIT_GAP = 6

// Each view drives its own height var, so a drag in the split view can beat
// its default collapse (see the chart-txns rule in MobileTokenPage.css)
// without also resizing the chart-only view.
const HEIGHT_VARS = [
  { prop: '--mcc-chart-h', key: 'spectre-chart-height-mobile' },
  { prop: '--mcc-chart-h-split', key: 'spectre-chart-height-mobile-split' },
]
const varForView = (view) => (view === 'chart-txns' ? HEIGHT_VARS[1] : HEIGHT_VARS[0])

function MobileResizeHandle({ mccRef }) {
  const handleRef = useRef(null)
  const startYRef = useRef(0)
  const startHRef = useRef(0)
  const draggingRef = useRef(false)
  const rafRef = useRef(0)
  const pendingYRef = useRef(0)
  const minHRef = useRef(HARD_MIN_H)
  const maxHRef = useRef(HARD_MAX_H)
  const lastAppliedRef = useRef(0)
  const prevTransitionRef = useRef('')
  const heightVarRef = useRef(HEIGHT_VARS[0])

  // Restore saved heights on mount. Both vars are restored regardless of the
  // current view - the card stays mounted across Chart <-> Chart+Txns, so the
  // view can change without this effect re-running.
  useEffect(() => {
    const mcc = mccRef?.current
    if (!mcc) return
    for (const { prop, key } of HEIGHT_VARS) {
      try {
        const saved = parseInt(localStorage.getItem(key) || '', 10)
        if (Number.isFinite(saved) && saved >= HARD_MIN_H && saved <= HARD_MAX_H) {
          mcc.style.setProperty(prop, `${saved}px`)
        }
      } catch (e) { /* noop */ }
    }
  }, [mccRef])

  useEffect(() => {
    const handle = handleRef.current
    if (!handle) return

    let chartEl = null

    // Measure the element we actually size, not its wrapper - the per-view
    // caps land on `.trading-chart`, so the wrapper can disagree with it.
    const getCurrentHeight = () => {
      const chart = mccRef?.current?.querySelector('.trading-chart')
      return chart ? chart.getBoundingClientRect().height : 0
    }

    // Commit the real chart height on whichever var this view consumes.
    const setHeight = (h) => {
      mccRef?.current?.style.setProperty(heightVarRef.current.prop, `${h}px`)
    }

    // --mcc-chart-h is NOT the final word on the chart's height: the per-view
    // rules in MobileTokenPage.css layer their own `height` on top of it —
    // chart-txns caps it at `max(300px, 100dvh - 500px)`, and the chart-only
    // view ignores the var completely. The handle used to clamp to a flat
    // 220-800, so in chart-txns you could drag the chart to 800px and then
    // watch it snap back up to the ~430px cap the moment you let go.
    //
    // Rather than duplicate those formulas here (two sources of truth that
    // WILL drift), ask the browser: pin the var to each extreme and measure
    // what the chart actually becomes. Whatever rule wins, the numbers are
    // right. `.trading-chart` carries `transition: height 0.4s`, so the
    // transition has to be off for the probe or we'd read the height it is
    // animating FROM.
    const measureRange = () => {
      const mcc = mccRef?.current
      const chart = mcc?.querySelector('.trading-chart')
      if (!mcc || !chart) return { min: HARD_MIN_H, max: HARD_MAX_H }
      const prop = heightVarRef.current.prop
      const hadVar = mcc.style.getPropertyValue(prop)
      const prevTransition = chart.style.transition
      chart.style.transition = 'none'
      mcc.style.setProperty(prop, `${HARD_MAX_H}px`)
      const max = chart.getBoundingClientRect().height
      mcc.style.setProperty(prop, `${HARD_MIN_H}px`)
      const min = chart.getBoundingClientRect().height
      if (hadVar) mcc.style.setProperty(prop, hadVar)
      else mcc.style.removeProperty(prop)
      chart.getBoundingClientRect() // flush the restore before re-arming the transition
      chart.style.transition = prevTransition
      // A view that pins the height reports the same number for both probes -
      // and if it pins it ABOVE the hard ceiling (chart-only does: it asks for
      // 100dvh-315px), the raw min lands above the capped max. Fold min into
      // max so the range is always well-formed and a pinned view collapses to
      // a zero-width range the caller can detect.
      const maxH = Math.min(HARD_MAX_H, Math.round(max))
      const minH = Math.min(maxH, Math.max(HARD_MIN_H, Math.round(min)))
      return { min: minH, max: maxH }
    }

    const clampHeight = () => {
      const min = minHRef.current
      const max = maxHRef.current
      let h = startHRef.current + (pendingYRef.current - startYRef.current)
      // Pin the drag origin to the limit instead of letting the finger keep
      // running past it. Without this the overshoot has to be un-dragged
      // before the handle moves again - a dead zone that reads as the handle
      // sticking and then lurching.
      if (h > max) { startYRef.current += h - max; h = max }
      else if (h < min) { startYRef.current -= min - h; h = min }
      return h
    }

    const onStart = (clientY) => {
      chartEl = mccRef?.current?.querySelector('.trading-chart') || null
      // Resolve the view AT DRAG START, not at mount - the card stays mounted
      // across Chart <-> Chart+Txns.
      heightVarRef.current = varForView(mccRef?.current?.closest('.mtp')?.dataset?.view)
      const range = measureRange()
      // A view that pins the height (chart-only) collapses to a zero-width
      // range. There is nothing to drag there, so don't pretend: bail and
      // leave the handle inert rather than stretching the chart on-screen and
      // snapping it back the moment the finger lifts.
      if (range.max - range.min < 8) return
      minHRef.current = range.min
      maxHRef.current = range.max
      startYRef.current = clientY
      pendingYRef.current = clientY
      startHRef.current = getCurrentHeight()
      lastAppliedRef.current = startHRef.current
      draggingRef.current = true
      // Suspend the height transition for the duration of the drag so each
      // frame's height lands immediately instead of starting a fresh 400ms
      // animation (see applyPending). Restored in onEnd.
      if (chartEl) {
        prevTransitionRef.current = chartEl.style.transition
        chartEl.style.transition = 'none'
      }
      handle.classList.add('is-dragging')
      document.body.style.userSelect = 'none'
    }
    // The drag resizes the chart for real, one commit per animation frame.
    //
    // This used to fake it with a `scaleY` transform on the chart while the
    // wrapper grew, to avoid "relayout every frame, too heavy". But scaling
    // stretches EVERYTHING - candles, axis labels, the drawing toolbar - so
    // the chart visibly distorted mid-drag and only snapped back to correct
    // proportions on release. The stated cost was also misdiagnosed: the
    // laggy feel came from writing a height that carries
    // `transition: height 0.4s ease-out`, which restarts a 400ms animation on
    // every frame, so the chart is permanently chasing the finger and never
    // arrives. The same fix already used for the release commit below -
    // suspend the transition - makes a live resize track the finger exactly.
    const applyPending = () => {
      rafRef.current = 0
      if (!draggingRef.current) return
      const h = clampHeight()
      // Sub-pixel jitter isn't worth a chart relayout.
      if (Math.abs(h - lastAppliedRef.current) < 1) return
      lastAppliedRef.current = h
      setHeight(h)
    }
    const onMove = (clientY) => {
      if (!draggingRef.current) return
      pendingYRef.current = clientY
      if (!rafRef.current) rafRef.current = requestAnimationFrame(applyPending)
    }
    const onEnd = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
      const next = clampHeight()
      // The height is already live at this point (applyPending commits every
      // frame); this just makes sure the last frame landed. Restore the
      // transition a frame later, so other height changes (fullscreen, the
      // Chart <-> Chart+Txns collapse) still animate - but not this commit,
      // which would otherwise re-animate from the current height to itself.
      setHeight(next)
      if (chartEl) {
        const prev = prevTransitionRef.current
        requestAnimationFrame(() => { chartEl.style.transition = prev })
      }
      handle.classList.remove('is-dragging')
      document.body.style.userSelect = ''
      try { localStorage.setItem(heightVarRef.current.key, String(Math.round(next))) } catch (e) { /* noop */ }
    }

    const onTouchStart = (e) => {
      const t = e.touches?.[0]
      if (!t) return
      e.preventDefault()
      onStart(t.clientY)
    }
    const onTouchMove = (e) => {
      if (!draggingRef.current) return
      const t = e.touches?.[0]
      if (!t) return
      e.preventDefault()
      onMove(t.clientY)
    }
    const onTouchEnd = (e) => {
      if (!draggingRef.current) return
      e.preventDefault()
      onEnd()
    }

    const onMouseDown = (e) => {
      e.preventDefault()
      onStart(e.clientY)
    }
    const onMouseMove = (e) => onMove(e.clientY)
    const onMouseUp = () => onEnd()

    handle.addEventListener('touchstart', onTouchStart, { passive: false })
    handle.addEventListener('mousedown', onMouseDown)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd, { passive: false })
    document.addEventListener('touchcancel', onTouchEnd, { passive: false })
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      handle.removeEventListener('touchstart', onTouchStart)
      handle.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchEnd)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
    }
  }, [mccRef])

  return (
    <div
      ref={handleRef}
      className="mcc-resize"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize chart"
    >
      <span className="mcc-resize-bar" aria-hidden="true" />
    </div>
  )
}

export default function MobileChartCard({ token, view, chartViewMode, setChartViewMode, alertLines = [], onAlertAtPrice }) {
  const chartRootRef = useRef(null)
  const mccRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  /* Chart-only view: fill the real gap between the chart's top and the
     Buy/Sell dock. The rule in MobileTokenPage.css guessed that gap with
     `100dvh - 315px` (header + hero + topbar + dock), but the hero grows with
     the token (long name, wrapped change chips) and iOS resolves 100dvh
     against a different box than the fixed dock uses - so on a phone the
     chart ran ~35px long and its time axis + volume rail sat BEHIND the dock.
     Measure it instead: --mcc-chart-fit wins over the guess in CSS.
     Scroll-invariant (the scroller is `.app`, not the window), so scrolling
     the page never resizes the chart. */
  useEffect(() => {
    const mcc = mccRef.current
    const mtp = mcc?.closest('.mtp')
    if (!mcc || !mtp) return
    if (view !== 'chart') { mtp.style.removeProperty('--mcc-chart-fit'); return }

    const scroller = mcc.closest('.app')
    let raf = 0
    const measure = () => {
      raf = 0
      const chart = mcc.querySelector('.trading-chart')
      // .mbn is the Buy/Sell bar; it docks above the .mvn tab bar. Both are
      // position:fixed, so their rects are already viewport-anchored - which
      // is exactly what a dvh formula keeps getting wrong on iOS.
      const dock = document.querySelector('.mbn') || document.querySelector('.mvn')
      if (!chart || !dock) return
      const scrollTop = scroller ? scroller.scrollTop : (window.scrollY || 0)
      const topAtRest = chart.getBoundingClientRect().top + scrollTop
      const fit = Math.round(dock.getBoundingClientRect().top - topAtRest - CHART_FIT_GAP)
      // A nonsense measurement (mid-transition, chart not laid out yet) falls
      // back to the CSS formula rather than pinning a broken height.
      if (fit >= 260) mtp.style.setProperty('--mcc-chart-fit', `${fit}px`)
      else mtp.style.removeProperty('--mcc-chart-fit')
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure) }

    measure()
    const ro = new ResizeObserver(schedule)
    const hero = mtp.querySelector('.mph')
    if (hero) ro.observe(hero)
    const topbar = mcc.querySelector('.mcc-topbar')
    if (topbar) ro.observe(topbar)
    window.addEventListener('resize', schedule)
    window.addEventListener('orientationchange', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('orientationchange', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
    }
  }, [view, token?.address])

  const toggleFullscreen = useCallback(() => setIsFullscreen((v) => !v), [])

  const setDrawRail = useCallback((want) => {
    const root = chartRootRef.current
    const ifr = root?.querySelector('iframe')
    if (!ifr) return
    let visible = false
    try {
      const rail = ifr.contentDocument?.querySelector('[class*="drawingToolbar"], .drawing-toolbar, [data-name="drawing-toolbar"]')
      visible = !!rail && rail.getBoundingClientRect().width > 10
    } catch { return }
    if (visible !== want) root.querySelector('.draw-btn')?.click()
  }, [])

  // `.trading-chart` carries `transition: height 0.4s ease-out`, so entering
  // and LEAVING fullscreen animated the height from the viewport down to the
  // card - and the chart re-measures through its own ResizeObserver on every
  // frame of that animation. ~24 full chart re-layouts for one tap; on a phone
  // each one is expensive enough that exiting fullscreen reads as hanging for
  // seconds. Snap the height instead: one re-measure, not 24. Must be a LAYOUT
  // effect - a passive effect runs after the paint that already started the
  // transition. The Chart <-> Chart+Txns collapse still animates.
  const fsSettledRef = useRef(false)
  useLayoutEffect(() => {
    if (!fsSettledRef.current) { fsSettledRef.current = true; return undefined }
    const chartEl = mccRef.current?.querySelector('.trading-chart')
    if (!chartEl) return undefined
    const prev = chartEl.style.transition
    chartEl.style.transition = 'none'
    // rAF is frozen in a backgrounded tab, so a plain rAF restore would leave
    // the chart without its transition until the next toggle. Timer fallback.
    let done = false
    const restore = () => { if (done) return; done = true; chartEl.style.transition = prev }
    const id = requestAnimationFrame(restore)
    const t = setTimeout(restore, 250)
    return () => { cancelAnimationFrame(id); clearTimeout(t) }
  }, [isFullscreen])

  // Lock the page behind the overlay + let ESC close it. The chart
  // re-measures through its own ResizeObserver; the extra resize event
  // just makes the first frame land immediately.
  useEffect(() => {
    if (!isFullscreen) return
    document.body.classList.add('mcc-fs-open')
    const onKey = (e) => { if (e.key === 'Escape') setIsFullscreen(false) }
    document.addEventListener('keydown', onKey)
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 60)
    const tRail = setTimeout(() => setDrawRail(true), 260)
    return () => {
      document.body.classList.remove('mcc-fs-open')
      document.removeEventListener('keydown', onKey)
      clearTimeout(t)
      clearTimeout(tRail)
      setDrawRail(false)
      window.dispatchEvent(new Event('resize'))
    }
  }, [isFullscreen, setDrawRail])

  return (
    <section
      className={`mcc ${isFullscreen ? 'mcc--fs' : ''}`}
      aria-label="Price chart"
      ref={mccRef}
    >
      {/* GMGN-style top bar: timeframe text row + chart tool icons in ONE
          line directly above the chart. */}
      <div className="mcc-topbar">
        <MobileTimeframeRow chartRootRef={chartRootRef} />
        <MobileChartToolbar
          chartRootRef={chartRootRef}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
        />
      </div>

      <div className="mcc-chart-wrap" ref={chartRootRef}>
        <Suspense fallback={<div className="mcc-skeleton animate-shimmer" />}>
          <TradingChart
            token={token}
            chartViewMode={chartViewMode}
            setChartViewMode={setChartViewMode}
            isCollapsed={false}
            alertLines={alertLines}
            onAlertAtPrice={onAlertAtPrice}
          />
        </Suspense>
      </div>

      <MobileResizeHandle mccRef={mccRef} />
    </section>
  )
}
