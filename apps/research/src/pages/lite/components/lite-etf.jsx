/**
 * lite-etf.jsx - the ETF Flows view of LITE (etf-flows reflection).
 *
 * Same useEtfFlows read (summary per issuer + daily net-flow series). The
 * daily series carries everything the old bars threw away: a cumulative line,
 * a streak ("3rd day of inflows"), a 30-day total, best / worst day, month
 * totals. The chart draws in real pixels (ResizeObserver) so the bars fill the
 * range instead of scrolling 9px sticks across half a panel.
 */
import React, { useMemo, useState, useRef, useCallback } from 'react'
import { tl } from './lite-i18n'
import { useTranslation } from 'react-i18next'
import useEtfFlows from '@/components/etf/use-etf-flows'
import ChartWatermark from '@/components/chart-watermark'
import { track, Events } from '@/services/analytics'
import { LiteEtfShare, litEtfUsd } from './lite-etf-share'
import './lite-etf.css'

const RANGES = [{ k: 7, l: '7D' }, { k: 30, l: '30D' }, { k: 90, l: '90D' }, { k: 999, l: '6M' }]
const dcls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '')

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

const fmtDay = (iso, locale, withYear = false) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC', ...(withYear ? { year: 'numeric' } : {}) })
const fmtMonth = (ym, locale) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })

