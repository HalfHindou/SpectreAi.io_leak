import { describe, it, expect } from 'vitest'
import { __test__ } from '../api/_lib/handlers/crossasset.js'
import { deriveRead, deriveState, corrFill, fmtCorr, fmtLevel, DRIFT_FLOOR } from '../src/lib/crossasset-read.js'

const { pearson } = __test__

describe('pearson', () => {
  it('is 1 for a series against itself and -1 against its negation', () => {
    const a = [0.01, -0.02, 0.03, 0.005, -0.01]
    expect(pearson(a, a)).toBeCloseTo(1, 10)
    expect(pearson(a, a.map((x) => -x))).toBeCloseTo(-1, 10)
  })

  it('matches a hand-computed value', () => {
    //   x = [1,2,3,4,5]  mean 3   dx = [-2,-1, 0, 1, 2]   Σdx² = 10
    //   y = [2,4,5,4,5]  mean 4   dy = [-2, 0, 1, 0, 1]   Σdy² =  6
    //   Σdxdy = 4 + 0 + 0 + 0 + 2 = 6      r = 6 / √60 = 0.774596…
    const x = [1, 2, 3, 4, 5]
    const y = [2, 4, 5, 4, 5]
    expect(pearson(x, y)).toBeCloseTo(6 / Math.sqrt(60), 10)
  })

  it('refuses a flat series rather than dividing by zero', () => {
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBe(null)
  })

  it('refuses samples too small to mean anything', () => {
    expect(pearson([1, 2], [2, 4])).toBe(null)
    expect(pearson([1, 2, 3], [1, 2])).toBe(null)
  })
})

describe('board definitions', () => {
  it('covers every asset class on both boards', () => {
    for (const board of [__test__.CRYPTO_BOARD, __test__.STOCK_BOARD]) {
      const groups = new Set(board.map((b) => b.group))
      expect([...groups].sort()).toEqual(['commodities', 'crypto', 'equities', 'rates'])
      // Every yahoo row needs a ticker; every binance row must not carry one.
      for (const row of board) {
        if (row.kind === 'yahoo') expect(typeof row.ticker).toBe('string')
        else expect(row.ticker).toBeUndefined()
      }
    }
  })

  it('anchors the crypto board on BTC and the stocks board on SPX', () => {
    expect(__test__.CRYPTO_BOARD[0].sym).toBe('BTC')
    expect(__test__.STOCK_BOARD[0].sym).toBe('SPX')
  })
})

describe('deriveRead', () => {
  const pair = (b, w30, w250) => ({ a: 'BTC', b, w30, w250, drift: +(w30 - w250).toFixed(2) })

  it('says nothing when no pair has left its norm', () => {
    const r = deriveRead({ anchor: 'BTC', drift: [pair('SPX', 0.45, 0.47), pair('GOLD', 0.2, 0.21)] })
    expect(r.quiet).toBe(true)
    expect(r.headline).toMatch(/close to its usual/)
  })

  it('names the debasement trade when gold tightens and equities let go', () => {
    const r = deriveRead({
      anchor: 'BTC',
      drift: [pair('GOLD', 0.61, 0.21), pair('SPX', 0.16, 0.47), pair('DXY', -0.37, -0.17)],
    })
    expect(r.quiet).toBe(false)
    expect(r.headline).toBe('BTC is trading like a debasement hedge.')
    // The counter-clause is what makes it a rotation rather than one number moving.
    expect(r.detail).toContain('SPX')
    expect(r.detail).toContain('+0.47')
    expect(r.detail).toContain('+0.16')
  })

  it('reads an inverse pair by the direction of the inverse, not the sign', () => {
    const r = deriveRead({ anchor: 'BTC', drift: [pair('DXY', -0.40, -0.10)] })
    expect(r.headline).toMatch(/more dollar-sensitive/)
  })

  it('falls back to neutral wording for a pair with no named meaning', () => {
    const r = deriveRead({ anchor: 'BTC', drift: [pair('OIL', 0.35, 0.05)] })
    expect(r.headline).toBe("BTC's link to OIL has tightened sharply.")
  })

  it('only ever cites pairs above the floor', () => {
    const r = deriveRead({
      anchor: 'BTC',
      drift: [pair('GOLD', 0.61, 0.21), pair('OIL', 0.06, 0.05)],
    })
    expect(r.inputs.every((d) => Math.abs(d.drift) >= DRIFT_FLOOR)).toBe(true)
  })

  it('survives an empty payload', () => {
    expect(deriveRead(null)).toBe(null)
    expect(deriveRead({ anchor: 'BTC', drift: [] })).toBe(null)
  })
})

