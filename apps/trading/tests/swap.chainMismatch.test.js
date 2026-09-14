/**
 * Cross-chain swap guard tests (2026-07-06 audit).
 *
 * The bug locked out here: quote chainId was derived from the INPUT token
 * only, so buying a Base token while paying with Ethereum-chain ETH quoted
 * on Ethereum with the Base token's ADDRESS as output - whatever token
 * happens to live at that address there (wrong-asset delivery). Mismatched
 * chains must refuse to build params.
 */
import { describe, it, expect } from 'vitest'
import { buildSwapParams, chainForNetworkId, parsePriceImpact } from '../src/lib/swapParams.js'

const BASE_TOKEN = { address: '0x1111111111111111111111111111111111111111', decimals: 18, networkId: 8453 }
const ETH_PAY = { address: 'native', decimals: 18, chainId: 'ethereum' }
const BASE_PAY = { address: 'native', decimals: 18, chainId: 'base' }
const SOL_TOKEN = { address: 'So11111111111111111111111111111111111111112', decimals: 9, networkId: 1399811149 }
const SOL_PAY = { address: 'native', decimals: 9, chainId: 'solana' }

describe('buildSwapParams - unsupported chain guard', () => {
  // An Avalanche token paid with Ethereum-chain ETH used to BUILD SUCCESSFULLY:
  // the token resolved to 'ethereum' via the old default, so the cross-chain
  // comparison below saw ethereum === ethereum and let it through - quoting an
  // AVAX contract address on mainnet. It must now refuse before that check.
  const AVAX_TOKEN = { address: '0x2222222222222222222222222222222222222222', decimals: 18, networkId: 43114 }
  const OP_TOKEN = { address: '0x3333333333333333333333333333333333333333', decimals: 18, networkId: 10 }

  it('refuses an Avalanche token even when the pay side is ethereum', () => {
    const r = buildSwapParams({ token: AVAX_TOKEN, payToken: ETH_PAY, mode: 'buy', amount: '1' })
    expect(r.params).toBeUndefined()
    expect(r.unsupportedChain).toBe(true)
    expect(r.error).toMatch(/not supported/i)
  })

  it('refuses an Optimism token', () => {
    const r = buildSwapParams({ token: OP_TOKEN, payToken: ETH_PAY, mode: 'buy', amount: '1' })
    expect(r.params).toBeUndefined()
    expect(r.unsupportedChain).toBe(true)
  })
})

describe('buildSwapParams - cross-chain guard', () => {
  it('refuses buy of a Base token paid with Ethereum-chain ETH', () => {
    const r = buildSwapParams({ token: BASE_TOKEN, payToken: ETH_PAY, mode: 'buy', amount: '1' })
    expect(r.params).toBeUndefined()
    expect(r.error).toMatch(/Base/)
  })

  it('refuses sell of a Base token into an Ethereum-chain pay token', () => {
    const r = buildSwapParams({ token: BASE_TOKEN, payToken: ETH_PAY, mode: 'sell', amount: '1' })
    expect(r.params).toBeUndefined()
    expect(r.error).toMatch(/Base/)
  })

  it('refuses solana <-> evm pairs', () => {
    const r = buildSwapParams({ token: SOL_TOKEN, payToken: ETH_PAY, mode: 'buy', amount: '1' })
    expect(r.error).toMatch(/Solana/)
    const r2 = buildSwapParams({ token: BASE_TOKEN, payToken: SOL_PAY, mode: 'buy', amount: '1' })
    expect(r2.error).toMatch(/Base/)
  })

  it('accepts a chain SLUG on the token (RightPanel spectreToken carries chainId, not networkId)', () => {
    // Regression: spectreToken has chainId:'base' and NO networkId - deriving
    // from the absent networkId defaulted to ethereum and falsely tripped the
    // guard on every same-chain Base quote.
    const r = buildSwapParams({
      token: { address: BASE_TOKEN.address, decimals: 18, chainId: 'base' },
      payToken: BASE_PAY,
      mode: 'buy',
      amount: '1',
    })
    expect(r.error).toBeUndefined()
    expect(r.params.chainId).toBe('base')
  })

  it('builds same-chain params with the TARGET token chain', () => {
    const r = buildSwapParams({ token: BASE_TOKEN, payToken: BASE_PAY, mode: 'buy', amount: '0.5', userAddress: '0xabc' })
    expect(r.error).toBeUndefined()
    expect(r.params.chainId).toBe('base')
    expect(r.params.inputToken).toBe('native')
    expect(r.params.outputToken).toBe(BASE_TOKEN.address)
    expect(r.params.amount).toBe((5n * 10n ** 17n).toString())
    expect(r.params.userAddress).toBe('0xabc')
  })

  it('sell swaps input/output and amounts use the input decimals', () => {
    const r = buildSwapParams({ token: BASE_TOKEN, payToken: { ...BASE_PAY, decimals: 6 }, mode: 'sell', amount: '2' })
    expect(r.params.inputToken).toBe(BASE_TOKEN.address)
    expect(r.params.outputToken).toBe('native')
    // input = target token (18 decimals)
    expect(r.params.amount).toBe((2n * 10n ** 18n).toString())
    expect(r.params.outputDecimals).toBe(6)
  })

  it('returns silent null error for empty amount, explicit error for garbage', () => {
    expect(buildSwapParams({ token: BASE_TOKEN, payToken: BASE_PAY, mode: 'buy', amount: '' }).error).toBeNull()
    expect(buildSwapParams({ token: BASE_TOKEN, payToken: BASE_PAY, mode: 'buy', amount: 'x' }).error).toMatch(/Invalid/)
    expect(buildSwapParams({ token: BASE_TOKEN, payToken: BASE_PAY, mode: 'buy', amount: '0' }).error).toBeNull()
  })
})

