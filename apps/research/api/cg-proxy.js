/**
 * Vercel Serverless – CoinGecko API proxy
 * Receives requests rewritten from /api/coingecko/* via vercel.json
 * The original sub-path is passed as ?cgpath= query parameter
 */

import { createHash } from 'node:crypto';
import { rateLimit } from './_lib/ratelimit.js';
import { isAuthGateValid } from './auth-gate.js';

// `waitUntil` keeps background work alive after the response is sent.
// Without it, Vercel can freeze the function before our Redis write or
// background refresh completes, which would silently undermine the SWR
// cache. Imported defensively so the proxy still works if the package
// isn't available (e.g. local Express dev path).
let waitUntilFn = null;
try {
  const mod = await import('@vercel/functions');
  if (typeof mod.waitUntil === 'function') waitUntilFn = mod.waitUntil;
} catch {
  waitUntilFn = null;
}

function scheduleBackground(promise) {
  const silenced = Promise.resolve(promise).catch(err => {
    console.warn('[cg-proxy] background task failed:', err?.message || err);
  });
  if (waitUntilFn) waitUntilFn(silenced);
}

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
const COINGECKO_BASE_URL = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';

const DEFAULT_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=60';
const CG_CACHE_PREFIX = 'cg-proxy:v1';
const MAX_MEMORY_ENTRIES = 600;

const memoryCache = new Map();
const inflight = new Map();
const metricsByRoute = new Map();

let redisClientPromise = null;
let redisDisabled = false;

const RESERVED_COINS_ENDPOINTS = new Set([
  'categories',
  'list',
  'markets',
  'top_gainers_losers',
]);

const CACHE_POLICIES = [
  {
    route: 'coins.markets',
    matches: subPath => subPath === 'coins/markets',
    // 2026-05-15 cost defense: bumped TTL 45s → 120s. Top-coin mcap/price
    // doesn't move enough inside 2min to matter for the consumers (welcome,
    // heatmaps, bubbles, discover). Binance overlay on welcome handles
    // realtime; this just feeds slow fields (mcap, sparkline, change%).
    // stale-while-revalidate stays generous (4min) so edge serves stale
    // during refetch. Halves the cache-miss → upstream CG hit ratio.
    ttlMs: 120_000,
    staleMs: 4 * 60_000,
  },
  {
    route: 'simple.price',
    matches: subPath => subPath === 'simple/price',
    ttlMs: 30_000, // was 20s — still well inside one Binance tick interval
    staleMs: 2 * 60_000,
  },
  {
    route: 'coins.categories',
    matches: subPath => subPath === 'coins/categories',
    ttlMs: 10 * 60_000,
    staleMs: 50 * 60_000,
  },
  {
    route: 'search',
    matches: subPath => subPath === 'search',
    // Bumped 60s → 120s — search results don't change between minutes and
    // the upstream is the slowest CG endpoint (1.7s P50 observed). Edge
    // serving a 60-120s stale result is free, the alternative is paying
    // 1.7s + a CG credit per unique query.
    ttlMs: 120_000,
    staleMs: 9 * 60_000,
  },
  {
    route: 'coins.detail',
    matches: subPath => {
      const match = /^coins\/([^/]+)$/.exec(subPath);
      return !!match && !RESERVED_COINS_ENDPOINTS.has(match[1]);
    },
    ttlMs: 45 * 60_000,
    staleMs: 4 * 60 * 60_000,
  },
  {
    route: 'coins.tickers',
    matches: subPath => /^coins\/[^/]+\/tickers$/.test(subPath),
    ttlMs: 15 * 60_000,
    staleMs: 45 * 60_000,
  },
  {
    route: 'exchanges.list',
    // Exchange directory (name + logo) behind the Lite "where to buy" rows.
    // Logos never change, so one upstream hit a day is plenty.
    matches: subPath => subPath === 'exchanges',
    ttlMs: 6 * 60 * 60_000,
    staleMs: 24 * 60 * 60_000,
  },
];

function normalizeSubPath(raw) {
  const value = Array.isArray(raw) ? raw.join('/') : String(raw || '');
  return value.replace(/^\/+/, '').replace(/\/+$/, '');
}

