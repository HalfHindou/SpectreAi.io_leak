/**
 * TradingView Advanced Charts — uses the self-hosted charting_library (v27)
 * Replaces the basic iframe embed with a full-featured chart widget.
 *
 * Data flows through our server:
 *   /api/tradingview/udf/symbols  -> symbol metadata
 *   /api/tradingview/udf/search   -> symbol search
 *   /api/tradingview/udf/history  -> OHLCV bars (crypto via Codex+Binance, stocks via Yahoo)
 */
import { useEffect, useRef, useState, memo } from 'react'
import { logError } from '@/lib/logger'
import { tryGateResume } from '@/lib/gate-resume'
import { subscribe as streamSubscribe } from '@/services/codexStreamApi'
import { getStockSeriesBars } from '@/services/stockApi'
import { getSpectreTokenChart } from '@/services/spectreMarketApi'
import { tvExchangeFor } from '@/lib/tradingViewSymbols'
import { computePricescaleFromPrice, knownCryptoSymbolInfo } from '@/lib/tradingViewSymbolInfo'

// TV resolution → Spectre OHLCV interval, for the ticker fallback below.
const RES_TO_SPECTRE_INTERVAL = {
  '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '1h',
  '240': '4h', '720': '12h', '1D': '1d', '1W': '1w',
}


const LIBRARY_PATH = '/charting_library/'

/**
 * Did the widget actually paint a chart inside `host`?
 *
 * 🪤 charting_library v27 renders into a same-origin IFRAME, so probing the
 * host element alone (`host.querySelector('canvas')`) reads false even on a
 * perfectly healthy chart - measured on a working ETH chart: host 0 canvases,
 * iframe 7. The fail-open below used exactly that probe, so its "did it
 * paint?" question could only ever answer no, and a chart that rendered a
 * fraction late got covered by the "couldn't load" overlay anyway.
 */
function hasPaintedChart(host) {
  if (!host) return false
  if (host.querySelector('canvas')) return true
  for (const frame of host.querySelectorAll('iframe')) {
    try {
      if (frame.contentDocument?.querySelector('canvas')) return true
    } catch { /* cross-origin frame - not ours, ignore */ }
  }
  return false
}

// Map our timeframe labels to TV resolutions
const TIMEFRAME_TO_RESOLUTION = {
  '1S': '1S',
  '1M': '1',
  '5M': '5',
  '15M': '15',
  '30M': '30',
  '1H': '60',
  '4H': '240',
  '12H': '720',
  '1D': '1D',
  '1W': '1W',
}

// Always use relative paths — Vite proxy handles routing in dev, Vercel rewrites in prod
const API_BASE = ''

// Bar duration in seconds for each resolution
const RES_SECONDS = { '1S': 1, '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, '240': 14400, '720': 43200, '1D': 86400, '1W': 604800 }

// Crypto price history cannot predate 2010. The widened scroll-back windows
// below span N intervals - harmless intraday, but 1000 x 1W = ~19 years and
// the probe's 1500 x 1W = ~28 years, i.e. pre-genesis requests that waste a
// heavy upstream call and can trip the history-exhausted latch on weeklies.
const HISTORY_FLOOR_SEC = 1262304000 // 2010-01-01 UTC
// Sparse-tape thresholds for the FIRST window of a fresh load (real bars, after
// the gap-fill strip). Under SAMPLE_MIN the datafeed widens once so the cadence
// report has something to measure; REPORT_MIN is the smallest sample the median
// gap is read from (2 gaps). Both only ever engage on thin tapes.
const SPARSE_SAMPLE_MIN = 6
const SPARSE_REPORT_MIN = 3

// Codex cost defense: TradingView Advanced fires a getBars() per chart mount
// just to figure out the price decimal precision (pricescale). Token prices
// move within a magnitude band - BTC stays $10K+, SHIB stays sub-cent - so
// the answer doesn't change between mounts. Cache it indefinitely keyed by
// symbol. resolveSymbol() reads this first, ships pricescale immediately if
// known, and only falls back to a single getBars when we have no prior
// observation. Pre-fix this added one getBars per chart open; with the
// research /token iframe double-mount that was 2 per token view.
const _pricescaleCache = new Map() // "address:networkId" (or symbolName) -> pricescale int

// TradingView SDK silently falls back to UTC if the passed timezone isn't in its internal
// list. Map the user's Intl timezone to a TV-supported IANA zone, falling back by UTC offset.
const TV_SUPPORTED_TZ = new Set([
  'Africa/Cairo','Africa/Johannesburg','Africa/Lagos','Africa/Nairobi','Africa/Tunis',
  'America/Anchorage','America/Argentina/Buenos_Aires','America/Bogota','America/Caracas',
  'America/Chicago','America/El_Salvador','America/Juneau','America/Lima','America/Los_Angeles',
  'America/Mexico_City','America/New_York','America/Phoenix','America/Santiago','America/Sao_Paulo',
  'America/Toronto','America/Vancouver',
  'Asia/Almaty','Asia/Ashkhabad','Asia/Bahrain','Asia/Bangkok','Asia/Chongqing','Asia/Colombo',
  'Asia/Dhaka','Asia/Dubai','Asia/Ho_Chi_Minh','Asia/Hong_Kong','Asia/Jakarta','Asia/Jerusalem',
  'Asia/Karachi','Asia/Kathmandu','Asia/Kolkata','Asia/Kuwait','Asia/Manila','Asia/Muscat',
  'Asia/Qatar','Asia/Riyadh','Asia/Seoul','Asia/Shanghai','Asia/Singapore','Asia/Taipei',
  'Asia/Tehran','Asia/Tel_Aviv','Asia/Tokyo','Asia/Yangon',
  'Atlantic/Azores','Atlantic/Reykjavik',
  'Australia/Adelaide','Australia/Brisbane','Australia/Perth','Australia/Sydney',
  'Europe/Amsterdam','Europe/Athens','Europe/Belgrade','Europe/Berlin','Europe/Bratislava',
  'Europe/Brussels','Europe/Bucharest','Europe/Budapest','Europe/Copenhagen','Europe/Dublin',
  'Europe/Helsinki','Europe/Istanbul','Europe/Lisbon','Europe/London','Europe/Luxembourg',
  'Europe/Madrid','Europe/Malta','Europe/Moscow','Europe/Oslo','Europe/Paris','Europe/Riga',
  'Europe/Rome','Europe/Stockholm','Europe/Tallinn','Europe/Vilnius','Europe/Warsaw','Europe/Zurich',
  'Pacific/Auckland','Pacific/Chatham','Pacific/Fakaofo','Pacific/Honolulu','Pacific/Norfolk',
  'Etc/UTC',
])

// Well-known IANA aliases that browsers report but TV rejects → map to a TV-supported equivalent.
const TV_TZ_ALIAS = {
  'Europe/Kiev': 'Europe/Kyiv', 'Europe/Kyiv': 'Europe/Warsaw',
  'Europe/Minsk': 'Europe/Moscow', 'Europe/Simferopol': 'Europe/Moscow',
  'Europe/Sofia': 'Europe/Bucharest', 'Europe/Vienna': 'Europe/Berlin',
  'Europe/Prague': 'Europe/Berlin', 'Europe/Zagreb': 'Europe/Belgrade',
  'Europe/Ljubljana': 'Europe/Belgrade', 'Europe/Sarajevo': 'Europe/Belgrade',
  'Europe/Skopje': 'Europe/Belgrade', 'Europe/Podgorica': 'Europe/Belgrade',
  'Asia/Yekaterinburg': 'Asia/Almaty', 'Asia/Novosibirsk': 'Asia/Almaty',
  'Asia/Krasnoyarsk': 'Asia/Bangkok', 'Asia/Irkutsk': 'Asia/Hong_Kong',
  'UTC': 'Etc/UTC', 'GMT': 'Etc/UTC',
}

function resolveTvTimezone() {
  try {
    const raw = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!raw) return 'Etc/UTC'
    if (TV_SUPPORTED_TZ.has(raw)) return raw
    if (TV_TZ_ALIAS[raw] && TV_SUPPORTED_TZ.has(TV_TZ_ALIAS[raw])) return TV_TZ_ALIAS[raw]
    // Offset-based fallback — pick the TV zone whose current offset matches the user's.
    const offMin = -new Date().getTimezoneOffset() // minutes east of UTC
    const byOffset = {
      '-480': 'America/Los_Angeles', '-420': 'America/Phoenix',
      '-360': 'America/Mexico_City', '-300': 'America/New_York',
      '-240': 'America/Caracas', '-180': 'America/Argentina/Buenos_Aires',
      '0': 'Etc/UTC', '60': 'Europe/London', '120': 'Europe/Madrid',
      '180': 'Europe/Moscow', '240': 'Asia/Dubai', '300': 'Asia/Karachi',
      '330': 'Asia/Kolkata', '420': 'Asia/Bangkok', '480': 'Asia/Shanghai',
      '540': 'Asia/Tokyo', '600': 'Australia/Brisbane', '660': 'Australia/Sydney',
    }
    return byOffset[String(offMin)] || 'Etc/UTC'
  } catch (err) {
    logError('TradingViewAdvanced:resolveTvTimezone', err)
    return 'Etc/UTC'
  }
}

