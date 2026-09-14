/**
 * Vercel Serverless - Extended routes proxy.
 * Handles: RWA, compare/chart, token-extended, weather, hero, solana-balance,
 * binance-klines, monarch/chat, search/query, CMS, CMC, accelerators, private-markets.
 *
 * Most routes proxy to the Spectre API server or external services.
 * Routes that need Express server state return graceful fallbacks.
 */

import { createRequire } from 'node:module'
import { lookupBinancePair } from '../binance-bars.js'
import { getJsonWithTTL, setJsonWithTTL } from '../kv.js'
import { contractFromPlatforms } from '../cg-platforms.js'
const require = createRequire(import.meta.url)

// Default to the direct Hetzner origin — api.spectreai.io is CF-WAF blocked
// for Vercel server-to-server traffic. Env var still wins when set.
const API_BASE = process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850'
// 2026-05-12 lockdown: previously fell back to a hardcoded literal
// 'spectre_dev_internal_key_change_me'. If api.spectreai.io ever
// accepted it (intentionally or via a misconfigured dev env in prod),
// every internet visitor would drain our data API. Empty fallback +
// the `if (API_KEY)` guards downstream mean upstream returns 401 when
// the key is unset rather than us shipping a known-public credential.
const API_KEY =
  process.env.SPECTRE_API_KEY ||
  process.env.SPECTRE_DATA_BRIDGE_KEY ||
  ''
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || ''
const COINGECKO_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3'
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast'
const DEFI_LLAMA_BASE = 'https://api.llama.fi'
const STABLECOINS_BASE = 'https://stablecoins.llama.fi'

const _cache = {}
function getCached(key, ttl) {
  const e = _cache[key]
  if (!e || Date.now() - e.ts > ttl) return null
  return e.data
}
function setCache(key, data) { _cache[key] = { data, ts: Date.now() } }

const ALLOWED_ORIGINS = [
  'http://localhost:5180', 'http://localhost:5181'
]

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin',
    ALLOWED_ORIGINS.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function assetSymbol(value) {
  return String(value || '').trim().replace(/^\$/, '').toUpperCase()
}

function toNumberOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// Helper: proxy to Spectre API server
async function spectreProxy(path, ttlMs = 30_000, fetchTimeoutMs = 15000) {
  const cacheKey = `sp:${path}`
  const cached = getCached(cacheKey, ttlMs)
  if (cached) return cached
  const headers = { Accept: 'application/json' }
  if (API_KEY) headers['X-API-Key'] = API_KEY
  try {
    const r = await fetch(`${API_BASE}${path}`, { headers, signal: AbortSignal.timeout(fetchTimeoutMs) })
    if (!r.ok) {
      const err = new Error(`Spectre API ${r.status}`)
      err.upstreamStatus = r.status
      throw err
    }
    const data = await r.json()
    setCache(cacheKey, data)
    return data
  } catch (err) {
    // Serve the last good value (even past TTL) when the origin cold-starts or
    // fails — a flaky Spectre origin must not blank a core section or block the
    // bundle. Mirrors getRwaBreakdown/getRwaIndex stale-on-error in routes/rwa.js.
    const stale = _cache[cacheKey]
    if (stale) { console.warn(`[RWA] spectreProxy ${path} failed, serving stale:`, err.message); return stale.data }
    throw err
  }
}

function buildForwardQuery(req, extraExclude = []) {
  const params = new URLSearchParams()
  const exclude = new Set(['fn', 'route', 'path', ...extraExclude])
  for (const [key, value] of Object.entries(req.query || {})) {
    if (exclude.has(key) || value == null || value === '') continue
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry != null && entry !== '') params.append(key, String(entry))
      })
      continue
    }
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

function pickSearchCoin(query, coins = []) {
  if (!Array.isArray(coins) || coins.length === 0) return null

  const raw = String(query || '').trim()
  const symbol = assetSymbol(raw)
  const lowered = raw.toLowerCase()
  const looksLikeTicker = raw === symbol && raw === raw.toUpperCase() && !raw.includes('-')

  if (!looksLikeTicker) {
    const byCgId = coins.find((coin) => String(coin.coingecko_id || coin.id || '').toLowerCase() === lowered)
    if (byCgId) return byCgId

    // Slug-normalized name match (2026-08-25): RZ slugs are CG ids, i.e.
    // usually the SLUGIFIED coin name — 'world-liberty-financial' can never
    // equal the raw name "World Liberty Financial", so multi-word slugs whose
    // box row lacks coingecko_id fell through to the blind coins[0] pick
    // (wrong-coin risk, the clone class). Compare slug-to-slug instead.
    const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const byName = coins.find((coin) => slugify(coin.name) === slugify(lowered))
    if (byName) return byName
  }

  const bySymbol = coins
    .filter((coin) => assetSymbol(coin.symbol) === symbol)
    .sort((a, b) => {
      const aRank = toNumberOrNull(a.rank ?? a.market_cap_rank)
      const bRank = toNumberOrNull(b.rank ?? b.market_cap_rank)
      if (aRank != null && bRank != null) return aRank - bRank
      if (aRank != null) return -1
      if (bRank != null) return 1
      return 0
    })
  if (bySymbol.length > 0) return bySymbol[0]

  if (looksLikeTicker) {
    const byCgId = coins.find((coin) => String(coin.coingecko_id || coin.id || '').toLowerCase() === lowered)
    if (byCgId) return byCgId

    const byName = coins.find((coin) => String(coin.name || '').toLowerCase() === lowered)
    if (byName) return byName
  }

  return coins[0]
}

const ALLOWED_V1_PREFIXES = [
  'prices',
  'search',
  'price-history/',
  'social/',
  'categories',
  'market/fear-greed',
  'market/fear-greed/enhanced',
  'market/global',
  'market/dominance',
  'market/alt-season',
  'market/others2',
  'market/heatmap',
  'news',
  'intelligence/',
  'technicals/',
  'sentiment/',
  'community/',
  'coins/',
  'discovery/',
  'institutional/',
  'rz/',
  'health',
  'derivatives/',
  'options/',
  'fundraising/',
  'defi/',
  'global/dominance/history',
  'bubbles',
  'heatmap',
  'market/trending',
  // why-mode (2026-07-27): the day-tracker spine + the market half of the
  // consciousness fuse. Read-only, already gated server-side.
  'market/timeline',
  'market/state',
  // the day digest (2026-08-05) — /timeline grouped server-side into one card
  // per calendar day. Same table, same gates, ~30KB instead of ~1MB.
  'market/days',
  'notifications/feed',
  'agent-signals/',
  'asset/',
  'unlocks',
  'brain/',
  'wallets/',
  'etf/',
  // Agent Arena (2026-08-13): per-trader equity snapshots + leaderboard for the
  // paper book. Read-only rows the box already serves; /v1/brain/paper carries
  // the roster but no time series, so the arena needs this lane for curves.
  'paper-trading/',
  // Market Cinema (2026-08-13): the labeled whale/stablecoin transfer tape
  // (from_label/to_label: Circle mint-burn, tagged exchange deposits).
  'smart-money/',
  // Desk briefs (2026-08-27): the morning / week-ahead / big-picture notes the
  // box's desk-brief-writer produces and Telegram already pushes. The Intel
  // Desk card shipped 2026-08-24 fetching /data-api/v1/briefs/desk, but the
  // prefix never landed here — every request 403'd and the card, which hides
  // itself on any non-OK response, had never once rendered in production.
  'briefs/'
]

function isAllowedV1Path(path) {
  return ALLOWED_V1_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix))
}

function ttlForV1Path(path) {
  if (path.startsWith('price-history/')) return 60_000
  if (path.startsWith('social/')) return 30_000
  if (path.startsWith('technicals/')) return 15_000
  if (path.startsWith('sentiment/')) return 30_000
  if (path.startsWith('community/')) return 300_000
  if (path.startsWith('derivatives/')) return 15_000
  if (path.startsWith('options/')) return 60_000
  if (path.startsWith('defi/')) return 120_000
  if (path.startsWith('global/dominance/history')) return 300_000
  // Wallets command aggregate: box-side redis holds it 60s; matching edge TTL
  // keeps the Wallets CC tab off the cold 5s aggregate rebuild.
  if (path.startsWith('wallets/')) return 60_000
  // Spot-ETF flows settle once a day; a long edge cache keeps the /etfs page,
  // Command Center Flows tab and Wallets section off the cold price-history scan.
  if (path.startsWith('etf/')) return 900_000
  // Slow-moving market aggregates: dominance, alt-season and global market cap
  // barely move minute-to-minute, so the blanket 30s was needlessly hot. Cache
  // them longer; keep genuinely-live market paths (fear-greed, trending) at 30s.
  if (path.startsWith('market/dominance')) return 300_000
  if (path.startsWith('market/alt-season')) return 180_000
  if (path.startsWith('market/others2')) return 300_000
  if (path.startsWith('market/global')) return 120_000
  // the timeline appends every ~45s and the state regenerates ~15-min — short
  // edges keep the why page live without hammering the box
  if (path.startsWith('market/timeline')) return 30_000
  if (path.startsWith('market/state')) return 60_000
  // 🪤 Longer than the timeline's on purpose. A day card is an aggregate over
  // ~130 events, so one more arriving cannot visibly change it — but the cold
  // build is a windowed scan (measured 1.5s at 14 days). Re-running that every
  // 30s to redraw an identical card is pure waste.
  if (path.startsWith('market/days')) return 300_000
  if (path.startsWith('market/')) return 30_000
  // Top-coins markets list backs the welcome discovery table + discover/you.
  // The client overlays live prices (useLivePrices), and the ranking / 7d
  // sparkline / %-change columns / market cap all move slowly, so a long edge
  // TTL is safe and keeps cold visitors off the remote round trip to the
  // Spectre box (the default 300s was needlessly hot for this payload). swr
  // (=2x) lets the edge serve stale while it revalidates in the background.
  if (path.startsWith('coins/markets')) return 600_000
  // prices/search 2026-07-07: the upstream box takes 3-7s for any symbol set /
  // query it hasn't cached yet, and the edge keys per exact URL - at a 10s TTL
  // nearly every poll tick was a MISS that paid the slow path (and sometimes
  // 502'd). 30s + swr (2x) keeps users on the edge cache; majors get a live
  // Binance price overlay client-side, so a <=30s-old Spectre map is safe
  // (same rationale as coins/markets at 600s above).
  if (path === 'search') return 30_000
  if (path === 'prices') return 30_000
  // bubbles: measured 12-15s cold + 502-prone on the Hetzner path (07-31,
  // the /alt-rotation movers leg) — a 15s edge TTL guaranteed nearly every
  // visitor a cold hit. It's a leaderboard, not a tape: 120s + SWR is safe.
  if (path === 'bubbles') return 120_000
  if (path === 'heatmap') return 15_000
  if (path.startsWith('intelligence/')) return 60_000
  if (path.startsWith('institutional/')) return 120_000
  if (path.startsWith('agent-signals/')) return 60_000
  if (path.startsWith('news')) return 60_000
  // Unlock schedules carry a spot-derived USD overhang now, so they are a live
  // number wearing a static-looking payload. 60s keeps the dollar figure honest.
  if (path.startsWith('unlocks')) return 60_000
  // Paper-book equity snapshots land every ~5 min on the box; 60s keeps the
  // arena's curves fresh without re-paying the per-trader query per viewer.
  if (path.startsWith('paper-trading/')) return 60_000
  // Whale tape: box caches 30s; matching edge TTL means every cinema viewer
  // shares one upstream fetch per window.
  if (path.startsWith('smart-money/')) return 30_000
  // Desk briefs are written a handful of times a day (morning 07:30 UTC, week
  // ahead Mondays, big picture every third day) — a note, not a tape. 5 min
  // costs at most a few minutes' delay on a daily brief and keeps every
  // reader of both surfaces on one upstream fetch.
  if (path.startsWith('briefs/')) return 300_000
  return 300_000
}

// Helper: CoinGecko fetch
async function cgFetch(path) {
  const opts = { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) }
  if (COINGECKO_API_KEY) opts.headers['x-cg-pro-api-key'] = COINGECKO_API_KEY
  const r = await fetch(`${COINGECKO_BASE}${path}`, opts)
  if (!r.ok) throw new Error(`CoinGecko ${r.status}`)
  return r.json()
}

// ── Weather ─────────────────────────────────────────────────────────────────
async function handleWeather(req, res) {
  const lat = parseFloat(req.query.lat) || 40.71
  const lon = parseFloat(req.query.lon) || -74.01
  try {
    const url = `${OPEN_METEO}?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=celsius&timezone=auto`
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error(`Weather ${r.status}`)
    const data = await r.json()
    const parts = (data.timezone || '').split('/')
    const location = (parts[parts.length - 1] || 'Unknown').replace(/_/g, ' ')
    return res.status(200).json({
      location,
      temp: Math.round(data.current?.temperature_2m ?? 0),
      high: Math.round(data.daily?.temperature_2m_max?.[0] ?? 0),
      low: Math.round(data.daily?.temperature_2m_min?.[0] ?? 0),
      code: data.current?.weather_code ?? 0,
    })
  } catch (e) {
    return res.status(200).json({ location: '—', temp: 0, high: 0, low: 0, code: 0 })
  }
}

// ── Compare chart ───────────────────────────────────────────────────────────
// Mirrors packages/server/index.js /api/compare/chart shape:
//   { entities: [{ id, name, type, colorIndex, data: [{ ts, pct, price }] }] }
const CHAIN_TO_NATIVE_COINGECKO = {
  ethereum: { id: 'ethereum', name: 'Ethereum' },
  bsc: { id: 'binancecoin', name: 'BNB Chain' },
  polygon: { id: 'matic-network', name: 'Polygon' },
  arbitrum: { id: 'arbitrum', name: 'Arbitrum' },
  base: { id: 'ethereum', name: 'Base' },
  avalanche: { id: 'avalanche-2', name: 'Avalanche' },
  optimism: { id: 'optimism', name: 'Optimism' },
  fantom: { id: 'fantom', name: 'Fantom' },
  solana: { id: 'solana', name: 'Solana' },
  sui: { id: 'sui', name: 'Sui' },
  aptos: { id: 'aptos', name: 'Aptos' },
  sei: { id: 'sei-network', name: 'Sei' },
  injective: { id: 'injective-protocol', name: 'Injective' },
  near: { id: 'near', name: 'NEAR' },
  mantle: { id: 'mantle', name: 'Mantle' },
  cronos: { id: 'crypto-com-chain', name: 'Cronos' },
  ton: { id: 'the-open-network', name: 'TON' },
  berachain: { id: 'berachain-bera', name: 'Berachain' },
  linea: { id: 'ethereum', name: 'Linea' },
  zksync: { id: 'ethereum', name: 'zkSync' },
  scroll: { id: 'ethereum', name: 'Scroll' },
  blast: { id: 'ethereum', name: 'Blast' },
  celo: { id: 'celo', name: 'Celo' },
  tron: { id: 'tron', name: 'Tron' },
  cosmos: { id: 'cosmos', name: 'Cosmos' },
}

async function fetchCoinMarketChart(coinId, days) {
  const data = await cgFetch(`/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=${days}`)
  if (!data?.prices?.length) throw new Error('No price data')
  const basePrice = data.prices[0][1]
  if (!basePrice || basePrice <= 0) throw new Error('Invalid base price')
  return data.prices.map(([ts, price]) => ({
    ts: Math.floor(ts / 1000),
    pct: ((price - basePrice) / basePrice) * 100,
    price,
  }))
}

// CG /search lookup with a tiny TTL cache. Used when an initial market_chart
// fetch fails because the caller passed a symbol ("HYPE", "XMR", "LAB")
// instead of the canonical CG slug ("hyperliquid", "monero", ...). The
// Spectre heatmap upstream doesn't surface coingecko_id, so heatmap rows
// arrive with only symbol/name and we have to resolve client-blind.
const _cgSearchCache = {}
async function resolveCgSlugFromSymbol(symbolOrName) {
  if (!symbolOrName) return null
  const key = String(symbolOrName).trim().toLowerCase()
  if (!key) return null
  const cached = _cgSearchCache[key]
  if (cached && Date.now() - cached.ts < 6 * 60 * 60 * 1000) return cached.slug
  try {
    const json = await cgFetch(`/search?query=${encodeURIComponent(key)}`)
    const coins = Array.isArray(json?.coins) ? json.coins : []
    // Prefer exact symbol match with the highest market cap rank, fall back
    // to the first hit (CG's own relevance order).
    const upper = String(symbolOrName).trim().toUpperCase()
    const exact = coins.filter((c) => String(c.symbol || '').toUpperCase() === upper)
    const ranked = exact.filter((c) => Number.isFinite(c.market_cap_rank))
    let pick = null
    if (ranked.length) {
      ranked.sort((a, b) => a.market_cap_rank - b.market_cap_rank)
      pick = ranked[0]
    } else if (exact.length) {
      pick = exact[0]
    } else if (coins.length) {
      pick = coins[0]
    }
    const slug = pick?.id || null
    if (slug) _cgSearchCache[key] = { slug, ts: Date.now() }
    return slug
  } catch {
    return null
  }
}

