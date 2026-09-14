/*
 * PGTrackRecord - the Potential Gainers track-record proof surface.
 *
 * Two coordinated parts:
 *
 *   1. WIN-RATE HISTORY  - a daily win-rate chart over the tracked window
 *      (/api/momentum/setups/performance -> rows[]), rendered on
 *      TradingView's lightweight-charts via the shared PGTimeChart host.
 *      Days are split by the API's `maturity_status`:
 *        matured -> Official WR (win_rate_pct), solid filled area
 *        partial -> still aging, current_win_rate_pct, dashed tail
 *        pending -> live mark-to-market, current_win_rate_pct, dashed tail
 *      The still-aging tail is a dashed line with LIVE / AGING markers and
 *      is never removed - nothing is hidden, it is just separated from the
 *      official record. A 50% coin-flip baseline makes the edge legible and
 *      a faint signal-count histogram keeps the SAMPLE SIZE visible.
 *
 *   2. BIGGEST CALLS  - the 10 strongest tracked signals, each a card with
 *      the full story: flagged at $X mcap -> peak +Y% (Zh after the call)
 *      -> now +W%. A 3-point time-ordered trajectory draws the run-up and
 *      settle. Clicking a card opens the token drawer.
 *
 * Honest wording only: "tracked", "measured", "since we flagged it" - never
 * "predicted", never "guaranteed". Losers are never hidden - the WR chart
 * shows every day including the ones below the 50% line.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { AreaSeries, LineSeries, HistogramSeries, LineStyle, createSeriesMarkers } from 'lightweight-charts'
import { useMomentumPerformance, useMomentumReceipts } from '@/hooks/useMomentumData'
import useSettingsStore from '@/store/useSettingsStore'
import {
  formatSignedPct, formatPct, formatCompact, formatMarketCap, returnTone,
  relativeTime, formatStamp, formatAxisDay, toNumber, maturityOf,
} from './pg-utils'
import PGTimeChart from './pg-time-chart'

/* Effective peak return: the highest return seen since the signal. The live
   CoinGecko overlay refreshes the current return but NOT the backend peak
   field, so a token at a fresh high can read now > peak. The true peak is the
   max of the two - this keeps peak >= now everywhere. */
function effectivePeak(pg) {
  const peak = toNumber(pg?.peak_return_since_signal_pct)
  const now = toNumber(pg?.return_since_signal_pct)
  if (peak == null) return now
  if (now == null) return peak
  return Math.max(peak, now)
}

/* A first-ever RECEIPT carries a token's honest all-time story: flagged at
   signal_market_cap on first_seen_at, then the peak / now returns measured
   ONLY from that first flag. Normalize it to the CallCard row shape so the
   biggest-calls reel + Best Call can read the full tracked record (the same
   reconciled proof the Proof Timeline shows, ANSEM included) instead of the
   live board — where a token that already ran + aged out is gone, and a call
   whose entry was recorded late (ANSEM's mis-set $90.9M top-tick) reads ~0%. */
/* A row from the momentum_origin ledger (X Dash track-record) -> CallCard shape.
   This is the SAME truth the live board anchors to, and the honest source for
   the biggest-calls reel: the collector's /setups/receipts records some runners
   from their LATE top-10 flag (ANSEM at $90.9M / 0% instead of its real $5.8M
   spot -> +6893%), so they silently drop off the peak-ranked reel. */
function trackRecordToCallRow(c) {
  const entry = toNumber(c?.entry_market_cap)
  const last = toNumber(c?.last_market_cap)
  const entryDate = c?.entry_date || null
  const ageMs = entryDate ? Date.now() - new Date(entryDate).getTime() : NaN
  const hoursToPeak = (entryDate && c?.peak_at)
    ? (new Date(c.peak_at).getTime() - new Date(entryDate).getTime()) / 3600000
    : null
  return {
    token: {
      cg_id: c?.asset,
      symbol: c?.symbol,
      name: c?.name || c?.symbol,
      image_small: c?.image_small || c?.image || null,
      image_url: c?.image || c?.image_small || null,
    },
    potential_gainer: {
      signal: { market_cap: entry, signaled_at: entryDate },
      current_market_cap: last,
      return_since_signal_pct: toNumber(c?.roi_pct),
      peak_return_since_signal_pct: toNumber(c?.peak_roi_pct),
      age_since_signal_hours: Number.isFinite(ageMs) ? ageMs / 3600000 : null,
      hours_to_peak: hoursToPeak != null && hoursToPeak >= 0 ? hoursToPeak : null,
    },
  }
}

