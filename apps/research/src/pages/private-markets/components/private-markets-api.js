/**
 * Private Markets API client
 *
 * Thin wrapper around the live Spectre fundraising routes with legacy
 * /api/private/* fallbacks. NEVER throws per .claude/rules/api-patterns.md F —
 * callers treat `null` / `[]` as "no data yet, show skeleton".
 */

const BASE = '/api/private'
const ACCEL_BASE = '/api/accelerators'
const FETCH_TIMEOUT = 12_000

const _cache = {}
const _inflight = {}

// Keys that get a localStorage write-through so a cold load paints from the
// last-good payload instead of a skeleton. Short TTLs — this is an instant-paint
// seed, not a source of truth (the network fetch still runs and overwrites).
const _PERSIST = {
  deals: 5 * 60_000,
  stats: 10 * 60_000,
  preipo: 30 * 60_000,
}
const _LS_PREFIX = 'pm:cache:'

// Returns { data, ts } (original write time) so the caller's TTL check decides
// freshness — or null when missing / past the persist TTL / unparseable.
function _lsGet(key) {
  const ttl = _PERSIST[key]
  if (!ttl || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(_LS_PREFIX + key)
    if (!raw) return null
    const entry = JSON.parse(raw)
    if (!entry || Date.now() - entry.ts > ttl) return null
    return entry
  } catch {
    return null
  }
}
function _lsSet(key, data) {
  if (!_PERSIST[key] || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(_LS_PREFIX + key, JSON.stringify({ data, ts: Date.now() }))
  } catch {
    // quota / private-mode / serialization — seed is best-effort.
  }
}

