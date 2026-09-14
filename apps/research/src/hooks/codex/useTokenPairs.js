import { useState, useEffect } from 'react';
import { getTokenPairs, formatLargeNumber } from '@/services/codexApi';
import {
  isOnchainSupported,
  SPECTRE_API_ONLY,
  getTokenPools as onchainGetTokenPools,
} from '@/services/onchainApi';

/**
 * Hook for fetching token pairs
 */
export function useTokenPairs(tokenAddress, networkId = 1) {
  const [pairs, setPairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!tokenAddress) return;

    async function fetchPairs() {
      try {
        setLoading(true);
        let formatted = null;

        // Try onchain API first
        if (isOnchainSupported(networkId)) {
          try {
            const res = await onchainGetTokenPools(tokenAddress, networkId);
            if (res?.success && res.data?.length > 0) {
              formatted = res.data.map(pool => ({
                address: pool.address,
                token0: pool.token0,
                token1: pool.token1,
                liquidity: pool.liquidity || 0,
                volume24h: pool.volume24h || 0,
                price: pool.price || 0,
                dexName: pool.dexName || '',
                formattedLiquidity: formatLargeNumber(pool.liquidity || 0),
                formattedVolume: formatLargeNumber(pool.volume24h || 0),
                _source: 'spectre',
              }));
            }
          } catch (err) {
            console.warn('[onchain] Pairs fallback to Codex:', err.message);
          }
        }

        // Codex fallback
        if (!formatted && !SPECTRE_API_ONLY) {
          const data = await getTokenPairs(tokenAddress, networkId);
          if (data?.listPairsForToken) {
            formatted = data.listPairsForToken.map(pair => ({
              address: pair.address,
              token0: pair.token0,
              token1: pair.token1,
              liquidity: pair.liquidity,
              volume24h: pair.volume24,
              price: pair.priceUSD,
              formattedLiquidity: formatLargeNumber(pair.liquidity),
              formattedVolume: formatLargeNumber(pair.volume24),
            }));
          }
        }

        if (formatted) {
          setPairs(formatted);
          setError(null);
        }
      } catch (err) {
        console.error('Failed to fetch token pairs:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchPairs();
  }, [tokenAddress, networkId]);

  return { pairs, loading, error };
}
