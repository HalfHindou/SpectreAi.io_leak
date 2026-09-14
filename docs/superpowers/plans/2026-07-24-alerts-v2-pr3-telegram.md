# Alerts 2.0 — Wave 3: Telegram Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver alert triggers to a linked Telegram account alongside Web Push: bot webhook endpoint, deep-link account linking with short-lived codes, TG leg inside `alert-notify.js`, and a Connect/Disconnect row in the Alerts tab.

**Architecture:** A new `api/telegram.js` serves two roles: the BOT WEBHOOK (Telegram POSTs updates; `/start {code}` resolves `tg:code:{code}` -> userId and stores `tg:chat:{userId}`) and the LINK API for the app (Privy-authed POST issues a code + deep link; DELETE unlinks; GET reports status). `alert-notify.js` gains `sendTelegram` next to `sendPush` — both engines get TG for free. If TG is linked, triggers go to BOTH channels (no per-alert routing this wave, per spec).

**Tech Stack:** Telegram Bot API (plain fetch, no SDK), Vercel serverless + Upstash KV, React 18.

**Spec:** `docs/superpowers/specs/2026-07-24-alerts-v2-design.md` (section 3). Same branch `evgeniy-alerts-v2`, one PR.

## Global Constraints

- **Do NOT run `git commit` or `git push`** — NO-COMMITS mode; working tree only.
- No TypeScript. No emojis IN CODE/UI (the TG message text is plain text too — no emojis). Single dash in comments. lucide-react. Day mode `body.theme-light`.
- Env (USER ACTION, documented not faked): `TELEGRAM_BOT_TOKEN` (BotFather), `TELEGRAM_WEBHOOK_SECRET` (random string used as `secret_token` at setWebhook time), optional `TELEGRAM_BOT_USERNAME` (for the deep link; fallback: resolved once via getMe and cached in KV `tg:botname`).
- Bot webhook auth: reject any update whose `X-Telegram-Bot-Api-Secret-Token` header !== `TELEGRAM_WEBHOOK_SECRET` (constant-time compare not required — the header is a shared secret over TLS; a plain !== is what Telegram docs model; use timingSafeEqual anyway to match house style).
- TG sends: 3s timeout, failures never block push (`Promise.allSettled` in notifyTrigger); 403 (bot blocked by user) auto-unlinks (`tg:chat:{userId}` deleted).
- Message: `{name}\nTriggered at ${price}\nhttps://trade.spectreai.io/#token/{tokenAddress}` — plain text, no parse_mode (token names may contain markdown-breaking chars).
- Link codes: `tg:code:{code}` -> userId, TTL 600s (SET with EX), code = 8 chars from crypto.randomBytes — NOT Math.random.
- KV: `tg:chat:{userId}` -> chat id (string). One TG account per user; relinking overwrites.
- No test infra. Verification = node --check + build green + curls; the real bot round-trip is prod/preview-only (Telegram must reach the public URL).
- Dev parity: `/api/telegram` link-API stubs in packages/server (`status` -> `{ linked: false, dev: true }` etc.) so the Alerts-tab UI renders locally.

## KV additions

```
tg:code:{code}      -> userId, EX 600 (one-shot link codes)
tg:chat:{userId}    -> Telegram chat id (string)
tg:botname          -> cached bot username (from getMe), EX 86400
```

## File Map

| File | Action | Task |
|---|---|---|
| `apps/trading/api/telegram.js` | Create (bot webhook + link API) | 1 |
| `apps/trading/api/_lib/alert-notify.js` | Modify (TG leg) | 2 |
| `packages/server/index.js` | Modify (dev stubs) | 1 |
| `apps/trading/src/components/mobile/home/MobileAlertsScreen.jsx` (+`.css`) | Modify (Connect Telegram row) | 3 |
| `apps/trading/src/services/telegramLink.js` | Create (client calls) | 3 |

---

### Task 1: `api/telegram.js` — bot webhook + link API (+ dev stubs)

