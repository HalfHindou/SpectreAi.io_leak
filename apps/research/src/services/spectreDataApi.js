/**
 * Spectre Data API Service
 * Wraps calls to our own data bridge at 204.168.244.18
 * Dev: Vite proxy rewrites /data-api/* -> http://204.168.244.18/api/*
 * Prod: Vercel rewrite does the same
 *
 * Feature flag: USE_SPECTRE_API controls whether hooks route here or to legacy services.
 * The bridge handles auth internally - no API key needed from the frontend.
 */
import {
  getSpectreCategories,
  getSpectreFearGreedCurrent,
  getSpectreGlobalMarket,
  getSpectreMarketTrending,
  getSpectrePricesBySymbols,
  getSpectreSearch,
  getSpectreTokenChart,
  getSpectreTokenMovers,
} from '@/services/spectreMarketApi'
import { consumeEarlyFetch } from '@/lib/early-fetch'

// Toggle this to switch between our bridge and direct Codex/Binance/CoinGecko calls
export const USE_SPECTRE_API = true

const BASE = '/data-api'
const FETCH_TIMEOUT = 12000

// Cache + dedup (same pattern as fearGreedApi.js)
const _cache = {}
const _inflight = {}

function _getCached(key, ttlMs) {
  const entry = _cache[key]
  if (!entry) return null
  if (Date.now() - entry.ts > ttlMs) { delete _cache[key]; return null }
  return entry.data
}

function _setCached(key, data) {
  _cache[key] = { data, ts: Date.now() }
}

function _deduped(cacheKey, ttlMs, fetchFn) {
  const cached = _getCached(cacheKey, ttlMs)
  if (cached) return Promise.resolve(cached)
  if (_inflight[cacheKey]) return _inflight[cacheKey]

  const promise = fetchFn()
    .then(data => {
      _setCached(cacheKey, data)
      delete _inflight[cacheKey]
      return data
    })
    .catch(err => {
      delete _inflight[cacheKey]
      throw err
    })

  _inflight[cacheKey] = promise
  return promise
}

async function _fetchJSON(url) {
  // PR-3 (perf): adopt the index.html early-fetch result for this exact URL
  // if one is in flight (fired at HTML-parse time, before React booted).
  // Consume-once; a failed early fetch falls through to a normal request.
  const early = consumeEarlyFetch(url)
  if (early) {
    const result = await early
    if (result && result.ok && result.json !== null) return result.json
  }
  // credentials: 'include' — /data-api routes ride the same-origin gate cookie;
  // the iOS standalone PWA drops it without this, 401-ing OHLCV/fear-greed/etc.
  const res = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(FETCH_TIMEOUT) })
  if (!res.ok) throw new Error(`Spectre API ${res.status}: ${url}`)
  return res.json()
}

// ── TTLs ──────────────────────────────────────────────────────────────────
const TTL = {
  price: 10_000,       // 10s - real-time prices
  trending: 60_000,    // 1min - trending/gainers
  search: 30_000,      // 30s - search results
  chart: 30_000,       // 30s - OHLCV bars
  fearGreed: 300_000,  // 5min - fear & greed (slow-moving)
  global: 60_000,      // 1min - global market stats
  categories: 300_000, // 5min - categories
}

// ── Token Prices ──────────────────────────────────────────────────────────
// GET /v1/prices?symbols=BTC,ETH,SOL
// The bridge returns { data: { BTC: { price, market_cap, fdv, volume_24h,
//   change: { '1h','24h','7d','30d' }, high_24h, low_24h, image, name,
//   rank, contract, chain, supply: { circulating, total } } } }
// Chunking (cap ~100 symbols/request) + dedup live in
// getSpectrePricesBySymbols; this module just re-exports the batch/single
// helpers below.

/**
 * Batch price lookup via one (or a few chunked) bridge request.
 * @param {string[]} symbols
 * @returns {Promise<Record<string, object>>}
 */
export async function getTokenPricesBatch(symbols) {
  return getSpectrePricesBySymbols(symbols).catch(() => ({}))
}

/**
 * Single-symbol price via the batch endpoint.
 * @param {string} asset - symbol like 'BTC', 'ETH', 'SOL'
 * @returns {Promise<object | null>}
 */
export async function getTokenPrice(asset) {
  if (!asset) return null
  const sym = String(asset).toUpperCase()
  const map = await getTokenPricesBatch([sym])
  return map[sym] || null
}

// ── Trending / Gainers ────────────────────────────────────────────────────
// GET /data-api/v1/market/trending
export async function getTrending() {
  return _deduped('trending', TTL.trending, () => getSpectreMarketTrending(20)).catch(() => [])
}

// GET /data-api/v1/tokens/movers
export async function getGainers() {
  return _deduped('gainers', TTL.trending, async () => {
    const movers = await getSpectreTokenMovers(20)
    return movers.gainers || []
  }).catch(() => [])
}

