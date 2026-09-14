---
description: Privy DeFi and bot recipes - prediction markets (Polymarket), gas-sponsored Tron transfers (Transatron), Twitter/Telegram trading bots, agentic wallets (OpenClaw, Virtuals EconomyOS), and ERC-4626 vault operations (deposit/withdraw/claim/position/details). Use when building autonomous trading flows, server-signed agent wallets, time-bounded delegation, policy-constrained transactions, or Earn/Yield features.
---

# Privy DeFi & Bot Recipes

Synthesis of Privy's official recipe docs for DeFi protocols, automated bots, agentic wallets, and yield vault operations. Each recipe combines Privy embedded or server wallets with an external protocol.

## Source docs synthesized

All paths relative to `C:\Users\worka\OneDrive\Desktop\Privy\`.

- `polymarket-guide.md` (290 lines) - Polymarket Builder codes via Privy + Safe
- `transatron.md` (422 lines) - Tron gas sponsorship via Transatron RPC
- `bankr-bot-guide.md` (499 lines) - Twitter bot on Clanker/Base + Privy + LLM intent
- `telegram-bot.md` (313 lines) - Telegram trading bot, bot-first vs app-first
- `openclaw-agentic-wallets.md` (276 lines) - OpenClaw + Privy server wallets + policies
- `virtuals-economyos.md` (194 lines) - Virtuals EconomyOS agent OS
- `deposit.md`, `withdraw.md`, `claim.md`, `get-vault-position.md`, `get-vault-details.md` - Earn vault endpoints

## Polymarket guide

Builder program lets apps earn fees on routed trades. Privy provides auth + embedded wallet provisioning. Trading runs through a Gnosis Safe deployed via Polymarket's gasless relayer. USDC.e + ERC-1155 outcome tokens settle in the Safe. Env vars: `NEXT_PUBLIC_POLYGON_RPC_URL`, `NEXT_PUBLIC_PRIVY_APP_ID`, `POLYMARKET_BUILDER_API_KEY`, `POLYMARKET_BUILDER_SECRET`, `POLYMARKET_BUILDER_PASSPHRASE`.

### Server HMAC signing route (`app/api/polymarket/sign/route.ts`)

```typescript
import {NextRequest, NextResponse} from 'next/server';
import {BuilderApiKeyCreds, buildHmacSignature} from '@polymarket/builder-signing-sdk';

const BUILDER_CREDENTIALS: BuilderApiKeyCreds = {
  key: process.env.POLYMARKET_BUILDER_API_KEY!,
  secret: process.env.POLYMARKET_BUILDER_SECRET!,
  passphrase: process.env.POLYMARKET_BUILDER_PASSPHRASE!
};

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {method, path, body: requestBody} = body;
  const sigTimestamp = Date.now().toString();
  const signature = buildHmacSignature(
    BUILDER_CREDENTIALS.secret,
    parseInt(sigTimestamp),
    method,
    path,
    requestBody
  );
  return NextResponse.json({
    POLY_BUILDER_SIGNATURE: signature,
    POLY_BUILDER_TIMESTAMP: sigTimestamp,
    POLY_BUILDER_API_KEY: BUILDER_CREDENTIALS.key,
    POLY_BUILDER_PASSPHRASE: BUILDER_CREDENTIALS.passphrase
  });
}
```

Reference impl exposes creds to client - production should proxy CLOB/Relay calls server-side.

### Deploy Safe (gasless via relayer)

```typescript
import {deriveSafe} from '@polymarket/builder-relayer-client/dist/builder/derive';
import {getContractConfig} from '@polymarket/builder-relayer-client/dist/config';
import {POLYGON_CHAIN_ID} from '@/constants/polymarket';

const config = getContractConfig(POLYGON_CHAIN_ID);
const safeAddress = deriveSafe(eoaAddress, config.SafeContracts.SafeFactory);
```

```typescript
import {RelayClient, RelayerTransactionState} from '@polymarket/builder-relayer-client';

