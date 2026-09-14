# Alerts 2.0 — Wave 2: Cron Engine + % Move Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the second alert engine: a Vercel Cron (every 10 minutes) that evaluates "% change over window" rules against its own KV price history, fires trigger records + pushes through a shared notify module, and a `% Move` segment in the mobile alert sheet.

**Architecture:** Rules of `type:'pct'` / `engine:'cron'` reuse the wave-1 rule store; alerts.js dual-writes them into a global hash `alerts:cron:rules` so the cron reads ONE structure per tick. The cron derives the watched-token set from that hash in memory (design change vs spec: the separate `alerts:cron:tokens` KV set is DROPPED — one source of truth, no refcount maintenance). Push sending is extracted from webhook.js into `api/_lib/alert-notify.js`, consumed by both engines (wave 3 adds Telegram there).

**Tech Stack:** Vercel Cron + serverless, Upstash KV, Codex `getTokenPrices` (batched), React 18 + plain CSS.

**Spec:** `docs/superpowers/specs/2026-07-24-alerts-v2-design.md` (section 2, 3-partial, 4-partial). Same branch as wave 1 (`evgeniy-alerts-v2`), one PR.

## Global Constraints

- **Do NOT run `git commit` or `git push`** — NO-COMMITS mode; working tree only.
- No TypeScript. No emojis. Single dash in comments. lucide-react icons. Day mode = `body.theme-light`.
- **Codex cost ceiling:** the cron runs `*/10 * * * *`; a tick with zero pct rules makes ZERO Codex calls (early exit); with rules, batches of 25 tokens per `getTokenPrices` query.
- Cron auth: `Authorization: Bearer ${CRON_SECRET}` — env already exists (used by 3 existing trading crons); mirror `refresh-token-snapshot.js`'s check.
- Price history: `alerts:px:{networkId}:{address}` list, 1 point/tick, LTRIM cap 150 (~25h).
- pct rule validation: `windowMin` ∈ {60, 1440}; `pct` number 1..500; `direction` ∈ {'up','down','both'}. Cap 25 active rules covers both types (already generic).
- Recurring pct cooldown = its own `windowMin` (a rule fires at most once per window). Once-rules consumed on fire.
- Insufficient history = NO fire: evaluation requires a reference point aged >= 80% of windowMin.
- No test infra. Verification = `node --check` + `npm run build:trading` green + curls; the cron itself is prod/preview-only (Vercel invokes it).
- Trigger records keep the wave-1 shape (`alerts:triggered:{userId}`, same fields) + gain `changePct` for pct fires; `direction` reuses 'above'/'below' for up/down so existing renderers work untouched.

## KV additions (this wave)

```
alerts:cron:rules              global hash: "{userId}:{ruleId}" -> JSON rule copy (pct rules only)
alerts:px:{networkId}:{address}  list of JSON {ts, price}, newest first, cap 150
```

pct rule condition shape: `condition: { windowMin: 60|1440, pct: 10, direction: 'up'|'down'|'both' }`. `engine:'cron'`, `codexWebhookId:null`.

## File Map

| File | Action | Task |
|---|---|---|
| `apps/trading/api/_lib/alert-notify.js` | Create (push extract) | 1 |
| `apps/trading/api/webhook.js` | Modify (consume notify module) | 1 |
| `apps/trading/api/_lib/alert-rules.js` | Modify (global-hash helpers) | 2 |
| `apps/trading/api/alerts.js` | Modify (pct CRUD branches + dual-write) | 2 |
| `packages/server/index.js` | Modify (dev POST pct stub) | 2 |
| `apps/trading/api/cron/check-alert-rules.js` | Create (the engine) | 3 |
| `apps/trading/vercel.json` | Modify (crons entry + maxDuration) | 3 |
| `apps/trading/src/hooks/useAlerts.js` | Modify (pct create fields) | 4 |
| `apps/trading/src/components/mobile/MobileAlertSheet.jsx` (+`.css`) | Modify (% Move segment) | 4 |
| `apps/trading/src/components/mobile/home/MobileAlertsScreen.jsx` | Modify (pct row rendering) | 5 |

---

### Task 1: Extract push into `api/_lib/alert-notify.js`

**Files:**
- Create: `apps/trading/api/_lib/alert-notify.js`
- Modify: `apps/trading/api/webhook.js`

**Interfaces:**
- Produces: `notifyTrigger(kv, userId, record)` — sends Web Push to every `push:subs:{userId}` subscription; silent no-op when VAPID env missing or kv null; prunes 404/410 subs. `record` = the wave-1 trigger record (`name`, `priceUsd`, `tokenAddress`, `id`). Wave 3 will add Telegram inside this same function.
- Consumed by: webhook.js (this task) and the cron (Task 3).

