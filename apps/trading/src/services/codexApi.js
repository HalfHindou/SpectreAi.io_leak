/**
 * Codex API Service + Utilities
 *
 * Primary and sole data source for the trading app. All market data flows
 * through Codex GraphQL via /api/codex (prod) or /api/tokens/* (dev).
 *
 * Provides:
 * - Token search, details, bars, trades, trending
 * - Formatting helpers (formatLargeNumber, formatPrice)
 * - Network lookup helpers (getNetworkName, getNetworkId)
 * - KNOWN_TOKENS address map
 * - Agent Team Management API functions
 */

import { getSavedChartResolution } from '../lib/chartTimeframes';

// Detect environment for API routing
const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const LOCAL_API_URL = '/api';
const VERCEL_API_URL = '/api/codex';

// When true, skip all CoinGecko/Codex calls
const SPECTRE_API_ONLY = import.meta.env.VITE_SPECTRE_API_ONLY === 'true';

// Hardcoded token logos - override API logo for specific tokens
const HARDCODED_LOGOS = {
  '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6': 'https://coin-images.coingecko.com/coins/images/33066/small/logo_round_transparent.png?1772560594',
};

/** Returns a hardcoded logo if one exists for the given address, else null */
export function getHardcodedLogo(address) {
  if (!address) return null;
  return HARDCODED_LOGOS[address.toLowerCase()] || null;
}

/** Detect Solana address (base58, 32-44 chars, no 0x prefix) */
export function isSolanaAddress(addr) {
  if (!addr || typeof addr !== 'string') return false;
  return !addr.startsWith('0x') && addr.length >= 32 && addr.length <= 44;
}

