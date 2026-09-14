---
description: Privy errors & troubleshooting reference (API error codes, client error codes, embedded wallet issues, CSP / OAuth / preview pitfalls, utility helpers). Synthesized from official docs.
---

# Privy Errors & Troubleshooting

## Source docs synthesized

- `api-errors.md` (245 lines) - API error codes returned by the Privy backend
- `client-errors.md` (122 lines) - SDK errors surfaced to client code
- `errors.md` / `errors (1).md` / `errors (2).md` - SDK error references
- `troubleshooting-embedded-wallets.md` (28 lines) - embedded-wallet specific issues
- `utility-functions.md` (805 lines) - signing utility functions + `getEmbeddedConnectedWallet` etc.
- `Common Use Cases.md`, `Features.md`, `Setup.md` and the `setup (1).md` - `setup (7).md` variants

---

## Error categories

| Category | Where it surfaces | Owning doc |
|----------|-------------------|------------|
| Auth errors | Client SDK (login modal, hooks), Privy backend | `client-errors.md` |
| Wallet errors | Embedded wallet bridge iframe + SDK | `troubleshooting-embedded-wallets.md` |
| RPC / transaction errors | Privy API `/wallets/.../rpc` endpoint | `api-errors.md` |
| Authorization signature errors | Privy API (requires `privy-authorization-signature`) | `api-errors.md` |
| Network / CSP / iframe errors | Browser console, NOT a Privy-controlled error string | inferred from `Content Security Policies.md` |
| OAuth errors | Redirect roundtrip | `oauth.md`, `allowed-oauth-redirects.md` |

---

## API error codes (table)

These are returned by the Privy API when calling `/v1/wallets/.../rpc`, policy endpoints, etc.

