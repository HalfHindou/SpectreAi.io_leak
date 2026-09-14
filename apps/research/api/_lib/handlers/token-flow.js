/**
 * Free on-chain taker flow — the lane that keeps the smart-money board alive
 * between Nansen cycles.
 *   GET /api/token-flow?limit=60
 *
 * Nansen is the authoritative cohort read, but it is metered, so it now paces
 * itself to roughly one deep cycle a day. That is the right cadence for a paid
 * feed and the wrong cadence for a board someone is looking at, so this sits
 * underneath it: two independent providers, both free and keyless, either of
 * which can carry the lane on its own.
 *
 * What it is NOT: a substitute for Nansen's numbers. Free sources publish trade
 * COUNTS and unique wallet counts, not a USD buy/sell split, so nothing here is
 * called net flow. Presenting a count-derived ratio as dollars would be the
 * exact dishonesty this lane exists to avoid — the board would look continuous
 * and would be lying about what it measured.
 */

import { getJsonWithTTL, setJsonWithTTL } from '../kv.js'

const CACHE_PREFIX = 'tokenflow:v1'
const TTL_SEC = 240

/* GeckoTerminal network ids. Not the same slugs as Nansen's or CoinGecko's. */
const GT_NETWORKS = ['eth', 'solana', 'base', 'bsc', 'arbitrum']
/* DexScreener publishes no organic trending list. Searching the majors looked
   like one and was not: `search?q=USDC` returns pairs whose BASE token is
   USDC, so that lane was structurally nothing but quote assets — 120 rows in,
   0 survived the filter. It earns its place two other ways instead. */
const DS_BATCH = 25

const GT_CHAIN = { eth: 'ethereum', solana: 'solana', base: 'base', bsc: 'bsc', arbitrum: 'arbitrum' }

/**
 * Quote assets are not flow. Every pool on this board is priced against one of
 * these, so they appear on the "traded" side of thousands of pools and float to
 * the top on volume alone — USDC ranked second on a first run with a pressure
 * of 0.03, which is not a signal, it is the denominator.
 */
const QUOTE_ASSETS = new Set([
  'USDC', 'USDT', 'DAI', 'FDUSD', 'USDE', 'USDS', 'TUSD', 'BUSD', 'PYUSD', 'USD1',
  'WETH', 'ETH', 'WBNB', 'BNB', 'SOL', 'WSOL', 'WBTC', 'CBBTC', 'WAVAX', 'WMATIC', 'WPOL',
])

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null)
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null)

async function getJson(url, timeout = 12000) {
  const resp = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(timeout),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json()
}

/**
 * A pool row reduced to the four things free data actually measures: how much
 * traded, how many trades went each way, and how many DISTINCT wallets were on
 * each side. The wallet counts matter more than the trade counts — one address
 * can print a hundred trades, and a hundred addresses cannot be one wallet.
 */
function poolRow({ chain, contract, symbol, name, volume, buys, sells, buyers, sellers, priceChange, liquidity, mcap, source }) {
  if (!contract || !symbol) return null
  return {
    chain, contract: String(contract).toLowerCase(), symbol, name: name || symbol,
    volume24h: num(volume), buys: num(buys), sells: num(sells),
    buyers: num(buyers), sellers: num(sellers),
    priceChange24h: Number.isFinite(Number(priceChange)) ? Number(priceChange) : null,
    liquidityUsd: num(liquidity), mcap: num(mcap) || null,
    pools: 1, source,
  }
}

async function fromGecko() {
  const settled = await Promise.allSettled(GT_NETWORKS.map((n) =>
    getJson(`https://api.geckoterminal.com/api/v2/networks/${n}/trending_pools?page=1&duration=24h`)
      .then((j) => ({ n, j }))))
  const rows = []
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue
    const { n, j } = s.value
    for (const p of j?.data || []) {
      const a = p.attributes || {}
      const tx = a.transactions?.h24 || {}
      // "PEPE / WETH 0.3%" — the base token is the one being traded.
      const symbol = String(a.name || '').split('/')[0].trim()
      // included[] carries the token objects; the pool id encodes the address.
      const rel = p.relationships?.base_token?.data?.id || ''
      const contract = rel.includes('_') ? rel.slice(rel.indexOf('_') + 1) : null
      const row = poolRow({
        chain: GT_CHAIN[n] || n, contract, symbol, name: symbol,
        volume: a.volume_usd?.h24, buys: tx.buys, sells: tx.sells,
        buyers: tx.buyers, sellers: tx.sellers,
        priceChange: a.price_change_percentage?.h24,
        liquidity: a.reserve_in_usd, mcap: a.market_cap_usd || a.fdv_usd,
        source: 'GeckoTerminal',
      })
      if (row) rows.push(row)
    }
  }
  return rows
}

