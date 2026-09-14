---
paths:
  - "apps/*/src/services/walletService.js"
  - "apps/*/src/hooks/useWalletBalance*.js"
  - "apps/*/src/hooks/useSwapExecution.js"
  - "apps/*/src/lib/privy-*.js"
  - "apps/*/src/pages/user-dashboard/components/ud-wallets-*"
  - "apps/*/src/components/UserDashboard/UdWalletSection*"
---

# Solana & EVM Wallet Rules

---

## A. Privy Integration

Privy setup, hooks, provider config, hydration gotchas, `getAccessToken` useRef pattern, error boundaries, and `walletConnected` vs `walletReady` semantics now live in [`.claude/rules/privy.md`](./privy.md) (master rules file) and the deep-dive knowledge base at `.claude/knowledge/privy/`. Read those when working on anything Privy-touching.

Quick pointers:
- Master rules: [.claude/rules/privy.md](./privy.md)
- Validated Spectre patterns: [.claude/knowledge/privy/spectre/patterns.md](../knowledge/privy/spectre/patterns.md)
- Current Spectre integration snapshot: [.claude/knowledge/privy/spectre/current-implementation.md](../knowledge/privy/spectre/current-implementation.md)
- Audit backlog: [.claude/knowledge/privy/spectre/audit-gaps.md](../knowledge/privy/spectre/audit-gaps.md)
- Knowledge base index: [.claude/knowledge/privy/INDEX.md](../knowledge/privy/INDEX.md)

This file (`solana-web3.md`) keeps the chain / wallet-service rules below: supported chains, Multicall3 batching, Solana patterns (Buffer polyfill, ATA, SPL transfer), swap execution at the service layer, gas reserves, networkId mapping, token registry. These apply regardless of which auth provider sits in front.

---

## B. Supported Chains

| Chain | Chain ID | Codex networkId | RPC Env Var | Public Fallback |
|-------|----------|-----------------|-------------|-----------------|
| Ethereum | 1 | 1 | `VITE_ETH_RPC_URL` | `https://eth.llamarpc.com` |
| BSC | 56 | 56 | `VITE_BSC_RPC_URL` | `https://bsc-dataseed.binance.org` |
| Polygon | 137 | 137 | `VITE_POLYGON_RPC_URL` | `https://polygon-rpc.com` |
| Arbitrum | 42161 | 42161 | `VITE_ARB_RPC_URL` | `https://arb1.arbitrum.io/rpc` |
| Base | 8453 | 8453 | `VITE_BASE_RPC_URL` | `https://mainnet.base.org` |
| Solana | N/A | **1399811149** | `VITE_SOLANA_RPC_URL` | `https://api.mainnet-beta.solana.com` |

**Solana networkId = 1399811149** is Codex's internal ID, not a real chain ID. This appears everywhere in networkId-to-chain mappings.

---

## C. EVM Wallet Patterns

### Multicall3 Batching (Research App - Reference Implementation)

```js
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'
// Same address on ALL major EVM chains (Ethereum, BSC, Polygon, Arbitrum, Base)
```

Encodes `getEthBalance(address)` + `balanceOf(address)` for each token into a single `aggregate3()` call. Falls back to parallel individual calls if Multicall3 reverts.

ERC-20 calldata is hand-encoded (no ABI overhead):
```js
const BALANCE_OF_SELECTOR = '0x70a08231'
const paddedAddress = address.slice(2).toLowerCase().padStart(64, '0')
const balanceOfCalldata = BALANCE_OF_SELECTOR + paddedAddress
```

**Critical**: the trading app `walletService.js` does sequential `Promise.all` calls instead of Multicall3. This is slower and more rate-limit-prone. Use the research app version as reference for new code.

### EVM Withdrawal

```js
// Native ETH/BNB/MATIC
const weiAmount = BigInt(Math.round(parseFloat(amount) * 1e18)).toString(16)
await sendTransaction({ to, value: `0x${weiAmount}` }, { address: activeWallet.address })

// ERC-20
const iface = new ethers.Interface(['function transfer(address to, uint256 amount)'])
const data = iface.encodeFunctionData('transfer', [toAddress, tokenAmount])
await sendTransaction({ to: token.contractAddress, data }, { address: activeWallet.address })
```

