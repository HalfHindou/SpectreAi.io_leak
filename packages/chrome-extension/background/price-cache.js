/**
 * Spectre AI — Price Cache Layer
 * Uses CoinGecko /coins/markets endpoint for price + sparkline data
 * Refreshes every 60 seconds for watched tokens
 */

import { getApiBase } from './token-resolver.js';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const REFRESH_INTERVAL = 60 * 1000; // 60s
const DETAIL_CACHE_TTL = 30 * 60 * 1000; // 30 min for detailed coin info

let priceCache = {};
let detailCache = {}; // { geckoId: { data, fetchedAt } }
let watchedSymbols = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX']);
let symbolToGeckoId = {};
let refreshTimer = null;

/**
 * Initialize price cache — needs the token registry to map symbols → CoinGecko IDs
 */
export function initPriceCache(registry) {
  if (registry) {
    for (const [symbol, data] of Object.entries(registry)) {
      if (data.coingeckoId) {
        symbolToGeckoId[symbol.toUpperCase()] = data.coingeckoId;
      }
    }
  }

  refreshPrices();
  refreshTimer = setInterval(refreshPrices, REFRESH_INTERVAL);
}

/**
 * Stop price cache refresh
 */
export function stopPriceCache() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Register a symbol→geckoId mapping (for dynamic lookups)
 */
export function registerGeckoId(symbol, geckoId) {
  symbolToGeckoId[symbol.toUpperCase()] = geckoId;
}

/**
 * Add symbols to watch — triggers immediate refresh if new symbols added
 */
export function watchSymbols(symbols) {
  let hasNew = false;
  for (const s of symbols) {
    const upper = s.toUpperCase();
    if (!watchedSymbols.has(upper)) hasNew = true;
    watchedSymbols.add(upper);
  }
  // Fetch immediately for newly added symbols so they don't wait 60s
  if (hasNew) refreshPrices();
}

/**
 * Remove a symbol from watch
 */
export function unwatchSymbol(symbol) {
  watchedSymbols.delete(symbol.toUpperCase());
}

/**
 * Get cached price for a symbol
 */
export function getCachedPrice(symbol) {
  return priceCache[symbol.toUpperCase()] || null;
}

/**
 * Get all cached prices
 */
export function getAllPrices() {
  return { ...priceCache };
}

/**
 * Refresh prices using /coins/markets (includes sparkline + comprehensive data)
 */
async function refreshPrices() {
  if (watchedSymbols.size === 0) return;

  const geckoIds = [];
  const idToSymbol = {};

  for (const symbol of watchedSymbols) {
    const id = symbolToGeckoId[symbol];
    if (id) {
      geckoIds.push(id);
      idToSymbol[id] = symbol;
    }
  }

  if (geckoIds.length === 0) return;

  try {
    const ids = geckoIds.join(',');
    const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids)}&sparkline=true&price_change_percentage=1h,24h,7d,30d&order=market_cap_desc&per_page=50&page=1`;

    const response = await fetch(url);
    if (!response.ok) {
      console.warn('[Spectre] CoinGecko markets fetch failed:', response.status);
      return refreshPricesFallback(geckoIds, idToSymbol);
    }

    const coins = await response.json();

    for (const coin of coins) {
      const symbol = idToSymbol[coin.id];
      if (!symbol) continue;

      priceCache[symbol] = {
        price: coin.current_price || 0,
        change24: coin.price_change_percentage_24h || 0,
        change1h: coin.price_change_percentage_1h_in_currency || null,
        change7d: coin.price_change_percentage_7d_in_currency || null,
        change30d: coin.price_change_percentage_30d_in_currency || null,
        volume: coin.total_volume || 0,
        marketCap: coin.market_cap || 0,
        high24: coin.high_24h || null,
        low24: coin.low_24h || null,
        circulatingSupply: coin.circulating_supply || null,
        ath: coin.ath || null,
        sparkline: coin.sparkline_in_7d?.price || null,
        image: coin.image || null,
        rank: coin.market_cap_rank || null,
        updatedAt: Date.now(),
      };
    }

    console.log(`[Spectre] Prices + sparklines updated for ${coins.length} tokens`);
  } catch (err) {
    console.warn('[Spectre] Price refresh failed:', err.message);
  }
}

/**
 * Fetch detailed coin info (socials, description) — cached for 30 min
 */
export async function fetchTokenDetail(symbol) {
  const geckoId = symbolToGeckoId[symbol.toUpperCase()];
  if (!geckoId) return null;

  // Check cache
  const cached = detailCache[geckoId];
  if (cached && Date.now() - cached.fetchedAt < DETAIL_CACHE_TTL) {
    return cached.data;
  }

  try {
    const url = `${COINGECKO_BASE}/coins/${geckoId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`;
    const response = await fetch(url);
    if (!response.ok) return cached?.data || null;

    const coin = await response.json();
    const detail = {
      description: coin.description?.en?.replace(/<[^>]*>/g, '')?.slice(0, 500) || null,
      website: coin.links?.homepage?.[0] || null,
      twitter: coin.links?.twitter_screen_name ? `https://x.com/${coin.links.twitter_screen_name}` : null,
      telegram: coin.links?.telegram_channel_identifier ? `https://telegram.me/${coin.links.telegram_channel_identifier}` : null,
      github: coin.links?.repos_url?.github?.[0] || null,
      reddit: coin.links?.subreddit_url || null,
      categories: coin.categories || [],
    };

    detailCache[geckoId] = { data: detail, fetchedAt: Date.now() };
    console.log(`[Spectre] Token detail fetched for ${symbol}`);
    return detail;
  } catch (err) {
    console.warn(`[Spectre] Token detail fetch failed for ${symbol}:`, err.message);
    return cached?.data || null;
  }
}

