/**
 * GeckoTerminal screener - trending/new pool lists for chains Codex can't screen.
 *
 * Codex filterTokens has no coverage for Robinhood Chain (Arbitrum Orbit L2,
 * chainId 4663, mainnet 2026-07-01), but GeckoTerminal indexed it on day one
 * (network slug `robinhood`, Uniswap v2/v3/v4 + DyorSwap pools). The GT public
 * API is CORS-open (`access-control-allow-origin: *`) and rate-limited at
 * ~30 req/min per IP, so we call it directly from the client - same pattern as
 * the existing in-browser DexScreener lookups - and keep a 60s module cache +
 * in-flight dedup. Mirrored in apps/trading/src/services/geckoTerminalApi.js -
 * keep the two in step.
 *
 * TWO-STAGE (2026-09-01). The pool list alone lies about size and depth:
 *   - GT computes `fdv_usd` PER POOL, and exotic-quote pools return garbage
 *     (SPCX/SPACEHOOD said $523 while the token is $6.07M). The old "deepest
 *     pool wins the snapshot" rule picked exactly those pools, because the
 *     broken ones were often the deepest - SPCX rendered a $549 market cap.
 *   - A pool page only holds the pools that made the top-60-by-volume cut, so
 *     summing them undercounts a token spread over 20 pools (SPCX: $28.5M
 *     summed vs $46.6M actual).
 * So: pools give identity, per-window changes, age, txns and pool count; the
 * `/tokens/multi` endpoint (30 addresses/call) gives the AUTHORITATIVE price,
 * market cap, total 24h volume, total liquidity and CoinGecko id. Pool-derived
 * numbers survive only as the fallback when hydration fails.
 *
 * Rows come back in a flat neutral shape: address, symbol, price, the change
 * windows, marketCap, volume24, liquidity, txns, createdAt, poolCount, safety.
 * Each app maps that into its own row type - the trading hub's `mapCodexRow`
 * shape, or the research app's `useTrendingTokens` shape via `formatGtRow`.
 */

const GT_BASE = 'https://api.geckoterminal.com/api/v2'

// networkId -> GT network slug, ONLY for chains with no Codex coverage.
// Chains Codex does screen must stay out of here - the Codex path is richer
// (holders, spam filter, server cache).
export const GT_ONLY_NETWORKS = {
  4663: 'robinhood',
}

// Resolve a chain-rail networkIds selection to a GT-only networkId (or null).
// Only single-chain selections route to GT; multi-chain sets stay on Codex.
export function gtOnlyNetworkFor(networkIds) {
  if (!Array.isArray(networkIds) || networkIds.length !== 1) return null
  const id = Number(networkIds[0])
  return GT_ONLY_NETWORKS[id] ? id : null
}

const CACHE_TTL = 60_000
// Pooled-liquidity floor, in USD, under which a row is a dead pool rather than
// a thin one. $500 is well below anything tradeable and well above the $0-$1
// that a drained pool reports.
const DEAD_POOL_LIQUIDITY = 500
// GT serves at most 3 pages of pools per network (page 4 is an error object).
const POOL_PAGES = 3

/**
 * The pool lists to union, and why there is more than one.
 *
 * `/pools?sort=h24_volume_usd_desc` is only ONE slice of the chain: 3 pages =
 * 60 pools, and on a chain with 36 DEXes that surfaced ~35 tokens, of which
 * ~30 survived the liquidity floor. Measured 2026-09-02, the other lists are
 * largely DISJOINT - tx-count adds +13 tokens the volume sort never shows,
 * new_pools +49, trending_pools +37. Unioning them takes the Robinhood board
 * from ~30 tradeable rows to ~86, and the names it was missing were not dust:
 * QQQ, TSLA, AAPL, GOOGL, LLY, COIN, DJT, RBLX, NET.
 *
 * Budget: GT's keyless tier is ~30 requests/min PER IP and we call it from the
 * browser, so this is deliberately 9 pool requests + ~4 hydration calls behind
 * the 60s cache, not the full 12-request sweep the probe used. Volume keeps all
 * three pages because it is the primary ranking; the others earn two each.
 */
const POOL_SOURCES = [
  { path: (p) => `/pools?include=base_token&sort=h24_volume_usd_desc&page=${p}`, pages: 3 },
  { path: (p) => `/new_pools?include=base_token&page=${p}`,                      pages: 1 },
  { path: (p) => `/trending_pools?include=base_token&page=${p}`,                 pages: 1 },
]
// /tokens/multi accepts 30 addresses per call.
const MULTI_CHUNK = 30
// /tokens/multi is the expensive half of a refresh; cap it at the rows the
// table can actually show (DenseTable slices to 100).
const HYDRATE_LIMIT = 60
// How long a fully-hydrated set stays usable as a fallback when a later refresh
// gets rate-limited. Stale-but-correct beats fresh-but-wrong.
const LAST_GOOD_TTL = 15 * 60_000
const _cache = new Map()    // slug -> { rows, ts }
const _inflight = new Map() // slug -> Promise<rows>
const _lastGood = new Map() // slug -> { rows, ts } — last FULLY hydrated set

