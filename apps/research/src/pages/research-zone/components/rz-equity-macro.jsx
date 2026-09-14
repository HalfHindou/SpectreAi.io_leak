/**
 * Equity Macro Context — Technicals tab, stocks only.
 *
 * The stock counterpart of rz-macro-analysis (which is crypto-native: BTC
 * dominance, funding, alt season). Equities trade the index tape: SPY vs its
 * 200-day, QQQ momentum, the VIX regime, and whether the market is even open.
 * All deterministic, composed from feeds the app already has — SPY/QQQ daily
 * bars ride the same deduped/seeded fetcher the indicator engine uses, VIX is
 * one quote. Reuses rz-macro-analysis.css chip classes (no new stylesheet).
 */
import React, { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import SectionShell from './rz-pro-sections/section-shell'
import { fetchSeriesBars, emaSeries } from '../hooks/use-kline-indicators'
import { getStockQuotes } from '@/services/stockApi'
import useUsMarketStatus from '@/pages/home/components/use-us-market-status'
import './rz-macro-analysis.css'

const REGIME_META = {
  'risk-on':  { label: 'Risk-On',  cls: 'bull' },
  'neutral':  { label: 'Neutral',  cls: 'neutral' },
  'risk-off': { label: 'Risk-Off', cls: 'bear' },
}

function Chip({ label, value, sub, tone }) {
  return (
    <div className={`rz-te2-macro-chip${tone ? ` rz-te2-macro-chip--${tone}` : ''}`}>
      <span className="rz-te2-macro-chip-label">{label}</span>
      <span className="rz-te2-macro-chip-value mono">{value}</span>
      {sub != null && <span className="rz-te2-macro-chip-sub mono">{sub}</span>}
    </div>
  )}

function indexDigest(bars) {
  if (!bars || bars.length < 30) return null
  const closes = bars.map(b => b.c)
  const last = closes[closes.length - 1]
  const ema200Arr = emaSeries(closes, 200)
  const ema200 = ema200Arr ? ema200Arr[ema200Arr.length - 1] : null
  const back21 = closes[Math.max(0, closes.length - 22)] // ~1 trading month
  return {
    last,
    above200d: ema200 != null ? last >= ema200 : null,
    dist200dPct: ema200 != null ? ((last - ema200) / ema200) * 100 : null,
    change1moPct: back21 ? ((last - back21) / back21) * 100 : null,
  }
}

function EquityMacroSection({ sym, td }) {
  const { t } = useTranslation()
  const [spy, setSpy] = useState(null)
  const [qqq, setQqq] = useState(null)
  const [vix, setVix] = useState(null)
  const [loading, setLoading] = useState(true)
  const market = useUsMarketStatus()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.allSettled([
      fetchSeriesBars({ symbol: 'SPY', resolution: '1D', assetClass: 'stock' }),
      fetchSeriesBars({ symbol: 'QQQ', resolution: '1D', assetClass: 'stock' }),
      getStockQuotes(['^VIX']),
    ]).then(([spyRes, qqqRes, vixRes]) => {
      if (cancelled) return
      setSpy(spyRes.status === 'fulfilled' ? indexDigest(spyRes.value) : null)
      setQqq(qqqRes.status === 'fulfilled' ? indexDigest(qqqRes.value) : null)
      const v = vixRes.status === 'fulfilled' ? Number(vixRes.value?.['^VIX']?.price) : null
      setVix(Number.isFinite(v) && v > 0 ? v : null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const { regimeKey, chips, read } = useMemo(() => {
    const chips = []
    if (spy?.dist200dPct != null) {
      chips.push({
        label: 'SPY vs 200D',
        value: `${spy.dist200dPct >= 0 ? '+' : ''}${spy.dist200dPct.toFixed(1)}%`,
        sub: spy.above200d ? 'uptrend intact' : 'below trend',
        tone: spy.above200d ? 'bull' : 'bear',
      })
    }
    if (qqq?.change1moPct != null) {
      chips.push({
        label: 'QQQ 1mo',
        value: `${qqq.change1moPct >= 0 ? '+' : ''}${qqq.change1moPct.toFixed(1)}%`,
        sub: qqq.above200d != null ? (qqq.above200d ? 'above 200D' : 'below 200D') : null,
        tone: qqq.change1moPct >= 2 ? 'bull' : qqq.change1moPct <= -2 ? 'bear' : null,
      })
    }
    if (vix != null) {
      chips.push({
        label: 'VIX',
        value: vix.toFixed(1),
        sub: vix >= 28 ? 'stressed' : vix >= 20 ? 'elevated' : 'calm',
        tone: vix >= 28 ? 'bear' : vix >= 20 ? 'warn' : 'bull',
      })
    }
    const beta = Number(td?.beta)
    if (Number.isFinite(beta) && beta > 0) {
      chips.push({
        label: 'Beta',
        value: beta.toFixed(2),
        sub: beta >= 1.5 ? 'amplifies the index' : beta <= 0.7 ? 'defensive' : 'tracks the index',
        tone: beta >= 1.5 ? 'warn' : null,
      })
    }
    chips.push({
      label: 'US Market',
      value: market.isOpen ? 'Open' : 'Closed',
      sub: market.countdown || null,
      tone: market.isOpen ? 'bull' : null,
    })

    let regimeKey = 'neutral'
    if (spy?.above200d === true && (vix == null || vix < 20)) regimeKey = 'risk-on'
    else if (spy?.above200d === false || (vix != null && vix >= 28)) regimeKey = 'risk-off'

    const bits = []
    if (spy?.above200d != null) bits.push(`SPY is ${spy.above200d ? 'above' : 'below'} its 200-day (${spy.dist200dPct >= 0 ? '+' : ''}${spy.dist200dPct.toFixed(1)}%)`)
    if (vix != null) bits.push(`VIX at ${vix.toFixed(0)} reads ${vix >= 28 ? 'stressed — expect gap risk and failed breakouts' : vix >= 20 ? 'elevated — size for wider swings' : 'calm — trends carry further'}`)
    if (!market.isOpen) bits.push(`the market is closed${market.countdown ? ` (${market.countdown.toLowerCase()})` : ''} — intraday clocks read as of the last session`)
    const read = bits.length ? `${bits.join('; ')}.` : null

    return { regimeKey, chips, read }
  }, [spy, qqq, vix, td?.beta, market.isOpen, market.countdown])

  const regime = REGIME_META[regimeKey] || REGIME_META.neutral
  const hasData = spy || qqq || vix != null

  return (
    <SectionShell
      id="ta-macro"
      label={t('researchPro.equityMacro.equitymacro.label', "TECHNICALS · MACRO")}
      title={t('researchPro.equityMacro.equitymacro.title', "Market Context")}
      subtitle={`Index backdrop ${sym ? `for ${sym}` : ''} · SPY / QQQ / VIX, live data`}
      liveBadge
      collapsible
    >
      {loading && !hasData ? (
        <div className="rz-te2-macro rz-te2-macro--loading">
          <div className="rz-te2-macro-chips">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rz-te2-macro-chip">
                <span className="animate-shimmer" style={{ width: 70, height: 10, borderRadius: 4 }} />
                <span className="animate-shimmer" style={{ width: 48, height: 16, borderRadius: 4, marginTop: 6 }} />
              </div>
            ))}
          </div>
          <div className="animate-shimmer" style={{ width: '80%', height: 14, borderRadius: 6, marginTop: 14 }} />
        </div>
      ) : !hasData ? (
        <div className="rz-te2-macro rz-te2-macro--empty">{t('researchPro.equityMacro.equitymacro.indexDataUnavailableRightN', "Index data unavailable right now.")}</div>
      ) : (
        <div className="rz-te2-macro">
          <div className="rz-te2-macro-top">
            <span className={`rz-te2-macro-regime rz-te2-macro-regime--${regime.cls}`}>
              <span className="rz-te2-macro-regime-dot" />
              {regime.label}
            </span>
            <span className="rz-te2-macro-note">{t('researchPro.equityMacro.equitymacro.howTheIndexTapeReadsForU', "How the index tape reads for US equities right now")}</span>
          </div>
          <div className="rz-te2-macro-chips">
            {chips.map(c => <Chip key={c.label} {...c} />)}
          </div>
          {read && <p className="rz-te2-macro-read">{read}</p>}
        </div>
      )}
    </SectionShell>
  )
}

export default React.memo(EquityMacroSection)
