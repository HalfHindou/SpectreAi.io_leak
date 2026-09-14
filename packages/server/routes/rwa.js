/**
 * Spectre Intelligence Hub — RWA (Real World Assets) Routes
 * Serves tokenized real-world asset data from DeFiLlama's free public API.
 *
 * GET  /api/rwa/overview            — RWA sector overview (TVL, top protocols, chain breakdown)
 * GET  /api/rwa/protocols           — All RWA protocols sorted by TVL
 * GET  /api/rwa/protocol/:slug      — Single protocol detail with TVL history
 * GET  /api/rwa/stablecoins         — All stablecoins with circulating supply data
 * GET  /api/rwa/stablecoin-charts/:id — Historical market cap for a single stablecoin
 * GET  /api/rwa/chains              — RWA TVL aggregated per chain
 * GET  /api/rwa/analysis/:topic     — AI analysis for a subpage topic
 * GET  /api/rwa/analysis/protocol/:slug — AI analysis for a single protocol
 */
const express = require('express');
const router = express.Router();

// ── In-memory caches ─────────────────────────────────────────────────────────

// Shared protocols cache (used by /overview, /protocols, /chains)
const protocolsCache = { data: null, timestamp: 0 };
const PROTOCOLS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Stablecoins cache
const stablecoinsCache = { data: null, timestamp: 0 };
const STABLECOINS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Per-key caches
const protocolDetailCache = new Map(); // slug -> { data, timestamp }
const PROTOCOL_DETAIL_TTL = 10 * 60 * 1000; // 10 minutes

const stablecoinChartsCache = new Map(); // id -> { data, timestamp }
const STABLECOIN_CHARTS_TTL = 30 * 60 * 1000; // 30 minutes

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': 'Spectre-AI/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

/**
 * Map a DeFiLlama protocol's tags + category to our asset_class taxonomy.
 * Returns one of: treasuries, credit, commodities, stocks, equity, other.
 */
function deriveAssetClass(p) {
  const tags = Array.isArray(p.tags) ? p.tags.map((t) => String(t).toLowerCase()) : [];
  const cat = String(p.category || '').toLowerCase();
  if (cat === 'rwa lending') return 'credit';
  if (tags.some((t) => t.includes('treasury') || t.includes('money market'))) return 'treasuries';
  if (tags.some((t) => t.includes('credit') || t.includes('fixed income'))) return 'credit';
  if (tags.some((t) => t.includes('commodit'))) return 'commodities';
  if (tags.some((t) => t.includes('stock') || t.includes('etf'))) return 'stocks';
  if (tags.some((t) => t.includes('equity'))) return 'equity';
  return 'other';
}

/**
 * Fetch all protocols and filter to RWA category.
 * Returns cached result if still fresh.
 */
// The DeFiLlama /protocols payload is ~8MB and is the single heaviest upstream
// in this file. overview + protocols + tvl-history all call getRwaProtocols, so
// on a cold bundle (empty cache) they fired 2-3 concurrent 8MB downloads. An
// inflight promise collapses concurrent cold callers onto ONE fetch; on upstream
// failure we serve the last good list (even past TTL) so the page never blanks.
let protocolsInflight = null;
async function getRwaProtocols() {
  const now = Date.now();
  if (protocolsCache.data && now - protocolsCache.timestamp < PROTOCOLS_CACHE_TTL) {
    return protocolsCache.data;
  }
  if (protocolsInflight) return protocolsInflight;

  protocolsInflight = (async () => {
    console.log('[RWA] Fetching protocols from DeFiLlama...');
    const allProtocols = await fetchJSON('https://api.llama.fi/protocols');

    const rwaProtocols = allProtocols
      .filter((p) => p.category === 'RWA' || p.category === 'RWA Lending')
      .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
      .map((p) => ({
        name: p.name,
        slug: p.slug,
        tvl: p.tvl || 0,
        chains: p.chains || [],
        logo: p.logo || null,
        symbol: p.symbol || null,
        change_1d: p.change_1d ?? null,
        change_7d: p.change_7d ?? null,
        change_30d: p.change_30d ?? null,
        description: p.description || null,
        url: p.url || null,
        category: p.category,
        tags: Array.isArray(p.tags) ? p.tags : [],
        asset_class: deriveAssetClass(p),
        parent_protocol: p.parentProtocolSlug || null,
      }));

    protocolsCache.data = rwaProtocols;
    protocolsCache.timestamp = Date.now();
    console.log(`[RWA] Cached ${rwaProtocols.length} RWA protocols`);
    return rwaProtocols;
  })();

  try {
    return await protocolsInflight;
  } catch (err) {
    if (protocolsCache.data) { console.warn('[RWA] protocols upstream failed, serving stale:', err.message); return protocolsCache.data; }
    throw err;
  } finally {
    protocolsInflight = null;
  }
}

// ── GET /overview ────────────────────────────────────────────────────────────

async function getRwaOverview() {
  const protocols = await getRwaProtocols();

  const totalTvl = protocols.reduce((sum, p) => sum + p.tvl, 0);

  // Aggregate TVL per unique chain
  const chainMap = {};
  for (const p of protocols) {
    for (const chain of p.chains) {
      if (!chainMap[chain]) chainMap[chain] = 0;
      chainMap[chain] += p.tvl / p.chains.length; // approximate split
    }
  }
  const chainBreakdown = Object.entries(chainMap)
    .map(([chain, tvl]) => ({ chain, tvl }))
    .sort((a, b) => b.tvl - a.tvl);

  const allChains = new Set(protocols.flatMap((p) => p.chains));

  return {
    totalTvl,
    totalProtocols: protocols.length,
    totalChains: allChains.size,
    topProtocols: protocols.slice(0, 20),
    chainBreakdown,
  };
}

