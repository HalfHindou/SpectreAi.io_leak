/**
 * Trigger evaluation - pure decision logic, no IO. The loop in index.js
 * feeds it live prices; it answers "does this order fire NOW, and which
 * tranche". Wick protection: a condition must hold for N consecutive
 * evaluations spanning >= MIN_HOLD_MS before firing; post-fire re-arm
 * requires a 100bps recross (oscillation guard, DCA tranches also gated
 * by minIntervalSec).
 */

const CONSECUTIVE_TICKS = 3
const MIN_HOLD_MS = 5_000
const REARM_BPS = 100
// A price older than this NEVER fires an order - a frozen feed would
// otherwise pass the wick filter trivially (same stale value 3 ticks in a
// row) and execute real money on minutes-old data.
const MAX_PRICE_AGE_MS = 90_000

// orderId -> { ticks, firstTickTs, lastFiredAt, rearmed }
const _state = new Map()

function stateFor(id) {
  let s = _state.get(id)
  if (!s) { s = { ticks: 0, firstTickTs: 0, lastFiredAt: 0, rearmed: true }; _state.set(id, s) }
  return s
}

function dropState(id) { _state.delete(id) }

/** Metric value for the order: price, or mcap re-derived from LIVE supply. */
function metricValue(order, live) {
  if (order.trigger.metric === 'price') return { value: live.priceUsd, supplyUsed: null, supplySource: null }
  const supply = Number(live.supply) > 0 ? Number(live.supply) : Number(order.trigger.supplyAtCreate) > 0 ? Number(order.trigger.supplyAtCreate) : null
  if (!supply) return { value: null }
  return {
    value: live.priceUsd * supply,
    supplyUsed: supply,
    supplySource: Number(live.supply) > 0 ? 'live-circulating' : 'supply_stale_fallback',
  }
}

function conditionMet(order, value, threshold) {
  return order.trigger.op === 'gte' ? value >= threshold : value <= threshold
}

/** DCA band for the next unfilled tranche: [min..max] split into N equal
    bands; tranche i (0-based, filling from the range edge nearest the
    trigger direction) fires when the metric enters its band. */
function trancheBand(order) {
  const { min, max } = order.range
  const n = order.dca.tranches
  const i = order.dca.filledTranches
  if (i >= n) return null
  const width = (max - min) / n
  // Buy-the-dip fills top-down (first tranche at the top of the range);
  // op gte (breakout accumulation) fills bottom-up.
  const idx = order.trigger.op === 'lte' ? n - 1 - i : i
  return { low: min + idx * width, high: min + (idx + 1) * width, tranche: i }
}

/**
 * Evaluate one order against live data.
 * Returns { fire: false } or
 *   { fire: true, tranche, metricNow, supplyUsed, supplySource }
 */
function evaluate(order, live, now = Date.now()) {
  if (!live || live.priceUsd == null) return { fire: false, reason: 'no_price' }
  if (!Number.isFinite(live.priceTs) || now - live.priceTs > MAX_PRICE_AGE_MS) {
    return { fire: false, reason: 'stale_price' }
  }
  if (order.expiresAt && now > order.expiresAt) return { fire: false, expired: true }

  const m = metricValue(order, live)
  if (m.value == null) return { fire: false, reason: 'no_supply' }

  const s = stateFor(order.id)

  let inZone
  let tranche = 0
  if (order.kind === 'dca') {
    const band = trancheBand(order)
    if (!band) return { fire: false, reason: 'all_tranches_filled' }
    tranche = band.tranche
    inZone = m.value >= band.low && m.value <= band.high
    if (inZone && order.dca.minIntervalSec && s.lastFiredAt && now - s.lastFiredAt < order.dca.minIntervalSec * 1000) {
      return { fire: false, reason: 'tranche_interval' }
    }
  } else {
    inZone = conditionMet(order, m.value, order.trigger.value)
    // Oscillation guard: after a fire, require a recross of REARM_BPS
    // beyond the threshold before this order may fire again.
    if (inZone && !s.rearmed) return { fire: false, reason: 'not_rearmed' }
    if (!inZone && !s.rearmed) {
      const t = order.trigger.value
      const away = order.trigger.op === 'gte' ? m.value <= t * (1 - REARM_BPS / 10000) : m.value >= t * (1 + REARM_BPS / 10000)
      if (away) s.rearmed = true
    }
  }

  if (!inZone) {
    s.ticks = 0
    s.firstTickTs = 0
    return { fire: false }
  }

  // Wick filter: sustained condition only.
  s.ticks++
  if (s.ticks === 1) s.firstTickTs = now
  if (s.ticks < CONSECUTIVE_TICKS || now - s.firstTickTs < MIN_HOLD_MS) {
    return { fire: false, reason: 'debouncing', ticks: s.ticks }
  }

  s.ticks = 0
  s.firstTickTs = 0
  s.lastFiredAt = now
  s.rearmed = false
  return { fire: true, tranche, metricNow: m.value, supplyUsed: m.supplyUsed, supplySource: m.supplySource }
}

/** Re-arm after a TRANSIENT execution failure so the order retries while
    still in-zone (a fire consumed `rearmed`; without this, one infra blip
    stalls the order until price exits and re-enters the zone). Resetting
    the tick counter makes the wick filter (3 ticks / 5s) the natural
    retry backoff. Bounded by the caller's consecutive-failure cap. */
function rearmForRetry(id) {
  const s = _state.get(id)
  if (!s) return
  s.rearmed = true
  s.ticks = 0
  s.firstTickTs = 0
}

module.exports = { evaluate, dropState, rearmForRetry, trancheBand, metricValue, CONSECUTIVE_TICKS, MIN_HOLD_MS }
