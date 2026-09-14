/**
 * TradingView Advanced Charts - uses the self-hosted charting_library (v27)
 * Full-featured chart widget with drawing tools, indicators, crosshair.
 *
 * Data flows through our server:
 *   /api/tradingview/udf/symbols  -> symbol metadata
 *   /api/tradingview/udf/search   -> symbol search
 *   /api/tradingview/udf/history  -> OHLCV bars (crypto via Codex+Binance)
 *
 * Ported from apps/research/src/components/TradingViewAdvanced.jsx
 */
import { useEffect, useRef, useState, memo } from 'react'
import { getBars as codexGetBars, inferNetworkId, hasSnapshotPending, fetchTokenSnapshot } from '../services/codexApi'
import { getCachedBars, getCachedBarsEntry, seedCachesFromSnapshot, hasCachedBarsSync, cachedBarCountSync, seedChartBarsCache, FIRST_PAINT_BARS } from '../hooks/useCodexData'
import { mark, markAndMeasure } from '../lib/perfMarks'
import { findAnomalousGaps, countNewInteriorBars, gapProbeAllowed } from '../lib/chartGapHeal'
import { subscribe as streamSubscribe } from '../services/codexStreamApi'
import { subscribe as barsSubscribe, isBarResolutionSupported } from '../services/codexBarsStreamApi'
import { MOBILE_MEDIA_QUERY } from '../hooks/useIsMobile'

// Authoritative live-bar feed (Codex onBarsUpdated → /api/codex/bars-stream):
// real OHLCV + real volume, layered on top of the price-synth candle. OPT-IN
// (VITE_CHART_BAR_STREAM=1). The earlier "≈0 pushes/min" note that kept this
// off was wrong (re-measured 32-130 bars/min on a hot pair), but it is now
// REDUNDANT: the price ticks are derived on the relay from the pair's trade
// feed (see codexStreamApi setTokenPair), so they arrive per TRADE with the
// swap's USD size, and the price-synth path below draws the same per-trade
// candle with real running volume from ONE Codex subscription - the same one
// the Transactions tape uses. Turning this on adds a second billed
// subscription per pair for no visible gain. The 30s /api/bars reconcile
// stays as the safety net either way.
const BAR_STREAM_ENABLED = (typeof import.meta !== 'undefined'
  && import.meta.env && import.meta.env.VITE_CHART_BAR_STREAM === '1') ? true : false
import { isAppActive } from '../lib/idleManager'
import { readHotSnapshot } from '../lib/tokenHotCache'
import useSettingsStore from '../store/useSettingsStore'
import { resolveChartStyle } from '../lib/chartStyle'
import ChartLoader from './ChartLoader'


// Phase J5 + 2026-06-02 cost pass 2: live-candle getBars fallback interval.
// SSE stream provides ~1s price ticks so the poll only reconciles full
// OHLCV+volume. 60s lag on the closed-bar reconciliation is invisible to
// users because the line/candle interpolates from the SSE tick. Bumped
// 30s -> 60s; halves the per-viewer getBars rate.
const LIVE_POLL_MS = 60000

// Below this many cached bars a series is "sparse": too few candles for another
// token's preserved time window to frame, so a warm (shimmer-less) switch would
// flash them stretched to full-pane width until the fit lands. Sized above the
// counts that actually misframe (a handful to a few dozen) and well under a
// normal boot window (~200+), so only genuinely thin tokens pay the shimmer.
const SPARSE_SERIES_FLOOR = 60

// FIRST-WINDOW GENESIS (2026-08-04). The first window for a symbol comes from
// a COMPLETE from=0 fetch (the server's last-500-trade-bars wide shape - the
// same contract the '-countback' prefetch cache and the snapshot seed carry).
// When that complete window returns far fewer bars than the 500 clamp, the
// token's ENTIRE life is already in the buffer - true for every fresh token
// by definition. TV doesn't know that: it asked for ~330 bars, got 10, and
// immediately fires a second request for the missing older bars - a full
// network round-trip (plus fetchBars' 1.2s transient-empty retry) that sits
// on the switch's critical paint path and can only ever answer "nothing
// there". Traced on a fresh listing: first window n=10 at 2335ms, older
// probe fired at 2336, empty at 4905, setSymbol callback at 4907 - the user
// stared at the old chart for 2.5s waiting for a known-empty answer.
//
// noteCompleteWindow records the genesis when a complete window comes back
// under the threshold; the (A2) guard in the scroll-back path then answers
// pre-genesis probes synchronously. INSTANCE-scoped (cleared by resetCaches
// on every token switch) on purpose: a wrong latch - a deep token whose
// complete window was somehow truncated - self-heals on the next visit,
// unlike the persistent-floor class of bug ("declare the data exhausted
// forever", the rz-charts 2026-07-27 lesson). 300 is comfortably above any
// fresh token and comfortably below the 500 clamp, so a truncated-deep-token
// false positive requires an upstream returning 60% of a successful window -
// not a failure shape Codex produces.
const GENESIS_COMPLETE_MAX = 300
function noteCompleteWindow(df, resolution, completeBars) {
  if (!Array.isArray(completeBars) || completeBars.length === 0) return
  if (completeBars.length >= GENESIS_COMPLETE_MAX) return
  if (!df._genesisOldestSec) df._genesisOldestSec = new Map()
  df._genesisOldestSec.set(resolution, Math.floor(completeBars[0].time / 1000))
}

// Datafeed pipeline debug - OFF unless localStorage['spectre-tv-debug']='1'.
// Left in on purpose: "chart is slow on token X" reports need the ORDER of
// getBars/onResult/deepFill/setSymbol-callback events, and reproducing them
// with ad-hoc patches costs an hour each time. Zero cost when off.
const TV_DEBUG = (() => { try { return localStorage.getItem('spectre-tv-debug') === '1' } catch { return false } })()
const tvdbg = TV_DEBUG
  ? (...a) => { try { console.debug('[tv-dbg]', Math.round(performance.now()), ...a) } catch { /* noop */ } }
  : () => {}

// TradingView v27's loader does `host + library_path` string concat, so a
// leading slash here produces `host//charting_library/` (double slash) and
// fails to load any bundle. Keep this RELATIVE - no leading slash.
const LIBRARY_PATH = 'charting_library/'

// Map our timeframe labels to TV resolutions. Minutes use lowercase m (M = months).
const TIMEFRAME_TO_RESOLUTION = {
  '1S': '1S',
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1H': '60',
  '4H': '240',
  '12H': '720',
  '1D': '1D',
  '1W': '1W',
  '1M': '1M', // monthly - getBars aggregates daily → calendar months
  'All': '1D', // full history rendered as daily candles
}

// Reverse map: TV resolution -> our timeframe label. Skip 'All' - it shares the
// '1D' resolution, and '1D' is the canonical label for that interval.
const RESOLUTION_TO_TIMEFRAME = Object.fromEntries(
  Object.entries(TIMEFRAME_TO_RESOLUTION)
    .filter(([k]) => k !== 'All')
    .map(([k, v]) => [v, k])
)

const API_BASE = ''