// ── Issuer-Direct (Phase 1) — pass-through to Spectre Data API ──────────────
// /api/rwa/breakdown and /api/rwa/issuers proxy to the Hetzner direct origin
// (CF-blocked path on api.spectreai.io). 60s in-memory cache + Cache-Control.
const SPECTRE_API_ORIGIN = (process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850').replace(/\/+$/, '');
const SPECTRE_API_KEY = process.env.SPECTRE_API_KEY || process.env.SPECTRE_DATA_API_KEY || '';
const ISSUER_PROXY_CACHE_TTL = 60 * 1000;
const issuerProxyCache = new Map();

async function fetchSpectre(path, timeoutMs = 12000) {
  const headers = { Accept: 'application/json' };
  if (SPECTRE_API_KEY) headers['X-API-Key'] = SPECTRE_API_KEY;
  const res = await fetch(`${SPECTRE_API_ORIGIN}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers,
  });
  if (!res.ok) throw new Error(`Spectre API ${res.status} on ${path}`);
  return res.json();
}

// breakdown/history is by far the slowest RWA upstream call (2y ~4s cold vs
// every other source <200ms), and it's what makes the history tier / charts
// feel slow. Cache it on a TTL longer than the warmer's 15-min cycle so the
// bundle + the warmer keep it permanently hot — the history tier then serves
// it from memory (~ms) instead of re-paying the 4s cold cost every 60s when
// the bundle cache expires. Keyed by range; the page only ever asks for 2y.
const breakdownHistoryCache = new Map(); // range -> { ts, data }
const BREAKDOWN_HISTORY_TTL = 20 * 60 * 1000; // 20 min (> warmer slow loop)
async function getRwaBreakdownHistory(range = '2y') {
  const key = String(range).toLowerCase();
  const hit = breakdownHistoryCache.get(key);
  if (hit && Date.now() - hit.ts < BREAKDOWN_HISTORY_TTL) return hit.data;
  try {
    const data = await fetchSpectre(`/v1/rwa/breakdown/history?range=${encodeURIComponent(key)}`);
    breakdownHistoryCache.set(key, { ts: Date.now(), data });
    return data;
  } catch (err) {
    // History tier feeds the charts only; on upstream failure serve the last
    // good series (even past TTL) so the active-mcap chart never blanks.
    if (hit) { console.warn('[RWA] breakdown-history upstream failed, serving stale:', err.message); return hit.data; }
    throw err;
  }
}

// breakdown + index are core-tier (page-paint) remote Spectre calls. They're
// usually fast (<200ms) but the upstream cold-starts unpredictably (observed
// 4-5s spikes), and the bundle used to call them via raw fetchSpectre with no
// cache — so every 60s bundle re-assembly could re-pay a cold spike and stall
// the page paint. Cache them on a TTL longer than the warmer's fast loop so
// the core tier stays hot. TTL 5 min (> 3-min fast warm); data changes slowly.
const SPECTRE_CORE_TTL = 5 * 60 * 1000;
// Core legs use a short upstream timeout: these block the page-paint bundle, so
// when the Spectre origin cold-starts/fails we must fail fast and serve stale
// rather than hold core for the full 12s. The origin is normally <200ms.
const SPECTRE_CORE_TIMEOUT = 4000;
const breakdownCache = { ts: 0, data: null };
const indexCache = { ts: 0, data: null };
// Refresh on stale; on upstream failure serve the last good value (even past
// TTL) instead of throwing, so a flaky origin never blocks core paint or wipes
// the section to null. Only throws if we never had data to begin with. `ts` is
// NOT bumped on the stale-serve path, so the next call retries the upstream.
async function getRwaBreakdown() {
  if (breakdownCache.data && Date.now() - breakdownCache.ts < SPECTRE_CORE_TTL) return breakdownCache.data;
  try {
    const data = await fetchSpectre('/v1/rwa/breakdown', SPECTRE_CORE_TIMEOUT);
    breakdownCache.ts = Date.now(); breakdownCache.data = data;
    return data;
  } catch (err) {
    if (breakdownCache.data) { console.warn('[RWA] breakdown upstream failed, serving stale:', err.message); return breakdownCache.data; }
    throw err;
  }
}
async function getRwaIndex() {
  if (indexCache.data && Date.now() - indexCache.ts < SPECTRE_CORE_TTL) return indexCache.data;
  try {
    const data = await fetchSpectre('/v1/rwa/index', SPECTRE_CORE_TIMEOUT);
    indexCache.ts = Date.now(); indexCache.data = data;
    return data;
  } catch (err) {
    if (indexCache.data) { console.warn('[RWA] index upstream failed, serving stale:', err.message); return indexCache.data; }
    throw err;
  }
}

router.get('/breakdown', async (req, res) => {
  try {
    const cached = issuerProxyCache.get('breakdown');
    if (cached && Date.now() - cached.ts < ISSUER_PROXY_CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      return res.json(cached.data);
    }
    const data = await fetchSpectre('/v1/rwa/breakdown');
    issuerProxyCache.set('breakdown', { ts: Date.now(), data });
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.json(data);
  } catch (err) {
    console.error('[RWA] /breakdown proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch RWA breakdown', detail: err.message });
  }
});

const BUNDLE_TTL = 60 * 1000;

// Bundle-risk (Risk & Alpha tab fan-in) — 6 upstream calls → 1 client fetch.
// Same defensive pattern as /bundle: individual failures land as null so
// partial data still renders.
const bundleRiskCache = new Map(); // key = `${velocityRange}:${eventsLimit}`
router.get('/bundle-risk', async (req, res) => {
  const velocityRange = String(req.query.velocity_range || '30d').toLowerCase();
  const eventsLimit = Math.min(parseInt(req.query.events_limit || '20', 10) || 20, 100);
  const key = `${velocityRange}:${eventsLimit}`;
  const cached = bundleRiskCache.get(key);
  if (cached && Date.now() - cached.ts < BUNDLE_TTL) {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.json({ ...cached.data, meta: { ...(cached.data.meta || {}), cached: true } });
  }
  const safe = async (label, fn) => {
    try { return await fn(); }
    catch (err) { console.error(`[RWA] bundle-risk/${label}:`, err.message); return null; }
  };
  const [
    navWatch, concentrationLeaderboard, velocity, events,
    composabilityGraph, yieldCurve,
  ] = await Promise.all([
    safe('nav-watch',                 () => fetchSpectre('/v1/rwa/nav-watch')),
    safe('concentration-leaderboard', () => fetchSpectre('/v1/rwa/concentration-leaderboard')),
    safe('velocity',                  () => fetchSpectre(`/v1/rwa/velocity?range=${encodeURIComponent(velocityRange)}`)),
    safe('events',                    () => fetchSpectre(`/v1/rwa/events?limit=${eventsLimit}`)),
    safe('composability-graph',       () => fetchSpectre('/v1/rwa/composability/graph')),
    safe('yield-curve',               () => fetchSpectre('/v1/rwa/yield-curve')),
  ]);
  const payload = {
    navWatch, concentrationLeaderboard, velocity, events,
    composabilityGraph, yieldCurve,
    meta: { cached: false, fetchedAt: new Date().toISOString(), ttlMs: BUNDLE_TTL },
  };
  bundleRiskCache.set(key, { ts: Date.now(), data: payload });
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  res.json(payload);
});

// Bundle (page-load fan-in) — returns the 9 endpoints tokenized-assets fires
// on mount in one response. See extended-proxy.js for the prod twin. Reduces
// 9 parallel /api/rwa/* calls to 1 (anonymous rate-limit kept the tail in
// 429-land before). Individual failures land as `null` so partial data still
// renders.
// Tiered bundle. `core` = the above-fold group (overview/protocols/
// stablecoins/movers/breakdown/index) so the page paints without waiting on
// the 3 heaviest calls; `history` = the 2-year chart series (tvl-history
// forward-fill aggregation, stablecoin-history, the remote breakdown/history)
// which the client fetches in parallel and fills in once they land; `full` =
// the legacy all-in-one (kept for back-compat / any non-tiered caller). Cached
// per tier so a core fetch never blocks on a history fetch. MUST stay in sync
// with the prod mirror at apps/research/api/_lib/handlers/extended-proxy.js.
// The per-coin `chainCirculating` map is ~307KB across 381 stablecoins (52% of
// the whole core payload) and is consumed ONLY by the Stablecoins tab's chain-
// distribution chart and the Screener's chain count - neither is the default
// Overview. Stripping it from the core tier cuts the page-paint payload ~46KB
// gzip (105->59KB). The Stablecoins tab lazy-fetches the full /stablecoins
// route when it opens; the Screener uses the lightweight `chains` name array
// (kept here). The full tier keeps chainCirculating for any non-tiered caller.
function slimStablecoins(list) {
  if (!Array.isArray(list)) return list;
  return list.map(({ chainCirculating, ...rest }) => rest);
}

const bundleCache = { core: null, history: null, full: null };
router.get('/bundle', async (req, res) => {
  const tier = String(req.query.tier || 'full').toLowerCase();
  const range = String(req.query.range || '2y').toLowerCase();
  const key = tier === 'core' ? 'core' : tier === 'history' ? 'history' : 'full';
  const entry = bundleCache[key];
  if (entry && Date.now() - entry.ts < BUNDLE_TTL && entry.range === range) {
    res.setHeader('Cache-Control', 'public, s-maxage=180, stale-while-revalidate=600');
    return res.json({ ...entry.data, meta: { ...(entry.data.meta || {}), cached: true } });
  }
  const safe = async (label, fn) => {
    try { return await fn(); }
    catch (err) { console.error(`[RWA] bundle/${label}:`, err.message); return null; }
  };

  let payload;
  if (key === 'core') {
    const [overview, protocols, stablecoins, movers, breakdown, indexData] = await Promise.all([
      safe('overview',    () => getRwaOverview()),
      safe('protocols',   () => getRwaProtocols()),
      safe('stablecoins', async () => slimStablecoins(await getRwaStablecoins())),
      safe('movers',      async () => (await getRwaMovers()).data),
      safe('breakdown',   () => getRwaBreakdown()),
      safe('index',       () => getRwaIndex()),
    ]);
    payload = {
      overview, protocols, stablecoins, movers, breakdown, index: indexData,
      meta: { cached: false, fetchedAt: new Date().toISOString(), ttlMs: BUNDLE_TTL, tier: 'core' },
    };
  } else if (key === 'history') {
    const [tvlHistory, stablecoinHistory, breakdownHistory] = await Promise.all([
      safe('tvl-history',        () => getRwaTvlHistory()),
      safe('stablecoin-history', () => getRwaStablecoinHistory()),
      safe('breakdown-history',  () => getRwaBreakdownHistory(range)),
    ]);
    payload = {
      tvlHistory, stablecoinHistory, breakdownHistory,
      meta: { cached: false, fetchedAt: new Date().toISOString(), ttlMs: BUNDLE_TTL, tier: 'history' },
    };
  } else {
    const [
      overview, protocols, stablecoins, movers,
      tvlHistory, stablecoinHistory,
      breakdown, indexData, breakdownHistory,
    ] = await Promise.all([
      safe('overview',           () => getRwaOverview()),
      safe('protocols',          () => getRwaProtocols()),
      safe('stablecoins',        () => getRwaStablecoins()),
      safe('movers',             async () => (await getRwaMovers()).data),
      safe('tvl-history',        () => getRwaTvlHistory()),
      safe('stablecoin-history', () => getRwaStablecoinHistory()),
      safe('breakdown',          () => getRwaBreakdown()),
      safe('index',              () => getRwaIndex()),
      safe('breakdown-history',  () => getRwaBreakdownHistory(range)),
    ]);
    payload = {
      overview, protocols, stablecoins, movers,
      tvlHistory, stablecoinHistory,
      breakdown, index: indexData, breakdownHistory,
      meta: { cached: false, fetchedAt: new Date().toISOString(), ttlMs: BUNDLE_TTL },
    };
  }
  bundleCache[key] = { ts: Date.now(), range, data: payload };
  // RWA aggregates move slowly (TVL / circulating supply); a 3-min CDN cache +
  // 10-min SWR window keeps prod (serverless, no in-memory warmer) from paying
  // the cold 8MB-protocols + Spectre-breakdown assembly on every 60s miss.
  res.setHeader('Cache-Control', 'public, s-maxage=180, stale-while-revalidate=600');
  res.json(payload);
});

router.get('/issuers', async (req, res) => {
  try {
    const cached = issuerProxyCache.get('issuers');
    if (cached && Date.now() - cached.ts < ISSUER_PROXY_CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      return res.json(withFreshness(cached.data, cached.ts));
    }
    const data = await fetchSpectre('/v1/rwa/issuers');
    const now = Date.now();
    issuerProxyCache.set('issuers', { ts: now, data });
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.json(withFreshness(data, now));
  } catch (err) {
    console.error('[RWA] /issuers proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch RWA issuers', detail: err.message });
  }
});

// Phase 4: stablecoins summary — separate from RWA mcap.
router.get('/stablecoins-summary', async (req, res) => {
  try {
    const cached = issuerProxyCache.get('stablecoins-summary');
    if (cached && Date.now() - cached.ts < ISSUER_PROXY_CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      return res.json(cached.data);
    }
    const data = await fetchSpectre('/v1/rwa/stablecoins-summary');
    issuerProxyCache.set('stablecoins-summary', { ts: Date.now(), data });
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.json(data);
  } catch (err) {
    console.error('[RWA] /stablecoins-summary proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch stablecoins summary', detail: err.message });
  }
});

// Phase 2: history endpoints — pass-through to Spectre Data API.
router.get('/breakdown/history', async (req, res) => {
  try {
    const range = String(req.query.range || '1y').toLowerCase();
    const cacheKey = `breakdown_history:${range}`;
    const cached = issuerProxyCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ISSUER_PROXY_CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      return res.json(cached.data);
    }
    const data = await fetchSpectre(`/v1/rwa/breakdown/history?range=${encodeURIComponent(range)}`);
    issuerProxyCache.set(cacheKey, { ts: Date.now(), data });
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.json(data);
  } catch (err) {
    console.error('[RWA] /breakdown/history proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch RWA breakdown history', detail: err.message });
  }
});

router.get('/issuer/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    if (!/^[a-z0-9-]+$/i.test(slug)) {
      return res.status(400).json({ error: 'Invalid slug' });
    }
    const cacheKey = `issuer:${slug}`;
    const cached = issuerProxyCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ISSUER_PROXY_CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      return res.json(cached.data);
    }
    const data = await fetchSpectre(`/v1/rwa/issuer/${encodeURIComponent(slug)}`);
    issuerProxyCache.set(cacheKey, { ts: Date.now(), data });
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.json(data);
  } catch (err) {
    console.error('[RWA] /issuer/:slug proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch RWA issuer', detail: err.message });
  }
});

// ── Phase 6: Spectre RWA Index (SRWAI) pass-throughs ────────────────────────
// Mirror the existing breakdown pass-through pattern.
router.get('/index', async (req, res) => {
  try {
    const cached = issuerProxyCache.get('index');
    if (cached && Date.now() - cached.ts < ISSUER_PROXY_CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      return res.json(cached.data);
    }
    const data = await fetchSpectre('/v1/rwa/index');
    issuerProxyCache.set('index', { ts: Date.now(), data });
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.json(data);
  } catch (err) {
    console.error('[RWA] /index proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch RWA index', detail: err.message });
  }
});

router.get('/index/history', async (req, res) => {
  try {
    const range = String(req.query.range || '1y').toLowerCase();
    const cacheKey = `index_history:${range}`;
    const cached = issuerProxyCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ISSUER_PROXY_CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      return res.json(cached.data);
    }
    const data = await fetchSpectre(`/v1/rwa/index/history?range=${encodeURIComponent(range)}`);
    issuerProxyCache.set(cacheKey, { ts: Date.now(), data });
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.json(data);
  } catch (err) {
    console.error('[RWA] /index/history proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch RWA index history', detail: err.message });
  }
});

router.get('/index/composition', async (req, res) => {
  try {
    const cached = issuerProxyCache.get('index_composition');
    if (cached && Date.now() - cached.ts < ISSUER_PROXY_CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      return res.json(cached.data);
    }
    const data = await fetchSpectre('/v1/rwa/index/composition');
    issuerProxyCache.set('index_composition', { ts: Date.now(), data });
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.json(data);
  } catch (err) {
    console.error('[RWA] /index/composition proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch RWA index composition', detail: err.message });
  }
});

router.get('/index/methodology', async (req, res) => {
  try {
    const data = await fetchSpectre('/v1/rwa/index/methodology');
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');
    res.json(data);
  } catch (err) {
    console.error('[RWA] /index/methodology proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch SRWAI methodology', detail: err.message });
  }
});

// ── Phase 7: flagship signals ──────────────────────────────────────────────
// Pass-through to /v1/rwa/{nav-watch, concentration-leaderboard, velocity,
// events, credit-rating/:slug, issuer/:slug/chains}. Same 60s cache pattern
// as the rest of the issuer-direct surface.
/**
 * Inject a top-level `served_at` timestamp on any proxied response so the
 * FreshnessTag has something to read. Preserves the upstream `generated_at`
 * if present (deeper inside `data` or `meta`), but always adds one at the
 * top level for easy client consumption.
 */
function withFreshness(payload, cachedAtMs) {
  if (payload == null) return payload;
  // Object payload — inject if not already present.
  if (typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      ...payload,
      served_at: new Date().toISOString(),
      cached_at: cachedAtMs ? new Date(cachedAtMs).toISOString() : null,
      // Hoist upstream timestamp to the top level for the FreshnessTag.
      generated_at:
        payload.generated_at ||
        payload.data?.generated_at ||
        payload.meta?.generated_at ||
        payload.data?.snapshot_at ||
        new Date(cachedAtMs || Date.now()).toISOString(),
    };
  }
  // Array payload — wrap so we can attach metadata.
  if (Array.isArray(payload)) {
    return {
      data: payload,
      served_at: new Date().toISOString(),
      cached_at: cachedAtMs ? new Date(cachedAtMs).toISOString() : null,
      generated_at: new Date(cachedAtMs || Date.now()).toISOString(),
    };
  }
  return payload;
}

async function proxyAndCache(req, res, upstreamPath, cacheKey, ttlMs = ISSUER_PROXY_CACHE_TTL) {
  try {
    if (cacheKey) {
      const cached = issuerProxyCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < ttlMs) {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
        return res.json(withFreshness(cached.data, cached.ts));
      }
    }
    const data = await fetchSpectre(upstreamPath);
    const now = Date.now();
    if (cacheKey) issuerProxyCache.set(cacheKey, { ts: now, data });
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.json(withFreshness(data, now));
  } catch (err) {
    console.error(`[RWA] ${upstreamPath} proxy error:`, err.message);
    return res.status(502).json({ error: 'Failed to fetch from Spectre Data API', detail: err.message });
  }
}

router.get('/nav-watch', (req, res) => proxyAndCache(req, res, '/v1/rwa/nav-watch', 'nav_watch'));
router.get('/concentration-leaderboard', (req, res) => proxyAndCache(req, res, '/v1/rwa/concentration-leaderboard', 'concentration_leaderboard'));

router.get('/velocity', (req, res) => {
  const range = String(req.query.range || '30d').toLowerCase();
  return proxyAndCache(req, res, `/v1/rwa/velocity?range=${encodeURIComponent(range)}`, `velocity:${range}`);
});

router.get('/events', (req, res) => {
  const slug = req.query.slug ? String(req.query.slug) : '';
  const type = req.query.type ? String(req.query.type) : '';
  const since = req.query.since ? String(req.query.since) : '';
  const limit = String(req.query.limit || '50');
  const qs = new URLSearchParams();
  if (slug) qs.set('slug', slug);
  if (type) qs.set('type', type);
  if (since) qs.set('since', since);
  qs.set('limit', limit);
  // Events feed is short-lived (live mint/burn) — 15s cache.
  return proxyAndCache(req, res, `/v1/rwa/events?${qs.toString()}`, `events:${qs.toString()}`, 15 * 1000);
});

router.get('/credit-rating/:slug', (req, res) => {
  const { slug } = req.params;
  if (!/^[a-z0-9-]+$/i.test(slug)) {
    return res.status(400).json({ error: 'Invalid slug' });
  }
  return proxyAndCache(req, res, `/v1/rwa/credit-rating/${encodeURIComponent(slug)}`, `credit:${slug}`);
});

// IMPORTANT: this is /issuer/:slug/chains. The bare /issuer/:slug already
// matches above — Express picks the first match, so the longer path must
// be registered EARLIER in the file. We keep the bare /issuer/:slug at its
// existing location and register /chains here AFTER (which will not match
// /:slug because of the trailing /chains segment — Express routes are
// matched left-to-right against the URL pattern, not "first registered").
router.get('/issuer/:slug/chains', (req, res) => {
  const { slug } = req.params;
  if (!/^[a-z0-9-]+$/i.test(slug)) {
    return res.status(400).json({ error: 'Invalid slug' });
  }
  return proxyAndCache(req, res, `/v1/rwa/issuer/${encodeURIComponent(slug)}/chains`, `chains:${slug}`);
});

// ── Phase 8: composability graph + yield curve ─────────────────────────────
// Pass-through to /v1/rwa/{composability,composability/graph,yield-curve}.
// Composability = 5min cache (editorial). Yield curve = 60min (FRED-bound).
router.get('/composability/graph', (req, res) =>
  proxyAndCache(req, res, '/v1/rwa/composability/graph', 'comp_graph', 5 * 60 * 1000)
);

router.get('/composability', (req, res) => {
  const slug = req.query.slug ? String(req.query.slug) : '';
  if (!slug || !/^[a-z0-9_-]+$/i.test(slug)) {
    return res.status(400).json({ error: 'Invalid or missing slug' });
  }
  return proxyAndCache(
    req,
    res,
    `/v1/rwa/composability?slug=${encodeURIComponent(slug)}`,
    `comp:${slug}`,
    5 * 60 * 1000
  );
});

router.get('/yield-curve', (req, res) =>
  proxyAndCache(req, res, '/v1/rwa/yield-curve', 'yield_curve', 60 * 60 * 1000)
);

// ── GET /signals ─────────────────────────────────────────────────────────────
// Derived risk/opportunity chips based on live state across breakdown +
// velocity + nav-watch + concentration. Replaces the hardcoded chip lists
// that brain-sidebar fell back to when this endpoint 404'd.
//
// Response: { tone: 'up'|'dn'|'neutral', chips: [{label, kind:'up'|'dn'|'neutral', evidence}], generated_at }
const signalsCache = { data: null, ts: 0 };
const SIGNALS_TTL = 60 * 1000;

router.get('/signals', async (req, res) => {
  try {
    if (signalsCache.data && Date.now() - signalsCache.ts < SIGNALS_TTL) {
      return res.json(signalsCache.data);
    }

    // Pull all derivation inputs in parallel — all are local routes already cached.
    // Spectre API responses are wrapped in { data, meta } — unwrap data here.
    const [breakdown, velocity, navWatch, concentration, breakdownHistory] = await Promise.all([
      fetchSpectre('/v1/rwa/breakdown').then((r) => r?.data || r).catch(() => null),
      fetchSpectre('/v1/rwa/velocity?range=30d').then((r) => r?.data || r).catch(() => null),
      fetchSpectre('/v1/rwa/nav-watch').then((r) => r?.data || r).catch(() => null),
      fetchSpectre('/v1/rwa/concentration-leaderboard').then((r) => r?.data || r).catch(() => null),
      fetchSpectre('/v1/rwa/breakdown/history?range=30d').then((r) => r?.data || r).catch(() => null),
    ]);

    const chips = [];

    // Velocity → smart money flow. `series` is daily snapshots; use the
    // latest entry's gross_inflow vs gross_outflow ratio as a flow signal.
    const velSeries = velocity?.series || [];
    const latestVel = velSeries[velSeries.length - 1] || {};
    const grossIn = Number(latestVel.gross_inflow_usd) || 0;
    const grossOut = Number(latestVel.gross_outflow_usd) || 0;
    const flowRatio = grossOut > 0 ? grossIn / grossOut : (grossIn > 0 ? Infinity : 0);
    const inflowIssuers = Number(latestVel.issuers_with_inflow) || 0;
    const outflowIssuers = Number(latestVel.issuers_with_outflow) || 0;
    if (flowRatio > 2 && inflowIssuers >= outflowIssuers) {
      chips.push({ label: 'Smart Money Flowing', kind: 'up',
        evidence: `${inflowIssuers} issuers w/ net inflow · ratio ${flowRatio === Infinity ? '∞' : flowRatio.toFixed(1)}x` });
    } else if (flowRatio < 0.5 || outflowIssuers > inflowIssuers) {
      chips.push({ label: 'Smart Money Pausing', kind: 'dn',
        evidence: `${outflowIssuers} issuers w/ net outflow` });
    } else {
      chips.push({ label: 'Even Flows', kind: 'neutral',
        evidence: `inflow/outflow ratio ${flowRatio.toFixed(1)}x` });
    }

    // NAV watch → yield opportunity / compression. Find the deviation field.
    const navRows = navWatch?.issuers || navWatch?.rows || navWatch?.data || [];
    const navList = Array.isArray(navRows) ? navRows : [];
    const navAlerts = navList.filter((r) => Math.abs(Number(r.deviation_bps ?? r.dev_bps ?? r.nav_deviation_bps ?? 0)) >= 20).length;
    if (navAlerts >= 3) chips.push({ label: 'Yield Opportunity', kind: 'up', evidence: `${navAlerts} NAV deviations >20bps` });
    else if (navAlerts === 0) chips.push({ label: 'Yield Compression', kind: 'dn', evidence: 'NAV stable across issuers' });
    else chips.push({ label: 'Stable Yields', kind: 'neutral', evidence: `${navAlerts} NAV deviations` });

    // Concentration → risk vs cluster signal
    const concRows = concentration?.issuers || concentration?.rows || concentration?.data || [];
    const concList = Array.isArray(concRows) ? concRows : [];
    const topShare = Number(concList[0]?.share_pct ?? concList[0]?.aum_share ?? 0);
    if (topShare >= 40) chips.push({ label: 'Concentration Risk', kind: 'dn', evidence: `top issuer ${topShare.toFixed(0)}% share` });
    else if (topShare > 0 && topShare < 25) chips.push({ label: 'Liquidity Clusters', kind: 'up', evidence: `top issuer ${topShare.toFixed(0)}% — diversified` });

    // Breakdown 7d direction → conviction. Categories live at data.categories.
    const cats = breakdown?.categories || [];
    const totalAum = cats.reduce((s, c) => s + (Number(c.aum_usd) || 0), 0);
    const ch7d = computeAumChange7d(breakdownHistory);
    if (ch7d != null) {
      if (ch7d >= 2) chips.push({ label: 'High Conviction', kind: 'up', evidence: `+${ch7d.toFixed(1)}% AUM in 7d` });
      else if (ch7d <= -2) chips.push({ label: 'Outflow Pressure', kind: 'dn', evidence: `${ch7d.toFixed(1)}% AUM in 7d` });
      else chips.push({ label: 'Mixed Signals', kind: 'neutral', evidence: `${ch7d >= 0 ? '+' : ''}${ch7d.toFixed(1)}% AUM in 7d` });
    }

    // Tone = majority signal direction
    const upCount = chips.filter((c) => c.kind === 'up').length;
    const dnCount = chips.filter((c) => c.kind === 'dn').length;
    const tone = upCount > dnCount ? 'up' : dnCount > upCount ? 'dn' : 'neutral';

    const payload = {
      tone,
      chips,
      total_aum_usd: totalAum || null,
      change_7d_pct: ch7d,
      generated_at: new Date().toISOString(),
      sources: ['breakdown', 'velocity', 'nav-watch', 'concentration', 'breakdown-history'],
    };
    signalsCache.data = payload;
    signalsCache.ts = Date.now();
    res.json(payload);
  } catch (err) {
    console.error('[RWA] /signals error:', err.message);
    res.status(500).json({ error: 'Failed to derive RWA signals', detail: err.message });
  }
});

function computeAumChange7d(history) {
  // history is the unwrapped data block: { series, categories, ... }
  const series = history?.series;
  if (!Array.isArray(series) || series.length < 8) return null;
  const cats = history?.categories || [];
  if (!cats.length) return null;
  const totalAt = (i) => cats.reduce((acc, c) => acc + (Number(series[i]?.[c]) || 0), 0);
  const last = totalAt(series.length - 1);
  const prev = totalAt(Math.max(0, series.length - 8));
  if (prev <= 0) return null;
  return ((last - prev) / prev) * 100;
}

// ── GET /themes ──────────────────────────────────────────────────────────────
// Capital rotation themes derived from per-category 7d change ranking.
// Each theme: { title, sub, change_7d_pct, aum_usd, share_pct }.
const themesCache = { data: null, ts: 0 };
const THEMES_TTL = 5 * 60 * 1000;

router.get('/themes', async (req, res) => {
  try {
    if (themesCache.data && Date.now() - themesCache.ts < THEMES_TTL) {
      return res.json(themesCache.data);
    }

    // Unwrap { data, meta } envelope.
    const [breakdown, history] = await Promise.all([
      fetchSpectre('/v1/rwa/breakdown').then((r) => r?.data || r).catch(() => null),
      fetchSpectre('/v1/rwa/breakdown/history?range=30d').then((r) => r?.data || r).catch(() => null),
    ]);

    const cats = breakdown?.categories || [];
    const series = history?.series || [];
    const histCats = history?.categories || [];

    const themes = cats
      .map((c) => {
        const slug = c.slug || c.name;
        let change7d = null;
        if (histCats.length && series.length >= 8) {
          const histKey = histCats.find((hc) => hc.toLowerCase() === String(c.name || '').toLowerCase())
            || histCats.find((hc) => hc.toLowerCase().includes(slug?.toLowerCase() || '__'));
          if (histKey) {
            const prev = Number(series[series.length - 8]?.[histKey]) || 0;
            const last = Number(series[series.length - 1]?.[histKey]) || 0;
            if (prev > 0) change7d = ((last - prev) / prev) * 100;
          }
        }
        return {
          slug,
          title: c.name || slug,
          aum_usd: Number(c.aum_usd) || 0,
          share_pct: Number(c.share_pct) || 0,
          change_7d_pct: change7d,
          sub: subtitleForChange(change7d),
        };
      })
      .filter((t) => t.aum_usd > 0)
      .sort((a, b) => {
        // Prefer movers (large absolute change), then large AUM
        const ma = Math.abs(a.change_7d_pct ?? 0);
        const mb = Math.abs(b.change_7d_pct ?? 0);
        if (mb !== ma) return mb - ma;
        return b.aum_usd - a.aum_usd;
      })
      .slice(0, 6);

    const payload = {
      themes,
      generated_at: new Date().toISOString(),
      sources: ['breakdown', 'breakdown-history'],
    };
    themesCache.data = payload;
    themesCache.ts = Date.now();
    res.json(payload);
  } catch (err) {
    console.error('[RWA] /themes error:', err.message);
    res.status(500).json({ error: 'Failed to derive RWA themes', detail: err.message });
  }
});

function subtitleForChange(ch) {
  if (ch == null) return 'Flow data pending';
  if (ch >= 8) return 'Strong inflows, institutional demand';
  if (ch >= 2) return 'Steady accumulation, healthy bid';
  if (ch >= -2) return 'Range-bound, awaiting catalyst';
  if (ch >= -8) return 'Outflow pressure, watching support';
  return 'Sharp drawdown, defensive posture';
}

router.get('/overview', async (req, res) => {
  try {
    const result = await getRwaOverview();
    // Surface freshness — overview is composed from DefiLlama (5 min server cache).
    res.json(withFreshness(result, protocolsCache.timestamp || Date.now()));
  } catch (err) {
    console.error('[RWA] /overview error:', err.message);
    res.status(500).json({ error: 'Failed to fetch RWA overview' });
  }
});

// ── GET /protocols ───────────────────────────────────────────────────────────

router.get('/protocols', async (req, res) => {
  try {
    const protocols = await getRwaProtocols();
    res.json(withFreshness(protocols, protocolsCache.timestamp || Date.now()));
  } catch (err) {
    console.error('[RWA] /protocols error:', err.message);
    res.status(500).json({ error: 'Failed to fetch RWA protocols' });
  }
});

// ── GET /protocol/:slug ──────────────────────────────────────────────────────

router.get('/protocol/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const now = Date.now();

    const cached = protocolDetailCache.get(slug);
    if (cached && now - cached.timestamp < PROTOCOL_DETAIL_TTL) {
      return res.json(cached.data);
    }

    console.log(`[RWA] Fetching protocol detail: ${slug}`);
    const raw = await fetchJSON(`https://api.llama.fi/protocol/${slug}`);

    const result = {
      name: raw.name,
      tvl: raw.tvl || 0,
      chains: raw.chains || [],
      chainTvls: raw.chainTvls || {},
      tvlHistory: raw.tvl ? undefined : [],
    };

    // Extract TVL history from the main tvl array
    if (Array.isArray(raw.tvl)) {
      result.tvlHistory = raw.tvl;
      result.tvl = raw.tvl.length > 0 ? raw.tvl[raw.tvl.length - 1].totalLiquidityUSD : 0;
    } else if (raw.chainTvls) {
      // Fallback: try to derive history from chainTvls
      const allChainTvls = raw.chainTvls;
      const firstChainKey = Object.keys(allChainTvls).find(
        (k) => Array.isArray(allChainTvls[k]?.tvl)
      );
      if (firstChainKey) {
        result.tvlHistory = allChainTvls[firstChainKey].tvl;
      }
    }

    protocolDetailCache.set(slug, { data: result, timestamp: now });
    res.json(result);
  } catch (err) {
    console.error(`[RWA] /protocol/${req.params.slug} error:`, err.message);
    res.status(500).json({ error: 'Failed to fetch protocol detail' });
  }
});