async function deploySafe(relayClient: RelayClient): Promise<string> {
  const response = await relayClient.deploy();
  const result = await relayClient.pollUntilState(
    response.transactionID,
    [
      RelayerTransactionState.STATE_MINED,
      RelayerTransactionState.STATE_CONFIRMED,
      RelayerTransactionState.STATE_FAILED
    ],
    '60',
    3000
  );
  return result.proxyAddress;
}
```

Safe address is deterministic from EOA + factory.

### User API credentials (CLOB auth)

```typescript
import {ClobClient} from '@polymarket/clob-client';
import {CLOB_API_URL, POLYGON_CHAIN_ID} from '@/constants/polymarket';

const tempClient = new ClobClient(CLOB_API_URL, POLYGON_CHAIN_ID, ethersSigner);
const creds = await tempClient.createApiKey(); // new user, prompts EIP-712
// returning user: await tempClient.deriveApiKey();
```

### Token approvals (batched, gasless)

USDC.e (ERC-20) approvals for CTF Contract `0x4d97dcd97ec945f40cf65f87097ace5ea0476045`, CTF Exchange `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E`, Neg Risk Exchange `0xC5d563A36AE78145C45a50134d48A1215220f80a`, Neg Risk Adapter `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296`. Same three exchange/adapter addresses also need ERC-1155 outcome token approvals.

```typescript
const approvalStatus = await checkAllApprovals(safeAddress);
if (!approvalStatus.allApproved) {
  const approvalTxs = createAllApprovalTxs();
  const response = await relayClient.execute(approvalTxs, 'Set token approvals');
  await response.wait();
}
```

### Place order

```typescript
const order = {
  tokenID: '0x...', // Outcome token from market
  price: 0.65, // 65 cents
  size: 10, // 10 shares
  side: 'BUY',
  feeRateBps: 0,
  expiration: 0, // Good-til-cancel
  taker: '0x0000000000000000000000000000000000000000'
};
const response = await clobClient.createAndPostOrder(order, {negRisk: false}, OrderType.GTC);
```

Signed by Privy EOA, executed from Safe. Builder attribution automatic.

## Transatron

Tron RPC provider that delegates energy + bandwidth so users transact without holding TRX.

| Mode | When | User holds TRX? |
| ---- | ---- | --------------- |
| Internal account | Default. Broadcast via Transatron RPC with Spender key, auto-deducts prepaid TFN/TFU. | No |
| Instant payment | Wallet holds small TRX/USDT to cover per-tx fee. | Yes (small) |
| Coupon | Per-tx spend cap, backend-issued. | No |
| Bypass | Sender burns TRX. | Yes |

Spender API key must stay server-side.

### Create Tron wallet

```tsx
// React
import {useCreateWallet} from '@privy-io/react-auth/extended-chains';
const {createWallet} = useCreateWallet();
const {wallet} = await createWallet({chainType: 'tron'});
```

```typescript
// Node
import {PrivyClient} from '@privy-io/node';
const privy = new PrivyClient({appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET});
const wallet = await privy.wallets().create({chain_type: 'tron'});
```

### Configure TronWeb against Transatron

```typescript
import {TronWeb, providers} from 'tronweb';

const TRANSATRON_RPC = 'https://api.transatron.io';
const TRANSATRON_TIMEOUT = 60_000;
const headers = {'TRANSATRON-API-KEY': process.env.TRANSATRON_API_KEY!};

const tronWeb = new TronWeb({
  fullNode: new providers.HttpProvider(TRANSATRON_RPC, TRANSATRON_TIMEOUT, '', '', headers),
  solidityNode: new providers.HttpProvider(TRANSATRON_RPC, TRANSATRON_TIMEOUT, '', '', headers),
  eventServer: new providers.HttpProvider(TRANSATRON_RPC, TRANSATRON_TIMEOUT, '', '', headers)
});
```

### Sign txID + attach Tron recovery byte

Privy `raw_sign` returns 64-byte ECDSA. Tron needs 65 - trailing byte is `0x1b` or `0x1c`. Probe both.

React signing:

```tsx
import {useSignRawHash} from '@privy-io/react-auth/extended-chains';

