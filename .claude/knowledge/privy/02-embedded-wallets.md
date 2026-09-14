---
description: Privy embedded wallets reference (creation, types, custody models, wallet list config). Synthesized from official docs.
---

# Privy Embedded Wallets

## Source docs synthesized

Pulled from `C:\Users\worka\OneDrive\Desktop\Privy\`:

- `Wallets Overview.md` - top-level wallet infrastructure intro
- `Types of Wallets.md` - taxonomy of embedded, external, and digital asset accounts
- `Key Concepts.md` - auth + wallets + controls 3-layer model
- `Flixible Custody.md` - flexible custody continuum
- `Common Use Cases.md` - user, business, agentic wallet patterns
- `Features.md` - cross-chain, transaction controls, policy engine
- `automatic-wallet-creation.md` - `createOnLogin` policies for ETH and Solana
- `standard-wallets.md` - Solana wallet standard integration
- `business-wallets.md` - key quorum + policy recipe
- `treasury-overview.md` - treasury wallets architecture
- `wallet-infrastructure.md` - dual-approval (server + human) treasury recipe
- `execution-wallets.md` - EIP-7702 execution fleets
- `wallet-list-configurations.md` - 8 walletList recipes and chain config
- `manage-wallet-UIs.md` - `showWalletUIs` config (global + per-call)
- `Setup.md` - swap setup (Dashboard toggles, gas, protocol, routing)
- `getting-started-with-privy-and-solana.md` - end-to-end Solana provider config
- `execute.md` - swap REST API surface
- `assign.md` - assigning owners to resources
- `configure-signers.md` - signer configuration prerequisites
- `direct-implementation.md` - request-signing primitives (P-256 ECDSA)
- `create.md` - create a key quorum (Dashboard + SDKs + REST)
- `overview (2).md` - owner/signer model
- `overview (3).md` - owner vs signer permission matrix
- `overview (4).md` - common self-custodial user wallet flows
- `overview (7).md` - signer overview (offline / recurring / scoped / delegated)
- `troubleshooting-embedded-wallets.md` - HTTPS requirement, Base RPC CORS
- `Wallet Actions.md` - wallet action API lifecycle (transfer, swap, earn)

## Core concepts

### Wallet types at a glance

Privy splits wallets into four conceptual buckets. The first two are the load-bearing categories for almost every app build.

- **Embedded wallets** - created and managed by Privy's infrastructure, signed inside Privy's TEE. They can be configured as non-custodial (user-owned, keys never leave the secure enclave) or custodial (owned by your app / key quorum). Best for consumer onboarding and seamless UX. Quoting `Types of Wallets.md`:

  > Privy's embedded wallet system lets you build wallets directly into your app whether you're building self-custodial wallets for your users or a wallet fleet you control... Embedded wallets can be configured as non-custodial or custodial.

- **External wallets** - third-party clients like MetaMask, Phantom, Rainbow, Backpack. All browser extensions, hardware wallets, and mobile app wallets fall in this category. Best for power users who already have a wallet they want to bring. Connected via `useConnectWallet()` or library integrations (`wagmi`, `viem`, `@solana/web3.js`).

- **Smart wallets / EIP-7702 upgraded wallets** - any Privy EOA upgraded to a smart account via EIP-7702. Used for batched transactions, gas sponsorship without working balance, and execution fleets that operate in parallel without nonce contention.

- **Server wallets** - Privy wallets owned by authorization keys (not users). Controlled exclusively from your backend via the `@privy-io/server-auth` SDK. Used for treasury, trading bots, and agent wallets.

A fifth concept, **Digital asset accounts**, is a higher-level abstraction in private beta that groups multiple embedded wallets (EVM, SVM, BTC, custodial, non-custodial) under one unit of balance. Not relevant for our current Spectre build.

### When to use each

| Wallet kind | Custody | Use case |
| --- | --- | --- |
| Embedded (client-only) | User holds keys in TEE | Most consumer apps - default for Spectre |
| Embedded (server-signed) | Server holds keys via authorization key | Trading bots, agentic wallets |
| Embedded (key quorum owned) | m-of-n quorum signs | Treasury, business wallets, dual approval |
| External | User's wallet client | Crypto-native users with existing wallets |
| EIP-7702 smart account | Same as underlying EOA | Batched txns, gas sponsorship, fleets |

### Custody models

Privy supports a continuum. From `Flixible Custody.md`:

> Privy wallets support flexible custody options and can be operated under different models:
> - Non-custodial wallets ensure end users retain ultimate control of their private keys.
> - Developer-controlled wallets enable organizations to securely manage their treasury or run onchain infrastructure at scale.
> - Custodial wallets are backed by licensed providers that meet specific compliance or operational requirements.
>
> Blended configurations (such as a non-custodial wallet granting signing permission to the developer) are also possible. This flexibility enables developers to tailor custody to the operational, regulatory, and risk requirements of their products and users. Concretely, this means you can serve custodial and non-custodial experiences side-by-side within a single application, all with one API.

The four canonical wallet-control models from `Key Concepts.md`:

- **Model 1: User-owned** - user has full control, keys only accessible to user. Self-custodial consumer wallets.
- **Model 2: User-owned with server access** - user keeps ownership, server gets scoped signer permissions. Used for limit orders, portfolio rebalancing, recurring actions, agentic flows.
- **Model 3: Application-owned** - application has full control via authorization keys. Treasury, trading bots, agent wallets.
- **Model 4: Custodial wallets** - third-party licensed custodian operates the wallet on behalf of the beneficiary. All transactions approved by custodian. FBO (For Benefit Of) banking-style accounts.

### One wallet per chain per user

Each chain type (Ethereum, Solana) creates one embedded wallet per user by default. To create additional HD wallets on the same chain, pass `createAdditional: true` to `createWallet({ createAdditional: true })`. Different chains live as independent wallets, each with their own address.

### Auto-creation policies

`createOnLogin` accepts three values per chain. Defaults to `'off'`.

- `'all-users'` - create a wallet for every user on login, even if they already have a linked external wallet.
- `'users-without-wallets'` - create a wallet only for users with no existing wallet (embedded or external). This is the sane default.
- `'off'` - never auto-create. App is responsible for calling `createWallet()` manually.

The docs also reference `'all-users-on-mobile'` patterns in the wider Privy literature, but the canonical schema in `automatic-wallet-creation.md` lists only the three above. Privy mobile SDKs handle mobile-specific gating through their own configs.

Important caveats from `automatic-wallet-creation.md`:

> Automatic embedded wallet creation is currently not supported if your app uses Privy's whitelabel login interfaces. If this is the case for your app, you must manually create embedded wallets for your users at the desired point in your onboarding flow.
>
> Automatic wallet creation only applies to login via the Privy modal and not from whitelabel login methods. It does not trigger wallet creation for users who authenticate through direct login methods like loginWithCode, useLoginWithOAuth, or similar custom flows.

## API surface (React SDK)

The React SDK lives in `@privy-io/react-auth` (EVM by default) and `@privy-io/react-auth/solana` (Solana extension).

### `useWallets()`

Returns `{ ready, wallets }` for Ethereum-side wallets, plus connected external EVM wallets.

Wallet object shape (most-used fields):

- `address` - hex string for EVM, base58 for Solana
- `chainType` - `'ethereum'` or `'solana'`
- `walletClientType` - identifier like `'privy'` (embedded), `'metamask'`, `'phantom'`, `'coinbase_wallet'`, `'rainbow'`, `'wallet_connect'`
- `connectorType` - `'embedded'`, `'injected'`, `'coinbase_wallet'`, `'wallet_connect'`, `'safe'`
- `getEthereumProvider()` - returns an EIP-1193 provider for the wallet
- `getEthersProvider()` - returns an ethers v5 BrowserProvider wrapping the EIP-1193 provider
- `getWeb3jsProvider()` - Solana-only; returns a `@solana/web3.js` connection / signer adapter
- `disconnect()`, `switchChain(chainId)` - control methods on EVM wallets

The array is **async-updated after login** - the first render after `authenticated` flips true will still see an empty `wallets`. Always gate downstream rendering on `ready === true`.

### `useCreateWallet()` (EVM)

```tsx
import { useCreateWallet } from '@privy-io/react-auth';

