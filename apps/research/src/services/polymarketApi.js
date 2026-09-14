/**
 * Polymarket Gamma API – real-time prediction markets (ALL categories)
 * Fetches open events via a backend proxy, categorises by tag taxonomy,
 * and returns formatted rows for the Welcome Page Prediction Markets tab.
 */
// ── Category mapping from Polymarket tag slugs ─────────────────────
// Maps tag slugs → our category IDs used in the UI filter pills
const TAG_TO_CATEGORY = {
  // Politics & Elections
  'politics': 'politics',
  'elections': 'politics',
  'us-presidential-election': 'politics',
  'midterms': 'politics',
  'geopolitics': 'politics',
  'trump': 'politics',
  'biden': 'politics',
  'congress': 'politics',
  'senate': 'politics',
  'government': 'politics',
  'regulation': 'politics',
  'world': 'politics',
  'nato': 'politics',
  'eu': 'politics',
  'ukraine': 'politics',
  'russia': 'politics',
  'china': 'politics',
  'india': 'politics',
  'uk': 'politics',
  'france': 'politics',
  'resign': 'politics',
  'impeach': 'politics',
  'fed-chair': 'politics',
  'supreme-court': 'politics',

  // Sports
  'sports': 'sports',
  'games': 'sports',
  'basketball': 'sports',
  'ncaa': 'sports',
  'ncaa-basketball': 'sports',
  'nba': 'sports',
  'nfl': 'sports',
  'mlb': 'sports',
  'soccer': 'sports',
  'football': 'sports',
  'cricket': 'sports',
  'international-cricket': 'sports',
  'tennis': 'sports',
  'mma': 'sports',
  'ufc': 'sports',
  'boxing': 'sports',
  'formula-1': 'sports',
  'f1': 'sports',
  'olympics': 'sports',
  'world-cup': 'sports',
  'super-bowl': 'sports',
  'march-madness': 'sports',

  // Crypto & Finance
  'crypto': 'crypto',
  'crypto-prices': 'crypto',
  'bitcoin': 'crypto',
  'ethereum': 'crypto',
  'solana': 'crypto',
  'xrp': 'crypto',
  'defi': 'crypto',
  'nft': 'crypto',

  // Economy & Finance
  'economy': 'economy',
  'macro-indicators': 'economy',
  'macro-single': 'economy',
  'gdp': 'economy',
  'inflation': 'economy',
  'fed': 'economy',
  'interest-rates': 'economy',
  'stocks': 'economy',
  'market': 'economy',
  'recession': 'economy',
  'tariffs': 'economy',
  'trade': 'economy',

  // Pop Culture & Entertainment
  'pop-culture': 'culture',
  'entertainment': 'culture',
  'music': 'culture',
  'kpop': 'culture',
  'k-pop': 'culture',
  'movies': 'culture',
  'tv': 'culture',
  'oscars': 'culture',
  'grammy': 'culture',
  'celebrity': 'culture',
  'social-media': 'culture',
  'viral': 'culture',

  // Science & Tech
  'science': 'science',
  'technology': 'science',
  'ai': 'science',
  'artificial-intelligence': 'science',
  'space': 'science',
  'spacex': 'science',
  'climate': 'science',
  'health': 'science',
  'pandemic': 'science',
  'covid': 'science',
  'fda': 'science',
}

// Skip short-term up/down price markets (noise) and esports clutter
const SKIP_SLUGS = ['up-or-down', '5M', '4h', '15m', '1h', '30m', '10m', 'recurring', 'esports', 'csgo', 'cs2', 'dota', 'dota-2', 'league-of-legends', 'valorant']

// ── Cache ──────────────────────────────────────────────────────────
let allEventsCache = []
let cacheTime = 0
let inflightFetch = null
const CACHE_TTL = 3 * 60 * 1000 // 3 min

// localStorage instant-paint seed for the events list. Memory cache is wiped
// on every reload, so without this every cold load paints a skeleton and waits
// for the full /events fetch. Short TTL (5 min) keeps it from going too stale.
const LS_KEY = 'spectre-polymarket-events'
const LS_TTL = 5 * 60 * 1000 // 5 min

