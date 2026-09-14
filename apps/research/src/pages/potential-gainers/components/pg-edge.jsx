/*
 * PGEdge - "The Edge": the cumulative equity-curve hero.
 *
 * The most conversion-relevant artifact on the page. Computes a real
 * cumulative equity curve from /api/momentum/setups/performance: every
 * fully-matured tracked day adds $100 per aged signal (winners AND losers)
 * plus that day's realized PnL - the curve is the running return on that
 * equal-weight book.
 *
 * Rendered on TradingView's lightweight-charts (via the shared PGTimeChart
 * host) as a Baseline series: green above the 0% line, red below. A real
 * gridded % axis and dated time axis - the chart engine that every serious
 * trading product uses, themed down to Spectre's hairline restraint.
 *
 * Only rows that have reached a full 72h exit (maturity_status 'matured')
 * count toward the book, so the curve and headline stay consistent with the
 * win-rate chart and the Track Record instead of being diluted by
 * not-yet-aged positions whose PnL is still marking to current.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { BaselineSeries } from 'lightweight-charts'
import { useMomentumPerformance } from '@/hooks/useMomentumData'
import { useXDashSurface } from '@/hooks/useXDashSurface'
import useSettingsStore from '@/store/useSettingsStore'
import { toNumber, addCalendarDays, formatAxisDay, maturityOf } from './pg-utils'
import PGTimeChart from './pg-time-chart'

const EDGE_CHART_H = 248
const EDGE_STRAT_PARAMS = {} // stable ref for the track-record surface hook

/* full-precision USD - "$16,548", not "$16.5K". Precise reads as real. */
function usd(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  const r = Math.round(n)
  return `${r < 0 ? '-$' : '$'}${Math.abs(r).toLocaleString('en-US')}`
}
function signedPct(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}

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

/* Baseline series colors - bright line, richer area gradient that fades
   cleanly to transparent at the baseline. Marker reads as the live point. */
const SERIES_COLORS = {
  dark: {
    topLineColor: '#34D399',
    topFillColor1: 'rgba(52,211,153,0.30)',
    topFillColor2: 'rgba(52,211,153,0)',
    bottomLineColor: '#F87171',
    bottomFillColor1: 'rgba(248,113,113,0)',
    bottomFillColor2: 'rgba(248,113,113,0.30)',
    crosshairMarkerBorderColor: '#09090b',
    crosshairMarkerBackgroundColor: '#34D399',
  },
  day: {
    topLineColor: '#10B981',
    topFillColor1: 'rgba(16,185,129,0.20)',
    topFillColor2: 'rgba(16,185,129,0)',
    bottomLineColor: '#EF4444',
    bottomFillColor1: 'rgba(239,68,68,0)',
    bottomFillColor2: 'rgba(239,68,68,0.20)',
    crosshairMarkerBorderColor: '#ffffff',
    crosshairMarkerBackgroundColor: '#10B981',
  },
}

/*
 * EdgeChartLayer - owns the Baseline series on the shared chart host plus the
 * HTML hover tooltip. Mounted only once the chart instance exists, so `chart`
 * is always live here.
 */
