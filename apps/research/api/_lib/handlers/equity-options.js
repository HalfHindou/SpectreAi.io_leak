/**
 * Equity options positioning — CBOE delayed chains, summarised.
 *   GET /api/equity-options?symbol=NVDA
 *
 * Built for the question a desk actually asks before earnings: how is everyone
 * positioned, and what move is being priced. Not a chain browser — the raw
 * feed is 1.5MB for NVDA and 6MB for SPY, so everything below is computed here
 * and only the summary crosses the wire.
 *
 * Source: CBOE's public delayed-quotes endpoint. Free, no key, full greeks —
 * and DELAYED, which is stated in the payload rather than left for the reader
 * to assume.
 */

import { getJsonWithTTL, setJsonWithTTL } from '../kv.js'
import { getNextEarnings } from '../earnings-calendar.js'

const CACHE_PREFIX = 'eqopt:v1'
const TTL_SEC = 300

/* An option symbol is root + yymmdd + C/P + strike×1000. */
const OCC = /^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/

const num = (v) => (Number.isFinite(+v) ? +v : 0)
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null)
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null)

async function fetchChain(symbol) {
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol)}.json`
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  })
  if (!resp.ok) return null
  const json = await resp.json()
  return json?.data?.options?.length ? json.data : null
}

function parseChain(data) {
  const rows = []
  for (const o of data.options) {
    const m = OCC.exec(o.option || '')
    if (!m) continue
    const [, , yy, mm, dd, cp, strike] = m
    const oi = num(o.open_interest)
    const vol = num(o.volume)
    if (oi === 0 && vol === 0) continue
    rows.push({
      exp: `20${yy}-${mm}-${dd}`,
      call: cp === 'C',
      k: num(strike) / 1000,
      oi, vol,
      iv: num(o.iv),
      gamma: num(o.gamma),
      bid: num(o.bid),
      ask: num(o.ask),
    })
  }
  return rows
}

/**
 * The strike where the total intrinsic value of every open contract is
 * smallest — i.e. where the most open interest expires worthless.
 */
function maxPain(rows, strikes) {
  let best = null, bestVal = Infinity
  for (const s of strikes) {
    let v = 0
    for (const r of rows) {
      v += r.call ? r.oi * Math.max(0, s - r.k) : r.oi * Math.max(0, r.k - s)
    }
    if (v < bestVal) { bestVal = v; best = s }
  }
  return best
}

/**
 * Net gamma notional at one strike, in dollars per 1% move of spot.
 *
 * 🚩 This rests on ONE assumption that cannot be measured from public data:
 * that dealers are long the call open interest and short the put open
 * interest, which is the market-maker convention every published gamma model
 * uses. Exchanges do not publish who is on which side. Everything downstream
 * inherits that assumption, so the UI says so out loud rather than printing
 * this as an observation.
 *
 * gamma is per share per $1; ×100 for contract size, ×spot²×0.01 converts
 * "per $1" into "per 1% move" in dollar terms.
 */
function gexAt(calls, puts, k, spot) {
  // num(), not r.gamma directly: CBOE omits greeks on some illiquid contracts,
  // and one undefined turns the whole strike into NaN — which then propagates
  // through the net, the flip and the wall.
  const at = (rows) => rows.filter((r) => r.k === k).reduce((s, r) => s + num(r.gamma) * num(r.oi), 0)
  return (at(calls) - at(puts)) * 100 * spot * spot * 0.01
}

/**
 * Gamma across the WHOLE chain, which is the cut desks actually watch — a
 * single expiry's gamma says little when eight expiries sit on the same
 * strikes.
 *
 * The flip is the strike where cumulative gamma changes sign. A first-crossing
 * scan is not enough: on NVDA it returned 120 against a spot of 208, a
 * crossing in tail strikes nobody trades. Only a crossing near the money is
 * meaningful, so this takes the one CLOSEST to spot and reports none when the
 * nearest is beyond a quarter of spot away.
 */
function gammaProfile(rows, spot) {
  const calls = rows.filter((r) => r.call)
  const puts = rows.filter((r) => !r.call)
  const strikes = [...new Set(rows.map((r) => r.k))].sort((a, b) => a - b)
  const band = spot * 0.25

  const byStrike = strikes
    .map((k) => ({ k, g: Math.round(gexAt(calls, puts, k, spot)) }))
    .filter((x) => x.g !== 0)

  let cum = 0, flip = null
  for (const k of strikes) {
    const prev = cum
    cum += gexAt(calls, puts, k, spot)
    const crossed = (prev <= 0 && cum > 0) || (prev >= 0 && cum < 0)
    if (crossed && Math.abs(k - spot) <= band) {
      if (flip == null || Math.abs(k - spot) < Math.abs(flip - spot)) flip = k
    }
  }

  // The strike carrying the most gamma near the money — where price gets
  // pinned when dealers hedge into it.
  const near = byStrike.filter((x) => Math.abs(x.k - spot) <= band)
  const wall = near.length ? near.reduce((a, b) => (Math.abs(b.g) > Math.abs(a.g) ? b : a)) : null

  return {
    net: Math.round(byStrike.reduce((s, x) => s + x.g, 0)),
    flip,
    wall: wall ? wall.k : null,
    byStrike: near,
  }
}

function summariseExpiry(rows, exp, spot, today) {
  const fr = rows.filter((r) => r.exp === exp)
  if (!fr.length) return null
  const calls = fr.filter((r) => r.call)
  const puts = fr.filter((r) => !r.call)
  const coi = calls.reduce((s, r) => s + r.oi, 0)
  const poi = puts.reduce((s, r) => s + r.oi, 0)
  const cvol = calls.reduce((s, r) => s + r.vol, 0)
  const pvol = puts.reduce((s, r) => s + r.vol, 0)
  const strikes = [...new Set(fr.map((r) => r.k))].sort((a, b) => a - b)

  const atm = strikes.reduce((a, b) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a), strikes[0])
  const mid = (r) => (r && r.ask > 0 ? (r.bid + r.ask) / 2 : 0)
  const ac = calls.find((r) => r.k === atm)
  const ap = puts.find((r) => r.k === atm)
  const straddle = mid(ac) + mid(ap)

  const dte = Math.max(0, Math.round((Date.parse(`${exp}T21:00:00Z`) - today) / 86400000))

  return {
    exp,
    dte,
    callOi: coi,
    putOi: poi,
    pcOi: coi > 0 ? r2(poi / coi) : null,
    callVol: cvol,
    putVol: pvol,
    pcVol: cvol > 0 ? r2(pvol / cvol) : null,
    atm,
    // The market's own number, not a model: what the at-the-money straddle costs.
    atmIv: r4(ac?.iv || ap?.iv || 0),
    straddle: r2(straddle),
    expectedMove: spot > 0 && straddle > 0 ? r4(straddle / spot) : null,
    maxPain: maxPain(fr, strikes),
    // Where the open interest actually sits — the positioning picture.
    // `g` is the strike's net gamma notional in dollars per 1% move, under the
    // dealer convention below; the UI must label it as an assumption.
    byStrike: strikes.map((k) => ({
      k,
      c: calls.filter((r) => r.k === k).reduce((s, r) => s + r.oi, 0),
      p: puts.filter((r) => r.k === k).reduce((s, r) => s + r.oi, 0),
      g: Math.round(gexAt(calls, puts, k, spot)),
    })).filter((s) => s.c || s.p),
    netGex: Math.round(strikes.reduce((s, k) => s + gexAt(calls, puts, k, spot), 0)),
    topOi: [...fr].sort((a, b) => b.oi - a.oi).slice(0, 6)
      .map((r) => ({ k: r.k, side: r.call ? 'C' : 'P', oi: r.oi, vol: r.vol })),
  }
}

/**
 * Read the implied-volatility term structure for a priced event.
 *
 * A calm term structure rises smoothly with time — more days, more variance.
 * A dated event breaks that: the first expiry that CONTAINS the event carries
 * its whole premium, and every later expiry amortises the same jump over more
 * days, so implied vol decays after it. A local maximum is therefore the
 * market naming a date, and NVDA prints the textbook shape — 29.9% on today's
 * expiry, 72.0% on 28 Aug, 57.0% the week after.
 *
 * This is an inference from prices, not a calendar lookup, so it returns the
 * evidence (the lift in vol points) and never the word "earnings" — a lift can
 * equally be an FDA date, a court ruling or an index rebalance.
 */
function impliedEvent(chain) {
  const pts = chain.filter((c) => Number.isFinite(c.atmIv) && c.atmIv > 0)
  if (pts.length < 3) return null
  let best = null
  for (let i = 0; i < pts.length - 1; i++) {
    // An expiry inside a day or two carries hours of real time, and annualising
    // hours inflates implied vol on its own. TSLA's 0DTE printed 61.6% against
    // 44.1% next — a 17-point "event" that was only the clock. An event also
    // has to be ahead of us to be worth naming.
    if (pts[i].dte < 2) continue
    const iv = pts[i].atmIv
    const next = pts[i + 1].atmIv
    const prev = i > 0 ? pts[i - 1].atmIv : null
    if (iv <= next) continue                     // still climbing: no peak here
    if (prev != null && iv <= prev) continue     // not a local maximum
    const lift = prev == null ? iv - next : iv - Math.max(prev, next)
    if (lift < 0.06) continue
    if (!best || lift > best.lift) {
      best = {
        exp: pts[i].exp,
        dte: pts[i].dte,
        // An expiry is not a date, it is a DEADLINE. Options expiring on the
        // 28th already priced everything the 24th's did; what the 28th adds is
        // the window in between, so that window — not the expiry — is where
        // the catalyst sits. Reading the expiry as the event date is the one
        // misreading this board invites, and it is the reading a trader
        // arrives with.
        coversFrom: i > 0 ? pts[i - 1].exp : null,
        iv: r4(iv),
        baseline: r4(prev == null ? next : Math.max(prev, next)),
        lift: r4(lift),
        // Weekly expiries sit either side of a weekend, and annualising over
        // calendar days that hold no trading puts a sawtooth in the term
        // structure worth a few vol points on its own. Six points clears the
        // noise; twelve is a size only a dated event produces.
        strength: lift >= 0.12 ? 'strong' : 'moderate',
      }
    }
  }
  return best
}

/**
 * Ask the calendar what actually falls inside the window the market is pricing.
 *
 * This is the half the vol surface cannot supply. Prices name a deadline; only
 * a calendar names the event. Both answers are worth having:
 *
 *   NVDA — reports Wed 26 Aug, and the 28 Aug expiry is the first that covers
 *   it. The lift has a name.
 *
 *   COIN, MSTR and HOOD — all three lift on that same 28 Aug expiry and none
 *   of them reports until late October. Ruling earnings OUT makes their shared
 *   date more interesting, not less, and a board that assumed "lift = earnings"
 *   would have said something false about three tickers out of four.
 *
 * Fail-soft by construction: no calendar answer leaves the event exactly as the
 * prices described it.
 */
async function withEarnings(event, symbol, today) {
  if (!event) return null
  let earnings = null
  try { earnings = await getNextEarnings(symbol) } catch { /* prices still stand */ }
  if (!earnings?.date) return event

  const at = Date.parse(earnings.date)
  // The window opens at the previous expiry's close (everything before that was
  // already paid for in that contract) and shuts at this one's.
  const opensAt = event.coversFrom ? Date.parse(`${event.coversFrom}T21:00:00Z`) : today
  const closesAt = Date.parse(`${event.exp}T21:00:00Z`)

  return {
    ...event,
    earnings: {
      date: earnings.date,
      confirmed: earnings.confirmed,
      epsEstimate: earnings.epsEstimate,
      revenueEstimate: earnings.revenueEstimate,
      // The whole point of the lookup: does the print land in the window this
      // expiry is charging for?
      inWindow: Number.isFinite(at) && at > opensAt && at <= closesAt,
    },
  }
}

async function assemble(symbol) {
  const data = await fetchChain(symbol)
  if (!data) return null
  const spot = num(data.current_price)
  if (!(spot > 0)) return null
  const rows = parseChain(data)
  if (rows.length < 20) return null

  const today = Date.now()
  const expiries = [...new Set(rows.map((r) => r.exp))].sort()
  // Front-month means the first expiry with time left in it. The nearest is
  // often 0DTE, whose straddle prices a few hours and reads as "no move
  // expected" next to an earnings date.
  const tradable = expiries.filter((e) => Date.parse(`${e}T21:00:00Z`) > today)
  const focus = tradable.find((e) => (Date.parse(`${e}T00:00:00Z`) - today) / 86400000 >= 1) || tradable[0]

  const summaries = tradable.slice(0, 8)
    .map((e) => summariseExpiry(rows, e, spot, today))
    .filter(Boolean)

  const totalCallOi = rows.filter((r) => r.call).reduce((s, r) => s + r.oi, 0)
  const totalPutOi = rows.filter((r) => !r.call).reduce((s, r) => s + r.oi, 0)

  return {
    symbol: symbol.toUpperCase(),
    spot: r2(spot),
    source: 'CBOE',
    delayed: true,
    contracts: rows.length,
    expiries: tradable.slice(0, 12),
    focus,
    chain: summaries,
    // The window the options market is pricing something in, if it is pricing
    // one — with the calendar's answer for what falls inside it.
    event: await withEarnings(impliedEvent(summaries), symbol, today),
    gamma: gammaProfile(rows, spot),
    totals: {
      callOi: totalCallOi,
      putOi: totalPutOi,
      pcOi: totalCallOi > 0 ? r2(totalPutOi / totalCallOi) : null,
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

  const symbol = String(req.query.symbol || 'NVDA').toUpperCase().replace(/[^A-Z.]/g, '')
  if (!symbol || symbol.length > 6) return res.status(400).json({ error: 'symbol required' })

  const key = `${CACHE_PREFIX}:${symbol}`
  try {
    const hit = await getJsonWithTTL(key)
    if (hit?.symbol) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
      return res.status(200).json(hit)
    }
  } catch { /* KV optional */ }

  try {
    const payload = await assemble(symbol)
    if (!payload) return res.status(404).json({ error: 'No listed options for that symbol', symbol })
    try { await setJsonWithTTL(key, payload, TTL_SEC) } catch { /* best effort */ }
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
    return res.status(200).json(payload)
  } catch (err) {
    console.error('[equity-options]', err?.message || err)
    return res.status(502).json({ error: 'Options data unavailable' })
  }
}

export const __test__ = { parseChain, maxPain, summariseExpiry, gexAt, gammaProfile, impliedEvent, withEarnings, OCC }
