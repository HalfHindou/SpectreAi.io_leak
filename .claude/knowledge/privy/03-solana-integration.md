---
description: Privy + Solana integration (provider config, embedded SOL wallets, send SOL/SPL/USDC, MWA, network selection). Synthesized from official docs.
---

# Privy + Solana

## Source docs synthesized

- `getting-started-with-privy-and-solana.md` - end-to-end React + Next.js setup, embedded wallet creation, sign message, sign tx, sign+send tx
- `configuring-solana-networks.md` - `config.solana.rpcs`, mainnet/devnet/testnet, custom SVM networks via `Connection`
- `adding-solana-mwa.md` - Mobile Wallet Adapter for React web and React Native (Expo)
- `send-sol.md` - native SOL transfer recipe (TypeScript + Python; React, React Native, NodeJS, Python SDKs)
- `send-spl-tokens.md` - SPL token transfer with ATA derivation (USDC example)
- `send-usdc.md` - EVM-side USDC reference (not Solana, but cross-checked for vocabulary)
- `Wallets Overview.md` - "Ethereum, Solana, Base, Tempo, and more"
- `Swap.md` - "Swaps are available on the following EVM chains. Solana and Bitcoin support are coming soon."
- `Transfer Overview.md` - REST `/v1/wallets/{id}/transfer` supports `chain: 'solana'` (CAIP-2 `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`), `solana_devnet`, and `asset: 'sol'`, `usdc`, `usdt`
- `Chain Support.md` - Solana is Tier 3 (full functionality) - includes all SVM-compatible networks

---

## Core concepts

### How Privy provisions a Solana embedded wallet

- An authenticated Privy user can hold both an EVM (Ethereum) embedded wallet AND a Solana embedded wallet simultaneously. They are two separate key-pairs under the same user identity.
- Embedded wallet provisioning is controlled by `embeddedWallets.solana.createOnLogin` (independent from `embeddedWallets.ethereum.createOnLogin`).
- Valid values for `createOnLogin`: `'all-users'`, `'users-without-wallets'`, `'off'`. (See `02-embedded-wallets.md`.)
- The wallet address is a base58 Solana pubkey (NOT 0x-prefixed). Length is 32-44 chars.
- Privy's Solana embedded wallet exposes signing primitives but does NOT directly expose the private key (export requires the `useExportWallet` flow).

### `walletChainType` requirement

- `appearance.walletChainType` controls which chain ecosystems the login modal advertises. Valid values: `'ethereum-only'`, `'solana-only'`, `'ethereum-and-solana'`.
- Without setting this to a value that includes Solana, Privy will not provision Solana embedded wallets even if `embeddedWallets.solana.createOnLogin` is set, and the connect-wallet picker will not show Solana wallets.
- Spectre uses `'ethereum-and-solana'` in both apps.

### Solana wallet object shape

A connected Solana wallet from `useWallets()` (imported from `@privy-io/react-auth/solana`) exposes:

- `address` - base58 pubkey string
- `signMessage(message: Uint8Array)` - sign a UTF-8 encoded payload, returns a signature
- `signTransaction(tx)` - sign a serialized/encoded transaction, return signed tx
- `signAndSendTransaction(tx)` - sign and broadcast in one call (requires `config.solana.rpcs` for embedded wallets)
- `signAllTransactions(txs)` - batch sign (standard wallet interface)
- `standardWallet.name` - e.g. `'Privy'` for embedded, `'Phantom'` / `'Solflare'` / `'Backpack'` for external
- `getProvider()` - returns the underlying Solana provider for power-user flows

### External Solana wallets supported

Detected via the Wallet Standard:

- Phantom
- Solflare
- Backpack
- OKX Wallet
- Trust (when injected)
- Plus any other Wallet Standard compliant Solana extension
- Mobile: Solana Mobile Wallet Adapter (MWA) for Android-resident wallets

### Solana RPC config

- `config.solana.rpcs` - keyed by CAIP-2 cluster ID (e.g. `'solana:mainnet'`, `'solana:devnet'`).
- Each entry has `{ rpc: createSolanaRpc(url), rpcSubscriptions: createSolanaRpcSubscriptions(wssUrl) }`.
- `createSolanaRpc` / `createSolanaRpcSubscriptions` come from `@solana/kit`.
- ONLY required when using Privy's embedded wallet UIs (`signTransaction` / `signAndSendTransaction` via the embedded wallet). External Solana wallets handle their own RPC.

---

## Setup: provider config

### Imports

```ts
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
```

### Full provider config (verbatim from `getting-started-with-privy-and-solana.md`)

```tsx
// components/providers.tsx
'use client';

import {PrivyProvider} from '@privy-io/react-auth';
import {toSolanaWalletConnectors} from '@privy-io/react-auth/solana';
import {createSolanaRpc, createSolanaRpcSubscriptions} from '@solana/kit';
import {ReactNode} from 'react';

export function Providers({children}: {children: ReactNode}) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID}
      config={{
        solana: {
          rpcs: {
            'solana:mainnet': {
              rpc: createSolanaRpc('https://api.mainnet-beta.solana.com'), // or your custom RPC endpoint
              rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com') // or your custom RPC endpoint
            }
          }
        },
        appearance: {
          showWalletLoginFirst: true,
          walletChainType: 'solana-only'
        },
        loginMethods: ['wallet', 'email'],
        externalWallets: {
          solana: {
            connectors: toSolanaWalletConnectors() // For detecting EOA browser wallets
          }
        },
        embeddedWallets: {
          createOnLogin: 'all-users'
        }
      }}
    >
      {children}
    </PrivyProvider>
  );
}
```

