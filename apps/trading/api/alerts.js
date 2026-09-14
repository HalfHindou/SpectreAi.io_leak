/**
 * Vercel Serverless Function - Price Alert CRUD
 *
 * POST /api/alerts - Create a price alert (Codex createWebhooks mutation)
 * GET /api/alerts - List active alerts (Codex getWebhooks query)
 * DELETE /api/alerts?id=... - Delete an alert (Codex deleteWebhooks mutation)
 *
 * SEC-20260513-004 (BOLA fix): pre-Wave-5i the endpoint was gated only by
 * the team-password cookie, so any tester could list, create, or delete
 * ANY other tester's alerts (no per-user scoping). Now:
 *   - Privy JWT required (no anon access — anon would need cross-session
 *     state we don't have).
 *   - KV stores userId↔webhookId mapping per alert at `alerts:{userId}:{id}`.
 *   - GET returns only the calling user's alerts.
 *   - DELETE verifies the alert belongs to the caller before forwarding.
 *   - POST persists ownership after Codex confirms creation.
 * Defense-in-depth: auth-gate cookie is still required, plus per-user rate
 * limit at 30/min.
 */

import { createRequire } from 'module';
import { isAuthGateValid } from './auth-gate.js';
import { verifyPrivyToken } from './_lib/auth.js';
import { userRateLimit } from './_lib/ratelimit.js';
import { listRules, getRule, putRule, deleteRule as deleteRuleRecord, countActiveRules, newRuleId, buildRuleFromLegacy, putCronRule, deleteCronRule } from './_lib/alert-rules.js';

const _require = createRequire(import.meta.url);
let codexMetricsKv = null;
try { codexMetricsKv = _require('../../../packages/server/lib/codex-metrics-kv'); } catch {}

// KV import lazy-loaded so handler still runs in local dev without KV env.
let _kvPromise = null
async function getKv() {
  if (_kvPromise) return _kvPromise
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  if (!url || !token) {
    _kvPromise = Promise.resolve(null)
    return _kvPromise
  }
  _kvPromise = import('@upstash/redis').then(m => new m.Redis({ url, token })).catch(() => null)
  return _kvPromise
}

const CODEX_API_KEY = process.env.CODEX_API_KEY
const CODEX_BASE_URL = 'https://graph.codex.io/graphql'
// Codex key is origin-restricted; server-to-server calls must present the allowed origin.
const CODEX_ORIGIN = process.env.CODEX_ORIGIN || 'https://app.spectreai.io'
// 2026-05-12 lockdown: previously this fell back to a hardcoded literal
// 'spectre-alerts-default' if the env var was unset. That literal lived
// in our public source tree, so anyone could compute valid webhook
// signatures and spoof Codex price-alert events to our SSE subscribers.
// No fallback now — handler returns 503 if missing (see env check below).
const CODEX_WEBHOOK_SECRET = process.env.CODEX_WEBHOOK_SECRET

// Production callback URL for webhooks. Required env - no fallback. Codex calls
// this URL with alert payloads, so it must be a domain we control. The previous
// `https://trade.spectre.bot/api/webhook` fallback pointed at an unowned domain.
const WEBHOOK_CALLBACK_URL = process.env.WEBHOOK_CALLBACK_URL

function _extractOp(query) {
  if (!query) return 'unknown';
  const m = query.match(/^\s*(?:query|mutation|subscription)\s+(\w+)/);
  return m ? m[1] : 'unknown';
}

async function codexQuery(query, variables = {}) {
  const startTime = Date.now()
  const operation = _extractOp(query)
  let errored = false
  try {
    const res = await fetch(CODEX_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': CODEX_API_KEY, 'Origin': CODEX_ORIGIN },
      body: JSON.stringify({ query, variables }),
    })
    const data = await res.json()
    if (data.errors) { errored = true; throw new Error(data.errors[0]?.message || 'GraphQL error') }
    return data.data
  } catch (err) {
    errored = true
    throw err
  } finally {
    try { codexMetricsKv?.trackQuery(operation, Date.now() - startTime, errored, 'prod-trading') } catch {}
  }
}

