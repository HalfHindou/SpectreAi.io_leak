---
description: Privy wallet authorization & controls (signers, policies, approval models, delegation, custody continuum, programmable wallets). Synthesized from official docs.
---

# Privy Wallet Controls & Authorization

## Source docs synthesized

Pulled from `C:\Users\worka\OneDrive\Desktop\Privy\`:

- `User Auth Keys.md` - user authorization keys, TEE issuance, MFA, HPKE encryption
- `User Auth.md` - JWT/OIDC integration, access + refresh tokens, session security
- `add-signers.md` - addSigners API across React, RN, Swift, Android, Flutter, Node
- `remove-signers.md` - removeSigners / removeAllSigners revocation flow
- `configure-signers.md` - 3-step setup (key quorum, policy, add-to-wallet)
- `use-signers.md` - server-side execution + wallet discovery
- `authorization-signatures.md` - when sigs are required, request expiry, header format
- `Policies.md` - transfer policy schema and field/operator matrix
- `Policy and Controls.md` - architecture (P-256, owners, quorums, TEE enforcement)
- `policies.md` - duplicate of transfer policy doc
- `policies (1).md` - earn deposit/withdraw policy schema
- `single-party-approval.md` - simplest owner model
- `dual-approval.md` - user + server m-of-k recipe
- `quorum-approval.md` - generic m-of-n approval and nested quorums
- `delegation.md` - owners vs signers conceptual split
- `Flixible Custody.md` - custody continuum (non-custodial, dev-controlled, custodial)
- `programmable.md` - 5 owner/signer configurations
- `offline.md` - agentic / Telegram / limit-order pattern (user owner + server signer)
- `assign.md` - owner field shape per owner type
- `key-quorum.md` - key quorum primitive
- `key.md` - authorization key generation (Dashboard, Node, REST, passkey)

## Core concepts

Privy's authorization model has three orthogonal axes:

1. **WHO can sign** - the set of authorized parties (the user, your server, hardware keys, other users, key quorums of any of the above).
2. **WHAT they can sign** - the policy attached to a wallet or to a specific signer, restricting the methods and request bodies the signer can authorize.
3. **HOW MANY signatures are required** - the authorization threshold of the owner/signer key quorum (1-of-1, 2-of-3, m-of-k, etc.).

The primitives that implement these axes:

- **Authorization keys**: P-256 (secp256r1) asymmetric keypairs. The private key never leaves the device that generated it (your server, a user's device, or a passkey). The public key is registered with Privy's Trusted Execution Environment (TEE / secure enclave). Privy verifies signatures against the registered public key before processing any wallet action.
- **Key quorums**: a list of authorization keys (or users, or nested key quorums one level deep) plus an authorization threshold `m`. The quorum is "satisfied" when at least `m` of its members sign the request.
- **Owners**: the key quorum that controls a wallet (or policy, or other resource). By default the owner is also required to authorize every wallet action.
- **Signers**: additional key quorums granted permission to take actions on a wallet, optionally subject to an override policy. Signers cannot update the wallet, change its owner, or export private keys - only the owner can.
- **Policies**: declarative rules attached to a wallet (default policies) or to a specific signer (override policies). Evaluated inside the TEE before any wallet action proceeds.
- **Authorization signatures**: the actual cryptographic signature(s) over the request body + critical headers, sent in the `privy-authorization-signature` header.

This combination is what Privy calls "owners and signers" or "programmable controls". It supports the full custody continuum:

```
client-only           ->  client + server (delegation)  ->  key-quorum (m-of-n)  ->  server-only
  user is sole owner       user owner + server signer       user + server in quorum     server-only owner
  fully self-custodial     user can revoke any time         neither side alone can act   developer-controlled
```

## Signer management API

A "signer" in the SDK sense is a key quorum that has been granted action permission on a specific wallet. The lifecycle is: create the key quorum once (per app, in Dashboard or REST), then add or remove it from individual wallets as users opt in or out.

### React (`@privy-io/react-auth`)

```tsx
addSigners: async ({address: string, signers: {signerId: string, policyIds: string[]}[]}) => Promise<{user: User}>
removeSigners: async ({address: string}) => Promise<{user: User}>
```

Usage:

```tsx
import {useSigners} from '@privy-io/react-auth';
const {addSigners} = useSigners();
```

`addSigners` parameters:

- `address` (string, required) - address of the embedded wallet to add a signer to.
- `signers` (object[], required):
  - `signerId` (string, required) - the key quorum ID generated in the Dashboard or via the create-key-quorum API.
  - `policyIds` (string[], optional) - policy IDs the signer must satisfy. Each signer can only have one override policy at this time. If omitted, the wallet's default policies apply.

`removeSigners` removes **all** signers on the wallet. After this the app can no longer act on behalf of the user until they re-add a signer. Example revoke button:

```tsx
import {usePrivy, useSigners, type WalletWithMetadata} from '@privy-io/react-auth';

