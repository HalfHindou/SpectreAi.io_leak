'use strict'
/**
 * Robinhood Chain (networkId 4663) CANDIDATE DISCOVERY.
 *
 * Why this module exists
 * ----------------------
 * Every other chain enters `computeTrendingTokens` through Codex
 * `filterTokens`, which screens the whole chain and hands back a ranked
 * candidate union. Codex has NO coverage for Robinhood Chain (Arbitrum Orbit
 * L2, chainId 4663), so the trading screener was wired straight from the
 * BROWSER to GeckoTerminal's pool lists instead - and that one shortcut is the
 * root of both live complaints:
 *
 *   1. "there is far more robinhood tokens out there".
 *      GT's `/networks/robinhood/pools` caps at 3 pages = 60 POOLS, on a chain
 *      with 40 DEXes. After the liquidity floor that is ~61 rows. Measured
 *      2026-09-08 the chain actually carries 330 discoverable tokens, 256 with
 *      a real USD-quoted market and 222 holding >= $5k of liquidity.
 *   2. "at bottom ur showing a lot of crap thats not running, rug level".
 *      The GT lane returns a raw pool dump in pool order. It never touches the
 *      spam filter, the safety sweep, the impersonation screen, the collapse
 *      penalty or `scoreTraction` - the machinery every OTHER chain's board
 *      runs through. So post-rug husks rank purely on trailing volume:
 *      SNOWBALL sat on $9.2k of liquidity carrying $13.5M of 24h volume
 *      (1,470x turnover) at -99.96%; HUNTER $6.7k against $5.6M (828x) at
 *      -89.78%. Both are gated to zero by `scoreTraction` - they were simply
 *      never shown to it.
 *
 * So this module does DISCOVERY ONLY. It answers "which tokens exist on this
 * chain", in the exact Codex `filterTokens` result shape, and hands them to the
 * unchanged pipeline: isSpamToken -> enrichFromDexScreener -> safety sweep ->
 * impersonation screen -> scoreTraction -> dedupTrendingByIdentity. Robinhood
 * stops being a special case and becomes another chain.
 *
 * Sources, and why each one
 * -------------------------
 * `robinscan.io` is Robinhood Chain's own block explorer and publishes an open
 * JSON API (no key, no Cloudflare challenge - the Blockscout mirror at
 * robinhoodchain.blockscout.com is behind a bot wall and unusable). It is the
 * authority on WHAT IS DEPLOYED, which is exactly the question GT's
 * volume-ranked pool lists cannot answer. Measured overlap 2026-09-08:
 *
 *   source                     tokens   unique to it
 *   /api/tokens/top              100      47
 *   /api/stocks (5 pages)        203     172
 *   /api/fomo/trending            30      13
 *   /api/tokens (top 50)          50      40
 *   GT pool union                 ~35       1
 *   -----------------------------------------------
 *   union                        330
 *
 * The sources are almost disjoint, and the 172 tokens that ONLY `/api/stocks`
 * knows about are the tokenized equities that make this chain interesting
 * (QQQ, TSLA, AAPL, LLY, COIN, RBLX...). GT stays in as a supplement because it
 * is the only source that sees a brand-new memecoin pool minutes after it opens
 * - but it is now best-effort, behind a throttle guard, and never load-bearing.
 *
 * 🪤 robinscan's MARKET numbers are not trustworthy and are deliberately
 * discarded. `/api/tokens/top` reports NVDA `volumeUsd: 2.33e18` (raw wei, not
 * USD) and a $7.6M market cap against DexScreener's $16.2M; `/api/fomo/trending`
 * had SPY at `change24h: -95.03`. We take IDENTITY (address, symbol, name,
 * logo), HOLDER COUNT and the STOCK CLASSIFICATION from robinscan - the three
 * things it is authoritative on - and every price/liquidity/volume/txn/change
 * field from the DexScreener aggregate downstream, exactly like every other
 * chain in this pipeline.
 *
 * 🪤 `flagged` and `verified` are null for all 203 stocks (2026-09-08) - the
 * fields exist but are unpopulated, so nothing may depend on them.
 * `issuanceStatus` IS populated (194 issued / 9 not_issued) and a not-issued
 * equity has no redeemable backing, so it is dropped at discovery.
 *
 * Mirror: packages/server/lib/robinhood-chain.js - Vercel bundles each serverless function standalone, so a
 * cross-package require does not resolve in prod. Keep the pair in sync,
 * exactly like the trending-score / dexscreener-enrich pairs.
 */

