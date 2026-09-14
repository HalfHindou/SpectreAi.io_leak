/**
 * Codex API Service
 * Real-time blockchain data via local server or Vercel serverless function
 */

import { isDev } from '@/utils/env';
import { consumeEarlyFetch } from '@/lib/early-fetch';
import { getAppResearchTokenMarketProfile } from '@/services/appResearchApi'
import {
  getSpectreMarketTrending,
  getSpectreTopMarketsPage,
  getSpectrePricesBySymbols,
  getSpectreSearch,
  getSpectreTokenProfile,
} from '@/services/spectreMarketApi';

// Use relative /api so Vite proxy (dev) or same-origin (prod) hits the backend. Start server for search/prices/trending.
const API_BASE = '/api';
const VERCEL_API_URL = '/api/codex';

// In-flight request deduplication — prevents duplicate concurrent requests for same data
const inflightRequests = new Map()

function deduplicatedFetch(cacheKey, fetchFn) {
  const existing = inflightRequests.get(cacheKey)
  if (existing) return existing

  const promise = fetchFn().finally(() => {
    inflightRequests.delete(cacheKey)
  })
  inflightRequests.set(cacheKey, promise)
  return promise
}

/**
 * Make request to API (relative /api → Vite proxy in dev → Express server)
 */
async function apiRequest(action, params = {}) {
  try {
    let url;

    // Bars MUST hit /api/bars in both dev AND prod — that handler runs the
    // L4 cascade (Binance → Hetzner candles_1m → GeckoTerminal → Codex) with
    // KV bucket caching. Routing through /api/codex?action=bars goes straight
    // to Codex's getTokenBars with zero fallback or cache, which on Jun 3
    // accounted for ~55% of the daily bill (205K getBars by 11:40 UTC). The
    // research /token iframe and research-zone chart both go through this
    // service; misrouting was the dominant bleed even after PR #735.
    if (action === 'bars') {
      const qs = new URLSearchParams({
        symbol: params.symbol || '',
        from: String(params.from || ''),
        to: String(params.to || ''),
        resolution: params.resolution || '60',
        networkId: String(params.networkId || 1),
      });
      if (params.cgId) qs.set('cgId', params.cgId);
      if (params.binancePair) qs.set('binancePair', params.binancePair);
      url = `${API_BASE}/bars?${qs.toString()}`;
    } else if (!isDev) {
      // Production (Vercel): route remaining actions through /api/codex?action=...
      const searchParams = new URLSearchParams({ action, ...params });
      url = `${VERCEL_API_URL}?${searchParams}`;
    } else if (action === 'search') {
      // Dev: use Express-style REST routes (proxied to localhost:3001)
      url = `${API_BASE}/tokens/search?q=${encodeURIComponent(params.q || '')}`;
      if (params.networks) url += `&networks=${params.networks}`;
    } else if (action === 'details') {
      url = `${API_BASE}/token/details?address=${encodeURIComponent(params.address || '')}&networkId=${params.networkId || 1}`;
    } else if (action === 'trending') {
      const qs = new URLSearchParams();
      if (params.networks) qs.set('networks', params.networks);
      if (params.limit) qs.set('limit', params.limit);
      const q = qs.toString();
      url = `${API_BASE}/tokens/trending${q ? `?${q}` : ''}`;
    } else if (action === 'prices') {
      const sym = params.symbols || '';
      if (sym.includes(',')) {
        url = `${API_BASE}/tokens/prices?symbols=${encodeURIComponent(sym)}`;
      } else {
        url = `${API_BASE}/tokens/price/${encodeURIComponent(sym)}`;
      }
    // NOTE: there is no `action === 'bars'` branch here any more. One used to
    // sit at this spot, but the guard at the top of the chain already claims
    // every bars request (it must - see the billing comment there), so this
    // branch had been unreachable ever since and only made it look like bars
    // had two routing paths.
    } else if (action === 'trades') {
      url = `${API_BASE}/token/trades?address=${encodeURIComponent(params.address || '')}&networkId=${params.networkId || 1}&limit=${params.limit || 50}`;
    } else {
      url = `${API_BASE}/health`;
    }
    
    const response = await fetch(url, {
      // credentials: 'include' — /api/bars (and codex price/trades) are gated by
      // the HttpOnly spectre-gate cookie. The iOS standalone PWA drops that cookie
      // on same-origin fetches that omit credentials -> 401 -> empty chart/technicals.
      credentials: 'include',
      // A bars request that never settles wedges the chart's history pager: the
      // pending promise stays in inflightOlderRef, so every later scroll-back
      // awaits a dead promise and no request is ever sent again (measured on
      // prod: hasMoreHistory true, loadingMore false, zero requests, chart
      // frozen at an arbitrary date). Bound it - the /api/bars cascade is slow
      // but never 25s slow.
      // Non-bars actions get a bound too: `details` sits inside the RZ hook's
      // Promise.allSettled, and undefined here meant one hung hop froze
      // loading.about/onchain — and the panes gated on them — forever.
      signal: AbortSignal.timeout(action === 'bars' ? 25000 : 15000),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    if (!isDev) console.error('API request failed:', error);
    throw error;
  }
}

function normalizeCodexPercent(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.abs(n) <= 1 && n !== 0 ? n * 100 : n
}

function mapSpectreCoinToCodexResult(row = {}, index = 0) {
  const symbol = String(row.asset || row.symbol || '').replace(/^\$/, '').toUpperCase()
  if (!symbol) return null
  const image = row.logo_url || row.logo || row.image || row.imageThumbUrl || null
  // Source rows can come in two shapes:
  //  - Spectre raw: { price, change_24h, change_5m, volume_24h, market_cap, ... }
  //    where change_* MAY be a decimal fraction (e.g. -0.0216 for -2.16%).
  //  - CoinGecko-shape (toCoinMarketRow): { current_price, price_change_percentage_24h,
  //    price_change_percentage_1h_in_currency, total_volume, market_cap, sparkline_in_7d, ... }
  //    where price_change_percentage_* is ALREADY in percent units (e.g. -2.16 for -2.16%).
  // Use normalizeCodexPercent only for raw fields; pass percent-named fields through directly.
  const asNumber = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
  const cgChange24 = row.price_change_percentage_24h
  const cgChange1h = row.price_change_percentage_1h_in_currency
  const change24 = cgChange24 != null
    ? asNumber(cgChange24)
    : normalizeCodexPercent(row.change_24h ?? row.change24h ?? row.change24 ?? row.change)
  const change1 = cgChange1h != null
    ? asNumber(cgChange1h)
    : normalizeCodexPercent(row.change_1h ?? row.change1h)
  const sparkline = Array.isArray(row.sparkline_in_7d?.price) ? row.sparkline_in_7d.price : null
  return {
    token: {
      symbol,
      name: row.name || symbol,
      address: row.contract || row.address || '',
      networkId: row.networkId || row.network_id || 1,
      info: { imageThumbUrl: image, imageSmallUrl: image, imageLargeUrl: image },
    },
    priceUSD: row.price ?? row.price_usd ?? row.current_price ?? 0,
    change24,
    change5m: normalizeCodexPercent(row.change_5m ?? row.change5m),
    change1,
    change4: normalizeCodexPercent(row.change_4h ?? row.change4h),
    change12: normalizeCodexPercent(row.change_12h ?? row.change12h),
    volume: row.volume_24h ?? row.volume24h ?? row.volume ?? row.total_volume ?? 0,
    volume24: row.volume_24h ?? row.volume24h ?? row.volume ?? row.total_volume ?? 0,
    marketCap: row.market_cap ?? row.marketCap ?? 0,
    liquidity: row.liquidity ?? row.volume_24h ?? row.volume24h ?? row.total_volume ?? 0,
    sparkline_7d: sparkline,
    rank: row.rank ?? row.market_cap_rank ?? index + 1,
    _source: 'spectre-market',
  }
}

/**
 * Get token details by address
 */
export async function getTokenInfo(address, networkId = 1) {
  try {
    const result = await apiRequest('details', { address, networkId: String(networkId) });
    return { token: result };
  } catch (err) {
    console.error('Failed to get token info:', err);
    return null;
  }
}

/**
 * Get token price by exact symbol (for known/curated tokens).
 * Uses Codex API with CoinGecko fallback (handled by server/Vercel).
 */
export async function getTokenPriceBySymbol(symbol) {
  const dedupKey = `price-${(symbol || '').toUpperCase()}`
  return deduplicatedFetch(dedupKey, async () => {
    const spectre = await getSpectrePricesBySymbols([symbol]).catch(() => ({}))
    const row = spectre?.[(symbol || '').toUpperCase()]
    if (row?.price != null) {
      return {
        price: row.price || 0,
        change: row.change24 ?? row.change ?? 0,
        change24: row.change24 ?? row.change ?? 0,
        volume: row.volume || 0,
        marketCap: row.marketCap || 0,
      }
    }
    try {
      const result = await apiRequest('prices', { symbols: symbol });
      // Local server: single-symbol returns { price, change, ... } directly
      if (result.price !== undefined) {
        return {
          price: result.price || 0,
          change: result.change || 0,
          change24: result.change || 0,
          volume: result.volume || 0,
          marketCap: result.marketCap || 0,
        };
      }
      // Local batch or Vercel: keyed by symbol
      const key = (symbol || '').toUpperCase();
      const row = result[key] || result[symbol];
      const change = row?.change ?? row?.change24 ?? 0;
      return {
        price: row?.price ?? 0,
        change,
        change24: change,
        volume: row?.volume ?? 0,
        marketCap: row?.marketCap ?? 0,
      };
    } catch (err) {
      if (!isDev) console.error(`Failed to get price for ${symbol}:`, err);
      return { price: 0, change24: 0 };
    }
  })
}

// Binance pair name for symbols that don't match SYMBOLUSDT (e.g. PEPE -> 1000PEPEUSDT)
const BINANCE_SYMBOL_TO_PAIR = {
  PEPE: '1000PEPEUSDT',
  FLOKI: '1000FLOKIUSDT',
  BONK: 'BONKUSDT',
  WIF: 'WIFUSDT',
  SHIB: '1000SHIBUSDT',
};

/**
 * Get prices from Binance public API (no key, no rate limit for normal use).
 * Uses 24hr ticker – one request for all USDT pairs, then filter by symbols.
 * @param {string[]} symbols - e.g. ['BTC', 'ETH', 'SOL']
 * @returns {Promise<Record<string, { price: number, change: number, volume?: number, marketCap?: number }>>}
 */
export async function getTokenPricesFromBinance(symbols) {
  if (!symbols || symbols.length === 0) return {};
  const list = [...new Set((Array.isArray(symbols) ? symbols : [symbols]).map((s) => (s || '').toUpperCase().trim()).filter(Boolean))];
  if (list.length === 0) return {};
  try {
    const rows = await getSpectrePricesBySymbols(list);
    if (rows && Object.keys(rows).length > 0) {
      return Object.fromEntries(Object.entries(rows).map(([sym, row]) => [sym, {
        price: row.price,
        change: row.change24h ?? row.change,
        change24: row.change24h ?? row.change,
        volume: row.volume,
        marketCap: row.marketCap,
        liquidity: row.liquidity,
      }]));
    }
  } catch (_) {
    // Fall back to Binance below.
  }
  const symbolSet = new Set(list);
  const pairToSymbol = {};
  list.forEach((sym) => {
    const pair = BINANCE_SYMBOL_TO_PAIR[sym] || `${sym}USDT`;
    pairToSymbol[pair] = sym;
  });
  try {
    // 2026-05-28 hide-apis-phase1: was direct https://api.binance.com/api/v3/ticker/24hr.
    // /api/binance-ticker is the same-origin proxy that returns the IDENTICAL
    // Binance 24h ticker shape (plus a CoinGecko fallback). Pulls `api.binance.com`
    // out of the public CSP connect-src and the user's Network tab.
    const res = await fetch('/api/binance-ticker');
    if (!res.ok) throw new Error(`Binance ${res.status}`);
    const tickers = await res.json();
    const out = {};
    for (const t of tickers || []) {
      const pair = (t.symbol || '').toUpperCase();
      if (!pair.endsWith('USDT')) continue;
      const sym = pairToSymbol[pair] ?? (symbolSet.has(pair.slice(0, -4)) ? pair.slice(0, -4) : null);
      if (!sym) continue;
      const price = parseFloat(t.lastPrice) || 0;
      const change = parseFloat(t.priceChangePercent) || 0;
      const volume = parseFloat(t.volume) || 0;
      out[sym] = { price, change, change24: change, volume, marketCap: 0, liquidity: 0 };
    }
    return out;
  } catch (err) {
    return {};
  }
}

/**
 * Get prices for multiple symbols in one request (Codex + CoinGecko fallback).
 * @param {string[]} symbols - e.g. ['BTC', 'ETH', 'SOL']
 * @returns {Promise<Record<string, { price: number, change: number, volume?: number, marketCap?: number }>>}
 */
export async function getTokenPricesBatch(symbols) {
  if (!symbols || symbols.length === 0) {
    return {};
  }
  const symbolList = Array.isArray(symbols) ? symbols : String(symbols).split(',')
  const spectre = await getSpectrePricesBySymbols(symbolList).catch(() => ({}))
  if (spectre && Object.keys(spectre).length > 0) {
    return Object.fromEntries(Object.entries(spectre).map(([symbol, row]) => [symbol, {
      price: row.price || 0,
      change: row.change24 ?? row.change ?? 0,
      change24: row.change24 ?? row.change ?? 0,
      change1h: row.change1h ?? 0,
      change7d: row.change7d ?? 0,
      change30d: row.change30d ?? 0,
      change1y: row.change1y ?? 0,
      volume: row.volume ?? 0,
      marketCap: row.marketCap ?? 0,
      liquidity: row.liquidity ?? 0,
    }]))
  }
  try {
    const symbolsStr = Array.isArray(symbols) ? symbols.join(',') : String(symbols);
    const result = await apiRequest('prices', { symbols: symbolsStr });
    
    // Local server batch returns { BTC: { price, change, ... }, ... } (keys may be mixed case)
    if (typeof result === 'object' && !result.price) {
      const out = {};
      const resultKeys = Object.keys(result || {});
      for (const sym of (Array.isArray(symbols) ? symbols : symbolsStr.split(','))) {
        const key = (sym || '').toUpperCase().trim();
        if (!key) continue;
        // Case-insensitive lookup (server may return "Btc" or "BTC")
        const resultKey = resultKeys.find((k) => (k || '').toUpperCase() === key);
        const row = resultKey != null ? result[resultKey] : (result[key] || result[sym] || null);
        if (!row || row.price == null) {
          continue;
        }
        const change = row.change ?? row.change24 ?? 0;
        const changeNum = parseFloat(change) || 0;
        // Server/CoinGecko returns percentage (e.g. -2.5); Codex may return decimal - if |val| <= 1 assume decimal
        const changePercent = Math.abs(changeNum) <= 1 && changeNum !== 0 ? changeNum * 100 : changeNum;
        const toPercent = (val) => {
          const num = parseFloat(val) || 0;
          return Math.abs(num) <= 1 && num !== 0 ? num * 100 : num;
        };
        out[key] = {
          price: parseFloat(row.price) || 0,
          change: changePercent,
          change24: changePercent,
          change1h: toPercent(row.change1h ?? row.change1 ?? 0),
          change7d: toPercent(row.change7d ?? row.change7 ?? 0),
          change30d: toPercent(row.change30d ?? row.change30 ?? 0),
          change1y: toPercent(row.change1y ?? row.change365 ?? 0),
          volume: parseFloat(row.volume ?? row.volume24 ?? 0) || 0,
          marketCap: parseFloat(row.marketCap ?? 0) || 0,
          liquidity: parseFloat(row.liquidity ?? 0) || 0,
        };
      }
      return out;
    }
    // Single-symbol response shape (local server returns { price, change, ... } directly)
    const firstSym = Array.isArray(symbols) ? symbols[0] : (symbolsStr.split(',')[0] || symbols);
    const key = (firstSym || '').toString().toUpperCase().trim();
    return { [key]: { price: result.price || 0, change: result.change ?? result.change24 ?? 0, volume: result.volume ?? 0, marketCap: result.marketCap ?? 0 } };
  } catch (err) {
    if (!isDev) console.error('getTokenPricesBatch failed:', err);
    return {};
  }
}

/**
 * Get detailed token info including price, socials, description
 * Used for the main token banner section
 */
export async function getDetailedTokenInfo(address, networkId = 1) {
  const key = `details-${address}-${networkId}`
  return deduplicatedFetch(key, async () => {
    try {
      const result = await apiRequest('details', { address, networkId: String(networkId) });
      return result;
    } catch (err) {
      console.error('Failed to get detailed token info:', err);
      return null;
    }
  })
}

/**
 * Batch variant - fetch details for many tokens in one request.
 * Input: [{ address, networkId }]. Returns Map<addressLower, detailShape>.
 * Max 50 per call; callers should chunk longer lists.
 */
export async function getDetailedTokenInfoBatch(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return new Map()
  const unique = []
  const seen = new Set()
  for (const t of tokens) {
    if (!t?.address) continue
    const key = `${t.address.toLowerCase()}_${t.networkId || 1}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push({ address: t.address, networkId: t.networkId || 1 })
  }
  if (unique.length === 0) return new Map()

  // Local /api/token/details-batch depends on the legacy Codex backend on port
  // 3001. In this workspace that port is often frontend-v2, so avoid spraying
  // 500s across every page and let cards render with the market row data.
  if (isDev) return new Map()

  const chunks = []
  for (let i = 0; i < unique.length; i += 50) chunks.push(unique.slice(i, i + 50))

  const results = new Map()
  await Promise.all(chunks.map(async (chunk) => {
    const ids = chunk.map(t => `${t.address}:${t.networkId}`).join(',')
    const url = isDev
      ? `${API_BASE}/token/details-batch?ids=${encodeURIComponent(ids)}`
      : `${VERCEL_API_URL}?action=details-batch&ids=${encodeURIComponent(ids)}`
    const dedupKey = `details-batch-${ids}`
    try {
      const data = await deduplicatedFetch(dedupKey, async () => {
        const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
        if (!res.ok) throw new Error(`Batch details ${res.status}`)
        return res.json()
      })
      if (data && typeof data === 'object') {
        for (const [addr, info] of Object.entries(data)) {
          if (info) results.set(addr.toLowerCase(), info)
        }
      }
    } catch (err) {
      if (!isDev) console.error('getDetailedTokenInfoBatch failed:', err?.message || err)
    }
  }))

  return results
}

/**
 * Fetch token market profile from fallback API using CoinGecko ID
 * Returns normalized token data matching getDetailedTokenInfo shape
 */
export async function getTokenMarketProfile(cgId) {
  if (!cgId) return null
  try {
    const profile = await getAppResearchTokenMarketProfile({ cgId })
    if (profile) {
      return {
        ...profile,
        change24: profile.change24h ?? profile.change24 ?? 0,
        volume24: profile.volume24h ?? profile.volume24 ?? 0,
        _source: profile._source || 'appresearch',
      }
    }
  } catch (_) {
    // Spectre/backend fallback below.
  }

  try {
    const profile = await getSpectreTokenProfile(cgId)
    if (profile) {
      return {
        symbol: profile.symbol || profile.asset || cgId,
        name: profile.name || profile.symbol || cgId,
        price: profile.market?.price || profile.price || 0,
        marketCap: profile.market?.market_cap || profile.marketCap || 0,
        volume24: profile.market?.volume_24h || profile.volume24h || 0,
        change24: profile.market?.change_24h || profile.change24h || 0,
        change1h: profile.market?.change_1h || 0,
        change7d: profile.market?.change_7d || 0,
        change30d: profile.market?.change_30d || 0,
        circulatingSupply: profile.market?.circulating_supply || 0,
        fullyDilutedValuation: profile.market?.fdv || profile.fdv || 0,
        categories: profile.categories || [],
        aiInsight: profile.summary || profile.description || '',
        high24h: profile.market?.high_24h || 0,
        low24h: profile.market?.low_24h || 0,
        ath: profile.market?.ath || null,
        atl: profile.market?.atl || null,
        volMktCapRatio: profile.market?.volume_to_market_cap || 0,
        keyLevels: profile.technicals?.key_levels || {},
        cgId,
        _source: 'spectre-market',
      }
    }
  } catch (_) {
    // Legacy fallback below.
  }

  if (isDev) return null

  try {
    const res = await fetch(`/api/token/market-profile?cg_id=${encodeURIComponent(cgId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.error) return null;

    return {
      ...data,
      change24: data.change24h ?? data.change24 ?? 0,
      volume24: data.volume24h ?? data.volume24 ?? 0,
    }
  } catch (err) {
    if (!isDev) console.error('Failed to fetch market profile:', err);
    return null;
  }
}

/**
 * Look up token by contract address across multiple networks
 */
export async function lookupTokenByAddress(address) {
  try {
    const result = await apiRequest('search', { q: address });
    if (result?.results && result.results.length > 0) {
      const first = result.results[0];
      return {
        ...first.token,
        priceUSD: first.priceUSD,
        change24: first.change24,
        volume: first.volume24,
        liquidity: first.liquidity,
        marketCap: first.marketCap,
      };
    }
    return null;
  } catch (err) {
    console.error('Failed to lookup token:', err);
    return null;
  }
}

/**
 * Get token with price data by address
 */
export async function getTokenWithPrice(address, networkId = 1) {
  try {
    const result = await apiRequest('details', { address, networkId: String(networkId) });
    return result || null;
  } catch (err) {
    console.error('Failed to get token with price:', err);
    return null;
  }
}

/**
 * Get token price and stats
 */
export async function getTokenPrice(address, networkId = 1) {
  try {
    const result = await apiRequest('details', { address, networkId: String(networkId) });
    return { token: result };
  } catch (err) {
    console.error('Failed to get token price:', err);
    return null;
  }
}

/**
 * Get detailed token stats including price, volume, liquidity
 */
export async function getDetailedTokenStats(address, networkId = 1) {
  try {
    const result = await apiRequest('details', { address, networkId: String(networkId) });
    return { token: result };
  } catch (err) {
    console.error('Failed to get token stats:', err);
    return null;
  }
}

/**
 * Get price bars (OHLCV) for charting
 */
// Codex getBars silently TRUNCATES spans wider than ~4 years - it ignores
// `from` and returns only recent bars, so a 27-year 1W scroll-back window
// refetched the same recent bars forever and the pager declared genesis
// ("stops at breakpoint"). Clamp every request to 3 years; callers page
// back in successive 3y windows. (Same fix as trading codexApi, 2026-06-16.)
const MAX_BARS_RANGE_SEC = 3 * 365 * 24 * 3600
// No token on our path (Codex/DEX 2020+, Binance majors ~2017) has OHLCV
// before 2017 - skip the round-trip AND the billed-empty Codex query.
// The server handlers carry the same floor; this saves the network hop.
const BARS_EPOCH_SEC = 1483228800 // Jan 1 2017 UTC

// `opts.countback` asks the server for a DEEP PAGE: N real trade bars walking
// back from `to`, instead of whatever happens to fall inside a literal
// [from..to] window. The server only forwards it on a wide window (see
// api/_lib/handlers/bars.js) and hard-caps it at 1500. Used by the chart's
// scroll-back pager - on a thin DEX token a verbatim window returns single
// digits of bars for the same round-trip cost (measured: LEO 5m, 9 bars vs
// 1500 at the same anchor).
export async function getBars(symbol, resolution = '60', from, to, networkId = 1, cgId = null, binancePair = null, opts = null) {
  if (to < BARS_EPOCH_SEC) {
    return { getBars: [], source: 'no_data', chartType: null, meta: null }
  }
  if (to - from > MAX_BARS_RANGE_SEC) {
    from = to - MAX_BARS_RANGE_SEC
  }
  const countback = opts && Number.isFinite(opts.countback)
    ? Math.min(1500, Math.max(0, Math.floor(opts.countback)))
    : 0
  // countback MUST be part of the dedup identity: a 1500-bar page and a plain
  // window over the same span are different answers, and sharing one in-flight
  // promise would hand the pager the short one.
  const dedupKey = `bars-${symbol}-${resolution}-${from}-${to}-${networkId}-${cgId || ''}${countback ? `-cb${countback}` : ''}`
  return deduplicatedFetch(dedupKey, async () => {
    try {
      const params = {
        symbol,
        resolution,
        from: from.toString(),
        to: to.toString(),
        networkId: networkId.toString(),
      }
      if (cgId) params.cgId = cgId
      if (binancePair) params.binancePair = binancePair
      if (countback) params.countback = countback.toString()
      const result = await apiRequest('bars', params);
      return {
        getBars: result?.bars || [],
        source: result?.source || null,
        chartType: result?.chartType || null,
        // Server data contracts (2026-06-11): gapFilled/realBarRatio from the
        // GT tier, volumeAvailable:false from cg-ohlc. Consumers use these to
        // judge candle quality instead of guessing from bar flatness.
        meta: result?.meta || null,
        // Server-side failure marker (2026-08-05): the bars handler now sends
        // { bars: [], failed: true } when a tier ERRORED (Codex timeout/429,
        // budget-hard) instead of proving the window empty. Propagating it
        // lets the history pager's existing failed-vs-empty logic also cover
        // server-side breakage - previously such a response was
        // indistinguishable from genesis.
        failed: result?.failed === true,
      };
    } catch (err) {
      console.error('Failed to fetch bars:', err);
      // `failed` separates "the request broke" from "this window is empty".
      // Without it a single timeout looks exactly like the token's genesis, and
      // the chart's history pager latches its wall on it permanently.
      return { getBars: [], source: null, chartType: null, meta: null, failed: true };
    }
  })
}

/**
 * Search for tokens by name or symbol
 */
export async function searchTokens(search, networkIds) {
  try {
    const spectre = await getSpectreSearch(search, 25)
    const results = (spectre?.coins || [])
      .map((coin, index) => mapSpectreCoinToCodexResult(coin, index))
      .filter(Boolean)
    if (results.length > 0) return { filterTokens: { results } }
  } catch (_) {
    // Legacy fallback below.
  }
  try {
    const params = { q: search };
    // Only pass networks if caller explicitly provided them.
    // When omitted, the backend uses its own broader default (Solana + top EVM chains).
    if (networkIds && networkIds.length > 0) {
      params.networks = networkIds.join(',');
    }

    const result = await apiRequest('search', params);
    return { filterTokens: { results: result?.results || [] } };
  } catch (err) {
    if (!isDev) console.error('Failed to search tokens:', err);
    return { filterTokens: { results: [] } };
  }
}

/**
 * Get trending/top tokens for the ON-CHAIN view.
 *
 * PRIMARY: Spectre Onchain Data Bridge (`/api/onchain/tokens/trending?chainId=1|56`)
 *   — full granular data: change5m/h1/h6/h24, volumes per window, liquidity, mcap, holders.
 *   — covers ETH (1) and BSC (56). Per-chain calls run in parallel.
 *
 * FALLBACK: Codex DEX `filterTokens` for chains not covered by api-eth (Solana/Polygon/etc).
 */
const _trendingCodexCache = new Map()

// ── Onchain-bridge health cooldown ──────────────────────────────────────────
// onchain.spectreai.io sits behind Cloudflare; when its bot-challenge blocks
// this egress (verified 2026-07-08: 403 even with the browser-UA workaround)
// EVERY trending load burned ~0.5s on two requests that always come back
// `_source:"none"` before the Codex fallback even started. Stamp the failure
// in localStorage so subsequent loads - including full page reloads and the
// index.html early-fetch script - skip the dead leg for 5 minutes and go
// straight to the fallback.
const BRIDGE_DOWN_KEY = 'spectre-onchain-bridge-down-until'
const BRIDGE_COOLDOWN_MS = 5 * 60_000
function isBridgeCoolingDown() {
  try { return Date.now() < Number(localStorage.getItem(BRIDGE_DOWN_KEY) || 0) } catch { return false }
}
function markBridgeDown() {
  try { localStorage.setItem(BRIDGE_DOWN_KEY, String(Date.now() + BRIDGE_COOLDOWN_MS)) } catch { /* noop */ }
}
function markBridgeUp() {
  try { localStorage.removeItem(BRIDGE_DOWN_KEY) } catch { /* noop */ }
}

// Early-fetch promises are created at HTML-parse time; adopting one long after
// boot (5-min trending-cache expiry, late fallback path) would serve and cache
// a response that is minutes stale. Only adopt within the boot window - after
// that the promise is abandoned and a normal fresh request fires.
const EARLY_ADOPT_WINDOW_MS = 30_000
function adoptEarlyFetch(url) {
  if (typeof performance === 'undefined' || performance.now() > EARLY_ADOPT_WINDOW_MS) return null
  return consumeEarlyFetch(url)
}

// One cached+deduped entry point for the Codex DEX trending request. Both the
// direct fallback and the granular-change enrichment inside fetchTrendingTokens
// build the same URL (networks + limit>=100) - without a shared cache the
// empty-Codex path fired it twice per load (fallback miss, then finalize()).
function codexTrendingCached(networks, limit) {
  const key = `trending-codex:${networks}:${limit}`
  const hit = _trendingCodexCache.get(key)
  if (hit && Date.now() - hit.ts < 30_000) return Promise.resolve(hit.data)
  return deduplicatedFetch(key, async () => {
    // Adopt the index.html early-fetch when it fired this exact request at
    // HTML-parse time (dev + prod URL forms differ; consume-once, falls
    // through to a normal apiRequest when absent or failed).
    const qs = new URLSearchParams({ networks, limit }).toString()
    const earlyUrl = isDev
      ? `${API_BASE}/tokens/trending?${qs}`
      : `${VERCEL_API_URL}?${new URLSearchParams({ action: 'trending', networks, limit })}`
    const early = adoptEarlyFetch(earlyUrl)
    let data = null
    if (early) {
      const r = await early
      if (r && r.ok && r.json) data = r.json
    }
    if (!data) data = await apiRequest('trending', { networks, limit })
    _trendingCodexCache.set(key, { data, ts: Date.now() })
    return data
  })
}

export function getTrendingTokens(networkIds = [1, 56, 137, 42161, 8453], limit = 20) {
  // Concurrent identical calls (StrictMode double-mount, ticker + on-chain tab
  // mounting together) share one promise instead of re-firing the 2-chain
  // fan-out + enrichment fetches. Measured x4 /api/tokens/trending on one load.
  return deduplicatedFetch(
    `trending:${networkIds.join(',')}:${limit}`,
    () => fetchTrendingTokens(networkIds, limit),
  )
}

async function fetchTrendingTokens(networkIds, limit) {
  // Sparkline enrichment via CoinGecko top-250 by symbol (single batch request).
  // Server is responsible for any per-token sparkline enrichment (no client-side N-fan-out).
  const enrichWithSparklines = async (results) => {
    if (!Array.isArray(results) || results.length === 0) return results
    const hasAll = results.every(r => Array.isArray(r.sparkline_7d) && r.sparkline_7d.length > 0)
    if (hasAll) return results
    try {
      const { getTopCoinsMarketsPage } = await import('@/services/coinGeckoApi')
      // Cap the wait: on a truly cold first visit the top-250 payload is a
      // ~480KB download - the ticker/table must not sit empty behind it.
      // Consumers fall back to synthetic sparklines when sparkline_7d is
      // missing (discovery-section generateSeededSparkline), so shipping
      // unenriched rows fast beats enriched rows late.
      const cgRows = await Promise.race([
        getTopCoinsMarketsPage(1, 250),
        new Promise((resolve) => setTimeout(() => resolve(null), 1200)),
      ])
      if (!Array.isArray(cgRows) || cgRows.length === 0) return results
      const sparkBySymbol = new Map()
      for (const cg of cgRows) {
        const sym = String(cg.symbol || '').toUpperCase()
        const sp = Array.isArray(cg.sparkline_in_7d?.price) ? cg.sparkline_in_7d.price : null
        if (sym && sp) sparkBySymbol.set(sym, sp)
      }
      return results.map(r => {
        if (Array.isArray(r.sparkline_7d) && r.sparkline_7d.length > 0) return r
        const sym = String(r.token?.symbol || '').toUpperCase()
        const sp = sparkBySymbol.get(sym)
        return sp ? { ...r, sparkline_7d: sp } : r
      })
    } catch (_) {
      return results
    }
  }

  // Helper: backfill change5m/change4/change12 from Codex DEX (Spectre lacks granular windows).
  // Runs in parallel to keep first-paint fast; if Codex isn't available, Spectre data ships as-is.
  const enrichWithGranularChanges = async (results) => {
    if (!Array.isArray(results) || results.length === 0) return results
    const needsGranular = results.some(r =>
      (!r.change5m || r.change5m === 0) &&
      (!r.change4 || r.change4 === 0) &&
      (!r.change12 || r.change12 === 0)
    )
    if (!needsGranular) return results
    try {
      const codex = await codexTrendingCached(networkIds.join(','), String(Math.max(limit, 100)))
      const codexResults = Array.isArray(codex?.results) ? codex.results : []
      if (codexResults.length === 0) return results
      const granularBySymbol = new Map()
      for (const cr of codexResults) {
        const sym = String(cr.token?.symbol || '').toUpperCase()
        if (!sym) continue
        granularBySymbol.set(sym, {
          change5m: cr.change5m,
          change4: cr.change4,
          change12: cr.change12,
        })
      }
      return results.map(r => {
        const sym = String(r.token?.symbol || '').toUpperCase()
        const g = granularBySymbol.get(sym)
        if (!g) return r
        return {
          ...r,
          change5m: r.change5m || g.change5m || 0,
          change4: r.change4 || g.change4 || 0,
          change12: r.change12 || g.change12 || 0,
        }
      })
    } catch (_) {
      return results
    }
  }

  const finalize = async (results) => {
    const withSparklines = await enrichWithSparklines(results)
    const withGranular = await enrichWithGranularChanges(withSparklines)
    return { filterTokens: { results: withGranular } }
  }

  // PRIMARY: Spectre Onchain Data Bridge — full granular data for ETH (1) + BSC (56).
  // Maps the api-eth response into Codex result shape so downstream code is unchanged.
  // Skipped entirely while the bridge-down cooldown is active (dead upstream =
  // ~0.5s of guaranteed-empty requests in front of the fallback).
  const SPECTRE_ONCHAIN_CHAINS = networkIds.filter((id) => id === 1 || id === 56)
  if (SPECTRE_ONCHAIN_CHAINS.length > 0 && !isBridgeCoolingDown()) {
    try {
      const fetchBridgeChain = (chainId) => {
        const url = `/api/onchain/tokens/trending?chainId=${chainId}&sort=volume_24h&limit=${Math.max(limit, 50)}&sparklines=1&quality=1`
        // Adopt the index.html early-fetch (fired at HTML-parse time) when present
        const early = adoptEarlyFetch(url)
        if (early) return early.then((r) => (r && r.ok ? r.json : null))
        return fetch(url).then((r) => (r.ok ? r.json() : null))
      }
      const responses = await Promise.allSettled(
        SPECTRE_ONCHAIN_CHAINS.map(fetchBridgeChain)
      )
      const allRows = []
      for (const r of responses) {
        if (r.status !== 'fulfilled' || !r.value?.data) continue
        for (const t of r.value.data) {
          if (!t?.symbol) continue
          allRows.push({
            token: {
              symbol: String(t.symbol).toUpperCase(),
              name: t.name || t.symbol,
              address: t.address || '',
              networkId: t.networkId || 1,
              info: { imageThumbUrl: t.logo || null, imageSmallUrl: t.logo || null },
            },
            priceUSD: Number(t.price ?? t.priceUSD) || 0,
            change24: Number(t.change24h ?? t.change24) || 0,
            change12: Number(t.change12h) || 0,
            change5m: Number(t.change5m) || 0,
            change1: Number(t.change1h) || 0,
            // Real 4h window when the source has it (codex-fallback rows);
            // api-eth only has change6h - surface it as the change4 alias
            change4: Number(t.change4h ?? t.change6h ?? t.change12h) || 0,
            volume: Number(t.volume24h) || 0,
            volume24: Number(t.volume24h) || 0,
            liquidity: Number(t.liquidity) || Number(t.volume24h) || 0,
            marketCap: Number(t.marketCap) || Number(t.fdv) || 0,
            holders: Number(t.holders) || 0,
            // sparkline_7d is enriched server-side when sparklines=1 is requested
            sparkline_7d: Array.isArray(t.sparkline_7d) ? t.sparkline_7d : null,
            _source: 'spectre-onchain',
          })
        }
      }
      // Rank globally by 24h volume across both chains
      allRows.sort((a, b) => (b.volume || 0) - (a.volume || 0))
      if (allRows.length > 0) {
        markBridgeUp()
        return { filterTokens: { results: await enrichWithSparklines(allRows.slice(0, Math.max(limit, 50))) } }
      }
      // Both chains answered empty (CF challenge / upstream outage) - stamp
      // the cooldown so the next 5 min of loads skip straight to the fallback.
      markBridgeDown()
    } catch (err) {
      markBridgeDown()
      if (!isDev) console.error('Spectre Onchain trending failed:', err)
    }
  }

  // FALLBACK: Codex DEX (covers Solana / Polygon / Arbitrum / Base / Avalanche)
  try {
    const result = await codexTrendingCached(networkIds.join(','), String(limit));
    const codexResults = Array.isArray(result?.results) ? result.results : []
    if (codexResults.length > 0) {
      return { filterTokens: { results: await enrichWithSparklines(codexResults) } }
    }
  } catch (err) {
    if (!isDev) console.error('Codex trending failed, falling back to Spectre:', err);
  }
  // FALLBACK 1: Spectre /v1/trending (mcap-leaderboard — includes CEX-only coins)
  try {
    const rows = await getSpectreMarketTrending(limit)
    const results = rows.map(mapSpectreCoinToCodexResult).filter(Boolean)
    if (results.length > 0) return await finalize(results)
  } catch (_) { /* continue */ }
  // FALLBACK 2: Spectre /v1/prices (mcap top)
  try {
    const rows = await getSpectreTopMarketsPage(1, Math.max(20, Number(limit) || 20))
    const results = rows.map(mapSpectreCoinToCodexResult).filter(Boolean)
    if (results.length > 0) return await finalize(results)
  } catch (_) { /* continue */ }
  return { filterTokens: { results: [] } };
}

/**
 * Get token pairs/pools - returns empty for now
 */
export async function getTokenPairs(tokenAddress, networkId = 1) {
  return { listPairsForToken: [] };
}

/**
 * Get latest trades for a token
 */
export async function getLatestTrades(tokenAddress, networkId = 1, limit = 50) {
  const dedupKey = `trades-${tokenAddress}-${networkId}-${limit}`
  return deduplicatedFetch(dedupKey, async () => {
    try {
      const result = await apiRequest('trades', {
        address: tokenAddress,
        networkId: networkId.toString(),
        limit: limit.toString()
      });
      return result;
    } catch (err) {
      console.error('Failed to fetch trades:', err);
      return { trades: [], pairs: [] };
    }
  })
}

/**
 * Get network name from ID
 */
export function getNetworkName(networkId) {
  const networks = {
    1: 'ETH',
    56: 'BSC',
    137: 'MATIC',
    42161: 'ARB',
    8453: 'BASE',
    43114: 'AVAX',
    10: 'OP',
    250: 'FTM',
    4663: 'HOOD',
    1399811149: 'SOL',
  };
  return networks[networkId] || 'Unknown';
}

/**
 * Get network ID from name
 */
export function getNetworkId(networkName) {
  const networks = {
    'ETH': 1,
    'ETHEREUM': 1,
    'BSC': 56,
    'BINANCE': 56,
    'MATIC': 137,
    'POLYGON': 137,
    'ARB': 42161,
    'ARBITRUM': 42161,
    'BASE': 8453,
    'AVAX': 43114,
    'AVALANCHE': 43114,
    'OP': 10,
    'OPTIMISM': 10,
    'FTM': 250,
    'FANTOM': 250,
  };
  return networks[networkName.toUpperCase()] || 1;
}

/**
 * Format large numbers with comma separators (e.g., 1200 -> $1,200)
 */
export function formatLargeNumber(num) {
  // Convert to number and validate
  const n = typeof num === 'number' ? num : parseFloat(num);
  if (!n || isNaN(n) || !isFinite(n)) return '$0';
  
  const absNum = Math.abs(n);
  
  // For very large numbers, use abbreviated format
  if (absNum >= 1e9) return `$${(n / 1e9).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}B`;
  if (absNum >= 1e6) return `$${(n / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`;
  
  // For thousands, no decimals
  if (absNum >= 1000) return `$${Math.round(n).toLocaleString('en-US')}`;
  
  // For $100-$999, show 1 decimal
  if (absNum >= 100) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  
  // For smaller values, show 2 decimals
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format price based on magnitude
 */
export function formatPrice(price) {
  // Convert to number and validate
  const p = typeof price === 'number' ? price : parseFloat(price);
  if (!p || isNaN(p) || !isFinite(p)) return '$0.00';
  
  if (p >= 1000) return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  if (p >= 0.0001) return `$${p.toFixed(6)}`;
  return `$${p.toFixed(8)}`;
}

/**
 * Compact price for mobile: $97.2K, $1.2M, $3.4B or 2–4 decimals for small values
 */
export function formatPriceShort(price) {
  const p = typeof price === 'number' ? price : parseFloat(price);
  if (!p || isNaN(p) || !isFinite(p)) return '$0';
  const abs = Math.abs(p);
  if (abs >= 1e9) return `$${(p / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(p / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(p / 1e3).toFixed(1)}K`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  return `$${p.toFixed(6)}`;
}

/**
 * Compact large number for mobile: $1.2M, $3.4B (1–2 decimals)
 */
export function formatLargeNumberShort(num) {
  const n = typeof num === 'number' ? num : parseFloat(num);
  if (!n || isNaN(n) || !isFinite(n)) return '$0';
  const absNum = Math.abs(n);
  if (absNum >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (absNum >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (absNum >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (absNum >= 1) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}

// Well-known token addresses for quick lookup
export const KNOWN_TOKENS = {
  // Ethereum Mainnet
  ETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', networkId: 1 }, // WETH
  USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', networkId: 1 },
  USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', networkId: 1 },
  LINK: { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', networkId: 1 },
  UNI: { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', networkId: 1 },
  AAVE: { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', networkId: 1 },
  PEPE: { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', networkId: 1 },
  SHIB: { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', networkId: 1 },
  // Arbitrum
  ARB: { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', networkId: 42161 },
  // Base
  BASE_ETH: { address: '0x4200000000000000000000000000000000000006', networkId: 8453 },
};

export default {
  getTokenInfo,
  getTokenPrice,
  getDetailedTokenStats,
  getBars,
  searchTokens,
  getTrendingTokens,
  getTokenPairs,
  getLatestTrades,
  getNetworkName,
  getNetworkId,
  formatLargeNumber,
  formatPrice,
  KNOWN_TOKENS,
};
