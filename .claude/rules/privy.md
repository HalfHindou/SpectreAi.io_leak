---
paths:
  - "apps/*/src/lib/privy-*.js"
  - "apps/*/src/main.jsx"
  - "apps/*/src/App.jsx"
  - "apps/*/src/components/AuthGate*"
  - "apps/*/src/components/UserDashboard/**"
  - "apps/*/src/pages/user-dashboard/**"
  - "apps/*/src/hooks/useSwapExecution.js"
  - "apps/*/src/hooks/useWalletBalance*.js"
  - "apps/*/src/hooks/useProfileSync.js"
  - "apps/*/src/services/walletService.js"
  - "apps/*/src/services/profileSync.js"
  - "apps/*/src/services/swapService.js"
  - "apps/*/api/_lib/auth.js"
  - "apps/*/api/user.js"
  - "apps/*/api/swap.js"
  - "apps/*/api/referral.js"
  - "apps/*/api/fee-config.js"
  - "apps/*/vercel.json"
---

# Privy Rules - Master Reference

> This file auto-loads when working on any Privy touchpoint. For deep dives see `.claude/knowledge/privy/` (15 files, ~15k lines).

---

## A. Knowledge base map

When the task touches a Privy surface, consult the matching knowledge file:

| Working on | Read |
|-----------|------|
| Login, modal, session, MFA, tokens | [01-auth-and-identity.md](../knowledge/privy/01-auth-and-identity.md) |
| Embedded wallet creation, types, custody, wallet list | [02-embedded-wallets.md](../knowledge/privy/02-embedded-wallets.md) |
| Solana provider, send SOL/SPL, MWA, Jupiter | [03-solana-integration.md](../knowledge/privy/03-solana-integration.md) |
| EVM chains, EIP-7702, batch tx, gas sponsorship, Multicall3 | [04-evm-integration.md](../knowledge/privy/04-evm-integration.md) |
| useSendTransaction, idempotency, signing, action status | [05-transactions-and-signing.md](../knowledge/privy/05-transactions-and-signing.md) |
| Swap UI, 0x v2, Bebop, Jupiter, Permit2, limit orders | [06-swaps-and-trading.md](../knowledge/privy/06-swaps-and-trading.md) |
| useFundWallet, card / Stripe / MoonPay onramp, off-ramp | [07-funding-and-onramp.md](../knowledge/privy/07-funding-and-onramp.md) |
| Server SDK, JWT verification, server wallets, server signing | [08-server-sdk.md](../knowledge/privy/08-server-sdk.md) |
| Modal theming, whitelabel, multi-dialog, React framework adapters | [09-ui-and-customization.md](../knowledge/privy/09-ui-and-customization.md) |
| Signers, policies, dual/quorum approval, delegation, custody continuum | [10-wallet-controls-and-authorization.md](../knowledge/privy/10-wallet-controls-and-authorization.md) |
| Security architecture, CSP, allowed domains, captcha, webhooks | [11-security-and-webhooks.md](../knowledge/privy/11-security-and-webhooks.md) |
| Migrating SDK versions, changelog highlights | [12-migrations-and-changelog.md](../knowledge/privy/12-migrations-and-changelog.md) |
| Polymarket, Telegram bot, Bankr, agentic wallets, vault ops | [13-defi-and-bot-recipes.md](../knowledge/privy/13-defi-and-bot-recipes.md) |
| Errors, troubleshooting, debugging tips | [14-errors-and-troubleshooting.md](../knowledge/privy/14-errors-and-troubleshooting.md) |
| **What we have today** in the Spectre codebase | [spectre/current-implementation.md](../knowledge/privy/spectre/current-implementation.md) |
| **What to fix** prioritized backlog (P0-P3) | [spectre/audit-gaps.md](../knowledge/privy/spectre/audit-gaps.md) |
| **Validated patterns** to reuse | [spectre/patterns.md](../knowledge/privy/spectre/patterns.md) |
| Knowledge base nav | [INDEX.md](../knowledge/privy/INDEX.md) |

Wallet / chain rules (NOT Privy-specific) live in [solana-web3.md](./solana-web3.md): supported chains table, Multicall3 batching, gas reserves, EVM native sentinel, networkId mapping, token registry.

---

## B. Cheat sheet

