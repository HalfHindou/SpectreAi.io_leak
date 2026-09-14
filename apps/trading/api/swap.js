/**
 * Vercel Serverless - Swap Quote + Log endpoint (2026-05-23: includes
 * unlink-fix + EVM-0x-fee-injection + Permit2-EIP712-validation deployed wave)
 * POST /api/swap/quote - Get swap quote from Jupiter (Solana) or 0x (EVM)
 * POST /api/swap/log - Log completed swap for analytics
 *
 * Rewrite rule in vercel.json maps:
 *   /api/swap/:action* -> /api/swap?action=:action*
 */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { verifyPrivyToken } from './_lib/auth.js'
import { rateLimit, userRateLimit } from './_lib/ratelimit.js'
import { getFeeConfig, claimIdempotencySlot, getIdempotencySlot, releaseIdempotencySlot, getWebhookTxStatus, logSwap as kvRecordActivity, getSwapHistory as kvGetHistory } from './_lib/kv.js'

// Pre-trade simulation core (CJS, shared with the dev Express route). Bundled
// via vercel.json includeFiles on api/swap.js.
const _require = createRequire(import.meta.url)
const { simulateSwap } = _require('../../../packages/server/lib/swap-simulate-core.js')

// X-Idempotency-Key validation. The client sends a v4 UUID per swap attempt
// (see apps/trading/src/services/swapService.js `makeIdempotencyKey`). Accept
// the broader UUID-or-base36 pattern so the fallback key shape also works.
// Length cap + character set prevents header-injection / KV-key-bloat attacks.
const IDEM_KEY_RE = /^[A-Za-z0-9_-]{1,200}$/

const ZEROX_API_KEY = process.env.ZEROX_API_KEY || ''
// Official Jupiter Swap API. The free QuickNode mirror (public.jupiterapi.com)
// builds STALE Pump.fun AMM instructions - every pump.fun-routed swap failed
// on-chain with Jupiter error 6014 IncorrectTokenProgramID (verified by
// simulation 2026-07-06: mirror build fails, official build succeeds for the
// identical quote). lite-api.jup.ag is Jupiter's official free tier; set
// JUPITER_API_URL to the paid api.jup.ag base when volume needs it.
const JUPITER_API = process.env.JUPITER_API_URL || 'https://lite-api.jup.ag/swap/v1'
// Optional API key (portal.jup.ag). With JUPITER_API_URL=https://api.jup.ag/swap/v1
// this unlocks the paid tier: consistent ~100-200ms quotes vs lite-api's
// free-tier variance (occasional 1-3s spikes users feel as "Getting quote").
const JUPITER_API_KEY = process.env.JUPITER_API_KEY || ''
const JUP_HEADERS = JUPITER_API_KEY ? { 'x-api-key': JUPITER_API_KEY } : {}

// One bounded retry on TRANSIENT upstream failures (network errors + 5xx
// gateway blips) - mirrors the Express twin's fetchUpstream. HTTP 4xx never
// retries (real answer, not a blip).
const RETRYABLE_STATUS = new Set([502, 503, 504])
async function fetchUpstream(url, opts) {
  try {
    const r = await fetch(url, opts)
    if (!RETRYABLE_STATUS.has(r.status)) return r
  } catch { /* fall through to retry */ }
  await new Promise((resolve) => setTimeout(resolve, 350))
  return fetch(url, opts)
}

const ZEROX_API = 'https://api.0x.org'
const ZEROX_CHAIN_IDS = { ethereum: 1, bsc: 56, polygon: 137, arbitrum: 42161, base: 8453, robinhood: 4663 }
const ZEROX_CHAINS = ZEROX_CHAIN_IDS

// SEC-20260513-RT-09: on-chain verification config.
// Public RPC fallbacks - admins should set the *_RPC_URL env vars in prod
// for reliability. These public endpoints are rate-limited and may be slow.
const EVM_RPC_FALLBACKS = {
  ethereum: 'https://ethereum-rpc.publicnode.com',
  bsc: 'https://bsc-dataseed.binance.org',
  polygon: 'https://polygon-bor-rpc.publicnode.com',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  base: 'https://mainnet.base.org',
  // Robinhood Chain official mainnet RPC. Used by verifyEvmSwap/verifyTxSigner
  // for on-chain fee + signer verification of swaps/withdrawals. Override with
  // ROBINHOOD_RPC_URL env for a keyed endpoint under load.
  robinhood: 'https://rpc.mainnet.chain.robinhood.com',
}
const SOLANA_RPC_FALLBACK = 'https://api.mainnet-beta.solana.com'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

// -- Jupiter fee account resolution ---------------------------------------
// Jupiter's `feeAccount` must be an INITIALIZED SPL token account for the
// quote's output (or input) mint. Passing the raw fee WALLET address does
// not error - Jupiter silently OMITS the fee (verified 2026-07-06 by
// decoding a built swap tx: the wallet key was absent from the account
// list), so the platform collected nothing and verifySolanaSwap's fee
// check rejected every Solana swap log. We derive the fee wallet's ATA for
// the mint and use it ONLY when it exists on-chain; otherwise fee params
// are skipped entirely so an uninitialized fee ATA can never fail a user's
// swap. Runbook: initialize fee ATAs for wSOL/USDC/USDT (privy-production
// runbook, Jupiter fee section).
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const SPL_ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
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
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || SOLANA_RPC_FALLBACK
    const conn = new Connection(rpcUrl, 'confirmed')
    const info = await conn.getAccountInfo(ata)
    const initialized = !!info && info.owner?.toBase58?.() === SPL_TOKEN_PROGRAM_ID
    const result = initialized ? ata.toBase58() : null
    // Positive hits are stable (ATAs are rarely closed) - cache 1h.
    // Negative hits re-check in 5min so a freshly initialized ATA starts
    // collecting fees without a redeploy.
    _feeAtaCache.set(cacheKey, { ata: result, expires: Date.now() + (initialized ? 3600_000 : 300_000) })
    return result
  } catch (err) {
    console.warn('[swap] Jupiter fee ATA resolve failed:', err.message)
    return null
  }
}

