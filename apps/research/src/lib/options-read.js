/**
 * Reading an options chain in words — the same discipline the cross-asset read
 * runs on: every sentence here may only restate a number that is already on
 * screen. Nothing forecasts, nothing recommends a trade, and where a figure
 * rests on an assumption the sentence names the assumption.
 */

/* ── formatting ─────────────────────────────────────────────────────────── */

export const fmtPct1 = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—')

export function fmtOi(v) {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`
  return String(Math.round(v))
}

/** Gamma notional runs to billions on SPY and to millions on a single name. */
export function fmtGex(v) {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : '+'
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(0)}M`
  return `${sign}$${(a / 1e3).toFixed(0)}k`
}

export function fmtStrike(v) {
  if (!Number.isFinite(v)) return '—'
  return v >= 100 ? v.toFixed(v % 1 === 0 ? 0 : 1) : v.toFixed(v % 1 === 0 ? 0 : 2)
}

/** "4d" reads better than a date the reader has to subtract from today. */
export function fmtDte(d) {
  if (!Number.isFinite(d)) return '—'
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  return `${d}d`
}

export function fmtExp(exp) {
  if (!exp) return '—'
  const [, m, d] = exp.split('-')
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${+d} ${MON[+m - 1]}`
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * "Wednesday 26 Aug, after the close" — the way a desk says a print date.
 *
 * The weekday is not decoration: an expiry is a Friday and a print is usually
 * not, and naming both is what stops a reader collapsing the two into one date.
 * Time of day matters just as much — a print after Wednesday's close is priced
 * by Thursday's open, which is a different trade from one that lands
 * pre-market.
 */
export function fmtEarningsWhen(iso) {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  const day = `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`
  // US cash session in UTC: 13:30 open, 20:00 close (EDT). Yahoo stamps an
  // after-close print at exactly 20:00Z, which is the common case.
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes()
  const when = mins >= 19 * 60 ? 'after the close' : mins <= 13 * 60 + 30 ? 'before the open' : null
  return when ? `${day}, ${when}` : day
}

/** $92.2B / $1.4M / $850k — an estimate nobody has to count zeros in. */
export function fmtBig(v) {
  if (!Number.isFinite(v)) return null
  const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}k`
  return `$${v.toFixed(2)}`
}

/* ── reads ──────────────────────────────────────────────────────────────── */

/**
 * The straddle's price as a pair of levels. A percentage is abstract; the two
 * prices are the thing a reader can put next to the chart.
 */
export function expectedRange(spot, move) {
  if (!(spot > 0) || !Number.isFinite(move) || move <= 0) return null
  return { lo: spot * (1 - move), hi: spot * (1 + move), pct: move }
}

/**
 * What the term structure is saying about a date.
 *
 * The lift is the whole argument, so it is always quoted. The wording stops at
 * "an event" — the vol surface names a date, never a reason, and calling it
 * earnings would be a guess dressed as data.
 */
/**
 * "a 8.9-point lift" is wrong and "an 8.9-point lift" is right, because the
 * article follows the SOUND of the number, not its spelling. Eight, eleven and
 * eighteen all open with a vowel sound; everything else in this range does not.
 */
function article(n) {
  const d = String(n)
  return /^8/.test(d) || /^1[18](\D|$)/.test(d) ? 'an' : 'a'
}

