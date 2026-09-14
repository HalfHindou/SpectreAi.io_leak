import { useState, useEffect, useCallback, useRef } from 'react';
import { isAppActive } from '@/lib/idleManager';
import { getBars } from '@/services/codexApi';
import { getBinanceKlines } from '@/services/binanceApi';
import { hasBinancePair } from '@/services/binanceCatalog';
import { getSpectreTokenProfile, getSpectreSearch } from '@/services/spectreMarketApi';
import { getTokenChart as spectreGetTokenChart } from '@/services/spectreDataApi';
import { subscribe as streamSubscribe } from '@/services/codexStreamApi';
import {
  DEEP_PAGE_COUNTBACK, isDeepPageEligible, historyWindow, eraCliffToleranceMs,
  seamContractBroken,
} from './chart-history-window';

const DEV = import.meta.env.DEV;

// L5-charts-B (2026-06-03): SSE bar-update fan-out kill switch. When set,
// the chart falls back to pure polling (no SSE last-bar updates). Useful
// for ops if the SSE relay misbehaves.
//   localStorage.L5_PR_DISABLE_SSE = '1' -> persistent disable for this user
//   import.meta.env.VITE_DISABLE_SSE_CHARTS = '1' -> build-time disable
function _sseDisabled() {
  try {
    if (import.meta.env?.VITE_DISABLE_SSE_CHARTS === '1') return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('L5_PR_DISABLE_SSE') === '1') return true;
  } catch (_) { /* SSR / private mode */ }
  return false;
}

// Bar duration in seconds for each resolution. Mirrors TradingViewAdvanced's
// RES_SECONDS so the SSE bar-rollover logic produces buckets aligned with
// the existing polling/cache machinery.
const _RES_SECONDS = {
  '1S': 1, 'S': 1,
  '1': 60, '5': 300, '15': 900, '30': 1800,
  '60': 3600, '240': 14400, '720': 43200,
  '1D': 86400, 'D': 86400,
  '1W': 604800, 'W': 604800,
  '1M': 2592000, 'M': 2592000,
};

// Normalize an address for SSE token-key matching. Codex emits EVM addresses
// lowercase; Solana base58 mints stay cased. We MUST match what the SSE
// payload reports verbatim or every tick gets dropped silently.
function _normalizeAddress(rawAddr) {
  if (!rawAddr) return null;
  const isSolana = !rawAddr.startsWith('0x') && rawAddr.length >= 32;
  return isSolana ? rawAddr : rawAddr.toLowerCase();
}

// Extract (address, networkId) from a chart symbol that may be:
//   "0xabc...:1"  (address:networkId composite — DEX tokens)
//   "BTC"         (CEX ticker — return null, SSE not supported)
//   "ABC123..."   (raw Solana mint — return null without networkId)
function _addressFromSymbol(symbol, networkId) {
  if (!symbol) return null;
  if (symbol.includes(':')) {
    const [rawAddr, netStr] = symbol.split(':');
    const addr = _normalizeAddress(rawAddr);
    const net = parseInt(netStr) || networkId || 1;
    if (addr && net) return { address: addr, networkId: net };
  }
  // Treat any 0x...-prefixed or base58-length symbol as an on-chain address.
  if (symbol.startsWith('0x') || symbol.length >= 32) {
    const addr = _normalizeAddress(symbol);
    if (addr && networkId) return { address: addr, networkId };
  }
  return null;
}

// Ratio of single-tick "flat" bars (O==H==L==C) above which OHLC is
// considered unreliable for candlestick rendering. Codex returns these for
// low-liquidity DEX tokens with sparse trade history and they render as
// scattered horizontal dots — line data from CoinGecko is cleaner.
const FLAT_BAR_THRESHOLD = 0.4;
const SPARSE_OHLC_MIN_BARS = 20;

function computeFlatRatio(bars) {
  if (!bars || bars.length < SPARSE_OHLC_MIN_BARS) return 0;
  let flat = 0;
  for (const b of bars) {
    if (b.high === b.low && b.open === b.close && b.close > 0) flat++;
  }
  return flat / bars.length;
}