function buildSortedQuery(query) {
  const pairs = [];
  for (const [key, rawValue] of Object.entries(query || {})) {
    if (key === 'cgpath' || rawValue == null) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value == null) continue;
      pairs.push([key, String(value)]);
    }
  }

  pairs.sort(([aKey, aValue], [bKey, bValue]) => {
    if (aKey !== bKey) return aKey.localeCompare(bKey);
    return aValue.localeCompare(bValue);
  });

  const params = new URLSearchParams();
  for (const [key, value] of pairs) params.append(key, value);
  return params.toString();
}

function policyFor(subPath) {
  return CACHE_POLICIES.find(policy => policy.matches(subPath)) || null;
}

function cacheControlFor(policy) {
  const sMaxAge = Math.max(1, Math.floor(policy.ttlMs / 1000));
  const stale = Math.max(1, Math.floor(policy.staleMs / 1000));
  return `public, s-maxage=${sMaxAge}, stale-while-revalidate=${stale}`;
}

function cacheKeyFor(policy, subPath, queryString) {
  const normalized = `${subPath}${queryString ? `?${queryString}` : ''}`;
  const digest = createHash('sha256').update(normalized).digest('hex');
  return `${CG_CACHE_PREFIX}:${policy.route}:${digest}`;
}

function metric(route) {
  if (!metricsByRoute.has(route)) {
    metricsByRoute.set(route, {
      cacheHit: 0,
      staleHit: 0,
      miss: 0,
      coalesced: 0,
      upstream: 0,
    });
  }
  return metricsByRoute.get(route);
}

function bumpMetric(route, field) {
  const entry = metric(route);
  entry[field] = (entry[field] || 0) + 1;
}

function formatMetrics(route) {
  const entry = metric(route);
  return `hit=${entry.cacheHit}; stale=${entry.staleHit}; miss=${entry.miss}; joined=${entry.coalesced}; upstream=${entry.upstream}`;
}

function setProxyHeaders(res, { policy = null, cacheStatus = 'live', layer = '', route = policy?.route || 'live' } = {}) {
  let cacheControl;
  let cdnSMaxAge;
  if (!policy) {
    cacheControl = DEFAULT_CACHE_CONTROL;
    cdnSMaxAge = 30;
  } else if (cacheStatus === 'stale') {
    // Stale payload is already older than the fresh TTL. Tell the edge to
    // revalidate immediately (s-maxage=0) but keep stale-while-revalidate so
    // it can still serve from cache while the background refresh runs.
    // Without this, the edge would store stale data as if it were fresh and
    // multiply user-visible staleness on top of our internal stale window.
    const stale = Math.max(1, Math.floor(policy.staleMs / 1000));
    cacheControl = `public, s-maxage=0, stale-while-revalidate=${stale}`;
    cdnSMaxAge = 0;
  } else {
    cacheControl = cacheControlFor(policy);
    cdnSMaxAge = Math.max(1, Math.floor(policy.ttlMs / 1000));
  }
  res.setHeader('Cache-Control', cacheControl);
  // L4-PR7: CDN-Cache-Control is honored by Vercel's edge regardless of
  // cookies, so the auth-gate / Privy session cookie no longer downgrades
  // public CoinGecko responses to per-user lambda hits at the edge tier.
  res.setHeader('CDN-Cache-Control', `public, s-maxage=${cdnSMaxAge}`);
  res.setHeader('X-Spectre-CG-Route', route);
  res.setHeader('X-Spectre-CG-Cache', cacheStatus);
  if (layer) res.setHeader('X-Spectre-CG-Cache-Layer', layer);
  if (route !== 'live') res.setHeader('X-Spectre-CG-Metrics', formatMetrics(route));
}

function cacheState(entry, policy) {
  if (!entry || !entry.cachedAt) return 'expired';
  const ageMs = Date.now() - Number(entry.cachedAt);
  const ttlMs = Number(entry.ttlMs || policy.ttlMs);
  const staleMs = Number(entry.staleMs || policy.staleMs);
  if (ageMs <= ttlMs) return 'fresh';
  if (ageMs <= ttlMs + staleMs) return 'stale';
  return 'expired';
}

function rememberMemory(cacheKey, entry) {
  memoryCache.set(cacheKey, entry);

  if (memoryCache.size <= MAX_MEMORY_ENTRIES) return;

  const now = Date.now();
  for (const [key, value] of memoryCache) {
    const ttlMs = Number(value?.ttlMs || 0);
    const staleMs = Number(value?.staleMs || 0);
    if (!value?.cachedAt || now - Number(value.cachedAt) > ttlMs + staleMs) {
      memoryCache.delete(key);
    }
  }

  while (memoryCache.size > MAX_MEMORY_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (!oldestKey) break;
    memoryCache.delete(oldestKey);
  }
}

