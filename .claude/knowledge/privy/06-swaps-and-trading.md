---
description: Privy swaps & trading reference (built-in Swap, 0x v2, Bebop, Jupiter, limit orders, bridging, multi-chain balance). Synthesized from official docs.
---

# Privy Swaps & Trading

## Source docs synthesized

- `Swap.md` - top-level Privy built-in Swap overview (Uniswap-routed, EVM only today)
- `get-quote.md` - swap quote endpoint reference
- `execute.md` - swap execute endpoint reference
- `swap-with-0x.md` - 0x v2 Permit2 integration guide
- `bebop-swap-guide.md` - Bebop RFQ aggregator integration
- `limit-orders.md` - off-line limit orders via signers
- `mpp.md` - Machine Payments Protocol (HTTP 402 server-to-server payments)
- `one-balance.md` - OneBalance multi-chain unified wallet abstraction
- `x402.md` - x402 HTTP micropayment protocol for embedded wallets
- `trading-apps-homepage.md` - trading app recipe index
- `bridge-cards.md` - Bridge debit-card stablecoin spending (non-custodial)
- `Bridging.md` - cross-chain transfer API (Relay-powered)

## Core concepts

Privy itself is a wallet layer, not an aggregator. Most swap volume on Privy apps runs through one of three patterns:

1. **Privy built-in Swap** (`useSwap()` / `POST /v1/wallets/{walletId}/swap`) - new, EVM-only, Uniswap-routed, Privy takes up to 0.25%. Privy automates approvals and submits the tx. Solana coming.
2. **Bring-your-own aggregator** (0x, Bebop, Jupiter, 1inch) - app fetches a quote from the aggregator, then signs / sends via the Privy embedded wallet. Privy is purely the signing surface; the aggregator owns routing and pricing. This is what Spectre does today.
3. **Custom on-chain swap** - app builds a raw calldata payload (e.g. direct `swapExactTokensForTokens` on a Uniswap V2 router) and sends it via Privy. Maximum flexibility, minimum convenience.

### Aggregator comparison

| Aggregator | Type | Coverage | Slippage model | Approval | Notes |
| --- | --- | --- | --- | --- | --- |
| Privy built-in (Uniswap routing) | DEX router | 9 EVM mainnets (ETH, OP, BSC, Unichain, Polygon, Monad, World Chain, Base, Arbitrum) + 4 testnets | `slippage_bps` or auto | Privy handles approve | Privy fee up to 0.25% baked in. Gas sponsorship REQUIRED. |
| 0x v2 | DEX aggregator | All major EVM chains | `slippageBps` query param or `slippagePercentage` | Permit2 (one-time approve, then sign per swap) | Best deep-liquidity routing across many DEXs. Quote returns `transaction.to`, `transaction.data`, `transaction.gas`, `permit2.eip712`. Affiliate fees via `swapFeeRecipient`, `swapFeeBps`, `swapFeeToken`. |
| Bebop | RFQ market makers | EVM (Base, Ethereum, Arbitrum, BSC, Optimism, Polygon) | Zero slippage (RFQ) | Standard ERC-20 OR Permit2 | Quote = signed price from a market maker. Best for large size and stablecoin pairs. Quotes short-lived (~10s). Requires Bebop-issued Source ID + Auth Key. |
| Jupiter v6 | Solana aggregator | Solana only | `slippageBps` query param | N/A (Solana) | Returns `swapTransaction` (base64 versioned tx). Deserialize, sign, send via `signAndSendTransaction` on the Privy Solana provider. |
| 1inch | DEX aggregator | EVM | `slippage` | Standard ERC-20 approve | Older API, similar flow to 0x v1 but no Permit2 by default. |

### EVM vs Solana swap mechanics

EVM:

1. Optional ERC-20 approve (or Permit2 sign for 0x v2 / Bebop)
2. Aggregator returns `{ to, data, value, gas }`
3. Wallet signs and broadcasts a single `eth_sendTransaction`
4. Wait for receipt where `status === 1`

Solana:

1. No approval - SPL tokens use ATAs (auto-created if missing)
2. Aggregator returns a pre-built versioned transaction (base64)
3. Wallet deserializes, signs, sends in one shot
4. Wait for confirmation status `confirmed` or `finalized`

### Quote -> sign -> execute flow

The universal pattern:

```
1. fetch quote        (off-chain HTTP to aggregator)
2. validate freshness (check expiry, re-fetch if stale)
3. handle approval    (skip if pre-approved or Solana)
4. sign + send tx     (via Privy provider)
5. poll receipt       (until confirmed or timeout)
```

### Slippage, price impact, fees

- **Slippage** is the gap between quoted and executed price, expressed in basis points (50 = 0.5%). Too tight = quote fails. Too loose = MEV sandwich risk.
- **Price impact** is the share of the pool consumed by the trade. Aggregators typically expose it as `priceImpactBps` or similar. Not the same as slippage.
- **Protocol fee** is taken by the DEX or RFQ market maker (Uniswap V3: 0.01-1% pool fee tier).
- **Platform fee** is taken by your app (configurable on 0x v2 and Bebop, baked-in on Privy built-in).
- **Gas** is paid by the wallet (or sponsored via Privy gas sponsorship).

### Limit orders (off-chain order books vs on-chain)

