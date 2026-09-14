/**
 * Spectre AI — Background Service Worker
 * Handles message passing, token resolution, price caching, and market state
 */

import { initRegistry, getRegistry } from './token-registry.js';
import { resolveCashtag, fetchTokenPrice, getApiBase, enrichWithCashtagSearch } from './token-resolver.js';
import { initPriceCache, getCachedPrice, getAllPrices, watchSymbols, fetchTokenDetail, getGeckoIdForSymbol, registerGeckoId, fetchDexscreenerPrice, fetchCodexProxyPrice, fetchCodexProxyBars, fetchDexscreenerChart } from './price-cache.js';
import { initMarketState, getMarketState } from './market-state.js';

// In-memory cache for converted data URLs (survives within service worker lifetime)
const imageDataUrlCache = new Map();
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

function numericOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function hasPositiveNumber(value) {
  const num = numericOrNull(value);
  return num !== null && num > 0;
}

function hasNumericValue(value) {
  return numericOrNull(value) !== null;
}

function hasSparklineData(values) {
  return Array.isArray(values) && values.length > 1;
}

function hasDisplayData(snapshot) {
  return hasPositiveNumber(snapshot?.price)
    && (hasPositiveNumber(snapshot?.marketCap) || hasPositiveNumber(snapshot?.volume))
    && (hasSparklineData(snapshot?.sparkline) || !!snapshot?.image);
}

function hasSupplementalMarketStats(snapshot) {
  return hasNumericValue(snapshot?.change24)
    && hasNumericValue(snapshot?.change1h)
    && hasNumericValue(snapshot?.change7d)
    && hasNumericValue(snapshot?.change30d)
    && hasPositiveNumber(snapshot?.high24)
    && hasPositiveNumber(snapshot?.low24)
    && hasPositiveNumber(snapshot?.ath);
}

function needsExtentionSimpleEnrichment(token, snapshot) {
  if (!token?.coingeckoId && !token?.codex?.address) return false;
  return !hasDisplayData(snapshot) || !hasSupplementalMarketStats(snapshot);
}

function normalizeExtentionSimpleData(data) {
  const sparkline = hasSparklineData(data?.sparkline)
    ? data.sparkline.map(point => Number(point)).filter(point => Number.isFinite(point))
    : null;

  return {
    name: data?.token_name || data?.ticker || null,
    image: data?.image || null,
    price: numericOrNull(data?.price),
    change1h: numericOrNull(data?.change_1h),
    change24: numericOrNull(data?.change_24h),
    change7d: numericOrNull(data?.change_7d),
    change30d: numericOrNull(data?.change_30d),
    marketCap: numericOrNull(data?.market_cap),
    volume: numericOrNull(data?.volume_24h),
    high24: numericOrNull(data?.high_24h),
    low24: numericOrNull(data?.low_24h),
    circulatingSupply: numericOrNull(data?.circulating_supply),
    ath: numericOrNull(data?.all_time_high),
    sparkline: hasSparklineData(sparkline) ? sparkline : null,
  };
}

function hasUsableExtentionSimpleData(data) {
  return !!data && !data.error && (
    hasPositiveNumber(data.price) ||
    hasNumericValue(data.change_1h) ||
    hasNumericValue(data.change_24h) ||
    hasNumericValue(data.change_7d) ||
    hasNumericValue(data.change_30d) ||
    hasPositiveNumber(data.market_cap) ||
    hasPositiveNumber(data.volume_24h) ||
    hasPositiveNumber(data.high_24h) ||
    hasPositiveNumber(data.low_24h) ||
    hasPositiveNumber(data.all_time_high) ||
    hasSparklineData(data.sparkline) ||
    !!data.image ||
    !!data.token_name
  );
}