export function eventRead(event, symbol) {
  if (!event) {
    return {
      headline: 'No dated event priced',
      body: `Implied volatility falls away smoothly across ${symbol}'s expiries, which is what a calendar with nothing on it looks like.`,
      strength: null,
    }
  }

  const lift = (event.lift * 100).toFixed(1)
  const strong = event.strength === 'strong'
  const window = event.coversFrom
    ? `between ${fmtExp(event.coversFrom)} and ${fmtExp(event.exp)}`
    : `before ${fmtExp(event.exp)}`

  // The lift is the evidence, so it is quoted whichever branch we take.
  const evidence = `At-the-money volatility on the ${fmtExp(event.exp)} expiry is ${fmtPct1(event.iv)} against ${fmtPct1(event.baseline)} on the expiries around it — ${article(lift)} ${lift}-point lift that ${
    strong ? 'is larger than the expiry-to-expiry noise by a wide margin' : 'clears the expiry-to-expiry noise, though not by much'
  }.`

  const earnings = event.earnings
  const when = earnings ? fmtEarningsWhen(earnings.date) : null

  // 1. The calendar names it. Say the event, not the expiry.
  if (earnings?.inWindow && when) {
    const eps = Number.isFinite(earnings.epsEstimate) ? `$${earnings.epsEstimate.toFixed(2)}` : null
    const rev = fmtBig(earnings.revenueEstimate)
    const street = eps && rev ? ` Street looks for ${eps} a share on ${rev}.` : eps ? ` Street looks for ${eps} a share.` : ''
    return {
      headline: `${symbol} reports ${when}`,
      body: `${evidence} That expiry is the first one that covers the print, which is why the premium sits there and not on the date itself.${
        earnings.confirmed ? '' : ' The company has not confirmed the date yet, so it may move.'
      }${street}`,
      strength: event.strength,
      kind: 'earnings',
      plain: `In plain terms: traders are paying extra to hold ${symbol} through the print. The band below is how far they think it moves — options price the SIZE of a move, never its direction.`,
    }
  }

  // 2. The calendar rules earnings OUT. That is a finding, not an absence.
  if (earnings?.date && when) {
    return {
      headline: `Something is priced ${window}`,
      body: `${evidence} It is not earnings — ${symbol} does not report until ${when.split(',')[0]}. Whatever the market is paying for falls in that window, and the surface cannot name it.`,
      strength: event.strength,
      kind: 'not-earnings',
      // The generic "a date this clear usually maps to a scheduled
      // announcement" line cannot run here — the calendar has just ruled that
      // out three lines above, and a card that contradicts itself is worse
      // than one that says less.
      plain: `In plain terms: traders are paying extra for that specific date, and the earnings calendar has nothing on it. The band below is how far they think it moves — options price the SIZE of a move, never its direction.`,
    }
  }

  // 3. No calendar answer. Prices only, and say so.
  return {
    headline: `Something is priced ${window}`,
    body: `${evidence} Expiries after it price the same jump over more days, so implied vol decays again. Prices name a deadline, never a reason.`,
    strength: event.strength,
    kind: 'unknown',
    plain: 'In plain terms: traders are paying extra for exposure to that specific date, and the move they expect is the band below. Prices name the date, never the reason — but a date this clear usually maps to a scheduled announcement.',
  }
}

/**
 * The term structure, read out loud from the curve that is actually on screen.
 *
 * Dez's note: "term structure, think we need something to explain what that
 * means". A definition alone does not do it — the reader is looking at a
 * specific line and wants to know what THIS one is saying. So this describes
 * the shape in front of them and names the contrast case, which is how the
 * shape becomes legible: a hump means a date, a slope means an empty calendar.
 */
export function termStructureRead(chain, event, symbol) {
  const pts = (chain || []).filter((c) => Number.isFinite(c.atmIv) && c.atmIv > 0)
  if (pts.length < 2) return null

  const first = pts[0]
  const last = pts[pts.length - 1]

  if (event) {
    const peak = pts.find((c) => c.exp === event.exp)
    return {
      what: 'Each dot is one expiry; its height is the yearly rate of movement options for that date are priced at.',
      read: `${symbol}'s curve peaks on ${fmtExp(event.exp)} at ${fmtPct1(peak?.atmIv ?? event.iv)} and falls away after — ${fmtPct1(last.atmIv)} by ${fmtExp(last.exp)}. That hump is the shape a dated event makes. The first expiry that covers it pays for the whole jump; every expiry after it spreads the same jump across more days, so the rate per day drops even though the total risk has not.`,
      contrast: 'With nothing on the calendar the line just slopes gently upward — more days, more room to move.',
    }
  }

  const rising = last.atmIv > first.atmIv
  return {
    what: 'Each dot is one expiry; its height is the yearly rate of movement options for that date are priced at.',
    read: rising
      ? `${symbol}'s curve climbs steadily from ${fmtPct1(first.atmIv)} at ${fmtExp(first.exp)} to ${fmtPct1(last.atmIv)} at ${fmtExp(last.exp)}, with no peak in between. That is the shape of an empty calendar — more days simply mean more room to move.`
      : `${symbol}'s curve falls from ${fmtPct1(first.atmIv)} at ${fmtExp(first.exp)} to ${fmtPct1(last.atmIv)} at ${fmtExp(last.exp)}. A front month priced above the back is the market pricing near-term stress rather than a dated event.`,
    contrast: 'A single expiry standing above its neighbours would mean a date the market is paying for.',
  }
}

/**
 * Gamma in a sentence, with its assumption attached.
 *
 * Nothing public says who holds which side of an option, so every gamma model
 * assumes dealers are long the calls and short the puts. The sign that comes
 * out of that assumption is the whole reading, so the reading has to carry it.
 */
