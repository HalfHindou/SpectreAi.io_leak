---
description: Privy funding & on/off-ramps reference (useFundWallet, card funding, Stripe, custom onramps, off-ramps, WalletConnect Pay, account transfer). Synthesized from official docs.
---

# Privy Funding, On-Ramp & Off-Ramp

This file is the single reference for moving money INTO and OUT OF Privy embedded wallets. Every section is grounded in the official Privy docs; code blocks are verbatim from those docs unless otherwise noted.

## Source docs synthesized

All paths below are relative to `C:\Users\worka\OneDrive\Desktop\Privy\`:

- `card-based-funding.md` - card / Apple Pay / Google Pay funding via `useFundWallet`
- `stripe-headless-onramp.md` - Stripe Crypto Embedded Components (headless onramp, build your own UI)
- `custom-fiat-onramp.md` - bring-your-own onramp (MoonPay sandbox walkthrough, Transak / Sardine / Stripe equivalents)
- `off-ramp-guide.md` - crypto to fiat across Coinflow, MoonPay, Ramp Network, Coinbase, Hifi, Bridge
- `walletconnect-pay.md` - WalletConnect Pay (pay any link with the Privy embedded wallet)
- `relay-deposit-addresses.md` - Layerswap-style deposit addresses powered by Relay
- `account-transfer.md` - login-method transfer between two Privy accounts owned by the same user
- `auto-exchange-privy-agent.md` - the auto.exchange Privy Expert agent (NOT an auto-swap product; it is a documentation assistant)
- `Transfer Overview.md` - `/v1/wallets/{wallet_id}/transfer` wallet action (the on-chain transfer primitive)
- `Bridging.md` - cross-chain transfer via the same `/transfer` API (Relay under the hood)
- `bridge-cards.md` - issuing Bridge debit cards that spend stablecoins from a non-custodial wallet
- `deposit.md` - earn/vault deposit (ERC-4626) - included because it lives alongside funding in the docs but is NOT a fiat ramp
- `withdraw.md` - earn/vault withdraw (sibling to deposit, same caveat)

## Core concepts

- Fund wallet = move fiat or crypto INTO a Privy embedded wallet. Privy hides the difference between fiat ramp, exchange transfer, and external-wallet send behind a single `useFundWallet` modal.
- On-ramp = fiat to crypto. Provider sells crypto to the user and delivers it to the Privy embedded wallet.
- Off-ramp = crypto to fiat. Provider buys crypto from the user, sends fiat to a bank account.
- Card-based funding = a subtype of on-ramp using Apple Pay / Google Pay / debit cards. Behind the scenes Privy currently routes this to MoonPay or Coinbase Onramp depending on region and configuration.
- Crypto-to-crypto funding = user funds from an external wallet (Phantom, Rabby, etc.) via transfer or WalletConnect Pay.
- Relay deposit addresses = one-shot bridge addresses (LayerSwap-style). You request an address from the Relay API, user sends the source asset, Relay bridges and delivers to the destination chain.
- Account transfer = login-method transfer between two Privy accounts both owned by the same user. NOT the same as a wallet-to-wallet on-chain transfer. The on-chain primitive is the `/transfer` wallet action.
- Bridging = cross-chain transfer via the standard `/transfer` API with `source.chain` != `destination.chain`. Powered by Relay.
- Bridge Cards = a separate Bridge product that issues debit cards backed by a non-custodial wallet's stablecoin balance.

## API surface

### `useFundWallet()` - web (`@privy-io/react-auth`)

Returns `{ fundWallet }`. Signature varies by chain.

EVM call shape:

```tsx
import {useFundWallet} from '@privy-io/react-auth';
import {base} from 'viem/chains';

const {fundWallet} = useFundWallet();

fundWallet('your-wallet-address-here', {
  chain: base,
  amount: '0.01', // defaults to 'native-currency' (ETH)
});
```

EVM parameters (options object):

| Parameter | Type | Description |
|-----------|------|-------------|
| `chain`   | `Chain` from viem/chains | Optional. Network to fund on. Defaults to dashboard config. |
| `asset`   | `'native-currency' \| 'USDC' \| {erc20: string}` | Optional. Defaults to native currency. |
| `amount`  | `string` (decimal) | Required if `asset` is set. Otherwise optional, defaults to dashboard amount. |

Solana variant:

```tsx
import {useFundWallet} from '@privy-io/react-auth/solana';

const {fundWallet} = useFundWallet();
fundWallet('your-wallet-address-here', {
  cluster: {name: 'devnet'},
  amount: '0.01', // SOL
});
```

Solana parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `cluster` | `SolanaCluster` | Optional. Defaults to `mainnet-beta`. |
| `amount`  | `string` (decimal) | Required if asset specified. |

### `useFundWallet()` / `useFundSolanaWallet()` - Expo (`@privy-io/expo/ui`)

```tsx
import {useFundWallet} from '@privy-io/expo/ui';
import {base} from 'viem/chains';

fundWallet({
  address: '0x2F3eb40872143b77D54a6f6e7Cc120464C764c09',
  asset: 'USDC',
  chain: base,
  amount: '1',
});
```

Solana on Expo uses a separate hook:

```tsx
import {useFundSolanaWallet} from '@privy-io/expo/ui';

