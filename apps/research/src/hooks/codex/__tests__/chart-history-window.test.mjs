// Node tests for the chart history pager's window arithmetic.
// Guards the class that produced rz-chart-audit steps 6-8: a guard sized from
// the wrong window declares live history "exhausted" and latches the wall.
// Pure module - no React, no fetch.
// Run: node apps/research/src/hooks/codex/__tests__/chart-history-window.test.mjs
import assert from 'node:assert/strict'
import {
  DEEP_PAGE_COUNTBACK, MAX_WINDOW_SEC, BARS_EPOCH_SEC,
  isDeepPageEligible, historyWindow, eraCliffToleranceMs,
} from '../chart-history-window.js'

let passed = 0
function ok(name, fn) { fn(); passed++; console.log('ok -', name) }

const HOUR = 3600
const STRIDE_5M = 80 * HOUR       // SCROLLBACK_HOURS['5']
const NOW = 1787000000            // fixed - no Date.now() in tests

ok('deep page is refused for Binance-backed tokens', () => {
  // Direct Binance klines cap at 1000 bars/request and SHORT-FILL beyond it,
  // which splices time holes into an index-plotted canvas.
  assert.equal(isDeepPageEligible({ deep: true, hasBinancePair: true }), false)
  assert.equal(isDeepPageEligible({ deep: true, hasBinancePair: false }), true)
  assert.equal(isDeepPageEligible({ deep: false, hasBinancePair: false }), false)
})

ok('a deep window is wide enough to trip the server wide-probe test', () => {
  // Server: wideProbe when (to - from) > MAX_WINDOW_BARS * intervalSec.
  // Worst case in the table is 1500 bars; check the finest resolutions we
  // actually deep-page, where the old stride fell just short.
  const { windowSec } = historyWindow(NOW, { deep: true, strideSec: STRIDE_5M })
  for (const [res, maxBars, intervalSec] of [['1', 720, 60], ['5', 1000, 300], ['60', 1500, 3600]]) {
    assert.ok(windowSec > maxBars * intervalSec, `${res} deep window must be a wide probe`)
  }
  // ...and the OLD stride at 5m was NOT - this is the whole bug.
  assert.ok(STRIDE_5M <= 1000 * 300, '80h stride sits under the 5m wide-probe line')
})

ok('a narrow page keeps exactly the legacy stride', () => {
  const { fromSec, windowSec } = historyWindow(NOW, { deep: false, strideSec: STRIDE_5M })
  assert.equal(windowSec, STRIDE_5M)
  assert.equal(fromSec, NOW - STRIDE_5M)
})

ok('no page ever asks below the OHLCV epoch', () => {
  const to = BARS_EPOCH_SEC + 10 * HOUR
  const { fromSec } = historyWindow(to, { deep: true, strideSec: STRIDE_5M })
  assert.equal(fromSec, BARS_EPOCH_SEC)
  assert.ok(fromSec > 0)
})

ok('era-cliff tolerance follows the window actually requested', () => {
  const intervalMs = 5 * 60 * 1000
  const narrow = eraCliffToleranceMs(intervalMs, STRIDE_5M)
  const deep = eraCliffToleranceMs(intervalMs, MAX_WINDOW_SEC)
  assert.equal(narrow, STRIDE_5M * 1000)          // stride beats interval*50
  assert.ok(deep > narrow, 'a 3y page must tolerate a 3y-wide quiet stretch')

  // THE REGRESSION this guards. LEO's measured 5m tape has quiet stretches of
  // ~6 days (max gap 8820 min). A deep page spanning 283 days legitimately
  // carries one - but the narrow stride's tolerance is only 80h, so keeping
  // the old sizing would read that quiet stretch as a wrong-era cliff, throw
  // away 1500 good bars AND latch hasMoreHistory=false for the session.
  const quietGapMs = 6 * 24 * HOUR * 1000
  assert.ok(quietGapMs > narrow, 'a 6-day gap breaks the OLD stride tolerance')
  assert.ok(quietGapMs < deep, 'and is inside the deep page it came from')
})

