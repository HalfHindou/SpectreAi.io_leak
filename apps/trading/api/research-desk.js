/**
 * Vercel Serverless Function — Research Desk bundle (prod mirror).
 *
 * Serves the dynamic emerging-EVM-DeFi-alpha bundle for the trading app's
 * Research Desk. ZERO paid-API cost (DefiLlama + DexScreener). Mirrors the dev
 * Express route (packages/server/routes/research-desk.js) + the trending
 * dual-runtime convention (codex.js loads .cjs via createRequire).
 *
 * GET /api/research-desk/bundle?tier=core     — emerging-DeFi project bundle (Phase 1)
 * GET /api/research-desk/bundle?tier=sectors  — sector-rotation rows (FREE; reuses /protocols)
 * GET /api/research-desk/bundle?tier=memes    — Solana meme surfaces (reuses the trending engine)
 * GET /api/research-desk/bundle?tier=content  — persisted AI content (prod stub → empty)
 * GET /api/research-desk/bundle  (no tier)    — defaults to tier=core
 *   (rewritten from /api/research-desk/:sub in vercel.json -> ?sub=bundle&tier=...)
 *
 * Prod has NO warmer, so this builds on cache-miss and holds the result in
 * module-level caches (persist across warm Vercel invocations) behind a CDN
 * s-maxage so the edge absorbs most load and cold rebuilds are bounded by TTL.
 *
 * The pipeline libs are loaded as .cjs (createRequire) because apps/trading/
 * package.json declares "type":"module" — a plain .js would be parsed as ESM
 * and its module.exports ignored. research-desk.cjs/research-memes.cjs in turn
 * require the other .cjs mirrors (trending-score.cjs + dexscreener-enrich.cjs).
 *
 * Reuse mechanism (matches dev parity):
 *   - sectors: computeSectorRotation(built.protocols) — the raw /protocols rows
 *     returned by the SAME universe build (no second 8MB fetch).
 *   - memes: handleTrendingTokens (named-exported from ./codex.js, the prod
 *     analogue of dev's module.exports.computeTrendingTokens) over Solana, then
 *     buildMemeSurfaces — ZERO extra Codex selects beyond the shared KV trending cache.
 *   - content: the prod content stub (./_lib/research-desk-content.cjs) → empty.
 */
import { createRequire } from 'module';
import { handleTrendingTokens } from './codex.js';
const _require = createRequire(import.meta.url);
const { buildResearchDeskUniverse, refreshResearchDeskMetrics, computeSectorRotation, selectAlphaMemes } = _require('./_lib/research-desk.cjs');
const { buildMemeSurfaces } = _require('./_lib/research-memes.cjs');
const { readResearchDeckContent } = _require('./_lib/research-desk-content.cjs');
const { buildIntelContent } = _require('./_lib/research-desk-intel.cjs');

const BUNDLE_TTL = 5 * 60 * 1000;       // 5 min — fast metrics tier (core)
const UNIVERSE_TTL = 45 * 60 * 1000;    // 45 min — slow source tier
const SECTORS_TTL = 5 * 60 * 1000;      // 5 min — sector rotation
const MEMES_TTL = 3 * 60 * 1000;        // 3 min — meme surfaces
const CONTENT_TTL = 30 * 60 * 1000;     // 30 min — persisted AI content (stub)

// Solana networkId (Codex internal id) — the memes surface is Solana-only.
const SOLANA_NETWORK_ID = 1399811149;

// Chains the DexScreener fresh-alpha source spans (the sub-$1M alpha layer): the
// DeFi/CG desk core (ETH/Base/Solana) PLUS Arbitrum/Polygon/BSC. Fetched PER CHAIN
// and unioned — the combined multichain board collapses to ~35 Solana-heavy rows
// and starves the EVM low/mid-cap projects that are the real sub-$1M alpha; per-chain
// each board fills toward its own TARGET. Ranking is FREE on Codex and each per-chain
// board rides the shared KV trending cache. Mirrors the dev route.
const ALPHA_TRENDING_NETWORKS = [1, 8453, 1399811149, 42161, 137, 56];
const ALPHA_TRENDING_LIMIT = 60; // per chain

