/**
 * Spectre AI — API Client
 * Calls the existing Spectre server endpoints
 */

const API_URLS = ['http://localhost:3001', 'https://trade.spectreai.io'];

/**
 * Generic fetch with timeout, error handling, and automatic fallback
 * Tries localhost first (for development), then production
 */
async function spectreApiFetch(endpoint, options = {}) {
  let lastErr;
  for (const base of API_URLS) {
    const url = `${base}${endpoint}`;
    const controller = new AbortController();
    const timeoutMs = base.includes('localhost') ? 3000 : (options.timeout || 8000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
      if (!response.ok) {
        throw new Error(`API ${response.status}: ${response.statusText}`);
      }
      clearTimeout(timeout);
      return await response.json();
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
      // Try next URL
    }
  }
  throw lastErr || new Error(`API failed: ${endpoint}`);
}

/**
 * Search tokens by name or symbol (Tier 2 resolution)
 */
export async function searchTokens(query) {
  return spectreApiFetch(`/api/tokens/search?q=${encodeURIComponent(query)}`);
}

/**
 * Batch price lookup for multiple symbols
 */
export async function getBatchPrices(symbols) {
  const symbolStr = symbols.join(',');
  return spectreApiFetch(`/api/tokens/prices?symbols=${encodeURIComponent(symbolStr)}`);
}

/**
 * Single token price
 */
export async function getTokenPrice(symbol) {
  return spectreApiFetch(`/api/tokens/price/${encodeURIComponent(symbol)}`);
}

/**
 * Full token details by address
 */
export async function getTokenDetails(address, networkId) {
  return spectreApiFetch(`/api/token/details?address=${encodeURIComponent(address)}&networkId=${networkId}`);
}

/**
 * Trending tokens
 */
export async function getTrendingTokens() {
  return spectreApiFetch('/api/tokens/trending');
}

/**
 * Global market data (BTC dominance, total market cap, etc.)
 */
export async function getGlobalMarketData() {
  return spectreApiFetch('/api/market/global');
}

/**
 * Fear & Greed Index via CoinGecko proxy
 */
export async function getFearGreedIndex() {
  return spectreApiFetch('/api/coingecko/global');
}

/**
 * Market tickers (top gainers/losers)
 */
export async function getMarketTickers() {
  return spectreApiFetch('/api/market/tickers');
}

/**
 * CoinGecko coin data with sparkline (for popup mini charts)
 */
export async function getCoinMarketData(ids) {
  const idStr = ids.join(',');
  return spectreApiFetch(
    `/api/coingecko/coins/markets?vs_currency=usd&ids=${encodeURIComponent(idStr)}&sparkline=true&price_change_percentage=1h,24h,7d`
  );
}
