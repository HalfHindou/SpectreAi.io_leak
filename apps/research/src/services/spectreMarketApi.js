import { SYMBOL_TO_COINGECKO_ID, COINGECKO_LOGOS } from '@/constants/majorTokens'
import { filterRankedCoins } from '@/constants/marketDataExclusions'
import { decodeHtmlEntities } from '@/utils/html'
import { binancePairFor } from './binanceCatalog'
import { consumeEarlyFetch } from '@/lib/early-fetch'

// Use a same-origin proxy path by default. The production API does not expose
// localhost CORS broadly, so browser code should not call it directly.
const DEFAULT_MARKET_BASE = '/spectre-market-api'
const DEFAULT_V1_BASE = '/data-api/v1'
const MARKET_API_BASE = (import.meta.env.VITE_SPECTRE_MARKET_API_BASE || DEFAULT_MARKET_BASE).replace(/\/+$/, '')
const V1_API_BASE = (import.meta.env.VITE_SPECTRE_DATA_API_BASE || DEFAULT_V1_BASE).replace(/\/+$/, '')
const FETCH_TIMEOUT = 12000
const PRICE_CHUNK_SIZE = 100

const CACHE = new Map()
const INFLIGHT = new Map()

const TTL = {
  price: 10_000,
  list: 15_000,
  search: 10_000,
  profile: 30_000,
  chart: 10_000,
  market: 15_000,
  derivatives: 15_000,
  categories: 300_000,
  news: 60_000,
  intelligence: 60_000,
  sentiment: 60_000,
}

function cacheGet(key, ttl) {
  const cached = CACHE.get(key)
  if (!cached || Date.now() - cached.ts > ttl) return null
  return cached.data
}

function cacheSet(key, data) {
  CACHE.set(key, { data, ts: Date.now() })
}

// Failure cooldown + stale-on-error (2026-07-07). The /data-api upstream can
// degrade (Hetzner cold paths run 3-7s, Vercel misses stack to 10s+ and 502) -
// and a failed fetch used to cache NOTHING, so every poll tick re-fired a
// fresh request into the dying endpoint and the Network panel filled with
// back-to-back pending/502 rows. Now: a key that failed backs off (15s,
// doubling to 2min) before the next network attempt, and callers get the last
// good payload (up to 10min old) instead of an error while upstream heals.
// Consumers already treat these reads as best-effort (`.catch(() => ({}))`),
// and majors get a live Binance price overlay downstream, so a briefly stale
// map is strictly better than an empty one.
const FAILURES = new Map()
const FAIL_COOLDOWN_BASE = 15_000
const FAIL_COOLDOWN_MAX = 120_000
const NOT_FOUND_COOLDOWN = 10 * 60 * 1000
const STALE_SERVE_MAX = 10 * 60 * 1000

function cacheGetStale(key) {
  const cached = CACHE.get(key)
  if (!cached || Date.now() - cached.ts > STALE_SERVE_MAX) return null
  return cached.data
}

function inFailureCooldown(key) {
  const failure = FAILURES.get(key)
  return Boolean(failure) && Date.now() < failure.until
}

function recordFailure(key, status) {
  // A 404/410 is not a transient failure - the box simply has no row for this
  // asset (measured: /v1/community/SPECTRE 404s while BTC/ETH/SOL return 200).
  // Retrying it on the transient schedule re-asks a settled question every 2
  // minutes and prints a red console line each time.
  if (status === 404 || status === 410) {
    FAILURES.set(key, { count: 1, until: Date.now() + NOT_FOUND_COOLDOWN })
    return
  }
  const count = (FAILURES.get(key)?.count || 0) + 1
  const backoff = Math.min(FAIL_COOLDOWN_BASE * 2 ** (count - 1), FAIL_COOLDOWN_MAX)
  FAILURES.set(key, { count, until: Date.now() + backoff })
}

// localStorage write-through seed for the high-traffic, slow-changing GET keys
// (markets list, slim-intel bundle, heatmap/bubbles rows). The in-memory CACHE
// is module-only, so every cold reload paints a shimmer + refetches even when a
// 10-min-old snapshot would paint instantly. We seed CACHE from localStorage on
// first read (opt-in via { persist: true }), then refresh in the background per
// the normal TTL. Live price data (TTL.price 10s) is NOT persisted - only the
// callers that pass persist:true get the LS layer. Mirrors the getCoinDetails
// 24h persist shape in coinGeckoApi.js. All access is try/catch (private-mode safe).
const PERSIST_PREFIX = 'spectre-market-seed-v1:'
const PERSIST_TTL = 10 * 60 * 1000 // 10min

function persistKey(key) {
  return `${PERSIST_PREFIX}${key}`
}

function persistLoad(key) {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(persistKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.ts !== 'number') return null
    if (Date.now() - parsed.ts > PERSIST_TTL) return null
    return parsed
  } catch {
    return null
  }
}

// Measured on a live prod profile 2026-08-19: the /coins/markets seed was
// 428KB for 250 rows, and 210KB of that (49%) was `sparkline_in_7d` alone —
// ~4% of the whole ~5MB origin budget spent on one field. The seed only has to
// cover FIRST PAINT; the network revalidates within the 10-min TTL and brings
// the real curves with it. Consumers already degrade to a synthetic sparkline
// when the array is absent, which is the tradeoff Wave 1 made for the sibling
// `_singlePageCache` ("sparkline arrays are large and only the live fetch needs
// them") and Wave 7 documented for the Top Coins snapshot ("numbers instant,
// sparklines fill on revalidate"). Numbers, names, logos and ranks — the part
// that defines the layout — are all kept.
const PERSIST_MAX_BYTES = 400_000

function stripSparklines(data) {
  const strip = (rows) => rows.map((r) => {
    if (!r || typeof r !== 'object' || !r.sparkline_in_7d) return r
    const out = { ...r }
    delete out.sparkline_in_7d
    return out
  })
  if (Array.isArray(data)) return strip(data)
  if (data && typeof data === 'object' && Array.isArray(data.data)) {
    return { ...data, data: strip(data.data) }
  }
  return data
}

function persistSave(key, data) {
  if (typeof window === 'undefined') return
  try {
    const raw = JSON.stringify({ data: stripSparklines(data), ts: Date.now() })
    // A single seed must not eat a large share of the origin budget. Dropping
    // it costs one shimmer on the next cold load; keeping it can silently
    // block EVERY other seed's write once the ceiling is reached.
    if (raw.length > PERSIST_MAX_BYTES) return
    window.localStorage.setItem(persistKey(key), raw)
  } catch {
    // quota exceeded / private mode - silently ignore
  }
}

/**
 * When a real HTTP response last landed from this service.
 *
 * Every read path above can answer from cache, a persisted seed, or a stale
 * entry during a failure cooldown — all of which resolve exactly like a live
 * fetch. Callers that need to tell "these numbers are current" from "these
 * numbers are the last ones we ever saw" cannot get that from the payload, so
 * this records the one moment that proves the wire is up. Set only after
 * `res.ok`, never on a cache or stale path.
 */
let _lastOkAt = null
export function lastSpectreOkAt() { return _lastOkAt }

async function fetchBaseJson(base, path, { ttl = 10_000, persist = false, timeoutMs = FETCH_TIMEOUT } = {}) {
  const key = `${base}${path}`
  const cached = cacheGet(key, ttl)
  if (cached) return cached
  if (INFLIGHT.has(key)) {
    // A revalidation is already running. persist callers with a stale-but-
    // recent snapshot paint from it now instead of waiting on the network;
    // the in-flight request refreshes CACHE for the next read either way.
    if (persist) {
      const stale = cacheGetStale(key)
      if (stale) return stale
    }
    return INFLIGHT.get(key)
  }

  // Instant-paint seed: a fresh-enough localStorage snapshot (10min) hydrates
  // the in-memory cache so a cold reload paints immediately, then we still kick
  // a background refresh so the next read is live. Only for persist:true callers.
  // The seed keeps its ORIGINAL ts in the memory cache (a re-stamped ts made the
  // old recursive "background refresh" hit the fresh memory cache and never
  // reach the network - stale seeds were served with no revalidation at all).
  // Instead we fall through to the real network request below and return the
  // seed synchronously while it runs.
  let staleSeed = null
  if (persist) {
    const seed = persistLoad(key)
    if (seed) {
      CACHE.set(key, { data: seed.data, ts: seed.ts })
      // If the seed is younger than the live TTL, it's good enough to serve as-is.
      if (Date.now() - seed.ts <= ttl) return seed.data
      staleSeed = seed.data
    }
  }

  // PR-3 (perf): adopt the index.html early-fetch result for this exact URL
  // if one is in flight (fired at HTML-parse time, before React booted).
  // Consume-once; a failed early fetch falls through to a normal request.
  const early = consumeEarlyFetch(key)
  if (early) {
    const adopted = early.then((result) => {
      if (result && result.ok && result.json !== null) {
        cacheSet(key, result.json)
        if (persist) persistSave(key, result.json)
        return result.json
      }
      INFLIGHT.delete(key)
      return fetchBaseJson(base, path, { ttl, persist, timeoutMs })
    }).finally(() => INFLIGHT.delete(key))
    INFLIGHT.set(key, adopted)
    if (staleSeed !== null) {
      adopted.catch(() => {})
      return staleSeed
    }
    return adopted
  }

  // Recently-failed key: don't hit the network again until the cooldown
  // expires - serve the last good payload if we have one, else fail fast.
  if (inFailureCooldown(key)) {
    const stale = cacheGetStale(key)
    if (stale) return stale
    throw new Error(`Spectre market API cooling down after failure: ${path}`)
  }

  const request = fetch(key, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then(async (res) => {
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        const err = new Error(json?.error || `Spectre market API ${res.status}`)
        err.status = res.status
        throw err
      }
      FAILURES.delete(key)
      _lastOkAt = Date.now()
      cacheSet(key, json)
      if (persist) persistSave(key, json)
      return json
    })
    .catch((err) => {
      recordFailure(key, err?.status)
      const stale = cacheGetStale(key)
      if (stale) return stale
      throw err
    })
    .finally(() => INFLIGHT.delete(key))

  INFLIGHT.set(key, request)
  if (staleSeed !== null) {
    // Instant paint from the seed; the request above revalidates in background
    // (updates CACHE + localStorage for the next reader / poll tick).
    request.catch(() => {})
    return staleSeed
  }
  return request
}

async function fetchJson(path, options) {
  return fetchBaseJson(MARKET_API_BASE, path, options)
}

async function fetchV1Json(path, options) {
  return fetchBaseJson(V1_API_BASE, path, options)
}

// Deduped raw-JSON read of a /data-api/v1 path, sharing the same CACHE +
// INFLIGHT map as every other v1 caller (incl. getSpectreIntelBundle). Lets a
// component that needs the raw response shape (e.g. the home AI Market panel's
// derivatives snapshot) collapse onto an in-flight bundle fetch for the same
// URL instead of issuing a second network request. Returns null on failure.
export async function getV1Json(path, { ttl = TTL.derivatives } = {}) {
  try {
    return await fetchV1Json(path, { ttl })
  } catch (_) {
    return null
  }
}

