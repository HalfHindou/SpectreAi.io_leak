/**
 * Kalshi prediction markets - real-time, ALL categories.
 * Mirror of polymarketApi.js. Fetches open events via the backend proxy
 * (/api/kalshi/events), which already normalizes Kalshi into the SAME slim
 * event-card shape getPredictionEventCards returns. Each event/outcome is
 * tagged source:'kalshi' so the grid can blend Polymarket + Kalshi.
 *
 * Card shape (identical to polymarketApi.getPredictionEventCards):
 *   { id, slug, title, image, icon, category, source,
 *     outcomes: [{ id, question, label, yesPct, volume, liquidity, endDate, source }],
 *     totalVolume, totalLiquidity, volume24h, endDate, url }
 */

// ── Category ids (shared taxonomy with polymarketApi) ─────────────────
// Backend already maps Kalshi event.category → these ids. This client-side
// helper exists so callers can normalize a raw Kalshi category the same way.
export const KALSHI_CATEGORY_MAP = {
  politics: 'politics',
  elections: 'politics',
  world: 'politics',
  economics: 'economy',
  finance: 'economy',
  crypto: 'crypto',
  sports: 'sports',
  science: 'science',
  'science and technology': 'science',
  technology: 'science',
  climate: 'culture',
  'climate and weather': 'culture',
  culture: 'culture',
  entertainment: 'culture',
}

/**
 * Map a raw Kalshi category string to our UI category id.
 * @param {string} raw - Kalshi `event.category` (e.g. 'Science and Technology')
 * @returns {string} one of politics|economy|crypto|sports|science|culture|other
 */
export function mapKalshiCategory(raw) {
  const c = String(raw || '').toLowerCase().trim()
  if (!c) return 'other'
  if (KALSHI_CATEGORY_MAP[c]) return KALSHI_CATEGORY_MAP[c]
  if (/politic|election|geopolit|world|government/.test(c)) return 'politics'
  if (/econom|financ|fed|inflation|interest|gdp|jobs|treasur/.test(c)) return 'economy'
  if (/crypto|bitcoin|ethereum/.test(c)) return 'crypto'
  if (/sport/.test(c)) return 'sports'
  if (/science|technolog|space/.test(c)) return 'science'
  if (/climate|weather|culture|entertain|music|movie|tv|award|celebrit/.test(c)) return 'culture'
  return 'other'
}

// ── Cache ──────────────────────────────────────────────────────────
let allCardsCache = []
let cacheTime = 0
let inflightFetch = null
const CACHE_TTL = 3 * 60 * 1000 // 3 min (mirrors polymarketApi)

// localStorage instant-paint seed (mirrors polymarketApi). Kalshi ships ~1200
// events (~1.4MB), so we persist only the top slice by volume — enough to paint
// the grid + arbitrage pool instantly on a cold reload, then revalidate. Without
// this, the full 1.4MB /events fetch blocks first paint every cold load.
const LS_KEY = 'spectre-kalshi-events'
const LS_TTL = 5 * 60 * 1000 // 5 min
const LS_MAX = 400
try {
  const raw = localStorage.getItem(LS_KEY)
  if (raw) {
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.cards) && Date.now() - parsed.ts < LS_TTL) {
      allCardsCache = parsed.cards
      cacheTime = parsed.ts
    }
  }
} catch (_) { /* private mode / quota / parse — ignore */ }

function _persistCards(cards) {
  try {
    const slim = [...cards]
      .sort((a, b) => (b.totalVolume || 0) - (a.totalVolume || 0))
      .slice(0, LS_MAX)
    localStorage.setItem(LS_KEY, JSON.stringify({ cards: slim, ts: Date.now() }))
  } catch (_) { /* quota / private mode — ignore */ }
}

/**
 * Fetch ALL open Kalshi event cards via the backend proxy (avoids CORS).
 * The proxy returns already-normalized slim cards (source:'kalshi').
 * @returns {Promise<Array>} array of event cards
 */
