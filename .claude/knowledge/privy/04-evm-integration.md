---
description: Privy + EVM integration (chain config, EIP-7702, batch tx, gas sponsorship, viem/ethers usage). Synthesized from official docs.
---

# Privy + EVM

## Source docs synthesized

- `configuring-evm-networks.md` - defaultChain, supportedChains, viem chain objects, custom chains, RPC overrides
- `eip-7702.md` - EIP-7702 EOA-to-smart-account upgrades (Alchemy, Biconomy, Pimlico, Porto, ZeroDev)
- `batch-transactions.md` - wallet_sendCalls atomic batches
- `speeding-up-transactions.md` - replacement transactions via webhook + same nonce
- `gas-sponsorship-rate-limits.md` - sponsor flag and custom spending tiers
- `Chain Support.md` - tier 3 EVM support definition
- `flashblocks.md` - Base L2 200ms pre-confirmation routing
- `Wallets Overview.md` - wallet object surface
- `Wallet Actions.md` - wallet action vs low-level RPC split, Uniswap-routed swaps
- `Swap.md` - swap surface (Uniswap routing, supported chains, fees, slippage)
- `swap-with-0x.md` - 0x v2 + Permit2 flow with provider.request
- `quickstart (1).md` - useSendTransaction example
- `agent-cli.md` - full EVM RPC method list (personal_sign, eth_sendTransaction, eth_signTypedData_v4, eth_sign7702Authorization, eth_signUserOperation)

## Core concepts

### EVM wallet object shape

Every entry in `useWallets()` for an EVM wallet exposes:

- `address` - 0x-prefixed checksummed EOA address (string)
- `chainId` - current chain (CAIP-2 string `eip155:<id>` in newer SDKs, plain number in older ones)
- `walletClientType` - `'privy'` for embedded, `'metamask' | 'rainbow' | 'coinbase_wallet' | 'walletconnect'` etc. for external
- `connectorType` - `'embedded' | 'injected' | 'wallet_connect' | 'coinbase_wallet'`
- `getEthereumProvider()` - async, returns an EIP-1193 provider (the only universal interface)
- `getEthersProvider()` - async, returns an ethers v5 `Web3Provider`. NOT v6.
- `switchChain(chainId)` - method on the wallet object itself
- `sign(message)`, `signTypedData(typedData)` - convenience methods that prompt the user

Differentiate embedded vs external by `walletClientType === 'privy'`.

### Chain switching: programmatic vs user-driven

- **Embedded wallets** switch silently when supported chain. `await wallet.switchChain(8453)` succeeds without UI.
- **External wallets** (MetaMask, Rainbow, etc.) require user approval. The wallet might reject if the chain is not yet added to the user's wallet. The user can also switch chains manually outside of Privy at any time - your app must observe `wallet.chainId` and re-render.
- Switching to a chain that is NOT in `supportedChains` throws.

### Smart accounts via EIP-7702 vs ERC-4337 smart wallets

| Concern | EIP-7702 (Pectra) | ERC-4337 smart wallet |
|---------|-------------------|----------------------|
| Account address | Same as the EOA (in-place upgrade) | New contract address, different from EOA |
| Onboarding | Sign authorization, no deploy | Deploy contract (first user op) |
| Reverts to EOA | Yes - authorization can be revoked or expire per-chain | No - contract is permanent |
| Privy support | `useSign7702Authorization` hook | Smart wallet client APIs, ZeroDev/Alchemy adapters |
| Best for | Adding batching/sponsorship to existing EOAs | Brand-new smart-wallet users |

### Gas sponsorship (paymaster) basics

A paymaster is an onchain contract that fronts gas on behalf of the user. Privy supports:

1. **Native sponsorship**: configure in dashboard, app prepays gas credits, set `sponsor: true` per request.
2. **Third-party paymaster**: integrate Pimlico/ZeroDev/Alchemy directly via 7702 + the bundler's paymaster client (custom paymasterContext, sponsorshipPolicyId).

Sponsorship only applies to EVM. Solana fee payers are configured separately.

## Setup: provider config

### `defaultChain` and `supportedChains`

```tsx
import {base, polygon, arbitrum, optimism, mainnet} from 'viem/chains';
import {bsc} from 'viem/chains';

<PrivyProvider
  appId='your-privy-app-id'
  config={{
    defaultChain: base,
    supportedChains: [mainnet, base, polygon, arbitrum, optimism, bsc],
  }}
>
  {/* app */}
</PrivyProvider>
```

Rules (from `configuring-evm-networks.md`):

- Empty `supportedChains: []` throws at provider mount.
- `defaultChain` MUST also appear in `supportedChains` or throws.
- If `supportedChains` is set but `defaultChain` is not, embedded wallets land on `supportedChains[0]` and external wallets are not prompted to switch.
- If neither is set, Privy uses its default network list (Ethereum, Base, Polygon, Arbitrum, Optimism, plus testnets).