// Bar duration in seconds for each resolution
const RES_SECONDS = { '1S': 1, '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, '240': 14400, '720': 43200, '1D': 86400, '1W': 604800, '1M': 2592000 }

// Any resolution we can build IN-MEMORY by aggregating an already-loaded FINER
// one, so a timeframe switch is instant (0 network, 0 Codex) instead of a cold
// /api/bars round-trip. Sources are COARSEST-first: a coarser source spans more
// time per cached bar (better history coverage) and divides evenly into the
// target. The chain reaches down to 1m, so a NEWLY-LAUNCHED token whose whole
// life fits in one 1m fetch derives EVERY other timeframe from that single fetch
// (and the sub-hourly 5m/15m/30m - normally metered Codex - become derive-only,
// a Codex SAVING). A per-request coverage guard (getBars) only accepts a derived
// set that reaches back to the requested `from`, so a shallow finer source (e.g.
// 25h of 1m on an ESTABLISHED token) never shows a truncated coarse chart - it
// falls through to fetch. 1W is intentionally absent (epoch weeks start Thursday
// but charts anchor weekly to Monday, so simple epoch bucketing would misalign).
const DERIVE_SOURCES = {
  '5': ['1'],                                          // 5m  <- 1m
  '15': ['5', '1'],                                    // 15m <- 5m | 1m
  '30': ['15', '5', '1'],                              // 30m <- 15m | 5m | 1m
  '60': ['30', '15', '5', '1'],                        // 1H  <- sub-hourly (new tokens)
  '240': ['60', '30', '15', '5', '1'],                 // 4H
  '720': ['240', '60', '30', '15', '5', '1'],          // 12H
  '1D': ['720', '240', '60', '30', '15', '5', '1'],    // 1D
}

// Aggregate fine OHLCV bars (sorted ascending, time in ms) into coarse buckets
// aligned to the UTC epoch (24/7 crypto: day anchors to UTC 00:00, matching
// Codex / cg-ohlc). open=first, high=max, low=min, close=last, volume=sum within
// each bucket - the exact rule a server-side resample uses, so a derived candle
// matches the directly-fetched one and there is no seam when the live stream or
// a later fetch reconciles the same range.
function aggregateBars(fineBars, coarseResSec) {
  if (!Array.isArray(fineBars) || fineBars.length === 0) return []
  const bucketMs = coarseResSec * 1000
  const out = []
  let cur = null
  for (const b of fineBars) {
    if (!b || !b.time) continue
    const bucket = Math.floor(b.time / bucketMs) * bucketMs
    if (!cur || cur.time !== bucket) {
      if (cur) out.push(cur)
      cur = { time: bucket, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 }
    } else {
      if (b.high > cur.high) cur.high = b.high
      if (b.low < cur.low) cur.low = b.low
      cur.close = b.close
      cur.volume += b.volume || 0
    }
  }
  if (cur) out.push(cur)
  return out
}

// ---------------------------------------------------------------------------
// Custom Datafeed - implements TradingView IExternalDatafeed + IDatafeedChartApi
// ---------------------------------------------------------------------------
// Stamped by the component's iframe gesture listeners (wheel/touch/pointer).
// MODULE-level (shared by every datafeed instance) so the viewport restore can
// see it - a restore must NEVER fight a viewport the user has taken since the
// capture.
let _lastGestureTs = 0
function noteUserGesture() { _lastGestureTs = Date.now() }

// Scroll-back viewport ANCHOR - one time-range reference held across a whole
// history-ingest CASCADE (after every prepend TV auto-pages for more, ~0.8s
// apart, until countBack is satisfied or genesis). The per-delivery capture
// this replaces had a hole: every new TV request minted a new capture seq,
// which invalidated the PREVIOUS delivery's still-pending restore checks - so
// a late ingest shift (200-900ms after a delivery) went uncorrected, and the
// next delivery then captured the SHIFTED view as its "fresh" reference. The
// shifts compounded and the chart drifted days into the past while history
// loaded ("прыгает назад влево", 2026-08-13, PALM 5m: a held whitespace view
// drifted 98h left over a 12-page cascade). The anchor is minted at delivery
// time and survives until the USER moves the viewport (gesture-stamped) or a
// deliberate programmatic refit claims it via clearSbViewAnchor().
let _sbViewAnchor = null // { from, to, at, key }
function clearSbViewAnchor() { _sbViewAnchor = null }

function createDatafeed(onNoDataCb, refPriceRef, tickerName, actualSymbolRef, tokenStreamRef, barScaleRef) {
  let tradeMarkerData = []
  let noDataFired = false
  // Volume availability, recorded from the FIRST successful getBars window.
  //   null  = unknown (not yet fetched)
  //   true  = at least one bar had non-zero volume (or server said so)
  //   false = every bar in the first window had zero volume, OR the server
  //           response carried volumeAvailable/meta.volumeAvailable === false
  // setupChartFeatures reads this (via the returned datafeed) to skip creating
  // the Volume study for tokens that have no volume data - a flat zero-volume
  // study is noise and, on some builds, the failing study path was part of the
  // blank-pane class.
  let volumeAvailable = null

  // MCap mode (REWORKED 2026-07-09): the series ALWAYS carries RAW prices.
  // Multiplying every bar by a constant never changes the chart's shape -
  // only the labels - so the circulating-supply multiply lives EXCLUSIVELY
  // in the axis/legend/crosshair formatter (priceFormatterFactory), which
  // reads barScaleRef live on every format call.
  //
  // The old design BAKED the scale into the bars at onResult/onTick time
  // while the formatter read the ref live - two reads of a mutable ref at
  // different times. Any circSupply change AFTER the push (new token's
  // details landing after the now-fast bars, stale supply from the previous
  // token, supply momentarily 0 mid-switch) desynced series from labels
  // with no re-feed trigger (only the ':mcap' suffix STRING forces a
  // re-feed, not a multiplier VALUE change) - the "all axis labels read
  // 0.00 in MCap mode" bug. With raw-series + format-time scaling the race
  // is structurally impossible, and trade markers (raw prices) now also
  // land at the right level in mcap mode. scaleBars/scaleBar remain as
  // passthroughs so every output call site keeps its shape.
  function scaleBars(bars) { return bars }
  function scaleBar(b) { return b }

  const subscribers = new Map()
  let pollingTimer = null
  let streamUnsub = null // unsubscribe fn from codexStreamApi singleton (price-synth path)
  let barStreamUnsub = null // unsubscribe fn from codexBarsStreamApi singleton (authoritative bars)
  let barStreamValidated = false // a bar-stream bar passed the wrong-side ratio guard
  let barStreamWrongSide = false // first bars were off-scale → flip quoteToken
  let barStreamFlipTimer = null // watchdog that flips the quoteToken side once

  // Per-resolution bar cache - survives timeframe switches, cleared on symbol change.
  // Map<resolution, bars[]>
  const resolutionCaches = new Map()
  const resolutionFetchedAt = new Map() // res -> unix sec a resolution's cache was last built from network (gates the tail revalidation)
  let allBarsCache = []       // active resolution's bars (alias into resolutionCaches)
  let activeResolution = ''   // currently active TV resolution
  let cacheSymbol = ''        // current symbol (clear all on change)
  let _warmedSymbol = ''      // symbol whose TF set has been background-warmed (warm once)

  function switchResolutionCache(resolution) {
    // Save current bars
    if (activeResolution && allBarsCache.length > 0) {
      resolutionCaches.set(activeResolution, allBarsCache)
    }
    activeResolution = resolution
    // Restore or start fresh
    allBarsCache = resolutionCaches.get(resolution) || []
  }

  // ── Background TF warm (millisecond switches) ───────────────────────────────
  // After the first paint, populate resolutionCaches for the OTHER visible
  // timeframe buttons so a switch is an INSTANT cache hit (the firstDataRequest
  // paint-first path) instead of a cold ~1s Codex fetch. Aggregation-first:
  // derive a coarser TF from an already-warm finer cache when it spans a useful
  // window (0 network, 0 Codex); otherwise fetch a BOUNDED default window (~600
  // bars, NOT a wide genesis probe). Idle-gated, deduped (skips already-warm),
  // cancellable on symbol/resolution change, paused while the tab is hidden,
  // and ordered current-neighbours-first so the likeliest next click warms soonest.
  let _warmGen = 0
  // The VISIBLE timeframe row only (1m 5m 15m 1H 4H 1D). 1W excluded (Monday
  // anchor vs epoch week); 720 (12H) excluded 2026-07-23 - it lives in the
  // "More" dropdown, so pre-paying its fetch on EVERY token open was the
  // least-clicked slice of the warm burst. A 12H switch cold-fetches once and
  // then caches like any other resolution.
  //
  // EXCEPT on mobile: MobileTimeframeRow renders 12H as a first-class pill
  // (1m 5m 15m 1H 4H 12H 1D 1W All), so the "least-clicked More slice"
  // rationale doesn't hold there - a 12H tap always paid a cold fetch. Warm
  // it when the mobile tree is mounted (same media query useIsMobile keys
  // the mobile UI on). 1W stays excluded on both (anchor issue); mobile
  // 'All' maps to 1D, which is already in the list.
  const WARM_RESOLUTIONS = ['1', '5', '15', '60', '240', '1D']
  function warmResolutionList() {
    try {
      if (typeof window !== 'undefined' && window.matchMedia
        && window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
        return ['1', '5', '15', '60', '240', '720', '1D']
      }
    } catch { /* fall through to the desktop row */ }
    return WARM_RESOLUTIONS
  }
  function cancelWarm() { _warmGen++ }
  async function warmTimeframes(sym) {
    const myGen = ++_warmGen
    const warmList = warmResolutionList()
    // Order neighbours-first so the likeliest next click warms in the first wave.
    const idx = warmList.indexOf(activeResolution)
    const ordered = idx < 0 ? [...warmList]
      : warmList.map((r, i) => ({ r, d: Math.abs(i - idx) })).sort((a, b) => a.d - b.d).map(x => x.r)
    const targets = ordered.filter(res =>
      res !== activeResolution && (resolutionCaches.get(res)?.length || 0) < 50)
    // CONCURRENCY-LIMITED fetch, each wide (from=0) for DENSE, DEEP data. Sequential
    // took ~10s on a cold server (a switch made mid-warm hit a cold fetch = the
    // "wait 3-4s for candles" report); FULL-parallel (7 at once) was too aggressive —
    // the burst of simultaneous Codex TLS connections amplified network blips (socket
    // disconnects / timeouts) and competed with the user-facing price/details calls.
    // We do NOT derive a coarser TF from a finer cache (sparse source → shallow
    // aggregate → TV scroll-backs the deep history). Wide from=0 also dedups the server
    // KV bucket, so a switch made mid-warm joins the in-flight request.
    //
    // Pool 3->2 (2026-07-23, measured): the token-open window already carries the
    // deep-fill (cb=1500), the tail revalidation, the live-candle poll and the
    // trades/details polls. With 3 warm fetches in flight the page held ~6
    // concurrent /api/bars and the browser's per-origin connection cap queued
    // the INTERACTIVE fetches behind the warm - measured 0.5-1.3s solo requests
    // stretching to 4-7.5s in-page during the burst (= the laggy-first-seconds
    // TF switch). 2 warm + 5 targets clears the row in ~2-4s and leaves
    // headroom for user-initiated fetches.
    const CONCURRENCY = 2
    let next = 0
    const worker = async () => {
      while (next < targets.length) {
        if (myGen !== _warmGen || (typeof document !== 'undefined' && document.hidden)) return
        const res = targets[next++]
        const resSec = RES_SECONDS[res] || 3600
        try {
          const now = Math.floor(Date.now() / 1000)
          // from=0 IS the bounded wide probe now: the client clamps the span
          // to 3y (codexApi MAX_BARS_RANGE_SEC) and the server treats it as
          // the "last ~500 trade-bars" wide shape (post-2026-07-21 clamp,
          // 0.4-1.3s warm / 0.8-2.4s cold - NOT the old 8-11s full-history
          // scan). Keep this exact shape: it is the same KV bucket the boot
          // fetch and a mid-warm TF switch use, so they all join one request.
          const got = await fetchBars(sym, res, 0, now + 60)
          if (myGen !== _warmGen || !got || got.length === 0) continue
          const bars = got
          if (bars.length >= 50) {
            resolutionCaches.set(res, bars)
            resolutionFetchedAt.set(res, Math.floor(Date.now() / 1000))
            // Write-through to the module-level -countback cache so the TF-pill
            // hover-prefetch TTL-skips (it re-fetched warm resolutions before)
            // and a TV->canvas engine switch reuses this warm for free.
            try {
              const clean = sym.endsWith(':mcap') ? sym.slice(0, -5) : sym
              const wAddr = clean.includes(':') ? clean.split(':')[0] : clean
              const wNet = clean.includes(':') ? parseInt(clean.split(':')[1]) || 1 : 1
              seedChartBarsCache(wAddr, wNet, res, bars)
            } catch { /* seed is best-effort */ }
          }
        } catch { /* leave un-warmed; its own switch will fetch */ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))
  }
  // COLD-BOOT HOLD-OFF (2026-08-04). The warm is 5 extra /api/bars for the
  // resolutions the user is NOT looking at, and it used to start ~1.2s after
  // the chart's first paint - i.e. right on top of the deep-fill, the tail
  // revalidation, the details/trades polls and the JS chunk downloads. A prod
  // trace of one token open measured 52 /api/bars against a 6-connection
  // browser cap, with LCP at 1420ms of which 1381ms was render delay: the warm
  // was queueing the requests that first paint actually needs. Hold the FIRST
  // pass until the page is past its first-paint window; a token switch later in
  // the session sees performance.now() well past the mark and fires immediately,
  // so the millisecond TF switches the 2026-07-23 pass bought are unchanged for
  // every open after the cold boot. Same page-age pattern as the trending
  // keep-warm's 15s guard (LeftPanel / TokenTicker), just a much shorter hold -
  // this warm serves the chart the user IS on.
  const WARM_BOOT_HOLDOFF_MS = 4000
  function scheduleWarmOnce(sym) {
    if (_warmedSymbol === cacheSymbol || !cacheSymbol) return
    _warmedSymbol = cacheSymbol
    // Fire SOON, not whenever the page happens to go idle: on a busy cold load a bare
    // requestIdleCallback can be delayed many seconds, so the warm finishes late and
    // early switches pay a cold fetch. The {timeout} forces it to run within ~1.2s.
    const run = () => {
      // A token switch during the hold-off resets _warmedSymbol (the getBars
      // symbol-change branch) and clears resolutionCaches - warming the OLD
      // symbol now would write its bars into the NEW symbol's cache.
      if (!cacheSymbol || _warmedSymbol !== cacheSymbol) return
      if (typeof document !== 'undefined' && document.hidden) { _warmedSymbol = ''; return }
      warmTimeframes(sym)
    }
    const schedule = () => {
      if (typeof requestIdleCallback !== 'undefined') requestIdleCallback(run, { timeout: 1200 })
      else setTimeout(run, 500)
    }
    const holdOff = typeof performance !== 'undefined'
      ? Math.max(0, WARM_BOOT_HOLDOFF_MS - performance.now())
      : 0
    if (holdOff === 0) schedule()
    else setTimeout(schedule, holdOff)
  }

  // --- TV-series edge tracking + contiguous tail pusher ----------------
  // THE structural invariant (2026-07-09, after the CASHCAT frozen-hole
  // hunt): TV's series permanently REJECTS any bar older than the newest
  // one it has received, so a single lost or dropped push (fired before TV
  // subscribed, swallowed by a teardown race, gated by the monotonic
  // filter) forks the CACHE's edge ahead of TV's edge - and every pusher
  // that computes its window from the CACHE then starts beyond TV's edge,
  // freezing permanent whitespace where the skipped bars belong (mass ->
  // hole -> floating recent cluster).
  //
  // Fix: track the newest bar time TV's ACTIVE series has actually been
  // handed (tvSeriesLastMs: set at every first-window onResult, advanced by
  // the monotonic tick gate) and make EVERY incremental pusher deliver the
  // MERGED CACHE TAIL FROM TV'S EDGE - contiguous by construction, and
  // self-healing: any fork closes on the next push because the slice
  // starts at what TV last saw, not at what the cache last stored.
  let tvSeriesLastMs = 0
  function pushSeriesTail(resolution) {
    if (resolution !== activeResolution || allBarsCache.length === 0) return
    // Series not fed yet (onResult pending) - it will carry the full data.
    if (!tvSeriesLastMs) return
    let startIdx = allBarsCache.findIndex(b => b.time >= tvSeriesLastMs)
    if (startIdx === -1) return // cache ends before TV's edge - nothing newer
    for (const { resolution: subRes, onTick } of subscribers.values()) {
      if (subRes !== resolution) continue
      for (let i = startIdx; i < allBarsCache.length; i++) {
        try { onTick(scaleBar(allBarsCache[i])) } catch { /* mid-teardown */ }
      }
    }
  }

  // --- Series gap self-heal -------------------------------------------
  // When the series' last bar is MORE THAN ONE bucket behind "now" (stale
  // hot-snapshot paint, long-hidden tab, failed tail revalidation), fetch
  // the missing span, merge it, and push the CACHE TAIL from TV's edge.
  // Also the standing reconciler while streaming: replaces synthetic
  // stream candles (open=prevClose, volume 0) with real OHLCV and closes
  // any cache/TV fork. Throttled + single-flight: at most one per 20s -
  // just under the 30s reconcile cadence so timing jitter never makes the
  // standing reconcile skip a cycle (would push the heal out to 60s).
  let _gapFillBusy = false
  let _gapFillLast = 0
  function backfillSeriesGap(resolution) {
    if (_gapFillBusy || Date.now() - _gapFillLast < 20_000) return
    if (resolution !== activeResolution || allBarsCache.length === 0) return
    const sym = actualSymbolRef?.current
    if (!sym) return
    // CROSS-TOKEN RACE GUARD (2026-07-10, the "28th report" class): every
    // continuation below must re-check the SYMBOL, not just the resolution.
    // Token switches happen in place via setSymbol at the SAME resolution,
    // so a resolution-only guard lets a fetch started for token A merge A's
    // bars into token B's cache + TV series - phantom pre-launch candle
    // clusters, and a frozen last-price label once the foreign bar advances
    // the monotonic tick gate. cacheSymbol is the live module var the getBars
    // inline clear re-keys on switch.
    const reqSymKey = cacheSymbol
    _gapFillBusy = true
    _gapFillLast = Date.now()
    // Fetch from the OLDER of cache-edge / TV-edge so the merged union
    // always covers whatever TV is missing, then let pushSeriesTail slice.
    const cacheLastSec = Math.floor(allBarsCache[allBarsCache.length - 1].time / 1000)
    const tvLastSec = tvSeriesLastMs ? Math.floor(tvSeriesLastMs / 1000) : cacheLastSec
    const lastT = Math.min(cacheLastSec, tvLastSec)
    const now = Math.floor(Date.now() / 1000)
    fetchBars(sym, resolution, lastT, now + 60).then(fresh => {
      if (reqSymKey !== cacheSymbol || resolution !== activeResolution) return
      if (Array.isArray(fresh) && fresh.length > 0) {
        allBarsCache = mergeBars(allBarsCache, fresh)
        resolutionCaches.set(activeResolution, allBarsCache)
        resolutionFetchedAt.set(activeResolution, Math.floor(Date.now() / 1000))
      }
      // Push even on an empty fetch: the cache may already hold bars TV
      // never received (the fork case) - the tail slice heals regardless.
      pushSeriesTail(resolution)
    }).catch(() => { /* next tick retries via the throttle window */ })
      .finally(() => { _gapFillBusy = false })
  }

  // --- Interior-gap self-heal (upstream backfill-lag class, 2026-08-14) ----
  // backfillSeriesGap above heals the TAIL (last bar -> now). This heals holes
  // in the MIDDLE of the series: when the bars provider has an ingestion
  // outage, the served series carries a multi-hour interior hole; the provider
  // BACKFILLS it later, but nothing in an open session ever re-asks those
  // windows - the user stares at a healed-upstream hole until reload (TOAD
  // 2026-08-14: a ~3h Codex Solana outage, backfilled within hours, on screen
  // all day). Every ~2.5 min on the visible+active chart, look for
  // outage-SHAPED gaps only (dense trading on both borders - a thin token's
  // natural quiet periods never match, so this never burns Codex re-checking
  // real no-trade gaps), re-fetch just that window, and when new interior bars
  // actually arrive, merge + hand the component a repaint via onGapHealed
  // (resetData preserving the viewport). Bounded: 2 immediate probes per gap,
  // then a slow retry every 10 min (gapProbeAllowed) - Codex's history
  // backfill lags its live-edge recovery by 30min-hours, so a hard 2-probe
  // budget burned out before upstream had anything to give and the gap
  // latched for the session (WENFROG 2026-08-20). 4 applied heals per symbol,
  // one probe in flight.
  const GAP_HEAL_CHECK_MS = 150_000
  const GAP_HEAL_MAX_APPLIES = 4
  const GAP_HEAL_MIN_NEW_BARS = 3
  const GAP_HEAL_QUIET_MS = 3000
  let _dfSelf = null            // the datafeed object (set in subscribeBars) - carries onGapHealed
  let _ihBusy = false
  let _ihLastCheck = 0
  let _ihApplied = 0
  const _ihAttempts = new Map() // `${res}:${gapStartMs}` -> { count, lastMs }
  function healInteriorGaps(resolution) {
    if (_ihBusy || Date.now() - _ihLastCheck < GAP_HEAL_CHECK_MS) return
    if (resolution !== activeResolution || allBarsCache.length === 0) return
    if (_ihApplied >= GAP_HEAL_MAX_APPLIES) return
    // The heal ends in a resetData - never race a user gesture.
    if (Date.now() - _lastGestureTs < GAP_HEAL_QUIET_MS) return
    const resSec = RES_SECONDS[resolution]
    if (!resSec || resSec > 86400) return // 1W/1M aggregates judge nothing
    const sym = actualSymbolRef?.current
    if (!sym) return
    _ihLastCheck = Date.now()
    const gaps = findAnomalousGaps(allBarsCache, resSec)
    const gap = gaps.find(g => gapProbeAllowed(_ihAttempts.get(`${resolution}:${g.startMs}`), Date.now()))
    if (!gap) return
    const attemptKey = `${resolution}:${gap.startMs}`
    const prev = _ihAttempts.get(attemptKey)
    _ihAttempts.set(attemptKey, { count: (prev?.count || 0) + 1, lastMs: Date.now() })
    const reqSymKey = cacheSymbol // cross-token race guard (see backfillSeriesGap)
    _ihBusy = true
    tvdbg('gap-heal probe', resolution, new Date(gap.startMs).toISOString(), '->', new Date(gap.endMs).toISOString())
    fetchBars(sym, resolution, Math.floor(gap.startMs / 1000) - resSec, Math.ceil(gap.endMs / 1000) + resSec)
      .then(healed => {
        if (reqSymKey !== cacheSymbol || resolution !== activeResolution) return
        if (countNewInteriorBars(allBarsCache, healed || [], gap) < GAP_HEAL_MIN_NEW_BARS) return
        allBarsCache = mergeBars(allBarsCache, healed)
        resolutionCaches.set(activeResolution, allBarsCache)
        _ihApplied++
        tvdbg('gap-heal APPLIED', resolution, 'gap', new Date(gap.startMs).toISOString())
        try { _dfSelf?.onGapHealed?.() } catch { /* repaint is best-effort; scroll-back also serves the healed cache */ }
      })
      .catch(() => { /* probe already counted; the next sweep may retry once */ })
      .finally(() => { _ihBusy = false })
  }

  // Consecutive stream-tick rejects against the last close. Reset on any
  // accepted tick; at 3 the guard stops trusting the (possibly stale) close
  // and defers to real bars via backfillSeriesGap.
  let outlierStreak = 0
  // Standing reconciler while streaming (see startStreaming).
  let reconcileTimer = null

  /**
   * Real-time chart updates via Codex onPricesUpdated stream.
   * Uses the token's USD price (not pair-level OHLCV) to update the last candle's close/high/low.
   * This avoids the pair-side ambiguity problem with onBarsUpdated.
   */
  function startStreaming(resolution) {
    stopStreaming()

    const tokenAddress = tokenStreamRef?.current?.address
    const tokenNetworkId = tokenStreamRef?.current?.networkId
    if (tokenAddress && tokenNetworkId) {
      const tokenKey = `${tokenAddress}:${tokenNetworkId}`

      // Standing reconcile: the live candle is SYNTHESIZED from price ticks
      // (open=prevClose, volume=0), so it drifts from real OHLCV until a
      // reconcile fetches authoritative bars from /api/bars (real o/h/l/c +
      // real volume) and replaces the synthetic tail via pushSeriesTail. This
      // is the RELIABLE heal for the "broken/missing candle" class - it works
      // for every token and doesn't depend on Codex's onBarsUpdated push,
      // which is far too sparse to rely on (measured: ~0 pushes/min even for
      // hyperactive tokens; Axiom's room streams thousands, a different
      // backend we don't have). Cadence 30s (was 180s): a 6x faster heal so
      // synthetic drift self-corrects within one interval instead of up to
      // three minutes. Cost is bounded by backfillSeriesGap's own 30s throttle
      // + the server's 60s KV bars bucket (every other fetch is a cache hit)
      // + the visible+active gate, so this is ~1 Codex getBars/min on the
      // ONE chart the user is looking at.
      reconcileTimer = setInterval(() => {
        if (typeof document !== 'undefined' && (document.hidden || !isAppActive())) return
        backfillSeriesGap(resolution)
        healInteriorGaps(resolution) // self-throttled to ~2.5 min inside
      }, 30_000)

      // ── AUTHORITATIVE BAR STREAM (primary live source) ──────────────────
      // When we have a pair address and the server can serve this resolution,
      // drive the live candle from Codex onBarsUpdated (REAL o/h/l/c + REAL
      // volume) instead of synthesizing it from price ticks. This removes the
      // synth-fork "broken/missing candle" class: real bars ARE the truth, so
      // no outlier-guessing is needed, and the cache stays byte-correct
      // (real volume) so pushSeriesTail/backfill never fight a synthetic tail.
      // Falls through to the price-synth path when disabled / no pair /
      // unsupported resolution (12H, 1W, 1M, or non-Codex tokens).
      const pairAddr = tokenStreamRef?.current?.pairAddress
      if (BAR_STREAM_ENABLED && pairAddr && isBarResolutionSupported(resolution)) {
        const pairId = `${pairAddr}:${tokenNetworkId}`
        const resSeconds = RES_SECONDS[resolution] || 60
        barStreamValidated = false
        barStreamWrongSide = false

        const barHandler = (bar) => {
          try {
            // Guards: still the active token, active resolution, history seeded.
            const _cur = tokenStreamRef?.current
            if (!_cur || _cur.pairAddress !== pairAddr) return
            if (resolution !== activeResolution) return
            if (allBarsCache.length === 0) return
            const lastBar = allBarsCache[allBarsCache.length - 1]
            if (bar.time < lastBar.time) return // stale bucket

            // WRONG-SIDE GUARD (correctness-critical): Codex onBarsUpdated is
            // priced per quoteToken, and the wrong side yields the OTHER token's
            // price (a PEPE/WETH pair returned WETH's ~$1800 on a PEPE chart).
            // Applying that = broken candles - the exact bug we're fixing.
            // Reject any bar whose close is not within a sane ratio of the
            // current series close; the flip watchdog then re-subscribes with
            // the other side, and if that also fails the pair stays on the
            // price-synth path (no regression). Validation LOCKS the side.
            const ref = Number(lastBar.close) || Number(lastBar.open) || 0
            if (ref > 0 && (bar.close > ref * 5 || bar.close < ref / 5)) {
              if (!barStreamValidated) barStreamWrongSide = true
              return
            }
            barStreamValidated = true

            // Multi-bucket gap → let the established healer stitch real bars.
            if (bar.time - lastBar.time > resSeconds * 1000) {
              backfillSeriesGap(resolution)
              return
            }
            // Cache ahead of TV (a prior push was lost) → close the fork first.
            if (tvSeriesLastMs && lastBar.time > tvSeriesLastMs) {
              pushSeriesTail(resolution)
            }
            // Same bucket → replace with the authoritative bar (real volume).
            // Next bucket → append it. No outlier guard: the bar IS the truth.
            if (bar.time === lastBar.time) allBarsCache[allBarsCache.length - 1] = bar
            else allBarsCache.push(bar)
            outlierStreak = 0

            const outBar = scaleBar(bar)
            subscribers.forEach((sub) => {
              if (sub.resolution !== resolution) return
              try { sub.onTick(outBar) } catch { /* series disposed */ }
            })
          } catch { /* non-fatal: reconcile timer + backfill are the safety net */ }
        }

        // Start on the pair's KNOWN side when pair-info resolved it (the side
        // the token sits on - see TradingChart's resolvedPairSide), else on the
        // learned side, else guess token1 and flip ONCE if the first bars come
        // back off-scale. Cache the winning side so TF switches start correct.
        const knownSide = tokenStreamRef?.current?.pairSide
        if (knownSide === 'token0' || knownSide === 'token1') _pairQuoteSide.set(pairId, knownSide)
        let quoteSide = _pairQuoteSide.get(pairId) || 'token1'
        barStreamUnsub = barsSubscribe(pairId, resolution, barHandler, quoteSide)
        let flipped = _pairQuoteSide.has(pairId) // don't flip a learned side
        barStreamFlipTimer = setInterval(() => {
          if (barStreamValidated) {
            _pairQuoteSide.set(pairId, quoteSide)
            clearInterval(barStreamFlipTimer); barStreamFlipTimer = null
            return
          }
          if (barStreamWrongSide && !flipped) {
            flipped = true
            barStreamWrongSide = false
            if (barStreamUnsub) { barStreamUnsub(); barStreamUnsub = null }
            quoteSide = quoteSide === 'token1' ? 'token0' : 'token1'
            barStreamUnsub = barsSubscribe(pairId, resolution, barHandler, quoteSide)
          }
        }, 1500)

        // ALSO keep the price-synth subscription alive as a sub-second smoother
        // and a fallback: if the bar stream never validates (both sides wrong /
        // silent), the synth path below still keeps the live candle moving. The
        // authoritative bar always OVERWRITES the same bucket when it lands, so
        // there's no conflict - synth just fills the gaps between bar pushes.
        // (Falls through to the price-synth block below - no early return.)
      }

      // Use the shared codexStreamApi singleton instead of creating a separate
      // EventSource. This prevents connection pool exhaustion (browser limits
      // HTTP/1.1 to 6 concurrent connections per domain).
      streamUnsub = streamSubscribe([tokenKey], (data) => {
        try {
          // Drop ticks once this token is no longer the active chart token: a
          // PAAL→SPECTRE switch can leave this prior subscription briefly alive,
          // and its $PAAL price ($0.005) would corrupt the SPECTRE candle and
          // trip "putToCacheNewBar: time violation". Value-compare against the
          // always-current tokenStreamRef (re-set every render) - an additive
          // guard that never drops the active token's own ticks.
          const _cur = tokenStreamRef?.current
          if (!_cur || `${_cur.address}:${_cur.networkId}` !== tokenKey) return
          const price = parseFloat(data.priceUsd)
          if (!price || price <= 0) return
          if (allBarsCache.length === 0) return
          // Ticks derived from the pair's trade feed carry the swap's USD size
          // (see codexStreamApi setTokenPair) - the forming candle accumulates
          // it, so live volume is real rather than 0 until the reconcile.
          const tradeUsd = parseFloat(data.tradeUsd) || 0

          // Update last candle with live price
          const lastBar = allBarsCache[allBarsCache.length - 1]
          const resSeconds = RES_SECONDS[resolution] || 60
          const now = Math.floor(Date.now() / 1000)
          const currentBarTime = Math.floor(now / resSeconds) * resSeconds * 1000
          if (currentBarTime < lastBar.time) return // stale timestamp

          // GAP/FORK detection runs FIRST - before any price sanity check.
          // The old order (outlier guard first) was a DEADLOCK: after a real
          // pump or a hidden-tab span, every tick was "an outlier" vs the
          // frozen stale close, returned early, and the leap branch below -
          // the only trigger for the backfill self-heal - was unreachable.
          // The series froze at the pre-pump price forever (the CASHCAT
          // frozen-hole report). Real bars from the backfill are the
          // authority on whether the price genuinely moved - never the
          // stale close.
          if (currentBarTime - lastBar.time > resSeconds * 1000) {
            backfillSeriesGap(resolution)
            return
          }
          // Cache ahead of TV (a previous push was lost) - close the fork
          // before layering live updates on top of it.
          if (tvSeriesLastMs && lastBar.time > tvSeriesLastMs) {
            pushSeriesTail(resolution)
          }

          const refPrice = Number(lastBar.close) || Number(lastBar.open) || 0
          let tvBar
          if (currentBarTime === lastBar.time) {
            // Same candle. STRICT tick-to-tick outlier guard: a single
            // anomalous DEX print (wash trade / bad pool read) must not
            // spike the forming candle - the documented "67K -> 160K"
            // artifact. Genuine pumps stream INCREMENTAL ticks, so each
            // passes; but a tick returning after an idle span can be a
            // legitimate cliff - so N consecutive rejects stop trusting
            // the stale close and let REAL bars decide via the backfill.
            if (refPrice > 0 && (price > refPrice * 1.6 || price < refPrice * 0.625)) {
              if (++outlierStreak >= 3) { outlierStreak = 0; backfillSeriesGap(resolution) }
              return
            }
            outlierStreak = 0
            tvBar = {
              time: lastBar.time,
              open: lastBar.open,
              high: Math.max(lastBar.high, price),
              low: Math.min(lastBar.low, price),
              close: price,
              volume: (Number(lastBar.volume) || 0) + tradeUsd,
            }
            allBarsCache[allBarsCache.length - 1] = tvBar
          } else {
            // Exact next bucket. A real regime move across a bucket roll is
            // allowed (bridge candles are real - a memecoin can open 5x off
            // the previous close); only reject absurd junk, with the same
            // streak escape so persistent "junk" (i.e. reality) resolves
            // through real bars instead of freezing the series.
            if (refPrice > 0 && (price > refPrice * 25 || price < refPrice / 25)) {
              if (++outlierStreak >= 3) { outlierStreak = 0; backfillSeriesGap(resolution) }
              return
            }
            outlierStreak = 0
            // Open at the PREVIOUS close, not the incoming tick - DEX bars
            // are continuous, so a bad first-tick must not create a gapped,
            // broken-looking open (the reported SPECTRE spike).
            const openPrice = Number(lastBar.close) || price
            tvBar = {
              time: currentBarTime,
              open: openPrice,
              high: Math.max(openPrice, price),
              low: Math.min(openPrice, price),
              close: price,
              volume: tradeUsd,
            }
            allBarsCache.push(tvBar)
          }

          const outBar = scaleBar(tvBar)
          subscribers.forEach((sub) => {
            // Only feed series that match THIS stream's resolution. A stream is
            // bucketed for one resolution (currentBarTime uses RES_SECONDS[resolution]).
            // During a rapid timeframe switch the subscribers map can briefly hold
            // the OUTGOING resolution's listener, so without this guard a bar
            // bucketed for the old resolution (e.g. a 1H 14:00 bar) gets pushed
            // into the new resolution's series (e.g. 4H, whose live bucket is
            // 12:00). TV then sees the next correct tick as out-of-order and trips
            // "putToCacheNewBar: time violation", stalling the live candle. Fast
            // switching (instant cache-hit timeframe changes) surfaced this leak.
            if (sub.resolution !== resolution) return
            try { sub.onTick(outBar) } catch {}
          })
        } catch {}
      })
      return
    }

    // Fallback: polling when no token address available
    startPolling()
  }

  function stopStreaming() {
    if (streamUnsub) {
      streamUnsub()
      streamUnsub = null
    }
    if (barStreamUnsub) {
      barStreamUnsub()
      barStreamUnsub = null
    }
    if (barStreamFlipTimer) {
      clearInterval(barStreamFlipTimer)
      barStreamFlipTimer = null
    }
    if (reconcileTimer) {
      clearInterval(reconcileTimer)
      reconcileTimer = null
    }
  }

  let visibilityHandler = null

  function startPolling() {
    if (pollingTimer) return
    // Remove any stale visibility listener from a previous startPolling call
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }

    const poll = () => {
      // Skip hidden tabs AND visible-but-idle tabs (idleManager). SSE keeps the
      // price live for active users; this poll only backfills OHLCV+volume.
      if (document.hidden || !isAppActive()) return
      subscribers.forEach(({ symbolInfo, resolution, onTick }) => {
        // Poll only serves the ACTIVE series (mirrors the stream guard) -
        // allBarsCache is the active resolution's alias.
        if (resolution !== activeResolution) return
        const to = Math.floor(Date.now() / 1000)
        const resSec = RES_SECONDS[resolution] || 60
        const lastMs = allBarsCache.length > 0 ? allBarsCache[allBarsCache.length - 1].time : 0
        // Cover the whole span since the last cached bar (bounded to ~500
        // buckets) so a stale cache backfills CONTIGUOUSLY. The old
        // now-120s window pushed only today's bar - after a long-hidden
        // tab that leapt the series across the missed buckets, freezing
        // whitespace holes into the chart (same class as the SSE leap).
        const from = lastMs > 0
          ? Math.max(Math.floor(lastMs / 1000), to - resSec * 500)
          : to - 120
        const reqSymKey = cacheSymbol // cross-token race guard (see backfillSeriesGap)
        fetchBars(actualSymbolRef?.current || symbolInfo.name, resolution, from, to).then(bars => {
          if (reqSymKey !== cacheSymbol || resolution !== activeResolution) return
          if (!Array.isArray(bars) || bars.length === 0) return
          allBarsCache = mergeBars(allBarsCache, bars)
          if (activeResolution) {
            resolutionCaches.set(activeResolution, allBarsCache)
            resolutionFetchedAt.set(activeResolution, Math.floor(Date.now() / 1000))
          }
          // Contiguous-from-TV's-edge push (never the raw fetch window).
          pushSeriesTail(resolution)
        }).catch(() => {})
      })
      healInteriorGaps(activeResolution) // self-throttled to ~2.5 min inside
    }

    // Bug fix 2026-06-03: was 5000 (5s) - meant LIVE_POLL_MS (60s) like the
    // resume case below. Active users who never alt-tabbed away burned getBars
    // at 12x the intended rate (~30K extra ops/day per audit round 2).
    pollingTimer = setInterval(poll, LIVE_POLL_MS)

    // Pause polling when tab is hidden, resume + immediate poll on visible
    visibilityHandler = () => {
      if (document.hidden) {
        clearInterval(pollingTimer)
        pollingTimer = null
      } else {
        poll()
        pollingTimer = setInterval(poll, LIVE_POLL_MS)
      }
    }
    document.addEventListener('visibilitychange', visibilityHandler)
  }

  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer)
      pollingTimer = null
    }
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
  }

  async function fetchJSON(url) {
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return resp.json()
  }

  const inflightRequests = new Map()

  async function fetchBars(symbol, resolution, from, to, countback, skipOnchain = false) {
    // Monthly: no upstream serves monthly bars (Codex tops out at 1D), so fetch
    // DAILY and aggregate into calendar months (UTC, true month boundaries)
    // client-side. Frontend-only → works in dev + prod with no server change.
    if (resolution === '1M') {
      const daily = await fetchBars(symbol, '1D', from, to, countback, skipOnchain)
      if (!Array.isArray(daily) || daily.length === 0) return daily // preserve _genesis tag
      return aggregateToMonths(daily)
    }
    // (genesis tag travels on the returned array — see the empty-result branch)
    // Bucket-rounded in-flight dedup. Two near-simultaneous fetches for the
    // same (symbol, resolution) within the same candle bucket are effectively
    // identical (the closed bar set hasn't changed in <bucket seconds), so
    // they should share one upstream call. Bucket = max(resolutionSeconds, 60)
    // so sub-minute resolutions still coalesce at 60s granularity.
    const resSec = RES_SECONDS[resolution] || 3600
    const bucket = Math.max(resSec, 60)
    const fromBucket = from != null ? Math.floor(from / bucket) : 'cb'
    const toBucket = to != null ? Math.ceil(to / bucket) : 'cb'
    const dedupKey = countback
      ? `${symbol}:${resolution}:cb${countback}`
      : `${symbol}:${resolution}:${fromBucket}:${toBucket}`
    if (inflightRequests.has(dedupKey)) {
      return inflightRequests.get(dedupKey)
    }

    // Parse address and networkId from "address:networkId" format. Strip the
    // ':mcap' Y-axis-mode suffix first so it never leaks into the address or
    // the upstream call - it rides the symbol identity only to force a re-feed
    // (see chartSymbol). Ticker-form majors ("BTC", "BTC:mcap") have no
    // networkId segment, so they parse to addr=ticker, netId=1.
    const cleanSymbol = symbol.endsWith(':mcap') ? symbol.slice(0, -5) : symbol
    let addr = cleanSymbol
    let netId = 1
    if (cleanSymbol.includes(':')) {
      const parts = cleanSymbol.split(':')
      addr = parts[0]
      netId = parseInt(parts[1]) || 1
    }
    // Safety: infer Solana from address format even if networkId is wrong
    netId = inferNetworkId(addr, netId)

    const promise = (async () => {
      // Fetch from server - skipOnchain on initial load to avoid 5-15s catastrophic path
      let result = await codexGetBars(addr, resolution, from, to, netId, { codexOnly: true, countback })
      // The /api/bars per-IP bucket (60/min) can 429 the chart when the page's
      // decorative sparklines flood it on load. The chart is the priority
      // consumer, so retry ONCE after a short backoff to let the burst drain -
      // otherwise the chart goes blank ("doesn't load at all"). Sparklines do
      // not retry. The sparkline concurrency cap (sparklineFetch.js) makes this
      // a rare belt-and-suspenders rather than the norm.
      if (result?.rateLimited && !result?.getBars?.length) {
        await new Promise(r => setTimeout(r, 900))
        result = await codexGetBars(addr, resolution, from, to, netId, { codexOnly: true, countback })
      }
      // Record an explicit server-side volume signal if present (S4 contract).
      // Only set on the FIRST decisive answer so a later scroll-back doesn't
      // flip a study that's already (not) created.
      if (volumeAvailable === null) {
        const serverFlag = result?.volumeAvailable ?? result?.meta?.volumeAvailable
        if (serverFlag === false) volumeAvailable = false
        else if (serverFlag === true) volumeAvailable = true
      }
      if (!result?.getBars?.length) {
        // Tag whether this empty is genuine GENESIS (server reached the token's
        // first bar -> x-spectre-tier 'no_data') vs a transient error/429. The
        // scroll-back path uses this to HARD-latch at genesis (stop TV probing
        // pre-genesis windows) without locking on a blip. Flag rides on the
        // array so it's race-free across concurrent fetches.
        const empty = []
        empty._genesis = result?.tier === 'no_data' && !result?.rateLimited
        return empty
      }
      const mapped = result.getBars.map(b => ({
        time: (b.t || 0) * 1000,
        open: b.o || 0,
        high: b.h || 0,
        low: b.l || 0,
        close: b.c || 0,
        volume: b.v || 0,
      }))
      return mapped
    })()

    inflightRequests.set(dedupKey, promise)
    promise.finally(() => inflightRequests.delete(dedupKey))
    return promise
  }

  function mergeBars(...arrays) {
    const map = new Map()
    for (const arr of arrays) {
      for (const b of arr) map.set(b.time, b)
    }
    return [...map.values()].sort((a, b) => a.time - b.time)
  }

  // TV v27 anchors the visible window by bar INDEX while it ingests a history
  // response, so a response that prepends far more bars than the ~300 TV asked
  // for (our merged-superset returns) slides the viewport hundreds of bars
  // into the past. Repro: TF-switch to a fine resolution keeps the previous
  // TF's wide TIME window, TV auto-pages history to fill it, each prepend
  // shifts the view - the user lands parked at the token's genesis candles
  // ("broken candles at the beginning", HOODRAT 15m/5m). Hold the visible
  // TIME range (module-level _sbViewAnchor, see its comment) across the whole
  // cascade and restore whenever an ingest visibly moved it (threshold 1.5
  // bars - see the check itself); a real user pan disables the checks via
  // the gesture stamp.
  function captureVisibleRange() {
    try {
      const r = persistentWidget?.activeChart?.()?.getVisibleRange?.()
      // GARBAGE GUARD (2026-08-06, caught live): during TV's transient states
      // (boot, mid-ingest) getVisibleRange returns near-zero ranges - a
      // capture of from=0 then made the restore setVisibleRange the chart to
      // 1970, injecting the exact epoch navigation the countBack fix killed.
      // No real view exists before the bars epoch - refuse the capture.
      if (!r || !Number.isFinite(r.from) || !Number.isFinite(r.to)) return null
      if (r.from < BARS_EPOCH_SEC) return null
      return { from: r.from, to: r.to }
    } catch { return null }
  }
  // Anchor accessor, called at DELIVERY time (never at request time - the
  // user keeps panning during the 0.3-2s page walk, and restoring to a
  // pre-fetch view yanked the chart back by however far they had dragged,
  // 2026-08-06). Reuses the standing anchor while the USER has not moved
  // since it was taken: TV's own ingest shifts must never mint a new
  // reference - that re-capture is exactly how the cascade drift legitimized
  // itself. A user pan invalidates the anchor (checks yield immediately) and
  // the next delivery re-captures from wherever they left the view.
  function sbAnchorFor(key) {
    const a = _sbViewAnchor
    if (a && a.key === key && _lastGestureTs <= a.at) {
      tvdbg('sb-anchor: hold to=' + a.to)
      return a
    }
    const cap = captureVisibleRange()
    if (!cap) return (a && a.key === key) ? a : null // mid-transient - keep what we have
    // Pixel anchor = right-edge time + bar spacing (not the [from..to] pair -
    // see the restore below for why `from` cannot be part of the contract).
    let spacing = null
    try {
      const ts = persistentWidget?.activeChart?.()?.getTimeScale?.()
      if (ts && typeof ts.barSpacing === 'function') spacing = ts.barSpacing()
    } catch { /* spacing restore skipped */ }
    _sbViewAnchor = { from: cap.from, to: cap.to, spacing, at: Date.now(), key }
    tvdbg('sb-anchor: fresh to=' + cap.to + ' bs=' + (spacing == null ? '?' : spacing.toFixed(2)))
    return _sbViewAnchor
  }
  function restoreViewportAfterPrepend(anchorKey, resSec) {
    const check = () => {
      try {
        const a = _sbViewAnchor
        if (!a || a.key !== anchorKey) return // anchor cleared/re-keyed - not ours
        if (_lastGestureTs > a.at) return // the USER took the viewport since - never fight a pan
        const chart = persistentWidget?.activeChart?.()
        if (!chart) return
        const cur = chart.getVisibleRange()
        if (!cur) return
        // TV mid-transient (see the capture guard): a near-zero cur is not a
        // real view - comparing against it produces phantom SNAPs. Skip; the
        // next scheduled check re-reads a settled range.
        if (cur.from < BARS_EPOCH_SEC) return
        // Compare the RIGHT edge + bar spacing, never `from`: on this
        // index-based (removeEmptyBars) axis, bars materializing INSIDE a
        // whitespace window legitimately change the left-edge TIME while the
        // view stands still - `from` drift is expected there, right-edge or
        // spacing drift is TV's shift. Threshold 1.5 bars (any ingest shift
        // is multi-bar - it equals the prepended count; sub-bar deltas are
        // float noise); the gesture guard above separates user pans.
        let curSp = null
        try { curSp = chart.getTimeScale?.()?.barSpacing?.() } catch { /* optional */ }
        const toMoved = Math.abs(cur.to - a.to) > resSec * 1.5
        const spMoved = a.spacing != null && curSp != null
          && Math.abs(curSp - a.spacing) > Math.max(a.spacing * 0.05, 0.05)
        if (toMoved || spMoved) {
          tvdbg('restoreViewport: SNAP', 'dTo=' + Math.round(cur.to - a.to),
            'dBs=' + (curSp != null && a.spacing != null ? (curSp - a.spacing).toFixed(2) : '?'))
          // Two-step, PIXEL-stable restore ("прыгает если есть пустое место",
          // 2026-08-14): setVisibleRange pins the right-edge TIME, then
          // setBarSpacing - which zooms FROM the right edge and sticks
          // (measured, same primitive smartFitChart relies on) - restores
          // pixels-per-bar. Every previously-visible candle keeps its index
          // distance to the right-edge bar across a prepend, so this puts
          // the old candles back on their exact pixels and lets new bars
          // fill the whitespace to the left. Restoring [from..to] alone
          // re-derived the spacing from the NEW bar count inside the window
          // and visibly re-shuffled the candles even though the time range
          // held. (setRightOffset would be the one-call primitive but is
          // INERT for scrolled-back views on this build - re-verified
          // 2026-08-14: ro=-379, setRightOffset(ro+30) is a no-op.)
          const p = chart.setVisibleRange({ from: a.from, to: a.to })
          const applySpacing = () => {
            if (a.spacing == null) return
            try { chart.getTimeScale?.()?.setBarSpacing?.(a.spacing) } catch { /* range restore stands */ }
          }
          if (p && typeof p.then === 'function') p.then(applySpacing, () => {})
          else applySpacing()
        } else {
          tvdbg('restoreViewport: hold', 'dTo=' + Math.round(cur.to - a.to))
        }
      } catch { /* chart mid-teardown - nothing to restore */ }
    }
    // TV ingests history responses on its own internal queue - check right
    // after delivery and again as the ingest settles. A LARGE superset
    // (1000-3000 bars) can take >200ms to ingest, and during an auto-page
    // cascade deliveries land ~0.8s apart, so the checks against the SHARED
    // anchor form near-continuous coverage. +1200ms covers the LAST
    // delivery's late shift (the one the old per-delivery scheme always
    // missed); the gesture guard makes the longer horizon safe (a user pan
    // disables every remaining check).
    setTimeout(check, 0)
    setTimeout(check, 200)
    setTimeout(check, 600)
    setTimeout(check, 1200)
    // Event-driven correction on top of the timers (2026-08-14, "график
    // прыгает влево при подгрузке" re-report): the ingest shift lands on TV's
    // own queue BETWEEN the timer checks and PAINTS for up to 200ms - a
    // multi-day index-space teleport flashing for a dozen frames IS the jump
    // users see, even though the next timer then restores it (their session
    // log: SNAP delta=-637500, i.e. 7.4 days, corrected but visibly late).
    // onVisibleRangeChanged fires on the tick of the change, so snapping from
    // it beats the paint. Re-entry is safe: our own setVisibleRange fires the
    // event again, the re-check sees delta 0 and no-ops; a user pan stamps
    // the gesture in capture phase BEFORE TV pans, so the guard yields first.
    try {
      const chart = persistentWidget?.activeChart?.()
      const sub = chart?.onVisibleRangeChanged?.()
      if (sub) {
        sub.subscribe(null, check)
        setTimeout(() => { try { sub.unsubscribe(null, check) } catch { /* widget gone */ } }, 1500)
      }
    } catch { /* timers still cover */ }
  }
  // Deliver a scroll-back result only when the user's gesture has gone QUIET.
  // TV's index-anchored ingest shifts the viewport by the prepended bar count,
  // and a delivery landing MID-DRAG cannot be corrected - the gesture guard
  // rightly refuses to fight an active pan, so the shift lands under the
  // user's finger and stays ("график прыгает влево при подгрузке", 2026-08-14
  // re-report; the earlier fixes only covered deliveries while the user
  // WAITED). Holding the callback until ~200ms of gesture silence means the
  // prepend never happens under an active gesture; the anchor+checks then own
  // the viewport. TV waits on its getBars callback indefinitely (it is
  // network-async anyway), and repeat requests for the held range are served
  // from allBarsCache, so nothing re-fetches. Cap 4s: a truly continuous
  // multi-second drag eventually gets its bars mid-gesture (rare; one
  // uncorrected shift beats starving the series).
  function deliverWhenQuiet(fn) {
    const started = Date.now()
    const tryDeliver = () => {
      const quiet = Date.now() - _lastGestureTs
      if (quiet >= 200 || Date.now() - started >= 4000) { fn(); return }
      setTimeout(tryDeliver, 90)
    }
    tryDeliver()
  }

  // Background deep-history prewarm REMOVED for the Codex-only Trading Platform:
  // each prewarmed window billed metered Codex. Deep history now loads lazily on
  // scroll-back (the datafeed fetches one older window per scroll, on demand).

  // GMGN-PARITY (2026-07-21, field-verified against gmgn.ai's candle API):
  // history bars flow RAW - no forward-fill. GMGN serves the last ~500 sparse
  // trade-bars per timeframe with ZERO synthetic fill; TV renders them
  // index-adjacent, so every candle on screen is a real trade. Our old
  // forwardFillBars flat stubs (v=0, o=h=l=c) were exactly the dash/dot mush
  // the reference lacks. stripSynthFill removes those legacy stubs when bars
  // re-enter from pre-parity caches/snapshots so old and new data never mix.
  function stripSynthFill(bars) {
    if (!Array.isArray(bars) || bars.length === 0) return bars
    const out = bars.filter(b => !(
      (b.volume === 0 || b.volume == null) &&
      b.open === b.close && b.high === b.low && b.high === b.open
    ))
    // A genuinely flat-but-real bar set (all filtered) must not vanish.
    return out.length > 0 ? out : bars
  }

  // Aggregate daily bars into calendar-MONTH candles,
  // bucketed by first-of-month UTC. Used by fetchBars for the 1M timeframe since
  // no upstream serves monthly bars. Consecutive months are dense so no further
  // fill is needed.
  function aggregateToMonths(bars) {
    if (!Array.isArray(bars) || bars.length === 0) return bars
    const months = new Map()
    for (const b of bars) {
      const d = new Date(b.time)
      const key = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) // first-of-month UTC (ms)
      const m = months.get(key)
      if (!m) {
        months.set(key, { time: key, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 })
      } else {
        m.high = Math.max(m.high, b.high)
        m.low = Math.min(m.low, b.low)
        m.close = b.close
        m.volume += (b.volume || 0)
      }
    }
    return [...months.values()].sort((a, b) => a.time - b.time)
  }

  return {
    // Earliest cached bar time (seconds). Kept as a marker for the getBars
    // cache bookkeeping. Scroll-back history is now loaded NATIVELY by TV v27
    // (getBars firstDataRequest=false), so the old custom loader + its helpers
    // (_fetchBars / _prependToCache / _noMoreHistory / _lastScrollFetchTo) are
    // removed.
    _earliestBarTime: null,

    // First-window volume availability (null=unknown, true/false once known).
    // setupChartFeatures reads this to skip the Volume study for no-volume
    // tokens. Exposed as a getter so the closure var is always current.
    get volumeAvailable() { return volumeAvailable },

    onReady(callback) {
      setTimeout(() => callback({
        // Phase J5: 1S removed - 1-second bars barely cache (5s bucket) and each
        // viewer hammered getBars; highest cost, lowest use. Other resolutions kept.
        supported_resolutions: ['1', '5', '15', '30', '60', '240', '720', '1D', '1W', '1M'],
        supports_marks: true,
        supports_timescale_marks: false,
        supports_time: false,
        exchanges: [
          { value: '', name: 'All Exchanges', desc: '' },
          { value: 'CRYPTO', name: 'Crypto', desc: '' },
        ],
        symbols_types: [
          { name: 'All types', value: '' },
          { name: 'Crypto', value: 'crypto' },
        ],
      }), 0)
    },

    async searchSymbols(userInput, exchange, symbolType, onResult) {
      try {
        const data = await fetchJSON(
          `${API_BASE}/api/tradingview/udf/search?query=${encodeURIComponent(userInput)}&limit=10`
        )
        onResult(Array.isArray(data) ? data : [])
      } catch {
        onResult([])
      }
    },

    resolveSymbol(symbolName, onResolve, onError) {
      mark('tv-resolve-enter')
      // TradingView requires resolveSymbol callbacks to fire asynchronously.
      // Calling onResolve synchronously triggers a console warning and can
      // interleave badly with TV's internal state machine on rapid symbol
      // switches. Defer with setTimeout(0) per TV's docs.
      setTimeout(() => {
        try {
          // symbolName from TV setSymbol() is the unique key (e.g. "0xaddr:1" or "BTC")
          // Use it as `name` so getBars cache comparison works across token switches
          const uniqueName = actualSymbolRef?.current || symbolName
          const currentTokenSymbol = tokenStreamRef?.current?.symbol?.toUpperCase()
          const displayTicker = currentTokenSymbol || (uniqueName.includes(':') ? uniqueName.split(':')[0].slice(0, 8) : uniqueName)
          const price = refPriceRef?.current || 0

          let pricescale = 100000000
          if (price > 0 && price < 1e12) {
            if (price >= 10000) pricescale = 100
            else if (price >= 100) pricescale = 10000
            else if (price >= 1) pricescale = 10000
            else if (price >= 0.01) pricescale = 1000000
            else if (price >= 0.0001) pricescale = 100000000
            else pricescale = 10000000000
          }

          onResolve({
            name: `${displayTicker}/USD`,
            ticker: uniqueName,
            full_name: `CRYPTO:${displayTicker}USD`,
            description: `${displayTicker}/USD`,
            type: 'crypto',
            session: '24x7',
            exchange: 'CRYPTO',
            listed_exchange: 'CRYPTO',
            timezone: 'Etc/UTC',
            has_intraday: true,
            has_seconds: true,
            seconds_multipliers: ['1'],
            has_daily: true,
            has_weekly_and_monthly: true,
            supported_resolutions: ['1', '5', '15', '30', '60', '240', '720', '1D', '1W', '1M'],
            pricescale,
            minmov: 1,
            currency_code: 'USD',
            data_status: 'streaming',
            volume_precision: 2,
          })
        } catch (e) {
          if (!noDataFired && onNoDataCb) { noDataFired = true; onNoDataCb() }
          onError(e.message || 'Failed to resolve symbol')
        }
      }, 0)
    },

    async getBars(symbolInfo, resolution, periodParams, onResult, onError) {
      if (periodParams?.firstDataRequest) mark('tv-getbars-enter')
      // Destructured OUTSIDE the try so the catch can read firstDataRequest:
      // a transient error on a scroll-back request (firstDataRequest=false)
      // must NOT fire onNoData and kill a chart that already painted.
      const { from, to, firstDataRequest } = periodParams || {}
      if (TV_DEBUG) {
        tvdbg('getBars', resolution, 'first=' + !!firstDataRequest, 'from=' + from, 'to=' + to, 'cb=' + (periodParams?.countBack ?? '-'))
        const _o = onResult
        onResult = (b, m) => { tvdbg('onResult', resolution, 'n=' + (Array.isArray(b) ? b.length : '?'), m && m.noData ? 'noData' : ''); _o(b, m) }
      }
      // First-window onResult wrapper (covers every result path uniformly):
      // records which symbol resulted (early-ready onDataLoaded gate) and
      // initializes TV's series edge (tvSeriesLastMs) - the anchor every
      // incremental pusher slices the cache tail from.
      if (firstDataRequest) {
        const _origOnResult = onResult
        const _reqKey = symbolInfo.ticker || symbolInfo.name
        onResult = (resBars, meta) => {
          // Only record the gates for the CURRENT symbol - a stale request
          // (token switched mid-flight) delivering its inert empty answer
          // must not clobber the live series' edge or the early-ready gate.
          if (_reqKey === cacheSymbol) {
            _lastFirstResultSymbol = _reqKey
            if (Array.isArray(resBars) && resBars.length > 0) {
              tvSeriesLastMs = resBars[resBars.length - 1].time
              // Separate from _lastFirstResultSymbol, which is also set for an
              // EMPTY first window (the no-data path). This one means "TV has
              // real candles for this symbol", which is what the cold-create
              // ready check in setupChartFeatures needs.
              _lastFirstPaintedSymbol = _reqKey
              // COLD-SWITCH early ready (mirror of the cold-create 2c check):
              // on a sparse token TV's setSymbol callback can wedge and never
              // fire (see the superset note in the scroll-back path), so the
              // component hooks this "real candles handed to TV" signal to
              // drop the shimmer itself instead of waiting on the library.
              try { this.onFirstWindowPaint?.(_reqKey) } catch { /* ready falls back to the callback */ }
            }
          }
          _origOnResult(resBars, meta)
        }
      }
      try {
        // Handle symbol change - clear all resolution caches
        // Use ticker (unique address:networkId key) not name (display label)
        const symKey = symbolInfo.ticker || symbolInfo.name
        if (symKey !== cacheSymbol) {
          resolutionCaches.clear()
          resolutionFetchedAt.clear()
          allBarsCache = []
          activeResolution = ''
          cacheSymbol = symKey
          tvSeriesLastMs = 0
          outlierStreak = 0
          this._historyExhaustedAt = null
          this._sbTransient = null
          this._genesisOldestSec?.clear() // first-window genesis is per-token
          _warmedSymbol = ''
          cancelWarm()
          _ihAttempts.clear() // interior-gap heal state is per-token
          _ihApplied = 0
          _ihLastCheck = 0
        }

        // Switch to the requested resolution's cache
        if (resolution !== activeResolution) {
          switchResolutionCache(resolution)
          // New TV series (per-resolution) - zero the edge until this
          // series' first-window onResult re-anchors it, so no in-flight
          // pusher slices the new cache from the old resolution's edge.
          tvSeriesLastMs = 0
          outlierStreak = 0
          // Upstream history depth differs per resolution (GT keeps far less
          // minute data than hourly) - the soft latch must be re-discovered.
          // (Genesis floor is module-level + per resolution, so it persists.)
          this._historyExhaustedAt = null
          this._sbTransient = null
        }

        // GMGN-DEPTH: the boot/warm windows are shallow by design (fast first
        // candle), which left 1m showing "a couple of hours" while GMGN holds
        // weeks. Page ONE deep window (countback 1500 trade-bars) for the
        // ACTIVE resolution in the background, merge it, then hand off to the
        // component (onDeepHistory -> resetData + full-range fit). Once per
        // symbol+resolution; scroll-back still pages further on demand.
        const scheduleDeepFill = () => {
          const dfKey = `${symKey}:${resolution}`
          if (this._deepFillKey === dfKey || allBarsCache.length >= 200) return
          // First-window genesis known (fresh token, whole life < 300 bars in
          // the buffer already) - a cb-1500 depth fetch can only return the
          // same bars. Skip it: one less Codex call per fresh token, and the
          // resetData repaint it would trigger never runs.
          if (this._genesisOldestSec?.has(resolution)) { tvdbg('deepFill skipped: genesis known'); return }
          this._deepFillKey = dfKey
          const deepSym = actualSymbolRef?.current || symbolInfo.ticker || symbolInfo.name
          const deepRes = resolution
          const self = this
          setTimeout(() => {
            // Reuse the boot-time WIDE prefetch first: on a thin snapshot
            // paint the wide-500 fetch is usually already in flight -
            // getCachedBars awaits that same promise (zero extra Codex).
            // Only fall to a fresh cb-1500 fetch when no prefetch exists.
            const cleanDeep = deepSym.endsWith(':mcap') ? deepSym.slice(0, -5) : deepSym
            const dAddr = cleanDeep.includes(':') ? cleanDeep.split(':')[0] : cleanDeep
            const dNet = cleanDeep.includes(':') ? parseInt(cleanDeep.split(':')[1]) || 1 : 1
            tvdbg('deepFill start', deepRes)
            Promise.resolve(getCachedBars(dAddr, dNet, deepRes)).catch(() => null).then(pre => {
              if (Array.isArray(pre) && pre.length >= 200) return pre
              return fetchBars(deepSym, deepRes, 0, Math.floor(Date.now() / 1000) + 60, 1500)
            }).then(deep => {
              tvdbg('deepFill done', deepRes, 'n=' + (deep ? deep.length : 0))
              if (symKey !== cacheSymbol || deepRes !== activeResolution || !deep || deep.length === 0) return
              const beforeOldest = allBarsCache.length ? allBarsCache[0].time : Infinity
              allBarsCache = mergeBars(allBarsCache, deep)
              resolutionCaches.set(activeResolution, allBarsCache)
              self._earliestBarTime = Math.floor(allBarsCache[0].time / 1000)
              // Only bother the chart when depth actually grew (and only if the
              // scroll-back path hasn't already fired the one-time hand-off).
              if (allBarsCache[0].time < beforeOldest && self._deepNotifiedKey !== dfKey) {
                self._deepNotifiedKey = dfKey
                try { self.onDeepHistory?.() } catch { /* noop */ }
              }
            }).catch(() => { /* scroll-back still pages on demand */ })
          }, 350)
        }

        if (firstDataRequest && allBarsCache.length > 0) {
          // INSTANT paint from the warm cache (0 network) — THE millisecond-switch
          // path. The old code AWAITED a fresh-tail fetch (~150-400ms) before
          // painting; now we paint the cache immediately and reconcile any
          // staleness with a NON-blocking tail fetch + the live stream, so a
          // timeframe switch never waits on Codex.
          this._earliestBarTime = Math.floor(allBarsCache[0].time / 1000)
          reportPriceRange(allBarsCache)
          onResult(scaleBars(allBarsCache), { noData: false })

          const lastTime = Math.floor(allBarsCache[allBarsCache.length - 1].time / 1000)
          const now = Math.floor(Date.now() / 1000)
          const fetchedAt = resolutionFetchedAt.get(resolution) || 0
          // Skip the tail revalidation when this resolution was (re)fetched very
          // recently (e.g. by the warm) - on a SPARSE token lastTime is always
          // >60s old, so without this every switch fires a redundant empty tail.
          if (now - lastTime > 60 && now - fetchedAt > 30) {
            const sym = actualSymbolRef?.current || symbolInfo.ticker || symbolInfo.name
            const reqRes = resolution
            fetchBars(sym, reqRes, lastTime, now + 60).then(fresh => {
              // Drop if the user switched resolution OR SYMBOL while in
              // flight. Same-resolution token switches made the old
              // resolution-only guard pass and merged the previous token's
              // tail into this one (cross-token race guard, 2026-07-10).
              if (symKey !== cacheSymbol || reqRes !== activeResolution || !fresh || fresh.length === 0) return
              // Forward-fill the tail like every painted range (sparse days
              // must not push a gapped sequence into the live series).
              allBarsCache = mergeBars(allBarsCache, fresh)
              resolutionCaches.set(activeResolution, allBarsCache)
              resolutionFetchedAt.set(activeResolution, Math.floor(Date.now() / 1000))
              // Contiguous-from-TV's-edge push. If TV hasn't subscribed yet
              // (this fetch races series creation) nothing is lost: the 180s
              // reconcile pushes the same cache tail once it has.
              pushSeriesTail(reqRes)
            }).catch(() => { /* live stream / reconcile will catch up */ })
          }
          scheduleDeepFill()
          return
        }

        // Fetch bars - try prefetch cache first, then from/to for scroll-back
        const sym = actualSymbolRef?.current || symbolInfo.ticker || symbolInfo.name
        const now = Math.floor(Date.now() / 1000)

        // History paging rework (2026-06-11, mirrors research TVA): TV asks
        // for ~300-bar scroll-back windows one at a time and each cost a full
        // upstream round-trip (GT pages 1000 bars per call - the narrow window
        // threw most away). Widen every scroll-back fetch to ~1000 intervals,
        // serve repeat pans from the cache with zero network, and stop TV from
        // probing past genesis forever once upstream history is exhausted.
        if (!firstDataRequest) {
          const resSec = RES_SECONDS[resolution] || 3600
          const gKey = _tvGenesisKey(sym, resolution)

          // (0) Absolute epoch floor (stateless, survives the cold parallel
          // volley + re-mounts where (A)/(B) have no state yet). No token on the
          // Codex/DEX or Binance path has OHLCV before 2017, yet TV marched
          // pre-genesis scroll-back back to 2005. Refuse outright - never clips
          // real data, kills the bulk of the runaway cascade with zero state.
          if (to < BARS_EPOCH_SEC) { onResult([], { noData: true }); return }

          // (A) Persistent genesis floor (module-level, survives re-mounts):
          // refuse anything at/older than the known history start, SYNCHRONOUSLY.
          // Kills the REPEAT pre-genesis cascades on token re-visit / re-mount.
          const gFloor = _tvGenesisFloor.get(gKey)
          if (gFloor != null && to <= gFloor) { onResult([], { noData: true }); return }

          // (A2) First-window genesis (see noteCompleteWindow at the top):
          // the complete from=0 first window already reached this token's
          // birth, so any window ending at/before our oldest bar can only be
          // empty - answer it synchronously instead of paying the network
          // round-trip TV fires on every fresh token right after the first
          // window lands. Instance-scoped; dies with resetCaches.
          const gOldest = this._genesisOldestSec?.get(resolution)
          if (gOldest != null && to <= gOldest) {
            tvdbg('genesis-first-window: instant noData', resolution)
            onResult([], { noData: true }); return
          }

          // (B, reworked 2026-08-05) SERIALIZED contiguous paging replaces the
          // old "refuse any window ending >500 bars before oldestCached with a
          // TERMINAL noData" guard. That guard assumed legitimate scroll-back
          // always asks for `to` ~ oldestCached — false the moment the user
          // zooms out: a 24h/зум-аут view on 1m spans far more than 500 bars
          // (8.3h), TV fires its history windows in rapid PARALLEL, and the
          // second window of the volley (whose `to` sat hours before the
          // not-yet-merged cache edge) got the terminal refusal — TV then
          // permanently stopped asking for history on that symbol+resolution
          // ("1m не догружает", founder 2026-08-05). 5m/15m never crossed the
          // 500-bar threshold under normal zoom, which is why only 1m died.
          //
          // The fix: every scroll-back request queues on a per-instance chain,
          // so each one sees the cache its predecessor merged (the volley race
          // is gone), and each request walks CONTIGUOUS pages from the buffer's
          // own left edge toward its `to` (bounded per request — a farther ask
          // simply continues on the next request). Fetching [to-1000, to]
          // directly when `to` is far left of the buffer would leave a HOLE
          // between the two regions — the "разрыв баров" class — so pages
          // always extend from the edge, never leapfrog it.
          //
          // The pre-genesis cascade the old guard defended against (SPECTRE
          // marching to 2005) stays dead: floors (0)/(A)/(A2) answer
          // synchronously above, and with serialization the first empty page
          // latches _historyExhaustedAt / the genesis floor BEFORE the next
          // queued window runs — no parallel billed-empty burst is possible.
          const self = this
          const sbTask = async () => {
            // Token/resolution may have changed while queued — orphaned series
            // gets a harmless empty answer (cross-token race guard).
            if (symKey !== cacheSymbol || resolution !== activeResolution) {
              onResult([], { noData: true })
              return
            }
            // Re-check the latches a predecessor page may have set.
            const gFloor2 = _tvGenesisFloor.get(gKey)
            if (gFloor2 != null && to <= gFloor2) { onResult([], { noData: true }); return }
            const gOldest2 = self._genesisOldestSec?.get(resolution)
            if (gOldest2 != null && to <= gOldest2) { onResult([], { noData: true }); return }
            if (self._historyExhaustedAt != null && to <= self._historyExhaustedAt + resSec) {
              // Latch EXPIRES after 60s (2026-06-11 audit): a transient blip
              // returning [] must not permanently lock scroll-back - worst
              // case post-expiry is one cheap re-probe per minute.
              if (Date.now() - (self._historyExhaustedTs || 0) < 60_000) {
                onResult([], { noData: true })
                return
              }
              self._historyExhaustedAt = null
            }

            let oldestCached2 = allBarsCache.length > 0 ? Math.floor(allBarsCache[0].time / 1000) : null
            const sbKey = symKey + ':' + resolution

            if (oldestCached2 != null && oldestCached2 <= from) {
              // SUPERSET, not the narrow [from..to) slice. TV's countBack is a
              // contract: an answer with FEWER bars than asked (a sparse series
              // has empty buckets inside a covered window) makes TV re-request
              // ever-smaller windows, degenerate into a whole-viewport ask
              // anchored at epoch 0 (its timescale is transiently [0,0] during
              // a symbol switch), and NEVER fire the setSymbol callback /
              // onDataLoaded - the chart sat finished under the shimmer for
              // 8-18s (measured on prod 2026-08-05, PONKE/RETARDIO 15m).
              // Answering with everything cached up to `to` is what the deep
              // page-walk below already does, and it measurably completes TV's
              // load (warm-switch trace: superset answer -> callback in 1ms).
              const toMs = to * 1000
              deliverWhenQuiet(() => {
                // The hold re-opens the token-switch race window - re-check.
                if (symKey !== cacheSymbol || resolution !== activeResolution) {
                  onResult([], { noData: true })
                  return
                }
                sbAnchorFor(sbKey)
                onResult(scaleBars(allBarsCache.filter(b => b.time < toMs)), { noData: false })
                restoreViewportAfterPrepend(sbKey, resSec)
              })
              return
            }

            const prevOldest = oldestCached2
            const preMergeCount = allBarsCache.length
            // Walk contiguous pages from the buffer edge toward `to`. Bounded:
            // 4 pages × 1500 trade-bars ≈ 100h of 1m per request — covers any
            // realistic zoom-out in one request; a deeper ask continues on the
            // next TV request from wherever this one stopped (progress lives
            // in allBarsCache, never lost).
            const MAX_PAGES = 4
            let fetchedAny = false
            for (let page = 0; page < MAX_PAGES; page++) {
              const pageTo = oldestCached2 != null ? Math.min(to, oldestCached2) : to
              const wideFrom = Math.min(from, pageTo - resSec * 1000)
              let got = await fetchBars(sym, resolution, wideFrom, pageTo, 1500)
              // Cross-token race guard: a scroll-back fetch resolving after a
              // same-resolution token switch merged the OLD token's deep history
              // into the NEW token's cache + series (the phantom pre-launch
              // candle clusters). Drop it.
              if (symKey !== cacheSymbol || resolution !== activeResolution) {
                onResult([], { noData: true })
                return
              }
              if (got.length === 0 && !got._genesis && !fetchedAny) {
                // TRANSIENT empty (a 429 that outlived fetchBars' own retry, the
                // 12s AbortSignal timeout, an upstream blip). `noData: true` is
                // TERMINAL in the TV datafeed contract - the widget permanently
                // stops asking for older history on this symbol+resolution - so
                // a single blip must not kill scroll-back for the whole session.
                // One awaited backoff + refetch converts almost all transients
                // into data (neither the client service nor the server KV
                // negative-caches empty results, so the retry re-hits upstream).
                await new Promise(r => setTimeout(r, 1200))
                got = await fetchBars(sym, resolution, wideFrom, pageTo, 1500)
                // The awaited retry re-opens the token-switch race window.
                if (symKey !== cacheSymbol || resolution !== activeResolution) {
                  onResult([], { noData: true })
                  return
                }
              }
              if (got.length === 0) {
                if (got._genesis) {
                  // Genuine genesis (server tier 'no_data') -> record the
                  // PERSISTENT floor (max known-empty `to`) so guard (A)
                  // short-circuits every later probe + re-mount synchronously.
                  self._historyExhaustedAt = pageTo
                  self._historyExhaustedTs = Date.now()
                  _tvGenesisFloor.set(gKey, Math.max(_tvGenesisFloor.get(gKey) || 0, pageTo))
                  if (!fetchedAny) { onResult([], { noData: true }); return }
                  break
                }
                // TRANSIENT empty (error/429/timeout that survived the awaited
                // retry above). `noData: true` is TERMINAL - TV never asks for
                // this range again, so answering it here killed scroll-back
                // for the whole session over one blip (the "тяну вправо и
                // ничего не грузится" report, 2026-08-06). Answer onError
                // instead: TV re-requests on the next drag. No latch - the
                // next attempt runs a real fetch. Bounded: after 3 transient
                // failures in 60s fall back to the old soft-latch + noData so
                // a dead upstream can't loop TV's error-retry forever.
                if (!fetchedAny) {
                  const tr = self._sbTransient
                  const now = Date.now()
                  self._sbTransient = (tr && now - tr.ts < 60_000)
                    ? { count: tr.count + 1, ts: now } : { count: 1, ts: now }
                  if (self._sbTransient.count >= 3) {
                    self._historyExhaustedAt = pageTo
                    self._historyExhaustedTs = now
                    onResult([], { noData: true })
                  } else if (typeof onError === 'function') {
                    tvdbg('scroll-back transient -> onError (retryable)', resolution)
                    onError('bars temporarily unavailable')
                  } else {
                    onResult([], { noData: true })
                  }
                  return
                }
                break
              }
              fetchedAny = true
              self._sbTransient = null // a real page landed - transient streak over
              // Forward-fill the scroll-back window like every other painted
              // range - the raw fetch is removeEmptyBars-sparse, and serving it
              // unfilled put GAPPED history into the series while the initial
              // window was filled. Re-filling the merged cache also bridges the
              // SEAM between this older window and the previously cached region.
              allBarsCache = mergeBars(allBarsCache, got)
              if (activeResolution) resolutionCaches.set(activeResolution, allBarsCache)
              self._earliestBarTime = Math.floor(allBarsCache[0].time / 1000)
              if (oldestCached2 != null && self._earliestBarTime >= oldestCached2) {
                // Page added nothing older — upstream history ends here.
                self._historyExhaustedAt = self._earliestBarTime
                self._historyExhaustedTs = Date.now()
                break
              }
              oldestCached2 = self._earliestBarTime
              if (oldestCached2 <= to) break // buffer now reaches the asked window
            }

            // Return the whole FILLED superset up to the pre-walk buffer edge
            // (TV accepts bars older than `from` on history requests) - fills
            // several future pans in one shot. Never send bars NEWER than the
            // edge TV already had - it holds them.
            const capMs = (prevOldest != null ? prevOldest : to) * 1000
            deliverWhenQuiet(() => {
              // The hold re-opens the token-switch race window - re-check.
              if (symKey !== cacheSymbol || resolution !== activeResolution) {
                onResult([], { noData: true })
                return
              }
              // Anchor resolved at DELIVERY time (see sbAnchorFor) - held
              // across the cascade unless the user has panned since.
              sbAnchorFor(sbKey)
              onResult(scaleBars(allBarsCache.filter(b => b.time <= capMs)), { noData: false })
              // FIRST deep page landed for this symbol+resolution. TV usually
              // auto-pages right after the initial fit (its visible range wants
              // more history), which SKIPS scheduleDeepFill's own fetch - so the
              // one-time "depth arrived -> re-feed + full-range fit" hand-off must
              // fire from HERE too, or the default view stays a couple-hour crop
              // while weeks sit in the cache. Once per sym+res; later user
              // scroll-back pages keep their viewport (restoreViewportAfterPrepend).
              if (self._deepNotifiedKey !== sbKey && preMergeCount < 200 && allBarsCache.length > preMergeCount) {
                self._deepNotifiedKey = sbKey
                // No viewport restore on this one: the refit below re-frames to the
                // full buffer - restoring the pre-merge crop would pin a degenerate
                // (sometimes single-candle) view the refit then races. Drop the
                // anchor so no later check fights the deliberate refit either.
                clearSbViewAnchor()
                try { self.onDeepHistory?.() } catch { /* view stays - depth still scrollable */ }
              } else {
                restoreViewportAfterPrepend(sbKey, resSec)
              }
            })
          }
          // Queue on the per-instance chain. Errors inside the task must reach
          // TV's onError (a transient failure on scroll-back must not nuke an
          // already-painted chart - same contract as the outer catch) and must
          // never break the chain for later requests.
          this._sbChain = (this._sbChain || Promise.resolve()).then(sbTask, sbTask).catch((e) => {
            console.error('[TV] scroll-back error:', e)
            try { onError(e?.message || 'getBars failed') } catch { /* noop */ }
          })
          return
        }

        let bars
        let fullPrefetch = null
        if (firstDataRequest) {
          // Try prefetch cache first (populated at token click time, before chart mounts).
          // Strip the ':mcap' suffix so the cache key matches the raw address.
          const cleanSym = sym.endsWith(':mcap') ? sym.slice(0, -5) : sym
          const addr = cleanSym.includes(':') ? cleanSym.split(':')[0] : cleanSym
          const netId = cleanSym.includes(':') ? parseInt(cleanSym.split(':')[1]) || 1 : 1

          // P5 — sessionStorage SWR seed: a PERSISTED hot snapshot (survives hard
          // reload + token switch) lets a RE-OPEN of a recently-viewed token paint
          // the chart INSTANTLY (0 network) instead of paying the cold Codex RTT
          // again. Only when the requested resolution matches the snapshot's saved
          // TF. The recent tail is revalidated in the background (push via onTick),
          // and the TF warm is scheduled so switches stay instant too.
          if (allBarsCache.length === 0) {
            const snap = readHotSnapshot(addr)
            const rawSnapBars = snap?.bars?.bars || snap?.bars
            if (snap && resolution === (snap.barsResolution || '60')
                && Array.isArray(rawSnapBars) && rawSnapBars.length >= 50) {
              const resSec = RES_SECONDS[resolution] || 3600
              // Snapshot rows are RAW /api/bars output ({ t,o,h,l,c,v } with t
              // in SECONDS, or [t,o,h,l,c,v] array form) - NOT the { time(ms),
              // open,... } shape scaleBars/onResult expect.
              // Feeding them unmapped left every bar with time:undefined, so TV
              // threw "Invalid time value" (new Date(undefined).toISOString())
              // inside onResult; the catch reported no-data and silently dropped
              // the chart to Candles. Normalize + drop any non-finite timestamp.
              const snapBars = rawSnapBars.map(b => {
                const ts = Array.isArray(b)
                  ? Number(b[0])
                  : Number(b?.t ?? (b?.time != null ? b.time / 1000 : NaN))
                if (!Number.isFinite(ts)) return null
                const num = (arrIdx, ...keys) => {
                  if (Array.isArray(b)) return Number(b[arrIdx]) || 0
                  for (const k of keys) if (b?.[k] != null) return Number(b[k]) || 0
                  return 0
                }
                return {
                  time: ts * 1000,
                  open: num(1, 'o', 'open'),
                  high: num(2, 'h', 'high'),
                  low: num(3, 'l', 'low'),
                  close: num(4, 'c', 'close'),
                  volume: num(5, 'v', 'volume'),
                }
              }).filter(Boolean)
              if (snapBars.length >= 50) {
                // countBack contract (2026-08-06, the 1m latch root cause): TV
                // requires AT LEAST cb bars for a countBack request - an answer
                // even 2-3 bars short reads as "more history exists", and TV
                // escalates through an epoch-anchored request (from<0,
                // cb=to/60) into latching history COMPLETE at whatever that
                // answer held: the reload 2-bar flash + scroll-back dead for
                // the session. The snapshot window is exactly cb buckets, so
                // stripSynthFill's purity pass (dropping the server's flat
                // v=0 fill bars) is what CREATES the shortfall on any quiet
                // minute. Keep the fill bars when the stripped set undershoots
                // - 2-3 flat ticks among 300 is invisible; a latched chart is
                // not.
                const cbHot = periodParams?.countBack || 0
                let hotBars = stripSynthFill(snapBars)
                if (cbHot > hotBars.length && snapBars.length > hotBars.length) hotBars = snapBars
                allBarsCache = hotBars
                resolutionCaches.set(resolution, allBarsCache)
                this._earliestBarTime = Math.floor(allBarsCache[0].time / 1000)
                const fromMs = from * 1000
                let visible = allBarsCache.filter(b => b.time >= fromMs)
                if (cbHot > visible.length && allBarsCache.length > visible.length) {
                  visible = allBarsCache.slice(-cbHot)
                }
                if (visible.length < 50) visible = allBarsCache
                reportPriceRange(allBarsCache)
                onResult(scaleBars(visible), { noData: false })
                const reqRes = resolution
                const lastT = Math.floor(allBarsCache[allBarsCache.length - 1].time / 1000)
                const nowS = Math.floor(Date.now() / 1000)
                if (nowS - lastT > 60) {
                  fetchBars(sym, reqRes, lastT, nowS + 60).then(fresh => {
                    // Cross-token race guard (see backfillSeriesGap note).
                    if (symKey !== cacheSymbol || reqRes !== activeResolution || !fresh || fresh.length === 0) return
                    // Forward-fill the tail like every painted range - a
                    // stale snapshot can be DAYS behind, and this backfill
                    // must land as one contiguous ascending sequence.
                    allBarsCache = mergeBars(allBarsCache, fresh)
                    resolutionCaches.set(activeResolution, allBarsCache)
                    resolutionFetchedAt.set(activeResolution, Math.floor(Date.now() / 1000))
                    // Contiguous-from-TV's-edge push (see pushSeriesTail).
                    pushSeriesTail(reqRes)
                  }).catch(() => { /* live stream / reconcile catches up */ })
                }
                scheduleWarmOnce(sym)
                return
              }
            }
          }

          // INSTANT-SWITCH via client-side aggregation (GMGN-parity): if this is
          // a coarse resolution we can build from an already-loaded finer one
          // (e.g. 4H from the 1H bars cached when the user was just on 1H -
          // switchResolutionCache saved them into resolutionCaches before this
          // request), aggregate it IN MEMORY - ZERO network, ZERO Codex - instead
          // of a cold ~1s fetch. The derived window paints instantly; native
          // scroll-back + the live stream reconcile older/newer ranges. Falls
          // through to the prefetch/fetch path when no finer resolution is loaded.
          let derived = null
          const _sources = DERIVE_SOURCES[resolution]
          if (_sources) {
            for (const fineRes of _sources) {
              const fine = resolutionCaches.get(fineRes)
              if (fine && fine.length >= 50) {
                // COVERAGE GUARD (critical): only derive when the finer source's
                // OLDEST bar reaches back to the requested `from`, i.e. it covers
                // the whole visible window. A finer source is capped at ~1500
                // bars, so deriving a COARSE TF from it would otherwise span far
                // less history than a direct fetch (e.g. 12H from 1H = ~2 months,
                // not 2 years) -> a TRUNCATED chart; and deriving a recent-only
                // window then merging with a deep scroll-back fetch leaves a HOLE.
                // When the source can't cover `from`, fall through to a clean deep
                // fetch. New tokens (whole life in 1m) always cover -> derive all.
                const fineOldestSec = Math.floor(fine[0].time / 1000)
                if (Number.isFinite(from) && fineOldestSec > from) continue
                const agg = aggregateBars(fine, RES_SECONDS[resolution] || 3600)
                if (agg.length >= 50) { derived = agg; break }
              }
            }
          }
          if (derived) {
            // Already gap-free (aggregated from forward-filled fine bars) + raw
            // (scaleBars runs at send time, mcap-safe). Cache the full set for
            // scroll-back; send the visible slice.
            fullPrefetch = derived
            const fromMs = from * 1000
            bars = derived.filter(b => b.time >= fromMs)
            if (bars.length < 50) bars = derived
          } else {
          const cbWanted = periodParams?.countBack || 0
          const cachedEntry = await getCachedBarsEntry(addr, netId, resolution)
          let prefetched = cachedEntry?.bars || null
          // Snapshot-join: on an in-app token switch, selectToken fired the
          // aggregate snapshot (which now carries bars at the SAVED timeframe)
          // synchronously in the click handler - but this getBars can run
          // before its .then() seeds the cache. When a snapshot is pending or
          // fresh for this token, await it (bounded 4s), seed idempotently and
          // re-read - instead of racing it with a redundant cold wide fetch.
          // Never ORIGINATES a snapshot (hasSnapshotPending gate) and never
          // throws (both race arms resolve null).
          //
          // ANY cached bars are trusted (was `> 50`) - with ONE exception: the
          // '-countback' key is written by from=0 wide fetches (prewarm),
          // whose short entries genuinely mean a young token's whole life,
          // AND by snapshot seeds (origin:'snapshot'), whose entries are a
          // 300-bucket PARTIAL window. A snapshot window that cannot cover
          // TV's countBack must not be served as the first window: TV treats
          // the shortfall as "more history exists", escalates into its
          // epoch-anchored request and latches history complete (the 2026-08-06
          // reload flash + dead 1m scroll-back). Fall through to the race so
          // the wide arm can answer with the full window instead.
          const snapshotTooShort = cachedEntry?.origin === 'snapshot'
            && cbWanted > 0 && (prefetched?.length || 0) < cbWanted
          if (snapshotTooShort) prefetched = null
          if (!(prefetched?.length > 0) && (hasSnapshotPending(addr, netId) || snapshotTooShort)) {
            // Awaiting the snapshot ALONE means waiting on its slowest member.
            // Measured on prod 2026-08-04: the snapshot is a 4-member fan-out
            // (details 0.93-1.27s, bars 0.64-1.36s, trades 0.82-0.93s) and
            // lands in ~1.5s cold, while the bars this path actually needs are
            // one 0.65-0.9s call. The chart sat on the slower number.
            //
            // So: run the direct bars fetch ALONGSIDE the snapshot; first bars
            // win. The snapshot arm still runs to completion because its seed
            // is what fills details/trades for the rest of the page.
            //
            // The first cut of this gave the snapshot a 400ms head start, on
            // the theory that a warm one would answer inside it and save the
            // extra Codex call. Measured on prod 2026-08-04, 7 unvisited
            // tokens, both fired on the same tick:
            //
            //   snapshot  2348 1572 1575 1373 1373 1352 2059  (median 1573)
            //   bars       887  767  670  765  666  643  726  (median  726)
            //
            // Direct bars won 7/7 by 608-1461ms. For the head start to save a
            // call the snapshot would have to land within ~550ms of the click,
            // which it never does - so the direct arm fired anyway, every
            // time, 400ms late. It bought nothing and cost 400ms on every cold
            // open. Firing on the same tick spends exactly what we already
            // spent, just without the dead wait.
            //
            // fetchBars dedups in-flight by symbol:resolution:window, and the
            // wide fallback below uses the SAME (0, to) window - so a direct
            // arm that loses the race is still the request that path would
            // have made, not an additional one.
            const viaSnapshot = (async () => {
              const snap = await Promise.race([
                fetchTokenSnapshot(addr, netId).catch(() => null),
                new Promise(r => setTimeout(() => r(null), 4000)),
              ])
              if (snap) { try { seedCachesFromSnapshot(snap) } catch { /* seed is best-effort */ } }
              return getCachedBars(addr, netId, resolution)
            })()

            const viaDirect = fetchBars(sym, resolution, 0, to).catch(() => [])

            // First arm that actually has bars wins; if both come back empty,
            // fall through to the wide fetch below exactly as before.
            // (2026-08-06, SKYAI reload giant-candles) A non-empty but TINY
            // arm can be a DEGRADED slice - a snapshot assembled while the
            // upstream was blipping carries 2-3 bars, and on a reload the GP6
            // snapshot promise is already in flight so that arm settles first.
            // Accepting it paints a 2-candle full-pane chart AND latches
            // first-window genesis (scroll-back dead for the session). Accept
            // an arm immediately only when it looks like a real window;
            // otherwise hold it and let the other arm try to beat it. Both
            // arms tiny (a genuinely fresh token) still resolves with the
            // best of the two once both settle.
            // Immediate-accept thresholds differ per arm: the snapshot arm
            // must also cover TV's countBack (its window is a fixed 300
            // buckets - short of cb it would re-trigger the escalation this
            // path exists to avoid); the direct arm is the authoritative wide
            // window, so its short answer means the token's whole life.
            const MIN_TRUSTED_FIRST_WINDOW = 50
            const snapNeed = Math.max(MIN_TRUSTED_FIRST_WINDOW, cbWanted)
            prefetched = await new Promise((resolve) => {
              let left = 2
              let best = []
              const mkSettle = (need) => (v) => {
                const arr = Array.isArray(v) ? v : []
                if (arr.length > best.length) best = arr
                if (arr.length >= need) resolve(arr)
                else if (--left === 0) resolve(best)
              }
              const settleSnap = mkSettle(snapNeed)
              const settleDirect = mkSettle(MIN_TRUSTED_FIRST_WINDOW)
              viaSnapshot.then(settleSnap, () => settleSnap(null))
              viaDirect.then(settleDirect, () => settleDirect(null))
            })
          }
          if (prefetched?.length > 0) {
            // Prefetch uses countback=1500 which may include very old bars with
            // extreme volume (token launch). Trim to TV's from/to range so the
            // volume scale isn't crushed. Keep full data in cache for scroll-back.
            fullPrefetch = stripSynthFill(prefetched)
            noteCompleteWindow(this, resolution, fullPrefetch)
            const fromMs = from * 1000
            bars = fullPrefetch.filter(b => b.time >= fromMs)
            // countBack CONTRACT (2026-08-06, the 1m latch root cause): for a
            // countBack request TV requires AT LEAST cb bars - `from` is
            // secondary (per the datafeed contract, and per TV v27's measured
            // behavior). A removeEmptyBars-sparse series NEVER fills a span
            // exactly (301 buckets, 2 quiet minutes -> 298 bars), and TV
            // treats the shortfall as "more history exists": it escalates
            // through tiny follow-ups into an epoch-anchored request
            // (from<0, cb=to/60), renders the 56-year viewport while it's in
            // flight (the reload "2-bar flash"), then latches history
            // COMPLETE at whatever that answer held - scroll-back dead for
            // the session ("тяну вправо - не грузится"). Serving the newest
            // cb bars instead satisfies the contract, so the escalation
            // never starts: TV pages politely and every drag keeps loading.
            if (cbWanted > bars.length && fullPrefetch.length > bars.length) {
              bars = fullPrefetch.slice(-cbWanted)
            }
            if (bars.length < 50) bars = fullPrefetch
          } else {
            // Prefetch MISS. WIDE probe = the server's "last 500 trade-bars"
            // (GMGN's exact boot shape). Re-measured 2026-07-21 post-server-
            // clamp: 0.8-2.4s cold / 0.35s warm - the old "from=0 is 7.4s"
            // note predates the wide clamp. One shape everywhere (prefetch,
            // warm loop, boot) = one KV bucket per res, and a 500-bar first
            // paint means the deep-fill repaint (resetData flash) never runs
            // on a normal boot - single clean paint.
            const wide = await fetchBars(sym, resolution, 0, to)
            noteCompleteWindow(this, resolution, wide)
            if (wide.length > 50) {
              fullPrefetch = wide
              const fromMs = from * 1000
              bars = fullPrefetch.filter(b => b.time >= fromMs)
              // countBack contract - see the prefetch branch above.
              if (cbWanted > bars.length && fullPrefetch.length > bars.length) {
                bars = fullPrefetch.slice(-cbWanted)
              }
              if (bars.length < 50) bars = fullPrefetch
            } else {
              bars = wide
            }
          }
          }
        } else {
          bars = await fetchBars(sym, resolution, from, to)
        }

        // Thin-token probe (2026-06-10, mirrors research TVA): an empty FIRST
        // window is not "this token has no data" — sparse DEX tokens can go
        // hours without a trade, so TV's initial visible-range request can be
        // legitimately empty while months of history exist. Probe ~1500
        // intervals before declaring no-data and falling back.
        if (firstDataRequest && bars.length === 0) {
          const resSec = RES_SECONDS[resolution] || 3600
          const wideFrom = Math.min(from, to - resSec * 1500)
          if (wideFrom < from) {
            try { bars = await fetchBars(sym, resolution, wideFrom, to) } catch { /* keep empty */ }
          }
        }

        // Cross-token race guard: everything below writes allBarsCache /
        // resolutionCaches and feeds TV. A fetch that started for a previous
        // token (or resolution) resolving late must be DROPPED, not merged -
        // and must NOT fire onNoDataCb (that would flip the CURRENT token's
        // chart to the canvas fallback over a phantom).
        if (symKey !== cacheSymbol || (activeResolution && resolution !== activeResolution)) {
          onResult([], { noData: true })
          return
        }

        // Detect bad data
        const isBadData = bars.length > 0 && (() => {
          const recent = bars.slice(-30)
          if (recent.every(b => b.open === 0 && b.high === 0 && b.low === 0 && b.close === 0)) return true
          if (recent.some(b => [b.open, b.high, b.low, b.close].some(v => !Number.isFinite(v) || v < 0 || v > 1e12))) return true

          const knownPrice = refPriceRef?.current
          if (knownPrice > 0) {
            const closes = recent.map(b => b.close).filter(v => v > 0)
            if (closes.length === 0) return true
            closes.sort((a, b) => a - b)
            const median = closes[Math.floor(closes.length / 2)]
            const ratio = median > knownPrice ? median / knownPrice : knownPrice / median
            if (ratio > 100) return true
          }

          return false
        })()

        if (bars.length === 0 || isBadData) {
          if (firstDataRequest && !noDataFired && onNoDataCb) { noDataFired = true; onNoDataCb() }
          onResult([], { noData: true })
        } else {
          if (firstDataRequest) {
            // Record volume availability from the first real window if the
            // server didn't already give an explicit flag. If EVERY bar has
            // zero volume, the Volume study would be a flat zero line - skip it.
            const windowSample = fullPrefetch ? fullPrefetch : bars
            const windowHasVolume = windowSample.some(b => (b.volume || 0) > 0)
            if (volumeAvailable === null) {
              volumeAvailable = windowHasVolume
            }
            // Per-resolution volume signal: the same pair can have full
            // intraday volume yet all-zero 1D volume (Codex daily rollup),
            // so the widget adds/removes the study per active resolution.
            if (typeof onVolumeWindow === 'function') {
              try { onVolumeWindow(windowHasVolume) } catch { /* widget disposed */ }
            }
            // Store full prefetch data in cache for scroll-back, but send trimmed bars to TV
            allBarsCache = fullPrefetch ? fullPrefetch : bars
          } else {
            // Merge scroll-back history into existing cache (don't replace)
            allBarsCache = mergeBars(allBarsCache, bars)
          }
          if (activeResolution) {
            resolutionCaches.set(activeResolution, allBarsCache)
            resolutionFetchedAt.set(activeResolution, Math.floor(Date.now() / 1000))
          }
          this._earliestBarTime = Math.floor(allBarsCache[0].time / 1000)
          if (firstDataRequest) { reportPriceRange(allBarsCache); mark('tv-first-result') }
          onResult(scaleBars(bars), { noData: false })
          // First paint is up -> background-warm the other timeframe buttons on
          // idle so subsequent switches are instant cache hits (once per symbol).
          if (firstDataRequest) scheduleWarmOnce(sym)
          if (firstDataRequest) scheduleDeepFill()
        }
      } catch (e) {
        console.error('[TV] getBars error:', e)
        // Only surface no-data on the FIRST request. A transient failure on a
        // scroll-back (firstDataRequest=false) must not nuke an already-painted
        // chart into the fallback - just report the error to TV and keep going.
        if (firstDataRequest && !noDataFired && onNoDataCb) { noDataFired = true; onNoDataCb() }
        onError(e.message || 'getBars failed')
      }
    },

    subscribeBars(symbolInfo, resolution, onTick, listenerGuid, onResetCacheNeededCallback) {
      _dfSelf = this // interior-gap heal fires onGapHealed through this handle
      // MONOTONIC tick gate: TV's series accepts only last-bar updates or
      // strictly-newer appends - any older push throws "putToCacheNewBar:
      // time violation" and is dropped. Multiple writers feed onTick (SSE
      // stream, tail revalidations, gap backfill, reconcile) and can
      // interleave, so enforce ordering HERE once. The gate advances the
      // SHARED tvSeriesLastMs (initialized by the first-window onResult) -
      // the same edge pushSeriesTail slices from, so the gate and the
      // pushers can never disagree about what TV has (the old private
      // per-subscriber lastTs could run ahead of pushers' assumptions and
      // silently discard heal pushes - the frozen-hole class).
      const monotonicTick = (bar) => {
        if (!bar || !Number.isFinite(bar.time) || bar.time < tvSeriesLastMs) return
        tvSeriesLastMs = bar.time
        onTick(bar)
      }
      subscribers.set(listenerGuid, {
        symbolInfo, resolution, onTick: monotonicTick,
        // TV v27: resetData() alone re-renders from TV's INTERNAL bars cache -
        // it re-requests through the datafeed ONLY after this callback marks
        // the cache dirty (measured 2026-08-14: a resetData without it fired
        // ZERO getBars and the series stayed stale). The interior-gap heal
        // calls invalidateTVCache() right before resetData for this reason.
        onResetCache: onResetCacheNeededCallback,
      })
      startStreaming(resolution)
    },

    // Mark TV's internal bars cache dirty so the NEXT resetData actually
    // re-requests through getBars (see the onResetCache note above).
    invalidateTVCache() {
      for (const sub of subscribers.values()) {
        try { sub.onResetCache?.() } catch { /* best-effort per series */ }
      }
    },

    unsubscribeBars(listenerGuid) {
      subscribers.delete(listenerGuid)
      if (subscribers.size === 0) {
        stopStreaming()
        stopPolling()
      }
    },

    getMarks(symbolInfo, from, to, onDataCallback) {
      const marks = tradeMarkerData
        .filter(t => t.timestamp >= from && t.timestamp <= to)
        .map((trade, i) => {
          const isBuy = trade.type === 'Buy'
          const amt = (trade.amountUSD || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
          const date = new Date(trade.timestamp * 1000)
          const dateStr = date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' })
          return {
            id: `tm_${trade.txHash || i}_${trade.timestamp}`,
            time: trade.timestamp,
            color: { border: isBuy ? '#10b981' : '#ef4444', background: isBuy ? '#10b981' : '#ef4444' },
            text: `${isBuy ? 'Bought' : 'Sold'} $${amt} on ${dateStr}`,
            label: isBuy ? 'B' : 'S',
            labelFontColor: '#ffffff',
            minSize: 20,
          }
        })
      onDataCallback(marks)
    },

    // Called when topPairAddress arrives late - reconnect the bars stream
    reconnectStream(res) {
      if (subscribers.size > 0) {
        startStreaming(res || '60')
      }
    },

    // Reset bar caches for symbol switch (without destroying the widget).
    // Mirrors getBars' inline symbol-change clear EXACTLY - it used to omit
    // resolutionFetchedAt / the history latch / the warm state, leaving a
    // fragile window until the next getBars healed it (2026-07-10 audit).
    resetCaches() {
      resolutionCaches.clear()
      resolutionFetchedAt.clear()
      allBarsCache = []
      activeResolution = ''
      cacheSymbol = ''
      noDataFired = false
      tvSeriesLastMs = 0 // new series - the first-window onResult re-anchors it
      outlierStreak = 0
      volumeAvailable = null // re-decide volume per token
      _ihAttempts.clear() // interior-gap heal state is per-token
      _ihApplied = 0
      _ihLastCheck = 0
      this._earliestBarTime = null
      this._historyExhaustedAt = null
      this._sbTransient = null
      this._genesisOldestSec?.clear() // first-window genesis is per-token
      _warmedSymbol = ''
      cancelWarm()
    },

    // Clean up all connections when widget is destroyed (token switch)
    destroy() {
      stopStreaming()
      stopPolling()
      subscribers.clear()
    },

    setTradeMarkers(markers) {
      tradeMarkerData = markers || []
    },

    // Loaded-series extent for the component's smart fit. TV PERSISTS
    // barSpacing across setSymbol, so a fit that only sets rightOffset
    // renders a short-history token as a cramped sliver in a mostly-empty
    // pane (the "broken candles" look) whenever the previous token had a
    // long series. Time-based setVisibleRange from this extent is the fix.
    //
    // startSecForLastBars(n) returns the ACTUAL timestamp of the nth-from-
    // last bar - never derive it as lastSec - n*resSec: sparse dead tokens
    // (MARV: 188 traded 4H bars across a YEAR, gaps up to 24 days) have
    // bar-index space wildly different from wall-clock space, and the
    // arithmetic version framed a months-wide window as if it were days.
    getLoadedRange() {
      if (!allBarsCache.length) return null
      return {
        firstSec: Math.floor(allBarsCache[0].time / 1000),
        lastSec: Math.floor(allBarsCache[allBarsCache.length - 1].time / 1000),
        count: allBarsCache.length,
        resSec: RES_SECONDS[activeResolution] || 3600,
        startSecForLastBars: (n) => {
          const idx = Math.max(0, allBarsCache.length - Math.max(1, n))
          return Math.floor(allBarsCache[idx].time / 1000)
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Widget lifecycle state - module-level so overlapping mounts / StrictMode
// double-mounts / create retries can always find and scrap a live widget.
// NOT reused across unmounts anymore (2026-07-09): re-parenting the container
// reloads the TV iframe and the stale wrapper silently stops switching
// symbols - the unmount cleanup does a full teardown and every mount
// creates fresh.
// ---------------------------------------------------------------------------
let persistentWidget = null
let persistentContainer = null
let persistentDatafeed = null
// Unique symbol key of the last FIRST-window getBars that RESULTED (set in
// the datafeed's onResult wrapper). The early-ready onDataLoaded handler
// compares it to the live symbol so a stale scroll-back load finishing
// right after a token switch can't drop the shimmer onto the OLD chart.
let _lastFirstResultSymbol = null
// Same, but only set when that first window actually carried bars.
let _lastFirstPaintedSymbol = null
// Learned correct quoteToken side per pairId for the authoritative bar stream
// (token0 | token1). Codex prices onBarsUpdated per side; the wrong side yields
// the other token's price (broken candles). Once a side validates we cache it
// so TF switches / re-subscribes on the same pair start correct with no flip.
const _pairQuoteSide = new Map()
// Form factor the live widget was BUILT for (true = mobile chrome: no
// left_toolbar / header_widget / control_bar). Kept for diagnostics.
let persistentWidgetIsMobile = null
// True once the live widget's onChartReady has fired at least once.
let persistentReady = false

/**
 * Paint the library's OWN chrome (left drawing rail, top toolbar strip, the
 * root layout wrapper) to match the chart background.
 *
 * The canvas background comes from paneProperties.background; the chrome comes
 * from the library's --tv-color-platform-background, which tv-custom.css can
 * only set to a STATIC value. So the moment the chart bg becomes dynamic (a
 * picked background tone, a custom chart bg, day mode) the two drift and the
 * rail reads as a differently-shaded column beside the candles.
 *
 * Writing the vars inline on the iframe's <html> beats the stylesheet rule, and
 * tv-custom.css binds the layout areas to the same var, so one write carries
 * all of it. Same-origin only - we self-host charting_library, and the rail
 * collapse + gesture listeners below already reach into this document.
 * Fail-soft: the static CSS value is correct for the default look, so a miss
 * here is a no-op, never a broken chart.
 */
function paintTvChrome(container, bg) {
  if (!bg) return false
  try {
    const doc = container?.querySelector('iframe')?.contentDocument
    if (!doc?.documentElement) return false
    const r = doc.documentElement
    r.style.setProperty('--tv-color-platform-background', bg)
    r.style.setProperty('--tv-color-pane-background', bg)
    r.style.setProperty('--tv-color-pane-background-secondary', bg)
    return true
  } catch { return false }
}

// Volume study lifecycle on the persistent widget. Volume presence differs
// PER RESOLUTION for the same pair (Codex 1D ships volume=0 on pairs whose
// intraday has full volume), so the study is added/removed as each
// resolution's first bar window arrives instead of locking on the session's
// first window (which hid volume for the whole session when the chart booted
// on 1D). `volumeStudyId` is 'pending' while createStudy's promise resolves.
let volumeStudyId = null
// The datafeed (also persistent) reports each resolution's first-window
// volume presence through this hook; setupChartFeatures rebinds it to the
// live chart on every ready.
let onVolumeWindow = null

// Smart auto-scale: the datafeed reports the loaded history's high/low RATIO
// on every firstDataRequest paint; the component flips the price axis to LOG
// when the range is extreme (a memecoin 100x+ pump on a LINEAR axis crushes
// the pre-pump era into a flat line that reads as "missing candles" - the
// CASHCAT 1,456x case), and back to LINEAR for normal-range tokens (the
// default Gleb chose).
let onRangeWindow = null
// The FIRST paint runs during widget init, BEFORE bindAutoScale assigns
// onRangeWindow - so the ratio is also stashed and REPLAYED at binding
// time, or the initial load would never auto-scale. Reset on symbol switch
// so a previous token's extreme ratio can't flip the next token's axis
// before its own bars report.
let _lastRangeRatio = null
// Representative price for the axis formatter's decimal count. The parent
// passes referencePrice={stats.price} but that lands async - until it does,
// priceFormatterFactory would fall back to PER-TICK precision, giving a ragged
// axis (0.001600 6dp vs 0.0008000 7dp) and a 12-decimal -0.000000000000
// baseline. Anchoring on the latest close (what the header shows) keeps every
// label the same width. Same module-hint pattern as _lastRangeRatio above.
let _lastAnchorPrice = null
function reportPriceRange(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return
  let min = Infinity
  let max = 0
  for (const b of arr) {
    if (b.low > 0 && b.low < min) min = b.low
    if (b.high > max) max = b.high
  }
  const lastClose = arr[arr.length - 1]?.close
  if (lastClose > 0) _lastAnchorPrice = lastClose
  else if (max > 0) _lastAnchorPrice = max
  if (min < Infinity && max > 0) {
    _lastRangeRatio = max / min
    if (typeof onRangeWindow === 'function') {
      try { onRangeWindow(_lastRangeRatio) } catch { /* widget disposed */ }
    }
  }
}

// Bind the auto-scale hook to a live inner chart. Re-callable: the TV iframe
// RELOADS when persistentContainer is re-appended (TV toggle off/on), so the
// inner chart is a NEW object and every previous subscription is dead.
//
// Two hard-won rules live here (the CASHCAT "broken candles on 4H" bug):
// 1. Compare the axis's ACTUAL mode() - never a remembered flag. TV resets
//    the price scale to LINEAR when it rebuilds the series on a resolution
//    or symbol change; a flag-based dedup then swallows the re-flip forever.
// 2. Re-assert after every onDataLoaded: our setMode from the data path runs
//    BEFORE TV's series rebuild, so the rebuild's linear reset lands on top
//    of it. onDataLoaded fires after the rebuild completes - re-applying
//    there wins. (applyOverrides can't do runtime flips at all - verified.)
// AUTO LOG-SCALE RETIRED (2026-07-10, explicit user decision: "use general
// charts, not logarithmic"). The axis stays on TV's LINEAR default always.
// Tradeoff accepted: an extreme-range token (memecoin 60x launch then -95%)
// renders its launch era compressed on linear - same as DexScreener's
// linear default. Users can still flip log manually from the price-scale
// context menu, and nothing re-asserts over that pick anymore (the old
// auto-flip also forced LINEAR back whenever the range ratio dropped below
// 20, stomping manual log picks on every data load). reportPriceRange /
// _lastRangeRatio stay: the ratio is cheap to compute and onRangeWindow
// remains the hook if a future opt-in setting wants it.
function bindAutoScale() { /* retired - linear always */ }

function ensureVolumeStudy(chart, want) {
  if (want && volumeStudyId === null) {
    try {
      // forceOverlay=false → volume gets its OWN sub-pane below the price
      // candles. Was `true` (overlaid on the price pane), which on a sub-$1
      // token over a wide range (e.g. SPECTRE monthly: $0.26-$6) mapped the
      // volume band below zero and dragged the PRICE axis into negative
      // labels (-1.000/-2.000). A dedicated pane keeps the price axis ≥ 0.
      const volumeCreated = chart.createStudy('Volume', false, false, {}, {
        'volume.color.0': '#ef4444',
        'volume.color.1': '#22c55e',
        'volume.transparency': 75,
      })
      volumeStudyId = 'pending'
      Promise.resolve(volumeCreated).then((volumeId) => {
        if (!volumeId) { volumeStudyId = null; return }
        volumeStudyId = volumeId
        const study = chart.getStudyById(volumeId)
        if (study && study.setScaleMargins) {
          // Fill the dedicated volume pane (small top gap) rather than the
          // bottom quarter of the price pane (the old overlay margin).
          study.setScaleMargins({ top: 0.1, bottom: 0 })
        }
        // Shrink the volume sub-pane to a THIN strip (~10% of the chart).
        // Volume reads as ambient context, not a section — its pane
        // legend + axis last-value are hidden via widget overrides so
        // the bars carry no chrome at all (Gleb, 2026-07-03).
        try {
          const panes = (typeof chart.getPanes === 'function') ? chart.getPanes() : []
          if (panes.length >= 2) {
            const last = panes[panes.length - 1]
            const total = panes.reduce((sum, p) => sum + (typeof p.getHeight === 'function' ? p.getHeight() : 0), 0)
            if (total > 0 && typeof last.setHeight === 'function') {
              last.setHeight(Math.max(40, Math.round(total * 0.10)))
            }
          }
        } catch { /* pane API varies across charting_library builds - non-fatal */ }
      }).catch((e2) => {
        // Non-fatal — widget may have been disposed mid-flight. console.warn
        // so the error-beacon (console.error-only) ignores it.
        volumeStudyId = null
        console.warn('[TV] volume study skipped:', e2?.message)
      })
    } catch (e) {
      volumeStudyId = null
      console.warn('[TV] volume study skipped:', e?.message)
    }
  } else if (!want && volumeStudyId && volumeStudyId !== 'pending') {
    try {
      chart.removeEntity(volumeStudyId)
    } catch (e) {
      console.warn('[TV] volume study remove skipped:', e?.message)
    }
    volumeStudyId = null
  }
}

// Persistent genesis floor (token:resolution -> earliest time in SECONDS that
// upstream returned no_data, i.e. the start of history). Module-level so it
// SURVIVES datafeed re-creation, token switches and re-mounts: once we learn a
// token's history start, every later TV pre-genesis scroll-back probe (TV fires
// these in rapid parallel and does NOT reliably stop on a single noData) is
// refused SYNCHRONOUSLY instead of round-tripping to the server (each was an
// uncached request + a billed empty Codex getBars). Keyed lowercase address +
// resolution; genesis depth differs per resolution.
const _tvGenesisFloor = new Map()
// Absolute floor: no token on our bars path (Codex/DEX is 2020+, Binance majors
// ~2017) has OHLCV before 2017. TV's cold scroll-back marched pre-genesis probes
// back to 2005; refusing < this epoch never clips real data. Jan 1 2017 UTC.
const BARS_EPOCH_SEC = 1483228800
const _tvGenesisKey = (sym, resolution) => {
  const clean = (sym || '').endsWith(':mcap') ? sym.slice(0, -5) : (sym || '')
  const addr = clean.includes(':') ? clean.split(':')[0] : clean
  return `${addr.toLowerCase()}:${resolution}`
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------
const TradingViewAdvanced = memo(function TradingViewAdvanced({
  symbol = 'BTC',
  timeframe = '1H',
  dayMode = false,
  height,
  token,
  tradeMarkers,
  onNoData,
  onChartReady: onChartReadyProp,
  onTimeframeChange,
  referencePrice,
  yAxisMode = 'price',
  circSupply = 0,
  resetNonce = 0,
  drawNonce = 0,
  pairAddress = null,
  pairSide = null,
  onUserZoom,
}) {
  const containerRef = useRef(null)
  const widgetRef = useRef(null)
  const readyRef = useRef(false)
  const datafeedRef = useRef(null)

  // 2026-06-03 cost war: shimmer skeleton while the trading chart cold-mounts
  // inside the research /token iframe. Iframe boot + library load + first
  // getBars = 3-15s of blank rectangle pre-fix; users perceived this as the
  // chart "not loading". Reset to false on every symbol change so navigating
  // between tokens repaints the skeleton. onChartReady below flips it true.
  const [chartReady, setChartReady] = useState(false)

  // MCap mode: the bar scale = circulating supply (price × supply = mcap).
  // The datafeed reads barScaleRef at the output boundary; the axis
  // formatter reads it to switch to compact ($1.2M) labels. Updated every
  // render so a yAxisMode/circSupply change is picked up by the next
  // setSymbol re-fetch.
  const barScaleRef = useRef(1)
  barScaleRef.current = (yAxisMode === 'mcap' && circSupply > 0) ? circSupply : 1
  const onNoDataRef = useRef(onNoData)
  onNoDataRef.current = onNoData
  const onChartReadyRef = useRef(onChartReadyProp)
  onChartReadyRef.current = onChartReadyProp
  const onUserZoomRef = useRef(onUserZoom)
  onUserZoomRef.current = onUserZoom
  // Timestamp until which onVisibleRangeChanged events count as programmatic
  // (initial fit / symbol / resolution / Fit-reset) and are ignored - so only a
  // USER zoom/pan AFTER this window flips the parent's "Fit" button on.
  const fitSettleUntilRef = useRef(0)
  // Last wheel/pinch on the chart iframe - stickyFitChart abandons its
  // delayed safety re-fit the moment the user takes over the viewport.
  const lastUserGestureRef = useRef(0)
  // Armed by the TF/token switch paths, consumed by onDataLoaded: runs the
  // sticky fit AFTER the new series' data actually landed (a cold switch's
  // callback fires pre-data, so timer-based fits alone all miss).
  const pendingSwitchFitRef = useRef(false)
  // Armed by a COLD token switch (shimmer up), consumed by the datafeed's
  // onFirstWindowPaint hook: the moment real candles for the new symbol are
  // handed to TV, drop the shimmer ourselves. On sparse tokens TV's setSymbol
  // callback / onDataLoaded can wedge and never fire (the countBack-undershoot
  // march - see the superset note in the datafeed), which left a finished
  // chart under the shimmer for 8-18s. The setSymbol callback stays as the
  // idempotent fallback and clears this ref when it does fire.
  const coldSwitchSymRef = useRef(null)
  // Timestamp of the last NAV action (mount / token switch / TF switch) - the
  // deep-history auto-widen only runs shortly after one, so a slow fill never
  // yanks the viewport from a user mid-analysis.
  const lastNavRef = useRef(Date.now())
  const onTimeframeChangeRef = useRef(onTimeframeChange)
  onTimeframeChangeRef.current = onTimeframeChange
  const refPriceRef = useRef(referencePrice)
  refPriceRef.current = referencePrice
  const programmaticResChangeRef = useRef(false)

  // Ref for token address - used by the price stream to update the last candle in real-time
  // Updated every render so the datafeed closure always reads the current token
  const tokenStreamRef = useRef({ address: token?.address, networkId: inferNetworkId(token?.address, token?.networkId), symbol: token?.symbol, pairAddress: pairAddress || token?.topPairAddress || null, pairSide: pairSide || null })
  tokenStreamRef.current = { address: token?.address, networkId: inferNetworkId(token?.address, token?.networkId), symbol: token?.symbol, pairAddress: pairAddress || token?.topPairAddress || null, pairSide: pairSide || null }

  // Ref for actual symbol - allows datafeed closure to read current symbol without recreating
  const actualSymbolRef = useRef(null)

  const sym = (token?.symbol || symbol || 'BTC').toUpperCase()
  const tokenNetworkId = inferNetworkId(token?.address, token?.networkId)
  // Symbol routing: ADDRESS-FIRST - the on-chain `address:networkId` form
  // whenever an address exists; bare ticker only for address-less assets.
  // The server's registry reverse-map routes address-form majors to Binance
  // klines, so BTC/ETH/SOL still get continuous CEX data.
  //
  // Y-AXIS MODE (Price <-> MCap) DOES NOT touch the symbol identity
  // (2026-07-10). The old design appended a ':mcap' suffix so TV treated
  // the modes as two symbols and re-fed the whole series via setSymbol -
  // which reloaded the chart and RESET the user's scroll/zoom on every
  // toggle. The series is ALWAYS raw prices and the supply multiply lives
  // in the axis formatter (format-time, live barScaleRef read), so a mode
  // toggle only needs the axis-repaint nudge (effect below the timeframe
  // effect) - series, viewport, zoom and drawings stay put. The datafeed's
  // ':mcap'-stripping guards remain as legacy safety only.
  //
  // ADDRESS-FIRST (2026-06-11 post-audit revert of the ticker-first rule):
  // the address is the unambiguous token identity. A DEX token whose SYMBOL
  // collides with a Binance ticker (any degen named "SOL") was getting
  // charted as the Binance asset. The server's registry reverse-map routes
  // address-form majors to Binance klines anyway, so majors lose nothing.
  // Ticker form only for address-less assets.
  const chartSymbol = (token?.address)
    ? `${token.address}:${tokenNetworkId}`
    : sym
  const resolution = TIMEFRAME_TO_RESOLUTION[timeframe] || '60'
  const theme = dayMode ? 'Light' : 'Dark'

  // Keep actualSymbolRef in sync so datafeed closure reads current symbol
  actualSymbolRef.current = chartSymbol

  // Track dayMode in a ref so the mount effect can read initial value
  const dayModeRef = useRef(dayMode)
  // Chart style — the chart's OWN appearance channel (ChartStyleControl),
  // independent from skins/tones/accents. Re-fires the overrides effect
  // below so the painted iframe restyles instantly. Ref mirrors it for
  // the mount-once creation closure.
  const chartStyle = useSettingsStore((s) => s.chartStyle)
  const chartStyleRef = useRef(chartStyle)
  chartStyleRef.current = chartStyle
  // "Apply tone to chart" mark + the tone itself: when marked (default),
  // a skin / background-tone pick re-tones the chart bg too. bgTone/bgDepth
  // are subscribed ONLY to re-fire the overrides effect on tone changes.
  const chartFollowsTheme = useSettingsStore((s) => s.chartFollowsTheme)
  const bgTone = useSettingsStore((s) => s.bgTone)
  const bgDepth = useSettingsStore((s) => s.bgDepth)
  const followThemeRef = useRef(chartFollowsTheme)
  followThemeRef.current = chartFollowsTheme
  dayModeRef.current = dayMode

  // Create the widget on mount; full teardown on unmount (no reuse - see the
  // module-level note on the lifecycle vars).
  useEffect(() => {
    if (!containerRef.current) return
    let pollTimer = null

    // NO re-attach reuse (removed 2026-07-09). The old detach-keep +
    // re-attach path re-parented persistentContainer, which RELOADS the TV
    // iframe; the stale wrapper then kept answering resolveSymbol but never
    // reloaded series data on later setSymbol calls - the chart silently
    // stayed on the PREVIOUS token (verified live: banner DIH, chart
    // CASHCAT, tv-symbol-ready in 36ms with zero getBars). A fresh create
    // paints in ~1s anyway (chartBarsCache makes the data instant), so the
    // reuse bought little and could show the WRONG chart. Any widget left
    // over from a prior mount (race / failed cleanup) is scrapped by
    // createWidget()'s own top-of-function sweep.

    // -----------------------------------------------------------------------
    // Shared chart setup: ready signal, interval sync, volume study.
    // Called from both createWidget()'s onChartReady and adoptPreloaded().
    //
    // ORDER MATTERS: the onChartReady signal + the interval-sync subscription
    // run FIRST, each in its own try, so a volume-study failure can never kill
    // them. Previously a single try wrapped all of this; a createStudy throw
    // left the chart in the blank-pane state because the ready signal + the
    // datafeed wiring never ran. Scroll-back history loading is handled
    // NATIVELY by TV v27 (it calls getBars(firstDataRequest=false) on
    // pan-past-edge), which our datafeed merges into its cache - so the old
    // custom onVisibleRangeChanged loader (which forced a full setSymbol()
    // widget reload on every scroll) is gone.
    // -----------------------------------------------------------------------
    function setupChartFeatures(w, chart) {
      // 1. Signal ready FIRST - this drops the parent's shimmer + wires the
      //    page's onChartReady consumers. Must not be gated behind volume.
      try {
        if (onChartReadyRef.current) onChartReadyRef.current(w, chart)
      } catch (e) { console.error('[TV] onChartReady consumer threw:', e) }

      // 2. Sync interval changes from TV widget back to parent (its own try).
      try {
        chart.onIntervalChanged().subscribe(null, (interval) => {
          if (programmaticResChangeRef.current) return
          const tf = RESOLUTION_TO_TIMEFRAME[interval]
          if (tf && onTimeframeChangeRef.current) {
            onTimeframeChangeRef.current(tf)
          }
        })
      } catch (e) { console.warn('[TV] interval-sync wiring skipped:', e?.message) }

      // 2b. EARLY ready: drop the parent shimmer as soon as TV consumes the
      // new series data - candles paint within a frame or two of
      // onDataLoaded, while the setSymbol callback (the old ready signal)
      // waits for the whole fit/autoscale settle, a 0.3-0.6s tail. That tail
      // is why TV "felt slower than Candles/Line" even with warm bars: the
      // canvas engines show candles the frame data lands; TV had them
      // painted too but sat hidden behind the shimmer. No wrong-chart
      // exposure: onDataLoaded means the NEW symbol's data is in. The 40ms
      // defer lets the iframe's own rAF commit the frame first; the
      // setSymbol callback still runs as the idempotent fallback.
      try {
        let didInitialFit = false
        // One-shot MOUNT fit for short/medium series: a fresh widget's default
        // barSpacing renders a young token (e.g. 29 bars of life at 4H) as a
        // thin sliver in an empty pane, and sparse dead tokens misframe the
        // same way. Very long series (>320 bars) frame fine by default and
        // must NOT be re-fit here (it would fight a user's restored zoom).
        // Switches have their own fit. Shared by the subscription below and
        // the cold-create branch, so a chart revealed early is revealed in its
        // FINAL framing - no visible re-frame a second later.
        const runInitialFit = () => {
          if (didInitialFit) return
          didInitialFit = true
          try {
            const range = datafeedRef.current?.getLoadedRange?.()
            if (range && range.count > 1 && range.count <= 320) {
              // Boot fit (fresh widget = no preserved window to fight, so the
              // single fit sticks; the drift-guarded safety passes catch the
              // rare case where TV's barSpacing settles late). Marks itself
              // programmatic for the Fit-button logic. Linear axis untouched.
              stickyFitChart(chart)
            }
          } catch { /* default framing stands */ }
        }
        chart.onDataLoaded().subscribe(null, () => {
          // Stale-load guard: only early-drop when the CURRENT symbol's
          // first window has resulted (an old symbol's scroll-back load
          // completing mid-switch must not reveal the old chart).
          if (_lastFirstResultSymbol && actualSymbolRef.current
              && _lastFirstResultSymbol !== actualSymbolRef.current) return
          tvdbg('onDataLoaded event')
          mark('tv-data-loaded')
          setTimeout(() => setChartReady(true), 40)
          // COLD-SWITCH fit: on a cold TF/token switch the setResolution/
          // setSymbol callback fires while the wide fetch is still in flight
          // (~1-2.4s), so every timer-based fit pass ran BEFORE data - when
          // the bars finally landed, TV applied its preserved previous TIME
          // window (12 days of sparse 15m = 12 full-pane daily candles) and
          // nothing re-framed. The switch paths arm this flag; consuming it
          // HERE runs the sticky fit after TV actually processed the new
          // series' data, so the per-TF framing always wins.
          if (pendingSwitchFitRef.current) {
            pendingSwitchFitRef.current = false
            try { stickyFitChart(chart, true) } catch { /* framing stands */ }
          }
          runInitialFit()
        })
        // 2c. COLD-CREATE MISS. This subscription is registered from
        // onChartReady, but on a FRESH widget TV finishes loading the first
        // series before onChartReady fires - so the onDataLoaded event that
        // drops the shimmer never reaches us, and the next one is the deep
        // fill's resetData, over a second later. On a token->token switch the
        // widget already exists and the subscription is in place, so this only
        // ever bites the welcome -> token path (and the first open of a
        // session), which is exactly where "the chart takes 3-4 seconds" came
        // from.
        //
        // Measured on prod 2026-08-04, welcome -> token, visible tab:
        //   474  getBars starts        1259 first bars handed to TV
        //   1259 deep fill starts      2425 deep fill returns
        //   2432 tv-data-loaded        2737 candles visible
        // The candles were under the shimmer from ~1.3s; the extra 1.4s was
        // spent waiting on background work the user never asked for.
        //
        // So: if this symbol's first window already delivered real bars, the
        // chart is drawn - say so now instead of waiting for a reload that is
        // not coming. Empty first windows are excluded (they take the no-data
        // path to the canvas fallback, which owns its own ready signal).
        if (_lastFirstPaintedSymbol && actualSymbolRef.current
            && _lastFirstPaintedSymbol === actualSymbolRef.current) {
          runInitialFit()
          mark('tv-data-loaded')
          setTimeout(() => setChartReady(true), 40)
        }
      } catch { /* setSymbol callback path still flips ready */ }

      // 3. Volume study LAST + fully isolated. Skip when the first bars
      //    window had zero volume on every bar (or the server flagged
      //    volumeAvailable === false) - a flat zero-volume study is noise.
      //    TV v27's createStudy returns a Promise<EntityId>; ensureVolumeStudy
      //    resolves it before getStudyById (passing the raw return threw
      //    "no such study"). Any failure is non-fatal to 1 + 2 above.
      const dfVolAvail = datafeedRef.current ? datafeedRef.current.volumeAvailable : undefined
      ensureVolumeStudy(chart, dfVolAvail !== false)
      // Rebind the per-resolution hook to the live chart: each resolution's
      // first bar window re-decides the study (add on 4h with volume, remove
      // on 1D where Codex ships volume=0) instead of the old session lock.
      onVolumeWindow = (hasVol) => ensureVolumeStudy(chart, hasVol)

      // Smart auto-scale: extreme-range history (memecoin 100x+ pump) flips
      // the price axis to LOG so the pre-pump era stays visible; normal-range
      // tokens keep the LINEAR default. See bindAutoScale for the re-assert
      // rules (TV resets the scale on series rebuilds).
      bindAutoScale(chart)
    }

    // Cold-load retry guard: `new TradingView.widget()` can throw if the heavy
    // charting bundles are not parsed yet on a fresh / cache-cleared load. We
    // retry createWidget ONCE before surfacing onNoData (the Candles fallback).
    let createRetried = false

    // -----------------------------------------------------------------------
    // Create widget from scratch with real datafeed
    // -----------------------------------------------------------------------
    function createWidget() {
      if (!containerRef.current || !window.TradingView?.widget) return
      // Build stamp: proves WHICH chart code a tab is executing (stale-tab
      // reports kept chasing already-fixed bugs). Bump the date-rev when
      // shipping chart fixes; check DevTools console for this line.
      console.info('[TV] chart build 2026-07-10.6 - race-guards + genesis-sanitizer v2 active')

      const ticker = (token?.symbol || symbol || '').toUpperCase()
      datafeedRef.current = createDatafeed(() => onNoDataRef.current?.(), refPriceRef, ticker, actualSymbolRef, tokenStreamRef, barScaleRef)
      // Cold-switch early ready: real candles handed to TV for the symbol a
      // cold switch armed -> fit + reveal ~2 frames later, without waiting on
      // TV's setSymbol callback (which never fires on sparse tokens - the
      // countBack-undershoot wedge). Guarded by coldSwitchSymRef so warm
      // switches and the cold-create path (owned by setupChartFeatures' 2c
      // check) are untouched.
      datafeedRef.current.onFirstWindowPaint = (key) => {
        if (!coldSwitchSymRef.current || key !== coldSwitchSymRef.current) return
        coldSwitchSymRef.current = null
        setTimeout(() => {
          if (actualSymbolRef.current !== key) return // switched again mid-defer
          try { stickyFitChart(widgetRef.current.activeChart(), true) } catch { /* framing stands */ }
          setChartReady(true)
        }, 120)
      }
      // Deep history landed in the background (GMGN-depth fill): re-feed TV
      // (resetData re-runs getBars against the now-deep cache) and, unless the
      // user has already taken over the viewport, widen to the full buffer.
      lastNavRef.current = Date.now()
      const applyDeepRefit = (attempt = 0) => {
        // The fill often lands BEFORE onChartReady on a cold create - defer
        // (bounded) instead of dropping, or the widen never happens on boot.
        if (!readyRef.current || !widgetRef.current) {
          if (attempt < 20) setTimeout(() => applyDeepRefit(attempt + 1), 500)
          return
        }
        // Respect the user: only auto-widen shortly after a nav action (boot /
        // token switch / TF switch). A later fill keeps their viewport - the
        // depth still serves zoom-out + scroll-back instantly.
        if (Date.now() - lastNavRef.current > 45000) return
        try {
          const chart = widgetRef.current.activeChart()
          tvdbg('applyDeepRefit resetData')
          chart.resetData()
          // resetData rebuilds the series and TV can restore the pre-reset
          // window - aggressive re-fits outlast that (~500ms) rebuild.
          stickyFitChart(chart, true)
        } catch { /* scroll-back serves the depth on demand */ }
      }
      datafeedRef.current.onDeepHistory = () => applyDeepRefit()
      // Interior-gap heal landed (upstream backfilled an outage hole - see
      // healInteriorGaps): re-feed TV from the healed cache. Unlike
      // applyDeepRefit this must NOT refit - the user may be hours into the
      // session - so capture the visible range and put it back if the rebuild
      // moved it. Epoch-floor guard on both capture and restore: TV reports
      // garbage ranges (from=0) during transients (PR #1415 lesson), and a
      // restore must never fight a gesture the user made since the capture.
      datafeedRef.current.onGapHealed = () => {
        if (!readyRef.current || !widgetRef.current) return
        try {
          const chart = widgetRef.current.activeChart()
          let vr = null
          try { vr = chart.getVisibleRange() } catch { /* keep null */ }
          const vrSane = vr && Number.isFinite(vr.from) && Number.isFinite(vr.to)
            && vr.from > 86400 && vr.to > vr.from
          tvdbg('gap-heal resetData', vrSane ? `${vr.from}->${vr.to}` : 'no-range')
          // Without the dirty-mark, resetData re-renders from TV's internal
          // cache and never re-requests - the heal would be invisible.
          datafeedRef.current?.invalidateTVCache?.()
          chart.resetData()
          if (!vrSane) return
          const restore = (delay) => setTimeout(() => {
            try {
              if (Date.now() - _lastGestureTs < 800) return // user took the viewport
              const cur = chart.getVisibleRange()
              if (!cur || !Number.isFinite(cur.from) || cur.from <= 86400) return
              if (Math.abs(cur.from - vr.from) > 1 || Math.abs(cur.to - vr.to) > 1) {
                const p = chart.setVisibleRange(vr)
                if (p && typeof p.catch === 'function') p.catch(() => { /* view stands */ })
              }
            } catch { /* view stands */ }
          }, delay)
          // resetData rebuilds in ~500ms - check after the rebuild settles.
          restore(250)
          restore(800)
        } catch { /* scroll-back still serves the healed cache */ }
      }
      persistentDatafeed = datafeedRef.current

      // On phones the native TV chrome (left drawing rail + top header) is
      // desktop-only cruft that overflows the viewport and duplicates the
      // compact MobileChartToolbar. Read once at creation - the widget builds
      // a single time per session and the mobile token page only mounts on a
      // phone viewport.
      const isMobileChart = typeof window !== 'undefined'
        && window.matchMedia?.(MOBILE_MEDIA_QUERY)?.matches

      // Spectre terminal palette - surface-level bg for depth separation from void.
      // The chart follows the page theme on mobile too: the mobile token page has
      // full day-mode variants now, so a forced-Dark chart was a black hole in an
      // otherwise white page (it was pinned dark back when mobile was dark-only).
      const isDayMode = dayModeRef.current
      // Chart-style channel (ChartStyleControl) — null fields resolve to the
      // stock look; the resolver's dark defaults match these literals exactly.
      // followTheme: the studio's "apply tone to chart" mark rides the
      // platform tone ladder into the chart bg unless an explicit bg is set.
      const CS = resolveChartStyle(chartStyleRef.current, isDayMode, { followTheme: followThemeRef.current })
      const bgColor = CS.bg
      // Seed the theme-flip guard with the theme the widget is CREATED in,
      // so the first appearance-only change never fires changeTheme (which
      // resets pane overrides to the library default background).
      prevEffDayRef.current = isDayMode
      const gridColor = CS.grid
      // Axis labels lifted 0.3 -> 0.5 for readability (the old value was too faint to
      // read comfortably). Still recedes vs the candles, just legible now.
      const axisTextColor = CS.axisText
      const axisLineColor = isDayMode ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.03)'
      const bullColor = CS.up       // stock: --bull #10B981
      const bearColor = CS.down     // stock: --bear #EF4444
      const bullWick = CS.wickUp    // stock: --bull-bright #34D399
      const bearWick = CS.wickDown  // stock: --bear-bright #F87171

      // Idempotency: tear down any prior (possibly partial / failed) widget +
      // container BEFORE building a fresh one. Without this, a retry or any
      // double-call stacks a SECOND TradingView instance into the same
      // container - the two charts then paint their price/time axes on top of
      // each other (the "axis overlap" / 7-canvas bug). Only removes our own
      // imperatively-appended container, never React-managed children.
      try { persistentWidget?.remove?.() } catch {}
      persistentWidget = null
      volumeStudyId = null
      onVolumeWindow = null
      onRangeWindow = null
      // containerRef is a self-closing div with NO React children - its only
      // children are our imperatively-appended persistentContainer(s). Clear
      // ALL of them so a StrictMode double-mount, retry, or async race can
      // never leave a SECOND widget stacked (the 7-canvas "axis overlap").
      if (containerRef.current) {
        while (containerRef.current.firstChild) {
          try { containerRef.current.removeChild(containerRef.current.firstChild) }
          catch { break }
        }
      }
      persistentContainer = null

      // Create a persistent container div that survives unmounts
      persistentContainer = document.createElement('div')
      persistentContainer.style.cssText = 'width:100%;height:100%'
      containerRef.current.appendChild(persistentContainer)

      try {
        const w = new window.TradingView.widget({
          symbol: chartSymbol,
          interval: resolution,
          container: persistentContainer,
          datafeed: datafeedRef.current,
          library_path: LIBRARY_PATH,
          locale: 'en',
          fullscreen: false,
          autosize: true,
          theme: isDayMode ? 'Light' : 'Dark',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC',
          custom_css_url: '/charting_library/tv-custom.css',
          // Axis + legend font. The canvas axis is NOT styleable via page CSS - the
          // only lever is custom_font_family (sets the library's global CHART_FONT_FAMILY
          // that every makeFont() axis label reads). Geist (sans) is the token page's
          // font AND has a plain round zero - NO slashed/crossing zero on the price
          // ladder (Geist Mono's slashed zero was rejected). @font-face is loaded inside
          // the iframe by tv-custom.css; the sans fallback keeps the axis readable.
          custom_font_family: "'Geist', Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          loading_screen: { backgroundColor: bgColor, foregroundColor: axisTextColor },

          // Axis / crosshair / legend label formatter. ALWAYS-ON and reads
          // barScaleRef live at format() time so price<->mcap switches
          // without depending on the factory being re-invoked (TV does NOT
          // re-run priceFormatterFactory on resetData, and setSymbol with the
          // same symbol is a no-op). In MCap mode (scale>1) values are market
          // caps → compact $X.XM/B/T. In price mode we show GMGN-style precision:
          // ~4 significant figures derived from the LIVE price (not the symbol's
          // pricescale, which is the fixed 1e8 default since resolveSymbol runs
          // before the price is known). $0.38 → 0.3813 (4dp), a micro-cap → more,
          // a $40k token → 2dp - instead of a wall of trailing zeros (0.40000000).
          custom_formatters: {
            priceFormatterFactory: () => {
              // ~4 sig figs, clamped to a sane axis range. floor(log10(p)) is the
              // place of the leading digit; (sigfigs-1) - that = decimals to show.
              const priceDecimals = (p) => {
                p = Math.abs(p)
                if (!isFinite(p) || p <= 0) return 2
                return Math.max(2, Math.min(12, 3 - Math.floor(Math.log10(p))))
              }
              return {
                format: (price) => {
                  if (!isFinite(price)) return ''
                  // The SERIES always carries RAW prices (see the scaleBars
                  // note in createDatafeed) - the mcap multiply happens HERE,
                  // at format time, reading the live scale. Series values and
                  // labels can never desync no matter when circSupply lands.
                  const scale = barScaleRef.current || 1
                  if (scale > 1) {
                    const scaled = price * scale
                    const v = Math.abs(scaled)
                    if (v >= 1e12) return `${(scaled / 1e12).toFixed(2)}T`
                    if (v >= 1e9) return `${(scaled / 1e9).toFixed(2)}B`
                    if (v >= 1e6) return `${(scaled / 1e6).toFixed(2)}M`
                    if (v >= 1e3) return `${(scaled / 1e3).toFixed(2)}K`
                    return scaled.toFixed(2)
                  }
                  // Derive ONE axis-wide decimal count from the live
                  // representative price so every label right-aligns at the same
                  // width: parent prop first, then the bars' latest close
                  // (_lastAnchorPrice), then the value itself as a last resort.
                  const ref = Math.abs(refPriceRef?.current) || Math.abs(_lastAnchorPrice) || Math.abs(price)
                  const dec = priceDecimals(ref)
                  // Autoscale pads the range slightly below the lowest price, so
                  // the axis grows a zero-crossing whose tiny (often -1e-13) value
                  // would render as -0.000000000000. Snap anything under half a
                  // tick to a clean 0 at the axis precision - kills the long-zero
                  // label that was widening the whole price scale.
                  if (Math.abs(price) < 0.5 * Math.pow(10, -dec)) return (0).toFixed(dec)
                  return price.toFixed(dec)
                },
              }
            },
          },

          overrides: {
            // Background - pure void
            'paneProperties.background': bgColor,
            'paneProperties.backgroundType': 'solid',
            // Grid - near invisible
            'paneProperties.vertGridProperties.color': gridColor,
            'paneProperties.horzGridProperties.color': gridColor,
            // Axes - muted, recede into background
            'scalesProperties.backgroundColor': bgColor,
            'scalesProperties.textColor': axisTextColor,
            'scalesProperties.lineColor': axisLineColor,
            // Smaller axis labels on phones (GMGN-compact); desktop matches the
            // Research Zone's 11 (was 12). Mobile keeps 9 - research has no
            // phone chart tier, so there is nothing to be at parity WITH there.
            'scalesProperties.fontSize': isMobileChart ? 9 : 11,
            // Candles - Spectre bull/bear palette, borders in the BODY colour to
            // match the Research Zone. A 2026-07-10 pass had put the BRIGHT
            // variant on the border as a rim to pop the body off the old pure-
            // black background; the substrate is no longer black and the rim is
            // what made the same asset look different across the two platforms.
            // Custom-picked candles are unaffected: wickUp/wickDown already
            // resolve to the picked colour, so border == body there either way.
            'mainSeriesProperties.candleStyle.upColor': bullColor,
            'mainSeriesProperties.candleStyle.downColor': bearColor,
            'mainSeriesProperties.candleStyle.drawBorder': true,
            'mainSeriesProperties.candleStyle.borderUpColor': bullColor,
            'mainSeriesProperties.candleStyle.borderDownColor': bearColor,
            'mainSeriesProperties.candleStyle.wickUpColor': bullWick,
            'mainSeriesProperties.candleStyle.wickDownColor': bearWick,
            // Line-chart color (chart style, brightness baked in). No custom
            // pick: dark slate on white (TV's light default line is near-white
            // = invisible), the existing TV blue on dark.
            'mainSeriesProperties.lineStyle.color': CS.line || (isDayMode ? '#334155' : '#2962FF'),
            // The "Line" toolbar type renders as an AREA series - its line +
            // fill are separate props. TV's light-theme defaults are near-white
            // (invisible on white), so pin a dark slate line + faint slate fill.
            'mainSeriesProperties.areaStyle.linecolor': CS.line || (isDayMode ? '#334155' : '#2962FF'),
            'mainSeriesProperties.areaStyle.color1': isDayMode ? 'rgba(51, 65, 85, 0.14)' : 'rgba(41, 98, 255, 0.28)',
            'mainSeriesProperties.areaStyle.color2': isDayMode ? 'rgba(51, 65, 85, 0.00)' : 'rgba(41, 98, 255, 0.00)',
            'mainSeriesProperties.areaStyle.linewidth': 2,
            // Crosshair — warm-white is invisible on the white day chart.
            'crossHairProperties.color': isDayMode ? 'rgba(15, 23, 42, 0.25)' : 'rgba(245, 245, 247, 0.15)',
            'crossHairProperties.style': 2, // dashed
            'crossHairProperties.width': 1,
            // Crosshair axis labels (the price + time boxes that follow the cursor):
            // a clean lifted-charcoal box matching the terminal, not TV's default grey.
            // Both Dark/Light variants are set so changeTheme picks the right one; text
            // auto-contrasts (white on the dark box, ink on the light one).
            'scalesProperties.crosshairLabelBgColorDark': '#262a31',
            'scalesProperties.crosshairLabelBgColorLight': '#cbd5e1',
            // Volume pane de-chromed: no "Volume 123" legend row, no axis
            // last-value chip, near-invisible pane separator — the bars stay,
            // but they read as ambient context, not a titled section.
            'paneProperties.legendProperties.showStudyTitles': false,
            'paneProperties.legendProperties.showStudyValues': false,
            'scalesProperties.showStudyLastValue': false,
            'paneProperties.separatorColor': 'rgba(255, 255, 255, 0.06)',
            // Hide watermark
            'symbolWatermarkProperties.visibility': false,
            // LINEAR (regular) price scale by default - the normal scale most
            // users expect. TRADEOFF: a wide-range full-history view (e.g. SPECTRE
            // ~54x: $0.087 launch -> $4.74 peak -> $0.33 now) compresses the low
            // era into a thin band and can make steep moves read as gaps - the
            // "broken / not filled candles" look that log used to avoid. Per user
            // preference we default to linear anyway; users who want the whole
            // range rendered proportionally can toggle log from the price-scale
            // context menu.
            'mainSeriesProperties.priceAxisProperties.log': false,
          },

          studies_overrides: {
            'volume.volume.color.0': bearColor,
            'volume.volume.color.1': bullColor,
            'volume.volume.transparency': 75,
          },

          // Fast-terminal default (2026-07-10): the drawing rail starts
          // COLLAPSED - a permanent 48px column of 15+ drawing tools reads
          // as heavy desktop software, not a trading terminal. The toolbar
          // pencil button (drawNonce -> drawingToolbarAction) restores the
          // full toolset in one click; TV keeps its own edge arrow too.
          // 2026-07-23 (user request): collapse on MOBILE too - the rail ate
          // ~48px of the phone chart. Re-openable via TV's edge arrow.
          hide_side_toolbar: true,

          disabled_features: [
            'header_symbol_search',
            // The toolbar search button is disabled (header_symbol_search), but
            // TV's typing hotkey still opens a search dialog whose backend
            // /api/tradingview/udf/search does not exist in trading prod - kill it.
            'symbol_search_hot_key',
            'header_compare',
            'display_market_status',
            'header_saveload',
            'use_localstorage_for_settings',
            'popup_hints',
            'show_logo_on_all_charts',
            'caption_buttons_text_if_possible',
            'create_volume_indicator_by_default',
            'go_to_date',
            'header_screenshot',
            'study_market_minimized',
            'property_pages',
            'show_chart_property_page',
            'chart_crosshair_menu',
            'support_multicharts',
            'countdown',
            'source_selection_markers',
            'timeframes_toolbar',
            // The native TV header (resolution / chart-type / indicators / undo-redo
            // / settings / fullscreen) is redundant on EVERY viewport - our own
            // .chart-controls bar above the chart already supplies all of it, driving
            // the widget via the chart API (setResolution / setChartType), not by
            // proxying header clicks. Killing it reclaims that ~40px strip for the
            // chart on desktop and mobile alike.
            'header_widget',
            // Phone: keep the native TV drawing rail AVAILABLE (not in
            // disabled_features) plus the bottom control bar (control_bar:
            // Date Range / log / auto / %) and the OHLC legend (legend_widget).
            // The rail starts COLLAPSED by default (hide_side_toolbar + the
            // onChartReady collapse below, 2026-07-23 user request) to reclaim
            // the ~48px column for the chart, but stays re-openable via TV's
            // edge arrow. MobileChartToolbar supplies timeframe / type /
            // Price-MCap / fullscreen on top. Only the touch-awkward right-click
            // menus stay disabled.
            ...(isMobileChart ? [
              'edit_buttons_in_legend',
              'context_menus',
              'pane_context_menu',
            ] : []),
          ],
          enabled_features: [
            'side_toolbar_in_fullscreen_mode',
            'header_in_fullscreen_mode',
          ],
        })

        widgetRef.current = w
        persistentWidget = w
        persistentWidgetIsMobile = isMobileChart
        // Reset the persistent-ready flag — the new widget isn't ready
        // yet, and any pending re-attach paths should wait for the new
        // onChartReady below.
        persistentReady = false

        w.onChartReady(() => {
          readyRef.current = true
          persistentReady = true
          setChartReady(true)
          // Chrome (rail + toolbar) follows the same bg the pane was built with.
          paintTvChrome(persistentContainer || containerRef.current, bgColor)
          try {
            setupChartFeatures(w, w.activeChart())
          } catch (e) { console.error(e) }
          // FAST-TERMINAL DEFAULT: collapse the drawing rail. The
          // constructor option hide_side_toolbar is NOT honored by this
          // charting_library build (verified undefined in the inner widget
          // options), so detect the rail in the same-origin iframe DOM and
          // fire TV's own toggle action once when it's visible. The toolbar
          // pencil (drawNonce) re-opens it on demand.
          // 2026-07-23: applies on MOBILE too (was desktop-only) so the phone
          // chart reclaims the ~48px drawing column by default (user request).
          try {
            const maxTries = isMobileChart ? 20 : 1
            let tries = 0
            const collapseRail = () => {
              tries += 1
              try {
                const ifr = (persistentContainer || containerRef.current)?.querySelector('iframe')
                const rail = ifr?.contentDocument?.querySelector('[class*="drawingToolbar"], .drawing-toolbar, [data-name="drawing-toolbar"]')
                if (rail && rail.getBoundingClientRect().width > 10) {
                  w.activeChart().executeActionById('drawingToolbarAction')
                  return
                }
              } catch { return }
              if (tries < maxTries) setTimeout(collapseRail, 150)
            }
            collapseRail()
          } catch { /* rail stays visible - non-fatal */ }
          // Resolution catch-up: the widget was created with the resolution
          // captured by the mount closure, and the [resolution] effect
          // no-ops while readyRef is false - so a timeframe change that
          // landed DURING widget construction (e.g. the age-aware TF cap
          // downshifting a young token off a coarse saved TF ~1s after
          // load) was silently lost. Apply the CURRENT resolution now.
          try {
            const want = resolutionRef.current
            const chart = w.activeChart()
            if (want && chart.resolution() !== want) {
              programmaticResChangeRef.current = true
              fitSettleUntilRef.current = Date.now() + 1500
              pendingSwitchFitRef.current = true
              chart.setResolution(want, () => {
                programmaticResChangeRef.current = false
                stickyFitChart(chart, true)
              })
              setTimeout(() => { programmaticResChangeRef.current = false }, 800)
            }
          } catch { /* keep creation resolution */ }
          // Flush a token switch that arrived while the widget was still
          // initialising (queued by the symbol-change effect) - without this
          // the legend keeps the creation-time token's name.
          if (pendingSymbolRef.current && pendingSymbolRef.current !== prevSymbolRef.current) {
            try { applySymbolSwitchRef.current?.(pendingSymbolRef.current) } catch (e) { console.error(e) }
          }
        })
      } catch (e) {
        console.error('[TV Advanced] Widget creation failed:', e)
        // Cold-load race: the entry is parsed but the heavy bundles may not be
        // ready, so new widget() threw. Retry ONCE (bundles land within a few
        // hundred ms) before giving up - this auto-recovers fresh / cache-
        // cleared loads instead of latching the Candles fallback.
        if (!createRetried) {
          createRetried = true
          pollTimer = setTimeout(() => { pollTimer = null; createWidget() }, 700)
          return
        }
        // Still failed after a retry - the container is dead. Surface onNoData
        // so the parent (TradingChart) can fall back to the Candles view.
        try { onNoDataRef.current?.() } catch {}
        setChartReady(true)
      }
    }

    // charting_library.js is loaded via <script async> in index.html.
    // By the time user clicks a token, it's usually already parsed+executed.
    // If not yet ready (very fast click), poll until available.
    // ROOT-CAUSE FIX for the mobile "wrong-size-until-resize" bug: TV's
    // autosize measures the container EXACTLY ONCE at construction, then only
    // self-observes. On the mobile card the container height (--mcc-chart-h
    // through a flex chain) is NOT settled on the synchronous mount tick, so a
    // bare createWidget() baked the wrong geometry (oversized axis labels +
    // wrong scale) and never received a corrective resize - every React resize
    // path is gated on the null lightweight-charts ref, so only the user's
    // resize-drag (which writes --mcc-chart-h) ever re-fit it. Gate creation
    // until the container has a real measured height so autosize bakes the
    // CORRECT box the first time. Container-only: never touches the iframe, so
    // touch pan/zoom/axis-drag stay intact. Fail-open after ~0.5s.
    const launchWhenSized = () => {
      let tries = 0
      const MAX_TRIES = 30 // ~0.5s at double-rAF; cap so we never hang
      // Deep-link cold loads mount with the '...' placeholder token; TV
      // resolves the symbol NAME once at creation (resolveSymbol reads
      // tokenStreamRef live but never re-runs for the same ticker), so a
      // widget created before the token resolves shows ".../USD" in the
      // legend forever. Wait for a real symbol with its own longer budget
      // (resolver usually lands well before the TV bundles parse) and
      // fail open so a failed resolve still gets a chart.
      let symTries = 0
      const MAX_SYM_TRIES = 150 // ~2.5s at double-rAF
      const attempt = () => {
        if (!containerRef.current) return
        const h = containerRef.current.getBoundingClientRect().height
        const sym = tokenStreamRef.current?.symbol
        const placeholderSym = (!sym || sym === '...') && symTries < MAX_SYM_TRIES
        if ((h >= 200 || tries >= MAX_TRIES) && !placeholderSym) {
          createWidget() // container settled -> autosize measures correct geometry
          return
        }
        tries += 1
        symTries += 1
        requestAnimationFrame(() => requestAnimationFrame(attempt))
      }
      attempt()
    }

    if (window.TradingView?.widget) {
      launchWhenSized()
    } else {
      pollTimer = setInterval(() => {
        if (window.TradingView?.widget) {
          clearInterval(pollTimer)
          pollTimer = null
          launchWhenSized()
        }
      }, 30)
      setTimeout(() => { if (pollTimer) clearInterval(pollTimer) }, 15000)
    }

    return () => {
      if (pollTimer) clearInterval(pollTimer)
      // Stop price stream for this token
      if (datafeedRef.current) {
        try { datafeedRef.current.destroy?.() } catch {}
      }
      // FULL teardown - no detach-keep (see the no-re-attach note above).
      try { persistentWidget?.remove?.() } catch {}
      if (persistentContainer?.parentNode) {
        try { persistentContainer.parentNode.removeChild(persistentContainer) } catch {}
      }
      persistentWidget = null
      persistentContainer = null
      persistentDatafeed = null
      persistentWidgetIsMobile = null
      volumeStudyId = null
      onVolumeWindow = null
      onRangeWindow = null
      persistentReady = false
      readyRef.current = false
      widgetRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount once, theme changes via applyOverrides below

  // Theme changes - apply overrides without recreating widget (preserves cached bars + chart state)
  const prevEffDayRef = useRef(null)
  const prevLineRef = useRef(null)
  useEffect(() => {
    if (!readyRef.current || !widgetRef.current) return
    // Feature-detect: during a re-attach iframe reload the widget object can
    // exist while applyOverrides/changeTheme aren't yet wired on the inner
    // window. readyRef now gates this, but the check is free insurance against
    // the "applyOverrides is not a function" console error.
    if (typeof widgetRef.current.applyOverrides !== 'function') return
    try {
      // Mirror the creation-time rule: the chart follows the page theme on every
      // viewport (mobile included - see the isDayMode note at creation).
      const effDay = dayMode
      const CS = resolveChartStyle(chartStyle, effDay, { followTheme: chartFollowsTheme })
      // Keep the library's own chrome on the same colour as the pane we are
      // about to repaint - otherwise a tone / custom-bg / day-mode change moves
      // the canvas and strands the drawing rail on the previous shade.
      paintTvChrome(persistentContainer || containerRef.current, CS.bg)
      const axisLine = effDay ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.03)'
      const OVR = {
        'paneProperties.background': CS.bg,
        'paneProperties.backgroundType': 'solid',
        'paneProperties.vertGridProperties.color': CS.grid,
        'paneProperties.horzGridProperties.color': CS.grid,
        'scalesProperties.backgroundColor': CS.bg,
        'scalesProperties.textColor': CS.axisText,
        'scalesProperties.lineColor': axisLine,
        'mainSeriesProperties.candleStyle.upColor': CS.up,
        'mainSeriesProperties.candleStyle.downColor': CS.down,
        'mainSeriesProperties.candleStyle.drawBorder': true,
        // Body colour, not the bright wick - creation parity (Research Zone).
        'mainSeriesProperties.candleStyle.borderUpColor': CS.up,
        'mainSeriesProperties.candleStyle.borderDownColor': CS.down,
        'mainSeriesProperties.candleStyle.wickUpColor': CS.wickUp,
        'mainSeriesProperties.candleStyle.wickDownColor': CS.wickDown,
        // Volume pane chrome stays hidden across re-themes (creation parity)
        'paneProperties.legendProperties.showStudyTitles': false,
        'paneProperties.legendProperties.showStudyValues': false,
        'scalesProperties.showStudyLastValue': false,
        'paneProperties.separatorColor': effDay ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.06)',
        // No custom line: dark slate on white (visible), TV blue on dark.
        'mainSeriesProperties.lineStyle.color': CS.line || (effDay ? '#334155' : '#2962FF'),
        'mainSeriesProperties.areaStyle.linecolor': CS.line || (effDay ? '#334155' : '#2962FF'),
        'mainSeriesProperties.areaStyle.color1': effDay ? 'rgba(51, 65, 85, 0.14)' : 'rgba(41, 98, 255, 0.28)',
        'mainSeriesProperties.areaStyle.color2': effDay ? 'rgba(51, 65, 85, 0.00)' : 'rgba(41, 98, 255, 0.00)',
        'crossHairProperties.color': effDay ? 'rgba(15, 23, 42, 0.25)' : 'rgba(245, 245, 247, 0.15)',
      }
      widgetRef.current.applyOverrides(OVR)
      prevLineRef.current = CS.line || null
      // changeTheme resets overrides inside the library — only fire it on a
      // REAL light/dark flip, never on chart-style-only changes, or the
      // background override above would be clobbered right after applying.
      // It returns a Promise: re-assert the overrides once the theme lands
      // so the flip itself can't strip them either.
      if (prevEffDayRef.current !== effDay) {
        prevEffDayRef.current = effDay
        Promise.resolve(widgetRef.current.changeTheme(effDay ? 'Light' : 'Dark'))
          .then(() => { try { widgetRef.current?.applyOverrides(OVR) } catch { /* disposed */ } })
          .catch(() => { /* non-fatal */ })
      }
    } catch (e) { console.error(e) }
  }, [dayMode, chartStyle, chartFollowsTheme, bgTone, bgDepth])

  // Smart fit, shared by the symbol + timeframe effects. TIME-based
  // setVisibleRange from the datafeed's actual loaded extent - the only fit
  // that normalizes TV's PERSISTED barSpacing across symbol switches. The
  // old rightOffset-only fit inherited the previous token's spacing: coming
  // from a 1000-bar major, a 29-bar young token rendered as a thin sliver
  // in a mostly-empty pane ("broken candles", VITALIK 4H report).
  //
  // Framing rule: show the WHOLE loaded series up to 200 bars (young +
  // mid-life tokens = full history on screen, the thing users actually
  // ask for), else the last 160. 160 on a ~1000px pane gives ~6px/bar -
  // DexScreener-weight candle bodies instead of the wispy 3px slivers the
  // old 320-bar window produced (2026-07-10 candle-weight polish; deeper
  // history stays one scroll away). The window's start is the REAL timestamp
  // of the nth-from-last bar (startSecForLastBars) - never last-minus-
  // n*resSec, which on sparse dead tokens compresses months of bar-index
  // space into a days-wide time window (the MARV misframe). setVisibleRange
  // returns a PROMISE - failures surface there, not as throws, so the
  // rejection handler applies the offset fallback.
  const smartFitChart = (chart) => {
    try {
      const ts = chart.getTimeScale?.()
      const range = datafeedRef.current?.getLoadedRange?.()
      const paneW = (containerRef.current?.clientWidth || 960) - 70 // minus price axis
      // GMGN framing via BAR SPACING (pixels-per-candle). This is the ONLY range
      // primitive that actually applies on this charting_library build AND sticks:
      //  - setVisibleLogicalRange: absent (getTimeScale() has no such method).
      //  - setVisibleRange (time): silently no-ops on the removeEmptyBars series
      //    (probed live: asked for 191 days, view stayed ~15).
      // Both left the fit a no-op - boot only LOOKED framed because TV's default
      // was already wide, while a 15m->1D switch (TV preserves the sparse 15m
      // window = ~12 daily candles) stayed giant. setBarSpacing zooms from the
      // right edge and TV does NOT revert it (probed: 182 days held at +3s), so
      // one application frames both boot and switch. 6px/candle => ~180 candles
      // on a desktop pane = GMGN's exact look; bar COUNT is density (no fill).
      if (ts && typeof ts.setBarSpacing === 'function') {
        const count = range?.count || 0
        let spacing = 6
        if (count > 1 && count < 40) {
          // Young/sparse series (fresh 1D launch, or data still in flight): a
          // handful of candles at 6px would sit in a sliver - widen so they
          // fill the pane without becoming full-width giants (cap ~26px).
          spacing = Math.max(6, Math.min(26, paneW / (count + 4)))
        }
        ts.setBarSpacing(spacing)
        if (typeof ts.setRightOffset === 'function') ts.setRightOffset(5)
        try { ts.scrollToRealtime?.() } catch { /* right offset already anchors */ }
      } else if (typeof ts?.setRightOffset === 'function') {
        ts.setRightOffset(5) // ancient-build fallback
      }
    } catch (e) {
      console.warn('[TV] fitChart failed:', e?.message)
    }
    // Y-axis auto-fit must happen AFTER the time axis processes the range.
    setTimeout(() => {
      try {
        const ps = chart.getPanes()[0].getMainSourcePriceScale()
        ps.setAutoScale(false)
        ps.setAutoScale(true)
      } catch (e) { console.warn('[TV] auto-scale failed:', e?.message) }
    }, 50)
  }

  // Fit the chart. setBarSpacing STICKS (TV never reverts it - verified), so a
  // single application frames both boot and TF switch; no more fighting a phantom
  // "preserved-window restore" (that whole battle existed only because the old
  // setVisibleLogicalRange/setVisibleRange fits were silent no-ops). One delayed
  // safety re-apply covers the first call landing before the timescale/series is
  // ready (cold data still resolving); it's abandoned the moment the user takes
  // the viewport. The `aggressive` flag is retained by call sites but no longer
  // needs a distinct regime - the single primitive is enough for both.
  const stickyFitChart = (chart, aggressive = false) => {
    const started = Date.now()
    fitSettleUntilRef.current = started + 1800
    // A deliberate refit owns the viewport - a scroll-back anchor minted
    // before it must not snap the view back to the pre-refit range.
    clearSbViewAnchor()
    smartFitChart(chart)
    setTimeout(() => {
      if (lastUserGestureRef.current > started) return
      try { smartFitChart(chart) } catch { /* framing stands */ }
    }, aggressive ? 700 : 800)
  }

  // Handle symbol changes without full widget recreate - use setSymbol() instead
  const prevSymbolRef = useRef(chartSymbol)
  const resolutionRef = useRef(resolution)
  resolutionRef.current = resolution
  // A token switch that lands while the widget is NOT ready (initial boot, or
  // the re-attach probe window where readyRef is forced false) used to be
  // silently DROPPED: prevSymbolRef advanced BEFORE the ready guard, the
  // effect deps ([chartSymbol]) never re-fired, and TV kept the previous
  // token's resolved symbolInfo - a stale "$WIF/USD" legend plotted over the
  // new token's data (getBars fetches actualSymbolRef, not symbolInfo), plus
  // the old token's resolution caches were never cleared. The switch is now
  // QUEUED in pendingSymbolRef and flushed the moment the widget becomes
  // ready (onChartReady on fresh create, tryApplyRemount on re-attach).
  const pendingSymbolRef = useRef(null)
  const applySymbolSwitchRef = useRef(null)
  applySymbolSwitchRef.current = (symToApply) => {
    prevSymbolRef.current = symToApply
    pendingSymbolRef.current = null
    lastNavRef.current = Date.now()
    mark('tv-switch-start')
    // Drop the previous token's range ratio - the new token's axis mode must
    // come from its OWN bars (reportPriceRange fires on its first window).
    _lastRangeRatio = null
    // Same for the axis-precision anchor: a $40k token following a micro-cap
    // must not inherit the micro-cap's decimal count until its bars report.
    _lastAnchorPrice = null
    // WARM switches keep the OLD chart on screen and let TV swap it in
    // place (~0.5s) - no skeleton flash. TV v27's post-data pipeline is
    // ~500ms regardless of how fast bars arrive (onDataLoaded fires no
    // earlier than the setSymbol callback - measured), so with warm bars
    // the skeleton was pure perceived slowness next to the canvas engines'
    // same-frame paint. GMGN's TV mode behaves exactly like this. Cold
    // switches (no resolved bars in cache) keep the honest shimmer.
    // SPARSE EXCEPTION to the warm-switch rule. A warm switch keeps the OLD
    // chart on screen while TV swaps the series in place, and the reframe can
    // only land in the setSymbol callback (~500ms - onDataLoaded never fires
    // earlier, measured). For a dense series that is invisible: the previous
    // token's preserved TIME window frames ~200 candles about right either way.
    // For a SPARSE one it is not - STRAT has 5 traded 15m bars in the last 7
    // days, so those few candles render stretched to full-pane width inside the
    // stale window, with no shimmer hiding them, until the fit lands. That is
    // the "chart looks broken for the first second" report. Below the floor we
    // keep the honest shimmer for the ~500ms instead of showing a wrong frame;
    // dense switches (the overwhelming majority) keep today's instant swap.
    const netId = token?.address ? inferNetworkId(token.address, token.networkId) : null
    const cachedBars = token?.address
      ? cachedBarCountSync(token.address, netId, resolutionRef.current)
      : 0
    const warmSwitch = token?.address
      && hasCachedBarsSync(token.address, netId, resolutionRef.current)
      && cachedBars >= SPARSE_SERIES_FLOOR
    if (!warmSwitch) {
      setChartReady(false)
      // Arm the datafeed's first-window early-ready for this symbol (see
      // coldSwitchSymRef) - the shimmer must not outlive the data when TV's
      // completion callback wedges on a sparse series.
      coldSwitchSymRef.current = symToApply
    }

    fitSettleUntilRef.current = Date.now() + 1500
    // Reset datafeed caches for new symbol
    datafeedRef.current.resetCaches()
    // Reconnect streaming for new token
    datafeedRef.current.reconnectStream(resolutionRef.current)
    // Tell TradingView to switch symbol - triggers getBars with new symbol via datafeed
    try {
      const chart = widgetRef.current.activeChart()
      pendingSwitchFitRef.current = true
      tvdbg('setSymbol ->', symToApply.slice(0, 10), resolutionRef.current)
      widgetRef.current.setSymbol(symToApply, resolutionRef.current, () => {
        tvdbg('setSymbol CALLBACK')
        markAndMeasure('tv-symbol-ready', 'tv-switch-start')
        coldSwitchSymRef.current = null // early-ready no longer needed
        setChartReady(true)
        stickyFitChart(chart, true)
      })
    } catch (e) {
      console.error('[TV Advanced] setSymbol failed:', e)
    }
  }
  useEffect(() => {
    if (prevSymbolRef.current === chartSymbol) return
    if (readyRef.current && widgetRef.current && datafeedRef.current) {
      applySymbolSwitchRef.current(chartSymbol)
    } else {
      // Widget not ready (fresh create still initialising) - QUEUE the switch;
      // onChartReady flushes it. Do NOT advance prevSymbolRef here or the
      // switch would be silently dropped (stale legend + foreign caches).
      pendingSymbolRef.current = chartSymbol
      setChartReady(false)
    }
  }, [chartSymbol])

  // Handle timeframe changes without full recreate
  useEffect(() => {
    lastNavRef.current = Date.now()
    if (readyRef.current && widgetRef.current) {
      try {
        programmaticResChangeRef.current = true
        fitSettleUntilRef.current = Date.now() + 1500
        const chart = widgetRef.current.activeChart()
        pendingSwitchFitRef.current = true
        chart.setResolution(resolution, () => {
          programmaticResChangeRef.current = false
          // Warm-switch fit (data already cached) - aggressive to beat TV's
          // preserved-window restore. Cold switches ALSO resolve via the armed
          // pendingSwitchFitRef -> onDataLoaded aggressive fit.
          stickyFitChart(chart, true)
        })
        // Safety fallback in case callback doesn't fire
        setTimeout(() => { programmaticResChangeRef.current = false }, 800)
      } catch (e) { programmaticResChangeRef.current = false }
    }
  }, [resolution])

  // Y-AXIS REPAINT on Price<->MCap toggles + supply-VALUE changes. The
  // series is raw and only the labels scale (format-time barScaleRef read),
  // so both a mode toggle and a circSupply landing AFTER the bars (details
  // resolve ~0.5-1.5s behind the now-instant chart) need an explicit
  // repaint - nothing else refreshes the stale labels until the next live
  // tick, minutes on a dead token. A cheap autoscale nudge re-renders the
  // scale with the fresh multiplier; the TIME position/zoom is untouched,
  // so a toggle no longer resets where the user scrolled (the old ':mcap'
  // symbol suffix re-fed the whole series via setSymbol). Supply drift
  // while in PRICE mode stays a no-op via the lastApplied guard (the
  // effective scale holds at 1), so a manual axis zoom is never stomped by
  // a background supply refresh - only by an explicit user toggle.
  const lastAppliedScaleRef = useRef(null)
  useEffect(() => {
    const scale = (yAxisMode === 'mcap' && circSupply > 0) ? circSupply : 1
    if (scale === lastAppliedScaleRef.current) return
    lastAppliedScaleRef.current = scale
    if (!readyRef.current || !widgetRef.current) return
    try {
      const chart = widgetRef.current.activeChart()
      // The grid labels come from the internal price scale's MARKS CACHE.
      // An autoscale nudge doesn't clear it when the raw range is unchanged
      // (the series is identical in both modes - only the formatter output
      // differs); a log<->linear round-trip cleared it but visibly rescaled
      // the chart for a beat; and clearing the cache alone (updateFormatter)
      // repainted NOTHING on tokens without live ticks - marks rebuild
      // lazily on the next draw, and with no stream tick there IS no next
      // draw, so the toggle looked completely dead. Two steps, both needed:
      // 1. updateFormatter() rebuilds the formatter + marks cache in place
      //    (internal but reachable off the official wrapper; harmless no-op
      //    if the library ever renames it - the formatter reads barScaleRef
      //    LIVE at format() time, so even a stale formatter object emits
      //    the right unit).
      chart.getPanes()[0].getMainSourcePriceScale()._priceScale?.updateFormatter?.()
      // 2. a same-value scalesProperties override forces a SYNCHRONOUS
      //    scale rebuild + redraw through the official API - verified: all
      //    labels regenerate immediately, zero visual change, viewport and
      //    zoom untouched. (Resize events and offset identity-nudges do
      //    nothing; this is the one official trigger that repaints the
      //    axis on demand.)
      const axisFontSize = (typeof window !== 'undefined'
        && window.matchMedia?.(MOBILE_MEDIA_QUERY)?.matches) ? 9 : 11
      chart.applyOverrides({ 'scalesProperties.fontSize': axisFontSize })
    } catch { /* mid-init - the next paint reads the live scale anyway */ }
  }, [circSupply, yAxisMode])

  // Toggle the TV drawing rail on demand (the toolbar pencil button bumps
  // drawNonce). The rail starts COLLAPSED (hide_side_toolbar: true) for the
  // fast-terminal look; this brings the full drawing toolset back in one
  // click. 'drawingToolbarAction' is TV's own show/hide side-toolbar action.
  useEffect(() => {
    if (!drawNonce) return
    if (!readyRef.current || !widgetRef.current) return
    try { widgetRef.current.activeChart().executeActionById('drawingToolbarAction') }
    catch (e) { console.warn('[TV] draw toggle failed:', e?.message) }
  }, [drawNonce])

  // Reset / fit the TV chart's zoom + scroll on demand. The toolbar "Reset" button
  // (shown only while the TV chart is active) bumps resetNonce. Reuses the same
  // fit-to-view logic the symbol/timeframe effects run - ~80 bars visible + price
  // re-auto-scaled - because the canvas zoomLevel/priceZoom state can't drive the
  // TV widget. Skips the initial mount (nonce 0).
  useEffect(() => {
    if (!resetNonce) return
    if (!readyRef.current || !widgetRef.current) return
    try {
      fitSettleUntilRef.current = Date.now() + 1500
      const chart = widgetRef.current.activeChart()
      // 'chartReset' is the library's canonical "reset chart" action - it fits the
      // zoom + scroll back to the default view from ANY state (zoomed in OR out),
      // repeatably. The old setRightOffset path only nudged the scroll offset, so a
      // second Fit from a fresh zoom did nothing - that's the "works once" bug.
      // 'chartReset' clears any zoom/scroll state repeatably (the old
      // offset-only nudge "worked once"); smartFitChart then applies the
      // range-normalized view - chartReset alone restores TV's DEFAULT
      // barSpacing, which inherits across symbols and misframes short
      // series (the same "broken candles" class the switch fit fixes).
      if (typeof chart.executeActionById === 'function') {
        try { chart.executeActionById('chartReset') }
        catch (e) { console.warn('[TV] chartReset failed:', e?.message) }
      }
      smartFitChart(chart)
    } catch (e) { console.warn('[TV] fit failed:', e?.message) }
  }, [resetNonce])

  // Tell the parent when the USER zooms/pans the TV chart (so it shows the "Fit"
  // button). Re-subscribes on every chart-ready (mount, re-attach, symbol change)
  // and cleans up on unmount, so it always listens to the CURRENT chart - wiring it
  // once in setupChartFeatures went stale after a Candles<->TV switch. The settle
  // window (armed here + before each programmatic fit) swallows the fits the library
  // itself triggers, so only a genuine user zoom/pan flips Fit on.
  useEffect(() => {
    if (!chartReady || !widgetRef.current) return
    let sub
    let dataSub
    let iframeDoc = null
    // Guards the async retry below: onChartReady / the timer can fire after
    // this effect has been torn down (token switch, engine toggle), and
    // subscribing a dead chart leaks the listener past cleanup.
    let cancelled = false
    const onRange = () => {
      if (Date.now() < fitSettleUntilRef.current) return
      try { onUserZoomRef.current?.() } catch {}
    }
    // Each data load (initial bars, slow cold load, scroll-back) auto-fits the chart,
    // which fires onVisibleRangeChanged. Re-arm the settle on every data load so that
    // library fit is never mistaken for a user zoom (the cause of "Fit" showing by
    // default on a slow load). onDataLoaded does NOT fire on live ticks, so it stays
    // infrequent and the settle still expires between loads for genuine pan detection.
    const onData = () => { fitSettleUntilRef.current = Date.now() + 1500 }
    // Wheel / pinch are USER-ONLY (the library's auto-fit never dispatches them), so
    // they flip Fit on INSTANTLY with no settle delay - matching the canvas charts.
    // The settle-guarded onVisibleRangeChanged below is the backstop for drag-pan /
    // axis-drag (which can't be told apart from the programmatic fit by event type).
    // Also stamps lastUserGestureRef so stickyFitChart stops re-fitting the
    // moment the user takes over the viewport.
    const onUserGesture = () => {
      lastUserGestureRef.current = Date.now()
      noteUserGesture() // module-level: viewport restores must yield to the user
      try { onUserZoomRef.current?.() } catch {}
    }
    // Drag-pan stamps too (wheel/touch alone missed the desktop mouse drag -
    // the scroll-back restore then treated a mid-load pan as TV's own shift).
    const onPointerGesture = (e) => { if (e.type === 'pointerdown' || e.buttons) onUserGesture() }
    // `chartReady` + a live widgetRef are NOT sufficient: activeChart() still
    // throws internally for a beat after the widget object exists, so this
    // wiring was landing in the catch and silently never subscribing - which
    // kills the Fit button and the user-gesture detection stickyFitChart
    // relies on, with only a console warning to show for it. Retry through the
    // library's own readiness callback, then fall back to a couple of frames.
    let wireTimer = 0
    const wireRange = (attempt = 0) => {
      if (cancelled) return true
      const w = widgetRef.current
      if (!w) return true // widget torn down - nothing to wire, not an error
      try {
        const chart = w.activeChart()
        fitSettleUntilRef.current = Date.now() + 1500
        sub = chart.onVisibleRangeChanged()
        sub.subscribe(null, onRange)
        if (typeof chart.onDataLoaded === 'function') {
          dataSub = chart.onDataLoaded()
          dataSub.subscribe(null, onData)
        }
        return true
      } catch (e) {
        if (attempt === 0 && typeof w.onChartReady === 'function') {
          try { w.onChartReady(() => wireRange(1)); return false } catch { /* fall through */ }
        }
        if (attempt < 3) { wireTimer = setTimeout(() => wireRange(attempt + 1), 250); return false }
        console.warn('[TV] range-sync wiring skipped:', e?.message)
        return true
      }
    }
    wireRange()
    try {
      iframeDoc = containerRef.current?.querySelector('iframe')?.contentDocument || null
      if (iframeDoc) {
        iframeDoc.addEventListener('wheel', onUserGesture, { capture: true, passive: true })
        iframeDoc.addEventListener('touchmove', onUserGesture, { capture: true, passive: true })
        iframeDoc.addEventListener('pointerdown', onPointerGesture, { capture: true, passive: true })
        iframeDoc.addEventListener('pointermove', onPointerGesture, { capture: true, passive: true })
      }
    } catch (e) { /* iframe not ready / cross-origin - the range sub still covers it */ }
    return () => {
      cancelled = true
      if (wireTimer) clearTimeout(wireTimer)
      try { sub?.unsubscribe(null, onRange) } catch {}
      try { dataSub?.unsubscribe(null, onData) } catch {}
      try {
        if (iframeDoc) {
          iframeDoc.removeEventListener('wheel', onUserGesture, { capture: true })
          iframeDoc.removeEventListener('touchmove', onUserGesture, { capture: true })
          iframeDoc.removeEventListener('pointerdown', onPointerGesture, { capture: true })
          iframeDoc.removeEventListener('pointermove', onPointerGesture, { capture: true })
        }
      } catch {}
    }
  }, [chartReady])

  // Keep the token stream ref in sync + reconnect the live feed when the token
  // OR its pair address changes. The pair address resolves ASYNC (details land
  // ~0.5-1.5s after the chart), so a late arrival must UPGRADE the live feed
  // from the price-synth fallback to the authoritative bar stream — this is the
  // "topPairAddress arrives late → reconnect the bars stream" path. Preserve
  // symbol + pairAddress in the ref write (the old write dropped both).
  const resolvedPair = pairAddress || token?.topPairAddress || null
  useEffect(() => {
    const addr = token?.address
    if (!addr) return
    const prevAddr = tokenStreamRef.current?.address
    const prevPair = tokenStreamRef.current?.pairAddress
    const prevSide = tokenStreamRef.current?.pairSide || null
    tokenStreamRef.current = { address: addr, networkId: tokenNetworkId, symbol: token?.symbol, pairAddress: resolvedPair, pairSide: pairSide || null }
    // A late-arriving pair SIDE also reconnects: the stream may already be up
    // on the guessed side, and the known side is what makes it correct.
    if ((addr !== prevAddr || resolvedPair !== prevPair || (pairSide || null) !== prevSide) && datafeedRef.current?.reconnectStream) {
      datafeedRef.current.reconnectStream(resolution)
    }
  }, [token?.address, token?.symbol, tokenNetworkId, resolvedPair, pairSide, resolution])

  // Trade markers on chart
  useEffect(() => {
    if (!datafeedRef.current) return
    datafeedRef.current.setTradeMarkers(tradeMarkers || [])

    if (readyRef.current && widgetRef.current) {
      try {
        const chart = widgetRef.current.activeChart()
        chart.clearMarks()
        chart.refreshMarks()
      } catch (e) { console.error(e) }
    }
  }, [tradeMarkers])

  // FAIL-OPEN: if onChartReady / setSymbol callback never fires within 5s
  // (TV library 404, CSP block, network error, widget creation failure),
  // drop the skeleton anyway so the user sees the underlying state instead
  // of an infinite shimmer. Re-arms on every symbol change.
  useEffect(() => {
    if (chartReady) return
    const t = setTimeout(() => setChartReady(true), 5000)
    return () => clearTimeout(t)
  }, [chartSymbol, chartReady])

  return (
    <div style={{ position: 'relative', width: '100%', height: height || '100%' }}>
      <div
        ref={containerRef}
        className="tradingview-advanced-container"
        style={{ width: '100%', height: '100%' }}
      />
      {!chartReady && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <ChartLoader />
        </div>
      )}
    </div>
  )
})

export default TradingViewAdvanced