function useSignTronTxId() {
  const {signRawHash} = useSignRawHash();
  return async ({address, txId}: {address: string; txId: string}) => {
    const txIdHex = txId.startsWith('0x') ? txId : `0x${txId}`;
    const {signature} = await signRawHash({
      address,
      chainType: 'tron',
      hash: txIdHex as `0x${string}`
    });
    return signature;
  };
}
```

Server attach helper:

```typescript
import type {TronWeb, Types} from 'tronweb';

function attachTronSignature({
  tronWeb, walletAddress, transaction, signature
}: {
  tronWeb: TronWeb;
  walletAddress: string;
  transaction: Types.SignedTransaction;
  signature: string;
}): Types.SignedTransaction {
  const baseSig = signature.replace(/^0x/, '');
  transaction.signature = [`${baseSig}1b`];
  if (tronWeb.trx.ecRecover(transaction) !== walletAddress) {
    transaction.signature = [`${baseSig}1c`];
  }
  return transaction;
}
```

Server-only signing:

```typescript
async function signTronTransaction({
  tronWeb, walletId, walletAddress, transaction
}: {
  tronWeb: TronWeb;
  walletId: string;
  walletAddress: string;
  transaction: Types.SignedTransaction;
}): Promise<Types.SignedTransaction> {
  const txIdHex = transaction.txID.startsWith('0x') ? transaction.txID : `0x${transaction.txID}`;
  const {signature} = await privy.wallets().rawSign(walletId, {
    params: {hash: txIdHex}
  });
  const baseSig = (signature as string).replace(/^0x/, '');
  transaction.signature = [`${baseSig}1b`];
  if (tronWeb.trx.ecRecover(transaction) !== walletAddress) {
    transaction.signature = [`${baseSig}1c`];
  }
  return transaction;
}
```

### Estimate fee limit + broadcast

```typescript
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

async function estimateFeeLimit({ownerAddress, recipientAddress, amountBaseUnits}) {
  const ownerHex = tronWeb.address.toHex(ownerAddress);
  const contractHex = tronWeb.address.toHex(USDT_CONTRACT);
  const constant = await tronWeb.transactionBuilder.triggerConstantContract(
    contractHex,
    'transfer(address,uint256)',
    {},
    [{type: 'address', value: recipientAddress}, {type: 'uint256', value: amountBaseUnits}],
    ownerHex
  );
  const params = await tronWeb.trx.getChainParameters();
  const energyFee = params.find((p) => p.key === 'getEnergyFee')?.value ?? 420;
  const energyUsed = constant.energy_used ?? 0;
  return Math.ceil(energyUsed * energyFee * 1.1);
}

async function sendSponsoredTransfer({walletId, walletAddress, recipientAddress, amountBaseUnits, feeLimit}) {
  const ownerHex = tronWeb.address.toHex(walletAddress);
  const contractHex = tronWeb.address.toHex(USDT_CONTRACT);
  const built = await tronWeb.transactionBuilder.triggerSmartContract(
    contractHex,
    'transfer(address,uint256)',
    {feeLimit, callValue: 0},
    [{type: 'address', value: recipientAddress}, {type: 'uint256', value: amountBaseUnits}],
    ownerHex
  );
  if (!built.transaction) throw new Error('Failed to build transfer transaction');
  const signed = await signTronTransaction({tronWeb, walletId, walletAddress, transaction: built.transaction});
  return tronWeb.fullNode.request('wallet/broadcasttransaction', signed, 'post');
}
```

## Bankr bot guide

Twitter bot on Clanker (Base token deploy). LLM parses tweets, Privy server wallets manage EVM accounts, Clanker API deploys tokens.

### Twitter polling

```typescript
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY!,
  appSecret: process.env.TWITTER_API_SECRET!,
  accessToken: process.env.TWITTER_ACCESS_TOKEN!,
  accessSecret: process.env.TWITTER_ACCESS_SECRET!,
});
const rwClient = client.readWrite;