const { createWallet } = useCreateWallet();
const handleClick = async () => {
  const wallet = await createWallet();
  console.log('Created:', wallet.address);
};
```

`createWallet({ createAdditional: true })` lets you create a second HD wallet for a user.

### `useCreateWallet()` and `useWallets()` (Solana)

From `getting-started-with-privy-and-solana.md`:

```tsx
import { useWallets, useCreateWallet } from '@privy-io/react-auth/solana';

export function CreateWalletButton(props: { createAdditional: boolean }) {
  const { ready } = useWallets();
  const { createWallet } = useCreateWallet();

  if (!ready) {
    return <div>Loading...</div>;
  }

  const handleCreateWallet = async () => {
    try {
      const wallet = await createWallet({ createAdditional: props.createAdditional });
      console.log('Embedded wallet created:', wallet);
    } catch (error) {
      console.error('Error creating embedded wallet:', error);
    }
  };

  return <button onClick={handleCreateWallet}>Create Embedded Wallet</button>;
}
```

`useWallets()` from `@privy-io/react-auth/solana` returns both Privy embedded Solana wallets and connected EOA Solana wallets. To isolate the embedded one:

```tsx
const wallet = wallets.find((w) => w.standardWallet.name === 'Privy');
```

### `useConnectWallet()`

Opens the connect-wallet modal for linking an external wallet (or upgrading the wallet picker mid-session). Accepts a runtime override:

```tsx
const { connectWallet } = usePrivy();
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

