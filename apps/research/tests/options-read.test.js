import { describe, it, expect } from 'vitest'
import {
  fmtOi, fmtGex, fmtStrike, fmtDte, fmtExp,
  expectedRange, eventRead, gammaRead, pcRead, bookRows,
  fmtEarningsWhen, fmtBig, termStructureRead, toMs, priceScale, earningsRunway,
  earningsMonth, firstPrintMonth, stepMonth,
} from '../src/lib/options-read.js'

describe('formatting', () => {
  it('keeps open interest readable across four orders of magnitude', () => {
    expect(fmtOi(942)).toBe('942')
    expect(fmtOi(9_400)).toBe('9.4k')
    expect(fmtOi(65_232)).toBe('65k')
    expect(fmtOi(7_431_656)).toBe('7.4M')
  })

  it('signs gamma notional and scales it from thousands to billions', () => {
    expect(fmtGex(562_700_000)).toBe('+$563M')
    expect(fmtGex(-12_563_200_000)).toBe('−$12.6B')
    expect(fmtGex(-222_000)).toBe('−$222k')
  })

  it('drops trailing zeros from a strike but keeps a real half', () => {
    expect(fmtStrike(230)).toBe('230')
    expect(fmtStrike(217.5)).toBe('217.5')
    expect(fmtStrike(2.75)).toBe('2.75')
  })

  it('says today and tomorrow rather than making the reader subtract', () => {
    expect(fmtDte(0)).toBe('today')
    expect(fmtDte(1)).toBe('tomorrow')
    expect(fmtDte(4)).toBe('4d')
  })

  it('formats an expiry without a timezone round trip', () => {
    // Date.parse on a bare date is UTC, and rendering it in a western zone
    // would print the day before. There is no Date here for that reason.
    expect(fmtExp('2026-08-28')).toBe('28 Aug')
    expect(fmtExp('2026-01-02')).toBe('2 Jan')
  })
})

describe('expectedRange', () => {
  it('turns the straddle into the two prices it implies', () => {
    const r = expectedRange(208.44, 0.06)
    expect(r.lo).toBeCloseTo(195.93, 2)
    expect(r.hi).toBeCloseTo(220.95, 2)
  })

  it('refuses to invent a range without a move', () => {
    expect(expectedRange(208, 0)).toBe(null)
    expect(expectedRange(208, null)).toBe(null)
    expect(expectedRange(0, 0.06)).toBe(null)
  })
})

