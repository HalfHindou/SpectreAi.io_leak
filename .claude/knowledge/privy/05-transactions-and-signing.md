---
description: Privy transactions & signing reference (useSendTransaction, sign message/typed-data, idempotency, action status, expiry). Synthesized from official docs.
---

# Privy Transactions & Signing

## Source docs synthesized

The following official Privy docs from `C:\Users\worka\OneDrive\Desktop\Privy\` feed this reference:

- `create.md` - creating key quorums and associated resources used in signing
- `sign.md` - signing requests with key quorums, top-level primitive
- `signing-on-the-client.md` - automatic client-side signing via Privy SDKs
- `signing-on-the-server.md` - server-side signing via `AuthorizationContext`
- `request.md` - user owners & signers (request a user key, sign, attach signature)
- `request-expiry.md` - `privy-request-expiry` header and SDK defaults
- `idempotency-keys.md` - `privy-idempotency-key` header and dedupe behavior
- `Wallet Actions.md` - wallet actions overview (`/transfer`, `/swap`, `/earn`)
- `Get wallet action status.md` - polling an action by ID, status enum, `?include=steps`
- `execute.md` - executing a swap as a wallet action
- `Bridging.md` - cross-chain transfers, signing applies the same way
- `programmable.md` - programmable controls (1-of-k, m-of-k, scoped signers)
- `authorization-signatures.md` - `privy-authorization-signature` header
- `offline.md` - offline actions via additional signer authorization key
- `batch-transactions.md` - EVM `wallet_sendCalls` (EIP-7702) + Solana multi-ix
- `speeding-up-transactions.md` - EVM replacement tx via webhook + same nonce

Server SDK signing details (`AuthorizationContext`, custom sign fns, JWT-based user keys) are also in `08-server-sdk.md`.

## Core concepts

Privy signing has two distinct layers that often get confused. Keep them straight.

### Layer 1 - wallet signature (the user signs an onchain message or transaction)

These are the chain-level primitives the wallet produces:

- `personal_sign` - EVM, signs arbitrary UTF-8 bytes (most common message sign)
- `eth_signTypedData_v4` - EVM, signs EIP-712 structured data
- `eth_signTransaction` - EVM, returns a signed raw tx (does NOT broadcast)
- `eth_sendTransaction` - EVM, signs AND broadcasts
- `signMessage` (Solana) - signs a UTF-8 message
- `signTransaction` (Solana) - signs a `Transaction` or `VersionedTransaction`
- `signAndSendTransaction` (Solana) - signs and broadcasts via Privy's RPC
- `signAllTransactions` (Solana) - signs an array of txs (used for Jupiter route building)

### Layer 2 - authorization signature (your backend proves it is allowed to ask Privy to take an action)

A separate P-256 ECDSA signature over the API request payload, sent in the `privy-authorization-signature` header. Required when a wallet/policy has an `owner_id` set (key quorum) or has explicit signers. Computed automatically by Privy SDKs when you supply an `AuthorizationContext`.

The two layers compose: a server-side `eth_sendTransaction` for a user-owned wallet needs (a) a valid authorization signature in the header so Privy will accept the request, and Privy then (b) produces the wallet's onchain signature inside the TEE using the user's signing key.

### Send-tx flow (high level)

```
build payload -> sign request (authz signature) -> Privy TEE signs onchain payload
              -> broadcast via Privy RPC      -> caller polls for confirmation
