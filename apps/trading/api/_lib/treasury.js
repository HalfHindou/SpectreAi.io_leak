/**
 * Treasury helpers (2026-05-22): collector enumeration, swap quoting,
 * USDC consolidation, and recipient distribution for the daily
 * consolidate-and-distribute cron.
 *
 * Design notes:
 *  - SERVER-ONLY. Decrypts the collector signing keys from process.env
 *    at call time. NEVER returned by any public endpoint.
 *  - v1 uses a WHITELIST of well-known fee tokens per chain (covers
 *    ~95% of beta fee value); full ERC-20 discovery via Etherscan-family
 *    APIs is a post-beta upgrade. Tokens outside the whitelist are dust
 *    until the upgrade lands.
 *  - All thresholds + addresses live in env vars so they're tunable
 *    without redeploy. See `.env.example` for the full list.
 *  - Swap path delegates to the same Jupiter (Solana) / 0x v2 (EVM)
 *    quote APIs used by the user-facing /api/swap/quote handler.
 */

// ---------- Chains, USDC, native sentinel ----------

export const CHAINS = ['ethereum', 'bsc', 'polygon', 'arbitrum', 'base', 'solana']

// Canonical USDC mints/addresses per chain. Verified against:
//   - https://www.circle.com/multi-chain-usdc (EVM)
//   - https://www.coingecko.com/coins/usd-coin (Solana mint)
export const USDC = {
  ethereum: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  bsc:      { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 }, // native USDC (Circle)
  polygon:  { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },  // native USDC (post-2023 migration)
  arbitrum: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },  // native USDC
  base:     { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },  // native USDC
  solana:   { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
}

export const EVM_NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

// Native wrapped tokens (for swap routing on EVM - 0x handles native via the sentinel).
export const WRAPPED_NATIVE = {
  ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
  bsc:      '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
  polygon:  '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
  arbitrum: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH (Arb)
  base:     '0x4200000000000000000000000000000000000006', // WETH (Base)
}

// Whitelist of fee tokens we actively enumerate + consolidate.
// Beta-scope: top tokens by trading volume per chain. Add more as needed
// in env via FEE_TOKEN_WHITELIST_<CHAIN>="0x..,0x..,0x.." (comma sep).
const DEFAULT_FEE_TOKEN_WHITELIST = {
  ethereum: [
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
  ],
  bsc: [
    '0x55d398326f99059fF775485246999027B3197955', // USDT
    '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', // BUSD
    '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC
  ],
  polygon: [
    '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC (native)
    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC.e (bridged)
    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT
    '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
    '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // WETH
  ],
  arbitrum: [
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
    '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // USDC.e
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
    '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
    '0x912CE59144191C1204E64559FE8253a0e49E6548', // ARB
  ],
  base: [
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
    '0x4200000000000000000000000000000000000006', // WETH
  ],
}

export function getFeeTokenWhitelist(chain) {
  const envKey = `FEE_TOKEN_WHITELIST_${chain.toUpperCase()}`
  const raw = process.env[envKey]
  if (raw && typeof raw === 'string') {
    return raw.split(',').map(s => s.trim()).filter(s => /^0x[a-fA-F0-9]{40}$/.test(s))
  }
  return DEFAULT_FEE_TOKEN_WHITELIST[chain] || []
}

// ---------- Chain numeric IDs (matches swap.js + swapService.js) ----------

export const EVM_NUMERIC_ID = {
  ethereum: 1,
  bsc:      56,
  polygon:  137,
  arbitrum: 42161,
  base:     8453,
}

// ---------- RPC URLs ----------

export function getEvmRpc(chain) {
  const envKey = `${chain.toUpperCase()}_RPC_URL`
  return process.env[envKey] || EVM_RPC_FALLBACK[chain]
}
const EVM_RPC_FALLBACK = {
  ethereum: 'https://ethereum-rpc.publicnode.com',
  bsc:      'https://bsc-dataseed.binance.org',
  polygon:  'https://polygon-bor-rpc.publicnode.com',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  base:     'https://mainnet.base.org',
}
export function getSolanaRpc() {
  return process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
}

// ---------- Collector address + signer (key decryption point) ----------

// Public collector address - safe to log, exposed via /api/fee-config too.
export function getCollectorAddress(chain) {
  if (chain === 'solana') return process.env.COLLECTOR_SOL_ADDRESS || ''
  return (process.env.COLLECTOR_EVM_ADDRESS || '').toLowerCase()
}

