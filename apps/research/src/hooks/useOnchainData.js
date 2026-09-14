/**
 * Spectre Onchain Data Hooks
 *
 * Hooks for data that ONLY our API provides (no Codex fallback).
 * These power new UI features: holders table, holder chart, first buyers,
 * analytics, and real-time WebSocket streams.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import useAdaptivePolling from '@/hooks/useAdaptivePolling';
import {
  getTokenHolders,
  getHoldersChart,
  getFirstBuyers,
  getPoolAnalytics,
  getBatchPrices,
  isOnchainSupported,
} from '../services/onchainApi';
import {
  useRealtimeSwaps,
  useRealtimeVolume,
  useRealtimeHolders,
  useRealtimePrice,
  useRealtimeOhlcv,
} from '../services/onchainWs';

// Re-export WebSocket hooks for convenience
export { useRealtimeSwaps, useRealtimeVolume, useRealtimeHolders, useRealtimePrice, useRealtimeOhlcv };

// ═══════════════════════════════════════════════════════════════════════════════
// Top Holders
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch top holders for a token.
 * Returns ranked list with address, balance, percentage of supply, last transfer.
 */
export function useTopHolders(address, networkId = 1, limit = 50) {
  const [holders, setHolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchHolders = useCallback(async () => {
    if (!address || !isOnchainSupported(networkId)) {
      setLoading(false);
      return;
    }

    try {
      const res = await getTokenHolders(address, networkId, limit);
      if (res?.success && res.data) {
        setHolders(res.data);
        setError(null);
      } else {
        setHolders([]);
      }
    } catch (err) {
      console.error('[useTopHolders] Failed:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [address, networkId, limit]);

  useEffect(() => {
    setLoading(true);
    fetchHolders();
  }, [fetchHolders]);

  // Refresh every 60 seconds with adaptive polling
  useAdaptivePolling(fetchHolders, { interval: 60000 });

  return { holders, loading, error, refresh: fetchHolders };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Holder Count Chart
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch holder count over time for charting.
 * @param {string} bucket - '1h' | '4h' | '1d'
 */
export function useHoldersChart(address, networkId = 1, bucket = '1h') {
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchChart = useCallback(async () => {
    if (!address || !isOnchainSupported(networkId)) {
      setLoading(false);
      return;
    }

    try {
      const res = await getHoldersChart(address, networkId, bucket);
      if (res?.success && res.data) {
        setChartData(res.data);
        setError(null);
      } else {
        setChartData([]);
      }
    } catch (err) {
      console.error('[useHoldersChart] Failed:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [address, networkId, bucket]);

  useEffect(() => {
    setLoading(true);
    fetchChart();
  }, [fetchChart]);

  // Refresh every 60 seconds with adaptive polling
  useAdaptivePolling(fetchChart, { interval: 60000 });

  return { chartData, loading, error, refresh: fetchChart };
}

// ═══════════════════════════════════════════════════════════════════════════════
// First Buyers / Sniper Detection
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch first buyers for a pool with sniper detection.
 * Returns ranked list + summary (sniper %, held %, etc.)
 */
export function useFirstBuyers(poolAddress, networkId = 1, limit = 100) {
  const [buyers, setBuyers] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchBuyers = useCallback(async () => {
    if (!poolAddress || !isOnchainSupported(networkId)) {
      setLoading(false);
      return;
    }

    try {
      const res = await getFirstBuyers(poolAddress, networkId, limit);
      if (res?.success) {
        setBuyers(res.data || []);
        setSummary(res.summary || null);
        setError(null);
      } else {
        setBuyers([]);
      }
    } catch (err) {
      console.error('[useFirstBuyers] Failed:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [poolAddress, networkId, limit]);

  useEffect(() => {
    setLoading(true);
    fetchBuyers();
  }, [fetchBuyers]);

  return { buyers, summary, loading, error, refresh: fetchBuyers };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pool Analytics (VWAP, percentiles, biggest trades, top traders by PnL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch analytics for a pool.
 * @param {string} action - vwap | tradesizepercentiles | biggestbuy | biggestsell | topmakersbypnl | uniquemakersbybucket
 * @param {object} body - { lp, token?, from?, to?, limit? }
 */
export function usePoolAnalytics(action, body, networkId = 1) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAnalytics = useCallback(async () => {
    if (!action || !body?.lp || !isOnchainSupported(networkId)) {
      setLoading(false);
      return;
    }

    try {
      const res = await getPoolAnalytics(action, body, networkId);
      if (res?.success !== false) {
        setData(res.data || res);
        setError(null);
      }
    } catch (err) {
      console.error(`[usePoolAnalytics:${action}] Failed:`, err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [action, JSON.stringify(body), networkId]);

  useEffect(() => {
    setLoading(true);
    fetchAnalytics();
  }, [fetchAnalytics]);

  return { data, loading, error, refresh: fetchAnalytics };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Batch Token Prices (for watchlist/ticker)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch batch prices for multiple token addresses.
 * Used by watchlist and ticker components.
 */
export function useBatchPrices(addresses, networkId = 1, refreshInterval = 15000) {
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPrices = useCallback(async () => {
    if (!addresses?.length || !isOnchainSupported(networkId)) {
      setLoading(false);
      return;
    }

    try {
      const res = await getBatchPrices(addresses, networkId);
      if (res?.success && res.data) {
        const priceMap = {};
        for (const item of res.data) {
          priceMap[item.address?.toLowerCase()] = {
            price: parseFloat(item.price_usd || item.price) || 0,
            change5m: parseFloat(item.price_change_5m || item.change5m) || 0,
            change1h: parseFloat(item.price_change_1h || item.change1h) || 0,
            change24h: parseFloat(item.price_change_24h || item.change24h) || 0,
            volume24h: parseFloat(item.volume_24h || item.volume24h) || 0,
            marketCap: parseFloat(item.market_cap_usd || item.marketCap) || 0,
          };
        }
        setPrices(priceMap);
        setError(null);
      }
    } catch (err) {
      console.error('[useBatchPrices] Failed:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(addresses), networkId]);

  useEffect(() => {
    setLoading(true);
    fetchPrices();
  }, [fetchPrices]);

  // Refresh with adaptive polling at the caller-specified interval
  useAdaptivePolling(fetchPrices, { interval: refreshInterval });

  return { prices, loading, error, refresh: fetchPrices };
}
