/**
 * X Dash API client — trading app
 *
 * Thin wrapper over our /api/x-dash/* proxy endpoints (Express in dev,
 * Vercel serverless in prod). Dedupes in-flight requests and caches
 * responses client-side on top of the server cache. Never throws —
 * returns null on failure so callers can render empty states.
 *
 * Proxy paths (same in dev and prod):
 *   GET /api/x-dash/token/:cgId
 *   GET /api/x-dash/search?q=...
 *   GET /api/x-dash/narrative-tokens?narrative=...
 *   GET /api/x-dash/kols
 */

const _cache = {}      // { [cacheKey]: { data, ts } }
const _inflight = {}   // { [cacheKey]: Promise }
const FETCH_TIMEOUT = 15000

// Client-side TTLs (shorter than server TTLs so we refresh more often
// but still avoid spamming). The server caches for longer anyway.
const TTL = {
  token: 45 * 1000,         // 45s
  search: 2 * 60 * 1000,    // 2min
  narrative: 5 * 60 * 1000, // 5min
  kols: 5 * 60 * 1000,      // 5min
}

function _getCached(cacheKey, ttlMs) {
  const entry = _cache[cacheKey]
  if (!entry) return null
  if (Date.now() - entry.ts > ttlMs) {
    delete _cache[cacheKey]
    return null
  }
  return entry.data
}

function _setCached(cacheKey, data) {
  _cache[cacheKey] = { data, ts: Date.now() }
}

