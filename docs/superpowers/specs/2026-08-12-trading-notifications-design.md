# Trading notifications — desktop centre, sign-in path, honest channels

**Created:** 2026-08-12
**Owner:** Evgeniy
**App:** `apps/trading` only. The research app's notification stack is untouched.
**Companions:** `docs/superpowers/specs/2026-07-24-alerts-v2-design.md` (the engine this sits on top of), `docs/superpowers/specs/2026-07-23-mobile-alerts-design.md` (the mobile surface this brings desktop up to).

---

## A. The problem

The alert engine is complete and working — Codex webhooks, a pct cron, per-user rules in KV, delivery fan-out to Web Push and Telegram. What is missing is every way a user would find out about it.

Measured in the current tree:

| Surface | State |
|---|---|
| Header bell (`Header.jsx:551`) | Rendered `is-locked`, `aria-disabled`, click fires a "Coming Soon" toast |
| Settings menu → Notifications row (`Header.jsx:521`) | Same lock, same toast |
| Desktop alert list / triggered history | Does not exist |
| Desktop push toggle | Does not exist — `pushService` is imported only by `MobileAlertSheet` and `MobileAlertsScreen` |
| Desktop Telegram link | Does not exist — same two mobile files only |
| Desktop alert creation | `AlertButton` on `TokenBanner` — the only entry point in the whole desktop app |
| Signed-out create | Form fills normally; `createAlert` throws `Sign in required to create alerts` (`useAlerts.js:140`) and renders as red text at `AlertButton.jsx:206`. No sign-in affordance anywhere in the flow |
| Non-installed users | The only copy about notifications in the product is "Add Spectre to your Home Screen" (`MobileAlertsScreen.jsx:210`, `MobileAlertSheet.jsx:479`) |

Three consequences, which is exactly what was reported:

1. **A desktop user cannot turn on push at all.** Web Push works in a plain browser tab on desktop Chrome/Edge/Firefox, macOS Safari 16+, and Android Chrome/Firefox. `pushService.isPushSupported()` returns true for all of them. There is simply no control rendered anywhere outside the mobile tree.
2. **A missed toast is a lost alert.** `AlertToast` auto-dismisses after 12s (`AlertNotification.jsx:33`). The trigger IS persisted server-side and returned by `GET /api/alerts` as `triggered[]`, but with the bell locked there is no way to reach it.
3. **The product implies installation is required for notifications.** It is required only on iOS/iPadOS (Safari 16.4+, home-screen apps only). Everywhere else it is not, and we say nothing.

## B. Decisions taken

Recorded with the reasoning, so a future reader does not re-litigate them.

| Decision | Chosen | Rejected, and why |
|---|---|---|
| Scope | Fix the existing surface (price + pct alerts only). New event types are a separate later effort | Adding swap/watchlist/Brain events now — they would land in the same 12s toast that is the bug |
| Desktop surface | Right-side overlay drawer | Bell dropdown (less room for history); dedicated `#alerts` view (leaves the chart to check an alert) |
| On trigger | 12s toast, unchanged — plus an unseen badge on the bell and a persistent row in the drawer | Sticky toasts (stack over the chart); badge-only (a trigger can go unnoticed for a long time) |
| Signed out | Bell visible, drawer shows a sign-in screen; token-page form live but the create button gated | Hiding the bell (nobody discovers alerts exist); device-local alerts (triggers are computed server-side — a browser-timer imitation only works while a tab is open) |
| Channels | Render what the device can actually do: browser toggle where push is supported, home-screen copy only on iOS | An "Install app" CTA — deferred to its own task so it is never framed as a precondition for notifications |

## C. Design

### C1. New component

`src/components/NotificationDrawer.jsx` + `NotificationDrawer.css`, class prefix `nd-`.

Right-side overlay, ~420px wide, full height, with a scrim. Closes on Esc, on scrim click, and on the close button. It deliberately covers the swap panel — hence the scrim, so the state reads as "a panel is open over the app", not "the layout changed".

Desktop only. Mounted in `App.jsx` next to the existing `AlertNotification` mount (`App.jsx:1581`), fed from the same `useAlerts()` call already at `App.jsx:724` — no second data source, no second poll.

Mobile keeps `MobileAlertsScreen` as-is.

### C2. Header bell

`Header.jsx:551` loses `is-locked`, `aria-disabled` and the "Coming Soon" handler. It gains:
- `onClick` → toggle the drawer
- an unseen-count badge when the count is > 0
- `aria-expanded` reflecting drawer state

The locked "Notifications" row in the settings menu (`Header.jsx:521-538`) is removed outright. The bell sits three pixels away; two entry points to the same panel is noise.

### C3. Shared unseen watermark

The unseen count today is computed inside `MobileHomeShell.jsx:73` from a localStorage timestamp (`alertsSeenTs`) against `triggered[].triggeredAt`.