const num = (v) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}
// GT occasionally returns a NEGATIVE reserve_in_usd / total_reserve_in_usd on a
// broken pool (ROBINCAT: -$438,973). A negative depth is not a number a trader
// can act on - floor it at zero so the thin-liquidity flag catches it instead.
const usd = (v) => Math.max(0, num(v))

/**
 * Absurdity ceilings. When /tokens/multi is unavailable (rate limit, outage) we
 * fall back to the median FDV across a token's pools, and a token whose pools
 * quote it against a broken pair can produce a number with no relationship to
 * reality - COBIE came back at $2.4e19, which renders as "$24557165866B" and
 * makes the whole board look fake. Anything past these ceilings is not a big
 * number, it is a broken one: it becomes 0, which reads as an honest em dash
 * and raises UNKNOWN_SUPPLY rather than printing fiction.
 */
const MAX_SANE_MCAP = 1e13   // > total crypto market cap
const MAX_SANE_LIQ = 1e10    // no single-chain pool holds $10B
const MAX_SANE_VOL = 1e11
const sane = (v, ceiling) => (v > 0 && v < ceiling ? v : 0)

// GT answers 429 for a while once an IP trips the keyless limit, and this runs
// in the BROWSER - a user with several tabs, or the chart adapters fetching
// alongside us, can trip it through no fault of this module. Hammering through
// it just extends the penalty, so one 429 parks every GT call for a minute and
// callers fall back to the cached/last-good set.
let _throttledUntil = 0
export const gtThrottled = () => Date.now() < _throttledUntil

