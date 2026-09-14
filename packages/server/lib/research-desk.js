'use strict'
/**
 * Research Desk — dynamic emerging-EVM-DeFi-alpha pipeline (Phase 1).
 *
 * Turns the trading app's Research Desk (Discover page) from a frozen 10-project
 * whitelist into a self-updating feed of emerging EVM DeFi protocols. ZERO paid
 * API cost: DefiLlama (/protocols, /overview/fees) + DexScreener are all FREE.
 * The pipeline never selects a billable Codex field.
 *
 * SHARED logic for BOTH the dev Express route (packages/server/routes/research-desk.js)
 * and the prod Vercel handler (apps/trading/api/research-desk.js). Keep the prod
 * mirror (apps/trading/api/_lib/research-desk.cjs) BYTE-IDENTICAL — the only
 * permitted difference is the require extensions:
 *     .js  : require('./trending-score')      require('./dexscreener-enrich')
 *     .cjs : require('./trending-score.cjs')  require('./dexscreener-enrich.cjs')
 * (Vercel bundles each serverless fn standalone, so a cross-package require from
 * packages/server does not resolve in prod; the .cjs duplication is the proven
 * trending-score.js <-> trending-score.cjs convention.)
 *
 * Pipeline (mirrors the RWA bundle + the trending dual-runtime convention):
 *   DefiLlama /protocols + /overview/fees (FREE)
 *     -> isResearchDeskEligible (ETH/Base/Solana DeFi, ALL cap tiers; drops base
 *        L1s/blue-chips/household-names/stables/stocks; reuses trending isTrendingEligible)
 *     -> parseProtocolAddress (chain-prefix -> {networkId, tokenAddress})
 *   BLENDED with CoinGecko emerging tokens (FREE, key-gated, graceful):
 *     -> fetchEmergingTokens (AI / DePIN / Gaming / Infrastructure categories)
 *        mapped to universe-shaped rows with `_cgToken:true`, tvl:null
 *     -> deduped by symbol AND token identity against the DefiLlama protocols
 *   then both flow through the SAME fast tier:
 *     -> enrichFromDexScreener (FREE, batched) -> objective on-chain metrics
 *     -> score (0.50*scoreTraction + 0.30*tvlGrowth + 0.20*momentum)
 *        (token rows: tvlGrowth derived from CG price 7d change, not TVL flow)
 *     -> deal-flow stage + 5 scorecard grades (computed/proxy; market-metric path
 *        when tvl is null)
 *     -> bounded, ranked bundle
 *
 * change_30d is ALWAYS null from DefiLlama — never use it. CoinGecko change fields
 * are ALREADY PLAIN PERCENTS (5.3 = +5.3%) — NEVER run them through the Codex
 * dual-format (toCodexLikePct / normalizeCodexChange's |v|<1 ratio rule); that
 * corrupts small values. CG changes are stored as the canonical `change24h` /
 * `change7d` and rendered as-is by the frontend.
 *
 * COST: CoinGecko is rate-limited (self-contained serial queue, key-gated). The
 * 4 category fetches + one /coins/list?include_platform call are cached ~10min and
 * the token count is bounded. No CG key (or any CG failure) -> returns [] -> feed
 * degrades to DeFi-only (current behaviour), ZERO regression.
 */

const { scoreTraction, isTrendingEligible, normalizeCodexChange } = require('./trending-score')
const { enrichFromDexScreener, norm } = require('./dexscreener-enrich')

// ── Constants ────────────────────────────────────────────────────────────────

const LLAMA_PROTOCOLS = 'https://api.llama.fi/protocols'
const LLAMA_FEES = 'https://api.llama.fi/overview/fees?dataType=dailyRevenue'
const FETCH_TIMEOUT_MS = 15000

// DefiLlama address chain-prefix -> our networkId. Bare 0x.. (no prefix) = Ethereum.
// SCOPED to the 3 chains the desk covers: Ethereum, Base, Solana. Any other prefix
// (bsc:/arbitrum:/optimism:/polygon:/avax:/...) is absent here, so
// parseProtocolAddress returns null and that protocol drops at the source.
const CHAIN_PREFIX_TO_NETWORK = {
  ethereum: 1, eth: 1,
  base: 8453,
  solana: 1399811149, sol: 1399811149,
}

// Networks the desk surfaces: Ethereum + Base + Solana. DexScreener enriches all
// three (DS_CHAIN covers solana). A networkId not here drops.
const SUPPORTED_NETWORKS = new Set([1, 8453, 1399811149])

// ── CoinGecko emerging-token blend (FREE, key-gated, graceful) ────────────────
// Self-contained CoinGecko access (the lib can't cleanly import the monolith's
// cgFetch). Reads process.env.COINGECKO_API_KEY; same base/header as index.js.
// On no key / any failure every CG helper returns [] so the desk degrades to
// DeFi-only with zero regression.
const CG_API_KEY = process.env.COINGECKO_API_KEY || ''
const CG_BASE = CG_API_KEY ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3'
const CG_HEADER = 'x-cg-pro-api-key'
const CG_FETCH_TIMEOUT_MS = 15000

// The 4 emerging-narrative categories to source, with the CANONICAL sector label
// each maps to. IDs VERIFIED LIVE 2026-06-25 against /coins/categories/list:
//   artificial-intelligence = "Artificial Intelligence (AI)"  (broadest AI bucket)
//   depin                    = "DePIN"
//   gaming                   = "Gaming (GameFi)"
//   infrastructure           = "Infrastructure"               (L1/L2/oracle/middleware)
const CG_CATEGORIES = [
  { id: 'artificial-intelligence', sector: 'AI' },
  { id: 'depin', sector: 'DePIN' },
  { id: 'gaming', sector: 'Gaming' },
  { id: 'infrastructure', sector: 'Infrastructure' },
]

// CoinGecko /coins/list platform key -> our networkId. Scoped to the chains the
// desk + DexScreener cover (DS_CHAIN); any other platform yields address=null
// (the token still surfaces, just without on-chain enrichment).
const CG_PLATFORM_TO_NETWORK = {
  ethereum: 1,
  base: 8453,
  solana: 1399811149,
  'arbitrum-one': 42161,
  'optimistic-ethereum': 10,
  'polygon-pos': 137,
  'binance-smart-chain': 56,
  avalanche: 43114,
}
// Preference order when a token lives on multiple chains: pick the deepest /
// best-covered market first (ETH > Base > Solana > Arbitrum > ... ).
const CG_PLATFORM_PREFERENCE = ['ethereum', 'base', 'solana', 'arbitrum-one', 'optimistic-ethereum', 'polygon-pos', 'binance-smart-chain', 'avalanche']

// Emerging band for CG tokens: not blue-chip, not dust. (DeFi protocols have NO
// upper cap — they drop household names by NAME — but CG categories are broad and
// include the megacaps, so a band keeps the surface "emerging".)
//
// LOWERED for genuine low/mid-cap alpha (2026-06-25): the desk's whole point is
// catching projects BEFORE they run to $20-40M. A $5M floor excluded every real
// sub-$5M micro-cap, so the published feed was ~90% High. We now fetch down to
// $200k mcap with a $15k volume floor (small tokens trade less but still need a
// real, tradeable market), and we BALANCE the published CG set across cap tiers
// (see fetchEmergingTokens) so Low/Mid actually populate.
const CG_MCAP_MIN = 200_000            // $200k floor — genuine micro-cap, still a real market
const CG_MCAP_MAX = 5_000_000_000      // $5B ceiling — above this is a blue-chip, not "emerging"
const CG_MIN_VOLUME = 15_000           // $15k/24h — small caps trade less; still actually traded
const CG_PER_CATEGORY = 80             // rows pulled PER ranking pass per category (volume_desc + mcap_asc)
const CG_MAX_TOKENS = 80               // hard cap on total CG tokens SOURCED into the universe
const CG_PUBLISH_CAP = 42              // hard cap on CG tokens PUBLISHED (additive on top of DeFi)
                                       // (CG emerging categories floor out ~$5-10M so this cohort is
                                       // mostly High; the DexScreener alpha source carries low/mid.)
// Of the published CG budget, reserve a minimum share for sub-$5M (low+mid) tokens
// so the high-volume large caps can't consume the whole slate (the regression that
// kept the feed ~90% High). The reserve is a FLOOR, not a quota — if fewer small
// caps exist they aren't padded, and any unused reserve is filled by larger ones.
const CG_SMALLCAP_RESERVE = 32         // >= this many sub-$5M CG tokens kept when available
const CG_SMALLCAP_MAX = 5_000_000      // "small cap" for the reserve = below the high tier

// Obvious meme / extra exclusions on top of the trending vocabulary (the AI/Gaming
// categories carry a lot of meme noise). isTrendingEligible already drops
// majors/wrapped/LST/stables/stocks; this adds the household narrative-token names
// the desk's RESEARCH_EXCLUDE_SYMBOLS list doesn't yet cover for these sectors.
const CG_EXTRA_EXCLUDE_SYMBOLS = new Set([
  // AI majors everyone knows
  'TAO', 'FET', 'RENDER', 'RNDR', 'AGIX', 'OCEAN', 'GRT', 'AKT', 'AR', 'THETA',
  'VIRTUAL', 'AI16Z', 'TURBO',
  // DePIN majors
  'FIL', 'HNT', 'IOTX', 'AIOZ', 'LPT',
  // Gaming majors
  'IMX', 'GALA', 'AXS', 'SAND', 'MANA', 'ENJ', 'APE', 'FLOW', 'CHZ', 'GMT', 'RON',
  // Infra majors
  'LINK', 'GRT', 'QNT', 'ATOM', 'DOT', 'NEAR', 'ICP', 'FTM', 'S', 'INJ', 'TIA', 'SEI', 'STX',
])

// Category ALLOW / EXCLUDE (DefiLlama category spelling, verified live 2026-06-23).
// "Dexs" (not "Dexes"), "Liquid Restaking", "Restaking", "CDP", etc.
const ALLOW_CATEGORIES = new Set([
  'Dexs', 'Lending', 'Yield', 'Yield Aggregator', 'Derivatives', 'CDP', 'Options',
  'Liquid Restaking', 'Restaking', 'Synthetics', 'RWA', 'DEX Aggregator',
  'Leveraged Farming', 'Liquidity Manager', 'Prediction Market', 'Launchpad',
])
const EXCLUDE_CATEGORIES = new Set([
  'Chain', 'CEX', 'Bridge', 'Cross Chain Bridge', 'Canonical Bridge',
  'Liquid Staking', 'Algo-Stables', 'Reserve Currency', 'Basis Trading',
])

// Eligibility band. NO mcap/TVL ceiling — ALL cap tiers are welcome (the UI
// filters Low/Mid/High); the famous household names are dropped by NAME instead
// (RESEARCH_EXCLUDE_SYMBOLS), so what surfaces is lesser-known on-chain DeFi
// across every size. Low TVL/liquidity floors keep small-cap discovery alive
// while still requiring a real, tradeable market.
// LOWERED 2026-06-25: $250k cut fresh, small, pre-traction DeFi protocols — the
// exact genuine sub-$1M projects the desk wants. $50k still requires a real pool
// (the DexScreener liquidity/volume floors below remain the hard tradeable-market
// gate, so dust without an on-chain market still drops at the fast tier).
const TVL_MIN = 50_000               // $50k — fresh, small, pre-traction protocols welcome
const TVL_MAX = 100_000_000_000      // effectively uncapped — high caps welcome
const DS_MIN_LIQUIDITY = 20_000      // $20k — small but real, tradeable pool (protocols)
const DS_MIN_VOLUME = 8_000          // $8k/24h — actually being traded (protocols)
const ALPHA_MAX_AGE_DAYS = 120       // "NEW" if listedAt/pairCreatedAt younger than this

