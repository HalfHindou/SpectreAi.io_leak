/**
 * LiqHeatmapPanel — the real liquidation heatmap, reusable outside /liquidation-heatmap.
 *
 * Wraps the components Evgeniy built for the dedicated page (`useRealHeatmap` +
 * `HeatmapView`) so the Command Center's Liquidation tab and Traders Corner can
 * mount the SAME chart instead of each carrying its own.
 *
 * 🪤 Traders Corner previously drew its "Liq Map" with `generateLiquidationMap()`
 * (pages/liquidation-heatmap/components/liquidation-map-chart.js) — a much
 * cruder synthesizer that derives the field from OHLC alone across a fixed ±12%
 * band, which is why that panel rendered a blurry blob that stopped ~55% across
 * the plot with a price axis narrower than the candles. This one is built from
 * public OI + klines and spans the real range.
 *
 * Honest about what it is: the field is MODELLED, not measured. See the note in
 * `apps/research/api/_lib/handlers/charts-proxy.js` — the authoritative Spectre
 * heatmap tier returns "No heatmap data cached" for every symbol, so every
 * request lands on the Binance synthesizer. `label` lets the host surface say so.
 */
import { Suspense, useState } from 'react'
import lazy from '@/lib/lazy-with-retry'
import useRealHeatmap from '@/pages/liquidation-heatmap/components/use-real-heatmap'
import useLiqMap from './use-liq-map'
// 🪤 HeatmapView's markup is `.liqp-real-heatmap` / `.liqp-hm-*`, and ALL 152 of
// those rules live in liquidation-page.css — views.css only carries the view-tab
// and Levels/Zones styles. Importing views.css alone rendered the chart fine but
// left the whole toolbar (symbol picker, timeframe, exchange filter, threshold
// slider, magnets, replay) as unstyled elements stacked down the left edge.
import '@/pages/liquidation-heatmap/components/liquidation-page.css'
import '@/pages/liquidation-heatmap/components/liquidation-page.mobile.css'
import '@/pages/liquidation-heatmap/components/views.css'
import './liq-heatmap-panel.css'

// The view pulls the canvas renderer + its chart maths; keep it off the boot path.
const HeatmapView = lazy(() => import('@/pages/liquidation-heatmap/components/heatmap-view'))
const LiqMapChart = lazy(() => import('./liq-map-chart'))
const BandsView = lazy(() => import('@/pages/liquidation-heatmap/components/bands-view'))

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT']

export default function LiqHeatmapPanel({
  symbol = 'BTCUSDT',
  setSymbol,
  enabled = true,
  dayMode = false,
  fmtPrice,
  symbols = DEFAULT_SYMBOLS,
  height = 460,
  note = 'Leverage-cluster density modelled from open interest + price action',
}) {
  // Heatmap = magnitude over TIME. Bands = the same field over time coloured by
  // SIDE, with the price path. Map = levels over PRICE, by leverage tier.
  // Three views of one model, so they share the symbol and only one fetches —
  // and heatmap/bands share the SAME fetch, since they read the same field.
  const [view, setView] = useState('heatmap')
  const usesField = view === 'heatmap' || view === 'bands'
  const {
    heatmapData, klineData, loading, error, retry,
    timeframe, setTimeframe, TIMEFRAMES,
  } = useRealHeatmap(symbol, 'Binance', enabled && usesField)
  const liq = useLiqMap(symbol, '1d', enabled && view === 'map')

  return (
    // lhp--day mirrors the dayMode prop — the same flag the canvases paint from —
    // so the CSS plate can never disagree with what the chart drew. Hosts outside
    // .app (LITE paper) have no .app.app-day-mode to key off.
    <div className={`lhp${dayMode ? ' lhp--day' : ''}`} style={{ '--lhp-h': `${height}px` }}>
      <div className="lhp-views" role="tablist" aria-label="Liquidation view">
        {[{ k: 'heatmap', l: 'Heatmap' }, { k: 'bands', l: 'Bands' }, { k: 'map', l: 'Liquidation Map' }].map((v) => (
          <button
            key={v.k}
            type="button"
            role="tab"
            aria-selected={view === v.k}
            className={`lhp-view${view === v.k ? ' lhp-view--on' : ''}`}
            onClick={() => setView(v.k)}
          >{v.l}</button>
        ))}
      </div>
      {view === 'map' ? (
        <Suspense fallback={<div className="lhp-skel" />}>
          <LiqMapChart map={liq.map} loading={liq.loading} error={liq.error} dark={!dayMode} height={height} />
        </Suspense>
      ) : view === 'bands' ? (
        <Suspense fallback={<div className="lhp-skel" />}>
          <BandsView
            heatmapData={heatmapData}
            klineData={klineData}
            loading={loading}
            error={error}
            dayMode={dayMode}
            fmtPrice={fmtPrice}
            height={height}
          />
        </Suspense>
      ) : (
      <Suspense fallback={<div className="lhp-skel" />}>
        <HeatmapView
          heatmapData={heatmapData}
          klineData={klineData}
          loading={loading}
          error={error}
          retry={retry}
          timeframe={timeframe}
          setTimeframe={setTimeframe}
          TIMEFRAMES={TIMEFRAMES}
          dayMode={dayMode}
          fmtPrice={fmtPrice}
          fullSymbol={symbol}
          setFullSymbol={setSymbol}
          ALL_SYMBOLS={symbols}
        />
      </Suspense>
      )}
      {/* Bands carries its own, longer provenance line — showing both stacked
          two near-identical "modelled from open interest" sentences. */}
      {note && view !== 'bands' ? <p className="lhp-note">{note}</p> : null}
    </div>
  )
}
