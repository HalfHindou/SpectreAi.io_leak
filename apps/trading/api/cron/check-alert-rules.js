/**
 * Vercel Cron - pct-alert engine (Alerts 2.0 wave 2). Runs every 10 min.
 *
 * Cost contract: a tick with zero pct rules makes ZERO Codex calls. With
 * rules: one getTokenPrices query per 25 unique tokens per tick. Price
 * history is self-contained in KV (alerts:px:*) - no dependency on the
 * Hetzner price tables or /api/bars.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET} - only Vercel cron can call.
 * (header-check semantics mirror api/cron/refresh-token-snapshot.js exactly -
 * accepts either a valid x-vercel-cron header or a timing-safe secret match)
 */
import { timingSafeEqual } from 'node:crypto'
import { listCronRules, getRule, putRule, deleteRule, putCronRule, deleteCronRule } from '../_lib/alert-rules.js'
import { notifyTrigger } from '../_lib/alert-notify.js'

const CODEX_BASE_URL = 'https://graph.codex.io/graphql'
const CODEX_API_KEY = process.env.CODEX_API_KEY || ''
const CODEX_ORIGIN = process.env.CODEX_ORIGIN || 'https://app.spectreai.io'

const PX_CAP = 150            // ~25h of 10-min points
const BATCH = 25              // Codex getTokenPrices inputs per query
const MIN_AGE_RATIO = 0.8     // reference point must cover >=80% of the window

let _kvPromise = null
async function getKv() {
  if (_kvPromise) return _kvPromise
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  if (!url || !token) { _kvPromise = Promise.resolve(null); return _kvPromise }
  _kvPromise = import('@upstash/redis').then(m => new m.Redis({ url, token })).catch(() => null)
  return _kvPromise
}

// Query shape matches the proven-in-repo getTokenPrices callers (codex.js,
// codex-stream.js, packages/server/index.js): named operation + a NON-NULL
// list type ([GetPriceInput!]!) - the brief's anonymous query used a
// nullable list ([GetPriceInput!]) which risks a GraphQL variable-type
// mismatch against the live schema. Field selection stays minimal (no
// `timestamp`) since this engine doesn't consume it.
async function fetchPrices(tokens) {
  // tokens: [{ address, networkId }] - returns Map "addr:net" -> priceUsd
  const out = new Map()
  for (let i = 0; i < tokens.length; i += BATCH) {
    const slice = tokens.slice(i, i + BATCH)
    try {
      const res = await fetch(CODEX_BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: CODEX_API_KEY, Origin: CODEX_ORIGIN },
        body: JSON.stringify({
          query: `query GetTokenPrices($inputs: [GetPriceInput!]!){ getTokenPrices(inputs:$inputs){ address networkId priceUsd } }`,
          variables: { inputs: slice.map(t => ({ address: t.address, networkId: t.networkId })) },
        }),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      for (const row of data?.data?.getTokenPrices || []) {
        if (row && row.priceUsd != null) out.set(`${String(row.address).toLowerCase()}:${row.networkId}`, parseFloat(row.priceUsd))
      }
    } catch (err) {
      console.warn('[alert-cron] price batch failed:', err?.message)
    }
  }
  return out
}

function pxKey(t) { return `alerts:px:${t.networkId}:${String(t.address).toLowerCase()}` }
function tKey(t) { return `${String(t.address).toLowerCase()}:${t.networkId}` }