```

### Chain abstraction

Privy exposes the same method shapes for EVM and Solana, but the params change shape. Server SDKs split them into `.wallets().ethereum()` and `.wallets().solana()` subclients. Client React SDK exposes `useSendTransaction()` / `useSignMessage()` / `useSignTypedData()` that branch on wallet chainType.

### Idempotency keys

A V4 UUID sent in `privy-idempotency-key` that guarantees a state-changing POST is processed at most once within a 24-hour window. Required for production swap/transfer flows that may be retried over flaky networks. See section "Idempotency keys" below.

### Request expiry

A Unix-ms deadline in `privy-request-expiry` after which Privy rejects the request. Privy SDKs default to 15 minutes (72 hours for intents endpoints). The header value is part of the signed payload, so it cannot be tampered with after signing. See section "Request expiry" below.

### Wallet actions

Higher-level async APIs (`/transfer`, `/swap`, `/earn`) that abstract multi-step onchain flows. Each call returns an action `id` with `status: 'pending' | 'succeeded' | 'rejected' | 'failed'` ('created' is listed in the doc as the initial queued state). Track via `GET /v1/wallets/{wallet_id}/actions/{action_id}` or webhooks. Lower-level alternative is direct RPC (`/v1/wallets/{wallet_id}/rpc`).

## API surface

### Client SDK (`@privy-io/react-auth`)

- `useSendTransaction()` - returns `sendTransaction(tx, { address, uiOptions })`. EVM tx shape is viem-compatible; Solana takes a serialized `VersionedTransaction`.
- `useSignMessage()` - returns `signMessage({ message }, { address, uiOptions })`.
- `useSignTypedData()` - returns `signTypedData(typedData)` for EIP-712 v4.
- `useSignTransaction()` - signs WITHOUT broadcasting. Returns the signed raw tx for the caller to relay manually.
- `usePrivy()` - exposes `getAccessToken()` for backend handoff (paired with the server SDK).
- `useWallets()` - returns the array of connected wallets, each with `getEthereumProvider()` / `getProvider()` for chain-level operations.

The `uiOptions` object controls the confirmation modal copy/icon. `showWalletUIs: false` is the toggle to suppress the modal entirely - reserve for trusted programmatic flows (we do NOT use it in Spectre).

### Server SDK (`@privy-io/node`)

- `privy.wallets().ethereum().signMessage(walletId, { message, authorization_context })`
- `privy.wallets().ethereum().signTransaction(walletId, { caip2, params: { transaction }, authorization_context })`
- `privy.wallets().ethereum().sendTransaction(walletId, { caip2, params: { transaction }, idempotency_key, request_expiry, authorization_context })`
- `privy.wallets().ethereum().sendCalls(walletId, { caip2, sponsor, params: { calls }, ... })` - batch via `wallet_sendCalls`
- `privy.wallets().solana().signMessage(walletId, ...)` / `.signTransaction(...)` / `.signAndSendTransaction(...)`
- `privy.wallets().transfer(walletId, { source, destination })` - wallet action (also handles cross-chain bridging)
- `privy.wallets().swap(walletId, { caip2, input_token, output_token, amount, ... })` - wallet action
- `privy.wallets().actions().get(walletId, actionId, { include: 'steps' })` - polling

### REST API (low level)

- `POST /v1/wallets/{wallet_id}/rpc` - generic RPC. Body: `{ caip2, method, params }`. Headers: `privy-app-id`, `privy-authorization-signature`, `privy-idempotency-key`, `privy-request-expiry`, Basic auth.
- `POST /v1/wallets/{wallet_id}/transfer` - wallet action
- `POST /v1/wallets/{wallet_id}/swap` - wallet action
- `GET /v1/wallets/{wallet_id}/actions/{action_id}` - poll status; `?include=steps` for per-step detail
- `POST /v1/wallets/authenticate` - request a user signing key with a user JWT (server-only, never expose to client)

## Client signing flow

The React SDK handles signing automatically. The typical user flow:

```
user clicks "Swap"
    |
component calls sendTransaction(tx, { address })
    |
Privy SDK opens the confirmation modal (UI)
    |
user confirms
    |
SDK fetches an ephemeral user signing key (P-256) from the Privy TEE
    |
SDK signs the API request with the user key (this is the authorization signature)
    |
request hits Privy API: POST /v1/wallets/{walletId}/rpc with eth_sendTransaction
    |
Privy TEE validates the authz signature, signs the onchain payload, broadcasts
    |
SDK resolves the promise with { hash, transactionId, caip2 }
```

**Important**: with the client SDK, you do NOT manually construct authorization signatures. The SDK does it under the hood using the ephemeral user signing key. From `signing-on-the-client.md`:

> When using Privy's client-side SDKs, you do not need to implement any additional logic to sign requests to the Privy API.

### `showWalletUIs` and `noPromptOnSignature`

- `uiOptions.showWalletUIs = false` - suppresses the confirmation modal for the call. Useful for chained operations where one modal covers multiple signs. Risk: any caller code reaching that path will sign without user confirmation, so guard tightly.
- `noPromptOnSignature` policy - a server-side policy attached to a signer that lets that signer sign without showing the user a modal at all. Used for additional signers on offline action flows (see "Offline signing" below).

Spectre uses neither today. Every signature flow opens the Privy modal so the user sees the destination + amount.

### Error handling

The promise can reject with:

- User rejection - `error.message` includes `'cancelled'`, `'canceled'`, or `'rejected'`. Spectre's `useSwapExecution` swallows this silently (returns `{ success: false, error: 'Transaction cancelled' }`).
- Timeout - Privy modal stays open until the user acts or the page navigates. Solana blockhash can expire while the user thinks.
- Network failure - request to the Privy API failed before signing started.
- Action rejected - the wallet's policy returned a denial (Privy's policy engine ran).
- Insufficient funds - chain-level revert.

## Idempotency keys

Verbatim guarantee from `idempotency-keys.md`:

> Privy guarantees that a request with the same idempotency key will only be processed once within a 24-hour window.

### Behavior

- First request with a new key: processed normally, request+response stored for 24h.
- Same key reused within 24h with the **same body**: stored response returned, no re-execution.
- Same key reused within 24h with a **different body**: 400 error.
- After 24h: key expires, normal processing on the next use.

### When to use

- Any state-changing POST (transactions, transfers, swaps, wallet updates).
- Background jobs that may retry on network errors.
- Critical operations where a duplicate execution is unacceptable.

### Generating keys

```ts
import { v4 as uuidv4 } from 'uuid';
const idempotencyKey = uuidv4();
```

Use one key per logical action, persist it alongside your DB record so retries reuse the same key.

### Passing the key

**Server SDK** (TypeScript Node):

```ts
import {PrivyClient} from '@privy-io/node';
import {v4 as uuidv4} from 'uuid';