// ── GET /stablecoins ─────────────────────────────────────────────────────────

async function getRwaStablecoins() {
  const now = Date.now();
  if (stablecoinsCache.data && now - stablecoinsCache.timestamp < STABLECOINS_CACHE_TTL) {
    return stablecoinsCache.data;
  }

  console.log('[RWA] Fetching stablecoins from DeFiLlama...');
  const raw = await fetchJSON('https://stablecoins.llama.fi/stablecoins?includePrices=true');

  const stablecoins = (raw.peggedAssets || []).map((s) => ({
    id: s.id,
    name: s.name,
    symbol: s.symbol,
    geckoId: s.geckoId || null,
    pegType: s.pegType || null,
    pegMechanism: s.pegMechanism || null,
    circulating: s.circulating || null,
    circulatingPrevDay: s.circulatingPrevDay || null,
    circulatingPrevWeek: s.circulatingPrevWeek || null,
    circulatingPrevMonth: s.circulatingPrevMonth || null,
    chains: s.chains || [],
    chainCirculating: s.chainCirculating || {},
    price: s.price ?? null,
  }));

  stablecoinsCache.data = stablecoins;
  stablecoinsCache.timestamp = now;
  console.log(`[RWA] Cached ${stablecoins.length} stablecoins`);

  return stablecoins;
}

