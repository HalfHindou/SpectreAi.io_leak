/**
 * Vercel Cron - Codex Cost Watchdog
 * Runs every 15 minutes. Reads the codex-metrics-kv aggregate, checks last
 * hour's billable ops against thresholds, and pings a Slack webhook if any
 * threshold is crossed. Also POSTs the top 3 offending operations so we know
 * which lever to pull next.
 *
 * Thresholds (per hour, post-Phase-1+K targets):
 *   warn  > 35K ops/hr  ~ 840K/day (over the 1M plan)
 *   page  > 70K ops/hr  ~ 1.68M/day (runaway state)
 *
 * Schedule: cron every 15 minutes - configured in vercel.json
 * Env: SLACK_CODEX_WEBHOOK_URL (optional; if absent the cron silently no-ops
 * after a single console.warn, so adding the URL later turns alerting on
 * with zero code change)
 */

import { timingSafeEqual } from 'node:crypto'
import { rateLimit } from '../_lib/ratelimit.js'
import { createRequire } from 'module'
const require_ = createRequire(import.meta.url)
let codexMetricsKv = null
try { codexMetricsKv = require_('../../../../packages/server/lib/codex-metrics-kv') } catch {}

const WARN_OPS_PER_HOUR = 35_000
const PAGE_OPS_PER_HOUR = 70_000
const SLACK_WEBHOOK = process.env.SLACK_CODEX_WEBHOOK_URL || ''

async function postSlack(text, blocks) {
  if (!SLACK_WEBHOOK) {
    console.warn('[codex-watch] threshold crossed but SLACK_CODEX_WEBHOOK_URL not set:', text)
    return false
  }
  try {
    const r = await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(blocks ? { text, blocks } : { text }),
    })
    return r.ok
  } catch (e) {
    console.error('[codex-watch] slack post failed:', e.message)
    return false
  }
}

export default async function handler(req, res) {
  if (await rateLimit(req, res, { bucket: 'cron-codex-watch', max: 10, windowMs: 60_000 })) return

  const isVercelCron = req.headers['x-vercel-cron'] === '1'
    // 2026-07-02: prod runtime logs showed EVERY Vercel cron invocation
    // 401ing - Vercel does not send x-vercel-cron on this project and no
    // CRON_SECRET env is set, so neither branch ever matched and the cache
    // warmers/snapshots have been dead (cold caches, slow loads app-wide).
    // Vercel's documented cron signature is the user-agent; accept it. This
    // is the same trust level as the x-vercel-cron header (both spoofable -
    // verified externally), so no new exposure: the rate limit above and the
    // idempotent read-only work remain the actual defense. Setting a real
    // CRON_SECRET in the Vercel project env stays the preferred hardening.
    || String(req.headers['user-agent'] || '').startsWith('vercel-cron/')
  const auth = req.headers.authorization || ''
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  let hasValidSecret = false
  if (expectedAuth) {
    const a = Buffer.from(auth || '')
    const b = Buffer.from(expectedAuth)
    if (a.length === b.length && timingSafeEqual(a, b)) hasValidSecret = true
  }
  if (!isVercelCron && !hasValidSecret) return res.status(401).json({ error: 'unauthorized' })

  if (!codexMetricsKv?.isAvailable?.()) {
    return res.status(503).json({ error: 'metrics-unavailable' })
  }

  let metrics
  try { metrics = await codexMetricsKv.readMetrics(1) }
  catch (e) { return res.status(502).json({ error: 'metrics-read-failed', message: e?.message }) }
  if (!metrics) return res.status(502).json({ error: 'metrics-empty' })

  // Last-hour total = sum of all queries across the most recent hour bucket
  // (metrics.history[0] is today). The codex-metrics-kv lib stores hourly
  // buckets under day.byHour[hh].queries[op].calls; falls back to day total
  // if hour breakdown isn't available.
  const today = metrics.history?.[0] || metrics.current || {}
  const hoursAgo1 = new Date(Date.now() - 60 * 60_000)
  const hourBucketKey = `${hoursAgo1.toISOString().slice(11, 13)}`
  const hourBucket = today.byHour?.[hourBucketKey] || null

  let lastHourTotal = 0
  const opTotals = {}
  if (hourBucket?.queries) {
    for (const [op, stats] of Object.entries(hourBucket.queries)) {
      const calls = stats.calls || 0
      lastHourTotal += calls
      opTotals[op] = (opTotals[op] || 0) + calls
    }
  } else {
    // Fall back: today's running total / hours elapsed since midnight (rough).
    const now = new Date()
    const hoursElapsed = Math.max(1, now.getUTCHours() + now.getUTCMinutes() / 60)
    for (const [op, stats] of Object.entries(today.queries || {})) {
      const callsPerHour = (stats.calls || 0) / hoursElapsed
      lastHourTotal += callsPerHour
      opTotals[op] = (opTotals[op] || 0) + callsPerHour
    }
  }

  const topOps = Object.entries(opTotals).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const dailyProjection = Math.round(lastHourTotal * 24)
  let level = 'ok'
  if (lastHourTotal >= PAGE_OPS_PER_HOUR) level = 'page'
  else if (lastHourTotal >= WARN_OPS_PER_HOUR) level = 'warn'

  let alerted = false
  if (level !== 'ok') {
    const emoji = level === 'page' ? '🚨' : '⚠️'
    const text = `${emoji} Codex spend ${level} - ${Math.round(lastHourTotal)} ops in last hour (projected ${dailyProjection.toLocaleString()}/day)`
    const opList = topOps.map(([op, n]) => `  ${op}: ${Math.round(n)}`).join('\n')
    alerted = await postSlack(text + '\n```' + opList + '\n```')
  }

  return res.status(200).json({
    ok: true,
    lastHourTotal: Math.round(lastHourTotal),
    dailyProjection,
    level,
    topOps: topOps.map(([op, n]) => ({ op, calls: Math.round(n) })),
    alerted,
  })
}