const client = new PrivyClient({appId: '$PRIVY_APP_ID', appSecret: '$PRIVY_APP_SECRET'});

const idempotencyKey = uuidv4();

const res = await client
  .wallets()
  .ethereum()
  .sendTransaction('$WALLET_ID', {
    idempotency_key: idempotencyKey,
    caip2: 'eip155:8453',
    params: {
      transaction: {
        to: '0xE3070d3e4309afA3bC9a6b057685743CF42da77C',
        value: '0x2386F26FC10000',
        chain_id: 8453
      }
    }
  });
```

**REST API**:

```ts
import axios from 'axios';
import {v4 as uuidv4} from 'uuid';

const idempotencyKey = uuidv4();

const response = await axios.post(
  'https://api.privy.io/api/v1/wallets/y5ofctvacjiv53u4hmnqi0e5/rpc',
  {
    caip2: 'eip155:8453',
    method: 'eth_sendTransaction',
    params: {
      transaction: {
        to: '0xE3070d3e4309afA3bC9a6b057685743CF42da77C',
        value: '0x2386F26FC10000',
        chainId: 8453
      }
    }
  },
  {
    headers: {
      'privy-app-id': 'insert-your-app-id',
      'privy-idempotency-key': idempotencyKey,
      Authorization: 'Bearer insert-your-api-key'
    }
  }
);
```

## Request expiry

The `privy-request-expiry` header is a Unix timestamp in **milliseconds**. Privy rejects requests where the timestamp is in the past with a `request_expired` error.

### Defaults

- Privy SDKs: 15 minutes by default.
- Intents endpoints (the ones that quote a future operation): 72 hours by default.
- Header is mandatory if you compute authorization signatures manually - it MUST be included in the signature payload.

### Overriding the default

Globally on client construction or per-request:

```ts
import {PrivyClient} from '@privy-io/node';

// Configure custom default expiries globally (in milliseconds)
const privy = new PrivyClient({
  appId: 'your-app-id',
  appSecret: 'your-app-secret',
  requestExpiry: {
    defaultMs: 10 * 60 * 1000, // 10 minutes for standard calls
    defaultIntentMs: 24 * 60 * 60 * 1000 // 24 hours for intents endpoints
  }
});

const walletId = 'your-wallet-id';

// Uses the configured default expiry (10 minutes)
const responseWithDefaultExpiry = await privy.wallets().ethereum().signMessage(walletId, {
  message: 'Hello, world!'
});

// Override the expiry for a specific request
const responseWith5MinExpiry = await privy
  .wallets()
  .ethereum()
  .signMessage(walletId, {
    message: 'Hello, world!',
    request_expiry: privy.getRequestExpiry(5 * 60 * 1000) // 5 minutes
  });
```

### Including in authz signature

When you compute the authorization signature manually, embed the expiry in the signed payload under `headers`:

```json
{
  "version": 1,
  "method": "POST",
  "url": "https://api.privy.io/api/v1/wallets/<wallet_id>/rpc",
  "body": {
    "method": "personal_sign",
    "params": {
      "message": "Hello, world!"
    }
  },
  "headers": {
    "privy-app-id": "insert-your-app-id",
    "privy-request-expiry": "1773679531000"
  }
}
```

If the header value sent on the wire does not match the signed value, Privy rejects with a signature mismatch.

### Common bug

Using seconds instead of milliseconds. From `request-expiry.md`:

> The expiry value must be a Unix timestamp in **milliseconds**, not seconds. Using seconds will result in a timestamp that appears to be far in the past, and the request will be rejected.

## Wallet action status

Wallet actions (`/transfer`, `/swap`, `/earn`) execute asynchronously. The POST returns immediately with an action `id`; the caller polls or listens for a webhook to learn when it succeeded.

### Status values

| Status | Description |
| --- | --- |
| `created` | Wallet action has been queued for execution and resource ID has been returned to the caller. |
| `pending` | Underway. For swaps this means approval/swap txs submitted; for bridges the source-chain tx is submitted and the fill is in progress. |
| `succeeded` | All steps of the wallet action have successfully executed. Terminal. |
| `rejected` | The wallet action was rejected prior to executing any steps, e.g. due to a policy violation. Terminal and safe to retry. |
| `failed` | The wallet action failed during execution of one of its steps. Use `?include=steps` to inspect what went wrong. |

### Polling

```bash
curl https://api.privy.io/v1/wallets/{wallet_id}/actions/{action_id}?include=steps \
  -u "<your-privy-app-id>:<your-privy-app-secret>" \
  -H "privy-app-id: <your-privy-app-id>"
