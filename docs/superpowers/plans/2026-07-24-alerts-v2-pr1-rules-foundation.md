# Alerts 2.0 — PR 1: Rules Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scattered alert state (Codex webhook + KV meta + device localStorage) with a unified KV rule model that supports editing, pausing, recurring (re-arm) alerts, and preset-chip creation — while keeping every existing alert working via lazy migration.

**Architecture:** A new `api/_lib/alert-rules.js` KV store module owns rule records (`alerts:rules:{userId}` hash). `api/alerts.js` becomes rule CRUD (POST/GET/PATCH/DELETE) that transparently manages Codex webhooks for price rules (`ONCE` for one-shot, `INDEFINITE` for recurring). `api/webhook.js` consults the rule on fire: recurring rules get cooldown + hysteresis anti-spam; one-shot rules are consumed. The client hook `useAlerts` exposes `rules` + `updateAlert` while deriving a legacy-shaped `alerts` array so desktop `AlertButton` keeps working untouched.

**Tech Stack:** React 18 + plain CSS (trading app conventions), Vercel serverless + Upstash KV, Codex GraphQL webhooks, lucide-react.

**Spec:** `docs/superpowers/specs/2026-07-24-alerts-v2-design.md` (sections 1, 4-partial, 5)

## Global Constraints

- No TypeScript in app code (`.jsx`/`.js` only). Plain CSS paired with the component.
- Trading app: relative imports (no `@/` alias), icons from `lucide-react`.
- Day mode selector in trading is `body.theme-light ...` — NEVER `.app.app-day-mode`.
- No emojis anywhere. Single dash in comments.
- **Do NOT run `git commit` or `git push`** — the user approves every git operation manually (standing project rule). Checkpoints = green build instead of commits.
- No test infrastructure in this repo. Verification = `npm run build:trading` (check-critical-path must stay green) + curl + browser checks.
- Every new/changed `/api` behavior needs dev parity in `packages/server/index.js` (dev Express proxies `/api`).
- Codex calls the PROD webhook callback only — recurring/once trigger behavior is verified on Vercel preview/prod, not localhost.
- Rule cap: max 25 active rules per user (400 over cap).
- Existing per-user rate limit (30/min, bucket 'alerts') covers all methods including the new PATCH.
- The mobile alert sheet CSS prefix is `mals-` (NOT `mas-` — the shipped file uses `mals-`).

## File Map

| File | Action | Task |
|---|---|---|
| `apps/trading/api/_lib/alert-rules.js` | Create | 1 |
| `apps/trading/api/alerts.js` | Modify (rule CRUD, PATCH, migration) | 2 |
| `packages/server/index.js` (~line 20759) | Modify (dev parity: `rules: []`, PATCH stub, `ruleId` delete) | 2 |
| `apps/trading/api/webhook.js` | Modify (recurring anti-spam, once-consume, richer record) | 3 |
| `apps/trading/src/hooks/useAlerts.js` | Modify (rules state, `updateAlert`, derived legacy `alerts`) | 4 |
| `apps/trading/src/components/mobile/MobileAlertSheet.jsx` (+`.css`) | Modify (preset chips, repeat toggle, edit mode) | 5 |
| `apps/trading/src/components/mobile/home/MobileAlertsScreen.jsx` (+`.css`) | Modify (repeat badge, pause toggle) | 6 |
| `apps/trading/src/App.jsx` | Modify (thread `updateAlert`) | 6 |
| `apps/trading/src/components/mobile/home/MobileHomeShell.jsx` | Modify (pass `updateAlert` through) | 6 |

## KV Schema (produced by this PR)

```
alerts:rules:{userId}          hash: ruleId -> JSON rule record
alerts:meta:{webhookId}        (existing) gains: ruleId, repeat, symbol, logo
alerts:user:{userId}           (existing) set of webhookIds - unchanged
alerts:triggered:{userId}      (existing) trigger records gain: symbol, logo, ruleId
```

Rule record (the single source of truth):

```json
{
  "id": "r_1753350000000_ab12",
  "type": "price",
  "engine": "codex",
  "status": "active",
  "token": { "address": "0x...", "networkId": 1, "symbol": "PEPE", "logo": "https://..." },
  "condition": { "direction": "above", "targetPrice": 0.000012, "mode": "price", "displayValue": "0.000012" },
  "repeat": "once",
  "codexWebhookId": "wh_...",
  "name": "PEPE above $0.000012",
  "createdAt": 1753350000000,
  "lastTriggeredAt": 0,
  "lastTriggerPrice": 0
}
```

