/**
 * Stock 4h/12h bars - session-aligned aggregation.
 *
 * Yahoo has no native 4h interval for equities, so `getStockSeriesBars('240')`
 * fetches hourly bars and buckets them client-side. Until 2026-09-04 the
 * buckets were UTC-aligned (floor(t / 14400)), which for a 09:30-16:00 ET
 * session produced two bars per day stamped 08:00 ET and 12:00 ET. The
 * TradingView symbolInfo for stocks declares session '0930-1600', and the
 * charting library snaps a bar outside the session grid to the nearest slot -
 * both buckets collapsed into the single 09:30 slot, so the 4h pane held one
 * candle per trading day (measured: 259 bars supplied, 132 kept on TSLA) with
 * an empty slot between every candle and today's bar missing until after
 * 12:00 ET. The founder read it as "the stock API is bad" - the data was
 * clean, the bucket grid was wrong.
 *
 * Equities aggregate from session open, the way TradingView's own 4h bars do:
 * 09:30-13:30 and 13:30-16:00 ET. Both DST regimes are covered below because
 * the grid is derived in America/New_York, not by a fixed UTC offset.
 */
import { describe, it, expect } from 'vitest'
import { aggregateStockBars } from '@/services/stockApi'

// Hourly bars the way Yahoo stamps a regular session: 09:30, 10:30, ... 15:30
// local, plus the odd partial-bar stamp Yahoo emits for the live hour.
function sessionDay(isoDate, utcOpenHour) {
  const base = Date.parse(`${isoDate}T00:00:00Z`) / 1000
  const open = base + utcOpenHour * 3600 + 30 * 60
  return Array.from({ length: 7 }, (_, i) => ({
    t: open + i * 3600, o: 100 + i, h: 110 + i, l: 90 + i, c: 101 + i, v: 10,
  }))
}

describe('aggregateStockBars - 4h buckets on the equity session grid', () => {
  it('EDT: 7 hourly bars fold into 09:30 and 13:30 ET buckets, never 08:00/12:00', () => {
    // 2026-09-03 is EDT (UTC-4): 09:30 ET = 13:30 UTC.
    const bars = sessionDay('2026-09-03', 13)
    const out = aggregateStockBars(bars, 4 * 3600)
    expect(out).toHaveLength(2)
    expect(new Date(out[0].t * 1000).toISOString()).toBe('2026-09-03T13:30:00.000Z')
    expect(new Date(out[1].t * 1000).toISOString()).toBe('2026-09-03T17:30:00.000Z')
    // First bucket = 09:30..12:30 (4 bars), second = 13:30..15:30 (3 bars).
    expect(out[0]).toMatchObject({ o: 100, h: 113, l: 90, c: 104, v: 40 })
    expect(out[1]).toMatchObject({ o: 104, h: 116, l: 94, c: 107, v: 30 })
  })

  it('EST: the grid still starts at 09:30 local when the UTC offset is -5', () => {
    // 2026-01-15 is EST (UTC-5): 09:30 ET = 14:30 UTC.
    const out = aggregateStockBars(sessionDay('2026-01-15', 14), 4 * 3600)
    expect(out.map((b) => new Date(b.t * 1000).toISOString())).toEqual([
      '2026-01-15T14:30:00.000Z',
      '2026-01-15T18:30:00.000Z',
    ])
  })

  it('a live partial bar with a seconds-level stamp lands in its session bucket at :30 exactly', () => {
    const bars = sessionDay('2026-09-04', 13).slice(0, 3)
    // Yahoo's live hour: 2026-09-04T15:59:14Z (11:59 ET).
    bars.push({ t: Date.parse('2026-09-04T15:59:14Z') / 1000, o: 103, h: 104, l: 102, c: 103.5, v: 5 })
    const out = aggregateStockBars(bars, 4 * 3600)
    expect(out).toHaveLength(1)
    expect(new Date(out[0].t * 1000).toISOString()).toBe('2026-09-04T13:30:00.000Z')
    expect(out[0].c).toBe(103.5)
  })

  it('12h buckets give one bar per session day, stamped at the open', () => {
    const out = aggregateStockBars([...sessionDay('2026-09-02', 13), ...sessionDay('2026-09-03', 13)], 12 * 3600)
    expect(out.map((b) => new Date(b.t * 1000).toISOString())).toEqual([
      '2026-09-02T13:30:00.000Z',
      '2026-09-03T13:30:00.000Z',
    ])
  })

  it('passes through untouched without a bucket', () => {
    const bars = sessionDay('2026-09-03', 13)
    expect(aggregateStockBars(bars, 0)).toBe(bars)
  })
})
