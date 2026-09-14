/**
 * swapParams - pure builder for /api/swap/quote request params.
 *
 * Extracted from useSwapExecution for two reasons (2026-07-06 audit):
 *   1. CROSS-CHAIN GUARD. The aggregators (0x, Jupiter) are single-chain.
 *      The old builder took the chain from the INPUT token only, so buying
 *      a Base token while paying with Ethereum-chain ETH quoted on Ethereum
 *      with the Base token's ADDRESS as output - whatever token happens to
 *      live at that address there. Mismatched chains now refuse to build
 *      with an actionable error instead.
 *   2. UNIT TESTABILITY. Pure function, no React/network.
 */
import { toBaseUnits } from './withdrawTx'

export const NETWORK_ID_TO_CHAIN = {
  1399811149: 'solana',
  56: 'bsc',
  137: 'polygon',
  42161: 'arbitrum',
  8453: 'base',
  4663: 'robinhood',
  1: 'ethereum',
}

export const CHAIN_LABELS = {
  solana: 'Solana',
  bsc: 'BNB Chain',
  polygon: 'Polygon',
  arbitrum: 'Arbitrum',
  base: 'Base',
  robinhood: 'Robinhood Chain',
  ethereum: 'Ethereum',
}

/**
 * The chains a swap can actually execute on. Mirrors the server's
 * ZEROX_CHAIN_IDS (apps/trading/api/swap.js) plus Solana via Jupiter - if a
 * chain is not here, /api/swap/quote answers 400 `Unsupported chain`.
 *
 * Derived from NETWORK_ID_TO_CHAIN so the two can never drift.
 */
export const SWAP_SUPPORTED_CHAINS = new Set(Object.values(NETWORK_ID_TO_CHAIN))

export function isSwapSupportedChain(chain) {
  return !!chain && SWAP_SUPPORTED_CHAINS.has(chain)
}

/**
 * networkId -> chain slug, or NULL when we cannot swap on that chain.
 *
 * Returning null is the whole point. This used to default to 'ethereum',
 * which quietly defeated the cross-chain guard documented at the top of this
 * file: discovery surfaces Avalanche / Optimism / Fantom / Cronos /
 * PulseChain / Blast tokens (LeftPanel maps those DexScreener slugs), and
 * each one resolved to 'ethereum'. The guard then compared 'ethereum' to
 * 'ethereum', passed, and we quoted the token's ADDRESS on mainnet - a
 * different contract entirely if that address is occupied there. Callers
 * must treat null as "not tradable" and refuse to build.
 */
export function chainForNetworkId(networkId) {
  return NETWORK_ID_TO_CHAIN[networkId] || null
}

/**
 * Parse a quote's price impact into PERCENT units, or null.
 * Jupiter (`priceImpactPct`) encodes a FRACTION ("0.0234" = 2.34%); 0x
 * (`estimatedPriceImpact`) encodes a PERCENT ("0.3" = 0.3%). The old
 * magnitude heuristic (<1 => fraction) read healthy sub-1% 0x impacts as
 * fractions - "0.3" became 30% and the 5% guard blocked perfectly liquid
 * EVM swaps. Disambiguate on the quote's provider; the magnitude heuristic
 * remains only for provider-less quotes (shouldn't exist).
 */
export function parsePriceImpact(quote) {
  const raw = quote?.priceImpactPct ?? quote?.estimatedPriceImpact
  if (raw == null) return null
  const n = typeof raw === 'string' ? parseFloat(raw) : Number(raw)
  if (!Number.isFinite(n)) return null
  const abs = Math.abs(n)
  if (quote?.provider === 'jupiter') return abs * 100
  if (quote?.provider === '0x') return abs
  return abs < 1 ? abs * 100 : abs
}

/**
 * Build quote params for the target token (the token page's token) against
 * the selected pay token. Returns { params } on success or { error } with a
 * user-presentable message - callers surface `error` as the quote error and
 * must NOT fall through to a quote request.
 */
export function buildSwapParams({ token, payToken, mode, amount, slippageBps = 50, userAddress }) {
  if (!token || !payToken || !amount) return { error: null }

  // Prefer an explicit chain slug on the token (RightPanel's spectreToken
  // carries chainId, not networkId); fall back to networkId mapping.
  const targetChain = (token.chainId && CHAIN_LABELS[token.chainId])
    ? token.chainId
    : chainForNetworkId(token.networkId)

  // Chain we cannot execute on at all (Avalanche, Optimism, Fantom, ...).
  // Refuse BEFORE the pay/target comparison: those tokens used to resolve to
  // 'ethereum' and sail through the guard below. Named so the panel can say
  // which chain, falling back to the raw networkId when we have no label.
  if (!isSwapSupportedChain(targetChain)) {
    const label = CHAIN_LABELS[token.chainId] || token.chainName
      || (token.networkId != null ? `network ${token.networkId}` : 'this network')
    return { error: `Trading not supported on ${label} yet`, unsupportedChain: true }
  }

  const payChain = payToken.chainId || 'ethereum'

  if (payChain !== targetChain) {
    const label = CHAIN_LABELS[targetChain] || targetChain
    return { error: `Pay with a ${label} token to trade this asset` }
  }

  const targetToken = {
    address: token.address || 'native',
    decimals: token.decimals || 18,
    chainId: targetChain,
  }

  const inputToken = mode === 'buy' ? payToken : targetToken
  const outputToken = mode === 'buy' ? targetToken : payToken
  const decimals = inputToken.decimals || 18

  let baseAmount
  try {
    baseAmount = toBaseUnits(amount, decimals)
  } catch {
    return { error: 'Invalid amount' }
  }
  if (baseAmount <= 0n) return { error: null }

  return {
    params: {
      chainId: targetChain,
      inputToken: inputToken.address || 'native',
      outputToken: outputToken.address || 'native',
      amount: baseAmount.toString(),
      slippageBps,
      userAddress: userAddress || undefined,
      inputDecimals: decimals,
      outputDecimals: outputToken.decimals || 18,
    },
  }
}
