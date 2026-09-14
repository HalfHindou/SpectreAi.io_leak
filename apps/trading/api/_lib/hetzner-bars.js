/**
 * Hetzner candles_1m → TradingView/Codex bars adapter.
 *
 * L4-PR5 (2026-06-03): the second-half of the chart-bars bleed fix.
 *
 *   L4-PR4 shipped: Binance klines for any token with a USDT pair (covers
 *   majors: BTC, ETH, SOL, top-50). That was ~50-60% of `getBars` cost.
 *
 *   THIS PR (L4-PR5): for tokens NOT on Binance, route to Hetzner's
 *   candles_1m Timescale table.
 *
 *   CANDLE STORE UPGRADE (2026-06-09): Hetzner is now a lazy, self-growing
 *   OHLCV store — /v1/candles resolves raw addresses (`address:networkId`),
 *   auto-registers unknown tokens in chart_assets, queues a permanent
 *   backfill (GT primary / Codex fallback), and worker-candle-live keeps
 *   recently-viewed tokens fresh. This module now passes addresses through
 *   natively instead of bailing to Codex when the static registry misses.
 *
 * Tier chain:
 *   Tier 1: Binance klines  (L4-PR4) — top tokens with USDT pair
 *   Tier 2: Hetzner candles ← THIS MODULE — CEX assets + ANY address (lazy)
 *   Tier 3: GeckoTerminal   (L4-PR8) — first-view gap while backfill runs
 *   Tier 4: Codex getTokenBars       — last-resort long tail
 *
 * Per Sunny's dashboard (Jun 2 2026), `getBars` accounted for 721K ops/day =
 * 46% of total Codex spend. With L4-PR4 in production, the residual is the
 * DEX-token chart traffic — exactly what Hetzner's worker-candles-codex now
 * fills (verified 2026-06-03 morning: KEY_B restored, 100 assets/cycle, 6,600
 * bars upserted in 25s).
 *
 * Endpoint shape (verified live against Hetzner Express route):
 *
 *   GET /v1/candles/:asset?interval=<x>&from=<iso>&to=<iso>&limit=<n>
 *   Headers: X-API-Key: <SPECTRE_API_KEY>
 *
 *   :asset resolves via lib/asset-resolver — symbol (BTC), coingecko_id
 *   (bitcoin), slug, AND (Candle Store, 2026-06-09) raw addresses:
 *   `address:networkId` (Codex-style), `address:chain`, or bare Solana
 *   base58. Unknown addresses are AUTO-REGISTERED in chart_assets — a
 *   permanent backfill is queued (GT primary, Codex fallback) and the
 *   token is kept live by worker-candle-live while it's being viewed.
 *   First view may return 0 bars (backfill queued → we fall through to
 *   GT/Codex once); every later view is served from the store for free.
 *
 *   Intervals supported (server-side aggregates from candles_1m):
 *     1m, 2m, 3m, 5m, 15m, 30m, 45m
 *     1h, 2h, 3h, 4h, 12h
 *     1d, 1w, 1M, 3M, 6M, 12M
 *
 *   Response shape:
 *     { data: [{ time: '2026-06-03T05:45:00.000Z',
 *                open: 3.17e-06, high, low, close,
 *                volume, quote_volume, trades }],
 *       meta: { asset, interval, count, source, queryTimeMs } }
 *
 *   For daily+ resolutions, volume/open/etc come back as STRINGS (postgres
 *   numeric type via price_history_daily). For 1m-4h they're numbers. The
 *   adapter must parseFloat in both cases. See _adaptRow below.
 *
 * Failure modes (all soft, return null → caller falls back to Codex):
 *   - No asset resolution (Hetzner returns count=0)
 *   - HTTP error / timeout (3s)
 *   - Empty data array
 *   - Any exception (logged, swallowed)
 *
 * Coverage notes (Candle Store, 2026-06-09):
 *   - chart_assets is a lazy registry: 40K+ DEX tokens seeded, plus any
 *     address ever requested through this module (auto-registered with
 *     permanent backfill). Coverage grows with usage, never shrinks.
 *   - worker-candle-live keeps recently-viewed tokens fresh (20s DS
 *     sampling + GT corrections) — presence-driven, no per-user cost.
 *   - worker-binance et al. cover ~800 CEX assets (any with a CEX pair).
 *   - Daily history (price_history_daily) covers ~1,851 assets back to 2013
 *     — used for `1d`+ resolutions when 1m data is missing.
 *
 * Resolution mapping:
 *   The /api/bars handler passes TradingView/Codex resolution strings
 *   ('60', '240', '1D', '7D', etc). Translation table mirrors what
 *   Hetzner's candles route uses internally.
 *
 * Kill switch: L4_PR5_DISABLE_HETZNER_BARS=1 (Vercel env) bypasses every
 * call — bars flow Binance → Codex as if this module didn't exist.
 */