- **Off-chain**: Jupiter Limit, 0x Limit Order, CoW Protocol. User signs an EIP-712 order. A solver matches and fills it later. No tx on chain until fill.
- **On-chain**: limit orders that live in a smart-contract escrow (e.g. some DEX limit-order pools). Costs gas to place AND cancel.
- **Privy's recipe**: server-side signer with policies. The user adds the app's signer to their wallet, the app stores the signer's private key, and when the price hits the target the server signs the tx. See `limit-orders.md` and the broader signers + policies docs.

### Bridging (cross-chain)

Privy's first-party cross-chain primitive is the **transfer API** (`Bridging.md`), powered by [Relay](https://relay.link). It does NOT do cross-asset bridging (e.g. ETH on Base -> USDC on Ethereum). It only bridges:

- Same native token, different chain (ETH on Base -> ETH on Ethereum)
- Same-peg stablecoins (USDC -> USDT, USDC -> USDG)

For arbitrary cross-chain swaps, use LiFi, Across, Stargate, Squid, or Wormhole directly (sign / send via Privy).

### One Balance (unified multi-chain wallet view)

[OneBalance](https://docs.onebalance.io/) creates a "Credible Account" per user that aggregates EVM balances across chains. Your app calls OneBalance to get a quote + signs with the Privy embedded wallet. Users feel like they have one balance across chains, no manual bridging.

## Built-in Privy Swap

EVM only today (Solana / Bitcoin "coming soon"). Routes through Uniswap. Privy automates approvals.

### Supported chains

Mainnet:

| Chain | Chain ID | CAIP-2 | Native |
| --- | --- | --- | --- |
| Ethereum | 1 | `eip155:1` | ETH |
| Optimism | 10 | `eip155:10` | ETH |
| BNB Smart Chain | 56 | `eip155:56` | BNB |
| Unichain | 130 | `eip155:130` | ETH |
| Polygon | 137 | `eip155:137` | POL |
| Monad | 143 | `eip155:143` | MON |
| World Chain | 480 | `eip155:480` | ETH |
| Base | 8453 | `eip155:8453` | ETH |
| Arbitrum | 42161 | `eip155:42161` | ETH |

Testnets: Unichain Sepolia (1301), Monad Testnet (10143), Sepolia (11155111), Base Sepolia (84532).

### Token addresses

- ERC-20 contract address for tokens
- `"native"` (string literal) for chain native (ETH, POL, BNB, ...)
- `input_token` and `output_token` MUST differ
- Token addresses are chain-specific (USDC on Base != USDC on Ethereum)

### Fees

| Fee | Description |
| --- | --- |
| Privy swap fee | Up to 0.25% on input token amount. Baked into the swap rate. |
| Uniswap protocol fee | ~0.3% V2, 0.01-1% V3/V4 depending on pool fee tier. Baked in. |
| Network fee (gas) | Sponsored from your app's gas credits. Gas sponsorship is REQUIRED for swaps. Covers approval tx too. |

The `est_output_amount` returned from `/swap/quote` is AFTER fees. `gas_estimate` is reported separately in base units of the native token.

### Slippage

`slippage_bps` (number, in basis points, e.g. 50 = 0.5%). Omit to use auto-slippage based on token pair + current market. The quote response includes `minimum_output_amount` - your app can verify this against the user's expectation before calling execute.

### Quote endpoint (REST)

`POST https://api.privy.io/v1/wallets/{wallet_id}/swap/quote`

Body:

```json
{
  "caip2": "eip155:8453",
  "input_token": "native",
  "output_token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "amount": "1000000000000000000",
  "amount_type": "exact_input"
}
```

Response:

```json
{
  "caip2": "eip155:8453",
  "input_token": "native",
  "output_token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "input_amount": "1000000000000000000",
  "est_output_amount": "2000000000",
  "minimum_output_amount": "1980000000",
  "gas_estimate": "150000"
}
```

cURL:

```bash
curl -X POST https://api.privy.io/v1/wallets/{wallet_id}/swap/quote \
  -u "<your-app-id>:<your-app-secret>" \
  -H "privy-app-id: <your-app-id>" \
  -H "Content-Type: application/json" \
  -d '{
    "caip2": "eip155:8453",
    "input_token": "native",
    "output_token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "1000000000000000000",
    "amount_type": "exact_input"
  }'
```

### Execute endpoint (REST)

`POST https://api.privy.io/v1/wallets/{wallet_id}/swap`

Body parameters:

- `caip2` (required) - chain id
- `input_token` (required) - ERC-20 address or `"native"`
- `output_token` (required) - different from input
- `amount` (required) - base units (wei for ETH)
- `amount_type` - `exact_input` (default) or `exact_output`
- `slippage_bps` - omit for auto
- `recipient` - defaults to wallet address

Wallets with owners/signers must include `privy-authorization-signature` header.

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

Response (wallet action):

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

Status progresses `pending` -> `succeeded` | `rejected` | `failed`. Poll the wallet-action endpoint or listen for the `wallet_action.swap.succeeded` webhook.

## 0x v2 integration

This is the canonical "bring-your-own-aggregator" recipe. 0x v2 introduced Permit2 - users approve Permit2 ONCE per token, then per-swap they sign an off-chain Permit2 signature instead of an on-chain approve. Saves a tx per swap after the initial setup.

### Step 1 - Register and get API keys

Sign up at the 0x dashboard. Store `API_KEY_0X` in `.env`.

### Step 2 - Approve Permit2 (one-time per token per wallet)

```tsx
import {maxUint256, erc20Abi, encodeFunctionData, createPublicClient, http} from 'viem';

const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

// USDC contract on Base
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Provider is an instance of an EIP-1193 provider exposed from a Privy SDK
const provider = await wallet.getProvider();

// get Privy wallet

// prepre transaction to give USDC approval
const data = encodeFunctionData({
  abi: erc20Abi,
  functionName: 'approve',
  args: [PERMIT2_ADDRESS, maxUint256]
});

// execute transaction
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

### Step 3 - Get a quote

```tsx
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// Base network chain ID
const CHAIN_ID = 8453;
const USDC_DECIMALS = 6;

const amountInUSD = 100;
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

The quote shape includes:

- `transaction.to` - 0x settlement contract
- `transaction.data` - calldata
- `transaction.value` - hex wei (for native sells)
- `transaction.gas` - estimated gas
- `permit2.eip712` - typed-data payload to sign
- `buyAmount`, `sellAmount`, `minBuyAmount`
- `allowanceTarget` - the address that needs approval (Permit2 in v2)
- `price` - rate after fees

### Step 4 - Sign permit + send tx

```tsx
import {numberToHex, concat} from 'viem';

// Provider is an instance of an EIP-1193 provider exposed from a Privy SDK
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
const params = {
  from: wallet.address,
  to: quoteResult.transaction.to,
  data: transactionData,
  gas: !!quoteResult.transaction.gas ? BigInt(quoteResult.transaction.gas) : undefined
};

// send the signed permit to be on-chain
const tx = await provider.request({
  method: 'eth_sendTransaction',
  params: [params]
});
```

The signature is APPENDED to the calldata - `data + signatureLength + signature`. This is the v2 pattern. Do not try to send the signature in a separate field.

### Affiliate / partner fee parameters (0x v2)

Query params to add to `/swap/permit2/quote`:

- `swapFeeRecipient` - address that receives the fee
- `swapFeeBps` - fee in basis points (e.g. `100` = 1%)
- `swapFeeToken` - which token the fee is collected in (must be `sellToken` or `buyToken`)

0x v1 used a different schema (`affiliateAddress`, `feeRecipient`, `buyTokenPercentageFee`). Do not mix v1 and v2 params.

## Bebop integration

Bebop is an RFQ aggregator (market makers stream firm quotes). Quotes have zero slippage by design. Best for large stablecoin trades. Requires partner credentials.

### Prerequisites

Contact Bebop for:

- `BEBOP_AUTH_KEY` - rate-limited API access
- `BEBOP_SOURCE_ID` - integration partner ID for revenue tracking

### Approval (Standard ERC-20)

Bebop settlement contract: `0xbbbbbBB520d69a9775E85b458C58c648259FAD5F`. Approve once per token per wallet:

```tsx
import {maxUint256, erc20Abi, encodeFunctionData} from 'viem';
import {useWallets} from '@privy-io/react-auth';

const BEBOP_SETTLEMENT_ADDRESS = '0xbbbbbBB520d69a9775E85b458C58c648259FAD5F';
const WETH_ADDRESS = '0x4200000000000000000000000000000000000006'; // WETH on Base

async function approveToken() {
  const {wallets} = useWallets();
  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === 'privy');

  // Get EIP-1193 provider from Privy embedded wallet
  const provider = await embeddedWallet.getEthereumProvider();

  // Encode approval transaction data
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [BEBOP_SETTLEMENT_ADDRESS, maxUint256]
  });

  // Submit approval transaction
  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from: embeddedWallet.address,
        to: WETH_ADDRESS,
        data,
        value: '0x0'
      }
    ]
  });

  return txHash;
}
```

Bebop also supports Permit2 - pass `approval_type=Permit2` in the quote request (see Bebop docs for the per-swap signature flow).

### Quote

```typescript
import axios from 'axios';
import {parseEther} from 'viem';

const BEBOP_SOURCE_ID = process.env.BEBOP_SOURCE_ID || ''; // Source ID issued by Bebop
const BEBOP_AUTH_KEY = process.env.BEBOP_AUTH_KEY || ''; // Auth key issued by Bebop

const tokensToSell = ['0x4200000000000000000000000000000000000006']; // WETH on Base
const sellAmounts = [parseEther('1')]; // 1 WETH
const tokensToBuy = ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913']; // USDC on Base

interface Chain {
  chainId: number;
  name: string;
}

const chain: Chain = {
  chainId: 8453,
  name: 'base'
};

async function getSwapQuote(walletAddress: string): Promise<any> {
  const {data: quote} = await axios.get(`https://api.bebop.xyz/pmm/${chain.name}/v3/quote`, {
    params: {
      buy_tokens: tokensToBuy.toString(),
      sell_tokens: tokensToSell.toString(),
      sell_amounts: sellAmounts.toString(),
      taker_address: walletAddress,
      gasless: false,
      approval_type: 'Standard',
      source: BEBOP_SOURCE_ID
    },
    headers: {
      'source-auth': BEBOP_AUTH_KEY
    }
  });

  if (quote.error) {
    throw new Error(`Quote error: ${quote.error}`);
  }

  return quote.tx;
}
```

Bebop quote returns `quote.tx` ready to broadcast.

### Execute

```tsx
import {useWallets} from '@privy-io/react-auth';

