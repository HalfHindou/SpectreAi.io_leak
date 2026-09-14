---
description: Snapshot of every Privy touchpoint in the Spectre codebase as of 2026-05-19. Living document - update when Privy code changes.
---

# Spectre Privy - Current Implementation Snapshot

> Last updated: 2026-05-19. AS-IS state. For where we want to go see `audit-gaps.md`. For canonical Privy patterns see the numbered KB files in the parent folder. **Truth lives in code. If this file conflicts with the code, the code wins and this doc is stale.**

---

## At-a-glance summary

- Two PrivyProvider instances (one per Vite app) on different ports / subdomains. Independent sessions, no SSO between them.
- Both apps create EVM + Solana embedded wallets on login for users-without-wallets
- All transaction signing is client-side via Privy modal (no server-controlled wallets)
- Custom swap pipeline (NOT Privy built-in `useSwap`): Solana via Jupiter, EVM via 0x v2 with Permit2
- Profile data synced to Vercel KV via `/api/user/*` - **server-side Privy JWT verification via `@privy-io/node` JWKS** (audit corrected an earlier assumption that this was missing)
- Strong CSP in both `vercel.json` files (`frame-src https://auth.privy.io`)
- Webhook receiver LIVE as of 2026-05-20: single Privy endpoint -> `https://spectre-app-research.vercel.app/api/privy-webhook` (deliberately the `.vercel.app` URL, NOT the custom domain - see Cloudflare note below). 18 events subscribed. `PRIVY_WEBHOOK_SIGNING_SECRET` set on research + redeployed. Shared Upstash KV means both apps read what the single receiver writes.
- No delegation, policies, signers, server wallets, MFA enforcement, captcha
- SDK versions are aligned: `@privy-io/react-auth@^3.16.0` and `@privy-io/node@^0.16.0` in both apps

## ⚠️ Cloudflare + server-to-server `/api/*` (infra gotcha)

The Privy webhook endpoint is registered at `spectre-app-research.vercel.app/api/privy-webhook`, NOT `app.spectreai.io/api/privy-webhook`. Reason: if the custom domains (`app.spectreai.io` / `trade.spectreai.io`) are **orange-cloud proxied** in Cloudflare with Bot Fight Mode / managed challenge enabled, Cloudflare challenges automated server-to-server POSTs (no browser, no JS to solve the challenge) and they fail before reaching Vercel. The `.vercel.app` domains are served directly by Vercel, bypassing Cloudflare entirely.

**This is NOT webhook-specific.** ANY future server-to-server caller hitting `*.spectreai.io/api/*` faces the same risk: additional webhook providers, external cron, partner integrations, uptime monitors, the SSE relay calling back, etc.

**Proper fix (do once in Cloudflare, then custom domains work for all server-to-server `/api/*`):**
1. Cloudflare → `spectreai.io` zone → Security → WAF → Custom rules → Create rule
2. Expression: `(http.request.uri.path contains "/api/")` (optionally scope to the two hostnames)
3. Action: **Skip** → check "All managed rules", "Bot Fight Mode", "Rate limiting", "Browser Integrity Check"
4. Deploy. After this, server-to-server `/api/*` on custom domains is no longer challenged, and the webhook could be repointed to `app.spectreai.io` if desired.

**Diagnostic first:** confirm whether the subdomains are orange-cloud (proxied) or gray-cloud (DNS-only). Phase A set them gray-cloud for SSL provisioning; if still gray-cloud, Cloudflare isn't in the path and the `.vercel.app` webhook URL is just belt-and-suspenders.
- Trading has `@privy-io/server-auth@^1.18.0` installed but UNUSED (legacy from a prior migration; safe to remove)

---

## 1. Provider setup - research app

**Files**: `apps/research/src/main.jsx`, `apps/research/src/lib/privy-config.js`

SDK version: `@privy-io/react-auth@^3.16.0` (latest 3.x as of 2026-05). Despite the "v2 vs v1" labels in the trading CLAUDE.md, this refers to CONFIG SHAPE (`loginMethodsAndOrder` vs `loginMethods`), not SDK major version.

Configuration (verbatim from `privy-config.js:22-81`):