function RemoveSessionSignersButton() {
  const {user} = usePrivy();
  const {removeSigners} = useSigners();

  // Wallets with signers always have delegated: true
  const delegatedWallet = user.linkedAccounts.filter(
    (account): account is WalletWithMetadata => account.type === 'wallet' && account.delegated
  );

  const onRevoke = async () => {
    if (!hasDelegatedWallets) return;
    await removeSigners({address: delegatedWallet.address});
  };

  return (
    <button disabled={!hasDelegatedWallets} onClick={onRevoke}>
      Revoke permission for this app to transact on my behalf
    </button>
  );
}
```

### React Native (`@privy-io/expo`)

Same hook signature as React, imported from `@privy-io/expo`. The `linked_accounts` field uses snake_case in RN, vs `linkedAccounts` camelCase in web.

```tsx
import {usePrivy, useSigners, type PrivyEmbeddedWalletAccount} from '@privy-io/expo';

function RemoveSessionSignersButton() {
  const {user} = usePrivy();
  const {removeSigners} = useSigners();

  const delegatedWallet = user.linked_accounts.find(
    (account): account is PrivyEmbeddedWalletAccount =>
      account.type === 'wallet' && account.delegated
  );

  const onRevoke = async () => {
    if (!delegatedWallet) return;
    await removeSigners({address: delegatedWallet.address});
  };

  return (
    <Button disabled={!delegatedWallet} onPress={onRevoke}>
      Revoke permission for this app to transact on my behalf
    </Button>
  );
}
```

### Swift

```swift
func addSigners(_ signers: [SignerInput]) async throws
func addSigner(_ signer: SignerInput) async throws
func removeSigner(signerId: String) async throws
func removeAllSigners() async throws
```

Usage:

```swift
guard let user = await privy.getUser() else { return }
guard let wallet = user.embeddedEthereumWallets.first else { return }

// Add multiple
let signers = [
    SignerInput(signerId: "your-key-quorum-id", policyIds: ["your-policy-id"]),
    SignerInput(signerId: "another-key-quorum-id")
]
try await wallet.addSigners(signers)

// Add single
let signer = SignerInput(signerId: "your-key-quorum-id", policyIds: ["your-policy-id"])
try await wallet.addSigner(signer)

// Remove one
try await wallet.removeSigner(signerId: "your-key-quorum-id")

// Remove all
try await wallet.removeAllSigners()
```

### Android (Kotlin)

```kotlin
suspend fun addSigners(signers: List<SignerInput>): Result<Unit>
suspend fun EmbeddedWallet.addSigner(signer: SignerInput): Result<Unit>
suspend fun removeSigner(signerId: String): Result<Unit>
suspend fun removeAllSigners(): Result<Unit>
```

Usage:

```kotlin
val user = privy.getUser() ?: return
val wallet = user.embeddedEthereumWallets.firstOrNull() ?: return

val signers = listOf(
    SignerInput(signerId = "your-key-quorum-id", policyIds = listOf("your-policy-id")),
    SignerInput(signerId = "another-key-quorum-id")
)
wallet.addSigners(signers).fold(
    onSuccess = { /* Signers added successfully */ },
    onFailure = { error -> println("Error adding signers: ${error.message}") }
)

wallet.removeSigner(signerId = "your-key-quorum-id").fold(
    onSuccess = { /* Signer removed successfully */ },
    onFailure = { error -> println("Error removing signer: ${error.message}") }
)
```

### Flutter

```dart
Future<Result<void>> addSigners(List<SignerInput> signers)
Future<Result<void>> addSigner(SignerInput signer)
Future<Result<void>> removeSigner(String signerId)
Future<Result<void>> removeAllSigners()
```

Usage:

```dart
final user = await privy.getUser();
if (user == null) return;
final wallet = user.embeddedEthereumWallets.firstOrNull;
if (wallet == null) return;

