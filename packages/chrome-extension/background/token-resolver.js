/**
 * Spectre AI — Token Resolver
 * Three-tier resolution: Local Registry → CoinGecko Search → Codex Search
 * Every crypto token should resolve — Codex covers DEX tokens CoinGecko misses
 */

import { lookupToken } from './token-registry.js';
import { registerGeckoId, getGeckoIdForSymbol } from './price-cache.js';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const SPECTRE_API = 'https://trade.spectreai.io';
const DEV_API = 'http://localhost:3001';

// Use dev server if running locally — re-check every 30s so reconnection works
let _resolvedApi = null;
let _resolvedAt = 0;
let _apiResolving = null; // Dedup concurrent calls
const API_RECHECK_INTERVAL = 30000; // Re-check localhost every 30s

/**
 * Determine API base: try localhost first (dev), fall back to production.
 * Re-checks periodically so if backend restarts, extension reconnects.
 */
export async function getApiBase() {
  if (_resolvedApi && (Date.now() - _resolvedAt < API_RECHECK_INTERVAL)) {
    return _resolvedApi;
  }
  if (_apiResolving) return _apiResolving;
  _apiResolving = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${DEV_API}/api/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        _resolvedApi = DEV_API;
        _resolvedAt = Date.now();
        return DEV_API;
      }
    } catch { /* localhost not available */ }
    _resolvedApi = SPECTRE_API;
    _resolvedAt = Date.now();
    return SPECTRE_API;
  })();
  const result = await _apiResolving;
  _apiResolving = null;
  return result;
}

// Session cache (in-memory, cleared on service worker restart)
const sessionCache = new Map();

// Persistent cache TTL: 24 hours for token identity, 60s for prices
const IDENTITY_TTL = 24 * 60 * 60 * 1000;
const PRICE_TTL = 60 * 1000;

// Resolver version — increment when matching logic changes to invalidate stale cache
const RESOLVER_VERSION = 4;

// Client-side stock safety net — if server is down, don't let these leak into crypto pipeline
const KNOWN_STOCK_TICKERS = new Set([
  'AAPL','MSFT','GOOGL','GOOG','AMZN','NVDA','TSLA','META','JPM','V','MA','BAC','GS','MS','C','WFC',
  'COIN','PYPL','SQ','NFLX','DIS','AMD','INTC','CRM','ADBE','ORCL','AVGO','MU','QCOM','TXN','ARM',
  'SMCI','CRWD','PANW','NOW','NET','SNOW','DDOG','ZS','TWLO','PLTR','GME','AMC','RIVN','LCID','SOFI',
  'HOOD','MSTR','IONQ','UBER','LYFT','ABNB','SHOP','SNAP','PINS','ROKU','RBLX','DKNG','SPOT','ZM',
  'JNJ','UNH','PFE','ABBV','MRK','LLY','WMT','HD','PG','KO','PEP','COST','MCD','NKE','SBUX','TGT',
  'LOW','VZ','T','XOM','CVX','COP','BA','CAT','GE','UPS','HON','SPY','QQQ','IWM','DIA','GLD','SLV',
  'VOO','ARKK','XLF','XLK','XLE','TLT','BRK.B',
]);

/**
 * Resolve a cashtag ticker to full token data
 * Priority: Tier 1 (local registry) → Tier 2 (CoinGecko) → Tier 3 (Codex/Spectre API)
 * NOTE: This function is ONLY called for crypto tokens — stocks are handled by the server's
 * /api/ext/resolve in the service worker's RESOLVE_CASHTAG handler before this is reached.
 * The KNOWN_STOCK_TICKERS safety net prevents stock symbols from leaking into the crypto pipeline.
 */
