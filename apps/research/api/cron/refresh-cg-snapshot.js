/**
 * Vercel Cron - CoinGecko Markets Snapshot
 *
 * THE BIG LEVER. Replaces Codex filterTokens as the data source for the
 * top-500 tokens by mcap. Costs ZERO Codex ops; CoinGecko Pro pays for it.
 *
 * Runs every 60s. Two CG calls (page 1 + page 2 at per_page=250) cover the
 * top 500 tokens by mcap. Each token row is written to KV under TWO keys:
 *   1. `cg:snap:<lowercased-cg-id>`        - looked up by handleTokenPrices
 *      (which already has SYMBOL_TO_COINGECKO_ID mapping)
 *   2. `codex:snap:<addr:net>`              - looked up by handleTokenDetailsBatch
 *      (which keys by token contract address). Only written if we know an
 *      address for the token via the TOKEN_REGISTRY bridge. Tokens without
 *      a known address (BTC, XRP, ADA, DOT - CEX-only majors) get the cg:
 *      key only.
 *
 * Cost arithmetic:
 *   Before: Codex cron `filterTokens(tokens:[top-X])` = 2 ops/min via lockstep
 *           = 2,880 Codex ops/day
 *   After:  CG `/coins/markets?per_page=250&page=1` + page=2 = 0 Codex ops
 *           (2 CG Pro calls/min = 2,880 CG calls/day, well under any Pro tier)
 *
 * Coverage:
 *   Codex cron seed list had 16 tokens. CG snapshot covers 500 (31x more).
 *   For tokens NOT in top-500 (long-tail DEX-only), reads fall through to
 *   live Codex query (unchanged behavior).
 *
 * Field mapping (CG /coins/markets -> our snapshot shape):
 *   current_price             -> price
 *   market_cap                -> marketCap
 *   total_volume              -> volume24
 *   price_change_percentage_24h -> change24
 *   price_change_percentage_1h_in_currency  -> change1h
 *   price_change_percentage_7d_in_currency  -> change7d
 *   circulating_supply        -> circulatingSupply
 *   image                     -> logo
 *   ath                       -> ath
 *   ath_change_percentage     -> athChangePercent
 *
 * Schedule: every 1 minute - configured in vercel.json
 */

import { timingSafeEqual } from 'node:crypto'
import { rateLimit } from '../_lib/ratelimit.js'
import { setJsonWithTTL } from '../_lib/kv.js'
import { createRequire } from 'module'
const require_ = createRequire(import.meta.url)
// TOKEN_REGISTRY bridges CG id -> { address, networkId } for the canonical
// chain. We invert it once at module load so the per-token write loop stays
// O(1). Only tokens with BOTH coingeckoId AND address get an address-keyed
// snapshot entry; CEX-only tokens (BTC, XRP, ADA, DOT) get the cg: key only.
const { TOKEN_REGISTRY } = require_('../../../../packages/server/lib/token-registry.js')

const _cgIdToAddress = new Map()
try {
  for (const info of Object.values(TOKEN_REGISTRY || {})) {
    if (info?.coingeckoId && info?.address && info?.networkId != null) {
      const canonical = info.address.startsWith('0x')
        ? `${info.address.toLowerCase()}:${info.networkId}`
        : `${info.address}:${info.networkId}`
      _cgIdToAddress.set(info.coingeckoId.toLowerCase(), canonical)
    }
  }
} catch (e) { console.warn('[cg-snapshot] TOKEN_REGISTRY load failed:', e?.message) }

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || ''
const COINGECKO_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3'

const SNAPSHOT_TTL_SEC = 240      // 60s headroom over the */3 (180s) cron
const CG_PAGES = [1, 2, 3, 4, 5, 6]  // 250 per page -> top-1500 token coverage
const PER_PAGE = 250

const SNAP_PREFIX_ADDR = 'codex:snap:'  // compatibility with handleTokenDetailsBatch read path
const SNAP_PREFIX_CG = 'cg:snap:'        // new symbol-based read path

// CG-ranked tokens to drop from the aggregate `cg:snap:_all` (trending) list.
// These report absurd market caps CMC excludes (FIGR_HELOC RWA private credit,
// RAIN inflated supply). Per-token cg:snap:<id> price keys are KEPT so search /
// token pages still work — only the ranked aggregate is filtered.
// Mirror of apps/research/src/constants/marketDataExclusions.js — keep in sync.
const RANK_EXCLUDED_COINGECKO_IDS = new Set(['figure-heloc', 'rain'])
const RANK_EXCLUDED_SYMBOLS = new Set(['FIGR_HELOC'])
function isRankExcludedSnap(s) {
  if (!s) return false
  const id = String(s.id || '').toLowerCase()
  if (id && RANK_EXCLUDED_COINGECKO_IDS.has(id)) return true
  const sym = String(s.symbol || '').toUpperCase()
  return !!(sym && RANK_EXCLUDED_SYMBOLS.has(sym))
}

async function fetchMarketsPage(page) {
  const params = new URLSearchParams({
    vs_currency: 'usd',
    order: 'market_cap_desc',
    per_page: String(PER_PAGE),
    page: String(page),
    sparkline: 'false',
    price_change_percentage: '1h,24h,7d',
  })
  const url = `${COINGECKO_BASE}/coins/markets?${params}`
  const opts = { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) }
  if (COINGECKO_API_KEY) opts.headers['x-cg-pro-api-key'] = COINGECKO_API_KEY
  const r = await fetch(url, opts)
  if (!r.ok) throw new Error(`CoinGecko ${r.status} page=${page}`)
  return await r.json()
}

