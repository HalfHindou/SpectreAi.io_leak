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
import { CHAINS, getSolanaConnection, getEvmProvider } from '../services/walletService'
import { getAuthToken } from '../services/profileSync'

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
// These 7 are the ONLY executable chains; mirrors the server's
// ZEROX_CHAIN_IDS (apps/trading/api/swap.js) + Solana via Jupiter.
const NETWORK_TO_CHAIN = {
  1: 'ethereum',
  56: 'bsc',
  137: 'polygon',
  42161: 'arbitrum',
  8453: 'base',
  4663: 'robinhood',
  1399811149: 'solana',
}
const SUPPORTED_CHAIN_SLUGS = new Set(Object.values(NETWORK_TO_CHAIN))

/**
 * Resolve a chainId (numeric networkId or slug) to a chain slug, THROWING on
 * anything we cannot swap on.
 *
 * Every call site here used to end `|| 'ethereum'`. Discovery can surface
 * Avalanche / Optimism / Fantom / Cronos / PulseChain / Blast tokens, and that
 * default quoted them against MAINNET using the foreign token's address - a
 * different contract if the address is occupied there. Failing loudly is the
 * only safe behaviour for money code; the panel blocks these chains before we
 * ever get here, so this is defence in depth.
 */
function resolveChainSlug(chainId) {
  const chain = typeof chainId === 'number' ? NETWORK_TO_CHAIN[chainId] : chainId
  if (!SUPPORTED_CHAIN_SLUGS.has(chain)) {
    throw new Error(`Trading is not supported on this network (${chainId})`)
  }
  return chain
}

// -- Slippage bounds (defense in depth) --
// Hooks already clamp, but anyone who calls getSwapQuote directly bypasses
// that. 1 bps = 0.01%, 5000 bps = 50%. Anything outside that window is
// treated as a programming error and clamped.
const MIN_SLIPPAGE_BPS = 1
// 2026-05-12 hardening: was 5000 (50%). Hook + server both clamp at
// 500 (5%) so this was effectively dead. Set all 3 layers to 500.
const MAX_SLIPPAGE_BPS = 500

function safeSlippage(input) {
  const n = Number(input)
  if (!Number.isFinite(n)) return 50
  return Math.min(Math.max(Math.floor(n), MIN_SLIPPAGE_BPS), MAX_SLIPPAGE_BPS)
}

