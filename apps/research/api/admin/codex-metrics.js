/**
 * GET /api/admin/codex-metrics
 *
 * Returns Codex usage from codex-metrics-kv. The single source of truth for
 * "what was our getBars/filterTokens rate before/after the UDF cache wrap".
 *
 * Auth: x-admin-key header (or ?key=) matching ADMIN_KEY env. 503 if not configured.
 * Query: ?days=2 (default 2, max 14). Newer days first.
 *
 *   curl -H "x-admin-key: $ADMIN_KEY" \
 *     https://app.spectreai.io/api/admin/codex-metrics?days=2
 */

import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)
let codexMetricsKv = null
try { codexMetricsKv = _require('../../../../packages/server/lib/codex-metrics-kv') } catch {}

function _safeCompare(a, b) {
  if (!a || !b) return false
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

function _opCalls(day, op) {
  return day?.queries?.[op]?.calls || 0
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end()

  const adminKey = process.env.ADMIN_KEY || process.env.SPECTRE_ADMIN_KEY
  if (!adminKey) return res.status(503).json({ error: 'admin-key-not-configured' })
  const provided = req.headers?.['x-admin-key'] || req.query?.key
  if (!_safeCompare(String(provided || ''), String(adminKey))) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  if (!codexMetricsKv) {
    return res.status(503).json({ error: 'codex-metrics-kv-not-loaded' })
  }

  const days = Math.min(Math.max(parseInt(req.query?.days) || 2, 1), 14)

  try {
    const metrics = await codexMetricsKv.readMetrics(days)
    if (!metrics) return res.status(503).json({ error: 'metrics-unavailable' })

    const today = metrics.today || {}
    const history = metrics.history || []
    // Headline number = last FULL day (yesterday), not today (partial).
    const yesterday = history.find(h => h?.date && h.date < today.date) || null
    const baselineDay = yesterday || today
    const baselineTotal = baselineDay?.totalQueries || 0

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({
      ok: true,
      baseline: {
        date: baselineDay?.date,
        note: yesterday ? 'last full day (UTC)' : 'today (partial — yesterday missing)',
        totalQueries: baselineTotal,
        opsPerHour: Math.round(baselineTotal / 24),
        getBars: { day: _opCalls(baselineDay, 'getBars'), perHour: Math.round(_opCalls(baselineDay, 'getBars') / 24) },
        filterTokens: { day: _opCalls(baselineDay, 'filterTokens'), perHour: Math.round(_opCalls(baselineDay, 'filterTokens') / 24) },
        listPairsWithMetadataForToken: { day: _opCalls(baselineDay, 'listPairsWithMetadataForToken'), perHour: Math.round(_opCalls(baselineDay, 'listPairsWithMetadataForToken') / 24) },
        getTokenPrices: { day: _opCalls(baselineDay, 'getTokenPrices'), perHour: Math.round(_opCalls(baselineDay, 'getTokenPrices') / 24) },
        sources: baselineDay?.sources || {},
      },
      today: {
        date: today.date,
        totalQueries: today.totalQueries || 0,
        getBars: _opCalls(today, 'getBars'),
        filterTokens: _opCalls(today, 'filterTokens'),
        listPairsWithMetadataForToken: _opCalls(today, 'listPairsWithMetadataForToken'),
        getTokenPrices: _opCalls(today, 'getTokenPrices'),
        sources: today.sources || {},
      },
      history,
      quota: metrics.quota,
      ts: new Date().toISOString(),
    })
  } catch (err) {
    return res.status(500).json({ error: 'metrics-read-failed', message: err?.message })
  }
}
