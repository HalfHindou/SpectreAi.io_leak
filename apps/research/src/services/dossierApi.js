// Spectre Dossier API client. Thin fetch wrappers over /api/dossier/*.
// Every consumer (Monarch, AI Screener, /token, Projects) uses these helpers
// so the dossier stays the single source of truth.

const BASE = '/api/dossier'

// Short-TTL module cache + inflight dedup (fearGreedApi `_deduped` pattern).
// Keyed by the request path so chain/ca/layer all stay distinct. Stops a token
// re-visit from re-running the blocking enrichment, and collapses concurrent
// mounts (panel + candles) of the same token onto one request.
const _cache = {}     // { [key]: { data, ts } }
const _inflight = {}  // { [key]: Promise }

function _getCached(key, ttlMs) {
  const entry = _cache[key]
  if (!entry) return null
  if (Date.now() - entry.ts > ttlMs) { delete _cache[key]; return null }
  return entry.data
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(10000) })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    const err = new Error(`Dossier ${r.status}: ${text.slice(0, 200)}`)
    err.status = r.status
    throw err
  }
  return r.json()
}

// Cached GET — returns cached data, joins an inflight request, or starts a new
// one. Cache key defaults to the path so it stays scoped per chain/ca/layer.
function getCached(path, ttlMs, key = path) {
  const cached = _getCached(key, ttlMs)
  if (cached) return Promise.resolve(cached)
  if (_inflight[key]) return _inflight[key]
  const promise = get(path)
    .then((data) => { _cache[key] = { data, ts: Date.now() }; delete _inflight[key]; return data })
    .catch((err) => { delete _inflight[key]; throw err })
  _inflight[key] = promise
  return promise
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    const err = new Error(`Dossier ${r.status}: ${text.slice(0, 200)}`)
    err.status = r.status
    throw err
  }
  return r.json()
}

export const dossier = {
  health: () => get('/health'),
  search: (q) => get(`/search?q=${encodeURIComponent(q || '')}`),
  // Cache keyed by chain/ca only (not the ?stream flag) with a 15s TTL: a token
  // re-visit or a concurrent mount reuses the last full dossier instead of
  // re-running the blocking enrichment; cadenced polls past the TTL still refresh.
  lookup: (chain, ca, { stream = false } = {}) => {
    const path = `/${encodeURIComponent(chain)}/${encodeURIComponent(ca)}${stream ? '?stream=true' : ''}`
    return getCached(path, 15000, `lookup:${chain}/${ca}`)
  },
  layer: (chain, ca, layer) => getCached(`/${encodeURIComponent(chain)}/${encodeURIComponent(ca)}/${encodeURIComponent(layer)}`, 15000, `layer:${chain}/${ca}/${layer}`),
  marketSeries: (chain, ca, { hours = 24 } = {}) => get(`/${encodeURIComponent(chain)}/${encodeURIComponent(ca)}/market/series?hours=${hours}`),
  marketCandles: (chain, ca, { hours = 24, resolution = '60' } = {}) => get(`/${encodeURIComponent(chain)}/${encodeURIComponent(ca)}/market/candles?hours=${hours}&resolution=${encodeURIComponent(resolution)}`),
  pools: (chain, ca) => get(`/${encodeURIComponent(chain)}/${encodeURIComponent(ca)}/pools`),
  bubblemaps: (chain, ca) => get(`/${encodeURIComponent(chain)}/${encodeURIComponent(ca)}/bubblemaps`),
  batch: (refs) => post('/batch', { refs }),
  signals: ({ kind = null, chain = null, minScore = 0, limit = 50 } = {}) => {
    const p = new URLSearchParams()
    if (kind) p.set('kind', kind)
    if (chain) p.set('chain', chain)
    if (minScore) p.set('minScore', String(minScore))
    if (limit) p.set('limit', String(limit))
    return get(`/signals?${p.toString()}`)
  },
  brainAnnotations: ({ chain = null, kind = null, limit = 50 } = {}) => {
    const p = new URLSearchParams()
    if (chain) p.set('chain', chain)
    if (kind) p.set('kind', kind)
    if (limit) p.set('limit', String(limit))
    return get(`/_brain/annotations?${p.toString()}`)
  },
  refreshSafety: (chain, ca) => post(`/${chain}/${ca}/safety/check`),
  refreshSocials: (chain, ca) => post(`/${chain}/${ca}/socials/refresh`),
  refreshFlows: (chain, ca) => post(`/${chain}/${ca}/flows/refresh`),
  generateLore: (chain, ca, { force = false } = {}) => post(`/${chain}/${ca}/lore/generate${force ? '?force=true' : ''}`),
  workers: () => get('/admin/workers'),
  sources: () => get('/admin/sources'),
  // Drop the cached lookup for a token so the next lookup() refetches. Call
  // after a user-triggered enrichment (Refresh all) where the 15s cache could
  // otherwise serve pre-enrichment data.
  invalidate: (chain, ca) => { delete _cache[`lookup:${chain}/${ca}`] },
}

export default dossier
