/**
 * Vercel Cron - Token Snapshot Refresher (trading-app mirror)
 *
 * Mirrors apps/research/api/cron/refresh-token-snapshot.js. The two apps run
 * as separate Vercel projects with independent Upstash KV bindings, so we
 * need one cron per project. Read path (handleTokenDetails in this app's
 * codex.js) reads from THIS project's KV.
 *
 * Runs every 3 minutes (vercel.json crons schedule). Fires ONE
 * filterTokens(tokens:[union]) for top-N tokens by mcap. Writes each row to KV
 * as `codex:v1:snap:<addr:net>` with a 240s TTL that spans the full 3-min
 * cadence (was 90s, which only covered the first ~half of each interval, so the
 * warm window went cold ~90s before the next run - PR-S-B fix).
 *
 * Cost arithmetic: N users polling token details collapse to ONE cron call
 * every 3 min = ~1 Codex op / 3 min total (lockstep), regardless of
 * concurrent user count.
 */

import { timingSafeEqual } from 'node:crypto'
import { createRequire } from 'node:module'
import { rateLimit } from '../_lib/ratelimit.js'
import { getCodexCache, setCodexCache, getTopTokenViewsKv } from '../_lib/kv.js'

// DexScreener enrich is CommonJS (shared with codex.js). Pull it in via
// createRequire so this ESM cron can reuse the same total-pool liquidity sum.
const _require = createRequire(import.meta.url)
const { enrichFromDexScreener, norm: dsNorm } = _require('../_lib/dexscreener-enrich.cjs')

const CODEX_BASE_URL = 'https://graph.codex.io/graphql'
const CODEX_API_KEY = process.env.CODEX_API_KEY || ''
// Codex key is origin-restricted; server-to-server calls must present the allowed origin.
const CODEX_ORIGIN = process.env.CODEX_ORIGIN || 'https://app.spectreai.io'

// 240s so the details-snap warm window covers the full */3 min (180s) cron
// cadence with headroom (was 90s). Zero extra Codex - same one cron query.
const SNAPSHOT_TTL_SEC = 240
const MAX_TOKENS_PER_QUERY = 200

// Seed list of top-mcap tokens. Trading is multi-chain; major tokens across
// the chains the trading app supports (Ethereum, BSC, Polygon, Arbitrum,
// Base, Solana). Same shape as research seed list.
const TOP_TOKENS_DEFAULT = [
  '0x9Cf0ED013e67DB12cA3AF8e7506fE401aA14dAd6:1',  // SPECTRE (platform token - always snapshot it)
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2:1',  // WETH
  '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599:1',  // WBTC
  '0xdAC17F958D2ee523a2206206994597C13D831ec7:1',  // USDT
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48:1',  // USDC
  '0x514910771AF9Ca656af840dff83E8264EcF986CA:1',  // LINK
  '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984:1',  // UNI
  '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9:1',  // AAVE
  '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c:56', // WBNB
  '0x912CE59144191C1204E64559FE8253a0e49E6548:42161', // ARB
  'So11111111111111111111111111111111111111112:1399811149', // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:1399811149', // USDC SOL
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB:1399811149', // USDT SOL
]

// Probe for the cached trending list in trading's KV. The trading codex.js
// trending handler uses `codex:v1:trending:<networks-csv>:<limit>` shape.
const TRENDING_PROBE_KEYS = [
  ['trending', '1,56,137,8453,42161:50'],
  ['trending', '1,56,137,8453,42161,1399811149:50'],
]

async function buildSnapshotUnion() {
  const baseSet = new Set(TOP_TOKENS_DEFAULT)
  for (const [action, key] of TRENDING_PROBE_KEYS) {
    try {
      const cached = await getCodexCache(action, key)
      const results = Array.isArray(cached?.results) ? cached.results : Array.isArray(cached) ? cached : []
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
    } catch (_) { /* probe miss */ }
  }

  // Fold in the tokens users actually open (Most-Visited leaderboard). Without
  // this the snapshot only covers majors + trending, so a normal token page
  // (e.g. SPECTRE) falls to the Hetzner tier - which undercounts holders. Adding
  // viewed tokens here gives them a Codex-holders + total-liquidity snapshot.
  try {
    if (baseSet.size < MAX_TOKENS_PER_QUERY) {
      const VIEW_WINDOW_MS = 24 * 60 * 60 * 1000
      const topViews = await getTopTokenViewsKv(VIEW_WINDOW_MS, Date.now(), 80)
      for (const v of topViews) {
        const addr = v?.meta?.address
        const net = v?.meta?.networkId
        if (!addr || net == null) continue
        const canonical = addr.startsWith('0x') ? `${addr.toLowerCase()}:${net}` : `${addr}:${net}`
        baseSet.add(canonical)
        if (baseSet.size >= MAX_TOKENS_PER_QUERY) break
      }
    }
  } catch (_) { /* most-visited probe miss - non-fatal */ }

  return Array.from(baseSet).slice(0, MAX_TOKENS_PER_QUERY)
}