function pct(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function number(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function assetSymbol(value) {
  const raw = String(value || '').trim().replace(/^\$/, '')
  // Contract-address composite keys (e.g. `0x2260fac5…:1` for WBTC on chain 1)
  // must NOT be uppercased - the deployed /spectre-market-api/token/:asset/...
  // routes match the address case-sensitively and 404 on `0X2260FAC5…:1`.
  // The uppercase rule is only meant for short tickers (BTC, ETH).
  if (/^0x[0-9a-f]+(:\d+)?$/i.test(raw)) return raw.toLowerCase()
  return raw.toUpperCase()
}

function classifyFearGreed(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 'Neutral'
  if (n >= 80) return 'Extreme Greed'
  if (n >= 60) return 'Greed'
  if (n >= 40) return 'Neutral'
  if (n >= 20) return 'Fear'
  return 'Extreme Fear'
}

function classifyAltSeason(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 'Rotation'
  if (n >= 75) return 'Alt Season'
  if (n >= 50) return 'Rotation'
  if (n >= 25) return 'BTC Season'
  return 'Strong BTC Season'
}

// Coerce assorted timestamp shapes (ISO string, UNIX seconds, UNIX millis) to a
// UNIX-seconds string. The fear-greed chart and its hooks do parseInt(t, 10),
// which silently fails on ISO strings (yields the year), so normalize at the
// source.
export function toUnixSecondsString(value) {
  if (value == null) return null
  const asNum = Number(value)
  if (Number.isFinite(asNum) && asNum > 0) {
    const seconds = asNum > 1e12 ? Math.floor(asNum / 1000) : Math.floor(asNum)
    if (seconds > 1e9 && seconds < 1e11) return String(seconds)
  }
  const ms = Date.parse(value)
  if (Number.isFinite(ms)) return String(Math.floor(ms / 1000))
  return null
}

function normalizeFearGreedPoint(point = {}) {
  const value = Number(point.value ?? point.score ?? point.fgi ?? point.fear_greed_index)
  if (!Number.isFinite(value)) return null
  const classification = point.label || point.classification || point.value_classification || classifyFearGreed(value)
  const ts = toUnixSecondsString(point.time || point.timestamp || point.date)
  return {
    value,
    score: value,
    classification,
    value_classification: classification,
    label: classification,
    timestamp: ts,
    time: point.time || point.timestamp || point.date || null,
    ts: point.ts || null,
  }
}

// Extract a Twitter/X handle from a news title or source string.
// Catches patterns like "Nansen (@nansen_ai)", "@arkham:", "by @WuBlockchain".
function _extractHandle(...candidates) {
  for (const s of candidates) {
    if (!s || typeof s !== 'string') continue
    const m = s.match(/@([A-Za-z0-9_]{1,15})/)
    if (m) return m[1]
  }
  return null
}

function normalizeNewsItem(item = {}, index = 0) {
  const published = item.publishedAt || item.published_at || item.publishedOn || item.time || item.createdAt || null
  // Image fallback chain: upstream imageUrl -> @handle via unavatar.io ->
  // source domain favicon. Tweet-shaped news (Nansen/Arkham/Wu Blockchain
  // monitor items) never carry an article thumbnail. unavatar resolves any
  // X handle to its current profile picture for free, no API key.
  let imageUrl = item.imageUrl || item.image_url || item.image || null
  // `imageKind` is the missing half of this chain. An avatar and a favicon are
  // IDENTITY marks, not article art: a 400px profile picture stretched across a
  // 16:9 hero looks broken, and a 128px favicon looks worse. Worse still, both
  // were indistinguishable from a real cover downstream, so the Intelligence
  // hero ranked tweet items FIRST ("has an image") and then rendered the
  // avatar — which unavatar serves as a 404/429 for anything it can't resolve
  // or once the free tier is exhausted. Consumers now choose per kind.
  let imageKind = imageUrl ? 'article' : null
  if (!imageUrl) {
    const handle = _extractHandle(item.title, item.headline, item.source, item.author)
    // `fallback=false` means unavatar 404s instead of returning a generic
    // avatar — fine for a small source badge, fatal as a cover photo.
    if (handle) { imageUrl = `https://unavatar.io/twitter/${handle}?fallback=false`; imageKind = 'avatar' }
  }
  if (!imageUrl) {
    const domain = item.sourceDomain || (typeof item.source === 'string' && item.source.includes('.') ? item.source : null)
    if (domain) { imageUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`; imageKind = 'favicon' }
  }
  return {
    id: String(item.id || item.url || `spectre-news-${index}`),
    title: decodeHtmlEntities(item.title || item.headline || ''),
    url: item.url || '#',
    summary: decodeHtmlEntities(item.summary || item.description || item.detail || item.content || ''),
    source: decodeHtmlEntities(item.source || item.sourceName || item.sourceDomain || 'Spectre'),
    sourceDomain: item.sourceDomain || null,
    imageUrl,
    // 'article' | 'avatar' | 'favicon' | null — only 'article' is cover art.
    imageKind,
    publishedAt: published,
    publishedOn: published ? Math.floor(new Date(published).getTime() / 1000) : 0,
    category: item.category || item.topic || 'crypto',
    categories: item.categories || item.relatedAssets || [],
    sentiment: item.sentiment ?? null,
    importance: item.importance || item.priority || 'medium',
    relatedAssets: item.relatedAssets || item.assets || [],
  }
}

function normalizeCategory(item = {}, index = 0) {
  const id = item.slug || item.id || `spectre-category-${index}`
  const assetCount = number(item.asset_count ?? item.assetCount ?? item.assets)
  const hasPositiveMetric = (value) => number(value) > 0
  const hasMarketMetrics = (
    hasPositiveMetric(item.market_cap) ||
    hasPositiveMetric(item.marketCap) ||
    hasPositiveMetric(item.volume_24h) ||
    hasPositiveMetric(item.volume24h) ||
    hasPositiveMetric(item.volume) ||
    (Array.isArray(item.top_3_coins) && item.top_3_coins.length > 0)
  )
  return {
    id: String(id),
    slug: item.slug || String(id),
    name: item.name || item.title || String(id),
    market_cap: number(item.market_cap ?? item.marketCap),
    market_cap_change_24h: number(item.market_cap_change_24h ?? item.change_24h ?? item.change24h),
    volume_24h: number(item.volume_24h ?? item.volume24h ?? item.volume),
    top_3_coins: Array.isArray(item.top_3_coins) ? item.top_3_coins : [],
    asset_count: assetCount,
    description: item.description || '',
    _source: 'spectre-market',
    _hasMarketMetrics: hasMarketMetrics,
  }
}

function rowForAsset(rows = [], asset) {
  const symbol = assetSymbol(asset)
  return rows.find((row) => assetSymbol(row.asset || row.symbol) === symbol) || null
}

const DERIVATIVE_ASSETS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP']

function unwrapV1Data(payload) {
  return payload?.data ?? payload ?? null
}

async function getDerivativeDashboard(asset) {
  const symbol = assetSymbol(asset)
  if (!symbol) return null
  const payload = await fetchV1Json(`/derivatives/composite/dashboard/${encodeURIComponent(symbol)}`, { ttl: TTL.derivatives })
  return unwrapV1Data(payload)
}

async function getDerivativeRows(assets = DERIVATIVE_ASSETS, { priceScope = 'all' } = {}) {
  const symbols = [...new Set((assets || DERIVATIVE_ASSETS).map(assetSymbol).filter(Boolean))]

  try {
    // Use the SAME `?limit=500` URL as getSpectreOpenInterest()'s meta fetch and
    // the home AI-panel snapshot, so all three collapse onto one INFLIGHT/cache
    // entry instead of this firing a separate UNLIMITED open-interest call.
    // 500 asset rows is far more than the BTC/ETH/SOL lookups below need.
    const payload = await fetchV1Json('/derivatives/open-interest?limit=500', { ttl: TTL.derivatives })
    const directRows = Array.isArray(payload?.data) ? payload.data : []
    if (directRows.length > 0) {
      // priceScope 'majors' skips the full 500-symbol /v1/prices enrichment
      // (~5 chunked requests, ~220KB) and prices only the requested majors.
      // Only traders-corner's OI heatmap actually renders per-row prices —
      // the intel bundles read price solely for BTC/ETH/SOL unit conversion.
      const priceSymbols = priceScope === 'majors'
        ? symbols
        : directRows.map((row) => assetSymbol(row.asset || row.symbol)).filter(Boolean)
      const prices = await getSpectrePricesBySymbols(priceSymbols).catch(() => ({}))
      return directRows
        .map((row = {}) => {
          const symbol = assetSymbol(row.asset || row.symbol)
          if (!symbol) return null
          const price = number(prices?.[symbol]?.price)
          const rawFunding = number(row.weighted_funding_rate ?? row.avg_funding_rate ?? row.funding_rate ?? row.rate)
          const oiUsd = number(row.oi_usd ?? row.total_oi_usd)
          return {
            asset: symbol,
            symbol,
            price,
            oi_usd: oiUsd,
            total_oi_usd: oiUsd,
            oi_change_24h_pct: number(row.oi_change_24h_pct ?? row.change_24h_pct),
            oi_change_1h_pct: number(row.oi_change_1h_pct),
            oi_change_4h_pct: number(row.oi_change_4h_pct),
            exchange_breakdown: row.oi_exchange_breakdown || row.exchange_breakdown || {},
            total_liq_24h: number(row.total_liq_24h_usd ?? row.liq_24h),
            total_liq_24h_usd: number(row.total_liq_24h_usd ?? row.liq_24h),
            long_liq_24h: number(row.long_liq_24h_usd ?? row.liq_long_24h),
            long_liq_24h_usd: number(row.long_liq_24h_usd ?? row.liq_long_24h),
            short_liq_24h: number(row.short_liq_24h_usd ?? row.liq_short_24h),
            short_liq_24h_usd: number(row.short_liq_24h_usd ?? row.liq_short_24h),
            rate: rawFunding,
            funding_rate: number(row.funding_rate ?? row.rate),
            weighted_funding_rate: rawFunding,
            avg_funding_rate: number(row.avg_funding_rate ?? row.rate),
            long_short_ratio: number(row.long_short_ratio),
            updated_at: row.updated_at || row.time || null,
            source: 'spectre-v1-derivatives-open-interest',
          }
        })
        .filter(Boolean)
    }
  } catch {
    // Fall back to per-asset composite dashboards below.
  }

  const [dashboards, prices] = await Promise.all([
    Promise.allSettled(symbols.map(getDerivativeDashboard)),
    getSpectrePricesBySymbols(symbols).catch(() => ({})),
  ])

  return dashboards
    .map((result, index) => {
      if (result.status !== 'fulfilled') return null
      const summary = result.value?.summary || result.value || null
      if (!summary) return null
      const symbol = assetSymbol(summary.asset || symbols[index])
      const price = number(prices?.[symbol]?.price)
      const rawFunding = number(summary.weighted_funding_rate ?? summary.avg_funding_rate)
      const oiUsd = number(summary.total_oi_usd)
      return {
        asset: symbol,
        symbol,
        price,
        oi_usd: oiUsd,
        total_oi_usd: oiUsd,
        oi_change_24h_pct: number(summary.oi_change_24h_pct),
        oi_change_1h_pct: number(summary.oi_change_1h_pct),
        oi_change_4h_pct: number(summary.oi_change_4h_pct),
        exchange_breakdown: summary.oi_exchange_breakdown || summary.exchange_breakdown || {},
        total_liq_24h: number(summary.total_liq_24h_usd),
        total_liq_24h_usd: number(summary.total_liq_24h_usd),
        long_liq_24h: number(summary.long_liq_24h_usd),
        long_liq_24h_usd: number(summary.long_liq_24h_usd),
        short_liq_24h: number(summary.short_liq_24h_usd),
        short_liq_24h_usd: number(summary.short_liq_24h_usd),
        rate: rawFunding,
        funding_rate: rawFunding,
        weighted_funding_rate: rawFunding,
        avg_funding_rate: number(summary.avg_funding_rate),
        long_short_ratio: number(summary.long_short_ratio),
        dominance: number(summary.dominance),
        updated_at: summary.updated_at || summary.time || null,
        source: 'spectre-v1-derivatives-composite',
      }
    })
    .filter(Boolean)
}

export function normalizeSpectrePriceRow(row, fallbackSymbol = '') {
  if (!row) return null
  const symbol = String(row.symbol || fallbackSymbol || '').toUpperCase()
  const change = row.change || {}
  const change24 = typeof change === 'object' ? change['24h'] : row.change
  const supply = row.supply || {}
  return {
    price: number(row.price),
    change: pct(change24),
    change24: pct(change24),
    change1h: pct(typeof change === 'object' ? change['1h'] : row.change1h),
    change7d: pct(typeof change === 'object' ? change['7d'] : row.change7d),
    change30d: pct(typeof change === 'object' ? change['30d'] : row.change30d),
    change1y: pct(typeof change === 'object' ? change['1y'] : row.change1y),
    volume: number(row.volume_24h ?? row.volume24h ?? row.volume),
    marketCap: number(row.market_cap ?? row.marketCap),
    fdv: number(row.fdv),
    // NO volume fallback. /v1/prices carries no `liquidity` for CEX-listed
    // majors, so falling back to 24h volume made every "Liquidity" surface an
    // exact copy of the Volume column next to it (watchlists rendered BTC as
    // $29.44B volume / $29.44B liquidity). Volume is turnover, liquidity is
    // pool depth - conflating them erases the very signal that separates a real
    // pool from a wash-traded clone. Absent stays absent; the sentinel renders.
    liquidity: number(row.liquidity ?? row.liquidity_usd),
    high24h: number(row.high_24h),
    low24h: number(row.low_24h),
    logo: row.image || row.logo_url || row.logo || COINGECKO_LOGOS[symbol] || null,
    image: row.image || row.logo_url || row.logo || COINGECKO_LOGOS[symbol] || null,
    name: row.name || symbol,
    rank: row.rank ?? null,
    coingeckoId: row.coingecko_id || row.id || null,
    contract: row.contract || null,
    chain: row.chain || null,
    circulatingSupply: number(supply.circulating ?? row.circulating_supply ?? row.circulatingSupply),
    totalSupply: number(supply.total ?? row.total_supply ?? row.totalSupply),
    maxSupply: number(supply.max ?? row.max_supply ?? row.maxSupply),
    ath: row.ath || null,
    atl: row.atl || null,
    scores: row.scores || {},
    technicals: row.technicals || {},
    derivatives: row.derivatives || {},
    social: row.social || {},
    community: row.community || {},
    updatedAt: row.updated_at || row.updatedAt || row.time || null,
    _source: 'spectre-market',
  }
}

export function toCoinMarketRow(row, index = 0, offset = 0) {
  if (!row) return null
  const symbol = String(row.symbol || row.asset || '').toLowerCase()
  const upper = symbol.toUpperCase()
  const normalized = normalizeSpectrePriceRow(row, upper)
  if (!normalized) return null
  return {
    id: row.coingecko_id || SYMBOL_TO_COINGECKO_ID[upper] || symbol,
    symbol,
    name: row.name || row.asset || upper,
    image: normalized.image,
    current_price: normalized.price,
    market_cap: normalized.marketCap,
    market_cap_rank: row.rank ?? offset + index + 1,
    total_volume: normalized.volume,
    price_change_percentage_24h: normalized.change24,
    price_change_percentage_1h_in_currency: normalized.change1h,
    price_change_percentage_7d_in_currency: normalized.change7d,
    price_change_percentage_30d_in_currency: normalized.change30d,
    price_change_percentage_1y_in_currency: normalized.change1y,
    sparkline_in_7d: null,
    // Backend audit 2026-04-29: `/v1/prices?limit` is symbol-keyed and can
    // collide on ambiguous tickers. Use these rows as provisional fallbacks,
    // not authoritative discovery/market-cap ranking.
    _source: 'spectre-market-provisional',
    _provisionalIdentity: true,
  }
}

export async function getSpectrePricesBySymbols(symbols = []) {
  // Sort the symbols so the request URL is canonical: fetchBaseJson keys both
  // its TTL cache and its in-flight dedup map on the full URL, so two callers
  // asking for the same set in a different order (e.g. one insertion-ordered,
  // one alphabetical) would otherwise miss the cache and fire duplicate
  // requests. The response is a symbol-keyed map, so order is irrelevant to
  // consumers - sorting is purely a cache-coalescing win.
  const unique = [...new Set(
    (Array.isArray(symbols) ? symbols : String(symbols).split(','))
      .map((s) => String(s || '').trim().replace(/^\$/, '').toUpperCase())
      .filter(Boolean),
  )].sort()
  if (unique.length === 0) return {}

  const chunks = []
  for (let i = 0; i < unique.length; i += PRICE_CHUNK_SIZE) {
    chunks.push(unique.slice(i, i + PRICE_CHUNK_SIZE))
  }

  const results = await Promise.allSettled(chunks.map(async (chunk) => {
    const qs = new URLSearchParams({ symbols: chunk.join(',') })
    const payload = await fetchV1Json(`/prices?${qs}`, { ttl: TTL.price })
    return payload?.data || {}
  }))

  const out = {}
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const [key, row] of Object.entries(result.value || {})) {
      const symbol = String(row?.symbol || key || '').toUpperCase()
      const mapped = normalizeSpectrePriceRow(row, symbol)
      if (symbol && mapped) out[symbol] = mapped
    }
  }

  // ── Ingester-stall guard ────────────────────────────────────────────────
  // The Hetzner /v1/prices ingester periodically FREEZES (documented recurring
  // stall) and keeps serving rows hours old — e.g. ETH stuck at $1884 while the
  // live tape is ~$1914. Every consumer that reads this map directly (LITE
  // Research / Markets / Watchlist) then shows a wrong price. `getBinancePrices`
  // already guards its own callers, but direct callers were unprotected. Re-
  // source the LIVE price + 24h change for any KNOWN-STALE major from the
  // Binance ticker (the "Binance wins for real-time price" rule). Fresh rows are
  // untouched — Spectre stays the default source.
  //
  // TWO lanes, because a Binance pair only exists for the majors. The long
  // tail (SPECTRE, PALM, NEURAL, …) had NO guard at all: a frozen row was
  // served verbatim, which is how LITE printed SPECTRE -1.20% while CoinGecko
  // and CoinMarketCap both read it green (founder 2026-08-12). Those rows get
  // re-sourced from CoinGecko by the coingecko_id the box itself returns.
  const STALE_MS = 5 * 60 * 1000
  const isStale = (s) => {
    const ts = Date.parse(out[s]?.updatedAt || '')
    return Number.isFinite(ts) && Date.now() - ts > STALE_MS
  }
  const staleSyms = Object.keys(out).filter((s) => isStale(s) && binancePairFor(s))
  // symbol -> coingecko id, for stale rows Binance can't cover
  const staleCg = {}
  for (const s of Object.keys(out)) {
    if (!isStale(s) || binancePairFor(s)) continue
    const id = out[s]?.coingeckoId
    if (id) staleCg[s] = id
  }

  const reviveFromBinance = async () => {
    if (staleSyms.length === 0) return
    const res = await fetch('/api/binance-ticker', { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return
    const all = await res.json()
    const byPair = {}
    if (Array.isArray(all)) for (const t of all) byPair[t.symbol] = t
    const nowIso = new Date().toISOString()
    for (const s of staleSyms) {
      const t = byPair[binancePairFor(s)]
      const price = t ? parseFloat(t.lastPrice) : NaN
      if (Number.isFinite(price) && price > 0) {
        const ch = parseFloat(t.priceChangePercent)
        out[s] = {
          ...out[s],
          price,
          change: Number.isFinite(ch) ? ch : out[s].change,
          change24: Number.isFinite(ch) ? ch : out[s].change24,
          high24h: parseFloat(t.highPrice) || out[s].high24h,
          low24h: parseFloat(t.lowPrice) || out[s].low24h,
          updatedAt: nowIso, // mark fresh so downstream stale checks don't re-fetch
        }
      }
    }
  }

  // Long tail: one CoinGecko /coins/markets call for every stale non-CEX row.
  // Same-origin proxy (`/api/coingecko`), so no cycle back into coinGeckoApi —
  // that module already imports THIS one.
  const reviveFromCoinGecko = async () => {
    const syms = Object.keys(staleCg)
    if (syms.length === 0) return
    const ids = [...new Set(syms.map((s) => staleCg[s]))]
    const qs = new URLSearchParams({
      vs_currency: 'usd',
      ids: ids.join(','),
      order: 'market_cap_desc',
      sparkline: 'false',
      price_change_percentage: '1h,24h,7d',
    })
    const res = await fetch(`/api/coingecko/coins/markets?${qs}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return
    const rows = await res.json()
    if (!Array.isArray(rows)) return
    const byId = {}
    for (const r of rows) if (r?.id) byId[r.id] = r
    const nowIso = new Date().toISOString()
    for (const s of syms) {
      const r = byId[staleCg[s]]
      const price = Number(r?.current_price)
      if (!Number.isFinite(price) || price <= 0) continue
      const ch = Number(r.price_change_percentage_24h)
      out[s] = {
        ...out[s],
        price,
        change: Number.isFinite(ch) ? ch : out[s].change,
        change24: Number.isFinite(ch) ? ch : out[s].change24,
        change1h: Number.isFinite(Number(r.price_change_percentage_1h_in_currency))
          ? Number(r.price_change_percentage_1h_in_currency) : out[s].change1h,
        change7d: Number.isFinite(Number(r.price_change_percentage_7d_in_currency))
          ? Number(r.price_change_percentage_7d_in_currency) : out[s].change7d,
        marketCap: Number(r.market_cap) || out[s].marketCap,
        volume: Number(r.total_volume) || out[s].volume,
        high24h: Number(r.high_24h) || out[s].high24h,
        low24h: Number(r.low_24h) || out[s].low24h,
        updatedAt: nowIso,
      }
    }
  }

  if (staleSyms.length > 0 || Object.keys(staleCg).length > 0) {
    // Never let a revival failure take down the whole map — a frozen box price
    // still beats nothing, and each lane is independent.
    await Promise.allSettled([reviveFromBinance(), reviveFromCoinGecko()])
  }
  return out
}

export async function getSpectreTopMarketsPage(page = 1, perPage = 25) {
  const safePage = Math.max(1, Number(page) || 1)
  const safePerPage = Math.min(Math.max(1, Number(perPage) || 25), 200)
  const offset = (safePage - 1) * safePerPage
  const qs = new URLSearchParams({
    limit: String(safePerPage),
    offset: String(offset),
    sort: 'market_cap',
    order: 'desc',
  })
  const payload = await fetchV1Json(`/prices?${qs}`, { ttl: TTL.list, persist: true })
  const rows = Array.isArray(payload?.data) ? payload.data : []
  return filterRankedCoins(rows.map((row, index) => toCoinMarketRow(row, index, offset)).filter(Boolean))
}

// CG-shape pass-through served from Hetzner. Unlike `/v1/prices`, this
// returns the full `sparkline_in_7d` payload because it proxies the
// upstream CoinGecko /coins/markets directly with Hetzner-side caching
// (`X-Cache: HIT` confirmed 2026-05-15). This is the right replacement
// for the frontend's `getTopCoinsMarketsPage` — one CG hit per Hetzner
// cache TTL, served to all users.
export async function getSpectreCoinsMarketsPage(page = 1, perPage = 100, { sparkline = true } = {}) {
  const safePage = Math.max(1, Number(page) || 1)
  const safePerPage = Math.min(Math.max(1, Number(perPage) || 100), 250)
  const qs = new URLSearchParams({
    vs_currency: 'usd',
    order: 'market_cap_desc',
    per_page: String(safePerPage),
    page: String(safePage),
    sparkline: sparkline ? 'true' : 'false',
    price_change_percentage: '1h,24h,7d,30d',
  })
  // 6s cap (measured ~0.5s normally): if the Spectre upstream hangs (e.g. a
  // WAF challenge), fail fast into getTopCoinsMarketsPage's direct-CG fallback
  // instead of burning the full 12s default before the table can paint.
  const payload = await fetchV1Json(`/coins/markets?${qs}`, { ttl: TTL.list, persist: true, timeoutMs: 6000 })
  // /coins/markets returns the raw CG array (no { data: [] } envelope).
  const rows = Array.isArray(payload) ? payload : (payload?.data || [])
  // Drop CG-ranked junk (FIGR_HELOC / RAIN etc.) before it pollutes the
  // mcap-ordered Top Coins list + bubbles. See marketDataExclusions.js.
  return filterRankedCoins(rows)
}

export async function getSpectreSearch(query, limit = 10) {
  const q = String(query || '').trim()
  if (!q) return { coins: [], exchanges: [], categories: [], protocols: [] }
  const qs = new URLSearchParams({ q, limit: String(limit) })
  const payload = await fetchV1Json(`/search?${qs}`, { ttl: TTL.search })
  return payload?.data || { coins: [], exchanges: [], categories: [], protocols: [] }
}

export async function getSpectreBubbles({ period = '24h', limit = 100, category = '' } = {}) {
  const qs = new URLSearchParams({ period, limit: String(limit) })
  if (category) qs.set('category', category)
  const payload = await fetchV1Json(`/bubbles?${qs}`, { ttl: TTL.list, persist: true })
  return Array.isArray(payload?.data) ? payload.data : []
}

export async function getSpectreHeatmap({ period = '24h', limit = 100, category = '' } = {}) {
  const qs = new URLSearchParams({ period, limit: String(limit) })
  if (category) qs.set('category', category)
  const payload = await fetchV1Json(`/heatmap?${qs}`, { ttl: TTL.list, persist: true })
  return Array.isArray(payload?.data) ? payload.data : []
}

export async function getSpectreCategories({ limit = 250 } = {}) {
  const payload = await fetchV1Json('/categories', { ttl: TTL.categories })
  const rows = Array.isArray(payload?.data) ? payload.data : []
  return rows
    .map(normalizeCategory)
    .filter((row) => row.name)
    .slice(0, Math.max(1, Number(limit) || 250))
}

export async function getSpectreGlobalMarket() {
  // persist: seeds the always-visible slim-intel bar (global + dominance + alt-season).
  const payload = await fetchV1Json('/market/global', { ttl: TTL.market, persist: true })
  return payload?.data || null
}

export async function getSpectreMarketDominance() {
  const payload = await fetchV1Json('/market/dominance', { ttl: TTL.market, persist: true })
  const data = payload?.data || {}
  const btc = number(data.btc ?? data.btc_dominance)
  const eth = number(data.eth ?? data.eth_dominance)
  let sol = number(data.sol ?? data.sol_dominance)

  // The v1 payload ships only btc/eth/others, and its `others` is 100 - btc -
  // eth: SOL is still counted inside it. Every surface that renders a separate
  // SOL slice (welcome dominance ring, traders-corner on-chain chips) then
  // double-counts SOL and the four numbers add up past 100 (observed:
  // 59.1 + 11.0 + 4.0 + 29.9 = 104%). Derive SOL's real share from its market
  // cap over the global total instead - both calls are TTL-cached and already
  // in flight for the same bundle, so this is free in practice.
  if (!(sol > 0)) {
    try {
      const [prices, globalMarket] = await Promise.all([
        getSpectrePricesBySymbols(['SOL']),
        getSpectreGlobalMarket(),
      ])
      const solMcap = number(prices?.SOL?.marketCap)
      const totalMcap = number(globalMarket?.totalMarketCap ?? globalMarket?.total_market_cap)
      if (solMcap > 0 && totalMcap > 0) sol = (solMcap / totalMcap) * 100
    } catch {
      // Leave sol at 0 - an absent slice beats an invented one.
    }
  }

  // Always derived, never the upstream `others`: the four slices we render must
  // sum to 100.
  const others = Math.max(0, 100 - btc - eth - sol)
  return { btc, eth, sol, others, source: 'spectre-v1-market-dominance' }
}

// Daily total-market-cap series (from the dominance/history endpoint, which is
// allowlisted in prod). Used to compute whole-market 7d/30d liquidity flow —
// the /coins/markets passthrough returns null for 30d, so the tape-delta must
// come from this snapshot series instead.
export async function getSpectreMarketCapHistory(days = 35) {
  const safeDays = Math.min(Math.max(Number(days) || 35, 2), 365)
  const payload = await fetchV1Json(`/global/dominance/history?days=${safeDays}`, { ttl: TTL.categories, persist: true })
  const rows = Array.isArray(payload?.data) ? payload.data : []
  return rows
    .map((row = {}) => {
      const time = row.ts || row.time || row.timestamp || row.date
      const ts = Number(row.ts) || Math.floor(new Date(time).getTime() / 1000)
      const totalMarketCap = number(row.total_market_cap ?? row.totalMarketCap ?? row.market_cap)
      return { ts, totalMarketCap }
    })
    .filter((row) => Number.isFinite(row.ts) && row.totalMarketCap > 0)
    .sort((a, b) => a.ts - b.ts)
}

export async function getSpectreDominanceHistory(days = 365) {
  const safeDays = Math.min(Math.max(Number(days) || 365, 1), 9999)
  const payload = await fetchV1Json(`/global/dominance/history?days=${safeDays}`, { ttl: TTL.categories })
  const rows = Array.isArray(payload?.data) ? payload.data : []
  return rows
    .map((row = {}) => {
      const time = row.ts || row.time || row.timestamp || row.date
      const ts = Number(row.ts) || Math.floor(new Date(time).getTime() / 1000)
      const btc = number(row.btc ?? row.btc_dominance)
      const eth = number(row.eth ?? row.eth_dominance)
      const others = number(row.others ?? row.others_dominance ?? Math.max(0, 100 - btc - eth))
      return { ts, btc, eth, others }
    })
    .filter((row) => Number.isFinite(row.ts) && row.btc > 0 && row.eth >= 0)
}

export async function getSpectreAltSeason() {
  // CoinMarketCap Altcoin Season Index (canonical gauge). Served by our own
  // /api/market/alt-season route (Express in dev, market-intel serverless in
  // prod) which proxies CMC's public data-api. Flat payload (no { data }
  // wrapper) - keep the .data fallback for back-compat with the old v1 shape.
  const payload = await fetchBaseJson('', '/api/market/alt-season', { ttl: TTL.market, persist: true })
  const data = payload?.data || payload || {}
  const value = number(data.index ?? data.value ?? data.score)
  return {
    value,
    index: value,
    label: data.season || data.label || classifyAltSeason(value),
    season: data.season || data.label || classifyAltSeason(value),
    outperformingAlts: number(data.outperforming_alts ?? data.outperformingAlts),
    totalAlts: number(data.total_alts ?? data.totalAlts),
    btc30dChange: number(data.btc_30d_change ?? data.btc30dChange),
    source: 'cmc-alt-season',
  }
}


// OTHERS2 (alt long tail, ex-top-100) accurate value + full history line: an
// engineered cycle backfill (2020→) that blends into the REAL recorded value at
// the present, then live hourly points forward. Served by the data-api
// others2-snapshot worker + /v1/market/others2. One source for app + TG bot.
// NOTE: no persist:true here. The endpoint is fast + edge-cached (300s); a
// localStorage seed risked stranding a reader on a stale EMPTY-history snapshot
// (fetchBaseJson serves a >15s-old seed synchronously and only revalidates in
// the background, so an old empty seed from the endpoint's build phase would
// never be picked up) → the chart silently fell back to the 1y reconstruction.
export async function getSpectreOthers2History(days = 2600) {
  const payload = await fetchV1Json(`/market/others2?days=${days}`, { ttl: TTL.market })
  const data = payload?.data || payload || {}
  // 🪤 Two different things live in this table and the endpoint used to serve
  // them as one anonymous series: `live` rows are what the 15-min recorder
  // MEASURED (2026-07-22 →), `modeled` rows are a weekly reconstruction seeded
  // back to 2020 before the recorder existed. Drawn as one line they weld a
  // synthetic monotonic ramp onto a real tape — the "OTHERS2 chart is screwed"
  // report from LITE Microcaps on 2026-08-07. Carry the provenance so the
  // CHART can take the tape and the CYCLE-DEPTH gauge can keep the model.
  // `share` is the fallback tell for a box that predates the `source` field:
  // the recorder always writes a real share, the seed wrote NULL.
  const history = Array.isArray(data.history)
    ? data.history.map((h) => {
      const share = Number(h.share)
      const src = h.source || (Number.isFinite(share) && share > 0 ? 'live' : 'modeled')
      return { ts: Number(h.t), o: Number(h.o), share: Number.isFinite(share) ? share : 0, src }
    }).filter((h) => h.ts > 0 && h.o > 0).sort((a, b) => a.ts - b.ts)
    : []
  const c = data.current || null
  // `time` is the box's own stamp on the print. Dropping it is how a headline
  // that had not moved since 04:30 UTC could render under a "Live" pill.
  const current = c ? { others2: number(c.others2), total: number(c.total), share: number(c.share), at: Date.parse(c.time) || null } : null
  const liveFrom = Number(data.liveFrom) || (history.find((h) => h.src === 'live')?.ts ?? null)
  return { history, current, liveFrom }
}

// ── why-mode (2026-07-27): the day-tracker spine + the market half of the
//    consciousness fuse. Both served by the box (market_events recorder +
//    brain_consciousness_state); every event is already GATED server-side
//    (liquidation unit artifacts quarantined, self-describing headlines and
//    rhetoric rejected) — render, never re-filter. `at` is when the market did
//    it; `backfilled` rows are history, never breaking. ──────────────────────
export async function getSpectreMarketTimeline({ hours = 24, lane = null, limit = null } = {}) {
  const qs = new URLSearchParams({ hours: String(hours) })
  if (lane) qs.set('lane', lane)
  // 🪤 The box caps the row count, and that cap USED to be applied to an
  // ascending sort — so any window holding more rows than the cap served the
  // OLDEST N and dropped everything newer without a word. On 2026-08-03 the 7D
  // view's newest row was 31 Jul while the recorder was writing every 45s.
  // The box now takes the newest N (see /v1/market/timeline), but a caller
  // still has to ASK for enough rows to cover its own window or the old end
  // goes missing just as quietly. Always pass a limit sized to `hours`.
  if (limit) qs.set('limit', String(limit))
  const payload = await fetchV1Json(`/market/timeline?${qs}`, { ttl: 30_000 })
  const rows = Array.isArray(payload?.data) ? payload.data : []
  return rows
    .map((r) => ({
      at: Date.parse(r.at),
      kind: String(r.kind || ''),
      lane: String(r.lane || ''),
      asset: r.asset || null,
      magnitude: number(r.magnitude),
      text: String(r.text || ''),
      evidence: r.evidence || {},
      importance: number(r.evidence?.importance),
      backfilled: !!r.backfilled,
    }))
    .filter((r) => Number.isFinite(r.at) && r.text)
    .sort((a, b) => a.at - b.at)
}

// The day digest — /market/timeline grouped server-side into one card per
// calendar day, so the "walk me through this week" view never drags ~1MB of
// event rows over the wire to render ~10 cards.
//
// Price is joined CLIENT-side from daily candles (see getSpectreDailyCloses):
// the events live in the postgres metadata DB and the closes in timescale,
// behind different pools, so the box would pay a cross-DB round trip to do
// what one extra cached request does here for free.
export async function getSpectreMarketDays({ days = 7, perDay = 8, lane = null } = {}) {
  const qs = new URLSearchParams({ days: String(days), perDay: String(perDay) })
  if (lane) qs.set('lane', lane)
  const payload = await fetchV1Json(`/market/days?${qs}`, { ttl: 300_000 })
  const rows = Array.isArray(payload?.data) ? payload.data : []
  return {
    days: rows.map((d) => ({
      date: String(d.date || '').slice(0, 10),
      total: number(d.total) || 0,
      carried: number(d.carried) || 0,
      lanes: d.lanes && typeof d.lanes === 'object' ? d.lanes : {},
      headline: d.headline || null,
      events: (Array.isArray(d.events) ? d.events : []).map((e) => ({
        at: Date.parse(e.at),
        kind: String(e.kind || ''),
        lane: String(e.lane || ''),
        text: String(e.text || ''),
        score: number(e.score),
        backfilled: !!e.backfilled,
        // Absent stays absent — the macro lane genuinely has no source, and a
        // placeholder byline would be a fabricated citation.
        source: e.source || null,
        url: e.url || null,
        confirmations: number(e.confirmations),
        context: e.context || null,
        sentiment: e.sentiment || null,
        assets: Array.isArray(e.assets) ? e.assets : [],
      })).filter((e) => Number.isFinite(e.at) && e.text),
    })).filter((d) => d.date),
    // The recorder started 2026-07-27 (backfilled 7d behind it), so a 30-day
    // request is NOT 30 days of coverage. The UI says where the record begins
    // rather than letting an absent card read as a quiet day.
    oldest: payload?.meta?.oldest || null,
  }
}

// Daily closes for the day cards. Same route the why session map uses, but the
// 1d interval is served from a different (cached) path than the 15m one — this
// is 0.1s warm, not the 17s intraday case below.
export async function getSpectreDailyCloses(symbol = 'BTC', range = '30d') {
  const payload = await fetchV1Json(
    `/prices/${encodeURIComponent(symbol)}/ohlcv?interval=1d&range=${range}`,
    { ttl: 300_000, timeoutMs: 20_000 },
  )
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : []
  const out = new Map()
  for (const b of rows) {
    const t = Date.parse(b.time)
    const close = number(b.close)
    const open = number(b.open)
    if (!Number.isFinite(t) || !(close > 0)) continue
    // Key by the UTC calendar day so it joins the digest's `date` directly —
    // the box already stamps these candles at 00:00Z.
    out.set(new Date(t).toISOString().slice(0, 10), {
      close,
      changePct: open > 0 ? ((close - open) / open) * 100 : null,
    })
  }
  return out
}

// candles for the why-page session map — exchange tape, same source the box
// why-engine trusts (never the freezable /v1/prices row cache)
//
// 🪤 This one endpoint needs its own deadline. `/v1/prices/{SYM}/ohlcv` is
// uncached on the box and measures 17-18.5s (the data-lane audit has had it at
// 14-17s since 2026-07-07), while the shared FETCH_TIMEOUT is 12s — so every
// call aborted, tripped the failure cooldown, and the why-page session map,
// reversal watch and chapters silently never rendered. Do NOT fix this by
// raising the global timeout: that would slow failover for every other
// surface. The real cure is server-side caching (Alaa/KD lane).
const OHLCV_TIMEOUT_MS = 30_000
export async function getSpectreOhlcv(symbol = 'BTC', interval = '15m', range = '24h') {
  const payload = await fetchV1Json(
    `/prices/${encodeURIComponent(symbol)}/ohlcv?interval=${interval}&range=${range}`,
    { ttl: 60_000, timeoutMs: OHLCV_TIMEOUT_MS },
  )
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : []
  return rows
    .map((b) => ({ t: Date.parse(b.time), o: number(b.open), h: number(b.high), l: number(b.low), c: number(b.close), v: number(b.volume) }))
    .filter((b) => Number.isFinite(b.t) && b.c > 0)
    .sort((a, b) => a.t - b.t)
}

export async function getSpectreMarketState() {
  const payload = await fetchV1Json('/market/state', { ttl: 60_000 })
  const s = payload?.data || null
  if (!s) return null
  // `narrative` is the interpretive desk-note layer (LLM, grounded strictly in
  // the gated context the box already assembled). It rides ALONGSIDE the
  // deterministic state, never inside it, so a surface that must not quote an
  // LLM can keep using `read` and ignore this entirely.
  return {
    ...s,
    generatedAt: payload?.meta?.generated_at || null,
    narrative: payload?.narrative?.text || null,
    narrativeModel: payload?.narrative?.model || null,
    // When the note itself was written (its data as-of), vs generatedAt above
    // which is the whole snapshot's stamp. The box refreshes generated_at on
    // every tick even when the cadence gate reuses the prose, so this is the
    // honest "as of" for the note text.
    narrativeAt: payload?.narrative?.generated_at || null,
    // The RESOLVED deterministic driver the box computed BEFORE the model
    // wrote a word (why-driver.js materiality ladder). Surfaces render it as
    // a labeled line above the prose; it can never disagree with the note
    // because both come from the same resolved context. null on older boxes.
    narrativeDriver: payload?.narrative?.driver || null,
    narrativeNoCatalyst: payload?.narrative?.no_catalyst === true,
  }
}

export async function getSpectreFearGreedCurrent() {
  const payload = await fetchV1Json('/market/fear-greed', { ttl: TTL.sentiment })
  return normalizeFearGreedPoint(payload?.data?.current) || null
}

export async function getSpectreFearGreedHistory(limit = 365) {
  const payload = await fetchV1Json('/market/fear-greed', { ttl: TTL.sentiment })
  const history = Array.isArray(payload?.data?.history) ? payload.data.history : []
  return {
    data: history.map(normalizeFearGreedPoint).filter(Boolean).slice(0, limit),
  }
}

export async function getSpectreGlobalMetrics() {
  const data = await getSpectreGlobalMarket()
  if (!data) return null
  const totalMarketCap = number(data.totalMarketCap || data.totalMarketCapUsd || data.total_market_cap || data.marketCap)
  const totalVolume = number(data.totalVolume24h || data.totalVolume || data.total_volume_24h || data.volume24h)
  return {
    totalMarketCap,
    totalVolume,
    btcDominance: number(data.btcDominance ?? data.btc_dominance),
    ethDominance: number(data.ethDominance ?? data.eth_dominance),
    solDominance: number(data.solDominance ?? data.sol_dominance),
    activeCryptos: number(data.activeAssets || data.active_cryptocurrencies || data.trackedAssets),
    activeAssets: number(data.activeAssets ?? data.active_cryptocurrencies),
    trackedAssets: number(data.trackedAssets ?? data.markets),
    marketCapChange24h: number(data.marketCapChange24h ?? data.market_cap_change_24h),
    topByVolume: Array.isArray(data.topByVolume) ? data.topByVolume : [],
    btcPrice: number(data.btcPrice),
    ethPrice: number(data.ethPrice),
    solPrice: number(data.solPrice),
  }
}

export async function getSpectreTokenMovers(limit = 20) {
  const rows = await getSpectreBubbles({ period: '24h', limit: Math.max(10, Number(limit) || 20) })
  const mapMover = (row = {}, index = 0) => ({
    id: row.asset || row.symbol || `mover-${index}`,
    symbol: assetSymbol(row.asset || row.symbol),
    name: row.name || assetSymbol(row.asset || row.symbol),
    price: number(row.price),
    change: number(row.change ?? row.change_24h ?? row.change24h),
    volume: number(row.volume_24h ?? row.volume24h ?? row.volume),
    marketCap: number(row.market_cap ?? row.marketCap),
  })
  const mapped = rows.map(mapMover).filter((row) => row.symbol)
  return {
    gainers: mapped.filter((row) => row.change > 0).sort((a, b) => b.change - a.change).slice(0, limit),
    losers: mapped.filter((row) => row.change < 0).sort((a, b) => a.change - b.change).slice(0, limit),
  }
}

export async function getSpectreFundingRates({ priceScope = 'all' } = {}) {
  try {
    const payload = await fetchV1Json('/derivatives/funding-rates', { ttl: TTL.derivatives })
    const directRows = Array.isArray(payload?.data) ? payload.data : []
    if (directRows.length > 0) {
      const rows = directRows.map((row = {}) => ({
        ...row,
        asset: assetSymbol(row.asset || row.symbol),
        symbol: assetSymbol(row.asset || row.symbol),
        rate: number(row.rate ?? row.weighted_funding_rate),
        weighted_funding_rate: number(row.weighted_funding_rate ?? row.rate),
        source: 'spectre-v1-derivatives-funding-rates',
      })).filter((row) => row.asset)
      const rateFor = (symbol) => {
        const row = rowForAsset(rows, symbol)
        return number(row?.rate ?? row?.weighted_funding_rate) * 100
      }
      return {
        btc: rateFor('BTC'),
        eth: rateFor('ETH'),
        sol: rateFor('SOL'),
        rows,
      }
    }
  } catch {
    // Fall back to open-interest/composite rows below.
  }

  const rows = await getDerivativeRows(undefined, { priceScope })
  const rateFor = (symbol) => {
    const row = rowForAsset(rows, symbol)
    return number(row?.rate ?? row?.weighted_funding_rate) * 100
  }
  return {
    btc: rateFor('BTC'),
    eth: rateFor('ETH'),
    sol: rateFor('SOL'),
    rows,
  }
}

export async function getSpectreOpenInterest({ priceScope = 'all' } = {}) {
  // Fetch directly so we can read the meta.total_oi_usd field (summed across
  // all 680+ assets server-side). getDerivativeRows() only returns the page
  // slice; the market-wide total isn't recoverable from those rows alone.
  let totalUsd = 0
  let totalAssets = 0
  try {
    const payload = await fetchV1Json('/derivatives/open-interest?limit=500', { ttl: TTL.derivatives })
    totalUsd = number(payload?.meta?.total_oi_usd)
    totalAssets = number(payload?.meta?.total_assets)
  } catch {
    // fall through — getDerivativeRows below has its own fallback chain
  }
  const rows = await getDerivativeRows(undefined, { priceScope })
  const unitOi = (symbol, fallbackPrice) => {
    const row = rowForAsset(rows, symbol)
    const oiUsd = number(row?.oi_usd ?? row?.total_oi_usd)
    const price = number(row?.price || fallbackPrice)
    return oiUsd && price ? oiUsd / price : oiUsd
  }
  const btc = rowForAsset(rows, 'BTC')
  const eth = rowForAsset(rows, 'ETH')
  // If meta wasn't returned (older API), fall back to summing the page rows.
  const fallbackTotal = rows.reduce((sum, r) => sum + number(r?.oi_usd || r?.total_oi_usd), 0)
  return {
    btc: unitOi('BTC', 75_000),
    eth: unitOi('ETH', 2_300),
    sol: unitOi('SOL', 85),
    btcUsd: number(btc?.oi_usd),
    ethUsd: number(eth?.oi_usd),
    totalUsd: totalUsd || fallbackTotal,
    totalAssets,
    rows,
  }
}

export async function getSpectreLongShortRatio({ priceScope = 'all' } = {}) {
  try {
    const payload = await fetchV1Json('/derivatives/long-short-ratio', { ttl: TTL.derivatives })
    const data = unwrapV1Data(payload)
    const rows = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : []
    const btc = rowForAsset(rows, 'BTC')
    const ratio = number(btc?.long_short_ratio ?? btc?.ratio ?? btc?.longShortRatio)
    if (ratio > 0) {
      const longsRaw = number(btc?.long_account ?? btc?.longAccount ?? btc?.longs ?? btc?.long_pct)
      const shortsRaw = number(btc?.short_account ?? btc?.shortAccount ?? btc?.shorts ?? btc?.short_pct)
      const longs = longsRaw > 1 ? longsRaw : longsRaw > 0 ? longsRaw * 100 : (ratio / (1 + ratio)) * 100
      const shorts = shortsRaw > 1 ? shortsRaw : shortsRaw > 0 ? shortsRaw * 100 : 100 - longs
      return { ratio, longs, shorts, rows }
    }
  } catch {
    // Fall back to open-interest/composite rows below.
  }

  const rows = await getDerivativeRows(['BTC'], { priceScope })
  const btc = rowForAsset(rows, 'BTC')
  const ratio = number(btc?.long_short_ratio)
  if (ratio > 0) {
    const longs = (ratio / (1 + ratio)) * 100
    return { ratio, longs, shorts: 100 - longs }
  }
  return { ratio: 1, longs: 50, shorts: 50 }
}

export async function getSpectreLiquidationWindows() {
  const payload = await fetchV1Json('/derivatives/liquidation-windows', { ttl: TTL.derivatives })
  return unwrapV1Data(payload)
}

/** Live multi-exchange liquidation EVENTS (newest first). */
export async function getSpectreLiquidationEvents(limit = 25) {
  const payload = await fetchV1Json(`/derivatives/liquidations?limit=${Math.max(1, Math.min(100, limit))}`, { ttl: 20_000 })
  const data = unwrapV1Data(payload)
  return Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : []
}

/**
 * Deep liquidation tape for the cinema stage (up to the endpoint's 500-row max).
 * Short TTL: the edge holds 15s, so poll ticks inside that window are cache hits
 * shared across every viewer.
 */
export async function getSpectreLiquidationTape(limit = 500) {
  const payload = await fetchV1Json(`/derivatives/liquidations?limit=${Math.max(1, Math.min(500, limit))}`, { ttl: 8_000 })
  const data = unwrapV1Data(payload)
  return Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : []
}

/**
 * Labeled whale / stablecoin transfer tape (Circle mint-burn cycles, tagged
 * exchange deposits). Rows: time, asset, from_label, to_label, amount,
 * amount_usd, tx_hash, chain, tx_type — labels are null for unknown wallets.
 */
export async function getSpectreWhaleTransactions(limit = 50) {
  const payload = await fetchV1Json(`/smart-money/whale-transactions?limit=${Math.max(1, Math.min(200, limit))}`, { ttl: 25_000 })
  const data = unwrapV1Data(payload)
  return Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : []
}

/**
 * Paper-trading book (the Agent Arena lane). The box serves numbers as STRINGS
 * on these routes — callers must Number() anything they chart. /leaderboard is
 * the ranked roster; /:id/equity is the 5-min snapshot series behind each curve.
 */
export async function getSpectrePaperLeaderboard() {
  const payload = await fetchV1Json('/paper-trading/leaderboard', { ttl: 60_000 })
  const data = unwrapV1Data(payload)
  return Array.isArray(data) ? data : []
}

export async function getSpectrePaperEquity(traderId) {
  if (traderId == null || traderId === '') return []
  const payload = await fetchV1Json(`/paper-trading/${encodeURIComponent(traderId)}/equity`, { ttl: 120_000 })
  const data = unwrapV1Data(payload)
  return Array.isArray(data) ? data : []
}

export async function getSpectrePaperTrader(traderId) {
  if (traderId == null || traderId === '') return null
  const payload = await fetchV1Json(`/paper-trading/${encodeURIComponent(traderId)}`, { ttl: 60_000 })
  const data = unwrapV1Data(payload)
  return data && typeof data === 'object' ? data : null
}

/**
 * CFTC Commitment of Traders for the CME BTC/ETH futures contracts — weekly,
 * so a long TTL. Rows are newest-first per asset and carry the split we care
 * about: non-commercial (speculators) vs commercial (hedgers).
 */
export async function getSpectreCmeCot() {
  const payload = await fetchV1Json('/derivatives/cme/cot', { ttl: 30 * 60_000 })
  const data = unwrapV1Data(payload)
  return Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : []
}

function derivativeRowsFromPayload(payload) {
  const data = unwrapV1Data(payload)
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.rows)) return data.rows
  if (Array.isArray(data?.assets)) return data.assets
  if (data && typeof data === 'object') {
    return Object.entries(data)
      .filter(([, value]) => value && typeof value === 'object')
      .map(([asset, value]) => ({ asset, ...value }))
  }
  return []
}

function ratioToUnit(value) {
  const n = number(value)
  if (n <= 0) return 0
  return n > 1 ? n / 100 : n
}

export async function getSpectreTakerPressure() {
  const payload = await fetchV1Json('/derivatives/taker-pressure', { ttl: TTL.derivatives })
  return derivativeRowsFromPayload(payload)
    .map((row = {}) => {
      const symbol = assetSymbol(row.asset || row.symbol || row.market || row.pair)
      if (!symbol) return null
      const explicitBuy = ratioToUnit(row.buy_ratio ?? row.buyRatio ?? row.taker_buy_ratio ?? row.buy_pct ?? row.buy_percent)
      const explicitSell = ratioToUnit(row.sell_ratio ?? row.sellRatio ?? row.taker_sell_ratio ?? row.sell_pct ?? row.sell_percent)
      const buySellRatio = number(row.buy_sell_ratio ?? row.buySellRatio ?? row.taker_buy_sell_ratio ?? row.ratio)
      // 🪤 This used to fall back to a flat 0.5 when the upstream carried no
      // measurement. The endpoint currently returns taker_buy_sell_ratio:null
      // for EVERY asset, so the panel painted "50.0% · Neutral" down the whole
      // column as if it had been measured. No measurement → no row, so the
      // caller can fall through to a source that actually has one.
      if (!(explicitBuy > 0) && !(explicitSell > 0) && !(buySellRatio > 0)) return null
      const buyRatio = explicitBuy || (buySellRatio > 0 ? buySellRatio / (1 + buySellRatio) : 1 - explicitSell)
      const sellRatio = explicitSell || Math.max(0, 1 - buyRatio)
      return {
        symbol,
        buyRatio,
        sellRatio,
        buySellRatio: buySellRatio || (sellRatio > 0 ? buyRatio / sellRatio : 1),
        history: Array.isArray(row.history) ? row.history.map(number) : undefined,
        source: 'spectre-v1-derivatives-taker-pressure',
      }
    })
    .filter(Boolean)
}

export async function getSpectreFuturesBasis() {
  const payload = await fetchV1Json('/derivatives/futures-basis', { ttl: TTL.derivatives })
  return derivativeRowsFromPayload(payload)
    .map((row = {}) => {
      const symbol = assetSymbol(row.asset || row.symbol || row.market || row.pair)
      if (!symbol) return null
      return {
        symbol,
        spotPrice: number(row.spot_price ?? row.spotPrice ?? row.index_price ?? row.indexPrice),
        markPrice: number(row.mark_price ?? row.markPrice ?? row.futures_price ?? row.futuresPrice),
        basis: number(row.basis_pct ?? row.basisPct ?? row.basis ?? row.premium_pct ?? row.premiumPct),
        annualized: number(row.annualized_pct ?? row.annualizedPct ?? row.annualized ?? row.annualized_basis_pct),
        nextFunding: row.next_funding_time ?? row.nextFundingTime ?? row.nextFunding ?? null,
        source: 'spectre-v1-derivatives-futures-basis',
      }
    })
    .filter(Boolean)
}

// ─────────────────────────────────────────────────────────────────────────
// Intel bundle — single-flight wrapper.
//
// useMarketIntel fans out 7 calls (funding, OI, L/S, global, tickers,
// dominance, alt season) every 90s. Each is its own getSpectre*() with its
// own fetchV1Json + TTL; that's correct on a *page* basis but if another
// surface ever needs the same data within the same tick, we'd duplicate the
// upstream load. This wrapper guarantees: at most one parallel fetch per
// 30s window, regardless of how many consumers subscribe to it.
//
// Kept on the client by design. We considered a server-side bundle endpoint
// for production-scale cache sharing across users, but it requires
// duplicating ~150 LOC of transform logic on the server (each getSpectre*
// applies non-trivial reshapes around fallback chains). The single-flight
// wrapper hits the same goal for the current load profile and leaves the
// option open to move bundling to the server once concurrent-user counts
// warrant it: consumers only see `getSpectreIntelBundle()` and don't care
// whether the dedup lives on the client or the wire.
// ─────────────────────────────────────────────────────────────────────────

const INTEL_BUNDLE_TTL_MS = 30_000

// Tiny helper: cache + in-flight dedup for a single async producer.
function makeCachedFetcher(ttlMs, producer) {
  let cache = null
  let cachedAt = 0
  let inflight = null

  return async function () {
    if (cache && Date.now() - cachedAt < ttlMs) return cache
    if (inflight) return inflight
    inflight = (async () => {
      const data = await producer()
      cache = data
      cachedAt = Date.now()
      return data
    })().finally(() => { inflight = null })
    return inflight
  }
}

const pick = (r, fallback) => (r.status === 'fulfilled' ? r.value : fallback)

// Full bundle — funding/OI/long-short/tickers/global/dominance/altSeason/liquidations.
// Used by Brief, AI Market, Flows, Wallets tabs.
export const getSpectreIntelBundle = makeCachedFetcher(INTEL_BUNDLE_TTL_MS, async () => {
  // priceScope 'majors': the bundle consumers (Brief/AI Market/Flows panels,
  // useMarketIntel) read row.price only for BTC/ETH/SOL unit conversion, so
  // the full 500-symbol /v1/prices enrichment (~220KB, 5 chunked requests)
  // is skipped here. traders-corner calls getSpectreOpenInterest() directly
  // with the default 'all' scope and keeps per-row prices for its heatmap.
  const r = await Promise.allSettled([
    getSpectreFundingRates({ priceScope: 'majors' }),
    getSpectreOpenInterest({ priceScope: 'majors' }),
    getSpectreLongShortRatio({ priceScope: 'majors' }),
    getSpectreGlobalMetrics(),
    getSpectreMarketTickers(80),
    getSpectreMarketDominance(),
    getSpectreAltSeason(),
    getSpectreLiquidationWindows(),
  ])
  return {
    fundingRates:    pick(r[0], { btc: 0, eth: 0, sol: 0, rows: [] }),
    openInterest:    pick(r[1], { btc: 0, eth: 0, sol: 0, rows: [] }),
    longShortRatio:  pick(r[2], { ratio: 1, longs: 50, shorts: 50 }),
    globalMetrics:   pick(r[3], null),
    tickers:         pick(r[4], { topGainers: [], topLosers: [], majorCoins: {}, totalPairs: 0 }),
    dominance:       pick(r[5], null),
    altSeason:       pick(r[6], null),
    liquidationWindows: pick(r[7], null),
  }
})

// Derivatives-only bundle — funding/OI/long-short for surfaces that render
// just those three numbers (RZ Technicals macro section). Skips tickers,
// global metrics, dominance, alt-season, liquidation windows AND the
// 500-symbol price enrichment of the full bundle.
export const getSpectreIntelDerivBundle = makeCachedFetcher(INTEL_BUNDLE_TTL_MS, async () => {
  const r = await Promise.allSettled([
    getSpectreFundingRates({ priceScope: 'majors' }),
    getSpectreOpenInterest({ priceScope: 'majors' }),
    getSpectreLongShortRatio({ priceScope: 'majors' }),
  ])
  return {
    fundingRates:   pick(r[0], { btc: 0, eth: 0, sol: 0, rows: [] }),
    openInterest:   pick(r[1], { btc: 0, eth: 0, sol: 0, rows: [] }),
    longShortRatio: pick(r[2], { ratio: 1, longs: 50, shorts: 50 }),
  }
})

// Slim bundle — only what the always-visible horizontal bar needs.
// Used on every tab that doesn't show derivatives.
export const getSpectreIntelSlimBundle = makeCachedFetcher(INTEL_BUNDLE_TTL_MS, async () => {
  const r = await Promise.allSettled([
    getSpectreGlobalMetrics(),
    getSpectreMarketDominance(),
    getSpectreAltSeason(),
  ])
  return {
    globalMetrics: pick(r[0], null),
    dominance:     pick(r[1], null),
    altSeason:     pick(r[2], null),
  }
})

export async function getSpectreMarketTickers(limit = 80) {
  const [markets, movers] = await Promise.all([
    getSpectreTopMarketsPage(1, Math.min(Math.max(20, Number(limit) || 80), 200)),
    getSpectreTokenMovers(20).catch(() => ({ gainers: [], losers: [] })),
  ])
  const majorCoins = {}
  for (const coin of markets) {
    const symbol = assetSymbol(coin.symbol)
    if (['BTC', 'ETH', 'SOL', 'BNB', 'XRP'].includes(symbol)) {
      majorCoins[symbol.toLowerCase()] = {
        symbol,
        price: number(coin.current_price),
        change: number(coin.price_change_percentage_24h),
        volume: number(coin.total_volume),
      }
    }
  }
  const toTicker = (coin = {}) => ({
    symbol: assetSymbol(coin.symbol || coin.asset),
    price: number(coin.current_price ?? coin.price),
    change: number(coin.price_change_percentage_24h ?? coin.change),
    volume: number(coin.total_volume ?? coin.volume ?? coin.volume_24h),
  })
  return {
    topGainers: movers.gainers.length ? movers.gainers : markets.map(toTicker).filter((t) => t.change > 0).sort((a, b) => b.change - a.change).slice(0, 12),
    topLosers: movers.losers.length ? movers.losers : markets.map(toTicker).filter((t) => t.change < 0).sort((a, b) => a.change - b.change).slice(0, 12),
    majorCoins,
    totalPairs: markets.length,
  }
}

export async function getSpectreMarketTrending(limit = 20) {
  // 2026-05-08 audit: /v1/market/trending was returning {coins:[]} (empty stub).
  // Use /v1/discovery/hot which has real data and richer fields (volume_change_pct,
  // volume_24h, social signals on some rows). Falls through to /v1/coins/markets
  // (CG-shape, by mcap) if discovery/hot ever fails. /v1/market/trending stays
  // available as the deepest fallback once Hetzner side starts populating it.
  const safeLimit = Math.max(1, Number(limit) || 20)
  // Primary: discovery/hot (verified populated)
  try {
    const payload = await fetchV1Json(`/discovery/hot?limit=${safeLimit}`, { ttl: TTL.list })
    const rows = Array.isArray(payload?.data) ? payload.data : (payload?.data?.coins || [])
    if (Array.isArray(rows) && rows.length > 0) return rows
  } catch (_) { /* fall through */ }
  // Fallback: /v1/coins/markets paginated (CG-shape, top tokens by mcap)
  try {
    const payload = await fetchV1Json(`/coins/markets?vs_currency=usd&per_page=${safeLimit}&page=1&sparkline=true`, { ttl: TTL.list })
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.data)) return payload.data
  } catch (_) { /* fall through */ }
  // Deepest fallback: legacy market/trending (kept for once Hetzner backfills it)
  try {
    const payload = await fetchV1Json(`/market/trending?limit=${safeLimit}`, { ttl: TTL.list })
    if (Array.isArray(payload?.data)) return payload.data
    if (Array.isArray(payload?.data?.coins)) return payload.data.coins
  } catch (_) { /* fall through */ }
  return []
}

