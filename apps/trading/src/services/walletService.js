/**
 * Wallet Service
 * Abstracts balance queries across EVM chains and Solana.
 * Uses ethers v6 for EVM, @solana/web3.js for Solana.
 *
 * EVM balances use Multicall3 (deployed at the same address on every major
 * EVM chain) to batch native + ALL ERC-20 reads into ONE RPC call. Before
 * this was sequential per-token Promise.all - 6+ seconds on public RPCs and
 * a known tech-debt item flagged in CLAUDE.md. Now <1 second + 1 RPC hit.
 */
import { ethers } from 'ethers'
import { Connection, PublicKey } from '@solana/web3.js'
// No @solana/spl-token import here: SPL balances resolve by-mint via
// getParsedTokenAccountsByOwner (program-agnostic, covers Token-2022), so no
// ATA derivation - and no Buffer-dependent code in the main bundle.

// -- Chain config --

const CHAINS = {
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    rpcUrl: import.meta.env.VITE_ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    type: 'evm',
  },
  bsc: {
    id: 'bsc',
    name: 'BNB Chain',
    rpcUrl: import.meta.env.VITE_BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
    nativeSymbol: 'BNB',
    nativeDecimals: 18,
    type: 'evm',
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    rpcUrl: import.meta.env.VITE_POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com',
    nativeSymbol: 'MATIC',
    nativeDecimals: 18,
    type: 'evm',
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum',
    rpcUrl: import.meta.env.VITE_ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    type: 'evm',
  },
  base: {
    id: 'base',
    name: 'Base',
    rpcUrl: import.meta.env.VITE_BASE_RPC_URL || 'https://mainnet.base.org',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    type: 'evm',
  },
  robinhood: {
    id: 'robinhood',
    name: 'Robinhood Chain',
    // Arbitrum Orbit L2, ETH gas token. Official mainnet RPC (2026-07-01).
    // Multicall3 is deployed at the canonical address on RH like every Orbit
    // chain, so getEvmBalancesMulticall works unchanged (native ETH read).
    rpcUrl: import.meta.env.VITE_ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    type: 'evm',
  },
  solana: {
    id: 'solana',
    name: 'Solana',
    // Default is the SAME-ORIGIN read-only RPC proxy (/api/solana-rpc):
    // the public Solana RPC rejects browser requests outright (CORS), so
    // direct reads silently produced 0-balances, dead confirmation polling
    // and failing withdraw blockhash fetches. VITE_SOLANA_RPC_URL still
    // overrides for a keyed, browser-CORS-enabled endpoint (e.g. Helius).
    rpcUrl: import.meta.env.VITE_SOLANA_RPC_URL
      || (typeof window !== 'undefined' ? `${window.location.origin}/api/solana-rpc` : 'https://api.mainnet-beta.solana.com'),
    nativeSymbol: 'SOL',
    nativeDecimals: 9,
    type: 'solana',
  },
}

// -- Multicall3 (deployed at the same address on all major EVM chains) --

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'
const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])',
  'function getEthBalance(address addr) view returns (uint256 balance)',
]

// ERC-20 balanceOf selector pre-encoded (avoids ABI overhead per call)
const BALANCE_OF_SELECTOR = '0x70a08231' // balanceOf(address)

// ERC-20 ABI fragment for fallback path that still uses Contract
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]

// Token decimals resolved from the contract, cached per chain:address.
// Assuming 18 for unknown tokens silently corrupts balances (and MAX-sell
// amounts) for nonstandard ERC-20s like USDC-style 6-decimal tokens.
const _erc20DecimalsCache = new Map()
async function getErc20Decimals(contract, cacheKey, fallback = 18) {
  if (_erc20DecimalsCache.has(cacheKey)) return _erc20DecimalsCache.get(cacheKey)
  try {
    const d = Number(await contract.decimals())
    const dec = Number.isFinite(d) && d >= 0 && d <= 36 ? d : fallback
    _erc20DecimalsCache.set(cacheKey, dec)
    return dec
  } catch {
    return fallback
  }
}