connectWallet({
  walletList: isMobile
    ? ['metamask', 'phantom', 'rainbow', 'coinbase_wallet']
    : ['metamask', 'rainbow', 'coinbase_wallet', 'detected_ethereum_wallets', 'wallet_connect_qr']
});
```

This `walletList` overrides the global one for this single open.

### `useFundWallet()`

Returns `{ fundWallet }` for opening the Privy funding modal (card / exchange / bridge transfer). Configured via the global `fundingMethodsAndOrder` block on `PrivyProvider`. Funding deep dive lives in the dedicated knowledge file.

### `useExportWallet()`

```tsx
const { exportWallet } = useExportWallet();
await exportWallet();
```

Opens the Privy iframe modal that surfaces the user's embedded wallet private key. Privy embedded keys are split via MPC inside the TEE, so the user is the only entity who can authorize export. We do not yet wire this up in Spectre - see Spectre-specific notes below.

### `useSolanaWallets()`

Older alias used in some docs - the modern hook is `useWallets()` imported from `@privy-io/react-auth/solana`. Same shape: `{ ready, wallets }` where each wallet has `address`, `standardWallet`, sign methods.

### `useLinkAccount()` / `useUnlinkWallet()`

Link or detach an external wallet (or any other account type - email, phone, OAuth) from the current Privy user. `useLinkAccount` opens the link UI, `useUnlinkWallet` takes a wallet address and removes the linkage.

### Solana standard wallets (`useSolanaStandardWallets`)

The Solana wallet standard surface from `standard-wallets.md`. Returns wallets that implement the standard interface (Phantom, Solflare, Backpack, Privy itself when registered).

```typescript
import { useSolanaStandardWallets, type SolanaStandardWallet } from '@privy-io/react-auth/solana';

function WalletComponent() {
  const { ready, wallets } = useSolanaStandardWallets();

  const connect = (wallet: SolanaStandardWallet) =>
    wallet.features['standard:connect']!.connect();
  const disconnect = (wallet: SolanaStandardWallet) =>
    wallet.features['standard:disconnect']!.disconnect();

  const signMessage = async (
    wallet: SolanaStandardWallet,
    address: string,
    message: Uint8Array
  ) => {
    const account = wallet.accounts.find((a) => a.address === address)!;
    const [result] = await wallet.features['solana:signMessage']!.signMessage({
      account,
      message
    });
    return result;
  };

  const signTransaction = async (
    wallet: SolanaStandardWallet,
    address: string,
    transaction: Uint8Array
  ) => {
    const account = wallet.accounts.find((a) => a.address === address)!;
    const [result] = await wallet.features['solana:signTransaction']!.signTransaction({
      transaction,
      chain: 'solana:devnet',
      account
    });
    return result;
  };

  const signAndSendTransaction = async (
    wallet: SolanaStandardWallet,
    address: string,
    transaction: Uint8Array
  ) => {
    const account = wallet.accounts.find((a) => a.address === address)!;
    return wallet.features['solana:signAndSendTransaction']!.signAndSendTransaction({
      transaction,
      chain: 'solana:devnet',
      account
    });
  };
}
```

Standard wallet features map to a fixed namespace:

- `standard:connect` / `standard:disconnect`
- `solana:signMessage`
- `solana:signTransaction`
- `solana:signAndSendTransaction`

Registering the Privy embedded wallet with the window object lets other Solana apps detect it as a standard wallet:

```typescript
registerWallet(wallets.find((wallet) => wallet.name === 'Privy' && 'privy:' in wallet.features));
```

## Config: `embeddedWallets` block

Full schema (from `automatic-wallet-creation.md`, `manage-wallet-UIs.md`, and `getting-started-with-privy-and-solana.md`):

```tsx
<PrivyProvider
  appId="your-privy-app-id"
  config={{
    embeddedWallets: {
      createOnLogin: 'users-without-wallets', // top-level shorthand for EVM
      ethereum: {
        createOnLogin: 'all-users' | 'users-without-wallets' | 'off',
      },
      solana: {
        createOnLogin: 'all-users' | 'users-without-wallets' | 'off',
      },
      requireUserPasswordOnCreate: false,
      priceDisplay: { primary: 'fiat-currency', secondary: 'native-token' },
      noPromptOnSignature: false,
      showWalletUIs: true, // toggles wallet confirmation modals globally
    },
  }}
