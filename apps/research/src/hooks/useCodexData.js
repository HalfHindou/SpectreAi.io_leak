/**
 * Custom React Hooks for Codex API Data - barrel re-export.
 *
 * Originally a single ~1880-line file. Split into ./codex/* sub-modules so
 * each hook lives in its own file. Module-level singletons (caches,
 * WebSocket, persisted token index, search dedup) live in ./codex/_shared.js
 * and are imported by every consumer to preserve identical runtime behaviour.
 *
 * All historical imports (`@/hooks/useCodexData`) keep working unchanged.
 */
export { isWSUnavailable, prefetchPopularSearches, searchLocalTokenIndex } from './codex/_shared';
export { useRealtimePrice } from './codex/useRealtimePrice';
export { useTrendingTokens } from './codex/useTrendingTokens';
export { useCuratedTokenPrices } from './codex/useCuratedTokenPrices';
export { useTokenSearch } from './codex/useTokenSearch';
export { useTokenStats } from './codex/useTokenStats';
export { useChartData } from './codex/useChartData';
export { useTokenPairs } from './codex/useTokenPairs';
export { useLatestTrades } from './codex/useLatestTrades';
export { useFullTokenData } from './codex/useFullTokenData';
export { useTokenDetails } from './codex/useTokenDetails';
export { useBinanceTopCoinPrices } from './codex/useBinanceTopCoinPrices';

import { useTrendingTokens } from './codex/useTrendingTokens';
import { useTokenSearch } from './codex/useTokenSearch';
import { useTokenStats } from './codex/useTokenStats';
import { useChartData } from './codex/useChartData';
import { useTokenPairs } from './codex/useTokenPairs';
import { useLatestTrades } from './codex/useLatestTrades';
import { useFullTokenData } from './codex/useFullTokenData';
import { useTokenDetails } from './codex/useTokenDetails';
import { useBinanceTopCoinPrices } from './codex/useBinanceTopCoinPrices';

export default {
  useTrendingTokens,
  useTokenSearch,
  useTokenStats,
  useChartData,
  useTokenPairs,
  useLatestTrades,
  useFullTokenData,
  useTokenDetails,
  useBinanceTopCoinPrices,
};
