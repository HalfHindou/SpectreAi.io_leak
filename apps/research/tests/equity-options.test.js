import { describe, it, expect } from 'vitest'
import { __test__ } from '../api/_lib/handlers/equity-options.js'

const { parseChain, maxPain, summariseExpiry, gexAt, gammaProfile, impliedEvent, OCC } = __test__

const opt = (sym, oi, vol, extra = {}) => ({
  option: sym, open_interest: oi, volume: vol,
  iv: 0.3, gamma: 0.01, bid: 1, ask: 1.2, ...extra,
})

describe('OCC symbol parsing', () => {
  it('splits root, date, side and strike', () => {
    const m = OCC.exec('NVDA260828C00230000')
    expect(m[1]).toBe('NVDA')
    expect(`20${m[2]}-${m[3]}-${m[4]}`).toBe('2026-08-28')
    expect(m[5]).toBe('C')
    expect(+m[6] / 1000).toBe(230)
  })

  it('reads a fractional strike without losing the cents', () => {
    expect(+OCC.exec('TSLA260828P00342500')[6] / 1000).toBe(342.5)
  })

  it('rejects anything that is not an OCC symbol', () => {
    expect(OCC.exec('BTC-28AUG26-90000-C')).toBe(null)
    expect(OCC.exec('NVDA')).toBe(null)
  })
})

describe('parseChain', () => {
  it('drops contracts with neither open interest nor volume', () => {
    const rows = parseChain({ options: [
      opt('NVDA260828C00230000', 100, 5),
      opt('NVDA260828C00240000', 0, 0),
      opt('NVDA260828P00200000', 0, 42),
    ] })
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.k)).toEqual([230, 200])
  })

  it('keeps the side as a boolean, not a string to re-parse later', () => {
    const [c, p] = parseChain({ options: [
      opt('AAPL260828C00310000', 10, 1), opt('AAPL260828P00310000', 10, 1),
    ] })
    expect(c.call).toBe(true)
    expect(p.call).toBe(false)
  })
})

describe('maxPain', () => {
  it('lands where the most open interest expires worthless', () => {
    // All the open interest is calls at 100. Anything at or below 100 is
    // painless; the search returns the lowest such strike.
    const rows = [
      { call: true, k: 100, oi: 1000 },
      { call: true, k: 110, oi: 10 },
    ]
    expect(maxPain(rows, [90, 100, 110, 120])).toBe(90)
  })

  it('is pulled toward the heavier side', () => {
    //   80 -> puts 900*(110-80)=27,000
    //   90 -> calls 100*0 + puts 900*20 = 18,000
    //  110 -> calls 100*20 = 2,000   <- cheapest
    const rows = [
      { call: true, k: 90, oi: 100 },
      { call: false, k: 110, oi: 900 },
    ]
    expect(maxPain(rows, [80, 90, 110])).toBe(110)
  })

  it('returns the lowest strike when strikes tie', () => {
    // A symmetric book makes every strike cost the same — 10,000 at each of
    // 90 / 100 / 110. Real chains never tie, but the answer must be stable
    // rather than depending on iteration order.
    const rows = [
      { call: true, k: 90, oi: 500 },
      { call: false, k: 110, oi: 500 },
    ]
    expect(maxPain(rows, [90, 100, 110])).toBe(90)
  })
})

describe('summariseExpiry', () => {
  const today = Date.parse('2026-08-24T12:00:00Z')
  const rows = [
    { exp: '2026-08-28', call: true, k: 200, oi: 100, vol: 10, iv: 0.7, bid: 6, ask: 7 },
    { exp: '2026-08-28', call: false, k: 200, oi: 50, vol: 20, iv: 0.7, bid: 5, ask: 6 },
    { exp: '2026-08-28', call: true, k: 230, oi: 900, vol: 5, iv: 0.6, bid: 1, ask: 1.2 },
    { exp: '2026-09-30', call: true, k: 200, oi: 7, vol: 1, iv: 0.4, bid: 9, ask: 10 },
  ]

  it('counts only the expiry it was asked for', () => {
    const s = summariseExpiry(rows, '2026-08-28', 202, today)
    expect(s.callOi).toBe(1000)
    expect(s.putOi).toBe(50)
    expect(s.pcOi).toBe(0.05)
  })

  it('prices the expected move off the ATM straddle', () => {
    const s = summariseExpiry(rows, '2026-08-28', 202, today)
    expect(s.atm).toBe(200)
    // mid(call) 6.5 + mid(put) 5.5 = 12 on a 202 spot
    expect(s.straddle).toBe(12)
    expect(s.expectedMove).toBeCloseTo(12 / 202, 4)
  })

  it('never reports a negative day count for an expiry still trading', () => {
    const s = summariseExpiry(rows, '2026-08-28', 202, Date.parse('2026-08-28T18:00:00Z'))
    expect(s.dte).toBe(0)
  })

  it('reports open interest by strike for the positioning picture', () => {
    const s = summariseExpiry(rows, '2026-08-28', 202, today)
    expect(s.byStrike.map(({ k, c, p }) => ({ k, c, p }))).toEqual([
      { k: 200, c: 100, p: 50 },
      { k: 230, c: 900, p: 0 },
    ])
    expect(s.topOi[0]).toMatchObject({ k: 230, side: 'C', oi: 900 })
  })

  it('carries a finite gamma on every strike, never NaN', () => {
    // A contract missing its greeks used to make this NaN, and NaN then ran
    // through the net, the flip and the wall without anything catching it.
    const s = summariseExpiry(rows, '2026-08-28', 202, today)
    for (const st of s.byStrike) expect(Number.isFinite(st.g)).toBe(true)
    expect(Number.isFinite(s.netGex)).toBe(true)
  })

  it('returns nothing for an expiry with no contracts', () => {
    expect(summariseExpiry(rows, '2027-01-15', 202, today)).toBe(null)
  })
})