async function executeSwap(rawTransaction) {
  const {wallets} = useWallets();
  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === 'privy');
  const provider = await embeddedWallet.getEthereumProvider();

  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [rawTransaction]
  });

  return txHash;
}

// Complete swap flow
async function performSwap() {
  try {
    const {wallets} = useWallets();
    const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === 'privy');

    // Request quote from Bebop
    const transaction = await getSwapQuote(embeddedWallet.address);

    // Execute transaction onchain
    const txHash = await executeSwap(transaction);

    return txHash;
  } catch (error) {
    console.error('Swap failed:', error);
    throw error;
  }
}
```

### Fee monetization

Bebop embeds fees in the quote (collected by market makers). Distribution happens monthly via the `source` query param. Bebop can optionally hedge fees to stablecoins so you don't accumulate token inventory. Contact Bebop to configure.

## Jupiter integration (Solana)

Jupiter is not Privy-native but is the de-facto Solana aggregator. Pattern:

1. `GET https://quote-api.jup.ag/v6/quote?inputMint=...&outputMint=...&amount=...&slippageBps=50`
2. `POST https://quote-api.jup.ag/v6/swap` with the quote response + `userPublicKey` -> returns `swapTransaction` (base64 versioned tx)
3. Deserialize, sign, send via Privy's Solana provider

