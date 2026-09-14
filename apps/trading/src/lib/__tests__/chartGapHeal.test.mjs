// Node test for chartGapHeal.js (pure module, no DOM).
// Run: node apps/trading/src/lib/__tests__/chartGapHeal.test.mjs
import assert from 'node:assert/strict'
import { findAnomalousGaps, countNewInteriorBars, gapProbeAllowed } from '../chartGapHeal.js'

const MIN = 60_000
let passed = 0
function ok(name, fn) {
  fn()
  passed++
  console.log('ok -', name)
}

// Build a 1m series: dense run, then a hole, then dense run again.
// Times in ms (TVA bar shape uses .time in ms).
function denseRun(startMs, buckets, stepMs = MIN) {
  const out = []
  for (let i = 0; i < buckets; i++) out.push({ time: startMs + i * stepMs, close: 1 })
  return out
}

const NOW = 1_786_720_000_000 // fixed "now" for deterministic tests

ok('finds a 3h hole in a dense 1m series', () => {
  const left = denseRun(NOW - 14 * 3600_000, 300)            // dense pre-hole
  const holeEndStart = left[left.length - 1].time + 180 * MIN // 180-bucket hole
  const right = denseRun(holeEndStart, 300)
  const gaps = findAnomalousGaps([...left, ...right], 60, { nowMs: NOW })
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].startMs, left[left.length - 1].time)
  assert.equal(gaps[0].endMs, holeEndStart)
  assert.equal(gaps[0].buckets, 180)
})

ok('ignores the same hole when the borders are sparse (thin token)', () => {
  // ~1 bar every 5 minutes on both sides: natural no-trade gaps, not an outage.
  const sparse = (startMs, n) => denseRun(startMs, n, 5 * MIN)
  const left = sparse(NOW - 30 * 3600_000, 60)
  const holeEnd = left[left.length - 1].time + 180 * MIN
  const right = sparse(holeEnd, 60)
  const gaps = findAnomalousGaps([...left, ...right], 60, { nowMs: NOW })
  assert.equal(gaps.length, 0)
})

ok('ignores holes older than maxAgeSec', () => {
  const left = denseRun(NOW - 80 * 3600_000, 300)
  const holeEnd = left[left.length - 1].time + 180 * MIN
  const right = denseRun(holeEnd, 300) // right edge ~74h ago > 48h default
  const gaps = findAnomalousGaps([...left, ...right], 60, { nowMs: NOW })
  assert.equal(gaps.length, 0)
})

ok('ignores small gaps (< minGapBuckets)', () => {
  const left = denseRun(NOW - 5 * 3600_000, 120)
  const holeEnd = left[left.length - 1].time + 5 * MIN // 5-bucket gap
  const right = denseRun(holeEnd, 120)
  const gaps = findAnomalousGaps([...left, ...right], 60, { nowMs: NOW })
  assert.equal(gaps.length, 0)
})

ok('ignores a gap right after the first bar (no left border to judge)', () => {
  const first = [{ time: NOW - 10 * 3600_000, close: 1 }]
  const right = denseRun(first[0].time + 180 * MIN, 300)
  const gaps = findAnomalousGaps([...first, ...right], 60, { nowMs: NOW })
  assert.equal(gaps.length, 0)
})

ok('returns at most maxGaps, oldest first', () => {
  let bars = denseRun(NOW - 40 * 3600_000, 120)
  for (let g = 0; g < 5; g++) {
    const holeEnd = bars[bars.length - 1].time + 60 * MIN
    bars = [...bars, ...denseRun(holeEnd, 120)]
  }
  const gaps = findAnomalousGaps(bars, 60, { nowMs: NOW, maxGaps: 2 })
  assert.equal(gaps.length, 2)
  assert.ok(gaps[0].startMs < gaps[1].startMs)
})

ok('countNewInteriorBars counts only strictly-interior, genuinely-new bars', () => {
  const left = denseRun(NOW - 10 * 3600_000, 60)
  const gapStart = left[left.length - 1].time
  const gapEnd = gapStart + 120 * MIN
  const existing = [...left, ...denseRun(gapEnd, 60)]
  const gap = { startMs: gapStart, endMs: gapEnd }
  // healed answer: the gap edges (already known) + 30 new interior bars
  const healed = [
    { time: gapStart, close: 1 },            // edge - not new
    ...denseRun(gapStart + 10 * MIN, 30),    // interior - new
    { time: gapEnd, close: 1 },              // edge - not new
  ]
  assert.equal(countNewInteriorBars(existing, healed, gap), 30)
  assert.equal(countNewInteriorBars(existing, [], gap), 0)
  // re-counting the same healed bars after a merge yields 0
  const merged = [...existing, ...healed]
  assert.equal(countNewInteriorBars(merged, healed, gap), 0)
})

// --- gapProbeAllowed: retry policy for a gap's heal probes -----------------
// The 2026-08-14 heal burned its 2 attempts within ~5 minutes while Codex's
// history backfill takes 30min-hours -> the gap latched for the session
// (WENFROG 2026-08-20). Probes must RETRY on a slow cadence, not latch.

ok('first probes are allowed immediately (fast attempts)', () => {
  assert.equal(gapProbeAllowed(undefined, NOW), true)
  assert.equal(gapProbeAllowed({ count: 1, lastMs: NOW - 1000 }, NOW), true)
})

ok('after fast attempts are spent, a probe is blocked until retryMs elapses', () => {
  const spent = { count: 2, lastMs: NOW - 5 * MIN }
  assert.equal(gapProbeAllowed(spent, NOW), false) // only 5 min since last probe
  const later = { count: 2, lastMs: NOW - 10 * MIN }
  assert.equal(gapProbeAllowed(later, NOW), true)  // 10 min elapsed -> retry
})

ok('probes stop for good at maxAttempts', () => {
  const capped = { count: 12, lastMs: NOW - 24 * 3600_000 }
  assert.equal(gapProbeAllowed(capped, NOW), false)
})

console.log(`\n${passed} tests passed`)
