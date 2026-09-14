/**
 * Custom React Hooks for Market Data
 * Data source: Codex API (codexApi.js) - single source of truth
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  getNetworkName,
  formatLargeNumber,
  formatPrice,
  KNOWN_TOKENS,
  getDetailedTokenInfo,
  searchTokens,
  getTrendingTokens,
  getMostVisited,
  getBars,
  getLatestTrades,
  fetchTopCoins,
  getTokenPricesBySymbols,
  inferNetworkId,
  getCoinGeckoDetail,
  hasSnapshotPending,
  fetchTokenSnapshot,
} from '../services/codexApi';
import { resolveMajorCgId } from '../lib/majorTokens';
import { getSavedChartResolution } from '../lib/chartTimeframes';
import { isAppActive, subscribeActivity } from '../lib/idleManager';
import { tokenPlaceholder } from '../utils/tokenPlaceholder';
import { whenIdle } from '../utils/whenIdle';
import { seedColorCache } from '../utils/tokenColors';
import { readHotSnapshot } from '../lib/tokenHotCache';
import { subscribe as streamSubscribe } from '../services/codexStreamApi';

// L5-charts-B (2026-06-03): SSE bar-update fan-out kill switch. When set,
// the chart falls back to pure polling (no SSE last-bar updates).
//   localStorage.L5_PR_DISABLE_SSE = '1' — persistent disable for this user
//   import.meta.env.VITE_DISABLE_SSE_CHARTS = '1' — build-time disable
function _sseDisabled() {
  try {
    if (import.meta.env?.VITE_DISABLE_SSE_CHARTS === '1') return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('L5_PR_DISABLE_SSE') === '1') return true;
  } catch (_) { /* SSR / private mode */ }
  return false;
}

// Bar duration in seconds for each resolution. Mirrors TradingViewAdvanced's
// RES_SECONDS so the SSE bar-rollover logic produces buckets aligned with
// the existing polling/cache machinery.
const _RES_SECONDS = {
  '1S': 1, 'S': 1,
  '1': 60, '5': 300, '15': 900, '30': 1800,
  '60': 3600, '240': 14400, '720': 43200,
  '1D': 86400, 'D': 86400,
  '1W': 604800, 'W': 604800,
  '1M': 2592000, 'M': 2592000,
};

// Codex emits EVM addresses lowercase; Solana base58 mints stay cased.
// We MUST match what the SSE payload reports verbatim or every tick gets
// dropped silently.
function _normalizeAddress(rawAddr) {
  if (!rawAddr) return null;
  const isSolana = !rawAddr.startsWith('0x') && rawAddr.length >= 32;
  return isSolana ? rawAddr : rawAddr.toLowerCase();
}

// Extract (address, networkId) from a chart symbol that may be:
//   "0xabc...:1" composite, or
//   "0xabc..." / base58 raw, or
//   a ticker like "BTC" (return null — no SSE for CEX tickers).
function _addressFromSymbol(symbol, networkId) {
  if (!symbol) return null;
  if (typeof symbol === 'string' && symbol.includes(':')) {
    const [rawAddr, netStr] = symbol.split(':');
    const addr = _normalizeAddress(rawAddr);
    const net = parseInt(netStr) || networkId || 1;
    if (addr && net) return { address: addr, networkId: net };
  }
  if (typeof symbol === 'string' && (symbol.startsWith('0x') || symbol.length >= 32)) {
    const addr = _normalizeAddress(symbol);
    if (addr && networkId) return { address: addr, networkId };
  }
  return null;
}

// Kill isolated single-bar price spikes (bad DEX prints) before they reach the
// chart and blow out the y-axis. Raw Codex getBars (DEX OHLCV) occasionally
// returns one anomalous bar whose wick stabs 2x+ past the local price - a single
// mis-priced trade on a low-liquidity pool.
// When detected, the offending O/H/L/C is pulled back to the nearest TRUSTED
// (in-band) extreme in the window, so the spike vanishes and the real local range
// shows. Bodies are clamped too so a spike that lands in the body can't survive.
//
// The old premise - "a GENUINE move drags the local median with it, so it never
// exceeds 2x of that median" - is FALSE for a step change. On a rug or a launch
// the +-6 window straddles both regimes, so the median stays on the old side and
// this clamp "corrects" the real new price back to the old one. Measured on
// KUNGFU (vVzBpN7...pump) 5m: it rewrote 6 of 10 real bars - the 36x rug bar had
// its low/close pulled UP 32x, and the untouched post-rug bar after it was
// flattened onto the pre-crash level. The chart then shows no crash at all.
// So the median only decides WHAT to look at; whether a bar is a bad print is
// decided by _seriesFollows() - a bad print is an island the next bar ignores,
// a real move is one the next bar trades at. Same rule as the server-side
// sanitizeBars() in api/_lib/bars-router.js; the two must agree or the canvas
// and TradingView engines render different candles for the same token.
function _seriesFollows(bars, i) {
  const c = bars[i]?.close;
  if (!(c > 0)) return false;
  const nxt = bars[i + 1];
  if (!nxt) {
    // live edge: nothing downstream to corroborate it yet. A real move is
    // backed by trades; a bad print is a tick with nothing behind it.
    return bars[i].volume > 0;
  }
  const nl = nxt.low, nh = nxt.high;
  if (!(nl > 0 && nh > 0)) return false;
  // generous 25x tolerance: we only need to tell "the series went here" from
  // "the series ignored this", not to police normal bar-to-bar movement.
  return c >= nl / 25 && c <= nh * 25;
}

export function _clampSpikes(bars) {
  if (!Array.isArray(bars) || bars.length < 5) return bars;
  const W = 6;   // window radius for the local reference median
  const R = 2;   // a value beyond R x the local median close is a bad print
  const n = bars.length;
  const closes = bars.map(b => b.close);
  let mutated = false;
  const out = bars.slice();
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - W), hi = Math.min(n, i + W + 1);
    const win = [];
    for (let j = lo; j < hi; j++) { const c = closes[j]; if (c > 0) win.push(c); }
    if (win.length < 4) continue;
    win.sort((a, z) => a - z);
    const med = win[win.length >> 1];
    if (!(med > 0)) continue;
    const hiCap = med * R, loCap = med / R;
    const b = out[i];
    let { open, high, low, close } = b;
    if (!(high > hiCap || (low > 0 && low < loCap) || open > hiCap || open < loCap || close > hiCap || close < loCap)) {
      continue;
    }
    // Out of band - but is it a bad print, or a real step the series followed?
    if (_seriesFollows(bars, i)) continue;
    // Trusted extremes = the widest in-band high/low among the window's bars.
    let tHigh = 0, tLow = Infinity;
    for (let j = lo; j < hi; j++) {
      const r = bars[j];
      if (r.high > 0 && r.high <= hiCap) tHigh = Math.max(tHigh, r.high);
      if (r.low > 0 && r.low >= loCap) tLow = Math.min(tLow, r.low);
    }
    if (!(tHigh > 0)) tHigh = hiCap;
    if (!isFinite(tLow)) tLow = loCap;
    if (high > hiCap) high = tHigh;
    if (open > hiCap) open = tHigh;
    if (close > hiCap) close = tHigh;
    if (low > 0 && low < loCap) low = tLow;
    if (open < loCap) open = tLow;
    if (close < loCap) close = tLow;
    // keep the body inside the wicks
    high = Math.max(high, open, close);
    low = Math.min(low, open, close);
    out[i] = { ...b, open, high, low, close };
    mutated = true;
  }
  return mutated ? out : bars;
}

// Convert server bars-route output ({ s, o, h, l, c, t, volume } or raw
// tuples) into the in-memory shape useChartData expects: { time(ms), o, h, l, c, v }
function _normaliseBars(raw) {
  if (!Array.isArray(raw)) return [];
  const mapped = raw.map(b => {
    if (Array.isArray(b)) {
      const [t, o, h, l, c, v] = b;
      return { time: (t || 0) * 1000, open: o || 0, high: h || 0, low: l || 0, close: c || 0, volume: v || 0 };
    }
    if (b && typeof b === 'object') {
      const t = b.t || b.time || 0;
      return {
        time: t < 1e12 ? t * 1000 : t,
        open: parseFloat(b.o ?? b.open) || 0,
        high: parseFloat(b.h ?? b.high) || 0,
        low: parseFloat(b.l ?? b.low) || 0,
        close: parseFloat(b.c ?? b.close) || 0,
        volume: parseFloat(b.v ?? b.volume) || 0,
      };
    }
    return null;
  }).filter(Boolean);
  return _clampSpikes(mapped);
}

// NO STATIC TRENDING FALLBACK. There used to be a hardcoded TRENDING_FALLBACK_TOKENS
// list here (PEPE $5.00B +5.00%, UNI $6.00B +2.00%, AAVE, LINK, SHIB, ONDO, FET,
// WIF, BONK, JUP) that seeded the initial state and was returned on an empty or
// failed fetch. Every number in it was invented, and because the empty-response
// path also called setError(null), consumers had no way to tell it was not real -
// so the ticker, the Discover table and the command palette all rendered a
// fabricated board as live market data on any cold load or Codex hiccup.
//
// The server already settled this policy during the 2026-07-16 Codex blackout:
// "real-but-short beats fake-but-full; when the fallback is also down, an honest
// empty board beats both" (see the degraded path in apps/trading/api/codex.js).
// The client now follows it. Every consumer has a loading + empty state:
// TokenDiscoveryTable has tableLoading/emptyMessage, TokenTicker guards on
// displayTokens.length, the palette slices an empty array.
//
// Do not reintroduce placeholder market data anywhere in this file.

const DEFAULT_NETWORK_IDS = [1, 56, 1399811149];

// Module-level trending cache + in-flight dedup (prevents 3 components from making 3 requests)
const _trendingCache = new Map() // cacheKey -> { data, ts }
const _trendingInflight = new Map() // cacheKey -> Promise
const TRENDING_CACHE_TTL = 60000 // 60s - server caches for 2min anyway

/* ── Known-empty chains ────────────────────────────────────────────────────
   A SUCCESSFUL trending response with zero rows is real data ("nothing is
   trending on this chain right now"), and it is cached like any other result
   so a chain switch paints the honest empty board instantly instead of
   shimmering through another cold round-trip. Only a genuine FAILURE
   (getTrendingTokens -> null) is left uncached, so one blip can never blank a
   live chain for the whole TTL.

   The module cache dies with the page, so the background warm loop would
   re-pay every dead chain on every load. Measured cold (prod, 2026-08-04):
   ARB 3.2s, AVAX 1.0s, OP 1.0s, HOOD 1.1s - all 0 rows, ~6.2s of upstream
   work per visitor for nothing. This memo persists that verdict across loads
   so the BACKGROUND warm skips them. It never gates a user-intent fetch:
   hovering or clicking the chain still fires, and one non-empty response
   clears the entry immediately. */
const EMPTY_CHAIN_MEMO_KEY = 'spectre-trending-empty-v1'
const EMPTY_CHAIN_MEMO_TTL = 30 * 60 * 1000 // 30min - re-probe a dead chain twice an hour