// Max allowed slippage in basis points. 5% is the sane ceiling for MEV protection.
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
export function isValidBaseUnitAmount(amount) {
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
// userId prefix (which is PII identifying the account). sha256 -> 12 hex chars
// is enough to correlate a user's lines within the logs without storing the
// DID itself in plaintext log aggregation.
function userTag(userId) {
  try {
    return createHash('sha256').update(String(userId)).digest('hex').slice(0, 12)
  } catch {
    return 'anon'
  }
}

// Fee config now persists in Vercel KV (shared key with research). See
// `_lib/kv.js` getFeeConfig - module-cached, defaults seeded from env vars.
async function loadFeeConfig() {
  return getFeeConfig()
}

// Return the SET of addresses we accept as valid fee-transfer destinations
// for on-chain verification of a swap log. Includes:
//   - the new single `collector` address (post-2026-05-22 unified custodial)
//   - the legacy `feeWallets.{primary,secondary,tertiary}` (transition window)
// During the migration both shapes may be populated; verification is permissive
// (any match passes) so a deploy that lands before env-vars are migrated still
// works. Once all envs are flipped, this collapses to just the collector.
// Returns lowercase strings for EVM, base58 (case-preserving) for SOL.
function getFeeWalletsForChain(feeConfig, chainKind) {
  const ZERO_SOL = '11111111111111111111111111111111'
  const out = new Set()
  const add = (addr) => {
    if (typeof addr !== 'string' || addr.length === 0 || addr === ZERO_SOL) return
    out.add(chainKind === 'evm' ? addr.toLowerCase() : addr)
  }
  // New shape: single collector.
  add(feeConfig?.collector?.[chainKind])
  // Legacy shape: tiered wallets.
  const wallets = feeConfig?.feeWallets || {}
  for (const tier of ['primary', 'secondary', 'tertiary']) {
    add(wallets?.[tier]?.[chainKind])
  }
  return Array.from(out)
}

// Read the SINGLE collector address (post-2026-05-22 unified custodial).
// Falls back to legacy `feeWallets.primary.{evm,solana}` during the deploy
// window so an old KV value doesn't break the swap path before env migration.
function getCollectorForChain(feeConfig, chainKind) {
  const ZERO_SOL = '11111111111111111111111111111111'
  const collector = feeConfig?.collector?.[chainKind] || feeConfig?.feeWallets?.primary?.[chainKind] || ''
  if (!collector || collector === ZERO_SOL) return ''
  return chainKind === 'evm' ? collector.toLowerCase() : collector
}

/**
 * Verify a Solana swap transaction matches the claimed signer and paid a
 * platform fee to one of our configured fee wallets.
 *
 * Returns { ok: true } on success or { ok: false, reason } on rejection.
 * Throws only on RPC / dependency errors (caller maps these to 502).
 */
async function verifySolanaSwap({ txHash, userAddress, feeWalletAddresses }) {
  const rpcUrl = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || SOLANA_RPC_FALLBACK
  const { Connection } = await import('@solana/web3.js')
  const conn = new Connection(rpcUrl, 'confirmed')

  // The tx may not be RPC-indexed the instant the client logs it (it just
  // confirmed, possibly on a different RPC). Retry ONLY the not-found case so a
  // genuinely-confirmed swap is never dropped as "tx_not_found" - that
  // false-negative is what loses REAL verified swaps from history. The
  // definitive rejections below (failed / wrong-signer / no-fee) do NOT retry:
  // the tx exists, it just isn't a valid fee-bearing swap.
  let tx = null
  for (let attempt = 0; attempt < 4; attempt++) {
    // eslint-disable-next-line no-await-in-loop
    tx = await conn.getParsedTransaction(txHash, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
    if (tx) break
    // eslint-disable-next-line no-await-in-loop
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1500))
  }
  if (!tx) return { ok: false, reason: 'tx_not_found' }
  if (tx.meta?.err) return { ok: false, reason: 'tx_failed' }

  // Signer check: userAddress must appear in the signer list.
  const accountKeys = tx.transaction?.message?.accountKeys || []
  const signers = accountKeys
    .filter(k => k.signer)
    .map(k => (typeof k.pubkey === 'string' ? k.pubkey : k.pubkey?.toBase58?.()))
    .filter(Boolean)
  if (!signers.includes(userAddress)) {
    return { ok: false, reason: 'wrong_signer' }
  }

  // Fee transfer check. The platform fee can appear in two places:
  //   (a) SPL token balance delta on the fee wallet (token-side fee), or
  //   (b) native SOL transfer to the fee wallet (lamport delta on a
  //       fee wallet account index).
  if (feeWalletAddresses.length === 0) {
    // No fee wallets configured for this chain - cannot verify fee transfer.
    // Treat as misconfiguration; reject to be safe rather than allow unverified logs.
    return { ok: false, reason: 'no_fee_wallets_configured' }
  }

  const postBalances = tx.meta?.postTokenBalances || []
  const preBalances = tx.meta?.preTokenBalances || []
  const feeWalletSet = new Set(feeWalletAddresses)

  // (a) Token fee: look for a positive token balance delta on a fee wallet.
  let foundTokenFee = false
  for (const post of postBalances) {
    if (!feeWalletSet.has(post.owner)) continue
    const postAmt = BigInt(post.uiTokenAmount?.amount || '0')
    const matchingPre = preBalances.find(p => p.accountIndex === post.accountIndex)
    const preAmt = matchingPre ? BigInt(matchingPre.uiTokenAmount?.amount || '0') : 0n
    if (postAmt > preAmt) { foundTokenFee = true; break }
  }
  if (foundTokenFee) return { ok: true }

  // (b) Native SOL fee: look for a positive lamport delta on a fee wallet account.
  const preLamports = tx.meta?.preBalances || []
  const postLamports = tx.meta?.postBalances || []
  for (let i = 0; i < accountKeys.length; i++) {
    const key = typeof accountKeys[i].pubkey === 'string'
      ? accountKeys[i].pubkey
      : accountKeys[i].pubkey?.toBase58?.()
    if (!key || !feeWalletSet.has(key)) continue
    const pre = BigInt(preLamports[i] || 0)
    const post = BigInt(postLamports[i] || 0)
    if (post > pre) return { ok: true }
  }

  // (c) Token-account owner match: platform fees land in the fee wallet's ATA;
  // postTokenBalances.owner is that ATA's owner, so (a) usually catches it -
  // this branch is for completeness when the balance rows omit owners.

  // No fee movement found. That is EXPECTED (not fraud) when the fee wallet
  // has no initialized ATA for any mint this swap touched - the quote layer
  // skips fee params in exactly that case (resolveJupiterFeeAccount), so the
  // signed tx genuinely carries no fee leg. Accept the log with
  // feeVerified:false; the SIGNER check above remains the anti-spoof gate.
  // Only when a fee ATA existed for a touched mint (fee was applicable but
  // absent from the tx) do we keep rejecting.
  const touchedMints = [...new Set(
    [...postBalances, ...preBalances].map(b => b?.mint).filter(Boolean)
  )]
  for (const mint of touchedMints) {
    for (const wallet of feeWalletAddresses) {
      // cached; at most a handful of RPC lookups per verification
      // eslint-disable-next-line no-await-in-loop
      if (await resolveJupiterFeeAccount(wallet, mint)) {
        return { ok: false, reason: 'no_fee_transfer' }
      }
    }
  }
  return { ok: true, feeVerified: false }
}