>
  {children}
</PrivyProvider>
```

Field meanings:

- `createOnLogin` (top-level) - legacy shorthand applied only to Ethereum wallets. Prefer the per-chain forms (`ethereum.createOnLogin`, `solana.createOnLogin`).
- `ethereum.createOnLogin` - EVM wallet auto-creation policy. `'all-users' | 'users-without-wallets' | 'off'`. Default `'off'`.
- `solana.createOnLogin` - Solana wallet auto-creation policy. Same enum. Default `'off'`.
- `requireUserPasswordOnCreate` - boolean. If true, prompts the user to set a recovery password during wallet creation. Adds friction but enables the password-based recovery path.
- `priceDisplay` - object configuring how token amounts are formatted in Privy UIs. `primary` and `secondary` accept `'fiat-currency'` or `'native-token'`.
- `noPromptOnSignature` - boolean. When true and the user is using an embedded wallet, suppresses the per-signature confirmation. Use only for high-trust flows (autosigning AMM swaps inside your own app). Equivalent of pre-approving signatures.
- `showWalletUIs` - boolean. When false, Privy will not render any wallet confirmation modal for sign or send operations. Can be overridden per-call via `uiOptions.showWalletUIs` on `signMessage`, `signTransaction`, `signTypedData`, `sendTransaction`, `signAndSendTransaction`. Overrides the dashboard setting.

The Privy Dashboard has a counterpart toggle at **Configuration > Authentication > Advanced > Disable confirmation modals** that applies the same setting app-wide. `showWalletUIs` in the provider config overrides Dashboard config; per-call `uiOptions.showWalletUIs` overrides the provider config.

## Wallet list customization

The `appearance.walletList` array controls which wallet options appear in Privy's connection modal and in what order. The full reference is in `wallet-list-configurations.md`.

Valid entries (from Privy's `WalletListEntry` TS union):

- **Auto-detection bundles** - `detected_wallets`, `detected_ethereum_wallets`, `detected_solana_wallets`. Privy enumerates browser extensions at runtime via EIP-6963 (EVM) and Solana wallet standard, then adds buttons for each.
- **Named EVM connectors** - `metamask`, `coinbase_wallet`, `rainbow`, `zerion`, `safe`, `okx_wallet`
- **Named Solana connectors** - `phantom`, `solflare`, `backpack`
- **WalletConnect entries** - `wallet_connect` (renders 100+ wallets from the WC registry as searchable list), `wallet_connect_qr` (renders single QR for EVM), `wallet_connect_qr_solana` (single QR for Solana)
- **Other** - `binance` exists in the TS union but Privy silently drops it at runtime (asset missing). Binance Web3 Wallet users connect through `wallet_connect` instead.

`walletChainType` controls which chain families are exposed:

- `'ethereum-only'` - default. Solana wallets are hidden even if listed.
- `'solana-only'` - only Solana wallets shown.
- `'ethereum-and-solana'` - both shown. Privy adds a "Solana" badge to Solana wallets for disambiguation.

To enable Solana detection, you must also wire up `externalWallets.solana.connectors`:

```tsx
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';

const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: true
});

<PrivyProvider
  appId="your-app-id"
  config={{
    appearance: {
      walletList: ['phantom', 'solflare', 'backpack', 'detected_solana_wallets'],
      walletChainType: 'solana-only',
    },
    externalWallets: {
      solana: { connectors: solanaConnectors },
    },
  }}
>
  {children}