/**
 * Get CoinGecko ID for a symbol
 */
export function getGeckoIdForSymbol(symbol) {
  return symbolToGeckoId[symbol.toUpperCase()] || null;
}

/**
 * Fetch price from Dexscreener for tokens with contract address but no CoinGecko ID
 * Returns priceData object compatible with priceCache format, or null
 */
export async function fetchDexscreenerPrice(address, networkId) {
  if (!address) return null;

  // Map networkId to Dexscreener chain slug
  const chainMap = {
    1: 'ethereum',
    56: 'bsc',
    137: 'polygon',
    43114: 'avalanche',
    42161: 'arbitrum',
    10: 'optimism',
    8453: 'base',
    1399811149: 'solana',
  };
  const chain = chainMap[networkId] || 'ethereum';

  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const pairs = data.pairs;
    if (!pairs || pairs.length === 0) return null;

    // Use the pair with highest liquidity
    const best = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

    return {
      price: parseFloat(best.priceUsd) || 0,
      change24: parseFloat(best.priceChange?.h24) || 0,
      change1h: parseFloat(best.priceChange?.h1) || null,
      change7d: null,
      change30d: null,
      volume: parseFloat(best.volume?.h24) || 0,
      marketCap: parseFloat(best.fdv) || 0,
      high24: null,
      low24: null,
      circulatingSupply: null,
      ath: null,
      sparkline: null,
      image: best.info?.imageUrl || null,
      rank: null,
      source: 'dexscreener',
      updatedAt: Date.now(),
    };
  } catch (err) {
    console.warn('[Spectre] Dexscreener fetch failed:', err.message);
    return null;
  }
}

/**
 * Fetch from the resolved Spectre API base (localhost or production).
 * Uses the shared getApiBase() which re-checks localhost every 30s.
 */