function cgRowToSnapshot(row) {
  const price = Number(row?.current_price) || 0
  const circulatingSupply = Number(row?.circulating_supply) || 0
  const marketCap = Number(row?.market_cap) || 0
  return {
    id: row?.id || null,
    symbol: (row?.symbol || '').toUpperCase(),
    name: row?.name || '',
    logo: row?.image || null,
    price,
    priceUSD: price,
    marketCap,
    rank: row?.market_cap_rank || null,
    volume24: Number(row?.total_volume) || 0,
    circulatingSupply,
    totalSupply: Number(row?.total_supply) || 0,
    change24: Number(row?.price_change_percentage_24h) || 0,
    change1h: Number(row?.price_change_percentage_1h_in_currency) || 0,
    change7d: Number(row?.price_change_percentage_7d_in_currency) || 0,
    ath: Number(row?.ath) || 0,
    athChangePercent: Number(row?.ath_change_percentage) || 0,
    athDate: row?.ath_date || null,
    fdv: Number(row?.fully_diluted_valuation) || 0,
    _source: 'cg-snapshot',
    _snappedAt: Date.now(),
  }
}

export default async function handler(req, res) {
  if (await rateLimit(req, res, { bucket: 'cron-cg-snapshot', max: 10, windowMs: 60_000 })) return

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
    // Instrumentation for the cron-auth mystery: if the user-agent branch is
    // ALSO wrong about what Vercel sends, this line in the runtime logs shows
    // the real signature on the next scheduled tick (this handler fires every
    // 3 min). Remove once the crons show 200s.
    console.log('[cron-auth] rejected invocation ua=%s xvc=%s hasAuthHeader=%s',
      String(req.headers['user-agent'] || 'none').slice(0, 60),
      String(req.headers['x-vercel-cron'] || 'none'),
      Boolean(req.headers.authorization))
    return res.status(401).json({ error: 'unauthorized' })
  }

  const startedAt = Date.now()
  let cgCalls = 0
  let cgErrors = 0
  let tokensWritten = 0
  let addressEntriesWritten = 0

  try {
    // Fetch in parallel. CG Pro handles 500 req/min easily.
    const pageResults = await Promise.allSettled(CG_PAGES.map((p) => fetchMarketsPage(p)))
    const allRows = []
    for (const r of pageResults) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        allRows.push(...r.value)
        cgCalls += 1
      } else {
        cgErrors += 1
        console.error('[cron/cg-snapshot] page fetch failed:', r.reason?.message)
      }
    }
    if (allRows.length === 0) {
      return res.status(502).json({ error: 'cg-empty', cgCalls, cgErrors, ms: Date.now() - startedAt })
    }

    const writePromises = []
    for (const row of allRows) {
      const snap = cgRowToSnapshot(row)
      if (!snap.id) continue

      // Always write the cg:<id> key for symbol-based reads.
      writePromises.push(
        setJsonWithTTL(`${SNAP_PREFIX_CG}${snap.id.toLowerCase()}`, snap, SNAPSHOT_TTL_SEC)
          .then(() => { tokensWritten += 1 })
          .catch((e) => console.error(`[cg-snapshot] cg key write fail ${snap.id}:`, e?.message))
      )

      // Also write the codex:snap:<addr:net> key when we know an address
      // (TOKEN_REGISTRY bridge). Lets handleTokenDetailsBatch read this
      // snapshot transparently without a second round trip.
      const canonical = _cgIdToAddress.get(snap.id.toLowerCase())
      if (canonical) {
        // Decorate snap with address fields so the read shape matches the
        // existing Codex-based handleTokenDetailsBatch contract.
        const [addr, netStr] = canonical.split(':')
        const decorated = {
          ...snap,
          address: addr,
          networkId: parseInt(netStr) || 1,
        }
        writePromises.push(
          setJsonWithTTL(`${SNAP_PREFIX_ADDR}${canonical}`, decorated, SNAPSHOT_TTL_SEC)
            .then(() => { addressEntriesWritten += 1 })
            .catch((e) => console.error(`[cg-snapshot] addr key write fail ${canonical}:`, e?.message))
        )
      }
    }

    await Promise.allSettled(writePromises)

    // Phase K9 aggregate: write the full sorted array under one key so
    // handleTrendingTokens (codex.js) can derive trending lists with ZERO
    // Codex calls. CG returns rows already sorted by market_cap_desc; we
    // preserve that order. Consumers re-sort by their own composite score.
    try {
      const allSnap = allRows.map(cgRowToSnapshot).filter((s) => s.id && !isRankExcludedSnap(s))
      await setJsonWithTTL('cg:snap:_all', allSnap, SNAPSHOT_TTL_SEC)
    } catch (e) {
      console.error('[cg-snapshot] aggregate _all key write failed:', e?.message)
    }

    return res.status(200).json({
      ok: true,
      cgCalls,
      cgErrors,
      tokensFromCg: allRows.length,
      tokensWritten,
      addressEntriesWritten,
      ms: Date.now() - startedAt,
    })
  } catch (err) {
    console.error('[cron/cg-snapshot] unexpected:', err)
    return res.status(500).json({ error: 'cron-failed', message: err.message, ms: Date.now() - startedAt })
  }
}