### `externalWallets.solana.connectors`

`toSolanaWalletConnectors()` accepts an optional options object:

```ts
toSolanaWalletConnectors({ shouldAutoConnect: false })
```

- `shouldAutoConnect: false` - do NOT silently reconnect a previously authorized Solana wallet on page load. Spectre uses `false` so users opt-in to wallet connection each session.

### Webpack/Next.js externals (only when using yarn)

```ts
// next.config.ts
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  webpack: (config) => {
    config.externals['@solana/kit'] = 'commonjs @solana/kit';
    config.externals['@solana-program/memo'] = 'commonjs @solana-program/memo';
    config.externals['@solana-program/system'] = 'commonjs @solana-program/system';
    config.externals['@solana-program/token'] = 'commonjs @solana-program/token';
    return config;
  }
};

export default nextConfig;
```

Spectre uses Vite + npm, so these externals are not needed.

---

## Network configuration

### Multi-cluster setup

```tsx
<PrivyProvider
  appId="your-privy-app-id"
  config={{
    ...theRestOfYourConfig,
    solana: {
      rpcs: {
        'solana:mainnet': {
          rpc: createSolanaRpc('https://api.mainnet-beta.solana.com'),
          rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com')
        },
        'solana:devnet': {
          rpc: createSolanaRpc('https://api.devnet.solana.com'),
          rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.devnet.solana.com')
        }
      }
    }
  }}
>
  {/* your app's content */}
</PrivyProvider>
```

### Cluster keys

Privy keys clusters by CAIP-2:

- `solana:mainnet` - Mainnet Beta (CAIP-2 full form `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`)
- `solana:devnet` - Devnet (CAIP-2 full form `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`)
- `solana:testnet` - Testnet

Server-SDK / REST API operations use the full CAIP-2 string (see `08-server-sdk.md`).

### Custom RPC providers

Use any HTTPS RPC URL in `createSolanaRpc(...)`. Common providers used by production apps:

- Helius
- QuickNode
- Triton One
- Alchemy
- Ankr
- Self-hosted on OVH / Hetzner / Vultr bare-metal

### Custom SVM networks

Privy supports any SVM-compatible chain (Eclipse, Nitro, etc.). For these, build the transaction yourself and use a `@solana/web3.js` Connection with the SVM's RPC URL:

```tsx
// Initialize connection instance with custom SVM RPC URL
let connection = new Connection('insert-custom-SVM-rpc-url');

// Build out the transaction object for your desired program
// https://solana-foundation.github.io/solana-web3.js/classes/Transaction.html
let transaction = new Transaction();

// Send transaction on custom SVM
console.log(await wallet.sendTransaction!(transaction, connection));
```

### Per-transaction cluster override

When using `signAndSendTransaction` from an external Solana wallet (Phantom/Solflare), you pass a `Connection` instance directly with whatever RPC URL you choose. The provider's `config.solana.rpcs` only governs which cluster the embedded wallet UI defaults to.

### Embedded vs external RPC requirement

> The `config.solana.rpcs` configuration is only required for Privy's embedded wallet UIs. If you are using external Solana wallets (e.g., Phantom, Solflare) without embedded wallet UIs, you do not need to set `config.solana.rpcs`.

For Spectre this means: trading app currently has no embedded-wallet UI for Solana signing through `useSignAndSendTransaction`, so `config.solana.rpcs` is not strictly required. It IS required if we want to add a "Send SOL" or "Send SPL" button that uses the embedded wallet's UI flow.

---

## Solana wallet hooks

All hooks below are imported from `@privy-io/react-auth/solana` (NOT the base `@privy-io/react-auth`).

### `useWallets()`

```ts
import { useWallets } from '@privy-io/react-auth/solana';

const { ready, wallets } = useWallets();
// wallets: array of Solana wallets (embedded + connected external)
const embedded = wallets.find((w) => w.standardWallet.name === 'Privy');
const phantom = wallets.find((w) => w.standardWallet.name === 'Phantom');
```

- `ready` - true once Privy has hydrated and wallet list is reliable
- `wallets` - all connected Solana wallets; includes embedded ones and Wallet-Standard-connected externals
- Each wallet has `address` (base58 string) and exposes Wallet Standard signing methods

### `useCreateWallet()`

```ts
import { useCreateWallet } from '@privy-io/react-auth/solana';

const { createWallet } = useCreateWallet();
const wallet = await createWallet({ createAdditional: false });
// createAdditional=true creates an additional HD-derived wallet for the user
```

### `useSignMessage()`

```ts
import { useSignMessage } from '@privy-io/react-auth/solana';

const { signMessage } = useSignMessage();
const signature = await signMessage({
  message: new TextEncoder().encode('Hello from Privy!'),
  wallet,
});
```

- Solana messages are arbitrary `Uint8Array` payloads (NOT prefixed like EIP-191).
- Returns a Solana signature (64 bytes), base64 in most flows.

### `useSignTransaction()`

```ts
import { useSignTransaction } from '@privy-io/react-auth/solana';

const { signTransaction } = useSignTransaction();
const transactionSignature = await signTransaction({
  transaction,
  wallet,
});
```