```js
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'

const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: false,
})

export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || ''

export const privyConfig = {
  loginMethodsAndOrder: {
    primary: ['email', 'google', 'twitter'],
    overflow: ['discord', 'apple', 'wallet'],
  },
  appearance: {
    theme: '#0c0c0e',
    accentColor: '#18181b',
    logo: '/spectre-logo-dark.png',
    landingHeader: 'Sign in to Spectre AI',
    loginMessage: 'Your gateway to institutional-grade crypto intelligence.',
    walletChainType: 'ethereum-and-solana',
    walletList: [
      'detected_ethereum_wallets',
      'detected_solana_wallets',
      'metamask',
      'phantom',
      'coinbase_wallet',
      'backpack',
      'solflare',
      'okx_wallet',
      'safe',
      'zerion',
      'rainbow',
      'wallet_connect',
    ],
    showWalletLoginFirst: false,
  },
  externalWallets: {
    solana: {
      connectors: solanaConnectors,
    },
  },
  embeddedWallets: {
    ethereum: { createOnLogin: 'users-without-wallets' },
    solana: { createOnLogin: 'users-without-wallets' },
  },
  fundingMethodsAndOrder: {
    primary: ['card'],
    overflow: ['exchange'],
  },
}
```

Conditional mount in `main.jsx`:

```jsx
{PRIVY_APP_ID ? (
  <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
    {appTree}
  </PrivyProvider>
) : appTree}
```

Modal DOM hacks in `main.jsx` (research version is more aggressive, ~300 lines):
- Auto-clicks the "Continue with Email" button if hidden behind wallet list
- Fixes wallet list scroll via react-window DOM manipulation (the modal uses a virtualized list; default scroll behavior misses the inner scroll container)
- Targets selectors: `#privy-modal-content`, `.login-method-button`, `input[type="email"]`
- Also has showcase-iframe bypass logic (when research is embedded in a marketing iframe, skip the gate)

AppErrorBoundary class component (top of tree, in `main.jsx`) - catches any Privy hook crash and renders a plain HTML fallback so the whole app doesn't blank.

KB canonical pattern: `01-auth-and-identity.md`, `09-ui-and-customization.md`.

---

## 2. Provider setup - trading app

**Files**: `apps/trading/src/main.jsx`, `apps/trading/src/lib/privy-config.js`

SDK version: `@privy-io/react-auth@^3.16.0` (same as research).

Configuration (verbatim from `privy-config.js:11-51`):

```js
export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || ''

export const privyConfig = {
  loginMethods: ['email', 'google', 'twitter', 'apple', 'discord', 'wallet'],
  appearance: {
    theme: '#0c0c0e',
    accentColor: '#18181b',
    logo: '/spectre-logo-dark.png',
    landingHeader: 'Sign in to Spectre AI',
    loginMessage: 'Your gateway to institutional-grade crypto intelligence.',
    walletChainType: 'ethereum-and-solana',
    walletList: [
      'detected_wallets',
      'metamask',
      'phantom',
      'coinbase_wallet',
      'backpack',
      'solflare',
      'okx_wallet',
      'safe',
      'zerion',
      'rainbow',
      'wallet_connect',
    ],
    showWalletLoginFirst: false,
  },
  embeddedWallets: {
    ethereum: { createOnLogin: 'users-without-wallets' },
    solana: { createOnLogin: 'users-without-wallets' },
  },
}
```

**DRIFT vs research** (each is a finding in `audit-gaps.md`):