async function fetchSectorChart(categoryId, days) {
  const list = await cgFetch(`/coins/markets?vs_currency=usd&category=${encodeURIComponent(categoryId)}&order=market_cap_desc&per_page=3&page=1`)
  if (!Array.isArray(list) || !list.length) throw new Error('No coins in category')
  const charts = []
  for (let i = 0; i < Math.min(list.length, 3); i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 400))
    try {
      const c = await fetchCoinMarketChart(list[i].id, days)
      if (c?.length) charts.push(c)
    } catch { /* skip failed token */ }
  }
  if (!charts.length) throw new Error('No sector chart data')
  const ref = charts[0]
  return ref.map((pt, idx) => {
    let sum = pt.pct, count = 1
    for (let c = 1; c < charts.length; c++) {
      if (charts[c][idx]) { sum += charts[c][idx].pct; count++ }
    }
    return { ts: pt.ts, pct: sum / count }
  })
}

async function handleCompare(req, res) {
  const entitiesJson = req.query.entities || '[]'
  const days = [1, 7, 30, 90, 180, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30
  const cacheKey = `compare:${entitiesJson}:${days}`
  const cached = getCached(cacheKey, 120_000)
  if (cached) {
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=240')
    return res.status(200).json(cached)
  }
  let parsed
  try { parsed = JSON.parse(entitiesJson) } catch { return res.status(400).json({ error: 'Invalid entities JSON' }) }
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 8) {
    return res.status(400).json({ error: 'entities must be array of 1-8 items' })
  }

  // Fan out: CG fetch helpers each enter cgFetch's own queue, so app-level
  // 250ms sleeps between entities just stack wait on top of that.
  const results = await Promise.all(parsed.map(async (ent, idx) => {
    try {
      let data, name
      // Heatmap callers (CoinGeckoPriceChart, FloatingChartWindow) sometimes
      // pass `id` as a ticker symbol ("HYPE", "XMR", "LAB") instead of the
      // canonical CoinGecko slug, because the Spectre heatmap upstream
      // doesn't surface coingecko_id. fetchCoinMarketChart returns 404 in
      // that case. Catch the throw, resolve the symbol via CG /search, and
      // retry once with the canonical slug.
      const tryToken = async (initialId) => {
        try {
          return await fetchCoinMarketChart(initialId, days)
        } catch (e) {
          const slug = await resolveCgSlugFromSymbol(ent.name || ent.id)
          if (slug && slug !== initialId) {
            return await fetchCoinMarketChart(slug, days)
          }
          throw e
        }
      }
      if (ent.type === 'token') {
        data = await tryToken(ent.cgId || ent.id)
        name = ent.name || ent.id
      } else if (ent.type === 'chain') {
        const chain = CHAIN_TO_NATIVE_COINGECKO[ent.id]
        if (!chain) throw new Error(`Unknown chain: ${ent.id}`)
        data = await fetchCoinMarketChart(chain.id, days)
        name = ent.name || chain.name
      } else if (ent.type === 'sector') {
        data = await fetchSectorChart(ent.id, days)
        name = ent.name || ent.id
      } else {
        // Legacy callers may omit type — assume token
        data = await tryToken(ent.cgId || ent.id)
        name = ent.name || ent.id
      }
      return { id: ent.id, name, type: ent.type || 'token', colorIndex: idx, data }
    } catch (e) {
      return { id: ent.id, name: ent.name || ent.id, type: ent.type || 'token', colorIndex: idx, data: [], error: e.message }
    }
  }))

  const payload = { entities: results }
  // Only cache if EVERY entity resolved successfully. A single failed lookup
  // (e.g. CG was rate-limiting when we tried HYPE) used to poison this cache
  // for 120 s, making the chart say "unavailable" even after the upstream
  // recovered. Empty-data / errored entities now bypass both the module
  // cache AND the Vercel edge cache (no s-maxage), so the next click
  // re-attempts the resolution chain instead of replaying the failure.
  const allOk = results.every((r) => Array.isArray(r.data) && r.data.length > 0 && !r.error)
  if (allOk) {
    setCache(cacheKey, payload)
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=240')
  } else {
    res.setHeader('Cache-Control', 'no-store')
  }
  return res.status(200).json(payload)
}

// ── RWA (DeFi Llama) ────────────────────────────────────────────────────────
// Shapes must match packages/server/routes/rwa.js exactly. Frontend
// (useRwaData.js + tabs) depends on these shapes. See .claude/rules/api-patterns.md C.

const RWA_TTL = {
  protocols: 5 * 60 * 1000,       // /overview, /protocols, /chains, /stablecoins, /movers
  protocolDetail: 10 * 60 * 1000, // /protocol/:slug/detail
  history: 30 * 60 * 1000,        // /tvl-history, /stablecoin-history
  analysis: 4 * 60 * 60 * 1000,   // /analysis/:topic, /analysis/protocol/:slug
}