// Injected trending-board fetcher for the alpha source. Reuses handleTrendingTokens
// (the prod analogue of dev's computeTrendingTokens) per chain, unioned (dedup by
// address). Zero extra Codex cost beyond the free ranking. [] on total failure.
async function fetchAlphaTrending() {
  const boards = await Promise.all(ALPHA_TRENDING_NETWORKS.map((net) =>
    handleTrendingTokens([net], '24h', ALPHA_TRENDING_LIMIT)
      .then((r) => (r && r.results) || [])
      .catch(() => [])
  ));
  const byAddr = new Map();
  for (const board of boards) {
    for (const row of (Array.isArray(board) ? board : [])) {
      const a = (row && (row.address || (row.token && row.token.address))) || null;
      const key = a ? String(a).toLowerCase() : null;
      if (key && !byAddr.has(key)) byAddr.set(key, row);
    }
  }
  return [...byAddr.values()];
}

// ── Social-velocity feed (GRACEFUL enrichment for the memes tier) ─────────────
// Mirrors the dev route (packages/server/routes/research-desk.js): the memes tier
// fetches social for its top-N symbols and passes socialBySymbol into
// buildMemeSurfaces. Best-effort — any failure/timeout/missing-key leaves
// socialBySymbol {} so the meme build is byte-for-byte identical to today.
const SPECTRE_DATA_ORIGIN = process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850';
const SPECTRE_DATA_KEY = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY || '';
const SOCIAL_TOP_N = 12;          // cap symbols we fetch — bounded fan-out
const SOCIAL_PER_REQ_MS = 2000;   // per-symbol upstream timeout
const SOCIAL_TOTAL_MS = 2500;     // hard wall-clock cap on the whole social step

function memeSymbolOf(row) {
  const t = (row && row.token) || {};
  const sym = String((row && row.symbol) || t.symbol || '').replace(/^\$/, '').trim().toUpperCase();
  return sym || null;
}

function mapSocialPayload(json) {
  const data = (json && json.data) || {};
  const totals = data.totals || {};
  const mentions = Number(totals.mentions) || 0;
  if (mentions <= 0) return null;                 // no real data -> omit (graceful)
  const distinctAuthors = Number(totals.distinct_authors) || 0;
  let velocity = null;
  if (Array.isArray(data.velocity) && data.velocity.length) {
    const last = data.velocity[data.velocity.length - 1];
    const v = (last && (last.value ?? last.count ?? last.mentions ?? last.velocity));
    if (v != null && Number.isFinite(Number(v))) velocity = Number(v);
  }
  let sentiment = null;
  if (Array.isArray(data.by_sentiment) && data.by_sentiment.length) {
    const top = [...data.by_sentiment].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))[0];
    if (top && typeof top.sentiment === 'string') sentiment = top.sentiment;
  }
  return { mentions, distinctAuthors, velocity, sentiment };
}