### Most-used hooks (v3.16 - verified against typings 2026-07-06)
```js
import { usePrivy, useWallets } from '@privy-io/react-auth'
// v3: the MAIN useWallets() returns EVM wallets ONLY. Solana wallets come
// from the /solana subpath's own useWallets (there is NO useSolanaWallets).
import { useWallets as useSolanaWallets, useSignAndSendTransaction } from '@privy-io/react-auth/solana'

const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy()
const { wallets } = useWallets()                 // EVM only
const { wallets: solWallets } = useSolanaWallets() // ConnectedStandardSolanaWallet[]

const embeddedEvm = wallets.find(w => w.walletClientType === 'privy' && w.chainType === 'ethereum')
const embeddedSol = solWallets.find(w => w.standardWallet?.isPrivyWallet)
// NEVER search the main `wallets` for chainType==='solana' - it can't match;
// that bug made the swap panel show "Insufficient balance" for funded wallets.
```

### Provider mount (conditional - skip if no APP_ID)
```jsx
{PRIVY_APP_ID ? (
  <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>{children}</PrivyProvider>
) : children}
```

### `getAccessToken` with useRef (prevents infinite loops)
```js
const { getAccessToken } = usePrivy()
const tokenRef = useRef(getAccessToken)
useEffect(() => { tokenRef.current = getAccessToken }, [getAccessToken])
// later: const token = await tokenRef.current()
```

### Server-side JWT verification (Vercel function)
```js
import { PrivyClient } from '@privy-io/node'
const client = new PrivyClient({ appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET })
const { userId } = await client.verifyAuthToken(token)
// userId === 'did:privy:...'
```

### Solana embedded wallet sign + send (v3)
```js
// The blessed path is the HOOK. Calling wallet.signAndSendTransaction (or the
// old getProvider() - removed in v3) routes through the wallet-standard
// CONNECT ceremony -> "User must be authenticated and have a Privy wallet
// before it can be connected".
const { signAndSendTransaction } = useSignAndSendTransaction() // from /solana
const txBytes = Uint8Array.from(Buffer.from(quote.swapTransaction, 'base64'))
const { signature } = await signAndSendTransaction({
  transaction: txBytes,           // serialized bytes, NOT an object
  wallet: embeddedSol,            // ConnectedStandardSolanaWallet
  chain: 'solana:mainnet',
})
// signature is Uint8Array -> bs58.encode(signature) for explorers/logging
```

### EVM embedded wallet sign + send (v3)
```js
// getEthersProvider() no longer exists in v3 - wrap the EIP-1193 provider.
await embeddedEvm.switchChain(targetChainId) // pin the chain BEFORE signing
const eip1193 = await embeddedEvm.getEthereumProvider()
const provider = new ethers.BrowserProvider(eip1193) // ethers v6
const signer = await provider.getSigner()
await signer.sendTransaction({ to, data, value })
```

---

## C. Current Spectre integration map

For the full snapshot see [spectre/current-implementation.md](../knowledge/privy/spectre/current-implementation.md). High-signal facts:

| Surface | State |
|---------|-------|
| `@privy-io/react-auth` | `^3.16.0` in both apps |
| `@privy-io/node` | `^0.16.0` in both apps (used by `_lib/auth.js` for JWT verification) |
| `@privy-io/server-auth` | `^1.18.0` installed in TRADING - UNUSED legacy, safe to remove |
| Research provider config | `loginMethodsAndOrder` (tiered), `toSolanaWalletConnectors`, split detected lists, `fundingMethodsAndOrder` |
| Trading provider config | `loginMethods` (flat), NO Solana connectors, generic `detected_wallets`, no funding config |
| Embedded wallets | EVM + Solana on login for users-without-wallets (both apps) |
| Swap path - Solana | Jupiter aggregator (not Privy `useSwap`) |
| Swap path - EVM | 0x v2 `/swap/permit2/quote` (Permit2 enabled) |
| Wallet balances - research | Multicall3 batched |
| Wallet balances - trading | Sequential `Promise.all` (tech debt) |
| Profile sync | Both apps -> Vercel KV `user:{did}:profile`, server JWT-verified |
| Server (Express dev) | NO Privy integration (parity gap) |
| Cross-app session sharing | NOT working today; fix = first-party cookie on `spectreai.io` (D12) |
| Webhooks, MFA enforcement, captcha, server wallets | Not used |
| Session signers + policies (Spectre Agent conditional orders) | LIVE on dev app 2026-07-11: key quorum s7f2ew4ouvzwki3zlewhcen0 + Solana program-allowlist policy ulj4hul1zeaism758cc3su9l; grant via useSigners (bridged through use-privy-safe); engine signs via @privy-io/node authorization_context. Full runbook: [agent-orders.md](./agent-orders.md) |