// Bars for the daily flow + a cumulative line for the range, real-pixel geometry.
function FlowChart({ series, height = 240, locale, t }) {
  const [w, setW] = useState(0)
  const roRef = useRef(null)
  const hostRef = useCallback((el) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (!el) return
    const measure = () => { const width = el.getBoundingClientRect().width; setW((p) => (Math.abs(p - width) < 1 ? p : width)) }
    measure()
    if (typeof ResizeObserver !== 'undefined') { roRef.current = new ResizeObserver(measure); roRef.current.observe(el) }
  }, [])
  const [hi, setHi] = useState(null)

  const geo = useMemo(() => {
    if (!Array.isArray(series) || series.length < 2 || !w) return null
    const W = w, H = height
    // padB leaves a row under the ticks for the watermark, so the last date is not covered.
    const padT = 16, padB = 44, padL = 2, padR = 2
    const n = series.length
    const flows = series.map((d) => Number(d.flowUsd) || 0)
    const cum = []
    let acc = 0
    for (const f of flows) { acc += f; cum.push(acc) }
    const maxA = Math.max(1, ...flows.map(Math.abs))
    const cMin = Math.min(0, ...cum), cMax = Math.max(0, ...cum)
    const cSpan = cMax - cMin || 1
    const plotH = H - padT - padB
    const slot = (W - padL - padR) / n
    const barW = Math.max(2, Math.min(18, slot * 0.66))
    const x = (i) => padL + i * slot + slot / 2
    const zero = padT + plotH / 2
    const yBar = (f) => zero - (f / maxA) * (plotH / 2 - 4)
    const yCum = (c) => padT + (1 - (c - cMin) / cSpan) * plotH
    const line = cum.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yCum(c).toFixed(1)}`).join('')
    const tickCount = W < 420 ? 3 : W < 720 ? 4 : 6
    const ticks = []
    for (let k = 0; k < tickCount; k++) {
      const i = Math.round((k * (n - 1)) / (tickCount - 1))
      ticks.push({ i, x: x(i), label: fmtDay(series[i].date, locale), anchor: k === 0 ? 'start' : k === tickCount - 1 ? 'end' : 'middle' })
    }
    let bestI = 0, worstI = 0
    flows.forEach((f, i) => { if (f > flows[bestI]) bestI = i; if (f < flows[worstI]) worstI = i })
    return { W, H, n, flows, cum, x, zero, yBar, yCum, barW, line, ticks, bestI, worstI, padT, plotH, cumEnd: cum[n - 1] }
  }, [series, w, height, locale])

  const onMove = (e) => {
    if (!geo) return
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.max(0, Math.min(geo.n - 1, Math.floor(((e.clientX - r.left - 2) / (geo.W - 4)) * geo.n)))
    setHi(i)
  }
  const hov = hi != null && geo ? { i: hi, x: geo.x(hi), f: geo.flows[hi], c: geo.cum[hi], d: series[hi] } : null

  return (
    <div className="lite-etfv-chart spectre-wm-host" ref={hostRef} style={{ height }} onPointerMove={onMove} onPointerLeave={() => setHi(null)}>
      {geo && (
        <svg width={geo.W} height={geo.H} viewBox={`0 0 ${geo.W} ${geo.H}`} aria-hidden>
          <line className="lite-etfv-zero" x1={0} x2={geo.W} y1={geo.zero + 0.5} y2={geo.zero + 0.5} />
          {geo.flows.map((f, i) => {
            const y = geo.yBar(f)
            const h = Math.max(1.5, Math.abs(y - geo.zero))
            return <rect key={i} className={`lite-etfv-bar ${f >= 0 ? 'up' : 'down'}${hov && hov.i !== i ? ' dim' : ''}`} x={geo.x(i) - geo.barW / 2} y={f >= 0 ? geo.zero - h : geo.zero} width={geo.barW} height={h} rx={Math.min(2, geo.barW / 3)} />
          })}
          <path className="lite-etfv-cum" d={geo.line} fill="none" />
          <circle className="lite-etfv-cum-end" cx={geo.x(geo.n - 1)} cy={geo.yCum(geo.cumEnd)} r={3.5} />
          {geo.n > 6 && (
            <g className="lite-etfv-ext">
              <text x={geo.x(geo.bestI)} y={geo.yBar(geo.flows[geo.bestI]) - 5} textAnchor={geo.x(geo.bestI) < 60 ? 'start' : geo.x(geo.bestI) > geo.W - 60 ? 'end' : 'middle'}>{litEtfUsd(geo.flows[geo.bestI])}</text>
              <text x={geo.x(geo.worstI)} y={geo.yBar(geo.flows[geo.worstI]) + 12} textAnchor={geo.x(geo.worstI) < 60 ? 'start' : geo.x(geo.worstI) > geo.W - 60 ? 'end' : 'middle'}>{litEtfUsd(geo.flows[geo.worstI])}</text>
            </g>
          )}
          {geo.ticks.map((tk) => <text key={tk.i} className="lite-etfv-tick" x={tk.x} y={geo.H - 26} textAnchor={tk.anchor}>{tk.label}</text>)}
          {hov && <line className="lite-etfv-cross" x1={hov.x} x2={hov.x} y1={6} y2={geo.H - 40} />}
        </svg>
      )}
      {hov && (
        <div className="lite-etfv-tip" data-side={hov.x > geo.W * 0.68 ? 'left' : 'right'} style={{ left: hov.x }}>
          <strong className={dcls(hov.f)}>{litEtfUsd(hov.f)}</strong>
          <span>{fmtDay(hov.d.date, locale, true)}</span>
          <span>{litEtfUsd(hov.c)} {tl(t, 'cumulative in range', 'msg')}</span>
        </div>
      )}
      <ChartWatermark padX={8} padY={6} />
    </div>
  )
}

export default function EtfView({ fmtLargeShort, fmtPrice, onOpenPath }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'en'
  const { data: etf, loading } = useEtfFlows()
  const [asset, setAsset] = useState('BTC')
  const [range, setRange] = useState(90)
  const slug = asset === 'ETH' ? 'eth' : 'btc'
  const side = etf?.summary?.[slug]
  const total = side?.total || {}
  const full = etf?.charts?.[asset] || []
  const series = range >= 999 ? full : full.slice(-range)
  const coinUnit = asset === 'ETH' ? 'ETH' : 'BTC'

  // Reads off the daily series: 30d total, the current streak, month totals.
  const reads = useMemo(() => {
    const flows = full.map((d) => Number(d.flowUsd) || 0)
    const sum30 = flows.slice(-30).reduce((a, b) => a + b, 0)
    let streak = 0
    if (flows.length) {
      const sign = Math.sign(flows[flows.length - 1])
      for (let i = flows.length - 1; i >= 0 && Math.sign(flows[i]) === sign && sign !== 0; i--) streak++
      streak *= sign
    }
    const byMonth = new Map()
    for (const d of full) { const ym = String(d.date).slice(0, 7); byMonth.set(ym, (byMonth.get(ym) || 0) + (Number(d.flowUsd) || 0)) }
    const months = [...byMonth.entries()].slice(-6)
    const mMax = Math.max(1, ...months.map(([, v]) => Math.abs(v)))
    const rangeSum = series.reduce((a, d) => a + (Number(d.flowUsd) || 0), 0)
    const upDays = series.filter((d) => Number(d.flowUsd) > 0).length
    return { sum30, streak, months, mMax, rangeSum, upDays }
  }, [full, series])

  const issuers = useMemo(() => {
    const rows = (side?.issuers || []).filter((r) => Number(r.holdingsUsd) > 0)
    rows.sort((a, b) => Number(b.holdingsUsd) - Number(a.holdingsUsd))
    const top = rows.slice(0, 10)
    const rest = rows.slice(10)
    if (rest.length > 0) {
      const sum = (k) => rest.reduce((acc, r) => acc + (Number(r[k]) || 0), 0)
      top.push({ issuer: `${tl(t, 'Others', 'msg')} (${rest.length})`, _others: true, holdingsUsd: sum('holdingsUsd'), holdingsCoin: sum('holdingsCoin'), flow1dUsd: sum('flow1dUsd'), flow7dUsd: sum('flow7dUsd') })
    }
    return top
  }, [side, t])
  const shareBase = Number(total.holdingsUsd) > 0 ? Number(total.holdingsUsd) : issuers.reduce((acc, r) => acc + (Number(r.holdingsUsd) || 0), 0)
  const shareOf = (r) => (shareBase > 0 ? (Number(r.holdingsUsd) / shareBase) * 100 : 0)
  const top1 = issuers[0]
  const top3 = issuers.slice(0, 3).reduce((a, r) => a + shareOf(r), 0)

  const openPro = () => { track(Events.LITE_PRO_DOOR, { path: '/etf-flows' }); onOpenPath?.('/etf-flows') }
  const streakText = reads.streak > 1
    ? `${tl(t, 'day', 'msg')} ${reads.streak} ${tl(t, 'of inflows in a row', 'msg')}`
    : reads.streak < -1
      ? `${tl(t, 'day', 'msg')} ${Math.abs(reads.streak)} ${tl(t, 'of outflows in a row', 'msg')}`
      : Number(total.flow1dUsd) >= 0 ? tl(t, 'money coming in', 'msg') : tl(t, 'money leaving', 'msg')

  return (
    <div className="lite-view lite-etfv">
      <header className="lite-view-head lite-etfv-head lite-rise">
        <div>
          <h1 className="lite-view-title">{tl(t, 'ETF Flows', 'ttl')}</h1>
          <p className="lite-view-sub">
            {tl(t, 'What Wall Street bought or sold through the spot ETFs.', 'sub')}
            {side?.asOf ? <span className="lite-etfv-asof"> · {tl(t, 'as of', 'msg')} {fmtDay(side.asOf, locale)}</span> : null}
          </p>
        </div>
        <div className="lite-etfv-tools">
          <div className="lite-tf-toggle lite-tf-toggle--sm" role="tablist" aria-label={t('lite.etfview.ariaEtfAsset', "ETF asset")}>
            {['BTC', 'ETH'].map((a) => (
              <button key={a} type="button" role="tab" aria-selected={asset === a} className={`lite-tf-btn${asset === a ? ' active' : ''}`} onClick={() => setAsset(a)}>{a === 'BTC' ? 'Bitcoin' : 'Ethereum'}</button>
            ))}
          </div>
          <LiteEtfShare data={etf} asset={asset} />
        </div>
      </header>

      {loading && !side ? (
        <section className="lite-panel lite-rise-1"><Skel n={8} /></section>
      ) : !side ? (
        <section className="lite-panel lite-rise-1"><p className="lite-empty">{tl(t, 'ETF data is warming up.', 'msg')}</p></section>
      ) : (
        <>
          <div className="lite-etfv-strip lite-rise-1">
            <div className="lite-panel lite-etfv-tile">
              <em>{tl(t, 'Net flow, 1 day', 'lbl')}</em>
              <strong className={dcls(total.flow1dUsd)}>{litEtfUsd(total.flow1dUsd)}</strong>
              <span>{streakText}</span>
            </div>
            <div className="lite-panel lite-etfv-tile">
              <em>{tl(t, 'Net flow, 7 days', 'lbl')}</em>
              <strong className={dcls(total.flow7dUsd)}>{litEtfUsd(total.flow7dUsd)}</strong>
              <span>{tl(t, 'the week in one number', 'msg')}</span>
            </div>
            <div className="lite-panel lite-etfv-tile">
              <em>{tl(t, 'Net flow, 30 days', 'lbl')}</em>
              <strong className={dcls(reads.sum30)}>{litEtfUsd(reads.sum30)}</strong>
              <span>{tl(t, 'the month in one number', 'msg')}</span>
            </div>
            <div className="lite-panel lite-etfv-tile">
              <em>{tl(t, 'Total holdings', 'lbl')}</em>
              <strong>{Number(total.holdingsUsd) > 0 ? fmtLargeShort(total.holdingsUsd) : '-'}</strong>
              <span>{Number(total.holdingsCoin) > 0 ? `${Math.round(total.holdingsCoin).toLocaleString()} ${coinUnit} ${tl(t, 'held by the funds', 'msg')}` : tl(t, 'held by the funds', 'msg')}</span>
            </div>
          </div>

          <section className="lite-panel lite-etfv-panel lite-rise-1">
            <div className="lite-etfv-phead">
              <div>
                <p className="lite-eyebrow">{tl(t, 'Daily net flows', 'lbl')}</p>
                {series.length > 1 && (
                  <p className="lite-etfv-big">
                    <strong className={dcls(reads.rangeSum)}>{litEtfUsd(reads.rangeSum)}</strong>
                    <span>{tl(t, 'net over', 'msg')} {series.length} {tl(t, 'days', 'msg')} · {reads.upDays} {tl(t, 'inflow days', 'msg')}</span>
                  </p>
                )}
              </div>
              <div className="lite-tf-toggle lite-tf-toggle--sm lite-tf-toggle--fit" role="tablist" aria-label={t('lite.etfview.ariaTimeframe', "Timeframe")}>
                {RANGES.map((r) => (
                  <button key={r.k} type="button" role="tab" aria-selected={range === r.k} className={`lite-tf-btn${range === r.k ? ' active' : ''}`} onClick={() => setRange(r.k)}>{r.l}</button>
                ))}
              </div>
            </div>
            {series.length > 1 ? <FlowChart series={series} height={240} locale={locale} t={t} /> : <p className="lite-empty">{tl(t, 'No flow history yet.', 'msg')}</p>}
            <p className="lite-social-note">{tl(t, 'Bars are each day\'s net creation or redemption; the line is the running total for the window. A net inflow means the funds had to BUY coins to back new shares - real spot demand, not paper bets.', 'msg')}</p>
          </section>

          {reads.months.length > 1 && (
            <section className="lite-panel lite-etfv-panel lite-rise-2">
              <p className="lite-eyebrow">{tl(t, 'Month by month', 'lbl')}</p>
              <ul className="lite-etfv-months">
                {reads.months.map(([ym, v]) => (
                  <li key={ym} className="lite-etfv-month">
                    <span className="lite-etfv-month-bar" aria-hidden>
                      <i className={dcls(v)} style={{ height: `${Math.max(4, (Math.abs(v) / reads.mMax) * 100).toFixed(0)}%` }} />
                    </span>
                    <strong className={dcls(v)}>{litEtfUsd(v)}</strong>
                    <em>{fmtMonth(ym, locale)}</em>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="lite-panel lite-etfv-panel lite-rise-2">
            <div className="lite-etfv-phead">
              <div>
                <p className="lite-eyebrow">{tl(t, 'Who holds what', 'lbl')}</p>
                {top1 && shareBase > 0 && (
                  <span className="lite-etfv-sub">
                    <strong>{top1.issuer}</strong> {tl(t, 'holds', 'msg')} {shareOf(top1).toFixed(0)}%{issuers.length > 3 ? `, ${tl(t, 'the top three together', 'msg')} ${top3.toFixed(0)}%` : ''}
                  </span>
                )}
              </div>
            </div>
            <div className="lite-etfv-table">
              <div className="lite-etfv-row lite-etfv-row--head" aria-hidden>
                <span /><span>{tl(t, 'Issuer', 'lbl')}</span><span>{tl(t, 'Share', 'lbl')}</span><span className="r">{tl(t, 'Holdings', 'lbl')}</span><span className="r">1D</span><span className="r">7D</span>
              </div>
              {issuers.map((r, i) => (
                <div key={r.issuer} className={`lite-etfv-row${r._others ? ' lite-etfv-row--others' : ''}`}>
                  <span className="lite-etfv-rank">{r._others ? '' : i + 1}</span>
                  <span className="lite-etfv-id"><strong>{r.issuer}</strong>{Array.isArray(r.tickers) && r.tickers.length > 0 && <em>{r.tickers.join(' · ')}</em>}</span>
                  <span className="lite-etfv-share"><span className="lite-etfv-share-bar" aria-hidden><i style={{ width: `${Math.min(100, shareOf(r)).toFixed(1)}%` }} /></span><em>{shareOf(r).toFixed(shareOf(r) < 10 ? 1 : 0)}%</em></span>
                  <span className="lite-etfv-hold r"><strong>{fmtLargeShort(r.holdingsUsd)}</strong>{Number(r.holdingsCoin) > 0 && <em>{Math.round(r.holdingsCoin).toLocaleString()} {coinUnit}</em>}</span>
                  <span className={`lite-etfv-flow r ${dcls(r.flow1dUsd)}`}>{litEtfUsd(r.flow1dUsd)}</span>
                  <span className={`lite-etfv-flow r ${dcls(r.flow7dUsd)}`}>{litEtfUsd(r.flow7dUsd)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {onOpenPath && (
        <button type="button" className="lite-prolink" onClick={openPro}>
          {tl(t, 'ETF flows in PRO', 'msg')}<ArrowIcon />
        </button>
      )}
    </div>
  )
}
