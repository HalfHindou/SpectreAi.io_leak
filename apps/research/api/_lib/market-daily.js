/**
 * Daily price series, one implementation, two transports.
 *
 * Extracted from handlers/seasonality.js so the seasonal board and the
 * cross-asset correlation engine cannot drift apart on the two things that
 * were expensive to learn:
 *
 *   1. Yahoo silently DOWNGRADES granularity instead of erroring. Ask ^GSPC for
 *      `interval=1mo&range=max` and it returns 3-month buckets that look exactly
 *      like monthly bars. Every read here verifies `meta.dataGranularity` and
 *      steps the window down until Yahoo actually serves what was asked for.
 *   2. Binance caps a klines call at 1000 bars and silently switches to
 *      "last 1000 ending at `to`" when the window is wider — so a multi-year
 *      daily pull has to be paged, not requested in one shot.
 */

import { lookupBinancePair, fetchBinanceKlines } from './binance-bars.js'

const MS_DAY = 86400000

/* Yahoo answers a narrower window at the requested granularity, so step down
   until it stops downgrading. `period1=0` is the widest and is tried first. */
const YAHOO_WINDOWS = ['period1=0', 'range=10y', 'range=5y', 'range=2y', 'range=1y']

export async function yahooSeries(ticker, interval) {
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

/** `{ 'YYYY-MM-DD': close }` from Yahoo, adjusted where Yahoo provides it. */
export async function yahooDailyCloses(ticker) {
  const s = await yahooSeries(ticker, '1d')
  if (!s) return null
  const { ts, q, adj } = s
  const out = new Map()
  for (let i = 0; i < ts.length; i++) {
    const c = Number.isFinite(adj?.[i]) ? adj[i] : q.close?.[i]
    if (!Number.isFinite(c) || c <= 0) continue
    out.set(new Date(ts[i] * 1000).toISOString().slice(0, 10), c)
  }
  return out.size > 60 ? out : null
}

/**
 * `{ 'YYYY-MM-DD': close }` from Binance, paged.
 *
 * fetchBinanceKlines drops `startTime` when the window exceeds 1000 bars and
 * returns the LAST 1000 instead, so asking for three years in one call quietly
 * yields the most recent third. Page it in 900-day windows, in parallel.
 */
export async function binanceDailyCloses(symbol, days = 900) {
  const pair = lookupBinancePair(symbol)
  if (!pair) return null
  const now = Math.floor(Date.now() / 1000)
  const start = now - days * 86400
  const STEP = (900 * MS_DAY) / 1000
  const windows = []
  for (let from = start; from < now; from += STEP) windows.push([from, Math.min(from + STEP, now)])
  if (!windows.length || windows.length > 8) return null

  const pages = await Promise.all(
    windows.map(([f, t]) => fetchBinanceKlines(pair, '1D', f, t).catch(() => null))
  )
  const out = new Map()
  for (const page of pages) {
    if (!page) continue
    for (const b of page) {
      if (!Number.isFinite(b.c) || b.c <= 0) continue
      out.set(new Date(b.t * 1000).toISOString().slice(0, 10), b.c)
    }
  }
  return out.size > 60 ? out : null
}
