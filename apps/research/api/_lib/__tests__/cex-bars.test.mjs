// Node tests for the Bybit/OKX kline adapters. Fixtures are REAL responses
// captured from both venues for HYPEUSDT 1h on 2026-08-27.
// Run: node apps/research/api/_lib/__tests__/cex-bars.test.mjs
import assert from 'node:assert/strict'
import { cexPairSymbol, parseCexKlines, CEX_INTERVALS } from '../cex-bars.js'

let passed = 0
function ok(name, fn) { fn(); passed++; console.log('ok -', name) }

// Both venues answer DESCENDING, ms timestamps, string values, and both put
// [ts, o, h, l, c, volume] in the first six slots — so ONE parser serves both.
const BYBIT = [
  ['1787821200000', '82.5', '82.86', '82.26', '82.74', '11742.612', '970166.69421'],
  ['1787817600000', '81.76', '82.54', '81.46', '82.5', '38313.049', '3148382.78211'],
  ['1787814000000', '81.62', '81.88', '81.28', '81.76', '15070.24', '1229448.40957'],
]
const OKX = [
  ['1787821200000', '82.51', '82.85', '82.259', '82.833', '15343.1276', '1267479.518', '1267479.518', '0'],
  ['1787817600000', '81.732', '82.517', '81.441', '82.507', '48892.4183', '4014057.957', '4014057.957', '1'],
  ['1787814000000', '81.572', '81.849', '81.244', '81.724', '15689.455', '1279307.923', '1279307.923', '1'],
]

ok('formats the pair symbol per venue', () => {
  assert.equal(cexPairSymbol('binance', 'HYPE', 'USDT'), 'HYPEUSDT')
  assert.equal(cexPairSymbol('bybit', 'HYPE', 'USDT'), 'HYPEUSDT')
  assert.equal(cexPairSymbol('okx', 'HYPE', 'USDT'), 'HYPE-USDT')
})

ok('parses Bybit rows into ascending second-stamped bars', () => {
  const bars = parseCexKlines(BYBIT)
  assert.equal(bars.length, 3)
  assert.equal(bars[0].t, 1787814000)
  assert.equal(bars[2].t, 1787821200)
  assert.ok(bars[0].t < bars[1].t && bars[1].t < bars[2].t, 'must be ascending')
  assert.equal(bars[2].o, 82.5)
  assert.equal(bars[2].c, 82.74)
  assert.equal(bars[2].v, 11742.612)
})

ok('parses OKX rows with the same parser', () => {
  const bars = parseCexKlines(OKX)
  assert.equal(bars.length, 3)
  assert.equal(bars[2].t, 1787821200)
  assert.equal(bars[2].c, 82.833)
})

ok('the two venues agree on the same hour', () => {
  const b = parseCexKlines(BYBIT).at(-1)
  const o = parseCexKlines(OKX).at(-1)
  assert.equal(b.t, o.t)
  assert.ok(Math.abs(b.c - o.c) / b.c < 0.01, 'closes within 1%')
})

ok('drops rows with non-finite or non-positive prices', () => {
  const bars = parseCexKlines([
    ['1787814000000', '1', '2', '0.5', '1.5', '10'],
    ['1787817600000', '0', '2', '0.5', '1.5', '10'],
    ['1787821200000', 'nope', '2', '0.5', '1.5', '10'],
  ])
  assert.equal(bars.length, 1)
})

ok('empty / junk input returns null, never throws', () => {
  assert.equal(parseCexKlines([]), null)
  assert.equal(parseCexKlines(null), null)
  assert.equal(parseCexKlines([[1]]), null)
})

ok('maps every resolution the chart offers, for both venues', () => {
  for (const res of ['1', '5', '15', '60', '240', '1D', '1W']) {
    assert.ok(CEX_INTERVALS.bybit[res], `bybit missing ${res}`)
    assert.ok(CEX_INTERVALS.okx[res], `okx missing ${res}`)
  }
  assert.equal(CEX_INTERVALS.okx['60'], '1H')
  assert.equal(CEX_INTERVALS.bybit['60'], '60')
})

console.log(`\n${passed} passed`)