const {fundWallet} = useFundSolanaWallet();
fundWallet({
  address: 'address',
  amount: '0.01', // SOL
});
```

### `/v1/wallets/{wallet_id}/transfer` - the on-chain transfer wallet action

This is NOT a hook. It is a REST endpoint (also exposed via Node SDK) for sending tokens FROM a Privy server-controlled wallet. Used for off-ramp deliveries, internal sweeps, and bridge transfers.

Supported assets (verbatim): `usdc`, `usdc_e`, `usdt`, `usdt0`, `usdb`, `eurc`, `eth`, `sol`, `pol`.

Supported chains (verbatim): `ethereum`, `base`, `arbitrum`, `polygon`, `tempo`, `solana`, plus matching testnets (`ethereum_sepolia`, `base_sepolia`, `arbitrum_sepolia`, `polygon_amoy`, `tempo_moderato`, `solana_devnet`).

Node SDK:

```typescript
const response = await privy.wallets().transfer('insert-wallet-id', {
  source: {
    asset: 'usdc',
    amount: '10.0',
    chain: 'base',
  },
  destination: {
    address: '0xRecipientAddress',
  },
  authorization_context: {
    authorization_private_keys: ['<authorization-private-key>'],
  },
});
```

REST:

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
      "address": "0xRecipientAddress"
    }
  }'
```

Response is async - 200 with `status: "pending"`. Poll via wallet action API or subscribe to the `wallet_action.transfer.succeeded` webhook.

### Bridge variant of `/transfer`

Set `destination.chain` different from `source.chain` (cross-chain), or `destination.asset` different from `source.asset` (stablecoin conversion), or both.

```typescript
// Bridge USDC from Base to Ethereum
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

Bridge limits:
- Only same-category swaps: USD-stable -> USD-stable, or native -> same native on another chain. NO native -> stablecoin.
- Custom tokens via `asset_address` cannot be bridged.
- `amount_type: 'exact_output'` is not supported for cross-chain transfers. Only `exact_input`.
- Mainnet-to-testnet bridges are blocked. Testnet bridges are best-effort on `base_sepolia` / `ethereum_sepolia`.

### `useWithdraw()` - DOES NOT EXIST as a unified hook

There is no Privy `useWithdraw` hook for fiat off-ramp. Off-ramp is implemented by:
1. Picking a third-party off-ramp provider (Coinflow, MoonPay, Ramp, Coinbase, Hifi, Bridge).
2. Embedding that provider's SDK / widget in your app.
3. When the provider asks for a transfer, your app uses Privy's `useSendTransaction` or the server-side `transfer` action to move crypto to the provider's deposit address.

`withdraw.md` IS a Privy endpoint, but it withdraws from a yield vault (ERC-4626), NOT to a bank account. It is unrelated to fiat off-ramp.

### `useAccountTransfer()` - DOES NOT EXIST

`account-transfer.md` describes a dashboard configuration setting, not a hook. When enabled, a user who tries to link a login method that is already attached to another Privy account they own gets prompted to transfer the login method to their currently logged-in account. The orphan account is then deleted. There is no SDK hook for this. The flow happens inside the Privy modal automatically.

## Provider config (`PrivyProvider`)

### `fundingMethodsAndOrder` block

Controls which funding methods appear in the modal and in what order. Spectre's research app config (verbatim from `apps/research/src/lib/privy-config.js`):

```js
fundingMethodsAndOrder: {
  primary: ['card'],
  overflow: ['exchange'],
},
```

Allowed values inside `primary` / `overflow` (per Privy docs and runtime testing):
- `'card'` - Apple Pay / Google Pay / debit card (MoonPay or Coinbase Onramp under the hood)
- `'exchange'` - "Transfer from an exchange" (instructional UI - QR code + address)
- `'wallet'` - "Transfer from an external wallet" (WalletConnect / direct send)
- `'manual'` - show the wallet address and a copy button

If `fundingMethodsAndOrder` is omitted entirely, Privy uses dashboard defaults. Dashboard config lives at `https://dashboard.privy.io/apps?page=funding` - "User management > Account funding".

### Per-chain funding methods

Card funding is configurable per network in the dashboard (EVM chains and Solana). The dashboard lets you:
- Toggle "Pay with card" on
- Pick which EVM networks (Ethereum, Base, Polygon, Arbitrum, etc.) accept card funding
- Pick whether Solana mainnet accepts card funding
- Set a recommended fund amount per network (user can override at runtime)

### Card on-ramp is MAINNET ONLY

From `card-based-funding.md`:

> Card and fiat on-ramp purchases are supported on mainnets only. On testnets (e.g. Polygon Amoy, Sepolia), on-ramps cannot purchase testnet tokens, so this flow will not be shown or will fail.

### USD / EUR / other fiat

The fiat side is determined by the provider Privy routes to. MoonPay supports a wide currency set; Coinbase Onramp is heavily US-USD. Stripe Crypto (private beta) is US-first.

### Min / max amounts

Privy does not enforce minimums itself - they come from the provider. Typical floors at the time of writing: MoonPay USD $20, Coinbase Onramp USD $5, Stripe Crypto $10. Maximums depend on KYC tier; an unverified user on MoonPay can usually do up to $150-$200 before being forced into KYC.

## Card-based funding

The simplest path. One hook call opens the modal, the user picks Apple Pay / Google Pay / card, completes KYC if required, and crypto lands in the embedded wallet.