// Hydrate the memory cache from localStorage once at module load so the first
// synchronous read (getPredictionEventCardsCached / getPredictionMarketsCached)
// can return rows before any network call resolves.
try {
  const raw = localStorage.getItem(LS_KEY)
  if (raw) {
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.events) && Date.now() - parsed.ts < LS_TTL) {
      allEventsCache = parsed.events
      cacheTime = parsed.ts
    }
  }
} catch (_) { /* private mode / quota / parse — ignore */ }

// Fields carried by each nested market that NOTHING reads off this cache.
// Measured on a live prod profile (2026-08-19): this blob was 927KB for 100
// events — 85% of it the nested `markets` array — i.e. ~19% of the whole ~5MB
// localStorage origin budget spent on one page's cache. These three account
// for 265KB of that and have zero consumers:
//   clobTokenIds (198KB) is only ever read off a FRESH /event-bundle response
//     (see getPredictionEventBundle), never off this list cache;
//   createdAt + startDate have no reader anywhere in the app.
// Everything the card/market derivations actually touch (question, closed,
// outcomePrices, volume*, liquidity*, id, slug, endDate, image, icon, bestBid,
// bestAsk, lastTradePrice, oneDayPriceChange) is kept, so the seed stays
// semantically identical — just smaller. Measured after: 927KB -> 613KB.
const SEED_DROP_MARKET_FIELDS = ['clobTokenIds', 'createdAt', 'startDate']

// This seed had NO row cap, unlike its sibling (kalshiApi caps at 400): the
// upstream decided how much we stored. It only has to cover FIRST PAINT — the
// network revalidates within the 5-min TTL — so bound it. Events arrive
// pre-ordered by the proxy, so the head is the part that gets rendered.
const SEED_MAX_EVENTS = 150

// Refuse to persist an absurd blob even after slimming: better to shimmer on
// the next cold load than to spend most of the origin budget on one page.
const SEED_MAX_BYTES = 700_000

function _slimEventsForSeed(events) {
  if (!Array.isArray(events)) return events
  return events.slice(0, SEED_MAX_EVENTS).map((ev) => {
    if (!ev || !Array.isArray(ev.markets)) return ev
    return {
      ...ev,
      markets: ev.markets.map((m) => {
        if (!m) return m
        const out = { ...m }
        for (const f of SEED_DROP_MARKET_FIELDS) delete out[f]
        return out
      }),
    }
  })
}

function _persistEvents(events) {
  try {
    // Envelope shape ({ events, ts }) is unchanged, so seeds written by the
    // previous implementation still hydrate after this ships.
    const raw = JSON.stringify({ events: _slimEventsForSeed(events), ts: Date.now() })
    if (raw.length > SEED_MAX_BYTES) return
    localStorage.setItem(LS_KEY, raw)
  } catch (_) { /* quota / private mode — ignore */ }
}

/**
 * Determine the category for an event based on its tags.
 * Returns the first matching category, or 'other'.
 */
function categoriseEvent(event) {
  const tags = (event.tags || []).map(t => (t.slug || '').toLowerCase())
  for (const slug of tags) {
    if (TAG_TO_CATEGORY[slug]) return TAG_TO_CATEGORY[slug]
  }
  // Fallback: keyword detection in title
  const title = (event.title || '').toLowerCase()
  if (/election|president|governor|senate|congress|trump|biden|vote|political|party|democrat|republican/i.test(title)) return 'politics'
  if (/nba|nfl|mlb|soccer|cricket|tennis|ufc|boxing|match|game.*vs|championship|tournament/i.test(title)) return 'sports'
  if (/bitcoin|btc|ethereum|eth|solana|sol|crypto|defi|token|nft|blockchain/i.test(title)) return 'crypto'
  if (/gdp|inflation|fed |interest rate|recession|tariff|economy|unemployment/i.test(title)) return 'economy'
  if (/ai |artificial intelligence|spacex|nasa|mars|climate|health|fda|vaccine|pandemic/i.test(title)) return 'science'
  if (/oscar|grammy|movie|album|concert|spotify|celebrity|viral|tiktok/i.test(title)) return 'culture'
  return 'other'
}

/**
 * Should we skip this event? (up-or-down 5-min noise, etc.)
 */
