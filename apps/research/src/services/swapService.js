/**
 * Swap Service
 * Handles swap quotes and execution via Jupiter (Solana) and 0x (EVM).
 * The server proxies API calls to hide keys; signing happens client-side via Privy.
 *
 * Flow:
 *   1. getSwapQuote() -> server -> Jupiter/0x -> returns quote + unsigned tx
 *   2. executeSwap() -> signs tx with Privy wallet -> submits on-chain
 *   3. waitForConfirmation() -> polls for tx confirmation
 */
import { CHAINS, getSolanaConnection } from '@/services/walletService'
import { getAuthToken } from '@/services/profileSync'

// -- Fee config cache --
let feeConfigCache = null
let feeConfigExpiry = 0

/**
 * Fetch platform fee configuration from server.
 */
export async function getFeeConfig() {
  if (feeConfigCache && Date.now() < feeConfigExpiry) return feeConfigCache
  try {
    const res = await fetch('/api/fee-config')
    if (!res.ok) throw new Error(`Fee config fetch failed: ${res.status}`)
    feeConfigCache = await res.json()
    feeConfigExpiry = Date.now() + 5 * 60 * 1000 // Cache 5 min
    return feeConfigCache
  } catch (err) {
    console.error('[swapService] getFeeConfig error:', err.message)
    // Fallback shape matches the public /api/fee-config response (post-2026-05-22
    // privacy update: no collector/feeRecipient field - addresses are server-only).
    return { fee: { bps: 100, percentage: 1.0 }, feePercentage: 1.0, feeBps: 100 }
  }
}

// -- Chain slug mapping --
const NETWORK_TO_CHAIN = {
  1: 'ethereum',
  56: 'bsc',
  137: 'polygon',
  42161: 'arbitrum',
  8453: 'base',
  1399811149: 'solana',
}

// -- Slippage bounds (defense in depth) --
// Hooks already clamp, but anyone who calls getSwapQuote/getQuotePreview
// directly bypasses that. 1 bps = 0.01%, 5000 bps = 50%. Anything outside
// that window is treated as a programming error and clamped.
const MIN_SLIPPAGE_BPS = 1
// 2026-05-12 hardening: was 5000 (50% slippage cap). Hook + server both
// clamp at 500 (5%) so the 5000 ceiling was effectively dead code, but
// if anything ever bypassed the hook and called the service directly,
// users could sign 50%-slippage swaps — sandwich-bot bait. Set all 3
// layers (hook, service, server) to 500 so defense-in-depth is real.
const MAX_SLIPPAGE_BPS = 500

function safeSlippage(input) {
  const n = Number(input)
  if (!Number.isFinite(n)) return 50
  return Math.min(Math.max(Math.floor(n), MIN_SLIPPAGE_BPS), MAX_SLIPPAGE_BPS)
}

/**
 * Get a lightweight quote preview (no transaction data).
 * Used for showing gas estimates and price impact before execution.
 *
 * @param {Object} params
 * @param {string} params.chainId - Chain slug or networkId number
 * @param {string} params.inputToken - Token address/mint
 * @param {string} params.outputToken - Token address/mint
 * @param {string} params.amount - Amount in smallest units
 * @param {number} [params.slippageBps=50] - Slippage tolerance in basis points
 * @returns {Promise<Object>} Quote preview with gas/impact data (no tx payload)
 */
export async function getQuotePreview({ chainId, inputToken, outputToken, amount, slippageBps = 50 }) {
  const chain = typeof chainId === 'number' ? (NETWORK_TO_CHAIN[chainId] || 'ethereum') : chainId
  const res = await fetch('/api/swap/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chainId: chain,
      inputToken,
      outputToken,
      amount: amount.toString(),
      slippageBps: safeSlippage(slippageBps),
      // No userAddress = quote-only mode, no transaction data
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Preview failed' }))
    throw new Error(err.error || `Preview failed (${res.status})`)
  }
  return res.json()
}

/**
 * Get a swap quote from the server.
 *
 * @param {Object} params
 * @param {string} params.chainId - Chain slug ('ethereum', 'solana', etc.) or networkId number
 * @param {string} params.inputToken - Token address/mint (or 'native' for native token)
 * @param {string} params.outputToken - Token address/mint (or 'native')
 * @param {string} params.amount - Amount in smallest units (wei/lamports)
 * @param {number} [params.slippageBps=50] - Slippage tolerance in basis points
 * @param {string} [params.userAddress] - User's wallet address (needed for tx data)
 * @returns {Promise<Object>} Quote with transaction data
 */
