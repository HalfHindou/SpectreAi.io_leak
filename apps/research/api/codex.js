/**
 * Vercel Serverless Function - Codex API Proxy
 * Handles all token data requests
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  SYMBOL_TO_COINGECKO_ID,
  POPULAR_SOLANA_TOKENS,
  WELL_KNOWN_TOKENS,
  KNOWN_TOKEN_ADDRESSES,
  CODEX_NETWORKS,
  TOKEN_REGISTRY,
} = require('../../../packages/server/lib/token-registry');
const codexMetricsKv = require('../../../packages/server/lib/codex-metrics-kv');

// API Keys from environment variables (set in Vercel dashboard)
const CODEX_API_KEY = process.env.CODEX_API_KEY;
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
const CODEX_BASE_URL = 'https://graph.codex.io/graphql';
// Codex key is origin-restricted (allowlist). Server-to-server calls send no
// Origin -> "unauthorized origin: undefined", so present the allowed origin.
// Override via CODEX_ORIGIN env if the allowlist changes.
const CODEX_ORIGIN = process.env.CODEX_ORIGIN || 'https://app.spectreai.io';
const COINGECKO_BASE_URL = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';

// CG /search lookup with TTL cache. Maps a ticker symbol ("HYPE", "XMR")
// to the canonical CG slug ("hyperliquid", "monero") when the hardcoded
// map misses. Memoised at module level - each warm function instance pays
// the lookup once per symbol for 6 hours.
const _cgSlugCache = new Map();
async function resolveCgSlugFromSymbol(symbol) {
  if (!symbol) return null;
  const key = String(symbol).trim().toUpperCase();
  if (!key) return null;
  const cached = _cgSlugCache.get(key);
  if (cached && Date.now() - cached.ts < 6 * 60 * 60 * 1000) return cached.slug;
  try {
    const url = `${COINGECKO_BASE_URL}/search?query=${encodeURIComponent(key)}`;
    const opts = { headers: { Accept: 'application/json' } };
    if (COINGECKO_API_KEY) opts.headers['x-cg-pro-api-key'] = COINGECKO_API_KEY;
    const r = await fetch(url, opts);
    if (!r.ok) return null;
    const json = await r.json();
    const coins = Array.isArray(json?.coins) ? json.coins : [];
    const exact = coins.filter((c) => String(c.symbol || '').toUpperCase() === key);
    const ranked = exact.filter((c) => Number.isFinite(c.market_cap_rank));
    let pick = null;
    if (ranked.length) {
      ranked.sort((a, b) => a.market_cap_rank - b.market_cap_rank);
      pick = ranked[0];
    } else if (exact.length) {
      pick = exact[0];
    } else if (coins.length) {
      pick = coins[0];
    }
    const slug = pick?.id || null;
    if (slug) _cgSlugCache.set(key, { slug, ts: Date.now() });
    return slug;
  } catch (_) {
    return null;
  }
}

async function fetchCoinGeckoPrice(symbol) {
  const upper = (symbol || '').toUpperCase();
  const id = SYMBOL_TO_COINGECKO_ID[upper];
  if (!id) return null;
  try {
    const url = `${COINGECKO_BASE_URL}/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true`;
    const opts = { headers: {} };
    if (COINGECKO_API_KEY) opts.headers['x-cg-pro-api-key'] = COINGECKO_API_KEY;
    const res = await fetch(url, opts);
    if (!res.ok) return null;
    const data = await res.json();
    const p = data[id];
    if (!p || p.usd == null) return null;
    return {
      price: parseFloat(p.usd) || 0,
      change: parseFloat(p.usd_24h_change) || 0,
      change24: parseFloat(p.usd_24h_change) || 0,
    };
  } catch (e) {
    console.error(`CoinGecko fallback for ${symbol}:`, e.message);
    return null;
  }
}

const ALL_NETWORK_IDS = Object.keys(CODEX_NETWORKS).map(n => parseInt(n));

// Extract operation name from a GraphQL query string for metrics
function _extractOperation(query) {
  if (!query) return 'unknown';
  const m = query.match(/^\s*(?:query|mutation|subscription)\s+(\w+)/);
  return m ? m[1] : (query.match(/\b(getTokenBars|filterTokens|listPairsForToken|getTokenEvents|token)\b/)?.[1] || 'unknown');
}

async function executeCodexQuery(query, variables = {}) {
  if (!CODEX_API_KEY) {
    throw new Error('CODEX_API_KEY environment variable is not set');
  }

  const startTime = Date.now();
  const operation = _extractOperation(query);
  let errored = false;

  try {
    const response = await fetch(CODEX_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': CODEX_API_KEY,
        'Origin': CODEX_ORIGIN,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      errored = true;
      throw new Error(`Codex API HTTP error: ${response.status}`);
    }

    const data = await response.json();

    if (data.errors) {
      errored = true;
      console.error('Codex GraphQL errors:', JSON.stringify(data.errors));
      throw new Error(data.errors[0]?.message || 'GraphQL error');
    }

    return data.data;
  } catch (err) {
    errored = true;
    throw err;
  } finally {
    try { codexMetricsKv.trackQuery(operation, Date.now() - startTime, errored, 'prod-research'); } catch {}
  }
}

/**
 * Smart quality scoring function - ranks tokens by legitimacy
 * Filters out scams, honeypots, and dead tokens
 */
function calculateQualityScore(result, searchTerm = '') {
  let score = 0;
  
  const mcap = parseFloat(result.marketCap) || 0;
  const liq = parseFloat(result.liquidity) || 0;
  const volume = parseFloat(result.volume24 || result.volume) || 0;
  const holders = parseInt(result.holders) || 0;
  const price = parseFloat(result.priceUSD) || 0;
  const symbol = (result.token?.symbol || '').toLowerCase();
  const name = (result.token?.name || '').toLowerCase();
  const search = (searchTerm || '').toLowerCase();
  
  // "No data" is NOT "dust" (2026-08-14, mirrors the trading-app fix): the
  // slim search selection drops liquidity, and the budgeted backfill can
  // starve - judge liq/mcap only when the row actually carries them, so
  // un-backfilled rows rank LOW instead of vanishing (-1000) wholesale.
  const hasLiq = liq > 0;
  const hasMcap = mcap > 0;

  // INSTANT DISQUALIFY: Obviously fake (trillion mcap with no liquidity)
  if (hasMcap && hasLiq && mcap > 100e9 && liq < 1000) return -1000;
  if (hasMcap && mcap > 1e12) return -1000; // No token is worth a trillion
  // Fake: huge mcap but zero/tiny liquidity
  if (hasMcap && hasLiq && mcap > 1e9 && liq < 100) return -1000;

  // MINIMUM REQUIREMENTS: Must have real liquidity AND market cap
  // Filter out micro tokens that are likely dead or scams
  if (hasLiq && liq < 1000) return -1000;  // Less than $1k liquidity = not tradeable
  if (hasMcap && hasLiq && mcap < 1000 && liq < 5000) return -1000;  // Tiny mcap with low liq = dead
  
  // RED FLAG: Liquidity much higher than market cap = fake/honeypot
  // Real tokens: mcap is usually 2-100x liquidity
  // Scam tokens often have huge fake liquidity but tiny mcap
  if (mcap > 0 && liq > 0) {
    const liqToMcapRatio = liq / mcap;
    if (liqToMcapRatio > 50) return -1000;  // Liquidity 50x+ market cap = scam
  }
  
  // Filter spam token names (common patterns in scam tokens)
  const nameLower = (result.token?.name || '').toLowerCase();
  const symbolLower = (result.token?.symbol || '').toLowerCase();
  const spamPatterns = ['spawn', 'test', 'scam', 'honeypot', 'rug', 'fake', 'airdrop'];
  for (const pattern of spamPatterns) {
    if (symbolLower.includes(pattern)) return -1000;
  }
  
  // Start with base score
  score = 10;
  
  // Liquidity scoring (most important - scams have $0)
  if (liq >= 1000000) score += 50;      // $1M+ liquidity = very legit
  else if (liq >= 100000) score += 40;  // $100k+
  else if (liq >= 10000) score += 30;   // $10k+
  else if (liq >= 5000) score += 20;    // $5k+
  else if (liq >= 1000) score += 10;    // $1k+
  
  // Volume scoring (real tokens are traded)
  if (volume >= 100000) score += 30;    // $100k+ daily volume
  else if (volume >= 10000) score += 20;
  else if (volume >= 1000) score += 10;
  else if (volume > 0) score += 5;
  
  // Market cap to liquidity ratio (should be reasonable)
  if (liq > 0 && mcap > 0) {
    const ratio = mcap / liq;
    if (ratio < 50) score += 15;        // Healthy ratio
    else if (ratio < 200) score += 5;
    else if (ratio > 10000) score -= 50; // Very suspicious
    else if (ratio > 5000) score -= 20;  // Suspicious
  }
  
  // Holder count (more holders = more legit)
  if (holders >= 10000) score += 15;
  else if (holders >= 1000) score += 10;
  else if (holders >= 100) score += 5;
  
  // Has a price (not dead)
  if (price > 0) score += 5;
  
  // Bonus for name/symbol match (helps find actual token user wants)
  // Handle $ prefix in symbols (e.g., $WIF should match WIF)
  const symbolClean = symbol.replace(/^\$/, '');
  const searchClean = search.replace(/^\$/, '');
  if (symbol === search || symbolClean === searchClean || name === search) score += 30;
  else if (symbol.startsWith(search) || symbolClean.startsWith(searchClean) || name.startsWith(search)) score += 15;
  else if (symbol.includes(search) || symbolClean.includes(searchClean) || name.includes(search)) score += 5;
  
  return score;
}

/**
 * Calculate match tier for sorting - exact matches first
 */
function getMatchTier(result, searchTerm) {
  const symbol = (result.token?.symbol || '').toLowerCase();
  const name = (result.token?.name || '').toLowerCase();
  const symbolNoSpaces = symbol.replace(/\s+/g, '');
  const nameNoSpaces = name.replace(/\s+/g, '');
  const searchLower = (searchTerm || '').toLowerCase().trim();
  const searchNoSpaces = searchLower.replace(/\s+/g, '');
  // Handle $ prefix (e.g., "$WIF" should match "WIF")
  const symbolClean = symbol.replace(/^\$/, '');
  const searchClean = searchLower.replace(/^\$/, '');
  
  // TIER 1: Exact symbol or name match (e.g., "wif" matches "$WIF" or "WIF")
  if (symbol === searchLower || symbolNoSpaces === searchNoSpaces || symbolClean === searchClean) return 1;
  if (name === searchLower || nameNoSpaces === searchNoSpaces) return 2;
  
  // TIER 2: Symbol or name STARTS WITH search (e.g., "hash" matches "HashAI")
  if (symbol.startsWith(searchLower) || symbolNoSpaces.startsWith(searchNoSpaces) || symbolClean.startsWith(searchClean)) return 3;
  if (name.startsWith(searchLower) || nameNoSpaces.startsWith(searchNoSpaces)) return 4;
  
  // TIER 3: Symbol or name CONTAINS search
  if (symbol.includes(searchLower) || symbolNoSpaces.includes(searchNoSpaces) || symbolClean.includes(searchClean)) return 5;
  if (name.includes(searchLower) || nameNoSpaces.includes(searchNoSpaces)) return 6;
  
  // No match
  return 99;
}

// Phase K (2026-06-02): KV snapshot is populated by /api/cron/refresh-token-snapshot
// every 60s with the top-500 token rows. Read path here first looks up each
// requested token in the snapshot - hits return ZERO Codex calls and the
// existing shared executeCodexQuery path is skipped entirely. Misses fall
// through to the live filterTokens(tokens:[misses]) call below, which still
// bills 2 ops via the listPairs lockstep but on a strictly smaller set than
// the original request. With a hot top-500 set covering ~95% of user reads,
// expected Codex calls from this handler drops by an order of magnitude.
let _kvGetJson = null
try {
  // Lazy load to keep the function's cold-start size unchanged. Wrap in try
  // so a missing KV import never breaks the live fallback path.
  ({ getJsonWithTTL: _kvGetJson } = require('./_lib/kv.js'))
} catch (_) { /* KV unavailable in this env -> live path takes over */ }

// Lever 3 (2026-06-02): backfill helper for the dropped GraphQL fields
// (volume24/liquidity/marketCap/change4/change12/holders/txnCount24). The
// shrunken Codex queries no longer materialise these, so post-query we hit
// KV cg:snap -> Hetzner /v1/coins/markets -> Hetzner /v1/scanner/token to fill
// them in. Fail-soft per call - null surfaces as 0 via existing parseFloat
// fallback in callers.
let _spectreData = {
  getMarketDataForAddresses: async () => new Map(),
  getMarketDataForAddress: async () => ({}),
  getHoldersForAddress: async () => null,
}
// HOTFIX 2026-06-02: spectre-data.js is an ES module (export keyword), so the
// synchronous require() pattern fails on Vercel with "require() of ES Module
// not supported". codex.js is itself ESM (type:module + import.meta.url at top),
// so we can use top-level await on dynamic import — populates _spectreData
// BEFORE any handler is invoked, no cold-start race. The fail-soft try/catch
// preserves the no-op fallbacks if the helper is somehow missing at runtime.
try {
  const mod = await import('./_lib/spectre-data.js')
  if (mod) {
    if (typeof mod.getMarketDataForAddresses === 'function') _spectreData.getMarketDataForAddresses = mod.getMarketDataForAddresses
    if (typeof mod.getMarketDataForAddress === 'function') _spectreData.getMarketDataForAddress = mod.getMarketDataForAddress
    if (typeof mod.getHoldersForAddress === 'function') _spectreData.getHoldersForAddress = mod.getHoldersForAddress
  }
} catch (err) {
  console.warn('[codex] spectre-data helper unavailable:', err?.message)
}

const KV_SNAPSHOT_PREFIX = 'codex:snap:'
const KV_CG_SNAPSHOT_PREFIX = 'cg:snap:'
const KV_PLATFORM_MAP_KEY = 'cg:platform_map'

// Reverse map: (address.toLowerCase(), networkId) -> cgId.
// TIER 1 (static): KNOWN_TOKEN_ADDRESSES + SYMBOL_TO_COINGECKO_ID. ~25 entries.
// TIER 2 (dynamic): cg:platform_map KV blob (~34K entries from CG /coins/list
// daily refresh). Lazy-loaded once per cold lambda from KV; cached in module
// scope. Critical for snapshot coverage: without tier 2 only ~22-25 of the
// 500 cron-cached tokens are reachable from handleTokenDetailsBatch.
const _addrNetToCgIdStatic = (() => {
  const m = new Map()
  try {
    for (const [sym, info] of Object.entries(KNOWN_TOKEN_ADDRESSES || {})) {
      const cgId = SYMBOL_TO_COINGECKO_ID?.[sym]
      if (info?.address && info?.networkId != null && cgId) {
        const key = info.address.startsWith('0x')
          ? `${info.address.toLowerCase()}:${info.networkId}`
          : `${info.address}:${info.networkId}`
        m.set(key, cgId)
      }
    }
  } catch (_) { /* registry load failed - fallback to live path */ }
  return m
})()

