/**
 * gate-cache.js — a response that required auth must never enter a SHARED cache.
 *
 * Every gate in this app runs INSIDE the serverless function, and the handlers
 * underneath it set `Cache-Control: public, s-maxage=…` so the CDN can serve
 * repeat visitors without paying a cold boot. Those two facts compose into a
 * bypass: the first gated caller populates an edge entry keyed on the URL alone,
 * and every anonymous request that lands on that edge inside the TTL is served
 * the payload without the function — and therefore without the gate — ever
 * running.
 *
 * Measured on production 2026-08-25: `/api/private/stats` and
 * `/api/private/preipo` answered anonymous callers with the real payloads (full
 * fundraising aggregates, all 47 pre-IPO companies) for hours, then 401'd with
 * `x-vercel-cache: MISS` once the entry aged out. 252 `s-maxage` declarations
 * across 58 handlers sit behind the same gate, so this was never one route's bug.
 *
 * What this keeps: the BROWSER cache. A client polling `/api/private/deals`
 * every two minutes still skips the network exactly as before, because
 * `private, max-age=N` is honoured per-user. What it removes is the shared copy
 * — the only half that can be served to somebody who never passed the gate.
 *
 * The cost is a cold boot for the first visitor to each region on a gated route.
 * If that cost is not worth paying for a given route, the answer is to declare it
 * demo-safe in data-api.js — an explicit decision that the data is public — not
 * to leave a gate that a warm edge entry walks straight through.
 */

/** `public, s-maxage=120, stale-while-revalidate=240` → `private, max-age=120`. */
export function privatizeCacheControl(value) {
  const raw = String(value == null ? '' : value).trim()
  if (!raw) return 'private, no-store'
  const lower = raw.toLowerCase()
  // A handler that already refuses caching is saying the right thing — leave it.
  if (lower.includes('no-store')) return raw

  // Keep the freshness window the handler chose, just make it the user's own.
  const sMaxAge = /(?:^|[\s,])s-maxage\s*=\s*(\d+)/i.exec(raw)?.[1]
  const maxAge = /(?:^|[\s,])max-age\s*=\s*(\d+)/i.exec(raw)?.[1]
  const ttl = maxAge ?? sMaxAge
  const parts = ['private']
  if (ttl != null) parts.push(`max-age=${ttl}`)
  else parts.push('no-store')
  if (/no-cache/i.test(raw)) parts.push('no-cache')
  if (/must-revalidate/i.test(raw)) parts.push('must-revalidate')
  return parts.join(', ')
}

/**
 * Wrap `res` so any cache header a downstream handler sets is downgraded to a
 * private one. Intercepting here means the 58 handlers below stay untouched and
 * a new one cannot reintroduce the bypass by forgetting a rule.
 */
export function sealGatedResponse(res) {
  if (!res || res.__spectreGateSealed) return res
  res.__spectreGateSealed = true

  const setHeader = res.setHeader.bind(res)
  res.setHeader = (name, value) => {
    const key = String(name).toLowerCase()
    // Vercel's edge reads these two before Cache-Control; both must refuse.
    if (key === 'cdn-cache-control' || key === 'vercel-cdn-cache-control') {
      return setHeader(name, 'no-store')
    }
    if (key === 'cache-control') {
      return setHeader(name, privatizeCacheControl(value))
    }
    return setHeader(name, value)
  }

  // Some handlers hand the whole header map to writeHead instead.
  if (typeof res.writeHead === 'function') {
    const writeHead = res.writeHead.bind(res)
    res.writeHead = (status, ...rest) => {
      for (const arg of rest) {
        if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
          for (const k of Object.keys(arg)) {
            const key = k.toLowerCase()
            if (key === 'cdn-cache-control' || key === 'vercel-cdn-cache-control') arg[k] = 'no-store'
            else if (key === 'cache-control') arg[k] = privatizeCacheControl(arg[k])
          }
        }
      }
      return writeHead(status, ...rest)
    }
  }

  // Nothing downstream set one at all → the edge still must not keep it.
  const end = res.end.bind(res)
  res.end = (...args) => {
    try {
      if (!res.headersSent && !res.getHeader('Cache-Control')) {
        setHeader('Cache-Control', 'private, no-store')
        setHeader('CDN-Cache-Control', 'no-store')
      }
    } catch { /* headers already flushed — nothing to seal */ }
    return end(...args)
  }

  return res
}

export default sealGatedResponse
