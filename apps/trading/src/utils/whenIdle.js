/**
 * whenIdle — run a callback once the main thread is idle, so non-critical
 * work (list sparklines, watchlist prefetch) yields the network + CPU to
 * the token page's critical path (chart bars, token details, snapshot)
 * during the first ~1.5s of load.
 *
 * Why this matters: localhost dev + many production setups speak HTTP/1.1
 * to the API origin (6-connection cap). A token page cold-load fires ~20
 * /api/bars requests — main chart + N watchlist sparklines + M trending
 * sparklines + watchlist prefetch. Without prioritisation the main
 * chart's bars request queues BEHIND a dozen decorative sparkline calls.
 * Deferring the decoration until idle lets the chart own the connection
 * pool when it matters.
 *
 * Falls back to setTimeout where requestIdleCallback is absent (Safari).
 * Returns a cancel function.
 */
export function whenIdle(cb, { timeout = 2000 } = {}) {
  if (typeof window === 'undefined') {
    cb()
    return () => {}
  }
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(cb, { timeout })
    return () => window.cancelIdleCallback?.(id)
  }
  // Safari / older browsers: a short timer approximates "after first paint".
  const id = window.setTimeout(cb, Math.min(timeout, 1200))
  return () => window.clearTimeout(id)
}
