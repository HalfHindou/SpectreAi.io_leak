/**
 * GeckoTerminal DEX OHLCV → TradingView/Codex bars adapter.
 *
 * L4-PR8 (2026-06-03): the degen-chart gap fix. Sits between Hetzner candles
 * (Tier 2, top-100 active set) and Codex (Tier 3, paid). For ANY DEX token
 * outside the Hetzner top-100 active set — i.e. the long tail that real users
 * are charting (SPECTRE rank #1851 was the canary) — pull OHLCV directly from
 * GeckoTerminal's free public API instead of burning Codex getBars ops.
 *
 * Why this matters: post L4-PR4 + L4-PR5 + hotfix#725, low-cap tokens still
 * fell through to Codex (Tier 3, paid) for chart bars. Hetzner only refreshes
 * the top-100 active DEX tokens (worker-candles-codex ACTIVE_LIMIT=100), and
 * hotfix#725 added a staleness check so anything outside that set returns null.
 * That's where Codex ate the bill. GeckoTerminal closes this at $0 cost.
 *
 * Tier chain (after L4-PR8):
 *   Tier 1   : Binance klines        (L4-PR4) — majors with USDT pair
 *   Tier 2   : Hetzner candles_1m    (L4-PR5) — top-100 active set, fresh
 *   Tier 2.5 : GeckoTerminal ← THIS MODULE — DEX long-tail, free
 *   Tier 3   : Codex getTokenBars              — final fallback (paid)
 *
 * GeckoTerminal API reference:
 *   Network discovery: GET /api/v2/networks/{network}/tokens/{address}/pools
 *     Returns top pools by liquidity (sorted DESC by reserve_in_usd). The
 *     first `data[0]` is the highest-liquidity pool — what we want for bars.
 *
 *   OHLCV:           GET /api/v2/networks/{network}/pools/{pool}/ohlcv/{timeframe}
 *     ?aggregate=N   1,5,15,30 for minute; 1,4,12 for hour; 1,7 for day
 *     ?before_timestamp=T  (unix seconds) — controls the upper end of window
 *     ?limit=L       max 1000 bars per call
 *     ?currency=usd  always; we don't want native-token quoted
 *     ?token=base    always; quote-token view confuses users
 *
 *   Response: { data: { attributes: { ohlcv_list: [[ts, o, h, l, c, v], ...] } } }
 *     ohlcv_list is sorted DESC (most recent first). Timestamps in unix SECONDS.
 *     Adapter reverses to ASC and parses to {t, o, h, l, c, v}.
 *
 *   Rate limits: public, no auth, ~30 req/min per IP (per GT docs).
 *     For Vercel edge IPs this is shared but in practice we'll see 1 OHLCV
 *     call + 1 pools call (cached 24h) per chart open per (token, resolution).
 *
 * Network ID mapping (Codex → GeckoTerminal):
 *   1            → 'eth'            Ethereum mainnet
 *   1399811149   → 'solana'         Solana
 *   56           → 'bsc'            BNB Smart Chain
 *   8453         → 'base'           Base
 *   42161        → 'arbitrum'       Arbitrum One
 *   10           → 'optimism'       Optimism
 *   137          → 'polygon_pos'    Polygon PoS
 *   43114        → 'avalanche'      Avalanche C-Chain
 *   250          → 'ftm'            Fantom (rare)
 *
 * Resolution mapping (TradingView → GeckoTerminal timeframe + aggregate):
 *   '1'          → minute/aggregate=1
 *   '5'          → minute/aggregate=5
 *   '15'         → minute/aggregate=15
 *   '30'         → minute/aggregate=15  (GT has no 30m; 15m is the closest)
 *   '60'         → hour/aggregate=1
 *   '240'        → hour/aggregate=4
 *   '720'        → hour/aggregate=12
 *   '1D' / 'D'   → day/aggregate=1
 *   '1W' / 'W' / '7D' → day/aggregate=7
 *
 * Failure modes (all soft, return null → caller falls back to Codex):
 *   - Token has no pool on GT for the resolved network (404 on /pools)
 *   - GT 4xx/5xx error
 *   - Both /pools and /ohlcv 4s timeout
 *   - Empty ohlcv_list after parse
 *   - Resolved network slug unsupported by GT
 *
 * Module-level cache:
 *   - poolResolutionCache: address+network → pool address, 24h TTL.
 *     Pool addresses are immutable; safe to cache aggressively. Prevents
 *     hammering /pools on every chart pan/poll.
 *
 * Kill switch: L4_PR8_DISABLE_GECKOTERMINAL=1 (Vercel env) bypasses every call.
 */