router.get('/stablecoins', async (req, res) => {
  try {
    const stablecoins = await getRwaStablecoins();
    res.json(withFreshness(stablecoins, stablecoinsCache.timestamp || Date.now()));
  } catch (err) {
    console.error('[RWA] /stablecoins error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stablecoins' });
  }
});

// ── GET /stablecoin-charts/:id ───────────────────────────────────────────────

router.get('/stablecoin-charts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const now = Date.now();

    const cached = stablecoinChartsCache.get(id);
    if (cached && now - cached.timestamp < STABLECOIN_CHARTS_TTL) {
      return res.json(cached.data);
    }

    console.log(`[RWA] Fetching stablecoin chart: ${id}`);
    const data = await fetchJSON(
      `https://stablecoins.llama.fi/stablecoincharts/all?stablecoin=${id}`
    );

    stablecoinChartsCache.set(id, { data, timestamp: now });
    res.json(data);
  } catch (err) {
    console.error(`[RWA] /stablecoin-charts/${req.params.id} error:`, err.message);
    res.status(500).json({ error: 'Failed to fetch stablecoin chart data' });
  }
});

// ── GET /chains ──────────────────────────────────────────────────────────────

async function getRwaChains() {
  const protocols = await getRwaProtocols();

  // Aggregate per chain
  const chainMap = {};
  for (const p of protocols) {
    for (const chain of p.chains) {
      if (!chainMap[chain]) {
        chainMap[chain] = { chain, totalRwaTvl: 0, protocolCount: 0, protocols: [] };
      }
      // Approximate per-chain TVL by splitting evenly across chains
      chainMap[chain].totalRwaTvl += p.tvl / p.chains.length;
      chainMap[chain].protocolCount += 1;
      chainMap[chain].protocols.push({ name: p.name, slug: p.slug, tvl: p.tvl });
    }
  }

  return Object.values(chainMap).sort((a, b) => b.totalRwaTvl - a.totalRwaTvl);
}

