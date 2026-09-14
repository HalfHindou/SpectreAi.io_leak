/**
 * Seasonality / yearly analysis.
 *   GET /api/seasonality?symbol=BTC&market=crypto
 *   GET /api/seasonality?symbols=BTC,ETH,SOL&compact=1   (cross-asset month grid)
 *
 * Every other platform that shows a "monthly returns" table reads it off one
 * exchange and starts the history the day that exchange listed the pair —
 * which quietly amputates BTC's first four years and turns a 13-year seasonal
 * record into a 9-year one. We assemble ours:
 *
 *   head  CoinGecko daily closes (BTC from 2013-04, ETH from 2015-08) folded
 *         into month candles, used ONLY for the months that predate the
 *         Binance listing.
 *   body  Binance monthly klines — real OHLC, real venue, from listing to now.
 *   tail  the running month, flagged `partial` so it never pollutes an average.
 *
 * Stocks / macro come from Yahoo monthly bars (adjusted closes, so splits and
 * dividends don't fake a seasonal effect).
 *
 * The daily series we already had to pull for the head-stitch pays for three
 * more things nobody bothers to compute: the intramonth drawdown of every
 * month ever, the weekday tape, and the turn-of-month effect.
 */

import { getJsonWithTTL, setJsonWithTTL } from '../kv.js'
import { lookupBinancePair, fetchBinanceKlines } from '../binance-bars.js'

const CACHE_PREFIX = 'seasonality:v3'
// History doesn't change; only the running month's close does. One hour of KV
// plus a day of stale-while-revalidate at the edge.
const TTL_SEC = 3600
const MAX_SYMBOLS = 12

/* CoinGecko ids for the assets that actually have pre-Binance history worth
   stitching. Anything not here simply starts at its Binance listing. */
const CG_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', XRP: 'ripple', LTC: 'litecoin',
  DOGE: 'dogecoin', ADA: 'cardano', XLM: 'stellar', XMR: 'monero',
  ETC: 'ethereum-classic', BCH: 'bitcoin-cash', DASH: 'dash', ZEC: 'zcash',
  NEO: 'neo', EOS: 'eos', TRX: 'tron', BNB: 'binancecoin', LINK: 'chainlink',
}

/* Board symbols that aren't crypto pairs at all. Yahoo carries decades of
   monthly history for each, which is exactly what a seasonality read wants. */
const YAHOO_ALIASES = {
  DXY: 'DX-Y.NYB', SPX: '^GSPC', NQ: '^NDX', VIX: '^VIX',
  GOLD: 'GC=F', SILVER: 'SI=F', OIL: 'CL=F', US10Y: '^TNX',
}

const MS_DAY = 86400000

/* ── small numeric helpers ─────────────────────────────────────────────── */
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)
const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const stdev = (a) => {
  if (a.length < 2) return null
  const mu = mean(a)
  return Math.sqrt(a.reduce((s, x) => s + (x - mu) * (x - mu), 0) / (a.length - 1))
}
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null)
const r6 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null)

/* ── upstream: Binance monthly klines ──────────────────────────────────── */
async function binanceMonths(symbol) {
  const pair = lookupBinancePair(symbol)
  if (!pair) return null
  const to = Math.floor(Date.now() / 1000)
  // 2010 — earlier than any listing, and well inside the 1000-bar cap at 1M.
  const bars = await fetchBinanceKlines(pair, '1M', 1262304000, to)
  if (!bars?.length) return null
  return bars.map((b) => {
    const d = new Date(b.t * 1000)
    return {
      y: d.getUTCFullYear(),
      m: d.getUTCMonth() + 1,
      o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
      src: 'binance',
      hl: 'ohlc',
    }
  })
}

/* Normalise any daily bar into the shape the stat passes expect. */
function dailyPoint(tSec, c, h, l) {
  const d = new Date(tSec * 1000)
  return {
    t: tSec, c,
    h: Number.isFinite(h) ? h : c,
    l: Number.isFinite(l) ? l : c,
    dow: d.getUTCDay(), dom: d.getUTCDate(),
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1,
  }
}

/* ── upstream: Binance daily klines, paged ───────────────────────────────
 * Binance caps a kline call at 1000 bars, and fetchBinanceKlines silently
 * switches to "last 1000 ending at `to`" when the window is wider — so asking
 * for nine years in one call would quietly return only the last three. Page it
 * in 900-day windows and fire them in parallel instead.
 */