async function rwaFetchJSON(url) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': 'Spectre-AI/1.0' },
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`)
  return r.json()
}

// Map a DeFiLlama protocol's tags + category to our asset_class taxonomy.
function deriveRwaAssetClass(p) {
  const tags = Array.isArray(p.tags) ? p.tags.map((t) => String(t).toLowerCase()) : []
  const cat = String(p.category || '').toLowerCase()
  if (cat === 'rwa lending') return 'credit'
  if (tags.some((t) => t.includes('treasury') || t.includes('money market'))) return 'treasuries'
  if (tags.some((t) => t.includes('credit') || t.includes('fixed income'))) return 'credit'
  if (tags.some((t) => t.includes('commodit'))) return 'commodities'
  if (tags.some((t) => t.includes('stock') || t.includes('etf'))) return 'stocks'
  if (tags.some((t) => t.includes('equity'))) return 'equity'
  return 'other'
}

// Shared RWA protocols fetch + cache (underlies /overview, /protocols, /chains, /movers, /tvl-history).
// The DeFiLlama /protocols payload is ~8MB. overview + protocols + tvl-history all
// call this within ONE bundle invocation, so without an inflight guard a cold core
// fired 2-3 concurrent 8MB downloads. The inflight promise collapses them onto one
// fetch; on upstream failure we serve the last good list. Mirrors getRwaProtocols
// in packages/server/routes/rwa.js.
let rwaProtocolsInflight = null
async function getRwaProtocolsCached() {
  const cacheKey = 'rwa:protocols'
  const cached = getCached(cacheKey, RWA_TTL.protocols)
  if (cached) return cached
  if (rwaProtocolsInflight) return rwaProtocolsInflight

  rwaProtocolsInflight = (async () => {
    const all = await rwaFetchJSON(`${DEFI_LLAMA_BASE}/protocols`)
    const rwa = all
      .filter((p) => p.category === 'RWA' || p.category === 'RWA Lending')
      .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
      .map((p) => ({
        name: p.name,
        slug: p.slug,
        tvl: p.tvl || 0,
        chains: p.chains || [],
        logo: p.logo || null,
        symbol: p.symbol || null,
        change_1d: p.change_1d ?? null,
        change_7d: p.change_7d ?? null,
        change_30d: p.change_30d ?? null,
        description: p.description || null,
        url: p.url || null,
        category: p.category,
        tags: Array.isArray(p.tags) ? p.tags : [],
        asset_class: deriveRwaAssetClass(p),
        parent_protocol: p.parentProtocolSlug || null,
      }))
    setCache(cacheKey, rwa)
    return rwa
  })()

  try {
    return await rwaProtocolsInflight
  } catch (err) {
    const stale = _cache[cacheKey]
    if (stale) { console.warn('[RWA] protocols upstream failed, serving stale:', err.message); return stale.data }
    throw err
  } finally {
    rwaProtocolsInflight = null
  }
}

// ── Shaping helpers (ported from packages/server/routes/rwa.js) ─────────────

function shapeRwaOverview(protocols) {
  const totalTvl = protocols.reduce((sum, p) => sum + p.tvl, 0)
  const chainMap = {}
  for (const p of protocols) {
    if (!p.chains.length) continue
    for (const chain of p.chains) {
      if (!chainMap[chain]) chainMap[chain] = 0
      chainMap[chain] += p.tvl / p.chains.length
    }
  }
  const chainBreakdown = Object.entries(chainMap)
    .map(([chain, tvl]) => ({ chain, tvl }))
    .sort((a, b) => b.tvl - a.tvl)
  const allChains = new Set(protocols.flatMap((p) => p.chains))
  return {
    totalTvl,
    totalProtocols: protocols.length,
    totalChains: allChains.size,
    topProtocols: protocols.slice(0, 20),
    chainBreakdown,
  }
}

function shapeRwaChains(protocols) {
  const chainMap = {}
  for (const p of protocols) {
    if (!p.chains.length) continue
    for (const chain of p.chains) {
      if (!chainMap[chain]) {
        chainMap[chain] = { chain, totalRwaTvl: 0, protocolCount: 0, protocols: [] }
      }
      chainMap[chain].totalRwaTvl += p.tvl / p.chains.length
      chainMap[chain].protocolCount += 1
      chainMap[chain].protocols.push({ name: p.name, slug: p.slug, tvl: p.tvl })
    }
  }
  return Object.values(chainMap).sort((a, b) => b.totalRwaTvl - a.totalRwaTvl)
}

function shapeRwaMovers(protocols) {
  const withChange = protocols.filter((p) => p.tvl > 1_000_000 && p.change_1d != null)
  const gainers = withChange
    .filter((p) => p.change_1d > 0)
    .sort((a, b) => b.change_1d - a.change_1d)
    .slice(0, 10)
  const losers = withChange
    .filter((p) => p.change_1d < 0)
    .sort((a, b) => a.change_1d - b.change_1d)
    .slice(0, 10)
  return { gainers, losers }
}

// TVL-history: daily forward-fill aggregation by category (ported).
const HISTORY_TREASURY_KW = ['treasury', 'buidl', 'usyc', 'benji', 'ustb', 't-bill', 'wisdomtree', 'superstate', 'openeden', 'matrixdock', 'ondo', 'spiko']
const HISTORY_CREDIT_KW = ['centrifuge', 'maple', 'goldfinch', 'truefi', 'clearpool', 'credix', 'credit']
const HISTORY_COMMODITY_KW = ['gold', 'paxg', 'xaut', 'silver', 'platinum', 'commodity']

function classifyForHistory(name) {
  const l = (name || '').toLowerCase()
  if (HISTORY_COMMODITY_KW.some((k) => l.includes(k))) return 'Commodities'
  if (HISTORY_TREASURY_KW.some((k) => l.includes(k))) return 'Treasuries'
  if (HISTORY_CREDIT_KW.some((k) => l.includes(k))) return 'Credit'
  return 'Other RWA'
}

function buildDailySeries(validHistories) {
  const SECONDS_PER_DAY = 86400
  const categories = ['Treasuries', 'Credit', 'Commodities', 'Other RWA']
  const protosByCategory = {}
  for (const cat of categories) protosByCategory[cat] = []
  for (const proto of validHistories) protosByCategory[proto.category].push(proto)

  const protoDaily = validHistories.map((proto) => {
    const dayMap = {}
    const sorted = proto.history.sort((a, b) => a.date - b.date)
    for (const point of sorted) {
      const dayKey = Math.floor(point.date / SECONDS_PER_DAY) * SECONDS_PER_DAY
      dayMap[dayKey] = point.tvl
    }
    return { ...proto, dayMap, days: Object.keys(dayMap).map(Number).sort((a, b) => a - b) }
  })

  const allDays = protoDaily.flatMap((p) => p.days)
  if (!allDays.length) return []
  const minDay = Math.min(...allDays)
  const maxDay = Math.max(...allDays)

  const series = []
  for (let day = minDay; day <= maxDay; day += SECONDS_PER_DAY) {
    const point = { date: day, Treasuries: 0, Credit: 0, Commodities: 0, 'Other RWA': 0 }
    for (const proto of protoDaily) {
      if (day < proto.days[0]) continue
      let val = proto.dayMap[day]
      if (val == null) {
        let lo = 0
        let hi = proto.days.length - 1
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2)
          if (proto.days[mid] <= day) lo = mid
          else hi = mid - 1
        }
        if (proto.days[lo] <= day) val = proto.dayMap[proto.days[lo]]
      }
      if (val != null) point[proto.category] += val
    }
    series.push(point)
  }
  return series
}

async function buildRwaTvlHistory() {
  const protocols = await getRwaProtocolsCached()
  const topProtocols = protocols.slice(0, 25)
  const histories = await Promise.allSettled(
    topProtocols.map(async (p) => {
      try {
        const detail = await rwaFetchJSON(`${DEFI_LLAMA_BASE}/protocol/${p.slug}`)
        let tvlArr = []
        if (Array.isArray(detail.tvl)) {
          tvlArr = detail.tvl
        } else if (detail.chainTvls) {
          const firstKey = Object.keys(detail.chainTvls).find(
            (k) => Array.isArray(detail.chainTvls[k]?.tvl)
          )
          if (firstKey) tvlArr = detail.chainTvls[firstKey].tvl
        }
        return {
          name: p.name,
          slug: p.slug,
          category: classifyForHistory(p.name),
          currentTvl: p.tvl || 0,
          history: tvlArr.map((h) => ({ date: h.date, tvl: h.totalLiquidityUSD || 0 })),
        }
      } catch {
        return null
      }
    })
  )
  const validHistories = histories
    .filter((r) => r.status === 'fulfilled' && r.value?.history?.length)
    .map((r) => r.value)

  let series = buildDailySeries(validHistories)
  if (series.length > 400) {
    const step = Math.ceil(series.length / 400)
    series = series.filter((_, i) => i % step === 0 || i === series.length - 1)
  }

  const protocolSeries = {}
  for (const proto of validHistories.slice(0, 8)) {
    protocolSeries[proto.slug] = {
      name: proto.name,
      category: proto.category,
      currentTvl: proto.currentTvl,
      data: proto.history
        .sort((a, b) => a.date - b.date)
        .filter((_, i, arr) => {
          if (arr.length <= 200) return true
          const step = Math.ceil(arr.length / 200)
          return i % step === 0 || i === arr.length - 1
        }),
    }
  }

  return {
    categories: ['Treasuries', 'Credit', 'Commodities', 'Other RWA'],
    series,
    protocolSeries,
    protocolCount: validHistories.length,
    lastUpdated: Date.now(),
  }
}

async function buildRwaStablecoinHistory() {
  // Warm upstream baseline (not used directly — matches Express call order)
  try {
    await rwaFetchJSON(`${STABLECOINS_BASE}/stablecoincharts/all?stablecoin=1`)
  } catch { /* non-fatal */ }

  const stablecoins = await rwaFetchJSON(`${STABLECOINS_BASE}/stablecoins?includePrices=true`)
  const top5 = (stablecoins.peggedAssets || [])
    .sort((a, b) => (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0))
    .slice(0, 5)

  const individualHistories = await Promise.allSettled(
    top5.map(async (sc) => {
      try {
        const chart = await rwaFetchJSON(
          `${STABLECOINS_BASE}/stablecoincharts/all?stablecoin=${sc.id}`
        )
        return {
          id: sc.id,
          name: sc.name,
          symbol: sc.symbol,
          history: (Array.isArray(chart) ? chart : []).map((p) => ({
            date: p.date,
            mcap: p.totalCirculatingUSD?.peggedUSD || 0,
          })),
        }
      } catch {
        return null
      }
    })
  )
  const validIndividual = individualHistories
    .filter((r) => r.status === 'fulfilled' && r.value?.history?.length)
    .map((r) => r.value)

  const dateMap = {}
  for (const sc of validIndividual) {
    for (const point of sc.history) {
      if (!dateMap[point.date]) dateMap[point.date] = { date: point.date }
      dateMap[point.date][sc.symbol] = point.mcap
    }
  }
  let series = Object.values(dateMap).sort((a, b) => a.date - b.date)
  if (series.length > 500) {
    const step = Math.ceil(series.length / 500)
    series = series.filter((_, i) => i % step === 0 || i === series.length - 1)
  }

  return {
    coins: validIndividual.map((sc) => ({ id: sc.id, name: sc.name, symbol: sc.symbol })),
    series,
    lastUpdated: Date.now(),
  }
}

async function buildRwaStablecoins() {
  const raw = await rwaFetchJSON(`${STABLECOINS_BASE}/stablecoins?includePrices=true`)
  return (raw.peggedAssets || []).map((s) => ({
    id: s.id,
    name: s.name,
    symbol: s.symbol,
    geckoId: s.geckoId || null,
    pegType: s.pegType || null,
    pegMechanism: s.pegMechanism || null,
    circulating: s.circulating || null,
    circulatingPrevDay: s.circulatingPrevDay || null,
    circulatingPrevWeek: s.circulatingPrevWeek || null,
    circulatingPrevMonth: s.circulatingPrevMonth || null,
    chains: s.chains || [],
    chainCirculating: s.chainCirculating || {},
    price: s.price ?? null,
  }))
}

// Per-coin chainCirculating is ~307KB (52% of the core payload) and only the
// Stablecoins-tab chain chart + Screener chain count read it - never the
// default Overview. Strip it from the core tier; the Stablecoins tab
// lazy-fetches the full /stablecoins route on open. Keeps the page-paint
// payload ~46KB gzip lighter. MUST mirror routes/rwa.js slimStablecoins.
function slimStablecoins(list) {
  if (!Array.isArray(list)) return list
  return list.map(({ chainCirculating, ...rest }) => rest)
}

async function buildRwaProtocolEnrichedDetail(slug) {
  const raw = await rwaFetchJSON(`${DEFI_LLAMA_BASE}/protocol/${slug}`)
  let tvlHistory = []
  if (Array.isArray(raw.tvl)) {
    tvlHistory = raw.tvl
      .map((p) => ({ date: p.date * 1000, tvl: p.totalLiquidityUSD }))
      .filter((p) => p.tvl > 0)
  } else if (raw.chainTvls) {
    const firstKey = Object.keys(raw.chainTvls).find((k) => Array.isArray(raw.chainTvls[k]?.tvl))
    if (firstKey) {
      tvlHistory = raw.chainTvls[firstKey].tvl
        .map((p) => ({ date: p.date * 1000, tvl: p.totalLiquidityUSD }))
        .filter((p) => p.tvl > 0)
    }
  }
  const chainBreakdown = Object.entries(raw.currentChainTvls || {})
    .map(([chain, tvl]) => ({ chain, tvl }))
    .sort((a, b) => b.tvl - a.tvl)
  const currentTvl =
    typeof raw.tvl === 'number'
      ? raw.tvl
      : tvlHistory.length
        ? tvlHistory[tvlHistory.length - 1].tvl
        : 0

  return {
    name: raw.name,
    symbol: raw.symbol,
    logo: raw.logo,
    url: raw.url,
    twitter: raw.twitter,
    description: raw.description || null,
    category: raw.category,
    chains: raw.chains || [],
    currentTvl,
    change_1d: raw.change_1d,
    change_7d: raw.change_7d,
    change_30d: raw.change_30d,
    tvlHistory,
    chainBreakdown,
    // Seeded metadata fields not available on Vercel (lives only in packages/server/data).
    issuer: null,
    fullName: null,
    apy_30d: null,
    investors: null,
    redemption: null,
    min_investment: null,
    mgmt_fee: null,
    inception: null,
    eligibility: null,
    jurisdiction: null,
    auditor: null,
  }
}

// Analysis endpoints — proxy to the Express backend with 202 passthrough.
// spectreProxy collapses non-200 to errors, so we do a direct fetch here to
// preserve the 202 cache-miss signal the frontend relies on.
async function passthroughAnalysis(path, ttlMs) {
  const cacheKey = `sp:${path}`
  const cached = getCached(cacheKey, ttlMs)
  if (cached) return { status: 200, body: cached, cached: true }
  const headers = { Accept: 'application/json' }
  if (API_KEY) headers['X-API-Key'] = API_KEY
  const r = await fetch(`${API_BASE}${path}`, { headers, signal: AbortSignal.timeout(15000) })
  const text = await r.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  if (r.status === 200 && body) setCache(cacheKey, body)
  return { status: r.status, body, cached: false }
}

// ── Signals + themes derivation (2026-08-14) ────────────────────────────────
// Port of packages/server/routes/rwa.js /signals + /themes — the box has no
// /v1/rwa/signals|themes route, so prod derives from the same sub-feeds dev
// uses. Keep the thresholds in sync with the dev twin.
function computeRwaAumChange7d(history) {
  const series = history?.series
  if (!Array.isArray(series) || series.length < 8) return null
  const cats = history?.categories || []
  if (!cats.length) return null
  const totalAt = (i) => cats.reduce((acc, c) => acc + (Number(series[i]?.[c]) || 0), 0)
  const last = totalAt(series.length - 1)
  const prev = totalAt(Math.max(0, series.length - 8))
  if (prev <= 0) return null
  return ((last - prev) / prev) * 100
}

function deriveRwaSignals({ breakdown, velocity, navWatch, concentration, history }) {
  const chips = []

  const velSeries = velocity?.series || []
  const latestVel = velSeries[velSeries.length - 1] || {}
  const grossIn = Number(latestVel.gross_inflow_usd) || 0
  const grossOut = Number(latestVel.gross_outflow_usd) || 0
  const flowRatio = grossOut > 0 ? grossIn / grossOut : (grossIn > 0 ? Infinity : 0)
  const inflowIssuers = Number(latestVel.issuers_with_inflow) || 0
  const outflowIssuers = Number(latestVel.issuers_with_outflow) || 0
  if (velSeries.length) {
    if (flowRatio > 2 && inflowIssuers >= outflowIssuers) {
      chips.push({ label: 'Smart Money Flowing', kind: 'up',
        evidence: `${inflowIssuers} issuers w/ net inflow · ratio ${flowRatio === Infinity ? '∞' : flowRatio.toFixed(1)}x` })
    } else if (flowRatio < 0.5 || outflowIssuers > inflowIssuers) {
      chips.push({ label: 'Smart Money Pausing', kind: 'dn', evidence: `${outflowIssuers} issuers w/ net outflow` })
    } else {
      chips.push({ label: 'Even Flows', kind: 'neutral', evidence: `inflow/outflow ratio ${flowRatio.toFixed(1)}x` })
    }
  }

  const navRows = navWatch?.issuers || navWatch?.rows || navWatch?.data || []
  const navList = Array.isArray(navRows) ? navRows : []
  if (navList.length) {
    const navAlerts = navList.filter((r) => Math.abs(Number(r.deviation_bps ?? r.dev_bps ?? r.nav_deviation_bps ?? 0)) >= 20).length
    if (navAlerts >= 3) chips.push({ label: 'Yield Opportunity', kind: 'up', evidence: `${navAlerts} NAV deviations >20bps` })
    else if (navAlerts === 0) chips.push({ label: 'Yield Compression', kind: 'dn', evidence: 'NAV stable across issuers' })
    else chips.push({ label: 'Stable Yields', kind: 'neutral', evidence: `${navAlerts} NAV deviations` })
  }

  const concRows = concentration?.issuers || concentration?.tokens || concentration?.rows || concentration?.data || []
  const concList = Array.isArray(concRows) ? concRows : []
  const topShare = Number(concList[0]?.share_pct ?? concList[0]?.aum_share ?? 0)
  if (topShare >= 40) chips.push({ label: 'Concentration Risk', kind: 'dn', evidence: `top issuer ${topShare.toFixed(0)}% share` })
  else if (topShare > 0 && topShare < 25) chips.push({ label: 'Liquidity Clusters', kind: 'up', evidence: `top issuer ${topShare.toFixed(0)}% — diversified` })

  const cats = breakdown?.categories || []
  const totalAum = cats.reduce((s, c) => s + (Number(c.aum_usd) || 0), 0)
  const ch7d = computeRwaAumChange7d(history)
  if (ch7d != null) {
    if (ch7d >= 2) chips.push({ label: 'High Conviction', kind: 'up', evidence: `+${ch7d.toFixed(1)}% AUM in 7d` })
    else if (ch7d <= -2) chips.push({ label: 'Outflow Pressure', kind: 'dn', evidence: `${ch7d.toFixed(1)}% AUM in 7d` })
    else chips.push({ label: 'Mixed Signals', kind: 'neutral', evidence: `${ch7d >= 0 ? '+' : ''}${ch7d.toFixed(1)}% AUM in 7d` })
  }

  const upCount = chips.filter((c) => c.kind === 'up').length
  const dnCount = chips.filter((c) => c.kind === 'dn').length
  const tone = upCount > dnCount ? 'up' : dnCount > upCount ? 'dn' : 'neutral'

  return {
    tone,
    chips,
    total_aum_usd: totalAum || null,
    change_7d_pct: ch7d,
    generated_at: new Date().toISOString(),
    sources: ['breakdown', 'velocity', 'nav-watch', 'concentration', 'breakdown-history'],
  }
}

function rwaThemeSubtitle(ch) {
  if (ch == null) return 'Flow data pending'
  if (ch >= 8) return 'Strong inflows, institutional demand'
  if (ch >= 2) return 'Steady accumulation, healthy bid'
  if (ch >= -2) return 'Range-bound, awaiting catalyst'
  if (ch >= -8) return 'Outflow pressure, watching support'
  return 'Sharp drawdown, defensive posture'
}

function deriveRwaThemes(breakdown, history) {
  const cats = breakdown?.categories || []
  const series = history?.series || []
  const histCats = history?.categories || []

  const themes = cats
    .map((c) => {
      const slug = c.slug || c.name
      let change7d = null
      if (histCats.length && series.length >= 8) {
        const histKey = histCats.find((hc) => hc.toLowerCase() === String(c.name || '').toLowerCase())
          || histCats.find((hc) => hc.toLowerCase().includes(slug?.toLowerCase() || '__'))
        if (histKey) {
          const prev = Number(series[series.length - 8]?.[histKey]) || 0
          const last = Number(series[series.length - 1]?.[histKey]) || 0
          if (prev > 0) change7d = ((last - prev) / prev) * 100
        }
      }
      return {
        slug,
        title: c.name || slug,
        aum_usd: Number(c.aum_usd) || 0,
        share_pct: Number(c.share_pct) || 0,
        change_7d_pct: change7d,
        sub: rwaThemeSubtitle(change7d),
      }
    })
    .filter((t) => t.aum_usd > 0)
    .sort((a, b) => {
      const ma = Math.abs(a.change_7d_pct ?? 0)
      const mb = Math.abs(b.change_7d_pct ?? 0)
      if (mb !== ma) return mb - ma
      return b.aum_usd - a.aum_usd
    })
    .slice(0, 6)

  return {
    themes,
    generated_at: new Date().toISOString(),
    sources: ['breakdown', 'breakdown-history'],
  }
}

async function handleRWA(req, res) {
  const route = req.query.sub || 'overview'
  const LOG = (msg) => console.log(`[RWA Vercel] ${msg}`)
  const ERR = (msg, err) => console.error(`[RWA Vercel] ${msg}:`, err?.message || err)

  try {
    // ── Bundle (page-load fan-in) ──────────────────────────────────────────
    // Returns the 9 endpoints that tokenized-assets fires on mount in one
    // response. Kills 30/min anonymous rate-limit pressure (9 calls → 1)
    // and lets the page paint as soon as the slowest internal call resolves.
    // Sub-fetches run in parallel; any individual failure becomes `null` in
    // the response so partial data still renders (vs whole bundle failing).
    if (route === 'bundle') {
      // Tiered fan-in. `core` = above-fold group (overview/protocols/
      // stablecoins/movers/breakdown/index); `history` = the 3 heavy 2-year
      // series (tvl-history forward-fill, stablecoin-history, remote
      // breakdown/history); `full` = legacy all-in-one for back-compat. The
      // client fires core + history in parallel so the page paints on core
      // without waiting on the history aggregation. MUST stay in sync with
      // the dev mirror at packages/server/routes/rwa.js.
      const tier = String(req.query.tier || 'full').toLowerCase()
      const range = String(req.query.range || '2y').toLowerCase()
      const key = tier === 'core' ? 'core' : tier === 'history' ? 'history' : 'full'
      const cacheKey = key === 'core' ? 'rwa:bundle:core'
        : key === 'history' ? `rwa:bundle:history:${range}`
        : 'rwa:bundle:v1'
      const cached = getCached(cacheKey, 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
        return res.status(200).json({ ...cached, meta: { ...(cached.meta || {}), cached: true } })
      }
      // Persistent (cross-cold-start, cross-region) KV cache for the two tiers
      // the page actually fetches. Prod serverless has no in-process warmer, so
      // a cold lambda or cold region would otherwise re-assemble the 8MB-DeFiLlama
      // + Spectre bundle (history ~11s). The warm-cache cron repopulates KV every
      // 5 min, so a cold lambda instead serves the prebuilt bundle from global KV
      // in ~50ms. Fail-open: any KV miss/error falls straight through to a live
      // assembly below, so correctness never depends on KV being up.
      const useKv = key === 'core' || key === 'history'
      if (useKv) {
        try {
          const kvHit = await getJsonWithTTL(cacheKey)
          if (kvHit) {
            setCache(cacheKey, kvHit)
            res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
            res.setHeader('CDN-Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
            return res.status(200).json({ ...kvHit, meta: { ...(kvHit.meta || {}), cached: true, kv: true } })
          }
        } catch { /* fall through to a live assembly */ }
      }
      const safe = async (label, fn) => {
        try { return await fn() }
        catch (err) { ERR(`bundle/${label}`, err); return null }
      }

      let payload
      if (key === 'core') {
        const [overview, protocols, stablecoins, movers, breakdown, index] = await Promise.all([
          safe('overview',    async () => shapeRwaOverview(await getRwaProtocolsCached())),
          safe('protocols',   async () => await getRwaProtocolsCached()),
          safe('stablecoins', async () => slimStablecoins(await buildRwaStablecoins())),
          safe('movers',      async () => shapeRwaMovers(await getRwaProtocolsCached())),
          // 4s upstream timeout — these block page paint; fail fast + serve stale.
          safe('breakdown',   async () => await spectreProxy(`/v1/rwa/breakdown`, 60_000, 4000)),
          safe('index',       async () => await spectreProxy(`/v1/rwa/index`, 60_000, 4000)),
        ])
        payload = {
          overview, protocols, stablecoins, movers, breakdown, index,
          meta: { cached: false, fetchedAt: new Date().toISOString(), ttlMs: 60_000, tier: 'core' },
        }
        LOG(`bundle/core: ${Array.isArray(protocols) ? protocols.length : 0} protocols, ${Array.isArray(stablecoins) ? stablecoins.length : 0} stables`)
      } else if (key === 'history') {
        const [tvlHistory, stablecoinHistory, breakdownHistory] = await Promise.all([
          safe('tvl-history',       async () => await buildRwaTvlHistory()),
          safe('stablecoin-history',async () => await buildRwaStablecoinHistory()),
          safe('breakdown-history', async () => await spectreProxy(`/v1/rwa/breakdown/history?range=${encodeURIComponent(range)}`, 60_000)),
        ])
        payload = {
          tvlHistory, stablecoinHistory, breakdownHistory,
          meta: { cached: false, fetchedAt: new Date().toISOString(), ttlMs: 60_000, tier: 'history' },
        }
        LOG(`bundle/history (range=${range})`)
      } else {
        const [
          overview, protocols, stablecoins, movers,
          tvlHistory, stablecoinHistory,
          breakdown, index, breakdownHistory,
        ] = await Promise.all([
          safe('overview',          async () => shapeRwaOverview(await getRwaProtocolsCached())),
          safe('protocols',         async () => await getRwaProtocolsCached()),
          safe('stablecoins',       async () => await buildRwaStablecoins()),
          safe('movers',            async () => shapeRwaMovers(await getRwaProtocolsCached())),
          safe('tvl-history',       async () => await buildRwaTvlHistory()),
          safe('stablecoin-history',async () => await buildRwaStablecoinHistory()),
          safe('breakdown',         async () => await spectreProxy(`/v1/rwa/breakdown`, 60_000, 4000)),
          safe('index',             async () => await spectreProxy(`/v1/rwa/index`, 60_000, 4000)),
          safe('breakdown-history', async () => await spectreProxy(`/v1/rwa/breakdown/history?range=${encodeURIComponent(range)}`, 60_000)),
        ])
        payload = {
          overview, protocols, stablecoins, movers,
          tvlHistory, stablecoinHistory,
          breakdown, index, breakdownHistory,
          meta: { cached: false, fetchedAt: new Date().toISOString(), ttlMs: 60_000 },
        }
        LOG(`bundle: ${Array.isArray(protocols) ? protocols.length : 0} protocols, ${Array.isArray(stablecoins) ? stablecoins.length : 0} stables`)
      }
      setCache(cacheKey, payload)
      if (useKv) {
        // Persist for cold lambdas / cold regions (30-min TTL; the cron refreshes
        // every 5 min so it stays fresh, and RWA series are daily so 30-min stale
        // is invisible). Fire-and-forget — never block the response on the KV
        // write, never let a KV failure surface as a 500.
        setJsonWithTTL(cacheKey, payload, 1800).catch(() => {})
      }
      // RWA aggregates move slowly (daily series); 5-min CDN cache + 15-min SWR
      // keeps prod (serverless, no warmer) off the cold 8MB-protocols + Spectre
      // assembly. The /api/cron/warm-cache job (every 5 min) re-touches these
      // URLs so the edge stays warm and users never pay the cold path; SWR=900
      // covers any missed warm by serving stale instantly while revalidating.
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
      return res.status(200).json(payload)
    }

    // ── Bundle-risk (Risk & Alpha tab fan-in) ─────────────────────────────
    // Same shape as /bundle but for Phase 7+8 endpoints (nav-watch,
    // concentration-leaderboard, velocity, events, composability/graph,
    // yield-curve). 6 upstream calls → 1 client fetch. Poll cadence stays
    // 90s for the page (yield-curve is cached 60min upstream so re-hits
    // are free).
    if (route === 'bundle-risk') {
      const velocityRange = String(req.query.velocity_range || '30d').toLowerCase()
      const eventsLimit = Math.min(parseInt(req.query.events_limit || '20', 10) || 20, 100)
      const cacheKey = `rwa:bundle-risk:${velocityRange}:${eventsLimit}`
      const cached = getCached(cacheKey, 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        return res.status(200).json({ ...cached, meta: { ...(cached.meta || {}), cached: true } })
      }
      const safe = async (label, fn) => {
        try { return await fn() }
        catch (err) { ERR(`bundle-risk/${label}`, err); return null }
      }
      const [
        navWatch, concentrationLeaderboard, velocity, events,
        composabilityGraph, yieldCurve,
      ] = await Promise.all([
        safe('nav-watch',                 () => spectreProxy(`/v1/rwa/nav-watch`, 60_000)),
        safe('concentration-leaderboard', () => spectreProxy(`/v1/rwa/concentration-leaderboard`, 60_000)),
        safe('velocity',                  () => spectreProxy(`/v1/rwa/velocity?range=${encodeURIComponent(velocityRange)}`, 60_000)),
        safe('events',                    () => spectreProxy(`/v1/rwa/events?limit=${eventsLimit}`, 15_000)),
        safe('composability-graph',       () => spectreProxy(`/v1/rwa/composability/graph`, 5 * 60_000)),
        safe('yield-curve',               () => spectreProxy(`/v1/rwa/yield-curve`, 60_000)),
      ])
      const payload = {
        navWatch, concentrationLeaderboard, velocity, events,
        composabilityGraph, yieldCurve,
        meta: { cached: false, fetchedAt: new Date().toISOString(), ttlMs: 60_000 },
      }
      setCache(cacheKey, payload)
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      LOG(`bundle-risk: nav=${navWatch ? 'ok' : 'fail'} conc=${concentrationLeaderboard ? 'ok' : 'fail'} vel=${velocity ? 'ok' : 'fail'} ev=${events ? 'ok' : 'fail'} graph=${composabilityGraph ? 'ok' : 'fail'} yc=${yieldCurve ? 'ok' : 'fail'}`)
      return res.status(200).json(payload)
    }

    // ── Stablecoins summary (Phase 4 — separate from RWA mcap) ─────────────
    if (route === 'stablecoins-summary') {
      const cacheKey = `rwa:stablecoins-summary`
      const cached = getCached(cacheKey, 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('Vary', 'Accept-Encoding')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy(`/v1/rwa/stablecoins-summary`, 60_000)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        LOG(`stablecoins-summary: pass-through to Spectre Data API`)
        return res.status(200).json(data)
      } catch (err) {
        ERR('stablecoins-summary', err)
        return res.status(502).json({ error: 'Failed to fetch stablecoins summary' })
      }
    }

    // ── Issuer-Direct (Phase 1) — pass-through to Spectre Data API ─────────
    if (route === 'breakdown' || route === 'issuers') {
      const cacheKey = `rwa:issuer-direct:${route}`
      const cached = getCached(cacheKey, 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('Vary', 'Accept-Encoding')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy(`/v1/rwa/${route}`, 60_000)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        LOG(`${route}: pass-through to Spectre Data API`)
        return res.status(200).json(data)
      } catch (err) {
        ERR(route, err)
        return res.status(502).json({ error: `Failed to fetch RWA ${route}` })
      }
    }

    // ── Phase 2: history endpoints ─────────────────────────────────────────
    if (route === 'breakdown/history') {
      const range = String(req.query.range || '1y').toLowerCase()
      const cacheKey = `rwa:breakdown-history:${range}`
      const cached = getCached(cacheKey, 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('Vary', 'Accept-Encoding')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy(
          `/v1/rwa/breakdown/history?range=${encodeURIComponent(range)}`,
          60_000
        )
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        LOG(`breakdown/history (${range}): pass-through to Spectre Data API`)
        return res.status(200).json(data)
      } catch (err) {
        ERR('breakdown/history', err)
        return res.status(502).json({ error: 'Failed to fetch RWA breakdown history' })
      }
    }

    if (typeof route === 'string' && route.startsWith('issuer/')) {
      const slug = route.slice('issuer/'.length)
      if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
        return res.status(400).json({ error: 'Invalid slug' })
      }
      const cacheKey = `rwa:issuer:${slug}`
      const cached = getCached(cacheKey, 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('Vary', 'Accept-Encoding')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy(`/v1/rwa/issuer/${encodeURIComponent(slug)}`, 60_000)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        LOG(`issuer/${slug}: pass-through to Spectre Data API`)
        return res.status(200).json(data)
      } catch (err) {
        ERR(`issuer/${slug}`, err)
        return res.status(502).json({ error: 'Failed to fetch RWA issuer' })
      }
    }

    // ── Phase 6: Spectre RWA Index (SRWAI) pass-throughs ───────────────────
    if (
      route === 'index' ||
      route === 'index/composition' ||
      route === 'index/methodology' ||
      route === 'index/history'
    ) {
      const range = route === 'index/history' ? String(req.query.range || '1y').toLowerCase() : ''
      const cacheKey = route === 'index/history' ? `rwa:${route}:${range}` : `rwa:${route}`
      const ttl = route === 'index/methodology' ? 86_400_000 : 60_000
      const cached = getCached(cacheKey, ttl)
      if (cached) {
        res.setHeader('Cache-Control', `public, s-maxage=${route === 'index/methodology' ? 86400 : 60}, stale-while-revalidate=120`)
        return res.status(200).json(cached)
      }
      try {
        const upstream = route === 'index/history'
          ? `/v1/rwa/index/history?range=${encodeURIComponent(range)}`
          : `/v1/rwa/${route}`
        const data = await spectreProxy(upstream, ttl)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', `public, s-maxage=${route === 'index/methodology' ? 86400 : 60}, stale-while-revalidate=120`)
        LOG(`${route}: pass-through to Spectre Data API`)
        return res.status(200).json(data)
      } catch (err) {
        ERR(route, err)
        return res.status(502).json({ error: `Failed to fetch RWA ${route}` })
      }
    }

    // ── Phase 7: flagship signals ─────────────────────────────────────────
    // nav-watch, concentration-leaderboard, velocity, events: catch-all
    // /api/rwa/:sub already routes them as route="<name>". Map and forward.
    if (route === 'nav-watch' || route === 'concentration-leaderboard') {
      const cacheKey = `rwa:${route}`
      const cached = getCached(cacheKey, 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('Vary', 'Accept-Encoding')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy(`/v1/rwa/${route}`, 60_000)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        LOG(`${route}: pass-through`)
        return res.status(200).json(data)
      } catch (err) {
        ERR(route, err)
        return res.status(502).json({ error: `Failed to fetch RWA ${route}` })
      }
    }

    if (route === 'velocity') {
      const range = String(req.query.range || '30d').toLowerCase()
      const cacheKey = `rwa:velocity:${range}`
      const cached = getCached(cacheKey, 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('Vary', 'Accept-Encoding')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy(`/v1/rwa/velocity?range=${encodeURIComponent(range)}`, 60_000)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        LOG(`velocity (${range}): pass-through`)
        return res.status(200).json(data)
      } catch (err) {
        ERR('velocity', err)
        return res.status(502).json({ error: 'Failed to fetch RWA velocity' })
      }
    }

    if (route === 'events') {
      const slug = req.query.slug ? String(req.query.slug) : ''
      const type = req.query.type ? String(req.query.type) : ''
      const since = req.query.since ? String(req.query.since) : ''
      const limit = String(req.query.limit || '50')
      const qs = new URLSearchParams()
      if (slug) qs.set('slug', slug)
      if (type) qs.set('type', type)
      if (since) qs.set('since', since)
      qs.set('limit', limit)
      const cacheKey = `rwa:events:${qs.toString()}`
      // Events feed is short-lived (live mint/burn) — 15s cache.
      const cached = getCached(cacheKey, 15_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy(`/v1/rwa/events?${qs.toString()}`, 15_000)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60')
        LOG(`events: pass-through`)
        return res.status(200).json(data)
      } catch (err) {
        ERR('events', err)
        return res.status(502).json({ error: 'Failed to fetch RWA events' })
      }
    }

    // credit-rating/:slug (route arrives via the explicit vercel.json rewrite)
    if (typeof route === 'string' && route.startsWith('credit-rating/')) {
      const slug = route.slice('credit-rating/'.length)
      if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
        return res.status(400).json({ error: 'Invalid slug' })
      }
      const cacheKey = `rwa:credit-rating:${slug}`
      const cached = getCached(cacheKey, 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('Vary', 'Accept-Encoding')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy(`/v1/rwa/credit-rating/${encodeURIComponent(slug)}`, 60_000)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        LOG(`credit-rating/${slug}: pass-through`)
        return res.status(200).json(data)
      } catch (err) {
        ERR(`credit-rating/${slug}`, err)
        return res.status(502).json({ error: 'Failed to fetch credit rating' })
      }
    }

    // issuer/:slug/chains (Phase 7 — cross-chain reconciliation)
    if (typeof route === 'string' && route.startsWith('issuer/') && route.endsWith('/chains')) {
      const slug = route.slice('issuer/'.length, -'/chains'.length)
      if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
        return res.status(400).json({ error: 'Invalid slug' })
      }
      const cacheKey = `rwa:chains:${slug}`
      const cached = getCached(cacheKey, 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('Vary', 'Accept-Encoding')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy(`/v1/rwa/issuer/${encodeURIComponent(slug)}/chains`, 60_000)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        LOG(`issuer/${slug}/chains: pass-through`)
        return res.status(200).json(data)
      } catch (err) {
        ERR(`issuer/${slug}/chains`, err)
        return res.status(502).json({ error: 'Failed to fetch chain breakdown' })
      }
    }

    // ── Phase 8: composability + yield-curve ──────────────────────────────
    // /api/rwa/yield-curve → sub="yield-curve" (single segment, hits catch-all rewrite)
    if (route === 'yield-curve') {
      const cacheKey = 'rwa:yield-curve'
      const cached = getCached(cacheKey, 60 * 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy('/v1/rwa/yield-curve', 60 * 60_000)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200')
        LOG('yield-curve: pass-through')
        return res.status(200).json(data)
      } catch (err) {
        ERR('yield-curve', err)
        return res.status(502).json({ error: 'Failed to fetch yield curve' })
      }
    }

    // /api/rwa/composability?slug=X → sub="composability"
    if (route === 'composability') {
      const slug = req.query.slug ? String(req.query.slug) : ''
      if (!slug || !/^[a-z0-9_-]+$/i.test(slug)) {
        return res.status(400).json({ error: 'Invalid or missing slug' })
      }
      const cacheKey = `rwa:composability:${slug}`
      const cached = getCached(cacheKey, 5 * 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
        res.setHeader('Vary', 'Accept-Encoding')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy(`/v1/rwa/composability?slug=${encodeURIComponent(slug)}`, 5 * 60_000)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
        LOG(`composability/${slug}: pass-through`)
        return res.status(200).json(data)
      } catch (err) {
        ERR(`composability/${slug}`, err)
        return res.status(502).json({ error: 'Failed to fetch composability' })
      }
    }

    // /api/rwa/composability/graph → sub="composability/graph" (multi-segment;
    // requires explicit vercel.json rewrite below).
    if (route === 'composability/graph') {
      const cacheKey = 'rwa:composability:graph'
      const cached = getCached(cacheKey, 5 * 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
        res.setHeader('Vary', 'Accept-Encoding')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy('/v1/rwa/composability/graph', 5 * 60_000)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
        LOG('composability/graph: pass-through')
        return res.status(200).json(data)
      } catch (err) {
        ERR('composability/graph', err)
        return res.status(502).json({ error: 'Failed to fetch composability graph' })
      }
    }

    // ── Phase 9: perma parity tracking ────────────────────────────────────
    // /api/rwa/parity → snapshot of Spectre vs DefiLlama vs RWA.xyz totals
    if (route === 'parity') {
      const cacheKey = 'rwa:parity'
      const cached = getCached(cacheKey, 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('Vary', 'Accept-Encoding')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy('/v1/rwa/parity', 60_000)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        LOG('parity: pass-through')
        return res.status(200).json(data)
      } catch (err) {
        ERR('parity', err)
        return res.status(502).json({ error: 'Failed to fetch parity snapshot' })
      }
    }

    // /api/rwa/parity/history?range=1d|7d|30d → time-series of parity drift
    if (route === 'parity/history') {
      const range = String(req.query.range || '7d').toLowerCase()
      if (!/^[a-z0-9]+$/i.test(range)) {
        return res.status(400).json({ error: 'Invalid range' })
      }
      const cacheKey = `rwa:parity:history:${range}`
      const cached = getCached(cacheKey, 5 * 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
        res.setHeader('Vary', 'Accept-Encoding')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy(`/v1/rwa/parity/history?range=${encodeURIComponent(range)}`, 5 * 60_000)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
        LOG(`parity/history range=${range}: pass-through`)
        return res.status(200).json(data)
      } catch (err) {
        ERR('parity/history', err)
        return res.status(502).json({ error: 'Failed to fetch parity history' })
      }
    }

    // /api/rwa/discovery-candidates?status=new|approved|rejected → audit queue
    if (route === 'discovery-candidates') {
      const status = String(req.query.status || 'new').toLowerCase()
      const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100))
      if (!/^[a-z]+$/i.test(status)) {
        return res.status(400).json({ error: 'Invalid status' })
      }
      const cacheKey = `rwa:discovery:${status}:${limit}`
      const cached = getCached(cacheKey, 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('Vary', 'Accept-Encoding')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy(`/v1/rwa/discovery-candidates?status=${encodeURIComponent(status)}&limit=${limit}`, 60_000)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        LOG(`discovery-candidates status=${status}: pass-through`)
        return res.status(200).json(data)
      } catch (err) {
        ERR('discovery-candidates', err)
        return res.status(502).json({ error: 'Failed to fetch discovery candidates' })
      }
    }

    // /api/rwa/coverage-report → per-category Spectre vs DefiLlama diff
    if (route === 'coverage-report') {
      const cacheKey = 'rwa:coverage-report'
      const cached = getCached(cacheKey, 5 * 60_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
        res.setHeader('Vary', 'Accept-Encoding')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy('/v1/rwa/coverage-report', 5 * 60_000)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
        LOG('coverage-report: pass-through')
        return res.status(200).json(data)
      } catch (err) {
        ERR('coverage-report', err)
        return res.status(502).json({ error: 'Failed to fetch coverage report' })
      }
    }

    // /api/rwa/alerts?severity=info|warn|alarm&since=ISO → drift/disappear log
    if (route === 'alerts') {
      const severity = String(req.query.severity || 'warn').toLowerCase()
      const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100))
      if (!/^(info|warn|alarm|all)$/i.test(severity)) {
        return res.status(400).json({ error: 'Invalid severity' })
      }
      const since = req.query.since ? `&since=${encodeURIComponent(String(req.query.since))}` : ''
      const cacheKey = `rwa:alerts:${severity}:${limit}:${since}`
      const cached = getCached(cacheKey, 30_000)
      if (cached) {
        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
        return res.status(200).json(cached)
      }
      try {
        const data = await spectreProxy(`/v1/rwa/alerts?severity=${encodeURIComponent(severity)}&limit=${limit}${since}`, 30_000)
        setCache(cacheKey, data)
        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
        LOG(`alerts severity=${severity}: pass-through`)
        return res.status(200).json(data)
      } catch (err) {
        ERR('alerts', err)
        return res.status(502).json({ error: 'Failed to fetch alerts' })
      }
    }

    // Analysis endpoints come in as sub="analysis/:topic" or sub="analysis/protocol/:slug".
    if (typeof route === 'string' && route.startsWith('analysis/')) {
      const rest = route.slice('analysis/'.length)
      let upstreamPath
      if (rest.startsWith('protocol/')) {
        const slug = rest.slice('protocol/'.length)
        if (!slug) return res.status(400).json({ error: 'Missing slug' })
        upstreamPath = `/v1/rwa/analysis/protocol/${encodeURIComponent(slug)}`
      } else {
        const topic = rest
        if (!topic) return res.status(400).json({ error: 'Missing topic' })
        upstreamPath = `/v1/rwa/analysis/${encodeURIComponent(topic)}`
      }
      try {
        const { status, body, cached } = await passthroughAnalysis(upstreamPath, RWA_TTL.analysis)
        LOG(`analysis ${upstreamPath} → ${status}${cached ? ' (cached)' : ''}`)
        return res.status(status).json(body ?? { error: `Upstream ${status}` })
      } catch (err) {
        ERR(`analysis ${upstreamPath}`, err)
        return res.status(502).json({ error: 'Analysis backend unavailable' })
      }
    }

    if (route === 'overview') {
      try {
        const protocols = await getRwaProtocolsCached()
        const data = shapeRwaOverview(protocols)
        LOG(`overview: ${data.totalProtocols} protocols, ${data.totalChains} chains`)
        return res.status(200).json(data)
      } catch (err) {
        ERR('overview', err)
        return res.status(500).json({ error: 'Failed to fetch RWA overview' })
      }
    }

    if (route === 'protocols') {
      try {
        const protocols = await getRwaProtocolsCached()
        LOG(`protocols: ${protocols.length}`)
        return res.status(200).json(protocols)
      } catch (err) {
        ERR('protocols', err)
        return res.status(500).json({ error: 'Failed to fetch RWA protocols' })
      }
    }

    if (route === 'chains') {
      try {
        const protocols = await getRwaProtocolsCached()
        const data = shapeRwaChains(protocols)
        LOG(`chains: ${data.length}`)
        return res.status(200).json(data)
      } catch (err) {
        ERR('chains', err)
        return res.status(500).json({ error: 'Failed to fetch RWA chain data' })
      }
    }

    if (route === 'movers') {
      const cacheKey = 'rwa:movers'
      const cached = getCached(cacheKey, RWA_TTL.protocols)
      if (cached) {
        return res.status(200).json({
          ...cached,
          meta: { cached: true, fetchedAt: new Date(_cache[cacheKey].ts).toISOString(), ttlMs: RWA_TTL.protocols },
        })
      }
      try {
        const protocols = await getRwaProtocolsCached()
        const data = shapeRwaMovers(protocols)
        setCache(cacheKey, data)
        LOG(`movers: ${data.gainers.length} gainers / ${data.losers.length} losers`)
        return res.status(200).json({
          ...data,
          meta: { cached: false, fetchedAt: new Date().toISOString(), ttlMs: RWA_TTL.protocols },
        })
      } catch (err) {
        ERR('movers', err)
        return res.status(500).json({ error: 'Failed to fetch RWA movers' })
      }
    }

    if (route === 'stablecoins') {
      const cacheKey = 'rwa:stablecoins'
      const cached = getCached(cacheKey, RWA_TTL.protocols)
      if (cached) return res.status(200).json(cached)
      try {
        const data = await buildRwaStablecoins()
        setCache(cacheKey, data)
        LOG(`stablecoins: ${data.length}`)
        return res.status(200).json(data)
      } catch (err) {
        ERR('stablecoins', err)
        return res.status(500).json({ error: 'Failed to fetch stablecoins' })
      }
    }

    if (route === 'stablecoin-history') {
      const cacheKey = 'rwa:stablecoin-history'
      const cached = getCached(cacheKey, RWA_TTL.history)
      if (cached) return res.status(200).json(cached)
      try {
        const data = await buildRwaStablecoinHistory()
        setCache(cacheKey, data)
        LOG(`stablecoin-history: ${data.coins.length} coins, ${data.series.length} points`)
        return res.status(200).json(data)
      } catch (err) {
        ERR('stablecoin-history', err)
        return res.status(500).json({ error: 'Failed to fetch stablecoin history' })
      }
    }

    if (route === 'tvl-history') {
      const cacheKey = 'rwa:tvl-history'
      const cached = getCached(cacheKey, RWA_TTL.history)
      if (cached) return res.status(200).json(cached)
      try {
        const data = await buildRwaTvlHistory()
        setCache(cacheKey, data)
        LOG(`tvl-history: ${data.series.length} points, ${data.protocolCount} protocols`)
        return res.status(200).json(data)
      } catch (err) {
        ERR('tvl-history', err)
        return res.status(500).json({ error: 'Failed to build TVL history' })
      }
    }

    // stablecoin-charts/:id — single stablecoin chart passthrough (raw DeFiLlama shape).
    if (route === 'stablecoin-charts') {
      const id = req.query.id || ''
      if (!id) return res.status(400).json({ error: 'Missing id' })
      const cacheKey = `rwa:sc-chart:${id}`
      const cached = getCached(cacheKey, RWA_TTL.history)
      if (cached) return res.status(200).json(cached)
      try {
        const data = await rwaFetchJSON(`${STABLECOINS_BASE}/stablecoincharts/all?stablecoin=${id}`)
        setCache(cacheKey, data)
        LOG(`stablecoin-charts/${id}`)
        return res.status(200).json(data)
      } catch (err) {
        ERR(`stablecoin-charts/${id}`, err)
        return res.status(500).json({ error: 'Failed to fetch stablecoin chart data' })
      }
    }

    // protocol/:slug — basic protocol detail (plain DeFiLlama-shaped result).
    if (route === 'protocol') {
      const slug = req.query.slug || ''
      if (!slug) return res.status(400).json({ error: 'Missing slug' })
      const cacheKey = `rwa:proto-basic:${slug}`
      const cached = getCached(cacheKey, RWA_TTL.protocolDetail)
      if (cached) return res.status(200).json(cached)
      try {
        const raw = await rwaFetchJSON(`${DEFI_LLAMA_BASE}/protocol/${slug}`)
        const result = {
          name: raw.name,
          tvl: raw.tvl || 0,
          chains: raw.chains || [],
          chainTvls: raw.chainTvls || {},
          tvlHistory: Array.isArray(raw.tvl) ? raw.tvl : [],
        }
        if (Array.isArray(raw.tvl)) {
          result.tvlHistory = raw.tvl
          result.tvl = raw.tvl.length > 0 ? raw.tvl[raw.tvl.length - 1].totalLiquidityUSD : 0
        } else if (raw.chainTvls) {
          const firstKey = Object.keys(raw.chainTvls).find((k) => Array.isArray(raw.chainTvls[k]?.tvl))
          if (firstKey) result.tvlHistory = raw.chainTvls[firstKey].tvl
        }
        setCache(cacheKey, result)
        LOG(`protocol/${slug}`)
        return res.status(200).json(result)
      } catch (err) {
        ERR(`protocol/${slug}`, err)
        return res.status(500).json({ error: 'Failed to fetch protocol detail' })
      }
    }

    // protocol-detail — enriched detail (wired via vercel.json line 108).
    if (route === 'protocol-detail') {
      const slug = req.query.slug || ''
      if (!slug) return res.status(400).json({ error: 'Missing slug' })
      const cacheKey = `rwa:proto-detail:${slug}`
      const cached = getCached(cacheKey, RWA_TTL.protocolDetail)
      if (cached) {
        return res.status(200).json({
          ...cached,
          meta: { cached: true, fetchedAt: new Date(_cache[cacheKey].ts).toISOString() },
        })
      }
      try {
        const result = await buildRwaProtocolEnrichedDetail(slug)
        setCache(cacheKey, result)
        LOG(`protocol-detail/${slug}`)
        return res.status(200).json({
          ...result,
          meta: { cached: false, fetchedAt: new Date().toISOString() },
        })
      } catch (err) {
        ERR(`protocol-detail/${slug}`, err)
        return res.status(500).json({ error: 'Failed to fetch protocol detail' })
      }
    }

    // search?q=...
    if (route === 'search') {
      const q = ((req.query.q || '') + '').trim().toLowerCase()
      if (q.length < 2) return res.status(200).json([])
      try {
        const protocols = await getRwaProtocolsCached()
        const scored = protocols
          .map((p) => {
            const name = (p.name || '').toLowerCase()
            const symbol = (p.symbol || '').toLowerCase()
            let score = 0
            if (name === q || symbol === q) score = 100
            else if (name.startsWith(q) || symbol.startsWith(q)) score = 80
            else if (name.includes(q) || symbol.includes(q)) score = 60
            else return null
            score += Math.min(p.tvl / 1e9, 10)
            return { ...p, _score: score }
          })
          .filter(Boolean)
          .sort((a, b) => b._score - a._score)
          .slice(0, 10)
          .map(({ _score, ...p }) => p)
        return res.status(200).json(scored)
      } catch (err) {
        ERR('search', err)
        return res.status(200).json([])
      }
    }

    // Audit 2026-06-03: useRwaData.js fires /api/rwa/signals + /api/rwa/themes
    // on every Tokenized Assets mount. Neither had a branch here -> 400 every
    // minute (30+/hr noise + frontend timeout). Try Hetzner first, fall back
    // to graceful empty so the page renders.
    // 2026-08-14: /signals and /themes used to pass through to the box's
    // /v1/rwa/signals|themes — which never existed there (a generic keyword
    // route answered `{data:[],count:0}`), so prod always fell back to the
    // client's STATIC chip/theme lists. Derive them here from the box's real
    // sub-feeds instead, mirroring the dev derivation in
    // packages/server/routes/rwa.js (/signals + /themes) — keep the two in sync.
    if (route === 'signals' || route === 'themes') {
      const cacheKey = `rwa:${route}:derived`
      const cached = getCached(cacheKey, 300_000)
      const sendOk = (data) => {
        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
        res.setHeader('Vary', 'Accept-Encoding')
        return res.status(200).json(data)
      }
      if (cached) return sendOk(cached)
      try {
        const unwrap = (r) => r?.data || r
        const safeBox = (path, ttl, timeout) =>
          spectreProxy(path, ttl, timeout).then(unwrap).catch(() => null)
        if (route === 'themes') {
          const [breakdown, history] = await Promise.all([
            safeBox('/v1/rwa/breakdown', 300_000, 8000),
            safeBox('/v1/rwa/breakdown/history?range=30d', 1_800_000, 20000),
          ])
          const data = deriveRwaThemes(breakdown, history)
          setCache(cacheKey, data)
          return sendOk(data)
        }
        const [breakdown, velocity, navWatch, concentration, history] = await Promise.all([
          safeBox('/v1/rwa/breakdown', 300_000, 8000),
          safeBox('/v1/rwa/velocity?range=30d', 300_000, 8000),
          safeBox('/v1/rwa/nav-watch', 300_000, 8000),
          safeBox('/v1/rwa/concentration-leaderboard', 300_000, 8000),
          safeBox('/v1/rwa/breakdown/history?range=30d', 1_800_000, 20000),
        ])
        const data = deriveRwaSignals({ breakdown, velocity, navWatch, concentration, history })
        setCache(cacheKey, data)
        return sendOk(data)
      } catch (err) {
        ERR(`${route} derivation`, err)
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.setHeader('Vary', 'Accept-Encoding')
        return res.status(200).json({ items: [], status: 'unavailable' })
      }
    }

    return res.status(400).json({ error: `Unknown RWA route: ${route}` })
  } catch (err) {
    ERR('handleRWA outer', err)
    return res.status(500).json({ error: 'RWA handler error' })
  }
}

// ── Token resolve ───────────────────────────────────────────────────────────
// CG platform slug → Codex network id, in chart-stack preference order.
// Mirrors src/services/spectreMarketApi.js — keep the two lists in sync.
// Platform map + contractFromPlatforms moved to the ONE shared module
// (../cg-platforms.js, 2026-08-25) — the inline copy here was one of five
// divergent maps, all missing chains the app lists (HyperEVM/Sui/Sonic →
// chartless identities, the "M"/HYPE class).

async function handleTokenResolve(req, res) {
  const raw = String(req.query.symbol || '').trim()
  if (!raw) return res.status(400).json({ error: 'Missing symbol' })

  const symbol = assetSymbol(raw)
  const qs = new URLSearchParams({ q: raw, limit: '8' })

  try {
    const payload = await spectreProxy(`/v1/search?${qs}`, 15_000)
    const coins = Array.isArray(payload?.data?.coins) ? payload.data.coins : []
    const match = pickSearchCoin(raw, coins)
    if (match) {
      // Contract enrichment (audit 2026-06-10): every chart tier for non-CEX
      // tokens is address-keyed, but this handler hardcoded address:null and
      // starved the whole chart pipeline. /v1/coins/{id} carries CG
      // `platforms` — one cached profile fetch makes the identity chart-ready.
      const cgId = match.coingecko_id || match.id || null
      let contract = null
      if (cgId) {
        const ck = `resolve-contract:${cgId}`
        const cached = getCached(ck, 600_000)
        if (cached !== null) {
          contract = cached || null
        } else {
          try {
            const profile = await spectreProxy(`/v1/coins/${encodeURIComponent(cgId)}`, 10_000)
            contract = contractFromPlatforms(profile)
          } catch { contract = null }
          // Box profiles routinely ship `platforms: {}` even when CoinGecko
          // itself holds the verified contract (data-lane identity gap —
          // memecore/"M", most of the long tail). An address-less identity
          // means NO Candles / self-hosted TradingView downstream, so ask CG
          // directly before caching a negative.
          if (!contract) {
            try {
              const cgCoin = await cgFetch(`/coins/${encodeURIComponent(cgId)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`)
              contract = contractFromPlatforms(cgCoin)
            } catch { /* keep null */ }
          }
          // Cache negatives as false so misses don't refetch every call.
          setCache(ck, contract || false)
        }
      }
      // Token identity is near-static — let the CDN share one resolve across
      // every cold visitor of this symbol for 10min (was uncached, so each cold
      // serverless invocation re-paid the /v1/search + /v1/coins/{id} hops).
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1200')
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1200')
      return res.status(200).json({
        symbol: assetSymbol(match.symbol || symbol),
        name: match.name || symbol,
        cgId,
        // Validated against the canonical registry — fabricated `${sym}USDT`
        // pairs sent the chart to a dead Binance tier for every non-CEX token
        // (audit 2026-06-10, task #22).
        binancePair: lookupBinancePair(assetSymbol(match.symbol || symbol), cgId),
        address: contract?.address || null,
        networkId: contract?.networkId || null,
        logo: match.image || null,
        rank: toNumberOrNull(match.rank ?? match.market_cap_rank),
        categories: null,
      })
    }
  } catch {
    // Fall through to a minimal identity response.
  }

  // Minimal-identity fallback (no search match, or upstream errored). Keep the
  // edge cache SHORT here so a transient upstream failure self-heals fast
  // instead of pinning a degraded identity for 10min.
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
  res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
  return res.status(200).json({
    symbol,
    name: symbol,
    cgId: null,
    binancePair: lookupBinancePair(symbol),
    address: null,
    networkId: null,
    logo: null,
    rank: null,
    categories: null,
  })
}

// ── Binance klines ──────────────────────────────────────────────────────────
async function handleBinanceKlines(req, res) {
  const symbol = req.query.symbol || 'BTCUSDT'
  const interval = req.query.interval || '1h'
  const limit = Math.min(parseInt(req.query.limit) || 100, 1000)
  // 2026-05-28: TradingView chart adapter (src/chart/adapters/binanceAdapter.js)
  // passes startTime + endTime for historical OHLCV pagination. Forward them
  // through. When neither is set, the original simple-latest-N path runs.
  const startTime = Number.isFinite(parseInt(req.query.startTime)) ? parseInt(req.query.startTime) : null
  const endTime = Number.isFinite(parseInt(req.query.endTime)) ? parseInt(req.query.endTime) : null
  // Skip cache when a specific time range is requested — each pagination
  // cursor is a unique window and caching them blows the in-memory map.
  const cacheable = startTime == null && endTime == null
  const cacheKey = `bk:${symbol}:${interval}:${limit}`
  if (cacheable) {
    const cached = getCached(cacheKey, 15_000)
    if (cached) return res.status(200).json(cached)
  }
  let url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`
  if (startTime != null) url += `&startTime=${startTime}`
  if (endTime != null) url += `&endTime=${endTime}`

  // Direct Binance call. Returns 451 from Vercel IP ranges (same Geo block
  // that binance-ticker.js handles with the triple fallback). Bounded so a
  // hang doesn't tie up the lambda for the full 10s before the fallback.
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4_000) })
    if (r.ok) {
      const data = await r.json()
      if (cacheable) setCache(cacheKey, data)
      res.setHeader('Cache-Control', cacheable ? 'public, s-maxage=15' : 'public, s-maxage=60')
      return res.status(200).json(data)
    }
    console.error(`[binance-klines] direct failed: ${r.status} ${symbol} ${interval}`)
  } catch (err) {
    console.error('[binance-klines] direct error:', err.message)
  }

  // Fallback: allorigins CORS proxy (same as binance-ticker.js). This is the
  // path that actually works for prod since Vercel IPs are blocked direct.
  // Without it, every Traders Corner chart shows "No data for this timeframe".
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(6_000) })
    if (r.ok) {
      const data = await r.json()
      if (cacheable) setCache(cacheKey, data)
      res.setHeader('Cache-Control', cacheable ? 'public, s-maxage=15' : 'public, s-maxage=60')
      return res.status(200).json(data)
    }
    console.error(`[binance-klines] allorigins failed: ${r.status}`)
  } catch (err) {
    console.error('[binance-klines] allorigins error:', err.message)
  }

  if (cacheable) {
    const stale = _cache[cacheKey]
    if (stale) return res.status(200).json(stale.data)
  }
  return res.status(502).json({ error: 'Binance unavailable' })
}

