import { describe, it, expect } from 'vitest'
import { validateWithdrawAddress } from '../src/services/walletService.js'

// validateWithdrawAddress(address, chainId) returns null when valid, else a
// human-readable error string. The critical guard is wrong-chain rejection:
// an EVM 0x address on Solana (or vice versa) is the biggest irreversible
// fund-loss vector at withdrawal time.

// Vitalik's well-known address, all-lowercase (no checksum to verify).
const EVM_LOWER = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
// Same address with a valid EIP-55 mixed-case checksum.
const EVM_CHECKSUMMED = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
// Same address with a deliberately wrong checksum (one char case flipped).
const EVM_BAD_CHECKSUM = '0xd8Da6BF26964aF9D7eEd9e03E53415D37aA96045'
// Native SOL mint - a real 32-byte base58 pubkey.
const SOL_VALID = 'So11111111111111111111111111111111111111112'

describe('validateWithdrawAddress', () => {
  it('accepts a valid lowercase EVM address on an EVM chain', () => {
    expect(validateWithdrawAddress(EVM_LOWER, 'ethereum')).toBeNull()
    expect(validateWithdrawAddress(EVM_LOWER, 'base')).toBeNull()
  })

  it('accepts a valid EIP-55 checksummed EVM address', () => {
    expect(validateWithdrawAddress(EVM_CHECKSUMMED, 'arbitrum')).toBeNull()
  })

  it('rejects an EVM 0x address passed with chainId solana', () => {
    const err = validateWithdrawAddress(EVM_LOWER, 'solana')
    expect(err).not.toBeNull()
    expect(typeof err).toBe('string')
  })

  it('accepts a valid Solana base58 address on chainId solana', () => {
    expect(validateWithdrawAddress(SOL_VALID, 'solana')).toBeNull()
  })

  it('rejects a Solana base58 address passed with an EVM chainId', () => {
    const err = validateWithdrawAddress(SOL_VALID, 'ethereum')
    expect(err).not.toBeNull()
    expect(typeof err).toBe('string')
  })

  it('rejects an empty or whitespace-only string', () => {
    expect(validateWithdrawAddress('', 'ethereum')).not.toBeNull()
    expect(validateWithdrawAddress('   ', 'solana')).not.toBeNull()
  })

  it('rejects a garbage string', () => {
    expect(validateWithdrawAddress('not-an-address', 'ethereum')).not.toBeNull()
    expect(validateWithdrawAddress('not-an-address', 'solana')).not.toBeNull()
  })

  it('rejects a mixed-case EVM address with a wrong checksum', () => {
    const err = validateWithdrawAddress(EVM_BAD_CHECKSUM, 'ethereum')
    expect(err).not.toBeNull()
    expect(typeof err).toBe('string')
  })
})