- `transaction` is the serialized/encoded transaction the wallet should sign.
- Returns the signed transaction (NOT a signature; you still need to broadcast it).

### `useSignAndSendTransaction()`

```ts
import { useSignAndSendTransaction } from '@privy-io/react-auth/solana';

const { signAndSendTransaction } = useSignAndSendTransaction();
const transactionSignature = await signAndSendTransaction({
  transaction,
  wallet,
});
```

- Signs AND broadcasts. Returns the transaction signature (base58) you can look up on Solscan.
- For embedded wallets, this uses the RPC configured in `config.solana.rpcs`.

### `useWallets` from the base `@privy-io/react-auth`

Not the same hook. The base export returns a mixed list (`useWallets()` from `@privy-io/react-auth` returns EVM wallets). You MUST import from the `/solana` subpath when working with Solana.

### Expo / React Native equivalent

```ts
import { useEmbeddedSolanaWallet } from '@privy-io/expo';

const { wallets } = useEmbeddedSolanaWallet();
const wallet = wallets[0];
const provider = await wallet.getProvider();
const { signature } = await provider.request({
  method: 'signAndSendTransaction',
  params: { transaction, connection },
});
```

---

## Mobile Wallet Adapter (MWA)

### React (web) setup

Install:

```bash
npm i @solana-mobile/wallet-standard-mobile
```

Register the MWA adapter at app root:

```typescript
import {
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  createDefaultWalletNotFoundHandler,
  registerMwa
} from '@solana-mobile/wallet-standard-mobile';

registerMwa({
  appIdentity: {
    name: 'My app',
    uri: 'https://myapp.io',
    icon: 'relative/path/to/icon.png' // resolves to https://myapp.io/relative/path/to/icon.png
  },
  authorizationCache: createDefaultAuthorizationCache(),
  chains: ['solana:mainnet'],
  chainSelector: createDefaultChainSelector(),
  onWalletNotFound: createDefaultWalletNotFoundHandler()
});
```

After registration, MWA wallets appear in the standard Privy connect-wallet flow alongside Phantom/Solflare.

### React Native (Expo) setup

> Solana Mobile Wallet Adapter is only supported on Android devices.

Install:

```bash
npm install @solana-mobile/mobile-wallet-adapter-protocol-web3js @solana-mobile/mobile-wallet-adapter-protocol
```

Full MWA + Sign-In-With-Solana (SIWS) login flow:

```tsx
import {transact} from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import {useLoginWithSiws} from '@privy-io/expo';
import {toByteArray} from 'react-native-quick-base64';
import {PublicKey} from '@solana/web3.js';
import {Buffer} from 'buffer';

const MwaLoginButton = () => {
  const {generateMessage, login} = useLoginWithSiws();

  const handleLogin = async () => {
    try {
      await transact(async (wallet) => {
        // 1. Create a MWA session
        const authorizationResult = await wallet.authorize({
          chain: 'mainnet-beta',
          identity: {
            name: 'My app',
            uri: 'https://myapp.io',
            icon: 'https://myapp.io/icon.png'
          }
        });
        const desiredAccount = authorizationResult.accounts[0];

        // 2. Convert base64 address to base58 (Privy expects base58)
        const addressBytes = toByteArray(desiredAccount.address);
        const publicKey = new PublicKey(addressBytes);
        const base58Address = publicKey.toBase58();

        // 3. Generate a Privy SIWS message for the wallet address
        const siwsMessage = await generateMessage({
          wallet: {address: base58Address}, // Use base58 for Privy
          from: {domain: 'com.myapp.app', uri: 'https://myapp.io'}
        });

        // 4. Convert the SIWS message to Uint8Array for signing
        const encodedSiwsMessage = new TextEncoder().encode(siwsMessage.message);

        // 5. Request user to sign the SIWS message with their wallet
        const [signatureBytes] = await wallet.signMessages({
          addresses: [desiredAccount.address], // Use base64 for MWA
          payloads: [encodedSiwsMessage]
        });
        const signatureBase64 = Buffer.from(signatureBytes).toString('base64');

        // 6. Authenticate with Privy using the signed message
        const user = await login({
          signature: signatureBase64,
          message: siwsMessage.message
        });

        return {mwaResult: authResult, user};
      });
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  return <Button title="Login with MWA" onPress={handleLogin} />;
};
```

### MWA limitations vs desktop

- Android only (iOS uses universal links to Phantom / Solflare instead).
- Address byte format differs between MWA (base64) and Privy (base58) - explicit conversion is required.
- Requires a separate user-visible wallet app to actually be installed on the device.
- Signing happens out-of-process in the wallet app, then control returns to your app via the `transact` callback.

---

## Sending SOL (native transfer)

### 1. Build the transaction (TypeScript, `@solana/web3.js`)

```typescript
import {Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL} from '@solana/web3.js';

const createSOLTransferTransaction = async (
  fromAddress: string,
  toAddress: string,
  amount: number // Amount in SOL
) => {
  // Set up connection to Solana network
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Create public key objects
  const fromPubkey = new PublicKey(fromAddress);
  const toPubkey = new PublicKey(toAddress);

  // Convert SOL to lamports (1 SOL = 1,000,000,000 lamports)
  const lamports = amount * LAMPORTS_PER_SOL;

  // Create transfer instruction
  const transferInstruction = SystemProgram.transfer({
    fromPubkey,
    toPubkey,
    lamports
  });

  // Create transaction and add instruction
  const transaction = new Transaction().add(transferInstruction);

  // Get recent blockhash
  const {blockhash} = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = fromPubkey;

  return {transaction, connection};
};
```