import { createRequire } from 'module';
const _require = createRequire(import.meta.url);

// Reuse the canonical token registry for symbol → address+network reverse
// resolution. Same pattern as binance-bars and hetzner-bars helpers.
let TOKEN_REGISTRY = null;
let KNOWN_TOKEN_ADDRESSES = null;
try {
  const reg = _require('../../../../packages/server/lib/token-registry');
  TOKEN_REGISTRY = reg?.TOKEN_REGISTRY || null;
  KNOWN_TOKEN_ADDRESSES = reg?.KNOWN_TOKEN_ADDRESSES || null;
} catch {
  // Best-effort. Address-input path still works directly with explicit hints.
}

// GT-pro (2026-06-10, charts-v2 Phase 1): with a paid CoinGecko key, the SAME
// GeckoTerminal endpoints are served under /onchain on the pro host at the
// plan's rate limit (Lite: 500/min, 2M credits/mo) instead of the public
// ~30/min/IP that every Vercel lambda and the Hetzner backfill worker fight
// over. Response shapes are identical. Falls back to the free host when the
// key is absent.
const CG_PRO_KEY = (process.env.COINGECKO_API_KEY || '').trim();
const GT_BASE = CG_PRO_KEY
  ? 'https://pro-api.coingecko.com/api/v3/onchain'
  : 'https://api.geckoterminal.com/api/v2';
const GT_HEADERS = CG_PRO_KEY
  ? { accept: 'application/json', 'x-cg-pro-api-key': CG_PRO_KEY }
  : { accept: 'application/json' };

// Codex/Spectre networkId → GeckoTerminal network slug.
// Source of truth: https://api.geckoterminal.com/api/v2/networks
// Only chains where we actively chart DEX tokens are listed; others fall to Codex.
export const GT_NETWORK_MAP = {
  1: 'eth',
  1399811149: 'solana',
  56: 'bsc',
  8453: 'base',
  42161: 'arbitrum',
  10: 'optimism',
  137: 'polygon_pos',
  43114: 'avalanche',
  250: 'ftm',
  100: 'xdai',           // Gnosis
  1101: 'polygon-zkevm', // rare but supported
  4663: 'robinhood',     // Robinhood Chain (Arbitrum Orbit L2) — no Codex coverage, GT is primary
};

// TradingView/Codex resolution → GT { timeframe, aggregate }.
// GT timeframes: 'minute', 'hour', 'day' with corresponding aggregate values.
// Aggregate validates server-side; passing an unsupported combo returns 422.
export const GT_RESOLUTION_MAP = {
  '1S':  { timeframe: 'minute', aggregate: 1 },  // GT min is 1m; 1S falls to 1m (still beats Codex 1S risk)
  '1':   { timeframe: 'minute', aggregate: 1 },
  '5':   { timeframe: 'minute', aggregate: 5 },
  '15':  { timeframe: 'minute', aggregate: 15 },
  '30':  { timeframe: 'minute', aggregate: 15 }, // GT has no 30m bucket
  '60':  { timeframe: 'hour',   aggregate: 1 },
  '120': { timeframe: 'hour',   aggregate: 1 },  // GT has no 2h bucket
  '240': { timeframe: 'hour',   aggregate: 4 },
  '360': { timeframe: 'hour',   aggregate: 4 },  // GT has no 6h bucket
  '480': { timeframe: 'hour',   aggregate: 4 },  // GT has no 8h bucket
  '720': { timeframe: 'hour',   aggregate: 12 },
  'D':   { timeframe: 'day',    aggregate: 1 },
  '1D':  { timeframe: 'day',    aggregate: 1 },
  '3D':  { timeframe: 'day',    aggregate: 1 },  // not a GT aggregate; collapse to 1d
  'W':   { timeframe: 'day',    aggregate: 7 },
  '1W':  { timeframe: 'day',    aggregate: 7 },
  '7D':  { timeframe: 'day',    aggregate: 7 },
};