async function binanceDaily(pair, startSec) {
  const now = Math.floor(Date.now() / 1000)
  const STEP = 900 * MS_DAY / 1000
  const windows = []
  for (let from = startSec; from < now; from += STEP) {
    windows.push([from, Math.min(from + STEP, now)])
  }
  if (!windows.length || windows.length > 12) return null
  const pages = await Promise.all(
    windows.map(([f, t]) => fetchBinanceKlines(pair, '1D', f, t).catch(() => null))
  )
  const seen = new Set()
  const out = []
  for (const page of pages) {
    if (!page) continue
    for (const b of page) {
      if (seen.has(b.t)) continue
      seen.add(b.t)
      out.push(dailyPoint(b.t, b.c, b.h, b.l))
    }
  }
  out.sort((a, b) => a.t - b.t)
  return out.length > 60 ? out : null
}

/* ── upstream: CoinGecko daily closes (full history) ────────────────────── */
async function coingeckoDaily(cgId) {
  const key = process.env.COINGECKO_API_KEY || ''
  const base = key ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3'
  const headers = { Accept: 'application/json' }
  if (key) headers['x-cg-pro-api-key'] = key
  const url = `${base}/coins/${encodeURIComponent(cgId)}/market_chart?vs_currency=usd&days=max&interval=daily`
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(20000) })
  if (!resp.ok) return null
  const json = await resp.json()
  const rows = Array.isArray(json?.prices) ? json.prices : []
  const out = []
  let lastKey = ''
  for (const [ms, px] of rows) {
    if (!Number.isFinite(px) || px <= 0) continue
    const d = new Date(ms)
    // CG's max series is one snapshot per UTC day, but the trailing rows can
    // carry an intraday point that duplicates the last day. Keep the latest.
    const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
    // CoinGecko stamps a daily point at 00:00 UTC, which is the price at the
    // START of that day — i.e. the previous day's close. Verified against
    // Binance daily klines over 883 overlapping days: 833 match the close of
    // D-1, 50 match the close of D. Left unshifted, the head segment labels
    // every return one weekday late and every month closes a day early, and
    // the stitch to Binance quietly changes convention mid-series.
    const pt = dailyPoint(Math.floor(ms / 1000) - 86400, px)
    if (k === lastKey) out[out.length - 1] = pt
    else out.push(pt)
    lastKey = k
  }
  return out.length > 30 ? out : null
}

/* ── upstream: Yahoo (stocks + macro), monthly and daily ────────────────── */
/* Yahoo silently DOWNGRADES granularity instead of erroring: ask ^GSPC for
 * `interval=1mo&range=max` and it hands back 3-month buckets that look exactly
 * like monthly bars — a seasonality table built on that is quietly quarterly.
 * So we ask by explicit period, then verify `meta.dataGranularity` and step the
 * window down until Yahoo actually gives us the interval we asked for. */
const YAHOO_WINDOWS = ['period1=0', 'range=30y', 'range=20y', 'range=10y']

