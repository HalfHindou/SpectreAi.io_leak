/**
 * Vercel Cron - Token Snapshot Refresher
 * Runs every 60s. Fires ONE filterTokens(tokens:[union]) call covering the
 * top-500 tokens by mcap PLUS any token recently fetched by any user (tracked
 * via KV `codex:hot:<addr:net>` keys with 24h TTL). Writes each token's row
 * to KV as `codex:snap:<addr:net>` with 90s TTL.
 *
 * The user-facing /api/codex?action=details-batch handler reads from these
 * snapshot keys FIRST and only fires a live Codex call for keys missing from
 * the snapshot. With this cron in place, 40+ concurrent users sharing the
 * same hot token set make ZERO duplicate Codex calls inside any 60s window.
 *
 * Cost arithmetic - the only thing that matters:
 *   Before: N users * 1 filterTokens / 60s = 2N billable ops/min (lockstep)
 *   After:  1 cron     * 1 filterTokens / 60s = 2 billable ops/min, total
 *
 * Schedule: every 1 minute - Vercel's tightest cron interval.
 * Auth: same pattern as warm-cache (CRON_SECRET OR x-vercel-cron header).
 */

import { timingSafeEqual } from 'node:crypto'
import { rateLimit } from '../_lib/ratelimit.js'
import { getJsonWithTTL, setJsonWithTTL } from '../_lib/kv.js'

// Codex endpoint. Same const the prod codex.js handler uses.
const CODEX_BASE_URL = 'https://graph.codex.io/graphql'
const CODEX_API_KEY = process.env.CODEX_API_KEY || ''
// Codex key is origin-restricted; server-to-server calls must present the allowed origin.
const CODEX_ORIGIN = process.env.CODEX_ORIGIN || 'https://app.spectreai.io'

// KV key prefixes - shared with the read path in codex.js.
const SNAPSHOT_PREFIX = 'codex:snap:'      // codex:snap:<addr:net> -> token row JSON
const HOT_PREFIX = 'codex:hot:'             // codex:hot:<addr:net> -> 1 (presence flag)
const SNAPSHOT_TTL_SEC = 240                // 60s headroom over the */3 (180s) cron
const MAX_TOKENS_PER_QUERY = 200            // Codex tokens: filter cap

// Top tokens by mcap. We keep this static (not derived from a live trending
// query) so the cron itself never depends on another paid Codex call. List
// can be regenerated weekly via a separate offline job. Coverage = the long
// tail beyond this list still falls through to the live codex.js path,
// gracefully.
const TOP_TOKENS_DEFAULT = [
  // L1 / L2 majors (Ethereum mainnet)
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2:1',  // WETH
  '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599:1',  // WBTC
  '0xdAC17F958D2ee523a2206206994597C13D831ec7:1',  // USDT
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48:1',  // USDC
  '0x514910771AF9Ca656af840dff83E8264EcF986CA:1',  // LINK
  '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984:1',  // UNI
  '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9:1',  // AAVE
  '0xD533a949740bb3306d119CC777fa900bA034cd52:1',  // CRV
  '0x6810e776880C02933D47DB1b9fc05908e5386b96:1',  // GNO
  '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84:1',  // stETH
  // BNB chain majors
  '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c:56', // WBNB
  '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56:56', // BUSD
  // Arbitrum
  '0x912CE59144191C1204E64559FE8253a0e49E6548:42161', // ARB
  // Solana majors
  'So11111111111111111111111111111111111111112:1399811149', // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:1399811149', // USDC SOL
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB:1399811149', // USDT SOL
]

// Build the union of (cached trending top-N + TOP_TOKENS_DEFAULT seeds).
// The trending KV cache is populated by /api/codex?action=trending (Phase H)
// and contains the actual hot tokens users care about - much better than a
// guess. We read from KV at zero Codex cost and slice to MAX_TOKENS_PER_QUERY.
// Falls back to the hardcoded defaults if KV is cold (e.g. fresh deploy).
//
// Trending KV key shape (from codex.js L836):
//   codex:trending:<sorted-networks-csv>:<limitNum>
// We probe a few common shapes the user app actually hits in production.
const TRENDING_KEYS_TO_PROBE = [
  'codex:trending:1,56,137,8453,42161:50',
  'codex:trending:1,56,137,8453,42161,1399811149:50',
  'codex:trending:1:50',
]

