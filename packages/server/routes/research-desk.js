/**
 * Spectre Intelligence Hub — Research Desk Routes
 *
 * Serves a dynamic, auto-updating feed of emerging EVM-DeFi-alpha projects for
 * the trading app's Research Desk (Discover page). ZERO paid-API cost —
 * DefiLlama + DexScreener only. Mirrors the RWA bundle architecture
 * (routes/rwa.js) + the trending dual-runtime convention (lib/trending-score.js
 * <-> apps/trading/api/_lib/trending-score.cjs).
 *
 * GET /api/research-desk/bundle?tier=core     — ranked emerging-DeFi project bundle (Phase 1)
 * GET /api/research-desk/bundle?tier=sectors  — sector-rotation rows (FREE; reuses /protocols)
 * GET /api/research-desk/bundle?tier=memes    — Solana meme surfaces (reuses the trending engine)
 * GET /api/research-desk/bundle?tier=content  — persisted AI thesis/pitch over the universe
 * GET /api/research-desk/bundle  (no tier)    — defaults to tier=core (back-compat)
 *
 * The route holds a multi-tier in-memory state (a slow "universe" of qualified
 * protocols + the raw /protocols rows, a fast "metrics" refresh, sector rotation,
 * meme surfaces, and persisted AI content). A request never re-sources the 8MB
 * DefiLlama /protocols on a cache miss — the sectors tier reuses the array the
 * universe build already holds, and the memes tier reuses the trending engine's
 * own cache (ZERO extra Codex selects). The warmer (agents/researchDeskWarmer.js)
 * calls the exported builder helpers directly to keep the tiers hot (no HTTP hop).
 */
const express = require('express');
const router = express.Router();

const {
  buildResearchDeskUniverse,
  refreshResearchDeskMetrics,
  computeSectorRotation,
  selectAlphaMemes,
} = require('../lib/research-desk');
const { buildMemeSurfaces } = require('../lib/research-memes');
const { readResearchDeckContent } = require('../agents/researchDeskContent');
const { buildIntelContent } = require('../lib/research-desk-intel');

// ── In-memory state ──────────────────────────────────────────────────────────

const BUNDLE_TTL = 5 * 60 * 1000;        // 5 min — fast metrics tier (core)
const UNIVERSE_TTL = 45 * 60 * 1000;     // 45 min — slow source tier
const SECTORS_TTL = 5 * 60 * 1000;       // 5 min — sector rotation (slow-moving TVL aggregates)
const MEMES_TTL = 3 * 60 * 1000;         // 3 min — meme surfaces (2-5min band per spec)
const CONTENT_TTL = 30 * 60 * 1000;      // 30 min — persisted AI content (changes ~weekly)

// Solana networkId (Codex internal id) — the memes surface is Solana-only.
const SOLANA_NETWORK_ID = 1399811149;

// Chains the DexScreener fresh-alpha source spans (the sub-$1M alpha layer): the
// DeFi/CG desk core (ETH/Base/Solana) PLUS Arbitrum/Polygon/BSC where fresh on-chain
// projects also launch. We fetch the trending board PER CHAIN and union the rows
// (deduped by address): the COMBINED multichain board collapses to ~35 Solana-heavy
// rows (each chain's TARGET-fill competes in one list), starving the EVM low/mid-cap
// projects that are the real sub-$1M alpha. Per-chain, each board independently
// fills toward its own TARGET, surfacing far more sub-$5M EVM candidates. Ranking is
// FREE on Codex (no billable field selected) and each per-chain board is cached by
// the trending engine + shared with per-chain /api/tokens/trending — so this is 6
// free-ranking queries on the SLOW (45-min) universe loop only, not per request.
const ALPHA_TRENDING_NETWORKS = [1, 8453, 1399811149, 42161, 137, 56];
const ALPHA_TRENDING_LIMIT = 60; // per chain

