/**
 * GET /api/codex-usage — Codex quota and usage dashboard endpoint.
 *
 * Auth: requires `x-admin-key` header matching `ADMIN_KEY` env var. If
 * `ADMIN_KEY` is unset the endpoint returns 503 (NOT open by default).
 *
 * Reads from the shared codex-metrics-kv store (Upstash Redis) that both
 * Vercel proxies and the Express server write to. Aggregates totals for
 * last hour / day / week, top operations, and the current billing cycle
 * estimate including the Sunny-configurable offset.
 *
 * Query params:
 *   days=N (default 7, max 30)
 */

import { createRequire } from 'module'
const require_ = createRequire(import.meta.url)
let codexMetricsKv = null
try { codexMetricsKv = require_('../../../packages/server/lib/codex-metrics-kv') } catch {}

function _safeCompare(a, b) {
  if (!a || !b) return false
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

export default async function handler(req, res) {
  // No CORS for admin endpoint — same-origin only via dashboard or curl
  if (req.method === 'OPTIONS') return res.status(204).end()

  const adminKey = process.env.ADMIN_KEY || process.env.SPECTRE_ADMIN_KEY
  if (!adminKey) {
    return res.status(503).json({
      error: 'admin-key-not-configured',
      hint: 'Set ADMIN_KEY env var in Vercel to enable this endpoint.',
    })
  }

  const provided = req.headers?.['x-admin-key'] || req.query?.key
  if (!_safeCompare(String(provided || ''), String(adminKey))) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  if (!codexMetricsKv?.isAvailable?.()) {
    return res.status(503).json({
      error: 'metrics-store-unavailable',
      hint: 'KV_REST_API_URL/TOKEN env vars must be set.',
    })
  }

  const days = Math.min(Math.max(parseInt(req.query?.days, 10) || 7, 1), 30)

  let metrics
  try {
    metrics = await codexMetricsKv.readMetrics(days)
  } catch (e) {
    return res.status(502).json({ error: 'metrics-read-failed', message: e?.message })
  }
  if (!metrics) {
    return res.status(502).json({ error: 'metrics-empty' })
  }

  // Derive a sane "top operations" array across the window from history.
  const opTotals = {}
  for (const day of metrics.history || []) {
    for (const [op, stats] of Object.entries(day.queries || {})) {
      if (!opTotals[op]) opTotals[op] = { calls: 0, errors: 0, latencyMs: 0 }
      opTotals[op].calls += stats.calls || 0
      opTotals[op].errors += stats.errors || 0
      opTotals[op].latencyMs += stats.latencyMs || 0
    }
  }
  const topOperations = Object.entries(opTotals)
    .map(([op, s]) => ({
      operation: op,
      calls: s.calls,
      errors: s.errors,
      errorRate: s.calls ? +(s.errors / s.calls).toFixed(4) : 0,
      avgLatencyMs: s.calls ? Math.round(s.latencyMs / s.calls) : 0,
    }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 10)

  // Caller source mix (dev / prod-research / prod-trading) over window.
  const sourceMix = {}
  for (const day of metrics.history || []) {
    for (const [src, n] of Object.entries(day.sources || {})) {
      sourceMix[src] = (sourceMix[src] || 0) + n
    }
  }

  const todayTotal = (metrics.today?.totalQueries || 0) + (metrics.today?.totalSubEvents || 0)
  const windowTotal = (metrics.history || []).reduce(
    (s, d) => s + (d.totalQueries || 0) + (d.totalSubEvents || 0),
    0,
  )
  const cycleUsed = (metrics.quota?.offset || 0) + (metrics.quota?.trackedTotal || 0)
  const cycleLimit = metrics.quota?.limit || 1_000_000
  const cyclePct = cycleLimit ? +((cycleUsed / cycleLimit) * 100).toFixed(2) : null

  res.setHeader('Cache-Control', 'no-store')
  return res.json({
    asOf: new Date().toISOString(),
    windowDays: days,
    totals: {
      today: todayTotal,
      window: windowTotal,
    },
    cycle: {
      limit: cycleLimit,
      offset: metrics.quota?.offset || 0,
      tracked: metrics.quota?.trackedTotal || 0,
      used: cycleUsed,
      pctOfLimit: cyclePct,
      cycleStart: metrics.quota?.cycleStart || null,
      cycleEnd: metrics.quota?.cycleEnd || null,
      note: metrics.quota?.note || '',
    },
    sourceMix,
    topOperations,
    history: (metrics.history || []).map(d => ({
      date: d.date,
      totalQueries: d.totalQueries || 0,
      totalSubEvents: d.totalSubEvents || 0,
    })),
  })
}