async function _fetchJSON(url, { signal } = {}) {
  const ctl = signal ? null : new AbortController()
  const timeoutId = ctl ? setTimeout(() => ctl.abort(), FETCH_TIMEOUT) : null
  try {
    const res = await fetch(url, {
      signal: signal || ctl.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      // 503 = upstream key missing; 502 = upstream unreachable; 400 = validation
      // Log once but don't throw — callers fall back to null.
      const body = await res.text().catch(() => '')
      console.warn(`[xDashApi] ${res.status} ${url}`, body.slice(0, 200))
      return null
    }
    return await res.json()
  } catch (err) {
    if (err.name === 'AbortError') return null
    console.warn(`[xDashApi] fetch failed ${url}:`, err.message)
    return null
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function _deduped(cacheKey, ttlMs, url, options = {}) {
  const cached = _getCached(cacheKey, ttlMs)
  if (cached) return Promise.resolve(cached)
  if (_inflight[cacheKey]) return _inflight[cacheKey]

  const promise = _fetchJSON(url, options)
    .then((data) => {
      if (data) _setCached(cacheKey, data)
      delete _inflight[cacheKey]
      return data
    })
    .catch((err) => {
      delete _inflight[cacheKey]
      console.warn('[xDashApi] dedup error:', err.message)
      return null
    })

  _inflight[cacheKey] = promise
  return promise
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Fetch token-level X intelligence.
 * @param {string} cgId - CoinGecko ID (e.g. "spectre-ai")
 * @param {object} opts - { force, authorScope, signal }
 * @returns {Promise<object|null>}
 */
export async function getTokenIntel(cgId, opts = {}) {
  if (!cgId || typeof cgId !== 'string') return null
  const safe = cgId.trim().toLowerCase()
  const { force = false, authorScope = '', signal } = opts
  const params = new URLSearchParams()
  if (force) params.set('force', 'true')
  if (authorScope) params.set('author_scope', authorScope)
  const qs = params.toString()
  const url = `/api/x-dash/token/${encodeURIComponent(safe)}${qs ? `?${qs}` : ''}`
  const cacheKey = `token:${safe}:${authorScope}`

  // Force bypasses client cache but still dedupes concurrent callers.
  if (force) {
    delete _cache[cacheKey]
  }
  return _deduped(cacheKey, TTL.token, url, { signal })
}

/**
 * Resolve a free-text query to token candidates. Primary use: resolving a
 * token.symbol to a cgId when token.cgId is null.
 * @param {string} q
 * @param {object} opts - { timeframe, ranking, signal }
 * @returns {Promise<object|null>}
 */
export async function searchTokens(q, opts = {}) {
  if (!q || typeof q !== 'string') return null
  const { timeframe = '24h', ranking = 'mentions', signal } = opts
  const params = new URLSearchParams({ q: q.trim(), timeframe, ranking })
  const url = `/api/x-dash/search?${params.toString()}`
  const cacheKey = `search:${q.trim().toLowerCase()}:${timeframe}:${ranking}`
  return _deduped(cacheKey, TTL.search, url, { signal })
}

/**
 * Fetch peer tokens inside a narrative.
 * @param {string} narrative
 * @param {object} opts - { timeframe, ranking, segment, perPage, signal }
 * @returns {Promise<object|null>}
 */
export async function getNarrativeTokens(narrative, opts = {}) {
  if (!narrative || typeof narrative !== 'string') return null
  const {
    timeframe = '24h',
    ranking = 'momentum',
    segment = 'all',
    perPage = 10,
    signal,
  } = opts
  const params = new URLSearchParams({
    narrative: narrative.trim(),
    timeframe,
    ranking,
    segment,
    per_page: String(Math.min(perPage, 25)),
  })
  const url = `/api/x-dash/narrative-tokens?${params.toString()}`
  const cacheKey = `narr:${narrative.trim().toLowerCase()}:${timeframe}:${ranking}:${segment}:${perPage}`
  return _deduped(cacheKey, TTL.narrative, url, { signal })
}

/**
 * Fetch the global KOL leaderboard. Used as a fallback context panel.
 * @param {object} opts - { timeframe, sort, perPage, signal }
 * @returns {Promise<object|null>}
 */
export async function getKols(opts = {}) {
  const { timeframe = '24h', sort = 'activity', perPage = 20, signal } = opts
  const params = new URLSearchParams({
    timeframe,
    sort,
    per_page: String(Math.min(perPage, 50)),
  })
  const url = `/api/x-dash/kols?${params.toString()}`
  const cacheKey = `kols:${timeframe}:${sort}:${perPage}`
  return _deduped(cacheKey, TTL.kols, url, { signal })
}

/**
 * Resolve a token to its cgId. First tries token.cgId, then falls back to
 * searching by symbol. Returns null if nothing matches.
 *
 * Only successful resolutions are cached in sessionStorage. Failures are
 * NOT negative-cached so a transient upstream 502 doesn't poison the
 * session for the rest of its lifetime.
 *
 * @param {object} token - { cgId, symbol, name }
 * @returns {Promise<string|null>}
 */
export async function resolveCgId(token) {
  if (!token) return null
  if (token.cgId) return String(token.cgId).toLowerCase()

  const symbol = token.symbol
  if (!symbol) return null

  // SessionStorage hit for re-opens within the same session
  const storageKey = `xdash_cgid:${symbol.toLowerCase()}`
  try {
    const cached = sessionStorage.getItem(storageKey)
    if (cached && cached !== '__null__') return cached
  } catch {
    /* sessionStorage blocked */
  }

  const res = await searchTokens(symbol)
  // Real shape: { tokens: [{ token: { cg_id, ... }, metrics, quality, ... }] }
  // Defensive fallbacks cover older shapes too.
  const first = res?.tokens?.[0]
  const cgId =
    first?.token?.cg_id ||
    first?.token?.cgId ||
    first?.cg_id ||
    first?.cgId ||
    null

  if (cgId) {
    try {
      sessionStorage.setItem(storageKey, cgId)
    } catch {
      /* blocked */
    }
  }
  return cgId
}

/**
 * Clear all client-side X Dash caches. Called on token switch to prevent
 * stale data leaking across tokens (same bug pattern as the Spectre/SEI
 * issue fixed earlier in LeftPanel).
 */
export function clearXDashCache() {
  for (const key of Object.keys(_cache)) delete _cache[key]
  // Don't cancel in-flight requests — they'll resolve and overwrite with fresh
  // data on the next call. Callers re-mount components on token change which
  // will re-trigger the fetches.
}