export async function getSwapQuote({ chainId, inputToken, outputToken, amount, slippageBps = 50, userAddress }) {
  // Normalize chainId
  const chain = typeof chainId === 'number' ? (NETWORK_TO_CHAIN[chainId] || 'ethereum') : chainId

  const res = await fetch('/api/swap/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chainId: chain,
      inputToken,
      outputToken,
      amount: amount.toString(),
      slippageBps: safeSlippage(slippageBps),
      userAddress,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Quote request failed' }))
    throw new Error(err.error || err.details || `Quote failed (${res.status})`)
  }

  return res.json()
}

/**
 * Execute a swap using the quote's transaction data.
 * Signs and submits the transaction via the Privy wallet.
 *
 * @param {Object} wallet - Privy wallet object (from useWallets())
 * @param {Object} quote - Quote response from getSwapQuote()
 * @returns {Promise<string>} Transaction hash
 */
export async function executeSwap(wallet, quote, helpers = {}) {
  if (!wallet) throw new Error('No wallet connected')
  if (!quote) throw new Error('No quote provided')

  if (quote.provider === 'jupiter') {
    return await executeSolanaSwap(wallet, quote, helpers)
  } else if (quote.provider === '0x') {
    return await executeEvmSwap(wallet, quote)
  }

  throw new Error(`Unknown swap provider: ${quote.provider}`)
}

/**
 * Execute Solana swap via Jupiter.
 * The quote contains a serialized transaction that needs signing.
 */
async function executeSolanaSwap(wallet, quote, helpers = {}) {
  if (!quote.swapTransaction) {
    throw new Error('No swap transaction in quote - request quote with userAddress')
  }

  try {
    // The swapTransaction from Jupiter is a base64-encoded versioned tx.
    const txBytes = Uint8Array.from(Buffer.from(quote.swapTransaction, 'base64'))

    let signature
    if (typeof helpers.solanaSignAndSend === 'function') {
      // Privy v3 blessed path - useSignAndSendTransaction hook (the wallet
      // object's own method routes through the wallet-standard CONNECT
      // ceremony, which rejects embedded wallets).
      const out = await helpers.solanaSignAndSend({
        transaction: txBytes,
        wallet,
        chain: 'solana:mainnet',
      })
      const bs58 = (await import('bs58')).default
      signature = typeof out.signature === 'string' ? out.signature : bs58.encode(out.signature)
    } else {
      // Legacy (pre-v3) Privy Solana wallet shape - kept as fallback.
      const provider = await wallet.getProvider()
      const res = await provider.signAndSendTransaction({
        serializedTransaction: Buffer.from(quote.swapTransaction, 'base64'),
      })
      signature = res.signature
    }

    // Log the swap
    logSwap({
      chainId: 'solana',
      txHash: signature,
      inputToken: quote.inputToken,
      outputToken: quote.outputToken,
      inputAmount: quote.inputAmount,
      outputAmount: quote.outputAmount,
    })

    return signature
  } catch (err) {
    console.error('[swapService] Solana swap failed:', err)
    throw new Error(err.message || 'Solana swap failed')
  }
}

// 0x v2 routes every ERC-20 sell through the canonical Permit2 singleton.
// The token must hold a standing ERC-20 allowance to this address; the
// per-swap permit signature (amount + deadline) is the real authorization.
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const EVM_NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

// quote.chain -> EVM chain numeric ID. Used to verify the EIP-712 domain
// chainId matches what we expect (defense in depth against a tampered
// quote that targets a different chain).
const EVM_CHAIN_NUMERIC_ID = {
  ethereum: 1,
  bsc: 56,
  polygon: 137,
  arbitrum: 42161,
  base: 8453,
}

/**
 * 0x v2 packs the off-chain Permit2 signature onto the end of the swap
 * calldata as: existing data + uint256(signatureByteLength) + signature.
 * Pure + exported so it can be unit-tested without a wallet.
 */
export function appendPermit2Signature(calldata, signature) {
  const sigByteLen = (signature.length - 2) / 2
  const sigLengthWord = sigByteLen.toString(16).padStart(64, '0')
  return calldata + sigLengthWord + signature.slice(2)
}

/**
 * Defense-in-depth (P1, 2026-05-22): before signing the Permit2 EIP-712
 * payload, validate every critical field matches the quote the user saw.
 * A compromised 0x response (or any tampering between server and client)
 * could otherwise swap `spender` for a drainer contract, `token` for one
 * we own, or `amount` for MaxUint160 -> user signs an unlimited approval
 * to an attacker. Privy's modal displays the typed-data struct but it is
 * opaque to most users; this is the programmatic check.
 *
 * Throws with a "Quote tampered" prefix on any mismatch. Assumes 0x v2
 * PermitSingle structure: { details: { token, amount, ... }, spender, sigDeadline }.
 *
 * Exported so it can be unit-tested without a wallet.
 */