```

The docs note: "Wallet actions typically complete within a few seconds, but can take longer depending on network conditions. Poll infrequently and stop once the `status` reaches a terminal value (`succeeded`, `rejected`, or `failed`)."

### Without `include=steps`

You get the overall action only. Useful for a status badge.

### With `include=steps`

Each step has its own `status`, `caip2`, and `transaction_hash`. Use this to surface the explorer link or diagnose a `failed` action.

### Webhook alternative

Subscribe to `wallet_action.transfer.succeeded`, `wallet_action.swap.succeeded`, `transaction.confirmed`, `transaction.failed`, `transaction.replaced`, `transaction.still_pending`. See `11-security-and-webhooks.md` for the full event list.

## Sign authorization payloads

The `privy-authorization-signature` header is a P-256 ECDSA signature over a canonical JSON payload that proves the requester is allowed to act on a Privy resource. Required whenever a wallet, policy, or key quorum has an `owner_id` or signers configured.

### When required

From `authorization-signatures.md`:

- `PATCH /v1/wallets/{wallet_id}` - if the wallet has an owner
- `PATCH /v1/policies/{policy_id}` - if the policy has an owner
- `DELETE /v1/policies/{policy_id}` - if the policy has an owner
- `POST /v1/wallets/{wallet_id}/rpc` - if the wallet has an owner
- `PATCH /v1/key_quorums/{key_quorum_id}` - signatures from existing quorum meeting threshold
- `DELETE /v1/key_quorum/{key_quorum_id}` - same

### Header format

```
privy-authorization-signature: <sig1>,<sig2>,...
```

Comma-separated when a key quorum's threshold needs multiple signatures. Each signature is base64-encoded P-256 ECDSA.

### Signed payload shape

```json
{
  "version": 1,
  "method": "POST",
  "url": "https://api.privy.io/api/v1/wallets/<wallet_id>/rpc",
  "body": { /* exact request body */ },
  "headers": {
    "privy-app-id": "<your-app-id>",
    "privy-request-expiry": "1773679531000"
  }
}
```

The headers field MUST mirror what you send on the wire. If they disagree, Privy rejects.

### Server SDK does this for you

Build an `AuthorizationContext` and pass it through. The SDK signs the request payload, includes the signature header, and includes any matching idempotency key / expiry headers it knows about.

```ts
import {PrivyClient, type AuthorizationContext} from '@privy-io/node';

const privy = new PrivyClient({
  appId: 'insert-your-app-id',
  appSecret: 'insert-your-app-secret'
});

const authorizationContext: AuthorizationContext = {
  authorization_private_keys: ['authorization-key']
};

const response = await privy.wallets().ethereum().signMessage('insert-wallet-id', {
  message: 'Hello, world!',
  authorization_context: authorizationContext
});
```

### Combining keys + JWTs (key quorum)

```ts
// 2-of-2 key quorum: user JWT + authorization private key
const authorizationContext: AuthorizationContext = {
  user_jwts: ['user-jwt'],
  authorization_private_keys: ['authorization-key']
};
```

### Custom sign function (KMS-backed)

```ts
async function mySignFunction(payload: Uint8Array): Promise<string> {
  // Perform an ECDSA P-256 signature on the payload
  // This is an example using a fictitious KMS API call.
  const signature = await kms.sign(payload);
  return signature; // This should be a base64-encoded string
}