describe('eventRead', () => {
  it('quotes the lift, because the lift is the whole argument', () => {
    const r = eventRead({ exp: '2026-08-28', dte: 4, iv: 0.724, baseline: 0.575, lift: 0.149, strength: 'strong' }, 'NVDA')
    expect(r.headline).toContain('28 Aug')
    expect(r.body).toContain('14.9-point lift')
    expect(r.body).toContain('72.4%')
    expect(r.body).toContain('57.5%')
  })

  it('never GUESSES a reason when nothing named one', () => {
    // The rule was never "say less" — it is "do not invent". With no calendar
    // answer the surface has only a deadline, and says so.
    const r = eventRead({ exp: '2026-08-28', dte: 4, iv: 0.93, baseline: 0.823, lift: 0.107, strength: 'moderate' }, 'MSTR')
    expect(`${r.headline} ${r.body}`.toLowerCase()).not.toContain('earnings')
    expect(r.body).toContain('never a reason')
    expect(r.kind).toBe('unknown')
  })

  it('names the print when the calendar puts one inside the window', () => {
    // Dez: "earnings are weds 26th ... maybe the incorrect interpretation."
    // The expiry is Friday; the event is Wednesday. Say the Wednesday.
    const r = eventRead({
      exp: '2026-08-28', dte: 3, iv: 0.727, baseline: 0.577, lift: 0.15, strength: 'strong',
      coversFrom: null,
      earnings: { date: '2026-08-26T20:00:00.000Z', confirmed: true, inWindow: true, epsEstimate: 2.09161, revenueEstimate: 92176624640 },
    }, 'NVDA')
    expect(r.headline).toBe('NVDA reports Wednesday 26 Aug, after the close')
    expect(r.kind).toBe('earnings')
    expect(r.body).toContain('first one that covers the print')
    expect(r.body).toContain('$2.09 a share on $92.2B')
  })

  it('flags an unconfirmed date instead of stating it as fact', () => {
    const r = eventRead({
      exp: '2026-08-28', dte: 3, iv: 0.7, baseline: 0.55, lift: 0.15, strength: 'strong',
      earnings: { date: '2026-08-26T20:00:00.000Z', confirmed: false, inWindow: true, epsEstimate: null, revenueEstimate: null },
    }, 'NVDA')
    expect(r.body).toContain('not confirmed the date yet')
  })

  it('rules earnings OUT when the calendar puts the print elsewhere', () => {
    // COIN, MSTR and HOOD all lift on 28 Aug and none reports until late Oct —
    // an absence that makes the shared date more interesting, not less.
    const r = eventRead({
      exp: '2026-08-28', dte: 3, iv: 0.781, baseline: 0.692, lift: 0.089, strength: 'moderate',
      earnings: { date: '2026-10-29T20:00:00.000Z', confirmed: true, inWindow: false, epsEstimate: -0.13, revenueEstimate: null },
    }, 'COIN')
    expect(r.kind).toBe('not-earnings')
    expect(r.body).toContain('It is not earnings')
    expect(r.body).toContain('Thursday 29 Oct')
  })

  it('says which window it means, not just which expiry', () => {
    const withPrev = eventRead({ exp: '2026-08-28', dte: 4, iv: 0.9, baseline: 0.7, lift: 0.2, strength: 'strong', coversFrom: '2026-08-24' }, 'X')
    expect(withPrev.headline).toContain('between 24 Aug and 28 Aug')
    const front = eventRead({ exp: '2026-08-28', dte: 4, iv: 0.9, baseline: 0.7, lift: 0.2, strength: 'strong', coversFrom: null }, 'X')
    expect(front.headline).toContain('before 28 Aug')
  })

  it('picks the article by how the number sounds, not how it starts', () => {
    // "a 8.9-point lift" shipped once. Eight, eleven and eighteen open with a
    // vowel sound; fourteen and fifteen do not.
    const at = (lift) => eventRead({ exp: '2026-08-28', dte: 4, iv: 0.9, baseline: 0.8, lift, strength: 'moderate' }, 'X').body
    expect(at(0.089)).toContain('an 8.9-point')
    expect(at(0.11)).toContain('an 11.0-point')
    expect(at(0.18)).toContain('an 18.0-point')
    expect(at(0.149)).toContain('a 14.9-point')
    expect(at(0.107)).toContain('a 10.7-point')
  })

  it('never lets the plain-language line contradict the read above it', () => {
    // The static line said "a date this clear usually maps to a scheduled
    // announcement" — directly under a sentence that had just ruled one out.
    const named = eventRead({
      exp: '2026-08-28', dte: 3, iv: 0.72, baseline: 0.57, lift: 0.15, strength: 'strong',
      earnings: { date: '2026-08-26T20:00:00.000Z', confirmed: true, inWindow: true },
    }, 'NVDA')
    expect(named.plain).toContain('through the print')
    expect(named.plain).not.toContain('never the reason')

    const ruledOut = eventRead({
      exp: '2026-08-28', dte: 3, iv: 0.78, baseline: 0.69, lift: 0.089, strength: 'moderate',
      earnings: { date: '2026-10-29T20:00:00.000Z', confirmed: true, inWindow: false },
    }, 'COIN')
    expect(ruledOut.plain).toContain('earnings calendar has nothing on it')
    expect(ruledOut.plain).not.toContain('scheduled announcement')

    const unknown = eventRead({ exp: '2026-08-28', dte: 4, iv: 0.9, baseline: 0.7, lift: 0.2, strength: 'strong' }, 'X')
    expect(unknown.plain).toContain('never the reason')
  })

  it('says so plainly when nothing is priced', () => {
    const r = eventRead(null, 'SPY')
    expect(r.headline).toBe('No dated event priced')
    expect(r.strength).toBe(null)
  })
})

