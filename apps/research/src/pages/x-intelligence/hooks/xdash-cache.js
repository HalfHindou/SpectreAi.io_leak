/**
 * xdash-cache — shared TTL cache + in-flight dedup for the two X Dash endpoints
 * the X Intelligence galaxy hits hardest:
 *   - /api/xdash/token/{cgId}  (~270KB/page) — author enrichment + drill-down
 *   - /api/xdash/bootstrap                    — trending project seed
 *
 * Both `useCrawlGraph` (galaxy enrichment) and `useProjectGraph` (single-project
 * drill-down) fetch the SAME token pages, and `TrendingSection` + the crawl seed
 * both fetch bootstrap. Without a shared layer each re-runs the full fetch from
 * scratch (useProjectGraph had no cache at all → re-clicking a project re-paid
 * the entire page fan-out). This collapses identical requests within the TTL.
 *
 * Keys are canonical tuples (not raw URLs) so param ORDER / formatting
 * differences between callers don't split the cache.
 */

const TTL = 60 * 1000          // mirrors the server-side 60s cache
const MAX_ENTRIES = 120
const FETCH_TIMEOUT = 18000
const MAX_RETRIES = 3
const RETRY_DELAY = 800

const _cache = new Map()       // key -> { ts, data }
const _inflight = new Map()    // key -> Promise

function _getCached(key) {
  const hit = _cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.ts > TTL) { _cache.delete(key); return null }
  return hit.data
}

function _setCached(key, data) {
  _cache.set(key, { ts: Date.now(), data })
  if (_cache.size > MAX_ENTRIES) _cache.delete(_cache.keys().next().value)
}

async function _fetchJSON(url, attempt = 1) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })
  // Retry transient upstream 5xx (the token endpoint occasionally cold-starts).
  if (res.status >= 500 && attempt < MAX_RETRIES) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY * attempt))
    return _fetchJSON(url, attempt + 1)
  }
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

// Shared cache+dedup runner: cache hit → resolved promise; in-flight → the same
// promise; else fetch, cache on success, and clear the in-flight slot.
function _deduped(key, url) {
  const cached = _getCached(key)
  if (cached) return Promise.resolve(cached)
  const pending = _inflight.get(key)
  if (pending) return pending
  const p = _fetchJSON(url)
    .then((data) => { _setCached(key, data); _inflight.delete(key); return data })
    .catch((err) => { _inflight.delete(key); throw err })
  _inflight.set(key, p)
  return p
}

/**
 * Fetch one page of /api/xdash/token/{cgId}. Returns the raw JSON.
 * @param {string} cgId
 * @param {{ scope?: string, timeframe?: string, page?: number, perPage?: number }} opts
 */
export function fetchXdashTokenPage(cgId, { scope = 'all', timeframe, page = 1, perPage = 50 } = {}) {
  if (!cgId) return Promise.reject(new Error('cgId required'))
  const key = `tok:${cgId}|${scope}|${timeframe || ''}|${page}|${perPage}`
  const params = new URLSearchParams({ author_scope: scope, page: String(page), per_page: String(perPage) })
  if (timeframe) params.set('timeframe', timeframe)
  return _deduped(key, `/api/xdash/token/${encodeURIComponent(cgId)}?${params}`)
}

/**
 * Fetch /api/xdash/bootstrap (trending project seed). Returns the raw JSON.
 * @param {{ perPage?: number, timeframe?: string, ranking?: string, segment?: string }} opts
 */
export function fetchXdashBootstrap({ perPage = 20, timeframe = '24h', ranking = 'mentions', segment = 'all' } = {}) {
  const key = `boot:${perPage}|${timeframe}|${ranking}|${segment}`
  const params = new URLSearchParams({
    per_page: String(perPage), timeframe, ranking, segment,
  })
  return _deduped(key, `/api/xdash/bootstrap?${params}`)
}
