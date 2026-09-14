/**
 * lite-derivs.jsx - the Derivatives view of LITE (traders-corner reflection).
 *
 * Same five reads as before (open interest, funding, the intel deriv bundle,
 * liquidation windows, CME COT + long/short accounts), one screen: a summary
 * strip, the liquidation windows as a small long-vs-short chart, ONE leverage
 * board per coin (OI + 24h change, annualised funding, crowd %, 24h liqs)
 * instead of two lists over the same coins, where the OI sits by exchange, and
 * the CME book. Two-up rows stack under 900px.
 *
 * Funding is quoted per 8h by the venues; LITE shows it annualised (x3 x365)
 * because "+0.0028%" means nothing to a reader and "+3.1% a year, longs pay"
 * does.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { tl } from './lite-i18n'
import { useTranslation } from 'react-i18next'
import { track, Events } from '@/services/analytics'
import './lite-derivs.css'

const cls = (v) => (Number(v) >= 0 ? 'up' : 'down')
const pct = (v, d = 2) => { const n = Number(v) || 0; return `${n >= 0 ? '+' : ''}${n.toFixed(d)}%` }
const apr = (rate8h) => Number(rate8h) * 3 * 365 * 100
const WINDOWS = ['1h', '4h', '12h', '24h']
const SORTS = [
  { id: 'oi', label: 'Open interest' },
  { id: 'funding', label: 'Funding' },
  { id: 'crowd', label: 'Crowded' },
  { id: 'liq', label: 'Liquidated' },
]
let _cache = null

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M12 5l7 7-7 7" /></svg>
)

function Skel({ n = 8 }) {
  return (
    <ul className="lite-skel" aria-hidden>
      {Array.from({ length: n }).map((_, i) => <li key={i} className="lite-skel-row" style={{ animationDelay: `${i * 80}ms` }} />)}
    </ul>
  )
}

function Logo({ sym, imgBySym }) {
  const src = imgBySym?.[sym]
  return (
    <span className="lite-dv-logo">
      {src ? <img src={src} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }} /> : null}
      <b style={src ? { display: 'none' } : undefined}>{(sym || '?')[0]}</b>
    </span>
  )
}

// Tiny line spark for the COT series - kept local so this file does not
// reach back into lite-page.jsx.
function Spark({ points, height = 48 }) {
  if (!points || points.length < 2) return null
  const W = 300
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = W / (points.length - 1)
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(height - 4 - ((v - min) / span) * (height - 8)).toFixed(1)}`).join('')
  return (
    <svg className={`lite-dv-spark ${points[points.length - 1] >= points[0] ? 'up' : 'down'}`} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden>
      <path d={d} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

async function load() {
  const [{ getV1Json, getSpectreIntelDerivBundle, getSpectreLiquidationWindows }, tc] = await Promise.all([
    import('@/services/spectreMarketApi'),
    import('@/pages/traders-corner/tradersCornerApi').catch(() => null),
  ])
  const [oiP, fP, bundle, liq, cot, lsr] = await Promise.all([
    getV1Json('/derivatives/open-interest?limit=16'),
    getV1Json('/derivatives/funding-rates'),
    getSpectreIntelDerivBundle().catch(() => null),
    getSpectreLiquidationWindows().catch(() => null),
    tc ? tc.getCmeCot().catch(() => null) : null,
    tc ? tc.getLongShortRatios().catch(() => null) : null,
  ])
  const fundingBy = new Map((fP?.data || []).map((r) => [String(r.asset || '').toUpperCase(), Number(r.weighted_funding_rate ?? r.rate)]))
  // 🪤 the LSR feed resolves with a fabricated 50/50 default when degraded;
  // requiring a finite ratio > 0 per ROW is the documented guard.
  const longBy = new Map()
  for (const r of lsr?.global || []) {
    const sym = String(r.symbol || '').toUpperCase().replace(/USDT$/, '')
    const ratio = parseFloat(r.longShortRatio)
    const long = parseFloat(r.longAccount) * 100
    if (sym && Number.isFinite(ratio) && ratio > 0 && Number.isFinite(long)) longBy.set(sym, long)
  }
  const exch = new Map()
  const rows = (oiP?.data || [])
    .map((r) => {
      const asset = String(r.asset || '').toUpperCase()
      const oi = Number(r.oi_usd) || 0
      const f = fundingBy.get(asset)
      const ratio = Number(r.long_short_ratio)
      const longFromRatio = Number.isFinite(ratio) && ratio > 0 ? (ratio / (1 + ratio)) * 100 : null
      // Venue names arrive in mixed case across coins ("Hyperliquid" and
      // "hyperliquid") - merge on the lowercase key, show the capitalised form.
      for (const [ex, v] of Object.entries(r.oi_exchange_breakdown || r.exchange_breakdown || {})) {
        if (!(Number(v) > 0)) continue
        const key = String(ex).trim().toLowerCase()
        const cur = exch.get(key) || { name: ex.trim().replace(/^[a-z]/, (c) => c.toUpperCase()), v: 0 }
        cur.v += Number(v)
        exch.set(key, cur)
      }
      return {
        asset,
        oi,
        oiChange: Number.isFinite(Number(r.oi_change_24h_pct)) ? Number(r.oi_change_24h_pct) : null,
        funding: Number.isFinite(f) ? f : null,
        long: longBy.get(asset) ?? longFromRatio,
        liq: Number(r.total_liq_24h_usd) || 0,
        liqLong: Number(r.long_liq_24h_usd) || 0,
        liqShort: Number(r.short_liq_24h_usd) || 0,
      }
    })
    .filter((r) => r.asset && r.oi > 0)
  const exchanges = [...exch.values()].map((e) => [e.name, e.v]).sort((a, b) => b[1] - a[1])
  return {
    rows,
    exchanges,
    crowd: Number(bundle?.longShortRatio?.longs) || null,
    liq: liq?.windows || null,
    liqEvents: Number(liq?.events_24h) || 0,
    cot: Array.isArray(cot) ? cot : [],
  }
}

export default function DerivativesView({ fmtLargeShort, onOpenPath, imgBySym, onNav }) {
  const { t } = useTranslation()
  const [dv, setDv] = useState(_cache)
  const [sort, setSort] = useState('oi')
  const [liqWin, setLiqWin] = useState('24h')

  useEffect(() => {
    if (_cache) return undefined
    let cancelled = false
    load().then((out) => { if (cancelled) return; _cache = out; setDv(out) }).catch(() => { if (!cancelled) setDv({ rows: [], exchanges: [], crowd: null, liq: null, liqEvents: 0, cot: [] }) })
    return () => { cancelled = true }
  }, [])

  const rows = useMemo(() => {
    if (!dv) return null
    const list = [...dv.rows]
    if (sort === 'funding') list.sort((a, b) => Math.abs(b.funding ?? 0) - Math.abs(a.funding ?? 0))
    else if (sort === 'crowd') list.sort((a, b) => Math.abs((b.long ?? 50) - 50) - Math.abs((a.long ?? 50) - 50))
    else if (sort === 'liq') list.sort((a, b) => b.liq - a.liq)
    else list.sort((a, b) => b.oi - a.oi)
    return list
  }, [dv, sort])

  const summary = useMemo(() => {
    if (!dv) return null
    const totalOi = dv.rows.reduce((s, r) => s + r.oi, 0)
    const majors = dv.rows.filter((r) => ['BTC', 'ETH', 'SOL'].includes(r.asset) && r.funding != null)
    const fundAvg = majors.length ? majors.reduce((s, r) => s + r.funding, 0) / majors.length : null
    const liq24 = dv.liq?.['24h']
    const oiUp = dv.rows.filter((r) => r.oiChange != null && r.oiChange > 0).length
    const oiKnown = dv.rows.filter((r) => r.oiChange != null).length
    return { totalOi, fundAvg, liq24, oiUp, oiKnown }
  }, [dv])

  const lw = dv?.liq?.[liqWin]
  const liqLong = Number(lw?.long) || 0
  const liqShort = Number(lw?.short) || 0
  const liqTotal = Number(lw?.total) || 0
  const liqRead = liqTotal <= 0 ? null
    : liqShort > liqLong * 2 ? tl(t, 'Shorts got squeezed - the market ripped through their stops.', 'msg')
      : liqLong > liqShort * 2 ? tl(t, 'Longs got flushed - the dip ran through their stops.', 'msg')
        : tl(t, 'Both sides took losses - choppy tape.', 'msg')
  const winMax = dv?.liq ? Math.max(1, ...WINDOWS.map((w) => Number(dv.liq[w]?.total) || 0)) : 1
  const exMax = dv?.exchanges?.[0]?.[1] || 1
  const exTotal = dv?.exchanges?.reduce((s, [, v]) => s + v, 0) || 1

  const openPro = () => { track(Events.LITE_PRO_DOOR, { path: '/traders-corner' }); onOpenPath?.('/traders-corner') }

  return (
    <div className="lite-view lite-dv">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Derivatives', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'Where the leverage sits, and who is paying whom to hold it.', 'sub')}</p>
      </header>

      {summary && (
        <div className="lite-dv-strip lite-rise-1">
          <div className="lite-panel lite-dv-tile">
            <em>{tl(t, 'Open interest', 'lbl')}</em>
            <strong>{fmtLargeShort(summary.totalOi)}</strong>
            <span>{summary.oiKnown > 0 ? `${summary.oiUp} ${tl(t, 'of', 'msg')} ${summary.oiKnown} ${tl(t, 'coins growing today', 'msg')}` : tl(t, 'across tracked perps', 'msg')}</span>
          </div>
          <div className="lite-panel lite-dv-tile">
            <em>{tl(t, 'Crowd', 'lbl')}</em>
            {dv.crowd != null ? (
              <>
                <strong>{Math.round(dv.crowd)}% <i>{tl(t, 'long', 'lbl')}</i></strong>
                <span className="lite-dv-bar" aria-hidden><span className="up" style={{ width: `${Math.min(100, Math.max(0, dv.crowd))}%` }} /></span>
              </>
            ) : <strong>-</strong>}
          </div>
          <div className="lite-panel lite-dv-tile">
            <em>{tl(t, 'Funding mood', 'lbl')}</em>
            {summary.fundAvg != null ? (
              <>
                <strong className={cls(summary.fundAvg)}>{pct(apr(summary.fundAvg), 1)} <i>{tl(t, 'a year', 'msg')}</i></strong>
                <span>{summary.fundAvg >= 0 ? tl(t, 'longs pay shorts on BTC, ETH, SOL', 'msg') : tl(t, 'shorts pay longs on BTC, ETH, SOL', 'msg')}</span>
              </>
            ) : <strong>-</strong>}
          </div>
          <div className="lite-panel lite-dv-tile">
            <em>{tl(t, 'Liquidated 24h', 'lbl')}</em>
            <strong>{summary.liq24?.total > 0 ? fmtLargeShort(summary.liq24.total) : '-'}</strong>
            <span>{dv.liqEvents > 0 ? t('lite.msg.positions_closed_by_force', '{{n}} positions closed by force', { n: dv.liqEvents.toLocaleString() }) : tl(t, 'forced closes', 'msg')}</span>
          </div>
        </div>
      )}

      {dv?.liq && liqTotal > 0 && (
        <section className="lite-panel lite-rise-1">
          <div className="lite-dv-head">
            <div>
              <p className="lite-eyebrow">{tl(t, 'Liquidations', 'lbl')}</p>
              <p className="lite-dv-big">
                <strong>{fmtLargeShort(liqTotal)}</strong>
                <span className="down">{fmtLargeShort(liqLong)} {tl(t, 'longs', 'lbl')}</span>
                <span className="up">{fmtLargeShort(liqShort)} {tl(t, 'shorts', 'lbl')}</span>
              </p>
            </div>
            <div className="lite-tf-toggle lite-tf-toggle--sm lite-tf-toggle--fit" role="tablist" aria-label={t('lite.derivativesview.ariaLiquidationWindow', "Liquidation window")}>
              {WINDOWS.map((w) => (
                <button key={w} type="button" role="tab" aria-selected={liqWin === w} className={`lite-tf-btn${liqWin === w ? ' active' : ''}`} onClick={() => setLiqWin(w)}>{w.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <div className="lite-dv-liqchart" role="img" aria-label={t('lite.derivativesview.ariaLiquidationsByWindow', "Liquidations by window")}>
            {WINDOWS.map((w) => {
              const x = dv.liq[w] || {}
              const tot = Number(x.total) || 0
              const lg = Number(x.long) || 0
              const sh = Number(x.short) || 0
              const h = Math.max(4, Math.round((tot / winMax) * 100))
              return (
                <button key={w} type="button" className={`lite-dv-liqcol${liqWin === w ? ' active' : ''}`} onClick={() => setLiqWin(w)}>
                  <span className="lite-dv-liqval">{tot > 0 ? fmtLargeShort(tot) : ''}</span>
                  <span className="lite-dv-liqstack" style={{ height: `${h}%` }}>
                    <i className="down" style={{ flex: lg || 0.0001 }} />
                    <i className="up" style={{ flex: sh || 0.0001 }} />
                  </span>
                  <span className="lite-dv-liqlbl">{w.toUpperCase()}</span>
                </button>
              )
            })}
          </div>
          <p className="lite-social-note">{liqRead} {tl(t, 'Red is longs forced out, green is shorts.', 'msg')}</p>
          {onNav && (
            <button type="button" className="lite-prolink lite-prolink--inline" onClick={() => onNav('liq')}>
              {tl(t, 'See where the next liquidations cluster', 'msg')}<ArrowIcon />
            </button>
          )}
        </section>
      )}

      <section className="lite-panel lite-dv-board lite-rise-2">
        <div className="lite-dv-head">
          <div>
            <p className="lite-eyebrow">{tl(t, 'Leverage board', 'lbl')}</p>
            <span className="lite-dv-head-sub">{tl(t, 'Per coin: open bets, what it costs to hold them, and who is crowded.', 'msg')}</span>
          </div>
          <div className="lite-tf-toggle lite-tf-toggle--sm lite-tf-toggle--fit" role="tablist" aria-label={t('lite.derivativesview.ariaSort', "Sort")}>
            {SORTS.map((o) => (
              <button key={o.id} type="button" role="tab" aria-selected={sort === o.id} className={`lite-tf-btn${sort === o.id ? ' active' : ''}`} onClick={() => setSort(o.id)}>{tl(t, o.label)}</button>
            ))}
          </div>
        </div>
        {!rows ? <Skel n={10} /> : rows.length === 0 ? (
          <p className="lite-empty">{tl(t, 'Derivatives data is warming up.', 'msg')}</p>
        ) : (
          <div className="lite-dv-table">
            <div className="lite-dv-row lite-dv-row--head" aria-hidden>
              <span />
              <span>{tl(t, 'Coin', 'lbl')}</span>
              <span className="r">{tl(t, 'Open interest', 'lbl')}</span>
              <span className="r">{tl(t, 'Funding / yr', 'lbl')}</span>
              <span>{tl(t, 'Crowd', 'lbl')}</span>
              <span className="r">{tl(t, 'Liq 24h', 'lbl')}</span>
            </div>
            {rows.map((r) => {
              const a = r.funding != null ? apr(r.funding) : null
              return (
                <div key={r.asset} className="lite-dv-row">
                  <Logo sym={r.asset} imgBySym={imgBySym} />
                  <span className="lite-dv-coin"><strong>{r.asset}</strong></span>
                  <span className="lite-dv-oi r">
                    <strong>{fmtLargeShort(r.oi)}</strong>
                    {r.oiChange != null && <em className={cls(r.oiChange)}>{pct(r.oiChange, 1)}</em>}
                  </span>
                  <span className="lite-dv-fund r">
                    {a != null ? (
                      <>
                        <strong className={cls(a)}>{pct(a, 1)}</strong>
                        <em>{a >= 0 ? tl(t, 'longs pay', 'msg') : tl(t, 'shorts pay', 'msg')}</em>
                      </>
                    ) : <em>-</em>}
                  </span>
                  <span className="lite-dv-crowd">
                    {r.long != null ? (
                      <>
                        <span className="lite-dv-bar" aria-hidden><span className={r.long >= 50 ? 'up' : 'down'} style={{ width: `${Math.min(100, Math.max(0, r.long)).toFixed(0)}%` }} /></span>
                        <em className={r.long >= 50 ? 'up' : 'down'}>{Math.round(r.long)}% {tl(t, 'long', 'lbl')}</em>
                      </>
                    ) : <em>-</em>}
                  </span>
                  <span className="lite-dv-liq r">
                    {r.liq > 0 ? (
                      <>
                        <strong>{fmtLargeShort(r.liq)}</strong>
                        <em>{r.liqLong >= r.liqShort ? `${Math.round((r.liqLong / r.liq) * 100)}% ${tl(t, 'longs', 'lbl')}` : `${Math.round((r.liqShort / r.liq) * 100)}% ${tl(t, 'shorts', 'lbl')}`}</em>
                      </>
                    ) : <em>-</em>}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        <p className="lite-social-note">{tl(t, 'Funding is the fee between longs and shorts, shown here as a yearly rate - positive means longs pay to stay long. Crowd is the share of accounts positioned long; the crowded side is the one that gets squeezed.', 'msg')}</p>
      </section>

      <div className="lite-dv-two lite-rise-3">
        {dv?.exchanges?.length > 0 && (
          <section className="lite-panel">
            <p className="lite-eyebrow">{tl(t, 'Where the open interest sits', 'lbl')}</p>
            <ul className="lite-dv-exch">
              {dv.exchanges.slice(0, 7).map(([ex, v]) => (
                <li key={ex}>
                  <span className="lite-dv-exch-name">{ex}</span>
                  <span className="lite-dv-bar lite-dv-bar--ex" aria-hidden><span style={{ width: `${Math.max(2, (v / exMax) * 100).toFixed(0)}%` }} /></span>
                  <span className="lite-dv-exch-val"><strong>{fmtLargeShort(v)}</strong><em>{((v / exTotal) * 100).toFixed(0)}%</em></span>
                </li>
              ))}
            </ul>
            <p className="lite-social-note">{tl(t, 'Open interest across the tracked coins, by venue. Concentration is where a single exchange outage hurts most.', 'msg')}</p>
          </section>
        )}

        {dv?.cot?.length > 0 && (
          <section className="lite-panel">
            <p className="lite-eyebrow">{tl(t, "Wall Street's futures book (CME)", 'lbl')}</p>
            <div className="lite-dv-cot">
              {dv.cot.map((c) => {
                const net = Number(c.net) || 0
                const longs = Number(c.longs) || 0
                const shorts = Number(c.shorts) || 0
                const longShare = longs + shorts > 0 ? (longs / (longs + shorts)) * 100 : 50
                const series = (c.series || []).map((p) => Number(p.net)).filter(Number.isFinite)
                return (
                  <div key={`${c.asset}-${c.market}`} className="lite-dv-cot-card">
                    <div className="lite-dv-cot-head">
                      <span className="lite-dv-cot-id"><Logo sym={c.asset} imgBySym={imgBySym} /><strong>{c.asset}</strong>{c.market && <em>{c.market}</em>}</span>
                      <span className={`lite-dv-cot-net ${net >= 0 ? 'up' : 'down'}`}>{net >= 0 ? tl(t, 'net long', 'lbl') : tl(t, 'net short', 'lbl')} {Math.abs(net).toLocaleString()}</span>
                    </div>
                    {series.length > 2 && <Spark points={series} height={48} />}
                    <span className="lite-dv-bar" aria-hidden><span className="up" style={{ width: `${longShare.toFixed(0)}%` }} /></span>
                    <span className="lite-dv-cot-meta">
                      {Number(c.delta) ? `${Number(c.delta) > 0 ? '+' : ''}${Number(c.delta).toLocaleString()} ${tl(t, 'this week', 'msg')}` : ''}
                      {c.traders ? ` · ${c.traders} ${tl(t, 'traders', 'msg')}` : ''}
                      {c.ts ? ` · ${new Date(c.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="lite-social-note">{tl(t, 'Regulated CME futures, reported weekly by the CFTC - the slow institutional book, not the crypto-native casino.', 'msg')}</p>
          </section>
        )}
      </div>

      {onOpenPath && (
        <button type="button" className="lite-prolink" onClick={openPro}>
          {tl(t, "Traders' corner in PRO", 'msg')}<ArrowIcon />
        </button>
      )}
    </div>
  )
}