describe('gammaRead', () => {
  it('carries its assumption rather than stating a sign as fact', () => {
    const r = gammaRead({ net: 562_700_000, flip: 230, wall: 230 }, 208.44)
    expect(r.long).toBe(true)
    expect(r.caveat).toMatch(/short the puts/)
    expect(r.body).toContain('below the 230 flip')
  })

  it('reads a negative book as amplifying moves', () => {
    const r = gammaRead({ net: -1_000_000, flip: null, wall: 100 }, 105)
    expect(r.headline).toContain('short gamma')
    expect(r.body).toContain('amplifies')
  })

  it('omits the flip sentence when there is no crossing near spot', () => {
    const r = gammaRead({ net: 5_000_000, flip: null, wall: 100 }, 105)
    expect(r.body).not.toContain('flip')
  })
})

describe('pcRead', () => {
  it('names which side the standing book leans', () => {
    expect(pcRead(0.5)).toBe('calls dominate')
    expect(pcRead(0.82)).toBe('calls ahead')
    expect(pcRead(1.0)).toBe('balanced')
    expect(pcRead(3.05)).toBe('puts dominate')
    expect(pcRead(null)).toBe('—')
  })
})

describe('bookRows', () => {
  const chain = [
    { k: 5, c: 1, p: 0 }, { k: 200, c: 100, p: 50 },
    { k: 210, c: 300, p: 20 }, { k: 230, c: 900, p: 5 },
  ]

  it('keeps the biggest strikes but hands them back in price order', () => {
    const b = bookRows(chain, 208, 3)
    expect(b.rows.map((r) => r.k)).toEqual([200, 210, 230])
  })

  it('scales bars off the largest single side, so no bar can exceed the track', () => {
    const b = bookRows(chain, 208, 4)
    expect(b.max).toBe(900)
  })

  it('drops strikes carrying nothing', () => {
    expect(bookRows([{ k: 100, c: 0, p: 0 }], 100)).toBe(null)
    expect(bookRows([], 100)).toBe(null)
    expect(bookRows(null, 100)).toBe(null)
  })
})

describe('fmtEarningsWhen', () => {
  it('names the weekday and the side of the session', () => {
    // The weekday is load-bearing: an expiry is a Friday and a print is not,
    // and naming both is what stops the two collapsing into one date.
    expect(fmtEarningsWhen('2026-08-26T20:00:00.000Z')).toBe('Wednesday 26 Aug, after the close')
    expect(fmtEarningsWhen('2026-08-26T11:00:00.000Z')).toBe('Wednesday 26 Aug, before the open')
  })

  it('drops the session phrase rather than guess at a mid-session print', () => {
    expect(fmtEarningsWhen('2026-08-26T16:00:00.000Z')).toBe('Wednesday 26 Aug')
  })

  it('returns null for nothing', () => {
    expect(fmtEarningsWhen(null)).toBe(null)
    expect(fmtEarningsWhen('not a date')).toBe(null)
  })
})

describe('fmtBig', () => {
  it('scales an estimate to something nobody counts zeros in', () => {
    expect(fmtBig(92176624640)).toBe('$92.2B')
    expect(fmtBig(1_400_000)).toBe('$1.4M')
    expect(fmtBig(850_000)).toBe('$850k')
    expect(fmtBig(null)).toBe(null)
  })
})

describe('termStructureRead', () => {
  const chain = [
    { exp: '2026-08-28', atmIv: 0.727 }, { exp: '2026-08-31', atmIv: 0.577 },
    { exp: '2026-09-04', atmIv: 0.516 }, { exp: '2026-09-25', atmIv: 0.407 },
  ]

  it('reads the hump off the curve on screen and names the contrast', () => {
    const r = termStructureRead(chain, { exp: '2026-08-28', iv: 0.727 }, 'NVDA')
    expect(r.read).toContain('peaks on 28 Aug at 72.7%')
    expect(r.read).toContain('40.7% by 25 Sep')
    expect(r.contrast).toContain('slopes gently upward')
  })

  it('reads a rising curve as an empty calendar', () => {
    const rising = [{ exp: '2026-08-28', atmIv: 0.2 }, { exp: '2026-09-25', atmIv: 0.3 }]
    const r = termStructureRead(rising, null, 'SPY')
    expect(r.read).toContain('climbs steadily')
    expect(r.contrast).toContain('standing above its neighbours')
  })

  it('reads an inverted curve as near-term stress, not an event', () => {
    const falling = [{ exp: '2026-08-28', atmIv: 0.6 }, { exp: '2026-09-25', atmIv: 0.3 }]
    expect(termStructureRead(falling, null, 'X').read).toContain('near-term stress')
  })

  it('says nothing when there is not enough curve to read', () => {
    expect(termStructureRead([{ exp: '2026-08-28', atmIv: 0.5 }], null, 'X')).toBe(null)
  })
})

