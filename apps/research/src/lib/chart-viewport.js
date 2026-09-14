/* Pan/zoom overscroll buffers, as a fraction of the visible candle count.
   LEFT = empty space allowed past the oldest loaded bar (history streams in);
   RIGHT = future breathing room on the right edge. These MUST be shared by the
   render clamp AND every interaction clamp (drag, momentum, wheel/pinch zoom) —
   if the interaction clamp is wider than the render clamp, the finger keeps
   moving panOffset into a region the canvas won't scroll to (a dead-drag zone). */
const OVERSCROLL_LEFT = 0.12
export const OVERSCROLL_RIGHT = 0.15

// Zoom 1 fits the loaded buffer. Zooming further out would manufacture empty slots.
export const MIN_CHART_ZOOM = 1

/* The LABELLED length of the three crypto range presets, in hours - i.e. what
   the button PROMISES. Used to size the opening view (see visibleTarget) and to
   let a range preset's candles grow past the 25px cap (see computeChartGeometry).

   NOT timeframeToPeriod: that is the ~4x scroll-back BUFFER (96h/720h/2880h),
   so sizing the opening view by it would put 4 days under a "24h" button. */
const RANGE_LABEL_HOURS = { '1D': 24, '1W': 168, '1MO': 720 }

/* Presets that mean "fit EVERY loaded bar on screen" - only these may shrink the
   candle below the 1px floor. Deliberately NOT the range presets (1D/1W/1MO/1Y):
   those fetch a ~4x buffer that the user is meant to pan/zoom back into, and a
   sub-pixel candle makes visibleCount >= candleData.length, which collapses
   maxOffset to 0 and FREEZES the drag (founder repro 2026-07-27: zoom out on 24h,
   drag right, nothing moves). Matches FULL_FIT_TIMEFRAMES in the zoom init. */
const FULL_FIT_TIMEFRAMES = ['YTD', 'ALL']

/* THE single source of truth for chart geometry.
   Render, drag, momentum, wheel- and pinch-zoom all derive the visible window
   from this one function. They used to each carry their own copy of the formula
   and had DRIFTED (the renderer grew a range-preset width cap + a full-fit
   min-width drop that the interaction handlers never got), so the finger moved
   panOffset into a region the canvas re-clamped away - a dead drag. */
export function computeChartGeometry(len, zoom, chartWidth, timeframe) {
  const width = Math.max(1, chartWidth)
  const requested = Math.max(1, Math.floor(len / Math.max(MIN_CHART_ZOOM, zoom)))
  const rawCandleWidth = width / requested
  // Max width for readability at high zoom. 25px normally - but the visible
  // count below refills the pane with OLDER candles whenever this cap bites,
  // which silently WIDENS the labelled window: on a sparse tier a "24h" view
  // asked for 38 candles (28h), the cap forced 38.3px -> 25px, and the pane
  // refilled to 58 candles = 49.4h under a button that says 24h. On the range
  // presets the label is a promise, so let the candles grow to whatever that
  // window needs, with a ceiling so an extreme zoom-in can't produce absurd
  // blocks. Dense series never reach the cap (288 candles over ~1450px is ~5px
  // each), so this is a no-op there.
  const maxCandleWidth = RANGE_LABEL_HOURS[timeframe]
    ? Math.min(80, Math.max(25, rawCandleWidth))
    : 25
  // Dynamic minimum: full-history views (500+ candles) may go to 1px for a full
  // overview; intraday keeps 3px for readability.
  const minCandleWidth = len > 400 ? 1 : 3
  const effMinCandleWidth = FULL_FIT_TIMEFRAMES.includes(timeframe)
    ? Math.min(minCandleWidth, width / Math.max(1, len))
    : minCandleWidth
  const candleWidth = Math.max(effMinCandleWidth, Math.min(maxCandleWidth, rawCandleWidth))
  return { candleWidth, visibleCount: Math.floor(width / candleWidth) }
}

/* How far panOffset may travel, in candles. Shared by the render clamp and every
   interaction clamp for the same reason as the geometry above.

   `canExtendLeft` is TRUE whenever more history exists - it deliberately does NOT
   require the buffer to be wider than the pane. That extra condition used to be
   here and it disabled the overscroll exactly when it was needed most: zoom out
   on 24h and the loaded buffer (1000 bars) is SMALLER than the pane at the 1px
   floor (1613 slots), so baseMaxOffset was 0, the overscroll was denied, and the
   drag was frozen with more history sitting one request away (Evgeniy, screenshot
   2026-07-27: T:50%, buffer entirely on screen, dragging right did nothing).
   The left wall is not the end of the asset's history - it is only the end of
   what has been downloaded, and panning into that gutter is what triggers the
   next fetch. */
export function computeOffsetBounds(len, visibleCount, canExtendLeft) {
  const baseMaxOffset = Math.max(0, len - visibleCount)
  const extraLeftBuffer = canExtendLeft ? Math.floor(visibleCount * OVERSCROLL_LEFT) : 0
  return {
    baseMaxOffset,
    maxOffset: baseMaxOffset + extraLeftBuffer,
    minOffset: -Math.floor(visibleCount * OVERSCROLL_RIGHT),
  }
}

// Offsets share the renderer's coordinate system: x subtracts rightEmptyCandles
// once. Including it in leftEmptyCandles too doubles future space on short buffers.
export function computeChartWindow(len, visibleCount, panOffset, canExtendLeft = false) {
  const { minOffset, maxOffset } = computeOffsetBounds(len, visibleCount, canExtendLeft)
  const clampedPanOffset = Math.max(minOffset, Math.min(maxOffset, panOffset))
  const endIndex = Math.min(len, Math.max(0, len - Math.floor(clampedPanOffset)))
  const startIndex = Math.max(0, endIndex - visibleCount)
  const rightEmptyCandles = clampedPanOffset < 0 ? Math.abs(Math.floor(clampedPanOffset)) : 0
  const leftEmptyCandles = Math.max(0, visibleCount - (endIndex - startIndex))
  return { clampedPanOffset, startIndex, endIndex, leftEmptyCandles, rightEmptyCandles }
}