// ── DexScreener fresh-alpha source thresholds (the real sub-$1M layer) ─────────
// Fresh on-chain tokens with REAL traction sourced from the trending engine
// (computeTrendingTokens / handleTrendingTokens), enriched by DexScreener. These
// are alpha PROJECTS, not rugs/dust — every gate below must hold. Tuned looser
// than the trending board (we want emerging projects, not just the hottest movers)
// but strictly enough that one-sided dumps and instant-rug churn never surface.
const ALPHA_MIN_LIQUIDITY = 15_000   // $15k — real, tradeable pool
const ALPHA_MIN_VOLUME = 5_000       // $5k/24h — genuinely trading
const ALPHA_MIN_TXNS = 30            // >= 30 txns/24h — real participation, not 2 prints
const ALPHA_MIN_BUY_RATIO = 0.20     // 20-80% buys — both sides active (not a one-sided dump)
const ALPHA_MAX_BUY_RATIO = 0.80
const ALPHA_MIN_AGE_HOURS = 12       // skip <12h instant-rug / first-hour churn
const ALPHA_MAX_AGE_DAYS_SRC = 180   // skip dead >180d tokens (stale, no longer "fresh")
const ALPHA_MCAP_MAX = 5_000_000_000 // $5B ceiling — keep the surface emerging (same as CG)
const ALPHA_MAX_TOKENS = 90          // candidates SOURCED from the (per-chain unioned) board
const ALPHA_PUBLISH_CAP = 60         // hard cap on alpha tokens PUBLISHED (additive on top)
// When the source pool exceeds ALPHA_MAX_TOKENS, keep sub-$5M (low+mid) candidates
// FIRST — they're the genuine early-stage alpha the desk exists for; the larger
// caps fill any remaining budget. (The board is the only real sub-$1M source — CG's
// emerging categories floor out ~$5-10M — so we must not let mid/high caps crowd
// the micro-caps out of the bounded set.)
const ALPHA_SMALLCAP_MAX = 5_000_000
// Cap on the MEME subset of the alpha board routed into the Memes tier (alongside
// the Solana trending board). Bounds the meme fan-out; buildMemeSurfaces caps each
// surface again (DEAL_FLOW_CAP/SCORECARD_CAP/THESIS_CAP) so this is a pool ceiling.
const ALPHA_MEME_CAP = 40

// Household DeFi names "everyone knows" — dropped from the discovery feed even
// though they pass the generic trending eligibility. The desk surfaces LESSER-
// KNOWN on-chain DeFi, not the famous mid/large caps the user flagged
// (1INCH/ASTER/asBNB...). Matched case-insensitively, "$" stripped. (AAVE/UNI/LINK
// + wrapped/LST/stables already drop via isTrendingEligible.)
const RESEARCH_EXCLUDE_SYMBOLS = new Set([
  '1INCH', 'ASTER', 'ASBNB', 'CRV', 'MKR', 'SKY', 'SNX', 'COMP', 'SUSHI', 'BAL',
  'YFI', 'LDO', 'RPL', 'FXS', 'CVX', 'GMX', 'GNS', 'DYDX', 'PENDLE', 'ENA',
  'ETHFI', 'EIGEN', 'CAKE', 'RUNE', 'JUP', 'RAY', 'JTO', 'ORCA', 'PYTH', 'JLP',
  'ONDO', 'ENS', 'DRIFT', 'KMNO', 'W',
])

// Market-cap tiers for the UI filter (mcap unknown -> 'unknown').
// Tuned for EARLY-STAGE alpha discovery: catch projects before they run to
// $20-40M. low < $1M, mid $1-5M, high > $5M.
function capTierOf(mcap) {
  const m = num(mcap)
  if (!m || m <= 0) return 'unknown'
  if (m < 1_000_000) return 'low'       // < $1M  — genuine micro-cap alpha
  if (m < 5_000_000) return 'mid'       // $1M – $5M — early-stage, pre-run
  return 'high'                           // > $5M  — established / mid+
}

// Scoring weights (plan §5): traction dominates, TVL growth + momentum secondary.
const W_TRACTION = 0.50
const W_TVL_GROWTH = 0.30
const W_MOMENTUM = 0.20

const PUBLISH_CAP = 60 // bound the published set (top-N by composite score)

// Grade letter ladder (must match InstitutionalScorecard.jsx GRADE_SCORE bands).
const GRADE_LETTERS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F']
// score 0..1 -> grade letter. Generous-but-honest banding; a proxy that lacks a
// real feed lands mid-table (C/B-) rather than fabricating an A.
function scoreToGrade(s) {
  const v = Math.max(0, Math.min(1, Number(s) || 0))
  if (v >= 0.92) return 'A+'
  if (v >= 0.84) return 'A'
  if (v >= 0.76) return 'A-'
  if (v >= 0.68) return 'B+'
  if (v >= 0.60) return 'B'
  if (v >= 0.52) return 'B-'
  if (v >= 0.44) return 'C+'
  if (v >= 0.36) return 'C'
  if (v >= 0.28) return 'C-'
  if (v >= 0.18) return 'D'
  return 'F'
}
// Risk grade colour (matches DealFlowPipeline.jsx riskColor usage: green/amber/red).
function gradeColor(g) {
  if (g === 'A+' || g === 'A' || g === 'A-' || g === 'B+') return '#10B981'
  if (g === 'B' || g === 'B-' || g === 'C+') return '#FBBF24'
  return '#EF4444'
}

// networkId -> human chain label (for DealFlowPipeline `chain` + Scorecard).
const NETWORK_LABEL = {
  1: 'Ethereum', 8453: 'Base', 1399811149: 'Solana',
  56: 'BNB Chain', 137: 'Polygon', 42161: 'Arbitrum', 10: 'Optimism', 43114: 'Avalanche',
}

// ── Small helpers ────────────────────────────────────────────────────────────

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : 0 }

async function fetchJSON(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'Spectre-AI/1.0', accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  return res.json()
}

/**
 * Parse a DefiLlama protocol `address` (may carry a chain prefix) into
 * { networkId, tokenAddress }. Bare 0x.. = Ethereum. Non-EVM prefixes (solana,
 * sui, aptos, cardano, ...) and unknown prefixes return null -> dropped at source.
 * @returns {{networkId:number, tokenAddress:string}|null}
 */
function parseProtocolAddress(address) {
  if (!address || typeof address !== 'string') return null
  const raw = address.trim()
  if (!raw) return null
  if (raw.includes(':')) {
    const idx = raw.indexOf(':')
    const prefix = raw.slice(0, idx).toLowerCase()
    const addr = raw.slice(idx + 1).trim()
    const networkId = CHAIN_PREFIX_TO_NETWORK[prefix]
    if (!networkId || !addr) return null
    return { networkId, tokenAddress: addr }
  }
  // No prefix: a bare EVM hex address = Ethereum. Anything else is not EVM.
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) return { networkId: 1, tokenAddress: raw }
  return null
}

// Compute age in days from a unix timestamp (seconds OR ms). null on missing.
function ageDaysFrom(ts) {
  let t = Number(ts)
  if (!Number.isFinite(t) || t <= 0) return null
  if (t < 1e12) t *= 1000 // seconds -> ms
  const d = (Date.now() - t) / 86400000
  return d >= 0 ? d : null
}

/**
 * Source-level eligibility: emerging EVM DeFi only. Decides whether a raw
 * DefiLlama protocol enters the candidate set (BEFORE DexScreener enrichment).
 * Returns the parsed identity ({networkId, tokenAddress}) when eligible, else null.
 *
 * Drops at source: non-DeFi categories, chains other than ETH/Base/Solana,
 * majors/wrapped/LST/stables/stocks (via trending isTrendingEligible) + the
 * household-name list, and dust (below TVL_MIN). NO upper cap — all sizes pass.
 */
function isResearchDeskEligible(p) {
  if (!p || typeof p !== 'object') return null
  const category = String(p.category || '')
  if (!ALLOW_CATEGORIES.has(category) || EXCLUDE_CATEGORIES.has(category)) return null

  const symbol = p.symbol ? String(p.symbol) : ''
  if (!symbol || symbol === '-') return null

  const ident = parseProtocolAddress(p.address)
  if (!ident) return null                              // no token on a supported chain -> drop
  if (!SUPPORTED_NETWORKS.has(ident.networkId)) return null // ETH / Base / Solana only

  // Reuse the trending exclusion vocabulary (AAVE/UNI/LINK + wrapped/LST/stables/
  // peg/stocks/derivatives) PLUS the desk's household-name list.
  if (!isTrendingEligible({ symbol, name: p.name })) return null
  if (RESEARCH_EXCLUDE_SYMBOLS.has(symbol.replace(/^\$/, '').toUpperCase())) return null

  const tvl = num(p.tvl)
  if (tvl < TVL_MIN || tvl > TVL_MAX) return null      // not dust (no upper cap — all sizes welcome)

  return ident
}

// ── Stage 1 (slow): source + eligibility -> qualified universe ───────────────

/**
 * Fetch the raw DefiLlama universe (protocols + daily-revenue map).
 * @returns {Promise<{protocols:Array, revenueBySlug:Map<string,object>}>}
 */
async function fetchProtocolUniverse() {
  // /protocols is ~8MB — fetch once per slow loop, the caller caches it.
  // /overview/fees is the FREE daily-revenue feed (joined by slug). /raises is
  // PAID-gated, so backers/raise data is intentionally omitted in Phase 1.
  const [protocols, fees] = await Promise.all([
    fetchJSON(LLAMA_PROTOCOLS),
    fetchJSON(LLAMA_FEES).catch(() => null), // revenue is a nice-to-have; degrade gracefully
  ])
  const revenueBySlug = new Map()
  const feeProtos = (fees && Array.isArray(fees.protocols)) ? fees.protocols : []
  for (const fp of feeProtos) {
    const slug = String(fp.slug || '').toLowerCase()
    if (slug) revenueBySlug.set(slug, fp)
  }
  return { protocols: Array.isArray(protocols) ? protocols : [], revenueBySlug }
}

// ── CoinGecko emerging-token source (FREE, key-gated, ~10min cache, graceful) ──
//
// Self-contained, lightly rate-limited CG fetch. The lib can't import the
// monolith's cgFetch (it lives inside the 11k-line index.js with a shared serial
// queue), so we run our own minimal serial pacing here. Same base/header as
// index.js. Every helper swallows errors -> [] / null so the desk degrades to
// DeFi-only with NO regression when there's no key or CG is down.

const CG_MIN_INTERVAL_MS = CG_API_KEY ? 300 : 6500 // pro vs public pacing
let _cgLast = 0
async function cgFetch(pathAndQuery) {
  // No key short-circuit lives in the callers (fetchEmergingTokens is key-gated);
  // cgFetch itself works against the public base too, just paced slower.
  const wait = Math.max(0, CG_MIN_INTERVAL_MS - (Date.now() - _cgLast))
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  _cgLast = Date.now()
  const opts = { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(CG_FETCH_TIMEOUT_MS) }
  if (CG_API_KEY) opts.headers[CG_HEADER] = CG_API_KEY
  const res = await fetch(`${CG_BASE}${pathAndQuery}`, opts)
  if (!res.ok) throw new Error(`CG HTTP ${res.status} ${pathAndQuery}`)
  return res.json()
}

// 10-min cache for the platform map + per-category market pulls (module-scoped,
// shared across the universe rebuilds; the universe TTL is 45min so this is
// re-pulled at most ~once per universe build but kept fresh between forced rebuilds).
const CG_CACHE_TTL_MS = 10 * 60 * 1000
let _cgPlatformCache = { map: null, ts: 0 }
const _cgMarketsCache = new Map() // categoryId -> { rows, ts }

// id -> { platform, networkId, address } using the deepest preferred chain the
// token lives on (CG_PLATFORM_PREFERENCE). One cheap /coins/list call covers ALL
// coins; cached 10min. On failure returns an empty Map (tokens then get address=null).
async function fetchCgPlatformMap() {
  if (_cgPlatformCache.map && Date.now() - _cgPlatformCache.ts < CG_CACHE_TTL_MS) return _cgPlatformCache.map
  const map = new Map()
  try {
    const list = await cgFetch('/coins/list?include_platform=true')
    if (Array.isArray(list)) {
      for (const c of list) {
        const platforms = (c && c.platforms) || {}
        let picked = null
        for (const plat of CG_PLATFORM_PREFERENCE) {
          const addr = platforms[plat]
          if (addr && typeof addr === 'string' && addr.trim()) { picked = { platform: plat, address: addr.trim() }; break }
        }
        if (picked) map.set(c.id, { ...picked, networkId: CG_PLATFORM_TO_NETWORK[picked.platform] || null })
      }
    }
  } catch (err) {
    // No platform data -> tokens still surface (address:null, no on-chain enrich).
    return _cgPlatformCache.map || map
  }
  _cgPlatformCache = { map, ts: Date.now() }
  return map
}

