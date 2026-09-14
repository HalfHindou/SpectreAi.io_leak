/**
 * Bars tier router (charts-v2, GROUP 1 / Charts S6).
 *
 * Extracts the inline tier cascade that /api/bars (handlers/bars.js) and the
 * TradingView UDF /history endpoint (handlers/tradingview-udf.js) each grew
 * independently into a SINGLE shared set of tier functions + one router.
 *
 * Tier function contract:
 *   (ctx) => Promise<payload | null>
 *     payload = { bars: [{t,o,h,l,c,v}], source: string, meta?: object }
 *     null    = this tier produced no usable data; the router cascades on.
 *
 * Each tier function owns its own KV read + upstream fetch + KV write (so the
 * cache key formats and TTLs stay byte-for-byte with the pre-refactor code).
 * The caller pairs the returned payload with `writeBarsPayload(res, payload)`
 * which sets the per-tier HTTP cache headers + X-Spectre-Tier.
 *
 * ── Router ─────────────────────────────────────────────────────────────────
 * `buildTierList(tokenClass, env)` returns the ORDERED list of tier names to
 * run for a token. It is only consulted when SMART_BARS_ROUTER==='1'. With the
 * flag OFF, handlers/bars.js keeps its exact legacy control flow (the tier
 * functions just execute inline in the historical order) — see that file.
 *
 * Token classes (see classifyTokenClass):
 *   ticker-binance   plain ticker (or addr/cgId reverse-mapped) WITH a Binance pair
 *   ticker-cg        plain ticker, no Binance pair, but a cgId
 *   ticker-bare      plain ticker, no pair, no cgId
 *   address-cg       contract address that IS CoinGecko-listed (has cgId)
 *   address-degen    contract address with no cgId (true degen)
 */

import { getJsonWithTTL, setJsonWithTTL } from './kv.js';
import { lookupBinancePair, fetchBinanceKlines } from './binance-bars.js';
import { fetchHetznerCandles } from './hetzner-bars.js';
import { fetchGeckoTerminalBars, clampOutlierBars } from './geckoterminal-bars.js';
import { fetchCgOhlcBars } from './cg-ohlc-bars.js';
import { getBudgetState } from './codex-budget.js';
import { refillInteriorHoles, holeRefillIntervalSec } from './bars-hole-fill.js';

// ── Token classification ────────────────────────────────────────────────────

/**
 * Classify a token for routing. `ctx` carries the parsed request state from the
 * bars handler (see makeCtx in handlers/bars.js).
 */
export function classifyTokenClass(ctx) {
  if (ctx.isPlainTicker) {
    if (ctx.binancePair) return 'ticker-binance';
    if (ctx.reqCgId) return 'ticker-cg';
    return 'ticker-bare';
  }
  // address form
  if (ctx.binancePair) return 'ticker-binance'; // addr/cgId reverse-mapped to a Binance major
  if (ctx.reqCgId) return 'address-cg';
  return 'address-degen';
}

/**
 * Ordered tier-name list for a token class under the smart router. Honors the
 * same disable flags the legacy path does so flipping a kill switch removes the
 * tier from EVERY list.
 *
 *   env.codexFirst      CODEX_FIRST_BARS!=='0' — DEFAULT ON (deliberate: Gleb 2026-07-30,
 *                       terminal chart speed; measured 543ms Codex vs 1.4s GT).
 *                       Caller gates to address tokens. Set CODEX_FIRST_BARS=0 to revert.
 *   env.proCodexOff     PRO_CODEX_DISABLED==='1'
 *   env.hetznerServe    HETZNER_BARS_SERVE==='1' && L4_PR5_DISABLE_HETZNER_BARS!=='1'
 *   env.gtOff           L4_PR8_DISABLE_GECKOTERMINAL==='1'
 *   env.degenCodexFirst DEGEN_CODEX_FIRST==='1' (revert degens to Codex-first;
 *                       default is GeckoTerminal-first → Codex last resort)
 */
export function buildTierList(tokenClass, env) {
  let list;
  switch (tokenClass) {
    case 'ticker-binance':
      // Binance owns it; cgOhlc is a clean fallback only when a cgId is known.
      list = ['binance', 'cgOhlc'];
      break;
    case 'ticker-cg':
      list = ['cgOhlc'];
      break;
    case 'ticker-bare':
      // No address-bound tier applies. Hetzner can still resolve bare symbols
      // case-insensitively from the candle store WHEN serving is enabled.
      list = ['hetzner'];
      break;
    case 'address-cg':
      // CG-listed DEX token: GeckoTerminal first (free, DEX-native), then CG's
      // paid OHLC, then Codex as the metered last resort.
      list = ['geckoterminal', 'cgOhlc', 'codex'];
      break;
    case 'address-degen':
    default:
      // True degen (no cgId): CG-family (GeckoTerminal — free, DEX-native)
      // FIRST, Codex as the metered last resort (founder preference,
      // 2026-06-12). GT-first strictly cuts Codex spend on degens; a GT miss
      // still falls through to Codex so coverage is unchanged. Set
      // DEGEN_CODEX_FIRST=1 to revert to the old Codex-first reliability order
      // with no redeploy if GT data quality on the thinnest tokens disappoints.
      list = env.degenCodexFirst ? ['codex', 'geckoterminal'] : ['geckoterminal', 'codex'];
      break;
  }

  // CODEX_FIRST_BARS override for address tokens: Codex first, GT fallback.
  // NOTE (deliberate improvement): the legacy codexFirst path had NO fallback —
  // a Codex miss returned an empty chart. Giving the override a GT fallback here
  // re-earns coverage for thin tokens Codex can't serve, at zero extra Codex
  // cost (GT is free). Majors are unaffected (Binance owns them above).
  if (env.codexFirst && (tokenClass === 'address-cg' || tokenClass === 'address-degen')) {
    list = ['codex', 'geckoterminal'];
  }

  // Apply kill switches / disable flags — remove the tier from the list.
  if (env.proCodexOff) list = list.filter((t) => t !== 'codex');
  if (env.gtOff) list = list.filter((t) => t !== 'geckoterminal');
  // Hetzner only ever SERVES when explicitly enabled (background-only by
  // default — see warmHetznerStore). It only appears in the ticker-bare list.
  if (!env.hetznerServe) list = list.filter((t) => t !== 'hetzner');

  return list;
}

