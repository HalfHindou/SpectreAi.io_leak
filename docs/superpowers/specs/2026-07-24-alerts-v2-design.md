# Alerts 2.0 — unified rules, % move alerts, Telegram (trading app)

**Date:** 2026-07-24
**Owner:** Evgeniy
**Scope:** apps/trading (+ dev-parity stubs in packages/server). Builds on the shipped 2026-07-23 mobile-alerts base (MobileAlertSheet, KV trigger history, push-only SW, /api/push).
**Out of scope (later waves):** volume/watchlist-wide/smart-signal alert types, email digests, per-alert channel routing, desktop AlertButton redesign.

## Decisions made

- **Architecture A — unified rule model + two engines.** One KV rule record per alert; price-cross rules keep Codex webhooks (instant), % move rules run on our own Vercel Cron. Chosen over "cron-only" (loses instant price triggers) and "bolt-on" (splits the UI and blocks re-arm/edit for price alerts).
- **Cron cadence: every 10 minutes** (`*/10 * * * *`) — explicit cost decision: do not hammer Codex. A tick with zero active pct rules makes ZERO Codex calls (early exit). Trade-off accepted: pct alerts can arrive up to 10 min late; they are hour/day-window alerts, not scalping tools.
- **New alert type this wave:** % change over window (1h / 24h) only.
- **UX pack:** preset chips, recurring (re-arm) alerts, swipe actions + edit, alert lines on the chart.
- **New channel:** Telegram bot. If linked, triggers go to BOTH push and TG — no per-alert routing this wave.

## 1. Unified rule model

Today the truth is scattered: condition in the Codex webhook, ownership meta in KV, display meta (symbol/logo) in the creating device's localStorage — other devices render bare alerts. New single source of truth:

```
alerts:rules:{userId}        hash: ruleId -> JSON
{
  id: 'r_<ts>_<rand>',
  type: 'price' | 'pct',                     // future: 'volume', 'watchlist'
  engine: 'codex' | 'cron',
  status: 'active' | 'paused',
  token: { address, networkId, symbol, logo },   // display meta server-side now
  condition:
    price: { direction: 'above'|'below', targetPrice, mode: 'price'|'mcap', displayValue }
    pct:   { windowMin: 60|1440, pct, direction: 'up'|'down'|'both' }
  repeat: 'once' | 'recurring',
  codexWebhookId,                            // engine=codex only
  createdAt, lastTriggeredAt, armed
}
```

- **price + once:** Codex webhook `alertRecurrence: 'ONCE'` (as today).
- **price + recurring:** Codex webhook `alertRecurrence: 'INDEFINITE'`; our webhook receiver anti-spams (cooldown + ~1% hysteresis before re-notify).
- **pct:** no Codex webhook; evaluated by the cron engine.
- **Edit** = update the rule; for codex-engine rules the server transparently deletes the old webhook and creates a new one (rule id stable, webhook id rotates).
- **Pause** = status 'paused'; codex-engine pause deletes the webhook, resume recreates it (Codex has no pause).
- **Lazy migration:** first GET `/api/alerts` for a user with no `alerts:rules` hash builds rule records from the current Codex webhook list + `alerts:meta:{webhookId}`. Old alerts keep working untouched.
- **API:** `/api/alerts` becomes rule CRUD — GET returns `{ rules, triggered }` (response keeps an `alerts` compat field during migration if needed), POST creates a rule (creating the Codex webhook when engine=codex), PATCH edits, DELETE removes. Existing `?triggeredId=` delete stays.
- localStorage `spectre-alert-meta` becomes read-only fallback and is retired once rules carry meta.

## 2. Cron engine (% move)

```
vercel.json crons: /api/alerts-cron   */10 * * * *   auth: Authorization: Bearer {CRON_SECRET}

each tick:
  1. read watched-token set        alerts:cron:tokens   (empty -> exit, 0 Codex calls)
  2. batch prices from Codex       getTokenPrices, 25 tokens/query
  3. append price point            alerts:px:{networkId}:{address}
                                   1 point / 10 min, LTRIM cap 150 (~25h)
  4. evaluate pct rules            price now vs price windowMin ago (nearest stored point)
  5. on fire: LPUSH alerts:triggered:{userId} (existing record format)
              notifyTrigger(userId, record)            (section 3)
              once -> status inactive; recurring -> cooldown = windowMin
```

- Global evaluation index: `alerts:cron:rules` hash (ruleKey `{userId}:{ruleId}` -> JSON copy) dual-written with the per-user hash, so the cron reads one structure instead of scanning users. `alerts:cron:tokens` is derived from it on writes.
- Caps: max 25 active rules per user (400 over cap); global watched-token cap with a log line when exceeded (no silent truncation).
- Dedupe: a recurring pct rule fires at most once per its own window.
- Failure model: per-token try/catch; a failed tick is skipped (next in 10 min); NO retries inside a tick.
- Cost envelope: worst case ~1 batch query / 25 tokens / 10 min (~150 Codex queries/day at full cap).

