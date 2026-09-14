/**
 * Server-side token balance helper for the Conviction Wall holder gate.
 * Mirrors the patterns in apps/trading/src/services/walletService.js but
 * with cached providers and runs in Node (Vercel Serverless / Express dev).
 */

import { ethers } from 'ethers'
import { Connection, PublicKey } from '@solana/web3.js'

const EVM_CHAINS = {
  eth:  { rpc: process.env.ETH_RPC_URL  || 'https://ethereum-rpc.publicnode.com' },
  bsc:  { rpc: process.env.BSC_RPC_URL  || 'https://bsc-dataseed.binance.org' },
  poly: { rpc: process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com' },
  arb:  { rpc: process.env.ARB_RPC_URL  || 'https://arb1.arbitrum.io/rpc' },
  base: { rpc: process.env.BASE_RPC_URL || 'https://mainnet.base.org' },
}
const SOL_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']

const _evmProviders = new Map()
let _solConnection = null

function getEvmProvider(chain) {
  const cfg = EVM_CHAINS[chain]
  if (!cfg) return null
  if (!_evmProviders.has(chain)) {
    _evmProviders.set(chain, new ethers.JsonRpcProvider(cfg.rpc))
  }
  return _evmProviders.get(chain)
}

function getSolConnection() {
  if (!_solConnection) _solConnection = new Connection(SOL_RPC, 'confirmed')
  return _solConnection
}

/**
 * Returns true when the wallet holds at least 1 raw token unit of the given
 * (chain, contract). For EVM that means balanceOf > 0 (we treat any positive
 * balance as "holds"). For Solana same — any associated token account with a
 * non-zero balance counts.
 *
 * @param {string} walletAddress
 * @param {'eth'|'bsc'|'poly'|'arb'|'base'|'sol'} chain
 * @param {string} ca - contract / mint address
 */
export async function holdsAtLeastOne(walletAddress, chain, ca) {
  if (!walletAddress || !chain || !ca) return false

  if (chain === 'sol') {
    try {
      const { getAssociatedTokenAddressSync } = await import('@solana/spl-token')
      const conn = getSolConnection()
      const wallet = new PublicKey(walletAddress)
      const mint = new PublicKey(ca)
      const ata = getAssociatedTokenAddressSync(mint, wallet)
      const info = await conn.getTokenAccountBalance(ata)
      const ui = parseFloat(info?.value?.uiAmountString || '0')
      return ui > 0
    } catch (err) {
      // Token account doesn't exist or RPC failure → treat as not held.
      if (!err?.message?.includes('could not find')) {
        console.warn('[conviction/balance] sol balance check failed:', err?.message)
      }
      return false
    }
  }

  const provider = getEvmProvider(chain)
  if (!provider) return false
  try {
    const contract = new ethers.Contract(ca, ERC20_ABI, provider)
    const raw = await contract.balanceOf(walletAddress)
    return raw > 0n
  } catch (err) {
    console.warn(`[conviction/balance] ${chain} balanceOf failed:`, err?.message)
    return false
  }
}