async function fetchAllCards() {
  const now = Date.now()
  if (allCardsCache.length && now - cacheTime < CACHE_TTL) {
    return allCardsCache
  }
  if (inflightFetch) return inflightFetch

  inflightFetch = (async () => {
    try {
      const res = await fetch('/api/kalshi/events', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) throw new Error(`Proxy returned ${res.status}`)
      const data = await res.json()
      const cards = Array.isArray(data) ? data : []
      if (cards.length > 0) {
        allCardsCache = cards
        cacheTime = Date.now()
        _persistCards(cards)
        return cards
      }
    } catch (_) {
      // fall through to stale cache
    }
    return allCardsCache.length ? allCardsCache : []
  })()

  try {
    return await inflightFetch
  } finally {
    inflightFetch = null
  }
}

/**
 * Filter + cap the normalized cards by category. Backend already shapes them;
 * this just applies the category pill filter, the activity floor, and the limit
 * (matching formatEventCards' negligible-activity skip + sort + slice).
 */
function formatCards(cards, category = 'all', limit = 50) {
  const out = []
  for (const card of cards) {
    if (!card || !Array.isArray(card.outcomes) || card.outcomes.length === 0) continue
    if (category !== 'all' && card.category !== category) continue
    // Skip negligible-activity events (same floor as polymarket formatEventCards).
    if ((card.totalVolume || 0) < 500 && (card.totalLiquidity || 0) < 1000) continue
    out.push(card)
    if (out.length >= limit * 2) break // gather a buffer before the final sort/slice
  }
  out.sort((a, b) => (b.totalVolume || 0) - (a.totalVolume || 0))
  return out.slice(0, limit)
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Fetch Kalshi prediction events as cards with nested outcome rows.
 * SAME shape as polymarketApi.getPredictionEventCards, source:'kalshi'.
 * @param {string} category - 'all' | 'politics' | 'economy' | 'crypto' | 'sports' | 'science' | 'culture' | 'other'
 * @param {number} limit - max cards to return
 * @returns {Promise<Array>}
 */
export async function getKalshiEventCards(category = 'all', limit = 50) {
  const cards = await fetchAllCards()
  return formatCards(cards, category, limit)
}

/**
 * Synchronous variant - returns cards from the in-memory cache without
 * triggering a fetch. Mirrors polymarketApi.getPredictionEventCardsCached.
 * Returns null if the cache is cold.
 */
export function getKalshiEventCardsCached(category = 'all', limit = 50) {
  if (!allCardsCache.length) return null
  return formatCards(allCardsCache, category, limit)
}

/**
 * Category counts across all cached Kalshi cards (for the filter pills).
 * @returns {Promise<Object>}
 */
export async function getKalshiCategoryCounts() {
  const cards = await fetchAllCards()
  const counts = { all: 0, politics: 0, economy: 0, crypto: 0, sports: 0, science: 0, culture: 0, other: 0 }
  for (const card of cards) {
    if (!card || !Array.isArray(card.outcomes) || card.outcomes.length === 0) continue
    counts.all += 1
    counts[card.category] = (counts[card.category] || 0) + 1
  }
  return counts
}

// ── Single event detail ──────────────────────────────────────────────
const _detailCache = {}
const _detailInflight = {}
const DETAIL_TTL = 60 * 1000
const FETCH_TIMEOUT = 15000

/**
 * Fetch a single Kalshi event by its event_ticker. Cached 60s, deduped.
 * @param {string} ticker - Kalshi event_ticker (e.g. 'KXNEWPOPE-70')
 * @returns {Promise<Object|null>}
 */
export async function getKalshiEvent(ticker) {
  if (!ticker) return null
  const cacheKey = `event-${ticker}`
  const entry = _detailCache[cacheKey]
  if (entry && Date.now() - entry.ts <= DETAIL_TTL) return entry.data
  if (_detailInflight[cacheKey]) return _detailInflight[cacheKey]

  const promise = (async () => {
    try {
      const res = await fetch(`/api/kalshi/event/${encodeURIComponent(ticker)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      })
      if (!res.ok) return null
      const data = await res.json()
      _detailCache[cacheKey] = { data, ts: Date.now() }
      return data
    } catch (err) {
      console.error('[kalshiApi] getKalshiEvent error:', err.message)
      return null
    } finally {
      delete _detailInflight[cacheKey]
    }
  })()

  _detailInflight[cacheKey] = promise
  return promise
}

// ── Cross-source arbitrage ────────────────────────────────────────────

// Stopwords + normalization for fuzzy question matching across the two venues.
const _STOP = new Set([
  'will', 'the', 'a', 'an', 'be', 'is', 'are', 'to', 'of', 'in', 'on', 'at', 'by',
  'for', 'and', 'or', 'who', 'what', 'when', 'before', 'after', 'this', 'that',
  'next', 'win', 'wins', 'reach', 'hit', 'than', 'more', 'less', 'over', 'under',
])

function _tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !_STOP.has(w))
}

// Jaccard similarity over the significant-word sets of two questions.
function _similarity(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0
  const a = new Set(aTokens)
  const b = new Set(bTokens)
  let inter = 0
  for (const w of a) if (b.has(w)) inter++
  const union = a.size + b.size - inter
  return union ? inter / union : 0
}

// Overlap coefficient — inter / size of the SMALLER set. Outcome labels are
// asymmetric across the venues (Polymarket writes "Will J.D. Vance win the 2028
// Republican presidential nomination?", Kalshi writes "J.D. Vance"), which
// Jaccard scores at 0.2 and rejects. Containment scores it 1.0, which is the
// honest reading: one label is fully inside the other.
function _containment(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0
  const a = new Set(aTokens)
  const b = new Set(bTokens)
  let inter = 0
  for (const w of a) if (b.has(w)) inter++
  return inter / Math.min(a.size, b.size)
}

const OUTCOME_MATCH_MIN = 0.6

/**
 * Align the two cards on the SAME outcome before pricing a spread.
 *
 * Matching events was never enough. Both venues carry "2028 Republican
 * presidential nominee", but their outcome lists lead with different
 * candidates, so comparing one leader against the other prices two different
 * questions against each other. Measured 2026-09-02: Polymarket's Trump leg (2%)
 * was matched against Kalshi's Vance leg (45%) and shipped to the UI as a
 * "SPREAD 43 pts" with a Buy Yes / Buy No instruction attached.
 *
 * Returns null when no outcome lines up — no row beats a fabricated one.
 */
function _alignOutcome(p, k) {
  if (!p.isMulti && !k.isMulti) {
    return { label: null, question: p.question, pmYesPct: p.top.yesPct, kalshiYesPct: k.top.yesPct }
  }
  let best = null
  let bestScore = 0
  for (const po of p.outcomes) {
    const pt = _tokenize(po.label)
    if (!pt.length) continue
    for (const ko of k.outcomes) {
      const kt = _tokenize(ko.label)
      if (!kt.length) continue
      const score = _containment(pt, kt)
      // Tie-break on the bigger market: equally-matching labels should resolve
      // to the leg a reader actually cares about.
      if (score > bestScore || (score === bestScore && best && po.yesPct > best.pmYesPct)) {
        bestScore = score
        best = { label: ko.label || po.label, question: `${p.title} - ${ko.label || po.label}`.trim(), pmYesPct: po.yesPct, kalshiYesPct: ko.yesPct }
      }
    }
  }
  return bestScore >= OUTCOME_MATCH_MIN ? best : null
}

/**
 * Fuzzy-match the same question across Polymarket and Kalshi and surface the
 * yes-probability spread for the arbitrage feature.
 *
 * Both inputs are arrays of event cards (the shape getPredictionEventCards /
 * getKalshiEventCards return). For each card we use its top outcome (the cards
 * are pre-sorted highest-yesPct first) as the representative question + price.
 *
 * @param {Array} polymarketCards - cards from polymarketApi.getPredictionEventCards
 * @param {Array} kalshiCards - cards from getKalshiEventCards
 * @param {Object} [opts]
 * @param {number} [opts.minSimilarity=0.34] - Jaccard threshold to call it a match
 * @param {number} [opts.minSpread=0] - minimum |pmYesPct - kalshiYesPct| to include
 * @returns {Array<{ question, pmYesPct, kalshiYesPct, spread, pmUrl, kalshiUrl, similarity }>}
 */
export function findCrossSourceArbitrage(polymarketCards, kalshiCards, opts = {}) {
  const minSimilarity = opts.minSimilarity ?? 0.34
  const minSpread = opts.minSpread ?? 0

  const pm = (Array.isArray(polymarketCards) ? polymarketCards : [])
    .map((c) => _repr(c))
    .filter(Boolean)
  const ks = (Array.isArray(kalshiCards) ? kalshiCards : [])
    .map((c) => _repr(c))
    .filter(Boolean)

  const matches = []
  const usedKalshi = new Set()

  for (const p of pm) {
    let best = null
    let bestScore = 0
    let bestIdx = -1
    for (let i = 0; i < ks.length; i++) {
      if (usedKalshi.has(i)) continue
      const score = _similarity(p.tokens, ks[i].tokens)
      if (score > bestScore) {
        bestScore = score
        best = ks[i]
        bestIdx = i
      }
    }
    if (best && bestScore >= minSimilarity) {
      const pair = _alignOutcome(p, best)
      if (!pair) continue
      const spread = Math.abs(pair.pmYesPct - pair.kalshiYesPct)
      if (spread >= minSpread) {
        usedKalshi.add(bestIdx)
        matches.push({
          question: pair.question,
          outcome: pair.label,
          pmYesPct: pair.pmYesPct,
          kalshiYesPct: pair.kalshiYesPct,
          spread,
          pmUrl: p.url,
          kalshiUrl: best.url,
          similarity: Math.round(bestScore * 100) / 100,
        })
      }
    }
  }

  // Widest mispricing first - the actionable arbitrage rows.
  matches.sort((a, b) => b.spread - a.spread)
  return matches
}

// Reduce a card to its representative question/price for matching.
function _repr(card) {
  if (!card || !Array.isArray(card.outcomes) || card.outcomes.length === 0) return null
  const outcomes = card.outcomes
    .filter((o) => o && typeof o.yesPct === 'number')
    .map((o) => ({ label: String(o.label || o.question || '').trim(), yesPct: o.yesPct }))
  if (!outcomes.length) return null
  // Pick the leader explicitly. This used to read outcomes[0] on the documented
  // assumption that the cards arrive sorted highest-yesPct first - Polymarket's
  // "Republican Presidential Nominee 2028" ships Trump (2%) ahead of Vance (53%),
  // so the representative price was the tail of the book, not its head.
  const top = outcomes.reduce((a, b) => (b.yesPct > a.yesPct ? b : a))
  const title = card.title || ''
  // Binary events: the card title IS the question. Multi-outcome: combine the
  // event title with the leading outcome label so e.g. Polymarket "2028 Dem
  // nominee" + "Newsom" matches Kalshi's same pairing.
  const question = top.label ? `${title} ${top.label}`.trim() : title
  return {
    title,
    question,
    outcomes,
    isMulti: outcomes.length > 1,
    top,
    yesPct: top.yesPct,
    url: card.url || '',
    tokens: _tokenize(question),
  }
}

export default {
  getKalshiEventCards,
  getKalshiEventCardsCached,
  getKalshiCategoryCounts,
  getKalshiEvent,
  mapKalshiCategory,
  findCrossSourceArbitrage,
}
