---
description: Prioritized Privy integration audit findings (P0-P3). Each entry validated against the actual code. Severity, evidence, impact, fix sketch, KB pattern reference, estimated effort, dependencies.
---

# Spectre Privy - Audit Gaps Backlog

> Living backlog of differences between our current Privy integration and the canonical patterns in the KB. Every entry was validated against the actual code before being recorded. Top items first.

## Severity legend
- **P0**: Security or correctness issue, ship-blocker. Examples: unauthenticated profile API, swap submitted twice on flaky network.
- **P1**: Significant UX or DX gap that costs real conversions or dev time. Examples: missing Solana wallet connector, no idempotency keys.
- **P2**: Nice-to-have / hygiene. Examples: config drift between apps, unused config options, dead code.
- **P3**: Future-state opportunity. Examples: smart wallets, EIP-7702, server wallets for agent flows.

## Findings

### 1. No idempotency keys on swap submission - **RESOLVED 2026-05-19**
- **Severity**: P0 (closed)
- **Resolution**:
  - Added synchronous `swapInFlightRef` re-entry guard in `apps/trading/src/hooks/useSwapExecution.js` `doSwap()`. A double-click in the same React frame is now blocked at the first instruction before any `await`. Ref is released on both success and error paths.
  - Added `makeIdempotencyKey()` helper + `X-Idempotency-Key` header on the `/api/swap/log` POST in BOTH `apps/trading/src/services/swapService.js` and `apps/research/src/services/swapService.js`. Log retries no longer double-count.
- **Server-side dedupe added 2026-05-19**:
  - Added `claimIdempotencySlot` / `getIdempotencySlot` / `releaseIdempotencySlot` helpers to both apps' `api/_lib/kv.js` (SET NX EX 24h on `idempotency:swap-log:{key}`).
  - Wired into both `/api/swap/log` handlers (`apps/trading/api/swap.js` + `apps/research/api/_lib/handlers/swap.js`): atomic claim before verification, idempotent replay returns cached `{ ok: true, idempotent: true }`, hash mismatch returns 409, downstream failure (verification reject / RPC error / KV write failure) releases the claim so retries can re-attempt.