---

## D. Critical gotchas

### D1. Hooks crash before hydration
`useWallets`, `useConnectWallet`, `useFundWallet`, `useSendTransaction`, `useSolanaWallets` all crash if called before Privy hydrates. **Solution**: defer them to a CHILD component that only mounts after the user navigates to the wallet tab. Never call these hooks at the top of `App.jsx` or in a page wrapper. See [spectre/patterns.md](../knowledge/privy/spectre/patterns.md) Pattern 2.

### D2. `getAccessToken` reference changes every render
Putting it in a `useEffect` deps array causes an infinite loop. **Solution**: store in `useRef`, update via separate effect. See Pattern 3 in spectre/patterns.md and `apps/trading/src/components/UserDashboard/index.jsx` for working example. Exception: `useProfileSync.js` puts it in deps but guards with `didSync.current` to prevent re-fire.

### D3. Solana wallet missing from `useWallets()` (trading app)
Cause: trading's `privy-config.js` does NOT import `toSolanaWalletConnectors`. Phantom/Solflare external buttons absent. Research has the import. **Audit fix**: `audit-gaps.md` #5. Both apps DO have `walletChainType: 'ethereum-and-solana'` so embedded Solana wallets are created either way.

### D4. v1 vs v2 config drift between apps
Research uses `loginMethodsAndOrder: { primary: [...], overflow: [...] }`. Trading uses `loginMethods: [...]` (flat). SDK is the same version in both - only the config shape differs. Migrating trading is gated on Solana wallet UX regression testing per trading CLAUDE.md.

### D5. Modal email tile hidden behind wallet list
Both apps DOM-hack the modal in `main.jsx` to auto-click "Continue with Email" and fix wallet list scroll (the modal uses react-window virtualization). **Fragile** - breaks when Privy updates modal markup. Replace with `appearance.showWalletLoginFirst: false` + curated `walletList` order. See `audit-gaps.md` #11.

### D6. Codex Solana networkId is 1399811149
Not a real chain ID. Codex's internal Solana identifier. Used throughout `useSwapExecution.js` and `walletService.js` for chain routing. See [solana-web3.md section B](./solana-web3.md).

### D7. Buffer polyfill must be first import
Trading `main.jsx` imports `Buffer` from `'buffer'` and sets `window.Buffer = Buffer` as line 1. Solana web3.js requires Buffer global; without the polyfill you get `Buffer is not defined` at runtime.