// Private key. SERVER-ONLY. Throws if missing. NEVER log this; NEVER return
// it from any handler. The cron handler invokes this once per run per chain
// and discards after signing.
//
// COLLECTOR_SOL_SECRET_KEY accepts EITHER:
//   - a JSON array of 64 bytes ("[1,2,3,...]" - solana-keygen output format), OR
//   - a base58 string (Phantom "Export Private Key" output, ~88 chars).
// COLLECTOR_EVM_PRIVATE_KEY = hex 0x... (64 hex chars, 0x prefix optional).
export async function getCollectorSigner(chain) {
  if (chain === 'solana') {
    const raw = (process.env.COLLECTOR_SOL_SECRET_KEY || '').trim()
    if (!raw) throw new Error('COLLECTOR_SOL_SECRET_KEY not set')
    const { Keypair } = await import('@solana/web3.js')
    const bytes = decodeSolanaSecret(raw)
    if (bytes.length !== 64) throw new Error(`COLLECTOR_SOL_SECRET_KEY decoded to ${bytes.length} bytes; expected 64`)
    return Keypair.fromSecretKey(bytes)
  }
  // EVM (same secp256k1 key used on all 5 chains).
  const raw = (process.env.COLLECTOR_EVM_PRIVATE_KEY || '').trim()
  if (!raw) throw new Error('COLLECTOR_EVM_PRIVATE_KEY not set')
  const { ethers } = await import('ethers')
  const provider = new ethers.JsonRpcProvider(getEvmRpc(chain))
  const pk = raw.startsWith('0x') ? raw : `0x${raw}`
  return new ethers.Wallet(pk, provider)
}

// Minimal base58 decoder (Bitcoin alphabet). ~30 LOC; avoids adding bs58 dep.
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58Decode(s) {
  const map = new Map([...B58_ALPHABET].map((c, i) => [c, i]))
  let num = 0n
  for (const ch of s) {
    const v = map.get(ch)
    if (v === undefined) throw new Error(`Invalid base58 char: ${ch}`)
    num = num * 58n + BigInt(v)
  }
  // Convert BigInt to bytes (big-endian).
  const out = []
  while (num > 0n) { out.push(Number(num & 0xffn)); num >>= 8n }
  // Leading '1' chars in base58 = leading zero bytes.
  for (const ch of s) { if (ch === '1') out.push(0); else break }
  return new Uint8Array(out.reverse())
}

function decodeSolanaSecret(raw) {
  if (raw.startsWith('[')) {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) throw new Error('Solana secret JSON must be an array')
    return new Uint8Array(arr)
  }
  return base58Decode(raw)
}

// ---------- Recipients (90/5/5 USDC destinations) ----------

export function getRecipients(chain) {
  if (chain === 'solana') {
    return [
      { address: process.env.FEE_RECIPIENT_SOL_PRIMARY || '', shareBps: 9000 },
      { address: process.env.FEE_RECIPIENT_SOL_SECONDARY || '', shareBps: 500 },
      { address: process.env.FEE_RECIPIENT_SOL_TERTIARY || '', shareBps: 500 },
    ].filter(r => r.address)
  }
  return [
    { address: (process.env.FEE_RECIPIENT_EVM_PRIMARY || '').toLowerCase(), shareBps: 9000 },
    { address: (process.env.FEE_RECIPIENT_EVM_SECONDARY || '').toLowerCase(), shareBps: 500 },
    { address: (process.env.FEE_RECIPIENT_EVM_TERTIARY || '').toLowerCase(), shareBps: 500 },
  ].filter(r => r.address)
}

// ---------- Threshold config (per-chain, env-tunable) ----------

const DEFAULT_THRESHOLDS = {
  ethereum: { minSwapUsd: 50, minDistributeUsd: 100 },
  bsc:      { minSwapUsd: 2,  minDistributeUsd: 5 },
  polygon:  { minSwapUsd: 1,  minDistributeUsd: 2 },
  arbitrum: { minSwapUsd: 2,  minDistributeUsd: 5 },
  base:     { minSwapUsd: 2,  minDistributeUsd: 5 },
  solana:   { minSwapUsd: 0.10, minDistributeUsd: 0.50 },
}
export function getChainThresholds(chain) {
  const defs = DEFAULT_THRESHOLDS[chain] || { minSwapUsd: 1, minDistributeUsd: 5 }
  const U = chain.toUpperCase()
  const minSwapUsd = parseFloat(process.env[`CONSOLIDATE_MIN_SWAP_USD_${U}`] || defs.minSwapUsd)
  const minDistributeUsd = parseFloat(process.env[`DISTRIBUTE_MIN_USDC_${U}`] || defs.minDistributeUsd)
  // Hard sanity: gas guard multiplier (skip swap if gas * N > value * 0.99)
  const gasGuardMultiplier = parseFloat(process.env.GAS_GUARD_MULTIPLIER || '2')
  const maxPriceImpactPct = parseFloat(process.env.CONSOLIDATE_MAX_IMPACT_PCT || '3')
  return { minSwapUsd, minDistributeUsd, gasGuardMultiplier, maxPriceImpactPct }
}