// Provider cache to avoid re-creating per call
const providerCache = new Map()

function getEvmProvider(chainId) {
  if (!providerCache.has(chainId)) {
    const chain = CHAINS[chainId]
    if (!chain || chain.type !== 'evm') return null
    providerCache.set(chainId, new ethers.JsonRpcProvider(chain.rpcUrl))
  }
  return providerCache.get(chainId)
}

export function getSolanaConnection() {
  if (!providerCache.has('solana')) {
    providerCache.set('solana', new Connection(CHAINS.solana.rpcUrl, 'confirmed'))
  }
  return providerCache.get('solana')
}

// -- Common token addresses with known decimals --
// Schema: { [chain]: { [symbol]: { address, decimals } } }
// Decimals are authoritative here so we don't need a per-token decimals() RPC call.

const COMMON_TOKENS = {
  ethereum: {
    USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    WETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
  },
  bsc: {
    USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    USDC: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    WBNB: { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18 },
  },
  polygon: {
    USDT: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    USDC: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
  },
  arbitrum: {
    USDT: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    ARB: { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18 },
  },
  base: {
    USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  },
  solana: {
    USDT: { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
    USDC: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  },
}

// Display name for the native asset on each chain
function nativeDisplayName(symbol) {
  if (symbol === 'ETH') return 'Ethereum'
  if (symbol === 'BNB') return 'BNB'
  if (symbol === 'MATIC') return 'Polygon'
  return symbol
}

// -- EVM: single Multicall3 batch for ALL balances --

/**
 * Fetch native + all known ERC-20 balances in ONE RPC call via Multicall3.
 * Before: 1 native + 2-3 token reads each with their own decimals() call = 5-7 RPC hits.
 * After: 1 batched aggregate3() call.
 *
 * Falls back to parallel individual calls if Multicall3 reverts.
 */
async function getEvmBalancesMulticall(address, chainId, prices) {
  const provider = getEvmProvider(chainId)
  if (!provider) return []

  const chain = CHAINS[chainId]
  const tokens = COMMON_TOKENS[chainId] || {}
  const tokenEntries = Object.entries(tokens)

  // Encode balanceOf(address) calldata once - same address for every token call
  const paddedAddress = address.slice(2).toLowerCase().padStart(64, '0')
  const balanceOfCalldata = BALANCE_OF_SELECTOR + paddedAddress

  // Build multicall batch: [getEthBalance, token0.balanceOf, token1.balanceOf, ...]
  const calls = [
    {
      target: MULTICALL3_ADDRESS,
      allowFailure: true,
      callData: new ethers.Interface(MULTICALL3_ABI).encodeFunctionData('getEthBalance', [address]),
    },
    ...tokenEntries.map(([, token]) => ({
      target: token.address,
      allowFailure: true,
      callData: balanceOfCalldata,
    })),
  ]

  try {
    const multicall = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider)
    const results = await multicall.aggregate3(calls)

    const balances = []

    // Parse native balance (first result)
    const nativeResult = results[0]
    let nativeBalance = 0
    if (nativeResult.success && nativeResult.returnData !== '0x') {
      const raw = BigInt(nativeResult.returnData)
      nativeBalance = parseFloat(ethers.formatUnits(raw, chain.nativeDecimals))
    }
    const nativePrice = prices[chain.nativeSymbol] || 0
    balances.push({
      symbol: chain.nativeSymbol,
      name: nativeDisplayName(chain.nativeSymbol),
      balance: nativeBalance,
      balanceUsd: nativeBalance * nativePrice,
      price: nativePrice,
      decimals: chain.nativeDecimals,
      isNative: true,
    })

    // Parse ERC-20 balances (remaining results)
    tokenEntries.forEach(([symbol, token], i) => {
      const result = results[i + 1]
      let balance = 0
      if (result.success && result.returnData !== '0x' && result.returnData.length >= 66) {
        const raw = BigInt(result.returnData)
        balance = parseFloat(ethers.formatUnits(raw, token.decimals))
      }
      const price = prices[symbol] || 0
      balances.push({
        symbol,
        name: symbol,
        balance,
        balanceUsd: balance * price,
        price,
        decimals: token.decimals,
        isNative: false,
        contractAddress: token.address,
      })
    })

    return balances
  } catch (err) {
    console.error(`[walletService] Multicall failed on ${chainId}, falling back:`, err.message)
    return getEvmBalancesFallback(address, chainId, prices)
  }
}