// Fetch one category's tokens via TWO ranking passes and merge (cached 10min):
//   1. order=volume_desc   — the actively-traded head (large + mid caps)
//   2. order=market_cap_asc — the SMALL-CAP tail (so sub-$5M / sub-$1M tokens
//      actually enter the candidate set; a pure volume_desc top-50 is filled by
//      the large tokens and the small caps are NEVER fetched — the root cause of
//      the ~90%-High feed).
// Deduped by coin id (volume_desc wins on a tie, preserving the richer row first).
// [] on total failure; a single-pass failure degrades to the other pass.
async function fetchCgCategoryMarkets(categoryId) {
  const hit = _cgMarketsCache.get(categoryId)
  if (hit && Date.now() - hit.ts < CG_CACHE_TTL_MS) return hit.rows
  const passQ = (order) =>
    `/coins/markets?vs_currency=usd&category=${encodeURIComponent(categoryId)}`
    + `&order=${order}&per_page=${CG_PER_CATEGORY}&page=1&price_change_percentage=24h,7d`
  try {
    // Serial (the cgFetch queue paces them anyway); each pass independently
    // catch-guarded so one failing pass still yields the other's rows.
    const volRows = await cgFetch(passQ('volume_desc')).catch(() => [])
    const capRows = await cgFetch(passQ('market_cap_asc')).catch(() => [])
    const seen = new Set()
    const merged = []
    for (const row of [...(Array.isArray(volRows) ? volRows : []), ...(Array.isArray(capRows) ? capRows : [])]) {
      if (!row || !row.id || seen.has(row.id)) continue
      seen.add(row.id)
      merged.push(row)
    }
    if (merged.length === 0 && hit && hit.rows) return hit.rows // both passes empty -> stale
    _cgMarketsCache.set(categoryId, { rows: merged, ts: Date.now() })
    return merged
  } catch (err) {
    return (hit && hit.rows) || [] // stale on failure, else empty (graceful)
  }
}

// Token eligibility for the CG blend: emerging cap band, real volume, and NOT a
// major/stable/wrapped/meme. Reuses the trending vocabulary + the desk lists.
function isCgTokenEligible(coin, sym) {
  if (!sym) return false
  if (CG_EXTRA_EXCLUDE_SYMBOLS.has(sym)) return false
  if (RESEARCH_EXCLUDE_SYMBOLS.has(sym)) return false
  // Reuse the trending exclusion vocabulary (majors / wrapped / LST / stables /
  // tokenized stocks / peg). Pass priceUSD + change fields so isStablePeg works.
  if (!isTrendingEligible({
    symbol: sym, name: coin.name,
    priceUSD: coin.current_price,
    change24: coin.price_change_percentage_24h,
    change1: null,
  })) return false
  const mcap = num(coin.market_cap)
  if (!(mcap >= CG_MCAP_MIN && mcap <= CG_MCAP_MAX)) return false
  if (num(coin.total_volume) < CG_MIN_VOLUME) return false
  return true
}

/**
 * Source emerging tokens from CoinGecko's AI / DePIN / Gaming / Infrastructure
 * categories, mapped to universe-shaped rows (tvl:null, `_cgToken:true`).
 *
 * GRACEFUL: no CG key, no platform map, or any category failure -> the affected
 * pull is simply empty; an all-failure returns []. Bounded to CG_MAX_TOKENS total.
 *
 * change24h / change7d are stored as PLAIN PERCENTS (CG's native format) — they
 * MUST NOT be run through the Codex dual-format (see header note).
 *
 * @returns {Promise<Array<object>>} universe-shaped CG token rows (deduped by symbol)
 */
async function fetchEmergingTokens() {
  if (!CG_API_KEY) return [] // key-gated: no key -> DeFi-only (no regression)
  const platformMap = await fetchCgPlatformMap().catch(() => new Map())

  // Per-category cap so all 4 sectors get fair representation (a naive
  // fill-to-CG_MAX would let AI+DePIN consume the whole budget before Gaming /
  // Infrastructure are reached). ceil(60/4)=15 each.
  const PER_CAT_CAP = Math.ceil(CG_MAX_TOKENS / CG_CATEGORIES.length)

  const mapCoin = (coin, cat, sym) => {
    const ident = platformMap.get(coin.id) || null // {platform, networkId, address} | null
    const networkId = ident ? ident.networkId : null
    const address = ident ? ident.address : null
    return {
      id: coin.id,
      slug: coin.id,
      name: coin.name,
      symbol: sym,
      networkId,
      address,
      chain: networkId != null ? (NETWORK_LABEL[networkId] || `Chain ${networkId}`) : 'Multi-chain',
      chains: [],
      category: cat.sector,                 // canonical sector word doubles as category here
      logo: coin.image || null,
      // Token shape: NO TVL.
      tvl: null,
      tvlChange1d: null,
      tvlChange7d: null,
      // CG market fields — PLAIN PERCENTS. Stored canonically; never dual-formatted.
      mcap: coin.market_cap != null ? num(coin.market_cap) : null,
      fdv: coin.fully_diluted_valuation != null ? num(coin.fully_diluted_valuation) : null,
      priceUsd: coin.current_price != null ? num(coin.current_price) : null,
      volume24h: coin.total_volume != null ? num(coin.total_volume) : null,
      change24h: coin.price_change_percentage_24h != null ? num(coin.price_change_percentage_24h) : null,
      change7d: coin.price_change_percentage_7d_in_currency != null ? num(coin.price_change_percentage_7d_in_currency) : null,
      gecko_id: coin.id,
      url: null,
      twitter: null,
      audits: 0,
      auditLinks: [],
      listedAt: null,
      revenue24h: null,
      revenue7d: null,
      revenue30d: null,
      _cgToken: true,                        // marks the token shape for downstream branches
    }
  }

  // Collect eligible rows PER category (capped), deduping by symbol globally so a
  // multi-category token (e.g. an AI+DePIN coin) lands in just one sector bucket.
  const seenSym = new Set()
  const perCat = []
  for (const cat of CG_CATEGORIES) {
    const rows = await fetchCgCategoryMarkets(cat.id)
    const bucket = []
    for (const coin of (Array.isArray(rows) ? rows : [])) {
      if (bucket.length >= PER_CAT_CAP) break
      const sym = String(coin.symbol || '').replace(/^\$/, '').trim().toUpperCase()
      if (!sym || seenSym.has(sym)) continue
      if (!isCgTokenEligible(coin, sym)) continue
      seenSym.add(sym)
      bucket.push(mapCoin(coin, cat, sym))
    }
    perCat.push(bucket)
  }

  // Round-robin interleave the per-category buckets so the result is balanced
  // across sectors, but TIER-AWARE: walk the buckets reserving the first
  // CG_SMALLCAP_RESERVE published slots for sub-$5M (low+mid) tokens so the
  // high-volume large caps can't consume the whole budget (the regression that
  // kept the feed ~90% High). Large caps fill the remaining slots + any reserve
  // the small caps didn't use. The reserve is a FLOOR, never a pad — a tier with
  // too few real tokens is not topped up with junk.
  const isSmall = (t) => { const m = num(t.mcap); return m > 0 && m < CG_SMALLCAP_MAX }
  const smallOut = []
  const largeOut = []
  const maxLen = Math.max(0, ...perCat.map((b) => b.length))
  for (let i = 0; i < maxLen; i++) {
    for (const bucket of perCat) {
      if (i < bucket.length) (isSmall(bucket[i]) ? smallOut : largeOut).push(bucket[i])
    }
  }
  // Take all reserved small caps first (up to the reserve), then fill the rest of
  // the budget from large caps, then top up with any leftover small caps.
  const out = []
  for (const t of smallOut) { if (out.length >= CG_MAX_TOKENS || out.length >= CG_SMALLCAP_RESERVE) break; out.push(t) }
  for (const t of largeOut) { if (out.length >= CG_MAX_TOKENS) break; out.push(t) }
  for (const t of smallOut.slice(out.filter(isSmall).length)) { if (out.length >= CG_MAX_TOKENS) break; out.push(t) }
  return out
}

// ── DexScreener fresh-alpha source (the real sub-$1M layer, ZERO extra cost) ────
//
// Reuses the trending engine's output (computeTrendingTokens in dev /
// handleTrendingTokens in prod) — the canonical FRESH on-chain discovery source.
// Those rows are already DexScreener-enriched (real liquidity, volume, txns,
// buys/sells, pairCreatedAt) and span every desk chain. We DO NOT fetch anything
// new here; the trending board is INJECTED into buildResearchDeskUniverse so the
// pure lib never imports the (index.js-only) engine — the route/serverless inject
// it exactly as the memes tier reuses the same engine. ZERO billable Codex selects
// beyond what the trending engine already pays.
//
// These rows enter the SAME token-shape path as the CG blend (`_cgToken:true`,
// tvl:null) PLUS an `_alphaToken:true` sub-flag for the three-cohort publish cap.
// Trending rows carry change fields in the Codex DUAL-FORMAT — we normalize them
// to PLAIN PERCENT via normalizeCodexChange BEFORE storing (the token-shape path
// treats change24h/change7d as plain percents; storing the dual-format raw would
// corrupt small values, per the header rule).

// Alpha spans more chains than the DeFi/CG desk core (ETH/Base/Solana): the FRESH
// on-chain alpha layer also lives on Arbitrum/Optimism/Polygon/BSC. DexScreener
// (DS_CHAIN) enriches all of these, so the fast tier can still verify liquidity.
const ALPHA_SUPPORTED_NETWORKS = new Set([1, 8453, 1399811149, 42161, 10, 137, 56])

// ── Best-effort MEME classifier (shared: splits the fresh on-chain alpha source) ─
//
// isMemeToken(row) decides which side of the desk a fresh on-chain token belongs to:
//   MEME  -> the Memes tab (dealFlow/scorecards/trends/theses)
//   !MEME -> Projects (the alpha micro-PROJECT feed; selectAlphaTokens keeps these)
//
// The user is STRICT: NO obvious memes in Projects (Meep Cat, catwifhat, Greatest
// Token Alive, TRASHCAN, GTA must NOT appear there). So when ambiguous we lean MEME
// for the Projects exclusion — the token still surfaces in Memes, it just doesn't
// pollute Projects. Tunable via the lexicon + the project-signal checks below.
//
// HEURISTIC (documented, tunable). The user is STRICT, so we LEAN MEME on ambiguity:
//   1. STRONG meme signals (iconic meme families + joke/scam/character vocabulary +
//      whole-ticker memes + an emoji in the name) => MEME, NOT overridable. A real
//      DeFi/infra project does not call itself Trashcan/Pepe/Crab/Sprinkles even with
//      "Capital"/"Labs" tacked on — those are ironic joke names. (This is why the
//      earlier project-word override let "Trashcan Capital" / "Based Crab" leak.)
//   2. SOFT meme signals (generic animal/finance-adjacent words a serious project
//      MIGHT use, e.g. bull/bear/ape) => MEME UNLESS a real PROJECT word is also
//      present (protocol/finance/network/labs/swap/oracle/...). The override applies
//      ONLY to soft signals, never to strong ones.
//   3. Joke-shape: a 3+ word ALL-lowercase gimmick name with no project word
//      ("greatest token alive") => MEME.
//   4. Default => NOT meme (a plain ticker with no meme/joke signal is a project; the
//      quality gates still require real traction).
const MEME_PROJECT_WORDS = [
  // unambiguous project vocabulary — only OVERRIDES soft signals, never strong ones
  'protocol', 'finance', 'network', 'labs', 'foundation', 'infrastructure', 'infra',
  'oracle', 'bridge', 'rollup', 'layer', 'chain', 'swap', 'dex', 'lend', 'borrow',
  'yield', 'vault', 'staking', 'restaking', 'liquidity', 'perpetual', 'derivatives',
  'exchange', 'aggregator', 'router', 'treasury', 'governance', 'synthetic',
  'collateral', 'lending', 'compute', 'inference', 'depin', 'wireless', 'storage',
  'bandwidth', 'engine', 'terminal', 'analytics', 'intelligence', 'security', 'wallet',
]
// STRONG (never overridable) — iconic meme families + joke/scam/character words that
// only a memecoin uses. Substring match (catches PEPE2.0/BABYDOGE/CATWIFHAT/...).
const MEME_STRONG_SUBSTR = [
  'pepe', 'wojak', 'wojack', 'doge', 'shib', 'shiba', 'bonk', 'floki', 'wifhat',
  'dogwif', 'catwif', 'kitty', 'cumrocket', 'pumpfun', 'cheems', 'mochi', 'popcat',
  'pengu', 'froge', 'goblin', 'gremlin', 'gigachad', 'normie', 'retard', 'autis',
  'trashcan', 'trash', 'poop', 'fart', 'wassie', 'milady', 'remilio', 'sprinkle',
  'landwolf', 'safemoon', 'moonshot', 'tothemoon', 'ponzi', 'rugpull', 'scamcoin',
  'crab', 'bong', 'chad', 'inu', 'wif', 'banana', 'snek', 'turbo', 'mumu',
  // political memes
  'maga', 'boden', 'tremp', 'kamala', 'doland', 'trump',
]
// STRONG whole-ticker memes (exact symbol match — avoids false hits inside real names).
const MEME_WHOLE = new Set([
  'WEN', 'MOG', 'ELON', 'CUM', 'GOAT', 'GME', 'HARRY', 'GIGA', 'CHILL', 'WOJAK',
  'MAGA', 'TRUMP', 'GTA', 'BABY', 'CAT', 'DOG', 'MOON', 'APU', 'BRETT', 'ANDY',
])
// SOFT whole-WORD tells (regex \bword\b) — generic animal/character words a serious
// project MIGHT use; only flagged when NO project word is present. Word boundary so
// 'cat' doesn't hit "category"/"Aerodrome", 'ape' doesn't hit "Apecoin"... wait it
// would, but Apecoin is a meme anyway; 'bear' doesn't hit "wearable" (boundary).
const MEME_SOFT_WORD = ['cat', 'dog', 'baby', 'moon', 'goat', 'frog', 'toad', 'duck', 'bull', 'bear', 'ape', 'monkey', 'panda', 'hippo', 'penguin', 'wolf', 'fox', 'rat', 'pig', 'cow', 'meep', 'pup', 'hound', 'degen', 'based', 'chad']
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u

