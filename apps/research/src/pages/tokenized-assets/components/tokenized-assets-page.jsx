import React, { useState, useCallback, useEffect, useRef, Suspense, memo } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { useRwaData } from './useRwaData'
// Default tab is 'overview' — keep that eager. The other 7 tabs and
// the modal only render on user click; lazy keeps each in its own chunk.
import RwaOverviewTab from './rwa-overview-tab'
const RwaReviewTab      = lazy(() => import('./rwa-review-tab'))
const RwaTreasuriesTab  = lazy(() => import('./rwa-treasuries-tab'))
const RwaCreditTab      = lazy(() => import('./rwa-credit-tab'))
const RwaStablecoinsTab = lazy(() => import('./rwa-stablecoins-tab'))
const RwaCommoditiesTab = lazy(() => import('./rwa-commodities-tab'))
const RwaNetworksTab    = lazy(() => import('./rwa-networks-tab'))
const RwaPlatformsTab   = lazy(() => import('./rwa-platforms-tab'))
const RwaScreenerTab    = lazy(() => import('./rwa-screener-tab'))
const RwaRiskAlphaTab   = lazy(() => import('./rwa-risk-alpha-tab'))
const RwaProtocolModal  = lazy(() => import('./rwa-protocol-modal'))
import { AssetDetailPanel } from './shared'
// Mobile-only inline components reused from the Overview tab
import RwaClassAllocation from './rwa-class-allocation'
import RwaBrainCard from './rwa-brain-card'
// Heavy + below-fold on mobile too. Must be lazy() in BOTH this render path AND
// rwa-overview-tab.jsx, else the static import keeps them in the main route chunk.
const RwaActiveMcapChart = lazy(() => import('./rwa-active-mcap-chart'))
const RwaTweets = lazy(() => import('./rwa-tweets'))
// Right-edge Voices drawer. lazy() + mounted only once opened, so a page load
// that never opens it costs nothing: no chunk, no request, no DOM.
const RwaVoicesPanel = lazy(() => import('./rwa-voices-panel'))
import './tokenized-assets-page.css'
import './tokenized-assets-page.mobile.css'

/*
 * Tab bar (2026-08-03 consolidation, 11 -> 5):
 *   Overview · Asset Classes [Stablecoins·Treasuries·Credit·Commodities]
 *   · Infrastructure [Networks·Platforms] · Screener
 *   · Intelligence [Review·Risk & Alpha]
 * `activeTab` still holds the LEAF section id, so renderTab() and the
 * useRwaData gating (risk-alpha / networks) are untouched.
 */
const TABS = [
  { id: 'overview', labelKey: 'overview', labelFallback: 'Overview' },
  { id: 'classes', labelKey: 'assetClasses', labelFallback: 'Asset Classes', subs: ['stablecoins', 'treasuries', 'credit', 'commodities'] },
  { id: 'infrastructure', labelKey: 'infrastructure', labelFallback: 'Infrastructure', subs: ['networks', 'platforms'] },
  { id: 'screener', labelKey: 'screener', labelFallback: 'Screener' },
  { id: 'intelligence', labelKey: 'intelligence', labelFallback: 'Intelligence', subs: ['review', 'risk-alpha'] },
]
// leaf id -> [labelKey, fallback] for the sub-pill row
const SECTION_LABELS = {
  stablecoins: ['stablecoins', 'Stablecoins'],
  treasuries: ['treasuries', 'Treasuries'],
  credit: ['credit', 'Credit'],
  commodities: ['commodities', 'Commodities'],
  networks: ['networks', 'Networks'],
  platforms: ['platforms', 'Platforms'],
  review: ['review', 'Review'],
  'risk-alpha': ['riskAlpha', 'Risk & Alpha'],
}
// leaf id -> parent tab id
const PARENT_OF = {}
for (const tab of TABS) for (const s of (tab.subs || [])) PARENT_OF[s] = tab.id