final signers = [
  SignerInput(signerId: 'your-key-quorum-id', policyIds: ['your-policy-id']),
  SignerInput(signerId: 'another-key-quorum-id'),
];
final result = await wallet.addSigners(signers);
result.fold(
  onSuccess: (_) {},
  onFailure: (error) { print('Error adding signers: $error'); },
);
```

### Node SDK & REST API

There are no direct `addSigners` / `removeSigners` SDK methods on the server. Instead you make a wallet `update` request with the desired `additional_signers` list. The wallet's owner must sign that update request with an authorization signature. See the "Authorization signatures" section below for the signing flow.

### Server-side: discovering delegated wallets

From your server, query Privy to find wallets where a user has granted your app signer access. Wallets with signers always carry `delegated: true`.

Node SDK:

```ts
const user = await privy.users()._get('insert-user-did');

const walletsWithSessionSigners = user.linked_accounts.filter(
  (account) => account.type === 'wallet' && 'id' in account && account.delegated
);
```

REST API:

```bash
curl --request GET https://auth.privy.io/api/v1/users/<user-did> \
  -u "<your-privy-app-id>:<your-privy-app-secret>" \
  -H "privy-app-id: <your-privy-app-id>"
```

Filter the `linked_accounts` array for `type: 'wallet'` and `delegated: true`.

## Configure signers (one-time setup)

Before any client can call `addSigners`, the app must register the underlying key quorum and (optionally) policies.

### 1. Create a key quorum

A signer is fundamentally a key quorum authorized to submit transaction requests for signing from a user's wallet.

- Dashboard: visit **Wallet infrastructure -> Authorization keys -> Create new key**. The modal shows the **key quorum ID** and the **private key**. Save both. Privy never sees the private key and cannot help you recover it.
- REST API: see `/api-reference/key-quorums/create`.

The authorization key is the private half of a P-256 keypair. Privy stores only the public key and verifies signatures against it inside the TEE.

### 2. Create policies (optional)

Set up under **Wallet infrastructure -> Policies** in the Dashboard. Policies constrain what kinds of actions the signer can take. Without policies, the signer inherits the wallet's default policies (which can also be empty -> unrestricted within whatever the wallet allows).

### 3. Add the signer to the wallet

The wallet owner (typically the user) must consent. This is where the client-side `addSigners` calls described above come in.

## Authorization signatures

Authorization signatures prove that a request to Privy was authorized by a specific owner or signer. They are the cryptographic enforcement layer behind every owner/signer relationship.

### When they are required

**Updating wallets and policies** - critical resources have an `owner_id`. When set, all `PATCH` and `DELETE` requests against the resource require a signature from the owner:

- `PATCH /v1/wallets/[wallet_id]`
- `PATCH /v1/policies/[policy_id]`
- `DELETE /v1/policies/[policy_id]`

**Executing actions with wallets** - if the wallet has an owner, `POST /v1/wallets/[wallet_id]/rpc` also requires the owner's signature.

**Updating key quorums** - although key quorums do not themselves have owners, updating or deleting one requires a satisfying set of signatures from the **existing** quorum that meets the authorization threshold:

- `PATCH /v1/key_quorums/[key_quorum_id]`
- `DELETE /v1/key_quorum/[key_quorum_id]`

### High-level flow

```
1. Get your private keys
   - Locally-stored keys (app owners, key quorum owners), or
   - Request a time-bound user key from Privy via the user's JWT (for user owners)
