---
description: Privy server SDK reference (@privy-io/server-auth, @privy-io/node, server transactions, token verification, server-controlled wallets, signing on server). Synthesized from official docs.
---

# Privy Server SDK

## Source docs synthesized

- `quickstart.md` - signers + app authorization key quickstart (server can transact on user wallets)
- `quickstart (1).md` - React client quickstart (referenced for client side of token-passing flow)
- `quickstart (2).md` - NodeJS PrivyClient quickstart (`@privy-io/node`, wallet create, sign, sendTransaction)
- `quickstart (3).md` - REST API quickstart (curl examples, same shapes the Node SDK wraps)
- `server-transactions.md` - sending transactions from your server (two flows: Privy auth vs. own auth)
- `server-side-access.md` - signers granting server-side access to user wallets
- `server-updates.md` - updating wallets from your server via 1-of-k key quorum
- `server-export.md` - exporting wallet private keys from your server
- `signing-on-the-server.md` - `AuthorizationContext` interface for automatic request signing
- `migrating-from-server-auth.md` - `@privy-io/server-auth` -> `@privy-io/node` migration guide
- `agent-cli.md` - `@privy-io/agent-wallet-cli` (CLI flavor of server signing for agents)
- `business-wallets.md` - key quorums + policies for server-controlled treasury wallets
- `treasury-overview.md` - dual-approval treasury wallets (server-automated + human escalation)
- `access-tokens.md` - JWT format, where to send/extract, `verifyAccessToken` SDK method, JS/Go/Rust/Python examples (cross-ref to `01-auth-and-identity.md` - included here for token-verification context only)

## Core concepts

- Two generations of the Node server SDK exist:
  - `@privy-io/server-auth` (legacy) - `new PrivyClient(appId, appSecret)`, methods directly on the client (`privy.walletApi.createWallet`, `privy.verifyAuthToken`). Still in production at Spectre - see "Spectre-specific notes" below.
  - `@privy-io/node` (current) - `new PrivyClient({ appId, appSecret })`, resource-grouped methods (`privy.wallets().create`, `privy.users().create`, `privy.utils().auth().verifyAccessToken`). Snake_case fields matching the REST API.
- Other language SDKs exist: Python (`privy.PrivyAPI`), Go (`github.com/privy-io/go-sdk`), Rust (`privy_rs`), Java, Ruby. All implement the same `AuthorizationContext` pattern for signing.
- Server use cases:
  1. Verify access tokens (JWT) issued by Privy to authenticate API requests from your frontend.
  2. Fetch user data by DID (or email, or wallet address).
  3. Create / sign / send transactions with server-controlled wallets (Privy holds keys; your authorization key signs requests).
  4. Sign transactions on user-owned wallets when you have signer access (added via `addSigners` on the client - see `quickstart.md`).
  5. Admin operations: link / unlink accounts, update policies, update signers, export wallets.
- Auth model: server uses `appId` + `appSecret`. The `appSecret` is HTTP Basic auth credential for the Privy REST API. NEVER expose `appSecret` to the client.
- Server-controlled wallet vs client-controlled embedded wallet:
  - Client-controlled (default for user logins): wallet `owner` is the user (a user JWT must sign actions). Server cannot transact unilaterally unless granted a signer.
  - Server-controlled: wallet `owner` is your authorization key or a key quorum that you control. Your server holds the private signing key for that authorization key. Used for business/treasury wallets.
- Server signing happens via the `privy-authorization-signature` header on REST requests. The SDKs compute this for you when you pass an `AuthorizationContext`.

## SDK installation & setup

### `@privy-io/node` (current SDK)

```sh
npm install @privy-io/node
```

```ts
import { PrivyClient } from '@privy-io/node'

const privy = new PrivyClient({
  appId: 'insert-your-app-id',
  appSecret: 'insert-your-app-secret'
})
```

Runtime support (from `migrating-from-server-auth.md`):

- Node.js 20 LTS or later (non-EOL).
- Deno v1.28.0 or higher.
- Bun 1.0 or later.
- Cloudflare Workers.
- Vercel Edge Runtime.
- Nitro v2.6 or greater.

Optional `jwtVerificationKey` (saves a round-trip on every `verifyAccessToken` call):

```ts
const privy = new PrivyClient({
  appId: 'your-privy-app-id',
  appSecret: 'your-privy-app-secret',
  jwtVerificationKey: 'paste-your-verification-key-from-the-dashboard'
})
```

### `@privy-io/server-auth` (legacy SDK)

```sh
npm install @privy-io/server-auth
```

```ts
import { PrivyClient } from '@privy-io/server-auth'

const privy = new PrivyClient('insert-your-app-id', 'insert-your-app-secret')
// Note: positional args, not config object. Methods live directly on the client.
```

### Env var conventions

```
PRIVY_APP_ID=...
PRIVY_APP_SECRET=...
```

Some setups also store the verification key as `PRIVY_VERIFICATION_KEY` or `PRIVY_JWT_PUBLIC_KEY`.

### Python SDK

```python
from privy import PrivyAPI

client = PrivyAPI(app_id="your-privy-app-id", app_secret="your-privy-api-key")
```

## Access token verification

This is the most common server-side operation: an authenticated client sends `Authorization: Bearer <accessToken>`, server validates the JWT and extracts the user's DID.

### Token format (from `access-tokens.md`)

Privy access tokens are ES256-signed JWTs with these claims:

| Claim | Type | Meaning |
| --- | --- | --- |
| `sid` | string | Session ID |
| `sub` | string | User's Privy DID (e.g. `did:privy:cm...`) |
| `iss` | string | Always `privy.io` |
| `aud` | string | Your Privy app ID |
| `iat` | number | Issued-at Unix timestamp |
| `exp` | number | Expiry Unix timestamp (typically iat + 1 hour) |

