/**
 * The next confirmed earnings date for one ticker.
 *
 * Exists so the options board can tell a reader WHAT it is looking at. The
 * volatility surface names a date and never a reason — it cannot, prices carry
 * no labels — so on its own the board can only say "something is priced into
 * the 28 Aug expiry". The calendar closes that gap in both directions: when a
 * confirmed print falls inside the window that expiry covers, the board names
 * it; when none does, the board can say so and the lift becomes a genuinely
 * open question rather than an assumed earnings trade.
 *
 * Source is Yahoo's `calendarEvents`, the same module the stock pages read, so
 * the two surfaces can never disagree about when a company reports.
 */

import { getYahooSession, invalidateYahooSession, YAHOO_UA } from './yahoo-session.js'

const TTL_MS = 60 * 60 * 1000
const cache = new Map()

export async function getNextEarnings(symbol) {
  const key = String(symbol || '').toUpperCase()
  if (!key) return null

  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  let value = null
  try {
    const session = await getYahooSession()
    if (session.cookie && session.crumb) {
      const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(key)}`
        + `?modules=calendarEvents&crumb=${encodeURIComponent(session.crumb)}`
      const r = await fetch(url, {
        headers: { 'User-Agent': YAHOO_UA, Cookie: session.cookie },
        signal: AbortSignal.timeout(6000),
      })
      if (r.status === 401) invalidateYahooSession()
      else if (r.ok) {
        const json = await r.json()
        const cal = json?.quoteSummary?.result?.[0]?.calendarEvents?.earnings
        const dates = Array.isArray(cal?.earningsDate) ? cal.earningsDate : []
        const first = dates[0]?.raw
        if (first) {
          value = {
            date: new Date(first * 1000).toISOString(),
            // Yahoo returns a [start, end] PAIR while the date is still its own
            // estimate and a single element once the company has confirmed it.
            // A board that names an unconfirmed date as fact is worse than one
            // that names none, so the flag rides along with the date.
            confirmed: dates.length === 1,
            windowEnd: dates[1]?.raw ? new Date(dates[1].raw * 1000).toISOString() : null,
            epsEstimate: cal?.earningsAverage?.raw ?? null,
            revenueEstimate: cal?.revenueAverage?.raw ?? null,
          }
        }
      }
    }
  } catch { /* a missing calendar is a missing calendar — never invent a date */ }

  // Only a real answer is cached: a transient Yahoo miss must not hold the slot
  // for an hour, which is long enough to cover an entire earnings run-up.
  if (value) cache.set(key, { at: Date.now(), value })
  return value
}

export const __test__ = { cache }