import { createRequire } from 'module';
const _require = createRequire(import.meta.url);

// Resolve cgId for tokens whose symbol Hetzner doesn't index but whose
// coingecko_id is in the registry. This pulls the same shared module the
// rest of the L4 stack uses.
let SYMBOL_TO_COINGECKO_ID = null;
let TOKEN_REGISTRY = null;
let KNOWN_TOKEN_ADDRESSES = null;
try {
  const reg = _require('../../../../packages/server/lib/token-registry');
  SYMBOL_TO_COINGECKO_ID = reg?.SYMBOL_TO_COINGECKO_ID || null;
  TOKEN_REGISTRY = reg?.TOKEN_REGISTRY || null;
  KNOWN_TOKEN_ADDRESSES = reg?.KNOWN_TOKEN_ADDRESSES || null;
} catch {
  // Best-effort: helper will still work for direct symbol lookups,
  // address inputs just won't reverse-resolve.
}

const SPECTRE_API_BASE = (process.env.SPECTRE_API_ORIGIN || 'http://204.168.244.18:3850').replace(/\/+$/, '');
const SPECTRE_API_KEY = process.env.SPECTRE_DATA_API_KEY || process.env.SPECTRE_API_KEY || '';

// TradingView/Codex resolution → Hetzner candles `interval` param.
// Hetzner supports a richer set than Codex — anything outside this table is
// caller error (we still attempt, but the route will 400). 7D is special:
// Hetzner uses '1w' (ISO week aggregation), not '7d'.
export const HETZNER_INTERVAL_MAP = {
  '1S': '1m',  // Hetzner min is 1m; 1S falls through gracefully (still better than Codex 1S spike risk)
  '1': '1m',
  '3': '3m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '45': '45m',
  '60': '1h',
  '120': '2h',
  '180': '3h',
  '240': '4h',
  '360': '4h',  // 6h → 4h (closest supported)
  '480': '4h',  // 8h → 4h
  '720': '12h', // candles_12h cagg shipped 2026-06-09 (migration 118)
  'D': '1d',
  '1D': '1d',
  '3D': '1d',   // 3-day not supported; falls back to 1d
  'W': '1w',
  '1W': '1w',
  '7D': '1w',
  'M': '1M',
  '1M': '1M',
  '12M': '12M',
};

/**
 * Resolve an input symbol-or-address to a Hetzner asset slug.
 *
 * Hetzner's asset-resolver matches on (symbol | coingecko_id | slug) —
 * NOT on raw contract address. So if we're handed a `0x…` or Solana address,
 * we need to reverse it via the static token registry. For symbols that the
 * registry knows but Hetzner indexes only by coingeckoId (e.g. it sometimes
 * has dupes on symbol), prefer the coingeckoId.
 *
 *   "BTC"          → "BTC"           (Hetzner resolves to BTC asset row)
 *   "bitcoin"      → "bitcoin"       (passes through; cgId match)
 *   "0xC02a…"      → "ethereum"      (registry reverse-lookup → cgId)
 *   "0xC02a…:1"    → "ethereum"      (split + reverse)
 *   "<sol-addr>"   → "SOL" or symbol (registry reverse-lookup)
 *   unknown addr   → "addr:networkId" (Candle Store address-native — the
 *                    store auto-registers it, queues a permanent backfill,
 *                    and serves every later view for free)
 *
 * cgIdHint takes priority — if the caller already resolved coingeckoId
 * (handleBars has it from KV `cg:snap`), use it directly.
 * networkIdHint is used to build the address-native form (Solana flip
 * 1 → 1399811149 applied internally).
 */
function _looksLikeAddress(s) {
  return s.startsWith('0x') || s.includes(':') || (s.length >= 32 && !s.includes(' '));
}