async function fetchCoinGeckoLineBars(cgId, periodHours) {
  if (!cgId) return null;
  // periodHours === 'max' -> the token's full CG history (daily granularity).
  // Used by the line-chart deep-history upgrade on first left-wall hit.
  const days = periodHours === 'max' ? 'max' : Math.max(1, Math.ceil(periodHours / 24));
  try {
    const res = await fetch(`/api/coingecko/coins/${encodeURIComponent(cgId)}/market_chart?vs_currency=usd&days=${days}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.prices?.length) return null;
    return data.prices.map(([tsMs, price]) => ({
      time: tsMs,
      open: price, high: price, low: price, close: price,
      volume: 0,
    }));
  } catch (_) {
    return null;
  }
}

// ── Scroll-back history machinery ─────────────────────────────────────────
// Window sizing per resolution (hours). Every window MUST fit BOTH source
// caps or parallel strided windows splice time holes (the index-plotted
// canvas renders those as cliffs):
//   - Binance klines: max 1000 bars per request (a 1400-bar window silently
//     short-fills to the newest 1000, leaving a hole before the next stride)
//   - Codex getBars: silently truncates spans wider than ~4y (codexApi
//     MAX_BARS_RANGE_SEC clamps to 3y) - the old 27y 1W window refetched the
//     same recent bars forever and the pager declared genesis ("stops at
//     breakpoint")
// So: stride = min(~960-1000 bars, 3 years). Older tokens page back in
// successive windows.
const SCROLLBACK_HOURS = {
  '1S': 0.25,   // 900 bars
  '1': 16,      // 960 bars
  '5': 80,      // 960 bars
  '15': 250,    // 1000 bars
  '30': 500,    // 1000 bars
  '60': 1000,   // 1000 bars
  '240': 4000,  // 1000 bars
  '720': 12000, // 1000 bars
  '1D': 24000,  // 1000 days
  '1W': 26280,  // 3y Codex clamp = ~156 weekly bars
};
const BARS_EPOCH_MS = 1483228800 * 1000; // Jan 1 2017 - no OHLCV before this on any of our sources
// Background-extend ceiling, PER RESOLUTION. The cap must match what the
// view can actually show: the renderer floors candles at 1px, so one screen
// maxes out around ~900 bars - on minute charts a 40k+ buffer is months of
// data that zoom-out can never reach (it just made the prefetch burst long
// and render-heavy, felt as flicker). Deep "2021/2022/2023" exploration
// lives on the hour/day presets, which get deep caps. The USER path
// (fetchMoreHistory) stays uncapped - explicit scroll intent always loads.
const maxBufferFor = (resolution) => {
  const r = String(resolution || '60').toUpperCase();
  if (r === '1S' || r === '1' || r === '5') return 6000;      // minutes: ~3 weeks of 5m
  if (r === '15' || r === '30' || r === '60') return 20000;   // hours: ~2.3y of 1h
  return 50000;                                               // 4h/12h/1D/1W: to genesis
};
// Serving tiers that don't bill Codex AND respond fast - free to prefetch
// deep history for. Unknown/billed/slow tiers only prefetch ONE window
// speculatively; deeper prefetch unlocks on real scroll intent (first
// user-driven history fetch).
// 'geckoterminal' removed 2026-07-10: GT is free but SLOW (measured 4-8s per
// cold 1000-bar window) and rate-limited (~30 req/min). The cheap-tier boot
// burst (2 windows, then 3) stacked 5 parallel GT fetches on every GT-served
// token open, competing with the visible head fetch and tripping GT's rate
// limit (observed as multi-minute hangs). GT now paces like a billed source.
const CHEAP_BAR_SOURCES = new Set(['binance', 'cg-ohlc', 'cgOhlc', 'hetzner', 'spectre-ohlc']);
// Speculative (no-scroll-intent) buffer ceiling for cheap sources. Enough for
// several screens of instant panning; the full maxBufferFor depth loads only
// after the user actually reaches back into history (scrollIntentRef).
const SPEC_BUFFER_CHEAP = 4000;

// ── Early head-bars prefetch (NOT a cache) ────────────────────────────────
// On a cold Research Zone load the chart's first /api/bars request only fires
// after the lazy TradingChart chunk + mount chain completes, while the page
// knows the token's address seconds earlier. prefetchChartBars() lets the
// page START that exact request early; fetchBars() then consumes the
// in-flight promise instead of firing its own. One network request total,
// nothing is stored beyond the promise handoff, and a consumed/stale entry
// is never reused - so data freshness semantics are identical to before.
// Keyed identically to fetchBars' fetchKey (symbol|resolution|periodHours):
// any parameter drift makes the prefetch a no-op, never a wrong-window chart.
const _headPrefetch = new Map(); // key -> { promise|null, ts }
const _PREFETCH_FRESH_MS = 60_000;

export function prefetchChartBars(symbol, { resolution = '60', periodHours = 168, networkId = 1, cgId = null, binancePair = null, tickerSymbol = null } = {}) {
  if (!symbol) return;
  const key = `${symbol}|${resolution}|${periodHours}`;
  const existing = _headPrefetch.get(key);
  // Fresh entry = the hook already fetched/registered (token-switch path) or
  // a prefetch is already in flight (StrictMode double-effect) - skip.
  if (existing && Date.now() - existing.ts < _PREFETCH_FRESH_MS) return;
  // Mirror fetchBars' source routing: windows that the direct-Binance branch
  // serves (spot pair + <=1000 bars) never reach getBars - prefetching them
  // would ADD a server call instead of fronting one.
  const to = Math.floor(Date.now() / 1000);
  const from = to - periodHours * 3600;
  const resSec = _RES_SECONDS[String(resolution || '60').toUpperCase()] || 3600;
  const requestedBars = Math.ceil((to - from) / resSec);
  const upperTicker = (tickerSymbol || symbol || '').toUpperCase().split(':')[0];
  if (requestedBars <= 1000 && hasBinancePair(upperTicker)) return;
  if (_headPrefetch.size > 40) _headPrefetch.clear(); // session-bounded hygiene
  const promise = getBars(symbol, resolution, from, to, networkId, cgId, binancePair).catch(() => null);
  _headPrefetch.set(key, { promise, ts: Date.now() });
}

// Take a pending prefetch for this exact fetch key. The promise stays
// consumable for 5s after first use: React StrictMode double-invokes the
// mount effect in dev, and the second fetchBars must reuse the same promise
// instead of firing a duplicate network call. Past that window the entry
// degrades to a promise-less marker (so a late page-level prefetch call
// skips while the hook's own fetch is in flight) - which also guarantees
// the 30s poll can never re-consume a stale head.
function _takeHeadPrefetch(key) {
  const e = _headPrefetch.get(key);
  if (e && e.promise && Date.now() - e.ts < _PREFETCH_FRESH_MS) {
    if (!e.usedAt) e.usedAt = Date.now();
    if (Date.now() - e.usedAt < 5000) return e.promise;
  }
  _headPrefetch.set(key, { promise: null, ts: Date.now() });
  return null;
}

const formatServerBars = (raw) => raw.map(bar => ({
  time: bar.t * 1000,
  open: parseFloat(bar.o) || 0,
  high: parseFloat(bar.h) || 0,
  low: parseFloat(bar.l) || 0,
  close: parseFloat(bar.c) || 0,
  volume: parseFloat(bar.v) || 0,
}));

// Merge a batch of older bars with existing bars: dedup by timestamp, sort
// ascending. The chart renders by array index, so any overlap or out-of-order
// bars produce visible gaps and displaced candles.
function mergeOlderBars(prevBars, newBars) {
  if (!newBars.length) return prevBars;
  const seen = new Set(prevBars.map(b => b.time));
  const unique = newBars.filter(b => !seen.has(b.time));
  if (!unique.length) return prevBars;
  const merged = unique.concat(prevBars);
  merged.sort((a, b) => a.time - b.time);
  return merged;
}

// Median of the first 20 bar intervals - robust against sparse DEX spacing
// and same-bucket WS blends (bars[1]-bars[0] alone can be wildly off).
function medianIntervalMs(bars) {
  const diffs = [];
  for (let i = 1; i < Math.min(bars.length, 21); i++) {
    const d = bars[i].time - bars[i - 1].time;
    if (d > 0) diffs.push(d);
  }
  if (!diffs.length) return 0;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

// One older-history window: Binance first for tokens with a spot pair
// (free, clean), then the server /api/bars composite. Returns formatted
// bars + the serving source ('' bars = nothing older exists on any source).
async function fetchOlderWindow(ctx, toSec, opts = {}) {
  const { symbol, resolution, networkId, cgId, binancePair, tickerSymbol } = ctx;
  const fetchHours = SCROLLBACK_HOURS[resolution] || 1400;
  const strideSec = Math.floor(fetchHours * 3600);
  const tickerForBinance = (tickerSymbol || symbol || '').toUpperCase().split(':')[0];
  const binanceBacked = hasBinancePair(tickerForBinance);
  // Direct Binance only for windows within its 1000-bar/request cap - wider
  // windows silently short-fill (newest 1000 only), splicing holes between
  // parallel strides. Wider windows go to the server composite, which chunks
  // Binance server-side and returns the full range in one round-trip.
  const resSec = _RES_SECONDS[String(resolution || '60').toUpperCase()] || 3600;
  const windowBars = Math.ceil(strideSec / resSec);
  if (windowBars <= 1000 && binanceBacked) {
    try {
      const b = await getBinanceKlines(tickerForBinance, resolution, toSec - strideSec, toSec);
      if (b?.getBars?.length) {
        return { bars: formatServerBars(b.getBars), source: 'binance', windowSec: strideSec, meta: null };
      }
    } catch (_) { /* fall through to server composite */ }
  }
  // DEEP PAGE (2026-08-26). SCROLLBACK_HOURS sizes a window in BUCKETS, which
  // is the right unit for a dense CEX tape and the wrong one for a thin DEX
  // token: measured on prod, LEO's 5m stride (80h) returned 9 bars covering 2
  // days, while the SAME anchor and the SAME ~700ms round-trip asked as a wide
  // window with countback returned 1500 bars covering 283 days. Deep pages ask
  // the server to page by real trade bars instead. Binance-backed tokens keep
  // the narrow stride (their direct-klines path caps at 1000 bars/request).
  const deep = isDeepPageEligible({ deep: opts.deep, hasBinancePair: binanceBacked });
  const { fromSec, windowSec } = historyWindow(toSec, { deep, strideSec });
  try {
    const d = await getBars(
      symbol, resolution, fromSec, toSec, networkId, cgId, binancePair,
      deep ? { countback: DEEP_PAGE_COUNTBACK } : null,
    );
    if (d?.getBars?.length) {
      // meta carries the tier's data contract (cg-ohlc -> volumeAvailable:false,
      // GT -> gapFilled/realBarRatio). applyOlderBatch needs it to refuse a
      // close-only tier splicing into a real OHLCV tape.
      return { bars: formatServerBars(d.getBars), source: d.source || 'codex', windowSec, deep, meta: d.meta || null };
    }
    // `failed` rides along so the pager can tell a broken request from a window
    // that genuinely holds no bars - only the latter is evidence of genesis.
    return { bars: [], source: d?.source || null, failed: !!d?.failed, windowSec, deep };
  } catch (_) {
    return { bars: [], source: null, failed: true, windowSec, deep };
  }
}

// Fetch up to batchN CONTIGUOUS older windows in parallel (window i ends
// where window i-1 begins) and accept only the unbroken run from window 0.
// Stopping at the first empty window leaves a clean boundary for the next
// round - merging around a failed middle window would splice a time hole,
// which the index-plotted canvas renders as a cliff. A seam check between
// accepted segments guards against a source SHORT-FILLING a window (e.g. a
// rate-limited partial response): the run is cut at the first broken seam.
async function fetchContiguousOlderRound(ctx, oldestMs, batchN, opts = {}) {
  const strideSec = Math.floor((SCROLLBACK_HOURS[ctx.resolution] || 1000) * 3600);
  const oldestSec = Math.floor(oldestMs / 1000);
  // Resolve deep-page eligibility ONCE for the round so the batch shape and the
  // window shape can't disagree (fetchOlderWindow re-checks, defence in depth).
  const _ticker = (ctx.tickerSymbol || ctx.symbol || '').toUpperCase().split(':')[0];
  const deep = isDeepPageEligible({ deep: opts.deep, hasBinancePair: hasBinancePair(_ticker) });
  // A deep page already walks back DEEP_PAGE_COUNTBACK real trade bars from
  // `to`. Fanning out contiguous strides on top of it would re-ask for the span
  // the first page has already covered - wasted latency and, on Codex, a wasted
  // billed query. One page per round; the caller advances its cursor to what
  // came back.
  const effectiveBatchN = deep ? 1 : batchN;
  const jobs = [];
  for (let i = 0; i < effectiveBatchN; i++) {
    const toSec = oldestSec - 1 - i * strideSec;
    if (toSec * 1000 <= BARS_EPOCH_MS) break;
    // Belt and braces over the fetch-layer timeout: a window that somehow still
    // hangs must not keep the round (and with it inflightOlderRef) pending -
    // that is what silently ends scroll-back for the rest of the session.
    jobs.push(Promise.race([
      fetchOlderWindow(ctx, toSec, { deep }).catch(() => ({ bars: [], source: null, failed: true })),
      new Promise(resolve => setTimeout(() => resolve({ bars: [], source: null, failed: true }), 30000)),
    ]));
  }
  if (!jobs.length) return { bars: [], genesis: true, codexServed: 0 };
  const results = await Promise.all(jobs);
  // A broken window 0 tells us nothing about history - never report genesis on it.
  const failed = !results[0].bars.length && !!results[0].failed;
  const segments = [];
  let codexServed = 0;
  for (const r of results) {
    if (!r.bars.length) break; // first empty window = boundary (or genesis)
    if (segments.length) {
      // Seam: this (older) segment's newest bar must sit close to the
      // previous (newer) segment's oldest bar. 50x the segment's own median
      // interval tolerates sparse DEX gaps; a short-filled window is cut.
      const newerOldest = segments[segments.length - 1][0].time;
      const olderNewest = r.bars[r.bars.length - 1].time;
      const iv = medianIntervalMs(r.bars) || strideSec * 1000 / Math.max(1, r.bars.length);
      if (newerOldest - olderNewest > iv * 50) break;
    }
    if (r.source === 'codex') codexServed++;
    segments.push(r.bars);
  }
  // segments[0] is the newest stride; older strides go in front.
  const bars = segments.length ? segments.reverse().flat() : [];
  // Near-genesis heuristic (ported from trading's pre-genesis-cascade fix):
  // if the accepted data starts in the NEWER half of window 0's span, the
  // older half was empty = the token's genesis is inside this window. The
  // caller must NOT fan out further rounds - they'd be pre-genesis empties,
  // each a wasted (and for Codex, billed) round-trip.
  const w0FromMs = (oldestSec - 1 - strideSec) * 1000;
  // A countback-shaped answer carries its own, sharper genesis signal: we asked
  // Codex to walk back a fixed number of REAL bars, so a short answer means it
  // ran out of them. Only Codex honours countback though - the free tiers page
  // by their own window and legitimately return ~1000 bars every time, so
  // reading a short answer as near-genesis there would be permanently true
  // (measured on dev: GT answers deep pages with 974 bars). They keep the
  // residual signal that still means something.
  const servedSource = results[0]?.source || null;
  const nearGenesis = deep
    ? (bars.length > 0 && (servedSource === 'codex'
        ? bars.length < DEEP_PAGE_COUNTBACK
        : bars.length < 8))
    : (bars.length > 0 &&
       (bars[0].time > w0FromMs + (strideSec * 1000) / 2 || bars.length < 8));
  // windowSec is what applyOlderBatch must size its era-cliff tolerance from -
  // a deep page legitimately spans years, and judging it against the narrow
  // stride would read a quiet stretch as a wrong-era cliff.
  const windowSec = results[0]?.windowSec || strideSec;
  return { bars, genesis: segments.length === 0 && !failed, failed, codexServed, nearGenesis, windowSec, deep, meta: results[0]?.meta || null, source: servedSource };
}

/**
 * Hook for fetching OHLCV chart data
 * @param {string} symbol - Token symbol (e.g., "ETH", "SPECTRE")
 * @param {string} resolution - Candle resolution: "1", "5", "15", "60", "240", "D", "W"
 * @param {number} networkId - Network ID (1 for Ethereum, 1399811149 for Solana)
 * @param {number} periodHours - How many hours of data to fetch
 * @param {string} [cgId] - CoinGecko ID for market_chart fallback (e.g., "bitcoin")
 */
export function useChartData(symbol, resolution = '60', networkId = 1, periodHours = 168, cgId = null, tickerSymbol = null, binancePair = null, options = null) {
  // Options ride a ref so toggling chart type (preferOhlc flips) never
  // invalidates fetch callbacks and triggers refetch loops.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [bars, setBars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [athPrice, setAthPrice] = useState(null);
  const [chartSource, setChartSource] = useState(null);
  const athFetchedRef = useRef(null); // Track which symbol we've fetched ATH for
  // A symbol alone cannot identify chart data: a late daily response must not
  // overwrite the weekly chart selected meanwhile. Replace the token on every
  // request-identity change, including A -> B -> A while A is still in flight.
  const requestKey = JSON.stringify([symbol, resolution, periodHours, networkId, cgId, tickerSymbol, binancePair]);
  const activeRequestRef = useRef({ key: requestKey });
  if (activeRequestRef.current.key !== requestKey) activeRequestRef.current = { key: requestKey };
  const requestIdentity = activeRequestRef.current;
  const loadedRequestRef = useRef(null);
  // Tracks the (symbol|resolution) of bars currently in state so the 30s poll
  // can MERGE fresh bars with any older history the user lazy-loaded by panning,
  // instead of replacing the full array (which would clamp panOffset to 0 and
  // make the chart visibly jump back to the right edge).
  const loadedKeyRef = useRef(null);
  // ── Scroll-back machinery refs ──
  // Render-time mirrors so the background extender + fetchMoreHistory read
  // current values without stale closures or effect-dep churn.
  const barsRef = useRef(bars); barsRef.current = bars;
  const hasMoreRef = useRef(hasMoreHistory); hasMoreRef.current = hasMoreHistory;
  const sourceRef = useRef(chartSource); sourceRef.current = chartSource;
  // True after the FIRST user-driven history fetch. Codex-billed tokens only
  // prefetch one speculative window until this flips - never deep-bill Codex
  // for history the user may never look at (cost discipline, 2026-06 audit).
  const scrollIntentRef = useRef(false);
  // Promise while ANY older-window round is in flight (extender or user path)
  // so the two never duplicate the same window against Binance/Codex.
  const inflightOlderRef = useRef(null);
  // Consecutive EMPTY (not failed) user-driven history rounds. Two in a row is
  // genesis; one is noise. Reset on any round that returns bars.
  const userEmptyStreakRef = useRef(0);
  // aliveKeyRef = the (symbol|resolution|periodHours) the extender loop is
  // allowed to keep running for; reassigned on every extender-effect pass so
  // a key change (or unmount -> null) kills the old loop mid-iteration.
  // startedExtendRef = the LAST key a loop was started for, so same-key
  // effect re-fires (the 30s poll flips `loading`) don't spawn duplicates.
  const aliveKeyRef = useRef(null);
  const startedExtendRef = useRef(null);
  // CG-line deep-history upgrade is one-shot per token.
  const lineUpgradedRef = useRef(false);

  // Fetch ATH from CoinGecko via coins/markets endpoint (works with CoinGecko ID, not contract address)
  const fetchATH = useCallback(async () => {
    if (!symbol || athFetchedRef.current === symbol) {
      return; // Already fetched for this symbol
    }

    try {
      // symbol here is a ticker like "BTC" — look up CoinGecko ID
      const { SYMBOL_TO_COINGECKO_ID } = await import('@/constants/majorTokens');
      const cgId = SYMBOL_TO_COINGECKO_ID[symbol.toUpperCase()];

      let athValue = null;

      const profile = await getSpectreTokenProfile(symbol).catch(() => null);
      athValue =
        profile?.market?.ath_price ??
        profile?.market?.ath?.price ??
        profile?.price?.ath?.price ??
        profile?.price?.ath?.usd ??
        profile?.price?.ath ??
        null;

      if (!athValue && cgId && !DEV) {
        const response = await fetch(`/api/coingecko/coins/${cgId}?localization=false&tickers=false&community_data=false&developer_data=false`);
        if (response.ok) {
          const data = await response.json();
          athValue = data.market_data?.ath?.usd ?? null;
        }
      }

      if (athValue && athValue > 0) {
        setAthPrice(athValue);
      } else {
        setAthPrice(null);
      }
      athFetchedRef.current = symbol;
    } catch (err) {
      setAthPrice(null);
      athFetchedRef.current = symbol;
    }
  }, [symbol, networkId]);

  // Reset ATH when symbol changes
  useEffect(() => {
    athFetchedRef.current = null; // Force refetch for new symbol
    setAthPrice(null);
    lineUpgradedRef.current = false; // new token = fresh one-shot line upgrade
    scrollIntentRef.current = false; // billed prefetch re-gates per token
    if (symbol) fetchATH();
  }, [symbol, fetchATH]);

  const fetchBars = useCallback(async () => {
    const isStale = () => activeRequestRef.current !== requestIdentity;
    if (isStale()) return;
    if (!symbol) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      // Keep the previous chartSource until new data arrives — clearing it mid-refetch
      // makes downstream UI (timeframe presets, chart-type buttons) flicker between
      // OHLCV and line modes on every poll/timeframe change.

      // Calculate time range based on resolution
      const to = Math.floor(Date.now() / 1000);
      const from = to - (periodHours * 60 * 60);

      if (DEV) console.log(`Fetching chart data for ${symbol}, resolution: ${resolution}, networkId: ${networkId}`);
      // Refresh-vs-replace policy.
      // - First load for this (symbol|resolution): replace any leftover state.
      // - Same key as last successful load (= 30s polling refresh): MERGE so any
      //   older bars the user lazy-loaded by panning into history are preserved.
      //   Without this, polling collapses bars back to ~periodHours and the
      //   chart's panOffsetRef clamps to 0, producing a visible jump-to-now.
      // Include periodHours in the key: some timeframes share a resolution
      // (7D and 30D both map to '60', 24H/7D differ only by window on CG-line
      // data). Keying on resolution alone made a timeframe switch between two
      // same-resolution presets look like a 30s polling refresh -> it MERGED
      // instead of replacing -> the chart kept the prior window's bars and
      // appeared frozen across timeframes. periodHours disambiguates them so a
      // timeframe change is a clean replace, while an actual poll (same
      // timeframe -> same periodHours) still merges to preserve lazy history.
      const fetchKey = `${symbol}|${resolution}|${periodHours}`;
      const isRefresh = loadedKeyRef.current === fetchKey && loadedRequestRef.current === requestIdentity;
      // Re-gate the deep prefetch on every real switch, not just per token.
      // scrollIntentRef is reset in the symbol effect above ("re-gates per
      // token"), but the buffer is per (symbol|resolution|periodHours): one
      // pan-back anywhere in the session left the flag latched, so every LATER
      // timeframe switch skipped both extender guards and ran at full depth
      // immediately - measured 1918 -> 3807 -> 5695 -> 7598 bars in 2.4s, four
      // full re-sanitize + canvas redraw passes, while the first switch after a
      // page load was calm. That state-dependence is what read as the chart
      // loading "unstably". A genuine scroll-back after the switch re-arms it
      // on the spot (fetchMoreHistory sets it), so deep history still loads for
      // anyone who actually asks for it.
      if (!isRefresh) {
        scrollIntentRef.current = false;
        userEmptyStreakRef.current = 0;
        inflightOlderRef.current = null;
        setLoadingMore(false);
      }
      // Take any pending early prefetch NOW - synchronously, before the first
      // await - so the page-level prefetch effect (which runs AFTER this
      // effect in the same React commit on a token switch) sees the marker
      // _takeHeadPrefetch leaves and never double-fires the same request.
      const prefetchedHead = _takeHeadPrefetch(fetchKey);
      const applyFreshBars = (freshBars) => {
        if (isStale()) return;
        if (!isRefresh) {
          setBars(freshBars);
          loadedKeyRef.current = fetchKey;
          loadedRequestRef.current = requestIdentity;
          return;
        }
        setBars(prev => {
          if (isStale()) return prev;
          if (!prev || prev.length === 0) return freshBars;
          const freshTimes = new Set(freshBars.map(b => b.time));
          const olderTail = prev.filter(b => !freshTimes.has(b.time) && b.time < freshBars[0].time);
          if (olderTail.length === 0) return freshBars;
          return olderTail.concat(freshBars);
        });
      };

      let formattedBars = null;
      let source = null;
      let serverMeta = null;

      // Major tokens with Binance USDT pairs - skip onchain API for these (avoids wrong-token matches)
      // Use tickerSymbol for Binance lookups (address:networkId format won't match)
      const upperSym = (symbol || '').toUpperCase();
      const upperTicker = (tickerSymbol || '').toUpperCase();
      const hasBinanceSpot = hasBinancePair(upperTicker || upperSym);

      // Used below for routing onchain calls — symbol carries an address when it
      // contains ':' (address:networkId), starts with '0x', or is a base58 mint.
      const hasOnchainAddress = symbol.includes(':') || symbol.startsWith('0x') || symbol.length >= 32;

      // Source priority: onchain Codex bars → server /api/bars → CoinGecko (last resort).
      // Binance runs first only for tokens with a confirmed USDT pair (cleanest data).

      // Try Binance klines FIRST for tokens with Binance pairs (real-time, reliable, correct token)
      // Use tickerSymbol (e.g. 'BTC') not address format for Binance
      // ...but ONLY when the window fits Binance's 1000-bar/request cap.
      // Direct Binance silently SHORT-FILLS wider windows to the newest 1000
      // bars - the 1Y preset's 3y buffer came back as ~1000 daily bars ending
      // Oct 2023, which the user saw as a hard "2023 wall". Wide windows go
      // to the server composite instead: it chunks Binance server-side (its
      // own fast network + Hetzner candle store) and returns the FULL range
      // in one round-trip - also much faster on client networks where direct
      // api.binance.com is slow. (Gleb 2026-07-03)
      const binanceSymbol = (tickerSymbol || symbol || '').toUpperCase().split(':')[0];
      const _resSec = _RES_SECONDS[String(resolution || '60').toUpperCase()] || 3600;
      const _requestedBars = Math.ceil((to - from) / _resSec);
      if (!formattedBars && hasBinanceSpot && _requestedBars <= 1000) {
        try {
          const binanceData = await getBinanceKlines(binanceSymbol, resolution, from, to);
          if (binanceData?.getBars && binanceData.getBars.length > 0) {
            formattedBars = binanceData.getBars.map(bar => ({
              time: bar.t * 1000,
              open: parseFloat(bar.o) || 0,
              high: parseFloat(bar.h) || 0,
              low: parseFloat(bar.l) || 0,
              close: parseFloat(bar.c) || 0,
              volume: parseFloat(bar.v) || 0,
            }));
            // Label the source (2026-06-11): this branch left `source` null,
            // so chartSource downstream read null - cosmetically wrong in
            // logs and it kept the sparse-bar detector running on Binance
            // data it is supposed to skip.
            source = 'binance';
            if (DEV) console.log(`[binance] Received ${formattedBars.length} bars for ${binanceSymbol}`);
          }
        } catch (binErr) {
          if (DEV) console.warn('[binance] klines failed:', binErr.message);
        }
      }

      // Onchain pool tier REMOVED (2026-06-11): it passed the composite
      // "address:networkId" string to /api/onchain/pool/{addr} which rejects
      // it ("Invalid EVM address format") - AND it passed a TOKEN address
      // where a POOL address is expected, so even a bare address mostly
      // missed. Result: a guaranteed dead 400 round-trip + console noise on
      // EVERY DEX chart fetch. The server /api/bars cascade (Binance ->
      // Hetzner -> GT -> cg-ohlc -> Codex) fully covers on-chain tokens.

      // 2026-05-14: Spectre Data API disabled as a chart source.
      // Upstream /v1/prices/{sym}/ohlcv has shipped multi-hour gaps (e.g. the
      // 13-hour hole on 2026-05-13 affecting every token), and the chart
      // engine positions bars by array index — so gaps render as vertical
      // walls. Fall straight through to the server /api/bars composite
      // (Codex + Binance + CoinGecko), which handles cgId resolution and is
      // gap-free for major tokens. Re-enable only after backend backfills
      // the historical hole and adds gap-detection in upstream.
      // eslint-disable-next-line no-constant-condition
      if (false && !formattedBars && !hasOnchainAddress) {
        try {
          const intervalMap = { '1': '1m', '5': '5m', '15': '15m', '60': '1h', '240': '4h', '1D': '1d', '1W': '1w' };
          const sInterval = intervalMap[resolution] || '1h';
          const sym = (tickerSymbol || symbol || '').toUpperCase().split(':')[0];
          const sp = await spectreGetTokenChart(sym, sInterval);
          if (sp?.bars && Array.isArray(sp.bars) && sp.bars.length > 0) {
            formattedBars = sp.bars.map(bar => ({
              time: (bar.t || bar.time || 0) * (String(bar.t || bar.time).length > 11 ? 1 : 1000),
              open: parseFloat(bar.o ?? bar.open) || 0,
              high: parseFloat(bar.h ?? bar.high) || 0,
              low: parseFloat(bar.l ?? bar.low) || 0,
              close: parseFloat(bar.c ?? bar.close) || 0,
              volume: parseFloat(bar.v ?? bar.volume) || 0,
            }));
            source = 'spectre-ohlc';
            if (DEV) console.log(`[spectre] Received ${formattedBars.length} bars for ${sym}`);
          }
        } catch (err) {
          if (DEV) console.warn('[spectre-ohlc] failed:', err.message);
        }
      }

      // Server fallback (Codex + Binance + CoinGecko on server side).
      // Always call when nothing found yet — server can resolve cgId by symbol
      // via CoinGecko /search even when client has no idea what the token is.
      if (!formattedBars) {
        let resolvedCgId = cgId;
        if (!resolvedCgId) {
          try {
            const { SYMBOL_TO_COINGECKO_ID } = await import('@/constants/majorTokens');
            resolvedCgId = SYMBOL_TO_COINGECKO_ID[(symbol || '').toUpperCase()] || null;
          } catch (_) { /* ignore */ }
        }
        // Consume the pending early prefetch taken at the top of fetchBars -
        // the page fired this exact request seconds ago while the chart chunk
        // was still loading. Its window trails ours by those seconds, which
        // the 30s poll / SSE stream immediately papers over.
        let data = null;
        if (prefetchedHead) {
          data = await prefetchedHead;
          if (!data?.getBars?.length) data = null; // failed/empty prefetch -> refetch normally
        }
        if (!data) data = await getBars(symbol, resolution, from, to, networkId, resolvedCgId, binancePair);
        if (data?.getBars && data.getBars.length > 0) {
          formattedBars = data.getBars.map(bar => ({
            time: bar.t * 1000,
            open: parseFloat(bar.o) || 0,
            high: parseFloat(bar.h) || 0,
            low: parseFloat(bar.l) || 0,
            close: parseFloat(bar.c) || 0,
            volume: parseFloat(bar.v) || 0,
          }));
          source = data.source || 'codex';
          serverMeta = data.meta || null;
        }
      }

      if (isStale()) return; // Symbol changed during fetch - discard results

      if (formattedBars && formattedBars.length > 0) {
        if (DEV) console.log(`Received ${formattedBars.length} bars for ${symbol} (source: ${source})`);

        // Sparse-OHLC detection, REWORKED (2026-06-11). The old rule
        // (flatRatio > 0.4 -> silently swap to CoinGecko line) made Candles
        // mode IMPOSSIBLE for thin tokens: GT gap-fill fabricates flat bars
        // (>50% on PALM/SPECTRE), so the user clicked Candles and got a line.
        // New rule: respect the user's explicit OHLC choice (preferOhlc) and
        // use the server's realBarRatio (counts real-trade bars, immune to
        // gap-fill) when present. Auto-switch to CG line ONLY when the user
        // hasn't chosen candles AND the series is essentially priceless:
        // >80% flat AND fewer than 20 real bars. Sparse-but-real candles now
        // render honestly. Truly-empty series still fall to CG line below.
        const isPotentiallySparse = source !== 'binance' && source !== 'coingecko-chart';
        const flatRatio = isPotentiallySparse
          ? (serverMeta?.realBarRatio != null ? 1 - serverMeta.realBarRatio : computeFlatRatio(formattedBars))
          : 0;
        const realBarCount = Math.round(formattedBars.length * (1 - flatRatio));
        const wantsOhlc = !!(optionsRef.current?.preferOhlc);

        if (!wantsOhlc && flatRatio > 0.8 && realBarCount < 20) {
          let resolvedCgId = cgId;
          if (!resolvedCgId) {
            try {
              const { SYMBOL_TO_COINGECKO_ID } = await import('@/constants/majorTokens');
              resolvedCgId = SYMBOL_TO_COINGECKO_ID[upperSym] || null;
            } catch (_) { /* ignore */ }
          }
          // CG-line presets ARE their labelled range (zoom=1 shows the full
          // fetched window). '1Y' inflates periodHours to a 3y buffer for the
          // CANDLE sources' scroll-past; a CG line has no such buffer, so use
          // the caller's cgPeriodHours (365d for 1Y) or it'd render 3 years
          // under the "1Y" button.
          const cgBars = await fetchCoinGeckoLineBars(resolvedCgId, optionsRef.current?.cgPeriodHours || periodHours);
          if (!isStale() && cgBars && cgBars.length > 0) {
            if (DEV) console.log(`[sparse-ohlc] ${symbol}: flatRatio=${flatRatio.toFixed(2)} realBars=${realBarCount} → switched to CoinGecko line (${cgBars.length} pts)`);
            applyFreshBars(cgBars);
            setChartSource('coingecko-chart');
            setError(null);
            // Line data pages once: first left-wall hit upgrades to the full
            // CG history (fetchMoreHistory), then paging ends.
            setHasMoreHistory(!lineUpgradedRef.current);
            setLoading(false);
            return;
          }
        }

        if (isStale()) return;
        applyFreshBars(formattedBars);
        setChartSource(source);
        setError(null);
        setHasMoreHistory(true);
      } else {
        // cgId backfill via ticker (2026-06-12): Solana/DEX tokens whose
        // address isn't in GeckoTerminal/Codex (e.g. MOODENG) come back empty
        // here, yet ARE on CoinGecko. The identity resolver returns the
        // address WITHOUT a cgId, so the first /api/bars call classified the
        // token address-degen and never reached the cgOhlc tier. When we have
        // a ticker, resolve its cgId via search and retry getBars once — that
        // routes to cgOhlc (real OHLC candles). Empty-path only, so no cost
        // for tokens the address tiers already served.
        //
        // IDENTITY GUARD (same day): search is symbol-keyed and collides on
        // shared tickers — a $649 Base degen named "GT" exact-matches
        // GateToken, and charting the wrong asset's candles is WORSE than an
        // empty chart. Only trust the searched cgId after verifying the CG
        // coin's platform contracts contain THIS token's address. Tokens
        // without an address skip the retry entirely (no way to verify).
        if (!cgId && tickerSymbol && hasOnchainAddress) {
          try {
            const sr = await getSpectreSearch(tickerSymbol, 5);
            const coins = sr?.coins || [];
            const hit = coins.find(c => (c.symbol || '').toUpperCase() === tickerSymbol.toUpperCase());
            const tickerCgId = hit?.coingecko_id || hit?.id || null;
            let verified = false;
            const addrInfo = _addressFromSymbol(symbol, networkId);
            if (tickerCgId && addrInfo?.address) {
              const cgRes = await fetch(`/api/coingecko/coins/${encodeURIComponent(tickerCgId)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`);
              if (cgRes.ok) {
                const cgCoin = await cgRes.json().catch(() => null);
                const platformAddrs = Object.values(cgCoin?.platforms || {})
                  .filter(Boolean)
                  .map((a) => _normalizeAddress(String(a)));
                verified = platformAddrs.includes(addrInfo.address);
              }
            }
            if (tickerCgId && verified) {
              const retry = await getBars(symbol, resolution, from, to, networkId, tickerCgId, binancePair);
              if (!isStale() && retry?.getBars?.length > 0) {
                applyFreshBars(retry.getBars.map(bar => ({
                  time: bar.t * 1000,
                  open: parseFloat(bar.o) || 0,
                  high: parseFloat(bar.h) || 0,
                  low: parseFloat(bar.l) || 0,
                  close: parseFloat(bar.c) || 0,
                  volume: parseFloat(bar.v) || 0,
                })));
                setChartSource(retry.source || 'cg-ohlc');
                setError(null);
                setHasMoreHistory(retry.source !== 'coingecko-chart');
                setLoading(false);
                return;
              }
            }
          } catch (_) { /* fall through to the existing fallbacks below */ }
        }
        if (isStale()) return;
        // Address-form tokens: the /api/bars call above just auto-registered
        // the token in the Candle Store — backfill lands within ~1-2 min and
        // the regular poll picks it up. Message accordingly instead of a
        // dead-end "unavailable" (unify fix 2026-06-10).
        const unavailableMsg = hasOnchainAddress
          ? 'Building chart history for this token — candles arrive in a minute or two'
          : 'Chart data unavailable for this token';
        // Client-side fallback: Try Binance klines directly (using ticker, not address)
        try {
          const binanceData = hasBinanceSpot ? await getBinanceKlines(binanceSymbol, resolution, from, to) : null;
          if (isStale()) return;
          if (binanceData?.getBars && binanceData.getBars.length > 0) {
            const formattedBars = binanceData.getBars.map(bar => ({
              time: bar.t * 1000,
              open: parseFloat(bar.o) || 0,
              high: parseFloat(bar.h) || 0,
              low: parseFloat(bar.l) || 0,
              close: parseFloat(bar.c) || 0,
              volume: parseFloat(bar.v) || 0,
            }));
            applyFreshBars(formattedBars);
            setChartSource('binance');
            setError(null);
            setHasMoreHistory(true);
          } else {
            let resolvedCgId = cgId;
            if (!resolvedCgId) {
              try {
                const { SYMBOL_TO_COINGECKO_ID } = await import('@/constants/majorTokens');
                resolvedCgId = SYMBOL_TO_COINGECKO_ID[upperSym] || null;
              } catch (_) { /* ignore */ }
            }
            if (isStale()) return;
            if (resolvedCgId) {
              try {
                const days = Math.max(1, Math.ceil((optionsRef.current?.cgPeriodHours || periodHours) / 24));
                const cgRes = await fetch(`/api/coingecko/coins/${encodeURIComponent(resolvedCgId)}/market_chart?vs_currency=usd&days=${days}`);
                if (isStale()) return;
                if (cgRes.ok) {
                  const cgData = await cgRes.json();
                  if (isStale()) return;
                  if (cgData.prices?.length > 0) {
                    const cgBars = cgData.prices.map(([tsMs, price]) => ({
                      time: tsMs,
                      open: price, high: price, low: price, close: price,
                      volume: 0,
                    }));
                    applyFreshBars(cgBars);
                    setChartSource('coingecko-chart');
                    setError(null);
                    // Pages once: first left-wall hit upgrades to full history.
                    setHasMoreHistory(!lineUpgradedRef.current);
                  } else {
                    if (!isRefresh) setBars([]);
                    setError(unavailableMsg);
                  }
                } else {
                  if (!isRefresh) setBars([]);
                  setError(unavailableMsg);
                }
              } catch (_) {
                if (isStale()) return;
                if (!isRefresh) setBars([]);
                setError(unavailableMsg);
              }
            } else {
              if (!isRefresh) setBars([]);
              setError(unavailableMsg);
            }
          }
        } catch (fallbackErr) {
          if (isStale()) return;
          if (!isRefresh) setBars([]);
          setError('Chart data unavailable');
        }
      }
    } catch (err) {
      if (isStale()) return;
      console.error('Failed to fetch chart data:', err);
      // Preserve existing bars on a refresh failure so a transient network blip
      // doesn't blank the user's chart (and lose their lazy-loaded history).
      if (loadedKeyRef.current !== `${symbol}|${resolution}|${periodHours}`) {
        setError(err.message);
        setBars([]);
      }
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [symbol, resolution, networkId, periodHours, cgId, binancePair, requestIdentity]);

  // Apply a batch of older bars to state: reject non-contiguous era-cliff
  // batches (Binance history ends -> a 2015-2017 batch from a fallback source
  // would splice a time-gap the index-plotted canvas renders as a vertical
  // cliff; Sunny 2026-07-02), merge the rest. Returns how many bars were
  // actually OLDER than the pre-merge oldest (0 = overlap-only / rejected).
  // Tolerance is one scroll-back window (see below): thin DEX tokens go days
  // without trades, so a hole inside the window we asked for is normal data,
  // while an era cliff lands outside it and is still rejected.
  const applyOlderBatch = useCallback((batch, windowSec, batchMeta) => {
    const isStale = () => activeRequestRef.current !== requestIdentity || loadedRequestRef.current !== requestIdentity;
    if (isStale()) return { added: 0, rejected: true, reason: 'stale' };
    const cur = barsRef.current;
    if (!batch.length || !cur.length) return { added: 0, rejected: false };
    // TIER-CONTRACT SEAM GATE (2026-08-26, the M87 "битые бары" report).
    // Deep scroll-back walks past the DEX pool's genesis and the cascade falls
    // to CoinGecko's aggregate, which prices the same token on a different
    // basis AND carries no volume - measured on M87: geckoterminal 3.53e-6 met
    // cg-ohlc 2.80e-8 at the seam (26x) and the close-only era rendered as a
    // flat dashed shelf under the real candles. Refuse the splice on the
    // server's own contract (meta.volumeAvailable === false), never on a price
    // ratio: a young token legitimately moves 25x between adjacent 4h bars, and
    // a ratio gate would truncate real history - the false-positive mode that
    // kept this guard unbuilt (rz-chart-audit step 10).
    if (seamContractBroken({ batchBars: batch, batchMeta, heldBars: cur })) {
      if (DEV) console.warn(`[chart-seam] refused a close-only batch under a tape with volume (${batch.length} bars)`);
      // NOT a wall: says the batch is unusable, not that history ended. Steps
      // 7-8 - only an empty or overlap-only answer may latch hasMoreHistory.
      return { added: 0, rejected: true, reason: 'close-only' };
    }
    const oldestMs = cur[0].time;
    const newestNew = Math.max(...batch.map(b => b.time));
    const intervalMs = medianIntervalMs(cur);
    // Resolution-contamination guard: a batch fetched for a DIFFERENT
    // resolution (a timeframe-switch race) must never be spliced into the
    // index-plotted array.
    //
    // It is anchored to the RESOLUTION, not to the neighbouring bars' density.
    // The old rule compared the batch's median interval against the current
    // buffer's and rejected anything beyond 3x - which is meaningless on a raw
    // (non-gap-filled) tier, where the median measures how often the token
    // traded, not what resolution the bars are. Measured on prod 2026-07-27:
    // buffer median 115 min (deep sparse region) vs batch median 30 min (a
    // denser stretch) = 3.8x -> 41 perfectly good 5m bars rejected, and since
    // the user path reads "0 added" as genesis, the wall latched at Jun 23
    // while the API still served June and earlier.
    //
    // What identifies a foreign resolution is GRID ALIGNMENT, not cadence.
    // Cadence cannot work here at all: on a sparse tier the median interval is
    // a local sample of how busy the token was, and two windows of the SAME 5m
    // series routinely differ by 20x (measured on prod: buffer's oldest 20 bars
    // 5 min apart, the next window's oldest 20 bars 105 min apart -> a
    // cadence-ratio rule rejected 83 genuine 5m bars and history stalled at
    // Apr 9 while the API still served March). Alignment is immune to that:
    // every bar of a 5m series lands on a 5m bucket and only ~1/12 of them
    // happen to be hour-aligned (measured: 9.6%), while a 1H series is 100%
    // hour-aligned. So a batch is foreign when it is finer than one bucket of
    // this resolution, or when it sits ENTIRELY on a much coarser grid that
    // the current series does not share.
    const resMs = (_RES_SECONDS[String(resolution || '60').toUpperCase()] || 300) * 1000;
    let minIv = Infinity;
    for (let i = 1; i < batch.length; i++) {
      const d = batch[i].time - batch[i - 1].time;
      if (d > 0 && d < minIv) minIv = d;
    }
    const finerResolution = minIv !== Infinity && minIv < resMs * 0.9;
    const coarseGrid = resMs * 12;
    const alignedShare = (rows) => {
      if (!rows.length) return 0;
      let n = 0;
      for (const b of rows) if (b.time % coarseGrid === 0) n++;
      return n / rows.length;
    };
    const coarserResolution = batch.length >= 8 &&
      alignedShare(batch) >= 0.98 && alignedShare(cur) < 0.5;
    if (finerResolution || coarserResolution) {
      // Rejected, NOT a wall - it says nothing about whether older history
      // exists, so the caller must not latch hasMoreHistory over it.
      return { added: 0, rejected: true };
    }
    // Era-cliff guard. The tolerance is ONE SCROLL-BACK WINDOW, not a fixed 50
    // intervals: this batch was requested with `to = oldest - 1`, so every bar
    // it can contain already lies inside [to - stride, to]. A gap inside that
    // span means the source simply had no trades in the newest part of the
    // window - which is the normal state of a thin DEX token - while an actual
    // era cliff (a fallback source answering with 2017 data) lands OUTSIDE it.
    //
    // The old fixed 50x rule killed history loading outright on SPECTRE:
    // measured 2026-07-27, the head buffer's oldest bar was Jul 24 02:50 and
    // GeckoTerminal's next window ended Jul 23 22:20 - a 270-minute hole
    // against a 250-minute tolerance. 907 perfectly good bars were discarded
    // AND hasMoreHistory latched false, so the chart declared "no more
    // history" on the very first scroll-back and never fetched again.
    //
    // The tolerance follows the window the batch was ACTUALLY fetched with, not
    // a fixed stride (2026-08-26). Deep pages span up to 3 years; judging one
    // against the 80h stride would read LEO's ordinary ~6-day quiet stretches
    // as a wrong era, discard 1500 good bars AND latch the wall - the exact
    // failure this guard already caused three times with a fixed tolerance.
    const fetchedWindowSec = windowSec || (SCROLLBACK_HOURS[resolution] || 1000) * 3600;
    const maxGapMs = eraCliffToleranceMs(intervalMs, fetchedWindowSec);
    if (intervalMs && (oldestMs - newestNew) > maxGapMs) {
      setHasMoreHistory(false); // wrong era -> stop, don't splice a cliff
      return { added: 0, rejected: true };
    }
    const added = batch.filter(b => b.time < oldestMs).length;
    if (added > 0) setBars(prev => isStale() ? prev : mergeOlderBars(prev, batch));
    return { added, rejected: false };
  }, [resolution, requestIdentity]);

  // Fetch MORE historical data (older than current oldest candle).
  // User-driven: the chart calls this when panning nears the data wall. The
  // background extender usually has the window already buffered or in flight,
  // so this path mostly rides an existing round instead of fetching cold.
  const fetchMoreHistory = useCallback(async () => {
    const isStale = () => activeRequestRef.current !== requestIdentity || loadedRequestRef.current !== requestIdentity;
    if (isStale()) return false;
    if (!symbol || loadingMore || bars.length === 0) return false;

    // CG line data has no OHLCV paging - upgrade ONCE to the token's full
    // CoinGecko history (daily granularity, merges in front of the hourly
    // head; on a line plot the density change is invisible), then stop.
    if (chartSource === 'coingecko-chart') {
      if (lineUpgradedRef.current || !cgId) {
        setHasMoreHistory(false);
        return false;
      }
      lineUpgradedRef.current = true;
      setLoadingMore(true);
      try {
        const full = await fetchCoinGeckoLineBars(cgId, 'max');
        if (isStale()) return false;
        // CoinGecko's full history is not a windowed page - size the guard
        // from the span it actually carries so the tolerance can't reject it.
        const cgSpanSec = full?.length > 1
          ? Math.ceil((full[full.length - 1].time - full[0].time) / 1000)
          : 0;
        const added = full?.length ? applyOlderBatch(full, cgSpanSec).added : 0;
        setHasMoreHistory(false); // full history loaded - nothing further to page
        return added > 0;
      } finally {
        if (!isStale()) setLoadingMore(false);
      }
    }

    if (!hasMoreHistory) return false;
    // Real scroll intent - unlocks deep background prefetch for Codex-billed
    // tokens (they only prewarm one speculative window before this).
    scrollIntentRef.current = true;

    // The background extender already has a round in flight for this
    // boundary - await it instead of duplicating the window fetch.
    if (inflightOlderRef.current) {
      try { await inflightOlderRef.current; } catch (_) { /* extender handles */ }
      return !isStale();
    }

    try {
      setLoadingMore(true);
      const oldestMs = bars[0].time;
      if (oldestMs <= BARS_EPOCH_MS) {
        setHasMoreHistory(false);
        return false;
      }
      const ctx = { symbol, resolution, networkId, cgId, binancePair, tickerSymbol };
      // Explicit scroll intent is the strongest signal we get - give it the
      // deep page rather than a 3-day stride (2026-08-26 measurement: 1500 bars
      // / 283 days vs 9 bars / 2 days, same anchor, comparable latency).
      const round = fetchContiguousOlderRound(ctx, oldestMs, 1, { deep: true });
      inflightOlderRef.current = round;
      let res;
      try {
        res = await round;
      } finally {
        if (inflightOlderRef.current === round) inflightOlderRef.current = null;
      }
      if (isStale()) return false;
      if (DEV) console.log(`[chart-more] ${symbol} ${resolution} user-fetch${res.deep ? ' deep' : ''} +${res.bars.length} bars oldest=${res.bars.length ? new Date(res.bars[0].time).toISOString().slice(0, 10) : '-'}`);
      if (!res.bars.length) {
        // An empty round is only evidence of genesis when the request actually
        // SUCCEEDED and twice in a row. A single timeout / rate-limit / cold
        // serverless miss used to end the token's history for the whole
        // session - the chart would sit at an arbitrary date (Jun 26, Apr 9,
        // Jun 23 across sessions - a moving wall, i.e. a transient, not a data
        // boundary) and never request again. Mirrors the extender's
        // emptyStreak>=2 rule.
        if (res.failed) return false;
        userEmptyStreakRef.current += 1;
        if (userEmptyStreakRef.current >= 2) setHasMoreHistory(false);
        return false;
      }
      userEmptyStreakRef.current = 0;
      const { added, rejected } = applyOlderBatch(res.bars, res.windowSec, res.meta);
      // Overlap-only (the window we asked for held nothing older) IS the wall.
      // A REJECTED batch is not: it says the batch was unusable, not that the
      // token's history ended - latching there froze prod at Jun 23 with June
      // data still on the wire.
      if (added === 0 && !rejected) setHasMoreHistory(false);
      return added > 0;
    } catch (err) {
      if (isStale()) return false;
      console.error('Failed to fetch more history:', err);
      // Don't permanently disable - API might have temporary issues
      return false;
    } finally {
      if (!isStale()) setLoadingMore(false);
    }
  }, [symbol, resolution, networkId, bars, loadingMore, hasMoreHistory, chartSource, cgId, binancePair, tickerSymbol, applyOlderBatch, requestIdentity]);

  // ── Background buffer-extend ─────────────────────────────────────────────
  // After the first bars land, prefetch CONTIGUOUS older windows in the
  // background so panning into history hits LOCAL data instead of a network
  // round-trip per screen (ported from the trading app's scroll-back work,
  // adapted to research's multi-source pipeline). Round shape: first round
  // fetches a single window (the one the user would hit first - lands fast),
  // later rounds fan out. Cost discipline: cheap tiers (Binance/GT/cg-ohlc)
  // extend immediately; Codex-billed tokens prewarm ONE window and only go
  // deeper after real scroll intent - never speculatively deep-bill Codex.
  useEffect(() => {
    const key = `${symbol}|${resolution}|${periodHours}`;
    // Reassert on every pass: a key change kills the previous loop.
    aliveKeyRef.current = key;
    if (loading || !symbol) return;
    if (!chartSource || chartSource === 'coingecko-chart') return;
    if (!hasMoreHistory) return;
    // CRITICAL: only start once THIS key's head data has actually landed.
    // On a timeframe switch this effect fires before fetchBars flips
    // `loading` (stale render values pass every guard above), so the loop
    // anchored its windows on the PREVIOUS resolution's bars - observed live
    // as "BTC 5 iter=0 oldest=2025-10-19" (the 1H buffer's oldest) fetching
    // months-old 5m windows; when the real 5m head landed, the next batch
    // sat months behind it, the cliff guard rejected it and latched
    // hasMoreHistory=false - a dead scroll-back wall (Gleb 2026-07-03).
    if (loadedKeyRef.current !== key || loadedRequestRef.current !== requestIdentity) return;
    // A loop for this exact key already ran/is running (the 30s poll flips
    // `loading`, re-firing this effect) - don't spawn a duplicate.
    if (startedExtendRef.current === requestIdentity) return;
    startedExtendRef.current = requestIdentity;

    const alive = () => aliveKeyRef.current === key && activeRequestRef.current === requestIdentity;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const ctx = { symbol, resolution, networkId, cgId, binancePair, tickerSymbol };

    (async () => {
      // 150ms, not 700: on a timeframe switch the user's FIRST gesture is
      // usually an immediate scroll-back, and every ms here is felt at the
      // wall. Rounds are network-bound anyway - paint isn't blocked.
      await sleep(150);
      let iter = 0;
      let emptyStreak = 0;
      let billedWindows = 0;
      // Set when a round detects the token's genesis inside its window -
      // keeps every later round at batchN=1 so we confirm genesis with ONE
      // probe instead of fanning out pre-genesis empties.
      let forceSingle = false;
      // Local boundary cursor: barsRef mirrors state at render time, so right
      // after a merge (setBars scheduled, not yet flushed) it briefly lags.
      // Without the cursor, the next round would recompute the SAME window,
      // dedupe to nothing and exit early. min() with state covers the user
      // path advancing the boundary past our cursor.
      let cursorMs = 0;
      while (alive() && iter < 14) {
        if (!hasMoreRef.current) return;
        if (document.hidden || !isAppActive()) { await sleep(3000); continue; }
        const cur = barsRef.current;
        if (!cur.length) { await sleep(1000); continue; }
        if (cur.length >= maxBufferFor(resolution)) return;
        const oldestMs = cursorMs > 0 ? Math.min(cursorMs, cur[0].time) : cur[0].time;
        if (oldestMs <= BARS_EPOCH_MS) { setHasMoreHistory(false); return; }
        const cheap = CHEAP_BAR_SOURCES.has(sourceRef.current);
        if (!cheap && !scrollIntentRef.current && (iter >= 1 || billedWindows >= 1)) {
          // Billed source, no user intent yet - idle until they scroll back.
          await sleep(1500);
          continue;
        }
        if (cheap && !scrollIntentRef.current && cur.length >= SPEC_BUFFER_CHEAP) {
          // Free source but no scroll intent yet: ~4000 bars is 4+ screens of
          // local panning (renderer floors at 1px, ~900 bars/screen). The old
          // uncapped speculative loop pulled the FULL 20k-bar buffer on every
          // RZ boot (~20 direct Binance chunk requests, ~1.4MB) for history
          // most sessions never pan to. Deep buffer still fills - after the
          // first real user-driven history fetch flips scrollIntentRef.
          await sleep(1500);
          continue;
        }
        if (inflightOlderRef.current) { await sleep(300); continue; } // user path active
        // First round: cheap sources grab 2 windows straight away (free, and
        // 2000 daily bars ~= 5.5 years kills the 1Y wall in one round-trip);
        // billed sources stay at 1 speculative window.
        const batchN = forceSingle ? 1 : iter === 0 ? (cheap ? 2 : 1) : (cheap ? 3 : 2);
        // Deep pages only AFTER real scroll intent. The speculative prewarm
        // that runs on every token open stays on the narrow stride - a 1500-bar
        // Codex page is worth paying for when the user is actually walking back
        // through history, not on the off chance they will.
        const deepRound = scrollIntentRef.current;
        const roundT0 = Date.now();
        const round = fetchContiguousOlderRound(ctx, oldestMs, batchN, { deep: deepRound });
        inflightOlderRef.current = round;
        let res;
        try {
          res = await round;
        } catch (_) {
          res = { bars: [], genesis: false, codexServed: 0 };
        } finally {
          if (inflightOlderRef.current === round) inflightOlderRef.current = null;
        }
        if (!alive()) return;
        if (DEV) {
          const oldestStr = res.bars.length ? new Date(res.bars[0].time).toISOString().slice(0, 10) : '-';
          console.log(`[chart-extend] ${symbol} ${resolution} iter=${iter} n=${res.deep ? 'deep' : batchN} +${res.bars.length} bars ${Date.now() - roundT0}ms oldest=${oldestStr}${res.nearGenesis ? ' NEAR-GENESIS' : ''}${res.genesis ? ' EMPTY' : ''}`);
        }
        billedWindows += res.codexServed || 0;
        if (!res.bars.length) {
          // A FAILED round is not evidence of genesis - retry without counting
          // it, so a rate-limit blip can't end the token's history.
          if (!res.failed) emptyStreak++;
          if (emptyStreak >= 2) { setHasMoreHistory(false); return; } // genesis confirmed
          forceSingle = true; // the retry probes with ONE window, not a fan-out
          await sleep(res.failed ? 2500 : 1200); // transient - back off, try again
          iter++;
          continue;
        } else {
          emptyStreak = 0;
          if (res.nearGenesis) forceSingle = true;
          const { added, rejected, reason } = applyOlderBatch(res.bars, res.windowSec, res.meta);
          if (added === 0 && !rejected) return; // overlap - applyOlderBatch handled hasMore
          if (added === 0 && reason === 'close-only') {
            // The tier below this boundary cannot describe the same instrument
            // (close-only under a real OHLCV tape). Probing deeper only finds
            // more of it, so end the background walk. hasMoreHistory is left
            // alone deliberately: a user drag may still retry, which self-heals
            // if the richer tier was merely down.
            return;
          }
          if (added === 0) {
            // Unusable batch (foreign cadence / era cliff). Don't stop the
            // loop and don't refetch the same window forever - step the cursor
            // past it and probe one window deeper.
            cursorMs = res.bars[0].time;
            forceSingle = true;
            await sleep(600);
            iter++;
            continue;
          }
          cursorMs = res.bars[0].time; // advance past what this round covered
          // 280ms between cheap rounds: each merge re-renders the chart and
          // recomputes indicator memos over the full buffer - at 120ms the
          // burst overlapped user drags enough to feel like slow motion.
          await sleep(cheap ? 280 : 600);
        }
        iter++;
      }
    })();
  }, [loading, chartSource, hasMoreHistory, symbol, resolution, periodHours, networkId, cgId, binancePair, tickerSymbol, applyOlderBatch, requestIdentity]);

  // Unmount: kill any running extender loop.
  useEffect(() => () => { aliveKeyRef.current = null; }, []);

  // ── L5-charts-B (2026-06-03): SSE bar-update fan-out ──────────────────
  // One Hetzner stream per token → many viewers. Replaces per-viewer polling
  // for the live-bar update path. When an SSE tick arrives:
  //   - if same bucket → extend close/high/low on the last bar
  //   - if new bucket → append a fresh bar seeded from the tick price
  // Polling stays as a closed-bar recovery mechanism (gap detection, SSE
  // outages, bar-boundary catchup), but at LONG cadences.
  //
  // Routing:
  //   - DEX tokens with (address, networkId) → SSE (Codex onPricesUpdated)
  //   - CEX-only tickers (BTC, ETH via Binance) → polling only; SSE relay
  //     does not carry Binance ticker price streams. Polling intervals
  //     stay reasonable for those.
  //   - Stocks / line-only (CoinGecko) charts → never SSE.
  //
  // Failure modes: if EventSource fails to connect, codexStreamApi's auto-
  // reconnect + visibility-pause handle it. The user's polling interval
  // still picks up the closed bar within the resolution cadence.
  useEffect(() => {
    if (_sseDisabled()) return;
    if (!symbol) return;
    if (chartSource === 'coingecko-chart') return; // line-only data has no SSE source
    const addrCtx = _addressFromSymbol(symbol, networkId);
    if (!addrCtx) return; // CEX ticker — falls through to polling
    const tokenKey = `${addrCtx.address}:${addrCtx.networkId}`;
    const resSec = _RES_SECONDS[String(resolution || '60').toUpperCase()] || 3600;

    const unsub = streamSubscribe([tokenKey], (data) => {
      try {
        if (activeRequestRef.current !== requestIdentity || loadedRequestRef.current !== requestIdentity) return;
        const price = parseFloat(data.priceUsd);
        if (!Number.isFinite(price) || price <= 0) return;

        setBars(prev => {
          if (activeRequestRef.current !== requestIdentity || loadedRequestRef.current !== requestIdentity) return prev;
          if (!prev || prev.length === 0) return prev;

          // Outlier guard: a 10x in one tick is not real. Codex onPricesUpdated
          // occasionally emits a low-liq swap / wrong-pair sample. Without this
          // a single bad tick destroys the chart axis.
          const lastBar = prev[prev.length - 1];
          const lastClose = lastBar.close > 0 ? lastBar.close : null;
          if (lastClose) {
            const ratio = price > lastClose ? price / lastClose : lastClose / price;
            if (ratio > 10) return prev;
          }

          // Bars are timestamped in ms. Compute the current bucket boundary in ms.
          const nowSec = Math.floor(Date.now() / 1000);
          const currentBucketMs = Math.floor(nowSec / resSec) * resSec * 1000;

          if (currentBucketMs === lastBar.time) {
            // Same bucket — extend high/low + update close in-place. Returning
            // a new bars array keeps React reference-equality semantics so the
            // chart re-renders.
            const updated = prev.slice();
            updated[updated.length - 1] = {
              ...lastBar,
              high: Math.max(lastBar.high, price),
              low: Math.min(lastBar.low, price),
              close: price,
            };
            return updated;
          }
          if (currentBucketMs > lastBar.time) {
            // New bucket — append a fresh bar. Volume seeded to 0; polling
            // catchup fills in actual volume when the bar closes.
            return [...prev, {
              time: currentBucketMs,
              open: price,
              high: price,
              low: price,
              close: price,
              volume: 0,
            }];
          }
          return prev; // stale tick — ignore
        });
      } catch (_) { /* per-listener safety */ }
    });
    return () => { try { unsub(); } catch (_) { /* ok */ } };
  }, [symbol, networkId, resolution, chartSource, requestIdentity]);

  useEffect(() => {
    fetchBars();
    // 2026-05-15 cost audit: resolution-aware polling. Mirrors the pattern in
    // TradingViewAdvanced.jsx pollIntervalForResolution(). A 1D candle can't
    // close inside the same day, so polling it every 30s burns Codex queries
    // for nothing — the live price line + in-progress candle redraw still
    // come from the WebSocket/SSE stream, not from /api/bars. Cadence by
    // resolution: 1m=15s, 5m=30s, 15m=45s, 1H=60s, 4H=2min, 1D=5min, 1W=10min.
    //
    // L5-charts-B (2026-06-03): SSE now drives the live-tick path for DEX
    // tokens. Polling cadence DOUBLED across the board — its only job is
    // closed-bar recovery and gap catchup. A 30s lag on a 1m bar close is
    // invisible because SSE has already interpolated the in-progress bar
    // for the user. CEX tickers (no SSE coverage) still get reasonable
    // polling via the same cadence; their getBars hits are bounded by the
    // server cache.
    const resSec = (() => {
      const r = String(resolution || '60').toUpperCase();
      if (r === '1S' || r === 'S') return 1;
      if (r === '1D' || r === 'D') return 86400;
      if (r === '1W' || r === 'W') return 604800;
      if (r === 'M' || r === '1M') return 2592000;
      const n = parseInt(r, 10);
      return isFinite(n) && n > 0 ? n * 60 : 3600;
    })();
    // Detect SSE availability: if the symbol resolves to an on-chain address,
    // we're getting live ticks via codexStreamApi — relax the poll dramatically.
    // CEX-only tickers keep the old cadence.
    const hasSseStream = !_sseDisabled() && !!_addressFromSymbol(symbol, networkId);
    const pollMs = hasSseStream
      ? (resSec <= 60 ? 30_000          // 1m → 30s (was 15s) — SSE drives ticks
        : resSec <= 300 ? 60_000        // 5m → 60s (was 30s)
        : resSec <= 900 ? 120_000       // 15m → 2min (was 45s)
        : resSec <= 3600 ? 180_000      // 1H → 3min (was 60s)
        : resSec <= 14400 ? 300_000     // 4H → 5min (was 2min)
        : resSec <= 86400 ? 600_000     // 1D → 10min (was 5min)
        : 1200_000)                      // 1W+ → 20min (was 10min)
      : (resSec <= 60 ? 15_000
        : resSec <= 300 ? 30_000
        : resSec <= 900 ? 45_000
        : resSec <= 3600 ? 60_000
        : resSec <= 14400 ? 120_000
        : resSec <= 86400 ? 300_000
        : 600_000);
    const interval = setInterval(() => {
      // Idle/visibility guard. Stops getBars polling on forgotten tabs.
      if (document.hidden || !isAppActive()) return
      fetchBars()
    }, pollMs);
    return () => clearInterval(interval);
  }, [fetchBars, resolution, symbol, networkId]);

  const lineOnly = chartSource === 'coingecko-chart';
  return { bars, loading, loadingMore, error, hasMoreHistory, refresh: fetchBars, fetchMoreHistory, athPrice, chartSource, lineOnly };
}
