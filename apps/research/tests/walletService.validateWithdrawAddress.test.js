import { describe, it, expect } from 'vitest'
import { validateWithdrawAddress } from '../src/services/walletService.js'

// Thin parity test: the research walletService exports an identical
// validateWithdrawAddress. Covers the core happy paths plus the wrong-chain
// fund-loss guard. Full edge cases live in the trading suite.

const EVM_LOWER = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
const SOL_VALID = 'So11111111111111111111111111111111111111112'

describe('validateWithdrawAddress (research)', () => {
  it('accepts a valid EVM address on an EVM chain', () => {
    expect(validateWithdrawAddress(EVM_LOWER, 'ethereum')).toBeNull()
  })

  it('accepts a valid Solana address on chainId solana', () => {
    expect(validateWithdrawAddress(SOL_VALID, 'solana')).toBeNull()
  })

  it('rejects an EVM address on chainId solana (wrong-chain guard)', () => {
    expect(validateWithdrawAddress(EVM_LOWER, 'solana')).not.toBeNull()
  })

  it('rejects a Solana address on an EVM chain (wrong-chain guard)', () => {
    expect(validateWithdrawAddress(SOL_VALID, 'ethereum')).not.toBeNull()
  })

  it('rejects empty input', () => {
    expect(validateWithdrawAddress('', 'ethereum')).not.toBeNull()
  })
})