</PrivyProvider>;
```

### Detection rules

- Browser extensions: detected at runtime in desktop browsers. EVM extensions via EIP-6963 multi-wallet announcement, Solana via wallet standard registration.
- Mobile web: extensions are NOT injected, so `detected_*` entries render empty. Use specific wallet names (`'metamask'`, `'phantom'`) which trigger deep-link "Open in Wallet" buttons.
- In-app browsers (Phantom, Backpack, OKX, Solflare, Jupiter): the wallet is auto-detected and prioritized. No extra config needed - the wallet floats to position 1 regardless of `walletList` order.

### WalletConnect setup

Configure WalletConnect project ID at the Privy Dashboard under **Login Methods > Wallets**. Without a valid project ID, `wallet_connect` and `wallet_connect_qr` entries render but fail to open.

## Types of wallets deep dive

### Standard (consumer) wallets

The default user wallet shipped by Privy. Created via `createOnLogin: 'users-without-wallets'` or `useCreateWallet()`. Owned by the user, signed inside the TEE, secured by passkey or password recovery.

Capabilities:

- Sign messages (`personal_sign`, `eth_signTypedData_v4`, Solana `signMessage`)
- Sign and send transactions
- Export private key (user-initiated)
- Optionally delegate signing to your server via a signer

### Business wallets

Wallets owned by a key quorum that requires m-of-n authorization signatures for actions. Recipe from `business-wallets.md`:

1. Create authorization keys (P-256 keypairs) in the Privy Dashboard. Save the private keys; Privy never sees them.
2. Register the authorization keys in a key quorum with `authorization_threshold = m`.
3. Define a policy (transfer limits, allowlists, time-bound signers).
4. Create the wallet with `owner_id = keyQuorumId` and `policy_ids = [policyId]`.
5. When acting on the wallet, sign requests with m-of-n keys and put signatures in the `privy-authorization-signature` header.

### Treasury wallets

Same primitives as business wallets, layered with a dual-approval pattern. From `treasury-overview.md`:

> Automated operations with human escalation: programmatic execution for routine transactions, with key quorum sign-off for sensitive actions.
> Multi-party treasury management: distributed control with m-of-n authorization and policy constraints.
> High-throughput protocol execution: parallel wallet fleets for fast onchain execution.

The dual-approval pattern (from `wallet-infrastructure.md`):

- **Owner** is a human key quorum, subject to `policy_ids`. Sensitive actions (large transfers, owner updates) require manual approval.
- **Additional signer** is a server-held authorization key, subject to `override_policy_ids`. Routine txns (small transfers, rebalancing) execute programmatically.

Same wallet, two paths, different constraints.

### Execution wallets

EOA wallets upgraded to smart accounts via EIP-7702. From `execution-wallets.md`:

> Execution wallets are Privy wallets upgraded via EIP-7702 to operate as smart accounts. Each wallet sits alongside external wallet providers, interacting with onchain protocols on behalf of the treasury. EIP-7702 enables batched transactions, so each execution wallet bundles multiple calls into a single transaction. A fleet of execution wallets operates in parallel - each with its own nonce - eliminating the sequential bottleneck that limits throughput in single-wallet custody setups.

Properties:

- Bot- or agent-owned, controlled by authorization key (or quorum)
- Treasury funds stay in upstream custody (e.g., Bridge)
- Execution wallet only acts on approved funds under policy constraints
- No working balance required - gas sponsored via EIP-7702 layer
- Fleet of N wallets gives N parallel nonces

Setup steps: create auth key, define policy, create wallet, upgrade via `sign7702Authorization`, send batched transactions.

## Custody model deep dive

### Client-only (default for consumer apps)

The standard embedded wallet flow. Private key shards live inside the user's browser via WebCrypto API + passkey storage, and inside Privy's TEE. The user is the sole owner; no external party (including Privy) can sign without the user's session.

Implications:

- Works only over HTTPS (or `localhost` for dev). HTTP deployments will silently fail to create wallets - WebCrypto refuses to operate in insecure contexts. From `troubleshooting-embedded-wallets.md`:

  > If you are able to successfully create embedded wallets for your users on localhost, but not in a deployed environment, double-check that the protocol for your deployment URL is https:// (secure), and not http://. Privy embedded wallets use the browser's native WebCrypto API, which is only available in secure contexts like https://.

- Loss of access (no passkey, no recovery password) = loss of funds. Privy cannot recover the wallet for the user.

### Server-side (server wallets / authorization-key-owned)

Wallet's owner is an authorization key held by your backend (`@privy-io/server-auth`). The user does not see the wallet and cannot sign for it. Used for treasury, trading bots, and agent flows.

Requests to act on the wallet must include a `privy-authorization-signature` header containing an ECDSA P-256 signature over the canonicalized request payload, generated with the authorization key's private key.

### Hybrid / key-quorum (m-of-n)

The most flexible model. The owner is a key quorum containing some combination of:

- User IDs (Privy users; their session signs)
- Authorization keys (your servers sign)
- Nested key quorums (one level deep)

You set `authorization_threshold = m` to require m of n signatures. Common patterns:

- **2-of-3 with user + server + recovery key** - user can authorize alone if they retain access; combined server + recovery can act if user is offline.
- **2-of-2 with two server keys held by different teams** - protects against single-team compromise.
- **3-of-5 admin board** - DAO-style governance.

### When to upgrade from client-only to key-quorum

- Treasury or large balances - add server-side recovery quorum
- Recurring server-driven actions (limit orders, sweeps) - add server as additional signer
- Multi-team / multi-region operations - replace single owner with key quorum
- Compliance requires manual approval for sensitive ops - add human-key-quorum owner with server-signer for routine actions (the dual-approval pattern)

## Code patterns (preserved verbatim from official docs)

### Auto-create embedded wallet on login (ETH + Solana)

From `automatic-wallet-creation.md`:

```tsx
<PrivyProvider
  appId="your-privy-app-id"
  config={{
    embeddedWallets: {
      ethereum: {
        createOnLogin: 'users-without-wallets',
      },
      solana: {
        createOnLogin: 'users-without-wallets',
      },
    },
  }}