async function fetchSocialForSymbol(symbol) {
  try {
    const url = `${SPECTRE_DATA_ORIGIN}/v1/social/mentions/${encodeURIComponent(symbol)}?since=1440&limit=80`;
    const r = await fetch(url, {
      headers: { 'X-API-Key': SPECTRE_DATA_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(SOCIAL_PER_REQ_MS),
    });
    if (!r.ok) return [symbol, null];
    const json = await r.json().catch(() => null);
    return [symbol, mapSocialPayload(json)];
  } catch (_) { return [symbol, null]; }
}

async function buildSocialBySymbol(trending) {
  if (!SPECTRE_DATA_KEY) return {};                // no upstream key -> graceful {}
  const symbols = [];
  const seen = new Set();
  for (const row of (Array.isArray(trending) ? trending : [])) {
    const sym = memeSymbolOf(row);
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    symbols.push(sym);
    if (symbols.length >= SOCIAL_TOP_N) break;
  }
  if (symbols.length === 0) return {};
  try {
    const settled = await Promise.race([
      Promise.allSettled(symbols.map(fetchSocialForSymbol)),
      new Promise((resolve) => setTimeout(() => resolve(null), SOCIAL_TOTAL_MS)),
    ]);
    if (!settled) return {};                        // total cap hit -> graceful {}
    const out = {};
    for (const s of settled) {
      if (s.status === 'fulfilled' && Array.isArray(s.value)) {
        const [sym, entry] = s.value;
        if (sym && entry) out[sym] = entry;
      }
    }
    return out;
  } catch (_) { return {}; }
}

// Module-level caches (persist across warm Vercel invocations). The universe
// cache also holds the RAW /protocols array off the same build (sectors tier).
let universeCache = { data: null, protocols: null, ts: 0, refreshedAt: null };
let bundleCache = { data: null, ts: 0 };
let sectorsCache = { data: null, ts: 0 };
let memesCache = { data: null, ts: 0 };
let contentCache = { data: null, ts: 0 };
let _universeInflight = null;
let _bundleInflight = null;
let _sectorsInflight = null;
let _memesInflight = null;
let _contentInflight = null;

async function getUniverse() {
  if (universeCache.data && Date.now() - universeCache.ts < UNIVERSE_TTL) return universeCache.data;
  if (_universeInflight) return _universeInflight;
  _universeInflight = (async () => {
    // Inject the trending-board fetcher so the universe includes the DexScreener
    // fresh-alpha tokens (the sub-$1M layer). selectAlphaTokens MEME-FILTERS the
    // board (isMemeToken) so ONLY real micro-PROJECTS reach Projects; the meme
    // subset is routed to the Memes tier instead (getMemes). Graceful: a trending
    // failure inside the lib leaves the alpha source empty (DeFi + CG only).
    const built = await buildResearchDeskUniverse({ fetchAlphaTokens: fetchAlphaTrending });
    universeCache = {
      data: built.universe,
      protocols: built.protocols || null, // raw /protocols (sectors tier reuse)
      ts: Date.now(),
      refreshedAt: built.refreshedAt,
    };
    return built.universe;
  })()
    .catch((err) => {
      console.error('[research-desk] universe:', err.message);
      return universeCache.data || [];
    })
    .finally(() => { _universeInflight = null; });
  return _universeInflight;
}

async function getBundle() {
  if (bundleCache.data && Date.now() - bundleCache.ts < BUNDLE_TTL) return bundleCache.data;
  if (_bundleInflight) return _bundleInflight;
  _bundleInflight = (async () => {
    const universe = await getUniverse();
    const projects = await refreshResearchDeskMetrics(universe);
    const payload = {
      projects,
      meta: {
        cached: false,
        fetchedAt: new Date().toISOString(),
        ttlMs: BUNDLE_TTL,
        tier: 'core',
        count: projects.length,
        universeRefreshedAt: universeCache.refreshedAt,
        sources: ['defillama-protocols', 'defillama-fees', 'coingecko-emerging', 'codex-trending', 'dexscreener'],
      },
    };
    bundleCache = { data: payload, ts: Date.now() };
    return payload;
  })()
    .finally(() => { _bundleInflight = null; });
  return _bundleInflight;
}

async function getSectors() {
  if (sectorsCache.data && Date.now() - sectorsCache.ts < SECTORS_TTL) return sectorsCache.data;
  if (_sectorsInflight) return _sectorsInflight;
  _sectorsInflight = (async () => {
    if (!universeCache.protocols) await getUniverse();
    const protocols = universeCache.protocols || [];
    const sectors = computeSectorRotation(protocols);
    const payload = {
      sectors,
      meta: {
        cached: false,
        fetchedAt: new Date().toISOString(),
        ttlMs: SECTORS_TTL,
        tier: 'sectors',
        count: sectors.length,
        universeRefreshedAt: universeCache.refreshedAt,
        sources: ['defillama-protocols'],
      },
    };
    sectorsCache = { data: payload, ts: Date.now() };
    return payload;
  })()
    .finally(() => { _sectorsInflight = null; });
  return _sectorsInflight;
}

async function getMemes() {
  if (memesCache.data && Date.now() - memesCache.ts < MEMES_TTL) return memesCache.data;
  if (_memesInflight) return _memesInflight;
  _memesInflight = (async () => {
    // handleTrendingTokens(networkIds, timeframe, limit) -> { results } — the
    // SAME engine /api/codex?action=trending uses (shared KV cache, zero extra cost).
    let solana = [];
    try {
      const r = await handleTrendingTokens([SOLANA_NETWORK_ID], '24h', 100);
      solana = (r && r.results) || [];
    } catch (err) {
      console.error('[research-desk] memes trending:', err.message);
    }
    // The MEME-classified subset of the multi-chain alpha board (same fetch the
    // Projects universe uses; split by isMemeToken) — adds fresh multi-chain memes
    // (ETH/Base/BSC/Arb/Polygon) on top of the Solana board. Graceful -> [] on fail.
    const alphaBoard = await fetchAlphaTrending().catch(() => []);
    const alphaMemes = selectAlphaMemes(alphaBoard);
    // Union (dedup by address) — Solana board first (the established source).
    const seenAddr = new Set();
    const trending = [];
    for (const row of [...solana, ...alphaMemes]) {
      const a = (row && (row.address || (row.token && row.token.address))) || null;
      const key = a ? String(a).toLowerCase() : null;
      if (key && seenAddr.has(key)) continue;
      if (key) seenAddr.add(key);
      trending.push(row);
    }
    const socialBySymbol = await buildSocialBySymbol(trending).catch(() => ({}));
    const surfaces = buildMemeSurfaces(trending, socialBySymbol);
    const payload = {
      memes: surfaces, // nested under `memes` to match the tier key (like core -> projects)
      meta: {
        cached: false,
        fetchedAt: new Date().toISOString(),
        ttlMs: MEMES_TTL,
        tier: 'memes',
        counts: {
          dealFlow: (surfaces.dealFlow || []).length,
          scorecards: (surfaces.scorecards || []).length,
          trends: (surfaces.trends || []).length,
          theses: (surfaces.theses || []).length,
        },
        sources: ['codex-trending', 'codex-trending-multichain', 'dexscreener'],
      },
    };
    memesCache = { data: payload, ts: Date.now() };
    return payload;
  })()
    .finally(() => { _memesInflight = null; });
  return _memesInflight;
}

async function getContent() {
  if (contentCache.data && Date.now() - contentCache.ts < CONTENT_TTL) return contentCache.data;
  if (_contentInflight) return _contentInflight;
  _contentInflight = (async () => {
    // AI thesis/pitch from the platform's WORKING AI (Spectre intelligence crawler),
    // enriching the top published projects. Reuses the same upstream AI Dossier uses.
    const bundle = await getBundle();
    const projects = Array.isArray(bundle && bundle.projects) ? bundle.projects : [];
    const content = (await buildIntelContent(projects).catch(() => null)) || { theses: {}, pitches: {} };
    const payload = {
      content: { theses: content.theses || {}, pitches: content.pitches || {} },
      meta: {
        cached: false,
        fetchedAt: new Date().toISOString(),
        ttlMs: CONTENT_TTL,
        tier: 'content',
        counts: {
          theses: Object.keys(content.theses || {}).length,
          pitches: Object.keys(content.pitches || {}).length,
        },
        universeRefreshedAt: universeCache.refreshedAt,
      },
    };
    contentCache = { data: payload, ts: Date.now() };
    return payload;
  })()
    .finally(() => { _contentInflight = null; });
  return _contentInflight;
}

// Per-tier config: cache cell, builder, TTL, empty fallback.
const TIERS = {
  core:    { get: () => bundleCache,  build: getBundle,  ttl: BUNDLE_TTL,  empty: { projects: [] } },
  sectors: { get: () => sectorsCache, build: getSectors, ttl: SECTORS_TTL, empty: { sectors: [] } },
  memes:   { get: () => memesCache,   build: getMemes,   ttl: MEMES_TTL,   empty: { memes: { dealFlow: [], scorecards: [], trends: [], theses: [] } } },
  content: { get: () => contentCache, build: getContent, ttl: CONTENT_TTL, empty: { content: { theses: {}, pitches: {} } } },
};

export default async function handler(req, res) {
  res.setHeader(
    'Access-Control-Allow-Origin',
    ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : ''
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // vercel.json rewrites /api/research-desk/:sub -> ?sub=:sub. Only 'bundle' exists.
  const sub = String(req.query?.sub || 'bundle').toLowerCase();
  if (sub !== 'bundle') return res.status(404).json({ error: 'Not found' });

  const tier = String(req.query?.tier || 'core').toLowerCase();
  const cfg = TIERS[tier];
  if (!cfg) {
    return res.status(400).json({
      ...TIERS.core.empty,
      meta: { cached: false, error: `Unknown tier '${tier}'`, tier, count: 0 },
    });
  }

  // s-maxage matches the in-memory TTL (seconds); SWR is 2x. Same for CDN.
  const sMax = Math.round(cfg.ttl / 1000);
  const cacheControl = `public, s-maxage=${sMax}, stale-while-revalidate=${sMax * 2}`;

  // Serve from warm module cache when fresh.
  const cell = cfg.get();
  if (cell.data && Date.now() - cell.ts < cfg.ttl) {
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('CDN-Cache-Control', cacheControl);
    return res.status(200).json({ ...cell.data, meta: { ...(cell.data.meta || {}), cached: true } });
  }

  try {
    const payload = await cfg.build();
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('CDN-Cache-Control', cacheControl);
    return res.status(200).json(payload);
  } catch (err) {
    console.error(`[research-desk] ${tier} error:`, err.message);
    // Serve stale cache if available.
    const stale = cfg.get();
    if (stale.data) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60');
      return res.status(200).json({ ...stale.data, meta: { ...(stale.data.meta || {}), cached: true, stale: true } });
    }
    return res.status(502).json({
      ...cfg.empty,
      meta: { cached: false, error: `Failed to build Research Desk ${tier}`, tier, count: 0 },
    });
  }
}