// 2026-05-08: tiered trending feed for Discovery panel pills.
// Returns CG-shape rows directly from /v1/discovery/trending-tiered. The
// existing useTrendingTokens formatter understands this shape natively.
// Tiers: 'majors' | 'sub500m' | 'sub50m' | 'social' | 'onchain'
export async function getSpectreMarketTrendingTiered(tier = 'majors', limit = 20) {
  const safeLimit = Math.max(1, Number(limit) || 20)
  const safeTier = String(tier || 'majors').toLowerCase()
  try {
    const payload = await fetchV1Json(
      `/discovery/trending-tiered?tier=${encodeURIComponent(safeTier)}&limit=${safeLimit}`,
      { ttl: TTL.list }
    )
    if (Array.isArray(payload?.data)) return payload.data
  } catch (_) { /* fall through to non-tiered fallback */ }
  // Fallback: legacy aggregated trending so the panel never goes empty.
  return getSpectreMarketTrending(safeLimit)
}

function socialFeedSlug(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const symbol = assetSymbol(raw)
  return SYMBOL_TO_COINGECKO_ID[symbol] || raw.toLowerCase()
}

function pickSearchCoin(query, coins = []) {
  if (!Array.isArray(coins) || coins.length === 0) return null
  const raw = String(query || '').trim()
  const symbol = assetSymbol(raw)
  const lowered = raw.toLowerCase()
  const looksLikeTicker = raw === symbol && raw === raw.toUpperCase() && !raw.includes('-')

  if (!looksLikeTicker) {
    const exactByCgId = coins.find((coin) => String(coin.coingecko_id || coin.id || '').toLowerCase() === lowered)
    if (exactByCgId) return exactByCgId

    // Slug-normalized name match (2026-08-25): RZ slugs are CG ids, i.e.
    // usually the SLUGIFIED coin name — 'world-liberty-financial' can never
    // equal the raw name "World Liberty Financial", so multi-word slugs whose
    // box row lacks coingecko_id fell through to the blind coins[0] pick
    // (wrong-coin risk, the clone class). Compare slug-to-slug instead.
    const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const exactByName = coins.find((coin) => slugify(coin.name) === slugify(lowered))
    if (exactByName) return exactByName
  }

  const exactBySymbol = coins
    .filter((coin) => assetSymbol(coin.symbol) === symbol)
    .sort((a, b) => {
      const aRank = Number.isFinite(Number(a.rank ?? a.market_cap_rank)) ? Number(a.rank ?? a.market_cap_rank) : Number.MAX_SAFE_INTEGER
      const bRank = Number.isFinite(Number(b.rank ?? b.market_cap_rank)) ? Number(b.rank ?? b.market_cap_rank) : Number.MAX_SAFE_INTEGER
      return aRank - bRank
    })
  if (exactBySymbol.length > 0) return exactBySymbol[0]

  if (looksLikeTicker) {
    const exactByCgId = coins.find((coin) => String(coin.coingecko_id || coin.id || '').toLowerCase() === lowered)
    if (exactByCgId) return exactByCgId

    const exactByName = coins.find((coin) => String(coin.name || '').toLowerCase() === lowered)
    if (exactByName) return exactByName
  }

  return coins[0]
}

