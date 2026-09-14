/**
 * Ventures API service
 *
 * Thin wrapper around the Spectre Data Bridge (api.spectreai.io) for the
 * /v1/institutional/* and /v1/discovery/* endpoints consumed by the
 * Ventures page.
 *
 * URL routing:
 *   Dev:  /data-api/v1/... -> Vite proxy -> http://204.168.244.18/api/v1/...
 *   Prod: same rewrite via apps/research/vercel.json
 *
 * All functions return null / [] on failure (NEVER throw) per
 * .claude/rules/api-patterns.md F. The ventures page renders skeletons/empty
 * states while the backend endpoints are being built out.
 *
 * Cache + dedup mirrors the fearGreedApi.js / spectreDataApi.js pattern.
 */
const BASE = '/data-api'
const FETCH_TIMEOUT = 12000

const _cache = {}
const _inflight = {}

// sessionStorage write-through layer on top of the in-memory module cache.
// The module map dies on a hard reload, so without this a reload refetches
// ~170KB of scores cold. sessionStorage survives reloads (but not new tabs),
// giving an instant warm cache on F5. All access guarded - quota/private-mode
// failures fall back silently to memory-only behaviour.
const _SS_PREFIX = 'ventures-api:'

function _ssGet(key) {
  try {
    const raw = sessionStorage.getItem(_SS_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.ts !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function _ssSet(key, data) {
  try {
    sessionStorage.setItem(_SS_PREFIX + key, JSON.stringify({ data, ts: Date.now() }))
  } catch {
    // Quota exceeded / private mode - non-fatal, memory cache still works.
  }
}

function _getCached(key, ttlMs) {
  let entry = _cache[key]
  // Fall back to sessionStorage on a cold module map (e.g. after hard reload).
  if (!entry) {
    const ss = _ssGet(key)
    if (ss) {
      entry = { data: ss.data, ts: ss.ts }
      _cache[key] = entry // rehydrate the memory cache
    }
  }
  if (!entry) return null
  if (Date.now() - entry.ts > ttlMs) {
    delete _cache[key]
    return null
  }
  return entry.data
}

function _setCached(key, data) {
  _cache[key] = { data, ts: Date.now() }
  _ssSet(key, data) // write-through so a reload reads it back warm
}

async function _fetchJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
  if (!res.ok) throw new Error(`ventures-api ${res.status}: ${url}`)
  return res.json()
}

function _deduped(cacheKey, ttlMs, fetchFn) {
  const cached = _getCached(cacheKey, ttlMs)
  if (cached) return Promise.resolve(cached)
  if (_inflight[cacheKey]) return _inflight[cacheKey]

  const promise = fetchFn()
    .then((data) => {
      _setCached(cacheKey, data)
      delete _inflight[cacheKey]
      return data
    })
    .catch((err) => {
      delete _inflight[cacheKey]
      throw err
    })

  _inflight[cacheKey] = promise
  return promise
}

// TTLs - scores update slowly, prices update fast
const TTL = {
  scores: 2 * 60_000, // 2 min - full rankings list
  scoreDetail: 60_000, // 1 min - single project
  grayscale: 5 * 60_000, // 5 min - curated list
  upgrades: 5 * 60_000, // 5 min - movers
  compare: 2 * 60_000, // 2 min
  categories: 10 * 60_000, // 10 min - slow
  discoveryHot: 60_000, // 1 min
  discoveryNew: 2 * 60_000, // 2 min
  news: 3 * 60_000, // 3 min
}

/**
 * Unwrap common API envelope shapes: { data: [...] } or [...] directly.
 */
function _unwrap(json) {
  if (json == null) return null
  if (Array.isArray(json)) return json
  if (Array.isArray(json.data)) return json.data
  if (Array.isArray(json.results)) return json.results
  if (Array.isArray(json.items)) return json.items
  if (typeof json === 'object') return json
  return null
}

// ── Institutional scores ─────────────────────────────────────────────────

/**
 * GET /v1/institutional/scores
 * Returns the full ranking of scored projects with every score breakdown
 * field. May not exist yet during initial backend rollout - returns null
 * on 404/502 so the page falls back to skeletons.
 *
 * Expected row shape (loose - tolerate partial backend):
 *   { symbol, name, logo, category,
 *     score, grade, tier, score_change_7d,
 *     market_cap_usd, fdv_usd, volume_24h, price_usd,
 *     pct_change_24h, pct_change_7d, pct_change_30d,
 *     sub_scores: { market_maturity, liquidity, development,
 *                   onchain_health, narrative, institutional,
 *                   regulatory, tokenomics },
 *     insight_texts: { tvl, holders, dev_commits, ... } }
 */
/**
 * Rows the scoring backend is currently emitting that cannot be shown to anyone.
 *
 * 399 of the 500 rows /v1/institutional/scores returns are contract-suffixed
 * pseudo-symbols — SKYAI_0XF615, AIOT_0X3B7E, HENTAI_ACTXZ6, UFOTRUMP_C4RD3P,
 * GOOGLE AI_GBDVYP — and the market data attached to them is not physically
 * possible: a $1.2T market cap on $31k of daily volume, a 24h change of 1.9e17%.
 * They all score an identical 61.3, so they tie at the top of any ranking and
 * were landing in Featured Deals under "AI-curated top picks with strong
 * fundamentals", while their fake caps summed into the header's Total Market Cap
 * — which read $31.41T against a real crypto market nearer $3T.
 *
 * An exchange ticker does not contain an underscore. That single rule removes
 * every one of them, and the numeric checks catch the rest.
 *
 * The fix belongs upstream. Until it lands, the page refuses to print them.
 */
function isPresentableScoreRow(row) {
  const m = row?.market || {}
  // No real asset moves 1,000% in a day; these are 15 orders of magnitude past it.
  if (Math.abs(m.pct_change_24h || 0) > 1000) return false
  // A mega-cap with no volume is not a market. BTC's own ratio is ~40.
  if (m.market_cap > 1e9 && m.volume_24h > 0 && m.market_cap / m.volume_24h > 50_000) return false
  // "AIOT_0X3B7E" / "HENTAI_ACTXZ6" are row keys, not assets a reader can act on.
  if (String(row?.symbol || '').includes('_')) return false
  return true
}

export async function getInstitutionalScores({ limit = 200 } = {}) {
  return _deduped(`scores:${limit}`, TTL.scores, async () => {
    const json = await _fetchJSON(`${BASE}/v1/institutional/scores?limit=${limit}`)
    const rows = _unwrap(json)
    if (!Array.isArray(rows)) return []
    const clean = rows.filter(isPresentableScoreRow)
    if (clean.length !== rows.length) {
      console.warn(`[ventures] dropped ${rows.length - clean.length}/${rows.length} score rows with impossible market data`)
    }
    return clean
  }).catch(() => [])
}

/**
 * GET /v1/institutional/scores/:symbol
 * Single project deep dive data.
 */
export async function getInstitutionalScoreDetail(symbol) {
  if (!symbol) return null
  const sym = symbol.toUpperCase()
  return _deduped(`score-detail:${sym}`, TTL.scoreDetail, async () => {
    const json = await _fetchJSON(`${BASE}/v1/institutional/scores/${encodeURIComponent(sym)}`)
    return json?.data || json || null
  }).catch(() => null)
}

/**
 * GET /v1/institutional/grayscale-candidates
 * Grade A+ projects not yet in Grayscale's portfolio. Used for the
 * Institutional tab's "Grayscale Candidates" featured strip.
 */
export async function getGrayscaleCandidates() {
  return _deduped('grayscale-candidates', TTL.grayscale, async () => {
    const json = await _fetchJSON(`${BASE}/v1/institutional/grayscale-candidates`)
    const rows = _unwrap(json)
    return Array.isArray(rows) ? rows : []
  }).catch(() => [])
}

/**
 * GET /v1/institutional/upgrades?days=7
 * Recent tier/score changes. Used for the Growth tab "Fastest Risers" strip.
 *
 * Returns { signals, degraded }. The `degraded` flag matters: this route is
 * currently timing out in Postgres and answers either 502 or a 200 carrying
 * `meta.degraded: true` with zero rows. Both used to collapse to `[]`, and an
 * empty Market Pulse then told the reader "no downgrades — all stable", which
 * is a claim about the market made from a broken query.
 */
export async function getInstitutionalUpgrades({ days = 7 } = {}) {
  return _deduped(`upgrades:${days}`, TTL.upgrades, async () => {
    const json = await _fetchJSON(`${BASE}/v1/institutional/upgrades?days=${days}`)
    const rows = _unwrap(json) || []
    const signals = Array.isArray(json?.signals) ? json.signals : (Array.isArray(rows) ? rows : [])
    return { signals, degraded: Boolean(json?.meta?.degraded) && signals.length === 0 }
  }).catch(() => ({ signals: [], degraded: true }))
}

/**
 * GET /v1/institutional/compare?symbols=X,Y,Z
 * Side-by-side comparison for the deep dive modal's peer panel.
 */
export async function getInstitutionalCompare(symbols) {
  if (!symbols || symbols.length === 0) return []
  const clean = symbols.map((s) => String(s).toUpperCase()).join(',')
  return _deduped(`compare:${clean}`, TTL.compare, async () => {
    const json = await _fetchJSON(`${BASE}/v1/institutional/compare?symbols=${encodeURIComponent(clean)}`)
    const rows = _unwrap(json)
    return Array.isArray(rows) ? rows : []
  }).catch(() => [])
}

/**
 * GET /v1/institutional/categories
 * Per-category averages. Used for context strip / filters.
 */
export async function getInstitutionalCategories() {
  return _deduped('categories', TTL.categories, async () => {
    const json = await _fetchJSON(`${BASE}/v1/institutional/categories`)
    const rows = _unwrap(json)
    return Array.isArray(rows) ? rows : []
  }).catch(() => [])
}

// ── Discovery (on-chain fresh finds) ─────────────────────────────────────

/**
 * GET /v1/discovery/hot
 * Recent volume-spike signals.
 */
export async function getDiscoveryHot() {
  return _deduped('discovery:hot', TTL.discoveryHot, async () => {
    const json = await _fetchJSON(`${BASE}/v1/discovery/hot`)
    const rows = _unwrap(json)
    return Array.isArray(rows) ? rows : []
  }).catch(() => [])
}

/**
 * GET /v1/discovery/new
 * Recently discovered tokens.
 */
export async function getDiscoveryNew() {
  return _deduped('discovery:new', TTL.discoveryNew, async () => {
    const json = await _fetchJSON(`${BASE}/v1/discovery/new`)
    const rows = _unwrap(json)
    return Array.isArray(rows) ? rows : []
  }).catch(() => [])
}

// ── News for thesis context (per-token) ──────────────────────────────────

/**
 * GET /v1/news?symbol=EIGEN&limit=5
 * Recent news items for the deep dive modal. Accepts missing backend.
 */
export async function getVenturesNews(symbol, limit = 5) {
  if (!symbol) return []
  const sym = symbol.toUpperCase()
  return _deduped(`news:${sym}:${limit}`, TTL.news, async () => {
    const json = await _fetchJSON(`${BASE}/v1/news?symbol=${encodeURIComponent(sym)}&limit=${limit}`)
    const rows = _unwrap(json)
    return Array.isArray(rows) ? rows : []
  }).catch(() => [])
}

// ── Utility: safely merge backend row with seed overrides ─────────────────

/**
 * Some backend rows come back thin during rollout (just symbol + score).
 * This normalizes them to the shape the UI expects so every component
 * stays defensive. Missing fields become null, never undefined.
 */
export function normalizeScoreRow(raw) {
  if (!raw) return null
  return {
    symbol: raw.symbol || raw.asset || raw.ticker || null,
    name: raw.name || raw.project_name || null,
    logo: raw.logo || raw.logo_url || raw.image || null,
    category: raw.category || raw.sector || null,
    score: num(raw.score ?? raw.spectre_score ?? raw.overall_score),
    grade: raw.grade || gradeFromScore(raw.score ?? raw.spectre_score),
    tier: raw.tier || null,
    score_change_7d: num(raw.score_change_7d ?? raw.score_delta_7d),
    market_cap_usd: num(raw.market_cap_usd ?? raw.market_cap),
    fdv_usd: num(raw.fdv_usd ?? raw.fdv),
    volume_24h: num(raw.volume_24h ?? raw.total_volume_usd),
    exchange_count: num(raw.exchange_count ?? raw.exchanges),
    price_usd: num(raw.price_usd ?? raw.price),
    pct_change_24h: num(raw.pct_change_24h),
    pct_change_7d: num(raw.pct_change_7d),
    pct_change_30d: num(raw.pct_change_30d),
    holders: num(raw.holders ?? raw.holder_count),
    tvl_usd: num(raw.tvl_usd ?? raw.tvl),
    dev_commits_30d: num(raw.dev_commits_30d ?? raw.commits_30d),
    institutional_interest: raw.institutional_interest || null,
    smart_money: raw.smart_money || null,
    catalyst: raw.catalyst || null,
    sub_scores: normalizeSubScores(raw.sub_scores || raw.breakdown || {}),
    backers: Array.isArray(raw.backers) ? raw.backers : [],
    total_raised: raw.total_raised || raw.raised || null,
    latest_round: raw.latest_round || null,
    tokenomics: raw.tokenomics || null,
    ai_thesis: raw.ai_thesis || raw.thesis || null,
    bull_case: Array.isArray(raw.bull_case) ? raw.bull_case : [],
    bear_case: Array.isArray(raw.bear_case) ? raw.bear_case : [],
    conviction: num(raw.conviction),
    risk_level: raw.risk_level || null,
    score_history: Array.isArray(raw.score_history) ? raw.score_history : [],
    next_unlock: raw.next_unlock || null,
    insight_texts: raw.insight_texts || {},
  }
}

function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function normalizeSubScores(raw) {
  const keys = [
    'market_maturity',
    'liquidity',
    'development',
    'onchain_health',
    'narrative',
    'institutional',
    'regulatory',
    'tokenomics',
  ]
  const out = {}
  for (const k of keys) {
    out[k] = num(raw[k])
  }
  return out
}

/**
 * Derive a grade from a numeric score when the backend doesn't send one.
 * Matches the spec: 80-100 A+/A, 65-79 B, 50-64 C, 35-49 D, 0-34 F, 90+ S
 */
export function gradeFromScore(score) {
  const n = num(score)
  if (n == null) return null
  if (n >= 90) return 'S'
  if (n >= 80) return 'A'
  if (n >= 65) return 'B'
  if (n >= 50) return 'C'
  if (n >= 35) return 'D'
  return 'F'
}