// ── Tier functions (row-shaped payloads for /api/bars) ──────────────────────
//
// Each returns { bars, source, meta? } | null. KV read + fetch + KV write live
// inside the tier so the cache contract matches the pre-refactor inline blocks.

export async function tryBinance(ctx) {
  if (!ctx.binancePair) return null;
  const kvKey = `codex:bars:${ctx.tokenSymbol}:${ctx.requestedRes}:${ctx.fromBucket}:${ctx.bucket}:binance`;
  try {
    const cached = await getJsonWithTTL(kvKey);
    if (cached?.bars?.length > 0) return cached;
  } catch { /* best-effort */ }
  try {
    const klines = await fetchBinanceKlines(ctx.binancePair, ctx.requestedRes, ctx.fromSec, ctx.toSec);
    if (klines?.length > 0) {
      const bars = klines.slice().sort((a, b) => a.t - b.t);
      const payload = { bars, source: 'binance' };
      try { await setJsonWithTTL(kvKey, payload, ctx.freeTierTtl); } catch { /* best-effort */ }
      return payload;
    }
    console.log(`[L4-PR4-Binance] ${ctx.symbol} -> ${ctx.binancePair}: empty/null, falling back`);
  } catch (e) {
    console.warn(`[L4-PR4-Binance] ${ctx.symbol} -> ${ctx.binancePair}: ${e.message}, falling back`);
  }
  return null;
}

export async function tryHetzner(ctx) {
  // Resolves bare tickers case-insensitively from the candle store as well as
  // address tokens. Caller decides whether this tier runs (HETZNER_BARS_SERVE).
  const kvKey = `codex:bars:${ctx.tokenSymbol}:${ctx.requestedRes}:${ctx.fromBucket}:${ctx.bucket}:hetzner`;
  try {
    const cached = await getJsonWithTTL(kvKey);
    if (cached?.bars?.length > 0) return cached;
  } catch { /* best-effort */ }
  try {
    const hetznerBars = await fetchHetznerCandles(
      ctx.symbol,
      ctx.requestedRes,
      ctx.fromSec,
      ctx.toSec,
      { cgId: ctx.reqCgId, address: ctx.address, networkId: ctx.networkId },
    );
    if (hetznerBars?.length > 0) {
      const bars = hetznerBars.slice().sort((a, b) => a.t - b.t);
      const payload = { bars, source: 'hetzner' };
      try { await setJsonWithTTL(kvKey, payload, ctx.freeTierTtl); } catch { /* best-effort */ }
      return payload;
    }
  } catch (e) {
    console.warn(`[L4-PR5-Hetzner] ${ctx.symbol} ${ctx.requestedRes}: ${e.message}, falling back`);
  }
  return null;
}

export async function tryGeckoTerminal(ctx) {
  if (ctx.isPlainTicker) return null; // address-bound tier
  // The ':nohead' suffix keeps the two callers apart: research and the terminal
  // share this KV store, and they want DIFFERENT payloads for the same window
  // (see skipCgHeadStitch below). Without it whichever app asked first served
  // its shape to the other for the whole TTL.
  const kvKey = `codex:bars:${ctx.tokenSymbol}:${ctx.requestedRes}:${ctx.fromBucket}:${ctx.bucket}:geckoterminal${ctx.skipCgHeadStitch ? ':nohead' : ''}`;
  try {
    const cached = await getJsonWithTTL(kvKey);
    if (cached?.bars?.length > 0) return cached;
  } catch { /* best-effort */ }
  try {
    const gtBars = await fetchGeckoTerminalBars(
      ctx.symbol,
      ctx.networkId,
      ctx.isWeekly ? '1D' : ctx.requestedRes,
      ctx.fromSec,
      ctx.toSec,
      { cgId: ctx.reqCgId, address: ctx.address },
    );
    if (gtBars?.length > 0) {
      let bars = gtBars.slice().sort((a, b) => a.t - b.t);

      // Head-stitch (2026-06-11, PALM 1D hole repro): GT's history for a
      // token can START long after the requested window head (PALM day data
      // begins ~Sep 2025; the chart asked from Aug 2025 and deeper). A
      // partial answer used to be returned as if complete - TradingView
      // cached the uncovered head subrange as "no data" and rendered a
      // months-long hole between GT's tail and older cg-ohlc history. When
      // the token is CG-listed and GT left a material head shortfall, fill
      // [fromSec, gtOldest) from CG's OHLC and stitch.
      // Gate to daily/weekly only (2026-06-14). The genesis-history hole the
      // stitch fixes is a LONG-history artifact (PALM 1D / SPECTRE 1W). On
      // intraday (12H and below) the visible window is recent and GT covers
      // it - a stitch there only backfills OFF-SCREEN genesis bars via an
      // extra serial CG /ohlc round-trip (8s budget), which made cold intraday
      // timeframe switches slow once address->cgId resolution started
      // populating reqCgId (ce62a136/a32828b0).
      // NOT ON THE TERMINAL'S CODEX-ONLY PATH (2026-08-11, ctx.skipCgHeadStitch).
      // The hole this stitch closes is a MULTI-SOURCE artifact: research runs
      // GT and then cg-ohlc, so a GT answer that starts late leaves a gap
      // against the OLDER cg-ohlc history behind it. The trading terminal's
      // src=codex path has no cg-ohlc tier at all (codex -> binance -> GT), so
      // there is nothing to leave a gap against - the stitch only prepends
      // PRE-POOL history there. On PALM that put the chart's first candle at
      // 2023-11-23 (CoinGecko has tracked the token since 2023-11-22, from a
      // pool that no longer exists) while the live Uniswap pool was created
      // 2023-12-19 02:07 UTC - so the terminal disagreed with DexScreener by a
      // month. The terminal shows the pool's own candles; research keeps the
      // stitch and its multi-source depth.
      const headShortfallSec = bars[0].t - ctx.fromSec;
      const _isDailyOrWeekly = ctx.isWeekly || ctx.requestedRes === '1D' || ctx.requestedRes === 'D';
      let stitched = false;
      if (ctx.reqCgId && !ctx.skipCgHeadStitch && _isDailyOrWeekly && headShortfallSec > 3 * ctx.bucketSec) {
        try {
          const headBars = await fetchCgOhlcBars(
            ctx.reqCgId,
            ctx.isWeekly ? '1D' : ctx.requestedRes,
            ctx.fromSec,
            bars[0].t - 1,
          );
          if (headBars?.length > 0) {
            const cutoff = bars[0].t;
            const head = headBars.filter((b) => b.t < cutoff);
            if (head.length > 0) {
              bars = head.concat(bars);
              stitched = true;
            }
          }
        } catch (e) {
          console.warn(`[L4-PR8-GT] head-stitch ${ctx.reqCgId} ${ctx.requestedRes}: ${e.message}`);
        }
      }

      if (ctx.isWeekly) bars = ctx.aggregateWeekly(bars);
      const realBars = bars.filter((b) => b.v > 0 || b.h !== b.l).length;
      const payload = {
        bars,
        // source stays 'geckoterminal' - the tier-header map and the health
        // contract key off it; stitching is additive meta.
        source: 'geckoterminal',
        meta: {
          gapFilled: true,
          realBarRatio: +(realBars / bars.length).toFixed(3),
          ...(stitched ? { headStitched: true } : {}),
        },
      };
      try { await setJsonWithTTL(kvKey, payload, ctx.freeTierTtl); } catch { /* best-effort */ }
      return payload;
    }
  } catch (e) {
    console.warn(`[L4-PR8-GT] ${ctx.symbol} ${ctx.requestedRes}: ${e.message}, falling back`);
  }
  return null;
}

