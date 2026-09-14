// Node tests for pickCexVenue (cex-venue-map.js). Fixtures are REAL rows
// measured from CoinGecko PRO /coins/{id}/tickers on 2026-08-27.
// Run: node apps/research/api/_lib/__tests__/cex-venue-map.test.mjs
import assert from 'node:assert/strict'
import { pickCexVenue } from '../cex-venue-map.js'

let passed = 0
function ok(name, fn) { fn(); passed++; console.log('ok -', name) }

const row = (identifier, base, target, usd, extra = {}) => ({
  base, target,
  market: { name: identifier, identifier },
  converted_volume: { usd },
  is_stale: false, is_anomaly: false,
  ...extra,
})

// hyperliquid, as measured: NOT on Binance, OKX deepest.
const HYPE = [
  row('okex', 'HYPE', 'USDT', 63251281),
  row('bybit_spot', 'HYPE', 'USDT', 57340292),
]

ok('picks the deepest allowlisted venue', () => {
  const p = pickCexVenue(HYPE)
  assert.equal(p.venue, 'okx')
  assert.equal(p.base, 'HYPE')
  assert.equal(p.target, 'USDT')
})

ok('maps legacy CoinGecko ids to internal venue names', () => {
  assert.equal(pickCexVenue([row('okex', 'X', 'USDT', 1)]).venue, 'okx')
  assert.equal(pickCexVenue([row('bybit_spot', 'X', 'USDT', 1)]).venue, 'bybit')
  assert.equal(pickCexVenue([row('binance', 'X', 'USDT', 1)]).venue, 'binance')
})

ok('ignores venues outside the allowlist even at higher volume', () => {
  const p = pickCexVenue([
    row('mxc', 'X', 'USDT', 999999999),
    row('binance', 'X', 'USDT', 1),
  ])
  assert.equal(p.venue, 'binance')
})

ok('rejects non-USD quotes (the official-trump/Upbit KRW case)', () => {
  assert.equal(pickCexVenue([row('binance', 'TRUMP', 'KRW', 999)]), null)
  assert.equal(pickCexVenue([row('binance', 'X', 'EUR', 999)]), null)
})

ok('rejects stale and anomalous rows', () => {
  assert.equal(pickCexVenue([row('binance', 'X', 'USDT', 999, { is_stale: true })]), null)
  assert.equal(pickCexVenue([row('binance', 'X', 'USDT', 999, { is_anomaly: true })]), null)
})

ok('rejects a contract-shaped base (DEX rows must never win)', () => {
  const addr = '0xb2000000000000000000002d0ba3164cc74f58b7'
  assert.equal(pickCexVenue([row('binance', addr, 'USDT', 999)]), null)
})

ok('a row with no converted_volume is still eligible at volUsd 0', () => {
  const p = pickCexVenue([{ base: 'X', target: 'USDT', market: { identifier: 'binance' } }])
  assert.equal(p.venue, 'binance')
  assert.equal(p.volUsd, 0)
})

ok('empty / junk input returns null, never throws', () => {
  assert.equal(pickCexVenue([]), null)
  assert.equal(pickCexVenue(null), null)
  assert.equal(pickCexVenue(undefined), null)
  assert.equal(pickCexVenue([{}, { market: {} }]), null)
})

console.log(`\n${passed} passed`)