async function getRedisClient() {
  if (redisDisabled) return null;
  if (redisClientPromise) return redisClientPromise;

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    redisDisabled = true;
    return null;
  }

  redisClientPromise = import('@upstash/redis')
    .then(({ Redis }) => new Redis({ url, token }))
    .catch(err => {
      redisDisabled = true;
      console.warn('[cg-proxy] Upstash Redis unavailable; using instance memory only:', err.message);
      return null;
    });

  return redisClientPromise;
}

function parseCacheEntry(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

async function readSharedCache(cacheKey) {
  const redis = await getRedisClient();
  if (!redis) return null;
  try {
    return parseCacheEntry(await redis.get(cacheKey));
  } catch (err) {
    console.warn('[cg-proxy] Redis read failed:', err.message);
    return null;
  }
}

async function writeSharedCache(cacheKey, entry, policy) {
  const redis = await getRedisClient();
  if (!redis) return;
  try {
    const ttlSeconds = Math.max(1, Math.ceil((policy.ttlMs + policy.staleMs) / 1000));
    await redis.set(cacheKey, entry, { ex: ttlSeconds });
  } catch (err) {
    console.warn('[cg-proxy] Redis write failed:', err.message);
  }
}

async function readCache(cacheKey, policy) {
  const memoryEntry = memoryCache.get(cacheKey);
  const memoryState = cacheState(memoryEntry, policy);
  if (memoryState === 'fresh' || memoryState === 'stale') {
    return { entry: memoryEntry, state: memoryState, layer: 'memory' };
  }
  if (memoryEntry) memoryCache.delete(cacheKey);

  const sharedEntry = await readSharedCache(cacheKey);
  const sharedState = cacheState(sharedEntry, policy);
  if (sharedState === 'fresh' || sharedState === 'stale') {
    rememberMemory(cacheKey, sharedEntry);
    return { entry: sharedEntry, state: sharedState, layer: 'redis' };
  }

  return null;
}

async function fetchCoinGeckoJson(targetUrl, headers, route) {
  bumpMetric(route, 'upstream');
  const response = await fetch(targetUrl, { headers });

  if (!response.ok) {
    const err = new Error(`CoinGecko API error: ${response.status}`);
    err.status = response.status;
    err.targetUrl = targetUrl;
    throw err;
  }

  return response.json();
}

async function fetchAndCache({ cacheKey, policy, targetUrl, headers }) {
  const data = await fetchCoinGeckoJson(targetUrl, headers, policy.route);
  const entry = {
    version: 1,
    route: policy.route,
    cachedAt: Date.now(),
    ttlMs: policy.ttlMs,
    staleMs: policy.staleMs,
    data,
  };

  rememberMemory(cacheKey, entry);
  // Redis write is fire-and-forget via waitUntil so the user-facing response
  // returns as soon as the upstream fetch resolves. The shared cache will be
  // populated for the next request without paying the round-trip latency
  // here.
  scheduleBackground(writeSharedCache(cacheKey, entry, policy));
  return entry;
}

function singleFlight(cacheKey, task) {
  const existing = inflight.get(cacheKey);
  if (existing) return { promise: existing, joined: true };

  const promise = task().finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, promise);
  return { promise, joined: false };
}

function refreshInBackground({ cacheKey, policy, targetUrl, headers }) {
  const { promise, joined } = singleFlight(cacheKey, () => fetchAndCache({ cacheKey, policy, targetUrl, headers }));
  if (!joined) {
    // Hand the promise to `waitUntil` so Vercel keeps the function alive
    // until the refresh completes. Otherwise the runtime can suspend right
    // after we return the stale response and the refresh never lands in
    // Redis, leaving the next request to repeat the same stale-serve cycle.
    scheduleBackground(promise);
  }
}

function handleProxyError(err, res) {
  if (err?.status) {
    console.error(`CoinGecko proxy error: ${err.status} for ${err.targetUrl || 'unknown target'}`);
    return res.status(err.status).json({
      error: `CoinGecko API error: ${err.status}`,
    });
  }
  console.error('CoinGecko proxy error:', err.message);
  return res.status(502).json({ error: 'CoinGecko API unavailable' });
}

