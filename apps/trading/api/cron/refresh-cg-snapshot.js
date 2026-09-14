/**
 * Vercel Cron - CoinGecko Markets Snapshot (trading app mirror)
 *
 * Mirrors apps/research/api/cron/refresh-cg-snapshot.js. Trading is a
 * separate Vercel project with its own KV; both apps need their own
 * snapshot to serve their own users' token detail / price requests at
 * zero Codex cost.
 *
 * Fetches CG /coins/markets twice (page 1 + page 2 at per_page=250) every
 * 60s = top 500 tokens. Writes:
 *   - `cg:snap:<cgId>`        - symbol-based read path
 *   - `codex:v1:snap:<addr:net>` - address-based read path (matches
 *                                  apps/trading/api/_lib/kv.js codex
 *                                  cache namespace, lets handleTokenDetails
 *                                  read this snapshot via getCodexCache)
 */

import { timingSafeEqual } from 'node:crypto'
import { rateLimit } from '../_lib/ratelimit.js'
import { setCodexCache } from '../_lib/kv.js'
import { createRequire } from 'module'
const require_ = createRequire(import.meta.url)
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
} catch (e) { console.warn('[cg-snapshot/trading] TOKEN_REGISTRY load failed:', e?.message) }

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || ''
const COINGECKO_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3'

const SNAPSHOT_TTL_SEC = 90
const CG_PAGES = [1, 2]
const PER_PAGE = 250

async function fetchMarketsPage(page) {
  const params = new URLSearchParams({
    vs_currency: 'usd',
    order: 'market_cap_desc',
    per_page: String(PER_PAGE),
    page: String(page),
    sparkline: 'false',
    price_change_percentage: '1h,24h,7d',
  })
  const opts = { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) }
  if (COINGECKO_API_KEY) opts.headers['x-cg-pro-api-key'] = COINGECKO_API_KEY
  const r = await fetch(`${COINGECKO_BASE}/coins/markets?${params}`, opts)
  if (!r.ok) throw new Error(`CG ${r.status} page=${page}`)
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
  let cgCalls = 0
  let cgErrors = 0
  let tokensWritten = 0
  let addressEntriesWritten = 0

  try {
    const pageResults = await Promise.allSettled(CG_PAGES.map((p) => fetchMarketsPage(p)))
    const allRows = []
    for (const r of pageResults) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        allRows.push(...r.value)
        cgCalls += 1
      } else {
        cgErrors += 1
        console.error('[cron/cg-snapshot/trading] page fail:', r.reason?.message)
      }
    }
    if (allRows.length === 0) {
      return res.status(502).json({ error: 'cg-empty', cgCalls, cgErrors, ms: Date.now() - startedAt })
    }

    const writePromises = []
    for (const row of allRows) {
      const snap = cgRowToSnapshot(row)
      if (!snap.id) continue

      // cg-keyed snapshot - use setCodexCache with action='snap-cg'
      // (key shape: codex:v1:snap-cg:<id>)
      writePromises.push(
        setCodexCache('snap-cg', snap.id.toLowerCase(), snap, SNAPSHOT_TTL_SEC)
          .then(() => { tokensWritten += 1 })
          .catch((e) => console.error(`[cg-snap/tr] cg key fail ${snap.id}:`, e?.message))
      )

      // address-keyed when bridge available (matches existing handleTokenDetails
      // read path which uses getCodexCache('snap', '<addr:net>'))
      const canonical = _cgIdToAddress.get(snap.id.toLowerCase())
      if (canonical) {
        const [addr, netStr] = canonical.split(':')
        const decorated = { ...snap, address: addr, networkId: parseInt(netStr) || 1 }
        writePromises.push(
          setCodexCache('snap', canonical, decorated, SNAPSHOT_TTL_SEC)
            .then(() => { addressEntriesWritten += 1 })
            .catch((e) => console.error(`[cg-snap/tr] addr key fail ${canonical}:`, e?.message))
        )
      }
    }

    await Promise.allSettled(writePromises)

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
    console.error('[cron/cg-snapshot/trading] unexpected:', err)
    return res.status(500).json({ error: 'cron-failed', message: err.message, ms: Date.now() - startedAt })
  }
}
