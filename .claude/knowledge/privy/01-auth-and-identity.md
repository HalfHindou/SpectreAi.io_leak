---
description: Privy authentication & identity reference (login methods, sessions, MFA, OAuth, tokens, logout). Synthesized from official Privy docs.
---

# Privy Auth & Identity

## Source docs synthesized

All paths under `C:\Users\worka\OneDrive\Desktop\Privy\`.

- `authentication.md` (~20 lines) - JWT-based auth provider configuration
- `authentication-state.md` + `authentication-state (1).md` (~455 lines each, dedup) - auth state machine across React / RN / Swift / Kotlin / Unity / Flutter
- `tokens.md` + `tokens (1).md` (~253 lines, dedup) - access / refresh / identity token reference
- `access-tokens.md` + `access-tokens (1).md` (~671 lines, dedup) - access token sending + server verification
- `User Auth.md` (~58 lines) - high-level token architecture
- `User Auth Keys.md` (~56 lines) - user authorization keys (TEE-issued)
- `privy-auth.md` (~23 lines) - inventory of native login methods
- `email.md` (~640 lines) - `useLoginWithEmail` (OTP)
- `sms.md` (~270 lines) - SMS MFA enrollment (note - file is actually MFA enrollment)
- `sms (1).md` (~152 lines) - SMS MFA verification
- `sms-whatsapp.md` (~588 lines) - SMS / WhatsApp login (`useLoginWithSms`)
- `oauth.md` + `oauth (1).md` (~724 lines each, dedup) - `useLoginWithOAuth` (Google, Apple, Twitter, etc.)
- `custom-oauth.md` + `custom-oauth (1).md` (~265 lines each, dedup) - custom OAuth 2.0 providers
- `wallet.md` + `wallet (1).md` (~1664 lines each, dedup) - SIWE / SIWS external wallet login
- `passkey.md` (~1397 lines) - `useLoginWithPasskey` + `useSignupWithPasskey`
- `passkeys.md` (~222 lines) - passkey MFA enrollment
- `passkeys (1).md` (~128 lines) - passkey MFA verification
- `totp.md` (~123 lines) - TOTP MFA verification
- `unenroll.md` + `unenroll (1).md` (~242 lines, dedup) - un-enrolling MFA factors
- `logout.md` + `logout (1).md` (~225 lines, dedup) - `useLogout`
- `captcha.md` (~67 lines) - login-time CAPTCHA (hCaptcha + Turnstile)
- `sso.md` (~196 lines) - dashboard SSO (SAML 2.0)
- `farcaster.md` (~262 lines) - `useLoginWithFarcaster`
- `telegram.md` (~155 lines) - `useLoginWithTelegram`

---

## Core concepts

### Auth model

Privy's user identity is a single canonical record (the **user object**) that survives across login methods. Whether a user first signs in with email, then later links Google and a Phantom wallet, they remain one user with one DID.

Key primitives:

- **DID** - the user's permanent ID (`user.id`, claim `sub` in JWTs). Format like `did:privy:abc123...`. Use this on your backend to identify the user. Never the email or wallet address.
- **Linked accounts** - `user.linkedAccounts` is the array of every identity attached to the user. Each entry has a `type` discriminator (`'email'`, `'google_oauth'`, `'twitter_oauth'`, `'apple_oauth'`, `'discord_oauth'`, `'github_oauth'`, `'linkedin_oauth'`, `'spotify_oauth'`, `'instagram_oauth'`, `'tiktok_oauth'`, `'phone'`, `'farcaster'`, `'telegram'`, `'wallet'`, `'passkey'`, `'custom_auth'`, `'custom:<provider>'`).
- **Embedded wallet** - on first successful login Privy can auto-provision a non-custodial wallet (ETH + Solana). The wallet itself shows up as a `WalletAccount` in `linkedAccounts`. See `02-embedded-wallets.md` for details.

Privy does NOT support passwords:

> We do not support regular password-based verification given users' tendencies to use and reuse easy-to-guess passwords, and the high incidence of password database breaches.
> from `User Auth.md`

### Auth state machine

The React SDK exposes a 3-field state from `usePrivy()`:

```ts
// from authentication-state.md
{
  ready: boolean;       // Has the SDK finished hydrating from storage?
  authenticated: boolean; // Is a user currently logged in?
  user: User | null;    // The user object (null when !authenticated)
}
```

Lifecycle:

```
1. SDK mounts          -> ready=false, authenticated=false, user=null
2. SDK hydrates        -> ready=true, then either:
   a. authenticated=true, user=User  (cached session valid)
   b. authenticated=false, user=null (no session or expired)
