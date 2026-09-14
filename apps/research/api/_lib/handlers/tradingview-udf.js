/**
 * Vercel Serverless Function - TradingView UDF Protocol
 * Handles /api/tradingview/udf/config, time, symbols, search, history
 *
 * In dev, the Express server handles these. In prod (Vercel), this function takes over.
 * Crypto bars: Codex GraphQL (primary) + Binance klines (fallback)
 * Stock bars: Yahoo Finance
 */

import { createRequire } from 'module';
import { getJsonWithTTL, setJsonWithTTL } from '../kv.js';
import { rateLimit } from '../ratelimit.js';
import { lookupBinancePair, fetchBinanceKlines } from '../binance-bars.js';
import { fetchHetznerCandles } from '../hetzner-bars.js';
import { fetchGeckoTerminalBars, clampOutlierBars } from '../geckoterminal-bars.js';
import { fetchCgOhlcBars, stitchAdjacentOpens } from '../cg-ohlc-bars.js';
import { getBudgetState } from '../codex-budget.js';
import { staleMirrorKey, STALE_TTL_SEC, sanitizeBars, repairScaledPrices } from '../bars-router.js';
const _require = createRequire(import.meta.url);
let codexMetricsKv = null;
try { codexMetricsKv = _require('../../../../../packages/server/lib/codex-metrics-kv'); } catch {}

