import { describe, it, expect } from 'vitest'
import { __test__ } from '../api/_lib/handlers/token-flow.js'

const { mergeByToken, applyConfirmations, poolRow, score, QUOTE_ASSETS } = __test__

const pool = (o = {}) => poolRow({
  chain: 'solana', contract: '0xAbC', symbol: 'GROK', name: 'GrokBot',
  volume: 1_000_000, buys: 700, sells: 300, buyers: 500, sellers: 200,
  priceChange: 4.2, liquidity: 250_000, mcap: 9_000_000, source: 'GeckoTerminal', ...o,
})

describe('poolRow', () => {
  it('lowercases the contract so the two providers key alike', () => {
    expect(pool().contract).toBe('0xabc')
  })

  it('refuses a row with nothing to identify it', () => {
    expect(pool({ contract: null })).toBe(null)
    expect(pool({ symbol: null })).toBe(null)
  })
})

describe('mergeByToken', () => {
  it('sums a token across its own pools, because that is one token', () => {
    const m = mergeByToken([
      pool({ volume: 1_000_000, buys: 700, sells: 300, buyers: 500, sellers: 200, liquidity: 250_000 }),
      pool({ volume: 500_000, buys: 100, sells: 100, buyers: 80, sellers: 90, liquidity: 100_000 }),
    ])
    expect(m).toHaveLength(1)
    expect(m[0].volume24h).toBe(1_500_000)
    expect(m[0].pools).toBe(2)
    expect(m[0].liquidityUsd).toBe(350_000)
  })

  it('reads pressure off trade counts and skew off distinct wallets', () => {
    const [r] = mergeByToken([pool({ buys: 700, sells: 300, buyers: 500, sellers: 200 })])
    expect(r.pressure).toBeCloseTo(0.4, 4)      // (700-300)/1000
    expect(r.walletSkew).toBeCloseTo(0.4286, 3) // (500-200)/700
    expect(r.netBuyers).toBe(300)
  })

  it('leaves wallet skew null when no provider published wallet counts', () => {
    // DexScreener carries trade counts only. Filling buyers from buys would be
    // a different measurement wearing the same name.
    const [r] = mergeByToken([pool({ buyers: 0, sellers: 0, source: 'DexScreener' })])
    expect(r.walletSkew).toBe(null)
    expect(r.netBuyers).toBe(null)
    expect(r.pressure).not.toBe(null)
  })

  it('takes price change from the deepest pool rather than averaging rates', () => {
    const [r] = mergeByToken([
      pool({ priceChange: 50, liquidity: 1_000 }),
      pool({ priceChange: -2, liquidity: 900_000 }),
    ])
    expect(r.priceChange24h).toBe(-2)
  })
})

describe('applyConfirmations', () => {
  const primary = mergeByToken([pool({ volume: 5_269_000, mcap: null })])

  it('does NOT add the second provider to the first', () => {
    // Both providers describe the SAME pools. Summing them read GrokBot at
    // $10.6M against a true $5.3M.
    const confirm = mergeByToken([pool({ volume: 5_319_000, source: 'DexScreener', buyers: 0, sellers: 0 })])
    const [r] = applyConfirmations(primary, confirm)
    expect(r.volume24h).toBe(5_269_000)
    expect(r.volume24hAlt).toBe(5_319_000)
    expect(r.confirmed).toBe(true)
    expect(r.sources).toEqual(expect.arrayContaining(['GeckoTerminal', 'DexScreener']))
  })

  it('fills a market cap the primary did not have', () => {
    const confirm = mergeByToken([pool({ mcap: 9_500_000, source: 'DexScreener' })])
    expect(applyConfirmations(primary, confirm)[0].mcap).toBe(9_500_000)
  })

  it('leaves a token the other provider never saw untouched', () => {
    const [r] = applyConfirmations(primary, mergeByToken([pool({ contract: '0xOther' })]))
    expect(r.confirmed).toBe(false)
    expect(r.volume24hAlt).toBeUndefined()
  })
})

describe('score', () => {
  it('ranks conviction against size, so a lopsided dust pool loses', () => {
    const dust = { walletSkew: 1, volume24h: 20_000 }
    const real = { walletSkew: 0.3, volume24h: 20_000_000 }
    expect(score(real)).toBeGreaterThan(score(dust))
  })

  it('prefers wallet skew to trade pressure when both exist', () => {
    const a = { walletSkew: 0.5, pressure: 0.01, volume24h: 1_000_000 }
    const b = { walletSkew: 0.1, pressure: 0.99, volume24h: 1_000_000 }
    expect(score(a)).toBeGreaterThan(score(b))
  })
})

describe('quote assets', () => {
  it('excludes the assets every pool is priced against', () => {
    // USDC ranked second on a first run with a pressure of 0.03 — it is the
    // denominator of this board, not a position on it.
    for (const q of ['USDC', 'USDT', 'WETH', 'SOL', 'WBNB']) expect(QUOTE_ASSETS.has(q)).toBe(true)
    expect(QUOTE_ASSETS.has('PENGU')).toBe(false)
  })
})