function _hasProjectWord(hay) {
  for (const w of MEME_PROJECT_WORDS) { if (hay.includes(w)) return true }
  return false
}

/**
 * Best-effort meme classifier. Accepts a trending ROW (Codex/DexScreener-shaped) or
 * a plain {symbol,name,url,twitter} object. Returns true when the token reads like a
 * memecoin (-> Memes tab), false when it reads like a real micro-project (-> Projects).
 */
function isMemeToken(row) {
  if (!row || typeof row !== 'object') return false
  const t = row.token || {}
  const rawName = String(row.name || t.name || '')
  const sym = String(row.symbol || t.symbol || '').replace(/^\$/, '').toUpperCase()
  const hay = `${sym.toLowerCase()} ${rawName.toLowerCase()}`

  // (1) STRONG, NON-overridable meme signals — emoji branding, iconic meme families,
  // joke/scam/character words, whole-ticker memes. A project word does NOT save these
  // ("Trashcan Capital" / "Based Crab" are memes despite Capital/Based-Crab).
  if (EMOJI_RE.test(rawName)) return true
  if (MEME_WHOLE.has(sym)) return true
  for (const w of MEME_STRONG_SUBSTR) { if (hay.includes(w)) return true }

  // (2) SOFT signals — generic animal/character words; MEME unless a real project word
  // is also present ("Frog Finance" -> project; "Baby Whale" -> meme). Word-boundary.
  const projectWord = _hasProjectWord(hay)
  if (!projectWord) {
    for (const w of MEME_SOFT_WORD) {
      if (new RegExp(`\\b${w}\\b`, 'i').test(hay)) return true
    }
  }

  // (3b) Joke-shape: a 3+ word ALL-lowercase name (no uppercase in the original) with
  // no project word reads like a gimmick ("greatest token alive", "meep cat coin").
  const words = rawName.trim().split(/\s+/)
  if (words.length >= 3 && !/[A-Z]/.test(rawName) && !projectWord) return true

  // (4) Default: treat as a project (the quality gates still require real traction).
  return false
}

// Light sector classifier for an alpha token from its name/symbol. No external
// feed — keyword buckets into the desk's canonical sector words; 'Emerging' is the
// honest catch-all when nothing matches (NOT a fabricated sector).
const ALPHA_SECTOR_KEYWORDS = [
  { sector: 'AI', kws: ['ai', 'agent', 'gpt', 'neural', 'llm', 'model', 'compute', 'tensor', 'data', 'inference', 'ml'] },
  { sector: 'DePIN', kws: ['depin', 'wireless', 'network', 'node', 'sensor', 'mining', 'bandwidth', 'storage', 'compute', 'gpu', 'render'] },
  { sector: 'Gaming', kws: ['game', 'gaming', 'play', 'metaverse', 'guild', 'quest', 'arena', 'pixel', 'rpg'] },
  { sector: 'DeFi', kws: ['swap', 'dex', 'lend', 'borrow', 'yield', 'vault', 'stake', 'perp', 'finance', 'fi', 'liquidity', 'amm', 'dao'] },
  { sector: 'Infrastructure', kws: ['protocol', 'chain', 'layer', 'bridge', 'oracle', 'infra', 'rollup', 'zk', 'restake', 'validator'] },
]
function classifyAlphaSector(symbol, name) {
  const hay = `${String(symbol || '')} ${String(name || '')}`.toLowerCase()
  for (const { sector, kws } of ALPHA_SECTOR_KEYWORDS) {
    for (const kw of kws) {
      if (kw.length <= 2) { if (new RegExp(`\\b${kw}\\b`, 'i').test(hay)) return sector }
      else if (hay.includes(kw)) return sector
    }
  }
  return 'Emerging'
}

// Read a trending-row field by Codex-shaped or camelCase aliases (first non-null).
function alphaPick(row, ...keys) {
  for (const k of keys) { if (row && row[k] != null) return row[k] }
  return null
}

// QUALITY GATE — alpha, NOT rugs/dust. A trending row must clear EVERY check:
// real liquidity + real volume + real txn count + two-sided buy/sell balance +
// sane pair age window + a sane mcap. Plus isTrendingEligible (drops base-L1s/
// stables/wrapped/tokenized-stocks). Light meme screen on top. Returns false to drop.
function passesAlphaSourceGate(row, ident) {
  const sym = ident.symbol
  const name = ident.name
  if (!sym) return false
  // Drop majors/wrapped/LST/stables/stocks/peg + the desk household-name list.
  if (!isTrendingEligible({ symbol: sym, name, priceUSD: alphaPick(row, 'priceUSD', 'priceUsd'), change24: alphaPick(row, 'change24'), change1: alphaPick(row, 'change1') })) return false
  if (RESEARCH_EXCLUDE_SYMBOLS.has(sym.replace(/^\$/, '').toUpperCase())) return false
  if (CG_EXTRA_EXCLUDE_SYMBOLS.has(sym.replace(/^\$/, '').toUpperCase())) return false
  // MEME SPLIT: memecoins belong in the Memes tab, NOT Projects. Drop any token the
  // best-effort classifier reads as a meme (the meme subset is routed to getMemes).
  if (isMemeToken(row)) return false

  // Real, tradeable market.
  const liq = num(alphaPick(row, 'liquidity', 'liq'))
  const vol = num(alphaPick(row, 'volume24', 'volume24h', 'volume'))
  if (liq < ALPHA_MIN_LIQUIDITY) return false
  if (vol < ALPHA_MIN_VOLUME) return false

  // Real participation, two-sided (not a one-sided dump / wash).
  const buys = num(alphaPick(row, 'buys24', 'buys'))
  const sells = num(alphaPick(row, 'sells24', 'sells'))
  const txns = alphaPick(row, 'txnCount24', 'txnCount') != null ? num(alphaPick(row, 'txnCount24', 'txnCount')) : (buys + sells)
  if (txns < ALPHA_MIN_TXNS) return false
  const total = buys + sells
  if (total > 0) {
    const ratio = buys / total
    if (ratio < ALPHA_MIN_BUY_RATIO || ratio > ALPHA_MAX_BUY_RATIO) return false
  }

  // Sane pair-age window: skip <12h instant-rug churn and dead >180d tokens.
  const ageD = ageDaysFrom(alphaPick(row, 'pairCreatedAt', 'createdAt'))
  if (ageD != null) {
    if (ageD * 24 < ALPHA_MIN_AGE_HOURS) return false
    if (ageD > ALPHA_MAX_AGE_DAYS_SRC) return false
  }
  // (age null = unknown -> allowed; the liquidity/volume/txn gates already require
  // a live, real market, so an unknown-age token here is still genuinely trading.)

  // Sane mcap — keep the surface emerging (and drop wrong-pair $100B+ glitches).
  const mcap = num(alphaPick(row, 'marketCap', 'mcap', 'fdv'))
  if (mcap > 0 && mcap > ALPHA_MCAP_MAX) return false
  if (mcap > MAX_SANE_MCAP) return false

  return true
}

// Map a gated trending row -> universe token-shape row (mirrors mapCoin's shape,
// with `_alphaToken:true`). Change fields normalized to PLAIN PERCENT (the row's
// Codex dual-format would corrupt small values in the token-shape path).
function mapAlphaToken(row, ident) {
  const sector = classifyAlphaSector(ident.symbol, ident.name)
  const mcap = num(alphaPick(row, 'marketCap', 'mcap', 'fdv'))
  const change24h = normalizeCodexChange(alphaPick(row, 'change24'))
  return {
    id: `alpha-${ident.address || ident.symbol}`,
    slug: `alpha-${ident.address || ident.symbol}`,
    name: ident.name || ident.symbol,
    symbol: ident.symbol,
    networkId: ident.networkId,
    address: ident.address,
    chain: NETWORK_LABEL[ident.networkId] || `Chain ${ident.networkId}`,
    chains: [],
    category: sector,                      // canonical sector word doubles as category
    logo: ident.logo || null,
    // Token shape: NO TVL.
    tvl: null,
    tvlChange1d: null,
    tvlChange7d: null,
    // Market fields — PLAIN PERCENTS (normalized from the row's dual-format).
    mcap: mcap > 0 ? mcap : null,
    fdv: null,
    priceUsd: alphaPick(row, 'priceUSD', 'priceUsd') != null ? num(alphaPick(row, 'priceUSD', 'priceUsd')) : null,
    volume24h: num(alphaPick(row, 'volume24', 'volume24h', 'volume')) || null,
    change24h: Number.isFinite(change24h) && change24h !== 0 ? change24h : null,
    change7d: null,                        // no 7d window on the trending row (DexScreener has no h7d)
    gecko_id: null,
    url: null,
    twitter: null,
    audits: 0,
    auditLinks: [],
    listedAt: null,
    revenue24h: null,
    revenue7d: null,
    revenue30d: null,
    _cgToken: true,                        // token shape (null-TVL market-metric grading)
    _alphaToken: true,                     // DexScreener fresh-alpha cohort (three-cohort cap)
  }
}

/**
 * Build the qualified DexScreener fresh-alpha set from an INJECTED trending board.
 * @param {Array<object>} trending - rows from computeTrendingTokens/handleTrendingTokens
 *   (already DexScreener-enriched). Pass [] (or omit the injector) to disable the source.
 * @returns {Array<object>} universe token-shape rows, gated + bounded + deduped-by-symbol.
 */
function selectAlphaTokens(trending) {
  const rows = Array.isArray(trending) ? trending : []
  const seen = new Set()
  const mapped = []
  // Gate + map ALL candidates first (preserving trending-rank order), then bound
  // sub-$5M-FIRST so the genuine micro-caps survive the cap (see ALPHA_SMALLCAP_MAX).
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const t = (row && row.token) || {}
    const ident = {
      symbol: String(alphaPick(row, 'symbol') || t.symbol || '').replace(/^\$/, '').trim().toUpperCase(),
      name: String(alphaPick(row, 'name') || t.name || '') || (t.symbol || ''),
      address: alphaPick(row, 'address') || t.address || null,
      networkId: num(alphaPick(row, 'networkId') || t.networkId) || null,
      logo: alphaPick(row, 'logo', 'logoUrl', 'image') || t.logo || (t.info && t.info.imageThumbUrl) || null,
    }
    if (!ident.symbol || !ident.address || ident.networkId == null) continue
    if (!ALPHA_SUPPORTED_NETWORKS.has(ident.networkId)) continue
    if (seen.has(ident.symbol)) continue
    if (!passesAlphaSourceGate(row, ident)) continue
    seen.add(ident.symbol)
    mapped.push(mapAlphaToken(row, ident))
  }
  // Bound, small-cap first (each cohort already in trending-rank order).
  const isSmall = (t) => { const m = num(t.mcap); return m > 0 && m < ALPHA_SMALLCAP_MAX }
  const small = mapped.filter(isSmall)
  const large = mapped.filter((t) => !isSmall(t))
  return [...small, ...large].slice(0, ALPHA_MAX_TOKENS)
}

/**
 * The MEME subset of the multi-chain alpha trending board (the OTHER side of the
 * isMemeToken split). Returns the RAW trending rows (NOT mapped) so the Memes tier
 * can feed them straight into buildMemeSurfaces alongside the Solana board. Applies
 * the SAME chain admit + the basic real-market floors (liquidity/volume) so the
 * memes shown are tradeable, not dust — but does NOT apply the Projects-only
 * eligibility (a meme is allowed to be a meme). Deduped by address, bounded.
 *
 * @param {Array<object>} trending - the multi-chain alpha board (fetchAlphaTrending)
 * @param {number} [cap=ALPHA_MEME_CAP] - max meme rows returned
 * @returns {Array<object>} raw trending rows classified as memes
 */