// Ethereum mainnet gas-aware gating.
export function getEthereumGasGate() {
  return {
    maxGweiNormal: parseFloat(process.env.ETHEREUM_MAX_GWEI_NORMAL || '50'),
    urgencyUsd:    parseFloat(process.env.ETHEREUM_URGENCY_USD    || '1000'),
  }
}

// ---------- Token balance enumeration ----------

// EVM: read balances for the whitelist via direct ERC-20 staticcall.
// We do a simple Promise.all over the whitelist - whitelist is small (5-10
// tokens per chain), so we're not paying Multicall complexity here.
export async function listCollectorEvmTokens(chain, collectorAddr) {
  const { ethers } = await import('ethers')
  const provider = new ethers.JsonRpcProvider(getEvmRpc(chain))
  const whitelist = getFeeTokenWhitelist(chain)
  const ERC20 = ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)', 'function symbol() view returns (string)']
  const results = await Promise.allSettled(whitelist.map(async (token) => {
    const c = new ethers.Contract(token, ERC20, provider)
    const [bal, dec, sym] = await Promise.all([c.balanceOf(collectorAddr), c.decimals().catch(() => 18n), c.symbol().catch(() => '?')])
    return { address: token.toLowerCase(), balance: bal.toString(), decimals: Number(dec), symbol: String(sym) }
  }))
  // Include native ETH balance too (some 0x swaps with native-buy will credit native, others credit WETH).
  const nativeBal = await provider.getBalance(collectorAddr).catch(() => 0n)
  const out = results
    .filter(r => r.status === 'fulfilled' && BigInt(r.value.balance) > 0n)
    .map(r => r.value)
  if (nativeBal > 0n) {
    out.push({ address: EVM_NATIVE_SENTINEL.toLowerCase(), balance: nativeBal.toString(), decimals: 18, symbol: 'NATIVE' })
  }
  return out
}

// Solana: enumerate all SPL token accounts the collector owns + native SOL.
export async function listCollectorSolanaTokens(collectorAddr) {
  const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js')
  const conn = new Connection(getSolanaRpc(), 'confirmed')
  const owner = new PublicKey(collectorAddr)
  const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  const resp = await conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })
  const tokens = resp.value
    .map(({ account }) => account.data.parsed.info)
    .filter(info => BigInt(info.tokenAmount.amount) > 0n)
    .map(info => ({
      mint: info.mint,
      ata: info.owner ? '' : '',  // we'll re-derive when needed
      balance: info.tokenAmount.amount,
      decimals: info.tokenAmount.decimals,
      symbol: '?',
    }))
  // Native SOL.
  const nativeBal = await conn.getBalance(owner).catch(() => 0)
  if (nativeBal > 0) {
    tokens.push({ mint: 'native', balance: String(nativeBal), decimals: 9, symbol: 'SOL' })
  }
  return tokens
}

// ---------- Price lookup (USD value) ----------

// CoinGecko platform IDs (for /simple/token_price/{id}).
const CG_PLATFORM = {
  ethereum: 'ethereum',
  bsc:      'binance-smart-chain',
  polygon:  'polygon-pos',
  arbitrum: 'arbitrum-one',
  base:     'base',
  solana:   'solana',
}

// Lazy in-process price cache (60s) to avoid hammering CoinGecko per token per run.
const _priceCache = new Map()
const PRICE_TTL_MS = 60_000

async function getCoingeckoPrice(chain, tokenAddr) {
  const key = `${chain}:${tokenAddr.toLowerCase()}`
  const hit = _priceCache.get(key)
  if (hit && Date.now() < hit.exp) return hit.value

  const apiKey = process.env.COINGECKO_API_KEY
  const platform = CG_PLATFORM[chain]
  if (!platform) return null
  // Native token uses /simple/price?ids=<id>, not the token-price endpoint.
  const headers = apiKey ? { 'x-cg-pro-api-key': apiKey } : {}
  const base = apiKey ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3'
  const url = `${base}/simple/token_price/${platform}?contract_addresses=${tokenAddr}&vs_currencies=usd`
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const json = await res.json()
    const price = json?.[tokenAddr.toLowerCase()]?.usd ?? null
    if (price != null) _priceCache.set(key, { value: price, exp: Date.now() + PRICE_TTL_MS })
    return price
  } catch {
    return null
  }
}