// Self-contained freshness pill. Owns the 1s ticker + `freshness` state so the
// per-second tick re-renders ONLY this pill, not the whole page/active tab
// (the page's heaviest tab was reconciling 1x/sec purely for this counter).
// Props (the 4 timestamps) change only on a data refetch, so the pill's parent
// stays still between refetches.
const RwaFreshnessPill = memo(function RwaFreshnessPill({
  mainUpdatedAt, historyUpdatedAt, phase7UpdatedAt, phase8UpdatedAt,
  t, mobile = false, onRefresh, disabled = false,
}) {
  const [freshness, setFreshness] = useState(null)
  useEffect(() => {
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      const allStamps = [mainUpdatedAt, historyUpdatedAt, phase7UpdatedAt, phase8UpdatedAt].filter((s) => Number.isFinite(s))
      if (allStamps.length === 0) return
      // Exclude phase8 (hourly upstream) from "oldest" so the pill reflects the
      // actively-polled streams, not the permanently-stale hourly surface.
      const activeStamps = [mainUpdatedAt, historyUpdatedAt, phase7UpdatedAt].filter((s) => Number.isFinite(s))
      const oldest = activeStamps.length ? Math.min(...activeStamps) : allStamps[0]
      setFreshness(Math.max(0, Math.round((Date.now() - oldest) / 1000)))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [mainUpdatedAt, historyUpdatedAt, phase7UpdatedAt, phase8UpdatedAt])

  const freshnessClass = freshness == null ? '' : freshness < 180 ? 'fresh' : freshness < 900 ? 'stale' : 'old'
  const label = freshness == null ? null : freshness < 60
    ? t('tokenizedAssets.freshness.secondsAgo', '{{seconds}}s ago', { seconds: freshness })
    : t('tokenizedAssets.freshness.minutesAgo', '{{minutes}}m ago', { minutes: Math.floor(freshness / 60) })

  if (mobile) {
    return (
      <>
        <span className={`mta-live-dot ${freshnessClass}`} aria-hidden="true" />
        <span className="mta-freshness">{freshness != null ? label : t('tokenizedAssets.mobile.live', 'Live')}</span>
      </>
    )
  }
  return (
    <button
      type="button"
      className={`ta-freshness-pill rwa-freshness-pill ${freshnessClass}`}
      onClick={onRefresh}
      disabled={disabled}
      title={t('tokenizedAssets.freshness.refreshHint', 'Click to refresh all data')}
      aria-label={t('tokenizedAssets.freshness.refreshHint', 'Click to refresh all data')}
    >
      <span className={`ta-live-dot rwa-live-dot ${freshnessClass}`} />
      <span className="ta-freshness rwa-freshness">{freshness != null ? label : t('tokenizedAssets.freshness.loading', 'Loading…')}</span>
    </button>
  )
})

export default function TokenizedAssetsPage({ dayMode, isMobile = false }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const [activeTab, setActiveTab] = useState('overview')
  const activeParent = PARENT_OF[activeTab] || activeTab
  const activeSubs = TABS.find(tb => tb.id === activeParent)?.subs || null
  const [assetSlug, setAssetSlug] = useState(null)
  const [voicesOpen, setVoicesOpen] = useState(false)
  const [voicesMounted, setVoicesMounted] = useState(false)
  const [legacyModalSlug, setLegacyModalSlug] = useState(null)
  const {
    overview, protocols, stablecoins, tvlHistory, stablecoinHistory,
    chains, movers, breakdown, breakdownHistory,
    // Phase 6: Spectre RWA Index
    srwaIndex,
    // Phase 7: flagship signals
    navWatch, concentrationLeaderboard, velocity, events,
    // Phase 8: composability graph + yield curve
    composabilityGraph, yieldCurve,
    // Per-group freshness stamps. The pill below shows the OLDEST of the
    // four so a fresh overview can't mask a stale chart - what you see
    // is the worst case across the page.
    mainUpdatedAt, historyUpdatedAt, phase7UpdatedAt, phase8UpdatedAt,
    loading, historyLoaded, error, refetch, refetchAll,
  } = useRwaData({
    // Phase 7 (nav-watch / concentration / velocity / events) and Phase 8
    // (composability / yield-curve) are only consumed by RwaRiskAlphaTab.
    // Gating them on activeTab keeps the default Overview landing from
    // firing 6 cold serverless calls + a 90 s polling timer the user
    // can't see. State persists across tab switches.
    riskAlphaActive: activeTab === 'risk-alpha',
    // /api/rwa/chains is only consumed by RwaNetworksTab. Overview's
    // chain donut is computed locally from protocols[].chains.
    networksActive: activeTab === 'networks',
  })

  // Freshness indicator — seconds since the OLDEST data group was last
  // successfully fetched. Showing the freshest stamp would lie when one
  // chart is 30 min old and another is 5 s old.
  // Freshness pill (seconds since oldest actively-polled group) now lives in its
  // own <RwaFreshnessPill/> so its 1s ticker doesn't re-render the whole page.

  // New shared drawer opener (Overview uses this)
  // ── RWA Voices drawer ──────────────────────────────────────────────────
  // Mount on first open and unmount after the slide-out, so a session that
  // never opens it pays nothing and a closed panel leaves no DOM behind. The
  // fetched tape survives in the panel module's cache, so reopening is instant.
  const voicesExitRef = useRef(null)
  const openVoices = useCallback(() => {
    clearTimeout(voicesExitRef.current)
    setVoicesMounted(true)
    setVoicesOpen(true)
  }, [])
  const closeVoices = useCallback(() => {
    setVoicesOpen(false)
    clearTimeout(voicesExitRef.current)
    voicesExitRef.current = setTimeout(() => setVoicesMounted(false), 420)
  }, [])
  useEffect(() => () => clearTimeout(voicesExitRef.current), [])

  const voicesDock = (
    <>
      <button
        type="button"
        className="rvp-handle"
        aria-expanded={voicesOpen}
        onClick={openVoices}
        title={t('tokenizedAssets.voices.open', 'What big accounts are saying about RWAs')}
      >
        <span className="rvp-handle-dot" aria-hidden="true" />
        {t('tokenizedAssets.voices.handle', 'RWA Voices')}
      </button>
      {voicesMounted && (
        <Suspense fallback={null}>
          <RwaVoicesPanel open={voicesOpen} onClose={closeVoices} dayMode={dayMode} />
        </Suspense>
      )}
    </>
  )

  const openAsset = useCallback((slug) => setAssetSlug(slug), [])
  const closeAsset = useCallback(() => setAssetSlug(null), [])

  // Old tabs still open the legacy modal (until they migrate to AssetDetailPanel)
  const openLegacy = useCallback((slug) => setLegacyModalSlug(slug), [])
  const closeLegacy = useCallback(() => setLegacyModalSlug(null), [])

  const renderTab = useCallback(() => {
    const shared = { protocols, tvlHistory, loading, dayMode, onProtocolClick: openLegacy }
    switch (activeTab) {
      case 'overview':
        return (
          <RwaOverviewTab
            overview={overview}
            protocols={protocols}
            stablecoins={stablecoins}
            tvlHistory={tvlHistory}
            stablecoinHistory={stablecoinHistory}
            movers={movers}
            breakdown={breakdown}
            breakdownHistory={breakdownHistory}
            srwaIndex={srwaIndex}
            loading={loading}
            historyLoaded={historyLoaded}
            dayMode={dayMode}
            onAssetOpen={openAsset}
          />
        )
      case 'review':
        return <RwaReviewTab dayMode={dayMode} />
      case 'treasuries':
        return (
          <RwaTreasuriesTab
            protocols={protocols}
            tvlHistory={tvlHistory}
            loading={loading}
            dayMode={dayMode}
            onAssetOpen={openAsset}
          />
        )
      case 'credit':
        return (
          <RwaCreditTab
            protocols={protocols}
            tvlHistory={tvlHistory}
            loading={loading}
            dayMode={dayMode}
            onAssetOpen={openAsset}
          />
        )
      case 'stablecoins':
        return (
          <RwaStablecoinsTab
            stablecoins={stablecoins}
            stablecoinHistory={stablecoinHistory}
            loading={loading}
            dayMode={dayMode}
            onAssetOpen={openAsset}
          />
        )
      case 'commodities':
        return (
          <RwaCommoditiesTab
            protocols={protocols}
            tvlHistory={tvlHistory}
            breakdownHistory={breakdownHistory}
            loading={loading}
            dayMode={dayMode}
            onAssetOpen={openAsset}
          />
        )
      case 'networks':
        return (
          <RwaNetworksTab
            overview={overview}
            protocols={protocols}
            chains={chains}
            loading={loading}
            dayMode={dayMode}
            onAssetOpen={openAsset}
          />
        )
      case 'platforms':
        return (
          <RwaPlatformsTab
            overview={overview}
            protocols={protocols}
            tvlHistory={tvlHistory}
            loading={loading}
            dayMode={dayMode}
            onAssetOpen={openAsset}
          />
        )
      case 'screener':
        return (
          <RwaScreenerTab
            protocols={protocols}
            stablecoins={stablecoins}
            loading={loading}
            dayMode={dayMode}
            onAssetOpen={openAsset}
          />
        )
      case 'risk-alpha':
        return (
          <RwaRiskAlphaTab
            navWatch={navWatch}
            concentrationLeaderboard={concentrationLeaderboard}
            velocity={velocity}
            events={events}
            composabilityGraph={composabilityGraph}
            yieldCurve={yieldCurve}
            onAssetOpen={openAsset}
          />
        )
      default:
        return null
    }
  }, [activeTab, overview, protocols, stablecoins, tvlHistory, stablecoinHistory, chains, movers, breakdownHistory, loading, historyLoaded, dayMode, openAsset, openLegacy, navWatch, concentrationLeaderboard, velocity, events, composabilityGraph, yieldCurve])

  const renderTabs = () => TABS.map(tab => (
    <button
      key={tab.id}
      type="button"
      className={`ta-tab-btn${activeParent === tab.id ? ' active' : ''}`}
      onClick={() => setActiveTab(tab.subs ? tab.subs[0] : tab.id)}
    >
      {t(`tokenizedAssets.tabLabels.${tab.labelKey}`, tab.labelFallback)}
    </button>
  ))

  const renderSubTabs = () => activeSubs && (
    <div className="ta-subtab-bar" role="tablist" aria-label={t('tokenizedAssets.tabLabels.sections', 'Sections')}>
      {activeSubs.map(id => {
        const [k, fb] = SECTION_LABELS[id]
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={`ta-subtab${activeTab === id ? ' on' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            {t(`tokenizedAssets.tabLabels.${k}`, fb)}
          </button>
        )
      })}
    </div>
  )

  // ═══════════════════════════════════════════
  //   MOBILE RENDER — cinematic single-column
  //   Prefix: mta-  (see .claude/rules/mobile-design-system.md)
  // ═══════════════════════════════════════════
  if (isMobile) {
    const fmtUsd = (v) => {
      if (v == null || !isFinite(v)) return '--'
      return fmtLargeShort(v)
    }
    const fmtSignedUsd = (v) => {
      if (v == null || !isFinite(v)) return '--'
      // Sign first, then the currency - fmtLargeShort renders a negative as
      // "$-510.24M", which clashes with this helper's own "+$1.69B".
      return `${v < 0 ? '-' : '+'}${fmtLargeShort(Math.abs(v))}`
    }
    const fmtPct = (v) => {
      if (v == null || !isFinite(v)) return '--'
      return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
    }
    const fmtCount = (v) => {
      if (v == null || !isFinite(v)) return '--'
      const a = Math.abs(v)
      if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
      if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`
      if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`
      return Math.round(v).toLocaleString('en-US')
    }
    const magnitudeClass = (v) => {
      if (v == null) return ''
      const a = Math.abs(v)
      if (a >= 10) return ' mta-mag-3'
      if (a >= 5)  return ' mta-mag-2'
      if (a >= 2)  return ' mta-mag-1'
      return ' mta-mag-0'
    }

    // Compute 30D/7D from tvlHistory totals (same logic as global-hero)
    const totals = (() => {
      const s = tvlHistory?.series || []
      const cats = tvlHistory?.categories || []
      if (!s.length || !cats.length) return []
      return s.map(pt => cats.reduce((acc, c) => acc + (pt[c] || 0), 0))
    })()
    const headTotal = overview?.totalTvl != null
      ? overview.totalTvl
      : (totals.length ? totals[totals.length - 1] : null)
    const change30d = (() => {
      if (totals.length < 2) return null
      const last = totals[totals.length - 1]
      const prev = totals[Math.max(0, totals.length - 31)]
      return prev ? ((last - prev) / prev) * 100 : null
    })()
    const change7d = (() => {
      if (totals.length < 2) return null
      const last = totals[totals.length - 1]
      const prev = totals[Math.max(0, totals.length - 8)]
      return prev ? ((last - prev) / prev) * 100 : null
    })()
    const netFlow7d = (() => {
      if (totals.length < 8) return null
      let sum = 0
      for (let i = totals.length - 7; i < totals.length; i++) {
        sum += totals[i] - totals[i - 1]
      }
      return sum
    })()

    // Top issuers — derive light list (avoid loading full RwaTopIssuers card)
    const topIssuers = (protocols || [])
      .slice()
      .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
      .slice(0, 10)
      .map(p => ({
        slug: p.slug || (p.name || '').toLowerCase().replace(/\s+/g, '-'),
        name: p.name,
        logo: p.logo || `https://icons.llama.fi/protocols/${p.slug || ''}`,
        tvl: p.tvl || 0,
        change: p.change_30d ?? p.change_7d ?? null,
      }))

    // Movers — top 4 inflows / top 3 outflows
    const buildMovers = (list, sign, limit) => (list || [])
      .map(p => {
        const change = p.change_7d ?? p.change_1d ?? 0
        const tvl = p.tvl || 0
        return { slug: p.slug, name: p.name, logo: p.logo, tvl, change, flow: tvl * (change / 100) }
      })
      .filter(r => r.tvl >= 2e6 && (sign > 0 ? r.change > 0 : r.change < 0))
      .sort((a, b) => Math.abs(b.flow) - Math.abs(a.flow))
      .slice(0, limit)
    const inflows = buildMovers(movers?.gainers, +1, 4)
    const outflows = buildMovers(movers?.losers, -1, 3)

    const renderMobileTab = () => {
      switch (activeTab) {
        case 'overview':
          return (
            <>
              {/* KPI grid — 2x2 */}
              <div className="mta-section">
                <div className="mta-kpi-grid">
                  <div className="mta-kpi">
                    <span className="mta-kpi-label">{t('tokenizedAssets.mobile.totalRwa', 'Total RWA')}</span>
                    <span className="mta-kpi-value">{fmtUsd(headTotal)}</span>
                    {change30d != null && (
                      <span className={`mta-kpi-delta${change30d >= 0 ? ' pos' : ' neg'}${magnitudeClass(change30d)}`}>
                        {fmtPct(change30d)} <span className="mta-kpi-delta-tf">30D</span>
                      </span>
                    )}
                  </div>
                  <div className="mta-kpi">
                    <span className="mta-kpi-label">{t('tokenizedAssets.mobile.netFlow7d', '7D Net Flow')}</span>
                    <span className={`mta-kpi-value${netFlow7d != null && netFlow7d >= 0 ? ' pos' : netFlow7d != null ? ' neg' : ''}`}>
                      {fmtSignedUsd(netFlow7d)}
                    </span>
                    {change7d != null && (
                      <span className={`mta-kpi-delta${change7d >= 0 ? ' pos' : ' neg'}${magnitudeClass(change7d)}`}>
                        {fmtPct(change7d)} <span className="mta-kpi-delta-tf">7D</span>
                      </span>
                    )}
                  </div>
                  <div className="mta-kpi">
                    <span className="mta-kpi-label">{t('tokenizedAssets.kpi.issuers', 'Issuers')}</span>
                    <span className="mta-kpi-value">{overview?.totalProtocols ?? '--'}</span>
                    <span className="mta-kpi-sub">{overview?.totalChains ?? '--'} {t('tokenizedAssets.mobile.networks', 'networks')}</span>
                  </div>
                  <div className="mta-kpi">
                    <span className="mta-kpi-label">{t('tokenizedAssets.kpi.holders', 'Holders')}</span>
                    <span className="mta-kpi-value">{fmtCount(breakdown?.total_holders)}</span>
                    <span className="mta-kpi-sub">{fmtUsd(breakdown?.represented_value_usd)} {t('tokenizedAssets.mobile.represented', 'represented')}</span>
                  </div>
                </div>
              </div>

              {/* SRWAI flagship index */}
              {srwaIndex && Number.isFinite(srwaIndex.index_value) && (
                <div className="mta-section">
                  <span className="mta-label">{t('tokenizedAssets.globalHero.srwai', 'Spectre RWA Index')}</span>
                  <div className="mta-srwai-card">
                    <div className="mta-srwai-head">
                      <span className="mta-srwai-value">{Number(srwaIndex.index_value).toFixed(2)}</span>
                      {srwaIndex.change_30d_pct != null && (
                        <span className={`mta-srwai-delta${srwaIndex.change_30d_pct >= 0 ? ' pos' : ' neg'}`}>
                          {fmtPct(srwaIndex.change_30d_pct)} 30D
                        </span>
                      )}
                    </div>
                    <span className="mta-srwai-sub">{t('tokenizedAssets.mobile.srwaiSub', 'Top 50 issuers · capped 15% per name · weekly rebalance')}</span>
                  </div>
                </div>
              )}

              {/* Asset class allocation — reuse existing component */}
              <div className="mta-section">
                <span className="mta-label">{t('tokenizedAssets.classAllocation.title', 'Asset Class Allocation')}</span>
                <div className="mta-card-shell">
                  <RwaClassAllocation
                    tvlHistory={tvlHistory}
                    overview={overview}
                    breakdown={breakdown}
                    loading={loading}
                  />
                </div>
              </div>

              {/* Active mcap chart — reuse */}
              <div className="mta-section">
                <span className="mta-label">{t('tokenizedAssets.mobile.activeMcap', 'Active Market Cap')}</span>
                <div className="mta-card-shell mta-card-shell--chart">
                  <Suspense fallback={<div className="mta-skel-block animate-shimmer" />}>
                    <RwaActiveMcapChart
                      tvlHistory={tvlHistory}
                      breakdownHistory={breakdownHistory}
                      loading={loading}
                      protocols={protocols}
                      onIssuerClick={openAsset}
                    />
                  </Suspense>
                </div>
              </div>

              {/* Top Issuers — token-row pattern */}
              <div className="mta-section-flush">
                <div className="mta-section-header">
                  <span className="mta-label">{t('tokenizedAssets.sections.topIssuers', 'Top Issuers')}</span>
                  <button
                    type="button"
                    className="mta-section-action"
                    onClick={() => setActiveTab('screener')}
                  >
                    {t('tokenizedAssets.mobile.all', 'All')} →
                  </button>
                </div>
                <ul className="mta-row-list" role="list">
                  {topIssuers.map((p, i) => (
                    <li key={p.slug || i}>
                      <button
                        type="button"
                        className="mta-row"
                        onClick={() => openAsset(p.slug)}
                      >
                        <span className="mta-row-rank">{i + 1}</span>
                        <img
                          className="mta-row-logo"
                          src={p.logo}
                          alt=""
                          loading="lazy"
                          onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                        />
                        <span className="mta-row-name">{p.name}</span>
                        <span className="mta-row-meta">
                          <span className="mta-row-value">{fmtUsd(p.tvl)}</span>
                          {p.change != null && (
                            <span className={`mta-row-change${p.change >= 0 ? ' pos' : ' neg'}${magnitudeClass(p.change)}`}>
                              {fmtPct(p.change)}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                  {!topIssuers.length && loading && Array.from({ length: 6 }).map((_, i) => (
                    <li key={`s-${i}`} className="mta-row mta-row--skel">
                      <span className="mta-row-rank">{i + 1}</span>
                      <span className="mta-skel mta-skel--logo" />
                      <span className="mta-skel mta-skel--text" />
                      <span className="mta-skel mta-skel--num" />
                    </li>
                  ))}
                </ul>
              </div>

              {/* 7D Flow Board — inflows / outflows */}
              {(inflows.length > 0 || outflows.length > 0) && (
                <div className="mta-section">
                  <span className="mta-label">{t('tokenizedAssets.flowBoard.title', '7D Flow Board')}</span>
                  <div className="mta-flow-grid">
                    {inflows.length > 0 && (
                      <div className="mta-flow-col">
                        <span className="mta-flow-col-label pos">{t('tokenizedAssets.netFlows.inflows', 'Inflows')}</span>
                        {inflows.map(r => (
                          <button
                            type="button"
                            key={`in-${r.slug}`}
                            className="mta-flow-row"
                            onClick={() => openAsset(r.slug)}
                          >
                            <img src={r.logo} alt="" className="mta-flow-logo" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                            <span className="mta-flow-name">{r.name}</span>
                            <span className="mta-flow-val pos">{fmtSignedUsd(r.flow)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {outflows.length > 0 && (
                      <div className="mta-flow-col">
                        <span className="mta-flow-col-label neg">{t('tokenizedAssets.netFlows.outflows', 'Outflows')}</span>
                        {outflows.map(r => (
                          <button
                            type="button"
                            key={`out-${r.slug}`}
                            className="mta-flow-row"
                            onClick={() => openAsset(r.slug)}
                          >
                            <img src={r.logo} alt="" className="mta-flow-logo" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                            <span className="mta-flow-name">{r.name}</span>
                            <span className="mta-flow-val neg">{fmtSignedUsd(r.flow)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Spectre Brain (merged brain + thesis card) */}
              <div className="mta-section">
                <span className="mta-label">{t('tokenizedAssets.mobile.spectreThesis', 'Spectre Thesis')}</span>
                <div className="mta-card-shell">
                  <RwaBrainCard tvlHistory={tvlHistory} overview={overview} loading={loading} />
                </div>
              </div>

              {/* Tweets */}
              <div className="mta-section">
                <span className="mta-label">{t('tokenizedAssets.pulse.title', 'RWA Pulse')}</span>
                <div className="mta-card-shell">
                  <Suspense fallback={<div className="mta-skel-block animate-shimmer" />}>
                    <RwaTweets />
                  </Suspense>
                </div>
              </div>
            </>
          )
        default:
          // Other tabs reuse desktop components; CSS forces single-column.
          return (
            <div className="mta-tab-host">
              <Suspense fallback={
                <div className="mta-skel-block animate-shimmer" />
              }>
                {renderTab()}
              </Suspense>
            </div>
          )
      }
    }

    return (
      <div className={`tokenized-assets-page mta-page${dayMode ? ' day-mode' : ''}`}>
        <div className="mta-content">
          <div className="mta-header-spacer" aria-hidden="true" />

          {/* Hero */}
          <div className="mta-section mta-hero">
            <span className="mta-eyebrow">{t('tokenizedAssets.mobile.eyebrow', 'Real World Assets')}</span>
            <h1 className="mta-title">{t('tokenizedAssets.pageTitle', 'Tokenized RWAs')}</h1>
            <div className="mta-meta">
              <RwaFreshnessPill
                mobile
                t={t}
                mainUpdatedAt={mainUpdatedAt}
                historyUpdatedAt={historyUpdatedAt}
                phase7UpdatedAt={phase7UpdatedAt}
                phase8UpdatedAt={phase8UpdatedAt}
              />
              <span className="mta-meta-sep">·</span>
              <span className="mta-meta-sub">{overview?.totalProtocols ?? '--'} {t('tokenizedAssets.mobile.issuersWord', 'issuers')} · {overview?.totalChains ?? '--'} {t('tokenizedAssets.mobile.networks', 'networks')}</span>
            </div>
          </div>

          {/* Tab strip — horizontal scroll ghost pills */}
          <div className="mta-section-flush">
            <div className="mta-tabs" role="tablist" aria-label={t('tokenizedAssets.mobile.tabsAria', 'Tokenized assets sections')}>
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeParent === tab.id}
                  className={`mta-tab${activeParent === tab.id ? ' mta-tab--active' : ''}`}
                  onClick={() => setActiveTab(tab.subs ? tab.subs[0] : tab.id)}
                >
                  {t(`tokenizedAssets.tabLabels.${tab.labelKey}`, tab.labelFallback)}
                </button>
              ))}
            </div>
            {activeSubs && (
              <div className="mta-subtabs" role="tablist">
                {activeSubs.map(id => {
                  const [k, fb] = SECTION_LABELS[id]
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === id}
                      className={`mta-subtab${activeTab === id ? ' mta-subtab--active' : ''}`}
                      onClick={() => setActiveTab(id)}
                    >
                      {t(`tokenizedAssets.tabLabels.${k}`, fb)}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {error && (
            <div className="mta-section">
              <div className="mta-error">
                <span>{t('tokenizedAssets.errors.loadFailed', 'Failed to load RWA data')}</span>
                <button type="button" className="mta-retry" onClick={refetch}>{t('tokenizedAssets.mobile.retry', 'Retry')}</button>
              </div>
            </div>
          )}

          {renderMobileTab()}

          <div className="mta-bottom-spacer" aria-hidden="true" />
        </div>

        <AssetDetailPanel
          open={Boolean(assetSlug)}
          onClose={closeAsset}
          slug={assetSlug}
        />
        {legacyModalSlug && (
          <Suspense fallback={null}>
            <RwaProtocolModal slug={legacyModalSlug} onClose={closeLegacy} />
          </Suspense>
        )}
        {voicesDock}
      </div>
    )
  }

  return (
    <div className="tokenized-assets-page">
      {/* Compact header row: title + freshness pill (click to refetch) + tab bar */}
      <div className="ta-header-row rwa-header-row">
        <div className="ta-header-left rwa-header-left">
          <h1 className="ta-page-title rwa-page-title">{t('tokenizedAssets.pageTitle', 'Tokenized Real World Assets')}</h1>
          {/* Pill is now a button. Click forces a full refetch across every
              data group on the page (main + history + phase7 + phase8) so
              the user always has a manual escape hatch when polling isn't
              keeping up. Title attribute spells out the action for hover.
              Disabled while a refetch is already in flight. */}
          <RwaFreshnessPill
            t={t}
            mainUpdatedAt={mainUpdatedAt}
            historyUpdatedAt={historyUpdatedAt}
            phase7UpdatedAt={phase7UpdatedAt}
            phase8UpdatedAt={phase8UpdatedAt}
            onRefresh={() => { if (typeof refetchAll === 'function') refetchAll() }}
            disabled={loading}
          />
        </div>
        <div className="ta-tab-bar rwa-tab-bar">
          {renderTabs()}
        </div>
      </div>

      {error && (
        <div className="ta-error-banner rwa-error-banner">
          <span>{t('tokenizedAssets.errors.loadFailed', 'Failed to load RWA data')}</span>
          <span className="ta-error-detail rwa-error-detail">{error}</span>
        </div>
      )}

      {renderSubTabs()}

      <div className="ta-tab-panel rwa-tab-panel">
        <Suspense fallback={null}>
          {renderTab()}
        </Suspense>
      </div>

      {/* New shared drawer (used by Overview; future tabs too) */}
      <AssetDetailPanel
        open={Boolean(assetSlug)}
        onClose={closeAsset}
        slug={assetSlug}
      />

      {/* Legacy modal — other tabs still use this until they migrate */}
      {legacyModalSlug && (
        <Suspense fallback={null}>
          <RwaProtocolModal slug={legacyModalSlug} onClose={closeLegacy} />
        </Suspense>
      )}
      {voicesDock}
    </div>
  )
}