function selectAlphaMemes(trending, cap = ALPHA_MEME_CAP) {
  const rows = Array.isArray(trending) ? trending : []
  const seenAddr = new Set()
  const out = []
  for (const row of rows) {
    if (out.length >= cap) break
    if (!row || typeof row !== 'object') continue
    const t = (row && row.token) || {}
    const address = alphaPick(row, 'address') || t.address || null
    const networkId = num(alphaPick(row, 'networkId') || t.networkId) || null
    if (!address || networkId == null) continue
    if (!ALPHA_SUPPORTED_NETWORKS.has(networkId)) continue
    const key = String(address).toLowerCase()
    if (seenAddr.has(key)) continue
    // Only MEME-classified rows belong here (the !meme rows go to Projects).
    if (!isMemeToken(row)) continue
    // Real, tradeable market (so the Memes board shows live memes, not dead dust).
    const liq = num(alphaPick(row, 'liquidity', 'liq'))
    const vol = num(alphaPick(row, 'volume24', 'volume24h', 'volume'))
    if (liq < ALPHA_MIN_LIQUIDITY || vol < ALPHA_MIN_VOLUME) continue
    seenAddr.add(key)
    out.push(row)
  }
  return out
}

/**
 * Build the qualified universe: source + eligibility filter + dedupe.
 * SLOW (45-min) tier — sources DefiLlama, applies the eligibility gate, dedupes
 * by parentProtocol, and returns the qualified protocol descriptors (NO
 * DexScreener enrichment yet — that's the fast tier so live metrics stay fresh).
 *
 * Also returns the RAW DefiLlama `/protocols` array (unfiltered) so the caller
 * can feed the sector-rotation tier WITHOUT re-fetching the 8MB feed — the
 * sectors surface needs the whole DeFi/RWA/etc. universe, not just the qualified
 * emerging-alpha subset.
 *
 * @param {object} [opts]
 * @param {() => Promise<Array<object>>} [opts.fetchAlphaTokens] - INJECTED trending
 *   board fetcher (computeTrendingTokens in dev / handleTrendingTokens in prod).
 *   The pure lib never imports the index.js-only engine; the route/serverless
 *   inject it (same as the memes tier). Omit (or it throws) -> the alpha source is
 *   simply absent and the universe degrades to DeFi + CG (zero regression).
 * @returns {Promise<{universe:Array<object>, protocols:Array<object>, refreshedAt:string, sourceCount:number}>}
 */
async function buildResearchDeskUniverse(opts = {}) {
  const { fetchAlphaTokens } = opts || {}
  const { protocols, revenueBySlug } = await fetchProtocolUniverse()

  const seenParents = new Set()
  const seenTokens = new Set()
  const seenSymbols = new Set()  // dedupe the CG blend against protocol symbols
  const qualified = []
  for (const p of protocols) {
    const ident = isResearchDeskEligible(p)
    if (!ident) continue
    // Dedupe by parentProtocol (V2 + V3 of one protocol) AND by token identity:
    // two protocol entries that share the SAME token (e.g. Meteora DLMM + Dynamic
    // Pools both = $MET) collapse to ONE card, so no duplicate symbols reach the UI.
    const parentKey = p.parentProtocol || `slug#${p.slug}`
    const tokenKey = `${ident.networkId}:${String(ident.tokenAddress).toLowerCase()}`
    if (seenParents.has(parentKey) || seenTokens.has(tokenKey)) continue
    seenParents.add(parentKey)
    seenTokens.add(tokenKey)
    seenSymbols.add(String(p.symbol || '').replace(/^\$/, '').toUpperCase())

    const slug = String(p.slug || '').toLowerCase()
    const rev = revenueBySlug.get(slug) || null
    const audits = parseInt(p.audits, 10)

    qualified.push({
      id: p.slug,
      slug: p.slug,
      name: p.name,
      symbol: String(p.symbol || '').replace(/^\$/, ''),
      networkId: ident.networkId,
      address: ident.tokenAddress,
      chain: NETWORK_LABEL[ident.networkId] || `Chain ${ident.networkId}`,
      chains: Array.isArray(p.chains) ? p.chains : [],
      category: p.category,
      logo: p.logo || null,
      tvl: num(p.tvl),
      tvlChange1d: p.change_1d != null ? num(p.change_1d) : null,
      tvlChange7d: p.change_7d != null ? num(p.change_7d) : null,
      // change_30d is ALWAYS null from DefiLlama — never use it.
      mcap: p.mcap != null ? num(p.mcap) : null,
      gecko_id: p.gecko_id || null,
      url: p.url || null,
      twitter: p.twitter || null,
      audits: Number.isFinite(audits) ? audits : 0,
      auditLinks: Array.isArray(p.audit_links) ? p.audit_links : [],
      listedAt: p.listedAt != null ? num(p.listedAt) : null,
      // FREE daily-revenue (joined by slug). null when the protocol isn't in the
      // fees feed (young tokens) -> Revenue grade goes neutral.
      revenue24h: rev ? num(rev.total24h) : null,
      revenue7d: rev ? num(rev.total7d) : null,
      revenue30d: rev ? num(rev.total30d) : null,
    })
  }

  // ── Blend in the CoinGecko emerging tokens (ADDITIVE) ───────────────────────
  // Sourced AFTER the DefiLlama universe so the protocols are the source of truth:
  // a token already present as a DeFi protocol (by symbol OR by token identity)
  // stays as the protocol; only the rest are appended. Graceful: any CG failure
  // -> [] -> the universe is byte-for-byte the DeFi-only result above.
  const cgTokens = await fetchEmergingTokens().catch(() => [])
  for (const t of cgTokens) {
    const sym = String(t.symbol || '').replace(/^\$/, '').toUpperCase()
    if (!sym || seenSymbols.has(sym)) continue
    // Token-identity dedupe (only when the CG token resolved to a chain address).
    const tokenKey = (t.networkId != null && t.address)
      ? `${t.networkId}:${String(t.address).toLowerCase()}`
      : null
    if (tokenKey && seenTokens.has(tokenKey)) continue
    seenSymbols.add(sym)
    if (tokenKey) seenTokens.add(tokenKey)
    qualified.push(t)
  }

  // ── Blend in the DexScreener fresh-alpha tokens (ADDITIVE, the sub-$1M layer) ─
  // Sourced from the INJECTED trending board (computeTrendingTokens/handleTrendingTokens),
  // gated to real-traction projects (passesAlphaSourceGate), appended AFTER DeFi +
  // CG so those stay the source of truth (a symbol or token-identity already present
  // stays as its richer DeFi/CG row). GRACEFUL: no injector, an injector throw, or
  // an empty board -> [] -> the universe is byte-for-byte the DeFi+CG result above.
  let alphaTokens = []
  if (typeof fetchAlphaTokens === 'function') {
    try {
      const trending = await fetchAlphaTokens()
      alphaTokens = selectAlphaTokens(trending)
    } catch (_) { alphaTokens = [] } // any failure -> alpha source absent (no regression)
  }
  for (const t of alphaTokens) {
    const sym = String(t.symbol || '').replace(/^\$/, '').toUpperCase()
    if (!sym || seenSymbols.has(sym)) continue
    const tokenKey = (t.networkId != null && t.address)
      ? `${t.networkId}:${String(t.address).toLowerCase()}`
      : null
    if (tokenKey && seenTokens.has(tokenKey)) continue
    seenSymbols.add(sym)
    if (tokenKey) seenTokens.add(tokenKey)
    qualified.push(t)
  }

  return {
    universe: qualified,
    // Raw, unfiltered /protocols rows — threaded to computeSectorRotation by the
    // route/warmer so the sectors tier reuses this fetch (NO second 8MB pull).
    protocols,
    refreshedAt: new Date().toISOString(),
    sourceCount: protocols.length,
  }
}

// ── Stage 2 (fast): enrich + score + stage + grade -> bundle ─────────────────

// Convert DexScreener clean-percent change to the Codex dual-format that
// scoreTraction + the frontend fmtChange expect (|v|<100 -> ratio, else percent).
// null passes through unchanged.
function toCodexLikePct(p) {
  if (p == null || !Number.isFinite(Number(p))) return null
  const v = Number(p)
  return Math.abs(v) < 100 ? v / 100 : v
}

// Plain-percent 24h change for a row, source-aware. CoinGecko tokens store
// change24h as a PLAIN PERCENT (5.3 = +5.3%) and must NEVER pass through the
// Codex dual-format (normalizeCodexChange's |v|<1 -> x100 rule corrupts them);
// DeFi protocol rows store change24h in the Codex dual-format. Returns a percent.
function pctChange(row, field) {
  const v = row[field]
  if (v == null || !Number.isFinite(Number(v))) return 0
  return row._cgToken ? Number(v) : normalizeCodexChange(v)
}

// 5-scorecard-grade derivation. Real signals where we have a feed (Liquidity =
// depth + turnover, Revenue = DefiLlama fees, Momentum = normalized 24h change +
// accel). PROXIES where no feed exists (Concentration = audits + age + tvl/mcap,
// no holder feed; SmartMoney = TVL 7d inflow + buy/sell pressure, no wallet feed).
//
// TOKEN SHAPE (row.tvl == null, _cgToken): no TVL/revenue/audits/holder signal,
// so grades come from MARKET metrics — Liquidity from liquidity+turnover (same),
// Momentum from price change (same), SmartMoney from price-7d + buy/sell pressure
// (no TVL inflow), Concentration neutral-ish (no holder/TVL feed), Revenue neutral.
function deriveScorecard(row) {
  const isToken = row.tvl == null || row._cgToken
  const liq = num(row.liquidity)
  const vol = num(row.volume24h)
  const tvl = num(row.tvl)
  const mcap = num(row.mcap)
  // 7d signal: protocols use TVL 7d flow (tvlChange7d); tokens use price 7d (change7d).
  const c7 = isToken
    ? (row.change7d != null ? num(row.change7d) : null)
    : (row.tvlChange7d != null ? num(row.tvlChange7d) : null)
  const buys = num(row.buys24)
  const sells = num(row.sells24)
  const chg24 = Math.abs(pctChange(row, 'change24h'))
  const accel = row.recentVolRatio != null ? num(row.recentVolRatio) : null

  // Liquidity: depth (log-scaled to ~$50M) + turnover (vol/liq capped). 0..1.
  // When a token has no DexScreener pair (liq == 0) but real CG volume, grade
  // liquidity from VOLUME depth instead (a token trading $X/day has tradeable
  // liquidity even if we couldn't pin the pool) — honest, not a flat 'F'.
  let sLiq
  if (liq > 0) {
    const depth = Math.min(1, Math.log10(1 + liq) / Math.log10(1 + 50_000_000))
    const turnover = Math.min(1, (vol / liq) / 5)
    sLiq = 0.6 * depth + 0.4 * turnover
  } else if (isToken && vol > 0) {
    // Volume-only proxy (log-scaled to ~$50M), slightly discounted vs real depth.
    sLiq = 0.85 * Math.min(1, Math.log10(1 + vol) / Math.log10(1 + 50_000_000))
  } else {
    sLiq = 0
  }

  // Revenue: DefiLlama daily fees, log-scaled to ~$500k/day. Missing -> neutral.
  // Tokens have no fee feed -> always neutral ('C-').
  let sRev = null
  if (!isToken && row.revenue24h != null) {
    sRev = Math.min(1, Math.log10(1 + Math.max(0, row.revenue24h)) / Math.log10(1 + 500_000))
  }

  // Momentum: normalized 24h change (cap 60%) blended with acceleration.
  const sMomChg = Math.min(1, chg24 / 60)
  const sMomAccel = accel != null ? Math.min(1, accel / 0.5) : 0.4
  const sMom = accel != null ? 0.7 * sMomChg + 0.3 * sMomAccel : sMomChg

  // Concentration: protocols PROXY from audits + age + TVL/mcap. Tokens have no
  // holder/TVL feed -> neutral-leaning (audits=0, no age, no TVL ratio) which
  // lands ~'C'/'C-' — honest "we can't verify distribution" rather than fabricated.
  let sConc
  if (isToken) {
    sConc = 0.45 // neutral: no audit/age/TVL-ratio signal for a market-only token
  } else {
    const auditScore = Math.min(1, num(row.audits) / 2)
    const age = ageDaysFrom(row.listedAt) || ageDaysFrom(row.pairCreatedAt)
    const ageScore = age == null ? 0.3 : Math.min(1, age / 365) // older = more distributed
    let tvlMcapScore = 0.5
    if (mcap > 0) {
      const ratio = tvl / mcap // TVL >= mcap = backed by real deposits (healthy)
      tvlMcapScore = Math.min(1, ratio / 1.5)
    }
    sConc = 0.4 * auditScore + 0.3 * ageScore + 0.3 * tvlMcapScore
  }

  // Smart Money PROXY (no wallet feed): 7d momentum (TVL inflow for protocols,
  // price 7d for tokens) + buy/sell pressure. Same shape either way.
  const inflowScore = c7 == null ? 0.4 : Math.min(1, Math.max(0, c7) / 30)
  const total = buys + sells
  const pressure = total > 0 ? buys / total : 0.5 // >0.5 = net buying
  const sSmart = 0.6 * inflowScore + 0.4 * pressure

  return {
    grades: {
      liquidity: scoreToGrade(sLiq),
      concentration: scoreToGrade(sConc),
      revenue: sRev == null ? 'C-' : scoreToGrade(sRev), // neutral when no fee data (always for tokens)
      smartMoney: scoreToGrade(sSmart),
      momentum: scoreToGrade(sMom),
    },
    _numeric: { sLiq, sConc, sRev, sSmart, sMom },
  }
}