### Custom chain definition

For chains not in `viem/chains`:

```tsx
import {defineChain} from 'viem';

export const myCustomChain = defineChain({
  id: 123456789,
  name: 'My Custom Chain',
  network: 'my-custom-chain',
  nativeCurrency: {
    decimals: 18,
    name: 'My Native Currency Name',
    symbol: 'My Native Currency Symbol'
  },
  rpcUrls: {
    default: {
      http: ['https://my-custom-chain-https-rpc'],
      webSocket: ['wss://my-custom-chain-websocket-rpc']
    }
  },
  blockExplorers: {
    default: {name: 'Explorer', url: 'my-custom-chain-block-explorer'}
  }
});
```

Pass `myCustomChain` to `defaultChain` and include it in `supportedChains`.

### Per-app vs runtime chain override

Use `addRpcUrlOverrideToChain` from `@privy-io/chains` to swap the RPC URL on a viem chain object without forking the viem definition:

```ts
import {mainnet} from 'viem/chains';
import {addRpcUrlOverrideToChain} from '@privy-io/chains';

const mainnetOverride = addRpcUrlOverrideToChain(mainnet, 'INSERT_CUSTOM_RPC_URL');
```

Then put `mainnetOverride` into `supportedChains` instead of `mainnet`. By default Privy uses its own RPCs at `*.rpc.privy.systems` for first-class chains; this can rate-limit you in production, so use Alchemy/QuickNode/Blast keys.

### Flashblocks on Base (200ms pre-confirmation)

Privy already routes Base + Base Sepolia transactions through Flashblocks RPCs by default. To use your own Flashblocks provider:

```tsx
import {base, baseSepolia} from 'viem/chains';
import {addRpcUrlOverride} from '@privy-io/chains';

const baseWithFlashblocks = addRpcUrlOverride(base, 'insert-flashblocks-rpc-url-for-base');
const baseSepoliaWithFlashblocks = addRpcUrlOverride(
  baseSepolia,
  'insert-flashblocks-rpc-url-for-base-sepolia'
);
```

### WalletConnect project ID

Configured separately from chains, in the external wallet connector config. Required if you allow WalletConnect logins. Not relevant for embedded-only apps.

## EVM wallet hooks

### `useWallets()` filtering

```tsx
import {useWallets} from '@privy-io/react-auth';

const {wallets} = useWallets();
const evmWallets = wallets.filter(w =>
  // ethers/viem-style 0x address
  w.address?.startsWith('0x')
);
const embedded = wallets.find(w => w.walletClientType === 'privy');
const external = wallets.find(w => w.walletClientType !== 'privy');
```

Use `walletClientType === 'privy'` for embedded, NOT `connectorType === 'embedded'` (the latter exists but is less stable across SDK versions).

### `useSendTransaction()` - EVM signature

```tsx
import {useSendTransaction} from '@privy-io/react-auth';

const {sendTransaction} = useSendTransaction();

await sendTransaction({
  to: '0xE3070d3e4309afA3bC9a6b057685743CF42da77C',
  value: 100000,            // wei, can be number, bigint, or hex string
  data: '0x...',            // optional, calldata
  gasLimit: '0x5208',       // optional, defaults to estimate
  chainId: 8453,            // optional, defaults to current active chain
});
```

Returns `{ hash, transactionId, caip2 }`. Privy queues the transaction and shows the user a confirmation modal (unless `showWalletUIs: false`).

### `useSignMessage()` and `useSignTypedData()` (EIP-712)

The `useSignMessage` and `useSignTypedData` hooks (in `@privy-io/react-auth`) wrap `personal_sign` and `eth_signTypedData_v4`. In practice you usually go through the EIP-1193 provider directly:

```tsx
const provider = await wallet.getEthereumProvider();

// personal_sign
const sig = await provider.request({
  method: 'personal_sign',
  params: [message, wallet.address],
});

// eth_signTypedData_v4 (EIP-712)
const sig712 = await provider.request({
  method: 'eth_signTypedData_v4',
  params: [wallet.address, JSON.stringify(typedData)],
});
```

### `useSetActiveWallet()` - switch active wallet

When multiple EVM wallets are connected (embedded + MetaMask + WalletConnect), `useSetActiveWallet` selects which one drives the wagmi connector:

```tsx
import {useSetActiveWallet} from '@privy-io/wagmi';

const {setActiveWallet} = useSetActiveWallet();
useEffect(() => {
  if (embeddedWallet) setActiveWallet(embeddedWallet);
}, [embeddedWallet, setActiveWallet]);
```

This hook lives in `@privy-io/wagmi`, not `@privy-io/react-auth`.

### Chain switching

```tsx
await wallet.switchChain(8453);  // direct call on the wallet object
```

No dedicated `useSwitchChain` hook in `@privy-io/react-auth`; switching is a method on the wallet. With wagmi the standard `useSwitchChain` from `wagmi` works once the wallet is set as active.

