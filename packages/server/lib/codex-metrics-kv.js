/**
 * Cross-environment Codex metrics persistence on Upstash Redis.
 *
 * Used by:
 *   - packages/server/index.js     (Express dev server)
 *   - apps/research/api/codex.js   (Vercel prod serverless)
 *   - apps/trading/api/codex.js    (Vercel prod serverless, optional)
 *   - developer-control/api/codex-metrics.js (read path)
 *
 * Storage:
 *   codex:m:YYYY-MM-DD  (Redis hash, 100-day TTL)
 *     total:queries          counter
 *     total:subEvents        counter
 *     total:latencyMs        sum  (for avg = sum / total:queries)
 *     q:<op>:calls           counter
 *     q:<op>:errors          counter
 *     q:<op>:latencyMs       sum
 *     s:<type>               counter (subscription events by type)
 *     src:<source>           counter (dev | prod-research | prod-trading)
 *
 *   codex:quota:config (Redis JSON string)
 *     { limit, offset, cycleStart, cycleEnd, note }
 *
 * No external deps - uses Upstash REST API via plain fetch.
 * Failures are logged once and silently dropped (metrics must never crash callers).
 */

const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL_SECONDS = 100 * 24 * 60 * 60;
const QUOTA_KEY = 'codex:quota:config';

// ─── Batched-flush configuration ──────────────────────────────────────────
// Each trackQuery call produced 6 HINCRBY commands against Upstash. At dossier
// volume (~76K Codex calls/day) that's ~458K commands/day, against the 500K
// free-plan ceiling. Batching aggregates same-field increments client-side and
// flushes ONCE per (dayKey, field) per window - typically 100-200x reduction.
//
// Flush window can be tuned via env. Default 10s = at most a 10s metrics lag.
// Long-running processes (Express, dossier worker) get the full benefit;
// short-lived serverless invocations may lose buffered metrics on Lambda
// freeze - that's an acceptable cost vs. blowing through Upstash quota on
// every Codex call. See `flushNow()` for callers that need a guaranteed
// persistence point (e.g. the dashboard read path calls it before HGETALL).
const FLUSH_MS = Math.max(1000, Number(process.env.CODEX_METRICS_FLUSH_MS) || 10000);
let _buffer = new Map(); // dayKey -> Map<field, accumulatedDelta>
const _expireScheduled = new Set(); // dayKeys we've already EXPIRE'd this process
let _flushTimer = null;
let _shutdownRegistered = false;

let _warned = false;
function _kvAvailable() {
  if (REST_URL && REST_TOKEN) return true;
  if (!_warned) {
    console.warn('[codex-metrics-kv] No KV_REST_API_URL/TOKEN env - metrics not persisted to KV');
    _warned = true;
  }
  return false;
}

function _todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function _dayKey(date) {
  return `codex:m:${date}`;
}

