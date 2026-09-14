/**
 * lite-liq.jsx - the Liquidations view of LITE (liquidation-heatmap reflection).
 *
 * The REAL shared heatmap panel (the chart Command Center and Traders Corner
 * mount) stays the centrepiece; LITE wraps it with a human read of the same
 * field: the price now and the nearest long pool below / short pool above
 * (from Traders Corner's useLiquidationLevels - the same Binance-cohort
 * heatmap, last column). The panel is lazy so its canvas renderer + the liqp
 * CSS stay out of the Lite chunk until the tab opens.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { tl } from './lite-i18n'
import lazyWithRetry from '@/lib/lazy-with-retry'
import { useTranslation } from 'react-i18next'
import { track, Events } from '@/services/analytics'
import { useLiquidationLevels } from '@/pages/traders-corner/use-liquidation-levels'
import './lite-liq.css'

const LiteLiqPanel = lazyWithRetry(() => import('@/components/liq-heatmap-panel'))

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT']
const base = (s) => String(s || '').replace(/USDT$/, '')
const pctAway = (p, cur) => (cur > 0 ? ((p - cur) / cur) * 100 : 0)
const fmtAway = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M12 5l7 7-7 7" /></svg>
)

export default function LiqView({ fmtPrice, fmtLargeShort, onOpenPath, light, imgBySym, onNav }) {
  const { t } = useTranslation()
  const [symbol, setSymbol] = useState('BTCUSDT')
  const levels = useLiquidationLevels(symbol)
  const [win24, setWin24] = useState(null)

  useEffect(() => {
    let cancelled = false
    import('@/services/spectreMarketApi')
      .then(({ getSpectreLiquidationWindows }) => getSpectreLiquidationWindows())
      .then((w) => { if (!cancelled) setWin24(w?.windows?.['24h'] || null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const sym = base(symbol)
  const cur = levels.currentPrice
  // Nearest = closest to price on each side; biggest = the deepest pool per side.
  const nearest = useMemo(() => {
    const shorts = [...(levels.shorts || [])].sort((a, b) => a.price - b.price)
    const longs = [...(levels.longs || [])].sort((a, b) => b.price - a.price)
    return { short: shorts[0] || null, long: longs[0] || null }
  }, [levels.shorts, levels.longs])

  const openPro = () => { track(Events.LITE_PRO_DOOR, { path: '/liquidation-heatmap' }); onOpenPath?.('/liquidation-heatmap') }

  return (
    <div className="lite-view lite-lq">
      <header className="lite-view-head lite-lq-head lite-rise">
        <div>
          <h1 className="lite-view-title">{tl(t, 'Liquidations', 'ttl')}</h1>
          <p className="lite-view-sub">{tl(t, 'Where leveraged positions get forced out - the zones price tends to hunt.', 'sub')}</p>
        </div>
        <div className="lite-chips lite-lq-coins" role="tablist" aria-label={t('lite.liqview.ariaCoin', "Coin")}>
          {SYMBOLS.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={symbol === s} className={`lite-chip${symbol === s ? ' active' : ''}`} onClick={() => setSymbol(s)}>
              {imgBySym?.[base(s)] ? <img className="lite-chip-logo" src={imgBySym[base(s)]} alt="" /> : null}{base(s)}
            </button>
          ))}
        </div>
      </header>

      <div className="lite-lq-strip lite-rise-1">
        <div className="lite-panel lite-lq-tile">
          <em>{sym} {tl(t, 'now', 'msg')}</em>
          <strong>{cur > 0 ? fmtPrice(cur) : '-'}</strong>
          <span>{tl(t, 'mark price on the heatmap', 'msg')}</span>
        </div>
        <div className="lite-panel lite-lq-tile">
          <em>{tl(t, 'Shorts above', 'lbl')}</em>
          {nearest.short ? (
            <>
              <strong className="up">{fmtPrice(nearest.short.price)} <i>{fmtAway(pctAway(nearest.short.price, cur))}</i></strong>
              <span>{fmtLargeShort(nearest.short.amount)} {tl(t, 'in the nearest pool - a squeeze target', 'msg')}</span>
            </>
          ) : <strong>-</strong>}
        </div>
        <div className="lite-panel lite-lq-tile">
          <em>{tl(t, 'Longs below', 'lbl')}</em>
          {nearest.long ? (
            <>
              <strong className="down">{fmtPrice(nearest.long.price)} <i>{fmtAway(pctAway(nearest.long.price, cur))}</i></strong>
              <span>{fmtLargeShort(nearest.long.amount)} {tl(t, 'in the nearest pool - a flush target', 'msg')}</span>
            </>
          ) : <strong>-</strong>}
        </div>
        <div className="lite-panel lite-lq-tile">
          <em>{tl(t, 'Liquidated 24h', 'lbl')}</em>
          <strong>{win24?.total > 0 ? fmtLargeShort(win24.total) : '-'}</strong>
          {win24?.total > 0 && <span><b className="down">{fmtLargeShort(win24.long)}</b> {tl(t, 'longs', 'lbl')} · <b className="up">{fmtLargeShort(win24.short)}</b> {tl(t, 'shorts', 'lbl')}</span>}
        </div>
      </div>

      <div className="lite-lq-main lite-rise-1">
        <section className="lite-panel lite-lq-chart">
          <React.Suspense fallback={<div className="lite-lq-skel" aria-hidden />}>
            <LiteLiqPanel
              symbol={symbol}
              setSymbol={setSymbol}
              enabled
              dayMode={light}
              fmtPrice={fmtPrice}
              height={460}
              note={tl(t, 'Modelled from open interest + price action, not measured fills - read clusters as zones, not exact levels.', 'msg')}
            />
          </React.Suspense>
        </section>

      </div>

      {onOpenPath && (
        <button type="button" className="lite-prolink" onClick={openPro}>
          {tl(t, 'Liquidation heatmap in PRO', 'msg')}<ArrowIcon />
        </button>
      )}
    </div>
  )
}