export function gammaRead(gamma, spot) {
  if (!gamma || !Number.isFinite(gamma.net)) return null
  const long = gamma.net > 0
  const flip = gamma.flip
  const where = flip == null
    ? null
    : spot > flip ? 'above' : spot < flip ? 'below' : 'at'
  return {
    net: gamma.net,
    long,
    headline: long ? 'Dealers assumed long gamma' : 'Dealers assumed short gamma',
    body: `Net ${fmtGex(gamma.net)} of gamma per 1% move${
      gamma.wall != null ? `, concentrated at the ${fmtStrike(gamma.wall)} strike` : ''
    }. ${
      long
        ? 'Hedging a long-gamma book means selling into strength and buying weakness, which damps moves.'
        : 'Hedging a short-gamma book means buying strength and selling weakness, which amplifies moves.'
    }${
      where ? ` Spot sits ${where} the ${fmtStrike(flip)} flip, where the sign changes.` : ''
    }`,
    caveat: 'Assumes dealers hold the calls and are short the puts — the convention every gamma model uses, because no exchange publishes who is on which side.',
  }
}

/**
 * Put/call as a phrase. The ratio is on open interest, which is the standing
 * book rather than the day's activity, and the two disagree often enough that
 * the label has to say which one it is.
 */
export function pcRead(pc) {
  if (!Number.isFinite(pc)) return '—'
  if (pc >= 1.3) return 'puts dominate'
  if (pc >= 1.05) return 'puts ahead'
  if (pc > 0.95) return 'balanced'
  if (pc > 0.7) return 'calls ahead'
  return 'calls dominate'
}

/**
 * The earnings runway — who reports next, and how soon.
 *
 * Dez asked whether we have an equities earnings calendar and whether it could
 * feed the reasoning. Half of that is per-symbol (naming the print behind a vol
 * lift); this is the other half — the board-wide view, so a reader can see what
 * is coming across every name the page tracks instead of clicking through them
 * one at a time to find out.
 *
 * The countdown is measured in CALENDAR days, not elapsed hours: a print at
 * 20:00 tomorrow is 1.5 hours-days away and every trader alive calls that
 * "tomorrow". Rounding hours would call it "in 2 days" this morning and
 * "tomorrow" this afternoon, for an event that never moved.
 */