// ── Solana balance ──────────────────────────────────────────────────────────
async function handleSolanaBalance(req, res) {
  const address = req.query.address || ''
  if (!address) return res.status(400).json({ error: 'Missing address' })
  try {
    const r = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await r.json()
    const lamports = data.result?.value || 0
    return res.status(200).json({ address, lamports, sol: lamports / 1e9 })
  } catch {
    return res.status(200).json({ address, lamports: 0, sol: 0 })
  }
}

// ── Hero article ────────────────────────────────────────────────────────────
async function handleHero(req, res) {
  // Deterministic curated-Unsplash redirect. Lives in its own module so the
  // CDN tables and bundled intelligence-data lookup stay self-contained.
  const mod = await import('./hero-image.js')
  return mod.default(req, res)
}

// ── Monarch chat (needs Anthropic API) ──────────────────────────────────────
async function handleMonarchChat(req, res) {
  // Monarch chat now lives at /api/monarch-api?fn=chat (rewritten from /api/monarch/chat).
  // This stub remains only as a safety net in case a stale rewrite still points here.
  return res.status(410).json({
    error: 'Gone',
    message: 'Monarch chat moved to /api/monarch/chat (handled by api/monarch-api.js).',
  })
}

// ── Search query (SSE search engine) ────────────────────────────────────────
// Full SSE search-engine pipeline lives in its own module so the file stays
// readable. Lazy import keeps the cold-start cost off non-search routes.
async function handleSearchQuery(req, res) {
  const mod = await import('./search-engine-query.js')
  return mod.default(req, res)
}