| Code | Description | Typical cause | Remedy |
|------|-------------|---------------|--------|
| `policy_violation` | RPC request denied due to policy | Tx exceeds spending limit, recipient not in allowlist, restricted Solana instruction | Review policy in dashboard or via `Get Policy` API; adjust either policy or tx |
| `insufficient_funds` | Wallet has insufficient funds | Native token balance too low for value + gas; or gas-sponsorship credits depleted | Fund wallet; check `Gas Sponsorship` page; enable automated refill |
| `transaction_broadcast_failure` | Tx failed to broadcast to chain | Malformed params, RPC node down, nonce conflict | Tx was NOT broadcast - safe to retry; check Privy status page and chain explorer |
| `missing_or_empty_authorization_header` | Missing `privy-authorization-signature` header | Endpoint requires auth sig, but header absent or empty; or server SDK missing `AuthorizationContext` | Sign request per [authorization signatures spec](https://docs.privy.io/controls/authorization-keys/using-owners/sign/overview) or configure `AuthorizationContext` |
| `zero_correct_authorization_signatures` | Sigs provided but none valid | Wrong payload signed, malformed sig, wrong signing key | Verify payload bytes match canonical form; verify signing key has permission |
| `insufficient_correct_authorization_signatures` | Some valid sigs but fewer than threshold | Wallet quorum needs M-of-N but you sent <M | Collect signatures from all required signers |
| `incorrect_quantity_of_authorization_signatures` | Sig count != threshold | Too few sigs, or improperly concatenated multi-sig header | Match count exactly; comma-separate sigs in header |
| `request_expired` | `privy-request-expiry` is past or invalid | Header timestamp older than now, or malformed | Use future Unix timestamp in MILLISECONDS (e.g. `1773679531000`); add buffer for latency |
| `no_valid_user_session_keys` | No valid user signing keys | `/wallets/authenticate` never completed; user JWT invalid/expired | Request a fresh user signing key; validate JWT |
| `user_session_keys_expired` | User signing key has expired | Key past validity window; cached stale key | Request fresh session key; use server SDK `AuthorizationContext` for automatic refresh |

---

## Client-side error codes (table)

These are SDK-surfaced errors visible in browser console / hook callbacks.

| Code | Description | Typical cause | Remedy |
|------|-------------|---------------|--------|
| `invalid_native_app_id` | Invalid / missing native app identifier (mobile) | Wrong client ID, native app ID not configured, Expo Go without `host.exp.Exponent` allowlisted, web client sending `privy-native-app-id` header by accident | Verify client ID; add `host.exp.Exponent` for Expo Go |
| `invalid_origin` | Origin not allowlisted | Using `appClient` overriding origins; origin not in dashboard; request from un-allowlisted iframe parent | Add ALL origins (including parent for iframes) at [dashboard domains settings](https://dashboard.privy.io/apps?setting=domains&page=settings) |
| `linked_to_another_user` | Conflict between current user and existing user | User signed up with Google/Apple OAuth on email, then tried passwordless email login; updating linked account to one already taken; duplicate linked accounts during import | Enable login method transfer; have user use the originally linked method |
| `failed_to_fetch_jwks_uri_document` | Privy can't fetch your JWKS endpoint when configuring JWT auth | Cloudflare or firewall blocking external access; endpoint not public; malformed JWKS structure | Allowlist Privy IPs; verify JWKS JSON has `kty`, `n`, `e`, `alg`, `kid`, `use` fields |
| `Wallet proxy not initialized` | Privy couldn't init the wallet iframe bridge | Origin not allowlisted; app didn't wait for `ready`; reading wallet before `useWallets()` ready flag | Allowlist origin; wait for both `usePrivy().ready` AND `useWallets().ready` |

### JWKS reference structure (from client-errors.md)

```json
{
  "keys": [
    {
      "kty": "RSA",
      "n": "your-n-value",
      "e": "AQAB",
      "alg": "RS256",
      "kid": "your-key-id",
      "use": "sig"
    }
  ]
}
```

---

## Common embedded wallet issues

From `troubleshooting-embedded-wallets.md`.

### Wallets work on localhost, NOT on deployed environment

**Cause**: deployment is served over `http://` not `https://`. Privy embedded wallets use the browser's WebCrypto API which is only available in secure contexts. `localhost` is a special-cased secure context.

**Fix**: serve over HTTPS. There is no workaround; this is a browser security guarantee.

### "Access to the Base RPC URL has been blocked by CORS"

**Cause**: typically a rate-limit (HTTP 429) from the public RPC (Blast), surfacing as a CORS error because the 429 response lacks CORS headers.

**Fix**: wait, then retry. If persistent, switch to a paid RPC (Helius, QuickNode, Alchemy) and set your own URL in the chain config / `solanaClusters[].rpcUrl`.

---

## CSP / iframe troubleshooting

Privy renders its login modal and embedded wallet signer in an iframe loaded from `https://auth.privy.io`. CSP `frame-src` MUST allow this origin.

### Symptoms

| Symptom | Console hint | Fix |
|---------|--------------|-----|
| Modal renders blank or flashes empty | `Refused to frame 'https://auth.privy.io' because it violates the following Content Security Policy directive: "frame-src ..."` | Add `https://auth.privy.io` to `frame-src` |
| `Refused to connect` to Privy API | `connect-src` violation | Add `https://api.privy.io` and `https://auth.privy.io` to `connect-src` |
| Modal works in Chrome but not Safari | Safari ITP blocks third-party storage in iframe | Verify allowed domains; serve over HTTPS; consider `same-site` cookie config |
| Modal flickers and re-mounts repeatedly | Firefox ETP `dFPI` partitions storage | Same remedies as Safari ITP |
| Inline event listener blocked | `unsafe-inline` not in `script-src` | EITHER add `'unsafe-inline'` (Spectre trading approach) OR add SHA-256 hashes for required scripts (Spectre research approach) |

### Spectre CSP reference

From `apps/research/vercel.json` (uses SHA-256 hashes - stricter):

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-...' https://auth.privy.io; frame-src https://auth.privy.io; connect-src 'self' https://api.privy.io https://auth.privy.io ...
```

From `apps/trading/vercel.json` (uses `'unsafe-inline'` - weaker, audit-gaps #15):

```
script-src 'self' 'unsafe-inline' https://auth.privy.io; ...
```

---

## OAuth troubleshooting

### "Redirect URI mismatch"

**Cause**: the redirect URI in the OAuth roundtrip doesn't EXACTLY match an entry in the dashboard. Trailing slash, port, and protocol all matter.

**Fix**: in [allowed OAuth redirects settings](https://dashboard.privy.io/apps?setting=domains&page=settings), add every URI variant:
- `https://spectre-app-research.vercel.app/`
- `https://spectre-trading.vercel.app/`
- `http://localhost:5180/`
- `http://localhost:5181/`
- All Vercel preview URLs (these change per PR - either wildcard if supported, or accept that previews don't OAuth)

### "Invalid client"

**Cause**: OAuth provider's client ID or secret in Privy dashboard is wrong.

**Fix**: re-create the OAuth client on the provider side (Google Cloud Console, X Developer Portal, Apple Developer, Discord), copy ID + secret into Privy dashboard exactly.

### OAuth works in prod but not in Vercel previews

**Cause**: preview URLs are not in the allowed-redirects list, and they change per deployment.

**Fix**: either accept that previews can't OAuth (most teams do), or use a custom preview domain that's stable enough to allowlist.

---

## Utility functions

From `utility-functions.md`. Privy ships helpers for signing requests OUTSIDE of the standard SDK flow (for KMS / cold-storage / custom signing services).

### `getEmbeddedConnectedWallet(wallets)`

Filter `useWallets()` output to find the embedded Privy wallet. Equivalent to:

```js
const embedded = wallets.find(w => w.walletClientType === 'privy');
```

Spectre uses the inline filter, not the utility - same effect.

### `formatRequestForAuthorizationSignature(input)` (server SDK)

Canonicalizes a Privy API request payload into bytes for an external signing service.

```ts
import { formatRequestForAuthorizationSignature } from '@privy-io/node';

const serializedPayload = formatRequestForAuthorizationSignature({
  version: 1,
  url: 'https://api.privy.io/v1/wallets/<wallet-id>/rpc',
  method: 'POST',
  headers: { 'privy-app-id': '<app-id>' },
  body: { method: 'personal_sign', params: { message: 'Hello', encoding: 'utf-8' } }
});

const payloadBase64 = Buffer.from(serializedPayload).toString('base64');
```

### `generateAuthorizationSignature({ input, authorizationPrivateKey })` (server SDK)

Directly signs a payload with a base64 P-256 private key. Use inside an isolated signing service.

```ts
import { generateAuthorizationSignature } from '@privy-io/node';

const signature = generateAuthorizationSignature({
  input,
  authorizationPrivateKey: 'insert-private-key'
});
```

### `useAuthorizationSignature()` (React SDK)

Client-side signing with the authenticated user's session key.

```tsx
import { useAuthorizationSignature } from '@privy-io/react-auth';

const { generateAuthorizationSignature } = useAuthorizationSignature();
const { signature } = await generateAuthorizationSignature(payloadBytes); // or structured payload
```

### Signature payload schema

| Field | Type | Notes |
|-------|------|-------|
| `version` | `1` | Currently the only version |
| `method` | `'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'` | GET requests don't need signing |
| `url` | `string` | Full URL, NO trailing slash |
| `body` | JSON | Canonicalized via RFC 8785 before signing |
| `headers` | JSON | ONLY `privy-*` prefixed headers; NEVER `Content-Type`, auth headers, or trace headers |
| `headers['privy-app-id']` | string | Required |
| `headers['privy-idempotency-key']` | string | Optional; omit field if not sending header |
| `headers['privy-request-expiry']` | string | Optional; omit field if not sending header |

### `getAccessToken()` (React SDK) - reference behavior

```ts
const { getAccessToken } = usePrivy();
const token = await getAccessToken(); // Promise<string | null>
```

**CRITICAL**: the function reference returned by `usePrivy()` changes on every render. Putting it in a `useEffect` deps array or storing in state causes infinite re-renders. ALWAYS wrap in `useRef`:

```ts
const { getAccessToken } = usePrivy();
const tokenRef = useRef(getAccessToken);
useEffect(() => { tokenRef.current = getAccessToken; }, [getAccessToken]);

// later, in handlers / mutations:
const token = await tokenRef.current();
```

Spectre uses this pattern in `apps/trading/src/components/UserDashboard/index.jsx` and equivalents - see `spectre/patterns.md` Pattern 3.

---

## Common use cases

From `Common Use Cases.md`, summarized:

1. **Onboard non-crypto users** - email + embedded wallet creation on login (Spectre default)
2. **Multi-chain user wallet** - one user, separate ETH + SOL embedded wallets (Spectre default)
3. **External wallet connect** - Phantom / MetaMask / Backpack alongside email login
4. **Recurring payments / subscriptions** - server-controlled wallet + policies
5. **Agent / bot wallets** - delegation + server signing
6. **Treasury / business** - quorum approval, multi-party control
7. **Recovery** - MFA enrollment (passkey, TOTP)

---

## Setup checklist (consolidated)

Sourced from `Setup.md` and the `setup (1).md` - `setup (7).md` variants.

### Environment variables

| Var | Where | Required |
|-----|-------|----------|
| `VITE_PRIVY_APP_ID` (or `NEXT_PUBLIC_PRIVY_APP_ID` etc.) | Client app | Yes - Privy SDK fails without it |
| `PRIVY_APP_ID` | Server (Vercel functions / Express) | Yes if using server SDK |
| `PRIVY_APP_SECRET` | Server ONLY | Yes if using server SDK |
| `PRIVY_VERIFICATION_KEY` (alternative) | Server | If using JWT verification without app secret |

### Privy dashboard configuration

1. **Login methods**: enable email, OAuth providers, passkey, etc. in dashboard
2. **Allowed domains**: add every origin (dev localhost, prod, preview URLs) - see `11-security-and-webhooks.md`
3. **Allowed OAuth redirects**: add EXACT redirect URIs (trailing slash matters)
4. **Embedded wallets**: enable Ethereum and/or Solana per app
5. **OAuth clients**: configure Google / Apple / Twitter / Discord client IDs + secrets
6. **JWT settings** (if you verify Privy JWT on your server): nothing to configure - public JWKS is at `https://auth.privy.io/.well-known/jwks.json`

### Provider config minimum viable (React)

```tsx
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';

<PrivyProvider
  appId={import.meta.env.VITE_PRIVY_APP_ID}
  config={{
    loginMethodsAndOrder: {
      primary: ['email', 'google', 'twitter'],
      overflow: ['discord', 'apple', 'wallet']
    },
    embeddedWallets: {
      ethereum: { createOnLogin: 'users-without-wallets' },
      solana: { createOnLogin: 'users-without-wallets' }
    },
    externalWallets: {
      solana: { connectors: toSolanaWalletConnectors({ shouldAutoConnect: false }) }
    },
    appearance: {
      theme: 'dark',
      accentColor: '#hex',
      walletChainType: 'ethereum-and-solana'
    }
  }}
>
  {children}
</PrivyProvider>
```

### First-render expectations

- `ready` starts `false`, becomes `true` after hydration
- `authenticated` starts `false`
- `user` is `null` until `authenticated` is `true`
- `wallets` from `useWallets()` is `[]` until `ready` on both `usePrivy` AND `useWallets`
- DO NOT call `useWallets`, `useFundWallet`, etc. before `ready` - they crash

---

## Spectre-specific common errors & fixes

### `useFundWallet is not a function` / hooks throw before mount

**Cause**: hook called from a component that mounts before Privy hydrates.

**Fix**: defer to a child component mounted after `ready === true`. See `spectre/patterns.md` Pattern 2.

### Email tile is below the fold in the login modal

**Cause**: the Privy modal puts wallet list above email when the wallet list is long. Both Spectre apps DOM-hack auto-click "Continue with Email" or scroll wallet list (see `apps/research/src/main.jsx` and `apps/trading/src/main.jsx`).

**Better fix** (audit-gaps #11): set `appearance.showWalletLoginFirst: false` and curate `appearance.walletList` to put detected wallets last.

### `getAccessToken` triggers infinite re-renders

**Cause**: function reference from `usePrivy()` changes every render; placing in `useEffect` deps loops forever.

**Fix**: store in `useRef`, refresh via `useEffect`. See utility-functions section above and `spectre/patterns.md` Pattern 3.

### Solana wallet missing from `useWallets()`

**Cause**: provider config missing `walletChainType: 'ethereum-and-solana'` OR missing `embeddedWallets.solana.createOnLogin`.

**Spectre status**: both apps configured correctly - this is not a current bug.

### Phantom / Solflare buttons absent (TRADING app only)

**Cause**: trading's `privy-config.js` does NOT import `toSolanaWalletConnectors`. Research does.

**Fix**: add the import + connector to trading's provider config. See `audit-gaps.md` #5.

### Login modal doesn't open on Vercel preview deployments

**Cause**: preview URL is not in allowed domains. Privy SDK throws `invalid_origin`.

**Workaround**: previews skip OAuth (use email-only on previews); production has stable allowlisted domain.

### Swap fails with "user rejected" RIGHT AFTER user confirmed

**Cause**: the modal showed twice and the user only confirmed once. Often happens on flaky network where the SDK retries the sign request without idempotency.

**Fix** (audit-gaps #1): pass `idempotencyKey: crypto.randomUUID()` per swap attempt to `useSendTransaction`. The retry then dedupes server-side.

### Slippage 0% accepted by UI but quote always fails

**Cause**: aggregators (Jupiter, 0x) reject 0 bps slippage for non-stable pairs.

**Fix in Spectre**: we already clamp 1-500 bps in `useSwapExecution.js`. See `spectre/patterns.md` Pattern 12.

### Embedded wallet exists on localhost but NOT on Vercel preview

**Cause**: Vercel preview is served over HTTPS (good) - but you allowed the preview origin recently and Privy may not have caught up. Wait 1-2 min and retry.

---

## Debugging tips

### Enable Privy debug logs

```js
localStorage.setItem('privy:debug', 'true');
// reload
```

(Verify the exact key name on current SDK version - may be `debug:privy` in some versions. Check via DevTools Application > Local Storage on a known-working app.)

### Inspect the modal iframe

DevTools > Application > Frames. The Privy modal frame is hosted at `https://auth.privy.io`. If it's missing or replaced with `about:blank`, CSP is blocking it.

### Decode an access token

Paste at [jwt.io](https://jwt.io). Verify:
- `iss` = `privy.io`
- `aud` = your appId
- `exp` is in the future
- `sub` is the user's DID (`did:privy:...`)

### Server SDK errors in Vercel functions

`vercel logs --since 5m <project>` or in Vercel dashboard. Search for `@privy-io/node` errors. Common: appId/appSecret mismatch (returns 401 from JWT verify).

### Local Express server errors

`packages/server/` does NOT currently use Privy server SDK. If you add it, check `npm run dev:server` console for `Invalid app credentials` (wrong env) or `Cannot verify token` (token from different app).

### Check what login method a user used

```js
const { user } = usePrivy();
const method = user?.linkedAccounts?.find(a => a.type === user?.linkedAccounts?.[0]?.type)?.type;
// or inspect user.email, user.google, user.twitter, user.wallet directly
```

Spectre wraps this in `getPrivyDisplayInfo(user)` - see `spectre/patterns.md` Pattern 8.

---

## Cross-references

- Auth flow + token verification - see `01-auth-and-identity.md`, `08-server-sdk.md`
- Modal CSS / DOM customization - see `09-ui-and-customization.md`
- CSP + allowed domains setup - see `11-security-and-webhooks.md`
- Wallet creation policies (createOnLogin) - see `02-embedded-wallets.md`
- Transaction signing flow (where most runtime errors surface) - see `05-transactions-and-signing.md`
- Spectre patterns (useRef hack, deferred hooks, AuthGate) - see `spectre/patterns.md`
- Spectre's open audit items - see `spectre/audit-gaps.md`
