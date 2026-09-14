/**
 * engine-bits.js — small pure helpers for the CONSTELLATION ENGINE.
 * Kept out of the component file so the JSX stays readable.
 */

/* deterministic 0..1 hash from a string — stable jitter so the layout doesn't
   reshuffle between renders / refetches. (Mirrors the old view's hash01.) */
export function hash01(str) {
  let h = 2166136261
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 100000) / 100000
}

/* Layout space is in CSS-ish pixels (the worker thinks in px). We render in a
   world unit = px / WORLD_SCALE so the orthographic-ish perspective camera sits
   at a sane distance and the numbers stay small/stable for three. */
export const WORLD_SCALE = 100

export function pxToWorld(px) { return px / WORLD_SCALE }

/* Build per-cluster ring anchors (px space). Top hubs ring out from center;
   the layout breathes with stage size. Returns { [key]: {x,y} }. */
export function buildAnchors(hubs, w, h) {
  const cx = w / 2
  const cy = h / 2
  const n = hubs.length
  const rx = Math.max(150, w * 0.34)
  const ry = Math.max(130, h * 0.34)
  const anchors = {}
  hubs.forEach((hub, i) => {
    const ang = -Math.PI / 2 + (Math.PI * 2 * i) / Math.max(1, n)
    anchors[hub.key] = { x: cx + Math.cos(ang) * rx, y: cy + Math.sin(ang) * ry }
  })
  return anchors
}

/* ease for camera tweens — Apple keynote curve (matches --ease-out). */
export function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5) }

/* lerp */
export function lerp(a, b, t) { return a + (b - a) * t }