### Extracting the token

Local-storage setup (default):

```ts
// Express.js
const accessToken = req.headers.authorization?.replace('Bearer ', '')

// Next.js API route
const accessToken = req.headers.authorization?.replace('Bearer ', '')

// Next.js App Router
const accessToken = headers().get('authorization')?.replace('Bearer ', '')
```

Cookie setup (if your app uses HTTP-only cookies):

```ts
// Express.js
const accessToken = req.cookies['privy-token']

// Next.js App Router
const cookieStore = cookies()
const accessToken = cookieStore.get('privy-token')?.value
```

### Verifying with `@privy-io/node`

```ts
try {
  const verifiedClaims = await privy.utils().auth().verifyAccessToken({
    access_token: accessToken
  })
  // verifiedClaims = { appId, userId, issuer, issuedAt, expiration, sessionId }
} catch (error) {
  console.log(`Token verification failed with error ${error}.`)
}
```

Returned claims (`@privy-io/node`):

| Field | Type | Description |
| --- | --- | --- |
| `appId` | string | Your Privy app ID |
| `userId` | string | The authenticated user's Privy DID. Use this to identify the requesting user. |
| `issuer` | string | Always `'privy.io'` |
| `issuedAt` | number | Unix timestamp |
| `expiration` | number | Unix timestamp |
| `sessionId` | string | Unique identifier for the user's session |

### Verifying with `@privy-io/server-auth` (legacy)

```ts
// On a legacy PrivyClient instance
const claims = await privy.verifyAuthToken(token)
// claims = { appId, userId, sessionId, issuer, issuedAt, expiration }
```

This is what Spectre's `packages/server/lib/auth.js` uses (see "Spectre-specific notes").

### Verifying with `jose` (no Privy SDK)

```ts
import * as jose from 'jose'

const verificationKey = await jose.importSPKI(
  'insert-your-privy-verification-key',
  'ES256'
)

try {
  const payload = await jose.jwtVerify(accessToken, verificationKey, {
    issuer: 'privy.io',
    audience: 'insert-your-privy-app-id'
  })
  // payload.sub = Privy DID
} catch (error) {
  console.error(error)
}
```

There's also a JWKS variant - fetch the public key from `https://auth.privy.io/api/v1/apps/${appId}/jwks.json`. Spectre's `apps/research/api/_lib/auth.js` uses this (see Spectre notes).

### Verifying with `jsonwebtoken`

```ts
import jwt from 'jsonwebtoken'

const verificationKey = 'insert-your-privy-verification-key'.replace(/\\n/g, '\n')

try {
  const decoded = jwt.verify(accessToken, verificationKey, {
    issuer: 'privy.io',
    audience: 'your-privy-app-id'
  })
  // decoded.sub = Privy DID
} catch (error) {
  console.error(error)
}
```

The `.replace(/\\n/g, '\n')` step converts escaped newlines in the env var back into real newlines, per PEM format.

### Express middleware example

```ts
import { PrivyClient } from '@privy-io/node'

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID,
  appSecret: process.env.PRIVY_APP_SECRET
})

export async function requirePrivyAuth(req, res, next) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const token = auth.slice(7)
  try {
    const claims = await privy.utils().auth().verifyAccessToken({ access_token: token })
    req.userId = claims.userId
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized', detail: err.message })
  }
}

// Usage
app.post('/api/protected', requirePrivyAuth, async (req, res) => {
  // req.userId is the verified Privy DID
})
```

### Vercel serverless example

```ts
// apps/research/api/protected.js
import { PrivyClient } from '@privy-io/node'

let _client = null
function getClient() {
  if (_client) return _client
  _client = new PrivyClient({
    appId: process.env.PRIVY_APP_ID,
    appSecret: process.env.PRIVY_APP_SECRET
  })
  return _client
}

export default async function handler(req, res) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const claims = await getClient().utils().auth().verifyAccessToken({
      access_token: auth.slice(7)
    })
    // ... business logic using claims.userId
    return res.status(200).json({ ok: true, userId: claims.userId })
  } catch {
    return res.status(401).json({ error: 'Unauthorized' })
  }
}
```

### Managing expired tokens

From `access-tokens.md`:

- If the server gets `'invalid auth token'`, return an error to the client.
- The client should then call `getAccessToken()` with backoff. That method auto-refreshes a token nearing expiry.
- If refresh fails, Privy logs the user out.

## User management

### `@privy-io/node`

```ts
// Create a user
const user = await privy.users().create({
  linked_accounts: [
    { type: 'custom_auth', custom_user_id: '$SUBJECT_ID' },
    { type: 'email', address: '$EMAIL' }
  ]
})

// Create a user with a wallet in one call
const user = await privy.users().create({
  linked_accounts: [{ type: 'email', address: 'batman@privy.io' }],
  wallets: [{ chain_type: 'ethereum' }]
})
```

### `@privy-io/server-auth` (legacy)

```ts
// Get user by DID
const user = await privy.getUser(did)

// Get user by email
const user = await privy.getUserByEmail(email)

// Get user by wallet address
const user = await privy.getUserByWalletAddress(address)

// Link / unlink
await privy.linkEmail(did, email)
await privy.linkWallet(did, address)
await privy.unlinkEmail(did, email)
await privy.unlinkWallet(did, address)

// Delete
await privy.deleteUser(did)

// Paginated list
const { users, cursor } = await privy.getUsers({ cursor, limit: 100 })
```

The new SDK exposes the same operations under `privy.users()` (the docs only show `create` and `getByEmailAddress` in the migration guide; the full set is one-to-one with the REST API per the migration note "The new SDK offers a one-to-one mapping of the API endpoints").

### Error handling for missing users

