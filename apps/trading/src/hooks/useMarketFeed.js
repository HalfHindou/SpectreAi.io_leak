/**
 * useMarketFeed — the canonical "category + chain + timeframe -> token list"
 * feed shared by the Discover board (TokenDiscoveryTable) and the token-page
 * left rail (TokenScreener). Both surfaces call the SAME underlying Codex hooks
 * (useTrendingTokens / useTopCoins / useMostVisited) through this one path and
 * apply the SAME ordering (sortTokensByCategory), so they always show the same
 * tokens for the same selection instead of diverging.
 *
 * Returns the chain-filtered, name-filtered, category-sorted list UNCAPPED
 * (callers slice to their own display limit). Mirrors the data plumbing in
 * TokenDiscoveryTable's filteredTokens, minus the table's column-sort overlay.
 */

import { useMemo } from 'react'
import { useTrendingTokens, useTopCoins, useMostVisited } from './useCodexData'
import {
  CHAIN_NET_IDS,
  ALL_TREND_CHAINS,
  sortTokensByCategory,
} from '../lib/marketFormat'

export default function useMarketFeed({
  category = 'trending',
  chainId = 'all',
  timeframe = '24h',
  limit,
} = {}) {
  const networkIds = CHAIN_NET_IDS[chainId] || ALL_TREND_CHAINS

  // Trending board powers trending / gainers / volume / new. Always on — it
  // shares the module cache the header ticker keeps warm app-wide, so this is
  // effectively a cache read, not a new poll.
  const { tokens: trendingTokens, loading: trendingLoading } =
    useTrendingTokens(60000, networkIds, timeframe)

  // Top Coins (global, by market cap). Dormant unless the Top Coins category
  // is active (enabled flag) so the rail doesn't fetch it on every token page.
  const { tokens: topTokens, loading: topLoading } =
    useTopCoins(50, 60000, '', { enabled: category === 'top' })

  // Most Visited — real platform visits. 'all' passes no chains (every chain).
  // refreshInterval 0 keeps it dormant until the category is active.
  const visitedNetworkIds = chainId === 'all' ? [] : networkIds
  const { tokens: visitedTokens, loading: visitedLoading } = useMostVisited(
    visitedNetworkIds,
    category === 'visited' ? 60000 : 0,
    limit || 50,
    timeframe,
  )

  return useMemo(() => {
    // Top Coins uses its own source, no chain filter / category sort (matches
    // TokenDiscoveryTable, which returns topCoinsData directly).
    if (category === 'top') {
      const tokens = (topTokens || []).filter(t => t.symbol?.trim() && t.name?.trim())
      return { tokens: limit ? tokens.slice(0, limit) : tokens, loading: topLoading, error: null }
    }

    let source
    let loading
    if (category === 'visited') {
      // Dedupe by address, keep server view-rank order (matches visitedBase).
      const seen = new Set()
      const out = []
      for (const t of (visitedTokens || [])) {
        const k = (t.address || '').toLowerCase()
        if (k && !seen.has(k)) { seen.add(k); out.push(t) }
      }
      source = out
      loading = visitedLoading
    } else {
      source = trendingTokens || []
      loading = trendingLoading
    }

    // NO client chain-filter: the hooks already fetch per-chain (networkIds), so
    // it's redundant — and it was the blink. On a chain switch the previous
    // chain's tokens are still held in state for one render; client-filtering
    // them by the NEW chain emptied the list that render (before the new fetch
    // landed), which unmounted the pulse header + flashed the skeleton. Skipping
    // it lets the previous list stand until the new data arrives -> the rail
    // updates in place, no blink, no jump.
    let tokens = source.filter(t => t.symbol?.trim() && t.name?.trim())
    tokens = sortTokensByCategory(tokens, category, timeframe)
    if (limit) tokens = tokens.slice(0, limit)
    return { tokens, loading, error: null }
  }, [
    category, chainId, timeframe, limit,
    trendingTokens, topTokens, visitedTokens,
    trendingLoading, topLoading, visitedLoading,
  ])
}
