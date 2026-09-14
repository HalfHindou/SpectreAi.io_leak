import { describe, it, expect } from 'vitest'
import { appendPermit2Signature } from '../src/services/swapService.js'

// appendPermit2Signature(calldata, signature) packs the off-chain Permit2
// signature onto 0x v2 swap calldata as:
//   calldata + uint256(signatureByteLength) + signature(without 0x prefix)
// Pure string function - no wallet needed.

describe('appendPermit2Signature', () => {
  const calldata = '0xabcdef'
  // 65-byte signature: '0x' + 130 hex chars. 65 = 0x41.
  const signature = '0x' + 'ab'.repeat(65)

  it('prefixes the result with the original calldata', () => {
    const out = appendPermit2Signature(calldata, signature)
    expect(out.startsWith(calldata)).toBe(true)
  })

  it('inserts a 64-hex-char length word equal to 65 (0x41), left-padded', () => {
    const out = appendPermit2Signature(calldata, signature)
    const lengthWord = out.slice(calldata.length, calldata.length + 64)
    expect(lengthWord.length).toBe(64)
    expect(lengthWord).toBe('41'.padStart(64, '0'))
  })

  it('strips the signature 0x prefix before appending', () => {
    const out = appendPermit2Signature(calldata, signature)
    const appendedSig = out.slice(calldata.length + 64)
    expect(appendedSig).toBe(signature.slice(2))
    expect(appendedSig.startsWith('0x')).toBe(false)
  })

  it('produces the expected total length', () => {
    const out = appendPermit2Signature(calldata, signature)
    // calldata (8) + length word (64) + signature body (130) = 202
    expect(out.length).toBe(calldata.length + 64 + (signature.length - 2))
    expect(out.length).toBe(202)
  })
})