// ── Market liquidations (from Express in-memory buffer) ─────────────────────
// ── DeFi Llama raw passthroughs (2026-05-28 hide-apis-phase1) ──────────────
// Used by the zigchain comparison page (src/pages/zigchain/hooks/useZigComparison.js)
// to pull each protocol's raw TVL shape (`currentChainTvls`, `tvl` array) and the
// /v2/chains list. The existing RWA `route=protocol` returns a RESHAPED object
// (tvl-as-number, no currentChainTvls) so the zigchain parser can't reuse it.
// These two routes are intentionally raw passthroughs: same response shape as
// api.llama.fi/protocol/:slug and api.llama.fi/v2/chains, just same-origin so
// they don't appear in the browser's CSP connect-src or Network tab.
// Cached server-side for 60s — llama's TVL data updates roughly every minute
// and the zigchain page polls slowly.
async function handleLlamaProtocolPassthrough(req, res) {
  const slug = String(req.query.slug || '').trim()
  if (!slug || !/^[A-Za-z0-9._-]{1,80}$/.test(slug)) {
    return res.status(400).json({ error: 'Missing or invalid slug' })
  }
  const cacheKey = `llama:proto:${slug}`
  const cached = getCached(cacheKey, 60_000)
  if (cached) return res.status(200).json(cached)
  try {
    const r = await fetch(`${DEFI_LLAMA_BASE}/protocol/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) return res.status(r.status).json({ error: `Llama ${r.status}` })
    const data = await r.json()
    setCache(cacheKey, data)
    return res.status(200).json(data)
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch llama protocol' })
  }
}

async function handleLlamaChainsPassthrough(req, res) {
  const cacheKey = 'llama:chains:v2'
  const cached = getCached(cacheKey, 60_000)
  if (cached) return res.status(200).json(cached)
  try {
    const r = await fetch(`${DEFI_LLAMA_BASE}/v2/chains`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) return res.status(r.status).json({ error: `Llama ${r.status}` })
    const data = await r.json()
    setCache(cacheKey, data)
    return res.status(200).json(data)
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch llama chains' })
  }
}

// /lite/charts/:chain — combined TVL series + the liquid-staking / double-
// counted / borrowed buckets DefiLlama stacks. Used by the zigchain TVL
// history hook (src/pages/zigchain/hooks/useZIGTvlHistory.js).
//
// Edge cache: s-maxage=60, swr=300. Vercel's edge serves the response from
// the POP nearest the user for 60s, then continues to serve stale for up to
// 5min while it revalidates in the background. Means the first cold load
// for a user only pays the upstream latency once per minute globally, not
// once per Vercel function instance per user.
const TVL_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300'
async function handleLlamaLiteChartsPassthrough(req, res) {
  const chain = String(req.query.chain || '').trim()
  if (!chain || !/^[A-Za-z0-9._-]{1,40}$/.test(chain)) {
    return res.status(400).json({ error: 'Missing or invalid chain' })
  }
  const cacheKey = `llama:lite-charts:${chain}`
  const cached = getCached(cacheKey, 60_000)
  if (cached) {
    res.setHeader('Cache-Control', TVL_CACHE_CONTROL)
    return res.status(200).json(cached)
  }
  try {
    const r = await fetch(`${DEFI_LLAMA_BASE}/lite/charts/${encodeURIComponent(chain)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!r.ok) return res.status(r.status).json({ error: `Llama ${r.status}` })
    const data = await r.json()
    setCache(cacheKey, data)
    res.setHeader('Cache-Control', TVL_CACHE_CONTROL)
    return res.status(200).json(data)
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch llama lite charts' })
  }
}

// /v2/historicalChainTvl/:chain — bare chain TVL history. Fallback path for
// the same zigchain TVL hook when /lite/charts is unavailable.
async function handleLlamaChainTvlHistoryPassthrough(req, res) {
  const chain = String(req.query.chain || '').trim()
  if (!chain || !/^[A-Za-z0-9._-]{1,40}$/.test(chain)) {
    return res.status(400).json({ error: 'Missing or invalid chain' })
  }
  const cacheKey = `llama:chain-tvl-history:${chain}`
  const cached = getCached(cacheKey, 60_000)
  if (cached) {
    res.setHeader('Cache-Control', TVL_CACHE_CONTROL)
    return res.status(200).json(cached)
  }
  try {
    const r = await fetch(`${DEFI_LLAMA_BASE}/v2/historicalChainTvl/${encodeURIComponent(chain)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!r.ok) return res.status(r.status).json({ error: `Llama ${r.status}` })
    const data = await r.json()
    setCache(cacheKey, data)
    res.setHeader('Cache-Control', TVL_CACHE_CONTROL)
    return res.status(200).json(data)
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch llama chain tvl history' })
  }
}

async function handleMarketLiquidations(req, res) {
  // Compose the dev-Express envelope from the data-api derivatives lanes.
  // The old '/api/market/liquidations' upstream never existed on the box
  // (404 verified 2026-08-18), so this handler ALWAYS served the all-zero
  // fallback below - traders-corner's fallback lane read as "no liquidations".
  try {
    const [winRes, evRes] = await Promise.allSettled([
      spectreProxy('/v1/derivatives/liquidation-windows', 30_000),
      spectreProxy('/v1/derivatives/liquidations?limit=50', 20_000),
    ])
    const w = winRes.status === 'fulfilled'
      ? (winRes.value?.data?.windows || winRes.value?.windows || {})
      : {}
    const rows = evRes.status === 'fulfilled' && Array.isArray(evRes.value?.data)
      ? evRes.value.data
      : []
    if (!Object.keys(w).length && rows.length === 0) throw new Error('liquidation lanes empty')
    const mk = (k) => ({
      long: Number(w[k]?.long) || 0,
      short: Number(w[k]?.short) || 0,
      total: Number(w[k]?.total) || 0,
      count: Number(w[k]?.count) || 0,
      bySymbol: {},
    })
    const recent = rows.map((r) => ({
      time: Number(r.time_unix) * 1000 || Date.parse(r.time) || Date.now(),
      symbol: String(r.asset || r.symbol || '').toUpperCase(),
      // liquidated-side vocabulary (LONG/SHORT) - the tape renderer accepts it
      side: String(r.side || '').toLowerCase() === 'short' ? 'SHORT' : 'LONG',
      qty: Number(r.quantity) || 0,
      price: Number(r.price) || 0,
      usdValue: Number(r.usd_value ?? r.usdValue) || 0,
    })).filter((e) => e.symbol && e.usdValue > 0)
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
    return res.status(200).json({
      connected: true,
      eventCount: recent.length,
      source: 'spectre-v1-derivatives',
      windows: { '1h': mk('1h'), '4h': mk('4h'), '12h': mk('12h'), '24h': mk('24h') },
      recent,
    })
  } catch {
    return res.status(200).json({
      connected: false, eventCount: 0,
      windows: {
        '1h': { long: 0, short: 0, total: 0, count: 0, bySymbol: {} },
        '4h': { long: 0, short: 0, total: 0, count: 0, bySymbol: {} },
        '12h': { long: 0, short: 0, total: 0, count: 0, bySymbol: {} },
        '24h': { long: 0, short: 0, total: 0, count: 0, bySymbol: {} },
      },
      recent: [],
    })
  }
}

// ── Market stats ────────────────────────────────────────────────────────────
async function handleMarketStats(req, res) {
  try {
    const data = await spectreProxy('/api/market/stats', 30_000)
    return res.status(200).json(data)
  } catch {
    return res.status(200).json({})
  }
}

// ── Market dominance history ────────────────────────────────────────────────
async function handleDominanceHistory(req, res) {
  try {
    const data = await spectreProxy('/api/market/dominance-history', 300_000)
    return res.status(200).json(data)
  } catch {
    return res.status(200).json([])
  }
}

// ── Stocks extended ─────────────────────────────────────────────────────────
async function handleStocksExtended(req, res) {
  const route = req.query.sub || ''

  if (route === 'market-status') {
    const POLYGON_KEY = process.env.POLYGON_API_KEY
    if (!POLYGON_KEY) return res.status(200).json({ market: 'unknown' })
    const cacheKey = 'stock-mkt-status'
    const cached = getCached(cacheKey, 60_000)
    if (cached) return res.status(200).json(cached)
    try {
      const r = await fetch(`https://api.polygon.io/v1/marketstatus/now?apiKey=${POLYGON_KEY}`, { signal: AbortSignal.timeout(5000) })
      const data = await r.json()
      setCache(cacheKey, data)
      return res.status(200).json(data)
    } catch { return res.status(200).json({ market: 'unknown' }) }
  }

  if (route === 'news-market') {
    const cacheKey = 'stock-news-mkt'
    const cached = getCached(cacheKey, 300_000)
    if (cached) return res.status(200).json(cached)
    try {
      const data = await spectreProxy('/api/stocks/news/market', 300_000)
      setCache(cacheKey, data)
      return res.status(200).json(data)
    } catch { return res.status(200).json([]) }
  }

  if (route === 'sectors') {
    try { return res.status(200).json(await spectreProxy('/api/stocks/sectors', 300_000)) }
    catch { return res.status(200).json([]) }
  }

  if (route === 'earnings-calendar') {
    try { return res.status(200).json(await spectreProxy('/api/stocks/earnings-calendar', 300_000)) }
    catch { return res.status(200).json({ earnings: [] }) }
  }

  if (route === 'ai-analysis') {
    const symbol = req.query.symbol || ''
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })
    try { return res.status(200).json(await spectreProxy(`/api/stocks/ai-analysis/${encodeURIComponent(symbol)}`, 300_000)) }
    catch { return res.status(200).json({ analysis: null }) }
  }

  if (route === 'sparkline') {
    const symbol = req.query.symbol || ''
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' })
    try { return res.status(200).json(await spectreProxy(`/api/stocks/sparkline/${encodeURIComponent(symbol)}`, 60_000)) }
    catch { return res.status(200).json({ prices: [] }) }
  }

  return res.status(400).json({ error: `Unknown stocks-extended route: ${route}` })
}

