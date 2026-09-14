/**
 * alert-rules - KV store for unified alert rule records (Alerts 2.0 PR1).
 *
 * One rule record per alert in hash alerts:rules:{userId}. Rules are the
 * single source of truth for the UI; Codex webhooks are an execution detail
 * managed by alerts.js. Every function takes the caller's kv client and is
 * a safe no-op when kv is null (local dev without KV env).
 *
 * Rule shape: see docs/superpowers/plans/2026-07-24-alerts-v2-pr1-rules-foundation.md
 */

const rulesKey = (userId) => `alerts:rules:${userId}`
const CRON_RULES_KEY = 'alerts:cron:rules'

export function newRuleId() {
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

function parseRule(raw) {
  try {
    const r = typeof raw === 'string' ? JSON.parse(raw) : raw
    return r && r.id ? r : null
  } catch {
    return null
  }
}

export async function listRules(kv, userId) {
  if (!kv) return []
  try {
    const hash = await kv.hgetall(rulesKey(userId))
    if (!hash) return []
    return Object.values(hash).map(parseRule).filter(Boolean)
  } catch {
    return []
  }
}

export async function getRule(kv, userId, ruleId) {
  if (!kv) return null
  try {
    const raw = await kv.hget(rulesKey(userId), ruleId)
    return raw ? parseRule(raw) : null
  } catch {
    return null
  }
}

export async function putRule(kv, userId, rule) {
  if (!kv || !rule?.id) return
  try {
    await kv.hset(rulesKey(userId), { [rule.id]: JSON.stringify(rule) })
  } catch (err) {
    console.warn('[alert-rules] putRule failed:', err?.message)
  }
}

export async function deleteRule(kv, userId, ruleId) {
  if (!kv) return
  try {
    await kv.hdel(rulesKey(userId), ruleId)
  } catch (err) {
    console.warn('[alert-rules] deleteRule failed:', err?.message)
  }
}

export async function countActiveRules(kv, userId) {
  const rules = await listRules(kv, userId)
  return rules.filter(r => r.status === 'active').length
}

// ── Cron-engine global hash (Alerts 2.0 PR2 — pct rules) ──────────────────
// alerts:cron:rules is a SINGLE hash shared across all users, so the cron
// worker can HGETALL once per tick instead of scanning per-user keys. Field
// key is `${userId}:${ruleId}` for readability, but userId is NEVER derived
// by splitting that key back apart - privy DIDs contain colons. The stored
// JSON copy carries its own `_userId` field, which is the only safe source
// of truth for listCronRules.

export async function putCronRule(kv, userId, rule) {
  if (!kv || !rule?.id) return
  try {
    await kv.hset(CRON_RULES_KEY, { [`${userId}:${rule.id}`]: JSON.stringify({ ...rule, _userId: userId }) })
  } catch (err) {
    console.warn('[alert-rules] putCronRule failed:', err?.message)
  }
}

export async function deleteCronRule(kv, userId, ruleId) {
  if (!kv) return
  try {
    await kv.hdel(CRON_RULES_KEY, `${userId}:${ruleId}`)
  } catch (err) {
    console.warn('[alert-rules] deleteCronRule failed:', err?.message)
  }
}

// Cron-side read: userId comes from the stored copy (_userId), NOT from
// splitting the field key - privy DIDs contain colons.
export async function listCronRules(kv) {
  if (!kv) return []
  try {
    const hash = await kv.hgetall(CRON_RULES_KEY)
    if (!hash) return []
    const out = []
    for (const raw of Object.values(hash)) {
      const r = parseRule(raw)
      if (r && r._userId) out.push({ userId: r._userId, rule: r })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Build a rule record from a pre-rules Codex alert (lazy migration).
 * codexAlert = mapped item from listAlertsForUser (id/name/tokenAddress/
 * networkId/priceTarget/direction/created); meta = alerts:meta payload or null.
 */
export function buildRuleFromLegacy(codexAlert, meta) {
  return {
    id: newRuleId(),
    type: 'price',
    engine: 'codex',
    status: 'active',
    token: {
      address: codexAlert.tokenAddress,
      networkId: codexAlert.networkId,
      symbol: meta?.symbol || '',
      logo: meta?.logo || '',
    },
    condition: {
      direction: codexAlert.direction,
      targetPrice: codexAlert.priceTarget,
      mode: meta?.mode || 'price',
      displayValue: meta?.displayValue || String(codexAlert.priceTarget),
    },
    repeat: 'once',
    codexWebhookId: codexAlert.id,
    name: codexAlert.name || 'Price alert',
    createdAt: meta?.createdAt || Date.now(),
    lastTriggeredAt: 0,
    lastTriggerPrice: 0,
  }
}
