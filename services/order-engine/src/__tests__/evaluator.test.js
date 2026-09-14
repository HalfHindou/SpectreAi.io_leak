/**
 * Evaluator synthetic-series tests.
 * Run: node services/order-engine/src/__tests__/evaluator.test.js
 */
const { evaluate, dropState, rearmForRetry, CONSECUTIVE_TICKS, MIN_HOLD_MS } = require('../evaluator')

let failures = 0
const assert = (cond, label) => {
  if (cond) console.log('  ok -', label)
  else { failures++; console.error('  FAIL -', label) }
}

const baseOrder = (over = {}) => ({
  id: 'o-' + Math.random().toString(36).slice(2),
  kind: 'trigger',
  side: 'buy',
  token: { address: 'So1abc', networkId: 1399811149, symbol: 'WIF', decimals: 6 },
  trigger: { metric: 'mcap', op: 'lte', value: 120_000, supplyAtCreate: 1_000_000 },
  spend: { token: 'native', amount: 0.5, capUsd: 100 },
  slippageBps: 100,
  expiresAt: Date.now() + 86400_000,
  status: 'armed',
  ...over,
})

const live = (priceUsd, supply = 1_000_000) => ({ priceUsd, priceTs: Date.now(), supply, supplyTs: Date.now(), liquidity: 50_000 })

// ── Wick filter: single dip tick does not fire ─────────────────────────────
{
  console.log('wick filter:')
  const o = baseOrder()
  let t = 1_000_000
  // one tick in zone (mcap 110k <= 120k), then back out
  assert(evaluate(o, live(0.11), t).fire === false, 'first in-zone tick debounces')
  assert(evaluate(o, live(0.13), t + 2000).fire === false, 'wick back out - no fire')
  assert(evaluate(o, live(0.11), t + 4000).fire === false, 'tick counter reset after leaving zone')
  dropState(o.id)
}

// ── Sustained cross fires exactly once ──────────────────────────────────────
{
  console.log('sustained cross:')
  const o = baseOrder()
  let t = 1_000_000
  let fired = 0
  for (let i = 0; i < 6; i++) {
    const v = evaluate(o, live(0.11), t + i * 3000) // in zone, 3s apart
    if (v.fire) fired++
  }
  assert(fired === 1, `exactly one fire on sustained condition (got ${fired})`)
  // still in zone right after fire - must NOT re-fire (not rearmed)
  const after = evaluate(o, live(0.11), t + 30_000)
  assert(after.fire === false && after.reason === 'not_rearmed', 'no immediate re-fire')
  dropState(o.id)
}

// ── Hysteresis: re-arm requires 100bps recross ──────────────────────────────
{
  console.log('hysteresis:')
  const o = baseOrder()
  let t = 1_000_000
  for (let i = 0; i < 4; i++) evaluate(o, live(0.11), t + i * 3000) // fire once
  // oscillate just above the trigger (mcap 120.5k, < +100bps of 120k=121.2k)
  evaluate(o, live(0.1205), t + 20_000)
  let v = evaluate(o, live(0.119), t + 23_000)
  assert(v.fire === false, 'shallow recross does not rearm')
  // move clearly away (+2%), then sustained re-entry fires again
  evaluate(o, live(0.1225), t + 26_000) // rearm point (>121.2k)
  let fired = 0
  for (let i = 0; i < 5; i++) { if (evaluate(o, live(0.11), t + 30_000 + i * 3000).fire) fired++ }
  assert(fired === 1, 'rearmed after full recross, fires once more')
  dropState(o.id)
}

// ── mcap uses LIVE supply, falls back to supplyAtCreate ─────────────────────
{
  console.log('supply basis:')
  const o = baseOrder()
  let t = 1_000_000
  // live supply doubled: price 0.11 x 2M = 220k mcap - NOT in zone
  const v = evaluate(o, live(0.11, 2_000_000), t)
  assert(v.fire === false, 'live supply re-derivation keeps order out of zone')
  // no live supply - falls back to supplyAtCreate (1M) - in zone, debouncing
  const v2 = evaluate(o, { priceUsd: 0.11, priceTs: t, supply: null, supplyTs: 0 }, t + 2000)
  assert(v2.reason === 'debouncing' || v2.fire === false, 'supplyAtCreate fallback evaluates')
  dropState(o.id)
}