// CG platform slug → Codex network id now lives in ONE shared module — the
// inline copy here was one of five divergent maps, all missing chains the app
// lists (HyperEVM/Sui/Sonic → chartless identities, the "M"/HYPE class).
// Imported for local use + re-exported so existing
// `from '@/services/spectreMarketApi'` importers keep working.
import { contractFromPlatforms } from '@/lib/cg-platforms'
export { contractFromPlatforms }

export async function getSpectreTokenResolve(query) {
  const raw = String(query || '').trim()
  if (!raw) return null

  // /v1/search has coverage holes (audit 2026-06-10: messier/M87, rank 1853,
  // missing entirely). Research Zone URL slugs ARE CoinGecko ids, so we probe
  // /v1/coins/{slug} IN PARALLEL with search — the CG-shape profile carries
  // id/symbol/name/image/rank/platforms, a full identity in one call, and it
  // doubles as the platforms source below (killing a third serial hop).
  // Before 2026-06-10 these ran serially and the resolve chain alone cost
  // ~6s of the first-paint waterfall.
  const lowered = raw.toLowerCase()
  const slugShaped = /^[a-z0-9][a-z0-9-]{1,63}$/.test(lowered) && !/^0x[0-9a-f]{40}$/.test(lowered)
  const [searchRes, probeRes] = await Promise.allSettled([
    getSpectreSearch(raw, 8),
    slugShaped
      ? fetchV1Json(`/coins/${encodeURIComponent(lowered)}`, { ttl: TTL.profile })
      : Promise.resolve(null),
  ])
  const search = searchRes.status === 'fulfilled' ? searchRes.value : null
  const probed = probeRes.status === 'fulfilled' && probeRes.value?.id ? probeRes.value : null

  const match = pickSearchCoin(raw, search?.coins)
  let symbol = assetSymbol(match?.symbol || probed?.symbol || raw)
  let cgId = match?.coingecko_id || match?.id || SYMBOL_TO_COINGECKO_ID[symbol] || probed?.id || null
  // The probe profile is reusable whenever it describes the same coin the
  // search picked (or search missed entirely).
  let profile = probed && (!cgId || probed.id === cgId) ? probed : null

  const binancePair = binancePairFor(symbol)

  // Charts are address-keyed for every non-CEX token (candle store, GT and
  // Codex tiers all want address+networkId). /v1/search carries no contract
  // data, but /v1/coins/{id} exposes CG `platforms` — one cached profile
  // fetch makes the identity chart-ready for EVERY CG-listed token. Audit
  // 2026-06-10: hardcoded address:null here routed all non-major tokens to
  // the plain-symbol bars path (degenerate/empty charts). Skipped when the
  // token has a real Binance pair — that tier needs no address.
  let contract = null
  if (cgId && !binancePair) {
    try {
      if (!profile) profile = await fetchV1Json(`/coins/${encodeURIComponent(cgId)}`, { ttl: TTL.profile })
      contract = contractFromPlatforms(profile)
    } catch (_) { /* identity stays symbol-only; resolveToken falls back */ }
    // Box profiles routinely ship `platforms: {}` even when CoinGecko itself
    // holds the verified contract (the data-lane identity gap — memecore/"M",
    // most of the long tail). A chartless identity means NO Candles and no
    // self-hosted TradingView at all, so ask CG directly (same-origin
    // /api/coingecko proxy, edge-cached in prod) before giving up. CG's
    // platform record is the ratified contract authority — never a
    // ticker-keyed guess.
    if (!contract) {
      try {
        // HARD TIMEOUT (2026-08-26): browser fetch has NO default one, and the
        // Research Zone chart now HOLDS ITS SHIMMER while this resolve is in
        // flight (identityPending) — a hung proxy would mean a permanently
        // blank chart instead of a merely chartless one. 6s is well past the
        // edge-cached p99 and well under the hook's own resolve deadline.
        const res = await fetch(
          `/api/coingecko/coins/${encodeURIComponent(cgId)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`,
          { signal: AbortSignal.timeout(6000) },
        )
        if (res.ok) contract = contractFromPlatforms(await res.json())
      } catch (_) { /* chartless identity; downstream falls back honestly */ }
    }
  }

  return {
    symbol,
    name: match?.name || profile?.name || symbol,
    cgId,
    // Validate against the real Binance USDT catalog. Fabricating
    // `${symbol}USDT` here poisoned EVERY non-major DEX token with a bogus
    // pair, which forced trading-chart.jsx into the DexScreener iframe
    // instead of TradingView (audit 2026-06-10).
    binancePair,
    address: contract?.address || null,
    networkId: contract?.networkId || null,
    logo: match?.image || profile?.image?.small || profile?.image?.large || null,
    rank: match?.rank ?? match?.market_cap_rank ?? profile?.market_cap_rank ?? null,
    categories: null,
  }
}