```js
import {VersionedTransaction} from '@solana/web3.js';
import {Buffer} from 'buffer';

// 1. quote
const quote = await fetch(
  `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`
).then(r => r.json());

// 2. swap tx
const swapResp = await fetch('https://quote-api.jup.ag/v6/swap', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: wallet.address,
    wrapAndUnwrapSol: true,
    prioritizationFeeLamports: 'auto',
  }),
}).then(r => r.json());

// 3. deserialize and sign+send via Privy Solana provider
const txBuf = Buffer.from(swapResp.swapTransaction, 'base64');
const provider = await wallet.getProvider();           // Solana provider, NOT getEthereumProvider
const {signature} = await provider.signAndSendTransaction({
  serializedTransaction: txBuf,
});
```

Key parameters:

- `wrapAndUnwrapSol: true` - handles native SOL <-> wSOL automatically
- `prioritizationFeeLamports: 'auto'` - Jupiter picks a sensible priority fee, otherwise pass a number
- `dynamicComputeUnitLimit: true` - sets compute units based on simulation
- `asLegacyTransaction: false` - default is versioned tx, only flip if your wallet can't handle v0

## Limit orders

Privy's recipe for limit orders is **server-side signers**. The user grants your server a signer for their wallet, optionally constrained by [policies](https://docs.privy.io/controls/policies/overview). When the trigger fires (price hit, time-based, etc.), the server signs and sends the tx.

### Flow

1. **Add a signer to the user's wallet** - request access via the signers quickstart. Store the private key for the signer ID securely on your server.
2. **Listen for triggers** - price feeds, scheduled jobs, etc.
3. **Execute from server** - sign the request with the signer's private key, call the Privy NodeJS SDK or REST API.

For pure off-chain limit orders that don't require a wallet signature at fill time (Jupiter Limit Order, 0x Limit Order v2), the user signs an EIP-712 order at placement and your app submits the signed order to the protocol. Cancellation typically requires a follow-up signature or an on-chain tx.

```typescript
// Conceptual - server places a limit-order swap on a price trigger
import {PrivyClient} from '@privy-io/node';

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
});

// When price hits target...
async function executeLimitOrder(walletId, params) {
  return privy.wallets().ethereum().sendTransaction(walletId, {
    caip2: 'eip155:8453',
    params: {
      transaction: {
        to: params.aggregatorTo,    // 0x or Bebop tx data from a fresh quote
        data: params.aggregatorData,
        value: params.aggregatorValue,
        chain_id: 8453,
      },
    },
  });
}
```

See `limit-orders.md` for the official recipe.

## Bridging

Privy's [Transfer API](https://docs.privy.io/wallets/actions/transfer/overview) supports cross-chain transfers powered by Relay. Limited to same-category assets (stablecoin -> stablecoin, native -> native).

### Bridge same-asset (NodeJS)

```typescript
// Bridge USDC from Base to Tempo
const response = await privy.wallets().transfer('insert-wallet-id', {
  source: {
    asset: 'usdc',
    amount: '10.0',
    chain: 'base',
  },
  destination: {
    address: '0xRecipientAddress',
    chain: 'ethereum',
  },
});
```

### Bridge same-asset (REST)

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

Example response:

```json
{
  "id": "action-id",
  "status": "pending",
  "wallet_id": "wallet-id",
  "created_at": "2026-04-14T20:09:11.929Z",
  "type": "transfer",
  "source_asset": "usdc",
  "source_amount": "10.0",
  "source_chain": "base",
  "destination_address": "0xRecipientAddress",
  "destination_chain": "ethereum"
}
```

### Limitations