- [ ] **Step 1: Create the module** — move the BODY of webhook.js's `sendPushForTrigger` verbatim into:

```js
/**
 * alert-notify - delivery fan-out for alert triggers (Alerts 2.0 wave 2).
 *
 * One entry point used by BOTH engines (Codex webhook receiver + the
 * pct cron). Currently Web Push only; wave 3 adds Telegram here so the
 * engines never grow channel-specific code.
 */

export async function notifyTrigger(kv, userId, record) {
  await sendPush(kv, userId, record)
}

async function sendPush(kv, userId, record) {
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv || !kv) return
  let subs
  try { subs = await kv.hgetall(`push:subs:${userId}`) } catch { return }
  if (!subs || Object.keys(subs).length === 0) return

  const { default: webpush } = await import('web-push')
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@spectreai.io', pub, priv)

  const price = record.priceUsd >= 1
    ? record.priceUsd.toFixed(2)
    : (record.priceUsd > 0 ? record.priceUsd.toPrecision(4) : '0')
  const payload = JSON.stringify({
    title: record.name || 'Price alert',
    body: `Triggered at $${price}`,
    url: `/#token/${record.tokenAddress}`,
    tag: record.id,
  })

  await Promise.allSettled(Object.entries(subs).map(async ([endpoint, raw]) => {
    let sub
    try { sub = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return }
    try {
      // timeout keeps a hung push endpoint inside the caller's time budget
      await webpush.sendNotification(sub, payload, { TTL: 3600, timeout: 2000 })
    } catch (err) {
      const code = err?.statusCode
      if (code === 404 || code === 410) {
        try { await kv.hdel(`push:subs:${userId}`, endpoint) } catch { /* noop */ }
      } else {
        console.warn('[alert-notify] push send failed:', code, err?.message)
      }
    }
  }))
}
```

- [ ] **Step 2: webhook.js consumes it** — add `import { notifyTrigger } from './_lib/alert-notify.js'`; delete the local `sendPushForTrigger` function; in the `TOKEN_PRICE_EVENT` branch replace `await sendPushForTrigger(persisted.userId, persisted.record)` with `await notifyTrigger(await getKv(), persisted.userId, persisted.record)`.

- [ ] **Step 3: Verify** — `node --check` both files; `npm run build:trading` green.

### Task 2: pct-rule CRUD + global-hash dual-write

**Files:**
- Modify: `apps/trading/api/_lib/alert-rules.js`
- Modify: `apps/trading/api/alerts.js`
- Modify: `packages/server/index.js` (dev POST pct stub)

**Interfaces:**
- Produces (alert-rules.js additions, same kv-first null-safe contract):
  - `putCronRule(kv, userId, rule)` — HSET `alerts:cron:rules` field `` `${userId}:${rule.id}` ``
  - `deleteCronRule(kv, userId, ruleId)` — HDEL same field
  - `listCronRules(kv)` — parse all fields -> `[{ userId, rule }]` (field key split on FIRST colon-after-did is unsafe: privy DIDs contain colons — derive userId from the STORED rule copy instead; store `rule._userId = userId` inside the JSON copy written to the global hash and parse it back; skip malformed).
- Produces (API): POST body may carry `type:'pct'` + `windowMin` + `pct` + `pctDirection` (token/symbol/logo/name/repeat as in wave 1; `priceTarget` NOT required for pct). PATCH `updates` may carry `windowMin`/`pct`/`pctDirection` for pct rules. All pct mutations dual-write per-user hash AND global hash; pause removes from global, resume re-adds; delete removes from both.

- [ ] **Step 1: alert-rules.js helpers**

```js
const CRON_RULES_KEY = 'alerts:cron:rules'

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
```

- [ ] **Step 2: alerts.js POST pct branch** — in the POST case, after reading the body add `type = 'price'`, `windowMin`, `pct`, `pctDirection` to the destructure. Branch:

```js
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
```

The price-rule path below it is untouched. Note: pct POST does NOT require the webhook env guards — move the `CODEX_WEBHOOK_SECRET`/`WEBHOOK_CALLBACK_URL` 503 checks INTO the price branch (below the pct branch) so pct creation works even if webhook env is broken.

- [ ] **Step 3: alerts.js PATCH + DELETE + self-heal awareness**
- PATCH: accept `updates.windowMin`/`updates.pct`/`updates.pctDirection` (same validation; mark `conditionChanged` but note engine==='cron' rules NEVER call attach/detachWebhook — guard the rotate/resume webhook block with `next.engine === 'codex'`). After `putRule`, sync the global hash: `if (next.engine === 'cron') { if (next.status === 'active') await putCronRule(kv, userId, next); else await deleteCronRule(kv, userId, next.id) }`.
- DELETE (`?ruleId=` branch AND the stale-bundle `?id=` rule branch): after `deleteRuleRecord`, add `await deleteCronRule(kv, userId, <ruleId>)` (safe no-op for price rules).
- GET self-heal: the consumption loop must skip cron rules entirely — verify the existing `r.engine === 'codex'` condition already does this (it does; cite it in the report).
- Import the three new helpers in alerts.js.

- [ ] **Step 4: Dev stub** — in packages/server `/api/alerts` POST: at the top add `if (req.body?.type === 'pct') return res.status(201).json({ id: 'r_dev_pct', dev: true, ...req.body })` (dev has no KV; keeps the sheet functional locally).

- [ ] **Step 5: Verify** — `node --check` both api files + packages/server/index.js; build green; dev curls: `curl -s -X POST localhost:3001/api/alerts -H 'Content-Type: application/json' -d '{"type":"pct","tokenAddress":"0x1","networkId":1,"windowMin":60,"pct":10}'` -> 201 with `dev: true`.

### Task 3: The cron engine `api/cron/check-alert-rules.js` + vercel.json

**Files:**
- Create: `apps/trading/api/cron/check-alert-rules.js`
- Modify: `apps/trading/vercel.json` (crons array + functions maxDuration)

**Interfaces:**
- Consumes: `listCronRules(kv)`, `getRule/putRule/deleteRule/deleteCronRule/putCronRule` from `../_lib/alert-rules.js`; `notifyTrigger` from `../_lib/alert-notify.js`; Codex `getTokenPrices`.
- Produces: price points in `alerts:px:*`; trigger records in `alerts:triggered:{userId}` (shape: wave-1 fields + `changePct`); rule state updates mirrored to both hashes.

- [ ] **Step 1: The handler**

```js
/**
 * Vercel Cron - pct-alert engine (Alerts 2.0 wave 2). Runs every 10 min.
 *
 * Cost contract: a tick with zero pct rules makes ZERO Codex calls. With
 * rules: one getTokenPrices query per 25 unique tokens per tick. Price
 * history is self-contained in KV (alerts:px:*) - no dependency on the
 * Hetzner price tables or /api/bars.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET} - only Vercel cron can call.
 */
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
          query: `query($inputs:[GetPriceInput!]){ getTokenPrices(inputs:$inputs){ address networkId priceUsd } }`,
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
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  if (!expectedAuth || req.headers?.authorization !== expectedAuth) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

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
```

- [ ] **Step 2: vercel.json** — add to `crons`: `{ "path": "/api/cron/check-alert-rules", "schedule": "*/10 * * * *" }`; add to `functions`: `"api/cron/check-alert-rules.js": { "maxDuration": 60 }`.

- [ ] **Step 3: Verify** — `node --check` the cron; `python3 -c "import json;json.load(open('apps/trading/vercel.json'))"` (valid JSON); build green. Runtime behavior is preview/prod-only (Vercel invokes with CRON_SECRET); local curl without the header must 401: after dev restart the route does not exist in Express — note that as expected (cron is Vercel-only by design).

### Task 4: Sheet gains the % Move segment

**Files:**
- Modify: `apps/trading/src/hooks/useAlerts.js` (createAlert passes pct fields)
- Modify: `apps/trading/src/components/mobile/MobileAlertSheet.jsx` + `.css`

**Interfaces:**
- `createAlert({ type: 'pct', tokenAddress, networkId, windowMin, pct, pctDirection, repeat, name, meta })` -> POST body carries `type, windowMin, pct, pctDirection` (server Task 2 contract). Price-type calls unchanged.
- Sheet top-level segment: `Price target | % Move` (state `alertType: 'target' | 'pct'`).

- [ ] **Step 1: useAlerts** — extend `createAlert` signature with `type, windowMin, pct, pctDirection` and include them in the POST body when `type === 'pct'` (keep everything else identical; the instant-trigger block only runs when `priceTarget > 0`, so pct creates skip it naturally — cite that in the report).

- [ ] **Step 2: Sheet UI** — add above the Price/MCap toggle a type segment using the same `mals-toggle` pattern: `Price target` / `% Move` (`TrendingUp` icon optional — skip icons if crowded). When `alertType === 'pct'`:
  - HIDE: Price/MCap toggle, Above/Below toggle, price presets, target input, mcap hint.
  - SHOW: window selector (`1h` / `24h` chips, state `windowMin` 60|1440, default 60), pct chips (`5% 10% 25%`, state `pctVal`, default 10, tap selects — chips act as a radio, `mals-preset` styling with an `active` class), direction segment `Rise / Drop / Both` (state `pctDirection`, default 'both').
  - Repeat toggle stays visible for both types.
  - Submit for pct: `createAlert({ type:'pct', tokenAddress: token.address, networkId: token.networkId || 1, windowMin, pct: pctVal, pctDirection, repeat, name: \`${token.symbol} ${pctDirection==='up'?'+':pctDirection==='down'?'-':'±'}${pctVal}% in ${windowMin===60?'1h':'24h'}\`, meta: { symbol: token.symbol, logo: token.logo, mode: 'pct', displayValue: `${pctVal}%` } })`. Button enabled when pctVal set (always true with default) — keep `disabled={creating}` only in pct mode.
  - Edit mode for pct rules: `startEdit` detects `rule.type === 'pct'` -> sets `alertType('pct')`, `windowMin`, `pctVal`, `pctDirection`, `repeat`; save PATCHes `updateAlert(id, { windowMin, pct: pctVal, pctDirection, repeat, name })`. The reset-guard (`skipResetRef`) pattern extends to `alertType` the same way it guards `mode`.
  - Success copy for pct: "Alert set - checks every 10 minutes."
- [ ] **Step 3: CSS** — `.mals-preset.active` (filled like `mals-toggle-btn.active`), `.mals-seg-label` (11px uppercase muted labels "Window" / "Change" / "Direction" above each chip row) + `body.theme-light` counterparts.
- [ ] **Step 4: Verify** — build green; browser (mobile viewport): segment switches, pct controls render, price mode unchanged, signed-out create errors gracefully.

### Task 5: Alerts tab renders pct rules

**Files:**
- Modify: `apps/trading/src/components/mobile/home/MobileAlertsScreen.jsx` (+`.css` if needed)

**Interfaces:**
- Consumes: rules where `type === 'pct'` with `condition: { windowMin, pct, direction }`; triggered records with `changePct`.

- [ ] **Step 1: Active row for pct** — the list filter currently keeps only `type === 'price'`; change to `(r.type === 'price' || r.type === 'pct')`. In the row map, when `a.type === 'pct'`: direction arrow = up for 'up', down for 'down', a `±` glyph (text span, same size) for 'both'; `.mal-cond` renders `{dirLabel}{condition.pct}% in {windowMin === 60 ? '1h' : '24h'}` instead of Above/Below target. Repeat/paused badges and pause/delete buttons work unchanged (they only touch `a.id`/`a.status`/`a.repeat`).
- [ ] **Step 2: Triggered row for pct** — when `t.changePct` is present render `Moved {t.changePct > 0 ? '+' : ''}{t.changePct}% · hit {formatPrice(t.priceUsd)} · {relTime(...)}` (fall back to the existing "Hit ..." line otherwise).
- [ ] **Step 3: Verify** — build green; browser: seed a fake pct rule via devtools state or verify statically that price rules render exactly as before (no regression on the existing path).

### Task 6: Preview/prod verification additions (folds into the overall Task 7 checklist)

- [ ] Cron: Vercel dashboard shows the `*/10` cron registered; manual invoke with the CRON_SECRET header returns `{ ok: true, rules: 0, codexCalls: 0 }` on an empty hash (proves the zero-cost early exit).
- [ ] Create a `10% / 1h / both / recurring` pct rule on a volatile microcap; after >=2 ticks confirm `alerts:px:*` accumulates points (visible indirectly: rule fires only after history covers 80% of the window — expect NO fire in the first ~50 min even if price moves).
- [ ] pct fire lands in Triggered with `changePct`, push arrives, recurring does not re-fire within its window.
- [ ] Pause a pct rule -> next tick skips it (global hash entry removed); resume re-adds.
- [ ] Delete a pct rule -> `alerts:cron:rules` field gone (no ghost evaluation).

---

## Self-review notes (plan time)

- Spec §2 deviations (deliberate, all safety/simplicity): `alerts:cron:tokens` KV set DROPPED (token set derived from the rules hash per tick — one HGETALL, no refcount drift); userId embedded in the stored global-hash copy (`_userId`) because privy DIDs contain colons and field-key splitting would corrupt them; fresh-read guard before fire mirrors the wave-1 I1 invariant.
- Contract checks: trigger record keeps every wave-1 field (client renderers untouched except the additive `changePct`); `direction: 'above'|'below'` reused so toasts/rows render; POST pct response flattens legacy fields with `priceTarget: 0` (legacy list shows $0 for pct rules on stale bundles — acceptable, they cannot render pct anyway).
- The webhook env 503 guards move INTO the price branch of POST — pct creation must not depend on webhook env.
- PATCH webhook lifecycle guarded by `next.engine === 'codex'` — cron rules never touch Codex webhooks.