export async function getSpectrePriceHistory(symbol, { days = 30 } = {}) {
  const asset = assetSymbol(symbol)
  if (!asset) return []
  const qs = new URLSearchParams({ days: String(Math.max(1, Number(days) || 30)) })
  const payload = await fetchV1Json(`/price-history/${encodeURIComponent(asset)}/history?${qs}`, { ttl: TTL.chart })
  const rows = Array.isArray(payload?.data) ? payload.data : []
  return rows.map((row = {}) => ({
    time: row.time || row.timestamp || row.date || null,
    price: number(row.price ?? row.close ?? row.value),
    marketCap: number(row.market_cap ?? row.marketCap),
    volume: number(row.volume ?? row.volume_24h ?? row.volume24h),
  }))
}

export async function getSpectreSparkline(symbol, { days = 7 } = {}) {
  const asset = assetSymbol(symbol)
  if (!asset) return []
  const qs = new URLSearchParams({ days: String(Math.max(1, Number(days) || 7)) })
  const payload = await fetchV1Json(`/price-history/${encodeURIComponent(asset)}/sparkline?${qs}`, { ttl: TTL.chart })
  return (Array.isArray(payload?.data) ? payload.data : []).map(number).filter((value) => value > 0)
}

function annotateSocialPayload(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : []
  if (rows.length > 0) return payload
  return {
    ...(payload || {}),
    data: rows,
    meta: {
      ...(payload?.meta || {}),
      degraded: payload?.meta?.degraded ?? true,
      upstream_empty: payload?.meta?.upstream_empty ?? true,
      source_status: payload?.meta?.source_status || 'empty_not_authoritative',
      frontend_note: 'Empty social 200 is not proof absence; keep fallback proof sources.',
    },
  }
}

