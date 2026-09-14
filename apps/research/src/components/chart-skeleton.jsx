/**
 * The chart loading state.
 *
 * Not a spinner. A spinner says "something is happening somewhere"; this says
 * "a chart is arriving, and it will be this shape" — the axis, the grid and the
 * plot area are all drawn at their real proportions, so when the data lands
 * nothing moves. The user reads the layout before the numbers exist, which is
 * most of the perceived speed.
 *
 * Two deliberate details:
 *
 *   it FADES, it does not pop — an instant swap between a full-contrast
 *   skeleton and a full-contrast chart reads as a flicker, so the skeleton
 *   fades out under the chart rather than being cut away
 *
 *   the sweep is a transform, not a background-position — animating
 *   background-position on a large surface repaints it every frame, which is
 *   the one thing a loading state must not do while the page is still busy
 *   parsing and drawing
 */

import './chart-skeleton.css'

export default function ChartSkeleton({ height = 320, label = 'Loading chart' }) {
  return (
    <div className="cskel" style={{ height }} role="status" aria-label={label}>
      <div className="cskel__grid" aria-hidden="true">
        <span /><span /><span /><span />
      </div>
      <div className="cskel__axis" aria-hidden="true">
        <span /><span /><span /><span />
      </div>
      {/* A plausible price path rather than a flat bar: a rectangle where a
          chart will be reads as a broken image. */}
      <svg className="cskel__trace" viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 72 L18 66 L36 74 L54 58 L72 63 L90 47 L108 54 L126 39 L144 45 L162 33 L180 41 L198 28 L216 35 L234 22 L252 30 L270 18 L288 25 L300 20" />
      </svg>
      <div className="cskel__sweep" aria-hidden="true" />
    </div>
  )
}