const RS_BASE = 'https://robinscan.io'
const GT_BASE = 'https://api.geckoterminal.com/api/v2'
const NETWORK_ID = 4663
const GT_SLUG = 'robinhood'

// One discovery sweep is ~9 robinscan calls; the roster changes on the scale of
// new deployments, not seconds, and the caller caches its own board on top of
// this. 5 min keeps a warm instance from re-sweeping on every board refresh
// while still catching a new listing well inside a session.
const ROSTER_TTL = 5 * 60 * 1000
// Serve a stale roster rather than an empty board when robinscan is down. A
// slightly old token LIST is harmless - every number on the row is re-fetched
// from DexScreener downstream on each refresh, so a stale roster degrades to
// "we might be missing today's newest launch", never to a stale price.
const ROSTER_STALE_TTL = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000

let _roster = null      // { rows, ts }
let _inflight = null    // Promise<rows>
// GeckoTerminal's keyless tier is ~30 req/min per IP and answers 429 with a
// long, sticky penalty. One 429 parks the GT supplement for 5 minutes; the
// robinscan sources are unaffected, so discovery degrades by a handful of
// brand-new memecoin pools rather than failing.
let _gtParkedUntil = 0

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Only real EVM addresses enter the roster - a malformed entry cannot be
// enriched downstream and would occupy a candidate slot forever.
const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)

async function getJson(url, { timeout = FETCH_TIMEOUT_MS } = {}) {
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) throw new Error(`${url.replace(/^https?:\/\//, '').split('/')[0]} ${res.status}`)
  return res.json()
}

/**
 * Robinhood Chain names arrive as `"<Asset>" + " " + " Robinhood Token"`, which
 * leaves a DOUBLE SPACE in every official tokenized equity: "NVIDIA  Robinhood
 * Token", "SPDR S&P 500 ETF Trust  Robinhood Token". That matters far beyond
 * cosmetics - the shared `isSpamToken` filter treats a double space as an
 * SEO-stuffed spam name and a name over 60 chars as spam too, so unnormalised
 * these rules would have deleted 29 of the chain's 349 tokens, and they are
 * exactly the flagship ones (NVDA, SPY, SPCX, CRCL, SGOV, LULU). SPCX -
 * "Space Exploration Technologies Corp. Class A Common Stock  Robinhood Token"
 * - trips BOTH at 73 characters.
 *
 * So collapse the whitespace and drop the "Robinhood Token" suffix: on a
 * Robinhood-only board every row is a Robinhood token, the suffix is pure
 * column noise, and removing it is what lets the real name fit the cell
 * instead of truncating to "Space Exploration Technologi...".
 */
function cleanName(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim()
  const stripped = s.replace(/\s*[-|·]?\s*Robinhood Token$/i, '').trim()
  return stripped || s
}

/**
 * robinscan serves icons as a RELATIVE path (`/api/token-image/0x..?v=hash`).
 * Absolutize it here so the row carries a URL the browser can actually load -
 * a relative path would resolve against OUR origin and 404 on every row.
 */
