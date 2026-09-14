/**
 * Macro Context box — Technicals tab, top coins only.
 *
 * Majors trade the macro tape: rate of risk appetite, BTC trend, dominance
 * rotation, alt breadth, leverage posture. All values live from endpoints the
 * app already caches; the regime + read are composed deterministically —
 * no LLM, no new backend, identical in dev and prod.
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import SectionShell from './rz-pro-sections/section-shell'
import { classifyToken } from '@/lib/token-class'
import useMacroContext from '../hooks/use-macro-context'
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
  )
}

function MacroAnalysisSection({ sym, td, activeTokenInfo, fundingRates, openInterest, longShortRatio, fmtPrice }) {
  const { t } = useTranslation()
  // Top-coins gate via the real market-class read (mcap/rank/venue), not the
  // MAJOR_SYMBOLS routing list — a clone ticker colliding with the list (a
  // Base "DOT") must not get the majors macro read, and a genuine $1B+ alt
  // that isn't on the list should. Small caps trade their own liquidity, not
  // the macro tape — the box would be noise there.
  const rank = activeTokenInfo?.rank ?? td?.rank ?? td?.market_cap_rank ?? null
  const tokenClass = useMemo(() => classifyToken({
    sym,
    address: activeTokenInfo?.address,
    binancePair: activeTokenInfo?.binancePair,
    rank,
    marketCap: td?.marketCap ?? td?.mcap ?? null,
    categories: td?.categories,
    primaryCategory: td?.category ?? td?.primaryCategory,
  }), [sym, activeTokenInfo?.address, activeTokenInfo?.binancePair, rank, td?.marketCap, td?.mcap, td?.categories, td?.category, td?.primaryCategory])
  const isTopCoin = tokenClass.isMacro

  const { loading, data } = useMacroContext({ enabled: isTopCoin, fundingRates })

  const chips = useMemo(() => {
    if (!data) return []
    const out = []
    if (data.fg?.value != null) {
      out.push({
        label: 'Fear & Greed',
        value: `${Math.round(data.fg.value)}`,
        sub: data.fg.delta7d != null ? `${data.fg.delta7d >= 0 ? '+' : ''}${Math.round(data.fg.delta7d)} 7d` : (data.fg.label || null),
        tone: data.fg.value >= 60 ? 'bull' : data.fg.value <= 35 ? 'bear' : null,
      })
    }
    if (data.btcTrend) {
      out.push({
        label: 'BTC vs 200D',
        value: `${data.btcTrend.above200d ? '+' : ''}${data.btcTrend.distPct.toFixed(1)}%`,
        sub: data.btcTrend.above200d ? 'uptrend intact' : 'below trend',
        tone: data.btcTrend.above200d ? 'bull' : 'bear',
      })
    }
    if (data.dominance?.btc != null) {
      out.push({
        label: 'BTC Dominance',
        value: `${data.dominance.btc.toFixed(1)}%`,
        sub: data.dominance.delta7d != null ? `${data.dominance.delta7d >= 0 ? '+' : ''}${data.dominance.delta7d.toFixed(1)}pt 7d` : null,
        tone: data.dominance.delta7d != null && data.dominance.delta7d > 0.15 ? 'bear' : null,
      })
    }
    if (data.altSeason?.value != null) {
      const v = data.altSeason.value
      out.push({
        label: 'Alt Season',
        value: `${Math.round(v)}/100`,
        // show the receipt when computed locally: "9/50 beat BTC 30d"
        sub: data.altSeason.sample
          ? `${data.altSeason.beating}/${data.altSeason.sample} beat BTC 30d`
          : v >= 75 ? 'alt season' : v <= 25 ? 'BTC season' : 'mixed',
        tone: v >= 75 ? 'bull' : v <= 25 ? 'bear' : null,
      })
    }
    if (data.funding != null) {
      out.push({
        label: 'Funding (avg)',
        value: `${data.funding >= 0 ? '+' : ''}${data.funding.toFixed(4)}%`,
        sub: data.funding > 0.02 ? 'longs pay' : data.funding < -0.02 ? 'shorts pay' : 'balanced',
        tone: Math.abs(data.funding) > 0.02 ? 'warn' : null,
      })
    }
    const lsr = Number(longShortRatio?.ratio)
    if (Number.isFinite(lsr) && lsr > 0) {
      out.push({
        label: 'Long/Short',
        value: lsr.toFixed(2),
        sub: lsr > 1.3 ? 'long-heavy' : lsr < 0.77 ? 'short-heavy' : 'balanced',
        tone: lsr > 1.3 || lsr < 0.77 ? 'warn' : null,
      })
    }
    return out
  }, [data, longShortRatio?.ratio])

  if (!isTopCoin) return null

  const regime = REGIME_META[data?.regime] || REGIME_META.neutral

  return (
    <SectionShell
      id="ta-macro"
      label={t('researchPro.macroAnalysis.macroanalysis.label', "TECHNICALS · MACRO")}
      title={t('researchPro.macroAnalysis.macroanalysis.title', "Macro Context")}
      subtitle={`Market-wide backdrop ${sym ? `for ${sym}` : ''} · live data, composed read`}
      liveBadge
      collapsible
    >
      {loading && !data ? (
        <div className="rz-te2-macro rz-te2-macro--loading">
          <div className="rz-te2-macro-chips">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rz-te2-macro-chip">
                <span className="animate-shimmer" style={{ width: 70, height: 10, borderRadius: 4 }} />
                <span className="animate-shimmer" style={{ width: 48, height: 16, borderRadius: 4, marginTop: 6 }} />
              </div>
            ))}
          </div>
          <div className="animate-shimmer" style={{ width: '80%', height: 14, borderRadius: 6, marginTop: 14 }} />
        </div>
      ) : !data ? (
        <div className="rz-te2-macro rz-te2-macro--empty">{t('researchPro.macroAnalysis.macroanalysis.macroDataUnavailableRightN', "Macro data unavailable right now.")}</div>
      ) : (
        <div className="rz-te2-macro">
          <div className="rz-te2-macro-top">
            <span className={`rz-te2-macro-regime rz-te2-macro-regime--${regime.cls}`}>
              <span className="rz-te2-macro-regime-dot" />
              {regime.label}
            </span>
            <span className="rz-te2-macro-note">{t('researchPro.macroAnalysis.macroanalysis.howTheMarketTapeReadsFor', "How the market tape reads for majors right now")}</span>
          </div>
          <div className="rz-te2-macro-chips">
            {chips.map(c => <Chip key={c.label} {...c} />)}
          </div>
          {data.read && <p className="rz-te2-macro-read">{data.read}</p>}
        </div>
      )}
    </SectionShell>
  )
}

export default React.memo(MacroAnalysisSection)