/** Infer networkId from address format. Returns 1399811149 for Solana, keeps original otherwise. */
export function inferNetworkId(address, networkId) {
  if (networkId && networkId !== 1) return networkId;
  if (isSolanaAddress(address)) return 1399811149;
  return networkId || 1;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Codex API request helper (fallback data source)
// ═══════════════════════════════════════════════════════════════════════════════

// Per-tab telemetry: counts every apiRequest by action + per-minute bucket.
// Surfaces runaway hooks in DevTools (`window.__codexCalls`) before they bill.
// Warn threshold: > 30 calls/min for any single action from one tab is suspect.
if (typeof window !== 'undefined' && !window.__codexCalls) {
  window.__codexCalls = { byAction: {}, byMinute: {}, total: 0, sessionStart: Date.now() };
}

function _recordCodexCall(action) {
  if (typeof window === 'undefined') return;
  const c = window.__codexCalls;
  if (!c) return;
  c.total += 1;
  c.byAction[action] = (c.byAction[action] || 0) + 1;
  const minute = Math.floor(Date.now() / 60000);
  const key = `${minute}:${action}`;
  c.byMinute[key] = (c.byMinute[key] || 0) + 1;
  if (c.byMinute[key] === 31) {
    console.warn(`[codex-telemetry] runaway suspect: ${action} fired 30+ times in last minute from this tab`);
  }
  // Prune buckets older than 10 min to bound memory
  if (Object.keys(c.byMinute).length > 200) {
    const cutoff = minute - 10;
    for (const k of Object.keys(c.byMinute)) {
      if (parseInt(k.split(':')[0], 10) < cutoff) delete c.byMinute[k];
    }
  }
}

// In-flight request dedup. Concurrent identical calls share one Promise.
// Pattern ported from apps/research/src/services/codexApi.js (Sunny's optimization).
const _inflightRequests = new Map();

function _dedupKey(action, params) {
  // Stable key from action + sorted params (excluding objects/arrays we can't serialize cleanly).
  const flat = Object.keys(params).sort().map(k => `${k}=${String(params[k] ?? '')}`).join('&');
  return `${action}?${flat}`;
}

// Wrap a shared Promise so an individual caller's AbortSignal rejects ONLY
// their await without cancelling the underlying fetch for other awaiters.
function _withAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

async function apiRequest(action, params = {}, options = {}) {
  if (SPECTRE_API_ONLY) return null;

  const key = _dedupKey(action, params);
  const existing = _inflightRequests.get(key);
  if (existing) return _withAbort(existing, options.signal);

  const promise = _apiRequestImpl(action, params).finally(() => {
    _inflightRequests.delete(key);
  });
  _inflightRequests.set(key, promise);
  return _withAbort(promise, options.signal);
}

async function _apiRequestImpl(action, params = {}) {
  _recordCodexCall(action);
  try {
    let url;

    // Defense in depth (2026-06-03): bars MUST hit /api/bars in both dev AND
    // prod — that handler runs the L4 cascade (Binance → Hetzner candles_1m
    // → GeckoTerminal → Codex) with KV bucket caching. The frontend
    // getBars() export already hits /api/bars directly, but lock this here
    // too so any future apiRequest('bars') caller can't reintroduce the
    // research-side bleed that drove getBars to 55% of the Jun 3 bill.
    if (action === 'bars') {
      const qs = new URLSearchParams({
        symbol: params.symbol || '',
        from: String(params.from || ''),
        to: String(params.to || ''),
        resolution: params.resolution || '60',
        networkId: String(params.networkId || 1),
      });
      if (params.cgId) qs.set('cgId', params.cgId);
      url = `${LOCAL_API_URL}/bars?${qs.toString()}`;
    } else if (isDev) {
      if (action === 'search') {
        url = `${LOCAL_API_URL}/tokens/search?q=${encodeURIComponent(params.q || '')}`;
        if (params.networks) url += `&networks=${params.networks}`;
        if (params.networkId) url += `&networkId=${encodeURIComponent(params.networkId)}`;
        if (params.fast) url += `&fast=${params.fast}`;
      } else if (action === 'details') {
        url = `${LOCAL_API_URL}/token/details?address=${encodeURIComponent(params.address || '')}&networkId=${params.networkId || 1}`;
      } else if (action === 'trending') {
        const trendParams = new URLSearchParams();
        if (params.networks) trendParams.set('networks', params.networks);
        if (params.timeframe) trendParams.set('timeframe', params.timeframe);
        if (params.limit) trendParams.set('limit', params.limit);
        url = `${LOCAL_API_URL}/tokens/trending${trendParams.toString() ? '?' + trendParams.toString() : ''}`;
      } else if (action === 'most-visited') {
        const mvParams = new URLSearchParams();
        if (params.networks) mvParams.set('networks', params.networks);
        if (params.limit) mvParams.set('limit', params.limit);
        if (params.window) mvParams.set('window', params.window);
        url = `${LOCAL_API_URL}/tokens/most-visited${mvParams.toString() ? '?' + mvParams.toString() : ''}`;
      } else if (action === 'prices') {
        url = `${LOCAL_API_URL}/tokens/price/${encodeURIComponent(params.symbols || '')}`;
      } else if (action === 'bars') {
        url = `${LOCAL_API_URL}/bars?symbol=${encodeURIComponent(params.symbol || '')}&from=${params.from}&to=${params.to}&resolution=${params.resolution || '60'}&networkId=${params.networkId || 1}`;
      } else if (action === 'trades') {
        url = `${LOCAL_API_URL}/token/trades?address=${encodeURIComponent(params.address || '')}&networkId=${params.networkId || 1}&limit=${params.limit || 50}`;
      } else if (action === 'holders') {
        url = `${LOCAL_API_URL}/token/holders?address=${encodeURIComponent(params.address || '')}&networkId=${params.networkId || 1}`;
      } else if (action === 'wallet-stats') {
        url = `${LOCAL_API_URL}/token/wallet-stats?address=${encodeURIComponent(params.address || '')}&networkId=${params.networkId || 1}&wallets=${encodeURIComponent(params.wallets || '')}`;
      } else if (action === 'top-traders') {
        url = `${LOCAL_API_URL}/token/top-traders?address=${encodeURIComponent(params.address || '')}&networkId=${params.networkId || 1}&period=${encodeURIComponent(params.period || 'DAY')}&rank=${encodeURIComponent(params.rank || 'best')}&limit=${params.limit || 25}`;
      } else if (action === 'liquidity-locks') {
        url = `${LOCAL_API_URL}/token/liquidity-locks?address=${encodeURIComponent(params.address || '')}&networkId=${params.networkId || 1}${params.pair ? `&pair=${encodeURIComponent(params.pair)}` : ''}`;
      } else {
        url = `${LOCAL_API_URL}/health`;
      }
    } else {
      const searchParams = new URLSearchParams({ action, ...params });
      url = `${VERCEL_API_URL}?${searchParams}`;
    }

    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      // Ceiling so no consumer (search settled tier, trending, details) can
      // hang forever on a stalled upstream. 20s sits above the slowest known
      // legitimate response (cold trending rebuild ~7s) with margin.
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      // Tag known/expected failure modes so the catch below can downgrade
      // them from console.error to console.debug. 404 = token not indexed
      // by Codex (long-tail token addresses); not a bug, not worth red text.
      const err = new Error(`API error: ${response.status}`);
      err.status = response.status;
      throw err;
    }

    return await response.json();
  } catch (error) {
    // 404 is expected for any token Codex doesn't index. The browser still
    // logs the failed network request once at info level, but we don't add
    // a stacktrace on top of it.
    if (error?.status === 404) {
      if (typeof console !== 'undefined' && console.debug) console.debug('Codex API: token not indexed (404)');
    } else {
      console.error('Codex API request failed:', error);
    }
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Market data functions (Codex fallback)
// ═══════════════════════════════════════════════════════════════════════════════

export async function getTokenInfo(address, networkId = 1) {
  // Same endpoint as getDetailedTokenInfo - go through it so this shares the
  // 30s details cache instead of firing its own duplicate request.
  const result = await getDetailedTokenInfo(address, networkId);
  return result ? { token: result } : null;
}

export async function getTokenPriceBySymbol(symbol) {
  try {
    const result = await apiRequest('prices', { symbols: symbol });
    if (result?.price !== undefined) {
      return { price: result.price || 0, change: result.change || 0, change24: result.change || 0, volume: result.volume || 0, marketCap: result.marketCap || 0 };
    }
    return result?.[symbol] || { price: 0, change24: 0 };
  } catch (err) {
    return { price: 0, change24: 0 };
  }
}

/**
 * Batch fetch prices for N symbols in a single round-trip.
 * Uses /api/tokens/prices (dev) or /api/codex?action=prices (prod), both of
 * which accept a comma-separated symbol list. Replaces the N-call Promise.all
 * pattern in useCuratedTokenPrices: a 10-symbol watchlist drops from
 * 10 calls/min to 1 call/min per user.
 *
 * Returns: { [symbol: string]: { price, change, change24, volume, marketCap } }
 */
export async function getTokenPricesBySymbols(symbols) {
  if (!symbols?.length) return {};
  try {
    const list = (Array.isArray(symbols) ? symbols : [symbols]).map(s => String(s).toUpperCase());
    const csv = list.join(',');
    let payload;
    if (isDev) {
      // Dev Express route returns { BTC: { price, change24, volume, marketCap, ... }, ... }
      const url = `${LOCAL_API_URL}/tokens/prices?symbols=${encodeURIComponent(csv)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Batch prices error: ${response.status}`);
      payload = await response.json();
    } else {
      // Prod Vercel route returns same shape via handleTokenPrices(symbolList).
      payload = await apiRequest('prices', { symbols: csv });
    }
    // Normalize: ensure each symbol has the canonical { price, change, change24, volume, marketCap } shape.
    const out = {};
    for (const sym of list) {
      const raw = payload?.[sym] || payload?.[sym.toLowerCase()] || null;
      if (!raw) continue;
      out[sym] = {
        price: parseFloat(raw.price) || 0,
        change: parseFloat(raw.change ?? raw.change24 ?? 0) || 0,
        change24: parseFloat(raw.change24 ?? raw.change ?? 0) || 0,
        volume: parseFloat(raw.volume ?? raw.volume24 ?? 0) || 0,
        marketCap: parseFloat(raw.marketCap ?? raw.mcap ?? 0) || 0,
      };
    }
    return out;
  } catch (err) {
    console.error('Batched symbol prices failed:', err);
    return {};
  }
}

// Short-lived module cache for the token-detail payload.
//
// WHY (measured 2026-08-04, prod token-page trace): `apiRequest` only dedups
// CONCURRENT callers - the inflight entry is dropped the moment the promise
// settles. The boot fan-out for one token calls this from SIX places at
// DIFFERENT times (App deep-link resolver, prefetchTokenDetails, useTokenDetails,
// TradingChart's topPairAddress resolver, TradingChart's createdAt probe + its
// two 1.5s retries), so the same URL went out six times and each one held a
// browser connection while the critical path queued behind it. Every sibling on
// this endpoint family (getPairInfo, getDetailedTokenStats) already carries a
// TTL cache; details was the one that didn't.
//
// 30s TTL sits far below every consumer's refresh cadence (useTokenDetails polls
// 60-120s, DataTabs' native-price poll is 60s), so no surface goes stale - it
// only collapses the boot burst. `options.force` bypasses it for any caller that
// genuinely needs a fresh read. Failures are never cached (a transient 502 must
// not pin a token to "no details" for 30s).
const _detailsCache = new Map();
const DETAILS_CLIENT_TTL = 30_000;

export async function getDetailedTokenInfo(address, networkId = 1, options = {}) {
  if (!address) return null;
  const key = `${String(address).toLowerCase()}:${String(networkId)}`;
  if (!options.force) {
    const cached = _detailsCache.get(key);
    if (cached && Date.now() - cached.ts < DETAILS_CLIENT_TTL) return cached.data;
  }
  try {
    // apiRequest still owns concurrent dedup + per-caller abort isolation, so a
    // caller aborting mid-flight never cancels the shared fetch for the others.
    const result = await apiRequest('details', { address, networkId: String(networkId) }, options);
    if (result) _detailsCache.set(key, { data: result, ts: Date.now() });
    return result;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return null;
  }
}

/**
 * Top-pair metadata for the mobile Info pair strip + Pair Info rows.
 * Maps to /api/token/pair-info (Express dev) or /api/codex?action=pair-info
 * (Vercel prod). Returns { pairAddress, createdAt, exchange{name,iconUrl,
 * tradeUrl}, token{address,symbol}, quote{address,symbol}, pooledToken,
 * pooledQuote, liquidity, ts } or null. 5min module cache + inflight dedup.
 */
const _pairInfoCache = new Map();
const _pairInfoInflight = new Map();
const PAIR_INFO_CLIENT_TTL = 5 * 60_000;

export async function getPairInfo(address, networkId = 1) {
  if (!address) return null;
  const key = `${address.toLowerCase()}:${networkId}`;
  const cached = _pairInfoCache.get(key);
  if (cached && Date.now() - cached.ts < PAIR_INFO_CLIENT_TTL) return cached.data;
  if (_pairInfoInflight.has(key)) return _pairInfoInflight.get(key);
  const promise = (async () => {
    try {
      const url = isDev
        ? `${LOCAL_API_URL}/token/pair-info?address=${encodeURIComponent(address)}&networkId=${networkId}`
        : `${VERCEL_API_URL}?action=pair-info&address=${encodeURIComponent(address)}&networkId=${networkId}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`pair-info error: ${response.status}`);
      const payload = await response.json();
      const data = payload?.pairAddress ? payload : null;
      if (data) _pairInfoCache.set(key, { data, ts: Date.now() });
      return data;
    } catch (err) {
      console.error('getPairInfo failed:', err?.message || err);
      return null;
    } finally {
      _pairInfoInflight.delete(key);
    }
  })();
  _pairInfoInflight.set(key, promise);
  return promise;
}

/**
 * Per-window token stats for the mobile Info DexScreener-style panel.
 * Maps to /api/token/stats (Express dev) or /api/codex?action=token-stats
 * (Vercel prod). Returns { windows: { '5m'|'1h'|'4h'|'24h': { txns, buys,
 * sells, volume, buyVolume, sellVolume, buyers, sellers, traders } }, ts }
 * or null on failure/empty. Module cache + inflight dedup, 45s TTL
 * (matches the server-side TTL).
 */
const _tokenStatsCache = new Map();
const _tokenStatsInflight = new Map();
const TOKEN_STATS_CLIENT_TTL = 45_000;

export async function getDetailedTokenStats(address, networkId = 1, { force = false } = {}) {
  if (!address) return null;
  const key = `${address.toLowerCase()}:${networkId}`;
  const cached = _tokenStatsCache.get(key);
  if (!force && cached && Date.now() - cached.ts < TOKEN_STATS_CLIENT_TTL) return cached.data;
  if (_tokenStatsInflight.has(key)) return _tokenStatsInflight.get(key);
  const promise = (async () => {
    try {
      const url = isDev
        ? `${LOCAL_API_URL}/token/stats?address=${encodeURIComponent(address)}&networkId=${networkId}`
        : `${VERCEL_API_URL}?action=token-stats&address=${encodeURIComponent(address)}&networkId=${networkId}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`token-stats error: ${response.status}`);
      const payload = await response.json();
      const data = payload?.windows ? payload : null;
      if (data) _tokenStatsCache.set(key, { data, ts: Date.now() });
      return data;
    } catch (err) {
      console.error('getDetailedTokenStats failed:', err?.message || err);
      return null;
    } finally {
      _tokenStatsInflight.delete(key);
    }
  })();
  _tokenStatsInflight.set(key, promise);
  return promise;
}