// USD value of a balance. Handles native (uses chain's native CG id).
export async function quoteUsdValue(chain, tokenAddr, balanceWei, decimals) {
  let price = null
  if (chain === 'solana' && tokenAddr === 'native') {
    price = await getCoingeckoSimplePrice('solana')
  } else if (chain !== 'solana' && tokenAddr.toLowerCase() === EVM_NATIVE_SENTINEL.toLowerCase()) {
    const NATIVE_CG = { ethereum: 'ethereum', bsc: 'binancecoin', polygon: 'matic-network', arbitrum: 'ethereum', base: 'ethereum' }
    price = await getCoingeckoSimplePrice(NATIVE_CG[chain] || 'ethereum')
  } else if (chain === 'solana') {
    // Solana mints: use CG by platform
    const apiKey = process.env.COINGECKO_API_KEY
    const headers = apiKey ? { 'x-cg-pro-api-key': apiKey } : {}
    const base = apiKey ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3'
    const url = `${base}/simple/token_price/solana?contract_addresses=${tokenAddr}&vs_currencies=usd`
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const json = await res.json()
        price = json?.[tokenAddr]?.usd ?? null
      }
    } catch { /* swallow */ }
  } else {
    price = await getCoingeckoPrice(chain, tokenAddr)
  }
  if (price == null) return null
  const amount = Number(BigInt(balanceWei)) / Math.pow(10, decimals)
  return amount * price
}

