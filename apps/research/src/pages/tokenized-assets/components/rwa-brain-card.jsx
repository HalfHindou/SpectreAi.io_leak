import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRwaAnalysis } from './useRwaData'
import { isAppActive } from '@/lib/idleManager'

/**
 * RwaBrainCard — one full-width intelligence card (2026-08-03 redesign).
 * Replaces the old RwaBrainSidebar + RwaThesis ("Editorial primer") pair,
 * which duplicated the same Spectre Brain prose in two columns.
 *
 * Layout: header (brain chip + freshness + regime badge) → prose (clamped,
 * inline expand) → regime-metric chips + risk chips → bull/bear two columns
 * → capital rotation themes (rendered ONLY when real flow data exists).
 */

/**
 * useRwaSignalsAndThemes — fetches the server-derived chip set + capital
 * rotation themes from /api/rwa/signals + /api/rwa/themes. Falls back to
 * the local heuristic derivation in deriveThemes() when the endpoints fail.
 */
function useRwaSignalsAndThemes() {
  const [data, setData] = useState({ signals: null, themes: null, loading: true })
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [sRes, tRes] = await Promise.all([
          fetch('/api/rwa/signals').then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch('/api/rwa/themes').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ])
        if (cancelled) return
        setData({ signals: sRes, themes: tRes, loading: false })
      } catch {
        if (!cancelled) setData({ signals: null, themes: null, loading: false })
      }
    }
    load()
    // 60s refresh — matches /signals server cache TTL. Skip while tab hidden.
    const id = setInterval(() => {
      if (document.hidden || !isAppActive()) return
      load()
    }, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])
  return data
}