// Deal-flow stage (the 4 ids in DealFlowPipeline.jsx STAGES). Points from
// TVL / TVL-growth / audits / age (plan §6). Fresh (<21d) starts in "sourced".
//
// TOKEN SHAPE (no TVL): points come from MARKET maturity instead — mcap size,
// price-7d momentum, volume traction, and DexScreener pair age. Never NaN.
function deriveDealFlowStage(row) {
  const ageD = ageDaysFrom(row.listedAt) || ageDaysFrom(row.pairCreatedAt)
  if (ageD != null && ageD < 21) return 'sourced'

  let points = 0
  const isToken = row.tvl == null || row._cgToken
  if (isToken) {
    // Market-maturity points (no TVL/audit feed for a market-only token).
    const mcap = num(row.mcap)
    if (mcap >= 1_000_000_000) points += 2          // >$1B established
    else if (mcap >= 100_000_000) points += 1       // >$100M mid
    const c7 = row.change7d != null ? num(row.change7d) : 0 // price 7d %
    if (c7 >= 15) points += 2
    else if (c7 >= 3) points += 1
    const vol = num(row.volume24h)
    if (vol >= 25_000_000) points += 1              // deep, real trading
    if (ageD != null && ageD >= 180) points += 1    // survived 6mo+
  } else {
    const tvl = num(row.tvl)
    if (tvl >= 100_000_000) points += 2
    else if (tvl >= 25_000_000) points += 1
    const c7 = row.tvlChange7d != null ? num(row.tvlChange7d) : 0
    if (c7 >= 15) points += 2
    else if (c7 >= 3) points += 1
    if (num(row.audits) >= 2) points += 1
    if (ageD != null && ageD >= 180) points += 1
  }

  if (points >= 5) return 'positioned'
  if (points >= 3) return 'conviction'
  if (points >= 1) return 'diligence'
  return 'sourced'
}

// Canonical sector labels carried by the CoinGecko blend (category === sector).
// Passed straight through so the UI Category pills get clean labels matching the
// DeFi ones in style.
const CG_SECTOR_LABELS = new Set(['AI', 'DePIN', 'Gaming', 'Infrastructure'])

// Sector label for the cards (DealFlowPipeline `sector` + Scorecard `sector`).
// Maps DefiLlama category -> a short investor-facing sector word; CoinGecko-token
// canonical labels (AI/DePIN/Gaming/Infrastructure) pass through unchanged.
function deriveSector(category) {
  const c = String(category || '')
  if (CG_SECTOR_LABELS.has(c)) return c // CG emerging-token canonical sector
  if (c === 'Dexs' || c === 'DEX Aggregator') return 'DEX'
  if (c === 'Lending' || c === 'CDP' || c === 'Leveraged Farming') return 'Lending'
  if (c === 'Yield' || c === 'Yield Aggregator' || c === 'Liquidity Manager') return 'Yield'
  if (c === 'Derivatives' || c === 'Options' || c === 'Synthetics') return 'Derivatives'
  if (c === 'Liquid Restaking' || c === 'Restaking') return 'Restaking'
  if (c === 'RWA') return 'RWA'
  if (c === 'Prediction Market') return 'Prediction'
  if (c === 'Launchpad') return 'Launchpad'
  return 'DeFi'
}

// "NEW or RISING" alpha gate (plan §3). Runs AFTER enrichment so it can use
// pairCreatedAt / recentVolRatio / chg24h alongside listedAt / change_7d.
// For tokens the 7d "rising" signal is price-7d (change7d); change24h is read
// source-aware (pctChange) so a CG plain-percent isn't mis-scaled.
function passesAlphaGate(row) {
  const ageD = ageDaysFrom(row.listedAt) || ageDaysFrom(row.pairCreatedAt)
  const isNew = ageD != null && ageD <= ALPHA_MAX_AGE_DAYS
  const sevenD = (row.tvl == null || row._cgToken) ? row.change7d : row.tvlChange7d
  const rising = (sevenD != null && Number(sevenD) > 0)
    || (row.recentVolRatio != null && row.recentVolRatio >= 0.30)
    || (row.change24h != null && pctChange(row, 'change24h') > 0)
  return isNew || rising
}

// Build short, factual prose strings from data (NO invented narrative, Phase 1).
// Protocols read "<Category> protocol · TVL $Y · +Z% 7d"; tokens (no TVL) read
// "<Sector> token · Mcap $X · +Z% 7d" off market metrics instead.
function buildThesis(row) {
  if (row.tvl == null || row._cgToken) {
    const c7 = row.change7d != null ? `${row.change7d >= 0 ? '+' : ''}${Number(row.change7d).toFixed(1)}% 7d` : null
    const parts = [`${row.category} token`]
    if (row.mcap) parts.push(`Mcap $${fmtCompact(row.mcap)}`)
    else if (row.volume24h) parts.push(`Vol $${fmtCompact(row.volume24h)}`)
    if (c7) parts.push(c7)
    return parts.join(' · ')
  }
  const g7 = row.tvlChange7d != null ? `${row.tvlChange7d >= 0 ? '+' : ''}${row.tvlChange7d.toFixed(1)}% 7d` : null
  const tvlStr = `$${fmtCompact(row.tvl)}`
  const parts = [`${row.category} protocol`, `TVL ${tvlStr}`]
  if (g7) parts.push(g7)
  return parts.join(' · ')
}
function fmtCompact(n) {
  const v = num(n)
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return String(Math.round(v))
}

/**
 * Refresh live metrics over a qualified universe: enrich via DexScreener, apply
 * the alpha gate + DexScreener floors, score, stage, grade, rank, cap.
 * FAST (5-min) tier — keeps numbers fresh without re-sourcing DefiLlama.
 *
 * @param {Array<object>} universe - output of buildResearchDeskUniverse().universe
 * @returns {Promise<Array<object>>} ranked, bounded project bundle rows
 */
// Data-sanity clamps for live market fields. Low-liquidity bad prints / wrong-pair
// DexScreener matches produce garbage like a $391B mcap or +490951% 24h change; drop
// the value rather than display nonsense (the UI guards missing fields).
const MAX_ABS_CHG_PCT = 1000          // |24h change| beyond this is a bad print
const MAX_SANE_MCAP = 100_000_000_000 // nothing emerging is >$100B; bigger = data error
const MAX_MCAP_TVL_RATIO = 500        // mcap >> TVL by this much = wrong-pair / unit error
function saneMcap(v, tvl) {
  const m = num(v)
  if (!(m > 0) || m > MAX_SANE_MCAP) return null
  if (tvl > 0 && m > tvl * MAX_MCAP_TVL_RATIO) return null
  return m
}