async function getCoingeckoSimplePrice(cgId) {
  const apiKey = process.env.COINGECKO_API_KEY
  const headers = apiKey ? { 'x-cg-pro-api-key': apiKey } : {}
  const base = apiKey ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3'
  try {
    const res = await fetch(`${base}/simple/price?ids=${cgId}&vs_currencies=usd`, { headers, signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const json = await res.json()
    return json?.[cgId]?.usd ?? null
  } catch {
    return null
  }
}

// ---------- Swap quote + execute (collector-signed) ----------

// EVM token -> USDC via 0x v2 Permit2.
export async function swapEvmToUsdc(chain, tokenAddr, balanceWei, signer) {
  const { ethers } = await import('ethers')
  const collector = await signer.getAddress()
  const usdc = USDC[chain].address
  const numericChainId = EVM_NUMERIC_ID[chain]
  const isNative = tokenAddr.toLowerCase() === EVM_NATIVE_SENTINEL.toLowerCase()

  const params = new URLSearchParams({
    sellToken: tokenAddr,
    buyToken: usdc,
    sellAmount: balanceWei,
    chainId: String(numericChainId),
    taker: collector,
    slippageBps: '100', // 1% slippage tolerance for consolidation
  })
  const res = await fetch(`https://api.0x.org/swap/permit2/quote?${params}`, {
    headers: { '0x-api-key': process.env.ZEROX_API_KEY || '', '0x-version': 'v2' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    throw new Error(`0x quote failed (${res.status}): ${await res.text()}`)
  }
  const q = await res.json()

  // Permit2 (ERC-20 sell): one-time approve to Permit2, then sign permit + append to calldata.
  let data = q.transaction.data
  if (!isNative && q.permit2?.eip712) {
    await ensurePermit2Approval(signer, tokenAddr, balanceWei)
    const { EIP712Domain, ...types } = q.permit2.eip712.types || {}
    const sig = await signer.signTypedData(q.permit2.eip712.domain, types, q.permit2.eip712.message)
    const sigByteLen = (sig.length - 2) / 2
    const sigLengthWord = sigByteLen.toString(16).padStart(64, '0')
    data = data + sigLengthWord + sig.slice(2)
  }

  const tx = await signer.sendTransaction({
    to: q.transaction.to,
    data,
    value: q.transaction.value || '0',
    gasLimit: q.transaction.gas,
    gasPrice: q.transaction.gasPrice,
  })
  const receipt = await tx.wait()
  return { txHash: tx.hash, success: receipt?.status === 1, quote: q }
}

const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
async function ensurePermit2Approval(signer, tokenAddress, amount) {
  const { ethers } = await import('ethers')
  const c = new ethers.Contract(
    tokenAddress,
    ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'],
    signer,
  )
  const owner = await signer.getAddress()
  const current = await c.allowance(owner, PERMIT2_ADDRESS)
  if (current >= BigInt(amount)) return
  const tx = await c.approve(PERMIT2_ADDRESS, ethers.MaxUint256)
  await tx.wait()
}

// Solana SPL/native -> USDC via Jupiter.
export async function swapSolanaToUsdc(mint, balanceLamports, keypair) {
  const { Connection, PublicKey, VersionedTransaction } = await import('@solana/web3.js')
  const conn = new Connection(getSolanaRpc(), 'confirmed')
  const collector = keypair.publicKey.toBase58()
  const usdcMint = USDC.solana.address
  // Jupiter uses `So11111111111111111111111111111111111111112` (wSOL) for native.
  const inputMint = mint === 'native' ? 'So11111111111111111111111111111111111111112' : mint

  // Quote
  const qParams = new URLSearchParams({ inputMint, outputMint: usdcMint, amount: String(balanceLamports), slippageBps: '100' })
  const qRes = await fetch(`https://public.jupiterapi.com/quote?${qParams}`, { signal: AbortSignal.timeout(15000) })
  if (!qRes.ok) throw new Error(`Jupiter quote failed (${qRes.status}): ${await qRes.text()}`)
  const quote = await qRes.json()

  // Swap tx
  const sRes = await fetch('https://public.jupiterapi.com/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: collector,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!sRes.ok) throw new Error(`Jupiter swap failed (${sRes.status}): ${await sRes.text()}`)
  const swapJson = await sRes.json()

  const txBuf = Buffer.from(swapJson.swapTransaction, 'base64')
  const tx = VersionedTransaction.deserialize(txBuf)
  tx.sign([keypair])
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 })
  await conn.confirmTransaction(sig, 'confirmed')
  return { txHash: sig, success: true, quote }
}

// ---------- USDC transfer (post-consolidation distribute) ----------

export async function transferUsdcEvm(chain, signer, toAddress, amountWei) {
  const { ethers } = await import('ethers')
  const c = new ethers.Contract(
    USDC[chain].address,
    ['function transfer(address,uint256) returns (bool)'],
    signer,
  )
  const tx = await c.transfer(toAddress, amountWei)
  const receipt = await tx.wait()
  return { txHash: tx.hash, success: receipt?.status === 1 }
}

export async function transferUsdcSolana(keypair, toAddress, amountSmallest) {
  const { Connection, PublicKey, Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js')
  const splToken = await import('@solana/spl-token')
  const conn = new Connection(getSolanaRpc(), 'confirmed')
  const mint = new PublicKey(USDC.solana.address)
  const owner = keypair.publicKey
  const dest = new PublicKey(toAddress)
  const srcAta = await splToken.getAssociatedTokenAddress(mint, owner)
  const destAta = await splToken.getAssociatedTokenAddress(mint, dest)

  const tx = new Transaction()
  // Create dest ATA if missing.
  try {
    await splToken.getAccount(conn, destAta)
  } catch {
    tx.add(splToken.createAssociatedTokenAccountInstruction(owner, destAta, dest, mint))
  }
  tx.add(splToken.createTransferInstruction(srcAta, destAta, owner, BigInt(amountSmallest)))
  const sig = await sendAndConfirmTransaction(conn, tx, [keypair], { commitment: 'confirmed' })
  return { txHash: sig, success: true }
}

// ---------- Gas estimation + Ethereum gas gate ----------

export async function getCurrentGweiEthereum() {
  const { ethers } = await import('ethers')
  const provider = new ethers.JsonRpcProvider(getEvmRpc('ethereum'))
  const feeData = await provider.getFeeData().catch(() => null)
  if (!feeData) return null
  const gp = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n
  return Number(gp) / 1e9 // wei -> gwei
}

export function estimateGasUsdFromQuote(quote, ethUsdPrice) {
  // 0x v2 returns `transaction.gas` (limit) and `transaction.gasPrice`.
  const gasLimit = BigInt(quote?.transaction?.gas || 0)
  const gasPrice = BigInt(quote?.transaction?.gasPrice || 0)
  if (gasLimit === 0n || gasPrice === 0n) return null
  const weiCost = gasLimit * gasPrice
  return (Number(weiCost) / 1e18) * ethUsdPrice
}

// ---------- Distribute helpers ----------

// Compute 90/5/5 amounts respecting rounding (last recipient gets remainder).
export function computeSplitAmounts(totalAmount, recipients) {
  const total = BigInt(totalAmount)
  let assigned = 0n
  const out = []
  for (let i = 0; i < recipients.length; i++) {
    if (i === recipients.length - 1) {
      // Last gets the remainder to avoid rounding loss.
      out.push({ ...recipients[i], amount: (total - assigned).toString() })
    } else {
      const part = (total * BigInt(recipients[i].shareBps)) / 10000n
      out.push({ ...recipients[i], amount: part.toString() })
      assigned += part
    }
  }
  return out
}