router.get('/chains', async (req, res) => {
  try {
    const chains = await getRwaChains();
    res.json(withFreshness(chains, protocolsCache.timestamp || Date.now()));
  } catch (err) {
    console.error('[RWA] /chains error:', err.message);
    res.status(500).json({ error: 'Failed to fetch RWA chain data' });
  }
});

// ── Helpers for TVL history ──────────────────────────────────────────────────

const tvlHistoryCache = { data: null, timestamp: 0 };
const TVL_HISTORY_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const HISTORY_TREASURY_KW = ['treasury', 'buidl', 'usyc', 'benji', 'ustb', 't-bill', 'wisdomtree', 'superstate', 'openeden', 'matrixdock', 'ondo', 'spiko'];
const HISTORY_CREDIT_KW = ['centrifuge', 'maple', 'goldfinch', 'truefi', 'clearpool', 'credix', 'credit'];
const HISTORY_COMMODITY_KW = ['gold', 'paxg', 'xaut', 'silver', 'platinum', 'commodity'];

function classifyForHistory(name) {
  const l = (name || '').toLowerCase();
  if (HISTORY_COMMODITY_KW.some(k => l.includes(k))) return 'Commodities';
  if (HISTORY_TREASURY_KW.some(k => l.includes(k))) return 'Treasuries';
  if (HISTORY_CREDIT_KW.some(k => l.includes(k))) return 'Credit';
  return 'Other RWA';
}