2. Construct your request (wallet update, transfer, etc.)
3. Format and sign the request payload with the private key(s)
4. Include the signature(s) in the privy-authorization-signature header
```

### Required headers

- `privy-authorization-signature` (string) - the authorization signature. If multiple are required, include them comma-delimited.
- `privy-request-expiry` (string) - Unix timestamp in milliseconds (e.g. `1773679531000`). Privy rejects requests where this is in the past. This header is included in the signature payload and must match the value used to compute the signature. Prevents replay attacks.

If you use a Privy SDK, both headers are added automatically. Direct REST calls must construct them manually.

### Quorum requirement

If the owner is a key quorum with threshold `m`, sign the request with `m` valid authorization keys from the quorum and include all signatures comma-delimited in the header.

## User authorization keys

User-owned wallets sign requests with a **user authorization key**. Users do not hold long-lived P-256 keys directly - Privy issues time-bound keys from the TEE on demand.

Flow:

1. Your app sends a request to the Privy API with the user's authenticated JWT (Privy's native JWT or any OIDC/JWT-based provider - Auth0, Firebase, AWS Cognito, etc.).
2. The TEE issues a time-bound user authorization key.
3. Your app (or the SDK on your app's behalf) uses that key to sign requests to the Wallet API.

The returned key is encrypted from the TEE to the client using HPKE (Hybrid Public Key Encryption), the same scheme as wallet export.

MFA can be required on this issuance step. Supported additional factors:

- Authenticator apps (TOTP)
- Biometric verification (passkeys)
- SMS confirmation
- Hardware security keys

Privy's client-side SDKs manage user authorization keys internally. Direct REST access exists but is considered advanced.

## Privy session tokens (separate from authorization keys)

The user's session uses two tokens unrelated to authorization keys:

- **Access token** - JWT signed by an app-specific asymmetric key, 1-hour lifetime.
- **Refresh token** - 30-day lifetime, single-use, rotates on each use.

If the SDK detects token tampering it invalidates the session immediately and destroys the corresponding server session. On a verified custom domain, tokens can live in HttpOnly cookies for XSS resistance. Authorization signatures use a different signing scheme entirely (P-256 over request payloads, not the JWT signing key).

## Policies

Policies constrain what a signer (or the wallet by default) can do. They are evaluated inside the TEE before any wallet action proceeds, so a malicious client cannot bypass them. Some policy types (e.g. limiting transfer sizes in USD terms) require off-enclave transaction simulation and are enforced at the API layer.

### Policy methods

Each rule targets one method exactly. Method matching is strict - a wallet policy that allows `eth_sendTransaction` will deny requests to the `transfer` endpoint because they use a different method name.

Supported method names include:

- `eth_sendTransaction`, `eth_signTransaction`, `eth_signTypedData_v4`, etc. (raw Ethereum RPC)
- `signMessage`, `signTransaction` (Solana)
- `transfer` (Privy's transfer endpoint)
- `earn_deposit`, `earn_withdraw` (Privy's earn endpoint)

### Transfer rule schema

Transfer policies evaluate the request body sent to `POST /v1/wallets/[wallet_id]/transfer`:

| Field source | Field | Operators | Notes |
|---|---|---|---|
| action_request_body | source.asset | eq, in, in_condition_set | Named asset, e.g. `"usdc"` |
| action_request_body | source.asset_address | eq, in, in_condition_set | Custom token contract address |
| action_request_body | source.amount | eq, gt, gte, lt, lte | Positive decimal string, e.g. `"10.5"` |
| action_request_body | source.chain | eq, in, in_condition_set | Chain name, e.g. `"base"` or `"solana"` |
| action_request_body | destination.address | eq, in, in_condition_set | Recipient wallet address |
| action_request_body | destination.asset | eq, in, in_condition_set | Cross-asset transfers |
| action_request_body | destination.chain | eq, in, in_condition_set | Cross-chain transfers |

Plus shared `system` conditions like `system.current_unix_timestamp` for time-based controls.

You must pick `source.asset` OR `source.asset_address` for a rule - a single rule cannot condition on both, and a request only ever includes one or the other. A `source.asset` rule will not match a request that sends `source.asset_address`, and vice versa. Match the policy schema to the format your app actually sends.

### Transfer policy example

Allow USDC transfers up to 1000 to one approved address on Base, denying everything else by default:

Node SDK:

```typescript
const policy = await privy.policies().create({
  name: 'Approved transfer policy',
  version: '1.0',
  chain_type: 'ethereum',
  rules: [
    {
      name: 'Allow USDC transfers up to 1000 to approved address on Base',
      method: 'transfer',
      action: 'ALLOW',
      conditions: [
        {field_source: 'action_request_body', field: 'source.asset', operator: 'eq', value: 'usdc'},
        {field_source: 'action_request_body', field: 'source.amount', operator: 'lte', value: '1000.0'},
        {field_source: 'action_request_body', field: 'source.chain', operator: 'eq', value: 'base'},
        {field_source: 'action_request_body', field: 'destination.address', operator: 'eq', value: '<approved-address>'},
      ],
    },
  ],
});

await privy.wallets().update('<wallet-id>', {
  policy_ids: [policy.id],
});
```

If the wallet has an `owner_id`, the wallet update must itself be authorized by that owner (authorization signature).

REST API:

```bash
curl -X POST https://api.privy.io/v1/policies \
  -H "privy-app-id: <your-app-id>" \
  -H "Authorization: Basic <credentials>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Approved transfer policy",
    "version": "1.0",
    "chain_type": "ethereum",
    "rules": [
      {
        "name": "Allow USDC transfers up to 1000 to approved address on Base",
        "method": "transfer",
        "action": "ALLOW",
        "conditions": [
          {"field_source": "action_request_body", "field": "source.asset", "operator": "eq", "value": "usdc"},
          {"field_source": "action_request_body", "field": "source.amount", "operator": "lte", "value": "1000.0"},
          {"field_source": "action_request_body", "field": "source.chain", "operator": "eq", "value": "base"},
          {"field_source": "action_request_body", "field": "destination.address", "operator": "eq", "value": "<approved-address>"}
        ]
      }
    ]
  }'