// ---------------------------------------------------------------------------
// Custom Datafeed — implements TradingView IExternalDatafeed + IDatafeedChartApi
// ---------------------------------------------------------------------------
export function createDatafeed(onNoDataCb, refPriceRef, tokenRef, visibilityRef, tapeEndRef, onSparseCb, chartSymbol) {
  let tradeMarkerData = []
  let noDataFired = false // fire onNoData at most once per datafeed instance
  const sparseReported = new Set() // one cadence report per symbol+resolution
  // Cache key whose auto-paging is halted because the caller stepped the
  // interval off it (see the scroll-to-load path). Cleared on the next
  // symbol/resolution change.
  let sparseHalt = null
  const sourceLogged = new Set() // one bars-source console line per symbol+resolution+source

  const subscribers = new Map()
  let pollingTimer = null
  // Codex SSE singleton unsubscribe handle. When set, the datafeed is being
  // ticked by Codex onPricesUpdated and we DO NOT poll /api/bars in parallel
  // (would race the stream and waste server quota).
  let streamUnsub = null

  // Running bar cache — accumulates ALL loaded bars for current symbol+resolution.
  // Pre-load fills it on initial getBars; scroll-to-load prepends older bars.
  // Polling appends new bars. resetData() returns the full cache.
  let allBarsCache = []
  let cacheSymRes = '' // "SYMBOL:RES" invalidation key

  // ── Real-time streaming via Codex onPricesUpdated SSE ─────────────
  // Updates the last bar's close/high/low from the priceUsd ticker so chart
  // hero stays in lockstep with the trending list (which is fed by the same
  // Codex priceUSD). Falls back to polling when token has no address (CEX
  // ticker symbols routed through UDF history).
  function startStreaming(resolution) {
    stopStreaming()
    const tok = tokenRef?.current
    const rawAddr = tok?.address
    const netId = tok?.networkId
    if (!rawAddr || !netId) {
      startPolling()
      return
    }
    // Codex emits addresses as lowercase for EVM; Solana base58 stays cased.
    // The SSE server payload's `address` field is matched verbatim against our
    // listener's tokenSet, so we MUST normalize to whatever Codex emits or
    // every onPricesUpdated tick gets dropped silently (bug-source #1).
    const isSolana = !rawAddr.startsWith('0x') && rawAddr.length >= 32
    const addr = isSolana ? rawAddr : rawAddr.toLowerCase()
    const tokenKey = `${addr}:${netId}`

    streamUnsub = streamSubscribe([tokenKey], (data) => {
      try {
        const price = parseFloat(data.priceUsd)
        if (!Number.isFinite(price) || price <= 0) return
        if (allBarsCache.length === 0) return

        const lastBar = allBarsCache[allBarsCache.length - 1]

        // Sanity check: reject a tick whose price is wildly off from the
        // historical scale. Codex onPricesUpdated occasionally emits an
        // outlier (low-liq swap, wrong-pair sample, raw amount instead of
        // USD). Without this guard a single bad tick promotes high/close to
        // the outlier and destroys the chart axis.
        const lastClose = lastBar.close > 0 ? lastBar.close : null
        if (lastClose) {
          const ratio = price > lastClose ? price / lastClose : lastClose / price
          if (ratio > 10) return // 10x in one tick is not real - ignore
        }

        const resSeconds = RES_SECONDS[resolution] || 3600
        const nowSec = Math.floor(Date.now() / 1000)
        const currentBucketMs = Math.floor(nowSec / resSeconds) * resSeconds * 1000

        let tvBar
        if (currentBucketMs === lastBar.time) {
          // Same bucket — extend high/low, update close
          tvBar = {
            time: lastBar.time,
            open: lastBar.open,
            high: Math.max(lastBar.high, price),
            low: Math.min(lastBar.low, price),
            close: price,
            volume: lastBar.volume,
          }
          allBarsCache[allBarsCache.length - 1] = tvBar
        } else if (currentBucketMs > lastBar.time) {
          // New bucket — append a fresh bar seeded from price
          tvBar = {
            time: currentBucketMs,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: 0,
          }
          allBarsCache.push(tvBar)
        } else {
          return // stale tick, ignore
        }

        subscribers.forEach(({ onTick }) => {
          try { onTick(tvBar) } catch { /* per-listener safety */ }
        })
      } catch { /* swallow per spec */ }
    })
  }

  function stopStreaming() {
    if (streamUnsub) {
      try { streamUnsub() } catch { /* ok */ }
      streamUnsub = null
    }
  }

  // Resolution-aware polling cadence. The previous flat 15s burned a Codex
  // getBars every 15s even on a 1D chart that updates once per 24h. Now the
  // poll interval is keyed to the bar resolution: sub-minute charts still
  // poll fast, slow charts poll proportionally. Cost defense — see audit
  // 2026-05-15. Combined with `document.hidden` + IntersectionObserver, this
  // cuts chart Codex burn ~75% with no UX regression (chart still ticks
  // before a bar can plausibly have closed).
  function pollIntervalForResolution(resolution) {
    const resSec = RES_SECONDS[resolution] || 3600
    // 2026-06-02 cost defense pass 2: SSE drives the live price tick (sub-
    // second), so this poll exists ONLY to recover from gaps and append the
    // closed bar. A 30s lag on a 1m bar close is invisible because TV
    // interpolates from the SSE tick. Doubled intervals across the board.
    if (resSec <= 60) return 30_000          // 1m → 30s (was 15s)
    if (resSec <= 300) return 60_000         // 5m → 60s (was 30s)
    if (resSec <= 900) return 90_000         // 15m → 90s (was 45s)
    if (resSec <= 3600) return 120_000       // 1H → 2min (was 60s)
    if (resSec <= 14400) return 240_000      // 4H → 4min (was 2min)
    if (resSec <= 86400) return 600_000      // 1D → 10min (was 5min)
    return 1200_000                           // 1W+ → 20min (was 10min)
  }

  function startPolling() {
    if (pollingTimer) return
    // Use the slowest resolution across subscribers (typically there's only
    // one). Keeping this simple — re-keyed on the first subscriber's res.
    const firstRes = subscribers.size > 0
      ? Array.from(subscribers.values())[0].resolution
      : '60'
    const intervalMs = pollIntervalForResolution(firstRes)
    pollingTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      // IntersectionObserver gate: skip poll when the chart container is
      // scrolled off-screen. The previous implementation wrote to a single
      // global (`window.__TV_VISIBILITY_GATE`) and the Research Zone mounts
      // TWO TVA instances (main chart + Technicals tab), so the second
      // observer clobbered the first's gate — scrolling Technicals off
      // disabled polling for the main chart that was still on-screen.
      // `visibilityRef` is now per-instance.
      if (visibilityRef && visibilityRef.current === false) return
      subscribers.forEach(({ symbolInfo, resolution, onTick }) => {
        const to = Math.floor(Date.now() / 1000)
        // Window must cover the in-progress bar AND the last few closed bars so
        // a missed poll (network blip, cache miss, Codex sparse response) can
        // recover on the next tick. The previous 120s window silently lost the
        // just-closed bar for 1H/4H/1D resolutions because:
        //   1. Codex /api/bars is keyed on 5-min buckets with 60s TTL — a
        //      1H bar that closed inside the bucket was cached as "missing".
        //   2. A 120s window around 14:02 (for example) no longer contains the
        //      14:00:00 open-time after two minutes have elapsed.
        // Fix: anchor the window to lastCachedTime - 1 resolution (or 2 bars
        // from now, whichever is earlier) and cap at 6 bars of history so we
        // always catch the closed bar plus a margin for retries.
        const resSec = RES_SECONDS[resolution] || 3600
        const lastCachedSec = allBarsCache.length > 0
          ? Math.floor(allBarsCache[allBarsCache.length - 1].time / 1000)
          : to - resSec
        // Cover everything from one bar before lastCached up to now, but cap
        // the window at 6 bars to keep requests small.
        const windowCap = resSec * 6
        const from = Math.max(to - windowCap, lastCachedSec - resSec)

        if (typeof window !== 'undefined' && window.__TV_DEBUG) {
          console.debug('[TV poll]', {
            sym: symbolInfo.name,
            res: resolution,
            from: new Date(from * 1000).toISOString(),
            to: new Date(to * 1000).toISOString(),
            lastCached: new Date(lastCachedSec * 1000).toISOString(),
            windowSec: to - from,
          })
        }

        fetchBars(symbolInfo.name, resolution, from, to).then(bars => {
          if (!Array.isArray(bars) || bars.length === 0) {
            return
          }
          // fetchBars already sorts ascending + dedupes.
          // Forward EVERY bar that is newer than (or equal to) the cached last
          // bar — ensures intermediate bars within the polling window aren't
          // lost. TV accepts same-time bars as updates and greater-time bars
          // as appends.
          const lastCachedTime = allBarsCache.length > 0
            ? allBarsCache[allBarsCache.length - 1].time
            : 0
          let forwarded = 0
          for (const bar of bars) {
            if (!bar || !Number.isFinite(bar.time)) continue
            // Forward bars that are same-time (in-progress update) OR newer.
            // Older late-arriving bars are dropped.
            if (bar.time < lastCachedTime) continue
            if (allBarsCache.length > 0) {
              const lastTime = allBarsCache[allBarsCache.length - 1].time
              if (bar.time === lastTime) {
                allBarsCache[allBarsCache.length - 1] = bar
              } else if (bar.time > lastTime) {
                allBarsCache.push(bar)
              }
            } else {
              allBarsCache.push(bar)
            }
            onTick(bar)
            forwarded++
          }
          if (typeof window !== 'undefined' && window.__TV_DEBUG && forwarded > 0) {
            console.debug('[TV poll] forwarded', forwarded, 'bars; new lastCached =',
              new Date(allBarsCache[allBarsCache.length - 1].time).toISOString())
          }
        }).catch(err => {
          if (typeof window !== 'undefined' && window.__TV_DEBUG) {
            console.warn('[TV poll] error', err)
          }
        })
      })
    }, intervalMs)
  }

  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer)
      pollingTimer = null
    }
  }

  async function fetchJSON(url, _retried = false) {
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!resp.ok) {
      // 401 with GATE_REQUIRED = AuthGate session cookie expired mid-session.
      // v1 (audit 2026-06-03) force-reloaded the page here — which rebooted
      // the whole app on a cookie blip ("the app kicked me out", Sunny
      // 2026-07-02, runtime logs show udf/symbols 401 → white chart → reload).
      // v2: silently replay the localStorage resume token to re-mint the
      // cookie in place, then REPLAY this fetch once so the CURRENT request
      // succeeds too — before, even a successful resume still rejected the
      // in-flight call, so a fresh mount showed the fail-state until the next
      // 15s poll rescued it. Only a DEFINITIVE resume rejection (token dead
      // too) falls back to the reload → gate re-prompt.
      if (resp.status === 401) {
        try {
          const body = await resp.clone().json().catch(() => null)
          if (body?.code === 'GATE_REQUIRED' && typeof window !== 'undefined') {
            const resumed = await tryGateResume()
            if (!resumed) window.location.reload()
            else if (!_retried) return fetchJSON(url, true)
          }
        } catch { /* fall through to throw */ }
      }
      throw new Error(`HTTP ${resp.status}`)
    }
    return resp.json()
  }

  // In-flight request deduplication
  const inflightRequests = new Map()

  async function fetchBars(symbol, resolution, from, to) {
    // Bucket-rounded dedup: two near-simultaneous fetches for the same
    // (symbol, resolution) within the SAME candle bucket are effectively the
    // same request - the closed bar set hasn't changed. Without bucket
    // rounding the research /token iframe double-mount (research wrapper +
    // trading iframe both hold TVA) fired two separate Codex calls because
    // their from/to differed by milliseconds. With bucketing they coalesce.
    const resSec = RES_SECONDS[resolution] || 3600
    const bucket = Math.max(resSec, 60) // never bucket smaller than 60s
    const fromBucket = Math.floor(from / bucket)
    const toBucket = Math.ceil(to / bucket)
    const dedupKey = `${symbol}:${resolution}:${fromBucket}:${toBucket}`
    if (inflightRequests.has(dedupKey)) {
      return inflightRequests.get(dedupKey)
    }

    const promise = (async () => {
      // STOCKS: dedicated Yahoo leg (same series the RZ indicator engine
      // computes on, so the chart and the panel below it read one tape).
      // A stock must never enter the crypto /api/bars chain — bare-ticker
      // resolution there is crypto-keyed (the AAPL-clone collision class).
      if (tokenRef?.current?.isStock) {
        // TV spells share classes with a dot (BRK.B), Yahoo with a dash
        // (BRK-B). Measured 2026-09-04: the dotted form came back {bars: []}
        // from /api/stocks/candles, TV fired onNoData and LITE cinema fell to
        // the lightweight chart - which loads ONE day of 1m bars and cannot
        // scroll back. Hand Yahoo its own spelling.
        const cleanSym = String(symbol || '').toUpperCase().split(':')[0].replace(/\./g, '-')
        const res = await getStockSeriesBars(cleanSym, String(resolution))
        const raw = (Array.isArray(res?.bars) ? res.bars : [])
          .map(b => ({
            time: (b.t || 0) * 1000,
            open: b.o, high: b.h, low: b.l, close: b.c,
            volume: b.v || 0,
          }))
          .filter(b => Number.isFinite(b.time) && b.time > 0 && b.close > 0)
        const byTime = new Map()
        for (const b of raw) byTime.set(b.time, b)
        const sorted = [...byTime.values()].sort((a, b) => a.time - b.time)
        // TV asks for a window; the Yahoo fetch is range-based, so slice.
        return sorted.filter(b => b.time >= from * 1000 && b.time <= to * 1000)
      }

      // Direct /api/bars (same path as the trading app's TradingViewAdvanced).
      // Skips the UDF wrapper hop and shares server cache with trading.
      // SYMBOL RULE (2026-06-11, post-audit): ADDRESS-FIRST. The address is
      // the unambiguous token identity - the server's registry reverse-map
      // routes address-form majors to Binance klines (WBTC contract serves
      // BTCUSDT), so deep-link BTC still gets clean CEX data. A ticker-first
      // rule was tried and REVERTED same day: symbol collisions charted DEX
      // degens as the Binance asset, and ticker-keyed bars mixed with the
      // address-keyed SSE stream (two instruments in one series).
      const tok = tokenRef?.current
      let barsSymbol = symbol
      let networkId = 1
      if (tok?.address && tok?.networkId) {
        barsSymbol = `${tok.address}:${tok.networkId}`
        networkId = tok.networkId
      } else if (typeof symbol === 'string' && symbol.includes(':')) {
        const [, netStr] = symbol.split(':')
        networkId = parseInt(netStr) || 1
      }
      // cgId unlocks the server's CG-OHLC tier (3.5) for CG-listed tokens
      // whose pools GT/Codex can't chart (charts-v2 Phase 1).
      const cgIdPart = tok?.cgId ? `&cgId=${encodeURIComponent(tok.cgId)}` : ''
      // Source pin (LITE on-chain sets barsSrc:'gt' on the token): keeps the
      // TV tab on the same GeckoTerminal pool series the caller's own
      // Line/Candles lanes draw. Server-side it is fail-soft — a GT miss
      // falls through to the normal cascade.
      const srcPart = tok?.barsSrc ? `&src=${encodeURIComponent(tok.barsSrc)}` : ''
      // refPrice arms the server's quote-agreement gate: a tier whose newest
      // close contradicts the live quote (dead dust pool, wrong pair) is
      // rejected server-side and the cascade falls through instead of the
      // garbage reaching the chart (ZIG 2026-08-24). Rounded to 2 significant
      // digits so the URL — and the CDN cache key — is stable across ticks.
      const rp = Number(refPriceRef?.current)
      const refPart = Number.isFinite(rp) && rp > 0 ? `&refPrice=${Number(rp.toPrecision(2))}` : ''
      const url = `${API_BASE}/api/bars?symbol=${encodeURIComponent(barsSymbol)}&from=${from}&to=${to}&resolution=${resolution}&networkId=${networkId}${cgIdPart}${srcPart}${refPart}`
      const data = await fetchJSON(url)
      let arr = Array.isArray(data?.bars) ? data.bars : []
      // The GeckoTerminal tier GAP-FILLS empty buckets with synthetic rows
      // (o=h=l=c=prev close, v=0; flagged via meta.gapFilled) — on a thin
      // token's fine resolutions most of the series is fabricated, and the
      // widget rendered it as long hollow flat "bars" (founder report,
      // ZIG 1m 2026-08-24; audit defect #1: fabricated candles drawn as real
      // market data). Strip them for the TV widget: it lays bars out by
      // index, so quiet stretches collapse (the CMC/DexScreener look) instead
      // of drawing candles for trades that never happened. Keep the payload
      // untouched when EVERY bar is synthetic — a fully quiet window must not
      // blank the pane into the no-data fail-open.
      if (data?.meta?.gapFilled) {
        const real = arr.filter(b => !((!b.v) && b.o === b.h && b.o === b.l && b.o === b.c))
        if (real.length > 0) arr = real
      }
      // One line per symbol+resolution+source: names the tier that actually
      // feeds the chart, so the next "chart looks wrong" report identifies
      // its data source from the console without a debugging session.
      if (data?.source && !sourceLogged.has(`${barsSymbol}:${resolution}:${data.source}`)) {
        sourceLogged.add(`${barsSymbol}:${resolution}:${data.source}`)
        console.info(`[TV] ${symbol} res=${resolution} bars source=${data.source} (n=${arr.length}${data?.meta?.gapFilled ? `, realBarRatio=${data.meta.realBarRatio}` : ''})`)
      }
      // SPECTRE OHLCV FALLBACK (2026-07-08): address-first is right for identity,
      // but some contract-form majors (e.g. WBTC:1) don't resolve on the server's
      // /api/bars reverse-map and return 0 bars — which used to strand the chart
      // on the DexScreener embed and lose the S/R zones + studies. The indicator
      // pipeline charts these fine via the Spectre /v1/prices/{sym}/ohlcv endpoint
      // (verified: WBTC → 38 bars @ BTC price). When /api/bars is empty, pull the
      // same source by bare ticker before declaring no-data. Address form stays
      // primary, so no symbol-collision regression.
      //
      // 🪤 ADDRESS-QUERIED TOKENS ARE EXCLUDED. `symbol` here is the DISPLAY
      // ticker, so `!symbol.includes(':')` was true for every on-chain cap even
      // though the bars had just been requested BY CONTRACT - and an on-chain
      // ticker is not an identity. Measured 2026-08-20 on THE DEALER: the
      // contract has no bars since July, this fallback answered with a
      // different DEALER's Aug 8-20 series, the bad-data guard below saw a 786x
      // gap against the live price and killed the chart, and LITE bounced the
      // user off the TradingView tab. Fall back by ticker ONLY when the request
      // itself was by ticker (contract-form majors like WBTC:1 keep the lane,
      // which is what it was written for).
      const queriedByAddress = barsSymbol !== symbol
      if (arr.length === 0 && !queriedByAddress && typeof symbol === 'string' && symbol && !symbol.includes(':')) {
        try {
          const sInterval = RES_TO_SPECTRE_INTERVAL[String(resolution)] || '1h'
          const sp = await getSpectreTokenChart(symbol, { interval: sInterval, limit: 500 })
          if (Array.isArray(sp) && sp.length > 0) {
            const mapped = sp.map(b => ({ t: b.t || b.time, o: b.o ?? b.open, h: b.h ?? b.high, l: b.l ?? b.low, c: b.c ?? b.close, v: b.v ?? b.volume ?? 0 }))
            // CANDLE GATE (2026-08-25, the LEO dash-chart): the box's ohlcv
            // for long-tail rows is a daily CLOSE replicated into o/h/l/c —
            // real volume, zero range (LEO 1D: 8/8 bars flat). Drawn as
            // candles that renders a chart of dashes. Adopt the fallback only
            // when the series carries a REAL range on some non-live-edge bar
            // (same rule as LITE's candle gate, charts-system §I11); a
            // fake-flat tape falls through to no-data and the chart degrades
            // honestly (canvas line / embed) until the address-keyed identity
            // lands. WBTC-class CEX rows — what this lane was written for —
            // carry real ranges and keep working.
            const hasRealRange = mapped.some((b, i) => i < mapped.length - 1 && Number(b.h) > Number(b.l))
            if (hasRealRange) arr = mapped
          }
        } catch (_) { /* keep empty → embed fallback */ }
      }
      if (arr.length === 0) {
        console.warn(`[TV] No bars for ${barsSymbol} res=${resolution} (source=${data?.source || 'unknown'})`)
        return []
      }
      // Server returns { t, o, h, l, c, v } where t is unix seconds.
      // TradingView REQUIRES strictly ascending unique-time bars; any descending
      // or duplicate-time rows render as a flipped/garbled x-axis.
      const raw = arr.map(b => ({
        time: (b.t || 0) * 1000,
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v || 0,
      })).filter(b => Number.isFinite(b.time) && b.time > 0)
      const byTime = new Map()
      for (const b of raw) byTime.set(b.time, b) // last write wins on dup timestamp
      const sorted = [...byTime.values()].sort((a, b) => a.time - b.time)
      // Per-bar outlier clamp: Codex DEX aggregation occasionally yields a
      // single bar with a ~10000x spike from a low-liq swap or wrong-pair
      // sample. Clamp those to 2x the median of surrounding bars (5 on each
      // side). Mirrors the algorithm in chart/adapters/codexAdapter.js.
      return clampBarOutliers(sorted)
    })()

    inflightRequests.set(dedupKey, promise)
    promise.finally(() => inflightRequests.delete(dedupKey))
    return promise
  }

  // Clamp single-bar outliers against the local median.
  // Same shape as chart/adapters/codexAdapter.filterOutliers but operating on
  // {time, open, high, low, close, volume} bars.
  // CONTINUATION TEST (2026-08-25, mirrors PR #1422 / bars-router
  // sanitizeBars / trading _clampSpikes): the median band alone CANNOT tell a
  // wrong-price print from a real violent move — on a rug the ±5 window
  // straddles both regimes, the median stays on the old side, and the old
  // clamp "corrected" the crash candle back toward the pre-crash price
  // (MemeCore 25 Jun '26 1h: real low ~0.55 rendered as an exact "-50.00%"
  // bar at median×0.5 with a cliff to the next candle). A bad print is an
  // ISLAND the next bar ignores; a real move CHAINS into the next bar's
  // traded range. The 25x tolerance only separates "the series went here"
  // from "the series ignored this".
  function _seriesFollowsBar(bars, i) {
    const c = bars[i]?.close
    if (!(c > 0)) return false
    const nxt = bars[i + 1]
    if (!nxt) {
      // Live edge: nothing downstream to corroborate yet. A real move is
      // backed by trades; a bad print is a tick with nothing behind it.
      return bars[i].volume > 0
    }
    const nl = nxt.low, nh = nxt.high
    if (!(nl > 0 && nh > 0)) return false
    return c >= nl / 25 && c <= nh * 25
  }

  function clampBarOutliers(bars) {
    if (!Array.isArray(bars) || bars.length < 5) return bars
    const WINDOW = 5
    const HIGH_MULT = 3
    const LOW_MULT = 0.2
    return bars.map((bar, i) => {
      const start = Math.max(0, i - WINDOW)
      const end = Math.min(bars.length, i + WINDOW + 1)
      const neighbors = []
      for (let j = start; j < end; j++) {
        if (j !== i && bars[j].close > 0) neighbors.push(bars[j].close)
      }
      if (neighbors.length < 2) return bar
      neighbors.sort((a, b) => a - b)
      const median = neighbors[Math.floor(neighbors.length / 2)]
      if (median <= 0) return bar

      let { time, open, high, low, close, volume } = bar
      const isSpike =
        high > median * HIGH_MULT ||
        close > median * HIGH_MULT ||
        open > median * HIGH_MULT
      const isDip = low > 0 && low < median * LOW_MULT

      // Out-of-band but the series follows it → a genuine move, keep it raw.
      if ((isSpike || isDip) && _seriesFollowsBar(bars, i)) return bar

      if (isSpike) {
        const clamp = median * 2
        high = Math.min(high, clamp)
        open = Math.min(open, clamp)
        close = Math.min(close, clamp)
        low = Math.min(low, clamp)
      }
      if (isDip) {
        const clamp = median * 0.5
        low = Math.max(low, clamp)
        open = Math.max(open, clamp)
        close = Math.max(close, clamp)
        high = Math.max(high, clamp)
      }
      return { time, open, high, low, close, volume }
    })
  }

  // Merge bars into a sorted, deduped array using Map keyed by time
  function mergeBars(...arrays) {
    const map = new Map()
    for (const arr of arrays) {
      for (const b of arr) {
        if (b && Number.isFinite(b.time) && b.time > 0) map.set(b.time, b)
      }
    }
    return [...map.values()].sort((a, b) => a.time - b.time)
  }

  // Final safety net before handing bars to TradingView — guarantees strictly
  // ascending unique-time bars. TV renders a flipped/garbled x-axis otherwise.
  function sanitizeBars(bars, label) {
    if (!Array.isArray(bars) || bars.length === 0) return []
    const clean = mergeBars(bars)
    if (typeof window !== 'undefined' && window.__TV_DEBUG) {
      const asc = clean.every((b, i) => i === 0 || b.time >= clean[i - 1].time)
      console.debug('[TV getBars]', label, {
        count: clean.length,
        firstTime: clean[0]?.time && new Date(clean[0].time).toISOString(),
        lastTime: clean[clean.length - 1]?.time && new Date(clean[clean.length - 1].time).toISOString(),
        ascending: asc,
      })
    }
    return clean
  }

  return {
    _fetchBars: fetchBars,
    _earliestBarTime: null,

    // Prepend older bars to the running cache. mergeBars always returns a
    // strictly ascending, deduped array so the result is safe to hand to TV.
    _prependToCache(olderBars) {
      if (!olderBars || !olderBars.length) return
      allBarsCache = mergeBars(olderBars, allBarsCache)
      if (allBarsCache.length > 0) {
        this._earliestBarTime = Math.floor(allBarsCache[0].time / 1000)
      }
    },

    // ── onReady ────────────────────────────────────────────────────
    onReady(callback) {
      setTimeout(() => callback({
        supported_resolutions: ['1S', '1', '5', '15', '30', '60', '240', '720', '1D', '1W'],
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
          { name: 'Stock', value: 'stock' },
        ],
      }), 0)
    },

    // ── searchSymbols ──────────────────────────────────────────────
    async searchSymbols(userInput, exchange, symbolType, onResult) {
      try {
        const data = await fetchJSON(
          `${API_BASE}/api/tradingview/udf/search?query=${encodeURIComponent(userInput)}&limit=10`
        )
        onResult(Array.isArray(data) ? data : [])
      } catch (err) {
        logError('TradingViewAdvanced:searchSymbols', err)
        onResult([])
      }
    },

    // ── resolveSymbol ──────────────────────────────────────────────
    async resolveSymbol(symbolName, onResolve, onError) {
      try {
        // STOCKS: synthesize symbolInfo locally — the udf/symbols stock path
        // only knows a hardcoded ~20-ticker set, so a long-tail ticker would
        // resolve as crypto (wrong session/exchange) or error out. Everything
        // TV needs here is derivable client-side.
        const stockTok = tokenRef?.current
        if (stockTok?.isStock) {
          let livePriceEq = null
          try { livePriceEq = Number(refPriceRef?.current) || null } catch { livePriceEq = null }
          const pricescaleEq = _pricescaleCache.get(symbolName)
            || computePricescaleFromPrice(livePriceEq)
            || 100
          _pricescaleCache.set(symbolName, pricescaleEq)
          const exch = tvExchangeFor(stockTok.exchange) || 'NASDAQ'
          onResolve({
            name: symbolName,
            full_name: `${exch}:${symbolName}`,
            description: stockTok.name || symbolName,
            type: 'stock',
            session: '0930-1600',
            exchange: exch,
            listed_exchange: exch,
            timezone: 'America/New_York',
            has_intraday: true,
            has_seconds: false,
            has_daily: true,
            has_weekly_and_monthly: true,
            // '1' included: the Yahoo leg serves 1m/5d (STOCK_TA_INTERVALS['1']),
            // and LITE's pill row offers 1m - leaving it out here made TV
            // refuse the resolution and the stock pane sat empty on 1m.
            supported_resolutions: ['1', '5', '15', '30', '60', '240', '1D', '1W'],
            pricescale: pricescaleEq,
            minmov: 1,
            currency_code: 'USD',
            data_status: 'streaming',
            volume_precision: 0,
          })
          return
        }
        // Cost defense: skip the pricescale-detect getBars() call when we've
        // observed this symbol before in this session. The live price ref
        // (refPriceRef) also lets us derive pricescale without any network
        // call on first mount when the parent already has a price.
        // Key by CONTRACT when we have one: the display symbol is a bare
        // ticker for on-chain caps, so two DEX twins sharing a ticker (the
        // PEPE class) were handed each other's decimal precision.
        const tok = tokenRef?.current
        const psKey = tok?.address ? `${tok.address}:${tok.networkId || 1}` : symbolName
        const cached = _pricescaleCache.get(psKey)
        let livePrice = null
        try { livePrice = Number(refPriceRef?.current) || null } catch { livePrice = null }
        const skipBarsFetch = cached != null || (livePrice && livePrice > 0)

        // The parent already resolved this crypto contract and its price.
        // Avoid waiting for udf/symbols to look that price up again before TV
        // can request its first bars. Unknown identities/prices and other
        // requested symbols retain the existing server-resolution path.
        const localInfo = knownCryptoSymbolInfo({
          symbolName,
          chartSymbol,
          token: tok,
          pricescale: cached || computePricescaleFromPrice(livePrice),
        })
        if (localInfo) {
          _pricescaleCache.set(psKey, localInfo.pricescale)
          setTimeout(() => onResolve(localInfo), 0)
          return
        }

        const now = Math.floor(Date.now() / 1000)
        // udf/symbols is GATE-ONLY (trade-api DEMO_ALLOWED_FNS excludes it).
        // A 401 (expired/demo session) or transient failure here used to
        // throw → onNoData → permanent DexScreener iframe fallback, even
        // though /api/bars (demo-allowed) could serve the chart fine. The
        // symbols payload is pure display metadata for crypto, so on ANY
        // fetch failure we synthesize it locally instead of falling back.
        // (audit 2026-06-10: "charts are still dexscreener")
        const [data, recentBars] = await Promise.all([
          fetchJSON(`${API_BASE}/api/tradingview/udf/symbols?symbol=${encodeURIComponent(symbolName)}`)
            .catch(() => ({ name: symbolName, full_name: `CRYPTO:${symbolName}USD` })),
          skipBarsFetch
            ? Promise.resolve([])
            : fetchBars(symbolName, '60', now - 7200, now).catch(() => []),
        ])
        if (data.s === 'error') {
          // Server explicitly knows this symbol doesn't exist (stocks path) —
          // the only resolveSymbol outcome that justifies the iframe fallback.
          if (!noDataFired && onNoDataCb) { noDataFired = true; onNoDataCb() }
          onError(data.errmsg || 'Unknown symbol')
          return
        }

        // Pricescale resolution chain: cache -> live price ref -> bars sample
        // -> server-provided default. Each rung avoids further network cost.
        let pricescale = cached
          || computePricescaleFromPrice(livePrice)
          || (recentBars.length > 0 ? computePricescaleFromPrice(recentBars[recentBars.length - 1].close) : null)
          || data.pricescale
          || 100000
        _pricescaleCache.set(psKey, pricescale)

        onResolve({
          name: data.name || symbolName,
          full_name: data.full_name || `CRYPTO:${symbolName}USD`,
          description: data.description || `${data.name}/USD`,
          type: data.type || 'crypto',
          session: data.session || '24x7',
          exchange: data.exchange || 'CRYPTO',
          listed_exchange: data.listed_exchange || data.exchange || 'CRYPTO',
          timezone: data.timezone || 'Etc/UTC',
          has_intraday: true,
          has_seconds: true,
          seconds_multipliers: ['1'],
          has_daily: true,
          has_weekly_and_monthly: true,
          supported_resolutions: data.supported_resolutions || ['1S', '1', '5', '15', '30', '60', '240', '720', '1D', '1W'],
          pricescale,
          minmov: data.minmov || 1,
          currency_code: data.currency_code || 'USD',
          data_status: 'streaming',
          volume_precision: 2,
        })
      } catch (e) {
        // Both fetches above are individually .catch()-guarded, so this only
        // fires on unexpected synchronous errors. Do NOT trigger the iframe
        // fallback here — a resolve hiccup is not "this token has no data".
        onError(e.message || 'Failed to resolve symbol')
      }
    },

    // ── getBars ────────────────────────────────────────────────────
    async getBars(symbolInfo, resolution, periodParams, onResult, onError) {
      // Destructured OUTSIDE the try: the catch below reads firstDataRequest,
      // and a try-scoped const is invisible there (was a ReferenceError that
      // masked every bars failure and suppressed the onNoData fallback).
      const { from, to, firstDataRequest } = periodParams || {}
      try {
        // Include token address in the cache key so pasting a different token
        // with the same ticker (e.g. two wrapped versions) doesn't surface
        // stale bars from the previous token.
        const addrPart = tokenRef?.current?.address
          ? `@${tokenRef.current.address}:${tokenRef.current.networkId || 1}`
          : ''
        const key = `${symbolInfo.name}:${resolution}${addrPart}`

        // Clear cache on symbol, resolution, or token-address change
        if (key !== cacheSymRes) {
          allBarsCache = []
          cacheSymRes = key
          this._historyExhaustedAt = null
          sparseHalt = null
        }

        // If cache has data (from initial load or scroll-load), return it
        // This fires after resetData() or on subsequent getBars calls
        if (firstDataRequest && allBarsCache.length > 0) {
          // Always re-sort cache defensively in case any code path appended out-of-order
          allBarsCache = mergeBars(allBarsCache)
          // Fill gap between cached data and now
          const lastTime = Math.floor(allBarsCache[allBarsCache.length - 1].time / 1000)
          const now = Math.floor(Date.now() / 1000)
          if (now - lastTime > 60) {
            try {
              const fresh = await fetchBars(symbolInfo.name, resolution, lastTime, now + 60)
              if (fresh.length > 0) {
                allBarsCache = mergeBars(allBarsCache, fresh)
              }
            } catch (e) { /* polling will catch up */ }
          }
          this._earliestBarTime = Math.floor(allBarsCache[0].time / 1000)
          const out = sanitizeBars(allBarsCache, `cache-hit ${key}`)
          onResult(out, { noData: out.length === 0 })
          return
        }

        // Scroll-to-load path: TradingView calls getBars with firstDataRequest=false
        // when the user pans past the loaded range.
        // History paging rework (2026-06-11, "historical data loads very slow"):
        // TV asks for ~300-bar windows one at a time and each used to cost a
        // full upstream round-trip - while GeckoTerminal pages 1000 bars per
        // call and the server threw the out-of-window 70% away. Deep scrolls
        // (PALM back to December) felt broken: ~1.2s per 12-day hop. Now every
        // scroll-back fetch is widened to ~1000 intervals, the superset merges
        // into the cache, repeat pans serve from cache with zero network, and
        // an exhaustion marker stops TV from probing past genesis forever.
        if (!firstDataRequest) {
          // The caller stepped the pill OFF this rung (sparse report in the
          // fresh-load path). TV keeps auto-paging to fill its viewport with
          // bars this tape does not have, and the step cannot land until
          // onChartReady - which waits on that very paging (measured: 30+
          // serial ~1s windows while the "1h" pill was already lit). Answer
          // "no more history" so the initial load completes and setResolution
          // applies. Cleared on the next resolution change, so re-picking the
          // fine rung afterwards pages the raw tape exactly as before.
          if (sparseHalt && sparseHalt === key) { onResult([], { noData: true }); return }
          const resSec = RES_SECONDS[resolution] || 3600
          const oldestCached = allBarsCache.length > 0 ? Math.floor(allBarsCache[0].time / 1000) : null

          // Genesis already reached at/after this point - tell TV to stop.
          // The latch EXPIRES after 60s (2026-06-11 audit): a transient
          // server blip returning [] must not permanently lock scroll-back -
          // worst case post-expiry is one cheap re-probe per minute.
          if (this._historyExhaustedAt != null && to <= this._historyExhaustedAt + resSec) {
            if (Date.now() - (this._historyExhaustedTs || 0) < 60_000) {
              onResult([], { noData: true })
              return
            }
            this._historyExhaustedAt = null
          }

          // Cache already covers the window - serve the slice, zero network.
          if (oldestCached != null && oldestCached <= from) {
            const slice = allBarsCache.filter(b => { const t = Math.floor(b.time / 1000); return t >= from && t < to })
            onResult(sanitizeBars(slice, `scroll-cache ${key}`), { noData: false })
            return
          }

          const wideFrom = Math.max(HISTORY_FLOOR_SEC, Math.min(from, to - resSec * 1000))
          const got = await fetchBars(symbolInfo.name, resolution, wideFrom, to)
          if (got.length === 0) {
            this._historyExhaustedAt = to
            this._historyExhaustedTs = Date.now()
            onResult([], { noData: true })
            return
          }
          const out = sanitizeBars(got, `scroll ${symbolInfo.name}:${resolution} from=${wideFrom} to=${to}`)
          const prevOldest = oldestCached
          allBarsCache = mergeBars(allBarsCache, out)
          if (allBarsCache.length > 0) {
            this._earliestBarTime = Math.floor(allBarsCache[0].time / 1000)
          }
          // The widened fetch found nothing older than what we had - genesis.
          if (prevOldest != null && this._earliestBarTime >= prevOldest) {
            this._historyExhaustedAt = this._earliestBarTime
            this._historyExhaustedTs = Date.now()
          }
          // Return the whole superset (TV accepts bars older than `from` on
          // history requests) - fills several future pans in one shot.
          onResult(out, { noData: false })
          return
        }

        // Fresh load — fetch initial range
        let bars = await fetchBars(symbolInfo.name, resolution, from, to)

        // 2026-05-08 cost migration: aggressive pre-loader removed.
        // Old behavior: 5 background fetches × 500 bars = 5 Codex calls per chart open.
        // New behavior: ship the initial bars immediately. Scroll-back triggers
        // on-demand history fetch via the existing chunk-load path below — user
        // pays only for what they actually look at. First paint is faster too.
        // If we ever decide we need the buffer back, do ONE 500-bar inline pre-fetch
        // here, never 5.

        // Thin-token probe (2026-06-10): an empty FIRST window is not "this
        // token has no data". SPECTRE-class tokens can go 8-9h without a
        // trade, so TV's initial visible-range request can be legitimately
        // empty while months of history exist. Probe a much wider window
        // (~1500 intervals) before declaring no-data — previously this path
        // permanently nuked the chart to the DexScreener iframe.
        //
        // DEAD-TAPE ANCHOR (2026-08-20): TV always asks for a window ending
        // NOW, and 1500 intervals is only ~15 days at 15m. A token whose last
        // trade was 28 days ago (measured on THE DEALER) came back empty from
        // both the window AND the probe, fired onNoData, and the caller bounced
        // the user straight back off the TradingView tab - "TradingView doesn't
        // work" on a token that has a perfectly good July chart. When the
        // parent knows where the tape actually ENDS, probe around that instead
        // of around now.
        if (bars.length === 0) {
          const resSec = RES_SECONDS[resolution] || 3600
          const tapeEnd = Number(tapeEndRef?.current) || 0
          const wideTo = tapeEnd > 0 && tapeEnd < to ? Math.min(to, tapeEnd + resSec * 5) : to
          const wideFrom = Math.max(HISTORY_FLOOR_SEC, Math.min(from, wideTo - resSec * 1500))
          if (wideFrom < from || wideTo < to) {
            try { bars = await fetchBars(symbolInfo.name, resolution, wideFrom, wideTo) } catch { /* keep empty */ }
          }
        }

        // SPARSE FIRST WINDOW (2026-09-05, SPECTRE 1m in LITE cinema): the GT
        // tier gap-fills and fetchBars strips the synthetic rows, so a thin
        // tape's fine-resolution window can land with a HANDFUL of real bars
        // (measured: 2 of 225). TV lays bars out by index and keeps paging
        // history one ~1000-interval window at a time - serially, ~1s each -
        // until the viewport fills: 30+ round trips and 30-100s under
        // "Loading TradingView" while the panel beside it was long done. Widen
        // ONCE (one more GT page, older than the window) so the cadence report
        // below has a real sample and the caller can step to a rung the tape
        // fills in a single request. A dense window never enters here.
        if (firstDataRequest && bars.length > 0 && bars.length < SPARSE_SAMPLE_MIN) {
          const resSec = RES_SECONDS[resolution] || 3600
          const oldest = Math.floor(bars[0].time / 1000)
          const wideFrom = Math.max(HISTORY_FLOOR_SEC, oldest - resSec * 1000)
          if (wideFrom < oldest) {
            try {
              const older = await fetchBars(symbolInfo.name, resolution, wideFrom, oldest)
              if (older.length > 0) bars = mergeBars(older, bars)
            } catch { /* keep the thin window */ }
          }
        }

        // Detect bad Codex data by checking RECENT bars only (last 30).
        // Historical bars may have one-off anomalies that shouldn't poison valid data.
        const isBadData = bars.length > 0 && (() => {
          const recent = bars.slice(-30)

          // All recent bars have zero OHLC (e.g. TAO)
          if (recent.every(b => b.open === 0 && b.high === 0 && b.low === 0 && b.close === 0)) return true

          // Recent bars have impossible values: NaN, Infinity, negative, > $1T (e.g. HYPE)
          if (recent.some(b => [b.open, b.high, b.low, b.close].some(v => !Number.isFinite(v) || v < 0 || v > 1e12))) return true

          // Compare recent bar prices against known live price (catches wrong-pair/magnitude)
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
          const out = sanitizeBars(bars, `fresh ${symbolInfo.name}:${resolution} from=${from} to=${to}`)
          allBarsCache = out
          this._earliestBarTime = Math.floor(out[0].time / 1000)
          // CADENCE HONESTY (2026-08-21, GME-eth): a thin token "supports" any
          // resolution the caller asks for - Codex just returns whatever sparse
          // trade bars exist. Measured on GME (Ethereum): 14 one-minute bars in
          // the last 3h (8% density, median gap 18 min), so a "1m" chart drew
          // 12 days of clumps under a label promising hours. Report the tape's
          // real cadence once per symbol+resolution and let the caller step the
          // interval to a rung the tape can fill. Report-only: bars are still
          // delivered unchanged, so surfaces that don't opt in are untouched.
          if (firstDataRequest && onSparseCb && out.length >= SPARSE_REPORT_MIN) {
            const cadKey = `${symbolInfo.name}:${resolution}`
            if (!sparseReported.has(cadKey)) {
              const ts = out.slice(-60).map((b) => Math.floor(b.time / 1000))
              const gaps = ts.slice(1).map((t, i) => t - ts[i]).filter((g) => g > 0).sort((a, b) => a - b)
              const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0
              const resSec = RES_SECONDS[resolution] || 3600
              if (medianGap > resSec * 3) {
                sparseReported.add(cadKey)
                // A caller that STEPPED (returns true) has retired this rung:
                // halt TV's auto-paging on it so the step can apply.
                let stepped = false
                try { stepped = onSparseCb({ resolution, medianGapSec: medianGap }) === true } catch { /* report-only */ }
                if (stepped) sparseHalt = key
              }
            }
          }
          onResult(out, { noData: out.length === 0 })
        }
      } catch (e) {
        console.error('[TV] getBars error:', e)
        if (firstDataRequest && !noDataFired && onNoDataCb) { noDataFired = true; onNoDataCb() }
        onError(e.message || 'getBars failed')
      }
    },

    // ── subscribeBars ──────────────────────────────────────────────
    subscribeBars(symbolInfo, resolution, onTick, listenerGuid) {
      const wrappedTick = (bar) => {
        if (typeof window !== 'undefined' && window.__TV_DEBUG) {
          console.debug('[TV onTick]', {
            sym: symbolInfo.name,
            res: resolution,
            time: new Date(bar.time).toISOString(),
            close: bar.close,
          })
        }
        onTick(bar)
      }
      if (typeof window !== 'undefined' && window.__TV_DEBUG) {
        console.debug('[TV subscribeBars]', {
          sym: symbolInfo.name,
          res: resolution,
          listenerGuid,
          lastCached: allBarsCache.length
            ? new Date(allBarsCache[allBarsCache.length - 1].time).toISOString()
            : null,
        })
      }
      subscribers.set(listenerGuid, { symbolInfo, resolution, onTick: wrappedTick })
      // Prefer the SSE stream when the token carries (address, networkId).
      // startStreaming itself falls back to startPolling for CEX-ticker tokens.
      startStreaming(resolution)
    },

    // ── unsubscribeBars ────────────────────────────────────────────
    unsubscribeBars(listenerGuid) {
      subscribers.delete(listenerGuid)
      if (subscribers.size === 0) {
        stopStreaming()
        stopPolling()
      }
    },

    // ── getMarks — circle markers with B/S labels on chart ────────
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
            color: { border: isBuy ? '#10b981' : '#EF4444', background: isBuy ? '#10b981' : '#EF4444' },
            text: `${isBuy ? 'Bought' : 'Sold'} $${amt} on ${dateStr}`,
            label: isBuy ? 'B' : 'S',
            labelFontColor: '#ffffff',
            minSize: 20,
          }
        })
      onDataCallback(marks)
    },

    // ── setTradeMarkers — called from React to update marker data ──
    setTradeMarkers(markers) {
      tradeMarkerData = markers || []
    },
  }
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
  tokenColor,
  tradeMarkers,
  onNoData,
  onChartReady: onChartReadyProp,
  referencePrice,
  visibleRangeSec,
  visibleRangeEndSec,
  onIntervalChange,
  onSparseInterval,
  hideIntervalPicker,
  preserveVerticalPageScroll = false,
}) {
  const containerRef = useRef(null)
  const widgetRef = useRef(null)
  const readyRef = useRef(false)
  const datafeedRef = useRef(null)
  // Per-instance visibility flag for the datafeed polling timer. Defaults
  // to true so initial polls work; the IntersectionObserver effect below
  // flips it as the container scrolls in/out of view.
  const visibilityRef = useRef(true)
  const onNoDataRef = useRef(onNoData)
  onNoDataRef.current = onNoData // keep ref fresh without triggering re-render
  const onSparseRef = useRef(onSparseInterval)
  onSparseRef.current = onSparseInterval
  const onChartReadyRef = useRef(onChartReadyProp)
  onChartReadyRef.current = onChartReadyProp
  const refPriceRef = useRef(referencePrice)
  refPriceRef.current = referencePrice
  const tokenRef = useRef(token)
  tokenRef.current = token
  // Where the caller believes this asset's tape ends (unix sec). Only set for a
  // stale tape; the datafeed uses it to aim its empty-window probe.
  const tapeEndRef = useRef(visibleRangeEndSec)
  tapeEndRef.current = visibleRangeEndSec
  // Reported back on every interval change, ours or the user's, so a caller
  // that PRINTS the candle size can print the one actually drawn. Held in a
  // ref: an inline arrow from the caller must not re-run the range effect.
  const onIntervalChangeRef = useRef(onIntervalChange)
  onIntervalChangeRef.current = onIntervalChange
  // Read at widget CREATION (disabled_features is create-time only), so it is a
  // ref like the rest. Callers whose OWN control is a range pass this: without
  // it the widget shows its interval in two places - the toolbar picker and the
  // legend's series title - in TradingView's vocabulary ("4h") next to a pill
  // reading "1M", which reads as a contradiction no matter how the two are
  // explained (founder, twice, 2026-08-20).
  const hideIntervalRef = useRef(hideIntervalPicker)
  hideIntervalRef.current = hideIntervalPicker

  // 2026-06-03 cost war: chart cold-mount used to show a bare-white container
  // for 3-15 seconds while the iframe booted, the charting library loaded,
  // and the first getBars resolved. Users perceived this as "broken". Track
  // chart-ready state so we can render a shimmer skeleton overlay during that
  // window. Resets to false on every symbol change so the skeleton repaints
  // when the user navigates to a different token.
  const [chartReady, setChartReady] = useState(false)

  const chartSymbol = (token?.symbol || symbol || 'BTC').toUpperCase()
  const resolution = TIMEFRAME_TO_RESOLUTION[timeframe] || '60'
  const theme = dayMode ? 'Light' : 'Dark'

  // Build theme + brand override maps. Used both on initial widget creation
  // AND on dayMode / tokenColor changes via applyOverrides() so we never need
  // to destroy the widget for a palette change (which would re-download the
  // charting library, reset the chart, and flash an empty container — see
  // the previous bug where day↔night toggle blanked the chart).
  const themeOverridesRef = useRef(null)
  themeOverridesRef.current = (() => {
    const bgColor = dayMode ? '#ffffff' : '#111113'
    const gridColor = dayMode ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.02)'
    const axisTextColor = dayMode ? '#94a3b8' : 'rgba(245, 245, 247, 0.3)'
    const axisLineColor = dayMode ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.03)'
    const brandHex = tokenColor || '#10B981'
    const r = parseInt(brandHex.slice(1, 3), 16)
    const g = parseInt(brandHex.slice(3, 5), 16)
    const b = parseInt(brandHex.slice(5, 7), 16)
    return {
      'paneProperties.background': bgColor,
      'paneProperties.backgroundType': 'solid',
      'paneProperties.vertGridProperties.color': gridColor,
      'paneProperties.horzGridProperties.color': gridColor,
      'scalesProperties.backgroundColor': bgColor,
      'scalesProperties.textColor': axisTextColor,
      'scalesProperties.lineColor': axisLineColor,
      'mainSeriesProperties.lineStyle.color': brandHex,
      'mainSeriesProperties.areaStyle.linecolor': brandHex,
      'mainSeriesProperties.areaStyle.color1': `rgba(${r}, ${g}, ${b}, 0.28)`,
      'mainSeriesProperties.areaStyle.color2': `rgba(${r}, ${g}, ${b}, 0.02)`,
    }
  })()

  // Create / recreate widget when SYMBOL changes only.
  // Theme + tokenColor updates are handled in-place by a separate effect below.
  useEffect(() => {
    if (!containerRef.current) return

    // Clean up previous widget
    if (widgetRef.current) {
      try { widgetRef.current.remove() } catch (err) { logError('TradingViewAdvanced:widget.remove', err) }
      widgetRef.current = null
      readyRef.current = false
    }
    // Reset the cold-mount shimmer so the skeleton shows while the new widget
    // boots. onChartReady below flips it back to true.
    setChartReady(false)

    function createWidget() {
      if (!containerRef.current || !window.TradingView?.widget) return

      datafeedRef.current = createDatafeed(() => onNoDataRef.current?.(), refPriceRef, tokenRef, visibilityRef, tapeEndRef, (info) => onSparseRef.current?.(info), chartSymbol)

      const bgColor = dayMode ? '#ffffff' : '#111113'
      const gridColor = dayMode ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.02)'
      const textColor = dayMode ? '#1a1a2e' : '#f5f5f7'
      const axisTextColor = dayMode ? '#94a3b8' : 'rgba(245, 245, 247, 0.3)'
      const axisLineColor = dayMode ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.03)'

      // Token brand color overrides for candle up color + line/area chart
      const brandHex = tokenColor || '#10B981'
      const hexToRgba = (hex, a) => {
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        return `rgba(${r}, ${g}, ${b}, ${a})`
      }

      const resolvedTz = resolveTvTimezone()
      try {
        const w = new window.TradingView.widget({
          symbol: chartSymbol,
          interval: resolution,
          container: containerRef.current,
          datafeed: datafeedRef.current,
          library_path: LIBRARY_PATH,
          locale: 'en',
          fullscreen: false,
          autosize: true,
          theme: theme,
          timezone: resolvedTz,
          custom_css_url: '/charting_library/tv-custom.css',
          loading_screen: { backgroundColor: bgColor, foregroundColor: axisTextColor },

          overrides: {
            'paneProperties.background': bgColor,
            'paneProperties.backgroundType': 'solid',
            'paneProperties.vertGridProperties.color': gridColor,
            'paneProperties.horzGridProperties.color': gridColor,
            'scalesProperties.backgroundColor': bgColor,
            'scalesProperties.textColor': axisTextColor,
            'scalesProperties.lineColor': axisLineColor,
            'scalesProperties.fontSize': 11,
            'mainSeriesProperties.candleStyle.upColor': '#10B981',
            'mainSeriesProperties.candleStyle.downColor': '#EF4444',
            'mainSeriesProperties.candleStyle.borderUpColor': '#10B981',
            'mainSeriesProperties.candleStyle.borderDownColor': '#EF4444',
            'mainSeriesProperties.candleStyle.wickUpColor': '#34D399',
            'mainSeriesProperties.candleStyle.wickDownColor': '#F87171',
            'mainSeriesProperties.lineStyle.color': brandHex,
            'mainSeriesProperties.lineStyle.linewidth': 2,
            'mainSeriesProperties.areaStyle.linecolor': brandHex,
            'mainSeriesProperties.areaStyle.color1': hexToRgba(brandHex, 0.28),
            'mainSeriesProperties.areaStyle.color2': hexToRgba(brandHex, 0.02),
            'mainSeriesProperties.areaStyle.linewidth': 2,
            'crossHairProperties.color': 'rgba(245, 245, 247, 0.15)',
            'crossHairProperties.style': 2,
            'crossHairProperties.width': 1,
            'symbolWatermarkProperties.visibility': false,
            // The series title is "SYMBOL - interval - exchange"; the interval
            // in it is the second place the widget states a timeframe. The card
            // above already names the token, so nothing is lost. OHLC, volume
            // and bar-change stay on.
            ...(hideIntervalRef.current
              ? { 'paneProperties.legendProperties.showSeriesTitle': false }
              : {}),
          },

          studies_overrides: {
            'volume.volume.color.0': '#EF4444',
            'volume.volume.color.1': '#10B981',
            'volume.volume.transparency': 75,
          },

          disabled_features: [
            'header_symbol_search',
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
            // Let a vertical touch swipe continue down an embedded research page.
            // Horizontal chart panning, pinch zoom and mouse controls remain enabled.
            ...(preserveVerticalPageScroll ? ['vert_touch_drag_scroll'] : []),
            ...(hideIntervalRef.current ? ['header_resolutions'] : []),
          ],
          enabled_features: [
            'side_toolbar_in_fullscreen_mode',
            'header_in_fullscreen_mode',
          ],
        })

        widgetRef.current = w

        w.onChartReady(() => {
          readyRef.current = true
          setChartReady(true)
          try {
            const chart = w.activeChart()
            // Force the user's local timezone via the imperative API — this wins over any
            // stale value persisted in localStorage from a prior session.
            try {
              const tzApi = chart.getTimezoneApi && chart.getTimezoneApi()
              if (tzApi && typeof tzApi.setTimezone === 'function') {
                tzApi.setTimezone(resolvedTz)
              }
            } catch (tzErr) { if (typeof window !== 'undefined' && window.__TV_DEBUG) console.warn('[TV] setTimezone failed', tzErr) }

            // Notify parent that chart is ready (for adding custom studies/
            // shapes). MUST run before the volume block: a study failure used
            // to kill the rest of this try and silently skip the ready signal.
            if (onChartReadyRef.current) {
              try { onChartReadyRef.current(w, chart) } catch (err) { logError('TradingViewAdvanced:onChartReady', err) }
            }

            // Add volume as overlay on the main price pane - NON-FATAL.
            // TV v27's createStudy returns a PROMISE; the old code passed it
            // straight to getStudyById, which threw "There is no such study"
            // (logged via the error beacon) and could break the whole setup
            // chain. Promise-safe + isolated: a volume failure costs only the
            // volume pane, never the chart.
            // (v27 also dropped the `volumema` input - no MA overlay, wanted.)
            try {
              const volumeIdMaybe = chart.createStudy('Volume', true, false, {}, {
                'volume.color.0': '#ef4444',
                'volume.color.1': '#22c55e',
                'volume.transparency': 75,
              })
              Promise.resolve(volumeIdMaybe).then((volumeId) => {
                if (!volumeId) return
                const study = chart.getStudyById(volumeId)
                study?.setScaleMargins?.({ top: 0.75, bottom: 0 })
              }).catch((err) => console.warn('[TV] volume study skipped:', err?.message || err))
            } catch (err) { console.warn('[TV] volume study skipped:', err?.message || err) }

            // Scroll-to-load is handled by TradingView natively — when the user
            // pans past loaded data, TV calls datafeed.getBars(firstDataRequest=false)
            // with the missing range. We return the bars in-place; no widget reload,
            // no visible jump.
          } catch (err) { logError('TradingViewAdvanced:onChartReady.setup', err) }
        })
      } catch (e) {
        console.error('[TV Advanced] Widget creation failed:', e)
        // Surface the failure so the parent's fallback machinery (tvNoData ->
        // candles/line) renders SOMETHING instead of a dead container (C6).
        // `hard: true` = the widget never mounted, so there is NO live poll to
        // recover on — the parent must fall back even for CEX/major tokens.
        try { onNoDataRef.current?.({ hard: true }) } catch { /* ignore */ }
      }
    }

    // Load the library script if not loaded.
    // Robustness: Research Zone mounts several TVA instances, so the library
    // <script> is shared. A plain addEventListener('load') never refires if the
    // tag already loaded, and the old code had no onerror - so a slow/failed
    // first load left the widget unconstructed and the box bare-white with dead
    // controls until a manual reload. Always retry via createWidget + poll for
    // the global, surface onNoData on hard failure, and drop a poisoned tag so a
    // later mount can refetch.
    let libPollId = null
    const SRC = `${LIBRARY_PATH}charting_library.js`
    const tryCreate = () => {
      if (window.TradingView?.widget) { createWidget(); return true }
      return false
    }
    if (!tryCreate()) {
      const existing = document.querySelector(`script[src="${SRC}"]`)
      if (existing) {
        existing.addEventListener('load', createWidget, { once: true })
        // Poll up to ~6s in case the shared tag's load event already fired.
        let polls = 0
        libPollId = setInterval(() => {
          if (tryCreate() || ++polls > 60) { clearInterval(libPollId); libPollId = null }
        }, 100)
      } else {
        const s = document.createElement('script')
        s.src = SRC
        s.onload = createWidget
        s.onerror = () => {
          // 404 / MIME / parse failure: remove the poisoned tag so a later mount
          // refetches, and surface the no-data state instead of a white box.
          // hard: the library never loaded — no chart, no poll — always fall back.
          try { s.remove() } catch { /* ignore */ }
          onNoDataRef.current?.({ hard: true })
        }
        document.head.appendChild(s)
      }
    }

    return () => {
      if (libPollId) { clearInterval(libPollId); libPollId = null }
      if (widgetRef.current) {
        try { widgetRef.current.remove() } catch (err) { logError('TradingViewAdvanced:cleanup.remove', err) }
        widgetRef.current = null
        readyRef.current = false
      }
    }
  }, [chartSymbol, preserveVerticalPageScroll])

  // Apply theme + brand-color changes IN-PLACE on the live widget. No widget
  // recreate, no library re-download, no empty container flash.
  useEffect(() => {
    const w = widgetRef.current
    if (!w || !readyRef.current) return
    try {
      if (typeof w.changeTheme === 'function') w.changeTheme(theme)
      const chart = w.activeChart && w.activeChart()
      if (chart && typeof chart.applyOverrides === 'function') {
        chart.applyOverrides(themeOverridesRef.current)
      } else if (typeof w.applyOverrides === 'function') {
        w.applyOverrides(themeOverridesRef.current)
      }
    } catch (err) { logError('TradingViewAdvanced:applyTheme', err) }
  }, [theme, tokenColor])

  // ── Resolution + opening window, in that order ─────────────────────────
  // `visibleRangeSec` is opt-in: callers whose control is a RANGE ("1M",
  // "ALL") rather than a candle size pass the span in seconds. Without it the
  // widget shows its own default bar count, so the pill and the drawn window
  // disagreed (LITE: "1D" rendered ~2 days of 30m candles).
  //
  // The two must be ONE effect and strictly ordered. Measured 2026-08-20:
  // firing setVisibleRange on a timer while setResolution was still swapping
  // the series left the toolbar reading the new interval while the legend and
  // candles stayed on the OLD one - a chart that silently ignored the pill.
  // setResolution's callback fires once the new series' data has loaded, so
  // the range is applied against the series it is meant to frame.
  useEffect(() => {
    if (!chartReady || !readyRef.current || !widgetRef.current) return undefined
    let cancelled = false
    const span = Number(visibleRangeSec)
    // Where the window ENDS. Defaults to now, but an on-chain cap that stopped
    // trading weeks ago has nothing at `now` - a now-anchored window is simply
    // empty, which reads as "the chart is broken" rather than "this token is
    // dead". Callers that know the newest bar pass it here.
    const endAt = Number(visibleRangeEndSec) > 0 ? Number(visibleRangeEndSec) : null
    // ONE apply is never enough, and it misses in BOTH directions (measured on
    // 2026-08-20):
    //   too NARROW - a wide window can only frame bars TV already holds, so 1Y
    //     landed on 187 of 365 days on BTC until the history it asked for arrived;
    //   too WIDE  - TV AUTO-FITS to late-arriving bars after we set the range, so
    //     "1D" rendered 3.3 days and "1Y" 1403 days once the daily history
    //     streamed in.
    // So the range is not set once, it is HELD: apply, then watch
    // onVisibleRangeChanged for a short settling window and re-assert whenever
    // TV's own fit drifts more than 25% off the target. Same primitive the
    // trading app's scroll-back anchor uses - the event fires on the tick of the
    // change, so the correction beats the paint instead of flashing.
    //
    // Bounded on every axis so it can never become a fight: it only runs for
    // SETTLE_MS after a pill click, gives up after MAX_CORRECTIONS, and its own
    // setVisibleRange re-fires the event (the delta then reads 0 and no-ops).
    // 4s was enough for a warm switch and not for a COLD one: measured
    // 2026-08-20 on CASHCAT, whose first paint settled long after the window
    // closed and left 1,213 hours drawn under a "1D" pill (the pill switches
    // that followed were all exact). The watch is cheap - it only runs on
    // TradingView's own range events, and its own correction reads delta 0 -
    // so the cost of the longer window is a handful of no-op callbacks.
    const SETTLE_MS = 12000
    const MAX_CORRECTIONS = 10
    let corrections = 0
    let settleSub = null
    let settleTimer = null
    let intervalSub = null
    let selfChange = false
    // The moment the user pans or zooms, the window is theirs. Without this the
    // longer settle window above would yank the view back under their hand.
    // Declared BEFORE stopSettling, which closes over both - a `const` arrow
    // referenced from an earlier-defined function is a TDZ crash waiting for
    // the day someone calls it a line sooner.
    let touchTarget = null
    let stopSettling = () => {}
    const onUserTouch = () => { corrections = MAX_CORRECTIONS; stopSettling() }
    stopSettling = () => {
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null }
      if (settleSub) { try { settleSub.unsubscribeAll(null) } catch { /* torn down */ } settleSub = null }
      if (touchTarget) {
        touchTarget.removeEventListener('pointerdown', onUserTouch, true)
        touchTarget.removeEventListener('mousedown', onUserTouch, true)
        touchTarget.removeEventListener('wheel', onUserTouch, true)
        touchTarget = null
      }
    }
    const applyRange = (watch = true) => {
      if (cancelled || !(span > 0)) return
      try {
        const chart = widgetRef.current?.activeChart?.()
        if (!chart?.setVisibleRange) return
        const to = endAt || Math.floor(Date.now() / 1000)
        // A range wider than the available history clamps; that is fine - TV
        // keeps what it can show rather than blanking, and the drift check
        // below tolerates it because there is nothing more to show.
        const p = chart.setVisibleRange({ from: to - span, to }, { percentRightMargin: 4 })
        if (p && typeof p.catch === 'function') p.catch(() => {})
        if (!watch || settleSub) return
        let lastGot = 0
        const check = () => {
          if (cancelled || corrections >= MAX_CORRECTIONS) { stopSettling(); return }
          let got = 0
          try { const r = chart.getVisibleRange(); got = (r?.to - r?.from) || 0 } catch { got = 0 }
          if (got > 0 && (got < span * 0.8 || got > span * 1.25)) {
            // A window wider than the token's whole life CLAMPS, so the drift
            // never closes and every correction lands on the same number. Give
            // up on the first no-op instead of burning the whole budget on a
            // young token, which is the common case for the small caps here.
            if (got === lastGot) { stopSettling(); return }
            lastGot = got
            corrections += 1
            applyRange(false)
          }
        }
        settleSub = chart.onVisibleRangeChanged && chart.onVisibleRangeChanged()
        if (settleSub) settleSub.subscribe(null, check)
        settleTimer = setTimeout(stopSettling, SETTLE_MS)
        // The listener has to go on the IFRAME's document, not our container:
        // the chart canvas lives inside the widget's iframe and its events never
        // bubble out, so a container-level listener would never fire and the
        // abort would be decorative. The iframe is same-origin (we host the
        // library), guarded anyway.
        try {
          const frame = containerRef.current?.querySelector('iframe')
          touchTarget = frame?.contentDocument || containerRef.current || null
        } catch { touchTarget = containerRef.current || null }
        if (touchTarget) {
          touchTarget.addEventListener('pointerdown', onUserTouch, true)
          touchTarget.addEventListener('mousedown', onUserTouch, true)
          touchTarget.addEventListener('wheel', onUserTouch, true)
        }
      } catch { /* widget mid-teardown */ }
    }
    // THE WINDOW IS OURS, THE CANDLE IS THE USER'S. The caller's control is a
    // range; TradingView's own toolbar carries an interval menu (unless the
    // caller hides it via hideIntervalPicker). Left unwatched the two
    // silently disagreed:
    // measured 2026-08-20 on LIENFI, picking "1 hour" in the toolbar under a
    // "1D" pill left the pill lit and the chart drawing 95 HOURS, and clicking
    // the pill again could not recover it (the props never changed, so this
    // effect never re-ran). TV does not tell the caller its interval moved
    // unless asked - so we ask, and re-assert the window the pill promises at
    // whatever candle size the user just chose. `selfChange` keeps the
    // programmatic path below behaving exactly as it did.
    const rearmRange = () => {
      if (cancelled || !(span > 0)) return
      stopSettling()
      corrections = 0
      applyRange()
    }
    try {
      const chart = widgetRef.current.activeChart()
      intervalSub = chart.onIntervalChanged && chart.onIntervalChanged()
      if (intervalSub) {
        intervalSub.subscribe(null, () => {
          let now = null
          try { now = chart.resolution() } catch { now = null }
          if (now) { try { onIntervalChangeRef.current?.(now) } catch { /* caller's problem */ } }
          if (!selfChange) rearmRange()
        })
      }
      let current = null
      try { current = chart.resolution && chart.resolution() } catch { current = null }
      if (current === resolution) {
        applyRange()
      } else {
        // The CALLBACK is the signal that matters - it fires once the new
        // series' DATA has loaded, which is the only moment a range can stick.
        // The promise can settle earlier, so it is a fallback only: applying on
        // it and then blocking the callback was what let TV's post-load autofit
        // stand. Wrapped, not passed bare - `applyRange`'s first parameter is
        // its own `watch` flag and TV must not get to set it.
        let viaCallback = false
        selfChange = true
        const p = chart.setResolution(resolution, () => { viaCallback = true; selfChange = false; applyRange() })
        if (p && typeof p.then === 'function') {
          p.then(() => { setTimeout(() => { selfChange = false; if (!viaCallback) applyRange() }, 900) }, () => { selfChange = false })
        }
        // Belt and braces: if neither the callback nor the promise ever lands,
        // the flag must not stay stuck true or the user's next manual interval
        // change would go unwatched for the life of the widget.
        setTimeout(() => { selfChange = false }, 8000)
      }
    } catch (e) { /* widget not ready */ }
    return () => {
      cancelled = true
      stopSettling()
      if (intervalSub) { try { intervalSub.unsubscribeAll(null) } catch { /* torn down */ } intervalSub = null }
    }
  }, [resolution, visibleRangeSec, visibleRangeEndSec, chartSymbol, chartReady])

  // ── Trade markers on chart (wallet filter) — uses TV marks API ─────
  useEffect(() => {
    if (!datafeedRef.current) return
    datafeedRef.current.setTradeMarkers(tradeMarkers || [])

    if (readyRef.current && widgetRef.current) {
      try {
        const chart = widgetRef.current.activeChart()
        chart.clearMarks()
        chart.refreshMarks()
      } catch (err) { logError('TradingViewAdvanced:refreshMarks', err) }
    }
  }, [tradeMarkers])

  // IntersectionObserver gate — pause poll when chart scrolls off-screen.
  // The datafeed's polling timer reads `window.__TV_VISIBILITY_GATE`; when
  // false the tick skips its fetch (see startPolling above). Combined with
  // `document.hidden` this kills two of the most common "burn while not
  // looking" cases: minimized tab AND scrolled past the chart.
  useEffect(() => {
    if (!containerRef.current || typeof IntersectionObserver === 'undefined') return
    visibilityRef.current = true
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry) visibilityRef.current = entry.isIntersecting
    }, { threshold: 0.1 })
    observer.observe(containerRef.current)
    return () => { observer.disconnect(); visibilityRef.current = true }
  }, [])

  // FAIL-OPEN: if onChartReady never fires, drop the skeleton anyway so a
  // genuinely-broken chart shows its state instead of an infinite shimmer.
  // 2026-07-02: was 5s — but the self-hosted TV library commonly boots in
  // ~10-14s, so the skeleton vanished mid-load and exposed the raw WHITE
  // un-themed iframe ("chart blank"). onChartReady still removes the dark
  // skeleton the instant the chart is truly ready (typical path); this is
  // only the safety net for a hard failure, so 22s keeps the branded dark
  // loader over the whole normal boot window.
  // White-slab guard (Sunny 2026-07-02: "TA chart doesn't render", solid white).
  // The old fail-open BLINDLY dropped the dark skeleton after a timeout, which
  // exposed a WHITE iframe whenever the TV widget silently failed to paint
  // (stale cached library bundle, CSP/worker hiccup, init throw). Now the
  // fail-open PROBES for a real painted <canvas> inside the widget: if the
  // chart actually rendered, reveal it; if not, keep a DARK "couldn't load"
  // state with a one-tap reload instead of a white void. onChartReady still
  // clears instantly on the normal path.
  const [chartFailed, setChartFailed] = useState(false)
  useEffect(() => { setChartFailed(false) }, [chartSymbol])
  useEffect(() => {
    if (chartReady) return
    const t = setTimeout(() => {
      const painted = hasPaintedChart(containerRef.current)
      if (painted) setChartReady(true)
      else {
        setChartFailed(true)   // keep dark overlay, offer reload — never white
        // Silent mount failure (mobile WebKit class, #1147): surface it so a
        // parent with fallback machinery (trading-chart -> iframe embed) can
        // recover automatically. Parents without onNoData keep the reload UI.
        // hard: the widget never painted in 22s (no canvas) — there is NO live
        // poll to recover on, so the parent must fall back even for majors
        // (BTC/ETH), which otherwise dead-ended on "couldn't load".
        try { onNoDataRef.current?.({ hard: true }) } catch { /* ignore */ }
      }
    }, 22000)
    return () => clearTimeout(t)
  }, [chartSymbol, chartReady])

  return (
    <div style={{ position: 'relative', width: '100%', height: height || '100%' }}>
      <div
        ref={containerRef}
        className="tradingview-advanced-container"
        // Explicit bg: if the TV iframe boots without its theme (blocked CSS,
        // failed datafeed) the pane used to show as a solid WHITE slab on the
        // dark page. The container can't restyle the iframe's interior, but a
        // dark backdrop + colorScheme covers every pre-theme/transparent state.
        style={{ width: '100%', height: '100%', background: dayMode ? '#ffffff' : '#111113', colorScheme: dayMode ? 'light' : 'dark' }}
      />
      {!chartReady && !chartFailed && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: dayMode ? '#ffffff' : '#111113',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 16,
            overflow: 'hidden',
          }}
        >
          {/* Say what is happening. The self-hosted TV library is a 4.4MB
              bundle that commonly boots in ~10-14s on a cold cache, and the
              fail-open sits at 22s — an unlabelled shimmer for that long reads
              as a broken chart rather than a loading one. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 14 }}>
            <span
              className="animate-shimmer"
              style={{ flex: 1, height: 14, borderRadius: 4, background: dayMode ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)' }}
            />
            <span style={{
              flex: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
              color: dayMode ? 'rgba(15,23,42,0.4)' : 'rgba(245,245,247,0.32)', whiteSpace: 'nowrap',
            }}>Loading TradingView</span>
          </div>
          <div className="animate-shimmer" style={{ flex: 1, borderRadius: 6, background: dayMode ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)' }} />
          <div className="animate-shimmer" style={{ height: 32, width: '100%', borderRadius: 4, background: dayMode ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)' }} />
        </div>
      )}
      {!chartReady && chartFailed && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 2,
            background: dayMode ? '#ffffff' : '#111113',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
            color: dayMode ? '#475569' : 'rgba(245,245,247,0.6)', fontSize: 13,
          }}
        >
          <span>Chart couldn't load this time.</span>
          <button
            type="button"
            onClick={() => { try { window.location.reload() } catch { setChartFailed(false); setChartReady(false) } }}
            style={{
              padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${dayMode ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.12)'}`,
              background: dayMode ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.06)',
              color: dayMode ? '#0f172a' : '#f5f5f7', fontSize: 13, fontWeight: 600,
            }}
          >Reload chart</button>
        </div>
      )}
    </div>
  )
})

export default TradingViewAdvanced
