// Interior-gap detection for chart series (the upstream backfill-lag class,
// 2026-08-14 TOAD). When the bars provider (Codex) has an ingestion outage it
// serves a series with a multi-hour interior hole, then BACKFILLS the missing
// bars later - but an open chart session never re-checks old windows, so the
// user keeps staring at a hole that no longer exists upstream. These helpers
// find gaps that look like an outage (dense trading on BOTH borders - a thin
// token's natural no-trade gaps never qualify) so the datafeed can re-fetch
// just those windows and heal the series in place.
//
// Pure module - no DOM, no imports - so it stays testable from node:
//   node apps/trading/src/lib/__tests__/chartGapHeal.test.mjs

// A border must have at least this many buckets of context before its density
// says anything; younger borders are skipped (the next sweep re-judges them).
const MIN_BORDER_BUCKETS = 8

function densityAround(bars, idx, stepMs, borderBars, dir) {
  // dir -1: window (bars[idx].time - borderBars*step, bars[idx].time]
  // dir +1: window [bars[idx].time, bars[idx].time + borderBars*step)
  const edge = bars[idx].time
  const span = borderBars * stepMs
  let count = 0
  if (dir < 0) {
    for (let i = idx; i >= 0 && edge - bars[i].time < span; i--) count++
    // Denominator: how much of the window the series can even cover.
    const avail = Math.min(borderBars, Math.floor((edge - bars[0].time) / stepMs) + 1)
    return avail < MIN_BORDER_BUCKETS ? -1 : count / avail
  }
  for (let i = idx; i < bars.length && bars[i].time - edge < span; i++) count++
  const avail = Math.min(borderBars, Math.floor((bars[bars.length - 1].time - edge) / stepMs) + 1)
  return avail < MIN_BORDER_BUCKETS ? -1 : count / avail
}

/**
 * Scan a sorted bar series (TVA shape: { time } in ms) for interior gaps that
 * look like a provider outage rather than a token that simply didn't trade.
 *
 * @param {Array<{time:number}>} bars sorted ascending by time (ms)
 * @param {number} resSec bar interval in seconds
 * @param {object} opts
 *   minGapBuckets   gap must span at least this many buckets (default 10)
 *   borderBars      density window on each side, in buckets (default 30)
 *   minBorderDensity bars-per-bucket both sides must clear (default 0.6)
 *   maxAgeSec       gap's RIGHT edge must be younger than this (default 48h) -
 *                   outage holes worth healing are recent by definition, and
 *                   this keeps old legitimate quiet periods off the re-check list
 *   nowMs           clock override for tests
 *   maxGaps         cap on returned gaps, oldest first (default 3)
 * @returns {Array<{startMs:number, endMs:number, buckets:number}>}
 */
export function findAnomalousGaps(bars, resSec, opts = {}) {
  const {
    minGapBuckets = 10,
    borderBars = 30,
    minBorderDensity = 0.6,
    maxAgeSec = 48 * 3600,
    nowMs = Date.now(),
    maxGaps = 3,
  } = opts
  if (!Array.isArray(bars) || bars.length < 2 || !(resSec > 0)) return []
  const stepMs = resSec * 1000
  const out = []
  for (let i = 1; i < bars.length && out.length < maxGaps; i++) {
    const gapMs = bars[i].time - bars[i - 1].time
    if (gapMs < minGapBuckets * stepMs) continue
    if ((nowMs - bars[i].time) / 1000 > maxAgeSec) continue
    if (densityAround(bars, i - 1, stepMs, borderBars, -1) < minBorderDensity) continue
    if (densityAround(bars, i, stepMs, borderBars, +1) < minBorderDensity) continue
    out.push({ startMs: bars[i - 1].time, endMs: bars[i].time, buckets: Math.round(gapMs / stepMs) })
  }
  return out
}

/**
 * Retry policy for one gap's heal probes. The original design gave each gap a
 * hard 2-probe budget - but during a Codex outage the LIVE edge recovers first
 * and history backfills 30min-hours later, so both probes fired (and failed)
 * within ~5 minutes of the gap qualifying, then the gap latched "real" for
 * the whole session while upstream quietly healed (WENFROG 2026-08-20). The
 * first `fastAttempts` probes stay immediate; after that a probe is allowed
 * again every `retryMs` (the gap is still outage-shaped and <48h old, or the
 * detector would have dropped it), up to `maxAttempts` total.
 *
 * @param {{count:number, lastMs:number}|undefined} entry probe ledger for the gap
 * @param {number} nowMs
 */
export function gapProbeAllowed(entry, nowMs, opts = {}) {
  const { fastAttempts = 2, retryMs = 10 * 60_000, maxAttempts = 12 } = opts
  if (!entry || entry.count < fastAttempts) return true
  if (entry.count >= maxAttempts) return false
  return nowMs - entry.lastMs >= retryMs
}

/**
 * How many bars of `healed` fall STRICTLY inside the gap and are not already
 * in `existing`. The heal only counts when the re-fetch actually produced new
 * interior bars - edges and already-known bars prove nothing.
 */
export function countNewInteriorBars(existing, healed, gap) {
  if (!Array.isArray(healed) || healed.length === 0) return 0
  const known = new Set()
  for (const b of existing) {
    if (b && b.time > gap.startMs && b.time < gap.endMs) known.add(b.time)
  }
  let n = 0
  for (const b of healed) {
    if (b && b.time > gap.startMs && b.time < gap.endMs && !known.has(b.time)) n++
  }
  return n
}