async function yahooSeries(ticker, interval) {
  const nowSec = Math.floor(Date.now() / 1000)
  for (const win of YAHOO_WINDOWS) {
    const qs = win === 'period1=0' ? `period1=0&period2=${nowSec}` : win
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&${qs}`
    let r = null
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      })
      if (!resp.ok) continue
      const json = await resp.json()
      r = json?.chart?.result?.[0]
    } catch { continue }
    const ts = r?.timestamp
    const q = r?.indicators?.quote?.[0]
    if (!Array.isArray(ts) || !q) continue
    if (r?.meta?.dataGranularity && r.meta.dataGranularity !== interval) continue
    return { ts, q, adj: r?.indicators?.adjclose?.[0]?.adjclose }
  }
  return null
}

async function yahooMonths(ticker) {
  const s = await yahooSeries(ticker, '1mo')
  if (!s) return null
  const { ts, q, adj } = s
  const out = []
  for (let i = 0; i < ts.length; i++) {
    const c = Number.isFinite(adj?.[i]) ? adj[i] : q.close?.[i]
    const raw = q.close?.[i]
    if (!Number.isFinite(c) || c <= 0) continue
    // Splits/dividends are baked into adjclose; scale the rest of the candle
    // by the same factor so the bar stays internally consistent.
    const k = Number.isFinite(raw) && raw > 0 ? c / raw : 1
    const d = new Date(ts[i] * 1000)
    out.push({
      y: d.getUTCFullYear(), m: d.getUTCMonth() + 1,
      o: Number.isFinite(q.open?.[i]) ? q.open[i] * k : c,
      h: Number.isFinite(q.high?.[i]) ? q.high[i] * k : c,
      l: Number.isFinite(q.low?.[i]) ? q.low[i] * k : c,
      c,
      v: q.volume?.[i] || 0,
      src: 'yahoo',
      hl: 'ohlc',
    })
  }
  return out.length ? out : null
}

async function yahooDaily(ticker) {
  const s = await yahooSeries(ticker, '1d')
  if (!s) return null
  const { ts, q, adj } = s
  const out = []
  for (let i = 0; i < ts.length; i++) {
    const c = Number.isFinite(adj?.[i]) ? adj[i] : q.close?.[i]
    if (!Number.isFinite(c) || c <= 0) continue
    const k = Number.isFinite(q.close?.[i]) && q.close[i] > 0 ? c / q.close[i] : 1
    out.push(dailyPoint(ts[i], c, q.high?.[i] * k, q.low?.[i] * k))
  }
  return out.length > 30 ? out : null
}

/* ── fold daily closes into month candles ───────────────────────────────── */
function monthsFromDaily(daily) {
  const out = []
  let cur = null
  let prevClose = null
  // A history that begins mid-month (CoinGecko's BTC series starts 2013-04-28)
  // would otherwise contribute a three-day "April" to April's average.
  const skipFirst = daily.length && daily[0].dom > 3 ? `${daily[0].y}-${daily[0].m}` : null
  for (const d of daily) {
    if (!cur || cur.y !== d.y || cur.m !== d.m) {
      if (cur) { out.push(cur); prevClose = cur.c }
      cur = {
        y: d.y, m: d.m,
        // A month's open is the previous month's close — that keeps the
        // series continuous instead of dropping the gap between months.
        o: prevClose ?? d.c,
        h: Math.max(prevClose ?? d.c, d.c),
        l: Math.min(prevClose ?? d.c, d.c),
        c: d.c, v: 0, src: 'coingecko', hl: 'close',
      }
    } else {
      cur.h = Math.max(cur.h, d.c)
      cur.l = Math.min(cur.l, d.c)
      cur.c = d.c
    }
  }
  if (cur) out.push(cur)
  return skipFirst ? out.filter((x) => `${x.y}-${x.m}` !== skipFirst) : out
}

/* ── per-month stats that only a daily series can answer ────────────────── */
function dailyStatsByMonth(daily) {
  const byKey = new Map()
  let prev = null
  for (const d of daily) {
    const key = `${d.y}-${d.m}`
    let b = byKey.get(key)
    if (!b) { b = { rets: [], peak: d.h, dd: 0 }; byKey.set(key, b) }
    if (prev) {
      const r = d.c / prev.c - 1
      if (Number.isFinite(r) && Math.abs(r) < 5) b.rets.push(r)
    }
    // Peak-to-trough INSIDE the month, off real highs and lows — not the
    // close-to-close approximation every screener settles for.
    b.peak = Math.max(b.peak, d.h)
    b.dd = Math.min(b.dd, d.l / b.peak - 1)
    prev = d
  }
  const out = new Map()
  for (const [key, b] of byKey) {
    out.set(key, {
      dd: r4(b.dd),
      up: b.rets.length ? r4(b.rets.filter((r) => r > 0).length / b.rets.length) : null,
      // Daily stdev annualised the crypto way (365 trading days).
      vol: b.rets.length > 4 ? r4(stdev(b.rets) * Math.sqrt(365)) : null,
    })
  }
  return out
}

/* ── weekday tape + turn-of-month effect ───────────────────────────────── */
function calendarEffects(daily) {
  const dowBuckets = Array.from({ length: 7 }, () => [])
  const turn = []
  const rest = []
  // A day is "turn of month" if it is one of the last 2 or first 3 calendar
  // days of a month — the window institutional flows are documented to cluster in.
  for (let i = 1; i < daily.length; i++) {
    const d = daily[i]
    const r = d.c / daily[i - 1].c - 1
    if (!Number.isFinite(r) || Math.abs(r) > 5) continue
    dowBuckets[d.dow].push(r)
    const daysInMonth = new Date(Date.UTC(d.y, d.m, 0)).getUTCDate()
    const isTurn = d.dom <= 3 || d.dom > daysInMonth - 2
    ;(isTurn ? turn : rest).push(r)
  }
  const pack = (arr) => ({
    avg: r6(mean(arr)),
    med: r6(median(arr)),
    win: arr.length ? r4(arr.filter((r) => r > 0).length / arr.length) : null,
    n: arr.length,
  })
  return {
    dow: dowBuckets.map((arr, i) => ({ d: i, ...pack(arr) })),
    tom: { turn: pack(turn), rest: pack(rest) },
  }
}

/* ── stitch + derive ───────────────────────────────────────────────────── */
function buildSeries(binance, cgMonths) {
  if (!binance?.length) return cgMonths || []
  if (!cgMonths?.length) return binance
  const firstB = binance[0]
  const head = cgMonths.filter((x) => x.y < firstB.y || (x.y === firstB.y && x.m < firstB.m))
  return [...head, ...binance]
}

function decorate(months, dailyStats) {
  const now = new Date()
  const curY = now.getUTCFullYear()
  const curM = now.getUTCMonth() + 1
  return months.map((mo, i) => {
    const prev = months[i - 1]
    // Reference price is the PREVIOUS month's close, never the candle's own
    // open. BTCUSDT began trading on 17 Aug 2017, so Binance's first monthly
    // candle opens at $4,261 — but BTC actually entered that August at $2,871.
    // Anchoring on the candle's own open reports August 2017 as +11% instead of
    // +65% and quietly loses half a year of return at the venue seam.
    const openRef = Number.isFinite(prev?.c) && prev.c > 0
      ? prev.c
      : (Number.isFinite(mo.o) && mo.o > 0 ? mo.o : null)
    const r = openRef ? mo.c / openRef - 1 : null
    const stats = dailyStats?.get(`${mo.y}-${mo.m}`) || null
    return {
      y: mo.y, m: mo.m,
      o: r6(mo.o), h: r6(mo.h), l: r6(mo.l), c: r6(mo.c),
      r: r4(r),
      src: mo.src,
      hl: mo.hl,
      partial: mo.y === curY && mo.m === curM,
      dd: stats?.dd ?? null,
      up: stats?.up ?? null,
      vol: stats?.vol ?? null,
    }
  })
}

/* Month-of-year aggregate, computed over completed months only. */
function monthProfile(months) {
  const out = []
  for (let m = 1; m <= 12; m++) {
    const rows = months.filter((x) => x.m === m && !x.partial && Number.isFinite(x.r))
    const rets = rows.map((x) => x.r)
    const best = rows.reduce((a, b) => (a && a.r > b.r ? a : b), null)
    const worst = rows.reduce((a, b) => (a && a.r < b.r ? a : b), null)
    out.push({
      m,
      n: rets.length,
      avg: r4(mean(rets)),
      med: r4(median(rets)),
      sd: r4(stdev(rets)),
      win: rets.length ? r4(rets.filter((r) => r > 0).length / rets.length) : null,
      best: best ? { y: best.y, r: best.r } : null,
      worst: worst ? { y: worst.y, r: worst.r } : null,
      dd: r4(mean(rows.map((x) => x.dd).filter(Number.isFinite))),
    })
  }
  return out
}

function yearProfile(months) {
  const byYear = new Map()
  for (const mo of months) {
    if (!Number.isFinite(mo.r)) continue
    let y = byYear.get(mo.y)
    if (!y) { y = { y: mo.y, g: 1, n: 0, first: mo.m, last: mo.m, partial: false }; byYear.set(mo.y, y) }
    y.g *= 1 + mo.r
    y.n += 1
    y.last = mo.m
    if (mo.partial) y.partial = true
  }
  return [...byYear.values()]
    .map((y) => ({ y: y.y, r: r4(y.g - 1), months: y.n, from: y.first, to: y.last, partial: y.partial || y.n < 12 }))
    .sort((a, b) => a.y - b.y)
}

/**
 * `light` builds the month grid only. The rotation board asks for eight assets
 * in one request, and the daily tape behind the drawdown/weekday stats costs up
 * to a dozen paged kline calls per asset — 100+ upstream round trips inside a
 * single 30s function. The compact response never exposes those fields anyway.
 */
async function assemble(symbol, market, cgIdHint, light = false) {
  const sym = String(symbol || '').toUpperCase().replace(/[^A-Z0-9.]/g, '')
  if (!sym) throw new Error('symbol required')

  const yahooTicker = YAHOO_ALIASES[sym] || (market === 'stocks' ? sym : null)

  if (yahooTicker) {
    const [mo, daily] = await Promise.all([
      yahooMonths(yahooTicker).catch(() => null),
      light ? Promise.resolve(null) : yahooDaily(yahooTicker).catch(() => null),
    ])
    if (!mo) return null
    const stats = daily ? dailyStatsByMonth(daily) : null
    const months = decorate(mo, stats)
    return {
      months,
      sources: ['yahoo'],
      effects: daily ? calendarEffects(daily) : null,
      venue: `Yahoo · ${yahooTicker}`,
    }
  }

  const cgId = cgIdHint || CG_IDS[sym] || null
  const pair = lookupBinancePair(sym)
  const [binance, cgDaily] = await Promise.all([
    binanceMonths(sym).catch(() => null),
    cgId ? coingeckoDaily(cgId).catch(() => null) : Promise.resolve(null),
  ])
  if (!binance && !cgDaily) return null

  const cgMonths = cgDaily ? monthsFromDaily(cgDaily) : null
  const raw = buildSeries(binance, cgMonths)
  if (!raw.length) return null

  // The daily tape behind the stats: Binance's own daily bars from the listing
  // (real highs and lows), with the CoinGecko closes carrying the years before
  // the pair existed. Fetched only once the month grid told us where to start.
  let bnDaily = null
  if (!light && pair && binance?.length) {
    const first = binance[0]
    bnDaily = await binanceDaily(pair, Math.floor(Date.UTC(first.y, first.m - 1, 1) / 1000)).catch(() => null)
  }
  let daily = null
  if (bnDaily && cgDaily) {
    const cut = bnDaily[0].t
    daily = [...cgDaily.filter((d) => d.t < cut), ...bnDaily]
  } else {
    daily = bnDaily || cgDaily
  }

  const stats = daily ? dailyStatsByMonth(daily) : null
  const months = decorate(raw, stats)
  const sources = [...new Set(raw.map((x) => x.src))]
  return {
    months,
    sources,
    effects: daily ? calendarEffects(daily) : null,
    venue: sources.includes('binance')
      ? (sources.length > 1 ? 'Binance spot + CoinGecko head' : 'Binance spot')
      : 'CoinGecko',
  }
}

function shape(sym, market, built) {
  const months = built.months
  const first = months[0]
  const last = months[months.length - 1]
  return {
    symbol: sym,
    market,
    venue: built.venue,
    sources: built.sources,
    coverage: {
      from: `${first.y}-${String(first.m).padStart(2, '0')}`,
      to: `${last.y}-${String(last.m).padStart(2, '0')}`,
      months: months.length,
      years: new Set(months.map((x) => x.y)).size,
    },
    months,
    monthProfile: monthProfile(months),
    yearProfile: yearProfile(months),
    effects: built.effects,
    asOf: Date.now(),
  }
}

async function loadOne(sym, market, cgIdHint, light = false) {
  const fullKey = `${CACHE_PREFIX}:${market}:${sym}`
  const key = light ? `${CACHE_PREFIX}:lite:${market}:${sym}` : fullKey
  try {
    // A light read happily takes the full payload when one is already warm; the
    // reverse must never happen, or opening an asset from the rotation board
    // would serve a grid with no drawdowns and no weekday tape.
    const hit = await getJsonWithTTL(fullKey)
    if (hit?.symbol) return hit
    if (light) {
      const lite = await getJsonWithTTL(key)
      if (lite?.symbol) return lite
    }
  } catch { /* KV optional */ }
  const built = await assemble(sym, market, cgIdHint, light)
  if (!built) return null
  const payload = shape(sym, market, built)
  try { await setJsonWithTTL(key, payload, TTL_SEC) } catch { /* best effort */ }
  return payload
}

/* Exposed for tests: these two carry the rules that actually decide whether the
   numbers are right (the venue seam and the CoinGecko day offset). */
export const __test__ = { monthsFromDaily, decorate, dailyPoint, calendarEffects, dailyStatsByMonth, monthProfile, yearProfile, buildSeries }

export default async function handler(req, res) {
  res.setHeader(
    'Access-Control-Allow-Origin',
    ['http://localhost:5180', 'http://localhost:5181', 'http://localhost:5182'].includes(req.headers?.origin) ? req.headers.origin : ''
  )
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const market = req.query.market === 'stocks' ? 'stocks' : 'crypto'
  const listed = String(req.query.symbols || '').split(',').map((s) => s.trim()).filter(Boolean)

  try {
    if (listed.length) {
      const syms = [...new Set(listed.map((s) => s.toUpperCase()))].slice(0, MAX_SYMBOLS)
      const rows = await Promise.all(syms.map((s) => loadOne(s, market, null, true).catch(() => null)))
      const assets = rows.filter(Boolean).map((p) => ({
        symbol: p.symbol,
        venue: p.venue,
        coverage: p.coverage,
        monthProfile: p.monthProfile,
        yearProfile: p.yearProfile,
      }))
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
      return res.status(200).json({ assets, asOf: Date.now() })
    }

    const sym = String(req.query.symbol || 'BTC').toUpperCase()
    const payload = await loadOne(sym, market, req.query.cgId || null)
    if (!payload) {
      return res.status(404).json({ error: 'No seasonal history for that symbol', symbol: sym })
    }
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    return res.status(200).json(payload)
  } catch (err) {
    console.error('[seasonality]', err?.message || err)
    return res.status(502).json({ error: 'Seasonality unavailable' })
  }
}