function receiptToCallRow(r) {
  const raf = r?.returns_after_first_seen || {}
  const now = toNumber(raf.human_return_pct ?? raf.return_since_signal_pct ?? r?.return_since_signal_pct)
  const peak = toNumber(raf.peak_return_since_signal_pct)
  const firstSeen = r?.first_seen_at || r?.signal?.signaled_at || null
  const ageMs = firstSeen ? Date.now() - new Date(firstSeen).getTime() : NaN
  return {
    token: r?.token || { cg_id: r?.cg_id },
    potential_gainer: {
      signal: { market_cap: toNumber(r?.signal_market_cap), signaled_at: firstSeen },
      current_market_cap: toNumber(r?.current_market_cap),
      return_since_signal_pct: now,
      peak_return_since_signal_pct: peak != null ? peak : now,
      age_since_signal_hours: Number.isFinite(ageMs) ? ageMs / 3600000 : null,
      hours_to_peak: toNumber(raf.hours_to_peak),
    },
  }
}

/* ---------- per-token call trajectory (entry -> peak -> now, time-ordered) ---------- */

/* A compact 3-point path. X is real time (0 -> peak hour -> current age),
   Y is return %. Shows the genuine "ran up then settled" shape, not a
   value-sorted abstraction. */
function CallTrajectory({ peakPct, nowPct, hoursToPeak, ageHours }) {
  const W = 150
  const H = 66
  const P = 8

  const peak = toNumber(peakPct) ?? 0
  const now = toNumber(nowPct) ?? 0
  const age = toNumber(ageHours)
  let hp = toNumber(hoursToPeak)
  if (hp != null && age != null && hp > age) hp = age

  /* time fractions for the three dots */
  const fPeak = (age != null && age > 0 && hp != null) ? hp / age : 0.5
  const xf = [0, Math.max(0.06, Math.min(0.94, fPeak)), 1]
  const vals = [0, peak, now]

  const maxV = Math.max(...vals, 0)
  const minV = Math.min(...vals, 0)
  const range = Math.max(maxV - minV, 1)

  const xs = xf.map((f) => P + f * (W - 2 * P))
  const ys = vals.map((v) => P + (1 - (v - minV) / range) * (H - 2 * P))

  const tone = returnTone(now)
  const linePts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
  const areaPts = `${xs[0].toFixed(1)},${H} ${linePts} ${xs[2].toFixed(1)},${H}`

  return (
    <svg
      className={`pg-tr-traj pg-tr-traj--${tone}`}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
    >
      <polygon className="pg-tr-traj__area" points={areaPts} />
      <polyline className="pg-tr-traj__line" points={linePts} />
      <circle className="pg-tr-traj__dot pg-tr-traj__dot--entry" cx={xs[0]} cy={ys[0]} r="3" />
      <circle className="pg-tr-traj__dot pg-tr-traj__dot--peak" cx={xs[1]} cy={ys[1]} r="3.7" />
      <circle className={`pg-tr-traj__dot pg-tr-traj__dot--${tone}`} cx={xs[2]} cy={ys[2]} r="3.2" />
    </svg>
  )
}

function CallAvatar({ src, symbol }) {
  const letter = String(symbol || '?').replace(/^\$/, '').charAt(0).toUpperCase() || '?'
  if (!src) {
    return <span className="pg-tr-call__logo pg-tr-call__logo--fallback" aria-hidden="true">{letter}</span>
  }
  return (
    <img
      className="pg-tr-call__logo"
      src={src}
      alt={symbol || ''}
      width={32}
      height={32}
      loading="lazy"
      onError={(e) => {
        const span = document.createElement('span')
        span.className = 'pg-tr-call__logo pg-tr-call__logo--fallback'
        span.textContent = letter
        e.currentTarget.replaceWith(span)
      }}
    />
  )
}

/* ---------- one "biggest call" card ---------- */

