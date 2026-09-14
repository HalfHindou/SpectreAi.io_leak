/**
 * Vercel Serverless — /api/bars
 * Mirrors the Express dev route: Codex getTokenBars first (DEX OHLCV + volume),
 * Binance klines fallback for majors. Returns rows [{ t, o, h, l, c, v }].
 * Consumed by apps/research/src/pages/embed-chart (candle mode) and any
 * client that expects the row-shaped bars payload.
 *
 * The tier cascade is factored into apps/research/api/_lib/bars-router.js
 * (shared with the TradingView UDF handler). With SMART_BARS_ROUTER unset, this
 * handler runs the tiers in the EXACT legacy order (zero behavior change). With
 * the flag set, buildTierList() picks an order by token class.
 */

import { rateLimit } from '../ratelimit.js'
import { getJsonWithTTL, setJsonWithTTL } from '../kv.js'
import { lookupBinancePair } from '../binance-bars.js'
import { findTopPoolPin } from '../geckoterminal-bars.js'
import { resolveCexVenue } from '../cex-venue-map.js'
import {
  classifyTokenClass,
  buildTierList,
  runTier,
  warmHetznerStore,
  writeBarsPayload,
  tryCgOhlc,
} from '../bars-router.js'
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
let codexMetricsKv = null;
try { codexMetricsKv = _require('../../../../../packages/server/lib/codex-metrics-kv'); } catch {}

// Address -> CoinGecko id resolver for the GeckoTerminal head-stitch.
// GT only carries the CURRENT pool's OHLCV, which often begins months after a
// token's genesis (SPECTRE's GT pool starts ~Jul 2024; the token launched
// Nov 2023). tryGeckoTerminal() backfills that missing head from CG OHLC, but
// the backfill was gated on the request carrying ?cgId= - and the chart's
// getBars (codexApi.getBars) never sends it. So every CG-listed DEX token
// silently lost its early history (the "first 5 months missing" report,
// 2026-06-12). Resolving cgId from the address here makes the stitch fire for
// any registry / EXTENDED_CG_TOKENS token regardless of the client. CG OHLC
// is free - zero Codex cost.
let _addrCgIdMap = null;
function _resolveAddrCgId(address, networkId) {
  if (!address) return null;
  try {
    if (!_addrCgIdMap) {
      _addrCgIdMap = new Map();
      const reg = _require('../../../../../packages/server/lib/token-registry');
      const known = reg?.KNOWN_TOKEN_ADDRESSES || {};
      const cgMap = reg?.SYMBOL_TO_COINGECKO_ID || {};
      for (const [sym, info] of Object.entries(known)) {
        const cg = cgMap[sym];
        if (info?.address && info?.networkId != null && cg) {
          const a = info.address.startsWith('0x') ? info.address.toLowerCase() : info.address;
          _addrCgIdMap.set(`${a}:${info.networkId}`, cg);
        }
      }
      for (const [cg, info] of Object.entries(reg?.EXTENDED_CG_TOKENS || {})) {
        if (info?.address && info?.networkId != null) {
          const a = info.address.startsWith('0x') ? info.address.toLowerCase() : info.address;
          if (!_addrCgIdMap.has(`${a}:${info.networkId}`)) _addrCgIdMap.set(`${a}:${info.networkId}`, cg);
        }
      }
    }
    const a = address.startsWith('0x') ? address.toLowerCase() : address;
    return _addrCgIdMap.get(`${a}:${networkId}`) || null;
  } catch { return null; }
}

// Durable KV cache + per-lambda in-flight dedup for the chart bars path.
// /api/bars is the TradingView datafeed's OHLCV source and was the #1 Codex
// cost (getBars = 47% of all usage on Jun 1). It carried only an s-maxage HTTP
// header, which Vercel's CDN ignores for cookie-bearing (logged-in) requests -
// so every chart load/poll/pan hit Codex fresh. KV is wired on this project
// (KV_REST_API_URL confirmed). Cache by token+resolution+bucketed-time so all
// users on the same chart+timeframe share one upstream getBars.
const _barsInflight = new Map();