### 2a. Send (React via `useSignAndSendTransaction`)

```typescript
import {useSignAndSendTransaction, useWallets} from '@privy-io/react-auth/solana';

const {wallets} = useWallets();
const {signAndSendTransaction} = useSignAndSendTransaction();

const {transaction, connection} = await createSOLTransferTransaction(
  wallets[0].address, // fromAddress
  'recipient-wallet-address', // toAddress
  0.01 // amount in SOL
);

// Assuming you have a transaction created from the previous step
const signature = await signAndSendTransaction({
  transaction.serialize(), // from createSOLTransferTransaction
  wallet: wallets[0]
});
```

### 2b. Send (React Native via provider.request)

```typescript
import {useEmbeddedSolanaWallet} from '@privy-io/expo';

const {wallets} = useEmbeddedSolanaWallet();
const wallet = wallets[0];
const provider = await wallet.getProvider();

const {transaction, connection} = await createSOLTransferTransaction(
  wallet.address, // fromAddress
  'recipient-wallet-address', // toAddress
  0.01 // amount in SOL
);

// Send transaction using the provider's request method
const {signature} = await provider.request({
  method: 'signAndSendTransaction',
  params: {
    transaction: transaction, // from createSOLTransferTransaction
    connection: connection // from createSOLTransferTransaction
  }
});
```

### 2c. Send (NodeJS server SDK)

```typescript
import {PrivyClient} from '@privy-io/node';

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!
});

const {transaction} = await createSOLTransferTransaction(
  'insert-wallet-address', // fromAddress
  'recipient-wallet-address', // toAddress
  0.01 // amount in SOL
);

// Send transaction using Privy API
const response = await privy
  .wallets()
  .solana()
  .signAndSendTransaction('insert-wallet-id', {
    // Devnet's caip2
    caip2: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    // from createSOLTransferTransaction
    transaction: Buffer.from(transaction.serialize()).toString('base64')
  });
```

### 2d. Send (Python server SDK)

```python
from privy import PrivyClient

client = PrivyClient(
    app_id="your-app-id",
    app_secret="your-app-secret"
)

base_64_encoded_transaction = create_sol_transfer_transaction(
    from_address="insert-wallet-address",  # fromAddress
    to_address="recipient-wallet-address",  # toAddress
    amount=0.01  # amount in SOL
)["transaction"]

# Send transaction using Privy API
tx_response = client.wallets.rpc(
    wallet_id="insert-wallet-id",
    method="signAndSendTransaction",
    params={
        "transaction": "insert-base-64-encoded-serialized-transaction",
        "encoding": "base64",
    }
)
```

### Lamport conversion

- 1 SOL = 1,000,000,000 lamports = `LAMPORTS_PER_SOL` constant from `@solana/web3.js`
- Always use `BigInt` or `Math.round(amount * 1e9)` to avoid floating-point precision loss on small fractional amounts.

---

## Sending SPL tokens

### 1. Build the transaction

```typescript
import {Connection, PublicKey, Transaction} from '@solana/web3.js';
import {getAssociatedTokenAddress, createTransferInstruction} from '@solana/spl-token';

const createSPLTransferTransaction = async (
  fromAddress: string,
  toAddress: string,
  tokenMintAddress: string,
  amount: number,
  decimals: number = 6 // Default for USDC, adjust for your token
) => {
  // Set up connection to Solana network
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

  // Create public key objects
  const fromPubkey = new PublicKey(fromAddress);
  const toPubkey = new PublicKey(toAddress);
  const mintPubkey = new PublicKey(tokenMintAddress);

  // Get associated token accounts
  const fromTokenAccount = await getAssociatedTokenAddress(mintPubkey, fromPubkey);

  const toTokenAccount = await getAssociatedTokenAddress(mintPubkey, toPubkey);

  // Convert amount to token units (considering decimals)
  const tokenAmount = amount * Math.pow(10, decimals);

  // Create transfer instruction
  const transferInstruction = createTransferInstruction(
    fromTokenAccount,
    toTokenAccount,
    fromPubkey,
    tokenAmount
  );

  // Create transaction and add instruction
  const transaction = new Transaction().add(transferInstruction);

  // Get recent blockhash
  const {blockhash} = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = fromPubkey;

  return {transaction, connection};
};
```

### 2. Send (React)

```typescript
import {useSignAndSendTransaction, useWallets} from '@privy-io/react-auth/solana';

const {wallets} = useWallets();
const {signAndSendTransaction} = useSignAndSendTransaction();

const {transaction, connection} = await createSPLTransferTransaction(
  wallets[0].address,
  'recipient-wallet-address', // Replace with recipient's token account address
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mint address
  10 // Amount to send
);

// Assuming you have a transaction created from the previous step
const signature = await sendTransaction({
  transaction.serialize(), // from createSPLTransferTransaction
  wallet: wallets[0],
});
```

### 3. Send (NodeJS server SDK)

```typescript
import {PrivyClient} from '@privy-io/node';

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!
});

const {transaction} = await createSPLTransferTransaction(
  'insert-wallet-address',
  'recipient-wallet-address', // Replace with recipient's token account address
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mint address
  10 // Amount to send
);

// Send transaction using Privy API
const response = await privy
  .wallets()
  .solana()
  .signAndSendTransaction('insert-wallet-id', {
    // Mainnet's caip2
    caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    // from createSPLTransferTransaction
    transaction: Buffer.from(transaction.serialize()).toString('base64')
  });
```

