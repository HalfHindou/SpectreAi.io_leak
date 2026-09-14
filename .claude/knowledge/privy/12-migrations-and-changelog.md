---
description: Privy SDK migration paths (v1 -> v2 -> v3, server-auth -> @privy-io/node) and condensed changelog highlights. Use when bumping @privy-io/react-auth, switching server SDKs, or auditing version drift between research and trading apps.
---

# Privy Migrations & Changelog

This file consolidates the three official Privy migration guides, the React-auth changelog (`@privy-io/react-auth`), the NodeJS SDK changelog (`@privy-io/node`), and recent product updates. It is the canonical reference for any "what changed between versions X and Y" question across the Spectre monorepo.

## Source docs synthesized

All paths relative to `C:\Users\worka\OneDrive\Desktop\Privy\`.

- `migrating-to-2.0.md` (read in full, 294 lines) - v1.x -> v2.0 breaking changes
- `migrating-to-3.0.md` (read in full, 401 lines) - v2.x -> v3.0 breaking changes
- `migrating-from-server-auth.md` (read in full, 172 lines) - `@privy-io/server-auth` -> `@privy-io/node`
- `changelog.md` (3924 lines, sampled strategically):
  - lines 1-300 (latest 3.x patch versions: 3.26.1 down to 3.13.0)
  - lines 385-475 (3.x deprecation moves around 3.9-3.10)
  - lines 650-850 (3.0.0 release block + 2.25 -> 2.19 surrounding context)
  - lines 1270-1350 (2.5.0 breaking, 2.4.x context)
  - lines 1520-1620 (2.0.0 release block + 1.99 -> 1.98)
  - lines 2180-2410 (1.78 -> 1.72, WalletConnect / SIWE / Farcaster era)
  - lines 2540-2740 (1.64 -> 1.59, Instagram / passkey / TOTP era)
  - lines 3100-3400 (1.50 -> 1.38, modal redesign / SIWE / first MFA)
  - lines 3400-3925 (1.37 -> 1.15, original embedded wallet release + WalletConnect v1->v2 migration)
- `changelog (1).md` (read in full, 231 lines) - NodeJS SDK 0.1.0 -> 0.18.0
- `product-updates.md` (read in full, Jan -> Apr 2026 timeline) - cross-product feature drops
- `Build with AI tools.md`, `using-llms.md` (both inspected, near duplicates) - MCP server + Agent Skill setup

Three breaking-change Warning blocks (lines 2185, 2353, 2380, 2465, 2581, 2660, 2855, 2900, 3118, 3203, 3236, 3294, 3523, 3585, 3626, 3716, 3821) were spot-checked for content; only the ones that materially affect the Spectre stack are surfaced below.

## Current SDK version landscape

Latest stable as of the changelog snapshot used here:

| Package | Latest | Notable peer/dep requirements |
|---|---|---|
| `@privy-io/react-auth` | **3.26.1** | React 18+; peer deps for Solana now use `@solana/kit` family (see v3 migration) |
| `@privy-io/react-auth/solana` sub-export | ships with `react-auth@3` | requires `@solana/kit`, `@solana-program/memo`, `@solana-program/system`, `@solana-program/token`. NO longer needs `@solana/web3.js` or `@solana/spl-token` as Privy peers |
| `@privy-io/node` (server SDK) | **0.18.0** | Node 20 LTS+, Deno 1.28+, Bun 1.0+, Cloudflare Workers, Vercel Edge, Nitro 2.6+ |
| `@privy-io/server-auth` (legacy server) | superseded by `@privy-io/node` | still receives security updates but new features land on `node` |
| `@privy-io/js-sdk-core` (internal) | **0.64.0** | bumped on most react-auth releases - never depend on directly |
| `@privy-io/api-types` | 0.10.0 | internal |

Paid-tier / commercial features visible in the public changelog (product-updates.md confirms):
- Custodial wallets (EVM, Solana) - Feb/Apr 2026
- Treasury management dashboard - Apr 2026
- Manual approvals + nested key quorums - Mar 2026
- Stateful policies - Feb 2026
- Flexible custody (private beta) - Jan 2026
- Native swaps API (EVM) - Apr 2026
- Earn (Morpho, Aave, Kamino) - Jan/Mar 2026
- Stripe headless crypto onramp - Jan 2026
- SOC 2 Type II renewed - Apr 2026

## v1 -> v2 migration

Source: `migrating-to-2.0.md`. Install with `npm i @privy-io/react-auth@latest`.

### High-impact renames and removals

**`onSuccess` prop on `PrivyProvider`** - removed. Use the `onSuccess` callback registered via `useLogin`.

**`createPrivyWalletOnLogin` prop** - removed. Migrate to:
```tsx
<PrivyProvider
  config={{ embeddedWallets: { createOnLogin: 'users-without-wallets' } }}