describe('toMs', () => {
  it('promotes a seconds stamp and leaves milliseconds alone', () => {
    // The equity candle feed sends seconds; read as-is it put the price axis
    // at 21 Jan 1970.
    expect(toMs(1779802200)).toBe(1779802200000)
    expect(toMs(1779802200000)).toBe(1779802200000)
    expect(new Date(toMs(1779802200)).getUTCFullYear()).toBe(2026)
  })

  it('returns null rather than a 1970 date for junk', () => {
    expect(toMs(null)).toBe(null)
    expect(toMs('nope')).toBe(null)
  })
})

describe('priceScale', () => {
  const bars = [
    { h: 220, l: 205 }, { h: 218, l: 208 }, { h: 224, l: 212 },
  ]

  it('frames the candles and both ends of the cone', () => {
    const r = priceScale(bars, 208.44, 0.061, [])
    expect(r.lo).toBeLessThan(195.7)   // 208.44 x 0.939
    expect(r.hi).toBeGreaterThan(224)  // the highest candle
  })

  it('lets a near-money strike pull the scale', () => {
    const without = priceScale(bars, 208.44, 0.02, [])
    const withWall = priceScale(bars, 208.44, 0.02, [230])
    expect(withWall.hi).toBeGreaterThan(without.hi)
  })

  it('refuses a strike far from the money — it would flatten the tape', () => {
    // A 500 wall on a $208 name is a level nobody is trading, and giving it
    // room compresses three months of candles into a line.
    const far = priceScale(bars, 208.44, 0.02, [500])
    const none = priceScale(bars, 208.44, 0.02, [])
    expect(far.hi).toBeCloseTo(none.hi, 6)
  })

  it('still scales when there is no spot to measure a level against', () => {
    const r = priceScale(bars, null, null, [999])
    expect(r.hi).toBeGreaterThan(224)
  })

  it('says nothing without candles', () => {
    expect(priceScale([], 208, 0.06, [])).toBe(null)
    expect(priceScale(null, 208, 0.06, [])).toBe(null)
  })
})

describe('earningsRunway', () => {
  // 25 Aug 2026, 07:20 UTC — a morning, so the hours-vs-calendar-days
  // distinction is live.
  const NOW = Date.parse('2026-08-25T07:20:00Z')
  const row = (symbol, date, extra = {}) => ({ symbol, name: symbol, earningsDate: date, epsEstimate: 1, revenueEstimate: 1e9, isEstimate: false, ...extra })

  it('counts CALENDAR days, so a print at 20:00 tomorrow is "tomorrow"', () => {
    // 36 hours away. Rounding elapsed hours would say "in 2 days" this morning
    // and "tomorrow" this afternoon, for an event that never moved.
    const [r] = earningsRunway([row('NVDA', '2026-08-26T20:00:00Z')], NOW)
    expect(r.days).toBe(1)
    expect(r.countdown).toBe('tomorrow')
    expect(r.when).toBe('Wednesday 26 Aug, after the close')
    expect(r.whenShort).toBe('Wed 26 Aug')
  })

  it('calls a print later today "today"', () => {
    expect(earningsRunway([row('X', '2026-08-25T20:00:00Z')], NOW)[0].countdown).toBe('today')
  })

  it('sorts soonest first and drops prints that already happened', () => {
    const r = earningsRunway([
      row('HOOD', '2026-11-04T20:00:00Z'),
      row('OLD', '2026-08-20T20:00:00Z'),
      row('NVDA', '2026-08-26T20:00:00Z'),
      row('COIN', '2026-10-29T20:00:00Z'),
    ], NOW)
    expect(r.map((x) => x.symbol)).toEqual(['NVDA', 'COIN', 'HOOD'])
  })

  it('marks only the week ahead as soon — that is the horizon a chain prices', () => {
    const r = earningsRunway([
      row('A', '2026-09-01T20:00:00Z'),   // 7 days
      row('B', '2026-09-02T20:00:00Z'),   // 8 days
    ], NOW)
    expect(r[0].soon).toBe(true)
    expect(r[1].soon).toBe(false)
  })

  it('drops rows with no date instead of guessing one', () => {
    expect(earningsRunway([row('SPY', null), { symbol: 'QQQ' }], NOW)).toEqual([])
    expect(earningsRunway(null, NOW)).toEqual([])
  })

  it('carries the estimate through, and flags an unconfirmed date', () => {
    const [r] = earningsRunway([row('NVDA', '2026-08-26T20:00:00Z', { epsEstimate: 2.09161, isEstimate: true })], NOW)
    expect(r.epsEstimate).toBeCloseTo(2.09161, 5)
    expect(r.confirmed).toBe(false)
  })
})

