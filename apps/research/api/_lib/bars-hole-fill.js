/**
 * Server-side interior-hole refill for the bars pipeline (2026-08-20, WENFROG).
 *
 * The upstream backfill-lag class: Codex serves a wide bars answer with a
 * multi-hour interior hole (ingestion outage, fresh-token lag, or a degraded
 * slice under concurrent load - the TOSHI measurement showed wide slices
 * degrade while a SOLO narrow re-query of the same window is stable and
 * dense). Users then stare at a hole the upstream may already be able to
 * fill. Instead of shipping the hole to every client, the router re-asks
 * Codex for JUST the hole window at serve time and merges the answer in.
 *
 * Cost discipline (the Aug-12 ingestion-key incident is the cautionary tale):
 *   - runs only on live wide probes that already produced bars (the chart
 *     shape), never on narrow live polls or scroll-back pages;
 *   - only when an OUTAGE-SHAPED hole is detected (dense trading on both
 *     borders - a thin token's natural quiet periods never match);
 *   - at most MAX_HOLES probes per request, each a single explicit-window
 *     getTokenBars;
 *   - an unfilled hole is negative-cached in KV for NEG_TTL_SEC so repeated
 *     wide requests during a real outage don't re-probe it (≤2 probes per
 *     token+resolution per 10 min platform-wide, thanks to the shared KV);
 *   - kill switch: BARS_HOLE_REFILL=0 (checked by the caller in bars-router).
 *
 * Pure module - detection and orchestration take every side effect
 * (fetchWindow, kvGet, kvSet, clock) as injected deps, so it stays testable
 * from node:
 *   node apps/research/api/_lib/__tests__/bars-hole-fill.test.mjs
 *
 * Shared byte-identical between apps/research/api/_lib and
 * apps/trading/api/_lib (scripts/check-bars-parity.mjs). Edit the RESEARCH
 * copy, then: cp apps/research/api/_lib/bars-hole-fill.js apps/trading/api/_lib/
 *
 * The detection thresholds mirror the client's chartGapHeal.js
 * (apps/trading/src/lib) - same definition of "outage-shaped" on both ends.
 */

const MIN_BORDER_BUCKETS = 8;

function densityAround(bars, idx, stepSec, borderBars, dir) {
  const edge = bars[idx].t;
  const span = borderBars * stepSec;
  let count = 0;
  if (dir < 0) {
    for (let i = idx; i >= 0 && edge - bars[i].t < span; i--) count++;
    const avail = Math.min(borderBars, Math.floor((edge - bars[0].t) / stepSec) + 1);
    return avail < MIN_BORDER_BUCKETS ? -1 : count / avail;
  }
  for (let i = idx; i < bars.length && bars[i].t - edge < span; i++) count++;
  const avail = Math.min(borderBars, Math.floor((bars[bars.length - 1].t - edge) / stepSec) + 1);
  return avail < MIN_BORDER_BUCKETS ? -1 : count / avail;
}

/**
 * Scan a sorted server bar series ({ t } in SECONDS) for interior holes that
 * look like a provider outage rather than a token that simply didn't trade.
 * Same thresholds as the client detector (chartGapHeal.findAnomalousGaps).
 *
 * @param {Array<{t:number}>} bars sorted ascending by t (sec)
 * @param {number} intervalSec bar interval in seconds
 * @returns {Array<{startSec:number, endSec:number, buckets:number}>}
 */
export function findServerHoles(bars, intervalSec, opts = {}) {
  const {
    minGapBuckets = 10,
    borderBars = 30,
    minBorderDensity = 0.6,
    maxAgeSec = 48 * 3600,
    nowSec = Math.floor(Date.now() / 1000),
    maxHoles = 2,
  } = opts;
  if (!Array.isArray(bars) || bars.length < 2 || !(intervalSec > 0)) return [];
  const out = [];
  for (let i = 1; i < bars.length && out.length < maxHoles; i++) {
    const gap = bars[i].t - bars[i - 1].t;
    if (gap < minGapBuckets * intervalSec) continue;
    if (nowSec - bars[i].t > maxAgeSec) continue;
    if (densityAround(bars, i - 1, intervalSec, borderBars, -1) < minBorderDensity) continue;
    if (densityAround(bars, i, intervalSec, borderBars, +1) < minBorderDensity) continue;
    out.push({ startSec: bars[i - 1].t, endSec: bars[i].t, buckets: Math.round(gap / intervalSec) });
  }
  return out;
}