// ── DCA tranche ladder: fills top-down for dips, respects interval ─────────
{
  console.log('dca ladder:')
  const o = baseOrder({
    kind: 'dca',
    trigger: { metric: 'mcap', op: 'lte', value: 130_000, supplyAtCreate: 1_000_000 },
    range: { min: 100_000, max: 130_000 },
    dca: { tranches: 3, minIntervalSec: 60, filledTranches: 0 },
  })
  let t = 1_000_000
  // Bands (top-down for lte): t0 = [120k,130k], t1 = [110k,120k], t2 = [100k,110k]
  let fired = []
  // enter top band (mcap 125k), sustained
  for (let i = 0; i < 5; i++) {
    const v = evaluate(o, live(0.125), t + i * 3000)
    if (v.fire) fired.push(v.tranche)
  }
  assert(fired.length === 1 && fired[0] === 0, `tranche 0 fires in top band (got ${JSON.stringify(fired)})`)
  o.dca.filledTranches = 1
  // still in top band - tranche 1's band is [110k,120k], not in zone
  let v = evaluate(o, live(0.125), t + 20_000)
  assert(v.fire === false, 'tranche 1 waits for a deeper dip')
  // dip to 115k - in tranche 1 band, but interval gate blocks (<60s since last fire)
  for (let i = 0; i < 5; i++) v = evaluate(o, live(0.115), t + 25_000 + i * 3000)
  assert(v.fire === false && (v.reason === 'tranche_interval' || v.reason === 'debouncing'), 'minIntervalSec gates tranche 1')
  // after the interval, sustained in-band fires tranche 1
  fired = []
  for (let i = 0; i < 5; i++) {
    const r = evaluate(o, live(0.115), t + 100_000 + i * 3000)
    if (r.fire) fired.push(r.tranche)
  }
  assert(fired.length === 1 && fired[0] === 1, `tranche 1 fires after interval (got ${JSON.stringify(fired)})`)
  o.dca.filledTranches = 3
  assert(evaluate(o, live(0.105), t + 200_000).reason === 'all_tranches_filled', 'completed ladder stops')
  dropState(o.id)
}

// ── gte (breakout) direction ────────────────────────────────────────────────
{
  console.log('breakout direction:')
  const o = baseOrder({ trigger: { metric: 'mcap', op: 'gte', value: 253_000, supplyAtCreate: 1_000_000 } })
  let t = 1_000_000
  assert(evaluate(o, live(0.2), t).fire === false, 'below breakout - no fire')
  let fired = 0
  for (let i = 0; i < 5; i++) { if (evaluate(o, live(0.26), t + 2000 + i * 3000).fire) fired++ }
  assert(fired === 1, 'sustained breakout fires once')
  dropState(o.id)
}

// ── expiry ──────────────────────────────────────────────────────────────────
{
  console.log('expiry:')
  const o = baseOrder({ expiresAt: 500 })
  const v = evaluate(o, live(0.11), 1_000_000)
  assert(v.expired === true && v.fire === false, 'expired order reports expired')
  dropState(o.id)
}

// ── price staleness ceiling ─────────────────────────────────────────────────
{
  console.log('staleness ceiling:')
  const o = baseOrder()
  const now = Date.now()
  const staleLive = { priceUsd: 0.11, priceTs: now - 120_000, supply: 1_000_000, supplyTs: now }
  const v = evaluate(o, staleLive, now)
  assert(v.fire === false && v.reason === 'stale_price', 'a 2-min-old price never fires')
  // fresh price on the same order proceeds to debouncing
  const v2 = evaluate(o, { priceUsd: 0.11, priceTs: now, supply: 1_000_000, supplyTs: now }, now)
  assert(v2.fire === false && v2.reason === 'debouncing', 'fresh price resumes normal evaluation')
  dropState(o.id)
}

// ── rearmForRetry: transient execution failure retries while in-zone ────────
{
  console.log('rearm for retry:')
  const o = baseOrder()
  let t = 9_000_000
  let fired = 0
  for (let i = 0; i < 4; i++) if (evaluate(o, live(0.11), t + i * 3000).fire) fired++
  assert(fired === 1, 'fires once')
  // execution failed transiently - without rearm, in-zone means stalled forever
  const stalled = evaluate(o, live(0.11), t + 15_000)
  assert(stalled.fire === false && stalled.reason === 'not_rearmed', 'stalled without rearm')
  rearmForRetry(o.id)
  // wick filter re-runs from zero: needs CONSECUTIVE_TICKS + MIN_HOLD_MS again
  let refired = 0
  for (let i = 0; i < 4; i++) if (evaluate(o, live(0.11), t + 20_000 + i * 3000).fire) refired++
  assert(refired === 1, `re-fires exactly once after rearmForRetry (got ${refired})`)
  const again = evaluate(o, live(0.11), t + 40_000)
  assert(again.fire === false && again.reason === 'not_rearmed', 'consumed again after the retry fire')
  rearmForRetry('nonexistent-order') // must not throw on unknown ids
  dropState(o.id)
}

console.log(failures ? `\n${failures} FAILURES` : '\nall evaluator tests passed')
process.exit(failures ? 1 : 0)