/**
 * Verify an EVM swap transaction matches the claimed signer and emitted an
 * ERC-20 Transfer event to one of our configured fee wallets.
 *
 * Uses raw JSON-RPC via ethers v6 (already a dep). Public RPC fallbacks are
 * used when *_RPC_URL env vars are unset.
 */
async function verifyEvmSwap({ chainId, txHash, userAddress, feeWalletAddresses }) {
  const envKey = `${chainId.toUpperCase()}_RPC_URL`
  const rpcUrl = process.env[envKey] || EVM_RPC_FALLBACKS[chainId]
  if (!rpcUrl) throw new Error(`No RPC configured for ${chainId}`)

  const { ethers } = await import('ethers')
  const provider = new ethers.JsonRpcProvider(rpcUrl)

  // Retry ONLY the not-found case: the server RPC can lag the client's
  // confirmation RPC, so a just-confirmed tx may not be indexed here yet.
  // Without this, a real confirmed tx is dropped as "tx_not_found" and never
  // reaches history. Definitive rejections below (failed / wrong-signer /
  // no-fee) do NOT retry.
  let tx = null, receipt = null
  for (let attempt = 0; attempt < 4; attempt++) {
    // eslint-disable-next-line no-await-in-loop
    ;[tx, receipt] = await Promise.all([
      provider.getTransaction(txHash),
      provider.getTransactionReceipt(txHash),
    ])
    if (tx && receipt) break
    // eslint-disable-next-line no-await-in-loop
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1500))
  }
  if (!tx || !receipt) return { ok: false, reason: 'tx_not_found' }
  if (receipt.status !== 1) return { ok: false, reason: 'tx_failed' }

  // Signer check: tx.from must equal userAddress (case-insensitive).
  if ((tx.from || '').toLowerCase() !== userAddress.toLowerCase()) {
    return { ok: false, reason: 'wrong_signer' }
  }

  // Fee transfer check. Either:
  //   (a) ERC-20 Transfer log whose 'to' (topic[2]) is a fee wallet, or
  //   (b) native value sent directly to a fee wallet (rare for swap routers
  //       but valid if tx.to is a fee wallet and tx.value > 0).
  if (feeWalletAddresses.length === 0) {
    return { ok: false, reason: 'no_fee_wallets_configured' }
  }
  const feeSet = new Set(feeWalletAddresses.map(a => a.toLowerCase()))

  // (a) ERC-20 Transfer event scan.
  for (const log of receipt.logs || []) {
    if (log.topics?.[0] !== TRANSFER_TOPIC) continue
    // topic[2] is the 32-byte padded 'to' address.
    const to32 = log.topics[2]
    if (typeof to32 !== 'string' || to32.length !== 66) continue
    const toAddr = ('0x' + to32.slice(26)).toLowerCase()
    if (feeSet.has(toAddr)) return { ok: true }
  }

  // (b) Direct native transfer to a fee wallet (top-level tx).
  const txTo = (tx.to || '').toLowerCase()
  const txValue = tx.value ? BigInt(tx.value) : 0n
  if (feeSet.has(txTo) && txValue > 0n) return { ok: true }

  // (c) Native fee delivered as an INTERNAL transfer from the swap router to the
  //     fee wallet - how 0x pays a NATIVE-token platform fee (our default now,
  //     so fees are ETH not the output memecoin). It's neither a receipt log nor
  //     the top-level tx.to, so walk the call tree. Best-effort: if the RPC
  //     doesn't expose debug_traceTransaction, fall through to the honest
  //     negative (the fee still landed on-chain; only this telemetry check misses).
  try {
    const trace = await provider.send('debug_traceTransaction', [txHash, { tracer: 'callTracer' }])
    const stack = [trace]
    while (stack.length) {
      const call = stack.pop()
      if (!call) continue
      const to = (call.to || '').toLowerCase()
      const val = call.value ? BigInt(call.value) : 0n
      if (feeSet.has(to) && val > 0n) return { ok: true }
      if (Array.isArray(call.calls)) stack.push(...call.calls)
    }
  } catch { /* RPC lacks call tracing - fall through */ }

  return { ok: false, reason: 'no_fee_transfer' }
}

/**
 * Signer-only on-chain verification (no fee check) - used by withdraw
 * logging, where no platform fee exists by design. Confirms the tx is real,
 * succeeded, and was signed by the claimed address.
 */