/* ── gamma ─────────────────────────────────────────────────────────────── */

describe('gexAt', () => {
  const call = (k, oi, g) => ({ k, oi, gamma: g, call: true })
  const put = (k, oi, g) => ({ k, oi, gamma: g, call: false })

  it('scales gamma by contract size and a 1% move of spot', () => {
    // 0.01 gamma x 100 OI x 100 shares x 200^2 x 0.01 = 40,000
    expect(gexAt([call(200, 100, 0.01)], [], 200, 200)).toBeCloseTo(40000, 0)
  })

  it('nets puts against calls at the same strike', () => {
    const calls = [call(200, 100, 0.01)]
    const puts = [put(200, 100, 0.01)]
    expect(gexAt(calls, puts, 200, 200)).toBe(0)
  })

  it('goes negative when put gamma is the larger side', () => {
    expect(gexAt([call(200, 10, 0.01)], [put(200, 100, 0.01)], 200, 200)).toBeLessThan(0)
  })
})

describe('gammaProfile', () => {
  const row = (k, oi, g, isCall) => ({ k, oi, gamma: g, call: isCall, exp: '2026-08-28', vol: 0, iv: 0.3, bid: 1, ask: 1.2 })

  it('ignores a sign change out in the tail strikes', () => {
    // Both crossings sit far below spot — 20% and 80% away. The naive
    // first-crossing scan reported exactly this shape on NVDA, returning a
    // flip of 120 against a spot of 208.
    const rows = [
      row(40, 100, 0.01, false),   // cumulative goes negative down in the tail
      row(60, 300, 0.01, true),    // and back positive, still in the tail
      row(200, 50, 0.001, true),   // near the money nothing changes sign
    ]
    expect(gammaProfile(rows, 200).flip).toBe(null)
  })

  it('takes the crossing nearest to spot when there are several', () => {
    const rows = [
      row(180, 200, 0.01, false),   // cum negative
      row(195, 400, 0.01, true),    // cum turns positive — 5 from spot
      row(205, 900, 0.01, false),   // cum turns negative — 5 from spot too
      row(210, 100, 0.01, true),
    ]
    const flip = gammaProfile(rows, 200).flip
    expect([195, 205]).toContain(flip)
  })

  it('names the strike carrying the most gamma as the wall', () => {
    const rows = [
      row(190, 10, 0.01, true),
      row(200, 900, 0.01, true),
      row(210, 20, 0.01, true),
    ]
    expect(gammaProfile(rows, 200).wall).toBe(200)
  })

  it('keeps only strikes within a quarter of spot in the profile', () => {
    const rows = [
      row(20, 100, 0.01, true),
      row(200, 100, 0.01, true),
    ]
    expect(gammaProfile(rows, 200).byStrike.map((x) => x.k)).toEqual([200])
  })
})

/* ── the priced date ───────────────────────────────────────────────────── */

describe('impliedEvent', () => {
  const c = (exp, dte, atmIv) => ({ exp, dte, atmIv })

  it('finds the hump in a term structure that decays after it', () => {
    // The NVDA shape, measured 2026-08-24.
    const ev = impliedEvent([
      c('2026-08-24', 0, 0.318), c('2026-08-28', 4, 0.724),
      c('2026-08-31', 7, 0.575), c('2026-09-02', 9, 0.536),
    ])
    expect(ev.exp).toBe('2026-08-28')
    expect(ev.strength).toBe('strong')
    expect(ev.baseline).toBeCloseTo(0.575, 3)
  })

  it('returns nothing for a term structure that only rises', () => {
    expect(impliedEvent([
      c('2026-08-26', 2, 0.20), c('2026-08-28', 4, 0.22),
      c('2026-09-04', 11, 0.25), c('2026-09-11', 18, 0.27),
    ])).toBe(null)
  })

  it('will not call a 0DTE the event', () => {
    // TSLA printed 61.6% on its 0DTE against 44.1% next, a 17-point "lift"
    // that was the clock annualising a few hours, not a dated event.
    expect(impliedEvent([
      c('2026-08-24', 0, 0.616), c('2026-08-26', 2, 0.441),
      c('2026-08-28', 4, 0.43), c('2026-09-04', 11, 0.42),
    ])).toBe(null)
  })

  it('grades a lift that only clears the weekly sawtooth as moderate', () => {
    const ev = impliedEvent([
      c('2026-08-26', 2, 0.60), c('2026-08-28', 4, 0.69),
      c('2026-08-31', 7, 0.62), c('2026-09-04', 11, 0.60),
    ])
    expect(ev.exp).toBe('2026-08-28')
    expect(ev.strength).toBe('moderate')
  })

  it('ignores a peak that clears only one neighbour', () => {
    expect(impliedEvent([
      c('2026-08-26', 2, 0.70), c('2026-08-28', 4, 0.74),
      c('2026-08-31', 7, 0.50), c('2026-09-04', 11, 0.48),
    ])).toBe(null)
  })
})