// 24h TTL on pool resolutions. Pool address is immutable (an LP pair contract);
// it can only become *stale* in the sense of liquidity migrating to a newer pool,
// which for any given token happens on timescales much longer than a chart session.
// One day is the right knob: long enough to absorb 1000s of chart polls, short
// enough that a permanent migration self-heals overnight.
const POOL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const _poolResolutionCache = new Map(); // key: `${network}:${addrLower}` → { pool, ts }

/**
 * Map Codex networkId → GeckoTerminal network slug. Returns null for chains
 * GT doesn't index (or that we haven't mapped yet — see GT_NETWORK_MAP above).
 */
export function networkIdToGtSlug(networkId) {
  if (networkId == null) return null;
  const n = parseInt(networkId);
  if (!Number.isFinite(n)) return null;
  return GT_NETWORK_MAP[n] || null;
}

/**
 * Reverse-resolve {symbol|address|cgId} → { address, gtNetwork } pair that
 * GT's /pools endpoint can consume. Mirrors the resolveHetznerAsset logic in
 * shape — same registries, same lookup priority — but emits an address+slug
 * combo because GT's API is address-keyed.
 *
 * Inputs (we see all of these in the wild from the bars handler):
 *   - "0xC02a…"       → bare EVM address (Ethereum default if no networkId)
 *   - "0xC02a…:1"     → address:networkId pair (Codex symbol form)
 *   - "0xC02a…:8453"  → Base address
 *   - "<sol-addr>"    → Solana base58 address (32+ chars, no 0x prefix)
 *   - "SPECTRE"       → bare symbol, need registry reverse-lookup
 *
 * Returns `{ address, gtNetwork }` on success, `null` on unresolvable.
 */
export function resolveGtTokenInput(symbolOrAddress, networkIdHint = null, addressHint = null) {
  if (process.env.L4_PR8_DISABLE_GECKOTERMINAL === '1') return null;

  const raw = String(symbolOrAddress || addressHint || '').trim();
  if (!raw) return null;

  // (a) Address with `:networkId` suffix — most-explicit form.
  if (raw.includes(':')) {
    const [addrPart, netStr] = raw.split(':');
    const gtNet = networkIdToGtSlug(parseInt(netStr));
    if (gtNet && addrPart) return { address: addrPart, gtNetwork: gtNet };
    return null;
  }

  // (b) Direct EVM address (`0x…`) — default to Ethereum unless caller hinted.
  if (raw.startsWith('0x') && raw.length >= 42) {
    const gtNet = networkIdToGtSlug(networkIdHint || 1);
    if (!gtNet) return null;
    return { address: raw, gtNetwork: gtNet };
  }

  // (c) Solana-style base58 address (32+ chars, no 0x, no spaces).
  if (raw.length >= 32 && !raw.includes(' ') && !raw.startsWith('0x')) {
    // Could also be a base58 ETH address — vanishingly rare and the caller
    // would have to hint a non-Solana networkId. Default to Solana.
    const gtNet = networkIdToGtSlug(networkIdHint || 1399811149);
    if (!gtNet) return null;
    return { address: raw, gtNetwork: gtNet };
  }

  // (d) Bare symbol — registry reverse-lookup.
  const upper = raw.toUpperCase();
  const regs = [TOKEN_REGISTRY, KNOWN_TOKEN_ADDRESSES];
  for (const src of regs) {
    if (!src) continue;
    const info = src[upper];
    if (info?.address && info?.networkId != null) {
      const gtNet = networkIdToGtSlug(info.networkId);
      if (gtNet) return { address: info.address, gtNetwork: gtNet };
    }
  }
  return null;
}