const authorizationContext: AuthorizationContext = {
  sign_functions: [mySignFunction]
};
```

The payload is already canonicalized when handed to the sign function. Do not re-serialize.

### EIP-7702 authorization signatures

A separate concept from Privy's `privy-authorization-signature`. EIP-7702 sign delegations are produced by the user's EVM wallet (Privy's TEE on their behalf) to authorize a Kernel smart contract upgrade for batched calls. See `04-evm-integration.md` section on EIP-7702.

### Delegation authorization

For server-driven actions on user wallets ("offline actions" use case), the wallet's owner (the user) authorizes an additional signer (an authorization key the server controls). See `10-wallet-controls-and-authorization.md` and section "Offline signing" below.

## Speeding up / cancelling transactions

Pending EVM transactions can be replaced by submitting a new transaction with the **same nonce**. Privy provides a webhook (`transaction.still_pending`) that fires when a tx has been in mempool longer than expected, giving your backend a hook to send a replacement.

### Why a same-nonce replacement is safe

From `speeding-up-transactions.md`:

> Although you are sending a new transaction, there is **no risk of both transactions getting executed** (unintentionally) if the nonce is set to be the same in each. On EVM chains, the nonce is an internal counter that is incremented for each transaction sent by a wallet to avoid replay and other attack vectors.

### Webhook payload shape

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

### Replacement implementation

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

Leaving the gas fields off lets Privy recompute them from current network conditions. Set `max_priority_fee_per_gas` higher than the original if you want to outbid more aggressively.

### Cancellation

Same trick: send a zero-value tx to your own address with the same nonce + higher priority fee. The original tx then becomes ineligible (the nonce is already consumed).

### Monitoring the replacement

Subscribe to `transaction.replaced`, `transaction.failed`, `transaction.confirmed`. When a replacement succeeds:

- `transaction.replaced` fires for the original transaction ID.
- `transaction.confirmed` fires for the speedup transaction.

### Solana

The doc only covers EVM speedups. On Solana, transactions either land within ~150 slots (blockhash window, ~60s) or expire. The "fix" is to resubmit with a fresh `recentBlockhash` and bumped priority fee, but the previous tx ID is permanently dead, not replaced. There is no `transaction.still_pending` webhook for Solana.

## Offline signing

"Offline" here means "the user does not have to be present to sign". This unlocks limit orders, agentic trading bots, scheduled rebalances. The pattern from `offline.md`:

```
1. Create a wallet with a user owner (default when using client SDKs).
2. Add an authorization key controlled by your server as an additional signer
   on the wallet. Optionally scope it with a policy (allowlisted contracts,
   max value per call, daily spend cap, etc.).
3. Your server-side additional signer can now sign + send transactions on
   behalf of the user, subject to its scoped policy, even when the user is
   offline.
```

### Three-step setup

**Step 1 - wallet has user owner** (typical Privy client-side wallet creation). The user controls the wallet via Privy's flow.

**Step 2 - server adds an additional signer**. Via REST or server SDK, attach an authorization key as an additional signer. Configure its `policy_ids` to constrain what it can do. Optionally enable `noPromptOnSignature` so the signer does not need user UI confirmation.

**Step 3 - server signs requests with its private key**. Use the `AuthorizationContext` with the authorization key in `authorization_private_keys`. Privy validates the signer's policies and either executes or rejects.

### Use cases at Spectre scale

- Telegram-driven trading bots: the bot's server holds an authorization key; the user's wallet permits it under tight policies.
- Limit orders that need to execute when price hits a level (without the user being online).
- Scheduled DCA into a basket.

Spectre does NOT use this pattern today. Every swap requires the user to confirm via the Privy modal in the live browser session.

## Programmable signing

Privy supports several patterns for who-can-sign-what (from `programmable.md`):

### 1-of-1 (single party unilateral)

Create a wallet with one authorization key as owner. That party can do anything with the wallet. Simplest. Lowest friction.

### 1-of-k (any one of many parties unilateral)

Create the wallet with a `1-of-k` key quorum. Any single party in the quorum can act alone. Use case: a team of operators, any one can authorize.

### m-of-k (collective approval)

Create the wallet with an `m-of-k` key quorum. m signatures are required to take any action. Use case: high-value treasury, multi-sig style operations.

### Scoped per-party policies

Owner is the "administrator" party; each additional signer has its own override policy. Different parties are subject to different rules:

- Owner: full control over wallet config + private key export.
- Signer A: can swap up to $1,000 daily.
- Signer B: can only call a specific staking contract.

### Third-party permissions

A common Privy pattern. The primary party (the app's customer) owns the wallet. Third-party services get added as additional signers, each scoped via policies (e.g. `allowed_contracts`, `max_value_wei`). Third parties cannot export private keys, change ownership, or modify policies - only execute scoped actions.

Spectre does NOT use programmable signing today. Every Spectre swap is a 1-of-1 user-owned wallet signing in the browser through the Privy modal.

## Code patterns (verbatim from docs)

### Sign + send EVM ETH transfer (server SDK)

```ts
import {PrivyClient} from '@privy-io/node';

const privyClient = new PrivyClient({
  appId: 'insert-your-app-id',
  appSecret: 'insert-your-app-secret'
});

try {
  const caip2 = 'eip155:1'; // Ethereum mainnet
  const response = await privyClient
    .wallets()
    .ethereum()
    .sendTransaction('insert-user-wallet-id', {
      caip2,
      params: {
        transaction: {
          to: '0xE3070d3e4309afA3bC9a6b057685743CF42da77C',
          value: '0x2386f26fc10000',
          data: '0x'
        }
      },
      authorization_context: {
        // Example: building an authorization context for a 2-of-2 key quorum,
        // consisting of a user and authorization key
        authorization_private_keys: ['authorization-key'],
        user_jwts: ['user-jwt']
      }
    });

  const transactionHash = response.hash;
} catch (error) {
  console.error(error);
}
```

### Sign + send EVM ERC-20 transfer with idempotency key

```ts
import {PrivyClient} from '@privy-io/node';
import {v4 as uuidv4} from 'uuid';