### 1. Enable in dashboard

In the Privy Dashboard at `User management > Account funding`, toggle "Pay with card" ON, then choose the supported networks and a default amount per network.

### 2. Call `fundWallet` (web)

EVM verbatim:

```tsx
import {useFundWallet} from '@privy-io/react-auth';
import {base} from 'viem/chains';

const {fundWallet} = useFundWallet();
fundWallet('your-wallet-address-here', {
  chain: base,
  amount: '0.01',
});
```

Solana verbatim:

```tsx
import {useFundWallet} from '@privy-io/react-auth/solana';

const {fundWallet} = useFundWallet();
fundWallet('your-wallet-address-here', {
  cluster: {name: 'devnet'},
  amount: '0.01',
});
```

### 3. Call `fundWallet` (Expo)

```tsx
import {useFundWallet} from '@privy-io/expo/ui';
import {base} from 'viem/chains';

fundWallet({
  address: '0x2F3eb40872143b77D54a6f6e7Cc120464C764c09',
  asset: 'USDC',
  chain: base,
  amount: '1',
});
```

### Flow summary

1. User taps the Buy button in your app.
2. Privy modal opens. User sees Apple Pay / Google Pay / Card options if their device supports them.
3. User completes KYC (provider-side, once per provider). Persists across sessions.
4. Crypto is delivered to the embedded wallet. Funding-event webhook fires when settled.
5. Your `fundWallet` Promise resolves when the modal closes (success or cancel). Inspect via webhook for the authoritative result.

### Fees

Provider-specific. As a rule of thumb: 3-5% on MoonPay card, 1-2% on Coinbase Onramp ACH, 4-6% on Stripe Crypto card. Privy does not charge an additional fee on top.

## Stripe headless onramp

Build your own UI on top of Stripe's Embedded Components for the Crypto Onramp SDK. Stripe handles payments, KYC, and crypto delivery to the Privy embedded wallet. Your app controls every pixel.

### Status

> Stripe's Embedded Components for Crypto Onramp is currently in private beta. Your app must be approved for crypto onramp and enrolled in Stripe's verified apps program before using this integration.

### Prerequisites

1. Stripe account with Crypto Onramp access (submit application at docs.stripe.com/crypto/onramp).
2. Verified Apps Program enrollment (contact Stripe rep).
3. A configured Privy app with embedded wallets enabled.

### Setup (Expo)

```bash
npm install @stripe/stripe-react-native@0.52.0-crypto-onramp-2-private-beta
```

`app.json`:

```json
{
  "expo": {
    "plugins": [
      [
        "@stripe/stripe-react-native",
        {
          "merchantIdentifier": "merchant.com.your-app",
          "enableGooglePay": false,
          "includeOnramp": true
        }
      ]
    ]
  }
}
```

Provider stack:

```tsx
import {PrivyProvider} from '@privy-io/expo';
import {StripeProvider} from '@stripe/stripe-react-native';

export default function App() {
  return (
    <PrivyProvider appId="your-privy-app-id" clientId="your-client-id">
      <StripeProvider publishableKey="pk_..." merchantIdentifier="merchant.com.your-app">
        <YourApp />
      </StripeProvider>
    </PrivyProvider>
  );
}
```

### Flow (9 steps)

1. Initialize the Onramp Coordinator with `configure({ appearance })`.
2. Handle Link auth - `hasLinkAccount(email)` -> `authenticateUser()` or `registerLinkUser({...})`. Returns a `cryptoCustomerId`.
3. Check customer status on backend via `GET https://api.stripe.com/v1/crypto/customers/{id}`. Returns KYC + ID-doc verification status.
4. If KYC needed, call `attachKycInfo({ firstName, lastName, dateOfBirth, address, idType, idNumber })` from frontend.
5. If ID document needed, call `verifyIdentity()` - launches Stripe Identity SDK for document upload.
6. Register the Privy wallet as the crypto destination: `registerWalletAddress(wallet.address, 'base')`. Supported networks for USDC: `'base'`, `'polygon'`, `'solana'`, `'avalanche'`.
7. Collect payment method: `collectPaymentMethod('Card' | 'BankAccount' | 'PlatformPay')`.
8. Backend creates onramp session via `POST https://api.stripe.com/v1/crypto/onramp_sessions`. Body includes `ui_mode: 'headless'`, `crypto_customer_id`, `payment_token`, `wallet_id`, `source_currency: 'usd.fiat'`, `destination_currency: 'usdc.base'`, `source_amount`, `customer_ip_address`, `off_session: 'false'`.
9. Frontend calls `performCheckout(sessionId, async () => clientSecret)`. Handles 3DS automatically. The callback may fire twice (initial + post-auth).

### Backend session creation (verbatim)

```typescript
// POST /api/crypto/onramp
async function createOnrampSession(req, res) {
  const {
    cryptoCustomerId,
    paymentToken,
    walletId,
    sourceCurrency,
    destinationCurrency,
    sourceAmount,
    customerIpAddress
  } = req.body;

  const session = await fetch('https://api.stripe.com/v1/crypto/onramp_sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      ui_mode: 'headless',
      crypto_customer_id: cryptoCustomerId,
      payment_token: paymentToken,
      wallet_id: walletId,
      source_currency: sourceCurrency,
      destination_currency: destinationCurrency,
      source_amount: sourceAmount.toString(),
      customer_ip_address: customerIpAddress,
      off_session: 'false'
    })
  });

  const sessionData = await session.json();
  res.json(sessionData);
}
```