export async function tryCgOhlc(ctx) {
  if (!ctx.reqCgId) return null;
  const kvKey = `codex:bars:${ctx.tokenSymbol}:${ctx.requestedRes}:${ctx.fromBucket}:${ctx.bucket}:cgohlc`;
  try {
    const cached = await getJsonWithTTL(kvKey);
    if (cached?.bars?.length > 0) return cached;
  } catch { /* best-effort */ }
  try {
    const bars = await fetchCgOhlcBars(ctx.reqCgId, ctx.requestedRes, ctx.fromSec, ctx.toSec);
    if (bars?.length > 0) {
      // Volume contract (2026-06-11, amended 06-12): daily/weekly bars now
      // carry stitched market_chart volumes; intraday stays v:0 (CG /ohlc has
      // none and rolling-24h can't honestly slice into hours). Flag from data.
      const payload = { bars, source: 'cg-ohlc', meta: { volumeAvailable: bars.some((b) => b.v > 0) } };
      try { await setJsonWithTTL(kvKey, payload, ctx.freeTierTtl); } catch { /* best-effort */ }
      return payload;
    }
  } catch (e) {
    console.warn(`[cg-ohlc] ${ctx.reqCgId} ${ctx.requestedRes}: ${e.message}`);
  }
  return null;
}

// ── Codex tier (row-shaped) — budget-guarded + stale-mirror ─────────────────
//
// Stale mirror key (no time bucket) doubles as stale-if-error:
//   codex:bars:stale:<tokenSymbol>:<requestedRes>
// Written on EVERY successful Codex build (ok/soft) with a 7-day TTL, read when
// the budget is hard OR a fresh Codex fetch errors.
export const STALE_TTL_SEC = 7 * 24 * 60 * 60;
// ANSWER-SHAPE FLOOR (2026-08-11). The wide-only write guard below checks the
// shape of the REQUEST (wide + live) and trusted the ANSWER blindly - so a wide
// probe that came back degenerate (Codex handing back a 1-35 bar slice) was
// stored as "the chart" for 7 days. Measured on prod: the PAAL 1D mirror held
// ONE bar. Once seeded that way the mirror is what every budget-hard /
// Codex-error request serves, which is exactly the giant-candle + truncated-
// history class the 2026-08-05 wide-only fix was meant to end. A live wide
// probe is ~500 bars by construction (countback 500), so anything under this
// floor is junk: never seed the mirror with it, never serve it as the chart.
// (A union that GROWS a healthy mirror still passes - only the seed is gated.)
export const MIRROR_MIN_BARS = 100;
function isChartShaped(bars) {
  return Array.isArray(bars) && bars.length >= MIRROR_MIN_BARS;
}
// Stale mirror key (no time bucket). Shared by /api/bars and the UDF handler so
// both read/write the SAME stale-if-error mirror for a token+resolution.
export function staleMirrorKey(tokenSymbol, requestedRes) {
  return `codex:bars:stale:${tokenSymbol}:${requestedRes}`;
}