const client = new PrivyClient({appId: '$PRIVY_APP_ID', appSecret: '$PRIVY_APP_SECRET'});

const idempotencyKey = uuidv4();

const res = await client
  .wallets()
  .ethereum()
  .sendTransaction('$WALLET_ID', {
    idempotency_key: idempotencyKey,
    caip2: 'eip155:8453',
    params: {
      transaction: {
        to: '0xE3070d3e4309afA3bC9a6b057685743CF42da77C',
        value: '0x2386F26FC10000',
        chain_id: 8453
      }
    }
  });
```

### Sign message (EVM `personal_sign`)

```ts
const response = await privy.wallets().ethereum().signMessage('insert-wallet-id', {
  message: 'Hello, world!',
  authorization_context: {
    authorization_private_keys: ['authorization-key']
  }
});
```

### EVM REST eth_sendTransaction (raw)

```bash
curl --request POST https://api.privy.io/v1/wallets/y5ofctvacjiv53u4hmnqi0e5/rpc \
-u "<your-privy-app-id>:<your-privy-app-secret>" \
-H "privy-app-id: <your-privy-app-id>" \
-H "privy-authorization-signature: <insert-authorization-sig1>,<insert-authorization-sig2>" \
-H 'Content-Type: application/json' \
-d '{
  "caip2": "eip155:1",
  "method": "eth_sendTransaction",
  "params": {
    "transaction": {
      "to": "0xE3070d3e4309afA3bC9a6b057685743CF42da77C",
      "value": "0x2386f26fc10000",
      "data": "0x"
    }
  }
}'
```

### Batch transactions (EVM `wallet_sendCalls`)

```ts
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

### Approve + swap atomic batch (EVM)

```ts
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

### Solana batch transfer (multi-instruction)

```ts
import {Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL} from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
const fromPubkey = new PublicKey('insert-wallet-address');

const transaction = new Transaction();

transaction.add(
  SystemProgram.transfer({
    fromPubkey,
    toPubkey: new PublicKey('0xRecipientAddress1'),
    lamports: 0.01 * LAMPORTS_PER_SOL
  })
);

transaction.add(
  SystemProgram.transfer({
    fromPubkey,
    toPubkey: new PublicKey('0xRecipientAddress2'),
    lamports: 0.02 * LAMPORTS_PER_SOL
  })
);

const {blockhash} = await connection.getLatestBlockhash();
transaction.recentBlockhash = blockhash;
transaction.feePayer = fromPubkey;
// Then sign+send via Privy server or client SDK.
```

### Wallet action: execute swap (REST)

```bash
curl -X POST https://api.privy.io/v1/wallets/{wallet_id}/swap \
  -u "<your-app-id>:<your-app-secret>" \
  -H "privy-app-id: <your-app-id>" \
  -H "privy-authorization-signature: <authorization-signature>" \
  -H "Content-Type: application/json" \
  -d '{
    "caip2": "eip155:8453",
    "input_token": "native",
    "output_token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "1000000000000000000",
    "amount_type": "exact_input"
  }'
```

Response (pending action):

```json
{
  "id": "cm7oxq1el000e11o8iwp7d0d0",
  "status": "pending",
  "wallet_id": "fmfdj6yqly31huorjqzq38zc",
  "caip2": "eip155:8453",
  "input_token": "native",
  "output_token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "input_amount": "1000000000000000000"
}
```

### Wallet action: cross-chain bridge transfer (REST)

```bash
curl -X POST https://api.privy.io/v1/wallets/{wallet_id}/transfer \
  -u "<your-privy-app-id>:<your-privy-app-secret>" \
  -H "privy-app-id: <your-privy-app-id>" \
  -H "Content-Type: application/json" \
  -d '{
    "source": {
      "asset": "usdc",
      "amount": "10.0",
      "chain": "base"
    },
    "destination": {
      "address": "0xRecipientAddress",
      "chain": "ethereum"
    }
  }'
```

### Poll wallet action status

```bash
curl https://api.privy.io/v1/wallets/{wallet_id}/actions/{action_id}?include=steps \
  -u "<your-privy-app-id>:<your-privy-app-secret>" \
  -H "privy-app-id: <your-privy-app-id>"
```

### Speed up a stuck EVM tx (server SDK, triggered by `transaction.still_pending` webhook)

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

### Sign an authorization (server-side, with `AuthorizationContext`)

```ts
import {PrivyClient, type AuthorizationContext} from '@privy-io/node';

const privy = new PrivyClient({
  appId: 'insert-your-app-id',
  appSecret: 'insert-your-app-secret'
});