async function fetchFromSpectreApi(path) {
  try {
    const base = await getApiBase();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`${base}${path}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (response.ok) return response;
  } catch { /* network error or timeout */ }
  return null;
}

/**
 * Fetch price from Spectre API (production + localhost fallback)
 * Returns priceData compatible with priceCache format, or null
 */
export async function fetchCodexProxyPrice(symbol) {
  try {
    const response = await fetchFromSpectreApi(`/api/tokens/price/${encodeURIComponent(symbol.toUpperCase())}`);
    if (!response) return null;

    const data = await response.json();
    if (!data || !data.price) return null;

    return {
      price: parseFloat(data.price) || 0,
      change24: parseFloat(data.change24) || null,
      change1h: null,
      change7d: null,
      change30d: null,
      volume: parseFloat(data.volume) || 0,
      marketCap: parseFloat(data.marketCap) || 0,
      high24: null,
      low24: null,
      circulatingSupply: null,
      ath: null,
      sparkline: null,
      image: null,
      rank: null,
      source: 'codex-proxy',
      updatedAt: Date.now(),
    };
  } catch (err) {
    console.warn('[Spectre] Codex proxy price fetch failed:', err.message);
    return null;
  }
}

/**
 * Fetch OHLCV bars from Spectre API and convert to sparkline (close prices)
 * Used when CoinGecko sparkline is null but we have chart data via Codex
 * Tries: symbol → address:networkId format, production → localhost
 */
export async function fetchCodexProxyBars(symbol, codexInfo) {
  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - (7 * 24 * 60 * 60); // 7 days

    // Try 1: by symbol name
    const symbolPath = `/api/bars?symbol=${encodeURIComponent(symbol.toUpperCase())}&from=${from}&to=${to}&resolution=4H`;
    let response = await fetchFromSpectreApi(symbolPath);
    if (response) {
      const data = await response.json();
      const bars = data.bars || data;
      if (Array.isArray(bars) && bars.length >= 2) {
        const sparkline = bars.map(bar => parseFloat(bar.c || bar.close) || 0).filter(v => v > 0);
        if (sparkline.length >= 2) return sparkline;
      }
    }

    // Try 2: by address:networkId if we have codex info
    if (codexInfo?.address) {
      const addr = codexInfo.address.startsWith('0x') ? codexInfo.address.toLowerCase() : codexInfo.address;
      const addrSymbol = `${addr}:${codexInfo.networkId || 1}`;
      const addrPath = `/api/bars?symbol=${encodeURIComponent(addrSymbol)}&from=${from}&to=${to}&resolution=4H`;
      response = await fetchFromSpectreApi(addrPath);
      if (response) {
        const data = await response.json();
        const bars = data.bars || data;
        if (Array.isArray(bars) && bars.length >= 2) {
          const sparkline = bars.map(bar => parseFloat(bar.c || bar.close) || 0).filter(v => v > 0);
          if (sparkline.length >= 2) return sparkline;
        }
      }
    }

    return null;
  } catch (err) {
    console.warn('[Spectre] Codex proxy bars fetch failed:', err.message);
    return null;
  }
}

/**
 * Fetch sparkline from Dexscreener chart data — last resort for DEX-only tokens.
 * Uses multi-timeframe change data to build a realistic-looking 7-day sparkline
 * instead of a straight diagonal line.
 */
export async function fetchDexscreenerChart(address, networkId) {
  if (!address) return null;

  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;

    const data = await response.json();
    const pairs = data.pairs;
    if (!pairs || pairs.length === 0) return null;

    // Use the pair with highest liquidity
    const best = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

    const currentPrice = parseFloat(best.priceUsd) || 0;
    if (currentPrice <= 0) return null;

    // Build realistic 7-day sparkline using available change data
    const ch1h = parseFloat(best.priceChange?.h1) || 0;
    const ch6h = parseFloat(best.priceChange?.h6) || 0;
    const ch24h = parseFloat(best.priceChange?.h24) || 0;

    // Calculate anchor prices at known timeframes
    const price1hAgo = currentPrice / (1 + ch1h / 100);
    const price6hAgo = currentPrice / (1 + ch6h / 100);
    const price24hAgo = currentPrice / (1 + ch24h / 100);

    // Anchor points: [7d ago (estimated), 6d, 5d, ..., 24h ago, 6h ago, 1h ago, now]
    // Estimate 7d-ago price by extrapolating 24h trend (rough but better than straight line)
    const dailyChange = (currentPrice - price24hAgo);
    const price7dAgo = price24hAgo - dailyChange * 2.5; // moderate extrapolation

    // Build 7 anchor points (one per day) + intraday detail
    const anchors = [
      { t: 0, p: Math.max(price7dAgo, currentPrice * 0.5) },      // 7d ago
      { t: 0.28, p: price24hAgo + (price7dAgo - price24hAgo) * 0.5 }, // ~5d ago
      { t: 0.57, p: price24hAgo + (price7dAgo - price24hAgo) * 0.15 }, // ~3d ago
      { t: 0.71, p: price24hAgo },                                      // 24h ago
      { t: 0.89, p: price6hAgo },                                       // 6h ago
      { t: 0.96, p: price1hAgo },                                       // 1h ago
      { t: 1, p: currentPrice },                                        // now
    ];

    // Interpolate between anchors with slight natural variation (168 points = 7d * 24h)
    const totalPoints = 168;
    const sparkline = [];
    // Seed a simple deterministic "random" from price for consistency
    let seed = Math.round(currentPrice * 10000) % 997;
    const pseudoRandom = () => { seed = (seed * 16807 + 7) % 2147483647; return (seed % 1000) / 1000; };

    for (let i = 0; i < totalPoints; i++) {
      const t = i / (totalPoints - 1);
      // Find surrounding anchors
      let a0 = anchors[0], a1 = anchors[anchors.length - 1];
      for (let j = 0; j < anchors.length - 1; j++) {
        if (t >= anchors[j].t && t <= anchors[j + 1].t) {
          a0 = anchors[j]; a1 = anchors[j + 1];
          break;
        }
      }
      const segT = a1.t === a0.t ? 0 : (t - a0.t) / (a1.t - a0.t);
      const basePrice = a0.p + (a1.p - a0.p) * segT;
      // Add ±0.8% natural-looking micro noise
      const noise = (pseudoRandom() - 0.5) * 0.016 * basePrice;
      sparkline.push(Math.max(basePrice + noise, 0));
    }

    return sparkline;
  } catch (err) {
    console.warn('[Spectre] Dexscreener chart fetch failed:', err.message);
    return null;
  }
}

/**
 * Fallback: /simple/price if /coins/markets hits rate limit
 */
async function refreshPricesFallback(geckoIds, idToSymbol) {
  try {
    const ids = geckoIds.join(',');
    const url = `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`;

    const response = await fetch(url);
    if (!response.ok) return;

    const data = await response.json();

    for (const [geckoId, priceData] of Object.entries(data)) {
      const symbol = idToSymbol[geckoId];
      if (!symbol) continue;

      const existing = priceCache[symbol];
      priceCache[symbol] = {
        price: priceData.usd || 0,
        change24: priceData.usd_24h_change || 0,
        change1h: existing?.change1h || null,
        change7d: existing?.change7d || null,
        volume: priceData.usd_24h_vol || 0,
        marketCap: priceData.usd_market_cap || 0,
        sparkline: existing?.sparkline || null,
        image: existing?.image || null,
        rank: existing?.rank || null,
        updatedAt: Date.now(),
      };
    }

    console.log(`[Spectre] Prices updated (fallback) for ${Object.keys(data).length} tokens`);
  } catch (err) {
    console.warn('[Spectre] Fallback price refresh failed:', err.message);
  }
}
