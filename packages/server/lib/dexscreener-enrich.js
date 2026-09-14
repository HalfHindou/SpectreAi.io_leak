'use strict'
/**
 * FREE DexScreener enrichment for trending candidates.
 *
 * Why this exists: Codex reports liquidity=0 for most Solana tokens and BILLS
 * per-token (listPairsWithMetadataForToken) for txnCount24/holders. DexScreener's
 * PUBLIC API returns txns (buys/sells), REAL liquidity, volume and priceChange
 * for free, batched up to 30 addresses per call - and it is the exact source
 * users benchmark trending against. We use it to enrich the bounded candidate
 * set, cached + shared across all requests. Net Codex cost: zero.
 *
 * Cost/volume: ~30 addresses per HTTP call, results cached TTL_MS, shared. For
 * an 80-candidate chain that is ~3 calls per refresh window, regardless of how
 * many users are viewing. Graceful: any failure leaves rows unenriched and the
 * traction scorer degrades to its volume/momentum path.
 *
 * CHAIN- + QUOTE-SCOPED (per-chain audit 2026-06-22): a token's DexScreener
 * pairs span MANY chains (same 0x address) and MANY quote tokens. We must
 * derive each per-network row ONLY from pairs on the requested chain quoted in
 * a trustworthy USD/native token. Picking the global highest-liquidity pair
 * (the old _bestPair) caused three confirmed bugs:
 *   - cross-chain TVL leak: an OP token inheriting its ETH pair's liquidity 4-10x
 *   - bad token-token LP glitch: SOL HYPE/JUP inheriting a meteora PUMP/MET pool
 *     reading priceUsd $303K, liquidity $760M, change +453115%
 *   - txn/volume mis-source feeding the scorer with wrong activity
 * Fix: filter pairs to (chainId == requested chain) AND (quote token in
 * GOOD_QUOTES), then SUM liquidity/volume/txns across those good pairs (the
 * token-level on-chain aggregate, no cross-chain bleed) and take price + change
 * from the deepest good pair (rates can't be summed). A token with NO good pair
 * on the requested chain returns null -> it stays unenriched -> the strict gate
 * drops it (we can't verify its USD metrics, so it does not belong in trending).
 *
 * Mirror to apps/trading/api/_lib/dexscreener-enrich.cjs for prod - keep in sync.
 */

const TTL_MS = 4 * 60 * 1000
// DexScreener caps each /tokens response at ~30 PAIRS total (not per token), so
// a 30-address batch only resolves ~50% of tokens (multi-pool tokens eat slots).
// 6 keeps every queried token's pairs well inside the cap even for multi-pool
// majors -> ~95-100% match (10 still truncated low-liq tokens out of a wide pool).
// Cost is just a few more cached, bounded-concurrency HTTP calls (all free).
const BATCH = 6
// 8s covers DexScreener's p99 (normally <1s) while keeping the worst single
// chunk from stalling the whole board response for 12s+ like it used to.
const FETCH_TIMEOUT_MS = 8000
const BASE = 'https://api.dexscreener.com/latest/dex/tokens/'

const MAX_CACHE = 5000 // bound the module cache; evict oldest entries beyond this
const _cache = new Map() // `${normAddr}|${networkId}` -> { data: shaped|null, ts }

// networkId -> DexScreener chainId string. Used to scope a token's pairs to the
// requested chain (kills the cross-chain liquidity/txn leak on multichain tokens).
const DS_CHAIN = {
  1: 'ethereum', 56: 'bsc', 137: 'polygon', 42161: 'arbitrum', 8453: 'base',
  10: 'optimism', 43114: 'avalanche', 1399811149: 'solana',
  4663: 'robinhood', // Robinhood Chain (Arbitrum Orbit L2)
}