### D8. Provider config goes through Privy dashboard too
Login methods enabled in code MUST also be enabled in the [Privy dashboard](https://dashboard.privy.io/). Allowed domains and OAuth redirect URIs are dashboard-only - not code. Vercel preview URLs are NOT auto-added; OAuth often fails on previews unless you wildcard. See [11-security-and-webhooks.md](../knowledge/privy/11-security-and-webhooks.md).

### D9. AuthGate is NOT Privy
The team password gate at the top of both apps (`AuthGate.jsx`) is a sessionStorage-based password gate, separate from Privy. Auto-bypassed on localhost. Don't confuse it with login state.

### D10. CSP must allow `frame-src https://auth.privy.io`
Without it, the Privy modal renders as a blank iframe and login silently fails. Both `vercel.json` files have this configured. Trading uses `'unsafe-inline'` script-src (weaker); research uses SHA-256 hashes (stricter). See `audit-gaps.md` #15.

**Telegram login needs MORE than the modal frame** (2026-05-22, prod-debugged via chrome-devtools). Clicking Telegram throws `Telegram was not initialized` because Privy loads its helper from `https://auth.privy.io/js/telegram-login.js` as a SCRIPT - and `auth.privy.io` was only in `connect-src`/`frame-src`, NOT `script-src`. Required CSP for Telegram login in BOTH `vercel.json`:
- `script-src`: add `https://auth.privy.io` AND `https://telegram.org` (trading was missing both; research was missing auth.privy.io).
- `frame-src`: add `https://oauth.telegram.org` (Telegram auth handshake).
Prod error order as you fix each layer: `Telegram Auth configuration is not loaded` (= bot token not on the Privy app prod actually uses - dashboard; prod app is `cmmkl27iz00v80bjibo1q0ypl` "Spectre AI App", shared by both apps via `VITE_PRIVY_APP_ID`) -> `Telegram was not initialized` (= script-src missing auth.privy.io). The app-config response `GET auth.privy.io/api/v1/apps/{id}` shows `telegram_auth:true/false` and is cached `max-age=300` - hard-reload after dashboard edits. Bot domain via BotFather `/setdomain` = the EXACT app origin, NOT auth.privy.io. Third error after CSP: the Telegram popup (`oauth.telegram.org/auth?bot_id=...&origin=...`) shows `Bot domain invalid` -> the bot's registered domain must EXACTLY match the embedding origin; Telegram does NOT subdomain-match, so `spectreai.io` does NOT cover `app.spectreai.io` - set it to `app.spectreai.io` (verified working 2026-05-22). localhost can't do Telegram (needs a public domain). **One bot = one domain (classic `/setdomain`).** Both Spectre apps share ONE Privy app (`cmmkl27iz00v80bjibo1q0ypl`) hence ONE bot token, but `app.spectreai.io` and `trade.spectreai.io` are different origins -> a single bot only covers one. To serve both: add the second domain via BotFather's newer multi-domain "Web Login" settings if available, else a SECOND bot wired as a separate Privy Client/environment. Bot: `@SpectreAIAuthBot` (id 8897609308).

**STATUS - trading Telegram is blocked by a CONFIRMED PRIVY BUG (2026-05-22).** We built the proper fix: a Privy **app-client** for trading (`client-WY6WuLcq6qWNBg9WEQLKk3u9ZbDtQgNAZ76hwuAssNNW5`) with a per-client **Telegram credentials override** = bot #2 `8690240856` ("Spectre AI - Auth Bot (Trade)", `/setdomain trade.spectreai.io`), `clientId` wired into `apps/trading/src/main.jsx` via `VITE_PRIVY_CLIENT_ID` (Vercel trading project), CSP all in place (script-src `auth.privy.io`+`telegram.org`, frame-src + connect-src `oauth.telegram.org`). **The bug:** Privy's `GET /api/v1/apps/{id}` applies the client's *allowed-origins* override but NOT the *telegram_auth_config* override - it keeps returning the app-level bot `8897609308` for the trading client, so trade.spectreai.io login uses bot #1 -> "Bot domain invalid". Reported to Privy; **Michael Essiet confirmed it's a legit bug and a fix is in a coming update.** ACTION when Privy pings it's shipped: just re-test - NO code change needed. Verify with `curl https://auth.privy.io/api/v1/apps/cmmkl27iz00v80bjibo1q0ypl -H 'privy-client-id: client-WY6WuLcq6qWNBg9WEQLKk3u9ZbDtQgNAZ76hwuAssNNW5'` -> `telegram_auth_config.bot_id` should flip from `8897609308` to `8690240856`, then trade.spectreai.io Telegram works. Research Telegram (bot #1, app.spectreai.io) already works. Per Gleb: do NOT hide the Telegram tile on trading meanwhile (accept the dead-end until Privy ships).

### D11. Login modal: use v1 `loginMethods` (flat), NOT v2 `loginMethodsAndOrder` - v2 breaks wallet login
**Both apps use v1 `loginMethods: ['email','google','twitter','telegram','wallet']` (flat array). Do NOT "upgrade" to v2 `loginMethodsAndOrder`.** This is the single most expensive lesson of 2026-05-20 (a full day lost to it).
- **Why**: v2's `{ primary, overflow }` split groups `wallet` into the overflow with the social methods. Privy then renders ONE overflow button ("Connect a wallet" when a wallet extension is detected, else "More options") whose click opens the overflow **socials** (Discord/Apple) - the wallet picker never surfaces. Variants all fail: `wallet`-only overflow renders NO button; `wallet` in `primary` renders no button; `wallet` + socials in overflow opens the socials. There is NO v2 config that surfaces the wallet picker.
- **v1 works**: a flat `loginMethods` array renders `wallet` as a real "Connect a wallet" entry that opens Privy's full **100+ wallet picker** (MetaMask, Phantom, Coinbase, Backpack, Solflare, OKX, Safe, Zerion, Rainbow, 1inch, WalletConnect, ...). Render order = array order: email field + Google/X/Telegram tiles + full-width "Connect a wallet".
- The trading `CLAUDE.md` warned about this: "v1 loginMethods - intentional, do not upgrade to v2 without testing Solana wallet flow." Commit 3821ee23 upgraded it anyway; that was the regression.
- **Wallet is AUTH only**: users sign in with MetaMask/Phantom, but trading still signs every swap/withdraw with the EMBEDDED Privy wallet (`useSwapExecution` filters `walletClientType === 'privy'`). This is the GMGN model - external wallets are not used to trade.
- **CRITICAL test caveat**: the wallet picker only renders when a wallet is DETECTED (extension present) OR via the explicit `walletList` entries under v1. A **headless / no-extension browser shows the social fallback** and makes wallet login look broken - it is NOT. ALWAYS verify modal/login changes in a real browser with a wallet extension; `npm run build` + headless chrome-devtools are NOT sufficient.
- Modal CSS (`index.css` `#privy-modal-content ...`) is heavily `:has()`-based: it tiles the social buttons and full-widths the last (`wallet`) button, renames it "Connect a wallet" via `::after`, and uses `padding-top: 44px` so the header clears the top edge. The research back-button rule MUST keep `:not(.login-method-button)` or it pins a social tile (Telegram) to the top-left corner.
- **Extension-gated "Connect a wallet" button**: both `privy-config.js` files run `flagInjectedWallet()` at module load - it adds `wallet-ext-present` to `<html>` when `window.ethereum` / `window.solana` / a Phantom-Solflare-Backpack-OKX global / an EIP-6963 announce is found. `index.css` hides the wallet login button (the last `login-method-button`) via `html:not(.wallet-ext-present) ... :last-of-type { display: none }` so users with no extension don't see a button leading to an empty picker. Fail-closed (no detection -> hidden). The button stays `:last-of-type` in the DOM while hidden, so Telegram remains `:not(:last-of-type)` and the tile/relabel rules are unaffected. Tradeoff: this also hides the WalletConnect QR path on extension-less desktops - acceptable since embedded-wallet login (email/Google/Telegram) is the primary path and external wallets are auth-only.
- **Returning "last used" layout breaks grid-based CSS** (fixed via `privy-modal-hacks.js` Hook 3 + `.spectre-modal-stacked`): Privy renders the social/wallet button container (`sc-dlfnOL`) as a multi-column `display:grid` for FRESH logins, but as a full-width `display:flex` column in the RETURNING "last used" layout (and a lone "Continue with Email" sits in a 1-item grid). The tile/wallet CSS is tuned for the grid, so in the flex layout the buttons render as giant full-width column tiles and the "Connect a wallet" `::after` relabel misfires onto the email button. **CSS cannot query computed `display`**, so the fix is a JS detector: Hook 3 tags any login-button container that is NOT a real multi-tile grid (`getComputedStyle(c).display==='grid'` + multi-col `gridTemplateColumns` + `>=2` direct `button.login-method-button`) with `.spectre-modal-stacked`; `index.css` then renders `.spectre-modal-stacked > button.login-method-button` as clean full-width rows with native labels (relabel suppressed) at 4x-id specificity. This is robust across Privy sub-states because it reads the rendered layout, not the markup. When debugging modal layout, dump BOTH fresh (incognito, no last-used) AND returning states - they have different DOM. The lesson: the `:has()`/`:last-of-type` CSS assumes ONE layout; Privy has several.
- Optional future enhancement (needs a WalletConnect Cloud `projectId` env var): always-visible MetaMask/Phantom tiles + the QR/mobile-wallet flow.

### D11.1 FINAL trading Sign-In modal layout (2026-05-21) - DO NOT re-fight

This took **hours** of console-DOM-dump iteration (commits `97b862bf` → `087b900c`). The end state is approved. Before touching `apps/trading/src/index.css` Privy-modal rules, read this. All rules live in the `#privy-modal-content ...` blocks (~L1670-2700).

**Approved layout - RETURNING "last used" state (the hard one):**
```
[ logo ]  Sign in to Spectre AI  /  subtitle
[ your@email.com .......................... Submit ]   <- email INPUT, full-width row
[  MetaMask   ] [   Google   ] [ Other Socials ]       <- 3 EQUAL 92px tiles, one grid row
   "Last used" corner pill, chain badge hidden
[  Connect a wallet ...................... ]           <- full-width row (only if wallet-ext)
```
Fresh state: email input + `[Google][Twitter][Telegram]` 3-tile grid + Connect-a-wallet. "Other socials" overflow → **X + Telegram** (2 tiles).

**THE root-cause bug (cost the most time): tile MARGIN, not height/stretch/padding.**
Privy + "Block A" put `margin: 4px 0 20px` on the **last-used tile** (a `button:not(.login-method-button)`); the social tiles have none. The `margin-top:4px` pushed MetaMask down (the endless "still a bit lower"); the `margin-bottom:20px` was the unexplained **+24px grid-row inflation**. Fix = `margin: 0 !important` on the row-2 tiles. **When a Privy tile is misaligned, CHECK COMPUTED MARGIN FIRST** - it's invisible in screenshots and not in most dumps.

**Key facts & the rules that enforce them (all 4x-`#id` to beat "Block A"):**
- The "last used" method is a `button:not(.login-method-button)` - a DIFFERENT element than the social `login-method-button` tiles. Style it explicitly; the social-tile rules never touch it.
- **"Block A"** = the Select-network row styler (`button:not(.login-method-button)...`, 3x-`#id`) ALSO matches the last-used tile and leaks `padding:14px 24px` + `margin:4px 0 20px` onto it. Win with **4x-`#id`**.
- Row-2 tiles pinned to **fixed `height: 92px`** (4x-id) - grid `align-self:stretch`/`height:100%` would NOT stretch the last-used tile; fixed height is the only thing that held.
- Last-used tile internals: icon `> div:first-child` 28px + `display:flex;align-items:center;line-height:0` (fox baseline-dropped otherwise); name `> span:nth-of-type(1)` capped `max-height:18px` (renders 32px raw); "Last used" `> span:nth-of-type(2)` = absolute corner pill; chain/network badge = `> span:has(svg)` → `display:none`.
- "Continue with Email" redundant tile → hidden (email input already shows it). Hook 3 must NOT tag single-button containers `.spectre-modal-stacked` or it un-hides it.
- "Other socials" → **"Other Socials"** via `text-transform: capitalize` on social tiles `:not(:last-of-type)`.
- Overflow expanded (X + Telegram): fixed `76px` height, icons normalized 28px (div/img/svg), labels via `::after` `content:"X"`/`"Telegram"` (were hardcoded `"Discord"/"Apple"` from an old config - fix if the social set changes).
- Wallet-picker search "grey box" (research only): its container had `background: var(--bg-overlay)` = grey `#1a1a1d` on research vs `#0c0c0e` on trading → set `transparent`.

**Debugging method that finally worked:** Gleb ran console scripts dumping each tile's `topInTile` / `height` / `gridRow` / **margin** / `align-self`. Headless/chrome-devtools CANNOT reproduce the returning state (needs prior wallet login + a real extension). Trust the user's screenshots + dumps over headless. Research's returning view is a **stacked list** (different container path), not this 3-tile grid - they intentionally diverge.

- Optional future enhancement (needs a WalletConnect Cloud `projectId` env var): see above.

### D12.1 custom_api_url = UNCONDITIONAL server-cookie sessions -> prod App ID CANNOT auth on localhost (2026-07-06, SDK-verified)
`js-sdk-core` `PrivyInternal._initialize()`: `config?.custom_api_url && (this.baseUrl = custom_api_url, this.session.isUsingServerCookies = true)` - the custom domain ITSELF flips the SDK into server-cookie mode. Tokens then exist ONLY as HttpOnly cookies on the custom domain (`privy.spectreai.io`), never in localStorage or response bodies. From `localhost` those cookies are cross-site -> dropped -> login "succeeds" (user object present, `authenticated: true`) but `getAccessToken()` is null forever, sessions die on every reload, `sessions/logout` 400s (no cookie to destroy) and leaves the SDK jammed ("Attempted to log in, but user is already logged in"). NO code override exists. Symptom signature: `privy:connections`/`privy:caid` in localStorage but NO `privy:token`/`privy:refresh_token` after a successful login. **The ONLY fix is the separate development App ID (no custom domain) wired via env for localhost/previews.** Cost: one full evening (2026-07-06) diagnosing "Failed to connect to wallet" on the first live swap attempt.

### D12. Cross-subdomain SSO = first-party COOKIE, not localStorage (2026-05-22)
Login on `app.spectreai.io` does NOT carry to `trade.spectreai.io` by default - Privy stores the session in **localStorage (origin-scoped)**, so the two subdomains share nothing. **Same `appId` + same `.spectreai.io` parent is NOT enough** (the old "auth.privy.io third-party session carries it" claim is false - modern browser third-party-storage partitioning + Safari ITP block it).
**Fix = Privy HttpOnly first-party cookies, cookie domain `spectreai.io`** (Dashboard -> App settings -> Domains; add the DNS record, verify; enable cookies on BOTH the default client and the trading app-client). Privy then sets the access-token cookie on `spectreai.io` + subdomains and the SDK restores the session on a fresh subdomain load -> SSO across both apps AND the same-site `/token` iframe (fixes Safari too). **No PrivyProvider/SDK code change.**
**Constraint:** verifying the cookie domain LOCKS that App ID to `spectreai.io` + subdomains -> it stops working on `localhost` and `*.vercel.app`. So dev/preview need a SEPARATE **development App ID**; wire `VITE_PRIVY_APP_ID` + `PRIVY_APP_ID` per environment (prod App ID in prod, dev App ID locally + previews). `api/_lib/auth.js` (both apps) reads the `privy-token` cookie as a fallback to the Bearer header. Docs: https://docs.privy.io/guide/react/configuration/cookies . Full runbook: `C:\Users\worka\.claude\plans\in-privy-folder-you-tranquil-honey.md` (top section).

---

## E. Decision matrix

### Embedded vs external wallet
| Use embedded when | Use external when |
|-------------------|-------------------|
| User has no crypto yet (default flow) | User already has crypto in Phantom / MetaMask |
| Want frictionless signing (no extension prompts) | User wants self-custody outside Privy |
| Want to sign txs from server (with delegation) | User wants hardware wallet (Ledger via WalletConnect) |

Spectre default: embedded wallets on login for users without external wallet (`createOnLogin: 'users-without-wallets'`).

### Client-side vs server-side signing
| Client-side when | Server-side when |
|------------------|------------------|
| User initiates the action (swap, send) | Bot / agent / scheduled task initiates |
| User can approve in a modal | No human to approve |
| Standard signing flow | Need delegation, policies, or programmable rules |

Spectre default: client-side only. If we add a copy-trading bot or auto-execute alerts, we'd need server signing via delegation - see [10-wallet-controls-and-authorization.md](../knowledge/privy/10-wallet-controls-and-authorization.md).

### Jupiter vs 0x vs Bebop vs Privy built-in
| Aggregator | When |
|-----------|------|
| Jupiter | Solana - we use it (best Solana coverage) |
| 0x v2 with Permit2 | EVM - we use it (good size + affiliate fees) |
| Bebop | EVM RFQ for large size - we don't use, could add (audit P3) |
| Privy built-in `useSwap` | If we wanted Privy to handle quote routing - we don't use |

See [06-swaps-and-trading.md](../knowledge/privy/06-swaps-and-trading.md).

### When to add `idempotencyKey`
ALWAYS, for any user-triggered transaction signing. Without it, flaky network retry can submit the same swap twice. Spectre does NOT do this today - `audit-gaps.md` #1.

### When to add server SDK token verification
Any Vercel function or Express route that:
- Reads or writes user-specific data (profile, watchlist, settings)
- Triggers a server action attributed to the user (referral, alerts)
- Logs user-identifiable events

Spectre has this for `/api/user/*`, `/api/swap`, `/api/referral` via `_lib/auth.js`. Public routes (`/api/fee-config`, `/api/codex`, `/api/img-proxy`) do NOT need auth.

---

## F. Self-checks before touching Privy code

1. **Is the file in my paths frontmatter?** If so, this rules file is loaded. Don't re-discover its content.
2. **Will the hook be called before hydration?** If yes, defer to child component (D1).
3. **Am I using `getAccessToken` in a render or effect deps?** If yes, useRef (D2).
4. **Does this action need to retry on network failure?** If yes, add `idempotencyKey`.
5. **Am I adding a server route that takes a DID?** If yes, wrap with `_lib/auth.js` verification.
6. **Will this run on Vercel preview deployments?** If yes, check OAuth redirects / allowed domains in dashboard.
7. **Am I editing `privy-config.js` in one app?** If yes, check the other app for drift (D4).
8. **Am I editing `vercel.json` CSP?** If yes, verify `frame-src https://auth.privy.io` and `connect-src https://api.privy.io https://auth.privy.io` are preserved (D10).
9. **Did I touch the modal styling?** If yes, see if a DOM hack can be replaced with `appearance` config (D5).
10. **Are there matching test files?** If yes, update them. (We don't currently have Privy-related tests - might be worth adding.)

---

## G. Common error -> fix

| Error / symptom | Likely cause | Fix |
|-----------------|--------------|-----|
| `Wallet proxy not initialized` | Origin not allowlisted in dashboard | Add domain to [allowed domains](https://dashboard.privy.io/apps?setting=domains&page=settings) |
| Modal renders blank | CSP `frame-src` missing | Add `https://auth.privy.io` to CSP |
| OAuth fails: "Redirect URI mismatch" | Preview URL not in allowed redirects | Use email-only on previews, or add wildcards |
| `Buffer is not defined` on Solana code | Missing polyfill | First import: `import { Buffer } from 'buffer'; window.Buffer = Buffer` |
| Phantom button absent (trading) | Missing `toSolanaWalletConnectors` | Add to `externalWallets.solana.connectors` |
| Infinite re-renders after touching auth | `getAccessToken` in deps array | useRef wrapper (D2) |
| Hook crashes on mount | Called before `ready === true` | Defer to child component (D1) |
| Swap submits twice on flaky network | No idempotency key | Add `idempotencyKey: crypto.randomUUID()` |
| User logs in on research, must log in again on trading | localStorage is origin-scoped; no shared cookie | Enable Privy HttpOnly first-party cookie on `spectreai.io` (D12); dev needs its own App ID |
| Embedded wallet works on localhost, fails on Vercel preview | HTTP vs HTTPS | Verify deployment is HTTPS (it should be) |

Full error tables in [14-errors-and-troubleshooting.md](../knowledge/privy/14-errors-and-troubleshooting.md).

---

## H. Don'ts

- **Don't** put `useWallets()` at the top of `App.jsx` - it crashes before hydration
- **Don't** put `getAccessToken` in `useEffect` deps - it loops forever
- **Don't** call `connection.getBalance()` from frontend for Solana display - CORS issues, use `/api/solana-balance` proxy
- **Don't** create a new `JsonRpcProvider` per call - cache in a Map<chainId, Provider>
- **Don't** add wallet IDs not in Privy's `WalletListEntry` TS union - Privy silently drops them
- **Don't** assume `wallets` array is populated on first render - it's async, guard against empty
- **Don't** expose `PRIVY_APP_SECRET` to the client - it's server-only; leak grants admin
- **Don't** edit one app's `privy-config.js` without checking the other for drift
- **Don't** edit CSP without re-confirming the modal still loads
- **Don't** disable StrictMode in research (trading disables in dev only for EventSource reasons)
- **Don't** import `posthog-js` directly in Privy-touching code - use `@/services/analytics` wrapper (research) or `services/analytics.js` (trading)

---

## I. When to update this file

- New Privy hook used somewhere in the codebase (add to cheat sheet)
- New gotcha discovered after a debug session (add to section D)
- SDK major version bump (move old gotchas to migrations KB file, add new ones)
- New canonical pattern validated in code (add to spectre/patterns.md, link here)
- A `paths:` glob in frontmatter no longer captures relevant files (add globs)
- Audit gap closed (remove from `audit-gaps.md`, update section C if state changed)