// MIRROR UNION (2026-08-05). Under concurrent load Codex answers the SAME wide
// getTokenBars query with inconsistent slices — measured live on TOSHI 1m: ten
// near-simultaneous identical wide requests returned n=250..500 spanning 0.7 to
// 24 days, i.e. slices with whole chunks missing, while the solo request is
// stable and dense. Served raw, such a slice paints holes into the chart
// ("разрыв баров") and a truncated one falsely reads as a fresh token's whole
// life. The stale mirror already holds the last good wide build, so the fresh
// bars are UNIONED over it per-timestamp (fresh wins on collision): a degraded
// slice can only ADD bars on top of the dense mirror, never punch holes, and
// the mirror itself gets progressively denser (self-healing) — zero extra
// Codex spend. Capped so repeated rewrites can't snowball the payload.
// SEAM GUARD (2026-08-06, ARK 1m/15m "разрыв баров" on prod). The union's
// premise ("mirror can only densify") breaks when the token wasn't opened at
// this resolution for longer than one wide window: the 7-day mirror then holds
// a DISJOINT old island, and unioning it with the fresh live window stitches
// island + multi-day hole + fresh — and the write-back below persisted that
// hole into the mirror itself. Measured live: ARK 1m served 500 bars of Jul 30
// + a 153h hole + 500 bars of Aug 5-6 as one payload. So mirror bars OLDER
// than the fresh window join only while CONTIGUOUS with it — walking back from
// fresh's first bar, a gap wider than seamGapSec is a different era and
// everything before it is dropped. Mirror bars inside fresh's span always join
// (pure hole-fill); fresh bars are never dropped. Same guard family as the
// client's era-cliff check (rz-chart-audit step 6).
const UNION_MAX_BARS = 3000;
export function unionBars(baseBars, freshBars, { seamGapSec = 0 } = {}) {
  let base = baseBars;
  const freshTs = freshBars.filter((b) => b && Number.isFinite(b.t)).map((b) => b.t);
  if (seamGapSec > 0 && freshTs.length > 0) {
    const freshFirst = Math.min(...freshTs);
    const older = baseBars
      .filter((b) => b && Number.isFinite(b.t) && b.t < freshFirst)
      .sort((a, b) => b.t - a.t); // newest-first, walk backward from the seam
    const kept = [];
    let prevT = freshFirst;
    for (const b of older) {
      if (prevT - b.t > seamGapSec) break; // era gap — drop this and everything older
      kept.push(b);
      prevT = b.t;
    }
    base = [...kept, ...baseBars.filter((b) => b && Number.isFinite(b.t) && b.t >= freshFirst)];
  }
  const byT = new Map();
  for (const b of base) if (b && Number.isFinite(b.t)) byT.set(b.t, b);
  for (const b of freshBars) if (b && Number.isFinite(b.t)) byT.set(b.t, b);
  const out = [...byT.values()].sort((a, b) => a.t - b.t);
  return out.length > UNION_MAX_BARS ? out.slice(-UNION_MAX_BARS) : out;
}

// Resolution string -> bar interval seconds (for the seam threshold; the ctx's
// bucketSec is the CACHE bucket, not the bar interval).
const SEAM_GAP_BUCKETS = 50;
function resIntervalSec(requestedRes) {
  const r = String(requestedRes || '').toUpperCase();
  if (r === '1D' || r === 'D') return 86400;
  if (r === '1W' || r === 'W') return 604800;
  const m = parseInt(r, 10);
  return Number.isFinite(m) && m > 0 ? m * 60 : 3600;
}

// Warn at most once per lambda per minute when in soft mode.
let _lastSoftWarn = 0;
function _maybeWarnSoft(count) {
  const now = Date.now();
  if (now - _lastSoftWarn > 60_000) {
    _lastSoftWarn = now;
    console.warn(`[codex-budget] SOFT: daily Codex count=${count} >= soft threshold; degrading sub-5m freshness`);
  }
}

/**
 * Codex bars tier. Returns { bars, source:'codex' } | null and also surfaces
 * budget side-effects via ctx.budget (set here) so the response writer can emit
 * the X-Spectre-Budget header. Honors the per-lambda in-flight dedup map passed
 * in ctx.inflight.
 *
 * The token's getTokenBars query is built by ctx.buildCodex() (handler-owned so
 * the wide-probe / countback shaping stays in one place).
 */
