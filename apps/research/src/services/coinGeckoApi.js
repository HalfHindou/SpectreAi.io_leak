/**
 * CoinGecko API Service
 * Used for major tokens (BTC, ETH, SOL, etc.) - reliable, no API key needed
 * Free tier: 10-30 calls/minute, we cache aggressively
 */

import { SYMBOL_TO_COINGECKO_ID, COINGECKO_LOGOS, MAJOR_TOKEN_INFO } from '@/constants/majorTokens';
import { filterRankedCoins } from '@/constants/marketDataExclusions';
import { maybeEnrichRobinhoodCategory } from '@/lib/robinhood-category-gt-enrich';
import { logError } from '@/lib/logger';
import {
  getSpectreCategories,
  getSpectreCategoryAssets,
  getSpectreCoinsMarketsPage,
  getSpectrePricesBySymbols,
  getSpectreSearch,
  getSpectreTokenProfile,
  getSpectreTokenMarkets,
  getSpectreTopMarketsPage,
} from '@/services/spectreMarketApi';

// Route through backend proxy to use CoinGecko API key for higher rate limits
const COINGECKO_API = '/api/coingecko';

// Cache for prices - avoid redundant calls
let priceCache = {};
let lastFetchTime = 0;
const CACHE_TTL = 30 * 1000; // 30 seconds cache

function localTokenIcon(label = '?') {
  const text = String(label || '?').replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || '?';
  const hue = [...text].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="hsl(${hue},42%,24%)"/><circle cx="32" cy="32" r="30" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/><text x="32" y="38" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="800" fill="white">${text}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function fallbackCoinDetails(symbol, name) {
  const sym = String(symbol || '').toUpperCase();
  const info = MAJOR_TOKEN_INFO[sym] || {};
  const displayName = name || info.name || sym;
  const network = info.network ? ` on ${info.network}` : '';
  return {
    description: `${displayName} (${sym}) is tracked with live Spectre market data${network}. Full project description metadata is pending from the backend profile bridge; price, chart, and social proof remain live.`,
    links: {},
    categories: info.network ? [info.network] : [],
    genesisDate: null,
    platforms: {},
    scores: {},
    communityData: {},
    developerData: {},
    marketCapRank: null,
    marketData: {},
    image: COINGECKO_LOGOS[sym] || null,
    _source: 'spectre-fallback-profile',
  };
}

// Cache for top coins markets data - fetch 250 at a time, paginate client-side
let allCoinsCache = { data: [], _ts: 0 };
let topCoinsCacheTTL = 5 * 60 * 1000; // 5 minutes cache for market data (avoid rate limits)
let fetchingAllCoins = false;
let fetchPromise = null;

async function getSpectreTopMarketsFallback(page = 1, perPage = 25) {
  try {
    const markets = await getSpectreTopMarketsPage(page, perPage);
    return markets.length > 0 ? markets : null;
  } catch {
    return null;
  }
}

/**
 * Fetch authoritative market-cap pages from the CoinGecko proxy.
 *
 * Backend audit 2026-04-29: the current Spectre `/v1/prices?limit` ranking path
 * is symbol-keyed end-to-end, so it is not safe as primary discovery ranking.
 * Keep it only as a provisional fallback until backend repairs stable identity
 * joins for screener/ranked-price surfaces.
 */
async function fetchAllTopCoins() {
  if (fetchingAllCoins && fetchPromise) {
    return fetchPromise;
  }

  fetchingAllCoins = true;
  fetchPromise = (async () => {
    // PRIMARY: Spectre `/v1/coins/markets` (Hetzner-cached CG passthrough).
    // One CG hit per Hetzner TTL serves every user instead of N cold fetches,
    // which keeps us under the CG Pro per-minute quota at scale.
    try {
      const spectrePages = await Promise.allSettled(
        [1, 2, 3, 4].map((p) => getSpectreCoinsMarketsPage(p, 250, { sparkline: true }))
      );
      const ok = spectrePages.filter(r => r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length > 0);
      if (ok.length >= 1) {
        const merged = ok.flatMap(r => r.value);
        // Spectre upstream drops 30d/1y change fields — if absent, fall through
        // to direct CG so the Discovery 30D / 1Y columns render real values.
        const has30dOr1y = merged.some((c) =>
          c?.price_change_percentage_30d_in_currency != null ||
          c?.price_change_percentage_1y_in_currency != null
        );
        if (has30dOr1y) return merged;
      }
    } catch (_) { /* fall through to CG direct */ }

    // FALLBACK: direct CoinGecko via Express proxy.
    const pageResults = await Promise.allSettled(
      [1, 2, 3, 4].map(async (apiPage) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const url = `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${apiPage}&sparkline=true&price_change_percentage=1h,24h,7d,30d,1y`;
        const res = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      })
    );

    // Page 1 is critical — if it failed, propagate the error
    if (pageResults[0].status === 'rejected') {
      const spectrePagesAlt = await Promise.all(
        [1, 2, 3, 4, 5].map((spectrePage) => getSpectreTopMarketsFallback(spectrePage, 200))
      );
      const spectreMarkets = spectrePagesAlt.flatMap((pageRows) => pageRows || []);
      if (spectreMarkets.length > 0) return spectreMarkets;
      throw pageResults[0].reason;
    }

    const allCoins = pageResults.flatMap(r =>
      r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []
    );

    // Drop CG-ranked junk (FIGR_HELOC / RAIN etc.) from the direct-CG fallback.
    // The Spectre primary path is already filtered in getSpectreCoinsMarketsPage.
    return filterRankedCoins(allCoins);
  })();

  try {
    const result = await fetchPromise;
    allCoinsCache = { data: result, _ts: Date.now() };
    return result;
  } finally {
    fetchingAllCoins = false;
    fetchPromise = null;
  }
}

/**
 * Fetch one page of top coins by market cap (for Top Coins tab).
 * @param {number} page - 1-based page (1..80 for 2000 coins at 25 per page)
 * @param {number} perPage - items per page (default 25)
 * @returns {Promise<Array>} - array of { id, symbol, name, image, current_price, market_cap_rank, ... }
 */
// Single-page fetch cache (for fast path when only page 1 is needed)
let _singlePageCache = { data: [], _ts: 0 };
const _singlePageInflight = {};

// localStorage instant-paint seed for the shared 250-row page-1 payload. This is
// the table that backs home/discover/categories - module-only before, so a cold
// reload shimmered while the 412KB fetch ran. We persist a sparkline-stripped
// snapshot (sparkline arrays are large and only the live fetch needs them) with
// a 10-min TTL, hydrate _singlePageCache on module load, then refresh per the
// normal TTL. Mirrors the getCoinDetails 24h persist shape below. All access is
// try/catch (private-mode safe).
const PERSIST_PAGE1_KEY = 'spectre-cg-page1-v1';
const PERSIST_PAGE1_TTL = 10 * 60 * 1000; // 10min

function _stripSparklines(coins) {
  if (!Array.isArray(coins)) return [];
  return coins.map((c) => {
    if (c && c.sparkline_in_7d) {
      const { sparkline_in_7d, ...rest } = c;
      return rest;
    }
    return c;
  });
}

function _loadPersistedPage1() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PERSIST_PAGE1_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed._ts !== 'number' || !Array.isArray(parsed.data)) return null;
    if (Date.now() - parsed._ts > PERSIST_PAGE1_TTL) return null;
    return parsed;
  } catch { return null; }
}

function _persistPage1(coins) {
  if (typeof window === 'undefined' || !Array.isArray(coins) || coins.length === 0) return;
  try {
    window.localStorage.setItem(
      PERSIST_PAGE1_KEY,
      JSON.stringify({ data: _stripSparklines(coins), _ts: Date.now() })
    );
  } catch { /* quota exceeded / private mode - silently ignore */ }
}

// Hydrate the in-memory page-1 cache from localStorage on module load so the
// first getTopCoinsMarketsPage(1, n) call paints instantly. _ts is taken from
// the seed so the normal TTL check still fires a background refresh when stale.
(function _seedPage1FromStorage() {
  const seed = _loadPersistedPage1();
  if (seed && seed.data.length > 0) {
    _singlePageCache = { data: seed.data, _ts: seed._ts };
  }
})();

// Shared in-flight promise for the page-1 / per_page=250 underlying fetches.
// `_singlePageInflight` is keyed by `page1:${perPage}`, so two concurrent home
// callers (e.g. getTopCoinsMarketsPage(1, 250) for Discovery + (1, 40) for the
// heatmap) miss each other's dedupe and each kick off the SAME 250-row Spectre
// + CoinGecko fetches. These two promises collapse the underlying network work
// to one Spectre call and one CoinGecko call no matter how many perPage variants
// race on first paint. Cleared once resolved so the next TTL window refetches.
let _page1SpectreInflight = null;
let _page1CgInflight = null;

// @param {{ sparkline?: boolean }} [opts] - sparkline defaults to true (current
//   behavior). Pass { sparkline: false } for callers that discard the 7d arrays
//   (e.g. MarketCapCompare) to fetch a ~4-5x lighter payload. Cached/seeded data
//   is reused regardless of this flag - only a fresh network fetch is affected.
// Authoritative top-100 market-cap sum WITH stablecoins, via the CG proxy. The
// Spectre box /v1/coins/markets STRIPS the major stables, so total - box-top-100
// inflates OTHERS2 by ~$30B ($86B vs the true ~$55B). The alt-long-tail read
// uses this so the app matches the TG bot / CoinGecko. Cached 5min + inflight-deduped.
let _cgTop100 = { ts: 0, sum: null };
let _cgTop100Inflight = null;
export async function getCgTop100Sum() {
  const now = Date.now();
  if (_cgTop100.sum && now - _cgTop100.ts < 5 * 60 * 1000) return _cgTop100.sum;
  if (_cgTop100Inflight) return _cgTop100Inflight;
  _cgTop100Inflight = (async () => {
    try {
      const url = `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false`;
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`cg ${res.status}`);
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length < 50) throw new Error('cg thin');
      const sum = rows.reduce((s, x) => s + (Number(x.market_cap) || 0), 0);
      if (sum > 0) _cgTop100 = { ts: Date.now(), sum };
      return _cgTop100.sum;
    } catch {
      return _cgTop100.sum; // stale-on-error (beats the inflated box figure)
    } finally {
      _cgTop100Inflight = null;
    }
  })();
  return _cgTop100Inflight;
}

// Long-tail constituents for the OTHERS2 view: CG ranks 101-250 leaders merged
// with the Robinhood-ecosystem runners (CG category), deduped/cleaned of
// stables+wrapped, with logos + mcap + 24h. The real "what's in OTHERS2" - no
// ex-top-100 index exists, so this is the honest constituent view. Cached 5min.
const _O2_STABLE = /USD|DAI|EUR|USTC|BUIDL|EURC|GHO|FRAX|PYUSD|USTB/i;
const _O2_WRAP = /WBTC|WETH|WEETH|WSTETH|STETH|WBETH|CBBTC|CBETH|RETH|LBTC|SOLVBTC|BNSOL|JITOSOL|MSOL|RSETH|EZETH|SUSDE|WBNB|WSOL/i;
const _isO2Alt = (s) => { const u = String(s || '').toUpperCase(); return u && u !== 'BTC' && !_O2_STABLE.test(u) && !_O2_WRAP.test(u); };
// The OTHERS2 data bundle in ONE pass: top-100 sum (value), long-tail
// constituents (grid), the mcap-weighted long-tail returns over 1d/7d/30d/1y
// (to RECONSTRUCT the OTHERS2 line - no ex-top-100 index has history), and the
// real alt-season breadth (% of top-50 alts beating BTC over 30d). Cached 5min.
let _o2Data = { ts: 0, data: null };
let _o2DataInflight = null;
export async function getOthers2Data() {
  const now = Date.now();
  if (_o2Data.data && now - _o2Data.ts < 5 * 60 * 1000) return _o2Data.data;
  if (_o2DataInflight) return _o2DataInflight;
  _o2DataInflight = (async () => {
    try {
      const base = `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&sparkline=false&price_change_percentage=24h,7d,14d,30d,200d,1y`;
      const [top, rh] = await Promise.all([
        fetch(`${base}&per_page=250&page=1`, { signal: AbortSignal.timeout(9000) }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
        fetch(`${base}&per_page=50&page=1&category=robinhood-ecosystem`, { signal: AbortSignal.timeout(9000) }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      ]);
      if (!Array.isArray(top) || top.length < 100) return _o2Data.data;
      const num = (v) => Number(v);
      const top100Sum = top.slice(0, 100).reduce((s, x) => s + (num(x.market_cap) || 0), 0);
      const clean = (x, isRh) => ({ sym: String(x.symbol || '').toUpperCase(), name: x.name || '', mcap: num(x.market_cap) || 0, chg: num(x.price_change_percentage_24h_in_currency), image: x.image || '', rank: num(x.market_cap_rank) || null, rh: isRh, id: x.id || String(x.symbol || '').toLowerCase() });
      const tailRows = top.slice(100).filter((x) => _isO2Alt(x.symbol));
      const longTail = tailRows.map((x) => clean(x, false));
      const rhArr = (Array.isArray(rh) ? rh : []).filter((x) => _isO2Alt(x.symbol)).map((x) => clean(x, true));
      const byKey = new Map();
      for (const t of longTail) if (t.mcap > 0 && !byKey.has(t.id)) byKey.set(t.id, t);
      for (const t of rhArr) { if (byKey.has(t.id)) { byKey.get(t.id).rh = true; continue; } if (t.mcap > 0) byKey.set(t.id, t); }
      const pool = [...byKey.values()];
      const picked = new Map();
      for (const t of [...pool].sort((a, b) => b.mcap - a.mcap).slice(0, 6)) picked.set(t.id, t);
      for (const t of pool.filter((x) => x.rh).sort((a, b) => b.mcap - a.mcap)) { if (picked.size >= 10) break; if (!picked.has(t.id)) picked.set(t.id, t); }
      for (const t of pool.filter((x) => Number.isFinite(x.chg)).sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg))) { if (picked.size >= 18) break; if (!picked.has(t.id)) picked.set(t.id, t); }
      const constituents = [...picked.values()].sort((a, b) => b.mcap - a.mcap);
      // mcap-weighted long-tail returns (ranks 101-250 = the bulk of OTHERS2)
      const wsum = tailRows.reduce((s, x) => s + (num(x.market_cap) || 0), 0);
      const agg = (key) => (wsum > 0 ? tailRows.reduce((s, x) => { const c = num(x[key]); return Number.isFinite(c) ? s + (num(x.market_cap) || 0) * c : s; }, 0) / wsum : null);
      const aggChanges = { d1: agg('price_change_percentage_24h_in_currency'), d7: agg('price_change_percentage_7d_in_currency'), d14: agg('price_change_percentage_14d_in_currency'), d30: agg('price_change_percentage_30d_in_currency'), d200: agg('price_change_percentage_200d_in_currency'), y1: agg('price_change_percentage_1y_in_currency') };
      // real alt-season breadth: % of top-50 alts beating BTC over 30d
      const btc30 = num(top.find((x) => String(x.symbol || '').toUpperCase() === 'BTC')?.price_change_percentage_30d_in_currency);
      const altRows = top.filter((x) => _isO2Alt(x.symbol) && Number.isFinite(num(x.price_change_percentage_30d_in_currency))).slice(0, 50);
      const beat = Number.isFinite(btc30) ? altRows.filter((x) => num(x.price_change_percentage_30d_in_currency) > btc30).length : null;
      const green = altRows.filter((x) => num(x.price_change_percentage_30d_in_currency) > 0).length;
      const breadth = (altRows.length && beat != null) ? { index: Math.round((beat / altRows.length) * 100), outperforming: beat, total: altRows.length, green30: Math.round((green / altRows.length) * 100), btc30: Number.isFinite(btc30) ? btc30 : null } : null;
      const data = { top100Sum: top100Sum > 0 ? top100Sum : null, constituents, aggChanges, breadth };
      _o2Data = { ts: Date.now(), data };
      return data;
    } catch {
      return _o2Data.data;
    } finally {
      _o2DataInflight = null;
    }
  })();
  return _o2DataInflight;
}

