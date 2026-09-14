// Node tests for stitchAdjacentOpens (cg-ohlc-bars.js) — the universal
// continuity pass writeBarsPayload applies to every outgoing bars series.
// Guards the "torn chart" class: adjacent candle ranges that don't touch
// (ZIG Jul-2021 report). Pure module — no KV, no fetch.
// Run: node apps/research/api/_lib/__tests__/bars-continuity.test.mjs
import assert from 'node:assert/strict'
import { stitchAdjacentOpens } from '../cg-ohlc-bars.js'

let passed = 0
async function ok(name, fn) {
  await fn()
  passed++
  console.log('ok -', name)
}

const DAY = 86400

// The invariant the whole exercise exists for: on a 24/7 asset, TEMPORALLY
// ADJACENT bars must have touching ranges (next bar's [l..h] includes the
// prior close). Returns the void count.
function countAdjacentRangeVoids(bars, bucketSec) {
  let voids = 0
  for (let i = 1; i < bars.length; i++) {
    const p = bars[i - 1]
    const b = bars[i]
    if (b.t - p.t > bucketSec * 1.5) continue
    if (p.c < b.l || p.c > b.h) voids++
  }
  return voids
}

// Real shape from the ZIG report: CG snapshot candles where day 14's whole
// range (h 0.05419) sat BELOW day 13's low (0.05878) — an 8% void.
function zigJul2021() {
  const t0 = Date.UTC(2021, 6, 12) / 1000
  return [
    { t: t0 + 0 * DAY, o: 0.06009, h: 0.06027, l: 0.05944, c: 0.05947, v: 1 },
    { t: t0 + 1 * DAY, o: 0.05944, h: 0.05954, l: 0.05878, c: 0.05921, v: 1 },
    { t: t0 + 2 * DAY, o: 0.05296, h: 0.05419, l: 0.05254, c: 0.05282, v: 1 },
    { t: t0 + 3 * DAY, o: 0.05295, h: 0.05299, l: 0.04372, c: 0.04400, v: 1 },
  ]
}

await ok('closes snapshot-derived voids (the ZIG Jul-2021 shape)', async () => {
  const bars = zigJul2021()
  assert.ok(countAdjacentRangeVoids(bars, DAY) > 0, 'fixture must start torn')
  stitchAdjacentOpens(bars, DAY)
  assert.equal(countAdjacentRangeVoids(bars, DAY), 0)
  // The stitched open IS the prior close, and the range was widened to it.
  assert.equal(bars[2].o, bars[1].c)
  assert.equal(bars[2].h, bars[1].c)
})

await ok('never bridges a REAL data hole (> 1.5 buckets)', async () => {
  const t0 = Date.UTC(2022, 3, 20) / 1000
  const bars = [
    { t: t0, o: 0.05, h: 0.051, l: 0.049, c: 0.05, v: 1 },
    // 30-day missing era (the ZIG-2022 class) — then a far lower level.
    { t: t0 + 30 * DAY, o: 0.032, h: 0.033, l: 0.031, c: 0.032, v: 1 },
  ]
  const before = JSON.stringify(bars)
  stitchAdjacentOpens(bars, DAY)
  assert.equal(JSON.stringify(bars), before, 'bars across a hole must be untouched')
})

await ok('is a no-op on an already-continuous (exchange/AMM) tape', async () => {
  const t0 = Date.UTC(2026, 7, 1) / 1000
  const bars = []
  let price = 100
  for (let i = 0; i < 50; i++) {
    const o = price
    const c = price * (1 + (i % 2 ? 0.01 : -0.008))
    bars.push({ t: t0 + i * 3600, o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c, v: 1 })
    price = c
  }
  const before = JSON.stringify(bars)
  stitchAdjacentOpens(bars, 3600)
  assert.equal(JSON.stringify(bars), before)
})

await ok('is idempotent (stitch of stitched changes nothing)', async () => {
  const bars = zigJul2021()
  stitchAdjacentOpens(bars, DAY)
  const once = JSON.stringify(bars)
  stitchAdjacentOpens(bars, DAY)
  assert.equal(JSON.stringify(bars), once)
})

await ok('only widens ranges — the traded high/low is never shrunk', async () => {
  const bars = zigJul2021()
  const ranges = bars.map(b => ({ h: b.h, l: b.l }))
  stitchAdjacentOpens(bars, DAY)
  bars.forEach((b, i) => {
    assert.ok(b.h >= ranges[i].h, 'high may only grow')
    assert.ok(b.l <= ranges[i].l, 'low may only shrink')
    assert.ok(b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c), 'OHLC stays coherent')
  })
})

await ok('survives junk input (empty, single bar, zero closes)', async () => {
  assert.deepEqual(stitchAdjacentOpens([], DAY), [])
  const one = [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 0 }]
  assert.equal(stitchAdjacentOpens(one, DAY), one)
  const zeros = [
    { t: 0 * DAY + 1, o: 1, h: 1, l: 1, c: 0, v: 0 },
    { t: 1 * DAY + 1, o: 2, h: 2, l: 2, c: 2, v: 0 },
  ]
  stitchAdjacentOpens(zeros, DAY)
  assert.equal(zeros[1].o, 2, 'a non-positive prior close must not be stitched from')
})

console.log(`\n${passed} tests passed`)