export function assertSafePermit2EIP712(eip712, quote) {
  if (!eip712 || !eip712.domain || !eip712.message) {
    throw new Error('Quote tampered: malformed Permit2 EIP-712 payload')
  }

  const vc = (eip712.domain.verifyingContract || '').toLowerCase()
  if (vc !== PERMIT2_ADDRESS.toLowerCase()) {
    throw new Error('Quote tampered: Permit2 EIP-712 verifyingContract mismatch')
  }

  const expectedChainId = EVM_CHAIN_NUMERIC_ID[quote.chain]
  if (expectedChainId && Number(eip712.domain.chainId) !== expectedChainId) {
    throw new Error(`Quote tampered: Permit2 EIP-712 chainId mismatch (expected ${expectedChainId}, got ${eip712.domain.chainId})`)
  }

  const msg = eip712.message
  const details = msg.details
  if (!details) {
    throw new Error('Quote tampered: Permit2 EIP-712 missing details')
  }

  const permitToken = (details.token || '').toLowerCase()
  const inputToken = (quote.inputToken || '').toLowerCase()
  if (permitToken !== inputToken) {
    throw new Error('Quote tampered: Permit2 EIP-712 token does not match quote.inputToken')
  }

  try {
    if (BigInt(details.amount) < BigInt(quote.inputAmount)) {
      throw new Error('Quote tampered: Permit2 EIP-712 amount below swap input')
    }
  } catch (e) {
    if (/tampered/.test(e.message)) throw e
    throw new Error('Quote tampered: Permit2 EIP-712 amount not parseable')
  }

  const permitSpender = (msg.spender || '').toLowerCase()
  const txTo = (quote.transaction?.to || '').toLowerCase()
  if (!txTo || permitSpender !== txTo) {
    throw new Error('Quote tampered: Permit2 EIP-712 spender does not match swap transaction.to')
  }

  const now = Math.floor(Date.now() / 1000)
  const sigDeadline = Number(msg.sigDeadline)
  if (!Number.isFinite(sigDeadline) || sigDeadline <= now) {
    throw new Error('Quote tampered: Permit2 EIP-712 sigDeadline is in the past')
  }
  if (sigDeadline > now + 30 * 60) {
    throw new Error('Quote tampered: Permit2 EIP-712 sigDeadline too far in future')
  }
}

/**
 * Execute EVM swap via 0x v2 (Permit2).
 *
 * The server returns `transaction` ({ to, data, value, gas }) plus, for
 * ERC-20 sells, `permit2.eip712` - an EIP-712 payload the user must sign.
 * 0x v2 requires that off-chain signature to be APPENDED to the calldata as
 * (uint256 sigLength) + signature; without it the settlement contract cannot
 * pull the tokens and the tx reverts (burning gas). Native sells (ETH/BNB ->
 * token) carry no permit2 and send the calldata as-is.
 */
// Chain slugs (quote.chain) -> numeric EVM chain ids. Mirror of trading's
// swapService - keep in sync.
const EVM_SWAP_CHAIN_IDS = { ethereum: 1, base: 8453, polygon: 137, arbitrum: 42161, bsc: 56 }

