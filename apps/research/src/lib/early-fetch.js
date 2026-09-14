/**
 * PR-3 (perf): adopter for the index.html early-fetch boot script.
 *
 * An inline <script> in index.html fires the page's critical API requests at
 * HTML-parse time - seconds before React boots on a cold load - and stores
 * the in-flight promises on window.__EARLY_FETCH keyed by EXACT request URL:
 *
 *   window.__EARLY_FETCH = {
 *     '/data-api/v1/rz/BTC/bootstrap': Promise<{ok, status, json} | null>,
 *     '/api/auth-gate?action=check':   Promise<{ok, status, json} | null>,
 *   }
 *
 * Service layers call consumeEarlyFetch(url) before hitting the network; a
 * hit is consumed exactly once (delete-on-read) so there is no double-fetch
 * and no stale reuse. A null/failed early result falls through to a normal
 * network fetch - the early fetch is purely a head start, never a gate.
 */
export function consumeEarlyFetch(url) {
  try {
    const map = typeof window !== 'undefined' && window.__EARLY_FETCH
    if (!map || !map[url]) return null
    const promise = map[url]
    delete map[url]
    return promise
  } catch {
    return null
  }
}