/**
 * Normalize protocol histories to daily buckets and forward-fill missing values.
 * Each protocol reports on different dates, so we need to:
 * 1. Round all dates to day boundaries
 * 2. Create a continuous daily series
 * 3. Forward-fill each protocol's value when it's missing for a day
 */
function buildDailySeries(validHistories) {
  const SECONDS_PER_DAY = 86400;
  const categories = ['Treasuries', 'Credit', 'Commodities', 'Other RWA'];

  // Group protocols by category
  const protosByCategory = {};
  for (const cat of categories) protosByCategory[cat] = [];
  for (const proto of validHistories) {
    protosByCategory[proto.category].push(proto);
  }

  // For each protocol, build a day-keyed map of TVL (forward-fill)
  const protoDaily = validHistories.map(proto => {
    const dayMap = {};
    const sorted = proto.history.sort((a, b) => a.date - b.date);
    for (const point of sorted) {
      const dayKey = Math.floor(point.date / SECONDS_PER_DAY) * SECONDS_PER_DAY;
      dayMap[dayKey] = point.tvl;
    }
    return { ...proto, dayMap, days: Object.keys(dayMap).map(Number).sort((a, b) => a - b) };
  });

  // Find global date range (only consider protocols that have meaningful history)
  const allDays = protoDaily.flatMap(p => p.days);
  if (!allDays.length) return [];

  const minDay = Math.min(...allDays);
  const maxDay = Math.max(...allDays);

  // Build continuous daily series with forward-fill per protocol
  const series = [];
  for (let day = minDay; day <= maxDay; day += SECONDS_PER_DAY) {
    const point = { date: day, Treasuries: 0, Credit: 0, Commodities: 0, 'Other RWA': 0 };

    for (const proto of protoDaily) {
      // If this protocol hasn't started yet, skip
      if (day < proto.days[0]) continue;

      // Find value: exact match or forward-fill from last known
      let val = proto.dayMap[day];
      if (val == null) {
        // Binary search for the last day <= current day
        let lo = 0, hi = proto.days.length - 1;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (proto.days[mid] <= day) lo = mid;
          else hi = mid - 1;
        }
        if (proto.days[lo] <= day) val = proto.dayMap[proto.days[lo]];
      }

      if (val != null) point[proto.category] += val;
    }

    series.push(point);
  }

  return series;
}

// ── GET /tvl-history ────────────────────────────────────────────────────────

async function getRwaTvlHistory() {
  const now = Date.now();
  if (tvlHistoryCache.data && now - tvlHistoryCache.timestamp < TVL_HISTORY_CACHE_TTL) {
    return tvlHistoryCache.data;
  }

  console.log('[RWA] Building TVL history from top protocols...');
  const protocols = await getRwaProtocols();

  // Fetch history for top 25 protocols by TVL
  const topProtocols = protocols.slice(0, 25);
  const histories = await Promise.allSettled(
    topProtocols.map(async (p) => {
      try {
        const detail = await fetchJSON(`https://api.llama.fi/protocol/${p.slug}`);
        let tvlArr = [];
        if (Array.isArray(detail.tvl)) {
          tvlArr = detail.tvl;
        } else if (detail.chainTvls) {
          const firstKey = Object.keys(detail.chainTvls).find(
            k => Array.isArray(detail.chainTvls[k]?.tvl)
          );
          if (firstKey) tvlArr = detail.chainTvls[firstKey].tvl;
        }
        return {
          name: p.name,
          slug: p.slug,
          category: classifyForHistory(p.name),
          currentTvl: p.tvl || 0,
          history: tvlArr.map(h => ({
            date: h.date,
            tvl: h.totalLiquidityUSD || 0,
          })),
        };
      } catch {
        return null;
      }
    })
  );

  const validHistories = histories
    .filter(r => r.status === 'fulfilled' && r.value?.history?.length)
    .map(r => r.value);

  console.log('[RWA] Classification:', validHistories.map(h => `${h.name} → ${h.category}`).join(', '));

  // Build properly aggregated daily series with forward-fill
  let series = buildDailySeries(validHistories);

  // Sample down to ~400 points for performance
  if (series.length > 400) {
    const step = Math.ceil(series.length / 400);
    series = series.filter((_, i) => i % step === 0 || i === series.length - 1);
  }

  // Per-protocol series for individual tab charts (top 8 by TVL)
  const protocolSeries = {};
  for (const proto of validHistories.slice(0, 8)) {
    protocolSeries[proto.slug] = {
      name: proto.name,
      category: proto.category,
      currentTvl: proto.currentTvl,
      data: proto.history
        .sort((a, b) => a.date - b.date)
        .filter((_, i, arr) => {
          if (arr.length <= 200) return true;
          const step = Math.ceil(arr.length / 200);
          return i % step === 0 || i === arr.length - 1;
        }),
    };
  }

  const result = {
    categories: ['Treasuries', 'Credit', 'Commodities', 'Other RWA'],
    series,
    protocolSeries,
    protocolCount: validHistories.length,
    lastUpdated: now,
  };

  tvlHistoryCache.data = result;
  tvlHistoryCache.timestamp = now;
  console.log(`[RWA] Built TVL history: ${series.length} data points from ${validHistories.length} protocols`);

  return result;
}

router.get('/tvl-history', async (req, res) => {
  try {
    const result = await getRwaTvlHistory();
    res.json(result);
  } catch (err) {
    console.error('[RWA] /tvl-history error:', err.message);
    res.status(500).json({ error: 'Failed to build TVL history' });
  }
});

// ── GET /stablecoin-history ─────────────────────────────────────────────────
// Returns historical total stablecoin market cap

const stablecoinHistoryCache = { data: null, timestamp: 0 };

async function getRwaStablecoinHistory() {
  const now = Date.now();
  if (stablecoinHistoryCache.data && now - stablecoinHistoryCache.timestamp < TVL_HISTORY_CACHE_TTL) {
    return stablecoinHistoryCache.data;
  }

  console.log('[RWA] Fetching stablecoin history...');
  await fetchJSON('https://stablecoins.llama.fi/stablecoincharts/all?stablecoin=1');

  // Also get top 5 individual stablecoins
  const stablecoins = await fetchJSON('https://stablecoins.llama.fi/stablecoins?includePrices=true');
  const top5 = (stablecoins.peggedAssets || [])
    .sort((a, b) => (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0))
    .slice(0, 5);

  const individualHistories = await Promise.allSettled(
    top5.map(async (sc) => {
      try {
        const chart = await fetchJSON(`https://stablecoins.llama.fi/stablecoincharts/all?stablecoin=${sc.id}`);
        return {
          id: sc.id,
          name: sc.name,
          symbol: sc.symbol,
          history: chart.map(p => ({
            date: p.date,
            mcap: p.totalCirculatingUSD?.peggedUSD || 0,
          })),
        };
      } catch {
        return null;
      }
    })
  );

  const validIndividual = individualHistories
    .filter(r => r.status === 'fulfilled' && r.value?.history?.length)
    .map(r => r.value);

  // Build combined time series
  const dateMap = {};
  for (const sc of validIndividual) {
    for (const point of sc.history) {
      if (!dateMap[point.date]) {
        dateMap[point.date] = { date: point.date };
      }
      dateMap[point.date][sc.symbol] = point.mcap;
    }
  }

  let series = Object.values(dateMap).sort((a, b) => a.date - b.date);
  if (series.length > 500) {
    const step = Math.ceil(series.length / 500);
    series = series.filter((_, i) => i % step === 0 || i === series.length - 1);
  }

  const result = {
    coins: validIndividual.map(sc => ({ id: sc.id, name: sc.name, symbol: sc.symbol })),
    series,
    lastUpdated: now,
  };

  stablecoinHistoryCache.data = result;
  stablecoinHistoryCache.timestamp = now;
  console.log(`[RWA] Stablecoin history: ${series.length} points, ${validIndividual.length} coins`);

  return result;
}

router.get('/stablecoin-history', async (req, res) => {
  try {
    const result = await getRwaStablecoinHistory();
    res.json(result);
  } catch (err) {
    console.error('[RWA] /stablecoin-history error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stablecoin history' });
  }
});