async function fetchExtentionSimpleBy(identifierKey, identifierValue) {
  if (!identifierValue || identifierKey !== 'cg_id') return null;

  try {
    const url = `${COINGECKO_BASE}/coins/${encodeURIComponent(identifierValue)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=true`;
    const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!response.ok) return null;

    const cg = await response.json();
    const md = cg?.market_data || {};
    const adapted = {
      ticker: cg?.symbol ? String(cg.symbol).toUpperCase() : null,
      token_name: cg?.name || null,
      image: cg?.image?.large || cg?.image?.small || cg?.image?.thumb || null,
      price: md?.current_price?.usd ?? null,
      change_1h: md?.price_change_percentage_1h_in_currency?.usd ?? null,
      change_24h: md?.price_change_percentage_24h ?? null,
      change_7d: md?.price_change_percentage_7d ?? null,
      change_30d: md?.price_change_percentage_30d ?? null,
      market_cap: md?.market_cap?.usd ?? null,
      volume_24h: md?.total_volume?.usd ?? null,
      high_24h: md?.high_24h?.usd ?? null,
      low_24h: md?.low_24h?.usd ?? null,
      circulating_supply: md?.circulating_supply ?? null,
      all_time_high: md?.ath?.usd ?? null,
      sparkline: Array.isArray(md?.sparkline_7d?.price) ? md.sparkline_7d.price : null,
    };

    if (!hasUsableExtentionSimpleData(adapted)) return null;
    return normalizeExtentionSimpleData(adapted);
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn(`[Spectre] CG enrichment ${identifierKey} lookup failed:`, err.message);
    }
    return null;
  }
}

async function fetchExtentionSimpleData(token) {
  if (!token) return null;

  if (token.coingeckoId) {
    const fromGecko = await fetchExtentionSimpleBy('cg_id', token.coingeckoId);
    if (fromGecko) return fromGecko;
  }

  // codex_id case: no replacement needed — DexScreener and Codex proxy chains in
  // price-cache.js cover DEX tokens missing CG metadata.
  return null;
}

function mergeExtentionSimpleData(token, snapshot, extra) {
  if (!extra) return { token, snapshot };

  const nextToken = { ...(token || {}) };
  const nextSnapshot = { ...(snapshot || {}) };

  if ((!nextToken.name || nextToken.name === nextToken.symbol) && extra.name) {
    nextToken.name = extra.name;
  }
  if (!nextToken.image && extra.image) {
    nextToken.image = extra.image;
  }

  if (!hasPositiveNumber(nextSnapshot.price) && hasPositiveNumber(extra.price)) {
    nextSnapshot.price = extra.price;
  }
  if (nextSnapshot.change1h == null && extra.change1h != null) {
    nextSnapshot.change1h = extra.change1h;
  }
  if (nextSnapshot.change24 == null && extra.change24 != null) {
    nextSnapshot.change24 = extra.change24;
  }
  if (nextSnapshot.change7d == null && extra.change7d != null) {
    nextSnapshot.change7d = extra.change7d;
  }
  if (nextSnapshot.change30d == null && extra.change30d != null) {
    nextSnapshot.change30d = extra.change30d;
  }
  if (!hasPositiveNumber(nextSnapshot.marketCap) && hasPositiveNumber(extra.marketCap)) {
    nextSnapshot.marketCap = extra.marketCap;
  }
  if (!hasPositiveNumber(nextSnapshot.volume) && hasPositiveNumber(extra.volume)) {
    nextSnapshot.volume = extra.volume;
  }
  if (!hasPositiveNumber(nextSnapshot.high24) && hasPositiveNumber(extra.high24)) {
    nextSnapshot.high24 = extra.high24;
  }
  if (!hasPositiveNumber(nextSnapshot.low24) && hasPositiveNumber(extra.low24)) {
    nextSnapshot.low24 = extra.low24;
  }
  if (!hasPositiveNumber(nextSnapshot.circulatingSupply) && hasPositiveNumber(extra.circulatingSupply)) {
    nextSnapshot.circulatingSupply = extra.circulatingSupply;
  }
  if (!hasPositiveNumber(nextSnapshot.ath) && hasPositiveNumber(extra.ath)) {
    nextSnapshot.ath = extra.ath;
  }
  if (!hasSparklineData(nextSnapshot.sparkline) && hasSparklineData(extra.sparkline)) {
    nextSnapshot.sparkline = extra.sparkline;
  }
  if (!nextSnapshot.image && extra.image) {
    nextSnapshot.image = extra.image;
  }

  return { token: nextToken, snapshot: nextSnapshot };
}