// ── Search ────────────────────────────────────────────────────────────────
// GET /data-api/v1/search?q=
export async function searchTokens(query) {
  if (!query || query.length < 2) return []
  const key = `search:${query.toLowerCase()}`
  return _deduped(key, TTL.search, async () => {
    const data = await getSpectreSearch(query)
    return data?.coins || data || []
  }).catch(() => [])
}

// ── OHLCV Chart ───────────────────────────────────────────────────────────
// GET /data-api/v1/chart?symbol=:asset&interval=1h
/**
 * @param {string} asset - symbol like 'BTC'
 * @param {string} [interval='1h'] - '1m','5m','15m','1h','4h','1d','1w'
 * @returns {Promise<{ bars: Array<{ t, o, h, l, c, v }> }>}
 */
export async function getTokenChart(asset, interval = '1h') {
  if (!asset) return { bars: [] }
  const sym = asset.toUpperCase()
  const key = `chart:${sym}:${interval}`
  return _deduped(key, TTL.chart, async () => {
    const data = await getSpectreTokenChart(sym, { interval })
    if (Array.isArray(data)) return { bars: data }
    return { bars: [] }
  }).catch(() => ({ bars: [] }))
}

// ── Fear & Greed ──────────────────────────────────────────────────────────
// GET /data-api/v1/market/fear-greed
export async function getFearGreed() {
  return _deduped('fear-greed', TTL.fearGreed, () => getSpectreFearGreedCurrent()).catch(() => null)
}

// ── Global Market Stats ───────────────────────────────────────────────────
// GET /data-api/v1/market/global
export async function getGlobalMarket() {
  return _deduped('global-market', TTL.global, () => getSpectreGlobalMarket()).catch(() => null)
}

// ── Market Trending ───────────────────────────────────────────────────────
// GET /data-api/v1/market/trending
export async function getMarketTrending() {
  return _deduped('market-trending', TTL.trending, () => getSpectreMarketTrending(20)).catch(() => [])
}

// ── Categories ────────────────────────────────────────────────────────────
// GET /data-api/v1/categories
export async function getCategories() {
  return _deduped('categories', TTL.categories, () => getSpectreCategories()).catch(() => [])
}

// ── Research Zone Bootstrap ───────────────────────────────────────────────
// GET /data-api/v1/rz/:asset/bootstrap
// One-shot composite that returns identity + price + technicals + score +
// sentiment + derivatives + pairs + recent candles + profile + narratives +
// mentions in a single round-trip. Replaces ~15 RZ first-paint fetches.
export async function getRzBootstrap(asset) {
  if (!asset) return null
  const sym = String(asset).toUpperCase()
  return _deduped(`rz-bootstrap:${sym}`, TTL.price, async () => {
    const url = `${BASE}/v1/rz/${encodeURIComponent(sym)}/bootstrap`
    const json = await _fetchJSON(url)
    return json?.data ?? null
  }).catch((err) => {
    console.warn('[rz-bootstrap]', err?.message || err)
    return null
  })
}

// ── Brain Intel Lookup ────────────────────────────────────────────────────
// GET /data-api/v1/brain/lookup?key=SYM — intel-ledger items (headline,
// category, observation_count, first_detected) for a symbol/entity. Used as
// news-impact context next to the TA read. STRICTLY best-effort: any error /
// 404 / empty payload resolves to null and the caller renders nothing.
export async function getBrainLookup(key) {
  if (!key) return null
  const k = String(key).toUpperCase().split(':')[0]
  return _deduped(`brain-lookup:${k}`, 300_000, async () => {
    const url = `${BASE}/v1/brain/lookup?key=${encodeURIComponent(k)}`
    const json = await _fetchJSON(url)
    return json?.data ?? json ?? null
  }).catch(() => null)
}

// ── Agent Signals ─────────────────────────────────────────────────────────
// Unified, ranked signal feed for any token. Composer route on Hetzner mixes
// brain signals + derived market signals + X Dash heat so every token gets
// something useful (BTC/ETH get 20 brain signals, longtail still gets 2-3
// derived ones from price action + social tier).
export async function getAgentSignals(asset) {
  if (!asset) return []
  const key = String(asset).toLowerCase()
  return _deduped(`agent-signals:${key}`, 60_000, async () => {
    const url = `${BASE}/v1/agent-signals/${encodeURIComponent(key)}`
    const json = await _fetchJSON(url)
    return Array.isArray(json?.data) ? json.data : []
  }).catch((err) => {
    console.warn('[agent-signals]', err?.message || err)
    return []
  })
}

// ── Health Check ──────────────────────────────────────────────────────────
export async function healthCheck() {
  try {
    const data = await _fetchJSON(`${BASE}/v1/health`)
    return { ok: true, ...data }
  } catch {
    return { ok: false }
  }
}
