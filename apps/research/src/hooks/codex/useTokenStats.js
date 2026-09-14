import { useState, useEffect, useCallback } from 'react';
import { getDetailedTokenStats } from '@/services/codexApi';

/**
 * Hook for fetching detailed token stats
 */
export function useTokenStats(address, networkId = 1) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    if (!address) return;

    try {
      setLoading(true);
      const data = await getDetailedTokenStats(address, networkId);

      if (data?.token) {
        setStats({
          symbol: data.token.symbol,
          name: data.token.name,
          address: data.token.address,
          decimals: data.token.decimals,
          totalSupply: data.token.totalSupply,
          circulatingSupply: data.token.info?.circulatingSupply,
          logo: data.token.info?.imageLargeUrl || data.token.info?.imageThumbUrl,
        });
        setError(null);
      }
    } catch (err) {
      console.error('Failed to fetch token stats:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [address, networkId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, loading, error, refresh: fetchStats };
}