// ── Accelerators ────────────────────────────────────────────────────────────
// Mirrors packages/server/routes/accelerators.js. The upstream Spectre API
// (api.spectreai.io) does not host /api/accelerators, so this serverless
// function fetches yc-oss.github.io directly and uses the bundled Hub71
// curated seed JSON — same source of truth as the Express handler.

const YC_API_URL = 'https://yc-oss.github.io/api/companies/all.json'
const YC_TTL = 6 * 60 * 60 * 1000 // 6 hours
const HUB71_TTL = 24 * 60 * 60 * 1000

let _hub71Bundled = null
function loadHub71Bundle() {
  if (_hub71Bundled) return _hub71Bundled
  try {
    _hub71Bundled = require('../../../src/pages/ventures/components/hub71-crypto-seed.json')
  } catch (err) {
    console.warn('[accelerators] Hub71 bundled seed not found:', err.message)
    _hub71Bundled = { companies: [] }
  }
  return _hub71Bundled
}

const CRYPTO_TAG_KEYWORDS = [
  'crypto', 'web3', 'blockchain', 'defi', 'nft',
  'stablecoin', 'bitcoin', 'ethereum', 'cryptocurrency',
  'digital assets', 'smart contracts', 'zk', 'layer 2', 'l2',
  'rollup', 'wallet', 'dao', 'onchain'
]

function isCryptoYC(company) {
  const tags = (company.tags || []).map((t) => String(t).toLowerCase())
  const industry = String(company.subindustry || company.industry || '').toLowerCase()
  const tagMatch = tags.some((t) => CRYPTO_TAG_KEYWORDS.some((kw) => t.includes(kw)))
  const industryMatch = /crypto|blockchain|web3/.test(industry)
  return tagMatch || industryMatch
}

async function fetchYCCompanies() {
  const cached = getCached('accel:yc:all', YC_TTL)
  if (cached) return cached
  try {
    const r = await fetch(YC_API_URL, {
      signal: AbortSignal.timeout(20_000),
      headers: { 'User-Agent': 'Spectre-AI/1.0 (+https://spectreai.io)' },
    })
    if (!r.ok) throw new Error(`yc-${r.status}`)
    const arr = await r.json()
    if (!Array.isArray(arr)) throw new Error('yc-shape')
    const normalized = arr.map((c) => ({
      id: `yc-${c.id}`,
      name: c.name,
      slug: c.slug,
      website: c.website,
      logoUrl: c.small_logo_thumb_url || null,
      oneLiner: c.one_liner || null,
      longDescription: c.long_description || null,
      batch: c.batch || null,
      status: c.status || null,
      industry: c.industry || null,
      subindustry: c.subindustry || null,
      tags: Array.isArray(c.tags) ? c.tags : [],
      teamSize: c.team_size || null,
      topCompany: !!c.top_company,
      regions: Array.isArray(c.regions) ? c.regions : [],
      stage: c.stage || null,
      url: c.url || null,
      launchedAt: c.launched_at || null,
      isCrypto: isCryptoYC(c),
      accelerator: 'YC',
      acceleratorLogo: 'https://www.ycombinator.com/favicon.ico',
      acceleratorColor: '#FF6600',
    }))
    setCache('accel:yc:all', normalized)
    return normalized
  } catch (err) {
    console.warn('[accelerators] YC fetch failed:', err.message)
    return getCached('accel:yc:all', Number.MAX_SAFE_INTEGER) || []
  }
}