// Build your authorization context
const authorizationContext: AuthorizationContext = {
  authorization_private_keys: ['authorization-key']
};

// Pass the authorization context to the SDK method
const response = await privy.wallets().ethereum().signMessage('insert-wallet-id', {
  message: 'Hello, world!',
  authorization_context: authorizationContext
});
```

## Spectre-specific notes

### Today's signing surface

- `useSwapExecution.js` (trading + research, identical hook on both apps) calls `wallet.getEthersProvider()` for EVM or `wallet.getProvider()` for Solana, then signs through the wallet directly. We do NOT use Privy's wallet action APIs (`/swap`, `/transfer`) - we build the tx ourselves from Jupiter (Solana) or 0x Permit2 (EVM) and submit raw via the wallet provider.
- The actual chain branch is detected via `payToken?.chainId === 'solana'` OR `mode === 'sell' && token?.networkId === 1399811149` (the Codex networkId for Solana). See `solana-web3.md` section H.
- The wallet object comes from `useWallets()` filtered by `walletClientType === 'privy'` and matching `chainType`.

### Slippage handling

Spectre clamps `slippageBps` to `[1, 500]` (0.01% to 5%) client-side. Default 50 bps (0.5%). Server enforces the same cap. From `useSwapExecution.js`:

```js
const MAX_SLIPPAGE_BPS = 500
const MIN_SLIPPAGE_BPS = 1