export async function resolveCashtag(ticker) {
  const upper = ticker.toUpperCase();

  // Safety net: if this is a known stock ticker, DON'T search crypto APIs
  // This can happen when the server is unreachable. Try the cashtag
  // endpoint first, then stop before generic crypto search.
  if (KNOWN_STOCK_TICKERS.has(upper)) {
    const stockFallback = await enrichWithCashtagSearch(upper);
    if (stockFallback) return stockFallback;
    console.log(`[Spectre] ${upper} is a known stock — skipping crypto resolve`);
    return null;
  }

  // Check session cache first
  const cached = sessionCache.get(upper);
  if (cached && cached.version === RESOLVER_VERSION && Date.now() - cached.timestamp < IDENTITY_TTL) {
    return cached.data;
  }

  // Check persistent cache
  const persistent = await getPersistentCache(upper);
  if (persistent && persistent.version === RESOLVER_VERSION && Date.now() - persistent.timestamp < IDENTITY_TTL) {
    sessionCache.set(upper, persistent);
    return persistent.data;
  }

  // Tier 1: Local registry (instant)
  const local = lookupToken(upper);
  if (local) {
    const result = {
      symbol: local.symbol,
      name: local.name,
      coingeckoId: local.coingeckoId || null,
      codex: local.codex || null,
      category: local.category || 'unknown',
      tier: 1,
    };
    if (!result.coingeckoId) {
      return await enrichWithCashtagSearch(upper, result);
    }
    cacheResult(upper, result);
    return result;
  }

  // Tier 2: CoinGecko search (~200ms)
  try {
    const geckoResult = await searchCoinGecko(upper);
    if (geckoResult) {
      // Fire-and-forget: enrich with Codex in background (don't block response)
      searchCodex(upper).then(codexEnrich => {
        if (!codexEnrich?.codex) return;
        const codexMcap = codexEnrich.codexPriceData?.marketCap || 0;
        const codexName = (codexEnrich.name || '').toLowerCase();
        const geckoName = (geckoResult.name || '').toLowerCase();
        const nameOverlap = geckoName.includes(codexName.split(' ')[0]) ||
                            codexName.includes(geckoName.split(' ')[0]) ||
                            geckoName.split(' ')[0] === codexName.split(' ')[0];
        if (codexMcap > 10000 || nameOverlap) {
          geckoResult.codex = codexEnrich.codex;
          geckoResult.image = geckoResult.image || codexEnrich.image;
          cacheResult(upper, geckoResult);
        }
      }).catch(() => {});

      cacheResult(upper, geckoResult);
      return geckoResult;
    }
  } catch (err) {
    console.warn(`[Spectre] CoinGecko search failed for ${upper}:`, err.message);
  }

  // Tier 3: Codex / Spectre API search — covers ALL DEX tokens
  try {
    const codexResult = await searchCodex(upper);
    if (codexResult) {
      if (!codexResult.coingeckoId) {
        return await enrichWithCashtagSearch(upper, codexResult);
      }
      cacheResult(upper, codexResult);
      return codexResult;
    }
  } catch (err) {
    console.warn(`[Spectre] Codex search failed for ${upper}:`, err.message);
  }

  // Tier 4: Dexscreener direct search — last resort
  try {
    const dexResult = await searchDexscreener(upper);
    if (dexResult) {
      if (!dexResult.coingeckoId) {
        return await enrichWithCashtagSearch(upper, dexResult);
      }
      cacheResult(upper, dexResult);
      return dexResult;
    }
  } catch (err) {
    console.warn(`[Spectre] Dexscreener search failed for ${upper}:`, err.message);
  }

  return await enrichWithCashtagSearch(upper);
}

export async function enrichWithCashtagSearch(ticker, token = null) {
  const upper = (ticker || token?.symbol || '').toUpperCase();
  if (!upper) return token;
  if (token?.coingeckoId) {
    cacheResult(upper, token);
    return token;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(
      `${COINGECKO_BASE}/search?query=${encodeURIComponent(upper)}`,
      { signal: controller.signal }
    );
    if (!response.ok) {
      if (token) cacheResult(upper, token);
      return token;
    }

    const data = await response.json();
    const match = selectCashtagSearchToken(data, upper);
    const geckoId = match?.id || null;
    if (!geckoId) {
      if (token) cacheResult(upper, token);
      return token;
    }

    registerGeckoId(upper, geckoId);

    const enriched = {
      ...(token || {}),
      symbol: token?.symbol || upper,
      name: token?.name || match.name || upper,
      coingeckoId: geckoId,
      image: token?.image || match.large || match.thumb || null,
      category: token?.category || 'unknown',
      tier: token?.tier || 5,
    };

    cacheResult(upper, enriched);
    return enriched;
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn(`[Spectre] Cashtag search failed for ${upper}:`, err.message);
    }
    if (token) cacheResult(upper, token);
    return token;
  } finally {
    clearTimeout(timeout);
  }
}