/**
 * Fetch CoinGecko /derivatives, filter by coin symbol, return structured markets.
 * Handles perpetual + futures data that /coins/{id}/tickers doesn't include.
 */
// Warm-instance cache for the raw 2-page /derivatives blob. The blob is
// symbol-independent, so every symbol's request within the TTL shares ONE
// upstream fetch instead of re-pulling ~200 rows per token view. (The CDN
// s-maxage below caches the per-symbol RESPONSE; this caches the upstream.)
let _derivBlobCache = { ts: 0, data: null };
const DERIV_BLOB_TTL = 3 * 60 * 1000;

async function fetchDerivativesBlob(headers) {
  if (_derivBlobCache.data && Date.now() - _derivBlobCache.ts < DERIV_BLOB_TTL) {
    return _derivBlobCache.data;
  }
  const pageUrl = (page) => `${COINGECKO_BASE_URL}/derivatives?per_page=100&page=${page}`;
  let allDerivatives;
  if (COINGECKO_API_KEY) {
    // Pro key: both pages in parallel — the old serial loop (+300ms sleep)
    // roughly doubled the cold latency of the Markets tab's slowest call.
    const results = await Promise.all([1, 2].map(async (page) => {
      const cgRes = await fetch(pageUrl(page), { headers });
      if (!cgRes.ok) {
        if (page === 1) throw new Error(`CoinGecko derivatives: ${cgRes.status}`);
        return [];
      }
      const data = await cgRes.json();
      return Array.isArray(data) ? data : [];
    }));
    allDerivatives = results.flat();
  } else {
    // Free tier: keep the serial + long-sleep shape (rate limits).
    allDerivatives = [];
    for (let page = 1; page <= 2; page++) {
      if (page > 1) await new Promise(r => setTimeout(r, 7000));
      const cgRes = await fetch(pageUrl(page), { headers });
      if (!cgRes.ok) {
        if (page === 1) throw new Error(`CoinGecko derivatives: ${cgRes.status}`);
        break;
      }
      const data = await cgRes.json();
      if (!Array.isArray(data) || data.length === 0) break;
      allDerivatives.push(...data);
    }
  }
  if (allDerivatives.length > 0) {
    _derivBlobCache = { ts: Date.now(), data: allDerivatives };
  }
  return allDerivatives;
}