// ════════════════════════════════════════════════════════════════════════════
// Phase D — token snapshot (aggregate cold-load endpoint)
// ════════════════════════════════════════════════════════════════════════════
//
// fetchTokenSnapshot collapses the cold-load waterfall (details + bars +
// trades + color) into one call against /api/token/snapshot (Express dev
// + /api/token-snapshot.js Vercel prod). Returns the assembled payload
// or null on failure — callers fall back to the existing parallel
// prefetch path.
//
// Module-level cache + in-flight dedup mirrors _trendingCache pattern.
// Two simultaneous calls for the same address coalesce to one network
// request.
//
// SNAPSHOT_ENABLED flag is a one-line kill switch: set to false and the
// client immediately reverts to the per-call cold path (no behavioural
// change, just slower).

const SNAPSHOT_ENABLED = true;
const _snapshotCache = new Map();
const _snapshotInflight = new Map();
const SNAPSHOT_CLIENT_TTL = 30_000;

/**
 * Phase F: batch fetch details for many watchlist tokens in one call.
 * Maps to /api/token/details-batch (Express) or /api/codex?action=details-batch
 * (Vercel) — server runs ONE Codex filterTokens query per chain and
 * returns { addressLower: detailShape, ... }.
 *
 * Replaces the N-parallel-getDetailedTokenInfo pattern in
 * LeftPanel.fetchWatchlistData. N round-trips become 1 (or up to
 * chain-count, since the server groups by network).
 *
 * Accepts: [{ address, networkId }, ...]. Returns: { addressLower: details }.
 * Failures collapse to {} rather than throwing.
 */
export async function fetchTokenDetailsBatch(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return {};
  const ids = tokens
    .map(t => `${t.address}${t.networkId ? ':' + t.networkId : ''}`)
    .filter(Boolean)
    .join(',');
  if (!ids) return {};
  try {
    const url = isDev
      ? `${LOCAL_API_URL}/token/details-batch?ids=${encodeURIComponent(ids)}`
      : `${VERCEL_API_URL}?action=details-batch&ids=${encodeURIComponent(ids)}`;
    // Hard ceiling: this call had NO timeout, so a cold lambda + degraded Codex
    // could hang the whole watchlist/palette hydration indefinitely. 12s covers
    // the server's worst tier chain (5s Codex + DexScreener sanity hop).
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return {};
    const data = await response.json();
    // Server may return { [addr]: details } or { tokens: { [addr]: details } }
    return data?.tokens || data || {};
  } catch {
    return {};
  }
}

/**
 * True when a snapshot for (address, networkId) is already fresh-cached or
 * in flight. Lets App.jsx's mount prefetch skip the individual
 * details/bars/trades calls and ride the ONE snapshot instead (cold
 * deep-link single-data-path).
 */
export function hasSnapshotPending(address, networkId = 1) {
  if (!SNAPSHOT_ENABLED || !address) return false;
  const key = `${String(address).toLowerCase()}:${parseInt(networkId) || 1}`;
  const cached = _snapshotCache.get(key);
  if (cached && Date.now() - cached.ts < SNAPSHOT_CLIENT_TTL) return true;
  return _snapshotInflight.has(key);
}

export async function fetchTokenSnapshot(address, networkId = 1, options = {}) {
  if (!SNAPSHOT_ENABLED || !address) return null;
  const addr = String(address).toLowerCase();
  const nid = parseInt(networkId) || 1;
  const key = `${addr}:${nid}`;

  const cached = _snapshotCache.get(key);
  if (cached && Date.now() - cached.ts < SNAPSHOT_CLIENT_TTL) {
    return cached.data;
  }

  // GP6: adopt the index.html boot script's pre-parse fetch as the in-flight
  // entry. The boot script fired this request BEFORE the bundle parsed - the
  // round-trip overlapped boot - and we consume the promise exactly once
  // (resolved-ok JSON with details only; a 401/miss resolves null so callers
  // fall through to the normal paths).
  if (typeof window !== 'undefined') {
    const boot = window.__SPECTRE_BOOT;
    if (boot && boot.snapshot && boot.address === addr &&
        (parseInt(boot.networkId) || 1) === nid && !_snapshotInflight.has(key)) {
      const adopted = boot.snapshot
        .then((data) => {
          if (data && data.details) {
            _snapshotCache.set(key, { data, ts: Date.now() });
            return data;
          }
          return null;
        })
        .catch(() => null)
        .finally(() => { _snapshotInflight.delete(key); });
      _snapshotInflight.set(key, adopted);
      // Consume ONLY the snapshot member: the boot object may still carry the
      // direct-bars handoff (getBars adopts it separately) - deleting the
      // whole object here raced the bars adoption and silently dropped it.
      try {
        delete boot.snapshot;
        if (!boot.bars || boot.bars.consumed) delete window.__SPECTRE_BOOT;
      } catch { /* read-only env */ }
    }
  }

  const inflight = _snapshotInflight.get(key);
  if (inflight) return _withAbort(inflight, options.signal);

  const promise = (async () => {
    try {
      // phase=fast - server responds when details+bars settle; trades/color
      // race short budgets (a `pending` array names any member that lost its
      // race). Callers backfill pending members; old servers ignore the param.
      // resolution = the user's SAVED chart timeframe, so the snapshot carries
      // the bars the chart will actually mount on. Without it the server
      // defaulted to 1H while the chart mounted at the saved TF -> seed miss ->
      // cold full-window fetch = the measured seconds-long token switch. The
      // index.html boot script passes the same param on reload deep-links.
      const snapRes = getSavedChartResolution();
      const url = isDev
        ? `${LOCAL_API_URL}/token/snapshot?address=${encodeURIComponent(address)}&networkId=${nid}&resolution=${snapRes}&phase=fast`
        : `/api/token-snapshot?address=${encodeURIComponent(address)}&networkId=${nid}&resolution=${snapRes}&phase=fast`;
      const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const data = await response.json();
      _snapshotCache.set(key, { data, ts: Date.now() });
      return data;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      return null;
    } finally {
      _snapshotInflight.delete(key);
    }
  })();

  _snapshotInflight.set(key, promise);
  return _withAbort(promise, options.signal);
}

