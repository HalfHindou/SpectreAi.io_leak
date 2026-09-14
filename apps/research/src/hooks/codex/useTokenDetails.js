import { useState, useEffect, useCallback, useRef } from 'react';
import { isAppActive } from '@/lib/idleManager';
import {
  getDetailedTokenInfo,
  getTokenMarketProfile,
} from '@/services/codexApi';
import {
  isOnchainSupported,
  SPECTRE_API_ONLY,
  getTokenDetails as onchainGetTokenDetails,
} from '@/services/onchainApi';
import { tokenDetailsCache, CACHE_TTL } from './_shared';

/**
 * Hook for fetching detailed token info for the main banner.
 *
 * 2026-05-15 cost-audit refactor: shared subscriber pattern. Previously every
 * mount of this hook created its own setInterval + its own Codex queries. Token
 * pages with banner + watchlist tooltip + dossier card + brain mention can mount
 * 5+ instances of this hook simultaneously, each firing 2 Codex queries every
 * 60s. Now there is ONE timer per (address, networkId) regardless of N
 * renderers — all subscribers share the same fetch + broadcast.
 *
 * Fetch logic, fallback chain, and cache write behaviour are unchanged.
 */

// Shared subscriber registry. Key: `${address}-${networkId}` (lowercased).
// Value: { listeners: Set<setState>, cgId, timer, inflight, refreshInterval }
const _subscribers = new Map();

async function _fetchOnce(address, networkId, cgId) {
  let data = null;

  // Try onchain API first for supported chains
  if (isOnchainSupported(networkId)) {
    try {
      const res = await onchainGetTokenDetails(address, networkId);
      if (res?.success && res.data) {
        const price = parseFloat(res.data.price || res.data.priceUSD) || 0;
        if (price > 0) {
          data = {
            ...res.data,
            price,
            change24: res.data.change24 || res.data.change24h || 0,
            volume24: res.data.volume24h || 0,
            _source: 'spectre',
          };
        }
      }
    } catch (err) {
      console.warn('[onchain] Token details fallback to Codex:', err.message);
    }
  }

  // Codex fallback when Spectre API returns no data or no price
  if (!data && !SPECTRE_API_ONLY) {
    data = await getDetailedTokenInfo(address, networkId);
  }

  // CoinGecko fallback when we have no price data
  if ((!data || !data.price) && !SPECTRE_API_ONLY) {
    if (cgId) {
      try {
        const profileData = await getTokenMarketProfile(cgId);
        if (profileData && profileData.price > 0) {
          data = { ...(data || {}), ...profileData };
        }
      } catch (err) {
        console.warn('[coingecko] Market profile fallback failed:', err.message);
      }
    }
    if ((!data || !data.price) && address) {
      try {
        const platform = networkId === 56 ? 'binance-smart-chain'
          : networkId === 137 ? 'polygon-pos'
          : networkId === 42161 ? 'arbitrum-one'
          : networkId === 8453 ? 'base'
          : 'ethereum';
        const cgRes = await fetch(`/api/coingecko/coins/${platform}/contract/${address.toLowerCase()}`);
        if (cgRes.ok) {
          const coin = await cgRes.json();
          const md = coin?.market_data;
          if (md?.current_price?.usd > 0) {
            data = {
              ...(data || {}),
              address,
              name: coin.name || data?.name || '',
              symbol: (coin.symbol || data?.symbol || '').toUpperCase(),
              networkId,
              description: coin.description?.en || data?.description || '',
              logo: coin.image?.small || coin.image?.thumb || data?.logo || null,
              price: md.current_price.usd,
              marketCap: md.market_cap?.usd || 0,
              volume24: md.total_volume?.usd || 0,
              change24: md.price_change_percentage_24h || 0,
              change1h: md.price_change_percentage_1h_in_currency?.usd || 0,
              change7d: md.price_change_percentage_7d || 0,
              change30d: md.price_change_percentage_30d || 0,
              circulatingSupply: md.circulating_supply || 0,
              totalSupply: md.total_supply || 0,
              fullyDilutedValuation: md.fully_diluted_valuation?.usd || 0,
              high24h: md.high_24h?.usd || 0,
              low24h: md.low_24h?.usd || 0,
              ath: md.ath?.usd || 0,
              categories: coin.categories || [],
              _source: 'coingecko',
            };
          }
        }
      } catch (err) {
        console.warn('[coingecko] Contract lookup fallback failed:', err.message);
      }
    }
  }

  // Enrich logo from CoinGecko when Codex/onchain logo is empty/broken
  if (data && !SPECTRE_API_ONLY && address) {
    const hasValidLogo = data.logo && data.logo.startsWith('http');
    if (!hasValidLogo) {
      try {
        const platform = networkId === 56 ? 'binance-smart-chain'
          : networkId === 137 ? 'polygon-pos'
          : networkId === 42161 ? 'arbitrum-one'
          : networkId === 8453 ? 'base'
          : 'ethereum';
        const cleanAddr = address.includes(':') ? address.split(':')[0] : address;
        const logoRes = await fetch(`/api/coingecko/coins/${platform}/contract/${cleanAddr.toLowerCase()}`);
        if (logoRes.ok) {
          const coin = await logoRes.json();
          const logoUrl = coin.image?.small || coin.image?.thumb || null;
          if (logoUrl) data.logo = logoUrl;
        }
      } catch (_) { /* logo is non-critical */ }
    }
  }

  return data;
}