**Files:**
- Create: `apps/trading/api/telegram.js`
- Modify: `packages/server/index.js` (dev stub route next to `/api/alerts`)

**Interfaces (produces):**
- `POST /api/telegram?hook=1` — Telegram bot webhook. Validates `X-Telegram-Bot-Api-Secret-Token`. Handles `message.text` starting with `/start ` (payload = link code): resolves `tg:code:{code}`, stores `tg:chat:{userId}`, DELetes the code (one-shot), replies via sendMessage ("Connected. Spectre alerts will arrive here. Send /stop to disconnect."). `/stop`: finds and deletes the caller's link (requires a reverse lookup — store `tg:user:{chatId}` -> userId alongside `tg:chat:{userId}` so /stop is O(1); delete both). Any other message -> reply with a one-line help. ALWAYS responds 200 `{ok:true}` to Telegram (non-200 makes Telegram retry-spam).
- `POST /api/telegram` (no `hook` param; Privy JWT required, same auth/gate/ratelimit skeleton as `api/push.js`) — issue link code: generate 8-char code (`crypto.randomBytes(6).toString('base64url')`), `SET tg:code:{code} userId EX 600`, resolve bot username (env `TELEGRAM_BOT_USERNAME` || KV `tg:botname` || getMe->cache), return `{ code, url: "https://t.me/{botname}?start={code}" }`.
- `GET /api/telegram` (Privy) — `{ linked: boolean }` (EXISTS `tg:chat:{userId}`).
- `DELETE /api/telegram` (Privy) — unlink: read `tg:chat:{userId}`, DEL both `tg:chat:{userId}` and `tg:user:{chatId}`, `{ ok: true }`.
- Telegram API calls: plain `fetch("https://api.telegram.org/bot{TOKEN}/sendMessage", ...)` with `AbortSignal.timeout(3000)`.
- 503 `{ error: 'Telegram not configured' }` for link-API calls when `TELEGRAM_BOT_TOKEN` missing (client renders the row disabled).

Skeleton requirements (mirror `api/push.js` for CORS/auth/ratelimit/KV-lazy patterns; the `hook=1` path SKIPS gate/Privy — Telegram is the caller — and relies on the secret header):

- [ ] **Step 1: implement `api/telegram.js`** per the interface block above. Structure: `handler` dispatches FIRST on `req.query.hook === '1'` (webhook path, secret-header check, always-200), else CORS + auth-gate + Privy + rate limit (bucket 'telegram', max 10/min) + method switch (POST issue code / GET status / DELETE unlink). KV helpers: same lazy `getKv()` copy as push.js.
- [ ] **Step 2: dev stubs** in packages/server next to `/api/alerts`:

```js
// Dev stub - Telegram linking is a prod/KV concern; keep the UI happy locally.
app.all('/api/telegram', (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method === 'GET') return res.json({ linked: false, dev: true })
  if (req.method === 'POST') return res.json({ code: 'devcode', url: 'https://t.me/SpectreDevBot?start=devcode', dev: true })
  return res.json({ ok: true, dev: true })
})
```

- [ ] **Step 3: Verify** — `node --check apps/trading/api/telegram.js` + packages/server; build green; dev curls: GET -> `{linked:false,dev:true}`, POST -> deep-link stub.

### Task 2: TG leg in `alert-notify.js`

**Files:**
- Modify: `apps/trading/api/_lib/alert-notify.js`

**Interfaces:**
- `notifyTrigger(kv, userId, record)` now runs `Promise.allSettled([sendPush(...), sendTelegram(...)])` — a failing channel never blocks the other.
- `sendTelegram(kv, userId, record)`: no-op when `TELEGRAM_BOT_TOKEN` missing or kv null; `GET tg:chat:{userId}` — absent -> return; sendMessage with 3s timeout, plain text `{record.name}\nTriggered at ${price}\nhttps://trade.spectreai.io/#token/{record.tokenAddress}` (price formatted with the same >=1 toFixed(2) / toPrecision(4) helper as push — extract the tiny `fmtPrice(record)` local so the two legs share it); on Telegram response `{ ok:false, error_code:403 }` (bot blocked) delete `tg:chat:{userId}` AND `tg:user:{chatId}` (chat id known from the read); other failures -> console.warn only.