## 3. Delivery fan-out + Telegram

Shared module used by both engines:

```
api/_lib/alert-notify.js
  notifyTrigger(userId, record):
    -> Web Push   (sendPushForTrigger logic moves here from webhook.js)
    -> Telegram   (if tg:chat:{userId} exists)

webhook.js (codex engine)   --\
                                >-- notifyTrigger()
alerts-cron.js (pct engine) --/
```

**Telegram linking:**
1. Bot created via BotFather (user action); token in `TELEGRAM_BOT_TOKEN`.
2. Alerts tab "Connect Telegram" -> server issues short code (`tg:code:{code}` -> userId, TTL 10 min) -> open `https://t.me/<bot>?start={code}`.
3. New `api/telegram.js` = bot webhook: on `/start {code}` resolve code, store `tg:chat:{userId}` = chatId, reply "Connected".
4. Unlink: `/stop` in the bot or a Disconnect button in the app (deletes the key).

**Message:** symbol + condition + trigger price + `https://trade.spectreai.io/#token/{address}`. Nothing private (same principle as push payloads).

**Reliability:** TG send with 3s timeout; channels run via `Promise.allSettled` — a TG failure never blocks push and vice versa.

## 4. UX / design

**MobileAlertSheet v2:**
- Type segment: **Price target | % Move**.
- Price: current Price/MCap + Above/Below, plus **preset chips** `+5% +10% −10% +25% 2x` — tap fills the target from the live price (alert in two taps).
- % Move: window selector `1h / 24h`, chips `5% 10% 25%`, direction `Rise / Drop / Both`.
- **Once / Every time** toggle (repeat).
- Edit mode: same sheet opened with an existing rule; button becomes "Save changes".

**Alerts tab:**
- Sections Active / Triggered (as shipped). Active row shows type (target arrow or "±10% / 1h"), repeat icon, paused state.
- **Swipe left** on a row -> Pause + Delete actions. **Tap** -> edit sheet.
- "Notifications" block in the header: Push toggle (exists) + "Telegram: Connect / Connected / Disconnect" row.

**Alert lines on the chart:**
- Canvas engine (our code): horizontal dashed lines at active price-rule targets with a direction label; **long-press on a price level opens the sheet pre-filled with that price** (gesture on canvas only — we own the input there).
- TradingView Advanced: lines via `createShape(horizontal_line)` on chart ready + whenever the token's rule list changes. No creation gesture on TVA (iframe widget — honestly not promised).
- pct rules are not drawn (no level to draw).

## 5. Parity, security, staging, verification

**Dev/prod parity (`packages/server`):** dev GET `/api/alerts` mirrors the new shape (`rules: [], triggered: []`); PATCH/POST return stubs. `/api/alerts-cron` and `/api/telegram` are prod-only by nature (called by Vercel Cron / Telegram, not the browser); dev keeps a stub so a stray call doesn't 404.

**Security:**
- Cron endpoint accepts only `Authorization: Bearer {CRON_SECRET}`.
- TG webhook registered with `secret_token`; requests validated via `X-Telegram-Bot-Api-Secret-Token`.
- Rule cap 25/user; existing per-user rate limits on alert routes stay.
- Ownership model (SEC-20260513-004) unchanged: all CRUD = Privy JWT + owner check.
- New env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`.

**Staging — 4 independent PRs, in order:**
1. **Rules foundation** — rule model + lazy migration + edit + re-arm (INDEFINITE webhooks) + preset chips. Immediate user value: two-tap alerts, repeats, editing.
2. **Cron + % Move** — engine, pct type, sheet segment.
3. **Telegram** — bot, linking, fan-out module.
4. **Chart & polish** — chart lines, long-press create, swipe actions.

**Verification per PR:** `npm run build:trading` + green check-critical-path. Full trigger paths only on Vercel preview/prod (Codex calls the prod callback; cron lives on Vercel): pct alert on a volatile token; recurring alert firing twice in a session; migration check (pre-existing alerts appear as rules and still fire); TG link flow from a phone; edit of a codex rule rotates the webhook (old one gone from Codex list).

## Non-goals

- Volume / watchlist-wide / smart-signal alert types (next wave; the rule model's `type` field is the extension point).
- Email; per-alert channel routing; quiet hours.
- Sub-10-minute pct granularity (cost decision, revisit only with a non-Codex price source).
- Desktop AlertButton parity beyond what falls out of shared code.