export function resolveHetznerAsset(symbol, cgIdHint = null, addressHint = null, networkIdHint = null) {
  if (process.env.L4_PR5_DISABLE_HETZNER_BARS === '1') return null;
  if (!symbol && !cgIdHint && !addressHint) return null;

  // (a) cgId hint — most reliable, used directly.
  if (cgIdHint && typeof cgIdHint === 'string') {
    const s = cgIdHint.trim().toLowerCase();
    if (s && s.length < 60) return s;
  }

  let raw = String(symbol || addressHint || '').trim();
  if (!raw) return null;

  // If the symbol is a plain ticker but the caller supplied an explicit
  // address hint, prefer the address — it's collision-free and the Candle
  // Store resolves (and auto-registers) addresses natively.
  const hintRaw = String(addressHint || '').trim();
  if (hintRaw && _looksLikeAddress(hintRaw) && !_looksLikeAddress(raw)) raw = hintRaw;

  // (b) Looks like an address (raw `0x…`, `0x…:1`, or 32+ char solana base58).
  //     Reverse-resolve via the static registry. We iterate ALL registries
  //     looking for a hit with a coingeckoId (the most reliable Hetzner key);
  //     only if no cgId-bearing hit exists do we fall back to a symbol-only hit.
  //     This matters because KNOWN_TOKEN_ADDRESSES entries sometimes lack a
  //     coingeckoId field while the TOKEN_REGISTRY twin has it (e.g. WIF →
  //     KTA has `coingeckoId: undefined` but TR has `coingeckoId: 'dogwifcoin'`).
  if (_looksLikeAddress(raw)) {
    const addrOriginal = raw.includes(':') ? raw.split(':')[0] : raw;
    const addr = addrOriginal.toLowerCase();
    const registries = [
      TOKEN_REGISTRY,            // canonical symbol → cgId map, iterated FIRST
      KNOWN_TOKEN_ADDRESSES,     // wider coverage but cgId often missing
    ];
    let symbolFallback = null;
    for (const src of registries) {
      if (!src) continue;
      for (const [sym, info] of Object.entries(src)) {
        const a = info?.address;
        if (a && String(a).toLowerCase() === addr) {
          // Prefer coingeckoId since it's globally unique on Hetzner.
          if (info?.coingeckoId) return String(info.coingeckoId).toLowerCase();
          if (!symbolFallback) symbolFallback = String(sym).toUpperCase();
        }
      }
    }
    // No cgId hit anywhere — fall back to the bare symbol if we found one.
    if (symbolFallback) return symbolFallback;

    // Candle Store address-native fallback (2026-06-09): /v1/candles now
    // resolves `address:networkId` directly — unknown addresses are
    // auto-registered in chart_assets with a permanent backfill. NOTE:
    // preserve the address case (Solana base58 is case-sensitive; the
    // store's lookup is case-insensitive but we don't mangle the input).
    const embeddedNet = raw.includes(':') ? parseInt(raw.split(':')[1], 10) : null;
    let net = embeddedNet || parseInt(networkIdHint, 10) || null;
    const isSolana = !addrOriginal.startsWith('0x') && addrOriginal.length >= 32;
    if (isSolana && (!net || net === 1)) net = 1399811149;
    if (net) return `${addrOriginal}:${net}`;
    if (isSolana) return addrOriginal; // bare base58 resolves server-side
    return null; // bare EVM address without a networkId — can't disambiguate chain
  }

  // (c) Bare symbol (BTC, ETH, …). If the registry says it has a coingeckoId,
  //     prefer that. Otherwise pass the symbol through.
  const upper = raw.toUpperCase();
  if (SYMBOL_TO_COINGECKO_ID?.[upper]) {
    return String(SYMBOL_TO_COINGECKO_ID[upper]).toLowerCase();
  }
  if (TOKEN_REGISTRY?.[upper]?.coingeckoId) {
    return String(TOKEN_REGISTRY[upper].coingeckoId).toLowerCase();
  }

  // (d) Last resort: pass the symbol verbatim. Hetzner's resolver does
  //     case-insensitive symbol matching, so this works for any well-known
  //     ticker the registry didn't know about.
  return upper;
}

/**
 * Adapt one Hetzner candle row to the `{t, o, h, l, c, v}` shape the rest of
 * the chart pipeline expects. Two source tables collapse here:
 *   - candles_1m         → numeric open/high/low/close/volume, ISO time
 *   - price_history_daily → numeric STRINGS (Postgres numeric type)
 * parseFloat handles both. Rows whose OHLC is non-finite or negative are
 * silently dropped (matches Codex tier's existing filter shape).
 */