3. Login succeeds      -> authenticated=true, user=User
4. Token refresh fails -> authenticated=false, user=null (auto-logout)
5. logout() called     -> authenticated=false, user=null
```

The canonical gate is:

```tsx
// from authentication-state.md
const { ready, authenticated, user } = usePrivy();
if (!ready) return null;                  // never render anything until ready
if (ready && !authenticated) router.push("/login");
if (ready && authenticated) return <p>User {user?.id} is logged in.</p>;
```

Other SDKs use an enum / sealed-class `AuthState` instead of two booleans:

```swift
// from authentication-state.md
public enum AuthState {
  case notReady
  case unauthenticated
  case authenticatedUnverified(AuthenticatedUnverifiedContext)  // offline cache
  case authenticated(PrivyUser)
}
```

Note Swift / Android / Flutter add an `authenticatedUnverified` state for offline boot - the SDK has cached tokens but cannot reach the network to validate them. There is no equivalent in the React SDK.

### Login methods inventory

| Method | React hook | RN hook | Native (Swift/Kotlin/Flutter) | Notes |
|--------|-----------|---------|-------------------------------|-------|
| Email OTP | `useLoginWithEmail` | `useLoginWithEmail` | `privy.email` | 6-digit code, mailchecker blocks throwaways |
| SMS OTP | `useLoginWithSms` | `useLoginWithSMS` | `privy.sms` | E.164 format, `intl.defaultCountry` config |
| WhatsApp OTP | `useLoginWithSms` | n/a | n/a | Either SMS or WhatsApp, not both; provider locked once set |
| Google OAuth | `useLoginWithOAuth({provider:'google'})` | same | `privy.oAuth.login(.google)` | Doesn't work in social app in-app browsers |
| Apple OAuth | `useLoginWithOAuth({provider:'apple'})` | same | `privy.oAuth.login(.apple)` | iOS gets native SIWA; Apple Sign In on Android via web only |
| Twitter / X OAuth | `useLoginWithOAuth({provider:'twitter'})` | same | `privy.oAuth.login(.twitter)` | |
| Discord OAuth | `useLoginWithOAuth({provider:'discord'})` | same | `privy.oAuth.login(.discord)` | |
| GitHub OAuth | `useLoginWithOAuth({provider:'github'})` | same | not Swift/Android | |
| LinkedIn OAuth | `useLoginWithOAuth({provider:'linkedin'})` | same | not Swift/Android | |
| Spotify OAuth | `useLoginWithOAuth({provider:'spotify'})` | same | not Swift/Android | |
| TikTok OAuth | `useLoginWithOAuth({provider:'tiktok'})` | same | not Swift/Android | |
| Instagram OAuth | `useLoginWithOAuth({provider:'instagram'})` | same | not Swift/Android | |
| LINE OAuth | `useLoginWithOAuth({provider:'line'})` | same | not Swift/Android | |
| Custom OAuth 2.0 | `useLoginWithOAuth({provider:'custom:<slug>'})` | same | n/a | Dashboard-configured; any OAuth 2.0 provider |
| Wallet (SIWE) | `useLoginWithSiwe` | `useLoginWithSiwe` | `privy.siwe` | Ethereum, EIP-4361 |
| Wallet (SIWS) | `useLoginWithSiws` | `useLoginWithSiws` | `privy.siws` | Solana, Phantom sign-in spec |
| Passkey | `useLoginWithPasskey` / `useSignupWithPasskey` | `useLoginWithPasskey` / `useSignupWithPasskey` | `privy.passkey.login` / `privy.passkey.signup` | WebAuthn |
| Farcaster | (only via Privy UI on React Web) | `useLoginWithFarcaster` | n/a | Deeplinks to Farcaster app |
| Telegram | `useLoginWithTelegram` | n/a | n/a | Telegram popup; `.xyz` domains NOT supported |
| JWT-based / external | configured in dashboard | same | same | Use any OIDC provider (Auth0, Firebase, Cognito, etc.) |
| Dashboard SSO (SAML) | n/a (dashboard only) | n/a | n/a | For accessing the Privy dashboard, not your app's users |

### Session lifecycle

```
1. User logs in (any method)
   └─ Privy issues: access token (1h JWT) + refresh token (30d opaque)
                     + identity token (10h JWT, if enabled in dashboard)

2. User makes API call to your backend
   └─ Frontend reads access token via getAccessToken()
   └─ Frontend sends: Authorization: Bearer <access_token>
   └─ Backend verifies the JWT (ES256, against Privy verification key)

3. Access token expires (after 1h)
   └─ Next getAccessToken() call triggers automatic refresh
   └─ SDK posts refresh token to Privy, receives new access token
   └─ Refresh token is rotated (old one invalidated)

4. Refresh token expires (after 30d) OR user logs out
   └─ SDK clears storage, authenticated -> false
   └─ User must re-authenticate
```

### Token types: ID token vs access token vs identity token

| Token | Format | Lifetime | Purpose | Where it lives |
|-------|--------|----------|---------|----------------|
| **Access token** | ES256 JWT | 1h (configurable) | Authenticate API requests to your backend | localStorage (default) or `privy-token` httpOnly cookie |
| **Refresh token** | Opaque string | 30d (configurable) | Renew access token without re-login | Managed by SDK, never expose to app code |
| **Identity token** | ES256 JWT | 10h (configurable) | Pass user data (linked accounts, metadata) to backend without an API call | Must be enabled in dashboard under `Authentication > Advanced > Return user data in an identity token` |

Privy calls the access token the "ID token" in some older docs but the canonical term is now **access token**. Both refer to the JWT with claims `sid` / `sub` / `iss` / `aud` / `iat` / `exp`.

Access token claims (from `access-tokens.md`):

```
sid: string  - session ID
sub: string  - user's Privy DID (e.g. did:privy:abc123)
iss: string  - always 'privy.io'
aud: string  - your Privy app ID
iat: number  - issued-at unix timestamp
exp: number  - expiry unix timestamp (typically iat + 3600)
```

---

## API surface (React SDK hooks)

All hooks below are from `@privy-io/react-auth` unless noted.

### `usePrivy()`

The primary hook. Read state, get tokens, trigger generic login/logout.

```ts
const {
  ready,          // boolean - SDK hydrated?
  authenticated,  // boolean - user logged in?
  user,           // User | null - the user object
  login,          // () => void - opens default Privy modal
  logout,         // () => Promise<void> - clears session
  getAccessToken, // () => Promise<string | null> - returns current token (auto-refreshes)
  // ... plus methods covered in other knowledge files:
  // linkEmail, linkPhone, linkGoogle, linkApple, etc.
  // unlinkEmail, unlinkPhone, etc.
  // exportWallet, createWallet, setWalletPassword, etc.
} = usePrivy();
```

Critical: `usePrivy` throws if called outside a `PrivyProvider`. See "Gotchas" below.

### `useLogin()`

Opens the prebuilt Privy modal with all configured login methods. The `useLogin()` hook also accepts callbacks:

```tsx
// from custom-oauth.md
const { login } = useLogin();
// or with callbacks (pattern same as other login hooks)
```

### `useLoginWithEmail()`

```tsx
// from email.md
const { sendCode, loginWithCode, state } = useLoginWithEmail({
  onComplete: ({ user, isNewUser, wasAlreadyAuthenticated, loginMethod, loginAccount }) => {},
  onError: (error) => {},
});

// Step 1
await sendCode({ email: 'user@example.com', disableSignup: false });
// Step 2
await loginWithCode({ code: '123456' });
```

`state.status` cycles through: `'initial'` -> `'sending-code'` -> `'awaiting-code-input'` -> `'submitting-code'` -> `'done'` (or `'error'`).

### `useLoginWithSms()`

```tsx
// from sms-whatsapp.md
const { sendCode, loginWithCode, state } = useLoginWithSms({
  onComplete: ({ user, isNewUser, ... }) => {},
  onError: (error) => {},
});