describe('earningsMonth', () => {
  const NOW = Date.parse('2026-08-25T07:20:00Z')
  const r = (symbol, date) => ({ symbol, date })
  const OCT = [
    r('TSLA', '2026-10-21T20:00:00Z'),
    r('GOOGL', '2026-10-28T20:00:00Z'), r('META', '2026-10-28T20:00:00Z'), r('MSFT', '2026-10-28T20:00:00Z'),
    r('AAPL', '2026-10-29T20:00:00Z'), r('AMZN', '2026-10-29T20:00:00Z'),
  ]

  it('lays the month out as a trading week — five columns, Monday first', () => {
    const g = earningsMonth(OCT, 2026, 9, NOW)
    expect(g.label).toBe('October 2026')
    // 1 Oct 2026 is a Thursday, so the first row opens with three blanks.
    expect(g.weeks[0].slice(0, 3)).toEqual([null, null, null])
    expect(g.weeks[0][3].day).toBe(1)
    expect(g.weeks[0][4].day).toBe(2)
  })

  it('groups every print onto its own day and counts them', () => {
    const g = earningsMonth(OCT, 2026, 9, NOW)
    const days = g.weeks.flat().filter((c) => c && c.prints.length)
    expect(days.map((c) => c.day)).toEqual([21, 28, 29])
    expect(days.find((c) => c.day === 28).prints.map((p) => p.symbol)).toEqual(['GOOGL', 'META', 'MSFT'])
    expect(g.count).toBe(6)
  })

  it('marks today only in the month that contains it', () => {
    const aug = earningsMonth([r('NVDA', '2026-08-26T20:00:00Z')], 2026, 7, NOW)
    expect(aug.weeks.flat().find((c) => c?.isToday)?.day).toBe(25)
    expect(earningsMonth(OCT, 2026, 9, NOW).weeks.flat().some((c) => c?.isToday)).toBe(false)
  })

  it('never silently moves a weekend filing onto a weekday', () => {
    // A date nobody reports on is still the date on the filing.
    const g = earningsMonth([r('WEEKEND', '2026-10-24T20:00:00Z')], 2026, 9, NOW)
    expect(g.weekend.map((x) => x.symbol)).toEqual(['WEEKEND'])
    expect(g.weeks.flat().some((c) => c?.prints.length)).toBe(false)
    expect(g.count).toBe(0)
  })

  it('ignores prints from other months', () => {
    expect(earningsMonth(OCT, 2026, 7, NOW).count).toBe(0)
  })
})

describe('month navigation', () => {
  it('opens on the month holding the next print, not on today', () => {
    // Eleven of twelve names report in late October; landing on an empty August
    // would hide the answer behind two clicks.
    const m = firstPrintMonth([{ symbol: 'TSLA', date: '2026-10-21T20:00:00Z' }], Date.parse('2026-08-25T07:00:00Z'))
    expect(m).toEqual({ year: 2026, month: 9 })
  })

  it('falls back to the current month with nothing scheduled', () => {
    expect(firstPrintMonth([], Date.parse('2026-08-25T07:00:00Z'))).toEqual({ year: 2026, month: 7 })
  })

  it('rolls the year in both directions', () => {
    expect(stepMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
    expect(stepMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
  })
})