function _adaptRow(row) {
  if (!row || row.time == null) return null;
  const t = Math.floor(new Date(row.time).getTime() / 1000);
  if (!Number.isFinite(t) || t <= 0) return null;
  const o = parseFloat(row.open);
  const h = parseFloat(row.high);
  const l = parseFloat(row.low);
  const c = parseFloat(row.close);
  const v = parseFloat(row.volume) || 0;
  if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return null;
  if (o < 0 || h < 0 || l < 0 || c < 0) return null;
  if (h > 1e12) return null;
  return { t, o, h, l, c, v };
}

/**
 * Fetch Hetzner candles for `asset` and return TradingView/Codex shaped bars.
 *
 *   symbol      whatever the chart handler had (symbol / address / cgId).
 *               We reverse-resolve internally.
 *   resolution  TradingView resolution string ('60', '240', '1D', '7D', ...).
 *   fromSec     unix seconds (inclusive lower bound).
 *   toSec       unix seconds (inclusive upper bound).
 *   opts.cgId   optional coingecko_id hint (skips registry lookup if set).
 *   opts.address optional explicit address hint.
 *   opts.networkId optional network id — enables the Candle Store
 *               address-native form (`address:networkId`) for tokens the
 *               static registry doesn't know.
 *
 * Returns `[{t, o, h, l, c, v}, ...]` sorted ascending by time, or `null` on:
 *   - Resolution outside Hetzner's supported set
 *   - Hetzner returns count=0 (asset not indexed)
 *   - HTTP error / timeout / network failure
 *   - Empty after adapt+filter
 *
 * Never throws. Always returns array-or-null so the caller can `bars ||`-chain
 * straight to the Codex tier.
 */