async function executeEvmSwap(wallet, quote) {
  if (!quote.transaction) {
    throw new Error('No transaction data in quote - request quote with userAddress')
  }

  try {
    // Pin the wallet to the QUOTE's chain before signing anything. The Privy
    // ethers provider signs on the wallet's CURRENT chain (Ethereum by
    // default) - without this switch, a Base/Polygon/Arbitrum/BSC swap
    // broadcasts on mainnet: reverted approval, wasted gas, or worse.
    const targetChainId = EVM_SWAP_CHAIN_IDS[quote.chain]
    if (!targetChainId) {
      throw new Error(`Unsupported swap chain: ${quote.chain}`)
    }
    await wallet.switchChain(targetChainId)

    // Privy v3 exposes an EIP-1193 provider (getEthereumProvider); the old
    // getEthersProvider() no longer exists. Wrap with ethers v6 BrowserProvider.
    const eip1193 = await wallet.getEthereumProvider()
    const { ethers } = await import('ethers')
    const provider = new ethers.BrowserProvider(eip1193)
    const signer = await provider.getSigner()

    // Defense in depth: the signer must actually be on the quote's chain.
    const signerNet = await provider.getNetwork()
    const signerChainId = Number(signerNet?.chainId ?? signerNet)
    if (signerChainId !== targetChainId) {
      throw new Error(`Wallet is on chain ${signerChainId}, expected ${targetChainId} - switch networks and retry`)
    }

    let data = quote.transaction.data

    if (quote.permit2?.eip712) {
      // ERC-20 sell. Permit2 needs a one-time ERC-20 allowance to act as the
      // transfer router, then the per-swap permit signature is appended.
      const inputIsNative =
        (quote.inputToken || '').toLowerCase() === EVM_NATIVE_SENTINEL.toLowerCase()
      if (!inputIsNative) {
        await ensurePermit2Approval(signer, quote.inputToken, quote.inputAmount)
      }

      const { eip712 } = quote.permit2
      // Defense in depth (P1, 2026-05-22): verify the EIP-712 payload
      // matches the quote BEFORE signing. Throws "Quote tampered..." on
      // any mismatch; caller surfaces to user as a retry-quote error.
      assertSafePermit2EIP712(eip712, quote)
      // ethers v6 signTypedData rejects an explicit EIP712Domain entry in types.
      const { EIP712Domain, ...types } = eip712.types || {}
      const signature = await signer.signTypedData(eip712.domain, types, eip712.message)

      // Append: 32-byte big-endian signature length, then the raw signature.
      data = appendPermit2Signature(data, signature)
    }

    // Send the swap transaction
    const tx = await signer.sendTransaction({
      to: quote.transaction.to,
      data,
      value: quote.transaction.value || '0',
      gasLimit: quote.transaction.gas,
      gasPrice: quote.transaction.gasPrice,
    })

    // Log the swap
    logSwap({
      chainId: quote.chain,
      txHash: tx.hash,
      inputToken: quote.inputToken,
      outputToken: quote.outputToken,
      inputAmount: quote.inputAmount,
      outputAmount: quote.outputAmount,
    })

    return tx.hash
  } catch (err) {
    console.error('[swapService] EVM swap failed:', err)
    throw new Error(err.message || 'EVM swap failed')
  }
}

/**
 * Ensure the canonical Permit2 contract holds an ERC-20 allowance for this
 * token. Approves MaxUint256 once per token (the standard 0x v2 / Uniswap
 * pattern): the per-swap permit signature - scoped to an amount and deadline -
 * is the actual transfer authorization, so a standing max allowance to the
 * audited Permit2 singleton does not by itself let funds be drained. Skips
 * the approve tx when the existing allowance already covers this swap.
 */
async function ensurePermit2Approval(signer, tokenAddress, amount) {
  const { ethers } = await import('ethers')
  const erc20 = new ethers.Contract(
    tokenAddress,
    ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'],
    signer,
  )

  const owner = await signer.getAddress()
  const current = await erc20.allowance(owner, PERMIT2_ADDRESS)
  if (current >= BigInt(amount)) return // Already approved enough

  const tx = await erc20.approve(PERMIT2_ADDRESS, ethers.MaxUint256)
  await tx.wait()
}

/**
 * Fast-path confirmation check: read the tx status the Privy webhook recorded
 * in KV (GET /api/swap/tx-status?hash=...). Returns the stored status object
 * or null if the webhook hasn't seen this tx. Never throws - returns null on
 * any failure so the caller falls through to RPC polling.
 */