### viem WalletClient bridge

```tsx
import {createWalletClient, custom} from 'viem';
import {base} from 'viem/chains';

const provider = await wallet.getEthereumProvider();
const walletClient = createWalletClient({
  account: wallet.address as `0x${string}`,
  chain: base,
  transport: custom(provider),
});

const hash = await walletClient.sendTransaction({
  to: '0x...',
  value: 100000n,
});
```

### ethers BrowserProvider bridge

```tsx
// ethers v5 (what Privy returns directly)
const ethersProvider = await wallet.getEthersProvider();
const signer = ethersProvider.getSigner();
const tx = await signer.sendTransaction({to, value, data});

// ethers v6 (manual wrap)
import {BrowserProvider} from 'ethers';
const eip1193 = await wallet.getEthereumProvider();
const v6Provider = new BrowserProvider(eip1193);
const v6Signer = await v6Provider.getSigner();
```

## EIP-7702 deep dive

### What 7702 is

EIP-7702 is an EVM upgrade (live on mainnet post-Pectra) that lets an EOA temporarily set its code to that of a contract via an authorization signature. Effects:

- Same address, new behavior (batching, sponsorship, session keys).
- Authorization is per-chain (mainnet authorization does not affect Base).
- An EOA can be un-authorized by re-signing with `contractAddress: zeroAddress`.
- Detection: `eth_getCode(eoa)` returns bytecode starting with magic prefix `0xef0100` followed by the 20-byte implementation address.

### Privy's 7702 helper hook

```tsx
import {useSign7702Authorization} from '@privy-io/react-auth';

const {signAuthorization} = useSign7702Authorization();

const authorization = await signAuthorization({
  contractAddress: '0xe6Cae83BdE06E4c305530e199D7217f42808555B',
  chainId: sepolia.id,            // 0 = universal (replayable across chains)
  nonce: 0,                       // EOA's current tx nonce
});
```

Returned `authorization` has `{contractAddress, chainId, nonce, r, s, v}` ready to attach to a type-4 transaction.

### Detecting current authorization state

```ts
import {createPublicClient, http} from 'viem';
import {mainnet} from 'viem/chains';

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http('your RPC URL here')
});
const address = '0x...';

const code = (await publicClient.getCode({address}))?.toLowerCase() ?? '0x';
const prefixIndex = code.indexOf('0xef0100');
const authorizedImplementationAddress =
  prefixIndex === -1
    ? null
    : (`0x${code.slice(prefixIndex + 8, prefixIndex + 48)}` as `0x${string}`);
```

Full helper:

```ts
export function parseEip7702AuthorizedAddress(
  code: string | null | undefined
): `0x${string}` | null {
  if (!code || code === '0x' || code === '0x0') return null;
  const normalized = code.toLowerCase();
  const MAGIC = '0xef0100';
  const idx = normalized.indexOf(MAGIC);
  if (idx === -1) return null;
  return ('0x' + normalized.slice(idx + MAGIC.length, idx + MAGIC.length + 40)) as `0x${string}`;
}
```

### Use cases

- **Batch transactions** in a single user signature (approve + swap, multiple transfers).
- **Gas sponsorship** via paymaster bundles (Pimlico, ZeroDev, Alchemy, Biconomy MEE).
- **Session keys** for ephemeral, scope-limited keys (e.g. an agent that can only spend $50/day).
- **Social recovery** by installing a recovery module after upgrade.

### Limitations and gotchas

- Only works on chains that have implemented Pectra. Some L2s lag.
- Per-chain state - if you upgrade on Base, you must re-authorize on Polygon to use the same implementation there. The `chainId: 0` option lets you replay one signature across chains.
- The implementation address must be deployed onchain at that address on every chain you target.
- 7702 changes how `tx.origin` vs `msg.sender` interact - some legacy contracts can mis-identify the upgraded EOA.

### Full code example (Pimlico-flavored)

```jsx
import {useEffect} from 'react';
import {usePrivy, useSign7702Authorization, useWallets} from '@privy-io/react-auth';
import {useSetActiveWallet} from '@privy-io/wagmi';
import {useWalletClient} from 'wagmi';
import {createPublicClient, http, zeroAddress, Hex} from 'viem';
import {sepolia} from 'viem/chains';
import {createSmartAccountClient} from 'permissionless';
import {createPimlicoClient} from 'permissionless/clients/pimlico';
import {to7702SimpleSmartAccount} from 'permissionless/accounts';

// Get the Privy embedded wallet
const {wallets} = useWallets();
const {data: walletClient} = useWalletClient();
const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === 'privy');

// Set the embedded wallet as active
const {setActiveWallet} = useSetActiveWallet();
useEffect(() => {
  if (embeddedWallet) {
    setActiveWallet(embeddedWallet);
  }
}, [embeddedWallet, setActiveWallet]);

// Create a public client for the chain
const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL)
});

// Create a Pimlico client
const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY;
const pimlicoUrl = `https://api.pimlico.io/v2/${sepolia.id}/rpc?apikey=${pimlicoApiKey}`;
const pimlicoClient = createPimlicoClient({
  chain: sepolia,
  transport: http(pimlicoUrl)
});