- USD-pegged stablecoin <-> USD-pegged stablecoin OK (USDC -> USDT, USDC -> USDG)
- Same native token across chains OK (ETH Base -> ETH Ethereum)
- Cross-category NOT supported (no ETH -> USDC via transfer; use swap API)
- Custom tokens (via `asset_address`) NOT bridgeable
- `amount_type: 'exact_output'` NOT supported for cross-chain
- Mainnet <-> testnet NOT supported - both source and destination on same network type
- Testnet bridging only between `base_sepolia` and `ethereum_sepolia` (best-effort)

### Status progression

`pending` -> `succeeded` | `failed`. Bridge fills are usually seconds on mainnet. Listen for `wallet_action.transfer.succeeded` webhook.

### Arbitrary cross-chain swaps (LiFi, Across, Stargate, Squid, Wormhole)

For ETH-on-Base -> USDC-on-Arbitrum kind of routes, use a third-party bridge aggregator and sign with the Privy provider. Pattern is identical to bring-your-own-aggregator: quote, optional approve, sign, send.

## One Balance

OneBalance creates a "Credible Account" per user that abstracts EVM chains into a single balance. Your app no longer prompts users to "bridge first" - OneBalance handles it transparently.

### Flow

1. Set up OneBalance accounts for users - call OneBalance API, deposit assets to the Credible Account.
2. Fetch a quote from OneBalance for the transaction (swap, transfer, or arbitrary calldata).
3. Sign the quote with the Privy embedded wallet using EIP-712 typed data.
4. Submit the signed quote back to OneBalance for execution.

### Sign with Privy

```tsx
// below interface corresponds to ChainOperationSwaggerDto on OneBalance Swagger documentation
import {ChainOperation} from '<your path to OneBalance interfaces>';
// below interface corresponds to QuoteSwaggerDto on OneBalance Swagger documentation
import {Quote} from '<your path to OneBalance interfaces>';
import {Address, createWalletClient, custom, Hash} from 'viem';

import {ConnectedWallet} from '@privy-io/react-auth';

const signTypedDataWithPrivy =
  (embeddedWallet: ConnectedWallet) =>
  async (typedData: any): Promise<Hash> => {
    const provider = await embeddedWallet.getEthereumProvider();
    const walletClient = createWalletClient({
      transport: custom(provider),
      account: embeddedWallet.address as Address
    });

    return walletClient.signTypedData(typedData);
  };

const signOperation =
  (embeddedWallet: ConnectedWallet) =>
  async (operation: ChainOperation): Promise<ChainOperation> => {
    const signature = await signTypedDataWithPrivy(embeddedWallet)(operation.typedDataToSign);

    return {
      ...operation,
      userOp: {...operation.userOp, signature}
    };
  };

export const signQuote = async (quote: Quote, embeddedWallet: ConnectedWallet) => {
  const signWithEmbeddedWallet = signOperation(embeddedWallet);

  const signedQuote = {
    ...quote
  };

  signedQuote.originChainsOperations = await Promise.all(
    quote.originChainsOperations.map(signWithEmbeddedWallet)
  );
  if (quote.destinationChainOperation) {
    signedQuote.destinationChainOperation = await signWithEmbeddedWallet(
      quote.destinationChainOperation
    );
  }
  return signedQuote;
};
```

OneBalance supports swaps, transfers, and arbitrary calldata execution. After signing, post the signed quote back to OneBalance's execute endpoint and poll for status. Sample app: [github.com/OneBalance-io/integration-examples](https://github.com/OneBalance-io/integration-examples/blob/main/privy/src/features/quote/sign-quote.ts).

## x402 (HTTP 402 micropayments)

x402 is an open HTTP payment protocol. A server returns `402 Payment Required`. The client signs an `X-PAYMENT` header (EIP-3009 transferWithAuthorization) and retries. A facilitator settles on-chain. Users pay in USDC; facilitator covers gas. Privy ships a `useX402Fetch` hook (React) and `createX402Client` (Node).

### React - basic

```tsx
import {useX402Fetch, useWallets} from '@privy-io/react-auth';

function MyComponent() {
  const {wallets} = useWallets();
  const {wrapFetchWithPayment} = useX402Fetch();

  async function fetchPremiumContent() {
    // Wrap fetch with your wallet
    const fetchWithPayment = wrapFetchWithPayment({
      walletAddress: wallets[0]?.address,
      fetch
    });

    // Use exactly like native fetch - automatically handles 402 payments
    const response = await fetchWithPayment('https://api.example.com/premium');
    const data = await response.json();

    return data;
  }

  return <button onClick={fetchPremiumContent}>Fetch Premium Content</button>;
}
```

### Node.js

```typescript
import {createX402Client} from '@privy-io/node/x402';
import {wrapFetchWithPayment} from '@x402/fetch';

// Get wallet details
const wallet = await privy.wallets().get({walletId: 'your-wallet-id'});

// Create x402 client (chain type is inferred from address)
const x402client = createX402Client(privy, {
  walletId: wallet.id,
  address: wallet.address,
});

// Wrap fetch - 402 payments are handled automatically
const fetchWithPayment = wrapFetchWithPayment(fetch, x402client);
const response = await fetchWithPayment('https://api.example.com/premium');
const data = await response.json();
```

### Maximum payment protection

