import { useTokenStats } from './useTokenStats';
import { useTokenPairs } from './useTokenPairs';
import { useLatestTrades } from './useLatestTrades';

/**
 * Combined hook for all token data (stats + pairs + trades)
 */
export function useFullTokenData(tokenAddress, networkId = 1) {
  const { stats, loading: statsLoading, error: statsError } = useTokenStats(tokenAddress, networkId);
  const { pairs, loading: pairsLoading, error: pairsError } = useTokenPairs(tokenAddress, networkId);

  // Get the main pair for trades
  const mainPair = pairs[0];
  const { trades, loading: tradesLoading, error: tradesError } = useLatestTrades(
    mainPair?.address,
    networkId,
    50
  );

  return {
    stats,
    pairs,
    trades,
    mainPair,
    loading: statsLoading || pairsLoading || tradesLoading,
    error: statsError || pairsError || tradesError,
  };
}