// ── GET /movers ─────────────────────────────────────────────────────────────
// Biggest TVL changers in 24h, split into gainers and losers.

const moversCache = { data: null, timestamp: 0 };
const MOVERS_CACHE_TTL = 5 * 60 * 1000;

async function getRwaMovers() {
  const now = Date.now();
  if (moversCache.data && now - moversCache.timestamp < MOVERS_CACHE_TTL) {
    return { data: moversCache.data, cached: true, fetchedAt: moversCache.timestamp };
  }

  const protocols = await getRwaProtocols();
  const withChange = protocols.filter(p => p.tvl > 1_000_000 && p.change_1d != null);
  const gainers = withChange.filter(p => p.change_1d > 0).sort((a, b) => b.change_1d - a.change_1d).slice(0, 10);
  const losers = withChange.filter(p => p.change_1d < 0).sort((a, b) => a.change_1d - b.change_1d).slice(0, 10);

  const result = { gainers, losers };
  moversCache.data = result;
  moversCache.timestamp = now;
  return { data: result, cached: false, fetchedAt: now };
}

router.get('/movers', async (req, res) => {
  try {
    const { data, cached, fetchedAt } = await getRwaMovers();
    res.json({
      ...withFreshness(data, fetchedAt),
      meta: { cached, fetchedAt: new Date(fetchedAt).toISOString(), ttlMs: MOVERS_CACHE_TTL },
    });
  } catch (err) {
    console.error('[RWA] /movers error:', err.message);
    res.status(500).json({ error: 'Failed to fetch RWA movers' });
  }
});

// ── GET /search?q= ──────────────────────────────────────────────────────────
// Fuzzy match across cached protocol list for autocomplete.

router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim().toLowerCase();
    if (q.length < 2) return res.json([]);

    const protocols = await getRwaProtocols();
    const scored = protocols
      .map(p => {
        const name = (p.name || '').toLowerCase();
        const symbol = (p.symbol || '').toLowerCase();
        let score = 0;
        if (name === q || symbol === q) score = 100;
        else if (name.startsWith(q) || symbol.startsWith(q)) score = 80;
        else if (name.includes(q) || symbol.includes(q)) score = 60;
        else return null;
        // boost by TVL rank
        score += Math.min(p.tvl / 1e9, 10);
        return { ...p, _score: score };
      })
      .filter(Boolean)
      .sort((a, b) => b._score - a._score)
      .slice(0, 10)
      .map(({ _score, ...p }) => p);

    res.json(scored);
  } catch (err) {
    console.error('[RWA] /search error:', err.message);
    res.json([]);
  }
});

// ── GET /protocol/:slug/detail ──────────────────────────────────────────────
// Enriched protocol detail merging DeFiLlama data with seeded metadata.

let seededMetadata = null;
function getSeededMetadata() {
  if (seededMetadata) return seededMetadata;
  try {
    seededMetadata = require('../data/rwa-protocol-details.json');
  } catch {
    seededMetadata = {};
  }
  return seededMetadata;
}

router.get('/protocol/:slug/detail', async (req, res) => {
  try {
    const { slug } = req.params;
    const now = Date.now();

    const cacheKey = `detail:${slug}`;
    const cached = protocolDetailCache.get(cacheKey);
    if (cached && now - cached.timestamp < PROTOCOL_DETAIL_TTL) {
      return res.json({ ...cached.data, meta: { cached: true, fetchedAt: new Date(cached.timestamp).toISOString() } });
    }

    console.log(`[RWA] Fetching enriched detail: ${slug}`);
    const raw = await fetchJSON(`https://api.llama.fi/protocol/${slug}`);
    const seeded = getSeededMetadata()[slug] || {};

    // Normalize TVL history
    let tvlHistory = [];
    if (Array.isArray(raw.tvl)) {
      tvlHistory = raw.tvl.map(p => ({ date: p.date * 1000, tvl: p.totalLiquidityUSD })).filter(p => p.tvl > 0);
    } else if (raw.chainTvls) {
      const firstKey = Object.keys(raw.chainTvls).find(k => Array.isArray(raw.chainTvls[k]?.tvl));
      if (firstKey) {
        tvlHistory = raw.chainTvls[firstKey].tvl.map(p => ({ date: p.date * 1000, tvl: p.totalLiquidityUSD })).filter(p => p.tvl > 0);
      }
    }

    // Per-chain breakdown
    const chainBreakdown = Object.entries(raw.currentChainTvls || {})
      .map(([chain, tvl]) => ({ chain, tvl }))
      .sort((a, b) => b.tvl - a.tvl);

    const currentTvl = typeof raw.tvl === 'number' ? raw.tvl : (tvlHistory.length ? tvlHistory[tvlHistory.length - 1].tvl : 0);

    const result = {
      name: raw.name, symbol: raw.symbol, logo: raw.logo, url: raw.url,
      twitter: raw.twitter, description: raw.description || seeded.description || null,
      category: raw.category, chains: raw.chains || [],
      currentTvl, change_1d: raw.change_1d, change_7d: raw.change_7d, change_30d: raw.change_30d,
      tvlHistory, chainBreakdown,
      // Seeded metadata fields (DeFiLlama doesn't provide these)
      issuer: seeded.issuer || null,
      fullName: seeded.fullName || null,
      apy_30d: seeded.apy_30d || null,
      investors: seeded.investors || null,
      redemption: seeded.redemption || null,
      min_investment: seeded.min_investment || null,
      mgmt_fee: seeded.mgmt_fee || null,
      inception: seeded.inception || null,
      eligibility: seeded.eligibility || null,
      jurisdiction: seeded.jurisdiction || null,
      auditor: seeded.auditor || null,
    };

    protocolDetailCache.set(cacheKey, { data: result, timestamp: now });
    res.json({ ...result, meta: { cached: false, fetchedAt: new Date(now).toISOString() } });
  } catch (err) {
    console.error(`[RWA] /protocol/${req.params.slug}/detail error:`, err.message);
    res.status(500).json({ error: 'Failed to fetch protocol detail' });
  }
});

// ── GET /analysis/:topic ─────────────────────────────────────────────────────
// AI-generated analysis for RWA subpages (overview, stablecoins, treasuries, etc.)
// Serves cached instantly; triggers background regeneration if stale (>4h).

const VALID_ANALYSIS_TOPICS = new Set([
  'overview', 'stablecoins', 'treasuries', 'credit',
  'commodities', 'networks', 'platforms',
]);

const ANALYSIS_STALE_MS = 23 * 60 * 60 * 1000; // 23h — Daily Edition cadence

// Track in-flight generation to avoid duplicate concurrent regenerations
const analysisInflight = new Set();

function triggerBackgroundRegen(topic, slug) {
  const key = `${topic}:${slug || ''}`;
  if (analysisInflight.has(key)) return;
  analysisInflight.add(key);

  // Lazy require to avoid circular boot order
  let agent;
  try {
    agent = require('../agents/rwaAnalysisAgent');
  } catch (e) {
    analysisInflight.delete(key);
    return;
  }

  (async () => {
    try {
      await agent.generateRwaAnalysis({ topic, slug });
    } catch (e) {
      console.error(`[RWA] Background regen failed for ${key}:`, e.message);
    } finally {
      analysisInflight.delete(key);
    }
  })();
}

router.get('/analysis/protocol/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { loadArticle } = require('../content/store');
    const cached = loadArticle('rwa-analysis', `protocol-${slug}`);

    if (cached) {
      const ageMs = Date.now() - new Date(cached.updatedAt || cached.publishedAt).getTime();
      if (ageMs > ANALYSIS_STALE_MS) {
        triggerBackgroundRegen('protocol', slug);
      }
      return res.json({
        slug,
        topic: 'protocol',
        article: cached.content,
        lastUpdated: cached.updatedAt || cached.publishedAt,
        stale: ageMs > ANALYSIS_STALE_MS,
      });
    }

    // No cache — trigger generation and return 202
    triggerBackgroundRegen('protocol', slug);
    return res.status(202).json({
      slug,
      topic: 'protocol',
      article: null,
      lastUpdated: null,
      stale: true,
      message: 'Analysis being generated',
    });
  } catch (err) {
    console.error(`[RWA] /analysis/protocol/${req.params.slug} error:`, err.message);
    res.status(500).json({ error: 'Failed to fetch protocol analysis' });
  }
});

