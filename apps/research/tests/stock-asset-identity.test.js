import { describe, expect, it } from 'vitest'
import { normalizeAssetForMarket, isStockAsset } from '../src/lib/asset-identity'
import { buildWelcomeChartToken } from '../src/pages/home/components/welcome-chart-token'

describe('Stocks retain their market identity', () => {
  it('recovers an already saved stock favourite without losing saved metadata', () => {
    const saved = { symbol: 'GOOGL', name: 'Alphabet Inc.', pinned: true, price: 331.81, notes: 'Keep', address: null }
    const repaired = normalizeAssetForMarket(saved, 'stocks')
    expect(repaired).toEqual({ ...saved, isStock: true, assetClass: 'stock' })
    expect(saved.isStock).toBeUndefined()
    expect([repaired].filter(token => token.isStock)).toHaveLength(1)
    expect(normalizeAssetForMarket(repaired, 'stocks')).toBe(repaired)
  })
  it('never guesses stock identity from a crypto ticker', () => {
    const crypto = { symbol: 'GOOGL', address: '0xtoken', cgId: 'tokenized-googl' }
    expect(normalizeAssetForMarket(crypto, 'crypto')).toBe(crypto)
    expect(isStockAsset(crypto)).toBe(false)
  })
  it.each([{type:'stock'}, {isStock:true}, {assetClass:'stock'}])('keeps chart and exchange identity from a stock row: %o', identity => {
    const token = { symbol: 'GOOGL', name: 'Alphabet', exchange: 'NASDAQ', sector: 'Technology', price: 331.81, ...identity }
    const chart = buildWelcomeChartToken(token, { sparkline_7d: [1, 2] }, 'logo')
    expect(chart).toMatchObject({ symbol: 'GOOGL', isStock: true, assetClass: 'stock', exchange: 'NASDAQ', sector: 'Technology', price: 331.81, cgId: null, sparkline_7d: null })
    expect(isStockAsset(chart)).toBe(true)
  })
  it('preserves crypto address, network and CoinGecko fallback for charts', () => {
    const chart = buildWelcomeChartToken({symbol:'ETH', address:'0xeth', networkId:1, id:'ethereum'}, {sparkline_7d:[1,2]}, 'eth-logo')
    expect(chart).toMatchObject({symbol:'ETH',address:'0xeth',networkId:1,cgId:'ethereum',sparkline_7d:[1,2],logo:'eth-logo'})
    expect(isStockAsset(chart)).toBe(false)
  })
})