export async function getTokenWithPrice(address, networkId = 1) {
  // Shares the 30s details cache (same endpoint) - see getDetailedTokenInfo.
  return await getDetailedTokenInfo(address, networkId) || null;
}

export async function getTokenPrice(address, networkId = 1) {
  const result = await getDetailedTokenInfo(address, networkId);
  return result ? { token: result } : null;
}

// Last-seen serving tier per token+endpoint, learned for free on each /api/bars
// response (X-Spectre-Tier header). Read synchronously by the chart's
// background-prefetch orchestrator to decide whether warming other resolutions
// is zero-Codex. Keyed lowercased to match the chart-bars cache key convention.
const _barsTierCache = new Map(); // `${addr}-${netId}` -> 'geckoterminal' | 'codex' | ...
const _barsTierKey = (symbol, networkId) =>
  `${String(symbol || '').toLowerCase()}-${networkId}`;

// Cheap (non-Codex) tiers - safe to background-prefetch other resolutions.
// Codex is the ONLY metered tier; never auto-prefetch a codex/unknown/no_data token.
export const CHEAP_BARS_TIERS = new Set(['binance', 'hetzner', 'geckoterminal', 'cg-ohlc']);

/** Synchronous read of the last serving tier for a token's bars. null if unknown. */
export function getLastBarsTier(symbol, networkId = 1) {
  return _barsTierCache.get(_barsTierKey(symbol, networkId)) || null;
}

// Codex getBars silently returns truncated, recent-only data (ignoring the
// requested from/to) once the span exceeds ~4 years - verified: a 3y 1W window
// returns the full real history (back to genesis) in ~0.5s, but a 5y+ window
// returns only the last ~44 bars. The 1W scroll-back window was sized at 1400
// weeks = 26.8 YEARS (the 1400-bar target assumes that many bars exist, which no
// token has), so paging back kept refetching the same recent bars - "historical
// data never loads". Clamp every bars span to 3y; older history pages in via
// successive 3y windows. Must match the window stride in useCodexData's
// _SCROLLBACK_HOURS (1D/1W capped to 3y) so consecutive windows tile with no gap.
const MAX_BARS_RANGE_SEC = 3 * 365 * 24 * 3600; // ~3 years

// Absolute floor: no token on our bars path (Codex/DEX is 2020+, Binance majors
// ~2017) has OHLCV before 2017. The canvas chart's background buffer-extend walks
// older history in 6-window PARALLEL rounds; with 3-year 1D windows one round
// marched 2023 -> 2005, firing ~18 empty /api/bars round-trips per cold load
// (each a wasted server hit, and pre-server-floor a BILLED empty Codex query).
// Short-circuit any window that ends before this epoch: zero network, the
// buffer-extend's stop-on-empty then engages and stops the march. Jan 1 2017 UTC.
const BARS_EPOCH_SEC = 1483228800;

// Cross-module inflight dedup for /api/bars. Every chart-adjacent consumer
// (TVA datafeed, canvas useChartData, prefetchChartBars, warmTimeframes,
// VitalsBento) funnels through getBars, but each used to fire its own bare
// fetch - concurrent identical windows never collapsed (measured duplicate
// requests on token switch). Keys are BUCKET-normalized (mirrors the TVA
// datafeed's internal convention): from=0 stays 'wide', to rounds up to the
// resolution bucket, so a prefetch (to=now+60) and a chart fetch (to~now)
// land on the same key. Inflight-ONLY - results are never cached here
// (chartBarsCache + the server already cache; double-caching = staleness).
const _barsInflight = new Map();
const _BARS_RES_SEC = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, '240': 14400, '720': 43200, '1D': 86400, '1W': 604800 };

export async function getBars(symbol, resolution = '60', from, to, networkId = 1, opts = {}) {
  try {
    if (SPECTRE_API_ONLY) return { getBars: [] };

    // Whole window predates any real data -> skip the round-trip entirely.
    if (Number.isFinite(to) && to < BARS_EPOCH_SEC) return { getBars: [], tier: 'no_data' };

    // GP6 deep-link handoff (2026-08-05): index.html fires a DIRECT /api/bars
    // at HTML-parse time on #token/ deep links (alongside the snapshot, which
    // gates on details too) - adopt that promise for the FIRST matching wide
    // boot fetch instead of paying the round-trip again. Single consumption;
    // an empty/failed early fetch falls through to the normal path below.
    const _boot = typeof window !== 'undefined' ? window.__SPECTRE_BOOT : null;
    if (_boot?.bars && !_boot.bars.consumed
        && _boot.address === String(symbol).toLowerCase()
        && _boot.networkId === networkId
        && _boot.bars.resolution === resolution
        && from === 0 && opts?.codexOnly === true && !opts?.countback
        && Date.now() - _boot.bars.ts < 60_000) {
      _boot.bars.consumed = true;
      // Mirror of the snapshot adoption's cleanup: drop the boot object once
      // both members are consumed (snapshot deletion is member-wise now).
      try { if (!_boot.snapshot) delete window.__SPECTRE_BOOT; } catch { /* read-only env */ }
      try { performance.mark('spectre:boot-bars-adopted'); } catch { /* noop */ }
      const _sym = symbol;
      return _boot.bars.promise.then((r) => {
        if (r?.tier && r.tier !== 'no_data' && r.tier !== 'error') {
          _barsTierCache.set(_barsTierKey(_sym, networkId), r.tier);
        }
        if (r?.data?.bars?.length > 0) return { getBars: r.data.bars, tier: r.tier };
        // Early fetch empty or failed - re-enter for the normal network path
        // (consumed flag is already set, so no adoption loop).
        return getBars(_sym, resolution, from, to, networkId, opts);
      }).catch(() => getBars(_sym, resolution, from, to, networkId, opts));
    }

    if (Number.isFinite(from) && Number.isFinite(to) && to - from > MAX_BARS_RANGE_SEC) {
      from = to - MAX_BARS_RANGE_SEC;
    }

    const _bucket = Math.max(_BARS_RES_SEC[resolution] || 3600, 60);
    const _dedupKey = `${String(symbol).toLowerCase()}:${networkId}:${resolution}:` +
      `${from === 0 ? 'wide' : Math.floor(from / _bucket)}:${Math.ceil(to / _bucket)}:` +
      `${opts?.codexOnly === true ? 'codex' : ''}:${opts?.cgId || ''}:${opts?.countback || ''}`;
    const existing = _barsInflight.get(_dedupKey);
    if (existing) return existing;
    const _promise = _getBarsUncached(symbol, resolution, from, to, networkId, opts);
    _barsInflight.set(_dedupKey, _promise);
    _promise.finally(() => _barsInflight.delete(_dedupKey));
    return _promise;
  } catch (err) {
    return { getBars: [] };
  }
}