async function gtFetch(url) {
  if (gtThrottled()) throw new Error('GeckoTerminal 429 (cooling down)')
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(9000),
  })
  if (res.status === 429) {
    _throttledUntil = Date.now() + 60_000
    throw new Error('GeckoTerminal 429')
  }
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status}`)
  return res.json()
}

async function fetchPoolsPage(slug, path) {
  return gtFetch(`${GT_BASE}/networks/${slug}${path}`)
}

// Merge GT pool pages into one row per base token. The pool that actually
// DISCOVERS the price - the one with the most 24h volume - owns the price and
// change windows; the deepest pool is often an exotic-quote pool whose numbers
// are nonsense. Volume, liquidity and txns sum across the token's visible
// pools (superseded by the token endpoint when hydration lands).
function mergePages(pages, networkId) {
  const byToken = new Map()
  for (const json of pages) {
    const included = new Map()
    for (const inc of json?.included || []) {
      if (inc?.type === 'token') included.set(inc.id, inc.attributes || {})
    }
    for (const p of json?.data || []) {
      const a = p?.attributes || {}
      const baseRef = p?.relationships?.base_token?.data?.id
      if (!baseRef) continue
      const tok = included.get(baseRef) || {}
      // Token ids are `${slug}_${address}`; fall back to parsing when the
      // included sideload misses an entry.
      const address = tok.address || baseRef.split('_').slice(1).join('_')
      if (!address) continue
      const chg = a.price_change_percentage || {}
      const tx = (a.transactions && a.transactions.h24) || {}
      const liquidity = usd(a.reserve_in_usd)
      const volume24 = num(a.volume_usd?.h24)
      const txns = (parseInt(tx.buys) || 0) + (parseInt(tx.sells) || 0)
      const createdAt = a.pool_created_at ? Date.parse(a.pool_created_at) : null
      const price = num(a.base_token_price_usd)
      // FDV first - GT's market_cap_usd is the CG-LINKED GLOBAL coin's cap
      // (Robinhood WETH showed $4B); fdv_usd is scoped to this deployment.
      const poolFdv = num(a.fdv_usd) || num(a.market_cap_usd)
      const snapshot = {
        price,
        change5m: num(chg.m5),
        change1h: num(chg.h1),
        change4h: num(chg.h6), // GT has no 4h bucket; 6h is the nearest
        change: num(chg.h24),
      }
      const prev = byToken.get(address)
      if (!prev) {
        byToken.set(address, {
          address,
          symbol: (tok.symbol || '').toUpperCase(),
          name: tok.name || tok.symbol || '',
          networkId,
          ...snapshot,
          marketCap: 0,
          volume24,
          liquidity,
          logo: tok.image_url && tok.image_url !== 'missing.png' ? tok.image_url : '',
          holders: 0, // GT does not expose holder counts - render as em dash, never fake
          txns,
          createdAt,
          poolCount: 1,
          _leadVol: volume24,
          _fdvs: poolFdv > 0 ? [poolFdv] : [],
          _prices: price > 0 ? [price] : [],
        })
      } else {
        prev.volume24 += volume24
        prev.liquidity += liquidity
        prev.txns += txns
        prev.poolCount += 1
        if (poolFdv > 0) prev._fdvs.push(poolFdv)
        if (price > 0) prev._prices.push(price)
        // Highest-volume pool owns price + change windows.
        if (volume24 > prev._leadVol) { prev._leadVol = volume24; Object.assign(prev, snapshot) }
        if (createdAt && (!prev.createdAt || createdAt < prev.createdAt)) prev.createdAt = createdAt
        if (!prev.logo && tok.image_url && tok.image_url !== 'missing.png') prev.logo = tok.image_url
      }
    }
  }
  return [...byToken.values()]
}

const median = (arr) => {
  if (!arr || arr.length === 0) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Fetch authoritative token-level numbers for up to 30 addresses per call.
async function fetchTokensMulti(slug, addresses) {
  const json = await gtFetch(`${GT_BASE}/networks/${slug}/tokens/multi/${addresses.join(',')}`)
  const out = new Map()
  for (const t of json?.data || []) {
    const a = t?.attributes || {}
    if (!a.address) continue
    out.set(String(a.address).toLowerCase(), a)
  }
  return out
}

/**
 * Deterministic quality read on a GT row - facts only, no model.
 * Returns { grade: 'clean'|'watch'|'risky', flags: string[] }.
 *   turnover  = 24h volume / pooled liquidity. Above ~50x the "volume" is a
 *               handful of dollars passed around, not a market you can exit.
 *   depth     = pooled liquidity. Under $25k a $5k sell moves the price 20%+.
 *   dispersion= spread between the token's own pool prices; a >1.5x spread
 *               means the quoted price depends on which pool you hit.
 */
export function gradeGtRow(row) {
  const flags = []
  const liq = Number(row.liquidity) || 0
  const vol = Number(row.volume24) || 0
  const mcap = Number(row.marketCap) || 0
  const turnover = liq > 0 ? vol / liq : Infinity
  // Turnover and depth-vs-size only mean something while the exit is small.
  // USDG is the chain's quote asset - $1.3B through $16M of pooled liquidity is
  // 81x turnover and completely benign, because $16M is a real exit. The trap
  // is a token where the volume is loud AND the door is narrow.
  const SMALL_EXIT = 1_000_000
  if (liq < 25_000) flags.push('THIN_LIQUIDITY')
  if (turnover > 50 && liq < SMALL_EXIT) flags.push('WASH_TURNOVER')
  if (row.poolCount === 1) flags.push('SINGLE_POOL')
  if (row._priceDispersion > 1.5) flags.push('PRICE_DISPERSION')
  if (!mcap) flags.push('UNKNOWN_SUPPLY')
  const ageH = row.createdAt ? (Date.now() - row.createdAt) / 36e5 : null
  if (ageH != null && ageH < 24) flags.push('UNDER_24H')
  // Depth relative to size - a $50M cap sitting on $30k of liquidity is a
  // paper valuation, and that gap is what traps a lowcap buyer.
  if (mcap > 0 && liq > 0 && liq < SMALL_EXIT && liq / mcap < 0.005) flags.push('SHALLOW_VS_MCAP')
  const hard = flags.some((f) => f === 'THIN_LIQUIDITY' || f === 'WASH_TURNOVER' || f === 'PRICE_DISPERSION')
  const grade = hard ? 'risky' : flags.length === 0 ? 'clean' : 'watch'
  return { grade, flags, turnover }
}

/**
 * Fetch screener rows for a GT-only network.
 * kind: 'top' (by 24h volume) | 'new' (newest pools).
 * Returns rows in the TrendingHub table shape; throws on total GT failure.
 */
export async function fetchGtScreenerRows(networkId, { kind = 'top' } = {}) {
  const slug = GT_ONLY_NETWORKS[Number(networkId)]
  if (!slug) throw new Error(`No GeckoTerminal slug for network ${networkId}`)
  // ONE cached union per chain, not one per `kind`. Every section of the hub
  // (trending, gainers, losers, volume, most-traded, new pairs, holders) sorts
  // the same rows client-side, so fetching per-kind just bought two partial
  // views of the chain for double the rate-limit budget. `kind` is now only a
  // hint - the caller does the ordering.
  const key = slug
  const cached = _cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.rows
  if (_inflight.has(key)) return _inflight.get(key)
  const promise = (async () => {
    const paths = []
    for (const src of POOL_SOURCES) {
      for (let p = 1; p <= Math.min(src.pages, POOL_PAGES); p++) paths.push(src.path(p))
    }
    const settled = await Promise.allSettled(paths.map((p) => fetchPoolsPage(slug, p)))
    const pages = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value)
    if (pages.length === 0) {
      throw settled[0].reason instanceof Error ? settled[0].reason : new Error('GeckoTerminal unavailable')
    }
    const rows = mergePages(pages, Number(networkId))

    // Stage 2: authoritative token-level hydration. Best-effort - a failed
    // chunk leaves those rows on their (sanitised) pool-derived numbers.
    //
    // Hydrate the rows a user can actually reach, not the whole tail: the table
    // caps at 100 and the deepest-volume rows are the ones anyone reads. This
    // keeps the request count flat as the union grows.
    const byVol = [...rows].sort((a, b) => (b.volume24 || 0) - (a.volume24 || 0))
    const addrs = byVol.slice(0, HYDRATE_LIMIT).map((r) => r.address)
    const chunks = []
    for (let i = 0; i < addrs.length; i += MULTI_CHUNK) chunks.push(addrs.slice(i, i + MULTI_CHUNK))
    const hydrated = new Map()
    // SEQUENCED, not parallel. The pool sweep already spent 9 requests; firing
    // the hydration chunks alongside it put ~13 in flight at once and GT's
    // keyless tier (~30/min per IP, and we call it from the browser) answered
    // 429 to the whole second half - which silently degraded every number on
    // the board to the pool-derived fallback instead of failing loudly.
    for (const c of chunks) {
      try {
        for (const [k, v] of await fetchTokensMulti(slug, c)) hydrated.set(k, v)
      } catch { /* keep going - partial hydration still beats none */ }
    }
    // Total hydration failure means we are rate-limited or GT is down. Serving
    // pool-derived numbers here is how USDG rendered $53M of liquidity against
    // its real $16M, so prefer the last good set while it is still recent.
    if (hydrated.size === 0) {
      const lastGood = _lastGood.get(key)
      if (lastGood && Date.now() - lastGood.ts < LAST_GOOD_TTL) return lastGood.rows
    }

    for (const r of rows) {
      const prices = r._prices || []
      const lo = prices.length ? Math.min(...prices) : 0
      const hi = prices.length ? Math.max(...prices) : 0
      r._priceDispersion = lo > 0 ? hi / lo : 1
      const a = hydrated.get(String(r.address).toLowerCase())
      if (a) {
        const price = num(a.price_usd)
        // fdv_usd FIRST, exactly as on the pool path: it is computed from THIS
        // deployment's total_supply, while market_cap_usd follows GT's CoinGecko
        // link - and for a chain-local deployment of a global token that link
        // points at the global coin (Robinhood WETH resolved to $6.04B).
        const mcap = num(a.fdv_usd) || num(a.market_cap_usd)
        const vol = num(a.volume_usd?.h24)
        const liq = usd(a.total_reserve_in_usd)
        if (price > 0) r.price = price
        if (mcap > 0) r.marketCap = mcap
        if (vol > 0) r.volume24 = vol
        if (liq > 0) r.liquidity = liq
        if (a.coingecko_coin_id) r.cgId = a.coingecko_coin_id
        if (!r.logo && a.image_url && a.image_url !== 'missing.png') r.logo = a.image_url
      } else {
        // No hydration: the median across the token's pools is the honest read
        // on FDV - it ignores the one broken exotic-quote pool instead of
        // letting it win by being the deepest.
        r.marketCap = median(r._fdvs)
      }
      // Applied to BOTH paths - a broken number can arrive either way.
      r.marketCap = sane(r.marketCap, MAX_SANE_MCAP)
      r.liquidity = sane(r.liquidity, MAX_SANE_LIQ)
      r.volume24 = sane(r.volume24, MAX_SANE_VOL)
      r.safety = gradeGtRow(r)
      delete r._fdvs
      delete r._prices
      delete r._leadVol
    }

    // Drop the corpses. A drained pool keeps reporting its TRAILING 24h volume
    // long after there is nothing left in it, so the board filled up with rows
    // that read as live and are not: RABBIT at $0 market cap, $0 liquidity and
    // $19.97M "volume"; GPRO at $86 / $1. Both had a healthy same-ticker
    // contract sitting BELOW them, because the corpse's stale volume outranked
    // it. This is not a risk flag - there is no market to be risky in - so the
    // row leaves the board entirely rather than being annotated.
    const tradeable = rows.filter((r) => (Number(r.liquidity) || 0) >= DEAD_POOL_LIQUIDITY)
    // Never hand back an empty board on a bad hydration cycle: if the floor ate
    // everything, the raw rows are still better than nothing.
    const out = tradeable.length > 0 ? tradeable : rows
    _cache.set(key, { rows: out, ts: Date.now() })
    if (hydrated.size > 0) _lastGood.set(key, { rows: out, ts: Date.now() })
    return out
  })()
  _inflight.set(key, promise)
  try {
    return await promise
  } finally {
    _inflight.delete(key)
  }
}
