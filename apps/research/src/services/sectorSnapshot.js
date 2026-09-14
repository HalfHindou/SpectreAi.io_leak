/**
 * sectorSnapshot — single source of truth for category-bucket market data.
 *
 * Replaces N parallel client-side `/api/coingecko/coins/markets?category=...`
 * fetches that were getting 429-rate-limited. Each consumer now triggers
 * one server round-trip; the server fans out, caches 5 min, and returns
 * the merged shape:
 *
 *   { sectors: [{ id, tokens: [{ symbol, sparkline: number[] }] }],
 *     cached_at: ISO }
 *
 * Module-level cache + in-flight dedup so concurrent mounts of different
 * consumers all join the same request.
 */

const TTL_MS = 5 * 60 * 1000
const _cache = new Map() // key -> { payload, ts }
const _inflight = new Map() // key -> Promise

function keyFor(categories) {
  if (!categories || !categories.length) return '__default__'
  return categories.slice().sort().join(',')
}

export async function getSectorSnapshot(categories) {
  const key = keyFor(categories)
  const cached = _cache.get(key)
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.payload
  if (_inflight.has(key)) return _inflight.get(key)

  const qs = categories?.length ? `?categories=${categories.join(',')}` : ''
  const promise = (async () => {
    try {
      const res = await fetch(`/api/market/sectors/snapshot${qs}`, {
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const payload = await res.json()
      _cache.set(key, { payload, ts: Date.now() })
      return payload
    } finally {
      _inflight.delete(key)
    }
  })()

  _inflight.set(key, promise)
  return promise
}

export function getCachedSectorSnapshot(categories) {
  const entry = _cache.get(keyFor(categories))
  if (!entry || Date.now() - entry.ts > TTL_MS) return null
  return entry.payload
}
