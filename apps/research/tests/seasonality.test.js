import { describe, it, expect } from 'vitest'
import { __test__ } from '../api/_lib/handlers/seasonality.js'
import {
  buildMatrix, buildCycleMatrix, cyclePosition, longestStreaks,
  seasonalEdge, percentileOf, quantile, makeScale, priceLabel, skewWarning,
} from '../src/lib/seasonality-math.js'

const { monthsFromDaily, decorate, dailyPoint, calendarEffects, monthProfile, yearProfile, buildSeries } = __test__

const day = (iso, close) => dailyPoint(Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000), close)

/* Build a clean daily series across a month range, one close per day. */
function series(from, to, priceAt) {
  const out = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) {
    out.push(dailyPoint(Math.floor(t / 1000), priceAt(new Date(t))))
  }
  return out
}

describe('monthsFromDaily', () => {
  it('opens each month on the previous month close so the series stays continuous', () => {
    const daily = [
      day('2020-01-01', 90), day('2020-01-30', 100), day('2020-01-31', 110),
      day('2020-02-01', 120), day('2020-02-29', 130),
    ]
    const months = monthsFromDaily(daily)
    expect(months.map((m) => [m.y, m.m, m.o, m.c])).toEqual([
      [2020, 1, 90, 110],
      [2020, 2, 110, 130],
    ])
  })

  it('drops a first month that only has a few days in it', () => {
    // CoinGecko's BTC history starts 2013-04-28. Three days of April must not
    // become an "April" observation in April's average.
    const daily = [
      day('2013-04-28', 135), day('2013-04-30', 135),
      day('2013-05-01', 120), day('2013-05-31', 128),
    ]
    const months = monthsFromDaily(daily)
    expect(months.map((m) => m.m)).toEqual([5])
  })

  it('keeps a first month that genuinely starts at the top of the month', () => {
    const daily = [day('2013-05-02', 120), day('2013-05-31', 128), day('2013-06-30', 95)]
    expect(monthsFromDaily(daily).map((m) => m.m)).toEqual([5, 6])
  })
})

describe('decorate — the venue seam', () => {
  it('prices a month against the PREVIOUS close, not the candle open', () => {
    // BTCUSDT listed on 17 Aug 2017, so Binance's first monthly candle opens at
    // $4,261 while BTC actually entered August at $2,738. Anchoring on the
    // candle's own open reports +11% instead of +73% and loses half a year.
    const raw = [
      { y: 2017, m: 7, o: 2440, h: 2900, l: 2400, c: 2738, src: 'coingecko', hl: 'close' },
      { y: 2017, m: 8, o: 4261, h: 4800, l: 3400, c: 4725, src: 'binance', hl: 'ohlc' },
    ]
    const out = decorate(raw, null)
    expect(out[1].r).toBeCloseTo(4725 / 2738 - 1, 3)
    expect(out[1].r).toBeGreaterThan(0.7)
  })

  it('falls back to the candle open only for the very first month', () => {
    const out = decorate([{ y: 2020, m: 1, o: 100, h: 120, l: 90, c: 110, src: 'binance' }], null)
    expect(out[0].r).toBeCloseTo(0.1, 6)
  })

  it('flags the running month and never gives it to the profile', () => {
    const now = new Date()
    const raw = [
      { y: now.getUTCFullYear() - 1, m: now.getUTCMonth() + 1, o: 100, h: 1, l: 1, c: 150, src: 'binance' },
      { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, o: 150, h: 1, l: 1, c: 300, src: 'binance' },
    ]
    const out = decorate(raw, null)
    expect(out[1].partial).toBe(true)
    const prof = monthProfile(out)[now.getUTCMonth()]
    expect(prof.n).toBe(1) // only the completed year counts
  })
})

describe('calendarEffects', () => {
  it('buckets a return on the day it closed, not the day before', () => {
    // Three days: Mon 2024-01-01, Tue 01-02, Wed 01-03. The move into Tuesday
    // belongs to Tuesday.
    const daily = [day('2024-01-01', 100), day('2024-01-02', 110), day('2024-01-03', 110)]
    const { dow } = calendarEffects(daily)
    expect(dow[2].n).toBe(1)          // Tuesday
    expect(dow[2].avg).toBeCloseTo(0.1, 6)
    expect(dow[1].n).toBe(0)          // Monday has no prior day here
  })

  it('separates the turn-of-month window from the rest', () => {
    const daily = series('2024-01-01', '2024-03-31', (d) => 100 + d.getUTCDate())
    const { tom } = calendarEffects(daily)
    expect(tom.turn.n).toBeGreaterThan(0)
    expect(tom.rest.n).toBeGreaterThan(tom.turn.n)
  })
})

describe('yearProfile', () => {
  it('compounds months and marks a short year partial', () => {
    const months = decorate([
      { y: 2021, m: 12, o: 1, h: 1, l: 1, c: 100, src: 'binance' },
      { y: 2022, m: 1, o: 100, h: 1, l: 1, c: 110, src: 'binance' },
      { y: 2022, m: 2, o: 110, h: 1, l: 1, c: 88, src: 'binance' },
    ], null)
    const years = yearProfile(months)
    const y22 = years.find((y) => y.y === 2022)
    expect(y22.r).toBeCloseTo(88 / 100 - 1, 3)
    expect(y22.partial).toBe(true)
    expect(y22.months).toBe(2)
  })
})