await sendCode({ phoneNumber: '+14155552671', disableSignup: false });
await loginWithCode({ code: '123456' });
```

Phone format: default country is US (+1). For non-US, prepend `+<countryCode>`. Configure default via `intl.defaultCountry` in `PrivyProvider` config.

### `useLoginWithOAuth()`

```tsx
// from oauth.md
const { initOAuth, state, loading } = useLoginWithOAuth({
  onComplete: ({ user, isNewUser, wasAlreadyAuthenticated, loginMethod, linkedAccount }) => {},
  onError: (error) => {},
});

await initOAuth({
  provider: 'google',          // 'google' | 'apple' | 'twitter' | 'github' | 'discord' |
                               // 'linkedin' | 'spotify' | 'tiktok' | 'instagram' | 'line'
                               // or 'custom:<slug>' for custom OAuth
  disableSignup: false,
});
```

State machine: `'initial'` -> `'loading'` -> `'done'` (or `'error'`).

The user is redirected to the OAuth provider's login page, then redirected back. Redirect URIs must be allowlisted in the Privy dashboard.

### `useLoginWithSiwe()`

```tsx
// from wallet.md
const { generateSiweMessage, loginWithSiwe, state } = useLoginWithSiwe({
  onComplete: ({ user, isNewUser, ... }) => {},
  onError: (error) => {},
});

const message = await generateSiweMessage({
  address: '0xabc...',        // EIP-55 checksum
  chainId: 'eip155:1',        // CAIP-2 format
  disableSignup: false,
});
const signature = await wallet.sign(message);  // wallet from useWallets()
await loginWithSiwe({ signature, message });
```

State: `'initial'` -> `'generating-message'` -> `'awaiting-signature'` -> `'submitting-signature'` -> `'done'`.

### `useLoginWithSiws()` (Solana)

```tsx
// from wallet.md
const { generateSiwsMessage, loginWithSiws } = useLoginWithSiws();

const message = await generateSiwsMessage({ address: solanaAddress });
const encodedMessage = new TextEncoder().encode(message);
const { signature } = await wallet.signMessage({ message: encodedMessage });
await loginWithSiws({ signature, message });
```

Ledger Solana hardware wallets cannot do message signing - they need the `useSolanaLedgerPlugin` hook mounted inside `PrivyProvider`:

```tsx
// from wallet.md
import {useSolanaLedgerPlugin} from '@privy-io/react-auth/solana';
function SolanaLedgerSetup() {
  useSolanaLedgerPlugin();  // MUST be inside PrivyProvider
  return null;
}
```

### `useLoginWithPasskey()` and `useSignupWithPasskey()`

```tsx
// from passkey.md
const { loginWithPasskey, state } = useLoginWithPasskey({
  onComplete: ({ user, isNewUser, ... }) => {},
  onError: (error) => {},
});
await loginWithPasskey();                // returning user
// or
await loginWithPasskey({ passkey: 'specific-credential-id' });

const { signupWithPasskey } = useSignupWithPasskey();
await signupWithPasskey();              // new user
```

State: `'initial'` -> `'generating-challenge'` -> `'awaiting-passkey'` -> `'submitting-response'` -> `'done'`.

### `useLoginWithFarcaster()` (React Native only - on React Web Farcaster only works via the prebuilt Privy modal)

```tsx
// from farcaster.md
const { loginWithFarcaster, state } = useLoginWithFarcaster({
  onSuccess: (user, isNewUser) => {},
  onError: (error) => {},
});

await loginWithFarcaster(
  {
    relyingParty: 'https://example.app',
    redirectUrl: '/',           // optional
    disableSignup: false,        // optional
  },
  {
    pollIntervalMs: 1000,        // optional, default 1000
    pollAttempts: 10,            // optional, default 10 (= 10s total)
  }
);
```

State: `'initial'` -> `'generating-uri'` -> `'awaiting-uri'` -> `'polling-status'` -> `'submitting-token'` -> `'done'`.

### `useLoginWithTelegram()` (React Web only)

```tsx
// from telegram.md
const { login, state } = useLoginWithTelegram({
  onComplete: ({ user, isNewUser, ... }) => {},
  onError: (error) => {},
});
await login();  // opens Telegram popup
```

State: `'initial'` -> `'loading'` -> `'done'` (or `'error'`).

WARNING: Telegram does NOT support `.xyz` domains. If your app is on a `.xyz` domain, set up a separate domain for the Telegram auth handshake.

### `useLogout()`

```tsx
// from logout.md
const { logout } = useLogout({
  onSuccess: () => {},
  onError: (error) => {},
});
await logout();  // clears tokens, sets authenticated=false
```

Alternatively, `logout` is also exposed from `usePrivy()` directly (without callbacks).

### `useMfa()` (verify) / `useMfaEnrollment()` (enroll + unenroll)

```tsx
// from sms (1).md, totp.md, passkeys (1).md
const { init, submit } = useMfa();
await init('sms');               // sends SMS code
await submit('sms', '123456');

await init('totp');              // no-op for TOTP (code is local)
await submit('totp', '123456');

const options = await init('passkey');
await submit('passkey', options);

// Enrollment (from sms.md, passkeys.md, totp.md):
const {
  initEnrollmentWithSms, submitEnrollmentWithSms,
  initEnrollmentWithTotp, submitEnrollmentWithTotp,
  initEnrollmentWithPasskey, submitEnrollmentWithPasskey,
  unenrollWithSms, unenrollWithTotp, unenrollWithPasskey,
} = useMfaEnrollment();

await initEnrollmentWithSms({ phoneNumber: '+14155552671' });
await submitEnrollmentWithSms({ phoneNumber: '+14155552671', mfaCode: '123456' });

await initEnrollmentWithPasskey();
const credentialIds = user.linkedAccounts
  .filter(a => a.type === 'passkey')
  .map(a => a.credentialId);
await submitEnrollmentWithPasskey({ credentialIds });
```

### `getAccessToken()`

Two ways to call:

```tsx
// from access-tokens.md
// Preferred - from the hook
const { getAccessToken } = usePrivy();
const token = await getAccessToken();