/**
 * Fetch an image URL and convert to a data URL (base64).
 * Content scripts inject into pages with strict CSP (e.g. X.com) that block
 * external image domains. Data URLs bypass CSP entirely.
 * Returns null on failure so the fallback letter is used instead.
 */
async function imageToDataUrl(url) {
  if (!url || url.startsWith('data:')) return url;
  // Check in-memory cache first
  const cached = imageDataUrlCache.get(url);
  if (cached) return cached;
  try {
    console.log('[Spectre] imageToDataUrl fetching:', url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) {
      console.warn('[Spectre] imageToDataUrl HTTP error:', resp.status, url);
      return null;
    }
    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    // Process in chunks to avoid call stack issues with large images
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, chunk);
    }
    const base64 = btoa(binary);
    const contentType = resp.headers.get('content-type') || 'image/png';
    const dataUrl = `data:${contentType};base64,${base64}`;
    console.log('[Spectre] imageToDataUrl success:', url, `(${bytes.length} bytes)`);
    // Cache for future use
    imageDataUrlCache.set(url, dataUrl);
    return dataUrl;
  } catch (err) {
    console.error('[Spectre] imageToDataUrl FAILED:', url, err.message || err);
    return null;
  }
}

/**
 * Resolve the best image URL for a token symbol, converting to data URL.
 * Falls back through: provided URL → price cache → null
 */
async function resolveImage(url, symbol) {
  // Try provided URL first
  if (url) {
    const dataUrl = await imageToDataUrl(url);
    if (dataUrl) return dataUrl;
  }
  // Fallback: check price cache for this symbol
  if (symbol) {
    const cached = getCachedPrice(symbol);
    if (cached?.image && cached.image !== url) {
      const dataUrl = await imageToDataUrl(cached.image);
      if (dataUrl) return dataUrl;
    }
  }
  return null;
}

// Initialize on service worker start
async function init() {
  console.log('[Spectre] Service worker initializing...');
  await initRegistry();

  // Pass registry to price cache so it can map symbols → CoinGecko IDs
  const registry = getRegistry();
  initPriceCache(registry);

  initMarketState();

  // Pre-resolve API base so first hover doesn't pay the health-check penalty
  getApiBase().then(base => console.log(`[Spectre] API base resolved: ${base}`));

  console.log('[Spectre] Service worker ready');
}

init();

const DEFAULT_WATCHLIST = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX'];

// Keep service worker alive with periodic alarm
chrome.alarms.create('spectre-keepalive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'spectre-keepalive') {
    // Service worker stays alive
  }
});

/**
 * Handle messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = messageHandlers[message.type];
  if (handler) {
    handler(message, sender)
      .then(result => {
        try { sendResponse(result); } catch { /* port closed */ }
      })
      .catch(err => {
        console.error(`[Spectre] Handler error (${message.type}):`, err);
        try { sendResponse({ error: err.message }); } catch { /* port closed */ }
      });
    return true; // Keep channel open for async response
  }
  return false;
});

