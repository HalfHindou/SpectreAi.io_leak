import { describe, it, expect } from 'vitest'
import { computeStockPerf, exchangeLabel, sessionChip, rangePos, daysUntil, todayBar, recommendationLabel, fmtCount } from '@/pages/screener-lite/components/sl-stock-facts'

// Synthetic ascending daily tape: one bar per weekday-ish step (86400s), close
// climbs 1/day so window math is easy to read.
function tape(n, startSec, startClose = 100) {
  return Array.from({ length: n }, (_, i) => ({ t: startSec + i * 86400, o: startClose + i, h: startClose + i + 1, l: startClose + i - 1, c: startClose + i, v: 1000 }))
}

describe('computeStockPerf', () => {
  it('returns nulls on a tape too short for any window', () => {
    expect(computeStockPerf([])).toEqual({ w1: null, m1: null, m3: null, ytd: null, y1: null })
    expect(computeStockPerf([{ c: 10 }]).w1).toBeNull()
  })

  it('measures 1W/1M/3M from the close N sessions back', () => {
    const bars = tape(100, Date.UTC(2026, 0, 1) / 1000, 100) // closes 100..199
    const p = computeStockPerf(bars, Date.UTC(2026, 5, 1))
    // last close 199; 5 back = 194; 21 back = 178; 63 back = 136
    expect(p.w1).toBeCloseTo(((199 - 194) / 194) * 100, 6)
    expect(p.m1).toBeCloseTo(((199 - 178) / 178) * 100, 6)
    expect(p.m3).toBeCloseTo(((199 - 136) / 136) * 100, 6)
    // 100 bars is not a year - 1Y stays null instead of lying with the first bar
    expect(p.y1).toBeNull()
  })

  it('anchors YTD to the last close of the previous calendar year', () => {
    // 10 bars in late Dec 2025, then 20 in Jan 2026
    const dec = tape(10, Date.UTC(2025, 11, 20) / 1000, 50) // last Dec close = 59
    const jan = tape(20, Date.UTC(2026, 0, 2) / 1000, 60) // last close = 79
    const p = computeStockPerf([...dec, ...jan], Date.UTC(2026, 0, 25))
    expect(p.ytd).toBeCloseTo(((79 - 59) / 59) * 100, 6)
  })

  it('gives 1Y from the first bar once the tape spans a year of sessions', () => {
    const bars = tape(250, Date.UTC(2025, 8, 1) / 1000, 100) // 100..349
    const p = computeStockPerf(bars, Date.UTC(2026, 8, 1))
    expect(p.y1).toBeCloseTo(((349 - 100) / 100) * 100, 6)
  })

  it('skips bars without a close', () => {
    const bars = [{ c: 0 }, { c: 100, t: 1 }, { c: 0 }, { c: 110, t: 2 }]
    expect(computeStockPerf(bars).w1).toBeNull() // only 2 real bars, no 5-session window
  })
})

describe('labels', () => {
  it('maps Yahoo venue codes to brand names and passes unknowns through', () => {
    expect(exchangeLabel('NYQ')).toBe('NYSE')
    expect(exchangeLabel('nms')).toBe('NASDAQ')
    expect(exchangeLabel('Tokyo')).toBe('Tokyo')
    expect(exchangeLabel('')).toBe('')
  })

  it('turns market status into a chip', () => {
    expect(sessionChip({ status: 'REGULAR', closesAt: '4:00 PM ET' })).toEqual({ label: 'Market open', tone: 'open', detail: 'Closes 4:00 PM ET' })
    expect(sessionChip({ status: 'POST', nextOpen: 'x' }).tone).toBe('ext')
    expect(sessionChip({ status: 'CLOSED' }).label).toBe('Market closed')
    expect(sessionChip(null).tone).toBe('closed')
  })

  it('recommendation keys read as words', () => {
    expect(recommendationLabel('strong_buy')).toBe('Strong buy')
    expect(recommendationLabel('hold')).toBe('Hold')
    expect(recommendationLabel('')).toBe('')
  })
})

describe('fmtCount', () => {
  it('scales through B and T', () => {
    expect(fmtCount(14594200000)).toBe('14.59B')
    expect(fmtCount(23400000)).toBe('23.4M')
    expect(fmtCount(387800)).toBe('387.8K')
    expect(fmtCount(42)).toBe('42')
  })
})

describe('range + dates', () => {
  it('positions price inside a range and rejects degenerate ranges', () => {
    expect(rangePos(75, 50, 100)).toBe(50)
    expect(rangePos(120, 50, 100)).toBe(100)
    expect(rangePos(75, 100, 50)).toBeNull()
    expect(rangePos(0, 50, 100)).toBeNull()
  })

  it('counts calendar days until an ISO date', () => {
    const now = Date.UTC(2026, 8, 4)
    expect(daysUntil('2026-11-07T20:00:00.000Z', now)).toBe(64)
    expect(daysUntil('garbage', now)).toBeNull()
  })

  it('reads today from the last daily bar', () => {
    expect(todayBar([{ o: 1, h: 2, l: 0.5, c: 1.5, v: 9 }])).toEqual({ open: 1, high: 2, low: 0.5, close: 1.5, volume: 9 })
    expect(todayBar([])).toBeNull()
  })
})