async function getServerTxStatus(txHash) {
  try {
    const res = await fetch(`/api/swap/tx-status?hash=${encodeURIComponent(txHash)}`, {
      // 1500ms cap: runs before each 2s RPC poll, must not starve RPC checks.
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.status || null
  } catch {
    return null
  }
}

/**
 * Wait for a transaction to confirm.
 *
 * @param {string} txHash - Transaction hash
 * @param {string} chainId - Chain slug
 * @param {number} [timeoutMs=60000] - Max wait time
 * @returns {Promise<Object>} Transaction receipt
 */
export async function waitForConfirmation(txHash, chainId, timeoutMs = 60000) {
  const chain = typeof chainId === 'number' ? (NETWORK_TO_CHAIN[chainId] || 'ethereum') : chainId

  if (chain === 'solana') {
    return await waitSolanaConfirmation(txHash, timeoutMs)
  }
  return await waitEvmConfirmation(txHash, chain, timeoutMs)
}

async function waitSolanaConfirmation(signature, timeoutMs) {
  // Reuse the cached singleton from walletService - never create a new
  // Connection per call (rate limits, wasted handshakes).
  const connection = getSolanaConnection()

  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    // Fast-path: the Privy webhook may have already recorded confirmation in
    // KV before our RPC poll catches it. Falls through to RPC if KV is empty.
    const wh = await getServerTxStatus(signature)
    if (wh?.status === 'confirmed') return { confirmed: true, signature, status: 'confirmed', source: 'webhook' }
    if (wh?.status === 'failed' || wh?.status === 'reverted') return { confirmed: false, signature, error: wh.error || wh.status, source: 'webhook' }

    try {
      const status = await connection.getSignatureStatus(signature)
      if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
        return { confirmed: true, signature, status: status.value.confirmationStatus }
      }
      if (status?.value?.err) {
        return { confirmed: false, signature, error: status.value.err }
      }
    } catch {
      // Ignore transient errors
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error('Transaction confirmation timeout')
}

async function waitEvmConfirmation(txHash, chainId, timeoutMs) {
  const chainConfig = CHAINS[chainId]
  if (!chainConfig) throw new Error(`Unknown chain: ${chainId}`)

  const { ethers } = await import('ethers')
  const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl)

  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    // Fast-path: webhook-recorded status in KV (see waitSolanaConfirmation).
    const wh = await getServerTxStatus(txHash)
    if (wh?.status === 'confirmed') return { confirmed: true, txHash, blockNumber: wh.blockNumber || null, source: 'webhook' }
    if (wh?.status === 'failed' || wh?.status === 'reverted') return { confirmed: false, txHash, error: wh.error || wh.status, source: 'webhook' }

    try {
      const receipt = await provider.getTransactionReceipt(txHash)
      if (receipt) {
        return {
          confirmed: receipt.status === 1,
          txHash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed?.toString(),
        }
      }
    } catch {
      // Ignore transient errors
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error('Transaction confirmation timeout')
}

// Generate a UUID v4 idempotency key. See trading/swapService.js for the
// same helper; copies kept inline to avoid a cross-app shared dependency.
function makeIdempotencyKey() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Log a completed swap to the server for analytics and history.
 * Includes auth token when available for persistent KV storage.
 * Idempotency key prevents double-logging if the POST is retried.
 */
function logSwap({ chainId, txHash, inputToken, outputToken, inputAmount, outputAmount }) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Idempotency-Key': makeIdempotencyKey(),
  }
  const token = getAuthToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  fetch('/api/swap/log', {
    method: 'POST',
    headers,
    body: JSON.stringify({ chainId, txHash, inputToken, outputToken, inputAmount, outputAmount }),
  })
    .then(async (res) => {
      // Surface verification failures (2026-05-22). If /api/swap/log returns
      // 400 with reason 'no_fee_transfer' it means our fee plumbing failed
      // for this swap - critical telemetry the previous silent catch hid.
      // Non-fatal for the user, but we MUST see it in logs.
      if (!res.ok) {
        let reason = null
        try { const body = await res.json(); reason = body?.reason || body?.error || null } catch { /* ignore */ }
        console.warn(`[swapService] swap/log non-OK (${res.status})`, { chainId, txHash, reason })
      }
    })
    .catch((err) => {
      console.warn('[swapService] swap/log network error:', err?.message, { chainId, txHash })
    })
}

/**
 * Fetch swap history for the authenticated user.
 *
 * @param {number} [limit=20] - Number of swaps to fetch
 * @param {number} [offset=0] - Pagination offset
 * @returns {Promise<Array>} Array of swap entries
 */
export async function getSwapHistory(limit = 20, offset = 0) {
  const headers = {}
  const token = getAuthToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`/api/swap/history?limit=${limit}&offset=${offset}`, { headers })
  if (!res.ok) {
    if (res.status === 401) return []
    throw new Error(`History fetch failed (${res.status})`)
  }
  const data = await res.json()
  return data.swaps || []
}

/**
 * Convert a human-readable amount to smallest units (wei/lamports).
 */
export function toSmallestUnit(amount, decimals) {
  const parts = amount.toString().split('.')
  const whole = parts[0] || '0'
  const fraction = (parts[1] || '').padEnd(decimals, '0').slice(0, decimals)
  return BigInt(whole + fraction).toString()
}

/**
 * Convert smallest units back to human-readable amount.
 */
export function fromSmallestUnit(amount, decimals) {
  const str = amount.toString().padStart(decimals + 1, '0')
  const whole = str.slice(0, str.length - decimals)
  const fraction = str.slice(str.length - decimals)
  const trimmed = fraction.replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}
