/**
 * Cross-asset state and correlation.
 *   GET /api/crossasset?market=crypto
 *
 * The question this answers is "what is happening across every market that
 * prices crypto, and what is it connected to" — not "what should I do". That
 * distinction is the whole design: a feed can answer the first honestly, and
 * cannot answer the second at all, which is what drove the page this replaces
 * to hardcode its own conclusions.
 *
 * Everything below is derived from daily closes. No model, no scoring curve,
 * no hand-written analogs.
 *
 * ── The alignment trap ──────────────────────────────────────────────────────
 * Crypto trades every day; equities, rates and commodities do not. Zipping the
 * two series by index correlates a Monday crypto move against the previous
 * Friday's equity move and quietly inflates everything. Returns are therefore
 * computed only over dates EVERY series has — about 340 of any 730 calendar
 * days — and the count is reported so the sample is never implicit.
 */

import { getJsonWithTTL, setJsonWithTTL } from '../kv.js'
import { yahooDailyCloses, binanceDailyCloses } from '../market-daily.js'

const CACHE_PREFIX = 'crossasset:v1'
const TTL_SEC = 900

/* The board. `group` drives the layout; order inside a group is the reading
   order, not a ranking. */
const CRYPTO_BOARD = [
  { sym: 'BTC', label: 'Bitcoin', group: 'crypto', kind: 'binance' },
  { sym: 'ETH', label: 'Ethereum', group: 'crypto', kind: 'binance' },
  { sym: 'SOL', label: 'Solana', group: 'crypto', kind: 'binance' },
  { sym: 'SPX', label: 'S&P 500', group: 'equities', kind: 'yahoo', ticker: '^GSPC' },
  { sym: 'NDX', label: 'Nasdaq 100', group: 'equities', kind: 'yahoo', ticker: '^NDX' },
  { sym: 'VIX', label: 'Volatility', group: 'equities', kind: 'yahoo', ticker: '^VIX' },
  { sym: 'DXY', label: 'Dollar index', group: 'rates', kind: 'yahoo', ticker: 'DX-Y.NYB' },
  { sym: 'US10Y', label: 'US 10-year', group: 'rates', kind: 'yahoo', ticker: '^TNX', unit: 'pct' },
  { sym: 'GOLD', label: 'Gold', group: 'commodities', kind: 'yahoo', ticker: 'GC=F' },
  { sym: 'OIL', label: 'Crude oil', group: 'commodities', kind: 'yahoo', ticker: 'CL=F' },
]

/* Same board re-centred for the Stocks toggle: the anchor becomes the index,
   and crypto narrows to the two names an equities desk actually watches. */
const STOCK_BOARD = [
  { sym: 'SPX', label: 'S&P 500', group: 'equities', kind: 'yahoo', ticker: '^GSPC' },
  { sym: 'NDX', label: 'Nasdaq 100', group: 'equities', kind: 'yahoo', ticker: '^NDX' },
  { sym: 'RUT', label: 'Russell 2000', group: 'equities', kind: 'yahoo', ticker: '^RUT' },
  { sym: 'VIX', label: 'Volatility', group: 'equities', kind: 'yahoo', ticker: '^VIX' },
  { sym: 'DXY', label: 'Dollar index', group: 'rates', kind: 'yahoo', ticker: 'DX-Y.NYB' },
  { sym: 'US10Y', label: 'US 10-year', group: 'rates', kind: 'yahoo', ticker: '^TNX', unit: 'pct' },
  { sym: 'GOLD', label: 'Gold', group: 'commodities', kind: 'yahoo', ticker: 'GC=F' },
  { sym: 'OIL', label: 'Crude oil', group: 'commodities', kind: 'yahoo', ticker: 'CL=F' },
  { sym: 'BTC', label: 'Bitcoin', group: 'crypto', kind: 'binance' },
  { sym: 'ETH', label: 'Ethereum', group: 'crypto', kind: 'binance' },
]

const WINDOWS = [30, 90, 250]
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null)
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null)

function pearson(a, b) {
  const n = a.length
  if (n < 3 || b.length !== n) return null
  let ma = 0, mb = 0
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] }
  ma /= n; mb /= n
  let num = 0, va = 0, vb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb
    num += da * db; va += da * da; vb += db * db
  }
  if (va === 0 || vb === 0) return null
  return num / Math.sqrt(va * vb)
}

async function loadSeries(row) {
  try {
    return row.kind === 'binance'
      ? await binanceDailyCloses(row.sym)
      : await yahooDailyCloses(row.ticker)
  } catch { return null }
}