function shouldSkipEvent(event) {
  const tags = (event.tags || []).map(t => (t.slug || '').toLowerCase())
  return tags.some(s => SKIP_SLUGS.includes(s))
}

/**
 * Fetch ALL open prediction markets via backend proxy (avoids CORS).
 * The backend proxy fetches from Gamma API and returns the raw events array.
 * Do not direct-fetch Gamma from the browser; it trips CORS locally.
 */
async function fetchAllEvents() {
  const now = Date.now()
  if (allEventsCache.length && now - cacheTime < CACHE_TTL) {
    return allEventsCache
  }
  if (inflightFetch) return inflightFetch

  inflightFetch = (async () => {
    try {
      const res = await fetch('/api/polymarket/events', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) throw new Error(`Proxy returned ${res.status}`)
      const data = await res.json()
      const events = Array.isArray(data) ? data : []
      if (events.length > 0) {
        allEventsCache = events
        cacheTime = Date.now()
        _persistEvents(events)
        return events
      }
    } catch (_) {
      // fall through to stale cache
    }
    return allEventsCache.length ? allEventsCache : []
  })()

  try {
    return await inflightFetch
  } finally {
    inflightFetch = null
  }
}

/**
 * Format events into rows suitable for the Predictions table.
 * @param {Array} events - raw Gamma API events
 * @param {string} category - 'all' or a specific category id
 * @param {number} limit - max rows
 */