curl -X PATCH https://api.privy.io/v1/wallets/<wallet-id> \
  -H "privy-app-id: <your-app-id>" \
  -H "Authorization: Basic <credentials>" \
  -H "Content-Type: application/json" \
  -d '{"policy_ids": ["<policy-id>"]}'
```

### Earn rule schema

Earn policies evaluate the request body sent to `POST /v1/wallets/[wallet_id]/earn/deposit` and `POST /v1/wallets/[wallet_id]/earn/withdraw`:

| Field source | Field | Operators | Notes |
|---|---|---|---|
| action_request_body | vault_id | eq, in, in_condition_set | Privy vault ID from Dashboard |
| action_request_body | amount | eq, gt, gte, lt, lte | Positive decimal string, e.g. `"1.5"` |
| action_request_body | raw_amount | eq, gt, gte, lt, lte | Integer base-unit string, e.g. `"1500000"` |

Pick `amount` OR `raw_amount` per rule, same as transfer policies. A single rule cannot condition on both.

### Earn policy example

```typescript
const policy = await privy.policies().create({
  name: 'Approved earn vault policy',
  version: '1.0',
  chain_type: 'ethereum',
  rules: [
    {
      name: 'Allow deposits up to 1000 into approved vault',
      method: 'earn_deposit',
      action: 'ALLOW',
      conditions: [
        {field_source: 'action_request_body', field: 'vault_id', operator: 'eq', value: '<your-vault-id>'},
        {field_source: 'action_request_body', field: 'amount', operator: 'lte', value: '1000.0'},
      ],
    },
    {
      name: 'Allow withdrawals from approved vault',
      method: 'earn_withdraw',
      action: 'ALLOW',
      conditions: [
        {field_source: 'action_request_body', field: 'vault_id', operator: 'eq', value: '<your-vault-id>'},
      ],
    },
  ],
});