Notes: `type` is always `'price'` and `engine` always `'codex'` in this PR (pct/cron arrive in PR 2 — the fields exist so PR 2 adds values, not schema). `status` is `'active' | 'paused'` (paused = Codex webhook deleted, rule kept; resume recreates it).

---

### Task 1: `api/_lib/alert-rules.js` — rule store module

**Files:**
- Create: `apps/trading/api/_lib/alert-rules.js`

**Interfaces:**
- Produces (all async, all take a `kv` client as first arg — the module does NOT own KV init, callers pass their existing lazy client; every function is a safe no-op / empty result when `kv` is null):
  - `listRules(kv, userId)` -> `Rule[]` (parsed, invalid JSON rows skipped)
  - `getRule(kv, userId, ruleId)` -> `Rule | null`
  - `putRule(kv, userId, rule)` -> void (HSET full record)
  - `deleteRule(kv, userId, ruleId)` -> void (HDEL)
  - `countActiveRules(kv, userId)` -> number (status === 'active')
  - `newRuleId()` -> `'r_{ts}_{rand4}'`
  - `buildRuleFromLegacy(codexAlert, meta)` -> Rule (migration helper; `codexAlert` = the mapped item from `listAlertsForUser`, `meta` = parsed `alerts:meta:{webhookId}` or null)
- Consumed by: Task 2 (`alerts.js`), Task 3 (`webhook.js`).

- [ ] **Step 1: Write the module**

```js
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
```

- [ ] **Step 2: Build check**

Run: `npm run build:trading`
Expected: green incl. `[check-critical-path]` (the module is server-side only; build proves no accidental client import breakage).

### Task 2: `api/alerts.js` rule CRUD + lazy migration + dev parity

**Files:**
- Modify: `apps/trading/api/alerts.js`
- Modify: `packages/server/index.js` (route `app.all('/api/alerts', ...)` at ~line 20759)

**Interfaces:**
- Consumes: Task 1 module (`listRules, getRule, putRule, deleteRule, countActiveRules, newRuleId, buildRuleFromLegacy` — import `from './_lib/alert-rules.js'`); existing `codexQuery`, `createAlert` (Codex mutation), `deleteAlert` (Codex mutation), `recordAlertOwnership`, `forgetAlertOwnership`, `listAlertsForUser`, `listTriggeredForUser`, `removeTriggered`, `getKv`.
- Produces (API contract for Tasks 4-6):
  - `GET /api/alerts` -> `{ rules: Rule[], alerts: LegacyAlert[], triggered: Trigger[] }`. `alerts` = legacy-shaped rows derived from active price rules `{ id: rule.id, name, status: 'ACTIVE', tokenAddress, networkId, priceTarget, direction, repeat, paused }` — kept so stale client bundles don't blank.
  - `POST /api/alerts` body `{ tokenAddress, networkId, priceTarget, direction, name, repeat?, mode?, displayValue?, symbol?, logo? }` -> `201` with the created rule (plus legacy top-level fields `id` (= ruleId), `tokenAddress`, `networkId`, `priceTarget`, `direction`, `name`).
  - `PATCH /api/alerts` body `{ ruleId, updates: { priceTarget?, direction?, mode?, displayValue?, name?, repeat?, status? } }` -> `{ rule }`.
  - `DELETE /api/alerts?ruleId=...` -> `{ ok: true }`. Legacy `?id=` (webhookId) and `?triggeredId=` paths unchanged.

- [ ] **Step 1: Extend the Codex webhook creator for recurrence**

In `createAlert(body)` change the signature usage: it already reads `{ tokenAddress, networkId, priceTarget, direction, name }` from `body`. Add `repeat`:

```js
const { tokenAddress, networkId, priceTarget, direction = 'above', name, repeat = 'once' } = body
```

and in the mutation input replace the hardcoded recurrence line:

```js
alertRecurrence: repeat === 'recurring' ? 'INDEFINITE' : 'ONCE',
```

- [ ] **Step 2: Add imports and a webhook-rotation helper**

At the top of `alerts.js`:

```js
import { listRules, getRule, putRule, deleteRule as deleteRuleRecord, countActiveRules, newRuleId, buildRuleFromLegacy } from './_lib/alert-rules.js'
```