>
```

**`additionalChains` and `rpcConfig`** - removed. Use `supportedChains` only.

**`noPromptOnSignature`** - removed. Use `embeddedWallets.showWalletUIs: false` (and configure UIs in the dashboard).

**`getEthersProvider` / `getWeb3jsProvider`** on `ConnectedWallet` - removed. Use `getEthereumProvider()` and wrap with viem/ethers/web3 yourself:
```ts
const privyProvider = await wallet.getEthereumProvider();
const provider = new ethers.providers.Web3Provider(privyProvider);
```

**`sendTransaction` return shape** - now `Promise<{hash: string}>`, not `Promise<TransactionReceipt>`. To get a receipt, follow up with `publicClient.waitForTransactionReceipt({hash})`.

**`waitForTransactionConfirmation` experimental option** - removed. Always-await is now the default.

### Method signature changes (positional -> named-args)

All of these become named arguments after the first positional payload:

```ts
// v1
const sig = await signMessage(message, uiOptions, address);
// v2
const {signature} = await signMessage({message}, {uiOptions, address});

// v1
const receipt = await sendTransaction(tx, uiOptions, fundWalletConfig, address);
// v2
const {hash} = await sendTransaction(tx, {uiOptions, fundWalletConfig, address});

// Smart wallet client follows the same pattern
const sig = await client.signMessage({message}, {uiOptions, address});
const hash = await client.sendTransaction(tx, {uiOptions, fundWalletConfig, address});
```

### Solana moves to its own entrypoint

```ts
// v1
import {useSendSolanaTransaction} from '@privy-io/react-auth';
const {sendSolanaTransaction} = useSendSolanaTransaction();

// v2
import {useSendTransaction} from '@privy-io/react-auth/solana';
const {sendTransaction} = useSendTransaction();
```

`sendSolanaTransaction` is removed from `usePrivy()`. Also: `useSolanaWallets().delegateWalletAction()` becomes `useDelegatedActions().delegateWallet({address, chainType: 'solana'})`.

### Callback signature normalization

Every non-error callback was switched from positional to a single named-args object:

```tsx
// v1
useLogin({onComplete: (user, isNewUser, wasAlreadyAuthenticated, loginMethod, linkedAccount) => {}})
// v2
useLogin({onComplete: ({user, isNewUser, wasAlreadyAuthenticated, loginMethod, linkedAccount}) => {}})

// Same applies to useOAuthTokens.onOAuthTokenGrant, useLinkAccount, etc.
// onError stays as a single argument.
```

### Wallet config

- `user.wallet` is guaranteed to be the first linked wallet. To track the latest connected wallet, iterate `wallets` yourself.
- `setActiveWallet` method - removed; use the `wallets` array directly.
- `forkSession` - removed (was experimental).
- Apps using JWT-based custom auth providers must now explicitly configure wallet UIs in the dashboard or set `showWalletUIs`.

### Solana cluster config shape

```tsx
// v1
fundWallet({address, cluster: {name: 'mainnet-beta', rpcUrl: '...'}});

