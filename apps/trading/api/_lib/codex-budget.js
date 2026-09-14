/**
 * Daily Codex budget guard (charts-v2, GROUP 2 / Charts S7).
 *
 * Reads today's TOTAL Codex query count straight from the same daily counter
 * that codex-metrics-kv.js maintains (`HGET codex:m:<YYYY-MM-DD UTC> total:queries`)
 * and maps it onto a three-state budget:
 *
 *   ok    < CODEX_BUDGET_SOFT   normal operation
 *   soft  >= CODEX_BUDGET_SOFT  degrade FRESHNESS (stretch Codex KV TTL for
 *                               sub-5-min resolutions) before degrading
 *                               availability — chart still serves fresh bars
 *   hard  >= CODEX_BUDGET_HARD  Codex tier goes CACHE-ONLY + stale-if-error:
 *                               serve fresh KV / stale mirror only, never spend
 *                               a fresh getBars op
 *
 * Budget is global per UTC day (the codex:m counter is incremented by every
 * Codex caller — bars.js, the UDF handler, the codex proxy, dossier, etc.), so
 * this throttles the marginal getBars spend across the whole fleet, not per
 * lambda. The hard ceiling backstops the <=15-20K ops/day TOTAL budget the
 * charts pipeline is designed to live inside.
 *
 * FAIL-OPEN: any read error (no KV env, Upstash down, malformed reply) returns
 * { state: 'ok' } so a metrics outage can never blank charts. The counter is
 * advisory cost-shaping, not a correctness gate.
 *
 * Per-lambda memoization (30s) keeps this off the hot path: at 60 req/min/IP a
 * single warm lambda would otherwise HGET on every bars request. One read per
 * 30s per lambda is plenty given the counter only crosses a threshold once per
 * day.
 */

// Mirror codex-metrics-kv.js's REST env resolution so we read the SAME Upstash
// database it writes the counter to. Also accept the STORAGE-prefixed names the
// live Vercel marketplace integration injects (see _lib/kv.js header) so a
// future env-name swap doesn't silently disable the guard.
const REST_URL =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.STORAGE_KV_REST_API_URL;
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.STORAGE_KV_REST_API_TOKEN;

// Same key/field shape codex-metrics-kv.js writes: `codex:m:<YYYY-MM-DD>` hash,
// `total:queries` field. UTC day to match its _todayUTC().
const COUNTER_FIELD = 'total:queries';
function _dayKey() {
  return `codex:m:${new Date().toISOString().slice(0, 10)}`;
}

function _soft() {
  const v = parseInt(process.env.CODEX_BUDGET_SOFT, 10);
  return Number.isFinite(v) && v > 0 ? v : 12000;
}
function _hard() {
  const v = parseInt(process.env.CODEX_BUDGET_HARD, 10);
  return Number.isFinite(v) && v > 0 ? v : 18000;
}

const MEMO_TTL_MS = 30_000;
let _memo = null; // { state, count, expiresAt }

/**
 * Read today's total Codex query count via a single Upstash REST HGET, the same
 * envelope codex-metrics-kv._exec uses (POST a command array to REST_URL).
 * Returns a finite count, or null on any failure (caller fails open).
 */
async function _readCount() {
  if (!REST_URL || !REST_TOKEN) return null;
  try {
    const res = await fetch(REST_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['HGET', _dayKey(), COUNTER_FIELD]),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    // Upstash REST returns { result: "12345" } or { result: null } for a missing
    // field. parseInt(null) -> NaN -> treated as 0 (no spend yet today).
    const n = parseInt(json?.result, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return null;
  }
}

function _classify(count) {
  if (count >= _hard()) return 'hard';
  if (count >= _soft()) return 'soft';
  return 'ok';
}

/**
 * Current Codex budget state for this UTC day.
 *
 * @returns {Promise<{ state: 'ok'|'soft'|'hard', count: number }>}
 *   `count` is the last-read total (0 when unknown). FAIL-OPEN: state is 'ok'
 *   whenever the count can't be read.
 */
export async function getBudgetState() {
  const now = Date.now();
  if (_memo && now < _memo.expiresAt) {
    return { state: _memo.state, count: _memo.count };
  }
  const count = await _readCount();
  if (count == null) {
    // Memoize the fail-open result too so a hard KV outage doesn't HGET on
    // every request — still re-probes every 30s in case KV recovers.
    _memo = { state: 'ok', count: 0, expiresAt: now + MEMO_TTL_MS };
    return { state: 'ok', count: 0 };
  }
  const state = _classify(count);
  _memo = { state, count, expiresAt: now + MEMO_TTL_MS };
  return { state, count };
}

export const __test__ = { _classify, _dayKey, _readCount, _soft, _hard };
