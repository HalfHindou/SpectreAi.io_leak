/**
 * Vercel Serverless - Swap Quote + Log + History endpoint
 * POST /api/swap/quote - Get swap quote from Jupiter (Solana) or 0x (EVM)
 * POST /api/swap/log - Log completed swap (authenticated, persisted to KV)
 * GET  /api/swap/history - Get paginated swap history (authenticated)
 *
 * Rewrite rule in vercel.json maps:
 *   /api/swap/:action* -> /api/swap?action=:action*
 */

import { createHash } from 'node:crypto'
import { verifyPrivyToken } from '../auth.js'
import { logSwap, getSwapHistory, getFeeConfig, claimIdempotencySlot, getIdempotencySlot, releaseIdempotencySlot, getWebhookTxStatus } from '../kv.js'
import { rateLimit } from '../ratelimit.js'

// X-Idempotency-Key validation - matches trading's swap.js pattern.
const IDEM_KEY_RE = /^[A-Za-z0-9_-]{1,200}$/

const ZEROX_API_KEY = process.env.ZEROX_API_KEY || ''
// Official Jupiter Swap API. The free QuickNode mirror (public.jupiterapi.com)
// builds STALE Pump.fun AMM instructions - every pump.fun-routed swap failed
// on-chain with Jupiter error 6014 IncorrectTokenProgramID (verified by
// simulation 2026-07-06: mirror build fails, official build succeeds for the
// identical quote). lite-api.jup.ag is Jupiter's official free tier; set
// JUPITER_API_URL to the paid api.jup.ag base when volume needs it.
const JUPITER_API = process.env.JUPITER_API_URL || 'https://lite-api.jup.ag/swap/v1'

const ZEROX_API = 'https://api.0x.org'
const ZEROX_CHAIN_IDS = { ethereum: 1, bsc: 56, polygon: 137, arbitrum: 42161, base: 8453 }
const ZEROX_CHAINS = ZEROX_CHAIN_IDS

const MAX_SLIPPAGE_BPS = 500
const MIN_SLIPPAGE_BPS = 1

function clampSlippage(input) {
  const raw = Number(input)
  if (!Number.isFinite(raw)) return 50
  return Math.min(Math.max(Math.floor(raw), MIN_SLIPPAGE_BPS), MAX_SLIPPAGE_BPS)
}

// Server-side hard ceiling on price impact (percent). The client warns at 5%;
// this is a higher backstop so a direct API caller cannot pull a quote for a
// catastrophic-impact trade (thin-liquidity rug bait). Not meant to duplicate
// the client UX - just to refuse to hand back an egregiously bad quote.
const MAX_PRICE_IMPACT_PCT = 15

// Amounts are in base units (wei / lamports / smallest token unit). Validate as
// a positive integer STRING - never via Number (18-decimal amounts overflow
// Number.MAX_SAFE_INTEGER, and Number() silently accepts "1e9", "  5 ", floats).
function isValidBaseUnitAmount(amount) {
  if (amount === null || amount === undefined) return false
  const s = String(amount).trim()
  if (!/^\d+$/.test(s)) return false
  try { return BigInt(s) > 0n } catch { return false }
}

const TX_HASH_RE = /^(?:0x[a-fA-F0-9]{64}|[1-9A-HJ-NP-Za-km-z]{87,88})$/

function safeLog(s) {
  if (typeof s !== 'string') return String(s)
  return s.replace(/[\r\n]+/g, ' ').slice(0, 200)
}

// Log a non-reversible, correlatable tag for a Privy DID instead of a raw
// userId prefix (which is PII identifying the account).
function userTag(userId) {
  try {
    return createHash('sha256').update(String(userId)).digest('hex').slice(0, 12)
  } catch {
    return 'anon'
  }
}