function fetchHub71Companies() {
  const cached = getCached('accel:hub71:all', HUB71_TTL)
  if (cached) return cached
  const bundled = loadHub71Bundle()
  const list = Array.isArray(bundled?.companies) ? bundled.companies : []
  const normalized = list.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    website: c.website,
    logoUrl: c.logo_domain
      ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(c.logo_domain)}&sz=128`
      : null,
    oneLiner: c.one_liner || null,
    longDescription: c.long_description || null,
    batch: c.batch || 'Hub71+ Digital Assets',
    status: c.status || 'Active',
    sector: c.sector || null,
    stage: c.stage || null,
    tags: (c.tags && c.tags.length > 0) ? c.tags : [c.sector, 'Crypto'].filter(Boolean),
    isCrypto: true,
    accelerator: 'Hub71',
    acceleratorLogo: 'https://www.google.com/s2/favicons?domain=hub71.com&sz=128',
    acceleratorColor: '#0066CC',
    region: 'Abu Dhabi, UAE',
    backer: 'Mubadala',
    topCompany: true,
  }))
  setCache('accel:hub71:all', normalized)
  return normalized
}

function applyYCFilters(companies, { cryptoOnly, batch, status, topOnly, search }) {
  let result = companies
  if (cryptoOnly) result = result.filter((c) => c.isCrypto)
  if (batch) result = result.filter((c) => String(c.batch || '').toLowerCase() === String(batch).toLowerCase())
  if (status) result = result.filter((c) => String(c.status || '').toLowerCase() === String(status).toLowerCase())
  if (topOnly) result = result.filter((c) => c.topCompany)
  if (search) {
    const q = String(search).toLowerCase()
    result = result.filter((c) =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.oneLiner || '').toLowerCase().includes(q) ||
      (c.tags || []).some((t) => String(t).toLowerCase().includes(q))
    )
  }
  return result
}

function sortAcceleratorFeed(list) {
  return list.slice().sort((a, b) => {
    if (a.topCompany && !b.topCompany) return -1
    if (!a.topCompany && b.topCompany) return 1
    const batchA = a.batch || ''
    const batchB = b.batch || ''
    if (batchA && batchB && batchA !== batchB) return batchB.localeCompare(batchA)
    return 0
  })
}

async function handleAccelerators(req, res) {
  const path = String(req.query.path || '').toLowerCase()
  const cryptoOnly = req.query.crypto === 'true' || req.query.cryptoOnly === 'true'

  try {
    if (path === 'hub71') {
      const all = fetchHub71Companies()
      const filtered = cryptoOnly ? all.filter((c) => c.isCrypto) : all
      return res.status(200).json({
        data: filtered,
        source: 'hub71-seed',
        total: all.length,
        cryptoCount: all.filter((c) => c.isCrypto).length,
      })
    }

    if (path === 'all' || path === '') {
      const [yc, hub71] = await Promise.all([fetchYCCompanies(), Promise.resolve(fetchHub71Companies())])
      const filteredYc = cryptoOnly ? yc.filter((c) => c.isCrypto) : yc
      const filteredHub71 = cryptoOnly ? hub71.filter((c) => c.isCrypto) : hub71
      const merged = [...filteredHub71, ...filteredYc]
      const sorted = sortAcceleratorFeed(merged)
      return res.status(200).json({
        data: sorted,
        total: merged.length,
        counts: { yc: filteredYc.length, hub71: filteredHub71.length },
        sources: ['YC', 'Hub71'],
      })
    }

    // Default: yc
    const all = await fetchYCCompanies()
    const filtered = applyYCFilters(all, {
      cryptoOnly,
      batch: req.query.batch,
      status: req.query.status,
      topOnly: req.query.top === 'true',
      search: req.query.search,
    })
    const sorted = sortAcceleratorFeed(filtered)
    const batches = [...new Set(all.map((c) => c.batch).filter(Boolean))].sort().reverse()
    return res.status(200).json({
      data: sorted,
      source: 'yc-oss',
      total: all.length,
      cryptoCount: all.filter((c) => c.isCrypto).length,
      batches,
    })
  } catch (err) {
    console.error('[accelerators] handler error:', err.message)
    return res.status(200).json({ data: [], error: err.message })
  }
}

// ── Private markets ─────────────────────────────────────────────────────────
// Mirrors packages/server/routes/private-markets.js by sharing its core module
// directly (bundled via vercel.json includeFiles). The upstream Spectre API
// (api.spectreai.io) does not host /api/private-markets, so we run the deal-feed
// logic here — same source of truth as the Express router, no curated-seed drift.
let _privateMarketsCore = null
function loadPrivateMarketsCore() {
  if (_privateMarketsCore) return _privateMarketsCore
  _privateMarketsCore = require('../../../../../packages/server/lib/private-markets-core.js')
  return _privateMarketsCore
}

// Per-resource edge cache TTLs. Match the in-memory TTLs inside
// private-markets-core.js so the CDN layer doesn't out-stale the origin.
// Without these headers Vercel CDN doesn't cache the response and every
// visitor cold-boots the serverless function (~1 s+ on a fresh region).
const PM_CACHE_HEADERS = {
  deals:               'public, s-maxage=60,   stale-while-revalidate=120',
  stats:               'public, s-maxage=120,  stale-while-revalidate=240',
  'funding-news':      'public, s-maxage=300,  stale-while-revalidate=600',
  'sec-filings':       'public, s-maxage=600,  stale-while-revalidate=1200',
  'sector-heatmap':    'public, s-maxage=300,  stale-while-revalidate=600',
  unicorns:            'public, s-maxage=3600, stale-while-revalidate=7200',
  preipo:              'public, s-maxage=1800, stale-while-revalidate=3600',
  companies:           'public, s-maxage=600,  stale-while-revalidate=1200',
  'valuation-history': 'public, s-maxage=600,  stale-while-revalidate=1200',
  'llama-raises':      'no-store',  // upstream is paywalled — never cache stale 4xx
}

async function handlePrivateMarkets(req, res) {
  const sub = req.query.sub || ''
  try {
    const core = loadPrivateMarketsCore()
    const { status, body } = await core.handlePrivateMarketsRoute(sub, req.query)
    const resource = String(sub).replace(/^\/+|\/+$/g, '').split('/')[0] || 'deals'
    if (status === 200 && body && !body.error) {
      const header = PM_CACHE_HEADERS[resource] || PM_CACHE_HEADERS.deals
      res.setHeader('Cache-Control', header)
      res.setHeader('CDN-Cache-Control', header)
    } else {
      res.setHeader('Cache-Control', 'no-store')
    }
    return res.status(status).json(body)
  } catch (err) {
    console.error('[private-markets] handler error:', err.message)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ data: [], error: err.message })
  }
}

// ── Ambient (audio CORS proxy) ──────────────────────────────────────────────
async function handleAmbient(req, res) {
  try {
    const r = await fetch('https://cdn.pixabay.com/audio/2022/03/10/audio_345c2f1f2c.mp3', {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'audio/mpeg,audio/*' },
    })
    if (!r.ok) return res.status(r.status).end()
    const buf = Buffer.from(await r.arrayBuffer())
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    return res.send(buf)
  } catch { return res.status(502).end() }
}

// ── Token exchanges / markets ───────────────────────────────────────────────
async function handleTokenExchanges(req, res) {
  const symbol = req.query.symbol || ''
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' })
  try { return res.status(200).json(await spectreProxy(`/api/token-exchanges?symbol=${encodeURIComponent(symbol)}`, 60_000)) }
  catch { return res.status(200).json({ exchanges: [] }) }
}

// 2026-07-02: real implementation. This handler used to proxy to the Spectre
// origin's /api/token-markets — a route that DOESN'T EXIST there (404) — so
// prod always answered { markets: [] } and the Markets tab (now the token
// page's default) lived off client-side fallbacks. Mirror of the Express
// route in packages/server/index.js: CG /coins/{id}/tickers with depth,
// tier-ranked so wash-trade venues can't outrank Binance on self-reported
// volume.
const TM_TIER1 = new Set([
  'Binance', 'Coinbase Exchange', 'Coinbase', 'Kraken', 'OKX', 'Bybit',
  'KuCoin', 'Bitfinex', 'Bitstamp', 'Crypto.com Exchange', 'Crypto.com',
  'HTX', 'Gate', 'Gate.io', 'Upbit', 'MEXC', 'Bitget', 'BingX', 'Bithumb',
  'Gemini',
  'Uniswap V2 (Ethereum)', 'Uniswap V3 (Ethereum)', 'Uniswap V3 (Arbitrum One)',
  'Jupiter', 'Raydium', 'PancakeSwap V2 (BSC)', 'PancakeSwap V3 (BSC)',
  'Trader Joe', 'Curve (Ethereum)', 'SushiSwap',
])
const TM_TIER2 = new Set([
  'BitMart', 'WhiteBIT', 'Bitvavo', 'LBank', 'XT.com', 'Phemex', 'Bitrue',
  'CoinEx', 'Poloniex', 'Bittrex', 'AscendEX', 'BTSE', 'OrangeX', 'BitForex',
  'Coinone', 'Korbit', 'Indodax', 'OKCoin', 'Probit Global',
])
const TM_WASH = new Set([
  'BTCC', 'Azbit', 'Pionex', 'CoinUp.io', 'KCEX', 'GroveX', 'CoinW', 'BVOX',
  'Biconomy.com', 'P2B', 'CITEX', 'Hotbit', 'BiONE', 'Bitkub', 'Toobit',
  'BTSE Futures', 'BHEX', 'Hibt', 'BitForex', 'Coinsbit', 'P2PB2B',
])
const TM_DEX_RE = /uniswap|sushiswap|pancakeswap|curve|balancer|raydium|jupiter|orca|trader joe|quickswap|camelot|velodrome|aerodrome|osmosis|thorswap|dexalot|sodex|lighter|fluid|maverick|1inch|paraswap|kyberswap|dodo|shibaswap|spookyswap|pangolin|biswap|lifinity|meteora|serum|gmx|dydx|vertex|drift|hyperliquid|swap|dex/i

async function handleTokenMarkets(req, res) {
  const symbol = assetSymbol(req.query.symbol)
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' })
  const cgHeaders = { Accept: 'application/json' }
  if (COINGECKO_API_KEY) cgHeaders['x-cg-pro-api-key'] = COINGECKO_API_KEY

  try {
    // Resolve the CG id: the frontend passes ?id= for anything it knows;
    // otherwise one cached /search round-trip (24h TTL — ids are stable).
    let cgId = String(req.query.id || '').trim()
    if (!cgId) {
      const rKey = `tm:resolve:${symbol}`
      cgId = getCached(rKey, 24 * 60 * 60 * 1000)
      if (!cgId) {
        const sRes = await fetch(`${COINGECKO_BASE}/search?query=${encodeURIComponent(symbol.replace(/-/g, ' '))}`,
          { headers: cgHeaders, signal: AbortSignal.timeout(8000) })
        if (sRes.ok) {
          const sData = await sRes.json()
          const coins = sData.coins || []
          const match = coins.find(c => (c.symbol || '').toUpperCase() === symbol) || null
          if (match?.id) { cgId = match.id; setCache(rKey, cgId) }
        }
      }
    }
    if (!cgId) return res.status(200).json({ markets: [], source: '' })

    // Warm-instance cache (5 min) + CDN caching below keep repeat views instant.
    const mKey = `tm:markets:${cgId}`
    const cachedMarkets = getCached(mKey, 5 * 60 * 1000)
    if (cachedMarkets) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=300')
      return res.status(200).json(cachedMarkets)
    }

    const baseUrl = `${COINGECKO_BASE}/coins/${encodeURIComponent(cgId)}/tickers?include_exchange_logo=true&depth=true&order=volume_desc&per_page=250`
    const p1Res = await fetch(`${baseUrl}&page=1`, { headers: cgHeaders, signal: AbortSignal.timeout(9000) })
    if (!p1Res.ok) return res.status(200).json({ markets: [], source: '' })
    const p1 = await p1Res.json()
    let tickers = p1.tickers || []
    if (tickers.length >= 250) {
      try {
        const p2Res = await fetch(`${baseUrl}&page=2`, { headers: cgHeaders, signal: AbortSignal.timeout(9000) })
        if (p2Res.ok) {
          const p2 = await p2Res.json()
          if (p2.tickers?.length > 0) tickers = tickers.concat(p2.tickers)
        }
      } catch { /* page 2 optional */ }
    }

    let totalVolume = 0
    for (const t of tickers) totalVolume += (t.converted_volume?.usd || 0)

    const trustOrder = { green: 0, yellow: 1, red: 2 }
    const sorted = [...tickers].sort((a, b) => {
      const aT1 = TM_TIER1.has(a.market?.name) ? 0 : 1
      const bT1 = TM_TIER1.has(b.market?.name) ? 0 : 1
      if (aT1 !== bT1) return aT1 - bT1
      const ta = trustOrder[a.trust_score] ?? 3
      const tb = trustOrder[b.trust_score] ?? 3
      if (ta !== tb) return ta - tb
      return (b.converted_volume?.usd || 0) - (a.converted_volume?.usd || 0)
    })

    const seen = new Map()
    for (const t of sorted) {
      const rawName = t.market?.name || 'Unknown'
      const pair = `${(t.base || '').toUpperCase()}/${(t.target || '').toUpperCase()}`
      const key = `${rawName}::${pair}`
      if (seen.has(key)) continue
      const shortName = rawName
        .replace(' Exchange', '')
        .replace(/ \(Ethereum\)/, '').replace(/ \(BSC\)/, '')
        .replace(/ \(Arbitrum One\)/, '').replace(/ \(Optimism\)/, '')
        .replace(/ \(Base\)/, '').replace(/ \(Polygon\)/, '')
        .replace(/ \(Solana\)/, '')
      const isDex = TM_DEX_RE.test(rawName)
      const vol = t.converted_volume?.usd || 0
      const pct = totalVolume > 0 ? ((vol / totalVolume) * 100) : 0
      seen.set(key, {
        exchange: shortName,
        exchangeId: t.market?.identifier || null,
        logo: t.market?.logo || null,
        pair,
        price: t.converted_last?.usd || t.last || 0,
        depthPlus2: t.cost_to_move_up_usd || 0,
        depthMinus2: t.cost_to_move_down_usd || 0,
        volume24h: vol,
        volumePct: Math.round(pct * 10) / 10,
        liquidity: (t.cost_to_move_up_usd || 0) + (t.cost_to_move_down_usd || 0),
        type: isDex ? 'dex' : 'cex',
        trustScore: t.trust_score || null,
        tradeUrl: t.trade_url || null,
      })
    }

    const allMarkets = [...seen.values()]
    const tierRank = (m) => {
      if (TM_TIER1.has(m.exchange)) return 0
      if (m.trustScore === 'green') return 1
      if (TM_TIER2.has(m.exchange)) return 2
      if (TM_WASH.has(m.exchange)) return 5
      if (m.trustScore === 'yellow') return 3
      if (m.trustScore === 'red') return 5
      return 4
    }
    const tierThenVolume = (a, b) => {
      const ra = tierRank(a); const rb = tierRank(b)
      if (ra !== rb) return ra - rb
      return (b.volume24h || 0) - (a.volume24h || 0)
    }
    const cexMarkets = allMarkets.filter(m => m.type === 'cex').sort(tierThenVolume)
    const dexMarkets = allMarkets.filter(m => m.type === 'dex').sort(tierThenVolume)
    const markets = [...cexMarkets.slice(0, 60), ...dexMarkets.slice(0, 60)]

    const result = { markets, source: markets.length > 0 ? 'coingecko' : '' }
    if (markets.length > 0) {
      setCache(mKey, result)
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=300')
    }
    return res.status(200).json(result)
  } catch (err) {
    console.error('token-markets:', err.message)
    return res.status(200).json({ markets: [] })
  }
}

// ── Token market profile ────────────────────────────────────────────────────
async function handleTokenMarketProfile(req, res) {
  const cgId = req.query.cg_id || ''
  if (!cgId) return res.status(400).json({ error: 'Missing cg_id' })

  // Was: spectreProxy('/api/token/market-profile?...') — that path doesn't
  // exist on Spectre Data API and the call hung waiting for CF block.
  // Compose locally from CG /coins/{id} (canonical metadata + market_data)
  // plus Spectre /v1/intelligence/sentiment/{asset} (when available). Mirror
  // of the Express route in packages/server/index.js for prod parity.
  try {
    const cgHeaders = { accept: 'application/json' }
    if (COINGECKO_API_KEY) cgHeaders['x-cg-pro-api-key'] = COINGECKO_API_KEY
    const sentHeaders = { accept: 'application/json' }
    if (API_KEY) sentHeaders['X-API-Key'] = API_KEY

    const [cgResp, sentResp] = await Promise.all([
      fetch(`${COINGECKO_BASE}/coins/${encodeURIComponent(cgId)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
        { headers: cgHeaders, signal: AbortSignal.timeout(8000) }),
      fetch(`${API_BASE.replace(/\/+$/, '')}/v1/intelligence/sentiment/${encodeURIComponent(cgId)}`,
        { headers: sentHeaders, signal: AbortSignal.timeout(5000) }).catch(() => null)
    ])

    if (!cgResp.ok) return res.status(200).json({})
    const cg = await cgResp.json()
    const md = cg?.market_data || {}
    const sentBody = sentResp && sentResp.ok ? await sentResp.json().catch(() => null) : null
    const sent = sentBody?.data || null

    const tokenDetails = {
      ticker: cg?.symbol ? String(cg.symbol).toUpperCase() : '',
      token_name: cg?.name || '',
      image: cg?.image?.large || cg?.image?.small || cg?.image?.thumb || '',
      banner: cg?.image?.large || '',
      description: cg?.description?.en || '',
      holders: null,
      price: md?.current_price?.usd ?? 0,
      market_cap: md?.market_cap?.usd ?? 0,
      liquidity: null,
      volume_24h: md?.total_volume?.usd ?? 0,
      fully_diluted_valuation: md?.fully_diluted_valuation?.usd ?? null,
      circulating_supply: md?.circulating_supply ?? null,
      total_supply: md?.total_supply ?? null,
      max_supply: md?.max_supply ?? null,
      categories: Array.isArray(cg?.categories) ? cg.categories : [],
      vol_mkt_cap_ratio: (md?.market_cap?.usd > 0 && md?.total_volume?.usd > 0) ? (md.total_volume.usd / md.market_cap.usd) : null,
      liquiditydata: {
        liquidity: null,
        volume24h: md?.total_volume?.usd ?? 0,
        volume24hUsd: md?.total_volume?.usd ?? 0,
        marketCapUsd: md?.market_cap?.usd ?? 0,
        volMktCapRatio: (md?.market_cap?.usd > 0 && md?.total_volume?.usd > 0) ? (md.total_volume.usd / md.market_cap.usd) : null,
        buySideDepth: null,
        sellSideDepth: null,
      },
      price_performance: {
        low_24h: md?.low_24h?.usd ?? null,
        high_24h: md?.high_24h?.usd ?? null,
        change_1h: md?.price_change_percentage_1h_in_currency?.usd ?? null,
        change_24h: md?.price_change_percentage_24h ?? null,
        change_7d: md?.price_change_percentage_7d ?? null,
        change_30d: md?.price_change_percentage_30d ?? null,
        all_time_high: md?.ath?.usd != null ? {
          price: md.ath.usd,
          date: md?.ath_date?.usd || null,
          change_percentage: md?.ath_change_percentage?.usd ?? null,
        } : null,
        all_time_low: md?.atl?.usd != null ? {
          price: md.atl.usd,
          date: md?.atl_date?.usd || null,
          change_percentage: md?.atl_change_percentage?.usd ?? null,
        } : null,
      },
      key_levels: { support: null, resistance: null },
      ai_insight: '',
    }

    const intelligence = sent ? {
      sentiment_score: sent.score ?? sent.sentiment_score ?? null,
      label: sent.label ?? null,
      overall_trend: sent.trend ?? sent.overall_trend ?? null,
      fear_greed: sent.fear_greed ?? null,
    } : { sentiment_score: null, label: null, overall_trend: null, fear_greed: null }

    return res.status(200).json({ token_details: tokenDetails, intelligence_ai_analysis: intelligence })
  } catch {
    return res.status(200).json({})
  }
}