describe('buildSeries', () => {
  it('uses the CoinGecko head only for months before the exchange listing', () => {
    const cg = [{ y: 2017, m: 6, c: 1, src: 'coingecko' }, { y: 2017, m: 8, c: 9, src: 'coingecko' }]
    const bn = [{ y: 2017, m: 8, c: 2, src: 'binance' }, { y: 2017, m: 9, c: 3, src: 'binance' }]
    expect(buildSeries(bn, cg).map((x) => `${x.m}:${x.src}`)).toEqual(['6:coingecko', '8:binance', '9:binance'])
  })

  it('survives either source being absent', () => {
    const bn = [{ y: 2020, m: 1, c: 1, src: 'binance' }]
    expect(buildSeries(bn, null)).toBe(bn)
    expect(buildSeries(null, bn)).toBe(bn)
  })
})

describe('buildMatrix', () => {
  it('lays years newest-first and compounds the year column', () => {
    const months = [
      { y: 2020, m: 1, r: 0.1, partial: false }, { y: 2020, m: 2, r: 0.1, partial: false },
      { y: 2021, m: 1, r: -0.5, partial: false },
    ]
    const rows = buildMatrix(months)
    expect(rows.map((r) => r.y)).toEqual([2021, 2020])
    expect(rows[1].total).toBeCloseTo(1.1 * 1.1 - 1, 6)
    expect(rows[1].cells[2]).toBe(null)
    expect(rows[0].partial).toBe(true)
  })
})

describe('buildCycleMatrix / cyclePosition', () => {
  it('indexes crypto months from the halving that precedes them', () => {
    const months = [
      { y: 2024, m: 4, r: 0.1, partial: false },   // halving month = offset 0
      { y: 2024, m: 5, r: 0.1, partial: false },
      { y: 2020, m: 5, r: 0.2, partial: false },
    ]
    const rows = buildCycleMatrix(months, 'crypto')
    const c2024 = rows.find((r) => r.key === '2024')
    expect(c2024.cells[0].m).toBe(4)
    expect(c2024.cells[1].m).toBe(5)
  })

  it('reports where the current month sits in the running cycle', () => {
    const pos = cyclePosition('crypto', new Date(Date.UTC(2026, 7, 15)))
    expect(pos.key).toBe('2024')
    expect(pos.offset).toBe(28) // Apr 2024 -> Aug 2026
  })

  it('uses the election clock outside crypto', () => {
    const pos = cyclePosition('stocks', new Date(Date.UTC(2026, 5, 1)))
    expect(pos.key).toBe('2024')
    expect(pos.offset).toBe(29)
  })
})

describe('longestStreaks', () => {
  it('finds the longest run in each direction and its compounded return', () => {
    const months = [
      { y: 2020, m: 1, r: 0.1, partial: false },
      { y: 2020, m: 2, r: 0.1, partial: false },
      { y: 2020, m: 3, r: -0.1, partial: false },
      { y: 2020, m: 4, r: 0.05, partial: false },
    ]
    const { best, worst } = longestStreaks(months)
    expect(best.n).toBe(2)
    expect(best.g).toBeCloseTo(1.21, 6)
    expect(worst.n).toBe(1)
  })
})

describe('seasonalEdge', () => {
  const months = Array.from({ length: 24 }, (_, i) => ({
    y: 2020 + Math.floor(i / 12), m: (i % 12) + 1,
    r: (i % 12) === 0 ? 0.5 : -0.05, partial: false,
  }))

  it('scores only the months held and reports exposure', () => {
    const res = seasonalEdge(months, [1])
    expect(res.exposure).toBeCloseTo(2 / 24, 6)
    expect(res.strategy.eq).toBeCloseTo(1.5 * 1.5, 6)
    expect(res.strategy.hit).toBe(1)
    expect(res.strategy.eq).toBeGreaterThan(res.hold.eq)
  })

  it('is identical to buy-and-hold when every month is picked', () => {
    const res = seasonalEdge(months, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(res.strategy.eq).toBeCloseTo(res.hold.eq, 9)
    expect(res.exposure).toBe(1)
  })

  it('refuses to score less than a year of history', () => {
    expect(seasonalEdge(months.slice(0, 6), [1])).toBe(null)
  })
})

describe('formatting and scales', () => {
  it('never mixes a k-suffix into a column of full prices', () => {
    expect(priceLabel(102345)).toBe('$102,345')
    expect(priceLabel(94172)).toBe('$94,172')
    expect(priceLabel(0.0000123)).toMatch(/^\$1\.2e-5$|^\$0\./)
  })

  it('colours by sign and gives light mode its own ink', () => {
    const dark = makeScale([0.1, -0.1, 0.3])
    const light = makeScale([0.1, -0.1, 0.3], true)
    expect(dark(0.3).bg).toContain('16, 185, 129')
    expect(dark(-0.3).bg).toContain('239, 68, 68')
    expect(light(0.3).fg).not.toBe(dark(0.3).fg)
    expect(dark(null).bg).toBe('transparent')
  })

  it('ranks a value inside its own history', () => {
    expect(percentileOf(0.3, [-0.1, 0, 0.1, 0.2])).toBe(1)
    expect(percentileOf(-0.5, [-0.1, 0, 0.1, 0.2])).toBe(0)
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
  })

  it('names the year that is dragging a mean away from its median', () => {
    const p = { n: 13, avg: 0.37, med: 0.09, best: { y: 2013, r: 4.03 }, worst: { y: 2018, r: -0.37 } }
    expect(skewWarning(p).year).toBe(2013)
    expect(skewWarning({ n: 13, avg: 0.1, med: 0.09, best: null, worst: null })).toBe(null)
  })
})