async function referencePrice(kv, token, windowMin, now) {
  // stored newest-first; find the first point at least windowMin old,
  // but only trust it if it covers >=80% of the window.
  try {
    const rows = await kv.lrange(pxKey(token), 0, PX_CAP - 1)
    for (const raw of rows || []) {
      let p
      try { p = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { continue }
      if (!p?.ts || !(p.price > 0)) continue
      const age = now - p.ts
      if (age >= windowMin * 60_000 * MIN_AGE_RATIO) return p.price
    }
  } catch { /* fall through */ }
  return null
}

export default async function handler(req, res) {
  // Header-check semantics mirror refresh-token-snapshot.js exactly: accept
  // either Vercel's own cron invocation header, or a timing-safe secret match.
  const isVercelCron = req.headers['x-vercel-cron'] === '1'
  const auth = req.headers.authorization || ''
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  let hasValidSecret = false
  if (expectedAuth) {
    const a = Buffer.from(auth || '')
    const b = Buffer.from(expectedAuth)
    if (a.length === b.length && timingSafeEqual(a, b)) hasValidSecret = true
  }
  if (!isVercelCron && !hasValidSecret) return res.status(401).json({ error: 'Unauthorized' })

  const kv = await getKv()
  if (!kv) return res.status(200).json({ ok: true, skipped: 'no kv' })

  const entries = (await listCronRules(kv)).filter(e => e.rule?.status === 'active' && e.rule?.type === 'pct')
  if (entries.length === 0) return res.status(200).json({ ok: true, rules: 0, codexCalls: 0 })

  // Unique token set derived from the rules themselves - no separate KV set.
  const tokenMap = new Map()
  for (const { rule } of entries) {
    if (rule.token?.address && rule.token?.networkId) tokenMap.set(tKey(rule.token), rule.token)
  }
  const tokens = [...tokenMap.values()]
  const now = Date.now()
  const prices = await fetchPrices(tokens)

  // Append this tick's point per token (before evaluation - the window
  // looks BACK, so today's point never satisfies its own window).
  for (const t of tokens) {
    const price = prices.get(tKey(t))
    if (!(price > 0)) continue
    try {
      await kv.lpush(pxKey(t), JSON.stringify({ ts: now, price }))
      await kv.ltrim(pxKey(t), 0, PX_CAP - 1)
    } catch { /* per-token best effort */ }
  }

  let fired = 0
  for (const { userId, rule } of entries) {
    try {
      const price = prices.get(tKey(rule.token))
      if (!(price > 0)) continue
      // Recurring cooldown: at most one fire per window.
      if (rule.repeat === 'recurring' && rule.lastTriggeredAt && (now - rule.lastTriggeredAt) < rule.condition.windowMin * 60_000) continue
      const ref = await referencePrice(kv, rule.token, rule.condition.windowMin, now)
      if (!ref) continue
      const changePct = ((price - ref) / ref) * 100
      const hitUp = (rule.condition.direction !== 'down') && changePct >= rule.condition.pct
      const hitDown = (rule.condition.direction !== 'up') && changePct <= -rule.condition.pct
      if (!hitUp && !hitDown) continue

      // Fresh-read guard (same invariant as the webhook engine): only act
      // on a rule that still exists and is still active.
      const fresh = await getRule(kv, userId, rule.id)
      if (!fresh || fresh.status !== 'active') { await deleteCronRule(kv, userId, rule.id); continue }

      const record = {
        id: `t_${rule.id}_${now}`,
        webhookId: null,
        ruleId: rule.id,
        tokenAddress: rule.token.address,
        networkId: rule.token.networkId,
        priceUsd: price,
        priceTarget: 0,
        direction: hitUp ? 'above' : 'below',
        name: fresh.name || 'Move alert',
        symbol: fresh.token?.symbol || '',
        logo: fresh.token?.logo || '',
        changePct: Math.round(changePct * 10) / 10,
        triggeredAt: now,
      }
      const key = `alerts:triggered:${userId}`
      await kv.lpush(key, JSON.stringify(record))
      await kv.ltrim(key, 0, 49)

      if (fresh.repeat === 'recurring') {
        const next = { ...fresh, lastTriggeredAt: now, lastTriggerPrice: price }
        await putRule(kv, userId, next)
        await putCronRule(kv, userId, next)
      } else {
        await deleteRule(kv, userId, fresh.id)
        await deleteCronRule(kv, userId, fresh.id)
      }

      await notifyTrigger(kv, userId, record)
      fired++
    } catch (err) {
      console.warn('[alert-cron] rule eval failed:', rule?.id, err?.message)
    }
  }

  return res.status(200).json({ ok: true, rules: entries.length, tokens: tokens.length, fired })
}