// Outside React context (e.g. Axios interceptor)
import { getAccessToken } from '@privy-io/react-auth';
const token = await getAccessToken();
// WARNING: only safe AFTER PrivyProvider has rendered
```

This method auto-refreshes if the current token is expired or about to expire. See the infinite-loop pitfall under "Gotchas".

---

## Login method deep dives

### Email OTP

**Dashboard setup**

- Enable Email in `Login methods` page of dashboard.
- Optionally enable "block disposable email addresses" - uses the `mailchecker` library.
- Enterprise plans can customize the OTP email (sender, branding, logo).

**Trigger**

```tsx
// from email.md
import { useLoginWithEmail } from "@privy-io/react-auth";

const { sendCode, loginWithCode } = useLoginWithEmail();
await sendCode({ email });
await loginWithCode({ code });
```

**User object after login**

Look for `user.email` or scan `user.linkedAccounts` for `type === 'email'`:

```ts
// from passkey.md (user object schema)
{
  type: 'email',
  address: 'user@example.com',
  first_verified_at: <unix>,
  latest_verified_at: <unix>,
}
```

**Common errors**

- `invalid email` - format check failed
- `code expired` - OTP codes expire after a few minutes
- `too many attempts` - rate limited; user must request a new code
- `disposable email blocked` - mailchecker rejected the domain (only if enabled)

### SMS / WhatsApp OTP

**Dashboard setup**

- Enable SMS OR WhatsApp in `Login methods` (cannot do both).
- Choice is permanent once your account is enabled with a provider.

**Trigger** - see `useLoginWithSms` above.

**User object after login**

```ts
// from passkey.md
{
  type: 'phone',
  number: '+14155552671',
  first_verified_at: <unix>,
  latest_verified_at: <unix>,
}
```

**Common errors**

- `invalid phone number` - format must be E.164 with country code (or default-country prefix applies)
- `code expired`
- `provider rate limit` - Twilio/WhatsApp side rate limits

### Google OAuth

**Dashboard setup**

- Enable Google in `Login methods > Socials`.
- Optionally provide your own Google OAuth credentials (lets you retrieve OAuth tokens via `useOAuthTokens`).
- Add allowed OAuth redirect URLs in the dashboard.

**Trigger**

```tsx
// from oauth.md
await initOAuth({ provider: 'google' });
```

**User object after login**

```ts
// from passkey.md
{
  type: 'google_oauth',
  subject: '<google sub claim>',
  email: 'user@gmail.com',
  name: 'Full Name',
  first_verified_at: <unix>,
  latest_verified_at: <unix>,
}
```

`user.google` is also exposed as a top-level convenience accessor (used by Spectre's `getPrivyDisplayInfo`).

**Known limitation** - Google OAuth fails in in-app browsers (Telegram, Discord, Instagram, etc.) due to Google's WebView policy. Show users an "open in external browser" hint when detecting an IAB UA.

### Apple OAuth

Same trigger as Google: `await initOAuth({ provider: 'apple' });`

On Swift the dashboard supports native Sign in with Apple (separate setup). On iOS Flutter, the same SIWA dialog appears.

**User object**

```ts
// from passkey.md
{
  type: 'apple_oauth',
  email: 'user@privaterelay.appleid.com',  // often a private relay address
  subject: '<apple user ID>',
  first_verified_at: <unix>,
  latest_verified_at: <unix>,
}
```

Apple does not expose name on subsequent logins, only the first. Capture it then or use email.

### Twitter / X OAuth

```tsx
await initOAuth({ provider: 'twitter' });
```

**User object**

```ts
// from passkey.md
{
  type: 'twitter_oauth',
  subject: '<twitter user id>',
  name: 'Display Name',
  username: 'handle',  // without the '@'
  profile_picture_url: 'https://...',  // optional
  first_verified_at: <unix>,
  latest_verified_at: <unix>,
}
```

### Discord / GitHub / LinkedIn / Spotify / TikTok / Instagram / LINE

All triggered the same way (`initOAuth({ provider: '<name>' })`). Each linked account shows up with type `<name>_oauth` in `linkedAccounts`. See `passkey.md` for the full per-provider field shape (subject, email, username, etc.).

### Wallet (SIWE - Ethereum)

**Dashboard setup**

- Enable Wallet in `Login methods`.
- Allowlist your app's domain in the dashboard (required for the SIWE message).

**Trigger**

```tsx
// from wallet.md
import { useLoginWithSiwe, useWallets } from '@privy-io/react-auth';

const { generateSiweMessage, loginWithSiwe } = useLoginWithSiwe();
const { wallets } = useWallets();

const activeWallet = wallets[0];
const message = await generateSiweMessage({
  address: activeWallet.address,
  chainId: 'eip155:1',
});
const signature = await activeWallet.sign(message);
await loginWithSiwe({ signature, message });
```

**User object**

```ts
// from passkey.md
{
  type: 'wallet',
  chain_type: 'ethereum',
  address: '0xCheckSummed...',
  first_verified_at: <unix>,
  latest_verified_at: <unix>,
}
```

### Wallet (SIWS - Solana)

```tsx
// from wallet.md
import {useLoginWithSiws} from '@privy-io/react-auth';
import {useWallets} from '@privy-io/react-auth/solana';  // note the /solana sub-path

const {generateSiwsMessage, loginWithSiws} = useLoginWithSiws();
const {wallets} = useWallets();

const message = await generateSiwsMessage({ address: wallets[0].address });
const encodedMessage = new TextEncoder().encode(message);
const {signature} = await wallets[0].signMessage({message: encodedMessage});
await loginWithSiws({signature, message});
```

User object: same shape as SIWE but `chain_type: 'solana'`.

### Passkey

**Dashboard setup**

- Enable Passkey in `Login methods`.
- For React Native: see the setup-passkeys guide (need `relyingParty` for AASA / Digital Asset Links).

**Trigger**

```tsx
// from passkey.md
const { loginWithPasskey } = useLoginWithPasskey();
const { signupWithPasskey } = useSignupWithPasskey();

