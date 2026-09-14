// Node tests for bars-hole-fill.js (pure module - no KV, no fetch).
// Run: node apps/research/api/_lib/__tests__/bars-hole-fill.test.mjs
import assert from 'node:assert/strict'
import { findServerHoles, refillInteriorHoles, holeRefillIntervalSec } from '../bars-hole-fill.js'

let passed = 0
async function ok(name, fn) {
  await fn()
  passed++
  console.log('ok -', name)
}

// Server bar shape: { t } in SECONDS.
function denseRun(startSec, buckets, stepSec = 60) {
  const out = []
  for (let i = 0; i < buckets; i++) out.push({ t: startSec + i * stepSec, o: 1, h: 1, l: 1, c: 1, v: 1 })
  return out
}

const NOW = 1_786_720_000 // fixed "now" (sec) for determinism

await ok('finds an outage-shaped 3h hole in a dense 1m series', async () => {
  const left = denseRun(NOW - 14 * 3600, 300)
  const holeEnd = left[left.length - 1].t + 180 * 60
  const right = denseRun(holeEnd, 300)
  const holes = findServerHoles([...left, ...right], 60, { nowSec: NOW })
  assert.equal(holes.length, 1)
  assert.equal(holes[0].startSec, left[left.length - 1].t)
  assert.equal(holes[0].endSec, holeEnd)
})

await ok('ignores natural quiet periods of a thin token (sparse borders)', async () => {
  const sparse = (s, n) => denseRun(s, n, 300) // 1 bar / 5min at res 1m
  const left = sparse(NOW - 30 * 3600, 60)
  const holeEnd = left[left.length - 1].t + 180 * 60
  const right = sparse(holeEnd, 60)
  assert.equal(findServerHoles([...left, ...right], 60, { nowSec: NOW }).length, 0)
})

await ok('ignores holes whose right edge is older than 48h', async () => {
  const left = denseRun(NOW - 80 * 3600, 300)
  const holeEnd = left[left.length - 1].t + 180 * 60
  const right = denseRun(holeEnd, 300)
  assert.equal(findServerHoles([...left, ...right], 60, { nowSec: NOW }).length, 0)
})

await ok('refill merges fetched interior bars into the series', async () => {
  const left = denseRun(NOW - 14 * 3600, 300)
  const holeEnd = left[left.length - 1].t + 180 * 60
  const right = denseRun(holeEnd, 300)
  const series = [...left, ...right]
  const fills = denseRun(left[left.length - 1].t + 60, 179) // the missing interior
  const probed = []
  const kv = new Map()
  const out = await refillInteriorHoles(series, {
    intervalSec: 60,
    nowSec: NOW,
    fetchWindow: async (a, b) => { probed.push([a, b]); return fills },
    kvGet: async (k) => kv.get(k) ?? null,
    kvSet: async (k, v) => { kv.set(k, v) },
    keyPrefix: 'test:holeprobe:X:1',
  })
  assert.equal(probed.length, 1)
  assert.equal(out.bars.length, series.length + 179)
  assert.equal(out.filled, 179)
  // series stays sorted, no dupes
  for (let i = 1; i < out.bars.length; i++) assert.ok(out.bars[i].t > out.bars[i - 1].t)
})

await ok('refill never removes or rewrites existing bars', async () => {
  const left = denseRun(NOW - 14 * 3600, 300)
  const holeEnd = left[left.length - 1].t + 180 * 60
  const right = denseRun(holeEnd, 300)
  const series = [...left, ...right]
  // hostile fetch answer: duplicates of existing bars with DIFFERENT values + junk
  const evil = series.slice(0, 50).map(b => ({ ...b, c: 999 }))
  const out = await refillInteriorHoles(series, {
    intervalSec: 60,
    nowSec: NOW,
    fetchWindow: async () => evil,
    kvGet: async () => null,
    kvSet: async () => {},
    keyPrefix: 'test:holeprobe:X:1',
  })
  assert.equal(out.filled, 0)
  assert.deepEqual(out.bars, series) // untouched
})

await ok('empty probe answer sets the negative cache; next call skips the fetch', async () => {
  const left = denseRun(NOW - 14 * 3600, 300)
  const holeEnd = left[left.length - 1].t + 180 * 60
  const right = denseRun(holeEnd, 300)
  const series = [...left, ...right]
  const kv = new Map()
  let fetches = 0
  const deps = {
    intervalSec: 60,
    nowSec: NOW,
    fetchWindow: async () => { fetches++; return [] },
    kvGet: async (k) => kv.get(k) ?? null,
    kvSet: async (k, v) => { kv.set(k, v) },
    keyPrefix: 'test:holeprobe:X:1',
  }
  const first = await refillInteriorHoles(series, deps)
  assert.equal(first.filled, 0)
  assert.equal(fetches, 1)
  const second = await refillInteriorHoles(series, deps)
  assert.equal(fetches, 1) // negative-cached, no second Codex call
  assert.equal(second.filled, 0)
})

await ok('a failing probe leaves the series unchanged (never throws)', async () => {
  const left = denseRun(NOW - 14 * 3600, 300)
  const holeEnd = left[left.length - 1].t + 180 * 60
  const right = denseRun(holeEnd, 300)
  const series = [...left, ...right]
  const out = await refillInteriorHoles(series, {
    intervalSec: 60,
    nowSec: NOW,
    fetchWindow: async () => { throw new Error('codex down') },
    kvGet: async () => null,
    kvSet: async () => {},
    keyPrefix: 'test:holeprobe:X:1',
  })
  assert.deepEqual(out.bars, series)
  assert.equal(out.filled, 0)
})