describe('parsePriceImpact - provider-aware units', () => {
  it('reads Jupiter fractions as percent', () => {
    expect(parsePriceImpact({ provider: 'jupiter', priceImpactPct: '0.0234' })).toBeCloseTo(2.34)
    expect(parsePriceImpact({ provider: 'jupiter', priceImpactPct: '0.5' })).toBeCloseTo(50)
  })
  it('reads 0x values as percent AS-IS (the healthy-swap-blocked regression)', () => {
    // "0.3" from 0x means 0.3% - the old heuristic turned it into 30% and
    // the 5% guard refused the swap.
    expect(parsePriceImpact({ provider: '0x', estimatedPriceImpact: '0.3' })).toBeCloseTo(0.3)
    expect(parsePriceImpact({ provider: '0x', estimatedPriceImpact: '12.5' })).toBeCloseTo(12.5)
  })
  it('handles null/garbage', () => {
    expect(parsePriceImpact({ provider: '0x' })).toBeNull()
    expect(parsePriceImpact({ provider: '0x', estimatedPriceImpact: 'x' })).toBeNull()
    expect(parsePriceImpact(null)).toBeNull()
  })
})

describe('chainForNetworkId', () => {
  it('maps every supported network id', () => {
    expect(chainForNetworkId(1)).toBe('ethereum')
    expect(chainForNetworkId(56)).toBe('bsc')
    expect(chainForNetworkId(137)).toBe('polygon')
    expect(chainForNetworkId(42161)).toBe('arbitrum')
    expect(chainForNetworkId(8453)).toBe('base')
    expect(chainForNetworkId(1399811149)).toBe('solana')
    expect(chainForNetworkId(4663)).toBe('robinhood')
  })

  // Regression: this used to default to 'ethereum' for ANY unknown id, which
  // silently quoted Avalanche/Optimism/Fantom tokens against MAINNET using the
  // foreign token's address - and made the cross-chain guard below a no-op,
  // because both sides then read 'ethereum'. Null is the contract now; callers
  // decide what to do (RightPanel treats a MISSING networkId as a CoinGecko
  // major and only then falls back to ethereum).
  it('returns null for chains with no swap route', () => {
    expect(chainForNetworkId(43114)).toBeNull()  // Avalanche
    expect(chainForNetworkId(10)).toBeNull()     // Optimism
    expect(chainForNetworkId(250)).toBeNull()    // Fantom
    expect(chainForNetworkId(81457)).toBeNull()  // Blast
    expect(chainForNetworkId(undefined)).toBeNull()
    expect(chainForNetworkId(null)).toBeNull()
  })
})