async function verifyTxSigner({ chainId, txHash, userAddress }) {
  const isSolana = chainId === 'solana' || chainId === '1399811149'
  if (isSolana) {
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || SOLANA_RPC_FALLBACK
    const { Connection } = await import('@solana/web3.js')
    const conn = new Connection(rpcUrl, 'confirmed')
    // Retry only the not-found case (server RPC lag vs the client's confirmation
    // RPC) so a just-confirmed withdrawal isn't false-dropped from history.
    let tx = null
    for (let attempt = 0; attempt < 4; attempt++) {
      // eslint-disable-next-line no-await-in-loop
      tx = await conn.getParsedTransaction(txHash, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
      if (tx) break
      // eslint-disable-next-line no-await-in-loop
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500))
    }
    if (!tx) return { ok: false, reason: 'tx_not_found' }
    if (tx.meta?.err) return { ok: false, reason: 'tx_failed' }
    const signers = (tx.transaction?.message?.accountKeys || [])
      .filter(k => k.signer)
      .map(k => (typeof k.pubkey === 'string' ? k.pubkey : k.pubkey?.toBase58?.()))
      .filter(Boolean)
    return signers.includes(userAddress) ? { ok: true } : { ok: false, reason: 'wrong_signer' }
  }
  if (!(chainId in ZEROX_CHAIN_IDS)) return { ok: false, reason: 'unsupported_chain' }
  const envKey = `${chainId.toUpperCase()}_RPC_URL`
  const rpcUrl = process.env[envKey] || EVM_RPC_FALLBACKS[chainId]
  if (!rpcUrl) throw new Error(`No RPC configured for ${chainId}`)
  const { ethers } = await import('ethers')
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  // Retry ONLY the not-found case: the server RPC can lag the client's
  // confirmation RPC, so a just-confirmed tx may not be indexed here yet.
  // Without this, a real confirmed tx is dropped as "tx_not_found" and never
  // reaches history. Definitive rejections below (failed / wrong-signer /
  // no-fee) do NOT retry.
  let tx = null, receipt = null
  for (let attempt = 0; attempt < 4; attempt++) {
    // eslint-disable-next-line no-await-in-loop
    ;[tx, receipt] = await Promise.all([
      provider.getTransaction(txHash),
      provider.getTransactionReceipt(txHash),
    ])
    if (tx && receipt) break
    // eslint-disable-next-line no-await-in-loop
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1500))
  }
  if (!tx || !receipt) return { ok: false, reason: 'tx_not_found' }
  if (receipt.status !== 1) return { ok: false, reason: 'tx_failed' }
  if ((tx.from || '').toLowerCase() !== userAddress.toLowerCase()) {
    return { ok: false, reason: 'wrong_signer' }
  }
  return { ok: true }
}

// CORS allow-list. Same-origin calls (trade.spectreai.io -> its own /api/*)
// don't trigger CORS at all, but any cross-origin caller (research app's
// embedded iframe parent, dev localhost, *.vercel.app preview deploys) must
// be on this list or the browser blocks reading the response. Echoing the
// matched origin (not '*') keeps credentialed requests working.
const ALLOWED_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:5181',
  'https://trade.spectreai.io',
  'https://app.spectreai.io',
  'https://spectre-trading.vercel.app',
  'https://spectre-app-research.vercel.app',
]