export async function tryCodex(ctx) {
  const budget = await getBudgetState();
  ctx.budget = budget.state; // 'ok' | 'soft' | 'hard' — writer emits header

  const kvKey = ctx.codexKvKey;
  const staleKey = staleMirrorKey(ctx.tokenSymbol, ctx.requestedRes);

  // 1. Fresh KV read (every state serves a warm bucket entry if present).
  try {
    const cached = await getJsonWithTTL(kvKey);
    if (cached?.bars?.length > 0) return cached;
  } catch { /* best-effort */ }

  // 2. HARD: cache-only + stale-if-error. No fresh getBars spend.
  // Mirror is WIDE-SHAPED (see the write guard below), so it only answers
  // wide-probe requests - serving it for an explicit older window would hand
  // recent bars to a scroll-back page. Non-wide asks return failed:true (we
  // didn't check upstream; this is NOT evidence the window is empty), so the
  // writer emits tier 'error' and the chart never latches genesis on it.
  if (budget.state === 'hard') {
    if (ctx.wideProbe) {
      try {
        const stale = await getJsonWithTTL(staleKey);
        // isChartShaped: a degenerate mirror (see MIRROR_MIN_BARS) must never be
        // served AS the chart - a handful of bars fills the pane with giant
        // candles and latches first-window genesis. failed:true instead, which
        // clients treat as transient.
        if (isChartShaped(stale?.bars)) return { ...stale, source: 'codex', meta: { ...(stale.meta || {}), stale: true } };
      } catch { /* best-effort */ }
    }
    return { bars: [], failed: true }; // budget-exhausted, not no-data
  }

  // 3. SOFT: warn + stretch TTL for sub-5-min resolutions (degrade freshness).
  let codexTtl = ctx.codexTierTtl;
  if (budget.state === 'soft') {
    _maybeWarnSoft(budget.count);
    if (ctx.isSubFiveMin) codexTtl = Math.max(codexTtl, 300);
  }

  // 4. In-flight dedup + build + KV write (+ stale mirror).
  const pending = ctx.inflight.get(kvKey);
  if (pending) return pending;

  const p = (async () => {
    try {
      const payload = await ctx.buildCodex();
      // DEX anomaly clamp (charts-system E1): same guard as the GT pages -
      // Codex getTokenBars keeps wash-trade prints as bar highs/lows too.
      if (payload?.bars?.length > 0) payload.bars = clampOutlierBars(payload.bars);
      // BINANCE HEAD-STITCH (2026-08-11, the BONK wall). The trading terminal is
      // Codex-only by design, but Codex indexes a token from ITS pool's first
      // trade - BONK starts 2024-03-20 there while Binance has BONKUSDT from
      // 2023-12-15. The chart therefore walled ~3 months early and left an empty
      // pane where history exists ("разрыв" slева, founder screenshot). Mirrors
      // the GT head-stitch above: when the token has a Binance pair and Codex
      // left a material head shortfall, backfill [fromSec, codexOldest) from
      // Binance (free) and prepend. Codex bars are never overwritten - the head
      // is strictly older - and a token without a pair, or one whose Codex
      // history already covers the ask, pays nothing.
      if (ctx.binancePair && payload?.bars?.length > 0 && Number.isFinite(ctx.fromSec)) {
        const iv = resIntervalSec(ctx.requestedRes);
        const codexOldest = payload.bars[0].t;
        if (codexOldest - ctx.fromSec > 3 * iv) {
          try {
            const head = await fetchBinanceKlines(ctx.binancePair, ctx.requestedRes, ctx.fromSec, codexOldest - 1);
            const older = (head || []).filter((b) => b && Number.isFinite(b.t) && b.t < codexOldest);
            if (older.length > 0) {
              payload.bars = older.sort((a, b) => a.t - b.t).concat(payload.bars);
              payload.meta = { ...(payload.meta || {}), headStitched: 'binance' };
            }
          } catch (e) {
            console.warn(`[bars] binance head-stitch ${ctx.binancePair} ${ctx.requestedRes}: ${e.message}`);
          }
        }
      }
      // Mirror union (see unionBars above): live-edge wide probes only — the
      // exact shape the mirror holds. An OLD-window wide page must never be
      // unioned (it would hand recent bars to a scroll-back request, the
      // poisoning class the 2026-08-05 wide-only mirror fix killed).
      const _nowSec = Math.floor(Date.now() / 1000);
      const _isLiveWide = ctx.wideProbe && _nowSec - ctx.toSec < 2 * (ctx.bucketSec || 3600);
      if (_isLiveWide && payload?.bars?.length > 0) {
        try {
          const mirror = await getJsonWithTTL(staleKey);
          if (mirror?.bars?.length > 0) {
            payload.bars = unionBars(mirror.bars, payload.bars, {
              seamGapSec: SEAM_GAP_BUCKETS * resIntervalSec(ctx.requestedRes),
            });
          }
        } catch { /* best-effort */ }
      }
      // INTERIOR-HOLE REFILL (2026-08-20, WENFROG). Codex sometimes serves a
      // live wide answer with a multi-hour interior hole (ingestion outage /
      // fresh-token backfill lag / degraded slice under concurrent load -
      // measured on TOSHI: wide slices degrade while a SOLO narrow re-query of
      // the same window is stable and dense). Instead of shipping the hole to
      // every client, re-ask Codex for JUST the hole window and merge. Runs
      // only on live wide probes with an OUTAGE-SHAPED hole (dense borders -
      // thin tokens' natural quiet periods never match), only in the 'ok'
      // budget state (under 'soft' the refill is the first spend to go),
      // ≤2 probes/request, every probe stamped in KV before its fetch (120s)
      // so errors/timeouts/frozen lambdas can't loop at build cadence, empty
      // answers negative-cached 10 min, total probe budget 2.5s (on timeout
      // the answer ships as-is; the client's gap-heal retry picks it up
      // later). Additive by construction - existing bars are never removed or
      // rewritten; fills pass the same clampOutlierBars as every other Codex
      // bar. holeRefillIntervalSec allowlists real bar intervals only, which
      // also excludes 1S (5s build cadence) and the 1W/1M aggregates (raw
      // daily fills would corrupt an aggregated series). Kill switch:
      // BARS_HOLE_REFILL=0 disables (default ON). The healed BARS ride the
      // KV + mirror writes below so degraded serves densify too, but the
      // holeRefilled/holesOpen meta is applied AFTER those writes - it
      // describes THIS request's work, not the cached copy's.
      const _holeIv = holeRefillIntervalSec(ctx.requestedRes);
      let _holeMeta = null;
      if (
        process.env.BARS_HOLE_REFILL !== '0' &&
        _isLiveWide && _holeIv && budget.state === 'ok' &&
        payload?.bars?.length > 0 &&
        typeof ctx.fetchCodexWindow === 'function'
      ) {
        try {
          const healed = await refillInteriorHoles(payload.bars, {
            intervalSec: _holeIv,
            fetchWindow: ctx.fetchCodexWindow,
            kvGet: getJsonWithTTL,
            kvSet: setJsonWithTTL,
            keyPrefix: `codex:holeprobe:${ctx.tokenSymbol}:${ctx.requestedRes}`,
            maxBars: UNION_MAX_BARS,
          });
          if (healed.filled > 0) {
            payload.bars = clampOutlierBars(healed.bars);
            _holeMeta = { holeRefilled: healed.filled };
            console.warn(`[bars] hole-refill ${ctx.tokenSymbol} ${ctx.requestedRes}: +${healed.filled} bars`);
          } else if (healed.holesOpen > 0) {
            _holeMeta = { holesOpen: healed.holesOpen };
          }
        } catch (e) {
          console.warn(`[bars] hole-refill ${ctx.tokenSymbol} ${ctx.requestedRes}: ${e.message}`);
        }
      }
      if (payload?.bars?.length > 0) {
        try { await setJsonWithTTL(kvKey, payload, codexTtl); } catch { /* best-effort */ }
        // Stale mirror (best-effort): doubles as stale-if-error for ordinary
        // Codex blips, not just budget-hard. WRITE GUARD (2026-06-11 audit):
        // the mirror key is window-agnostic, so a deep scroll-back build
        // (to = months ago) used to overwrite it and degraded modes then
        // served months-old bars as "the chart". Only mirror live windows.
        // WIDE-ONLY (2026-08-05): the live-window recency check alone was not
        // enough - the chart's 60s live poll + tail revalidations are NARROW
        // live windows (from = last bar, 1-3 bars), and each success was
        // overwriting the mirror with those few bars for 7 days. The next
        // Codex blip then served 1-3 bars as the whole chart: TV fit them to
        // the full pane (the giant-candle screenshots) and latched
        // first-window genesis. Only a wide probe is "the chart" shape.
        // (The mirror write stores the UNIONED payload - each rewrite can only
        // keep or grow density, so a degraded build can no longer thin it.)
        // ANSWER-SHAPE FLOOR (2026-08-11): plus the payload must LOOK like a
        // chart. A wide request whose answer came back degenerate is not the
        // chart, however wide the ask was - see MIRROR_MIN_BARS.
        if (_isLiveWide && isChartShaped(payload.bars)) {
          try { await setJsonWithTTL(staleKey, payload, STALE_TTL_SEC); } catch { /* best-effort */ }
        }
        // Request-local refill diagnostics - applied AFTER the KV/mirror
        // writes above so cached/stale serves don't report work they didn't do.
        if (_holeMeta) payload.meta = { ...(payload.meta || {}), ..._holeMeta };
        return payload;
      }
      return payload || { bars: [] };
    } catch (e) {
      // stale-if-error: on a Codex fetch ERROR (not budget), serve the mirror -
      // wide probes only (the mirror is wide-shaped; an explicit older window
      // must not receive recent bars). Unusable mirror -> failed:true so the
      // response reads tier 'error', never 'no_data': a timeout is not genesis,
      // and the chart's persistent genesis floor must not latch on it.
      console.warn(`[bars] Codex build failed: ${e.message}`);
      if (ctx.wideProbe) {
        try {
          const stale = await getJsonWithTTL(staleKey);
          if (isChartShaped(stale?.bars)) return { ...stale, source: 'codex', meta: { ...(stale.meta || {}), stale: true } };
        } catch { /* best-effort */ }
      }
      return { bars: [], failed: true };
    }
  })().finally(() => ctx.inflight.delete(kvKey));

  ctx.inflight.set(kvKey, p);
  return p;
}

