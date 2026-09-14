/**
 * Cinema chart = the SAME TradingView widget Research runs (founder call
 * 2026-08-21, lite-cinema-charts-unification-plan.md). The interval pills speak
 * TV's own vocabulary (lite-research owns the ladder and its traps - no 720 rung,
 * '1M' means one MINUTE in TVA), the widget charts ADDRESS-FIRST for on-chain
 * caps, and the lightweight SLChart stays only as the automatic fallback when
 * TV genuinely cannot serve this token (unsupported bare ticker, hard no-data).
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { tvIdentityFor } from '@/pages/lite/components/lite-tv-identity'
import {
  TV_INTERVALS, TV_INTERVAL_BY_ID, TVA_TO_INTERVAL_ID,
  TV_WINDOW_BARS, intervalIdFromRes, tvWindowFor,
} from '@/pages/lite/components/lite-research'
import SLChart from './sl-chart'

const TradingViewAdvanced = lazy(() => import('@/components/TradingViewAdvanced'))

const TV_INT_KEY = 'sl-tvchart-int'

export default function SLTvChart({ token, quote, edges, isLight, height = 440, onMeta, resolving = false }) {
  const sym = String(token?.symbol || '').toUpperCase()
  const isStock = !!token?.isStock
  const address = !isStock ? (token?.address || null) : null
  const networkId = Number(token?.networkId) || null

  // Same gate as Research (tvIdentityFor): address-first for on-chain
  // (unambiguous identity, pinned to the GT pool series SLChart draws), bare
  // tickers only where the clean Binance lane really carries them, and the
  // registry contract for CG-listed coins with no CEX pair (SPECTRE-class -
  // the bare ticker gets [] from /api/bars). Anything else would let "DOS"
  // resolve to whichever twin trades under that name - the exact class this
  // rebuild exists to kill.
  const tvIdentity = useMemo(
    () => tvIdentityFor({ sym, isStock, isOnchain: !!address, onchainContract: address, networkId }),
    [sym, isStock, address, networkId],
  )
  const tvToken = tvIdentity.token
  const tvSymbol = tvIdentity.symbol

  // Hard TV failures retire the widget for this symbol (session-scoped) and the
  // lightweight chart takes over; a soft empty answer only falls back without
  // retiring, so the next token or a re-open can try again.
  const [tvDead, setTvDead] = useState(() => new Set())
  const [tvSoftFail, setTvSoftFail] = useState(false)
  useEffect(() => { setTvSoftFail(false) }, [sym, address])
  const handleTvNoData = useCallback((info) => {
    setTvSoftFail(true)
    if (info?.hard) setTvDead((prev) => (prev.has(sym) ? prev : new Set(prev).add(sym)))
  }, [sym])

  // Interval pills - TV vocabulary, remembered across tokens like the old TF
  // pill was. Seeded from the daily edges when nothing is remembered, so a
  // young token opens on a candle size its whole life can actually fill.
  const [intervalId, setIntervalId] = useState(() => {
    try { const s = localStorage.getItem(TV_INT_KEY); return TV_INTERVAL_BY_ID[s] ? s : null } catch { return null }
  })
  const seeded = useMemo(() => {
    if (intervalId) return intervalId
    const w = tvWindowFor('1M', edges?.historySec || null)
    return TVA_TO_INTERVAL_ID[w.res] || '1h'
  }, [intervalId, edges?.historySec])
  const interval = TV_INTERVAL_BY_ID[seeded] || TV_INTERVAL_BY_ID['1h']
  const pickInterval = (id) => { setIntervalId(id); try { localStorage.setItem(TV_INT_KEY, id) } catch { /* */ } }
  const onTvIntervalChange = useCallback((raw) => {
    const id = intervalIdFromRes(raw)
    if (id) setIntervalId(id)
  }, [])
  // Sparse-cadence auto-step - the same rule Research runs (charts-system.md
  // I11, fourth follow-up), and the reason the cinema pane used to sit under
  // "Loading TradingView" for 30-100s: a thin token on the REMEMBERED fine
  // rung (1m from the last major) hands TV a few real bars per window and TV
  // pages history one ~1s round trip at a time until the viewport fills
  // (measured on SPECTRE 1m: 30+ serial /api/bars; on 1h: 2). Step the pill
  // up to the first rung the tape can fill - visibly, the pill moves. NOT
  // persisted: the next token still opens on the user's own pick, and a
  // dense tape never reports. Once per sym+resolution, so re-picking the fine
  // rung afterwards shows the raw sparse truth instead of fighting the user.
  const sparseSteppedRef = useRef(new Set())
  // Returns true when it stepped - the datafeed then stops TV's auto-paging on
  // the retired rung, which is what let the step apply at all.
  const onTvSparse = useCallback(({ resolution, medianGapSec }) => {
    const key = `${sym}:${resolution}`
    if (sparseSteppedRef.current.has(key)) return false
    sparseSteppedRef.current.add(key)
    const target = TV_INTERVALS.find((r) => r.sec >= medianGapSec) || TV_INTERVALS[TV_INTERVALS.length - 1]
    const curSec = TV_INTERVAL_BY_ID[intervalIdFromRes(resolution)]?.sec || 0
    if (target.sec > curSec) { setIntervalId(target.id); return true }
    return false
  }, [sym])

  // Opening window: TV_WINDOW_BARS candles of the chosen interval, clamped to
  // the tape that exists (never ASK for history the token does not have - the
  // young-token lesson from charts-system.md I7). Crypto only; stocks have
  // session gaps nothing in this stack models yet.
  const spanSec = useMemo(() => {
    if (isStock) return undefined
    const want = interval.sec * TV_WINDOW_BARS
    const hist = Number(edges?.historySec) || 0
    return hist > 0 ? Math.max(interval.sec * 3, Math.min(want, hist)) : want
  }, [isStock, interval.sec, edges?.historySec])

  const tvUsable = !!tvSymbol && !tvDead.has(sym) && !tvSoftFail

  // Identity still resolving: DON'T fall back yet. The fallback keys off
  // `token.address`, which is empty until the resolver lands, so rendering it
  // now fired a bare-ticker /api/bars (measured on PORTAL) - a wasted request
  // that can briefly paint a same-ticker twin's tape before TV takes over.
  if (resolving && !tvUsable) {
    return (
      <div className="sl-chartx-wrap">
        <div className="sl-chartx-bar" />
        <div className="sl-chartx" style={{ height }}><div className="sl-chartx-loading" /></div>
      </div>
    )
  }

  if (!tvUsable) {
    // The honest fallback: the lightweight chart's own lanes (contract-keyed
    // /api/bars, CG-OHLC for listed coins) plus its existing empty states.
    return <SLChart token={token} isLight={isLight} height={height} onMeta={onMeta} />
  }

  return (
    <div className="sl-chartx-wrap">
      <div className="sl-chartx-bar">
        <div className="lite-look-toggle sl-chartx-tf" role="tablist" aria-label="Candle size">
          {TV_INTERVALS.map((iv) => (
            <button
              key={iv.id} type="button" role="tab" aria-selected={interval.id === iv.id}
              className={`lite-look-btn${interval.id === iv.id ? ' active' : ''}`}
              onClick={() => pickInterval(iv.id)}
            >
              {iv.id}
            </button>
          ))}
        </div>
      </div>
      <div className="sl-tv-embed" style={{ height }}>
        <Suspense fallback={<div className="sl-chartx-loading" />}>
          <TradingViewAdvanced
            // The contract is part of the key: two tokens can share a ticker,
            // and remounting on the symbol alone would leave the previous
            // twin's series under the new header (same rule as Research).
            key={`${tvSymbol}:${address || '-'}`}
            symbol={tvSymbol}
            timeframe={interval.tva}
            visibleRangeSec={spanSec}
            visibleRangeEndSec={isStock ? undefined : (edges?.endSec || undefined)}
            dayMode={isLight}
            height={height}
            token={tvToken}
            // Only a TRUSTED quote (GT-by-contract for on-chain, CG for listed)
            // may seed the widget's pricescale - TVA's bad-data guard kills the
            // chart when the bars sit >100x from this number, so a wrong hero
            // price here nukes a good series (charts-system.md I3).
            referencePrice={Number(quote) > 0 ? Number(quote) : undefined}
            onNoData={handleTvNoData}
            onIntervalChange={onTvIntervalChange}
            onSparseInterval={isStock ? undefined : onTvSparse}
            // One timeframe control on this card, and it is the pill row.
            hideIntervalPicker
          />
        </Suspense>
      </div>
    </div>
  )
}