router.get('/analysis/:topic', async (req, res) => {
  try {
    const { topic } = req.params;
    if (!VALID_ANALYSIS_TOPICS.has(topic)) {
      return res.status(400).json({ error: `Unknown topic. Must be one of: ${[...VALID_ANALYSIS_TOPICS].join(', ')}` });
    }

    const { loadArticle } = require('../content/store');
    const cached = loadArticle('rwa-analysis', topic);

    if (cached) {
      const ageMs = Date.now() - new Date(cached.updatedAt || cached.publishedAt).getTime();
      if (ageMs > ANALYSIS_STALE_MS) {
        triggerBackgroundRegen(topic);
      }
      return res.json({
        slug: topic,
        topic,
        article: cached.content,
        headline: cached.headline || null,
        summary: cached.summary || null,
        ogImage: cached.ogImage ? `/og/${cached.type || 'rwa-analysis'}/${cached.slug}.png` : null,
        publishedAt: cached.publishedAt || cached.updatedAt,
        lastUpdated: cached.updatedAt || cached.publishedAt,
        stale: ageMs > ANALYSIS_STALE_MS,
      });
    }

    // No cache — trigger generation and return 202
    triggerBackgroundRegen(topic);
    return res.status(202).json({
      slug: topic,
      topic,
      article: null,
      headline: null,
      summary: null,
      ogImage: null,
      publishedAt: null,
      lastUpdated: null,
      stale: true,
      message: 'Analysis being generated',
    });
  } catch (err) {
    console.error(`[RWA] /analysis/${req.params.topic} error:`, err.message);
    res.status(500).json({ error: 'Failed to fetch analysis' });
  }
});

// ── /api/rwa/review — comprehensive AI review of the RWA landscape ──────────
// Dev twin of apps/research/api/rwa-review.js. Gathers the live RWA sheet and
// runs ONE structured pass through the server LLM gateway. In-memory cache ~2h
// + single-flight + last-good so bursts never double-spend and a cold LLM never
// blanks the tab. Keep the prompt/sheet in sync with the serverless copy.
const RWA_REVIEW_TTL = 2 * 60 * 60 * 1000;
const rwaReviewCache = { data: null, ts: 0 };
let rwaReviewInflight = null;

const RWA_REVIEW_SYSTEM = `You are a senior real-world-asset (RWA / tokenized-assets) strategist writing a comprehensive desk review for institutional crypto investors. You cover tokenized US treasuries, stablecoins, on-chain private credit, and tokenized commodities.

Write a grounded, decision-useful read of the WHOLE tokenized-assets market from the data sheet provided. Every claim must trace to a number on the sheet — never invent figures or names not present.

Voice: dry, precise, investor-to-investor. BANNED: hype ("massive", "explosive", "game-changer", "moon"), exclamation marks, emojis, hedging filler, and any promise of returns.

Return ONLY valid JSON, no markdown, matching exactly:
{
  "stance": "constructive" | "cautious" | "neutral" | "mixed",
  "headline": "<=90 chars, the one-line takeaway",
  "summary": "2-3 sentences: the overall state of tokenized assets right now",
  "regime": "<=130 chars: the macro/liquidity regime framing RWA flows now",
  "sectors": [
    { "name": "Tokenized Treasuries", "signal": "expanding" | "steady" | "cooling", "read": "1-2 sentences citing the sector TVL and a top name/mover" },
    { "name": "Stablecoins", "signal": "...", "read": "..." },
    { "name": "Private Credit", "signal": "...", "read": "..." },
    { "name": "Commodities", "signal": "...", "read": "..." }
  ],
  "risks": ["2-4 concrete risks, each a short phrase"],
  "opportunities": ["2-4 concrete opportunities, each a short phrase"],
  "catalysts": ["2-4 forward catalysts to watch, each a short phrase"]
}`;

function rwaFmtUsd(n) {
  const v = Number(n); if (!Number.isFinite(v)) return null;
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${Math.round(v)}`;
}

async function buildRwaReview() {
  const [overview, stables, flows] = await Promise.all([
    fetchSpectre('/v1/rwa/overview').catch(() => null),
    fetchSpectre('/v1/rwa/stablecoins-summary').catch(() => null),
    fetchSpectre('/v1/rwa/flows/top?limit=8').catch(() => null),
  ]);
  const data = overview?.data;
  if (!data) return null;
  const cat = data.categories || {};
  const sector = (c) => c ? {
    tvl: rwaFmtUsd(c.tvl), count: c.count,
    top: (c.assets || []).slice(0, 6).map((a) => ({ name: a.name, sym: a.symbol, tvl: rwaFmtUsd(a.tvl), chg24h: a.price_change_24h, chg7d: a.price_change_7d })),
  } : null;
  const sheet = {
    totalTvl: rwaFmtUsd(data.total_rwa_tvl), totalAssets: data.total_assets,
    sectors: { treasuries: sector(cat.treasuries), stablecoins: sector(cat.stablecoins), credit: sector(cat.credit), commodities: sector(cat.commodities) },
    topProtocols: (data.top_protocols || []).slice(0, 8).map((p) => ({ name: p.name || p.platform || p.slug, tvl: rwaFmtUsd(p.tvl ?? p.tvl_usd) })),
    stablecoinSupply: rwaFmtUsd(stables?.total ?? stables?.data?.total ?? cat.stablecoins?.tvl),
    topFlows: Array.isArray(flows?.data) ? flows.data.slice(0, 8) : (Array.isArray(flows) ? flows.slice(0, 8) : null),
  };

  const { chat } = require('../lib/llm-gateway');
  const r = await chat({
    messages: [
      { role: 'system', content: RWA_REVIEW_SYSTEM },
      { role: 'user', content: `RWA DATA SHEET (live):\n${JSON.stringify(sheet, null, 2)}\n\nWrite the comprehensive review as specified.` },
    ],
    tier: 'smart', json: true, maxTokens: 1100, temperature: 0.4, timeoutMs: 30000,
  });
  if (!r.ok || !r.text) return null;
  let parsed = null;
  try { parsed = JSON.parse(r.text); } catch { const m = r.text.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch { parsed = null; } } }
  if (!parsed?.headline) return null;
  const STANCES = new Set(['constructive', 'cautious', 'neutral', 'mixed']);
  const SIGNALS = new Set(['expanding', 'steady', 'cooling']);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const list = (v, n, max) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, n).map((x) => str(x, max)) : []);
  return {
    stance: STANCES.has(parsed.stance) ? parsed.stance : 'neutral',
    headline: str(parsed.headline, 110),
    summary: str(parsed.summary, 500),
    regime: str(parsed.regime, 160),
    sectors: (Array.isArray(parsed.sectors) ? parsed.sectors : []).slice(0, 4).map((x) => ({ name: str(x?.name, 40) || 'Sector', signal: SIGNALS.has(x?.signal) ? x.signal : 'steady', read: str(x?.read, 320) })).filter((x) => x.read),
    risks: list(parsed.risks, 4, 160),
    opportunities: list(parsed.opportunities, 4, 160),
    catalysts: list(parsed.catalysts, 4, 160),
    inputs: { totalTvl: sheet.totalTvl, totalAssets: sheet.totalAssets, treasuries: sheet.sectors.treasuries?.tvl, stablecoins: sheet.stablecoinSupply, credit: sheet.sectors.credit?.tvl, commodities: sheet.sectors.commodities?.tvl, topProtocols: sheet.topProtocols.slice(0, 5) },
    provider: r.provider, generatedAt: new Date().toISOString(),
  };
}

router.get('/review', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=7200');
    if (rwaReviewCache.data && Date.now() - rwaReviewCache.ts < RWA_REVIEW_TTL) {
      return res.json({ review: rwaReviewCache.data, cached: true });
    }
    if (!rwaReviewInflight) {
      rwaReviewInflight = buildRwaReview().finally(() => { rwaReviewInflight = null; });
    }
    const review = await rwaReviewInflight;
    if (!review) {
      if (rwaReviewCache.data) return res.json({ review: rwaReviewCache.data, cached: true, stale: true });
      return res.json({ review: null, error: 'unavailable' });
    }
    rwaReviewCache.data = review; rwaReviewCache.ts = Date.now();
    res.json({ review, cached: false });
  } catch (err) {
    console.error('[RWA] /review error:', err.message);
    if (rwaReviewCache.data) return res.json({ review: rwaReviewCache.data, cached: true, stale: true });
    res.status(502).json({ review: null, error: 'Failed to generate review' });
  }
});

module.exports = router;
module.exports.router = router;
module.exports.getRwaProtocols = getRwaProtocols;
module.exports.getRwaOverview = getRwaOverview;
module.exports.getRwaStablecoins = getRwaStablecoins;
module.exports.getRwaChains = getRwaChains;
module.exports.getRwaTvlHistory = getRwaTvlHistory;
module.exports.getRwaStablecoinHistory = getRwaStablecoinHistory;
module.exports.getRwaBreakdownHistory = getRwaBreakdownHistory;
module.exports.getRwaBreakdown = getRwaBreakdown;
module.exports.getRwaIndex = getRwaIndex;
module.exports.getRwaMovers = getRwaMovers;
module.exports.VALID_ANALYSIS_TOPICS = VALID_ANALYSIS_TOPICS;
