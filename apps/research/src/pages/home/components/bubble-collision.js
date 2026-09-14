/**
 * bubble-collision.js — shared 2D force-relaxation for scatter bubbles.
 *
 * Both the Sector Rotation quadrant and the Narrative Lifecycle adoption curve
 * place bubbles at their true DATA position (momentum/volume, stage/curve), then
 * overlap freely. This runs an iterative pair-repulsion pass that spreads
 * overlapping bubbles apart in BOTH x and y while a weak spring pulls each one
 * back toward its real data position — so no two labels collide, yet every
 * bubble still reads as its momentum / volume / stage meaning.
 *
 * Pure + deterministic (no randomness), so it's safe to memoize on the bubble
 * set + container size. N is <= ~30, so O(n^2 * iters) is trivial.
 *
 * Input bubbles (pixel space, plot-relative — origin top-left):
 *   { x, y, halfW, halfH, ...rest }
 *   - x, y     : the TRUE data position (center of the bubble)
 *   - halfW    : half the collision box width  (max of circle radius and label chip half-width)
 *   - halfH    : half the collision box height. For an ALWAYS-labeled bubble this is
 *               circle radius + gap + label chip height (the chip below reserves space).
 *               For a HOVER-only bubble this is just the circle radius + a small pad —
 *               so most bubbles pack as small boxes and only the few notable ones claim
 *               the tall label room. Fewer tall boxes = the pack actually resolves to zero
 *               overlaps in a short plot (annotate the notable points, hover for the rest).
 * Returns the same objects with x/y relaxed (and x0/y0 = the original anchor).
 *
 * Options:
 *   W, H      : plot bounds in px (bubbles are clamped inside)
 *   iters     : relaxation passes (default 120 — separation must win over the anchor pull)
 *   spring    : pull-back-to-anchor strength per pass, 0..1 (default 0.05 — light, so the
 *               bubble still sits near its true data position but yields to separation)
 *   padding   : extra gap enforced between collision boxes in px (default 2)
 */
export function relaxBubbles(bubbles, { W, H, iters = 120, spring = 0.05, padding = 2 } = {}) {
  if (!Array.isArray(bubbles) || bubbles.length === 0) return []

  // Work on a copy so the caller's data objects stay untouched. Anchor = the
  // true data position we spring back toward.
  const n = bubbles.length
  const pts = bubbles.map((b) => {
    const halfW = Number.isFinite(b.halfW) ? Math.max(b.halfW, 1) : 1
    const halfH = Number.isFinite(b.halfH) ? Math.max(b.halfH, 1) : 1
    const x0 = Number.isFinite(b.x) ? b.x : W / 2
    const y0 = Number.isFinite(b.y) ? b.y : H / 2
    return { ...b, x: x0, y: y0, x0, y0, halfW, halfH }
  })

  const clamp = (p) => {
    p.x = Math.max(p.halfW, Math.min(W - p.halfW, p.x))
    p.y = Math.max(p.halfH, Math.min(H - p.halfH, p.y))
  }
  pts.forEach(clamp)

  // Single bubble: nothing to resolve, just clamp.
  if (n === 1) return pts

  for (let it = 0; it < iters; it++) {
    // 1) Weak spring toward the true data anchor (keeps meaning).
    for (let i = 0; i < n; i++) {
      const p = pts[i]
      p.x += (p.x0 - p.x) * spring
      p.y += (p.y0 - p.y) * spring
    }

    // 2) Pairwise separation on AABB overlap (label-box aware).
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pts[i]
        const b = pts[j]
        const minDX = a.halfW + b.halfW + padding
        const minDY = a.halfH + b.halfH + padding
        let dx = b.x - a.x
        let dy = b.y - a.y
        const overlapX = minDX - Math.abs(dx)
        const overlapY = minDY - Math.abs(dy)
        // Boxes only collide when they overlap on BOTH axes.
        if (overlapX <= 0 || overlapY <= 0) continue

        // Push apart along the axis of least penetration (smallest shove that
        // separates them) — spreads clusters in x AND y rather than stacking.
        if (overlapX < overlapY) {
          // Deterministic tiebreak when centers coincide.
          if (dx === 0) dx = a.x0 <= b.x0 ? -1 : 1
          const push = overlapX / 2 * (dx < 0 ? -1 : 1)
          a.x -= push
          b.x += push
        } else {
          if (dy === 0) dy = a.y0 <= b.y0 ? -1 : 1
          const push = overlapY / 2 * (dy < 0 ? -1 : 1)
          a.y -= push
          b.y += push
        }
      }
    }

    // 3) Keep everything inside the plot after each pass.
    pts.forEach(clamp)
  }

  return pts
}

/**
 * Estimate the on-screen half-width of a short label chip (below-bubble name +
 * delta badge), so the collision box reserves room for the label, not just the
 * circle. Rough but consistent: ~6px/char + badge + horizontal padding, capped.
 */
export function labelChipHalfWidth(text, { charPx = 6, extra = 40, max = 150 } = {}) {
  const len = (text || '').length
  return Math.min(max, len * charPx + extra) / 2
}

/**
 * Post-relaxation guarantee: no two always-on label CHIPS overlap. The 2D
 * relaxation spreads the CIRCLES, but when several labeled bubbles land at a
 * similar y (e.g. the top-N-by-volume sectors cluster in one volume band) their
 * wide below-bubble name chips still collide into a run-together strip. This
 * greedily keeps the chip on the biggest bubbles and demotes any chip that
 * still clashes to hover-only (the bubble keeps its in-circle code; its name
 * reveals on hover). Result: every always-on label is readable, never overlapped.
 *
 * `placed` items carry { x, y, labeled, size } + whatever `nameOf` reads.
 * Returns the same list with `labeled` flipped false on demoted bubbles.
 */
export function resolveLabelChips(placed, { nameOf, gap = 8, chipHalfH = 10 } = {}) {
  if (!Array.isArray(placed) || !placed.length) return placed
  const labeled = placed
    .filter((p) => p.labeled)
    .sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0)) // biggest keeps its chip
  const kept = []
  const keptSet = new Set()
  for (const p of labeled) {
    const r = (Number(p.size) || 0) / 2
    const box = {
      cx: p.x,
      cy: p.y + r + gap + chipHalfH,
      hw: labelChipHalfWidth(nameOf ? nameOf(p) : p.name) + 2,
      hh: chipHalfH + 2,
    }
    const clash = kept.some((k) => Math.abs(box.cx - k.cx) < box.hw + k.hw && Math.abs(box.cy - k.cy) < box.hh + k.hh)
    if (!clash) { kept.push(box); keptSet.add(p) }
  }
  return placed.map((p) => (p.labeled && !keptSet.has(p) ? { ...p, labeled: false } : p))
}