await loginWithPasskey();        // existing user
await signupWithPasskey();       // new user
```

**User object**

```ts
// from passkey.md (Android schema fully expanded)
{
  type: 'passkey',
  credentialId: '<webauthn credential id>',
  authenticatorName: 'iCloud Keychain',  // optional
  createdWithBrowser: 'Chrome',
  createdWithOs: 'macOS',
  createdWithDevice: 'MacBook Pro',
  publicKey: '...',
  enrolledInMfa: false,
  first_verified_at: <unix>,
  latest_verified_at: <unix>,
}
```

### Farcaster

```tsx
// from farcaster.md - React Native; for React web, must use the prebuilt Privy UI
await loginWithFarcaster({
  relyingParty: 'https://example.app',
});
```

Triggers a deeplink to the Farcaster app on the device, or directs to install page if not installed. SDK then polls Farcaster for completion.

**User object**

```ts
// from passkey.md
{
  type: 'farcaster',
  fid: <number>,
  owner_address: '0x...',  // user's Farcaster wallet (NOT Privy embedded wallet)
  username: 'name',         // optional, no '@'
  display_name: '...',
  bio: '...',
  profile_picture_url: '...',
  homepage_url: '...',
  first_verified_at: <unix>,
  latest_verified_at: <unix>,
}
```

### Telegram

```tsx
// from telegram.md
const { login } = useLoginWithTelegram();
await login();  // opens Telegram-styled popup
```

**Critical gotcha** - Telegram does NOT support `.xyz` domains.

**User object**

```ts
// from passkey.md
{
  type: 'telegram',
  telegram_user_id: '<id>',
  first_name: 'First',
  last_name: 'Last',        // optional
  username: 'handle',        // optional
  photo_url: 'https://...',  // optional
  first_verified_at: <unix>,
  latest_verified_at: <unix>,
}
```

### Custom OAuth 2.0

For providers Privy doesn't natively support (Twitch, Kraken, Reddit, etc.):

**Dashboard setup**

1. Register OAuth app with the provider. Redirect URI must be `https://auth.privy.io/api/v1/oauth/callback`.
2. In Privy dashboard `Settings > Login methods > Add Custom Provider`, fill in:
   - Display name, icon
   - Client ID + Client Secret
   - Authorization URL, Token URL, optional Profile URL
   - Scopes + scopes delimiter
   - PKCE toggle
   - User info source: ID Token / Profile endpoint / Access token JWT
   - Field mapping (e.g. `path_to_name: 'display_name'`)

> from `custom-oauth.md`
> Once set, custom OAuth provider fields cannot be changed. Be sure to double check your configuration before saving. Once users are created under a custom OAuth provider, the configuration cannot be deleted.

**Trigger**

```tsx
// from custom-oauth.md
const { initOAuth } = useLoginWithOAuth();
await initOAuth({ provider: 'custom:twitch' });
```

**User object** - linked account `type` will be `custom:twitch` (whatever slug you configured). Filter with:

```tsx
// from custom-oauth.md
const customAccounts = user?.linkedAccounts?.filter((account) =>
  account.type.startsWith('custom:')
);
```

### JWT-based / external auth provider (Auth0, Firebase, Cognito, Stytch)

If your app already has an auth provider, integrate via JWT instead of using Privy login methods:

1. Get your JWKS.json endpoint from your provider.
2. In Privy dashboard `Configuration > Authentication`, enable JWT-based authentication.
3. Register the JWKS endpoint and the claim name that holds the user ID (typically `sub`).

Now Privy can verify access tokens from your provider and issue user authorization keys (used for the embedded wallet API). See `authentication.md` for the minimal setup notes and `User Auth Keys.md` for the cryptographic flow.

### Dashboard SSO (SAML 2.0 / OIDC)

This is for accessing the **Privy dashboard** with your team's Okta / Entra ID / Google Workspace - it has NOTHING to do with end-user authentication.

Setup is in `Account > Settings > SSO`:

1. Verify domain via DNS TXT record.
2. Configure identity provider (the dashboard provides a setup portal).
3. Optional: enable automatic account provisioning (new SSO users assigned `Viewer` role by default).

See `sso.md` for the full walkthrough. Available as an add-on for all plan tiers.

---

## Session & token management

### Calling your backend with an access token

```tsx
// from access-tokens.md - fetch
const accessToken = await getAccessToken();
const response = await fetch('/api/your-route', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(data),
});

// axios
import axios from 'axios';
const response = await axios.post('/api/your-route', data, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

### Cookie vs localStorage strategies

Privy stores tokens in **localStorage by default**. If your app is on a verified domain, you can switch to **HttpOnly cookies** (mitigates XSS attacks - tokens cannot be read by JS).

With cookies, the token rides automatically on same-domain requests:

```tsx
// from access-tokens.md
const response = await fetch('/api/your-route', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',  // includes the privy-token cookie
  body: JSON.stringify(data),
});
```

On the server side, look for the token in `req.cookies['privy-token']` (cookie mode) vs the `Authorization` header (localStorage mode).

### Token expiry, refresh, rotation

- Access token: 1h default, renewed automatically by `getAccessToken()` when expired
- Refresh token: 30d default, single-use - rotated on every refresh (old one invalidated)
- If a refresh fails, the user is logged out automatically

> from `tokens.md`
> If the Privy SDK detects any token tampering, it immediately invalidates the session and requires re-authentication. This destroys the corresponding session in Privy's backend.

Both lifetimes are configurable in `Dashboard > User management > Authentication > Advanced`.

### Verifying tokens on your server

See `08-server-sdk.md` for full coverage. Two paths:

**Privy SDK** (`@privy-io/node`):

```ts
// from access-tokens.md
try {
  const verifiedClaims = await privy.utils().auth().verifyAccessToken({
    access_token: accessToken
  });
  // verifiedClaims = { appId, userId, issuer, issuedAt, expiration, sessionId }
} catch (error) {
  // token is invalid - reject the request
}
```

Pass `jwtVerificationKey` to the `PrivyClient` constructor to skip the network call to Privy for the key:

```ts
// from access-tokens.md
const privy = new PrivyClient({
  appId: 'your-privy-app-id',
  appSecret: 'your-privy-app-secret',
  jwtVerificationKey: 'paste-your-verification-key-from-the-dashboard'
});
```

**Generic JWT lib** (`jose`):

```ts
// from access-tokens.md
const verificationKey = await jose.importSPKI(
  "insert-your-privy-verification-key",
  "ES256"
);
const payload = await jose.jwtVerify(accessToken, verificationKey, {
  issuer: "privy.io",
  audience: "insert-your-privy-app-id",
});
// payload.sub = user DID
```

Or `jsonwebtoken`:

```ts
// from access-tokens.md
const verificationKey = "insert-your-privy-verification-key".replace(/\\n/g, "\n");
const decoded = jwt.verify(accessToken, verificationKey, {
  issuer: 'privy.io',
  audience: /* your Privy App ID */
});
// decoded.sub = user DID
```

Go and Rust examples are in `access-tokens.md`.

---

## MFA & security

### When does MFA fire?

MFA in Privy gates **wallet operations** (signing transactions, exporting the embedded wallet). It does NOT gate login. Once enrolled, every wallet action will require completing an MFA challenge.

Available factors:

- TOTP (authenticator apps - Google Authenticator, Authy, 1Password, etc.)
- Passkey (WebAuthn)
- SMS

> from `sms.md`
> If your app has enabled SMS as a possible login method, users will not be able to enroll SMS as a valid MFA method. SMS must either be used as a login method to secure user accounts, or as an MFA method for additional security on the users' wallets, but cannot be used for both.

### Enrollment flow (SMS)

```tsx
// from sms.md
const { initEnrollmentWithSms, submitEnrollmentWithSms } = useMfaEnrollment();
await initEnrollmentWithSms({ phoneNumber: '+14155552671' });
// User receives 6-digit code on phone
await submitEnrollmentWithSms({
  phoneNumber: '+14155552671',
  mfaCode: '123456',
});
```

### Enrollment flow (TOTP)

```tsx
// generic pattern from totp.md / useMfaEnrollment - check live docs for current signature
const { initEnrollmentWithTotp, submitEnrollmentWithTotp } = useMfaEnrollment();
const { secret, qrCode } = await initEnrollmentWithTotp();
// show user the QR code; user scans into authenticator app
await submitEnrollmentWithTotp({ mfaCode: '123456' });
```

### Enrollment flow (Passkey)

```tsx
// from passkeys.md
const { initEnrollmentWithPasskey, submitEnrollmentWithPasskey } = useMfaEnrollment();