// ── Hetzner background warm-ping ─────────────────────────────────────────────
//
// When Hetzner serving is OFF, we still fire a non-awaited ping for ADDRESS
// tokens so the candle store keeps auto-registering, permanently backfilling,
// and tracking freshness. The store stays the deep-history DB and re-earns
// serving via the health sweeper. (9/12 recent chart incidents were
// store-serving issues — keep ingestion alive, decouple it from the read path.)
// ── Warm gating (2026-08-13, the ingestion-key incident) ─────────────────────
//
// A warm ping is NOT free even though our side fire-and-forgets it: the box
// AUTO-REGISTERS any unknown address in chart_assets and queues a PERMANENT
// backfill with a Codex fallback on ITS key (see hetzner-bars.js header,
// "CANDLE STORE UPGRADE 2026-06-09"), and worker-candle-live then keeps
// recently-viewed tokens fresh. One casual chart click used to buy the box a
// lifetime subscription; the Aug-12 lite lane switching bars requests from
// symbols to contracts opened that firehose (dashboard: getBars 566K/day on
// spectre-prod-ingestion — a query OUR repo never issues).
//
// Policy: SUSTAINED interest only, at a bounded rate.
//   - The first sighting of an address only RECORDS it (KV, 24h). The box is
//     never pinged for a one-off view.
//   - A warm fires only when interest for the address spans longer than the
//     view window (chart still open past 10 min — its poll re-enters here) or
//     recurs within 24h (return visit, another user, trending keep-warm).
//   - At most one warm per address per 6h platform-wide, so the trading
//     keep-warm walking 12-20 trending tokens every ~4 min stops re-pinging.
//   - Per-instance daily cap as the KV-down backstop. Degraded mode warms
//     LESS, never more — warming is an optimization, silence is safe.
// Env-tunable so the ceilings can move without a deploy.
const WARM_VIEW_WINDOW_MS = Math.max(1, Number(process.env.HZ_WARM_VIEW_WINDOW_MS) || 10 * 60_000);
const WARM_RESEND_TTL_SEC = Math.max(1, Number(process.env.HZ_WARM_RESEND_TTL_SEC) || 6 * 3600);
const WARM_SEEN_TTL_SEC = Math.max(1, Number(process.env.HZ_WARM_SEEN_TTL_SEC) || 24 * 3600);
const WARM_DAILY_CAP = Math.max(1, Number(process.env.HZ_WARM_DAILY_CAP) || 300);
const WARM_MEMO_MAX = 5000;

const _warmMemo = new Map(); // addr:networkId -> { seenAt, sentAt }
let _warmDay = '';
let _warmSentToday = 0;

function _warmMemoSet(key, v) {
  if (_warmMemo.size >= WARM_MEMO_MAX) {
    for (const k of _warmMemo.keys()) { _warmMemo.delete(k); if (_warmMemo.size < WARM_MEMO_MAX * 0.9) break; }
  }
  _warmMemo.set(key, v);
}

