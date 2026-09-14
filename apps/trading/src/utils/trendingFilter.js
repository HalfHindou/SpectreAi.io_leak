/**
 * trendingFilter — the shared ticker snapshot that keeps every "trending"
 * surface showing one identical list.
 *
 * Consumed by:
 *   - components/TokenTicker.jsx   (the scrolling header trending bar)
 *   - components/ui/CommandPalette/index.jsx  (search modal TRENDING section)
 *
 * HISTORY — this file used to also export a client-side quality filter
 * (`filterTrendingTokens` / `isQualityTrendingToken`). It was REMOVED
 * 2026-07-23 because it had become the reason the header bar disagreed with
 * the Discover table for the same chain. It dropped every sub-$100k-mcap
 * token (exactly the fresh launches these surfaces exist to show), deduped by
 * symbol alone (collapsing genuinely distinct same-ticker projects), and
 * re-sorted by raw 24h volume — discarding the trendScore ordering the engine
 * had just computed. The Discover table had already dropped it for those
 * reasons; the ticker and palette had not.
 *
 * Do NOT reintroduce a client-side trending filter. /api/tokens/trending is
 * the single source of truth: it excludes stablecoins / wrapped / LSTs / base
 * coins / majors, quality-gates on liquidity + recent activity + movement,
 * screens rugs and identity squats, collapses copycats by narrative, and
 * orders by trendScore. Consumers should apply only the sanity checks the
 * server cannot make (a usable symbol, a real price) and a length cap.
 */

import { useState, useEffect } from 'react'

// Chain IDs the ticker bar polls when it is NOT scoped to a single token's
// chain. Re-exported here so the palette can match without importing from the
// component layer. Same three chains as marketFormat's ALL_TREND_CHAINS, which
// is what the Discover table's "All" uses - keep them in step.
export const TRENDING_TICKER_CHAIN_IDS = [1, 1399811149, 56]

// ─── Shared ticker snapshot ────────────────────────────────────────────
// The header TokenTicker publishes the EXACT token set it's currently
// showing (after its filter + dedupe + map + chain-scope). The command
// palette's TRENDING section reads it so the two surfaces always show the
// identical list — same tokens, same order. Without this they diverged:
// the ticker scopes to the active token's chain on a token page, while the
// palette fetched all chains, so the sets never matched. Falls back to a
// fresh filterTrendingTokens() when empty (palette opened before the
// ticker mounted).
let _tickerTokens = []
const _tickerListeners = new Set()
export function publishTickerTokens(tokens) {
  _tickerTokens = Array.isArray(tokens) ? tokens : []
  _tickerListeners.forEach((fn) => { try { fn(_tickerTokens) } catch { /* noop */ } })
}
export function getTickerTokens() {
  return _tickerTokens
}

/**
 * Reactive consumer of the published ticker set. Components re-render the
 * instant TokenTicker republishes, so the palette + screener mirror the bar
 * with no flicker (vs reading getTickerTokens() once at render). Lives here
 * (next to the store) so both consumers share one subscription path.
 */
export function useTickerTokens() {
  const [tokens, setTokens] = useState(_tickerTokens)
  useEffect(() => {
    setTokens(_tickerTokens) // sync any publish that landed before subscribe
    _tickerListeners.add(setTokens)
    return () => { _tickerListeners.delete(setTokens) }
  }, [])
  return tokens
}