### Stripe Crypto error reasons

`location_not_supported`, `transaction_limit_reached`, `charged_with_expired_quote`, `action_required`, `transaction_failed`, `missing_kyc`, `missing_document_verification`, `missing_consumer_wallet`.

### Limitation

> Stripe Crypto onramp currently only supports stablecoin as onramp currencies. If you wish to onramp other currencies such as ETH or SOL, you can make use of our card-based funding offerings.

## Custom fiat onramp (BYO provider)

When the default Privy modal is not enough - you need a different provider, a different region, an embedded iframe, etc.

Privy supports out-of-the-box MoonPay and Coinbase via the funding modal. The "custom" path is for Sardine, Stripe (non-private-beta), Ramp Network, Onramper, Transak, etc.

### Generic shape (all providers)

1. Frontend collects user wallet address, email, redirect URL, optional asset/network/amount.
2. Frontend POSTs to your backend with these details and the user's Privy auth token.
3. Backend constructs the provider's URL with query params, signs it with the provider's secret key, returns the URL.
4. Frontend redirects the user to that URL (new tab) OR embeds it in an iframe.
5. After purchase, provider redirects user back to your `redirectUrl` (typically with a `transactionId` query param).

### MoonPay walkthrough (verbatim)

Frontend - request the URL:

```tsx
const {user, getAccessToken} = usePrivy();

const fundWallet = async () => {
  const walletAddress = user?.wallet?.address;
  if (!walletAddress) return;
  const emailAddress = user?.email?.address;
  const currentUrl = window.location.href;
  const authToken = await getAccessToken();

  try {
    const onrampResponse = await axios.post(
      "/api/onramp",
      {
        address: user!.wallet!.address,
        email: user?.email?.address,
        redirectUrl: currentUrl,
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );
    return onrampResponse.data.url as string;
  } catch (error) {
    console.error(error);
    return undefined;
  }
};
```

Backend - build the URL:

```tsx
const {address, email, redirectUrl} = req.body;

const onrampUrl = new URL(`https://buy-sandbox.moonpay.com?apiKey=YOUR_MOONPAY_PUBLIC_KEY`);
onrampUrl.searchParams.set('walletAddress', address);
onrampUrl.searchParams.set('redirectURL', redirectUrl);
onrampUrl.searchParams.set('email', email);
onrampUrl.searchParams.set('currencyCode', 'eth');

import crypto from "crypto";
const urlSignature = crypto
    .createHmac("sha256", YOUR_MOONPAY_SECRET_KEY)
    .update(onrampUrl.search)
    .digest("base64");

onrampUrl.searchParams.set("signature", urlSignature);

return res.status(200).json({url: onrampUrl.toString()});
```

Frontend - open it:

```tsx
const onrampUrl = await fundWallet();
window.open(onrampUrl, '_blank');
```

Or iframe (for in-app):

```tsx
<iframe
    allow="accelerometer; autoplay; camera; gyroscope; payment"
    frameBorder="0"
    height="100%"
    width="100%"
    src={onrampUrl}
/>
```

The `allow="... camera ..."` attributes are REQUIRED for KYC document capture inside the iframe. Without them, the user cannot complete identity verification.

### Other providers (same shape, different details)

- **Transak**: REST API for URL generation. Sign with HMAC. Has dedicated React component (`@transak/transak-sdk`).
- **Sardine**: GraphQL API for quote and order creation. SDK component available.
- **Coinbase Onramp**: REST API to generate a one-time URL token. Public docs at docs.cdp.coinbase.com/onramp.
- **Ramp Network**: SDK widget (`@ramp-network/ramp-instant-sdk`). Configure with hostAppName and hostLogoUrl, no signature needed for many flows.
- **Onramper**: Aggregator over many onramp providers. Single iframe, picks best provider per region.

### NFT Checkout

Many onramp providers offer NFT-specific flows with looser KYC and higher payment success rates. Configure NFT-sale details (contract address, token type, payments) in the provider's dashboard. Same integration shape as the generic fiat onramp.

## Off-ramp

Privy does not own off-ramp. Off-ramp is a third-party flow that you bolt on. Privy's role is supplying the wallet that signs the crypto-out transfer.

### Privy's off-ramp flow (4 steps from `off-ramp-guide.md`)

1. User has assets in their Privy wallet.
2. Integration and setup - add the chosen off-ramp provider's SDK, configure API keys, expose a Withdraw button that opens the provider's UI.
3. User verification - completes the provider's KYC (once) and connects a bank account.
4. Transaction and payout - your app uses Privy SDKs to sign a transfer to the provider's deposit address. Provider sends fiat to the user's bank.

### Supported providers (per `off-ramp-guide.md`)

| Provider | Docs |
|----------|------|
| Coinflow | docs.coinflow.cash/docs/how-withdraws-work |
| MoonPay | dev.moonpay.com/widget/off-ramp-overview |
| Ramp Network | docs.ramp.network/off-ramp |
| Coinbase | docs.cdp.coinbase.com/onramp/docs/api-offramp-overview |
| Hifi | docs.hifibridge.com/docs/api-offramp |
| Bridge | apidocs.bridge.xyz/get-started/guides/move-money/offramp_liquidation |

### Settlement timing

| Provider | Speed | Notes |
|----------|-------|-------|
| Coinflow | Same-day ACH | US-only |
| MoonPay | 1-3 business days | SEPA / ACH / Faster Payments per region |
| Ramp | 1-3 business days | EU strong |
| Coinbase | Near-instant for Coinbase users (internal) | Bank withdrawal 1-3 business days |
| Hifi | Instant for partner banks | B2B-flavored |
| Bridge | Same-day ACH / SEPA | Custom liquidity rails |

### Sending the crypto leg with Privy

Once the off-ramp provider returns a deposit address and a `transferId`, your app signs and submits the on-chain transfer using either:

- Frontend: `useSendTransaction` (EVM) or `useSignAndSendTransaction` (Solana) for embedded wallets the user controls.
- Server: `privy.wallets().transfer(...)` with the wallet's `authorization_context` for server-controlled or delegated wallets.

The off-ramp provider monitors the deposit address and triggers the fiat payout once the on-chain transfer confirms.

## WalletConnect Pay

Lets users pay from any WalletConnect-compatible wallet (Phantom, Rabby, Rainbow, Trust Wallet, etc.), but in the Privy context the inverse use case is the interesting one: users with a Privy embedded wallet can pay any WalletConnect Pay link in-app.

### Dependencies

```bash
npm install @privy-io/react-auth @reown/walletkit @walletconnect/core
```

### Project IDs

- Privy App ID (from Privy Dashboard)
- WalletConnect Project ID (from dashboard.walletconnect.com)

```bash
VITE_PRIVY_APP_ID=your-privy-app-id
VITE_WALLETCONNECT_PROJECT_ID=your-walletconnect-project-id
```

### Provider

```tsx
import {PrivyProvider} from '@privy-io/react-auth';