// v2
<PrivyProvider config={{
  solanaClusters: [{name: 'mainnet-beta', rpcUrl: 'https://api.mainnet-beta.solana.com'}]
}}>
fundWallet({address, cluster: {name: 'mainnet-beta'}});
```

(This shape is itself replaced again in v3 - see below.)

## v2 -> v3 migration

Source: `migrating-to-3.0.md`. Install with `npm i @privy-io/react-auth@3`.

### New peer dependencies for Solana

Remove `@solana/web3.js` and `@solana/spl-token` as **Privy** peer deps. Install instead:
- `@solana/kit`
- `@solana-program/memo`
- `@solana-program/system`
- `@solana-program/token`

You can still keep `@solana/web3.js`/`@solana/spl-token` for **your own** code; v3 just stops requiring them as Privy peers. Apps that have already migrated to `@solana/kit` save the duplicated bundle weight.

Webpack note: if you bundle with webpack (not Turbopack/Vite), add the four `@solana-program/*` packages and `@solana/kit` to `externals` per the doc's Accordion. Vite handles this automatically.

### Solana RPC config replaces `solanaClusters`

```tsx
// v2
config: { solanaClusters: [{name: 'mainnet-beta', rpcUrl: '...'}] }

// v3
import {createSolanaRpc, createSolanaRpcSubscriptions} from '@solana/kit';
config: {
  solana: {
    rpcs: {
      'solana:mainnet': {
        rpc: createSolanaRpc('https://api.mainnet-beta.solana.com'),
        rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com'),
      },
    },
  },
}
```

### `useSolanaWallets` is split

```ts
// v2
const {ready, wallets, createWallet, exportWallet} = useSolanaWallets();

// v3
import {useWallets, useCreateWallet, useExportWallet} from '@privy-io/react-auth/solana';
const {ready, wallets} = useWallets();
const {createWallet} = useCreateWallet();
const {exportWallet} = useExportWallet();
```

`wallets[i]` is now a `ConnectedStandardSolanaWallet`:
- one wallet per account (no more "fan-out" multi-account objects)
- methods live on the wallet instance: `wallet.signMessage({message})`, `wallet.signTransaction({transaction, chain})`, `wallet.signAndSendTransaction({transaction, chain})`, `wallet.disconnect()`
- the underlying [Solana wallet standard](https://docs.phantom.com/developer-powertools/wallet-standard) wallet is at `wallet.standardWallet` (for icon/name)
- **`wallet.loginOrLink()` is removed** - replace with `useLoginWithSiws` / `useLinkWithSiws`:

```tsx
import {useLoginWithSiws} from '@privy-io/react-auth';
const {generateSiwsMessage, loginWithSiws} = useLoginWithSiws();
const message = await generateSiwsMessage({address: wallets[0].address});
const encoded = new TextEncoder().encode(message);
const {signature} = await wallets[0].signMessage({message: encoded});
await loginWithSiws({message: encoded, signature});
```

### `useSendTransaction` -> `useSignAndSendTransaction`

```ts
// v2
import {useSendTransaction} from '@privy-io/react-auth/solana';
const {sendTransaction} = useSendTransaction();

// v3
import {useSignAndSendTransaction} from '@privy-io/react-auth/solana';
const {signAndSendTransaction} = useSignAndSendTransaction();
```

All Solana RPC inputs are now `Uint8Array` (buffer-encoded transactions). Encode using `@solana/kit` or `@solana/web3.js` `.serialize()`.

### `fundWallet` interface unified

```tsx
// v2
await fundWallet('<address>', {amount: '1', asset: 'native-currency', chain: 'solana:devnet'});

// v3
await fundWallet({
  address: '<address>',
  options: {amount: '1', asset: 'SOL', chain: 'solana:devnet'},
});
```

Same shape for `useFundEthereumWallet`. Native-currency aliases are now explicit (`SOL`, `native-currency`).

### Removed in v3

| Removed | Replacement |
|---|---|
| `suggestedAddress` on `connectWallet` / `linkWallet` | use the `description` field |
| `detected_wallets` in `walletList` | split into `detected_ethereum_wallets` + `detected_solana_wallets` |
| Inline Moonpay config on `fundEvmWallet` | configure once in `PrivyProvider.config.fundingMethodConfig.moonpay` |
| `requireUserPasswordOnCreate` | removed entirely (recovery handled by `useSetWalletRecovery`) |
| `embeddedWallets.createOnLogin` (top level) | use `embeddedWallets.ethereum.createOnLogin` or `embeddedWallets.solana.createOnLogin` separately |
| `useLoginToFrame` | `useLoginToMiniApp` |
| `useSignAuthorization` | `useSign7702Authorization` |
| `useSetWalletPassword` | `useSetWalletRecovery` |
| `verifiedAt` on linked accounts | `firstVerifiedAt` and `latestVerifiedAt` (introduced in 1.61.0, deprecated through 2.x, removed in 3.0) |

## Server-auth rename (server-auth -> @privy-io/node)

Source: `migrating-from-server-auth.md`. The new package is a structural rewrite, not a drop-in replacement.

### Step 1 - Replace constructor signature

```ts
// old
import {PrivyClient} from '@privy-io/server-auth';
const privy = new PrivyClient('app-id', 'app-secret');

// new
import {PrivyClient} from '@privy-io/node';
const privy = new PrivyClient({appId: 'app-id', appSecret: 'app-secret'});
```

### Step 2 - Methods move to resource interfaces

`@privy-io/node` mirrors the REST API 1:1. Parameters now match API casing (`snake_case`), not camelCase.

| `@privy-io/server-auth` | `@privy-io/node` |
|---|---|
| `privy.importUser({linkedAccounts, wallets})` | `privy.users().create({linked_accounts, wallets})` |
| `privy.walletApi.createWallet` | `privy.wallets().create` |
| `privy.walletApi.rpc` | `privy.wallets().rpc` |
| `privy.walletApi.ethereum.signMessage` | `privy.wallets().ethereum().signMessage` |
| `privy.walletApi.createPolicy` | `privy.policies().create` |
| `privy.getUserByEmail` | `privy.users().getByEmailAddress` |

### Step 3 - Authorization signatures via `AuthorizationContext`

```ts
// old - mutate client state
privy.walletApi.updateAuthorizationKey('priv-key');

// new - pass per-request context
import {AuthorizationContext} from '@privy-io/node';
const ctx: AuthorizationContext = {
  authorization_private_keys: ['priv-key'],
  // can combine with user JWTs:
  user_jwts: ['<jwt>'],
};
await privy.wallets().rpc(walletId, body, {authorizationContext: ctx});
```

Per-call context lets you mix authorization keys with user JWTs for resources owned by both a service and a user. `privy.walletApi.generateUserSigner` is removed - just put the JWT in `user_jwts` and the SDK manages signers internally.

### Step 4 - Error handling

`@privy-io/server-auth` returned `null` on 404. `@privy-io/node` throws `NotFoundError`:

```ts
import {NotFoundError, PrivyClient} from '@privy-io/node';
try {
  const user = await privy.users().getByEmailAddress({address: 'x@y.com'});
} catch (err) {
  if (err instanceof NotFoundError) {
    // handle missing
  } else throw err;
}
```

### Runtime support

`@privy-io/node` works on Node 20 LTS+, Deno 1.28+, Bun 1.0+, Cloudflare Workers, Vercel Edge Runtime, and Nitro 2.6+. Same surface as `server-auth` plus edge runtimes.

## Changelog highlights

### React-auth (`@privy-io/react-auth`)

**3.26.x (latest patch line)**
- `usePrivy` now returns `error` on initialization failures
- internal `@privy-io/js-sdk-core` 0.64.0

**3.25.0** - Added headless `useLinkEmail`, `useLinkPhone`, `useLinkWithOAuth` hooks for fully whitelabel link flows.

**3.24.0** - Added `config.scriptNonce` for CSP. Biconomy Nexus smart-account support. Optional `name` parameter for passkey link flows.

**3.21.0** - `useAcceptTerms` hook for whitelabel ToS acceptance without using Privy's modal.

**3.20.0** - `defaultSolanaRpcsPlugin` for plug-and-play Solana RPCs. `emailDomain` config.

**3.18.0** - Telegram authentication method generally available. Farcaster Solana wallet integration. Auto-connect MetaMask Solana wallet.

**3.17.0** - `linkOAuth` and `unlinkOAuth` for additional providers.

**3.16.0** - `useCreateWallet` accepts `additionalSigners`. Do not auto-create a wallet if the user has imported wallets. (This is the version Spectre is on.)

**3.14.0** - cross-tab-sync plugin (`createCrossTabSyncPlugin`) for syncing auth state across tabs. HyperEVM USDC funding.

**3.10.x** - `loginMethodsAndOrder` marked deprecated (use `loginMethods` again, but with cross-app support added).

**3.0.0** (breaking - see v3 migration above) - Solana surface area rewrite.

**2.25.0** - `useLoginWithSiws` token storage fix, base account wallet list entry, headless `oauth` linking fix.

**2.23.0** - `useLoginWithSiws` / `useLinkWithSiws` introduced for SIWS auth.

**2.22.0** - `ConnectedStandardSolanaWallet` introduced + `useConnectedStandardSolanaWallets` hook. `ConnectedSolanaWallet`, `useSolanaWallets`, `useStandardSolanaWallets` all deprecated (precursor to v3 removal).

**2.21.0** - `useMigrateWallets` for TEE migration. `useLoginToFrame` -> `useLoginToMiniApp` rename (deprecation warning; removed in v3).

**2.5.0** (breaking) - Session forking removed. `signAllTransactions` added for Solana. `SignerAccount` on user object.

**2.0.0** (breaking - see v2 migration above) - callback objects, method signature rewrites, Solana entrypoint split.

**1.99.0** - signup with passkey. `useIdentityToken` hook.

**1.78.x** - Solana wallet removed on logout. Telegram + Farcaster linking.

**1.77.0** - guest accounts.

**1.76.0** - Coinbase Onramp funding option.

**1.74.0** (breaking) - `PrivyProvider.onSuccess` deprecated (removed in 2.0).

**1.73.1** (breaking) - WalletConnect fallback removed when `externalWallets.walletConnect.enabled=false`.

**1.64.0** - Instagram added to `loginMethods`.

**1.62.0** - Google Drive as embedded wallet recovery option.

**1.61.0** (breaking) - `verifiedAt` deprecated, replaced by `firstVerifiedAt`/`latestVerifiedAt` (removed in 3.0).

**1.60.0** (breaking) - Login with passkey GA.

**1.49.0** - new login modal UI.

**1.47.0** (breaking) - TOTP MFA support. Create-external-wallet prompt removed.

**1.43.0** - `supportedChains` + `defaultChain` API.

**1.41.0** - LinkedIn OAuth.

**1.39.0** - `setWalletPassword` for existing wallets (renamed to `setWalletRecovery` later; removed in 3.0).

**1.31.0** (breaking) - iframe message target removed.

**1.30.0** (breaking) - `AbortSignal.timeout` dropped for iOS <16 compat. Headless `sendTransaction`. `eth_signTypedData_v4` for embedded wallets.

**1.28.0** - WalletConnect v1 -> v2 migration. Celo / FVM / Base testnet support.

**1.26.0** (breaking) - `setActiveWallet`, `getEthereumProvider`, `getEthersProvider`, `getWeb3jsProvider` deprecated. New `wallets` array interface (removed in 2.0).

**1.24.0** - EIP-1193 provider for embedded wallets. Preliminary cookie support.

**1.20.3** (breaking) - layout shift removed from embedded wallet iframe.

**1.19.0** - dark mode and theming config.

**1.16.0** - **embedded wallets released**.

### NodeJS server SDK (`@privy-io/node`)

**0.18.0** - `requestExpiry` config (replaces `defaultRequestExpiryMs` / `disableRequestExpiry`). Default expiry for intents endpoints jumped 15 min -> **72 hours** (breaking).

**0.17.0** - `disableRequestExpiry` option. `sendCalls` support for Ethereum. `PrivyWebhooksService.verify()` with svix signature verification. Idempotency header for earn methods. Environment-variable-driven request headers.

**0.16.0** - API updates.

**0.15.0** - `transfer` convenience method. `earn.ethereum.{deposit, withdraw, incentive.claim}` shortcuts.

**0.14.0** - `getWalletByAddress` lookup. `emailDomain` allowlist entries. `bitcoin-taproot` chain type. Schnorr signing.

**0.13.0** - `IntentService` (`privy.intents`) for manual approval workflows. `exportPrivateKey` and `exportSeedPhrase` convenience methods.

**0.12.0** (breaking) - all authorized requests now carry `privy-request-expiry` (default 15 min - changed again in 0.18). `KeyQuorumDeleteResponse` / `PolicyDeleteResponse` removed in favor of `SuccessResponse`. RPC response types flattened.

**0.11.0** (breaking) - `'privy-idempotency-key'` parameter removed from `create()` calls (use `idempotency_key` body field). `apps` resource introduced. `apps().getSettings`, `inviteToAllowlist`, `getTestAccessToken`.

**0.10.0** - `signUserOperation` utility. `LinkedAccount` type exposed.

**0.9.0** - x402 payment methods.

**0.8.0** (breaking) - `LinkedAccountCustomOAuth.type` guaranteed present. **EIP-7702 support** added (transaction type 4 + `authorization_list`). `eurc`/`usdb` asset types.

**0.7.0** - `createSolanaKitSigner` for `@solana/kit` signers. `verifyAuthToken` deprecated -> `verifyAccessToken`.

**0.6.0** - Tron policies. `eth_signUserOperation` policy support. Transaction queries expanded to Ethereum / Arbitrum / Linea / Optimism / Polygon.

**0.5.0** (breaking) - RPC response types flattened (no longer nested under `WalletRpcResponse`). Passkey accounts on identity tokens. `AuthorizationContext` updated for multi-JWT signing.

**0.3.0** - webhook signature verification.

**0.1.0** - initial release.

## Future-looking signals

From the changelog and `product-updates.md`:

- **Earn** (yield) endpoints are now first-class on the Node SDK (`earn.ethereum.deposit/withdraw/incentive.claim`). Solana via Kamino is coming.
- **Native swaps** are public on EVM, with `swap-with-0x.md`, `bebop-swap-guide.md`, `Swap.md` documenting the surface. Solana swaps via Privy's API are not yet GA - Spectre still uses Jupiter directly client-side.
- **Custodial wallets** ship for USDC/USDB/EURC on Solana (Apr 2026). Not used by Spectre yet.
- **Stateful policies** + **manual approvals** + **nested key quorums** are the policy-engine future. Spectre's non-custodial stance means we will not adopt any of these unless Privy ever offers them for embedded wallets (currently they are server-only).
- **EIP-7702 (Type 4)** is GA on react-auth (`useSign7702Authorization`) and node (transaction type 4 / `authorization_list`).
- **Flexible custody** is in private beta - watch for GA before considering custodial paths.
- **MCP server** (`https://docs.privy.io/mcp`) and **Agent Skill** (`npx skills add https://docs.privy.io`) are the recommended ways to wire Privy docs into Cursor / Claude Desktop / Claude Code. The skill auto-loads when working on auth/wallet/blockchain code.
- Beta/experimental tags still in the docs as of this writing: `useExperimentalFarcasterSigner` (deprecated and renamed to `useFarcasterSigner` in 1.73.2), `externalWalletConfig.walletConnect.enabled` (experimental in 1.73.0).

## Spectre-specific notes

### Current state (verified at `apps/*/package.json`)

| App | `@privy-io/react-auth` | `@privy-io/node` | `@privy-io/server-auth` | Solana peer deps |
|---|---|---|---|---|
| `apps/research` | `^3.16.0` | `^0.16.0` | not installed | `@solana-program/{memo,system,token}` + `@solana/{web3.js,spl-token}` |
| `apps/trading` | `^3.16.0` | `^0.16.0` | `^1.18.0` (still installed) | `@solana/{web3.js,spl-token}` only |

### Login config drift

Confirmed at `apps/research/src/lib/privy-config.js` and `apps/trading/src/lib/privy-config.js`:

- **research** uses the v2-era `loginMethodsAndOrder` (the doc property that was added in 1.49 and marked **deprecated** as of 3.10).
- **trading** uses the v1-era `loginMethods` array (still supported in 3.x but no longer the recommended shape).

`apps/trading/CLAUDE.md` line 89 explicitly says `v1 loginMethods - intentional, do not upgrade without testing Solana wallet flow`. The intent is correct: both shapes still work in 3.x. But the underlying SDK versions are already on v3, so the labels in `CLAUDE.md` calling research "v2" and trading "v1" describe the **config shape**, not the SDK version. The SDK versions are aligned at `^3.16.0`. This is misleading and should be reworded in the trading-app CLAUDE.md.

### Recommended migration order

1. **Bump both apps to `@privy-io/react-auth@^3.26.1`** in lockstep (currently both are `^3.16.0`, so this is a patch-line bump within v3 - no breaking changes, only adds `error` on `usePrivy`, headless link hooks, and CSP nonce support).
2. **Re-test login UX on both apps** - because 3.10 added deprecation warning for `loginMethodsAndOrder`, the research app may start logging warnings. The shape still works; just decide whether to:
   - keep `loginMethodsAndOrder` (deprecated but functional)
   - or migrate research to the cross-app-supporting `loginMethods` array (added in 3.9)
3. **Standardize trading's config shape** to whichever shape research uses (after step 2). Both apps should share the same login config layout to make it easier for one engineer to debug.
4. **Re-test wallet config**:
   - both apps already use `embeddedWallets.solana.createOnLogin` (the v3 shape)
   - verify `solana.rpcs` is present on both (the v3 shape) - it should be
5. **Remove `@privy-io/server-auth` from `apps/trading`** - it is installed (`^1.18.0`) but **no code references it**. See 08-server-sdk.md for the audit note. Cross-ref `spectre/audit-gaps.md`. The package is dead weight.
6. **Do not adopt `@privy-io/node` server features past 0.16.0 without re-reading 0.17.0 and 0.18.0 breaking notes** - 0.18 changed default request expiry for intent endpoints from 15 min to 72 hours. If Spectre ever uses intents, we need to set `requestExpiry: {defaultIntentMs: 15 * 60 * 1000}` to preserve the old behavior.

### Cross-reference 08-server-sdk.md

`08-server-sdk.md` (in this knowledge folder) flags that **no server code in Spectre actually uses `@privy-io/server-auth`** despite the package being a trading-app dependency. The migration from `server-auth` to `@privy-io/node` is therefore a **no-op in code** - we just need to remove the unused package. There is no `PrivyClient` import to rewrite.

`@privy-io/node@0.16.0` is installed in both apps but Spectre's actual usage is limited to JWT verification through Vercel's edge runtime (see `apps/*/api/_lib/auth.js`). We are not on the latest 0.18.0, but the 0.17->0.18 deltas (sendCalls, webhook verify, request-expiry refactor) do not affect our JWT-only usage.

## Gotchas during migration

- **Hook signatures change between versions even within a "non-breaking" range.** `useFundWallet` for Solana was renamed `useFundWallet` in `@privy-io/react-auth/solana` (different module, same hook name as the EVM one - they coexist). Don't grep blindly.
- **Provider config shape mutates.** `embeddedWallets.createOnLogin` (v2) is gone in v3 - now `embeddedWallets.ethereum.createOnLogin` and `embeddedWallets.solana.createOnLogin` are separate. A monorepo can easily have one app on the old shape and another on the new shape; both will run, but a `createOnLogin: 'all-users'` typo at the wrong level silently no-ops.
- **Monorepo lockstep is mandatory for `@privy-io/react-auth`.** The js-sdk-core (`@privy-io/js-sdk-core`) is internal and gets pinned by each react-auth release. If research is on 3.16 and trading is on 3.26, npm dedupe may not consolidate them and you can end up with two iframe instances trying to claim the same `window.privy` global.
- **React peer dep range.** react-auth 3.x requires React 18+. Both apps are on React 18, so this is fine; just be aware before any future React 19 bump.
- **Vite version transitive deps.** Privy depends on `viem` (currently 2.47.x as of 3.22). Vite 5's bundler handles this, but the `lucide` icon library bump in 3.8 (from 0.383 to 0.554) can clash with `lucide-react` in the trading app.
- **WalletConnect v1 -> v2.** Forced in `react-auth@1.28.0`. Long since done for Spectre (we are on 3.x), but historical: any code referencing `@walletconnect/client` v1 will break.
- **PEER deps for Solana switch at v3.** v2 wanted `@solana/web3.js` + `@solana/spl-token`. v3 wants the `@solana/kit` + `@solana-program/*` quartet. Both apps still ship `@solana/web3.js` and `@solana/spl-token` for their own code (Jupiter swap construction needs `web3.js` `VersionedTransaction`). That is fine - just confirm that on v3 they are no longer "peers of Privy" and pure app deps.
- **`loginMethodsAndOrder` deprecation in 3.10** issues a console warning. The deprecation is soft (the property still works), so it will not break the build, but it pollutes the console.
- **Solana `useSendTransaction` was renamed to `useSignAndSendTransaction` in 3.0.** Spectre's swap execution uses the lower-level wallet methods (`wallet.signAndSendTransaction({transaction, chain})`), so we are unaffected, but any direct calls to `useSendTransaction()` from a Solana entrypoint need updating.
- **`@privy-io/node` 0.12.0** introduced `privy-request-expiry` headers by default. If you call Privy server APIs from a long-running queue (delayed > 15 min), prior to 0.12 those requests would succeed but post-0.12 they will be rejected. 0.18.0 fixed this for intent endpoints (now 72h default), but other endpoints stayed at 15 min unless overridden.
- **MCP server URL is `https://docs.privy.io/mcp`.** Worth adding to Spectre's `.mcp.json` so Claude Code gets live doc search instead of relying on this snapshot.

## Cross-references

- `spectre/audit-gaps.md` - identifies that `@privy-io/server-auth` in `apps/trading/package.json` is unused dead weight; this migration file confirms it can be removed without code changes.
- `08-server-sdk.md` - canonical reference for what Spectre actually does server-side with Privy (JWT verification only); cross-check the "no PrivyClient imports" claim against the `server-auth` -> `@privy-io/node` migration story.
- `01-auth-and-identity.md` - login methods, OAuth providers, SIWS/SIWE - the `loginMethods` vs `loginMethodsAndOrder` drift discussed above is the operational consequence of the changelog timeline summarized here.
- `09-ui-and-customization.md` - `appearance.walletList`, `landingHeader`, theming - the wallet-list breaking changes in v3 (`detected_wallets` split into `detected_ethereum_wallets` / `detected_solana_wallets`) belong with that file's content.
- `03-solana-integration.md` - the Solana v3 migration (peer deps, `useWallets` / `useSignAndSendTransaction`, RPC config shape) is described in detail here; that file documents what Spectre does today against those APIs.
- `02-embedded-wallets.md` - `embeddedWallets.{ethereum,solana}.createOnLogin` per-chain split is a v3 breaking change; that file should reflect the v3 shape only.
- `10-wallet-controls-and-authorization.md` - `AuthorizationContext` from `@privy-io/node` is the post-server-auth way to handle per-request auth; relevant when we ever go beyond JWT verification.