export async function getSpectreSocialFeed(symbol, { limit = 20, minFollowers = 0 } = {}) {
  const asset = socialFeedSlug(symbol)
  if (!asset) return { data: [] }
  const qs = new URLSearchParams({
    limit: String(Math.max(1, Number(limit) || 20)),
    min_followers: String(Math.max(0, Number(minFollowers) || 0)),
  })
  return annotateSocialPayload(
    await fetchV1Json(`/social/feed/${encodeURIComponent(asset)}?${qs}`, { ttl: TTL.sentiment })
  )
}

export async function getSpectreSocialSearch(query, { limit = 20, minFollowers = 0 } = {}) {
  const q = String(query || '').trim()
  if (!q) return { data: [] }
  const qs = new URLSearchParams({
    q,
    limit: String(Math.max(1, Number(limit) || 20)),
    min_followers: String(Math.max(0, Number(minFollowers) || 0)),
  })
  return annotateSocialPayload(
    await fetchV1Json(`/social/search?${qs}`, { ttl: TTL.sentiment })
  )
}

export async function getSpectreTokenCommunity(symbol) {
  const asset = assetSymbol(symbol)
  if (!asset) return null
  const payload = await fetchV1Json(`/community/${encodeURIComponent(asset)}`, { ttl: TTL.categories })
  return payload?.data || null
}

export async function getSpectreCategoryAssets(slug, { limit = 25, offset = 0 } = {}) {
  const category = String(slug || '').trim()
  if (!category) return { data: [], pagination: { total: 0, limit, offset, has_more: false } }
  const qs = new URLSearchParams({
    limit: String(Math.max(1, Number(limit) || 25)),
    offset: String(Math.max(0, Number(offset) || 0)),
  })
  return fetchV1Json(`/categories/${encodeURIComponent(category)}/assets?${qs}`, { ttl: TTL.categories })
}

// Live CG override — guarantees fresh price/mcap/volume for CG-listed tokens
// when the Spectre Data API is serving stale cache. Observed in the wild:
// /data-api/v1/prices for SPECTRE returned a 1-month-old snapshot ($0.3267)
// while CG had the live $0.3662; the right-sidebar mcap, watchlist, and
// research-zone all read from the stale path. CG `/coins/markets` is the
// canonical, sub-minute source.
//
// Cache + in-flight dedup: `getSpectreTokenProfile` calls this twice per
// invocation (once for the bootstrap profile, once for the fresh bridge),
// and it's itself called several times per Research Zone token nav by the
// price priority chain. Without dedup, we saw 9+ raw api.coingecko.com hits
// per page load — a public-CG rate-limit hazard. 30s TTL matches the rest
// of the price/cache surface.
const _cgOverrideCache = new Map()      // cgId -> { data, ts }
const _cgOverrideInflight = new Map()   // cgId -> Promise<data|null>
const _CG_OVERRIDE_TTL = 30_000