/**
 * Fallback: fire all balance requests in parallel without Multicall3. Used if
 * Multicall3 contract reverts (unlikely on a chain that has it deployed at the
 * canonical address, but kept defensively for any chain we add later that
 * doesn't ship with it).
 */
async function getEvmBalancesFallback(address, chainId, prices) {
  const provider = getEvmProvider(chainId)
  if (!provider) return []

  const chain = CHAINS[chainId]
  const tokens = COMMON_TOKENS[chainId] || {}

  const nativePromise = provider.getBalance(address).then((raw) => {
    const balance = parseFloat(ethers.formatUnits(raw, chain.nativeDecimals))
    const price = prices[chain.nativeSymbol] || 0
    return {
      symbol: chain.nativeSymbol,
      name: nativeDisplayName(chain.nativeSymbol),
      balance,
      balanceUsd: balance * price,
      price,
      decimals: chain.nativeDecimals,
      isNative: true,
    }
  }).catch(() => ({
    symbol: chain.nativeSymbol,
    name: nativeDisplayName(chain.nativeSymbol),
    balance: 0,
    balanceUsd: 0,
    price: 0,
    decimals: chain.nativeDecimals,
    isNative: true,
  }))

  const tokenPromises = Object.entries(tokens).map(async ([symbol, token]) => {
    try {
      const contract = new ethers.Contract(token.address, ERC20_ABI, provider)
      const raw = await contract.balanceOf(address)
      const balance = parseFloat(ethers.formatUnits(raw, token.decimals))
      const price = prices[symbol] || 0
      return {
        symbol,
        name: symbol,
        balance,
        balanceUsd: balance * price,
        price,
        decimals: token.decimals,
        isNative: false,
        contractAddress: token.address,
      }
    } catch {
      return {
        symbol,
        name: symbol,
        balance: 0,
        balanceUsd: 0,
        price: 0,
        decimals: token.decimals,
        isNative: false,
        contractAddress: token.address,
      }
    }
  })

  return Promise.all([nativePromise, ...tokenPromises])
}

// -- Solana balance fetchers --

async function getSolNativeBalance(address) {
  try {
    const connection = getSolanaConnection()
    const pubkey = new PublicKey(address)
    const lamports = await connection.getBalance(pubkey)
    return { balance: lamports / 1e9, symbol: 'SOL' }
  } catch (err) {
    console.error('Failed to get SOL balance:', err.message)
    return { balance: 0, symbol: 'SOL' }
  }
}

async function getSplTokenBalance(walletAddress, mintAddress, decimals = 9) {
  try {
    const connection = getSolanaConnection()
    const wallet = new PublicKey(walletAddress)
    const mint = new PublicKey(mintAddress)
    // Resolve token accounts BY MINT instead of deriving the classic ATA.
    // Token-2022 mints (pump.fun launches are TokenzQdB...-owned) derive a
    // DIFFERENT associated address - the derivation seeds include the token
    // program id - so the classic derivation read an empty account and
    // reported 0 for funded wallets. The by-mint query is program-agnostic
    // and also covers non-ATA token accounts.
    const res = await connection.getParsedTokenAccountsByOwner(wallet, { mint })
    const accounts = res?.value || []
    if (!accounts.length) return { balance: 0, decimals }
    let total = 0
    let dec = decimals
    for (const acc of accounts) {
      const amt = acc.account?.data?.parsed?.info?.tokenAmount
      if (!amt) continue
      total += parseFloat(amt.uiAmountString || '0')
      if (Number.isFinite(amt.decimals)) dec = amt.decimals
    }
    return { balance: total, decimals: dec }
  } catch (err) {
    console.error(`Failed to get SPL token balance (${mintAddress}):`, err.message)
    return { balance: 0, decimals }
  }
}