<PrivyProvider
  appId={import.meta.env.VITE_PRIVY_APP_ID}
  config={{
    appearance: {
      theme: 'dark'
    },
    embeddedWallets: {
      ethereum: {
        createOnLogin: 'users-without-wallets'
      }
    }
  }}
>
  <App />
</PrivyProvider>;
```

### WalletKit initialization

```ts
import {Core} from '@walletconnect/core';
import {WalletKit} from '@reown/walletkit';

let core: InstanceType<typeof Core> | null = null;
let walletkit: Awaited<ReturnType<typeof WalletKit.init>> | null = null;

const projectId = process.env.VITE_WALLETCONNECT_PROJECT_ID;

const metadata = {
  name: 'My Pay App',
  description: 'Pay with crypto',
  url: window.location.origin,
  icons: ['https://your-app.com/icon.png']
};

function getCore() {
  if (!core) {
    core = new Core({projectId});
  }
  return core;
}

export async function getWalletKit() {
  if (walletkit) return walletkit;
  walletkit = await WalletKit.init({
    core: getCore() as any,
    metadata,
    payConfig: {
      appId: projectId,
      apiKey: 'your-wc-pay-api-key'
    }
  });
  return walletkit;
}
```

### Pay-with-link flow (6 steps)

1. Get the Privy wallet:

```ts
import {useWallets} from '@privy-io/react-auth';

const {wallets} = useWallets();
const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');
```

2. Validate the payment link:

```ts
import {isPaymentLink} from '@reown/walletkit';

const uri = 'https://pay.walletconnect.com/...';
if (!isPaymentLink(uri)) {
  throw new Error('Not a valid WalletConnect Pay link');
}
```

3. Fetch payment options (only chains in `SUPPORTED_CHAINS` are surfaced):

```ts
const SUPPORTED_CHAINS = [
  'eip155:1',     // Ethereum
  'eip155:8453',  // Base
  'eip155:137',   // Polygon
  'eip155:42161', // Arbitrum
  'eip155:10'     // Optimism
];

const accounts = SUPPORTED_CHAINS.map((prefix) => `${prefix}:${address}`);

const options = await walletkit.pay.getPaymentOptions({
  paymentLink: uri,
  accounts,
  includePaymentInfo: true
});
```

4. Handle data collection if required (some merchants need shipping address). Render `collectData.url` in an iframe; listen for `IC_COMPLETE` / `IC_ERROR` `postMessage` events.

5. Get required actions, switch chain, sign each action:

```ts
const actions = await walletkit.pay.getRequiredPaymentActions({
  paymentId: options.paymentId,
  optionId: selectedOption.id
});

const provider = await embeddedWallet.getEthereumProvider();