await initEnrollmentWithPasskey();

const credentialIds = user.linkedAccounts
  .filter((account) => account.type === 'passkey')
  .map((x) => x.credentialId);

await submitEnrollmentWithPasskey({ credentialIds });
```

### Verification (when wallet action is blocked by MFA)

```tsx
// from sms (1).md
const { init, submit } = useMfa();

await init('sms');                   // sends SMS code
await submit('sms', '123456');

await init('totp');                  // no-op (code is local)
await submit('totp', '123456');

const options = await init('passkey');
await submit('passkey', options);    // triggers WebAuthn prompt
```

### Un-enrolling

```tsx
// from unenroll.md
const { unenrollWithSms, unenrollWithTotp, unenrollWithPasskey } = useMfaEnrollment();
await unenrollWithSms();
await unenrollWithTotp();
await unenrollWithPasskey();
```

> from `unenroll.md`
> Unenrolling an MFA method requires MFA verification.

On React Native + Swift + Kotlin, un-enrolling a passkey also unlinks it as a login method by default. To keep it as a login method:

```tsx
// from unenroll.md
await unenrollMfa({ method: 'passkey', removeForLogin: false });
```

### Why un-enrollment matters

If a user loses access to their TOTP / passkey / SMS device, they get locked out of their wallet permanently (Privy is non-custodial - no recovery). Always give users a UI surface to un-enroll an old factor before losing the device, or to enroll a backup factor.

### Captcha (login bot protection)

```tsx
// from captcha.md
import {Captcha, useLoginWithEmail} from '@privy-io/react-auth';

const MyLoginForm = () => {
  const {sendCode} = useLoginWithEmail();
  return (
    <>
      <input type="text" />
      <button onClick={() => sendCode({email})}>Send Code</button>
      <Captcha />
    </>
  );
};
```

The `<Captcha />` component must be a peer to your login form. It runs invisibly. Providers: **hCaptcha** (with risk-tolerance setting) or **Cloudflare Turnstile**. Must be enabled in `Dashboard > Settings > Advanced` before code-level integration works.

Failures (timeouts, suspicion of bot) bubble up through the `sendCode` / `initOAuth` rejection. Add `Captcha`-related domains to your CSP - see `11-security-and-webhooks.md`.

### User authorization keys (advanced)

For server-side wallet actions, Privy issues short-lived **authorization keys** from inside a TEE (trusted execution environment). The flow:

1. Your app makes a request to Privy using a verified JWT (from any provider).
2. Privy's TEE issues a time-bound authorization key.
3. Use that key to authorize Wallet API requests.

> from `User Auth Keys.md`
> The returned time-bound authorization key is encrypted from the TEE to the client using HPKE (Hybrid Public Key Encryption), using the same method used by the wallet export API.

This is advanced. SDKs handle it internally - manual API use is opt-in.

---

## Code patterns (preserved verbatim from Privy docs)

### Email login + verify (full flow)

```tsx
// from email.md
import { useState } from "react";
import { useLoginWithEmail } from "@privy-io/react-auth";

export default function LoginWithEmail() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const { sendCode, loginWithCode } = useLoginWithEmail();

  return (
      <div>
          <input onChange={(e) => setEmail(e.currentTarget.value)} value={email} />
          <button onClick={() => sendCode({ email })}>Send Code</button>
          <input onChange={(e) => setCode(e.currentTarget.value)} value={code} />
          <button onClick={() => loginWithCode({ code })}>Login</button>
      </div>
  );
}
```

### OAuth round-trip with callbacks

```jsx
// from oauth.md
import { useLoginWithOAuth } from '@privy-io/react-auth';

export default function LoginWithOAuth() {
    const { initOAuth } = useLoginWithOAuth({
        onComplete: ({ user, isNewUser }) => {
            console.log('User logged in successfully', user);
            if (isNewUser) {
                // Perform actions for new users
            }
        },
        onError: (error) => {
            console.error('Login failed', error);
        }
    });

    return (
        <button onClick={() => initOAuth({ provider: 'google' })}>
            Log in with Google
        </button>
    );
}
```

### Logout with callbacks

```tsx
// from logout.md
import { useLogout } from '@privy-io/react-auth';

function LogoutButton() {
  const { logout } = useLogout({
    onSuccess: () => {
      console.log('User successfully logged out');
      // Redirect to landing page or perform other post-logout actions
    },
    onError: (error) => {
      console.error('Logout failed', error);
    }
  });

  return <button onClick={logout}>Log out</button>;
}
```

### MFA enrollment - SMS end-to-end

```tsx
// from sms.md
import {useMfaEnrollment} from '@privy-io/react-auth';