function _getCached(key, ttlMs) {
  let entry = _cache[key]
  // Module memory missed (cold load / page revisit) — hydrate from the
  // persisted seed, keeping its ORIGINAL timestamp so the TTL check below still
  // applies. A stale-but-present seed paints instantly; the TTL gate then lets
  // _deduped refetch in the background when it's expired.
  if (!entry) {
    const seeded = _lsGet(key)
    if (seeded) {
      entry = { data: seeded.data, ts: seeded.ts }
      _cache[key] = entry
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
  _lsSet(key, data)
}

async function _fetchJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
  if (!res.ok) throw new Error(`private-markets ${res.status}: ${url}`)
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

const TTL = {
  deals: 2 * 60_000,
  stats: 5 * 60_000,
  news: 5 * 60_000,
  company: 30 * 60_000,
  preipo: 30 * 60_000,
  tweets: 3 * 60_000,
}

/**
 * GET /api/private/stats
 * Aggregate fundraising stats from the Spectre Data API (total rounds,
 * total raised, unique projects, by-round-type breakdown). Used for the
 * page header — these numbers represent the entire dataset, not just the
 * deals currently rendered.
 */
export async function getPrivateStats() {
  return _deduped('stats', TTL.stats, async () => {
    const json = await _fetchJSON(`${BASE}/stats`)
    return json?.data || null
  }).catch(() => null)
}

/**
 * GET /api/private/deals
 * Merged SEC EDGAR + RSS feed, normalized for the Deal Feed surface.
 * Returns [] on error.
 */
export async function getPrivateDeals() {
  return _deduped('deals', TTL.deals, async () => {
    const json = await _fetchJSON(`${BASE}/deals`)
    return Array.isArray(json?.data) ? json.data : []
  }).catch(() => [])
}

/**
 * GET /api/private/funding-news
 * Raw RSS funding news with amount / sector / round type extracted.
 */
export async function getFundingNews() {
  return _deduped('funding-news', TTL.news, async () => {
    const json = await _fetchJSON(`${BASE}/funding-news`)
    return Array.isArray(json?.data) ? json.data : []
  }).catch(() => [])
}

/**
 * GET /api/private/companies/:slug
 * Crunchbase company lookup. Returns null when key not configured (fallback mode).
 */
export async function getCompanyBySlug(slug) {
  if (!slug) return null
  return _deduped(`company:${slug}`, TTL.company, async () => {
    const json = await _fetchJSON(`${BASE}/companies/${encodeURIComponent(slug)}`)
    return json?.data || null
  }).catch(() => null)
}

/**
 * GET /api/private/valuation-history/:company
 * Historical funding rounds + post-money valuations for the Phase 2 chart.
 * Returns { company, rounds, totalRaised, latestValuation, firstRound, lastRound }.
 */
export async function getValuationHistory(company) {
  if (!company) return null
  return _deduped(`val:${company}`, TTL.company, async () => {
    const json = await _fetchJSON(`${BASE}/valuation-history/${encodeURIComponent(company)}`)
    if (json?.data?.rounds?.length) return json.data
    // The dedicated endpoint only covers the curated valuation seed, so clicking
    // any other company in the deal feed used to dead-end on a message telling
    // the reader to go edit that seed. The PRE-IPO ROSTER already carries a
    // priced-round ladder for hundreds more names, from the same underlying
    // raise history - so ask it before giving up.
    return (await rosterHistory(company)) || json?.data || null
  }).catch(() => null)
}

/** Build the valuation-history shape out of a pre-IPO roster entry. */
async function rosterHistory(company) {
  const want = String(company).trim().toLowerCase()
  if (!want) return null
  const { roster } = await getPreIPO()
  const hit = (roster || []).find((r) => String(r.company).trim().toLowerCase() === want)
  const series = Array.isArray(hit?.valuationSeries) ? hit.valuationSeries : []
  if (!series.length) return null
  const rounds = series
    .filter((r) => r && r.date)
    .map((r) => ({
      date: r.date,
      valuationUsd: r.valuationUsd,
      amountUsd: r.amountUsd,
      round: r.roundType,
      roundType: r.roundType,
    }))
  if (!rounds.length) return null
  return {
    company: hit.company,
    rounds,
    totalRaised: hit.totalRaised ?? null,
    latestValuation: hit.currentValuation ?? null,
    source: 'preipo-roster',
  }
}

// ─── Accelerators ────────────────────────────────────────────────────────────

/**
 * GET /api/accelerators/all?crypto=true
 * Merged YC + Hub71 feed with crypto filter.
 */
export async function getAccelerators({ cryptoOnly = true } = {}) {
  const key = `accel:all:${cryptoOnly ? 1 : 0}`
  return _deduped(key, 10 * 60_000, async () => {
    const q = cryptoOnly ? '?crypto=true' : ''
    const json = await _fetchJSON(`${ACCEL_BASE}/all${q}`)
    return {
      companies: Array.isArray(json?.data) ? json.data : [],
      total: json?.total || 0,
      counts: json?.counts || {},
    }
  }).catch(() => ({ companies: [], total: 0, counts: {}, unavailable: true }))
}

// ─── Pre-IPO ───────────────────────────────────────────────────────────────

/**
 * GET /api/private/preipo
 * Curated late-stage / pre-IPO roster derived server-side from the funding
 * seed + unicorn board. Returns { roster, summary }. [] on error.
 */
export async function getPreIPO() {
  return _deduped('preipo', TTL.preipo, async () => {
    const json = await _fetchJSON(`${BASE}/preipo`)
    return {
      roster: Array.isArray(json?.data) ? json.data : [],
      summary: json?.summary || null,
    }
  }).catch(() => ({ roster: [], summary: null }))
}

// ─── Live stock quote (for companies that are now public) ───────────────────

/**
 * GET /api/stocks/quotes?symbols=SPCX
 * Realtime quote for a ticker. Returns { symbol, price, previousClose,
 * change(%), volume, marketCap, exchange, name } or null.
 */
export async function getCompanyQuote(ticker) {
  const sym = String(ticker || '').replace(/^\$/, '').toUpperCase()
  if (!sym) return null
  return _deduped(`quote:${sym}`, 25_000, async () => {
    const json = await _fetchJSON(`/api/stocks/quotes?symbols=${encodeURIComponent(sym)}`)
    return json?.[sym] || null
  }).catch(() => null)
}

// ─── Per-company news (market coverage, not tweets) ─────────────────────────

function _normalizeNews(list, mapper) {
  return (Array.isArray(list) ? list : []).map(mapper).filter((n) => n && n.headline && n.url)
}

// English filter — Finnhub company-news is multilingual. Polish is ~95% ASCII
// so a ratio test misses it; instead reject any text containing characters
// outside Basic-Latin + Latin-1 (Latin-Extended ł/ą/ę/ś/ż, Cyrillic, Greek,
// CJK, Japanese, Korean) or from a clearly-localized source.
const _NON_EN_CHARS = /[Ā-ɏͰ-ϿЀ-ԯ一-鿿぀-ヿ가-힯]/
const _NON_EN_SOURCE = /\bpol(?:and|ska|ski)\b|\.pl\b|wyborcza|strefa\s?inwestor|bankier|deutsch|español|fran[cç]ais|россия|中国|日本/i
function _looksEnglish(headline, source) {
  if (_NON_EN_CHARS.test(`${headline || ''} ${source || ''}`)) return false
  if (_NON_EN_SOURCE.test(source || '')) return false
  return true
}

/**
 * Merged realtime news for a company: Google News (English market coverage,
 * primary) + Finnhub stock news (when public) + the funding-news RSS filtered
 * to this company. English-only, de-duped by URL, newest first. [] on failure.
 */
export async function getCompanyNews(company, ticker) {
  const name = String(company || '').trim()
  if (!name) return []
  const sym = ticker ? String(ticker).replace(/^\$/, '').toUpperCase() : null
  const q = name.toLowerCase()
  return _deduped(`conews:${q}:${sym || ''}`, TTL.news, async () => {
    const [google, funding, stock] = await Promise.all([
      _fetchJSON(`/api/company-news?q=${encodeURIComponent(name)}`).catch(() => []),
      getFundingNews(),
      sym
        ? _fetchJSON(`/api/stocks/news/${encodeURIComponent(sym)}`).catch(() => [])
        : Promise.resolve([]),
    ])
    // Google News (already English, source-stripped headlines) — the primary
    // market-summary feed.
    const fromGoogle = _normalizeNews(google, (n) => ({
      id: `g-${n.url}`,
      headline: n.headline,
      url: n.url,
      source: n.source || 'News',
      image: null,
      summary: n.summary || '',
      date: n.date || 0,
    }))
    // Finnhub stock news. Field shapes differ by env: prod serverless uses
    // headline/datetime, the dev Express stocks route uses title/publishedAt.
    const fromStock = _normalizeNews(stock, (n) => ({
      id: `s-${n.id || n.url}`,
      headline: n.headline || n.title,
      url: n.url,
      source: n.source || 'News',
      image: n.image || null,
      summary: n.summary || '',
      date: n.datetime ? n.datetime * 1000 : n.publishedAt ? Date.parse(n.publishedAt) : 0,
    }))
    const fromFunding = _normalizeNews(
      (funding || []).filter(
        (n) => (n.company || '').toLowerCase() === q || (n.headline || '').toLowerCase().includes(q)
      ),
      (n) => ({
        id: `f-${n.id || n.link}`,
        headline: n.headline,
        url: n.link,
        source: n.source || 'Funding',
        image: n.logoUrl || null,
        summary: n.description || '',
        date: n.publishedAt ? Date.parse(n.publishedAt) : 0,
      })
    )
    const seen = new Set()
    return [...fromGoogle, ...fromStock, ...fromFunding]
      .filter((n) => _looksEnglish(n.headline, n.source))
      .filter((n) => {
        if (seen.has(n.url)) return false
        seen.add(n.url)
        return true
      })
      .sort((a, b) => (b.date || 0) - (a.date || 0))
      .slice(0, 16)
  }).catch(() => [])
}

// ─── Prediction markets (Polymarket + Kalshi via /api/predictions) ──────────

/**
 * Live prediction markets matching the keyword(s) from BOTH Polymarket (Gamma,
 * volume-ranked) and Kalshi. Returns { polymarket: Market[], kalshi: Market[] }
 * where Market = { id, question, subtitle, url, volume, outcomes:[{label,prob}],
 * source }. Normalized server-side. Empty arrays on failure.
 */
export async function getPredictions(query) {
  const q = String(query || '').trim()
  if (!q) return { polymarket: [], kalshi: [] }
  return _deduped(`pred:${q.toLowerCase()}`, 2 * 60_000, async () => {
    const json = await _fetchJSON(`/api/predictions?q=${encodeURIComponent(q)}`)
    return {
      polymarket: Array.isArray(json?.polymarket) ? json.polymarket : [],
      kalshi: Array.isArray(json?.kalshi) ? json.kalshi : [],
    }
  }).catch(() => ({ polymarket: [], kalshi: [] }))
}

// ─── Linked tweets (via X Dash tweet proxy) ─────────────────────────────────
//
// Two upstream shapes are normalized into one Tweet object so the UI renders a
// single TweetCard regardless of source:
//   - /api/tweets/search?query=  → flat array (rpapi search proxy)
//   - /api/tweets/official?username= → { author, tweets[] }
// Both are auth-gated server-side; in dev the AuthGate is bypassed on localhost.

function _num(v) {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

function _normalizeSearchTweet(t, i) {
  if (!t) return null
  const id = t.tweet_id || t.id || `s-${i}`
  const username = (t.username || t.screen_name || t.author_handle || '').replace(/^@/, '')
  const text = t.tweet_text || t.full_text || t.text || ''
  const url =
    t.tweet_url ||
    t.x_url ||
    (id && username ? `https://x.com/${username}/status/${id}` : null)
  if (!text && !url) return null
  return {
    id: String(id),
    text,
    url,
    username,
    name: t.name || t.author || username,
    avatar: t.ProfilePic || t.profile_image || t.avatar_image_url || t.author_avatar || null,
    date: t.date || t.created_at || '',
    likes: _num(t.like_count ?? t.likes),
    retweets: _num(t.retweet_count ?? t.retweets),
    replies: _num(t.reply_count ?? t.comments),
    views: _num(t.views),
    media: t.media_url_https || t.media_url || null,
    verified: false,
    promoted: !!t.is_promoted,
    source: 'search',
  }
}

/**
 * Search recent tweets matching a free-text query (company name / cashtag).
 * Returns a normalized Tweet[] (newest-relevant first), [] on failure.
 */
export async function searchTweets(query, { limit = 24 } = {}) {
  const q = String(query || '').trim()
  if (!q) return []
  return _deduped(`tweets:search:${q.toLowerCase()}`, TTL.tweets, async () => {
    const enc = encodeURIComponent(q)
    const urls = import.meta.env.DEV
      ? [`/api/tweets/search?query=${enc}`, `/tweets-api/api/tweets/search?query=${enc}`]
      : [`/api/tweets/search?query=${enc}`]
    for (const url of urls) {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) }).catch(() => null)
      if (!res?.ok) continue
      const data = await res.json().catch(() => null)
      const rows = Array.isArray(data) ? data : data?.tweets || data?.data || []
      if (Array.isArray(rows) && rows.length) {
        const out = rows
          .map(_normalizeSearchTweet)
          .filter(Boolean)
          .filter((t) => !t.promoted)
        if (out.length) return out.slice(0, limit)
      }
    }
    return []
  }).catch(() => [])
}