// -- Public API --

// Codex networkId per chain slug (Codex's Solana id 1399811149 is not a real chain id).
const CHAIN_NETWORK_ID = {
  ethereum: 1, bsc: 56, polygon: 137, arbitrum: 42161, base: 8453, solana: 1399811149,
}

/**
 * Codex wallet auto-discovery: fetch EVERY token the wallet holds on this chain
 * from /api/wallet-tokens (native + any ERC-20 / SPL, priced). Returns the raw
 * token array, or null on any failure so the caller falls back to on-chain reads.
 */
async function fetchDiscoveredBalances(address, chainId) {
  const networkId = CHAIN_NETWORK_ID[chainId]
  if (!networkId) return null
  try {
    const res = await fetch(
      `/api/wallet-tokens?address=${encodeURIComponent(address)}&networkId=${networkId}`,
      { signal: AbortSignal.timeout(12000) },
    )
    if (!res.ok) return null
    const data = await res.json()
    return Array.isArray(data?.tokens) ? data.tokens : null
  } catch {
    return null
  }
}

/**
 * Map a discovered token to the walletService balance shape. Native identity
 * (symbol/name/decimals) comes from CHAINS so ETH/BNB/POL render consistently;
 * price prefers Codex's value, falling back to the caller's price map.
 */
function mapDiscovered(tokens, chain, chainId, prices) {
  const isSolana = chainId === 'solana'
  return tokens.map((t) => {
    const balance = Number(t.balance) || 0
    if (t.isNative) {
      const price = t.price > 0 ? t.price : (prices[chain.nativeSymbol] || 0)
      return {
        symbol: chain.nativeSymbol,
        name: nativeDisplayName(chain.nativeSymbol),
        balance,
        balanceUsd: balance * price,
        price,
        decimals: chain.nativeDecimals,
        isNative: true,
      }
    }
    const price = t.price > 0 ? t.price : (prices[t.symbol] || 0)
    const mapped = {
      symbol: t.symbol || '',
      name: t.name || t.symbol || '',
      balance,
      balanceUsd: balance * price,
      price,
      decimals: Number.isFinite(t.decimals) ? t.decimals : (isSolana ? 9 : 18),
      isNative: false,
      logo: t.logo || null,
    }
    if (isSolana) mapped.mintAddress = t.address
    else mapped.contractAddress = t.address
    return mapped
  })
}

/**
 * Overwrite Codex-discovered balances with AUTHORITATIVE on-chain reads
 * (one Multicall3 batch). Codex's indexed balances LAG real time - right after a
 * sell it still reported the full pre-sale balance of a token the wallet no
 * longer held, which let the user attempt an impossible sell that then reverted.
 * Discovery still decides WHICH tokens to show (long-tail coverage); the chain
 * decides HOW MUCH. Tokens whose real balance rounds to zero are dropped. EVM
 * only. On ANY failure returns the discovered list unchanged (never blanks the
 * wallet). Prices/metadata from discovery are preserved.
 */