// Build the injected trending-board fetcher for the alpha source. Lazy-requires
// computeTrendingTokens to avoid the load-time circular require (index -> warmer ->
// this route -> index), exactly like getMemes. Fetches per-chain in parallel and
// unions (dedup by token address); [] on total failure (alpha source degrades away).
async function fetchAlphaTrending() {
  const { computeTrendingTokens } = require('../index');
  const boards = await Promise.all(ALPHA_TRENDING_NETWORKS.map((net) =>
    computeTrendingTokens({ networks: String(net), limit: ALPHA_TRENDING_LIMIT, timeframe: '24h' })
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
// Forwards to the SAME upstream the dev /api/social/mentions route uses. The
// memes tier fetches social for its top-N symbols and passes socialBySymbol into
// buildMemeSurfaces. EVERYTHING here is best-effort: any failure/timeout leaves
// socialBySymbol {} so the meme build is byte-for-byte identical to today. In
// this dev worktree the upstream X feed is unauthed -> totals.mentions:0, so the
// real numbers only light up in prod; here we verify ZERO regression.
const SPECTRE_DATA_ORIGIN = process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850';
const SPECTRE_DATA_KEY = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY || '';
const SOCIAL_TOP_N = 12;          // cap symbols we fetch (<= meme caps) — bounded fan-out
const SOCIAL_PER_REQ_MS = 2000;   // per-symbol upstream timeout
const SOCIAL_TOTAL_MS = 2500;     // hard wall-clock cap on the whole social step

// Normalize a trending row -> UPPERCASE symbol (mirrors lib identityOf, no '$').
function memeSymbolOf(row) {
  const t = (row && row.token) || {};
  const sym = String((row && row.symbol) || t.symbol || '').replace(/^\$/, '').trim().toUpperCase();
  return sym || null;
}

// Map one upstream /v1/social/mentions payload -> { mentions, distinctAuthors,
// velocity, sentiment } | null. Returns null when the feed has no real mentions
// (the dev fallback) so the symbol is simply absent from socialBySymbol.
function mapSocialPayload(json) {
  const data = (json && json.data) || {};
  const totals = data.totals || {};
  const mentions = Number(totals.mentions) || 0;
  if (mentions <= 0) return null;                 // no real data -> omit (graceful)
  const distinctAuthors = Number(totals.distinct_authors) || 0;
  // velocity: array of points (per-hr trend). Use the LAST point's value as the
  // current per-hr velocity; sign drives socialTrend. Absent/empty -> null.
  let velocity = null;
  if (Array.isArray(data.velocity) && data.velocity.length) {
    const last = data.velocity[data.velocity.length - 1];
    const v = (last && (last.value ?? last.count ?? last.mentions ?? last.velocity));
    if (v != null && Number.isFinite(Number(v))) velocity = Number(v);
  }
  // sentiment (optional): pick the dominant by_sentiment bucket label if present.
  let sentiment = null;
  if (Array.isArray(data.by_sentiment) && data.by_sentiment.length) {
    const top = [...data.by_sentiment].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))[0];
    if (top && typeof top.sentiment === 'string') sentiment = top.sentiment;
  }
  return { mentions, distinctAuthors, velocity, sentiment };
}

// Fetch social for a single symbol via the SPECTRE_DATA upstream. Never throws —
// returns [symbol, entry|null]. Bounded by SOCIAL_PER_REQ_MS.
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

// Build socialBySymbol over the top-N trending meme symbols. GRACEFUL: missing
// key, total-timeout, or all-failures -> {} (the meme build then matches today).
// The result rides the memesState cache (called inside getMemes), so this is NOT
// an uncached per-request fan-out.
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
    // Race the whole fan-out against a hard wall-clock cap so a slow upstream
    // can NEVER materially delay the meme build — on cap we proceed with {}.
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

// Qualified-universe cache (slow tier). The warmer refreshes this; the route
// rebuilds it lazily if it's stale and the warmer hasn't run yet. We also cache
// the RAW /protocols array off the SAME build so the sectors tier never re-fetches.
const universeState = { data: null, protocols: null, ts: 0, refreshedAt: null, sourceCount: 0 };
// Published bundle cache (fast tier).
const bundleState = { core: null, ts: 0 };
// Sector-rotation cache.
const sectorsState = { data: null, ts: 0 };
// Meme-surfaces cache.
const memesState = { data: null, ts: 0 };
// AI-content cache.
const contentState = { data: null, ts: 0 };

let _universeInflight = null;
let _metricsInflight = null;
let _sectorsInflight = null;
let _memesInflight = null;
let _contentInflight = null;

// Defensive wrapper — individual failures land as null so the route still
// responds with partial/empty data rather than 500ing (mirrors rwa.js `safe`).
async function safe(label, fn) {
  try { return await fn(); }
  catch (err) { console.error(`[ResearchDesk] ${label}:`, err.message); return null; }
}

/**
 * Get the qualified universe, rebuilding (deduped via inflight) when stale.
 * Caches the RAW /protocols array off the same build (for the sectors tier).
 * Exported so the warmer can refresh it directly.
 */
async function getUniverse(force = false) {
  if (!force && universeState.data && Date.now() - universeState.ts < UNIVERSE_TTL) {
    return universeState.data;
  }
  if (_universeInflight) return _universeInflight;
  _universeInflight = (async () => {
    // Inject the trending-board fetcher so the universe includes the DexScreener
    // fresh-alpha tokens (the sub-$1M layer). selectAlphaTokens MEME-FILTERS the
    // board (isMemeToken) so ONLY real micro-PROJECTS reach Projects; the meme
    // subset is routed to the Memes tier instead (getMemes). Graceful: a trending
    // failure inside the lib leaves the alpha source empty (DeFi + CG only).
    const built = await buildResearchDeskUniverse({ fetchAlphaTokens: fetchAlphaTrending });
    universeState.data = built.universe;
    universeState.protocols = built.protocols || null; // raw /protocols (sectors tier)
    universeState.ts = Date.now();
    universeState.refreshedAt = built.refreshedAt;
    universeState.sourceCount = built.sourceCount;
    return built.universe;
  })()
    .catch((err) => {
      console.error('[ResearchDesk] getUniverse:', err.message);
      // Keep the last good universe on failure rather than wiping it.
      return universeState.data || [];
    })
    .finally(() => { _universeInflight = null; });
  return _universeInflight;
}

/**
 * Refresh the published bundle (fast metrics tier) over the current universe.
 * Exported so the warmer can publish directly into the route cache.
 */
async function getBundle(force = false) {
  if (!force && bundleState.core && Date.now() - bundleState.ts < BUNDLE_TTL) {
    return bundleState.core;
  }
  if (_metricsInflight) return _metricsInflight;
  _metricsInflight = (async () => {
    const universe = (await safe('universe', () => getUniverse())) || [];
    const projects = (await safe('metrics', () => refreshResearchDeskMetrics(universe))) || [];
    const payload = {
      projects,
      meta: {
        cached: false,
        fetchedAt: new Date().toISOString(),
        ttlMs: BUNDLE_TTL,
        tier: 'core',
        count: projects.length,
        universeRefreshedAt: universeState.refreshedAt,
        sources: ['defillama-protocols', 'defillama-fees', 'coingecko-emerging', 'codex-trending', 'dexscreener'],
      },
    };
    bundleState.core = payload;
    bundleState.ts = Date.now();
    return payload;
  })()
    .finally(() => { _metricsInflight = null; });
  return _metricsInflight;
}

/**
 * Build the sector-rotation tier from the RAW /protocols the universe build
 * already fetched (NO re-fetch, NO Codex). Exported for the warmer.
 */
async function getSectors(force = false) {
  if (!force && sectorsState.data && Date.now() - sectorsState.ts < SECTORS_TTL) {
    return sectorsState.data;
  }
  if (_sectorsInflight) return _sectorsInflight;
  _sectorsInflight = (async () => {
    // Ensure the universe (and thus the raw /protocols array) is populated.
    if (!universeState.protocols) await safe('universe', () => getUniverse());
    const protocols = universeState.protocols || [];
    const sectors = (await safe('sectors', () => computeSectorRotation(protocols))) || [];
    const payload = {
      sectors,
      meta: {
        cached: false,
        fetchedAt: new Date().toISOString(),
        ttlMs: SECTORS_TTL,
        tier: 'sectors',
        count: sectors.length,
        universeRefreshedAt: universeState.refreshedAt,
        sources: ['defillama-protocols'],
      },
    };
    sectorsState.data = payload;
    sectorsState.ts = Date.now();
    return payload;
  })()
    .finally(() => { _sectorsInflight = null; });
  return _sectorsInflight;
}

/**
 * Build the meme surfaces from the Solana trending set PLUS the MEME subset of the
 * multi-chain alpha board (the other half of the isMemeToken split — so fresh memes
 * like TRASHCAN/MEEP/CATWIF on ANY chain now appear in Memes, not just Solana).
 * Reuses the SHARED trending engine (index.js computeTrendingTokens) so this costs
 * ZERO extra Codex selects beyond the trending caches it already shares. Both are
 * lazy-required to avoid a load-time circular require (index -> warmer -> this route
 * -> index). Exported for the warmer.
 */
async function getMemes(force = false) {
  if (!force && memesState.data && Date.now() - memesState.ts < MEMES_TTL) {
    return memesState.data;
  }
  if (_memesInflight) return _memesInflight;
  _memesInflight = (async () => {
    // Lazy require breaks the load-time cycle (index requires the warmer at boot).
    const { computeTrendingTokens } = require('../index');
    const solana = (await safe('trending', () => computeTrendingTokens({
      networks: String(SOLANA_NETWORK_ID),
      limit: 100,
      timeframe: '24h',
    }))) || [];
    // The MEME-classified subset of the multi-chain alpha board (same fetch the
    // Projects universe uses; split by isMemeToken). Adds fresh multi-chain memes
    // (ETH/Base/BSC/Arb/Polygon) on top of the Solana board. Graceful -> [] on fail.
    const alphaBoard = (await safe('alpha-trending', () => fetchAlphaTrending())) || [];
    const alphaMemes = selectAlphaMemes(alphaBoard);
    // Union (dedup by address) — Solana board first (it's the established source).
    const seenAddr = new Set();
    const trending = [];
    for (const row of [...solana, ...alphaMemes]) {
      const a = (row && (row.address || (row.token && row.token.address))) || null;
      const key = a ? String(a).toLowerCase() : null;
      if (key && seenAddr.has(key)) continue;
      if (key) seenAddr.add(key);
      trending.push(row);
    }
    // GRACEFUL social enrichment (best-effort, bounded). Any failure -> {} so the
    // surfaces match the pre-social build exactly. Rides this memesState cache.
    const socialBySymbol = (await safe('social', () => buildSocialBySymbol(trending))) || {};
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
    memesState.data = payload;
    memesState.ts = Date.now();
    return payload;
  })()
    .finally(() => { _memesInflight = null; });
  return _memesInflight;
}

/**
 * Read persisted AI thesis/pitch content over the current universe symbols.
 * Pure on-disk read (no AI generation here — the warmer generates on its slow
 * cadence). Exported for the warmer.
 */
async function getContent(force = false) {
  if (!force && contentState.data && Date.now() - contentState.ts < CONTENT_TTL) {
    return contentState.data;
  }
  if (_contentInflight) return _contentInflight;
  _contentInflight = (async () => {
    // AI thesis/pitch from the platform's WORKING AI (the Spectre intelligence
    // crawler), enriching the top published projects. Local LLMs are billing-dead,
    // so we reuse the same upstream AI Dossier/token-intel uses. Graceful.
    const bundle = (await safe('bundle', () => getBundle())) || {};
    const projects = Array.isArray(bundle.projects) ? bundle.projects : [];
    const content = (await safe('intel-content', () => buildIntelContent(projects))) || { theses: {}, pitches: {} };
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
        universeRefreshedAt: universeState.refreshedAt,
      },
    };
    contentState.data = payload;
    contentState.ts = Date.now();
    return payload;
  })()
    .finally(() => { _contentInflight = null; });
  return _contentInflight;
}