let _cgLongTail = { ts: 0, data: null };
let _cgLongTailInflight = null;
export async function getCgLongTail() {
  const now = Date.now();
  if (_cgLongTail.data && now - _cgLongTail.ts < 5 * 60 * 1000) return _cgLongTail.data;
  if (_cgLongTailInflight) return _cgLongTailInflight;
  _cgLongTailInflight = (async () => {
    try {
      const base = `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&sparkline=false&price_change_percentage=24h`;
      const [topRows, rhRows] = await Promise.all([
        fetch(`${base}&per_page=250&page=1`, { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
        fetch(`${base}&per_page=50&page=1&category=robinhood-ecosystem`, { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      ]);
      const clean = (x, rh) => ({ sym: String(x.symbol || '').toUpperCase(), name: x.name || '', mcap: Number(x.market_cap) || 0, chg: Number(x.price_change_percentage_24h), image: x.image || '', rank: Number(x.market_cap_rank) || null, rh, id: x.id || String(x.symbol || '').toLowerCase() });
      const longTail = (Array.isArray(topRows) ? topRows.slice(100) : []).filter((x) => _isO2Alt(x.symbol)).map((x) => clean(x, false));
      const rh = (Array.isArray(rhRows) ? rhRows : []).filter((x) => _isO2Alt(x.symbol)).map((x) => clean(x, true));
      const byKey = new Map();
      for (const t of longTail) if (t.mcap > 0 && !byKey.has(t.id)) byKey.set(t.id, t);
      for (const t of rh) { if (byKey.has(t.id)) { byKey.get(t.id).rh = true; continue; } if (t.mcap > 0) byKey.set(t.id, t); }
      const pool = [...byKey.values()];
      const byMcap = [...pool].sort((a, b) => b.mcap - a.mcap);
      const picked = new Map();
      for (const t of byMcap.slice(0, 6)) picked.set(t.id, t);           // tail heavyweights
      const rhPool = pool.filter((t) => t.rh).sort((a, b) => b.mcap - a.mcap);
      for (const t of rhPool) { if (picked.size >= 10) break; if (!picked.has(t.id)) picked.set(t.id, t); } // Robinhood runners
      const movers = pool.filter((t) => Number.isFinite(t.chg)).sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg));
      for (const t of movers) { if (picked.size >= 18) break; if (!picked.has(t.id)) picked.set(t.id, t); } // hottest movers
      const data = [...picked.values()].sort((a, b) => b.mcap - a.mcap);
      if (data.length) _cgLongTail = { ts: Date.now(), data };
      return _cgLongTail.data;
    } catch {
      return _cgLongTail.data;
    } finally {
      _cgLongTailInflight = null;
    }
  })();
  return _cgLongTailInflight;
}

export async function getTopCoinsMarketsPage(page = 1, perPage = 25, opts = {}) {
  const { sparkline = true } = opts;
  const now = Date.now();

  // Use full cache if valid
  if (allCoinsCache.data.length > 0 && (now - allCoinsCache._ts < topCoinsCacheTTL)) {
    const startIndex = (page - 1) * perPage;
    const endIndex = startIndex + perPage;
    return allCoinsCache.data.slice(startIndex, endIndex);
  }

  // Fast path: if only page 1 is needed and perPage <= 250, fetch just one page
  // instead of all 4. The full 1000-coin fetch happens later when other pages need it.
  if (page === 1 && perPage <= 250) {
    if (_singlePageCache.data.length > 0 && (now - _singlePageCache._ts < topCoinsCacheTTL)) {
      return _singlePageCache.data.slice(0, perPage);
    }
    // Keyed by perPage AND sparkline so a no-sparkline caller doesn't dedupe
    // onto an in-flight sparkline fetch (and vice versa) and get the wrong shape.
    const cacheKey = `page1:${perPage}:${sparkline ? 's1' : 's0'}`;
    if (_singlePageInflight[cacheKey]) return _singlePageInflight[cacheKey];

    const promise = (async () => {
      try {
        // PRIMARY: Spectre /v1/coins/markets (Hetzner-cached CG passthrough).
        // Spectre upstream strips price_change_percentage_30d_in_currency and
        // price_change_percentage_1y_in_currency — if missing, fall through to
        // direct CG so the 30D / 1Y columns aren't stuck at 0.
        // .catch(()=>[]) so a THROW (e.g. bridge 401 locally / down) degrades to
        // empty rather than bubbling to the outer catch — which would skip this
        // direct-CoinGecko fallback (real logos) and land on the Spectre
        // placeholder fallback (initial-circle data:svg logos). Empty here lets
        // execution flow through to the direct CG proxy below.
        // Shared inflight: collapse concurrent perPage variants to ONE Spectre fetch.
        // Only the sparkline:true path joins/writes the shared page-1 caches
        // (_singlePageCache/_persistPage1/allCoinsCache back home + discover, which
        // DO render real sparklines - a stripped payload would poison them). A
        // sparkline:false caller does its own lighter fetch and returns without
        // touching shared state.
        if (sparkline) {
          if (!_page1SpectreInflight) {
            _page1SpectreInflight = getSpectreCoinsMarketsPage(1, 250, { sparkline: true })
              .catch(() => [])
              .finally(() => { _page1SpectreInflight = null; });
          }
          const spectreCoins = await _page1SpectreInflight;
          const spectreHas30dOr1y = Array.isArray(spectreCoins) && spectreCoins.some((c) =>
            c?.price_change_percentage_30d_in_currency != null ||
            c?.price_change_percentage_1y_in_currency != null
          );
          if (Array.isArray(spectreCoins) && spectreCoins.length > 0 && spectreHas30dOr1y) {
            _singlePageCache = { data: spectreCoins, _ts: Date.now() };
            _persistPage1(spectreCoins);
            if (allCoinsCache.data.length === 0) {
              allCoinsCache = { data: spectreCoins, _ts: Date.now() };
            }
            return spectreCoins.slice(0, perPage);
          }
        } else {
          // Lighter path: skip sparkline arrays end to end. Spectre first, then
          // the CG fallback below. Does NOT write the shared sparkline caches.
          const spectreCoinsLite = await getSpectreCoinsMarketsPage(1, 250, { sparkline: false }).catch(() => []);
          const liteHas30dOr1y = Array.isArray(spectreCoinsLite) && spectreCoinsLite.some((c) =>
            c?.price_change_percentage_30d_in_currency != null ||
            c?.price_change_percentage_1y_in_currency != null
          );
          if (Array.isArray(spectreCoinsLite) && spectreCoinsLite.length > 0 && liteHas30dOr1y) {
            return spectreCoinsLite.slice(0, perPage);
          }
        }
        // FALLBACK: direct CoinGecko via Express proxy (CG_API_KEY in env).
        // Shared inflight: collapse concurrent perPage variants to ONE CG fetch
        // (this is the 412KB call that was firing twice on home load). Only the
        // sparkline:true path uses + writes the shared inflight/cache; a
        // sparkline:false caller fetches the lighter payload independently.
        const sparklineParam = sparkline ? 'true' : 'false';
        if (sparkline) {
          if (!_page1CgInflight) {
            const url = `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=true&price_change_percentage=1h,24h,7d,30d,1y`;
            _page1CgInflight = fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
              .then(async (res) => {
                if (!res.ok) throw new Error(`API error: ${res.status}`);
                const data = await res.json();
                return Array.isArray(data) ? data : [];
              })
              .finally(() => { _page1CgInflight = null; });
          }
          const coins = filterRankedCoins(await _page1CgInflight);
          _singlePageCache = { data: coins, _ts: Date.now() };
          _persistPage1(coins);
          if (allCoinsCache.data.length === 0) {
            allCoinsCache = { data: coins, _ts: Date.now() };
          }
          return coins.slice(0, perPage);
        }
        const liteUrl = `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=${sparklineParam}&price_change_percentage=1h,24h,7d,30d,1y`;
        const liteRes = await fetch(liteUrl, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
        if (!liteRes.ok) throw new Error(`API error: ${liteRes.status}`);
        const liteData = await liteRes.json();
        return filterRankedCoins(Array.isArray(liteData) ? liteData : []).slice(0, perPage);
      } catch (err) {
        const spectreFallback = await getSpectreTopMarketsFallback(page, perPage);
        return spectreFallback || getTopCoinsFallback(page, perPage);
      } finally {
        delete _singlePageInflight[cacheKey];
      }
    })();
    _singlePageInflight[cacheKey] = promise;
    return promise;
  }

  try {
    // Fetch all 1000 coins (4 API calls), then paginate client-side
    const allCoins = await fetchAllTopCoins();

    const startIndex = (page - 1) * perPage;
    const endIndex = startIndex + perPage;
    return allCoins.slice(startIndex, endIndex);
  } catch (err) {
    // silently handled - using fallback
    // Return stale cache if available
    if (allCoinsCache.data.length > 0) {
      const startIndex = (page - 1) * perPage;
      const endIndex = startIndex + perPage;
      return allCoinsCache.data.slice(startIndex, endIndex);
    }
    const spectreFallback = await getSpectreTopMarketsFallback(page, perPage);
    if (spectreFallback) return spectreFallback;
    return getTopCoinsFallback(page, perPage);
  }
}

/**
 * Fallback data for when CoinGecko API is unavailable (rate limited, etc.)
 * Returns static mock data for top 1000 coins.
 * Also exported so pages can show it instantly before live data arrives.
 */
export function getTopCoinsFallbackData(page = 1, perPage = 25) {
  return getTopCoinsFallback(page, perPage);
}

function getTopCoinsFallback(page = 1, perPage = 25) {
  const TOP_1000_COINS = [
    { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', image: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png', current_price: 78450, market_cap: 1567000000000, market_cap_rank: 1, total_volume: 93890000000, price_change_percentage_24h: 1.74, price_change_percentage_1h_in_currency: 0.3, price_change_percentage_7d_in_currency: -11.0, price_change_percentage_30d_in_currency: -12.9 },
    { id: 'ethereum', symbol: 'eth', name: 'Ethereum', image: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', current_price: 2330, market_cap: 281680000000, market_cap_rank: 2, total_volume: 57720000000, price_change_percentage_24h: 0.65, price_change_percentage_1h_in_currency: 0.2, price_change_percentage_7d_in_currency: -20.5, price_change_percentage_30d_in_currency: -25.1 },
    { id: 'tether', symbol: 'usdt', name: 'Tether', image: 'https://assets.coingecko.com/coins/images/325/small/Tether.png', current_price: 0.9992, market_cap: 185210000000, market_cap_rank: 3, total_volume: 159370000000, price_change_percentage_24h: 0.03, price_change_percentage_1h_in_currency: 0.01, price_change_percentage_7d_in_currency: 0.02, price_change_percentage_30d_in_currency: -0.03 },
    { id: 'binancecoin', symbol: 'bnb', name: 'BNB', image: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png', current_price: 770.63, market_cap: 105090000000, market_cap_rank: 4, total_volume: 2590000000, price_change_percentage_24h: 1.86, price_change_percentage_1h_in_currency: 0.4, price_change_percentage_7d_in_currency: -12.2, price_change_percentage_30d_in_currency: -12.1 },
    { id: 'ripple', symbol: 'xrp', name: 'XRP', image: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png', current_price: 1.63, market_cap: 98970000000, market_cap_rank: 5, total_volume: 5510000000, price_change_percentage_24h: 2.29, price_change_percentage_1h_in_currency: 0.5, price_change_percentage_7d_in_currency: -14.6, price_change_percentage_30d_in_currency: -18.9 },
    { id: 'solana', symbol: 'sol', name: 'Solana', image: 'https://assets.coingecko.com/coins/images/4128/small/solana.png', current_price: 103.90, market_cap: 58830000000, market_cap_rank: 6, total_volume: 7280000000, price_change_percentage_24h: 2.42, price_change_percentage_1h_in_currency: 0.6, price_change_percentage_7d_in_currency: -18.3, price_change_percentage_30d_in_currency: -22.4 },
    { id: 'usd-coin', symbol: 'usdc', name: 'USDC', image: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png', current_price: 1.00, market_cap: 56780000000, market_cap_rank: 7, total_volume: 12340000000, price_change_percentage_24h: 0.01, price_change_percentage_1h_in_currency: 0.0, price_change_percentage_7d_in_currency: 0.01, price_change_percentage_30d_in_currency: 0.0 },
    { id: 'cardano', symbol: 'ada', name: 'Cardano', image: 'https://assets.coingecko.com/coins/images/975/small/cardano.png', current_price: 0.52, market_cap: 19230000000, market_cap_rank: 8, total_volume: 1120000000, price_change_percentage_24h: 1.8, price_change_percentage_1h_in_currency: 0.3, price_change_percentage_7d_in_currency: -15.2, price_change_percentage_30d_in_currency: -20.1 },
    { id: 'dogecoin', symbol: 'doge', name: 'Dogecoin', image: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png', current_price: 0.17, market_cap: 25120000000, market_cap_rank: 9, total_volume: 2890000000, price_change_percentage_24h: 3.1, price_change_percentage_1h_in_currency: 0.7, price_change_percentage_7d_in_currency: -22.4, price_change_percentage_30d_in_currency: -28.3 },
    { id: 'avalanche-2', symbol: 'avax', name: 'Avalanche', image: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png', current_price: 10.13, market_cap: 4320000000, market_cap_rank: 10, total_volume: 456000000, price_change_percentage_24h: 2.59, price_change_percentage_1h_in_currency: 0.5, price_change_percentage_7d_in_currency: -17.8, price_change_percentage_30d_in_currency: -24.6 },
    { id: 'chainlink', symbol: 'link', name: 'Chainlink', image: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png', current_price: 9.79, market_cap: 6450000000, market_cap_rank: 11, total_volume: 678000000, price_change_percentage_24h: 2.82, price_change_percentage_1h_in_currency: 0.4, price_change_percentage_7d_in_currency: -16.5, price_change_percentage_30d_in_currency: -21.2 },
    { id: 'uniswap', symbol: 'uni', name: 'Uniswap', image: 'https://assets.coingecko.com/coins/images/12504/small/uni.jpg', current_price: 3.92, market_cap: 2890000000, market_cap_rank: 12, total_volume: 234000000, price_change_percentage_24h: 1.72, price_change_percentage_1h_in_currency: 0.3, price_change_percentage_7d_in_currency: -19.3, price_change_percentage_30d_in_currency: -25.8 },
    { id: 'polkadot', symbol: 'dot', name: 'Polkadot', image: 'https://assets.coingecko.com/coins/images/12171/small/polkadot.png', current_price: 3.45, market_cap: 5670000000, market_cap_rank: 13, total_volume: 345000000, price_change_percentage_24h: 1.5, price_change_percentage_1h_in_currency: 0.2, price_change_percentage_7d_in_currency: -14.8, price_change_percentage_30d_in_currency: -19.7 },
    { id: 'litecoin', symbol: 'ltc', name: 'Litecoin', image: 'https://assets.coingecko.com/coins/images/2/small/litecoin.png', current_price: 72.50, market_cap: 5430000000, market_cap_rank: 14, total_volume: 567000000, price_change_percentage_24h: 2.1, price_change_percentage_1h_in_currency: 0.4, price_change_percentage_7d_in_currency: -13.2, price_change_percentage_30d_in_currency: -17.5 },
    { id: 'cosmos', symbol: 'atom', name: 'Cosmos', image: 'https://assets.coingecko.com/coins/images/1481/small/cosmos_hub.png', current_price: 4.12, market_cap: 1780000000, market_cap_rank: 15, total_volume: 189000000, price_change_percentage_24h: 1.9, price_change_percentage_1h_in_currency: 0.3, price_change_percentage_7d_in_currency: -15.6, price_change_percentage_30d_in_currency: -21.3 },
    { id: 'arbitrum', symbol: 'arb', name: 'Arbitrum', image: 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg', current_price: 0.1375, market_cap: 1234000000, market_cap_rank: 16, total_volume: 156000000, price_change_percentage_24h: 0.33, price_change_percentage_1h_in_currency: 0.1, price_change_percentage_7d_in_currency: -18.9, price_change_percentage_30d_in_currency: -24.5 },
    { id: 'optimism', symbol: 'op', name: 'Optimism', image: 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png', current_price: 0.2294, market_cap: 987000000, market_cap_rank: 17, total_volume: 123000000, price_change_percentage_24h: 0.68, price_change_percentage_1h_in_currency: 0.2, price_change_percentage_7d_in_currency: -17.2, price_change_percentage_30d_in_currency: -22.8 },
    { id: 'matic-network', symbol: 'matic', name: 'Polygon', image: 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png', current_price: 0.18, market_cap: 1890000000, market_cap_rank: 18, total_volume: 234000000, price_change_percentage_24h: 1.2, price_change_percentage_1h_in_currency: 0.2, price_change_percentage_7d_in_currency: -16.4, price_change_percentage_30d_in_currency: -21.9 },
    { id: 'near', symbol: 'near', name: 'NEAR Protocol', image: 'https://assets.coingecko.com/coins/images/10365/small/near.jpg', current_price: 1.85, market_cap: 2340000000, market_cap_rank: 19, total_volume: 278000000, price_change_percentage_24h: 2.4, price_change_percentage_1h_in_currency: 0.5, price_change_percentage_7d_in_currency: -19.8, price_change_percentage_30d_in_currency: -26.2 },
    { id: 'aptos', symbol: 'apt', name: 'Aptos', image: 'https://assets.coingecko.com/coins/images/26455/small/aptos_round.png', current_price: 3.67, market_cap: 2120000000, market_cap_rank: 20, total_volume: 167000000, price_change_percentage_24h: 1.8, price_change_percentage_1h_in_currency: 0.3, price_change_percentage_7d_in_currency: -15.3, price_change_percentage_30d_in_currency: -20.7 },
    { id: 'sui', symbol: 'sui', name: 'Sui', image: 'https://assets.coingecko.com/coins/images/26375/small/sui_asset.jpeg', current_price: 1.42, market_cap: 4560000000, market_cap_rank: 21, total_volume: 534000000, price_change_percentage_24h: 3.2, price_change_percentage_1h_in_currency: 0.6, price_change_percentage_7d_in_currency: -21.4, price_change_percentage_30d_in_currency: -27.8 },
    { id: 'injective-protocol', symbol: 'inj', name: 'Injective', image: 'https://assets.coingecko.com/coins/images/12882/small/Secondary_Symbol.png', current_price: 7.23, market_cap: 756000000, market_cap_rank: 22, total_volume: 89000000, price_change_percentage_24h: 2.1, price_change_percentage_1h_in_currency: 0.4, price_change_percentage_7d_in_currency: -17.6, price_change_percentage_30d_in_currency: -23.4 },
    { id: 'render-token', symbol: 'rndr', name: 'Render', image: 'https://assets.coingecko.com/coins/images/11636/small/rndr.png', current_price: 2.45, market_cap: 1340000000, market_cap_rank: 23, total_volume: 145000000, price_change_percentage_24h: 2.8, price_change_percentage_1h_in_currency: 0.5, price_change_percentage_7d_in_currency: -20.2, price_change_percentage_30d_in_currency: -26.5 },
    { id: 'fetch-ai', symbol: 'fet', name: 'Fetch.ai', image: 'https://assets.coingecko.com/coins/images/5681/small/Fetch.jpg', current_price: 0.38, market_cap: 978000000, market_cap_rank: 24, total_volume: 112000000, price_change_percentage_24h: 3.5, price_change_percentage_1h_in_currency: 0.7, price_change_percentage_7d_in_currency: -22.8, price_change_percentage_30d_in_currency: -29.3 },
    { id: 'pepe', symbol: 'pepe', name: 'Pepe', image: 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg', current_price: 0.0000045, market_cap: 1890000000, market_cap_rank: 25, total_volume: 456000000, price_change_percentage_24h: 4.2, price_change_percentage_1h_in_currency: 0.9, price_change_percentage_7d_in_currency: -25.3, price_change_percentage_30d_in_currency: -32.1 },
  ];

  // 2026-05-26 beta-quality fix: removed synthetic page 2-1000 generator that
  // fabricated "Coin 26"..."Coin 1000" rows with Math.random() prices. Those
  // rows displayed nonsense like "C47 · $0.001 · +3.42%" while live data was
  // loading. Real fallback is the top 25 only; pages 2+ return [] so callers
  // render the empty/skeleton state instead of garbage.
  for (const coin of TOP_1000_COINS) {
    coin.image = localTokenIcon(coin.symbol || coin.name);
  }
  if (page > 1) return [];
  return TOP_1000_COINS.slice(0, perPage);
}

/**
 * Fetch prices for major tokens from CoinGecko
 * Returns: { BTC: { price, change, change1h, change7d, change30d, change1y, volume, marketCap, liquidity }, ... }
 */
export async function getMajorTokenPrices(symbols) {
  if (!symbols || symbols.length === 0) return {};

  // Check cache
  const now = Date.now();
  const allCached = symbols.every(s => {
    const key = s.toUpperCase();
    return priceCache[key] && (now - lastFetchTime < CACHE_TTL);
  });
  
  if (allCached) {
    const result = {};
    symbols.forEach(s => {
      const key = s.toUpperCase();
      if (priceCache[key]) result[key] = priceCache[key];
    });
    return result;
  }

  // Get CoinGecko IDs for requested symbols
  const ids = [];
  const symbolToId = {};
  symbols.forEach(s => {
    const key = s.toUpperCase();
    const id = SYMBOL_TO_COINGECKO_ID[key];
    if (id) {
      ids.push(id);
      symbolToId[id] = key;
    }
  });

  if (ids.length === 0) {
    // Return stablecoins
    const result = {};
    symbols.forEach(s => {
      const key = s.toUpperCase();
      if (key === 'USDT' || key === 'USDC') {
        result[key] = { price: 1, change: 0, volume: 0, marketCap: 0 };
      }
    });
    return result;
  }

  try {
    // Pull both sources in parallel. Spectre carries enrichment (rank, social,
    // scores) but its /v1/prices cache has been observed serving month-old
    // snapshots for individual tokens (SPECTRE was stuck at 2026-04-07). CG
    // /coins/markets is the canonical sub-minute source; we use it to OVERRIDE
    // the price/mcap/volume/change fields whenever it has fresh data, while
    // keeping any extra enrichment from Spectre.
    const cgUrl = `${COINGECKO_API}/coins/markets?vs_currency=usd&ids=${ids.join(',')}&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d,30d,1y`;
    const [spectrePrices, cgRes] = await Promise.all([
      getSpectrePricesBySymbols(symbols).catch(() => ({})),
      // Timeout: Promise.all waits on BOTH legs, so a hung CG fetch blocked
      // the whole price map even when Spectre had already answered
      fetch(cgUrl, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }).catch(() => null),
    ]);

    const cgData = cgRes && cgRes.ok ? await cgRes.json().catch(() => null) : null;
    const cgBySymbol = {};
    if (Array.isArray(cgData)) {
      for (const coin of cgData) {
        const sym = symbolToId[coin.id];
        if (!sym) continue;
        cgBySymbol[sym] = {
          price: coin.current_price || 0,
          change: coin.price_change_percentage_24h || 0,
          change1h: coin.price_change_percentage_1h_in_currency || 0,
          change7d: coin.price_change_percentage_7d_in_currency || 0,
          change30d: coin.price_change_percentage_30d_in_currency || 0,
          change1y: coin.price_change_percentage_1y_in_currency || 0,
          volume: coin.total_volume || 0,
          marketCap: coin.market_cap || 0,
          liquidity: coin.total_volume || 0,
          logo: COINGECKO_LOGOS[sym] || coin.image,
          rank: coin.market_cap_rank,
          sparkline_7d: Array.isArray(coin.sparkline_in_7d?.price) ? coin.sparkline_in_7d.price : null,
        };
      }
    }

    // Merge: Spectre enrichment as base, CG live data overrides price-relevant
    // fields. If a symbol has only Spectre data (CG missed it), keep Spectre
    // verbatim. If CG-only, return CG. If both, prefer CG for prices.
    if (Object.keys(spectrePrices || {}).length > 0 || Object.keys(cgBySymbol).length > 0) {
      const result = {};
      const allSymbols = new Set([...Object.keys(spectrePrices || {}), ...Object.keys(cgBySymbol)]);
      for (const sym of allSymbols) {
        const sp = spectrePrices?.[sym];
        const cg = cgBySymbol[sym];
        if (cg && sp) {
          result[sym] = { ...sp, ...cg }; // CG wins on overlapping price fields
        } else {
          result[sym] = cg || sp;
        }
      }
      symbols.forEach(s => {
        const key = s.toUpperCase();
        if (key === 'USDT' || key === 'USDC') {
          result[key] = result[key] || { price: 1, change: 0, volume: 0, marketCap: 0, logo: COINGECKO_LOGOS[key] };
        }
      });
      priceCache = { ...priceCache, ...result };
      lastFetchTime = now;
      return result;
    }

    // Both sources empty — fall through to legacy CG fetch path below
    const url = `${COINGECKO_API}/coins/markets?vs_currency=usd&ids=${ids.join(',')}&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d,30d,1y`;
    
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      // This branch runs when both fast sources already failed, i.e. when
      // upstream is degraded and a hang is most likely - cap it like the
      // sibling path above does
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      // silently handled
      return priceCache; // Return cached data on error
    }

    const data = await res.json();
    
    if (!Array.isArray(data)) {
      // silently handled
      return priceCache;
    }

    const result = {};
    
    data.forEach(coin => {
      const symbol = symbolToId[coin.id];
      if (!symbol) return;

      result[symbol] = {
        price: coin.current_price || 0,
        change: coin.price_change_percentage_24h || 0,
        change1h: coin.price_change_percentage_1h_in_currency || 0,
        change7d: coin.price_change_percentage_7d_in_currency || 0,
        change30d: coin.price_change_percentage_30d_in_currency || 0,
        change1y: coin.price_change_percentage_1y_in_currency || 0,
        volume: coin.total_volume || 0,
        marketCap: coin.market_cap || 0,
        liquidity: coin.total_volume || 0, // Use volume as liquidity proxy
        logo: COINGECKO_LOGOS[symbol] || coin.image,
        rank: coin.market_cap_rank,
        sparkline_7d: Array.isArray(coin.sparkline_in_7d?.price) ? coin.sparkline_in_7d.price : null,
      };
    });

    // Handle stablecoins
    symbols.forEach(s => {
      const key = s.toUpperCase();
      if (key === 'USDT' || key === 'USDC') {
        result[key] = { price: 1, change: 0, volume: 0, marketCap: 0, logo: COINGECKO_LOGOS[key] };
      }
    });

    // Update cache
    priceCache = { ...priceCache, ...result };
    lastFetchTime = now;

    return result;
  } catch (err) {
    console.error('CoinGecko fetch failed:', err);
    return priceCache; // Return cached data on error
  }
}

/**
 * Fetch prices from CoinGecko for an arbitrary symbol -> cgId mapping.
 * Used when the symbol isn't in SYMBOL_TO_COINGECKO_ID and was resolved
 * dynamically via /api/token/resolve.
 * Returns: { [SYMBOL]: { price, change, marketCap, ... } }
 *
 * Cached + in-flight-deduped (60s) by the sorted id set: the x-bubbles
 * enrichment calls this with ~200 ids on every load/refresh/ranking-switch,
 * and it previously re-fetched from scratch each time.
 */
const _cgSymPricesCache = new Map()      // sortedIds -> { ts, data }
const _cgSymPricesInflight = new Map()   // sortedIds -> Promise
const CG_SYM_PRICES_TTL = 60_000

export async function getCoinGeckoPricesForSymbols(symbolToCgId) {
  const entries = Object.entries(symbolToCgId || {}).filter(([s, id]) => s && id)
  if (entries.length === 0) return {}

  const ids = entries.map(([, id]) => id)
  const cacheKey = [...ids].sort().join(',')
  const cached = _cgSymPricesCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CG_SYM_PRICES_TTL) return cached.data
  const pending = _cgSymPricesInflight.get(cacheKey)
  if (pending) return pending

  const idToSymbol = {}
  for (const [sym, id] of entries) idToSymbol[id] = sym.toUpperCase()

  const run = (async () => {
    try {
    // Same override pattern as getMajorTokenPrices: parallel fetch Spectre +
    // CG, prefer CG for price/mcap/volume/change so a stale Spectre /v1/prices
    // cache can't poison the watchlist (e.g. SPECTRE stuck at 2026-04-07).
    const cgUrl = `${COINGECKO_API}/coins/markets?vs_currency=usd&ids=${ids.join(',')}&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d,30d,1y`
    const [spectrePrices, cgRes] = await Promise.all([
      getSpectrePricesBySymbols(entries.map(([sym]) => sym)).catch(() => ({})),
      fetch(cgUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) }).catch(() => null),
    ])

    const data = cgRes && cgRes.ok ? await cgRes.json().catch(() => null) : null
    if (!Array.isArray(data) && Object.keys(spectrePrices || {}).length === 0) return {}

    const cgBySymbol = {}
    if (Array.isArray(data)) {
      for (const coin of data) {
        const symbol = idToSymbol[coin.id]
        if (!symbol) continue
        cgBySymbol[symbol] = {
          price: coin.current_price || 0,
          change: coin.price_change_percentage_24h || 0,
          change1h: coin.price_change_percentage_1h_in_currency || 0,
          change7d: coin.price_change_percentage_7d_in_currency || 0,
          change30d: coin.price_change_percentage_30d_in_currency || 0,
          change1y: coin.price_change_percentage_1y_in_currency || 0,
          volume: coin.total_volume || 0,
          marketCap: coin.market_cap || 0,
          liquidity: coin.total_volume || 0,
          logo: coin.image || null,
          rank: coin.market_cap_rank,
          sparkline_7d: Array.isArray(coin.sparkline_in_7d?.price) ? coin.sparkline_in_7d.price : null,
        }
      }
    }

    const result = {}
    const allSyms = new Set([...Object.keys(spectrePrices || {}), ...Object.keys(cgBySymbol)])
    for (const sym of allSyms) {
      const sp = spectrePrices?.[sym]
      const cg = cgBySymbol[sym]
      if (cg && sp) result[sym] = { ...sp, ...cg }
      else result[sym] = cg || sp
    }
    return result
    } catch (err) {
      console.error('getCoinGeckoPricesForSymbols failed:', err?.message || err)
      return {}
    } finally {
      _cgSymPricesInflight.delete(cacheKey)
    }
  })()

  _cgSymPricesInflight.set(cacheKey, run)
  const data = await run
  // Only cache non-empty results so a transient failure can retry next call.
  if (data && Object.keys(data).length) _cgSymPricesCache.set(cacheKey, { ts: Date.now(), data })
  return data
}

// networkId -> CoinGecko asset platform slug. Mirrors
// CG_PLATFORM_TO_NETWORK_ID in packages/server/index.js.
const NETWORK_ID_TO_CG_PLATFORM = {
  1: 'ethereum',
  56: 'binance-smart-chain',
  137: 'polygon-pos',
  43114: 'avalanche',
  42161: 'arbitrum-one',
  10: 'optimistic-ethereum',
  8453: 'base',
  1399811149: 'solana',
  4663: 'robinhood', // Robinhood Chain (Arbitrum Orbit L2)
};

// Session cache: addressLower -> { change7d, change30d, change1y, sparkline_7d } | null
// Long-window % don't move minute-to-minute; cache for the whole tab life.
const _contractLongWindowCache = new Map();
const _contractLongWindowInflight = new Map();

/**
 * Fetch 7d/30d/1y % changes for on-chain tokens by contract address via CG.
 *
 * Why this exists: the on-chain watchlist branch in useWatchlistPrices.js
 * relies on Codex `filterTokens` for change windows, but Codex only returns
 * change1/4/12/24 — no 7d/30d/1y. That left those columns blank for any
 * watchlist row pinned by address (DexScreener imports, on-chain search).
 *
 * Returns Map<addressLower, { change7d, change30d, change1y, sparkline_7d } | null>.
 * null entries are NOT cached — transient CG failures should be retried next refresh.
 *
 * @param {Array<{ address: string, networkId: number }>} tokens
 * @returns {Promise<Map<string, object|null>>}
 */
export async function getCoinGeckoLongWindowsByContracts(tokens) {
  const out = new Map();
  if (!Array.isArray(tokens) || tokens.length === 0) return out;

  const todo = [];
  for (const t of tokens) {
    if (!t?.address) continue;
    const addrKey = String(t.address).toLowerCase();
    const platform = NETWORK_ID_TO_CG_PLATFORM[t.networkId || 1];
    if (!platform) continue;
    if (_contractLongWindowCache.has(addrKey)) {
      out.set(addrKey, _contractLongWindowCache.get(addrKey));
      continue;
    }
    todo.push({ addrKey, address: t.address, platform });
  }
  if (todo.length === 0) return out;

  await Promise.all(todo.map(async ({ addrKey, address, platform }) => {
    if (_contractLongWindowInflight.has(addrKey)) {
      const res = await _contractLongWindowInflight.get(addrKey);
      if (res) out.set(addrKey, res);
      return;
    }
    const promise = (async () => {
      try {
        const url = `${COINGECKO_API}/coins/${encodeURIComponent(platform)}/contract/${encodeURIComponent(address)}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=true`;
        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        const md = data?.market_data;
        if (!md) return null;
        const sparkline = Array.isArray(md.sparkline_7d?.price) ? md.sparkline_7d.price : null;
        const c7 = md.price_change_percentage_7d_in_currency?.usd ?? md.price_change_percentage_7d ?? null;
        const c30 = md.price_change_percentage_30d_in_currency?.usd ?? md.price_change_percentage_30d ?? null;
        const c1y = md.price_change_percentage_1y_in_currency?.usd ?? md.price_change_percentage_1y ?? null;
        if (c7 == null && c30 == null && c1y == null && !sparkline) return null;
        return {
          change7d: c7 != null ? Number(c7) : null,
          change30d: c30 != null ? Number(c30) : null,
          change1y: c1y != null ? Number(c1y) : null,
          sparkline_7d: sparkline,
        };
      } catch (_) {
        return null;
      }
    })();
    _contractLongWindowInflight.set(addrKey, promise);
    const result = await promise;
    _contractLongWindowInflight.delete(addrKey);
    if (result) {
      _contractLongWindowCache.set(addrKey, result);
      out.set(addrKey, result);
    }
  }));

  return out;
}

/**
 * Search for major tokens by symbol/name
 * Returns instant results for known major tokens
 */
export function searchMajorTokens(query) {
  if (!query || query.length < 1) return [];

  const q = query.toUpperCase().trim();
  // Also support searching with spaces removed (e.g., "spectreai" matches "Spectre AI")
  const qNoSpaces = q.replace(/\s+/g, '');
  const results = [];

  Object.entries(MAJOR_TOKEN_INFO).forEach(([symbol, info]) => {
    const nameUpper = info.name.toUpperCase();
    const nameNoSpaces = nameUpper.replace(/\s+/g, '');

    if (
      symbol.includes(q) ||
      nameUpper.includes(q) ||
      // Also match without spaces (e.g., "spectreai" matches "SPECTRE AI")
      (qNoSpaces.length >= 3 && (nameNoSpaces.includes(qNoSpaces) || symbol.includes(qNoSpaces)))
    ) {
      results.push({
        symbol: info.symbol,
        name: info.name,
        network: info.network,
        networkId: info.networkId,
        address: info.address || null, // Include address if available (for tokens like SPECTRE)
        logo: COINGECKO_LOGOS[symbol],
        isMajor: true,
      });
    }
  });

  return results.slice(0, 10);
}

/**
 * Get full token data for a major token (for search results)
 */
export async function getMajorTokenData(symbol) {
  const key = symbol.toUpperCase();
  const info = MAJOR_TOKEN_INFO[key];
  if (!info) return null;

  const prices = await getMajorTokenPrices([key]);
  const priceData = prices[key] || {};

  return {
    symbol: info.symbol,
    name: info.name,
    network: info.network,
    networkId: info.networkId,
    logo: COINGECKO_LOGOS[key],
    price: priceData.price || 0,
    change: priceData.change || 0,
    change1h: priceData.change1h || 0,
    change7d: priceData.change7d || 0,
    change30d: priceData.change30d || 0,
    change1y: priceData.change1y || 0,
    volume: priceData.volume || 0,
    marketCap: priceData.marketCap || 0,
    liquidity: priceData.liquidity || 0,
    isMajor: true,
  };
}

/** Cache for coin details (About section) */
let detailsCache = {};
const detailsInflight = {};

// Persistent localStorage cache — descriptions barely change, so a 24h TTL
// means the Research Zone Project tab paints instantly on repeat visits
// instead of waiting for /v1/profiles + /api/coingecko/coins/{id}.
const PERSIST_DETAILS_KEY = 'spectre-coin-details-v1';
const PERSIST_DETAILS_TTL = 24 * 60 * 60 * 1000; // 24h

function _loadPersistedDetails(id) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${PERSIST_DETAILS_KEY}:${id}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed._ts !== 'number') return null;
    if (Date.now() - parsed._ts > PERSIST_DETAILS_TTL) return null;
    const { _ts, ...rest } = parsed;
    return rest;
  } catch { return null; }
}

function _persistDetails(id, result) {
  if (typeof window === 'undefined' || !id) return;
  try {
    window.localStorage.setItem(
      `${PERSIST_DETAILS_KEY}:${id}`,
      JSON.stringify({ ...result, _ts: Date.now() })
    );
  } catch { /* quota exceeded — silently ignore */ }
}

// Quick detector for the synthetic placeholder so we know to fetch the real
// CoinGecko description instead of caching the placeholder.
function _isPlaceholderDescription(desc) {
  return !desc || /tracked with live Spectre market data.*pending from the backend profile bridge/i.test(desc);
}
const DETAILS_CACHE_TTL = 5 * 60 * 1000; // 5 min

/**
 * Get coin details (description, links, categories) for About section.
 * Works for ANY token - resolves CoinGecko ID from majorTokens mapping or allCoinsCache.
 * @param {string} symbol - e.g. 'BTC', 'ETH', 'HYPE'
 * @param {string} [coingeckoId] - optional CoinGecko ID override (avoids lookup)
 * @returns {Promise<{ description: string, links: object, categories?: string[] } | null>}
 */
export async function getCoinDetails(symbol, coingeckoId) {
  let id = coingeckoId || SYMBOL_TO_COINGECKO_ID[symbol?.toUpperCase()];
  // If not in the mapping, try to find it from the allCoinsCache
  if (!id) {
    const sym = (symbol || '').toUpperCase();
    if (allCoinsCache.data.length > 0) {
      const coin = allCoinsCache.data.find(c => (c.symbol || '').toUpperCase() === sym);
      if (coin?.id) id = coin.id;
    }
  }
  // Fallback: resolve via CoinGecko search (for exotic tokens not in top 1000)
  if (!id) {
    id = await resolveCoinGeckoId(symbol);
  }
  if (!id) return null;
  const now = Date.now();
  if (detailsCache[id] && (now - (detailsCache[id]._ts || 0)) < DETAILS_CACHE_TTL) {
    const { _ts, ...rest } = detailsCache[id];
    return rest;
  }
  // Persistent cache hit — return instantly, no network call. Survives reload.
  const persisted = _loadPersistedDetails(id);
  if (persisted && !_isPlaceholderDescription(persisted.description)) {
    detailsCache[id] = { ...persisted, _ts: Date.now() };
    return persisted;
  }
  // Deduplicate concurrent requests for the same coin
  if (detailsInflight[id]) return detailsInflight[id];
  const promise = (async () => {
    try {
      const spectreProfile = await getSpectreTokenProfile(symbol).catch(() => null);
      if (spectreProfile) {
        const links = spectreProfile.links || {};
        const market = spectreProfile.market || {};
        const price = spectreProfile.price || {};
        const fallback = fallbackCoinDetails(symbol, spectreProfile.name || id);
        const result = {
          description: spectreProfile.description || fallback.description,
          links: {
            homepage: links.homepage || links.website || null,
            twitter: links.twitter || links.x || null,
            reddit: links.reddit || null,
            explorer: links.explorer || null,
            github: links.github || null,
            telegram: links.telegram || null,
            discord: links.discord || null,
            medium: links.medium || null,
          },
          categories: Array.isArray(spectreProfile.categories) && spectreProfile.categories.length
            ? spectreProfile.categories.filter(Boolean)
            : fallback.categories,
          genesisDate: spectreProfile.genesis_date || null,
          platforms: spectreProfile.platforms || {},
          scores: {
            coingecko: spectreProfile.scores?.coingecko ?? null,
            community: spectreProfile.scores?.community ?? null,
            developer: spectreProfile.scores?.developer ?? null,
            liquidity: spectreProfile.scores?.liquidity ?? null,
          },
          communityData: {
            twitterFollowers: spectreProfile.social?.twitter_followers ?? null,
            redditSubscribers: spectreProfile.social?.reddit_subscribers ?? null,
            telegramMembers: spectreProfile.social?.telegram_members ?? null,
          },
          developerData: {
            stars: spectreProfile.developer?.github_stars ?? spectreProfile.social?.github_stars ?? null,
            forks: spectreProfile.developer?.forks ?? null,
            subscribers: spectreProfile.developer?.subscribers ?? null,
            totalIssues: spectreProfile.developer?.total_issues ?? null,
            codeChanges4w: spectreProfile.developer?.code_changes_4w ?? null,
          },
          marketCapRank: spectreProfile.rank ?? null,
          marketData: {
            price: price.usd ?? null,
            mcap: market.market_cap ?? null,
            fdv: market.fully_diluted_valuation ?? null,
            volume24h: market.volume_24h ?? null,
            change24h: price.change_24h ?? null,
            change1h: price.change_1h ?? null,
            change7d: price.change_7d ?? null,
            change30d: price.change_30d ?? null,
            high24h: price.high_24h ?? null,
            low24h: price.low_24h ?? null,
            circulatingSupply: spectreProfile.supply?.circulating ?? null,
            totalSupply: spectreProfile.supply?.total ?? null,
            ath: price.ath?.price ?? null,
            athDate: price.ath?.date ?? null,
            athChangePct: price.ath?.change_pct ?? null,
            atl: price.atl?.price ?? null,
            atlDate: price.atl?.date ?? null,
            atlChangePct: price.atl?.change_pct ?? null,
          },
          image: spectreProfile.image_small || spectreProfile.image || null,
          _source: 'spectre-market',
        };
        // If the Spectre profile bridge didn't yield a real description (low-cap
        // tokens often fall through to the placeholder), pull it directly from
        // CoinGecko via the /api/coingecko proxy. This works in BOTH dev and
        // prod since the proxy is configured in vite.config.js + vercel.json.
        if (_isPlaceholderDescription(result.description)) {
          try {
            const cgRes = await fetch(`${COINGECKO_API}/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`, {
              method: 'GET', headers: { Accept: 'application/json' },
            });
            if (cgRes.ok) {
              const cgData = await cgRes.json();
              const realDesc = (cgData?.description?.en || '').replace(/<[^>]+>/g, '').trim();
              if (realDesc) {
                result.description = realDesc.slice(0, 1800) + (realDesc.length > 1800 ? '…' : '');
              }
              // Merge any links / categories CG has but Spectre didn't surface.
              const cgLinks = cgData?.links || {};
              if (cgLinks.homepage?.[0] && !result.links.homepage) result.links.homepage = cgLinks.homepage[0];
              if (cgLinks.twitter_screen_name && !result.links.twitter) result.links.twitter = `https://twitter.com/${cgLinks.twitter_screen_name}`;
              if (cgLinks.repos_url?.github?.[0] && !result.links.github) result.links.github = cgLinks.repos_url.github[0];
              if (cgLinks.telegram_channel_identifier && !result.links.telegram) result.links.telegram = `https://t.me/${cgLinks.telegram_channel_identifier}`;
              if (cgLinks.subreddit_url && !result.links.reddit) result.links.reddit = cgLinks.subreddit_url;
              if (Array.isArray(cgData?.categories) && (!result.categories || result.categories.length === 0)) {
                result.categories = cgData.categories.filter(Boolean);
              }
            }
          } catch { /* network/timeout — keep Spectre fallback */ }
        }
        detailsCache[id] = { ...result, _ts: Date.now() };
        if (!_isPlaceholderDescription(result.description)) _persistDetails(id, result);
        return result;
      }

      if (import.meta.env.DEV) {
        // Dev mode: previously short-circuited to fallback so we didn't burn
        // CoinGecko quota on every reload. Route through the /api/coingecko
        // proxy (Express cache wins) so the Project tab gets real data.
        // Falls through to the same fetch as prod below — guard removed.
      }

      const url = `${COINGECKO_API}/coins/${id}?localization=false&tickers=false&community_data=true&developer_data=true`;
      const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!res.ok) return detailsCache[id] ? (() => { const { _ts, ...r } = detailsCache[id]; return r; })() : null;
      const data = await res.json();
      const description = (data.description && data.description.en)
        ? data.description.en.replace(/<[^>]+>/g, '').slice(0, 600) + (data.description.en.length > 600 ? '…' : '')
        : '';
      const links = {
        homepage: data.links?.homepage?.[0] || null,
        twitter: data.links?.twitter_screen_name ? `https://twitter.com/${data.links.twitter_screen_name}` : null,
        reddit: data.links?.subreddit_url || null,
        explorer: data.links?.blockchain_explorer?.[0] || null,
        github: data.links?.repos_url?.github?.[0] || null,
        telegram: data.links?.telegram_channel_identifier ? `https://t.me/${data.links.telegram_channel_identifier}` : null,
        discord: data.links?.chat_url?.find(u => u && u.includes('discord')) || null,
        medium: data.links?.chat_url?.find(u => u && u.includes('medium.com')) || null,
      };
      const categories = Array.isArray(data.categories) ? data.categories.filter(Boolean) : [];
      const genesisDate = data.genesis_date || null;
      const platforms = data.platforms && typeof data.platforms === 'object' ? data.platforms : {};
      const scores = {
        coingecko: data.coingecko_score ?? null,
        community: data.community_score ?? null,
        developer: data.developer_score ?? null,
        liquidity: data.liquidity_score ?? null,
      };
      const communityData = {
        twitterFollowers: data.community_data?.twitter_followers ?? null,
        redditSubscribers: data.community_data?.reddit_subscribers ?? null,
        telegramMembers: data.community_data?.telegram_channel_user_count ?? null,
      };
      const developerData = {
        stars: data.developer_data?.stars ?? null,
        forks: data.developer_data?.forks ?? null,
        subscribers: data.developer_data?.subscribers ?? null,
        totalIssues: data.developer_data?.total_issues ?? null,
        codeChanges4w: data.developer_data?.code_additions_deletions_4_weeks ?? null,
      };
      const marketCapRank = data.market_cap_rank ?? null;
      // Extract market_data fields (available from /coins/{id} for ANY token, even outside top 1000)
      const md = data.market_data || {};
      const marketData = {
        price: md.current_price?.usd ?? null,
        mcap: md.market_cap?.usd ?? null,
        fdv: md.fully_diluted_valuation?.usd ?? null,
        volume24h: md.total_volume?.usd ?? null,
        change24h: md.price_change_percentage_24h ?? null,
        change1h: md.price_change_percentage_1h_in_currency?.usd ?? null,
        change7d: md.price_change_percentage_7d ?? null,
        change30d: md.price_change_percentage_30d ?? null,
        high24h: md.high_24h?.usd ?? null,
        low24h: md.low_24h?.usd ?? null,
        circulatingSupply: md.circulating_supply ?? null,
        totalSupply: md.total_supply ?? null,
        ath: md.ath?.usd ?? null,
        athDate: md.ath_date?.usd ?? null,
        athChangePct: md.ath_change_percentage?.usd ?? null,
        atl: md.atl?.usd ?? null,
        atlDate: md.atl_date?.usd ?? null,
        atlChangePct: md.atl_change_percentage?.usd ?? null,
      };
      const image = data.image?.small || data.image?.thumb || null;
      const result = { description, links, categories, genesisDate, platforms, scores, communityData, developerData, marketCapRank, marketData, image };
      detailsCache[id] = { ...result, _ts: Date.now() };
      if (!_isPlaceholderDescription(result.description)) _persistDetails(id, result);
      return result;
    } catch (err) {
      // silently handled
      return detailsCache[id] ? (() => { const { _ts, ...r } = detailsCache[id]; return r; })() : null;
    } finally {
      delete detailsInflight[id];
    }
  })();
  detailsInflight[id] = promise;
  return promise;
}

/**
 * Search coins for ROI calculator (CoinGecko search)
 * @param {string} q - search query
 * @returns {Promise<Array<{ id: string, symbol: string, name: string }>>}
 */
// ROI search: query->result LRU (60s TTL, small cap) + inflight dedup keyed by
// normalized query. Called per keystroke from 2 components (search input +
// compare picker) - was uncached, so each fired a fresh CG /search.
const _roiSearchCache = new Map(); // normQuery -> { data, ts } (insertion-ordered LRU)
const _roiSearchInflight = new Map(); // normQuery -> Promise
const ROI_SEARCH_TTL = 60 * 1000;
const ROI_SEARCH_MAX = 30; // small cap - evict oldest on overflow

function _roiSearchGet(key) {
  const entry = _roiSearchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ROI_SEARCH_TTL) { _roiSearchCache.delete(key); return null; }
  // LRU touch: move to most-recent
  _roiSearchCache.delete(key);
  _roiSearchCache.set(key, entry);
  return entry.data;
}

function _roiSearchSet(key, data) {
  _roiSearchCache.set(key, { data, ts: Date.now() });
  while (_roiSearchCache.size > ROI_SEARCH_MAX) {
    _roiSearchCache.delete(_roiSearchCache.keys().next().value);
  }
}

export async function searchCoinsForROI(q) {
  const query = q != null ? String(q).trim() : '';
  if (query.length < 1) return [];

  const key = query.toLowerCase();
  const cached = _roiSearchGet(key);
  if (cached) return cached;
  if (_roiSearchInflight.has(key)) return _roiSearchInflight.get(key);

  const promise = _searchCoinsForROIUncached(query)
    .then((data) => { _roiSearchSet(key, data); _roiSearchInflight.delete(key); return data; })
    .catch((err) => { _roiSearchInflight.delete(key); throw err; });
  _roiSearchInflight.set(key, promise);
  return promise;
}

async function _searchCoinsForROIUncached(query) {
  try {
    // CoinGecko first — its /search endpoint sorts by market-cap rank,
    // so "bitcoin" → BTC at top instead of name-fuzzy memecoin matches.
    const url = `${COINGECKO_API}/search?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      const coins = Array.isArray(data?.coins) ? data.coins : [];
      if (coins.length > 0) {
        // Sort by market-cap rank ascending (null/no-rank clones go last)
        // so real tokens like Bitcoin/Hyperliquid beat name-collision clones.
        const sorted = coins.slice().sort((a, b) => {
          const ra = Number.isFinite(a?.market_cap_rank) ? a.market_cap_rank : Infinity;
          const rb = Number.isFinite(b?.market_cap_rank) ? b.market_cap_rank : Infinity;
          return ra - rb;
        });
        return sorted.slice(0, 15).map((c) => ({
          id: c.id || '',
          symbol: (c.symbol || '').toUpperCase(),
          name: c.name || '',
          thumb: c.thumb || c.large || null,
          large: c.large || c.thumb || null,
          rank: c.market_cap_rank ?? null,
        }));
      }
    }

    // Fallback: Spectre search for obscure/on-chain tokens CoinGecko misses.
    const spectre = await getSpectreSearch(query, 15);
    const spectreCoins = Array.isArray(spectre?.coins) ? spectre.coins : [];
    return spectreCoins.slice(0, 15).map((c) => ({
      id: c.coingecko_id || c.id || (c.symbol || '').toLowerCase(),
      symbol: (c.symbol || '').toUpperCase(),
      name: c.name || '',
    }));
  } catch (err) {
    // silently handled
    return [];
  }
}

/**
 * Batch-fetch USD price + 24h change for a list of CoinGecko ids.
 * Returns a Map keyed by id: { price, change24h }.
 */
export async function getSimplePrices(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return new Map();
  try {
    const resolved = await Promise.all(ids.filter(Boolean).map(async (id) => {
      const raw = String(id)
      const rawLower = raw.toLowerCase()
      const mapped = Object.entries(SYMBOL_TO_COINGECKO_ID)
        .find(([, cgId]) => String(cgId).toLowerCase() === rawLower)?.[0]
      if (mapped) return { id: raw, symbol: mapped }

      const search = await getSpectreSearch(raw, 5).catch(() => null)
      const match = (Array.isArray(search?.coins) ? search.coins : []).find((coin) =>
        String(coin.coingecko_id || coin.id || '').toLowerCase() === rawLower ||
        String(coin.symbol || '').toLowerCase() === rawLower
      )
      return match?.symbol ? { id: raw, symbol: String(match.symbol).toUpperCase() } : null
    }))
    const symbolRows = resolved.filter(Boolean)
    if (symbolRows.length === ids.length) {
      const prices = await getSpectrePricesBySymbols(symbolRows.map((row) => row.symbol)).catch(() => ({}))
      const out = new Map()
      for (const row of symbolRows) {
        const entry = prices?.[row.symbol]
        if (!entry?.price) break
        out.set(row.id, {
          price: entry.price,
          change24h: Number.isFinite(entry.change24) ? entry.change24 : null,
          marketCap: Number.isFinite(entry.marketCap) ? entry.marketCap : null,
        })
      }
      if (out.size === ids.length) return out
    }

    const idParam = ids.filter(Boolean).join(',');
    if (!idParam) return new Map();
    const url = `${COINGECKO_API}/simple/price?ids=${encodeURIComponent(idParam)}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!res.ok) return new Map();
    const data = await res.json();
    const out = new Map();
    for (const id of Object.keys(data || {})) {
      const entry = data[id] || {};
      out.set(id, {
        price: Number.isFinite(entry.usd) ? entry.usd : null,
        change24h: Number.isFinite(entry.usd_24h_change) ? entry.usd_24h_change : null,
        marketCap: Number.isFinite(entry.usd_market_cap) ? entry.usd_market_cap : null,
      });
    }
    return out;
  } catch {
    return new Map();
  }
}

/**
 * Get coin data for ROI calculator (current price, ATH, market cap)
 * @param {string} id - CoinGecko coin id (e.g. 'bitcoin')
 * @returns {Promise<{ currentPrice: number, marketCap: number, athPrice: number, athDate: string } | null>}
 */
// ROI coin data: module cache (45s TTL) + inflight dedup keyed by coin id.
// Re-selecting the same coin re-ran the whole resolve->prices->detail waterfall.
const _roiDataCache = {}; // idLower -> { data, ts }
const _roiDataInflight = {}; // idLower -> Promise
const ROI_DATA_TTL = 45 * 1000;

export async function getCoinROIData(id) {
  if (!id) return null;

  const key = String(id).toLowerCase();
  const entry = _roiDataCache[key];
  if (entry && Date.now() - entry.ts < ROI_DATA_TTL) return entry.data;
  if (_roiDataInflight[key]) return _roiDataInflight[key];

  const promise = _getCoinROIDataUncached(id)
    .then((data) => {
      // Only cache successful resolves; null (failure) stays uncached so a
      // retry can recover instead of being pinned to a miss for 45s.
      if (data) _roiDataCache[key] = { data, ts: Date.now() };
      delete _roiDataInflight[key];
      return data;
    })
    .catch((err) => { delete _roiDataInflight[key]; throw err; });
  _roiDataInflight[key] = promise;
  return promise;
}

async function _getCoinROIDataUncached(id) {
  try {
    const idLower = String(id).toLowerCase();
    let symbol = Object.entries(SYMBOL_TO_COINGECKO_ID)
      .find(([, cgId]) => String(cgId).toLowerCase() === idLower)?.[0] || null;

    if (!symbol) {
      const search = await getSpectreSearch(id, 10).catch(() => null);
      const match = (Array.isArray(search?.coins) ? search.coins : []).find((coin) =>
        String(coin.coingecko_id || coin.id || '').toLowerCase() === idLower ||
        String(coin.symbol || '').toLowerCase() === idLower
      );
      symbol = match?.symbol ? String(match.symbol).toUpperCase() : null;
    }

    let spectreResult = null;
    if (symbol) {
      const prices = await getSpectrePricesBySymbols([symbol]).catch(() => ({}));
      const row = prices?.[symbol];
      if (row?.price) {
        spectreResult = {
          currentPrice: row.price,
          marketCap: row.marketCap || null,
          athPrice: row.ath?.price ?? row.ath?.usd ?? null,
          athDate: row.ath?.date ?? row.ath?.time ?? null,
        };
        // If Spectre gave us everything including ATH, we're done.
        if (spectreResult.athPrice && spectreResult.athPrice > 0) {
          return spectreResult;
        }
      }
    }

    // CoinGecko fallback. Reached when Spectre had no symbol, no price, or
    // a price-only row missing ATH. Merge so the freshest price wins but ATH
    // backfills from CoinGecko.
    const url = `${COINGECKO_API}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&community_data=false&developer_data=false`;
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!res.ok) return spectreResult;
    const data = await res.json();
    const md = data.market_data || {};
    const cgCurrentPrice = md.current_price?.usd ?? null;
    const cgMarketCap = md.market_cap?.usd ?? null;
    const cgAthPrice = md.ath?.usd ?? null;
    const cgAthDate = md.ath_date?.usd ?? null;

    if (spectreResult) {
      return {
        currentPrice: spectreResult.currentPrice ?? cgCurrentPrice,
        marketCap: spectreResult.marketCap ?? cgMarketCap,
        athPrice: spectreResult.athPrice && spectreResult.athPrice > 0
          ? spectreResult.athPrice
          : cgAthPrice,
        athDate: spectreResult.athDate ?? cgAthDate,
      };
    }
    return { currentPrice: cgCurrentPrice, marketCap: cgMarketCap, athPrice: cgAthPrice, athDate: cgAthDate };
  } catch (err) {
    // silently handled
    return null;
  }
}

// ── Price history (Time Machine) ──
const _priceHistoryCache = {}; // { [id]: { data, _ts } }
const PRICE_HISTORY_TTL = 6 * 60 * 60 * 1000; // 6h — historical anchors barely move

/**
 * Fetch a coin's full daily price history and reduce it to one "entry point"
 * per calendar year (the first data point of each year), plus the earliest
 * point overall. Powers the Time Machine: "if you'd bought in 2013…".
 *
 * Returns { firstDate, firstPrice, anchors: [{ year, ts, price }] } sorted
 * oldest → newest, excluding the current year (its multiplier ≈ 1×). Returns
 * null on failure or when there's < 1 year of history.
 */
export async function getCoinPriceHistory(id) {
  if (!id) return null;
  const key = String(id).toLowerCase();
  const cached = _priceHistoryCache[key];
  if (cached && Date.now() - cached._ts < PRICE_HISTORY_TTL) return cached.data;
  try {
    const url = `${COINGECKO_API}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=max&interval=daily`;
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const data = await res.json();
    const prices = Array.isArray(data?.prices) ? data.prices : [];
    if (prices.length < 2) return null;

    // Full filtered daily series [[ts, price], …] for the price chart. Shared
    // off the same cached response so the chart adds no extra network call.
    const series = [];
    for (const point of prices) {
      const ts = Number(point?.[0]);
      const price = Number(point?.[1]);
      if (ts > 0 && price > 0) series.push([ts, price]);
    }

    const nowYear = new Date().getUTCFullYear();
    const firstOfYear = new Map(); // year -> { ts, price }
    for (const point of prices) {
      const ts = Number(point?.[0]);
      const price = Number(point?.[1]);
      if (!(ts > 0) || !(price > 0)) continue;
      const year = new Date(ts).getUTCFullYear();
      if (!firstOfYear.has(year)) firstOfYear.set(year, { ts, price });
    }
    const anchors = [...firstOfYear.entries()]
      .filter(([year]) => year < nowYear)
      .sort((a, b) => a[0] - b[0])
      .map(([year, v]) => ({ year, ts: v.ts, price: v.price }));
    if (anchors.length === 0) return null;

    const firstTs = Number(prices[0][0]);
    const result = {
      firstDate: firstTs,
      firstPrice: Number(prices[0][1]),
      anchors,
      series,
    };
    _priceHistoryCache[key] = { data: result, _ts: Date.now() };
    return result;
  } catch (err) {
    // silently handled — Time Machine simply hides when history is unavailable
    return null;
  }
}

// ── Categories ──
let categoriesCache = { data: [], _ts: 0 };
const CATEGORIES_CACHE_TTL = 5 * 60 * 1000; // 5 min - fresh enough for narratives % without hammering CG
let _categoriesInflight = null; // dedup concurrent CompareChart mounts / tab-switches

// sessionStorage seed so a remount within the session paints instantly without
// a refetch (categories barely move). Module cache survives only the SPA session
// in memory; sessionStorage survives full reloads within the same tab session.
const CATEGORIES_PERSIST_KEY = 'spectre-cg-categories-v1';

function _loadPersistedCategories() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CATEGORIES_PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed._ts !== 'number' || !Array.isArray(parsed.data) || parsed.data.length === 0) return null;
    if (Date.now() - parsed._ts > CATEGORIES_CACHE_TTL) return null;
    return parsed;
  } catch { return null; }
}