// ── Per-user alert ownership store (SEC-20260513-004) ─────────────────────
// Index: `alerts:user:{userId}` -> Set of webhook ids
// Detail: `alerts:meta:{webhookId}` -> { userId, createdAt, tokenAddress, networkId }
// Detail lookup is what authorises DELETE: if the alert isn't owned by the
// caller, refuse to forward.
async function recordAlertOwnership(userId, webhookId, meta) {
  const kv = await getKv()
  if (!kv) return // local dev without KV — best-effort only
  try {
    await kv.set(`alerts:meta:${webhookId}`, JSON.stringify({ userId, ...meta, createdAt: Date.now() }))
    await kv.sadd(`alerts:user:${userId}`, webhookId)
  } catch (err) {
    console.warn('[alerts] recordAlertOwnership failed:', err?.message)
  }
}
async function getAlertOwner(webhookId) {
  const kv = await getKv()
  if (!kv) return null
  try {
    const raw = await kv.get(`alerts:meta:${webhookId}`)
    if (!raw) return null
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return parsed?.userId || null
  } catch {
    return null
  }
}
async function listUserAlertIds(userId) {
  const kv = await getKv()
  if (!kv) return null // null signals "no KV" so caller can decide
  try {
    const ids = await kv.smembers(`alerts:user:${userId}`)
    return Array.isArray(ids) ? ids : []
  } catch {
    return []
  }
}
async function forgetAlertOwnership(userId, webhookId) {
  const kv = await getKv()
  if (!kv) return
  try {
    await kv.del(`alerts:meta:${webhookId}`)
    await kv.srem(`alerts:user:${userId}`, webhookId)
  } catch (err) {
    console.warn('[alerts] forgetAlertOwnership failed:', err?.message)
  }
}

/**
 * Create the Codex webhook for a price rule and sync ownership meta.
 * Returns the webhook id. Used by POST (create), PATCH (rotate/resume).
 */
async function attachWebhook(userId, rule) {
  const created = await createAlert({
    tokenAddress: rule.token.address,
    networkId: rule.token.networkId,
    priceTarget: rule.condition.targetPrice,
    direction: rule.condition.direction,
    name: rule.name,
    repeat: rule.repeat,
  })
  await recordAlertOwnership(userId, created.id, {
    ruleId: rule.id,
    repeat: rule.repeat,
    symbol: rule.token.symbol,
    logo: rule.token.logo,
    tokenAddress: rule.token.address,
    networkId: rule.token.networkId,
    priceTarget: rule.condition.targetPrice,
    direction: rule.condition.direction,
    name: rule.name,
  })
  return created.id
}

/**
 * Delete a rule's Codex webhook (if any) and its ownership meta.
 * Codex errors are swallowed - an already-inactive/deleted webhook must not
 * block rule mutation.
 */
async function detachWebhook(userId, rule) {
  if (!rule.codexWebhookId) return
  try {
    await codexQuery(
      `mutation($input: DeleteWebhooksInput!) { deleteWebhooks(input: $input) { deletedIds } }`,
      { input: { webhookIds: [rule.codexWebhookId] } }
    )
  } catch (err) {
    console.warn('[alerts] detachWebhook codex delete failed (continuing):', err?.message)
  }
  await forgetAlertOwnership(userId, rule.codexWebhookId)
}