- [ ] **Step 1: implement** (shared `fmtPrice`, allSettled fan-out, 403 auto-unlink).
- [ ] **Step 2: Verify** — node --check + build green. (Live sends are prod-only — both engines call notifyTrigger already; zero engine changes needed, state that in the report after grep-verifying the two call sites.)

### Task 3: Alerts-tab Connect row + client service

**Files:**
- Create: `apps/trading/src/services/telegramLink.js`
- Modify: `apps/trading/src/components/mobile/home/MobileAlertsScreen.jsx` + `.css`

**Interfaces:**
- `telegramLink.js` exports: `getTelegramStatus(getAccessToken)` -> `'linked' | 'unlinked' | 'unavailable'` (503/network -> 'unavailable'); `startTelegramLink(getAccessToken)` -> `{ url }` or null; `unlinkTelegram(getAccessToken)` -> boolean. All bearer-authed fetches with `AbortSignal.timeout(10000)`, same style as pushService.
- Alerts tab: under the existing push-hint row, a "Notifications" block row: `Send` icon (lucide) + label. States: unlinked -> button "Connect Telegram" (onClick: `startTelegramLink` -> `window.open(url, '_blank')` -> optimistic "Waiting for Telegram..." then poll `getTelegramStatus` every 3s up to 60s, stop on linked); linked -> "Telegram connected" + small "Disconnect" text button; unavailable -> row hidden entirely (bot not configured); signed out -> row hidden (getAccessToken null).

- [ ] **Step 1: service** per interface.
- [ ] **Step 2: UI** — implement the row + the bounded polling (clearInterval on unmount and on success; NO polling while tab hidden — reuse the `document.hidden` guard inline). CSS: `.mal-tg-row`, `.mal-tg-btn`, `.mal-tg-status` + `body.theme-light` counterparts, styled like the existing `.mal-push-hint` block.
- [ ] **Step 3: Verify** — build green; browser (dev): signed-out -> no row; the dev stub returns `linked:false` so signed-in dev shows "Connect Telegram" (clicking opens the stub URL — fine); no console errors.

### Task 4: USER-ACTION runbook (document only — goes in the final summary + report file)

1. BotFather: create bot (suggested name "Spectre Alerts", username like `SpectreAlertsBot` — final say Gleb/user). Save the token.
2. Vercel (trading project, Production + Preview) env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (e.g. `openssl rand -hex 24`), optional `TELEGRAM_BOT_USERNAME`.
3. Register the webhook ONCE after deploy:
   `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://trade.spectreai.io/api/telegram?hook=1&secret_token=<TELEGRAM_WEBHOOK_SECRET>&allowed_updates=%5B%22message%22%5D"`
4. Smoke: app -> Alerts tab -> Connect Telegram -> bot opens -> Start -> "Connected." reply -> app row flips to connected; fire a test alert -> message arrives in TG AND push; `/stop` in the bot -> row flips back on next status poll.

---

## Self-review notes (plan time)

- Spec section 3 coverage: linking flow (deep link + code + webhook) = Task 1; fan-out module = Task 2 (notifyTrigger already wired into both engines — zero engine edits); Connect UI = Task 3; message format + 3s timeout + allSettled per spec; runbook = Task 4.
- Additions beyond spec (small, justified): `tg:user:{chatId}` reverse index (makes `/stop` and 403-auto-unlink O(1)); status GET + bounded client polling (the app can't otherwise know the link completed); `unavailable` state hides the row when the bot env is absent (honest degradation).
- Telegram always gets 200 from the hook path — non-200 causes Telegram-side retry storms.