async function fetchCgMarketOverride(cgId) {
  if (!cgId) return null
  const entry = _cgOverrideCache.get(cgId)
  if (entry && Date.now() - entry.ts < _CG_OVERRIDE_TTL) return entry.data
  if (_cgOverrideInflight.has(cgId)) return _cgOverrideInflight.get(cgId)
  const promise = (async () => {
    try {
      const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(cgId)}&price_change_percentage=1h,24h,7d&sparkline=false`
      const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) })
      if (!r.ok) return null
      const arr = await r.json()
      return Array.isArray(arr) && arr[0] ? arr[0] : null
    } catch {
      return null
    }
  })().then((data) => {
    _cgOverrideCache.set(cgId, { data, ts: Date.now() })
    _cgOverrideInflight.delete(cgId)
    return data
  })
  _cgOverrideInflight.set(cgId, promise)
  return promise
}

function applyCgOverride(priceProfile, cg) {
  if (!priceProfile || !cg) return priceProfile
  const next = { ...priceProfile }
  next.price = { ...(priceProfile.price || {}) }
  next.market = { ...(priceProfile.market || {}) }
  if (cg.current_price != null) next.price.usd = cg.current_price
  if (cg.price_change_percentage_1h_in_currency != null) next.price.change_1h = cg.price_change_percentage_1h_in_currency
  if (cg.price_change_percentage_24h != null) next.price.change_24h = cg.price_change_percentage_24h
  if (cg.price_change_percentage_7d_in_currency != null) next.price.change_7d = cg.price_change_percentage_7d_in_currency
  if (cg.high_24h != null) next.price.high_24h = cg.high_24h
  if (cg.low_24h != null) next.price.low_24h = cg.low_24h
  if (cg.market_cap != null) next.market.market_cap = cg.market_cap
  if (cg.fully_diluted_valuation != null) next.market.fully_diluted_valuation = cg.fully_diluted_valuation
  if (cg.total_volume != null) next.market.volume_24h = cg.total_volume
  if (next.market.market_cap && next.market.volume_24h) {
    next.market.volume_to_mcap_pct = ((next.market.volume_24h / next.market.market_cap) * 100).toFixed(2)
  }
  next._source = (priceProfile._source || '') + '+cg-live'
  return next
}

const _tokenProfileInflight = new Map()
/**
 * Dedup concurrent profile builds for the same symbol. useTokenProfile and
 * useMarketScenario both call this for the current token, so without dedup a
 * token shown on both surfaces doubled the upstream fan-out. In-flight only
 * (no extra TTL) — the underlying price/markets calls keep their own caches.
 */
export function getSpectreTokenProfile(symbol) {
  const key = String(assetSymbol(symbol) || symbol || '').toUpperCase()
  if (!key) return _getSpectreTokenProfileImpl(symbol)
  const existing = _tokenProfileInflight.get(key)
  if (existing) return existing
  const p = _getSpectreTokenProfileImpl(symbol).finally(() => _tokenProfileInflight.delete(key))
  _tokenProfileInflight.set(key, p)
  return p
}

async function _getSpectreTokenProfileImpl(symbol) {
  const asset = assetSymbol(symbol)
  if (!asset) return null
  const localViteDev = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)

  let priceProfile = null
  try {
    const prices = await getSpectrePricesBySymbols([asset])
    const row = prices?.[asset]
    if (row?.price > 0) {
      const marketCap = row.marketCap || null
      const volume = row.volume || null
      priceProfile = {
        symbol: asset,
        name: row.name || asset,
        image: row.image || row.logo || COINGECKO_LOGOS[asset] || null,
        image_small: row.image || row.logo || COINGECKO_LOGOS[asset] || null,
        rank: row.rank ?? null,
        coingecko_id: row.coingeckoId || SYMBOL_TO_COINGECKO_ID[asset] || null,
        description: null,
        links: {},
        categories: [],
        price: {
          usd: row.price,
          change_1h: row.change1h ?? null,
          change_24h: row.change24 ?? row.change ?? null,
          change_7d: row.change7d ?? null,
          change_30d: row.change30d ?? null,
          change_1y: row.change1y ?? null,
          high_24h: row.high24h || null,
          low_24h: row.low24h || null,
          ath: row.ath,
          atl: row.atl,
        },
        market: {
          market_cap: marketCap,
          fully_diluted_valuation: row.fdv || null,
          volume_24h: volume,
          volume_to_mcap_pct: marketCap && volume ? ((volume / marketCap) * 100).toFixed(2) : null,
        },
        supply: {
          circulating: row.circulatingSupply || null,
          total: row.totalSupply || null,
          max: row.maxSupply || null,
        },
        scores: row.scores || {},
        technicals: row.technicals || {},
        derivatives: row.derivatives || {},
        social: row.social || row.community || {},
        on_chain: {
          primary_contract: row.contract || null,
          primary_chain: row.chain || null,
        },
        _source: 'spectre-v1-prices',
      }
    }
  } catch {
    // Keep falling through to the profile bridge.
  }

  // Override with live CoinGecko data when cg_id is known. Guarantees fresh
  // price/mcap/volume even when the Spectre /v1/prices cache is stale.
  if (priceProfile?.coingecko_id) {
    const cg = await fetchCgMarketOverride(priceProfile.coingecko_id)
    if (cg) priceProfile = applyCgOverride(priceProfile, cg)
  }

  // In local Vite dev, /spectre-market-api/token/:asset/profile is the deployed
  // API profile bridge and can reject browser-like local traffic. The cached
  // /data-api/v1/prices profile is enough for local cards/charts and avoids
  // false 403s while preserving the richer production path below.
  if (localViteDev && priceProfile) return priceProfile

  try {
    const payload = await fetchJson(`/token/${encodeURIComponent(asset)}/profile`, { ttl: TTL.profile })
    const bridge = payload?.data
    if (!bridge) return priceProfile
    // The deployed bridge can also serve stale cached data; apply the same CG
    // override so the consumer never sees a price older than CG's index.
    const cgId = bridge.coingecko_id || priceProfile?.coingecko_id || SYMBOL_TO_COINGECKO_ID[asset]
    if (cgId) {
      const cg = await fetchCgMarketOverride(cgId)
      if (cg) return applyCgOverride(bridge, cg)
    }
    return bridge
  } catch {
    return priceProfile
  }
}

export async function getSpectreTokenMarkets(symbol) {
  const profile = await getSpectreTokenProfile(symbol)
  const pairs = Array.isArray(profile?.trading?.pairs)
    ? profile.trading.pairs
    : Array.isArray(profile?.trading_pairs)
      ? profile.trading_pairs
      : []

  const rows = pairs
    .map((row = {}) => {
      const pair = row.pair || [row.base, row.quote || row.target].filter(Boolean).join('/')
      const rawType = String(row.market_type || row.type || row.market || 'spot').toLowerCase()
      const isDerivative =
        rawType.includes('derivative') ||
        rawType.includes('future') ||
        rawType.includes('perp') ||
        Boolean(row.is_derivative || row.isDerivative)
      const volume24h = number(row.volume_usd ?? row.volume_24h ?? row.volume24h ?? row.volume)
      const depthPlus2 = number(row.depth_plus_2 ?? row.depthPlus2 ?? row.cost_to_move_up_usd ?? row.plus_2_depth)
      const depthMinus2 = number(row.depth_minus_2 ?? row.depthMinus2 ?? row.cost_to_move_down_usd ?? row.minus_2_depth)
      return {
        exchange: row.exchange_name || row.exchange || 'Unknown',
        pair,
        base: row.base || assetSymbol(symbol),
        target: row.quote || row.target || '',
        price: number(row.base_price ?? row.price),
        volume24h,
        depthPlus2,
        depthMinus2,
        liquidity: number(row.liquidity_usd ?? row.liquidity ?? depthPlus2 + depthMinus2),
        spread: number(row.spread_pct ?? row.spread),
        type: rawType.includes('dex') ? 'dex' : 'cex',
        trustScore: row.trust_score || row.trustScore || null,
        isDerivative,
        derivativeType: isDerivative ? (rawType.includes('perp') ? 'perpetual' : 'futures') : null,
        tradeUrl: row.trade_url || row.tradeUrl || null,
        _source: 'spectre-market-profile',
      }
    })
    .filter((row) => row.exchange && row.pair)

  const totalVolume = rows.reduce((sum, row) => sum + number(row.volume24h), 0)
  return rows.map((row) => ({
    ...row,
    volumePct: totalVolume > 0 ? Math.round((number(row.volume24h) / totalVolume) * 1000) / 10 : 0,
  }))
}

function chartDaysFor(interval, limit) {
  const raw = String(interval || '1h').toLowerCase()
  const count = Math.max(1, Number(limit) || 500)
  if (raw.endsWith('m')) return Math.min(30, Math.max(7, Math.ceil(count / 24)))
  if (raw.endsWith('h')) {
    const hours = Number(raw.replace('h', '')) || 1
    return Math.min(365, Math.max(7, Math.ceil((count * hours) / 24)))
  }
  if (raw.endsWith('w')) return Math.min(365, Math.max(30, count * 7))
  return Math.min(365, Math.max(7, count))
}

function toChartRowsFromHistory(rows = []) {
  return rows
    .map((row = {}) => {
      const price = number(row.price ?? row.close ?? row.value)
      if (!price) return null
      // UNIX SECONDS, like every other chart lane in this file. This one used
      // to pass the raw ISO string straight through as `time` (and milliseconds
      // as `t`), so any consumer that formats `time` as a unix stamp printed
      // "Invalid Date" - measured 2026-08-20 on the LITE research chart for GME,
      // whose axis labels, scrub tooltip and change caption all read that. The
      // primary ohlcv lane 60 lines below already normalizes exactly this way
      // and its own comment says the shape is what downstream expects.
      const raw = row.time ?? row.timestamp ?? row.date ?? null
      // `timestamp` is numeric more often than not, and a number of SECONDS fed
      // to `new Date()` lands in 1970 - the same units bug this block exists to
      // fix, in reverse. Anything under 1e11 is seconds.
      const ms = typeof raw === 'number'
        ? (raw > 1e11 ? raw : raw * 1000)
        : (raw ? new Date(raw).getTime() : NaN)
      if (!Number.isFinite(ms)) return null
      const time = Math.floor(ms / 1000)
      return {
        time,
        t: time,
        // Short keys as well as long, matching the ohlcv lane - a consumer that
        // reads `o/h/l/c` for candles gets bodies instead of silently falling
        // back to a line.
        o: price,
        h: price,
        l: price,
        c: price,
        open: price,
        high: price,
        low: price,
        close: price,
        price,
        volume: number(row.volume ?? row.volume_24h ?? row.volume24h),
        marketCap: number(row.market_cap ?? row.marketCap),
        source: 'spectre-v1-price-history',
      }
    })
    .filter(Boolean)
}

function toScore10(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return n > 10 ? Math.max(0, Math.min(10, n / 10)) : Math.max(0, Math.min(10, n))
}

export async function getSpectreTokenChart(symbol, { interval = '1h', limit = 500 } = {}) {
  const asset = assetSymbol(symbol)
  if (!asset) return []

  // 2026-05-08 audit: /v1/prices/{symbol}/ohlcv has the broadest token coverage
  // (BTC, SPECTRE, BONK, PEPE, WIF, FARTCOIN, XRP, DOGE — all verified). Daily
  // /v1/price-history only covers top CG tokens. Try ohlcv first.
  //
  // SERVER PARAM NAMING: handler reads ?resolution= (NOT ?interval=) and ?limit=.
  // Older callers used ?interval= which the server silently ignores; now we use
  // both to keep both old and new server contracts happy.
  try {
    const qs = new URLSearchParams({ resolution: interval, interval, limit: String(Math.min(Math.max(1, Number(limit) || 500), 1000)) })
    const payload = await fetchV1Json(`/prices/${encodeURIComponent(asset)}/ohlcv?${qs}`, { ttl: TTL.chart })
    const data = Array.isArray(payload?.data) ? payload.data : []
    if (data.length > 0) {
      // Normalize to the chart-row shape downstream code expects.
      return data.map(b => {
        const t = typeof b.time === 'string' ? Math.floor(new Date(b.time).getTime() / 1000) : Number(b.time || b.t || 0)
        return {
          t,
          time: t,
          o: Number(b.open ?? b.o) || 0,
          h: Number(b.high ?? b.h) || 0,
          l: Number(b.low ?? b.l) || 0,
          c: Number(b.close ?? b.c) || 0,
          v: Number(b.volume ?? b.v) || 0,
          open: Number(b.open ?? b.o) || 0,
          high: Number(b.high ?? b.h) || 0,
          low: Number(b.low ?? b.l) || 0,
          close: Number(b.close ?? b.c) || 0,
          volume: Number(b.volume ?? b.v) || 0,
        }
      })
    }
  } catch (_) { /* fall through */ }

  // Fallback 1: daily price-history (top CG tokens, no per-bar OHLC granularity)
  try {
    const history = await getSpectrePriceHistory(asset, { days: chartDaysFor(interval, limit) })
    const rows = toChartRowsFromHistory(history).slice(-Math.max(1, Number(limit) || 500))
    if (rows.length) return rows
  } catch (_) { /* fall through */ }

  // Fallback 2: legacy bridge
  try {
    const qs = new URLSearchParams({ interval, limit: String(limit) })
    const payload = await fetchJson(`/token/${encodeURIComponent(asset)}/chart?${qs}`, { ttl: TTL.chart })
    return Array.isArray(payload?.data) ? payload.data : []
  } catch {
    return []
  }
}

export async function getSpectreTokenSocial(symbol) {
  const asset = assetSymbol(symbol)
  if (!asset) return null

  const [communityResult, sentimentResult, feedResult] = await Promise.allSettled([
    getSpectreTokenCommunity(asset),
    getSpectreTokenSentiment(asset),
    getSpectreSocialFeed(asset, { limit: 20 }),
  ])

  const community = communityResult.status === 'fulfilled' ? communityResult.value : null
  const sentiment = sentimentResult.status === 'fulfilled' ? sentimentResult.value : null
  const feed = feedResult.status === 'fulfilled' ? feedResult.value : null
  const current = community?.current || {}
  const posts = Array.isArray(feed?.data) ? feed.data : []

  if (community || sentiment || posts.length || feed?.status || feed?.reason) {
    return {
      asset,
      twitterFollowers: number(current.twitterFollowers ?? current.twitter_followers),
      redditSubscribers: number(current.redditSubscribers ?? current.reddit_subscribers),
      telegramMembers: number(current.telegramMembers ?? current.telegram_members),
      discordMembers: number(current.discordMembers ?? current.discord_members),
      githubContributors: number(current.githubContributors ?? current.github_contributors),
      communityHistory: Array.isArray(community?.history) ? community.history : [],
      sentimentScore: toScore10(sentiment?.score),
      weightedSentiment: toScore10(sentiment?.score),
      sentimentLabel: sentiment?.label || null,
      confidence: sentiment?.confidence ?? null,
      bullishPct: number(sentiment?.bullishPct),
      bearishPct: number(sentiment?.bearishPct),
      socialVolumeTotal: posts.length || null,
      posts,
      feedStatus: feed?.status || null,
      feedReason: feed?.reason || null,
      updatedAt: current.time || sentiment?.updatedAt || sentiment?.updated_at || null,
      source: 'spectre-v1-community-sentiment',
    }
  }

  try {
    const payload = await fetchJson(`/token/${encodeURIComponent(asset)}/social`, { ttl: TTL.sentiment })
    return payload?.data || null
  } catch {
    return null
  }
}

export async function getSpectreTokenSentiment(symbol) {
  const asset = assetSymbol(symbol)
  if (!asset) return null
  try {
    const payload = await fetchV1Json(`/sentiment/${encodeURIComponent(asset)}`, { ttl: TTL.sentiment })
    return payload?.data || null
  } catch {
    // Fall back to the old public bridge only when the v1 route is unavailable.
  }

  try {
    const payload = await fetchJson(`/token/${encodeURIComponent(asset)}/sentiment`, { ttl: TTL.sentiment })
    return payload?.data || null
  } catch {
    return null
  }
}

/**
 * Mindshare v2 — author-weighted, LLM-classified X sentiment for one asset.
 * Current row: sentiment_score_24h (-1..1), bull/neutral/bear pct, mindshare
 * pct + rank, unique authors, classifier mix. Keyed by UPPER symbol.
 */
export async function getSpectreMindshareCurrent(symbol) {
  const asset = assetSymbol(symbol)
  if (!asset) return null
  // Generous timeout + one retry: on a cold RZ load the browser queues these
  // behind the page's big /v1/prices batches (6-connection limit), and a tight
  // abort kills them while still queued.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // first attempt fails FAST (a hung/queued request must not stall the
      // hero for 25s — prod report: chart took 30s); the retry gets patience
      const payload = await fetchV1Json(`/social/mindshare/v2/${encodeURIComponent(asset)}`, { ttl: TTL.sentiment, timeoutMs: attempt === 0 ? 9_000 : 20_000 })
      return payload?.data || null
    } catch (err) {
      // 404 = asset genuinely uncovered; only congestion/timeouts earn a retry
      if (String(err?.message || '').includes('404')) return null
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200))
    }
  }
  return null
}

/**
 * Mindshare v2 history — 5-min snapshots of sentiment_score_24h, bull/bear pct,
 * weighted mentions and mindshare for one asset. hours <= 720 (30d).
 * Rows: { time, mindshare_pct_24h, rank_24h, sentiment_score_24h,
 *         weighted_mentions_24h, bull_pct, bear_pct }
 */
export async function getSpectreMindshareHistory(symbol, hours = 168) {
  const asset = assetSymbol(symbol)
  if (!asset) return []
  const safeHours = Math.min(Math.max(Number(hours) || 168, 1), 720)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const payload = await fetchV1Json(
        `/social/mindshare/v2/history/${encodeURIComponent(asset)}?hours=${safeHours}`,
        { ttl: 60_000, timeoutMs: attempt === 0 ? 9_000 : 20_000 }
      )
      return Array.isArray(payload?.data) ? payload.data : []
    } catch (err) {
      if (String(err?.message || '').includes('404')) return []
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200))
    }
  }
  return []
}

const _tokenTechnicalsInflight = new Map()
/** Dedup concurrent technicals fetches for the same symbol+interval (see
 *  getSpectreTokenProfile for the rationale). */
export function getSpectreTokenTechnicals(symbol, opts = {}) {
  const interval = opts.interval || '1h'
  const key = `${String(assetSymbol(symbol) || symbol || '').toUpperCase()}:${interval}`
  const existing = _tokenTechnicalsInflight.get(key)
  if (existing) return existing
  const p = _getSpectreTokenTechnicalsImpl(symbol, opts).finally(() => _tokenTechnicalsInflight.delete(key))
  _tokenTechnicalsInflight.set(key, p)
  return p
}

async function _getSpectreTokenTechnicalsImpl(symbol, { interval = '1h' } = {}) {
  const asset = assetSymbol(symbol)
  if (!asset) return null
  const qs = new URLSearchParams()
  if (interval) qs.set('interval', interval)

  try {
    const payload = await fetchV1Json(`/technicals/${encodeURIComponent(asset)}${qs.size ? `?${qs}` : ''}`, { ttl: TTL.chart })
    const data = payload?.data || null
    if (data) {
      const summary = data.summary || {}
      const total = number(summary.total_signals)
      const bullish = number(summary.bullish_signals)
      return {
        ...data,
        signal: summary.signal || data.signal || null,
        confidence: total ? Math.round((bullish / total) * 100) : null,
        source: 'spectre-v1-technicals',
      }
    }
  } catch {
    // Fall back to the legacy bridge below.
  }

  try {
    const payload = await fetchJson(`/token/${encodeURIComponent(asset)}/technicals${qs.size ? `?${qs}` : ''}`, { ttl: TTL.chart })
    return payload?.data || null
  } catch {
    return null
  }
}

// Sources that emit auto-generated chain/derivatives telemetry rather than
// editorial news. These monitors (mempool block-mined, funding-divergence,
// orderbook-anomaly, onchain-event) publish into /v1/news/breaking but their
// output is trade signals, not stories. Filter at the boundary so every
// consumer (AI Brief slide, newsroom banner, intel hub) stays editorial.
const NEWS_SOURCE_DENYLIST = new Set([
  'mempool',
  'blockchain',
  'funding-divergence',
  'funding_divergence',
  'orderbook-anomaly',
  'orderbook_anomaly',
  'onchain-event',
  'onchain_event',
  'derivatives-signal',
  'derivatives_signal',
  // SEC EDGAR boilerplate filings (8-K, 10-K, 13F, S-1 etc) - regulatory
  // noise, not editorial. They flood the Discover grid with identical
  // SEC-seal thumbnails ("8-K - B&G Foods", "8-K/A - B&G Foods",
  // "8-K - Energy Vault Holdings", ...). User-reported 2026-06-01.
  'sec edgar',
  'sec-edgar',
  'sec_edgar',
  'secedgar',
  'sec',
  'sec.gov',
  'www.sec.gov',
])

// Title patterns that mark a row as auto-generated telemetry even if the
// source_type is unset or unrecognized. Belt-and-braces — the monitor
// processes evolve faster than the denylist.
const TELEMETRY_TITLE_PATTERNS = [
  /\bfunding\s+divergence\b/i,
  /\borderbook\s+(imbalance|anomaly)\b/i,
  /\bblock\s+\d+\s+(mined|with\s+\d+\s+txs)\b/i,
  /\bmempool\b/i,
  /^[A-Z]{2,6}\s+funding[: ]/i,           // "DOT funding: Binance ..." / "BTC funding ..."
  /^[A-Z]{2,6}\s+orderbook[: ]/i,
  /Binance\s+-?\d+\.\d+%\s+vs\s+Bybit/i,  // funding-rate compare line
  // SEC EDGAR filing title shapes (defense in depth when source field
  // is mis-labeled): "8-K - Company Name (0001234567) (Filer)",
  // plain "10-K", "13F", "S-1", "6-K", "N-CSR", etc.
  /^\d+-K(?:\/A)?\s+-\s+.+\(\d{6,}\)/i,
  /^(10-K|10-Q|8-K|8-K\/A|S-1|S-4|13F|13G|13D|6-K|N-CSR|N-PX|DEF\s+14A|SC\s+13G)\b/i,
]

// A raw URL in a HEADLINE is the tell of a promo tweet, not editorial news
// (e.g. the Spectre marketing post "Crypto | Stocks | ETFs ... https://t.co/..."
// that leaked into the AI Brief). Editorial headlines never embed links.
const LINK_IN_TITLE_RE = /https?:\/\/|\b(?:t\.co|bit\.ly|buff\.ly|lnkd\.in|dlvr\.it)\//i
// Marketing / self-promo copy - matched against title + summary.
const PROMO_TEXT_PATTERNS = [
  /\beverything you need\b/i,
  // "one place" in ANY phrasing - the 2026-07-19 leak was Coinbase's "Everything
  // Exchange" ad ("people who want one place for: - Crypto - Equities - ...")
  // which dodged the old /\bin one place\b/ by one word.
  /\bone place\b/i,
  /\ball[\s-]?in[\s-]?one\b/i,
  /\blink in bio\b/i,
  /\b(?:sign up|follow us|available now|join (?:the|our|us|now)|download (?:the|our) app)\b/i,
  /crypto\s*\|\s*stocks/i,                 // "Crypto | Stocks | ETFs | ..." pipe-marketing
  /\bdear algorithm\b/i,                    // algo-bait opener - an ad by definition
  /\bshow this to (?:people|everyone|anyone|traders)\b/i, // engagement-bait formula
  /\beverything (?:exchange|app)\b/i,       // exchange campaign slogans (Coinbase et al)
]

function isEditorialNewsItem(raw) {
  // Check every plausible source field - upstream tags vary across feeds
  // (sourceDomain, source_type, sourceType, plain source). The plain
  // `source` field is what surfaces in the UI ("SEC EDGAR") and was
  // missing from the original check, which is why SEC filings leaked
  // through despite the denylist existing.
  const sd = String(raw?.sourceDomain || '').toLowerCase()
  const st = String(raw?.source_type || raw?.sourceType || '').toLowerCase()
  const s = String(raw?.source || '').toLowerCase()
  if (NEWS_SOURCE_DENYLIST.has(sd) || NEWS_SOURCE_DENYLIST.has(st) || NEWS_SOURCE_DENYLIST.has(s)) return false
  const title = String(raw?.title || raw?.headline || '')
  if (title && TELEMETRY_TITLE_PATTERNS.some((re) => re.test(title))) return false
  // Drop promotional / link-spam items (Spectre's own marketing tweets, "all
  // in one place" posts, anything with a raw link in the headline).
  if (title && LINK_IN_TITLE_RE.test(title)) return false
  const promoText = `${title} ${String(raw?.summary || raw?.description || raw?.body || '')}`
  if (PROMO_TEXT_PATTERNS.some((re) => re.test(promoText))) return false
  // Drop TradingView's auto-generated economic-calendar prints. In stocks mode
  // these macro events ("... Forecast was n/a. Previous -7. Source: TradingView.")
  // leak into the breaking feed and surface as a bare, contextless fragment in
  // the AI Brief alert slide. They are data points, not stories - the Calendar
  // tab is their home. Require the print template (Forecast/Previous/Actual)
  // AND the TradingView source so real editorial citing TradingView survives.
  if (/source:\s*tradingview/i.test(promoText) && /\b(forecast|previous|actual)\b/i.test(promoText)) return false
  return true
}

// ─── Brain Desk — the market-outlook narrative ──────────────────────────────
// The Brain generates a full desk read per cycle (zero marginal cost to read).
// We surface it as the text-first Market Outlook on the Market Summary tab.
// The prose can be uneven and field names drift across Brain versions, so this
// normalizer is defensive: it prefers the documented `simple.*` fields when the
// Brain emits them and falls back to the fields that are actually present today
// (`regime` sentence, `context.read`, `watching[]`, `scorecard.by_horizon`).
// Returns null on failure (caller treats as best-effort). NEVER surfaces raw
// nulls — every field is guarded to a string/number or omitted.

const REGIME_LABELS = [
  // [test regex, short chip label] — first match wins. Ordered specific→broad.
  [/risk[\s-]?on/i, 'Risk-on'],
  [/risk[\s-]?off/i, 'Risk-off'],
  [/resilien|v-?recover|reclaim|absorb/i, 'Resilient'],
  [/trend|breakout|momentum|impuls|expansion/i, 'Trending'],
  [/chop|range|rang(e|ing)|sideways|indecis|mixed|neutral/i, 'Chop'],
  [/flush|dump|capitulat|risk[\s-]?off|bear|downtrend|distribut/i, 'Risk-off'],
  [/euphor|greed|blow[\s-]?off|parabolic/i, 'Euphoria'],
]

function deriveRegimeChip(raw) {
  const src = String(raw?.simple?.regime || raw?.regime || raw?.context?.read || '').trim()
  if (!src) return null
  // If the Brain already gave a short regime tag (e.g. "risk_on", "chop"),
  // clean the separators and Title-Case it. Only treat it as a tag when it's
  // short and not a full sentence (≤ 2 words after normalizing _/-).
  const tag = src.replace(/[_-]+/g, ' ').trim()
  if (tag.length <= 18 && tag.split(/\s+/).length <= 2) {
    return tag.replace(/\b\w/g, (c) => c.toUpperCase())
  }
  for (const [re, label] of REGIME_LABELS) {
    if (re.test(src)) return label
  }
  return null
}

function firstSentence(str, maxLen = 160) {
  const s = String(str || '').trim()
  if (!s) return ''
  const cut = s.split(/(?<=[.!?])\s/)[0] || s
  return cut.length > maxLen ? `${cut.slice(0, maxLen - 1).trimEnd()}…` : cut
}

function deriveOutlookTitle(raw) {
  // Prefer an explicit headline; otherwise craft a tight one from the regime
  // sentence / context read. Never longer than a headline should be.
  const explicit = String(raw?.simple?.headline || raw?.headline || '').trim()
  if (explicit) return explicit
  const fromContext = firstSentence(raw?.context?.read, 110)
  if (fromContext) return fromContext
  const fromRegime = firstSentence(raw?.regime, 110)
  return fromRegime || 'Market Outlook'
}

function cleanBriefLine(line) {
  const s = decodeHtmlEntities(String(line || '')).trim()
  if (!s) return ''
  // Drop lines that are obviously broken prose (dangling connectors, raw nulls).
  if (/\bnull\b/i.test(s) || /^(and|but|with|the)\b.{0,3}$/i.test(s)) return ''
  if (s.length < 12) return ''
  return s
}

function normalizePulseLeg(leg) {
  if (!leg || typeof leg !== 'object') return null
  const px = Number(leg.px ?? leg.price)
  if (!Number.isFinite(px) || px <= 0) return null
  const chg = Number(leg.chg_24h_pct ?? leg.change_24h_pct ?? leg.chg_24h)
  return {
    px,
    chg24h: Number.isFinite(chg) ? chg : null,
  }
}

export async function getBrainDesk() {
  let raw
  try {
    const payload = await fetchV1Json('/brain/desk', { ttl: TTL.intelligence })
    raw = payload?.data && typeof payload.data === 'object' ? payload.data : payload
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null

  const brief = (Array.isArray(raw.brief) ? raw.brief : [])
    .map(cleanBriefLine)
    .filter(Boolean)
    .slice(0, 3)

  // Levels strip: only include a leg if it has a real, positive price.
  const pulse = raw.market_pulse && typeof raw.market_pulse === 'object' ? raw.market_pulse : {}
  const levels = ['BTC', 'ETH', 'SOL']
    .map((sym) => {
      const leg = normalizePulseLeg(pulse[sym])
      return leg ? { symbol: sym, ...leg } : null
    })
    .filter(Boolean)

  // "What the desk is watching": prefer an explicit desk line, else the first
  // watching trigger, else the top conviction rationale.
  const conv = Array.isArray(raw.convergence) ? raw.convergence[0] : null
  const watchingArr = Array.isArray(raw.watching) ? raw.watching.filter((w) => String(w || '').trim()) : []
  const watching =
    firstSentence(raw?.simple?.what_id_do, 150) ||
    (watchingArr[0] ? decodeHtmlEntities(String(watchingArr[0])).trim() : '') ||
    firstSentence(conv?.why, 150) ||
    ''

  const conviction = conv && String(conv.asset || '').trim() && String(conv.why || '').trim()
    ? { asset: String(conv.asset).trim().toUpperCase(), why: firstSentence(conv.why, 170) }
    : null

  // Brain signals: the full convergence set (concrete conviction plays), not just
  // the top one — asset + rationale + which lenses agreed + safety flag.
  const signals = (Array.isArray(raw.convergence) ? raw.convergence : [])
    .filter((c) => c && String(c.asset || '').trim() && String(c.why || '').trim())
    .slice(0, 4)
    .map((c) => ({
      asset: String(c.asset).trim().toUpperCase(),
      why: firstSentence(c.why, 128),
      lenses: Array.isArray(c.lenses) ? c.lenses.filter(Boolean).slice(0, 3) : [],
      horizon: String(c.horizon || '').trim() || null,
      safety: String(c.safety || '').trim().toLowerCase() || null,
    }))

  // Honest hit-rate footnote (never the headline). Prefer an explicit caution
  // string; else derive from the graded scorecard.
  let caution = firstSentence(raw?.simple?.caution, 140)
  if (!caution) {
    const byH = raw?.scorecard?.by_horizon || {}
    const graded = ['4h', '24h', '7d']
      .map((h) => ({ h, ...(byH[h] || {}) }))
      .find((r) => Number(r.n) > 0 && Number.isFinite(Number(r.hit_rate_pct)))
    if (graded) {
      caution = `Directional reads have been correct about ${Number(graded.hit_rate_pct).toFixed(0)}% of the time (${graded.h} horizon, ${graded.n} graded).`
    }
  }

  const title = deriveOutlookTitle(raw)
  const regime = deriveRegimeChip(raw)

  // Guard: if we have neither prose nor levels, there's nothing to show.
  if (!brief.length && !levels.length && !title) return null

  return {
    title: title || 'Market Outlook',
    regime,
    brief,
    levels,
    watching,
    conviction,
    signals,
    caution,
    asOf: pulse.as_of || raw.generatedAt || raw.generated_at || null,
  }
}

// Macro market outlook (Fed/rates, politics, geopolitics, cross-asset) — the
// server LLM-synthesises today's world/market headlines into a sharp brief. This
// is deliberately NOT the crypto desk (no token-picking); it powers the thesis.
export async function getMarketOutlook() {
  try {
    const res = await fetch('/api/brief/market-outlook', { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || !d.hasOutlook || !Array.isArray(d.sentences) || !d.sentences.length) return null;
    const regime = d.regime
      ? String(d.regime).split(/[-\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
      : null;
    return {
      title: String(d.title || 'Market Outlook').trim(),
      sentences: d.sentences.map((s) => String(s || '').trim()).filter(Boolean),
      regime,
      generatedAt: d.generatedAt || null,
    };
  } catch { return null; }
}

// Diverse market-news board (crypto + stocks + commodities + macro) for the
// Market Summary tab. Server-side categorized RSS aggregation — see the Express
// route GET /api/brief/market-news. Each item is { id, title, source, category,
// url, publishedAt }. Returns [] on failure (best-effort, caller keeps last-good).
export async function getMarketNews({ limit = 20 } = {}) {
  try {
    const res = await fetch(`/api/brief/market-news?limit=${Math.min(Math.max(Number(limit) || 20, 6), 30)}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];
    const d = await res.json();
    if (!d || !d.hasNews || !Array.isArray(d.items)) return [];
    return d.items
      .map((it, i) => {
        const title = String(it?.title || '').trim();
        if (!title) return null;
        const category = ['crypto', 'stocks', 'commodities', 'macro'].includes(it?.category) ? it.category : 'macro';
        return {
          id: String(it?.id || `mn-${i}`),
          title,
          source: String(it?.source || 'RSS').trim(),
          category,
          url: it?.url || '#',
          publishedAt: it?.publishedAt || null,
        };
      })
      .filter(Boolean);
  } catch { return []; }
}