export default async function handler(req, res) {
  const origin = req.headers?.origin
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Idempotency-Key')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const action = req.query.action || ''

  // GET /api/swap/tx-status?hash=... - read the latest tx status the Privy
  // webhook recorded in KV (set by api/privy-webhook.js setWebhookTxStatus).
  // Lets the client's waitForConfirmation short-circuit RPC polling when the
  // webhook already knows the tx confirmed/failed. Public (tx status is
  // public on-chain data, keyed by hash) - no auth, light read.
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

  // GET /api/swap/history - per-user wallet activity (swaps + withdrawals).
  // Backs the dashboard Swap History section. Dev Express keeps an in-memory
  // twin; prod previously had NO history endpoint at all (the section could
  // never populate) - parity restored 2026-07-06.
  if (action === 'history' && req.method === 'GET') {
    if (await rateLimit(req, res, { bucket: 'swap-history-ip', max: 30, windowMs: 60_000 })) return
    const userId = await verifyPrivyToken(req)
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100)
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0)
    let swaps = []
    try {
      swaps = await kvGetHistory(userId, limit, offset)
    } catch (err) {
      console.warn('[swap/history] KV read failed:', err.message)
    }
    return res.json({ swaps, limit, offset })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (action === 'log') {
    // IP-level rate limit BEFORE auth (2026-05-22 hardening). Cheap defense
    // against unauthenticated-token spam burning per-user budgets; the auth
    // check (next) gates the real work but rejecting earlier is cheaper.
    if (await rateLimit(req, res, { bucket: 'swap-log-ip', max: 30, windowMs: 60_000 })) return

    // Order-engine internal branch: the Cloud Run worker logs TEE-signed
    // executions on behalf of the order owner. Bounded two ways: (1) the
    // on-chain signer + fee verification below still runs (a fake tx can't
    // pass), and (2) onBehalfOf must MATCH the owner of the referenced
    // order doc - a leaked key cannot attribute a real tx to an arbitrary
    // DID.
    let userId = null
    const internalHeader = req.headers['x-spectre-internal']
    const internalKey = process.env.ORDER_ENGINE_INTERNAL_KEY
    if (internalHeader && internalKey) {
      const { timingSafeEqual } = await import('crypto')
      const a = Buffer.from(String(internalHeader))
      const b = Buffer.from(String(internalKey))
      const bodyDid = req.body?.onBehalfOf
      const orderId = req.body?.orderId
      if (a.length === b.length && timingSafeEqual(a, b) &&
          typeof bodyDid === 'string' && bodyDid.startsWith('did:privy:') &&
          typeof orderId === 'string' && orderId.length <= 64) {
        try {
          const { createRequire } = await import('module')
          const _req = createRequire(import.meta.url)
          const ordersCore = _req('../../../packages/server/lib/agent-orders-core.js')
          const orderDoc = await ordersCore.getOrder(orderId)
          if (orderDoc && orderDoc.owner === bodyDid) {
            userId = bodyDid
            console.log(`[swap/log] internal (order-engine) order=${orderId} owner=${userTag(userId)}`)
          } else {
            console.warn(`[swap/log] internal branch REJECTED: onBehalfOf does not own order ${orderId}`)
          }
        } catch (err) {
          console.warn('[swap/log] internal branch order lookup failed:', err?.message)
        }
      }
    }
    if (!userId) {
      userId = await verifyPrivyToken(req)
      if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    }
    // 5 log entries per minute per user. A real signing flow lands one log
    // call per swap; this comfortably covers retries and rules out spamming
    // fake hashes to pollute analytics / future fee-rebate logic.
    if (await userRateLimit(res, { bucket: 'swap-log', userId, max: 5, windowMs: 60_000 })) return

    const { chainId, txHash, inputToken, outputToken, inputAmount, outputAmount, userAddress } = req.body || {}
    if (typeof txHash !== 'string' || !TX_HASH_RE.test(txHash)) {
      return res.status(400).json({ error: 'Invalid txHash' })
    }
    if (typeof userAddress !== 'string' || userAddress.length === 0) {
      return res.status(400).json({ error: 'Missing userAddress' })
    }

    // Idempotency dedupe. The client generates a UUID per swap attempt and
    // sends it as X-Idempotency-Key. We claim the slot atomically (SET NX EX 24h)
    // BEFORE running the expensive on-chain verification - so a flaky-network
    // retry doesn't trigger two RPC fetches + two log writes for the same tx.
    // If the slot was already claimed with a DIFFERENT txHash, that signals
    // either a buggy client or an attacker trying to bind one UUID to multiple
    // claims; reject with 409.
    const rawIdemKey = req.headers['x-idempotency-key']
    const idemKey = typeof rawIdemKey === 'string' && IDEM_KEY_RE.test(rawIdemKey) ? rawIdemKey : null
    let idemClaimed = false
    if (idemKey) {
      // 300s claim TTL (not 24h): bounds the "stuck slot" window if the
      // function dies between claim and verify (Vercel timeout / OOM during
      // the on-chain RPC call). 5 min covers every realistic flaky-network
      // retry; beyond that a re-log is acceptable vs silently dropping a swap.
      idemClaimed = await claimIdempotencySlot('swap-log', idemKey, { txHash, userId: userId.slice(0, 32), ts: Date.now() }, 300)
      if (!idemClaimed) {
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

    // SEC-20260513-RT-09: on-chain verification before logging.
    // Without this, anyone with a valid Privy JWT could POST arbitrary real
    // mainnet hashes to inflate fake swap volume / game future fee-rebate
    // or referral-volume programs. The Privy gate + 5/min rate limit alone
    // were insufficient: a single attacker still had a 5/min ceiling of
    // unlimited fake entries. We now confirm:
    //   1. The tx is real and succeeded
    //   2. The claimed userAddress actually signed it
    //   3. A platform fee transfer to one of our configured fee wallets
    //      appears in the receipt (token-side or native-side)
    const feeConfig = await loadFeeConfig()
    const isSolana = chainId === 'solana' || chainId === '1399811149'
    const chainKind = isSolana ? 'solana' : 'evm'
    const feeWalletAddresses = getFeeWalletsForChain(feeConfig, chainKind)

    let verification
    try {
      if (isSolana) {
        verification = await verifySolanaSwap({ txHash, userAddress, feeWalletAddresses })
      } else if (chainId in ZEROX_CHAIN_IDS) {
        verification = await verifyEvmSwap({ chainId, txHash, userAddress, feeWalletAddresses })
      } else {
        if (idemClaimed) await releaseIdempotencySlot('swap-log', idemKey).catch(() => {})
        return res.status(400).json({ error: `Unsupported chain: ${safeLog(chainId)}` })
      }
    } catch (err) {
      console.error('[swap/log] Verification error:', err?.message, 'user=', userTag(userId), 'tx=', txHash)
      // Release the idempotency claim so a retry (e.g., after the RPC recovers)
      // can re-run verification rather than getting cached failure.
      if (idemClaimed) await releaseIdempotencySlot('swap-log', idemKey).catch(() => {})
      return res.status(502).json({ error: 'On-chain verification failed' })
    }

    if (!verification?.ok) {
      console.warn('[swap/log] Verification rejected:', verification?.reason, 'user=', userTag(userId), 'tx=', txHash)
      // Release the claim - the user may retry with corrected payload.
      if (idemClaimed) await releaseIdempotencySlot('swap-log', idemKey).catch(() => {})
      return res.status(400).json({ error: 'Transaction does not match claimed swap', reason: verification?.reason })
    }

    // Log token pair + chain + tx for ops, but NOT the trade amounts (PII-ish
    // financial detail) and only a hashed user tag.
    console.log(`[swap/log] verified user=${userTag(userId)} ${safeLog(chainId)} tx=${txHash} ${safeLog(inputToken)} -> ${safeLog(outputToken)}`)

    // Persist to the per-user KV history (amounts stay in KV only - the
    // authed owner reads them back via /api/swap/history; log lines above
    // stay amount-free per the L8 privacy scrub). Best-effort: a KV outage
    // must not fail a verified log ack.
    try {
      const b = req.body || {}
      const clampSym = (s) => (typeof s === 'string' ? s.slice(0, 16) : null)
      const clampDec = (d) => (Number.isFinite(Number(d)) && Number(d) >= 0 && Number(d) <= 36 ? Number(d) : null)
      const clampLogo = (u) => (typeof u === 'string' && /^(https?:|data:image\/)/.test(u) ? u.slice(0, 512) : null)
      await kvRecordActivity(userId, {
        type: 'swap',
        chainId: safeLog(chainId),
        txHash,
        inputToken: safeLog(inputToken),
        outputToken: safeLog(outputToken),
        inputAmount: safeLog(inputAmount),
        outputAmount: safeLog(outputAmount),
        feeVerified: verification?.feeVerified !== false,
        // Display metadata for the history UI (bounded, type-checked).
        side: b.side === 'sell' ? 'sell' : b.side === 'buy' ? 'buy' : null,
        inputSymbol: clampSym(b.inputSymbol),
        outputSymbol: clampSym(b.outputSymbol),
        inputDecimals: clampDec(b.inputDecimals),
        outputDecimals: clampDec(b.outputDecimals),
        inputLogo: clampLogo(b.inputLogo),
        outputLogo: clampLogo(b.outputLogo),
        tokenSymbol: clampSym(b.tokenSymbol),
        usd: Number.isFinite(Number(b.usd)) ? Number(b.usd) : null,
      })
    } catch (err) {
      console.warn('[swap/log] KV history write failed:', err.message)
    }
    return res.json({ ok: true })
  }

  // POST /api/swap/withdraw-log - record a completed WITHDRAWAL in the same
  // per-user history. Signer-only on-chain verification (withdrawals carry
  // no platform fee by design); idempotent like swap-log. The client fires
  // this after Privy sendTransaction resolves (fire-and-forget).
  if (action === 'withdraw-log') {
    if (await rateLimit(req, res, { bucket: 'withdraw-log-ip', max: 30, windowMs: 60_000 })) return

    const userId = await verifyPrivyToken(req)
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    if (await userRateLimit(res, { bucket: 'withdraw-log', userId, max: 5, windowMs: 60_000 })) return

    const { chainId, txHash, token, amount, toAddress, userAddress } = req.body || {}
    if (typeof txHash !== 'string' || !TX_HASH_RE.test(txHash)) {
      return res.status(400).json({ error: 'Invalid txHash' })
    }
    if (typeof userAddress !== 'string' || userAddress.length === 0) {
      return res.status(400).json({ error: 'Missing userAddress' })
    }
    if (typeof toAddress !== 'string' || toAddress.length === 0 || toAddress.length > 100) {
      return res.status(400).json({ error: 'Invalid toAddress' })
    }

    const rawIdemKey = req.headers['x-idempotency-key']
    const idemKey = typeof rawIdemKey === 'string' && IDEM_KEY_RE.test(rawIdemKey) ? rawIdemKey : null
    let idemClaimed = false
    if (idemKey) {
      idemClaimed = await claimIdempotencySlot('withdraw-log', idemKey, { txHash, userId: userId.slice(0, 32), ts: Date.now() }, 300)
      if (!idemClaimed) {
        const existing = await getIdempotencySlot('withdraw-log', idemKey)
        const parsed = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : null
        if (parsed?.txHash && parsed.txHash !== txHash) {
          return res.status(409).json({ error: 'idempotency_key_conflict' })
        }
        return res.json({ ok: true, idempotent: true })
      }
    }

    let verification
    try {
      verification = await verifyTxSigner({ chainId, txHash, userAddress })
    } catch (err) {
      console.error('[withdraw/log] Verification error:', err?.message, 'user=', userTag(userId), 'tx=', txHash)
      if (idemClaimed) await releaseIdempotencySlot('withdraw-log', idemKey).catch(() => {})
      return res.status(502).json({ error: 'On-chain verification failed' })
    }
    if (!verification?.ok) {
      console.warn('[withdraw/log] Verification rejected:', verification?.reason, 'user=', userTag(userId), 'tx=', txHash)
      if (idemClaimed) await releaseIdempotencySlot('withdraw-log', idemKey).catch(() => {})
      return res.status(400).json({ error: 'Transaction does not match claimed withdrawal', reason: verification?.reason })
    }

    console.log(`[withdraw/log] verified user=${userTag(userId)} ${safeLog(chainId)} tx=${txHash} ${safeLog(token)}`)
    try {
      await kvRecordActivity(userId, {
        type: 'withdraw',
        chainId: safeLog(chainId),
        txHash,
        inputToken: safeLog(token),
        outputToken: 'withdrawal',
        inputAmount: safeLog(amount),
        outputAmount: '',
        toAddress: safeLog(toAddress),
      })
    } catch (err) {
      console.warn('[withdraw/log] KV history write failed:', err.message)
    }
    return res.json({ ok: true })
  }

  if (action === 'quote') {
    // Per-IP ceiling (catches anon traffic and unauth abusers).
    if (await rateLimit(req, res, { bucket: 'swap-quote', max: 30, windowMs: 60_000 })) return
    // Per-user ceiling (catches a single tester behind a NAT churning quotes,
    // or a stolen JWT amplifying upstream Jupiter / 0x cost). Quote endpoint
    // doesn't strictly require auth, so userId may be null - userRateLimit
    // is a no-op when userId is missing, falling back to the per-IP cap only.
    const quoteUserId = await verifyPrivyToken(req)
    if (quoteUserId && await userRateLimit(res, { bucket: 'swap-quote', userId: quoteUserId, max: 10, windowMs: 60_000 })) return
    return await handleQuote(req, res)
  }

  if (action === 'simulate') {
    if (await rateLimit(req, res, { bucket: 'swap-simulate', max: 30, windowMs: 60_000 })) return
    const simUserId = await verifyPrivyToken(req)
    if (simUserId && await userRateLimit(res, { bucket: 'swap-simulate', userId: simUserId, max: 15, windowMs: 60_000 })) return
    return await handleSimulate(req, res)
  }

  return res.status(400).json({ error: `Unknown action: ${action}` })
}

// Dry-run a trade (no signature, no gas) and report whether it would execute,
// revert (with a reason), or is inconclusive. Prod twin of the dev Express
// /api/swap/simulate route; both call the shared swap-simulate-core.
async function handleSimulate(req, res) {
  try {
    const { chainId, inputToken, outputToken, amount, userAddress } = req.body || {}
    const slippageBps = clampSlippage(req.body?.slippageBps ?? 50)
    if (!chainId || !inputToken || !outputToken || !amount || !userAddress) {
      return res.status(400).json({ error: 'Missing required fields: chainId, inputToken, outputToken, amount, userAddress' })
    }
    if (!isValidBaseUnitAmount(amount)) {
      return res.status(400).json({ error: 'Invalid amount: must be a positive integer in base units' })
    }
    res.setHeader('Cache-Control', 'private, no-store')
    const result = await simulateSwap({ chainId, inputToken, outputToken, amount, userAddress, slippageBps })
    return res.status(200).json(result)
  } catch (err) {
    console.error('[swap/simulate] Error:', err.message)
    return res.status(200).json({ ok: null, inconclusive: true, reason: 'Simulation error. Try again.' })
  }
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

const WSOL_MINT_STR = 'So11111111111111111111111111111111111111112'

// The 90/5/5 SOL fee recipients. Prefers the 3 env recipients (same vars the
// distribute cron uses), else the 3 feeWallets in the config.
function getSolFeeRecipients(feeConfig) {
  const env3 = [
    { address: process.env.FEE_RECIPIENT_SOL_PRIMARY, shareBps: 9000 },
    { address: process.env.FEE_RECIPIENT_SOL_SECONDARY, shareBps: 500 },
    { address: process.env.FEE_RECIPIENT_SOL_TERTIARY, shareBps: 500 },
  ].filter((r) => r.address)
  if (env3.length === 3) return env3
  const fw = feeConfig.feeWallets || {}
  return [
    { address: fw.primary?.solana, shareBps: Math.round((fw.primary?.share ?? 90) * 100) },
    { address: fw.secondary?.solana, shareBps: Math.round((fw.secondary?.share ?? 5) * 100) },
    { address: fw.tertiary?.solana, shareBps: Math.round((fw.tertiary?.share ?? 5) * 100) },
  ].filter((r) => r.address)
}

// Split a lamport total by shareBps; last recipient gets the remainder.
function splitFeeLamports(total, recipients) {
  const t = BigInt(total)
  let assigned = 0n
  return recipients.map((r, i) => {
    if (i === recipients.length - 1) return { address: r.address, lamports: t - assigned }
    const part = (t * BigInt(r.shareBps)) / 10000n
    assigned += part
    return { address: r.address, lamports: part }
  })
}

// Every recipient must ALREADY be rent-exempt, else a sub-rent fee transfer to
// a fresh account reverts the whole swap (InsufficientFundsForRent). Prod
// recipients are funded platform wallets; this only guards a misconfig - fall
// back feeless rather than break the trade. Cached 10min per recipient set.
const RENT_EXEMPT_MIN_LAMPORTS = 900000
const _recipientsFundedCache = new Map()
async function recipientsAreFunded(conn, recipients, PublicKey) {
  const key = recipients.map((r) => r.address).join(',')
  const hit = _recipientsFundedCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.ok
  try {
    const infos = await conn.getMultipleAccountsInfo(recipients.map((r) => new PublicKey(r.address)))
    const ok = infos.every((i) => i && i.lamports >= RENT_EXEMPT_MIN_LAMPORTS)
    _recipientsFundedCache.set(key, { ok, expires: Date.now() + 600000 })
    return ok
  } catch {
    return false
  }
}

// Collect the platform fee as OUR OWN 90/5/5 SOL transfers appended to the swap
// tx - route-agnostic, so it works on Pump.fun where Jupiter's built-in
// platformFee 6014s. /swap-instructions + recompile a v0 tx with the fee
// transfers appended (validated by scripts/proto-fee-swap.mjs). Returns
// { swapTransaction (base64), lastValidBlockHeight } or null on any failure
// (caller falls back to a feeless /swap so a trade is never blocked).
async function buildJupiterSwapWithFees({ quoteData, userAddress, feeLamports, recipients, slippageBps }) {
  try {
    const { Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, SystemProgram } = await import('@solana/web3.js')
    const siRes = await fetchUpstream(`${JUPITER_API}/swap-instructions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...JUP_HEADERS },
      body: JSON.stringify({ quoteResponse: quoteData, userPublicKey: userAddress, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, dynamicSlippage: { maxBps: slippageBps } }),
    })
    if (!siRes.ok) return null
    const si = await siRes.json()
    if (si.error || !si.swapInstruction) return null

    const user = new PublicKey(userAddress)
    const de = (ix) => new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys: (ix.accounts || []).map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
      data: Buffer.from(ix.data, 'base64'),
    })
    const ixs = []
    ;(si.computeBudgetInstructions || []).forEach((i) => ixs.push(de(i)))
    ;(si.setupInstructions || []).forEach((i) => ixs.push(de(i)))
    ixs.push(de(si.swapInstruction))
    if (si.cleanupInstruction) ixs.push(de(si.cleanupInstruction))
    for (const s of splitFeeLamports(feeLamports, recipients)) {
      if (s.lamports > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: user, toPubkey: new PublicKey(s.address), lamports: s.lamports }))
    }

    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || SOLANA_RPC_FALLBACK
    const conn = new Connection(rpcUrl, 'confirmed')
    // Fetch the funded-check, ALL address-lookup-tables, and the blockhash in
    // PARALLEL. These were sequential (1 + N + 1 RPC round-trips) and were the
    // entire reason the fee-bearing Solana build took several seconds on a slow
    // RPC - each ALT was fetched one-at-a-time.
    const altAddrs = si.addressLookupTableAddresses || []
    const [funded, altResults, latest] = await Promise.all([
      recipientsAreFunded(conn, recipients, PublicKey),
      Promise.all(altAddrs.map((a) => conn.getAddressLookupTable(new PublicKey(a)).then((r) => r.value).catch(() => null))),
      conn.getLatestBlockhash(),
    ])
    // Fail-safe: skip fee collection (feeless) if any recipient is underfunded.
    if (!funded) {
      console.warn('[swap] a fee recipient is not rent-exempt - building feeless to protect the trade')
      return null
    }
    const alts = altResults.filter(Boolean)
    const { blockhash, lastValidBlockHeight } = latest
    const msg = new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(alts)
    const tx = new VersionedTransaction(msg)
    return { swapTransaction: Buffer.from(tx.serialize()).toString('base64'), lastValidBlockHeight }
  } catch (err) {
    console.warn('[swap] buildJupiterSwapWithFees failed, falling back feeless:', err.message)
    return null
  }
}

async function handleJupiterQuote(res, { inputToken, outputToken, amount, slippageBps, userAddress, feeConfig }) {
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

  // Fee is collected via OUR OWN 90/5/5 SOL transfers appended to the swap tx
  // (buildJupiterSwapWithFees) - NOT Jupiter's platformFee, which 6014s on
  // Pump.fun routes. So the QUOTE stays feeless (no platformFeeBps).
  const feeRecipients = getSolFeeRecipients(feeConfig)

  const quoteUrl = `${JUPITER_API}/quote?${params}`
  const quoteRes = await fetchUpstream(quoteUrl, { headers: JUP_HEADERS })

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
    // Fee = feeBps of the SOL leg (buy: input SOL; sell: output SOL). Only
    // SOL-paired trades collect; token<->token (no SOL leg) stays feeless.
    let feeLamports = 0n
    if (inputMint === WSOL_MINT_STR) feeLamports = (BigInt(quoteData.inAmount) * BigInt(feeBps)) / 10000n
    else if (outputMint === WSOL_MINT_STR) feeLamports = (BigInt(quoteData.outAmount) * BigInt(feeBps)) / 10000n

    let swapTransaction = null
    let lastValidBlockHeight = null
    let feeCollected = false

    // Preferred path: collect via our own 90/5/5 SOL transfers (route-agnostic,
    // works on Pump.fun). Falls back to feeless /swap on any failure.
    if (feeRecipients.length > 0 && feeLamports > 0n) {
      const built = await buildJupiterSwapWithFees({ quoteData, userAddress, feeLamports, recipients: feeRecipients, slippageBps })
      if (built) {
        swapTransaction = built.swapTransaction
        lastValidBlockHeight = built.lastValidBlockHeight
        feeCollected = true
      }
    }

    // Feeless build (no recipients, non-SOL pair, or the fee build failed).
    if (!swapTransaction) {
      const swapRes = await fetchUpstream(`${JUPITER_API}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...JUP_HEADERS },
        body: JSON.stringify({
          quoteResponse: quoteData,
          userPublicKey: userAddress,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto',
          dynamicSlippage: { maxBps: slippageBps },
        }),
      })
      if (!swapRes.ok) {
        const errText = await swapRes.text()
        return res.status(swapRes.status).json({ error: 'Jupiter swap tx failed', details: errText })
      }
      const swapData = await swapRes.json()
      swapTransaction = swapData.swapTransaction
      lastValidBlockHeight = swapData.lastValidBlockHeight
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
      platformFee: feeCollected ? {
        percentage: feeConfig.feePercentage || 1.0,
        bps: feeBps,
        lamports: feeLamports.toString(),
        recipients: feeRecipients.map((r) => ({ address: r.address, shareBps: r.shareBps })),
      } : null,
      routePlan: quoteData.routePlan?.map(r => ({ swapInfo: { label: r.swapInfo?.label }, percent: r.percent })),
      swapTransaction,
      lastValidBlockHeight,
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
    platformFee: null,
    routePlan: quoteData.routePlan?.map(r => ({ swapInfo: { label: r.swapInfo?.label }, percent: r.percent })),
  })
}