function EdgeChartLayer({ chart, model, dayMode }) {
  const seriesRef = useRef(null)
  const overlayRef = useRef(null)
  const [hover, setHover] = useState(null)

  /* create the baseline series once per chart instance */
  useEffect(() => {
    if (!chart) return undefined
    chart.applyOptions({
      localization: { priceFormatter: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}%` },
    })
    const colors = dayMode ? SERIES_COLORS.day : SERIES_COLORS.dark
    const series = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      lineWidth: 2,
      lineType: 0, // Simple - honest straight segments between tracked days
      priceLineVisible: false,
      lastValueVisible: false, // headline already states the live return; pill collided with axis ticks
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 5,
      crosshairMarkerBorderWidth: 2,
      priceFormat: {
        type: 'custom',
        formatter: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`,
        minMove: 0.1,
      },
      ...colors,
    })
    /* faint 0% reference line - anchors the climb without axis clutter */
    series.createPriceLine({
      price: 0,
      color: dayMode ? 'rgba(15,23,42,0.14)' : 'rgba(245,245,247,0.14)',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: false,
    })
    seriesRef.current = series
    return () => { seriesRef.current = null }
  }, [chart])

  /* live day-mode re-theme of the series colors */
  useEffect(() => {
    if (seriesRef.current) {
      seriesRef.current.applyOptions(dayMode ? SERIES_COLORS.day : SERIES_COLORS.dark)
    }
  }, [dayMode])

  /* push data + fit the view whenever the model changes */
  useEffect(() => {
    const series = seriesRef.current
    if (!series || !model) return
    series.setData(model.lwcData)
    chart.timeScale().fitContent()
  }, [chart, model])

  /* hover scrub - read the curve at each tracked day via the crosshair */
  useEffect(() => {
    if (!chart || !model) return undefined
    const handler = (param) => {
      if (!param || !param.point || param.time == null) { setHover(null); return }
      const pt = model.byTime.get(timeKey(param.time))
      if (!pt) { setHover(null); return }
      setHover({ pt, x: param.point.x })
    }
    chart.subscribeCrosshairMove(handler)
    return () => chart.unsubscribeCrosshairMove(handler)
  }, [chart, model])

  const hp = hover?.pt || null
  const width = overlayRef.current?.clientWidth || 1
  const frac = hover ? hover.x / width : 0.5
  const tipEdge = frac > 0.72 ? ' pg-edge__tip--left' : frac < 0.28 ? ' pg-edge__tip--right' : ''

  return (
    <div ref={overlayRef} className="pg-edge__overlay">
      {hp && (
        <div
          className={`pg-edge__tip${tipEdge}`}
          style={{ left: `${hover.x}px` }}
        >
          <div className="pg-edge__tip-date">{hp.origin ? 'Start' : formatAxisDay(hp.date)}</div>
          <div className={`pg-edge__tip-ret pg-tone--${hp.ret >= 0 ? 'up' : 'down'}`}>
            {signedPct(hp.ret)}
          </div>
          {hp.origin ? (
            <div className="pg-edge__tip-note">Book opens &mdash; nothing deployed yet</div>
          ) : (
            <>
              <div className="pg-edge__tip-row">
                <span>Book value</span><strong>{usd(hp.book)}</strong>
              </div>
              <div className="pg-edge__tip-row">
                <span>That day</span>
                <strong>{hp.daySignals} signals &middot; {signedPct(hp.dayRet)}</strong>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function PGEdge({ timeframe = '7d', bucket = 'top10', enabled = true }) {
  const dayMode = useSettingsStore((s) => s.dayMode)
  const { data, loading, error } = useMomentumPerformance({ timeframe, days: 21, enabled })
  const [chart, setChart] = useState(null)

  // The strategy edge: Spectre's momentum ledger (an all-time population,
  // NOT the 21-day board the chart is built from), filtered server-side to
  // small caps (entry mcap < $5M, known at entry) with an exit MODELED at 30%
  // off each call's whole-life peak — the track-record backtest. The
  // equal-weight book above is the RAW signal (~breakeven); this is what the
  // strategy backtest returns on that ledger.
  const { data: trData } = useXDashSurface('/api/xdash/track-record', EDGE_STRAT_PARAMS, { ttlMs: 300_000 })
  const trSummary = trData && trData.data ? trData.data.summary : null
  // prefer the SIGNAL-lane trailing book (the calls Spectre actually surfaced,
  // entry-time gate) over the broader small-cap cut; fall back when the API
  // hasn't shipped the signals block yet.
  const sig = trSummary && trSummary.signals && trSummary.signals.calls ? trSummary.signals : null
  const strat = trSummary ? trSummary.strategy : null
  const stratRoi = sig ? toNumber(sig.trail_roi)
    : (strat && strat.causal_smallcap ? toNumber(strat.causal_smallcap.trail_roi) : null)
  const stratN = sig ? toNumber(sig.calls)
    : (strat && strat.causal_smallcap ? toNumber(strat.causal_smallcap.n) : null)
  const stratIsSignals = Boolean(sig)

  /* Walk the MATURED daily rows into a cumulative equal-weight book. A row
     counts only once every signal has finished its 72h exit (maturity
     'matured'); partial / pending days are excluded so the book is not
     diluted by open positions still marking to current. */
  const model = useMemo(() => {
    const rows = (Array.isArray(data?.rows) ? data.rows : [])
      .filter((r) => (
        r?.date
        && String(r?.bucket || '') === bucket
        && maturityOf(r) === 'matured'
        && toNumber(r.pnl_100_each) != null
      ))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    if (rows.length < 2) return null

    let cumInv = 0
    let cumPnl = 0
    /* origin: the book is flat at 0% before the first matured day, so the
       curve visibly climbs from zero. Dated one day before the first row so
       lightweight-charts has a real, ordered timestamp for it. */
    const originTime = addCalendarDays(rows[0].date, -1)
    const pts = [{ time: originTime, date: rows[0].date, ret: 0, origin: true, book: 0, daySignals: 0, dayRet: 0 }]
    rows.forEach((r) => {
      const count = toNumber(r.aged_signals) ?? toNumber(r.signals) ?? 0
      const dayPnl = toNumber(r.pnl_100_each) ?? 0
      cumInv += count * 100
      cumPnl += dayPnl
      pts.push({
        time: String(r.date).slice(0, 10),
        date: r.date,
        ret: cumInv > 0 ? (cumPnl / cumInv) * 100 : 0,
        book: cumInv + cumPnl,
        daySignals: count,
        dayRet: count > 0 ? (dayPnl / (count * 100)) * 100 : 0,
      })
    })
    const last = pts[pts.length - 1]
    return {
      pts,
      lwcData: pts.map((p) => ({ time: p.time, value: p.ret })),
      byTime: new Map(pts.map((p) => [p.time, p])),
      days: rows.length,
      retPct: last.ret,
      invested: cumInv,
      pnl: cumPnl,
      result: cumInv + cumPnl,
      signals: Math.round(cumInv / 100),
    }
  }, [data, bucket])

  /* ---- loading ---- */
  if (loading && !data) {
    return (
      <section className="pg-edge pg-edge--loading" data-tour="pg-edge">
        <span className="pg-shimmer-bar pg-shimmer-bar--sm animate-shimmer" />
        <span className="pg-shimmer-bar pg-shimmer-bar--lg animate-shimmer" style={{ marginTop: 10, width: '38%' }} />
        <span className="pg-shimmer-bar animate-shimmer" style={{ marginTop: 20, height: EDGE_CHART_H, borderRadius: 8 }} />
      </section>
    )
  }

  /* ---- empty / error ---- */
  if (error || !model) {
    return (
      <section className="pg-edge pg-edge--empty" data-tour="pg-edge">
        <span className="pg-edge__eyebrow">Equal-weight model return</span>
        <p className="pg-edge__empty-line">
          The performance model builds as Potential Gainers signals mature to a full 72h exit.
        </p>
      </section>
    )
  }

  const up = model.retPct >= 0

  return (
    <section className="pg-edge" data-tour="pg-edge">
      <div className="pg-edge__top">
        <div className="pg-edge__headline">
          {stratRoi != null ? (
            <>
              <span className="pg-edge__eyebrow pg-edge__eyebrow--strat">
                {stratIsSignals
                  ? 'The strategy · signal calls + trailing exit'
                  : 'The strategy · small-cap filter + trailing exit'}
              </span>
              <span className={`pg-edge__figure pg-edge__figure--strat${stratRoi >= 0 ? '' : ' pg-edge__figure--down'}`}>
                {signedPct(stratRoi)}
              </span>
              <span className="pg-edge__flow-sub">
                {stratN != null ? `${stratN} calls · ` : ''}
                {stratIsSignals ? '12+ callers or board top-10 at entry' : 'small caps under $5M'}
                {' · exit modeled 30% off peak · entry-time filter'}
              </span>
            </>
          ) : (
            <>
              <span className="pg-edge__eyebrow">Raw signal &middot; equal-weight &middot; marked at the average of its 24h/48h/72h checkpoints</span>
              <span className={`pg-edge__figure${up ? '' : ' pg-edge__figure--down'}`}>
                {signedPct(model.retPct)}
              </span>
              <span className="pg-edge__flow-sub">
                $100 per signal &middot; {model.signals} signals &middot; {usd(model.pnl)} booked
              </span>
            </>
          )}
        </div>
        {stratRoi != null && (
          <div className="pg-edge__strat pg-edge__strat--raw">
            <span className="pg-edge__eyebrow">Raw signal &middot; equal-weight &middot; 24/48/72h checkpoint average</span>
            <span className={`pg-edge__figure pg-edge__figure--raw${up ? '' : ' pg-edge__figure--down'}`}>
              {signedPct(model.retPct)}
            </span>
            <span className="pg-edge__flow-sub">
              $100 per signal &middot; {model.signals} signals &middot; {usd(model.pnl)} booked &middot; the unfiltered foil
            </span>
          </div>
        )}
      </div>

      <div className="pg-edge__chart">
        <PGTimeChart height={EDGE_CHART_H} dayMode={dayMode} onChart={setChart} />
        {chart && <EdgeChartLayer chart={chart} model={model} dayMode={dayMode} />}
      </div>

      <p className="pg-edge__foot">
        {stratRoi != null ? (
          <>The chart is the RAW signal &mdash; every call, equal weight, marking each at the 24/48/72h checkpoint
          average instead of holding blind (~breakeven, winners and losers included). The headline runs the strategy
          on Spectre&apos;s momentum ledger &mdash; {stratIsSignals
            ? 'the signal lane (12+ callers or board top-10 at first sighting)'
            : 'small caps (entry under $5M)'}, exit modeled at 30% off peak &mdash;
          and it returns {signedPct(stratRoi)}. The entry filter is entry-time only; the exit is a modeled best case.
          Not a projection of your account.</>
        ) : (
          <>Historical model of every published signal that has reached its full 72h exit &mdash; equal
          weight, winners and losers included. Not a projection of your account.</>
        )}
      </p>
    </section>
  )
}