// Fee config now lives in Vercel KV - admin updates persist across cold
// starts and are reflected in both research and trading apps. See
// `_lib/kv.js` getFeeConfig for cache + seed-from-env behavior.
async function loadFeeConfig() {
  return getFeeConfig()
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const action = req.query.action || ''

  // GET /api/swap/tx-status?hash=... - read the latest tx status the Privy
  // webhook recorded in KV (set by api/privy-webhook.js setWebhookTxStatus).
  // Lets the client's waitForConfirmation short-circuit RPC polling. Public
  // (tx status is public on-chain data, keyed by hash) - no auth, light read.
  if (action === 'tx-status' && req.method === 'GET') {
    // Unauthenticated public read - rate-limit to bound KV cost / DoS.
    if (await rateLimit(req, res, { bucket: 'tx-status', max: 60, windowMs: 60_000 })) return
    const hash = req.query.hash
    if (typeof hash !== 'string' || !TX_HASH_RE.test(hash)) {
      return res.status(400).json({ error: 'Invalid hash' })
    }
    const status = await getWebhookTxStatus(hash)
    return res.json({ status: status || null })
  }

  // POST /api/swap/log - authenticated swap logging
  if (action === 'log' && req.method === 'POST') {
    // IP-level rate limit BEFORE auth (2026-05-22 hardening). Cheap defense
    // against unauthenticated spam burning per-user budgets; the auth check
    // (next) gates the real work but rejecting earlier is cheaper.
    if (await rateLimit(req, res, { bucket: 'swap-log-ip', max: 30, windowMs: 60_000 })) return

    const userId = await verifyPrivyToken(req)
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { chainId, txHash, inputToken, outputToken, inputAmount, outputAmount } = req.body || {}
    if (typeof txHash !== 'string' || !TX_HASH_RE.test(txHash)) {
      return res.status(400).json({ error: 'Invalid txHash' })
    }

    // Idempotency dedupe. The client sends X-Idempotency-Key as a per-swap UUID.
    // Claim the slot atomically (SET NX EX 24h) before writing to KV - a
    // flaky-network retry hits the existing claim and short-circuits instead
    // of double-counting the swap in user history. Key reuse with a DIFFERENT
    // txHash is rejected as a 409 (buggy client / attacker binding one UUID
    // to multiple claims).
    const rawIdemKey = req.headers['x-idempotency-key']
    const idemKey = typeof rawIdemKey === 'string' && IDEM_KEY_RE.test(rawIdemKey) ? rawIdemKey : null
    if (idemKey) {
      // 300s claim TTL (not 24h) to bound the stuck-slot window if the
      // function dies between claim and the KV write. Covers realistic
      // flaky-network retries; a re-log after 5 min is acceptable.
      const claimed = await claimIdempotencySlot('swap-log', idemKey, { txHash, userId: userId.slice(0, 32), ts: Date.now() }, 300)
      if (!claimed) {
        const existing = await getIdempotencySlot('swap-log', idemKey)
        const parsed = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : null
        if (parsed?.txHash && parsed.txHash !== txHash) {
          console.warn(`[swap/log] idempotency key reuse with different tx user=${userTag(userId)} stored=${parsed.txHash} got=${txHash}`)
          return res.status(409).json({ error: 'idempotency_key_conflict' })
        }
        console.log(`[swap/log] idempotent replay user=${userTag(userId)} tx=${txHash}`)
        return res.json({ ok: true, idempotent: true })
      }
    }

    // Log token pair + chain + tx for ops, but NOT trade amounts and only a
    // hashed user tag.
    console.log(`[swap/log] user=${userTag(userId)} ${safeLog(chainId)} tx=${txHash} ${safeLog(inputToken)} -> ${safeLog(outputToken)}`)

    try {
      await logSwap(userId, { chainId, txHash, inputToken, outputToken, inputAmount, outputAmount })
    } catch (err) {
      // If the KV write blew up after we claimed the slot, release it so the
      // retry can re-attempt. Otherwise the user's swap is lost from history.
      if (idemKey) await releaseIdempotencySlot('swap-log', idemKey).catch(() => {})
      console.error('[swap/log] KV write failed:', err?.message)
      return res.status(503).json({ error: 'log write failed' })
    }
    return res.json({ ok: true })
  }

  // GET /api/swap/history - authenticated swap history
  if (action === 'history' && req.method === 'GET') {
    const userId = await verifyPrivyToken(req)
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100)
    const offset = parseInt(req.query.offset || '0', 10)
    const history = await getSwapHistory(userId, limit, offset)
    return res.json({ swaps: history, limit, offset })
  }

  // POST /api/swap/quote - no auth, but rate-limited per IP to stop quota drains
  if (action === 'quote' && req.method === 'POST') {
    if (await rateLimit(req, res, { bucket: 'swap-quote', max: 30, windowMs: 60_000 })) return
    return await handleQuote(req, res)
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  return res.status(400).json({ error: `Unknown action: ${action}` })
}