const signatures = await Promise.all(
  actions.map(async (action) => {
    const {chainId, method, params} = action.walletRpc;
    const parsedParams = JSON.parse(params);
    const numericChainId = parseInt(chainId.split(':')[1], 10);
    await embeddedWallet.switchChain(numericChainId);

    switch (method) {
      case 'eth_sendTransaction':
        return await provider.request({method, params: [parsedParams[0]]});
      case 'eth_signTypedData_v4':
        return await provider.request({method, params: parsedParams});
      case 'personal_sign':
        return await provider.request({method, params: parsedParams});
      default:
        throw new Error(`Unsupported RPC method: ${method}`);
    }
  })
);
```

6. Confirm and poll:

```ts
async function confirmAndPoll(wk, paymentId, optionId, sigs) {
  let result = await wk.pay.confirmPayment({paymentId, optionId, signatures: sigs});
  while (!result.isFinal && result.pollInMs) {
    await new Promise((resolve) => setTimeout(resolve, result.pollInMs));
    result = await wk.pay.confirmPayment({paymentId, optionId, signatures: sigs});
  }
  return result;
}
```

Possible statuses: `requires_action`, `processing`, `succeeded`, `failed`, `expired`, `cancelled`.

### Supported chains and USDC addresses

| Chain | Chain ID | CAIP-2 | USDC |
|-------|----------|--------|------|
| Ethereum | 1 | `eip155:1` | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Base | 8453 | `eip155:8453` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Polygon | 137 | `eip155:137` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| Arbitrum | 42161 | `eip155:42161` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| Optimism | 10 | `eip155:10` | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` |

## Relay deposit addresses

LayerSwap-style. Request a one-time deposit address; user sends source asset to that address; Relay bridges/swaps and delivers to the destination chain.

### Step 1 - request deposit address

```bash
curl --request POST \
  --url 'https://api.relay.link/quote' \
  --header 'Content-Type: application/json' \
  --data '{
    "user": "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd",
    "originChainId": 8453,
    "originCurrency": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "destinationChainId": 10,
    "destinationCurrency": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    "tradeType": "EXACT_INPUT",
    "recipient": "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd",
    "amount": "100000000",
    "usePermit": false,
    "useExternalLiquidity": false,
    "referrer": "privy.io",
    "useDepositAddress": true,
    "refundTo": "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd"
  }'
```

Key params:

- `useDepositAddress: true` - REQUIRED to enable the deposit-address flow
- `refundTo` - REQUIRED when using deposit addresses; refunds go here if the bridge fails
- `tradeType: EXACT_INPUT` - REQUIRED for deposit addresses (exact-output not supported)
- `originCurrency` / `destinationCurrency` - use `0x0000000000000000000000000000000000000000` for native tokens

### Step 2 - extract address and request ID

```tsx
const depositAddress = quote.steps[0].depositAddress;
const requestId = quote.steps[0].requestId;
```

### Step 3 - user sends to deposit address

The deposit address is unique to this quote and cannot be reused. Once tokens land, Relay executes the bridge.

### Step 4 - poll bridge status

```tsx
const checkBridgeStatus = async (requestId: string) => {
  const response = await fetch(`https://api.relay.link/intents/status?requestId=${requestId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to check bridge status: ${response.statusText}`);
  }

  return await response.json();
};
```

## Account transfer

NOT a wallet-to-wallet flow. This is a Privy dashboard feature for consolidating two Privy ACCOUNTS owned by the same user.

### Flow (per `account-transfer.md`)

1. User is logged in to Account A.
2. User tries to link a login method (e.g. their email) that is already attached to Account B (also owned by them).
3. If "User management > Authentication > Login method transfer" is ENABLED in dashboard, Privy shows a prompt: "Transfer this login method to your current account?"
4. If the user agrees, the login method moves to Account A. Account B is DELETED.

### Critical warning

> Once the login method is transferred to the current user, the previous account will then be deleted. Please ensure that the embedded wallet associated with the previous account has either been exported or that its assets have been transferred out prior to the account deletion.

If Account B had funds, they need to be moved out FIRST or the user loses access to the orphan wallet.

### Limitation

> Currently, login method transfer is only supported when the orphan account is associated with a single login method.

If Account B has more than one login method, transfer is blocked.

## Auto-exchange (auto.exchange Privy Agent)

`auto-exchange-privy-agent.md` describes an AGENT that answers Privy integration questions, NOT an auto-swap or auto-conversion product. The agent is a developer-support tool that runs on auto.exchange. It is the Privy docs assistant.

### What it is

A chatbot hosted at `auto.exchange/agent/privy-expert/chat` with 45 knowledge files covering the full Privy docs. Charges per-query in USDC ($0.005 - $0.03 per question). Available via MCP, REST API, or web chat.

### MCP config

```json
{
  "auto.exchange": {
    "url": "https://api.auto.exchange/mcp",
    "headers": {
      "Authorization": "Bearer YOUR_API_KEY"
    }
  }
}
```

### REST

```bash
curl -X POST https://api.auto.exchange/agents/ab7527c0-6099-4145-9d8b-47f09dab9390/run \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "How do I create a server wallet and sign a transaction?"}'
```

Spectre relevance: NIL. We do not need a documentation agent integration. This is a tool for developers, not an in-app feature.

## Transfer overview

The `/transfer` wallet action is the canonical primitive for moving tokens between addresses, including bridges. Reproduced here for completeness because every funding flow (off-ramp, internal sweep, auto-bridge) ultimately routes through it.

See the "API surface" section above for the body format, supported assets, and supported chains.

### Lifecycle

1. `pending` - source-chain tx submitted, awaiting bridge fill or destination confirmation
2. `succeeded` - confirmed on destination chain (or single-chain transfer confirmed)
3. `failed` - bridge fill not completed (insufficient liquidity, expired quote, etc.)

### Webhooks

- `wallet_action.transfer.succeeded` - paid out
- `wallet_action.transfer.failed` - did not pay out

### Gas sponsorship

> If your app has gas sponsorship configured, usage of the `/transfer` endpoint will be gas-sponsored by default.

No extra parameters required.

## Code patterns (verbatim)

Most of the canonical code is inlined into the earlier sections (Card-based funding, Stripe headless, Custom fiat, WalletConnect Pay, Relay deposit, Transfer overview). What follows is Spectre-specific and the off-ramp crypto-out leg which is otherwise only implicit.

### Spectre's live `useFundWallet` handler

From `apps/research/src/pages/user-dashboard/components/ud-wallets-section.jsx`:

```jsx
const handleDeposit = useCallback(async ({ amount, asset } = {}) => {
  if (!activeWalletFromProps?.address) {
    triggerCopyToast(t('userDashboard.noWalletAvailable', 'No wallet available'))
    return
  }
  try {
    const chainId = EVM_CHAIN_IDS[activeChain]
    await fundWallet({
      address: activeWalletFromProps.address,
      options: {
        ...(chainId && { chain: { id: chainId } }),
        ...(amount && { amount: String(amount) }),
        ...(asset === 'usdc' && { asset: 'USDC' }),
        defaultFundingMethod: 'card',
      },
    })
  } catch (err) {
    if (err?.message?.includes('cancelled') || err?.message?.includes('canceled') || err?.message?.includes('closed')) return
    triggerCopyToast(err?.message || t('userDashboard.purchaseFailed', 'Purchase failed'))
  }
}, [activeWalletFromProps?.address, activeChain, fundWallet, triggerCopyToast])
```

`defaultFundingMethod: 'card'` is undocumented in `card-based-funding.md` but works at runtime and forces the modal to open straight to the card flow.

### Off-ramp - signing the crypto-out leg

EVM native (e.g. ETH to MoonPay deposit):

```tsx
import {useSendTransaction} from '@privy-io/react-auth';