function formatEvents(events, category = 'all', limit = 50) {
  const out = []
  const seen = new Set()

  for (const event of events) {
    if (shouldSkipEvent(event)) continue
    const cat = categoriseEvent(event)
    if (category !== 'all' && cat !== category) continue

    const markets = event.markets || []
    for (const m of markets) {
      if (m.closed) continue

      const question = m.question || event.title || ''
      // De-duplicate by question prefix
      const key = question.slice(0, 80).toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      // Parse yes/no prices
      let yesPct = 50
      try {
        const prices = JSON.parse(m.outcomePrices || '["0.5","0.5"]')
        const yesPrice = parseFloat(prices[0])
        if (Number.isFinite(yesPrice)) yesPct = Math.round(yesPrice * 100)
      } catch (_) { console.error(_) }

      // Skip markets with 0% or 100% (already resolved or no liquidity)
      if (yesPct <= 0 || yesPct >= 100) continue

      const vol = parseFloat(m.volume) || parseFloat(m.volumeNum) || 0
      const liq = parseFloat(m.liquidity) || parseFloat(m.liquidityNum) || 0

      // Skip markets with negligible activity (need at least $500 volume or $1k liquidity)
      if (vol < 500 && liq < 1000) continue

      const endDate = m.endDate || event.endDate || ''
      const endStr = endDate
        ? new Date(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '-'

      const slug = event.slug || m.slug || ''
      const url = slug
        ? `https://polymarket.com/event/${slug}`
        : 'https://polymarket.com'

      out.push({
        id: `${event.id}-${m.id}`,
        question,
        category: cat,
        yesPct,
        volume: vol,
        liquidity: liq,
        endDate: endStr,
        resolution: 'Polymarket',
        url,
        image: event.image || '',
        icon: event.icon || '',
        title: event.title || '',
      })

      if (out.length >= limit) break
    }
    if (out.length >= limit) break
  }

  // Sort by volume descending (highest volume = most interesting)
  out.sort((a, b) => b.volume - a.volume)
  return out.slice(0, limit)
}

/**
 * Format events as event-level cards (Polymarket-style) with nested outcome rows.
 * Each card = one event with up to N sub-markets shown as outcome rows.
 */
function formatEventCards(events, category = 'all', limit = 50) {
  const out = []

  for (const event of events) {
    if (shouldSkipEvent(event)) continue
    const cat = categoriseEvent(event)
    if (category !== 'all' && cat !== category) continue

    const openMarkets = (event.markets || []).filter(m => !m.closed)
    if (openMarkets.length === 0) continue

    // Parse each market's outcome data
    const outcomes = []
    let totalVol = 0
    let totalLiq = 0
    let vol24h = 0

    for (const m of openMarkets) {
      let yesPct = 50
      try {
        const prices = JSON.parse(m.outcomePrices || '["0.5","0.5"]')
        const yesPrice = parseFloat(prices[0])
        if (Number.isFinite(yesPrice)) yesPct = Math.round(yesPrice * 100)
      } catch (_) { console.error(_) }

      if (yesPct <= 0 || yesPct >= 100) continue

      const vol = parseFloat(m.volume || m.volumeNum || 0)
      const liq = parseFloat(m.liquidity || m.liquidityNum || 0)
      totalVol += vol
      totalLiq += liq
      vol24h += parseFloat(m.volume24hr || 0)

      // Derive a short label from the question by removing the event title prefix
      let label = m.question || ''
      const eventTitle = event.title || ''
      if (label === eventTitle) label = ''

      outcomes.push({
        id: m.id,
        question: m.question || '',
        label,
        yesPct,
        volume: vol,
        liquidity: liq,
        endDate: m.endDate || event.endDate || '',
      })
    }

    if (outcomes.length === 0) continue

    // Skip events with negligible activity
    if (totalVol < 500 && totalLiq < 1000) continue

    const slug = event.slug || ''
    const endDate = event.endDate || outcomes[0].endDate || ''
    const endStr = endDate
      ? new Date(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '-'

    out.push({
      id: event.id || slug,
      slug,
      title: event.title || outcomes[0].question,
      image: event.image || '',
      icon: event.icon || '',
      category: cat,
      outcomes: outcomes.slice(0, 4),
      totalVolume: totalVol,
      totalLiquidity: totalLiq,
      volume24h: vol24h,
      endDate: endStr,
      url: slug ? `https://polymarket.com/event/${slug}` : 'https://polymarket.com',
    })

    if (out.length >= limit) break
  }

  out.sort((a, b) => b.totalVolume - a.totalVolume)
  return out.slice(0, limit)
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Fetch all open prediction markets, optionally filtered by category.
 * @param {string} category - 'all' | 'politics' | 'sports' | 'crypto' | 'economy' | 'science' | 'culture' | 'other'
 * @param {number} limit - max rows to return
 * @returns {Promise<Array<{ id, question, category, yesPct, volume, liquidity, endDate, resolution, url }>>}
 */
export async function getPredictionMarkets(category = 'all', limit = 50) {
  const events = await fetchAllEvents()
  return formatEvents(events, category, limit)
}

/**
 * Fetch prediction events as cards with nested outcome rows (Polymarket-style).
 * Each card = one event, outcomes = its sub-markets with yes/no percentages.
 */
export async function getPredictionEventCards(category = 'all', limit = 50) {
  const events = await fetchAllEvents()
  return formatEventCards(events, category, limit)
}

/**
 * Synchronous variant - returns cards from the in-memory cache without
 * triggering a fetch. Lets the list page swap categories instantly when
 * the events are already loaded (skips skeleton flash + extra format passes).
 * Returns null if the cache is cold.
 */
export function getPredictionEventCardsCached(category = 'all', limit = 50) {
  if (!allEventsCache.length) return null
  return formatEventCards(allEventsCache, category, limit)
}

/**
 * Synchronous variant of getPredictionMarkets - returns flat market rows from
 * the in-memory cache without triggering a fetch. Lets the bubble map paint
 * from the already-loaded events the list page warmed, skipping a redundant
 * getPredictionMarkets fetch + reformat. Returns null if the cache is cold.
 */
export function getPredictionMarketsCached(category = 'all', limit = 50) {
  if (!allEventsCache.length) return null
  return formatEvents(allEventsCache, category, limit)
}

// Aliases boost recall for majors (a market titled "Bitcoin ..." should match BTC).
const TOKEN_ALIASES = {
  BTC: ['bitcoin', 'microstrategy', 'saylor', 'halving'],
  ETH: ['ethereum', 'ether', 'vitalik'],
  SOL: ['solana'],
  XRP: ['ripple'],
  DOGE: ['dogecoin'],
  ADA: ['cardano'],
  BNB: ['binance coin'],
  AVAX: ['avalanche'],
  LINK: ['chainlink'],
  MATIC: ['polygon'],
  DOT: ['polkadot'],
  SHIB: ['shiba inu'],
  LTC: ['litecoin'],
  TRX: ['tron'],
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Fetch REAL prediction markets related to a specific crypto token.
 * Matches by symbol (word-boundary), token name, known aliases, and tags.
 * Returns [] when the token has no live markets — callers must handle the
 * empty case (do NOT fabricate rows). Used by the token card popup + Token Detail.
 * @param {string} symbol - e.g. 'BTC', 'ETH', 'SPECTRE'
 * @param {string} name   - token display name, improves recall (e.g. 'Spectre AI')
 * @param {number} limit  - max rows to return
 */
export async function getPredictionMarketsForToken(symbol, name = '', limit = 6) {
  const sym = (symbol || '').toUpperCase().trim()
  if (!sym) return []
  const events = await fetchAllEvents()

  const nameLc = (name || '').toLowerCase().trim()
  // Long terms (>=3 chars) match as substrings; short symbols need a word
  // boundary so 'SOL' doesn't match 'solar' / 'console'.
  const substrTerms = []
  const wordTerms = []
  const symLc = sym.toLowerCase()
  ;(symLc.length >= 4 ? substrTerms : wordTerms).push(symLc)
  if (nameLc.length >= 3) substrTerms.push(nameLc)
  ;(TOKEN_ALIASES[sym] || []).forEach(a => substrTerms.push(a))

  const wordRe = wordTerms.length
    ? new RegExp(`\\b(${wordTerms.map(escapeRegExp).join('|')})\\b`, 'i')
    : null

  const textMatches = (text) => {
    if (!text) return false
    const lc = text.toLowerCase()
    if (substrTerms.some(t => lc.includes(t))) return true
    if (wordRe && wordRe.test(text)) return true
    return false
  }

  // Match at the MARKET level, not the event level. Grouped events (e.g.
  // "... before GTA VI?") bundle a bitcoin market next to unrelated ones —
  // matching the event would leak "Will Jesus Christ return?" into BTC's rows.
  // Keep a market only if the event title matches the token (a token-specific
  // event whose sub-markets are price tiers) OR the market's own question does.
  const filtered = []
  for (const event of events) {
    if (shouldSkipEvent(event)) continue
    const titleMatch = textMatches(event.title)
    const markets = (event.markets || []).filter(m => titleMatch || textMatches(m.question))
    if (markets.length) filtered.push({ ...event, markets })
  }

  return formatEvents(filtered, 'all', limit)
}

/**
 * Get a summary of how many markets are in each category.
 * Useful for displaying counts on the category filter pills.
 */
export async function getPredictionCategoryCounts() {
  const events = await fetchAllEvents()
  const counts = { all: 0, politics: 0, sports: 0, crypto: 0, economy: 0, science: 0, culture: 0, other: 0 }

  for (const event of events) {
    if (shouldSkipEvent(event)) continue
    const cat = categoriseEvent(event)
    const openMarkets = (event.markets || []).filter(m => !m.closed).length
    if (openMarkets > 0) {
      counts.all += openMarkets
      counts[cat] = (counts[cat] || 0) + openMarkets
    }
  }

  return counts
}

function formatVol(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return n.toFixed(0)
}

// ── Detail cache + dedup (fearGreedApi.js pattern) ───────────────────
const _detailCache = {}
const _detailInflight = {}
const DETAIL_TTL = 60 * 1000   // 60s
const FETCH_TIMEOUT = 15000    // 15s

function _getCached(key, ttlMs) {
  const entry = _detailCache[key]
  if (!entry) return null
  if (Date.now() - entry.ts > ttlMs) {
    delete _detailCache[key]
    return null
  }
  return entry.data
}

function _setCached(key, data) {
  _detailCache[key] = { data, ts: Date.now() }
}

/**
 * Fetch a single prediction event by its slug.
 * Cached 60s with in-flight deduplication.
 * @param {string} eventSlug - Polymarket event slug
 * @returns {Promise<Object|null>}
 */
export async function getPredictionEvent(eventSlug) {
  if (!eventSlug) return null

  const cacheKey = `event-${eventSlug}`
  const cached = _getCached(cacheKey, DETAIL_TTL)
  if (cached) return cached

  if (_detailInflight[cacheKey]) return _detailInflight[cacheKey]

  const promise = (async () => {
    try {
      const res = await fetch(`/api/polymarket/event/${encodeURIComponent(eventSlug)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      })
      if (!res.ok) return null
      const data = await res.json()
      _setCached(cacheKey, data)
      return data
    } catch (err) {
      console.error('[polymarketApi] getPredictionEvent error:', err.message)
      return null
    } finally {
      delete _detailInflight[cacheKey]
    }
  })()

  _detailInflight[cacheKey] = promise
  return promise
}

/**
 * Fetch the event + initial price history in ONE round trip.
 * Server-side parallelism: Gamma event fetch then CLOB prices in the same
 * invocation, so the client sees both at once instead of 2 sequential fetches.
 * Populates the per-resource caches so a subsequent `getPredictionEvent` /
 * `getPriceHistory` call for the same args hits cache immediately.
 *
 * @param {string} eventSlug
 * @param {string} interval - '1h' | '6h' | '1d' | '1w' | '1m' | 'all'
 * @param {number} fidelity
 * @returns {Promise<{ event: Object|null, history: Array }>}
 */
export async function getPredictionEventBundle(eventSlug, interval = '1w', fidelity = 200) {
  if (!eventSlug) return { event: null, history: [] }

  const cacheKey = `bundle-${eventSlug}-${interval}-${fidelity}`
  const cached = _getCached(cacheKey, DETAIL_TTL)
  if (cached) return cached

  if (_detailInflight[cacheKey]) return _detailInflight[cacheKey]

  const promise = (async () => {
    try {
      const params = new URLSearchParams({ interval, fidelity: String(fidelity) })
      const res = await fetch(`/api/polymarket/event-bundle/${encodeURIComponent(eventSlug)}?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      })
      if (!res.ok) return { event: null, history: [] }
      const data = await res.json()
      const result = { event: data?.event || null, history: Array.isArray(data?.history) ? data.history : [] }

      // Seed the per-resource caches so follow-up calls reuse this data.
      if (result.event) _setCached(`event-${eventSlug}`, result.event)
      if (result.event?.markets?.[0]?.clobTokenIds) {
        try {
          const tokenIds = JSON.parse(result.event.markets[0].clobTokenIds)
          const yesTokenId = tokenIds[0]
          if (yesTokenId) {
            _setCached(`prices-${yesTokenId}-${interval}-${fidelity}`, result.history)
          }
        } catch (_) {}
      }

      _setCached(cacheKey, result)
      return result
    } catch (err) {
      console.error('[polymarketApi] getPredictionEventBundle error:', err.message)
      return { event: null, history: [] }
    } finally {
      delete _detailInflight[cacheKey]
    }
  })()

  _detailInflight[cacheKey] = promise
  return promise
}

/**
 * Fetch price history for a CLOB token (Yes outcome).
 * Cached 60s with in-flight deduplication.
 * @param {string} tokenId - CLOB token ID
 * @param {string} interval - Chart interval (1h, 6h, 1d, 1w, 1m, all)
 * @param {number} fidelity - Number of data points
 * @param {number|null} startTs - Market start timestamp (used for ALL interval)
 * @returns {Promise<Array>}
 */
export async function getPriceHistory(tokenId, interval = '1w', fidelity = 200, startTs = null) {
  if (!tokenId) return []

  const cacheKey = `prices-${tokenId}-${interval}-${fidelity}`
  const cached = _getCached(cacheKey, DETAIL_TTL)
  if (cached) return cached

  if (_detailInflight[cacheKey]) return _detailInflight[cacheKey]

  const promise = (async () => {
    try {
      const params = new URLSearchParams({ tokenId, interval, fidelity: String(fidelity) })
      if (startTs && interval === 'all') params.set('startTs', String(startTs))
      const res = await fetch(`/api/polymarket/prices-history?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      })
      if (!res.ok) return []
      const data = await res.json()
      const history = data.history || data
      const result = Array.isArray(history) ? history : []
      _setCached(cacheKey, result)
      return result
    } catch (err) {
      console.error('[polymarketApi] getPriceHistory error:', err.message)
      return []
    } finally {
      delete _detailInflight[cacheKey]
    }
  })()

  _detailInflight[cacheKey] = promise
  return promise
}

// ── Analysis cache + dedup ────────────────────────────────────────────
const ANALYSIS_TTL = 30 * 60 * 1000  // 30 min
const ANALYSIS_TIMEOUT = 35000       // 35s (Claude needs time)

/**
 * Fetch AI-powered market analysis for a prediction event.
 * Cached 30min with in-flight deduplication.
 * @param {string} eventSlug - Polymarket event slug
 * @returns {Promise<Object|null>}
 */
export async function getMarketAnalysis(eventSlug) {
  if (!eventSlug) return null

  const cacheKey = `analysis-${eventSlug}`
  const cached = _getCached(cacheKey, ANALYSIS_TTL)
  if (cached) return cached

  if (_detailInflight[cacheKey]) return _detailInflight[cacheKey]

  const promise = (async () => {
    try {
      const res = await fetch(`/api/polymarket/analysis?eventSlug=${encodeURIComponent(eventSlug)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(ANALYSIS_TIMEOUT),
      })
      if (!res.ok) return null
      const data = await res.json()
      _setCached(cacheKey, data)
      return data
    } catch (err) {
      console.error('[polymarketApi] getMarketAnalysis error:', err.message)
      return null
    } finally {
      delete _detailInflight[cacheKey]
    }
  })()

  _detailInflight[cacheKey] = promise
  return promise
}

// ── Order book cache + dedup ─────────────────────────────────────────
const BOOK_TTL = 15 * 1000  // 15s

/**
 * Fetch order book depth for a CLOB token.
 * Cached 15s with in-flight deduplication.
 * @param {string} tokenId - CLOB token ID
 * @returns {Promise<Object|null>} - { bids: [{price, size}], asks: [{price, size}] }
 */
export async function getOrderBook(tokenId) {
  if (!tokenId) return null

  const cacheKey = `book-${tokenId}`
  const cached = _getCached(cacheKey, BOOK_TTL)
  if (cached) return cached

  if (_detailInflight[cacheKey]) return _detailInflight[cacheKey]

  const promise = (async () => {
    try {
      const res = await fetch(`/api/polymarket/orderbook?tokenId=${encodeURIComponent(tokenId)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      })
      if (!res.ok) return null
      const data = await res.json()
      _setCached(cacheKey, data)
      return data
    } catch (err) {
      console.error('[polymarketApi] getOrderBook error:', err.message)
      return null
    } finally {
      delete _detailInflight[cacheKey]
    }
  })()

  _detailInflight[cacheKey] = promise
  return promise
}

// ── Trades cache + dedup ────────────────────────────────────────────
const TRADES_TTL = 15 * 1000  // 15s

/**
 * Fetch recent trades for a CLOB token.
 * Cached 15s with in-flight deduplication.
 * @param {string} tokenId - CLOB token ID
 * @param {number} limit - max trades to return
 * @param {string} eventSlug - optional event slug for filtering
 * @returns {Promise<Array>}
 */
export async function getRecentTrades(tokenId, limit = 20, eventSlug = null) {
  if (!tokenId) return []

  const cacheKey = `trades-${tokenId}-${limit}`
  const cached = _getCached(cacheKey, TRADES_TTL)
  if (cached) return cached

  if (_detailInflight[cacheKey]) return _detailInflight[cacheKey]

  const promise = (async () => {
    try {
      const params = new URLSearchParams({ tokenId, limit: String(limit) })
      if (eventSlug) params.set('eventSlug', eventSlug)
      const res = await fetch(`/api/polymarket/trades?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      })
      if (!res.ok) return []
      const data = await res.json()
      const trades = Array.isArray(data) ? data : []
      _setCached(cacheKey, trades)
      return trades
    } catch (err) {
      console.error('[polymarketApi] getRecentTrades error:', err.message)
      return []
    } finally {
      delete _detailInflight[cacheKey]
    }
  })()

  _detailInflight[cacheKey] = promise
  return promise
}

export default {
  getPredictionMarkets,
  getPredictionEventCards,
  getPredictionEventCardsCached,
  getPredictionMarketsCached,
  getPredictionMarketsForToken,
  getPredictionCategoryCounts,
  getPredictionEvent,
  getPredictionEventBundle,
  getPriceHistory,
  getMarketAnalysis,
  getOrderBook,
  getRecentTrades,
}