// "Good" quote tokens: USD stables + each chain's major native/wrapped. A pair
// quoted in one of these yields a trustworthy USD price for the base token.
// Exotic token-token pools (HYPE/PUMP, JUP/MET) are EXCLUDED - DexScreener
// mis-derives the base token's USD price through them, producing $303K prices,
// $760M phantom liquidity and +453115% change glitches (BUG-2, per-chain audit).
const GOOD_QUOTES = new Set([
  // USD stables
  'USDC', 'USDT', 'USD', 'DAI', 'USDC.E', 'USDBC', 'USDT.E', 'USDT0', 'FDUSD',
  'TUSD', 'USDE', 'PYUSD', 'SUSDS', 'USDS', 'USDD', 'FRAX', 'LUSD', 'GUSD',
  'USD1', 'AUSD', 'USDX', 'CRVUSD', 'GHO', 'USDG',
  // major natives / wrapped (deep, well-priced)
  'WETH', 'ETH', 'SOL', 'WSOL', 'WBNB', 'BNB', 'WMATIC', 'MATIC', 'POL', 'WPOL',
  'WAVAX', 'AVAX', 'WBTC', 'CBBTC', 'WSTETH', 'STETH',
])
function _isGoodQuote(sym) { return GOOD_QUOTES.has(String(sym || '').toUpperCase()) }

// Solana addresses are base58 and CASE-SENSITIVE - never lowercase them.
// EVM addresses are hex and case-insensitive - lowercase for stable matching.
function norm(a) {
  if (!a) return ''
  const s = String(a)
  return s.startsWith('0x') ? s.toLowerCase() : s
}

function _fresh(key) {
  const e = _cache.get(key)
  if (e && Date.now() - e.ts < TTL_MS) return e // {data}
  return undefined
}

function _num(v) { return (v != null && isFinite(Number(v))) ? Number(v) : null }

// Pairs of the token, on the requested chain, quoted in a trustworthy token.
function _goodPairs(pairs, key, dsChain) {
  const out = []
  for (const p of pairs) {
    if (norm(p.baseToken && p.baseToken.address) !== key) continue
    if (dsChain && p.chainId !== dsChain) continue // chain-scope: no cross-chain leak
    if (!_isGoodQuote(p.quoteToken && p.quoteToken.symbol)) continue // USD/native only
    out.push(p)
  }
  return out
}

// Aggregate the good pairs: SUM liquidity/volume/txns (token-level on-chain
// total, no cross-chain bleed); price + change come from the DEEPEST good pair
// (rates can't be summed; the deepest real pair is the representative market).
function _shapeFromPairs(pairs) {
  if (!pairs || !pairs.length) return null
  let primary = pairs[0]
  let primaryLiq = (primary.liquidity && primary.liquidity.usd) || 0
  let sumLiq = 0, sumV24 = 0, sumV6 = 0, sumV1 = 0
  let b24 = 0, s24 = 0, b1 = 0, s1 = 0
  for (const p of pairs) {
    const liq = (p.liquidity && p.liquidity.usd) || 0
    if (liq > primaryLiq) { primary = p; primaryLiq = liq }
    sumLiq += liq
    sumV24 += (p.volume && p.volume.h24) || 0
    sumV6 += (p.volume && p.volume.h6) || 0
    sumV1 += (p.volume && p.volume.h1) || 0
    const t24 = (p.txns && p.txns.h24) || {}
    const t1 = (p.txns && p.txns.h1) || {}
    b24 += Number(t24.buys) || 0
    s24 += Number(t24.sells) || 0
    b1 += Number(t1.buys) || 0
    s1 += Number(t1.sells) || 0
  }
  const pc = primary.priceChange || {}
  return {
    txnCount24: b24 + s24,
    buys24: b24,
    sells24: s24,
    liquidity: sumLiq,
    volume24: sumV24,
    // Recent (1h) activity - the strict gate requires these > 0 so semi-dead
    // tokens (pumped early, stopped trading 1-4h ago) drop out of trending.
    vol1h: sumV1,
    txns1h: b1 + s1,
    // Recent-activity ratio: 6h volume / 24h volume. ~0 = a dead pump.
    recentVolRatio: sumV24 > 0 ? (sumV6 / sumV24) : null,
    // DexScreener priceChange is ALREADY clean percent (58.32 = 58.32%) and is
    // null when a window has no data. From the deepest GOOD pair only, so the
    // broken token-token-LP windows (+453115%) never reach the row. The route
    // converts to the dual-format fmtChange expects.
    chg5m: _num(pc.m5),
    chg1h: _num(pc.h1),
    chg6h: _num(pc.h6),
    chg24h: _num(pc.h24),
    priceUsd: _num(primary.priceUsd),
    marketCap: Number(primary.marketCap) || Number(primary.fdv) || 0,
    // Logo + pair age from the deepest pair - lets consumers (e.g. Most Visited,
    // which has no Codex metadata) render a logo + Age without a Codex call.
    logo: (primary.info && primary.info.imageUrl) || null,
    pairCreatedAt: Number(primary.pairCreatedAt) || null,
    _source: 'dexscreener',
  }
}