export default function MfaEnrollmentWithSms() {
  const {initEnrollmentWithSms, submitEnrollmentWithSms} = useMfaEnrollment();

  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState<string | null>(null);
  const [pendingMfaCode, setPendingMfaCode] = useState<boolean>(false);

  const onEnteredPhoneNumber = async () => {
    await initEnrollmentWithSms({phoneNumber: phoneNumber});
    setPendingMfaCode(true);
  }

  const onEnteredMfaCode = async () => {
    await submitEnrollmentWithSms({phoneNumber: phoneNumber, mfaCode: mfaCode});
    setPendingMfaCode(false);
  }

  if (!pendingMfaCode) {
    return <>
      <input placeholder='(555) 555 5555' onChange={(event) => setPhoneNumber(event.target.value)}/>
      <button onClick={onEnteredPhoneNumber}>Enroll a Phone with MFA</button>
    </>;
  }
  return <>
    <input placeholder='123456' onChange={(event) => setMfaCode(event.target.value)}/>
    <button onClick={onEnteredMfaCode}>Submit Enrollment Code</button>
  </>;
}
```

### Server-side token verification (Node SDK)

```ts
// from access-tokens.md
import { PrivyClient } from '@privy-io/node';

const privy = new PrivyClient({
  appId: 'your-privy-app-id',
  appSecret: 'your-privy-app-secret',
  jwtVerificationKey: 'paste-your-verification-key-from-the-dashboard'
});

// in your route handler:
const accessToken = req.headers.authorization?.replace('Bearer ', '');
try {
  const verifiedClaims = await privy.utils().auth().verifyAccessToken({
    access_token: accessToken
  });
  const userId = verifiedClaims.userId;  // did:privy:abc123...
  // proceed with the request as this authenticated user
} catch (error) {
  return res.status(401).json({ error: 'Invalid token' });
}
```

### Server-side token verification (jose, no Privy SDK)

```ts
// from access-tokens.md
import * as jose from 'jose';

const verificationKey = await jose.importSPKI(
  "insert-your-privy-verification-key",
  "ES256"
);

const accessToken = "insert-the-users-access-token";
try {
  const payload = await jose.jwtVerify(accessToken, verificationKey, {
    issuer: "privy.io",
    audience: "insert-your-privy-app-id",
  });
  console.log(payload);  // payload.sub = user DID
} catch (error) {
  console.error(error);
}
```

### SIWE wallet login (full flow)

```tsx
// from wallet.md
import { useLoginWithSiwe, useWallets } from '@privy-io/react-auth';

export function LoginWithWalletButton() {
  const { generateSiweMessage, loginWithSiwe } = useLoginWithSiwe();
  const { wallets } = useWallets();

  const handleLogin = async () => {
    if (!wallets?.length) return;
    const activeWallet = wallets[0];

    const message = await generateSiweMessage({
      address: activeWallet.address,
      chainId: 'eip155:1',
    });

    const signature = await activeWallet.sign(message);
    await loginWithSiwe({ signature, message });
  };

  return (
    <button onClick={handleLogin}>Log in with wallet</button>
  );
}
```

---

## Spectre-specific notes

Spectre runs Privy in TWO apps with different configurations - this is deliberate.

### Research app config (`apps/research/src/lib/privy-config.js`)

Uses Privy v2 `loginMethodsAndOrder` to lock in a 3-column grid (Email | Google | X) with an "Other socials" overflow:

```js
// from apps/research/src/lib/privy-config.js
loginMethodsAndOrder: {
  primary: ['email', 'google', 'twitter'],
  overflow: ['discord', 'apple', 'wallet'],
},
```

Research also imports `toSolanaWalletConnectors` (with `shouldAutoConnect: false`) and wires it under `externalWallets.solana.connectors`. Without this, the Phantom button does not appear in the wallet picker.

Embedded wallets: both ETH + SOL created on signup for users-without-wallets.

### Trading app config (`apps/trading/src/lib/privy-config.js`)

Uses Privy v1 flat `loginMethods` array - intentional, do not upgrade without testing the Solana wallet flow:

```js
// from apps/trading/src/lib/privy-config.js
loginMethods: ['email', 'google', 'twitter', 'apple', 'discord', 'wallet'],
```

No Solana connectors import. Same embedded wallet config as research.

### Why v1 vs v2

Per `apps/trading/CLAUDE.md`:

> Privy config: Research uses v2 `loginMethodsAndOrder` + Solana connectors. Trading uses v1 `loginMethods` - intentional, do not upgrade without testing Solana wallet flow

Both work, but `loginMethodsAndOrder` is the modern surface and gives you the primary/overflow tiering.

### DOM hacks in `main.jsx` (both apps)

The Privy modal has two issues that Spectre patches by mutating its DOM after mount:

1. **Auto-click "Continue with Email"** so the email input is visible immediately when the modal opens. Without this, users see only the email tile and have to click into it.
2. **Make the wallet list scrollable** - the wallet list inside the modal uses `react-window` virtualization, but the parent doesn't have `overflow:auto` set correctly. Spectre walks up 2 levels from a wallet row button to reach the L2 wrapper that react-window expects to host the scroll listener, then sets a marker on it.

Comment from `main.jsx`:

> Privy modal UX hooks - auto-expand email input + make wallet list scrollable. These mutate Privy's DOM directly because Privy doesn't expose config for these tweaks and the nested CSS :has() selectors needed to target Privy's wrapping structure are not valid in any browser.

### `PrivyProvider` is conditional

`PRIVY_APP_ID` may be empty on dev machines without the env var. Both apps render the tree without `PrivyProvider` in that case, so the app boots normally but Privy hooks throw if called:

```jsx
// from apps/research/src/main.jsx
{PRIVY_APP_ID && !isShowcaseEmbed ? (
  <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
    {appTree}
  </PrivyProvider>
) : appTree}
```

Any component that calls `usePrivy` / `useWallets` / etc. must tolerate the case where the provider is absent. See `.claude/rules/solana-web3.md` section A for the pattern.

### `getPrivyDisplayInfo(user)` (both apps)

Helper that pulls display name + avatar + email from whichever login method the user used:

```js
// from apps/research/src/lib/privy-user.js
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

