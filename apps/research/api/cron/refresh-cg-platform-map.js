/**
 * Vercel Cron - CoinGecko Platform Map Refresher
 *
 * Fetches CG /coins/list?include_platform=true once daily and builds a
 * reverse map: { "<address>:<networkId>": "<cgId>" } stored in KV as
 * `cg:platform_map` (single JSON blob, ~2MB at 17K coins x avg 2 platforms).
 *
 * Used by codex.js `_readSnapshotBatch` to bridge user-side requests (which
 * key by contract address) to the CG-side snapshot (which keys by cgId).
 * Before this map: ~22 of 500 cron-cached tokens reachable from
 * handleTokenDetailsBatch. After: ~500 of 500 (full coverage of top-500
 * regardless of which chain the user's address comes from).
 *
 * Cadence: daily at 06:00 UTC. CG platform mappings change rarely - daily
 * refresh covers new listings without bombing CG quota (1 call/day vs 1440
 * for the per-minute crons).
 *
 * TTL: 25 hours (1h headroom over the 24h cadence so a missed run doesn't
 * blank the map mid-day).
 */

import { timingSafeEqual } from 'node:crypto'
import { rateLimit } from '../_lib/ratelimit.js'
import { setJsonWithTTL } from '../_lib/kv.js'

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || ''
const COINGECKO_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3'

const PLATFORM_MAP_KEY = 'cg:platform_map'
const PLATFORM_MAP_TTL_SEC = 25 * 60 * 60  // 25h

// CG platform name -> our internal networkId. Matches the existing
// platformMap inside handleATH (codex.js). Solana is 1399811149 internally
// (Codex-style network id, not a real chain id).
const PLATFORM_TO_NETWORK_ID = {
  ethereum: 1,
  'binance-smart-chain': 56,
  'polygon-pos': 137,
  'arbitrum-one': 42161,
  base: 8453,
  avalanche: 43114,
  'optimistic-ethereum': 10,
  fantom: 250,
  solana: 1399811149,
  // Common alternates / smaller chains. Extend as needed.
  'arbitrum-nova': 42170,
  blast: 81457,
  linea: 59144,
  mantle: 5000,
  scroll: 534352,
  zksync: 324,
  cronos: 25,
  gnosis: 100,
  moonbeam: 1284,
  moonriver: 1285,
  celo: 42220,
  metis: 1088,
  klaytn: 8217,
  okexchain: 66,
  harmony: 1666600000,
  robinhood: 4663,
}

export default async function handler(req, res) {
  if (await rateLimit(req, res, { bucket: 'cron-cg-platform-map', max: 5, windowMs: 60_000 })) return

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
  if (!isVercelCron && !hasValidSecret) return res.status(401).json({ error: 'unauthorized' })

  const startedAt = Date.now()

  try {
    // Single big CG call. ~2.6MB at 17K coins.
    const url = `${COINGECKO_BASE}/coins/list?include_platform=true`
    const opts = { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) }
    if (COINGECKO_API_KEY) opts.headers['x-cg-pro-api-key'] = COINGECKO_API_KEY

    const r = await fetch(url, opts)
    if (!r.ok) {
      return res.status(502).json({ error: 'cg-fetch-failed', status: r.status })
    }
    const data = await r.json()
    if (!Array.isArray(data)) {
      return res.status(502).json({ error: 'cg-unexpected-shape' })
    }

    // Build reverse map. Skip coins with no platforms (BTC, XRP, ADA etc).
    const map = {}
    let entriesBuilt = 0
    let skippedNoPlat = 0
    let skippedUnknownChain = 0
    for (const coin of data) {
      const cgId = coin?.id
      const platforms = coin?.platforms
      if (!cgId || !platforms || typeof platforms !== 'object') {
        skippedNoPlat += 1
        continue
      }
      for (const [platform, addr] of Object.entries(platforms)) {
        if (!addr) continue
        const netId = PLATFORM_TO_NETWORK_ID[platform]
        if (!netId) { skippedUnknownChain += 1; continue }
        // Canonical key: lowercased EVM, preserve-case Solana.
        const canonical = addr.startsWith('0x')
          ? `${addr.toLowerCase()}:${netId}`
          : `${addr}:${netId}`
        map[canonical] = cgId
        entriesBuilt += 1
      }
    }

    // KV write. ~2-3MB single blob.
    await setJsonWithTTL(PLATFORM_MAP_KEY, map, PLATFORM_MAP_TTL_SEC)

    return res.status(200).json({
      ok: true,
      coinsProcessed: data.length,
      entriesBuilt,
      skippedNoPlat,
      skippedUnknownChain,
      ms: Date.now() - startedAt,
    })
  } catch (err) {
    console.error('[cron/cg-platform-map] unexpected:', err)
    return res.status(500).json({ error: 'cron-failed', message: err.message, ms: Date.now() - startedAt })
  }
}