async function handleDerivativesMarkets(req, res) {
  const symbol = (req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'Missing symbol param' });

  try {
    const headers = { Accept: 'application/json' };
    if (COINGECKO_API_KEY) headers['x-cg-pro-api-key'] = COINGECKO_API_KEY;

    const allDerivatives = await fetchDerivativesBlob(headers);

    // Filter by index_id matching requested symbol, deduplicate by market+symbol
    const seenKeys = new Set();
    const filtered = [];
    for (const d of allDerivatives) {
      if ((d.index_id || '').toUpperCase() !== symbol) continue;
      const key = `${d.market}::${d.symbol}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      filtered.push(d);
    }

    // Transform into market format
    const markets = filtered.map(d => {
      const rawName = d.market || 'Unknown';
      const shortName = rawName
        .replace(' Exchange', '')
        .replace(/ \(Futures\)/, '').replace(/ \(Perpetual\)/, '')
        .replace(/ \(Derivatives?\)/, '');
      const contractType = (d.contract_type || '').toLowerCase();
      const isPerp = contractType === 'perpetual';

      return {
        exchange: shortName,
        pair: d.symbol || `${symbol}/USD`,
        price: parseFloat(d.price) || 0,
        depthPlus2: 0,
        depthMinus2: 0,
        volume24h: d.volume_24h || 0,
        volumePct: 0,
        liquidity: 0,
        type: 'cex',
        trustScore: null,
        isDerivative: true,
        derivativeType: isPerp ? 'perpetual' : 'futures',
        spread: d.spread != null ? parseFloat(d.spread) : null,
        fundingRate: d.funding_rate != null ? parseFloat(d.funding_rate) : null,
        openInterest: d.open_interest_usd || 0,
        indexPrice: d.index != null ? parseFloat(d.index) : null,
        basis: d.basis != null ? parseFloat(d.basis) : null,
        expiredAt: d.expired_at || null,
      };
    });

    // Compute volume percentages
    const totalVol = markets.reduce((sum, m) => sum + (m.volume24h || 0), 0);
    for (const m of markets) {
      m.volumePct = totalVol > 0 ? Math.round(((m.volume24h || 0) / totalVol) * 1000) / 10 : 0;
    }
    markets.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    // L4-PR7: CDN-Cache-Control bypasses Vercel's cookie-disables-edge behavior.
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=300');
    return res.status(200).json({ markets });
  } catch (err) {
    console.error('Derivatives markets error:', err.message);
    return res.status(502).json({ error: err.message, markets: [] });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'X-Spectre-CG-Route, X-Spectre-CG-Cache, X-Spectre-CG-Cache-Layer, X-Spectre-CG-Metrics');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2026-05-12 post-lockdown amendment: CoinGecko data is public on
  // coingecko.com — gating /api/cg-proxy with hard 401 was protecting
  // nothing proprietary, just our CG Pro quota at the cost of breaking
  // the spectreai.io showcase iframe (which renders the demo Welcome
  // dashboard via cross-origin fetches to this proxy and can't carry
  // the spectre-gate cookie). Two-tier rate limit instead:
  //   - authed (team cookie present): 60/min — same headroom as before
  //   - anonymous: 30/min — enough for the demo dashboard to render
  //     real BTC/ETH/SOL/etc. data + sparklines without abuse
  // Anonymous abuse is bounded by the per-IP rate limit; the worst case
  // is someone burns ~43k CG calls/day from one IP, well inside our CG
  // Pro plan. If a real abuse pattern emerges, raise the bar with
  // Cloudflare in front or tighten the anonymous limit further.
  const authed = isAuthGateValid(req);
  const limit = authed
    ? { bucket: 'cg-proxy-authed', max: 60, windowMs: 60_000 }
    : { bucket: 'cg-proxy-anon',   max: 30, windowMs: 60_000 };
  if (await rateLimit(req, res, limit)) return;

  try {
    // The sub-path comes from vercel.json rewrite: /api/coingecko/:cgpath* -> /api/cg-proxy?cgpath=:cgpath*
    const subPath = normalizeSubPath(req.query.cgpath);
    if (!subPath) {
      return res.status(400).json({ error: 'Missing path parameter' });
    }

    // ── Special handler: derivatives-markets (server-side filtering) ──
    if (subPath === 'derivatives-markets') {
      return handleDerivativesMarkets(req, res);
    }

    const queryString = buildSortedQuery(req.query);
    const targetUrl = `${COINGECKO_BASE_URL}/${subPath}${queryString ? `?${queryString}` : ''}`;

    const headers = { Accept: 'application/json' };
    if (COINGECKO_API_KEY) {
      headers['x-cg-pro-api-key'] = COINGECKO_API_KEY;
    }

    const policy = policyFor(subPath);
    if (!policy) {
      const data = await fetchCoinGeckoJson(targetUrl, headers, 'live');
      setProxyHeaders(res, { cacheStatus: 'live', route: 'live' });
      return res.status(200).json(data);
    }

    const cacheKey = cacheKeyFor(policy, subPath, queryString);
    const cached = await readCache(cacheKey, policy);
    if (cached?.state === 'fresh') {
      bumpMetric(policy.route, 'cacheHit');
      setProxyHeaders(res, { policy, cacheStatus: 'hit', layer: cached.layer });
      return res.status(200).json(cached.entry.data);
    }

    if (cached?.state === 'stale') {
      bumpMetric(policy.route, 'staleHit');
      refreshInBackground({ cacheKey, policy, targetUrl, headers });
      setProxyHeaders(res, { policy, cacheStatus: 'stale', layer: cached.layer });
      return res.status(200).json(cached.entry.data);
    }

    const { promise, joined } = singleFlight(cacheKey, () => fetchAndCache({ cacheKey, policy, targetUrl, headers }));
    if (joined) {
      bumpMetric(policy.route, 'coalesced');
    } else {
      bumpMetric(policy.route, 'miss');
    }

    const entry = await promise;
    setProxyHeaders(res, {
      policy,
      cacheStatus: joined ? 'coalesced' : 'miss',
      layer: joined ? 'inflight' : 'upstream',
    });
    return res.status(200).json(entry.data);
  } catch (err) {
    return handleProxyError(err, res);
  }
}