async function reconcileEvmBalancesOnChain(discovered, address, chainId) {
  const provider = getEvmProvider(chainId)
  const chain = CHAINS[chainId]
  if (!provider || !chain) return discovered
  const erc20 = discovered.filter((t) => !t.isNative && /^0x[0-9a-fA-F]{40}$/.test(t.address || ''))
  const nativeTok = discovered.find((t) => t.isNative)
  try {
    const iface = new ethers.Interface(MULTICALL3_ABI)
    const balanceOfCalldata = BALANCE_OF_SELECTOR + address.slice(2).toLowerCase().padStart(64, '0')
    const calls = [
      { target: MULTICALL3_ADDRESS, allowFailure: true, callData: iface.encodeFunctionData('getEthBalance', [address]) },
      ...erc20.map((t) => ({ target: t.address, allowFailure: true, callData: balanceOfCalldata })),
    ]
    const multicall = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider)
    const results = await multicall.aggregate3(calls)

    const out = []
    if (nativeTok) {
      const r = results[0]
      let bal = 0
      if (r.success && r.returnData !== '0x') bal = parseFloat(ethers.formatUnits(BigInt(r.returnData), chain.nativeDecimals))
      out.push({ ...nativeTok, balance: bal })
    }
    erc20.forEach((t, i) => {
      const r = results[i + 1]
      let bal = 0
      if (r.success && r.returnData !== '0x' && r.returnData.length >= 66) {
        const dec = Number.isFinite(t.decimals) ? t.decimals : 18
        bal = parseFloat(ethers.formatUnits(BigInt(r.returnData), dec))
      }
      if (bal > 0) out.push({ ...t, balance: bal }) // drop tokens fully sold/moved
    })
    return out
  } catch (err) {
    console.warn('[walletService] on-chain balance reconcile failed, using discovered:', err.message)
    return discovered
  }
}

/**
 * Get all balances for a wallet address on a given chain.
 * Returns array of { symbol, name, balance, balanceUsd, decimals, isNative, ... }.
 *
 * Primary path is Codex auto-discovery (/api/wallet-tokens) so EVERY held token
 * shows - not just the curated COMMON_TOKENS list. Falls back to direct on-chain
 * reads (Multicall3 / Solana RPC) if discovery is unavailable, so the wallet is
 * never blanked by a backend blip. Prices are provided externally.
 */
export async function getWalletBalances(address, chainId, prices = {}) {
  const chain = CHAINS[chainId]
  if (!chain || !address) return []

  const discovered = await fetchDiscoveredBalances(address, chainId)
  if (Array.isArray(discovered) && discovered.length) {
    // Codex decides WHICH tokens to show; the chain decides HOW MUCH. Codex
    // balances lag real time (stale after a sell), so reconcile EVM balances
    // on-chain - otherwise the wallet shows a balance you no longer hold and lets
    // you attempt an impossible sell that reverts. Solana keeps Codex balances.
    const reconciled = chainId !== 'solana'
      ? await reconcileEvmBalancesOnChain(discovered, address, chainId)
      : discovered
    return mapDiscovered(reconciled, chain, chainId, prices)
  }

  // Fallback: curated on-chain reads (native + COMMON_TOKENS), so a discovery
  // outage still shows native + stables rather than an empty wallet.
  return getWalletBalancesOnChain(address, chainId, prices)
}

/**
 * Fallback balance reader - direct on-chain (Multicall3 for EVM, RPC for Solana)
 * over native + the curated COMMON_TOKENS. Used only when Codex discovery is down.
 */
async function getWalletBalancesOnChain(address, chainId, prices = {}) {
  const chain = CHAINS[chainId]
  if (!chain || !address) return []

  if (chain.type === 'evm') {
    return getEvmBalancesMulticall(address, chainId, prices)
  }

  // Solana: fetch native + SPL tokens in parallel
  const tokens = COMMON_TOKENS.solana || {}
  const solPrice = prices.SOL || 0

  const nativePromise = getSolNativeBalance(address).then((sol) => ({
    symbol: 'SOL',
    name: 'Solana',
    balance: sol.balance,
    balanceUsd: sol.balance * solPrice,
    price: solPrice,
    decimals: 9,
    isNative: true,
  }))

  const tokenPromises = Object.entries(tokens).map(async ([symbol, token]) => {
    const { balance, decimals } = await getSplTokenBalance(address, token.address, token.decimals)
    const price = prices[symbol] || 0
    return {
      symbol,
      name: symbol,
      balance,
      balanceUsd: balance * price,
      price,
      decimals,
      isNative: false,
      mintAddress: token.address,
    }
  })

  return Promise.all([nativePromise, ...tokenPromises])
}

/**
 * Get a single token balance (native or contract).
 */