function clampSlippage(input) {
  const raw = Number(input)
  if (!Number.isFinite(raw)) return 50
  return Math.min(Math.max(Math.floor(raw), MIN_SLIPPAGE_BPS), MAX_SLIPPAGE_BPS)
}
```

### Debounced quote fetching

Quote fetches debounce 400 ms with an `AbortController` per request to cancel stale fetches when the user is typing. Aborts are silently ignored. From `useSwapExecution.js`:

```js
const QUOTE_DEBOUNCE_MS = 400
// ...
debounceRef.current = setTimeout(async () => {
  const controller = new AbortController()
  abortRef.current = controller
  try {
    const result = await getSwapQuote(params)
    if (!controller.signal.aborted) {
      setQuote(result)
    }
  } catch (err) {
    if (controller.signal.aborted) return
    // ... error path
  }
}, QUOTE_DEBOUNCE_MS)
```

### Stale-quote guard before execute

Before signing, the hook verifies that the cached `quote` still matches the user's UI state (input + output token addresses match). This catches the case where a user gets a quote, changes mode (buy/sell), and presses Swap before a fresh quote loads.

```js
if (quote.inputToken !== expectedInput || quote.outputToken !== expectedOutput) {
  setSwapError('Quote expired - enter your amount again')
  setQuote(null)
  return null
}
```

### What Spectre does NOT use

- **Idempotency keys**. We do not pass `privy-idempotency-key`. Potential bug: on flaky networks, a retry can submit two swaps. Add idempotency keys before scaling user count. Track in `TODOS.md`.
- **Wallet action APIs** (`/swap`, `/transfer`). We do not use `getWalletActionStatus`. We rely on the tx hash + RPC confirmation via `waitForConfirmation(hash, chain, 60000)` from `swapService.js`.
- **Programmable signing / additional signers**. Every swap is a 1-of-1 user-owned wallet. No bots, no offline actions, no scoped permissions.
- **Offline signing**. Same reason - no agentic trading on user wallets.
- **`noPromptOnSignature`**. Every signature shows the Privy modal. Intentional security choice.
- **`showWalletUIs: false`**. Same reason.
- **Batch transactions (`wallet_sendCalls` / EIP-7702)**. Our EVM swaps are a single tx (Permit2 includes the approval inline). Future: consider switching to `sendCalls` if we ever build flows that bundle approve + swap separately.

### `walletConnected` vs `walletReady`

Critical distinction in Spectre (from `solana-web3.md` section A):

- `walletConnected = authenticated && ready` - user has authenticated via Privy.
- `walletReady = !!wallet` - the embedded wallet object is loaded and can sign.

Show "Connect Wallet" only when `!walletConnected`. Show "Loading wallet..." when `walletConnected && !walletReady`. Enable swap button only when `walletReady`.

### Tx confirmation

`waitForConfirmation` (in `swapService.js`) polls every 2s with a 60s timeout. EVM: `receipt.status === 1`. Solana: `confirmationStatus === 'confirmed' || 'finalized'` and `status.value.err === null`. Same shape on both apps.

### Cancelled tx handling

`useSwapExecution.js` swallows user-cancelled signs silently:

```js
if (err?.message?.includes('cancelled') ||
    err?.message?.includes('canceled') ||
    err?.message?.includes('rejected')) {
  return { success: false, error: 'Transaction cancelled' }
}
```

UI clears the error after 5 seconds.

## Gotchas & pitfalls

- **EVM transaction shape**. `useSendTransaction` for EVM uses viem-style `SendTransactionParameters`. `data` must be a hex string. `value` must be a hex string when sent via REST; the SDKs accept `bigint`. Mixing types causes silent encode failures.
- **Solana tx format**. Privy expects a `VersionedTransaction` (`v0` message format) or a legacy `Transaction`. Pass it serialized to base64 or as raw bytes. Privy will sign and submit. If you pass a non-`VersionedTransaction` and use a chain that requires v0 (lookup tables), things break.
- **Idempotency keys are bound to body**. Re-using a key with a different body returns 400. Per-attempt keys = no protection. One key per logical action, persisted with your DB record.
- **`privy-request-expiry` is in milliseconds**. Seconds is the most common bug. From the doc: "Using seconds will result in a timestamp that appears to be far in the past, and the request will be rejected."
- **Expiry must match between header and signature payload**. If you sign with expiry X then send header expiry Y, Privy rejects with a signature mismatch. SDKs handle this; raw REST callers must align them.
- **Action status polling rate limits**. The docs do not specify exact limits but recommend polling infrequently and stopping at terminal states. Exponential backoff is a safe default.
- **`signTypedData` v4 shape**. Must be `{ domain, types, primaryType, message }`. Older versions used different shapes - all callers should use v4 unambiguously.
- **EIP-712 value-type mismatch**. If `types` says `uint256` but `message` provides a string, the typed-data hash is wrong and the on-chain verifier rejects without an obvious error. Verify your types match exactly.
- **Solana blockhash expires after ~150 slots (~60s)**. If the user opens the swap modal, walks away for two minutes, then hits Confirm, the tx will be rejected by the cluster. Re-fetch the blockhash if the modal has been open more than ~45s.
- **`useSignTransaction` does NOT broadcast**. Many devs assume sign-and-send. If you only call `useSignTransaction`, you must relay the resulting raw tx yourself.
- **User rejection vs network error**. The promise rejects in both cases. The user-rejection error message contains `cancelled`/`canceled`/`rejected` (varies by browser/wallet). Match on these substrings; do not treat a rejection as a system error.
- **Embedded wallet iframe + third-party storage**. Privy's embedded wallet signs inside an iframe. Safari ITP can block third-party storage there. Symptoms: signing works on Chrome but fails silently on Safari. Fix: ensure your domain is in Privy Dashboard's allowed-domains so the iframe uses first-party storage.
- **Hooks crash before hydration**. `useWallets`, `useConnectWallet`, `useSendTransaction` all crash if called before Privy has hydrated. Defer to child components that only mount after auth (or behind a `if (!ready) return null` guard). See `solana-web3.md` section A.
- **`getAccessToken` returns a new function reference every render**. Putting it in a `useEffect` dep array causes an infinite loop. Use the `useRef` pattern from `solana-web3.md` section A.
- **Wallet action policy methods**. Policies for `/transfer` and `/swap` use `method: 'transfer'` and `method: 'swap'`, NOT the underlying RPC methods. From `Wallet Actions.md`: "when calling the `/transfer` API, policy rules with methods `eth_sendTransaction` and `signAndSendTransaction` are not enforced on those API calls."
- **Bridging routes are restricted**. Cross-chain transfer only works for same-category assets (USD stables to USD stables, native ETH to native ETH). No native-to-stablecoin bridging - use the swap API.
- **Auto-slippage vs explicit `slippage_bps`**. The swap action infers slippage if you omit `slippage_bps`. For large or volatile pairs, set it explicitly and inspect `minimum_output_amount` from the quote.
- **`signAllTransactions` (Solana)**. Common in Jupiter route-building when the route has multiple v0 transactions. Privy supports it but the user sees one modal for all of them - make sure your UI explains why multiple txs are being signed.

## Cross-references

- Solana-specific tx patterns - `03-solana-integration.md`
- EVM-specific tx patterns (including EIP-7702 details, Permit2 0x flow, Multicall3) - `04-evm-integration.md`
- Server-side signing (`AuthorizationContext`, custom sign functions, user JWT keys) - `08-server-sdk.md`
- Swap execution flows (Jupiter, 0x, fee config) - `06-swaps-and-trading.md`
- Wallet creation flow and `walletClientType` filtering - `02-wallet-creation-and-discovery.md`
- Webhooks for tx + action confirmation (`transaction.still_pending`, `transaction.replaced`, `wallet_action.swap.succeeded`) - `11-security-and-webhooks.md`
- Wallet controls / additional signers / delegation - `10-wallet-controls-and-authorization.md`
- Policies and the policy language - `09-policies-and-rules.md`
- Errors and troubleshooting (`request_expired`, signature mismatch, rate limits) - `14-errors-and-troubleshooting.md`