// Create a 7702 simple smart account
const simple7702Account = await to7702SimpleSmartAccount({
  client: publicClient,
  owner: walletClient
});

// Create the smart account client
const smartAccountClient = createSmartAccountClient({
  client: publicClient,
  chain: sepolia,
  account: simple7702Account,
  paymaster: pimlicoClient,
  bundlerTransport: http(pimlicoUrl)
});

// Sign the EIP-7702 authorization
const {signAuthorization} = useSign7702Authorization();
const authorization = await signAuthorization({
  contractAddress: '0xe6Cae83BdE06E4c305530e199D7217f42808555B',
  chainId: sepolia.id,
  nonce: await publicClient.getTransactionCount({
    address: walletClient.account.address
  })
});

// Send a gas-sponsored transaction
const transactionHash = await smartAccountClient.sendTransaction({
  to: zeroAddress,
  value: 0n,
  data: '0x',
  authorization,
  paymasterContext: {
    sponsorshipPolicyId: process.env.NEXT_PUBLIC_SPONSORSHIP_POLICY_ID
  }
});
```

## Batch transactions

### Mechanism

EVM batches use `wallet_sendCalls` (EIP-5792). Under the hood Privy upgrades the EOA to a Kernel smart contract via EIP-7702 the first time a batch is requested. Calls are bundled into `self.execute(...)` and submitted atomically: either all succeed or the whole batch reverts.

With `sponsor: true`, the batch goes through a bundler + paymaster.

### `useSendTransaction` with array of calls

Server-side (`@privy-io/node`):

```typescript
import {PrivyClient} from '@privy-io/node';

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!
});

const response = await privy
  .wallets()
  .ethereum()
  .sendCalls('insert-wallet-id', {
    caip2: 'eip155:8453', // Base
    params: {
      calls: [
        {
          to: '0xRecipientAddress1',
          value: '0x2386F26FC10000' // 0.01 ETH in wei
        },
        {
          to: '0xRecipientAddress2',
          value: '0x2386F26FC10000' // 0.01 ETH in wei
        }
      ]
    }
  });
```

REST (cURL):

```bash
curl --request POST \
  --url https://api.privy.io/v1/wallets/{wallet_id}/rpc \
  --header 'Authorization: Basic <encoded-value>' \
  --header 'Content-Type: application/json' \
  --header 'privy-app-id: <privy-app-id>' \
  --data '{
  "method": "wallet_sendCalls",
  "caip2": "eip155:8453",
  "chain_type": "ethereum",
  "params": {
    "calls": [
      {
        "to": "0xRecipientAddress1",
        "value": "0x2386F26FC10000"
      },
      {
        "to": "0xRecipientAddress2",
        "value": "0x2386F26FC10000"
      }
    ]
  }
}'
```

### Atomicity guarantees

Either all calls succeed (and one combined receipt is returned) or the entire transaction reverts. There is no partial-success state. This is the same guarantee Solana provides natively via multi-instruction transactions.

### Approve + swap in one batch

```typescript
import {encodeFunctionData, erc20Abi} from 'viem';

// Encode the approval call
const approveData = encodeFunctionData({
  abi: erc20Abi,
  functionName: 'approve',
  args: ['0xSwapRouterAddress', BigInt(1000000)] // Approve 1 USDC (6 decimals)
});

// Encode the swap call (example ABI)
const swapData = encodeFunctionData({
  abi: swapRouterAbi,
  functionName: 'exactInputSingle',
  args: [swapParams]
});

const response = await privy
  .wallets()
  .ethereum()
  .sendCalls('insert-wallet-id', {
    caip2: 'eip155:8453',
    params: {
      calls: [
        {
          to: '0xUSDCContractAddress',
          data: approveData
        },
        {
          to: '0xSwapRouterAddress',
          data: swapData
        }
      ]
    }
  });