export async function getTokenBalance(address, chainId, tokenAddress = null) {
  const chain = CHAINS[chainId]
  if (!chain || !address) return 0

  if (!tokenAddress) {
    if (chain.type === 'evm') {
      const provider = getEvmProvider(chainId)
      if (!provider) return 0
      try {
        const raw = await provider.getBalance(address)
        return parseFloat(ethers.formatUnits(raw, chain.nativeDecimals))
      } catch { return 0 }
    } else {
      const { balance } = await getSolNativeBalance(address)
      return balance
    }
  }

  if (chain.type === 'evm') {
    const provider = getEvmProvider(chainId)
    if (!provider) return 0
    const knownToken = Object.values(COMMON_TOKENS[chainId] || {}).find((t) => t.address.toLowerCase() === tokenAddress.toLowerCase())
    try {
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
      const [raw, decimals] = await Promise.all([
        contract.balanceOf(address),
        Number.isFinite(knownToken?.decimals)
          ? Promise.resolve(knownToken.decimals)
          : getErc20Decimals(contract, `${chainId}:${tokenAddress.toLowerCase()}`),
      ])
      return parseFloat(ethers.formatUnits(raw, decimals))
    } catch { return 0 }
  } else {
    const { balance } = await getSplTokenBalance(address, tokenAddress)
    return balance
  }
}

/**
 * Real on-chain ERC-20 decimals (cached via getErc20Decimals). The page-token
 * object frequently lacks a correct `decimals` (Codex value dropped in token
 * resolution), and buildSwapParams then defaults to 18 - so a SELL of e.g. a
 * 9-decimal token asks for 10^9x too many tokens and reverts with
 * TRANSFER_FROM_FAILED. The sell path uses this so it sells the RIGHT amount.
 * Returns null on non-EVM / failure so the caller keeps its own value.
 */
export async function getTokenDecimals(chainId, tokenAddress) {
  const chain = CHAINS[chainId]
  if (!chain || chain.type !== 'evm' || !tokenAddress) return null
  const known = Object.values(COMMON_TOKENS[chainId] || {}).find((t) => t.address.toLowerCase() === tokenAddress.toLowerCase())
  if (Number.isFinite(known?.decimals)) return known.decimals
  const provider = getEvmProvider(chainId)
  if (!provider) return null
  try {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
    return await getErc20Decimals(contract, `${chainId}:${tokenAddress.toLowerCase()}`)
  } catch { return null }
}

/**
 * Validate a withdrawal recipient address for a given chain BEFORE signing.
 * Rejects wrong-chain addresses (an EVM 0x... pasted on Solana, or a Solana
 * base58 key pasted on an EVM chain) - the single biggest irreversible
 * fund-loss vector at withdrawal time. Returns null when valid, or a
 * human-readable error string otherwise.
 *
 * Synchronous - relies on the statically-imported ethers + PublicKey so the
 * withdraw form can validate inline without an await round-trip.
 */
export function validateWithdrawAddress(address, chainId) {
  const trimmed = (address || '').trim()
  if (!trimmed) return 'Enter recipient address'

  const chain = CHAINS[chainId]
  const isSolana = chainId === 'solana' || chain?.type === 'solana'

  if (isSolana) {
    if (trimmed.startsWith('0x')) {
      return 'That is an EVM (0x) address. Enter a Solana address.'
    }
    try {
      // PublicKey throws on invalid base58 or a non-32-byte key.
      // eslint-disable-next-line no-new
      new PublicKey(trimmed)
      return null
    } catch {
      return 'Invalid Solana address'
    }
  }

  // EVM chains
  if (!trimmed.startsWith('0x')) {
    return 'That is not an EVM address. Enter a 0x... address.'
  }
  // ethers.isAddress also verifies the EIP-55 checksum for mixed-case input.
  if (!ethers.isAddress(trimmed)) {
    return 'Invalid EVM address (check the characters and checksum)'
  }
  return null
}

export { CHAINS, COMMON_TOKENS, getEvmProvider }
