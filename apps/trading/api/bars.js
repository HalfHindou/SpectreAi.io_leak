/**
 * Vercel Serverless Function - OHLCV Bars (trading app)
 * Proxies to the shared tier cascade in apps/trading/api/_lib/bars-router.js
 * (byte-identical to apps/research/api/_lib/bars-router.js — see
 * scripts/check-bars-parity.mjs). Returns rows [{ t, o, h, l, c, v }].
 *
 * This handler keeps the TRADING-app preamble exactly (CORS allowlist, auth-gate
 * 401, 180/min rate limit, codexMetricsKv tracking with the 'prod-trading' app
 * tag) and shares the router body + window normalization with research. With
 * SMART_BARS_ROUTER unset, the tiers run in the EXACT legacy order (zero
 * behavior change); with the flag set, buildTierList() picks an order by token
 * class.
 */

import { rateLimit } from './_lib/ratelimit.js'
import { isAuthGateValid, isDemoSession } from './auth-gate.js'
import { getJsonWithTTL, setJsonWithTTL } from './_lib/kv.js'
import { lookupBinancePair } from './_lib/binance-bars.js'
import {
  classifyTokenClass,
  buildTierList,
  runTier,
  warmHetznerStore,
  writeBarsPayload,
  tryCgOhlc,
} from './_lib/bars-router.js'
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
let codexMetricsKv = null;
try { codexMetricsKv = _require('../../../packages/server/lib/codex-metrics-kv'); } catch {}