async function _fetchAndBroadcast(key, address, networkId, cgId) {
  const sub = _subscribers.get(key);
  if (!sub) return;
  if (sub.inflight) return sub.inflight; // dedup concurrent calls
  sub.inflight = (async () => {
    try {
      const data = await _fetchOnce(address, networkId, cgId);
      if (data) {
        tokenDetailsCache.set(key, { data, timestamp: Date.now() });
        // Broadcast to all live subscribers (sub may have been cleaned up between fetch + broadcast)
        const live = _subscribers.get(key);
        if (live) {
          live.listeners.forEach((setData) => setData({ tokenData: data, error: null, loading: false }));
        }
      }
      return data;
    } catch (err) {
      console.error('Failed to fetch token details:', err);
      const live = _subscribers.get(key);
      if (live) {
        live.listeners.forEach((setData) => setData((prev) => ({ ...(prev || {}), error: err.message, loading: false })));
      }
    } finally {
      const live = _subscribers.get(key);
      if (live) live.inflight = null;
    }
  })();
  return sub.inflight;
}

function _ensureSubscription(key, address, networkId, cgId, refreshInterval, listener) {
  let sub = _subscribers.get(key);
  if (!sub) {
    sub = {
      listeners: new Set(),
      cgId,
      timer: null,
      inflight: null,
      refreshInterval,
    };
    _subscribers.set(key, sub);
  } else if (cgId && !sub.cgId) {
    // Late-mount subscriber provided a cgId we didn't have — keep it for future fetches.
    sub.cgId = cgId;
  }
  sub.listeners.add(listener);

  // Start the shared timer on first subscriber.
  if (!sub.timer) {
    sub.timer = setInterval(() => {
      // Idle/visibility guard. Stops getDetailedTokenInfo on forgotten tabs.
      if (typeof document !== 'undefined' && document.hidden) return;
      if (!isAppActive()) return;
      _fetchAndBroadcast(key, address, networkId, sub.cgId);
    }, refreshInterval);
  }
}

function _releaseSubscription(key, listener) {
  const sub = _subscribers.get(key);
  if (!sub) return;
  sub.listeners.delete(listener);
  if (sub.listeners.size === 0) {
    if (sub.timer) clearInterval(sub.timer);
    _subscribers.delete(key);
  }
}

export function useTokenDetails(address, networkId = 1, refreshInterval = 60 * 1000, cgId = null) {
  const [state, setState] = useState(() => {
    if (!address) return { tokenData: null, loading: false, error: null };
    const cacheKey = `${address}-${networkId}`;
    const cached = tokenDetailsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      return { tokenData: cached.data, loading: false, error: null };
    }
    return { tokenData: null, loading: true, error: null };
  });

  const listenerRef = useRef(null);

  useEffect(() => {
    if (!address) {
      setState({ tokenData: null, loading: false, error: null });
      return;
    }
    const key = `${address}-${networkId}`;

    // Hand state setter to the shared registry so future broadcasts reach this mount.
    listenerRef.current = (next) => {
      setState((prev) => (typeof next === 'function' ? next(prev) : { ...prev, ...next }));
    };

    // Seed from cache immediately so consumers see data on the first paint.
    const cached = tokenDetailsCache.get(key);
    const isFresh = cached && (Date.now() - cached.timestamp) < CACHE_TTL;
    if (isFresh) {
      setState({ tokenData: cached.data, loading: false, error: null });
    }

    _ensureSubscription(key, address, networkId, cgId, refreshInterval, listenerRef.current);

    // Trigger an initial fetch only if cache is cold. Subsequent shared timer
    // ticks update all subscribers via the listener callbacks.
    if (!isFresh) {
      _fetchAndBroadcast(key, address, networkId, cgId);
    }

    return () => {
      _releaseSubscription(key, listenerRef.current);
      listenerRef.current = null;
    };
  }, [address, networkId, refreshInterval, cgId]);

  const refresh = useCallback(() => {
    if (!address) return;
    const key = `${address}-${networkId}`;
    return _fetchAndBroadcast(key, address, networkId, cgId);
  }, [address, networkId, cgId]);

  return { tokenData: state.tokenData, loading: state.loading, error: state.error, refresh };
}
