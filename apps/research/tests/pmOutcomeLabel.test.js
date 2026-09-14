import { describe, it, expect } from 'vitest'
import { outcomeName, outcomeLabel, leadOutcome, isPlaceholderName } from '../src/pages/predictions/components/pm-outcome-label'

const lyman = {
  title: 'Will Russia capture Lyman by...?',
  outcomes: [
    { id: 'a', label: 'Will Russia capture Lyman by September 30, 2026?', yesPct: 2 },
    { id: 'b', label: 'Will Russia capture Lyman by December 31, 2026?', yesPct: 18 },
  ],
}

describe('outcomeName', () => {
  it('keeps the candidate for "Will X win" markets', () => {
    expect(outcomeName('Will JD Vance win the 2028 US Presidential Election?')).toBe('JD Vance')
  })

  it('keeps only the differentiating tail on date ladders', () => {
    expect(outcomeLabel(lyman.outcomes[0], lyman)).toBe('September 30, 2026')
    expect(outcomeLabel(lyman.outcomes[1], lyman)).toBe('December 31, 2026')
  })

  it('never swallows a whole label when one sibling is a prefix of another', () => {
    const ev = { title: 'X', outcomes: [{ label: 'Will BTC hit 100k?' }, { label: 'Will BTC hit 100k in March?' }] }
    expect(outcomeLabel(ev.outcomes[0], ev)).toBe('100k')
    expect(outcomeLabel(ev.outcomes[1], ev)).toBe('100k in March')
  })

  it('falls back to stripping the title and the "Will" prefix', () => {
    expect(outcomeName('Will any country leave NATO by 2027?', { siblings: ['Will any country leave NATO by 2027?'] })).toBe('any country leave NATO by 2027')
    expect(outcomeName('', {})).toBe('')
  })
})

describe('leadOutcome', () => {
  it('picks the highest Yes outcome, not the first one', () => {
    expect(leadOutcome(lyman).id).toBe('b')
  })

  it('skips placeholder outcomes and returns the only outcome of a binary market', () => {
    const ev = {
      title: 'Nominee',
      outcomes: [
        { id: 'p', label: 'Will Person P win the nomination?', yesPct: 50 },
        { id: 'h', label: 'Will Hassett win the nomination?', yesPct: 31 },
      ],
    }
    expect(leadOutcome(ev).id).toBe('h')
    expect(isPlaceholderName('Person P')).toBe(true)
    expect(leadOutcome({ outcomes: [{ id: 'only', yesPct: 6 }] }).id).toBe('only')
    expect(leadOutcome({ outcomes: [] })).toBeNull()
  })
})