await privy.wallets().update('<wallet-id>', {policy_ids: [policy.id]});
```

### Common policy patterns

- Allowlist destination addresses with `destination.address: in` or `destination.address: in_condition_set`.
- Limit assets with `source.asset` or `source.asset_address`.
- Cap transfer size with `source.amount`.
- Lock to a single chain with `source.chain`.
- Time-based gating with `system.current_unix_timestamp` (e.g. allow only during business hours).
- Combine chain and destination for cross-chain transfer restrictions.
- Per-signer overrides: attach the policy to the signer instead of the wallet to give different parties different permissions on the same wallet.

## Approval models

### Single-party approval (default)

A single authorization key or user owns the wallet and can unilaterally approve every action. Wallet creation defaults to user-owned via Privy client SDKs.

Privy's TEE infrastructure enforces that:

- All updates (assign policies, delegate to signers) must be signed by the owner's key or a time-bound key issued for that user.
- All actions (sign messages, send transactions) must be signed by the owner.

If no valid signature is provided, Privy refuses to execute.

### Dual approval (user + server)

When you need both the user **and** your server to approve every transaction (for example, to render a compromised account harmless without server cooperation):

1. **Create the wallet owned by an m-of-k key quorum** where `m >= 2` and the quorum includes at least one user key and one server-controlled authorization key. Done via REST `POST /v1/wallets`.
2. **Both the user and the server sign the transaction request**. The user produces a time-bound key via their JWT; the server uses its locally-held authorization key.
3. **Execute the transaction** with both signatures in `privy-authorization-signature` (comma-delimited).

### Quorum approval (m-of-n)

For arbitrary multi-party approvals (treasury wallets, business accounts, agent wallets with kill switches), create a key quorum with `n` authorization keys and threshold `m`. Privy's TEE enforces that at least `m` of the `n` members sign any request to update or act on the wallet.

To allow any single party to act unilaterally, set `m = 1` (a 1-of-k quorum).

Key quorums can include other key quorums as members, **one level deep**. This enables hierarchical approval - e.g. a "Security Team" 2-of-3 quorum nested inside a broader "Org Admins" 3-of-5 quorum. When the nested quorum meets its threshold, it counts as one approval toward the parent.

Use cases:

- Treasury wallets with finance + ops co-signing
- DAO operational wallets
- Agent wallets where a human "kill switch" key is one of `n` and the agent server key is another

## Delegation (owners vs signers)

Owners and signers are the abstraction Privy uses to express delegation:

- **Owner** - full control. Can update the wallet, change the owner, delegate to signers, export the private key (if export is enabled), and execute all actions.
- **Signer** - delegated action permission only. Can execute actions subject to its policies. Cannot update the wallet, change ownership, or export keys.

Rule of thumb:

- **Third parties acting on behalf of your business** -> your business is the owner, the third parties are signers.
- **Your business acting on behalf of a user** -> the user is the owner, your business is a signer.

Both owners and signers can be configured as quorums for unilateral OR m-of-n approval.

Delegation is **revocable**. The user (owner) can call `removeSigners` at any time to drop all signers. After revocation the app can no longer take actions on behalf of the user until they re-add the signer.

## Flexible custody continuum

Privy wallets support the full spectrum of custody models in one API:

- **Non-custodial wallets** - user retains ultimate control of their private keys. Owner = user.
- **Developer-controlled wallets** - organizations manage their treasury or onchain infrastructure at scale. Owner = server-held authorization key or key quorum.
- **Custodial wallets** - backed by licensed providers for compliance requirements. (Separate product, see custodial-wallets/overview.)

Blended configurations are also possible - for example, a non-custodial wallet that has granted signing permission to the developer (the "offline actions" recipe below). This means a single application can serve custodial and non-custodial experiences side-by-side under one API surface.

The practical decision matrix:

| Need | Configuration | Owner | Signer(s) |
|---|---|---|---|
| Pure self-custody, user signs everything | Single-party (default) | User | (none) |
| User signs but server can act when user is offline | User-owner + server-signer with policy | User | Server (scoped by policy) |
| Cannot lose funds even if user is compromised | Dual approval (m=2) | 2-of-k user+server quorum | (none) |
| Multi-party treasury | Quorum (m-of-n) | m-of-n key quorum | optional |
| Backend service / agent only | Developer-controlled | Server authorization key | (none) |

## Programmable wallets - configuration recipes

The five canonical owner/signer configurations:

### 1. Single party can unilaterally approve

Create the wallet with an authorization key controlled by that party as the owner. The party uses the authorization key to update the wallet and to execute actions with it.

### 2. Multiple parties can unilaterally approve

Create the wallet with a **1-of-k key quorum** where each element is an authorization key associated with one of the parties. Any party can use its key to unilaterally update the wallet or execute actions.

### 3. Multiple parties must collectively approve

Create the wallet with an **m-of-k key quorum** where:

- The key quorum is composed of authorization keys associated with each party.
- `m` is the threshold of parties that must approve.

Privy will only execute requests when `m` valid signatures are provided.

### 4. Scoping wallet policies to specific parties

Create the wallet with an "administrator" party as the owner and an `additional_signers` array containing each other party. For each entry:

- Set `signer` to the party's authorization key (or quorum).
- Set `override_policies` to the policies that should apply to that signer.

Each signer is now subject only to its associated policies.

### 5. Giving permissions to third parties

Create the wallet with:

- The primary party's authorization key as the **owner**
- Each third party's authorization key as an **additional signer** with appropriate policies

The primary party is the only entity that can update the wallet, execute all actions, and export private keys. Third parties can execute actions only within the scope of their signer policy.

## Offline / agentic actions

For apps that need to act on a user's wallet while the user is offline (limit orders, copy-trading bots, Telegram trading bots, portfolio rebalancing):

```
1. Create a wallet with a user owner
   - Privy client-side SDKs default to user-owned wallets, so this happens automatically.
2. Add an authorization key controlled by your server as an additional signer
   - Optionally scope it with policies (allowed contracts, max value, time windows).
   - Use the addSigners SDK call (client-side) or the wallet update API with the owner's signature.
3. Execute scoped transactions with your additional signer
   - These run server-side, no user interaction needed.
   - All actions are subject to the signer's policies.
```

This pattern keeps the user as sole owner (they alone can change ownership, export keys, or revoke the signer) while delegating bounded action authority to your server.

## Wallet assignment / owner specification

When creating or updating a resource, specify the `owner` (or `owner_id`) field. The shape depends on the owner type:

- **User owner** - pass `{user_id: 'insert-user-id-of-owner'}` in the `owner` field.
- **Authorization key owner** - pass `{public_key: 'insert-public-key'}` in the `owner` field.
- **Key quorum owner** - pass the key quorum ID in the `owner_id` field (different shape - `owner_id` not `owner`).

Same applies to policies (`/v1/policies/[id]`) and other resources that support owners. Updating a resource's owner requires a signature from the **current** owner.

## Code patterns (verbatim)

### Add a server signer to a user's wallet (delegation setup)

```tsx
import {useSigners} from '@privy-io/react-auth';