export function earningsRunway(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return []
  const startOfDay = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) }
  const today = startOfDay(now)

  return rows
    .map((r) => {
      const at = Date.parse(r?.earningsDate)
      if (!Number.isFinite(at)) return null
      const days = Math.round((startOfDay(at) - today) / 86400000)
      // A print that has already happened is not a runway entry.
      if (days < 0) return null
      return {
        symbol: r.symbol,
        name: r.name || r.symbol,
        date: r.earningsDate,
        when: fmtEarningsWhen(r.earningsDate),
        // At 390px the full form truncates to "after the c…" — the session
        // phrase is the half that carries information, so on a phone the date
        // goes alone rather than half a phrase.
        whenShort: (() => {
          const d = new Date(at)
          return `${WEEKDAY[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`
        })(),
        days,
        countdown: days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`,
        // A week is the horizon at which an option chain starts pricing it,
        // which is what makes a name worth opening on this page.
        soon: days <= 7,
        confirmed: !r.isEstimate,
        epsEstimate: Number.isFinite(r.epsEstimate) ? r.epsEstimate : null,
        revenueEstimate: Number.isFinite(r.revenueEstimate) ? r.revenueEstimate : null,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.days - b.days || a.symbol.localeCompare(b.symbol))
}

const MONTH_NAME = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

/**
 * A month of prints, laid out as a trading week.
 *
 * Five columns, Monday to Friday — companies do not report on a Saturday, and
 * two dead columns in every row would cost 28% of the grid's width to say so.
 * Anything that does land on a weekend is returned separately rather than
 * quietly moved to an adjacent weekday, because a date nobody reports on is
 * still the date on the filing.
 *
 * Weeks with nothing in them are dropped: a month view exists to show WHERE the
 * prints cluster, and four empty rows above one dense one buries the answer.
 */
export function earningsMonth(runway, year, month, now = Date.now()) {
  const rows = Array.isArray(runway) ? runway : []
  const byDay = new Map()
  const weekend = []
  for (const r of rows) {
    const d = new Date(Date.parse(r.date))
    if (Number.isNaN(d.getTime())) continue
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month) continue
    const dow = d.getUTCDay()
    if (dow === 0 || dow === 6) { weekend.push(r); continue }
    const day = d.getUTCDate()
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(r)
  }

  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const nowD = new Date(now)
  const todayDay = nowD.getUTCFullYear() === year && nowD.getUTCMonth() === month ? nowD.getUTCDate() : null

  // Monday-first column index: JS gives 0=Sunday, and Sunday belongs at the END
  // of a trading week, not the start of it.
  const colOf = (dow) => (dow + 6) % 7

  const weeks = []
  let week = new Array(5).fill(null)
  for (let day = 1; day <= daysInMonth; day++) {
    const col = colOf(new Date(Date.UTC(year, month, day)).getUTCDay())
    if (col > 4) {
      // Saturday closes a row; Sunday is already past it.
      if (col === 5 && week.some(Boolean)) { weeks.push(week); week = new Array(5).fill(null) }
      continue
    }
    if (col === 0 && week.some(Boolean)) { weeks.push(week); week = new Array(5).fill(null) }
    week[col] = { day, isToday: day === todayDay, prints: byDay.get(day) || [] }
  }
  if (week.some(Boolean)) weeks.push(week)

  return {
    year,
    month,
    label: `${MONTH_NAME[month]} ${year}`,
    weeks: weeks.filter((w) => w.some(Boolean)),
    count: [...byDay.values()].reduce((n, a) => n + a.length, 0),
    weekend,
  }
}

/** The month a reader should land on: where the next print actually is. */
export function firstPrintMonth(runway, now = Date.now()) {
  const first = (Array.isArray(runway) ? runway : []).find((r) => Number.isFinite(Date.parse(r.date)))
  const d = new Date(first ? Date.parse(first.date) : now)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
}

/** Month arithmetic that does not go wrong in December. */
export function stepMonth({ year, month }, delta) {
  const t = new Date(Date.UTC(year, month + delta, 1))
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() }
}

/**
 * Milliseconds, whatever the feed sent.
 *
 * The equity candle feed stamps `t` in SECONDS while the rest of this board
 * works in milliseconds; read as-is it put the price axis at 21 Jan 1970. The
 * same unit mismatch has bitten the chart lane before, so normalise once at the
 * boundary instead of at every use.
 */
export function toMs(t) {
  // Number(null) and Number('') are both 0, which is finite — so a missing
  // stamp would sail through the guard and land the axis back in 1970, which
  // is the exact failure this function exists to prevent.
  if (t == null || t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 1e11 ? n : n * 1000
}

/**
 * One vertical scale for the candles, the cone and the strike levels.
 *
 * A level drawn off its own scale is worse than no level at all, so everything
 * that lands on the chart votes on the range — with one exception. A strike far
 * from the money (a 500 wall on a $208 name) would compress the entire tape
 * into a flat line to make room for a level nobody is trading, so levels only
 * get a vote while they are within `band` of spot.
 */
export function priceScale(bars, spot, move, levels = [], band = 0.25) {
  if (!Array.isArray(bars) || !bars.length) return null
  const vals = []
  for (const b of bars) {
    const h = Number(b.h), l = Number(b.l)
    if (Number.isFinite(h)) vals.push(h)
    if (Number.isFinite(l)) vals.push(l)
  }
  const s = Number(spot)
  const m = Number.isFinite(Number(move)) ? Number(move) : 0
  if (Number.isFinite(s) && s > 0) vals.push(s * (1 + m), s * (1 - m))
  for (const p of levels) {
    const v = Number(p)
    if (!Number.isFinite(v)) continue
    if (Number.isFinite(s) && s > 0 && Math.abs(v - s) >= s * band) continue
    vals.push(v)
  }
  if (!vals.length) return null
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const pad = (hi - lo) * 0.06 || 1
  return { lo: lo - pad, hi: hi + pad }
}

/**
 * Rows for the open-interest book, trimmed to the strikes worth drawing.
 *
 * A full chain runs from 5 to 1500 on NVDA; drawing all of it makes every bar
 * near the money one pixel tall. Keeps the strikes carrying real open interest
 * around spot and returns the scale with them so the bars and the axis cannot
 * disagree.
 */
export function bookRows(byStrike, spot, limit = 26) {
  if (!Array.isArray(byStrike) || !byStrike.length) return null
  const rows = byStrike
    .map((s) => ({ k: s.k, c: s.c || 0, p: s.p || 0, total: (s.c || 0) + (s.p || 0) }))
    .filter((s) => s.total > 0)
  if (!rows.length) return null
  // Keep the biggest strikes, then put them back in strike order so the axis
  // still reads as a price ladder.
  const kept = [...rows].sort((a, b) => b.total - a.total).slice(0, limit).sort((a, b) => a.k - b.k)
  const max = Math.max(...kept.map((r) => Math.max(r.c, r.p)))
  return { rows: kept, max: max || 1, spot }
}
