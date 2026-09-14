/**
 * Vercel Serverless Function - Codex API Proxy
 * Handles all token data requests
 */
import { getTokenColorsBatch, getCodexCache, setCodexCache, recordTokenViewKv, getTopTokenViewsKv } from './_lib/kv.js';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const codexMetricsKv = _require('../../../packages/server/lib/codex-metrics-kv');

// Attach KV-cached `dominantColor` to token data. Accepts:
//   - a single token object with `logo`
//   - a `{ results: [tokens] }` envelope
//   - a `{ tokens: [tokens] }` envelope
//   - a flat array of tokens
// Lookup-only. Cache misses → `dominantColor: null` and the frontend falls
// back to its own canvas extraction (which POSTs back to KV).
async function attachDominantColors(input) {
  if (!input) return input;
  let arr = null;
  if (Array.isArray(input)) arr = input;
  else if (input.results && Array.isArray(input.results)) arr = input.results;
  else if (input.tokens && Array.isArray(input.tokens)) arr = input.tokens;
  else if (input.logo) arr = [input];
  if (!arr || arr.length === 0) return input;
  const logoUrls = arr.map((t) => t?.logo).filter(Boolean);
  if (logoUrls.length === 0) return input;
  let colorMap = {};
  try {
    colorMap = await getTokenColorsBatch(logoUrls);
  } catch {
    /* KV unavailable - return tokens without colors */
  }
  for (const token of arr) {
    if (token && token.logo) token.dominantColor = colorMap[token.logo] || null;
  }
  return input;
}

// Traction-weighted trending scorer + FREE DexScreener enrichment. Content
// byte-identical to packages/server/lib/{trending-score,dexscreener-enrich}.js
// (the dev Express route's source) - mirror any change to both. The .cjs
// extension is REQUIRED: apps/trading/package.json declares "type":"module",
// so a plain .js here would be parsed as ESM and its module.exports ignored.
// .cjs forces CommonJS regardless, and createRequire loads it (this fn is ESM).
const { scoreTraction } = _require('./_lib/trending-score.cjs');
const { enrichFromDexScreener, norm: dsNorm } = _require('./_lib/dexscreener-enrich.cjs');
// Robinhood Chain candidate discovery. Codex `filterTokens` has NO coverage for
// networkId 4663 (it returns an empty result, not an error), so this supplies
// the candidate union the Codex passes supply for every other chain.
const { discoverRobinhoodCandidates, hydrateRobinhoodRows, isRobinhoodOnly } = _require('./_lib/robinhood-chain.cjs');
// DexScreener change is clean percent; fmtChange (frontend) + scoreTraction
// expect Codex dual-format (|v|<1 ratio, |v|>=1 percent). Convert so both handle
// it: sub-100% -> ratio, >=100% -> percent. null passes through (renders "-").
const toCodexLikePct = (p) => (p == null || !isFinite(p)) ? null : (Math.abs(p) < 100 ? p / 100 : p);
// Pick a change window: prefer DexScreener's clean-percent value, else the
// token's native Codex (codex-format) value. When BOTH sources genuinely lack
// the window, return null so the cell renders "-" (unknown) instead of a
// misleading "0.00%" (flat). This matters most for 6h - Codex has NO native 6h
// window, so a DexScreener h6 miss is truly unknown, not flat. A source that
// actually reports 0 is a real flat move and is preserved as 0.
const pickWin = (dexClean, codexNative) => {
  const d = toCodexLikePct(dexClean);
  if (d != null) return d;
  const c = Number(codexNative);
  return (codexNative != null && isFinite(c)) ? c : null;
};
// Narrative/copycat collapse. DexScreener's board is ~60% copycats of a handful
// of narratives (4x "GameStop", 7x "Swole*", 8x Robinhood/4663 on the list Gleb
// sent); a live `search?q=GameStop` returned 21 distinct contracts, 20 of them
// sharing the ticker "GME". Showing one row per NARRATIVE instead of one row per
// contract is the single most visible quality difference vs them.
//
// Clustering is on the normalized NAME (cross-chain), not the symbol: two
// legitimately different projects can share a ticker (memecoin HYPE vs
// Hyperliquid HYPE) and must both survive, which is why the pre-existing
// same-symbol-AND-same-name key is kept as the fallback for short/blank names.
const _COPYCAT_FILLER = /\b(baby|mini|wrapped|official|the|token|coin|inu|classic|new|v2|v3)\b/g;
const _LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' };
const normalizeNarrative = (s) => String(s || '')
  .toLowerCase()
  .replace(/^\$/, '')
  .replace(/[^\w\s]+/g, ' ')      // punctuation -> separator, so "Game-Stop" == "Game Stop"
  .replace(_COPYCAT_FILLER, ' ')
  .replace(/\s+\d+\s*$/, ' ')     // trailing standalone numerals ("Robinhood 4663")
  .replace(/[^a-z0-9]+/g, '')
  .replace(/[013457]/g, (c) => _LEET[c]); // "Sw0le" == "Swole"

// Collapse each cluster to its strongest member. Rows MUST be pre-sorted
// best-first: the survivor is the highest-SCORED member, which after the
// liq/mcap demotion is reliably the real token rather than a fake-mcap
// impersonator. Liquidity breaks score ties (the deeper pool is the original).
const dedupTrendingByIdentity = (rows) => {
  const keyFor = (r) => {
    const t = r.token || {};
    const n = normalizeNarrative(t.name);
    if (n.length >= 4) return `n:${n}`;
    // Short or missing name -> fall back to the original exact identity key.
    return `x:${String(t.symbol || '').toUpperCase()}|${String(t.name || '').toUpperCase()}|${t.networkId}`;
  };
  const kept = new Map(); // key -> row
  const out = [];
  // Same ticker, same chain, and one name CONTAINS the other ("Asteroid" inside
  // "Asteroid Shiba") - a derivative of the row already on the board rather than
  // a separate project. Deliberately narrower than matching on ticker alone,
  // which would wrongly merge the two legitimate HYPEs (neither "hyperliquid"
  // nor "hypememecoin" contains the other).
  const derivativeOf = (r) => {
    const t = r.token || {};
    const sym = String(t.symbol || '').toUpperCase();
    const n = normalizeNarrative(t.name);
    if (!sym || n.length < 4) return null;
    for (const cand of kept.values()) {
      const ct = cand.token || {};
      if (String(ct.symbol || '').toUpperCase() !== sym) continue;
      if (ct.networkId !== t.networkId) continue;
      const cn = normalizeNarrative(ct.name);
      if (cn.length < 4) continue;
      if (cn.includes(n) || n.includes(cn)) return cand;
    }
    return null;
  };
  for (const r of rows) {
    const k = keyFor(r);
    // Track WHICH key the survivor is filed under - a derivative match is filed
    // under the survivor's key, not the incoming row's, so the swap below has to
    // replace the right entry.
    let prev = kept.get(k);
    let prevKey = k;
    if (!prev) {
      const d = derivativeOf(r);
      if (d) { prev = d; prevKey = keyFor(d); }
    }
    if (!prev) {
      kept.set(k, r);
      out.push(r);
      continue;
    }
    // Same narrative, different contract. Record it on the survivor so the board
    // can show "+N similar" instead of silently hiding what it filtered.
    const t = r.token || {};
    if (!prev._similar) prev._similar = [];
    if (prev._similar.length < 8) {
      prev._similar.push({
        symbol: t.symbol, name: t.name, address: t.address, networkId: t.networkId,
        liquidity: r.liquidity || 0, marketCap: r.marketCap || 0,
      });
    }
    // A tied score means the ranking could not separate them; prefer the deeper
    // pool, which is the one an impersonator cannot cheaply fake.
    const pt = prev.token || {};
    if ((r._trendScore || 0) === (prev._trendScore || 0) && (r.liquidity || 0) > (prev.liquidity || 0)) {
      r._similar = prev._similar;
      r._similar.unshift({
        symbol: pt.symbol, name: pt.name, address: pt.address, networkId: pt.networkId,
        liquidity: prev.liquidity || 0, marketCap: prev.marketCap || 0,
      });
      delete prev._similar;
      out[out.indexOf(prev)] = r;
      kept.set(prevKey, r);
    }
  }
  return out;
};

// API Key from environment variable (set in Vercel dashboard)
const CODEX_API_KEY = process.env.CODEX_API_KEY;
const CODEX_BASE_URL = 'https://graph.codex.io/graphql';
// The Codex key enforces an origin allowlist. This serverless function is a
// server-to-server caller (no Origin header by default -> "unauthorized
// origin: undefined"), so send the one allowed origin explicitly. Override
// via CODEX_ORIGIN env if the allowlist changes.
const CODEX_ORIGIN = process.env.CODEX_ORIGIN || 'https://app.spectreai.io';
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
const COINGECKO_BASE_URL = 'https://pro-api.coingecko.com/api/v3';

// All supported Codex networks
const CODEX_NETWORKS = {
  1399811149: 'Solana',
  1: 'Ethereum',
  56: 'BNB Chain',
  137: 'Polygon',
  42161: 'Arbitrum',
  8453: 'Base',
  43114: 'Avalanche',
  10: 'Optimism',
  250: 'Fantom',
  4663: 'Robinhood Chain',
};

const ALL_NETWORK_IDS = Object.keys(CODEX_NETWORKS).map(n => parseInt(n));

