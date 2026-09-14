// Node tests for repairScaledPrices (bars-router.js) - the "junk close" class.
// Fixture is the REAL payload measured on the codex tier for LEO 5m, 2023-01-12
// (see rz-chart-audit-plan). Pure module - no KV, no fetch.
// Run: node apps/research/api/_lib/__tests__/bars-scale-repair.test.mjs
import assert from 'node:assert/strict'
import { repairScaledPrices } from '../bars-router.js'

let passed = 0
function ok(name, fn) { fn(); passed++; console.log('ok -', name) }

const t0 = 1673502600
const b = (i, o, h, l, c, v = 10) => ({ t: t0 + i * 300, o, h, l, c, v })
const JUNK = 4.10238194543e-36

// LEO 5m as Codex actually served it. Each bar's open is the prior close and
// h/l are max/min of the body, so the corrupted price point shows up FOUR
// times: bar 1's close and low, bar 2's open and low.
const LEO = [
  b(0, 4.7, 4.7, 4.3475461467, 4.3475461467),
  b(1, 4.3475461467, 4.3475461467, 3.92250987358, 3.92250987358),
  b(2, 3.92250987358, 3.92250987358, JUNK, JUNK, 107),
  b(3, JUNK, 3.02852732516, JUNK, 3.02852732516, 10),
  b(4, 3.02852732516, 3.09145403351, 3.02852732516, 3.09145403351),
  b(5, 3.09145403351, 3.33217743028, 3.09145403351, 3.33217743028),
  b(6, 3.33217743028, 3.58958601289, 3.33217743028, 3.58958601289),
]

const isPrice = v => Number.isFinite(v) && v > 1e-15
const allPrices = bars => bars.every(x => [x.o, x.h, x.l, x.c].every(isPrice))
const ohlcValid = bars => bars.every(x => x.l <= Math.min(x.o, x.c) + 1e-18 && x.h >= Math.max(x.o, x.c) - 1e-18)

ok('the fixture really is broken (guards the fixture itself)', () => {
  assert.equal(allPrices(LEO), false)
  assert.equal(LEO.filter(x => [x.o, x.h, x.l, x.c].some(v => !isPrice(v))).length, 2)
})

ok('every OHLC field comes back a real price', () => {
  const out = repairScaledPrices(LEO)
  assert.equal(out.length, LEO.length, 'no bar is dropped when the price is recoverable')
  assert.equal(allPrices(out), true)
})

ok('the recovered value is the real price, not a neighbour copy', () => {
  const out = repairScaledPrices(LEO)
  // JUNK * 1e36 = 4.10238194543 - it sits between its neighbours' 3.92 and 3.03
  assert.ok(Math.abs(out[2].c - 4.10238194543) < 1e-9, `got ${out[2].c}`)
  assert.ok(Math.abs(out[3].o - 4.10238194543) < 1e-9, `got ${out[3].o}`)
  assert.notEqual(out[2].c, out[1].c, 'must not be a flattened copy of the previous close')
})

ok('THE INVARIANT: h/l are widened so the bar stays a valid candle', () => {
  const out = repairScaledPrices(LEO)
  assert.equal(ohlcValid(out), true)
  // bar 2 closed ABOVE its old high, so the high must have moved with it
  assert.ok(out[2].h >= out[2].c)
  assert.ok(out[2].l <= Math.min(out[2].o, out[2].c))
})

ok('a healthy series is returned untouched (same reference, no copy)', () => {
  // Long enough to clear the length guard, so this really exercises the scan.
  const clean = [
    b(0, 4.7, 4.8, 4.3, 4.35), b(1, 4.35, 4.4, 3.9, 3.92), b(2, 3.92, 4.2, 3.8, 4.10),
    b(3, 4.10, 4.15, 3.0, 3.03), b(4, 3.03, 3.10, 3.0, 3.09), b(5, 3.09, 3.34, 3.05, 3.33),
    b(6, 3.33, 3.60, 3.30, 3.59),
  ]
  const out = repairScaledPrices(clean)
  assert.equal(out, clean, 'an untouched series must not even be rebuilt')
})

