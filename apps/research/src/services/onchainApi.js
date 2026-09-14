/**
 * Spectre Onchain API Service
 *
 * Client-side service for our api-eth backend, accessed via
 * packages/server proxy at /api/onchain/...
 *
 * Provides the same function signatures as codexApi.js so hooks
 * can swap between sources transparently.
 */

// Chains our API supports — everything else falls back to Codex
const ONCHAIN_EVM_CHAINS = new Set([1, 56]);
const SOLANA_NETWORK_ID = 1399811149;

// When true, skip all Codex/CoinGecko fallbacks — use only Spectre API (for testing)
export const SPECTRE_API_ONLY = import.meta.env.VITE_SPECTRE_API_ONLY === 'true';

export function isOnchainSupported(networkId) {
  return ONCHAIN_EVM_CHAINS.has(networkId) || networkId === SOLANA_NETWORK_ID;
}

// Base URL — same in dev (Vite proxy) and prod (Vercel)
const BASE = '/api/onchain';

// ═══════════════════════════════════════════════════════════════════════════════
// Core fetch helper + cache/dedup
//
// onchainApi was the one major data-layer service with no caching or in-flight
// dedup, so the same token rendered on one screen (RZ markets + codex hooks +
// token analytics + trading-chart) fired N identical requests. Two guards:
//   - In-flight dedup runs for EVERY GET (concurrent identical URLs share one
//     promise) — pure win, no staleness, kills the duplicate-fetch storm.
//   - TTL cache is OPT-IN per call via options.ttl, so live feeds (prices,
//     swaps, search) stay fresh while slow-moving reads (details, pools, bars,
//     holders) reuse a short window.
// getPoolAnalytics (POST, has a body) bypasses this entirely.
// ═══════════════════════════════════════════════════════════════════════════════

const _cache = {};     // { [url]: { data, ts } }
const _inflight = {};   // { [url]: Promise }

async function onchainFetch(path, params = {}, options = {}) {
  const url = new URL(path, window.location.origin);
  // All path-relative to BASE
  url.pathname = `${BASE}${path}`;

  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }

  const key = url.toString();
  const ttl = options.ttl; // ms; when set, reuse a cached response within the window

  if (ttl) {
    const hit = _cache[key];
    if (hit && Date.now() - hit.ts < ttl) return hit.data;
  }
  // Always collapse concurrent identical GETs onto one in-flight request.
  if (_inflight[key]) return _inflight[key];

  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 10000);
    try {
      const res = await fetch(key, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        ...options.fetchOptions,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      return await res.json();
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw err;
    }
  })()
    .then((data) => {
      if (ttl) _cache[key] = { data, ts: Date.now() };
      delete _inflight[key];
      return data;
    })
    .catch((err) => {
      delete _inflight[key];
      throw err;
    });

  _inflight[key] = promise;
  return promise;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Token endpoints
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get token details with live metrics
 * @returns {{ success, data: NormalizedToken, _source }}
 */
export async function getTokenDetails(address, networkId = 1) {
  return onchainFetch(`/token/${address}`, { chainId: networkId }, { ttl: 15000 });
}

/**
 * Search tokens by symbol/name/address
 * @returns {{ success, data: NormalizedToken[], _source }}
 */
export async function searchTokens(query, networkId = 1, limit = 20) {
  // Short timeout so aborted/abandoned keystroke searches don't occupy a 10s
  // slot each. The header debounces rapid typing but the per-keystroke fetch
  // still hits the backend; a tight ceiling keeps the total fan-out bounded.
  return onchainFetch('/tokens/search', { q: query, chainId: networkId, limit }, { timeout: 3000 });
}

/**
 * Get trending tokens sorted by volume/gainers/losers
 * @param {string} sort - volume_24h | gainers | losers | txn_count_24h
 * @returns {{ success, data: NormalizedToken[], _source }}
 */
export async function getTrendingTokens(networkId = 1, sort = 'volume_24h', limit = 50) {
  return onchainFetch('/tokens/trending', { chainId: networkId, sort, limit }, { ttl: 30000 });
}