export function warmHetznerStore(ctx) {
  if (ctx.isPlainTicker || !ctx.address) return;
  if (process.env.L4_PR5_DISABLE_HETZNER_BARS === '1') return;
  // Returns the promise so tests can await the gate; call sites ignore it.
  return _gatedWarm(ctx).catch(() => {});
}

async function _gatedWarm(ctx) {
  const key = `${String(ctx.address).toLowerCase()}:${ctx.networkId ?? ''}`;
  const now = Date.now();

  // In-instance memo first — zero KV traffic for the hot re-entry paths
  // (chart polls, the keep-warm loops) within one warm lambda.
  const m = _warmMemo.get(key);
  if (m?.sentAt && now - m.sentAt < WARM_RESEND_TTL_SEC * 1000) return;
  if (m?.seenAt && !m.sentAt && now - m.seenAt < WARM_VIEW_WINDOW_MS) return;

  const day = new Date().toISOString().slice(0, 10);
  if (day !== _warmDay) { _warmDay = day; _warmSentToday = 0; }
  if (_warmSentToday >= WARM_DAILY_CAP) return;

  // Cross-instance state. A KV blip degrades to memo+cap gating — never to
  // the ungated firehose this block exists to prevent.
  let firstSeenAt = m?.seenAt ?? null;
  try {
    const rec = await getJsonWithTTL(`hz:warm:v1:${key}`);
    if (rec && typeof rec === 'object') {
      if (rec.sentAt && now - rec.sentAt < WARM_RESEND_TTL_SEC * 1000) {
        _warmMemoSet(key, { seenAt: rec.seenAt || rec.sentAt, sentAt: rec.sentAt });
        return;
      }
      if (rec.seenAt) firstSeenAt = rec.seenAt;
    }
  } catch { /* KV read blip */ }

  if (!firstSeenAt) {
    _warmMemoSet(key, { seenAt: now });
    try { await setJsonWithTTL(`hz:warm:v1:${key}`, { seenAt: now }, WARM_SEEN_TTL_SEC); } catch { /* best-effort */ }
    return;
  }
  if (now - firstSeenAt < WARM_VIEW_WINDOW_MS) {
    _warmMemoSet(key, { seenAt: firstSeenAt });
    return;
  }

  // Sustained interest — warm, and stamp both stores so nobody re-warms
  // this address for the resend TTL.
  _warmSentToday += 1;
  _warmMemoSet(key, { seenAt: firstSeenAt, sentAt: now });
  try { await setJsonWithTTL(`hz:warm:v1:${key}`, { seenAt: firstSeenAt, sentAt: now }, WARM_SEEN_TTL_SEC); } catch { /* best-effort */ }
  await fetchHetznerCandles(
    ctx.symbol,
    ctx.requestedRes,
    ctx.fromSec,
    ctx.toSec,
    { cgId: ctx.reqCgId, address: ctx.address, networkId: ctx.networkId },
  ).catch(() => {});
}

// ── Response writer ─────────────────────────────────────────────────────────
//
// Single writer that reproduces the per-tier HTTP cache headers + X-Spectre-Tier
// EXACTLY as the pre-refactor inline blocks set them, plus the budget header
// when the Codex tier ran. `tier` is payload.source.
const SOURCE_TO_TIER = {
  binance: 'binance',
  hetzner: 'hetzner',
  geckoterminal: 'geckoterminal',
  'cg-ohlc': 'cg-ohlc',
  codex: 'codex',
};

