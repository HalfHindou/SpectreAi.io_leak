/**
 * Fund-safety tests for the withdraw transaction builder (2026-07-06 audit).
 *
 * The two bugs these lock in place:
 *  1. CHAIN PINNING - Privy signs on the wallet's current chain when the
 *     request has no chainId; a BNB-tab withdraw could move mainnet ETH.
 *     Every built request MUST carry the active tab's chainId.
 *  2. FLOAT MATH - parseFloat(amount) * 1e18 loses precision; amounts must
 *     round-trip exactly via decimal-string math.
 */
import { describe, it, expect } from 'vitest'
import { buildWithdrawTx, toBaseUnits, clampDecimals, EVM_CHAIN_IDS } from '../src/lib/withdrawTx.js'

const TO = '0x000000000000000000000000000000000000dEaD'
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

describe('buildWithdrawTx - chain pinning', () => {
  it.each([
    ['ethereum', 1],
    ['base', 8453],
    ['polygon', 137],
    ['arbitrum', 42161],
    ['bsc', 56],
  ])('pins chainId for %s native withdraw', async (chain, id) => {
    const tx = await buildWithdrawTx({ activeChain: chain, token: { isNative: true }, toAddress: TO, amount: '0.5' })
    expect(tx.chainId).toBe(id)
    expect(tx.to).toBe(TO)
    expect(tx.value).toBe('0x' + (5n * 10n ** 17n).toString(16))
    expect(tx.data).toBeUndefined()
  })

  it('pins chainId for ERC-20 withdraw and targets the token contract', async () => {
    const tx = await buildWithdrawTx({
      activeChain: 'base',
      token: { isNative: false, contractAddress: USDC_BASE, decimals: 6 },
      toAddress: TO,
      amount: '12.34',
    })
    expect(tx.chainId).toBe(8453)
    expect(tx.to).toBe(USDC_BASE)
    expect(tx.value).toBeUndefined()
    // transfer(address,uint256) selector + padded args
    expect(tx.data.startsWith('0xa9059cbb')).toBe(true)
    expect(tx.data).toContain(TO.slice(2).toLowerCase())
    expect(tx.data.endsWith(BigInt(12_340_000).toString(16).padStart(64, '0'))).toBe(true)
  })

  it('rejects unsupported chains (incl. solana - built elsewhere)', async () => {
    await expect(buildWithdrawTx({ activeChain: 'solana', token: { isNative: true }, toAddress: TO, amount: '1' }))
      .rejects.toThrow(/Unsupported chain/)
    await expect(buildWithdrawTx({ activeChain: 'optimism', token: { isNative: true }, toAddress: TO, amount: '1' }))
      .rejects.toThrow(/Unsupported chain/)
  })

  it('rejects zero and missing input', async () => {
    await expect(buildWithdrawTx({ activeChain: 'ethereum', token: { isNative: true }, toAddress: TO, amount: '0' }))
      .rejects.toThrow(/positive/)
    await expect(buildWithdrawTx({ activeChain: 'ethereum', token: { isNative: true }, toAddress: '', amount: '1' }))
      .rejects.toThrow(/recipient/)
    await expect(buildWithdrawTx({ activeChain: 'ethereum', token: { isNative: false, decimals: 6 }, toAddress: TO, amount: '1' }))
      .rejects.toThrow(/contract/)
  })
})

describe('buildWithdrawTx - exact amount math', () => {
  it('keeps full 18-decimal precision (the parseFloat*1e18 failure case)', async () => {
    const amount = '0.123456789012345678'
    const tx = await buildWithdrawTx({ activeChain: 'ethereum', token: { isNative: true }, toAddress: TO, amount })
    expect(BigInt(tx.value)).toBe(123456789012345678n)
  })

  it('truncates (never rounds up) extra decimals beyond token precision', async () => {
    const tx = await buildWithdrawTx({
      activeChain: 'ethereum',
      token: { isNative: false, contractAddress: USDC_BASE, decimals: 6 },
      toAddress: TO,
      amount: '1.9999999', // 7 dp on a 6-dp token
    })
    expect(tx.data.endsWith(BigInt(1_999_999).toString(16).padStart(64, '0'))).toBe(true)
  })
})

describe('toBaseUnits (Solana lamports / SPL raw amounts)', () => {
  it('converts SOL to lamports exactly', () => {
    expect(toBaseUnits('1.000000001', 9)).toBe(1_000_000_001n)
    expect(toBaseUnits('0.01', 9)).toBe(10_000_000n)
  })
  it('handles amounts that break float math', () => {
    // 9007199.254740993 * 1e9 is not representable in a double
    expect(toBaseUnits('9007199.254740993', 9)).toBe(9007199254740993n)
  })
  it('throws on garbage', () => {
    expect(() => toBaseUnits('abc', 9)).toThrow()
    expect(() => toBaseUnits('1e5', 9)).toThrow()
    expect(() => toBaseUnits('', 9)).toThrow()
  })
})

describe('clampDecimals', () => {
  it('truncates without rounding', () => {
    expect(clampDecimals('1.9999999', 6)).toBe('1.999999')
    expect(clampDecimals('1.5', 6)).toBe('1.5')
    expect(clampDecimals('7', 6)).toBe('7')
  })
})

describe('EVM_CHAIN_IDS', () => {
  it('covers the six supported EVM chains with canonical ids', () => {
    // Robinhood Chain (4663) was added to the withdraw map without updating
    // this assertion, so the suite was already red before the 2026-07-30
    // trading pass. Keep this exhaustive (toEqual, not toMatchObject): it is
    // the guard that a new withdraw chain gets a deliberate review.
    expect(EVM_CHAIN_IDS).toEqual({ ethereum: 1, base: 8453, polygon: 137, arbitrum: 42161, bsc: 56, robinhood: 4663 })
  })
})