| Config | Research | Trading |
|--------|----------|---------|
| Login method API | `loginMethodsAndOrder` (tiered primary/overflow) | `loginMethods` (flat array) - audit-gaps #4 |
| Solana external connectors | `toSolanaWalletConnectors` imported + wired | **Same as research as of 2026-05-19** (audit-gaps #5 RESOLVED) |
| Detected wallets entry | `detected_ethereum_wallets` + `detected_solana_wallets` (split) | **Same as research as of 2026-05-19** (audit-gaps #6 RESOLVED) |
| `fundingMethodsAndOrder` | Explicit: card primary, exchange overflow | Not set - inherits Privy defaults - audit-gaps #7 |

Trading `main.jsx` quirks:
- Buffer polyfill is the FIRST import (Solana wallet code requires Buffer global)
- StrictMode disabled in dev to prevent EventSource double-mount issues (codexApi.js streaming + agent team API)
- Token prefetch via hash before React mount (warm cache on initial page load)
- Simpler DOM hacks than research, but same intent (email tile + wallet list scroll)

The trading CLAUDE.md notes: "v1 `loginMethods` - intentional, do not upgrade to v2 without testing Solana wallet flow". This is a flag from a past attempt; the migration is in `audit-gaps.md` #4 but is gated on Solana wallet UX regression testing.

KB canonical pattern: `01-auth-and-identity.md`, `03-solana-integration.md`.

---

## 3. Auth display utility

**File**: `apps/research/src/lib/privy-user.js`

The full function (verbatim):

```js
export function getPrivyDisplayInfo(user) {
  if (!user) return { name: null, avatar: null, email: null }

  const name =
    user.google?.name ||
    user.twitter?.name ||
    user.apple?.email?.split('@')[0] ||
    user.email?.address?.split('@')[0] ||
    (user.wallet?.address
      ? `${user.wallet.address.slice(0, 6)}...${user.wallet.address.slice(-4)}`
      : null)

  const email =
    user.email?.address ||
    user.google?.email ||
    user.apple?.email ||
    null

  const avatar =
    user.google?.picture ||
    user.twitter?.profilePictureUrl ||
    null

  return { name, avatar, email }
}
```

Used by: Header avatar, UserDashboard profile section, sidebar user chip. The trading app has an equivalent (also at `apps/trading/src/lib/privy-user.js` or duplicated in user-dashboard components - verify before refactoring).

KB canonical pattern: `01-auth-and-identity.md`, `spectre/patterns.md` Pattern 8.

---

## 4. AuthGate (team password, NOT Privy)

**Files**: `apps/research/src/components/AuthGate.jsx`, `apps/trading/src/components/AuthGate.jsx`

This is a **sessionStorage-based team password gate**, completely separate from Privy. It exists because Spectre is pre-launch and we want to gate the URL from random visitors.

Behavior:
- Checks `isDevBypass` at module load (NOT inside the component) to avoid flash of password screen on localhost
- Reads `sessionStorage.getItem('spectre-auth')` for the team password hash
- If absent, renders a password form; on submit, hashes input and compares to a hardcoded SHA
- On match, sets sessionStorage and renders children

Note: AuthGate auto-bypasses on `localhost` and on Vercel preview deployments where `import.meta.env.DEV === true`.

When real launch happens, AuthGate is likely removed entirely or replaced with a real public landing page.

KB canonical pattern: `spectre/patterns.md` Pattern 13. NOT a Privy pattern.

---

## 5. Embedded wallet usage

**Where hooks are called**:
- `apps/research/src/hooks/useWalletBalance.js` - polls balance for header
- `apps/research/src/pages/user-dashboard/components/ud-wallets-*` - wallet management UI
- `apps/research/src/hooks/useSwapExecution.js` - swap signing
- `apps/trading/src/components/UserDashboard/index.jsx` - wallet display + withdraw UI
- `apps/trading/src/hooks/useSwapExecution.js` - swap signing
- `apps/trading/src/hooks/useWalletBalance.js` / `useWalletBalances.js` - balance polling

**Filter pattern** (used everywhere):

```js
const wallets = useWallets()
const embedded = wallets.filter(w => w.walletClientType === 'privy')
const embeddedEvm = wallets.find(w => w.walletClientType === 'privy' && w.chainType === 'ethereum')
const embeddedSolana = wallets.find(w => w.walletClientType === 'privy' && w.chainType === 'solana')
```

**Creation policy**: both apps have `createOnLogin: 'users-without-wallets'` for both Ethereum and Solana. We do NOT manually call `useCreateWallet()` anywhere - all creation is automatic on first login for users who don't already have an external wallet linked.

**Pre-hydration hooks**: `useWallets`, `useFundWallet`, `useConnectWallet`, `useSendTransaction` all crash if called before Privy hydrates. We defer them to child components (e.g., UserDashboard) that only mount after the user navigates to the wallet tab, by which time Privy is ready.

KB canonical pattern: `02-embedded-wallets.md`, `spectre/patterns.md` Pattern 2.

---

## 6. Swap execution

**Files**: `apps/trading/src/hooks/useSwapExecution.js`, `apps/research/src/hooks/useSwapExecution.js` (research uses `@/` aliases, trading uses relative imports - otherwise the logic is similar)

Hook signature:

```js
const {
  quote,           // current aggregator quote
  quoteLoading,
  quoteError,
  isSwapping,
  swapSuccess,
  swapError,
  txHash,
  // ...
} = useSwapExecution({ token, mode, payToken, slippageBps })
```

Critical constants (in trading version):
- `QUOTE_DEBOUNCE_MS = 400`
- Slippage clamped to `[1, 500]` bps (0.01% to 5%)
- Default slippage: 50 bps
- Stale-quote guard: every quote response is tagged with a request ID; if the in-flight ID doesn't match the latest request, the response is dropped

Chain routing logic:

```js
const isSolana = payToken?.chainId === 1399811149  // Codex internal Solana networkId
if (isSolana) {
  // -> Jupiter aggregator path
  // 1. fetch quote from Jupiter /quote
  // 2. fetch swapTransaction from Jupiter /swap (returns base64 VersionedTransaction)
  // 3. deserialize to VersionedTransaction
  // 4. sign + send via embedded Solana wallet
} else {
  // -> 0x v2 aggregator path with Permit2
  // 1. fetch quote from `${ZEROX_API}/swap/permit2/quote`
  // 2. sign Permit2 typed data (if needed)
  // 3. send transaction with calldata
}
```

Fee collection: hardcoded fee recipient + bps from env vars (`VITE_FEE_WALLET_*`, `VITE_FEE_BPS`), passed to the aggregator's `integratorFee`/`affiliate` parameter. The server `/api/fee-config` returns the same values for cross-checking.

Quote fetching: debounced + AbortController. Each new keystroke cancels the prior fetch.

Error handling: distinguishes "user rejected" (close modal silently) from network / quote errors (surface as `swapError`).

**Audit notes**:
- No idempotency keys today (`audit-gaps.md` #1) - flaky network retry can submit the swap twice
- No max price-impact guard - slippage is capped at 5% but `priceImpactPct` from quote is unchecked (`audit-gaps.md` #3)
- Spectre uses `swapService.executeSwap`, NOT Privy's `useSendTransaction` (`audit-gaps.md` #10)

KB canonical pattern: `06-swaps-and-trading.md`, `05-transactions-and-signing.md`.

---

## 7. Wallet balance reads

**Files**:
- `apps/trading/src/services/walletService.js` - low-level provider + RPC
- `apps/trading/src/hooks/useWalletBalance.js` - header USD total, 30s poll
- `apps/trading/src/hooks/useWalletBalances.js` - per-token array for swap UI, 15s poll
- `apps/research/src/services/walletService.js` - research equivalent

`walletService.js` (trading) behavior - **Multicall3 ported 2026-05-19**:
- `Map<chainId, Provider>` cache for ethers JsonRpcProvider instances
- EVM native + ERC-20s: ONE `aggregate3()` call on Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`, same address on all 5 EVM chains we support). Encodes `getEthBalance(addr)` + `balanceOf(addr)` per token in a single batch.
- Sequential `Promise.all` fallback only if Multicall3 reverts (defensive - shouldn't fire in practice)
- `COMMON_TOKENS` now schema `{ symbol: { address, decimals } }` so decimals are authoritative without a `decimals()` RPC call per token
- Solana native: `Connection.getBalance(publicKey)` via @solana/web3.js
- Solana SPL: `getAssociatedTokenAddressSync` from @solana/spl-token (dynamic import to keep main bundle lean), then `getTokenAccountBalance`
- Hardcoded ERC-20 lists per chain (USDT, USDC, WETH per Ethereum / Base / Polygon / Arb / BSC)
- Returns zero balance on errors (doesn't throw) so a single missing token doesn't break the whole panel

Visibility-aware polling: `useVisibilityAwareInterval` hook skips fetches when `document.hidden`. Saves RPC credits on hidden tabs.

**Tech debt** (closed): trading CLAUDE.md previously flagged "walletService.js uses sequential Promise.all instead of Multicall3 batching" - resolved by porting the Multicall3 impl from research. The CLAUDE.md note has been updated.

KB canonical pattern: `02-embedded-wallets.md`, `04-evm-integration.md`, `spectre/patterns.md` Pattern 7.

---

## 8. Profile sync

**Files**:
- Research: `apps/research/src/services/profileSync.js` wired via `ProfileSyncInit` component in `App.jsx:178-215`
- Trading: `apps/trading/src/hooks/useProfileSync.js` + `apps/trading/src/services/profileSync.js`

Both apps sync profile data to Vercel KV under key `user:{did}:profile`.

Trading hook behavior (relevant to Privy):
- Calls `getAccessToken()` from `usePrivy()` to obtain JWT
- POSTs to `/api/user/profile` with `Authorization: Bearer <token>` header
- Server verifies token via `@privy-io/node` JWKS (see section 9)
- `didSync.current` ref guards against double-sync on render churn

Research uses the same pattern but invocation is via a `ProfileSyncInit` mount effect in `App.jsx` rather than a hook called from a leaf component.

**Note** (correction to an earlier audit assumption): research DOES have profile sync. The audit-gaps agent validated this against `apps/research/src/services/profileSync.js` and `App.jsx:178-215`.

KB canonical pattern: `08-server-sdk.md`, `01-auth-and-identity.md`.

---

## 9. Vercel serverless API routes + Privy auth

**Files**:
- `apps/research/api/_lib/auth.js` - JWT verification helper (research)
- `apps/trading/api/_lib/auth.js` - JWT verification helper (trading)
- `apps/research/api/user.js` - profile CRUD (auth required)
- `apps/research/api/swap.js` - swap quote + log (auth required for log)
- `apps/research/api/referral.js` - referral tracking (auth required)
- `apps/trading/api/user.js` - profile CRUD (auth required)
- `apps/trading/api/swap.js` - swap quote + log (auth required for log; trading also enforces on-chain signer + fee-transfer check)
- `apps/trading/api/referral.js` - referral (auth required)
- `apps/trading/api/fee-config.js` - PUBLIC (cached 5min)
- Both apps: `api/codex.js`, `api/img-proxy.js`, `api/binance-ticker.js`, `api/cg-proxy.js`, etc. are PUBLIC

**Authentication path** (corrected from earlier audit assumption):

Both `_lib/auth.js` files use `@privy-io/node` with JWKS verification. They:
1. Extract `Authorization: Bearer <token>` from request headers
2. Fetch JWKS (cached) from `https://auth.privy.io/.well-known/jwks.json`
3. Verify JWT signature + standard claims (`iss`, `aud`, `exp`)
4. Return verified `{ did, sessionId, appId }` or throw

Routes that require auth wrap their handlers with this verifier and reject 401 on failure.

**Verdict**: server-side Privy authentication IS in place. This was a corrected finding during the audit-gaps build. The earlier P0 list claimed `/api/user/*` was unauthenticated; that was false.

KB canonical pattern: `08-server-sdk.md`.

---

## 10. Server (packages/server/)

`packages/server/` is the dev-mode Express server (`packages/server/index.js`, 409KB monolith) that proxies API requests in development.

**Grep for `privy` / `@privy-io` in `packages/server/`**: ZERO matches. The Express dev server has NO Privy integration. In dev, the API routes called by the client go through Vite's proxy to Express. If a route checks Privy auth in production (via `apps/*/api/_lib/auth.js`), it does NOT in development.

This is acceptable for dev (localhost, single dev) but creates a dev/prod parity gap: a bug in auth handling on production would not surface in local dev.

Possible improvement: port the `_lib/auth.js` verification into the Express server as middleware so dev behaves identically to prod. Not currently prioritized.

KB canonical pattern: `08-server-sdk.md`.

---

## 11. Cross-app session sharing

**Current state**: NOT working. Login on `app.spectreai.io` does NOT carry to `trade.spectreai.io` (user appears logged out). Confirmed by Gleb 2026-05-22.

- Research at `app.spectreai.io` (alias `spectre-app-research.vercel.app`), trading at `trade.spectreai.io` (alias `spectre-trading.vercel.app`)
- Each app mounts its own PrivyProvider with the same `VITE_PRIVY_APP_ID`
- Privy stores the session in **localStorage by default = origin-scoped**, so `app.` and `trade.` (different origins) share nothing.

**IMPORTANT - prior false "RESOLVED" claim (corrected 2026-05-22):** an earlier note (audit-gaps #9, 2026-05-19) claimed the same `appId` + same `.spectreai.io` parent meant "Privy session at auth.privy.io is shared third-party... login carries without code change." That is WRONG: modern browser third-party-storage partitioning (and Safari ITP) block exactly that cross-site `auth.privy.io` storage. Do not rely on it.

**The fix (Privy-documented, dashboard + DNS only):** enable **HttpOnly first-party cookies** on the production Privy app with cookie domain `spectreai.io`. Privy then sets the access-token cookie on `spectreai.io` + subdomains, and the SDK restores the session from that first-party cookie on a fresh subdomain load -> automatic SSO across `app.`/`trade.` and inside the same-site `/token` iframe (fixes the Safari residual too). NO PrivyProvider/SDK code change.
Constraint: once the cookie domain is verified, that App ID **locks to spectreai.io + subdomains** and breaks on localhost / `*.vercel.app`. So dev/preview need a SEPARATE development App ID (Privy's prescribed pattern). Wire `VITE_PRIVY_APP_ID` + `PRIVY_APP_ID` per environment.
Docs: https://docs.privy.io/guide/react/configuration/cookies . Full runbook: `C:\Users\worka\.claude\plans\in-privy-folder-you-tranquil-honey.md` (top section).

**Repo support landed 2026-05-22:** `api/_lib/auth.js` (both apps) now reads the `privy-token` cookie as a fallback to the Bearer header; `.env.example` (both) document the dev/prod App-ID split. The actual enable is Gleb's dashboard + DNS task.

KB canonical pattern: `01-auth-and-identity.md`.

---

## 12. Developer Control

**Path**: `developer-control/` (standalone Vite app, port 5182, NOT in workspaces)

**Grep for `privy`**: zero matches. Developer Control is internal-only (team auth via the same AuthGate sessionStorage password, no Privy needed).

If Developer Control ever needs to call team-member-attributed APIs, Privy login could be added - but currently not needed.

---

## 13. Chrome Extension

**Path**: `packages/chrome-extension/` (Manifest V3, X/Twitter + DexScreener content scripts)

**Grep for `privy`**: zero matches. The extension reads market data from a public Spectre API (no auth required) and overlays it on third-party sites. No user state, no signing, no wallets.

---

## 14. Environment variables

| Var | Used by | Required |
|-----|---------|----------|
| `VITE_PRIVY_APP_ID` | Client (both apps), read by `privy-config.js` | Yes |
| `PRIVY_APP_ID` | Server (Vercel functions), read by `_lib/auth.js` | Yes |
| `PRIVY_APP_SECRET` | Server, read by `_lib/auth.js` (JWKS verification + future server SDK calls) | Yes |
| `VITE_FEE_WALLET_SOLANA` | Client swap | Yes |
| `VITE_FEE_WALLET_EVM` | Client swap | Yes |
| `VITE_FEE_BPS` | Client swap | Yes |
| `VITE_ETH_RPC_URL` | Client + server (EVM provider cache) | Yes (default Vercel public RPC if unset) |
| `VITE_BSC_RPC_URL` | Client + server | Yes |
| `VITE_POLYGON_RPC_URL` | Client + server | Yes |
| `VITE_ARB_RPC_URL` | Client + server | Yes |
| `VITE_BASE_RPC_URL` | Client + server | Yes |
| `VITE_SOLANA_CLUSTER` | Client + server (default mainnet) | Yes |
| `VITE_ZEROX_API` | Client + server (0x v2 base URL) | Yes |
| `VITE_JUPITER_API` | Client + server (Jupiter base URL) | Optional - defaults to public |

KB canonical pattern: `08-server-sdk.md` (server vars), `04-evm-integration.md` + `03-solana-integration.md` (chain vars).

---

## 15. Cross-cutting patterns

### Conditional PrivyProvider mounting
Both apps wrap PrivyProvider only if `PRIVY_APP_ID` is non-empty:

```jsx
{PRIVY_APP_ID ? <PrivyProvider ...>{children}</PrivyProvider> : children}
```

Prevents SDK crashes on dev machines without keys. Code that calls Privy hooks must handle the absent-provider case.

### `getAccessToken` stored in useRef
The function returned by `usePrivy()` changes every render. Used directly in deps it would cause infinite re-renders. Pattern (seen in `apps/trading/src/components/UserDashboard/index.jsx`):

```js
const { getAccessToken } = usePrivy()
const tokenRef = useRef(getAccessToken)
useEffect(() => { tokenRef.current = getAccessToken }, [getAccessToken])
// later: const token = await tokenRef.current()
```

`apps/trading/src/hooks/useProfileSync.js` does NOT use this pattern - it has `getAccessToken` in deps but guards execution with a `didSync.current` ref. This is a downgraded P2 in `audit-gaps.md` #12 because the guard prevents the loop but the pattern is fragile.

### Deferred Privy hooks
Hooks that crash before Privy hydrates (`useWallets`, `useFundWallet`, etc.) are called in child components mounted AFTER the user navigates to the wallet panel - by which time `ready === true`.

### AppErrorBoundary
Class component at the top of each app's `main.jsx` catches any uncaught error (including Privy hook crashes). Trading version reports to PostHog via `track(Events.AppCrashed, ...)`. Research version does NOT report (audit-gaps #14).

### CSP in vercel.json
Both apps have `Content-Security-Policy` headers in `vercel.json` that include `frame-src https://auth.privy.io` so the modal frame loads. Trading uses `'unsafe-inline'` in `script-src` (weaker); research uses SHA-256 hashes (stricter). Drift documented in audit-gaps #15.

KB canonical patterns: `spectre/patterns.md` Patterns 1-14.

---

## 16. Package versions

Verified via `package.json` reads:

| Package | Research | Trading |
|---------|----------|---------|
| `@privy-io/react-auth` | `^3.16.0` | `^3.16.0` |
| `@privy-io/node` | `^0.16.0` | `^0.16.0` |
| `@privy-io/server-auth` | NOT installed | `^1.18.0` (UNUSED legacy) |

**No version drift today**. The `audit-gaps.md` #16 entry flags this as "monitor for drift on future bumps". Trading's leftover `@privy-io/server-auth` is dead weight - safe to remove (`audit-gaps.md` #2).

---

## 17. Known issues / workaround log

- **Modal email tile auto-click hack** in both `main.jsx` files. Reason: Privy's default modal layout buries email below wallet list when the wallet list is long. Fix proposal: use `appearance` config to put email first (audit-gaps #11).
- **Wallet list scroll DOM hack** in both `main.jsx` files. Reason: the modal uses react-window virtualization and default DOM scroll doesn't target the inner container.
- **StrictMode disabled in dev** for trading. Reason: EventSource (codexApi streaming + agent team API) double-mounts under StrictMode and causes connection storms.
- **Buffer polyfill first import** in trading `main.jsx`. Reason: Solana wallet code requires Buffer global.
- **Token prefetch via hash before React mount** in trading `main.jsx`. Reason: warm the data cache before LeftPanel hydrates.
- **`getAccessToken` deps in useProfileSync** (trading) protected only by `didSync.current` ref. Audit downgraded to P2 because the guard works, but pattern is fragile.
- **Trading walletService sequential reads** for EVM balances. Multicall3 reference exists in research. Tech debt.
- **`@privy-io/server-auth@^1.18.0`** installed but unused in trading. Should be removed.
- **CSP drift**: trading uses `'unsafe-inline'` script-src; research uses SHA-256 hashes. Both work for Privy but trading's is weaker.
- **No idempotency keys** on swap signing. Flaky network retry risk.
- **No max price-impact guard** on swap. Degenerate quote could execute within slippage cap.

---

## Cross-references

- `../01-auth-and-identity.md` - canonical login methods
- `../02-embedded-wallets.md` - canonical wallet creation
- `../03-solana-integration.md` - canonical Solana setup (note trading drift)
- `../04-evm-integration.md` - canonical EVM setup, Multicall3 use
- `../05-transactions-and-signing.md` - canonical sign patterns, idempotency
- `../06-swaps-and-trading.md` - canonical swap, Permit2, Jupiter, 0x
- `../08-server-sdk.md` - server JWT verification (which we DO use via `_lib/auth.js`)
- `../09-ui-and-customization.md` - modal customization (we DOM-hack)
- `../11-security-and-webhooks.md` - CSP, allowed domains, webhooks
- `audit-gaps.md` - what we should fix
- `patterns.md` - patterns we've validated

---

## Update protocol

When Privy code changes in the codebase, update this file. The truth lives in source code, NOT in this snapshot. If a conflict exists between this doc and the code, the code wins and this doc is stale. Re-run grep for `privy` / `@privy-io` / `usePrivy` / `useWallets` after any non-trivial refactor.