async function _getBarsUncached(symbol, resolution, from, to, networkId, opts = {}) {
  try {

    // Single call to /api/bars - server has Codex fast path (<1s) + onchain fallback (5-15s)
    // 12s timeout - server tries Codex (5s) then onchain fallback (5s+5s) for new tokens
    // src=codex (opts.codexOnly): the Trading Platform token-page PRICE CHART is
    // Codex-only. The shared dev Express handler + the trading prod serverless honor
    // this flag and short-circuit to the Codex tier alone (no Binance/GeckoTerminal/
    // cg-ohlc). ONLY the chart passes it; decorative sparklines stay on the cheap
    // multi-source tiers to keep metered Codex spend down. Research never sends it.
    // CoinGecko-only majors (XRP/ADA/TON/TRX/XLM/...) have no on-chain contract;
    // their `symbol` here is the lowercase CoinGecko slug (selectToken sets the
    // slug AS the token address). Route them to /api/bars?cgId= so the server
    // serves the CoinGecko-OHLC tier (works dev + prod) instead of the Codex-only
    // tier, which can't resolve a slug. Contract symbols (0x.. / base58) and bare
    // uppercase tickers are unaffected. opts.cgId lets a caller force it.
    const cgId = opts?.cgId
      || ((typeof symbol === 'string' && symbol.length < 32 && /^[a-z][a-z0-9-]+$/.test(symbol) && !symbol.startsWith('0x')) ? symbol : null);
    // src=codex forces the Codex-only tier; never combine it with a CoinGecko
    // route (cgId), or the server would short-circuit before reaching cg-ohlc.
    const srcParam = (!cgId && opts?.codexOnly === true) ? '&src=codex' : '';
    const cgParam = cgId ? `&cgId=${encodeURIComponent(cgId)}` : '';
    // Deep-history pages (chart scroll-back + the GMGN-depth background fill)
    // ask the server for a bigger Codex countback than the 500-bar default.
    // Server caps it at 1500; absent = unchanged 500 (sparklines etc).
    const cb = Number(opts?.countback);
    const cbParam = Number.isFinite(cb) && cb > 500 ? `&countback=${Math.min(1500, Math.round(cb))}` : '';
    const resp = await fetch(`/api/bars?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&resolution=${resolution}&networkId=${networkId}${srcParam}${cgParam}${cbParam}`, {
      signal: AbortSignal.timeout(12000)
    });
    if (resp.ok) {
      const tier = resp.headers.get('X-Spectre-Tier') || null;
      // Record a real-data tier (not no_data, not the transient 'error' the
      // server now emits for broken-not-empty requests) so the chart's prefetch
      // orchestrator can gate cheap-vs-codex synchronously, zero extra network.
      if (tier && tier !== 'no_data' && tier !== 'error') _barsTierCache.set(_barsTierKey(symbol, networkId), tier);
      const data = await resp.json();
      if (data.bars?.length > 0) return { getBars: data.bars, tier };
      return { getBars: [], tier };
    }
    // Surface the per-IP /api/bars rate limit (60/min) so the chart - the
    // priority consumer - can retry, while decorative sparklines just skip.
    if (resp.status === 429) return { getBars: [], rateLimited: true };
    return { getBars: [] };
  } catch (err) {
    return { getBars: [] };
  }
}

export async function getCoinGeckoBars(coinId, resolution = '60', from, to) {
  if (SPECTRE_API_ONLY) return { getBars: [] };
  try {
    const params = new URLSearchParams({ resolution });
    if (from && to) {
      params.append('from', from.toString());
      params.append('to', to.toString());
    }
    const response = await fetch(`/api/coingecko/ohlcv/${coinId}?${params.toString()}`);
    if (!response.ok) throw new Error(`CoinGecko API error: ${response.status}`);
    const data = await response.json();
    return { getBars: data?.bars || [] };
  } catch (err) {
    return { getBars: [] };
  }
}

// CoinGecko coin DETAIL for off-chain majors Codex can't serve (XRP/ADA/TON/...).
// Hits the RAW /api/coingecko/coins/{id} path on purpose: it resolves in dev (the
// /api/coingecko/* wildcard passthrough) AND in prod (cg-proxy raw passthrough).
// The normalized /api/coingecko/coin/:id route is dev-only + BTC/ETH/SOL-only, so
// it would 404 in prod - do NOT use it. Returns raw CoinGecko JSON (the caller
// normalizes) or null. 30s module cache + in-flight dedup.
const _cgDetailCache = new Map();    // cgId -> { data, ts }
const _cgDetailInflight = new Map(); // cgId -> Promise
const CG_DETAIL_TTL = 30_000;