function _persistCategories(data, ts) {
  if (typeof window === 'undefined' || !Array.isArray(data) || data.length === 0) return;
  try {
    window.sessionStorage.setItem(CATEGORIES_PERSIST_KEY, JSON.stringify({ data, _ts: ts }));
  } catch { /* quota / private mode - silently ignore */ }
}

/**
 * Fetch all coin categories. Prefer Spectre's cached category bridge and only
 * hit the legacy CoinGecko proxy if that bridge is unavailable.
 * Module cache (30min) + inflight dedup + sessionStorage seed so repeated
 * CompareChart mounts / tab-switches don't refetch /coins/categories.
 */
export async function getCategories() {
  const now = Date.now();
  if (categoriesCache.data.length > 0 && (now - categoriesCache._ts < CATEGORIES_CACHE_TTL)) {
    return categoriesCache.data;
  }
  // Seed from sessionStorage on the first call after a reload.
  if (categoriesCache.data.length === 0) {
    const seed = _loadPersistedCategories();
    if (seed) {
      categoriesCache = { data: seed.data, _ts: seed._ts };
      return seed.data;
    }
  }
  if (_categoriesInflight) return _categoriesInflight;
  _categoriesInflight = _getCategoriesUncached()
    .finally(() => { _categoriesInflight = null; });
  return _categoriesInflight;
}

