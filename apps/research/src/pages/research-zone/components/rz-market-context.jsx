/**
 * RZ Market Context — behavior-aware macro backdrop for the sentiment engine.
 *
 * Different tokens trade on different drivers, so this panel classifies the
 * token first and reframes the same macro feeds around what actually moves it:
 *
 *   BTC        -> risk appetite itself: F&G, dominance as capital flow, regime
 *   major      -> BTC beta + dominance rotation
 *   large/mid  -> alt-season breadth + dominance trend as headwind/tailwind
 *   micro/nano -> the OTHERS share of the market (liquidity reaches microcaps
 *                 last) + alt breadth; day-to-day, attention leads price here
 *   meme       -> attention lifecycle first, market tide second
 *
 * All numbers from live cached endpoints (useMacroContext + dominance history).
 * Deterministic composition — the LLM read lives in its own panel.
 */
import React, { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useMacroContext from '../hooks/use-macro-context'
import { getSpectreDominanceHistory } from '@/services/spectreMarketApi'
import './rz-sentiment-engine.css'

const num = (v) => (Number.isFinite(v) ? v : null)

export function classifyTokenClass({ sym, rank, marketCap, categories = [], primaryCategory = null }) {
  const cats = [...categories, primaryCategory].filter(Boolean).map((c) => String(c).toLowerCase())
  const isMeme = cats.some((c) => c.includes('meme'))
  if (sym === 'BTC') return { key: 'btc', label: 'Macro Anchor', isMeme: false }
  const r = num(rank)
  const mc = num(marketCap)
  let key
  if (r != null && r <= 10) key = 'major'
  else if ((r != null && r <= 100) || (mc != null && mc >= 1e9)) key = 'large'
  else if (mc != null && mc >= 1e8) key = 'mid'
  else if (mc != null && mc >= 5e6) key = 'micro'
  else if (mc != null) key = 'nano'
  else key = r != null ? 'large' : 'micro'
  const LABELS = {
    major: 'Major · Top 10',
    large: 'Large Cap',
    mid: 'Mid Cap',
    micro: 'Micro Cap',
    nano: 'Nano Cap',
  }
  return { key, label: isMeme ? `Memecoin · ${LABELS[key]}` : LABELS[key], isMeme }
}

function composeClassRead({ cls, sym, macro, othersNow, othersDelta }) {
  const fg = macro?.fg
  const dom = macro?.dominance
  const alt = macro?.altSeason
  const btcTrend = macro?.btcTrend

  const fgTxt = fg?.value != null ? `Fear & Greed ${Math.round(fg.value)} (${(fg.label || 'neutral').toLowerCase()})` : null
  const domTxt = dom?.btc != null
    ? `BTC dominance ${dom.btc.toFixed(1)}%${dom.delta7d != null ? ` (${dom.delta7d >= 0 ? '+' : ''}${dom.delta7d.toFixed(1)}pt/7d)` : ''}`
    : null
  const altTxt = alt?.value != null ? `alt-season index ${Math.round(alt.value)}/100` : null
  const trendTxt = btcTrend?.distPct != null
    ? `BTC ${Math.abs(btcTrend.distPct).toFixed(1)}% ${btcTrend.above200d ? 'above' : 'below'} its 200-day trend`
    : null
  const othersTxt = othersNow != null
    ? `The OTHERS share of the market sits at ${othersNow.toFixed(1)}%${othersDelta != null ? ` (${othersDelta >= 0 ? '+' : ''}${othersDelta.toFixed(1)}pt over 90d)` : ''}`
    : null

  const domFlow = dom?.delta7d == null ? null
    : dom.delta7d > 0.15 ? 'capital is rotating INTO Bitcoin — an alt headwind'
    : dom.delta7d < -0.15 ? 'capital is rotating OUT of Bitcoin toward alts — a tailwind'
    : 'the BTC/alt split is stable this week'

  switch (cls.key) {
    case 'btc':
      return [
        `BTC IS the macro driver — read it against risk appetite, not the alt tape.`,
        [fgTxt, trendTxt].filter(Boolean).join('; ') + (fgTxt || trendTxt ? '.' : ''),
        domTxt ? `${domTxt} — rising dominance means the market is hiding in BTC, falling means risk is rotating outward.` : null,
      ].filter(Boolean).join(' ')
    case 'major':
      return [
        `${sym} trades as high-beta Bitcoin: it amplifies BTC's direction and lives off the rotation cycle.`,
        domTxt && domFlow ? `${domTxt} — ${domFlow} for ${sym}.` : null,
        altTxt ? `Breadth check: ${altTxt}.` : null,
      ].filter(Boolean).join(' ')
    case 'large':
    case 'mid':
      return [
        `${sym} needs the alt tide, not just its own story.`,
        domTxt && domFlow ? `${domTxt} — ${domFlow}.` : null,
        altTxt ? `${altTxt[0].toUpperCase()}${altTxt.slice(1)} — ${macro?.altSeason?.value >= 60 ? 'breadth supports alt moves' : macro?.altSeason?.value >= 40 ? 'breadth is mixed' : 'BTC-led tape, alt rallies are being sold'}.` : null,
      ].filter(Boolean).join(' ')
    case 'micro':
    case 'nano':
      return [
        `${sym} is a ${cls.key} cap — liquidity reaches names this size LAST, after BTC, majors and mid caps have already run.`,
        othersTxt ? `${othersTxt}: that share expanding is the tide that lifts microcaps; contracting means the tide is out no matter how good the story is.` : null,
        altTxt ? `${altTxt[0].toUpperCase()}${altTxt.slice(1)}.` : null,
        `Day to day, attention flow (above) leads price here more than macro does.`,
      ].filter(Boolean).join(' ')
    default:
      return [fgTxt, domTxt, altTxt].filter(Boolean).join('; ')
  }
}

/* Dominance history mini chart — BTC share vs OTHERS share, 90d */
function DominanceChart({ rows, highlight, dayMode, width = 520 }) {
  const { t } = useTranslation()
  const H2 = 150
  const P = { top: 10, right: 34, bottom: 20, left: 8 }
  const model = useMemo(() => {
    if (!rows || rows.length < 2) return null
    const innerW = width - P.left - P.right
    const innerH = H2 - P.top - P.bottom
    const t0 = rows[0].ts
    const t1 = rows[rows.length - 1].ts
    const series = rows.map((r) => ({
      t: r.ts,
      btc: r.btc,
      others: Math.max(0, r.others ?? (100 - r.btc - (r.eth || 0))),
    }))
    let vMin = Infinity
    let vMax = -Infinity
    for (const s of series) {
      vMin = Math.min(vMin, s.btc, s.others)
      vMax = Math.max(vMax, s.btc, s.others)
    }
    const padV = (vMax - vMin || 1) * 0.12
    vMin -= padV; vMax += padV
    const x = (t) => P.left + ((t - t0) / (t1 - t0 || 1)) * innerW
    const y = (v) => P.top + (1 - (v - vMin) / (vMax - vMin)) * innerH
    const path = (key) => series.map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(s.t).toFixed(1)} ${y(s[key]).toFixed(1)}`).join(' ')
    const last = series[series.length - 1]
    return { path, x, y, last, t0, t1, vMin, vMax, innerH, innerW }
  }, [rows, width])

  if (!model) return null
  const axisColor = dayMode ? 'rgba(15, 23, 42, 0.4)' : 'rgba(245, 245, 247, 0.35)'
  const gridColor = dayMode ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.045)'
  const btcColor = '#F7931A'
  const othersColor = dayMode ? '#0f172a' : '#f5f5f7'
  const dim = dayMode ? 'rgba(15,23,42,0.35)' : 'rgba(245,245,247,0.35)'

  return (
    <svg viewBox={`0 0 ${width} ${H2}`} role="img" aria-label={t('researchPro.marketContext.dominancechart.ariaBtcVsOthersMarketShare90', "BTC vs OTHERS market share, 90 days")}>
      {[0, 1, 2].map((i) => {
        const y = P.top + (model.innerH * i) / 2
        return <line key={i} x1={P.left} x2={P.left + model.innerW} y1={y} y2={y} stroke={gridColor} strokeWidth="1" />
      })}
      <path d={model.path('btc')} fill="none" stroke={highlight === 'btc' ? btcColor : dim} strokeWidth={highlight === 'btc' ? 1.9 : 1.2} strokeLinejoin="round" />
      <path d={model.path('others')} fill="none" stroke={highlight === 'others' ? othersColor : dim} strokeWidth={highlight === 'others' ? 1.9 : 1.2} strokeLinejoin="round" />
      <text x={P.left + model.innerW + 4} y={model.y(model.last.btc) + 3} fontSize="9.5" fill={highlight === 'btc' ? btcColor : axisColor} fontFamily="var(--font-mono)">
        {model.last.btc.toFixed(0)}%
      </text>
      <text x={P.left + model.innerW + 4} y={model.y(model.last.others) + 3} fontSize="9.5" fill={highlight === 'others' ? othersColor : axisColor} fontFamily="var(--font-mono)">
        {model.last.others.toFixed(0)}%
      </text>
      <text x={P.left} y={H2 - 6} fontSize="9.5" fill={axisColor} fontFamily="var(--font-mono)">
        {new Date(model.t0 * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </text>
      <text x={P.left + model.innerW} y={H2 - 6} fontSize="9.5" fill={axisColor} textAnchor="end" fontFamily="var(--font-mono)">
        {t('researchPro.marketContext.dominancechart.now', "now")}
      </text>
    </svg>
  )
}

const REGIME_META = {
  'risk-on': { label: 'Risk-On', cls: 'bull' },
  neutral: { label: 'Neutral', cls: 'neutral' },
  'risk-off': { label: 'Risk-Off', cls: 'bear' },
}

const RzMarketContext = React.memo(function RzMarketContext({ sym, engine, dayMode }) {
  const { t } = useTranslation()
  const { data: macro, loading: macroLoading } = useMacroContext({ enabled: true })
  const [domRows, setDomRows] = useState(null)

  useEffect(() => {
    let cancelled = false
    getSpectreDominanceHistory(90)
      .then((rows) => { if (!cancelled) setDomRows(rows) })
      .catch(() => { if (!cancelled) setDomRows([]) })
    return () => { cancelled = true }
  }, [])

  const cls = useMemo(() => classifyTokenClass({
    sym,
    rank: engine.market?.rank,
    marketCap: engine.market?.marketCap,
    categories: engine.market?.categories,
    primaryCategory: engine.market?.primaryCategory,
  }), [sym, engine.market])

  const others = useMemo(() => {
    if (!domRows || domRows.length < 2) return { now: null, delta: null }
    const first = domRows[0]
    const last = domRows[domRows.length - 1]
    const val = (r) => Math.max(0, r.others ?? (100 - r.btc - (r.eth || 0)))
    return { now: val(last), delta: val(last) - val(first) }
  }, [domRows])

  const read = useMemo(
    () => composeClassRead({ cls, sym, macro, othersNow: others.now, othersDelta: others.delta }),
    [cls, sym, macro, others]
  )

  const isMicro = cls.key === 'micro' || cls.key === 'nano'
  const highlight = cls.key === 'btc' || cls.key === 'major' ? 'btc' : 'others'
  const primaryDriver = cls.key === 'btc' ? 'fg' : cls.key === 'major' ? 'dom' : isMicro ? 'others' : 'alt'
  const regime = macro?.regime ? REGIME_META[macro.regime] : null

  if (macroLoading && !macro) {
    return (
      <div className={`rz-sen-ctx ${dayMode ? 'rz-sen--day' : ''}`}>
        <div className="rz-sen-shimmer-block animate-shimmer" style={{ height: 16, width: '40%' }} />
        <div className="rz-sen-shimmer-block animate-shimmer" style={{ height: 170 }} />
      </div>
    )
  }

  return (
    <div className={`rz-sen-ctx ${dayMode ? 'rz-sen--day' : ''}`}>
      <div className="rz-sen-ctx-head">
        <span className="rz-sen-ctx-class">{cls.label}</span>
        {regime && (
          <span className={`rz-sen-pill rz-sen-pill--${regime.cls === 'bull' ? 'bull' : regime.cls === 'bear' ? 'bear' : 'neutral'}`}>
            <span className="rz-sen-dot" />{regime.label} tape
          </span>
        )}
        {cls.isMeme && <span className="rz-sen-pill rz-sen-pill--warn">{t('researchPro.marketContext.rzmarketcontext.attentionDrivenAsset', "Attention-driven asset")}</span>}
      </div>

      {read && <p className="rz-sen-ctx-read">{read}</p>}

      <div className="rz-sen-ctx-body">
        <div className="rz-sen-ctx-chart">
          <div className="rz-sen-ctx-chart-title">
            <span>Where the market's money sits · 90d</span>
          </div>
          {domRows === null ? (
            <div className="rz-sen-shimmer-block animate-shimmer" style={{ height: 150 }} />
          ) : domRows.length < 2 ? (
            <div className="rz-sen-chart-empty" style={{ height: 150 }}>{t('researchPro.marketContext.rzmarketcontext.dominanceHistoryUnavailable', "Dominance history unavailable")}</div>
          ) : (
            <DominanceChart rows={domRows} highlight={highlight} dayMode={dayMode} />
          )}
          <div className="rz-sen-ctx-chart-legend">
            <span className={`key ${highlight === 'btc' ? 'primary' : ''}`}><i style={{ background: '#F7931A' }} />{t('researchPro.marketContext.rzmarketcontext.btcShare', "BTC share")}</span>
            <span className={`key ${highlight === 'others' ? 'primary' : ''}`}><i style={{ background: dayMode ? '#0f172a' : '#f5f5f7' }} />OTHERS share{isMicro ? ' — the microcap tide' : ''}</span>
          </div>
        </div>

        <div className="rz-sen-ctx-drivers">
          <div className={`rz-sen-driver ${primaryDriver === 'dom' ? 'rz-sen-driver--primary' : ''}`}>
            {primaryDriver === 'dom' && <span className="rz-sen-driver-tag">{t('researchPro.marketContext.rzmarketcontext.primary', "Primary")}</span>}
            <span className="rz-sen-driver-label">{t('researchPro.marketContext.rzmarketcontext.btcDominance', "BTC Dominance")}</span>
            <span className="rz-sen-driver-val">
              {macro?.dominance?.btc != null ? `${macro.dominance.btc.toFixed(1)}%` : '—'}
              {macro?.dominance?.delta7d != null && (
                <span className={`delta ${macro.dominance.delta7d >= 0 ? 'up' : 'down'}`}>
                  {macro.dominance.delta7d >= 0 ? '+' : ''}{macro.dominance.delta7d.toFixed(1)}pt/7d
                </span>
              )}
            </span>
            <span className="rz-sen-driver-sub">
              {macro?.dominance?.delta7d == null ? 'capital rotation'
                : macro.dominance.delta7d > 0.15 ? 'rotating into BTC — alt headwind'
                : macro.dominance.delta7d < -0.15 ? 'rotating toward alts — tailwind'
                : 'flat week'}
            </span>
          </div>

          <div className={`rz-sen-driver ${primaryDriver === 'alt' ? 'rz-sen-driver--primary' : ''}`}>
            {primaryDriver === 'alt' && <span className="rz-sen-driver-tag">{t('researchPro.marketContext.rzmarketcontext.primary', "Primary")}</span>}
            <span className="rz-sen-driver-label">{t('researchPro.marketContext.rzmarketcontext.altSeason', "Alt Season")}</span>
            <span className="rz-sen-driver-val">
              {macro?.altSeason?.value != null ? Math.round(macro.altSeason.value) : '—'}
              <span className="delta" style={{ color: 'inherit', opacity: 0.5 }}>/100</span>
            </span>
            <span className="rz-sen-driver-sub">
              {macro?.altSeason?.value == null ? 'alt breadth'
                : macro.altSeason.value >= 75 ? 'broad alt outperformance'
                : macro.altSeason.value >= 50 ? 'alts holding their own'
                : 'BTC-led tape'}
            </span>
          </div>

          <div className={`rz-sen-driver ${primaryDriver === 'fg' ? 'rz-sen-driver--primary' : ''}`}>
            {primaryDriver === 'fg' && <span className="rz-sen-driver-tag">{t('researchPro.marketContext.rzmarketcontext.primary', "Primary")}</span>}
            <span className="rz-sen-driver-label">Fear &amp; Greed</span>
            <span className="rz-sen-driver-val">
              {macro?.fg?.value != null ? Math.round(macro.fg.value) : '—'}
              {macro?.fg?.delta7d != null && (
                <span className={`delta ${macro.fg.delta7d >= 0 ? 'up' : 'down'}`}>
                  {macro.fg.delta7d >= 0 ? '+' : ''}{Math.round(macro.fg.delta7d)}/7d
                </span>
              )}
            </span>
            <span className="rz-sen-driver-sub">{macro?.fg?.label || 'risk appetite'}</span>
          </div>

          <div className={`rz-sen-driver ${primaryDriver === 'others' ? 'rz-sen-driver--primary' : ''}`}>
            {primaryDriver === 'others' && <span className="rz-sen-driver-tag">{t('researchPro.marketContext.rzmarketcontext.primary', "Primary")}</span>}
            <span className="rz-sen-driver-label">{t('researchPro.marketContext.rzmarketcontext.othersShare', "OTHERS Share")}</span>
            <span className="rz-sen-driver-val">
              {others.now != null ? `${others.now.toFixed(1)}%` : '—'}
              {others.delta != null && (
                <span className={`delta ${others.delta >= 0 ? 'up' : 'down'}`}>
                  {others.delta >= 0 ? '+' : ''}{others.delta.toFixed(1)}pt/90d
                </span>
              )}
            </span>
            <span className="rz-sen-driver-sub">{isMicro ? 'the tide that reaches microcaps' : 'long-tail market share'}</span>
          </div>
        </div>
      </div>
    </div>
  )
})

export default RzMarketContext