/**
 * Find the highest-liquidity pool for a token on a given GT network.
 *
 *   network   GT network slug ('eth', 'solana', 'bsc', …)
 *   address   token contract address
 *
 * Returns the pool address (e.g. `'Bzc9NZfMqkXR6fz1DBph7BDf9BroyEf6pnzESP7v5iiw'`)
 * on success, `null` on no pool / error / timeout.
 *
 * Cached in module memory for 24h. Pool addresses are immutable; the worst
 * case is that liquidity migrates to a newer pool and we serve bars from an
 * older one for up to 24h — acceptable for a long-tail chart fallback.
 */
async function _findTopPool(network, address) {
  if (!network || !address) return null;
  const key = `${network}:${String(address).toLowerCase()}`;
  const cached = _poolResolutionCache.get(key);
  if (cached && Date.now() - cached.ts < POOL_CACHE_TTL_MS) {
    return cached.pool;
  }

  const url = `${GT_BASE}/networks/${encodeURIComponent(network)}/tokens/${encodeURIComponent(address)}/pools?page=1`;
  try {
    const resp = await fetch(url, {
      headers: GT_HEADERS,
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) {
      // 404 = token not on GT for this chain; 4xx generally = bad input.
      // Cache the miss for 24h so we don't re-poll every chart open.
      //
      // But NOT 429/5xx. Those are TRANSIENT (GT's keyless tier is ~30 req/min
      // and we burst on any busy board), and caching one as a 24h "no pool"
      // silently disables the free DEX-native tier for that token for a full
      // day - every later chart open then falls through to METERED Codex.
      // That is backwards twice over: it bills us for a free miss, and the
      // fall-through is exactly the wasted latency this tier exists to avoid.
      // Re-poll instead; a genuine 404 still gets cached below.
      const transient = resp.status === 429 || resp.status >= 500;
      if (!transient) _poolResolutionCache.set(key, { pool: null, ts: Date.now() });
      return null;
    }
    const json = await resp.json();
    const pools = Array.isArray(json?.data) ? json.data : null;
    if (!pools || pools.length === 0) {
      _poolResolutionCache.set(key, { pool: null, ts: Date.now() });
      return null;
    }
    // GT sorts pools by `reserve_in_usd` DESC by default. Take the first one.
    // Defensive: if `attributes.address` is present (the LP contract addr),
    // use it; otherwise fall back to stripping the `<network>_` prefix off
    // the resource `id` (e.g. `solana_Bzc9…` → `Bzc9…`).
    const top = pools[0];
    let poolAddr = top?.attributes?.address || null;
    if (!poolAddr && typeof top?.id === 'string') {
      const colonIdx = top.id.indexOf('_');
      poolAddr = colonIdx >= 0 ? top.id.slice(colonIdx + 1) : top.id;
    }
    if (!poolAddr) {
      _poolResolutionCache.set(key, { pool: null, ts: Date.now() });
      return null;
    }
    _poolResolutionCache.set(key, { pool: poolAddr, ts: Date.now() });
    return poolAddr;
  } catch (e) {
    // Network/timeout: do NOT cache so the next chart open can retry.
    if (e?.name !== 'AbortError' && e?.name !== 'TimeoutError') {
      console.warn(`[L4-PR8-GT] /pools ${network}/${address}: ${e.message}`);
    }
    return null;
  }
}

/**
 * Adapt one GeckoTerminal OHLCV row → `{t, o, h, l, c, v}` row.
 * Format: `[unix_seconds, open, high, low, close, volume]`
 */
function _adaptOhlcvRow(row) {
  if (!Array.isArray(row) || row.length < 6) return null;
  const t = Math.floor(Number(row[0]));
  if (!Number.isFinite(t) || t <= 0) return null;
  const o = parseFloat(row[1]);
  const h = parseFloat(row[2]);
  const l = parseFloat(row[3]);
  const c = parseFloat(row[4]);
  const v = parseFloat(row[5]) || 0;
  if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return null;
  if (o < 0 || h < 0 || l < 0 || c < 0) return null;
  if (h > 1e12) return null;
  return { t, o, h, l, c, v };
}

/**
 * Fetch GeckoTerminal OHLCV for a token and return TradingView/Codex shaped bars.
 *
 *   symbolOrAddress  whatever the chart handler had (symbol / address / address:net).
 *   networkOrChain   optional networkId hint (Codex int) OR GT slug string.
 *                    If omitted, resolveGtTokenInput defaults to ETH for 0x
 *                    addresses and Solana for base58 addresses.
 *   resolution       TradingView resolution ('60', '240', '1D', '7D', …).
 *   fromSec          unix seconds (request window start).
 *   toSec            unix seconds (request window end).
 *   opts.cgId        optional coingecko_id hint (not used by GT directly but
 *                    accepted for caller-API symmetry with the Hetzner helper).
 *   opts.address     optional explicit address hint.
 *
 * Returns `[{t, o, h, l, c, v}, ...]` sorted ASC, or `null` on any failure.
 * Never throws. Caller must `bars ||`-chain to the next tier.
 */
export async function fetchGeckoTerminalBars(
  symbolOrAddress,
  networkOrChain,
  resolution,
  fromSec,
  toSec,
  opts = {},
) {
  if (process.env.L4_PR8_DISABLE_GECKOTERMINAL === '1') return null;
  if (fromSec == null || toSec == null || fromSec >= toSec) return null;

  // (1) Resolve resolution → GT timeframe+aggregate.
  const resMap = GT_RESOLUTION_MAP[resolution] || GT_RESOLUTION_MAP[String(resolution)];
  if (!resMap) return null;

  // (2) Resolve {symbol|address, network} → {address, gtNetwork}.
  // Accept networkOrChain as either a Codex int OR a GT slug string. Caller
  // ergonomics: bars.js passes networkId int; tradingview-udf passes int too;
  // a direct test caller can pass 'solana' or 'eth'.
  let netHint = null;
  if (typeof networkOrChain === 'string' && /^[a-z_]+$/i.test(networkOrChain) && networkOrChain.length <= 24) {
    // Looks like a GT slug — reverse-resolve to canonical Codex int via map.
    const inverse = Object.entries(GT_NETWORK_MAP).find(([, slug]) => slug === networkOrChain.toLowerCase());
    netHint = inverse ? parseInt(inverse[0]) : null;
  } else if (networkOrChain != null) {
    const n = parseInt(networkOrChain);
    if (Number.isFinite(n)) netHint = n;
  }
  const resolved = resolveGtTokenInput(symbolOrAddress, netHint, opts.address || null);
  if (!resolved) return null;

  // (2.5) Pro-only token-level OHLCV (charts-v2 Phase 1): GT aggregates
  // across the token's pools server-side — one call, no pool discovery,
  // and it survives pool migrations that strand the cached top-pool. Falls
  // through to the classic pool path on any miss.
  if (CG_PRO_KEY) {
    const tokenBars = await _fetchOhlcvPaged(
      `${GT_BASE}/networks/${encodeURIComponent(resolved.gtNetwork)}` +
      `/tokens/${encodeURIComponent(resolved.address)}/ohlcv/${resMap.timeframe}` +
      `?aggregate=${resMap.aggregate}&limit=1000` +
      `&currency=usd&token=base&include_empty_intervals=true`,
      fromSec, toSec, `${resolved.gtNetwork}/token:${resolved.address.slice(0, 10)}`,
    );
    if (tokenBars?.length) return tokenBars;
  }

  // (3) Resolve token → highest-liquidity pool (24h module cache).
  const poolAddr = await _findTopPool(resolved.gtNetwork, resolved.address);
  if (!poolAddr) return null;

  // (4) Pool-level OHLCV — the classic path, and the only one on the free
  // host. include_empty_intervals + window-filter semantics live in the
  // shared series fetcher.
  return _fetchOhlcvPaged(
    `${GT_BASE}/networks/${encodeURIComponent(resolved.gtNetwork)}` +
    `/pools/${encodeURIComponent(poolAddr)}/ohlcv/${resMap.timeframe}` +
    `?aggregate=${resMap.aggregate}&limit=1000` +
    `&currency=usd&token=base&include_empty_intervals=true`,
    fromSec, toSec, `${resolved.gtNetwork}/${poolAddr}`,
  );
}

// Coverage-driven pagination over the GT OHLCV endpoints (2026-06-11).
// GT silently CAPS each response well under the documented limit=1000 (PALM
// day timeframe returned 182 bars), so a single anchored call can cover only
// the TAIL of a wide request window. The old code returned that partial
// window as if complete - the bars cascade stopped at GT, TradingView cached
// the uncovered head subrange as "no data", and the chart showed a months-
// long hole between the GT-covered tail and older cg-ohlc data (PALM 1D
// repro). Page backwards (before_timestamp = oldest received bar) until the
// window head is covered, the upstream runs dry, or the page budget is hit.
const _GT_MAX_PAGES = 4;
// Total wall-clock budget for the paging loop (2026-06-14). Each page is a
// 4s-bounded fetch; 4 pages serial could stack to ~16s on a sparse token whose
// pool keeps yielding a few bars per call (SPECTRE 15M realBarRatio 0.13 -
// measured 6-17s cold timeframe switches, occasionally past the client's
// chart-load deadline = the "sometimes never loads" report). The visible chart
// window is the recent TAIL, which page 1 covers; deeper pages only fill
// off-screen scroll-back, so bounding the loop here loses nothing on-screen and
// caps the worst case. Daily/weekly genesis still backfills via the gated
// head-stitch in bars-router.js.
const _GT_PAGE_BUDGET_MS = 6000;
async function _fetchOhlcvPaged(urlBase, fromSec, toSec, label) {
  let all = null;
  let anchor = Math.floor(toSec);
  const deadline = Date.now() + _GT_PAGE_BUDGET_MS;
  for (let page = 0; page < _GT_MAX_PAGES; page++) {
    const remaining = deadline - Date.now();
    if (page > 0 && remaining < 800) break;   // not enough time for a useful page
    const bars = await _fetchOhlcvSeries(
      `${urlBase}&before_timestamp=${anchor}`,
      fromSec, anchor, label, Math.min(4000, Math.max(remaining, 1500)),
    );
    if (!bars || bars.length === 0) break;
    all = all ? bars.concat(all) : bars;
    const oldest = bars[0].t;
    if (oldest <= fromSec) break;       // window head covered
    if (oldest >= anchor) break;        // no progress - upstream dry
    anchor = oldest;                    // page deeper
  }
  if (!all || all.length === 0) return null;
  // Pages can overlap by one boundary bar - dedup by timestamp, keep ASC.
  const seen = new Set();
  const merged = [];
  for (const b of all.sort((a, b) => a.t - b.t)) {
    if (seen.has(b.t)) continue;
    seen.add(b.t);
    merged.push(b);
  }
  return clampOutlierBars(merged);
}

// DEX anomaly clamp (2026-06-11, charts-system E1 finally implemented).
// GT/Codex day aggregations keep single wash-trade prints as the bar's
// high/low: PALM 2025-01-09 shipped h=$32,450 against o=$1.19/c=$0.98 -
// one bar blew the chart's auto-scale to $33K and flattened two years of
// real candles into a 1px line. Clamp ONLY absurd wick-and-full-retrace
// shapes: the wick must exceed BOTH 10x the neighbor-median close AND 10x
// its own body extremes - a real pump/rug bar closes near its extreme, so
// its second condition fails and it renders untouched.
export function clampOutlierBars(bars) {
  if (!Array.isArray(bars) || bars.length < 5) return bars;
  const closes = bars.map((b) => b.c).filter((c) => c > 0);
  if (closes.length < 5) return bars;
  const out = bars.map((b, i) => {
    // neighbor median over +-7 bars (cheap, robust against local pumps)
    const lo = Math.max(0, i - 7);
    const hi = Math.min(bars.length, i + 8);
    const win = [];
    for (let k = lo; k < hi; k++) { if (bars[k].c > 0) win.push(bars[k].c); }
    if (win.length < 3) return b;
    win.sort((a, c) => a - c);
    const med = win[Math.floor(win.length / 2)];
    const bodyMax = Math.max(b.o || 0, b.c || 0);
    const bodyMin = Math.min(b.o || Infinity, b.c || Infinity);
    let { h, l } = b;
    let touched = false;
    // Wash-print wick = huge vs BOTH the neighbor median AND its own body.
    // A real pump/rug bar closes near its extreme (bodyMax ~ h) so the
    // h > bodyMax*3 test fails and it renders untouched; a wash spike has
    // h >> bodyMax so it clamps. Tightened 10x->4x/3x (2026-06-17): an $11
    // wick on a $0.3-3 token (med x22) with a large day-body slipped the old
    // bodyMax*10 gate and blew out the y-axis.
    if (h > med * 4 && bodyMax > 0 && h > bodyMax * 3) {
      h = Math.max(bodyMax, med * 3);
      touched = true;
    }
    if (l > 0 && l < med / 4 && bodyMin < Infinity && l < bodyMin / 3) {
      l = Math.min(bodyMin, med / 3);
      touched = true;
    }
    return touched ? { ...b, h, l } : b;
  });
  return out;
}

// Shared fetch+parse for token-level and pool-level OHLCV endpoints.
// include_empty_intervals=true (provider-docs audit 2026-06-10): GT fills
// no-trade buckets SERVER-SIDE with previous close + zero volume, so thin
// tokens come back as a continuous series at the requested grain — exactly
// what the client-side gap-fill was fabricating (badly). Returns ASC bars
// filtered to [fromSec, toSec], or null on any failure (caller cascades).
async function _fetchOhlcvSeries(url, fromSec, toSec, label, timeoutMs = 4000) {
  try {
    const resp = await fetch(url, {
      headers: GT_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) {
      // 4xx tends to mean bad pool / unsupported aggregate combo; treat as null.
      if (resp.status >= 500) {
        console.warn(`[L4-PR8-GT] /ohlcv ${label}: HTTP ${resp.status}`);
      }
      return null;
    }
    const json = await resp.json();
    const list = json?.data?.attributes?.ohlcv_list;
    if (!Array.isArray(list) || list.length === 0) return null;

    // GT returns DESC (newest first). Adapt + filter + sort ASC.
    const bars = list
      .map(_adaptOhlcvRow)
      .filter(Boolean)
      .filter((b) => b.t >= fromSec && b.t <= toSec)
      .sort((a, b) => a.t - b.t);

    if (bars.length === 0) return null;
    return bars;
  } catch (e) {
    if (e?.name !== 'AbortError' && e?.name !== 'TimeoutError') {
      console.warn(`[L4-PR8-GT] /ohlcv ${label}: ${e.message}`);
    }
    return null;
  }
}

export const __test__ = {
  _adaptOhlcvRow,
  _findTopPool,
  _poolResolutionCache,
  resolveGtTokenInput,
};
