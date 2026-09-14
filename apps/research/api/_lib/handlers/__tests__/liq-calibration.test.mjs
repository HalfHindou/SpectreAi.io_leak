// apps/research/api/_lib/handlers/__tests__/liq-calibration.test.mjs
// Run with: node apps/research/api/_lib/handlers/__tests__/liq-calibration.test.mjs
import assert from 'node:assert'
import { calibrateSideTiers, LEV_TIERS } from '../liq-heatmap-binance.js'

// Grid: prices 100..260 in 160 rows of step 1.
const rows = 160
const minP = 100
const binOf = (p) => Math.floor(p - minP)
// Volume profile concentrated at price 200 (rows 95..105).
const VP = new Float64Array(rows)
for (let r = 95; r <= 105; r++) VP[r] = 1000

// Synthetic long-liq events at price 180: entry≈200 implies 1/L ≈ (200-180)/200 = 10% → 10x.
// (MAINT_MARGIN shifts this slightly; the 10x tier must still dominate.)
const events = Array.from({ length: 200 }, (_, i) => ({ t: i, p: 180, side: 'long', usd: 1000, ex: 'bybit' }))

const tiers = calibrateSideTiers(events, 'long', binOf, VP, rows, LEV_TIERS)
assert.ok(tiers, 'enough events → calibrated tiers')
assert.equal(tiers.length, LEV_TIERS.length)
const sum = tiers.reduce((a, t) => a + t.w, 0)
assert.ok(Math.abs(sum - 1) < 1e-9, 'weights normalized')
const w10 = tiers.find(t => t.lev === 10).w
const static10 = LEV_TIERS.find(t => t.lev === 10).w
assert.ok(w10 > static10, `10x weight lifted by calibration (${w10} > ${static10})`)
const wMax = Math.max(...tiers.map(t => t.w))
assert.equal(tiers.find(t => t.w === wMax).lev, 10, '10x is the dominant calibrated tier')

// Too few events → null (caller keeps static tiers)
assert.equal(calibrateSideTiers(events.slice(0, 20), 'long', binOf, VP, rows, LEV_TIERS), null)
// Wrong side filtered out → null
assert.equal(calibrateSideTiers(events, 'short', binOf, VP, rows, LEV_TIERS), null)
// Events whose implied entries all miss the VP → null
const farEvents = Array.from({ length: 200 }, (_, i) => ({ t: i, p: 500, side: 'long', usd: 1, ex: 'okx' }))
assert.equal(calibrateSideTiers(farEvents, 'long', binOf, VP, rows, LEV_TIERS), null)

console.log('liq-calibration.test.mjs OK')