// ── CODEX PAIR PIN (2026-08-25, ZIG dust-pool follow-up) ────────────────────
// Codex getTokenBars aggregates a token's "top liquidity pairs" per request,
// so a CG-listed token with dead DEX remnants (ZIG: ~20 Uniswap dust pools,
// one still trading at ~1.45x the real market) can get dust trades blended
// into its tape — differently per request/window, which is how the TV chart
// stitched a $0.06 history under a $0.042 head. For CG-LISTED address tokens
// (the class with remnant pools; pure degens keep the token-form query and
// its migration-spanning history) the Codex query is pinned to GT's deepest
// BASE-side pool via getBars — the same pool the GT tier itself charts.
// Resolution: memory (24h hit / 10min miss) → KV (7d) → one GT /pools call.
// The long KV TTL matters: the codex tier mostly runs when GT is DOWN, so
// the pin must not depend on GT answering at that moment. Fail-soft: any
// miss falls back to the token-form query (today's exact behavior).
const _codexPinMemo = new Map(); // `${addr}:${networkId}` → { pin: {pool,createdAt}|null, ts }
const _CODEX_PIN_HIT_TTL_MS = 24 * 3600 * 1000;
const _CODEX_PIN_MISS_TTL_MS = 10 * 60 * 1000;
const _codexPinLogged = new Set();
async function _resolveCodexPin(address, networkId) {
  const memoKey = `${address}:${networkId}`;
  const m = _codexPinMemo.get(memoKey);
  if (m && Date.now() - m.ts < (m.pin ? _CODEX_PIN_HIT_TTL_MS : _CODEX_PIN_MISS_TTL_MS)) {
    return m.pin;
  }
  let pin = null;
  try {
    const kv = await getJsonWithTTL(`codex:pin:${memoKey}`);
    if (kv && typeof kv === 'object' && kv.pool) pin = { pool: kv.pool, createdAt: kv.createdAt || null };
    else if (typeof kv === 'string' && kv) pin = { pool: kv, createdAt: null }; // pre-createdAt entries
  } catch { /* KV down → resolve live */ }
  if (!pin) {
    try { pin = await findTopPoolPin(networkId, address); } catch { pin = null; }
    if (pin) {
      try { await setJsonWithTTL(`codex:pin:${memoKey}`, pin, 7 * 86400); } catch { /* best effort */ }
    }
  }
  _codexPinMemo.set(memoKey, { pin, ts: Date.now() });
  if (pin && !_codexPinLogged.has(memoKey)) {
    _codexPinLogged.add(memoKey);
    console.info(`[bars-pin] ${memoKey} → codex bars pinned to pool ${pin.pool}`);
  }
  return pin;
}
const _BARS_BUCKET_SEC = { '1S': 5, '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, '240': 14400, '720': 43200, '1D': 86400, 'D': 86400, '1W': 604800, 'W': 604800 };

const CODEX_API_KEY = process.env.CODEX_API_KEY
const CODEX_BASE_URL = 'https://graph.codex.io/graphql'
// Codex key is origin-restricted; server-to-server calls must present the allowed origin.
const CODEX_ORIGIN = process.env.CODEX_ORIGIN || 'https://app.spectreai.io'
// Hard cap getTokenBars enforces on an EXPLICIT [from..to] window (inclusive,
// so N buckets = N+1 datapoints). Exceeding it is an error, not a truncation.
const CODEX_MAX_DATAPOINTS = 1500
// How many bars the genesis head probe asks for. NOT 1: the explicit-window
// shape does not always drop exactly one bucket - measured 2026-08-11, TOSHI
// (BSC) explicit starts 2025-07-17 while the countback shape of the same
// series starts 2025-07-03, i.e. 14 buckets lost. One query either way; the
// answer is filtered to the requested window before it is prepended.
const GENESIS_HEAD_COUNTBACK = 200

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
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) { errored = true; throw new Error(`Codex ${response.status}`) }
    const data = await response.json()
    if (data.errors?.length) { errored = true; throw new Error(data.errors[0].message) }
    return data.data
  } catch (err) {
    errored = true;
    throw err;
  } finally {
    try { codexMetricsKv?.trackQuery(operation, Date.now() - startTime, errored, 'prod-research'); } catch {}
  }
}

function parseSymbol(symbolRaw, reqNetworkId) {
  if (!symbolRaw) return { address: null, networkId: null }
  if (symbolRaw.includes(':')) {
    const [addr, net] = symbolRaw.split(':')
    return { address: addr, networkId: parseInt(net) || 1 }
  }
  if (symbolRaw.startsWith('0x') || symbolRaw.length >= 32) {
    return { address: symbolRaw, networkId: parseInt(reqNetworkId) || 1 }
  }
  return { address: null, networkId: null }
}

const RES_MAP = {
  '1S': '1S', '1': '1', '5': '5', '15': '15', '30': '30',
  '60': '60', '240': '240', '720': '720',
  'D': '1D', '1D': '1D', 'W': '7D', '1W': '7D',
}

const ALLOWED_ORIGINS = [
  'http://localhost:5180',
  'http://localhost:5181',
  'http://localhost:5182',
  'https://spectreai.io',
  'https://app.spectreai.io',
  'https://research.spectreai.io',
  'https://trade.spectreai.io',
  'https://spectre-app-research.vercel.app',
  'https://spectre-trading.vercel.app',
]

function isAllowedOrigin(origin) {
  if (!origin) return false
  if (ALLOWED_ORIGINS.includes(origin)) return true
  // Allow Vercel preview deploys for the two app projects
  if (/^https:\/\/spectre-app-research-[\w-]+\.vercel\.app$/.test(origin)) return true
  if (/^https:\/\/spectre-trading-[\w-]+\.vercel\.app$/.test(origin)) return true
  return false
}