const {sendTransaction} = useSendTransaction();
await sendTransaction({
  to: moonpayDepositAddress,
  value: `0x${weiAmount.toString(16)}`,
}, { address: activeWallet.address });
```

ERC-20 (e.g. USDC to Coinflow):

```tsx
const iface = new ethers.Interface(['function transfer(address to, uint256 amount)']);
const data = iface.encodeFunctionData('transfer', [coinflowDepositAddress, tokenAmount]);
await sendTransaction({ to: USDC_CONTRACT, data }, { address: activeWallet.address });
```

Solana SOL or SPL:

```tsx
import {useSignAndSendTransaction} from '@privy-io/react-auth/solana';

const {signAndSendTransaction} = useSignAndSendTransaction();
const {signature} = await signAndSendTransaction({
  transaction: tx.serialize({requireAllSignatures: false}),
  wallet,
});
```

### Inter-wallet transfer (user's own EVM wallet -> Solana wallet)

No single hook. Pattern: bridge via `/transfer` if a same-asset same-category route exists; otherwise swap first, then bridge:

```typescript
// User's EVM Privy wallet bridges USDC to their Solana Privy wallet
const response = await privy.wallets().transfer(userEvmWalletId, {
  source: { asset: 'usdc', amount: '50.0', chain: 'base' },
  destination: { address: userSolanaWalletAddress, chain: 'solana' },
});
```

`account-transfer.md` documents login-method consolidation, not fund movement.

## Spectre-specific notes

### What we have

- Research app has explicit `fundingMethodsAndOrder: { primary: ['card'], overflow: ['exchange'] }` config in `apps/research/src/lib/privy-config.js`.
- Both apps wire `useFundWallet` through the user dashboard's wallet section. Research: `apps/research/src/pages/user-dashboard/components/ud-wallets-section.jsx`. Trading: `apps/trading/src/components/UserDashboard/UdWalletSection.jsx`.
- The research app's `handleDeposit` passes `defaultFundingMethod: 'card'` to force the card flow open.

### What we do NOT have

- Trading app does NOT have an explicit `fundingMethodsAndOrder` block - inherits Privy dashboard defaults. **GAP**: configs diverge between apps; the trading app could surprise users with non-card options if dashboard defaults shift.
- Neither app has a top-level Buy / Add Funds button on the home page or in the header.
- We do NOT integrate Stripe headless onramp (private beta, US-first, not aligned with Spectre's global research-first audience).
- We do NOT have an off-ramp. Crypto goes IN; the only way OUT is the wallet's withdraw flow (manual address paste via `useSendTransaction`).
- We do NOT have WalletConnect Pay - users cannot pay external WC links from their Privy wallet inside Spectre.
- We do NOT have account-transfer UI (login method consolidation). If a user signs up twice with different methods we cannot merge their accounts in-app.
- We do NOT use the Privy Agent / auto.exchange agent - that is a docs assistant, not a product feature.
- We do NOT use Relay deposit addresses for cross-chain funding. Bridge flows happen inside Jupiter / 0x swap quotes, not via Relay.
- We do NOT use Bridge Cards (debit card issuance). Out of scope for an intelligence platform.

### Implications for the audit

1. **Quick win - Buy button on the user dashboard.** `handleDeposit` already exists in `ud-wallets-section.jsx`. Surfacing it in the dashboard hero would let users fund without going to the wallet sub-tab.
2. **Quick win - parity on `fundingMethodsAndOrder`.** Copy the research config block into `apps/trading/src/lib/privy-config.js` (or equivalent) so both apps behave identically.
3. **Medium - card funding on Solana mainnet.** Spectre is Solana-first for swaps. Verify the Privy dashboard has card funding enabled for Solana mainnet, with a sensible default amount (e.g. $50).
4. **Medium - off-ramp.** Add Coinflow or MoonPay off-ramp behind a "Sell" button on the dashboard wallet section. Coinflow has the fastest US settlement and matches our existing MoonPay relationship.
5. **Medium - WalletConnect Pay.** Lets power users pay Spectre-internal upgrade fees or external commerce from the embedded wallet without switching to Phantom.
6. **Low - Relay for cross-chain top-up.** If a user has USDC on Base but wants SOL on Solana, today they would have to use Jupiter twice. A Relay deposit-address flow could collapse this to one step.
7. **Low - Bridge Cards.** Not strategic, no demand signal, skip.

### Code locations

- Research funding UI: `apps/research/src/pages/user-dashboard/components/ud-wallets-section.jsx` (lines ~333-416 for the hook + handler)
- Research Privy config: `apps/research/src/lib/privy-config.js` (lines 76-80 for `fundingMethodsAndOrder`)
- Trading funding UI: `apps/trading/src/components/UserDashboard/UdWalletSection.jsx` (lines ~310-368)
- Trading Privy config: `apps/trading/src/lib/privy-config.js` (no `fundingMethodsAndOrder` block, **GAP**)

## Gotchas & pitfalls

- `useFundWallet()` opens a Privy modal at z-index ~10000. If Spectre's own modals (search, monarch chat, day-mode picker) use higher z-indices, they will overlay the Privy modal. Use the modal-stack pattern: only one in-app modal open at a time, and dismiss it before calling `fundWallet`.
- Card on-ramp is MAINNET ONLY. Testnets like Sepolia or Polygon Amoy will either hide the option or fail silently. If a dev is testing on testnet and "card funding doesn't work", that is expected.
- Stripe Crypto is currently US-first and stablecoin-only. International users get rejected with `location_not_supported`. Always have a fallback (MoonPay or Coinbase) for non-US users.
- MoonPay quotes include a non-trivial fee (~3-6% on card). Surface this BEFORE the user enters the flow; many users assume "I'm buying $100 of ETH" means they get $100 of ETH.
- Solana onramps support a limited token list. SOL, USDC, USDT, BONK are usually available; the long tail (SPECTRE, mid-cap memes) is not. Check provider tokenlists at integration time.
- Off-ramp settlement to bank requires KYC + bank account verification (multi-step, multi-day for the first time). Make this clear in UI so users don't expect a 30-second flow.
- Relay deposit addresses are NOT user-controlled. If Relay goes down mid-bridge, funds may need manual recovery via Relay support. The `refundTo` param is the user's safety net.
- Account transfer DELETES the orphan account. Always tell the user "your other wallet will be removed" and ensure they have exported keys / drained funds.
- `fundingMethodsAndOrder` differs between Spectre's research and trading apps. Until parity is added, behavior is inconsistent.
- The `fundingMethods` block was renamed: older Privy SDK versions used `fundingMethods`; modern versions use `fundingMethodsAndOrder`. Spectre uses the modern name. Verify any copy-pasted snippet matches the installed SDK version.
- `defaultFundingMethod: 'card'` (used by Spectre research) is an UNDOCUMENTED OPTION in `card-based-funding.md`. It works at runtime but is not in the public API surface; treat it as semi-stable and snapshot the SDK version that supports it.
- `useFundWallet` is one of the four hooks that crash before Privy hydrates (see `solana-web3.md` section A). Defer to a child component that mounts only after the user navigates to the funding UI.
- The Privy `fundWallet` Promise resolves when the MODAL closes, NOT when funds arrive. Always treat it as fire-and-forget; the authoritative success signal is the `funding-event` webhook server-side. Polling wallet balance is a poor proxy because confirmations vary by chain.
- The `wallet_action.transfer.succeeded` webhook fires for SUCCEEDED transfers but the analogous on-ramp event is delivered by the third-party provider (MoonPay, Stripe) through their own webhook system. Spectre's webhook handler needs both.
- Bridge transfers via `/transfer` only work for "well-known assets" (`usdc`, `usdt`, `usdg`, `eth`, etc.). Custom tokens via `asset_address` cannot be bridged. For arbitrary tokens, swap on the source chain first.
- Cross-category swaps are not supported by the bridge - you cannot bridge ETH on Base directly to USDC on Ethereum in one `/transfer` call. Do the swap and the bridge as two steps.

## Cross-references

- Wallet creation (the target of funding) -> `02-embedded-wallets.md`
- Sending transactions after funding (manual transfer out, off-ramp leg) -> `04-signing-and-transactions.md`
- Swap after funding (e.g. on-ramp USDC then swap to SOL) -> `06-swaps-and-trading.md`
- Webhooks for funding confirmation (`funding-event.succeeded`, `wallet_action.transfer.succeeded`) -> `11-security-and-webhooks.md`
- UI customization of the funding modal (theme, appearance) -> `09-ui-and-customization.md`
- Errors during funding (cancel, declined, location_not_supported) -> `14-errors-and-troubleshooting.md`
- Privy provider setup, the `getAccessToken` ref pattern, hook hydration gotchas -> root `.claude/rules/solana-web3.md` section A
