/**
 * Research Backend API Service
 * Migrated from /ext-api (dead Haitam Cloud Run) to /api/* (Express + Vercel):
 *   /get-token-market-profile  → /api/token/market-profile  (CG /coins/{id} + Spectre sentiment)
 *   /market-scenario           → /api/token/market-scenario (graceful empty until Groq route lands)
 *   /token-fundamuntals        → /api/token/fundamentals    (graceful empty until Groq route lands)
 * Includes cache + in-flight deduplication per fearGreedApi pattern.
 */

const _cache = {}
const _inflight = {}
const NEG_TTL = 60 * 1000  // cache null/error for 60s so dead endpoints stop getting re-hit

function _getCached(key, ttlMs) {
  const entry = _cache[key]
  if (entry === undefined) return undefined
  const effectiveTtl = entry.data == null ? NEG_TTL : ttlMs
  if (Date.now() - entry.ts > effectiveTtl) { delete _cache[key]; return undefined }
  return entry.data
}

function _setCached(key, data) {
  _cache[key] = { data, ts: Date.now() }
}

const FETCH_TIMEOUT = 8000 // 8s - upstream is slow when alive, fast-fail when dead

async function _fetchJSON(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT), ...opts })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function _deduped(cacheKey, ttlMs, url, opts) {
  const cached = _getCached(cacheKey, ttlMs)
  if (cached !== undefined) return Promise.resolve(cached)
  if (_inflight[cacheKey]) return _inflight[cacheKey]
  const promise = _fetchJSON(url, opts)
    .then(data => { _setCached(cacheKey, data); return data })
    .catch(() => { _setCached(cacheKey, null); return null })
    .finally(() => { delete _inflight[cacheKey] })
  _inflight[cacheKey] = promise
  return promise
}

// TTLs
const PROFILE_TTL = 5 * 60 * 1000      // 5 min
const SCENARIO_TTL = 5 * 60 * 1000     // 5 min
const FUNDAMENTALS_TTL = 10 * 60 * 1000 // 10 min
const AI_MARKET_TTL = 5 * 60 * 1000    // 5 min

/**
 * GET /api/token/market-profile?cg_id=...
 * Returns: { token_details, intelligence_ai_analysis }
 */
export function getTokenMarketProfile(cgId) {
  if (!cgId) return Promise.resolve(null)
  return _deduped(
    `profile_${cgId}`,
    PROFILE_TTL,
    `/api/token/market-profile?cg_id=${encodeURIComponent(cgId)}`
  )
}

/**
 * GET /api/token/market-scenario?cg_id=...
 * Returns: { success, token, market_scenario }
 *
 * The original Haitam endpoint produced AI-generated bull/bear cases per token.
 * Until a Groq-backed local replacement ships, this returns a graceful
 * "not configured" envelope so consumers fall through cleanly.
 */
export function getMarketScenario(cgId) {
  if (!cgId) return Promise.resolve(null)
  return _deduped(
    `scenario_${cgId}`,
    SCENARIO_TTL,
    `/api/token/market-scenario?cg_id=${encodeURIComponent(cgId)}`
  )
}

/**
 * POST /api/token/fundamentals
 * Body: { token_details, intelligence_ai_analysis }
 * Returns: { overallGrade, fundamentals[], summary, positiveTags[], riskTags[] }
 *
 * Note: when the consumer is given a tokenProfile with `_source: 'spectre-market'`,
 * useTokenFundamentals returns synthetic grades locally and does not call this
 * endpoint. The endpoint is the fallback for non-spectre profiles only.
 */
export function getTokenFundamentals(tokenDetails, intelligenceAnalysis) {
  if (!tokenDetails) return Promise.resolve(null)
  const ticker = tokenDetails.ticker || tokenDetails.token_name || 'unknown'
  const cacheKey = `fundamentals_${ticker}`
  const cached = _getCached(cacheKey, FUNDAMENTALS_TTL)
  if (cached) return Promise.resolve(cached)
  if (_inflight[cacheKey]) return _inflight[cacheKey]

  const promise = _fetchJSON('/api/token/fundamentals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token_details: tokenDetails,
      intelligence_ai_analysis: intelligenceAnalysis || undefined,
    }),
  })
    .then(data => { _setCached(cacheKey, data); delete _inflight[cacheKey]; return data })
    .catch(err => { delete _inflight[cacheKey]; throw err })

  _inflight[cacheKey] = promise
  return promise
}

/**
 * GET /api/market/ai-market-text
 * Returns: { success, data: { response } }
 */
export function getAiMarketText() {
  return _deduped('ai-market-text', AI_MARKET_TTL, '/api/market/ai-market-text')
}
