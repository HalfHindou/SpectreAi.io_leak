# Mobile Alerts — in-app reliability + Web Push (trading app)

**Date:** 2026-07-23
**Owner:** Evgeniy
**Scope:** apps/trading only. Two stages: (1) reliable in-app alerts incl. mobile creation, (2) Web Push delivery when the app is closed. Telegram delivery is out of scope (possible later stage).

## Current state (audited)

- Creation: `AlertButton` inside `TokenBanner` (desktop only). `MobileTokenPage` has NO alert creation UI, while the Alerts tab empty state tells users to set alerts from the token page.
- Server: `api/alerts.js` creates/lists/deletes Codex `TOKEN_PRICE_EVENT` webhooks, per-user ownership in KV (`alerts:meta:{webhookId}`, `alerts:user:{userId}`), Privy JWT required.
- Trigger path: Codex calls `api/webhook.js` (signature-verified) which stores the event in an in-memory Map + SSE broadcast — both effectively lost on Vercel serverless.
- Client detection: `useAlerts` polls GET `/api/alerts` every 30s and treats "status INACTIVE and created < 10 min ago" as a trigger. Bug: an alert that fires later than 10 min after creation is never surfaced.
- Trading app is not a PWA: no manifest, no service worker — push impossible today.

## Stage 1 — reliable in-app

### 1.1 Mobile creation: `MobileAlertSheet`
- Bottom-sheet opened from a bell button on `MobileTokenPage` (near the price header).
- Fields: direction (above/below), target mode price OR market cap (mcap input with K/M/B suffixes converted to price via circulating supply — exact semantics of desktop `AlertButton`).
- Calls the existing `createAlert` from `useAlerts` (already lifted to `App.jsx`); stores the same localStorage meta for display.
- Signed-out: sheet shows sign-in prompt (server 401s anyway).

### 1.2 Persist triggers server-side
- `api/webhook.js` on `TOKEN_PRICE_EVENT`: look up owner via `alerts:meta:{webhookId}`, push a trigger record onto KV list `alerts:triggered:{userId}` (capped, e.g. LTRIM to 50): `{ webhookId, tokenAddress, networkId, priceUsd, triggeredAt }`.
- GET `/api/alerts` response gains `triggered: [...]` (read from the caller's KV list) alongside `alerts`.
- `useAlerts` consumes `triggered` from the server instead of the "INACTIVE + created<10min" heuristic; merges display meta from localStorage as today. Heuristic path removed.
- DELETE of a triggered record: `DELETE /api/alerts?triggeredId=...` removes it from the KV list (dismiss = delete).

### 1.3 Alerts tab (mobile)
- Two sections: Active (as today) and Triggered (token, condition, trigger price, relative time, delete).
- Badge count on the Alerts tab icon = new triggered since last visit (localStorage watermark).

## Stage 2 — Web Push

### 2.1 PWA minimum
- `public/manifest.json` + icons for trading; `<link rel="manifest">` in index.html.
- `public/sw.js`: push-only service worker — `push` and `notificationclick` handlers ONLY. No fetch handler, no caching (deliberate: research app's SW bundle-caching bug class must not be repeated).
- `notificationclick` opens/focuses the app at `#token/<address>` of the alert.

### 2.2 Subscriptions
- New `api/push.js`: POST subscribe (Privy JWT required; body = PushSubscription JSON; stored in KV set/hash `push:subs:{userId}`, keyed by endpoint), DELETE unsubscribe.
- Env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:). Public key exposed to client via `VITE_VAPID_PUBLIC_KEY`.

### 2.3 Sending
- `api/webhook.js` after persisting the trigger: load `push:subs:{userId}`, send notification via `web-push` (title: token/name, body: condition + price). Remove subscriptions that return 404/410.
- Payload small and non-sensitive (token symbol, price) — pushes are not E2E private.

### 2.4 Permission UX
- Ask for Notification permission at first alert creation (contextual prompt inside the sheet: "Get notified when it triggers?"), never on page load.
- iOS Safari (not installed): push unavailable — show an "Add to Home Screen" hint instead of the permission prompt (detect standalone display-mode).
- Settings surface: a toggle in the Alerts tab header to enable/disable push (subscribe/unsubscribe).

## Dev/prod parity + verification

- Codex webhooks call the PROD callback URL only; the trigger path (webhook → KV → push) is verified on Vercel preview/prod, not localhost. Manual test: create an alert just above the current price of a liquid token.
- Express dev: mirror the GET `triggered` merge + `/api/push` endpoints in `packages/server` inline routes so dev UI renders (dev returns empty triggered list when KV is absent — matches existing `alerts` fail-safe behavior).
- `npm run build:trading` + check-critical-path must stay green; SW and manifest are static files, not part of the bundle graph.

## Non-goals

- Telegram delivery (later stage).
- Server-side price-checker worker replacing Codex webhooks.
- Alerts for signed-out users (server model requires Privy; unchanged).