export async function fetchHetznerCandles(symbol, resolution, fromSec, toSec, opts = {}) {
  if (process.env.L4_PR5_DISABLE_HETZNER_BARS === '1') return null;
  if (fromSec == null || toSec == null || fromSec >= toSec) return null;

  const asset = resolveHetznerAsset(symbol, opts.cgId || null, opts.address || null, opts.networkId || null);
  if (!asset) return null;

  const interval = HETZNER_INTERVAL_MAP[resolution] || HETZNER_INTERVAL_MAP[String(resolution)] || null;
  if (!interval) return null;

  // Hetzner expects ISO timestamps for from/to. The route also accepts
  // raw date-strings (`new Date(input)` server-side), so any ISO format works.
  const fromIso = new Date(fromSec * 1000).toISOString();
  const toIso = new Date(toSec * 1000).toISOString();
  const url = `${SPECTRE_API_BASE}/v1/candles/${encodeURIComponent(asset)}?interval=${encodeURIComponent(interval)}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;

  const headers = { accept: 'application/json' };
  if (SPECTRE_API_KEY) headers['X-API-Key'] = SPECTRE_API_KEY;

  // Daily-tier intervals stitch deep history server-side (caggs +
  // price_history_daily prefix across hundreds of chunks). Post planner-fix
  // (data-api migration 120) cold p95 is ~3.3s — a 3s budget aborted exactly
  // the requests the store COULD serve and painted "Chart unavailable"
  // (MESSIER/SPECTRE 1W, 2026-06-10). Intraday stays tight: those paths are
  // cagg-indexed and answer in well under a second.
  // 10s → 6s (2026-06-10 RZ war): the serial tier cascade's worst case blew
  // past the TV client's 12s abort, rendering a silent blank pane. 6s still
  // clears the 3.3s cold p95 while leaving the downstream tiers (GT/Codex)
  // room to answer before the client gives up.
  const DAILY_TIER_TIMEOUT = new Set(['1d', '1w', '1M', '3M', '6M', '12M']);
  const timeoutMs = DAILY_TIER_TIMEOUT.has(interval) ? 6000 : 3000;

  try {
    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) {
      // 401 = key misconfigured; 4xx generally = bad asset (covered by null).
      // Log only the non-routine cases so we notice infra issues quickly.
      if (resp.status >= 500) {
        console.warn(`[L4-PR5-Hetzner] ${asset} ${interval}: HTTP ${resp.status}`);
      }
      return null;
    }
    const json = await resp.json();
    const rows = Array.isArray(json?.data) ? json.data : null;
    if (!rows || rows.length === 0) return null;

    // GUARD (2026-06-10): price_history_daily holds ONE snapshot per day
    // (open=high=low=close), so it can never represent an intraday interval.
    // The data-api no longer serves it below 1d, but guard here too so a
    // stale API build can't paint degenerate dash-charts — reject and let
    // the caller cascade to GT/Codex.
    const DAILY_SOURCE_OK = new Set(['1d', '1w', '1M', '3M', '6M', '12M']);
    if (!DAILY_SOURCE_OK.has(interval) && String(json?.meta?.source || '').includes('price_history_daily')) {
      return null;
    }

    const bars = rows.map(_adaptRow).filter(Boolean).sort((a, b) => a.t - b.t);
    if (bars.length === 0) return null;

    const RES_SECS = {
      '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '45m': 2700,
      '1h': 3600, '2h': 7200, '3h': 10800, '4h': 14400, '12h': 43200,
      '1d': 86400, '1w': 604800, '1M': 2678400, '12M': 31622400,
    };
    const resSec = RES_SECS[interval] || 3600;

    // COVERAGE GUARD (2026-06-10, extended same day): the store must cover
    // the request meaningfully or report a MISS so GT (server-side
    // gap-filled, continuous) serves it instead.
    //  - First-view tokens (backfill incomplete): the store holds only the
    //    1-2 bars worker-candle-live wrote since the view — fresh, but
    //    covering minutes of a multi-day request (PALM blank-chart bug).
    //  - Backfill-COMPLETE tokens too: a healed registry row can still hold
    //    sparse intraday (DSYNC 5M pre-rebuild served 30% coverage with
    //    compressed-axis gaps). Below 50% of expected buckets, GT's
    //    continuous series is strictly better. Dense CEX series (~100%
    //    coverage) ride through untouched.
    if (!DAILY_SOURCE_OK.has(interval)) {
      const spanRequested = toSec - fromSec;
      const spanCovered = bars[bars.length - 1].t - bars[0].t;
      const backfillStatus = json?.meta?.backfill_status || null;
      const incomplete = backfillStatus && backfillStatus !== 'complete';
      if (incomplete && (bars.length < 30 || spanCovered < spanRequested * 0.25)) {
        return null;
      }
      // 0.7 (raised from 0.5 same day): BGB served 92/168 hourly bars (55%)
      // from partial CEX ingestion while cg-ohlc had the full 168. Below
      // 70% the cascade's continuous sources are strictly better; dense
      // series (BTC ~100%, DSYNC 86%) ride through.
      const expected = Math.floor(spanRequested / resSec);
      if (!incomplete && expected >= 20 && bars.length < expected * 0.7) {
        return null;
      }
    }

    // HOTFIX 2026-06-03: freshness check. If the store's data for this
    // token is stale (latest bar older than ~5 resolution-intervals from
    // the requested `to`), fall through to GT/Codex for THIS request.
    // Candle Store note (2026-06-09): this very call bumped the token's
    // last_viewed_at, so worker-candle-live starts refreshing it within
    // ~20s — the staleness window self-heals on the next chart poll.
    // NOTE: latestT is the BUCKET START of the last bar, so wide buckets
    // (1M/12M) need their real width here or they'd always read as stale.
    const STALENESS_MULT = 5;
    const stalenessThreshold = resSec * STALENESS_MULT;
    const latestT = bars[bars.length - 1].t;
    const recentGap = toSec - latestT;
    if (recentGap > stalenessThreshold) {
      // Could be a stale STORE — or a thin token between trades (2026-06-10).
      // SPECTRE trades every few hours; at 1m the 5-bar threshold (5 min)
      // tripped on every genuine no-trade gap, permanently exiling thin
      // tokens to the sparse GeckoTerminal tier at low resolutions. Compare
      // the recent gap against the token's OWN trading cadence in this
      // window: if gaps this large are normal for the token, the store
      // isn't stale — serve the data. Dense tokens (BTC: 60s gaps) keep
      // the original tight threshold, so dead-ingestion detection survives.
      const tail = bars.slice(-50);
      let maxGap = 0;
      for (let i = 1; i < tail.length; i++) {
        const g = tail[i].t - tail[i - 1].t;
        if (g > maxGap) maxGap = g;
      }
      if (recentGap > Math.max(stalenessThreshold, maxGap * 2)) {
        // Genuinely stale — pretend we have nothing so the caller falls
        // through to GT/Codex.
        return null;
      }
    }
    return bars;
  } catch (e) {
    if (e?.name !== 'AbortError' && e?.name !== 'TimeoutError') {
      console.warn(`[L4-PR5-Hetzner] ${asset} ${interval}: ${e.message}`);
    }
    return null;
  }
}

export const __test__ = { _adaptRow, resolveHetznerAsset };