const messageHandlers = {
  /**
   * Resolve a cashtag to full token data + price + market context
   * Stocks: resolved via /api/ext/resolve (Yahoo Finance + Google favicon logos)
   * Crypto: CoinGecko → Codex → Dexscreener fallback chain
   */
  async RESOLVE_CASHTAG({ ticker }) {
    const upper = (ticker || '').toUpperCase();

    // ══════════════════════════════════════════════════════════════
    // STEP 1: Ask server /api/ext/resolve — handles stocks AND known crypto
    // Server checks POPULAR_STOCK_SYMBOLS first, then TOKEN_REGISTRY
    // ══════════════════════════════════════════════════════════════
    try {
      const apiBase = await getApiBase();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const resp = await fetch(`${apiBase}/api/ext/resolve?ticker=${encodeURIComponent(upper)}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const data = await resp.json();

        // ── STOCK: fully resolved by server ──
        if (data.resolved && data.assetType === 'stock' && data.price) {
          console.log(`[Spectre] ${upper} resolved as STOCK via /api/ext/resolve`);
          const market = getMarketState();

          // Fetch sparkline in background (non-blocking for faster popup)
          let sparkline = null;
          try {
            const sparkResp = await fetch(`${apiBase}/api/ext/sparkline?symbol=${encodeURIComponent(upper)}&points=40`, {
              signal: AbortSignal.timeout(4000),
            });
            if (sparkResp.ok) {
              const sparkData = await sparkResp.json();
              if (sparkData.points?.length > 2) {
                sparkline = sparkData.points.map(p => p.c);
              }
            }
          } catch {}

          return {
            token: {
              symbol: data.stock.symbol,
              name: data.stock.name,
              sector: data.stock.sector,
              exchange: data.stock.exchange,
              tier: 1,
            },
            assetType: 'stock',
            price: data.price.price,
            change24: data.price.change24,  // Already a proper percentage from Yahoo
            change1h: null, change7d: null, change30d: null,
            marketCap: data.price.marketCap || null,
            volume: data.price.volume || null,
            high24: null, low24: null,
            pe: data.price.pe || null,
            forwardPe: data.price.forwardPe || null,
            eps: data.price.eps || null,
            avgVolume: data.price.avgVolume || null,
            beta: data.price.beta || null,
            week52High: data.price.week52High || null,
            week52Low: data.price.week52Low || null,
            circulatingSupply: null, ath: null,
            sparkline,
            image: data.stock.logo || null,
            rank: null,
            fearGreed: market.fearGreed, aiPulse: market.aiPulse,
            btcDominance: market.btcDominance, ethDominance: market.ethDominance,
            marketStatus: data.market || null,
          };
        }

        // ── CRYPTO: resolved by server from TOKEN_REGISTRY + Binance/CoinGecko ──
        if (data.resolved && data.assetType === 'crypto' && data.price?.price) {
          console.log(`[Spectre] ${upper} resolved as CRYPTO via /api/ext/resolve (server-side)`);
          const market = getMarketState();
          let resolvedToken = {
            symbol: data.token.symbol,
            name: data.token.name,
            coingeckoId: data.token.coingeckoId || null,
            codex: data.token.address ? { address: data.token.address, networkId: data.token.networkId } : null,
            tier: 1,
          };
          if (!resolvedToken.coingeckoId) {
            resolvedToken = await enrichWithCashtagSearch(upper, resolvedToken);
          }
          if (resolvedToken?.coingeckoId) {
            registerGeckoId(upper, resolvedToken.coingeckoId);
          }

          // Fetch sparkline from server (Binance klines or Codex)
          let sparkline = null;
          try {
            const sparkResp = await fetch(`${apiBase}/api/ext/sparkline?symbol=${encodeURIComponent(upper)}&points=40`, {
              signal: AbortSignal.timeout(4000),
            });
            if (sparkResp.ok) {
              const sparkData = await sparkResp.json();
              if (sparkData.points?.length > 2) {
                sparkline = sparkData.points.map(p => p.c);
              }
            }
          } catch {}

          // Enrich with price cache + own CoinGecko when server data is incomplete
          let pc = getCachedPrice(upper);
          if (!data.logo || !data.price.marketCap || (!data.token.coingeckoId && resolvedToken?.coingeckoId)) {
            const fresh = await fetchTokenPrice(upper);
            if (fresh) { pc = fresh; watchSymbols([upper]); }
          }
          let displayData = {
            price: data.price.price,
            change24: data.price.change24 ?? null,
            change1h: pc?.change1h || null,
            change7d: pc?.change7d || null,
            change30d: pc?.change30d || null,
            marketCap: data.price.marketCap || pc?.marketCap || null,
            volume: data.price.volume || pc?.volume || null,
            high24: pc?.high24 || null,
            low24: pc?.low24 || null,
            circulatingSupply: pc?.circulatingSupply || null,
            ath: pc?.ath || null,
            sparkline: sparkline || pc?.sparkline || null,
            image: data.logo || pc?.image || resolvedToken?.image || null,
            rank: pc?.rank || null,
          };
          if (needsExtentionSimpleEnrichment(resolvedToken, displayData)) {
            const extentionSimple = await fetchExtentionSimpleData(resolvedToken);
            ({ token: resolvedToken, snapshot: displayData } = mergeExtentionSimpleData(resolvedToken, displayData, extentionSimple));
          }
          return {
            token: resolvedToken,
            assetType: 'crypto',
            price: displayData.price,
            change24: displayData.change24,
            change1h: displayData.change1h || null, change7d: displayData.change7d || null, change30d: displayData.change30d || null,
            marketCap: displayData.marketCap || null,
            volume: displayData.volume || null,
            high24: displayData.high24 || null, low24: displayData.low24 || null,
            circulatingSupply: displayData.circulatingSupply || null, ath: displayData.ath || null,
            sparkline: displayData.sparkline || null,
            image: displayData.image || null,
            rank: displayData.rank || null,
            fearGreed: market.fearGreed, aiPulse: market.aiPulse,
            btcDominance: market.btcDominance, ethDominance: market.ethDominance,
          };
        }
      }
    } catch (err) {
      // Server resolve failed — fall through to extension's own crypto pipeline
      if (err.name !== 'AbortError') {
        console.warn(`[Spectre] Server resolve failed for ${upper}:`, err.message);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // CRYPTO PIPELINE — original flow
    // ══════════════════════════════════════════════════════════════

    // Cache fast-path: if we have fresh data (< 60s), return instantly
    const cached = getCachedPrice(upper);
    if (cached && cached.updatedAt && (Date.now() - cached.updatedAt < 60000) && hasDisplayData(cached) && hasSupplementalMarketStats(cached)) {
      const market = getMarketState();
      return {
        token: { symbol: upper, name: cached.name || upper },
        price: cached.price, change24: cached.change24 ?? null,
        change1h: cached.change1h || null, change7d: cached.change7d || null,
        change30d: cached.change30d || null, marketCap: cached.marketCap || null,
        volume: cached.volume || null, high24: cached.high24 || null,
        low24: cached.low24 || null, circulatingSupply: cached.circulatingSupply || null,
        ath: cached.ath || null, sparkline: cached.sparkline || null,
        image: cached.image || null, rank: cached.rank || null,
        fearGreed: market.fearGreed, aiPulse: market.aiPulse,
        btcDominance: market.btcDominance, ethDominance: market.ethDominance,
      };
    }

    let token = await resolveCashtag(ticker);
    if (!token) {
      return { error: 'Token not found', ticker };
    }

    // Ensure geckoId is registered before fetching price — critical for Tier 2 results
    if (token.coingeckoId) {
      registerGeckoId(token.symbol, token.coingeckoId);
    }

    // === PRICE RESOLUTION — multi-tier fallback ===
    let priceData = getCachedPrice(token.symbol);

    // If cached data has no sparkline but token has a geckoId, force re-fetch
    if (priceData && !priceData.sparkline && (token.coingeckoId || getGeckoIdForSymbol(token.symbol))) {
      const fresh = await fetchTokenPrice(token.symbol);
      if (fresh) priceData = fresh;
    }

    // Tier A: CoinGecko markets (has sparkline, high/low, supply, ATH)
    if (!priceData) {
      priceData = await fetchTokenPrice(token.symbol);
    }

    // Tier B: Dexscreener (for DEX tokens — price, change, volume, mcap)
    if (!priceData && token.codex?.address) {
      priceData = await fetchDexscreenerPrice(token.codex.address, token.codex.networkId);
    }

    // Tier C: Codex proxy price endpoint
    if (!priceData) {
      priceData = await fetchCodexProxyPrice(token.symbol);
    }

    // Tier D: Use codexPriceData from the resolver itself (Codex search / Dexscreener search)
    // This covers low-mcap tokens not on CoinGecko that Codex search already returned data for
    if (!priceData && token.codexPriceData && token.codexPriceData.price > 0) {
      priceData = {
        price: token.codexPriceData.price,
        change24: token.codexPriceData.change24 || 0,
        change1h: null,
        change7d: null,
        change30d: null,
        volume: token.codexPriceData.volume || 0,
        marketCap: token.codexPriceData.marketCap || 0,
        high24: null,
        low24: null,
        circulatingSupply: null,
        ath: null,
        sparkline: null,
        image: token.image || null,
        rank: null,
        source: 'codex-search',
        updatedAt: Date.now(),
      };
    }

    // Tier E: Dexscreener search by symbol — doesn't need a contract address
    // ONLY for tokens without a coingeckoId — prevents data mixing (e.g. ZETA the DEX token vs ZetaChain)
    if (!priceData && !token.coingeckoId) {
      try {
        const dexResp = await fetch(
          `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(token.symbol)}`,
          { signal: AbortSignal.timeout(3000) }
        );
        if (dexResp.ok) {
          const dexData = await dexResp.json();
          const pairs = dexData.pairs || [];
          const exactMatches = pairs.filter(p => p.baseToken?.symbol?.toUpperCase() === token.symbol);
          const best = exactMatches.length > 0
            ? exactMatches.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0]
            : pairs[0];
          if (best && parseFloat(best.priceUsd) > 0) {
            // Also backfill token.codex so sparkline resolution can use the address
            if (!token.codex && best.baseToken?.address) {
              const chainToNet = { ethereum: 1, bsc: 56, polygon: 137, avalanche: 43114, arbitrum: 42161, optimism: 10, base: 8453, solana: 1399811149 };
              token.codex = { address: best.baseToken.address, networkId: chainToNet[best.chainId] || 1 };
            }
            priceData = {
              price: parseFloat(best.priceUsd) || 0,
              change24: parseFloat(best.priceChange?.h24) || 0,
              change1h: parseFloat(best.priceChange?.h1) || null,
              change7d: null, change30d: null,
              volume: parseFloat(best.volume?.h24) || 0,
              marketCap: parseFloat(best.fdv) || 0,
              high24: null, low24: null,
              circulatingSupply: null, ath: null,
              sparkline: null,
              image: best.info?.imageUrl || token.image || null,
              rank: null,
              source: 'dexscreener-search',
              updatedAt: Date.now(),
            };
          }
        }
      } catch { /* Dexscreener search failed — continue without price */ }
    }

    // === SPARKLINE / CHART RESOLUTION — fetch in parallel for speed ===
    if (priceData && !priceData.sparkline) {
      const [bars, dexChart] = await Promise.all([
        fetchCodexProxyBars(token.symbol, token.codex).catch(() => null),
        token.codex?.address
          ? fetchDexscreenerChart(token.codex.address, token.codex.networkId).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (bars && bars.length > 2) {
        priceData.sparkline = bars;
      } else if (dexChart && dexChart.length > 2) {
        priceData.sparkline = dexChart;
      }
    }

    // === IMAGE RESOLUTION — use token.image from Codex/Dexscreener if priceData has none ===
    if (priceData && !priceData.image && token.image) {
      priceData.image = token.image;
    }

    if (needsExtentionSimpleEnrichment(token, priceData)) {
      const extentionSimple = await fetchExtentionSimpleData(token);
      ({ token, snapshot: priceData } = mergeExtentionSimpleData(token, priceData, extentionSimple));
    }

    // Watch for future updates (only if we have a geckoId)
    if (token.coingeckoId || getGeckoIdForSymbol(token.symbol)) {
      watchSymbols([token.symbol]);
    }

    // Get current market state
    const market = getMarketState();
    return {
      token: {
        symbol: token.symbol,
        name: token.name,
        coingeckoId: token.coingeckoId || null,
        codex: token.codex || null,
        category: token.category,
        tier: token.tier,
      },
      assetType: 'crypto',
      price: priceData?.price || null,
      change24: priceData?.change24 ?? null,
      change1h: priceData?.change1h || null,
      change7d: priceData?.change7d || null,
      change30d: priceData?.change30d || null,
      marketCap: priceData?.marketCap || null,
      volume: priceData?.volume || null,
      high24: priceData?.high24 || null,
      low24: priceData?.low24 || null,
      circulatingSupply: priceData?.circulatingSupply || null,
      ath: priceData?.ath || null,
      sparkline: priceData?.sparkline || null,
      image: priceData?.image || token.image || null,
      rank: priceData?.rank || null,
      fearGreed: market.fearGreed,
      aiPulse: market.aiPulse,
      btcDominance: market.btcDominance,
      ethDominance: market.ethDominance,
    };
  },

  /**
   * Get current market state (for sidebar/popup)
   * If data is stale or empty (service worker just woke up), wait for initial fetch
   */
  async GET_MARKET_STATE() {
    let market = getMarketState();
    let prices = getAllPrices();

    // If prices are empty, the service worker likely just woke up and init() fetches
    // are still in flight — wait up to 5s for data to arrive
    if (Object.keys(prices).length === 0) {
      console.log('[Spectre] GET_MARKET_STATE: prices empty, waiting for initial fetch...');
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        prices = getAllPrices();
        if (Object.keys(prices).length > 0) break;
      }
      market = getMarketState();
    }

    return { market, prices };
  },

  /**
   * Get cached price for a symbol
   */
  async GET_PRICE({ symbol }) {
    const price = getCachedPrice(symbol);
    if (!price) {
      const fresh = await fetchTokenPrice(symbol);
      return fresh || { error: 'Price not available' };
    }
    return price;
  },

  /**
   * Add symbols to price watchlist
   */
  async WATCH_SYMBOLS({ symbols }) {
    watchSymbols(symbols);
    return { ok: true };
  },

  /**
   * Open a URL in a new tab (for content scripts where window.open may be blocked)
   */
  async OPEN_TAB({ url }) {
    if (url) {
      await chrome.tabs.create({ url });
    }
    return { ok: true };
  },

  /**
   * Fetch an image and return it as a data URL (base64).
   * Used by content scripts to bypass page CSP restrictions on img-src.
   */
  async FETCH_IMAGE({ url }) {
    if (!url) return { dataUrl: null };
    const result = await imageToDataUrl(url);
    return { dataUrl: result };
  },

  /**
   * Get user settings
   */
  async GET_SETTINGS() {
    const result = await chrome.storage.local.get('spectre_settings');
    return result.spectre_settings || {
      popupEnabled: true,
      badgesEnabled: true,
      sidebarEnabled: false,
      sidebarPosition: 'right',
    };
  },

  /**
   * Save user settings
   */
  async SAVE_SETTINGS({ settings }) {
    await chrome.storage.local.set({ spectre_settings: settings });
    return { ok: true };
  },

  /**
   * Fetch X activity & status score for a token (used by DexScreener injection)
   * Calls /api/ext/x-activity which searches X + DexScreener for activity signals
   */
  async FETCH_X_ACTIVITY({ ticker, chain, address }) {
    const upper = (ticker || '').toUpperCase();
    try {
      const apiBase = await getApiBase();
      // Build URL with optional chain + address for precise DexScreener pair lookup
      let url = `${apiBase}/api/ext/x-activity?ticker=${encodeURIComponent(upper)}`;
      if (chain) url += `&chain=${encodeURIComponent(chain)}`;
      if (address) url += `&address=${encodeURIComponent(address)}`;

      const resp = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        return await resp.json();
      }
    } catch (err) {
      console.warn(`[Spectre] X activity fetch failed for ${upper}:`, err.message);
    }
    return { ticker: upper, status: 'ghost', tweets24h: 0, tweets7d: 0, engagement: 0, devActive: false, source: 'fallback' };
  },

  /**
   * Get detailed token info (socials, description) — cached 30 min
   */
  async GET_TOKEN_DETAIL({ symbol }) {
    const detail = await fetchTokenDetail(symbol);
    return detail || { error: 'Detail not available' };
  },

  /**
   * Batch resolve cashtags for tweet enrichment badges.
   * Cache-first: most watched tokens return instantly from 60s price cache.
   */
  async BATCH_RESOLVE_CASHTAGS({ tickers }) {
    const results = {};
    for (const ticker of tickers) {
      let price = getCachedPrice(ticker.toUpperCase());
      if (!price) {
        try {
          const token = await resolveCashtag(ticker);
          if (token) {
            price = await fetchTokenPrice(token.symbol);
            if (price) watchSymbols([token.symbol]);
          }
        } catch { /* skip failed resolutions — badge stays neutral */ }
      }
      if (price) results[ticker] = price;
    }
    const market = getMarketState();
    return {
      results,
      marketState: {
        aiPulse: market.aiPulse,
        fearGreed: market.fearGreed,
      },
    };
  },

  /**
   * Search tokens via CoinGecko search API
   */
  async GET_TRENDING() {
    try {
      const url = 'https://api.coingecko.com/api/v3/search/trending';
      const response = await fetch(url);
      if (!response.ok) return { coins: [] };
      const data = await response.json();
      const coins = (data.coins || []).slice(0, 10).map(item => {
        const coin = item.item || item;
        return {
          id: coin.id,
          symbol: coin.symbol?.toUpperCase(),
          name: coin.name,
          image: coin.large || coin.thumb || coin.small,
          rank: coin.market_cap_rank || null,
          price: coin.data?.price || null,
          change24: coin.data?.price_change_percentage_24h?.usd || null,
        };
      });
      return { coins };
    } catch (err) {
      console.warn('[Spectre] Trending fetch failed:', err.message);
      return { coins: [] };
    }
  },

  async SEARCH_TOKENS({ query }) {
    if (!query || query.trim().length < 1) return { results: [] };
    try {
      const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query.trim())}`;
      const response = await fetch(url);
      if (!response.ok) return { results: [], error: 'Search failed' };
      const data = await response.json();
      const coins = (data.coins || []).slice(0, 12).map(coin => ({
        id: coin.id,
        symbol: coin.symbol?.toUpperCase(),
        name: coin.name,
        image: coin.large || coin.thumb,
        rank: coin.market_cap_rank || null,
        price: null,
        change24: null,
      }));

      // Register geckoIds for results so we can fetch prices later
      for (const coin of coins) {
        if (coin.id && coin.symbol) {
          registerGeckoId(coin.symbol, coin.id);
        }
      }

      // Batch-fetch prices for search results via /coins/markets
      try {
        const geckoIds = coins.filter(c => c.id).map(c => c.id).join(',');
        if (geckoIds) {
          const priceUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(geckoIds)}&sparkline=false&price_change_percentage=24h&per_page=12&page=1`;
          const priceResp = await fetch(priceUrl);
          if (priceResp.ok) {
            const priceData = await priceResp.json();
            const priceMap = {};
            for (const p of priceData) {
              priceMap[p.id] = { price: p.current_price, change24: p.price_change_percentage_24h };
            }
            for (const coin of coins) {
              if (priceMap[coin.id]) {
                coin.price = priceMap[coin.id].price;
                coin.change24 = priceMap[coin.id].change24;
              }
            }
          }
        }
      } catch (priceErr) {
        console.warn('[Spectre] Search price fetch failed:', priceErr.message);
        // Non-fatal — search results still return without prices
      }

      return { results: coins };
    } catch (err) {
      console.warn('[Spectre] Search failed:', err.message);
      return { results: [], error: err.message };
    }
  },

  /**
   * Get the user's watchlist from chrome.storage
   */
  async GET_WATCHLIST() {
    try {
      const result = await chrome.storage.local.get('spectre_watchlist');
      return { watchlist: result.spectre_watchlist || [] };
    } catch { return { watchlist: [] }; }
  },

  /**
   * Add or remove a token from the watchlist
   */
  async UPDATE_WATCHLIST({ action, token }) {
    try {
      const result = await chrome.storage.local.get('spectre_watchlist');
      let watchlist = result.spectre_watchlist || [];
      if (action === 'add' && token) {
        const exists = watchlist.some(t => (t.symbol || t) === token.symbol);
        if (!exists) watchlist.push(token);
        // Start tracking price for this token
        watchSymbols([token.symbol]);
      } else if (action === 'remove' && token) {
        watchlist = watchlist.filter(t => (t.symbol || t) !== token.symbol);
      }
      await chrome.storage.local.set({ spectre_watchlist: watchlist });
      return { success: true, watchlist };
    } catch (err) {
      return { error: err.message };
    }
  },
};

/**
 * Broadcast market state updates to all X tabs
 */
async function broadcastMarketUpdate() {
  const market = getMarketState();
  const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
  for (const tab of tabs) {
    // Must .catch() the promise — sendMessage rejects if content script isn't loaded
    chrome.tabs.sendMessage(tab.id, {
      type: 'MARKET_STATE_UPDATE',
      data: market,
    }).catch(() => {
      // Tab may not have content script loaded yet — safe to ignore
    });
  }
}

// Broadcast market updates every 5 minutes
setInterval(broadcastMarketUpdate, 5 * 60 * 1000);