### Checking if a token account exists

```typescript
import {Connection, PublicKey} from '@solana/web3.js';
import {getAssociatedTokenAddress} from '@solana/spl-token';

const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

// Check if token account exists
const tokenAccountAddress = await getAssociatedTokenAddress(
  new PublicKey('tokenMintAddress'),
  new PublicKey('walletAddress')
);

const accountInfo = await connection.getAccountInfo(tokenAccountAddress);
const accountExists = accountInfo !== null;
```

### Important warning from docs

> Before sending SPL tokens, ensure that the recipient has a token account for the specific token mint.

If the destination ATA does not exist, the transfer instruction will fail. Either:

- Add a `createAssociatedTokenAccountInstruction` to the same transaction (payer pays ~0.002 SOL rent), OR
- Have the recipient pre-create their ATA, OR
- Use a relayer / on-ramp that handles ATA creation for you.

---

## Sending USDC

### Mint addresses

| Network | USDC mint address |
|---------|-------------------|
| Mainnet | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Devnet  | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

### Mainnet USDT mint (Spectre uses this)

| Token | Mainnet mint |
|-------|--------------|
| USDT  | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |

### Decimals

- USDC: **6 decimals** (so 1 USDC = 1,000,000 base units)
- USDT: **6 decimals**
- SOL: 9 decimals (lamports)

### Reusing the SPL transfer flow

USDC sends use the exact same code as `createSPLTransferTransaction` above. Just pass:

- `tokenMintAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'`
- `decimals = 6`

### Important: `send-usdc.md` in the doc bundle is EVM-only

The `send-usdc.md` file in `~/Desktop/Privy/` documents USDC sends on Ethereum/Base/Arbitrum (ERC-20 `transfer(address,uint256)` via `viem` `encodeFunctionData`). It does NOT cover Solana USDC. For Solana USDC, use the SPL transfer recipe above.

---

## Transaction signing patterns

### Legacy vs versioned transactions

`@solana/web3.js` supports two transaction formats:

- **Legacy** (`Transaction`) - simpler, used in all the recipe examples above. Set `transaction.recentBlockhash` and `transaction.feePayer` on the transaction object itself.
- **Versioned** (`VersionedTransaction` + `TransactionMessage`) - supports Address Lookup Tables (ALTs), required for many Jupiter swap routes. The `recentBlockhash` is set on the `TransactionMessage`, NOT on the outer `VersionedTransaction`.

### Versioned transaction template

```ts
import {
  Connection,
  TransactionMessage,
  VersionedTransaction,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
const { blockhash } = await connection.getLatestBlockhash();

const message = new TransactionMessage({
  payerKey: new PublicKey(fromAddress),
  recentBlockhash: blockhash,
  instructions: [
    SystemProgram.transfer({
      fromPubkey: new PublicKey(fromAddress),
      toPubkey: new PublicKey(toAddress),
      lamports: 0.01 * LAMPORTS_PER_SOL,
    }),
  ],
}).compileToV0Message();

const tx = new VersionedTransaction(message);
// Pass tx (or tx.serialize()) to Privy signAndSendTransaction
```

### Priority fees

Post-2024 Solana congestion makes priority fees mandatory for reliable confirmation. Add a `ComputeBudgetProgram.setComputeUnitPrice` instruction at the start of your instructions array:

```ts
import { ComputeBudgetProgram } from '@solana/web3.js';

const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
  microLamports: 1_000, // 1000 micro-lamports per compute unit; tune by congestion
});

// Prepend to instructions
const instructions = [priorityFeeIx, ...otherInstructions];
```

### Compute unit limit

Default per-tx compute budget is 200K units. DeFi instructions (swaps, AMM interactions) often need more:

```ts
const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
  units: 400_000, // request 400K compute units
});
```

Both `setComputeUnitPrice` and `setComputeUnitLimit` should be the first two instructions.

### Recent blockhash freshness

Blockhashes expire after ~60-90 seconds. If your client sits on a built transaction too long, `signAndSendTransaction` will fail with "Blockhash not found". Always fetch the blockhash immediately before signing, not during page load.

### Sign-only vs sign-and-send

Use `useSignTransaction` (sign only) when:

- You need to inspect or modify the signed bytes before sending
- A relayer (your server) will broadcast on the user's behalf to pay gas
- You want to bundle multiple signed transactions and submit them together

Use `useSignAndSendTransaction` for the common case (user signs and broadcasts in one step).

---

## Code patterns (verbatim)

### Provider setup (Solana + EVM dual-chain)

```tsx
<PrivyProvider
  appId={appId}
  config={{
    appearance: {
      walletChainType: 'ethereum-and-solana',
    },
    embeddedWallets: {
      ethereum: { createOnLogin: 'users-without-wallets' },
      solana: { createOnLogin: 'users-without-wallets' },
    },
    externalWallets: {
      solana: {
        connectors: toSolanaWalletConnectors({ shouldAutoConnect: false }),
      },
    },
    solana: {
      rpcs: {
        'solana:mainnet': {
          rpc: createSolanaRpc('https://api.mainnet-beta.solana.com'),
          rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com'),
        },
      },
    },
  }}
>
  {children}
</PrivyProvider>
```

### Creating an embedded Solana wallet on demand