// ── KV bucket-cache for Codex getTokenBars ─────────────────────────────────
// 2026-06-02 (revised 16:50 UTC) cost defense: handleHistory was the LAST
// uncached Codex path.
// /api/bars (sibling) already had bucket caching. /api/tradingview/udf/history
// (this file) did NOT — every TradingView chart open fired Codex direct.
// Wrap the Codex-call portion of each tier in the SAME bucket-key shape as
// bars.js so both endpoints share one warm cache. Binance fallback stays
// uncached (free + Vercel-IP-blocked path with its own fallback chain).
const _udfBarsInflight = new Map();
const _BARS_BUCKET_SEC = { '1S': 5, '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, '240': 14400, '720': 43200, '1D': 86400, 'D': 86400, '1W': 604800, 'W': 604800, '7D': 604800 };

const CODEX_API_KEY = process.env.CODEX_API_KEY;
const CODEX_BASE_URL = 'https://graph.codex.io/graphql';
// Codex key is origin-restricted; server-to-server calls must present the allowed origin.
const CODEX_ORIGIN = process.env.CODEX_ORIGIN || 'https://app.spectreai.io';
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
const COINGECKO_BASE_URL = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

// ── Token registry (subset for symbol resolution) ──
const TOKEN_REGISTRY = {
  'BTC':    { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', networkId: 1,          binanceSymbol: 'BTCUSDT',    coingeckoId: 'bitcoin' },
  'ETH':    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', networkId: 1,          binanceSymbol: 'ETHUSDT',    coingeckoId: 'ethereum' },
  'SOL':    { address: 'So11111111111111111111111111111111111111112',  networkId: 1399811149, binanceSymbol: 'SOLUSDT',    coingeckoId: 'solana' },
  'BNB':    { address: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52', networkId: 1,          binanceSymbol: 'BNBUSDT',    coingeckoId: 'binancecoin' },
  'DOGE':   { address: '0x4206931337dc273a630d328dA6441786BfaD668f', networkId: 1,          binanceSymbol: 'DOGEUSDT',   coingeckoId: 'dogecoin' },
  'XRP':    { address: null, networkId: null, binanceSymbol: 'XRPUSDT',    coingeckoId: 'ripple' },
  'ADA':    { address: null, networkId: null, binanceSymbol: 'ADAUSDT',    coingeckoId: 'cardano' },
  'AVAX':   { address: null, networkId: null, binanceSymbol: 'AVAXUSDT',   coingeckoId: 'avalanche-2' },
  'DOT':    { address: null, networkId: null, binanceSymbol: 'DOTUSDT',    coingeckoId: 'polkadot' },
  'NEAR':   { address: null, networkId: null, binanceSymbol: 'NEARUSDT',   coingeckoId: 'near' },
  'APT':    { address: null, networkId: null, binanceSymbol: 'APTUSDT',    coingeckoId: 'aptos' },
  'SUI':    { address: null, networkId: null, binanceSymbol: 'SUIUSDT',    coingeckoId: 'sui' },
  'INJ':    { address: null, networkId: null, binanceSymbol: 'INJUSDT',    coingeckoId: 'injective-protocol' },
  'FET':    { address: null, networkId: null, binanceSymbol: 'FETUSDT',    coingeckoId: 'fetch-ai' },
  'RENDER': { address: null, networkId: null, binanceSymbol: 'RENDERUSDT', coingeckoId: 'render-token' },
  'LTC':    { address: null, networkId: null, binanceSymbol: 'LTCUSDT',    coingeckoId: 'litecoin' },
  'ATOM':   { address: null, networkId: null, binanceSymbol: 'ATOMUSDT',   coingeckoId: 'cosmos' },
  'TIA':    { address: null, networkId: null, binanceSymbol: 'TIAUSDT',    coingeckoId: 'celestia' },
  'SEI':    { address: null, networkId: null, binanceSymbol: 'SEIUSDT',    coingeckoId: 'sei-network' },
  'TAO':    { address: null, networkId: null, binanceSymbol: 'TAOUSDT',    coingeckoId: 'bittensor' },
  'PEPE':   { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', networkId: 1,          binanceSymbol: 'PEPEUSDT',   coingeckoId: 'pepe' },
  'SHIB':   { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', networkId: 1,          binanceSymbol: 'SHIBUSDT',   coingeckoId: 'shiba-inu' },
  'FLOKI':  { address: '0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E', networkId: 1,          binanceSymbol: 'FLOKIUSDT',  coingeckoId: 'floki' },
  'UNI':    { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', networkId: 1,          binanceSymbol: 'UNIUSDT',    coingeckoId: 'uniswap' },
  'AAVE':   { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', networkId: 1,          binanceSymbol: 'AAVEUSDT',   coingeckoId: 'aave' },
  'LINK':   { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', networkId: 1,          binanceSymbol: 'LINKUSDT',   coingeckoId: 'chainlink' },
  'GRT':    { address: '0xc944E90C64B2c07662A292be6244BDf05Cda44a7', networkId: 1,          binanceSymbol: 'GRTUSDT',    coingeckoId: 'the-graph' },
  'MKR':    { address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', networkId: 1,          binanceSymbol: 'MKRUSDT',    coingeckoId: 'maker' },
  'CRV':    { address: '0xD533a949740bb3306d119CC777fa900bA034cd52', networkId: 1,          binanceSymbol: 'CRVUSDT',    coingeckoId: 'curve-dao-token' },
  'ARB':    { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', networkId: 42161,      binanceSymbol: 'ARBUSDT',    coingeckoId: 'arbitrum' },
  'OP':     { address: '0x4200000000000000000000000000000000000042', networkId: 10,          binanceSymbol: 'OPUSDT',     coingeckoId: 'optimism' },
  'MATIC':  { address: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', networkId: 1,          binanceSymbol: 'MATICUSDT',  coingeckoId: 'matic-network' },
  'SPECTRE':{ address: '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6', networkId: 1,          binanceSymbol: null,         coingeckoId: 'spectre-ai' },
  'ONDO':   { address: null, networkId: null, binanceSymbol: 'ONDOUSDT',   coingeckoId: 'ondo-finance' },
  'PENDLE': { address: '0x808507121B80c02388fAd14726482e061B8da827', networkId: 1,          binanceSymbol: 'PENDLEUSDT', coingeckoId: 'pendle' },
  'WIF':    { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', networkId: 1399811149, binanceSymbol: 'WIFUSDT', coingeckoId: 'dogwifhat' },
  'BONK':   { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', networkId: 1399811149, binanceSymbol: 'BONKUSDT', coingeckoId: 'bonk' },
  'JUP':    { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  networkId: 1399811149, binanceSymbol: 'JUPUSDT',  coingeckoId: 'jupiter-exchange-solana' },
  'PYTH':   { address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', networkId: 1399811149, binanceSymbol: 'PYTHUSDT', coingeckoId: 'pyth-network' },
  'JTO':    { address: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',  networkId: 1399811149, binanceSymbol: 'JTOUSDT',  coingeckoId: 'jito-governance-token' },
  'TRX':    { address: null, networkId: null, binanceSymbol: 'TRXUSDT',    coingeckoId: 'tron' },
  'FIL':    { address: null, networkId: null, binanceSymbol: 'FILUSDT',    coingeckoId: 'filecoin' },
  'LDO':    { address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', networkId: 1,          binanceSymbol: 'LDOUSDT',    coingeckoId: 'lido-dao' },
  'SUSHI':  { address: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2', networkId: 1,          binanceSymbol: 'SUSHIUSDT',  coingeckoId: 'sushi' },
};

// ── Stock symbols (for isStock detection + search) ──
const POPULAR_STOCK_SYMBOLS = [
  'SPY','QQQ','IWM','DIA','VOO','ARKK','XLF','XLK','XLE','TLT',
  'GC=F','SI=F','CL=F','NG=F','HG=F','PL=F','PA=F',
  'GLD','SLV','IAU','SGOL','PPLT','PALL',
  'USO','BNO','UNG','AMLP',
  'DBA','CORN','WEAT','SOYB','CANE','COW','JO','NIB','TAGS',
  'CPER','LIT','URA','REMX','PICK','SLX',
  'DJP','GSG','PDBC','COM','COMT','FTGC','BCI',
  'NEM','GOLD','AEM','WPM','RGLD','FNV','FCX','VALE','BHP','RIO','SCCO','TECK','AA',
  'AAPL','MSFT','GOOGL','GOOG','AMZN','NVDA','TSLA','META',
  'AMD','INTC','CRM','ADBE','ORCL','NFLX','AVGO','MU','QCOM','TXN',
  'ARM','SMCI','CRWD','PANW','NOW','NET','SNOW','DDOG','ZS','TWLO',
  'PLTR','GME','AMC','RIVN','LCID','SOFI','HOOD','MSTR','IONQ',
  'SPCX', // SpaceX, IPO'd 2026-06-12 — without this the chart routed SPCX through CRYPTO resolution
  'UBER','LYFT','ABNB','SHOP','SNAP','PINS','ROKU','RBLX','DKNG','SPOT','ZM',
  'JPM','V','MA','BAC','GS','MS','C','WFC','COIN','PYPL','SQ','BRK.B',
  'JNJ','UNH','PFE','ABBV','MRK','LLY',
  'WMT','HD','PG','KO','PEP','COST','MCD','NKE','SBUX','TGT','LOW',
  'DIS','VZ','T',
  'XOM','CVX','COP',
  'BA','CAT','GE','UPS','HON',
  'IBM','INTU','TSM','ASML','AXP','BLK','TMO','NVO','LMT','RTX','DE','F','GM','CMCSA',
  '^GSPC','^DJI','^IXIC','^RUT','^VIX',
];
const STOCK_SET = new Set(POPULAR_STOCK_SYMBOLS);

// ── Helpers ──

function _extractOp(query) {
  if (!query) return 'unknown';
  const m = query.match(/^\s*(?:query|mutation|subscription)\s+(\w+)/);
  return m ? m[1] : 'unknown';
}

async function executeCodexQuery(query, variables = {}) {
  const startTime = Date.now();
  const operation = _extractOp(query);
  let errored = false;
  try {
    const response = await fetch(CODEX_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': CODEX_API_KEY, 'Origin': CODEX_ORIGIN },
      body: JSON.stringify({ query, variables }),
      // Bound the tier: this fetch was the only unbounded leg of the serial
      // bars cascade — a hung Codex call alone could blow the TV client's 12s
      // abort and blank the pane (2026-06-10 RZ war). 8s matches bars.js.
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) { errored = true; throw new Error(`Codex API ${response.status}`); }
    const data = await response.json();
    if (data.errors?.length) { errored = true; throw new Error(data.errors[0].message); }
    return data.data;
  } catch (err) {
    errored = true;
    throw err;
  } finally {
    try { codexMetricsKv?.trackQuery(operation, Date.now() - startTime, errored, 'prod-research'); } catch {}
  }
}

/**
 * Cache-aside wrapper around Codex getTokenBars.
 *
 * Bucket-keys by `codex:bars:<addr:net>:<requestedRes>:<bucket>` — identical
 * shape to apps/research/api/_lib/handlers/bars.js so /api/bars and the UDF
 * history endpoint share one warm cache. Two users viewing the same token at
 * the same resolution within one candle bucket share ONE upstream getBars.
 *
 *   tokenSymbol  canonical `<address>:<networkId>` (EVM lowercased,
 *                Solana case-preserved). Caller is responsible for that
 *                normalization so the key matches bars.js byte-for-byte.
 *   requestedRes original UDF resolution after RES_MAP ('60', '1D', '7D').
 *                Used in the cache key + bucket size.
 *   codexRes     resolution actually sent to Codex (weekly fetches '1D' then
 *                aggregates). Aggregation happens HERE before caching so the
 *                key for '7D' stores weekly-shaped bars.
 *
 * Returns array of {t,o,h,l,c,v} bars (pre-outlier-filter, pre-forward-fill)
 * sorted ascending by time, or null on failure / empty.
 *
 * On miss: in-flight dedup prevents two concurrent miss-races in the same
 * lambda from both calling Codex. Across lambdas, the cache absorbs the
 * second-and-later misses once the first writes (~1 RTT after the upstream
 * call returns).
 */
async function fetchCachedCodexBars(tokenSymbol, requestedRes, codexRes, fromInt, toInt, signals = null) {
  const bucketSec = _BARS_BUCKET_SEC[requestedRes] || 3600;
  const bucket = Math.floor(toInt / bucketSec);
  // 2026-06-10: `fromBucket` joins the key — without it, a short window and a
  // full-history window with the same `to` shared one entry and whichever
  // landed first truncated (or bloated) the other. Mirrors bars.js.
  const fromBucket = Math.floor(fromInt / bucketSec);
  // L4-PR4: `:codex` suffix differentiates from `:binance` keys written by the
  // sibling bars.js handler. Prevents serving stale Codex bars after a token
  // gets a fresh Binance listing.
  const kvKey = `codex:bars:${tokenSymbol}:${requestedRes}:${fromBucket}:${bucket}:codex`;
  const isWeekly = requestedRes === '7D';
  // Stale mirror (no time bucket) — shared with /api/bars via bars-router.js.
  const staleKey = staleMirrorKey(tokenSymbol, requestedRes);

  // Daily Codex budget guard (charts-v2 GROUP 2). Surfaces state via `signals`
  // so handleHistory can emit the X-Spectre-Budget header. FAIL-OPEN.
  const budget = await getBudgetState();
  if (signals) signals.budget = budget.state;

  // 1. KV read — accept only entries that actually contain bars so a
  // transient empty cached result doesn't poison subsequent reads.
  try {
    const cached = await getJsonWithTTL(kvKey);
    if (cached?.bars?.length > 0) return cached.bars;
  } catch { /* best-effort */ }

  // Mirror shape guard (2026-08-05): the mirror is only meaningful for
  // CHART-shaped windows. Live tail refreshes (from = last bar, a 1-3 bucket
  // span) ride this same function, and mirroring them overwrote the shared
  // 7-day mirror with a handful of bars - the next Codex blip then served
  // those few bars as the whole chart. Only windows spanning >= 100 buckets
  // may read or write the mirror (tail polls are 1-3, first windows 300+).
  const _mirrorShaped = (toInt - fromInt) / bucketSec >= 100;

  // 2. HARD budget: cache-only + stale-if-error. No fresh getBars spend — serve
  // the stale mirror if present, else null (caller cascades / no_data).
  if (budget.state === 'hard') {
    if (_mirrorShaped) {
      try {
        const stale = await getJsonWithTTL(staleKey);
        if (stale?.bars?.length > 0) return stale.bars;
      } catch { /* best-effort */ }
    }
    return null;
  }

  // 3. SOFT budget: warn once/min/lambda + stretch TTL for sub-5-min
  // resolutions (degrade freshness, not availability).
  let codexTtl = Math.min(bucketSec, 3600);
  if (budget.state === 'soft') {
    _udfMaybeWarnSoft(budget.count);
    if (['1S', '1', '5'].includes(requestedRes)) codexTtl = Math.max(codexTtl, 300);
  }

  // 4. In-flight dedup. Within one lambda, multiple concurrent misses for the
  // same key collapse to one Codex call.
  const pending = _udfBarsInflight.get(kvKey);
  if (pending) return pending;

  const p = (async () => {
    try {
      const result = await executeCodexQuery(
        `query($symbol:String!,$from:Int!,$to:Int!,$resolution:String!){
          getTokenBars(symbol:$symbol,from:$from,to:$to,resolution:$resolution,removeLeadingNullValues:true,removeEmptyBars:true){o h l c t volume}
        }`,
        { symbol: tokenSymbol, from: fromInt, to: toInt, resolution: codexRes },
      );

      const bd = result?.getTokenBars;
      if (!bd?.t?.length) return null;

      const mapped = bd.t.map((t, i) => ({
        t,
        o: bd.o[i],
        h: bd.h[i],
        l: bd.l[i],
        c: bd.c[i],
        v: parseFloat(bd.volume?.[i]) || 0,
      }));
      const realCount = mapped.filter(b => b.o != null && b.c != null).length;
      if (realCount / mapped.length <= 0.5) return null;

      const filtered = mapped.filter(b => b.o != null && b.c != null);
      if (!hasValidPrices(filtered)) return null;

      let bars = isWeekly ? aggregateDailyToWeekly(filtered) : filtered;
      bars = bars.slice().sort((a, b) => a.t - b.t);
      // DEX anomaly clamp (charts-system E1): Codex keeps wash-trade prints
      // as bar highs/lows - same guard as the GT pages.
      bars = clampOutlierBars(bars);

      if (bars.length > 0) {
        // TTL cap (2026-06-10): bucketSec froze 1D entries for 24h / weekly
        // for 7 days — the live candle never moved. 1h max keeps the Codex
        // cost shield while letting daily+ bars refresh. SOFT budget stretches
        // sub-5m to 300s (codexTtl above).
        // source tag (2026-06-11 audit): this key is deliberately SHARED with
        // /api/bars; entries without `source` made its writeBarsPayload fall
        // to the unknown branch and drop all cache headers.
        try { await setJsonWithTTL(kvKey, { bars, source: 'codex' }, codexTtl); } catch { /* best-effort */ }
        // Stale mirror (best-effort): 7-day stale-if-error backstop for the
        // budget-hard + ordinary-Codex-blip paths. Shared with /api/bars.
        // WRITE GUARD (2026-06-11 audit): the mirror key is window-agnostic -
        // only mirror live windows (to ~ now) so deep scroll-back builds
        // can't overwrite it with months-old bars. _mirrorShaped (2026-08-05)
        // additionally keeps narrow live-tail refreshes from shrinking it.
        if (_mirrorShaped && Math.floor(Date.now() / 1000) - toInt < 2 * bucketSec) {
          try { await setJsonWithTTL(staleKey, { bars, source: 'codex' }, STALE_TTL_SEC); } catch { /* best-effort */ }
        }
      }
      return bars;
    } catch (e) {
      console.warn(`[UDF] Cached Codex fetch failed for ${tokenSymbol}:`, e.message);
      // stale-if-error: on a Codex fetch error (not just budget-hard), serve the
      // mirror if present before giving up - chart-shaped windows only, so an
      // explicit older window never receives the mirror's recent bars.
      if (_mirrorShaped) {
        try {
          const stale = await getJsonWithTTL(staleKey);
          if (stale?.bars?.length > 0) return stale.bars;
        } catch { /* best-effort */ }
      }
      return null;
    }
  })().finally(() => { _udfBarsInflight.delete(kvKey); });

  _udfBarsInflight.set(kvKey, p);
  return p;
}

// SOFT-budget warn: at most once per lambda per minute (mirrors bars-router).
let _udfLastSoftWarn = 0;
function _udfMaybeWarnSoft(count) {
  const now = Date.now();
  if (now - _udfLastSoftWarn > 60_000) {
    _udfLastSoftWarn = now;
    console.warn(`[codex-budget] SOFT (UDF): daily Codex count=${count} >= soft threshold; degrading sub-5m freshness`);
  }
}

// Validate bar prices are sane (reject raw on-chain amounts, NaN, Infinity)
function hasValidPrices(barsArr) {
  if (!barsArr || barsArr.length === 0) return false;
  const recent = barsArr.slice(-30);
  if (recent.every(b => b.o === 0 && b.h === 0 && b.l === 0 && b.c === 0)) return false;
  if (recent.some(b => [b.o, b.h, b.l, b.c].some(v => !Number.isFinite(v) || v < 0 || v > 1e12))) return false;
  return true;
}

// Aggregate 1D bars into ISO weeks (Monday-start UTC)
function aggregateDailyToWeekly(daily) {
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
  return [...weeks.values()].sort((a, b) => a.t - b.t);
}

// Outlier handling moved to the shared continuation-test engine — see
// sanitizeBars (../bars-router.js, PR #1422). The local median-band clamp
// that lived here rewrote genuine crash candles (median×0.5 floor) and was
// removed 2026-08-25.

// Forward-fill a sparse-DEX bar list up to `toSec` so the chart doesn't
// appear to stop days before "now". OHLC collapses to last close, volume = 0.
function forwardFillToNow(bars, toSec, resolutionSec) {
  if (!Array.isArray(bars) || bars.length === 0 || !resolutionSec || resolutionSec <= 0) return bars;
  const last = bars[bars.length - 1];
  if (!last || !(last.c > 0)) return bars;
  const gapBars = Math.floor((toSec - last.t) / resolutionSec);
  if (gapBars < 2) return bars;
  const fillCount = Math.min(gapBars - 1, 500);
  const out = bars.slice();
  const price = last.c;
  for (let i = 1; i <= fillCount; i++) {
    out.push({ t: last.t + i * resolutionSec, o: price, h: price, l: price, c: price, v: 0 });
  }
  return out;
}

// Covers every TradingView UDF resolution the widget may request.
function resolutionToSeconds(res) {
  if (!res) return 3600;
  const map = {
    '1S': 1, '5S': 5, '15S': 15, '30S': 30,
    '1': 60, '3': 180, '5': 300, '15': 900, '30': 1800,
    '60': 3600, '120': 7200, '180': 10800, '240': 14400,
    '360': 21600, '480': 28800, '720': 43200,
    'D': 86400, '1D': 86400, '3D': 259200,
    'W': 604800, '1W': 604800,
    'M': 2592000, '1M': 2592000, '12M': 31536000,
  };
  if (map[res]) return map[res];
  const n = parseInt(res, 10);
  return Number.isFinite(n) && n > 0 ? n * 60 : 3600;
}

function pricescaleFromPrice(price) {
  if (!price || price <= 0) return 100000000;
  if (price >= 10000) return 100;
  if (price >= 100) return 10000;
  if (price >= 1) return 10000;
  if (price >= 0.01) return 1000000;
  if (price >= 0.0001) return 100000000;
  return 10000000000;
}

function isStockSymbol(sym) {
  // Both class-share spellings route to stocks: the set stores BRK.B, but
  // Yahoo-facing callers may send BRK-B.
  return STOCK_SET.has(sym) || STOCK_SET.has(String(sym).replace('-', '.'));
}

// ── Route handlers ──

function handleConfig(res) {
  // L4-PR7: TradingView UDF config is a static payload - safe to cache at the
  // edge indefinitely (TTL of 1h is a sane upper bound to allow eventual
  // updates without a deploy). CDN-Cache-Control bypasses Vercel's cookie-
  // ignores-Cache-Control behavior so logged-in users hit the edge too.
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
  res.setHeader('CDN-Cache-Control', 'public, s-maxage=3600');
  return res.status(200).json({
    supports_search: true,
    supports_group_request: false,
    supports_marks: false,
    supports_timescale_marks: false,
    supports_time: true,
    exchanges: [
      { value: '', name: 'All Exchanges', desc: '' },
      { value: 'NYSE', name: 'NYSE', desc: 'New York Stock Exchange' },
      { value: 'NASDAQ', name: 'NASDAQ', desc: 'Nasdaq' },
      { value: 'CRYPTO', name: 'Crypto', desc: 'Cryptocurrency' },
    ],
    symbols_types: [
      { name: 'All types', value: '' },
      { name: 'Stock', value: 'stock' },
      { name: 'Crypto', value: 'crypto' },
    ],
    supported_resolutions: ['1S', '1', '5', '15', '30', '60', '240', '720', '1D', '1W'],
  });
}

function handleTime(res) {
  // /api/tradingview/udf/time MUST stay real-time - the widget uses it to
  // detect clock skew. Explicit no-store keeps the edge from caching seconds.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  return res.status(200).send(String(Math.floor(Date.now() / 1000)));
}

async function handleSymbols(req, res) {
  const symbol = (req.query.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ s: 'error', errmsg: 'Missing symbol' });

  // L4-PR7: symbol metadata is stable for the day; cache aggressively at the
  // edge so the per-token pricescale CG lookup is amortized across all users.
  // CDN-Cache-Control wins over Cache-Control for cookie-bearing responses.
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
  res.setHeader('CDN-Cache-Control', 'public, s-maxage=900');

  if (isStockSymbol(symbol)) {
    return res.status(200).json({
      name: symbol,
      'full_name': `NYSE:${symbol}`,
      description: symbol,
      type: 'stock',
      session: '0930-1600',
      exchange: 'NYSE',
      'listed_exchange': 'NYSE',
      timezone: 'America/New_York',
      'has_intraday': true,
      'has_daily': true,
      'has_weekly_and_monthly': true,
      'supported_resolutions': ['1', '5', '15', '30', '60', 'D', 'W'],
      pricescale: 100,
      minmov: 1,
      'currency_code': 'USD',
    });
  }

  // Crypto - determine pricescale from actual price
  let pricescale = 100000000;
  if (symbol === 'BTC' || symbol === 'ETH') {
    pricescale = 100;
  } else {
    try {
      const token = TOKEN_REGISTRY[symbol];
      const cgId = token?.coingeckoId;
      if (cgId) {
        const url = `${COINGECKO_BASE_URL}/simple/price?ids=${cgId}&vs_currencies=usd`;
        const opts = { headers: {} };
        if (COINGECKO_API_KEY) opts.headers['x-cg-pro-api-key'] = COINGECKO_API_KEY;
        const resp = await fetch(url, opts);
        if (resp.ok) {
          const data = await resp.json();
          const price = data[cgId]?.usd;
          if (price > 0) pricescale = pricescaleFromPrice(price);
        }
      }
    } catch { /* keep default */ }
  }

  return res.status(200).json({
    name: symbol,
    'full_name': `CRYPTO:${symbol}USD`,
    description: `${symbol}/USD`,
    type: 'crypto',
    session: '24x7',
    exchange: 'CRYPTO',
    'listed_exchange': 'CRYPTO',
    timezone: 'Etc/UTC',
    'has_intraday': true,
    'has_seconds': true,
    'has_daily': true,
    'has_weekly_and_monthly': true,
    'supported_resolutions': ['1S', '1', '5', '15', '30', '60', '240', 'D', 'W'],
    'seconds_multipliers': ['1'],
    pricescale,
    minmov: 1,
    'currency_code': 'USD',
  });
}

async function handleSearch(req, res) {
  const query = (req.query.query || '').toUpperCase();
  const limit = parseInt(req.query.limit) || 10;
  // L4-PR7: search results are user-agnostic and stable for minutes. Edge
  // caching collapses identical autocomplete queries across all users to
  // one origin hit per 60s. CDN-Cache-Control bypasses Vercel's cookie
  // ignores-Cache-Control behavior so logged-in users benefit too.
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
  res.setHeader('CDN-Cache-Control', 'public, s-maxage=60');
  if (!query) return res.status(200).json([]);

  const results = [];

  // Search stocks
  POPULAR_STOCK_SYMBOLS.forEach(sym => {
    if (sym.includes(query)) {
      results.push({
        symbol: sym,
        full_name: `NYSE:${sym}`,
        description: sym,
        exchange: 'NYSE',
        type: 'stock',
      });
    }
  });

  return res.status(200).json(results.slice(0, limit));
}

// L4-PR7: edge-cache TTL for a TradingView UDF history response. Scales with
// the candle interval so 1m polls don't pin a fresh bar at the edge for too
// long, while 1D bars (which can't change for hours) get aggressive caching.
// Both headers are emitted because Cache-Control alone is silently dropped by
// Vercel's edge CDN when the response carries a cookie (auth-gate / Privy);
// CDN-Cache-Control is honored regardless and is what actually de-fans-out
// the per-user multiplier on chart loads.
//
// PR1 (2026-06-04, Codex cost war): doubled every TTL bucket. The previous
// ladder (300s for 1H) was tuned when getBars was 47% of bill but was still
// loose enough to let pan/zoom across many users multiply origin hits. With
// 60s ratelimit + this bump, a single token+resolution serves all viewers
// from one origin response for the full bucket — Codex bill is bounded by
// candle freshness, not by user count.
function _setUdfHistoryCacheHeaders(res, resolution) {
  const ttl = ({ '1S': 10, '1': 60, '5': 120, '15': 180, '30': 240, '60': 600, '240': 1200, '720': 2400, '1D': 3600, 'D': 3600, '1W': 7200, 'W': 7200, '7D': 7200 })[resolution] || 120;
  res.setHeader('Cache-Control', `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`);
  res.setHeader('CDN-Cache-Control', `public, s-maxage=${ttl}`);
}

async function handleHistory(req, res) {
  // PR1 (2026-06-04, Codex cost war): UDF /history previously had NO rate
  // limit. Every TradingView Advanced datafeed pan/zoom hits this route, so
  // an abusive client could trivially drive Codex bill via repeated
  // getTokenBars calls. Match the bars.js cap (60 req/min/IP). KV-backed
  // when `RATELIMIT_USE_KV=1` is set on the project env.
  if (await rateLimit(req, res, { bucket: 'udf-history', max: 60, windowMs: 60_000 })) return;

  const symbol = (req.query.symbol || '').toUpperCase();
  const resolution = req.query.resolution || 'D';

  if (!symbol) return res.status(200).json({ s: 'error', errmsg: 'Missing symbol' });

  // Window normalization (2026-06-11): `from` used to default to 0 on any
  // missing/malformed value, which silently disabled the Binance tier (falsy-
  // zero guards) and sent an unbounded window to Codex → s:'no_data' → blank
  // TradingView panes. Mirror bars.js: clamp invalid/zero/too-wide windows to
  // "the last N bars before `to`".
  // CODEX DATAPOINT CAP (2026-08-11): this lane never sends `countback`, so its
  // window reaches getTokenBars verbatim - and getTokenBars counts [from..to]
  // INCLUSIVELY, so 1500 buckets is 1501 datapoints and a HARD error ("Too wide
  // of range ... Max datapoints returned is 1500"), not a truncation. The clamp
  // below produced EXACTLY that window, so every too-wide UDF request lost the
  // Codex tier outright. 1499 buckets = 1500 datapoints = the real ceiling.
  const UDF_MAX_WINDOW_BARS = 1499;
  const udfIntervalSec = ({
    '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, '240': 14400,
    '720': 43200, 'D': 86400, '1D': 86400, 'W': 604800, '1W': 604800,
  })[resolution] || 3600;
  let to = parseInt(req.query.to);
  if (!Number.isFinite(to) || to <= 0) to = Math.floor(Date.now() / 1000);
  let from = parseInt(req.query.from);
  if (!Number.isFinite(from) || from <= 0 || (to - from) > UDF_MAX_WINDOW_BARS * udfIntervalSec) {
    from = to - UDF_MAX_WINDOW_BARS * udfIntervalSec;
  }

  // ── Stock bars via Yahoo Finance ──
  if (isStockSymbol(symbol)) {
    try {
      const yahooIntervalMap = {
        '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '60m',
        'D': '1d', '1D': '1d', 'W': '1wk', '1W': '1wk',
      };
      const interval = yahooIntervalMap[resolution] || '1d';
      // Yahoo's canonical for class shares is the DASH form (BRK-B) — the UDF
      // lane's convention is the dot form (BRK.B), which Yahoo 404s. Indices
      // (^GSPC) and futures (GC=F) carry no dot, so this is a no-op for them.
      const yahooSym = symbol.replace(/\./g, '-');
      const url = `${YAHOO_CHART_URL}/${encodeURIComponent(yahooSym)}?interval=${interval}&period1=${from}&period2=${to}`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        const data = await resp.json();
        const result = data?.chart?.result?.[0];
        if (result?.timestamp?.length > 0) {
          const q = result.indicators?.quote?.[0] || {};
          _setUdfHistoryCacheHeaders(res, resolution);
          res.setHeader('X-Spectre-Tier', 'yahoo');
          return res.status(200).json({
            s: 'ok',
            t: result.timestamp,
            o: (q.open || []).map(v => v != null ? Number(v) : 0),
            h: (q.high || []).map(v => v != null ? Number(v) : 0),
            l: (q.low || []).map(v => v != null ? Number(v) : 0),
            c: (q.close || []).map(v => v != null ? Number(v) : 0),
            v: (q.volume || []).map(v => v != null ? Number(v) : 0),
          });
        }
      }
    } catch (e) {
      console.warn(`[UDF] Yahoo failed for ${symbol}:`, e.message);
    }
    // Brief edge cache on no_data so a transient Yahoo blip doesn't pin every
    // viewer to "no data" for the full TTL.
    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=15');
    res.setHeader('X-Spectre-Tier', 'no_data');
    return res.status(200).json({ s: 'no_data', nextTime: to + 60 });
  }

  // ── Crypto bars ──
  let bars = null;
  // PR1 (2026-06-04): track which tier produced bars so the final response
  // can emit `X-Spectre-Tier` for runtime-log forensics.
  let _tierSource = null;

  // Tier 0: Direct address lookup (frontend passed address+networkId params)
  const reqAddress = req.query.address;
  const reqNetworkId = parseInt(req.query.networkId) || 1;
  const reqCgId = req.query.cgId || null;

  // Side-channel for the budget guard (set inside fetchCachedCodexBars) so the
  // final response can emit X-Spectre-Budget. Shared across both Codex tiers.
  const _signals = { budget: null };

  // CODEX_FIRST_BARS alignment (charts-v2): the UDF crypto path used to IGNORE
  // this flag and always run its own cascade. Now it mirrors bars.js — for
  // address-form tokens, reliability mode skips the Hetzner + GeckoTerminal
  // tiers so Codex getTokenBars serves them directly. Binance still owns majors
  // above; KV caches + PRO_CODEX_DISABLED kill switch still apply.
  const _isAddress = !!reqAddress && (reqAddress.startsWith('0x') || reqAddress.length >= 32);
  const codexFirst = process.env.CODEX_FIRST_BARS === '1' && _isAddress;

  // HETZNER BACKGROUND-ONLY (charts-v2): serving from the candle store is opt-in
  // via HETZNER_BARS_SERVE=1 (AND L4_PR5_DISABLE_HETZNER_BARS!=='1'). When OFF
  // we still fire a non-awaited warm ping for address tokens so the store's
  // auto-registration + permanent backfill + freshness tracking keep running.
  const hetznerServe = process.env.HETZNER_BARS_SERVE === '1'
    && process.env.L4_PR5_DISABLE_HETZNER_BARS !== '1';
  if (!hetznerServe && _isAddress && process.env.L4_PR5_DISABLE_HETZNER_BARS !== '1') {
    void fetchHetznerCandles(symbol, resolution, from, to, { cgId: reqCgId, address: reqAddress, networkId: reqNetworkId }).catch(() => {});
  }

  // ── L4-PR4 (2026-06-03): Binance-first for any token with a Binance USDT
  // pair. `getBars` was 45% of total Codex bill (598K ops/day on Jun 2).
  // Resolves symbol/address/cgId → Binance pair via lookupBinancePair. Free,
  // real-time, no Codex billable. Falls through to Codex below on miss/fail.
  // Kill switch: L4_PR4_DISABLE_BINANCE=1 in Vercel env.
  const binancePair = lookupBinancePair(symbol, reqCgId, reqAddress);
  if (binancePair) {
    try {
      const klines = await fetchBinanceKlines(binancePair, resolution, from, to);
      if (klines?.length > 0) {
        bars = klines;
        _tierSource = 'binance';
        console.log(`[UDF-L4-PR4] ${symbol} → ${binancePair}: ${bars.length} bars (zero Codex)`);
      } else {
        console.log(`[UDF-L4-PR4] ${symbol} → ${binancePair}: no data, falling back to Codex`);
      }
    } catch (e) {
      console.warn(`[UDF-L4-PR4] ${symbol} → ${binancePair}: ${e.message}, falling back to Codex`);
    }
  }

  // ── L4-PR5 (2026-06-03): Hetzner candles_1m for DEX tokens not on Binance.
  // Pulls from the Timescale table populated by worker-candles-codex (100
  // active DEX tokens, 60s cadence) and worker-binance/worker-bybit/etc.
  // (CEX assets). FREE — no Codex billable. Tokens outside Hetzner's indexed
  // set return null here and fall through to the existing Codex tiers below.
  // SERVING is now opt-in (HETZNER_BARS_SERVE) — background ingestion still
  // runs via the warm ping above. Skipped in codexFirst reliability mode.
  if (!bars && hetznerServe && !codexFirst) {
    try {
      const hetznerBars = await fetchHetznerCandles(
        symbol,
        resolution,
        from,
        to,
        { cgId: reqCgId, address: reqAddress, networkId: reqNetworkId },
      );
      if (hetznerBars?.length > 0) {
        bars = hetznerBars;
        _tierSource = 'hetzner';
        console.log(`[UDF-L4-PR5] ${symbol}: ${bars.length} bars from Hetzner (zero Codex)`);
      }
    } catch (e) {
      console.warn(`[UDF-L4-PR5] ${symbol}: ${e.message}, falling back to Codex`);
    }
  }

  // ── L4-PR8 (2026-06-03): GeckoTerminal DEX OHLCV as Tier 2.5.
  // Closes the long-tail DEX-token gap that Hetzner's top-100 active set
  // doesn't cover. Tokens outside the active set return null from Hetzner
  // (hotfix #725 freshness check) and arrive here. GT indexes pools on
  // Solana / ETH / Base / BSC / Arbitrum / Optimism / Polygon / Avalanche
  // for free. Falls through to Codex on miss / unsupported chain.
  // Kill switch: L4_PR8_DISABLE_GECKOTERMINAL=1 in Vercel env. Skipped in
  // codexFirst reliability mode (Codex serves address tokens directly).
  if (!bars && !codexFirst && process.env.L4_PR8_DISABLE_GECKOTERMINAL !== '1') {
    try {
      const gtBars = await fetchGeckoTerminalBars(
        symbol,
        reqNetworkId,
        resolution,
        from,
        to,
        { cgId: reqCgId, address: reqAddress },
      );
      if (gtBars?.length > 0) {
        bars = gtBars;
        _tierSource = 'geckoterminal';
        // Head-stitch (2026-06-11, mirrors bars-router tryGeckoTerminal):
        // GT's per-token history can START long after the requested window
        // head (PALM day data begins ~Sep 2025). A partial answer used to be
        // returned as if complete - TV cached the uncovered head subrange as
        // no-data and rendered a months-long hole. For CG-listed tokens fill
        // [from, gtOldest) from CG OHLC and stitch.
        const _resSecMap = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, '240': 14400, '720': 43200, 'D': 86400, '1D': 86400, 'W': 604800, '1W': 604800 };
        const _resSec = _resSecMap[resolution] || 3600;
        if (reqCgId && bars[0].t - from > 3 * _resSec) {
          try {
            const headBars = await fetchCgOhlcBars(reqCgId, resolution, from, bars[0].t - 1);
            if (headBars?.length > 0) {
              const cutoff = bars[0].t;
              const head = headBars.filter((b) => b.t < cutoff);
              if (head.length > 0) bars = head.concat(bars);
            }
          } catch (e) {
            console.warn(`[UDF-L4-PR8] head-stitch ${reqCgId}: ${e.message}`);
          }
        }
        console.log(`[UDF-L4-PR8] ${symbol}: ${bars.length} bars from GeckoTerminal (zero Codex)`);
      }
    } catch (e) {
      console.warn(`[UDF-L4-PR8] ${symbol}: ${e.message}, falling back to Codex`);
    }
  }

  // ── cg-ohlc tier (2026-08-25): this lane used to skip straight from GT to
  // Codex while /api/bars runs binance → GT → cg-ohlc → codex. For CG-listed
  // tokens whose DEX tiers miss (HYPE: a native HyperCore id neither GT nor
  // Codex indexes) the asymmetry served no_data here while /api/bars charted
  // them fine. CG is free and CEX-aggregate — the right source for exactly
  // this class — and it runs BEFORE the billed Codex tiers (cost order).
  if (!bars && reqCgId) {
    try {
      // Coarsen, don't die (mirrors bars-router tryCgOhlc): CG's finest OHLC
      // is 30m — serve it for 1m/5m/15m so cgId-only tokens keep a chart on
      // intraday presets instead of falling to no_data.
      const cgRes = ({ '1': '30', '5': '30', '15': '30' })[String(resolution)] || resolution;
      const cgBars = await fetchCgOhlcBars(reqCgId, cgRes, from, to);
      if (cgBars?.length > 0) {
        bars = cgBars;
        _tierSource = 'cg-ohlc';
        console.log(`[UDF] ${symbol}: ${bars.length} bars from cg-ohlc (${reqCgId}${cgRes !== resolution ? `, coarsened ${resolution}→${cgRes}` : ''})`);
      }
    } catch (e) {
      console.warn(`[UDF] cg-ohlc failed for ${reqCgId}:`, e.message);
    }
  }

  // PR1 (2026-06-04) Codex kill switch. `PRO_CODEX_DISABLED=1` skips every
  // Codex-billable tier below — Binance/Hetzner/GeckoTerminal above STILL run
  // (they're free, no Codex impact), so majors and indexed DEX tokens keep
  // working. Only the long-tail Codex fallback is killed. Single env flip =
  // instant Codex bleed shutoff during an incident.
  const _codexDisabled = process.env.PRO_CODEX_DISABLED === '1';

  if (!bars && !_codexDisabled && reqAddress && CODEX_API_KEY) {
    try {
      const isSolana = !reqAddress.startsWith('0x') && reqAddress.length >= 32;
      const networkId = isSolana && reqNetworkId === 1 ? 1399811149 : reqNetworkId;
      const formatted = isSolana ? reqAddress : reqAddress.toLowerCase();
      const resMap = { '1S': '1S', '1': '1', '5': '5', '15': '15', '30': '30', '60': '60', '240': '240', '720': '720', 'D': '1D', '1D': '1D', 'W': '7D', '1W': '7D' };
      const requestedRes = resMap[resolution] || resolution;
      // Weekly: fetch 1D and aggregate, Codex 7D data is broken for DEX tokens
      const isWeekly = requestedRes === '7D';
      const codexRes = isWeekly ? '1D' : requestedRes;
      const tokenSymbol = `${formatted}:${networkId}`;

      bars = await fetchCachedCodexBars(tokenSymbol, requestedRes, codexRes, from, to, _signals);
      if (bars?.length > 0) _tierSource = 'codex';
    } catch (e) {
      console.warn(`[UDF] Address-based Codex lookup failed for ${reqAddress}:`, e.message);
    }
  }

  const token = TOKEN_REGISTRY[symbol];

  // Tier 1: Codex (if token has on-chain address)
  if (!bars && !_codexDisabled && token?.address && CODEX_API_KEY) {
    try {
      const isSolana = !token.address.startsWith('0x') && token.address.length >= 32;
      const networkId = token.networkId || 1;
      const formatted = isSolana ? token.address : token.address.toLowerCase();
      const resMap = { '1S': '1S', '1': '1', '5': '5', '15': '15', '30': '30', '60': '60', '240': '240', '720': '720', 'D': '1D', '1D': '1D', 'W': '7D', '1W': '7D' };
      const requestedRes = resMap[resolution] || resolution;
      // Weekly: fetch 1D and aggregate, Codex 7D data is broken for DEX tokens
      const isWeekly = requestedRes === '7D';
      const codexRes = isWeekly ? '1D' : requestedRes;
      const tokenSymbol = `${formatted}:${networkId}`;

      bars = await fetchCachedCodexBars(tokenSymbol, requestedRes, codexRes, from, to, _signals);
      if (bars?.length > 0) _tierSource = 'codex';
    } catch (e) {
      console.warn(`[UDF] Codex failed for ${symbol}:`, e.message);
    }
  }

  // Tier 1.5 "Dynamic Codex search" DELETED (Candle Store Phase 4 PR3,
  // 2026-06-09). It fired a billable Codex filterTokens(phrase) search +
  // getBars for ANY unknown plain symbol, and the liquidity-ranked fuzzy
  // match was collision-prone (wrong token charted under a shared ticker).
  // Unknown symbols already get free coverage above: Hetzner resolves bare
  // symbols case-insensitively (candle store) and GT covers long-tail DEX
  // tokens by address; below, the direct Binance klines fallback still runs.
  // Address-form symbols are unaffected (Codex address tier above).

  // Tier 2: Binance klines fallback (direct → allorigins proxy → individual)
  // Binance blocks Vercel IPs, so we use the same fallback chain as binance-ticker.js
  // Only plain tickers can have a Binance pair. Address-form symbols
  // (`0xabc…` / `addr:networkId`) used to produce garbage pairs like
  // `0XABC…:1USDT` and burn up to 13s on two dead fetches (task #22).
  const _plainTicker = /^[A-Z0-9]{1,15}$/.test(symbol);
  if (!bars && _plainTicker) {
    const binanceSym = token?.binanceSymbol || `${symbol}USDT`;
    const intervalMap = {
      '1S': '1s', '1': '1m', '5': '5m', '15': '15m', '30': '30m',
      '60': '1h', '240': '4h', '720': '12h', 'D': '1d', '1D': '1d', 'W': '1w', '1W': '1w',
    };
    const interval = intervalMap[resolution] || '1h';
    const endMs = to * 1000;
    const fromMs = from * 1000;
    const intervalMsMap = { '1s': 1e3, '1m': 6e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '4h': 144e5, '12h': 432e5, '1d': 864e5, '1w': 6048e5 };
    const barMs = intervalMsMap[interval] || 36e5;
    const requestedBars = Math.ceil((endMs - fromMs) / barMs);
    const binanceUrl = requestedBars <= 1000
      ? `https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${interval}&startTime=${fromMs}&endTime=${endMs}&limit=1000`
      : `https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${interval}&endTime=${endMs}&limit=1000`;

    function parseKlines(klines) {
      if (!Array.isArray(klines) || klines.length === 0) return null;
      return klines.map(k => ({
        t: Math.floor(k[0] / 1000),
        o: parseFloat(k[1]),
        h: parseFloat(k[2]),
        l: parseFloat(k[3]),
        c: parseFloat(k[4]),
        v: parseFloat(k[5]),
      }));
    }

    // Attempt 1: Direct Binance
    try {
      const response = await fetch(binanceUrl, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        bars = parseKlines(await response.json());
        if (bars?.length > 0) _tierSource = 'binance';
      }
    } catch (e) {
      console.warn(`[UDF] Binance direct failed for ${symbol}:`, e.message);
    }

    // Attempt 2: allorigins CORS proxy (Binance blocks Vercel IPs)
    if (!bars) {
      try {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(binanceUrl)}`;
        const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
        if (response.ok) {
          bars = parseKlines(await response.json());
          if (bars?.length > 0) _tierSource = 'binance';
        }
      } catch (e) {
        console.warn(`[UDF] Binance allorigins failed for ${symbol}:`, e.message);
      }
    }
  }

  if (bars && bars.length > 0) {
    let validBars = bars.filter(b => b.o != null && b.c != null && (b.o !== 0 || b.c !== 0));

    // CRITICAL: /api/bars (Codex) returns bars in DESCENDING order. TradingView UDF
    // requires strictly ASCENDING time. Sort + dedupe before filter/fill.
    validBars.sort((a, b) => a.t - b.t);
    const dedup = new Map();
    for (const b of validBars) dedup.set(b.t, b);
    validBars = [...dedup.values()];

    // Off-scale repair FIRST (mirrors writeBarsPayload): a units-corrupted price
    // poisons sanitizeBars' median band and stitchAdjacentOpens alike, and the
    // widget would render the bar as a candle wicking to zero.
    validBars = repairScaledPrices(validBars, `${symbol} ${resolution}`);

    // Outlier handling — the SHARED continuation-test engine (bars-router
    // sanitizeBars, PR #1422 semantics). The old local filterOutlierBars
    // clamped anything below neighbour-median×0.5 — during a genuine crash the
    // ±N window is half pre-crash prices, so the ONE candle carrying the move
    // got rewritten to exactly half its open (MemeCore 25 Jun '26: real 1h low
    // ~0.55 served as an o2.66→c1.33 "-50.00%" bar with a cliff to the next
    // bar at 0.9). A wrong print is an ISLAND the next bar ignores; a real
    // move CHAINS into the next bar's traded range — sanitizeBars tells them
    // apart. Binance bars stay in-band and pass through untouched.
    if (validBars.length > 5) {
      validBars = sanitizeBars(validBars);
    }
    // Continuity pass (mirrors writeBarsPayload): adjacent-bar opens stitched
    // to the prior close so mixed-source series (GT + cg-ohlc head-stitch)
    // and sanitize-flattened bars never render torn candle ranges. Real data
    // holes (> 1.5 buckets) are never bridged.
    stitchAdjacentOpens(validBars, udfIntervalSec, `${symbol} ${resolution}`);

    // Forward-fill sparse tokens so the chart extends up to "now" instead of
    // stopping at the last real trade. Gated so we don't pollute historical
    // scroll-back requests with synthetic bars:
    //   1. windowSec > resSec * 10 (not a 120s polling window)
    //   2. `to` is within ~2 bars of "now" (live/initial request, not scroll-back)
    const resSec = resolutionToSeconds(resolution);
    const windowSec = to - from;
    const nowSec = Math.floor(Date.now() / 1000);
    const reachesNow = (nowSec - to) < resSec * 2;
    if (validBars.length > 0 && windowSec > resSec * 10 && reachesNow) {
      const fillTarget = Math.max(to, nowSec - resSec);
      validBars = forwardFillToNow(validBars, fillTarget, resSec);
    }

    if (validBars.length > 0) {
      _setUdfHistoryCacheHeaders(res, resolution);
      res.setHeader('X-Spectre-Tier', _tierSource || 'unknown');
      if (_signals.budget) res.setHeader('X-Spectre-Budget', _signals.budget);
      return res.status(200).json({
        s: 'ok',
        t: validBars.map(b => b.t),
        o: validBars.map(b => b.o),
        h: validBars.map(b => b.h),
        l: validBars.map(b => b.l),
        c: validBars.map(b => b.c),
        v: validBars.map(b => b.v || 0),
      });
    }
  }

  // Brief edge cache on the final no_data fallback - prevents a poison-cache
  // scenario where one bad upstream result would stick at the edge for hours.
  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
  res.setHeader('CDN-Cache-Control', 'public, s-maxage=15');
  res.setHeader('X-Spectre-Tier', 'no_data');
  if (_signals.budget) res.setHeader('X-Spectre-Budget', _signals.budget);
  return res.status(200).json({ s: 'no_data' });
}

// ── Main handler ──

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const route = req.query.route || '';

  try {
    switch (route) {
      case 'config':  return handleConfig(res);
      case 'time':    return handleTime(res);
      case 'symbols': return await handleSymbols(req, res);
      case 'search':  return await handleSearch(req, res);
      case 'history': return await handleHistory(req, res);
      default:
        return res.status(404).json({ error: `Unknown UDF route: ${route}` });
    }
  } catch (e) {
    console.error(`[UDF] Error on route=${route}:`, e);
    return res.status(500).json({ s: 'error', errmsg: e.message || 'Internal server error' });
  }
}