>
  {children}
</PrivyProvider>
```

### Manually create embedded wallet on demand (Solana)

From `getting-started-with-privy-and-solana.md`:

```tsx
'use client';
import { useWallets, useCreateWallet } from '@privy-io/react-auth/solana';

export function CreateWalletButton(props: { createAdditional: boolean }) {
  const { ready } = useWallets();
  const { createWallet } = useCreateWallet();

  if (!ready) {
    return <div>Loading...</div>;
  }

  const handleCreateWallet = async () => {
    try {
      const wallet = await createWallet({ createAdditional: props.createAdditional });
      console.log('Embedded wallet created:', wallet);
    } catch (error) {
      console.error('Error creating embedded wallet:', error);
    }
  };

  return <button onClick={handleCreateWallet}>Create Embedded Wallet</button>;
}
```

### Connect external wallet (cross-platform runtime override)

From `wallet-list-configurations.md`:

```tsx
const { connectWallet } = usePrivy();
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

const openWalletModal = () => {
  connectWallet({
    walletList: isMobile
      ? ['metamask', 'phantom', 'rainbow', 'coinbase_wallet']
      : ['metamask', 'rainbow', 'coinbase_wallet', 'detected_ethereum_wallets', 'wallet_connect_qr']
  });
};
```

### Multi-chain wallet list (ETH + Solana in one modal)

```tsx
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';

const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: true
});

<PrivyProvider
  appId="your-app-id"
  config={{
    appearance: {
      walletList: [
        'phantom',
        'metamask',
        'solflare',
        'coinbase_wallet',
        'detected_ethereum_wallets',
        'detected_solana_wallets',
        'wallet_connect_qr',
        'wallet_connect_qr_solana'
      ],
      walletChainType: 'ethereum-and-solana'
    },
    externalWallets: {
      solana: { connectors: solanaConnectors }
    }
  }}
>
  {children}
</PrivyProvider>;
```

### Fund a wallet via Privy modal

```tsx
const { fundWallet } = useFundWallet();
await fundWallet(wallet.address, {
  amount: '50',
  asset: 'USDC',
  chain: { id: 8453 },
});
```

(Funding flow is configured globally via `fundingMethodsAndOrder` on `PrivyProvider`; see `07-funding-and-onramp.md`.)

### Export embedded wallet private key

```tsx
import { useExportWallet } from '@privy-io/react-auth';

const { exportWallet } = useExportWallet();
const handleExport = async () => {
  await exportWallet(); // opens Privy iframe modal with the user's key
};
```

### List + filter wallets by chain / by embedded vs external

```tsx
const { wallets } = useWallets(); // EVM
const embeddedEvm = wallets.find((w) => w.walletClientType === 'privy');
const externalEvm = wallets.filter((w) => w.walletClientType !== 'privy');

import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
const { wallets: solWallets } = useSolanaWallets();
const embeddedSol = solWallets.find((w) => w.standardWallet?.name === 'Privy');
```

### Sign Solana message via embedded wallet

From `getting-started-with-privy-and-solana.md`:

```tsx
import { useSignMessage, useWallets } from '@privy-io/react-auth/solana';

const { signMessage } = useSignMessage();
const { wallets } = useWallets();
const wallet = wallets.find((w) => w.standardWallet.name === 'Privy');