function fmtAgo(iso, t) {
  if (!iso) return ''
  const then = typeof iso === 'string' ? new Date(iso).getTime() : iso
  const diff = Math.max(0, Date.now() - then)
  const m = Math.floor(diff / 60000)
  if (m < 1) return t ? t('tokenizedAssets.brainSidebar.time.justNow', 'just now') : 'just now'
  if (m < 60) return t ? t('tokenizedAssets.brainSidebar.time.minutesAgo', '{{m}}m ago', { m }) : `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return t ? t('tokenizedAssets.brainSidebar.time.hoursAgo', '{{h}}h ago', { h }) : `${h}h ago`
  const d = Math.floor(h / 24)
  return t ? t('tokenizedAssets.brainSidebar.time.daysAgo', '{{d}}d ago', { d }) : `${d}d ago`
}

/* Spectre mark used in the "analyzing" state — a quiet concentric pulse,
   NOT a robot/brain/sparkle. Reads as a live signal beacon. */
function SpectreMark() {
  return (
    <span className="rbc-beacon" aria-hidden="true">
      <span className="rbc-beacon-ring" />
      <span className="rbc-beacon-ring rbc-beacon-ring--2" />
      <span className="rbc-beacon-core" />
    </span>
  )
}

/* Alive loading/empty state for the Spectre Brain body — beacon + scanning
   bar + shimmer lines so the card reads as actively working, not broken. */
function BrainAnalyzing({ label }) {
  return (
    <div className="rbc-analyzing" role="status" aria-live="polite">
      <div className="rbc-analyzing-head">
        <SpectreMark />
        <span className="rbc-analyzing-label">{label}</span>
      </div>
      <div className="rbc-scan"><span className="rbc-scan-bar" /></div>
      <div className="rbc-skel">
        <div className="rbc-skel-line animate-shimmer" />
        <div className="rbc-skel-line animate-shimmer stagger-2" style={{ width: '88%' }} />
        <div className="rbc-skel-line animate-shimmer stagger-3" style={{ width: '64%' }} />
      </div>
    </div>
  )
}

/* Heuristic regime label from 30D change magnitude.
   TODO: replace with structured regime data from /api/rwa/analysis/regime
   once the Spectre Brain backend exposes it. */
function deriveRegime({ change30d }) {
  if (change30d == null) {
    return {
      labelKey: 'stableEquilibrium', labelFallback: 'Stable Equilibrium',
      tone: 'neutral',
      metrics: [
        { kKey: 'liquidity',  kFallback: 'Liquidity',  vKey: 'adequate', vFallback: 'Adequate' },
        { kKey: 'volatility', kFallback: 'Volatility', vKey: 'low',      vFallback: 'Low' },
        { kKey: 'yieldEnv',   kFallback: 'Yield Env',  vKey: 'mixed',    vFallback: 'Mixed' },
        { kKey: 'conviction', kFallback: 'Conviction', vKey: 'neutral',  vFallback: 'Neutral' },
      ],
    }
  }
  if (change30d >= 25) {
    return {
      labelKey: 'riskOnExpansion', labelFallback: 'Risk-On Expansion',
      tone: 'up',
      metrics: [
        { kKey: 'liquidity',  kFallback: 'Liquidity',  vKey: 'high',     vFallback: 'High' },
        { kKey: 'volatility', kFallback: 'Volatility', vKey: 'moderate', vFallback: 'Moderate' },
        { kKey: 'yieldEnv',   kFallback: 'Yield Env',  vKey: 'falling',  vFallback: 'Falling' },
        { kKey: 'conviction', kFallback: 'Conviction', vKey: 'strong',   vFallback: 'Strong' },
      ],
    }
  }
  if (change30d >= 5) {
    return {
      labelKey: 'cautiousBid', labelFallback: 'Cautious Bid',
      tone: 'up',
      metrics: [
        { kKey: 'liquidity',  kFallback: 'Liquidity',  vKey: 'adequate', vFallback: 'Adequate' },
        { kKey: 'volatility', kFallback: 'Volatility', vKey: 'low',      vFallback: 'Low' },
        { kKey: 'yieldEnv',   kFallback: 'Yield Env',  vKey: 'stable',   vFallback: 'Stable' },
        { kKey: 'conviction', kFallback: 'Conviction', vKey: 'building', vFallback: 'Building' },
      ],
    }
  }
  if (change30d <= -10) {
    return {
      labelKey: 'defensiveRotation', labelFallback: 'Defensive Rotation',
      tone: 'dn',
      metrics: [
        { kKey: 'liquidity',  kFallback: 'Liquidity',  vKey: 'tight',   vFallback: 'Tight' },
        { kKey: 'volatility', kFallback: 'Volatility', vKey: 'high',    vFallback: 'High' },
        { kKey: 'yieldEnv',   kFallback: 'Yield Env',  vKey: 'rising',  vFallback: 'Rising' },
        { kKey: 'conviction', kFallback: 'Conviction', vKey: 'weak',    vFallback: 'Weak' },
      ],
    }
  }
  return {
    labelKey: 'rangeBound', labelFallback: 'Range-Bound',
    tone: 'neutral',
    metrics: [
      { kKey: 'liquidity',  kFallback: 'Liquidity',  vKey: 'adequate', vFallback: 'Adequate' },
      { kKey: 'volatility', kFallback: 'Volatility', vKey: 'low',      vFallback: 'Low' },
      { kKey: 'yieldEnv',   kFallback: 'Yield Env',  vKey: 'stable',   vFallback: 'Stable' },
      { kKey: 'conviction', kFallback: 'Conviction', vKey: 'mixed',    vFallback: 'Mixed' },
    ],
  }
}

/* Curated chips — backed by the regime tone but content is editorial.
   TODO: hook this to /api/rwa/signals once available. */
const RISK_CHIPS_UP = [
  { key: 'highConviction',    fallback: 'High Conviction' },
  { key: 'yieldOpportunity',  fallback: 'Yield Opportunity' },
  { key: 'policyTailwind',    fallback: 'Policy Tailwind' },
  { key: 'smartMoneyFlowing', fallback: 'Smart Money Flowing' },
  { key: 'rateSensitivity',   fallback: 'Rate Sensitivity' },
  { key: 'liquidityClusters', fallback: 'Liquidity Clusters' },
]
const RISK_CHIPS_DN = [
  { key: 'outflowPressure',   fallback: 'Outflow Pressure' },
  { key: 'yieldCompression',  fallback: 'Yield Compression' },
  { key: 'policyHeadwind',    fallback: 'Policy Headwind' },
  { key: 'smartMoneyPausing', fallback: 'Smart Money Pausing' },
  { key: 'concentrationRisk', fallback: 'Concentration Risk' },
  { key: 'liquidityDrain',    fallback: 'Liquidity Drain' },
]
const RISK_CHIPS_NEUTRAL = [
  { key: 'mixedSignals',    fallback: 'Mixed Signals' },
  { key: 'policyWatch',     fallback: 'Policy Watch' },
  { key: 'stableYields',    fallback: 'Stable Yields' },
  { key: 'evenFlows',       fallback: 'Even Flows' },
  { key: 'rateSensitivity', fallback: 'Rate Sensitivity' },
  { key: 'liquidityStable', fallback: 'Liquidity Stable' },
]

/* Themes — curated from RWA category leadership. When server-derived themes
   exist they pass through as-is. */
function deriveThemes({ change7dByClass }) {
  const fallback = [
    { titleKey: 'tokenizedTreasuries',     titleFallback: 'Tokenized Treasuries',
      subKey:   'strongInflows',           subFallback:   'Strong inflows, institutional demand' },
    { titleKey: 'stablecoinYieldWrappers', titleFallback: 'Stablecoin Yield Wrappers',
      subKey:   'realYieldNarrative',      subFallback:   'Real-yield narrative gaining share' },
    { titleKey: 'commoditiesOnChain',      titleFallback: 'Commodities On-Chain',
      subKey:   'goldBackedSteady',        subFallback:   'Gold-backed tokens steady, slow grind' },
    { titleKey: 'privateCreditMaturity',   titleFallback: 'Private Credit Maturity',
      subKey:   'defaultCycle',            subFallback:   'Default cycle watched closely' },
  ]
  if (!change7dByClass) return fallback
  const sorted = [...change7dByClass].sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity))
  if (!sorted.length) return fallback
  const subFor = (ch) => {
    if (ch == null) return { subKey: 'flowDataPending', subFallback: 'Flow data pending' }
    if (ch >= 8)    return { subKey: 'strongInflows',   subFallback: 'Strong inflows, institutional demand' }
    if (ch >= 2)    return { subKey: 'steadyAccumulation', subFallback: 'Steady accumulation, healthy bid' }
    if (ch >= -2)   return { subKey: 'rangeBoundAwait',    subFallback: 'Range-bound, awaiting catalyst' }
    if (ch >= -8)   return { subKey: 'outflowWatching',    subFallback: 'Outflow pressure, watching support' }
    return { subKey: 'sharpDrawdown', subFallback: 'Sharp drawdown, defensive posture' }
  }
  return sorted.slice(0, 4).map(c => {
    const sub = subFor(c.change)
    return { title: c.label, ...sub }
  })
}

/* Bull/bear editorial cases — moved from the deleted RwaThesis card.
   Curated copy until /v1/brain/thesis/rwa lands. */
const BULL = [
  {
    title: 'Institutional capital is on-chain',
    body: 'BlackRock BUIDL, Franklin BENJI, Ondo USDY have pulled >$10B in 18 months. Treasuries account for ~50% of all RWA mcap.',
  },
  {
    title: 'Yield infrastructure',
    body: 'Treasury-backed stablecoins compose with DeFi — collateral for lending, settlement, and onchain T+0 funds.',
  },
  {
    title: 'Regulatory tailwinds',
    body: 'MiCA live in EU, GENIUS Act in US — compliant rails for institutions to issue and custody tokenized securities.',
  },
]
const BEAR = [
  {
    title: 'Concentration risk',
    body: 'BlackRock + Circle + Tether control >80% of issuance. Single-issuer custody is the single biggest tail risk.',
  },
  {
    title: 'Yield compression',
    body: 'If the Fed cuts, the spread between Treasury yields and DeFi-native rates narrows — RWA inflows slow.',
  },
  {
    title: 'Smart contract surface',
    body: 'Custodial mint/redeem flows centralize the trust assumption. A single oracle or bridge incident wipes confidence.',
  },
]

export default function RwaBrainCard({ tvlHistory, overview, loading }) {
  const { t } = useTranslation()
  const ai = useRwaAnalysis('overview')
  const ago = fmtAgo(ai.lastUpdated, t)
  const { signals: liveSignals, themes: liveThemes } = useRwaSignalsAndThemes()
  const [expanded, setExpanded] = useState(false)

  const { change30d, change7dByClass } = useMemo(() => {
    const s = tvlHistory?.series || []
    const cats = tvlHistory?.categories || []
    if (s.length < 8 || !cats.length) return { change30d: null, change7dByClass: null }
    const totalAt = (i) => cats.reduce((acc, c) => acc + (s[i][c] || 0), 0)
    const last = totalAt(s.length - 1)
    const prev30 = totalAt(Math.max(0, s.length - 31))
    const ch30 = prev30 > 0 ? ((last - prev30) / prev30) * 100 : null

    const DISPLAY = {
      Treasuries: 'Bonds & Treasuries',
      Credit: 'Private Credit',
      Commodities: 'Precious Metals',
      'Other RWA': 'Other RWA',
    }
    const last7Idx = Math.max(0, s.length - 8)
    const byClass = cats.map(c => {
      const a = s[last7Idx][c] || 0
      const b = s[s.length - 1][c] || 0
      const change = a > 0 ? ((b - a) / a) * 100 : null
      return { label: DISPLAY[c] || c, change }
    })
    return { change30d: ch30, change7dByClass: byClass }
  }, [tvlHistory])

  const regime = deriveRegime({ change30d })

  const themes = useMemo(() => {
    if (Array.isArray(liveThemes?.themes) && liveThemes.themes.length) {
      return liveThemes.themes.map((th) => ({ title: th.title, sub: th.sub }))
    }
    return deriveThemes({ change7dByClass })
  }, [liveThemes, change7dByClass])

  // Spec: hide the rotation-themes block while flow data is pending — a list
  // of "Flow data pending" rows is dead weight. Reappears when real subs land.
  const themesReady = themes.some(th =>
    (th.subKey ?? '') !== 'flowDataPending' && th.sub !== 'Flow data pending')

  const chips = useMemo(() => {
    if (Array.isArray(liveSignals?.chips) && liveSignals.chips.length) {
      return liveSignals.chips.map((c) => ({ key: c.label, fallback: c.label, dynamic: true }))
    }
    if (regime.tone === 'up') return RISK_CHIPS_UP
    if (regime.tone === 'dn') return RISK_CHIPS_DN
    return RISK_CHIPS_NEUTRAL
  }, [liveSignals, regime.tone])

  const prose = ai.article
    ? (expanded || ai.article.length <= 300 ? ai.article : `${ai.article.slice(0, 300)}…`)
    : null

  return (
    <section className="rbc" aria-label={t('tokenizedAssets.brainSidebar.ariaLabel', 'Spectre Brain')}>
      <header className="rbc-head">
        <span className="rbc-chip">
          <span className="rbc-chip-dot" aria-hidden="true" />
          <span className="rbc-chip-label">{t('tokenizedAssets.brainSidebar.spectreBrain', 'SPECTRE BRAIN')}</span>
        </span>
        {ago && <span className="rbc-time">{ago}</span>}
        <div className={`rbc-regime rbc-regime--${regime.tone}`}>
          <span className="rbc-regime-dot" />
          <span className="rbc-regime-label">
            {t(`tokenizedAssets.brainSidebar.regime.${regime.labelKey}`, regime.labelFallback).toUpperCase()}
          </span>
        </div>
      </header>

      {prose ? (
        <p className="rbc-body">
          {prose}
          {ai.article.length > 300 && (
            <button type="button" className="rbc-more" onClick={() => setExpanded(e => !e)}>
              {expanded
                ? t('tokenizedAssets.brainSidebar.showLess', 'Show less')
                : t('tokenizedAssets.brainSidebar.viewFullAnalysis', 'View Full Analysis')}{' '}
              <span aria-hidden>&rarr;</span>
            </button>
          )}
        </p>
      ) : (
        <BrainAnalyzing label={t('tokenizedAssets.brainSidebar.analyzingSignal', 'Analyzing live signal')} />
      )}

      <div className="rbc-chips">
        {regime.metrics.map(m => (
          <span key={m.kKey} className="rbc-metric-chip">
            <span className="rbc-metric-k">{t(`tokenizedAssets.brainSidebar.metricKey.${m.kKey}`, m.kFallback)}</span>
            <span className="rbc-metric-v">{t(`tokenizedAssets.brainSidebar.metricValue.${m.vKey}`, m.vFallback)}</span>
          </span>
        ))}
        <span className="rbc-chips-sep" aria-hidden="true" />
        {chips.map(c => (
          <span key={c.key} className="rbc-pill">
            {c.dynamic ? c.fallback : t(`tokenizedAssets.brainSidebar.chip.${c.key}`, c.fallback)}
          </span>
        ))}
      </div>

      <div className="rbc-cases">
        <div className="rbc-case rbc-case--bull">
          <span className="rbc-case-hd">
            <span className="rbc-case-pill rbc-case-pill--bull">{t('tokenizedAssets.thesis.bull', 'BULL')}</span>
            {t('tokenizedAssets.thesis.bullCase', 'Why it works')}
          </span>
          <ul className="rbc-list">
            {BULL.map(b => (
              <li key={b.title} className="rbc-item">
                <span className="rbc-item-title">{b.title}</span>
                <span className="rbc-item-body">{b.body}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rbc-case rbc-case--bear">
          <span className="rbc-case-hd">
            <span className="rbc-case-pill rbc-case-pill--bear">{t('tokenizedAssets.thesis.bear', 'BEAR')}</span>
            {t('tokenizedAssets.thesis.bearCase', 'What can break it')}
          </span>
          <ul className="rbc-list">
            {BEAR.map(b => (
              <li key={b.title} className="rbc-item">
                <span className="rbc-item-title">{b.title}</span>
                <span className="rbc-item-body">{b.body}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {themesReady && (
        <div className="rbc-themes-block">
          <header className="rbc-sub-hd">{t('tokenizedAssets.brainSidebar.capitalRotation', 'CAPITAL ROTATION THEMES')}</header>
          <ol className="rbc-themes">
            {themes.map((th, i) => {
              const title = th.titleKey ? t(`tokenizedAssets.brainSidebar.theme.${th.titleKey}`, th.titleFallback) : th.title
              const sub = th.subKey ? t(`tokenizedAssets.brainSidebar.themeSub.${th.subKey}`, th.subFallback) : th.sub
              return (
                <li key={title + i} className="rbc-theme">
                  <span className="rbc-theme-num mono">{i + 1}</span>
                  <span className="rbc-theme-body">
                    <span className="rbc-theme-title">{title}</span>
                    <span className="rbc-theme-sub">{sub}</span>
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </section>
  )
}