```tsx
import {useWallets, useCreateWallet} from '@privy-io/react-auth/solana';

export function CreateWalletButton(props: {createAdditional: boolean}) {
  const {ready} = useWallets();
  const {createWallet} = useCreateWallet();

  if (!ready) {
    return <div>Loading...</div>;
  }

  const handleCreateWallet = async () => {
    try {
      // If createAdditional is true, it will create an additional HD wallet for the user.
      const wallet = await createWallet({createAdditional: props.createAdditional});
      console.log('Embedded wallet created:', wallet);
    } catch (error) {
      console.error('Error creating embedded wallet:', error);
    }
  };

  return <button onClick={handleCreateWallet}>Create Embedded Wallet</button>;
}
```

### Sign a message with the embedded wallet

```tsx
import {useSignMessage, useWallets} from '@privy-io/react-auth/solana';

const {signMessage} = useSignMessage();
const {wallets} = useWallets(); // This hook provides access to both embedded and EOA wallets
const wallet = wallets.find((w) => w.standardWallet.name === 'Privy'); // Find the first embedded wallet

const handleSignMessage = async () => {
  try {
    if (!wallet) throw new Error('No embedded wallet found');
    const signature = await signMessage({
      message: new TextEncoder().encode('Hello from Privy!'), // Solana messages are typically encoded as Uint8Array
      wallet
    });
    console.log('Message signed:', signature);
  } catch (error) {
    console.error('Error signing message:', error);
  }
};
```

### Generate + sign a SystemProgram.transfer using `@solana/kit`

```tsx
import type {ConnectedStandardSolanaWallet} from '@privy-io/react-auth/solana';
import {
  pipe,
  createSolanaRpc,
  getTransactionEncoder,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  address,
  createNoopSigner
} from '@solana/kit';
import {getTransferSolInstruction} from '@solana-program/system';

const generateTransaction = async (wallet: ConnectedStandardSolanaWallet) => {
  // Simple SOL transfer transaction
  const amount = 1;

  const transferInstruction = getTransferSolInstruction({
    amount: BigInt(parseFloat(amount) * 1_000_000_000), // Convert SOL to lamports
    destination: address('RecipientAddressHere'),
    source: createNoopSigner(address(wallet.address))
  });

  // Configure your RPC connection to point to the correct Solana network
  const {getLatestBlockhash} = createSolanaRpc('https://api.mainnet-beta.solana.com'); // Replace with your Solana RPC endpoint
  const {value: latestBlockhash} = await getLatestBlockhash().send();

  // Create transaction using @solana/kit
  const transaction = pipe(
    createTransactionMessage({version: 0}),
    (tx) => setTransactionMessageFeePayer(address(wallet.address), tx), // Set the message fee payer
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx), // Set recent blockhash
    (tx) => appendTransactionMessageInstructions([transferInstruction], tx), // Add your instructions to the transaction
    (tx) => compileTransaction(tx), // Compile the transaction
    (tx) => new Uint8Array(getTransactionEncoder().encode(tx)) // Finally encode the transaction
  );
  return transaction;
};
```

### Sign-only transaction (for relayer broadcast)

```tsx
import {useSignTransaction, useWallets} from '@privy-io/react-auth/solana';

const {signTransaction} = useSignTransaction();
const {wallets} = useWallets();

const handleSignTransaction = async () => {
  try {
    const wallet = wallets.find((w) => w.standardWallet.name === 'Privy');
    if (!wallet) throw new Error('No wallet found');

    const transaction = await generateTransaction(wallet);
    const transactionSignature = await signTransaction({
      transaction,
      wallet
    });
    console.log('Transaction signed:', transactionSignature);
  } catch (error) {
    console.error('Error signing transaction:', error);
  }
};
```

### Sign + send

```tsx
import {useSignAndSendTransaction, useWallets} from '@privy-io/react-auth/solana';

const {signAndSendTransaction} = useSignAndSendTransaction();
const {wallets} = useWallets();

const handleSendTransaction = async () => {
  try {
    const wallet = wallets.find((w) => w.standardWallet.name === 'Privy');
    if (!wallet) throw new Error('No wallet found');

    const transaction = await generateTransaction();
    const transactionSignature = await signAndSendTransaction({
      transaction,
      wallet
    });
    console.log('Transaction sent:', transactionSignature);
  } catch (error) {
    console.error('Error sending transaction:', error);
  }
};
```

---

## Transfer / Swap REST API surface (server-side)

### `/v1/wallets/{wallet_id}/transfer` for Solana

From `Transfer Overview.md`, the Privy `/transfer` REST endpoint supports:

| Asset key | Description |
|-----------|-------------|
| `sol`     | Native SOL |
| `usdc`    | USDC on supported chains incl. Solana |
| `usdt`    | USDT on supported chains incl. Solana |

| Chain key       | CAIP-2                                       |
|-----------------|----------------------------------------------|
| `solana`        | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`    |
| `solana_devnet` | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`    |

> The amount uses decimal strings in standard units (e.g. `"10.0"` for 10 USDC). The API handles decimal precision based on the asset - SOL uses 9 decimals, USDC uses 6. There is no need to convert to lamports / micro-units before sending the request.

### Sample Solana transfer call