const handleSignMessage = async () => {
  if (!wallet) throw new Error('No embedded wallet found');
  const signature = await signMessage({
    message: new TextEncoder().encode('Hello from Privy!'),
    wallet
  });
  console.log('Message signed:', signature);
};
```

### Sign + send Solana transaction via embedded wallet

```tsx
import { useSignAndSendTransaction, useWallets } from '@privy-io/react-auth/solana';

const { signAndSendTransaction } = useSignAndSendTransaction();
const { wallets } = useWallets();

const handleSendTransaction = async () => {
  const wallet = wallets.find((w) => w.standardWallet.name === 'Privy');
  if (!wallet) throw new Error('No wallet found');

  const transaction = await generateTransaction(wallet);
  const transactionSignature = await signAndSendTransaction({
    transaction,
    wallet
  });
  console.log('Transaction sent:', transactionSignature);
};
```

### Disable wallet UIs globally

From `manage-wallet-UIs.md`:

```tsx
<PrivyProvider
  config={{
    embeddedWallets: {
      showWalletUIs: false
    }
  }}
>
  <App />
</PrivyProvider>
```

Per-call override on EVM:

```tsx
await sendTransaction(
  { to: '0x...', value: 1n },
  { uiOptions: { showWalletUIs: false } }
);
```

## Spectre-specific notes

- **Both apps configure `embeddedWallets.ethereum.createOnLogin: 'users-without-wallets'` AND `embeddedWallets.solana.createOnLogin: 'users-without-wallets'`**. This means a user logging in with email gets ONE Ethereum embedded wallet and ONE Solana embedded wallet, but only if they don't already have one. If they later link a MetaMask EOA, no new embedded wallet is created.
- **Filter pattern** to isolate the embedded wallet from connected externals: `wallets.filter(w => w.walletClientType === 'privy')`. The first match is the embedded wallet. For Solana, use `wallets.find(w => w.standardWallet?.name === 'Privy')`.
- **Research wallet list** (`apps/research/src/lib/privy-config.js`): `detected_ethereum_wallets`, `detected_solana_wallets`, `metamask`, `phantom`, `coinbase_wallet`, `backpack`, `solflare`, `okx_wallet`, `safe`, `zerion`, `rainbow`, `wallet_connect`. `walletChainType: 'ethereum-and-solana'`. `showWalletLoginFirst: false`.
- **Trading wallet list** (`apps/trading/src/lib/privy-config.js`): uses the generic `detected_wallets` entry instead of the two chain-specific bundles, then the same set of named connectors and `wallet_connect`. Drift between the two apps - research's split detection is more explicit; trading's generic entry produces the same effective set.
- **`binance` is intentionally omitted**. It's in Privy's `WalletListEntry` TS union but the runtime drops it (asset missing from bundle). Binance Web3 Wallet users connect via `wallet_connect` QR, which is the native flow for Binance mobile anyway.
- **Hooks that crash before hydration are deferred to child components** - the `UserDashboard` pattern moves `useWallets()` / `useSolanaWallets()` calls into leaf components so they don't run during the auth-uninitialized phase. See `spectre/patterns.md`. The general rule: gate any `useWallets()` consumer on `ready === true` and on `authenticated === true`.
- **We do NOT use server wallets today**. Every Spectre wallet is a client-side embedded wallet owned by the user. No authorization keys are configured for our app. Swap execution uses the user's Privy wallet to sign client-side via `useSwapExecution.js` - see `solana-web3.md` section A and `MEMORY.md` for the non-custodial constraint.
- **We do NOT use the export flow yet**. `useExportWallet()` is not wired into any UI. Users currently have no escape hatch other than transferring funds out manually. Adding this is on the TODOS backlog.
- **No key quorums, no policies, no signers** - we use plain user-owned client-only wallets. If we ever add "leave your trading bot running overnight," we will need to add a server-side signer with a strict policy (allowlisted DEXes, capped per-tx size).
- **`walletChainType: 'ethereum-and-solana'`** means Privy renders Solana wallets with a chain badge in the connect modal. Phantom users see Phantom with a badge that says "Solana" (because Phantom is multi-chain, it shows separately for each chain it claims).
- **Funding methods**: `fundingMethodsAndOrder: { primary: ['card'], overflow: ['exchange'] }` - card via MoonPay first, exchange transfer as a fallback link. See `07-funding-and-onramp.md`.

## Gotchas and pitfalls

- **`useWallets()` array updates async after login** - first render after `authenticated` flips true will still see `wallets = []`. Use `ready` and `authenticated` guards before reading the array. The exact pattern: `if (!ready || !authenticated) return null`. If you read on first render without guards, you get a stale empty array and downstream logic fires with no wallet.
- **`createOnLogin: 'all-users'`** will create an embedded wallet even for users who logged in with MetaMask, leading to two wallets per user and confused UI. Prefer `'users-without-wallets'` unless you specifically want every user to have an embedded wallet on top of their external one.
- **Privy embedded wallets cannot be re-imported**. If the user loses their passkey AND has not set a recovery password AND the export flow was never run, funds are stuck. There is no Privy backdoor.
- **Solana embedded wallets require `walletChainType: 'ethereum-and-solana'` or `'solana-only'`** in the provider's `appearance` config; the default is `'ethereum-only'`. Without this, even if `embeddedWallets.solana.createOnLogin` is set, the user has no way to surface Solana wallets in the modal.
- **`externalWallets.solana.connectors` is REQUIRED for Solana detection**. Without `toSolanaWalletConnectors()`, no Solana wallet (including `detected_solana_wallets`) appears in the modal even with the right `walletChainType`.
- **`getEthersProvider()` returns ethers v5**, not v6. If your app uses ethers v6 (we don't, but worth knowing), you need an adapter. Use `getEthereumProvider()` and wrap with `new ethers.BrowserProvider(provider)` for v6.
- **Each chain creates one embedded wallet by default**. To create a second wallet on the same chain (e.g., a second SOL wallet), pass `createAdditional: true` to `createWallet`.
- **HTTPS required for embedded wallets in production**. `http://` deployments will silently fail wallet creation because WebCrypto refuses to operate in insecure contexts. `localhost` is exempted by the browser.
- **`binance` entry is silently dropped** at runtime even though it's in the TS union. Don't bother adding it.
- **`wallet_connect` vs `wallet_connect_qr`**: `wallet_connect` shows the full WC registry (100+ wallets, searchable list); `wallet_connect_qr` shows a single QR code button. Use the QR variant for a clean UI when you only want WC as a fallback; use the full registry when you need maximum wallet coverage.
- **Mobile browser detection is empty**. On mobile, `detected_ethereum_wallets` and `detected_solana_wallets` render no buttons (extensions aren't injected). For mobile, list specific wallet names which trigger deep-link "Open in Wallet" buttons.
- **`requireUserPasswordOnCreate: true` adds a forced password prompt** during the very first wallet creation. Privy supports both passkeys and password as recovery methods; turning this on is a friction trade for a better recovery story.
- **`noPromptOnSignature: true` is silent autosign**. Use only when the user is already inside a high-trust UI (e.g., a swap they already clicked "Confirm" on). Setting it globally to true means every embedded-wallet signature happens with no Privy UI - the user only sees your own custom confirmation.
- **Whitelabel login methods do NOT trigger `createOnLogin`**. If you use `loginWithCode`, `useLoginWithOAuth`, or other direct login flows, you must call `useCreateWallet().createWallet()` manually after login. Only the Privy modal login fires `createOnLogin`.
- **External Solana wallets via Phantom in-app browser auto-prioritize**. If a user opens your site inside the Phantom mobile in-app browser, Phantom floats to position 1 in the wallet list regardless of `walletList` order. Same for Backpack, OKX, Solflare, Jupiter Wallet.
- **`Disable confirmation modals` Dashboard toggle vs `showWalletUIs` provider config** - provider config overrides Dashboard. If you set `showWalletUIs: true` in code but turn off modals in the Dashboard, modals still show. Always source-of-truth in code.
- **Wallet objects are not stable across renders**. The `wallets` array from `useWallets()` produces a new array on every poll; do not put it in a `useEffect` dep array directly. Map to a stable key: `wallets.map(w => w.address).join(',')` and use that string as the dep.
- **Privy never sees authorization key private keys**. When you create an authorization key in the Dashboard, save the private key immediately - the Dashboard does not store it. Privy cannot recover it for you.

## Cross-references

- Solana wallet specifics (Connection setup, RPC config, transaction patterns) - `03-solana-integration.md`
- EVM wallet specifics (provider, signers, RPC, chain switching) - `04-evm-integration.md`
- Server-controlled wallets (`@privy-io/server-auth`, authorization keys, server signing) - `08-server-sdk.md`
- Authorization (signers, policies, delegation, key quorums) - `10-wallet-controls-and-authorization.md`
- Funding flows (`useFundWallet`, MoonPay, exchange, bridge) - `07-funding-and-onramp.md`
- UI customization of wallet list and login modal - `09-ui-and-customization.md`
- Spectre-specific Privy patterns (UserDashboard hook deferral, ProfileSyncInit, etc.) - `spectre/patterns.md`