// Stablecoins per chain - fee falls back here when NEITHER leg is native.
const FEE_STABLES = {
  1: new Set(['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '0xdac17f958d2ee523a2206206994597c13d831ec7', '0x6b175474e89094c44da98b954eedeac495271d0f']),
  8453: new Set(['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913']),
  42161: new Set(['0xaf88d065e77c8cc2239327c5edb3a432268e5831', '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9']),
  56: new Set(['0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', '0x55d398326f99059ff775485246999027b3197955']),
  137: new Set(['0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', '0xc2132d05d31c914a87c6611c10748aecb1b4c07d']),
}

// Take the 1% fee in the LIQUID / base leg (native ETH, else a stable), never
// the output memecoin - so we collect value that survives to the distribution
// sweep. 0x requires swapFeeToken to be the sell or buy token. Verified: 0x
// accepts the native sentinel and returns the fee in ETH on both buys+sells.
function pickFeeToken(sellToken, buyToken, numericChainId, nativeToken) {
  const s = sellToken.toLowerCase(), b = buyToken.toLowerCase(), n = nativeToken.toLowerCase()
  if (s === n || b === n) return nativeToken
  const stables = FEE_STABLES[numericChainId]
  if (stables) { if (stables.has(b)) return buyToken; if (stables.has(s)) return sellToken }
  return sellToken
}

async function handleZeroxQuote(res, { chainId, inputToken, outputToken, amount, slippageBps, userAddress, feeConfig }) {
  const numericChainId = ZEROX_CHAIN_IDS[chainId]
  if (!numericChainId) return res.status(400).json({ error: `Unsupported EVM chain: ${chainId}` })

  // Use the unified, env-aware collector resolver (collector.evm, which
  // normalizeFeeConfig now backfills from COLLECTOR_EVM_ADDRESS, falling back to
  // legacy feeWallets.primary.evm) - NOT the raw feeWallets.primary.evm, which
  // stays empty in a KV config seeded before the env existed.
  const feeRecipient = getCollectorForChain(feeConfig, 'evm')
  const feeBps = feeConfig.feeBps || 100
  const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
  const sellToken = inputToken === 'native' ? NATIVE_TOKEN : inputToken
  const buyToken = outputToken === 'native' ? NATIVE_TOKEN : outputToken

  const params = new URLSearchParams({
    sellToken,
    buyToken,
    sellAmount: amount.toString(),
    chainId: numericChainId.toString(),
  })
  if (userAddress) params.set('taker', userAddress)
  if (slippageBps) params.set('slippageBps', slippageBps.toString())

  // GATE-BLOCKER 1 FIX (2026-05-22): inject 0x v2 affiliate-fee params so
  // Spectre actually collects 1% on every EVM swap. Without these three
  // params 0x charges no fee, the swap completes for the user, but our
  // collector wallet receives nothing AND verifyEvmSwap (below) returns
  // `no_fee_transfer` -> /api/swap/log returns 400 -> we have no telemetry
  // either. Fee is charged in the OUT-token (buyToken) per 0x v2 convention;
  // verifyEvmSwap matches a Transfer log to the configured fee wallet on
  // any ERC-20 so this is consistent. Native-out is handled because 0x
  // wraps WETH internally for fee-collection on native buys. Skip when no
  // recipient is configured so local dev without env vars still works.
  if (feeRecipient) {
    params.set('swapFeeRecipient', feeRecipient)
    params.set('swapFeeBps', feeBps.toString())
    params.set('swapFeeToken', pickFeeToken(sellToken, buyToken, numericChainId, NATIVE_TOKEN))
  }

  // No wallet yet = a DISPLAY quote: 0x's /price endpoint (indicative,
  // faster, no calldata). Executable /quote once a real taker exists; the
  // client self-heals a tx-less quote at click time.
  const zxEndpoint = userAddress ? 'quote' : 'price'
  const quoteUrl = `${ZEROX_API}/swap/permit2/${zxEndpoint}?${params}`
  const headers = { '0x-api-key': ZEROX_API_KEY, '0x-version': 'v2' }
  const quoteRes = await fetchUpstream(quoteUrl, { headers })

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

  // N1 (2026-06-09 audit): sanity-guard the settlement target before it reaches
  // the client. The CLIENT already gates router substitution via the EIP-712
  // spender===tx.to check (swapService.js assertSafePermit2EIP712), so this is
  // defense-in-depth. NOTE: we deliberately do NOT hardcode an allowlist of 0x
  // Settler addresses - 0x rotates its v2 Settler contracts (~monthly), so a
  // static list would silently break swaps on the next rotation. Instead we
  // assert the upstream `transaction.to` is a well-formed, non-zero EVM address
  // that is NOT one of the swap's own token contracts (a router is never the
  // token; a `to` pointing at sellToken/buyToken signals a malformed or poisoned
  // quote). Brittleness-free, catches a tampered upstream response server-side.
  const txTo = quoteData.transaction?.to
  if (txTo) {
    const to = String(txTo).toLowerCase()
    const isAddr = /^0x[a-f0-9]{40}$/.test(to)
    const isZero = to === '0x0000000000000000000000000000000000000000'
    const isTokenAddr = to === String(sellToken).toLowerCase() || to === String(buyToken).toLowerCase()
    if (!isAddr || isZero || isTokenAddr) {
      console.error('[swap] 0x quote rejected: suspicious settlement target', { to, chainId })
      return res.status(502).json({ error: 'Swap route validation failed. Trade refused.' })
    }
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
    platformFee: { percentage: feeConfig.feePercentage || 1.0, bps: feeConfig.feeBps || 100, recipient: feeRecipient || null },
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