```bash
curl -X POST https://api.privy.io/v1/wallets/{wallet_id}/transfer \
  -u "<your-privy-app-id>:<your-privy-app-secret>" \
  -H "privy-app-id: <your-privy-app-id>" \
  -H "Content-Type: application/json" \
  -d '{
    "source": {
      "asset": "sol",
      "amount": "0.1",
      "chain": "solana"
    },
    "destination": {
      "address": "RecipientBase58PubkeyHere"
    }
  }'
```

### Swap caveat for Solana

From `Swap.md`:

> Swaps are available on the following EVM chains. Solana and Bitcoin support are coming soon.

Until Privy ships native Solana swap support, Spectre routes Solana swaps through **Jupiter** (see `06-swaps-and-trading.md` and `useSwapExecution.js`). Privy's role on Solana swaps is signing-only.

---

## Spectre-specific notes

### Provider config (both apps use `'ethereum-and-solana'`)

- `apps/research/src/lib/privy-config.js` and `apps/trading/src/lib/privy-config.js` both set `appearance.walletChainType = 'ethereum-and-solana'`.
- Both apps set `embeddedWallets.solana.createOnLogin = 'users-without-wallets'`.
- Both apps include `phantom`, `solflare`, `backpack`, `okx_wallet` in the `walletList`.

### `toSolanaWalletConnectors` drift (research vs trading)

- **Research app** (`apps/research/src/lib/privy-config.js`) imports `toSolanaWalletConnectors` from `@privy-io/react-auth/solana` and registers it under `externalWallets.solana.connectors`. Phantom / Solflare / Backpack buttons appear in the wallet picker as expected.
- **Trading app** (`apps/trading/src/lib/privy-config.js`) does **NOT** import or register `toSolanaWalletConnectors`. This is logged as intentional in `apps/trading/CLAUDE.md` ("v1 `loginMethods` - intentional, do not upgrade to v2 without testing"), but it means the Solana wallets the trading app advertises in `walletList` will only appear via Wallet Standard auto-detection, not via Privy's explicit Solana connector pipeline.
- **Drift to fix**: trading should add the same `externalWallets.solana.connectors` block as research, gated behind a manual QA pass for the Solana wallet flow. See `spectre/current-implementation.md`.

### Solana network ID used internally (Codex)

- `1399811149` - Codex's internal Solana network ID (NOT a real chain ID).
- Appears in `useWalletBalances.js`, `useCodexData.js`, `token-registry.js`, and the `networkIdToChainSlug` mapping.
- This is unrelated to Privy. Privy keys clusters by CAIP-2 (`solana:mainnet`), not by Codex's networkId.

### Solana RPC env var

- `VITE_SOLANA_RPC_URL` - read by `walletService.js` in both apps.
- Falls back to `https://api.mainnet-beta.solana.com` if unset.
- Spectre also references `VITE_SOLANA_CLUSTER` in older code paths; canonical env var going forward is `VITE_SOLANA_RPC_URL`.

### `walletService.js` Solana code (trading)

`apps/trading/src/services/walletService.js`:

- `getSolanaConnection()` - singleton `Connection` cached in `providerCache`, `commitment: 'confirmed'`.
- `getSolNativeBalance(address)` - `connection.getBalance(pubkey)`, divides by `1e9` for SOL units.
- `getSplTokenBalance(walletAddress, mintAddress, decimals)` - dynamically imports `@solana/spl-token`, derives the ATA via `getAssociatedTokenAddressSync(mint, wallet)`, then calls `connection.getTokenAccountBalance(ata)`. Returns `{ balance: 0 }` if the ATA does not exist (catches `'could not find'` error).
- Common Solana mints hard-coded: USDT (`Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`), USDC (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`).

The `@solana/spl-token` import is dynamic to keep the RightPanel main bundle small (Buffer dependency would otherwise pull in extra weight).

### Swap execution for Solana goes via Jupiter, not Privy

- `useSwapExecution.js` (both apps) handles Solana swaps by:
  1. Fetching a quote from `/api/swap/quote` (server proxies Jupiter v6 API).
  2. Getting the embedded wallet's Solana provider via `wallet.getProvider()`.
  3. Decoding the base64 `swapTransaction` returned by Jupiter into a `Buffer`.
  4. Calling `provider.signAndSendTransaction({ serializedTransaction: txBuf })`.
- Privy is signing-only on this path. The actual swap routing, slippage, and fee logic happens inside Jupiter.

### No MWA in Spectre today

- Both apps are web-only (no Expo, no React Native build).
- Mobile users with Phantom on iOS connect via Phantom's universal link flow (handled by Phantom's Wallet Standard provider).
- Mobile users with Phantom on Android could in theory use MWA if we registered the adapter, but `registerMwa(...)` is not called anywhere in Spectre today.

### Header Solana balance via server proxy

- The header's USD total uses `/api/solana-balance?address=` (server proxy) instead of direct `connection.getBalance(pubkey)` calls.
- Reason: public Solana RPC endpoints have CORS quirks and rate limits, so the server proxy hides those failure modes.
- See `.claude/rules/solana-web3.md` section D and `apps/research/src/hooks/useWalletBalance.js`.

### Buffer polyfill is mandatory

```js
// main.jsx - FIRST TWO LINES, before any other imports
import { Buffer } from 'buffer'
window.Buffer = Buffer
```

`@solana/web3.js` and `@solana/spl-token` use `Buffer` for serialization. Without this polyfill, the trading and research apps crash with `Buffer is not defined` the first time a swap UI mounts.

### Gas reserve for Solana

`UdWalletSection.jsx` hardcodes a 0.01 SOL reserve when showing the max-sendable amount. Covers transaction fees + rent exemption for any ATAs the user might still need to fund. See `.claude/rules/solana-web3.md` section G.

---

## Gotchas & pitfalls

### Provider config

- Without `walletChainType: 'ethereum-and-solana'` (or `'solana-only'`), no Solana embedded wallet is created even when `embeddedWallets.solana.createOnLogin` is set.
- Without `toSolanaWalletConnectors` in `externalWallets.solana.connectors`, the Phantom / Solflare buttons do not reliably appear in the Privy connect modal. (Wallet Standard auto-detection can still surface them, but explicit registration is the supported path.)
- `config.solana.rpcs` is REQUIRED for embedded-wallet `signTransaction` / `signAndSendTransaction` calls. For external-wallet-only setups, it is optional.

### Transaction construction

- Versioned transactions need `recentBlockhash` set on the `TransactionMessage` (NOT on the outer `VersionedTransaction`). Easy to miss when porting from legacy code.
- Legacy transactions need BOTH `recentBlockhash` AND `feePayer` set on the `Transaction` object, otherwise signing throws cryptic errors.
- The `transaction.serialize()` call in the React `useSignAndSendTransaction` recipes returns a `Buffer` / `Uint8Array` - some Privy code paths accept the raw `Transaction` object, others require the serialized bytes. Always check what the specific hook signature expects.

### Token accounts

- SPL transfers fail if the recipient does not have an ATA for that mint. Either add a `createAssociatedTokenAccountInstruction` to the same tx (payer covers ~0.002 SOL rent), or require the recipient to pre-create the ATA.
- ATA address derivation MUST use `TOKEN_PROGRAM_ID` for classic SPL tokens, or `TOKEN_2022_PROGRAM_ID` for Token-2022 tokens. Wrong program ID derives a non-existent address and the transfer silently routes nowhere.
- `getAssociatedTokenAddress` is async; `getAssociatedTokenAddressSync` is sync. Spectre uses the sync variant (no RPC roundtrip needed for derivation).

### RPC behavior

- Priority fees on Solana are not optional anymore (post-2024 congestion era). Without `setComputeUnitPrice`, transactions land slowly or get dropped during congestion windows.
- Compute units default to 200K - many DeFi instructions need explicit `setComputeUnitLimit(400_000)` or higher.
- Recent blockhashes expire after ~60-90 seconds. If a built transaction sits on the client too long, `signAndSendTransaction` fails with `"Blockhash not found"`. Always fetch immediately before signing.
- Public RPC endpoints (`api.mainnet-beta.solana.com`) rate-limit aggressively. Use a paid provider (Helius, QuickNode, Triton) for any production volume.

### Wallet objects

- Embedded Solana wallet does NOT expose the private key by default. Export requires the `useExportWallet` flow with user confirmation.
- Phantom and Solflare wallets occasionally disconnect on tab switch (browser visibility events). UI should re-authenticate gracefully via `useConnectWallet` rather than crashing on a missing wallet.
- The `wallets` array from `useWallets()` (Solana) includes both embedded and connected externals. Filter by `standardWallet.name === 'Privy'` to target the embedded one specifically.

### Cross-chain pitfalls

- `useWallets()` from `@privy-io/react-auth` returns EVM wallets. `useWallets()` from `@privy-io/react-auth/solana` returns Solana wallets. They are DIFFERENT hooks with the same name - the `/solana` subpath matters.
- Same applies to `useSignMessage`, `useSignTransaction`, `useConnectWallet` - always check which subpath you're importing from.
- A user can have both an EVM embedded wallet AND a Solana embedded wallet under the same Privy identity. Don't assume `wallet[0]` is the chain you want.

### MWA-specific

- Address byte format is base64 in MWA, base58 everywhere else. Always convert via `toByteArray` + `PublicKey.toBase58()` before passing to Privy hooks.
- MWA only works on Android. iOS users need universal-link flows to Phantom / Solflare instead.

### Server-side (Node SDK)

- The Node SDK's `privy.wallets().solana().signAndSendTransaction(walletId, { caip2, transaction })` expects a base64-encoded serialized transaction string, NOT a raw `Transaction` object. Always wrap with `Buffer.from(tx.serialize()).toString('base64')`.
- The `caip2` field uses the full CAIP-2 string (`'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'`), NOT the short `'solana'` form used in the REST `/transfer` endpoint.

---

## Cross-references

- Embedded wallet creation policies, ETH vs SOL provisioning, export flows -> `02-embedded-wallets.md`
- Generic transaction + signing patterns, error handling, useSendTransaction (EVM) -> `05-transactions-and-signing.md`
- Solana swaps (Jupiter, Bebop), 0x for EVM, fee routing -> `06-swaps-and-trading.md`
- Server-side Solana wallets, `PrivyClient.wallets().solana()`, REST `/transfer` for Solana -> `08-server-sdk.md`
- Current Spectre Solana usage, `walletService.js` audit, trading-app drift fix list -> `spectre/current-implementation.md`
- Wallet hooks crash-before-hydration pattern, error-boundary requirement -> `.claude/rules/solana-web3.md` section A
- Multicall3 vs sequential balance reads (EVM), Solana ATA pattern -> `.claude/rules/solana-web3.md` section C-D
- Swap execution flow, Jupiter integration details, slippage, fee config -> `.claude/rules/solana-web3.md` section E