async function pollMentions() {
  let sinceId: string | undefined = undefined;
  while (true) {
    const mentions = await rwClient.v2.userMentionTimeline('YOUR_BOT_USER_ID', {
      since_id: sinceId,
      expansions: ['author_id', 'entities.mentions.username'],
      'user.fields': ['username', 'name'],
      max_results: 5,
    });
    for (const tweet of mentions.data?.data || []) {
      const parsed = processTweet(tweet, mentions);
      sinceId = tweet.id;
    }
    await new Promise(res => setTimeout(res, 10000));
  }
}
```

### Get or create wallet per Twitter user

```ts
async function createUserWallet(userId) {
  const wallet = await privy.wallets().create({chain_type: 'ethereum'});
  await db.wallets.set(userId, wallet.id);
  return wallet;
}

async function getUserWallet(userId) {
  const walletId = await db.wallets.get(userId);
  if (walletId) return await privy.wallets().get(walletId);
  return null;
}

async function getOrCreateUserWallet(userId) {
  const existing = await getUserWallet(userId);
  if (existing) return existing;
  return createUserWallet(userId);
}
```

### Deploy token via Clanker

```typescript
import axios from 'axios';
import crypto from 'crypto';

const apiKey = process.env.CLANKER_API_KEY;
const requestKey = crypto.randomBytes(16).toString('hex');
const payload = {
  name,
  symbol,
  image: 'https://example.com/token.png',
  requestorAddress: wallet.address,
  requestKey,
};
const response = await axios.post('https://www.clanker.world/api/tokens/deploy', payload, {
  headers: {'x-api-key': apiKey, 'Content-Type': 'application/json'}
});
```

### Send ETH to Twitter user

```ts
import { parseEther } from 'viem';

const amountWei = parseEther(llmResponse.params.amount);
const transaction = {
  to: recipientWallet.address,
  value: amountWei,
  chainId: 8453,
};
const sendResult = await privy.wallets().ethereum().sendTransaction(senderWallet.id, {
  caip2: 'eip155:8453',
  params: {transaction}
});
```

## Telegram bot

Two paths: **bot-first** (wallet created via Telegram command, claimable later via web app) or **app-first** (wallet in app, bot added as signer).

### Bot setup + resolve wallet from Telegram user ID

```ts
const TelegramBot = require('node-telegram-bot-api');
const {PrivyClient} = require('@privy-io/node');

const bot = new TelegramBot('YOUR_TELEGRAM_BOT_TOKEN', { polling: true });
const privy = new PrivyClient({appId: 'insert-app-id', appSecret: 'insert-app-secret'});

bot.onText(/\/log_wallet_id/, async (msg) => {
  const user = await privy.users().getByTelegramUserID({telegram_user_id: msg.from.id});
  const wallet = user.linked_accounts.find((a) => a.type === 'wallet' && 'id' in a);
  console.log('Wallet ID', wallet?.id);
});
```

### Bot-first: create wallet with bot as additional signer

```ts
bot.onText(/\/start/, async (msg) => {
  const telegramUserId = msg.from.id;
  const privyUser = await privy.users().create({
    linked_accounts: [{type: 'telegram', telegram_user_id: telegramUserId}]
  });
  const wallet = await privy.wallets().create({
    chain_type: 'ethereum',
    owner: { user_id: privyUser.id },
    additional_signers: [{ signer_id: 'insert-signer-id', override_policy_ids: [] }],
  });
});
```

### Transact command

Bot-first and app-first differ only in how the wallet lookup is performed (filter on `'wallet' in account` vs `isEmbeddedWalletLinkedAccount`).

```ts
import {isEmbeddedWalletLinkedAccount} from '@privy-io/node';

