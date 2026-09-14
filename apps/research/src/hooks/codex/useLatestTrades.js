import { useState, useEffect, useCallback, useRef } from 'react';
import { isAppActive } from '@/lib/idleManager';
import {
  getLatestTrades,
  formatLargeNumber,
  formatPrice,
} from '@/services/codexApi';
import {
  isOnchainSupported,
  SPECTRE_API_ONLY,
  getLatestTrades as onchainGetLatestTrades,
} from '@/services/onchainApi';
import { tradesCache } from './_shared';

/**
 * Hook for fetching latest trades for a token
 */
/**
 * Hook for fetching latest trades for a token.
 *
 * 2026-05-15 cost audit: added `enabled` flag (defaults true for backward
 * compatibility). Caller should pass `enabled: false` when the trades panel
 * is hidden behind a tab or scrolled off-screen — saves 2 Codex queries
 * every 30s per inactive instance.
 */
export function useLatestTrades(tokenAddress, networkId = 1, initialLimit = 100, { enabled = true } = {}) {
  const [trades, setTrades] = useState([]);
  const [pairs, setPairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const currentLimitRef = useRef(initialLimit);

  const formatTradeData = (trade) => ({
    timestamp: new Date(trade.timestamp * 1000),
    type: trade.type || 'Swap',
    price: parseFloat(trade.priceUSD) || 0,
    amount: parseFloat(trade.amountToken) || 0,
    value: parseFloat(trade.amountUSD) || 0,
    maker: trade.maker || '',
    txHash: trade.txHash || '',
    symbol: trade.symbol || '',
    formattedPrice: formatPrice(trade.priceUSD),
    formattedValue: formatLargeNumber(trade.amountUSD),
  });

  const fetchTrades = useCallback(async (resetLimit = true) => {
    if (!tokenAddress) {
      setLoading(false);
      return;
    }

    try {
      if (resetLimit) {
        setLoading(true);
        currentLimitRef.current = initialLimit;
      }

      let tradesData = null;

      // Try onchain API first for supported chains
      if (isOnchainSupported(networkId)) {
        try {
          const res = await onchainGetLatestTrades(tokenAddress, networkId, currentLimitRef.current);
          if (res?.success && res.data?.length > 0) {
            tradesData = res.data.map(t => ({
              timestamp: new Date((t.timestamp || 0) * 1000),
              type: t.type || 'Swap',
              price: parseFloat(t.priceUSD) || 0,
              amount: parseFloat(t.amountToken) || 0,
              value: parseFloat(t.amountUSD) || 0,
              maker: t.maker || '',
              txHash: t.txHash || '',
              symbol: '',
              makerLabel: t.makerLabel || null,
              makerPnlUsd: t.makerPnlUsd || 0,
              makerTotalBuys: parseInt(t.makerTotalBuys) || 0,
              makerTotalSells: parseInt(t.makerTotalSells) || 0,
              formattedPrice: formatPrice(t.priceUSD),
              formattedValue: formatLargeNumber(t.amountUSD),
              _source: 'spectre',
            }));
          }
        } catch (err) {
          console.warn('[onchain] Trades fallback to Codex:', err.message);
        }
      }

      // Codex fallback
      if (!tradesData && !SPECTRE_API_ONLY) {
        const data = await getLatestTrades(tokenAddress, networkId, currentLimitRef.current);
        if (data?.trades && data.trades.length > 0) {
          tradesData = data.trades.map(formatTradeData);
        }
        if (data?.pairs) {
          setPairs(data.pairs);
        }
      }

      if (tradesData && tradesData.length > 0) {
        setTrades(tradesData);
        setHasMore(tradesData.length >= currentLimitRef.current && currentLimitRef.current < 200);
        setError(null);
        tradesCache.set(`${tokenAddress}_${networkId}`, { data: tradesData, timestamp: Date.now() });
      } else {
        if (resetLimit) {
          setTrades([]);
        }
        setHasMore(false);
      }
    } catch (err) {
      console.error('Failed to fetch trades:', err);
      setError(err.message);
      if (resetLimit) {
        setTrades([]); // Only clear on initial load, keep existing on refresh errors
      }
    } finally {
      setLoading(false);
    }
  }, [tokenAddress, networkId, initialLimit]);

  // Load more trades (capped at 200 due to API limits)
  const MAX_TRADES = 200;

  const loadMore = useCallback(async () => {
    if (!tokenAddress || loadingMore || !hasMore) return;

    // Check if we're at the max
    if (currentLimitRef.current >= MAX_TRADES) {
      setHasMore(false);
      return;
    }

    try {
      setLoadingMore(true);
      currentLimitRef.current = Math.min(currentLimitRef.current + 50, MAX_TRADES); // Load 50 more, capped at MAX
      const data = await getLatestTrades(tokenAddress, networkId, currentLimitRef.current);

      if (data?.trades && data.trades.length > 0) {
        setTrades(data.trades.map(formatTradeData));
        // Stop loading more if we've hit the max or API returned fewer than requested
        setHasMore(data.trades.length >= currentLimitRef.current && currentLimitRef.current < MAX_TRADES);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error('Failed to load more trades:', err);
      // On error, stop trying to load more (likely API limit reached)
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [tokenAddress, networkId, loadingMore, hasMore]);

  useEffect(() => {
    if (!enabled) return;
    fetchTrades();

    // Refresh every 30 seconds for live trades (increased from 15s due to larger payload)
    const interval = setInterval(() => {
      // Idle/visibility guard. Stops getLatestTrades on forgotten tabs.
      if (document.hidden || !isAppActive()) return
      fetchTrades(false)
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchTrades, enabled]);

  return { trades, pairs, loading, loadingMore, error, hasMore, refresh: fetchTrades, loadMore };
}