const BATCH_QUERY = `
  query CronTokenSnapshot($tokens: [String!]!, $limit: Int!) {
    filterTokens(tokens: $tokens, limit: $limit) {
      results {
        token {
          address
          symbol
          name
          networkId
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
  if (await rateLimit(req, res, { bucket: 'cron-token-snapshot', max: 10, windowMs: 60_000 })) return

  const isVercelCron = req.headers['x-vercel-cron'] === '1'
  const auth = req.headers.authorization || ''
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  let hasValidSecret = false
  if (expectedAuth) {
    const a = Buffer.from(auth || '')
    const b = Buffer.from(expectedAuth)
    if (a.length === b.length && timingSafeEqual(a, b)) hasValidSecret = true
  }
  if (!isVercelCron && !hasValidSecret) return res.status(401).json({ error: 'unauthorized' })

  // L4-PR6 kill switch: set CRON_TOKEN_SNAPSHOT_DISABLED=1 in Vercel env to
  // halt this cron without a redeploy. Codex spend during a runaway incident
  // drops by 2 ops/min (~2,880/day). Read path (handleTokenDetails in this
  // app's codex.js) still serves Tier-A cg:snap and Tier-B address-keyed
  // entries that are merely stale - the 90s TTL means most go cold within
  // ~2 min, then misses fall through to live Codex. Acceptable for the
  // emergency throttle this switch is intended for.
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

    // Total-pool liquidity via DexScreener (Codex's filterTokens.liquidity is
    // ~one side of the pair, roughly half the true pool TVL). Enrich so the
    // cached snapshot carries the full-pool figure that matches the token page +
    // the Hetzner tier. Non-fatal: on a miss we keep the Codex value.
    let dsLiq = new Map()
    try {
      const dsTargets = results
        .map((r) => ({ address: r?.token?.address, networkId: r?.token?.networkId }))
        .filter((t) => t.address)
      if (dsTargets.length) dsLiq = await enrichFromDexScreener(dsTargets)
    } catch (e) {
      console.error('[cron/refresh-token-snapshot] DexScreener enrich failed:', e.message)
    }

    const writePromises = []

    for (const row of results) {
      const tk = row?.token
      if (!tk?.address) continue
      const isEvm = tk.address.startsWith('0x')
      const canonicalKey = isEvm
        ? `${tk.address.toLowerCase()}:${tk.networkId}`
        : `${tk.address}:${tk.networkId}`

      const price = parseFloat(row.priceUSD) || 0
      const circulatingSupply = parseFloat(tk.info?.circulatingSupply) || 0
      const apiMarketCap = parseFloat(row.marketCap) || 0
      const computedMarketCap = price > 0 && circulatingSupply > 0 ? price * circulatingSupply : 0
      const dsRow = dsLiq.get(dsNorm(tk.address))
      const totalLiq = (dsRow && dsRow.liquidity > 0) ? dsRow.liquidity : (parseFloat(row.liquidity) || 0)

      const detail = {
        address: tk.address,
        symbol: tk.symbol,
        name: tk.name,
        networkId: tk.networkId,
        logo: tk.info?.imageLargeUrl || tk.info?.imageThumbUrl || null,
        circulatingSupply,
        price,
        priceUSD: price,
        volume24: parseFloat(row.volume24) || 0,
        liquidity: totalLiq,
        marketCap: apiMarketCap || computedMarketCap || 0,
        change24: parseFloat(row.change24) || 0,
        change1: parseFloat(row.change1) || 0,
        change4: parseFloat(row.change4) || 0,
        change12: parseFloat(row.change12) || 0,
        holders: parseInt(row.holders) || 0,
        _source: 'cron-snapshot',
        _snappedAt: Date.now(),
      }

      writePromises.push(
        setCodexCache('snap', canonicalKey, detail, SNAPSHOT_TTL_SEC)
          .then(() => { tokensWritten += 1 })
          .catch((e) => { errors += 1; console.error(`[cron] KV write fail ${canonicalKey}:`, e.message) })
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
