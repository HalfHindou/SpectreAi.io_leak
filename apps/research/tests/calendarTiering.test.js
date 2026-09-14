/**
 * Economic calendar — impact tiering and category coverage.
 *
 * Guards the two failures the calendar shipped with on 2026-08-24:
 *
 * 1. CATEGORY COVERAGE. `categorizeEvent()` emitted values ('Other', 'Energy')
 *    that the client's filter set never listed, and `applyFilters` drops any
 *    event whose category isn't in the set — so those events vanished with no
 *    pill to switch them back on. In the week of Aug 24 that deleted 30 of 77
 *    events, including all three days of the Jackson Hole Symposium and the
 *    Fed Chair's keynote. The reverse hole existed too: the filter offered a
 *    'Speeches' pill nothing ever matched.
 *
 * 2. TIERING. Impact was read straight off TradingView's `importance`, which
 *    ranks for a global macro desk, not for crypto: German GfK Consumer
 *    Confidence outranked US Initial Jobless Claims, and Jackson Hole scored
 *    the same as a bill auction.
 */

import { describe, it, expect } from 'vitest'
import {
  categorizeEvent,
  tvImpact,
  EVENT_CATEGORIES,
} from '../api/_lib/handlers/calendar-api.js'
import { isReleased, resultTone } from '../src/pages/economic-calendar/utils/eventResult.js'
import { ALL_CATEGORIES } from '../src/pages/economic-calendar/hooks/useFilters.js'

// Real TradingView rows from the week of 2026-08-24 (title / country /
// importance), plus the marquee releases from other weeks.
const CORPUS = [
  { title: 'Core PCE Price Index MoM', country: 'US', importance: 1 },
  { title: 'PCE Price Index YoY', country: 'US', importance: 0 },
  { title: 'Core PCE Price Index YoY', country: 'US', importance: -1 },
  { title: 'GDP Growth Rate QoQ 2nd Est', country: 'US', importance: 1 },
  { title: 'Non Farm Payrolls', country: 'US', importance: 1 },
  { title: 'Non Farm Payrolls Annual Revision Prel', country: 'US', importance: 1 },
  { title: 'Fed Interest Rate Decision', country: 'US', importance: 1 },
  { title: 'FOMC Minutes', country: 'US', importance: 1 },
  { title: 'Fed Chair Warsh Speech', country: 'US', importance: 1 },
  { title: 'Jackson Hole Symposium', country: 'US', importance: 0 },
  { title: 'Initial Jobless Claims', country: 'US', importance: 0 },
  { title: 'CB Consumer Confidence', country: 'US', importance: 0 },
  { title: 'Michigan Consumer Sentiment Final', country: 'US', importance: 0 },
  { title: 'Chicago PMI', country: 'US', importance: 0 },
  { title: 'Durable Goods Orders MoM', country: 'US', importance: 1 },
  { title: 'Personal Income MoM', country: 'US', importance: 1 },
  { title: 'Retail Inventories Ex Autos MoM Adv', country: 'US', importance: 0 },
  { title: 'Wholesale Inventories MoM Adv', country: 'US', importance: 0 },
  { title: 'Goods Trade Balance Adv', country: 'US', importance: 0 },
  { title: 'Treasury Secretary Bessent Speech', country: 'US', importance: 0 },
  { title: 'Fed Barkin Speech', country: 'US', importance: 0 },
  { title: 'Chicago Fed National Activity Index', country: 'US', importance: 0 },
  { title: 'EIA Crude Oil Stocks Change', country: 'US', importance: 0 },
  { title: '3-Month Bill Auction', country: 'US', importance: -1 },
  { title: 'GfK Consumer Confidence', country: 'DE', importance: 1 },
  { title: 'Ifo Business Climate', country: 'DE', importance: 1 },
  { title: 'ECB Monetary Policy Meeting Accounts', country: 'EU', importance: 0 },
  { title: 'RBA Meeting Minutes', country: 'AU', importance: 1 },
  { title: 'RBA Bulletin', country: 'AU', importance: 0 },
  { title: 'BoJ Himino Speech', country: 'JP', importance: 0 },
  { title: 'Interest Rate Decision', country: 'KR', importance: 0 },
  { title: 'Inflation Rate YoY Prel', country: 'FR', importance: 1 },
  { title: 'GDP Growth Rate QoQ', country: 'CA', importance: 1 },
  { title: 'Consumer Confidence', country: 'JP', importance: 1 },
  { title: 'KOF Leading Indicators', country: 'CH', importance: 0 },
  { title: "National People's Congress", country: 'CN', importance: 0 },
]

const impactOf = (title) => tvImpact(CORPUS.find((e) => e.title === title))
const RANK = { critical: 0, high: 1, medium: 2, low: 3 }