ok('a real wick outside the body is never narrowed', () => {
  // Widening must only ever ADD range - a legitimate long wick stays.
  const wicky = [
    b(0, 3, 9, 1, 3.2), b(1, 3.2, 9.5, 0.9, 3.1), b(2, 3.1, 8, 1.1, 3.4),
    b(3, 3.4, 9, 1, 3.3), b(4, 3.3, 9, 1, 3.5),
  ]
  assert.deepEqual(repairScaledPrices(wicky), wicky)
})

ok('an unrecoverable bar is dropped, never guessed', () => {
  // A zero / NaN price carries no magnitude to rescale from.
  const bad = LEO.slice()
  bad[2] = { ...bad[2], c: 0, l: 0 }
  const out = repairScaledPrices(bad)
  assert.equal(out.length, LEO.length - 1, 'the unusable bar is gone')
  assert.equal(allPrices(out), true)
  assert.equal(out.find(x => x.t === bad[2].t), undefined)
})

ok('a rescale that lands outside the local band is refused', () => {
  // Only an EXACT power of ten that puts the value back among its neighbours
  // is evidence of a unit error. Anything else is a guess.
  const odd = LEO.slice()
  odd[2] = { ...odd[2], c: 7.3e-300, l: 7.3e-300 } // 10^k lands nowhere near
  const out = repairScaledPrices(odd)
  assert.equal(out.length, LEO.length - 1)
})

ok('too short to judge is left alone', () => {
  const tiny = [b(0, 1, 1, JUNK, JUNK)]
  assert.deepEqual(repairScaledPrices(tiny), tiny)
})

ok('junk input never throws', () => {
  assert.deepEqual(repairScaledPrices(null), null)
  assert.deepEqual(repairScaledPrices([]), [])
  assert.deepEqual(repairScaledPrices('x'), 'x')
})

// ── Scale independence ────────────────────────────────────────────────────
// The point of these: there is NOTHING token-specific in repairScaledPrices -
// no symbol list, no address, no per-token constant. Every threshold is
// relative to the LOCAL MEDIAN, so the same code has to work on a $70k CEX
// tape and a 1e-9 microcap without anyone touching it. The LEO fixture above
// is one measured sample, not a configuration.
//
// Each case: a real series at some price scale, one point corrupted by a
// different power of ten, repaired with zero configuration.
const scaleCase = (name, px, exp) => ok(name, () => {
  const bad = px / Math.pow(10, exp)
  const step = (n) => px * (1 + 0.02 * Math.sin(n))
  const rows = []
  for (let i = 0; i < 7; i++) {
    const o = step(i), c = i === 2 ? bad : step(i + 1)
    rows.push(b(i, o, Math.max(o, c), Math.min(o, c), c))
  }
  // and the corrupted point rides into the NEXT bar's open, as it does upstream
  rows[3] = b(3, bad, Math.max(bad, step(4)), Math.min(bad, step(4)), step(4))

  const out = repairScaledPrices(rows)
  assert.equal(out.length, rows.length, `${name}: nothing dropped`)
  assert.equal(allPrices(out), true, `${name}: every field is a price`)
  assert.equal(ohlcValid(out), true, `${name}: still a valid candle`)
  // recovered to the real magnitude, not to a neighbour's value
  assert.ok(Math.abs(out[2].c - px * Math.pow(10, exp) / Math.pow(10, exp)) / px < 0.5,
    `${name}: recovered ${out[2].c}, expected ~${px}`)
  assert.ok(out[2].c > px / 10 && out[2].c < px * 10, `${name}: back in band`)
})

scaleCase('microcap at 2.5e-9, off by 1e18', 2.5e-9, 18)
scaleCase('mid at $4 (the LEO scale), off by 1e36', 4.1, 36)
scaleCase('CEX major at $70k, off by 1e24', 70000, 24)
scaleCase('sub-cent at $0.0004, off by 1e12', 0.0004, 12)

ok('one function, no per-token config: all four scales share the same call', () => {
  // Nothing in the module keys off a symbol - proven by the four cases above
  // running through the identical entry point with no arguments but the bars.
  assert.equal(repairScaledPrices.length, 2, 'signature is (bars, label) - no token param')
})

console.log(`\n${passed} passed`)