async function refreshResearchDeskMetrics(universe) {
  if (!Array.isArray(universe) || universe.length === 0) return []

  // Enrich the whole qualified set (already bounded to ~50-90 by eligibility).
  const targets = universe.map((u) => ({ address: u.address, networkId: u.networkId }))
  let enrichMap = new Map()
  try {
    enrichMap = await enrichFromDexScreener(targets)
  } catch (_) { /* DexScreener down: enrichMap stays empty -> all rows drop the floor gate */ }

  const scored = []
  for (const u of universe) {
    const isToken = u._cgToken === true
    const ds = enrichMap.get(norm(u.address)) || null

    // PROTOCOL: DexScreener is REQUIRED — no good pair means we can't verify the
    // on-chain market, so it drops (plan §4). TOKEN: DexScreener is OPTIONAL —
    // CoinGecko already supplies mcap/price/volume/change, so a token with no DEX
    // pair still surfaces (just without liquidity/txn enrichment).
    if (!isToken && !ds) continue

    let liquidity, volume24h, change24h, change7d, mcap, dsMcap, row

    if (isToken) {
      // ── TOKEN SHAPE (CoinGecko) ──────────────────────────────────────────
      // CG market fields are PLAIN PERCENTS and authoritative; DexScreener (if
      // present) only ADDS liquidity/txns/recent-activity — it does NOT clobber
      // CG's mcap/volume/change.
      const cgMcap = u.mcap != null ? saneMcap(u.mcap, 0) : null // tvl=0 -> skip the tvl-ratio clamp (no TVL for a token)
      dsMcap = ds ? saneMcap(ds.marketCap, 0) : null
      mcap = cgMcap || dsMcap || null
      // volume/liquidity: prefer CG volume (category-level, reliable); take
      // liquidity from DexScreener when available (CG has no per-pool liquidity).
      volume24h = u.volume24h != null ? num(u.volume24h) : (ds ? num(ds.volume24) : 0)
      liquidity = ds ? num(ds.liquidity) : 0
      // change24h / change7d stay CG plain percents (do NOT dual-format).
      change24h = u.change24h != null ? num(u.change24h) : null
      change7d = u.change7d != null ? num(u.change7d) : null

      row = {
        ...u,
        priceUsd: u.priceUsd != null ? num(u.priceUsd) : (ds && ds.priceUsd != null ? ds.priceUsd : null),
        liquidity,
        volume24h,
        mcap,
        fdv: (u.fdv != null ? saneMcap(u.fdv, 0) : null) || dsMcap || mcap || null,
        change24h,      // PLAIN PERCENT (CG)
        change7d,       // PLAIN PERCENT (CG price 7d)
        // short-window changes only exist if DexScreener enriched (dual-format).
        change5m: ds ? toCodexLikePct(ds.chg5m) : null,
        change1h: ds ? toCodexLikePct(ds.chg1h) : null,
        change6h: ds ? toCodexLikePct(ds.chg6h) : null,
        buys24: ds ? num(ds.buys24) : 0,
        sells24: ds ? num(ds.sells24) : 0,
        txnCount24: ds && ds.txnCount24 != null ? num(ds.txnCount24) : null,
        recentVolRatio: ds && ds.recentVolRatio != null ? num(ds.recentVolRatio) : null,
        pairCreatedAt: ds ? (ds.pairCreatedAt || null) : null,
        logo: u.logo || (ds && ds.logo) || null,
        _dexEnriched: !!ds,
      }
    } else {
      // ── PROTOCOL SHAPE (DefiLlama + DexScreener) — unchanged ─────────────
      liquidity = num(ds.liquidity)
      volume24h = num(ds.volume24)
      if (liquidity < DS_MIN_LIQUIDITY) continue       // real, tradeable pool
      if (volume24h < DS_MIN_VOLUME) continue          // actually being traded

      // Merge DefiLlama identity/TVL/revenue with DexScreener live market data.
      // Codex dual-format change for fmtChange + scoreTraction; DexScreener gives
      // clean percent so convert. mcap/fdv fall back to DexScreener when DefiLlama
      // didn't supply mcap (sparse, ~24%).
      const rawChg24 = toCodexLikePct(ds.chg24h)
      change24h = (rawChg24 != null && Math.abs(normalizeCodexChange(rawChg24)) <= MAX_ABS_CHG_PCT) ? rawChg24 : null
      change7d = u.tvlChange7d
      const tvlNum = num(u.tvl)
      dsMcap = saneMcap(ds.marketCap, tvlNum)
      mcap = saneMcap(u.mcap, tvlNum) || dsMcap

      row = {
        ...u,
        // live market (DexScreener)
        priceUsd: ds.priceUsd != null ? ds.priceUsd : null,
        liquidity,
        volume24h,
        mcap,
        fdv: dsMcap || mcap || null,
        change24h,
        change5m: toCodexLikePct(ds.chg5m),
        change1h: toCodexLikePct(ds.chg1h),
        change6h: toCodexLikePct(ds.chg6h),
        buys24: num(ds.buys24),
        sells24: num(ds.sells24),
        txnCount24: ds.txnCount24 != null ? num(ds.txnCount24) : null,
        recentVolRatio: ds.recentVolRatio != null ? num(ds.recentVolRatio) : null,
        pairCreatedAt: ds.pairCreatedAt || null,
        logo: u.logo || ds.logo || null,
        _dexEnriched: true,
      }
    }

    // ── Composite score: 0.50*traction + 0.30*tvlGrowth + 0.20*momentum ──
    // scoreTraction expects Codex-shaped fields (volume24, marketCap, change24,
    // change6h/change1, createdAt). It is NOT used as a hard gate here (its
    // strict trending gates suit the memecoin board, not DeFi protocols), only
    // as the traction component — so build a relaxed shaped row and read the raw
    // weighted signal via opts. We call scoreTraction for the activity blend but
    // floor it to 0 so an internal gate can't sink an otherwise-eligible project.
    let traction
    if (isToken && !ds) {
      // No DexScreener pair: scoreTraction would gate on missing liquidity. Derive
      // a volume+momentum traction proxy directly from CG (log-scaled volume to
      // ~$50M, blended with |24h change| to a 60% cap) so a CG-only token still
      // ranks by real activity rather than collapsing to 0.
      const volPart = Math.min(1, Math.log10(1 + Math.max(0, volume24h)) / Math.log10(1 + 50_000_000))
      const momPart = Math.min(1, Math.abs(num(change24h)) / 60)
      traction = Math.max(0, 0.7 * volPart + 0.3 * momPart)
    } else {
      const tractionRow = {
        symbol: row.symbol, name: row.name,
        token: { networkId: row.networkId },
        volume24: volume24h, liquidity, marketCap: num(mcap),
        // scoreTraction's change fields are Codex dual-format. For a token,
        // change24h is a PLAIN PERCENT — convert it to dual-format ONLY for this
        // scorer input (toCodexLikePct), leaving row.change24h plain for the UI.
        txnCount24: row.txnCount24,
        change24: isToken ? toCodexLikePct(change24h) : change24h,
        change6h: row.change6h, change1: row.change1h, change5m: row.change5m,
        createdAt: row.pairCreatedAt || (row.listedAt ? row.listedAt : null),
        recentVolRatio: row.recentVolRatio,
        vol1h: ds ? ds.vol1h : null, txns1h: ds ? ds.txns1h : null,
        _dexEnriched: !!ds,
      }
      // relaxLiq keeps the traction scorer from re-applying the memecoin strict
      // liquidity/movement gates (we already enforced DeFi-appropriate floors).
      traction = Math.max(0, num(scoreTraction(tractionRow, { window: '24h', relaxLiq: true })))
    }

    // Growth component: change7d is already the right signal per shape — TVL 7d
    // flow for protocols, price 7d for tokens (set in each branch above). Both are
    // PLAIN PERCENTS, normalized to a ~30% cap.
    const tvlGrowth = change7d == null ? 0 : Math.min(1, Math.max(0, num(change7d)) / 30)
    // Momentum (|24h change|), normalized to ~40% cap. Source-aware percent.
    const mom24Pct = pctChange(row, 'change24h')
    const momentum = change24h == null ? 0 : Math.min(1, Math.abs(mom24Pct) / 40)

    // NEW-or-RISING projects rank higher, but we no longer HARD-drop the rest —
    // all cap tiers (incl. stable high-caps) surface; the composite + the UI cap
    // filter do the sorting. A small boost keeps fresh/rising alpha near the top.
    const alphaBoost = passesAlphaGate(row) ? 1.12 : 1.0
    const composite01 = (W_TRACTION * traction + W_TVL_GROWTH * tvlGrowth + W_MOMENTUM * momentum) * alphaBoost

    const scorecard = deriveScorecard(row)
    const riskGrade = scoreToGrade(
      // overall risk = blend of the 5 grade numerics + composite
      (scorecard._numeric.sLiq + scorecard._numeric.sConc +
        (scorecard._numeric.sRev == null ? 0.45 : scorecard._numeric.sRev) +
        scorecard._numeric.sSmart + scorecard._numeric.sMom) / 5 * 0.6 + composite01 * 0.4
    )

    scored.push({
      ...row,
      sector: deriveSector(row.category),
      dealFlowStage: deriveDealFlowStage(row),
      capTier: capTierOf(mcap),
      riskGrade,
      riskColor: gradeColor(riskGrade),
      trendScore: Math.round(traction * 1000) / 1000,
      compositeScore: Math.round(composite01 * 100),
      scorecard: {
        overall: riskGrade,
        grades: scorecard.grades,
        metrics: {
          // Tokens have no TVL -> null (UI guards the missing field).
          tvl: row.tvl != null ? `$${fmtCompact(row.tvl)}` : null,
          volume24h: volume24h ? `$${fmtCompact(volume24h)}` : null,
          liquidity: liquidity ? `$${fmtCompact(liquidity)}` : null,
          mcap: mcap ? `$${fmtCompact(mcap)}` : null,
          fdv: row.fdv ? `$${fmtCompact(row.fdv)}` : null,
          revenue24h: row.revenue24h != null ? `$${fmtCompact(row.revenue24h)}` : null,
        },
      },
      // Short factual prose (data-derived, no invented narrative). Phase-2 AI
      // fields stay null; the UI guards every optional field.
      thesis: buildThesis(row),
      catalyst: null,
      strengths: null,
      risks: null,
      // raises data is PAID-gated on DefiLlama -> omitted in Phase 1.
      backers: [],
      raisedUsd: null,
      lastRaise: null,
      ageDays: (() => { const a = ageDaysFrom(row.listedAt) || ageDaysFrom(row.pairCreatedAt); return a == null ? null : Math.round(a) })(),
      socials: (() => {
        const s = {}
        if (row.url) s.website = row.url
        if (row.twitter) s.x = `https://x.com/${String(row.twitter).replace(/^@/, '')}`
        return s
      })(),
      _compositeRaw: composite01,
    })
  }

  // THREE-cohort cap so each blended source is strictly ADDITIVE and none crowds
  // the others out (the high-volume tokens otherwise dominate the composite
  // ranking and starve the protocols — a regression). DeFi protocols keep their
  // FULL published slate (capped to PUBLISH_CAP for safety); CG tokens + the
  // DexScreener fresh-alpha tokens each get their own budget on top.
  //
  // The CG + alpha caps are TIER-AWARE: a plain composite-sorted slice would
  // re-bias toward high-traction (often higher-cap) tokens and undo the
  // small-cap balance we built at sourcing time, putting the feed back to ~90%
  // High. capWithSmallReserve keeps the strongest tokens BUT guarantees a
  // sub-$5M (low+mid) floor survives the slice when enough exist.
  const defiScored = scored.filter((r) => !r._cgToken && !r._alphaToken).sort((a, b) => b._compositeRaw - a._compositeRaw)
  const cgScored = scored.filter((r) => r._cgToken && !r._alphaToken).sort((a, b) => b._compositeRaw - a._compositeRaw)
  const alphaScored = scored.filter((r) => r._alphaToken).sort((a, b) => b._compositeRaw - a._compositeRaw)
  const defiKept = defiScored.slice(0, PUBLISH_CAP)                                    // protocols: unchanged set
  const cgKept = capWithSmallReserve(cgScored, CG_PUBLISH_CAP, CG_SMALLCAP_RESERVE)    // CG tokens: tier-balanced budget
  // Alpha tokens are inherently sub-$5M (sourced from the fresh on-chain board),
  // so a straight top-N already favours low/mid; no separate reserve needed.
  const alphaKept = alphaScored.slice(0, ALPHA_PUBLISH_CAP)                            // alpha tokens: additive budget
  const capped = [...defiKept, ...cgKept, ...alphaKept].sort((a, b) => b._compositeRaw - a._compositeRaw)
  // strip the internal sort keys
  for (const r of capped) { delete r._compositeRaw; delete r._alphaToken }
  return capped
}

// Take up to `cap` rows from a composite-sorted list while GUARANTEEING at least
// `reserve` sub-$5M (low+mid) rows survive when that many exist. Keeps the top
// rows by score first, then — if too few small caps made the cut — swaps the
// weakest large caps for the strongest unselected small caps until the reserve is
// met (or no more small caps remain). A FLOOR, never a pad: a list short on small
// caps is not topped up with junk, and the output stays composite-sorted.
function capWithSmallReserve(sortedRows, cap, reserve) {
  if (!Array.isArray(sortedRows) || sortedRows.length === 0) return []
  const isSmall = (r) => { const m = num(r.mcap); return m > 0 && m < CG_SMALLCAP_MAX }
  const kept = sortedRows.slice(0, cap)
  const smallInKept = kept.filter(isSmall).length
  const wantSmall = Math.min(reserve, sortedRows.filter(isSmall).length)
  if (smallInKept >= wantSmall) return kept
  // Need `wantSmall - smallInKept` more small caps. Pull the strongest small caps
  // NOT already kept, and drop the weakest large caps in `kept` to make room.
  const keptSet = new Set(kept)
  const extraSmall = sortedRows.filter((r) => isSmall(r) && !keptSet.has(r)).slice(0, wantSmall - smallInKept)
  const out = [...kept]
  for (const s of extraSmall) {
    // drop the weakest (last) LARGE cap currently in `out`
    let idx = -1
    for (let i = out.length - 1; i >= 0; i--) { if (!isSmall(out[i])) { idx = i; break } }
    if (idx === -1) break // all large caps already gone -> can't free a slot
    out.splice(idx, 1)
    out.push(s)
  }
  out.sort((a, b) => b._compositeRaw - a._compositeRaw)
  return out
}

// ── Sector Rotation (Phase 2: free, deterministic, NO AI) ────────────────────
//
// computeSectorRotation(protocols) reuses the SAME DefiLlama `protocols` array the
// universe build already fetched (NO re-fetch, ZERO billable Codex selects) and
// produces the per-sector rotation rows the trading-app SectorRotationMap.jsx
// renders. The output array matches SectorRotationMap's static ROTATION_DATA
// schema field-for-field; every prose string is DATA-DERIVED and factual (no AI,
// no invented dates / specifics). Sector ids match narrativeConfig.js SECTORS.
//
// Bucketing:
//   - DefiLlama categories map to two app sectors that DefiLlama tracks (DeFi, RWA).
//   - AI / Gaming / NFT / Infra / Layer2 have NO DefiLlama category, so protocols
//     are bucketed by symbol membership in TOKENS_BY_SECTOR (mirrored below from
//     narrativeConfig.js). A protocol matched by symbol wins its sector even if its
//     DefiLlama category would also map to DeFi (the narrative sector is more
//     specific, e.g. a gaming-L2 DEX belongs in `gaming`/`layer2`).
//   - Memes are intentionally minimal/dormant here — the Memes pipeline owns memes,
//     so this rotation rarely surfaces a memes row (only if a meme symbol happens
//     to carry DeFi TVL in the universe).

// DefiLlama category -> app sector. Only DeFi + RWA have native DefiLlama categories.
const DEFI_CATEGORIES = new Set([
  'Dexs', 'Lending', 'Yield', 'Yield Aggregator', 'Derivatives', 'CDP', 'Options',
  'Synthetics', 'DEX Aggregator', 'Leveraged Farming', 'Liquidity Manager',
  'Prediction Market',
])
const RWA_CATEGORIES = new Set(['RWA'])

// Symbol -> app sector. Mirrors narrativeConfig.js TOKENS_BY_SECTOR for the sectors
// DefiLlama does NOT categorise (ai/gaming/nft/infra/layer2). Kept here verbatim so
// the lib stays self-contained (the frontend constant is not importable server-side).
// `defi`/`rwa`/`memes` symbol lists are omitted: defi/rwa bucket by DefiLlama
// category, and memes are owned by the Memes pipeline.
const SECTOR_SYMBOL_MAP = (() => {
  const TOKENS_BY_SECTOR = {
    ai: ['FET', 'AGIX', 'OCEAN', 'RNDR', 'TAO', 'AKT', 'AI16Z', 'GPT', 'NMR', 'VAI', 'COTI', 'AI'],
    gaming: ['IMX', 'GALA', 'AXS', 'SAND', 'MANA', 'ENJ', 'GMT', 'MAGIC', 'PIXEL', 'RON', 'YGG', 'ILV', 'ALICE'],
    infra: ['ARB', 'OP', 'MATIC', 'AVAX', 'ATOM', 'DOT', 'SOL', 'ETH', 'BNB', 'FTM', 'NEAR', 'APT', 'SUI', 'TIA', 'INJ', 'SEI', 'STRK'],
    layer2: ['ARB', 'OP', 'STRK', 'MNT', 'METIS', 'BOBA', 'IMX', 'ZKSYNC', 'SCROLL', 'BLAST', 'LINEA', 'MODE'],
    nft: ['BLUR', 'APE', 'LOOKS', 'X2Y2', 'MAGIC', 'DEGEN', 'FAR', 'PUDGY', 'MAYC', 'BAYC', 'AZUKI', 'PUNKS'],
  }
  // First-match-wins precedence for symbols that appear in multiple lists:
  //   gaming first  -> IMX/MAGIC land in gaming (their canonical narrative, and where
  //                    the frontend ROTATION_DATA places them) instead of layer2/nft.
  //   nft next      -> NFT-marketplace symbols beat the generic buckets.
  //   layer2 > infra-> ARB/OP/STRK are L2s first, not generic infrastructure.
  //   ai then infra -> remaining symbols.
  const ORDER = ['gaming', 'nft', 'layer2', 'ai', 'infra']
  const map = new Map()
  for (const sector of ORDER) {
    for (const sym of TOKENS_BY_SECTOR[sector]) {
      if (!map.has(sym)) map.set(sym, sector) // first sector in ORDER claims the symbol
    }
  }
  return map
})()