function iconUrl(rel) {
  if (!rel || typeof rel !== 'string') return null
  if (/^https?:\/\//.test(rel)) return rel
  return RS_BASE + (rel.startsWith('/') ? rel : '/' + rel)
}

/**
 * A candidate in Codex `filterTokens` result shape. The market fields are left
 * at 0/null ON PURPOSE: `enrichFromDexScreener` fills every one of them
 * downstream, and the strict gate requires `_dexEnriched === true`, so a token
 * DexScreener cannot price never reaches the board. Seeding them with
 * robinscan's numbers would only give a broken row a way to look complete.
 */
function candidate(address, meta = {}) {
  return {
    token: {
      address,
      symbol: String(meta.symbol || '').trim(),
      name: cleanName(meta.name || meta.symbol),
      networkId: NETWORK_ID,
      info: { imageThumbUrl: meta.logo || null },
    },
    volume24: 0,
    liquidity: 0,
    marketCap: 0,
    priceUSD: 0,
    change24: 0,
    change12: 0,
    change4: 0,
    change1: 0,
    change5m: 0,
    createdAt: null,
    // Real holder counts, which GeckoTerminal does not expose at all - the
    // board's Holders column has been rendering an em dash for every Robinhood
    // row since the lane shipped. `scoreTraction` also weights holders.
    holders: meta.holders > 0 ? meta.holders : 0,
    // Robinhood Chain's whole premise is tokenized equities, so the row has to
    // carry what it IS. Consumed by the chain-aware branch of
    // isTrendingEligible (a "Nasdaq"/"iShares" NAME is a stock ticker here, not
    // the spam signal it is everywhere else) and available to the client for a
    // Stocks filter.
    _rhStock: meta.isStock ? {
      ticker: meta.stockTicker || meta.symbol || null,
      official: !!meta.official,
    } : null,
    _rhSource: meta.source || null,
  }
}

/** Merge a source's rows into the roster map, first writer wins on identity. */
function absorb(map, list, source) {
  let added = 0
  for (const t of list || []) {
    const address = t && t.address
    if (!isAddr(address)) continue
    const key = address.toLowerCase()
    const prev = map.get(key)
    if (prev) {
      // Later sources only FILL GAPS - they never overwrite an identity that a
      // higher-trust source already set.
      const tk = prev.token
      if (!tk.symbol && t.symbol) tk.symbol = String(t.symbol).trim()
      if (!tk.name && t.name) tk.name = cleanName(t.name)
      if (!tk.info.imageThumbUrl && t.logo) tk.info.imageThumbUrl = t.logo
      if (!prev.holders && t.holders > 0) prev.holders = t.holders
      if (!prev._rhStock && t.isStock) prev._rhStock = { ticker: t.stockTicker || t.symbol || null, official: !!t.official }
      continue
    }
    map.set(key, candidate(address, { ...t, source }))
    added++
  }
  return added
}

/** robinscan `/api/tokens/top` - the 100 most active tokens, with holder counts. */
async function fromTop() {
  const j = await getJson(`${RS_BASE}/api/tokens/top`)
  return (j && j.tokens || []).map((t) => ({
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    logo: iconUrl(t.iconUrl),
    holders: num(t.holderCount),
  }))
}

/**
 * robinscan `/api/stocks` - the tokenized-equity roster, 203 names over 5 pages
 * at the API's 50-row page cap. This is the single largest source of tokens the
 * old board could not see (172 of them appear nowhere else).
 */
async function fromStocks() {
  const out = []
  for (let page = 1; page <= 5; page++) {
    let j
    try {
      j = await getJson(`${RS_BASE}/api/stocks?page=${page}&pageSize=50`)
    } catch (_) {
      break // partial roster beats none
    }
    const items = (j && j.items) || []
    for (const t of items) {
      // A not-yet-issued equity has no backing to redeem against. It is a
      // placeholder contract, not a market.
      if (t.issuanceStatus === 'not_issued') continue
      out.push({
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        logo: iconUrl(t.iconUrl),
        holders: num(t.holderCount),
        isStock: true,
        stockTicker: t.stockTicker,
        official: !!t.isOfficialStock,
      })
    }
    if (items.length < 50) break
    if (j.total && page * 50 >= j.total) break
  }
  return out
}

/** robinscan `/api/fomo/trending` + `/api/tokens` - the explorer's own hot + top lists. */
async function fromExplorerLists() {
  const out = []
  const jobs = [
    getJson(`${RS_BASE}/api/fomo/trending`).then((j) => (j && j.tokens) || []).catch(() => []),
    getJson(`${RS_BASE}/api/tokens?page=1&pageSize=50`).then((j) => (j && j.items) || []).catch(() => []),
    getJson(`${RS_BASE}/api/tokens?page=2&pageSize=50`).then((j) => (j && j.items) || []).catch(() => []),
  ]
  const [fomo, p1, p2] = await Promise.all(jobs)
  for (const t of fomo) {
    out.push({
      address: t.address, symbol: t.symbol, name: t.name,
      logo: t.image || null, holders: num(t.holders),
    })
  }
  for (const t of [...p1, ...p2]) {
    out.push({
      address: t.address, symbol: t.symbol, name: t.name,
      logo: iconUrl(t.iconUrl), holders: num(t.holderCount),
      isStock: !!t.isStock, stockTicker: t.stockTicker, official: !!t.isOfficialStock,
    })
  }
  return out
}

/**
 * GeckoTerminal pool lists - the ONLY source that sees a memecoin pool minutes
 * after it opens, so it stays in as a supplement for the fresh tail. Strictly
 * best-effort: 3 requests, parked for 5 minutes on a single 429, and never
 * allowed to fail the sweep. 🪤 `sort=pool_created_at_desc` is not a valid GT
 * sort (returns 0 rows) - the endpoint for newest pools is `/new_pools`.
 */
async function fromGeckoTerminal() {
  if (Date.now() < _gtParkedUntil) return []
  const paths = [
    '/pools?include=base_token&sort=h24_volume_usd_desc&page=1',
    '/new_pools?include=base_token&page=1',
    '/trending_pools?include=base_token&page=1',
  ]
  const out = []
  for (const p of paths) {
    try {
      const res = await fetch(`${GT_BASE}/networks/${GT_SLUG}${p}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (res.status === 429) { _gtParkedUntil = Date.now() + 5 * 60_000; break }
      if (!res.ok) continue
      const j = await res.json()
      const included = new Map()
      for (const inc of j.included || []) {
        if (inc && inc.type === 'token') included.set(inc.id, inc.attributes || {})
      }
      for (const pool of j.data || []) {
        const ref = pool && pool.relationships && pool.relationships.base_token
          && pool.relationships.base_token.data && pool.relationships.base_token.data.id
        if (!ref) continue
        const tok = included.get(ref) || {}
        const address = tok.address || ref.split('_').slice(1).join('_')
        out.push({
          address,
          symbol: tok.symbol,
          name: tok.name,
          logo: tok.image_url && tok.image_url !== 'missing.png' ? tok.image_url : null,
        })
      }
    } catch (_) { /* best-effort supplement */ }
  }
  return out
}

/**
 * The Robinhood Chain candidate roster, in Codex `filterTokens` result shape.
 * Cached; concurrent callers share one sweep.
 */
async function discoverRobinhoodCandidates({ force = false } = {}) {
  if (!force && _roster && Date.now() - _roster.ts < ROSTER_TTL) return _roster.rows
  if (_inflight) return _inflight

  _inflight = (async () => {
    const map = new Map()
    const stats = {}
    // robinscan first and in parallel - these are the authoritative roster.
    const [top, stocks, lists] = await Promise.all([
      fromTop().catch(() => []),
      fromStocks().catch(() => []),
      fromExplorerLists().catch(() => []),
    ])
    stats.top = absorb(map, top, 'top')
    stats.stocks = absorb(map, stocks, 'stocks')
    stats.lists = absorb(map, lists, 'lists')
    // GT last, so its thin identities never win over robinscan's.
    stats.gecko = absorb(map, await fromGeckoTerminal().catch(() => []), 'gecko')

    const rows = [...map.values()].filter((r) => r.token.symbol)
    if (rows.length === 0) {
      // Total discovery failure. A stale roster is still a valid token list -
      // every market number on it is re-fetched downstream - so prefer it.
      if (_roster && Date.now() - _roster.ts < ROSTER_STALE_TTL) return _roster.rows
      return []
    }
    _roster = { rows, ts: Date.now() }
    if (process.env.TREND_DEBUG) {
      console.log(`[robinhood] roster=${rows.length} (+top ${stats.top} +stocks ${stats.stocks} +lists ${stats.lists} +gecko ${stats.gecko}) stocks=${rows.filter((r) => r._rhStock).length}`)
    }
    return rows
  })()

  try {
    return await _inflight
  } finally {
    _inflight = null
  }
}

/** True when this network set is Robinhood Chain and nothing else. */
function isRobinhoodOnly(netIds) {
  return Array.isArray(netIds) && netIds.length === 1 && Number(netIds[0]) === NETWORK_ID
}


// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------
/**
 * Why Robinhood Chain cannot use the shared `enrichFromDexScreener`.
 *
 * That helper batches 6 addresses into `/latest/dex/tokens/{addrs}`, and
 * DexScreener caps THAT endpoint at 30 pairs per response - shared across the
 * whole batch, not per token. On chains where a token has one or two pools that
 * is fine. On Robinhood Chain the majors are spread across 16-30 pools each
 * (SPY 22, NVDA 30, SPCX 28, PONS 27), so a single major consumes the entire
 * 30-pair budget and its five batch-mates resolve to NOTHING. Measured
 * 2026-09-08 that silently dropped SPY, TSLA, SGOV, QQQ, SPCX and AAPL - the
 * chain's flagship assets - off the board entirely, because an unenriched row
 * fails the `_dexEnriched` gate.
 *
 * So this chain hydrates in two stages:
 *
 *   A. `/tokens/v1/{chain}/{<=30 addrs}` returns the single BEST pool per
 *      address, so every token resolves in ~12 calls. Complete coverage, but
 *      liquidity/volume/txns from one pool only.
 *   B. `/token-pairs/v1/{chain}/{addr}` returns ALL of one token's pools. Run
 *      for the deepest rows from stage A, it recovers the true token-level
 *      totals. Stage A alone understates depth by 1.3x-3.4x on exactly the rows
 *      that matter (TSLA $1.06M vs $3.61M, PONS $7.71M vs $24.94M), and a
 *      liquidity number a trader cannot size against is worse than no number.
 *
 * Returns the SAME Map<normAddr, shaped> contract as enrichFromDexScreener, so
 * the consuming code in computeTrendingTokens is byte-identical for both paths
 * - including the clean-percent change fields, which the caller converts with
 * its own `pickWin`/`toCodexLikePct`. Never duplicate that conversion here.
 */
const DS_BASE = 'https://api.dexscreener.com'
const DS_CHAIN = 'robinhood'
// /tokens/v1 accepts 30 addresses and answers one pool per address.
const DS_BATCH = 30
/**
 * 🪤 DexScreener allows ~300 requests/min (~5/s) on these endpoints, PER IP, and
 * this process already spends part of that budget enriching every other chain.
 * The first version of this sweep fired 112 requests at concurrency 10 with no
 * pacing, took a 429 on essentially all of them, swallowed each failure as
 * "leave the row unenriched" and handed back an EMPTY map - which the spam
 * screen then read as 341 worthless tokens and the board rendered as zero rows.
 * A rate limit that degrades silently is worse than one that fails loudly.
 *
 * So: stage B is capped at the rows where summing actually changes the number a
 * user reads (the deepest ones), every request goes through one global pacing
 * gate, 429s retry with backoff, and a total wipe-out serves the last good map
 * instead of nothing.
 */
const DEEP_HYDRATE_LIMIT = 40
/**
 * Stage B is the expensive half (one call per token) and it only corrects the
 * MULTI-POOL SUM - how much of a token's liquidity/volume/trades sits outside
 * its single deepest pool. That composition drifts slowly; price and the change
 * windows do not. So stage B is not re-run every cycle: each token's sum-vs-top
 * RATIO is cached and re-applied to the fresh stage-A numbers, and only the
 * stalest few ratios are refreshed per cycle. A steady-state rebuild is ~22
 * calls / ~2.6s instead of 52 / ~12s, which is what makes a 45s board TTL
 * affordable - a 12s rebuild behind a 45s TTL would freeze the board on a
 * quarter of all polls.
 */
const DEEP_RATIO_TTL = 5 * 60_000
const DEEP_REFRESH_PER_CYCLE = 15
// Ratios are a correction, not a multiplier to trust blindly: a bad stage-A
// read could otherwise explode a number by orders of magnitude.
const MAX_DEEP_RATIO = 50
const DS_CONCURRENCY = 4
// DexScreener's limit is per-MINUTE, so what matters is the sustained rate, not
// the instantaneous one. A steady-state rebuild is ~22 calls once per board TTL
// (~30/min), far under the ~300/min budget, so the gate only has to stop the
// tight burst that tripped the 429 in the first place.
const DS_MIN_INTERVAL_MS = 120
// Must stay BELOW the board TTL that calls this (see ROBINHOOD_BOARD_TTL), or a
// board rebuild would re-serve numbers the previous rebuild already fetched and
// the board's freshness would silently be the hydration TTL instead.
const DS_TTL = 20_000
// A fully-built map stays usable this long when a later sweep is throttled.
// Stale-but-correct beats fresh-but-empty.
const DS_LAST_GOOD_TTL = 15 * 60_000
let _hydrateCache = { map: new Map(), ts: 0 }
let _hydrateLastGood = { map: new Map(), ts: 0 }
let _hydrateInflight = null
// addr -> { liq, vol, txns, ts }: how much bigger the token-level total is than
// its single deepest pool.
const _deepRatios = new Map()

// One global pacing gate shared by every worker in this process.
let _dsNextSlot = 0
async function _dsPace() {
  const now = Date.now()
  const wait = Math.max(0, _dsNextSlot - now)
  _dsNextSlot = Math.max(now, _dsNextSlot) + DS_MIN_INTERVAL_MS
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}

/** GET with pacing + 429/5xx backoff. Returns null when it genuinely gives up. */
async function _dsGet(url, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    await _dsPace()
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (res.status === 429 || res.status >= 500) {
        // Push every worker's next slot out, not just this one - a 429 means the
        // whole process is over budget, so backing off one caller achieves
        // nothing while the other three keep hammering.
        _dsNextSlot = Date.now() + 1500 * (i + 1)
        continue
      }
      if (!res.ok) return null
      return await res.json()
    } catch (_) { /* timeout / network - retry */ }
  }
  return null
}

/**
 * Quote assets that yield a trustworthy USD price on this chain. USDG is
 * Robinhood Chain's own stable and the dominant quote; WETH/ETH are the bridged
 * native. Stock-quoted pools (QQQ/SPY) are deliberately EXCLUDED even though
 * they carry real depth - the shared enricher's audit showed exotic
 * token-token pools mis-deriving base prices, and a tokenized equity quoting
 * another tokenized equity is exactly that shape.
 */
const RH_GOOD_QUOTES = new Set(['USDG', 'USDC', 'USDT', 'USD', 'USD1', 'AUSD', 'DAI', 'WETH', 'ETH'])

function _rhGoodPairs(pairs, addrLower) {
  const out = []
  for (const p of pairs || []) {
    if (!p || !p.baseToken) continue
    if (String(p.baseToken.address || '').toLowerCase() !== addrLower) continue
    if (p.chainId && p.chainId !== DS_CHAIN) continue
    if (!RH_GOOD_QUOTES.has(String(p.quoteToken && p.quoteToken.symbol || '').toUpperCase())) continue
    out.push(p)
  }
  return out
}

const _median = (arr) => {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Absurdity ceilings, as a last backstop only - the dispersion filter below is
 * the real defence. A number past these is not a big number, it is a broken
 * one, and rendering it makes the whole board look fake.
 */
const MAX_SANE_MCAP = 1e13
const MAX_SANE_LIQ = 1e10
const MAX_SANE_VOL = 1e11
const _sane = (v, ceiling) => (v > 0 && v < ceiling ? v : 0)

/**
 * Aggregate a token's good pools into one row.
 *
 * 🪤🪤 A SINGLE BROKEN POOL CAN OWN THE WHOLE ROW. ROUTE quotes at ~$6.7M
 * across four healthy pools and carries a fifth, ETH-quoted pool reporting
 * $1,817,785,058 of liquidity and a $181,778,315,563 market cap - 27,000x its
 * own real value. The shared enricher (and the old GeckoTerminal lane before
 * it) elects the DEEPEST pool as the representative market, and the broken pool
 * is precisely the one that looks deepest, so ROUTE rendered at $181.78B.
 *
 * Two rules, both learned the hard way on this chain:
 *   1. Drop pools whose implied price disagrees with the MEDIAN of the token's
 *      own pools by more than 5x. A token's pools arbitrage against each other;
 *      a 27,000x gap is a broken quote, not a market.
 *   2. Among the survivors the representative pool is the highest-VOLUME one,
 *      not the deepest. Volume is where price discovery actually happens, and
 *      depth is the metric a broken pool inflates.
 */
function _shape(all) {
  if (!all || !all.length) return null
  // 1. Reject pools that disagree with the token's own median price.
  const prices = all.map((p) => Number(p.priceUsd) || 0).filter((n) => n > 0)
  const mid = _median(prices)
  const pairs = mid > 0
    ? all.filter((p) => {
        const px = Number(p.priceUsd) || 0
        if (px <= 0) return false
        const ratio = px > mid ? px / mid : mid / px
        return ratio <= 5
      })
    : all
  if (!pairs.length) return null
  // 2. The highest-VOLUME survivor owns price, market cap and the change
  //    windows; rates cannot be summed, so one pool has to represent them.
  let primary = pairs[0]
  let primaryVol = (primary.volume && primary.volume.h24) || 0
  let sumLiq = 0, sumV24 = 0, sumV6 = 0, sumV1 = 0, b24 = 0, s24 = 0, b1 = 0, s1 = 0
  for (const p of pairs) {
    const liq = (p.liquidity && p.liquidity.usd) || 0
    const v24 = (p.volume && p.volume.h24) || 0
    if (v24 > primaryVol) { primary = p; primaryVol = v24 }
    sumLiq += liq
    sumV24 += (p.volume && p.volume.h24) || 0
    sumV6 += (p.volume && p.volume.h6) || 0
    sumV1 += (p.volume && p.volume.h1) || 0
    const t24 = (p.txns && p.txns.h24) || {}
    const t1 = (p.txns && p.txns.h1) || {}
    b24 += Number(t24.buys) || 0; s24 += Number(t24.sells) || 0
    b1 += Number(t1.buys) || 0; s1 += Number(t1.sells) || 0
  }
  const pc = primary.priceChange || {}
  const n = (v) => (v != null && isFinite(Number(v)) ? Number(v) : null)
  return {
    txnCount24: b24 + s24, buys24: b24, sells24: s24,
    liquidity: _sane(sumLiq, MAX_SANE_LIQ), volume24: _sane(sumV24, MAX_SANE_VOL),
    vol1h: sumV1, txns1h: b1 + s1,
    recentVolRatio: sumV24 > 0 ? sumV6 / sumV24 : null,
    chg5m: n(pc.m5), chg1h: n(pc.h1), chg6h: n(pc.h6), chg24h: n(pc.h24),
    priceUsd: n(primary.priceUsd),
    marketCap: _sane(Number(primary.marketCap) || Number(primary.fdv) || 0, MAX_SANE_MCAP),
    logo: (primary.info && primary.info.imageUrl) || null,
    pairCreatedAt: Number(primary.pairCreatedAt) || null,
    _source: 'dexscreener',
  }
}

async function _pool(items, worker, concurrency) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) await worker(items[i++])
  }))
}

/**
 * Cached + de-duplicated entry point. Two board rebuilds landing together must
 * share ONE sweep - without this they double the request count against a rate
 * limit that already bit once, and the loser's numbers are thrown away anyway.
 */
async function hydrateRobinhoodRows(targets) {
  if (Date.now() - _hydrateCache.ts < DS_TTL && _hydrateCache.map.size) return _hydrateCache.map
  if (_hydrateInflight) return _hydrateInflight
  _hydrateInflight = _hydrateOnce(targets)
  try {
    return await _hydrateInflight
  } finally {
    _hydrateInflight = null
  }
}

async function _hydrateOnce(targets) {
  const addrs = []
  const seen = new Set()
  for (const t of targets || []) {
    const a = String((t && t.address) || t || '').toLowerCase()
    if (!isAddr(a) || seen.has(a)) continue
    seen.add(a); addrs.push(a)
  }
  const out = new Map()

  // Stage A - complete coverage, one best pool per token.
  const chunks = []
  for (let i = 0; i < addrs.length; i += DS_BATCH) chunks.push(addrs.slice(i, i + DS_BATCH))
  let failedChunks = 0
  await _pool(chunks, async (chunk) => {
    const j = await _dsGet(`${DS_BASE}/tokens/v1/${DS_CHAIN}/${chunk.join(',')}`)
    if (j == null) { failedChunks++; return }
    const pairs = Array.isArray(j) ? j : []
    for (const a of chunk) {
      const shaped = _shape(_rhGoodPairs(pairs, a))
      if (shaped) out.set(a, shaped)
    }
  }, DS_CONCURRENCY)

  // Stage B - the multi-pool correction, for the rows deep enough to matter.
  const deep = [...out.entries()]
    .sort((x, y) => (y[1].liquidity || 0) - (x[1].liquidity || 0))
    .slice(0, DEEP_HYDRATE_LIMIT)
    .map(([a]) => a)
  // Refresh only the ratios that are missing or stale, oldest first, capped per
  // cycle so the deep set rotates instead of all firing at once.
  const now = Date.now()
  const needsRatio = deep
    .filter((a) => { const r = _deepRatios.get(a); return !r || now - r.ts > DEEP_RATIO_TTL })
    .sort((x, y) => ((_deepRatios.get(x) || { ts: 0 }).ts) - ((_deepRatios.get(y) || { ts: 0 }).ts))
    .slice(0, DEEP_REFRESH_PER_CYCLE)
  await _pool(needsRatio, async (a) => {
    const j = await _dsGet(`${DS_BASE}/token-pairs/v1/${DS_CHAIN}/${a}`)
    if (j == null) return // keep whatever ratio we already had
    const full = _shape(_rhGoodPairs(Array.isArray(j) ? j : [], a))
    const top = out.get(a)
    if (!full || !top) return
    const ratio = (sum, one) => {
      if (!(one > 0) || !(sum > 0)) return 1
      return Math.min(MAX_DEEP_RATIO, Math.max(1, sum / one))
    }
    _deepRatios.set(a, {
      liq: ratio(full.liquidity, top.liquidity),
      vol: ratio(full.volume24, top.volume24),
      txns: ratio(full.txnCount24, top.txnCount24),
      ts: Date.now(),
    })
  }, DS_CONCURRENCY)

  // Apply the (possibly cached) ratios to the FRESH stage-A numbers. Price,
  // market cap and every change window stay exactly as stage A read them this
  // cycle - only the magnitudes that sum across pools are scaled up.
  for (const a of deep) {
    const r = _deepRatios.get(a)
    const row = out.get(a)
    if (!r || !row) continue
    row.liquidity = _sane(row.liquidity * r.liq, MAX_SANE_LIQ)
    row.volume24 = _sane(row.volume24 * r.vol, MAX_SANE_VOL)
    row.vol1h = row.vol1h * r.vol
    row.txnCount24 = Math.round(row.txnCount24 * r.txns)
    row.buys24 = Math.round(row.buys24 * r.txns)
    row.sells24 = Math.round(row.sells24 * r.txns)
    row.txns1h = Math.round(row.txns1h * r.txns)
  }

  // A sweep that resolved nothing (or almost nothing) means we are rate-limited,
  // not that the chain died. Say so, and serve the last good map rather than
  // handing back an empty one that reads downstream as "every token is spam".
  if (out.size < addrs.length * 0.25) {
    console.error(`[robinhood] hydration degraded: ${out.size}/${addrs.length} resolved, ${failedChunks}/${chunks.length} stage-A chunks failed (DexScreener rate limit?)`)
    if (_hydrateLastGood.map.size && Date.now() - _hydrateLastGood.ts < DS_LAST_GOOD_TTL) {
      return _hydrateLastGood.map
    }
  }
  if (out.size) {
    // Stamp the map with when its NUMBERS were read. A board rebuilt now on top
    // of a last-good map read 12 minutes ago is 12 minutes old, and the client's
    // freshness readout has to age from this, not from the rebuild.
    out.asOf = Date.now()
    _hydrateCache = { map: out, ts: Date.now() }
    _hydrateLastGood = { map: out, ts: Date.now() }
  }
  return out
}

module.exports = {
  discoverRobinhoodCandidates,
  hydrateRobinhoodRows,
  isRobinhoodOnly,
  ROBINHOOD_NETWORK_ID: NETWORK_ID,
}