async function assemble(market) {
  const board = market === 'stocks' ? STOCK_BOARD : CRYPTO_BOARD
  const loaded = await Promise.all(board.map(loadSeries))
  const rows = board.map((b, i) => ({ ...b, series: loaded[i] })).filter((b) => b.series)
  if (rows.length < 4) return null

  // Only dates EVERY series has — see the alignment trap above.
  let common = null
  for (const r of rows) {
    const keys = new Set(r.series.keys())
    common = common === null ? keys : new Set([...common].filter((d) => keys.has(d)))
  }
  const dates = [...common].sort()
  if (dates.length < 40) return null

  const closes = {}
  for (const r of rows) closes[r.sym] = dates.map((d) => r.series.get(d))

  const retsFor = (sym, win) => {
    const c = closes[sym]
    const slice = c.slice(Math.max(1, c.length - win))
    const prev = c.slice(Math.max(0, c.length - win - 1), c.length - 1)
    const out = []
    for (let i = 0; i < slice.length; i++) {
      const p = prev[i]
      if (p > 0 && slice[i] > 0) out.push(slice[i] / p - 1)
    }
    return out
  }

  const names = rows.map((r) => r.sym)
  const matrices = {}
  for (const win of WINDOWS) {
    const R = {}
    for (const n of names) R[n] = retsFor(n, win)
    matrices[win] = names.map((a) => names.map((b) => (a === b ? 1 : r2(pearson(R[a], R[b])))))
  }

  // Drift: today's 30-day reading against the same pair's one-year norm. A
  // correlation is only news when it moves away from where it normally sits.
  const anchor = names[0]
  const ai = names.indexOf(anchor)
  const drift = names
    .filter((n) => n !== anchor)
    .map((n) => {
      const j = names.indexOf(n)
      const w30 = matrices[30][ai][j]
      const w90 = matrices[90][ai][j]
      const w250 = matrices[250][ai][j]
      return {
        a: anchor, b: n, w30, w90, w250,
        drift: Number.isFinite(w30) && Number.isFinite(w250) ? r2(w30 - w250) : null,
      }
    })
    .filter((d) => d.drift !== null)
    .sort((x, y) => Math.abs(y.drift) - Math.abs(x.drift))

  // The board reads each asset's OWN latest series, never the aligned frame.
  // Alignment exists so a Monday crypto move is not correlated against the
  // previous Friday's equity move — but reading levels off it does exactly the
  // damage it was built to prevent: on a Monday the last shared date is Friday,
  // so BTC would print Friday's close as "now" and label a Thursday→Friday move
  // "1D". Measured on a Monday: +7.28% instead of the true +0.28%.
  const assets = rows.map((r) => {
    const own = [...r.series.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    const vals = own.map(([, v]) => v)
    const back = (n) => {
      const from = vals[vals.length - 1 - n]
      const last = vals[vals.length - 1]
      return from > 0 && last > 0 ? r4(last / from - 1) : null
    }
    return {
      sym: r.sym, label: r.label, group: r.group, unit: r.unit || 'price',
      last: vals[vals.length - 1],
      d1: back(1),
      d5: back(5),
      d30: back(30),
      // Each lane closes on its own calendar — an equity tile is meant to look
      // a day behind on a Sunday, and the date says so instead of hiding it.
      asOf: own[own.length - 1][0],
      // A short tail for a sparkline — enough shape, small enough to ship.
      spark: vals.slice(-60),
    }
  })

  return {
    market,
    anchor,
    names,
    assets,
    windows: WINDOWS,
    matrices,
    drift,
    coverage: { alignedDays: dates.length, from: dates[0], to: dates[dates.length - 1] },
    missing: board.filter((b) => !rows.some((r) => r.sym === b.sym)).map((b) => b.sym),
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

  const market = req.query.market === 'stocks' ? 'stocks' : 'crypto'
  const key = `${CACHE_PREFIX}:${market}`
  try {
    const hit = await getJsonWithTTL(key)
    if (hit?.names) {
      res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600')
      return res.status(200).json(hit)
    }
  } catch { /* KV optional */ }

  try {
    const payload = await assemble(market)
    if (!payload) return res.status(502).json({ error: 'Cross-asset data unavailable' })
    try { await setJsonWithTTL(key, payload, TTL_SEC) } catch { /* best effort */ }
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600')
    return res.status(200).json(payload)
  } catch (err) {
    console.error('[crossasset]', err?.message || err)
    return res.status(502).json({ error: 'Cross-asset data unavailable' })
  }
}

export const __test__ = { pearson, CRYPTO_BOARD, STOCK_BOARD }
