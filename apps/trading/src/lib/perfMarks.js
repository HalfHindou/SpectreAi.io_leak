/**
 * perfMarks — thin User Timing wrapper.
 *
 * Phase H: instrument the token-page critical path so we can verify
 * the Phase A-G gains land in DevTools → Performance → User Timing.
 *
 * Marks fire as `spectre:<name>` so they all group together in the
 * timeline. Measures from selectToken → banner, selectToken → chart
 * bars are auto-computed when those marks fire.
 *
 * No-ops gracefully in environments without performance.mark.
 */

const SUPPORTED = typeof performance !== 'undefined' && typeof performance.mark === 'function'

export function mark(name) {
  if (!SUPPORTED) return
  try { performance.mark(`spectre:${name}`) } catch { /* noop */ }
}

export function measure(name, startMark, endMark) {
  if (!SUPPORTED) return null
  try {
    const entries = performance.measure(
      `spectre:${name}`,
      `spectre:${startMark}`,
      `spectre:${endMark}`
    )
    return entries
  } catch { return null }
}

/**
 * Mark + auto-measure from a previous mark. Convenience for the
 * common case "mark X just happened, measure how long since Y".
 */
export function markAndMeasure(name, fromMark) {
  mark(name)
  return measure(`${fromMark}-to-${name}`, fromMark, name)
}