function GrantServerAccessButton({walletAddress, policyId}) {
  const {addSigners} = useSigners();

  const onGrant = async () => {
    await addSigners({
      address: walletAddress,
      signers: [
        {signerId: process.env.NEXT_PUBLIC_PRIVY_SERVER_KEY_QUORUM_ID, policyIds: [policyId]}
      ]
    });
  };

  return <button onClick={onGrant}>Let this app trade for me</button>;
}
```

### Configure a policy: contract allowlist + max value

```typescript
const policy = await privy.policies().create({
  name: 'Bot trading policy',
  version: '1.0',
  chain_type: 'ethereum',
  rules: [
    {
      name: 'Allow USDC transfers up to 100 to Jupiter aggregator',
      method: 'transfer',
      action: 'ALLOW',
      conditions: [
        {field_source: 'action_request_body', field: 'source.asset', operator: 'eq', value: 'usdc'},
        {field_source: 'action_request_body', field: 'source.amount', operator: 'lte', value: '100.0'},
        {field_source: 'action_request_body', field: 'destination.address', operator: 'in', value: ['<jupiter>', '<raydium>']},
      ],
    },
  ],
});
```

### Quorum: require 2-of-3 (user passkey + server + recovery)

```bash
curl -X POST https://api.privy.io/v1/key_quorums \
  -H "privy-app-id: <your-app-id>" \
  -H "Authorization: Basic <credentials>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "User+Server+Recovery quorum",
    "authorization_threshold": 2,
    "authorization_keys": [
      {"public_key": "<user-passkey-public-key>"},
      {"public_key": "<server-authorization-key-public-key>"},
      {"public_key": "<recovery-key-public-key>"}
    ]
  }'

# Then create a wallet owned by the quorum
curl -X POST https://api.privy.io/v1/wallets \
  -H "privy-app-id: <your-app-id>" \
  -H "Authorization: Basic <credentials>" \
  -H "Content-Type: application/json" \
  -d '{
    "chain_type": "ethereum",
    "owner_id": "<key-quorum-id-from-previous-response>"
  }'
```

### Generate an authorization key with the Node SDK

```ts
import {generateP256KeyPair} from '@privy-io/node';

const {privateKey, publicKey} = await generateP256KeyPair();
```

Returns DER-format keys (no PEM headers/footers) usable directly in SDK methods.

### Use a generated keypair as a wallet owner

```ts
import {PrivyClient} from '@privy-io/node';

const wallet = await privy.wallets().create({
  chain_type: 'ethereum',
  owner: {public_key: publicKey}
});

const {signature} = await privy.wallets().ethereum().signMessage(wallet.id, {
  message: 'Hello, world!',
  authorization_context: {authorization_private_keys: [privateKey]}
});
```

### Generate an authorization key with OpenSSL (REST flow)

```sh
openssl ecparam -name prime256v1 -genkey -noout -out private.pem && \
openssl ec -in private.pem -pubout -out public.pem

openssl ec -pubin -in public.pem -outform DER | base64
```

The base64-encoded DER public key gets registered with Privy. Note the `id` from the response - it becomes the `owner_id` or `signer_id` in future requests.

### Revoke a delegation

```tsx
const {removeSigners} = useSigners();
await removeSigners({address: walletAddress});
```

All signers are removed. After this the app cannot transact on behalf of the user until they re-grant access.

### Pre-sign auth payload for a delegated tx (server)

```ts
import {PrivyClient} from '@privy-io/node';

const privy = new PrivyClient(appId, appSecret);