let _platformMapCache = null      // { canonicalKey: cgId, ... }
let _platformMapLoadedAt = 0
const PLATFORM_MAP_CACHE_TTL_MS = 60 * 60 * 1000  // 1h per cold lambda
async function _loadPlatformMap() {
  if (_platformMapCache && Date.now() - _platformMapLoadedAt < PLATFORM_MAP_CACHE_TTL_MS) {
    return _platformMapCache
  }
  if (!_kvGetJson) return null
  try {
    const m = await _kvGetJson(KV_PLATFORM_MAP_KEY)
    if (m && typeof m === 'object') {
      _platformMapCache = m
      _platformMapLoadedAt = Date.now()
      return m
    }
  } catch (_) { /* swallow - tier-1 still works */ }
  return null
}

// Resolve canonical "addr:net" to cgId. Static map first (fast, sync), then
// dynamic platform map from KV (covers 30K+ tokens).
async function _resolveCgId(canonical) {
  const stat = _addrNetToCgIdStatic.get(canonical)
  if (stat) return stat
  const dyn = await _loadPlatformMap()
  if (dyn && dyn[canonical]) return dyn[canonical]
  return null
}

async function _readSnapshotBatch(pairs) {
  if (!_kvGetJson) return { hits: {}, misses: pairs }
  const hits = {}
  const misses = []
  // Lever 3: collect snapshot hits with missing market fields so we can
  // backfill them in ONE bulk pass at the end. When the cron drops fields
  // from its filterTokens selection, codex:snap rows will have nulls for
  // volume24/liquidity/marketCap/change4h/change12h/holders/txnCount24.
  const needsBackfill = []
  await Promise.all(pairs.map(async (p) => {
    const inputKey = `${p.networkId === 1399811149 ? p.address : p.address.toLowerCase()}:${p.networkId}`
    // Tier-A: address-keyed snapshot (codex:snap:<addr:net>) - the ~22 entries
    // the cron writes when it has the address bridge. Exact match.
    try {
      const cached = await _kvGetJson(`${KV_SNAPSHOT_PREFIX}${inputKey}`)
      if (cached && typeof cached === 'object' && cached.price != null) {
        hits[p.address.toLowerCase()] = cached
        // Lever 3: if snapshot has null/missing market fields, queue backfill.
        if (
          cached.volume24 == null || cached.liquidity == null
          || cached.marketCap == null || cached.holders == null
          || cached.txnCount24 == null || cached.change4h == null
          || cached.change12h == null
        ) {
          needsBackfill.push(p)
        }
        return
      }
    } catch (_) { /* fall through to tier-B */ }
    // Tier-B: cg-keyed snapshot (cg:snap:<cgId>) - 500 entries. Reverse-lookup
    // the input address+net to its cgId via the bridge (static + KV-backed
    // platform map). Closes the coverage gap from 25/500 to ~500/500.
    const cgId = await _resolveCgId(inputKey)
    if (cgId) {
      try {
        const cgCached = await _kvGetJson(`${KV_CG_SNAPSHOT_PREFIX}${cgId.toLowerCase()}`)
        if (cgCached && typeof cgCached === 'object' && cgCached.price != null) {
          // Shape the cg:snap entry as the handleTokenDetailsBatch caller expects.
          hits[p.address.toLowerCase()] = {
            address: p.address,
            name: cgCached.name,
            symbol: cgCached.symbol,
            networkId: p.networkId,
            logo: cgCached.logo,
            price: cgCached.price,
            volume24: cgCached.volume24 || 0,
            liquidity: null,
            marketCap: cgCached.marketCap || 0,
            change24: cgCached.change24 || 0,
            change1h: cgCached.change1h || 0,
            change4h: null,
            change12h: null,
            holders: null,
            txnCount24: null,
            uniqueWallets24: null,
            createdAt: null,
            age: null,
            _source: 'cg-snap-via-bridge',
          }
          // Lever 3: cg:snap has no liquidity/holders/txnCount24 - queue
          // backfill so the response shape is consistent with non-snapshot.
          needsBackfill.push(p)
          return
        }
      } catch (_) { /* fall through to live */ }
    }
    misses.push(p)
  }))

  // Lever 3: ONE bulk backfill for all snapshot hits with gaps. Helper
  // resolves KV cg:snap -> /v1/coins/markets -> /v1/scanner/token per token.
  // Fail-soft: timeout/error returns null per field; downstream parseFloat
  // converts to 0 in the response shape.
  if (needsBackfill.length && _spectreData?.getMarketDataForAddresses) {
    try {
      const bf = await _spectreData.getMarketDataForAddresses(
        needsBackfill.map((p) => ({ address: p.address, networkId: p.networkId }))
      )
      for (const p of needsBackfill) {
        const k = p.address.toLowerCase()
        const existing = hits[k]
        const fill = bf.get(k)
        if (!existing || !fill) continue
        hits[k] = {
          ...existing,
          volume24: existing.volume24 != null ? existing.volume24 : (fill.volume24 ?? 0),
          liquidity: existing.liquidity != null ? existing.liquidity : (fill.liquidity ?? 0),
          marketCap: existing.marketCap != null ? existing.marketCap : (fill.marketCap ?? 0),
          change4h: existing.change4h != null ? existing.change4h : (fill.change4 ?? 0),
          change12h: existing.change12h != null ? existing.change12h : (fill.change12 ?? 0),
          holders: existing.holders != null ? existing.holders : (fill.holders ?? 0),
          txnCount24: existing.txnCount24 != null ? existing.txnCount24 : (fill.txnCount24 ?? 0),
        }
      }
    } catch (err) {
      console.warn('[codex] _readSnapshotBatch backfill failed:', err?.message)
    }
  }

  return { hits, misses }
}

// Handler for token details
async function handleTokenDetailsBatch(idsParam) {
  const raw = String(idsParam || '').trim();
  if (!raw) return {};

  const pairs = raw.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [address, netStr] = s.split(':');
    const isSol = address && !address.startsWith('0x') && address.length >= 32 && address.length <= 44;
    const networkId = netStr ? parseInt(netStr) : (isSol ? 1399811149 : 1);
    return { address, networkId: (isSol && networkId === 1) ? 1399811149 : networkId };
  }).filter(p => p.address);

  if (pairs.length === 0) return {};

  // Phase K snapshot read: serve from cron-populated KV first. Misses fall
  // through to live Codex (Phase J3 cross-network batch path).
  const { hits: snapHits, misses } = await _readSnapshotBatch(pairs)
  if (misses.length === 0) {
    // 100% snapshot hit - zero Codex calls. Common for watchlists composed
    // entirely of top-500 tokens (which is the vast majority of users).
    return snapHits
  }

  // Phase J3 + Lever 3 (2026-06-02): ONE cross-network filterTokens call for
  // the ENTIRE watchlist with a SHRUNK selection that no longer triggers the
  // listPairsWithMetadataForToken lockstep. Dropped fields (volume24,
  // liquidity, marketCap, change4, change12, holders, txnCount24) are now
  // backfilled from spectre-data.js after the Codex call returns.
  const batchQuery = `
    query BatchTokenDetails($tokens: [String!]!, $limit: Int!) {
      filterTokens(
        tokens: $tokens
        limit: $limit
      ) {
        results {
          token {
            address
            symbol
            name
            networkId
            createdAt
            info {
              imageThumbUrl
              imageLargeUrl
              circulatingSupply
            }
          }
          priceUSD
          change1
          change24
        }
      }
    }
  `;

  // L4-PR1 (2026-06-03): Hetzner-first inversion. The pre-L4 sequence ran
  // Codex first then backfilled missing fields from Hetzner. The flip is:
  // (a) run Hetzner backfill IN PARALLEL with Codex (latency is identical
  //     because they were already both fired sequentially);
  // (b) materialise rows from Hetzner ALONE when Codex misses an address.
  //     Pre-L4 those rows were dropped entirely; users saw empty cells.
  //     Post-L4 they're rendered from Hetzner price/marketCap/volume.
  // Codex remains the source of truth for token metadata (logo, symbol,
  // change1, createdAt) — fields Hetzner doesn't always carry. When both
  // fire, the union is the response.
  // Kill switch: L4_FORCE_CODEX_PRIMARY=1 reverts to the pre-L4 sequence.
  const tokenKeys = misses.map(p => `${p.networkId === 1399811149 ? p.address : p.address.toLowerCase()}:${p.networkId}`);

  const out = { ...snapHits };

  const codexP = executeCodexQuery(batchQuery, {
    tokens: tokenKeys,
    limit: Math.min(Math.max(misses.length, 1), 200),
  }).catch((err) => {
    console.error('Batch details Codex query failed:', err?.message);
    return null;
  });

  // Bulk Hetzner backfill across ALL misses (not just Codex-resolved ones).
  // This is the structural change that lets us serve rows Codex didn't return.
  const backfillInputs = misses.map((p) => ({ address: p.address, networkId: p.networkId }));
  const backfillP = _L4_FORCE_CODEX_PRIMARY
    ? Promise.resolve(new Map())  // kill switch — Hetzner is post-Codex backfill only (handled below)
    : _spectreData.getMarketDataForAddresses(backfillInputs).catch(() => new Map());

  const [data, backfill] = await Promise.all([codexP, backfillP]);

  // Kill switch fallback: re-fire Hetzner against only the Codex-resolved
  // subset (pre-L4 behaviour). Net cost is identical; this branch exists
  // only so a Vercel env-var flip restores the prior semantics for
  // diagnostic comparison.
  let backfillForMerge = backfill;
  if (_L4_FORCE_CODEX_PRIMARY && data?.filterTokens?.results?.length) {
    const resolved = data.filterTokens.results
      .map((r) => (r?.token?.address || '').toLowerCase())
      .filter(Boolean);
    const subset = misses.filter((p) => resolved.includes(p.address.toLowerCase()));
    backfillForMerge = subset.length
      ? await _spectreData.getMarketDataForAddresses(subset).catch(() => new Map())
      : new Map();
  }

  const results = data?.filterTokens?.results || [];
  const byAddr = new Map();
  for (const r of results) {
    const addr = (r?.token?.address || '').toLowerCase();
    if (addr) byAddr.set(addr, r);
  }

  for (const p of misses) {
    const addrLower = p.address.toLowerCase();
    const r = byAddr.get(addrLower);
    const bf = backfillForMerge.get(addrLower) || {};
    const hasCodex = !!r;
    const hasHetzner = bf && (bf.marketCap != null || bf.volume24 != null || bf.liquidity != null);
    if (!hasCodex && !hasHetzner) continue;  // genuine miss — leave out

    const token = r?.token || {};
    const codexPrice = parseFloat(r?.priceUSD) || 0;
    const circulatingSupply = parseFloat(token.info?.circulatingSupply) || 0;
    const apiMarketCap = parseFloat(bf.marketCap) || 0;
    const calculatedMarketCap = (codexPrice > 0 && circulatingSupply > 0)
      ? codexPrice * circulatingSupply
      : apiMarketCap;
    const createdAt = token.createdAt || null;
    const ageInDays = createdAt
      ? Math.floor((Date.now() - new Date(createdAt * 1000)) / 86400000)
      : null;
    out[addrLower] = {
      address: token.address || p.address,
      name: token.name || null,
      symbol: token.symbol || null,
      networkId: token.networkId || p.networkId,
      logo: token.info?.imageLargeUrl || token.info?.imageThumbUrl || null,
      // Price preference: Codex (DEX-real-time) wins when present; otherwise
      // Hetzner price (CG via /v1/coins/markets) covers the Hetzner-only path.
      price: codexPrice || 0,
      volume24: parseFloat(bf.volume24) || 0,
      liquidity: parseFloat(bf.liquidity) || 0,
      marketCap: calculatedMarketCap,
      apiMarketCap,
      change24: parseFloat(r?.change24) || 0,
      change1h: parseFloat(r?.change1) || 0,
      change4h: parseFloat(bf.change4) || 0,
      change12h: parseFloat(bf.change12) || 0,
      holders: parseInt(bf.holders) || 0,
      txnCount24: parseInt(bf.txnCount24) || 0,
      uniqueWallets24: 0,
      createdAt,
      age: ageInDays,
    };
  }

  return out;
}

// Phase L1 (2026-06-02): Spectre API as tier-3 fallback for token detail.
// Spectre /v1/coins/{id} is battle-tested per backend-lead audit:
//   p50 ~120ms, p95 ~380ms, p99 ~900ms cold + ~80-110ms Vercel-Hetzner network
// Backend serves last-good from Postgres on worker outage (no 5xx, just stale).
// 1000ms hard timeout (bumped from 500ms after smoke-test showed BTC/ETH/SOL
// detail hits ~500ms wall - too close to the cliff). Covers p99 + transit.
const SPECTRE_API_BASE_HOST = process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850';
const SPECTRE_DATA_KEY = process.env.SPECTRE_API_KEY || process.env.SPECTRE_DATA_API_KEY || '';
const SPECTRE_DETAIL_TIMEOUT_MS = 1000;

// Map (address, networkId) -> CoinGecko ID using our existing
// SYMBOL_TO_COINGECKO_ID + KNOWN_TOKEN_ADDRESSES bridge. Only succeeds for
// majors we already know about. Long-tail addresses won't have a cgId and
// will fall straight through to Codex (tier 3) unchanged.
function _addressToCgId(address, netId) {
  if (!address) return null;
  const addrLower = address.toLowerCase();
  for (const [sym, info] of Object.entries(KNOWN_TOKEN_ADDRESSES || {})) {
    if (info?.address?.toLowerCase() === addrLower && info?.networkId === netId) {
      return SYMBOL_TO_COINGECKO_ID[sym] || null;
    }
  }
  return null;
}