### ERC-20 Approval (Swap Flow)

Uses `ethers.MaxUint256` (approve-max, one-time per token per user). Skip for native token sentinel `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`.

---

## D. Solana Wallet Patterns

### Buffer Polyfill (MUST be first import)

```js
// main.jsx - FIRST TWO LINES, before any other imports
import { Buffer } from 'buffer'
window.Buffer = Buffer
```

Solana web3.js requires this in browser environments. If missing, you get `Buffer is not defined` at runtime.

### SPL Token Balance Lookup

```js
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
const ata = getAssociatedTokenAddressSync(mint, wallet)  // derives ATA deterministically
const info = await connection.getTokenAccountBalance(ata)
```

If the ATA does not exist, `getTokenAccountBalance` throws `"could not find"` - catch this and return `{ balance: 0 }`. This is expected for tokens the user has never held.

### SPL Token Transfer

Check if destination ATA exists first. If not, add a `createAssociatedTokenAccountInstruction` to the transaction:

```js
try {
  await getAccount(connection, destAta)
} catch {
  tx.add(createAssociatedTokenAccountInstruction(payer, destAta, recipient, mint))
}
tx.add(createTransferInstruction(sourceAta, destAta, owner, amount))
```

### Solana Connection Pooling

```js
// walletService.js - singleton pattern
const providerCache = new Map()

function getSolanaConnection() {
  if (providerCache.has('solana')) return providerCache.get('solana')
  const conn = new Connection(SOLANA_RPC_URL, 'confirmed')
  providerCache.set('solana', conn)
  return conn
}
```

**NEVER** create `new Connection(...)` per request or per component. Always use the cached singleton. The same pattern applies to ethers `JsonRpcProvider` instances (keyed by chainId).

### Solana Balance in Header

Privy Solana wallets expose `signTransaction` but NOT RPC directly. The header balance uses `/api/solana-balance?address=` (server proxy) to avoid CORS issues with public RPC endpoints. Do not attempt `connection.getBalance()` from the frontend for header display.

### Known Solana Stablecoin Mints

```
USDT: Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

---

## E. Swap Execution Flow

```
useSwapExecution (hook)
  -> getSwapParams() - normalizes token/chain/amount
  -> fetchQuote() -> POST /api/swap/quote (server, 400ms debounce)
       -> Jupiter API (Solana) or 0x Permit2 API (EVM)
       -> returns { swapTransaction (base64), provider, chain, ... }
  -> doSwap()
       -> stale quote guard (input/output still match UI?)
       -> executeSolanaSwap | executeEvmSwap
       -> waitForConfirmation(hash, chain, 60000ms)