ok('interval floor still applies when the window is tiny', () => {
  // Degenerate/missing window must not collapse the tolerance to zero -
  // that would reject every batch and latch the wall instantly.
  assert.equal(eraCliffToleranceMs(60_000, 0), 60_000 * 50)
  assert.equal(eraCliffToleranceMs(0, 0), 0)
})

ok('countback stays inside the server cap', () => {
  assert.ok(DEEP_PAGE_COUNTBACK > 500, 'must exceed the default or the server ignores it')
  assert.ok(DEEP_PAGE_COUNTBACK <= 1500, 'server hard-caps countback at 1500')
})


// ── Tier-contract seam gate (M87 "битые бары", 2026-08-26) ────────────────
const { isCloseOnlyBatch, heldSeriesHasVolume, seamContractBroken } =
  await import('../chart-history-window.js')

const bar = (t, c, v) => ({ time: t * 1000, open: c, high: c, low: c, close: c, volume: v })
const series = (n, c, v) => Array.from({ length: n }, (_, i) => bar(NOW + i * 14400, c, v))

ok('the server contract alone identifies a close-only batch', () => {
  // cg-ohlc says so explicitly - no guessing needed.
  assert.equal(isCloseOnlyBatch(series(20, 2.7e-6, 0), { volumeAvailable: false }), true)
  assert.equal(isCloseOnlyBatch(series(20, 2.7e-6, 5), { volumeAvailable: false }), true)
})

ok('a real tape is never mistaken for close-only', () => {
  assert.equal(isCloseOnlyBatch(series(20, 3.5e-6, 1200), null), false)
  // GT gap-fill leaves SOME synthetic zero-volume bars - must not trip it
  const gapFilled = series(20, 3.5e-6, 1200)
  gapFilled[3].volume = 0; gapFilled[7].volume = 0; gapFilled[11].volume = 0
  assert.equal(isCloseOnlyBatch(gapFilled, { gapFilled: true, realBarRatio: 0.86 }), false)
})

ok('a short batch is never judged close-only on observation alone', () => {
  // The single codex bar at the M87 seam had no volume but IS real history.
  assert.equal(isCloseOnlyBatch([bar(NOW, 7.3e-7, 0)], null), false)
})

ok('THE M87 REGRESSION: close-only refused only when the held tape has volume', () => {
  const held = series(300, 3.5e-6, 1500)          // geckoterminal, real volume
  const cgOhlc = series(719, 2.7e-6, 0)           // cg-ohlc, volumeAvailable:false
  assert.equal(seamContractBroken({ batchBars: cgOhlc, batchMeta: { volumeAvailable: false }, heldBars: held }), true)

  // ...and a chart that is close-only END TO END keeps paging normally.
  const heldCloseOnly = series(300, 2.7e-6, 0)
  assert.equal(seamContractBroken({ batchBars: cgOhlc, batchMeta: { volumeAvailable: false }, heldBars: heldCloseOnly }), false)
})

ok('a genuine early-life price jump is NOT refused', () => {
  // 26x between adjacent bars is normal for a young token. Ratio is deliberately
  // not part of this gate - only the tier contract is.
  const held = series(300, 3.5e-6, 1500)
  const realButVolatile = series(400, 7.3e-8, 900)   // 48x below, real volume
  assert.equal(seamContractBroken({ batchBars: realButVolatile, batchMeta: null, heldBars: held }), false)
})

ok('held-volume share tolerates a partly synthetic tape', () => {
  const mostlyReal = series(200, 3.5e-6, 1000)
  for (let i = 0; i < 60; i++) mostlyReal[i].volume = 0   // 30% synthetic
  assert.equal(heldSeriesHasVolume(mostlyReal), true)
  assert.equal(heldSeriesHasVolume(series(200, 2.7e-6, 0)), false)
  assert.equal(heldSeriesHasVolume([]), false)
})

console.log(`\n${passed} passed`)
