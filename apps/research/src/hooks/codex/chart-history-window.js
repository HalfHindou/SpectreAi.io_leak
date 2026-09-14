/**
 * Scroll-back window sizing for the canvas chart's history pager.
 *
 * Pure - no app imports - so the arithmetic that decides "is this batch a
 * wrong-era cliff or just a quiet stretch" can be unit-tested under plain node.
 * That question has produced three separate history-wall bugs already
 * (rz-chart-audit-plan steps 6-8); it does not belong inline in a React hook.
 */

/* Server contract (apps/research/api/_lib/handlers/bars.js:291-320): a bars
   request is classified a WIDE PROBE only when (to - from) exceeds the
   resolution's MAX_WINDOW_BARS span, and ONLY a wide probe forwards `countback`
   to Codex. countback walks back N REAL trade bars; a verbatim [from..to]
   window returns just the trades that happen to fall inside it.

   MEASURED on prod 2026-08-26, LEO 5m, same anchor (2026-04-28), same latency
   band:
     verbatim 80h window (today's stride) ->    9 bars,   2 days,  ~700ms
     wide window, countback 500 (default) ->  500 bars,  76 days,  ~575ms
     wide window, countback 1500          -> 1500 bars, 283 days, ~1273ms

   SCROLLBACK_HOURS['5'] is 80h = 3.33 days and the wide-probe line at 5m is
   1000 * 300s = 3.47 days - the stride sat 0.14 days UNDER it, so every
   scroll-back page paid a full round-trip for ~2% of its capacity. */
export const DEEP_PAGE_COUNTBACK = 1500;

/* Codex rejects spans wider than ~3 years and services/codexApi.js clamps
   every request to the same value. A deep page only needs its window wide
   enough to TRIP the wide-probe test - countback decides what comes back - so
   we ask for the clamp itself rather than mirroring the server's per-resolution
   MAX_WINDOW_BARS table, which would silently rot if the server's changed. */
export const MAX_WINDOW_SEC = 3 * 365 * 24 * 3600;

/* No token on our path has OHLCV before 2017 (mirrors codexApi BARS_EPOCH_SEC). */
export const BARS_EPOCH_SEC = 1483228800;

/**
 * Deep pages are for sources that page by trade-bar count. Tokens with a
 * Binance spot pair keep the narrow stride: that path fetches klines directly
 * and Binance short-fills anything over 1000 bars per request, which splices
 * time holes into an index-plotted canvas.
 */
export function isDeepPageEligible({ deep, hasBinancePair }) {
  return !!deep && !hasBinancePair;
}

/** Window bounds for one history page. Never asks below the OHLCV epoch. */
export function historyWindow(toSec, { deep, strideSec }) {
  const windowSec = deep ? MAX_WINDOW_SEC : strideSec;
  const fromSec = Math.max(BARS_EPOCH_SEC, toSec - windowSec);
  return { fromSec, windowSec: toSec - fromSec };
}

/**
 * Era-cliff tolerance: how far below the held buffer's oldest bar an incoming
 * batch's newest bar may sit before we call it a different era.
 *
 * It MUST be the window we actually asked for. The batch is fetched with
 * `to = oldest - 1`, so every bar it can contain already lies inside that
 * window - a gap within it means the source had no trades there (the normal
 * state of a thin DEX token), while a real era cliff (a fallback source
 * answering with 2017 data) lands outside it. Sizing this from a fixed stride
 * while the page spans three years is how a quiet stretch gets misread as a
 * cliff and latches the history wall permanently.
 */
export function eraCliffToleranceMs(intervalMs, windowSec) {
  return Math.max((intervalMs || 0) * 50, (windowSec || 0) * 1000);
}

/* ── Tier-contract seam gate ──────────────────────────────────────────────
   Measured on M87/MESSIER 2026-08-26 (founder screenshot, "битые бары"): deep
   scroll-back walks past the DEX pool's genesis and the cascade falls to
   CoinGecko's aggregate, which prices the same token on a different basis.
   Three tiers ended up spliced into one index-plotted series:

     2023-08-10 -> now  geckoterminal  real volume   3.53e-6 at the boundary
     2023-08-07 (1 bar) codex          no volume     7.30e-7
     2022 and older     cg-ohlc        volumeAvailable:false, 2.71e-6

   at the seam the held series' oldest close (7.30e-7) met an incoming close of
   2.80e-8 - a 26x cliff - and the cg-ohlc era, being close-only, rendered as a
   flat dashed shelf below the real candles.

   The discriminator is NOT the price ratio. A young token legitimately moves
   5-25x between adjacent 4h bars, so a ratio gate truncates real history - the
   false-positive mode that kept this guard unbuilt (rz-chart-audit step 10).
   What IS unambiguous is the server's own data contract: cg-ohlc reports
   `meta.volumeAvailable === false` because it has no OHLCV at all, only closes.
   A close-only batch cannot be spliced into a series that has real volume -
   they are different instruments' worth of information, and the canvas draws
   the difference as flat ticks. */

/** True when the server says this payload carries no volume, or it observably doesn't. */
export function isCloseOnlyBatch(bars, meta) {
  if (meta && meta.volumeAvailable === false) return true;
  if (!Array.isArray(bars) || bars.length < 8) return false;
  // Observed fallback for tiers that ship no meta: a real OHLCV tape always has
  // SOME volume. GT gap-fill leaves synthetic zero-volume bars, so require the
  // batch to be entirely volume-less before calling it close-only.
  return bars.every(b => !b.volume);
}

/** Share of the held series that carries real volume, sampled at the OLD end -
 *  that is the edge an incoming older batch will actually sit against. */
export function heldSeriesHasVolume(bars, sample = 200) {
  if (!Array.isArray(bars) || !bars.length) return false;
  const slice = bars.slice(0, Math.min(sample, bars.length));
  const withVol = slice.filter(b => b.volume > 0).length;
  return withVol / slice.length > 0.3;
}

/**
 * Should this older batch be refused because it comes from a tier that cannot
 * describe the same instrument the held series does?
 * Only ever refuses close-only data ARRIVING AT a series that has volume - a
 * chart already served close-only end to end keeps paging normally.
 */
export function seamContractBroken({ batchBars, batchMeta, heldBars }) {
  return isCloseOnlyBatch(batchBars, batchMeta) && heldSeriesHasVolume(heldBars);
}