export async function getSpectreNews({ symbol = '', name = '', limit = 20, breaking = false } = {}) {
  // TOKEN news goes through the SEARCH lane, not the firehose (2026-09-02).
  // /v1/news ignores `symbol` entirely - verified by diffing the payloads for
  // symbol=ETH, symbol=SOL and no symbol at all: byte-identical. So a token
  // page asked for Ethereum news, got the generic latest-crypto page, and the
  // caller's relevance filter (correctly) rejected every row - which is why the
  // News tab rendered "No recent news for Ethereum". Over-fetching cannot fix
  // it either: `limit` caps at 100 and a full page carried 3 ETH mentions.
  // /v1/news/search?q= does honour the query and returns on-topic stories.
  if (!breaking && (symbol || name)) {
    const q = String(name || symbol).trim()
    try {
      const sq = new URLSearchParams({ q, limit: String(Math.max(limit, 12)) })
      const found = await fetchV1Json(`/news/search?${sq}`, { ttl: TTL.news })
      // Search answers { data: { query, results: [...] } } - a different shape
      // from the firehose's { data: [...] }.
      const hits = Array.isArray(found?.data?.results) ? found.data.results
        : Array.isArray(found?.results) ? found.results
        : []
      const editorial = hits.filter(isEditorialNewsItem)
      if (editorial.length > 0) return editorial.slice(0, limit).map(normalizeNewsItem)
    } catch (_) { /* fall through to the firehose below */ }
  }

  // Over-fetch slightly when we'll be filtering, so the post-filter list still
  // has enough rows to satisfy the caller's `limit`.
  const fetchLimit = breaking ? Math.max(limit * 2, 10) : limit
  const qs = new URLSearchParams({ limit: String(fetchLimit) })
  // SEC EDGAR files 250-460 8-Ks a business day against ~90 editorial stories
  // from everything else combined, and /v1/news is ordered purely by
  // published_at — so a limit=80 read came back 79 filings and ONE article and
  // the whole Discover page was that one article (2026-08-04). isEditorialNewsItem
  // below has always stripped them, but it runs AFTER the page has been fetched,
  // which cannot recover rows that were never in it. Excluding at the source is
  // the only place the filter can actually work.
  qs.set('exclude_source', 'SEC EDGAR')
  if (symbol) qs.set('symbol', assetSymbol(symbol))
  const path = breaking
    ? `/news/breaking?${qs}`
    : symbol
      ? `/news?${qs}`
      : `/news?${qs}`
  const payload = await fetchV1Json(path, { ttl: TTL.news })
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.articles) ? payload.articles : []
  return rows.filter(isEditorialNewsItem).slice(0, limit).map(normalizeNewsItem)
}

export async function getSpectreIntelligenceSignals({ limit = 20 } = {}) {
  const qs = new URLSearchParams({ limit: String(limit) })
  const payload = await fetchV1Json(`/intelligence/signals?${qs}`, { ttl: TTL.intelligence })
  return Array.isArray(payload?.data) ? payload.data : []
}

// ─── Narrative Lifecycle helpers ───────────────────────────────────────────
// Classify a sector into a lifecycle stage based on 24h market-cap change.
// Early = green & ramping, Late = red & flushing. We use percentile thresholds
// against the cohort so the spread of "Mid" is always tight regardless of
// whether the market is in a roar or a chop day.
function _stageFromChange(change, p10, p35, p65, p90) {
  const c = Number(change) || 0
  if (c >= p90) return { code: 'E',  label: 'Early' }
  if (c >= p65) return { code: 'EM', label: 'Early-Mid' }
  if (c >= p35) return { code: 'M',  label: 'Mid' }
  if (c >= p10) return { code: 'ML', label: 'Mid-Late' }
  if (c < p10 && c > -50) return { code: 'L',  label: 'Late' }
  return { code: 'X', label: 'Exhausted' }
}

function _percentile(arr, p) {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.floor((p / 100) * (sorted.length - 1))
  return sorted[idx]
}

export async function getSpectreMindshare({ limit = 40 } = {}) {
  const cap = Math.max(1, Number(limit) || 40)
  try {
    // Categories endpoint is our authoritative sector list. Each row carries
    // 24h market-cap change + volume + top-3 coins — enough to build the
    // narrative lifecycle shape the Mindshare panel expects.
    const payload = await fetchV1Json(`/categories?limit=${Math.max(60, cap)}`, { ttl: TTL.categories })
    const raw = Array.isArray(payload?.data) ? payload.data : []
    if (raw.length > 0) {
      // Filter out portfolio/list-style pseudo-categories that aren't real sectors.
      const sectors = raw.filter((r) => {
        const name = String(r.name || '').toLowerCase()
        return !/portfolio|^binance|^coinbase/i.test(name)
      }).slice(0, cap)

      const changes = sectors.map((s) => Number(s.market_cap_change_24h) || 0)
      const p10 = _percentile(changes, 10)
      const p35 = _percentile(changes, 35)
      const p65 = _percentile(changes, 65)
      const p90 = _percentile(changes, 90)

      const shaped = sectors.map((s) => {
        const change = Number(s.market_cap_change_24h) || 0
        const volume = Number(s.volume_24h) || 0
        const mcap = Number(s.market_cap) || 0
        const stage = _stageFromChange(change, p10, p35, p65, p90)
        const topMoverRaw = (Array.isArray(s.top_3_coins) && s.top_3_coins[0]) || null
        // Derive a label from the image URL filename when the API returns
        // image URLs instead of coin objects (which it does today).
        const topMoverLogo = typeof topMoverRaw === 'string'
          ? topMoverRaw
          : (topMoverRaw?.image || topMoverRaw?.logo || null)
        const topMoverName = typeof topMoverRaw === 'object'
          ? (topMoverRaw?.name || '')
          : (typeof topMoverRaw === 'string'
            ? (topMoverRaw.match(/\/([^\/]+?)(?:-icon)?\.(?:png|jpg|webp)/i)?.[1] || '').replace(/[-_]/g, ' ')
            : '')
        const topMoverTicker = topMoverName ? topMoverName.split(/\s+/)[0].toUpperCase() : ''
        return {
          sector_id: s.slug,
          slug: s.slug,
          sector_name: s.name,
          name: s.name,
          change_24h: change,
          volume,
          market_cap: mcap,
          asset_count: Number(s.asset_count) || 0,
          stage,
          lifecycle: stage.code,
          momentum_score: Math.round(((change + 20) / 40) * 100) || 0,
          risk_score: Math.max(0, Math.min(100, Math.round(50 - change * 2.5))),
          performance: {
            change_24h: change,
            change_7d: null,
            change_30d: null,
          },
          top_mover: topMoverRaw ? {
            ticker: topMoverTicker,
            name: topMoverName,
            change_24h: 0,
            logo: topMoverLogo,
            token_id: typeof topMoverRaw === 'object' ? topMoverRaw.id : null,
            price: typeof topMoverRaw === 'object' ? Number(topMoverRaw.current_price || 0) : null,
          } : null,
          x: { attention_score: Math.max(0, Math.round(((change + 10) / 20) * 100)) },
        }
      })

      // Cycle phase from cohort skew: heavy green = early/bullish, heavy red = late/bearish.
      const greens = shaped.filter((s) => s.change_24h > 0).length
      const reds = shaped.filter((s) => s.change_24h < 0).length
      const greenRatio = shaped.length ? greens / shaped.length : 0
      const redRatio = shaped.length ? reds / shaped.length : 0
      let phaseLabel = 'Mid Cycle'
      let phaseScore = 0.5
      if (greenRatio > 0.65) { phaseLabel = 'Early Cycle'; phaseScore = 0.2 }
      else if (greenRatio > 0.5) { phaseLabel = 'Growth Phase'; phaseScore = 0.35 }
      else if (redRatio > 0.65) { phaseLabel = 'Late Cycle'; phaseScore = 0.85 }
      else if (redRatio > 0.5) { phaseLabel = 'Distribution'; phaseScore = 0.7 }

      // Highlights: top momentum (max change), highest risk (min change).
      const byChange = [...shaped].sort((a, b) => b.change_24h - a.change_24h)
      const top = byChange[0] || null
      const bottom = byChange[byChange.length - 1] || null

      return {
        data: shaped,
        sectors: shaped,
        cycle: { phase_label: phaseLabel, phase_score: phaseScore },
        highlights: {
          top_momentum: top,
          highest_risk: bottom,
        },
        source: 'spectre-v1-categories-derived',
        pagination: { total: shaped.length, limit: cap, offset: 0, has_more: false },
      }
    }
  } catch {
    // Categories endpoint optional — fall through to legacy bridge below.
  }

  try {
    const payload = await fetchJson(`/intelligence/mindshare?limit=${cap}`, { ttl: TTL.intelligence })
    return payload || { data: [], sectors: [], pagination: { total: 0, limit: cap, offset: 0, has_more: false } }
  } catch {
    return { data: [], sectors: [], source: 'unavailable', pagination: { total: 0, limit: cap, offset: 0, has_more: false } }
  }
}