```

Response:

```json
{
  "method": "wallet_sendCalls",
  "data": {
    "transaction_id": "b4966a89-8983-4b1b-a93a-b104799527f5",
    "caip2": "eip155:8453"
  }
}
```

## Gas sponsorship

### Setting `sponsor: true`

Once gas sponsorship is enabled in the Privy dashboard and you have gas credits, set `sponsor: true` on any transaction request:

```bash
curl --request POST \
  --url https://api.privy.io/v1/wallets/{wallet_id}/rpc \
  --header 'Authorization: Basic <encoded-value>' \
  --header 'Content-Type: application/json' \
  --header 'privy-app-id: <privy-app-id>' \
  --data '{
  "method": "wallet_sendCalls",
  "caip2": "eip155:8453",
  "chain_type": "ethereum",
  "sponsor": true,
  "params": {
    "calls": [
      { "to": "0xRecipientAddress1", "value": "0x2386F26FC10000" },
      { "to": "0xRecipientAddress2", "value": "0x2386F26FC10000" }
    ]
  }
}'
```

### When the app pays vs the user

- `sponsor: true` and gas credits available - app's paymaster signs over the user op, app's gas credits decrement, user's native balance is untouched.
- `sponsor: true` and no gas credits - request fails or falls back depending on paymaster config.
- `sponsor: false` (default for low-level RPC) - user's native token balance pays for gas. Required for wallets actions API, which auto-sponsors but falls back to user-pays if sponsorship is disabled.
- Wallet action APIs (transfer, swap, earn) **optimistically sponsor** without an explicit flag.

### Custom rate limits

Privy exposes app-wide spend caps in the dashboard. For finer control (per-wallet, per-user) implement client-side gating:

```tsx
const LIMITS = {
  perWalletDailyCents: 200,  // $2 per wallet per day
  perUserDailyCents: 500,    // $5 per user per day
  perAppDailyCents: 10000    // $100 per app per day
};

interface SpendTracker {
  date: string; // YYYY-MM-DD
  spentCents: number;
}

const walletSpend = new Map<string, SpendTracker>();
const userSpend = new Map<string, SpendTracker>();
let appSpend: SpendTracker = {date: '', spentCents: 0};

const CHAIN_COSTS: Record<string, number> = {
  'eip155:1': 100,       // Ethereum: ~$1
  'eip155:8453': 5,      // Base: ~$0.05
  'solana:mainnet': 1    // Solana: ~$0.01
};

function estimateCostCents(chainId: string): number {
  return CHAIN_COSTS[chainId] || 100;
}

function canSponsor(
  walletAddress: string,
  userId: string,
  costCents: number
): {allowed: boolean; reason?: string} {
  const today = new Date().toISOString().split('T')[0];

  let walletTracker = walletSpend.get(walletAddress);
  if (!walletTracker || walletTracker.date !== today) {
    walletTracker = {date: today, spentCents: 0};
  }
  if (walletTracker.spentCents + costCents > LIMITS.perWalletDailyCents) {
    return {allowed: false, reason: 'Wallet daily limit reached'};
  }

  let userTracker = userSpend.get(userId);
  if (!userTracker || userTracker.date !== today) {
    userTracker = {date: today, spentCents: 0};
  }
  if (userTracker.spentCents + costCents > LIMITS.perUserDailyCents) {
    return {allowed: false, reason: 'User daily limit reached'};
  }

  if (appSpend.date !== today) appSpend = {date: today, spentCents: 0};
  if (appSpend.spentCents + costCents > LIMITS.perAppDailyCents) {
    return {allowed: false, reason: 'App daily limit reached'};
  }

  return {allowed: true};
}