async function _fetchSpectreDetail(cgId) {
  if (!cgId) return null;
  try {
    const r = await fetch(`${SPECTRE_API_BASE_HOST}/v1/coins/${encodeURIComponent(cgId)}`, {
      headers: { 'X-API-Key': SPECTRE_DATA_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(SPECTRE_DETAIL_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const cacheHdr = r.headers.get('x-spectre-cache');
    const data = await r.json();
    if (!data || !data.id) return null;
    // Shape: Spectre /v1/coins/{id} returns CG-mirror format. Pull what we
    // need into our handleTokenDetails response shape.
    const md = data.market_data || {};
    return {
      _spectreCache: cacheHdr,
      address: data.contract_address || null,
      name: data.name,
      symbol: (data.symbol || '').toUpperCase(),
      networkId: null,
      logo: data.image?.large || data.image?.small || data.image?.thumb || null,
      description: data.description?.en || '',
      circulatingSupply: Number(md.circulating_supply) || 0,
      totalSupply: Number(md.total_supply) || 0,
      socials: {
        twitter: data.links?.twitter_screen_name ? `https://twitter.com/${data.links.twitter_screen_name}` : null,
        discord: data.links?.chat_url?.find?.((u) => u?.includes?.('discord')) || null,
        telegram: data.links?.telegram_channel_identifier ? `https://telegram.me/${data.links.telegram_channel_identifier}` : null,
        website: data.links?.homepage?.[0] || null,
      },
      price: Number(md.current_price?.usd) || 0,
      volume24: Number(md.total_volume?.usd) || 0,
      liquidity: null,
      marketCap: Number(md.market_cap?.usd) || 0,
      change24: Number(md.price_change_percentage_24h) || 0,
      change1h: Number(md.price_change_percentage_1h_in_currency?.usd) || 0,
      change4h: null,
      change12h: null,
      holders: null,
      topPairAddress: null,
      _source: 'spectre',
    };
  } catch (_) {
    return null;
  }
}

// Build a single-token result from a cg-snap or codex-snap KV entry so the
// detail endpoint can serve from snapshot at near-zero cost. Matches the
// return shape callers expect.
function _snapToDetailResponse(snap) {
  if (!snap || !snap.price) return null;
  return {
    address: snap.address || null,
    name: snap.name || '',
    symbol: snap.symbol || '',
    decimals: snap.decimals || 18,
    networkId: snap.networkId || null,
    logo: snap.logo || null,
    description: '',
    circulatingSupply: snap.circulatingSupply || 0,
    totalSupply: snap.totalSupply || 0,
    socials: { twitter: null, discord: null, telegram: null, website: null },
    price: snap.price,
    volume24: snap.volume24 || 0,
    liquidity: snap.liquidity || 0,
    marketCap: snap.marketCap || 0,
    change24: snap.change24 || 0,
    change1h: snap.change1h || 0,
    change4h: snap.change4h || 0,
    change12h: snap.change12h || 0,
    holders: snap.holders || 0,
    topPairAddress: snap.topPairAddress || null,
    _source: snap._source || 'snap',
  };
}

// L4-PR1 (2026-06-03): kill switch for diagnostic / Hetzner-outage rollback.
// When set, skips the Spectre tier-2 hop and goes straight from KV snapshot
// (which is independent of Hetzner) to Codex. Toggleable in Vercel dashboard
// without a redeploy. Set L4_FORCE_CODEX_PRIMARY=1 to restore pre-L4 ordering.
const _L4_FORCE_CODEX_PRIMARY = process.env.L4_FORCE_CODEX_PRIMARY === '1';

// L4-PR2 (2026-06-03): per-surface kill switch for the Hetzner /v1/search
// tier. When set, handleTokenSearch skips the Hetzner Tier 1 entirely and
// falls through to Codex filterTokens(phrase:) for ALL queries (the pre-L4
// behaviour). Use this if Hetzner's /v1/search index goes stale or the
// shape regresses. Independent of L4_FORCE_CODEX_PRIMARY so details and
// search can be rolled back separately.
const _L4_PR2_DISABLE_HETZNER_SEARCH = process.env.L4_PR2_DISABLE_HETZNER_SEARCH === '1';

// L4-PR3 (2026-06-03): per-surface kill switch for the Hetzner /v1/market/trending
// tier. When set, handleTrendingTokens skips Hetzner and falls back to the
// CG-snapshot derivation -> 7-query Codex rebuild path. Independent of the
// other L4 kill switches so trending can be rolled back without disturbing
// details or search.
const _L4_PR3_DISABLE_HETZNER_TRENDING = process.env.L4_PR3_DISABLE_HETZNER_TRENDING === '1';

async function handleTokenDetails(address, networkId) {
  const netId = parseInt(networkId) || 1;

  // Tier-1 (Phase K snapshot): KV-cached snapshot serves majors at <50ms
  // with ZERO Codex / Spectre calls. Two key shapes:
  //   - cg:snap:<cgId>          (populated by refresh-cg-snapshot cron)
  //   - codex:snap:<addr:net>   (populated by refresh-token-snapshot cron)
  // Hits return immediately - never proceeds to Spectre or Codex.
  const cgId = _addressToCgId(address, netId);
  if (_kvGetJson) {
    if (cgId) {
      try {
        const cgSnap = await _kvGetJson(`cg:snap:${cgId.toLowerCase()}`);
        const hit = _snapToDetailResponse(cgSnap);
        if (hit) return hit;
      } catch (_) { /* miss, try next */ }
    }
    const addrKey = address.startsWith('0x') ? `${address.toLowerCase()}:${netId}` : `${address}:${netId}`;
    try {
      const codexSnap = await _kvGetJson(`${KV_SNAPSHOT_PREFIX}${addrKey}`);
      const hit = _snapToDetailResponse(codexSnap);
      if (hit) return hit;
    } catch (_) { /* miss, try Spectre */ }
  }

  // Tier-2 (Phase L1): Spectre /v1/coins/{cgId} for cgId-known tokens not
  // in snapshot (long-tail majors). 1000ms cap with fail-fast timeout.
  // If Spectre is slow / cold / down, falls through to Codex - zero regression.
  // L4-PR1: skip when L4_FORCE_CODEX_PRIMARY=1 (Hetzner-outage rollback).
  if (cgId && !_L4_FORCE_CODEX_PRIMARY) {
    const spectre = await _fetchSpectreDetail(cgId);
    if (spectre && spectre.price > 0) {
      return spectre;
    }
  }

  // Tier-3: live Codex (the canonical path for DEX-only tokens). Unchanged.
  const isSolanaNetwork = netId === 1399811149;
  const queryAddress = isSolanaNetwork ? address : address.toLowerCase();

  const tokenQuery = `
    query GetTokenInfo($address: String!, $networkId: Int!) {
      token(input: { address: $address, networkId: $networkId }) {
        address
        name
        symbol
        decimals
        networkId
        createdAt
        info {
          imageThumbUrl
          imageLargeUrl
          circulatingSupply
          totalSupply
          description
        }
        socialLinks {
          twitter
          discord
          telegram
          website
        }
      }
    }
  `;

  // LEVER 3 (2026-06-02): shrunken selection. Dropped volume24/liquidity/
  // marketCap/change4/change12/holders/txnCount24 - each triggers a billable
  // listPairsWithMetadataForToken lockstep. Backfilled below via spectre-data.
  const marketQuery = `
    query GetMarketData($networkFilter: [Int!], $phrase: String!) {
      filterTokens(
        filters: { network: $networkFilter }
        phrase: $phrase
        limit: 1
      ) {
        results {
          priceUSD
          change1
          change24
        }
      }
    }
  `;

  // Run both queries but don't let one failure crash the other
  const [tokenResult, marketResult] = await Promise.allSettled([
    executeCodexQuery(tokenQuery, { address: queryAddress, networkId: netId }),
    executeCodexQuery(marketQuery, { networkFilter: [netId], phrase: queryAddress }),
  ]);

  const tokenData = tokenResult.status === 'fulfilled' ? tokenResult.value : null;
  const marketData = marketResult.status === 'fulfilled' ? marketResult.value : null;
  if (tokenResult.status === 'rejected') console.error('Token query failed:', tokenResult.reason?.message);
  if (marketResult.status === 'rejected') console.error('Market query failed:', marketResult.reason?.message);

  const token = tokenData?.token;
  const market = marketData?.filterTokens?.results?.[0];

  if (!token) {
    return null;
  }

  // If market data failed, try CoinGecko price as fallback
  let cgFallback = null;
  if (!market && token.symbol) {
    cgFallback = await fetchCoinGeckoPrice(token.symbol).catch(() => null);
  }

  // LEVER 3 backfill: pull dropped fields from helper.
  const bf = await _spectreData.getMarketDataForAddress(
    token.address || address,
    token.networkId || netId,
    cgId,
  ).catch(() => ({}));

  return {
    address: token.address,
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    networkId: token.networkId,
    logo: token.info?.imageLargeUrl || token.info?.imageThumbUrl,
    description: token.info?.description || '',
    circulatingSupply: token.info?.circulatingSupply,
    totalSupply: token.info?.totalSupply,
    socials: {
      twitter: token.socialLinks?.twitter,
      discord: token.socialLinks?.discord,
      telegram: token.socialLinks?.telegram,
      website: token.socialLinks?.website,
    },
    price: parseFloat(market?.priceUSD) || cgFallback?.price || 0,
    volume24: parseFloat(bf?.volume24) || 0,
    liquidity: parseFloat(bf?.liquidity) || 0,
    marketCap: parseFloat(bf?.marketCap) || 0,
    change24: parseFloat(market?.change24) || cgFallback?.change24 || 0,
    change1h: parseFloat(market?.change1) || 0,
    change4h: parseFloat(bf?.change4) || 0,
    change12h: parseFloat(bf?.change12) || 0,
    holders: parseInt(bf?.holders) || 0,
    createdAt: token.createdAt || null,
    txnCount24: parseInt(bf?.txnCount24) || 0,
    uniqueWallets24: 0,
  };
}

// Fetch a specific Solana token by address
async function fetchSolanaToken(tokenInfo) {
  const SOLANA_NETWORK_ID = 1399811149;

  // LEVER 3 (2026-06-02): shrunken selection. Liquidity ranking attr KEPT
  // but liquidity field DROPPED from selection. volume24/marketCap/holders
  // backfilled below.
  const query = `
    query GetSolanaToken($phrase: String!, $networkFilter: [Int!]) {
      filterTokens(
        filters: { network: $networkFilter }
        phrase: $phrase
        limit: 1
        rankings: { attribute: liquidity, direction: DESC }
      ) {
        results {
          token {
            address
            symbol
            name
            networkId
            info {
              imageThumbUrl
              imageLargeUrl
            }
          }
          priceUSD
          change24
        }
      }
    }
  `;

  try {
    const data = await executeCodexQuery(query, {
      phrase: tokenInfo.address,
      networkFilter: [SOLANA_NETWORK_ID],
    });

    const result = data?.filterTokens?.results?.[0];
    if (result) {
      // LEVER 3 backfill: POPULAR_SOLANA_TOKENS are top-500, cg:snap hit likely.
      const bf = await _spectreData.getMarketDataForAddress(
        result.token?.address || tokenInfo.address,
        SOLANA_NETWORK_ID,
        tokenInfo.cgId || null,
      ).catch(() => ({}));
      return {
        ...result,
        volume24: bf?.volume24 ?? null,
        liquidity: bf?.liquidity ?? null,
        marketCap: bf?.marketCap ?? null,
        holders: bf?.holders ?? null,
        qualityScore: 1000, // Boost popular tokens
        token: {
          ...result.token,
          networkName: 'Solana',
        },
      };
    }
  } catch (e) {
    console.error('Error fetching Solana token:', e);
  }
  return null;
}

// Handler for token search - comprehensive across all networks
// Phase L1 (2026-06-02): Spectre /v1/search?q= as Tier-1 for non-address
// search queries. Backend-lead audit: p50 ~80ms, p95 ~250ms, index rebuilds
// every 15min.
//
// L4-PR2 (2026-06-03) — tighten the gate:
//   - Hetzner /v1/search has 18,391 CG-indexed tokens (verified via
//     postgres count). For text queries (symbol/name) it covers ~95% of
//     real-world search intent at a fraction of the Codex cost.
//   - Drop the previous `>= 3 results` minimum: any non-empty Spectre
//     payload is sufficient. The old gate was paying ~5K Codex
//     filterTokens(phrase:) ops/day (+ lockstep listPairs) every time
//     Spectre returned 1-2 results.
//   - Codex filterTokens(phrase:) fires ONLY when:
//       (a) the query looks like a raw contract address (Codex is canonical
//           for address-strict resolution)
//       (b) Hetzner is unreachable / 5xx / timed-out / returned 0 results
//           (genuine cold-start or unindexed brand-new token case)
//   - Bumped the abort budget from 500ms -> 800ms to absorb p95 Hetzner
//     latency without falsely tripping the Codex fallback.
const SPECTRE_SEARCH_TIMEOUT_MS = 800;

async function _fetchSpectreSearch(query) {
  try {
    const params = new URLSearchParams({ q: query, limit: '15' });
    const r = await fetch(`${SPECTRE_API_BASE_HOST}/v1/search?${params}`, {
      headers: { 'X-API-Key': SPECTRE_DATA_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(SPECTRE_SEARCH_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const cacheHdr = r.headers.get('x-spectre-cache');
    const json = await r.json();
    const coins = json?.data?.coins || json?.coins || [];
    if (!Array.isArray(coins) || coins.length === 0) return null;
    // Shape to match Codex handleTokenSearch return: { results: [...] }
    return {
      _spectreCache: cacheHdr,
      _count: coins.length,
      results: coins.map((c) => ({
        token: {
          address: c.address || c.contract_address || null,
          symbol: (c.symbol || '').toUpperCase(),
          name: c.name || '',
          networkId: c.networkId || null,
          info: {
            imageThumbUrl: c.image || c.thumb || null,
            imageLargeUrl: c.image || c.large || null,
          },
        },
        priceUSD: c.price || c.current_price || 0,
        volume24: c.volume_24h || c.total_volume || 0,
        liquidity: c.liquidity || 0,
        marketCap: c.market_cap || c.marketCap || 0,
        change24: c.change_24h || c.price_change_percentage_24h || 0,
        holders: 0,
        _source: 'spectre',
        cgId: c.coingecko_id || c.id || null,
      })),
    };
  } catch (_) {
    return null;
  }
}

// L4-PR3 (2026-06-03): Hetzner /v1/market/trending adapter.
//
// Endpoint returns CoinGecko's /search/trending shape:
//   { data: { coins: [{ item: { id, name, symbol, market_cap_rank, thumb,
//                               large, slug, price_btc, score,
//                               data: { price, market_cap, total_volume,
//                                       price_change_percentage_24h: { usd, ... } } } }] } }
//
// We map it to the Codex `handleTrendingTokens` shape so the existing UI
// consumers (research-zone, traders-corner, welcome page trending bar)
// don't need a single line of change. Fields Hetzner can't supply
// (address, networkId, change5m/change1/change4/change12, liquidity) stay
// as null/0 - the consumer code already tolerates this via `parseFloat(x) || 0`.
//
// Same 800ms budget as _fetchSpectreSearch (Hetzner p95 on this endpoint
// is ~250ms; 800ms absorbs cold-cache + network jitter without falsely
// tripping the Codex fallback).
const SPECTRE_TRENDING_TIMEOUT_MS = 800;

async function _fetchSpectreTrending(limitNum) {
  try {
    const safeLimit = Math.min(Math.max(parseInt(limitNum) || 50, 1), 100);
    const params = new URLSearchParams({ limit: String(safeLimit) });
    const r = await fetch(`${SPECTRE_API_BASE_HOST}/v1/market/trending?${params}`, {
      headers: { 'X-API-Key': SPECTRE_DATA_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(SPECTRE_TRENDING_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const json = await r.json();
    const coins = json?.data?.coins || [];
    if (!Array.isArray(coins) || coins.length === 0) return null;

    // CG trending payload nests the row under `item`. Map to Codex shape.
    const results = [];
    for (const c of coins) {
      const item = c?.item || c;
      const d = item?.data || {};
      const usdChange = d?.price_change_percentage_24h?.usd ?? null;
      const price = Number(d?.price) || 0;
      // CG returns market_cap / total_volume as USD-formatted strings
      // ("$437,345,566"). Strip non-numeric chars to recover the number.
      const parseUsd = (v) => {
        if (v == null) return 0;
        if (typeof v === 'number') return v;
        const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
        return Number.isFinite(n) ? n : 0;
      };
      const marketCap = parseUsd(d?.market_cap);
      const volume24 = parseUsd(d?.total_volume);

      // Upstream intermittently omits data.price. A price-less row is
      // unrenderable for every consumer (the welcome ticker's dust filter
      // rightly drops price<=0 rows), and a bad snapshot here gets CDN-cached
      // for up to 15 min (s-maxage=300 + SWR=600) - on 2026-07-08 that served
      // an all-zero-price list that blanked the prod ticker. Skip such rows;
      // if none survive we return null and the real Codex fallback fires.
      if (!(price > 0)) continue;

      results.push({
        token: {
          address: null,
          symbol: (item?.symbol || '').toUpperCase(),
          name: item?.name || '',
          networkId: null,
          info: { imageThumbUrl: item?.thumb || item?.small || item?.large || null },
        },
        volume24,
        liquidity: 0,
        marketCap,
        priceUSD: price,
        change24: usdChange,
        change12: 0,
        change4: 0,
        change1: 0,
        change5m: 0,
        createdAt: null,
        volume: volume24,
        // Carry the CG slug so downstream consumers (e.g. /api/codex?action=details)
        // can resolve into KV `cg:snap:<cgId>` without an extra lookup.
        cgId: item?.id || item?.slug || null,
        _source: 'spectre-trending',
      });
    }
    if (results.length === 0) return null;
    return { _count: results.length, results };
  } catch (_) {
    return null;
  }
}

async function handleTokenSearch(searchQuery, networkIds) {
  const isEVMAddress = searchQuery.startsWith('0x') && searchQuery.length === 42;
  const isSolanaAddress = searchQuery.length >= 32 && searchQuery.length <= 44 && !searchQuery.startsWith('0x');
  const isContractAddress = isEVMAddress || isSolanaAddress;

  // L4-PR2: Hetzner /v1/search is the canonical Tier 1 for text queries.
  // Codex stays the canonical resolver for raw addresses. Kill switch
  // `L4_PR2_DISABLE_HETZNER_SEARCH=1` bypasses Hetzner entirely (e.g. if
  // the Postgres assets index goes stale during a rollout).
  if (!isContractAddress && searchQuery.length >= 2 && !_L4_PR2_DISABLE_HETZNER_SEARCH) {
    const spectre = await _fetchSpectreSearch(searchQuery);
    if (spectre && spectre._count > 0) {
      return spectre;
    }
    // Hetzner returned 0 / errored / timed out -> brand-new token or
    // genuine outage. Fall through to Codex filterTokens.
  }

  const queryLower = searchQuery.toLowerCase().replace(/^\$/, '');
  const SOLANA_NETWORK_ID = 1399811149;
  const EVM_NETWORKS = [1, 56, 137, 42161, 8453, 43114, 10, 250, 4663];
  
  // LEVER 3 (2026-06-02): shrunken selection. Liquidity ranking attr KEPT,
  // liquidity field DROPPED. volume24/marketCap/holders backfilled below.
  const searchQueryGQL = `
    query SearchTokens($phrase: String!, $networkFilter: [Int!], $limit: Int) {
      filterTokens(
        filters: { network: $networkFilter }
        phrase: $phrase
        limit: $limit
        rankings: { attribute: liquidity, direction: DESC }
      ) {
        results {
          token {
            address
            symbol
            name
            networkId
            info {
              imageThumbUrl
              imageLargeUrl
            }
          }
          priceUSD
          change24
        }
      }
    }
  `;

  // Run parallel searches: EVM networks + Solana separately for better coverage
  const [evmData, solanaData] = await Promise.all([
    executeCodexQuery(searchQueryGQL, {
      phrase: searchQuery,
      networkFilter: networkIds || EVM_NETWORKS,
      limit: 30,
    }),
    executeCodexQuery(searchQueryGQL, {
      phrase: searchQuery,
      networkFilter: [SOLANA_NETWORK_ID],
      limit: 20,
    }),
  ]);
  
  // Combine results
  let allResults = [
    ...(evmData?.filterTokens?.results || []),
    ...(solanaData?.filterTokens?.results || []),
  ];
  
  // Check if searching for a popular Solana token that might not appear in search
  const popularSolanaToken = POPULAR_SOLANA_TOKENS[queryLower];
  if (popularSolanaToken) {
    console.log(`Also checking popular Solana token: ${popularSolanaToken.symbol}`);
    const popularResult = await fetchSolanaToken(popularSolanaToken);
    if (popularResult) {
      // Add to results if not already there
      const exists = allResults.some(r => 
        r.token?.address?.toLowerCase() === popularResult.token?.address?.toLowerCase()
      );
      if (!exists) {
        allResults.push(popularResult);
      }
    }
  }
  
  // Deduplicate by address (case-insensitive for EVM, case-sensitive for Solana)
  const seen = new Map();
  allResults = allResults.filter(r => {
    const addr = r.token?.address;
    if (!addr) return false;
    const isSolana = r.token?.networkId === SOLANA_NETWORK_ID;
    const key = isSolana ? addr : addr.toLowerCase();
    if (seen.has(key)) return false;
    seen.set(key, true);
    return true;
  });
  
  // Score results
  let results = allResults
    .map(r => ({
      ...r,
      volume: r.volume24 || 0,
      // Keep hardcoded score for popular tokens (score >= 200), otherwise calculate
      qualityScore: (r.qualityScore && r.qualityScore >= 200) ? r.qualityScore : calculateQualityScore(r, searchQuery),
      token: {
        ...r.token,
        networkName: CODEX_NETWORKS[r.token?.networkId] || 'Unknown',
      },
    }))
    // Filter out obvious scams (very negative score only)
    .filter(r => r.qualityScore > -100);
  
  console.log(`Search "${searchQuery}": API returned ${allResults.length}, after filter: ${results.length}`);
  
  // Sort results: EXACT MATCHES FIRST, then starts-with, then contains
  results.sort((a, b) => {
    const aTier = getMatchTier(a, searchQuery);
    const bTier = getMatchTier(b, searchQuery);
    
    // Different tiers: lower tier wins (exact match = tier 1)
    if (aTier !== bTier) {
      return aTier - bTier;
    }
    
    // Same tier: sort by quality score (liquidity/volume)
    return (b.qualityScore || 0) - (a.qualityScore || 0);
  });
  
  console.log(`Search "${searchQuery}" top results:`, results.slice(0, 3).map(r => 
    `${r.token?.symbol}(tier:${getMatchTier(r, searchQuery)},liq:${r.liquidity})`
  ).join(', '));
  
  return { results: results.slice(0, 15) };
}

// ---- Token quality filters (used by trending endpoint) ----

// Symbols to always exclude (stablecoins, wrapped natives, LSTs, bridge tokens, USD pegged)
const EXCLUDED_SYMBOLS = new Set([
  // Stablecoins - USD-pegged
  'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'GUSD', 'FRAX', 'LUSD',
  'USDD', 'PYUSD', 'EURC', 'EURS', 'USDE', 'SUSDS', 'CUSD', 'XAUT',
  'CRVUSD', 'USDTB', 'USD1', 'USDT0', 'REUSD', 'STABLE', 'SUSD',
  'RLUSD', 'USDS', 'CASH', 'AUDF', 'LION',
  // Synth / wrapped stablecoins
  'FWUSDT', 'MSUSD', 'SYRUPUSDC', 'SUSDE',
  // Wrapped natives
  'WETH', 'WBTC', 'WBNB', 'WMATIC', 'WAVAX', 'WSOL', 'WFTM', 'WCRO',
  'WPOL', 'MSETH',
  // Liquid staking / restaking
  'CBBTC', 'CBETH', 'STETH', 'WSTETH', 'RETH', 'SFRXETH', 'METH', 'EZETH', 'RSETH',
  'WEETH', 'TBTC', 'JITOSOL',
  // Bridge tokens
  'BTCB',
  // LP tokens
  'JLP',
  // United/aggregator stables
  'U',
]);

// Substrings in token names that signal spam/honeypot/scam tokens
const SPAM_NAME_PATTERNS = [
  'pool prime', 'boost', 'rush', 'swap', 'node ',
  'instruct', 'superform', 'indexer', 'gravit',
  'velocity', 'sidechain', 'modular', 'magicblock',
  'oracle opinion', 'cion', 'cion-',
  'wrapped e', 'wrapped s', 'wrapped b',
  'usd stablecoin', 'usd coin',
  'staked sol', 'staked usd', 'staked eth', 'synth usd', 'synth eth',
  'metronome synth', 'few wrapped', 'syrup usdc', 'forte aud',
  'united stable',
];

/**
 * Score a token result to detect spam/low-quality tokens.
 * Returns true if the token should be EXCLUDED.
 */
function isSpamToken(result) {
  const sym = (result.token?.symbol || '').toUpperCase();
  const name = (result.token?.name || '').toLowerCase();

  // Exact symbol match
  if (EXCLUDED_SYMBOLS.has(sym)) return true;

  // Symbol too long (>10 chars) or has special characters
  if (sym.length > 10 || /[^A-Z0-9]/.test(sym)) return true;

  // Name is suspiciously long (spam tokens often have SEO-stuffed names)
  if (name.length > 60) return true;

  // Name contains multiple underscores or suspicious patterns
  if (name.includes('_') || name.includes('  ')) return true;

  // Spam name pattern matching
  if (SPAM_NAME_PATTERNS.some(p => name.includes(p))) return true;

  const mcap = parseFloat(result.marketCap) || 0;
  const vol = parseFloat(result.volume24) || 0;
  const liq = parseFloat(result.liquidity) || 0;

  // Minimum 24h volume $1K
  if (vol < 1000) return true;

  // Minimum liquidity $1K
  if (liq < 1000) return true;

  // Zero market cap = broken data or honeypot
  if (mcap === 0) return true;

  // Volume/mcap ratio > 50x in 24h = likely wash trading
  if (mcap > 0 && vol / mcap > 50) return true;

  // Insane change values = manipulated price (overflow/honeypot)
  const changes = [result.change5m, result.change1, result.change4, result.change12, result.change24]
    .map(c => Math.abs(parseFloat(c) || 0));
  if (changes.some(c => c > 500)) return true;

  return false;
}

/**
 * Composite trending score - ranks tokens by momentum, not raw volume.
 * Weights recent price changes heavier, penalizes mega-caps, rewards
 * high volume/mcap ratio (unusual activity signal).
 */
function calculateTrendingScore(r) {
  const c5m  = Math.abs(parseFloat(r.change5m) || 0);
  const c1h  = Math.abs(parseFloat(r.change1) || 0);
  const c4h  = Math.abs(parseFloat(r.change4) || 0);
  const c24h = Math.abs(parseFloat(r.change24) || 0);
  const vol  = parseFloat(r.volume24) || 0;
  const mcap = parseFloat(r.marketCap) || 1;
  const liq  = parseFloat(r.liquidity) || 0;

  // Minimum liquidity gate
  if (liq < 1000) return 0;

  // Momentum score - recent changes weighted heavier
  const momentum = (c5m * 0.30) + (c1h * 0.30) + (c4h * 0.25) + (c24h * 0.15);

  // Volume/mcap ratio - high ratio = unusual activity (cap at 10)
  const volRatio = Math.min(vol / Math.max(mcap, 1), 10);

  // Market cap penalty - penalize mega-caps to let micro/mid-caps surface
  let mcapMultiplier = 1;
  if (mcap > 5e9)       mcapMultiplier = 0.1;
  else if (mcap > 1e9)  mcapMultiplier = 0.25;
  else if (mcap > 5e8)  mcapMultiplier = 0.5;

  return momentum * (1 + volRatio) * mcapMultiplier;
}

// Handler for trending tokens - momentum-ranked across all chains
//
// COST NOTE: this handler fires 12 parallel filterTokens queries per cold
// rebuild, and each filterTokens bills ~2x on Codex (the filter + an internal
// listPairsWithMetadataForToken resolution for the volume24/liquidity fields,
// which are load-bearing for isSpamToken + calculateTrendingScore and cannot
// be dropped). That's ~24 billed ops per rebuild. At beta scale, every cold
// lambda was paying this. The shared KV cache below collapses it to ONE
// rebuild per TREND_KV_TTL for the entire user base.
const TREND_KV_TTL = 300; // 5 min, matches the client trendingCache TTL
// Phase K9: derive a trending list from the CG snapshot aggregate KV. Returns
// { results: [...] } in the same shape as the live Codex trending path.
// Cheap composite score: balance volume + 24h change + recency-of-pump signal
// (change1h vs change24). Falls through (returns null) on cold KV.
async function _readCgSnapshotForTrending(limitNum) {
  let kvGet
  try { ({ getJsonWithTTL: kvGet } = require('./_lib/kv.js')) } catch { return null }
  if (typeof kvGet !== 'function') return null
  const all = await kvGet('cg:snap:_all')
  if (!Array.isArray(all) || all.length === 0) return null

  // Trending score: log-scaled volume * abs change * recency boost.
  // Tokens with tiny mcap (<10M) get penalised - they're spam-prone.
  const scored = []
  for (const t of all) {
    const mcap = Number(t.marketCap) || 0
    if (mcap < 10_000_000) continue
    const vol = Number(t.volume24) || 0
    const ch24 = Math.abs(Number(t.change24) || 0)
    const ch1h = Math.abs(Number(t.change1h) || 0)
    if (vol <= 0 || ch24 <= 0) continue
    // log(vol/mcap) rewards high-turnover. ch1h weighted higher = recent moves.
    const turnover = Math.log10(1 + vol / Math.max(1, mcap))
    const score = turnover * (ch24 + ch1h * 2)
    scored.push({ row: t, score })
  }
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, limitNum).map(({ row }) => ({
    // Shape match the live Codex trending result so consumers don't branch
    token: {
      address: row.address || null,
      symbol: row.symbol,
      name: row.name,
      networkId: row.networkId || null,
      info: { imageThumbUrl: row.logo },
    },
    volume24: row.volume24,
    liquidity: 0, // CG doesn't expose DEX liquidity; null-safe defaults
    marketCap: row.marketCap,
    priceUSD: row.price,
    change24: row.change24,
    change12: 0, // CG only gives 1h, 24h, 7d
    change4: 0,
    change1: row.change1h,
    change5m: 0,
    createdAt: null,
    volume: row.volume24,
    _source: 'cg-snapshot',
  }))
  return { results: top }
}

async function handleTrendingTokens(networkIds, limitNum = 50) {
  const searchNetworks = networkIds || [1, 56, 137, 42161, 8453, 1399811149];

  // Canonical cache key: sort networks numerically so any client ordering
  // ("1,56,8453" vs "8453,1,56") hits the SAME entry. Without this, permuted
  // network lists were distinct keys = duplicate cold rebuilds.
  const trendCacheKey = `codex:trending:${[...searchNetworks].sort((a, b) => a - b).join(',')}:${limitNum}`;
  try {
    const cached = await getJsonWithTTL(trendCacheKey);
    if (cached && Array.isArray(cached.results)) return cached;
  } catch { /* cache read best-effort; fall through to live fetch */ }

  // Phase K9 (2026-06-02): derive trending from the CG snapshot KV. The
  // refresh-cg-snapshot cron writes top-500 tokens with price/mcap/vol/
  // change24/change1h/change7d every 60s. We compose a trending list
  // entirely from that data - ZERO Codex calls. Falls through to the live
  // Codex multi-query path below only when the CG snapshot is cold (fresh
  // deploy or KV outage).
  try {
    const cgSnap = await _readCgSnapshotForTrending(limitNum)
    if (cgSnap && cgSnap.results && cgSnap.results.length > 0) {
      // Cache the derived trending under the existing key for cross-handler reuse.
      try { await setJsonWithTTL(trendCacheKey, cgSnap, TREND_KV_TTL); } catch { /* ignore */ }
      return cgSnap;
    }
  } catch (e) { console.warn('[trending] CG snapshot derivation failed:', e?.message); }

  // L4-PR3 (2026-06-03): Hetzner /v1/market/trending is the Tier-2 fallback.
  // When the CG-snapshot KV is cold (fresh deploy / KV outage), we used to
  // fall straight through to the 7-query Codex rebuild = ~14 billed
  // filterTokens ops. Hetzner's CoinGecko-trending mirror covers >95% of
  // those calls at zero Codex cost. Codex stays the bottom tier ONLY for
  // the case where BOTH KV and Hetzner are unhealthy.
  //
  // Kill switch `L4_PR3_DISABLE_HETZNER_TRENDING=1` skips this tier and
  // restores the pre-L4 KV -> Codex flow (e.g. if Hetzner's
  // /v1/market/trending stalls or returns an unexpected shape).
  if (!_L4_PR3_DISABLE_HETZNER_TRENDING) {
    try {
      const spectreTrending = await _fetchSpectreTrending(limitNum);
      if (spectreTrending && spectreTrending._count > 0) {
        const payload = { results: spectreTrending.results };
        // Cache so the next 5 min of cold-KV requests reuse this result.
        try { await setJsonWithTTL(trendCacheKey, payload, TREND_KV_TTL); } catch { /* ignore */ }
        return payload;
      }
    } catch (e) { console.warn('[trending] Hetzner trending tier failed:', e?.message); }
  }

  const fetchLimit = 200;
  const query = `
    query FilterTokens($networkFilter: [Int!], $limit: Int!, $offset: Int, $rankAttribute: TokenRankingAttribute!) {
      filterTokens(
        filters: { network: $networkFilter }
        limit: $limit
        offset: $offset
        rankings: [{ attribute: $rankAttribute, direction: DESC }]
      ) {
        results {
          token {
            address
            symbol
            name
            networkId
            info {
              imageThumbUrl
            }
          }
          volume24
          liquidity
          marketCap
          priceUSD
          change24
          change12
          change4
          change1
          change5m
          createdAt
        }
      }
    }
  `;

  try {
    // Hybrid fetch across 5 ranking axes for maximum coverage
    const makeQ = (attr, offset) => executeCodexQuery(query, {
      networkFilter: searchNetworks, limit: fetchLimit, offset, rankAttribute: attr,
    }).catch(() => null);

    // 7 parallel queries across 5 ranking axes (was 12). The deepest
    // pagination pages (volume24/change24 offset 400, and the 2nd pages of
    // change4/change1/change5m) pulled long-tail micro-caps that the market-cap
    // penalty in calculateTrendingScore + the top-`limitNum` slice almost
    // always discard. Keeping 2 pages of the two primary axes (volume, 24h
    // change) plus one page each of the short-window momentum axes preserves
    // the visible trending set while cutting Codex rebuild cost ~42%
    // (12 -> 7 filterTokens, each billing 2x). Result is KV-cached 5 min so
    // this rebuild runs at most once per window for the whole user base.
    const pages = await Promise.all([
      makeQ('volume24', 0),
      makeQ('volume24', fetchLimit),
      makeQ('change24', 0),
      makeQ('change24', fetchLimit),
      makeQ('change4', 0),
      makeQ('change1', 0),
      makeQ('change5m', 0),
    ]);

    let mainRaw = [];
    for (const p of pages) {
      if (p?.filterTokens?.results) mainRaw.push(...p.filterTokens.results);
    }

    const filteredMain = mainRaw.filter(r => !isSpamToken(r));

    // Deduplicate by address:networkId
    const seen = new Set();
    const deduped = [];
    for (const r of filteredMain) {
      const key = `${(r.token?.address || '').toLowerCase()}:${r.token?.networkId}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(r);
      }
    }

    if (deduped.length > 0) {
      // Score and sort by composite trending score
      const scored = deduped.map(r => ({ ...r, _trendScore: calculateTrendingScore(r) }));
      scored.sort((a, b) => b._trendScore - a._trendScore);

      // Filter out truly zero-momentum tokens (stablecoins, dormant tokens)
      const MIN_TREND_SCORE = 0.001;
      const trending = scored.filter(r => r._trendScore > MIN_TREND_SCORE);

      const results = trending.slice(0, limitNum).map(r => {
        const { _trendScore, ...rest } = r;
        return { ...rest, volume: r.volume24 || 0 };
      });
      const payload = { results };
      // Cache the assembled result so the next 5 min of requests across all
      // users skip the 12-query / ~24-op Codex rebuild. Best-effort.
      try { await setJsonWithTTL(trendCacheKey, payload, TREND_KV_TTL); } catch { /* ignore */ }
      return payload;
    }

    return { results: [] };
  } catch (error) {
    console.error('Trending error:', error);
    return { results: [] };
  }
}

// Handler for token prices (for trending bar and crypto widgets)
// 2026-06-02 Phase K2: tiered cost strategy.
//   Tier 1: Phase K snapshot KV (codex:snap:<addr:net>) - the 60s cron
//           already populates price + change24. Zero Codex cost. Covers
//           ~95% of well-known token requests since they're in top-500.
//   Tier 2: filterTokens(tokens:[misses-only]) - existing path, 2 ops via
//           lockstep, only fires for snapshot misses.
//   Tier 3: phrase fallback for unknown symbols (unchanged).
//
// Net: known-token requests go from 1 filterTokens-per-network (2 ops each)
// to one snapshot read (0 ops) when the cron is warm.
async function handleTokenPrices(symbols) {
  const results = {};

  // Split symbols into well-known (by address) vs unknown (by phrase search)
  const knownByNetwork = {}; // networkId -> [{ symbol, address }]
  const unknownSymbols = [];

  for (const symbol of symbols) {
    const upper = symbol.toUpperCase();
    const known = WELL_KNOWN_TOKENS[upper];
    if (known) {
      const netId = known.networkId;
      if (!knownByNetwork[netId]) knownByNetwork[netId] = [];
      knownByNetwork[netId].push({ symbol: upper, address: known.address });
    } else {
      unknownSymbols.push(upper);
    }
  }

  // Snapshot read - two-tier:
  //   Tier 1: cg:snap:<cgId>  - populated by refresh-cg-snapshot cron (CG, 0 Codex)
  //   Tier 2: codex:snap:<addr:net> - populated by refresh-token-snapshot (Codex, 2 ops/min)
  // Tier 1 hit rate should be 95%+ since handleTokenPrices is called for
  // well-known tokens (which are all in CG's top-500). Tier 2 is the
  // fallback for tokens that have an address but not in our CG mapping.
  const stillNeedByNetwork = {};
  if (_kvGetJson) {
    await Promise.all(
      Object.entries(knownByNetwork).flatMap(([netId, tokens]) =>
        tokens.map(async (t) => {
          const cgId = SYMBOL_TO_COINGECKO_ID[t.symbol];
          // Tier 1: try CG snapshot if we know the cgId
          if (cgId) {
            try {
              const cgCached = await _kvGetJson(`cg:snap:${cgId.toLowerCase()}`);
              if (cgCached && typeof cgCached === 'object' && cgCached.price != null) {
                const price = Number(cgCached.price) || 0;
                const change = Number(cgCached.change24) || 0;
                results[t.symbol] = { price, change, change24: change };
                return;
              }
            } catch (_) { /* fall through to tier 2 */ }
          }
          // Tier 2: try address-keyed snapshot
          const inputKey = `${t.address.toLowerCase()}:${parseInt(netId)}`;
          try {
            const cached = await _kvGetJson(`${KV_SNAPSHOT_PREFIX}${inputKey}`);
            if (cached && typeof cached === 'object' && cached.price != null) {
              const price = Number(cached.price) || 0;
              const change = Number(cached.change24) || 0;
              results[t.symbol] = { price, change, change24: change };
              return;
            }
          } catch (_) { /* fall through */ }
          if (!stillNeedByNetwork[netId]) stillNeedByNetwork[netId] = [];
          stillNeedByNetwork[netId].push(t);
        })
      )
    );
  } else {
    // No KV available - everything goes to live path.
    Object.assign(stillNeedByNetwork, knownByNetwork);
  }

  // Live path: only for snapshot misses. Existing filterTokens(tokens:)
  // query - 2 ops per network call via lockstep, but called on a strictly
  // smaller set than before.
  const batchQuery = `
    query GetTokensByAddress($networkFilter: [Int!], $tokenAddresses: [String!]) {
      filterTokens(
        filters: { network: $networkFilter }
        tokens: $tokenAddresses
        limit: 50
      ) {
        results {
          token { address symbol name networkId }
          priceUSD
          change24
        }
      }
    }
  `;

  const batchPromises = Object.entries(stillNeedByNetwork).map(async ([netId, tokens]) => {
    try {
      const data = await executeCodexQuery(batchQuery, {
        networkFilter: [parseInt(netId)],
        tokenAddresses: tokens.map(t => t.address),
      });
      const apiResults = data?.filterTokens?.results || [];
      for (const t of tokens) {
        const match = apiResults.find(r =>
          (r.token?.address || '').toLowerCase() === t.address.toLowerCase()
        );
        if (match) {
          const price = parseFloat(match.priceUSD) || 0;
          const change = parseFloat(match.change24) || 0;
          results[t.symbol] = { price, change, change24: change };
        }
      }
    } catch (e) {
      console.error(`Batch price lookup error for network ${netId}:`, e.message);
    }
  });

  // Batch query for unknown symbols: fetch by phrase in parallel
  const unknownPromises = unknownSymbols.map(async (upper) => {
    try {
      // LEVER 3 (2026-06-02): liquidity field dropped. Liquidity ranking
      // attribute KEPT so Codex still orders results by liquidity DESC. The
      // top result is already the most-liquid match.
      const query = `
        query GetPrice($phrase: String!, $limit: Int) {
          filterTokens(
            filters: { network: [1, 56, 137, 42161] }
            phrase: $phrase
            limit: $limit
            rankings: { attribute: liquidity, direction: DESC }
          ) {
            results {
              token { symbol address }
              priceUSD
              change24
            }
          }
        }
      `;
      const data = await executeCodexQuery(query, { phrase: upper, limit: 5 });
      const tokenResults = data?.filterTokens?.results || [];
      // LEVER 3: pick the first result with a valid price.
      const match = tokenResults.find(r => (parseFloat(r.priceUSD) || 0) > 0);
      if (match) {
        const price = parseFloat(match.priceUSD) || 0;
        if (price > 0) {
          results[upper] = { price, change: parseFloat(match.change24) || 0, change24: parseFloat(match.change24) || 0 };
          return;
        }
      }
      // CoinGecko fallback
      const cg = await fetchCoinGeckoPrice(upper);
      if (cg && cg.price > 0) {
        results[upper] = { price: cg.price, change: cg.change, change24: cg.change24 };
      }
    } catch (e) {
      console.error(`Price lookup error for ${upper}:`, e.message);
      const cg = await fetchCoinGeckoPrice(upper);
      if (cg && cg.price > 0) {
        results[upper] = { price: cg.price, change: cg.change, change24: cg.change24 };
      }
    }
  });

  await Promise.all([...batchPromises, ...unknownPromises]);

  // Fill any missing well-known tokens with CoinGecko fallback
  for (const tokens of Object.values(knownByNetwork)) {
    for (const t of tokens) {
      if (!results[t.symbol] || results[t.symbol].price === 0) {
        const cg = await fetchCoinGeckoPrice(t.symbol);
        if (cg && cg.price > 0) {
          results[t.symbol] = { price: cg.price, change: cg.change, change24: cg.change24 };
        }
      }
    }
  }

  return results;
}

// 2026-06-02 cost defense: Binance klines for any token with a known
// binanceSymbol. Binance is FREE and gives clean clean candles for every
// major - Codex getBars was costing 46% of our total bill (Jun 1: 721K ops)
// just to serve major-token chart loads that Binance covers perfectly.
// Codex remains the fallback for DEX-only tokens.
const BINANCE_INTERVAL_MAP = {
  '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '240': '4h',
  '720': '12h', '1D': '1d', 'D': '1d', '1W': '1w', 'W': '1w',
}
async function _fetchBinanceKlines(binanceSym, interval, fromSec, toSec) {
  const intv = BINANCE_INTERVAL_MAP[interval] || '1h'
  // Cap at 1000 bars per call - same as Binance hard limit. The visible window
  // the client requests rarely exceeds 1000 candles.
  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${intv}&startTime=${fromSec * 1000}&endTime=${toSec * 1000}&limit=1000`
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (r.ok) {
      const arr = await r.json()
      return Array.isArray(arr) ? arr : null
    }
  } catch (_) { /* try fallback */ }
  // Vercel IPs are geo-blocked from Binance. Fall back via allorigins CORS proxy
  // (same path binance-ticker + binance-klines extended-proxy use).
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(6000) })
    if (r.ok) {
      const arr = await r.json()
      return Array.isArray(arr) ? arr : null
    }
  } catch (_) { /* give up */ }
  return null
}

// Reverse-lookup: symbol -> registry entry (only for known majors).
// Symbol comes in many shapes: "BTC", "0xC02a...:1", "ETHUSDT", etc.
function _binanceSymFromInput(symbol, cgIdParam) {
  const s = String(symbol || '').toUpperCase()
  if (!s) return null
  // Direct registry hit (e.g. "BTC", "ETH")
  if (TOKEN_REGISTRY?.[s]?.binanceSymbol) return TOKEN_REGISTRY[s].binanceSymbol
  // Address form - reverse from KNOWN_TOKEN_ADDRESSES
  if (s.startsWith('0X') || s.includes(':')) {
    const addr = s.includes(':') ? s.split(':')[0] : s
    for (const [sym, info] of Object.entries(KNOWN_TOKEN_ADDRESSES || {})) {
      if (info?.address?.toUpperCase() === addr && TOKEN_REGISTRY?.[sym]?.binanceSymbol) {
        return TOKEN_REGISTRY[sym].binanceSymbol
      }
    }
  }
  // CG id form (e.g. "bitcoin" -> "BTCUSDT")
  if (cgIdParam) {
    const lower = String(cgIdParam).toLowerCase()
    for (const [sym, info] of Object.entries(TOKEN_REGISTRY || {})) {
      if (info?.coingeckoId === lower && info?.binanceSymbol) return info.binanceSymbol
    }
  }
  return null
}

// Handler for chart bars (OHLCV data)
async function handleBars(symbol, from, to, resolution, networkId, cgIdParam) {
  // 2026-06-02: Binance FIRST for any token with a binanceSymbol. Cuts
  // ~50-70% of getBars cost (charts are 46% of our total Codex bill).
  // Falls through to Codex/CG on Binance failure or non-major symbols.
  const binanceSym = _binanceSymFromInput(symbol, cgIdParam)
  if (binanceSym && from && to) {
    const klines = await _fetchBinanceKlines(binanceSym, String(resolution || '60'), parseInt(from), parseInt(to))
    if (Array.isArray(klines) && klines.length > 0) {
      // Binance kline format: [openTime, open, high, low, close, volume, closeTime, quoteVol, trades, ...]
      const bars = klines.map(k => ({
        t: Math.floor(k[0] / 1000),
        o: parseFloat(k[1]) || 0,
        h: parseFloat(k[2]) || 0,
        l: parseFloat(k[3]) || 0,
        c: parseFloat(k[4]) || 0,
        v: parseFloat(k[5]) || 0,
      })).filter(b => b.o > 0 && b.c > 0)
      if (bars.length > 0) {
        console.log(`[Bars-Binance] ${symbol} -> ${binanceSym}: ${bars.length} bars (zero Codex)`)
        return { bars, source: 'binance', chartType: 'candles' }
      }
    }
    console.log(`[Bars-Binance] ${symbol} -> ${binanceSym}: no data, falling back`)
  }

  let tokenAddress;
  let netId = parseInt(networkId) || 1;
  
  // Check if symbol is already in "tokenAddress:networkId" format
  if (symbol.includes(':')) {
    const parts = symbol.split(':');
    tokenAddress = parts[0];
    netId = parseInt(parts[1]) || netId;
  }
  // If symbol is just a token symbol (not an address), look it up
  else if (!symbol.startsWith('0x') && symbol.length < 32) {
    const upperSymbol = symbol.toUpperCase();
    const tokenInfo = KNOWN_TOKEN_ADDRESSES[upperSymbol];
    
    if (tokenInfo) {
      tokenAddress = tokenInfo.address;
      netId = tokenInfo.networkId;
    } else {
      // Unknown symbol - skip Codex, try CoinGecko market_chart below
      tokenAddress = null;
    }
  }
  // It's a raw token address
  else {
    tokenAddress = symbol;
  }
  
  // ── Codex query (requires token address) ──
  if (tokenAddress) {
    // Determine if it's a Solana address (base58, not starting with 0x)
    const isSolanaAddress = !tokenAddress.startsWith('0x') && tokenAddress.length >= 32 && tokenAddress.length <= 44;
    if (isSolanaAddress && netId === 1) {
      netId = 1399811149; // Solana network ID
    }

    // Format address correctly (lowercase for EVM, case-sensitive for Solana)
    const formattedAddress = isSolanaAddress ? tokenAddress : tokenAddress.toLowerCase();

    // Convert resolution to Codex format
    const resolutionMap = {
      '1': '1', '5': '5', '15': '15', '30': '30', '60': '60', '240': '240',
      '1D': '1D', 'D': '1D', '1W': '7D', 'W': '7D',
    };
    const requestedResolution = resolutionMap[resolution] || resolution;
    // For weekly: Codex 7D returns sparse/broken DEX data. Always fetch 1D
    // and aggregate to weeks server-side for clean candles.
    const isWeekly = requestedResolution === '7D';
    const codexResolution = isWeekly ? '1D' : requestedResolution;

    // Symbol format: "tokenAddress:networkId"
    const tokenSymbol = `${formattedAddress}:${netId}`;

    console.log(`Fetching token bars: symbol=${tokenSymbol}, from=${from}, to=${to}, resolution=${codexResolution}${isWeekly ? ' (will aggregate to weekly)' : ''}`);

    // Codex flags: strip leading-null bars + empty bars (sparse DEX tokens return
    // many null OHLCV slots between trades). Without these, the client's
    // sparse-OHLC detection treats null→0 bars as flat and falls back to
    // CoinGecko market_chart, which forces lineOnly mode and hides the
    // Candles/TradingView toggles. Mirrors the Express /api/bars query.
    // NOTE: countback removed (was hardcoded 1500). It forced Codex to return
    // 1500 candles per request regardless of the from/to window the client
    // already sends - the single biggest getBars cost driver (47% of all Codex
    // usage on Jun 1). The client always passes an explicit from/to for its
    // visible window, so the time-range query returns exactly what's needed.
    const query = `
      query GetTokenBars($symbol: String!, $from: Int!, $to: Int!, $resolution: String!) {
        getTokenBars(
          symbol: $symbol
          from: $from
          to: $to
          resolution: $resolution
          removeLeadingNullValues: true
          removeEmptyBars: true
        ) {
          s
          o
          h
          l
          c
          t
          volume
        }
      }
    `;

    let data = await executeCodexQuery(query, {
      symbol: tokenSymbol,
      from: parseInt(from),
      to: parseInt(to),
      resolution: String(codexResolution),
    });

    // Weekly: aggregate 1D bars into ISO weeks (Monday-start UTC)
    if (isWeekly && data?.getTokenBars?.t?.length > 0) {
      const dailyBars = data.getTokenBars;
      const daily = dailyBars.t.map((t, i) => ({
        t, o: dailyBars.o[i], h: dailyBars.h[i], l: dailyBars.l[i], c: dailyBars.c[i],
        v: parseFloat(dailyBars.volume?.[i]) || 0,
      })).filter(b => b.o != null && b.c != null);
      const weeks = new Map();
      for (const b of daily) {
        const d = new Date(b.t * 1000);
        const day = d.getUTCDay();
        const mondayMs = d.getTime() - ((day === 0 ? 6 : day - 1) * 86400000);
        const weekKey = Math.floor(mondayMs / 1000 / 86400) * 86400;
        if (!weeks.has(weekKey)) {
          weeks.set(weekKey, { t: weekKey, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
        } else {
          const w = weeks.get(weekKey);
          w.h = Math.max(w.h, b.h);
          w.l = Math.min(w.l, b.l);
          w.c = b.c;
          w.v += b.v;
        }
      }
      const bars = [...weeks.values()].sort((a, b) => a.t - b.t);
      console.log(`Aggregated ${daily.length} daily bars into ${bars.length} weekly bars for ${tokenSymbol}`);
      return { bars };
    }

    // Handle various response formats
    let rawBars = data?.getTokenBars;

    // Codex returns s="no_data" for empty windows — skip straight to the
    // CoinGecko fallback below instead of returning a 0-bar array that the
    // client can't distinguish from "still loading".
    if (rawBars?.s === 'no_data') {
      console.log(`Codex no_data for ${tokenSymbol}`);
    } else if (rawBars) {
      // Handle parallel arrays format (API returns { o: [...], h: [...], ... })
      if (typeof rawBars === 'object' && !Array.isArray(rawBars)) {
        if (rawBars.o && Array.isArray(rawBars.o)) {
          const bars = rawBars.t
            .map((t, i) => ({
              t, o: rawBars.o[i], h: rawBars.h[i], l: rawBars.l[i], c: rawBars.c[i],
              v: rawBars.volume?.[i] || rawBars.v?.[i] || 0,
            }))
            // Defensive: drop any bar that still has null OHLC after
            // removeEmptyBars (shouldn't happen, but matches Express behavior).
            .filter(b => b.o != null && b.c != null);
          if (bars.length > 0) {
            console.log(`Fetched ${bars.length} bars for ${tokenSymbol}`);
            return { bars };
          }
        }
      } else if (Array.isArray(rawBars) && rawBars.length > 0) {
        const bars = rawBars
          .map(bar => ({
            t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c,
            v: bar.volume || bar.v || 0,
          }))
          .filter(b => b.o != null && b.c != null);
        if (bars.length > 0) {
          console.log(`Fetched ${bars.length} bars for ${tokenSymbol}`);
          return { bars };
        }
      }
    }
    console.log(`No usable bars from Codex for ${tokenSymbol}`);
  }

  // ── CoinGecko market_chart fallback (line chart data) ──
  // Covers tokens not in KNOWN_TOKEN_ADDRESSES or when Codex returns empty.
  // Resolution chain: hardcoded SYMBOL_TO_COINGECKO_ID (BTC/ETH/SOL/etc) ->
  // caller-supplied cgIdParam -> CG /search by symbol. The /search hop is
  // what unblocks long-tail tokens like HYPE -> hyperliquid, XMR -> monero,
  // LAB -> ... that don't live in the 40-token hardcode list. Heatmap rows
  // arrive from Spectre upstream without coingecko_id, so the client can't
  // pass cgIdParam either - server-side resolution is the only way.
  const upperSymbol = (symbol || '').toUpperCase();
  const initialCgId = SYMBOL_TO_COINGECKO_ID[upperSymbol] || cgIdParam || null;

  // CG market_chart attempt with optional second try after slug resolution.
  // The heatmap caller passes cgId = the ticker symbol ("HYPE") when the
  // Spectre upstream didn't provide a slug, so a naive truthy check on
  // cgId would still fire a /coins/HYPE/market_chart that 404s. We try
  // the caller's id first; on 404 (or any failure) resolve the symbol
  // via CG /search and retry once.
  // L3 (2026-06-02): Spectre /v1/coins/{id}/market_chart returns identical
  // shape to CG (same prices/market_caps/total_volumes triples). Try Spectre
  // FIRST with 1500ms cap (heavy payloads like bitcoin can hit ~1200ms cold).
  // Falls through to CG on timeout/empty/error. Only fires AFTER Binance +
  // Codex both failed, so this is already the rare-rare fallback path.
  async function trySpectreMarketChart(coinSlug, days) {
    try {
      const url = `${SPECTRE_API_BASE_HOST}/v1/coins/${encodeURIComponent(coinSlug)}/market_chart?days=${days}`;
      const r = await fetch(url, {
        headers: { 'X-API-Key': SPECTRE_DATA_KEY, Accept: 'application/json' },
        signal: AbortSignal.timeout(1500),
      });
      if (!r.ok) return null;
      const chartData = await r.json();
      if (!chartData.prices?.length) return null;
      const volumeMap = new Map();
      if (chartData.total_volumes) {
        for (const [ts, vol] of chartData.total_volumes) volumeMap.set(ts, vol);
      }
      return chartData.prices.map(([tsMs, price]) => ({
        t: Math.floor(tsMs / 1000),
        o: price, h: price, l: price, c: price,
        v: volumeMap.get(tsMs) || 0,
      }));
    } catch (_) { return null; }
  }

  async function tryCgMarketChart(coinSlug) {
    const rangeSeconds = parseInt(to) - parseInt(from);
    const days = Math.max(1, Math.ceil(rangeSeconds / 86400));
    // L3: Spectre first (free, fast Postgres read). CG only if Spectre missed.
    const sp = await trySpectreMarketChart(coinSlug, days);
    if (sp && sp.length > 0) return sp;
    const url = `${COINGECKO_BASE_URL}/coins/${encodeURIComponent(coinSlug)}/market_chart?vs_currency=usd&days=${days}`;
    const opts = { headers: { Accept: 'application/json' } };
    if (COINGECKO_API_KEY) opts.headers['x-cg-pro-api-key'] = COINGECKO_API_KEY;
    const response = await fetch(url, opts);
    if (!response.ok) throw new Error(`CG ${response.status}`);
    const chartData = await response.json();
    if (!chartData.prices?.length) throw new Error('No prices');
    const volumeMap = new Map();
    if (chartData.total_volumes) {
      for (const [ts, vol] of chartData.total_volumes) volumeMap.set(ts, vol);
    }
    return chartData.prices.map(([tsMs, price]) => ({
      t: Math.floor(tsMs / 1000),
      o: price, h: price, l: price, c: price,
      v: volumeMap.get(tsMs) || 0,
    }));
  }

  let bars = null;
  let usedSlug = null;
  if (initialCgId) {
    try {
      bars = await tryCgMarketChart(initialCgId);
      usedSlug = initialCgId;
      console.log(`[Bars-CG] ${symbol}: ${bars.length} pts via initial cgId=${initialCgId}`);
    } catch (e) {
      console.log(`[Bars-CG] initial cgId=${initialCgId} failed (${e.message}) — trying CG /search`);
    }
  }
  if (!bars && upperSymbol && !upperSymbol.startsWith('0X')) {
    const resolved = await resolveCgSlugFromSymbol(upperSymbol);
    if (resolved && resolved !== initialCgId) {
      try {
        bars = await tryCgMarketChart(resolved);
        usedSlug = resolved;
        console.log(`[Bars-CG] ${symbol}: ${bars.length} pts via resolved slug=${resolved}`);
      } catch (e) {
        console.warn(`[Bars-CG] resolved slug=${resolved} also failed: ${e.message}`);
      }
    }
  }
  if (bars && bars.length > 0) {
    return { bars, source: 'coingecko-chart', chartType: 'line', cgId: usedSlug };
  }

  console.log(`No chart data from any source for ${symbol}`);
  return { bars: [] };
}

// Handler for ATH (All-Time High) from CoinGecko
async function handleATH(address, networkId) {
  const netId = parseInt(networkId);

  // L4 (2026-06-02): Spectre tier-1 for ATH. /v1/coins/{id} returns ATH in
  // market_data.ath.usd at zero CG quota cost. Falls through to CG only for
  // addresses we can't bridge to a cgId (long-tail DEX).
  const cgIdL4 = _addressToCgId(address, netId);
  if (cgIdL4) {
    try {
      const r = await fetch(`${SPECTRE_API_BASE_HOST}/v1/coins/${encodeURIComponent(cgIdL4)}`, {
        headers: { 'X-API-Key': SPECTRE_DATA_KEY, Accept: 'application/json' },
        signal: AbortSignal.timeout(SPECTRE_DETAIL_TIMEOUT_MS),
      });
      if (r.ok) {
        const data = await r.json();
        const md = data.market_data || {};
        const ath = Number(md.ath?.usd) || null;
        if (ath != null && ath > 0) {
          return {
            ath,
            athDate: md.ath_date?.usd || null,
            athChangePercent: Number(md.ath_change_percentage?.usd) || null,
            symbol: (data.symbol || '').toUpperCase(),
            name: data.name,
            source: 'spectre',
            found: true,
          };
        }
      }
    } catch (_) { /* fall through to CG */ }
  }

  const platformMap = {
    1: 'ethereum',
    56: 'binance-smart-chain',
    137: 'polygon-pos',
    42161: 'arbitrum-one',
    8453: 'base',
    43114: 'avalanche',
    10: 'optimistic-ethereum',
    250: 'fantom',
    1399811149: 'solana',
    4663: 'robinhood',
  };

  const platform = platformMap[netId] || 'ethereum';

  try {
    const cgUrl = `${COINGECKO_BASE_URL}/coins/${platform}/contract/${address.toLowerCase()}`;
    console.log(`Fetching ATH from CoinGecko: ${cgUrl}`);
    
    const response = await fetch(cgUrl, {
      headers: {
        'Accept': 'application/json',
        ...(COINGECKO_API_KEY ? { 'x-cg-pro-api-key': COINGECKO_API_KEY } : {})
      }
    });
    
    if (!response.ok) {
      console.log(`CoinGecko: Token not found for ${address} on ${platform}`);
      return { ath: null, athDate: null, source: 'coingecko', found: false };
    }
    
    const data = await response.json();
    
    const athPrice = data.market_data?.ath?.usd || null;
    const athDate = data.market_data?.ath_date?.usd || null;
    const athChangePercent = data.market_data?.ath_change_percentage?.usd || null;
    
    console.log(`CoinGecko ATH for ${data.symbol?.toUpperCase() || address}: $${athPrice} (${athDate})`);
    
    return {
      ath: athPrice,
      athDate: athDate,
      athChangePercent: athChangePercent,
      symbol: data.symbol?.toUpperCase(),
      name: data.name,
      source: 'coingecko',
      found: true,
    };
  } catch (error) {
    console.error('CoinGecko ATH error:', error);
    return { ath: null, athDate: null, source: 'coingecko', found: false, error: error.message };
  }
}

// Handler for token trades (fetches pairs first, then trades for each pair)
async function handleTrades(tokenAddress, networkId, limit) {
  const netId = parseInt(networkId) || 1;
  const isSolanaNetwork = netId === 1399811149;
  const queryAddress = isSolanaNetwork ? tokenAddress : tokenAddress.toLowerCase();
  
  try {
    // First, get the token's trading pairs (simplified query - token0/token1 are strings)
    const pairsQuery = `
      query GetPairs($tokenAddress: String!, $networkId: Int!) {
        listPairsForToken(
          tokenAddress: $tokenAddress
          networkId: $networkId
          limit: 5
        ) {
          address
          token0
          token1
        }
      }
    `;
    
    const pairsData = await executeCodexQuery(pairsQuery, {
      tokenAddress: queryAddress,
      networkId: netId,
    });
    
    const pairs = pairsData?.listPairsForToken || [];
    
    if (pairs.length === 0) {
      console.log(`No pairs found for token ${queryAddress}`);
      return { trades: [], pairs: [] };
    }
    
    // Take first pair (can't sort by liquidity since field isn't available)
    const mainPair = pairs[0];
    console.log(`Found ${pairs.length} pairs, fetching trades from main pair: ${mainPair.address}`);
    
    // Fetch trades from the main pair
    const tradesQuery = `
      query GetTrades($pairAddress: String!, $networkId: Int!, $limit: Int!) {
        getTokenEvents(
          query: {
            address: $pairAddress
            networkId: $networkId
          }
          limit: $limit
        ) {
          items {
            timestamp
            eventType
            eventDisplayType
            token0SwapValueUsd
            token1SwapValueUsd
            maker
            transactionHash
            data {
              ... on SwapEventData {
                amount0In
                amount0Out
                amount1In
                amount1Out
                priceUsd
                amount0
                amount1
              }
            }
          }
        }
      }
    `;

    const tradesData = await executeCodexQuery(tradesQuery, {
      pairAddress: mainPair.address.toLowerCase(),
      networkId: netId,
      limit: parseInt(limit) || 100,
    });
    
    const events = tradesData?.getTokenEvents?.items || [];
    
    // Determine which token is our target (token0 and token1 are address strings)
    const isToken0 = (mainPair.token0 || '').toLowerCase() === queryAddress.toLowerCase();
    
    // Convert from wei (18 decimals) to human-readable
    const WEI_DIVISOR = 1e18;
    
    // Transform events to trades format
    // Using same logic as local server (server/index.js) which works correctly
    const trades = events
      .filter(event => event.eventType === 'Swap' || event.eventType === 'swap' || event.data)
      .map(event => {
        // Get raw amounts (in wei) and convert to human-readable
        const amount0In = parseFloat(event.data?.amount0In || 0) / WEI_DIVISOR;
        const amount0Out = parseFloat(event.data?.amount0Out || 0) / WEI_DIVISOR;
        const amount1In = parseFloat(event.data?.amount1In || 0) / WEI_DIVISOR;
        const amount1Out = parseFloat(event.data?.amount1Out || 0) / WEI_DIVISOR;
        
        // Determine if buy or sell based on token flow
        // For our target token: if tokens going IN to the pair (user selling), it's a SELL
        // If tokens going OUT of the pair (user buying), it's a BUY
        let isBuy;
        let tokenAmount;
        
        if (isToken0) {
          // Target token is token0
          // amount0In > 0 means user sent target token to the pool (SELL)
          // amount0Out > 0 means user received target token from pool (BUY)
          isBuy = amount0Out > amount0In;
          // Use the non-zero value (the actual amount traded)
          tokenAmount = amount0In > 0 ? amount0In : amount0Out;
        } else {
          // Target token is token1
          isBuy = amount1Out > amount1In;
          tokenAmount = amount1In > 0 ? amount1In : amount1Out;
        }
        
        // Price per token from API
        const pricePerToken = parseFloat(event.data?.priceUsd || 0);

        // Uniswap v3/v4 pools: amount0In/Out come back null - the swap is
        // reported as SIGNED amount0/amount1 pool deltas instead (negative
        // = out of the pool to the user = buy), same convention as Solana.
        if (tokenAmount === 0) {
          const signed0 = parseFloat(event.data?.amount0 || 0);
          const signed1 = parseFloat(event.data?.amount1 || 0);
          if (signed0 !== 0 || signed1 !== 0) {
            const own = isToken0 ? signed0 : signed1;
            isBuy = own < 0;
            tokenAmount = Math.abs(own) / WEI_DIVISOR;
          }
        }

        // Codex labels the direction itself; trust it over our inference.
        if (event.eventDisplayType === 'Buy' || event.eventDisplayType === 'Sell') {
          isBuy = event.eventDisplayType === 'Buy';
        }

        // Calculate total USD value (amount * price)
        const totalUsd = tokenAmount * pricePerToken;

        return {
          timestamp: event.timestamp,
          type: isBuy ? 'Buy' : 'Sell',
          priceUSD: pricePerToken,
          amountToken: tokenAmount,
          amountUSD: totalUsd,
          maker: event.maker,
          txHash: event.transactionHash,
        };
      });
    
    console.log(`Fetched ${trades.length} trades for ${queryAddress}`);
    return { trades, pairs: [mainPair] };
    
  } catch (error) {
    console.error('Error fetching trades:', error);
    return { trades: [], pairs: [], error: error.message };
  }
}

// Cache-Control TTLs by endpoint (seconds).
// 2026-05-15 cost audit: bumped under-tuned values to amortize Codex cost
// across users. Token metadata + search results don't need sub-minute freshness
// (price changes flow through the dedicated batchPrices/realtime path, NOT
// these endpoints). trending bumped to 5min — Codex /api/codex?action=trending
// fans out to 12 parallel filterTokens queries on cold cache, was the single
// most expensive cache miss in the system.
const CACHE_TTLS = {
  details: 120,      // was 30 — token metadata changes slowly
  search: 60,        // was 10 — header search debounces 500ms, this amortizes typing
  trending: 300,     // was 30 — 12 parallel Codex queries on cold rebuild
  prices: 10,        // unchanged — must stay realtime
  batchPrices: 10,   // unchanged — must stay realtime
  bars: 60,          // unchanged — chart polling already resolution-aware client-side
  ath: 300,          // unchanged
  trades: 30,        // was 5 — every miss = 2 Codex queries; client polls 30s anyway
  health: 60,
};

// Codex getTokenPrices — address-based batch live prices. Mirrors the Express
// /api/tokens/batch-prices handler so useLivePrices works in production too.
// Chunks of 25 are the Codex limit; we run them in parallel and merge.
async function handleBatchPrices(tokens) {
  const safe = Array.isArray(tokens) ? tokens.filter((t) => t?.address && t?.networkId != null) : [];
  if (safe.length === 0) return { prices: [] };

  const out = [];
  let toFetch = safe;

  // Snapshot-first: serve prices from the cron-populated KV snapshot
  // (codex:snap / cg:snap). Only the misses - long-tail / DEX-only tokens not
  // in the snapshot - fall through to a live Codex getTokenPrices call. Snapshot
  // rows carry `.price`; normalize to the priceUsd string shape getTokenPrices
  // returns so the frontend parses both paths identically.
  // Fail-soft: if the snapshot read throws, fetch everything live as before.
  try {
    const { hits, misses } = await _readSnapshotBatch(safe);
    const now = Math.floor(Date.now() / 1000);
    for (const t of safe) {
      const hit = hits[t.address.toLowerCase()];
      if (hit && hit.price != null) {
        out.push({ address: t.address, networkId: parseInt(t.networkId), priceUsd: String(hit.price), timestamp: now });
      }
    }
    toFetch = misses;
  } catch (_) {
    toFetch = safe;
  }

  if (toFetch.length === 0) return { prices: out };

  const CODEX_KEY = process.env.CODEX_API_KEY;
  if (!CODEX_KEY) return { prices: out }; // snapshot hits still useful without a key

  const chunks = [];
  for (let i = 0; i < toFetch.length; i += 25) chunks.push(toFetch.slice(i, i + 25));
  const query = `
    query GetTokenPrices($inputs: [GetPriceInput!]!) {
      getTokenPrices(inputs: $inputs) {
        address
        networkId
        priceUsd
        timestamp
      }
    }
  `;
  await Promise.all(chunks.map(async (chunk) => {
    try {
      const inputs = chunk.map((t) => ({ address: t.address, networkId: parseInt(t.networkId) }));
      const resp = await fetch('https://graph.codex.io/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': CODEX_KEY },
        body: JSON.stringify({ query, variables: { inputs } }),
      });
      const data = await resp.json();
      const prices = data?.data?.getTokenPrices || [];
      out.push(...prices);
    } catch (err) {
      // Skip the chunk; partial results are still useful for the table
    }
  }));
  return { prices: out };
}

function setCacheHeaders(res, action) {
  const ttl = CACHE_TTLS[action] || 15;
  res.setHeader('Cache-Control', `public, s-maxage=${ttl}, max-age=${Math.max(Math.floor(ttl / 2), 5)}, stale-while-revalidate=${ttl * 2}`);
  // L4-PR7: CDN-Cache-Control is honored by Vercel's edge CDN REGARDLESS of
  // cookies on the response. The standard Cache-Control header above is
  // silently ignored for cookie-bearing (auth-gate / Privy) responses, which
  // means edge caching has been off for every logged-in user. KV cache-aside
  // (see cacheAside helper) collapses concurrent identical requests to one
  // upstream Codex call within a region, but each NEW edge node still cold-
  // calls the lambda. CDN-Cache-Control makes the response shareable across
  // ALL users at the edge - origin hits become bounded by cron/TTL instead of
  // user count. Only set on user-agnostic actions (all entries in CACHE_TTLS
  // are public market data; per-user data goes through user.js / swap.js /
  // referral.js which never call this helper).
  res.setHeader('CDN-Cache-Control', `public, s-maxage=${ttl}`);
}

// ── Durable KV cache-aside + in-flight dedup for Codex handlers ──────────────
// WHY: every /api/codex request carries an auth cookie (auth-gate / beta /
// Privy), so Vercel's CDN treats responses as private and SILENTLY IGNORES the
// `s-maxage` header set by setCacheHeaders(). That means the HTTP-header
// "cache" does NOTHING for logged-in users - every request hit the lambda and
// fired fresh Codex queries. Only `trending` had a real KV cache; bars/search/
// details-batch/prices were effectively uncached. This wraps those handlers in
// the SAME Upstash KV cache the trending path already uses (KV is wired on the
// spectre-app-research project - KV_REST_API_URL etc. confirmed present), so a
// result is shared across all lambdas + users for its TTL.
//
// `_codexInflight` collapses concurrent identical requests within a single
// lambda to one upstream call (the research /token iframe double-mount fires
// the same getBars from two surfaces near-simultaneously).
const _codexInflight = new Map();
async function cacheAside(cacheKey, ttlSeconds, builder, { acceptCached } = {}) {
  // 1. KV read
  try {
    const cached = await getJsonWithTTL(cacheKey);
    if (cached != null && (!acceptCached || acceptCached(cached))) return cached;
  } catch { /* KV read best-effort; fall through to build */ }
  // 2. In-flight dedup (per-lambda)
  const pending = _codexInflight.get(cacheKey);
  if (pending) return pending;
  const p = (async () => {
    const fresh = await builder();
    // Only cache results worth caching (caller decides via acceptCached;
    // default: cache any non-null result). Never cache nulls/empties that a
    // retry might resolve.
    try {
      if (fresh != null && (!acceptCached || acceptCached(fresh))) {
        await setJsonWithTTL(cacheKey, fresh, ttlSeconds);
      }
    } catch { /* KV write best-effort */ }
    return fresh;
  })().finally(() => { _codexInflight.delete(cacheKey); });
  _codexInflight.set(cacheKey, p);
  return p;
}

// KV TTLs (seconds) for the durable cache-aside layer. Independent of the
// HTTP CACHE_TTLS above (which don't work for cookie-bearing requests).
const KV_TTLS = {
  bars: 60,          // legacy default; resolutionAwareBarsTTL below picks per-resolution.
  search: 60,        // identical queries within a minute share one upstream
  detailsBatch: 120, // token-card grids; metadata moves slowly
  prices: 30,        // price freshness vs cost balance
  // Phase J1: trades was uncached (HTTP header only). Each miss = listPairsForToken
  // + getTokenEvents. research /token embeds the trading chart so the same trades
  // call fires from two surfaces near-simultaneously; this collapses that burst +
  // concurrent viewers of hot tokens. Live updates still arrive via the SSE stream.
  trades: 12,
  // batchPrices: welcome-trending price overlay polls this every 30s with the
  // SAME top-N token list across all users - cache-aside collapses that storm
  // to one upstream call per window + in-flight dedup. Snapshot-first inside
  // the handler cuts the remaining miss further.
  batchPrices: 20,
  // ath: all-time-high barely moves intraday; per-token-open calls were fully
  // uncached. 1h KV cache makes ATH effectively free across viewers.
  ath: 3600,
};

// Phase K10 (2026-06-02): TTL grows with the resolution. A 1H bar can't
// possibly change for 59 minutes after it closes, so caching it 5 minutes
// is leaving cost on the table. A 1D bar is stable for hours. Polling rates
// across the chart hooks (Phase 1) are matched, so live polls find the
// cached entry on every tick instead of issuing a fresh upstream call.
//   1m  -> 30s  (was 60s)
//   5m  -> 60s
//   15m -> 90s
//   30m -> 120s
//   1h  -> 300s  (5min - chart polls every 120s, gets cache hit 60% of the time)
//   4h  -> 600s
//   1D  -> 1800s (30min - daily chart loads once per session per token)
//   1W  -> 3600s (1h)
const RESOLUTION_TTL_SEC = {
  '1': 30, '5': 60, '15': 90, '30': 120,
  '60': 300, '240': 600,
  '1D': 1800, 'D': 1800,
  '1W': 3600, 'W': 3600, '7D': 3600,
};
function resolutionAwareBarsTTL(resolution) {
  return RESOLUTION_TTL_SEC[String(resolution || '60')] || 60;
}

import { codexGuard } from './_lib/codex-guard.js';
import { verifyPrivyToken } from './_lib/auth.js';
import { rateLimit, userRateLimit } from './_lib/ratelimit.js';
import { isAuthGateValid } from './auth-gate.js';
import { sealGatedResponse } from './_lib/gate-cache.js';
import { getJsonWithTTL, setJsonWithTTL } from './_lib/kv.js';

// Body size cap for POST batch endpoints — Codex pricing is per-call but
// payload shape lets a single request batch up to 25 token addresses. 16 KB
// comfortably fits the legitimate `batchPrices` POST while rejecting obvious
// abuse payloads.
const MAX_POST_BYTES = 16 * 1024;

export default async function handler(req, res) {
  const action = req.query?.action || 'health';
  if (await codexGuard(req, res, { action })) return;

  // Wave 5h API-farming gate (SEC-20260516-001): tiered rate limit closes
  // the unauthenticated farming hole while preserving the showcase iframe
  // (auth-gate cookie carries `details-batch`, see SEC-20260513-017) and
  // anyone with a valid Privy session.
  //   - Privy user  -> per-user cap (catches stolen-token amplification)
  //   - auth-gate   -> per-IP cap   (catches shared NAT abuse from demo)
  //   - neither     -> 401
  //
  // `health` stays open so external monitors don't 401, and codexGuard above
  // already handles the public showcase trending fetch with its own caps.
  if (action !== 'health') {
    const userId = await verifyPrivyToken(req);
    if (userId) {
      if (await userRateLimit(res, { bucket: 'codex', userId, max: 60, windowMs: 60_000 })) return;
    } else if (isAuthGateValid(req)) {
      if (await rateLimit(req, res, { bucket: 'codex-anon', max: 30, windowMs: 60_000 })) return;
    } else {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // GATE-CACHE SEAL (see _lib/gate-cache.js): the gate runs HERE, inside the
    // function, while the handlers below set `public, s-maxage=…`. Composed,
    // those two let a warm edge entry serve a gated payload to a caller who
    // never reached this line — measured on /api/private/* 2026-08-25.
    // data-api was sealed then; every other gated entrypoint was not.
    sealGatedResponse(res);
  }

  // Reject oversize POST bodies before any upstream call.
  // SEC-20260518-001: content-length is a CLIENT-controlled header — a
  // malicious client can send `Content-Length: 1` with a 200 KB body and
  // bypass this check. Vercel parses req.body for us before the handler
  // runs, so the second-best defense is to measure the actual parsed JSON
  // size. We keep the content-length pre-filter as a fast-path reject
  // (cheap, fires before we touch the body) AND measure the parsed body
  // after — whichever trips first, return 413.
  if (req.method === 'POST') {
    const len = parseInt(req.headers?.['content-length'] || '0', 10);
    if (Number.isFinite(len) && len > MAX_POST_BYTES) {
      return res.status(413).json({ error: 'Payload too large' });
    }
    // Defense-in-depth: measure the actual parsed body. Vercel parsed it
    // before our handler ran, so this catches the content-length spoof.
    if (req.body != null) {
      const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
      if (bodyStr.length > MAX_POST_BYTES) {
        return res.status(413).json({ error: 'Payload too large' });
      }
    }
  }

  try {
    switch (action) {
      case 'details': {
        const { address, networkId } = req.query;
        if (!address) {
          return res.status(400).json({ error: 'Address is required' });
        }
        const result = await handleTokenDetails(address, networkId);
        if (!result) {
          return res.status(404).json({ error: 'Token not found' });
        }
        setCacheHeaders(res, 'details');
        return res.json(result);
      }

      case 'details-batch': {
        const { ids } = req.query;
        if (!ids) {
          return res.status(400).json({ error: 'ids is required (format: addr:networkId,addr:networkId)' });
        }
        if (ids.split(',').length > 50) {
          return res.status(400).json({ error: 'Max 50 addresses per batch' });
        }
        // Canonical key: sort the id list so any caller ordering shares one entry.
        const sortedIds = ids.split(',').map(s => s.trim()).filter(Boolean).sort().join(',');
        const result = await cacheAside(`codex:detbatch:${sortedIds}`, KV_TTLS.detailsBatch, () => handleTokenDetailsBatch(ids));
        setCacheHeaders(res, 'details');
        return res.json(result);
      }
      
      case 'search': {
        const { q, networks } = req.query;
        if (!q) {
          return res.status(400).json({ error: 'Search query is required' });
        }
        const networkIds = networks ? networks.split(',').map(n => parseInt(n)) : null;
        const sortedNets = networkIds ? [...networkIds].sort((a, b) => a - b).join(',') : 'all';
        const kvKey = `codex:search:${String(q).toLowerCase().trim()}:${sortedNets}`;
        // acceptCached: never cache an EMPTY result set (2026-08-14, mirrors
        // the trading-app fix) - empties are usually transient backfill/Codex
        // starvation, and a cached empty pinned "No matches" for the whole
        // TTL on tokens Codex ranks #1 by name. Short edge TTL keeps genuine
        // no-match queries cheap without pinning them at the CDN either.
        const result = await cacheAside(kvKey, KV_TTLS.search, () => handleTokenSearch(q, networkIds),
          { acceptCached: (v) => Array.isArray(v?.results) && v.results.length > 0 });
        if (!result || !Array.isArray(result?.results) || result.results.length === 0) {
          res.setHeader('Cache-Control', 'public, s-maxage=5');
          res.setHeader('CDN-Cache-Control', 'public, s-maxage=5');
          return res.json(result || { results: [] });
        }
        setCacheHeaders(res, 'search');
        return res.json(result);
      }
      
      case 'trending': {
        const { networks, limit } = req.query;
        const networkIds = networks ? networks.split(',').map(n => parseInt(n)) : null;
        const limitNum = Math.min(parseInt(limit) || 50, 300);
        const result = await handleTrendingTokens(networkIds, limitNum);
        setCacheHeaders(res, 'trending');
        return res.json(result);
      }
      
      case 'prices': {
        const { symbols } = req.query;
        if (!symbols) {
          return res.status(400).json({ error: 'Symbols are required' });
        }
        const symbolList = symbols.split(',');
        const sortedSyms = symbolList.map(s => s.trim().toUpperCase()).filter(Boolean).sort().join(',');
        const result = await cacheAside(`codex:prices:${sortedSyms}`, KV_TTLS.prices, () => handleTokenPrices(symbolList));
        setCacheHeaders(res, 'prices');
        return res.json(result);
      }

      case 'batchPrices': {
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'POST required' });
        }
        const tokens = req.body?.tokens;
        if (!Array.isArray(tokens) || tokens.length === 0) {
          return res.status(400).json({ error: 'tokens array required (each: {address, networkId})' });
        }
        // Deterministic key over the sorted token list so all users polling the
        // same list (welcome-trending top-N) share ONE upstream call per window.
        // acceptCached: never cache an empty result (transient Codex failure).
        const bpKey = `codex:batchprices:${tokens
          .filter((t) => t?.address && t?.networkId != null)
          .map((t) => `${String(t.address).toLowerCase()}:${t.networkId}`)
          .sort()
          .join(',')}`;
        const hasPricesFn = (r) => Array.isArray(r?.prices) && r.prices.length > 0;
        const result = await cacheAside(bpKey, KV_TTLS.batchPrices,
          () => handleBatchPrices(tokens),
          { acceptCached: hasPricesFn });
        setCacheHeaders(res, 'batchPrices');
        return res.json(result);
      }
      
      case 'bars': {
        const { symbol, from, to, resolution, networkId, cgId } = req.query;
        if (!symbol || !from || !to) {
          return res.status(400).json({ error: 'Missing required parameters: symbol, from, to' });
        }
        const res2 = resolution || '60';
        // Bucket `to` by the resolution's candle interval so all users viewing
        // the same token+timeframe within one candle window share ONE cached
        // getBars (the bleeder: getBars was 47% of all Codex usage, uncached).
        // 2026-06-10: `from` (bucketed) JOINED the key. It was deliberately
        // omitted ("rolling window") — but long-range presets (ALL/YTD) and
        // default loads share the same `to` with wildly different `from`, so
        // whichever window landed first served truncated/oversized history to
        // the other (DSYNC ALL showed 2 months). fromBucket separates windows
        // while still collapsing concurrent same-window viewers.
        const bucketSec = ({ '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, '240': 14400, '1D': 86400, 'D': 86400, '1W': 604800, 'W': 604800 })[res2] || 3600;
        const bucket = Math.floor(parseInt(to) / bucketSec);
        const fromBucket = Math.floor(parseInt(from) / bucketSec);
        const kvKey = `codex:bars:${symbol}:${res2}:${networkId || 1}:${cgId || ''}:${fromBucket}:${bucket}`;
        // acceptCached: only read/write entries that actually contain bars, so a
        // transient empty response never poisons the cache (matches the prior
        // no-store-on-empty behavior).
        const hasBarsFn = (r) => Array.isArray(r?.bars) && r.bars.length > 0;
        // Phase K10: TTL scales with the candle resolution (see
        // resolutionAwareBarsTTL above). 1H/1D charts get aggressive caching
        // because their bars are closed for tens of minutes after the bucket.
        const barsTtl = resolutionAwareBarsTTL(res2);
        const result = await cacheAside(kvKey, barsTtl,
          () => handleBars(symbol, from, to, res2, networkId || 1, cgId),
          { acceptCached: hasBarsFn });
        if (hasBarsFn(result)) {
          setCacheHeaders(res, 'bars');
        } else {
          // Mirror Cache-Control on CDN-Cache-Control so an empty-bars
          // response can't be edge-cached either (transient outages would
          // otherwise serve "no bars" to every viewer for the TTL).
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('CDN-Cache-Control', 'no-store');
        }
        return res.json(result);
      }

      case 'ath': {
        const { address, networkId } = req.query;
        if (!address) {
          return res.status(400).json({ error: 'Address is required' });
        }
        // ATH barely moves intraday - cache it for an hour, shared across all
        // viewers. acceptCached: only cache a real positive ATH so a transient
        // upstream failure (ath: null) can't suppress it for the full TTL.
        const athKey = `codex:ath:${String(address).toLowerCase()}:${networkId || 1}`;
        const hasAthFn = (r) => Number.isFinite(r?.ath) && r.ath > 0;
        const result = await cacheAside(athKey, KV_TTLS.ath,
          () => handleATH(address, networkId || 1),
          { acceptCached: hasAthFn });
        setCacheHeaders(res, 'ath');
        return res.json(result);
      }
      
      case 'trades': {
        const { address, networkId, limit } = req.query;
        if (!address) {
          return res.status(400).json({ error: 'Address is required' });
        }
        const _net = networkId || 1;
        const _lim = limit || 50;
        const result = await cacheAside(
          `codex:trades:${String(address).toLowerCase()}:${_net}:${_lim}`,
          KV_TTLS.trades,
          () => handleTrades(address, _net, _lim),
          // Only cache successful pair-resolved results - never errors or
          // no-pairs empties that a retry might resolve.
          { acceptCached: (v) => v != null && !v.error && Array.isArray(v.pairs) && v.pairs.length > 0 },
        );
        setCacheHeaders(res, 'trades');
        return res.json(result);
      }
      
      case 'health':
      default:
        setCacheHeaders(res, 'health');
        return res.json({ status: 'ok', timestamp: new Date().toISOString() });
    }
  } catch (error) {
    console.error('API Error:', error.message, error.stack);
    const isKeyMissing = error.message.includes('CODEX_API_KEY');
    return res.status(isKeyMissing ? 503 : 500).json({ 
      error: error.message,
      hint: isKeyMissing ? 'Set CODEX_API_KEY in Vercel environment variables' : undefined
    });
  }
}