// All 8 narrativeConfig sector ids — emitted in this stable order regardless of data.
const ROTATION_SECTOR_IDS = ['ai', 'rwa', 'defi', 'infra', 'memes', 'gaming', 'layer2', 'nft']

// Per-sector descriptor (sector-level factual context for the deterministic prose).
const SECTOR_DESC = {
  ai: 'AI & compute',
  rwa: 'real-world assets',
  defi: 'DeFi',
  infra: 'infrastructure',
  memes: 'meme',
  gaming: 'gaming',
  layer2: 'Layer-2 scaling',
  nft: 'NFT & social',
}

// Assign ONE app sector to a protocol. Symbol match (ai/gaming/nft/infra/layer2)
// wins over DefiLlama category (defi/rwa). Returns null when it fits no sector.
function sectorForProtocol(p) {
  const sym = String(p.symbol || '').replace(/^\$/, '').toUpperCase()
  if (sym && SECTOR_SYMBOL_MAP.has(sym)) return SECTOR_SYMBOL_MAP.get(sym)
  const cat = String(p.category || '')
  if (RWA_CATEGORIES.has(cat)) return 'rwa'
  if (DEFI_CATEGORIES.has(cat)) return 'defi'
  return null
}

// Phase from the TVL-weighted 7d flow sign+magnitude blended with momentum.
// Mirrors the 4 PHASES ids in SectorRotationMap.jsx.
function derivePhase(flowPct, momentum) {
  if (flowPct >= 8) return 'markup'            // strong inflow + trend
  if (flowPct >= 0) return momentum >= 50 ? 'markup' : 'accumulation'
  if (flowPct > -8) return 'distribution'      // mild outflow / topping
  return 'markdown'                            // heavy outflow / risk-off
}

// Conviction from momentum bands (matches the High/Medium/Low used by the cards).
function deriveConviction(momentum) {
  if (momentum >= 65) return 'High'
  if (momentum >= 45) return 'Medium'
  return 'Low'
}

// Signed capital flow string from sectorTvl * (weighted 7d %)/100. e.g. '+$142M'.
function fmtSignedUsd(v) {
  const sign = v >= 0 ? '+' : '-'
  return `${sign}$${fmtCompact(Math.abs(v))}`
}

// '3.2%' style dominance / percentage.
function fmtPct(v) { return `${(Number(v) || 0).toFixed(1)}%` }

/**
 * computeSectorRotation(protocols)
 * Pure, deterministic, FREE sector-rotation builder. Reuses the DefiLlama
 * `protocols` array already fetched by the universe build (NO re-fetch, NO Codex).
 *
 * @param {Array<object>} protocols - raw DefiLlama /protocols rows
 *   (each: { name, symbol, address, category, tvl, change_1d, change_7d, mcap, chains, audits, listedAt })
 * @returns {Array<object>} one row per app sector, schema-matching ROTATION_DATA
 *   in apps/trading/src/components/SectorRotationMap.jsx. Empty array on bad input.
 */
// Sector topMover/keyTokens guard: DefiLlama change_1d is garbage for many tiny
// protocols (TVL-calc artifacts, e.g. +7430689%). Never let those headline a sector.
const MOVER_MAX_ABS_PCT = 1000
const MOVER_MIN_TVL = 250_000
function crediblePct(v) { return (v != null && Math.abs(v) <= MOVER_MAX_ABS_PCT) ? v : null }
function isCredibleMover(m) {
  if (!m || crediblePct(m.change1d) == null) return false
  if (!m.symbol || m.symbol === '-' || String(m.symbol).length > 14) return false
  return m.tvl >= MOVER_MIN_TVL
}

function computeSectorRotation(protocols) {
  if (!Array.isArray(protocols) || protocols.length === 0) return []

  // Bucket protocols by app sector.
  const buckets = new Map()
  for (const id of ROTATION_SECTOR_IDS) buckets.set(id, [])
  let totalTvl = 0
  for (const p of protocols) {
    if (!p || typeof p !== 'object') continue
    const tvl = num(p.tvl)
    if (tvl <= 0) continue // no TVL -> not part of capital-flow accounting
    const sid = sectorForProtocol(p)
    if (!sid) continue
    buckets.get(sid).push({
      name: p.name || '',
      symbol: String(p.symbol || '').replace(/^\$/, '').toUpperCase(),
      category: String(p.category || ''),
      tvl,
      change1d: p.change_1d != null ? num(p.change_1d) : null,
      change7d: p.change_7d != null ? num(p.change_7d) : null,
      mcap: p.mcap != null ? num(p.mcap) : null,
    })
    totalTvl += tvl
  }

  // First pass: compute raw sector aggregates (flowPct + momentum inputs).
  const raw = []
  for (const sid of ROTATION_SECTOR_IDS) {
    const members = buckets.get(sid)
    const sectorTvl = members.reduce((s, m) => s + m.tvl, 0)

    // TVL-weighted average 7d change (the signed flowPct). Members without a 7d
    // figure are excluded from the weighting (not treated as 0) so a sparse sector
    // isn't dragged to flat by missing data.
    let w7 = 0, tvl7 = 0
    for (const m of members) {
      if (m.change7d == null) continue
      w7 += m.change7d * m.tvl
      tvl7 += m.tvl
    }
    const flowPct = tvl7 > 0 ? w7 / tvl7 : 0

    // TVL-weighted average 1d change — used for the momentum signal.
    let w1 = 0, tvl1 = 0
    for (const m of members) {
      if (m.change1d == null) continue
      w1 += m.change1d * m.tvl
      tvl1 += m.tvl
    }
    const avg1d = tvl1 > 0 ? w1 / tvl1 : 0

    // Best 1d mover in the sector (symbol + signed % rounded). null when empty.
    let topMover = null
    for (const m of members) {
      if (!isCredibleMover(m)) continue
      if (!topMover || m.change1d > topMover.change1d) topMover = { symbol: m.symbol, change1d: m.change1d }
    }

    raw.push({
      sectorId: sid,
      members,
      activeProjects: members.length,
      sectorTvl,
      flowPct,
      avg1d,
      topMover,
    })
  }

  // Momentum is normalized WITHIN the sector set (plan: 0-100 across the rotation).
  // Blend the flow strength and short-term 1d trend, scaled to the set's own spread.
  const flowAbsMax = Math.max(1, ...raw.map((r) => Math.abs(r.flowPct)))
  const oneAbsMax = Math.max(1, ...raw.map((r) => Math.abs(r.avg1d)))

  const out = []
  for (const r of raw) {
    // Normalize flow & 1d into 0..1 relative to the set, centred so a leading
    // inflow sector tops the gauge and a leading outflow sector floors it.
    const flowNorm = (r.flowPct / flowAbsMax + 1) / 2          // 0..1
    const oneNorm = (r.avg1d / oneAbsMax + 1) / 2              // 0..1
    const momentum = Math.round(Math.max(0, Math.min(100, (0.65 * flowNorm + 0.35 * oneNorm) * 100)))

    const flowPct = Math.round(r.flowPct * 10) / 10            // 1-decimal signed %
    const weeklyChange = flowPct                               // weeklyChange === flowPct (plan)
    const flowDirection = flowPct >= 0 ? 'inflow' : 'outflow'
    const capitalFlowUsd = r.sectorTvl * (flowPct / 100)
    const phase = derivePhase(flowPct, momentum)
    const conviction = deriveConviction(momentum)
    const desc = SECTOR_DESC[r.sectorId] || r.sectorId

    const topMoverStr = r.topMover
      ? `${r.topMover.symbol} ${r.topMover.change1d >= 0 ? '+' : ''}${Math.round(r.topMover.change1d)}%`
      : '-'

    // Dominance = sector TVL / total tracked TVL.
    const dominance = totalTvl > 0 ? fmtPct((r.sectorTvl / totalTvl) * 100) : '0.0%'

    // Top ~4 members by TVL for keyTokens. Dedupe by symbol (DefiLlama lists
    // multiple protocol entries per token) and drop blank/'-'/junk symbols.
    const ktSeen = new Set()
    const keyTokens = [...r.members]
      .sort((a, b) => b.tvl - a.tvl)
      .filter((m) => {
        const sym = (m.symbol || '').toUpperCase()
        if (!sym || sym === '-' || sym.length > 14) return false
        if (ktSeen.has(sym)) return false
        ktSeen.add(sym)
        return true
      })
      .slice(0, 4)
      .map((m) => ({
        symbol: m.symbol,
        change: crediblePct(m.change1d) == null ? '-' : `${m.change1d >= 0 ? '+' : ''}${Math.round(m.change1d)}%`,
        role: m.category ? `${m.category} protocol` : `${desc} protocol`,
        socials: {},
      }))

    // ── Deterministic, factual prose (NO AI, NO invented specifics) ──
    const tvlStr = `$${fmtCompact(r.sectorTvl)}`
    const flowWord = flowPct >= 0 ? 'inflows' : 'outflows'
    const signal = r.activeProjects === 0
      ? `No tracked ${desc} protocols with active TVL this cycle.`
      : `${r.activeProjects} ${desc} protocol${r.activeProjects === 1 ? '' : 's'}, ${tvlStr} TVL, ${flowPct >= 0 ? '+' : ''}${flowPct}% 7d ${flowWord}.`

    const insight = r.activeProjects === 0
      ? `The ${desc} sector has no tracked protocols carrying active TVL in the current universe, so no rotation signal is available.`
      : [
          `The ${desc} sector spans ${r.activeProjects} tracked protocol${r.activeProjects === 1 ? '' : 's'} holding ${tvlStr} in TVL (${dominance} of tracked DeFi TVL).`,
          `TVL-weighted flow is ${flowPct >= 0 ? '+' : ''}${flowPct}% over 7d (${flowDirection}) with a momentum score of ${momentum}/100, placing it in the ${phase} phase.`,
          r.topMover ? `Strongest 1d mover: ${topMoverStr}.` : `No single 1d mover stands out across the sector.`,
        ].join(' ')

    // Catalysts/risks: data-derived bullet phrasing keyed off the sector's own
    // numbers (factual, no fabricated dates/partnerships).
    const catalysts = [
      flowPct >= 0
        ? `Net 7d capital ${flowWord} of ${fmtSignedUsd(capitalFlowUsd)} across the sector`
        : `Watch for a flow reversal — currently ${fmtSignedUsd(capitalFlowUsd)} over 7d`,
      r.topMover
        ? `${topMoverStr} leading 1d performance signals rotation interest`
        : `Broad-based moves rather than a single leader keep the sector balanced`,
      momentum >= 50
        ? `Momentum at ${momentum}/100 supports continuation in the ${phase} phase`
        : `A momentum reset to ${momentum}/100 leaves room for accumulation`,
    ]
    const risks = [
      flowPct < 0
        ? `Capital is rotating OUT — ${fmtSignedUsd(capitalFlowUsd)} of 7d outflows`
        : `Inflows can reverse quickly; ${tvlStr} of TVL is exposed to a risk-off move`,
      conviction === 'Low'
        ? `Low conviction (${momentum}/100 momentum) — moves may lack follow-through`
        : `Crowded positioning risk if ${conviction.toLowerCase()} conviction unwinds`,
      r.activeProjects <= 3
        ? `Thin coverage (${r.activeProjects} tracked protocol${r.activeProjects === 1 ? '' : 's'}) concentrates sector risk`
        : `Concentration risk — top protocols dominate the sector's ${tvlStr} TVL`,
    ]

    out.push({
      sectorId: r.sectorId,
      phase,
      flowDirection,
      flowPct,
      weeklyChange,
      capitalFlow: fmtSignedUsd(capitalFlowUsd),
      momentum,
      conviction,
      topMover: topMoverStr,
      signal,
      extended: {
        sectorTvl: tvlStr,
        volume7d: '-', // not derivable from DefiLlama /protocols (no volume field) — omit
        dominance,
        activeProjects: r.activeProjects,
        insight,
        keyTokens,
        catalysts,
        risks,
      },
    })
  }

  return out
}

module.exports = {
  buildResearchDeskUniverse,
  refreshResearchDeskMetrics,
  computeSectorRotation,
  // exported for the route + warmer + tests
  isResearchDeskEligible,
  parseProtocolAddress,
  fetchProtocolUniverse,
  fetchEmergingTokens,
  selectAlphaTokens,
  selectAlphaMemes,
  isMemeToken,
  scoreToGrade,
  CHAIN_PREFIX_TO_NETWORK,
  SUPPORTED_NETWORKS,
  ALPHA_SUPPORTED_NETWORKS,
  CG_CATEGORIES,
  CG_PLATFORM_TO_NETWORK,
  capTierOf,
  PUBLISH_CAP,
}