async function handleQuote(req, res) {
  try {
    const { chainId, inputToken, outputToken, amount, userAddress } = req.body || {}
    const slippageBps = clampSlippage(req.body?.slippageBps ?? 50)

    if (!chainId || !inputToken || !outputToken || !amount) {
      return res.status(400).json({ error: 'Missing required fields: chainId, inputToken, outputToken, amount' })
    }

    // Validate amount server-side (L5). The client sends base units; reject
    // anything that is not a positive integer string so a direct caller cannot
    // smuggle a float / negative / scientific-notation value into the upstream.
    if (!isValidBaseUnitAmount(amount)) {
      return res.status(400).json({ error: 'Invalid amount: must be a positive integer in base units' })
    }

    const feeConfig = await loadFeeConfig()

    if (chainId === 'solana') {
      return await handleJupiterQuote(res, { inputToken, outputToken, amount, slippageBps, userAddress, feeConfig })
    }

    if (ZEROX_CHAINS[chainId]) {
      return await handleZeroxQuote(res, { chainId, inputToken, outputToken, amount, slippageBps, userAddress, feeConfig })
    }

    return res.status(400).json({ error: `Unsupported chain: ${chainId}` })
  } catch (err) {
    console.error('[swap/quote] Error:', err.message)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

// -- Jupiter fee account resolution ---------------------------------------
// Jupiter's `feeAccount` must be an INITIALIZED SPL token account for the
// quote's output mint. Passing the raw fee WALLET address does not error -
// Jupiter silently OMITS the fee (verified 2026-07-06: the wallet key was
// absent from the built tx's account list), so no fee was ever collected.
// Derive the fee wallet's ATA for the mint and use it ONLY when it exists
// on-chain; otherwise skip fee params so a missing ATA never fails a swap.
// Mirror of apps/trading/api/swap.js - keep in sync.
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const SPL_ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const SOLANA_RPC_FALLBACK_JUP = 'https://api.mainnet-beta.solana.com'
const _feeAtaCache = new Map() // `${wallet}:${mint}` -> { ata: string|null, expires }

async function resolveJupiterFeeAccount(feeWallet, mint) {
  if (!feeWallet || !mint) return null
  const cacheKey = `${feeWallet}:${mint}`
  const hit = _feeAtaCache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.ata
  try {
    const { PublicKey, Connection } = await import('@solana/web3.js')
    const [ata] = PublicKey.findProgramAddressSync(
      [
        new PublicKey(feeWallet).toBuffer(),
        new PublicKey(SPL_TOKEN_PROGRAM_ID).toBuffer(),
        new PublicKey(mint).toBuffer(),
      ],
      new PublicKey(SPL_ATA_PROGRAM_ID),
    )
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || SOLANA_RPC_FALLBACK_JUP
    const conn = new Connection(rpcUrl, 'confirmed')
    const info = await conn.getAccountInfo(ata)
    const initialized = !!info && info.owner?.toBase58?.() === SPL_TOKEN_PROGRAM_ID
    const result = initialized ? ata.toBase58() : null
    _feeAtaCache.set(cacheKey, { ata: result, expires: Date.now() + (initialized ? 3600_000 : 300_000) })
    return result
  } catch (err) {
    console.warn('[swap] Jupiter fee ATA resolve failed:', err.message)
    return null
  }
}

async function handleJupiterQuote(res, { inputToken, outputToken, amount, slippageBps, userAddress, feeConfig }) {
  const feeRecipient = feeConfig.feeWallets?.primary?.solana || ''
  const feeBps = feeConfig.feeBps || 100

  // Jupiter has no 'native' sentinel - native SOL trades as WRAPPED SOL
  // (wrapAndUnwrapSol on the swap build wraps/unwraps automatically). The
  // client sends 'native' for the pay/receive side (same convention as the
  // EVM path); map it to the wSOL mint here. Response echoes the ORIGINAL
  // values so the client's stale-quote guard (inputToken === payToken.address)
  // keeps matching.
  const WSOL_MINT = 'So11111111111111111111111111111111111111112'
  const inputMint = inputToken === 'native' ? WSOL_MINT : inputToken
  const outputMint = outputToken === 'native' ? WSOL_MINT : outputToken

  const params = new URLSearchParams({
    inputMint: inputMint,
    outputMint: outputMint,
    amount: amount.toString(),
    slippageBps: slippageBps.toString(),
  })

  // Fee params only when the fee wallet's output-mint ATA is initialized
  // (see resolveJupiterFeeAccount above) - keeps quote and swap-build
  // consistent instead of letting Jupiter silently drop the fee.
  const feeAccount = (feeRecipient && feeRecipient !== '11111111111111111111111111111111')
    ? await resolveJupiterFeeAccount(feeRecipient, outputMint)
    : null
  if (feeAccount) {
    params.set('platformFeeBps', feeBps.toString())
  }

  const quoteUrl = `${JUPITER_API}/quote?${params}`
  const quoteRes = await fetch(quoteUrl)

  if (!quoteRes.ok) {
    const errText = await quoteRes.text()
    return res.status(quoteRes.status).json({ error: 'Jupiter quote failed', details: errText })
  }

  const quoteData = await quoteRes.json()

  // Price-impact backstop (L6). Jupiter returns priceImpactPct as a decimal
  // fraction ("0.012" = 1.2%). Refuse to hand back a catastrophic-impact quote.
  const jupImpactPct = Math.abs(parseFloat(quoteData.priceImpactPct || '0')) * 100
  if (Number.isFinite(jupImpactPct) && jupImpactPct > MAX_PRICE_IMPACT_PCT) {
    return res.status(422).json({ error: `Price impact too high (${jupImpactPct.toFixed(1)}%). Trade refused.`, priceImpactPct: quoteData.priceImpactPct })
  }

  if (userAddress) {
    const swapBody = {
      quoteResponse: quoteData,
      userPublicKey: userAddress,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }
    if (feeAccount) {
      swapBody.feeAccount = feeAccount
    }

    const swapRes = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(swapBody),
    })

    if (!swapRes.ok) {
      const errText = await swapRes.text()
      return res.status(swapRes.status).json({ error: 'Jupiter swap tx failed', details: errText })
    }

    const swapData = await swapRes.json()
    return res.json({
      provider: 'jupiter',
      chain: 'solana',
      inputToken,
      outputToken,
      inputAmount: quoteData.inAmount,
      outputAmount: quoteData.outAmount,
      otherAmountThreshold: quoteData.otherAmountThreshold,
      priceImpactPct: quoteData.priceImpactPct,
      platformFee: feeAccount ? { percentage: feeConfig.feePercentage || 1.0, bps: feeBps } : null,
      routePlan: quoteData.routePlan?.map(r => ({ swapInfo: { label: r.swapInfo?.label }, percent: r.percent })),
      swapTransaction: swapData.swapTransaction,
      lastValidBlockHeight: swapData.lastValidBlockHeight,
    })
  }

  return res.json({
    provider: 'jupiter',
    chain: 'solana',
    inputToken,
    outputToken,
    inputAmount: quoteData.inAmount,
    outputAmount: quoteData.outAmount,
    otherAmountThreshold: quoteData.otherAmountThreshold,
    priceImpactPct: quoteData.priceImpactPct,
    platformFee: feeAccount ? { percentage: feeConfig.feePercentage || 1.0, bps: feeBps } : null,
    routePlan: quoteData.routePlan?.map(r => ({ swapInfo: { label: r.swapInfo?.label }, percent: r.percent })),
  })
}