const result = await privy.wallets().ethereum().sendTransaction(walletId, {
  transaction: {
    to: '0xrecipient',
    value: '0x' + (1n * 10n ** 18n).toString(16),
    chain_id: 8453,
  },
  authorization_context: {
    authorization_private_keys: [process.env.PRIVY_SERVER_AUTHORIZATION_KEY]
  }
});
```

The SDK constructs the canonical payload, signs it with your authorization key, and sets the `privy-authorization-signature` and `privy-request-expiry` headers automatically.

## Spectre-specific notes

Today (May 2026):

- We use Privy in the **default single-party approval model**: every transaction is signed by the user via the Privy modal in their browser. The user is the sole owner of their embedded wallet. No signers, no policies, no key quorums, no delegation.
- We do **not** operate server-side wallets. No authorization keys are configured on the server side, no `PRIVY_AUTHORIZATION_KEY` env var, no server-signed transfers.
- We do **not** use programmable wallets, MFA-gated wallets, or any quorum approval setup.
- Custody model: pure client-only, user-owned. The "non-custodial" point in `Spectre AI - Project Context` is explicitly enforced by this configuration.

When we would want to upgrade:

- **Copy-trading / signal-following** - user delegates to our server for a bounded window (24h). Server executes signal-triggered swaps automatically. Needs `delegation.md` + a transfer/swap policy (allowlist of DEX router contracts, per-trade size cap). See "Offline / agentic actions" pattern.
- **Telegram trading bot** - identical to copy-trading. Per-user server-side signer, scoped policy, optional expiry via TOTP re-approval flow.
- **Social recovery** - 2-of-3 quorum (user passkey + recovery email-bound key + Spectre server key). Mitigates the "user lost device" case without us touching their funds in the happy path. Needs `quorum-approval.md`.
- **Spectre treasury / DAO accounts** - dual approval (2-of-k quorum, finance + ops) for any outgoing transfer. Needs `dual-approval.md` and signer-scoped policies.
- **Agent wallets with kill switch** - user owner + Spectre server signer + recovery key. Server runs the agent, user can revoke at any time, recovery key can also revoke if user loses access.

Migration cost: each upgrade requires user re-consent (they need to sign an authorization to add the new signer or change ownership). It cannot be done silently.

## Gotchas & pitfalls

- **Server signer setup is not client-only.** Adding a server signer requires the server SDK (or REST) with a registered key quorum. The client `addSigners` call just adds the existing key quorum to the wallet - it does not create the underlying key. See cross-ref to 08-server-sdk.md.
- **Authorization signatures use P-256 keys, not the user's JWT signing key.** They are a separate signing scheme over the request payload, distinct from session tokens. Confusing the two is a common error.
- **Policies are enforced at the signer level inside the TEE.** A malicious or misconfigured client cannot bypass them. UI mirrors are belt-and-braces only.
- **Method matching is exact.** A wallet policy that allows `eth_sendTransaction` will deny `transfer` endpoint calls. Wallets that use the transfer or earn endpoints need explicit `transfer`, `earn_deposit`, `earn_withdraw` rules.
- **A single rule cannot mix `source.asset` and `source.asset_address`** (or `amount` and `raw_amount`). The request body includes one or the other, never both, and rules must match the format your app actually sends.
- **Delegation revocation is async at the Privy layer.** Transactions already signed by the server before the user revokes may still execute. There is no atomic in-flight cancellation.
- **Each signer can only have ONE override policy at this time.** If you need composite restrictions, encode them as multiple rules within the same policy object, not multiple policies on the signer.
- **Quorum signatures must meet the threshold and be included comma-delimited** in the `privy-authorization-signature` header. Order does not matter for verification, but all must be over the same canonical payload (including the same `privy-request-expiry` value).
- **`privy-request-expiry` is wall-clock Unix-ms.** Replay protection is timestamp-based, not nonce-based. Clock skew between your server and Privy can cause spurious rejections - keep the window comfortably wide but not excessive.
- **Removing all signers locks the app out.** If the user's only owner key is also lost (e.g. they removed their only signer and lost their passkey), wallet recovery depends on whether the Privy recovery flow is enabled for that wallet. There is no Privy-side "admin override".
- **User authorization keys are time-bound.** They expire. SDKs handle renewal; direct REST integrations must request a fresh key per session.
- **MFA gates the issuance of the user authorization key, not each individual signature.** Once the key is issued for the session, subsequent signatures within its lifetime do not re-prompt MFA.
- **Nested quorums are one level deep.** You cannot nest a quorum-inside-a-quorum-inside-a-quorum. Hierarchies must be flat after one level of nesting.
- **Programmable rules run on the signer side.** Mirror constraints in your UI for UX, but never rely on UI as the source of truth - the TEE is.
- **Custody upgrades are user-initiated.** Moving a wallet from single-party (user only) to dual-approval (user + server quorum) requires the user to re-consent and sign the wallet update. There is no silent ownership change.
- **Wallets created via Privy client-side SDKs default to user-owner.** If you want a server-owner wallet for a developer-controlled fleet, create it via the REST API or Node SDK with an explicit `owner` field, not through the client SDK.

## Cross-references

- Server SDK setup for server signers and authorization-key holding -> `08-server-sdk.md`
- Authorization signature canonical payload format and signing details -> `05-transactions-and-signing.md`
- Wallet types (user, business, treasury, execution) and creation defaults -> `02-embedded-wallets.md`
- Privy security architecture and TEE model -> `11-security-and-webhooks.md`
- Custody-model migration and breaking-change history -> `12-migrations-and-changelog.md`