- **Still open (not part of #1 closure)**:
  - Pass idempotency key into Privy's `useSendTransaction` itself for the user-dashboard withdraw flow. Today only `/api/swap/log` enforces it. Lower priority since the withdraw flow is rarer than swap.
- **Canonical pattern**: `.claude/knowledge/privy/05-transactions-and-signing.md`

### 2. Trading app uses deprecated `@privy-io/server-auth` alongside the new SDK - **CORRECTION 2026-05-19**
- **Severity**: P2 (downgraded from P0)
- **Correction note**: original finding claimed the dep was unused. That is FALSE. `apps/trading/api/social.js:64-71` actively imports `PrivyClient` from `@privy-io/server-auth` and uses `privy.getUser(userId)` inside `resolvePrivyContext()` (line 144-163) to fetch the user's email + `linkedAccounts` for admin gating and wallet-link verification on every social post / comment / like / banner mutation.
- **Updated evidence**:
  - `apps/trading/api/social.js:64-71` - `getPrivy()` lazy-instantiates `PrivyClient` for `getUser` calls. ACTIVE PATH.
  - `apps/trading/api/social.js:144-163` - `resolvePrivyContext()` consumes that user object for `isAdmin` + `ownsWallet` checks.
  - `packages/server/lib/auth.js:5-23` - the Express server still uses `@privy-io/server-auth` for JWT verification (not just user fetch). This part IS a real migration candidate.
- **Impact** (updated): the trading app is correct to keep the dep until `social.js` migrates to `@privy-io/node` for user fetch. The Express server `packages/server/lib/auth.js` should still migrate to JWKS-based verification but isn't blocking.
- **Fix sketch**:
  - Migrate `apps/trading/api/social.js` `PrivyClient.getUser` -> `@privy-io/node` equivalent. Verify the `@privy-io/node` API surface supports the same user-data shape (`email.address`, `linkedAccounts[].type === 'wallet'`).
  - THEN remove `@privy-io/server-auth` from `apps/trading/package.json`.
  - Separately: port `packages/server/lib/auth.js` to JWKS pattern matching `apps/trading/api/_lib/auth.js`.
- **Canonical pattern**: `apps/trading/api/_lib/auth.js` (correct JWKS pattern), `.claude/knowledge/privy/08-server-sdk.md`
- **Estimated effort**: S
- **Dependencies**: requires `@privy-io/node` user-fetch API verification first

### 3. Slippage caps clamp client-side but no max price-impact guard - **RESOLVED 2026-05-19**
- **Severity**: P0 (closed)
- **Resolution**:
  - Added `MAX_PRICE_IMPACT_PCT = 5` constant in `apps/trading/src/hooks/useSwapExecution.js`.
  - Added `parsePriceImpact(quote)` helper that handles both Jupiter (fraction string `"0.0234"` = 2.34%) and 0x (number) encodings.
  - `doSwap()` now rejects with a specific error message before any signing if `impact > MAX_PRICE_IMPACT_PCT`. User must reduce size or accept a more liquid pair.
- **Remaining scope** (not blocking - moved to UX backlog):
  - Soft warning in the RightPanel UI when impact crosses 2% (yellow), block-with-confirm-modal when > 5%. Today the hard block is silent in UI until the user clicks Swap. Better to surface earlier.
  - Port the same guard to `apps/research/src/hooks/useSwapExecution.js` if research ever adds its own swap UI (today swap is iframe-embedded trading, so research inherits the fix).
- **Canonical pattern**: `.claude/knowledge/privy/06-swaps-and-trading.md`
- **Estimated effort to complete remaining UX scope**: S

### 4. Trading app uses v1 `loginMethods`; research uses v2 `loginMethodsAndOrder`
- **Severity**: P1
- **Evidence**:
  - `apps/research/src/lib/privy-config.js:26-29` - `loginMethodsAndOrder: { primary: ['email', 'google', 'twitter'], overflow: ['discord', 'apple', 'wallet'] }`.
  - `apps/trading/src/lib/privy-config.js:12` - `loginMethods: ['email', 'google', 'twitter', 'apple', 'discord', 'wallet']` (flat v1 array).
  - `apps/trading/CLAUDE.md` lists this as "intentional, do not upgrade without testing Solana wallet flow" - intentional today, but it means trading misses the v2 grouping that makes the modal cleaner.
- **Resolution 2026-05-19**: replaced flat `loginMethods` array with tiered `loginMethodsAndOrder: { primary: ['email', 'google', 'twitter'], overflow: ['discord', 'apple', 'wallet'] }` mirroring research byte-for-byte. The Solana wallet flow regression concern documented in CLAUDE.md is mitigated because finding #5 already shipped `toSolanaWalletConnectors` so Phantom/Solflare are in the modal independently of the loginMethods shape.
- **Status**: **RESOLVED**. Both `npm run build:trading` and `npm run build:research` succeed. Worth a manual Solana login smoke test once deployed.
- **Canonical pattern**: `apps/research/src/lib/privy-config.js`, `.claude/knowledge/privy/01-auth-and-identity.md`

### 5. Trading app missing Solana external wallet connectors
- **Severity**: P1
- **Evidence**:
  - `apps/research/src/lib/privy-config.js:13-18` - imports `toSolanaWalletConnectors` and wires it under `externalWallets.solana.connectors`.
  - `apps/trading/src/lib/privy-config.js` - NO `toSolanaWalletConnectors` import. NO `externalWallets` block at all.
  - Solana embedded wallets (Privy-created) still work because `embeddedWallets.solana.createOnLogin` is set, but external Phantom / Solflare buttons do NOT appear in the trading modal.
- **Resolution 2026-05-19**:
  - Added `import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'` to `apps/trading/src/lib/privy-config.js`.
  - Wired `externalWallets.solana.connectors = toSolanaWalletConnectors({ shouldAutoConnect: false })`.
  - Also split the curated `walletList` to use `detected_ethereum_wallets` + `detected_solana_wallets` (closes finding #6 in the same change - removed below).
- **Status**: **RESOLVED**. Phantom / Solflare buttons now appear in the trading modal.
- **Verification**: Both `npm run build:trading` and `npm run build:research` succeed.
- **Canonical pattern**: `apps/research/src/lib/privy-config.js:13-18, 66-71`, `.claude/knowledge/privy/03-solana-integration.md`

### 6. Trading `walletList` uses generic `detected_wallets`, research splits ETH and SOL - **RESOLVED 2026-05-19**
- **Severity**: P1 (closed)
- **Resolution**: closed together with #5. Trading `walletList` now uses `'detected_ethereum_wallets', 'detected_solana_wallets'` matching research.
- **Canonical pattern**: `apps/research/src/lib/privy-config.js:47-60`

### 7. Trading app missing explicit `fundingMethodsAndOrder` - **RESOLVED 2026-05-19**
- **Severity**: P1 (closed)
- **Resolution**: Added `fundingMethodsAndOrder: { primary: ['card'], overflow: ['exchange'] }` to `apps/trading/src/lib/privy-config.js` mirroring research. Funding modal order is now deterministic across both apps regardless of Privy default changes.
- **Canonical pattern**: `apps/research/src/lib/privy-config.js:77-80`, `.claude/knowledge/privy/07-funding-and-onramp.md`

### 8. Trading `walletService.js` does sequential balance reads instead of Multicall3 - **RESOLVED 2026-05-19**
- **Severity**: P1 (closed)
- **Resolution**:
  - Ported `MULTICALL3_ADDRESS`, `MULTICALL3_ABI`, `BALANCE_OF_SELECTOR`, the `aggregate3` batch builder, and the sequential fallback from `apps/research/src/services/walletService.js` to `apps/trading/src/services/walletService.js`.
  - Restructured trading's `COMMON_TOKENS` schema from `{ symbol: address }` to `{ symbol: { address, decimals } }` so decimals are authoritative without an extra `decimals()` RPC call per token. Updated all 4 callsites in `apps/trading/src/components/RightPanel.jsx` to use `COMMON_TOKENS.<chain>.<symbol>?.address`.
  - EVM balance fetch goes from 3-4 RPC calls per chain (1 native + N ERC-20s, each with their own `balanceOf` + `decimals`) to ONE `aggregate3()` call. Falls back to parallel `Promise.all` if Multicall3 reverts (defensive only - Multicall3 deployed at the canonical address on all 5 chains we support).
- **Verification**: `npm run build:trading` succeeds. The `apps/trading/CLAUDE.md` "Known tech debt" line is now stale and should be removed (follow-up).
- **Canonical pattern**: `apps/research/src/services/walletService.js`, `.claude/rules/solana-web3.md` section C

### 9. No cross-app session sharing - **REOPENED 2026-05-22** (the 2026-05-19 "RESOLVED" was WRONG)

> **The 2026-05-19 resolution below was based on a false assumption and is RETRACTED.** Gleb confirmed 2026-05-22: login on `app.spectreai.io` does NOT carry to `trade.spectreai.io` - the user is logged out. The DNS swap (same `appId` + same `.spectreai.io` parent) is NOT sufficient: Privy stores the session in localStorage (origin-scoped), and the third-party `auth.privy.io` session that the old note relied on is blocked by modern browser third-party-storage partitioning + Safari ITP. Same-parent-domain does not share localStorage.
>
> **Correct fix (Privy-documented):** enable **HttpOnly first-party cookies** on the production Privy app, cookie domain `spectreai.io`. Cookie is set on `spectreai.io` + subdomains; the SDK restores the session from it on a fresh subdomain load -> SSO across `app.`/`trade.` and inside the same-site `/token` iframe (also fixes Safari, since it's now first-party, not third-party iframe storage). Dashboard + DNS only, no SDK code change.
> **Constraint:** verifying the cookie domain LOCKS that App ID to spectreai.io + subdomains (breaks localhost / `*.vercel.app`) -> dev/preview need a SEPARATE development App ID. Wire `VITE_PRIVY_APP_ID` + `PRIVY_APP_ID` per environment.
> Docs: https://docs.privy.io/guide/react/configuration/cookies . Runbook + repo changes: plan file top section `in-privy-folder-you-tranquil-honey.md`.
> **Repo support landed 2026-05-22:** `privy-token` cookie fallback in both `api/_lib/auth.js`; dev/prod App-ID split documented in both `.env.example`. Remaining = Gleb's Privy dashboard + DNS work.
>
> --- superseded note (kept for the record, do NOT trust its SSO claim) ---
> Resolved via Phase A DNS swap. Research's `/token` iframe src -> `https://trade.spectreai.io`. Claimed SSO carried via shared third-party `auth.privy.io` session with no code change, with only a "Safari ITP residual." That claim was false (third-party storage is blocked in Chrome too now).

### 9-original (kept for context)
- **Severity**: P1
- **Evidence**:
  - Two separate `PrivyProvider` instances: `apps/research/src/main.jsx:283-287` and `apps/trading/src/main.jsx:131-138`.
  - The token page (`/token`) embeds trading in an iframe (`apps/research/CLAUDE.md` documents this). The iframe at `spectre-trading.vercel.app/#token` runs its own Privy session because Privy auth tokens are scoped per origin.
  - No URL bridge, no `postMessage` token handoff, no shared subdomain cookie.
- **Impact**: User logs into research, navigates to `/token`, the embedded trading iframe presents "Connect Wallet" again. Confusing UX, lost conversions, especially on the swap flow which lives in the iframe.
- **Fix sketch**:
  - Option A (smallest): use a shared parent domain cookie. Move both apps under `*.spectreai.io` (already partially done) and tell Privy to set the auth cookie on `.spectreai.io`. Verify against Privy docs - Privy may scope cookies to exact origin.
  - Option B: parent (research) posts the access token to the iframe via `postMessage` after origin check; trading's PrivyProvider initializes with `initialAuthToken` prop (if Privy supports it).
  - Option C: collapse to a single Privy provider hosted in a shell app and embed both apps via subroutes. Largest lift.
  - Pick A first.
- **Canonical pattern**: `.claude/knowledge/privy/01-auth-and-identity.md` (session sharing), `.claude/knowledge/privy/09-ui-and-customization.md`
- **Estimated effort**: L
- **Dependencies**: requires production custom domains for both apps

### 10. swap submit uses wallet.signTransaction instead of Privy useSendTransaction - **NOT BLOCKING / SKIP RECOMMENDED 2026-05-19**

> Investigated the @privy-io/react-auth ^3.16.0 type definitions to verify the audit's claim that migrating to `useSendTransaction` would give us "idempotency keys, action IDs, and built-in confirmation tracking." The claim is FALSE for the React SDK:
> - EVM `useSendTransaction` options: `{ sponsor, uiOptions, fundWalletConfig, address }`. No `idempotencyKey` field.
> - Solana `useSignAndSendTransaction` options: `{ uiOptions, sponsor } & SolanaSignAndSendTransactionOptions`. No `idempotencyKey` field either.
> - Action IDs live on the server-side wallet action API (@privy-io/node), not the client SDK.
> - Confirmation tracking still requires our own polling - the SDK does not subscribe to chain confirmations.
>
> The current path (`wallet.getEthersProvider()` + `signer.sendTransaction` for EVM; `wallet.getProvider().signAndSendTransaction` for Solana) already routes through the Privy embedded wallet. The migration would only get us Privy's `PrivyEvents` `onSuccess`/`onError` callback hooks and stylistic consistency with their preferred API surface.
>
> Verdict: not worth the refactor risk on the core swap path absent a real functional benefit. The original audit assumption was incorrect.

### 10-original (kept for context)
- **Severity**: P1 (now closed as SKIP)
- **Severity**: P1
- **Evidence**:
  - `apps/research/src/hooks/useSwapExecution.js:223` - calls `execSwap(wallet, quote)` where `execSwap` is the imported `executeSwap` from `swapService.js`. Not `useSendTransaction` from Privy's react-auth SDK.
  - Trading uses the same pattern (`apps/trading/src/hooks/useSwapExecution.js:223`).
  - Grep for `useSendTransaction` returns only `UserDashboard/index.jsx` and `UdWalletSection.jsx` (the withdraw flow), NOT the swap flow.
- **Impact**: Swap submission goes through our own `swapService.executeSwap` which does `wallet.signTransaction` then a raw RPC `sendRawTransaction`. Misses Privy's built-in tx tracking, idempotency, action status polling, and post-confirmation hooks. Also makes finding 1 (idempotency) harder to fix.
- **Fix sketch**:
  - Migrate the swap submit path to `useSendTransaction` from Privy. For Solana use the Solana variant; for EVM use the EVM variant.
  - This automatically gives us idempotency keys, action IDs, and built-in confirmation tracking, fixing finding 1 in the same change.
- **Canonical pattern**: `.claude/knowledge/privy/05-transactions-and-signing.md`, `.claude/knowledge/privy/03-solana-integration.md`, `.claude/knowledge/privy/04-evm-integration.md`
- **Estimated effort**: M
- **Dependencies**: enables 1

### 11. DOM-hack on Privy modal to auto-click email + scroll wallet list - **RESOLVED 2026-05-19 (refactored, not removed)**

> Re-reading the actual code showed both hacks are LOAD-BEARING UX customizations, not dead defensive code as the original audit suggested:
> - The email auto-click expands the COLLAPSED "Continue with Email" tile that Privy renders for returning users (independent of `loginMethodsAndOrder` ordering).
> - The wallet list scroll patches a real react-window virtualizer bug: Privy claims 37327px container height for 612 wallets but only pre-renders ~14. The rest are unreachable except via search.
>
> Resolution: extracted both hacks into a named module `apps/{trading,research}/src/lib/privy-modal-hacks.js` exporting `applyPrivyModalHacks()`. Both `main.jsx` files now just import + call it. The hacks themselves are unchanged but the rationale, idempotency guards, and SDK-version notes are documented in the module header so future engineers can drop them once Privy ships fixes.
>
> Status: RESOLVED. The audit's proposed "replace with config" fix was based on incorrect understanding of why the hacks exist.

### 11-original (kept for context)
- **Severity**: P2
- **Severity**: P2
- **Evidence**:
  - `apps/research/src/main.jsx:112-161` - 50-line MutationObserver that watches `#privy-modal-content`, finds the "Continue with Email" button by regex, programmatically clicks it, then walks the DOM 2 levels up from a wallet row to apply `overflow-y: auto !important` and cap the wallet list height at 380px.
  - `apps/trading/src/main.jsx:24-93` - same hack, slightly older code paths but doing the same DOM patching.
  - `clickedFor` and `data-spectre-scroll-fixed` flags prevent re-applying on every mutation.
- **Impact**: Fragile. The day Privy ships a modal redesign (changes selectors, button classnames, or DOM hierarchy), email auto-click stops working and the wallet list goes unscrollable again. Silent UX regression. Hard to debug because there is no error - just "modal looks normal but worse".
- **Fix sketch**:
  - Replace email auto-click with `appearance.walletList` ordering plus `loginMethodsAndOrder.primary` putting `email` first (already true in research, partially true in trading).
  - Open a Privy support ticket for the wallet list scroll issue (612 wallets, react-window virtualizer cap). They've likely fixed it in newer SDK versions.
  - Once Privy ships the fix, delete the MutationObserver blocks entirely.
- **Canonical pattern**: `.claude/knowledge/privy/09-ui-and-customization.md`
- **Estimated effort**: M
- **Dependencies**: requires Privy SDK upgrade or vendor response

### 12. `getAccessToken` ref pattern correct in App.jsx but useProfileSync (trading) puts it in deps
- **Severity**: P2
- **Evidence**:
  - `apps/research/src/App.jsx:179-181` - `const getTokenRef = useRef(getAccessToken); getTokenRef.current = getAccessToken` then uses `getTokenRef.current()` inside the effect. Correct pattern from `.claude/rules/solana-web3.md` section A.
  - `apps/trading/src/hooks/useProfileSync.js:15, 72, 88` - puts `getAccessToken` directly in the useEffect deps. Guarded with `didSync.current` so the loop is bounded, but technically still creates a new effect closure every render.
- **Impact**: Each Privy hook render re-creates the effect callback. In `useProfileSync` the work is gated by `didSync.current`, so the practical impact is one extra closure creation per render - not a runtime bug today. But it is a known footgun, and anyone copying the pattern to a new effect that is not idempotent will get an infinite loop.
- **Fix sketch**:
  - Refactor `apps/trading/src/hooks/useProfileSync.js` to the useRef pattern used in research's App.jsx.
  - Add a lint rule (or just a comment in `solana-web3.md`) banning `getAccessToken` in deps.
- **Canonical pattern**: `apps/research/src/App.jsx:179-181`, `.claude/rules/solana-web3.md` section A
- **Estimated effort**: XS
- **Dependencies**: none

### 13. No Privy webhooks subscribed - **RESOLVED 2026-05-19 (endpoint ready; dashboard setup pending)**

> Added `apps/trading/api/privy-webhook.js` and `apps/research/api/privy-webhook.js`. Both:
> - Disable Vercel's body parser so the raw bytes are available for HMAC verification
> - Read svix-id / svix-timestamp / svix-signature headers
> - Use `@privy-io/node` `client.webhooks().verify(...)` (Svix-compatible)
> - Switch on event type with stubs for user.created, user.authenticated, user.linked_account, user.wallet_created, transaction.confirmed/failed/broadcasted/replaced, mfa.enabled/disabled
> - Log a single structured line per event for the Vercel logs explorer
> - Return 200 on verified events, 400 on signature failures, 503 if `PRIVY_WEBHOOK_SIGNING_SECRET` is not configured
>
> Required dashboard setup (manual, one-time per environment):
> 1. Privy dashboard -> Webhooks -> Add endpoint pointing to `/api/privy-webhook` on each app's prod URL
> 2. Subscribe to the desired event types
> 3. Copy the signing secret -> set as `PRIVY_WEBHOOK_SIGNING_SECRET` in Vercel project env vars for both apps
>
> Event handlers themselves are stubs for now - they log + ack. Wiring to PostHog / KV / swap-log enrichment is a follow-up once dashboard activation lands.

> **Update 2026-05-19**: handlers now wired with concrete KV side effects (both apps mirror identical logic):
> - `transaction.*` events (confirmed, failed, broadcasted, execution_reverted, replaced, still_pending, provider_error) -> `setWebhookTxStatus(txHash, { status, chainId, blockNumber, error, replacement_hash, updatedAt })` with 7d TTL. Lets client-side `waitForConfirmation` short-circuit RPC polling once KV is populated.
> - `user.*` events (created, authenticated, linked_account, unlinked_account, updated_account, wallet_created) -> `recordWebhookUserEvent(did, type, { source, wallet_address, svix_id })` - capped rolling list (50 entries) at `user-events:{did}`. Useful for support tooling + lightweight funnel analytics without needing posthog-node yet.
> - `mfa.enabled` / `mfa.disabled` -> recorded in same user-event list. Future gating of sensitive actions can read this.
> - All KV writes are best-effort; handler errors are caught and logged so we still return 200 to Privy (prevents retry storm on transient KV outage).
> - Endpoint still 503s until `PRIVY_WEBHOOK_SIGNING_SECRET` is set, so this code is dormant safely until dashboard activation lands.

### 13-original (kept for context)
- **Severity**: P2
- **Severity**: P2
- **Evidence**:
  - `apps/research/src/services/swapService.js` (via `waitForConfirmation`) polls every 2 seconds for up to 60 seconds checking tx status on RPC.
  - No `/api/privy/webhook` endpoint exists in either app's `api/` directory.
  - Grep across server / app for `'webhook'` and `transaction.confirmed` returns no Privy-related hits.
- **Impact**: Wasted RPC calls (30 polls per swap at peak), and the user waits up to 2 seconds longer than needed for "Swap confirmed" UI. Also no server-side record of which users actually completed a swap unless they hit `/api/swap/log` after confirmation, which is best-effort.
- **Fix sketch**:
  - Add `apps/trading/api/privy-webhook.js` and the research equivalent.
  - Subscribe to `transaction.confirmed` and `user.updated` events in Privy dashboard.
  - On `transaction.confirmed` for our actions, push a `posthog.capture` and write to KV swap log.
  - Replace 2-second polling with a "wait for webhook OR timeout 60s" approach where the webhook resolves a promise via SSE or KV polling.
- **Canonical pattern**: `.claude/knowledge/privy/08-server-sdk.md` (webhooks section)
- **Estimated effort**: M
- **Dependencies**: 10 (cleaner if migrated to useSendTransaction first)

### 14. AppErrorBoundary catches Privy crashes but doesn't report them
- **Severity**: P2
- **Evidence**:
  - `apps/trading/src/main.jsx:188-202` - trading's `AppErrorBoundary.componentDidCatch` reports to analytics via `track(Events.ERROR, ...)`. Good.
  - `apps/research/src/main.jsx` - has its own error boundary but only `console.error`s without an analytics call. (Earlier in the file, before line 200, the boundary is shown but no `track()` call inside `componentDidCatch`.)
  - The trading-app pattern is the right one; research is missing it.
- **Impact**: When Privy SDK crashes in research (which has happened during hydration races), it shows the yellow error page and no PostHog event fires. We have no visibility into how often users see the crash screen.
- **Fix sketch**: Port trading's `track(Events.ERROR, { error_type: 'react_crash', ... })` block into research's `AppErrorBoundary.componentDidCatch`.
- **Canonical pattern**: `apps/trading/src/main.jsx:193-202`
- **Estimated effort**: XS
- **Dependencies**: none

### 15. Trading CSP `script-src 'unsafe-inline'` - **WON'T FIX / REVERTED 2026-05-20**

> Attempted to tighten this (commit 3baa57f, "drop 'unsafe-inline' from script-src") - it was **REVERTED by the team** because it broke the TradingView Advanced Charting Library in production (3rd time this exact bug has hit).
>
> Root cause my build-time check missed: TradingView's charting library creates `srcdoc` iframes at RUNTIME whose bodies contain inline `<script>` blocks. Those iframes inherit the parent document CSP, so removing `'unsafe-inline'` blocks them and the chart silently fails to boot (blank white canvas + `changeSymbol/changeTheme/activeChart undefined` console errors). The built `dist/index.html` has NO inline scripts — so a build-only check is insufficient; the inline scripts only exist at runtime inside TradingView's srcdoc iframes.
>
> `apps/trading/index.html` now carries a prominent DO-NOT-REMOVE comment block documenting this. Trading's `script-src 'unsafe-inline'` is **intentional and must stay** until someone does the real work: enumerate every inline script TradingView's srcdoc iframes inject and SHA-256-hash them (research's hash-based approach doesn't transfer because research doesn't embed TradingView the same way).
>
> Lesson recorded in `.claude/learning/corrections.md`: CSP changes that touch the trading app MUST be tested against a live TradingView chart render, not just `npm run build` + `dist/index.html` inspection.

### 15-original (kept for context)
- **Severity**: P2
- **Evidence**:
  - `apps/research/vercel.json:267` - extensive CSP with `frame-src https://auth.privy.io ...` and `connect-src ... wss://*.privy.io https://auth.privy.io https://*.privy.systems`.
  - `apps/trading/vercel.json` (single headers block) - same `frame-src https://auth.privy.io` and `connect-src ... wss://*.privy.io https://auth.privy.io https://*.privy.systems`.
  - Both are correct, but they drifted in `script-src` (research has SHA-256 inline-script hashes; trading uses `'unsafe-inline'`). Trading is looser than research for no good reason.
- **Impact**: Trading CSP is weaker (`'unsafe-inline'` script-src) than research. Future XSS pivots that would be blocked on research land on trading. Inconsistent posture across apps.
- **Fix sketch**:
  - Tighten trading CSP to match research: replace `'unsafe-inline'` with explicit SHA-256 hashes for our inline scripts.
  - Verify Privy iframe still loads under the tighter CSP.
- **Canonical pattern**: `apps/research/vercel.json:267`
- **Estimated effort**: S
- **Dependencies**: none

### 16. Privy SDK versions identical across both apps - no drift today
- **Severity**: P2
- **Evidence**:
  - `apps/research/package.json:28-29` - `"@privy-io/node": "^0.16.0"`, `"@privy-io/react-auth": "^3.16.0"`.
  - `apps/trading/package.json:20-22` - same `0.16.0` / `3.16.0` plus the deprecated `@privy-io/server-auth` (covered in finding 2).
- **Impact**: None today - versions match. Flagging here so the audit catches drift on the next bump. Add a CI check or lockfile diff if not already present.
- **Fix sketch**:
  - No code change today. Add a workspace-root `npm ls @privy-io/react-auth` check to CI on every PR that mutates package files.
- **Canonical pattern**: `.claude/rules/coding-standards.md`
- **Estimated effort**: XS
- **Dependencies**: none

### 17. `walletChainType: 'ethereum-and-solana'` set in both configs - confirmed correct
- **Severity**: P2 (resolved on inspection)
- **Evidence**:
  - `apps/research/src/lib/privy-config.js:36` - `walletChainType: 'ethereum-and-solana'`.
  - `apps/trading/src/lib/privy-config.js:19` - `walletChainType: 'ethereum-and-solana'`.
- **Impact**: None - both apps create both chains' embedded wallets on signup. Listed for completeness so reviewers don't re-flag this.
- **Fix sketch**: none required.
- **Canonical pattern**: `.claude/rules/solana-web3.md` section A
- **Estimated effort**: XS
- **Dependencies**: none

### 18. EIP-7702 batching not used for EVM approve + swap
- **Severity**: P3
- **Evidence**:
  - `apps/trading/api/swap.js:382-431` - 0x Permit2 quote handler. We use `swap/permit2` (one signature for approve+swap, which is good) but do NOT use `wallet_sendCalls` (EIP-7702) which would batch the entire flow into a single user-visible signature.
  - No grep hits for `wallet_sendCalls` or `EIP-7702` in either app.
- **Impact**: We already save the approve tx via Permit2 (finding 25 confirms this is on). EIP-7702 on top would let us also batch the approve sig into the same flow as the swap. Marginal UX win - one less signature step on the first swap of a session.
- **Fix sketch**:
  - Pilot on Base only (cheapest gas, most active EIP-7702 users).
  - Use Privy's batch transaction helper (`wallet_sendCalls`) per `.claude/knowledge/privy/05-transactions-and-signing.md`.
  - Measure swap completion rate before/after; ship to all chains if positive.
- **Canonical pattern**: `.claude/knowledge/privy/05-transactions-and-signing.md` (batch-transactions section)
- **Estimated effort**: M
- **Dependencies**: 10 (needs useSendTransaction migration first)

### 19. No server wallets for agent / bot flows
- **Severity**: P3
- **Evidence**:
  - Grep across `packages/server/` for `createWallet`, `wallet.create`, `Privy.*Wallet` returns no hits. No server-managed wallets exist.
  - All wallets are user-owned embedded wallets created at signup.
- **Impact**: When we build Monarch trading-agent or any "auto-execute" feature, we'll need server-managed wallets with bounded authorization. Currently we'd have to hand-roll private key management.
- **Fix sketch**: Use Privy's server wallet primitives (key quorums) when the agent product launches. Document the threat model in advance.
- **Canonical pattern**: `.claude/knowledge/privy/08-server-sdk.md`, `.claude/knowledge/privy/10-wallet-controls-and-authorization.md`
- **Estimated effort**: L
- **Dependencies**: product spec for agent flows

### 20. No delegation / time-bounded server signing
- **Severity**: P3
- **Evidence**:
  - Grep for `delegation`, `authorization_signature`, `privy-authorization-signature` returns 0 hits in `apps/` and `packages/server/`.
- **Impact**: Future "auto-sniper" / "scheduled buys" features will need delegated signing. Today we can't sign on behalf of a user even with their consent because we have no authorization flow.
- **Fix sketch**: Implement Privy's `authorization-signature` flow when the auto-execute product spec lands.
- **Canonical pattern**: `.claude/knowledge/privy/10-wallet-controls-and-authorization.md`, `.claude/knowledge/privy/05-transactions-and-signing.md`
- **Estimated effort**: L
- **Dependencies**: 19

### 21. No MFA enforcement
- **Severity**: P3
- **Evidence**:
  - Privy dashboard MFA settings unknown from code, but neither app's privy-config requests MFA enforcement.
  - No `setMfaRequired` or equivalent calls in either codebase.
- **Impact**: A stolen email-link login could drain the user's embedded wallet. We rely entirely on Privy's session security with no second factor.
- **Fix sketch**:
  - Enable optional TOTP + passkey MFA via Privy dashboard.
  - Make MFA mandatory for users with > $X balance (gate this via subscription tier or a hard threshold).
  - Surface MFA enrollment in user-dashboard wallet section.
- **Canonical pattern**: `.claude/knowledge/privy/01-auth-and-identity.md`
- **Estimated effort**: M
- **Dependencies**: product decision on whether to gate by tier

### 22. Off-ramp not implemented
- **Severity**: P3
- **Evidence**:
  - `apps/research/src/lib/privy-config.js:77-80` - `fundingMethodsAndOrder` configured but no equivalent `offramp` config.
  - No "Cash out" or "Withdraw to bank" UI exists in user-dashboard.
- **Impact**: Users can fund the app but not cash out crypto to fiat without leaving the platform. Tier 1 retention issue.
- **Fix sketch**: Enable off-ramp via MoonPay or Privy's partner integrations once a vendor is selected.
- **Canonical pattern**: `.claude/knowledge/privy/07-funding-and-onramp.md`
- **Estimated effort**: L
- **Dependencies**: vendor selection

### 23. WalletConnect-Pay deposits not implemented
- **Severity**: P3
- **Evidence**:
  - `walletList` includes `wallet_connect` (WC v2 QR pairing) for sign-in, but no Pay flow (deposit via WC tx) exists.
- **Impact**: Power users with WalletConnect-only wallets (Trust mobile, Ledger Live) cannot deposit funds in one tap.
- **Fix sketch**: Add WC-Pay deposit option in user-dashboard funding modal.
- **Canonical pattern**: `.claude/knowledge/privy/07-funding-and-onramp.md`
- **Estimated effort**: M
- **Dependencies**: 22

### 24. Single EVM aggregator (0x) - no Bebop or fallback router
- **Severity**: P3
- **Evidence**:
  - `apps/trading/api/swap.js:14` - `ZEROX_API = 'https://api.0x.org'` only.
  - `apps/research/api/_lib/handlers/swap.js:18` - same.
  - No Bebop / 1inch / Paraswap fallback path.
- **Impact**: On 0x outages, EVM swaps die. Also miss potentially better quotes for large size from Bebop.
- **Fix sketch**: Wire Bebop as a second aggregator for orders > $10k. Compare quotes server-side, route to best.
- **Canonical pattern**: `.claude/knowledge/privy/06-swaps-and-trading.md`
- **Estimated effort**: L
- **Dependencies**: vendor agreement with Bebop

### 25. Permit2 server endpoint in use, but client never signed the permit - **RESOLVED 2026-05-20 (was a P0 beta blocker)**
- **Severity**: was P0 (EVM ERC-20 swaps fully broken). The "verify only" note below turned out to be the actual bug.
- **Evidence (original)**:
  - Server used `${ZEROX_API}/swap/permit2/quote` and returned `permit2: quoteData.permit2 || null` + raw `transaction`.
  - But `swapService.executeEvmSwap` sent `quote.transaction.data` RAW, never signed `quote.permit2.eip712`, and the only approval branch keyed off `quote.allowanceTarget` - a field the server never returns (dead code). Result: every ERC-20 sell reverted on-chain and burned gas. Native sells happened to work (no permit needed).
- **Fix (shipped)**: `executeEvmSwap` now, when `quote.permit2.eip712` is present: max-approves the canonical Permit2 singleton once per token, `signTypedData`s the permit, and appends `uint256(sigLength)+signature` to the calldata via the new exported `appendPermit2Signature` helper (unit-tested). Dead `allowanceTarget`/`ensureTokenApproval` branch removed. Both apps.
- **Still pending**: a LIVE small ERC-20 sell (e.g. USDC->WETH on Base) from an embedded wallet to confirm end-to-end. Code + unit test are in; real-funds verification is Gleb's.
- **Canonical pattern**: `.claude/knowledge/privy/06-swaps-and-trading.md` (step 4 - sign permit + append).

## Beta-readiness fixes (2026-05-20)

Closed alongside the Privy backlog, driven by the secy security pass + beta-readiness audit (see `~/.claude/plans/in-privy-folder-you-tranquil-honey.md`):

- **H1 / finding 25**: 0x v2 Permit2 EVM swap fixed (above). Unit-tested helper. **RESOLVED** (live verify pending).
- **Telegram login**: added `'telegram'` to `loginMethodsAndOrder.primary` in both `privy-config.js`. **CODE DONE** - Privy dashboard bot-token enable is Gleb's external step.
- **Withdraw address + wrong-chain validation**: new `validateWithdrawAddress(address, chainId)` in both `walletService.js` (ethers.isAddress incl. checksum for EVM, `new PublicKey()` for Solana, explicit wrong-chain rejection) + a two-stage form (review -> confirm) in both withdraw UIs. Unit-tested. **RESOLVED** - biggest irreversible fund-loss gap.
- **L5**: server-side base-unit amount validation (`isValidBaseUnitAmount`, positive-integer-string) in both Vercel swap handlers + dev Express. Unit-tested. **RESOLVED**.
- **L6**: server-side 15% price-impact hard ceiling on quotes (Jupiter + 0x), 422 on breach, all three handlers. **RESOLVED**.
- **L7**: token-iframe `spectre-trading-*.vercel.app` preview-origin regex no longer trusted on the prod research host (`app.spectreai.io`). **RESOLVED**.
- **L8**: swap-log PII scrub - sha256 user tag instead of raw DID prefix, trade amounts dropped from the log line. **RESOLVED**.
- **M4**: `apps/trading/api/onchain.js` CORS no longer reflects a fallback origin or sets `Allow-Credentials` on the public endpoint; allow-list aligned to `app/trade.spectreai.io`. **RESOLVED**.
- **Test infra**: first Vitest suite (27 tests, fund-safety logic) + Playwright scaffold + GitHub Actions CI (`npm test`). **RESOLVED**.
- **Estimated effort**: XS (verify only)
- **Dependencies**: none

## Priority matrix

| ID | Title | Severity | Effort | Dependencies | Impact |
|----|-------|----------|--------|--------------|--------|
| 1 | No idempotency keys on swap submission | P0 | S | none | Double-spend risk |
| 2 | Trading uses deprecated `@privy-io/server-auth` | P0 | S | none | Security maintenance |
| 3 | No max price-impact guard | P0 | S | none | User can lose 50%+ on bad swaps |
| 4 | Trading uses v1 `loginMethods` | P1 | XS | 5 | UX inconsistency |
| 5 | Trading missing Solana external connectors | P1 | XS | 4 | Phantom/Solflare users blocked |
| 6 | Trading walletList generic `detected_wallets` | P1 | XS | 4 | Wallet detection precision |
| 7 | Trading missing `fundingMethodsAndOrder` | P1 | XS | none | Funding modal UX drift |
| 8 | Trading walletService no Multicall3 | P1 | M | none | 4x RPC traffic, 429 risk |
| 9 | No cross-app session sharing | P1 | L | custom domains | Double login on /token iframe |
| 10 | Swap not using Privy `useSendTransaction` | P1 | M | none | Misses idempotency + tracking |
| 11 | DOM-hack on Privy modal | P2 | M | Privy SDK upgrade | Fragile, breaks on Privy redesign |
| 12 | `getAccessToken` in deps in trading useProfileSync | P2 | XS | none | Footgun for new contributors |
| 13 | No Privy webhooks | P2 | M | 10 | Polling waste, no server-side swap log |
| 14 | Research error boundary doesn't report Privy crashes | P2 | XS | none | No visibility into crash rate |
| 15 | Trading CSP weaker than research | P2 | S | none | Looser XSS posture |
| 16 | Privy SDK versions identical today | P2 | XS | none | None today, future drift |
| 17 | `walletChainType` correct in both - resolved | P2 | XS | none | None |
| 18 | EIP-7702 not used for EVM batching | P3 | M | 10 | One less signature on first swap |
| 19 | No server wallets for agent flows | P3 | L | product spec | Blocks Monarch trading agent |
| 20 | No delegation / time-bounded server signing | P3 | L | 19 | Blocks auto-sniper |
| 21 | No MFA enforcement | P3 | M | tier decision | Stolen-session risk |
| 22 | No off-ramp | P3 | L | vendor selection | Retention |
| 23 | No WalletConnect-Pay deposits | P3 | M | 22 | Power user funding UX |
| 24 | No Bebop / second EVM aggregator | P3 | L | vendor | Better quotes + redundancy |
| 25 | Permit2 IS in use - resolved | P3 | XS | none | None - verified |

## Sequencing suggestion

A recommended order to tackle gaps:

- **Week 1 (P0 - security and correctness)**: 1, 2, 3
  - All three are S-effort, no cross-dependencies. Ship in one PR per app.
  - Finding 1 unlocks finding 10 (idempotency makes useSendTransaction migration trivial).

- **Week 2 (P1 config alignment)**: 4, 5, 6, 7
  - All XS. Bundle into a single "trading config parity with research" PR.
  - Test the modal end to end and verify Phantom button appears on trading.

- **Week 3 (P1 capabilities)**: 8, 10, 14
  - 8 (Multicall3 migration): copy-paste plus tests. M-effort but bounded.
  - 10 (useSendTransaction): biggest near-term lift. Enables 1, 13, 18.
  - 14 (error boundary reporting): XS, do alongside.

- **Week 4 (P1 strategic + P2 hygiene)**: 9, 11, 12, 13, 15, 16
  - 9 (cross-app session sharing): L-effort, may slip into week 5.
  - 11 (DOM-hack removal): contingent on Privy SDK upgrade or vendor response.
  - 12, 14, 15, 16: tidy-up PRs.

- **Quarter 2 (P3 future capabilities)**:
  - 19, 20 (server wallets + delegation): unlock the agent product line.
  - 21 (MFA): paid-tier feature.
  - 22, 23 (off-ramp, WC-Pay): retention features.
  - 24 (Bebop): once 0x reliability becomes the bottleneck.
  - 18 (EIP-7702): polish, do after 10.

## Cross-references

- Current implementation snapshot -> `current-implementation.md` (to be written)
- Canonical patterns -> `patterns.md` (to be written)
- Auth + identity -> `.claude/knowledge/privy/01-auth-and-identity.md`
- Embedded wallets -> `.claude/knowledge/privy/02-embedded-wallets.md`
- Solana integration -> `.claude/knowledge/privy/03-solana-integration.md`
- EVM integration -> `.claude/knowledge/privy/04-evm-integration.md`
- Transactions & signing -> `.claude/knowledge/privy/05-transactions-and-signing.md`
- Swaps & trading -> `.claude/knowledge/privy/06-swaps-and-trading.md`
- Funding & onramp -> `.claude/knowledge/privy/07-funding-and-onramp.md`
- Server SDK -> `.claude/knowledge/privy/08-server-sdk.md`
- UI customization -> `.claude/knowledge/privy/09-ui-and-customization.md`
- Wallet controls + authorization -> `.claude/knowledge/privy/10-wallet-controls-and-authorization.md`
- Spectre wallet rules -> `.claude/rules/solana-web3.md`