/**
 * DexScreener, on the addresses GeckoTerminal surfaced.
 *
 * A second list that overlaps the first by accident is not corroboration. This
 * asks the other index about the SAME tokens, so agreement means two
 * independent sources saw the same activity — and the mcap it carries is
 * better populated than GeckoTerminal's.
 */
async function confirmWithDexScreener(rows) {
  const keys = [...new Set(rows.map((r) => r.contract))]
  const batches = []
  for (let i = 0; i < keys.length; i += DS_BATCH) batches.push(keys.slice(i, i + DS_BATCH))
  const settled = await Promise.allSettled(batches.map((b) =>
    getJson(`https://api.dexscreener.com/latest/dex/tokens/${b.join(',')}`)))
  const out = []
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue
    for (const p of s.value?.pairs || []) out.push(dsRow(p))
  }
  return out.filter(Boolean)
}

/**
 * DexScreener standing alone, used only when GeckoTerminal gives us nothing.
 *
 * Boosted tokens are PAID placements, not organic trending, so this is a
 * poorer list than the primary — but a poorer list that is honestly labelled
 * beats an empty board, which is the whole point of having a second provider.
 */
async function fromDexScreenerBoosts() {
  const boosts = await getJson('https://api.dexscreener.com/token-boosts/top/v1').catch(() => null)
  const list = Array.isArray(boosts) ? boosts : boosts?.data || []
  const addrs = [...new Set(list.map((b) => b.tokenAddress).filter(Boolean))]
  if (!addrs.length) return []
  const batches = []
  for (let i = 0; i < addrs.length; i += DS_BATCH) batches.push(addrs.slice(i, i + DS_BATCH))
  const settled = await Promise.allSettled(batches.map((b) =>
    getJson(`https://api.dexscreener.com/latest/dex/tokens/${b.join(',')}`)))
  const out = []
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue
    for (const p of s.value?.pairs || []) out.push(dsRow(p))
  }
  return out.filter(Boolean)
}

function dsRow(p) {
  const tx = p.txns?.h24 || {}
  return poolRow({
    chain: p.chainId, contract: p.baseToken?.address, symbol: p.baseToken?.symbol,
    name: p.baseToken?.name,
    volume: p.volume?.h24, buys: tx.buys, sells: tx.sells,
    // DexScreener publishes trade counts but not unique wallets. Left at zero
    // rather than filled with the trade count — they are different
    // measurements, and substituting one for the other invents a number.
    buyers: 0, sellers: 0,
    priceChange: p.priceChange?.h24,
    liquidity: p.liquidity?.usd, mcap: p.marketCap || p.fdv,
    source: 'DexScreener',
  })
}

/** One token can trade in many pools; the token is the unit anyone cares about. */
function mergeByToken(rows) {
  const byKey = new Map()
  for (const r of rows) {
    const key = `${r.chain}:${r.contract}`
    const cur = byKey.get(key)
    if (!cur) { byKey.set(key, { ...r, sources: new Set([r.source]) }); continue }
    cur.volume24h += r.volume24h
    cur.buys += r.buys; cur.sells += r.sells
    cur.buyers += r.buyers; cur.sellers += r.sellers
    cur.liquidityUsd += r.liquidityUsd
    cur.pools += 1
    cur.mcap = cur.mcap || r.mcap
    // Price change is a rate, not a total — averaging two pools' rates is
    // meaningless, so the deepest pool's number is the one kept.
    if (r.liquidityUsd > (cur._deepest || 0)) { cur.priceChange24h = r.priceChange24h; cur._deepest = r.liquidityUsd }
    cur.sources.add(r.source)
  }
  return [...byKey.values()].map((r) => {
    const trades = r.buys + r.sells
    const wallets = r.buyers + r.sellers
    delete r._deepest
    delete r.source
    return {
      ...r,
      sources: [...r.sources],
      // Taker imbalance on trade COUNTS, −1 to +1. Named pressure, never flow.
      pressure: trades > 0 ? r4((r.buys - r.sells) / trades) : null,
      // The stronger of the two: distinct wallets, which a single busy address
      // cannot inflate. Null when no provider published wallet counts.
      walletSkew: wallets > 0 ? r4((r.buyers - r.sellers) / wallets) : null,
      netBuyers: wallets > 0 ? r.buyers - r.sellers : null,
      confirmed: r.sources.size > 1,   // set properly by applyConfirmations
    }
  })
}