In `@privy-io/server-auth`, `getUserByEmail` returned `null` for not-found. In `@privy-io/node`, the equivalent throws `NotFoundError`:

```ts
import { NotFoundError, PrivyClient, type User } from '@privy-io/node'

const privy = new PrivyClient({ appId: '...', appSecret: '...' })

let user: User | null = null

try {
  user = await privy.users().getByEmailAddress({ address: 'user@example.com' })
} catch (error) {
  if (error instanceof NotFoundError) {
    user = null
  } else {
    throw error
  }
}

if (user) {
  // Handle the matching user.
}
```

## Server wallets (Privy Server Wallets)

Wallets where Privy holds the keys and your authorization key is the owner. Used for app-controlled flows.

### Create a wallet (no owner - server-controlled by default)

```ts
import { APIError, PrivyAPIError } from '@privy-io/node'

try {
  const createdWallet = await privy.wallets().create({ chain_type: 'ethereum' })
  const walletId = createdWallet.id
} catch (error) {
  if (error instanceof APIError) {
    console.log(error.status)  // 400
    console.log(error.name)    // BadRequestError
  } else if (error instanceof PrivyAPIError) {
    console.log(error.message)
  } else {
    throw error
  }
}
```

Solana variant:

```ts
const createdWallet = await privy.wallets().create({ chain_type: 'solana' })
```

### Create a user-owned wallet

```ts
const user = await privy.users().create({
  linked_accounts: [{ type: 'email', address: 'batman@privy.io' }]
})

const { id, address, chain_type } = await privy.wallets().create({
  chain_type: 'ethereum',
  owner: { user_id: user.id }
})
```

The same call works with `chain_type: 'solana'`.

### Sign a message on the server

```ts
// Ethereum
const message = 'Hello, Privy!'
const response = await privy.wallets().ethereum().signMessage(walletId, { message })
const signature = response.signature  // hex-encoded

// Solana - message must be base64 encoded
const base64Message = Buffer.from(message, 'utf8').toString('base64')
const response = await privy.wallets().solana().signMessage(walletId, { message: base64Message })
const signature = response.signature  // base64-encoded
```

### REST API wallet creation (`quickstart (3).md`)

```bash
curl --request POST \
  --url https://api.privy.io/v1/wallets \
  --header 'Authorization: Basic <encoded-value>' \
  --header 'Content-Type: application/json' \
  --header 'privy-app-id: <privy-app-id>' \
  --data '{
  "chain_type": "ethereum"
}'
```

Response:

```json
{
  "id": "jf4mev19seymsqulciv8on0c",
  "address": "0x7Ef5363308127128969618240eDcB9F8f61e90F6",
  "chain_type": "ethereum",
  "policy_ids": [],
  "created_at": 1741362961254
}
```

### Key custody options

- Privy holds keys (default for server wallets). Your server only holds the authorization private key that signs API requests.
- HMAC / customer-held keys: not directly documented in these source files - cross-ref to `10-wallet-controls-and-authorization.md` and the `Flixible Custody.md` doc.
- MPC / TEE: see `Secure Enclaves.md` and `Security Architecture.md`.

Cross-ref: authorization keys, key quorums, policies, signers all live in `10-wallet-controls-and-authorization.md`.

## Server transactions

### `@privy-io/node` - send an Ethereum transaction

```ts
const caip2 = 'eip155:11155111'  // Sepolia testnet

const response = await privy.wallets().ethereum().sendTransaction(walletId, {
  caip2,
  params: {
    transaction: {
      to: recipientAddress,
      value: '0x1',         // 1 wei
      chain_id: 11_155_111  // Sepolia testnet
    }
  }
})
const transactionHash = response.hash
```

The SDK auto-populates missing network fields (gas limit, gas fee values, nonce, type), signs, broadcasts, and returns the tx hash.

### Solana

```ts
const caip2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'  // Solana mainnet

// Base64-encoded serialized transaction
const transaction = 'insert-base-64-encoded-serialized-transaction'

const response = await privy.wallets().solana().signAndSendTransaction(walletId, {
  caip2,
  transaction
})
const transactionHash = response.hash
```

### REST API equivalent

```bash
curl --request POST \
  --url https://api.privy.io/v1/wallets/{wallet_id}/rpc \
  --header 'Authorization: Basic <encoded-value>' \
  --header 'Content-Type: application/json' \
  --header 'privy-app-id: <privy-app-id>' \
  --data '{
  "method": "eth_sendTransaction",
  "caip2": "eip155:11155111",
  "chain_type": "ethereum",
  "params": {
    "transaction": {
      "to": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      "value": 1000000000000000
    }
  }
}'
```

Response:

```json
{
  "method": "eth_sendTransaction",
  "data": {
    "hash": "0x7c91ba85d67ef92cc15f3e9c8d8c5788e982cf83fabe9bfcc66a747aa0bd3701",
    "caip2": "eip155:11155111",
    "transaction_id": "d2obiyxnblv7jzp73b8scqa8"
  }
}
```

### Idempotency keys

From the REST quickstart and `idempotency-keys.md`: include an idempotency key in the request to prevent duplicate sends on retry. Strongly recommended for any server-initiated transaction. See `14-errors-and-troubleshooting.md` for retry semantics.

### Polling action status

Server-initiated transactions return a `transaction_id`. Use the `Get wallet action status` endpoint to check status (cross-ref to `Get wallet action status.md`). Webhooks are the preferred alternative - see `11-security-and-webhooks.md`.

## Server-side access to user wallets

From `server-side-access.md` and the signers quickstart.

The flow for a server to act on a user's wallet:

1. User logs in, embedded wallet is auto-created (`createOnLogin: 'all-users'`).
2. Client calls `addSigners({ address, signers: [{ signerId, policyIds }] })` to grant server signing access. The `signerId` is the ID of a key quorum you registered in step 2 of the quickstart.
3. Optionally, attach a `policyIds` array to constrain what the signer can do (e.g. expire after a date, limit USD value, restrict to specific contracts). Empty array = full permission.
4. Server signs transaction requests with the authorization private key whose public key you registered in the key quorum.
5. Server calls `privy.wallets().ethereum().sendTransaction(...)` (or REST `/v1/wallets/{wallet_id}/rpc`) with an `AuthorizationContext` containing the private key.

### Setting up the app authorization key (quickstart.md step 1-2)

```sh
openssl ecparam -name prime256v1 -genkey -noout -out private.pem && \
openssl ec -in private.pem -pubout -out public.pem
```

Then register the public key in the Privy Dashboard under Authorization keys, with "Register key quorum instead" and Authorization threshold = 1. Save the key quorum ID.

### Adding the signer from the client

```tsx
import { useSigners } from '@privy-io/react-auth'

const { addSigners } = useSigners()

await addSigners({
  address: 'insert-user-embedded-wallet-address',
  signers: [{
    signerId: 'insert-key-quorum-id-from-step-2',
    policyIds: ['insert-policy-id-1', 'insert-policy-id-2']
    // or: policyIds: []   // for full permission
  }]
})
```

Common pattern: add signer immediately on login.

```tsx
import { useLogin, useSigners } from '@privy-io/react-auth'

const { addSigners } = useSigners()
const { login } = useLogin({
  onComplete: async (user, isNewUser) => {
    if (isNewUser) {
      await addSigners({
        address: user.wallet.address,
        signers: [{ signerId: 'insert-key-quorum-id', policyIds: [] }]
      })
    }
  }
})
```

### Use case examples

- Limit orders: signer with a time-bound, contract-allowlisted policy. Server fires when conditions match.
- Portfolio rebalancing: signer with allowlisted contracts (DEX router, lending pool), USD cap.
- Telegram trading bot: signer that can execute swaps on behalf of the user while offline.

## Server export

From `server-export.md`. To export a user's wallet private key from your server:

1. Create the wallet with a 1-of-k key quorum (members: user + your server's authorization key).
2. Your server's authorization key alone can satisfy the quorum, so it can call the export endpoint unilaterally.
3. Follow the wallet export guide (see `Wallet Actions.md` and dashboard export flow) using your authorization key in the `AuthorizationContext`.

Use cases: self-hosted recovery site where users export keys outside the core app, compliance / audit, migration off Privy.

## Server updates

From `server-updates.md`. Same 1-of-k pattern. The server's authorization key can unilaterally update:

- Wallet policies
- Wallet signers
- Wallet owner configuration

This lets your app reconfigure wallets while users are offline (e.g. rotate a signer key, tighten a policy after suspicious activity).

## Signing on the server (AuthorizationContext)

The `AuthorizationContext` abstraction (current `@privy-io/node` only - the legacy `@privy-io/server-auth` used `walletApi.updateAuthorizationKey` instead).

You pass the context to any SDK method that may require request signing. The SDK computes signatures and adds them as the `privy-authorization-signature` header. Four input modes:

### Authorization private keys

```ts
import { AuthorizationContext } from '@privy-io/node'

const authorizationContext: AuthorizationContext = {
  authorization_private_keys: ['authorization-key']
}
```

Java:

```java
AuthorizationContext authorizationContext = AuthorizationContext.builder()
    .addAuthorizationPrivateKey("authorization-key")
    .build();
```

Rust:

```rust
use privy_rs::{AuthorizationContext, PrivateKey};

let ctx = AuthorizationContext::new().push(
    PrivateKey("authorization-key".to_string())
);
```

Go:

```go
import "github.com/privy-io/go-sdk/authorization"

authCtx := &authorization.AuthorizationContext{
    PrivateKeys: []string{"authorization-key"},
}
```

Ruby:

```ruby
ctx = Privy::Authorization::AuthorizationContext.build(
  authorization_private_keys: ["authorization-key"]
)
```

### User JWTs

The SDK requests a signing key for the user from Privy and signs with it.

```ts
const authorizationContext: AuthorizationContext = {
  user_jwts: ['user-jwt']
}
```

Rust:

```rust
use privy_rs::{AuthorizationContext, JwtUser, PrivyClient};

let client = PrivyClient::new(app_id, app_secret)?;
let jwt_user = JwtUser(client.clone(), "user-jwt".to_string());

let ctx = AuthorizationContext::new().push(jwt_user);
```

### Custom signing function (KMS, HSM, etc.)

```ts
async function mySignFunction(payload: Uint8Array): Promise<string> {
  // ECDSA P-256 over the payload (already canonicalized by the SDK).
  const signature = await kms.sign(payload)
  return signature  // base64-encoded string
}

const authorizationContext: AuthorizationContext = {
  sign_functions: [mySignFunction]
}
```

Important: "The binary payload received by the sign function is already formatted and ready to be signed. There is no need to canonicalize or serialize the payload before signing."

Rust:

```rust
use privy_rs::{AuthorizationContext, FnSigner};

let custom_signer = FnSigner(|message: &[u8]| async move {
    let signature_bytes = kms_sign(message).await?;
    let signature_b64 = general_purpose::STANDARD.encode(&signature_bytes);
    Ok(Signature {
        signature: signature_b64,
        key_id: "custom-key".to_string()
    })
});

let ctx = AuthorizationContext::new().push(custom_signer);
```

Go:

```go
type MySigner struct{}

func (s *MySigner) Sign(ctx context.Context, payload []byte) (string, error) {
    return "signature", nil
}

authCtx := &authorization.AuthorizationContext{
    Signers: []authorization.AuthorizationSigner{&MySigner{}},
}
```

Ruby:

```ruby
sign_fn = ->(payload) {
  kms.sign(payload)  # base64-encoded string
}

ctx = Privy::Authorization::AuthorizationContext.build(sign_fns: [sign_fn])
```

### Pre-computed signatures

```ts
const authorizationContext: AuthorizationContext = {
  signatures: ['signature-you-produced']
}
```

### Combining modes (key quorums)

A 2-of-2 quorum (user + authorization key):

```ts
const authorizationContext: AuthorizationContext = {
  user_jwts: ['user-jwt'],
  authorization_private_keys: ['authorization-key']
}
```

Multiple authorization keys (all into one property):

```ts
const authorizationContext: AuthorizationContext = {
  authorization_private_keys: ['key1', 'key2', 'key3']
}
```

### Passing the context to SDK methods

```ts
import { PrivyClient, type AuthorizationContext } from '@privy-io/node'

const privy = new PrivyClient({
  appId: 'insert-your-app-id',
  appSecret: 'insert-your-app-secret'
})

const authorizationContext: AuthorizationContext = {
  authorization_private_keys: ['authorization-key']
}

const response = await privy.wallets().ethereum().signMessage('insert-wallet-id', {
  message: 'Hello, world!',
  authorization_context: authorizationContext
})
```

Rust:

```rust
let ethereum_service = client.wallets().ethereum();
let auth_ctx = AuthorizationContext::new();

let signature = ethereum_service
    .sign_message(
        &wallet_id,
        "Hello, Ethereum!",
        &auth_ctx,
        Some("unique-request-id-123"),
    )
    .await?;
```

Go:

```go
import (
    privy "github.com/privy-io/go-sdk"
    "github.com/privy-io/go-sdk/authorization"
)

authCtx := &authorization.AuthorizationContext{
    PrivateKeys: []string{"authorization-key"},
}

response, err := client.Wallets.Ethereum.SignMessage(
    context.Background(),
    walletID,
    "Hello, Privy!",
    privy.WithAuthorizationContext(authCtx),
)
```

Ruby:

```ruby
ctx = Privy::Authorization::AuthorizationContext.build(
  authorization_private_keys: ["authorization-key"]
)

response = client.wallets.rpc(
  "insert-wallet-id",
  wallet_rpc_request_body: {
    method: "personal_sign",
    chain_type: "ethereum",
    params: { message: "Hello, world!", encoding: "utf-8" }
  },
  authorization_context: ctx
)
```

## Migrating from `@privy-io/server-auth` to `@privy-io/node`

Full guide from `migrating-from-server-auth.md`.

### 1. Initialization

```ts
// Before
import { PrivyClient } from '@privy-io/server-auth'
const privy = new PrivyClient('insert-your-app-id', 'insert-your-app-secret')

// After
import { PrivyClient as NewPrivyClient } from '@privy-io/node'
const newPrivy = new NewPrivyClient({
  appId: 'insert-your-app-id',
  appSecret: 'insert-your-app-secret'
})
```

### 2. Resource grouping

Methods now live on resource-specific interfaces. Fields are `snake_case` (matching the REST API) instead of `camelCase`:

```ts
// Before
const user = await privy.importUser({
  linkedAccounts: [{ type: 'email', address: 'test@example.com' }],
  wallets: [{ chainType: 'ethereum' }]
})

// After
const user = await privy.users().create({
  linked_accounts: [{ type: 'email', address: 'test@example.com' }],
  wallets: [{ chain_type: 'ethereum' }]
})
```

Method mapping table:

| `@privy-io/server-auth` | `@privy-io/node` |
| --- | --- |
| `privy.walletApi.createWallet` | `privy.wallets().create` |
| `privy.walletApi.rpc` | `privy.wallets().rpc` |
| `privy.walletApi.ethereum.signMessage` | `privy.wallets().ethereum().signMessage` |
| `privy.walletApi.createPolicy` | `privy.policies().create` |

### 3. Authorization signatures

```ts
// Before
import { PrivyClient } from '@privy-io/server-auth'
const privy = new PrivyClient('insert-your-app-id', 'insert-your-app-secret')
privy.walletApi.updateAuthorizationKey('insert-your-authorization-private-key')

// After
import { AuthorizationContext } from '@privy-io/node'
const authorizationContext: AuthorizationContext = {
  authorization_private_keys: ['insert-your-authorization-private-key']
}
// Pass to each method that needs it.
```

You now pass the context per-call, giving fine-grained control (different keys / quorums for different requests).

### 4. User signers - method removed

```ts
// Before
const { authorizationKey } = await privy.walletApi.generateUserSigner({
  userJwt: 'insert-user-jwt'
})
privy.walletApi.updateAuthorizationKey(authorizationKey)

// After - just set user_jwts in the context, the SDK handles signing keys
const authorizationContext: AuthorizationContext = {
  user_jwts: ['insert-user-jwt'],
  authorization_private_keys: ['insert-authorization-private-key']
}
```

Note from the docs:

> The `privy.walletApi.generateUserSigner` method is no longer available in the `@privy-io/node` package. Instead you can set the `user_jwts` property on the authorization context, and the SDK will handle the authorization keys automatically.

### 5. Error handling

`@privy-io/server-auth` returned `null` for not-found resources. `@privy-io/node` throws `NotFoundError`:

```ts
import { NotFoundError, PrivyClient, type User } from '@privy-io/node'

const privy = new PrivyClient({ appId: '...', appSecret: '...' })

let user: User | null = null

try {
  user = await privy.users().getByEmailAddress({ address: 'user@example.com' })
} catch (error) {
  if (error instanceof NotFoundError) {
    user = null
  } else {
    throw error
  }
}
```

All API errors throw `APIError` or its subclasses (`BadRequestError`, `NotFoundError`, etc.). Other SDK errors throw `PrivyAPIError`. Wrap calls:

```ts
import { APIError, PrivyAPIError } from '@privy-io/node'

try {
  await privy.wallets().create({ chain_type: 'ethereum' })
} catch (error) {
  if (error instanceof APIError) {
    console.log(error.status, error.name)  // 400, 'BadRequestError'
  } else if (error instanceof PrivyAPIError) {
    console.log(error.message)
  } else {
    throw error
  }
}
```

## Agent CLI (`@privy-io/agent-wallet-cli`)

From `agent-cli.md`. A CLI tool for agentic / assistant-driven server signing without writing integration code.

```sh
npm install -g @privy-io/agent-wallet-cli
# or
npx @privy-io/agent-wallet-cli login
```

Workflow:

```sh
privy-agent-wallets login          # browser auth, stores P-256 session keypair
privy-agent-wallets fund           # opens agent sandbox to onramp
privy-agent-wallets list-wallets   # show Ethereum + Solana wallet IDs
privy-agent-wallets rpc --json '{"method": "eth_sendTransaction", "params": {"to": "0xRecipient", "value": "0.01"}}'
echo '{"method": "personal_sign", "params": {"message": "hello"}}' | privy-agent-wallets rpc
privy-agent-wallets logout
```

Supported RPC methods (Ethereum): `personal_sign`, `eth_sendTransaction`, `eth_signTransaction`, `eth_signTypedData_v4`, `secp256k1_sign`, `eth_sign7702Authorization`, `eth_signUserOperation`.

Supported RPC methods (Solana): `signTransaction`, `signAndSendTransaction`, `signMessage`.

How it works (from the doc):

1. CLI generates a local P-256 keypair, opens browser for auth.
2. Human logs in via Privy and grants the agent signer access.
3. CLI stores session in OS credential manager (Keychain / libsecret / PowerShell SecretManagement) or encrypted file at `~/.privy/session.json`.
4. Every RPC call signs an authorization payload locally and sends it to the agent server, which verifies, injects app credentials, and forwards to Privy.

Sessions expire after 7 days. Users revoke at `agents.privy.io/manage`.

## Business / treasury wallets (server-controlled)

From `business-wallets.md` and `treasury-overview.md`.

The recipe for server-controlled wallets with controls:

1. Create m-of-n authorization keys in the Privy Dashboard, save private keys.
2. Register them in a key quorum (e.g. 2-of-3). Save the quorum `id`.
3. Create a policy (transfer limits, contract allowlist, time bounds). Save the policy `id`.
4. Create a wallet with `owner_id = quorum_id` and `policy_ids: [policy_id]`.
5. Sign requests with m of n private keys. Pass them all to `authorization_private_keys` in an `AuthorizationContext`.
6. Send transactions via `privy.wallets().ethereum().sendTransaction(...)` or REST.

The docs strongly recommend the server SDKs for generating quorum signatures:

> Privy strongly recommends using Privy's server-side SDKs to generate and include authorization signatures in your requests automatically.

Treasury patterns from `treasury-overview.md`:

- Dual approval paths: one wallet with a server-controlled key for routine transactions (payroll, vendor payments) and a key quorum for human escalation on sensitive transfers.
- Multi-party treasury: pure m-of-n quorum with policy constraints (transfer caps, recipient lists). No single party can move funds.
- High-throughput protocol execution: wallet fleets upgraded to smart accounts via EIP-7702, parallel transactions to bypass nonce bottlenecks, batched multi-call transactions.

Additional signers can be set on the wallet (beyond the owner) with their own policies - lets multiple parties take actions with different permission sets.

## Code patterns (verbatim)

### Express middleware verifying access token (current SDK)

```ts
import { PrivyClient } from '@privy-io/node'

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID,
  appSecret: process.env.PRIVY_APP_SECRET
})

export async function requirePrivyAuth(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const claims = await privy.utils().auth().verifyAccessToken({
      access_token: auth.slice(7)
    })
    req.userId = claims.userId
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
}
```

### Vercel serverless verifying token + fetching user

```ts
import { PrivyClient, NotFoundError } from '@privy-io/node'

let _privy = null
function getPrivy() {
  if (_privy) return _privy
  _privy = new PrivyClient({
    appId: process.env.PRIVY_APP_ID,
    appSecret: process.env.PRIVY_APP_SECRET,
    jwtVerificationKey: process.env.PRIVY_JWT_PUBLIC_KEY
  })
  return _privy
}

export default async function handler(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const privy = getPrivy()
  let claims
  try {
    claims = await privy.utils().auth().verifyAccessToken({ access_token: token })
  } catch {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const user = await privy.users().get({ user_id: claims.userId })
    return res.status(200).json({ user })
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ error: 'User not found' })
    return res.status(500).json({ error: 'Internal error' })
  }
}
```

### Server-create wallet + send tx

```ts
import { PrivyClient, AuthorizationContext } from '@privy-io/node'

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID,
  appSecret: process.env.PRIVY_APP_SECRET
})

// Wallet owned by your server's authorization key
const wallet = await privy.wallets().create({
  chain_type: 'ethereum',
  owner_id: 'your-key-quorum-id',
  policy_ids: ['your-policy-id']
})

const authorizationContext: AuthorizationContext = {
  authorization_private_keys: [process.env.PRIVY_AUTH_KEY_PRIVATE]
}

const response = await privy.wallets().ethereum().sendTransaction(wallet.id, {
  caip2: 'eip155:1',
  params: {
    transaction: {
      to: '0xRecipient',
      value: '0x16345785D8A0000',  // 0.1 ETH in wei
      chain_id: 1
    }
  },
  authorization_context: authorizationContext
})

const { hash, transaction_id } = response
```

### Bulk user fetch + filter (legacy SDK pattern)

```ts
import { PrivyClient } from '@privy-io/server-auth'

const privy = new PrivyClient(process.env.PRIVY_APP_ID, process.env.PRIVY_APP_SECRET)

async function findUsersWithSolanaWallet() {
  let cursor = undefined
  const matched = []
  while (true) {
    const { users, nextCursor } = await privy.getUsers({ cursor, limit: 100 })
    for (const user of users) {
      if (user.linkedAccounts.some(a => a.chainType === 'solana')) matched.push(user)
    }
    if (!nextCursor) break
    cursor = nextCursor
  }
  return matched
}
```

### Sign a Solana tx on the server (sponsoring user gas)

```ts
import { PrivyClient, AuthorizationContext } from '@privy-io/node'

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID,
  appSecret: process.env.PRIVY_APP_SECRET
})

// User's wallet, signer added via addSigners() on client
const userWalletId = 'wallet_xxx'

const transactionB64 = '...base64-serialized-tx-with-server-fee-payer...'

const authorizationContext: AuthorizationContext = {
  authorization_private_keys: [process.env.PRIVY_AUTH_KEY_PRIVATE]
}

const response = await privy.wallets().solana().signAndSendTransaction(userWalletId, {
  caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  transaction: transactionB64,
  authorization_context: authorizationContext
})

const transactionHash = response.hash
```

### Webhook handler for action status

Cross-ref to `11-security-and-webhooks.md`. Skeleton:

```ts
import { PrivyClient } from '@privy-io/node'
import crypto from 'crypto'

export default async function handler(req, res) {
  const signature = req.headers['privy-signature']
  const body = JSON.stringify(req.body)
  const expected = crypto
    .createHmac('sha256', process.env.PRIVY_WEBHOOK_SECRET)
    .update(body)
    .digest('hex')
  if (signature !== expected) return res.status(401).json({ error: 'Invalid signature' })

  const { event, data } = req.body
  if (event === 'wallet.transaction.confirmed') {
    // record tx success
  } else if (event === 'wallet.transaction.failed') {
    // alert / retry
  }
  res.status(200).json({ ok: true })
}
```

## Spectre-specific notes

Spectre uses Privy server auth in production, but in two places with two different SDK versions:

### Express server (`packages/server/lib/auth.js`)

Uses the legacy `@privy-io/server-auth` SDK:

```js
const { PrivyClient } = await import('@privy-io/server-auth')
_client = new PrivyClient(appId, appSecret)
// ...
const claims = await client.verifyAuthToken(token)
return claims.userId || null
```

- Singleton client guarded by `_clientPromise` to handle concurrent first-call races.
- Reads `PRIVY_APP_ID` + `PRIVY_APP_SECRET` from env.
- Exports `verifyPrivyToken(req)` (returns DID or null) and `requirePrivyAuth` middleware.

### Vercel serverless (`apps/research/api/_lib/auth.js`)

Uses the current `@privy-io/node` SDK + `jose` for JWKS-based verification:

```js
const privy = await import('@privy-io/node')
const jose = await import('jose')
_verifyAccessToken = privy.verifyAccessToken
_createRemoteJWKSet = jose.createRemoteJWKSet
// ...
_jwks = _createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`))
// ...
const result = await _verifyAccessToken({
  access_token: token,
  app_id: process.env.PRIVY_APP_ID,
  verification_key: getJwks()
})
return result.user_id || null
```

Key differences from the Express version:

- Only needs `PRIVY_APP_ID` (no `PRIVY_APP_SECRET`) because verification is public-key-based via JWKS.
- Dynamic imports inside the function so a bundling failure becomes a clean `return null` -> 401 instead of `FUNCTION_INVOCATION_FAILED`.
- This is the Vercel-runtime-safe pattern.

### Routes currently protected

From a grep across the codebase:

- `packages/server/index.js`:
  - `POST /api/ai/answer` (`aiRateLimit`, `requirePrivyAuth`, `aiUserRateLimit`)
  - `POST /api/brain/chat`
  - `GET /api/brain/chat/stream`
  - `GET /api/brain/stream`
  - Plus opportunistic calls (`try { userId = await verifyPrivyToken(req) } catch { userId = null }`) where userId is logged but auth is not required.
- `packages/server/routes/users.js` - calls `verifyPrivyToken` inline at line 111.
- `packages/server/routes/swap.js` - calls `verifyPrivyToken` at lines 286 and 308 (swap log/history endpoints).

### Routes NOT protected (gaps)

From the API patterns rule (`.claude/rules/api-patterns.md`): "Functions requiring auth: `user.js`, `swap.js` (log/history only; quote is public), `referral.js`, `admin.js`."

Verify this end-to-end on the Vercel serverless side - the rule says these functions require auth, and the helper exists at `apps/research/api/_lib/auth.js`, but each Vercel function must explicitly call `verifyPrivyToken` and gate on its return. Audit each `apps/*/api/*.js` file individually before assuming coverage. Functions like `cg-proxy.js`, `binance-ticker.js`, `img-proxy.js`, `news.js`, `fear-greed.js`, `codex.js` are intentionally public.

### Recommended audit steps

1. Grep each Vercel serverless function (`apps/research/api/*.js`, `apps/trading/api/*.js`) for `verifyPrivyToken`. Functions that read or write user-specific data without that call are gaps.
2. Confirm that the client always sends `Authorization: Bearer ${await getAccessToken()}` for protected endpoints. Cross-ref `apps/research/src/lib/privy-config.js` and the swap / profile sync service files.
3. For any endpoint that receives a `did` parameter, server must verify `did === verifiedClaims.userId` - never trust the client-supplied DID.
4. SDK upgrade: the Express server still uses `@privy-io/server-auth`. The migration to `@privy-io/node` is non-blocking but recommended (matches the Vercel path; gets `NotFoundError`, snake_case API, AuthorizationContext for any future server-signing needs).

### Server signing / server wallets - not used at Spectre

Spectre is non-custodial. From the root CLAUDE.md:

> Non-custodial - never pass private keys to any server route, even encrypted. Wallet signing happens client-side via Privy embedded wallets only.

No `addSigners` flow, no `AuthorizationContext` usage, no server-controlled wallets. The Privy server SDK at Spectre is used purely for token verification, not for transacting.

If we ever add app-initiated transactions (limit orders, automated rebalancing, Telegram bot trading), the flow would be:

1. Generate an app authorization key (P-256, OpenSSL).
2. Register it as a 1-of-1 key quorum in the Privy Dashboard.
3. Create a per-feature policy.
4. Client calls `addSigners` after login.
5. Server holds the authorization private key (`PRIVY_AUTH_KEY_PRIVATE` env var) and signs requests via `AuthorizationContext`.

This would require migrating `packages/server/lib/auth.js` to `@privy-io/node` (the legacy SDK does not have `AuthorizationContext`).

## Gotchas & pitfalls

- `PRIVY_APP_SECRET` MUST be server-only. Exposing it in any client-shipped bundle grants full app admin powers (create/delete users, create wallets, etc.). Vercel env vars are NOT exposed unless prefixed `VITE_`.
- The JWKS verification path used in Spectre's Vercel functions does NOT need `PRIVY_APP_SECRET` - only `PRIVY_APP_ID`. Don't accidentally require the secret in serverless functions that only verify tokens.
- `verifyAuthToken` (legacy) and `verifyAccessToken` (current) have different return shapes:
  - Legacy returns camelCase (`userId`, `sessionId`).
  - Current returns snake_case in some places (`user_id`) and camelCase in others depending on call style. Spectre's `apps/research/api/_lib/auth.js` reads `result.user_id`, while the legacy server reads `claims.userId`. Confirm via the actual SDK version.
- Access tokens have ~1 hour expiry. Server must reject expired tokens; client must auto-refresh via `getAccessToken()`.
- `verifyAccessToken` makes a request to fetch the verification key the first time. Pass `jwtVerificationKey` (PrivyClient option) or use a cached JWKS (`createRemoteJWKSet` caches in memory) to avoid latency on hot paths.
- `getUser(did)` returns `null` (legacy) or throws `NotFoundError` (current) when DID is not found. Check the SDK version and handle accordingly.
- Linking an email already owned by another user returns a 4xx with a specific error code. Catch it and present a "this email is already in use" UI message instead of bubbling a generic error.
- Server wallets have separate authentication from user JWTs: they require `privy-authorization-signature` (P-256 signature by an authorization key registered in the wallet's owning key quorum). User JWTs alone do not authorize server-wallet actions unless the user is in the quorum.
- Bulk user list is paginated. Don't try to fetch all users in one call. Use `cursor` + `limit` and loop.
- Idempotency keys on server-side tx prevent duplicate sends across retries. Use them for every server-initiated transaction. See `idempotency-keys.md`.
- For Solana server signing, the server must have signing authority delegated. This means either the wallet is server-owned (authorization key) or a user-owned wallet had `addSigners` called from the client. See `10-wallet-controls-and-authorization.md`.
- `@privy-io/node` requires Node 20+ LTS. Cloudflare Workers, Deno, Bun, Vercel Edge are supported. Some legacy runtimes (Node 16, older serverless platforms) will not work.
- Dynamic imports of `@privy-io/node` + `jose` in Vercel functions can fail silently if `nft` (Vercel's module tracer) misses them. Spectre's `auth.js` wraps the imports in try/catch and returns null on failure - copy that pattern.
- `replace(/\\n/g, '\n')` is required when reading a PEM key from an env var that escaped the newlines (Vercel does this).
- Access token verification fails if `aud` does not match your app ID. Make sure the same `PRIVY_APP_ID` is set on both client (`VITE_PRIVY_APP_ID`) and server (`PRIVY_APP_ID`).
- The `privy-authorization-signature` header is only required for endpoints with a non-default owner (key quorum or authorization-key-owned wallets). For user-owned wallets, the user JWT is the authorization.
- HTTP-only cookie session storage: the token is in `req.cookies['privy-token']`, not the `Authorization` header. Both modes are valid; check which your app uses (Spectre uses local storage / `Authorization: Bearer`).
- The legacy `@privy-io/server-auth` does NOT have `AuthorizationContext` - if your app needs server signing, migrate to `@privy-io/node` first.
- Custom sign functions receive a Uint8Array that is already canonicalized. Do NOT re-canonicalize or wrap in another digest before signing. Sign the raw bytes with ECDSA P-256, return base64.

## Cross-references

- Client-side auth (where tokens come from, `getAccessToken` from React/RN) -> `01-auth-and-identity.md`
- Embedded wallet creation flow, `createOnLogin` config, user-owned wallet semantics -> `02-embedded-wallets.md`
- Solana server signing specifics (CAIP-2 ID, base64 transaction format, `signAndSendTransaction`) -> `03-solana-integration.md`
- EVM server signing specifics (CAIP-2, chain ID, tx envelope) -> `04-evm-integration.md`
- Server wallet authorization keys, key quorums, policies (full reference) -> `10-wallet-controls-and-authorization.md`
- Webhooks for transaction confirmation and balance events -> `11-security-and-webhooks.md`
- Migration breaking changes (`@privy-io/server-auth` -> `@privy-io/node` and `migrating-to-2.0.md` / `migrating-to-3.0.md`) -> `12-migrations-and-changelog.md`
- Idempotency, retry semantics, API errors (`APIError`, `PrivyAPIError`, `NotFoundError`) -> `14-errors-and-troubleshooting.md`
- Spectre's auth gaps and route audit -> `spectre/audit-gaps.md`