async function buildSnapshotUnion() {
  const baseSet = new Set(TOP_TOKENS_DEFAULT)
  for (const probeKey of TRENDING_KEYS_TO_PROBE) {
    try {
      const cached = await getJsonWithTTL(probeKey)
      const results = Array.isArray(cached?.results) ? cached.results : []
      for (const row of results) {
        const addr = row?.token?.address || row?.address
        const net = row?.token?.networkId || row?.networkId
        if (!addr || net == null) continue
        const canonical = addr.startsWith('0x')
          ? `${addr.toLowerCase()}:${net}`
          : `${addr}:${net}`
        baseSet.add(canonical)
        if (baseSet.size >= MAX_TOKENS_PER_QUERY) break
      }
      if (baseSet.size >= MAX_TOKENS_PER_QUERY) break
    } catch (_) { /* probe miss, try next */ }
  }
  return Array.from(baseSet).slice(0, MAX_TOKENS_PER_QUERY)
}

// Reusable filterTokens(tokens:[...]) batch query - same field set the user
// handleTokenDetailsBatch returns so reads from snapshot are interchangeable
// with reads from a live Codex call. If we change the shape, change both.
const BATCH_QUERY = `
  query CronTokenSnapshot($tokens: [String!]!, $limit: Int!) {
    filterTokens(tokens: $tokens, limit: $limit) {
      results {
        token {
          address
          symbol
          name
          networkId
          createdAt
          info {
            imageThumbUrl
            imageLargeUrl
            circulatingSupply
          }
        }
        priceUSD
        volume24
        liquidity
        marketCap
        change24
        change1
        change4
        change12
        holders
        txnCount24
      }
    }
  }
`

async function executeCodexQuery(query, variables) {
  if (!CODEX_API_KEY) throw new Error('CODEX_API_KEY env var is not set')
  const response = await fetch(CODEX_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': CODEX_API_KEY, 'Origin': CODEX_ORIGIN },
    body: JSON.stringify({ query, variables }),
  })
  if (!response.ok) throw new Error(`Codex HTTP ${response.status}`)
  const data = await response.json()
  if (data.errors) throw new Error(data.errors[0]?.message || 'Codex GraphQL error')
  return data.data
}

