import { afterEach, describe, expect, it, vi } from 'vitest'
import { computePricescaleFromPrice, knownCryptoSymbolInfo } from '@/lib/tradingViewSymbolInfo'
import { createDatafeed } from '@/components/TradingViewAdvanced'

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }))
vi.mock('@/lib/gate-resume', () => ({ tryGateResume: vi.fn() }))
vi.mock('@/services/codexStreamApi', () => ({ subscribe: vi.fn() }))
vi.mock('@/services/stockApi', () => ({ getStockSeriesBars: vi.fn(), FALLBACK_STOCK_DATA: {} }))
vi.mock('@/services/spectreMarketApi', () => ({ getSpectreTokenChart: vi.fn() }))

const tokenFor = (id) => ({ address: `0x${String(id).padStart(40, '0')}`, networkId: 1 })
const datafeedFor = (token, price, symbol = 'SPECTRE') => createDatafeed(
  vi.fn(), { current: price }, { current: token }, { current: true }, { current: null }, undefined, symbol,
)

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('TradingView symbol precision', () => {
  it.each([
    [65000, 100], [10000, 100], [9999, 10000], [100, 10000],
    [1, 10000], [0.42, 1000000], [0.01, 1000000],
    [0.0001, 100000000], [0.000001, 10000000000],
  ])('retains precision for price %s', (price, expected) => {
    expect(computePricescaleFromPrice(price)).toBe(expected)
  })

  it.each([undefined, null, 0, -1, NaN, Infinity, 1e12])('rejects invalid reference price %s', (price) => {
    expect(computePricescaleFromPrice(price)).toBeNull()
  })
})

describe('TradingView known crypto metadata', () => {
  it('preserves crypto sessions, currency, and supported resolutions', () => {
    const result = knownCryptoSymbolInfo({ symbolName: 'SPECTRE', chartSymbol: 'SPECTRE', token: tokenFor(1), pricescale: 1000000 })
    expect(result).toMatchObject({
      name: 'SPECTRE', full_name: 'CRYPTO:SPECTREUSD', description: 'SPECTRE/USD',
      type: 'crypto', session: '24x7', exchange: 'CRYPTO', timezone: 'Etc/UTC',
      currency_code: 'USD', pricescale: 1000000, minmov: 1, volume_precision: 2,
      supported_resolutions: ['1S', '1', '5', '15', '30', '60', '240', '720', '1D', '1W'],
    })
  })

  it.each([
    { token: undefined },
    { token: { networkId: 1 } },
    { token: { address: ' ' , networkId: 1 } },
    { token: { address: tokenFor(1).address } },
    { token: { ...tokenFor(1), networkId: 0 } },
    { token: { ...tokenFor(1), networkId: NaN } },
    { token: { ...tokenFor(1), isStock: true } },
    { symbolName: 'BTC' },
    { chartSymbol: undefined },
    { pricescale: undefined },
    { pricescale: Infinity },
    { pricescale: 0 },
  ])('keeps unresolved or unrelated inputs on the server path: %o', (override) => {
    expect(knownCryptoSymbolInfo({ symbolName: 'SPECTRE', chartSymbol: 'SPECTRE', token: tokenFor(1), pricescale: 1000000, ...override })).toBeNull()
  })
})

describe('TradingView datafeed symbol startup', () => {
  it('resolves known crypto asynchronously without waiting on metadata or probing bars', async () => {
    vi.useFakeTimers()
    // A stalled metadata endpoint must have no effect on this startup path.
    const fetch = vi.fn(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetch)
    const resolve = vi.fn()
    const reject = vi.fn()
    await datafeedFor(tokenFor(11), 0.42).resolveSymbol('SPECTRE', resolve, reject)
    expect(resolve).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ pricescale: 1000000, type: 'crypto' }))
    expect(fetch).not.toHaveBeenCalled()
    expect(reject).not.toHaveBeenCalled()
  })

  it('can reuse a known contract scale on remount without a new live quote', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const token = tokenFor(12)
    await datafeedFor(token, 0.000002).resolveSymbol('SPECTRE', vi.fn(), vi.fn())
    await vi.runAllTimersAsync()
    const resolve = vi.fn()
    await datafeedFor(token, undefined).resolveSymbol('SPECTRE', resolve, vi.fn())
    await vi.runAllTimersAsync()
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ pricescale: 10000000000 }))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('still loads real bars by contract with source and quote-agreement parameters', async () => {
    vi.useFakeTimers()
    const token = { ...tokenFor(18), cgId: 'spectre-ai', barsSrc: 'gt' }
    const bars = Array.from({ length: 10 }, (_, i) => ({ t: 1789320000 + i * 300, o: 0.42, h: 0.421, l: 0.419, c: 0.42, v: 1 }))
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ bars }) }))
    vi.stubGlobal('fetch', fetch)
    const feed = datafeedFor(token, 0.42)
    const resolve = vi.fn()
    await feed.resolveSymbol('SPECTRE', resolve, vi.fn())
    await vi.runAllTimersAsync()
    const onBars = vi.fn()
    const onError = vi.fn()
    await feed.getBars(resolve.mock.calls[0][0], '5', { from: 1789320000, to: 1789323000, firstDataRequest: true }, onBars, onError)
    expect(fetch).toHaveBeenCalledTimes(1)
    const url = new URL(fetch.mock.calls[0][0], 'http://localhost')
    expect(url.pathname).toBe('/api/bars')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      symbol: `${token.address}:1`, networkId: '1', resolution: '5',
      from: '1789320000', to: '1789323000', cgId: 'spectre-ai', src: 'gt', refPrice: '0.42',
    })
    expect(onBars.mock.calls[0][0]).toHaveLength(10)
    expect(onBars.mock.calls[0][0][0]).toMatchObject({ time: bars[0].t * 1000, close: 0.42 })
    expect(onError).not.toHaveBeenCalled()
  })

  it('does not share a cached scale with a different contract using the same ticker', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async (url) => ({ ok: true, json: async () => url.includes('/symbols?') ? { name: 'SPECTRE', pricescale: 10000 } : { bars: [] } }))
    vi.stubGlobal('fetch', fetch)
    await datafeedFor(tokenFor(13), 0.000002).resolveSymbol('SPECTRE', vi.fn(), vi.fn())
    await vi.runAllTimersAsync()
    const resolve = vi.fn()
    await datafeedFor(tokenFor(14), undefined).resolveSymbol('SPECTRE', resolve, vi.fn())
    expect(fetch.mock.calls.some(([url]) => url.includes('/udf/symbols?'))).toBe(true)
    expect(fetch.mock.calls.some(([url]) => url.includes('/api/bars?'))).toBe(true)
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ pricescale: 10000 }))
  })

  it.each([
    ['unresolved identity', undefined, 0.42, 'SPECTRE'],
    ['missing price', tokenFor(15), undefined, 'SPECTRE'],
    ['invalid price', tokenFor(16), Infinity, 'SPECTRE'],
    ['unrelated requested symbol', tokenFor(17), 0.42, 'BTC'],
  ])('retains metadata lookup for %s', async (_label, token, price, requested) => {
    const fetch = vi.fn(async (url) => ({ ok: true, json: async () => url.includes('/symbols?') ? { name: requested, pricescale: 100000 } : { bars: [] } }))
    vi.stubGlobal('fetch', fetch)
    const resolve = vi.fn()
    await datafeedFor(token, price).resolveSymbol(requested, resolve, vi.fn())
    expect(fetch.mock.calls.some(([url]) => url.includes(`/udf/symbols?symbol=${requested}`))).toBe(true)
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ name: requested }))
  })
})