function CallCard({ rank, row, onOpenToken }) {
  const token = row?.token || {}
  const pg = row?.potential_gainer || {}
  const signal = pg.signal || {}

  const symbol = token.symbol ? String(token.symbol).replace(/^\$/, '') : '—'
  const cgId = token.cg_id
  const now = toNumber(pg.return_since_signal_pct)
  const peakRaw = toNumber(pg.peak_return_since_signal_pct)
  /* when the live current return tops the backend peak, the token is at a
     fresh high - "now" IS the peak (see effectivePeak) */
  const liveAtPeak = peakRaw != null && now != null && now > peakRaw
  const peak = liveAtPeak ? now : (peakRaw ?? now)
  const age = toNumber(pg.age_since_signal_hours)
  const hoursToPeak = liveAtPeak ? age : toNumber(pg.hours_to_peak)
  const signalMcap = toNumber(signal.market_cap)
  const stamp = formatStamp(signal.signaled_at)

  const peakTone = returnTone(peak)
  const nowTone = returnTone(now)
  const clickable = Boolean(cgId) && typeof onOpenToken === 'function'
  const open = () => { if (clickable) onOpenToken(cgId) }

  /* compact "13h" / "2.1d" label for time-to-peak - suppressed when the
     token is at a live high (peak == now, so "Xh after" would mislead) */
  let peakWhen = null
  if (!liveAtPeak && hoursToPeak != null) {
    peakWhen = hoursToPeak < 1 ? '<1h'
      : hoursToPeak < 24 ? `${Math.round(hoursToPeak)}h`
        : `${(hoursToPeak / 24).toFixed(1)}d`
  }

  return (
    <article
      className={`pg-tr-call${clickable ? ' pg-tr-call--clickable' : ''}`}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Open ${symbol} signal detail` : undefined}
      onClick={clickable ? open : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
      } : undefined}
    >
      <div className="pg-tr-call__head">
        <span className="pg-tr-call__rank">{rank}</span>
        <CallAvatar src={token.image_small || token.image_url} symbol={symbol} />
        <div className="pg-tr-call__id">
          <span className="pg-tr-call__sym">{symbol}</span>
          <span className="pg-tr-call__name">{token.name || cgId || 'Unknown'}</span>
        </div>
      </div>

      <div className="pg-tr-call__flagged">
        {stamp ? (
          <>
            <span className="pg-tr-call__flagged-when">
              Flagged {stamp}
              {signal.signaled_at && (
                <span className="pg-tr-call__flagged-ago"> · {relativeTime(signal.signaled_at)}</span>
              )}
            </span>
            <span className="pg-tr-call__flagged-mcap">
              at <strong>{formatMarketCap(signalMcap)}</strong> mcap
            </span>
          </>
        ) : (
          <span className="pg-tr-call__flagged-when pg-tr-call__flagged-when--none">
            No signal timestamp
          </span>
        )}
      </div>

      <div className="pg-tr-call__traj">
        <CallTrajectory peakPct={peak} nowPct={now} hoursToPeak={hoursToPeak} ageHours={age} />
      </div>

      <div className="pg-tr-call__returns">
        <div className="pg-tr-call__return">
          <span className={`pg-tr-call__return-val pg-tone--${peakTone}`}>
            {formatSignedPct(peak)}
          </span>
          <span className="pg-tr-call__return-label">
            peak{peakWhen ? ` · ${peakWhen} after` : (liveAtPeak ? ' · live high' : '')}
          </span>
        </div>
        <div className="pg-tr-call__return">
          <span className={`pg-tr-call__return-val pg-tone--${nowTone}`}>
            {formatSignedPct(now)}
          </span>
          <span className="pg-tr-call__return-label">now</span>
        </div>
      </div>
    </article>
  )
}

/* ---------- the win-rate history chart (lightweight-charts) ---------- */

const WR_CHART_H = 276

/* lightweight-charts hands back the crosshair time in whatever shape the data
   used; normalize every shape to a 'YYYY-MM-DD' key for the point lookup. */
function timeKey(t) {
  if (t == null) return null
  if (typeof t === 'string') return t.slice(0, 10)
  if (typeof t === 'number') return new Date(t * 1000).toISOString().slice(0, 10)
  if (typeof t === 'object' && t.year) {
    const m = String(t.month).padStart(2, '0')
    const d = String(t.day).padStart(2, '0')
    return `${t.year}-${m}-${d}`
  }
  return String(t)
}

/* WR series colors. Win rate is a RATE, not a return, so it stays warm-white /
   neutral - never --bull/--bear, which are reserved for price returns. */
const WR_COLORS = {
  dark: {
    line: '#f5f5f7',
    areaTop: 'rgba(245,245,247,0.20)',
    areaBottom: 'rgba(245,245,247,0)',
    dash: 'rgba(245,245,247,0.42)',
    count: 'rgba(245,245,247,0.13)',
    base: 'rgba(245,245,247,0.22)',
    marker: 'rgba(245,245,247,0.5)',
    markerLive: '#f5f5f7',
  },
  day: {
    line: '#0f172a',
    areaTop: 'rgba(15,23,42,0.13)',
    areaBottom: 'rgba(15,23,42,0)',
    dash: 'rgba(15,23,42,0.4)',
    count: 'rgba(15,23,42,0.12)',
    base: 'rgba(15,23,42,0.28)',
    marker: 'rgba(15,23,42,0.5)',
    markerLive: '#0f172a',
  },
}

/*
 * WRChartLayer - owns the win-rate series on the shared chart host plus the
 * HTML hover tooltip. Three series: a solid Area for matured days, a dashed
 * Line for the still-aging tail, and a faint Histogram for the daily signal
 * count. Mounted only once the chart instance exists, so `chart` is live here.
 */
function WRChartLayer({ chart, model, dayMode }) {
  const refs = useRef({})
  const overlayRef = useRef(null)
  const [hover, setHover] = useState(null)

  /* create the three series + the 50% baseline once per chart instance */
  useEffect(() => {
    if (!chart) return undefined
    chart.applyOptions({ localization: { priceFormatter: (v) => `${Math.round(v)}%` } })
    const c = dayMode ? WR_COLORS.day : WR_COLORS.dark
    const pf = { type: 'custom', formatter: (v) => `${Math.round(v)}%`, minMove: 1 }

    const area = chart.addSeries(AreaSeries, {
      lineColor: c.line,
      topColor: c.areaTop,
      bottomColor: c.areaBottom,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      priceFormat: pf,
    })
    const dash = chart.addSeries(LineSeries, {
      color: c.dash,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      priceFormat: pf,
    })
    const count = chart.addSeries(HistogramSeries, {
      color: c.count,
      priceScaleId: 'count',
      priceLineVisible: false,
      lastValueVisible: false,
    })
    chart.priceScale('count').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false,
    })
    const baseline = area.createPriceLine({
      price: 50,
      color: c.base,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'coin-flip',
    })
    const markers = createSeriesMarkers(dash, [])
    refs.current = { area, dash, count, baseline, markers }
    return () => { refs.current = {} }
  }, [chart])

  /* live day-mode re-theme */
  useEffect(() => {
    const { area, dash, count, baseline } = refs.current
    if (!area) return
    const c = dayMode ? WR_COLORS.day : WR_COLORS.dark
    area.applyOptions({ lineColor: c.line, topColor: c.areaTop, bottomColor: c.areaBottom })
    dash.applyOptions({ color: c.dash })
    count.applyOptions({ color: c.count })
    baseline.applyOptions({ color: c.base })
  }, [dayMode])

  /* push data + markers whenever the model changes */
  useEffect(() => {
    const { area, dash, count, markers } = refs.current
    if (!area || !model) return
    area.setData(model.solidData)
    dash.setData(model.dashedData)
    count.setData(model.countData)
    const c = dayMode ? WR_COLORS.day : WR_COLORS.dark
    markers.setMarkers(model.markerDays.map((d) => ({
      time: d.time,
      position: 'aboveBar',
      shape: 'circle',
      color: d.maturity === 'pending' ? c.markerLive : c.marker,
      text: d.maturity === 'pending' ? 'LIVE' : 'AGING',
    })))
    const range = { minValue: model.wrRange.min, maxValue: model.wrRange.max }
    const provider = () => ({ priceRange: range })
    area.applyOptions({ autoscaleInfoProvider: provider })
    dash.applyOptions({ autoscaleInfoProvider: provider })
    chart.timeScale().fitContent()
  }, [chart, model, dayMode])

  /* hover scrub - read the chart at each tracked day via the crosshair */
  useEffect(() => {
    if (!chart || !model) return undefined
    const handler = (param) => {
      if (!param || !param.point || param.time == null) { setHover(null); return }
      const day = model.byTime.get(timeKey(param.time))
      if (!day) { setHover(null); return }
      setHover({ day, x: param.point.x })
    }
    chart.subscribeCrosshairMove(handler)
    return () => chart.unsubscribeCrosshairMove(handler)
  }, [chart, model])

  const day = hover?.day || null
  const width = overlayRef.current?.clientWidth || 1
  const frac = hover ? hover.x / width : 0.5
  const tipEdge = frac > 0.74 ? ' pg-tr-chart__tip--left' : frac < 0.26 ? ' pg-tr-chart__tip--right' : ''
  const matured = day?.maturity === 'matured'

  return (
    <div ref={overlayRef} className="pg-tr-chart__overlay">
      {day && (
        <div className={`pg-tr-chart__tip${tipEdge}`} style={{ left: `${hover.x}px` }}>
          <div className="pg-tr-chart__tip-date">
            {formatAxisDay(day.date)}
            {!matured && (
              <span className={`pg-tr-chart__tip-tag${day.maturity === 'pending' ? ' pg-tr-chart__tip-tag--live' : ''}`}>
                {day.maturity === 'pending' ? 'Live' : 'Aging'}
              </span>
            )}
          </div>
          <div className="pg-tr-chart__tip-wr">
            <span className={`pg-tone--${(toNumber(day.displayWr) ?? 0) >= 50 ? 'up' : 'down'}`}>
              {formatPct(day.displayWr, 0)}
            </span>
            <span className="pg-tr-chart__tip-wr-label">
              {matured ? 'official win rate' : 'live win rate'}
            </span>
          </div>
          <div className="pg-tr-chart__tip-rows">
            <div className="pg-tr-chart__tip-row">
              <span>Signals tracked</span>
              <strong>{day.signals != null ? day.signals : '—'}</strong>
            </div>
            <div className="pg-tr-chart__tip-row">
              <span>Hit +25% / +50%</span>
              <strong>{formatPct(day.hit25, 0)} / {formatPct(day.hit50, 0)}</strong>
            </div>
            <div className="pg-tr-chart__tip-row">
              <span>Avg return</span>
              <strong className={`pg-tone--${returnTone(day.avg)}`}>{formatSignedPct(day.avg, 0)}</strong>
            </div>
          </div>
          {!matured && (
            <div className="pg-tr-chart__tip-aging">
              Still aging: this day has not completed the 72h window. Current WR is live
              mark-to-market and may change.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WinRateChart({ days }) {
  const dayMode = useSettingsStore((s) => s.dayMode)
  const [chart, setChart] = useState(null)

  /* Split the tracked days by maturity. Matured days carry the official win
     rate and draw as a solid filled area; partial + pending days draw as a
     dashed tail off the last matured point - visible, never counted as proof
     until the 72h window closes. */
  const model = useMemo(() => {
    const valued = days.filter((d) => toNumber(d.displayWr) != null)
    if (valued.length < 2) return null

    let lastMatured = -1
    valued.forEach((d, i) => { if (d.maturity === 'matured') lastMatured = i })

    const solid = lastMatured >= 0 ? valued.slice(0, lastMatured + 1) : []
    const dashed = lastMatured >= 0 ? valued.slice(lastMatured) : valued.slice()
    const toPoint = (d) => ({ time: d.time, value: d.displayWr })

    const counts = days
      .filter((d) => toNumber(d.signals) != null && d.signals > 0)
      .map((d) => ({ time: d.time, value: d.signals }))

    const wrs = valued.map((d) => d.displayWr)
    const lo = Math.max(0, Math.min(42, Math.min(...wrs) - 8))
    const hi = Math.min(100, Math.max(64, Math.max(...wrs) + 6))

    return {
      solidData: solid.map(toPoint),
      dashedData: dashed.length > 1 ? dashed.map(toPoint) : [],
      countData: counts,
      markerDays: valued.filter((d) => d.maturity !== 'matured'),
      byTime: new Map(valued.map((d) => [d.time, d])),
      wrRange: { min: lo, max: hi },
    }
  }, [days])

  if (!model) {
    return (
      <div className="pg-empty pg-empty--compact">
        <div className="pg-empty__detail">Not enough tracked days to chart yet.</div>
      </div>
    )
  }

  return (
    <div className="pg-tr-chart">
      <PGTimeChart height={WR_CHART_H} dayMode={dayMode} onChart={setChart} />
      {chart && <WRChartLayer chart={chart} model={model} dayMode={dayMode} />}
    </div>
  )
}

/* ---------- shimmer ---------- */

function CallShimmer() {
  return (
    <div className="pg-tr-call pg-tr-call--shimmer">
      <div className="pg-tr-call__head">
        <span className="pg-shimmer-dot animate-shimmer" />
        <span className="pg-shimmer-bar pg-shimmer-bar--md animate-shimmer" />
      </div>
      <span className="pg-shimmer-bar pg-shimmer-bar--sm animate-shimmer" />
      <span className="pg-shimmer-bar pg-shimmer-bar--row animate-shimmer" />
      <span className="pg-shimmer-bar pg-shimmer-bar--md animate-shimmer" />
    </div>
  )
}

function TrackRecordShimmer() {
  return (
    <>
      <div className="pg-tr__stats">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="pg-tr__stat pg-tr__stat--shimmer">
            <span className="pg-shimmer-bar pg-shimmer-bar--sm animate-shimmer" />
            <span className="pg-shimmer-bar pg-shimmer-bar--lg animate-shimmer" />
          </div>
        ))}
      </div>
      <div className="pg-shimmer-bar animate-shimmer" style={{ width: '100%', height: 264, borderRadius: 'var(--radius-md)' }} />
      <div className="pg-tr__calls-grid">
        {Array.from({ length: 6 }).map((_, i) => <CallShimmer key={i} />)}
      </div>
    </>
  )
}

/* ---------- main ---------- */

export default function PGTrackRecord({
  timeframe = '7d',
  bucket = 'top10',
  signals,
  signalsLoading = false,
  performanceSummary,
  trackRecordCalls,
  onOpenToken,
  enabled = true,
}) {
  const { data, loading, error, refetch } = useMomentumPerformance({ timeframe, days: 21, enabled })

  /* All-time proof for the highlight reel. Same source (+ same params) as the
     Proof Timeline (PGReceipts), so the module cache serves it once. */
  const { data: receiptsData } = useMomentumReceipts({
    timeframe, bucket, model: 'first_ever', days: 21, limit: 50, enabled,
  })

  /* Performance rows -> chart days. The endpoint returns BOTH buckets in one
     array, so filter to the selected one; sort oldest-first. Maturity is read
     from the API's maturity_status field; matured days carry the official win
     rate, partial / pending days carry the live mark-to-market read. */
  const days = useMemo(() => {
    const rows = Array.isArray(data?.rows) ? data.rows : []
    return rows
      .filter((r) => r?.date && String(r?.bucket || '') === bucket)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((r) => {
        const maturity = maturityOf(r)
        const matured = maturity === 'matured'
        const wr = toNumber(r.win_rate_pct)
        const liveWr = toNumber(r.current_win_rate_pct)
        return {
          date: r.date,
          time: String(r.date).slice(0, 10),
          maturity,
          wr,
          liveWr,
          displayWr: matured ? wr : liveWr,
          signals: toNumber(r.signals),
          aged: toNumber(r.aged_signals),
          hit25: toNumber(r.hit25_pct),
          hit50: toNumber(r.hit50_pct),
          avg: matured ? toNumber(r.average_return_pct) : toNumber(r.current_average_return_pct),
          pnl: matured ? toNumber(r.pnl_100_each) : toNumber(r.current_pnl_100_each),
        }
      })
  }, [data, bucket])

  /* Candidate calls for the highlight reel + Best Call. Prefer the reconciled
     all-time first-ever receipts; fall back to the live board only when
     receipts are unavailable so the reel never goes empty. Ranking off the live
     board alone understated every real winner (it's the currently-tracked 10-day
     window, and ANSEM's late-recorded entry reads 0% there). */
  const callRows = useMemo(() => {
    // Prefer the momentum_origin ledger (X Dash track-record) — the same truth
    // the live board anchors to, and the only source that carries the real
    // first-sighting entry + peak (so ANSEM's +6893% run shows, instead of the
    // collector's late-flagged 0% receipt that drops it off the reel entirely).
    const tr = Array.isArray(trackRecordCalls) ? trackRecordCalls : []
    if (tr.length > 0) {
      return tr
        .map(trackRecordToCallRow)
        .filter((row) => row.token && (row.token.cg_id || row.token.symbol))
    }
    // Fallbacks: collector receipts, then the live board.
    const rec = Array.isArray(receiptsData?.receipts) ? receiptsData.receipts : []
    if (rec.length > 0) {
      return rec
        .map(receiptToCallRow)
        .filter((row) => row.token && (row.token.cg_id || row.token.symbol))
    }
    return Array.isArray(signals) ? signals : []
  }, [trackRecordCalls, receiptsData, signals])

  /* The 10 biggest tracked calls - ranked by peak return reached after we
     flagged them. The WR chart above carries the full record (losers and
     all); this is explicitly the highlight reel. */
  const topCalls = useMemo(() => callRows
    .filter((row) => effectivePeak(row?.potential_gainer) != null)
    .slice()
    .sort((a, b) => effectivePeak(b?.potential_gainer) - effectivePeak(a?.potential_gainer))
    .slice(0, 10), [callRows])

  /* "N of X tracked" - the real tracked universe (aged signals), not the size
     of the highlight-reel candidate list. */
  const totalTracked = toNumber(performanceSummary?.aged_signals) ?? callRows.length

  /* Headline numbers. Lifetime WR is aged-signal-weighted across the MATURED
     rows only (a heavy day counts more than a 1-signal day) - more honest than
     a plain average of daily rates, and it never counts a still-aging day. */
  const stats = useMemo(() => {
    let wWins = 0
    let wTotal = 0
    days.forEach((d) => {
      if (d.maturity !== 'matured' || d.wr == null || d.aged == null) return
      wWins += (d.wr / 100) * d.aged
      wTotal += d.aged
    })
    const lifetimeWR = wTotal > 0
      ? (wWins / wTotal) * 100
      : toNumber(performanceSummary?.average_daily_win_rate_pct)

    const signalsTracked = toNumber(performanceSummary?.aged_signals)

    /* Best Call = the strongest peak across the same all-time proof set that
       feeds the biggest-calls reel, so the headline can't undercut the reel. */
    let bestPeak = null
    let bestSym = null
    callRows.forEach((row) => {
      const p = effectivePeak(row?.potential_gainer)
      if (p != null && (bestPeak == null || p > bestPeak)) {
        bestPeak = p
        bestSym = row?.token?.symbol ? String(row.token.symbol).replace(/^\$/, '') : null
      }
    })

    const pnl = toNumber(performanceSummary?.pnl_100_each)
    const invested = toNumber(performanceSummary?.invested_100_each)

    return { lifetimeWR, signalsTracked, bestPeak, bestSym, pnl, invested }
  }, [days, callRows, performanceSummary])

  const showShimmer = loading && !data
  const isError = !loading && error
  const noData = !loading && !error && days.length === 0 && topCalls.length === 0

  return (
    <section className="pg-panel pg-tr" data-tour="pg-proof">
      <header className="pg-panel__head">
        <div>
          <h3 className="pg-panel__title">Track Record</h3>
          <p className="pg-panel__sub">
            Every Potential Gainers signal, tracked from the moment we flagged it. Win rate is the
            share of signals that aged positive after the 72h proof window &mdash; losers included,
            nothing filtered.
          </p>
        </div>
      </header>

      {showShimmer && <TrackRecordShimmer />}

      {isError && (
        <div className="pg-empty pg-empty--error">
          <div className="pg-empty__title">Track record unavailable</div>
          <div className="pg-empty__detail">{error}</div>
          <button type="button" className="pg-btn pg-btn--ghost" onClick={() => refetch()}>Retry</button>
        </div>
      )}

      {noData && (
        <div className="pg-empty">
          <div className="pg-empty__title">No tracked record yet</div>
          <div className="pg-empty__detail">
            The track record builds as Potential Gainers signals mature to an exit.
          </div>
        </div>
      )}

      {!showShimmer && !isError && !noData && (
        <>
          {/* headline proof band */}
          <div className="pg-tr__stats">
            <div className="pg-tr__stat pg-tr__stat--hero">
              <span className="pg-tr__stat-label">Lifetime Win Rate</span>
              <span className={`pg-tr__stat-value${stats.lifetimeWR != null ? ` pg-tone--${stats.lifetimeWR >= 50 ? 'up' : 'down'}` : ''}`}>
                {stats.lifetimeWR != null ? formatPct(stats.lifetimeWR, 0) : '—'}
              </span>
              <span className="pg-tr__stat-sub">aged-signal weighted</span>
            </div>
            <div className="pg-tr__stat">
              <span className="pg-tr__stat-label">Signals Tracked</span>
              <span className="pg-tr__stat-value">
                {stats.signalsTracked != null ? Math.round(stats.signalsTracked).toLocaleString('en-US') : '—'}
              </span>
              <span className="pg-tr__stat-sub">matured to an exit</span>
            </div>
            <div className="pg-tr__stat">
              <span className="pg-tr__stat-label">Best Call</span>
              <span className={`pg-tr__stat-value${stats.bestPeak != null ? ` pg-tone--${returnTone(stats.bestPeak)}` : ''}`}>
                {stats.bestPeak != null ? formatSignedPct(stats.bestPeak, 0) : '—'}
              </span>
              <span className="pg-tr__stat-sub">
                {stats.bestSym ? `peak · ${stats.bestSym}` : 'peak since signal'}
              </span>
            </div>
            <div className="pg-tr__stat">
              <span className="pg-tr__stat-label">Simulated PnL</span>
              <span className={`pg-tr__stat-value${stats.pnl != null ? ` pg-tone--${returnTone(stats.pnl)}` : ''}`}>
                {stats.pnl != null
                  ? `${stats.pnl >= 0 ? '+' : '-'}$${formatCompact(Math.abs(stats.pnl), 1)}`
                  : '—'}
              </span>
              <span className="pg-tr__stat-sub">
                {stats.invested != null ? `$100 / signal on $${formatCompact(stats.invested, 0)}` : '$100 into every signal'}
              </span>
            </div>
          </div>

          {/* win-rate history chart */}
          {days.length > 0 && (
            <div className="pg-tr__block">
              <div className="pg-tr__block-head">
                <span className="pg-tr__block-title">
                  Win rate &middot; last {days.length} day{days.length > 1 ? 's' : ''}
                </span>
                <span className="pg-tr__legend">
                  <span className="pg-tr__legend-item">
                    <span className="pg-tr__legend-swatch pg-tr__legend-swatch--wr" />
                    Official win rate
                  </span>
                  <span className="pg-tr__legend-item">
                    <span className="pg-tr__legend-swatch pg-tr__legend-swatch--dash" />
                    Still aging (live)
                  </span>
                  <span className="pg-tr__legend-item">
                    <span className="pg-tr__legend-swatch pg-tr__legend-swatch--bar" />
                    Signals / day
                  </span>
                </span>
              </div>
              <WinRateChart days={days} />
              <p className="pg-tr-copy">
                <strong>Official win rate</strong> only counts signals after the full 72h proof
                window. Recent days remain visible as live mark-to-market so nothing is hidden, but
                they are not counted in the official WR until they mature.
              </p>
            </div>
          )}

          {/* biggest calls */}
          {topCalls.length > 0 && (
            <div className="pg-tr__block">
              <div className="pg-tr__block-head">
                <span className="pg-tr__block-title">Biggest calls</span>
                <span className="pg-tr__block-meta">
                  {topCalls.length} of {totalTracked} tracked &middot; ranked by peak return since signal
                </span>
              </div>
              <div className="pg-tr__calls-grid">
                {topCalls.map((row, i) => (
                  <CallCard
                    key={row?.token?.cg_id || row?.token?.symbol || i}
                    rank={i + 1}
                    row={row}
                    onOpenToken={onOpenToken}
                  />
                ))}
              </div>
            </div>
          )}

          {topCalls.length === 0 && signalsLoading && (
            <div className="pg-tr__calls-grid">
              {Array.from({ length: 6 }).map((_, i) => <CallShimmer key={i} />)}
            </div>
          )}
        </>
      )}
    </section>
  )
}