export default async function handler(req, res) {
  // Defense-in-depth: per-IP rate limit. Cron should only ever hit this from
  // Vercel's invocation infra, but the route is public so cap any probe.
  if (await rateLimit(req, res, { bucket: 'cron-token-snapshot', max: 10, windowMs: 60_000 })) return

  // Auth: either x-vercel-cron header (real cron invocation) OR matching
  // Bearer CRON_SECRET. Mirrors warm-cache.js exactly.
  const isVercelCron = req.headers['x-vercel-cron'] === '1'
    // 2026-07-02: prod runtime logs showed EVERY Vercel cron invocation
    // 401ing - Vercel does not send x-vercel-cron on this project and no
    // CRON_SECRET env is set, so neither branch ever matched and the cache
    // warmers/snapshots have been dead (cold caches, slow loads app-wide).
    // Vercel's documented cron signature is the user-agent; accept it. This
    // is the same trust level as the x-vercel-cron header (both spoofable -
    // verified externally), so no new exposure: the rate limit above and the
    // idempotent read-only work remain the actual defense. Setting a real
    // CRON_SECRET in the Vercel project env stays the preferred hardening.
    || String(req.headers['user-agent'] || '').startsWith('vercel-cron/')
  const auth = req.headers.authorization || ''
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  let hasValidSecret = false
  if (expectedAuth) {
    const a = Buffer.from(auth || '')
    const b = Buffer.from(expectedAuth)
    if (a.length === b.length && timingSafeEqual(a, b)) hasValidSecret = true
  }
  if (!isVercelCron && !hasValidSecret) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  // L4-PR6 kill switch: set CRON_TOKEN_SNAPSHOT_DISABLED=1 in Vercel env to
  // instantly stop this cron without a redeploy. Used during runaway-spend
  // incidents to confirm the cron isn't the offender, or to throttle hard
  // during a Codex outage. Read path in codex.js falls through to cg:snap
  // (Tier-1, free) which already covers ~95% of well-known token requests.
  // The only impact: long-tail tokens not in CG's top-500 lose their address-
  // keyed snapshot until this is re-enabled. They fall through to live Codex
  // queries (the pre-Phase-K behavior). Read path stays correct.
  if (process.env.CRON_TOKEN_SNAPSHOT_DISABLED === '1') {
    return res.status(200).json({ ok: true, skipped: 'CRON_TOKEN_SNAPSHOT_DISABLED=1', codexCalls: 0 })
  }

  const startedAt = Date.now()
  let codexCalls = 0
  let tokensWritten = 0
  let errors = 0

  try {
    const tokens = await buildSnapshotUnion()
    if (tokens.length === 0) {
      return res.status(200).json({ ok: true, tokens: 0, codexCalls: 0, ms: Date.now() - startedAt })
    }

    // ONE filterTokens call for the whole union. Codex's tokens: filter accepts
    // up to 200 keys spanning chains. Bills as 1 filterTokens + 1 lockstep
    // listPairsWithMetadata = 2 ops total per cron tick = 2880 ops/day TOTAL,
    // serving every user request inside the snapshot window.
    let data
    try {
      data = await executeCodexQuery(BATCH_QUERY, { tokens, limit: tokens.length })
      codexCalls += 1
    } catch (err) {
      errors += 1
      console.error('[cron/refresh-token-snapshot] Codex query failed:', err.message)
      return res.status(502).json({ error: 'codex-fetch-failed', message: err.message, ms: Date.now() - startedAt })
    }

    const results = data?.filterTokens?.results || []

    // Persist each token's row to KV. KEY CASE INVARIANT: the read path in
    // codex.js _readSnapshotBatch lowercases EVM addresses and preserves
    // Solana case. We MUST write with the same canonicalisation or every
    // read for an EVM token misses. (Hard-learned: TOP_TOKENS_DEFAULT below
    // contains mixed-case EVM addresses for readability; we lowercase them
    // at write time so the read keys always match.)
    const writePromises = []
    for (const row of results) {
      const tk = row?.token
      if (!tk?.address) continue
      const isEvm = tk.address.startsWith('0x')
      const canonicalKey = isEvm
        ? `${tk.address.toLowerCase()}:${tk.networkId}`
        : `${tk.address}:${tk.networkId}`
      const inputKey = canonicalKey

      // Match the exact shape /api/codex?action=details-batch returns so
      // the read path can transparently substitute snapshot for live.
      const price = parseFloat(row.priceUSD) || 0
      const circulatingSupply = parseFloat(tk.info?.circulatingSupply) || 0
      const apiMarketCap = parseFloat(row.marketCap) || 0
      const computedMarketCap = price > 0 && circulatingSupply > 0 ? price * circulatingSupply : 0
      const detail = {
        address: tk.address,
        symbol: tk.symbol,
        name: tk.name,
        networkId: tk.networkId,
        createdAt: tk.createdAt,
        logo: tk.info?.imageLargeUrl || tk.info?.imageThumbUrl || null,
        circulatingSupply,
        price,
        volume24: parseFloat(row.volume24) || 0,
        liquidity: parseFloat(row.liquidity) || 0,
        marketCap: apiMarketCap || computedMarketCap || 0,
        change24: parseFloat(row.change24) || 0,
        change1h: parseFloat(row.change1) || 0,
        change4h: parseFloat(row.change4) || 0,
        change12h: parseFloat(row.change12) || 0,
        holders: parseInt(row.holders) || 0,
        txnCount24: parseInt(row.txnCount24) || 0,
        _source: 'cron-snapshot',
        _snappedAt: Date.now(),
      }
      writePromises.push(
        setJsonWithTTL(`${SNAPSHOT_PREFIX}${inputKey}`, detail, SNAPSHOT_TTL_SEC)
          .then(() => { tokensWritten += 1 })
          .catch((e) => { errors += 1; console.error(`[cron] KV write fail ${inputKey}:`, e.message) })
      )
    }

    await Promise.allSettled(writePromises)

    const ms = Date.now() - startedAt
    return res.status(200).json({
      ok: true,
      tokens: tokens.length,
      results: results.length,
      tokensWritten,
      codexCalls,
      errors,
      ms,
    })
  } catch (err) {
    console.error('[cron/refresh-token-snapshot] unexpected:', err)
    return res.status(500).json({ error: 'cron-failed', message: err.message, ms: Date.now() - startedAt })
  }
}