/**
 * Fetch an account's official timeline. Returns { author, tweets[] }.
 * author = { name, handle, avatar, banner, verified, followers, bio }.
 */
export async function getOfficialTweets(username, { limit = 12 } = {}) {
  const handle = String(username || '').replace(/^@/, '').trim()
  if (!handle) return { author: null, tweets: [] }
  return _deduped(`tweets:official:${handle.toLowerCase()}`, TTL.tweets, async () => {
    const enc = encodeURIComponent(handle)
    const urls = import.meta.env.DEV
      ? [`/api/tweets/official?username=${enc}`, `/tweets-api/api/tweets/official?username=${enc}`]
      : [`/api/tweets/official?username=${enc}`]
    for (const url of urls) {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) }).catch(() => null)
      if (!res?.ok) continue
      const data = await res.json().catch(() => null)
      if (!data) continue
      const a = data.author || {}
      const author = {
        name: a.name || handle,
        handle: (a.screen_name || handle).replace(/^@/, ''),
        avatar: a.avatar_image_url || a.profile_image_url || null,
        banner: a.profile_banner_url || null,
        verified: !!a.account_state?.is_blue_verified,
        followers: _num(a.followers_count ?? a.followers),
        bio: a.description || null,
      }
      const rows = Array.isArray(data.tweets) ? data.tweets : []
      const tweets = rows
        .map((t, i) => {
          const id = t.tweet_id || t.id || `o-${i}`
          const text = t.tweet_text || t.full_text || t.text || ''
          const url =
            t.tweet_url ||
            t.x_url ||
            (t.tweet_id ? `https://x.com/${author.handle}/status/${t.tweet_id}` : null)
          if (!text && !url) return null
          return {
            id: String(id),
            text,
            url,
            username: t.username || author.handle,
            name: author.name,
            avatar: t.profile_image || author.avatar || null,
            date: t.date || t.created_at || '',
            likes: _num(t.likes ?? t.like_count),
            retweets: _num(t.retweets ?? t.retweet_count),
            replies: _num(t.comments ?? t.reply_count),
            views: _num(t.views),
            media: t.media_url_https || t.media_url || null,
            verified: author.verified,
            source: 'official',
          }
        })
        .filter(Boolean)
        .slice(0, limit)
      return { author, tweets }
    }
    return { author: null, tweets: [] }
  }).catch(() => ({ author: null, tweets: [] }))
}
