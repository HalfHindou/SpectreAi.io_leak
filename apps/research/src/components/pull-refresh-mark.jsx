/**
 * PullRefreshMark — what you see while dragging a page down.
 *
 * DETERMINATE while your finger is down, INDETERMINATE once you let go. That
 * split is the whole design, and it is what separates a loader that feels like
 * software from one that feels decorative: while you are pulling, the app knows
 * exactly how far you have to go, so it shows you; the moment the work starts it
 * genuinely does not know how long, so it stops pretending.
 *
 * An SVG stroked arc, not a conic-gradient masked into a ring. A conic gradient
 * has to be masked to make a band, and the mask edge is a hairline that shimmers
 * against sub-pixel geometry at 2x/3x; a stroked circle is one crisp path at any
 * DPR, and `stroke-dashoffset` is the natural way to express progress.
 *
 * 🪤 NO LOGO IN HERE, deliberately. The founder asked for "nice UX or spectre
 * logo" and the logo half is not available: this repo has exactly two Spectre
 * raster marks — `round-logo.png`, which is the APP ICON (a black rounded plate
 * with the bird on it, so at 22px inside a ring it reads as a hole punched in
 * the page), and `logo-day-mode.png` / `spectre-logo-header.png`, which are
 * 640x169 WORDMARKS that squash illegibly into a square slot. There is no
 * transparent monochrome mark anywhere in the monorepo. A brand mark here needs
 * a real asset, not a plate cropped into a circle.
 */
import './pull-refresh-mark.css'

const R = 11
const CIRC = 2 * Math.PI * R
// The arc the spinner settles into. ~28% of the circle is the length that reads
// as "working" without reading as "nearly finished".
const SPIN_ARC = 0.72

export default function PullRefreshMark({ state, distance = 0, threshold = 64 }) {
  const refreshing = state === 'refreshing'
  const ready = state === 'threshold'
  // Clamped: the rubber band lets `distance` overshoot, and an arc that keeps
  // filling past a full circle reads as a bug.
  const progress = refreshing ? 1 : Math.max(0, Math.min(1, distance / threshold))

  return (
    <div
      className={`prm${refreshing ? ' prm--spin' : ''}${ready ? ' prm--ready' : ''}`}
      style={{ '--prm-p': progress }}
      aria-hidden="true"
    >
      <svg className="prm-svg" viewBox="0 0 28 28" width="28" height="28">
        <circle className="prm-track" cx="14" cy="14" r={R} />
        <circle
          className="prm-arc"
          cx="14"
          cy="14"
          r={R}
          strokeDasharray={CIRC}
          strokeDashoffset={refreshing ? CIRC * SPIN_ARC : CIRC * (1 - progress)}
        />
      </svg>
    </div>
  )
}
