/**
 * DexScreener client.
 *
 * All DexScreener traffic goes through our server proxy (Express in dev,
 * Vercel function in prod) so:
 *   - browsers don't hit api.dexscreener.com directly and burn user IP quotas
 *   - one server-side cache is shared across all users of our app
 *   - addresses are CSV-batched (up to 30 per request) instead of one fetch
 *     per token
 *
 * Pattern lifted from fearGreedApi.js: per-key cache + in-flight dedup so
 * concurrent callers reuse one promise, plus a small static TTL.
 */

const CACHE_TTL_MS = 30_000
const FETCH_TIMEOUT_MS = 12_000

const _cache = {}     // { [key]: { data, ts } }
const _inflight = {}  // { [key]: Promise }

function _getCached(key) {
  const entry = _cache[key]
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL_MS) { delete _cache[key]; return null }
  return entry.data
}

function _setCached(key, data) {
  _cache[key] = { data, ts: Date.now() }
}

/**
 * Fetch DexScreener data for a batch of token addresses.
 *
 * @param {string[]} addresses - up to 30 token addresses (any chain)
 * @param {(string|null)[]} [chains] - optional canonical chain key per address
 *   (same index as `addresses`, from `canonicalChainKey`). When present the
 *   server queries DexScreener's chain-scoped endpoint and REJECTS pairs from
 *   other chains — the same contract address can be a different token on
 *   another chain (CULT/Ethereum vs RVLT/Polygon share 0xf0f9…), and the
 *   chain-blind batch endpoint also truncates at 30 pairs total. Callers that
 *   know the row's chain should always pass it.
 * @returns {Promise<Record<string, DexTokenInfo>>} keyed by lowercase address
 *
 * Returns `{}` on any error — callers can fall back to Codex-only data.
 */
export async function getDexScreenerTokens(addresses, chains) {
  if (!Array.isArray(addresses) || addresses.length === 0) return {}
  const seen = new Set()
  const entries = []
  addresses.forEach((a, i) => {
    const addr = String(a || '').trim()
    if (!addr) return
    const key = addr.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    entries.push({ addr, chain: String((Array.isArray(chains) && chains[i]) || '').trim().toLowerCase() })
  })
  if (entries.length === 0) return {}
  // Server caps at 30 anyway; truncate here so the cache key is bounded too.
  const capped = entries.slice(0, 30)
  const cacheKey = capped.map(e => `${e.addr}:${e.chain}`).sort().join(',')

  const cached = _getCached(cacheKey)
  if (cached) return cached
  if (_inflight[cacheKey]) return _inflight[cacheKey]

  const hasChains = capped.some(e => e.chain)
  const url = `/api/dexscreener-tokens?addresses=${encodeURIComponent(capped.map(e => e.addr).join(','))}`
    + (hasChains ? `&chains=${encodeURIComponent(capped.map(e => e.chain).join(','))}` : '')
  const promise = fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const tokens = data?.tokens || {}
      _setCached(cacheKey, tokens)
      return tokens
    })
    .catch((err) => {
      console.warn('[dexscreenerApi] batch fetch failed:', err?.message || err)
      return {}
    })
    .finally(() => {
      delete _inflight[cacheKey]
    })

  _inflight[cacheKey] = promise
  return promise
}