```

### Jupiter (Solana) Execution

```js
const provider = await wallet.getProvider()  // Solana provider, NOT getEthereumProvider()
const txBuf = Buffer.from(quote.swapTransaction, 'base64')  // Jupiter v6 API returns base64
const { signature } = await provider.signAndSendTransaction({ serializedTransaction: txBuf })
```

### 0x (EVM) Execution

```js
const provider = await wallet.getEthersProvider()  // EVM provider, NOT getProvider()
const signer = await provider.getSigner()
await ensureTokenApproval(signer, quote.inputToken, quote.allowanceTarget, quote.inputAmount)
const tx = await signer.sendTransaction({ to, data, value, gasLimit, gasPrice })
```

### Slippage

Default: `slippageBps = 50` (0.5%). Hardcoded in `RightPanel.jsx`. No client-side max-slippage validation exists.

### Quote Staleness Guard

Before executing, check that the quote's tokens still match the UI:
```js
if (quote.inputToken !== expectedInput || quote.outputToken !== expectedOutput) {
  setSwapError('Quote expired - enter your amount again')
  setQuote(null)
  return null
}
```

### Fee Config

Platform fee loaded lazily via `GET /api/fee-config`. Cached 5 minutes. Default fallback: `{ feePercentage: 1.0, feeBps: 100 }`. The server injects the fee recipient into the Jupiter/0x call server-side - the frontend never handles fee addresses.

---

## F. Transaction Confirmation

`waitForConfirmation(hash, chain, timeoutMs = 60000)` - polls every 2 seconds:

- **Solana**: checks `confirmationStatus === 'confirmed' || 'finalized'`, treats `status.value.err` as failure
- **EVM**: checks `receipt.status === 1` (1 = success, 0 = reverted)
- **Timeout**: throws `'Transaction confirmation timeout'` after 60s

### Cancelled Transaction Detection

Both apps silently ignore user-cancelled transactions:
```js
if (err?.message?.includes('cancelled') ||
    err?.message?.includes('canceled') ||
    err?.message?.includes('rejected')) {
  return { success: false, error: 'Transaction cancelled' }
}
```

---

## G. Gas Reserves

Hardcoded in `UdWalletSection.jsx`:

| Chain | Reserve | Why |
|-------|---------|-----|
| Solana (native SOL) | 0.01 SOL | Covers tx fees + rent exemption |
| EVM (native ETH/BNB/MATIC) | 0.001 of native token | Covers gas |
| ERC-20 / SPL tokens | 0 (full balance) | Gas paid in native token |

```js
const reserve = activeChain === 'solana' ? 0.01 : 0.001
const max = Math.max(0, availableBalance - reserve)
```

---

## H. networkId to Chain Slug Mapping

Used throughout hooks and services:

```js
const NETWORK_MAP = {
  1399811149: 'solana',
  56: 'bsc',
  137: 'polygon',
  42161: 'arbitrum',
  8453: 'base',
  1: 'ethereum',  // default
}
```

The `networkIdToChainSlug` utility is exported from `useWalletBalances.js` in both apps.

---

## I. Token Registry (`packages/server/lib/token-registry.js`)

CommonJS module (`module.exports`). Frontend uses `majorTokens.js` instead.

```js
TOKEN_REGISTRY['SYMBOL'] = {
  address,        // contract address (null for CEX-only: XRP, ADA, AVAX)
  networkId,      // numeric chain ID (1399811149 for Solana)
  binanceSymbol,  // 'ETHUSDT' (null for DEX-only: SPECTRE, stablecoins)
  coingeckoId,    // optional
  name,
  decimals,       // optional
}
```

Every token must have EITHER `address` + `networkId` (for Codex DEX data) OR `binanceSymbol` (for price feed). Tokens with `address: null` are CEX-only. Tokens with `binanceSymbol: null` are DEX-only.

---

## J. EVM Native Token Sentinel

`0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` is the 0x protocol sentinel for native ETH. Skip approval check for this address.

The research app's `walletService.js` uses `address: 'native'` for internal representation. These two conventions coexist and must be mapped when crossing the service/hook boundary.

---

## K. Auth vs Wallet

The app has TWO separate auth layers:

1. **AuthGate** (`auth-gate.jsx`) - team password gate (`sessionStorage`). NOT Privy. Bypassed automatically on localhost/dev.
2. **Privy** - wallet + identity layer. Optional (app runs without `VITE_PRIVY_APP_ID`). Used for signing transactions and profile sync.

Do not confuse these. A user can be past the AuthGate but not connected to Privy (and vice versa in theory).

---

## L. Wallet Balance Hooks

Two hooks, different purposes:

| Hook | File | Purpose | Poll interval | Cache |
|------|------|---------|---------------|-------|
| `useWalletBalance` (singular) | `hooks/useWalletBalance.js` | USD total for header | 30s | `priceCache` 60s TTL |
| `useWalletBalances` (plural) | `hooks/useWalletBalances.js` | Per-token array for swap UI | 15s | Map, 30s TTL, max 20 entries (research only) |

The singular hook uses `/api/solana-balance` server proxy for SOL. The plural hook calls `walletService.getWalletBalances()` which does Multicall3 (research) or sequential calls (trading).