Extract that into `src/hooks/useAlertsSeen.js` returning `{ unseenCount, markSeen }`, backed by the same localStorage key so no user loses their watermark on deploy. `MobileHomeShell` switches to the hook; the header uses it for the badge; opening the drawer calls `markSeen()`.

One shared definition of "unseen" means the desktop badge and the mobile tab badge can never disagree.

### C4. Drawer content

**Header:** title, active-rule count, close button.

**Signed out:** a short screen — what alerts are, that they arrive in the browser and Telegram, and a Sign in button wired to the app's existing Privy login. Nothing else renders; no empty lists, no dead toggles.

**Signed in, in order:**

1. **Triggered** — one row per record from `triggered[]`. Unseen rows carry a marker. Each row shows token, condition, the price at trigger, and relative time. pct triggers read `Moved +12% · hit $0.0431 · 4m ago`, matching `MobileAlertsScreen.jsx:247`. Row click navigates to the token; a dismiss button calls `deleteTriggered`.
2. **Active** — one row per rule from `rules[]`, with pause/resume (`updateAlert`) and delete (`deleteAlert`). pct rules render with the ± glyph and the 1h/24h window exactly as mobile does, so the two surfaces speak one language.
3. **Where alerts reach you** — Browser row with a toggle driven by `getPushStatus()` / `enablePush()` / `disablePush()`; Telegram row with connect/disconnect and the existing link-polling state machine.

**Empty (signed in, nothing yet):** "No alerts yet — open any token and press the bell", plus a button into the screener. Mirrors `MobileAlertsScreen.jsx:180-189`.

### C5. Channel row states

Driven entirely by the existing `getPushStatus()` return values, so no new detection logic:

| Status | Renders |
|---|---|
| `granted-subscribed` | Browser toggle, on |
| `granted-unsubscribed`, `default` | Browser toggle, off |
| `denied` | Toggle off and disabled, with "blocked in browser settings" |
| `ios-needs-install` | No toggle. Copy: add Spectre to the Home Screen to receive notifications, with the Share → Add to Home Screen steps |
| `unsupported` | Row hidden; Telegram remains as the working channel |

`ios-needs-install` is only ever returned when the UA is iOS and the app is not standalone (`pushService.js:27-31`), so the home-screen copy cannot appear on a platform where push already works.

### C6. Toast

`AlertNotification` keeps its 12s auto-dismiss. Two changes:
- it does not render while the drawer is open (the same event would be on screen twice)
- it is no longer the only copy of anything — the badge and the drawer row carry it

### C7. Signed-out create path

`AlertButton` on `TokenBanner`:
- inputs stay live; the user can pick price or market cap and see the form work
- the create button is disabled with "Sign in to save"
- clicking it opens Privy login
- on successful login the pending form submits itself, so nothing is typed twice

The red `Sign in required to create alerts` error path (`AlertButton.jsx:206`) stops being reachable for this cause. `useAlerts.createAlert` keeps its throw — it is the correct server-contract guard, it simply should no longer be how a user finds out.

## D. Out of scope

- New event types (swap outcomes, watchlist moves, Brain signals) — a later effort, on top of this surface.
- Any "Install app" CTA and `beforeinstallprompt` handling — its own task, so it is never presented as a notification precondition.
- Server side: `api/alerts.js`, `api/cron/check-alert-rules.js`, `api/_lib/alert-notify.js`, `api/_lib/alert-rules.js`, `public/sw.js` — all unchanged.
- The research app.

## E. Risks

**VAPID keys in production.** Present in the local root `.env`. If `VITE_VAPID_PUBLIC_KEY` is absent from the trading Vercel project, `isPushSupported()` returns false, `getPushStatus()` returns `unsupported`, and the browser row silently does not render — for everyone, with no error. Confirm both `VITE_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in the Vercel dashboard before release. This needs dashboard access.

**Day mode.** Trading uses `body.theme-light`, never `.app.app-day-mode` — the latter is dead code in this app. Every `nd-` rule gets a `body.theme-light` counterpart.

**Drawer over the swap panel.** Accepted deliberately, mitigated by the scrim and by Esc/click-outside. If it proves annoying in use, the fallback is narrowing to a bell-anchored dropdown; the content is identical either way.

## F. Verification

- `npm run build:trading` clean, `[check-critical-path]` green.
- Signed in, desktop: create an alert on a token, confirm the row appears under Active in the drawer; force a trigger and confirm the toast, the bell badge, and the Triggered row all appear; open the drawer and confirm the badge clears and stays cleared after reload.
- Signed out: bell opens the sign-in screen; the token form fills but cannot save; login submits the pending alert once.
- Channels: on desktop Chrome the browser toggle is present and turning it on produces a real OS notification on the next trigger. On an iPhone in Safari (not installed) the home-screen copy appears and no toggle renders.
- Both themes, and the mobile Alerts tab re-checked for badge parity after the `useAlertsSeen` extraction.