export default async function handler(req, res) {
  const origin = req.headers?.origin || ''
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Origin', isAllowedOrigin(origin) ? origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // PR1 (2026-06-04, Codex cost war): drop bucket cap from 120 → 60 req/min
  // per IP. Combined with `RATELIMIT_USE_KV=1` (project env), this prevents
  // cold-start lambda rotation from multiplying the effective bucket.
  if (await rateLimit(req, res, { bucket: 'bars', max: 60, windowMs: 60_000 })) return

  const { symbol, from, to, resolution = '60', networkId: reqNetworkId } = req.query
  let reqCgId = req.query.cgId || null
  // Live-quote reference for the dead/wrong-pair gate below. Optional; sent by
  // the research TVA datafeed (rounded to 2 significant digits client-side so
  // the URL — and with it the CDN cache key — stays stable across small ticks).
  const refPrice = Number(req.query.refPrice) || null
  if (!symbol || !from || !to) {
    return res.status(400).json({ error: 'Missing required parameters: symbol, from, to' })
  }
  if (!CODEX_API_KEY) {
    return res.status(502).json({ error: 'CODEX_API_KEY not configured' })
  }

  // Monday-anchored weekly aggregation. Shared by the GeckoTerminal and Codex
  // tiers — neither upstream serves real weekly bars (GT's day timeframe only
  // accepts aggregate=1; Codex 7D returns sparse/broken DEX data), so both
  // fetch 1D and roll up here.
  const aggregateWeekly = (dailyBars) => {
    const weeks = new Map()
    for (const b of dailyBars) {
      const d = new Date(b.t * 1000)
      const day = d.getUTCDay()
      const mondayMs = d.getTime() - ((day === 0 ? 6 : day - 1) * 86400000)
      const weekKey = Math.floor(mondayMs / 1000 / 86400) * 86400
      if (!weeks.has(weekKey)) {
        weeks.set(weekKey, { t: weekKey, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })
      } else {
        const w = weeks.get(weekKey)
        w.h = Math.max(w.h, b.h)
        w.l = Math.min(w.l, b.l)
        w.c = b.c
        w.v += b.v
      }
    }
    return [...weeks.values()].sort((a, b) => a.t - b.t)
  }

  const { address, networkId: parsedNet } = parseSymbol(symbol, reqNetworkId)
  // Plain tickers (no address form) are STILL servable: Binance covers
  // CEX-listed pairs and the Hetzner candle store resolves bare symbols
  // case-insensitively across ~40K registered assets (HYPE, XMR, TAO...).
  // Only the address-bound tiers (GeckoTerminal, Codex) are skipped for them.
  // Previously this early-returned { bars: [] }, which made chart mode
  // availability look random per token (2026-06-10 unify fix).
  const isPlainTicker = !address

  const isSolana = !isPlainTicker && !address.startsWith('0x') && address.length >= 32
  const networkId = isSolana && parsedNet === 1 ? 1399811149 : (parsedNet || parseInt(reqNetworkId) || 1)
  const formatted = isPlainTicker ? null : (isSolana ? address : address.toLowerCase())
  const requestedRes = RES_MAP[resolution] || resolution
  // For weekly: Codex 7D returns sparse/broken DEX data. Fetch 1D and aggregate.
  const isWeekly = requestedRes === '7D'
  const codexRes = isWeekly ? '1D' : requestedRes
  const tokenSymbol = isPlainTicker ? String(symbol).toUpperCase() : `${formatted}:${networkId}`

  // Resolve cgId from the address when the client didn't pass one, so the
  // GeckoTerminal head-stitch can backfill genesis history for CG-listed
  // tokens (see _resolveAddrCgId above). Only fills a missing value - an
  // explicit ?cgId= always wins.
  if (!reqCgId && !isPlainTicker) reqCgId = _resolveAddrCgId(formatted, networkId)

  // ── Window normalization (2026-06-11): `from=0` killed every tier.
  // TradingView's thin-token wide probe (and scroll-to-genesis) sends from=0;
  // the tier helpers' falsy-zero guards treated it as "missing param" and
  // self-disabled, then the Codex tier sent the unbounded 0→now window (a
  // ~490K-bar ask Codex answers with no_data) → { bars: [] } → blank pane.
  // Clamp any invalid/zero/too-wide window to "the last N bars before `to`":
  // a wide probe degrades to the deepest recent window every tier can serve
  // (Binance caps at 1000 bars, GT pages backward from `to`) instead of empty.
  // Resolution-aware wide-probe span. 1m is structurally Codex (CoinGecko Lite
  // can't serve sub-30m) and Codex is SLOW at the finest grain - a 1500-bar 1m
  // window is 25h of the slowest series and measured ~8s cold. Narrow the FIRST
  // window for fine resolutions (720 bars = 12h at 1m, 1000 = ~3.5d at 5m); the
  // datafeed lazily pages older history on scroll-back, so this only shifts where
  // lazy paging begins - same Codex call count, far less span per cold fetch.
  const MAX_WINDOW_BARS = codexRes === '1' ? 720 : (codexRes === '5' ? 1000 : 1500)
  // Keyed off the REQUESTED resolution: weekly fetches 1D upstream (isWeekly)
  // but a 1W window must be classified in WEEKS - using the 1D interval made
  // every >1500-day weekly window a "wide probe" (2026-06-11 audit).
  const intervalSec = (isWeekly ? 604800 : _BARS_BUCKET_SEC[codexRes]) || 3600
  let toSec = parseInt(to)
  if (!Number.isFinite(toSec) || toSec <= 0) toSec = Math.floor(Date.now() / 1000)
  let fromSec = parseInt(from)
  // CODEX DATAPOINT CAP (2026-08-11, PAAL "разрыв" repro). getTokenBars counts
  // an explicit [from..to] window INCLUSIVELY: a span of N buckets is N+1
  // datapoints, and >1500 datapoints is a HARD error ("Too wide of range for
  // given resolution. Datapoints requested: 1501. Max datapoints returned is
  // 1500."), not a truncation. The old `>` test let a window of EXACTLY
  // MAX_WINDOW_BARS buckets through verbatim (1501 datapoints) -> tier 'error',
  // zero bars, and the chart carries a hole exactly where that page belonged.
  // Wide probes are safe (they send `countback`, which Codex shapes instead of
  // rejecting), so classify the boundary window as WIDE.
  const spanDatapoints = Number.isFinite(fromSec) && fromSec > 0
    ? Math.floor((toSec - fromSec) / intervalSec) + 1
    : Infinity
  const wideProbe = !Number.isFinite(fromSec) || fromSec <= 0 ||
    (toSec - fromSec) > MAX_WINDOW_BARS * intervalSec ||
    spanDatapoints > CODEX_MAX_DATAPOINTS
  if (wideProbe) fromSec = toSec - MAX_WINDOW_BARS * intervalSec

  // Client-requested deep page (chart scroll-back + the GMGN-depth background
  // fill ask for countback=1500). Hard-capped; only >500 changes behavior, so
  // sparklines / boot probes stay on the cheap 500-bar default. Applies to the
  // wide-probe (countback) path only - verbatim windows are already bounded.
  const reqDeepCb = Math.min(1500, Math.max(0, parseInt(req.query.countback, 10) || 0))
  const deepCb = wideProbe && reqDeepCb > 500 ? reqDeepCb : 0

  // ── L4-PR4 (2026-06-03): Binance-first for any token with a Binance USDT
  // pair. `getBars` was 45% of total Codex bill (598K ops/day on Jun 2).
  // Major tokens (BTC, ETH, SOL, top-50) get clean, real-time klines for free.
  // Long-tail DEX tokens (no Binance pair) fall through to Codex below.
  //
  // Cache key includes `:binance` so a token newly listed on Binance won't
  // serve a stale Codex entry from before the listing. Symmetric for Codex
  // keys below (`:codex`). Cache invalidation by source tag is cheap insurance.
  const binancePair = lookupBinancePair(symbol, reqCgId, address)

  // ── CEX VENUE MAP (2026-08-27) ────────────────────────────────────────────
  // HOLES ONLY. Consulted only when the hand-written token-registry did NOT
  // resolve a Binance pair, so no chart that renders today can change. Keyed
  // by cgId, never by ticker. KV-cached 7 days; a cold miss costs one
  // CoinGecko call (~400ms) behind a 1.2s timeout, and a miss falls through
  // to exactly today's behaviour. Kill switch: CEX_VENUE_MAP=0.
  // See .claude/rules/cex-venue-map-plan.md.
  const cexVenue = (!binancePair && reqCgId && process.env.CEX_VENUE_MAP !== '0')
    ? await resolveCexVenue(reqCgId)
    : null

  const bucketSec = _BARS_BUCKET_SEC[codexRes] || 3600
  // Cache identity MUST include the request window (2026-06-10): the key used
  // to bucket only `to`, so a short-window fetch (e.g. the default 120-day 1W
  // load) poisoned the entry and a later full-history ALL fetch with the same
  // `to` got the short response back — charts truncated "randomly" depending
  // on which window landed first. `fromBucket` separates the windows.
  const bucket = Math.floor(toSec / bucketSec)
  // Wide probes share one sentinel key per token+res+toBucket: their clamped
  // `from` jitters with `to`, which would otherwise fragment the cache.
  // Deep pages get their own KV identity - a 500-bar wide entry must never be
  // served for a 1500-bar ask (and vice versa).
  const fromBucket = wideProbe ? (deepCb ? 'wide' + deepCb : 'wide') : Math.floor(fromSec / bucketSec)
  // TTL cap (2026-06-10): TTL=bucketSec froze 1D bars for 24h (and weekly
  // windows likewise) — the live candle never moved. Binance/Hetzner/GT are
  // free upstreams; KV is only a hot-path accelerator there, so 5 min max.
  // Codex stays cost-shielded at up to 1h.
  const freeTierTtl = Math.min(bucketSec, 300)
  const codexTierTtl = Math.min(bucketSec, 3600)

  // CODEX-FIRST FOR DEX (2026-06-15, chart-speed): default ON for address
  // tokens. Codex is the canonical, fast (<1s) DEX bars source; the
  // GeckoTerminal-first tier (added to cut the Codex bill) costs 4-8s for thin
  // tokens — two sequential 4s-timeout calls (pools + ohlcv) — which dominated
  // chart cold-load. Skipping the store + GT tiers lets Codex getTokenBars serve
  // DEX tokens directly. Binance still owns majors above (free, real-time); the
  // KV cache + PRO_CODEX_DISABLED kill switch still apply; GeckoTerminal stays a
  // fallback when Codex is empty (brand-new token — see the codex tier below).
  // Cost is contained by the shared :codex KV cache + the small first window.
  // Kill switch: CODEX_FIRST_BARS=0 reverts to the GT-first cost-saving order.
  const codexFirst = process.env.CODEX_FIRST_BARS !== '0' && !isPlainTicker

  // KV cache key for the Codex tier. Bucket `to` by the resolution's candle
  // interval so every user viewing this token+timeframe in the same window
  // shares one getBars. `:codex` suffix mirrors the `:binance` key.
  // Pair-pin-eligible requests (CG-listed address tokens outside the terminal
  // lane — see codexQuerySymbol) get their own `:codexp` suffix: their payload
  // is the PINNED pool's tape, which must never be served from / written into
  // the token-form cache the terminal (src=codex) and degen lanes share.
  const _pinEligible = !isPlainTicker && !!reqCgId && req.query.src !== 'codex'
  const codexKvKey = `codex:bars:${tokenSymbol}:${requestedRes}:${fromBucket}:${bucket}:${_pinEligible ? 'codexp' : 'codex'}`

  // Codex pair pin (see _resolveCodexPin above): CG-listed address tokens
  // query getBars on GT's deepest base-side pool instead of the token-form
  // getTokenBars aggregate. Lazy — only resolved when a Codex query actually
  // runs — and memoized per request so all three query sites (main window,
  // genesis head, hole refill) use ONE consistent symbol. The terminal's
  // src=codex path keeps the token-form query untouched (Step 9 precedent:
  // the terminal deliberately shows Codex's own token tape).
  let _pinPromise = null
  const codexPinInfo = () => {
    if (isPlainTicker || !reqCgId || req.query.src === 'codex') {
      return Promise.resolve({ querySymbol: tokenSymbol, pinned: false, createdAt: null })
    }
    if (!_pinPromise) {
      _pinPromise = _resolveCodexPin(formatted, networkId)
        .then(pin => (pin
          ? { querySymbol: `${pin.pool}:${networkId}`, pinned: true, createdAt: pin.createdAt }
          : { querySymbol: tokenSymbol, pinned: false, createdAt: null }))
        .catch(() => ({ querySymbol: tokenSymbol, pinned: false, createdAt: null }))
    }
    return _pinPromise
  }
  const codexQuerySymbol = () => codexPinInfo().then(p => p.querySymbol)

  // Codex builder runs the fetch + shaping. Explicit windows pass through
  // verbatim; wide probes (clamped above) ALSO send countback so a thin token
  // whose last trade predates the clamped window still returns its most recent
  // bars instead of no_data. Returns { bars, source:'codex' }.
  const buildCodex = async () => {
    // Absolute epoch floor (Jan 1 2017 UTC): no Codex/DEX token has OHLCV before
    // it. TradingView's cold scroll-back fires pre-genesis windows back to ~2005,
    // each a BILLED empty getTokenBars round-trip. Skip Codex for such windows -
    // zero data loss, kills the cascade's Codex-billing leak regardless of client.
    if (Number.isFinite(toSec) && toSec < 1483228800) return { bars: [] }
    // Pinned form queries getBars on the explicit pool, aliased back to
    // getTokenBars so the response mapping below is shared. quoteToken is
    // omitted on purpose — the pin guarantees our token is the pool's base,
    // and Codex infers the base side automatically.
    const querySymbol = await codexQuerySymbol()
    const qField = querySymbol === tokenSymbol ? 'getTokenBars' : 'getTokenBars: getBars'
    const result = await executeCodexQuery(
      wideProbe
        ? `query($symbol:String!,$from:Int!,$to:Int!,$resolution:String!,$countback:Int){
            ${qField}(symbol:$symbol,from:$from,to:$to,resolution:$resolution,countback:$countback,removeLeadingNullValues:true,removeEmptyBars:true){s o h l c t volume}
          }`
        : `query($symbol:String!,$from:Int!,$to:Int!,$resolution:String!){
            ${qField}(symbol:$symbol,from:$from,to:$to,resolution:$resolution,removeLeadingNullValues:true,removeEmptyBars:true){s o h l c t volume}
          }`,
      {
        symbol: querySymbol,
        from: fromSec,
        to: toSec,
        resolution: codexRes,
        ...(wideProbe ? { countback: deepCb || 500 } : {}),
      },
    )

    const bd = result?.getTokenBars
    if (!bd || bd.s === 'no_data' || !bd.t?.length) return { bars: [] }

    let bars = bd.t
      .map((t, i) => ({
        t,
        o: bd.o[i],
        h: bd.h[i],
        l: bd.l[i],
        c: bd.c[i],
        v: parseFloat(bd.volume?.[i]) || 0,
      }))
      .filter(b =>
        Number.isFinite(b.o) && Number.isFinite(b.h) &&
        Number.isFinite(b.l) && Number.isFinite(b.c) &&
        b.o >= 0 && b.h >= 0 && b.l >= 0 && b.c >= 0 &&
        b.h < 1e12
      )
      .sort((a, b) => a.t - b.t)

    // GENESIS HEAD (2026-08-11, "у DexScreener график с 19 декабря, у нас с 20").
    // getTokenBars DROPS a token's very first bucket on an EXPLICIT window:
    // PALM asked from 2023-11-01 answers from 2023-12-20, while the countback
    // shape of the SAME series starts 2023-12-19 with a real open (0.09549 ->
    // 0.16326, the launch candle). removeLeadingNullValues makes no difference -
    // it is the window form. Scroll-back pages are explicit windows, so every
    // token lost its first candle at the far left of the chart. When the answer
    // starts materially later than the requested `from` we have reached the
    // token's start; one small countback probe anchored just before that first
    // bar recovers the head. Never runs on a wide probe (countback already
    // includes it), never on a window that didn't reach genesis, and the result
    // rides the same KV entry as the page.
    if (!wideProbe && bars.length > 0 && (bars[0].t - fromSec) > intervalSec) {
      try {
        const headResult = await executeCodexQuery(
          `query GetTokenBarsHead($symbol:String!,$from:Int!,$to:Int!,$resolution:String!,$countback:Int){
            ${qField}(symbol:$symbol,from:$from,to:$to,resolution:$resolution,countback:$countback,removeLeadingNullValues:true,removeEmptyBars:true){o h l c t volume}
          }`,
          { symbol: querySymbol, from: fromSec, to: bars[0].t - 1, resolution: codexRes, countback: GENESIS_HEAD_COUNTBACK },
        )
        const hd = headResult?.getTokenBars
        if (hd?.t?.length > 0) {
          const cutoff = bars[0].t
          const head = hd.t
            .map((t, i) => ({ t, o: hd.o[i], h: hd.h[i], l: hd.l[i], c: hd.c[i], v: parseFloat(hd.volume?.[i]) || 0 }))
            .filter(b => b.t < cutoff && b.t >= fromSec &&
              Number.isFinite(b.o) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c) &&
              b.o >= 0 && b.h >= 0 && b.l >= 0 && b.c >= 0 && b.h < 1e12)
            .sort((a, b) => a.t - b.t)
          if (head.length > 0) bars = head.concat(bars)
        }
      } catch (e) {
        console.warn(`[bars] genesis head probe ${tokenSymbol} ${codexRes}: ${e.message}`)
      }
    }

    if (isWeekly) bars = aggregateWeekly(bars)

    return { bars, source: 'codex' }
  }

  // Explicit-window Codex fetch for the interior-hole refill (bars-router
  // tryCodex, see bars-hole-fill.js). Same query/mapping as the non-wide
  // buildCodex shape; returns a plain bars array (no KV, no shaping side
  // effects - the router merges and persists). Never on weekly (raw daily
  // bars must not merge into an aggregated series - the router guards too).
  const fetchCodexWindow = async (fromS, toS) => {
    const querySymbol = await codexQuerySymbol()
    const qField = querySymbol === tokenSymbol ? 'getTokenBars' : 'getTokenBars: getBars'
    const result = await executeCodexQuery(
      `query GetTokenBarsHole($symbol:String!,$from:Int!,$to:Int!,$resolution:String!){
        ${qField}(symbol:$symbol,from:$from,to:$to,resolution:$resolution,removeLeadingNullValues:true,removeEmptyBars:true){o h l c t volume}
      }`,
      { symbol: querySymbol, from: fromS, to: toS, resolution: codexRes },
    )
    const bd = result?.getTokenBars
    if (!bd?.t?.length) return []
    return bd.t
      .map((t, i) => ({ t, o: bd.o[i], h: bd.h[i], l: bd.l[i], c: bd.c[i], v: parseFloat(bd.volume?.[i]) || 0 }))
      .filter(b =>
        Number.isFinite(b.o) && Number.isFinite(b.h) &&
        Number.isFinite(b.l) && Number.isFinite(b.c) &&
        b.o >= 0 && b.h >= 0 && b.l >= 0 && b.c >= 0 && b.h < 1e12)
      .sort((a, b) => a.t - b.t)
  }

  // Shared tier context. Tier functions (bars-router.js) read everything they
  // need from here and own their own KV read/write so the cache contract is
  // unchanged. `budget` is set by the codex tier for the response header.
  const isSubFiveMin = ['1S', '1', '5'].includes(requestedRes)
  const ctx = {
    symbol, address, isPlainTicker, isSolana, networkId,
    requestedRes, codexRes, isWeekly, isSubFiveMin,
    tokenSymbol, reqCgId,
    fromSec, toSec, wideProbe, bucket, fromBucket,
    binancePair, cexVenue, bucketSec, freeTierTtl, codexTierTtl, codexKvKey,
    aggregateWeekly, buildCodex, fetchCodexWindow,
    // Terminal (src=codex) shows the pool's own candles only - see the
    // skipCgHeadStitch note in bars-router.js tryGeckoTerminal. Research never
    // sends src=codex, so its multi-source cascade keeps the stitch.
    skipCgHeadStitch: req.query.src === 'codex',
    inflight: _barsInflight,
    budget: null,
  }

  // ── QUOTE-AGREEMENT GATE (2026-08-24, ZIG incident) ─────────────────────
  // A tape whose newest close contradicts the token's LIVE quote is not this
  // token's market: ZIG has ~20 Uniswap v3 dust pools pinned at the June price
  // ($0.054-0.060 vs the real $0.040 market), and Codex's per-request pair
  // pick occasionally lands on one — months of near-flat dust bars rendered
  // as the chart, with the KV + TradingView caches then pinning it. The gate
  // rejects such a payload so the cascade falls through to the next source
  // (GT picks the deepest pool; cg-ohlc is cgId-keyed aggregate and needs no
  // gate). Thresholds are generous — a REAL tape's newest bar includes trades
  // up to now, so honest disagreement stays small even on volatile tokens;
  // daily/weekly bars can legitimately lag further, hence the looser bound.
  // No refPrice (canvas chart, terminal, old clients) → gate inert.
  const QUOTE_GATE_LIMIT = (requestedRes === '1D' || requestedRes === '7D') ? 2.0 : 1.35
  // The gate compares a payload's NEWEST close against the LIVE quote, so it
  // is only meaningful for windows that end at the live edge. A scroll-back
  // window's last bar is old by construction and legitimately disagrees with
  // today's price — measured 2026-08-25: GT's CORRECT March tape for ZIG
  // (last=0.0305 vs live 0.042 = 1.38x) was rejected here, pushing the window
  // to cg-ohlc, whose aggregate for ZIG is dust-poisoned (0.031-0.056 mixed
  // while MEXC traded flat 0.031). Historical windows from the deepest-pool
  // tiers (GT, pinned Codex) serve ungated; the token-form Codex aggregate
  // keeps the gate everywhere (no pin = no pair guarantee).
  const quoteGateApplies = toSec >= Math.floor(Date.now() / 1000) - 2 * intervalSec
  const quoteAgrees = (payload) => {
    if (!(refPrice > 0)) return true
    const gbars = payload?.bars
    const last = gbars?.[gbars.length - 1]?.c
    if (!(last > 0)) return true
    const ratio = last > refPrice ? last / refPrice : refPrice / last
    return ratio <= QUOTE_GATE_LIMIT
  }
  let quoteGateRejected = false
  const logQuoteReject = (tierName, payload) => {
    quoteGateRejected = true
    const gbars = payload?.bars || []
    console.warn(`[bars-gate] ${tokenSymbol} ${requestedRes}: ${tierName} last=${gbars[gbars.length - 1]?.c} vs refPrice=${refPrice} — rejected (dead/wrong pair guard)`)
  }

  // HETZNER BACKGROUND-ONLY (charts-v2): serving from the candle store is now
  // opt-in via HETZNER_BARS_SERVE=1 (AND L4_PR5_DISABLE_HETZNER_BARS!=='1').
  // When serving is OFF we still fire a NON-AWAITED warm ping for address
  // tokens so the store's auto-registration + permanent backfill + freshness
  // tracking keep running (it stays the deep-history DB and re-earns serving
  // via the health sweeper). 9/12 recent chart incidents were store-serving
  // issues, so ingestion is decoupled from the read path. Applies in BOTH the
  // legacy and smart-router paths.
  const hetznerServe = process.env.HETZNER_BARS_SERVE === '1'
    && process.env.L4_PR5_DISABLE_HETZNER_BARS !== '1'
  if (!hetznerServe) warmHetznerStore(ctx)

  try {
    // ── TRADING-ONLY: Codex-only bars (src=codex) ─────────────────────────
    // The Trading Platform token page sends &src=codex so its chart sources
    // candles from Codex FIRST — no Binance/Hetzner/cg-ohlc — for one
    // consistent DEX-native source. Research never sends the flag, so the
    // multi-source cascade below is untouched. ONE fallback: when Codex has
    // ZERO bars for the token (older DEX tokens Codex doesn't index — CULT's
    // 2022 Uniswap pair rendered a blank chart while GeckoTerminal had full
    // candles), the FREE GeckoTerminal tier runs before giving up. Codex-
    // covered tokens never reach it, so metered spend is unchanged.
    if (req.query.src === 'codex' && process.env.PRO_CODEX_DISABLED !== '1') {
      const payload = await runTier('codex', ctx)
      if (payload?.bars?.length > 0) return writeBarsPayload(res, payload, ctx)
      if (process.env.L4_PR8_DISABLE_GECKOTERMINAL !== '1') {
        const gt = await runTier('geckoterminal', ctx)
        if (gt?.bars?.length > 0) return writeBarsPayload(res, gt, ctx)
      }
      // Codex ERRORED (vs proved-empty): answer tier 'error' + no-store, never
      // 'no_data' - the TV datafeed treats no_data as terminal genesis and a
      // timeout must not truncate the token's history for the whole session.
      if (payload?.failed) {
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('CDN-Cache-Control', 'no-store')
        if (ctx.budget) res.setHeader('X-Spectre-Budget', ctx.budget)
        res.setHeader('X-Spectre-Tier', 'error')
        return res.status(200).json({ bars: [], failed: true })
      }
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60')
      if (ctx.budget) res.setHeader('X-Spectre-Budget', ctx.budget)
      res.setHeader('X-Spectre-Tier', 'no_data')
      return res.status(200).json({ bars: [] })
    }

    // ── LITE on-chain: GeckoTerminal-first pin (src=gt) ────────────────────
    // The LITE research/cinema views chart on-chain tokens from GeckoTerminal
    // pools directly (loadOnchainWindow), but their TradingView tab rode this
    // cascade — whose answering tier is environment-dependent (dev tends to
    // get the gap-filled GT series, prod often gets sparse raw Codex; see
    // rz-chart-audit-plan §A3). Result: Line/Candles and TradingView on ONE
    // card drew different tapes. `src=gt` pins GT first so all three chart
    // modes read the same pool series. FAIL-SOFT by design: a GT miss (no
    // pool, 429 on a keyless prod, timeout) falls through to the normal
    // cascade below — behavior degrades to exactly today's, never to blank.
    if (req.query.src === 'gt' && !isPlainTicker
        && process.env.L4_PR8_DISABLE_GECKOTERMINAL !== '1') {
      const gt = await runTier('geckoterminal', ctx)
      if (gt?.bars?.length > 0) return writeBarsPayload(res, gt, ctx)
      // Miss — mark the tier spent so the cascade below can't re-pay the GT
      // round-trip (up to two 4s timeouts) on the same request.
      ctx.gtExhausted = true
    }

    // ── SMART ROUTER (opt-in via SMART_BARS_ROUTER=1) ──────────────────────
    if (process.env.SMART_BARS_ROUTER === '1') {
      const tokenClass = classifyTokenClass(ctx)
      const tierEnv = {
        codexFirst,
        proCodexOff: process.env.PRO_CODEX_DISABLED === '1',
        hetznerServe,
        gtOff: process.env.L4_PR8_DISABLE_GECKOTERMINAL === '1',
        // Degens default to GeckoTerminal-first (CG-family before metered
        // Codex). DEGEN_CODEX_FIRST=1 reverts to the old Codex-first order.
        degenCodexFirst: process.env.DEGEN_CODEX_FIRST === '1',
        hasCexVenue: !!ctx.cexVenue,
      }
      const tiers = buildTierList(tokenClass, tierEnv)
      let anyFailed = false
      for (const name of tiers) {
        const payload = await runTier(name, ctx)
        if (payload?.bars?.length > 0) return writeBarsPayload(res, payload, ctx)
        if (payload?.failed) anyFailed = true
      }
      // A tier ERRORED on the way to empty -> 'error', not terminal 'no_data'.
      if (anyFailed) {
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('CDN-Cache-Control', 'no-store')
        if (ctx.budget) res.setHeader('X-Spectre-Budget', ctx.budget)
        res.setHeader('X-Spectre-Tier', 'error')
        return res.status(200).json({ bars: [], failed: true })
      }
      // Empty list (e.g. PRO_CODEX_DISABLED stripped the only Codex-class tier)
      // or every tier empty → no_data. Preserve the legacy no_data headers used
      // by the plain-ticker / kill-switch early returns.
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60')
      if (ctx.budget) res.setHeader('X-Spectre-Budget', ctx.budget)
      res.setHeader('X-Spectre-Tier', 'no_data')
      return res.status(200).json({ bars: [] })
    }

    // ── LEGACY ORDER (flag off — preserved EXACTLY) ───────────────────────
    // Binance first (any token with a Binance pair).
    if (binancePair) {
      const payload = await runTier('binance', ctx)
      if (payload?.bars?.length > 0) return writeBarsPayload(res, payload, ctx)
      // Fall through to Hetzner / Codex if Binance returned no usable data.
    }

    // CEX venue map — same position in the order as Binance, reached only when
    // Binance did not own the token. Mirrors the smart path's prepend.
    if (!binancePair && ctx.cexVenue) {
      const payload = await runTier('cex', ctx)
      if (payload?.bars?.length > 0) return writeBarsPayload(res, payload, ctx)
      // Fall through to Hetzner / GeckoTerminal / Codex exactly as before.
    }

    // ── L4-PR5 (2026-06-03): Hetzner candles_1m for DEX tokens not on Binance.
    // Serving is now gated by HETZNER_BARS_SERVE (background-only by default).
    // The codexFirst skip is preserved. The warm ping already fired above.
    if (hetznerServe && !codexFirst) {
      const payload = await runTier('hetzner', ctx)
      if (payload?.bars?.length > 0) return writeBarsPayload(res, payload, ctx)
      // Fall through to GeckoTerminal / Codex if Hetzner returned no data.
    }

    // Plain tickers have no contract address — GeckoTerminal and Codex are
    // address-bound. With a cgId we can still serve CG-listed CEX-only alts
    // from CoinGecko's paid OHLC endpoints (charts-v2 Phase 1 — this class,
    // ~90% of the listed universe, previously returned an empty chart here).
    if (isPlainTicker) {
      if (reqCgId) {
        const payload = await tryCgOhlc(ctx)
        if (payload?.bars?.length > 0) return writeBarsPayload(res, payload, ctx)
      }
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60')
      res.setHeader('X-Spectre-Tier', 'no_data')
      return res.status(200).json({ bars: [] })
    }

    // ── L4-PR8 (2026-06-03): GeckoTerminal DEX OHLCV as Tier 2.5.
    // Closes the long-tail DEX-token gap. Kill switch: L4_PR8_DISABLE_GECKOTERMINAL=1.
    // 2026-06-18: also run GT FIRST for CG-LISTED tokens (reqCgId) even under
    // codexFirst. GT's raw DEX-swap OHLC is far fuller than CoinGecko's smoothed
    // hourly (SPECTRE 1H: GT ~5% flat candles vs cg-ohlc 43% = the "not filled
    // candles" report). GT is FREE so this is Codex-NEUTRAL; cg-ohlc below stays
    // the reliable fallback if GT misses. Pure-degen (no cgId) under codexFirst
    // still goes Codex-first (GT only as the line ~462 fallback).
    if ((!codexFirst || reqCgId) && process.env.L4_PR8_DISABLE_GECKOTERMINAL !== '1') {
      const payload = await runTier('geckoterminal', ctx)
      if (payload?.bars?.length > 0) {
        if (!quoteGateApplies || quoteAgrees(payload)) return writeBarsPayload(res, payload, ctx)
        // Deepest pool contradicts the live quote (CEX-priced token whose DEX
        // pools are remnants) — fall through to cg-ohlc, the CEX aggregate.
        // Live-edge windows only: see quoteGateApplies above.
        logQuoteReject('geckoterminal', payload)
      }
      // Fall through to cg-ohlc / Codex if GeckoTerminal returned no usable data.
    }

    // ── PINNED POOL BEFORE cg-ohlc (2026-08-25, ZIG March-window report) ──
    // CoinGecko's own aggregate can be poisoned by the same dust pools the
    // quote gate exists for: measured Mar 23-27 ZIG, MEXC (the real market)
    // traded a flat 0.0298-0.0328 while CG's market_chart oscillated
    // 0.031-0.056 — and cg-ohlc faithfully served that garbage for deep
    // windows GT's hourly retention can't reach. The pinned pool's Codex tape
    // for the same window measured 0.0300-0.0328 (= MEXC). So for
    // pin-eligible tokens, windows the pool was ALIVE for prefer the pool's
    // own tape over CG's aggregate; cg-ohlc remains the source for the
    // pre-pool era (its original head-stitch purpose) and the fallback when
    // Codex misses. The createdAt guard keeps billed guaranteed-empty getBars
    // off the pre-pool scroll-back path (§11 firehose class).
    // Gate note: a pinned payload needs no quote-agreement check on
    // HISTORICAL windows — the pin already guarantees the right pair, and an
    // old close legitimately disagrees with the live quote (the documented
    // scroll-back false-reject). Live-edge windows keep the gate: a pool can
    // go dust within the pin's 7d KV life.
    let _earlyCodexPayload = null
    let _earlyCodexRan = false
    if (_pinEligible && process.env.PRO_CODEX_DISABLED !== '1') {
      const pin = await codexPinInfo()
      if (pin.pinned && (!pin.createdAt || toSec > pin.createdAt)) {
        _earlyCodexPayload = await runTier('codex', ctx)
        _earlyCodexRan = true
        if (_earlyCodexPayload?.bars?.length > 0) {
          if (!quoteGateApplies || quoteAgrees(_earlyCodexPayload)) {
            return writeBarsPayload(res, _earlyCodexPayload, ctx)
          }
          logQuoteReject('codex', _earlyCodexPayload)
        }
      }
    }

    // ── Tier 3.5 (charts-v2 Phase 1): CoinGecko paid OHLC for CG-listed tokens
    // whose pools GT couldn't serve. Runs BEFORE Codex because CG credits are
    // ample (Lite: 2M/mo) and Codex is the metered last resort.
    if (reqCgId) {
      const payload = await tryCgOhlc(ctx)
      if (payload?.bars?.length > 0) return writeBarsPayload(res, payload, ctx)
    }

    // PR1 (2026-06-04) Codex kill switch. Flipping `PRO_CODEX_DISABLED=1`
    // returns an empty bars payload immediately — free tiers above STILL run.
    if (process.env.PRO_CODEX_DISABLED === '1') {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60')
      res.setHeader('X-Spectre-Tier', 'no_data')
      return res.status(200).json({ bars: [] })
    }

    // Codex tier (budget-guarded + stale-mirror; in-flight dedup + KV write
    // all live in the tier function). Returns { bars, source:'codex' } | null.
    // Reuse the early pinned attempt's result — reaching here with it ran
    // means it was empty or live-window-disagreed; never bill a second query.
    const payload = _earlyCodexRan ? _earlyCodexPayload : await runTier('codex', ctx)
    const codexHasBars = payload?.bars?.length > 0
    const codexAgrees = codexHasBars && quoteAgrees(payload)
    if (codexHasBars && !codexAgrees) logQuoteReject('codex', payload)
    // GeckoTerminal fallback covers BOTH "Codex empty" (brand-new token not
    // indexed) and "Codex contradicts the live quote" (its per-request pair
    // pick landed on a dead/wrong pool — the ZIG dust-pool class). GT was
    // skipped above when codexFirst, so run it here instead of returning
    // empty/garbage. Rare path — the common case already returned from Codex.
    if ((codexFirst || codexHasBars) && !codexAgrees
        && process.env.L4_PR8_DISABLE_GECKOTERMINAL !== '1') {
      const gt = await runTier('geckoterminal', ctx)
      if (gt?.bars?.length > 0 && quoteAgrees(gt)) return writeBarsPayload(res, gt, ctx)
    }
    if (quoteGateRejected && !codexAgrees) {
      // Every trusted source either missed or contradicted the live quote
      // (covers both "codex disagreed" and "codex empty after GT was gated").
      // Serving the contradicting tape is exactly how dead dust pools reached
      // the screen. failed:true, NOT no_data — no_data is TERMINAL in the TV
      // datafeed contract (the widget stops asking), and refPrice itself can
      // be the stale side (frozen box quote class); a retry must stay possible.
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('CDN-Cache-Control', 'no-store')
      if (ctx.budget) res.setHeader('X-Spectre-Budget', ctx.budget)
      res.setHeader('X-Spectre-Tier', 'quote-mismatch')
      return res.status(200).json({ bars: [], failed: true })
    }
    return writeBarsPayload(res, payload, ctx)
  } catch (e) {
    console.error('[bars] tier cascade failed:', e.message)
    if (ctx.budget) res.setHeader('X-Spectre-Budget', ctx.budget)
    // An exception is a broken request, not proof of empty history - 'no_data'
    // here made chart pagers latch "history exhausted" on server blips.
    res.setHeader('X-Spectre-Tier', 'error')
    return res.status(200).json({ bars: [], failed: true })
  }
}