await ok('dense series (no holes) makes zero probes', async () => {
  const series = denseRun(NOW - 8 * 3600, 480)
  let fetches = 0
  const out = await refillInteriorHoles(series, {
    intervalSec: 60,
    nowSec: NOW,
    fetchWindow: async () => { fetches++; return [] },
    kvGet: async () => null,
    kvSet: async () => {},
    keyPrefix: 'test:holeprobe:X:1',
  })
  assert.equal(fetches, 0)
  assert.deepEqual(out.bars, series)
})

await ok('at most 2 holes probed per call, oldest first', async () => {
  let bars = denseRun(NOW - 40 * 3600, 120)
  for (let g = 0; g < 4; g++) {
    const holeEnd = bars[bars.length - 1].t + 60 * 60 // 60-bucket holes
    bars = [...bars, ...denseRun(holeEnd, 120)]
  }
  const probed = []
  await refillInteriorHoles(bars, {
    intervalSec: 60,
    nowSec: NOW,
    fetchWindow: async (a, b) => { probed.push([a, b]); return [] },
    kvGet: async () => null,
    kvSet: async () => {},
    keyPrefix: 'test:holeprobe:X:1',
  })
  assert.equal(probed.length, 2)
  assert.ok(probed[0][0] < probed[1][0])
})

await ok('holeRefillIntervalSec: real intervals only, null for 1S/1W/1M/unknown', async () => {
  assert.equal(holeRefillIntervalSec('1'), 60)
  assert.equal(holeRefillIntervalSec('5'), 300)
  assert.equal(holeRefillIntervalSec('60'), 3600)
  assert.equal(holeRefillIntervalSec('1D'), 86400)
  assert.equal(holeRefillIntervalSec('1S'), null)  // parseInt('1S')===1 was mis-scaling to 60s
  assert.equal(holeRefillIntervalSec('1W'), null)
  assert.equal(holeRefillIntervalSec('1M'), null)
  assert.equal(holeRefillIntervalSec('7'), null)   // not a chart resolution we serve
})

await ok('a failing probe is paced by the pending stamp - no immediate re-probe', async () => {
  const left = denseRun(NOW - 14 * 3600, 300)
  const holeEnd = left[left.length - 1].t + 180 * 60
  const series = [...left, ...denseRun(holeEnd, 300)]
  const kv = new Map()
  let fetches = 0
  const deps = {
    intervalSec: 60,
    nowSec: NOW,
    fetchWindow: async () => { fetches++; throw new Error('codex 502') },
    kvGet: async (k) => kv.get(k) ?? null,
    kvSet: async (k, v) => { kv.set(k, v) },
    keyPrefix: 'test:holeprobe:X:1',
  }
  await refillInteriorHoles(series, deps)
  assert.equal(fetches, 1)
  await refillInteriorHoles(series, deps)
  assert.equal(fetches, 1) // pending stamp still in KV -> paced, no new Codex call
})

await ok('a probe slower than the budget returns unhealed, and the stamp paces the retry', async () => {
  const left = denseRun(NOW - 14 * 3600, 300)
  const holeEnd = left[left.length - 1].t + 180 * 60
  const series = [...left, ...denseRun(holeEnd, 300)]
  const kv = new Map()
  let fetches = 0
  const deps = {
    intervalSec: 60,
    nowSec: NOW,
    budgetMs: 10,
    fetchWindow: async () => { fetches++; await new Promise(r => setTimeout(r, 50)); return [] },
    kvGet: async (k) => kv.get(k) ?? null,
    kvSet: async (k, v) => { kv.set(k, v) },
    keyPrefix: 'test:holeprobe:X:1',
  }
  const out = await refillInteriorHoles(series, deps)
  assert.deepEqual(out.bars, series)
  assert.equal(out.filled, 0)
  const again = await refillInteriorHoles(series, deps)
  assert.equal(fetches, 1) // stamped before the fetch -> the next build does not re-probe
  assert.equal(again.filled, 0)
})

await ok('a hole wider than the Codex datapoint cap is never probed', async () => {
  const left = denseRun(NOW - 40 * 3600, 300)
  const holeEnd = left[left.length - 1].t + 1500 * 60 // 1500 buckets > cap
  const series = [...left, ...denseRun(holeEnd, 300)]
  let fetches = 0
  const out = await refillInteriorHoles(series, {
    intervalSec: 60,
    nowSec: NOW,
    fetchWindow: async () => { fetches++; return [] },
    kvGet: async () => null,
    kvSet: async () => {},
    keyPrefix: 'test:holeprobe:X:1',
  })
  assert.equal(fetches, 0)
  assert.deepEqual(out.bars, series)
})

await ok('merge respects maxBars (keeps the newest)', async () => {
  const left = denseRun(NOW - 14 * 3600, 300)
  const holeEnd = left[left.length - 1].t + 180 * 60
  const series = [...left, ...denseRun(holeEnd, 300)]
  const fills = denseRun(left[left.length - 1].t + 60, 179)
  const out = await refillInteriorHoles(series, {
    intervalSec: 60,
    nowSec: NOW,
    maxBars: 700,
    fetchWindow: async () => fills,
    kvGet: async () => null,
    kvSet: async () => {},
    keyPrefix: 'test:holeprobe:X:1',
  })
  assert.equal(out.bars.length, 700)
  assert.equal(out.bars[out.bars.length - 1].t, series[series.length - 1].t) // newest kept
})

console.log(`\n${passed} tests passed`)