function selectCashtagSearchToken(data, upperSymbol) {
  const coins = Array.isArray(data?.coins) ? data.coins : [];
  if (coins.length === 0) return null;
  // Prefer exact symbol match; fall back to first result (CG ranks by market cap).
  const exact = coins.find(c => (c?.symbol || '').toUpperCase() === upperSymbol);
  return exact || coins[0] || null;
}

/**
 * Tier 2: Search CoinGecko for token info
 */
async function searchCoinGecko(ticker) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(
      `${COINGECKO_BASE}/search?query=${encodeURIComponent(ticker)}`,
      { signal: controller.signal }
    );
    if (!response.ok) return null;

    const data = await response.json();
    const coins = data.coins || [];

    // Find best match — exact symbol match with best rank, then first result
    const exactMatches = coins.filter(c => c.symbol?.toUpperCase() === ticker);
    let match;
    if (exactMatches.length > 1) {
      // Multiple exact symbol matches — pick highest rank (lowest number = most popular)
      match = exactMatches.sort((a, b) => (a.market_cap_rank || 99999) - (b.market_cap_rank || 99999))[0];
    } else {
      match = exactMatches[0] || coins[0];
    }

    if (!match) return null;

    // Register the geckoId for price fetching
    registerGeckoId(ticker, match.id);

    return {
      symbol: match.symbol?.toUpperCase() || ticker,
      name: match.name || ticker,
      coingeckoId: match.id || null,
      codex: null,
      image: match.large || match.thumb || null,
      category: 'unknown',
      tier: 2,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Tier 3: Search Codex via Spectre API — covers all DEX tokens
 * Returns token identity + on-chain address + basic price data
 * Ranks results by market cap to avoid picking tiny fake tokens over real ones
 */
async function searchCodex(ticker) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    // Use resolved API base (localhost if available, else production)
    const apiBase = await getApiBase();
    const response = await fetch(
      `${apiBase}/api/tokens/search?q=${encodeURIComponent(ticker)}`,
      { signal: controller.signal }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const results = data.results || [];
    if (results.length === 0) return null;

    // Find ALL exact symbol matches, then pick the one with highest market cap
    const exactMatches = results.filter(r =>
      r.token?.symbol?.toUpperCase() === ticker
    );

    let best;
    if (exactMatches.length > 1) {
      // Multiple tokens share this symbol — pick highest market cap (avoids fake/scam tokens)
      best = exactMatches.sort((a, b) =>
        (parseFloat(b.marketCap) || 0) - (parseFloat(a.marketCap) || 0)
      )[0];
    } else if (exactMatches.length === 1) {
      best = exactMatches[0];
    } else {
      // No exact match — use first result (sorted by relevance from API)
      best = results[0];
    }
    const token = best.token;

    if (!token) return null;

    return {
      symbol: token.symbol?.toUpperCase() || ticker,
      name: token.name || ticker,
      coingeckoId: null, // Codex tokens may not have CoinGecko IDs
      codex: {
        address: token.address,
        networkId: token.networkId || 1,
      },
      image: token.info?.imageLargeUrl || token.info?.imageThumbUrl || null,
      category: 'unknown',
      tier: 3,
      // Include price data from Codex search results for immediate use
      codexPriceData: {
        price: parseFloat(best.priceUSD) || 0,
        change24: parseFloat(best.change24) || 0, // Codex returns as percentage already
        volume: parseFloat(best.volume24 || best.volume) || 0,
        marketCap: parseFloat(best.marketCap) || 0,
        holders: parseInt(best.holders) || null,
        liquidity: parseFloat(best.liquidity) || 0,
      },
    };
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn(`[Spectre] Codex search error for ${ticker}:`, err.message);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Tier 4: Search Dexscreener directly — covers nearly all DEX tokens
 * Ranks results by liquidity to avoid picking tiny fake tokens
 */
async function searchDexscreener(ticker) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(ticker)}`,
      { signal: controller.signal }
    );
    if (!response.ok) return null;

    const data = await response.json();
    const pairs = data.pairs || [];
    if (pairs.length === 0) return null;

    // Find ALL exact symbol matches, then pick the one with highest liquidity
    const exactMatches = pairs.filter(p =>
      p.baseToken?.symbol?.toUpperCase() === ticker
    );

    let best;
    if (exactMatches.length > 1) {
      // Multiple pairs share this symbol — pick highest liquidity (avoids fake/scam tokens)
      best = exactMatches.sort((a, b) =>
        (parseFloat(b.liquidity?.usd) || 0) - (parseFloat(a.liquidity?.usd) || 0)
      )[0];
    } else if (exactMatches.length === 1) {
      best = exactMatches[0];
    } else {
      best = pairs[0];
    }
    const baseToken = best.baseToken;

    if (!baseToken) return null;

    // Map Dexscreener chain to networkId
    const chainToNetworkId = {
      'ethereum': 1,
      'bsc': 56,
      'polygon': 137,
      'avalanche': 43114,
      'arbitrum': 42161,
      'optimism': 10,
      'base': 8453,
      'solana': 1399811149,
    };

    return {
      symbol: baseToken.symbol?.toUpperCase() || ticker,
      name: baseToken.name || ticker,
      coingeckoId: null,
      codex: {
        address: baseToken.address,
        networkId: chainToNetworkId[best.chainId] || 1,
      },
      image: best.info?.imageUrl || null,
      category: 'unknown',
      tier: 4,
      codexPriceData: {
        price: parseFloat(best.priceUsd) || 0,
        change24: parseFloat(best.priceChange?.h24) || 0,
        volume: parseFloat(best.volume?.h24) || 0,
        marketCap: parseFloat(best.fdv) || 0,
        liquidity: parseFloat(best.liquidity?.usd) || 0,
      },
    };
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn(`[Spectre] Dexscreener search error for ${ticker}:`, err.message);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Cache a resolved token (includes resolver version for invalidation)
 */
function cacheResult(ticker, data) {
  const entry = { data, timestamp: Date.now(), version: RESOLVER_VERSION };
  sessionCache.set(ticker, entry);
  setPersistentCache(ticker, entry);
}

/**
 * Get from chrome.storage.local persistent cache
 */
async function getPersistentCache(ticker) {
  try {
    const key = `token_${ticker}`;
    const result = await chrome.storage.local.get(key);
    return result[key] || null;
  } catch {
    return null;
  }
}

/**
 * Set in chrome.storage.local persistent cache
 */
async function setPersistentCache(ticker, entry) {
  try {
    const key = `token_${ticker}`;
    await chrome.storage.local.set({ [key]: entry });
  } catch (err) {
    console.warn('[Spectre] Cache write failed:', err.message);
  }
}

/**
 * Fetch live price data for a resolved token using CoinGecko
 */
export async function fetchTokenPrice(symbol) {
  const cacheKey = `price_${symbol}`;
  const cached = sessionCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < PRICE_TTL) {
    return cached.data;
  }

  // Look up the token to get its geckoId — check local registry AND registered geckoIds
  const token = lookupToken(symbol);
  let geckoId = token?.coingeckoId;
  if (!geckoId) {
    geckoId = getGeckoIdForSymbol(symbol);
  }
  if (!geckoId) return null;

  try {
    // Use /coins/markets to get sparkline + comprehensive data (not just /simple/price)
    const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(geckoId)}&sparkline=true&price_change_percentage=1h,24h,7d,30d`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const coins = await response.json();
    const coin = coins?.[0];
    if (!coin) return null;

    const priceData = {
      price: coin.current_price || 0,
      change24: coin.price_change_percentage_24h || 0,
      change1h: coin.price_change_percentage_1h_in_currency || null,
      change7d: coin.price_change_percentage_7d_in_currency || null,
      change30d: coin.price_change_percentage_30d_in_currency || null,
      marketCap: coin.market_cap || 0,
      volume: coin.total_volume || 0,
      high24: coin.high_24h || null,
      low24: coin.low_24h || null,
      circulatingSupply: coin.circulating_supply || null,
      ath: coin.ath || null,
      sparkline: coin.sparkline_in_7d?.price || null,
      image: coin.image || null,
      rank: coin.market_cap_rank || null,
    };
    sessionCache.set(cacheKey, { data: priceData, timestamp: Date.now() });
    return priceData;
  } catch {
    return null;
  }
}