// ── Intelligence feed + insight (Hetzner data API) ─────────────────────────
async function handleIntelligenceFeed(req, res) {
  const limit = req.query.limit || '20'
  const direction = req.query.direction || ''
  const qs = new URLSearchParams({ limit })
  if (direction) qs.set('direction', direction)
  try { return res.status(200).json(await spectreProxy(`/v1/intelligence/feed?${qs}`, 60_000)) }
  catch { return res.status(200).json({ data: [], meta: { count: 0 } }) }
}

async function handleMetricsInsight(req, res) {
  const { metric_key, asset, value } = req.query
  if (!metric_key) return res.status(400).json({ error: 'metric_key required' })
  const qs = new URLSearchParams({ metric_key })
  if (asset) qs.set('asset', asset)
  if (value != null) qs.set('value', String(value))
  try { return res.status(200).json(await spectreProxy(`/v1/metrics/insight?${qs}`, 300_000)) }
  catch { return res.status(200).json({ data: { patternText: null, sampleSize: 0, confidence: 'none' } }) }
}

async function handleMetricsPatterns(req, res) {
  const key = req.query.key || ''
  const asset = req.query.asset || ''
  if (!key) return res.status(400).json({ error: 'key required' })
  const qs = asset ? `?asset=${encodeURIComponent(asset)}` : ''
  try { return res.status(200).json(await spectreProxy(`/v1/metrics/patterns/${encodeURIComponent(key)}${qs}`, 300_000)) }
  catch { return res.status(200).json({ data: { patterns: [] } }) }
}

// ── Generic v1 bridge (whitelisted) ────────────────────────────────────────
// Map Spectre's `chain` string → the numeric `networkId` Codex consumers use.
// Used to keep the response shape compatible with the previous Codex-backed
// /api/token/details handler so banner/header/watchlist callers don't break.
const CHAIN_TO_NETWORK_ID = {
  ethereum: 1, bsc: 56, 'binance-smart-chain': 56,
  polygon: 137, 'polygon-pos': 137,
  arbitrum: 42161, 'arbitrum-one': 42161,
  base: 8453, optimism: 10, avalanche: 43114, fantom: 250,
  solana: 1399811149, tron: 728126428, sui: 784, ton: 607,
}
const NETWORK_ID_TO_CHAIN = {
  1: 'ethereum', 56: 'bsc', 137: 'polygon',
  42161: 'arbitrum', 8453: 'base', 10: 'optimism',
  43114: 'avalanche', 250: 'fantom', 1399811149: 'solana',
  728126428: 'tron', 784: 'sui', 607: 'ton',
}

// Spectre `/v1/scanner/token/{address}` → response shaped to match the legacy
// Codex `handleTokenDetails` output so /api/token/details consumers don't break.
// Audit 2026-05-19 Section D #6: stop bypassing Spectre and burning Codex quota
// when Spectre already composes Codex + CG + DexScreener internally.
async function handleScannerToken(req, res) {
  const address = String(req.query.address || '').trim()
  if (!address) return res.status(400).json({ error: 'Address is required' })

  // The scanner auto-detects chain by address shape, which mis-routes EVM
  // addresses to Solana. Always send an explicit ?chain= hint when the caller
  // gave us a networkId. EVM defaults to ethereum if we have no hint at all.
  const inputNetworkId = parseInt(req.query.networkId)
  const chainHint = NETWORK_ID_TO_CHAIN[inputNetworkId]
    || (address.startsWith('0x') ? 'ethereum' : null)
  const chainQs = chainHint ? `?chain=${encodeURIComponent(chainHint)}` : ''

  // Per-address KV cache (2026-08-14, the ingestion-key lockstep): every
  // scanner call for an address the box hasn't seen makes the box run
  // filterTokens+listPairs on ITS Codex key, asynchronously - so this path
  // must never re-ask per visitor. The 15s edge header below was the only
  // cache here; serverless regions + cold edges re-paid the box constantly.
  // Same per-address rule as PR #1423's spectre-data cache: 120s positive,
  // 300s negative (404-class only), transient failures never cached.
  const _scAddrKey = address.startsWith('0x') ? address.toLowerCase() : address
  const _scKvKey = `scanner-token:v1:${chainHint || 'auto'}:${_scAddrKey}`
  try {
    const hit = await getJsonWithTTL(_scKvKey)
    if (hit) {
      if (hit._miss) return res.status(404).json({ error: 'Token not found' })
      res.setHeader('Cache-Control', 'public, s-maxage=15, max-age=8, stale-while-revalidate=30')
      return res.status(200).json(hit)
    }
  } catch { /* KV best-effort */ }

  try {
    const data = await spectreProxy(`/v1/scanner/token/${encodeURIComponent(address)}${chainQs}`, 15_000)
    // Scanner can return `detail: null` for assets that have DEX pairs but no
    // GeckoTerminal-side metadata (e.g. DAI, BAT). Fall back to top-pair data
    // in that case — Codex would have served the same shape from filterTokens.
    if (!data || (!data.detail && !(Array.isArray(data.pairs) && data.pairs.length))) {
      setJsonWithTTL(_scKvKey, { _miss: 404 }, 300).catch(() => {})
      return res.status(404).json({ error: 'Token not found' })
    }

    const detail = data.detail || {}
    const info = data.info || {}
    const topPair = Array.isArray(data.pairs) && data.pairs.length ? data.pairs[0] : {}
    const txns24 = topPair.txns_24h || {}
    const txnCount24 = (parseInt(txns24.buys) || 0) + (parseInt(txns24.sells) || 0)
    const resolvedNetworkId = parseInt(req.query.networkId) || CHAIN_TO_NETWORK_ID[data.chain] || 1
    const twitterHandle = info.twitter_handle ? String(info.twitter_handle).replace(/^@/, '') : null
    const telegramHandle = info.telegram_handle ? String(info.telegram_handle).replace(/^@/, '') : null

    const payload = {
      address: data.address || detail.address || address,
      name: data.name || detail.name || '',
      symbol: data.symbol || detail.symbol || '',
      decimals: detail.decimals ?? null,
      networkId: resolvedNetworkId,
      logo: info.image_url || null,
      description: info.description || '',
      circulatingSupply: toNumberOrNull(detail.normalized_total_supply),
      totalSupply: toNumberOrNull(detail.normalized_total_supply),
      socials: {
        twitter: twitterHandle ? `https://twitter.com/${twitterHandle}` : null,
        discord: info.discord_url || null,
        telegram: telegramHandle ? `https://telegram.me/${telegramHandle}` : null,
        website: Array.isArray(info.websites) && info.websites.length ? info.websites[0] : null,
      },
      price: toNumberOrNull(detail.price_usd) ?? toNumberOrNull(topPair.price_usd) ?? 0,
      volume24: toNumberOrNull(detail.volume_24h_usd) ?? toNumberOrNull(topPair.volume_24h) ?? 0,
      liquidity: toNumberOrNull(topPair.liquidity_usd) ?? 0,
      marketCap: toNumberOrNull(detail.market_cap_usd) ?? toNumberOrNull(topPair.market_cap_usd) ?? toNumberOrNull(detail.fdv_usd) ?? toNumberOrNull(topPair.fdv_usd) ?? 0,
      change24: toNumberOrNull(topPair.change_24h_pct) ?? 0,
      change1h: toNumberOrNull(topPair.change_1h_pct) ?? 0,
      change4h: toNumberOrNull(topPair.change_6h_pct) ?? 0,
      change12h: toNumberOrNull(topPair.change_6h_pct) ?? 0,
      // A scanner payload without a holder count must not fabricate one — 0 is
      // a real-looking value and the RZ stats list rendered it ("Holders $0").
      holders: parseInt(info.holders_count) > 0 ? parseInt(info.holders_count) : null,
      createdAt: topPair.pair_created_at || null,
      txnCount24,
      uniqueWallets24: 0,
      _source: 'spectre-scanner',
    }
    setJsonWithTTL(_scKvKey, payload, 120).catch(() => {})
    res.setHeader('Cache-Control', 'public, s-maxage=15, max-age=8, stale-while-revalidate=30')
    return res.status(200).json(payload)
  } catch (err) {
    const upstream = err && typeof err.upstreamStatus === 'number' ? err.upstreamStatus : null
    if (upstream === 404) {
      setJsonWithTTL(_scKvKey, { _miss: 404 }, 300).catch(() => {})
      return res.status(404).json({ error: 'Token not found' })
    }
    const message = err instanceof Error ? err.message : 'Scanner proxy failed'
    const status = upstream && upstream >= 400 && upstream < 500 ? upstream : 502
    return res.status(status).json({ error: message })
  }
}

async function handleV1Proxy(req, res) {
  const path = String(req.query.path || '').replace(/^\/+/, '')
  if (!path) return res.status(400).json({ error: 'Missing path' })
  if (!isAllowedV1Path(path)) {
    return res.status(403).json({ error: `Path not allowed for v1 proxy: ${path}` })
  }

  const qs = buildForwardQuery(req)
  try {
    const ttlMs = ttlForV1Path(path)
    const data = await spectreProxy(`/v1/${path}${qs}`, ttlMs)
    // Mirror the client-side cache TTL onto the Vercel edge so cold visitors
    // share the warmed response. Without this every page load cold-booted
    // the serverless function — /intelligence alone fires 5+ /v1/news,
    // /v1/prices, /v1/market/fear-greed calls on mount. swr=2x ttl lets the
    // edge serve stale-while-revalidating in the background.
    const ttlSec = Math.max(5, Math.round(ttlMs / 1000))
    const header = `public, s-maxage=${ttlSec}, stale-while-revalidate=${ttlSec * 2}`
    res.setHeader('Cache-Control', header)
    res.setHeader('CDN-Cache-Control', header)
    return res.status(200).json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'v1 proxy failed'
    const upstream = err && typeof err.upstreamStatus === 'number' ? err.upstreamStatus : null
    const status = upstream && upstream >= 400 && upstream < 500 ? upstream : 502
    // Never cache an error — let the next visitor try again immediately.
    res.setHeader('Cache-Control', 'no-store')
    return res.status(status).json({ error: message, path: `/v1/${path}` })
  }
}

// ── Export all handlers ─────────────────────────────────────────────────────
export {
  handleWeather, handleCompare, handleRWA, handleTokenResolve,
  handleBinanceKlines, handleSolanaBalance, handleHero, handleMonarchChat,
  handleSearchQuery, handleMarketLiquidations, handleMarketStats,
  handleDominanceHistory, handleStocksExtended, handleAccelerators,
  handlePrivateMarkets, handleAmbient, handleTokenExchanges,
  handleTokenMarkets, handleTokenMarketProfile,
  handleIntelligenceFeed, handleMetricsInsight, handleMetricsPatterns,
  handleScannerToken, handleV1Proxy,
  handleLlamaProtocolPassthrough, handleLlamaChainsPassthrough,
  handleLlamaLiteChartsPassthrough, handleLlamaChainTvlHistoryPassthrough,
}

export default async function handler(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const route = req.query.route || ''
  const ROUTES = {
    weather: handleWeather,
    compare: handleCompare,
    rwa: handleRWA,
    'token-resolve': handleTokenResolve,
    'binance-klines': handleBinanceKlines,
    'solana-balance': handleSolanaBalance,
    hero: handleHero,
    og: handleHero,
    'monarch-chat': handleMonarchChat,
    'search-query': handleSearchQuery,
    'market-liquidations': handleMarketLiquidations,
    'market-stats': handleMarketStats,
    'dominance-history': handleDominanceHistory,
    'stocks-extended': handleStocksExtended,
    accelerators: handleAccelerators,
    'private-markets': handlePrivateMarkets,
    ambient: handleAmbient,
    'token-exchanges': handleTokenExchanges,
    'token-markets': handleTokenMarkets,
    'token-market-profile': handleTokenMarketProfile,
    'intelligence-feed': handleIntelligenceFeed,
    'metrics-insight': handleMetricsInsight,
    'metrics-patterns': handleMetricsPatterns,
    'scanner-token': handleScannerToken,
    'v1-proxy': handleV1Proxy,
    'llama-protocol-raw': handleLlamaProtocolPassthrough,
    'llama-chains-raw': handleLlamaChainsPassthrough,
    'llama-lite-charts': handleLlamaLiteChartsPassthrough,
    'llama-chain-tvl-history': handleLlamaChainTvlHistoryPassthrough,
  }

  const h = ROUTES[route]
  if (!h) return res.status(400).json({ error: `Unknown extended route: ${route}` })
  return h(req, res)
}