bot.onText(/\/transact/, async (msg) => {
    const transaction = getTransactionDetailsFromMsg(msg);
    const user = await privy.users().getByTelegramUserID({telegram_user_id: msg.from.id});
    const wallet = user.linked_accounts.find(isEmbeddedWalletLinkedAccount);
    const walletId = wallet?.id;
    if (!walletId) throw new Error('Cannot determine wallet ID for user');
    await privy.wallets().ethereum().sendTransaction(walletId, {
      caip2: 'eip155:1',
      params: {transaction}
    });
});
```

Configure Privy client with signer's authorization private key. Telegram login enabled separately in dashboard.

## OpenClaw agentic wallets

**Experimental, community-maintained.** Third-party agent framework, not officially supported by Privy.

### Install + configure

```bash
clawhub install privy
# or
git clone https://github.com/privy-io/privy-agentic-wallets-skill.git ~/.openclaw/workspace/skills/privy
```

`~/.openclaw/openclaw.json`:

```json
{
  "env": {
    "vars": {
      "PRIVY_APP_ID": "your-app-id",
      "PRIVY_APP_SECRET": "your-app-secret"
    }
  }
}
```

```bash
openclaw gateway restart
```

### Natural-language wallet ops

Agent calls Privy API via loaded skill in response to prompts like "Create an Ethereum wallet for yourself", "Create a policy that limits transactions to 0.1 ETH max, only on Base mainnet", "Attach the spending limit policy to my wallet", "Send 0.01 ETH to 0x1234... on Base".

### Spending limit policy

```json
{
  "name": "Max 0.1 ETH per tx",
  "method": "eth_sendTransaction",
  "conditions": [
    {
      "field_source": "ethereum_transaction",
      "field": "value",
      "operator": "lte",
      "value": "100000000000000000"
    }
  ],
  "action": "ALLOW"
}
```

### Chain restriction

```json
{
  "name": "Base mainnet only",
  "method": "eth_sendTransaction",
  "conditions": [
    {"field_source": "ethereum_transaction", "field": "chain_id", "operator": "eq", "value": "8453"}
  ],
  "action": "ALLOW"
}
```

### Contract allowlist

```json
{
  "name": "Only Uniswap Router",
  "method": "eth_sendTransaction",
  "conditions": [
    {
      "field_source": "ethereum_transaction",
      "field": "to",
      "operator": "in",
      "value": ["0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD"]
    }
  ],
  "action": "ALLOW"
}
```

Supported chains: ethereum (`eip155:1`), base (`eip155:8453`), polygon (`eip155:137`), arbitrum (`eip155:42161`), optimism (`eip155:10`), solana (`solana:mainnet`). Also Cosmos, Stellar, Sui, Aptos, Tron, Bitcoin SegWit, NEAR, TON, Starknet via Privy.

Compromise recovery: rotate Privy App Secret, rotate authorization keys, audit transactions, move funds.

## Virtuals EconomyOS

Agent OS providing identity (wallet + email + domain), capital (tokenize, deploy), commerce (cards, ACP jobs, reputation), compute (inference, memory, runtime). Anchored to Privy server wallet.

Wallet properties: non-custodial (creator holds auth key, Virtuals cannot move funds), wallet address is agent's on-chain identity, P256 signer generated locally and stored in OS keychain (macOS Keychain / Linux Secret Service / Windows Credential Manager), per-machine signer.

### ACP CLI install + agent

```bash
npm install -g acp-cli
acp configure
acp agent create --name "MyAgent" --description "What this agent does"
acp agent add-signer
```

### Verify + fund

```bash
acp agent whoami
acp wallet address --json
acp wallet balance --chain-id 8453
acp wallet topup --chain-id 8453
```

Top-up methods: `--method coinbase`, `--method card --amount 25 --email you@example.com`, `--method qr`.

### Provision identity

```bash
acp email provision --display-name "My Agent" --local-part "my.agent"
acp card signup --email "agent@example.com"
acp agent tokenize
```

Tokenize flags: `--anti-sniper`, `--prebuy`, `--acf`, `--60-days`, `--airdrop-percent`, `--robotics`.

### Sell via ACP

```bash
acp offering create \
  --name "Logo Design" \
  --description "Minimalist logo design in PNG" \
  --price-type fixed \
  --price-value 5.00 \
  --sla-minutes 60 \
  --requirements '{"type":"object","properties":{"style":{"type":"string"}},"required":["style"]}'