async function handleZeroxQuote(res, { chainId, inputToken, outputToken, amount, slippageBps, userAddress, feeConfig }) {
  const numericChainId = ZEROX_CHAIN_IDS[chainId]
  if (!numericChainId) return res.status(400).json({ error: `Unsupported EVM chain: ${chainId}` })

  const feeRecipient = feeConfig.feeWallets?.primary?.evm || ''
  const feeBps = feeConfig.feeBps || 100
  const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
  const sellToken = inputToken === 'native' ? NATIVE_TOKEN : inputToken
  const buyToken = outputToken === 'native' ? NATIVE_TOKEN : outputToken

  const params = new URLSearchParams({
    sellToken,
    buyToken,
    sellAmount: amount.toString(),
    chainId: numericChainId.toString(),
    taker: userAddress || '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  })
  if (slippageBps) params.set('slippageBps', slippageBps.toString())

  // GATE-BLOCKER 1 FIX (2026-05-22): inject 0x v2 affiliate-fee params so
  // Spectre actually collects 1% on every EVM swap. Without these three
  // params 0x charges no fee, the swap completes for the user, but our
  // collector wallet receives nothing AND verifyEvmSwap returns
  // `no_fee_transfer` -> /api/swap/log returns 400 -> no telemetry either.
  // Fee charged in OUT-token (buyToken) per 0x v2 convention; verifyEvmSwap
  // matches a Transfer log to the configured fee wallet on any ERC-20.
  if (feeRecipient) {
    params.set('swapFeeRecipient', feeRecipient)
    params.set('swapFeeBps', feeBps.toString())
    params.set('swapFeeToken', buyToken)
  }

  const quoteUrl = `${ZEROX_API}/swap/permit2/quote?${params}`
  const headers = { '0x-api-key': ZEROX_API_KEY, '0x-version': 'v2' }
  const quoteRes = await fetch(quoteUrl, { headers })

  if (!quoteRes.ok) {
    const errText = await quoteRes.text()
    return res.status(quoteRes.status).json({ error: '0x quote failed', details: errText })
  }

  const quoteData = await quoteRes.json()

  // Price-impact backstop (L6). 0x returns estimatedPriceImpact as a percent
  // string ("12.5" = 12.5%). It can be null on v2 - only enforce when present.
  const zxImpactPct = Math.abs(parseFloat(quoteData.estimatedPriceImpact))
  if (Number.isFinite(zxImpactPct) && zxImpactPct > MAX_PRICE_IMPACT_PCT) {
    return res.status(422).json({ error: `Price impact too high (${zxImpactPct.toFixed(1)}%). Trade refused.`, estimatedPriceImpact: quoteData.estimatedPriceImpact })
  }

  return res.json({
    provider: '0x',
    chain: chainId,
    inputToken: sellToken,
    outputToken: buyToken,
    inputAmount: quoteData.sellAmount,
    outputAmount: quoteData.buyAmount,
    estimatedPriceImpact: quoteData.estimatedPriceImpact,
    totalNetworkFee: quoteData.totalNetworkFee,
    platformFee: { percentage: feeConfig.feePercentage || 1.0, bps: feeConfig.feeBps || 100 },
    route: quoteData.route,
    transaction: quoteData.transaction ? {
      to: quoteData.transaction.to,
      data: quoteData.transaction.data,
      value: quoteData.transaction.value,
      gas: quoteData.transaction.gas,
      gasPrice: quoteData.transaction.gasPrice,
    } : null,
    permit2: quoteData.permit2 || null,
  })
}
