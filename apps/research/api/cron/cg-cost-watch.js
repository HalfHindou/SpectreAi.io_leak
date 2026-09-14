/**
 * Vercel Cron - CoinGecko Usage Watchdog
 *
 * Runs every 30 minutes. Reads CoinGecko's /key endpoint (CG-native
 * usage counter, no extra billing) and posts Slack alert when:
 *   - Daily-rate projection would exceed monthly plan
 *   - Or absolute used/credit ratio crosses thresholds
 *
 * Why we need this: Phase K5 added a CG-backed snapshot cron firing 2 calls
 * per app per minute. At 2 apps that's 5,760 CG calls/day. Sunny's Lite
 * plan caps at 2M/mo (~64K/day average) so we have ~10x headroom, but any
 * runaway pattern (e.g. a new feature accidentally polling /coins/markets
 * per user) could blow the budget without us noticing. This watchdog
 * surfaces it within 30 min.
 *
 * Thresholds:
 *   info    > 30% used  - log only (no Slack)
 *   warn    > 60% used  - Slack ping
 *   page    > 85% used  - Slack page + suggest disabling CG crons
 *
 * Env: SLACK_CODEX_WEBHOOK_URL (same channel as Codex watcher; if absent
 * the cron just console.warns and returns).
 */

import { timingSafeEqual } from 'node:crypto'
import { rateLimit } from '../_lib/ratelimit.js'

const SLACK_WEBHOOK = process.env.SLACK_CODEX_WEBHOOK_URL || ''
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || ''

async function postSlack(text) {
  if (!SLACK_WEBHOOK) {
    console.warn('[cg-watch] threshold crossed but SLACK_CODEX_WEBHOOK_URL unset:', text)
    return false
  }
  try {
    const r = await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    return r.ok
  } catch (e) {
    console.error('[cg-watch] slack post failed:', e.message)
    return false
  }
}

export default async function handler(req, res) {
  if (await rateLimit(req, res, { bucket: 'cron-cg-watch', max: 10, windowMs: 60_000 })) return

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

  if (!COINGECKO_API_KEY) {
    return res.status(503).json({ error: 'cg-key-not-configured' })
  }

  let payload
  try {
    const r = await fetch('https://pro-api.coingecko.com/api/v3/key', {
      headers: { 'x-cg-pro-api-key': COINGECKO_API_KEY },
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      return res.status(502).json({ error: 'cg-key-endpoint-failed', status: r.status, body: text.slice(0, 200) })
    }
    payload = await r.json()
  } catch (e) {
    return res.status(502).json({ error: 'cg-fetch-failed', message: e?.message })
  }

  const plan = payload?.plan || 'unknown'
  const credit = Number(payload?.monthly_call_credit) || 0
  const used = Number(payload?.current_total_monthly_calls) || 0
  const remaining = Number(payload?.current_remaining_monthly_calls) || (credit - used)
  const usedPct = credit ? +((used / credit) * 100).toFixed(2) : 0
  const rateLimit_rpm = Number(payload?.rate_limit_request_per_minute) || 0

  // Day projection: assume linear extrapolation from days-elapsed-this-month.
  const now = new Date()
  const day = now.getUTCDate()
  const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate()
  const projectedMonthly = day > 0 ? Math.round((used / day) * daysInMonth) : 0
  const projectedPct = credit ? +((projectedMonthly / credit) * 100).toFixed(2) : 0

  let level = 'ok'
  if (usedPct >= 85 || projectedPct >= 100) level = 'page'
  else if (usedPct >= 60 || projectedPct >= 80) level = 'warn'
  else if (usedPct >= 30) level = 'info'

  let alerted = false
  if (level === 'page' || level === 'warn') {
    const emoji = level === 'page' ? '🚨' : '⚠️'
    const text = `${emoji} CoinGecko ${level} - plan=${plan} used=${used.toLocaleString()}/${credit.toLocaleString()} (${usedPct}%), projected month=${projectedMonthly.toLocaleString()} (${projectedPct}%)`
    alerted = await postSlack(text)
  }

  return res.status(200).json({
    ok: true,
    plan,
    used,
    credit,
    remaining,
    usedPct,
    projectedMonthly,
    projectedPct,
    rateLimit_rpm,
    level,
    alerted,
  })
}