// Address -> CoinGecko id resolver for the GeckoTerminal head-stitch.
// GT only carries the CURRENT pool's OHLCV, which often begins months after a
// token's genesis (SPECTRE's GT pool starts ~Jul 2024; the token launched
// Nov 2023). The bars-router head-stitch backfills that missing head from CG
// OHLC, but it was gated on the request carrying ?cgId= - and the chart's
// getBars (codexApi.getBars) never sends it. So every CG-listed DEX token
// silently lost its early history (the "first 5 months missing" report,
// 2026-06-14). Resolving cgId from the address here makes the stitch fire for
// any registry / EXTENDED_CG_TOKENS token regardless of the client. CG OHLC is
// free - zero Codex cost. Mirrors apps/research/api/_lib/handlers/bars.js.
let _addrCgIdMap = null;
function _resolveAddrCgId(address, networkId) {
  if (!address) return null;
  try {
    if (!_addrCgIdMap) {
      _addrCgIdMap = new Map();
      const reg = _require('../../../packages/server/lib/token-registry');
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

// Durable KV cache + per-lambda in-flight dedup for chart bars. This endpoint
// (TradingView datafeed OHLCV source) had only an s-maxage HTTP header, which
// Vercel's CDN ignores for cookie-bearing requests - so every chart load/poll/
// pan hit Codex fresh. getBars was 47% of all Codex usage on Jun 1. Cache by
// token+resolution+bucketed-time so concurrent viewers share one upstream call.
const _barsInflight = new Map()
const _BARS_BUCKET_SEC = { '1S': 5, '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, '240': 14400, '720': 43200, '1D': 86400, 'D': 86400, '1W': 604800, 'W': 604800 }

const CODEX_API_KEY = process.env.CODEX_API_KEY
const CODEX_URL = 'https://graph.codex.io/graphql'
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

const RES_MAP = { '1S': '1S', '1': '1', '5': '5', '15': '15', '30': '30', '60': '60', '240': '240', '720': '720', 'D': '1D', '1D': '1D', 'W': '7D', '1W': '7D' }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // 2026-05-11 lockdown: Codex bars quota. Accept the full gate OR the
  // read-only research "Trading Lite" embed demo session (2026-05-21).
  if (!isAuthGateValid(req) && !isDemoSession(req)) {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
  }

  // PR1 (2026-06-04, Codex cost war): dropped the cap 120 → 60 req/min per IP
  // during the incident. 2026-06-04 (token-page sweep): raised to 180. The 60
  // cap was 429-storming real chart loads - one token page fires initial bars +
  // a 5-chunk scroll pre-load + prefetchChartBars on init/select/hover across
  // watchlist tokens, easily bursting past 60 in the first seconds. The 429s
  // then starve the chart's own history chunks → slow load + gapped "broken"
  // candles. Bars are now free-tier-first (Binance/Hetzner/GeckoTerminal/KV)
  // with Codex behind PRO_CODEX_DISABLED, so this IP cap is abuse-prevention,
  // NOT Codex-cost control - 180/min fits a power user navigating + scrolling
  // several charts while still capping a runaway loop.
  if (await rateLimit(req, res, { bucket: 'bars', max: 180, windowMs: 60_000 })) return

  const { symbol, from, to, resolution = '60', networkId: reqNetworkId = '1' } = req.query
  let reqCgId = req.query.cgId || null
  if (!symbol || !from || !to) return res.status(400).json({ error: 'symbol, from, to required' })
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

  // ── Symbol parse (trading shape: bare address or address:networkId) ──
  let tokenAddress = symbol
  let parsedNet = parseInt(reqNetworkId) || 1
  if (symbol.includes(':')) {
    const parts = symbol.split(':')
    tokenAddress = parts[0]
    parsedNet = parseInt(parts[1]) || parsedNet
  }
  // Plain tickers (no address form) are STILL servable: Binance covers
  // CEX-listed pairs and the Hetzner candle store resolves bare symbols
  // case-insensitively. Only the address-bound tiers (GeckoTerminal, Codex)
  // are skipped for them.
  const isPlainTicker = !(tokenAddress.startsWith('0x') || tokenAddress.length >= 32)
  const address = isPlainTicker ? null : tokenAddress

  const isSolana = !isPlainTicker && !address.startsWith('0x') && address.length >= 32 && address.length <= 44
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
  // TradingView's thin-token wide probe sends from=0; the tier helpers'
  // falsy-zero guards treated it as "missing param" and self-disabled, then
  // Codex got the unbounded 0→now window → no_data → blank pane (the SPECTRE
  // Token Page repro). Clamp invalid/zero/too-wide windows to "the last N
  // bars before `to`" - mirrors apps/research bars.js.
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
  // MAX_WINDOW_BARS buckets through verbatim (1501 datapoints) - measured on
  // prod: countback=1400 -> 1401 bars, countback=1500 -> tier 'error', 0 bars,
  // three times running. The chart then carries a hole exactly where that page
  // should have landed. Wide probes are safe (they send `countback`, which
  // Codex shapes instead of rejecting), so the fix is to classify the boundary
  // window as WIDE and let the countback path serve it.
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

  const binancePair = lookupBinancePair(symbol, reqCgId, tokenAddress)
  const bucketSec = _BARS_BUCKET_SEC[codexRes] || 3600
  const bucket = Math.floor(toSec / bucketSec)
  // Window discriminator (2026-06-11): keys previously bucketed only `to`, so a
  // short-window fetch poisoned the entry for a later full-history fetch with
  // the same `to`. Wide probes share one sentinel key - their clamped `from`
  // jitters with `to`.
  // Deep pages get their own KV identity - a 500-bar wide entry must never be
  // served for a 1500-bar ask (and vice versa).
  const fromBucket = wideProbe ? (deepCb ? 'wide' + deepCb : 'wide') : Math.floor(fromSec / bucketSec)
  // TTL caps: free upstreams (Binance/Hetzner/GT/CG) get 5 min max; Codex stays
  // cost-shielded at up to 1h.
  const freeTierTtl = Math.min(bucketSec, 300)
  const codexTierTtl = Math.min(bucketSec, 3600)

  // CODEX-FIRST FOR DEX (2026-06-15, chart-speed): default ON for address
  // tokens. Codex is the canonical, fast (<1s) DEX bars source; the
  // GeckoTerminal-first tier costs 4-8s for thin tokens (two sequential
  // 4s-timeout calls), which dominated chart cold-load. Skipping store + GT lets
  // Codex serve DEX tokens directly. Binance still owns majors above; the KV
  // cache + PRO_CODEX_DISABLED kill switch still apply; GeckoTerminal stays a
  // fallback when Codex is empty (brand-new token — see codex tier below).
  // Kill switch: CODEX_FIRST_BARS=0 reverts to the GT-first cost-saving order.
  const codexFirst = process.env.CODEX_FIRST_BARS !== '0' && !isPlainTicker

  // TRADING TERMINAL = CODEX-ONLY BARS (Gleb, 2026-07-30).
  //
  // Degens were already Codex-first, but CG-LISTED tokens still ran GeckoTerminal
  // FIRST (and cg-ohlc after it), so every GT miss paid GT's full budget - a 4s
  // pool-lookup timeout plus a 6s paging cap - BEFORE Codex was even asked.
  // Measured on this box: Codex 543ms cold / 236ms warm, while GT cost ~1.4s to
  // return a WORSE series (STRAT: GT 31 bars vs Codex 222). The terminal is the
  // execution surface; it goes straight to the complete, fast source.
  //
  // EXCEPTION - Robinhood Chain (4663) has NO Codex coverage, so GT is its only
  // source. Excluding it here would blank every HOOD chart. It keeps today's
  // free-tier-first order untouched.
  //
  // The post-Codex GT fallback further below is deliberately KEPT: it only fires
  // when Codex returns nothing (brand-new token), so it costs zero on the happy
  // path and still saves the chart from rendering blank.
  const codexOnlyBars = networkId !== 4663

  // KV cache key for the Codex tier. `:codex` suffix mirrors the `:binance` key.
  const codexKvKey = `codex:bars:${tokenSymbol}:${requestedRes}:${fromBucket}:${bucket}:codex`

  // Codex builder runs the fetch + shaping with the TRADING 'prod-trading'
  // metrics tag. Explicit windows pass through verbatim; wide probes (clamped
  // above) ALSO send countback so a thin token whose last trade predates the
  // clamped window still returns its most recent bars. Returns { bars, source:'codex' }.
  const buildCodex = async () => {
    // Absolute epoch floor (Jan 1 2017 UTC): no Codex/DEX token has OHLCV before
    // it. TradingView's cold scroll-back fires pre-genesis windows back to ~2005,
    // each a BILLED empty getTokenBars round-trip. Skip Codex for such windows -
    // zero data loss, kills the cascade's Codex-billing leak regardless of client.
    if (Number.isFinite(toSec) && toSec < 1483228800) return { bars: [] }
    const query = wideProbe
      ? `query($symbol:String!,$from:Int!,$to:Int!,$resolution:String!,$countback:Int){
          getTokenBars(symbol:$symbol,from:$from,to:$to,resolution:$resolution,countback:$countback,removeLeadingNullValues:true,removeEmptyBars:true){s o h l c t volume}
        }`
      : `query($symbol:String!,$from:Int!,$to:Int!,$resolution:String!){
          getTokenBars(symbol:$symbol,from:$from,to:$to,resolution:$resolution,removeLeadingNullValues:true,removeEmptyBars:true){s o h l c t volume}
        }`
    const _startTime = Date.now()
    let _errored = false
    let resp, data
    try {
      resp = await fetch(CODEX_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': CODEX_API_KEY, 'Origin': CODEX_ORIGIN },
        body: JSON.stringify({ query, variables: { symbol: tokenSymbol, from: fromSec, to: toSec, resolution: codexRes, ...(wideProbe ? { countback: deepCb || 500 } : {}) } }),
        signal: AbortSignal.timeout(8000),
      })
      data = await resp.json()
      if (!resp.ok || data.errors) _errored = true
    } catch (err) {
      _errored = true
      throw err
    } finally {
      try { codexMetricsKv?.trackQuery('getTokenBars', Date.now() - _startTime, _errored, 'prod-trading') } catch {}
    }
    if (data.errors) {
      console.error('Codex bars error:', data.errors[0]?.message, { symbol: tokenSymbol, resolution: codexRes })
      throw new Error(data.errors[0]?.message || 'Codex error')
    }
    const bd = data.data?.getTokenBars
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
    // rides the same KV entry as the page - so it is one extra query per
    // token+resolution genesis page, not per request.
    if (!wideProbe && bars.length > 0 && (bars[0].t - fromSec) > intervalSec) {
      try {
        const headResp = await fetch(CODEX_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': CODEX_API_KEY, 'Origin': CODEX_ORIGIN },
          body: JSON.stringify({
            query: `query($symbol:String!,$from:Int!,$to:Int!,$resolution:String!,$countback:Int){
              getTokenBars(symbol:$symbol,from:$from,to:$to,resolution:$resolution,countback:$countback,removeLeadingNullValues:true,removeEmptyBars:true){o h l c t volume}
            }`,
            variables: { symbol: tokenSymbol, from: fromSec, to: bars[0].t - 1, resolution: codexRes, countback: GENESIS_HEAD_COUNTBACK },
          }),
          signal: AbortSignal.timeout(5000),
        })
        const headData = await headResp.json()
        const hd = headData?.data?.getTokenBars
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
    const _startTime = Date.now()
    let _errored = false
    try {
      const resp = await fetch(CODEX_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': CODEX_API_KEY, 'Origin': CODEX_ORIGIN },
        body: JSON.stringify({
          query: `query GetTokenBarsHole($symbol:String!,$from:Int!,$to:Int!,$resolution:String!){
            getTokenBars(symbol:$symbol,from:$from,to:$to,resolution:$resolution,removeLeadingNullValues:true,removeEmptyBars:true){o h l c t volume}
          }`,
          variables: { symbol: tokenSymbol, from: fromS, to: toS, resolution: codexRes },
        }),
        signal: AbortSignal.timeout(5000),
      })
      const data = await resp.json()
      if (!resp.ok || data.errors) { _errored = true; throw new Error(data.errors?.[0]?.message || `HTTP ${resp.status}`) }
      const bd = data.data?.getTokenBars
      if (!bd?.t?.length) return []
      return bd.t
        .map((t, i) => ({ t, o: bd.o[i], h: bd.h[i], l: bd.l[i], c: bd.c[i], v: parseFloat(bd.volume?.[i]) || 0 }))
        .filter(b =>
          Number.isFinite(b.o) && Number.isFinite(b.h) &&
          Number.isFinite(b.l) && Number.isFinite(b.c) &&
          b.o >= 0 && b.h >= 0 && b.l >= 0 && b.c >= 0 && b.h < 1e12)
        .sort((a, b) => a.t - b.t)
    } finally {
      // Distinct op label (matches research, whose named query yields the same
      // via _extractOp) so probe spend is separable on the Codex dashboard.
      try { codexMetricsKv?.trackQuery('GetTokenBarsHole', Date.now() - _startTime, _errored, 'prod-trading') } catch {}
    }
  }

  // Shared tier context. Tier functions (bars-router.js) read everything they
  // need from here and own their own KV read/write. `budget` is set by the
  // codex tier for the response header.
  const isSubFiveMin = ['1S', '1', '5'].includes(requestedRes)
  const ctx = {
    symbol, address, isPlainTicker, isSolana, networkId,
    requestedRes, codexRes, isWeekly, isSubFiveMin,
    tokenSymbol, reqCgId,
    fromSec, toSec, wideProbe, bucket, fromBucket,
    binancePair, bucketSec, freeTierTtl, codexTierTtl, codexKvKey,
    aggregateWeekly, buildCodex, fetchCodexWindow,
    // Terminal (src=codex) shows the pool's own candles only - see the
    // skipCgHeadStitch note in bars-router.js tryGeckoTerminal. Research never
    // sends src=codex, so its multi-source cascade keeps the stitch.
    skipCgHeadStitch: req.query.src === 'codex',
    inflight: _barsInflight,
    budget: null,
  }

  // HETZNER BACKGROUND-ONLY (charts-v2): serving from the candle store is now
  // opt-in via HETZNER_BARS_SERVE=1 (AND L4_PR5_DISABLE_HETZNER_BARS!=='1').
  // When serving is OFF we still fire a NON-AWAITED warm ping for address
  // tokens so the store's auto-registration + permanent backfill + freshness
  // tracking keep running. Applies in BOTH the legacy and smart-router paths.
  const hetznerServe = process.env.HETZNER_BARS_SERVE === '1'
    && process.env.L4_PR5_DISABLE_HETZNER_BARS !== '1'
  if (!hetznerServe) warmHetznerStore(ctx)

  try {
    // ── TRADING-ONLY: Codex-only bars (src=codex) ─────────────────────────
    // The Trading Platform token page sends &src=codex so its chart sources
    // candles from Codex FIRST — no Binance/Hetzner/cg-ohlc — for one
    // consistent DEX-native source. ONE fallback: when Codex has ZERO bars for
    // the token (older DEX tokens Codex doesn't index — CULT's 2022 Uniswap
    // pair rendered a blank chart while GeckoTerminal had full candles), the
    // FREE GeckoTerminal tier runs before giving up. Codex-covered tokens
    // never reach it, so metered spend is unchanged.
    if (req.query.src === 'codex' && process.env.PRO_CODEX_DISABLED !== '1') {
      const payload = await runTier('codex', ctx)
      if (payload?.bars?.length > 0) return writeBarsPayload(res, payload, ctx)
      // Scroll-back page entirely OLDER than Codex's genesis for this token.
      // The head-stitch in tryCodex only fires when Codex returned something to
      // stitch onto; a page fully before that start comes back empty, and the
      // chart latches the wall there. Binance owns the token's pre-DEX-pool
      // history for majors (BONK: Codex 2024-03-20 vs Binance 2023-12-15), it is
      // free, and this only runs when Codex had nothing - so metered spend is
      // unchanged and non-Binance tokens skip it outright.
      if (binancePair) {
        const bn = await runTier('binance', ctx)
        if (bn?.bars?.length > 0) return writeBarsPayload(res, bn, ctx)
      }
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

    // ── SMART ROUTER (opt-in via SMART_BARS_ROUTER=1) ──────────────────────
    if (process.env.SMART_BARS_ROUTER === '1') {
      const tokenClass = classifyTokenClass(ctx)
      const tierEnv = {
        codexFirst,
        proCodexOff: process.env.PRO_CODEX_DISABLED === '1',
        hetznerServe,
        // Codex-only applies here too, so flipping SMART_BARS_ROUTER=1 later
        // can't silently reinstate the GT-first order this file just removed.
        gtOff: codexOnlyBars || process.env.L4_PR8_DISABLE_GECKOTERMINAL === '1',
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
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60')
      if (ctx.budget) res.setHeader('X-Spectre-Budget', ctx.budget)
      res.setHeader('X-Spectre-Tier', 'no_data')
      return res.status(200).json({ bars: [] })
    }

    // ── LEGACY ORDER (flag off — preserved) ───────────────────────────────
    // Binance first (any token with a Binance pair).
    if (binancePair) {
      const payload = await runTier('binance', ctx)
      if (payload?.bars?.length > 0) return writeBarsPayload(res, payload, ctx)
      // Fall through to Hetzner / Codex if Binance returned no usable data.
    }

    // Hetzner candles_1m for DEX tokens not on Binance. Serving is now gated by
    // HETZNER_BARS_SERVE (background-only by default). The codexFirst skip is
    // preserved. The warm ping already fired above.
    if (hetznerServe && !codexFirst) {
      const payload = await runTier('hetzner', ctx)
      if (payload?.bars?.length > 0) return writeBarsPayload(res, payload, ctx)
      // Fall through to GeckoTerminal / Codex if Hetzner returned no data.
    }

    // Plain tickers have no contract address — GeckoTerminal and Codex are
    // address-bound. With a cgId we can still serve CG-listed CEX-only alts
    // from CoinGecko's paid OHLC endpoints.
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

    // GeckoTerminal DEX OHLCV. Kill switch: L4_PR8_DISABLE_GECKOTERMINAL=1.
    // 2026-06-18: also run GT FIRST for CG-LISTED tokens (reqCgId) even under
    // codexFirst. GT's raw DEX-swap OHLC is far fuller than CoinGecko's smoothed
    // hourly (SPECTRE 1H: GT ~2% flat candles vs cg-ohlc 43% = the "not filled
    // candles" report). GT is FREE so this is Codex-NEUTRAL; cg-ohlc below stays
    // the reliable fallback if GT misses. Pure-degen (no cgId) under codexFirst
    // still goes Codex-first (GT only as the later fallback).
    if (!codexOnlyBars && (!codexFirst || reqCgId) && process.env.L4_PR8_DISABLE_GECKOTERMINAL !== '1') {
      const payload = await runTier('geckoterminal', ctx)
      if (payload?.bars?.length > 0) return writeBarsPayload(res, payload, ctx)
      // Fall through to cg-ohlc / Codex if GeckoTerminal returned no usable data.
    }

    // CoinGecko paid OHLC for CG-listed tokens whose pools GT couldn't serve.
    // Runs BEFORE Codex because CG credits are ample and Codex is the metered
    // last resort.
    if (reqCgId && !codexOnlyBars) {
      const payload = await tryCgOhlc(ctx)
      if (payload?.bars?.length > 0) return writeBarsPayload(res, payload, ctx)
    }

    // PR1 (2026-06-04) Codex kill switch. `PRO_CODEX_DISABLED=1` returns empty
    // bars before any Codex call — free tiers above STILL run.
    if (process.env.PRO_CODEX_DISABLED === '1') {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60')
      res.setHeader('X-Spectre-Tier', 'no_data')
      return res.status(200).json({ bars: [] })
    }

    // Codex tier (budget-guarded + stale-mirror; in-flight dedup + KV write all
    // live in the tier function). Returns { bars, source:'codex' } | null.
    const payload = await runTier('codex', ctx)
    // Codex-first DEX fallback: if Codex has no bars yet (brand-new token not
    // indexed), try GeckoTerminal so the chart isn't blank. GT was skipped above
    // when codexFirst, so run it here instead of returning empty.
    if (codexFirst && !(payload?.bars?.length > 0)
        && process.env.L4_PR8_DISABLE_GECKOTERMINAL !== '1') {
      const gt = await runTier('geckoterminal', ctx)
      if (gt?.bars?.length > 0) return writeBarsPayload(res, gt, ctx)
    }
    return writeBarsPayload(res, payload, ctx)
  } catch (err) {
    console.error('Bars handler exception:', err.message)
    if (ctx.budget) res.setHeader('X-Spectre-Budget', ctx.budget)
    // An exception is a broken request, not proof of empty history - 'no_data'
    // here made the chart latch its permanent genesis floor on server blips.
    res.setHeader('X-Spectre-Tier', 'error')
    return res.status(200).json({ bars: [], failed: true, fallback: true, error: err.message })
  }
}