Used by the header profile chip, the user dashboard, and the share-to-X feature.

### Cross-app session sharing is NOT implemented

Research runs on `:5180` and trading on `:5181` (and on separate Vercel domains in prod). Each app has its own independent `PrivyProvider`, so a login in one does NOT persist to the other. This is a known limitation. If/when cross-app session sharing is needed, Privy would need to be set up with a shared cookie domain (or the auth-gating moves to a single shell app).

### `AuthGate.jsx` is separate from Privy

The team-password gate uses `sessionStorage` only. It's bypassed automatically on localhost. Privy login does NOT satisfy AuthGate, and vice versa. Per `solana-web3.md` section K:

> The app has TWO separate auth layers:
> 1. AuthGate - team password gate (sessionStorage). NOT Privy. Bypassed automatically on localhost/dev.
> 2. Privy - wallet + identity layer. Optional. Used for signing transactions and profile sync.

---

## Gotchas & pitfalls

### `usePrivy` / `useWallets` / etc. crash before hydration

Calling Privy hooks before `PrivyProvider` finishes hydrating from storage causes a crash. Specifically: `useWallets`, `useConnectWallet`, `useFundWallet`, `useSendTransaction` are the most common offenders.

**Fix** - defer these hooks to a CHILD component that only mounts after the user navigates into the wallet UI. By then the provider is ready. From `.claude/rules/solana-web3.md`:

```
UserDashboard (parent)
  -> WalletTab (child, mounts on tab click)
       -> uses useWallets, useSendTransaction, etc.
       -> wrapped in PrivyWalletErrorBoundary (class component)
```

Wrap the wallet UI in a React error boundary as a safety net.

### `getAccessToken` reference changes every render -> infinite loop

`getAccessToken` returned from `usePrivy()` is a fresh function reference on every render. Putting it in a `useEffect` dependency array causes an infinite loop.

**Fix** - store it in a `useRef`:

```js
// from .claude/rules/solana-web3.md
const { getAccessToken } = usePrivy()
const getAccessTokenRef = useRef(getAccessToken)
getAccessTokenRef.current = getAccessToken

useEffect(() => {
  async function sync() {
    const token = await getAccessTokenRef.current()
    // ... use token
  }
  sync()
}, []) // no getAccessToken in deps
```

Exception: `useProfileSync.js` puts `getAccessToken` directly in deps but guards with `if (didSync.current) return` so re-fires are harmless. For any new effect that's not idempotent, use the ref pattern.

### v1 `loginMethods` vs v2 `loginMethodsAndOrder` are not interchangeable

Migrating between the two is breaking. v2 gives you primary/overflow tiering but its order semantics are different from v1's flat array. Spectre's trading app intentionally stays on v1 because the Solana wallet button rendering had regressions during v2 testing.

### OAuth redirect URIs must be allowlisted

For OAuth providers, Privy redirects through `https://auth.privy.io/api/v1/oauth/callback`. But after the round-trip, you can also be redirected back to a custom URL within your app - those URLs MUST be added to "Allowed OAuth redirect URLs" in the dashboard, otherwise Privy refuses to redirect.

### Email tile is sometimes hidden behind the wallet list

In Spectre's branded modal, when `walletList` is long, the email tile can render below the fold and look hidden. The DOM hack in Spectre's `main.jsx` auto-clicks the email tile so the input is always visible on modal mount.

### Wallet list uses `react-window` virtualization

This is why the full list (612+ wallets) doesn't scroll without targeting the right parent. Spectre's DOM hack walks up 2 levels from a wallet button to find the right scroll container and marks it.

### Captcha must be enabled in dashboard first

The `<Captcha />` React component does nothing until you've enabled CAPTCHA in `Dashboard > Settings > Advanced` and configured a provider (hCaptcha or Turnstile). Code-level integration alone is not enough.

### Telegram does not support `.xyz` domains

If your app is on a `.xyz` domain, Telegram silently refuses to send auth messages. Set up a separate subdomain on a different TLD for Telegram auth.

### Google OAuth fails in in-app browsers

Telegram, Discord, Instagram, etc. all use embedded WebViews where Google has banned its OAuth flow. Detect IAB user-agents and either degrade gracefully (show email login only) or prompt the user to "open in browser".

### Apple does not return name on subsequent logins

The user's name is only included in the first SIWA response. Capture it then or fall back to email. The token always has the user's Apple ID (`subject`).

### `disableSignup` does NOT prevent linking an existing account

It only blocks NEW user creation. If you want to prevent account proliferation for an already-authenticated user, use the linking APIs (`linkEmail`, `linkOAuth`, etc.) instead of the login APIs.

### Refresh tokens should never be sent to the frontend

They're managed entirely inside the SDK. Never log them, never send them in URLs, never store them in custom localStorage keys. The Privy SDK handles all token lifecycle.

### TEE-issued authorization keys vs access tokens

These are different things. The access token authenticates your user against your backend. Authorization keys are issued by Privy's TEE for wallet API operations. Most apps never touch authorization keys directly - the SDK handles them internally.

### MFA loses access if device is lost

Privy is non-custodial. There is no "recover via support". If the user enrolls TOTP and loses the device with no backup factor, the wallet is permanently inaccessible. Always offer un-enrollment UI BEFORE the device is lost, and prompt enrolling a backup factor (e.g. SMS as well as TOTP).

### SMS as MFA conflicts with SMS as login method

> from `sms.md`
> If your app has enabled SMS as a possible login method, users will not be able to enroll SMS as a valid MFA method.

Pick one. SMS for login OR SMS for MFA, never both for the same user pool.

---

## Cross-references

- Embedded wallet creation on login -> `02-embedded-wallets.md`
- Wallet actions (signing, transactions, swaps) -> `03-wallet-actions.md` (if present)
- Server-side token verification + Privy server SDK -> `08-server-sdk.md`
- Modal styling / whitelabel hooks -> `09-ui-and-customization.md`
- Webhooks for auth events -> `11-security-and-webhooks.md`
- Security hardening (CSP, allowed domains, IP allowlist) -> `11-security-and-webhooks.md`
- Current Spectre implementation snapshot -> `spectre/current-implementation.md`