describe('formatting', () => {
  it('signs correlations with a real minus sign', () => {
    expect(fmtCorr(-0.37)).toBe('−0.37')
    expect(fmtCorr(0.61)).toBe('0.61')
    expect(fmtCorr(null)).toBe('—')
  })

  it('renders a yield as a percent and an index as a level', () => {
    expect(fmtLevel(4.74, 'pct')).toBe('4.74%')
    expect(fmtLevel(7674.37, 'price')).toBe('7,674')
    expect(fmtLevel(94.891, 'price')).toBe('94.89')
  })

  it('colours by sign and gives light mode its own ink', () => {
    expect(corrFill(0.8).bg).toContain('16, 185, 129')
    expect(corrFill(-0.8).bg).toContain('239, 68, 68')
    expect(corrFill(0.8, true).fg).not.toBe(corrFill(0.8, false).fg)
    expect(corrFill(null).bg).toBe('transparent')
  })
})

describe('deriveState', () => {
  const mk = (over = {}) => ({
    anchor: 'BTC',
    assets: [
      { sym: 'BTC', d30: 0.20 },
      { sym: 'SPX', d30: 0.03 },
      { sym: 'NDX', d30: 0.04 },
      { sym: 'VIX', d30: -0.10 },
      { sym: 'DXY', d30: -0.01 },
      { sym: 'US10Y', d30: -0.02 },
      ...(over.extra || []),
    ].map((a) => ({ ...a, ...(over.patch?.[a.sym] || {}) })),
  })

  it('reads a loosening backdrop as risk-on', () => {
    const s = deriveState(mk())
    expect(s.score).toBeGreaterThan(0)
    expect(s.label).toMatch(/risk-on/i)
  })

  it('flips when the dollar, yields and volatility all rise', () => {
    const s = deriveState(mk({ patch: {
      SPX: { d30: -0.06 }, NDX: { d30: -0.08 }, VIX: { d30: 0.40 },
      DXY: { d30: 0.05 }, US10Y: { d30: 0.20 },
    } }))
    expect(s.score).toBeLessThan(-0.4)
    expect(s.label).toBe('Risk-off')
  })

  it('labels each input by which way it pushes, not by its sign', () => {
    const s = deriveState(mk({ patch: { VIX: { d30: 0.40 }, DXY: { d30: 0.05 } } }))
    const vix = s.inputs.find((i) => i.sym === 'VIX')
    const dxy = s.inputs.find((i) => i.sym === 'DXY')
    // Both ROSE, and a rise in either tightens conditions.
    expect(vix.move).toBeGreaterThan(0)
    expect(vix.toward).toBe('off')
    expect(dxy.toward).toBe('off')
  })

  it('keeps the anchor out of the composite so its response stays visible', () => {
    const s = deriveState(mk())
    expect(s.inputs.some((i) => i.sym === 'BTC')).toBe(false)
    expect(s.anchor.sym).toBe('BTC')
    expect(s.anchor.d30).toBe(0.20)
  })

  it('drops the anchor from the inputs on the stocks board too', () => {
    const s = deriveState({ ...mk(), anchor: 'SPX' })
    expect(s.inputs.some((i) => i.sym === 'SPX')).toBe(false)
    expect(s.anchor.sym).toBe('SPX')
  })

  it('refuses to state a view it cannot support', () => {
    expect(deriveState({ anchor: 'BTC', assets: [{ sym: 'BTC', d30: 0.1 }, { sym: 'VIX', d30: 0.1 }] })).toBe(null)
    expect(deriveState(null)).toBe(null)
  })

  it('never runs away past the ends of the scale', () => {
    const s = deriveState(mk({ patch: { VIX: { d30: 40 }, DXY: { d30: 9 }, US10Y: { d30: 9 }, SPX: { d30: -9 }, NDX: { d30: -9 } } }))
    expect(s.score).toBeGreaterThanOrEqual(-1)
    expect(s.score).toBeLessThanOrEqual(1)
  })
})