async function sendTransaction({userId, walletAddress, chainId, transaction}) {
  const estimatedCostCents = estimateCostCents(chainId);
  const {allowed, reason} = canSponsor(walletAddress, userId, estimatedCostCents);

  const response = await fetch(`https://api.privy.io/v1/wallets/${walletAddress}/rpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'privy-app-id': process.env.PRIVY_APP_ID!,
      Authorization: `Bearer ${process.env.PRIVY_APP_SECRET}`
    },
    body: JSON.stringify({
      method: 'eth_sendTransaction',
      params: {transaction: {transaction}},
      caip2: chainId,
      sponsor: allowed   // Conditionally sponsor based on limits
    })
  });
}
```

Production tweaks: swap in-memory Maps for Redis, sliding-window counters instead of daily resets, per-tx caps in addition to volume caps.

## Speed-up / cancel transactions

### Replace-by-fee (RBF)

EVM has no native RBF, but you can replace a pending transaction by sending a new one with **the same nonce** and a higher `max_priority_fee_per_gas`. The mempool drops the older bid.

### Webhook-driven replacement flow

1. Subscribe to `transaction.still_pending` webhook in the dashboard.
2. When the webhook fires, your backend already has the original transaction's nonce in the payload.
3. Resubmit with the same `nonce`; omit gas fields to let Privy pick fresh values, or explicitly bump the priority fee.

Webhook payload:

```json
{
  "caip2": "eip155:8453",
  "transaction_hash": "0x28f0ae628c08b7a341cd49ea40225d54ddd5acfe5f7ccfb44ee0be154d17bab0",
  "transaction_id": "b2ua14lrsfj2kq8r8mlm9z07",
  "transaction_request": {
    "chain_id": 8453,
    "gas_limit": "0x5208",
    "max_fee_per_gas": "0xadc0e",
    "max_priority_fee_per_gas": "0xf4240",
    "data": "0x....",
    "nonce": 0,
    "to": "0x38Bc05d7b69F63D05337829fA5Dc4896F179B5fA",
    "type": 2,
    "value": "0x0"
  },
  "type": "transaction.still_pending",
  "wallet_id": "<wallet-id-from-payload>"
}
```

Replacement send via Node SDK:

```ts
// payload is from the webhook
const {hash, transactionId, caip2} = await privy
  .wallets()
  .ethereum()
  .sendTransaction(payload.wallet_id, {
    caip2: payload.caip2,
    params: {
      transaction: {
        to: payload.transaction_request.to,
        value: payload.transaction_request.value,
        data: payload.transaction_request.data,
        nonce: payload.transaction_request.nonce
      }
    }
  });
```

### Cancelling a stuck tx

Cancellation is a replacement with `to: <your own address>`, `value: 0`, same nonce, higher gas. The replacement burns the nonce slot without performing the original action.

### Monitoring outcomes

Subscribe to `transaction.replaced`, `transaction.confirmed`, `transaction.failed` to know whether the speed-up worked:

- success: original gets `transaction.replaced`, replacement gets `transaction.confirmed`
- failure: replacement gets `transaction.failed`

### `useSpeedUpTransaction` hook

Not a client-side hook in the current `@privy-io/react-auth` surface. The flow is server-side via webhooks + sendTransaction.

## Code patterns (verbatim from docs)

### Provider config with chains

```tsx
import {base, berachain, polygon, arbitrum, story, mantle, tempo} from 'viem/chains';

<PrivyProvider
    appId='your-privy-app-id'
    config={{
        ...theRestOfYourConfig,
        defaultChain: base
        supportedChains: [base, berachain, polygon, arbitrum, story, mantle, tempo]
    }}
>
    {/* your app's content */}
</PrivyProvider>
```

### Send native ETH (client, `useSendTransaction`)

```tsx
import {useSendTransaction} from '@privy-io/react-auth';
export default function SendTransactionButton() {
  const {sendTransaction} = useSendTransaction();
  const onSendTransaction = async () => {
    sendTransaction({
      to: '0xE3070d3e4309afA3bC9a6b057685743CF42da77C',
      value: 100000
    });
  };

  return <button onClick={onSendTransaction}>Send Transaction</button>;
}
```

### Send ERC-20 (encode `transfer(address,uint256)` via viem)

```tsx
import {encodeFunctionData, erc20Abi} from 'viem';

const data = encodeFunctionData({
  abi: erc20Abi,
  functionName: 'transfer',
  args: [recipientAddress, amountInTokenUnits]
});

await sendTransaction({
  to: tokenContractAddress,
  data,
});
```

### Sign EIP-712 typed data via provider

```tsx
const provider = await wallet.getProvider();

const signature = await provider.request({
  method: 'eth_signTypedData_v4',
  params: [wallet.address, quoteResult.permit2.eip712]
});
```

### Switch chain

```tsx
await wallet.switchChain(8453);
```

### Batch 2 calls via 7702 (Biconomy MEE)

```ts
import {useSign7702Authorization} from '@privy-io/react-auth';
import {baseSepolia} from '@privy-io/chains';

const {signAuthorization} = useSign7702Authorization();
const NEXUS_V120 = '0x000000004F43C49e93C970E84001853a70923B03';

const authorization = await signAuthorization({
  contractAddress: NEXUS_V120,
  chainId: baseSepolia.id, // or 0 for universal
  nonce: 0
});
```

### Sponsored tx setup (Pimlico)

```jsx
<PrivyProvider
  config={{
    embeddedWallets: {
      createOnLogin: 'all-users'
      showWalletUIs: false
    }
  }}
>
```

### 0x v2 + Permit2 swap (verbatim, USDC -> ETH on Base)

Approve Permit2 (one-time per token):

```tsx
import {maxUint256, erc20Abi, encodeFunctionData, createPublicClient, http} from 'viem';

const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const provider = await wallet.getProvider();

const data = encodeFunctionData({
  abi: erc20Abi,
  functionName: 'approve',
  args: [PERMIT2_ADDRESS, maxUint256]
});

const tx = await provider.request({
  method: 'eth_sendTransaction',
  params: [
    {
      from: wallets[0].address,
      to: USDC_ADDRESS,
      data
    }
  ]
});
```

Get quote:

```tsx
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const CHAIN_ID = 8453;
const USDC_DECIMALS = 6;
const formattedAmount = 100 * 10 ** 6;

const quoteResponse = await fetch(
  `https://api.0x.org/swap/permit2/quote?chainId=${CHAIN_ID}&sellToken=${USDC_ADDRESS}&buyToken=${ETH_ADDRESS}&sellAmount=${formattedAmount}&taker=${wallet.address}`,
  {
    headers: {
      '0x-api-key': process.env.API_KEY_0X,
      '0x-version': 'v2'
    }
  }
);
```

Sign Permit2 + execute:

```tsx
import {numberToHex, concat, size} from 'viem';

const provider = await wallet.getProvider();

// Sign an off-chain signature for the permit
const signature = await provider.request({
  method: 'eth_signTypedData_v4',
  params: [wallet.address, quoteResult.permit2.eip712]
});
const signatureLengthInHex = numberToHex(size(signature), {
  signed: false,
  size: 32
});

// Pack the transaction for the trade fulfillment, including the off-chain signature
const transactionData = concat([quoteResult.transaction.data, signatureLengthInHex, signature]);
```

## Spectre-specific notes

### Supported chains (both apps)

| Chain | Chain ID | RPC env var | Public fallback |
|-------|----------|-------------|-----------------|
| Ethereum | 1 | `VITE_ETH_RPC_URL` | `https://eth.llamarpc.com` |
| BSC | 56 | `VITE_BSC_RPC_URL` | `https://bsc-dataseed.binance.org` |
| Polygon | 137 | `VITE_POLYGON_RPC_URL` | `https://polygon-rpc.com` |
| Arbitrum | 42161 | `VITE_ARB_RPC_URL` | `https://arb1.arbitrum.io/rpc` |
| Base | 8453 | `VITE_BASE_RPC_URL` | `https://mainnet.base.org` |

Solana is also supported via `VITE_SOLANA_RPC_URL` plus Codex networkId `1399811149`. See `03-solana-integration.md`.

### `walletService.js` (trading + research apps)

Files: `apps/trading/src/services/walletService.js` (313 lines) and `apps/research/src/services/walletService.js` (390 lines).

- Uses **ethers v6** (`import { ethers } from 'ethers'`), NOT v5. This is independent of Privy's v5 BrowserProvider - we never wrap Privy's provider here; this service only does read-only RPC.
- Singleton EVM provider cache keyed by chain id: `const providerCache = new Map(); ... new ethers.JsonRpcProvider(chain.rpcUrl)`. Never create per-call providers.
- Native balance: `provider.getBalance(address)` -> `ethers.formatUnits(raw, decimals)`.
- ERC-20 balance: `new ethers.Contract(tokenAddr, ERC20_ABI, provider).balanceOf(address)` with a 2-method ABI `['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)']`.

### Multicall3 gap (tech debt)

The research app's `walletService.js` batches `getEthBalance(address)` + `balanceOf(address)` for every token into a single Multicall3 `aggregate3()` call. The trading app does sequential `Promise.all` on individual `contract.balanceOf` calls.

- Multicall3 address: `0xcA11bde05977b3631167028862bE2a173976CA11` - same on Ethereum, BSC, Polygon, Arbitrum, Base.
- Hand-encoded ERC-20 calldata to skip ABI overhead:
  ```js
  const BALANCE_OF_SELECTOR = '0x70a08231'
  const paddedAddress = address.slice(2).toLowerCase().padStart(64, '0')
  const balanceOfCalldata = BALANCE_OF_SELECTOR + paddedAddress
  ```
- Trading app should be migrated to Multicall3 (use research app as reference).

### Swap routing: 0x v2, not Privy built-in

Spectre does NOT use Privy's `/wallets/{id}/swap` action API. Reasons:

1. Privy swap routes through Uniswap only - we want 0x aggregation across DEXes for better rates.
2. Privy swap is server-side and requires custodial server signing - we are non-custodial.
3. We charge our own platform fee server-side via 0x's `feeRecipient` parameter.

Flow (see `apps/trading/src/hooks/useSwapExecution.js` and `apps/research/src/hooks/useSwapExecution.js`):

```
useSwapExecution
  -> POST /api/swap/quote (server)
       -> 0x Permit2 quote with feeRecipient + feeBps
       -> returns { swapTransaction, allowanceTarget, permit2, chain }
  -> ensureTokenApproval(signer, inputToken, allowanceTarget, inputAmount)
  -> wallet.getEthersProvider() (ethers v5 from Privy)
  -> signer.sendTransaction({ to, data, value, gasLimit, gasPrice })
  -> waitForConfirmation(hash, chain, 60000ms)
```

### What we do NOT use

- **EIP-7702 authorizations**. We send classic type-2 transactions.
- **Batch transactions** (`wallet_sendCalls`). We send approve and swap as two separate user-signed transactions.
- **Gas sponsorship** (paymaster). User pays in native token (with a 0.001 native reserve guard for max-amount).
- **Smart wallets / ERC-4337**. EOAs only.
- **Privy wallet action APIs** (transfer/swap/earn endpoints). All transaction construction happens client-side or on our own Express server.

These are all open paths for future work - 7702 batching of approve+swap would remove a round-trip; sponsorship would let us cover gas for new users.

### Native token sentinel

0x uses `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` as the sentinel for native ETH/BNB/MATIC. The approval step in our swap flow skips this address. The research app's internal model uses `address: 'native'` for the same concept - the boundary mapping happens in `useSwapExecution.js`.

### Privy config differences

| Setting | Research | Trading |
|---------|----------|---------|
| Login API | `loginMethodsAndOrder` (v2) | `loginMethods` (v1 legacy, do not upgrade without testing Solana flow) |
| Solana external connectors | `toSolanaWalletConnectors` (Phantom/Solflare) | None |
| Embedded wallet creation | ETH + SOL on signup | ETH + SOL on signup |
| `walletChainType` | `'ethereum-and-solana'` | `'ethereum-and-solana'` |

Both apps register the same EVM chains for embedded wallets. RPC URLs come from `VITE_*_RPC_URL` env vars at build time.

## Gotchas and pitfalls

### EIP-1193 provider != viem WalletClient

`wallet.getEthereumProvider()` returns a raw EIP-1193 provider (the `request({method, params})` shape). To use viem APIs you must wrap:

```ts
const walletClient = createWalletClient({
  account: wallet.address as `0x${string}`,
  chain: base,
  transport: custom(provider),
});
```

Calling `provider.sendTransaction(...)` directly does not exist - it is always `provider.request({method: 'eth_sendTransaction', params: [...]})`.

### ethers v5 vs v6

`wallet.getEthersProvider()` returns an ethers v5 `Web3Provider`. If your app uses ethers v6:

```ts
import {BrowserProvider} from 'ethers';
const eip1193 = await wallet.getEthereumProvider();
const v6 = new BrowserProvider(eip1193);
```

Do not mix versions in the same file. Spectre's `walletService.js` is read-only and uses ethers v6 with its own `JsonRpcProvider` - it never wraps Privy's provider, so it can stay on v6.

### `chainId` shape (number vs hex vs CAIP-2)

- `wallet.chainId` returns a CAIP-2 string in newer SDKs (`'eip155:8453'`), plain number in older SDKs (`8453`).
- viem expects plain numbers in chain objects.
- ethers v5 wants hex strings in some APIs (`0x2105` for Base). Use `ethers.toQuantity` to convert.
- The Privy REST API uses CAIP-2 strings everywhere.

Always parse defensively:

```ts
function toNumericChainId(raw: string | number): number {
  if (typeof raw === 'number') return raw;
  if (raw.startsWith('eip155:')) return parseInt(raw.slice(7), 10);
  if (raw.startsWith('0x')) return parseInt(raw, 16);
  return parseInt(raw, 10);
}
```

### Chain switching - embedded vs external

- Embedded wallets switch silently within `supportedChains`. Throws if you target a chain not in the list.
- External wallets prompt the user. The user can decline; your UI must react to `wallet.chainId` changes after the prompt resolves.
- MetaMask mobile via WalletConnect historically had flaky `wallet_switchEthereumChain` handling - Privy stopped prompting it automatically on login for this connector (see changelog).
- Some external wallets refuse certain `defaultChain`s (Rainbow Wallet mobile rejects testnets; Trust SWIFT only supports a fixed list).

### `useSendTransaction` defaults

If you omit `chainId`, the transaction is sent on the wallet's **current active chain**, not your app's `defaultChain`. If the user manually switched MetaMask to a chain outside `supportedChains`, the call may throw or land on the wrong chain. Always pass `chainId` explicitly for high-value transactions.

### EIP-7702 availability

Only chains that have implemented Pectra support 7702. Mainnet post-Pectra; many L2s lag. Test on Sepolia first. The `authorization` returned by `useSign7702Authorization` is per-chain by default - use `chainId: 0` for universal but understand the replay implications.

### Multicall3 ubiquity

Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`) is deployed at the same address on Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, Avalanche, and most other EVM chains. Use it for read-batching. Falls back gracefully: try Multicall3, on revert do parallel `contract.balanceOf` calls.

### Provider caching

Never create a new `ethers.JsonRpcProvider` per request. The TCP handshake + chain id RPC adds 200-500ms latency. Cache by chainId in a module-level `Map`. Same rule for `Connection` in Solana.

### Gas reserves on max-amount UX

If the user clicks "Max" on a native-token swap, reserve gas before computing the max:

```js
const reserve = activeChain === 'solana' ? 0.01 : 0.001
const max = Math.max(0, availableBalance - reserve)
```

Sending exactly the balance will revert with "insufficient funds for gas".

### Permit2 + Privy chain mismatch

`eth_signTypedData_v4` requires the signer to be on the chain in the typed data's `domain.chainId`. If the user is on Ethereum but the swap is on Base, the signature is rejected onchain. Call `wallet.switchChain(quote.chainId)` before signing the Permit2 payload.

## Cross-references

- Solana parallel - `03-solana-integration.md`
- Generic tx/signing surface - `05-transactions-and-signing.md`
- EVM swaps via 0x and Bebop - `06-swaps-and-trading.md`
- Server-side EVM signing - `08-server-sdk.md`
- Embedded wallet creation and login methods - `02-embedded-wallets.md`