async function _getCategoriesUncached() {
  const now = Date.now();
  try {
    const spectreCategories = await getSpectreCategories({ limit: 300 });
    const hasUsefulSpectreRows = spectreCategories.some((row) =>
      (row.market_cap || 0) > 0 ||
      (row.volume_24h || 0) > 0 ||
      row._hasMarketMetrics === true ||
      (Array.isArray(row.top_3_coins) && row.top_3_coins.length > 0)
    );
    if (spectreCategories.length > 0 && hasUsefulSpectreRows) {
      categoriesCache = { data: spectreCategories, _ts: now };
      _persistCategories(spectreCategories, now);
      return spectreCategories;
    }

    const url = `${COINGECKO_API}/coins/categories?order=market_cap_desc`;
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!res.ok) {
      // silently handled
      if (categoriesCache.data.length > 0) return categoriesCache.data;
      throw new Error(`API error: ${res.status}`);
    }
    const data = await res.json();
    if (Array.isArray(data)) {
      categoriesCache = { data, _ts: now };
      _persistCategories(data, now);
      return data;
    }
    throw new Error('Invalid categories response');
  } catch (err) {
    // silently handled
    if (categoriesCache.data.length > 0) return categoriesCache.data;
    return getCategoriesFallback();
  }
}

function getCategoriesFallback() {
  return [
    { id: 'smart-contract-platform', name: 'Smart Contract Platform', market_cap: 2051825422234, market_cap_change_24h: -6.5, volume_24h: 145578042148, top_3_coins: ['https://assets.coingecko.com/coins/images/279/small/ethereum.png', 'https://assets.coingecko.com/coins/images/4128/small/solana.png', 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png'] },
    { id: 'layer-1', name: 'Layer 1 (L1)', market_cap: 2012756689271, market_cap_change_24h: -6.5, volume_24h: 140663003897, top_3_coins: ['https://assets.coingecko.com/coins/images/1/small/bitcoin.png', 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', 'https://assets.coingecko.com/coins/images/4128/small/solana.png'] },
    { id: 'proof-of-work', name: 'Proof of Work (PoW)', market_cap: 1521454639326, market_cap_change_24h: -6.4, volume_24h: 77457519389, top_3_coins: ['https://assets.coingecko.com/coins/images/1/small/bitcoin.png', 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png', 'https://assets.coingecko.com/coins/images/69/small/monero_logo.png'] },
    { id: 'proof-of-stake', name: 'Proof of Stake (PoS)', market_cap: 485021242176, market_cap_change_24h: -6.9, volume_24h: 64019574228, top_3_coins: ['https://assets.coingecko.com/coins/images/279/small/ethereum.png', 'https://assets.coingecko.com/coins/images/4128/small/solana.png', 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png'] },
    { id: 'stablecoins', name: 'Stablecoins', market_cap: 309606605066, market_cap_change_24h: -0.2, volume_24h: 156342089452, top_3_coins: ['https://assets.coingecko.com/coins/images/325/small/Tether.png', 'https://assets.coingecko.com/coins/images/6319/small/usdc.png', 'https://assets.coingecko.com/coins/images/9956/small/Badge_Dai.png'] },
    { id: 'meme-token', name: 'Meme Tokens', market_cap: 47000000000, market_cap_change_24h: -8.2, volume_24h: 8900000000, top_3_coins: ['https://assets.coingecko.com/coins/images/5/small/dogecoin.png', 'https://assets.coingecko.com/coins/images/11939/small/shiba.png', 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg'] },
    { id: 'decentralized-finance-defi', name: 'Decentralized Finance (DeFi)', market_cap: 145000000000, market_cap_change_24h: -5.8, volume_24h: 12000000000, top_3_coins: ['https://assets.coingecko.com/coins/images/12504/small/uni.jpg', 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png', 'https://assets.coingecko.com/coins/images/9956/small/Badge_Dai.png'] },
    { id: 'artificial-intelligence', name: 'Artificial Intelligence (AI)', market_cap: 32000000000, market_cap_change_24h: -7.1, volume_24h: 4500000000, top_3_coins: ['https://assets.coingecko.com/coins/images/25244/small/Optimism.png', 'https://assets.coingecko.com/coins/images/26045/small/INJECTIVE_LOGO.png', 'https://assets.coingecko.com/coins/images/12645/small/AAVE_Token_Rounded.png'] },
    { id: 'real-world-assets-rwa', name: 'Real World Assets (RWA)', market_cap: 42000000000, market_cap_change_24h: -3.4, volume_24h: 2800000000, top_3_coins: ['https://assets.coingecko.com/coins/images/279/small/ethereum.png', 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png', 'https://assets.coingecko.com/coins/images/26045/small/INJECTIVE_LOGO.png'] },
    { id: 'gaming', name: 'Gaming (GameFi)', market_cap: 12000000000, market_cap_change_24h: -9.2, volume_24h: 1800000000, top_3_coins: ['https://assets.coingecko.com/coins/images/12129/small/sandbox_logo.jpg', 'https://assets.coingecko.com/coins/images/12467/small/axs.png', 'https://assets.coingecko.com/coins/images/18834/small/wemix-token.png'] },
    { id: 'layer-2', name: 'Layer 2 (L2)', market_cap: 18000000000, market_cap_change_24h: -7.8, volume_24h: 3200000000, top_3_coins: ['https://assets.coingecko.com/coins/images/25244/small/Optimism.png', 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg', 'https://assets.coingecko.com/coins/images/35023/small/starknet.png'] },
    { id: 'exchange-based-tokens', name: 'Exchange Tokens', market_cap: 98000000000, market_cap_change_24h: -4.1, volume_24h: 5600000000, top_3_coins: ['https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png', 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png', 'https://assets.coingecko.com/coins/images/2/small/litecoin.png'] },
    { id: 'decentralized-exchange', name: 'Decentralized Exchange (DEX)', market_cap: 28000000000, market_cap_change_24h: -6.3, volume_24h: 3100000000, top_3_coins: ['https://assets.coingecko.com/coins/images/12504/small/uni.jpg', 'https://assets.coingecko.com/coins/images/12271/small/512x512_Logo_no_chop.png', 'https://assets.coingecko.com/coins/images/13469/small/1inch-token.png'] },
    { id: 'nft', name: 'NFT', market_cap: 8500000000, market_cap_change_24h: -10.5, volume_24h: 1200000000, top_3_coins: ['https://assets.coingecko.com/coins/images/12467/small/axs.png', 'https://assets.coingecko.com/coins/images/12129/small/sandbox_logo.jpg', 'https://assets.coingecko.com/coins/images/11636/small/ape.png'] },
    { id: 'privacy-coins', name: 'Privacy Coins', market_cap: 6000000000, market_cap_change_24h: -5.7, volume_24h: 400000000, top_3_coins: ['https://assets.coingecko.com/coins/images/69/small/monero_logo.png', 'https://assets.coingecko.com/coins/images/63/small/zcash.png', 'https://assets.coingecko.com/coins/images/281/small/dash-logo.png'] },
  ];
}

// ── Category Coins ──
let categoryCoinsCaches = {};
const CATEGORY_COINS_CACHE_TTL = 5 * 60 * 1000; // 5 min

function hasNumericMarketValue(value) {
  if (value === null || value === undefined || value === '') return false;
  return Number.isFinite(Number(value));
}

function categoryRowNeedsQuote(row = {}) {
  return !(
    hasNumericMarketValue(row.price ?? row.current_price ?? row.price_usd) &&
    hasNumericMarketValue(row.market_cap ?? row.market_cap_usd) &&
    hasNumericMarketValue(row.volume_24h ?? row.volume24h ?? row.total_volume ?? row.volume) &&
    hasNumericMarketValue(row.change_24h ?? row.price_change_percentage_24h)
  );
}

function normalizeSpectreCategoryCoin(row = {}, quote = {}, index = 0, offset = 0, categoryId = '') {
  const symbol = String(row.symbol || row.asset || quote.symbol || '').trim().replace(/^\$/, '').toUpperCase();
  if (!symbol) return null;
  const lower = symbol.toLowerCase();
  const price = Number(quote.price ?? row.price ?? row.current_price ?? 0) || 0;
  const marketCap = Number(quote.marketCap ?? row.market_cap ?? row.market_cap_usd ?? 0) || 0;
  const volume = Number(quote.volume ?? row.volume_24h ?? row.volume24h ?? row.volume ?? 0) || 0;

  return {
    id: row.coingecko_id || row.id || SYMBOL_TO_COINGECKO_ID[symbol] || `${categoryId}-${lower}`,
    symbol: lower,
    name: row.name || quote.name || symbol,
    image: row.logo_url || row.image || row.logo || quote.image || quote.logo || COINGECKO_LOGOS[symbol] || localTokenIcon(symbol),
    current_price: price,
    market_cap: marketCap,
    market_cap_rank: row.rank ?? quote.rank ?? offset + index + 1,
    total_volume: volume,
    price_change_percentage_24h: Number(quote.change24 ?? quote.change ?? row.change_24h ?? 0) || 0,
    price_change_percentage_1h_in_currency: Number(quote.change1h ?? row.change_1h ?? 0) || 0,
    price_change_percentage_7d_in_currency: Number(quote.change7d ?? row.change_7d ?? 0) || 0,
    price_change_percentage_30d_in_currency: Number(quote.change30d ?? row.change_30d ?? 0) || 0,
    price_change_percentage_1y_in_currency: Number(quote.change1y ?? row.change_1y ?? 0) || 0,
    sparkline_in_7d: null,
    _source: 'spectre-category-assets',
    _degradedCategoryMetrics: marketCap <= 0 || volume <= 0,
  };
}

// ── Top-250 WITH real 7d sparklines - guaranteed ────────────────────────────
// getTopCoinsMarketsPage can legitimately answer from its localStorage
// instant-paint seed, which strips sparkline arrays before persisting. The
// categories page derives REAL per-category 7d trend lines from these arrays,
// so it needs a source that never serves a stripped copy. One 250-row CG
// fetch, 10-min module cache + inflight dedup.
let _sparkTopCache = { data: null, _ts: 0 };
let _sparkTopInflight = null;
const SPARK_TOP_TTL = 10 * 60 * 1000;

export async function getTopCoinsWithSparklines() {
  const now = Date.now();
  if (_sparkTopCache.data && now - _sparkTopCache._ts < SPARK_TOP_TTL) return _sparkTopCache.data;
  if (_sparkTopInflight) return _sparkTopInflight;
  _sparkTopInflight = (async () => {
    try {
      const url = `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=true&price_change_percentage=24h,7d`;
      const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0 && data.some((c) => Array.isArray(c?.sparkline_in_7d?.price))) {
        _sparkTopCache = { data, _ts: Date.now() };
        return data;
      }
      return _sparkTopCache.data || [];
    } catch (err) {
      return _sparkTopCache.data || [];
    } finally {
      _sparkTopInflight = null;
    }
  })();
  return _sparkTopInflight;
}

const CATEGORY_SYMBOL_FALLBACKS = {
  'smart-contract-platform': ['ETH', 'SOL', 'BNB', 'ADA', 'AVAX', 'SUI', 'TRX', 'TON', 'NEAR', 'APT', 'DOT', 'ATOM', 'ALGO', 'ICP', 'SEI'],
  'solana-ecosystem': ['SOL', 'JUP', 'RAY', 'BONK', 'WIF', 'PYTH', 'JTO', 'PENGU', 'GRASS', 'ORCA'],
  'meme-token': ['DOGE', 'SHIB', 'PEPE', 'BONK', 'FLOKI', 'WIF', 'TRUMP', 'PENGU', 'MOG'],
  'meme-coins': ['DOGE', 'SHIB', 'PEPE', 'BONK', 'FLOKI', 'WIF', 'TRUMP', 'PENGU', 'MOG'],
  'decentralized-finance-defi': ['UNI', 'AAVE', 'LINK', 'MKR', 'CRV', 'SNX', 'COMP', 'LDO', 'ENA', 'PENDLE'],
  'artificial-intelligence': ['TAO', 'FET', 'RENDER', 'AKT', 'AI', 'GRASS', 'VIRTUAL'],
  'real-world-assets-rwa': ['LINK', 'ONDO', 'MKR', 'CFG', 'POLYX', 'PENDLE', 'GFI', 'TRU'],
  'gaming': ['IMX', 'AXS', 'SAND', 'GALA', 'BEAM', 'PIXEL', 'RON'],
  'layer-2': ['OP', 'ARB', 'STRK', 'MATIC', 'IMX', 'MANTA', 'METIS'],
  'exchange-based-tokens': ['BNB', 'LEO', 'OKB', 'CRO', 'KCS', 'BGB', 'GT'],
  'decentralized-exchange': ['UNI', 'RAY', 'CAKE', 'CRV', 'JUP', '1INCH', 'SUSHI', 'BAL'],
  'nft': ['PENGU', 'APE', 'BLUR', 'MAGIC', 'LOOKS', 'TNSR'],
  'privacy-coins': ['XMR', 'ZEC', 'DASH', 'SCR'],
  stablecoins: ['USDT', 'USDC', 'DAI', 'USDE', 'FDUSD'],
};

/**
 * Fetch coins in a specific category. Prefer Spectre's category membership
 * bridge and enrich exact symbols through the cached price bridge. Fall back to
 * the CoinGecko proxy when the backend category endpoint is empty or incomplete.
 */
export async function getCategoryCoins(categoryId, page = 1, perPage = 25, { cgOnly = false, sparkline = false } = {}) {
  // cgOnly: skip the Spectre-first race entirely. Chain/ecosystem categories
  // (ethereum-ecosystem, solana-ecosystem, ...) are not served by the Spectre
  // category-assets bridge, and for solana-ecosystem the 10-symbol
  // CATEGORY_SYMBOL_FALLBACKS list would WIN the race and shrink the
  // 250-row universe to 10 rows (breaks the Top Coins chain filter).
  // sparkline: opt-in real 7d arrays (~+30KB/100 rows) for surfaces that draw
  // actual charts (categories detail table) - everything else stays lean.
  const cacheKey = `${categoryId}_${page}_${perPage}${cgOnly ? '_cg' : ''}${sparkline ? '_sp' : ''}`;
  const now = Date.now();
  const cached = categoryCoinsCaches[cacheKey];

  if (cached && cached.data.length > 0 && (now - cached._ts < CATEGORY_COINS_CACHE_TTL)) {
    return cached.data;
  }

  // 2026-07-02: the CG fetch fires IMMEDIATELY, in parallel with the
  // Spectre-first attempt. The Spectre data-api routinely takes 2-12s (or
  // 404s) on category routes, and the old serial await (category assets ->
  // prices bridge -> only then CG) left the Top Coins category tabs empty for
  // ~20s. Spectre still wins when it answers within a 2.5s window; a slow
  // Spectre response keeps warming its own cache for the next call.
  const cgPromise = (async () => {
    const url = `${COINGECKO_API}/coins/markets?vs_currency=usd&category=${encodeURIComponent(categoryId)}&order=market_cap_desc&per_page=${perPage}&page=${page}&sparkline=${sparkline ? 'true' : 'false'}&price_change_percentage=1h,24h,7d,30d,1y`;
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data)) return data;
    throw new Error('Invalid category coins response');
  })();
  cgPromise.catch(() => {}); // no unhandled rejection when Spectre wins the race

  const spectrePromise = cgOnly ? Promise.resolve(null) : (async () => {
    try {
      const offset = (Math.max(1, Number(page) || 1) - 1) * perPage;
      const spectrePayload = await getSpectreCategoryAssets(categoryId, { limit: perPage, offset });
      const spectreRows = Array.isArray(spectrePayload?.data) ? spectrePayload.data : [];
      if (spectreRows.length > 0) {
        const quoteSymbols = [...new Set(
          spectreRows
            .filter(categoryRowNeedsQuote)
            .map((row) => String(row?.symbol || row?.asset || '').trim().replace(/^\$/, '').toUpperCase())
            .filter(Boolean)
        )];
        const quotes = quoteSymbols.length > 0 ? await getSpectrePricesBySymbols(quoteSymbols).catch(() => ({})) : {};
        const mapped = spectreRows
          .map((row, index) => {
            const symbol = String(row?.symbol || row?.asset || '').trim().replace(/^\$/, '').toUpperCase();
            return normalizeSpectreCategoryCoin(row, quotes[symbol], index, offset, categoryId);
          })
          .filter(Boolean);
        if (mapped.length > 0) return mapped;
      }
    } catch (err) {
      // Backend category assets are still being enriched; use CoinGecko fallback.
    }
    return null;
  })();

  // Hardcoded symbol lists are a LAST resort (both upstreams down), never a race
  // entrant: when the Spectre bridge fails fast, this list used to beat the full
  // CoinGecko category fetch and shrink whole categories to 7-10 rows (AI showed
  // exactly its 7 fallback symbols on the home tabs and the categories page).
  const symbolFallback = async () => {
    const fallbackSymbols = CATEGORY_SYMBOL_FALLBACKS[categoryId] || [];
    const pageSymbols = fallbackSymbols.slice((Math.max(1, Number(page) || 1) - 1) * perPage, Math.max(1, Number(page) || 1) * perPage);
    if (pageSymbols.length === 0) return null;
    try {
      const quotes = await getSpectrePricesBySymbols(pageSymbols);
      const mapped = pageSymbols
        .map((symbol, index) => normalizeSpectreCategoryCoin({ symbol }, quotes[symbol], index, (Math.max(1, Number(page) || 1) - 1) * perPage, categoryId))
        .filter(Boolean)
        .sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0))
        .map((row, index) => ({
          ...row,
          market_cap_rank: row.market_cap_rank || index + 1,
          _source: 'spectre-category-symbol-fallback',
        }));
      if (mapped.length > 0) return mapped;
    } catch (err) {
      // Cached price bridge unavailable too - caller falls through to stale cache.
    }
    return null;
  };

  const spectreFast = await Promise.race([
    spectrePromise.catch(() => null),
    new Promise((resolve) => { setTimeout(() => resolve(undefined), 2500); }),
  ]);
  if (Array.isArray(spectreFast) && spectreFast.length > 0) {
    categoryCoinsCaches[cacheKey] = { data: spectreFast, _ts: now };
    return spectreFast;
  }

  try {
    const data = await cgPromise;
    // Robinhood chain listings: CG's API ships dataless rows for days after a
    // listing while coingecko.com fills them from GeckoTerminal - mirror that.
    const finalData = await maybeEnrichRobinhoodCategory(categoryId, data);
    categoryCoinsCaches[cacheKey] = { data: finalData, _ts: now };
    return finalData;
  } catch (err) {
    // CG failed: a slow Spectre answer is better than an empty table.
    const spectreLate = await spectrePromise.catch(() => null);
    if (Array.isArray(spectreLate) && spectreLate.length > 0) {
      categoryCoinsCaches[cacheKey] = { data: spectreLate, _ts: now };
      return spectreLate;
    }
    // Both upstreams down: hardcoded symbols beat an empty table.
    const fallbackRows = cgOnly ? null : await symbolFallback();
    if (Array.isArray(fallbackRows) && fallbackRows.length > 0) {
      categoryCoinsCaches[cacheKey] = { data: fallbackRows, _ts: now };
      return fallbackRows;
    }
    if (cached && cached.data.length > 0) return cached.data;
    return [];
  }
}

// ── CoinGecko ID resolution for exotic tokens ──
const cgIdCache = {}; // symbol -> { id, _ts }
const CG_ID_CACHE_TTL = 30 * 60 * 1000; // 30 min

/**
 * Resolve a CoinGecko ID for any symbol — uses hardcoded map, top-1000 cache, then CG search.
 * Handles hyphenated symbols like "PALM-AI" by searching with spaces and matching flexibly.
 * @param {string} symbol - e.g. 'PALM', 'PALM-AI', 'HYPE'
 * @returns {Promise<string|null>}
 */
export async function resolveCoinGeckoId(symbol) {
  const sym = (symbol || '').toUpperCase();
  if (!sym) return null;

  // 1. Hardcoded mapping (instant) — try both raw and dehyphenated
  if (SYMBOL_TO_COINGECKO_ID[sym]) return SYMBOL_TO_COINGECKO_ID[sym];
  const symNoHyphen = sym.replace(/-/g, '');
  if (symNoHyphen !== sym && SYMBOL_TO_COINGECKO_ID[symNoHyphen]) return SYMBOL_TO_COINGECKO_ID[symNoHyphen];

  // 2. Cached resolution
  const cached = cgIdCache[sym];
  if (cached && (Date.now() - cached._ts < CG_ID_CACHE_TTL)) return cached.id;

  // 3. Check top-1000 coins cache (try both exact and dehyphenated)
  if (allCoinsCache.data.length > 0) {
    const coin = allCoinsCache.data.find(c => {
      const cs = (c.symbol || '').toUpperCase();
      return cs === sym || cs === symNoHyphen;
    });
    if (coin?.id) {
      cgIdCache[sym] = { id: coin.id, _ts: Date.now() };
      return coin.id;
    }
  }

  // 4. Dynamic search via CoinGecko proxy (works in both dev and prod)
  // CoinGecko search fails on hyphens (e.g. "PALM-AI" returns empty), so replace with spaces
  const searchQuery = sym.replace(/-/g, ' ');
  try {
    const spectre = await getSpectreSearch(searchQuery, 10);
    const spectreCoins = Array.isArray(spectre?.coins) ? spectre.coins : [];
    const spectreMatch =
      spectreCoins.find(c => (c.symbol || '').toUpperCase() === sym) ||
      spectreCoins.find(c => (c.symbol || '').toUpperCase() === symNoHyphen) ||
      spectreCoins[0] ||
      null;
    if (spectreMatch?.coingecko_id || spectreMatch?.id) {
      const id = spectreMatch.coingecko_id || spectreMatch.id;
      cgIdCache[sym] = { id, _ts: Date.now() };
      return id;
    }

    const url = `${COINGECKO_API}/search?query=${encodeURIComponent(searchQuery)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      const coins = data.coins || [];
      // Match priority: exact symbol > dehyphenated symbol > coin ID matches lowercased symbol
      const symLower = sym.toLowerCase();
      const match =
        coins.find(c => (c.symbol || '').toUpperCase() === sym) ||
        coins.find(c => (c.symbol || '').toUpperCase() === symNoHyphen) ||
        coins.find(c => c.id === symLower) ||
        null;
      if (match?.id) {
        cgIdCache[sym] = { id: match.id, _ts: Date.now() };
        return match.id;
      }
    }
  } catch (e) {
    // silently handled
  }
  return null;
}

// ── Token Markets (exchange tickers) ──
let marketsCache = {};
const marketsInflight = {};
const MARKETS_CACHE_TTL = 10 * 60 * 1000; // 10 min (CoinGecko free tier is rate-limited)

// DEX/exchange classification for client-side tickers processing
const DEX_PATTERN = /uniswap|sushiswap|pancakeswap|curve|balancer|raydium|jupiter|orca|trader joe|quickswap|camelot|velodrome|aerodrome|osmosis|thorswap|dexalot|sodex|lighter|fluid|maverick|1inch|paraswap|kyberswap|dodo|shibaswap|spookyswap|pangolin|biswap|lifinity|meteora|serum|gmx|dydx|vertex|drift|hyperliquid|swap|dex/i;
// Derivative exchange detection - CoinGecko uses suffixes like "(Futures)", "(Perpetual)", "(Derivatives)"
const DERIVATIVE_SUFFIX = /\((Futures|Perpetual|Derivatives?)\)$/i;
// Date-like expiry pattern in pair target, e.g. "BTCUSD_260627" or "BTC-27JUN25"
const FUTURES_EXPIRY_PATTERN = /\d{6}$|\d{2}[A-Z]{3}\d{2}$/;
const TIER1_NAMES = new Set([
  'Binance', 'Coinbase Exchange', 'Coinbase', 'Kraken', 'OKX', 'Bybit',
  'KuCoin', 'Bitfinex', 'Bitstamp', 'Crypto.com Exchange', 'HTX', 'Gate.io',
  'Upbit', 'MEXC', 'Bitget', 'Jupiter', 'Raydium',
]);

/** Process raw CoinGecko tickers into our market format (same logic as server) */
function processRawTickers(tickers) {
  let totalVolume = 0;
  for (const t of tickers) totalVolume += (t.converted_volume?.usd || 0);

  const trustOrder = { green: 0, yellow: 1, red: 2 };
  const sorted = [...tickers].sort((a, b) => {
    const aT1 = TIER1_NAMES.has(a.market?.name) ? 0 : 1;
    const bT1 = TIER1_NAMES.has(b.market?.name) ? 0 : 1;
    if (aT1 !== bT1) return aT1 - bT1;
    const ta = trustOrder[a.trust_score] ?? 3;
    const tb = trustOrder[b.trust_score] ?? 3;
    if (ta !== tb) return ta - tb;
    return (b.converted_volume?.usd || 0) - (a.converted_volume?.usd || 0);
  });

  const seen = new Map();
  for (const t of sorted) {
    const rawName = t.market?.name || 'Unknown';
    const pair = `${(t.base || '').toUpperCase()}/${(t.target || '').toUpperCase()}`;
    const key = `${rawName}::${pair}`;
    if (seen.has(key)) continue;

    const shortName = rawName
      .replace(' Exchange', '')
      .replace(/ \(Ethereum\)/, '').replace(/ \(BSC\)/, '')
      .replace(/ \(Arbitrum One\)/, '').replace(/ \(Optimism\)/, '')
      .replace(/ \(Base\)/, '').replace(/ \(Polygon\)/, '').replace(/ \(Solana\)/, '')
      .replace(/ \(Futures\)/, '').replace(/ \(Perpetual\)/, '')
      .replace(/ \(Derivatives?\)/, '');

    // Derivative exchange detection - must check before DEX pattern since
    // dydx/hyperliquid appear in DEX_PATTERN but are derivatives when suffixed
    const derivMatch = rawName.match(DERIVATIVE_SUFFIX);
    let isDerivative = false;
    let derivativeType = null;
    if (derivMatch) {
      isDerivative = true;
      const suffix = derivMatch[1].toLowerCase();
      if (suffix === 'perpetual') {
        derivativeType = 'perpetual';
      } else {
        // "Futures" or "Derivative(s)" - check pair target for expiry date
        const target = (t.target || '').toUpperCase();
        derivativeType = FUTURES_EXPIRY_PATTERN.test(target) ? 'futures' : 'perpetual';
      }
    }

    const isDex = !isDerivative && DEX_PATTERN.test(rawName);
    const vol = t.converted_volume?.usd || 0;
    const pct = totalVolume > 0 ? ((vol / totalVolume) * 100) : 0;

    seen.set(key, {
      exchange: shortName,
      exchangeId: t.market?.identifier || null,
      logo: t.market?.logo || null,
      pair,
      price: t.converted_last?.usd || t.last || 0,
      depthPlus2: t.cost_to_move_up_usd || 0,
      depthMinus2: t.cost_to_move_down_usd || 0,
      volume24h: vol,
      volumePct: Math.round(pct * 10) / 10,
      liquidity: (t.cost_to_move_up_usd || 0) + (t.cost_to_move_down_usd || 0),
      type: isDerivative ? 'cex' : (isDex ? 'dex' : 'cex'),
      trustScore: t.trust_score || null,
      isDerivative,
      derivativeType,
      tradeUrl: t.trade_url || null,
    });
  }
  // Split spot CEX / DEX / derivatives and keep top of each. Preserve the
  // tier-1 + trust ranking from the upstream sort (wash-trade venues like
  // Azbit/BTCC report inflated raw volume; final pass keeps Binance/Coinbase
  // first while still pushing real volume above noise within each tier).
  const tierRank = (m) => {
    if (TIER1_NAMES.has(m.exchange)) return 0;
    if (m.trustScore === 'green') return 1;
    if (m.trustScore === 'yellow') return 2;
    if (m.trustScore === 'red') return 4;
    return 3;
  };
  const finalSort = (a, b) => {
    const ra = tierRank(a);
    const rb = tierRank(b);
    if (ra !== rb) return ra - rb;
    return (b.volume24h || 0) - (a.volume24h || 0);
  };
  const allMarkets = [...seen.values()];
  const spotCex = allMarkets.filter(m => m.type === 'cex' && !m.isDerivative).sort(finalSort);
  const dex = allMarkets.filter(m => m.type === 'dex').sort(finalSort);
  const derivatives = allMarkets.filter(m => m.isDerivative).sort(finalSort);
  return [...spotCex.slice(0, 60), ...dex.slice(0, 60), ...derivatives.slice(0, 60)];
}

/**
 * Fetch full market/ticker data for a token (exchanges, pairs, volume, depth, etc.)
 * @param {string} symbol - e.g. 'BTC', 'ETH', 'SOL'
 * @param {string} [coingeckoId] - optional CoinGecko ID (e.g. 'bitcoin') to skip search
 * @returns {Promise<{ markets: Array, source: string }>}
 */
// Display-name map for DexScreener dexId values. Anything unmapped falls
// through to the raw lower-case slug (still renders, just less polished).
const DEXSCREENER_DEX_NAMES = {
  uniswap: 'Uniswap', pancakeswap: 'PancakeSwap', sushiswap: 'SushiSwap',
  raydium: 'Raydium', orca: 'Orca', meteora: 'Meteora', jupiter: 'Jupiter',
  quickswap: 'QuickSwap', traderjoe: 'Trader Joe', velodrome: 'Velodrome',
  curve: 'Curve', balancer: 'Balancer', aerodrome: 'Aerodrome',
  cetus: 'Cetus', turbos: 'Turbos', flowx: 'FlowX', baseswap: 'BaseSwap',
};
const DEXSCREENER_CHAIN_NAMES = {
  ethereum: 'ETH', bsc: 'BSC', polygon: 'MATIC', arbitrum: 'ARB',
  base: 'BASE', avalanche: 'AVAX', optimism: 'OP', solana: 'SOL',
  fantom: 'FTM', sui: 'SUI', aptos: 'APT', ton: 'TON',
};

// localStorage instant-paint seed for the Markets tab (now the token page's
// DEFAULT tab, so its cold latency IS the perceived tab load). Repeat visits
// paint the last snapshot immediately via onPartial while the live fetch
// revalidates. Rows capped so a busy major doesn't blow the LS quota.
const MARKETS_SEED_PREFIX = 'spectre-mkts-v1:';
function _marketsSeedLoad(cacheKey) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(MARKETS_SEED_PREFIX + cacheKey);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !Array.isArray(entry.data?.markets) || Date.now() - entry.ts > MARKETS_CACHE_TTL) {
      localStorage.removeItem(MARKETS_SEED_PREFIX + cacheKey);
      return null;
    }
    return entry.data;
  } catch (_) { return null; }
}
function _marketsSeedSave(cacheKey, data) {
  if (typeof window === 'undefined') return;
  try {
    const slim = { ...data, markets: (data.markets || []).slice(0, 80) };
    localStorage.setItem(MARKETS_SEED_PREFIX + cacheKey, JSON.stringify({ ts: Date.now(), data: slim }));
  } catch (_) { /* quota/private mode — instant paint is best-effort */ }
}

export async function getTokenMarkets(symbol, coingeckoId, opts = {}) {
  const key = (symbol || '').toUpperCase();
  if (!key) return { markets: [], source: '' };

  const { address = null, onPartial = null } = opts;
  // Resolve CoinGecko ID upfront so cache key includes it
  const cgId = coingeckoId || SYMBOL_TO_COINGECKO_ID[key] || await resolveCoinGeckoId(key) || '';
  // Include address in the cache key so DEX-only tokens with the same
  // symbol (e.g. multiple "DOGEUS" forks) don't share a cache slot.
  const cacheKey = `${cgId ? `${key}:${cgId}` : key}${address ? `:${String(address).toLowerCase()}` : ''}`;

  const now = Date.now();
  const cached = marketsCache[cacheKey];
  if (cached && (now - cached._ts < MARKETS_CACHE_TTL)) {
    return cached.data;
  }

  // Identity backfill guard: the RZ shell re-invokes this when the token's
  // address resolves a beat after mount, which re-keys the cache
  // (`SYM:cgid` → `SYM:cgid:0x…`) and used to re-run the whole markets
  // chain. The address only feeds the DexScreener fallback (fires when
  // every other source is EMPTY) — so when the address-less variant already
  // produced a populated table this session, reuse it instead of refetching.
  if (address && cgId) {
    const noAddr = marketsCache[`${key}:${cgId}`];
    if (noAddr && (now - noAddr._ts < MARKETS_CACHE_TTL) && noAddr.data?.markets?.length > 0) {
      marketsCache[cacheKey] = noAddr;
      return noAddr.data;
    }
  }

  // Instant paint: hand the caller the last localStorage snapshot right away
  // (stale-while-revalidate) — the live result still resolves below.
  if (onPartial) {
    const seed = _marketsSeedLoad(cacheKey);
    if (seed?.markets?.length) onPartial(seed);
  }

  // Deduplicate concurrent requests for the same token+cgId
  if (marketsInflight[cacheKey]) return marketsInflight[cacheKey];

  const promise = (async () => {
    let spotMarkets = [];
    let fallbackMarkets = [];

    const localViteDev = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

    // Derivatives (perpetual + futures) kick off IN PARALLEL with the spot
    // sources — this call is the slowest in the chain (CG /derivatives is a
    // 200-row list filtered server-side; ~5s on a cold CDN edge) and used to
    // run serially AFTER spot, adding its whole latency to the tab. Prod-only:
    // the local Vite `/api/coingecko/*` proxy points directly at CoinGecko
    // which has no `derivatives-markets?symbol=` pseudo endpoint.
    const derivativesPromise = localViteDev ? Promise.resolve([]) : (async () => {
      try {
        const dRes = await fetch(`${COINGECKO_API}/derivatives-markets?symbol=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10000) });
        if (dRes.ok) {
          const dData = await dRes.json();
          return dData.markets || [];
        }
      } catch (err) { logError('coinGeckoApi:derivativesMarkets', err); }
      return [];
    })();

    // 1. Primary: server-backed token-markets endpoint. Works in dev (Vite
    // proxy → Express → CG tickers w/ depth+volume merge) and prod (vercel.json
    // → /api/data-api?fn=extended-proxy&route=token-markets). The previous
    // `!localViteDev` skip here left the Markets tab empty in dev — verified
    // with `curl /api/token-markets?symbol=BTC&id=bitcoin` returning 30+ rows.
    try {
      let url = `/api/token-markets?symbol=${encodeURIComponent(key)}`;
      if (cgId) url += `&id=${encodeURIComponent(cgId)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const data = await res.json();
        if (data.markets && data.markets.length > 0) {
          spotMarkets = data.markets;
        }
      }
    } catch (err) { logError('coinGeckoApi:tokenMarkets', err); }

    // 2. Fallback: fetch tickers directly via CoinGecko proxy if step 1 came
    // up empty. The proxy chain now goes through Express which adds the
    // Pro API key + shares the cgFetch queue.
    // Available in both dev (`/api/coingecko/*` → Express) and prod
    // (vercel.json `/api/coingecko/:cgpath(.*)`).
    if (spotMarkets.length === 0 && cgId) {
      try {
        const url = `${COINGECKO_API}/coins/${encodeURIComponent(cgId)}/tickers?include_exchange_logo=true&depth=true&order=volume_desc`;
        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const raw = await res.json();
          spotMarkets = processRawTickers(raw.tickers || []);
        }
      } catch (err) { logError('coinGeckoApi:tickers', err); }
    }

    // Spot rows are ready — paint them now instead of holding the whole tab
    // hostage to the (slow) derivatives call still in flight.
    if (onPartial && spotMarkets.length > 0) {
      onPartial({ markets: spotMarkets, source: 'coingecko', partial: true });
    }

    const derivativeMarkets = await derivativesPromise;

    // 5. Spectre profile pairs are sparse. Use them only when the richer
    // market endpoints have no rows, so Research Zone keeps depth, volume share,
    // logos, CEX/DEX/derivatives filters, and full exchange coverage.
    if (fallbackMarkets.length === 0 && spotMarkets.length === 0 && derivativeMarkets.length === 0) {
      try {
        fallbackMarkets = await getSpectreTokenMarkets(key);
      } catch (err) {
        logError('coinGeckoApi:spectreTokenMarketsFallback', err);
      }
    }

    // 6. DexScreener fallback for DEX-only microcaps. Fires only when ALL
    // CG/Spectre sources came back empty AND we have a contract address.
    // Free (no API key, no per-key quota), so cost is essentially zero.
    // This is what populates the Markets tab for new launches like DOGEUS
    // that aren't listed on any CEX or in CG's tickers index.
    if (fallbackMarkets.length === 0 && spotMarkets.length === 0 && derivativeMarkets.length === 0 && address) {
      try {
        // 2026-05-28 hide-apis: same-origin /api/data-api?fn=dexscreener-proxy&route=tokens-raw
        const dsRes = await fetch(`/api/data-api?fn=dexscreener-proxy&route=tokens-raw&address=${encodeURIComponent(address)}`,
          { signal: AbortSignal.timeout(4000) });
        if (dsRes.ok) {
          const dsJson = await dsRes.json();
          const pairs = Array.isArray(dsJson?.pairs) ? dsJson.pairs : [];
          fallbackMarkets = pairs
            .filter(p => p?.baseToken && p?.quoteToken)
            .map(p => {
              const dexSlug = (p.dexId || '').toLowerCase();
              const chainSlug = (p.chainId || '').toLowerCase();
              const dexLabel = DEXSCREENER_DEX_NAMES[dexSlug] || (dexSlug ? dexSlug[0].toUpperCase() + dexSlug.slice(1) : 'DEX');
              const chainLabel = DEXSCREENER_CHAIN_NAMES[chainSlug] || chainSlug.toUpperCase();
              return {
                exchange: chainLabel ? `${dexLabel} (${chainLabel})` : dexLabel,
                pair: `${p.baseToken.symbol || '?'}/${p.quoteToken.symbol || '?'}`,
                base: p.baseToken.symbol,
                quote: p.quoteToken.symbol,
                price: Number(p.priceUsd) || 0,
                volume: Number(p?.volume?.h24) || 0,
                liquidity: Number(p?.liquidity?.usd) || 0,
                tradeUrl: p.url || null,
                type: 'dex',
                trustScore: null,
                spread: null,
                lastTraded: p?.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : null,
                volumePercentage: 0,
                contract: p.pairAddress || null,
              };
            })
            .filter(r => r.liquidity > 100 || r.volume > 100); // dust filter
        }
      } catch (err) { logError('coinGeckoApi:dexscreenerMarkets', err); }
    }

    // Merge spot + derivatives + final fallback, de-duplicate by exchange+pair
    const seen = new Set();
    const merged = [];
    for (const m of [...spotMarkets, ...derivativeMarkets, ...fallbackMarkets]) {
      const k = `${m.exchange}::${m.pair}`;
      if (!seen.has(k)) { seen.add(k); merged.push(m); }
    }

    const source = spotMarkets.length || derivativeMarkets.length ? 'coingecko' : (fallbackMarkets.length ? 'spectre-market-profile' : '');
    const data = { markets: merged, source };
    if (merged.length > 0) {
      marketsCache[cacheKey] = { data, _ts: Date.now() };
      _marketsSeedSave(cacheKey, data);
    }
    return data.markets.length > 0 ? data : { markets: [], source: '' };
  })().finally(() => { delete marketsInflight[cacheKey] });

  marketsInflight[cacheKey] = promise;
  return promise;
}

/**
 * Get full market data for a coin by symbol from the top-1000 cache.
 * Returns data in the same shape as MOCK_TOKEN_DATA so it can be used as a drop-in replacement.
 * @param {string} symbol - e.g. 'HYPE', 'PEPE', 'ARB'
 * @returns {Promise<object|null>}
 */
export async function getCoinMarketDataBySymbol(symbol) {
  const sym = (symbol || '').toUpperCase();
  if (!sym) return null;

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const fromCoin = (coin) => coin ? ({
    rank: coin.market_cap_rank,
    price: coin.current_price || 0,
    change1h: coin.price_change_percentage_1h_in_currency || 0,
    change24h: coin.price_change_percentage_24h || 0,
    change7d: coin.price_change_percentage_7d_in_currency || 0,
    change30d: coin.price_change_percentage_30d_in_currency || 0,
    mcap: coin.market_cap || 0,
    volume24h: coin.total_volume || 0,
    fdv: coin.fully_diluted_valuation || null,
    volMcapPct: coin.market_cap ? ((coin.total_volume || 0) / coin.market_cap * 100).toFixed(1) : '0',
    circulating: coin.circulating_supply || null,
    maxSupply: coin.max_supply || coin.total_supply || null,
    ath: coin.ath || null,
    athDate: fmtDate(coin.ath_date),
    athChangePct: coin.ath_change_percentage || null,
    atl: coin.atl || null,
    atlDate: fmtDate(coin.atl_date),
    atlChangePct: coin.atl_change_percentage || null,
    score: null,
    low24h: coin.low_24h || null,
    high24h: coin.high_24h || null,
    _image: coin.image || null,
    _name: coin.name || sym,
    _coingeckoId: coin.id || null,
    sparkline7d: Array.isArray(coin.sparkline_in_7d?.price) ? coin.sparkline_in_7d.price : null,
  }) : null;

  const cachedCoin = allCoinsCache.data.find(c => (c.symbol || '').toUpperCase() === sym);
  if (cachedCoin && Date.now() - allCoinsCache._ts < topCoinsCacheTTL) {
    return fromCoin(cachedCoin);
  }

  try {
    const spectrePrices = await getSpectrePricesBySymbols([sym]);
    const spectre = spectrePrices?.[sym];
    if (spectre?.price > 0) {
      return {
        rank: spectre.rank,
        price: spectre.price,
        change1h: spectre.change1h || 0,
        change24h: spectre.change24 || spectre.change || 0,
        change7d: spectre.change7d || 0,
        change30d: spectre.change30d || 0,
        mcap: spectre.marketCap || 0,
        volume24h: spectre.volume || 0,
        fdv: spectre.fdv || null,
        volMcapPct: spectre.marketCap ? (((spectre.volume || 0) / spectre.marketCap) * 100).toFixed(1) : '0',
        circulating: spectre.circulatingSupply || null,
        maxSupply: spectre.maxSupply || spectre.totalSupply || null,
        ath: spectre.ath?.price || spectre.ath || null,
        athDate: fmtDate(spectre.ath?.date || spectre.athDate),
        athChangePct: spectre.ath?.change_pct || null,
        atl: spectre.atl?.price || spectre.atl || null,
        atlDate: fmtDate(spectre.atl?.date || spectre.atlDate),
        atlChangePct: spectre.atl?.change_pct || null,
        score: spectre.scores?.spectre ?? null,
        low24h: spectre.low24h || null,
        high24h: spectre.high24h || null,
        _image: spectre.image || null,
        _name: spectre.name || sym,
        _coingeckoId: spectre.coingeckoId || null,
        sparkline7d: null,
        _source: 'spectre-market',
      };
    }
  } catch (err) {
    logError('coinGeckoApi:spectreSingleCoinMarket', err);
  }

  const cgId = SYMBOL_TO_COINGECKO_ID[sym] || await resolveCoinGeckoId(sym).catch(() => null);
  if (cgId) {
    try {
      const url = `${COINGECKO_API}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(cgId)}&order=market_cap_desc&per_page=1&page=1&sparkline=true&price_change_percentage=1h,24h,7d,30d,1y`;
      const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        const coin = Array.isArray(data) ? data[0] : null;
        if (coin) return fromCoin(coin);
      }
    } catch (err) { logError('coinGeckoApi:singleCoinMarket', err); }
  }

  return fromCoin(cachedCoin);
}

export default {
  getMajorTokenPrices,
  searchMajorTokens,
  getMajorTokenData,
  getCoinDetails,
  getCoinMarketDataBySymbol,
  searchCoinsForROI,
  getSimplePrices,
  getCoinROIData,
  getCategories,
  getCategoryCoins,
  getTokenMarkets,
  resolveCoinGeckoId,
};