```typescript
import {useX402Fetch, useWallets} from '@privy-io/react-auth';

const {wallets} = useWallets();
const {wrapFetchWithPayment} = useX402Fetch();

const fetchWithPayment = wrapFetchWithPayment({
  walletAddress: wallets[0].address,
  fetch,
  maxValue: BigInt(1000000) // Max 1 USDC (6 decimals)
});
```

### Facilitators

- Pay AI - [facilitator.payai.network](https://facilitator.payai.network/)
- Corbits - [facilitator.corbits.dev](https://facilitator.corbits.dev/)
- Coinbase - api.cdp.coinbase.com/platform/v2/x402

### Requirements

- USDC in the Privy embedded wallet on the correct network (Base, Base Sepolia, Solana)
- Facilitator pays gas
- Testnet USDC: [Circle faucet](https://faucet.circle.com/)

### Example x402-enabled APIs

- CoinGecko Pro x402 endpoints
- Allium AgentHub

## MPP (Machine Payments Protocol)

MPP is a server-to-server variant of the HTTP 402 pattern, settling on the Tempo blockchain in PathUSD. Privy is the signing layer; the `mppx` SDK handles the 402 flow. Useful for AI agents paying for APIs.

### Privy-backed viem account

```typescript
import {PrivyClient} from '@privy-io/node';
import {toAccount} from 'viem/accounts';
import {keccak256} from 'viem';

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID,
  appSecret: process.env.PRIVY_APP_SECRET
});

function createPrivyAccount(walletId: string, address: `0x${string}`) {
  async function signHash(hash: `0x${string}`): Promise<`0x${string}`> {
    const result = await privy.wallets().ethereum().signSecp256k1(walletId, {params: {hash}});
    return result.signature as `0x${string}`;
  }

  return toAccount({
    address,

    async signMessage({message}) {
      const result = await privy
        .wallets()
        .ethereum()
        .signMessage(walletId, {
          message: typeof message === 'string' ? message : message.raw
        });
      return result.signature as `0x${string}`;
    },

    async signTransaction(transaction, options) {
      const serializer = options?.serializer;
      if (!serializer) {
        throw new Error('Tempo serializer required');
      }

      const unsignedSerialized = await serializer(transaction);
      const hash = keccak256(unsignedSerialized);
      const signature = await signHash(hash as `0x${string}`);

      const {SignatureEnvelope} = await import('ox/tempo');
      const envelope = SignatureEnvelope.from(signature);
      return (await serializer(transaction, envelope as any)) as `0x${string}`;
    },

    async signTypedData(typedData) {
      const result = await privy
        .wallets()
        .ethereum()
        .signTypedData(walletId, {params: typedData as any});
      return result.signature as `0x${string}`;
    }
  });
}
```

### Make a paid request

```typescript
import {Mppx, tempo} from 'mppx/client';

async function makePayment(walletId: string, address: `0x${string}`, url: string) {
  const account = createPrivyAccount(walletId, address);

  const mppx = Mppx.create({
    polyfill: false,
    methods: [tempo({account})]
  });

  const response = await mppx.fetch(url);
  const data = await response.json();
  return data;
}
```

### Polyfill fetch globally

```typescript
import {Mppx, tempo} from 'mppx/client';

const account = createPrivyAccount(walletId, address);

Mppx.create({
  polyfill: true,
  methods: [tempo({account})]
});

// All fetch calls now handle 402 responses automatically
const response = await fetch('https://api.example.com/weather');
```

### Server-side: charge for an API route

```typescript
// app/api/weather/route.ts
import {Mppx, tempo} from 'mppx/nextjs';

const mppx = Mppx.create({
  methods: [
    tempo.charge({
      currency: '0x20c0000000000000000000000000000000000000', // PathUSD
      recipient: process.env.MPP_RECIPIENT as `0x${string}`
    })
  ]
});

export const GET = mppx.charge({amount: '0.1'})(() =>
  Response.json({
    temperature: 72,
    condition: 'Sunny',
    location: 'San Francisco, CA'
  })
);
```

## Trading app recipe (from trading-apps-homepage.md)

Privy positions itself as the wallet layer for trading apps. Reference users: Hyperliquid, pump.fun, dYdX, Vector, Jupiter, BananaGun. Suggested building blocks:

- Create a wallet - embedded ETH + SOL on signup
- On-ramp funds - Apple Pay, Google Pay, card-based funding
- Send a transaction - client or server (signers)
- Off-ramp - cash out to fiat
- Telegram trading bot - server-side wallet via session signers
- Flashbots Protect - MEV protection on EVM
- Hyperliquid integration - perp trading SDK + Privy signer
- Morpho - lending recipes
- Limit orders - session signers + price feed triggers
- Disable confirmation modals - faster trading UX (`manage-wallet-UIs`)
- Policies - spending caps, allowlists, denylists

## Bridge Cards (debit card spending stablecoins)

Bridge Cards issues a card that pulls stablecoins directly from a non-custodial Privy wallet on Solana or World Chain. The wallet must approve Bridge's contract once, then Bridge pulls funds at swipe time. Two webhook events fire per transaction (`card_transaction.created`, then `card_transaction.updated` with on-chain hash).

Supported contracts:

| Chain | Contract |
| --- | --- |
| Solana | `cardWArqhdV5jeRXXjUti7cHAa4mj41Nj3Apc6RPZH2` |
| World Chain | `0x6B0D105999491a48d5793FB6Cb54f5cE079E0da9` |

Solana approval uses an SPL `approve` instruction to a Bridge-derived delegate PDA. EVM uses standard ERC-20 `approve`. A wallet can only be tied to ONE card account. See `bridge-cards.md` for the full provisioning + approval flow.

## Code patterns (verbatim, full)

### 0x v2 - approve Permit2 once, then quote + sign + send per swap

```tsx
import {maxUint256, erc20Abi, encodeFunctionData, numberToHex, concat, size} from 'viem';

const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const CHAIN_ID = 8453;

async function approvePermit2Once(wallet) {
  const provider = await wallet.getProvider();
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [PERMIT2_ADDRESS, maxUint256],
  });
  return provider.request({
    method: 'eth_sendTransaction',
    params: [{from: wallet.address, to: USDC_ADDRESS, data}],
  });
}

async function quoteAndSwap(wallet, sellAmount) {
  // 1. quote
  const quoteResult = await fetch(
    `https://api.0x.org/swap/permit2/quote?chainId=${CHAIN_ID}&sellToken=${USDC_ADDRESS}&buyToken=${ETH_ADDRESS}&sellAmount=${sellAmount}&taker=${wallet.address}`,
    {headers: {'0x-api-key': process.env.API_KEY_0X, '0x-version': 'v2'}}
  ).then((r) => r.json());

  // 2. sign permit
  const provider = await wallet.getProvider();
  const signature = await provider.request({
    method: 'eth_signTypedData_v4',
    params: [wallet.address, quoteResult.permit2.eip712],
  });
  const signatureLengthInHex = numberToHex(size(signature), {signed: false, size: 32});

  // 3. pack tx data with signature appended
  const transactionData = concat([quoteResult.transaction.data, signatureLengthInHex, signature]);
  const params = {
    from: wallet.address,
    to: quoteResult.transaction.to,
    data: transactionData,
    gas: quoteResult.transaction.gas ? BigInt(quoteResult.transaction.gas) : undefined,
  };

  // 4. send
  return provider.request({method: 'eth_sendTransaction', params: [params]});
}
```

### Bebop - approve once, RFQ quote, send

See the verbatim code under "Bebop integration" above (`approveToken`, `getSwapQuote`, `executeSwap`, `performSwap`).

### Jupiter v6 - quote + swap + send (Solana)

See the verbatim code under "Jupiter integration (Solana)" above.

### Privy built-in useSwap()

The official docs surface this as REST endpoints today (no public React hook reference in the source docs synthesized here). Use the REST examples under "Built-in Privy Swap" above.

### Limit order via server signer

See the conceptual snippet under "Limit orders" above. The mechanical signing is the same as any other Wallet API call - the difference is the trigger lives on your server.

## Spectre-specific notes

We have `useSwapExecution.js` in BOTH apps (`apps/research/src/hooks/useSwapExecution.js` and `apps/trading/src/hooks/useSwapExecution.js` - similar but research uses `@/` aliases). Trading is the canonical implementation; research mirrors it.

Hook signature:

```js
useSwapExecution({ token, mode, payToken, slippageBps }) ->
  { quote, quoteLoading, quoteError, isSwapping, swapSuccess, swapError, txHash }
```

Key behaviors:

- **Slippage**: clamped 1-500 bps, default 50 (0.5%)
- **Debounce**: 400ms with AbortController on quote fetches
- **Chain routing**: Solana (networkId `1399811149`) -> Jupiter v6; EVM -> 0x v2
- **Wallet selection**: `useWallets()` filtered by chain type; Solana wallet for SOL trades, EVM wallet for EVM trades
- **Fee collection**: hard-coded fee recipient + fee bps in env vars (`VITE_FEE_WALLET_*`, `VITE_FEE_BPS`)
- **Server endpoint**: `/api/fee-config` returns the fee setup. NOT verified server-side via Privy access token today - GAP for the audit.
- **Quote staleness guard**: before executing, the hook verifies the quote's `inputToken` / `outputToken` still match the UI selection. Mismatch -> error "Quote expired - enter your amount again".
- **Cancelled tx detection**: errors containing `cancelled`, `canceled`, or `rejected` get mapped to a friendly "Transaction cancelled" state and never surface as failures.
- **Confirmation polling**: `waitForConfirmation(hash, chain, 60_000)`. Solana = `confirmationStatus === 'confirmed' || 'finalized'`. EVM = `receipt.status === 1`. 60s timeout throws.

What we DO NOT use:

- Privy's built-in `useSwap()` hook (or `POST /v1/wallets/{walletId}/swap`)
- Bebop
- Limit orders
- Bridging (Privy transfer API or otherwise)
- OneBalance
- x402
- MPP
- Bridge Cards

What we DO use:

- Jupiter v6 (Solana)
- 0x v2 with Permit2 (EVM)
- `useSwapExecution` in both apps + `swapService.js` for quote/execute/confirm helpers
- `/api/fee-config` for surfacing platform fee % to the UI

### Implications for audit

| Change | Pros | Cons |
| --- | --- | --- |
| Switch to Privy built-in `useSwap()` | Maintained aggregator, automatic approvals, gas sponsorship integrated, one less moving part | Lose our swap UI surface area, lose flexibility on routing, 0.25% Privy fee on top of pool fees, no Solana support yet (Solana is a huge share of our volume) |
| Add Bebop as a second EVM source | Better quotes for large stables, zero-slippage RFQ | More integrations to maintain, needs Bebop partnership credentials |
| Migrate to Permit2 on 0x | Save 1 tx per token per user (no on-chain approve per swap after first time) | We are already on 0x v2 + Permit2 per code path, but verify the approval state is being remembered per-user-per-token correctly |
| Add limit orders | Sticky feature, parity with major trading apps | Server-side signer infra, policy plumbing, price feed |
| Add bridging UI (Relay / LiFi) | Users come to Spectre with funds on the wrong chain - bridging in-app removes drop-off | More aggregator integrations, more failure modes |
| Adopt OneBalance | "One balance across chains" feels magical | Adds a third party to the critical path, less direct control |
| Server-side fee verification via Privy access token | Closes the GAP on `/api/fee-config` trust boundary | Small server change |

## Gotchas and pitfalls

- 0x v2 REQUIRES Permit2. Users must either pre-approve Permit2 for the token (one tx, once) and then sign per-swap Permit2 typed data, OR your app handles the approve flow on first swap.
- 0x v2 quote includes `transaction.to` AND `allowanceTarget` - they are NOT always the same. Approve `allowanceTarget` (Permit2 in v2), send the tx to `transaction.to` (Settler/AllowanceHolder contract).
- 0x v2 `swapFeeBps` is a number-as-string in v2. Some clients trip on old v1 parameter names (`buyTokenPercentageFee`). Use v2 names: `swapFeeRecipient`, `swapFeeBps`, `swapFeeToken`.
- 0x v2 expects the signature APPENDED to calldata (`data + length + signature`), not in a separate field. Easy to miss when porting from v1.
- Bebop quotes are short-lived (~10s). Re-fetch immediately before signing on slow UIs.
- Jupiter on Solana: the response is a base64 versioned tx. Use `VersionedTransaction.deserialize(Buffer.from(base64, 'base64'))` if your wallet doesn't take the raw buffer. Privy's Solana provider accepts `{ serializedTransaction: Buffer }` directly via `signAndSendTransaction`.
- Jupiter `wrapAndUnwrapSol: true` is required for native SOL swaps - otherwise the tx will fail at the wSOL wrap step.
- Jupiter priority fee: pass `prioritizationFeeLamports: 'auto'` (or a number). Jupiter doesn't always inject a priority fee by default, and during congestion this is the difference between a 2s confirmation and a dropped tx.
- Slippage tradeoff: too tight = `INSUFFICIENT_OUTPUT_AMOUNT` revert; too loose = MEV sandwich exposure on EVM. We default to 50 bps and clamp at 500 bps.
- For Solana the priority fee must be set explicitly on the Jupiter tx OR via a separate `setComputeUnitPrice` instruction. Jupiter's own `prioritizationFeeLamports` parameter handles this when you ask for `'auto'`.
- Privy's built-in swap charges up to 0.25% on input - this is in addition to any pool fees and is NOT configurable per-app today.
- Privy built-in swap REQUIRES gas sponsorship to be enabled and funded. Without sponsorship credit, swaps revert.
- Privy built-in swap does not support Solana yet (docs say "coming soon"). For Solana use Jupiter directly.
- `getEthereumProvider()` (EVM) vs `getProvider()` (Solana) - different methods on the wallet object. Easy to call the wrong one and get cryptic errors.
- Affiliate fees on Privy's built-in swap are NOT configurable from the API - they go to Privy.
- The transfer API for bridging is `pending` -> `succeeded` | `failed`. Don't confuse the `status` field with the swap API's `status` (both use the same vocabulary but for different actions).
- Bridging the transfer API does NOT support `amount_type: exact_output` for cross-chain. Only `exact_input`.
- x402 and MPP both speak HTTP 402 but settle on different rails (x402 = USDC on Base/Solana via facilitators; MPP = PathUSD on Tempo). Don't mix them up. They are separate SDKs (`@privy-io/react-auth` `useX402Fetch` vs `mppx`).
- Bridge Cards: a wallet can only be linked to ONE card account. Trying to provision a second card for the same wallet fails.
- Webhook trust: `wallet_action.swap.succeeded` and `wallet_action.transfer.succeeded` are useful but verify signatures and check idempotency keys.

## Cross-references

- Sign + send mechanics -> `05-transactions-and-signing.md`
- Solana-specific (Jupiter, ATA derivation, priority fees) -> `03-solana-integration.md`
- EVM-specific (0x v2, Permit2, gas sponsorship) -> `04-evm-integration.md`
- Funding wallets pre-swap (Apple Pay, card-based, on-ramp) -> `07-funding-and-onramp.md`
- DeFi recipes (Polymarket, vaults, Hyperliquid, Morpho) -> `13-defi-and-bot-recipes.md`
- Current Spectre swap implementation -> `spectre/current-implementation.md`
- Wallet provider hooks (`getEthereumProvider`, `getProvider`) -> `02-react-and-hooks.md`
- Server-side signers + policies (limit-order backbone) -> `08-server-and-policies.md`