async function _pipeline(commands) {
  if (!_kvAvailable() || commands.length === 0) return null;
  try {
    const res = await fetch(`${REST_URL}/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    if (!_warned) {
      console.warn('[codex-metrics-kv] pipeline failed:', err.message);
      _warned = true;
    }
    return null;
  }
}

async function _exec(command) {
  if (!_kvAvailable()) return null;
  try {
    const res = await fetch(REST_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

// ─── Batch buffer plumbing ────────────────────────────────────────────────
function _enqueue(dayKey, field, delta) {
  let fields = _buffer.get(dayKey);
  if (!fields) {
    fields = new Map();
    _buffer.set(dayKey, fields);
  }
  fields.set(field, (fields.get(field) || 0) + delta);
  _ensureFlushTimer();
}

function _ensureFlushTimer() {
  if (_flushTimer) return;
  _flushTimer = setInterval(() => { _flush().catch(() => {}); }, FLUSH_MS);
  // Don't keep the Node event loop alive solely for this interval.
  if (typeof _flushTimer.unref === 'function') _flushTimer.unref();
  if (!_shutdownRegistered) {
    _shutdownRegistered = true;
    // Best-effort flush before process exit. Each handler races against a
    // 1.5s ceiling so we never block PM2's SIGTERM->SIGKILL grace window.
    const flushOnShutdown = () => Promise.race([
      _flush(),
      new Promise((r) => setTimeout(r, 1500)),
    ]).catch(() => {});
    process.once('beforeExit', flushOnShutdown);
    process.once('SIGINT', flushOnShutdown);
    process.once('SIGTERM', flushOnShutdown);
  }
}

async function _flush() {
  if (_buffer.size === 0) return;
  if (!_kvAvailable()) { _buffer.clear(); return; }

  // Hand off the current buffer atomically and start a fresh one so any
  // trackQuery calls during the flush land in the next window.
  const snapshot = _buffer;
  _buffer = new Map();

  const cmds = [];
  for (const [dayKey, fields] of snapshot) {
    for (const [field, delta] of fields) {
      if (delta === 0) continue;
      cmds.push(['HINCRBY', dayKey, field, delta]);
    }
    // EXPIRE only on first flush of each dayKey per process. On any future
    // HINCRBY for the same key, Redis preserves the existing TTL.
    if (!_expireScheduled.has(dayKey)) {
      cmds.push(['EXPIRE', dayKey, TTL_SECONDS]);
      _expireScheduled.add(dayKey);
    }
  }
  if (cmds.length === 0) return;
  await _pipeline(cmds);
}

/**
 * Track a single GraphQL operation. Fire-and-forget.
 * Increments are buffered in-memory and flushed every FLUSH_MS as a single
 * Upstash pipeline with one HINCRBY per (dayKey, field).
 * @param {string} operation - Codex operation name
 * @param {number} latencyMs - request latency in ms
 * @param {boolean} error - whether the call failed
 * @param {string} [source] - 'dev' | 'prod-research' | 'prod-trading' | 'dossier' | 'prod-ovh'
 */
function trackQuery(operation, latencyMs, error = false, source = 'dev') {
  if (!_kvAvailable()) return;
  const key = _dayKey(_todayUTC());
  const op = String(operation || 'unknown').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 80);
  const src = String(source).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32);
  const lat = Math.max(0, Math.round(latencyMs || 0));

  _enqueue(key, 'total:queries', 1);
  _enqueue(key, 'total:latencyMs', lat);
  _enqueue(key, `q:${op}:calls`, 1);
  _enqueue(key, `q:${op}:latencyMs`, lat);
  _enqueue(key, `src:${src}`, 1);
  if (error) {
    _enqueue(key, `q:${op}:errors`, 1);
    _enqueue(key, 'total:errors', 1);
  }
}

/**
 * Track a Codex websocket subscription event. Fire-and-forget. Buffered.
 */
function trackSubscriptionEvent(type, source = 'dev') {
  if (!_kvAvailable()) return;
  const key = _dayKey(_todayUTC());
  const t = String(type || 'unknown').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 80);
  const src = String(source).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32);
  _enqueue(key, 'total:subEvents', 1);
  _enqueue(key, `s:${t}`, 1);
  _enqueue(key, `src:${src}:sub`, 1);
}

/**
 * Force-flush the in-memory buffer. Useful for tests and for the read path
 * (readMetrics) so the dashboard isn't <FLUSH_MS stale on cold reads.
 */
async function flushNow() {
  await _flush();
}

/**
 * Reconstruct an Express-style metrics payload from KV.
 * @param {number} days - how many days of history to load (max 90)
 */
async function readMetrics(days = 7) {
  if (!_kvAvailable()) return null;
  const dayCount = Math.min(Math.max(parseInt(days) || 7, 1), 90);

  // Flush the in-memory buffer first so the dashboard never sees stale data
  // for the current flush window. Errors swallowed - read still works on
  // the prior snapshot if Upstash is briefly unavailable.
  try { await _flush(); } catch {}

  // We need both: (a) the requested `days` window for the chart, and
  // (b) every day in the current billing cycle for quota math.
  const quotaPeek = await _exec(['GET', QUOTA_KEY]);
  let quotaConfig = { limit: 1000000, offset: 0, cycleStart: null, cycleEnd: null, note: '' };
  try { if (quotaPeek?.result) quotaConfig = { ...quotaConfig, ...JSON.parse(quotaPeek.result) }; } catch {}

  // Auto-roll cycle if past end (rolls forward by 1 month, resets offset to 0).
  const todayUTC = _todayUTC();
  if (quotaConfig.cycleEnd && quotaConfig.cycleEnd < todayUTC) {
    const nextStart = quotaConfig.cycleEnd;
    const next = new Date(nextStart + 'T00:00:00Z');
    next.setUTCMonth(next.getUTCMonth() + 1);
    const nextEnd = next.toISOString().slice(0, 10);
    quotaConfig = { ...quotaConfig, offset: 0, offsetSetAt: null, cycleStart: nextStart, cycleEnd: nextEnd };
    await _exec(['SET', QUOTA_KEY, JSON.stringify(quotaConfig)]);
  }

  const cycleStart = quotaConfig.cycleStart || todayUTC;
  const minWindowStart = new Date(Date.now() - (dayCount - 1) * 86400000).toISOString().slice(0, 10);
  const oldestDate = (cycleStart < minWindowStart) ? cycleStart : minWindowStart;

  const start = new Date(oldestDate + 'T00:00:00Z');
  const end = new Date(todayUTC + 'T00:00:00Z');
  const allDayKeys = [];
  for (let d = new Date(end); d >= start; d.setUTCDate(d.getUTCDate() - 1)) {
    const iso = d.toISOString().slice(0, 10);
    allDayKeys.push({ date: iso, key: _dayKey(iso) });
  }

  const pipeline = allDayKeys.map(({ key }) => ['HGETALL', key]);
  const results = await _pipeline(pipeline);
  if (!Array.isArray(results)) return null;

  const dayDataByDate = {};
  for (let i = 0; i < allDayKeys.length; i++) {
    const { date } = allDayKeys[i];
    const raw = results[i]?.result;
    const hash = _hashToObject(raw);
    if (!hash || Object.keys(hash).length === 0) continue;
    dayDataByDate[date] = _parseDayHash(date, hash);
  }

  // History (chart window) — last `dayCount` days, newest first
  const dayKeys = allDayKeys.slice(0, dayCount);
  const history = [];
  for (let i = 0; i < dayKeys.length; i++) {
    const { date } = dayKeys[i];
    if (dayDataByDate[date]) history.push(dayDataByDate[date]);
  }

  // Cycle-scoped tracked total (only days from cycleStart through today).
  let cycleTracked = 0;
  for (const [date, dd] of Object.entries(dayDataByDate)) {
    if (cycleStart && date >= cycleStart) {
      cycleTracked += (dd.totalQueries || 0) + (dd.totalSubEvents || 0);
    }
  }

  const today = dayDataByDate[todayUTC] || { date: todayUTC, queries: {}, subscriptions: {}, sources: {}, totalQueries: 0, totalSubEvents: 0 };

  return {
    today,
    history,
    quota: {
      ...quotaConfig,
      trackedTotal: cycleTracked,
      estimatedUsed: (quotaConfig.offset || 0) + cycleTracked,
    },
    streaming: null,
    optimizations: null,
    source: 'kv',
  };
}

function _parseDayHash(date, hash) {
  const queries = {};
  const subscriptions = {};
  const sources = {};
  let totalQueries = 0;
  let totalSubEvents = 0;
  let totalLatencyMs = 0;
  let totalErrors = 0;

  for (const [field, valueStr] of Object.entries(hash)) {
    const value = parseInt(valueStr) || 0;
    if (field === 'total:queries') totalQueries = value;
    else if (field === 'total:subEvents') totalSubEvents = value;
    else if (field === 'total:latencyMs') totalLatencyMs = value;
    else if (field === 'total:errors') totalErrors = value;
    else if (field.startsWith('q:')) {
      const rest = field.slice(2);
      const lastColon = rest.lastIndexOf(':');
      if (lastColon < 0) continue;
      const op = rest.slice(0, lastColon);
      const metric = rest.slice(lastColon + 1);
      if (!queries[op]) queries[op] = { calls: 0, errors: 0, totalLatencyMs: 0 };
      if (metric === 'calls') queries[op].calls = value;
      else if (metric === 'errors') queries[op].errors = value;
      else if (metric === 'latencyMs') queries[op].totalLatencyMs = value;
    } else if (field.startsWith('s:')) {
      subscriptions[field.slice(2)] = value;
    } else if (field.startsWith('src:')) {
      sources[field.slice(4)] = value;
    }
  }

  for (const op of Object.keys(queries)) {
    const q = queries[op];
    q.avgLatencyMs = q.calls > 0 ? Math.round(q.totalLatencyMs / q.calls) : 0;
  }

  return {
    date,
    queries,
    subscriptions,
    sources,
    totalQueries,
    totalSubEvents,
    totalLatencyMs,
    totalErrors,
    avgLatencyMs: totalQueries > 0 ? Math.round(totalLatencyMs / totalQueries) : 0,
  };
}

function _hashToObject(raw) {
  if (!raw) return null;
  // Upstash REST returns hashes as either an array [k1,v1,k2,v2,...] or an object
  if (Array.isArray(raw)) {
    const out = {};
    for (let i = 0; i < raw.length; i += 2) out[raw[i]] = raw[i + 1];
    return out;
  }
  if (typeof raw === 'object') return raw;
  return null;
}

async function readQuotaConfig() {
  if (!_kvAvailable()) return null;
  const result = await _exec(['GET', QUOTA_KEY]);
  if (!result?.result) return null;
  try { return JSON.parse(result.result); } catch { return null; }
}

async function writeQuotaConfig(config) {
  if (!_kvAvailable()) return false;
  const result = await _exec(['SET', QUOTA_KEY, JSON.stringify(config)]);
  return !!result?.result;
}

const SNAPSHOT_KEY = 'codex:dev-snapshot';
const SNAPSHOT_TTL_SECONDS = 5 * 60; // expire if Express stops pushing

/**
 * Express-only: write a snapshot of in-memory state (streaming + optimizations)
 * so prod (Developer Control on Vercel) can display it.
 */
async function writeDevSnapshot(snapshot) {
  if (!_kvAvailable()) return false;
  const payload = JSON.stringify({ ...snapshot, updatedAt: Date.now() });
  const result = await _exec(['SET', SNAPSHOT_KEY, payload, 'EX', SNAPSHOT_TTL_SECONDS]);
  return !!result?.result;
}

async function readDevSnapshot() {
  if (!_kvAvailable()) return null;
  const result = await _exec(['GET', SNAPSHOT_KEY]);
  if (!result?.result) return null;
  try { return JSON.parse(result.result); } catch { return null; }
}

module.exports = {
  trackQuery,
  trackSubscriptionEvent,
  flushNow,
  readMetrics,
  readQuotaConfig,
  writeQuotaConfig,
  writeDevSnapshot,
  readDevSnapshot,
  isAvailable: _kvAvailable,
};