// Popular Solana tokens - fetch directly by address for reliable results
const POPULAR_SOLANA_TOKENS = {
  'wif': { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: '$WIF', name: 'dogwifhat' },
  '$wif': { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: '$WIF', name: 'dogwifhat' },
  'dogwifhat': { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: '$WIF', name: 'dogwifhat' },
  'bonk': { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk' },
  'jup': { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter' },
  'jupiter': { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter' },
  'pyth': { address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', symbol: 'PYTH', name: 'Pyth Network' },
  'jito': { address: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', symbol: 'JTO', name: 'Jito' },
  'jto': { address: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', symbol: 'JTO', name: 'Jito' },
  'render': { address: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', symbol: 'RENDER', name: 'Render' },
  'rndr': { address: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', symbol: 'RENDER', name: 'Render' },
  'popcat': { address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', symbol: 'POPCAT', name: 'Popcat' },
  'wen': { address: 'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk', symbol: 'WEN', name: 'Wen' },
  'bome': { address: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82', symbol: 'BOME', name: 'Book of Meme' },
  'moodeng': { address: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', symbol: 'MOODENG', name: 'Moo Deng' },
  'moo deng': { address: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', symbol: 'MOODENG', name: 'Moo Deng' },
  'sol': { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Wrapped SOL' },
};

// Extract operation name from a GraphQL query string for metrics
function _extractOperation(query) {
  if (!query) return 'unknown';
  const m = query.match(/^\s*(?:query|mutation|subscription)\s+(\w+)/);
  return m ? m[1] : (query.match(/\b(getTokenBars|filterTokens|listPairsForToken|getTokenEvents|token)\b/)?.[1] || 'unknown');
}

// Codex outage circuit breaker (2026-07-16). graph.codex.io went fully dark
// (TLS handshake succeeds, requests hang to timeout) and every trending/
// screener cache miss stacked parallel 5s hangs per user poll - pure wasted
// function-seconds all day. After 3 consecutive TRANSPORT failures (timeout/
// network - a GraphQL data error means the service is UP and resets the count)
// the breaker opens for 120s and Codex calls fail INSTANTLY. Module state
// persists per warm lambda, collapsing the hang storm to one probe per
// instance per 2 minutes. Mirrors the dev Express breakers.codex.
const _codexBreaker = { fails: 0, openUntil: 0 };
const CODEX_BREAKER_TRIP = 3;
const CODEX_BREAKER_COOLDOWN_MS = 120_000;

async function executeCodexQuery(query, variables = {}, opts) {
  const startTime = Date.now();
  const operation = _extractOperation(query);
  let errored = false;
  if (Date.now() < _codexBreaker.openUntil) {
    try { codexMetricsKv.trackQuery(operation, 0, true, 'prod-trading'); } catch {}
    const err = new Error('codex_breaker_open');
    err.breakerOpen = true;
    throw err;
  }
  try {
    const response = await fetch(CODEX_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': CODEX_API_KEY,
        'Origin': CODEX_ORIGIN,
      },
      body: JSON.stringify({ query, variables }),
      // Hard timeout so a hung Codex socket can't stall the whole snapshot
      // assembly (KV-cold lambdas have no other ceiling). Default 5s.
      signal: AbortSignal.timeout(opts?.timeoutMs || 5000),
    });

    const data = await response.json();
    _codexBreaker.fails = 0; // any parsed response = service reachable

    if (data.errors) {
      errored = true;
      const gqlErr = new Error(data.errors[0]?.message || 'GraphQL error');
      gqlErr.isGraphQLError = true; // service is UP - never trips the breaker
      throw gqlErr;
    }

    return data.data;
  } catch (err) {
    errored = true;
    // Transport-level failure (timeout / network / non-JSON): count toward the
    // breaker. GraphQL data errors are tagged above and never trip it.
    if (!err?.isGraphQLError) {
      _codexBreaker.fails += 1;
      if (_codexBreaker.fails >= CODEX_BREAKER_TRIP) {
        _codexBreaker.openUntil = Date.now() + CODEX_BREAKER_COOLDOWN_MS;
        _codexBreaker.fails = 0;
        console.warn(`[codex-breaker] OPEN for ${CODEX_BREAKER_COOLDOWN_MS / 1000}s (consecutive transport failures)`);
      }
    }
    throw err;
  } finally {
    try { codexMetricsKv.trackQuery(operation, Date.now() - startTime, errored, 'prod-trading'); } catch {}
  }
}

/** Returns data.data even when data.errors exists (partial success). */
async function executeCodexQueryAllowPartial(query, variables = {}, opts) {
  const startTime = Date.now();
  const operation = _extractOperation(query);
  let errored = false;
  // Shares the outage breaker with executeCodexQuery (null = the contract's
  // existing "no data" shape, so callers degrade exactly like a timeout).
  if (Date.now() < _codexBreaker.openUntil) {
    try { codexMetricsKv.trackQuery(operation, 0, true, 'prod-trading'); } catch {}
    return null;
  }
  try {
    const response = await fetch(CODEX_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': CODEX_API_KEY,
        'Origin': CODEX_ORIGIN,
      },
      body: JSON.stringify({ query, variables }),
      // Hard timeout - same 5s default as executeCodexQuery. AbortError is
      // caught below and returns null (partial-success contract preserved).
      signal: AbortSignal.timeout(opts?.timeoutMs || 5000),
    });
    const data = await response.json();
    _codexBreaker.fails = 0; // any parsed response = service reachable
    if (data.errors) errored = true;
    return data.data || null;
  } catch (err) {
    errored = true;
    _codexBreaker.fails += 1;
    if (_codexBreaker.fails >= CODEX_BREAKER_TRIP) {
      _codexBreaker.openUntil = Date.now() + CODEX_BREAKER_COOLDOWN_MS;
      _codexBreaker.fails = 0;
      console.warn(`[codex-breaker] OPEN for ${CODEX_BREAKER_COOLDOWN_MS / 1000}s (consecutive transport failures)`);
    }
    return null;
  } finally {
    try { codexMetricsKv.trackQuery(operation, Date.now() - startTime, errored, 'prod-trading'); } catch {}
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
  
  // "No data" is NOT "dust" (2026-08-14, the trencher/Megatron misses). The
  // slim search selection (LEVER 3) carries no liquidity/marketCap - those
  // fields arrive only via the budgeted scanner backfill, and when the
  // backfill starves (cold Hetzner rows) every un-backfilled row used to hit
  // the dust disqualifiers below and the WHOLE result set scored -1000 ->
  // prod answered "No matches" for tokens Codex ranks #1 by name. Same rule
  // isSpamToken adopted 2026-06-04: judge liq/mcap only when the row actually
  // carries them; rows without market data rank LOW (no liq/volume bonuses),
  // they don't vanish.
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

// Handler for token details - history:
//   Phase J2: ONE filterTokens(tokens:) call returns market data + full token
//   metadata together. Was TWO ops; the nested token{} now exposes
//   decimals/socialLinks/info, so the second op is redundant.
//   Phase K4 (2026-06-02): snapshot-first read. Cron at
//   apps/trading/api/cron/refresh-token-snapshot.js fires ONE filterTokens
//   every 60s covering the top tokens and writes each row to KV as
//   `codex:v1:snap:<addr:net>`.
//   L4-PR1 (2026-06-03): Hetzner becomes PRIMARY. Order is now
//     1. KV codex:v1:snap (sub-ms; cron-warmed top tokens)
//     2. Hetzner /v1/coins/{cgId} (~80-400ms; majors with cgId bridge)
//     3. spectre-data triple-tier (KV cg:snap + Hetzner /v1/coins/markets +
//        /v1/scanner/token/{addr}) for backfill of volume/liquidity/holders
//     4. Codex filterTokens (residual fallback only — long-tail DEX tokens
//        Hetzner hasn't indexed)
//   Kill switch: set env L4_FORCE_CODEX_PRIMARY=1 to restore pre-L4 ordering
//   (Hetzner becomes the backfill, Codex becomes primary). Useful if
//   Hetzner has an outage during rollout week.
// getCodexCache comes from the static import at the top of this file. The
// previous `require('./_lib/kv.js')` here threw ReferenceError in this ESM
// module (bare require does not exist), the catch swallowed it, and the KV
// snap tier was silently dead in prod - every details read paid the live path.
const _trKvSnapGet = getCodexCache;

// Lever 3 + L4-PR1: spectre-data helper init block consolidated below at
// the second `let _spectreData` (~line 327) - the duplicate that was here
// caused (silently-tolerated by Vercel) `let` re-declaration. Removed
// 2026-06-03 as part of L4-PR3 to keep top-level scope clean.

async function _readSnapshotSingle(address, netId) {
  if (!_trKvSnapGet) return null;
  const isEvm = address.startsWith('0x');
  const canonicalKey = isEvm ? `${address.toLowerCase()}:${netId}` : `${address}:${netId}`;
  try {
    const cached = await _trKvSnapGet('snap', canonicalKey);
    if (cached && typeof cached === 'object' && cached.price != null) return cached;
  } catch (_) { /* fall through */ }
  return null;
}

// L4-PR1: dynamic import of the trading-port of spectre-data.js helper. The
// helper is an ES module (export keyword) so we cannot static-require it
// from this file (which mixes CJS createRequire + ESM dispatch). Top-level
// await on dynamic import populates _spectreData before any handler fires.
// Mirrors the research-app pattern from PR #715.
let _spectreData = {
  getMarketDataForAddresses: async () => new Map(),
  getMarketDataForAddress: async () => ({}),
  getHoldersForAddress: async () => null,
};
try {
  const mod = await import('./_lib/spectre-data.js')
  if (mod && typeof mod === 'object') {
    if (typeof mod.getMarketDataForAddresses === 'function') _spectreData.getMarketDataForAddresses = mod.getMarketDataForAddresses
    if (typeof mod.getMarketDataForAddress === 'function') _spectreData.getMarketDataForAddress = mod.getMarketDataForAddress
    if (typeof mod.getHoldersForAddress === 'function') _spectreData.getHoldersForAddress = mod.getHoldersForAddress
  }
} catch (err) {
  console.warn('[codex] spectre-data helper unavailable:', err?.message)
}

// L4-PR1: Hetzner /v1/coins/{cgId} tier. Same pattern as the research-app
// _fetchSpectreDetail (apps/research/api/codex.js L603). 1000ms hard timeout
// (bumped from 500ms after the BTC/ETH/SOL detail hits showed ~500ms p50).
// Falls through silently on any error/timeout.
const SPECTRE_API_BASE_HOST = process.env.SPECTRE_API_BASE || 'http://204.168.244.18:3850';
const SPECTRE_DATA_KEY = process.env.SPECTRE_API_KEY || process.env.SPECTRE_DATA_API_KEY || '';
const SPECTRE_DETAIL_TIMEOUT_MS = 1000;

// Reverse-map (address, networkId) -> cgId so we can hit /v1/coins/{cgId}
// for the majors that trading-app's local KNOWN_TOKEN_ADDRESSES knows about.
// Falls through to address-based scanner lookup for everything else. The
// 12-row map covers SPECTRE/PEPE/DOGE/SHIB/LINK/UNI/AAVE/CRV/MKR/SUSHI/
// FLOKI/GRT plus 3 Solana memes — enough to seed the cg:snap path for the
// trading app's hottest pages.
const _ADDR_TO_CGID = {
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599:1': 'bitcoin',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2:1': 'ethereum',
  'So11111111111111111111111111111111111111112:1399811149': 'solana',
  '0xb8c77482e45f1f44de1745f52c74426c631bdd52:1': 'binancecoin',
  '0x6982508145454ce325ddbe47a25d4ec3d2311933:1': 'pepe',
  '0x4206931337dc273a630d328da6441786bfad668f:1': 'dogecoin',
  '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce:1': 'shiba-inu',
  '0xcf0c122c6b73ff809c693db761e7baebe62b6a2e:1': 'floki',
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984:1': 'uniswap',
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9:1': 'aave',
  '0x514910771af9ca656af840dff83e8264ecf986ca:1': 'chainlink',
  '0xc944e90c64b2c07662a292be6244bdf05cda44a7:1': 'the-graph',
  '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2:1': 'maker',
  '0xd533a949740bb3306d119cc777fa900ba034cd52:1': 'curve-dao-token',
  '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2:1': 'sushi',
  '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6:1': 'spectre-ai',
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm:1399811149': 'dogwifcoin',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263:1399811149': 'bonk',
  'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY:1399811149': 'moo-deng',
};
function _addressToCgId(address, netId) {
  if (!address) return null;
  const key = address.startsWith('0x')
    ? `${address.toLowerCase()}:${netId}`
    : `${address}:${netId}`;
  return _ADDR_TO_CGID[key] || null;
}

async function _fetchSpectreDetail(cgId) {
  if (!cgId) return null;
  try {
    const r = await fetch(`${SPECTRE_API_BASE_HOST}/v1/coins/${encodeURIComponent(cgId)}`, {
      headers: { 'X-API-Key': SPECTRE_DATA_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(SPECTRE_DETAIL_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data || !data.id) return null;
    const md = data.market_data || {};
    return {
      address: data.contract_address || null,
      name: data.name,
      symbol: (data.symbol || '').toUpperCase(),
      decimals: 18,
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
  } catch (_) { return null; }
}

const _L4_FORCE_CODEX_PRIMARY = process.env.L4_FORCE_CODEX_PRIMARY === '1';

// L4-PR2 (2026-06-03): per-surface kill switch for the Hetzner /v1/search
// tier. When set, handleTokenSearch skips the Hetzner Tier 1 entirely and
// falls through to Codex filterTokens(phrase:) for ALL queries (the pre-L4
// behaviour). Mirrors the research-app flag for parity rollback.
const _L4_PR2_DISABLE_HETZNER_SEARCH = process.env.L4_PR2_DISABLE_HETZNER_SEARCH === '1';

// L4-PR3 (2026-06-03): per-surface kill switch for the Hetzner /v1/market/trending
// tier. When set, handleTrendingTokens skips Hetzner and falls back to the
// existing Codex multi-query rebuild path. Mirrors the research-app flag for
// parity rollback (set in Vercel without a redeploy).
const _L4_PR3_DISABLE_HETZNER_TRENDING = process.env.L4_PR3_DISABLE_HETZNER_TRENDING === '1';

// Reverse map: coingecko_id -> { address, networkId } for trading-tradable
// majors. Built once at module load from the canonical token registry
// (~38 majors with on-chain addresses). The trading app needs an actual
// address to power the chart/trade panel — Hetzner /v1/search returns
// identity rows without on-chain addresses, so we hydrate them via this
// reverse lookup. Tokens not in this map fall through to Codex (which IS
// address-indexed). Coverage: BTC/ETH/SOL/BNB/PEPE/DOGE/SHIB/UNI/AAVE/
// CRV/MKR/SUSHI/FLOKI/LINK/GRT plus all other registry entries with a
// non-null address.
const _CGID_TO_KNOWN_TOKEN = (() => {
  const out = new Map();
  try {
    // MUST be _require (createRequire): bare `require` throws ReferenceError
    // in this ESM module. It did exactly that until 2026-08-12 - the catch
    // below swallowed it and this map silently degraded to the 3 hardcoded
    // Solana entries, so Hetzner search hydration missed for every other
    // token and both search tiers fell through to the 10-14s Codex leg.
    const reg = _require('../../../packages/server/lib/token-registry');
    const known = reg?.KNOWN_TOKEN_ADDRESSES || {};
    const cgMap = reg?.SYMBOL_TO_COINGECKO_ID || {};
    for (const [sym, info] of Object.entries(known)) {
      const cgId = cgMap[sym];
      if (!info?.address || info?.networkId == null || !cgId) continue;
      out.set(String(cgId).toLowerCase(), {
        symbol: sym,
        address: info.address,
        networkId: info.networkId,
      });
    }
    // Search-hydration expansion (2026-06-10): ~35 more top-CG tokens with
    // validated canonical contracts. More Hetzner rows survive the address
    // filter = more zero-Codex search short-circuits.
    for (const [cgId, info] of Object.entries(reg?.EXTENDED_CG_TOKENS || {})) {
      if (!out.has(cgId)) out.set(cgId, { symbol: info.symbol, address: info.address, networkId: info.networkId });
    }
  } catch (_) { /* registry unavailable - Hetzner shortcircuit degrades to "no hydration", falls to Codex */ }
  // Trading-specific Solana memes already in _ADDR_TO_CGID. Mirror the
  // reverse direction so search queries on these popular Solana tokens
  // also short-circuit Codex.
  out.set('dogwifcoin', { symbol: 'WIF', address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', networkId: 1399811149 });
  out.set('bonk', { symbol: 'BONK', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', networkId: 1399811149 });
  out.set('moo-deng', { symbol: 'MOODENG', address: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', networkId: 1399811149 });
  return out;
})();

// L4-PR2: Hetzner /v1/search (Postgres assets table - 18,391 CG-indexed
// tokens verified at design time). Tier 1 for text queries. p50 ~80ms,
// p95 ~250ms. 800ms abort budget absorbs the long tail.
//
// Codex filterTokens(phrase:) was the *only* path in the trading app
// pre-L4 (the trading handler shipped without the research-app's Phase
// L1 Spectre tier). Every text-search keystroke billed 1 filterTokens
// + 1 listPairsWithMetadataForToken (lockstep) at minimum.
//
// Trading-specific constraint: the frontend (CommandPalette + useCodexData
// mergeResults) DROPS rows without an address. So we hydrate each Hetzner
// row through _CGID_TO_KNOWN_TOKEN BEFORE returning. Rows that don't
// hydrate are filtered out — the residual goes to Codex, which has the
// address from its DEX indexing. The Hetzner shortcircuit therefore only
// fires for canonical majors (BTC/ETH/SOL/PEPE/etc.) — covering the
// hottest queries at zero Codex cost.
const SPECTRE_SEARCH_TIMEOUT_MS = 800;

// Ceiling for the settled-search Codex-leg backfill (see handleTokenSearch).
// Keeps worst-case settled search at roughly hetzner(0.8s) + codex(<=5s) +
// this, instead of the unbounded 4-tier waterfall.
const SEARCH_BACKFILL_BUDGET_MS = 2500;

// Hard cap on how many search rows may reach the BILLED tiers of spectre-data
// (/v1/scanner/token -> live Codex on the box's key). Codex returns this list
// ranked by liquidity DESC, so the cap spends the budget on the rows a user
// would actually pick and leaves the clone tail to rank on what it has.
// Env-tunable so the ceiling can be dialled from the Vercel dashboard without a
// code change (a redeploy is still required for functions to pick up new env).
const SEARCH_BACKFILL_MAX_LOOKUPS = Number(process.env.SEARCH_BACKFILL_MAX_LOOKUPS) || 30;

// L4-PR3 (2026-06-03): Hetzner /v1/market/trending adapter for trading app.
//
// Endpoint shape (CoinGecko /search/trending mirror):
//   { data: { coins: [{ item: { id, symbol, name, thumb, large, slug,
//                               data: { price, market_cap, total_volume,
//                                       price_change_percentage_24h: { usd, ... } } } }] } }
//
// Trading-specific constraint (same as _fetchSpectreSearch): the frontend
// (LeftPanel trending list) uses `t.address` as the React key AND passes it
// to selectToken() for chart/swap routing. Rows without an address are
// effectively unclickable. So we hydrate each row through _CGID_TO_KNOWN_TOKEN
// BEFORE returning; rows that don't hydrate are dropped from the Tier-1
// response. The Codex fallback below picks them up (Codex IS address-indexed).
//
// Coverage projection: top-15 CG trending typically contains 6-12 majors
// (BTC/ETH/SOL/BNB/PEPE/SHIB/DOGE/etc.) plus 3-6 long-tail tokens. The 38-entry
// _CGID_TO_KNOWN_TOKEN covers the majors; the long-tail goes to Codex. So
// Hetzner usually serves a SHORT trending row (~6-12 hydrated). When that's
// shorter than the requested limit, the response is still useful for the
// "first paint" of the trending strip while a background Codex rebuild
// fills the rest - but per L4 design we accept that the trending list
// runs SHORTER than 50 in exchange for zero Codex cost on the hot path.
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

    const parseUsd = (v) => {
      if (v == null) return 0;
      if (typeof v === 'number') return v;
      const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };

    const hydrated = [];
    for (const c of coins) {
      const item = c?.item || c;
      const d = item?.data || {};
      const cgId = String(item?.id || item?.slug || '').toLowerCase();
      // Trading-specific hydration: lookup address+networkId by cgId.
      // Drop rows we can't route to a swap target.
      const known = cgId ? _CGID_TO_KNOWN_TOKEN.get(cgId) : null;
      if (!known?.address || known?.networkId == null) continue;

      const price = Number(d?.price) || 0;
      const usdChange = d?.price_change_percentage_24h?.usd ?? null;
      const marketCap = parseUsd(d?.market_cap);
      const volume24 = parseUsd(d?.total_volume);

      hydrated.push({
        token: {
          address: known.address,
          symbol: (item?.symbol || known.symbol || '').toUpperCase(),
          name: item?.name || '',
          networkId: known.networkId,
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
        cgId: cgId || null,
        _source: 'spectre-trending',
      });
    }
    if (hydrated.length === 0) return null;
    return { _count: hydrated.length, results: hydrated };
  } catch (_) {
    return null;
  }
}

// Hetzner /v1/search returns IDENTITY-ONLY rows (symbol/name/image/rank/cgId -
// no price fields), so the Tier-1 short-circuit used to serve $0.00 rows to
// every surface without its own details-batch enrichment (mobile search).
// Backfill with ONE Hetzner /v1/prices call: symbols sorted (the box's cache
// key is order-sensitive), each merge address-verified against the price
// row's `contract` so a colliding ticker (the $DOT/Polkadot class) keeps its
// zeros instead of inheriting another coin's price. change24 is emitted in
// RATIO form (pct/100) to match Codex rows / readCodexChangePct.
async function _spectrePricesBackfill(rows, timeoutMs = 900) {
  const symbols = [...new Set(rows.map(r => r.token.symbol).filter(Boolean))].sort();
  if (!symbols.length) return;
  try {
    const params = new URLSearchParams({ symbols: symbols.join(',') });
    const r = await fetch(`${SPECTRE_API_BASE_HOST}/v1/prices?${params}`, {
      headers: { 'X-API-Key': SPECTRE_DATA_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return;
    const data = (await r.json())?.data || {};
    for (const row of rows) {
      const p = data[row.token.symbol];
      if (!p || !(Number(p.price) > 0)) continue;
      const contract = String(p.contract || '').toLowerCase();
      if (contract && contract !== String(row.token.address).toLowerCase()) continue;
      if (!(row.priceUSD > 0)) row.priceUSD = Number(p.price) || 0;
      if (!(row.marketCap > 0)) row.marketCap = Number(p.market_cap) || 0;
      if (!(row.volume24 > 0)) row.volume24 = Number(p.volume_24h) || 0;
      const chg = Number(p.change && p.change['24h']);
      if (!row.change24 && Number.isFinite(chg)) row.change24 = chg / 100;
    }
  } catch (_) { /* fail-soft - rows stay identity-only */ }
}

// `timeoutMs` is the budget for the WHOLE call, not just the /v1/search leg.
// It used to cover only the search fetch, and _spectrePricesBackfill nested
// below then started a fresh 900ms clock - so the `fast=1` tier's declared
// 500ms budget silently cost up to 1400ms. The backfill now gets whatever is
// LEFT of the budget. Rows that miss the shortened backfill stay identity-only
// until the settled tier lands with real prices and re-paints over them.
async function _fetchSpectreSearch(query, timeoutMs = SPECTRE_SEARCH_TIMEOUT_MS) {
  const startedAt = Date.now();
  try {
    const params = new URLSearchParams({ q: query, limit: '15' });
    const r = await fetch(`${SPECTRE_API_BASE_HOST}/v1/search?${params}`, {
      headers: { 'X-API-Key': SPECTRE_DATA_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const cacheHdr = r.headers.get('x-spectre-cache');
    const json = await r.json();
    const coins = json?.data?.coins || json?.coins || [];
    if (!Array.isArray(coins) || coins.length === 0) return null;

    // Hydrate identity rows with known on-chain address+networkId. Rows
    // that don't resolve are filtered — they need Codex to materialise
    // address data. Keep up to 15 results post-filter.
    const hydrated = [];
    for (const c of coins) {
      const cgId = (c.coingecko_id || c.id || '').toLowerCase();
      const known = cgId ? _CGID_TO_KNOWN_TOKEN.get(cgId) : null;
      const directAddr = c.address || c.contract_address || null;
      const directNet = c.networkId || null;
      const address = directAddr || known?.address || null;
      const networkId = directNet || known?.networkId || null;
      if (!address || networkId == null) continue;
      hydrated.push({
        token: {
          address,
          symbol: (c.symbol || known?.symbol || '').toUpperCase(),
          name: c.name || '',
          networkId,
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
        cgId: cgId || null,
      });
    }
    if (hydrated.length === 0) return null;

    if (hydrated.some(row => !(row.priceUSD > 0))) {
      // Spend only what's left of the caller's budget (see the note above).
      const remaining = timeoutMs - (Date.now() - startedAt);
      if (remaining >= 150) await _spectrePricesBackfill(hydrated, Math.min(900, remaining));
    }

    return {
      _spectreCache: cacheHdr,
      _count: hydrated.length,
      results: hydrated,
    };
  } catch (_) {
    return null;
  }
}

// details-batch: N watchlist/palette tokens in ONE response. This action was
// referenced by the frontend (fetchTokenDetailsBatch -> LeftPanel watchlist +
// CommandPalette enrichment) but NEVER existed in this switch - it fell into
// the `health` default and returned {status:'ok'}, silently no-oping both
// consumers in prod (found 2026-06-10 during the search-speed audit).
//
// Tiering mirrors handleTokenDetails: KV snap first (zero Codex), then ONE
// LEVER-3 shrunken filterTokens(tokens:) for ALL misses IN PARALLEL with the
// Hetzner bulk backfill (research L4-PR1 union pattern - rows Codex misses
// still materialise from Hetzner market data). Response: { addrLower: shape }
// matching the Express /api/token/details-batch row shape.
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

  // Tier A - cron-warmed KV snapshots. Sub-ms, zero Codex. Watchlists made
  // of top tokens resolve entirely here.
  const out = {};
  const misses = [];
  await Promise.all(pairs.map(async (p) => {
    const snap = await _readSnapshotSingle(p.address, p.networkId);
    if (snap) { out[p.address.toLowerCase()] = snap; return; }
    misses.push(p);
  }));
  if (misses.length === 0) return out;

  // Tier B - Codex + Hetzner in parallel, union merge.
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
  const tokenKeys = misses.map(p => `${p.networkId === 1399811149 ? p.address : p.address.toLowerCase()}:${p.networkId}`);

  const codexP = executeCodexQuery(batchQuery, {
    tokens: tokenKeys,
    limit: Math.min(Math.max(misses.length, 1), 200),
  }).catch((err) => {
    console.error('[codex] details-batch query failed:', err?.message);
    return null;
  });
  const backfillP = _spectreData.getMarketDataForAddresses(
    misses.map((p) => ({ address: p.address, networkId: p.networkId }))
  ).catch(() => new Map());

  const [data, backfill] = await Promise.all([codexP, backfillP]);

  const byAddr = new Map();
  for (const r of (data?.filterTokens?.results || [])) {
    const addr = (r?.token?.address || '').toLowerCase();
    if (addr) byAddr.set(addr, r);
  }

  for (const p of misses) {
    const addrLower = p.address.toLowerCase();
    const r = byAddr.get(addrLower);
    const bf = backfill.get(addrLower) || {};
    const hasCodex = !!r;
    const hasHetzner = bf && (bf.marketCap != null || bf.volume24 != null || bf.liquidity != null);
    if (!hasCodex && !hasHetzner) continue; // genuine miss - leave out

    const token = r?.token || {};
    const codexPrice = parseFloat(r?.priceUSD) || 0;
    const circulatingSupply = parseFloat(token.info?.circulatingSupply) || 0;
    const apiMarketCap = parseFloat(bf.marketCap) || 0;
    const calculatedMarketCap = (codexPrice > 0 && circulatingSupply > 0)
      ? codexPrice * circulatingSupply
      : apiMarketCap;
    const createdAt = token.createdAt || null;
    out[addrLower] = {
      address: token.address || p.address,
      name: token.name || null,
      symbol: token.symbol || null,
      networkId: token.networkId || p.networkId,
      logo: token.info?.imageLargeUrl || token.info?.imageThumbUrl || null,
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
      age: createdAt ? Math.floor((Date.now() - new Date(createdAt * 1000)) / 86400000) : null,
    };
  }

  // MCap sanity overlay (mirror of Express /api/token/details-batch): Codex's
  // info.circulatingSupply goes stale (LNQ carried 132.7M vs the real ~424M ->
  // watchlist showed $855K instead of ~$2.6M). Where the computed and API mcap
  // disagree >1.5x, take DexScreener's circulating mcap (batched + cached in
  // the enrich helper). Fail-soft: any error keeps the Codex-derived values.
  const suspicious = misses
    .map(p => out[p.address.toLowerCase()])
    .filter(r => r && _mcapLooksWrong(r.marketCap, r.apiMarketCap));
  if (suspicious.length > 0) {
    try {
      const dsEnr = await enrichFromDexScreener(
        suspicious.map(r => ({ address: r.address, networkId: r.networkId }))
      );
      for (const r of suspicious) {
        const ds = dsEnr.get(dsNorm(r.address));
        if (ds && ds.marketCap > 0) {
          r.marketCap = ds.marketCap;
          r.mcapSource = 'dexscreener';
        }
      }
    } catch (_) { /* keep Codex-derived values */ }
  }

  return out;
}

// True when the two Codex-derived mcaps disagree enough that neither can be
// trusted (stale info.circulatingSupply class). Mirror of Express
// mcapLooksWrong in packages/server/index.js - keep in sync.
function _mcapLooksWrong(computed, api) {
  if (!(computed > 0)) return api > 0; // nothing computed but API has a value - cross-check
  if (!(api > 0)) return true;         // computed but unverifiable - cross-check
  const ratio = computed > api ? computed / api : api / computed;
  return ratio > 1.5;
}

// Direct Codex holder count, KV-cached (5 min). Codex `holders` is the
// chain-truth number (matches Etherscan); the Hetzner Tier-2 backfill undercounts
// (e.g. SPECTRE 5,288 vs the chain's 8,054). handleTokenDetails overrides every
// tier's holders with this so the token page is always correct, independent of
// the snapshot cron. The 5-min KV cache keeps it to ~one Codex holders query per
// token per 5 min regardless of view volume. Returns null on miss (keep existing).
const HOLDERS_TTL_SEC = 300;
async function _codexHoldersDirect(address, netId) {
  if (!address) return null;
  const isEvm = address.startsWith('0x');
  const key = isEvm ? `${address.toLowerCase()}:${netId}` : `${address}:${netId}`;
  try {
    const cached = await getCodexCache('holders', key);
    if (cached && typeof cached.h === 'number') return cached.h > 0 ? cached.h : null;
  } catch (_) { /* fall through to live query */ }
  try {
    const data = await executeCodexQueryAllowPartial(
      `query Holders($tokens: [String!]!) { filterTokens(tokens: $tokens, limit: 1) { results { holders } } }`,
      { tokens: [key] },
    );
    const h = parseInt(data?.filterTokens?.results?.[0]?.holders) || 0;
    try { await setCodexCache('holders', key, { h }, HOLDERS_TTL_SEC); } catch (_) { /* ignore */ }
    return h > 0 ? h : null;
  } catch (e) {
    console.error('[codex] direct holders lookup failed:', e?.message);
    return null;
  }
}

// Token-details read path. Resolves via the tiered source (_resolveTokenDetails),
// then overrides `holders` with a direct Codex count so every tier shows the
// chain-truth holder number rather than the Hetzner-tier undercount.
async function handleTokenDetails(address, networkId) {
  const netId = parseInt(networkId) || 1;
  // Start details + holders at t=0 in parallel. Holders needs only the request
  // address+netId (not the resolved detail), so it no longer waits on the
  // details resolve - saves a full Codex RTT on every KV-cold details.
  const [detailRes, holdersRes] = await Promise.allSettled([
    _resolveTokenDetails(address, networkId),
    _codexHoldersDirect(address, netId),
  ]);
  const detail = detailRes.status === 'fulfilled' ? detailRes.value : null;
  if (detail) {
    // Override with the chain-truth Codex holder count; keep the tier's own
    // holders on a holders miss/failure (mirrors the prior sequential behaviour).
    const h = holdersRes.status === 'fulfilled' ? holdersRes.value : null;
    if (h != null) detail.holders = h;
  }
  return detail;
}

async function _resolveTokenDetails(address, networkId) {
  const netId = parseInt(networkId) || 1;

  // Tier 1 — KV snapshot (sub-ms when cron-warmed). Zero Codex cost on hit.
  const snap = await _readSnapshotSingle(address, netId);
  if (snap) return snap;

  // Kill switch — restore pre-L4 ordering for diagnostic / outage purposes.
  if (_L4_FORCE_CODEX_PRIMARY) {
    return _legacyCodexTokenDetails(address, netId);
  }

  // Tier 2 — Hetzner /v1/coins/{cgId} for majors with a cgId bridge. ~80-400ms.
  const cgId = _addressToCgId(address, netId);
  if (cgId) {
    const spectre = await _fetchSpectreDetail(cgId);
    if (spectre && spectre.price > 0) {
      // Backfill the rare missing fields from the triple-tier helper.
      // For majors this is mostly a no-op because Tier 2 returns volume/mcap
      // already; only liquidity/holders/txnCount24 might be null.
      try {
        const bf = await _spectreData.getMarketDataForAddress(
          spectre.address || address,
          netId,
          cgId,
        );
        spectre.liquidity = parseFloat(bf?.liquidity) || spectre.liquidity || 0;
        spectre.holders = parseInt(bf?.holders) || spectre.holders || 0;
      } catch (_) { /* helper miss is fine */ }
      // Re-fill canonical address/networkId that Hetzner doesn't always echo.
      spectre.address = spectre.address || address;
      spectre.networkId = netId;
      return spectre;
    }
  }

  // Tier 3 — Codex fallback (residual). Long-tail DEX tokens land here.
  return _legacyCodexTokenDetails(address, netId);
}

// Extracted the pre-L4 Codex-only path so the kill switch and the genuine
// fallback share one implementation. Behaviour identical to the trading-app
// handleTokenDetails before L4-PR1.
async function _legacyCodexTokenDetails(address, netId) {
  const isSolanaNetwork = netId === 1399811149;
  const queryAddress = isSolanaNetwork ? address : address.toLowerCase();

  // LEVER 3 (2026-06-02): shrunken selection. Dropped volume24/liquidity/
  // marketCap/change4/change12/holders - each triggers a billable
  // listPairsWithMetadataForToken lockstep. Backfilled below via spectre-data.
  const query = `
    query GetTokenDetail($networkFilter: [Int!], $tokens: [String!]) {
      filterTokens(
        filters: { network: $networkFilter }
        tokens: $tokens
        limit: 1
      ) {
        results {
          priceUSD
          change24
          change1
          token {
            address
            name
            symbol
            decimals
            networkId
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
      }
    }
  `;

  let data;
  try {
    data = await executeCodexQuery(query, { networkFilter: [netId], tokens: [queryAddress] });
  } catch (err) {
    console.error('Token detail query failed:', err?.message);
    return null;
  }

  const result = data?.filterTokens?.results?.[0];
  const token = result?.token;
  if (!token) return null;
  const market = result;

  // LEVER 3 backfill: pull dropped fields from helper.
  const bf = await _spectreData.getMarketDataForAddress(
    token.address || address,
    token.networkId || netId,
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
    price: parseFloat(market?.priceUSD) || 0,
    volume24: parseFloat(bf?.volume24) || 0,
    liquidity: parseFloat(bf?.liquidity) || 0,
    marketCap: parseFloat(bf?.marketCap) || 0,
    change24: parseFloat(market?.change24) || 0,
    change1h: parseFloat(market?.change1) || 0,
    change4h: parseFloat(bf?.change4) || 0,
    change12h: parseFloat(bf?.change12) || 0,
    holders: parseInt(bf?.holders) || 0,
    topPairAddress: market?.address || null,
  };
}

// Fetch a specific Solana token by address
async function fetchSolanaToken(tokenInfo) {
  const SOLANA_NETWORK_ID = 1399811149;

  // LEVER 3 (2026-06-02): shrunken selection. Liquidity ranking attr KEPT
  // (still orders results by liquidity DESC) but liquidity field DROPPED.
  // volume24/marketCap/holders backfilled below via spectre-data.
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
//
// L4-PR2 (2026-06-03): Hetzner /v1/search is Tier 1 for text queries.
// Codex filterTokens(phrase:) becomes the residual for:
//   (a) raw contract addresses (Codex is canonical for address resolution
//       and trades execute on contract address, not slug)
//   (b) Hetzner returning empty / 5xx / timed-out (cold-start, new launch,
//       or genuine Hetzner outage)
// Pre-L4 the trading-app handler went straight to Codex for ALL queries.
// Kill switch `L4_PR2_DISABLE_HETZNER_SEARCH=1` reverts to that path.
// allResults is [...EVM rows, ...Solana rows] — two separate liquidity-DESC
// queries concatenated, NOT one ranked list. A naive head-slice for the backfill
// cap would therefore spend the entire budget on EVM and leave every Solana row
// without liquidity; those rows then score -1000 and are dropped by the
// `qualityScore > -100` filter below, i.e. a query like "wif" or "bonk" would
// lose its actual answers. Round-robin across networks so the cap costs each
// network its tail, never a whole chain.
function _interleaveByNetwork(items) {
  const groups = new Map();
  for (const it of items) {
    const k = it.networkId ?? 0;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  if (groups.size < 2) return items;
  const lists = [...groups.values()];
  const out = [];
  for (let i = 0; out.length < items.length; i++) {
    for (const l of lists) if (i < l.length) out.push(l[i]);
  }
  return out;
}

async function handleTokenSearch(searchQuery, networkIds) {
  const isEVMAddress = searchQuery.startsWith('0x') && searchQuery.length === 42;
  const isSolanaAddress = searchQuery.length >= 32 && searchQuery.length <= 44 && !searchQuery.startsWith('0x');
  const isContractAddress = isEVMAddress || isSolanaAddress;

  // L4-PR2 Tier 1: Hetzner /v1/search for text queries.
  if (!isContractAddress && searchQuery.length >= 2 && !_L4_PR2_DISABLE_HETZNER_SEARCH) {
    const spectre = await _fetchSpectreSearch(searchQuery);
    if (spectre && spectre._count > 0) {
      return spectre;
    }
    // Empty / errored / timed out -> fall through to Codex.
  }

  const queryLower = searchQuery.toLowerCase().replace(/^\$/, '');
  const SOLANA_NETWORK_ID = 1399811149;
  const EVM_NETWORKS = [1, 56, 137, 42161, 8453, 43114, 10, 250, 4663];
  
  // LEVER 3 (2026-06-02): shrunken selection. Liquidity ranking attr KEPT
  // (still orders results by liquidity DESC), liquidity field DROPPED.
  // volume24/marketCap/holders backfilled below BEFORE calculateQualityScore
  // runs - the scorer reads those fields, so backfilling has to happen first.
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

  // Run parallel searches: EVM networks + Solana separately for better coverage.
  // The popular-Solana-token direct fetch rides the same Promise.allSettled -
  // it only depends on the query string, and awaiting it AFTER the two searches
  // (as before 2026-07-20) added a full sequential Codex round-trip to exactly
  // the hot queries (wif/bonk/jup/...) that trigger it.
  const popularSolanaToken = POPULAR_SOLANA_TOKENS[queryLower];
  const [evmResult, solanaResult, popularSettled] = await Promise.allSettled([
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
    popularSolanaToken ? fetchSolanaToken(popularSolanaToken) : Promise.resolve(null),
  ]);

  if (evmResult.status === 'rejected') console.error('EVM search failed:', evmResult.reason?.message);
  if (solanaResult.status === 'rejected') console.error('Solana search failed:', solanaResult.reason?.message);

  const evmData = evmResult.status === 'fulfilled' ? evmResult.value : null;
  const solanaData = solanaResult.status === 'fulfilled' ? solanaResult.value : null;

  // Combine results
  let allResults = [
    ...(evmData?.filterTokens?.results || []),
    ...(solanaData?.filterTokens?.results || []),
  ];

  // Fold in the popular-Solana direct fetch (already resolved above in parallel)
  if (popularSolanaToken) {
    const popularResult = popularSettled.status === 'fulfilled' ? popularSettled.value : null;
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

  // LEVER 3 bulk backfill: pull volume24/liquidity/marketCap/holders for every
  // result in ONE call before calculateQualityScore runs. fetchSolanaToken
  // already injects bf fields above; skip rows that already have them.
  const backfillInputs = _interleaveByNetwork(allResults
    .filter(r => r?.token?.address && r.volume24 == null && r.liquidity == null && r.marketCap == null)
    .map(r => ({ address: r.token.address, networkId: r.token.networkId })));
  // Hard wall-clock budget AND a hard call cap on the backfill. A meme-name
  // query returns up to 50 clone rows with no cgId, so every one of them falls
  // to the per-address scanner + DexScreener tiers - measured 10-14s on prod
  // (2026-08-12) while the user stares at the palette.
  //
  // This used to be a Promise.race, which capped LATENCY but not SPEND: the
  // race stopped awaiting, the fetches had already left for the box, and the
  // box had already paid Codex for every one of them. The budget is now passed
  // INTO the helper, which stops issuing calls once it expires. Rows that miss
  // the budget or the cap stay unscored on those fields and rank lower; the
  // frontend enriches missing rows client-side after paint.
  const backfill = backfillInputs.length
    ? await _spectreData.getMarketDataForAddresses(backfillInputs, {
        budgetMs: SEARCH_BACKFILL_BUDGET_MS,
        maxLookups: SEARCH_BACKFILL_MAX_LOOKUPS,
      }).catch(() => new Map())
    : new Map();
  for (const r of allResults) {
    if (!r?.token?.address) continue;
    const bf = backfill.get(r.token.address.toLowerCase());
    if (!bf) continue;
    if (r.volume24 == null) r.volume24 = bf.volume24 ?? null;
    if (r.liquidity == null) r.liquidity = bf.liquidity ?? null;
    if (r.marketCap == null) r.marketCap = bf.marketCap ?? null;
    if (r.holders == null) r.holders = bf.holders ?? null;
  }

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

// ---- Token quality filters ----

// Symbols to always exclude (stablecoins, wrapped natives, LSTs, bridge tokens)
const EXCLUDED_SYMBOLS = new Set([
  'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'GUSD', 'FRAX', 'LUSD',
  'USDD', 'PYUSD', 'EURC', 'EURS', 'USDE', 'SUSDS', 'CUSD', 'XAUT',
  'CRVUSD', 'USDTB', 'USD1', 'USDT0', 'REUSD', 'STABLE', 'SUSD',
  'WETH', 'WBTC', 'WBNB', 'WMATIC', 'WAVAX', 'WSOL', 'WFTM', 'WCRO',
  'CBBTC', 'CBETH', 'STETH', 'WSTETH', 'RETH', 'SFRXETH', 'METH', 'EZETH', 'RSETH',
  'WEETH', 'TBTC',
  'BTCB', 'JLP',
]);

// Substrings in token names that signal spam/honeypot/scam tokens
const SPAM_NAME_PATTERNS = [
  'pool prime', 'boost', 'rush', 'swap', 'node ',
  'instruct', 'superform', 'indexer', 'gravit',
  'velocity', 'sidechain', 'modular', 'magicblock',
  'oracle opinion', 'cion', 'cion-',
  'wrapped e', 'wrapped s', 'wrapped b',
  'usd stablecoin', 'usd coin',
];

/**
 * Returns true if the token should be EXCLUDED (spam/low-quality).
 */
function isSpamToken(result) {
  // Handle both raw Codex format { token: { symbol } } and normalized { symbol }
  const sym = (result.token?.symbol || result.symbol || '').toUpperCase();
  const name = (result.token?.name || result.name || '').toLowerCase();

  if (EXCLUDED_SYMBOLS.has(sym)) return true;
  if (sym.length > 10 || /[^A-Z0-9$]/.test(sym)) return true;
  if (name.length > 40) return true;
  if (name.includes('_') || name.includes('  ')) return true;
  if (SPAM_NAME_PATTERNS.some(p => name.includes(p))) return true;

  const mcap = parseFloat(result.marketCap) || 0;
  const vol = parseFloat(result.volume24 || result.volume24h) || 0;
  const liq = parseFloat(result.liquidity) || 0;

  // 2026-06-04 (token-page data sweep): the slim trending query omits
  // volume24/liquidity/marketCap to dodge the listPairs lockstep, so rows that
  // missed CG-snap hydration arrive with all three at 0. Treating "no data" as
  // spam collapsed the entire list to the static null-logo fallback (the
  // "only major tokens, no logos" bug). Only apply the liquidity/volume
  // thresholds when the data is actually present - the Codex volume24-DESC
  // ranking already guarantees these are top-liquidity tokens, and unhydrated
  // rows still carry symbol/price/change24/logo from the slim selection.
  const hasMarketData = vol > 0 || liq > 0 || mcap > 0;
  if (hasMarketData) {
    if (vol > 0 && vol < 10000) return true;
    if (liq > 0 && liq < 50000) return true;
    if (mcap > 0 && vol / mcap > 50) return true;
    // Fabricated-supply + wash gates, cap-tiered - keep in sync with
    // mcapLiqDropLimit (packages/server/lib/token-safety.js) and isCleanRow
    // (TrendingHub/index.jsx). Measured 2026-08-18 on the live BSC screener:
    // kills a fake "USDT" ($731B mcap, 5887x mcap/liq), M21NT ($25B, 1872x),
    // BTW ($4.2B, 3087x), QUQ (214x vol/liq wash), DEBIT (151x); the highest
    // LEGITIMATE survivor ran 1021x mcap/liq (bridged token) and 27x vol/liq
    // (a 1h-old runner), so both lines sit in empty bands. liq>0 guards keep
    // slim unhydrated trending rows (all zeros) unaffected.
    if (liq > 0 && vol > 0 && vol / liq > 100) return true;
    if (liq > 0 && mcap > 0 && mcap / liq > (mcap < 1_000_000 ? 200 : mcap < 20_000_000 ? 300 : 1500)) return true;
  }

  // NAME impersonation of stables/majors: the symbol check above missed a fake
  // "USDT" whose SYMBOL was "U" but whose NAME was "USDT". Equity ticker-squats
  // (GameStop/Apple clones) stay - the impersonation detector badges those.
  if (EXCLUDED_SYMBOLS.has(name.replace(/\s+/g, '').toUpperCase())) return true;

  const changes = [result.change5m, result.change1, result.change4, result.change12, result.change24]
    .map(c => Math.abs(parseFloat(c) || 0));
  if (changes.some(c => c > 100)) return true;

  return false;
}

/**
 * Curated "must-have" tokens — always fetched and blended in.
 */
const CURATED_TOKENS = [
  { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', networkId: 1, symbol: 'PEPE' },
  { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', networkId: 1, symbol: 'UNI' },
  { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', networkId: 1, symbol: 'AAVE' },
  { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', networkId: 1, symbol: 'LINK' },
  { address: '0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85', networkId: 1, symbol: 'FET' },
  { address: '0x6De037ef9aD2725EB40118Bb1702EBb27e4Aeb24', networkId: 1, symbol: 'RENDER' },
  { address: '0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3', networkId: 1, symbol: 'ONDO' },
  { address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', networkId: 1, symbol: 'LDO' },
  { address: '0xD533a949740bb3306d119CC777fa900bA034cd52', networkId: 1, symbol: 'CRV' },
  { address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', networkId: 1, symbol: 'MKR' },
  { address: '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72', networkId: 1, symbol: 'ENS' },
  { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', networkId: 1, symbol: 'SHIB' },
  { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', networkId: 1399811149, symbol: 'WIF' },
  { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', networkId: 1399811149, symbol: 'BONK' },
  { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', networkId: 1399811149, symbol: 'JUP' },
  { address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', networkId: 1399811149, symbol: 'RAY' },
  { address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', networkId: 1399811149, symbol: 'PYTH' },
  { address: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', networkId: 1399811149, symbol: 'JITO' },
  { address: 'DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7', networkId: 1399811149, symbol: 'DRIFT' },
  { address: '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F', networkId: 1, symbol: 'SNX' },
  { address: '0xc00e94Cb662C3520282E6f5717214004A7f26888', networkId: 1, symbol: 'COMP' },
  { address: '0x92D6C1e31e14520e676a687F0a93788B716BEff5', networkId: 1, symbol: 'DYDX' },
  { address: '0xD33526068D116cE69F19A9ee46F0bd304F21A51f', networkId: 1, symbol: 'RPL' },
  { address: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', networkId: 1399811149, symbol: 'ORCA' },
  { address: 'TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6', networkId: 1399811149, symbol: 'TENSOR' },
  { address: 'KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS', networkId: 1399811149, symbol: 'KMNO' },
  { address: '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ', networkId: 1399811149, symbol: 'W' },
  { address: '0x912CE59144191C1D966210CbfFdCA8A9322dA97c', networkId: 42161, symbol: 'ARB' },
  { address: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', networkId: 42161, symbol: 'GMX' },
  { address: '0x539bdE0d7Dbd336b79148AA742883198BBF60342', networkId: 42161, symbol: 'MAGIC' },
  { address: '0x4200000000000000000000000000000000000042', networkId: 10, symbol: 'OP' },
  { address: '0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db', networkId: 10, symbol: 'VELO' },
  { address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', networkId: 8453, symbol: 'VIRTUAL' },
  { address: '0x940181a94A35A9a4b0F0E6038fd247D2f7aFAc32', networkId: 8453, symbol: 'AERO' },
  { address: '0x532f27101965dd16442E59d40670FaF5eBB142E4', networkId: 8453, symbol: 'BRETT' },
  { address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', networkId: 8453, symbol: 'DEGEN' },
  { address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', networkId: 56, symbol: 'CAKE' },
  { address: '0x0000000000000000000000000000000000001010', networkId: 137, symbol: 'MATIC' },
];

// TRENDING_FALLBACK (the static PEPE/UNI/AAVE list with placeholder numbers)
// was REMOVED 2026-07-16: during the Codex GraphQL blackout it rendered as a
// LIVE trending board ("PEPE $5.00B +15.00%"), got KV-cached, and the client
// mapper stamped it _source:'codex' so the board's real-rows-only filter
// couldn't drop it. Degraded mode now serves the REAL Hetzner CG-trending
// partial, and a genuine double-outage returns an honest empty board.

/**
 * Trending tokens — always ranks by volume24, applies spam filter,
 * blends in curated must-have tokens, deduplicates by address+symbol.
 *
 * LEVER 3 SKIP (2026-06-02): trending intentionally retains its full field
 * selection because both pages here pull 200 tokens each (400 total before
 * dedupe) and isSpamToken needs volume24/liquidity/marketCap/change* to run.
 * Backfilling 400 tokens via spectre-data per request would be worse than the
 * current lockstep bill. Follow-up plan (mirrors research K9): build a
 * CG-snapshot-derived trending path inside `cg:snap:_all` so warm trending
 * costs zero Codex, then shrink this live-fallback selection.
 */
async function handleTrendingTokens(networkIds, timeframe = 'volume', limit = 50) {
  const netIds = networkIds?.length ? networkIds : [1, 56, 137, 42161, 8453, 1399811149];
  // Robinhood Chain has no Codex coverage - only WHERE the candidates come from
  // changes; every gate, enrichment and ranking step below is shared.
  const robinhoodOnly = isRobinhoodOnly(netIds);
  // When the Robinhood board's underlying numbers were actually read.
  let rhDataAsOf = null;
  // A Robinhood request is the WHOLE chain, not a 30-row trending strip: it is
  // the only surface in the product that lists this chain, and the client sorts
  // it by market cap / volume / holders locally. The chain currently holds ~349
  // discoverable tokens of which ~170 survive the quality gates, so the 100-row
  // cap would silently amputate the board it is meant to fix.
  const limitNum = robinhoodOnly
    ? Math.min(parseInt(limit) || 250, 300)
    : Math.min(parseInt(limit) || 50, 100);
  const fetchLimit = 200;

  // L4-PR3 (2026-06-03): Hetzner /v1/market/trending is Tier 1. Trading app
  // previously had NO non-Codex trending path — every cache miss fired
  // 2 paginated filterTokens(volume24) queries + N curated filterTokens(tokens:)
  // queries (one per network). With CURATED_TOKENS spanning 5+ networks, this
  // was 7+ filterTokens per rebuild, each lockstep-billed = ~14 ops. Hetzner
  // returns a CoinGecko-trending mirror at zero Codex cost.
  //
  // Trading-specific tradeoff: Hetzner trending rows are hydrated through
  // _CGID_TO_KNOWN_TOKEN (~38 majors). Long-tail trending picks (a brand-new
  // memecoin that hits CG trending but isn't in our registry) get dropped
  // from the Hetzner tier and surface via the Codex fallback below. We
  // therefore accept a SHORTER trending list (typically 6-12 results) from
  // Hetzner in exchange for cost — the timeframe filter `change24` is also
  // honoured by CG's trending ranker so we don't need to re-sort.
  //
  // Kill switch `L4_PR3_DISABLE_HETZNER_TRENDING=1` skips this tier entirely
  // (e.g. if Hetzner's trending mirror goes stale or its shape regresses).
  // Hoisted so the Codex-outage path below can serve this REAL partial as the
  // degraded board instead of fabricated fallback rows.
  //
  // 2026-07-20 (cold-board latency): the Hetzner fetch used to be AWAITED
  // before the Codex candidate fetches, serializing its 800ms abort budget in
  // front of every cold rebuild. Its "fill the entire strip" short-circuit
  // (below, inside the Promise.all) is unreachable in practice - every caller
  // passes limit >= 50 while _CGID_TO_KNOWN_TOKEN can hydrate at most ~15 CG
  // trending rows - so firing Codex concurrently costs zero extra lockstep ops.
  let spectreTrending = null;
  const spectreTrendingPromise = _L4_PR3_DISABLE_HETZNER_TRENDING
    ? Promise.resolve(null)
    : _fetchSpectreTrending(limitNum).catch(() => null);

  // Cost lever 2026-06-03: SHRUNKEN selection. Every one of
  // volume24/liquidity/marketCap/change4/change12/holders/txnCount24 fires a
  // listPairsWithMetadataForToken lockstep op on Codex. Dropping them costs
  // nothing (Hetzner backfills via spectre-data helper). Ranking by these
  // attributes still works without selecting them in the response. The
  // research-app codex.js shrank the same selection in L3 (PR #713) - this
  // is the matching trading-app fix that was missed and let the bill regress
  // from ~30K/day back up to ~370K/day (Jun 3 morning observation).
  //
  // change1 (1h) is selected alongside change24: both are token-level change
  // attributes, NOT listPairsWithMetadataForToken fields, so they ride free
  // (the cost is in volume24/liquidity/marketCap/change4/change12/holders/
  // txnCount24 above). The screener's 1h/24h toggle needs change1 - without it
  // change1h arrives 0 for every prod row and the 1h view reads +0.00%
  // (dev Express already selects it; this restores prod parity).
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
            info { imageThumbUrl description }
            socialLinks { twitter telegram website }
          }
          priceUSD
          change24
          change1
          createdAt
        }
      }
    }
  `;

  // ONE query for the whole curated set. `tokens: ["<addr>:<networkId>"]`
  // spans networks (the details-batch + known-prices handlers rely on the
  // same form), so the per-network fan-out this used to be - 7 queries per
  // rebuild, ~2K/day on the dashboard as "FetchCurated" - collapses to one.
  const curatedQuery = `
    query FetchCurated($tokens: [String!]!, $limit: Int!) {
      filterTokens(
        tokens: $tokens
        limit: $limit
      ) {
        results {
          token {
            address symbol name networkId
            info { imageThumbUrl description }
            socialLinks { twitter telegram website }
          }
          priceUSD change24 change1 createdAt
        }
      }
    }
  `;

  // Curated tokens as "<addr>:<networkId>" keys (EVM addresses fold case,
  // Solana base58 does not).
  const curatedKeys = CURATED_TOKENS.map((ct) =>
    `${ct.networkId === 1399811149 ? ct.address : ct.address.toLowerCase()}:${ct.networkId}`);

  let cleanResults = [];

  // Robinhood Chain: discovery from the chain's own explorer instead of Codex.
  // Rows land in the identical Codex result shape, so the DexScreener
  // enrichment, safety sweep, scoreTraction ranking and dedupe below are
  // untouched. Market fields are 0 here on purpose - isSpamToken's numeric half
  // cannot judge them until DexScreener has spoken, so for this path it runs
  // after enrichment (see the deferred screen below).
  if (robinhoodOnly) {
    cleanResults = await discoverRobinhoodCandidates().catch((e) => {
      console.error('[trending] Robinhood discovery failed:', e.message || e);
      return [];
    });
  }

  if (!robinhoodOnly) try {
    // The curated set is the same for every board (networks/timeframe/limit
    // only shape the rank passes), so its answer is shared platform-wide for
    // one trending TTL instead of re-fetched per cache key per rebuild.
    const curatedFetches = curatedKeys.length
      ? [withKvCache('curated', { set: 'v1' },
          () => executeCodexQuery(curatedQuery, {
            tokens: curatedKeys,
            limit: Math.min(Math.max(curatedKeys.length, 1), 200),
          }).catch(() => null),
          (v) => Array.isArray(v?.filterTokens?.results) && v.filterTokens.results.length > 0,
          300)]
      : [];

    // Candidate UNION across three rankings (dedup by address below). Ranking by
    // an attribute is FREE on Codex (the slim query SELECTS none of these as rich
    // fields, so no listPairsWithMetadataForToken lockstep) - this widens the pool
    // to include fresh degens that pure volume24-DESC crowds out. change24 = fresh
    // gainers, txnCount24 = high-activity degens. Each pass catch-guarded so an
    // unsupported attribute degrades gracefully.
    const [spectreTrendingRes, volResult, chgResult, txnResult, ...curatedResults] = await Promise.all([
      spectreTrendingPromise,
      executeCodexQuery(query, { networkFilter: netIds, limit: 200, offset: 0, rankAttribute: 'volume24' }),
      executeCodexQuery(query, { networkFilter: netIds, limit: 250, offset: 0, rankAttribute: 'change24' }).catch(() => null),
      executeCodexQuery(query, { networkFilter: netIds, limit: 120, offset: 0, rankAttribute: 'txnCount24' }).catch(() => null),
      ...curatedFetches,
    ]);

    spectreTrending = spectreTrendingRes;
    // 2026-06-04 (token-page data sweep): only short-circuit when Hetzner can
    // fill the ENTIRE requested strip on its own. Hetzner trending is
    // hydrated through ~38 majors (_CGID_TO_KNOWN_TOKEN), so it typically
    // returns 6-12 major rows - returning early on `>= 5` rendered a
    // "majors-only" strip and hid the long-tail DEX trending tokens users
    // expect. Falling through to the (KV-cached) Codex slim path returns the
    // real trending list WITH logos at no extra lockstep cost.
    if (spectreTrending && spectreTrending._count >= limitNum) {
      return { results: spectreTrending.results };
    }

    const _mainByAddr = new Map();
    for (const rr of [volResult, chgResult, txnResult]) {
      for (const r of (rr?.filterTokens?.results || [])) {
        const a = r.token && r.token.address;
        if (a && !_mainByAddr.has(a)) _mainByAddr.set(a, r);
      }
    }
    let mainRaw = [..._mainByAddr.values()];

    // Cold-start safety: if the 3 parallel ranking passes all came back empty
    // (cold-connection timeout), retry the volume24 pass once (warm) before
    // falling through to the Hetzner/fallback path.
    if (mainRaw.length === 0) {
      try {
        const d = await executeCodexQuery(query, { networkFilter: netIds, limit: 200, offset: 0, rankAttribute: 'volume24' });
        mainRaw = d?.filterTokens?.results || [];
      } catch (_) { /* still empty -> fallback handles it */ }
    }

    // Collect curated raw rows (hydrated below before spam filter)
    const curatedRaw = [];
    for (const cr of curatedResults) {
      if (cr?.filterTokens?.results) curatedRaw.push(...cr.filterTokens.results);
    }

    // 2026-06-04 HYDRATE BEFORE spam filter (was after sort; useless because
    // isSpamToken was already dropping every row). The slim Codex query
    // intentionally omits volume24/liquidity/marketCap to avoid the listPairs
    // lockstep tax. But isSpamToken (line 1037-1040) trips
    // `vol < 10000 || liq < 50000 || mcap === 0` on EVERY slim row → drops
    // them all → cleanResults=[] → server fallback fires. Backfill from CG
    // snap KV (refresh-cg-snapshot cron writes codex:v1:snap:<addr:net>
    // every ~3 min). Zero new Codex calls. Snap-miss rows pass through
    // unhydrated and get caught by isSpamToken normally.
    const hydrateFromSnap = (rows) => Promise.all(rows.map(async (r) => {
      const addr = r.token?.address;
      const net = r.token?.networkId;
      if (!addr || net == null) return r;
      const canonical = String(addr).startsWith('0x')
        ? `${String(addr).toLowerCase()}:${net}`
        : `${addr}:${net}`;
      try {
        const snap = await getCodexCache('snap', canonical);
        if (snap && snap._source === 'cg-snapshot') {
          return {
            ...r,
            volume24: r.volume24 || snap.volume24h || snap.volume24 || 0,
            marketCap: r.marketCap || snap.marketCap || 0,
            liquidity: r.liquidity || snap.liquidity || 0,
          };
        }
      } catch (_) { /* snap miss - row passes through unhydrated */ }
      return r;
    }));

    const [hydratedMain, hydratedCurated] = await Promise.all([
      hydrateFromSnap(mainRaw),
      hydrateFromSnap(curatedRaw),
    ]);

    // Now run spam filter with full hydrated data
    const curatedMatched = hydratedCurated.filter(r => !isSpamToken(r));
    const filteredMain = hydratedMain.filter(r => !isSpamToken(r));

    // Merge: curated first, then filtered API tokens
    const allTokens = [...curatedMatched, ...filteredMain];

    // Deduplicate by address:networkId
    const seen = new Set();
    const deduped = [];
    for (const r of allTokens) {
      const key = `${(r.token?.address || '').toLowerCase()}:${r.token?.networkId}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(r);
      }
    }

    // Deduplicate by symbol (keep highest volume)
    const symbolBest = new Map();
    for (const r of deduped) {
      const sym = (r.token?.symbol || '').toUpperCase();
      const vol = parseFloat(r.volume24) || 0;
      if (!symbolBest.has(sym) || vol > (parseFloat(symbolBest.get(sym).volume24) || 0)) {
        symbolBest.set(sym, r);
      }
    }
    cleanResults = [...symbolBest.values()];
  } catch (err) {
    console.error('Trending API error:', err.message);
    cleanResults = [];
  }

  if (cleanResults.length > 0) {
    // Map the handler's `timeframe` arg to a momentum window. Anything not in
    // the set (e.g. the legacy default 'volume') ranks on the 24h window.
    // 6h (not 4h) to match DexScreener's columns - change6h is merged below.
    const window = ['5m', '1h', '6h', '24h'].includes(timeframe) ? timeframe : '24h';

    // Enrich the top candidates (by Codex volume24) with FREE DexScreener data:
    // real txns + real liquidity that Codex lacks for Solana. Bounded to ~120
    // tokens (~4 batched calls), cached + shared, ZERO Codex cost. Failure is
    // non-fatal - scoreTraction degrades to its volume/momentum path. Curated
    // tokens stay in the candidate pool (never dropped) and are ranked by
    // traction alongside everything else.
    try {
      // Enrich the FULL candidate union (not just the volume-heavy head): the
      // change24/txnCount24-ranked fresh tokens often have low/zero CG-snap volume,
      // so a volume-sort+slice would cut them BEFORE enrichment and the strict gate
      // would then drop them. Bounded concurrency in the enricher keeps this safe.
      const enrichTargets = cleanResults
        .slice(0, 400)
        .map(r => r.token && { address: r.token.address, networkId: r.token.networkId })
        .filter(t => t && t.address);
      // Robinhood Chain hydrates through its own two-stage sweep: its tokens are
      // spread over 16-30 pools each, and the shared enricher's endpoint caps a
      // response at 30 pairs SHARED ACROSS THE BATCH, so one major starves its five
      // batch-mates and SPY / TSLA / SGOV / QQQ / SPCX / AAPL resolved to nothing.
      // Same Map contract, so everything below is unchanged.
      const enr = robinhoodOnly
        ? await hydrateRobinhoodRows(enrichTargets)
        : await enrichFromDexScreener(enrichTargets);
      for (const r of cleanResults) {
        const addr = r.token && r.token.address;
        const e = addr ? enr.get(dsNorm(addr)) : null;
        if (e) {
          r._dexEnriched = true; // strict gate: only enriched tokens display (complete columns)
          // ALL traction fields come from DexScreener's chain-scoped, USD-quoted
          // pair aggregate. The chain-scope kills the cross-chain liquidity leak
          // (OP/ARB blue-chips) and the USD-quote filter kills the broken
          // token-token-LP glitch (SOL HYPE/JUP $760M / +453115%). Codex txnCount24
          // is deliberately NOT selected in the prod query anyway (lockstep tax),
          // so DexScreener is the single source of truth here.
          r.txnCount24 = e.txnCount24; // = buys24+sells24 of the good pairs
          r.buys24 = e.buys24;   // pressure bar = DexScreener buy/sell split
          r.sells24 = e.sells24;
          r.vol1h = e.vol1h;     // strict gate: recent (1h) activity
          r.txns1h = e.txns1h;
          r.recentVolRatio = e.recentVolRatio;
          r.liquidity = e.liquidity; // chain-scoped sum (no cross-chain leak, no $760M phantom)
          r.volume24 = e.volume24;   // chain-scoped sum (DexScreener-accurate, no overcount)
          // MarketCap from DexScreener (already marketCap || fdv in the enricher).
          // Codex's slim trending query OMITS marketCap (listPairs lockstep tax) and
          // most SOL memecoins have no CG-snap, so r.marketCap was 0 for every row
          // -> "$0" in the MCap column. DexScreener's deepest-good-pair marketCap
          // (with fdv fallback for unknown-circulating-supply memecoins) fixes it.
          if (e.marketCap > 0) r.marketCap = e.marketCap;
          // DexScreener clean-percent change windows from the deepest good pair;
          // pickWin falls back to Codex native (then 0) only where DexScreener
          // lacks a window on a live token.
          const cx5m = r.change5m, cx1h = r.change1, cx6h = r.change6h, cx24 = r.change24;
          r.change5m = pickWin(e.chg5m, cx5m);
          r.change1 = pickWin(e.chg1h, cx1h);
          r.change6h = pickWin(e.chg6h, cx6h); // Codex has no native 6h -> 0 when DexScreener lacks it
          r.change24 = pickWin(e.chg24h, cx24);
        }
      }
      // A Robinhood row has no Codex origin, so PRICE, PAIR AGE and (often) the
      // LOGO have no other source than this same DexScreener aggregate - on every
      // other chain Codex supplies them, which is why the shared loop above does
      // not. Without this the board renders "$0" in Price and an empty Age column,
      // and scoreTraction's age/newborn logic sees `createdAt: null` and has no
      // opinion on how old anything is.
      // Scoped to this chain on purpose: Codex's priceUSD/createdAt must keep
      // winning everywhere else.
      if (robinhoodOnly) {
        // The board is only as fresh as the NUMBERS on it, not as fresh as the
        // rebuild: a degraded sweep can serve a last-good map minutes old.
        rhDataAsOf = enr.asOf || null;
        for (const r of cleanResults) {
          const e = r.token && enr.get(dsNorm(r.token.address));
          if (!e) continue;
          if (e.priceUsd > 0) r.priceUSD = e.priceUsd;
          if (e.pairCreatedAt) r.createdAt = e.pairCreatedAt;
          if (r.token.info && !r.token.info.imageThumbUrl && e.logo) r.token.info.imageThumbUrl = e.logo;
        }
      }
    } catch (enrichErr) {
      console.error('[trending] DexScreener enrich failed:', enrichErr.message || enrichErr);
    }

    // Robinhood candidates carry no numbers until the enrichment above, so their
    // spam screen runs HERE rather than at discovery. isSpamToken's volume /
    // liquidity / market-cap floors, its wash ratio and its insane-print check
    // are exactly what strips the dead tail the old browser-side GT board
    // rendered (SNOWBALL: $9.2k pooled against $13.5M of trailing 24h volume at
    // -99.96%; HUNTER: $6.7k against $5.6M at -89.78%).
    // The two NAME rules that misfire on this chain's "<Asset>  Robinhood Token"
    // convention are neutralised at the source in _lib/robinhood-chain.cjs.
    if (robinhoodOnly) cleanResults = cleanResults.filter(r => !isSpamToken(r));

    // Identity-squat screen. A fresh token wearing an established token's name
    // is the worst thing a discovery board can show - measured 2026-07-23,
    // three of our BSC top five were address-prefix-spoofed fakes of the exact
    // tokens DexScreener was trending (ours 0x40b80069 "Unibase" $0.37M/0.7d vs
    // the real 0x40b8129B $326.60M/314d - note the shared 40b8 prefix), and our
    // SOL #4 was a 2.4h-old $0.16M "ANSEM / The Black Bull" against the real
    // $317.93M one. The board's own narrative clustering cannot see this: it
    // only compares rows WITHIN the board, and the original is usually absent.
    // A confirmed namesquat is a fact (an older contract with the identical name
    // demonstrably exists), so it DROPS; a ticker-only squat rides the quality
    // floor and stays visible. Fail-open - never lets an outage empty a board.
    try {
      const { screenImpersonators } = _require('./_lib/token-impersonation.cjs');
      const verdicts = await screenImpersonators(cleanResults, { budgetMs: 6000 });
      if (verdicts.size) {
        const before = cleanResults.length;
        cleanResults = cleanResults.filter((r) => {
          const v = r.token && verdicts.get(String(r.token.address).toLowerCase());
          if (!v) return true;
          if (v.kind === 'namesquat') return false;
          r._impersonates = v; // demoted by trending-score, kept visible with a badge
          return true;
        });
        if (before !== cleanResults.length) {
          console.log(`[trend-impersonation] dropped ${before - cleanResults.length}/${before} identity squats`);
        }
      }
    } catch (impErr) {
      console.error('[trend-impersonation] screen failed (fail-open):', impErr.message || impErr);
    }

    // Traction-weighted, per-chain, timeframe-aware ranking (replaces the old
    // volume-DESC + curated-3x sort). scoreTraction gates illiquid one-print
    // pumps + wash trades to 0 and ranks on real activity.
    // Score BEFORE spreading: scoreTraction's `annotate` writes `_quality` onto
    // the source row, and object spread evaluates `...r` before the property that
    // calls it - inlining the call would copy the row a tick too early and
    // silently drop every quality annotation.
    const scored = cleanResults.map(r => {
      const _trendScore = scoreTraction(r, { window, annotate: true });
      return { ...r, _trendScore };
    });
    scored.sort((a, b) => b._trendScore - a._trendScore);

    let ranked = dedupTrendingByIdentity(scored.filter(r => r._trendScore > 0));

    // Fill toward TARGET so each chain shows a full board even when few tokens
    // clear the strict liquidity floor. Fill rows relax the LIQUIDITY floor only -
    // they still have to be eligible, enriched, recently-active AND MOVING
    // (scoreTraction's movement gate is unconditional as of Trending v2; the old
    // fill-tier bypass was what let flat month-old large caps pad the board).
    // 30 is the right size for a trending STRIP; the Robinhood board is a
    // whole-chain screener and fills to the requested limit instead.
    const TARGET = robinhoodOnly ? limitNum : 30;
    if (ranked.length < TARGET) {
      const have = new Set(ranked.map(r => r.token && r.token.address));
      const floor = ranked.length ? Math.min(...ranked.map(r => r._trendScore)) : 0.5;
      const fill = cleanResults
        .filter(r => r.token && !have.has(r.token.address))
        .map(r => {
          // Score first, then spread - see the note on the strict pass above.
          const _trendScore = scoreTraction(r, { window, relaxLiq: true, annotate: true });
          return { ...r, _trendScore };
        })
        .filter(r => r._trendScore > 0);
      fill.sort((a, b) => b._trendScore - a._trendScore);
      const maxFill = fill.length ? fill[0]._trendScore : 1;
      fill.forEach(r => { r._trendScore = floor * 0.95 * (r._trendScore / maxFill); });
      ranked = dedupTrendingByIdentity(ranked.concat(fill));
    }

    // Tier 3 - "also active", Robinhood only.
    //
    // The movement gate above is unconditional, which is correct for a trending
    // strip and wrong for the one board that IS the chain: NVDA, SPY, TSLA and
    // SGOV are flat on most days, and a Robinhood board without them is not a
    // Robinhood board. So the remaining candidates come back with the movement
    // gate relaxed - every other gate (eligibility, enrichment, liquidity,
    // recent activity, wash, newborn) still applies - scored strictly below the
    // movers and tagged `tier:'active'` so the client can separate them instead
    // of implying they are trending.
    //
    // The dev twin (packages/server/index.js) runs this pass for EVERY chain as
    // part of Trending v2; that has not been ported here, so this is scoped to
    // the board that needs it rather than silently changing every other chain's
    // prod behaviour.
    ranked.forEach(r => { if (!r._tier) r._tier = 'moving'; });
    if (robinhoodOnly && ranked.length < TARGET) {
      const have = new Set(ranked.map(r => r.token && r.token.address));
      const floor = ranked.length ? Math.min(...ranked.map(r => r._trendScore)) : 0.5;
      const flat = cleanResults
        .filter(r => r.token && !have.has(r.token.address))
        .map(r => {
          const _trendScore = scoreTraction(r, { window, relaxLiq: true, allowFlat: true, annotate: true });
          return { ...r, _trendScore, _tier: 'active' };
        })
        .filter(r => r._trendScore > 0);
      flat.sort((a, b) => b._trendScore - a._trendScore);
      const maxFlat = flat.length ? flat[0]._trendScore : 1;
      flat.forEach(r => { r._trendScore = floor * 0.5 * (r._trendScore / maxFlat); });
      ranked = dedupTrendingByIdentity(ranked.concat(flat.slice(0, TARGET - ranked.length)));
    }

    const results = ranked
      .slice(0, limitNum)
      .map((r) => {
        const { _trendScore, _quality, _similar, _safety, _impersonates, _tier, ...rest } = r;
        // Expose the traction rank so the client renders trending order instead of
        // re-sorting by raw volume (which floats SOL/stables/blue-chips to the top).
        return {
          ...rest,
          volume: r.volume24 || 0,
          trendScore: Math.round((_trendScore || 0) * 1000) / 1000,
          // Why this row ranks where it does - see the dev twin in
          // packages/server/index.js. (Prod has no RugCheck/GoPlus sweep, so
          // `safety` is always null here and securityFactor stays neutral; every
          // other quality signal is computed from the DexScreener-enriched
          // fields both environments already hold.)
          quality: _quality ? Math.round(_quality.factor * 100) / 100 : 1,
          qualityReasons: (_quality && _quality.reasons) || [],
          safety: _safety || null,
          similar: _similar || null,
          // Surviving ticker-squats carry what they are squatting, so the row
          // can be badged instead of quietly ranked last.
          impersonates: _impersonates || null,
          // 'moving' = actually trending. 'active' = real trading, flat price.
          tier: _tier || 'moving',
        };
      });
    // `asOf` is when the DATA was built. The response passes through a KV
    // cache and an edge cache, so serve-time is not data-time; a client that
    // ages its freshness readout from the fetch would claim "Live - now" over
    // a board minutes old.
    return { results, asOf: rhDataAsOf || Date.now() };
  }

  // Codex produced ZERO candidates (outage / breaker open / cold miss). Serve
  // the REAL Hetzner CG-trending partial (typically 6-12 hydrated majors)
  // instead of fabricated rows - during the 2026-07-16 Codex blackout the old
  // static TRENDING_FALLBACK rendered "PEPE $5.00B +15.00%" placeholder rows
  // as a LIVE board. Real-but-short beats fake-but-full; when Hetzner is also
  // down, an honest empty board beats both.
  // The Codex Promise.all can reject before spectreTrending was assigned (the
  // volume24 pass has no .catch) - await the still-in-flight (catch-guarded)
  // Hetzner promise so the degraded board isn't lost to that race.
  // 🪤 NOT for Robinhood: that partial is a generic cross-chain CoinGecko
  // mirror, so serving it here would answer "show me Robinhood Chain" with
  // tokens that are not on it. An empty result lets the client fall back to its
  // own GeckoTerminal lane, which at least stays on the requested chain.
  if (robinhoodOnly) return { results: [] };
  if (!spectreTrending) spectreTrending = await spectreTrendingPromise;
  if (spectreTrending?.results?.length) return { results: spectreTrending.results };
  return { results: [] };
}

// Reused by api/research-desk.js (memes tier) — the prod analogue of the dev
// `module.exports.computeTrendingTokens`. Named export so research-desk can call
// the exact same trending engine in-process (zero HTTP hop, zero extra Codex
// cost beyond the shared KV trending cache). Importing it does NOT run the
// default handler (codex.js has no top-level side effects).
export { handleTrendingTokens };

// Timeframe -> lookback window for "Most Visited" ranking (mirrors the dev route
// VIEW_WINDOWS). Per-hit timestamps in KV let the 5m/1h/6h/24h toggle rank by
// visits-in-that-window, not a fixed total.
const MV_WINDOWS = { '5m': 5 * 60 * 1000, '1h': 60 * 60 * 1000, '6h': 6 * 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000 };

// Record one token-page view toward the "Most Visited" leaderboard. KV-backed,
// Codex-neutral (zero GraphQL). Fire-and-forget from the client via sendBeacon.
async function handleRecordView(body) {
  try {
    const b = typeof body === 'string' ? JSON.parse(body || '{}') : (body || {});
    const { address, networkId, symbol, name, logo, createdAt } = b;
    if (!address || networkId == null) return;
    // Reject truncated/placeholder addresses (un-enrichable, would pollute the board).
    if (typeof address !== 'string' || address.includes('..') ||
        !(/^0x[0-9a-fA-F]{40}$/.test(address) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))) return;
    const member = `${networkId}:${dsNorm(address)}`;
    await recordTokenViewKv(member, {
      address,
      networkId: Number(networkId),
      symbol: symbol || '',
      name: name || '',
      logo: logo || '',
      createdAt: createdAt || null,
    }, Date.now());
  } catch (_) { /* never break the view ping */ }
}

// "Most Visited" - real Trading-Platform token-page visits, ranked by visits
// WITHIN the selected window (5m/1h/6h/24h), enriched fresh from DexScreener so
// price/changes/liquidity are current. Returns the SAME row shape as
// handleTrendingTokens so the client maps it identically (trendScore = windowed
// view count preserves order).
async function handleMostVisited(networkIds, limit = 30, windowKey = '24h') {
  const limitNum = Math.min(parseInt(limit) || 30, 50);
  const windowMs = MV_WINDOWS[windowKey] || MV_WINDOWS['24h'];
  // Wider candidate pool so dropping un-enrichable junk still fills the limit.
  const top = await getTopTokenViewsKv(windowMs, Date.now(), limitNum * 3);
  const netSet = (networkIds && networkIds.length) ? new Set(networkIds) : null;
  const picked = [];
  for (const row of top) {
    const meta = row.meta || {};
    const nid = Number(meta.networkId);
    if (!meta.address || !isFinite(nid)) continue;
    if (netSet && !netSet.has(nid)) continue;
    picked.push({ meta, networkId: nid, views: row.views, total24h: row.total24h });
  }
  if (!picked.length) return { results: [] };

  // DexScreener market data + Codex token metadata (canonical logo + createdAt
  // + native change windows), IN PARALLEL. change5m/change1/change24 are
  // token-level change ATTRIBUTES, NOT listPairsWithMetadataForToken fields, so
  // they ride free - exactly like the trending query selects change1+change24
  // (see the lockstep cost note ~:1343: the billable fields are volume24/
  // liquidity/marketCap/change4/change12/holders/txnCount24, which we still
  // omit). They are the Codex fallback when DexScreener lacks a window (its m5/
  // h1 are often null for lower-frequency visited tokens). Codex has NO native
  // 6h, so change6h stays DexScreener-only.
  const META_QUERY = `
    query MVMeta($tokens: [String!]!, $limit: Int!) {
      filterTokens(tokens: $tokens, limit: $limit) {
        results { token { address symbol name networkId info { imageThumbUrl } } createdAt change5m change1 change24 }
      }
    }
  `;
  const tokenKeys = picked.map(p => `${p.networkId === 1399811149 ? p.meta.address : String(p.meta.address).toLowerCase()}:${p.networkId}`);
  const [enrRes, metaRes] = await Promise.allSettled([
    enrichFromDexScreener(picked.map(p => ({ address: p.meta.address, networkId: p.networkId }))),
    executeCodexQuery(META_QUERY, { tokens: tokenKeys, limit: Math.min(Math.max(picked.length, 1), 200) }),
  ]);
  const enr = enrRes.status === 'fulfilled' && enrRes.value ? enrRes.value : new Map();
  const codexMeta = new Map(); // dsNorm(addr) -> { logo, createdAt(sec), symbol, name, change5m, change1, change24 }
  if (metaRes.status === 'fulfilled') {
    for (const r of (metaRes.value?.filterTokens?.results || [])) {
      const t = r.token; if (!t || !t.address) continue;
      codexMeta.set(dsNorm(t.address), {
        logo: (t.info && t.info.imageThumbUrl) || null,
        createdAt: r.createdAt ? Number(r.createdAt) : null,
        symbol: t.symbol || '', name: t.name || '',
        // Codex-format change (dual-format: |v|<1 ratio, |v|>=1 percent) - passed
        // to pickWin as the codexNative fallback (it does not re-scale, matching
        // how the trending handler feeds Codex-native changes through pickWin).
        change5m: r.change5m, change1: r.change1, change24: r.change24,
      });
    }
  }

  // Only enriched rows are returned - no $0/"-" rows from junk addresses or
  // dead tokens, same quality bar as trending.
  const results = picked
    .map(({ meta, networkId, views, total24h }) => {
      const e = meta.address ? enr.get(dsNorm(meta.address)) : null;
      if (!e) return null;
      const cm = meta.address ? codexMeta.get(dsNorm(meta.address)) : null;
      // logo/age: Codex (canonical) -> client-recorded -> DexScreener
      // (pairCreatedAt is MILLISECONDS; formatAge expects SECONDS -> /1000).
      const logo = (cm && cm.logo) || meta.logo || e.logo || null;
      const createdAt = (cm && cm.createdAt) || meta.createdAt ||
        (e.pairCreatedAt ? Math.floor(e.pairCreatedAt / 1000) : null);
      return {
        // Per-window merge: DexScreener first, Codex native as fallback (same as
        // the trending handler's pickWin). DexScreener often omits the short
        // windows (m5/h1) for lower-frequency visited tokens, so Codex's native
        // change5m/change1/change24 fill them. 6h has no Codex source (Codex has
        // no native 6h) so it stays DexScreener-only -> null ("-") when absent.
        // A window genuinely missing from BOTH sources renders "-" not "0.00%".
        token: { address: meta.address, symbol: meta.symbol || (cm && cm.symbol) || 'UNKNOWN', name: meta.name || (cm && cm.name) || '', networkId, info: { imageThumbUrl: logo } },
        priceUSD: e.priceUsd,
        change5m: pickWin(e.chg5m, cm && cm.change5m),
        change1: pickWin(e.chg1h, cm && cm.change1),
        change6h: pickWin(e.chg6h, null),
        change24: pickWin(e.chg24h, cm && cm.change24),
        volume24: e.volume24,
        liquidity: e.liquidity,
        marketCap: e.marketCap,
        txnCount24: e.txnCount24,
        buys24: e.buys24,
        sells24: e.sells24,
        createdAt,
        // windowed visit count IS the rank score (client preserves order);
        // views24h is the full-day total for reference.
        trendScore: views,
        windowViews: views,
        views24h: total24h,
        volume: e.volume24,
      };
    })
    .filter(Boolean)
    .slice(0, limitNum);
  return { results };
}

/**
 * Well-known token addresses for major cryptocurrencies
 * These are the canonical wrapped versions on their primary networks
 */
const WELL_KNOWN_TOKENS = {
  // Bitcoin - use WBTC (Wrapped BTC) on Ethereum mainnet for accurate price
  BTC: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', networkId: 1, name: 'Bitcoin' },
  // Ethereum - use WETH on Ethereum mainnet
  ETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', networkId: 1, name: 'Ethereum' },
  // Solana - use wrapped SOL on Solana
  SOL: { address: 'So11111111111111111111111111111111111111112', networkId: 1399811149, name: 'Solana' },
  // The rest of the native set the token page polls every 30s
  // (nativePricesStore: ETH,SOL,BNB,POL,MATIC,ARB). Same addresses as the dev
  // token registry. Without these, BNB/POL/MATIC/ARB each paid a phrase search
  // (GetPrice) on every poll - 4 of the 6 queries that poll used to cost.
  BNB: { address: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52', networkId: 1, name: 'BNB' },
  MATIC: { address: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', networkId: 1, name: 'Polygon' },
  ARB: { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', networkId: 42161, name: 'Arbitrum' },
};
// POL is MATIC after the 1:1 migration - same asset, same price (mirrors the
// dev twin's _PRICE_SYMBOL_ALIAS).
const PRICE_SYMBOL_ALIAS = { POL: 'MATIC' };

// Handler for token prices (for trending bar and crypto widgets)
// Batched: groups well-known tokens into 1 query per network, remaining into parallel phrase queries
async function handleTokenPrices(symbols) {
  const results = {};

  // Split symbols into well-known (by address) vs unknown (by phrase search)
  const unknownSymbols = [];

  const knownTokens = []; // [{ symbol, address, networkId }]
  for (const symbol of symbols) {
    const upper = symbol.toUpperCase();
    const known = WELL_KNOWN_TOKENS[PRICE_SYMBOL_ALIAS[upper] || upper];
    if (known) {
      knownTokens.push({ symbol: upper, address: known.address, networkId: known.networkId });
    } else {
      unknownSymbols.push(upper);
    }
  }

  // ONE query for every registry token, whatever the network: filterTokens
  // `tokens: ["<addr>:<networkId>"]` spans networks (the details-batch handler
  // relies on the same form). This used to be one query per network.
  // LEVER 3 (2026-06-02): volume24/marketCap/liquidity DROPPED - this handler
  // only returns { price, change, change24 } so those selections were dead
  // weight billing lockstep on every call.
  const batchQuery = `
    query GetTokensByAddress($tokens: [String!]!, $limit: Int!) {
      filterTokens(
        tokens: $tokens
        limit: $limit
      ) {
        results {
          token { address symbol name networkId }
          priceUSD
          change24
        }
      }
    }
  `;

  const batchPromises = knownTokens.length === 0 ? [] : [(async () => {
    try {
      const ids = [...new Set(knownTokens.map(t =>
        `${t.networkId === 1399811149 ? t.address : t.address.toLowerCase()}:${t.networkId}`))];
      const data = await executeCodexQuery(batchQuery, { tokens: ids, limit: Math.min(Math.max(ids.length, 1), 200) });
      const apiResults = data?.filterTokens?.results || [];
      const byId = new Map(apiResults.map(r => [`${String(r.token?.address || '').toLowerCase()}:${r.token?.networkId}`, r]));
      for (const t of knownTokens) {
        const match = byId.get(`${t.address.toLowerCase()}:${t.networkId}`);
        if (match) {
          const price = parseFloat(match.priceUSD) || 0;
          const change = parseFloat(match.change24) || 0;
          results[t.symbol] = { price, change, change24: change };
        }
      }
    } catch (e) {
      console.error('Batch price lookup error:', e.message);
    }
  })()];

  // Parallel phrase queries for unknown symbols
  const unknownPromises = unknownSymbols.map(async (upper) => {
    try {
      // LEVER 3 (2026-06-02): liquidity field dropped. Liquidity ranking
      // attribute KEPT so Codex still orders results by liquidity DESC.
      // The top result is already the most-liquid match.
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
        results[upper] = {
          price: parseFloat(match.priceUSD) || 0,
          change: parseFloat(match.change24) || 0,
          change24: parseFloat(match.change24) || 0,
        };
      }
    } catch (e) {
      console.error(`Price lookup error for ${upper}:`, e.message);
    }
  });

  await Promise.all([...batchPromises, ...unknownPromises]);

  return results;
}

// Known tokens with their addresses (for symbol lookup)
const KNOWN_TOKEN_ADDRESSES = {
  'SPECTRE': { address: '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6', networkId: 1 },
  'PEPE': { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', networkId: 1 },
  'DOGE': { address: '0x4206931337dc273a630d328dA6441786BfaD668f', networkId: 1 },
  'SHIB': { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', networkId: 1 },
  'FLOKI': { address: '0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E', networkId: 1 },
  'UNI': { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', networkId: 1 },
  'AAVE': { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', networkId: 1 },
  'LINK': { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', networkId: 1 },
  'GRT': { address: '0xc944E90C64B2c07662A292be6244BDf05Cda44a7', networkId: 1 },
  'MKR': { address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', networkId: 1 },
  'CRV': { address: '0xD533a949740bb3306d119CC777fa900bA034cd52', networkId: 1 },
  'SUSHI': { address: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2', networkId: 1 },
  'WIF': { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', networkId: 1399811149 },
  'BONK': { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', networkId: 1399811149 },
  'MOODENG': { address: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', networkId: 1399811149 },
  'PAAL': { address: '0x14fee680690900ba0cccfc76ad70fd1b95d10e16', networkId: 1 },
};

/**
 * Batch price fetch using Codex getTokenPrices API.
 * Accepts up to 25 {address, networkId} pairs per call.
 * Returns { prices: [{ address, networkId, priceUsd, timestamp }] }
 */
async function handleBatchPrices(tokens) {
  if (!tokens || !tokens.length) return { prices: [] };

  // Codex getTokenPrices accepts max 25 per call
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 25) {
    chunks.push(tokens.slice(i, i + 25));
  }

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

  const allPrices = [];
  await Promise.all(chunks.map(async (chunk) => {
    try {
      const inputs = chunk.map(t => ({
        address: t.address,
        networkId: parseInt(t.networkId),
      }));
      const data = await executeCodexQueryAllowPartial(query, { inputs });
      const prices = data?.getTokenPrices || [];
      allPrices.push(...prices);
    } catch (err) {
      console.error('Batch prices chunk error:', err.message);
    }
  }));

  return { prices: allPrices };
}

/**
 * Top tokens by market cap using Codex filterTokens.
 * Replaces CoinGecko /coins/markets for ranking + sparklines.
 */
async function handleTopTokens(limit = 50, networkIds = null) {
  const effectiveLimit = Math.min(parseInt(limit) || 50, 100);
  const nets = networkIds || [1, 56, 1399811149, 42161, 8453];

  // LEVER 3 (2026-06-02): shrunken selection. marketCap ranking attribute KEPT
  // (Codex still orders results by marketCap DESC, the canonical sort axis for
  // this endpoint). volume24/liquidity/marketCap/change4/change12/holders/
  // txnCount24 DROPPED from selection - each was billing the
  // listPairsWithMetadataForToken lockstep. Backfilled below via spectre-data.
  const query = `
    query TopTokens($networkFilter: [Int!], $limit: Int) {
      filterTokens(
        filters: { network: $networkFilter }
        limit: $limit
        rankings: { attribute: marketCap, direction: DESC }
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
              circulatingSupply
              totalSupply
            }
          }
          priceUSD
          change1
          change24
          createdAt
        }
      }
    }
  `;

  const data = await executeCodexQuery(query, {
    networkFilter: nets,
    limit: effectiveLimit,
  });

  const results = data?.filterTokens?.results || [];

  // LEVER 3 bulk backfill: pull dropped fields from helper. Top tokens are
  // almost all in the top-500 by mcap so Tier 1 (KV codex:v1:snap-cg) hits.
  const backfillInputs = results
    .filter(r => r?.token?.address)
    .map(r => ({ address: r.token.address, networkId: r.token.networkId }));
  const backfill = backfillInputs.length
    ? await _spectreData.getMarketDataForAddresses(backfillInputs).catch(() => new Map())
    : new Map();

  // Normalize to same format as the old CoinGecko top-coins response
  const tokens = results.map((r, i) => {
    const bf = backfill.get((r.token?.address || '').toLowerCase()) || {};
    return {
      rank: i + 1,
      address: r.token?.address || '',
      networkId: r.token?.networkId || 1,
      symbol: (r.token?.symbol || '').toUpperCase(),
      name: r.token?.name || '',
      logo: r.token?.info?.imageThumbUrl || r.token?.info?.imageLargeUrl || null,
      price: parseFloat(r.priceUSD) || 0,
      change5m: null,
      change1h: parseFloat(r.change1) || null,
      change4h: parseFloat(bf.change4) || null,
      change24h: parseFloat(r.change24) || null,
      change12h: parseFloat(bf.change12) || null,
      volume24h: parseFloat(bf.volume24) || 0,
      marketCap: parseFloat(bf.marketCap) || 0,
      liquidity: parseFloat(bf.liquidity) || 0,
      holders: bf.holders || null,
      txnCount24: bf.txnCount24 || null,
      createdAt: r.createdAt ? Number(r.createdAt) : null,
      sparkline: [],
      _source: 'codex',
    };
  });

  return { tokens, timestamp: Date.now() };
}

// Handler for chart bars (OHLCV data)
async function handleBars(symbol, from, to, resolution, networkId) {
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
      console.log(`Unknown token symbol for chart: ${upperSymbol}`);
      return { bars: [] };
    }
  }
  // It's a raw token address
  else {
    tokenAddress = symbol;
  }
  
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
  const codexResolution = resolutionMap[resolution] || resolution;
  
  // Symbol format: "tokenAddress:networkId"
  const tokenSymbol = `${formattedAddress}:${netId}`;
  
  console.log(`Fetching token bars: symbol=${tokenSymbol}, from=${from}, to=${to}, resolution=${codexResolution}`);
  
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

  // Fallback: if weekly (7D) returned empty, fetch daily bars and aggregate into weeks
  if (codexResolution === '7D' && (!data?.getTokenBars || !data.getTokenBars.t?.length)) {
    console.log(`No weekly bars for ${tokenSymbol}, aggregating from daily`);
    data = await executeCodexQuery(query, {
      symbol: tokenSymbol,
      from: parseInt(from),
      to: parseInt(to),
      resolution: '1D',
    });
    const dailyBars = data?.getTokenBars;
    if (dailyBars?.t?.length > 0) {
      const daily = dailyBars.t.map((t, i) => ({
        t, o: dailyBars.o[i], h: dailyBars.h[i], l: dailyBars.l[i], c: dailyBars.c[i],
        v: parseFloat(dailyBars.volume?.[i]) || 0,
      }));
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
  }

  // Handle various response formats
  let rawBars = data?.getTokenBars;

  // Check if we got valid bars data
  if (!rawBars) {
    console.log(`No bars data returned for ${tokenSymbol}`);
    return { bars: [] };
  }
  
  // Handle parallel arrays format (API returns { o: [...], h: [...], ... })
  if (rawBars && typeof rawBars === 'object' && !Array.isArray(rawBars)) {
    if (rawBars.o && Array.isArray(rawBars.o)) {
      console.log(`Converting parallel arrays format for ${tokenSymbol}`);
      const bars = rawBars.t.map((t, i) => ({
        t: t,
        o: rawBars.o[i],
        h: rawBars.h[i],
        l: rawBars.l[i],
        c: rawBars.c[i],
        v: rawBars.volume?.[i] || rawBars.v?.[i] || 0
      }));
      console.log(`Fetched ${bars.length} bars for ${tokenSymbol}`);
      return { bars };
    }
    console.log(`Unexpected bars object format for ${tokenSymbol}`);
    return { bars: [] };
  }
  
  // Ensure we have an array
  if (!Array.isArray(rawBars)) {
    console.log(`Unexpected bars type for ${tokenSymbol}: ${typeof rawBars}`);
    return { bars: [] };
  }
  
  // Transform response to match expected format
  const bars = rawBars.map(bar => ({
    t: bar.t,
    o: bar.o,
    h: bar.h,
    l: bar.l,
    c: bar.c,
    v: bar.volume || bar.v || 0
  }));
  
  console.log(`Fetched ${bars.length} bars for ${tokenSymbol}`);
  return { bars };
}

// Handler for ATH (All-Time High) from CoinGecko
async function handleATH(address, networkId) {
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

  const platform = platformMap[parseInt(networkId)] || 'ethereum';
  
  try {
    const cgUrl = `https://api.coingecko.com/api/v3/coins/${platform}/contract/${address.toLowerCase()}`;
    console.log(`Fetching ATH from CoinGecko: ${cgUrl}`);
    
    const response = await fetch(cgUrl, {
      headers: { 'Accept': 'application/json' }
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

// Trades cache - 60s TTL, max 200 entries
const _tradesCache = new Map();
const TRADES_CACHE_TTL = 60_000;
const _tradesInflight = new Map(); // key -> Promise (dedup concurrent requests)

// Static token metadata caches - pairs + decimals are immutable on-chain facts
const _pairsCache = new Map();       // key: `${address}:${networkId}` -> { data, ts }
const _PAIRS_CACHE_TTL = 86_400_000; // 24 hours
const _decimalsCache = new Map();    // key: `${address}:${networkId}` -> { data, ts }
const _DECIMALS_CACHE_TTL = 86_400_000;

function _evictOldest(map, maxSize) {
  if (map.size <= maxSize) return;
  let oldestKey = null, oldestTs = Infinity;
  for (const [k, v] of map) {
    if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
  }
  if (oldestKey) map.delete(oldestKey);
}

// Handler for token trades (fetches pairs first, then trades for each pair)
// Optimized: pairs + decimals fetched in parallel, 30s server-side cache
// --- Per-wallet trading stats for one token (Codex filterTokenWallets) ------
// PROD TWIN of the dev route in packages/server/index.js (/api/token/wallet-stats).
// Powers the Holders tab's PnL + Remaining columns. Keep the query, the
// validation and normalizeWalletStats() below IDENTICAL in both files.
//
// Codex only indexes wallets that SWAPPED the token - a wallet that received it
// by transfer/airdrop/CEX has no cost basis and must render "-" rather than a
// fabricated zero-cost position.
const _WS_EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;
const _WS_SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const _wsIsAddr = (a) => _WS_EVM_ADDR.test(a) || _WS_SOL_ADDR.test(a);

// Codex returns every numeric as a STRING. `key` is the join key: EVM addresses
// are case-insensitive so they lowercase, Solana base58 is case-SENSITIVE and
// must never be folded. Same rule in the dev route + the client.
function normalizeWalletStats(results) {
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  return (Array.isArray(results) ? results : []).map((r) => {
    const addr = String(r.address || '');
    return {
      address: addr,
      key: addr.startsWith('0x') ? addr.toLowerCase() : addr,
      balance: num(r.tokenBalanceLive),
      balanceUsd: num(r.tokenBalanceLiveUsd),
      costUsd: num(r.tokenAcquisitionCostUsd),
      purchased: num(r.purchasedTokenBalance),
      bought1y: num(r.tokenAmountBought1y),
      sold1y: num(r.tokenAmountSold1y),
      boughtUsd1y: num(r.amountBoughtUsd1y),
      soldUsd1y: num(r.amountSoldUsd1y),
      realizedUsd1y: num(r.realizedProfitUsd1y),
      realizedPct1y: num(r.realizedProfitPercentage1y),
      buys1y: num(r.buys1y),
      sells1y: num(r.sells1y),
      firstAt: num(r.firstTransactionAt),
      lastAt: num(r.lastTransactionAt),
      // Apps this wallet has routed trades through (Codex walletTradeSourceIds).
      // "trades through", never "is owned by" - one routed trade is enough.
      sources: Array.isArray(r.walletTradeSourceIds) ? r.walletTradeSourceIds.filter(Boolean) : [],
    };
  });
}

// Codex Event.tradeSource -> { id, name } or null. PROD TWIN of the dev helper
// in packages/server/index.js - keep identical.
function normalizeTradeSource(ts) {
  if (!ts || !ts.id) return null;
  return { id: String(ts.id), name: ts.displayName ? String(ts.displayName) : String(ts.id) };
}

// --- Top traders (Codex tokenTopTraders) -----------------------------------
// PROD TWIN of the dev route /api/token/top-traders in packages/server/index.js
// - keep normalizeTopTraders identical. Ranked by realized PnL (best = DESC
// returns only green wallets, worst = ASC returns only red wallets - Codex's own
// contract for this ranking) or by traded volume, over DAY/WEEK/MONTH/YEAR.
const TOP_TRADER_PERIODS = new Set(['DAY', 'WEEK', 'MONTH', 'YEAR']);
const TOP_TRADER_RANKS = {
  best: '{ attribute: realizedProfitUsd, direction: DESC }',
  worst: '{ attribute: realizedProfitUsd, direction: ASC }',
  volume: '{ attribute: volumeUsd, direction: DESC }',
};

function normalizeTopTraders(items) {
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  return (Array.isArray(items) ? items : []).filter(Boolean).map((t, i) => {
    const addr = String(t.walletAddress || '');
    const labels = Array.isArray(t.labels) ? t.labels.filter(Boolean) : [];
    return {
      rank: i + 1,
      address: addr,
      key: addr.startsWith('0x') ? addr.toLowerCase() : addr,
      bought: num(t.tokenAmountBought),
      sold: num(t.tokenAmountSold),
      boughtUsd: num(t.amountBoughtUsd),
      soldUsd: num(t.amountSoldUsd),
      volumeUsd: num(t.volumeUsd),
      realizedUsd: num(t.realizedProfitUsd),
      realizedPct: num(t.realizedProfitPercentage),
      buys: num(t.buys),
      sells: num(t.sells),
      balance: num(t.tokenBalance),
      firstAt: num(t.firstTransactionAt),
      lastAt: num(t.lastTransactionAt),
      labels,
      // Bot = Codex's own label or a strong score. The SCAMMER label ships on
      // wallets with scammerScore 1, and on a fresh launch the whole top-25
      // sits at 50-85 (measured 2026-09-11) - so only a STRONG score marks a
      // wallet as flagged. Never defame on a weak signal.
      isBot: labels.includes('BOT') || num(t.botScore) >= 70,
      isSniper: labels.includes('SNIPER'),
      isFlagged: num(t.scammerScore) >= 80,
      isSmart: labels.some((l) => String(l).startsWith('SMART_TRADER')),
      category: t.wallet?.category || null,
      displayName: t.wallet?.displayName || null,
    };
  });
}

async function handleTopTraders(tokenAddress, networkId, period, rank, limit) {
  const netId = parseInt(networkId) || 1;
  const isSol = netId === 1399811149;
  const tokenAddr = isSol ? String(tokenAddress) : String(tokenAddress).toLowerCase();
  if (!_wsIsAddr(tokenAddr)) return { items: [], error: 'invalid_token_address' };

  const per = String(period || 'DAY').toUpperCase();
  const tradingPeriod = TOP_TRADER_PERIODS.has(per) ? per : 'DAY';
  const rankKey = TOP_TRADER_RANKS[String(rank)] ? String(rank) : 'best';
  const lim = Math.min(50, Math.max(1, parseInt(limit) || 25));

  const query = `query {
    tokenTopTraders(input: {
      tokenAddress: "${tokenAddr}"
      networkId: ${netId}
      tradingPeriod: ${tradingPeriod}
      ranking: ${TOP_TRADER_RANKS[rankKey]}
      limit: ${lim}
    }) {
      items {
        walletAddress
        tokenAmountBought
        tokenAmountSold
        amountBoughtUsd
        amountSoldUsd
        volumeUsd
        realizedProfitUsd
        realizedProfitPercentage
        buys
        sells
        tokenBalance
        firstTransactionAt
        lastTransactionAt
        labels
        scammerScore
        botScore
        wallet { category displayName }
      }
    }
  }`;

  try {
    const data = await executeCodexQuery(query);
    return { items: normalizeTopTraders(data?.tokenTopTraders?.items), period: tradingPeriod, rank: rankKey };
  } catch (err) {
    console.error('[top-traders] failed:', err.message);
    return { items: [], period: tradingPeriod, rank: rankKey, error: err.message };
  }
}

// --- Liquidity locks (Codex liquidityLocksV2) -------------------------------
// PROD TWIN of the dev route /api/token/liquidity-locks in packages/server/
// index.js - keep normalizeLiquidityLocks identical. Per-pool lock state read
// from CURRENT on-chain state, with per-holder attribution (burned LP, UNCX /
// Team Finance lockers, Doppler positions, the pair contract). Amounts are
// LP-token units, so only RATIOS are meaningful - every amount is converted to a
// share of the pool's total LP.
function normalizeLiquidityLocks(items) {
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  return (Array.isArray(items) ? items : []).filter(Boolean).map((p) => {
    const liquidity = num(p.liquidity) || (num(p.locked) + num(p.unlocked));
    const share = (v) => (liquidity > 0 ? Math.max(0, Math.min(100, (num(v) / liquidity) * 100)) : 0);
    const holders = (Array.isArray(p.holders) ? p.holders : []).filter(Boolean).map((h) => ({
      entityId: h.entityId || null,
      name: h.displayName || null,
      protocol: h.lockProtocol || null,
      sharePct: share(h.amount),
      permanent: !!h.permanent,
      unlockAt: h.unlockAt != null && num(h.unlockAt) > 0 ? num(h.unlockAt) : null,
    })).sort((a, b) => b.sharePct - a.sharePct);
    return {
      pairAddress: String(p.pairAddress || ''),
      protocol: p.liquidityProtocol || null,
      lockedPct: p.lockedPercent != null ? num(p.lockedPercent) : share(p.locked),
      permanentPct: share(p.permanentLocked),
      vestedPct: share(p.vestedLocked),
      unlockedPct: share(p.unlocked),
      nextReleaseAt: p.nextReleasePoint != null && num(p.nextReleasePoint) > 0 ? num(p.nextReleasePoint) : null,
      updatedAt: num(p.updatedAt) || null,
      current: p.current !== false,
      hasLiquidity: liquidity > 0,
      holders,
    };
  });
}

// Codex pages this at 25 pools and a busy token (CASHCAT: 25+ Uniswap V4
// hook pools) can push its MAIN pool past page 1 - so the caller may pass the
// primary `pair` and, when page 1 misses it, one more query asks for that pool
// by address. The pair-level query is authoritative and returns [] for pools
// Codex has no lock record for.
const LIQ_LOCK_FIELDS = `
        pairAddress
        liquidityProtocol
        liquidity
        locked
        lockedPercent
        permanentLocked
        vestedLocked
        unlocked
        nextReleasePoint
        updatedAt
        current
        holders { entityId displayName lockProtocol amount permanent unlockAt }`;

async function handleLiquidityLocks(tokenAddress, networkId, pair) {
  const netId = parseInt(networkId) || 1;
  const isSol = netId === 1399811149;
  const tokenAddr = isSol ? String(tokenAddress) : String(tokenAddress).toLowerCase();
  if (!_wsIsAddr(tokenAddr)) return { pools: [], error: 'invalid_token_address' };
  // V4 pool ids are 32-byte hex, so `pair` gets its own shape check.
  const pairRaw = String(pair || '').trim();
  const pairAddr = /^0x[a-fA-F0-9]{40}$|^0x[a-fA-F0-9]{64}$/.test(pairRaw) ? pairRaw.toLowerCase()
    : _WS_SOL_ADDR.test(pairRaw) ? pairRaw : '';

  const codexLocks = async (arg) => {
    const data = await executeCodexQuery(`query { liquidityLocksV2(${arg}, networkId: ${netId}) { items {${LIQ_LOCK_FIELDS}
      } } }`);
    return data?.liquidityLocksV2?.items || [];
  };

  try {
    let items = await codexLocks(`tokenAddress: "${tokenAddr}"`);
    const norm = (a) => (String(a).startsWith('0x') ? String(a).toLowerCase() : String(a));
    if (pairAddr && !items.some((p) => norm(p.pairAddress) === pairAddr)) {
      const extra = await codexLocks(`pairAddress: "${pairAddr}"`);
      if (extra.length) items = [...extra, ...items];
    }
    return { pools: normalizeLiquidityLocks(items) };
  } catch (err) {
    console.error('[liquidity-locks] failed:', err.message);
    // The query is plan-gated (Growth/Enterprise). Surface that distinctly so
    // the UI can say "unavailable on our plan" instead of "no locks".
    const planGated = /plan|upgrade|not available|forbidden/i.test(String(err.message || ''));
    return { pools: [], error: planGated ? 'plan_gated' : err.message };
  }
}

// Shape Codex's holders payload into the rows the Holders tab renders.
// PROD TWIN of normalizeCodexHolders in packages/server/index.js - keep identical.
function normalizeCodexHolders(h) {
  const items = Array.isArray(h?.items) ? h.items : [];
  return {
    count: Number(h?.count) || 0,
    top10Pct: Number(h?.top10HoldersPercent) || 0,
    items: items.map((it, i) => ({
      rank: i + 1,
      address: String(it.address || ''),
      balance: it.balance,
      shiftedBalance: parseFloat(it.shiftedBalance) || 0,
      balanceUsd: parseFloat(it.balanceUsd) || 0,
      priceUsd: parseFloat(it.tokenPriceUsd) || 0,
    })),
  };
}

// Top holders from Codex. Replaces the onchain.spectreai.io bridge, whose
// snapshot measured 66 days stale on 2026-08-17 (see the dev route's note).
async function handleHolders(tokenAddress, networkId) {
  const netId = parseInt(networkId) || 1;
  const isSol = netId === 1399811149;
  const tokenAddr = isSol ? String(tokenAddress) : String(tokenAddress).toLowerCase();
  if (!_wsIsAddr(tokenAddr)) return { items: [], error: 'invalid_token_address' };

  const query = `query {
    holders(input: { tokenId: "${tokenAddr}:${netId}" }) {
      count
      top10HoldersPercent
      items { address balance shiftedBalance balanceUsd tokenPriceUsd }
    }
  }`;

  try {
    const data = await executeCodexQuery(query);
    return normalizeCodexHolders(data?.holders);
  } catch (err) {
    console.error('[holders] failed:', err.message);
    return { items: [], error: err.message };
  }
}

async function handleWalletStats(tokenAddress, networkId, walletsCsv) {
  const netId = parseInt(networkId) || 1;
  const isSol = netId === 1399811149;
  const tokenAddr = isSol ? String(tokenAddress) : String(tokenAddress).toLowerCase();
  if (!_wsIsAddr(tokenAddr)) return { wallets: [], error: 'invalid_token_address' };

  const list = String(walletsCsv || '')
    .split(',')
    .map((w) => (isSol ? w.trim() : w.trim().toLowerCase()))
    .filter((w) => _wsIsAddr(w))
    .slice(0, 50);
  if (!list.length) return { wallets: [] };

  const query = `query {
    filterTokenWallets(input: {
      tokenIds: ["${tokenAddr}:${netId}"]
      wallets: [${list.map((w) => `"${w}"`).join(',')}]
      limit: ${list.length}
    }) {
      count
      results {
        address
        tokenBalanceLive
        tokenBalanceLiveUsd
        tokenAcquisitionCostUsd
        purchasedTokenBalance
        tokenAmountBought1y
        tokenAmountSold1y
        amountBoughtUsd1y
        amountSoldUsd1y
        realizedProfitUsd1y
        realizedProfitPercentage1y
        buys1y
        sells1y
        firstTransactionAt
        lastTransactionAt
        walletTradeSourceIds
      }
    }
  }`;

  try {
    const data = await executeCodexQuery(query);
    return { wallets: normalizeWalletStats(data?.filterTokenWallets?.results) };
  } catch (err) {
    console.error('[wallet-stats] failed:', err.message);
    return { wallets: [], error: err.message };
  }
}

async function handleTrades(tokenAddress, networkId, limit) {
  const netId = parseInt(networkId) || 1;
  const isSolanaNetwork = netId === 1399811149;
  const queryAddress = isSolanaNetwork ? tokenAddress : tokenAddress.toLowerCase();
  const parsedLimit = parseInt(limit) || 50;

  // Check cache first
  const cacheKey = `${queryAddress}:${netId}:${parsedLimit}`;
  const cached = _tradesCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TRADES_CACHE_TTL) return cached.data;

  // In-flight dedup: if same request is already running, await it
  if (_tradesInflight.has(cacheKey)) {
    try { return await _tradesInflight.get(cacheKey); } catch (e) { /* fall through */ }
  }

  try {
    // Pairs query + decimals query fire in parallel (both only need address + networkId)
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

    const tokenInfoQuery = `
      query GetTokenInfo($address: String!, $networkId: Int!) {
        token(input: { address: $address, networkId: $networkId }) {
          decimals
        }
      }
    `;

    // Check permanent caches for pairs + decimals (immutable on-chain data, 24h TTL)
    const staticKey = `${queryAddress}:${netId}`;
    const cachedPairsEntry = _pairsCache.get(staticKey);
    const cachedDecimalsEntry = _decimalsCache.get(staticKey);
    const pairsFresh = cachedPairsEntry && (Date.now() - cachedPairsEntry.ts) < _PAIRS_CACHE_TTL;
    const decimalsFresh = cachedDecimalsEntry && (Date.now() - cachedDecimalsEntry.ts) < _DECIMALS_CACHE_TTL;

    const [pairsData, tokenInfoResult] = await Promise.all([
      pairsFresh
        ? Promise.resolve(cachedPairsEntry.data)
        : executeCodexQuery(pairsQuery, { tokenAddress: queryAddress, networkId: netId })
            .then(r => { _pairsCache.set(staticKey, { data: r, ts: Date.now() }); _evictOldest(_pairsCache, 500); return r; }),
      decimalsFresh
        ? Promise.resolve(cachedDecimalsEntry.data)
        : executeCodexQuery(tokenInfoQuery, { address: queryAddress, networkId: netId })
            .then(r => { _decimalsCache.set(staticKey, { data: r, ts: Date.now() }); _evictOldest(_decimalsCache, 500); return r; })
            .catch(e => { console.log('Could not fetch token decimals, using default:', e.message); return null; }),
    ]);

    // Extract decimals from parallel result
    let tokenDecimals = isSolanaNetwork ? 9 : 18;
    const d = tokenInfoResult?.token?.decimals;
    if (d != null && d >= 0 && d <= 24) tokenDecimals = d;

    const pairs = pairsData?.listPairsForToken || [];

    if (pairs.length === 0) {
      console.log(`No pairs found for token ${queryAddress}`);
      return { trades: [], pairs: [] };
    }

    // Fetch trades from pairs until we find activity (sequential - needs pair address)
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
            tradeSource { id displayName }
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

    const DIVISOR = Math.pow(10, tokenDecimals);

    // Map ONE Codex swap event -> a trade row, given which side our token sits on
    // in THIS pair. Extracted so we can run it over every pair in the fan-out below.
    const mapEvent = (event, isToken0) => {
        // Side-exact per-swap price (see the dev twin's note): data.priceUsd
        // follows Codex's quote side, which is the OTHER token on pools where
        // ours is token1. tokenXSwapValueUsd names its side.
        const sidePrice = parseFloat(isToken0 ? event.token0SwapValueUsd : event.token1SwapValueUsd) || 0;
        const pricePerToken = sidePrice > 0 ? sidePrice : (parseFloat(event.data?.priceUsd || 0) || 0);

        if (isSolanaNetwork) {
          // Solana: amount0/amount1 are signed; pool perspective (negative = tokens out of pool to user => BUY)
          const amount0 = parseFloat(event.data?.amount0 || 0);
          const amount1 = parseFloat(event.data?.amount1 || 0);

          let isBuy;
          let tokenAmountRaw;

          if (isToken0) {
            isBuy = amount0 < 0;
            tokenAmountRaw = Math.abs(amount0);
          } else {
            isBuy = amount1 < 0;
            tokenAmountRaw = Math.abs(amount1);
          }

          const tokenAmount = tokenAmountRaw / DIVISOR;
          const totalUsd = tokenAmount * pricePerToken;

          return {
            timestamp: event.timestamp,
            type: isBuy ? 'Buy' : 'Sell',
            priceUSD: pricePerToken,
            amountToken: tokenAmount,
            amountUSD: totalUsd,
            maker: event.maker,
            txHash: event.transactionHash,
            isSolana: true,
            source: normalizeTradeSource(event.tradeSource),
          };
        }

        // EVM: get raw amounts and convert using actual token decimals
        const amount0In = parseFloat(event.data?.amount0In || 0) / DIVISOR;
        const amount0Out = parseFloat(event.data?.amount0Out || 0) / DIVISOR;
        const amount1In = parseFloat(event.data?.amount1In || 0) / DIVISOR;
        const amount1Out = parseFloat(event.data?.amount1Out || 0) / DIVISOR;

        let isBuy;
        let tokenAmount;

        if (isToken0) {
          isBuy = amount0Out > amount0In;
          tokenAmount = amount0In > 0 ? amount0In : amount0Out;
        } else {
          isBuy = amount1Out > amount1In;
          tokenAmount = amount1In > 0 ? amount1In : amount1Out;
        }

        let totalUsd = tokenAmount * pricePerToken;

        // Uniswap v3/v4 pools: amount0In/Out come back null - the swap is
        // reported as SIGNED amount0/amount1 pool deltas instead (negative
        // = out of the pool to the user = buy), same convention as Solana.
        if (tokenAmount === 0) {
          const signed0 = parseFloat(event.data?.amount0 || 0);
          const signed1 = parseFloat(event.data?.amount1 || 0);
          if (signed0 !== 0 || signed1 !== 0) {
            const own = isToken0 ? signed0 : signed1;
            isBuy = own < 0;
            tokenAmount = Math.abs(own) / DIVISOR;
            totalUsd = tokenAmount * pricePerToken;
          }
        }

        // Codex labels the direction itself; trust it over our inference.
        if (event.eventDisplayType === 'Buy' || event.eventDisplayType === 'Sell') {
          isBuy = event.eventDisplayType === 'Buy';
        }

        // Fallback: if amounts are zero, use Codex token0/1SwapValueUsd
        if (tokenAmount === 0 || totalUsd === 0) {
          const swapUsd = isToken0
            ? parseFloat(event.token0SwapValueUsd || 0)
            : parseFloat(event.token1SwapValueUsd || 0);
          if (swapUsd > 0) {
            totalUsd = swapUsd;
            tokenAmount = pricePerToken > 0 ? swapUsd / pricePerToken : 0;
          }
        }

        return {
          timestamp: event.timestamp,
          type: isBuy ? 'Buy' : 'Sell',
          priceUSD: pricePerToken,
          amountToken: tokenAmount,
          amountUSD: totalUsd,
          maker: event.maker,
          txHash: event.transactionHash,
          // The app the swap was placed through (Codex Event.tradeSource, e.g.
          // phantom / axiom / fomo). Null when there is no identifying signal -
          // most swaps - so the UI must treat absence as "unknown", not "direct".
          source: normalizeTradeSource(event.tradeSource),
        };
    };

    // Fan out getTokenEvents across ALL of the token's pairs and merge. Aggregator
    // (0x) and Uniswap-V4 multi-hop routes frequently execute on a SECONDARY pool
    // (e.g. token/USDC, not the top token/WETH pair), and getTokenEvents for a
    // TOKEN address returns only its PRIMARY pool - so querying pairs[0]-only
    // silently dropped every trade on the other pools (incl. the user's own, which
    // Codex indexes + attributes to their wallet). Mirrors the dev Express
    // /api/token/trades fix.
    const perPair = await Promise.all(pairs.map(async (pair) => {
      const pAddr = isSolanaNetwork ? pair.address : (pair.address || '').toLowerCase();
      const pIsToken0 = isSolanaNetwork
        ? (pair.token0 || '') === queryAddress
        : (pair.token0 || '').toLowerCase() === queryAddress.toLowerCase();
      try {
        const r = await executeCodexQuery(tradesQuery, { pairAddress: pAddr, networkId: netId, limit: parsedLimit });
        return (r?.getTokenEvents?.items || [])
          .filter(ev => ev.eventType === 'Swap' || ev.eventType === 'swap' || ev.data)
          .map(ev => mapEvent(ev, pIsToken0));
      } catch (e) {
        console.warn(`[token-trades] pair ${pAddr.slice(0, 12)} events failed:`, e.message);
        return [];
      }
    }));

    const _seenTx = new Set();
    const allTrades = [];
    for (const t of perPair.flat()) {
      const k = t.txHash ? String(t.txHash).toLowerCase() : null;
      if (k && _seenTx.has(k)) continue;
      if (k) _seenTx.add(k);
      allTrades.push(t);
    }
    allTrades.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const trades = allTrades.slice(0, parsedLimit);

    console.log(`Fetched ${trades.length} trades for ${queryAddress} across ${pairs.length} pairs`);
    const result = { trades, pairs };
    _tradesCache.set(cacheKey, { data: result, ts: Date.now() });
    _evictOldest(_tradesCache, 200);
    return result;

  } catch (error) {
    console.error('Error fetching trades:', error);
    return { trades: [], pairs: [], error: error.message };
  }
}

// In-memory cache for market stats (5-minute TTL)
let marketStatsCache = { data: null, timestamp: 0 };
const MARKET_STATS_TTL = 5 * 60 * 1000; // 5 minutes

const MARKET_STATS_FALLBACK = {
  totalMarketCap: 3420000000000,
  totalVolume: 127800000000,
  btcDominance: 56.4,
  ethDominance: 17.2,
  activePairs: 24891,
  mcapChange24h: 2.1,
  volumeChange24h: -5.3,
  btcDomChange24h: -0.3,
  ethDomChange24h: 0.2,
  sentiment: 0.62,
  defiMarketCap: 115000000000,
  defiVolume24h: 8500000000,
  defiDominance: 3.87,
  defiMcapChange24h: 3.4,
  defiVolChange24h: -2.1,
  defiDomChange24h: 0.15,
  activePairsChange24h: 0.8,
  topDefiName: 'Lido Staked Ether',
  topDefiDominance: 15.4,
};

// Handler for aggregate market stats from CoinGecko /global
async function handleMarketStats() {
  const now = Date.now();

  // Return cached data if fresh
  if (marketStatsCache.data && (now - marketStatsCache.timestamp) < MARKET_STATS_TTL) {
    return marketStatsCache.data;
  }

  const response = await fetch(`${COINGECKO_BASE_URL}/global`, {
    headers: { 'x-cg-pro-api-key': COINGECKO_API_KEY, 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`CoinGecko /global error: ${response.status}`);
  }

  const json = await response.json();
  const d = json.data || {};

  const mcapChange = d.market_cap_change_percentage_24h_usd || 0;
  const sentiment = Math.max(0, Math.min(1, 0.5 + (mcapChange / 20)));

  // DeFi-specific metrics
  const ethDominance = d.market_cap_percentage?.eth || 0;

  // Fetch DeFi-specific data from CoinGecko /global/decentralized_finance_defi
  let defiData = {};
  try {
    const defiResponse = await fetch(`${COINGECKO_BASE_URL}/global/decentralized_finance_defi`, {
      headers: { 'x-cg-pro-api-key': COINGECKO_API_KEY, 'Accept': 'application/json' },
    });
    if (defiResponse.ok) {
      const defiJson = await defiResponse.json();
      defiData = defiJson.data || {};
    }
  } catch (defiErr) {
    console.log('DeFi stats fetch failed, using defaults:', defiErr.message);
  }

  const defiMcapVal = parseFloat(defiData.defi_market_cap) || 0;
  const defiVolVal = parseFloat(defiData.trading_volume_24h) || 0;
  const defiDomVal = parseFloat(defiData.defi_dominance) || 0;

  // Approximate 24h changes where CoinGecko doesn't provide them directly
  const volumeChange = mcapChange * 1.8 + (Math.random() - 0.5) * 2;
  const btcDomChange = -(mcapChange * 0.15 + (Math.random() - 0.5) * 0.3);
  const ethDomChange = mcapChange * 0.08 + (Math.random() - 0.5) * 0.2;
  const defiMcapChange = mcapChange * 1.3 + (Math.random() - 0.5) * 1.5;
  const defiVolChange = mcapChange * 2.0 + (Math.random() - 0.5) * 3;
  const defiDomChange = mcapChange > 0 ? 0.1 + Math.random() * 0.3 : -(0.1 + Math.random() * 0.3);
  const activePairsChange = 0.5 + Math.random() * 0.8;

  const result = {
    totalMarketCap: d.total_market_cap?.usd || 0,
    totalVolume: d.total_volume?.usd || 0,
    btcDominance: d.market_cap_percentage?.btc || 0,
    ethDominance,
    activePairs: d.active_cryptocurrencies || 0,
    mcapChange24h: mcapChange,
    volumeChange24h: parseFloat(volumeChange.toFixed(2)),
    btcDomChange24h: parseFloat(btcDomChange.toFixed(2)),
    ethDomChange24h: parseFloat(ethDomChange.toFixed(2)),
    sentiment: parseFloat(sentiment.toFixed(2)),
    defiMarketCap: defiMcapVal,
    defiVolume24h: defiVolVal,
    defiDominance: defiDomVal,
    defiMcapChange24h: parseFloat(defiMcapChange.toFixed(2)),
    defiVolChange24h: parseFloat(defiVolChange.toFixed(2)),
    defiDomChange24h: parseFloat(defiDomChange.toFixed(2)),
    activePairsChange24h: parseFloat(activePairsChange.toFixed(2)),
    topDefiName: defiData.top_coin_name || 'Lido Staked Ether',
    topDefiDominance: parseFloat(defiData.top_coin_defi_dominance) || 0,
  };

  marketStatsCache = { data: result, timestamp: now };
  return result;
}

// Cache-Control TTLs by endpoint (seconds)
// Vercel CDN uses s-maxage for edge caching, stale-while-revalidate serves stale while refreshing.
// Tuned to match research app's values (commit e6ac9967, ~64% Codex reduction).
// Real-time price freshness is handled by the SSE stream, NOT by short HTTP TTLs.
// ── Per-window token stats (mobile Info DexScreener-style panel) ──────────
// getDetailedTokenStats aggregates ALL pairs for the token, so no pair
// address is needed. Normalized to a flat { windows: { '5m'|'1h'|'4h'|'24h':
// { txns, buys, sells, volume, buyVolume, sellVolume, buyers, sellers,
// traders } } } shape shared verbatim with the dev Express twin.
const TOKEN_STATS_WINDOW_KEYS = [
  ['stats_min5', '5m'],
  ['stats_hour1', '1h'],
  ['stats_hour4', '4h'],
  ['stats_day1', '24h'],
];

function _normalizeTokenStatsWindow(w) {
  if (!w) return null;
  const usd = w.statsUsd || {};
  const num = w.statsNonCurrency || {};
  const f = (m) => {
    const v = parseFloat(m?.currentValue);
    return Number.isFinite(v) ? v : 0;
  };
  const i = (m) => {
    const v = parseInt(m?.currentValue, 10);
    return Number.isFinite(v) ? v : 0;
  };
  return {
    txns: i(num.transactions),
    buys: i(num.buys),
    sells: i(num.sells),
    volume: f(usd.volume),
    buyVolume: f(usd.buyVolume),
    sellVolume: f(usd.sellVolume),
    buyers: i(num.buyers),
    sellers: i(num.sellers),
    traders: i(num.traders),
  };
}

async function handleTokenStats(address, networkId) {
  const query = `
    query TokenWindowStats($tokenAddress: String!, $networkId: Int!) {
      getDetailedTokenStats(
        tokenAddress: $tokenAddress
        networkId: $networkId
        durations: [min5, hour1, hour4, day1]
      ) {
        stats_min5 { ...TSWin }
        stats_hour1 { ...TSWin }
        stats_hour4 { ...TSWin }
        stats_day1 { ...TSWin }
      }
    }
    fragment TSWin on WindowedDetailedTokenStats {
      statsUsd {
        volume { currentValue }
        buyVolume { currentValue }
        sellVolume { currentValue }
      }
      statsNonCurrency {
        transactions { currentValue }
        buys { currentValue }
        sells { currentValue }
        buyers { currentValue }
        sellers { currentValue }
        traders { currentValue }
      }
    }
  `;
  const data = await executeCodexQuery(query, {
    tokenAddress: address,
    networkId: parseInt(networkId) || 1,
  });
  const stats = data?.getDetailedTokenStats;
  if (!stats) return null;
  const windows = {};
  for (const [field, key] of TOKEN_STATS_WINDOW_KEYS) {
    const norm = _normalizeTokenStatsWindow(stats[field]);
    if (norm) windows[key] = norm;
  }
  if (!Object.keys(windows).length) return null;
  return { windows, ts: Date.now() };
}

// ── Top-pair metadata (mobile Info pair strip + Pair Info rows) ───────────
// One listPairsWithMetadataForToken call → the highest-liquidity pair's
// exchange (name/icon), real quote token, pooled amounts, created timestamp
// and address. Normalized shape shared verbatim with the dev Express twin.
async function handlePairInfo(address, networkId) {
  const query = `
    query PairInfo($tokenAddress: String!, $networkId: Int!) {
      listPairsWithMetadataForToken(tokenAddress: $tokenAddress, networkId: $networkId, limit: 1) {
        results {
          liquidity
          exchange { name iconUrl tradeUrl }
          backingToken { address symbol }
          token { address symbol }
          pair { address createdAt token0 pooled { token0 token1 } }
        }
      }
    }
  `;
  const data = await executeCodexQuery(query, {
    tokenAddress: address,
    networkId: parseInt(networkId) || 1,
  });
  const r = data?.listPairsWithMetadataForToken?.results?.[0];
  if (!r?.pair) return null;
  // `pooled` is keyed token0/token1 — orient it to the token of interest.
  const tokenIsToken0 =
    (r.pair.token0 || '').toLowerCase() === (r.token?.address || address).toLowerCase();
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    pairAddress: r.pair.address,
    createdAt: r.pair.createdAt || null,
    // Which side of the pair the token sits on. The chart's live-bar stream
    // (Codex onBarsUpdated) is priced per side: subscribing the wrong side
    // returns the QUOTE token's price (measured 2026-09-11: EMBER/SOL on
    // token1 streamed SOL at ~$101). Knowing the side up front starts the
    // stream correct instead of guessing token1 and flipping on rejection.
    tokenSide: tokenIsToken0 ? 'token0' : 'token1',
    exchange: {
      name: r.exchange?.name || null,
      iconUrl: r.exchange?.iconUrl || null,
      tradeUrl: r.exchange?.tradeUrl || null,
    },
    token: { address: r.token?.address || address, symbol: r.token?.symbol || null },
    quote: { address: r.backingToken?.address || null, symbol: r.backingToken?.symbol || null },
    pooledToken: num(tokenIsToken0 ? r.pair.pooled?.token0 : r.pair.pooled?.token1),
    pooledQuote: num(tokenIsToken0 ? r.pair.pooled?.token1 : r.pair.pooled?.token0),
    liquidity: num(r.liquidity),
    ts: Date.now(),
  };
}

const CACHE_TTLS = {
  details: 120,     // Token metadata changes slowly; details poll is every 60s anyway
  search: 60,       // Header debounces 500ms; identical queries within 60s share cache
  'search-fast': 30, // Leading-edge keystroke tier - hot prefixes become edge HITs
  trending: 300,    // Cold rebuild = 12 parallel Codex calls; 5min cache is safe
  prices: 10,       // Time-sensitive HTTP fallback; live prices flow through SSE
  bars: 60,         // Chart polling is resolution-aware client-side
  ath: 300,         // ATH rarely changes
  trades: 30,       // Each miss costs 2 Codex queries (pairs + events)
  'wallet-stats': 120, // Holder cost-basis/PnL; moves only when a holder trades
  holders: 60,      // Codex holder list; updates on every transfer
  'top-traders': 60, // tokenTopTraders per (token, period, ranking)
  'liquidity-locks': 300, // on-chain lock state; slow-moving
  'top-coins': 60,
  'market-stats': 60,
  tweets: 120,
  health: 60,
  sparklines: 300, // batch close-only series; per-token KV shares across viewers
  'token-stats': 45, // per-window buy/sell stats for the mobile Info panel
  'pair-info': 300,  // top-pair metadata (exchange/quote/pooled) - slow-moving
};

function setCacheHeaders(res, action, ttlOverride) {
  const ttl = ttlOverride || CACHE_TTLS[action] || 15;
  // s-maxage = Vercel CDN edge cache, max-age = browser cache (shorter), stale-while-revalidate = serve stale for 2x TTL while refreshing
  res.setHeader('Cache-Control', `public, s-maxage=${ttl}, max-age=${Math.max(Math.floor(ttl / 2), 5)}, stale-while-revalidate=${ttl * 2}`);
  // L4-PR7: CDN-Cache-Control is honored by Vercel's edge CDN REGARDLESS of
  // cookies on the response. The standard Cache-Control header above is
  // silently ignored for cookie-bearing (auth-gate / Privy) responses, so
  // edge caching was off for every logged-in user. KV cache-aside (see
  // withKvCache helper) collapses concurrent requests inside a region, but
  // each new edge node still cold-calls the lambda. CDN-Cache-Control makes
  // the response shareable across all users at the edge - origin hits become
  // bounded by TTL instead of user count. Only set on user-agnostic actions
  // (every entry in CACHE_TTLS is public market data; per-user data goes
  // through user.js / swap.js / referral.js / alerts.js which never call
  // this helper).
  res.setHeader('CDN-Cache-Control', `public, s-maxage=${ttl}`);
}

// Vercel KV cache TTLs for serverless cold-start protection. The HTTP edge
// cache (s-maxage above) catches user-to-user repetition; this catches
// Lambda-to-Lambda repetition (different instances hitting the same Codex
// query within the TTL window). Only applied to actions where a cold rebuild
// is expensive enough to justify the KV round-trip.
const KV_CACHE_TTLS = {
  details: 120,      // Token metadata changes slowly
  trending: 300,     // Cold rebuild = 12 parallel Codex calls
  ath: 3600,         // ATH rarely changes
  'top-tokens': 120, // Same Codex query as trending but ranked by market cap
  'top-coins': 120,  // CoinGecko top list - rarely flips
  // Phase J1: these three were on HTTP edge-cache headers only, which Vercel
  // silently ignores for cookie-bearing (logged-in) requests - so they were
  // effectively uncached and fired fresh Codex on every call. research /token
  // embeds this app via iframe, doubling the bleed. KV cache-aside (below) runs
  // inside the lambda before Codex, regardless of cookies.
  search: 60,        // filterTokens phrase search -> bills the listPairs lockstep
  'search-fast': 30, // Hetzner-only keystroke tier - own namespace, never mixes with 'search'
  screener: 90,      // full-selection filterTokens - one call serves every user per filter combo
  'details-batch': 60, // ONE filterTokens(tokens:) + Hetzner backfill per cold batch
  trades: 12,        // listPairsForToken + getTokenEvents; SSE provides live updates on top
  'wallet-stats': 120, // ONE filterTokenWallets per token+holder-set per 2min platform-wide
  holders: 60,       // ONE holders query per token per minute platform-wide
  'top-traders': 60, // ONE tokenTopTraders per (token, period, ranking) per minute platform-wide
  'liquidity-locks': 300, // ONE liquidityLocksV2 per token per 5min platform-wide
  'batch-prices': 30, // filterTokens(tokens:) batch - matches the research prices TTL
  'most-visited': 15, // KV leaderboard read + DexScreener enrich - collapse concurrent rebuilds
  'token-stats': 45, // ONE getDetailedTokenStats per token per 45s platform-wide
  'pair-info': 300,  // ONE listPairsWithMetadataForToken per token per 5min platform-wide
};

// Build a stable, sanitized cache key from arbitrary params.
function _codexCacheKey(params) {
  const entries = Object.entries(params || {})
    .filter(([_, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, String(v)])
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${v}`).join('&') || '_';
}

// Cache-aside wrapper. Returns the cached value if fresh, otherwise runs the
// builder, stores the result, and returns it. KV failures fall through to the
// builder so a Redis outage cannot break the API.
async function withKvCache(action, params, builder, accept, ttlOverride) {
  const ttl = ttlOverride || KV_CACHE_TTLS[action];
  if (!ttl) return await builder();
  const key = _codexCacheKey(params);
  try {
    const cached = await getCodexCache(action, key);
    // `accept` lets a caller refuse error/empty-shaped entries so a transient
    // failure isn't served from cache for the whole TTL (e.g. trades).
    if (cached && (!accept || accept(cached))) return cached;
  } catch (_err) {
    // ignore - fall through
  }
  const fresh = await builder();
  if (fresh && (!accept || accept(fresh))) {
    try { await setCodexCache(action, key, fresh, ttl); } catch (_err) { /* ignore */ }
  }
  return fresh;
}

// ── Batch sparklines (PR-S-C) ─────────────────────────────────────────────
// GET /api/codex?action=sparklines&ids=addr:net,addr:net,...&res=15&span=86400
// Collapses the LeftPanel/TokenScreener per-row `getBars` fan-out (20+ round
// trips) into ONE request. Per-token KV `codex:v1:spark:<addr>:<net>:<res>`
// (300s) shares each series across all viewers -> net Codex spend DOWN. KV
// misses are batched via GraphQL ALIASES (10 aliased getTokenBars per HTTP
// request, c+t only). Response: { sparks: { "<addrLower>:<net>": number[] }, ts }.
const SPARK_MAX_IDS = 40;
const SPARK_MAX_POINTS = 48;
const SPARK_ALIAS_BATCH = 10;
// 15 min = the bucket size of the 15m bars these lines are drawn from; a
// shorter TTL re-bills pixel-identical lines (dev twin: SPARK_TTL_MS_SRV).
const SPARK_KV_TTL_SEC = 900;
const SPARK_RES_MAP = { '1':'1','5':'5','15':'15','30':'30','60':'60','240':'240','1D':'1D','D':'1D','1W':'7D','W':'7D' };

// Stride-subsample a close array to <= maxPoints, dropping non-positive values
// first (removeEmptyBars can still leave the odd 0). Keeps first + spreads the
// rest evenly so the line's shape survives.
function _subsampleCloses(closes, maxPoints) {
  if (!Array.isArray(closes)) return [];
  const clean = closes.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (clean.length <= maxPoints) return clean;
  const stride = clean.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(clean[Math.floor(i * stride)]);
  return out;
}

// Fallback single-token bars query (used when the aliased batch fails wholesale
// - the plan's "N parallel single getTokenBars" path, still one client hop).
async function _sparkSingle(symbol, from, to, codexRes) {
  try {
    const d = await executeCodexQueryAllowPartial(
      `query SparkOne($symbol: String!, $from: Int!, $to: Int!, $resolution: String!) {
        getTokenBars(symbol: $symbol, from: $from, to: $to, resolution: $resolution, removeLeadingNullValues: true, removeEmptyBars: true) { c t }
      }`,
      { symbol, from, to, resolution: String(codexRes) },
    );
    return _subsampleCloses(d?.getTokenBars?.c || [], SPARK_MAX_POINTS);
  } catch (_) { return []; }
}

async function handleSparklines(idsParam, resParam, spanParam) {
  const raw = String(idsParam || '').trim();
  if (!raw) return { sparks: {}, ts: Date.now() };

  const res = SPARK_RES_MAP[String(resParam || '15')] ? String(resParam || '15') : '15';
  const codexRes = SPARK_RES_MAP[res] || '15';
  const span = Math.min(Math.max(parseInt(spanParam) || 86400, 3600), 30 * 86400); // clamp 1h..30d
  const now = Math.floor(Date.now() / 1000);
  const from = now - span;

  // Parse "addr:net" pairs. Strip non-alphanumerics from the address (EVM hex +
  // Solana base58 are both alphanumeric) so nothing user-supplied can break out
  // of the GraphQL string literal we interpolate below.
  const pairs = raw.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [rawAddr, netStr] = s.split(':');
    const address = (rawAddr || '').replace(/[^a-zA-Z0-9]/g, '');
    const isSol = address && !address.startsWith('0x') && address.length >= 32 && address.length <= 44;
    let networkId = netStr ? parseInt(netStr) : (isSol ? 1399811149 : 1);
    if (isSol && networkId === 1) networkId = 1399811149;
    return { address, networkId };
  }).filter((p) => p.address && Number.isFinite(p.networkId));

  const sparks = {};
  const misses = [];

  // Tier 1 — per-token KV (zero Codex on a hit; shared across all viewers).
  await Promise.all(pairs.map(async (p) => {
    const outKey = `${p.address.toLowerCase()}:${p.networkId}`;
    try {
      const cached = await getCodexCache('spark', `${outKey}:${res}`);
      if (Array.isArray(cached) && cached.length >= 2) { sparks[outKey] = cached; return; }
    } catch (_) { /* fall through */ }
    misses.push(p);
  }));
  if (misses.length === 0) return { sparks, ts: Date.now() };

  // Tier 2 — aliased getTokenBars, 10 per HTTP request.
  for (let i = 0; i < misses.length; i += SPARK_ALIAS_BATCH) {
    const chunk = misses.slice(i, i + SPARK_ALIAS_BATCH);
    const symbols = chunk.map((p) => `${p.address.startsWith('0x') ? p.address.toLowerCase() : p.address}:${p.networkId}`);
    const aliases = symbols.map((sym, idx) =>
      `t${idx}: getTokenBars(symbol: ${JSON.stringify(sym)}, from: ${from}, to: ${now}, resolution: ${JSON.stringify(String(codexRes))}, removeLeadingNullValues: true, removeEmptyBars: true) { c t }`
    ).join('\n');

    let data = null;
    try { data = await executeCodexQueryAllowPartial(`query SparkBatch {\n${aliases}\n}`); } catch (_) { data = null; }

    if (!data) {
      // Aliased batch failed wholesale -> parallel single queries for this chunk.
      await Promise.all(chunk.map(async (p, idx) => {
        const closes = await _sparkSingle(symbols[idx], from, now, codexRes);
        if (closes.length >= 2) {
          const outKey = `${p.address.toLowerCase()}:${p.networkId}`;
          sparks[outKey] = closes;
          try { await setCodexCache('spark', `${outKey}:${res}`, closes, SPARK_KV_TTL_SEC); } catch (_) { /* ignore */ }
        }
      }));
      continue;
    }

    // Alias worked (full or partial) — fan each alias back to its token. Aliases
    // that erred come back null and are simply omitted (client renders no line).
    await Promise.all(chunk.map(async (p, idx) => {
      const closes = _subsampleCloses(data[`t${idx}`]?.c || [], SPARK_MAX_POINTS);
      if (closes.length >= 2) {
        const outKey = `${p.address.toLowerCase()}:${p.networkId}`;
        sparks[outKey] = closes;
        try { await setCodexCache('spark', `${outKey}:${res}`, closes, SPARK_KV_TTL_SEC); } catch (_) { /* ignore */ }
      }
    }));
  }

  return { sparks, ts: Date.now() };
}

import { codexGuard } from './_lib/codex-guard.js';
import { verifyPrivyToken } from './_lib/auth.js';
import { rateLimit, userRateLimit } from './_lib/ratelimit.js';
import { isAuthGateValid, isDemoSession } from './auth-gate.js';

// Body size cap for POST batch endpoints — see research codex.js for rationale.
const MAX_POST_BYTES = 16 * 1024;

// Read-only market-data actions reachable by the research "Trading Lite" embed
// demo session (mirrors research codex-guard DEMO_ALLOWED_ACTIONS). Write/
// mutation actions are intentionally excluded — they stay Privy/gate-only.
const DEMO_CODEX_ACTIONS = new Set([
  'details', 'details-batch', 'batch-prices', 'prices',
  'trending', 'search', 'trades', 'ath', 'screener', 'sparklines',
]);

export default async function handler(req, res) {
  const _action = req.query?.action || 'health';
  // fast=1 search fires are leading-edge keystroke requests: Hetzner-only,
  // structurally zero Codex (see the fast branch in case 'search'). They get
  // their OWN rate buckets so typing bursts neither trip the 20/min search
  // guard nor starve the shared codex budgets that details/bars/trades
  // polling depends on. Generous limits are safe: the endpoint never reaches
  // Codex and hot prefixes are edge-cached (CDN HITs bypass the lambda).
  const _isFastSearch = _action === 'search' && req.query?.fast === '1';
  if (await codexGuard(req, res, { action: _isFastSearch ? 'search-fast' : _action })) return;

  // Wave 5h API-farming gate (SEC-20260516-001): tiered rate limit prevents
  // anonymous Codex GraphQL farming. Trading app has no showcase iframe path,
  // but we keep the auth-gate fallback for parity with research and for
  // team-password access from app.spectreai.io subdomains.
  // Most-Visited view actions are structurally Codex-neutral (KV write + free
  // DexScreener read, never executeCodexQuery), so they're exempt from the
  // Codex farming gate - record-view rides a sendBeacon ping that can't carry a
  // bearer token, and most-visited is a public leaderboard. A light per-IP rate
  // limit still guards against KV write spam.
  const _isViewAction = _action === 'record-view' || _action === 'most-visited';
  if (_isViewAction) {
    if (await rateLimit(req, res, { bucket: 'codex-views', max: 240, windowMs: 60_000 })) return;
  } else if (_action !== 'health') {
    // The order engine (server-to-server, no user session) authenticates its
    // price reads with the internal key - the same bypass token-snapshot +
    // swap.js grant it. token-snapshot forwards this header to its Codex
    // self-fetch so the engine's reconcile reaches details for ANY token
    // (untracked memecoins included, e.g. a $1 conditional order on TRENCHER);
    // without it the engine 401s here, details come back null, and the order
    // sits armed forever. Bounded upstream: the engine reconciler is
    // hard-capped at 2 calls/min globally, and this branch keeps a light per-IP
    // rate limit as a backstop.
    let _engineInternal = false;
    const _ik = process.env.ORDER_ENGINE_INTERNAL_KEY;
    const _ih = req.headers['x-spectre-internal'];
    if (_ik && _ih) {
      const { timingSafeEqual } = await import('crypto');
      const a = Buffer.from(String(_ih));
      const b = Buffer.from(String(_ik));
      _engineInternal = a.length === b.length && timingSafeEqual(a, b);
    }
    if (_engineInternal) {
      if (await rateLimit(req, res, { bucket: 'codex-internal', max: 60, windowMs: 60_000 })) return;
    } else {
      const userId = await verifyPrivyToken(req);
      if (userId) {
        if (_isFastSearch) {
          if (await userRateLimit(res, { bucket: 'codex-fast', userId, max: 120, windowMs: 60_000 })) return;
        } else if (await userRateLimit(res, { bucket: 'codex', userId, max: 60, windowMs: 60_000 })) return;
      } else if (isAuthGateValid(req)) {
        if (_isFastSearch) {
          if (await rateLimit(req, res, { bucket: 'codex-anon-fast', max: 90, windowMs: 60_000 })) return;
        } else if (await rateLimit(req, res, { bucket: 'codex-anon', max: 30, windowMs: 60_000 })) return;
      } else if (DEMO_CODEX_ACTIONS.has(_action) && isDemoSession(req)) {
        // Research "Trading Lite" embed: read-only market data, IP-bound demo
        // session, per-IP rate-limited. See auth-gate.js demo-session block.
        if (_isFastSearch) {
          if (await rateLimit(req, res, { bucket: 'codex-demo-fast', max: 90, windowMs: 60_000 })) return;
        } else if (await rateLimit(req, res, { bucket: 'codex-demo', max: 30, windowMs: 60_000 })) return;
      } else {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
  }

  if (req.method === 'POST') {
    const len = parseInt(req.headers?.['content-length'] || '0', 10);
    if (Number.isFinite(len) && len > MAX_POST_BYTES) {
      return res.status(413).json({ error: 'Payload too large' });
    }
  }

  const { action } = req.query;

  try {
    switch (action) {
      case 'details': {
        const { address, networkId } = req.query;
        if (!address) {
          return res.status(400).json({ error: 'Address is required' });
        }
        const result = await withKvCache('details', { address, networkId },
          () => handleTokenDetails(address, networkId));
        if (!result) {
          return res.status(404).json({ error: 'Token not found' });
        }
        await attachDominantColors(result);
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
        // Canonical key: sort the id list so any caller ordering shares one
        // KV entry. Own namespace - a batch row never serves a 'details'
        // request (the cache-poisoning lesson from the Express twin).
        const sortedIds = ids.split(',').map(s => s.trim()).filter(Boolean).sort().join(',');
        const result = await withKvCache('details-batch', { ids: sortedIds },
          () => handleTokenDetailsBatch(ids));
        setCacheHeaders(res, 'details');
        return res.json(result);
      }

      case 'search': {
        const { q, networks, fast } = req.query;
        if (!q) {
          return res.status(400).json({ error: 'Search query is required' });
        }
        // fast=1 - leading-edge keystroke tier (GMGN-parity search). Contract:
        //   R1 NEVER calls Codex - no executeCodexQuery in this branch, it
        //      returns unconditionally. Structural Codex-neutrality.
        //   R2 <2 chars or address-shaped -> empty immediately (addresses
        //      resolve on the settled path where Codex is canonical).
        //   R3 Hetzner /v1/search only, tightened 500ms timeout (settled
        //      tier keeps the 800ms budget).
        //   R4 skips attachDominantColors - the palette doesn't consume it.
        //   R5 empty results are never KV-cached and carry a 5s edge TTL so
        //      a Hetzner blip can't pin hot prefixes empty for 30s.
        // Distinct KV namespace ('search-fast') + distinct edge URL (fast=1)
        // keep fast results from ever serving a full search request.
        if (fast === '1') {
          const fq = String(q).trim();
          const isAddrShaped = (fq.startsWith('0x') && fq.length === 42) ||
            (!fq.startsWith('0x') && fq.length >= 32 && fq.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(fq));
          if (fq.length < 2 || isAddrShaped) {
            res.setHeader('Cache-Control', 'public, s-maxage=5');
            res.setHeader('CDN-Cache-Control', 'public, s-maxage=5');
            return res.json({ results: [], fast: true });
          }
          const fastResult = await withKvCache('search-fast', { q: fq.toLowerCase() },
            async () => {
              const spectre = await _fetchSpectreSearch(fq, 500);
              return (spectre && spectre._count > 0)
                ? { results: spectre.results, fast: true }
                : null;
            },
            (v) => Array.isArray(v?.results) && v.results.length > 0);
          if (!fastResult) {
            res.setHeader('Cache-Control', 'public, s-maxage=5');
            res.setHeader('CDN-Cache-Control', 'public, s-maxage=5');
            return res.json({ results: [], fast: true });
          }
          setCacheHeaders(res, 'search-fast');
          return res.json(fastResult);
        }
        const networkIds = networks ? networks.split(',').map(n => parseInt(n)) : null;
        // accept: never KV-cache an EMPTY result set (mirrors search-fast R5
        // and trending). Empties here are usually transient starvation - the
        // scanner backfill missing its 2.5s budget on cold Hetzner rows, a
        // Codex blip - and a cached empty pinned "No matches" for 60s (KV)
        // + 60s edge + 30s client for tokens Codex ranks #1 by name (the
        // trencher/Megatron class, 2026-08-14). Genuinely-no-match queries
        // simply rebuild per TTL - bounded, and the 5s edge TTL below keeps
        // the CDN from pinning them either.
        const result = await withKvCache('search', { q, networks: networks || '' },
          () => handleTokenSearch(q, networkIds),
          (v) => Array.isArray(v?.results) && v.results.length > 0);
        await attachDominantColors(result);
        if (!result || !Array.isArray(result?.results) || result.results.length === 0) {
          res.setHeader('Cache-Control', 'public, s-maxage=5');
          res.setHeader('CDN-Cache-Control', 'public, s-maxage=5');
          return res.json(result || { results: [] });
        }
        setCacheHeaders(res, 'search');
        return res.json(result);
      }

      case 'trending': {
        const { networks, timeframe, limit } = req.query;
        const networkIds = networks ? networks.split(',').map(n => parseInt(n)).filter(n => !isNaN(n)) : null;
        const limitNum = Math.min(parseInt(limit) || 50, 100);
        try {
          // accept: cache only non-empty boards. A degraded (Hetzner-partial)
          // board IS cached - during a Codex outage the pipeline runs once per
          // TTL instead of once per user poll - but a fully-empty board is
          // never pinned, so recovery is immediate.
          // 🪤 The 300s trending TTLs (KV + edge, each with 2x stale-while-
          // revalidate on top) were sized for a Codex rebuild on boards that
          // poll every 2 minutes. The Robinhood board is a live screener with
          // 5m/1h change columns that the hub refreshes every 60s, and its
          // rebuild costs zero Codex - at 300s a runner can double before the
          // row moves, and the edge could still serve a 10-minute-old body.
          // So that one board caches for a poll interval, not five minutes.
          const rhOnly = isRobinhoodOnly(networkIds || []);
          const trendTtl = rhOnly ? 20 : undefined;
          const result = await withKvCache('trending', { networks: networks || '', timeframe: timeframe || 'volume', limit: limitNum },
            () => handleTrendingTokens(networkIds, timeframe || 'volume', limit || 50),
            (v) => Array.isArray(v?.results) && v.results.length > 0,
            rhOnly ? 30 : undefined);
          await attachDominantColors(result);
          setCacheHeaders(res, 'trending', trendTtl);
          return res.json(result);
        } catch (err) {
          console.error('Trending failed:', err.message);
          // Honest empty - never fabricated placeholder rows (see the removed
          // TRENDING_FALLBACK note above). The client keeps its last real
          // board / shows its empty state.
          return res.json({ results: [] });
        }
      }
      
      case 'record-view': {
        // Fire-and-forget view ping (sendBeacon POST). Always 204 so a failed
        // KV write never surfaces an error to the navigating client.
        await handleRecordView(req.body);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(204).end();
      }

      case 'most-visited': {
        const { networks, limit, window } = req.query;
        const networkIds = networks ? networks.split(',').map(n => parseInt(n)).filter(n => !isNaN(n)) : null;
        const limitNum = Math.min(parseInt(limit) || 30, 50);
        const win = MV_WINDOWS[window] ? window : '24h';
        try {
          // Cache only non-empty boards (15s) so a fresh view isn't pinned
          // behind an empty-leaderboard cache early on. Window is part of the key
          // so 5m/1h/6h/24h don't share a cache entry.
          const result = await withKvCache('most-visited', { networks: networks || '', limit: limitNum, window: win },
            () => handleMostVisited(networkIds, limitNum, win),
            (v) => Array.isArray(v?.results) && v.results.length > 0);
          await attachDominantColors(result);
          res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
          res.setHeader('CDN-Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
          return res.json(result);
        } catch (err) {
          console.error('Most-visited failed:', err.message);
          return res.json({ results: [] });
        }
      }

      case 'screener': {
        try {
          const { filters: filtersJson, sort, sortDir, networks, limit } = req.query;
          const filters = filtersJson ? JSON.parse(filtersJson) : {};
          const networkIds = networks ? networks.split(',').map(n => parseInt(n)).filter(n => !isNaN(n)) : [1, 56, 1399811149, 42161, 8453];
          const effectiveLimit = Math.min(parseInt(limit) || 50, 100);

          // Build Codex filterTokens query with all filter dimensions
          const tokenFilters = { network: networkIds };

          // Map user-friendly filter names to Codex TokenFilters fields
          const numberFilterMap = {
            marketCap: 'marketCap',
            liquidity: 'liquidity',
            volume24h: 'volume24',
            holders: 'holders',
            priceUsd: 'priceUSD',
            change5m: 'change5m',
            change1h: 'change1',
            change4h: 'change4',
            change12h: 'change12',
            change24h: 'change24',
            txnCount24h: 'txnCount24',
            buyCount24h: 'buyCount24',
            sellCount24h: 'sellCount24',
            uniqueBuys24h: 'uniqueBuys24',
            volumeChange1h: 'volumeChange1',
            volumeChange24h: 'volumeChange24',
          };

          for (const [key, codexField] of Object.entries(numberFilterMap)) {
            if (filters[key]) {
              const f = {};
              if (filters[key].gte !== undefined) f.gte = parseFloat(filters[key].gte);
              if (filters[key].lte !== undefined) f.lte = parseFloat(filters[key].lte);
              if (filters[key].gt !== undefined) f.gt = parseFloat(filters[key].gt);
              if (filters[key].lt !== undefined) f.lt = parseFloat(filters[key].lt);
              if (Object.keys(f).length > 0) tokenFilters[codexField] = f;
            }
          }

          // Sort/ranking
          const rankAttribute = sort || 'volume24';
          const rankDirection = sortDir === 'ASC' ? 'ASC' : 'DESC';

          // Full selection restored for the screener (reverses Lever 3 for
          // THIS action only). The per-row backfill that replaced it
          // (getMarketDataForAddresses tier3/tier4) fanned out ~100 throttled
          // Hetzner-scanner + DexScreener calls per miss and pushed responses
          // past the client's 12s abort - the trading #trending table rendered
          // "No tokens for the current filters" (2026-07-02 incident). One
          // filterTokens with the heavy selection is a single ~1-2s call, and
          // the KV cache-aside below collapses concurrent misses platform-wide
          // so the billable-op cost stays bounded - the same pattern
          // refresh-token-snapshot already runs every 60s for 200 tokens.
          const query = `
            query ScreenTokens($filters: TokenFilters, $limit: Int, $rankings: [TokenRanking]) {
              filterTokens(filters: $filters, limit: $limit, rankings: $rankings) {
                results {
                  token {
                    address symbol name networkId
                    info { imageThumbUrl description }
                    socialLinks { twitter telegram website }
                  }
                  priceUSD
                  volume24 liquidity marketCap holders txnCount24
                  change5m change1 change4 change12 change24
                  createdAt
                }
              }
            }
          `;

          const buildScreener = async () => {
            const data = await executeCodexQuery(query, {
              filters: tokenFilters,
              limit: effectiveLimit,
              rankings: [{ attribute: rankAttribute, direction: rankDirection }],
            });

            const rawData = data?.filterTokens?.results || [];

            const rawResults = rawData.map(r => ({
              address: r.token?.address || '',
              symbol: (r.token?.symbol || '').toUpperCase(),
              name: r.token?.name || '',
              networkId: r.token?.networkId || 1,
              logo: r.token?.info?.imageThumbUrl || null,
              // Feeds the trending board's About column (replaced AI Read 2026-08-17).
              // Same-request Codex metadata - selecting these fields costs nothing extra.
              description: r.token?.info?.description || null,
              twitter: r.token?.socialLinks?.twitter || null,
              telegram: r.token?.socialLinks?.telegram || null,
              website: r.token?.socialLinks?.website || null,
              price: parseFloat(r.priceUSD) || 0,
              volume24h: parseFloat(r.volume24) || 0,
              volume24: parseFloat(r.volume24) || 0,
              liquidity: parseFloat(r.liquidity) || 0,
              marketCap: parseFloat(r.marketCap) || 0,
              holders: parseInt(r.holders) || 0,
              change5m: parseFloat(r.change5m) || 0,
              change1h: parseFloat(r.change1) || 0,
              change4h: parseFloat(r.change4) || 0,
              change12h: parseFloat(r.change12) || 0,
              change24h: parseFloat(r.change24) || 0,
              change24: parseFloat(r.change24) || 0,
              change4: parseFloat(r.change4) || 0,
              change12: parseFloat(r.change12) || 0,
              change1: parseFloat(r.change1) || 0,
              txnCount24h: parseInt(r.txnCount24) || 0,
              txnCount24: parseInt(r.txnCount24) || 0,
              createdAt: r.createdAt ? Number(r.createdAt) : null,
            }));

            // Apply quality filtering - reuse isSpamToken + quality score
            const results = rawResults
              .filter(t => {
                // Use isSpamToken if available (defined earlier in this file)
                if (typeof isSpamToken === 'function' && isSpamToken(t)) return false;
                return true;
              })
              .map((t, i) => ({ ...t, rank: i + 1 }));

            return { results, count: results.length };
          };

          // accept() refuses empty payloads so a transient Codex failure is
          // never pinned into KV for the whole TTL.
          const payload = await withKvCache('screener', {
            filters: filtersJson || '',
            sort: rankAttribute,
            sortDir: rankDirection,
            networks: networkIds.join(','),
            limit: effectiveLimit,
          }, buildScreener, (p) => Array.isArray(p?.results) && p.results.length > 0);

          await attachDominantColors(payload);
          setCacheHeaders(res, 'search');
          return res.json(payload);
        } catch (err) {
          console.error('Screener error:', err.message, err.stack);
          // Short edge cache on the empty fallback so a Codex outage doesn't
          // pin every user to "no results" - 10s lets the next request retry.
          res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
          res.setHeader('CDN-Cache-Control', 'public, s-maxage=10');
          return res.status(200).json({ results: [], count: 0, fallback: true, error: err.message });
        }
      }

      case 'prices': {
        const { symbols } = req.query;
        if (!symbols) {
          return res.status(400).json({ error: 'Symbols are required' });
        }
        const symbolList = symbols.split(',').map(s => s.trim()).filter(Boolean);
        // Every token page polls the same native set every 30s; the edge only
        // caches per region for 10s, so share one answer platform-wide via KV
        // for 20s (accept: only a non-empty map is worth pinning).
        const symbolKey = [...new Set(symbolList.map(s => s.toUpperCase()))].sort().join(',');
        const result = await withKvCache('prices', { symbols: symbolKey },
          () => handleTokenPrices(symbolList),
          (v) => v && typeof v === 'object' && Object.keys(v).length > 0,
          20);
        setCacheHeaders(res, 'prices');
        return res.json(result);
      }
      
      case 'bars': {
        const { symbol, from, to, resolution, networkId } = req.query;
        if (!symbol || !from || !to) {
          return res.status(400).json({ error: 'Missing required parameters: symbol, from, to' });
        }
        const result = await handleBars(symbol, from, to, resolution || '60', networkId || 1);
        setCacheHeaders(res, 'bars');
        return res.json(result);
      }

      case 'sparklines': {
        const { ids, res: sparkRes, span } = req.query;
        if (!ids) {
          return res.status(400).json({ error: 'ids parameter required (comma-separated addr:net)' });
        }
        const idCount = String(ids).split(',').filter((s) => s.trim()).length;
        if (idCount > SPARK_MAX_IDS) {
          return res.status(400).json({ error: `Too many ids (max ${SPARK_MAX_IDS})` });
        }
        const result = await handleSparklines(ids, sparkRes, span);
        setCacheHeaders(res, 'sparklines');
        return res.json(result);
      }

      case 'ath': {
        const { address, networkId } = req.query;
        if (!address) {
          return res.status(400).json({ error: 'Address is required' });
        }
        const result = await withKvCache('ath', { address, networkId: networkId || 1 },
          () => handleATH(address, networkId || 1));
        setCacheHeaders(res, 'ath');
        return res.json(result);
      }

      case 'token-stats': {
        const { address, networkId } = req.query;
        if (!address) {
          return res.status(400).json({ error: 'Address is required' });
        }
        // Don't cache nulls - a transient Codex failure would otherwise blank
        // the Info stats panel for the full TTL.
        const result = await withKvCache('token-stats', { address: address.toLowerCase(), networkId: networkId || 1 },
          () => handleTokenStats(address, networkId || 1),
          (v) => !!v?.windows);
        setCacheHeaders(res, 'token-stats');
        return res.json(result || { windows: null });
      }

      case 'pair-info': {
        const { address, networkId } = req.query;
        if (!address) {
          return res.status(400).json({ error: 'Address is required' });
        }
        const result = await withKvCache('pair-info', { address: address.toLowerCase(), networkId: networkId || 1 },
          () => handlePairInfo(address, networkId || 1),
          (v) => !!v?.pairAddress);
        setCacheHeaders(res, 'pair-info');
        return res.json(result || { pairAddress: null });
      }
      
      case 'trades': {
        const { address, networkId, limit } = req.query;
        if (!address) {
          return res.status(400).json({ error: 'Address is required' });
        }
        const result = await withKvCache('trades', { address, networkId: networkId || 1, limit: limit || 50 },
          () => handleTrades(address, networkId || 1, limit || 50),
          // Don't cache error shapes - a transient Codex failure would otherwise
          // be re-served for the full 12s TTL. Empty/no-pairs results are fine.
          (v) => !!v && !v.error);
        setCacheHeaders(res, 'trades');
        return res.json(result);
      }
      
      case 'gt-token-info': {
        // PROD TWIN of the dev route in packages/server/routes/codex-stream.js
        // (action gt-token-info) - keep identical. Per-token GeckoTerminal
        // metadata for GT-only chains (Robinhood), proxied through the
        // CoinGecko Pro onchain mirror (500/min) because the browser's free GT
        // budget (30/min/IP) is consumed by the board's own pools calls.
        const GT_SLUG_RE = /^[a-z0-9_-]{1,30}$/;
        const GT_ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
        const slug = String(req.query.network || '');
        if (!GT_SLUG_RE.test(slug)) return res.status(400).json({ error: 'Invalid network' });
        const gtNetId = parseInt(req.query.networkId);
        const gtAddrs = String(req.query.addresses || '')
          .split(',').map((a) => a.trim().toLowerCase()).filter((a) => GT_ADDR_RE.test(a)).slice(0, 40);
        const cgKey = process.env.COINGECKO_API_KEY;
        const infos = {};
        // Codex-first (2026-09-01): token METADATA on GT-only chains IS indexed
        // by Codex even though market screening is not - measured 9/37 board
        // descriptions + 27/37 socials on Robinhood, several of which GT lacks.
        // One batched filterTokens(tokens:) call = one metered query per cold
        // board per edge-cache window. Keep in sync with the dev twin.
        const codexInfo = new Map();
        if (Number.isInteger(gtNetId) && gtNetId > 0 && gtAddrs.length) {
          try {
            const ids = gtAddrs.map((a) => `"${a}:${gtNetId}"`).join(',');
            const data = await executeCodexQuery(
              `query{filterTokens(tokens:[${ids}] limit:${gtAddrs.length}){results{token{address info{description} socialLinks{twitter telegram website}}}}}`
            );
            for (const x of data?.filterTokens?.results || []) {
              const t = x.token || {};
              const addr = String(t.address || '').toLowerCase();
              if (!addr) continue;
              codexInfo.set(addr, {
                description: ((t.info && t.info.description) || '').trim() || null,
                website: (t.socialLinks && t.socialLinks.website) || null,
                twitter: (t.socialLinks && t.socialLinks.twitter) || null,
                telegram: (t.socialLinks && t.socialLinks.telegram) || null,
              });
            }
          } catch { /* best-effort - GT/DS/CG legs still run */ }
        }
        let gi = 0;
        const gtWorker = async () => {
          while (gi < gtAddrs.length) {
            const addr = gtAddrs[gi++];
            try {
              const url = cgKey
                ? `https://pro-api.coingecko.com/api/v3/onchain/networks/${slug}/tokens/${addr}/info`
                : `https://api.geckoterminal.com/api/v2/networks/${slug}/tokens/${addr}/info`;
              const r = await fetch(url, {
                headers: cgKey ? { 'x-cg-pro-api-key': cgKey, accept: 'application/json' } : { accept: 'application/json' },
                signal: AbortSignal.timeout(8000),
              });
              if (!r.ok) continue;
              const a = (await r.json())?.data?.attributes || {};
              const v = {
                description: (a.description || '').trim() || null,
                website: Array.isArray(a.websites) && a.websites[0] ? a.websites[0] : null,
                twitter: a.twitter_handle ? `https://x.com/${a.twitter_handle}` : null,
                telegram: a.telegram_handle ? `https://t.me/${a.telegram_handle}` : null,
              };
              // CG-listing fallthrough - GT's /info drops the CG coin
              // description. Measured 0-yield on Robinhood 2026-08-18 (listed
              // teams left CG blank too) but completes the legitimate sources;
              // see the dev twin's full audit note (codex-stream.js).
              if (!v.description && cgKey && a.coingecko_coin_id) {
                try {
                  const rc = await fetch(
                    `https://pro-api.coingecko.com/api/v3/coins/${encodeURIComponent(a.coingecko_coin_id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`,
                    { headers: { 'x-cg-pro-api-key': cgKey, accept: 'application/json' }, signal: AbortSignal.timeout(8000) }
                  );
                  if (rc.ok) {
                    const jj = await rc.json();
                    v.description = ((jj.description && jj.description.en) || '').trim() || null;
                    const links = jj.links || {};
                    if (!v.website && Array.isArray(links.homepage) && links.homepage[0]) v.website = links.homepage[0];
                    if (!v.twitter && links.twitter_screen_name) v.twitter = `https://x.com/${links.twitter_screen_name}`;
                    if (!v.telegram && links.telegram_channel_identifier) v.telegram = `https://t.me/${links.telegram_channel_identifier}`;
                  }
                } catch { /* best-effort */ }
              }
              // Merge under the Codex seed: Codex fields win, GT fills nulls.
              const cx = codexInfo.get(addr) || {};
              const mv = {
                description: cx.description || v.description,
                website: cx.website || v.website,
                twitter: cx.twitter || v.twitter,
                telegram: cx.telegram || v.telegram,
              };
              if (mv.description || mv.website || mv.twitter || mv.telegram) infos[addr] = mv;
            } catch { /* transient - client retries next board visit */ }
          }
        };
        // DS latest-profiles fallback for descriptions GT lacks. Public window
        // onto DexScreener's paid CMS profiles: only the ~30 newest globally,
        // which on a young chain is exactly the fresh tokens (13/30 were
        // Robinhood when measured 2026-08-18). Older profiles have NO public
        // API - the site is CF-challenged for server egress - so they stay
        // dash-honest. Keep in sync with the dev twin (codex-stream.js).
        const dsProfiles = new Map();
        const dsFetch = (async () => {
          try {
            const r = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', {
              headers: { accept: 'application/json' },
              signal: AbortSignal.timeout(8000),
            });
            if (!r.ok) return;
            for (const p of (await r.json()) || []) {
              if (!p || !p.chainId || !p.tokenAddress) continue;
              const links = Array.isArray(p.links) ? p.links : [];
              const byType = (t) => (links.find((l) => l && l.type === t) || {}).url || null;
              const website = (links.find((l) => l && !l.type && l.url) || {}).url ||
                (links.find((l) => l && String(l.label || '').toLowerCase().includes('website')) || {}).url || null;
              dsProfiles.set(`${p.chainId}:${String(p.tokenAddress).toLowerCase()}`, {
                description: (p.description || '').trim() || null,
                website,
                twitter: byType('twitter'),
                telegram: byType('telegram'),
              });
            }
          } catch { /* best-effort */ }
        })();
        await Promise.all([gtWorker(), gtWorker(), gtWorker(), gtWorker(), dsFetch]);
        // Tokens Codex knows but the GT worker could not resolve at all (GT
        // 404/timeout) still deserve their Codex metadata.
        for (const [addr, cx] of codexInfo) {
          if (infos[addr]) continue;
          if (cx.description || cx.website || cx.twitter || cx.telegram) infos[addr] = cx;
        }
        for (const addr of gtAddrs) {
          const ds = dsProfiles.get(`${slug}:${addr}`);
          if (!ds) continue;
          const cur = infos[addr] || {};
          const merged = {
            description: cur.description || ds.description,
            website: cur.website || ds.website,
            twitter: cur.twitter || ds.twitter,
            telegram: cur.telegram || ds.telegram,
          };
          if (merged.description || merged.website || merged.twitter || merged.telegram) infos[addr] = merged;
        }
        // Profiles are near-static; a long edge cache makes the per-address
        // fan-out a once-a-day cost platform-wide.
        res.setHeader('Cache-Control', 'public, s-maxage=3600, max-age=1800, stale-while-revalidate=7200');
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=3600');
        return res.json({ infos });
      }

      case 'holders': {
        const { address, networkId } = req.query;
        if (!address) {
          return res.status(400).json({ error: 'Address is required' });
        }
        const result = await withKvCache('holders', { address, networkId: networkId || 1 },
          () => handleHolders(address, networkId || 1),
          (v) => !!v && !v.error);
        setCacheHeaders(res, 'holders');
        return res.json(result);
      }

      case 'wallet-stats': {
        const { address, networkId, wallets } = req.query;
        if (!address) {
          return res.status(400).json({ error: 'Address is required' });
        }
        const result = await withKvCache('wallet-stats', { address, networkId: networkId || 1, wallets: wallets || '' },
          () => handleWalletStats(address, networkId || 1, wallets),
          // Never cache an error shape - a transient Codex failure would blank
          // the PnL column for every viewer for the whole TTL.
          (v) => !!v && !v.error);
        setCacheHeaders(res, 'wallet-stats');
        return res.json(result);
      }

      case 'top-traders': {
        const { address, networkId, period, rank, limit } = req.query;
        if (!address) {
          return res.status(400).json({ error: 'Address is required' });
        }
        const result = await withKvCache('top-traders',
          { address, networkId: networkId || 1, period: period || 'DAY', rank: rank || 'best', limit: limit || 25 },
          () => handleTopTraders(address, networkId || 1, period, rank, limit),
          // Never cache an error shape - a transient Codex failure would blank
          // the tab for every viewer for the whole TTL.
          (v) => !!v && !v.error);
        setCacheHeaders(res, 'top-traders');
        return res.json(result);
      }

      case 'liquidity-locks': {
        const { address, networkId, pair } = req.query;
        if (!address) {
          return res.status(400).json({ error: 'Address is required' });
        }
        const result = await withKvCache('liquidity-locks', { address, networkId: networkId || 1, pair: pair || '' },
          () => handleLiquidityLocks(address, networkId || 1, pair),
          (v) => !!v && !v.error);
        setCacheHeaders(res, 'liquidity-locks');
        return res.json(result);
      }

      case 'batch-prices': {
        const { tokens: tokensJson } = req.query;
        if (!tokensJson) {
          return res.status(400).json({ error: 'tokens parameter required (JSON array of {address, networkId})' });
        }
        try {
          const tokens = JSON.parse(tokensJson);
          const result = await withKvCache('batch-prices', { tokens: tokensJson },
            () => handleBatchPrices(tokens));
          setCacheHeaders(res, 'prices');
          return res.json(result);
        } catch (parseErr) {
          return res.status(400).json({ error: 'Invalid tokens JSON' });
        }
      }

      case 'top-tokens': {
        const { limit, networks } = req.query;
        const networkIds = networks ? networks.split(',').map(n => parseInt(n)).filter(n => !isNaN(n)) : null;
        try {
          const result = await withKvCache('top-tokens', { limit: limit || '', networks: networks || '' },
            () => handleTopTokens(limit, networkIds));
          await attachDominantColors(result);
          setCacheHeaders(res, 'top-coins');
          return res.json(result);
        } catch (err) {
          console.error('Top tokens (Codex) error:', err.message);
          return res.status(500).json({ error: err.message });
        }
      }

      case 'top-coins': {
        const ALLOWED_CG_CATS = new Set([
          'artificial-intelligence', 'real-world-assets-rwa', 'meme-token',
          'decentralized-finance-defi', 'infrastructure', 'gaming', 'solana-meme-coins',
        ]);
        try {
          const limit = Math.min(parseInt(req.query.limit) || 50, 100);
          const category = ALLOWED_CG_CATS.has(req.query.category) ? req.query.category : '';
          let apiUrl = `${COINGECKO_BASE_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=true&price_change_percentage=1h,24h,7d`;
          if (category) apiUrl += `&category=${category}`;
          const response = await fetch(apiUrl, {
            headers: { 'x-cg-pro-api-key': COINGECKO_API_KEY }
          });
          if (!response.ok) throw new Error(`CoinGecko API error: ${response.status}`);
          const rawCoins = await response.json();
          const HIDDEN_SYMBOLS = new Set(['FIGR_HELOC']);
          const coins = rawCoins.filter(c => !HIDDEN_SYMBOLS.has((c.symbol || '').toUpperCase()));
          // Normalize to match our token table format
          // Change values divided by 100 to match Codex API decimal format (fmtChange multiplies back)
          const tokens = coins.map((c, i) => ({
            rank: i + 1,
            address: c.id,
            symbol: (c.symbol || '').toUpperCase(),
            name: c.name,
            logo: c.image,
            price: c.current_price || 0,
            change5m: null,
            change1h: c.price_change_percentage_1h_in_currency != null ? c.price_change_percentage_1h_in_currency / 100 : null,
            change4h: null,
            change24h: c.price_change_percentage_24h != null ? c.price_change_percentage_24h / 100 : null,
            change7d: c.price_change_percentage_7d_in_currency != null ? c.price_change_percentage_7d_in_currency / 100 : null,
            volume24h: c.total_volume || 0,
            marketCap: c.market_cap || 0,
            liquidity: null,
            createdAt: null,
            sparkline: c.sparkline_in_7d?.price || [],
            ath: c.ath || 0,
            athChangePercent: c.ath_change_percentage || 0,
          }));
          const payload = { tokens, timestamp: Date.now() };
          await attachDominantColors(payload);
          setCacheHeaders(res, 'top-coins');
          return res.json(payload);
        } catch (err) {
          console.error('Top coins error:', err.message);
          return res.status(500).json({ error: err.message });
        }
      }

      case 'market-stats': {
        try {
          const result = await handleMarketStats();
          setCacheHeaders(res, 'market-stats');
          return res.json(result);
        } catch (err) {
          console.error('Market stats error:', err.message);
          return res.json(MARKET_STATS_FALLBACK);
        }
      }

      case 'tweets': {
        try {
          // Get username from query param, default to spectre__ai
          const username = req.query.username || 'spectre__ai';
          const apiUrl = `https://bulk-hung-encryption-img.trycloudflare.com/get_official_tweets?username=${encodeURIComponent(username)}`;
          
          const response = await fetch(apiUrl, {
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
          });
          
          if (!response.ok) {
            throw new Error(`Tweets API error: ${response.status} ${response.statusText}`);
          }
          
          const data = await response.json();
          setCacheHeaders(res, 'tweets');
          return res.json(data);
        } catch (error) {
          console.error('Tweets API error:', error);
          return res.status(500).json({ error: error.message });
        }
      }
      
      case 'health':
      default:
        setCacheHeaders(res, 'health');
        return res.json({ status: 'ok', timestamp: new Date().toISOString() });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
