/**
 * withdrawTx - pure builder for EVM withdraw transaction requests.
 *
 * Exists for two fund-safety reasons (2026-07-06 real-money audit):
 *   1. CHAIN PINNING. Privy's sendTransaction signs on the wallet's CURRENT
 *      chain when the request carries no chainId - so a withdraw initiated
 *      from the BNB tab could move mainnet ETH, and an ERC-20 withdraw could
 *      call whatever contract lives at that address on the wrong chain.
 *      Every request built here carries the explicit chainId of the chain
 *      tab the user acted on (Privy's UnsignedTransactionRequest supports
 *      chainId as of @privy-io/react-auth 3.x).
 *   2. STRING AMOUNT MATH. parseFloat(amount) * 1e18 loses precision past
 *      ~15 significant digits. ethers.parseUnits does exact decimal-string
 *      math; extra decimals beyond the token's precision are truncated
 *      (never rounded up) before parsing.
 *
 * Pure + async-import ethers so the module stays unit-testable and adds no
 * eager bundle weight. Solana withdraws are built inline in the wallet
 * section (different tx model - see UdWalletSection handleWithdraw).
 */

export const EVM_CHAIN_IDS = { ethereum: 1, base: 8453, polygon: 137, arbitrum: 42161, bsc: 56, robinhood: 4663 }

/** Truncate (never round) decimals beyond the token's precision so
 *  parseUnits cannot throw on user input like 0.1234567890123456789. */
export function clampDecimals(amount, decimals) {
  const s = String(amount ?? '').trim()
  if (!s.includes('.')) return s
  const [whole, frac] = s.split('.')
  const kept = frac.slice(0, Math.max(0, decimals))
  return kept.length > 0 ? `${whole}.${kept}` : whole
}

/** Exact decimal-string -> base-unit BigInt (no float step). Used by the
 *  Solana withdraw paths (lamports / SPL raw amounts) where ethers is not
 *  in scope; throws on non-numeric input. */
export function toBaseUnits(amount, decimals) {
  const s = clampDecimals(amount, decimals)
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') {
    throw new Error('Invalid amount')
  }
  const [whole, frac = ''] = s.split('.')
  return BigInt((whole || '0') + frac.padEnd(decimals, '0'))
}

/**
 * Build an EVM withdraw transaction request for Privy sendTransaction.
 * Returns { to, chainId, value? (hex string) } for native transfers or
 * { to: tokenContract, chainId, data } for ERC-20 transfers.
 * Throws with a user-presentable message on invalid input.
 */
export async function buildWithdrawTx({ activeChain, token, toAddress, amount }) {
  const chainId = EVM_CHAIN_IDS[activeChain]
  if (!chainId) {
    throw new Error(`Unsupported chain: ${activeChain}`)
  }
  if (!toAddress) throw new Error('Missing recipient address')

  const { ethers } = await import('ethers')

  if (token?.isNative) {
    const value = ethers.parseUnits(clampDecimals(amount, 18), 18)
    if (value <= 0n) throw new Error('Amount must be positive')
    return { to: toAddress, chainId, value: `0x${value.toString(16)}` }
  }

  if (!token?.contractAddress) throw new Error('Missing token contract address')
  const decimals = Number.isFinite(token?.decimals) ? token.decimals : 18
  const tokenAmount = ethers.parseUnits(clampDecimals(amount, decimals), decimals)
  if (tokenAmount <= 0n) throw new Error('Amount must be positive')

  const iface = new ethers.Interface(['function transfer(address to, uint256 amount)'])
  const data = iface.encodeFunctionData('transfer', [toAddress, tokenAmount])
  return { to: token.contractAddress, chainId, data }
}
