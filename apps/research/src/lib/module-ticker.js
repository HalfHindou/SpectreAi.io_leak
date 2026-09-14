/**
 * module-ticker — ONE interval for every countdown/age label in a page.
 *
 * Why this exists: a 1s `useNow` hook produces 1 React commit/sec with 0 DOM
 * mutations (measured on the trading token page); a per-row ticker multiplies
 * that by the row count. This registry writes `el.textContent` through refs
 * instead — zero setState, zero rAF, and it only writes when the formatted
 * string actually changed.
 *
 * Usage:
 *   const unregister = registerTick(el, (now) => fmtAgo(now - ts))
 *   // in cleanup: unregister()
 *
 * The interval is created on first registration, cleared on last, and skips
 * entirely while `document.hidden`. Callers that scroll out of view should
 * unregister via their own IntersectionObserver.
 */

const registry = new Set()
let intervalId = null

function tick() {
  if (document.hidden) return
  const now = Date.now()
  for (const entry of registry) {
    const next = entry.fmt(now)
    if (next !== entry.last) {
      entry.last = next
      entry.el.textContent = next
    }
  }
}

export function registerTick(el, fmt) {
  if (!el || typeof fmt !== 'function') return () => {}
  const entry = { el, fmt, last: null }
  registry.add(entry)
  // Paint immediately so the label never renders empty for up to a second.
  entry.last = fmt(Date.now())
  el.textContent = entry.last
  if (intervalId == null) intervalId = setInterval(tick, 1000)
  return () => {
    registry.delete(entry)
    if (registry.size === 0 && intervalId != null) {
      clearInterval(intervalId)
      intervalId = null
    }
  }
}