/**
 * Get batch token prices for watchlist
 * @param {string[]} addresses
 * @returns {{ success, data: PriceData[], _source }}
 */
export async function getBatchPrices(addresses, networkId = 1) {
  if (!addresses.length) return { success: true, data: [] };
  return onchainFetch('/tokens/prices', {
    chainId: networkId,
    addresses: addresses.join(','),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pool endpoints
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get all pools for a token
 * @returns {{ success, data: NormalizedPool[], _source }}
 */
export async function getTokenPools(address, networkId = 1) {
  return onchainFetch(`/token/${address}/pools`, { chainId: networkId }, { ttl: 30000 });
}

/**
 * Get pool details
 * @returns {{ success, data: NormalizedPool, _source }}
 */
export async function getPoolDetails(address, networkId = 1) {
  return onchainFetch(`/pool/${address}`, { chainId: networkId }, { ttl: 30000 });
}

/**
 * Get OHLCV candles for a pool
 * @param {string} interval - 1s|30s|1m|5m|15m|1h|4h|6h|12h|1d
 * @returns {{ success, data: Bar[], _source }}
 */
export async function getBars(poolAddress, interval = '1h', from, to, networkId = 1, limit = 500) {
  return onchainFetch(`/pool/${poolAddress}/ohlcv`, {
    chainId: networkId,
    interval,
    from,
    to,
    limit,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Trade/Swap endpoints
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get recent trades for a token (auto multi-pool for four.meme)
 * @returns {{ success, data: NormalizedTrade[], cursors, _source }}
 */
export async function getLatestTrades(address, networkId = 1, limit = 50, options = {}) {
  return onchainFetch(`/token/${address}/swaps`, {
    chainId: networkId,
    limit,
    from: options.from,
    to: options.to,
    cursor: options.cursor,
    maker: options.maker,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Holder endpoints (Spectre-only data)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get top holders for a token
 * @returns {{ success, data: Holder[], _source }}
 */
export async function getTokenHolders(address, networkId = 1, limit = 20) {
  return onchainFetch(`/token/${address}/holders`, { chainId: networkId, limit }, { ttl: 30000 });
}

/**
 * Get holder count over time
 * @param {string} bucket - 1h|4h|1d
 * @returns {{ success, data: HolderChartPoint[], _source }}
 */
export async function getHoldersChart(address, networkId = 1, bucket = '1h', from, to) {
  return onchainFetch(`/token/${address}/holders/chart`, {
    chainId: networkId, bucket, from, to,
  }, { ttl: 30000 });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Analytics endpoints (Spectre-only data)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get first buyers for a pool
 * @returns {{ success, data: FirstBuyer[], summary, _source }}
 */
export async function getFirstBuyers(poolAddress, networkId = 1, limit = 100) {
  return onchainFetch(`/pool/${poolAddress}/first-buyers`, { chainId: networkId, limit }, { ttl: 60000 });
}

/**
 * Get analytics for a pool (VWAP, percentiles, biggest trades, etc.)
 * @param {string} action - vwap|tradesizepercentiles|biggestbuy|biggestsell|topmakersbypnl|etc
 * @param {object} body - { lp, token?, from?, to?, limit? }
 */
export async function getPoolAnalytics(action, body, networkId = 1) {
  const url = new URL(`${BASE}/analytics/${action}`, window.location.origin);
  url.searchParams.set('chainId', String(networkId));
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Network endpoints
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get supported networks
 * @returns {{ success, data: Network[], _source }}
 */
export async function getNetworks() {
  return onchainFetch('/networks', {}, { ttl: 300000 });
}

/**
 * Get volume heatmap (24h, 10min buckets)
 * @returns {{ success, data: HeatmapBucket[], _source }}
 */
export async function getHeatmap(networkId = 1) {
  return onchainFetch('/heatmap', { chainId: networkId }, { ttl: 30000 });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stats (internal use)
// ═══════════════════════════════════════════════════════════════════════════════

export async function getStats() {
  return onchainFetch('/_stats');
}
