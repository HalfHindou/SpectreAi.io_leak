import { describe, it, expect } from 'vitest'
import { tvIdentityFor, BINANCE_TV_SET } from '@/pages/lite/components/lite-tv-identity'

// What LITE hands TradingViewAdvanced. The widget is ADDRESS-FIRST: given a
// token address it asks /api/bars for `address:networkId`; given nothing it
// asks for the bare ticker, which the server can only answer for CEX-listed
// names. SPECTRE (CG-listed, no Binance pair) used to get the bare ticker and
// an empty chart (2026-09-04).

describe('tvIdentityFor', () => {
  it('stocks: Yahoo-style symbol, isStock token', () => {
    expect(tvIdentityFor({ sym: 'BRK-B', isStock: true })).toEqual({ symbol: 'BRK.B', token: { isStock: true } })
  })

  it('Binance-listed majors ride the bare ticker', () => {
    expect(BINANCE_TV_SET.has('BTC')).toBe(true)
    expect(tvIdentityFor({ sym: 'BTC', isStock: false, isOnchain: false })).toEqual({ symbol: 'BTC', token: undefined })
  })

  it('on-chain caps: the resolved contract, pinned to the GT pool series', () => {
    expect(tvIdentityFor({ sym: 'ZIG', isStock: false, isOnchain: true, onchainContract: '0xabc', networkId: 1 }))
      .toEqual({ symbol: 'ZIG', token: { address: '0xabc', networkId: 1, barsSrc: 'gt' } })
  })

  it('on-chain caps without a resolvable contract get no TV tab', () => {
    expect(tvIdentityFor({ sym: 'ZIG', isStock: false, isOnchain: true, onchainContract: null, networkId: null }))
      .toEqual({ symbol: null, token: undefined })
  })

  it('CG-listed, no Binance pair, in the registry: the registry contract (SPECTRE)', () => {
    const out = tvIdentityFor({ sym: 'SPECTRE', isStock: false, isOnchain: false })
    expect(out.symbol).toBe('SPECTRE')
    expect(out.token).toEqual({ address: '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6', networkId: 1 })
  })

  it('CG-listed, no Binance pair, not in the registry: bare ticker as before (RNDR)', () => {
    expect(tvIdentityFor({ sym: 'RNDR', isStock: false, isOnchain: false })).toEqual({ symbol: 'RNDR', token: undefined })
  })

  it('unknown ticker: no TV tab', () => {
    expect(tvIdentityFor({ sym: 'NOPE', isStock: false, isOnchain: false })).toEqual({ symbol: null, token: undefined })
  })
})