(Namespacing note: the file already has a local `deleteAlert` = Codex webhook delete; the store's `deleteRule` is imported as `deleteRuleRecord` to keep both readable.)

Below the ownership helpers add:

```js
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
```

- [ ] **Step 3: Lazy migration inside GET**

Replace the GET case with:

```js
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
        await putRule(kv, userId, rule)
        // Backfill ruleId into meta so the webhook receiver can find the rule.
        await recordAlertOwnership(userId, a.id, { ...(meta || {}), ruleId: rule.id })
        rules.push(rule)
      }
    }

    // Self-heal: a once-rule whose webhook is gone or INACTIVE has fired
    // (or was deleted out-of-band) - consume the rule record.
    const codexById = new Map(codexAlerts.map(a => [a.id, a]))
    const alive = []
    for (const r of rules) {
      const wh = r.codexWebhookId ? codexById.get(r.codexWebhookId) : null
      const consumed = r.engine === 'codex' && r.status === 'active' && r.repeat === 'once'
        && (!wh || wh.status !== 'ACTIVE')
      if (consumed) { await deleteRuleRecord(kv, userId, r.id); continue }
      alive.push(r)
    }

    // Legacy-shaped rows so stale bundles keep rendering.
    const legacy = alive
      .filter(r => r.type === 'price' && r.status !== 'paused')
      .map(r => ({
        id: r.id,
        name: r.name,
        status: 'ACTIVE',
        tokenAddress: r.token.address,
        networkId: r.token.networkId,
        priceTarget: r.condition.targetPrice,
        direction: r.condition.direction,
        repeat: r.repeat,
        paused: false,
      }))

    return res.json({ rules: alive, alerts: legacy, triggered })
  } catch (err) {
    console.error('[alerts] list failed:', err.message)
    return res.json({ rules: [], alerts: [], triggered: [], fallback: true })
  }
}
```

- [ ] **Step 4: POST creates a rule**

Replace the POST case body (keep the existing `CODEX_WEBHOOK_SECRET` / `WEBHOOK_CALLBACK_URL` 503 guards at the top of the case):

```js
case 'POST': {
  if (!CODEX_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Webhook secret not configured', code: 'WEBHOOK_SECRET_MISSING' })
  }
  if (!WEBHOOK_CALLBACK_URL) {
    return res.status(503).json({ error: 'Webhook callback URL not configured', code: 'WEBHOOK_CALLBACK_MISSING' })
  }
  const kv = await getKv()
  const { tokenAddress, networkId, priceTarget, direction = 'above', name, repeat = 'once', mode = 'price', displayValue = '', symbol = '', logo = '' } = req.body || {}
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
```

- [ ] **Step 5: PATCH edits / pauses / resumes**

Add a new case (and add `PATCH` to the `Access-Control-Allow-Methods` header string at the top of the handler):

```js
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
  if (updates.direction !== undefined) { next.condition = { ...next.condition, direction: updates.direction }; conditionChanged = true }
  if (updates.mode !== undefined) next.condition = { ...next.condition, mode: updates.mode }
  if (updates.displayValue !== undefined) next.condition = { ...next.condition, displayValue: updates.displayValue }
  if (updates.name !== undefined) next.name = updates.name
  if (updates.repeat !== undefined && updates.repeat !== next.repeat) { next.repeat = updates.repeat === 'recurring' ? 'recurring' : 'once'; conditionChanged = true }
  if (updates.status !== undefined) next.status = updates.status === 'paused' ? 'paused' : 'active'

  const pausing = rule.status === 'active' && next.status === 'paused'
  const resuming = rule.status === 'paused' && next.status === 'active'

  if (pausing) {
    await detachWebhook(userId, next)
    next.codexWebhookId = null
  } else if (resuming || (conditionChanged && next.status === 'active')) {
    // Rotate: drop the old webhook (if any), attach a fresh one for the
    // new condition. Rule id stays stable; webhook id rotates.
    await detachWebhook(userId, next)
    next.codexWebhookId = await attachWebhook(userId, next)
  }

  await putRule(kv, userId, next)
  return res.json({ rule: next })
}
```

- [ ] **Step 6: DELETE gains `?ruleId=`**

Extend the DELETE case — insert BEFORE the legacy `id` branch:

```js
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
  return res.json({ ok: true })
}
if (!id) return res.status(400).json({ error: 'id required' })
// legacy path unchanged below
```

- [ ] **Step 7: Dev parity in `packages/server/index.js`**

In the `/api/alerts` route (~20759):
- GET success response: `return res.json({ rules: [], alerts, triggered: [] })` (add `rules: []`).
- Degraded GET catch response: add `rules: []` too.
- Add before the final 405: `if (req.method === 'PATCH') return res.json({ ok: true, dev: true })`.
- DELETE: add `if (req.query.ruleId) return res.json({ ok: true, dev: true })` next to the `triggeredId` branch.

- [ ] **Step 8: Verify**

Run: `npm run build:trading` — green.
Dev curl (Express running): `curl -s localhost:3001/api/alerts | head -c 300` -> response contains `"rules":[`.
Curl PATCH: `curl -s -X PATCH localhost:3001/api/alerts -H 'Content-Type: application/json' -d '{"ruleId":"x"}'` -> `{ ok: true, dev: true }`.

### Task 3: `api/webhook.js` — recurring anti-spam + once-consume

**Files:**
- Modify: `apps/trading/api/webhook.js`

**Interfaces:**
- Consumes: `alerts:meta:{webhookId}` (now carries `ruleId`, `repeat`, `symbol`, `logo`); Task 1 store (`getRule, putRule, deleteRule`) imported `from './_lib/alert-rules.js'`.
- Produces: trigger records in `alerts:triggered:{userId}` gain `symbol`, `logo`, `ruleId` fields (consumed by Task 4). Rule state updates: recurring -> `lastTriggeredAt`/`lastTriggerPrice`; once -> rule record deleted.

- [ ] **Step 1: Import the store**

```js
import { getRule, putRule, deleteRule } from './_lib/alert-rules.js'
```

- [ ] **Step 2: Rework `persistTrigger` with rule awareness**

Replace the body of `persistTrigger(webhookId, data)`:

```js
async function persistTrigger(webhookId, data) {
  const kv = await getKv()
  if (!kv) return null
  try {
    const raw = await kv.get(`alerts:meta:${webhookId}`)
    const meta = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null
    if (!meta?.userId) return null

    const now = Date.now()
    const priceUsd = parseFloat(data.priceUsd) || 0
    const rule = meta.ruleId ? await getRule(kv, meta.userId, meta.ruleId) : null

    // Recurring anti-spam: INDEFINITE webhooks re-fire on every cross.
    // Notify at most once per cooldown AND only when price moved past
    // hysteresis from the previous notified trigger.
    if (rule && rule.repeat === 'recurring') {
      const COOLDOWN_MS = 10 * 60 * 1000
      const HYSTERESIS = 0.01 // 1%
      const withinCooldown = rule.lastTriggeredAt && (now - rule.lastTriggeredAt) < COOLDOWN_MS
      const withinHysteresis = rule.lastTriggerPrice > 0 && priceUsd > 0
        && Math.abs(priceUsd - rule.lastTriggerPrice) / rule.lastTriggerPrice < HYSTERESIS
      if (withinCooldown || withinHysteresis) return null
      await putRule(kv, meta.userId, { ...rule, lastTriggeredAt: now, lastTriggerPrice: priceUsd })
    }

    const record = {
      id: `t_${webhookId}_${now}`,
      webhookId,
      ruleId: meta.ruleId || null,
      tokenAddress: data.address || meta.tokenAddress || '',
      networkId: data.networkId || meta.networkId || 0,
      priceUsd,
      priceTarget: meta.priceTarget || 0,
      direction: meta.direction || 'above',
      name: meta.name || 'Price alert',
      symbol: meta.symbol || '',
      logo: meta.logo || '',
      triggeredAt: now,
    }
    const key = `alerts:triggered:${meta.userId}`
    await kv.lpush(key, JSON.stringify(record))
    await kv.ltrim(key, 0, 49)

    // Once-rules are consumed on fire (the Codex ONCE webhook self-deactivates;
    // GET also self-heals if this write races). History lives in triggered.
    if (rule && rule.repeat !== 'recurring') {
      await deleteRule(kv, meta.userId, rule.id)
    }

    return { record, userId: meta.userId }
  } catch (err) {
    console.warn('[webhook] persistTrigger failed:', err?.message)
    return null
  }
}
```

(Push payload in `sendPushForTrigger` is unchanged — `record.name` already carries the display label; `record.symbol` is now available if we improve copy later.)

- [ ] **Step 3: Verify**

Run: `npm run build:trading` — green.
Static check: `node --check apps/trading/api/webhook.js` (plain ESM syntax check) -> no output.
Full trigger behavior (recurring cooldown, once-consume) is Task 7 preview/prod work.

### Task 4: `useAlerts.js` — rules state + `updateAlert`

**Files:**
- Modify: `apps/trading/src/hooks/useAlerts.js`

**Interfaces:**
- Consumes: Task 2 API contract.
- Produces (hook return, superset of today's): `{ alerts, rules, triggered, triggeredAlerts, loading, createAlert, updateAlert, deleteAlert, deleteTriggered, refresh, dismissTriggered }`.
  - `rules` = raw server rule records (incl. paused).
  - `alerts` = legacy-shaped ACTIVE price rows (server's `alerts` field) — desktop `AlertButton` and `useTokenAlerts` keep working with `id` now being the ruleId.
  - `createAlert({ tokenAddress, networkId, priceTarget, direction, name, repeat, meta })` — `meta.symbol/logo/mode/displayValue` now ALSO sent to the server body (server-side display meta).
  - `updateAlert(ruleId, updates)` -> PATCH; resolves to the updated rule.
  - `deleteAlert(ruleId)` -> DELETE `?ruleId=`.

- [ ] **Step 1: `refresh()` consumes `rules`**

Inside the `res.ok` block, after `const data = await res.json()` add:

```js
const serverRules = Array.isArray(data.rules) ? data.rules : []
setRules(serverRules)
```

with new state at the top: `const [rules, setRules] = useState([])`.
Keep the existing `data.alerts` -> `setAlerts(all.filter(a => a.status === 'ACTIVE'))` line and the whole triggered/meta-merge block as-is (server records now carry `symbol`/`logo`, so the localStorage merge only fills rows created before this PR — leave the fallback in place).

In the triggered merge, prefer server fields over localStorage:

```js
const merged = serverTriggered.map(t => {
  const meta = storedMeta[t.webhookId] || {}
  return {
    ...t,
    symbol: t.symbol || meta.symbol || '',
    logo: t.logo || meta.logo || '',
    mode: meta.mode || 'price',
    displayValue: meta.displayValue || (t.priceTarget ? String(t.priceTarget) : ''),
  }
})
```

- [ ] **Step 2: `createAlert` sends server-side display meta + repeat**

Change the POST body construction:

```js
const res = await fetch(ALERTS_API, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    tokenAddress, networkId, priceTarget, direction, name,
    repeat: repeat || 'once',
    mode: meta?.mode || 'price',
    displayValue: meta?.displayValue || '',
    symbol: meta?.symbol || '',
    logo: meta?.logo || '',
  }),
  signal: AbortSignal.timeout(10000),
})
```

and the signature: `async ({ tokenAddress, networkId, priceTarget, direction, name, repeat, meta })`.
After success add `setRules(prev => [...prev, alert])` next to the existing `setAlerts(prev => [...prev, alert])` (the POST response IS the rule record with legacy fields flattened). Keep the localStorage meta write and the instant-trigger block untouched.

- [ ] **Step 3: Add `updateAlert`**

```js
const updateAlert = useCallback(async (ruleId, updates) => {
  const headers = await buildAuthHeaders({ 'Content-Type': 'application/json' })
  if (!headers) throw new Error('Sign in required')
  const res = await fetch(ALERTS_API, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ ruleId, updates }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Failed: ${res.status}`)
  }
  const { rule } = await res.json()
  setRules(prev => prev.map(r => (r.id === ruleId ? rule : r)))
  // Keep the legacy list coherent without waiting for the next poll.
  refresh()
  return rule
}, [buildAuthHeaders, refresh])
```

- [ ] **Step 4: `deleteAlert` targets rules**

```js
const deleteAlert = useCallback(async (id) => {
  const headers = await buildAuthHeaders()
  if (!headers) throw new Error('Sign in required to delete alerts')
  const res = await fetch(`${ALERTS_API}?ruleId=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
    signal: AbortSignal.timeout(10000),
  })
  if (res.ok) {
    setAlerts(prev => prev.filter(a => a.id !== id))
    setRules(prev => prev.filter(r => r.id !== id))
  }
}, [buildAuthHeaders])
```

(All `alerts` rows now carry ruleIds, so `?ruleId=` is always correct; the server's legacy `?id=` path exists only for stale bundles.)

- [ ] **Step 5: Export + poll deps**

Return object gains `rules, updateAlert`. Poll effect condition becomes `if (alerts.length === 0 && rules.length === 0 && triggered.length === 0) return` with deps `[alerts.length, rules.length, triggered.length, refresh]` (paused rules keep the poll alive so resume reflects promptly).

- [ ] **Step 6: Build**

Run: `npm run build:trading` — green.

### Task 5: MobileAlertSheet — preset chips, repeat toggle, edit mode

**Files:**
- Modify: `apps/trading/src/components/mobile/MobileAlertSheet.jsx`
- Modify: `apps/trading/src/components/mobile/MobileAlertSheet.css`
- Modify: `apps/trading/src/components/mobile/MobileTokenPage.jsx` (pass `rules` + `updateAlert` — mirror how `alerts`/`deleteAlert` are already passed)
- Modify: `apps/trading/src/App.jsx` (destructure `rules, updateAlert` at line ~691; add to the `MobileTokenPage` props at ~1536)

**Interfaces:**
- Consumes: `updateAlert(ruleId, updates)`, `rules` from Task 4; existing `createAlert`, `deleteAlert`, `useTokenAlerts`.
- Produces: `<MobileAlertSheet open onClose token alerts rules createAlert updateAlert deleteAlert />`.

- [ ] **Step 1: State + presets**

Add state and the preset list:

```js
const [repeat, setRepeat] = useState('once')
const [editingId, setEditingId] = useState(null)

// Price-mode preset chips: pct of live price ('2x' doubles it).
const PRESETS = [
  { label: '+5%', mult: 1.05 },
  { label: '+10%', mult: 1.10 },
  { label: '+25%', mult: 1.25 },
  { label: '-10%', mult: 0.90 },
  { label: '2x', mult: 2 },
]

const applyPreset = useCallback((p) => {
  if (!currentPrice) return
  const target = currentPrice * p.mult
  // Enough significant digits for micro-caps, trimmed for majors.
  const str = target >= 1 ? target.toFixed(2) : target.toPrecision(4)
  setInputValue(str)
  setDirection(p.mult >= 1 ? 'above' : 'below')
}, [currentPrice])
```

Reset on open: extend the existing open-effect to also `setRepeat('once'); setEditingId(null)`.

- [ ] **Step 2: Render chips + repeat toggle**

Chips render only in price mode, between the direction toggle and the input:

```jsx
{mode === 'price' && currentPrice > 0 && (
  <div className="mals-presets">
    {PRESETS.map(p => (
      <button key={p.label} type="button" className="mals-preset" onClick={() => applyPreset(p)}>
        {p.label}
      </button>
    ))}
  </div>
)}
```

Repeat toggle after the input block (same `mals-toggle` pattern, `Repeat` icon from lucide-react added to imports):

```jsx
<div className="mals-toggle">
  <button type="button" className={`mals-toggle-btn${repeat === 'once' ? ' active' : ''}`} onClick={() => setRepeat('once')}>Once</button>
  <button type="button" className={`mals-toggle-btn${repeat === 'recurring' ? ' active' : ''}`} onClick={() => setRepeat('recurring')}>
    <Repeat size={13} strokeWidth={2.5} /> Every time
  </button>
</div>
```

- [ ] **Step 3: Edit mode**

Add `rules` and `updateAlert` to props. Active-alert rows come from rules (fall back to legacy alerts shape which now also carries ruleIds — `useTokenAlerts(alerts, ...)` keeps working). Each row gains an edit button:

```jsx
<button type="button" className="mals-active-edit" onClick={() => startEdit(a)} aria-label="Edit alert">
  <Pencil size={13} />
</button>
```

(`Pencil` added to lucide imports.)

```js
const startEdit = useCallback((a) => {
  const rule = (rules || []).find(r => r.id === a.id)
  setEditingId(a.id)
  setMode(rule?.condition?.mode || 'price')
  setDirection(rule?.condition?.direction || a.direction || 'above')
  setRepeat(rule?.repeat || 'once')
  setInputValue(rule?.condition?.displayValue || String(a.priceTarget || ''))
  setCreated(false)
  setError(null)
}, [rules])
```

`handleCreate` branches on `editingId`:

```js
if (editingId) {
  await updateAlert(editingId, {
    priceTarget: targetPrice,
    direction,
    mode,
    displayValue: inputValue,
    repeat,
    name: label,
  })
  setEditingId(null)
  setCreated(true)
  setInputValue('')
  return
}
```

and `createAlert` gains `repeat` in its call. UI copy: title shows `{editingId ? 'Edit Alert' : 'Price Alert'}`, submit button `{editingId ? 'Save changes' : 'Set Alert'}`; an editing row is highlighted (`mals-active-row--editing` when `a.id === editingId`); a small "Cancel" text button next to the title exits edit mode (`setEditingId(null); setInputValue('')`).

Note: the input-reset effect currently fires on `[open, mode]` — guard it so entering edit mode (which calls `setMode`) doesn't wipe the prefilled value: change `startEdit` to set a ref `skipResetRef.current = true` before `setMode`, and in the effect `if (skipResetRef.current) { skipResetRef.current = false; return }`.

- [ ] **Step 4: CSS**

Add to `MobileAlertSheet.css` (mirror existing `mals-` values):

```css
.mals-presets { display: flex; gap: 6px; flex-wrap: wrap; }
.mals-preset {
  padding: 7px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.07);
  color: rgba(245, 245, 247, 0.75);
}
.mals-preset:active { background: rgba(255, 255, 255, 0.12); }
.mals-active-edit { background: none; border: none; color: rgba(245, 245, 247, 0.45); padding: 4px; display: flex; }
.mals-active-row--editing { outline: 1px solid rgba(245, 245, 247, 0.25); }
.mals-cancel { margin-left: 8px; background: none; border: none; font-size: 12px; color: rgba(245, 245, 247, 0.5); }

body.theme-light .mals-preset { background: rgba(0, 0, 0, 0.04); border-color: rgba(0, 0, 0, 0.08); color: #475569; }
body.theme-light .mals-preset:active { background: rgba(0, 0, 0, 0.1); }
body.theme-light .mals-active-edit, body.theme-light .mals-cancel { color: #64748b; }
body.theme-light .mals-active-row--editing { outline-color: rgba(15, 23, 42, 0.3); }
```

- [ ] **Step 5: Thread props**

`App.jsx` ~691: destructure `rules, updateAlert` from `useAlerts()`. At the `MobileTokenPage` mount (~1536) add `rules={rules} updateAlert={updateAlert}`. In `MobileTokenPage.jsx` add both to the destructured props and forward into `<MobileAlertSheet ... rules={rules} updateAlert={updateAlert} />`.

- [ ] **Step 6: Build + browser check**

Run: `npm run build:trading` — green.
Browser (mobile viewport, token page): chips fill the input and flip direction; repeat toggle switches; edit (pencil on an active row) prefills the form, save exits edit mode. Signed-out create still errors gracefully.

### Task 6: MobileAlertsScreen — repeat badge + pause toggle

**Files:**
- Modify: `apps/trading/src/components/mobile/home/MobileAlertsScreen.jsx` + `.css`
- Modify: `apps/trading/src/components/mobile/home/MobileHomeShell.jsx` (accept + forward `rules`, `updateAlert`)
- Modify: `apps/trading/src/App.jsx` (pass `rules`/`updateAlert` to `MobileHomeShell` at ~1501, next to the existing `deleteAlert`/`triggered` props)

**Interfaces:**
- Consumes: `rules` (raw records incl. paused), `updateAlert(ruleId, { status })` from Task 4.
- Produces: Active section rendered from `rules` (not the legacy `alerts` prop, which stays for the badge/back-compat), each row with repeat badge, pause/resume, delete.

- [ ] **Step 1: Render from rules**

Add `rules`, `updateAlert` to props. Replace the `list` source:

```js
const list = Array.isArray(rules) && rules.length > 0
  ? rules.filter(r => r.type === 'price')
  : (Array.isArray(alerts) ? alerts : [])
```

Rows adapt (rule records nest fields): read `a.condition?.targetPrice ?? a.priceTarget`, `a.condition?.direction ?? a.direction`, `a.token?.address ?? a.tokenAddress`, `a.token?.networkId ?? a.networkId`, `a.token?.symbol ?? a.symbol` — do this once at the top of the map:

```js
const target = a.condition?.targetPrice ?? a.priceTarget
const dir = a.condition?.direction ?? a.direction
const paused = a.status === 'paused'
const recurring = a.repeat === 'recurring'
```

Row content adds after `.mal-cond`:

```jsx
{recurring && <span className="mal-repeat"><Repeat size={11} strokeWidth={2.5} /> every time</span>}
{paused && <span className="mal-paused">Paused</span>}
```

(`Repeat`, `Pause`, `Play` added to the lucide import.) `openAlertToken(a)` call sites pass a normalized object: `openAlertToken({ tokenAddress: a.token?.address ?? a.tokenAddress, networkId: a.token?.networkId ?? a.networkId, symbol: a.token?.symbol ?? a.symbol, name: a.name })`.

- [ ] **Step 2: Pause toggle button**

Between `.mal-row-main` and the delete button:

```jsx
{updateAlert && (
  <button
    type="button"
    className="mal-pause"
    disabled={busyId === a.id}
    onClick={async () => {
      setBusyId(a.id)
      try { await updateAlert(a.id, { status: paused ? 'active' : 'paused' }) }
      catch { /* row stays as-is; next poll reconciles */ }
      finally { setBusyId(null) }
    }}
    aria-label={paused ? 'Resume alert' : 'Pause alert'}
  >
    {paused ? <Play size={15} strokeWidth={2} /> : <Pause size={15} strokeWidth={2} />}
  </button>
)}
```

Paused rows get `mal-row--paused` on the row div (dim it).

- [ ] **Step 3: CSS**

```css
.mal-repeat { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; color: rgba(245, 245, 247, 0.4); text-transform: uppercase; letter-spacing: 0.04em; }
.mal-paused { font-size: 10px; color: rgba(245, 245, 247, 0.45); text-transform: uppercase; letter-spacing: 0.04em; }
.mal-row--paused .mal-row-main { opacity: 0.45; }
.mal-pause { background: none; border: none; color: rgba(245, 245, 247, 0.45); padding: 6px; display: flex; }

body.theme-light .mal-repeat, body.theme-light .mal-paused { color: #94a3b8; }
body.theme-light .mal-pause { color: #64748b; }
```

- [ ] **Step 4: Thread props**

`MobileHomeShell.jsx`: add `rules`, `updateAlert` to props and forward into `<MobileAlertsScreen ... rules={rules} updateAlert={updateAlert} />` (next to the existing `alerts`/`deleteAlert`). `App.jsx` ~1501: add `rules={rules} updateAlert={updateAlert}` to the `MobileHomeShell` props.

- [ ] **Step 5: Build + browser check**

Run: `npm run build:trading` — green.
Browser: Alerts tab renders (dev = empty lists, expected). With a seeded `rules` array via React devtools: repeat badge, pause dim state, pause/play button render.

### Task 7: Preview/prod verification checklist

No file changes — the trigger paths only run against real Codex + KV.

- [ ] **Step 1: Migration** — deployed build, account with pre-PR alerts: open the app -> GET returns `rules` mirroring the old alerts; alerts render identically on a SECOND device (symbol/logo now server-side).
- [ ] **Step 2: Create + cap** — create a rule via preset chip (two taps). Create up to the cap on a throwaway path is impractical — instead verify the cap branch by temporarily reading the code path (or trusting the 400 contract) and confirming a normal create returns the rule record with `codexWebhookId` set.
- [ ] **Step 3: Edit** — change a rule's target -> Codex webhook list (GET response reconciliation) shows the NEW webhook id on the rule; old webhook gone; alert fires at the new target, not the old one.
- [ ] **Step 4: Pause/resume** — pause -> rule shows Paused, no fire when price crosses; resume -> fires again.
- [ ] **Step 5: Recurring** — recurring rule on a liquid token with target ~0.3% away: first cross notifies; immediate re-crosses inside 10 min or inside 1% do NOT re-notify; a later cross (past both) notifies again. Trigger history shows both records.
- [ ] **Step 6: Once-consume** — one-shot rule fires -> disappears from Active, appears in Triggered, push arrives (existing Stage-2 path).
- [ ] **Step 7: Legacy client** — with the OLD bundle cached (or curl), GET still returns a sane `alerts` array (legacy shape) so stale sessions don't blank.

---

## Self-review notes (done at plan time)

- Spec coverage (PR-1 slice): rule model -> Tasks 1-2; lazy migration -> Task 2 Step 3; edit -> Tasks 2 (PATCH) + 5; pause -> Tasks 2 + 6; re-arm/INDEFINITE + anti-spam -> Tasks 2 Step 1 + 3; preset chips -> Task 5; server-side display meta (cross-device fix) -> Tasks 2/3/4; parity -> Task 2 Step 7; cap 25 -> Task 2 Step 4. PR-2/3/4 items (cron, pct, Telegram, chart lines, swipe) intentionally absent.
- Type consistency: rule shape identical across alert-rules.js (produce), alerts.js (CRUD), webhook.js (consume), useAlerts (state), sheet/screen (render nested `condition`/`token` with legacy fallbacks). `deleteRule` import collision in alerts.js resolved via `deleteRuleRecord` alias.
- Judgment calls: legacy `alerts` field kept one release for stale bundles; once-fired Codex webhooks left INACTIVE on Codex (no GC this PR — GET self-heal keeps the UI truthful); `useTokenAlerts` untouched (legacy rows carry ruleIds); recurring anti-spam constants COOLDOWN 10 min / HYSTERESIS 1% live in webhook.js as named consts.