// Kill single-bar glitch spikes from low-liquidity DEX feeds (Codex returns the
// occasional bar at a totally wrong price - e.g. a BTC-priced 116162 bar inside
// a $1572 token, or a near-zero 1.3e-9 print). A lone bar wildly off wrecks the
// chart's price scale = "broken chart". We replace only the glitched bar with a
// flat bar at the last good close; normal price action passes through untouched.
//
// NEIGHBOUR-RELATIVE (2026-07-04): the old check compared each bar to the GLOBAL
// series median, which mis-flagged the tails of a legitimate parabolic run as
// glitches. $ANSEM ran ~480x in a week (entry ~$0.0007 -> $0.34): global median
// ~$0.132, so every real early-run bar below $0.132/25 = $0.0053 got clamped up
// and the chart's whole 480x base was flattened. A true glitch is a lone bar
// discontinuous from its NEIGHBOURS, not one far from the global median — a
// smooth trend tracks its own neighbours and must survive. Same philosophy as
// clampOutlierBars() for GT bars. Defensive: any error returns input.
//
// CONTINUATION TEST (2026-08-12): the band alone CANNOT tell a wrong-price
// print from a real violent move - in price space they are identical, which is
// why every previous pass had to carve out another token class (launch candles
// 2026-07-10, parabolic runs 2026-07-04, NIGGABULL genesis). Measured failure:
// KUNGFU (vVzBpN7...pump) rugged 36x inside one 5m bucket on 29.3K volume; the
// band flagged that bar and flattened it to o=h=l=c=<pre-crash close>, i.e. the
// one candle carrying the entire collapse was replaced by a dash, leaving the
// chart with an unbridgeable cliff. That IS the "broken bars" report.
//
// The discriminator is not distance, it is whether THE SERIES FOLLOWS THE BAR.
// A wrong-price print is an ISLAND - the next bar's real traded range ignores
// it and the series carries on at the old level. A real move CHAINS - the next
// bar trades at the new level. So an out-of-band bar is kept when its close
// sits inside the NEXT bar's traded range (generous 25x tolerance), and only
// flattened when nothing downstream corroborates it. Codex synthesizes each
// open = prev close, so open/close equality is uninformative - the next bar's
// l/h is the only honest witness. This subsumes the launch-candle exemption
// (a launch bar chains into the pump) and every other carve-out.
export function sanitizeBars(bars) {
  try {
    if (!Array.isArray(bars) || bars.length < 5) return bars;
    // Local (neighbour) median close over +-4 bars, excluding self — tracks the
    // trend so parabolic runs pass while a lone spike stands out against it.
    const localMed = (i) => {
      const win = [];
      for (let j = Math.max(0, i - 4); j <= Math.min(bars.length - 1, i + 4); j++) {
        if (j === i) continue;
        const c = Number(bars[j].c);
        if (Number.isFinite(c) && c > 0) win.push(c);
      }
      if (win.length < 3) return null;
      win.sort((a, b) => a - b);
      return win[Math.floor(win.length / 2)];
    };
    let lastGood = null, fixed = 0;
    const out = bars.map((b, i) => {
      const med = localMed(i);
      const c0 = Number(b.c);
      if (!(med > 0)) { if (Number.isFinite(c0) && c0 > 0) lastGood = c0; return b; }
      const HI = med * 25, LO = med / 25;
      const vals = [b.o, b.h, b.l, b.c].map(Number);
      const bad = vals.some(n => Number.isFinite(n) && n > 0 && (n > HI || n < LO));
      if (!bad) { if (Number.isFinite(c0) && c0 > 0) lastGood = c0; return b; }
      if (Number.isFinite(c0) && c0 > 0) {
        // Does the series FOLLOW this bar? A genuine wrong-price print
        // (BTC-priced bar, 1e-9 junk) lands far outside anything the next bar
        // actually traded at; a real move - rug, squeeze, launch pump - chains
        // into it. This also covers the launch-era case the i<2 exemption used
        // to special-case: at i<2 the +-4 window is ALL FORWARD closes, so a
        // launch bar that closes pre-pump (NIGGABULL 15m: true genesis
        // o=h=l=c~2.4e-6, forward med 9.4e-5) fails any band test but chains
        // cleanly into the pump bar's low.
        const nxt = bars[i + 1];
        const nl = Number(nxt?.l), nh = Number(nxt?.h);
        const anchored = (nl > 0 && nh > 0)
          ? (c0 >= nl / 25 && c0 <= nh * 25)
          // Live edge: no successor to corroborate it yet. A real move is
          // backed by trades; a wrong-price print is a tick with nothing
          // behind it - so volume is the only witness left. Getting this
          // wrong self-heals on the next bucket, and erasing a fresh rug the
          // moment it happens is the worse failure on a trading terminal.
          : (Number(b.v) > 0 || (c0 <= HI && c0 >= LO));
        if (anchored) {
          lastGood = c0;
          return b;
        }
      }
      fixed++;
      const flat = lastGood ?? med;
      return { ...b, o: flat, h: flat, l: flat, c: flat };
    });
    if (fixed > 0) console.log(`[bars-sanitize] clamped ${fixed}/${bars.length} glitch bar(s) (neighbour-relative)`);
    return out;
  } catch { return bars; }
}

export function writeBarsPayload(res, payload, ctx) {
  if (ctx?.budget) res.setHeader('X-Spectre-Budget', ctx.budget);

  if (payload?.bars?.length > 0) {
    // No genesis flag any more: the launch-candle exemption it fed used to need
    // to know whether the window reached the token's first bar of life, because
    // the band test could not judge a launch candle. sanitizeBars now decides
    // per bar from the next bar's traded range, which covers genesis without
    // being told where genesis is.
    payload = { ...payload, bars: sanitizeBars(payload.bars) };
  }

  if (!payload || !(payload.bars?.length > 0)) {
    // no_data shape differs by where we are; callers that need the specific
    // no_data headers handle it themselves. This branch is the codex-tier
    // no_data (no-store) — matches the legacy `else` in handlers/bars.js.
    // failed:true = the tier ERRORED (timeout/429/budget) rather than proved
    // the window empty. Emit tier 'error' so clients never read a broken
    // request as genesis - 'no_data' is TERMINAL in the TV datafeed contract
    // (the widget permanently stops asking) and the trading chart also keeps
    // a module-level genesis floor keyed off it. The body carries `failed`
    // for clients that read the payload instead of the header.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('X-Spectre-Tier', payload?.failed ? 'error' : 'no_data');
    return res.status(200).json(payload || { bars: [] });
  }

  const tier = SOURCE_TO_TIER[payload.source] || 'unknown';
  switch (tier) {
    case 'binance':
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
      res.setHeader('X-Spectre-Tier', 'binance');
      break;
    case 'hetzner':
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=30');
      res.setHeader('X-Spectre-Tier', 'hetzner');
      break;
    case 'geckoterminal':
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=30');
      res.setHeader('X-Spectre-Tier', 'geckoterminal');
      break;
    case 'cg-ohlc':
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=30');
      res.setHeader('X-Spectre-Tier', 'cg-ohlc');
      break;
    case 'codex':
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60');
      res.setHeader('X-Spectre-Tier', 'codex');
      break;
    default:
      // Unknown source (e.g. a legacy KV entry written without a source tag).
      // Pre-refactor the codex path set these headers on ANY non-empty
      // payload - dropping Cache-Control here silently disabled edge caching
      // for shared UDF-warmed entries (2026-06-11 audit). Default to the
      // codex header set; X-Spectre-Tier keeps the raw value for forensics.
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60');
      res.setHeader('X-Spectre-Tier', tier);
  }
  return res.status(200).json(payload);
}

// Run a tier by name. Centralizes the name->function dispatch shared by the
// legacy path and the smart router.
const TIER_FNS = {
  binance: tryBinance,
  hetzner: tryHetzner,
  geckoterminal: tryGeckoTerminal,
  cgOhlc: tryCgOhlc,
  codex: tryCodex,
};

export async function runTier(name, ctx) {
  const fn = TIER_FNS[name];
  if (!fn) return null;
  return fn(ctx);
}

export const __test__ = { classifyTokenClass, buildTierList, staleMirrorKey, SOURCE_TO_TIER };
