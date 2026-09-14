/**
 * Shared cache for /api/xdash/author/{handle}.
 *
 * ZigFounderTweets and ZigEpisodes both pull the founder's recent posts
 * (HANDLE 'ARafayGadit'). Without a shared cache they each fire their own raw
 * fetch on the same handle, doubling the call on every /zigchain visit.
 *
 * One module-level cache (60s TTL) + an inflight Map keyed by handle lets both
 * components reuse a single network request and the cached payload thereafter.
 * Returns the raw JSON payload; each consumer normalizes it as it needs.
 */

const TTL_MS = 60_000
const _cache = new Map()    // handle -> { ts, payload }
const _inflight = new Map() // handle -> Promise<payload|null>

/**
 * Fetch (or reuse) the X-Dash author payload for a handle.
 * Resolves to the raw JSON payload, or null on failure / non-ok response.
 * Deliberately NOT tied to a caller AbortSignal: a shared fetch must survive
 * one consumer unmounting so the other still gets the payload. Callers that
 * unmount simply ignore the resolved value (guarded by their own effect).
 */
export function getXDashAuthor(handle) {
  const key = String(handle)
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.ts < TTL_MS) return Promise.resolve(hit.payload)

  const inflight = _inflight.get(key)
  if (inflight) return inflight

  const p = fetch(`/api/xdash/author/${encodeURIComponent(key)}`, { credentials: 'include',
    headers: { Accept: 'application/json' },
  })
    .then(async (r) => {
      if (!r.ok) return null
      const json = await r.json()
      _cache.set(key, { ts: Date.now(), payload: json })
      return json
    })
    .catch(() => null)
    .finally(() => { _inflight.delete(key) })

  _inflight.set(key, p)
  return p
}