/**
 * Fold the second provider in as corroboration, never as extra volume.
 *
 * Agreement is the useful part: two independent indexes seeing the same token
 * active is a much stronger claim than one seeing it twice. Their volumes will
 * not match exactly — different pool coverage — so the second is carried
 * beside the first for comparison instead of being averaged into it.
 */
function applyConfirmations(rows, confirmRows) {
  const byKey = new Map(confirmRows.map((r) => [`${r.chain}:${r.contract}`, r]))
  return rows.map((r) => {
    const c = byKey.get(`${r.chain}:${r.contract}`)
    if (!c) return r
    return {
      ...r,
      sources: [...new Set([...r.sources, ...c.sources])],
      confirmed: true,
      volume24hAlt: c.volume24h || null,
      mcap: r.mcap || c.mcap || null,
      priceChange24h: r.priceChange24h ?? c.priceChange24h,
    }
  })
}

/** Rank by conviction × size: a lopsided book on no volume is noise. */
function score(r) {
  const lean = Math.abs(r.walletSkew ?? r.pressure ?? 0)
  return lean * Math.sqrt(Math.max(0, r.volume24h))
}

async function assemble(limit) {
  let primary = await fromGecko().catch(() => [])
  const sources = []
  let listSource = 'GeckoTerminal'
  let promoted = false

  if (primary.length) {
    sources.push('GeckoTerminal')
  } else {
    // GeckoTerminal rate-limits the free tier and occasionally answers 429 to a
    // burst. Rather than return an empty board, fall through to the other
    // provider and say which list this is.
    primary = await fromDexScreenerBoosts().catch(() => [])
    listSource = 'DexScreener'
    promoted = true
    if (primary.length) sources.push('DexScreener')
  }
  if (!primary.length) return null

  let confirmations = []
  if (!promoted) {
    confirmations = await confirmWithDexScreener(primary).catch(() => [])
    if (confirmations.length) sources.push('DexScreener')
  }

  // 🪤 Merging the two providers into one sum double-counts: they are two
  // views of the SAME pools, not two disjoint sets of trades. GrokBot's 24h
  // volume read $10.6M that way against a true $5.3M. Each provider is
  // aggregated on its own, and the second one confirms rather than adds.
  const merged = applyConfirmations(mergeByToken(primary), mergeByToken(confirmations))
    // A pool with three trades has a pressure of ±1 and means nothing, and a
    // quote asset is the denominator rather than a position.
    .filter((r) => r.buys + r.sells >= 20 && r.volume24h > 10_000
      // A pool with no depth prints huge percentages off a handful of dollars.
      && r.liquidityUsd > 50_000
      && !QUOTE_ASSETS.has(String(r.symbol || '').toUpperCase()))
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit)

  return {
    rows: merged,
    sources: [...new Set(sources)],
    listSource,
    // Says out loud that the fallback list is paid placement, so nobody reads
    // it as organic trending.
    promoted,
    degraded: promoted || sources.length < 2,
    counts: { primary: primary.length, confirmations: confirmations.length, merged: merged.length },
    measures: {
      pressure: 'taker imbalance on 24h trade counts, -1 to +1',
      walletSkew: 'imbalance on distinct 24h buyer vs seller addresses, -1 to +1',
      confirmed: 'the same token was seen independently by both providers',
      note: 'Trade and wallet counts, not a USD buy/sell split — free sources do not publish one.',
    },
    asOf: Date.now(),
  }
}

export default async function handler(req, res) {
  res.setHeader(
    'Access-Control-Allow-Origin',
    ['http://localhost:5180', 'http://localhost:5181', 'http://localhost:5182'].includes(req.headers?.origin) ? req.headers.origin : ''
  )
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const limit = Math.min(120, Math.max(10, parseInt(req.query.limit, 10) || 60))
  const key = `${CACHE_PREFIX}:${limit}`
  try {
    const hit = await getJsonWithTTL(key)
    if (hit?.rows?.length) {
      res.setHeader('Cache-Control', 'public, s-maxage=240, stale-while-revalidate=900')
      return res.status(200).json(hit)
    }
  } catch { /* KV optional */ }

  try {
    const payload = await assemble(limit)
    if (!payload) return res.status(502).json({ error: 'No free flow provider answered' })
    try { await setJsonWithTTL(key, payload, TTL_SEC) } catch { /* best effort */ }
    res.setHeader('Cache-Control', 'public, s-maxage=240, stale-while-revalidate=900')
    return res.status(200).json(payload)
  } catch (err) {
    console.error('[token-flow]', err?.message || err)
    return res.status(502).json({ error: 'Flow data unavailable' })
  }
}

export const __test__ = { mergeByToken, applyConfirmations, poolRow, score, QUOTE_ASSETS }
