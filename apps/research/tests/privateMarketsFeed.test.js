import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { cleanCompanyName, mergeSameRound } = require('../../../packages/server/lib/private-markets-core.js')

// Both cases below are the live feed, measured 2026-08-25. The names are what
// the two lanes actually hand us; the merges are rounds that were shipping twice.

describe('cleanCompanyName', () => {
  it('cuts a headline off the name it wraps', () => {
    expect(cleanCompanyName('GameStop launches 45M share ATM offering,')).toBe('GameStop')
    expect(cleanCompanyName('Acme raises $40M Series B')).toBe('Acme')
  })

  it('drops an investor prefix', () => {
    expect(cleanCompanyName('OpenAI-backed Thrive Holdings')).toBe('Thrive Holdings')
    expect(cleanCompanyName('a16z-led Foundry')).toBe('Foundry')
  })

  it('drops a founder possessive, straight or curly', () => {
    expect(cleanCompanyName('Tarun Chitra’s Gauntlet')).toBe('Gauntlet')
    expect(cleanCompanyName("Tarun Chitra's Gauntlet")).toBe('Gauntlet')
  })

  it('leaves a fragment that contains no company alone', () => {
    // Truncating these would name the WRONG company — "Hinge" did not raise,
    // and "VCs" is not a startup. An awkward label beats a false one.
    expect(cleanCompanyName('VCs Pour Billions Into')).toBe('VCs Pour Billions Into')
    expect(cleanCompanyName('Hinge founder')).toBe('Hinge founder')
    expect(cleanCompanyName('AI Cloud Firm Lambda')).toBe('AI Cloud Firm Lambda')
  })

  it('does not damage an ordinary name', () => {
    for (const n of ['Thrive Holdings', 'Fish Audio', 'Prime Intellect', 'EDX Markets',
      'Yellow Card', 'GameStop Bull', 'ORANGE JUICE', 'The Toad Pepe', 'Mistral AI',
      'How AI', 'Fiat Ventures', 'Glacis Labs', 'Applied Computing', 'xAI', '$TOAD']) {
      expect(cleanCompanyName(n)).toBe(n)
    }
  })

  it('keeps verbs that are part of a real name', () => {
    // `nets` and `lands` are deliberately not truncation triggers.
    expect(cleanCompanyName('Brooklyn Nets')).toBe('Brooklyn Nets')
    expect(cleanCompanyName("Lands' End")).toBe("Lands' End")
  })

  it('never returns empty', () => {
    expect(cleanCompanyName('')).toBe('')
    expect(cleanCompanyName(null)).toBe(null)
  })
})

describe('mergeSameRound', () => {
  const row = (company, amountUsd, date, sourceBadge = 'Spectre', extra = {}) =>
    ({ company, amountUsd, date, sourceBadge, ...extra })

  it('collapses one round spelled two ways', () => {
    const out = mergeSameRound([
      row('GameStop launches 45M share ATM offering', 933000000, '2026-07-27T00:00:00.000Z'),
      row('GameStop', 933000000, '2026-07-27T12:00:00.000Z'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].company).toBe('GameStop')
  })

  it('does NOT collapse two unrelated companies that raised the same amount', () => {
    // The whole reason the key cannot be amount + day alone.
    const out = mergeSameRound([
      row('Acme', 10000000, '2026-08-12T00:00:00.000Z'),
      row('Umbrella', 10000000, '2026-08-12T00:00:00.000Z'),
    ])
    expect(out).toHaveLength(2)
  })

  it('does not collapse the same company on different days', () => {
    const out = mergeSameRound([
      row('Acme', 10000000, '2026-08-12T00:00:00.000Z'),
      row('Acme', 10000000, '2026-08-19T00:00:00.000Z'),
    ])
    expect(out).toHaveLength(2)
  })

  it('keeps the better-sourced row and inherits what only the loser had', () => {
    const out = mergeSameRound([
      row('Thrive Holdings', 2000000000, '2026-08-12T00:00:00.000Z', 'TechCrunch Venture',
        { valuationUsd: 5000000000, leadInvestor: null }),
      row('Thrive', 2000000000, '2026-08-12T00:00:00.000Z', 'Spectre',
        { valuationUsd: null, leadInvestor: 'OpenAI' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sourceBadge).toBe('Spectre')
    expect(out[0].leadInvestor).toBe('OpenAI')
    // the winner's null must not erase a real value the loser carried
    expect(out[0].valuationUsd).toBe(5000000000)
  })

  it('passes rows with no amount or no date straight through', () => {
    const out = mergeSameRound([
      row('Acme', null, '2026-08-12T00:00:00.000Z'),
      row('Acme', 10000000, null),
    ])
    expect(out).toHaveLength(2)
  })
})
