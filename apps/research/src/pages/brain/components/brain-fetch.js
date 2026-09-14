/**
 * brainGet — the shared /data-api reader for the live engine feeds.
 *
 * GET only, AbortSignal.timeout, in-flight dedupe (concurrent callers of the
 * same URL share one promise), and {data} envelope unwrap — returns the
 * unwrapped `data` object (or the raw body if no envelope). Returns null on
 * any non-2xx / abort / parse error so callers can render nothing.
 * Mirrors the fetch discipline of use-brain-desk.js.
 */
const inflight = new Map()

export function brainGet(url, timeoutMs = 15000) {
  if (inflight.has(url)) return inflight.get(url)
  const p = (async () => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (!r.ok) return null
      const j = await r.json()
      return j?.data ?? j ?? null
    } catch {
      return null
    } finally {
      inflight.delete(url)
    }
  })()
  inflight.set(url, p)
  return p
}
