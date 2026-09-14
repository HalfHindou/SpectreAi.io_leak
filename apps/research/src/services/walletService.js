/**
 * Wallet Service
 * Abstracts balance queries across EVM chains and Solana.
 * Uses ethers v6 for EVM, @solana/web3.js for Solana.
 *
 * EVM balances use Multicall3 to batch all reads into a single RPC call.
 */
import { ethers } from 'ethers'
import { Connection, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'

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
  solana: {
    id: 'solana',
    name: 'Solana',
    rpcUrl: import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    nativeSymbol: 'SOL',
    nativeDecimals: 9,
    type: 'solana',
  },
}

// -- Multicall3 (deployed at same address on all major EVM chains) --

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'
const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])',
  'function getEthBalance(address addr) view returns (uint256 balance)',
]

// ERC-20 function selectors (pre-encoded to avoid ABI overhead)
const BALANCE_OF_SELECTOR = '0x70a08231' // balanceOf(address)

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
  },
  base: {
    USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  },
  solana: {
    USDT: { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
    USDC: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  },
}

// -- EVM: single Multicall3 batch for ALL balances --

/**
 * Fetch native ETH + all ERC-20 balances in ONE RPC call via Multicall3.
 * Before: 7+ sequential calls (6+ seconds on public RPCs).
 * After: 1 batched call (<1 second).
 */
async function getEvmBalancesMulticall(address, chainId, prices) {
  const provider = getEvmProvider(chainId)
  if (!provider) return []

  const chain = CHAINS[chainId]
  const tokens = COMMON_TOKENS[chainId] || {}
  const tokenEntries = Object.entries(tokens)

  // Encode balanceOf(address) calldata for each token
  const paddedAddress = address.slice(2).toLowerCase().padStart(64, '0')
  const balanceOfCalldata = BALANCE_OF_SELECTOR + paddedAddress

  // Build multicall batch: [getEthBalance, token0.balanceOf, token1.balanceOf, ...]
  const calls = [
    // Native balance via Multicall3.getEthBalance
    {
      target: MULTICALL3_ADDRESS,
      allowFailure: true,
      callData: new ethers.Interface(MULTICALL3_ABI).encodeFunctionData('getEthBalance', [address]),
    },
    // ERC-20 balanceOf calls
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
      name: chain.nativeSymbol === 'ETH' ? 'Ethereum' : chain.nativeSymbol === 'BNB' ? 'BNB' : chain.nativeSymbol === 'MATIC' ? 'Polygon' : chain.nativeSymbol,
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
    // Fallback to individual calls if multicall fails
    return getEvmBalancesFallback(address, chainId, prices)
  }
}

/**
 * Fallback: fetch all balances in parallel without multicall.
 */
async function getEvmBalancesFallback(address, chainId, prices) {
  const provider = getEvmProvider(chainId)
  if (!provider) return []

  const chain = CHAINS[chainId]
  const tokens = COMMON_TOKENS[chainId] || {}

  // Fire ALL requests in parallel (native + all ERC-20s)
  const nativePromise = provider.getBalance(address).then((raw) => {
    const balance = parseFloat(ethers.formatUnits(raw, chain.nativeDecimals))
    const price = prices[chain.nativeSymbol] || 0
    return {
      symbol: chain.nativeSymbol,
      name: chain.nativeSymbol === 'ETH' ? 'Ethereum' : chain.nativeSymbol === 'BNB' ? 'BNB' : chain.nativeSymbol === 'MATIC' ? 'Polygon' : chain.nativeSymbol,
      balance,
      balanceUsd: balance * price,
      price,
      decimals: chain.nativeDecimals,
      isNative: true,
    }
  }).catch(() => ({
    symbol: chain.nativeSymbol,
    name: chain.nativeSymbol,
    balance: 0,
    balanceUsd: 0,
    price: 0,
    decimals: chain.nativeDecimals,
    isNative: true,
  }))

  const tokenPromises = Object.entries(tokens).map(async ([symbol, token]) => {
    try {
      const contract = new ethers.Contract(token.address, ['function balanceOf(address) view returns (uint256)'], provider)
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
      return { symbol, name: symbol, balance: 0, balanceUsd: 0, price: 0, decimals: token.decimals, isNative: false, contractAddress: token.address }
    }
  })

  const results = await Promise.all([nativePromise, ...tokenPromises])
  return results
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
    const ata = getAssociatedTokenAddressSync(mint, wallet)
    const info = await connection.getTokenAccountBalance(ata)
    return {
      balance: parseFloat(info.value.uiAmountString || '0'),
      decimals: info.value.decimals,
    }
  } catch (err) {
    if (err.message?.includes('could not find')) {
      return { balance: 0, decimals }
    }
    console.error(`Failed to get SPL token balance (${mintAddress}):`, err.message)
    return { balance: 0, decimals }
  }
}

// -- Public API --

/**
 * Get all balances for a wallet address on a given chain.
 * Returns array of { symbol, name, balance, balanceUsd, decimals, isNative }
 * Prices must be provided externally (from Codex/CoinGecko).
 */
export async function getWalletBalances(address, chainId, prices = {}) {
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
    // Find known decimals or default to 18
    const knownToken = Object.values(COMMON_TOKENS[chainId] || {}).find((t) => t.address.toLowerCase() === tokenAddress.toLowerCase())
    const decimals = knownToken?.decimals || 18
    try {
      const contract = new ethers.Contract(tokenAddress, ['function balanceOf(address) view returns (uint256)'], provider)
      const raw = await contract.balanceOf(address)
      return parseFloat(ethers.formatUnits(raw, decimals))
    } catch { return 0 }
  } else {
    const { balance } = await getSplTokenBalance(address, tokenAddress)
    return balance
  }
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

export { CHAINS, COMMON_TOKENS }