describe('calendar category coverage', () => {
  it('the API and the client filter agree on the category set', () => {
    expect([...EVENT_CATEGORIES].sort()).toEqual([...ALL_CATEGORIES].sort())
  })

  it('never emits a category the filter cannot list', () => {
    const emitted = new Set(CORPUS.map((e) => categorizeEvent(e.title)))
    const orphans = [...emitted].filter((c) => !ALL_CATEGORIES.includes(c))
    expect(orphans).toEqual([])
  })

  it('classifies central-bank speech events as Speeches, not Other', () => {
    // The 'Speeches' pill shipped matching nothing; these all fell to 'Other',
    // which the filter dropped.
    expect(categorizeEvent('Jackson Hole Symposium')).toBe('Speeches')
    expect(categorizeEvent('Fed Chair Warsh Speech')).toBe('Speeches')
    expect(categorizeEvent('Treasury Secretary Bessent Speech')).toBe('Speeches')
    expect(categorizeEvent('BoJ Himino Speech')).toBe('Speeches')
  })

  it('keeps policy publications under Interest Rate', () => {
    // Turning off 'Speeches' must not hide the rate path itself.
    expect(categorizeEvent('FOMC Minutes')).toBe('Interest Rate')
    expect(categorizeEvent('ECB Monetary Policy Meeting Accounts')).toBe('Interest Rate')
    expect(categorizeEvent('RBA Meeting Minutes')).toBe('Interest Rate')
    expect(categorizeEvent('Fed Interest Rate Decision')).toBe('Interest Rate')
  })
})

describe('calendar impact tiering', () => {
  it('puts the Fed talking in the critical tier whatever TradingView scores it', () => {
    expect(impactOf('Jackson Hole Symposium')).toBe('critical')
    expect(impactOf('Fed Chair Warsh Speech')).toBe('critical')
  })

  it('keeps the US Fed-path prints critical', () => {
    for (const t of [
      'Core PCE Price Index MoM',
      'GDP Growth Rate QoQ 2nd Est',
      'Non Farm Payrolls',
      'Fed Interest Rate Decision',
      'FOMC Minutes',
    ]) {
      expect(impactOf(t), t).toBe('critical')
    }
  })

  it('does not promote the sub-indices that ship with a headline print', () => {
    // Seven red rows on one morning is the same as none.
    expect(impactOf('PCE Price Index YoY')).toBe('high')
    expect(impactOf('Core PCE Price Index YoY')).toBe('low')
  })

  it('ranks US jobless claims above a German confidence survey', () => {
    // The regression the founder caught: GfK (TV importance 1) rendered HIGH
    // while Initial Jobless Claims (importance 0) rendered MEDIUM.
    const claims = impactOf('Initial Jobless Claims')
    const gfk = impactOf('GfK Consumer Confidence')
    expect(claims).toBe('high')
    expect(gfk).toBe('medium')
    expect(RANK[claims]).toBeLessThan(RANK[gfk])
  })

  it('caps non-US soft surveys at medium', () => {
    for (const t of ['Ifo Business Climate', 'Consumer Confidence', 'KOF Leading Indicators']) {
      expect(impactOf(t), t).toBe('medium')
    }
  })

  it('keeps non-US policy events high and non-US macro out of the critical tier', () => {
    expect(impactOf('ECB Monetary Policy Meeting Accounts')).toBe('high')
    expect(impactOf('RBA Meeting Minutes')).toBe('high')
    expect(impactOf('Inflation Rate YoY Prel')).toBe('high')
    expect(impactOf('GDP Growth Rate QoQ')).toBe('high')
    for (const e of CORPUS.filter((x) => x.country !== 'US')) {
      expect(tvImpact(e), e.title).not.toBe('critical')
    }
  })

  it('leaves auctions and sub-indices in the low tier', () => {
    expect(impactOf('3-Month Bill Auction')).toBe('low')
  })
})

describe('has this actually printed', () => {
  it('treats a placeholder zero with nothing to compare it to as no data', () => {
    // A scheduled event (symposium, speech, meeting accounts) arrives with a
    // zero and no forecast/previous. Reading that as a print put "ACT 0" and a
    // RELEASED chip on a Jackson Hole three days in the future.
    expect(isReleased({ actual: 0, forecast: null, previous: null })).toBe(false)
    expect(isReleased({ actual: '0', forecast: null, previous: null })).toBe(false)
  })

  it('still counts a genuine zero print', () => {
    // PPI MoM 0% is a real number — it has a consensus beside it.
    expect(isReleased({ actual: 0, forecast: 0.1, previous: 0.2 })).toBe(true)
    expect(resultTone({ actual: 0, forecast: 0.1, previous: 0.2 })).toBe('miss')
  })

  it('counts any non-zero actual', () => {
    expect(isReleased({ actual: 206, forecast: null, previous: null })).toBe(true)
    expect(isReleased({ actual: '-23K', forecast: null, previous: null })).toBe(true)
  })

  it('is false with no actual at all', () => {
    expect(isReleased({ actual: null, forecast: 0.2, previous: 0.1 })).toBe(false)
    expect(isReleased({ actual: '', forecast: 0.2 })).toBe(false)
    expect(isReleased(null)).toBe(false)
  })
})