acp events listen
acp provider set-budget --job-id <id> --amount 5.00
acp provider submit --job-id <id> --deliverable '{"url":"https://..."}'
```

### Buy via ACP

```bash
acp browse "logo design"
acp client create-job-from-offering --offering-id <id> --requirement '{"style":"minimalist"}'
acp client fund --job-id <id>
acp client complete --job-id <id>
# or
acp client reject --job-id <id> --reason "Off-brief"
```

### ACP error map

| Error | Cause | Fix |
| ----- | ----- | --- |
| `signer not attached` | No signer on machine | `acp agent add-signer` |
| `insufficient funds` | No gas or USDC | Top up |
| `session expired` | OAuth expired | `acp configure` |
| `signature rejected` | Spend guardrail blocked | Adjust in Virtuals Console |

## Vault operations

Privy Earn API wraps ERC-4626 vaults (Morpho today). Endpoints: `deposit`, `withdraw`, `incentive/claim`, `get-vault-position`, `get-vault-details`. All honor configured app-level gas sponsorship by default.

### Deposit

```typescript
const response = await privy.wallets().earn().ethereum().deposit('insert-wallet-id', {
  vault_id: '<your-vault-id>',
  amount: '1.5',
  authorization_context: {
    authorization_private_keys: ['<authorization-private-key>'],
  },
});
```

```bash
curl -X POST https://auth.privy.io/api/v1/wallets/{wallet_id}/earn/ethereum/deposit \
  -H "privy-app-id: <your-app-id>" \
  -H "Authorization: Basic <credentials>" \
  -H "Content-Type: application/json" \
  -d '{"vault_id": "<your-vault-id>", "amount": "1.5"}'
```

Flow: Privy approves vault for ERC-20 amount, vault converts assets to shares at current share price, shares split between depositing wallet and app admin wallet per configured fee percentage. Pass exactly one of `amount` (human decimal) or `raw_amount` (smallest unit). Wallets with `owner_id` need authorization signature header. Insufficient balance returns `rejected`. `share_amount` is `null` until `succeeded`.

Example response:

```json
{
  "id": "<action-id>",
  "wallet_id": "<your-wallet-id>",
  "type": "earn_deposit",
  "status": "pending",
  "caip2": "eip155:8453",
  "vault_id": "<your-vault-id>",
  "vault_address": "0x5224d0c05698eD4a97C771B62095929F293f1D60",
  "asset_address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "raw_amount": "1500000",
  "amount": "1.5",
  "asset": "usdc",
  "decimals": 6,
  "share_amount": null,
  "created_at": "2025-04-01T12:00:00.000Z"
}
```

Track via polling `get wallet action` or `wallet_action.earn_deposit.succeeded` webhook.

### Withdraw

```typescript
const response = await privy.wallets().earn().ethereum().withdraw('insert-wallet-id', {
  vault_id: '<your-vault-id>',
  amount: '1.05',
  authorization_context: {
    authorization_private_keys: ['<authorization-private-key>'],
  },
});
```

```bash
curl -X POST https://auth.privy.io/api/v1/wallets/{wallet_id}/earn/ethereum/withdraw \
  -H "privy-app-id: <your-app-id>" \
  -H "Authorization: Basic <credentials>" \
  -H "Content-Type: application/json" \
  -d '{"vault_id": "<your-vault-id>", "amount": "1.05"}'
```

Withdraw any amount up to `assets_in_vault`. For full withdrawal, read `assets_in_vault` from position endpoint and pass as `raw_amount` - residual yield accrued in between stays in vault. Check `available_liquidity_usd` for large withdrawals.

### Claim incentive rewards

```typescript
const response = await privy.wallets().earn().ethereum().incentive().claim('insert-wallet-id', {
  chain: 'base',
  authorization_context: {
    authorization_private_keys: ['<authorization-private-key>'],
  },
});
```

```bash
curl -X POST https://auth.privy.io/api/v1/wallets/{wallet_id}/earn/ethereum/incentive/claim \
  -H "privy-app-id: <your-app-id>" \
  -H "Authorization: Basic <credentials>" \
  -H "Content-Type: application/json" \
  -d '{"chain": "base"}'
