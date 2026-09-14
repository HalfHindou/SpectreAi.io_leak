---
paths:
  - "apps/research/api/auth-gate.js"
  - "apps/research/api/beta-access.js"
  - "apps/research/src/components/auth-gate*.jsx"
  - "apps/research/src/lib/privy-*.js"
---

# Auth Session Hardening — login bugs + iOS homescreen logout

**Created:** 2026-06-30
**Owner:** Evgeniy
**Symptom reported:** (a) "many times I log into auth and it bugs", (b) "saved to iPhone homescreen → logs out often, I sometimes see an error".

## Root causes (traced across the 3 auth layers)

The real session state is a **server cookie** checked at boot via `/api/auth-gate?action=check`:
- `spectre-gate` (team password, was 24h) — `apps/research/api/auth-gate.js`
- `spectre-beta` (per-user Privy beta, was 7d) — `apps/research/api/beta-access.js`

`sessionStorage 'spectre-auth'` is only a UI hint. The Privy LOGIN itself is kept by Privy in **localStorage** (no cookie storage configured).

Three things stacked into the symptoms:
1. **Privy login in localStorage** → iOS evicts script storage in a homescreen PWA (separate storage box + ~7-day ITP cap), so the Privy session is silently dropped. *(documented: `privy.md` D12)*
2. **Short cookie lifetimes** → even when storage survives, the gate cookie expired (team 24h / beta 7d).
3. **Fragile boot check** → on a flaky mobile network / cold serverless, `/api/auth-gate?action=check` times out; the gate's `catch` set `isAuthenticated(false)` → dumped a still-valid user to the login screen = the "logged out + error" false logout.
4. **Login dead-end** → after a CORRECT OTP, the post-login `/api/beta-access` verify could hit a cold start / 503 / blip and dead-end at `service_error` with no retry, forcing a full re-login.

> A subagent claimed the missing cookie `Domain` was THE root cause — overstated. A host-only cookie still works for the app itself; `Domain` only matters for subdomain sharing + PWA-storage robustness. Real driver of homescreen logout is #1 (Privy localStorage), fixed by the runbook below.

## What shipped (code, 2026-06-30)

- **Client false-logout fix** — `apps/research/src/components/auth-gate.jsx`: `readAuthHint()` seeds initial auth state from the `spectre-auth` hint, and on a check that THREW (network/timeout/cold start, not a server "no") we keep the previously-authed user in instead of forcing the gate. Applied to both `BetaAccessShell` and `TeamPasswordOnlyGate`. The server cookie is still the source of truth for every data API, so this is UX only, not a security change.
- **Cookie lifetime + domain** — `apps/research/api/auth-gate.js` + `beta-access.js`: `spectre-gate` 24h→7d, `spectre-beta` 7d→30d, both gain `Domain=.spectreai.io` (matches `dc_demo`, survives subdomains + the `/token` iframe + the iOS-PWA storage box). The beta value is duplicated (mint in `beta-access.js`, verify ceiling `BETA_COOKIE_MAX_AGE` in `auth-gate.js`) — **keep them in sync**. Prod-only files (dev proxies `/api` to Express and bypasses the gate), so `Domain` can't break localhost.
  - **Security tradeoff:** longer team-password window (24h→7d). Dial `COOKIE_MAX_AGE` back in `auth-gate.js` if a shorter shared-secret session is wanted.
- **Login retry** — `apps/research/src/components/auth-gate-flow.jsx`: one bounded auto-retry (`MAX_VERIFY_ATTEMPTS = 2`) on a TRANSIENT post-OTP verify failure, so a correct code doesn't dead-end on a cold start. Definitive 401 (token rejected) / 403 (not-on-waitlist / beta_closed) never retry. Budget resets per fresh sign-in in `handleEmailSubmit`. Stays inside the documented anti-hammering-loop contract.

## RUNBOOK — enable Privy first-party cookies (the real homescreen fix) [USER ACTION]

This is the highest-impact fix and needs **no code change** — `api/_lib/auth.js` already reads the `privy-token` cookie as a fallback, and the App ID is env-driven (`VITE_PRIVY_APP_ID` frontend, `PRIVY_APP_ID`/`PRIVY_APP_SECRET` server).

1. **Privy Dashboard → App settings → Domains**: add `spectreai.io`, add the DNS record it asks for, verify. Enable cookies. Do this on the production app-client (and the trading app-client if SSO across `app`/`trade` is wanted). Docs: https://docs.privy.io/guide/react/configuration/cookies
2. **Verifying a cookie domain LOCKS that App ID to `spectreai.io` + subdomains** → it stops working on `localhost` and `*.vercel.app` previews. So create a SEPARATE **development App ID** (no cookie domain).
3. **Wire App IDs per environment** (no code change, env only):
   - Vercel **Production**: `VITE_PRIVY_APP_ID` + `PRIVY_APP_ID` + `PRIVY_APP_SECRET` = the prod (cookie-verified) app.
   - Local `.env` + Vercel **Preview**: the dev app's `VITE_PRIVY_APP_ID` / `PRIVY_APP_ID` / `PRIVY_APP_SECRET`.
   - `PRIVY_APP_ID` (token audience) and `PRIVY_APP_SECRET` must belong to the SAME app as the frontend `VITE_PRIVY_APP_ID`, or `beta-access` token verification 401s.
4. After this, Privy sets the access token as an HttpOnly cookie on `.spectreai.io`; the SDK restores the session on a fresh subdomain / PWA load → survives iOS homescreen, fixes Safari, and gives SSO across both apps + the `/token` iframe.

## Verify

- **Cookies (prod / Vercel preview, NOT localhost — gate is bypassed in dev):** log in, DevTools → Application → Cookies → confirm `spectre-beta` `Domain=.spectreai.io`, `Max-Age≈2592000`; `spectre-gate` `Domain=.spectreai.io`, `Max-Age≈604800`.
- **False-logout fix:** authed, then DevTools → Network → throttle Offline → reload. Should NOT drop to the login screen (stays in on the hint); back Online re-verifies.
- **Login retry:** with throttling, enter a valid OTP — a single transient verify failure should silently retry rather than show "Sign-in didn't go through".
- **Homescreen (after the Privy cookie runbook):** add to iOS homescreen, log in, force-close, reopen after a while → still logged in.

> NOT pushed yet — review before PR. Targets `engineering` per `apps/research/.claude/rules/git-workflow.md`.