function _readEmptyMemo() {
  try {
    const raw = localStorage.getItem(EMPTY_CHAIN_MEMO_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function _writeEmptyMemo(memo) {
  try {
    localStorage.setItem(EMPTY_CHAIN_MEMO_KEY, JSON.stringify(memo))
  } catch {
    /* quota / disabled storage - the memo is an optimisation, never required */
  }
}

/** Was this exact board empty on a recent successful fetch? */
function _isKnownEmptyChain(cacheKey) {
  const ts = _readEmptyMemo()[cacheKey]
  return typeof ts === 'number' && Date.now() - ts < EMPTY_CHAIN_MEMO_TTL
}

/** Record the outcome of a SUCCESSFUL fetch (empty -> remember, rows -> forget). */
function _noteChainOutcome(cacheKey, isEmpty) {
  const memo = _readEmptyMemo()
  if (isEmpty) {
    if (memo[cacheKey] && Date.now() - memo[cacheKey] < EMPTY_CHAIN_MEMO_TTL) return // already fresh
    memo[cacheKey] = Date.now()
  } else if (memo[cacheKey] == null) {
    return // nothing to clear
  } else {
    delete memo[cacheKey]
  }
  _writeEmptyMemo(memo)
}

// Shared mapper: Codex/enriched trending rows -> UI shape, in server trendScore
// order. Used by both the live hook fetch and prefetchTrending so a prefetched
// board lands in the cache in the EXACT shape the hook renders.
function _mapTrendingResults(codexRes) {
  const numN = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null }
  const mapped = (codexRes.filterTokens.results || []).map((r, i) => ({
    symbol: r.token?.symbol || r.symbol || 'UNKNOWN',
    name: r.token?.name || r.name || '',
    address: r.token?.address || r.address || '',
    networkId: inferNetworkId(r.token?.address || r.address, r.token?.networkId || r.networkId),
    network: getNetworkName(inferNetworkId(r.token?.address || r.address, r.token?.networkId || r.networkId)),
    price: parseFloat(r.priceUSD || r.price) || 0,
    change: parseFloat(r.change24 || r.change) || 0,
    // null (NOT 0) where a window has no data -> renders "-" not "0.00%".
    change5m: numN(r.change5m),
    change1h: numN(r.change1 ?? r.change1h),
    change6h: numN(r.change6h),
    change24h: numN(r.change24 ?? r.change),
    volume24h: parseFloat(r.volume24 || r.volume24h) || 0,
    liquidity: parseFloat(r.liquidity) || 0,
    marketCap: parseFloat(r.marketCap) || 0,
    txnCount24: r.txnCount24 != null ? Number(r.txnCount24) : null,
    buys24: r.buys24 != null ? Number(r.buys24) : null,
    sells24: r.sells24 != null ? Number(r.sells24) : null,
    createdAt: r.createdAt ? Number(r.createdAt) : null,
    // Real holder counts. The Codex trending query omits holders (the
    // listPairsWithMetadata lockstep tax), so this is null on most chains and
    // the column honestly renders "-". Robinhood Chain supplies real counts
    // from the chain's own explorer, which is why the field is carried at all.
    holders: r.holders != null ? Number(r.holders) : null,
    trendScore: r.trendScore != null ? Number(r.trendScore) : null,
    // 'moving' = actually trending; 'active' = real trading, flat price.
    tier: r.tier || 'moving',
    logo: r.token?.info?.imageThumbUrl || r.token?.logo || tokenPlaceholder(r.token?.symbol || r.symbol),
    // About column on the trending board (replaced AI Read 2026-08-17): thin
    // Codex token metadata selected on the same trending query - no extra call.
    description: r.token?.info?.description || r.description || null,
    twitter: r.token?.socialLinks?.twitter || r.twitter || null,
    telegram: r.token?.socialLinks?.telegram || r.telegram || null,
    website: r.token?.socialLinks?.website || r.website || null,
    rank: i + 1,
    // Preserve the server's per-row source: the degraded-mode Hetzner partial
    // arrives tagged 'spectre-trending' and must stay distinguishable - blanket
    // 'codex' stamping is how the old fabricated server fallback slipped past
    // the Markets board's real-rows-only filter (2026-07-16 Codex blackout).
    _source: r._source || 'codex',
  }))
  // Preserve the server's traction ranking (trendScore), do NOT re-sort by volume.
  mapped.sort((a, b) => (b.trendScore ?? -Infinity) - (a.trendScore ?? -Infinity))
  mapped.forEach((t, i) => { t.rank = i + 1 })
  return mapped
}

/**
 * Warm a chain's trending board into the shared module cache so switching to it
 * is INSTANT (the slow part is the server's cold compute + DexScreener enrich,
 * ~4-5s; the result is server-cached after, so a prefetch pays that cost in the
 * background). Fire-and-forget; dedups against the cache + in-flight so it never
 * double-fetches, and the in-flight promise resolves to the mapped rows so a
 * mid-flight chain switch reuses it. networkIds order must match the hook's.
 */
export function prefetchTrending(networkIds, timeframe = 'volume', { background = false } = {}) {
  if (!networkIds || !networkIds.length || (typeof document !== 'undefined' && document.hidden)) return Promise.resolve()
  const networkKey = networkIds.join(',')
  const cacheKey = `trending:${networkKey}:${timeframe}`
  const cached = _trendingCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < TRENDING_CACHE_TTL) return Promise.resolve(cached.data)
  // Background warm only: don't re-pay a chain that recently answered empty.
  // A hover/click prefetch is user intent and always goes through.
  if (background && _isKnownEmptyChain(cacheKey)) return Promise.resolve([])
  if (_trendingInflight.has(cacheKey)) return _trendingInflight.get(cacheKey)
  const p = (async () => {
    try {
      // Robinhood Chain is the one network where this endpoint returns the WHOLE
      // chain rather than a trending strip - it is the only surface in the
      // product that lists it, and the hub sorts it locally. 50 rows would
      // amputate a ~170-row board.
      const nets = networkKey.split(',').map(Number)
      const rowLimit = (nets.length === 1 && nets[0] === 4663) ? 250 : 50
      const codexRes = await getTrendingTokens(nets, rowLimit, timeframe)
      // null = the request failed. Leave the cache untouched so the next
      // attempt retries instead of serving a fabricated "empty" board.
      if (!codexRes) return []
      const mapped = codexRes.filterTokens.results.length > 0 ? _mapTrendingResults(codexRes) : []
      // Carry the server's DATA timestamp on the array itself so a cache hit
      // returns it too - consumers age their "Live" readout from this, never
      // from their own fetch time.
      mapped.asOf = codexRes.asOf || Date.now()
      // Successful response (rows OR an honest empty) - cache it either way.
      _trendingCache.set(cacheKey, { data: mapped, ts: Date.now() })
      _noteChainOutcome(cacheKey, mapped.length === 0)
      return mapped
    } catch {
      return []
    } finally {
      _trendingInflight.delete(cacheKey)
    }
  })()
  _trendingInflight.set(cacheKey, p)
  return p
}

/**
 * Hook for fetching trending/top tokens via Codex API
 * @param {number} refreshInterval - ms between refetches (default 60s)
 * @param {number[]} networkIds - chain IDs (default [1, 56, 1399811149])
 * @param {string} timeframe - 'volume' | '24h' | '12h' | '4h' | '1h'
 * @param {object} options
 * @param {boolean} options.deferInitial - idle-defer the MOUNT fetch only.
 *   For decorative consumers (TokenTicker) whose initial paint is already
 *   served by the warm module cache or the curated fallback - keeps the
 *   trending call out of the first-second critical path and means bounce
 *   sessions fire zero trending requests. Poll + visibility wake-up and
 *   chain-change refetches are unaffected. Do NOT pass from interactive
 *   consumers (CommandPalette, TokenDiscoveryTable, LeftPanel).
 */
export function useTrendingTokens(refreshInterval = 60000, networkIds = DEFAULT_NETWORK_IDS, timeframe = 'volume', { deferInitial = false } = {}) {
  // Seed initial state from the module-level cache when available, else EMPTY.
  // It used to seed from a hardcoded token list, which is why a cold load could
  // paint an invented board (PEPE $5.00B, UNI $6.00B...) for the seconds before
  // the real fetch landed. `loading` is true in exactly that window, so every
  // consumer can render a skeleton instead.
  const networkKey = networkIds.join(',');
  const initialCacheKey = `trending:${networkKey}:${timeframe}`;
  const initialCached = _trendingCache.get(initialCacheKey);
  const hasFreshCache = initialCached && Date.now() - initialCached.ts < TRENDING_CACHE_TTL;
  const initialData = hasFreshCache ? initialCached.data : [];

  const [tokens, setTokens] = useState(initialData);
  const [loading, setLoading] = useState(!hasFreshCache);
  const [error, setError] = useState(null);

  const prevNetworkKeyRef = useRef(networkKey);

  // `force=true` bypasses the document.hidden guard. Used for the initial
  // mount fetch + visibilitychange wake-up so a background tab still
  // populates real data once the user focuses it (without waiting for
  // the next 60s interval tick).
  // `fresh=true` (pull-to-refresh) additionally skips the module-cache
  // serve so a user-initiated refresh actually refetches (in-flight dedup
  // still collapses concurrent pulls; server/edge caches bound the cost).
  const fetchTokens = useCallback(async (force = false, { fresh = false } = {}) => {
    // Skip fetch when tab is hidden (unless force=true)
    if (!force && document.hidden) return

    // Check module-level cache first (shared across all useTrendingTokens consumers)
    const cacheKey = `trending:${networkKey}:${timeframe}`
    const cached = _trendingCache.get(cacheKey)
    if (!fresh && cached && Date.now() - cached.ts < TRENDING_CACHE_TTL) {
      setTokens(cached.data)
      setLoading(false)
      setError(null)
      return
    }

    // In-flight dedup: reuse pending request from another component
    if (_trendingInflight.has(cacheKey)) {
      try {
        const result = await _trendingInflight.get(cacheKey)
        if (result?.length) { setTokens(result); setError(null) }
      } catch {} finally { setLoading(false) }
      return
    }

    const fetchPromise = (async () => {
    try {
      const nets = networkKey.split(',').map(Number);

      const codexRes = await getTrendingTokens(nets, 50, timeframe);
      if (!codexRes) {
        // Request FAILED. Render the empty state but cache nothing, so the
        // next tick retries rather than serving a blip as a real empty board.
        setTokens([]);
        setError(null);
        return []
      }
      // Successful response. Rows OR a genuine empty (thin chain, or every
      // candidate was gated) - both are real data, so both are cached. That
      // makes a switch back to an empty chain paint instantly instead of
      // shimmering through another cold round-trip.
      const mapped = codexRes.filterTokens.results.length > 0 ? _mapTrendingResults(codexRes) : []
      _trendingCache.set(cacheKey, { data: mapped, ts: Date.now() })
      _noteChainOutcome(cacheKey, mapped.length === 0)
      setTokens(mapped);
      setError(null);
      return mapped
    } catch (err) {
      console.error('Failed to fetch trending tokens:', err);
      setError(err.message);
      setTokens([]);
      return []
    } finally {
      setLoading(false);
      _trendingInflight.delete(cacheKey)
    }
    })()

    _trendingInflight.set(cacheKey, fetchPromise)
    await fetchPromise
  }, [networkKey, timeframe]);

  // When chain changes, fetch fresh data immediately (keep old tokens visible until new ones arrive)
  useEffect(() => {
    const isChainChange = prevNetworkKeyRef.current !== networkKey;
    if (isChainChange) {
      setLoading(true);
      prevNetworkKeyRef.current = networkKey;
    }
    // Initial / chain-change fetch: force=true so a backgrounded tab
    // still populates instead of waiting up to refreshInterval ms.
    // deferInitial pushes ONLY the mount fetch to idle (chain changes are
    // user-driven and stay immediate); the fetchTokens cache check still
    // short-circuits if another consumer populated the module cache first.
    let cancelIdle = () => {};
    if (deferInitial && !isChainChange) {
      cancelIdle = whenIdle(() => fetchTokens(true), { timeout: 2000 });
    } else {
      fetchTokens(true);
    }
    const interval = setInterval(() => {
      // Skip hidden tabs AND visible-but-idle tabs (idleManager) - both were
      // firing fresh Codex every tick. Focus/interaction resumes via onVis below.
      if (!document.hidden && isAppActive()) fetchTokens();
    }, refreshInterval);
    return () => { cancelIdle(); clearInterval(interval); };
  }, [fetchTokens, refreshInterval]);

  // Visibility wake-up: when the user brings the tab back into focus,
  // immediately reconcile against the latest data (subject to the
  // module cache TTL so we don't hammer Codex on every tab switch).
  useEffect(() => {
    const onVis = () => { if (!document.hidden) fetchTokens(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [fetchTokens]);

  return { tokens, loading, error, refresh: fetchTokens };
}

/**
 * Hook for fetching top coins by market cap via Codex/CoinGecko
 */
export function useTopCoins(limit = 50, refreshInterval = 60000, category = '', { enabled = true } = {}) {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(enabled);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchTopCoins(limit, category);
      if (result && result.length > 0) {
        setTokens(result);
      }
    } catch (err) {
      console.error('useTopCoins error:', err);
    } finally {
      setLoading(false);
    }
  }, [limit, category]);

  useEffect(() => {
    // enabled=false keeps the hook dormant (no mount fetch, no poll) so a
    // consumer that only sometimes needs top coins (e.g. the left rail's
    // "Top Coins" category) doesn't fire the request until it's actually shown.
    if (!enabled) return;
    if (typeof console !== 'undefined') console.count('useTopCoins-mount');
    fetchData();
    const interval = setInterval(() => {
      if (!document.hidden && isAppActive()) fetchData();
    }, refreshInterval);
    const onVis = () => { if (!document.hidden) fetchData(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchData, refreshInterval, enabled]);

  return { tokens, loading };
}

// Module-level Most-Visited cache + dedup (mirrors the trending cache so a tab
// re-entry / chain switch paints from memory instead of re-hitting the server).
const _visitedCache = new Map() // cacheKey -> { data, ts }
const _visitedInflight = new Map() // cacheKey -> Promise
const VISITED_CACHE_TTL = 60000 // 60s

/**
 * Hook for the "Most Visited" tab - real token-page visits on the Trading
 * Platform (recorded via recordTokenView -> /api/tokens/view). The server ranks
 * by 24h view count and returns rows in the SAME shape as trending (with
 * trendScore = view count), so _mapTrendingResults preserves the visit order.
 * Returns an empty list when nothing has been visited yet (the table renders an
 * honest empty state - it does NOT pad with trending).
 *
 * Because the leaderboard is driven by the USER'S OWN clicks, it's stale-while-
 * revalidate: opening the tab / refocusing paints the cache instantly but ALWAYS
 * refetches, so a token you just opened shows up immediately instead of waiting
 * out the cache TTL.
 *
 * @param {number[]} networkIds - chain filter (omit/empty = all chains)
 * @param {number} refreshInterval - ms between refetches (default 60s; <=0 = dormant)
 * @param {number} limit - max rows to request (default 30)
 * @param {string} timeframe - visit window to rank by: '5m'|'1h'|'6h'|'24h'
 */
export function useMostVisited(networkIds = [], refreshInterval = 60000, limit = 30, timeframe = '24h') {
  const networkKey = (networkIds || []).join(',');
  const cacheKey = `visited:${networkKey}:${limit}:${timeframe}`;
  const seeded = _visitedCache.get(cacheKey);
  const hasFresh = seeded && Date.now() - seeded.ts < VISITED_CACHE_TTL;

  const [tokens, setTokens] = useState(hasFresh ? seeded.data : []);
  const [loading, setLoading] = useState(!hasFresh);
  const [error, setError] = useState(null);
  const prevKeyRef = useRef(cacheKey);

  const fetchData = useCallback(async (force = false, revalidate = false) => {
    if (!force && document.hidden) return;
    const key = `visited:${networkKey}:${limit}:${timeframe}`;
    const cached = _visitedCache.get(key);
    if (cached && Date.now() - cached.ts < VISITED_CACHE_TTL) {
      // Paint cache instantly. For a plain poll that's the whole job; for a
      // tab-open / focus revalidate we keep going to refetch fresh so a
      // just-recorded view isn't hidden behind the TTL.
      setTokens(cached.data); setLoading(false); setError(null);
      if (!revalidate) return;
    }
    if (_visitedInflight.has(key)) {
      try { const r = await _visitedInflight.get(key); if (r) setTokens(r); } catch {} finally { setLoading(false); }
      return;
    }
    const p = (async () => {
      try {
        const nets = networkKey ? networkKey.split(',').map(Number) : [];
        const res = await getMostVisited(nets, limit, timeframe);
        const mapped = res?.filterTokens?.results?.length ? _mapTrendingResults(res) : [];
        _visitedCache.set(key, { data: mapped, ts: Date.now() });
        setTokens(mapped); setError(null);
        return mapped;
      } catch (err) {
        setError(err.message);
        return null; // keep the painted list on a transient error
      } finally {
        setLoading(false);
        _visitedInflight.delete(key);
      }
    })();
    _visitedInflight.set(key, p);
    await p;
  }, [networkKey, limit, timeframe]);

  useEffect(() => {
    // refreshInterval <= 0 means the tab is closed -> stay dormant (no fetch,
    // no poll). Visibility-gated per api-patterns.md L. Opening the tab flips the
    // interval positive, this effect re-runs, and we REVALIDATE (force + bypass
    // the cache-hit short-circuit) so the freshly-clicked tokens are reflected.
    if (!(refreshInterval > 0)) return;
    // chain OR timeframe change (cacheKey covers both) -> show loading + refetch
    const isKeyChange = prevKeyRef.current !== cacheKey;
    if (isKeyChange) { setLoading(true); prevKeyRef.current = cacheKey; }
    fetchData(true, true);
    const interval = setInterval(() => {
      if (!document.hidden && isAppActive()) fetchData(false, true);
    }, refreshInterval);
    const onVis = () => { if (!document.hidden) fetchData(false, true); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVis); };
  }, [fetchData, refreshInterval, cacheKey]);

  return { tokens, loading, error, refresh: fetchData };
}

const PRICE_CACHE_KEY = 'spectre_token_prices_cache';

/**
 * Hook for fetching prices for specific token symbols via Codex
 */
export function useCuratedTokenPrices(symbols, refreshInterval = 60000) {
  const [prices, setPrices] = useState(() => {
    try {
      const cached = localStorage.getItem(PRICE_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.timestamp && Date.now() - parsed.timestamp < 5 * 60 * 1000) {
          return parsed.data;
        }
      }
    } catch (e) { console.error(e) }
    return {};
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPrices = useCallback(async () => {
    if (!symbols || symbols.length === 0) return;

    try {
      // Single batched call instead of N parallel ones. A 10-symbol watchlist
      // drops from 10 Codex round-trips/min to 1 per user.
      const batch = await getTokenPricesBySymbols(symbols);

      const priceMap = {};
      for (const symbol of symbols) {
        const upper = String(symbol).toUpperCase();
        const entry = batch[upper];
        if (entry && entry.price > 0) {
          priceMap[upper] = {
            symbol: upper,
            price: entry.price,
            change: entry.change || entry.change24 || 0,
            volume: entry.volume || 0,
            marketCap: entry.marketCap || 0,
          };
        }
      }

      try {
        localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify({
          data: priceMap,
          timestamp: Date.now()
        }));
      } catch (e) { console.error(e) }

      setPrices(priceMap);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch curated token prices:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [symbols]);

  useEffect(() => {
    if (typeof console !== 'undefined') console.count('useCuratedTokenPrices-mount');
    fetchPrices();
    const interval = setInterval(() => {
      if (!document.hidden && isAppActive()) fetchPrices();
    }, refreshInterval);
    const onVis = () => { if (!document.hidden) fetchPrices(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchPrices, refreshInterval]);

  return { prices, loading, error, refresh: fetchPrices };
}

/**
 * Check if string is a contract address (EVM or Solana)
 */
function isContractAddress(str) {
  if (!str) return false;
  if (str.startsWith('0x') && str.length === 42) return true;
  if (str.length >= 32 && str.length <= 44 && !str.startsWith('0x')) {
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
    if (base58Regex.test(str)) return true;
  }
  return false;
}

/**
 * Hook for searching tokens.
 * Returns Codex results instantly, runs enrichment in background.
 */
const searchCache = new Map();
const SEARCH_CACHE_TTL = 30_000;
const SEARCH_CACHE_MAX = 50;
const _searchInflight = new Map(); // In-flight request dedup

// Persistent local token index (same pattern as research app).
// Accumulates every token seen via API so subsequent searches filter locally with 0 API cost.
const TOKEN_INDEX_KEY = 'spectre-token-index-v1';
const TOKEN_INDEX_MAX = 2000;
const _tokenIndex = new Map();
try {
  const raw = localStorage.getItem(TOKEN_INDEX_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) for (const entry of parsed) {
      if (entry?.address) _tokenIndex.set(entry.address.toLowerCase(), entry);
    }
  }
} catch { /* corrupt data */ }
let _indexPersistTimer = null;
function _persistTokenIndex() {
  if (_indexPersistTimer) clearTimeout(_indexPersistTimer);
  _indexPersistTimer = setTimeout(() => {
    try {
      const arr = Array.from(_tokenIndex.values()).slice(-TOKEN_INDEX_MAX);
      localStorage.setItem(TOKEN_INDEX_KEY, JSON.stringify(arr));
    } catch { /* quota exceeded */ }
  }, 1000);
}
function _addToTokenIndex(results) {
  if (!Array.isArray(results) || results.length === 0) return;
  let added = 0;
  for (const r of results) {
    const addr = (r.address || r.ca || '').toLowerCase();
    if (!addr || !r.symbol) continue;
    _tokenIndex.set(addr, {
      symbol: r.symbol,
      name: r.name || r.symbol,
      address: r.address || r.ca,
      networkId: r.networkId || 1,
      network: r.network || null,
      logo: r.logo || null,
      price: r.price || r.priceUSD || 0,
      change: r.change || r.change24 || 0,
      marketCap: r.marketCap || 0,
      liquidity: r.liquidity || 0,
      volume: r.volume || r.volume24 || 0,
    });
    added++;
  }
  if (_tokenIndex.size > TOKEN_INDEX_MAX) {
    const excess = _tokenIndex.size - TOKEN_INDEX_MAX;
    const keys = Array.from(_tokenIndex.keys()).slice(0, excess);
    keys.forEach(k => _tokenIndex.delete(k));
  }
  if (added > 0) _persistTokenIndex();
}

/**
 * Search local token index - returns scored matches by symbol/name/address.
 */
export function searchLocalTokenIndex(query, limit = 15) {
  if (!query || query.length < 1) return [];
  const q = query.toLowerCase();
  const matches = [];
  for (const entry of _tokenIndex.values()) {
    const symLower = (entry.symbol || '').toLowerCase();
    const nameLower = (entry.name || '').toLowerCase();
    const addrLower = (entry.address || '').toLowerCase();
    let score = 0;
    if (addrLower === q) score = 200;
    else if (symLower === q) score = 100;
    else if (nameLower === q) score = 95;
    else if (symLower.startsWith(q)) score = 80;
    else if (nameLower.startsWith(q)) score = 70;
    else if (symLower.includes(q)) score = 50;
    else if (nameLower.includes(q)) score = 40;
    if (score > 0) {
      matches.push({ ...entry, _score: score + Math.min(20, (entry.marketCap || 0) / 1e9) });
    }
  }
  matches.sort((a, b) => b._score - a._score);
  return matches.slice(0, limit);
}

/**
 * Map one API search row (full OR fast tier - same server shape) into the
 * object every search consumer reads. Single normaliser so fast and settled
 * rows are byte-identical - the palette can swap one set for the other
 * without any visual difference beyond fresher numbers.
 */
function _mapApiSearchRow(r) {
  const addr = r.token?.address || r.address || '';
  const nid = inferNetworkId(addr, r.token?.networkId || r.networkId);
  return {
    symbol: r.token?.symbol || r.symbol || '',
    name: r.token?.name || r.name || '',
    address: addr,
    networkId: nid,
    network: getNetworkName(nid),
    price: parseFloat(r.priceUSD || r.price) || 0,
    change: parseFloat(r.change24 || r.change) || 0,
    volume: parseFloat(r.volume24 || r.volume) || 0,
    liquidity: parseFloat(r.liquidity) || 0,
    marketCap: parseFloat(r.marketCap) || 0,
    logo: r.token?.info?.imageThumbUrl || r.token?.logo || '',
    formattedMcap: r.marketCap ? formatLargeNumber(r.marketCap) : 'N/A',
    formattedLiquidity: r.liquidity ? formatLargeNumber(r.liquidity) : 'N/A',
    formattedPrice: r.priceUSD ? formatPrice(r.priceUSD) : 'N/A',
    _source: 'codex',
  };
}

/**
 * Prefetch popular search queries into cache (fire-and-forget on app mount).
 */
const _prefetchDone = { current: false };
export function prefetchPopularSearches() {
  if (_prefetchDone.current) return;
  _prefetchDone.current = true;
  const queries = ['btc', 'eth', 'sol', 'bitcoin', 'pepe', 'doge'];
  queries.forEach(q => {
    const cacheKey = q.toLowerCase();
    if (searchCache.has(cacheKey)) return;
    searchTokens(q, [1, 56, 1399811149, 137, 42161, 8453, 4663])
      .then(codexRes => {
        if (!codexRes?.filterTokens?.results?.length) return;
        const results = codexRes.filterTokens.results.map(_mapApiSearchRow);
        if (results.length > 0) { _cacheResults(cacheKey, results); _addToTokenIndex(results.map(r => ({ ...r, address: r.address }))); }
      })
      .catch(() => {});
  });
}

// Major tokens for instant pinning (no API call needed for matching)
const MAJOR_TOKENS = {
  'BTC': { name: 'Bitcoin', cgId: 'bitcoin', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', networkId: 1 },
  'ETH': { name: 'Ethereum', cgId: 'ethereum', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', networkId: 1 },
  'SOL': { name: 'Solana', cgId: 'solana', address: 'So11111111111111111111111111111111111111112', networkId: 1399811149 },
  'BNB': { name: 'BNB', cgId: 'binancecoin', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', networkId: 56 },
  'DOGE': { name: 'Dogecoin', cgId: 'dogecoin', address: null, networkId: 1 },
  'XRP': { name: 'XRP', cgId: 'ripple', address: null, networkId: 1 },
  'ADA': { name: 'Cardano', cgId: 'cardano', address: null, networkId: 1 },
  'AVAX': { name: 'Avalanche', cgId: 'avalanche-2', address: null, networkId: 1 },
  'DOT': { name: 'Polkadot', cgId: 'polkadot', address: null, networkId: 1 },
  'LINK': { name: 'Chainlink', cgId: 'chainlink', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', networkId: 1 },
  'UNI': { name: 'Uniswap', cgId: 'uniswap', address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', networkId: 1 },
  'AAVE': { name: 'Aave', cgId: 'aave', address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', networkId: 1 },
};

function _getPrefixCachedTrading(query) {
  const lower = query.toLowerCase();
  for (let i = lower.length - 1; i >= 1; i--) {
    const prefix = lower.slice(0, i);
    const cached = searchCache.get(prefix);
    if (cached && (Date.now() - cached.timestamp) < SEARCH_CACHE_TTL) {
      return cached.results.filter(r =>
        (r.symbol || '').toLowerCase().includes(lower) ||
        (r.name || '').toLowerCase().includes(lower) ||
        (r.address || '').toLowerCase() === lower
      );
    }
  }
  return null;
}

function _sortResults(results, searchQuery) {
  const isAddr = isContractAddress(searchQuery);
  return results.sort((a, b) => {
    if (a._isMajor && !b._isMajor) return -1;
    if (!a._isMajor && b._isMajor) return 1;
    if (isAddr) {
      const aMatch = (a.address || '').toLowerCase() === searchQuery.toLowerCase();
      const bMatch = (b.address || '').toLowerCase() === searchQuery.toLowerCase();
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
    }
    const aMcap = a.marketCap || 0;
    const bMcap = b.marketCap || 0;
    if (aMcap > 0 && bMcap > 0) return bMcap - aMcap;
    if (aMcap === 0 && bMcap > 0) return -1;
    if (bMcap === 0 && aMcap > 0) return 1;
    return 0;
  });
}

// Search-quality floor. Codex/Hetzner text-search returns EVERY token whose
// name/symbol matches, so a trending name ("cashcat", "robinhood") surfaces
// dozens of dead-dust copycats + impersonation scams next to the real token.
// We drop rows that are dead on ALL of mcap + 24h-volume + liquidity (anything
// with real value on ANY axis survives), and cap same-symbol clones to the top
// few by market cap so 15 identical "CASHCAT" rows collapse to the tradeable
// ones. Majors and exact contract-address matches are NEVER filtered.
const DUST_MCAP = 50_000;   // $
const DUST_VOL = 25_000;    // $ 24h
const DUST_LIQ = 10_000;    // $
const MAX_PER_SYMBOL = 4;

function _isDustRow(r) {
  const mc = r.marketCap || 0, vol = r.volume || 0, liq = r.liquidity || 0;
  // All three unknown (0) = un-enriched row, not proven dust - keep it so the
  // background enrichment can fill it in. Only rows with REAL but tiny values
  // on every axis are treated as dust.
  if (mc === 0 && vol === 0 && liq === 0) return false;
  return mc < DUST_MCAP && vol < DUST_VOL && liq < DUST_LIQ;
}

// Sort (existing mcap ranking) then strip dust + cap same-symbol clones.
function _rankResults(results, searchQuery) {
  const sorted = _sortResults(results, searchQuery);
  const q = (searchQuery || '').toLowerCase();
  const perSymbol = new Map();
  const out = [];
  for (const r of sorted) {
    const protectedRow = r._isMajor || (r.address || '').toLowerCase() === q;
    if (!protectedRow) {
      if (_isDustRow(r)) continue;
      const sym = (r.symbol || '').toUpperCase();
      const n = perSymbol.get(sym) || 0;
      if (n >= MAX_PER_SYMBOL) continue;
      perSymbol.set(sym, n + 1);
    }
    out.push(r);
  }
  return out;
}

function _cacheResults(key, results) {
  searchCache.set(key, { results, timestamp: Date.now() });
  if (searchCache.size > SEARCH_CACHE_MAX) {
    const firstKey = searchCache.keys().next().value;
    searchCache.delete(firstKey);
  }
}

// Leading-edge fast-tier throttle: at most one fast fire per this window.
// GMGN fires on the FIRST keystroke and aborts stale requests - we fire on
// the first keystroke and let the generation counter discard stale results.
const FAST_FIRE_INTERVAL_MS = 120;
// Delay before the single fast-tier re-fire after an empty response. Long
// enough that the upstream the first call warmed is actually ready, short
// enough to still beat a slow settled tier.
const FAST_RETRY_MS = 450;

export function useTokenSearch(query, debounceMs = 150) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const enrichAbortRef = useRef(null);
  // Fast/settled ordering (GMGN-parity search):
  //   genRef        - bumps on every query change
  //   settledGenRef - the last generation a SETTLED (full-chain) result
  //                   painted for. A fast result may only paint while its
  //                   own generation is current AND no settled result of
  //                   that generation has landed - fast can never overwrite
  //                   settled, and old generations can never overwrite new.
  const genRef = useRef(0);
  const settledGenRef = useRef(0);
  const lastFastFireRef = useRef(0);
  const fastTimerRef = useRef(null);

  useEffect(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    if (enrichAbortRef.current) enrichAbortRef.current.abort();

    const trimmedQuery = query?.trim() || '';
    const gen = ++genRef.current;

    if (!trimmedQuery || trimmedQuery.length < 1) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const cacheKey = trimmedQuery.toLowerCase();

    // Exact cache hit - instant return. Cached entries are settled-grade:
    // mark the generation settled so a late fast response can't repaint.
    const cached = searchCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < SEARCH_CACHE_TTL) {
      settledGenRef.current = gen;
      setResults(cached.results);
      setLoading(false);
      setError(null);
      return;
    }

    // Prefix cache - show filtered previous results while loading
    const prefixResults = _getPrefixCachedTrading(trimmedQuery);
    if (prefixResults && prefixResults.length > 0) {
      setResults(prefixResults);
    }

    setLoading(true);
    setError(null);

    // FAST tier - leading-edge fire (no debounce wait). Server contract:
    // Hetzner-only, never Codex, edge-cached. Results paint immediately
    // through the SAME row shape as settled results; `loading` stays true
    // so the palette chrome behaves exactly as during a prefix-cache paint.
    // Fast rows are NEVER written to searchCache or the token index - they
    // are not settled-grade (the cache-poisoning rule, client side).
    if (trimmedQuery.length >= 2 && !isContractAddress(trimmedQuery)) {
      /* The fast tier runs on a hard 500ms upstream budget and returns an empty
         list when the upstream misses it. Measured on prod (2026-08-04), the
         FIRST call for a term reliably misses and the next one lands, because
         the miss warmed the upstream:

             try1 1117ms 0 rows | try2 698ms 1 row | try3 6ms | try4 2ms

         The server never caches an empty, so nothing remembers the miss, and
         the client fired once and gave up - leaving the user on prefix-cache
         rows until the settled tier landed (measured 87ms to 11s). One cheap
         re-fire converts that into results at ~1.5s. Bounded to a single retry
         per query generation, and only while that query is still the current
         one and no settled result has landed. */
      let fastRetried = false;
      const fireFast = () => {
        lastFastFireRef.current = Date.now();
        searchTokens(trimmedQuery, [1, 56, 1399811149, 137, 42161, 8453, 4663], { fast: true })
          .then((res) => {
            if (genRef.current !== gen || settledGenRef.current >= gen) return;
            const rows = res?.filterTokens?.results || [];
            if (rows.length === 0) {
              if (fastRetried) return;
              fastRetried = true;
              fastTimerRef.current = setTimeout(() => {
                if (genRef.current !== gen || settledGenRef.current >= gen) return;
                fireFast();
              }, FAST_RETRY_MS);
              return;
            }
            setResults(_rankResults(rows.map(_mapApiSearchRow), trimmedQuery));
          })
          .catch(() => { /* fast tier is best-effort - settled tier follows */ });
      };
      if (fastTimerRef.current) clearTimeout(fastTimerRef.current);
      const sinceLast = Date.now() - lastFastFireRef.current;
      if (sinceLast >= FAST_FIRE_INTERVAL_MS) {
        fireFast();
      } else {
        // Throttled: the timer carries the LATEST query (this closure is
        // recreated per keystroke; older timers are cleared above).
        fastTimerRef.current = setTimeout(fireFast, FAST_FIRE_INTERVAL_MS - sinceLast);
      }
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(async () => {
      const searchQuery = trimmedQuery;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        // Primary Codex search with in-flight dedup
        let allResults = [];
        let codexRes;
        const existing = _searchInflight.get(cacheKey);
        if (existing) {
          codexRes = await existing;
        } else {
          const searchPromise = searchTokens(searchQuery, [1, 56, 1399811149, 137, 42161, 8453, 4663]);
          _searchInflight.set(cacheKey, searchPromise);
          try {
            codexRes = await searchPromise;
          } finally {
            _searchInflight.delete(cacheKey);
          }
        }
        if (controller.signal.aborted) return;

        if (codexRes?.filterTokens?.results?.length > 0) {
          allResults = codexRes.filterTokens.results.map(_mapApiSearchRow);
        }

        // Pin major token to top if exact symbol match (no extra API call)
        const upperQuery = searchQuery.toUpperCase();
        const majorMatch = MAJOR_TOKENS[upperQuery];
        if (majorMatch && !isContractAddress(searchQuery)) {
          // Find in existing results or create placeholder
          const existingIdx = allResults.findIndex(r => r.symbol?.toUpperCase() === upperQuery);
          if (existingIdx >= 0) {
            allResults[existingIdx]._isMajor = true;
          } else if (majorMatch.address) {
            allResults.unshift({
              symbol: upperQuery,
              name: majorMatch.name,
              address: majorMatch.address,
              networkId: majorMatch.networkId,
              network: getNetworkName(majorMatch.networkId),
              price: 0, change: 0, volume: 0, liquidity: 0, marketCap: 0,
              logo: tokenPlaceholder(upperQuery),
              formattedMcap: 'N/A', formattedLiquidity: 'N/A', formattedPrice: 'N/A',
              _source: 'codex', _isMajor: true,
            });
          }
        }

        const sorted = _rankResults(allResults, searchQuery);

        // Show results immediately. Settled-grade: mark the generation so a
        // straggling fast-tier response can never repaint over this.
        settledGenRef.current = gen;
        setResults(sorted);
        setLoading(false);
        setError(sorted.length === 0 && isContractAddress(searchQuery) ? 'Token not found on any network' : null);
        _cacheResults(cacheKey, sorted);
        _addToTokenIndex(sorted);

        // Background enrichment for results missing price/logo
        // Only enrich tokens missing ALL key data (price + logo + marketCap) - not just one field
        const needsEnrich = sorted.filter(r => r.address && !r.price && !r.logo && !r.marketCap).slice(0, 3);
        if (needsEnrich.length > 0 || (majorMatch?.address && sorted.find(r => r._isMajor && !r.price))) {
          const enrichController = new AbortController();
          enrichAbortRef.current = enrichController;

          const runEnrich = async () => {
            const toEnrich = [...needsEnrich];
            const majorResult = sorted.find(r => r._isMajor && !r.price);
            if (majorResult && majorMatch?.address) toEnrich.unshift(majorResult);

            await Promise.allSettled(toEnrich.map(async (r) => {
              try {
                if (enrichController.signal.aborted) return;
                const details = await getDetailedTokenInfo(r.address, r.networkId);
                if (!details || enrichController.signal.aborted) return;
                if (!r.price) { r.price = parseFloat(details.priceUSD || details.price) || 0; r.formattedPrice = r.price ? formatPrice(r.price) : 'N/A'; }
                if (!r.marketCap) { r.marketCap = parseFloat(details.marketCap) || 0; r.formattedMcap = r.marketCap ? formatLargeNumber(r.marketCap) : 'N/A'; }
                if (!r.liquidity) { r.liquidity = parseFloat(details.liquidity) || 0; r.formattedLiquidity = r.liquidity ? formatLargeNumber(r.liquidity) : 'N/A'; }
                if (!r.change) r.change = parseFloat(details.change24) || 0;
                if (!r.logo) r.logo = details.logo || details.imageUrl || '';
              } catch { /* enrichment failed - keep partial data */ }
            }));

            if (!enrichController.signal.aborted) {
              setResults([...sorted]);
              _cacheResults(cacheKey, sorted);
              _addToTokenIndex(sorted);
            }
          };

          runEnrich();
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Token search failed:', err);
        setResults([]);
        setError(err.message);
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (fastTimerRef.current) clearTimeout(fastTimerRef.current);
    };
  }, [query, debounceMs]);

  return { results, loading, error };
}

/**
 * Hook for fetching detailed token stats via Codex
 */
export function useTokenStats(address, networkId = 1) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    if (!address) return;

    try {
      setLoading(true);
      const res = await getDetailedTokenInfo(address, networkId);
      if (res) {
        setStats({
          symbol: res.symbol,
          name: res.name,
          address: res.address || address,
          decimals: res.decimals,
          totalSupply: res.totalSupply,
          circulatingSupply: res.circulatingSupply,
          logo: res.imageLargeUrl || res.imageThumbUrl || res.logo || null,
        });
        setError(null);
      }
    } catch (err) {
      console.error('Failed to fetch token stats:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [address, networkId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, loading, error, refresh: fetchStats };
}

// In-memory cache for chart bars (prefetched at click time)
const chartBarsCache = new Map();
const CHART_CACHE_TTL = 300000; // 5 minutes - matches server countback cache TTL
// First-paint recent-window size. Overfills the ~160-bar fitted viewport with
// scroll buffer while keeping the cold Codex fetch bounded+fast (a from=0 wide
// probe is ~7x slower cold - see prefetchChartBars). Older history lazy-loads
// on scroll-back. Matches the Axiom(300)/GMGN(501) fixed-window pattern.
// Exported so TradingViewAdvanced's cold-path first fetch uses the SAME window
// -> same server KV bucket as the prefetch -> a cache HIT when they race.
export const FIRST_PAINT_BARS = 350;

// Canonical chart-cache key: ADDRESS IS ALWAYS LOWERCASED. The prefetch
// path historically received checksummed EVM addresses while hooks passed
// lowercased ones (or vice versa), so the same bars were fetched twice
// under two casings. Lowercasing is safe for keys (Solana base58 stays
// case-sensitive only in fetch URLs, never in our cache keys).
const _chartBarsKey = (address, networkId, resolution, suffix) =>
  `${String(address || '').toLowerCase()}-${networkId}-${resolution}-${suffix}`;

// Bar normalisation: reuse the module-level _normaliseBars (top of file) -
// it handles both the getBars object shape and raw tuples. Do NOT add a
// second bar mapper here; prefetch + snapshot seeding must share it.

/**
 * Look up cached bars under the prefetch key (-countback) AND the
 * useChartData key (-${periodHours}). prefetchChartBars writes the
 * former; useChartData reads/writes the latter. Both shapes contain
 * the same bar format — countback prefetch returns 300 bars, periodHours
 * fetch returns ~168 bars; either is fine for the initial paint, the
 * background refresh will reconcile if the user zooms out.
 *
 * Returns { entry, key } so callers can both consume the bars and write
 * back under the matching key if they want to dedupe future fetches.
 */
function _lookupChartCache(address, networkId, resolution, periodHours) {
  const exactKey = _chartBarsKey(address, networkId, resolution, periodHours);
  const exact = chartBarsCache.get(exactKey);
  if (exact && (Date.now() - exact.timestamp) < CHART_CACHE_TTL) {
    return { entry: exact, key: exactKey };
  }
  const countbackKey = _chartBarsKey(address, networkId, resolution, 'countback');
  const countback = chartBarsCache.get(countbackKey);
  if (countback && (Date.now() - countback.timestamp) < CHART_CACHE_TTL) {
    return { entry: countback, key: countbackKey };
  }
  return { entry: null, key: exactKey };
}

/**
 * Seed the -countback chart-bars cache from bars fetched OUTSIDE this module
 * (TVA's warmTimeframes write-through, 2026-07-23). The TVA warm used to fill
 * only its closure-internal resolutionCaches, invisible to this cache - so the
 * TF-pill hover-prefetch re-fetched a resolution TVA already held, and a
 * TV->canvas engine switch couldn't reuse the warm. Bars must be the in-memory
 * shape ({ time(ms), open, high, low, close, volume }) - TVA's fetchBars output
 * matches _normaliseBars byte-for-byte.
 */
export function seedChartBarsCache(address, networkId, resolution, bars) {
  if (!address || !Array.isArray(bars) || bars.length === 0) return;
  chartBarsCache.set(_chartBarsKey(address, networkId, resolution, 'countback'), { bars, timestamp: Date.now() });
}

/** SYNC check: are RESOLVED bars for this token+resolution already cached?
 *  Lets TradingViewAdvanced keep the old chart on screen (no skeleton flash)
 *  when the swap will be served from memory. In-flight entries count as NOT
 *  warm - the swap would wait on the network, so the shimmer stays honest. */
export function hasCachedBarsSync(address, networkId, resolution = '60') {
  const c = chartBarsCache.get(_chartBarsKey(address, networkId, resolution, 'countback'));
  return !!(c && c.bars && (Date.now() - c.timestamp) < CHART_CACHE_TTL);
}

/** SYNC bar count for a resolved cache entry (0 when absent/in-flight/stale).
 *  Same entry hasCachedBarsSync reports on - this just exposes HOW MANY, so a
 *  caller can distinguish "warm and dense" from "warm but only a handful of
 *  bars". A sparse series cannot be framed by another token's preserved time
 *  window, which is what the warm-switch path silently assumed. */
export function cachedBarCountSync(address, networkId, resolution = '60') {
  const c = chartBarsCache.get(_chartBarsKey(address, networkId, resolution, 'countback'));
  if (!c || !c.bars || (Date.now() - c.timestamp) >= CHART_CACHE_TTL) return 0;
  return c.bars.length;
}

/** Get cached bars if available (used by TradingViewAdvanced to skip duplicate fetch).
 *  Returns a Promise - if prefetch is still in-flight, awaits the pending request. */
export async function getCachedBars(address, networkId, resolution = '60') {
  const cacheKey = _chartBarsKey(address, networkId, resolution, 'countback');
  const cached = chartBarsCache.get(cacheKey);
  if (!cached || (Date.now() - cached.timestamp) > CHART_CACHE_TTL) return null;
  if (cached.bars) return cached.bars;
  // Prefetch still in-flight - await the pending promise
  if (cached.promise) {
    try { return await cached.promise; } catch { return null; }
  }
  return null;
}

// Same as getCachedBars but also reports the entry's origin ('snapshot' for a
// 300-bucket snapshot window seed, undefined for a full wide prefetch). The
// datafeed uses it to tell a PARTIAL window apart from a young token's whole
// life when deciding whether a short entry can satisfy TV's countBack.
export async function getCachedBarsEntry(address, networkId, resolution = '60') {
  const cacheKey = _chartBarsKey(address, networkId, resolution, 'countback');
  const cached = chartBarsCache.get(cacheKey);
  if (!cached || (Date.now() - cached.timestamp) > CHART_CACHE_TTL) return null;
  if (cached.bars) return { bars: cached.bars, origin: cached.origin };
  if (cached.promise) {
    try {
      const bars = await cached.promise;
      return bars ? { bars, origin: chartBarsCache.get(cacheKey)?.origin } : null;
    } catch { return null; }
  }
  return null;
}

/**
 * Eagerly start fetching chart bars for a token (called at click time,
 * before lazy chunks load). The useChartData hook checks this cache on mount.
 */
export function prefetchChartBars(address, networkId = 1, resolution = null) {
  if (!address) return;
  // When the caller doesn't pass a resolution (token-select on App.jsx /
  // main.jsx / LeftPanel), default to the user's SAVED timeframe's resolution -
  // NOT a hardcoded 1H. The chart boots on localStorage['spectre-timeframe'];
  // warming 1H while the chart actually mounts on e.g. 12H left the active
  // timeframe to cold-fetch the FULL multi-year window on first paint (the 4-6s
  // initial-load gap). Matching the prewarm to the boot timeframe means the chart
  // paints from this small 300-bar countback instead. Explicit callers (hover
  // pills, multi-fan-out) keep their own resolution. Map lives in
  // lib/chartTimeframes (shared with fetchTokenSnapshot).
  if (!resolution) {
    resolution = getSavedChartResolution();
  }
  // Prefetch ONE resolution. Other resolutions warm on-demand: the first switch,
  // or a hover-prefetch fired from the timeframe pills' onMouseEnter
  // (TradingChart.jsx). Dedup below makes repeat hovers free. The Trading Platform
  // chart is Codex-only (src=codex), so this single visible-resolution prewarm is
  // one Codex call that overlaps the click - the multi-resolution fan-out was removed.
  const resolutions = [resolution];
  const now = Math.floor(Date.now() / 1000);

  for (const resolution of resolutions) {
    const cacheKey = _chartBarsKey(address, networkId, resolution, 'countback');
    // TTL-aware skip, NOT a bare .has(): an expired entry must re-fetch or
    // the periodic surface re-warm (prewarmChartBarsList) can never refresh
    // it - the old .has() skip meant every prewarmed token silently went
    // cold 5 minutes into the session and clicks fell back to a 1.5-4s
    // Codex round-trip (the "chart takes 3-4s" report). In-flight promises
    // are always reused regardless of age.
    const existing = chartBarsCache.get(cacheKey);
    if (existing && (existing.promise || (Date.now() - existing.timestamp) < CHART_CACHE_TTL)) continue;

    const promise = (async () => {
      // WIDE probe = the server's "last 500 trade-bars" (GMGN's boot shape).
      // Re-measured 2026-07-21 post-server-clamp: 0.8-2.4s cold / 0.35s warm
      // (the old "from=0 is 7.4s" note predates the wide clamp), and this
      // fires at CLICK time so the cost overlaps the page transition. Same
      // shape as the chart's boot fetch = same KV bucket = the chart's own
      // fetch is a server cache hit; a 500-bar first paint also means the
      // deep-fill repaint (resetData flash) never runs on a normal boot.
      const codexRes = await getBars(address, resolution, 0, now + 60, networkId, { codexOnly: true });
      const bars = _normaliseBars(codexRes?.getBars);
      return bars.length > 0 ? bars : null;
    })().catch(() => null);

    // Store promise immediately so getCachedBars can await it if still in-flight
    chartBarsCache.set(cacheKey, { promise, timestamp: Date.now() });
    promise.then(bars => {
      if (bars) chartBarsCache.set(cacheKey, { bars, timestamp: Date.now() });
      // Failed fetch: drop the entry so the next hover/click/warm retries
      // instead of the dead promise-entry blocking the key until TTL.
      else chartBarsCache.delete(cacheKey);
    });
  }
}

/**
 * Keep a SURFACE of clickable tokens' chart bars warm (trending ticker,
 * trending panel, watchlist). One staggered prefetchChartBars pass over the
 * list at the user's saved timeframe. prefetchChartBars is TTL-aware, so
 * re-invoking this every few minutes only refetches entries whose 5-min
 * cache lapsed - fresh entries are a free no-op (filtered here before the
 * stagger so a warm pass doesn't sit in timers).
 *
 * This is what makes a token click paint candles in ms REGARDLESS of when
 * the click happens. The old once-per-session prewarm decayed after
 * CHART_CACHE_TTL and late clicks went back to the cold Codex fetch.
 *
 * Codex spend: each listed token costs 1 getBars per CHART_CACHE_TTL window
 * per client while the tab is active (hidden/idle passes skip). The server's
 * bars bucket cache + wide-KV amortize repeats across users. Callers cap
 * the list (default 20) and gate on surface visibility.
 *
 * Returns a cancel fn. Caller owns the cadence (mount + ~4min repoll).
 */
/**
 * Addresses whose row is ON SCREEN right now, read straight from the DOM via
 * the `data-warm-addr` attribute the token rows carry.
 *
 * Measured before this gate (prod token page, 2026-08-04): the warm passes
 * covered 39 DIFFERENT tokens for 286KB while the user looked at one - and
 * LeftPanel warmed 20 trending tokens while RENDERING only 7 of them, so 13
 * were never even on screen. A click comes from a row you can see, so that is
 * what we warm.
 *
 * Computed once per warm kick (every ~240s) rather than tracked with an
 * IntersectionObserver: one getBoundingClientRect per row on a handful of rows
 * is far cheaper than keeping observers alive, and it cannot leak.
 *
 * Returns null when the page renders NO tagged rows at all - the caller then
 * falls back to the old cap-based behaviour, so a future refactor that drops
 * the attribute degrades to "warm as before" instead of silently warming
 * nothing.
 */
const WARM_VIEWPORT_MARGIN = 200; // px - just-off-screen rows are one scroll away

function visibleWarmAddresses() {
  if (typeof document === 'undefined') return null;
  const els = document.querySelectorAll('[data-warm-addr]');
  if (els.length === 0) return null;
  const vh = window.innerHeight || 0;
  const vw = window.innerWidth || 0;
  const out = new Set();
  els.forEach((el) => {
    const a = el.getAttribute('data-warm-addr');
    if (!a) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return; // display:none / collapsed panel
    const onScreen =
      r.bottom > -WARM_VIEWPORT_MARGIN && r.top < vh + WARM_VIEWPORT_MARGIN &&
      r.right > -WARM_VIEWPORT_MARGIN && r.left < vw + WARM_VIEWPORT_MARGIN;
    if (onScreen) out.add(a.toLowerCase());
  });
  return out;
}

export function prewarmChartBarsList(tokens, { staggerMs = 350, cap = 20, visibleOnly = false } = {}) {
  const resolution = getSavedChartResolution();
  const visible = visibleOnly ? visibleWarmAddresses() : null;
  const list = (tokens || [])
    .filter(t => t?.address)
    // `visible === null` = nothing tagged on the page -> keep the old behaviour.
    .filter(t => !visible || visible.has(String(t.address).toLowerCase()))
    .slice(0, cap)
    .filter(t => {
      const nid = inferNetworkId(t.address, t.networkId);
      const c = chartBarsCache.get(_chartBarsKey(t.address, nid, resolution, 'countback'));
      return !c || (!c.promise && (Date.now() - c.timestamp) >= CHART_CACHE_TTL);
    });
  if (list.length === 0) return () => {};
  let cancelled = false;
  let timer = null;
  const step = (i) => {
    if (cancelled || i >= list.length) return;
    if (typeof document !== 'undefined' && (document.hidden || !isAppActive())) {
      // Backgrounded/idle - re-arm instead of dropping the queue.
      timer = setTimeout(() => step(i), 2000);
      return;
    }
    const t = list[i];
    prefetchChartBars(t.address, inferNetworkId(t.address, t.networkId));
    timer = setTimeout(() => step(i + 1), staggerMs);
  };
  step(0);
  return () => { cancelled = true; clearTimeout(timer); };
}

/**
 * Background-warm MULTIPLE chart resolutions at low priority so timeframe
 * SWITCHES on the active chart are instant cache hits. Unlike prefetchChartBars
 * (one resolution, fired on hover / initial paint), this fans out the remaining
 * user-reachable resolutions AFTER the first bars have painted.
 *
 * ZERO-CODEX CONTRACT: the CALLER must only invoke this when the serving tier
 * is cheap (GeckoTerminal / CoinGecko / Binance / Hetzner). It reuses
 * prefetchChartBars, which writes the same `-countback` key the TradingViewAdvanced
 * datafeed reads via getCachedBars on firstDataRequest - so a warmed resolution
 * is a guaranteed cache hit on the next switch.
 *
 * Serial + whenIdle + visibility-gated: one kickoff per idle tick so it never
 * bursts the upstream (re-tripping the /api/bars 60/min bucket), never competes
 * with a real switch click, and never runs on a backgrounded tab. Pass the
 * resolutions in priority order (fast / most-likely-clicked first). Returns a
 * cancel fn; call it on token change / unmount.
 */
export function prefetchChartBarsMulti(address, networkId = 1, resolutions = []) {
  if (!address || !Array.isArray(resolutions) || resolutions.length === 0) {
    return () => {};
  }
  let cancelled = false;
  let timer = null;
  // Queue resolutions that are missing OR EXPIRED. Checking `.has()` alone kept
  // stale (past-TTL) entries out of the queue, so the fan-out skipped them while
  // getCachedBars' own TTL check still returned null on the next switch -> a cold
  // fetch the prewarm could have prevented (a returning viewer whose 5-min cache
  // lapsed). Mirror getCachedBars' validity test so expired resolutions re-warm.
  const queue = [...new Set(resolutions)].filter((res) => {
    const key = _chartBarsKey(address, networkId, res, 'countback');
    const c = chartBarsCache.get(key);
    return !c || (Date.now() - c.timestamp) >= CHART_CACHE_TTL;
  });

  const step = () => {
    if (cancelled || queue.length === 0) return;
    if (document.hidden || !isAppActive()) {
      // Backgrounded - re-arm (longer) instead of dropping the queue.
      timer = setTimeout(step, 1500);
      return;
    }
    const res = queue.shift();
    // Fire-and-forget: prefetchChartBars writes its own promise into the cache.
    prefetchChartBars(address, networkId, res);
    // DETERMINISTIC 250ms pacing (NOT requestIdleCallback): under heavy
    // first-paint load rIC gets starved and the fan-out stalled after ~2 of 5
    // resolutions, so switches to the un-warmed ones stayed cold (measured). A
    // fixed timer warms all FREE-tier (cg-ohlc/Binance/GT) resolutions within
    // ~1.5s so every common hourly+ switch is a client cache hit. Still serial
    // (one /api/bars at a time) + visibility-gated, so no 60/min burst and
    // nothing runs on a hidden tab. Callers pass ONLY free-tier resolutions, so
    // this is zero-Codex.
    timer = setTimeout(step, 250);
  };

  timer = setTimeout(step, 300); // kick off just after first paint
  return () => { cancelled = true; if (timer) clearTimeout(timer); };
}

// ── Older-history window prefetch (instant scroll-back) ──────────────────────
// Scroll-back used to fetch the window BEFORE the oldest visible bar ON DEMAND,
// AT the left edge - so the user always hit a wall, THEN waited ~1-4s for a cold
// /api/bars round-trip. This warms the NEXT older window in the BACKGROUND (right
// after the chart paints, and again after each consume) and caches every fetched
// window keyed by its `to` boundary, so:
//   - the FIRST scroll-back is already in memory by the time the user drags left
//   - re-scrolling a region already seen is a zero-network cache hit
// Windows are immutable (old candles never change) -> long-lived cache. Bars flow
// through getBars -> /api/bars, so each warm also populates the server KV bucket
// (token+res+from+to), making the SAME window cheap for every other viewer too.
const _histWindowCache = new Map(); // key -> { bars } | { promise }, + timestamp
const HIST_CACHE_TTL = 1_800_000;   // 30 min - old bars don't change
const HIST_CACHE_MAX = 60;          // cap memory across a long deep-scroll session

// Per-resolution scroll-back window size, tuned to ~1400 bars/fetch so every
// resolution pages uniformly. '30' (30M) and '720' (12H) were MISSING from the
// old inline map -> they fell back to a tiny 168h window, so 30M/12H paged in
// small chunks = more frequent waits. Now complete.
// Per-resolution scroll-back window size. Sized for ~1400 bars EXCEPT 1D/1W,
// which are capped at 3 years (26280h): 1400 daily bars = 3.8y and 1400 weekly
// bars = 26.8y exceed Codex getBars' ~4y span limit (beyond it the call returns
// truncated recent-only data), so paging back never advanced. 3y is the verified
// safe span and MUST match getBars' MAX_BARS_RANGE_SEC so windows tile gaplessly.
const _SCROLLBACK_HOURS = {
  '1': 24, '5': 115, '15': 350, '30': 700, '60': 1400,
  '240': 5600, '720': 16800, '1D': 26280, '1W': 26280,
};

function _olderWindow(resolution, beforeTimeMs, periodHours) {
  const to = Math.floor(beforeTimeMs / 1000) - 1; // one sec before current oldest
  const fetchHours = _SCROLLBACK_HOURS[resolution] || Math.min(periodHours || 168, 1400);
  const from = to - fetchHours * 3600;
  return { from, to };
}

/**
 * Fetch (or return cached) the OHLCV window immediately older than `beforeTimeMs`
 * for a token+resolution. Deduped + cached by the window's `to` boundary so the
 * scroll-back consumer and the background prewarm share ONE network call. Resolves
 * to { bars, genesis }: `bars` is normalised + spike-clamped (ASC); `genesis` is
 * true ONLY when the server actually answered with an empty window (a real start
 * of history) - never on a transient/network/429 failure (so scroll-back is never
 * permanently locked by a blip). Never rejects.
 */
function prefetchOlderBars(symbol, networkId, resolution, beforeTimeMs, periodHours) {
  const EMPTY = { bars: [], genesis: false };
  if (!symbol || !(beforeTimeMs > 0)) return Promise.resolve(EMPTY);
  const { from, to } = _olderWindow(resolution, beforeTimeMs, periodHours);
  if (!(to > 0) || from >= to) return Promise.resolve(EMPTY);

  const key = _chartBarsKey(symbol, networkId, resolution, `h${to}`);
  const hit = _histWindowCache.get(key);
  if (hit && (Date.now() - hit.timestamp) < HIST_CACHE_TTL) {
    if (hit.bars) return Promise.resolve({ bars: hit.bars, genesis: false });
    if (hit.promise) return hit.promise;
  }

  const promise = (async () => {
    try {
      const res = await getBars(symbol, resolution, from, to, networkId, { codexOnly: true });
      if (res?.getBars?.length > 0) return { bars: _normaliseBars(res.getBars), genesis: false };
      // Empty: genesis only if the server actually answered (tier present) and it
      // was NOT rate-limited. A network error / 429 is transient, not genesis.
      return { bars: [], genesis: !!res?.tier && !res?.rateLimited };
    } catch {
      return EMPTY;
    }
  })();

  // FIFO-evict the oldest window if over the cap (windows are immutable, so any
  // eviction just costs a re-fetch later).
  if (_histWindowCache.size >= HIST_CACHE_MAX) {
    const oldestKey = _histWindowCache.keys().next().value;
    if (oldestKey) _histWindowCache.delete(oldestKey);
  }
  _histWindowCache.set(key, { promise, timestamp: Date.now() });
  promise.then(({ bars }) => {
    if (bars && bars.length) _histWindowCache.set(key, { bars, timestamp: Date.now() });
    else _histWindowCache.delete(key); // don't cache an empty/transient as data
  });
  return promise;
}

/**
 * Warm `depth` contiguous older windows ahead of `beforeTimeMs`, chaining each
 * from the previous window's OLDEST bar so the cache keys line up exactly with
 * what fetchMoreHistory will request as the user pages back. Sequential (one
 * upstream call at a time, dedup-shared with the consumer), pauses on a
 * backgrounded tab, stops early at genesis. This is what makes EVERY wall-hit
 * warm: while the user reads the current bars, the next few windows are already
 * in _histWindowCache - a warm hit is ~0.3s vs a cold ~2-7s round-trip.
 */
async function prefetchOlderChain(symbol, networkId, resolution, beforeTimeMs, periodHours, depth, isCurrent) {
  let before = beforeTimeMs;
  for (let i = 0; i < depth; i++) {
    if (isCurrent && !isCurrent()) return; // token/timeframe/boundary moved on - stop the stale chain
    if (typeof document !== 'undefined' && (document.hidden || !isAppActive())) return;
    const { bars, genesis } = await prefetchOlderBars(symbol, networkId, resolution, before, periodHours);
    if (genesis || !bars || bars.length === 0) return; // reached the start of history
    before = bars[0].time; // chain from this window's oldest bar
  }
}

// In-memory cache for prefetched trades (called at click time, before DataTabs mounts)
const tradesCache = new Map();
const TRADES_CACHE_TTL = 120_000; // 2 minutes

// Canonical trades-cache key - address always lowercased (see _chartBarsKey).
const _tradesKey = (address, nid) => `${String(address || '').toLowerCase()}-${nid}-trades`;

// Codex returns the empty legs of complex/multi-hop transactions - and dust/spam
// probes - as "swap" events that moved 0 (or sub-cent) USD, often sharing the
// parent txHash. A stale pool price still tags them, so they render as
// "$0.34 / 0.00 / 1e-7 ETH / $0.00" noise rows. Drop anything under a 1-cent
// floor; every genuine fill clears it (value = tokenAmount x price), even on a
// sub-penny token, because a real trade still moves more than a cent of value.
const DUST_USD = 0.01;
const _isEmptyTrade = (t) => !(t.value > DUST_USD);

/** Map raw server/Codex trades into the display shape DataTabs consumes.
 *  Single normaliser shared by prefetch + snapshot seeding. */
function _normaliseTrades(rawTrades) {
  if (!Array.isArray(rawTrades) || rawTrades.length === 0) return null;
  return rawTrades.map(t => {
    const price = parseFloat(t.priceUSD || t.priceUsd || t.price) || 0;
    const amount = parseFloat(t.amountToken || t.amount) || 0;
    const value = (amount > 0 && price > 0) ? amount * price : (parseFloat(t.amountUSD || t.amountUsd || t.value) || 0);
    const ts = t.timestamp || t.blockTimestamp;
    const tsMs = typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts;
    return {
      timestamp: new Date(tsMs),
      type: t.type || 'Swap',
      price,
      amount,
      value,
      maker: t.maker || '',
      txHash: t.txHash || t.transactionHash || '',
      symbol: t.symbol || '',
      source: t.source || null,
      formattedPrice: formatPrice(price),
      formattedValue: formatLargeNumber(value),
      _source: 'codex',
    };
  }).filter(t => !_isEmptyTrade(t));
}

/**
 * Eagerly start fetching trades for a token (called at click time,
 * before lazy DataTabs chunk loads). The useLatestTrades hook checks this cache on mount.
 */
export function prefetchLatestTrades(address, networkId = 1) {
  if (!address) return;
  const nid = inferNetworkId(address, networkId);
  const cacheKey = _tradesKey(address, nid);
  if (tradesCache.has(cacheKey)) {
    const entry = tradesCache.get(cacheKey);
    if (Date.now() - entry.timestamp < TRADES_CACHE_TTL) return;
  }

  const promise = (async () => {
    try {
      const codexRes = await getLatestTrades(address, nid, 50);
      return _normaliseTrades(codexRes?.trades);
    } catch { return null; }
  })();

  tradesCache.set(cacheKey, { promise, timestamp: Date.now() });
  promise.then(trades => {
    if (trades) tradesCache.set(cacheKey, { trades, timestamp: Date.now() });
  });
}

/**
 * Retrieve prefetched trades from cache. Returns null if not cached or expired.
 */
export async function getCachedTrades(address, networkId = 1) {
  const nid = inferNetworkId(address, networkId);
  const cacheKey = _tradesKey(address, nid);
  const cached = tradesCache.get(cacheKey);
  if (!cached) return null;
  // Resolved trades: check TTL
  if (cached.trades) {
    if ((Date.now() - cached.timestamp) > TRADES_CACHE_TTL) return null;
    return cached.trades;
  }
  // Still in-flight: always await regardless of timestamp
  if (cached.promise) {
    try { return await cached.promise; } catch { return null; }
  }
  return null;
}

/**
 * Hook for fetching OHLCV chart data
 * @param {string} symbol - Token address
 * @param {string} resolution - Candle resolution: "1", "5", "15", "60", "240", "D", "W"
 * @param {number} networkId - Network ID (1 for Ethereum, 1399811149 for Solana)
 * @param {number} periodHours - How many hours of data to fetch
 */
export function useChartData(symbol, resolution = '60', networkId = 1, periodHours = 168) {
  // Initial state: consult THREE caches in order — Phase C hot cache,
  // exact-periodHours, then the prefetch's -countback. The hot cache
  // wins because the snapshot endpoint (Phase D) populates it on
  // selectToken, so re-clicks within 5min get instant first-frame bars.
  // prefetchChartBars writes -countback at click time; without the
  // lookup helper useChartData never saw those bars and re-fetched
  // from scratch.
  const [bars, setBars] = useState(() => {
    // Use the boot snapshot when the active resolution matches the resolution it
    // was fetched at (barsResolution, default 1H). Previously hardcoded to '60',
    // so a chart booting on any non-1H saved timeframe ignored the snapshot and
    // cold-fetched (the 4-6s initial-load gap).
    if (symbol) {
      const snap = readHotSnapshot(symbol);
      if (snap && resolution === (snap.barsResolution || '60')) {
        const snapBars = snap?.bars?.bars || snap?.bars; // server may return either shape
        if (Array.isArray(snapBars) && snapBars.length > 0) {
          return _normaliseBars(snapBars);
        }
      }
    }
    const { entry } = _lookupChartCache(symbol, networkId, resolution, periodHours);
    return entry?.bars || [];
  });
  const [loading, setLoading] = useState(() => {
    if (symbol) {
      const snap = readHotSnapshot(symbol);
      if (snap && resolution === (snap.barsResolution || '60')) {
        const snapBars = snap?.bars?.bars || snap?.bars;
        if (Array.isArray(snapBars) && snapBars.length > 0) return false;
      }
    }
    const { entry } = _lookupChartCache(symbol, networkId, resolution, periodHours);
    return !entry?.bars;
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [athPrice, setAthPrice] = useState(null);
  const athFetchedRef = useRef(null);
  const prevSymbolRef = useRef(symbol);
  // Mirror the current bar count into a ref so fetchBars (a useCallback that
  // intentionally doesn't depend on `bars`) can tell an initial load from a
  // live poll without a stale closure - used to gate retries and to avoid
  // blanking an already-drawn chart on a transient empty.
  const barsLenRef = useRef(0);
  barsLenRef.current = bars.length;
  // Current oldest loaded bar time - read by the background buffer-extend so it
  // can pick up where the chart actually is without a stale closure.
  const oldestTimeRef = useRef(null);
  oldestTimeRef.current = bars.length > 0 ? bars[0].time : null;
  // Resolution the bars currently in state belong to. The poll-merge keeps any
  // history older than the refreshed head window - but ONLY when prev is the
  // SAME timeframe. On a TF switch the old (deep) buffer is intentionally kept
  // on screen to avoid a flash; without this guard the merge would blend two
  // resolutions (e.g. a deep 1H buffer + a fresh 4H head), spanning a huge price
  // range and crushing the new candles. Mismatch => replace, never merge.
  const barsResRef = useRef(null);

  // Clear bars immediately on symbol change - prevents stale data flash
  if (prevSymbolRef.current !== symbol) {
    prevSymbolRef.current = symbol;
    // Check BOTH cache keys for the new symbol — if either is cached,
    // use it instantly. This is the hot path on token switch: the click
    // handler calls prefetchChartBars before the chart even re-mounts,
    // so by the time we get here the -countback bars are usually warm.
    const { entry } = _lookupChartCache(symbol, networkId, resolution, periodHours);
    if (entry?.bars) {
      setBars(entry.bars);
      barsResRef.current = resolution;
      setLoading(false);
    } else {
      setBars([]);
      barsResRef.current = null;
      setLoading(true);
    }
  }

  // Compute ATH from chart data (max bar high) — replaces CoinGecko ATH
  const computeATH = useCallback((chartBars) => {
    if (!chartBars || chartBars.length === 0) return;
    // reduce, not Math.max(...spread) (RangeErrors on deep buffers). Only RAISE
    // the ATH: the poll passes just the recent head window, which must not lower
    // the all-time-high the older/buffered history already found.
    let maxHigh = 0;
    for (const bar of chartBars) { if ((bar.high || 0) > maxHigh) maxHigh = bar.high; }
    if (maxHigh > 0) {
      setAthPrice((p) => (p === null || maxHigh > p ? maxHigh : p));
      athFetchedRef.current = symbol;
    }
  }, [symbol]);

  const fetchBars = useCallback(async () => {
    if (!symbol) {
      setLoading(false);
      return;
    }

    try {
      // Check prefetch cache first (BOTH key shapes — exact periodHours
      // and the prefetch's countback). If the click-time prefetch is
      // still in flight, await its promise instead of issuing a parallel
      // duplicate request.
      const { entry: cached } = _lookupChartCache(symbol, networkId, resolution, periodHours);
      if (cached) {
        if (cached.bars) {
          setBars(cached.bars);
          barsResRef.current = resolution;
          computeATH(cached.bars);
          setLoading(false);
          return;
        }
        if (cached.promise) {
          setLoading(true);
          const result = await cached.promise;
          if (result) {
            setBars(result);
            barsResRef.current = resolution;
            computeATH(result);
            setError(null);
            setLoading(false);
            return;
          }
        }
      }
      // Snapshot-join: on an in-app token switch, selectToken fired the
      // aggregate snapshot (carrying bars at the SAVED timeframe) in the click
      // handler - but this mount can run before its .then() seeds the cache.
      // When a snapshot is pending/fresh for this token, await it (bounded
      // 4s), seed idempotently, and re-read the cache before paying a cold
      // fetch. Never ORIGINATES a snapshot (hasSnapshotPending gate).
      if (hasSnapshotPending(symbol, networkId)) {
        setLoading(true);
        const snap = await Promise.race([
          fetchTokenSnapshot(symbol, networkId).catch(() => null),
          new Promise(r => setTimeout(() => r(null), 4000)),
        ]);
        if (snap) { try { seedCachesFromSnapshot(snap); } catch { /* best-effort */ } }
        const { entry: seeded } = _lookupChartCache(symbol, networkId, resolution, periodHours);
        if (seeded?.bars) {
          setBars(seeded.bars);
          barsResRef.current = resolution;
          computeATH(seeded.bars);
          setError(null);
          setLoading(false);
          return;
        }
      }

      const cacheKey = _chartBarsKey(symbol, networkId, resolution, periodHours);

      setLoading(true);

      let formattedBars = null;

      // Step 1: fetch bars, with a bounded retry on the INITIAL load. A cold
      // large-window DEX fetch (e.g. 12H/1D over a deep history → the server
      // paginates GeckoTerminal / tries the onchain fallback) can exceed
      // getBars' 12s client timeout while the server keeps working and CACHES
      // its result. Without a retry the chart sticks on the empty "No chart
      // data" state even though the bars exist - a 2nd attempt a couple
      // seconds later lands warm. Only retry while nothing is on screen yet;
      // never burn retries on a routine poll. A DEFINITIVE empty answer (the
      // server responded with a tier and zero bars = genuinely sparse/empty
      // window) breaks immediately - re-asking an answered question was the
      // measured 3x-identical-request spam. Retries remain for the cases they
      // exist for: client timeout (no tier) and rate-limit.
      const maxAttempts = barsLenRef.current > 0 ? 1 : 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          // Recompute the window per attempt so 2.5-4s backoffs don't drift
          // the head out of the server's freshest bucket.
          const to = Math.floor(Date.now() / 1000);
          const from = to - (periodHours * 60 * 60);
          const codexRes = await getBars(symbol, resolution, from, to, networkId, { codexOnly: true });
          if (codexRes?.getBars?.length > 0) {
            formattedBars = codexRes.getBars.map(bar => ({
              time: (bar.t || 0) * 1000,
              open: parseFloat(bar.o) || 0,
              high: parseFloat(bar.h) || 0,
              low: parseFloat(bar.l) || 0,
              close: parseFloat(bar.c) || 0,
              volume: parseFloat(bar.v) || 0,
            }));
            break;
          }
          // Definitive empty: the server answered (tier present, not a rate
          // limit) - do not re-ask.
          if (codexRes?.tier && !codexRes.rateLimited) break;
          // Empty (timeout / rate-limit / not-yet-warm). Back off so the
          // server's in-flight fetch can land in cache, then try again.
          if (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, codexRes?.rateLimited ? 4000 : 2500));
          }
        } catch (err) {
          console.warn('[codex] OHLCV failed:', err.message);
          if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 2500));
        }
      }

      // Show data. On empty, do NOT wipe bars already on screen - a transient
      // poll/refresh timeout must never blank a chart that is already drawn.
      if (formattedBars && formattedBars.length > 0) {
        chartBarsCache.set(cacheKey, { bars: formattedBars, timestamp: Date.now() });
        // Merge, do NOT replace: keep any history OLDER than this refreshed head
        // window (scroll-back + the background buffer-extend), then append the
        // fresh head (updated closes + new recent bars). A plain setBars(head)
        // here wiped the whole buffer every 60-90s poll, re-walling scroll-back.
        // BUT only merge when prev is the SAME timeframe - on a TF switch prev
        // is the old (deep) buffer kept on screen to avoid a flash; merging it
        // would blend two resolutions and blow out the price axis. Mismatch =>
        // replace cleanly with the new head.
        const sameTf = barsResRef.current === resolution;
        setBars((prev) => {
          if (!prev || prev.length === 0 || !sameTf) return formattedBars;
          const headStart = formattedBars[0].time;
          const older = prev.filter((b) => b.time < headStart);
          return older.length ? [...older, ...formattedBars] : formattedBars;
        });
        barsResRef.current = resolution;
        computeATH(formattedBars);
        setError(null);
        setHasMoreHistory(true);
      } else if (barsLenRef.current === 0) {
        setBars([]);
      }

    } catch (err) {
      console.error('Failed to fetch chart data:', err);
      setError(err.message);
      // Keep any existing bars; only clear when the chart is already empty.
      if (barsLenRef.current === 0) setBars([]);
    } finally {
      setLoading(false);
    }
  }, [symbol, resolution, networkId, periodHours, computeATH]);

  // Fetch MORE historical data (older than current oldest candle).
  // Routes through prefetchOlderBars, which is usually ALREADY warm (the prewarm
  // effect below fetches the next older window in the background after each
  // paint/consume) -> a cache hit resolves in ~1ms, so the splice is instant
  // instead of a 1-4s wall-then-wait. A cold miss still fetches once and caches.
  // `force` (set by a deliberate user overscroll) bypasses the hasMoreHistory
  // latch: that flag can get mis-set false (a transient empty Codex response read
  // as genesis, or a window-overlap appended=0), which would otherwise wall
  // scroll-back forever even though older bars exist. A forced fetch re-checks and,
  // on success, recovers the flag (setHasMoreHistory(true) below). The settle-at-
  // edge auto-effect stays NON-forced so it still stops at a real genesis.
  const fetchMoreHistory = useCallback(async (force = false) => {
    if (!symbol || loadingMore || bars.length === 0 || (!force && !hasMoreHistory)) {
      return false;
    }

    try {
      setLoadingMore(true);

      const oldest = bars[0].time;
      const { bars: older, genesis } = await prefetchOlderBars(
        symbol, networkId, resolution, oldest, periodHours
      );

      if (older && older.length > 0) {
        // Dedup against the bars we already hold. CRITICAL: compute `appended`
        // SYNCHRONOUSLY here from the closure `bars` (which is current - it's a
        // dep of this callback), NOT inside the setBars updater. The updater runs
        // later (React render phase), so reading its side-effect right after
        // setBars always saw 0 -> hasMoreHistory was wrongly latched false after
        // EVERY merge, which disabled both the seamless forward-merge and the
        // prewarm (both gate on hasMoreHistory) and forced every scroll-back back
        // to a cold at-the-wall fetch.
        const seen = new Set(bars.map(b => b.time));
        const add = older.filter(b => b.time && !seen.has(b.time));
        const appended = add.length;
        if (appended > 0) {
          // `add` is entirely older than bars[0] (window to = oldest-1), so sort
          // ONLY `add`, then concat - no full-array re-sort each consume.
          add.sort((a, z) => a.time - z.time);
          // reduce, not Math.max(...spread): the spread RangeErrors past ~100k
          // args; only the NEW bars can beat the running ATH.
          let addMax = 0;
          for (const b of add) { if (b.high > addMax) addMax = b.high; }
          setBars(prevBars => {
            // Re-dedup vs prevBars in case bars advanced between capture and
            // commit (concurrent merges); add2 stays ascending (filter preserves order).
            const seen2 = new Set(prevBars.map(b => b.time));
            const add2 = add.filter(b => !seen2.has(b.time));
            if (!add2.length) return prevBars;
            return [...add2, ...prevBars];
          });
          if (addMax > 0 && (athPrice === null || addMax > athPrice)) setAthPrice(addMax);
          setHasMoreHistory(true);
          return true;
        }
        // 0 new bars (all overlap) = the true boundary.
        setHasMoreHistory(false);
        return false;
      }

      // Empty window. Lock scroll-back ONLY on a genuine genesis (the server
      // answered with no older bars). A transient/network/429 failure leaves
      // hasMoreHistory true so the next pan retries.
      if (genesis) setHasMoreHistory(false);
      return false;
    } catch (err) {
      console.error('Failed to fetch more history:', err);
      return false;
    } finally {
      setLoadingMore(false);
    }
  }, [symbol, resolution, networkId, periodHours, bars, loadingMore, hasMoreHistory, athPrice]);

  // Background-warm the NEXT older window whenever the oldest bar changes (first
  // paint, and after each scroll-back consume). By the time the user drags to the
  // left edge the window is already in _histWindowCache -> fetchMoreHistory above
  // resolves it instantly. Tag-guarded so a live SSE tick (which only appends at
  // the NEW end, oldest unchanged) never re-kicks. We deliberately do NOT return
  // the idle-cancel as effect cleanup: that would let an SSE-tick re-render cancel
  // a scheduled-but-not-yet-fired prewarm. Instead we cancel the previous kick
  // ourselves ONLY when the boundary actually changes (new tag), and once on
  // unmount. Idle + visibility gated; idempotent + cache-keyed, so a stray late
  // kick is harmless.
  // Background buffer-extend: load older history DIRECTLY INTO `bars` (not just a
  // cache) so the user scrolls back through pre-loaded candles with ZERO fetch and
  // ZERO wall. Each round fetches N contiguous older windows IN PARALLEL (by
  // deterministic time range, not chained) so a round fills in ~one round-trip
  // (~1-2s) instead of N sequential ones - the sequential chain was the residual
  // 1-2s "wall" the user could out-scroll. A few rounds build a deep buffer.
  //
  // Self-contained: tracks the deepest boundary `oldest` LOCALLY (no stale
  // closure), visibility-gated, generation-token-cancelled on token/timeframe
  // switch, stops at the depth target or genesis. Codex-cost note: ~the same
  // window count the old sequential extend already fetched, just in parallel -
  // a deliberate speed-over-cost choice (requested); shared :codex KV makes
  // repeat viewers free.
  const histExtendRef = useRef(0);
  useEffect(() => {
    if (!symbol) return;
    const myGen = ++histExtendRef.current;
    const alive = () => histExtendRef.current === myGen;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const N = 6;            // windows per parallel round
    const TARGET = 3000;    // stop once the buffer is this deep
    (async () => {
      let oldest = null;
      for (let i = 0; i < 80 && alive(); i++) {
        if (oldestTimeRef.current) { oldest = oldestTimeRef.current; break; }
        await sleep(150);
      }
      if (!oldest || !alive()) return;
      const WINDOW_SEC = (_SCROLLBACK_HOURS[resolution] || Math.min(periodHours || 168, 1400)) * 3600;
      let emptyStreak = 0;
      // When a window comes back mostly empty (real data only near its newest
      // edge) the token's history starts there - keep the NEXT round to a single
      // probe instead of a 6-way fan-out that would fire pre-genesis billed-empty
      // Codex calls for windows we already know are empty.
      let forceSingle = false;
      // Hard iteration cap (well above what TARGET needs) so retries can't loop.
      for (let iter = 0; iter < 30 && alive(); iter++) {
        if (barsLenRef.current >= TARGET) break;
        if (typeof document !== 'undefined' && (document.hidden || !isAppActive())) { await sleep(1000); iter--; continue; }
        const toSec = Math.floor(oldest / 1000) - 1;
        // First round fetches ONLY the immediately-needed next-older window, ALONE,
        // so the data the user scrolls into lands in one fast round-trip (~0.5s)
        // instead of being queued behind 5 deeper - often pre-genesis - parallel
        // fetches. On high TFs (12H/1D, 700+ day windows) the 6-way batch made that
        // first window land at ~3s = the residual scroll-back "wall". Later rounds
        // fan out to N to pre-warm deeper history in the background.
        const batchN = (iter === 0 || forceSingle) ? 1 : N;
        forceSingle = false;
        const reqs = [];
        for (let k = 0; k < batchN; k++) {
          const wTo = toSec - k * WINDOW_SEC;
          const wFrom = wTo - WINDOW_SEC;
          if (wFrom <= 0) break;
          reqs.push(getBars(symbol, resolution, wFrom, wTo, networkId, { codexOnly: true }).catch(() => null));
        }
        if (!reqs.length) break;
        const results = await Promise.all(reqs);
        if (!alive()) return;
        // Accept ONLY a CONTIGUOUS run from window 0 (the next-older window),
        // stopping at the first window that came back empty. A window that fails
        // transiently (rate-limit / timeout under parallel load) MUST leave a
        // clean boundary the next iteration re-fetches - never a permanent hole.
        // The old code merged every non-empty window regardless of order, so a
        // single failed middle window left a gap that the index-based renderer
        // compressed into a broken-looking stretch of missing candles.
        const accepted = [];
        let hitHole = false;
        for (const r of results) {
          const arr = r?.getBars;
          if (!arr || !arr.length) { hitHole = true; break; }
          accepted.push(...arr);
        }
        if (accepted.length === 0) {
          // The immediate next-older window is empty. Distinguish genuine GENESIS
          // (server reached the token's first bar -> tier 'no_data') from a
          // transient failure (rate-limit / timeout -> tier null). Genesis is
          // permanent: stop NOW, no retry and - because iter 0 fetches window 0
          // ALONE (batchN=1) - no deeper 6-way fan-out, which would otherwise fire
          // billed-empty Codex probes for windows we already KNOW are pre-genesis.
          // A transient empty still gets a few retries so a blip can't false-stop.
          if (results[0]?.tier === 'no_data') break;
          if (++emptyStreak >= 3) break;
          await sleep(700);
          continue;
        }
        emptyStreak = 0;
        const map = new Map();
        for (const b of _normaliseBars(accepted)) map.set(b.time, b);
        const older = [...map.values()].sort((a, z) => a.time - z.time);
        const newOldest = older[0].time;
        if (!(newOldest < oldest)) break; // no progress
        oldest = newOldest;
        // Sparse-window detection: if the oldest bar we got back sits in the
        // NEWER half of window 0's span, that window was largely empty -> we're
        // at/near genesis. Single-probe the next round so we confirm genesis with
        // ONE call instead of a 6-way fan-out of pre-genesis empties.
        if (Math.floor(newOldest / 1000) > toSec - WINDOW_SEC * 0.5) forceSingle = true;
        const maxHigh = older.reduce((m, b) => ((b.high || 0) > m ? b.high : m), 0);
        setBars((prev) => {
          const seen = new Set(prev.map((b) => b.time));
          const add = older.filter((b) => b.time && !seen.has(b.time)); // contiguous + strictly older than prev[0]
          return add.length ? [...add, ...prev] : prev;
        });
        if (maxHigh > 0) setAthPrice((p) => (p === null || maxHigh > p ? maxHigh : p));
        // A hole stopped this run mid-way: oldest only advanced to the contiguous
        // boundary, so loop again to re-fetch the failed window (no gap left).
        if (hitHole) await sleep(300);
      }
    })();
    return () => { histExtendRef.current++; }; // cancel on token/timeframe change / unmount
  }, [symbol, resolution, networkId, periodHours]);

  // ── L5-charts-B (2026-06-03): SSE bar-update fan-out ──────────────────
  // One Hetzner stream per token → many viewers. Replaces per-viewer polling
  // for the live-bar update path. Same logic as research/useChartData. When
  // an SSE tick arrives: extend close/high/low on the in-progress bar, or
  // append a new bar on bucket rollover. Polling stays as a closed-bar
  // recovery mechanism at a relaxed cadence.
  useEffect(() => {
    if (_sseDisabled()) return;
    if (!symbol) return;
    const addrCtx = _addressFromSymbol(symbol, networkId);
    if (!addrCtx) return; // CEX ticker / non-DEX — falls through to polling
    const tokenKey = `${addrCtx.address}:${addrCtx.networkId}`;
    const resSec = _RES_SECONDS[String(resolution || '60').toUpperCase()] || 3600;

    const unsub = streamSubscribe([tokenKey], (data) => {
      try {
        const price = parseFloat(data.priceUsd);
        if (!Number.isFinite(price) || price <= 0) return;
        // Ticks derived from the pair's trade feed carry the swap's USD size
        // (codexStreamApi setTokenPair) - accumulate it on the forming bar.
        const tradeUsd = parseFloat(data.tradeUsd) || 0;

        setBars(prev => {
          if (!prev || prev.length === 0) return prev;

          // 10x-in-one-tick outlier guard
          const lastBar = prev[prev.length - 1];
          const lastClose = lastBar.close > 0 ? lastBar.close : null;
          if (lastClose) {
            const ratio = price > lastClose ? price / lastClose : lastClose / price;
            if (ratio > 10) return prev;
          }

          const nowSec = Math.floor(Date.now() / 1000);
          const currentBucketMs = Math.floor(nowSec / resSec) * resSec * 1000;

          if (currentBucketMs === lastBar.time) {
            const updated = prev.slice();
            updated[updated.length - 1] = {
              ...lastBar,
              high: Math.max(lastBar.high, price),
              low: Math.min(lastBar.low, price),
              close: price,
              volume: (Number(lastBar.volume) || 0) + tradeUsd,
            };
            return updated;
          }
          if (currentBucketMs > lastBar.time) {
            return [...prev, {
              time: currentBucketMs,
              open: price,
              high: price,
              low: price,
              close: price,
              volume: tradeUsd,
            }];
          }
          return prev;
        });
      } catch (_) { /* per-listener safety */ }
    });
    return () => { try { unsub(); } catch (_) { /* ok */ } };
  }, [symbol, networkId, resolution]);

  useEffect(() => {
    fetchBars();
    // L5-charts-B: SSE drives the live tick for DEX tokens, so the poll's
    // only job is closed-bar recovery. Default cadence relaxed from 60s →
    // resolution-aware. CEX-ticker tokens (no SSE) keep the previous 60s.
    const resSec = _RES_SECONDS[String(resolution || '60').toUpperCase()] || 3600;
    const hasSseStream = !_sseDisabled() && !!_addressFromSymbol(symbol, networkId);
    const pollMs = hasSseStream
      ? (resSec <= 60 ? 60_000          // 1m → 60s (was 60s, kept)
        : resSec <= 300 ? 90_000        // 5m → 90s
        : resSec <= 900 ? 180_000       // 15m → 3min
        : resSec <= 3600 ? 300_000      // 1H → 5min
        : resSec <= 14400 ? 600_000     // 4H → 10min
        : resSec <= 86400 ? 1200_000    // 1D → 20min
        : 1800_000)                      // 1W+ → 30min
      : 60_000;
    const interval = setInterval(() => {
      if (!document.hidden && isAppActive()) fetchBars();
    }, pollMs);
    return () => clearInterval(interval);
  }, [fetchBars, resolution, symbol, networkId]);

  return { bars, loading, loadingMore, error, hasMoreHistory, refresh: fetchBars, fetchMoreHistory, athPrice };
}

/**
 * Hook for fetching token pairs
 * Note: Codex getTokenPairs returns empty - pairs data not available via Codex
 */
export function useTokenPairs(tokenAddress, networkId = 1) {
  const [pairs, setPairs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Codex does not support pair listing - return empty
  return { pairs, loading, error };
}

/**
 * Hook for fetching latest trades for a token
 */
// REST poll cadence for the tape. While the pair's trade SSE is live every
// swap arrives the instant it lands, so the poll only RECONCILES (accurate
// per-trade price/amount for rows the stream approximated, and anything a
// reconnect missed) - it runs at TRADES_POLL_LIVE_MS then. Without a live
// feed it is the delivery path and keeps the fast cadence. Measured
// 2026-09-11: this poll was the single largest tracked Codex op on the dev
// key (GetTokenEvents ~4K/day) while the stream was delivering the same
// trades for free.
const TRADES_POLL_MS = 30_000;
const TRADES_POLL_LIVE_MS = 90_000;

export function useLatestTrades(tokenAddress, networkId = 1, initialLimit = 100, { streamLive = false } = {}) {
  // Phase C: seed initial trades from the hot snapshot when fresh so
  // the Transactions tab shows real rows on first frame instead of
  // shimmer + a 500-800ms fetch wait.
  const [trades, setTrades] = useState(() => {
    const snap = readHotSnapshot(tokenAddress);
    if (snap?.trades && Array.isArray(snap.trades) && snap.trades.length > 0) {
      return snap.trades;
    }
    return [];
  });
  const [pairs, setPairs] = useState([]);
  const [loading, setLoading] = useState(() => {
    const snap = readHotSnapshot(tokenAddress);
    return !(snap?.trades && Array.isArray(snap.trades) && snap.trades.length > 0);
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const currentLimitRef = useRef(initialLimit);

  // Accepts EITHER a legacy boolean `resetLimit` (back-compat with the
  // polling caller that passes `false`) OR an options object
  // `{ resetLimit, skipCache }`. `skipCache: true` forces a network
  // fetch instead of re-hydrating from the 2-minute prefetch cache —
  // used by the manual Refresh button so a click actually pulls new
  // trades instead of showing the same cached rows back.
  const fetchTrades = useCallback(async (opts = {}) => {
    const isLegacyBool = typeof opts === 'boolean';
    const resetLimit = isLegacyBool ? opts : (opts.resetLimit !== false);
    const skipCache = !isLegacyBool && opts.skipCache === true;
    if (!tokenAddress) {
      setLoading(false);
      return;
    }

    try {
      if (resetLimit) {
        setLoading(true);
        // Clear the previous token's trades immediately so a token SWITCH never
        // shows stale rows from the old token while the new fetch is in flight.
        // (The warm prefetch cache below repopulates instantly when present.)
        setTrades([]);
        currentLimitRef.current = initialLimit;
      }

      // Check prefetch cache first (populated by App.jsx selectToken).
      // A manual Refresh click sets skipCache so we bypass this and go
      // straight to the network.
      if (resetLimit && !skipCache) {
        const cached = await getCachedTrades(tokenAddress, networkId);
        if (cached && cached.length > 0) {
          setTrades(cached);
          setHasMore(cached.length >= currentLimitRef.current && currentLimitRef.current < 200);
          setError(null);
          setLoading(false);
          return;
        }
      }

      let tradesData = null;

      // Fetch trades via Codex API
      try {
        const codexRes = await getLatestTrades(tokenAddress, networkId, currentLimitRef.current);
        if (codexRes?.trades?.length > 0) {
          tradesData = codexRes.trades.map(t => {
            const price = parseFloat(t.priceUSD || t.priceUsd || t.price) || 0;
            const amount = parseFloat(t.amountToken || t.amount) || 0;
            // Always compute USD from amount * price (server amountUSD can be wrong due to decimal mismatch)
            const value = (amount > 0 && price > 0) ? amount * price : (parseFloat(t.amountUSD || t.amountUsd || t.value) || 0);
            const ts = t.timestamp || t.blockTimestamp;
            const tsMs = typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts;
            return {
              timestamp: new Date(tsMs),
              type: t.type || 'Swap',
              price,
              amount,
              value,
              maker: t.maker || '',
              txHash: t.txHash || t.transactionHash || '',
              symbol: t.symbol || '',
              // App the swap was placed through ({ id, name }) or null - see
              // the server's normalizeTradeSource. Distinct from `_source`
              // below, which is OUR data lane (codex poll vs SSE stream).
              source: t.source || null,
              formattedPrice: formatPrice(price),
              formattedValue: formatLargeNumber(value),
              _source: 'codex',
            };
          }).filter(t => !_isEmptyTrade(t));
        }
      } catch (err) {
        console.warn('[codex] Trades failed:', err.message);
      }

      if (tradesData && tradesData.length > 0) {
        setTrades(tradesData);
        setHasMore(tradesData.length >= currentLimitRef.current && currentLimitRef.current < 200);
        setError(null);
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
        setTrades([]);
      }
    } finally {
      setLoading(false);
    }
  }, [tokenAddress, networkId, initialLimit]);

  const MAX_TRADES = 200;

  const loadMore = useCallback(async () => {
    if (!tokenAddress || loadingMore || !hasMore) return;

    if (currentLimitRef.current >= MAX_TRADES) {
      setHasMore(false);
      return;
    }

    try {
      setLoadingMore(true);
      currentLimitRef.current = Math.min(currentLimitRef.current + 50, MAX_TRADES);

      let moreData = null;
      try {
        const codexRes = await getLatestTrades(tokenAddress, networkId, currentLimitRef.current);
        if (codexRes?.trades?.length > 0) {
          moreData = codexRes.trades.map(t => {
            const price = parseFloat(t.priceUSD || t.priceUsd || t.price) || 0;
            const amount = parseFloat(t.amountToken || t.amount) || 0;
            // Always compute USD from amount * price (server amountUSD can be wrong due to decimal mismatch)
            const value = (amount > 0 && price > 0) ? amount * price : (parseFloat(t.amountUSD || t.amountUsd || t.value) || 0);
            const ts = t.timestamp || t.blockTimestamp;
            const tsMs = typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts;
            return {
              timestamp: new Date(tsMs),
              type: t.type || 'Swap',
              price, amount, value,
              maker: t.maker || '',
              txHash: t.txHash || t.transactionHash || '',
              symbol: t.symbol || '',
              source: t.source || null,
              formattedPrice: formatPrice(price),
              formattedValue: formatLargeNumber(value),
              _source: 'codex',
            };
          }).filter(t => !_isEmptyTrade(t));
        }
      } catch (err) {
        console.warn('[codex] loadMore failed:', err.message);
      }

      if (moreData && moreData.length > 0) {
        setTrades(moreData);
        setHasMore(moreData.length >= currentLimitRef.current && currentLimitRef.current < MAX_TRADES);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error('Failed to load more trades:', err);
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [tokenAddress, networkId, loadingMore, hasMore]);

  // Initial fetch on token change only. The cadence effect below re-arms the
  // interval when the stream's liveness flips without refetching.
  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden && isAppActive()) fetchTrades(false);
    }, streamLive ? TRADES_POLL_LIVE_MS : TRADES_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchTrades, streamLive]);

  // The stream closes while the user is idle or the tab is hidden, and the
  // poll above skips those ticks too - so the tape can be up to one idle
  // stretch behind when they come back. Reconcile at once on resume (the
  // stream reopens in parallel and carries every trade from then on).
  useEffect(() => {
    const onVis = () => { if (!document.hidden && isAppActive()) fetchTrades(false); };
    document.addEventListener('visibilitychange', onVis);
    const unsubActivity = subscribeActivity((active) => { if (active && !document.hidden) fetchTrades(false); });
    return () => { document.removeEventListener('visibilitychange', onVis); unsubActivity(); };
  }, [fetchTrades]);

  // Manual refresh: invalidate the prefetch cache entry for this token
  // AND skip the cache check inside fetchTrades, so the click guarantees
  // a network round-trip. (Without this, a click within the 2-min TTL
  // re-hydrates the same rows and looks like the button does nothing.)
  const refresh = useCallback(() => {
    const nid = inferNetworkId(tokenAddress, networkId);
    const cacheKey = _tradesKey(tokenAddress, nid);
    tradesCache.delete(cacheKey);
    return fetchTrades({ resetLimit: true, skipCache: true });
  }, [tokenAddress, networkId, fetchTrades]);

  return { trades, pairs, loading, loadingMore, error, hasMore, refresh, loadMore };
}

/**
 * Combined hook for all token data (stats + pairs + trades)
 */
export function useFullTokenData(tokenAddress, networkId = 1) {
  const { stats, loading: statsLoading, error: statsError } = useTokenStats(tokenAddress, networkId);
  const { pairs, loading: pairsLoading, error: pairsError } = useTokenPairs(tokenAddress, networkId);

  const mainPair = pairs[0];
  const { trades, loading: tradesLoading, error: tradesError } = useLatestTrades(
    mainPair?.address,
    networkId,
    50
  );

  return {
    stats,
    pairs,
    trades,
    mainPair,
    loading: statsLoading || pairsLoading || tradesLoading,
    error: statsError || pairsError || tradesError,
  };
}

// In-memory cache for token details
const tokenDetailsCache = new Map();
const CACHE_TTL = 30000;

// In-flight prefetch dedup
const _detailsPreflight = new Map();

// Canonical details-cache key: lowercase address + inferred networkId. The
// prefetch path historically keyed on the RAW (address, networkId) pair while
// hooks keyed on their own casing/network inference - the same details were
// fetched twice under two keys on every cold load. One helper, every site.
const _detailsKey = (address, networkId) =>
  `${String(address || '').toLowerCase()}-${inferNetworkId(address, networkId)}`;

/** Map a server details payload (getDetailedTokenInfo / snapshot.details -
 *  same endpoint shape) into the cache object every consumer reads. Single
 *  normaliser shared by prefetch + snapshot seeding. Never sets `_partial`. */
function _normaliseDetails(codexRes, address, networkId) {
  if (!codexRes) return null;
  return {
    address: codexRes.address || address,
    name: codexRes.name || '', symbol: codexRes.symbol || '',
    networkId: codexRes.networkId || networkId,
    logo: codexRes.imageLargeUrl || codexRes.imageThumbUrl || codexRes.logo || null,
    description: codexRes.description || '',
    price: parseFloat(codexRes.priceUSD || codexRes.price) || 0,
    volume24: parseFloat(codexRes.volume24 || codexRes.volume24h) || 0,
    liquidity: parseFloat(codexRes.liquidity) || 0,
    marketCap: parseFloat(codexRes.marketCap) || 0,
    change24: parseFloat(codexRes.change24) || 0,
    change1h: parseFloat(codexRes.change1h) || 0,
    change4h: parseFloat(codexRes.change4h) || 0,
    change12h: parseFloat(codexRes.change12h) || 0,
    change5m: parseFloat(codexRes.change5m) || 0,
    circulatingSupply: parseFloat(codexRes.circulatingSupply) || 0,
    totalSupply: parseFloat(codexRes.totalSupply) || 0,
    holders: parseInt(codexRes.holders) || 0,
    socials: codexRes.socials || {},
    decimals: parseInt(codexRes.decimals) || 18,
    fdv: parseFloat(codexRes.fdv) || 0,
    createdAt: codexRes.createdAt ? Number(codexRes.createdAt) : null,
    _source: 'codex',
  };
}

/**
 * Prefetch token details from the API and populate the cache.
 * Call this early (before lazy components mount) to eliminate wait time.
 */
export function prefetchTokenDetails(address, networkId = 1) {
  if (!address) return;
  const cacheKey = _detailsKey(address, networkId);
  // Already cached and fresh
  const cached = tokenDetailsCache.get(cacheKey);
  if (cached && !cached.data._partial && (Date.now() - cached.timestamp) < CACHE_TTL) return;
  // Already in-flight
  if (_detailsPreflight.has(cacheKey)) return;

  const promise = getDetailedTokenInfo(address, networkId)
    .then(codexRes => {
      const data = _normaliseDetails(codexRes, address, networkId);
      if (!data) return;
      tokenDetailsCache.set(cacheKey, { data, timestamp: Date.now() });
    })
    .catch(() => {})
    .finally(() => _detailsPreflight.delete(cacheKey));

  _detailsPreflight.set(cacheKey, promise);
}

/**
 * Fan a /api/token/snapshot payload out into the EXACT module caches the
 * data hooks already read - tokenDetailsCache (useTokenDetails),
 * chartBarsCache (useChartData/getCachedBars) and tradesCache
 * (useLatestTrades/getCachedTrades) - plus the color cache both accent
 * consumers poll. This is what makes the snapshot's bytes fully consumed:
 * without it the hooks re-fetched details/bars/trades the snapshot had
 * already carried (the measured duplicate-fetch waterfall).
 *
 * Uses the same normalisers as the prefetch paths so seeded and fetched
 * objects are shape-identical. A FULL-shape details payload seeds a normal
 * (non-partial) entry; a TRIMMED payload (no circulatingSupply key - e.g. a
 * batch-row shape or an old prod KV snapshot) seeds `_partial: true` so
 * useTokenDetails paints it instantly but still fetches the full shape in
 * the background - otherwise Circ.Supply/totalSupply/socials sit at 0 until
 * the next 120s poll (the localhost "Circ. Supply 0" bug, 2026-06-10).
 */
export function seedCachesFromSnapshot(snapshot) {
  if (!snapshot?.address) return;
  const address = snapshot.address;
  const networkId = snapshot.networkId;

  if (snapshot.details) {
    const data = _normaliseDetails(snapshot.details, snapshot.details.address || address, networkId);
    if (data) {
      if (snapshot.details.circulatingSupply === undefined || snapshot.details._batchShape) {
        data._partial = true;
      }
      tokenDetailsCache.set(_detailsKey(address, networkId), { data, timestamp: Date.now() });
    }
  }

  // Snapshot bars are a 300-countback window at the chart's BOOT resolution
  // (barsResolution, default 1H). Seed under THAT resolution so the chart's
  // actual default timeframe finds them - the old hardcoded '60' meant any
  // non-1H boot timeframe missed the snapshot and cold-fetched the full window.
  const rawBars = snapshot.bars?.bars || snapshot.bars; // server may return either shape
  if (Array.isArray(rawBars) && rawBars.length > 0) {
    const bars = _normaliseBars(rawBars);
    if (bars.length > 0) {
      const snapRes = snapshot.barsResolution || '60';
      const key = _chartBarsKey(address, networkId, snapRes, 'countback');
      // NEVER CLOBBER a richer entry (2026-08-06, the 1m history latch): on a
      // deep-link reload prefetchChartBars fires the WIDE fetch (~500-1050
      // bars) at HTML-parse time; the snapshot resolves ~1.5s later and this
      // unconditional set() used to REPLACE the in-flight promise (or its
      // resolved payload) with the snapshot's 300-bucket window. The chart
      // then booted from the short window, undershooting TV's countBack -> TV
      // escalated into its epoch-anchored request and latched "history
      // complete" (dead scroll-back + the reload 2-bar flash). Keep whichever
      // entry has more to offer; mark snapshot windows so the datafeed knows
      // a short entry is a PARTIAL window, not a young token's whole life.
      const existing = chartBarsCache.get(key);
      const existingRich = existing && (existing.promise || (existing.bars && existing.bars.length >= bars.length));
      if (!existingRich) {
        chartBarsCache.set(key, { bars, timestamp: Date.now(), origin: 'snapshot' });
      }
    }
  }

  if (Array.isArray(snapshot.trades) && snapshot.trades.length > 0) {
    const trades = _normaliseTrades(snapshot.trades);
    if (trades) {
      tradesCache.set(_tradesKey(address, inferNetworkId(address, networkId)), { trades, timestamp: Date.now() });
    }
  }

  // Color rides the snapshot too - seed so the orb painter and
  // useAccentTheme resolve synchronously instead of racing extraction.
  const logoUrl = snapshot.details?.logo || null;
  if (snapshot.color && logoUrl) seedColorCache(logoUrl, snapshot.color);
}

/**
 * Pre-warm the token details cache with data already available from the
 * discovery table.
 */
export function prewarmTokenDetailsCache(tokenData) {
  if (!tokenData?.address) return;
  const nid = inferNetworkId(tokenData.address, tokenData.networkId);
  const cacheKey = _detailsKey(tokenData.address, nid);
  const partial = {
    address: tokenData.address,
    name: tokenData.name || tokenData.symbol || '',
    symbol: tokenData.symbol || '',
    networkId: nid,
    logo: tokenData.logo || null,
    description: tokenData.description || '',
    price: tokenData.price || 0,
    volume24: tokenData.volume24 || tokenData.volume24h || 0,
    liquidity: tokenData.liquidity || 0,
    marketCap: tokenData.marketCap || 0,
    change24: tokenData.change24h || tokenData.change || 0,
    change1h: tokenData.change1h || 0,
    change4h: tokenData.change4h || 0,
    change12h: tokenData.change12h || 0,
    circulatingSupply: tokenData.circulatingSupply || 0,
    totalSupply: tokenData.totalSupply || 0,
    holders: tokenData.holders || 0,
    socials: tokenData.socials || {},
    _partial: true,
  };
  tokenDetailsCache.set(cacheKey, { data: partial, timestamp: Date.now() });
}

/**
 * Hook for fetching detailed token info for the main banner
 * Uses in-memory caching for faster subsequent lookups
 */
// 2026-06-02 cost defense: refreshInterval default 60s -> 120s. Token detail
// poll fires a Codex filterTokens (Phase J2 collapsed 2-query into 1, but the
// volume24/liquidity selection still bills with the listPairsWithMetadata
// lockstep = 2 ops per call). 120s halves the cost; SSE drives price ticks
// in the meantime so the visible price field stays live regardless. mcap /
// volume / liquidity / change are research-tier, not seconds-sensitive.
export function useTokenDetails(address, networkId = 1, refreshInterval = 120000) {
  const [tokenData, setTokenData] = useState(() => {
    const cacheKey = _detailsKey(address, networkId);
    const cached = tokenDetailsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      return cached.data;
    }
    try {
      const stored = localStorage.getItem('spectre-selected-token');
      if (stored) {
        const t = JSON.parse(stored);
        if (t.address === address) {
          const partial = {
            address: t.address, name: t.name || t.symbol || '', symbol: t.symbol || '',
            networkId: inferNetworkId(t.address, t.networkId), logo: t.logo || null, description: t.description || '',
            price: t.price || 0, volume24: t.volume24 || 0, liquidity: t.liquidity || 0,
            marketCap: t.marketCap || 0, change24: t.change24h || t.change || 0,
            change1h: t.change1h || 0, change4h: t.change4h || 0, change12h: t.change12h || 0,
            circulatingSupply: t.circulatingSupply || 0, totalSupply: t.totalSupply || 0,
            holders: 0, socials: t.socials || {}, _partial: true,
          };
          tokenDetailsCache.set(cacheKey, { data: partial, timestamp: Date.now() });
          return partial;
        }
      }
    } catch (_) { console.error(_) }
    return null;
  });
  const [loading, setLoading] = useState(!tokenData);
  const [error, setError] = useState(null);
  const isMounted = useRef(true);

  // AbortController for the *current* token. Reset whenever (address, networkId)
  // change so the previous fetch chain cancels instead of racing to write stale
  // data onto a different token's view. Critical for rapid token-switch UX.
  const abortRef = useRef(null);

  const fetchDetails = useCallback(async (forceRefresh = false, signal = null) => {
    if (!address) {
      setLoading(false);
      return;
    }

    const cacheKey = _detailsKey(address, networkId);
    const fetchOpts = signal ? { signal } : {};
    const isAborted = () => signal?.aborted;

    if (!forceRefresh) {
      // Wait for in-flight prefetch if one is running
      const inflight = _detailsPreflight.get(cacheKey);
      if (inflight) {
        await inflight;
      }
      if (isAborted()) return;
      const cached = tokenDetailsCache.get(cacheKey);
      // A `_partial` entry is the localStorage seed (price/symbol only) with
      // circulatingSupply / totalSupply / holders = 0. Treat it as a MISS so we
      // fetch the real details - mirrors prefetchTokenDetails (L1491). Without
      // this, the partial is served as a fresh cache hit and never replaced, so
      // the RightPanel's Circ. Supply (and totalSupply) sit at 0 for the whole
      // refreshInterval even though /api/token/details has the real values.
      if (cached && !cached.data._partial && (Date.now() - cached.timestamp) < CACHE_TTL) {
        if (isMounted.current && !isAborted()) {
          setTokenData(cached.data);
          setLoading(false);
        }
        return;
      }
    }

    try {
      if (!tokenData) {
        setLoading(true);
      }

      let data = null;

      // Major tokens: use Codex filterTokens with address lookup (more reliable than token query for wrapped assets)
      // CEX-only tokens (XRP, ADA, DOT) without DEX addresses fall through to Codex search below
      const MAJOR_TOKEN_ADDR = {
        'BTC': { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', networkId: 1, name: 'Bitcoin' },
        'WBTC': { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', networkId: 1, name: 'Bitcoin' },
        'ETH': { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', networkId: 1, name: 'Ethereum' },
        'WETH': { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', networkId: 1, name: 'Ethereum' },
        'SOL': { address: 'So11111111111111111111111111111111111111112', networkId: 1399811149, name: 'Solana' },
        'BNB': { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', networkId: 56, name: 'BNB' },
        'USDT': { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', networkId: 1, name: 'Tether' },
        'USDC': { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', networkId: 1, name: 'USD Coin' },
        'LINK': { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', networkId: 1, name: 'Chainlink' },
        'UNI': { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', networkId: 1, name: 'Uniswap' },
        'AAVE': { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', networkId: 1, name: 'Aave' },
        'ARB': { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', networkId: 42161, name: 'Arbitrum' },
      }
      const savedToken = (() => { try { return JSON.parse(localStorage.getItem('spectre-selected-token') || '{}') } catch { return {} } })()
      const sym = (savedToken.symbol || '').toUpperCase()
      const majorAddr = MAJOR_TOKEN_ADDR[sym]
      // cgId for the CURRENT token -> serve its DETAIL from CoinGecko so the REAL
      // asset shows (Bitcoin's ~$1.2T mcap + 20M supply + orange logo), NOT the
      // wrapped WBTC contract's $7B / 116K. Resolved three ways, in order:
      //   1. explicit cgId on the selection blob (a Top Coins click carries it);
      //   2. a wrapped-major CONTRACT address (so a deep-link / reload of the
      //      WBTC/WETH/WBNB/wSOL contract still resolves to its underlying asset
      //      instead of falling back to the wrapped token's own Codex stats);
      //   3. an off-chain-major SLUG used as the address (XRP/ADA, no contract).
      // The CHART still uses the on-chain contract for full-range bars. holders +
      // on-chain liquidity are genuinely N/A for these CEX-priced assets.
      const cgId = resolveMajorCgId({
        cgId: (savedToken.address === address && savedToken.cgId) ? savedToken.cgId : null,
        address,
      })

      if (cgId && !isAborted()) {
        try {
          const cg = await getCoinGeckoDetail(cgId, fetchOpts)
          const md = cg?.market_data
          if (md) {
            data = {
              address,
              cgId,
              name: cg.name || sym,
              symbol: (cg.symbol || sym).toUpperCase(),
              networkId,
              logo: cg.image?.large || cg.image?.small || null,
              description: cg.description?.en || '',
              price: md.current_price?.usd || 0,
              volume24: md.total_volume?.usd || 0,
              liquidity: 0,
              marketCap: md.market_cap?.usd || 0,
              // RightPanel multiplies change* by 100, so store CG percents as ratios.
              change24: (md.price_change_percentage_24h || 0) / 100,
              change1h: (md.price_change_percentage_1h_in_currency?.usd || 0) / 100,
              change4h: 0,
              change12h: 0,
              change5m: 0,
              circulatingSupply: md.circulating_supply || 0,
              // Use the supply CAP as the donut denominator when CoinGecko has one
              // (BTC: circ=total=20.05M but max=21M -> "20.05M of 21M", ~95% mined,
              // not a flat 100%). Falls back to total_supply for uncapped assets (ETH).
              totalSupply: Math.max(Number(md.max_supply) || 0, Number(md.total_supply) || 0),
              holders: 0,
              socials: {
                twitter: cg.links?.twitter_screen_name ? `https://twitter.com/${cg.links.twitter_screen_name}` : null,
                website: cg.links?.homepage?.[0] || null,
              },
              decimals: 18,
              fdv: md.fully_diluted_valuation?.usd || 0,
              // Extra CoinGecko fields for the major-coin right-rail tiles
              // (24h Range replaces Liquidity; From-ATH replaces Holders).
              high24: md.high_24h?.usd || 0,
              low24: md.low_24h?.usd || 0,
              ath: md.ath?.usd || 0,
              athDate: md.ath_date?.usd || null,
              athChangePct: typeof md.ath_change_percentage?.usd === 'number' ? md.ath_change_percentage.usd : null,
              topPairAddress: null,
              _source: 'coingecko',
            }
          }
        } catch (cgErr) {
          if (cgErr?.name !== 'AbortError') console.warn('[coingecko] detail failed:', cgErr.message)
        }
      }

      if (!data && majorAddr && !isAborted()) {
        // Codex details for major tokens with known addresses
        try {
          const codexRes = await getDetailedTokenInfo(majorAddr.address, majorAddr.networkId, fetchOpts)
          if (codexRes) {
            const codexPrice = parseFloat(codexRes.priceUSD || codexRes.price) || 0
            data = {
              address: address,
              name: majorAddr.name || codexRes.name || sym,
              symbol: codexRes.symbol?.toUpperCase() || sym,
              networkId,
              logo: codexRes.imageLargeUrl || codexRes.imageThumbUrl || codexRes.logo || null,
              description: codexRes.description || '',
              price: codexPrice,
              volume24: parseFloat(codexRes.volume24 || codexRes.volume24h) || 0,
              liquidity: parseFloat(codexRes.liquidity) || 0,
              marketCap: parseFloat(codexRes.marketCap) || 0,
              change24: parseFloat(codexRes.change24) || 0,
              change1h: parseFloat(codexRes.change1) || 0,
              change4h: parseFloat(codexRes.change4) || 0,
              change12h: parseFloat(codexRes.change12) || 0,
              change5m: parseFloat(codexRes.change5m) || 0,
              circulatingSupply: parseFloat(codexRes.circulatingSupply) || 0,
              totalSupply: parseFloat(codexRes.totalSupply) || 0,
              holders: parseInt(codexRes.holders) || 0,
              socials: codexRes.socials || { twitter: null, website: null },
              decimals: codexRes.decimals || 18,
              fdv: parseFloat(codexRes.fdv) || 0,
              topPairAddress: codexRes.topPairAddress || null,
              _source: 'codex',
            }
          }
        } catch (codexErr) {
          console.warn('[codex] Major token fetch failed:', codexErr.message)
        }
      }

      // Codex for all other tokens (or if CoinGecko failed for major)
      if (!data && !isAborted()) {
        try {
          const codexRes = await getDetailedTokenInfo(address, networkId, fetchOpts);
          if (codexRes) {
            const codexPrice = parseFloat(codexRes.priceUSD || codexRes.price) || 0;
            data = {
              address: codexRes.address || address,
              name: codexRes.name || '',
              symbol: codexRes.symbol || '',
              networkId: codexRes.networkId || networkId,
              logo: codexRes.imageLargeUrl || codexRes.imageThumbUrl || codexRes.logo || null,
              description: codexRes.description || '',
              price: codexPrice,
              volume24: parseFloat(codexRes.volume24 || codexRes.volume24h) || 0,
              liquidity: parseFloat(codexRes.liquidity) || 0,
              marketCap: parseFloat(codexRes.marketCap) || 0,
              change24: parseFloat(codexRes.change24) || 0,
              change1h: parseFloat(codexRes.change1h) || 0,
              change4h: parseFloat(codexRes.change4h) || 0,
              change12h: parseFloat(codexRes.change12h) || 0,
              change5m: parseFloat(codexRes.change5m) || 0,
              circulatingSupply: parseFloat(codexRes.circulatingSupply) || 0,
              totalSupply: parseFloat(codexRes.totalSupply) || 0,
              holders: parseInt(codexRes.holders) || 0,
              socials: codexRes.socials || {},
              decimals: parseInt(codexRes.decimals) || 18,
              fdv: parseFloat(codexRes.fdv) || 0,
              topPairAddress: codexRes.topPairAddress || null,
              createdAt: codexRes.createdAt ? Number(codexRes.createdAt) : null,
              _source: 'codex',
            };
          }
        } catch (err) {
          // Aborted = a superseded/unmounted request (rapid token switch), not a
          // failure — don't log it. Real errors still warn.
          if (err?.name !== 'AbortError') console.warn('[codex] Token details failed:', err.message);
        }
      }

      // If primary sources failed, try search as last resort for change data
      if (!data && address && !isAborted()) {
        try {
          const searchRes = await searchTokens(address, [networkId], fetchOpts)
          const sr = searchRes?.filterTokens?.results?.[0]
          if (sr) {
            // Merge search data into partial cache
            const existing = tokenDetailsCache.get(cacheKey)?.data || {}
            data = {
              ...existing,
              address,
              networkId,
              symbol: sr.token?.symbol || existing.symbol || '',
              name: sr.token?.name || existing.name || '',
              logo: sr.token?.info?.imageThumbUrl || existing.logo || null,
              price: parseFloat(sr.priceUSD) || existing.price || 0,
              change24: parseFloat(sr.change24) || 0,
              change1h: parseFloat(sr.change1) || 0,
              change4h: parseFloat(sr.change4) || 0,
              change12h: parseFloat(sr.change12) || 0,
              volume24: parseFloat(sr.volume24 || sr.volume) || existing.volume24 || 0,
              liquidity: parseFloat(sr.liquidity) || existing.liquidity || 0,
              marketCap: parseFloat(sr.marketCap) || existing.marketCap || 0,
              holders: parseInt(sr.holders) || existing.holders || 0,
              _source: 'codex-search',
            }
          }
        } catch { /* search fallback failed */ }
      }

      if (data && isMounted.current && !isAborted()) {
        tokenDetailsCache.set(cacheKey, {
          data,
          timestamp: Date.now()
        });
        setTokenData(data);
        setError(null);
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;  // expected on token-switch / unmount
      console.error('Failed to fetch token details:', err);
      if (isMounted.current && !isAborted()) {
        setError(err.message);
      }
    } finally {
      if (isMounted.current && !isAborted()) {
        setLoading(false);
      }
    }
  }, [address, networkId, tokenData]);

  useEffect(() => {
    isMounted.current = true;

    // Cancel any in-flight fetch for the *previous* (address, networkId).
    // Without this, a rapid token-switch from A → B → C results in three
    // overlapping fetch chains and stale state writes.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;

    const cacheKey = _detailsKey(address, networkId);
    const cached = tokenDetailsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      setTokenData(cached.data);
      setLoading(false);
      if (cached.data?._partial) {
        fetchDetails(true, signal);
      }
    } else {
      // Clear stale data from previous token so we don't show wrong symbol/name
      setTokenData(null);
      setLoading(true);
      fetchDetails(false, signal);
    }

    // 2026-06-03 cost war: pass `refreshInterval = 0` to skip the poll
    // entirely (one-shot fetch only). Used by TokenDetailsContext when
    // running inside the research /token iframe — the parent already polls.
    const interval = refreshInterval > 0
      ? setInterval(() => {
          if (!document.hidden && isAppActive()) fetchDetails(true, signal);
        }, refreshInterval)
      : null;

    return () => {
      isMounted.current = false;
      if (interval) clearInterval(interval);
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
  }, [address, networkId, refreshInterval]);

  // `refresh` MUST keep `fetchDetails` in its deps: fetchDetails is
  // useCallback([address, networkId, tokenData]), so it changes with the data.
  // An empty dep array here would freeze refresh on the first-render closure
  // and it would re-request against stale state.
  const refresh = useCallback(() => fetchDetails(true), [fetchDetails]);

  // Memoized so this hook stops handing out a fresh object on every render.
  // TokenDetailsContext feeds its `merged` useMemo from this value, so an
  // unstable identity made the context value change on EVERY provider render -
  // fanning a re-render out to TokenBanner / LeftPanel / RightPanel / DataTabs /
  // TradingChart even when tokenData was byte-identical. Real updates still
  // propagate: setTokenData always writes a freshly-built object and nothing
  // mutates tokenData in place.
  return useMemo(
    () => ({ tokenData, loading, error, refresh }),
    [tokenData, loading, error, refresh]
  );
}

/**
 * Hook for aggregate market stats (Discover page)
 */
export function useMarketStats(refreshInterval = 60000) {
  const [stats, setStats] = useState({
    totalMcap: '$3.42T',
    volume24h: '$127.8B',
    btcDominance: '56.4%',
    ethDominance: '17.2%',
    activePairs: '24,891',
    mcapChange: 2.1,
    volumeChange: -5.3,
    btcDomChange: -0.3,
    ethDomChange: 0.2,
    sentiment: 0.62,
    defiMcap: '$115.0B',
    defiVolume24h: '$8.5B',
    defiDominance: '3.87%',
    defiMcapChange: 3.4,
    defiVolChange: -2.1,
    defiDomChange: 0.15,
    activePairsChange: 0.8,
    topDefiName: 'Lido Staked Ether',
    topDefiDominance: '15.4%',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch('/api/market/stats');
      if (response.ok) {
        const data = await response.json();
        if (data && data.totalMarketCap) {
          const fmt = (n) => {
            if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
            if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
            if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
            return `$${Math.round(n).toLocaleString()}`;
          };
          setStats({
            totalMcap: fmt(data.totalMarketCap),
            volume24h: fmt(data.totalVolume),
            btcDominance: `${parseFloat(data.btcDominance).toFixed(1)}%`,
            ethDominance: `${parseFloat(data.ethDominance || 0).toFixed(1)}%`,
            activePairs: Math.round(data.activePairs).toLocaleString(),
            mcapChange: parseFloat(data.mcapChange24h) || 0,
            volumeChange: parseFloat(data.volumeChange24h) || 0,
            btcDomChange: parseFloat(data.btcDomChange24h) || 0,
            ethDomChange: parseFloat(data.ethDomChange24h) || 0,
            sentiment: parseFloat(data.sentiment) || 0.5,
            defiMcap: fmt(data.defiMarketCap || 0),
            defiVolume24h: fmt(data.defiVolume24h || 0),
            defiDominance: `${parseFloat(data.defiDominance || 0).toFixed(1)}%`,
            defiMcapChange: parseFloat(data.defiMcapChange24h) || 0,
            defiVolChange: parseFloat(data.defiVolChange24h) || 0,
            defiDomChange: parseFloat(data.defiDomChange24h) || 0,
            activePairsChange: parseFloat(data.activePairsChange24h) || 0,
            topDefiName: data.topDefiName || 'Lido Staked Ether',
            topDefiDominance: `${parseFloat(data.topDefiDominance || 0).toFixed(1)}%`,
          });
          setError(null);
        }
      }
    } catch (err) { console.error(err) } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof console !== 'undefined') console.count('useMarketStats-mount');
    fetchStats();
    const interval = setInterval(() => {
      if (!document.hidden && isAppActive()) fetchStats();
    }, refreshInterval);
    const onVis = () => { if (!document.hidden) fetchStats(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchStats, refreshInterval]);

  return { stats, loading, error, refresh: fetchStats };
}

/**
 * Hook for narrative/sector metrics (Discover page)
 */
export function useNarrativeMetrics(trendingTokens = []) {
  const narratives = useMemo(() => {
    const SECTORS = [
      { id: 'memes', name: 'Memes', color: '#FBBF24' },
      { id: 'defi', name: 'DeFi', color: '#60A5FA' },
      { id: 'ai', name: 'AI Agents', color: '#A78BFA' },
      { id: 'gaming', name: 'Gaming', color: '#F472B6' },
      { id: 'infra', name: 'Infrastructure', color: '#6366F1' },
      { id: 'rwa', name: 'RWA', color: '#34D399' },
      { id: 'layer2', name: 'Layer 2', color: '#22D3EE' },
      { id: 'nft', name: 'NFT/Social', color: '#FB923C' },
    ];
    const TOKENS_BY_SECTOR = {
      memes: ['PEPE', 'WIF', 'BONK', 'DOGE', 'SHIB', 'FLOKI'],
      defi: ['UNI', 'AAVE', 'MKR', 'CRV', 'SNX', 'LINK', 'LDO'],
      ai: ['FET', 'AGIX', 'OCEAN', 'RNDR', 'TAO'],
      gaming: ['IMX', 'GALA', 'AXS', 'SAND', 'MANA'],
      infra: ['ARB', 'OP', 'MATIC', 'AVAX', 'SOL', 'ETH'],
      rwa: ['ONDO', 'RIO', 'TRU', 'CFG'],
      layer2: ['ARB', 'OP', 'STRK', 'MNT', 'METIS'],
      nft: ['BLUR', 'APE', 'LOOKS', 'MAGIC'],
    };

    return SECTORS.map(sector => {
      const sectorSymbols = TOKENS_BY_SECTOR[sector.id] || [];
      const matching = trendingTokens.filter(t =>
        sectorSymbols.includes(t.symbol?.toUpperCase())
      );
      const avgChange = matching.length > 0
        ? matching.reduce((sum, t) => sum + (t.change || 0), 0) / matching.length
        : (Math.random() - 0.3) * 15;
      const totalVolume = matching.reduce((sum, t) => sum + (t.volume24h || t.volume || 0), 0);

      return {
        ...sector,
        tokens: matching.slice(0, 3),
        avgChange: parseFloat(avgChange.toFixed(2)),
        totalVolume,
        tokenCount: matching.length || Math.floor(3 + Math.random() * 5),
      };
    }).sort((a, b) => Math.abs(b.avgChange) - Math.abs(a.avgChange));
  }, [trendingTokens]);

  return { narratives, loading: false };
}

export default {
  useTrendingTokens,
  useTokenSearch,
  useTokenStats,
  useChartData,
  useTokenPairs,
  useLatestTrades,
  useFullTokenData,
  useTokenDetails,
  useMarketStats,
  useNarrativeMetrics,
  prewarmTokenDetailsCache,
  prefetchChartBars,
  prefetchLatestTrades,
  getCachedTrades,
};