```

Chain-level (not per-vault). Multi-vault on same chain gets single combined claim. Does not affect withdrawals or earnings.

Example response:

```json
{
  "id": "<action-id>",
  "wallet_id": "<your-wallet-id>",
  "type": "earn_incentive_claim",
  "status": "pending",
  "chain": "base",
  "rewards": [
    {
      "token_address": "0x1234567890abcdef1234567890abcdef12345678",
      "token_symbol": "MORPHO",
      "token_decimals": 18,
      "amount": "115631364898103632676"
    }
  ],
  "created_at": "2025-04-01T12:00:00.000Z"
}
```

### Get vault position

```bash
curl https://auth.privy.io/api/v1/wallets/{wallet_id}/earn/ethereum/vaults?vault_id={vault_id} \
  -H "privy-app-id: <your-app-id>" \
  -H "Authorization: Basic <credentials>"
```

```json
{
  "asset": {"address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "symbol": "usdc", "decimals": 6},
  "total_deposited": "1000000",
  "total_withdrawn": "0",
  "assets_in_vault": "1050000",
  "shares_in_vault": "1000000000000000000"
}
```

Earned yield: `assets_in_vault - (total_deposited - total_withdrawn)`. All amounts in smallest unit - USDC (6 decimals) divide by 10^6.

### Get vault details

```bash
curl https://auth.privy.io/api/v1/earn/ethereum/vaults/{vault_id} \
  -H "privy-app-id: <your-app-id>" \
  -H "Authorization: Basic <credentials>"
```

```json
{
  "id": "<your-vault-id>",
  "name": "Gauntlet USDC Prime",
  "provider": "morpho",
  "vault_address": "0x04422053aDDbc9bB2759b248B574e3FCA76Bc145",
  "asset": {"address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "symbol": "usdc", "decimals": 6},
  "caip2": "eip155:1",
  "user_apy": 500,
  "app_apy": 100,
  "tvl_usd": 1000000,
  "available_liquidity_usd": 500000
}
```

APYs in basis points (500 = 5%). Always check `available_liquidity_usd` before large withdrawals.

## Common patterns extracted

**A. Server-signed agent wallets.** User owns wallet via Privy user ID, server process holds an additional signer key that signs without prompting. Used in Telegram bot-first/app-first, Bankr, Virtuals (P256 in OS keychain), OpenClaw (signer in agent config). Authorization key stored securely server-side, rotate if compromised.

```ts
const wallet = await privy.wallets().create({
  chain_type: 'ethereum',
  owner: { user_id: privyUser.id },
  additional_signers: [{ signer_id: 'insert-signer-id', override_policy_ids: [] }],
});
```

**B. Time-bounded delegation.** Embedded wallets configured with delegated actions valid only within a window. Server acts during the window, user re-grants after expiry. Polymarket: user signs EIP-712 once for CLOB credentials + batched approvals, then Safe + relayer handles every order until revoke or logout.

**C. Auto-funding hot wallet.** Hot wallet pays for transactions on user's behalf. Variants: sponsored RPC (Transatron internal account), relayer (Polymarket), Privy gas sponsorship (earn endpoints honor it automatically), ACP CLI top-up. Spend must be bounded by policy.

**D. Policy-constrained transactions.** Privy evaluates signed transaction against attached policies before broadcast. Used in OpenClaw + Virtuals. Composable - attach multiple, all must ALLOW. Design conservatively, loosen over time.

## Spectre-specific notes

Spectre does not run a Telegram, Twitter, or autonomous trading bot in production today. Patterns above are reference material for future surfaces.

- **Monarch AI chat** (`apps/research/src/pages/monarch-chat`) could shift from "render swap UI for user confirm" to "execute swap via server-side signer + time-bounded delegation + policy guardrails." Today it's client-side Privy signing via `useSwapExecution.js`. Would need: server-side signer ID per user wallet, per-wallet ALLOWLIST policy for swap router contracts, ALLOW policy with per-tx USD cap from user prefs.
- **Earn / Yield features** - not built. Vault endpoints map directly to a Spectre Earn surface that could front Gauntlet USDC Prime or similar Morpho vaults from the user dashboard. Fee-share split is the business angle.
- **Telegram trading bot** - Spectre is wallet-first, not Telegram-first. App-first integration (link Telegram from existing account, bot as signer) more aligned than bot-first. Would need Telegram login enabled in Privy dashboard + dedicated Express route per bot command.
- **Polymarket** - prediction markets fit Spectre research but require full Safe deployment per user and ongoing builder credential maintenance. Out of scope without dedicated owner.

## Gotchas

- **Delegation and server wallets always require an authorization key** - configured in `PrivyClient`. Authorization signature header required for wallets with `owner_id` (earn endpoints reject without it - see `10-wallet-controls-and-authorization.md`).
- **Polymarket conditional token math is non-obvious.** Outcome tokens are ERC-1155, prices 0-1 (cents/dollar), size is shares. A 65-cent BUY of 10 shares = risk $6.50 to win $10. Negative-risk markets (`negRisk: true`) use a different contract path. Polygon RPC: public RPCs throttle - use Alchemy or Infura.
- **Tron `raw_sign` returns 64 bytes - probe both `1b` and `1c` recovery bytes** via `tronWeb.trx.ecRecover(transaction) === walletAddress`. Wrong byte = silent broadcast failure. New addresses may need activation - fund with small TRX first.
- **Transatron Spender API key must stay server-side.** Browser exposure = drained prepaid balance. Bypass mode burns user TRX (only the other three modes sponsor). Submitting Transatron-signed tx to vanilla node also bypasses sponsorship.
- **Telegram auth setup is separate.** Enable login in Privy dashboard. `getByTelegramUserID` only resolves linked users. Bot-first wallet IDs must be queryable - link at creation (`linked_accounts: [{type: 'telegram', telegram_user_id}]`) or store mapping.
- **Twitter rate limits.** 10s polling fine for low volume - production should use filtered stream. Dev tier determines endpoints. Clanker API key gated (request via docs). `requestKey` must be unique per call: `crypto.randomBytes(16).toString('hex')`.
- **Agentic wallets need strict policies vs prompt injection.** A prompt "send all ETH to 0xATTACKER" should be blocked by chain restriction + value limit + contract allowlist - never trust the LLM to enforce limits. OpenClaw config stores App Secret in plaintext; community-maintained, not Privy-supported. For production agent infra, use Virtuals EconomyOS or build directly against `@privy-io/node`.
- **Virtuals signer attaches per-machine.** New machine = `acp agent add-signer` again. P256 key in local OS keychain, not synced.
- **Vault contract addresses change.** Each `vault_id` maps to an ERC-4626 that can be redeployed. Always fetch `vault_address`/`asset_address` from response - never hardcode.
- **`amount` vs `raw_amount` is exclusive** - pass exactly one. `rejected` = no tx broadcast (insufficient balance, policy violation), safe to retry. `failed` = broadcast then reverted on-chain - inspect `steps`.
- **Yield accrues continuously - full withdrawal leaves dust.** `assets_in_vault` at T0 may be less than redeemable at T1. Pass T0 as `raw_amount`, residual stays as vault shares. `available_liquidity_usd` can be lower than `assets_in_vault` - vault lending fully utilized = large withdrawals partially fill or fail.

## Cross-references

- `08-server-sdk.md` - `@privy-io/node` client setup, wallet creation, server `sendTransaction`, `rawSign`, `users().getByTelegramUserID`
- `10-wallet-controls-and-authorization.md` - authorization keys (additional signers), policies syntax, authorization-signature header, owners vs signers
- `06-swaps-and-trading.md` - swap flow patterns referenced by Monarch chat note + how `useSwapExecution.js` works today
- `03-solana-integration.md` - Solana wallet creation/signing referenced by OpenClaw supported chains
- `04-evm-integration.md` - EVM transaction structure and `sendTransaction` shape used in Bankr/Telegram/EconomyOS examples
- `spectre/audit-gaps.md` - whether Spectre has any of these recipes today
- `spectre/patterns.md` - approved patterns for swap execution, ready for extension into vault deposit/withdraw