// Resolutions the refill runs on, with their TRUE bar interval in seconds.
// Deliberately an allowlist, NOT resIntervalSec-style parsing: parseInt('1S')
// is 1 -> "60s" and parseInt('1M') is 1 -> "60s", which would mis-scale the
// density math and turn thin tokens' natural quiet periods into probed
// "outages" (audy review 2026-08-20, finding 1). 1S is excluded on purpose -
// its 5s KV bucket cadence would let even correct probes fire far too often;
// 1W/1M are aggregates. Unknown resolutions return null = refill skipped.
const REFILL_INTERVALS = {
  1: 60, 5: 300, 15: 900, 30: 1800, 60: 3600, 240: 14400, 720: 43200, '1D': 86400,
};
export function holeRefillIntervalSec(requestedRes) {
  return REFILL_INTERVALS[String(requestedRes).toUpperCase()] ?? REFILL_INTERVALS[requestedRes] ?? null;
}

// An unfilled hole is re-probed at most once per NEG_TTL_SEC across the whole
// platform (the negative cache lives in the shared KV).
export const NEG_TTL_SEC = 600;
// A probe is STAMPED into KV before its fetch. If the fetch errors, times out
// past the response budget, or the lambda freezes mid-flight, the stamp still
// paces the retry - without it a deterministic failure would re-probe at build
// cadence forever (audy review 2026-08-20, findings 2-3).
export const PENDING_TTL_SEC = 120;
// A probe must produce at least this many strictly-interior new bars to count
// as a fill (edges and already-known bars prove nothing).
const MIN_NEW_BARS = 3;
// Total wall-clock budget for the probes - a slow Codex must not slow every
// holed load; on timeout the answer ships as-is (the pending stamp paces the
// retry, and the client's gap-heal picks the healed KV entry up later).
const PROBE_BUDGET_MS = 2500;
// Explicit windows above ~1500 datapoints are a HARD Codex error (the
// 2026-08-11 PAAL class, see handlers/bars.js) - never ask for one.
const MAX_PROBE_BUCKETS = 1400;

/**
 * Detect outage-shaped interior holes in `bars` and try to refill each from
 * `fetchWindow(fromSec, toSec)` (an explicit-window Codex getTokenBars).
 * ADDITIVE by construction: only bars strictly inside a detected hole are
 * merged; existing bars are never removed or rewritten. Never throws.
 *
 * @param {Array<{t:number}>} bars sorted ascending
 * @param {object} deps { intervalSec, fetchWindow, kvGet, kvSet, keyPrefix,
 *                        nowSec?, budgetMs?, maxBars? }
 * @returns {Promise<{bars:Array, filled:number, holesOpen:number}>}
 */
export async function refillInteriorHoles(bars, deps) {
  const {
    intervalSec, fetchWindow, kvGet, kvSet, keyPrefix,
    nowSec = Math.floor(Date.now() / 1000),
    budgetMs = PROBE_BUDGET_MS,
    maxBars = Infinity,
  } = deps;
  const holes = findServerHoles(bars, intervalSec, { nowSec });
  if (holes.length === 0) return { bars, filled: 0, holesOpen: 0 };

  const known = new Set(bars.map((b) => b.t));
  let filled = 0;
  let holesOpen = 0;

  const probes = holes.map(async (hole) => {
    if (hole.buckets + 3 > MAX_PROBE_BUCKETS) { holesOpen++; return []; }
    const negKey = `${keyPrefix}:${hole.startSec}`;
    try {
      if (await kvGet(negKey)) { holesOpen++; return []; } // probed recently (pending or empty)
    } catch { /* KV read is best-effort */ }
    // Stamp BEFORE the fetch: whatever happens to this probe (error, response
    // deadline, frozen lambda), the next build within PENDING_TTL_SEC skips it.
    try { await kvSet(negKey, { at: nowSec, pending: true }, PENDING_TTL_SEC); } catch { /* best-effort */ }
    try {
      const answer = await fetchWindow(hole.startSec - intervalSec, hole.endSec + intervalSec);
      const fills = (Array.isArray(answer) ? answer : []).filter(
        (b) => b && Number.isFinite(b.t) && b.t > hole.startSec && b.t < hole.endSec && !known.has(b.t),
      );
      if (fills.length < MIN_NEW_BARS) {
        holesOpen++;
        try { await kvSet(negKey, { at: nowSec, empty: true }, NEG_TTL_SEC); } catch { /* best-effort */ }
        return [];
      }
      filled += fills.length;
      return fills;
    } catch {
      holesOpen++; // pending stamp paces the retry
      return [];
    }
  });

  let deadlineTimer;
  const deadline = new Promise((resolve) => { deadlineTimer = setTimeout(resolve, budgetMs, 'timeout'); });
  const raced = await Promise.race([Promise.all(probes), deadline]).finally(() => clearTimeout(deadlineTimer));
  if (raced === 'timeout') return { bars, filled: 0, holesOpen: holes.length };

  const extra = raced.flat();
  if (extra.length === 0) return { bars, filled: 0, holesOpen };
  let merged = [...bars, ...extra].sort((a, b) => a.t - b.t);
  if (merged.length > maxBars) merged = merged.slice(-maxBars);
  return { bars: merged, filled, holesOpen };
}