// AbortSignal.any polyfill (not in older Safari/Chrome). Aborts as soon as
// ANY input signal aborts. Falls back to the first signal if unsupported.
function anySignal(signals) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any(signals)
  }
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  for (const s of signals) {
    if (s.aborted) { controller.abort(); break }
    s.addEventListener('abort', onAbort, { once: true })
  }
  return controller.signal
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
export async function getSwapQuote({ chainId, inputToken, outputToken, amount, slippageBps = 50, userAddress }, signal) {
  // Normalize chainId
  const chain = resolveChainSlug(chainId)

  // Combine the caller's abort signal (supersede-on-new-quote) with an 8s
  // ceiling so a hung upstream can't strand the quote UI. Passing the signal
  // actually CANCELS the superseded fetch - stale quotes were previously
  // left to run to completion, doubling upstream load during fast typing.
  const timeout = AbortSignal.timeout(8000)
  const combined = signal ? anySignal([signal, timeout]) : timeout

  const res = await fetch('/api/swap/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: combined,
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
 * Pre-trade simulation: dry-run the swap (no signature, no gas) and return a
 * safety verdict without committing anything on-chain.
 *   { ok: true }   -> would execute (buyAmount/outAmount included)
 *   { ok: false }  -> would revert (reason = friendly explanation)
 *   { ok: null }   -> inconclusive (reason = why we couldn't simulate)
 * Never throws - returns an inconclusive verdict on any transport failure so the
 * safety button always shows a result. Slower than a quote (allowance-slot probe
 * + eth_call on EVM), so a wider 20s ceiling.
 */
export async function simulateSwap({ chainId, inputToken, outputToken, amount, slippageBps = 50, userAddress }, signal) {
  // Unsupported chain is an inconclusive VERDICT here, not a throw - this
  // function's contract is "never throws" and the safety button always renders
  // a result. The quote path refuses separately and is what blocks the trade.
  let chain
  try {
    chain = resolveChainSlug(chainId)
  } catch {
    return { ok: null, inconclusive: true, reason: 'Trading is not supported on this network.' }
  }
  try {
    const timeout = AbortSignal.timeout(20000)
    const combined = signal ? anySignal([signal, timeout]) : timeout
    const res = await fetch('/api/swap/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: combined,
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
      const err = await res.json().catch(() => ({}))
      return { ok: null, inconclusive: true, reason: err.error || `Simulation failed (${res.status})` }
    }
    return await res.json()
  } catch (e) {
    if (e?.name === 'AbortError' || e?.name === 'TimeoutError') {
      return { ok: null, inconclusive: true, reason: 'Simulation timed out. Try again.' }
    }
    return { ok: null, inconclusive: true, reason: 'Could not run the simulation. Try again.' }
  }
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
    return await executeEvmSwap(wallet, quote, helpers)
  }

  throw new Error(`Unknown swap provider: ${quote.provider}`)
}

/**
 * Map a raw wallet/RPC/ethers error to a short, user-presentable sentence.
 * Raw ethers errors carry the ENTIRE transaction hex + nested JSON, which is
 * useless and alarming to a trader (2KB of calldata for "not enough gas").
 * The full error is still console.error'd for debugging.
 */
function cleanSwapError(err, quote) {
  const raw = `${err?.info?.error?.message || ''} ${err?.shortMessage || ''} ${err?.reason || ''} ${err?.message || ''}`.toLowerCase()
  if (/insufficient funds|intrinsic transaction cost|insufficient balance/.test(raw)) {
    // Gas is paid in the native token, SEPARATELY from the token being sold.
    // Reducing the amount only frees gas headroom when you're PAYING with the
    // native token (a buy); on a token sell it does nothing - you must add ETH.
    const inTok = (quote?.inputToken || '').toLowerCase()
    const nativeInput = inTok === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' || inTok === 'native'
    return nativeInput
      ? 'Not enough ETH - reduce the amount or add ETH to cover gas.'
      : 'Not enough ETH to cover the gas fee - add a little ETH to your wallet.'
  }
  if (/user rejected|user denied|rejected the request|action_rejected/.test(raw)) {
    return 'Transaction cancelled'
  }
  if (/insufficient allowance|transfer amount exceeds/.test(raw)) {
    return 'Token approval needed - try again.'
  }
  if (/replacement transaction underpriced|nonce too low|already known/.test(raw)) {
    return 'A previous transaction is still pending - wait a moment and retry.'
  }
  if (/slippage|min return|too little received|price moved/.test(raw)) {
    return 'Price moved beyond your slippage tolerance - try again.'
  }
  if (/gas required exceeds|cannot estimate gas|execution reverted/.test(raw)) {
    return 'The trade would revert on-chain - it may be too large for this pool or the token blocks it.'
  }
  // Fall back to the shortMessage/reason if concise; never the full hex dump.
  const concise = err?.shortMessage || err?.reason
  if (concise && concise.length < 120) return concise
  return 'Swap failed - please try again.'
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

    let signature58
    if (typeof helpers.solanaSignOnly === 'function') {
      // Preferred path: Privy signs, WE send + confirm through our own stack
      // (same-origin RPC proxy -> upstream rotation). Privy's
      // signAndSendTransaction runs kit's sendAndConfirm internally with a
      // 10s websocket signature subscription - when that flaked it threw
      // AFTER the send, surfacing "Swap failed" for a sell that had already
      // landed on-chain (first live sell, 2026-07-07). Sign-only keeps Privy
      // in the signing seat and takes network I/O out of its hands entirely.
      const { signedTransaction } = await helpers.solanaSignOnly({
        transaction: txBytes,
        wallet,
        chain: 'solana:mainnet',
      })
      const connection = getSolanaConnection()
      // skipPreflight: the preflight simulation is a full extra RPC round
      // trip (~200-500ms) before the tx even enters the network. The client
      // guards (balance + rent headroom, fresh quote, honeypot block) already
      // cover the failure classes preflight would catch, and the confirmation
      // poller surfaces on-chain failures. This is the standard fast-terminal
      // trade-off.
      signature58 = await connection.sendRawTransaction(signedTransaction, {
        skipPreflight: true,
        preflightCommitment: 'processed',
        maxRetries: 3,
      })
    } else if (typeof helpers.solanaSignAndSend === 'function') {
      // Fallback: Privy signs AND sends (kit sendAndConfirm inside). Kept for
      // callers that don't thread the sign-only hook. Calling the wallet
      // object's own method instead routes through the wallet-standard CONNECT
      // ceremony, which rejects embedded wallets ("User must be authenticated
      // and have a Privy wallet before it can be connected").
      const { signature } = await helpers.solanaSignAndSend({
        transaction: txBytes,
        wallet,
        chain: 'solana:mainnet',
      })
      const bs58 = (await import('bs58')).default
      signature58 = typeof signature === 'string' ? signature : bs58.encode(signature)
    } else if (typeof wallet.getProvider === 'function') {
      // Legacy (pre-v3) Privy Solana wallet shape - kept as fallback.
      const provider = await wallet.getProvider()
      const { signature } = await provider.signAndSendTransaction({
        serializedTransaction: Buffer.from(quote.swapTransaction, 'base64'),
      })
      signature58 = signature
    } else {
      throw new Error('Solana wallet does not support transaction signing')
    }

    // Log the swap. userAddress is required server-side for on-chain
    // signer verification (SEC-20260513-RT-09); we send the wallet that
    // actually signed the tx so the server can confirm the claim.
    // Post-send logging must NEVER fail the swap (tx already broadcast).
    try {
      logSwap({
        chainId: 'solana',
        txHash: signature58,
        inputToken: quote.inputToken,
        outputToken: quote.outputToken,
        inputAmount: quote.inputAmount,
        outputAmount: quote.outputAmount,
        userAddress: wallet.address,
        meta: helpers.logMeta,
        authToken: helpers.authToken,
      })
    } catch (logErr) {
      console.warn('[swapService] post-send logSwap threw (swap still succeeded):', logErr?.message)
    }

    return signature58
  } catch (err) {
    console.error('[swapService] Solana swap failed:', err)
    // kit wraps preflight rejections as SolanaError with the on-chain cause
    // chained. Surface the failure users actually hit - system-program error 1
    // (insufficient lamports, usually wSOL-wrap + ATA rent on small balances) -
    // as an actionable message instead of a bare "Transaction simulation failed".
    const causeChain = `${err.message || ''} ${err.cause ? err.cause.message || '' : ''}`
    if (
      /simulation failed/i.test(causeChain) &&
      /(custom program error:?\s*(#1\b|0x1\b)|insufficient (funds|lamports))/i.test(causeChain)
    ) {
      throw new Error(
        'Not enough SOL to cover this trade plus network rent and fees (~0.005 SOL headroom needed). Add SOL or reduce the amount.'
      )
    }
    throw new Error(cleanSwapError(err, quote))
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
  robinhood: 4663,
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
 * to an attacker. Privy's modal does display the typed-data struct but it
 * is opaque to most users; this is the programmatic check.
 *
 * Throws with a "Quote tampered" prefix on any mismatch. 0x v2 returns the
 * `PermitTransferFrom` structure: { permitted: { token, amount },
 * spender, nonce, deadline }. The older PermitSingle shape ({ details, ...,
 * sigDeadline }) is also accepted defensively.
 *
 * Exported so it can be unit-tested without a wallet.
 */
export function assertSafePermit2EIP712(eip712, quote) {
  if (!eip712 || !eip712.domain || !eip712.message) {
    throw new Error('Quote tampered: malformed Permit2 EIP-712 payload')
  }

  // Domain.verifyingContract MUST be the canonical Permit2 singleton.
  const vc = (eip712.domain.verifyingContract || '').toLowerCase()
  if (vc !== PERMIT2_ADDRESS.toLowerCase()) {
    throw new Error('Quote tampered: Permit2 EIP-712 verifyingContract mismatch')
  }

  // Domain.chainId MUST match the expected chain for this quote.
  const expectedChainId = EVM_CHAIN_NUMERIC_ID[quote.chain]
  if (expectedChainId && Number(eip712.domain.chainId) !== expectedChainId) {
    throw new Error(`Quote tampered: Permit2 EIP-712 chainId mismatch (expected ${expectedChainId}, got ${eip712.domain.chainId})`)
  }

  const msg = eip712.message
  // 0x v2 => PermitTransferFrom (message.permitted); PermitSingle => details.
  const permitted = msg.permitted || msg.details
  if (!permitted) {
    throw new Error('Quote tampered: Permit2 EIP-712 missing permitted/details')
  }

  // Token in the permit MUST equal the input token the user is selling.
  const permitToken = (permitted.token || '').toLowerCase()
  const inputToken = (quote.inputToken || '').toLowerCase()
  if (permitToken !== inputToken) {
    throw new Error('Quote tampered: Permit2 EIP-712 token does not match quote.inputToken')
  }

  // Permit amount MUST be at least the quote's input amount. Sub-amount
  // permits would simply revert on chain, but a much larger permit caps
  // the user's exposure if signed. Accept >=.
  try {
    if (BigInt(permitted.amount) < BigInt(quote.inputAmount)) {
      throw new Error('Quote tampered: Permit2 EIP-712 amount below swap input')
    }
  } catch (e) {
    if (/tampered/.test(e.message)) throw e
    throw new Error('Quote tampered: Permit2 EIP-712 amount not parseable')
  }

  // Spender of the permit MUST equal the swap settlement contract (tx.to).
  // If they differ, the permit lets a different contract pull the tokens
  // than the one we are about to call - classic drain vector.
  const permitSpender = (msg.spender || '').toLowerCase()
  const txTo = (quote.transaction?.to || '').toLowerCase()
  if (!txTo || permitSpender !== txTo) {
    throw new Error('Quote tampered: Permit2 EIP-712 spender does not match swap transaction.to')
  }

  // Deadline must be in the future but not absurdly far. 0x v2 names it
  // `deadline`; PermitSingle used `sigDeadline`. 60 min upper bound covers
  // 0x's freshly-issued permit windows.
  const now = Math.floor(Date.now() / 1000)
  const deadline = Number(msg.deadline ?? msg.sigDeadline)
  if (!Number.isFinite(deadline) || deadline <= now) {
    throw new Error('Quote tampered: Permit2 EIP-712 deadline is in the past')
  }
  if (deadline > now + 60 * 60) {
    throw new Error('Quote tampered: Permit2 EIP-712 deadline too far in future')
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
// Chain slugs (quote.chain) -> numeric EVM chain ids. Mirrors withdrawTx's
// EVM_CHAIN_IDS; duplicated here to keep this service dependency-free.
const EVM_SWAP_CHAIN_IDS = { ethereum: 1, base: 8453, polygon: 137, arbitrum: 42161, bsc: 56, robinhood: 4663 }

async function executeEvmSwap(wallet, quote, helpers = {}) {
  if (!quote.transaction) {
    throw new Error('No transaction data in quote - request quote with userAddress')
  }

  try {
    // Pin the wallet to the QUOTE's chain before signing anything. The Privy
    // ethers provider signs on the wallet's CURRENT chain (Ethereum by
    // default) - without this switch, a Base/Polygon/Arbitrum/BSC swap
    // broadcasts on mainnet: reverted approval, wasted gas, or worse. The
    // approval tx below inherits the switched chain too.
    const targetChainId = EVM_SWAP_CHAIN_IDS[quote.chain]
    if (!targetChainId) {
      throw new Error(`Unsupported swap chain: ${quote.chain}`)
    }
    await wallet.switchChain(targetChainId)

    // Privy v3 exposes an EIP-1193 provider (getEthereumProvider); the old
    // getEthersProvider() no longer exists on the wallet object. Wrap it
    // with ethers v6 BrowserProvider for the signer API this flow uses.
    const eip1193 = await wallet.getEthereumProvider()
    const { ethers } = await import('ethers')
    const provider = new ethers.BrowserProvider(eip1193)
    const signer = await provider.getSigner()

    // Fee pricing starts NOW, in parallel with the permit/approval flow
    // below, over our cached public RPC (not Privy's iframe provider).
    // The 0x quote ships a LEGACY gasPrice estimated at quote time - a
    // stale, base-fee-level price gets included lazily (extra blocks =
    // the "20s confirmation"). Fresh EIP-1559 fields with a bumped tip
    // buy consistent next-block inclusion; unused maxFee is refunded by
    // the protocol, so the headroom costs nothing.
    const feeDataPromise = (async () => {
      try {
        const readProvider = getEvmProvider(quote.chain)
        const fd = await readProvider.getFeeData()
        if (!fd?.maxFeePerGas) return null
        const suggested = fd.maxPriorityFeePerGas ?? 0n
        // ethers packs maxFeePerGas = 2*baseFee + tip; recover baseFee so we build
        // our own ceiling instead of doubling an already-doubled value.
        const base = fd.maxFeePerGas > suggested ? (fd.maxFeePerGas - suggested) / 2n : fd.maxFeePerGas / 2n
        const bumped = (suggested * 15n) / 10n
        const minTip = 1_500_000_000n // 1.5 gwei floor
        const priority = bumped > minTip ? bumped : minTip
        // maxFee = 2x current base (survives a full base-fee doubling before
        // inclusion) + our tip. The old `fd.maxFeePerGas * 2` DOUBLE-COUNTED the
        // 2x base already inside fd.maxFeePerGas -> a ~4x-base ceiling that the
        // wallet's `balance >= gasLimit * maxFee` pre-check failed for modest-ETH
        // users, even though unused maxFee is refunded and the real cost is a
        // fraction of it. (VITALIK sell, 0.9 gwei base: 0.0025->0.0012 ETH ceiling.)
        return { maxFeePerGas: base * 2n + priority, maxPriorityFeePerGas: priority }
      } catch {
        return null // fall back to the quote's legacy gasPrice
      }
    })()

    // Defense in depth: the signer must actually be on the quote's chain
    // now - a silent switch failure would re-create the wrong-chain bug.
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
        // Price + confirm the one-time approval on the SAME fast path as the
        // swap (aggressive EIP-1559 tip + our 1s poller) - a default-gas
        // approval on slow ethers polling was most of a first sell's wait.
        await ensurePermit2Approval(signer, quote.inputToken, quote.inputAmount, {
          chain: quote.chain,
          fee: await feeDataPromise,
        })
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

    // Send the swap transaction. EIP-1559 pricing when available (next-block
    // inclusion); legacy quote gasPrice only as the fallback. Gas limit gets
    // 15% headroom over 0x's estimate - the appended permit signature and
    // fee-transfer paths occasionally push past a tight estimate.
    const eip1559 = await feeDataPromise
    const gasLimit = quote.transaction.gas
      ? (BigInt(quote.transaction.gas) * 115n) / 100n
      : undefined
    const tx = await signer.sendTransaction({
      to: quote.transaction.to,
      data,
      value: quote.transaction.value || '0',
      gasLimit,
      ...(eip1559
        ? { maxFeePerGas: eip1559.maxFeePerGas, maxPriorityFeePerGas: eip1559.maxPriorityFeePerGas }
        : { gasPrice: quote.transaction.gasPrice }),
    })

    // Log the swap. userAddress is required server-side for on-chain
    // signer verification (SEC-20260513-RT-09); we send the wallet that
    // actually signed the tx so the server can confirm the claim.
    // Post-send logging must NEVER be able to fail the swap - the tx is
    // already broadcast, so a throw here would falsely report "Swap failed"
    // for a swap that succeeded on-chain (real bug hit 2026-07-07).
    try {
      logSwap({
        chainId: quote.chain,
        txHash: tx.hash,
        inputToken: quote.inputToken,
        outputToken: quote.outputToken,
        inputAmount: quote.inputAmount,
        outputAmount: quote.outputAmount,
        userAddress: wallet.address,
        meta: helpers.logMeta,
        authToken: helpers.authToken,
      })
    } catch (logErr) {
      console.warn('[swapService] post-send logSwap threw (swap still succeeded):', logErr?.message)
    }

    return tx.hash
  } catch (err) {
    console.error('[swapService] EVM swap failed:', err)
    // Surface a clean sentence, never the raw ethers tx-hex dump. Pass the
    // quote so the gas-shortfall message can be direction-aware.
    throw new Error(cleanSwapError(err, quote))
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
async function ensurePermit2Approval(signer, tokenAddress, amount, { chain, fee } = {}) {
  const { ethers } = await import('ethers')
  const erc20 = new ethers.Contract(
    tokenAddress,
    ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'],
    signer,
  )

  const owner = await signer.getAddress()
  const current = await erc20.allowance(owner, PERMIT2_ADDRESS)
  if (current >= BigInt(amount)) return // Already approved enough (skips repeat sells)

  // Aggressive EIP-1559 pricing so the approval lands NEXT block instead of
  // lingering at base fee - the approval is a hard prerequisite for the swap,
  // so every block it waits is dead time before the trade can even start.
  const overrides = fee
    ? { maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas }
    : {}
  const tx = await erc20.approve(PERMIT2_ADDRESS, ethers.MaxUint256, overrides)

  // Confirm via our fast poller (1s cadence) rather than ethers tx.wait(),
  // which polls the Privy iframe provider at a slow default interval.
  if (chain) {
    const receipt = await waitForConfirmation(tx.hash, chain, 60000)
    if (receipt?.confirmed === false) throw new Error('Token approval failed on-chain')
  } else {
    await tx.wait()
  }
}

/**
 * Fast-path confirmation check: read the tx status the Privy webhook recorded
 * in KV (GET /api/swap/tx-status?hash=...). Returns the stored status object
 * { status, chainId, blockNumber, error, ... } or null if the webhook hasn't
 * seen this tx (the common case for swaps signed via raw provider rather than
 * Privy's transaction API). Never throws - returns null on any failure so the
 * caller falls through to RPC polling.
 */
async function getServerTxStatus(txHash) {
  try {
    const res = await fetch(`/api/swap/tx-status?hash=${encodeURIComponent(txHash)}`, {
      // 1500ms cap: this runs before each 2s RPC poll, so a slow/hanging
      // endpoint must not eat the whole interval and starve RPC checks.
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
  const chain = resolveChainSlug(chainId)

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
  let tick = 0
  while (Date.now() - start < timeoutMs) {
    // RPC status first - with the fast cadence below this is the primary
    // signal. 'processed' (err-free) counts as success: the tx has executed
    // in a block ~0.5-1s before 'confirmed' lands, and fast terminals unlock
    // on it. Errored statuses fail at any commitment.
    try {
      const status = await connection.getSignatureStatus(signature)
      if (status?.value?.err) {
        return { confirmed: false, signature, error: status.value.err }
      }
      const cs = status?.value?.confirmationStatus
      if (cs === 'processed' || cs === 'confirmed' || cs === 'finalized') {
        return { confirmed: true, signature, status: cs }
      }
    } catch {
      // Ignore transient errors
    }

    // Webhook KV fast-path demoted to a secondary signal every 4th tick -
    // an extra HTTP call per 400ms tick would double request volume for a
    // source that rarely beats the RPC. Returns the status STRING or null.
    if (tick % 4 === 3) {
      const wh = await getServerTxStatus(signature)
      if (wh === 'confirmed') return { confirmed: true, signature, status: 'confirmed', source: 'webhook' }
      if (wh === 'failed' || wh === 'reverted') return { confirmed: false, signature, error: wh, source: 'webhook' }
    }

    // Fast cadence while landing is plausible (300ms for the first 6s),
    // then back off to 2s for the long tail - the old flat 2s poll added
    // 2-4s of pure detection lag to every swap.
    const elapsed = Date.now() - start
    await new Promise(r => setTimeout(r, elapsed < 6000 ? 300 : 2000))
    tick++
  }
  throw new Error('Transaction confirmation timeout')
}

async function waitEvmConfirmation(txHash, chainId, timeoutMs) {
  // Cached singleton provider - a fresh JsonRpcProvider per confirmation
  // re-ran ethers' lazy network detection before the first receipt poll.
  const provider = getEvmProvider(chainId)
  if (!provider) throw new Error(`Unknown chain: ${chainId}`)

  const start = Date.now()
  let tick = 0
  while (Date.now() - start < timeoutMs) {
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

    // Webhook KV fast-path demoted to every 3rd tick (secondary signal).
    // getServerTxStatus returns the status STRING (or null), not an object.
    if (tick % 3 === 2) {
      const wh = await getServerTxStatus(txHash)
      if (wh === 'confirmed') return { confirmed: true, txHash, blockNumber: null, source: 'webhook' }
      if (wh === 'failed' || wh === 'reverted') {
        // The webhook is a SECONDARY signal and has false-flagged SUCCESSFUL
        // swaps as reverted (a MARV sell that actually executed on-chain, yet the
        // UI showed "reverted - nothing was traded"). The on-chain receipt is the
        // ONLY source of truth, so never fail on the webhook alone: corroborate
        // with the receipt. status===1 -> success (overrides the webhook);
        // status===0 -> a real revert; NO receipt yet -> don't fail, keep polling
        // for the real receipt (or time out into the pending path).
        try {
          const r = await provider.getTransactionReceipt(txHash)
          if (r) return { confirmed: r.status === 1, txHash, blockNumber: r.blockNumber, source: 'webhook+rpc' }
        } catch { /* transient RPC error - keep polling */ }
      }
    }

    // 1s cadence while next-block inclusion is plausible (~2 ETH blocks),
    // then back off. Detection lag caps at ~1s after the block lands.
    const elapsed = Date.now() - start
    await new Promise(r => setTimeout(r, elapsed < 30000 ? 1000 : 2500))
    tick++
  }
  throw new Error('Transaction confirmation timeout')
}

/**
 * Read an ERC-20 balanceOf as a RAW BigInt (base units) via the cached provider.
 * Used for the pre-flight sell guard - the DISPLAYED balance can lag (Codex
 * indexer / an un-refreshed tab), and selling more than you hold reverts with
 * TRANSFER_FROM_FAILED. Returns null on failure so callers never block a
 * legitimate sell on a transient read error.
 */
export async function getErc20BalanceRaw(tokenAddress, owner, chainId) {
  const provider = getEvmProvider(chainId)
  if (!provider) return null
  const data = '0x70a08231' + owner.slice(2).toLowerCase().padStart(64, '0')
  const res = await provider.call({ to: tokenAddress, data })
  if (!res || res === '0x') return 0n
  return BigInt(res)
}

// Generate a UUID v4 idempotency key. Uses crypto.randomUUID where available
// (modern browsers, Node 14.17+) and falls back to a Math.random-based key for
// older runtimes. Keyed on the tx hash anyway, so collision risk is dominated
// by tx hash uniqueness, not key entropy.
function makeIdempotencyKey() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Log a completed swap to the server for analytics.
 * Includes a client-generated idempotency key so retries (e.g. flaky network
 * caused us to retry the log POST) don't double-count the same swap. The
 * server is expected to dedupe on the (X-Idempotency-Key, txHash) pair.
 */
function logSwap({ chainId, txHash, inputToken, outputToken, inputAmount, outputAmount, userAddress, meta, authToken }) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Idempotency-Key': makeIdempotencyKey(),
  }
  // Prefer a FRESH Privy token passed from the swap flow. The module-cached
  // getAuthToken() (_authToken) is only populated when profile-sync has run,
  // so it is often null - which made /api/swap/log 401 silently and the swap
  // never reached history.
  const token = authToken || getAuthToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  // `meta` carries the DISPLAY fields the history UI needs (symbols, decimals,
  // side, USD) - the frontend has them at swap time; the addresses + base
  // units alone can never be formatted correctly (per-token decimals vary).
  fetch('/api/swap/log', {
    method: 'POST',
    headers,
    body: JSON.stringify({ chainId, txHash, inputToken, outputToken, inputAmount, outputAmount, userAddress, ...(meta || {}) }),
  })
    .then(async (res) => {
      // Surface verification failures (2026-05-22). If /api/swap/log returns
      // 400 with reason 'no_fee_transfer' it means our fee plumbing failed
      // for this swap - critical telemetry the previous silent catch hid.
      // Non-fatal for the user (their swap still succeeded on-chain), but
      // we MUST see it in logs + analytics so a regression cannot hide.
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
 * Log a completed WITHDRAWAL to the server (fire-and-forget, mirrors
 * logSwap). The caller passes the per-attempt idempotency key it already
 * generated (UdWalletSection handleWithdraw) so retries dedupe server-side.
 */
export function logWithdraw({ chainId, txHash, token, amount, toAddress, userAddress, idempotencyKey }) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Idempotency-Key': idempotencyKey || makeIdempotencyKey(),
  }
  const authToken = getAuthToken()
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`

  fetch('/api/swap/withdraw-log', {
    method: 'POST',
    headers,
    body: JSON.stringify({ chainId, txHash, token, amount, toAddress, userAddress }),
  })
    .then(async (res) => {
      if (!res.ok) {
        let reason = null
        try { const body = await res.json(); reason = body?.reason || body?.error || null } catch { /* ignore */ }
        console.warn(`[swapService] withdraw-log non-OK (${res.status})`, { chainId, txHash, reason })
      }
    })
    .catch((err) => {
      console.warn('[swapService] withdraw-log network error:', err?.message, { chainId, txHash })
    })
}

/**
 * Fetch paginated swap history for the current user.
 *
 * @param {number} [limit=20] - Max entries to return
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
