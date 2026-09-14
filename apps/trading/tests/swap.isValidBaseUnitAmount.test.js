import { describe, it, expect } from 'vitest'
import { isValidBaseUnitAmount } from '../api/swap.js'

// isValidBaseUnitAmount(amount) - true only for a positive integer in base
// units. The impl trims, then regex-tests ^\d+$, then BigInt(s) > 0n.
// Note: a string with internal spaces like ' 5 ' trims to '5' -> TRUE.

describe('isValidBaseUnitAmount', () => {
  it('accepts a positive integer string', () => {
    expect(isValidBaseUnitAmount('1000000')).toBe(true)
  })

  it('accepts a huge 30-digit integer string', () => {
    expect(isValidBaseUnitAmount('1'.repeat(30))).toBe(true)
  })

  it('rejects zero', () => {
    expect(isValidBaseUnitAmount('0')).toBe(false)
  })

  it('rejects negative values', () => {
    expect(isValidBaseUnitAmount('-5')).toBe(false)
  })

  it('rejects decimals', () => {
    expect(isValidBaseUnitAmount('1.5')).toBe(false)
  })

  it('rejects scientific notation', () => {
    expect(isValidBaseUnitAmount('1e9')).toBe(false)
  })

  it('trims surrounding whitespace then validates (\"  5 \" -> true)', () => {
    // The impl trims before the ^\d+$ test, so leading/trailing spaces are
    // stripped and the result is a valid positive integer.
    expect(isValidBaseUnitAmount('  5 ')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidBaseUnitAmount('')).toBe(false)
  })

  it('rejects null and undefined', () => {
    expect(isValidBaseUnitAmount(null)).toBe(false)
    expect(isValidBaseUnitAmount(undefined)).toBe(false)
  })

  it('rejects non-numeric garbage', () => {
    expect(isValidBaseUnitAmount('abc')).toBe(false)
  })
})