export async function getCoinGeckoDetail(coinId, opts = {}) {
  if (SPECTRE_API_ONLY || !coinId) return null;
  const key = String(coinId).toLowerCase();
  const cached = _cgDetailCache.get(key);
  if (cached && Date.now() - cached.ts < CG_DETAIL_TTL) return cached.data;
  if (_cgDetailInflight.has(key)) return _cgDetailInflight.get(key);
  const promise = (async () => {
    try {
      const qs = 'localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false';
      const response = await fetch(`/api/coingecko/coins/${encodeURIComponent(key)}?${qs}`, {
        signal: opts.signal || AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`CoinGecko detail error: ${response.status}`);
      const data = await response.json();
      _cgDetailCache.set(key, { data, ts: Date.now() });
      return data;
    } catch (err) {
      if (err?.name !== 'AbortError') console.warn('[coingecko] detail fetch failed:', err?.message);
      return null;
    } finally {
      _cgDetailInflight.delete(key);
    }
  })();
  _cgDetailInflight.set(key, promise);
  return promise;
}

// Full CoinGecko coin payload WITH tickers - powers the major-coin bottom panel
// (Markets table + Key Stats + Performance, all from this one call). Separate
// from getCoinGeckoDetail (no tickers, ~small, used by the right-rail vitals) so
// the ~96KB tickers payload is only fetched when the Markets panel is shown.
// Same prod-safe raw /api/coingecko/coins/{id} path (dev wildcard + prod
// cg-proxy). Returns raw CoinGecko JSON or null. 60s cache + in-flight dedup.
const _cgMarketsCache = new Map();    // cgId -> { data, ts }
const _cgMarketsInflight = new Map(); // cgId -> Promise
const CG_MARKETS_TTL = 60_000;

export async function getCoinGeckoMarkets(coinId, opts = {}) {
  if (SPECTRE_API_ONLY || !coinId) return null;
  const key = String(coinId).toLowerCase();
  const cached = _cgMarketsCache.get(key);
  if (cached && Date.now() - cached.ts < CG_MARKETS_TTL) return cached.data;
  if (_cgMarketsInflight.has(key)) return _cgMarketsInflight.get(key);
  const promise = (async () => {
    try {
      const qs = 'localization=false&tickers=true&market_data=true&community_data=true&developer_data=false&sparkline=false';
      const response = await fetch(`/api/coingecko/coins/${encodeURIComponent(key)}?${qs}`, {
        signal: opts.signal || AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`CoinGecko markets error: ${response.status}`);
      const data = await response.json();
      _cgMarketsCache.set(key, { data, ts: Date.now() });
      return data;
    } catch (err) {
      if (err?.name !== 'AbortError') console.warn('[coingecko] markets fetch failed:', err?.message);
      return null;
    } finally {
      _cgMarketsInflight.delete(key);
    }
  })();
  _cgMarketsInflight.set(key, promise);
  return promise;
}

/**
 * Batch fetch token prices using Codex getTokenPrices API.
 * Accepts array of {address, networkId} objects, max 25 per call.
 * Returns array of { address, networkId, priceUsd, timestamp }.
 */
export async function getTokenPricesBatch(tokens) {
  if (SPECTRE_API_ONLY || !tokens?.length) return [];
  try {
    if (isDev) {
      // Dev: POST to Express route
      const response = await fetch(`${LOCAL_API_URL}/tokens/batch-prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokens }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Batch prices error: ${response.status}`);
      const data = await response.json();
      return data.prices || [];
    } else {
      // Prod: GET to Vercel serverless function
      const tokensJson = JSON.stringify(tokens);
      const response = await fetch(`${VERCEL_API_URL}?action=batch-prices&tokens=${encodeURIComponent(tokensJson)}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Batch prices error: ${response.status}`);
      const data = await response.json();
      return data.prices || [];
    }
  } catch (err) {
    // Non-fatal: returns [] and the next poll retries. A transient network blip
    // (TLS socket disconnect / timeout) is expected, so warn (not error) — the
    // error-beacon forwards console.error only, and a flaky-network hiccup is not
    // a real app fault worth a beacon alert.
    if (err?.name !== 'AbortError') console.warn('Batch prices failed:', err?.message || err);
    return [];
  }
}

/**
 * Advanced token screener via Codex filterTokens with multi-dimensional filters.
 * @param {Object} filters - e.g. { marketCap: { gte: 100000, lte: 5000000 }, change1h: { gte: 0.05 } }
 * @param {Object} options - { sort, sortDir, networks, limit }
 * @returns {Array} Matching tokens
 */
export async function screenTokens(filters = {}, options = {}) {
  if (SPECTRE_API_ONLY) return [];
  try {
    const params = new URLSearchParams({ action: 'screener' });
    if (Object.keys(filters).length > 0) params.set('filters', JSON.stringify(filters));
    if (options.sort) params.set('sort', options.sort);
    if (options.sortDir) params.set('sortDir', options.sortDir);
    if (options.networks) params.set('networks', options.networks.join(','));
    if (options.limit) params.set('limit', String(options.limit));

    // Both dev (Express) and prod (Vercel) use the same /api/codex?action=screener path
    const response = await fetch(`/api/codex?${params}`, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Screener error: ${response.status}`);
    const data = await response.json();
    return data.results || [];
  } catch (err) {
    console.error('Screener failed:', err);
    return [];
  }
}

/**
 * Top tokens by market cap via Codex filterTokens (replaces CoinGecko top-coins).
 * Returns array of normalized token objects.
 */
export async function fetchTopTokens(limit = 50, networkIds = null) {
  if (SPECTRE_API_ONLY) return [];
  try {
    const params = [`limit=${limit}`];
    if (networkIds) params.push(`networks=${networkIds.join(',')}`);
    const url = isDev
      ? `${LOCAL_API_URL}/codex?action=top-tokens&${params.join('&')}`
      : `${VERCEL_API_URL}?action=top-tokens&${params.join('&')}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Top tokens error: ${response.status}`);
    const data = await response.json();
    return data.tokens || [];
  } catch (err) {
    console.error('Top tokens failed:', err);
    return [];
  }
}

/**
 * Top coins by market cap via CoinGecko (kept for rich metadata: sparklines, ATH, categories).
 * For Codex-only ranking without sparklines, use fetchTopTokens.
 */
export async function fetchTopCoins(limit = 50, category = '') {
  if (SPECTRE_API_ONLY) return [];
  try {
    const catParam = category ? `&category=${encodeURIComponent(category)}` : '';
    const url = isDev
      ? `/api/coingecko/top?limit=${limit}${catParam}`
      : `/api/codex?action=top-coins&limit=${limit}${catParam}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Top coins API error: ${response.status}`);
    const data = await response.json();
    return data.tokens || [];
  } catch (err) {
    return [];
  }
}

export async function searchTokens(search, networkIds = [1, 56, 137, 42161, 8453, 4663], options = {}) {
  try {
    const isEvmAddress = search && search.startsWith('0x') && search.length === 42;
    const isSolanaAddress = search && !search.startsWith('0x') && search.length >= 32 && search.length <= 44;
    const isContractAddress = isEvmAddress || isSolanaAddress;
    const params = { q: search };
    if (!isContractAddress) params.networks = networkIds.join(',');
    // Address lookups: the chain we already believe the token is on goes first
    // on the server (one `token` query instead of a 10-network fan-out).
    else if (options.networkId) params.networkId = options.networkId;
    // Leading-edge keystroke tier: Hetzner-only on the server, never Codex.
    // The extra param also keys _dedupKey and the edge cache separately from
    // full searches. See useTokenSearch's fast/settled state machine.
    if (options.fast) params.fast = '1';
    const result = await apiRequest('search', params, options);
    return { filterTokens: { results: result?.results || [] } };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { filterTokens: { results: [] } };
  }
}

/**
 * Trending board for a set of chains.
 *
 * Returns `{ filterTokens: { results } }` on a SUCCESSFUL request - `results`
 * may legitimately be empty (a thin chain with nothing trending right now).
 * Returns `null` when the request FAILED, so callers can tell the two apart.
 *
 * That distinction matters: an honest empty board is cacheable (it stops us
 * re-paying a 1-4s upstream round-trip for chains that are reliably empty -
 * ARB/AVAX/OP/HOOD measured 0 rows for ~6.2s of combined cold work per load),
 * while a transient failure must NOT be cached as "empty" or one blip would
 * blank a live chain for the whole TTL. Before this split both paths returned
 * the same empty array and neither was ever cached.
 */
export async function getTrendingTokens(networkIds = [1, 56, 137, 42161, 8453, 4663], limit = 50, timeframe = 'volume') {
  try {
    const result = await apiRequest('trending', {
      networks: networkIds.join(','),
      limit: String(limit),
      timeframe: timeframe === 'volume' ? 'volume' : timeframe,
    });
    // `asOf` = when the board's DATA was built, not when we fetched it. The
    // response passes through a server cache, a KV cache and an edge cache, so
    // a freshness readout aged from the fetch would claim "now" over a board
    // minutes old.
    return { filterTokens: { results: result?.results || [] }, asOf: result?.asOf || null };
  } catch (err) {
    return null;
  }
}

// "Most Visited" tab - REAL token-page views on the platform, ranked by 24h
// view count and enriched fresh. Same row shape as getTrendingTokens.
export async function getMostVisited(networkIds = [], limit = 30, timeframe = '24h') {
  try {
    const result = await apiRequest('most-visited', {
      ...(networkIds && networkIds.length ? { networks: networkIds.join(',') } : {}),
      limit: String(limit),
      window: timeframe || '24h',
    });
    return { filterTokens: { results: result?.results || [] } };
  } catch (err) {
    return { filterTokens: { results: [] } };
  }
}

// A real on-chain address - EVM (0x + 40 hex) or Solana base58 (32-44). Rejects
// display-truncated ("0x9cf...dad6") and placeholder ("0xdoge...0000") addresses
// that some token sources hand us, which can't be enriched or matched.
function isPlausibleTokenAddress(a) {
  if (typeof a !== 'string' || a.includes('..')) return false;
  return /^0x[0-9a-fA-F]{40}$/.test(a) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
}

// Fire-and-forget: record a token-page view so it counts toward "Most Visited".
// sendBeacon survives the navigation that immediately follows a token click.
export function recordTokenView(token) {
  try {
    if (!token) return;
    const address = token.address || token.token?.address;
    const networkId = token.networkId ?? token.token?.networkId;
    if (!address || networkId == null) return;
    // Skip malformed/truncated/placeholder addresses - they pollute the
    // leaderboard with un-enrichable $0/"-" rows and split a token's count.
    if (!isPlausibleTokenAddress(address)) return;
    const body = JSON.stringify({
      address,
      networkId,
      symbol: token.symbol || token.token?.symbol || '',
      name: token.name || token.token?.name || '',
      logo: token.logo || token.token?.info?.imageThumbUrl || '',
      createdAt: token.createdAt || null,
    });
    const url = isDev ? `${LOCAL_API_URL}/tokens/view` : `${VERCEL_API_URL}?action=record-view`;
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch (_) { /* never break the view */ }
}

export async function getTokenPairs(tokenAddress, networkId = 1) {
  return { listPairsForToken: [] };
}

export async function getLatestTrades(tokenAddress, networkId = 1, limit = 50) {
  try {
    const result = await apiRequest('trades', {
      address: tokenAddress, networkId: networkId.toString(), limit: limit.toString()
    });
    return result;
  } catch (err) {
    return { trades: [], pairs: [] };
  }
}

/**
 * Top holders for a token, from Codex. Returns `{ count, top10Pct, items }`
 * where each item is `{ rank, address, balance (raw), shiftedBalance,
 * balanceUsd, priceUsd }`.
 *
 * This is the PRIMARY holder source. The onchain.spectreai.io bridge is a
 * fallback: measured 2026-08-17, its whole SPECTRE snapshot was stamped
 * 2026-06-12 (66 days stale) and disagreed with GMGN by up to 83% on value,
 * while Codex matched GMGN to ~0.5%.
 */
export async function getCodexHolders(tokenAddress, networkId = 1) {
  if (!tokenAddress) return { count: 0, top10Pct: 0, items: [] };
  try {
    const result = await apiRequest('holders', {
      address: tokenAddress,
      networkId: networkId.toString(),
    });
    return {
      count: Number(result?.count) || 0,
      top10Pct: Number(result?.top10Pct) || 0,
      items: Array.isArray(result?.items) ? result.items : [],
    };
  } catch {
    return { count: 0, top10Pct: 0, items: [] };
  }
}

/**
 * Per-wallet trading stats for ONE token, from Codex's own wallet index
 * (filterTokenWallets). Powers the Holders tab's PnL + Remaining columns.
 *
 * Why not derive this from the transactions tape: the tape is a 50-row window,
 * so it only ever knows about wallets that traded inside it. Measured
 * 2026-08-17 on SPECTRE, exactly 1 of the top 50 holders appeared there.
 *
 * Returns a Map keyed the same way the server keys it - EVM lowercased, Solana
 * base58 left alone (it is case-SENSITIVE). Wallets Codex has never seen trade
 * the token are simply absent from the Map; the caller must render "-" for
 * those rather than assume a zero cost basis.
 */
export async function getWalletStats(tokenAddress, networkId = 1, wallets = []) {
  const list = (Array.isArray(wallets) ? wallets : []).filter(Boolean).slice(0, 50);
  if (!tokenAddress || !list.length) return new Map();
  try {
    const result = await apiRequest('wallet-stats', {
      address: tokenAddress,
      networkId: networkId.toString(),
      wallets: list.join(','),
    });
    const rows = Array.isArray(result?.wallets) ? result.wallets : [];
    return new Map(rows.map((r) => [r.key, r]));
  } catch {
    return new Map();
  }
}

/**
 * Ranked traders for ONE token from Codex's wallet index (tokenTopTraders).
 * `rank`: 'best' (realized PnL desc - Codex returns only green wallets),
 * 'worst' (realized PnL asc - only red wallets), or 'volume' (traded USD).
 * `period`: DAY | WEEK | MONTH | YEAR. Rows: { rank, address, key, bought,
 * sold, boughtUsd, soldUsd, volumeUsd, realizedUsd, realizedPct, buys, sells,
 * balance, firstAt, lastAt, labels, isBot, isFlagged, isSmart, category }.
 *
 * Replaces the tape-derived ranking as the primary source: that only ever saw
 * the loaded 50-row window, this covers the whole period. 60s module cache +
 * inflight dedup per (token, period, rank).
 *
 * Returns { items, error }. An honest empty list (Codex says nobody traded /
 * nobody closed green) is `{ items: [], error: null }`; a failure to ask is
 * `{ items: [], error: '...' }` - the panel falls back to the tape only for
 * the latter, never for the former.
 */
const _topTradersCache = new Map();
const TOP_TRADERS_CLIENT_TTL = 60_000;

export async function getTokenTopTraders(tokenAddress, networkId = 1, { period = 'DAY', rank = 'best', limit = 25 } = {}) {
  if (!tokenAddress) return { items: [], error: null };
  const key = `${tokenAddress.toLowerCase()}:${networkId}:${period}:${rank}:${limit}`;
  const cached = _topTradersCache.get(key);
  if (cached && Date.now() - cached.ts < TOP_TRADERS_CLIENT_TTL) return cached.data;
  try {
    const result = await apiRequest('top-traders', {
      address: tokenAddress,
      networkId: networkId.toString(),
      period,
      rank,
      limit: String(limit),
    });
    const data = {
      items: Array.isArray(result?.items) ? result.items : [],
      error: result?.error || null,
    };
    // Do not cache an error shape - a transient failure would pin an empty
    // tab for a minute. An honest empty list is cached like any other answer.
    if (!data.error) _topTradersCache.set(key, { data, ts: Date.now() });
    return data;
  } catch (err) {
    return { items: [], error: err?.message || 'failed' };
  }
}

/**
 * Locked-liquidity state for every pool of ONE token (Codex liquidityLocksV2,
 * read from current on-chain state). Returns { pools, error } where each pool
 * is { pairAddress, protocol, lockedPct, permanentPct, vestedPct, unlockedPct,
 * nextReleaseAt, updatedAt, current, hasLiquidity, holders[{ entityId, name,
 * protocol, sharePct, permanent, unlockAt }] }. Shares are % of the pool's LP
 * supply - LP units differ per pool, so never add them across pools.
 * `error` is 'plan_gated' when Codex refuses the query on our plan. 5min
 * module cache + inflight dedup.
 *
 * `pair` (optional) = the primary pool's address. Codex pages the token-level
 * list at 25 pools, so on a token with many pools the main one can fall off
 * page 1; the server then asks for that pool by address in a second query.
 */
const _liqLocksCache = new Map();
const LIQ_LOCKS_CLIENT_TTL = 5 * 60_000;

export async function getLiquidityLocks(tokenAddress, networkId = 1, pair = '') {
  if (!tokenAddress) return { pools: [], error: null };
  const pairKey = pair ? (String(pair).startsWith('0x') ? String(pair).toLowerCase() : String(pair)) : '';
  const key = `${tokenAddress.toLowerCase()}:${networkId}:${pairKey}`;
  const cached = _liqLocksCache.get(key);
  if (cached && Date.now() - cached.ts < LIQ_LOCKS_CLIENT_TTL) return cached.data;
  try {
    const result = await apiRequest('liquidity-locks', {
      address: tokenAddress,
      networkId: networkId.toString(),
      ...(pairKey ? { pair: pairKey } : {}),
    });
    const data = {
      pools: Array.isArray(result?.pools) ? result.pools : [],
      error: result?.error || null,
    };
    if (!data.error) _liqLocksCache.set(key, { data, ts: Date.now() });
    return data;
  } catch (err) {
    return { pools: [], error: err?.message || 'failed' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Network helpers
// ═══════════════════════════════════════════════════════════════════════════════

export function getNetworkName(networkId) {
  const networks = {
    1: 'Ethereum',
    56: 'BNB Chain',
    137: 'Polygon',
    42161: 'Arbitrum',
    8453: 'Base',
    43114: 'Avalanche',
    10: 'Optimism',
    250: 'Fantom',
    1399811149: 'Solana',
    4663: 'Robinhood',
  };
  return networks[networkId] || 'Unknown';
}

// Short uppercase chain code — used in narrow row cells where the full
// network name doesn't fit (e.g. left-panel TokenScreener rows, where
// the token block is constrained to ~100px).
export function getNetworkShort(networkId) {
  const codes = {
    1: 'ETH',
    56: 'BSC',
    137: 'POLY',
    42161: 'ARB',
    8453: 'BASE',
    43114: 'AVAX',
    10: 'OP',
    250: 'FTM',
    1399811149: 'SOL',
    4663: 'HOOD',
  };
  return codes[networkId] || '';
}

export function getNetworkId(networkName) {
  const networks = {
    'ETH': 1, 'ETHEREUM': 1,
    'BSC': 56, 'BNB CHAIN': 56, 'BINANCE': 56,
    'MATIC': 137, 'POLYGON': 137,
    'ARB': 42161, 'ARBITRUM': 42161,
    'BASE': 8453,
    'AVAX': 43114, 'AVALANCHE': 43114,
    'OP': 10, 'OPTIMISM': 10,
    'FTM': 250, 'FANTOM': 250,
    'HOOD': 4663, 'ROBINHOOD': 4663,
    'SOL': 1399811149, 'SOLANA': 1399811149,
  };
  return networks[networkName.toUpperCase()] || 1;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Formatting helpers
// ═══════════════════════════════════════════════════════════════════════════════

export function formatLargeNumber(num) {
  const n = typeof num === 'number' ? num : parseFloat(num);
  if (!n || isNaN(n) || !isFinite(n)) return '$0';
  const absNum = Math.abs(n);
  if (absNum >= 1e12) return `$${(n / 1e12).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}T`;
  if (absNum >= 1e9) return `$${(n / 1e9).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}B`;
  if (absNum >= 1e6) return `$${(n / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`;
  if (absNum >= 1000) return `$${Math.round(n).toLocaleString('en-US')}`;
  if (absNum >= 100) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPrice(price) {
  const p = typeof price === 'number' ? price : parseFloat(price);
  if (!p || isNaN(p) || !isFinite(p)) return '$0.00';
  const absP = Math.abs(p);
  if (absP >= 1e12) return `$${(p / 1e12).toFixed(2)}T`;
  if (absP >= 1e9) return `$${(p / 1e9).toFixed(2)}B`;
  if (absP >= 1e6) return `$${(p / 1e6).toFixed(2)}M`;
  if (absP >= 1000) return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (absP >= 1) return `$${p.toFixed(2)}`;
  if (absP >= 0.01) return `$${p.toFixed(4)}`;
  if (absP >= 0.0001) return `$${p.toFixed(6)}`;
  return `$${p.toFixed(8)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Well-known tokens
// ═══════════════════════════════════════════════════════════════════════════════

export const KNOWN_TOKENS = {
  ETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', networkId: 1 },
  USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', networkId: 1 },
  USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', networkId: 1 },
  LINK: { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', networkId: 1 },
  UNI: { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', networkId: 1 },
  AAVE: { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', networkId: 1 },
  PEPE: { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', networkId: 1 },
  SHIB: { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', networkId: 1 },
  ARB: { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', networkId: 42161 },
  BASE_ETH: { address: '0x4200000000000000000000000000000000000006', networkId: 8453 },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Team Management API
// ═══════════════════════════════════════════════════════════════════════════════

export async function getAgentsStatus() {
  try {
    const url = isDev
      ? `${LOCAL_API_URL}/agents/status`
      : '/api/agents/status';
    const response = await fetch(url);
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return await response.json();
  } catch (error) {
    return { teams: [], tasks: [], hasActiveTeam: false, error: error.message };
  }
}

const AGENTS_API_URL = isDev ? LOCAL_API_URL : '/api';

async function agentApiPost(endpoint, body) {
  const url = `${AGENTS_API_URL}${endpoint}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `API error: ${response.status}`);
  }
  return response.json();
}

export async function createTeam(teamName, description) {
  return agentApiPost('/agents/team/create', { teamName, description });
}

export async function deleteTeam(teamName) {
  const url = `${AGENTS_API_URL}/agents/team/${encodeURIComponent(teamName)}`;
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `API error: ${response.status}`);
  }
  return response.json();
}

export async function createTask(teamName, task) {
  return agentApiPost('/agents/tasks/create', { teamName, ...task });
}

export async function updateTask(teamName, taskId, updates) {
  const url = `${AGENTS_API_URL}/agents/tasks/${encodeURIComponent(taskId)}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamName, ...updates }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `API error: ${response.status}`);
  }
  return response.json();
}

export async function spawnAgent(teamName, agentName, prompt, permissionMode) {
  return agentApiPost('/agents/spawn', { teamName, agentName, prompt, permissionMode });
}

export async function killAgent(teamName, agentName) {
  return agentApiPost(`/agents/kill/${encodeURIComponent(teamName)}/${encodeURIComponent(agentName)}`, {});
}

export async function sendAgentMessage(teamName, sender, recipient, type, content) {
  return agentApiPost('/agents/message', { teamName, sender, recipient, type, content });
}

export function connectTeamStream(teamName, onEvent) {
  const url = isDev
    ? `${LOCAL_API_URL}/agents/stream/${encodeURIComponent(teamName)}`
    : `/api/agents/stream/${encodeURIComponent(teamName)}`;
  const eventSource = new EventSource(url);
  eventSource.onmessage = (e) => {
    try { onEvent(JSON.parse(e.data)); } catch {}
  };
  eventSource.onerror = () => { /* reconnects automatically */ };
  return eventSource;
}

export default {
  getTokenInfo,
  getTokenPrice,
  getDetailedTokenStats,
  getDetailedTokenInfo,
  getTokenWithPrice,
  getTokenPriceBySymbol,
  getTokenPricesBatch,
  fetchTopTokens,
  screenTokens,
  getBars,
  getCoinGeckoBars,
  fetchTopCoins,
  searchTokens,
  getTrendingTokens,
  getTokenPairs,
  getLatestTrades,
  getCodexHolders,
  getWalletStats,
  getNetworkName,
  getNetworkShort,
  getNetworkId,
  formatLargeNumber,
  formatPrice,
  getAgentsStatus,
  createTeam,
  deleteTeam,
  createTask,
  updateTask,
  spawnAgent,
  killAgent,
  sendAgentMessage,
  connectTeamStream,
  KNOWN_TOKENS,
};