/**
 * Enrich token addresses with chain-scoped DexScreener data.
 * @param {Array<string|{address:string, networkId:number}>} targets - pass
 *   {address, networkId} so pairs are scoped to the right chain (recommended).
 *   Plain address strings still work but skip the chain filter (legacy).
 * @returns {Promise<Map<string, object>>} normAddr -> shaped row (chain-scoped
 *   aggregate of liquidity/volume/txns + deepest-good-pair price/change).
 */
async function enrichFromDexScreener(targets) {
  const out = new Map()
  const misses = [] // [{ addr, netId, key, cacheKey }]
  const seen = new Set()
  for (const raw of targets || []) {
    const addr = (raw && typeof raw === 'object') ? raw.address : raw
    const netId = (raw && typeof raw === 'object') ? raw.networkId : null
    const key = norm(addr)
    if (!key) continue
    const cacheKey = key + '|' + (netId != null ? netId : '')
    if (seen.has(cacheKey)) continue
    seen.add(cacheKey)
    const hit = _fresh(cacheKey)
    if (hit) { if (hit.data) out.set(key, hit.data); continue }
    misses.push({ addr, netId, key, cacheKey })
  }

  const chunks = []
  for (let i = 0; i < misses.length; i += BATCH) chunks.push(misses.slice(i, i + BATCH))

  // One batch fetch with a single retry. Returns the pairs array, or null if
  // BOTH attempts failed (timeout / non-200). The busy dev Express event loop
  // (RWA warmers, liquidations WS, ...) intermittently blocks long enough to
  // trip the timeout, so a retry recovers most of those. Prod runs this in an
  // isolated serverless function with no such contention.
  const fetchBatch = async (addrs) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(BASE + addrs.map(encodeURIComponent).join(','), {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { accept: 'application/json' },
        })
        if (res.ok) {
          const j = await res.json()
          return Array.isArray(j && j.pairs) ? j.pairs : []
        }
        // non-200 (429/5xx): fall through to retry
      } catch (_) { /* timeout/network: fall through to retry */ }
    }
    return null
  }

  // A FAILED batch (both attempts) must NOT poison the cache: leave its addresses
  // uncached so the next request retries them. Only a SUCCESSFUL fetch caches -
  // including genuine "no good pair" misses as null.
  const runChunk = async (chunk) => {
    const pairs = await fetchBatch(chunk.map((m) => m.addr))
    if (pairs === null) return
    for (const m of chunk) {
      const dsChain = m.netId != null ? DS_CHAIN[m.netId] : null
      const shaped = _shapeFromPairs(_goodPairs(pairs, m.key, dsChain))
      _cache.set(m.cacheKey, { data: shaped, ts: Date.now() })
      if (_cache.size > MAX_CACHE) _cache.delete(_cache.keys().next().value)
      if (shaped) out.set(m.key, shaped)
    }
  }
  // Bounded-concurrency WORKER POOL (not barrier waves): each worker pulls the
  // next chunk as soon as it finishes, so one slow chunk no longer stalls an
  // entire wave of 7 idle slots. The candidate pool can be ~400 (multi-ranking
  // union) = ~67 chunks; the pool keeps exactly CONCURRENCY calls in flight,
  // which stays well inside DexScreener's ~300/min budget because results are
  // cached TTL_MS and shared across requests.
  const CONCURRENCY = 12
  let nextChunk = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
      while (nextChunk < chunks.length) {
        const chunk = chunks[nextChunk++]
        await runChunk(chunk)
      }
    })
  )
  return out
}

module.exports = { enrichFromDexScreener, norm }