// ── GET /bundle ──────────────────────────────────────────────────────────────

// Per-tier dispatch: each tier is independently cached + served. Omitting `tier`
// returns tier=core behavior (back-compat).
router.get('/bundle', async (req, res) => {
  const tier = String(req.query.tier || 'core').toLowerCase();

  // Tier config: in-memory state, builder, fresh-window, and Cache-Control.
  const TIERS = {
    core:    { state: bundleState,  build: getBundle,  ttl: BUNDLE_TTL,   empty: { projects: [] } },
    sectors: { state: sectorsState, build: getSectors, ttl: SECTORS_TTL,  empty: { sectors: [] } },
    memes:   { state: memesState,   build: getMemes,   ttl: MEMES_TTL,    empty: { memes: { dealFlow: [], scorecards: [], trends: [], theses: [] } } },
    content: { state: contentState, build: getContent, ttl: CONTENT_TTL,  empty: { content: { theses: {}, pitches: {} } } },
  };

  const cfg = TIERS[tier];
  if (!cfg) {
    return res.status(400).json({
      ...TIERS.core.empty,
      meta: { cached: false, error: `Unknown tier '${tier}'`, tier, count: 0 },
    });
  }

  // s-maxage matches the in-memory TTL (seconds); SWR is 2x.
  const sMax = Math.round(cfg.ttl / 1000);
  const cacheControl = `public, s-maxage=${sMax}, stale-while-revalidate=${sMax * 2}`;

  // Serve from the warm tier cache when fresh.
  const cached = tier === 'core' ? cfg.state.core : cfg.state.data;
  if (cached && Date.now() - cfg.state.ts < cfg.ttl) {
    res.setHeader('Cache-Control', cacheControl);
    return res.json({ ...cached, meta: { ...(cached.meta || {}), cached: true } });
  }

  const payload = await safe(`bundle:${tier}`, () => cfg.build());
  if (!payload) {
    return res.status(502).json({
      ...cfg.empty,
      meta: { cached: false, error: `Failed to build Research Desk ${tier}`, tier, count: 0 },
    });
  }
  res.setHeader('Cache-Control', cacheControl);
  res.json(payload);
});

module.exports = router;
module.exports.router = router;
// Exported for the warmer (direct calls, no HTTP hop).
module.exports.getUniverse = getUniverse;
module.exports.getBundle = getBundle;
module.exports.getSectors = getSectors;
module.exports.getMemes = getMemes;
module.exports.getContent = getContent;