// ── Triggered-alert history (Task 2: persist webhook fires server-side) ──
// List: `alerts:triggered:{userId}` -> JSON records, newest first, capped to 50.
async function listTriggeredForUser(userId) {
  const kv = await getKv()
  if (!kv) return []
  try {
    const rows = await kv.lrange(`alerts:triggered:${userId}`, 0, 49)
    return (rows || []).map(r => { try { return typeof r === 'string' ? JSON.parse(r) : r } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

async function removeTriggered(userId, triggeredId) {
  const kv = await getKv()
  if (!kv) return
  try {
    const key = `alerts:triggered:${userId}`
    // LREM the exact stored element instead of del+rebuild - a concurrent
    // webhook LPUSH between read and rewrite would otherwise be lost.
    const rows = await kv.lrange(key, 0, 49)
    for (const r of rows || []) {
      let p = null
      try { p = typeof r === 'string' ? JSON.parse(r) : r } catch { continue }
      if (p?.id === triggeredId) {
        await kv.lrem(key, 1, typeof r === 'string' ? r : JSON.stringify(r))
        return
      }
    }
  } catch (err) {
    console.warn('[alerts] removeTriggered failed:', err?.message)
  }
}

/**
 * Create a price alert via Codex createWebhooks mutation.
 * Body: { tokenAddress, networkId, priceTarget, direction: 'above'|'below', name? }
 */
async function createAlert(body) {
  const { tokenAddress, networkId, priceTarget, direction = 'above', name, repeat = 'once' } = body

  if (!tokenAddress || !networkId || !priceTarget) {
    throw new Error('tokenAddress, networkId, and priceTarget are required')
  }

  const priceCondition = direction === 'above'
    ? { gte: String(priceTarget) }
    : { lte: String(priceTarget) }

  const alertName = name || `${direction === 'above' ? 'Above' : 'Below'} $${priceTarget}`

  const mutation = `
    mutation CreatePriceAlert($input: CreateWebhooksInput!) {
      createWebhooks(input: $input) {
        tokenPriceEventWebhooks {
          id
          name
          status
        }
      }
    }
  `

  const data = await codexQuery(mutation, {
    input: {
      tokenPriceEventWebhooksInput: {
        webhooks: [{
          name: alertName,
          callbackUrl: WEBHOOK_CALLBACK_URL,
          securityToken: CODEX_WEBHOOK_SECRET,
          alertRecurrence: repeat === 'recurring' ? 'INDEFINITE' : 'ONCE',
          conditions: {
            // EVM addresses are case-insensitive (normalize); Solana base58 is
            // case-SENSITIVE - lowercasing breaks it ("invalid token address").
            address: { eq: tokenAddress.startsWith('0x') ? tokenAddress.toLowerCase() : tokenAddress },
            networkId: { eq: parseInt(networkId) },
            priceUsd: priceCondition,
          },
          retrySettings: { maxRetries: 3, maxRetryDelay: 30 },
          deduplicate: true,
        }],
      },
    },
  })

  const created = data?.createWebhooks?.tokenPriceEventWebhooks?.[0]
  if (!created) throw new Error('Failed to create webhook')

  return {
    id: created.id,
    name: created.name,
    status: created.status,
    tokenAddress,
    networkId: parseInt(networkId),
    priceTarget: parseFloat(priceTarget),
    direction,
  }
}

/**
 * List active webhooks from Codex, filtered to those owned by `userId`.
 * SEC-20260513-004: prior version returned every webhook the Codex account
 * had ever created (single shared Codex account → user A could see + delete
 * user B's alerts). Now we list the user's webhook ids from KV first, then
 * filter the Codex response.
 */
async function listAlertsForUser(userId) {
  const query = `
    query GetWebhooks {
      getWebhooks {
        items {
          id
          name
          webhookType
          status
          created
          conditions {
            ... on TokenPriceEventWebhookCondition {
              address { eq }
              networkId { eq }
              priceUsd { gt gte lt lte eq }
            }
          }
        }
      }
    }
  `

  const data = await codexQuery(query)
  const webhooks = data?.getWebhooks?.items || []

  const ownedIds = await listUserAlertIds(userId)
  // ownedIds === null means KV is unavailable (local dev). In that case
  // refuse to leak the full alert list — return empty rather than expose
  // every user's alerts to whoever asks.
  if (ownedIds === null) {
    console.warn('[alerts] KV unavailable - returning empty alert list for safety')
    return []
  }
  const ownedSet = new Set(ownedIds)

  // Filter to only TOKEN_PRICE_EVENT webhooks owned by this user.
  return webhooks
    .filter(w => w.webhookType === 'TOKEN_PRICE_EVENT' && ownedSet.has(w.id))
    .map(w => ({
      id: w.id,
      name: w.name,
      status: w.status,
      tokenAddress: w.conditions?.address?.eq || '',
      networkId: w.conditions?.networkId?.eq || 0,
      priceTarget: parseFloat(w.conditions?.priceUsd?.gte || w.conditions?.priceUsd?.lte || 0),
      direction: w.conditions?.priceUsd?.gte ? 'above' : 'below',
      created: w.created,
    }))
}

/**
 * Delete a webhook by ID after verifying caller ownership.
 * SEC-20260513-004.
 */
async function deleteAlert(webhookId, callerUserId) {
  const ownerId = await getAlertOwner(webhookId)
  if (!ownerId) {
    // If KV doesn't know the alert, it's either pre-Wave-5i legacy or
    // someone else's. Refuse to delete either way — user can recreate.
    const err = new Error('Alert not found')
    err.statusCode = 404
    throw err
  }
  if (ownerId !== callerUserId) {
    const err = new Error('Forbidden')
    err.statusCode = 403
    throw err
  }

  const mutation = `
    mutation DeleteWebhooks($input: DeleteWebhooksInput!) {
      deleteWebhooks(input: $input) {
        deletedIds
      }
    }
  `

  const data = await codexQuery(mutation, {
    input: { webhookIds: [webhookId] },
  })

  await forgetAlertOwnership(callerUserId, webhookId)
  return { deleted: data?.deleteWebhooks?.deletedIds || [] }
}

// CORS
const ALLOWED_ORIGINS = [
  'http://localhost:5180', 'http://localhost:5181'
]

export default async function handler(req, res) {
  const origin = req.headers?.origin
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // 2026-05-11 lockdown: creating alerts costs Codex webhook quota; listing
  // also burns a Codex query per call. Keep auth-gate as defense-in-depth.
  if (!isAuthGateValid(req)) {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
  }

  // SEC-20260513-004 (BOLA fix): Privy JWT is now mandatory for any
  // alert CRUD. The auth-gate cookie alone is not user-scoped, so it
  // can't enforce per-user ownership.
  const userId = await verifyPrivyToken(req)
  if (!userId) {
    return res.status(401).json({ error: 'Privy auth required', code: 'PRIVY_REQUIRED' })
  }

  // SEC-20260513-004: per-user rate limit. 30/min easily covers a power
  // user juggling watchlist alerts; anything beyond is abusive.
  if (await userRateLimit(res, { bucket: 'alerts', userId, max: 30, windowMs: 60_000 })) return

  // 2026-05-12 fail-closed: refuse to call Codex with an empty/missing
  // webhook secret. With no secret we couldn't verify inbound webhooks
  // anyway — the corresponding receiver in api/webhook.js would either
  // crash on signature compare or (worse) fail-open and accept spoofed
  // events. Both apps' Vercel deploys MUST have CODEX_WEBHOOK_SECRET set.
  // Listing/deleting alerts only needs the Codex API key. The webhook SECRET +
  // CALLBACK URL are needed only to CREATE a webhook, so those checks live in
  // the POST case below - otherwise a missing webhook env 503s the GET that
  // useAlerts fires on every page load (the console error the user saw).
  if (!CODEX_API_KEY) {
    return res.status(503).json({ error: 'Codex API key not configured', code: 'CODEX_KEY_MISSING' })
  }

  try {
    switch (req.method) {
      case 'POST': {
        const kv = await getKv()
        const { type = 'price', tokenAddress, networkId, priceTarget, direction = 'above', name, repeat = 'once', mode = 'price', displayValue = '', symbol = '', logo = '', windowMin, pct, pctDirection } = req.body || {}

        if (type === 'pct') {
          const win = parseInt(windowMin)
          const p = parseFloat(pct)
          const dir = ['up', 'down', 'both'].includes(pctDirection) ? pctDirection : 'both'
          if (![60, 1440].includes(win)) return res.status(400).json({ error: 'windowMin must be 60 or 1440' })
          if (!(p >= 1 && p <= 500)) return res.status(400).json({ error: 'pct must be 1-500' })
          if (!tokenAddress || !networkId) return res.status(400).json({ error: 'tokenAddress and networkId are required' })
          if (await countActiveRules(kv, userId) >= 25) {
            return res.status(400).json({ error: 'Alert limit reached (25 active). Delete some alerts first.', code: 'RULE_CAP' })
          }
          const winLabel = win === 60 ? '1h' : '24h'
          const dirLabel = dir === 'up' ? '+' : dir === 'down' ? '-' : '±'
          const rule = {
            id: newRuleId(),
            type: 'pct',
            engine: 'cron',
            status: 'active',
            token: { address: tokenAddress, networkId: parseInt(networkId), symbol, logo },
            condition: { windowMin: win, pct: p, direction: dir },
            repeat: repeat === 'recurring' ? 'recurring' : 'once',
            codexWebhookId: null,
            name: name || `${symbol || 'Token'} ${dirLabel}${p}% in ${winLabel}`,
            createdAt: Date.now(),
            lastTriggeredAt: 0,
            lastTriggerPrice: 0,
          }
          await putRule(kv, userId, rule)
          await putCronRule(kv, userId, rule)
          return res.status(201).json({
            ...rule,
            tokenAddress: rule.token.address,
            networkId: rule.token.networkId,
            priceTarget: 0,
            direction: dir === 'down' ? 'below' : 'above',
          })
        }

        // Price-rule path (Codex webhook engine). The webhook env guards live
        // here, not above the pct branch, so pct creation works even if
        // webhook env is misconfigured (cron rules never touch Codex).
        if (!CODEX_WEBHOOK_SECRET) {
          return res.status(503).json({ error: 'Webhook secret not configured', code: 'WEBHOOK_SECRET_MISSING' })
        }
        if (!WEBHOOK_CALLBACK_URL) {
          return res.status(503).json({ error: 'Webhook callback URL not configured', code: 'WEBHOOK_CALLBACK_MISSING' })
        }
        if (!tokenAddress || !networkId || !priceTarget) {
          return res.status(400).json({ error: 'tokenAddress, networkId, and priceTarget are required' })
        }
        if (await countActiveRules(kv, userId) >= 25) {
          return res.status(400).json({ error: 'Alert limit reached (25 active). Delete some alerts first.', code: 'RULE_CAP' })
        }
        const rule = {
          id: newRuleId(),
          type: 'price',
          engine: 'codex',
          status: 'active',
          token: { address: tokenAddress, networkId: parseInt(networkId), symbol, logo },
          condition: { direction, targetPrice: parseFloat(priceTarget), mode, displayValue: displayValue || String(priceTarget) },
          repeat: repeat === 'recurring' ? 'recurring' : 'once',
          codexWebhookId: null,
          name: name || `${direction === 'above' ? 'Above' : 'Below'} $${priceTarget}`,
          createdAt: Date.now(),
          lastTriggeredAt: 0,
          lastTriggerPrice: 0,
        }
        rule.codexWebhookId = await attachWebhook(userId, rule)
        await putRule(kv, userId, rule)
        return res.status(201).json({
          ...rule,
          // Legacy top-level fields for the pre-rules client contract.
          tokenAddress: rule.token.address,
          networkId: rule.token.networkId,
          priceTarget: rule.condition.targetPrice,
          direction: rule.condition.direction,
        })
      }
      case 'GET': {
        try {
          const kv = await getKv()
          const [codexAlerts, triggered] = await Promise.all([
            listAlertsForUser(userId),
            listTriggeredForUser(userId),
          ])

          let rules = await listRules(kv, userId)

          // Lazy migration: user has pre-rules Codex alerts but no rule records.
          if (kv && rules.length === 0 && codexAlerts.length > 0) {
            for (const a of codexAlerts.filter(x => x.status === 'ACTIVE')) {
              let meta = null
              try {
                const raw = await kv.get(`alerts:meta:${a.id}`)
                meta = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null
              } catch { /* meta optional */ }
              const rule = buildRuleFromLegacy(a, meta)
              // deterministic id keeps concurrent first-GET migrations idempotent
              rule.id = 'r_mig_' + a.id
              await putRule(kv, userId, rule)
              // Backfill ruleId into meta so the webhook receiver can find the rule.
              await recordAlertOwnership(userId, a.id, { ...(meta || {}), ruleId: rule.id })
              rules.push(rule)
            }
          }

          // Self-heal: a once-rule whose webhook is gone or INACTIVE has fired
          // (or was deleted out-of-band) - consume the rule record.
          const codexById = new Map(codexAlerts.map(a => [a.id, a]))
          let alive
          if (codexAlerts.length > 0) {
            alive = []
            for (const r of rules) {
              const wh = r.codexWebhookId ? codexById.get(r.codexWebhookId) : null
              const consumed = r.engine === 'codex' && r.status === 'active' && r.repeat === 'once'
                && (!wh || wh.status !== 'ACTIVE')
                && (Date.now() - (r.createdAt || 0) > 5 * 60_000)
              if (consumed) { await deleteRuleRecord(kv, userId, r.id); continue }
              alive.push(r)
            }
          } else {
            // empty Codex list is indistinguishable from a soft failure; never mass-consume on it
            alive = rules
          }

          // Legacy-shaped rows so stale bundles keep rendering.
          const legacy = alive
            .filter(r => r.type === 'price' && r.status !== 'paused')
            .map(r => ({
              id: r.id,
              name: r.name,
              status: 'ACTIVE',
              tokenAddress: r.token?.address || '',
              networkId: r.token?.networkId || 0,
              priceTarget: r.condition?.targetPrice || 0,
              direction: r.condition?.direction || 'above',
              repeat: r.repeat,
              paused: false,
            }))

          return res.json({ rules: alive, alerts: legacy, triggered })
        } catch (err) {
          console.error('[alerts] list failed:', err.message)
          return res.json({ rules: [], alerts: [], triggered: [], fallback: true })
        }
      }
      case 'PATCH': {
        const kv = await getKv()
        if (!kv) return res.status(503).json({ error: 'KV not configured' })
        const { ruleId, updates } = req.body || {}
        if (!ruleId || !updates || typeof updates !== 'object') {
          return res.status(400).json({ error: 'ruleId and updates required' })
        }
        const rule = await getRule(kv, userId, ruleId)
        if (!rule) return res.status(404).json({ error: 'Rule not found' })

        const next = { ...rule }
        let conditionChanged = false
        if (updates.priceTarget !== undefined) { next.condition = { ...next.condition, targetPrice: parseFloat(updates.priceTarget) }; conditionChanged = true }
        if (updates.direction !== undefined) {
          // Price-rule enum only - a malformed client must not corrupt a pct
          // rule's up/down/both direction through this shared field.
          if (rule.type !== 'price' || !['above', 'below'].includes(updates.direction)) {
            return res.status(400).json({ error: 'direction must be above or below (price rules only)' })
          }
          next.condition = { ...next.condition, direction: updates.direction }; conditionChanged = true
        }
        if (updates.mode !== undefined) next.condition = { ...next.condition, mode: updates.mode }
        if (updates.displayValue !== undefined) next.condition = { ...next.condition, displayValue: updates.displayValue }
        if (updates.windowMin !== undefined) {
          const win = parseInt(updates.windowMin)
          if (![60, 1440].includes(win)) return res.status(400).json({ error: 'windowMin must be 60 or 1440' })
          next.condition = { ...next.condition, windowMin: win }
          conditionChanged = true
        }
        if (updates.pct !== undefined) {
          const p = parseFloat(updates.pct)
          if (!(p >= 1 && p <= 500)) return res.status(400).json({ error: 'pct must be 1-500' })
          next.condition = { ...next.condition, pct: p }
          conditionChanged = true
        }
        if (updates.pctDirection !== undefined) {
          const dir = ['up', 'down', 'both'].includes(updates.pctDirection) ? updates.pctDirection : 'both'
          next.condition = { ...next.condition, direction: dir }
          conditionChanged = true
        }
        if (updates.name !== undefined) next.name = updates.name
        if (updates.repeat !== undefined && updates.repeat !== next.repeat) { next.repeat = updates.repeat === 'recurring' ? 'recurring' : 'once'; conditionChanged = true }
        if (updates.status !== undefined) next.status = updates.status === 'paused' ? 'paused' : 'active'

        const pausing = rule.status === 'active' && next.status === 'paused'
        const resuming = rule.status === 'paused' && next.status === 'active'

        // The 25-active cap is a hard invariant - resume must not sidestep
        // it (create-pause-create-resume would otherwise stack unbounded
        // active rules into the shared cron batch).
        if (resuming && await countActiveRules(kv, userId) >= 25) {
          return res.status(400).json({ error: 'Alert limit reached (25 active). Delete some alerts first.', code: 'RULE_CAP' })
        }

        // Webhook attach/detach/rotate is a Codex-engine concept only - cron
        // (pct) rules never touch Codex, they sync the global hash below instead.
        if (next.engine === 'codex') {
          if (pausing) {
            await detachWebhook(userId, next)
            next.codexWebhookId = null
          } else if (resuming || (conditionChanged && next.status === 'active')) {
            // Rotate: attach the NEW webhook first, then detach the OLD one.
            // Rule id stays stable; webhook id rotates. If attach throws, the
            // rule is left untouched with a still-live old webhook rather than
            // pointing at a deleted one (recurring rules must never silently die).
            const newWebhookId = await attachWebhook(userId, next)
            if (rule.codexWebhookId) {
              await detachWebhook(userId, { codexWebhookId: rule.codexWebhookId })
            }
            next.codexWebhookId = newWebhookId
          }
        }

        await putRule(kv, userId, next)
        if (next.engine === 'cron') {
          if (next.status === 'active') await putCronRule(kv, userId, next)
          else await deleteCronRule(kv, userId, next.id)
        }
        return res.json({ rule: next })
      }
      case 'DELETE': {
        const { id, triggeredId, ruleId } = req.query
        if (triggeredId) {
          await removeTriggered(userId, triggeredId)
          return res.json({ ok: true })
        }
        if (ruleId) {
          const kv = await getKv()
          const rule = await getRule(kv, userId, ruleId)
          if (!rule) return res.status(404).json({ error: 'Rule not found' })
          await detachWebhook(userId, rule)
          await deleteRuleRecord(kv, userId, ruleId)
          await deleteCronRule(kv, userId, ruleId)
          return res.json({ ok: true })
        }
        if (!id) return res.status(400).json({ error: 'id required' })
        // Stale-bundle compat: legacy rows now carry rule ids, so an old client
        // deleting via ?id= may actually be naming a rule. Route it through the
        // rule path when it resolves in the caller's own hash.
        if (id) {
          const kvc = await getKv()
          const asRule = await getRule(kvc, userId, id)
          if (asRule) {
            await detachWebhook(userId, asRule)
            await deleteRuleRecord(kvc, userId, id)
            await deleteCronRule(kvc, userId, id)
            return res.json({ ok: true })
          }
        }
        const result = await deleteAlert(id, userId)
        return res.json(result)
      }
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (err) {
    if (err?.statusCode === 403) return res.status(403).json({ error: err.message })
    if (err?.statusCode === 404) return res.status(404).json({ error: err.message })
    console.error('[alerts] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
