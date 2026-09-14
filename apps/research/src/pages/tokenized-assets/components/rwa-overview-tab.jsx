import React, { useMemo, useCallback, useState, useRef, useEffect, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useTranslation } from 'react-i18next'
import RwaGlobalHero from './rwa-global-hero'
import RwaClassAllocation from './rwa-class-allocation'
import RwaNetFlows from './rwa-net-flows'
import RwaBrainCard from './rwa-brain-card'
import RwaHorizontalBars from './rwa-horizontal-bars'
import RwaFlowBoard from './rwa-flow-board'
// Below-the-fold, heavy: split off the initial route chunk + (for the pulse
// card) defer its /api/rwa/news-rss fetch off the boot burst until scrolled to.
const RwaPulseCard = lazy(() => import('./rwa-pulse-card'))
const RwaTweets = lazy(() => import('./rwa-tweets'))
import { MarketShareTable } from './shared'
import TaSelect from './shared/ta-select'
import { TA_CATEGORICAL } from './shared/ta-tokens'
import { classifyProtocol } from './rwa-shared'
import './overview.css'

/* Single-hue ramp for the ranked Chain Breakdown — teal, darkening with rank,
   echoing the hero's headline sheen. See the chainBars memo for why a ranked
   single-metric list must not use the categorical palette. */
const CHAIN_RAMP = ['#5EEAD4', '#4FDCC6', '#41CDB8', '#34BCA9', '#28A899', '#1E9187', '#177A74']
const CHAIN_RAMP_DAY = ['#0D9488', '#10A093', '#14AC9D', '#1AB8A8', '#2AC0B1', '#3BC8BA', '#4FD0C3']

/* Mount children only when scrolled near (rootMargin 400px = a touch before
   they enter view), so below-fold canvas charts + their fetches stay off the
   first-paint critical path. Mirrors the local useInView pattern used on
   ai-charts / roi-calculator. */
function useInView(rootMargin = '400px') {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || inView) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true) }, { rootMargin })
    obs.observe(el)
    return () => obs.disconnect()
  }, [inView, rootMargin])
  return [ref, inView]
}

const DeferSkel = () => <div className="rwa-defer-skel animate-shimmer" style={{ minHeight: 260, borderRadius: 16 }} />

/**
 * RWA Overview — Command Ops Dashboard
 *
 * Layout:
 *   ROW 1 (Hero strip)        : 22fr / 38fr / 22fr / 18fr
 *     Asset Class Allocation · Global Hero · Net Flows (7D) · Spectre Brain
 *   ROW 2 (Intel strip)       : 28fr / 26fr / 24fr / 22fr
 *     RWA Pulse · Top Issuers · Chain Breakdown · 7D Flow Board
 *   ROW 3 (Screener)          : full-width MarketShareTable
 */
export default function RwaOverviewTab({
  overview,
  protocols,
  stablecoins,
  tvlHistory,
  stablecoinHistory,
  movers,
  // Phase 2 - issuer-direct breakdown + 12-category history. Optional.
  breakdown,
  breakdownHistory,
  // Phase 6 - Spectre RWA Index (SRWAI). Optional, renders as additive hero stat.
  srwaIndex,
  loading,
  historyLoaded = true,
  dayMode,
  onAssetOpen,
}) {
  const { t } = useTranslation()
  // Core tier paints fast and flips `loading` off; the history tier (tvlHistory
  // / breakdownHistory) lands a few seconds later. Cards that depend on history
  // must keep their skeleton during that gap instead of flashing empty/error.
  const historyLoading = loading || !historyLoaded

  // Below-fold defer gates (Active-Mcap trend chart + the social/news row).
  const [socialRef, socialInView] = useInView()

  /* ── Screener filters ── */
  const [filterClass, setFilterClass] = useState('all')
  const [filterNetwork, setFilterNetwork] = useState('all')
  const [filterYield, setFilterYield] = useState('all')
  const [filterRisk, setFilterRisk] = useState('all')

  /* ── Screener rows ── */
  const allRows = useMemo(() => {
    if (!protocols?.length) return []
    return [...protocols]
      .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
      .map((p, i) => {
        const slug = p.slug || (p.name || '').toLowerCase().replace(/\s+/g, '-')
        // Derive a 30-pt sparkline from protocolSeries when possible.
        const series = tvlHistory?.protocolSeries?.[slug]?.data
        let trend = null
        if (Array.isArray(series) && series.length > 1) {
          const step = Math.max(1, Math.floor(series.length / 30))
          const samp = []
          for (let k = 0; k < series.length; k += step) samp.push(series[k].tvl || 0)
          if (samp[samp.length - 1] !== series[series.length - 1].tvl) {
            samp.push(series[series.length - 1].tvl || 0)
          }
          trend = samp
        }
        // Risk score heuristic — concentration on a single chain + volatility.
        // Labelled as estimate; replace with backend signal when available.
        const numChains = Array.isArray(p.chains) ? p.chains.length : 1
        const v7 = Math.abs(p.change_7d ?? 0)
        let risk = 'Medium'
        if (v7 > 15 || numChains <= 1) risk = 'High'
        if (v7 < 3 && numChains >= 4) risk = 'Low'
        return {
          rank: i + 1,
          name: p.name,
          slug,
          logo: p.logo || `https://icons.llama.fi/protocols/${slug}`,
          category: classifyProtocol(p),
          issuer: p.parent_protocol || p.name,
          network: (p.chains && p.chains[0]) || 'Unknown',
          tvl: p.tvl || 0,
          change_7d: p.change_7d ?? null,
          change_30d: p.change_30d ?? null,
          yield: null, // TODO: wire to /v1/dossier/<asset> when yield surface is exposed
          risk,
          trend,
        }
      })
  }, [protocols, tvlHistory])

  /* ── Build option lists from data ── */
  const classOptions = useMemo(() => {
    const set = new Set(allRows.map(r => r.category).filter(Boolean))
    return ['all', ...Array.from(set).sort()]
  }, [allRows])

  const networkOptions = useMemo(() => {
    const counts = new Map()
    for (const r of allRows) {
      if (!r.network || r.network === 'Unknown') continue
      counts.set(r.network, (counts.get(r.network) || 0) + (r.tvl || 0))
    }
    const top = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k]) => k)
    return ['all', ...top]
  }, [allRows])

  const screenerRows = useMemo(() => {
    return allRows.filter(r => {
      if (filterClass !== 'all' && r.category !== filterClass) return false
      if (filterNetwork !== 'all' && r.network !== filterNetwork) return false
      if (filterYield === 'has' && r.yield == null) return false
      if (filterYield === 'none' && r.yield != null) return false
      if (filterRisk !== 'all' && r.risk !== filterRisk) return false
      return true
    }).map((r, i) => ({ ...r, rank: i + 1 }))
  }, [allRows, filterClass, filterNetwork, filterYield, filterRisk])

  const filtersActive =
    filterClass !== 'all' || filterNetwork !== 'all' ||
    filterYield !== 'all' || filterRisk !== 'all'
  const resetFilters = useCallback(() => {
    setFilterClass('all')
    setFilterNetwork('all')
    setFilterYield('all')
    setFilterRisk('all')
  }, [])

  const SCREENER_COLUMNS = useMemo(() => [
    {
      key: 'rank',
      label: t('tokenizedAssets.table.rank', '#'),
      width: '44px',
      align: 'left',
      sortable: false,
      render: (v) => <span className="mono ta-table-rank">{v}</span>,
    },
    {
      key: 'name',
      label: t('tokenizedAssets.table.asset', 'Asset'),
      sortable: false,
      render: (_v, row) => (
        <div className="ta-table-logo-cell">
          <img
            className="ta-table-logo"
            src={row.logo}
            alt=""
            loading="lazy"
            onError={e => {
              e.target.style.display = 'none'
              const fb = e.target.nextSibling
              if (fb) fb.style.display = 'inline-flex'
            }}
          />
          <span
            className="ta-table-logo-fb"
            style={{ display: 'none', background: TA_CATEGORICAL[row.rank % TA_CATEGORICAL.length] }}
          >
            {(row.name || '?')[0]}
          </span>
          <div className="ta-table-name">
            <span className="ta-table-name-primary">{row.name}</span>
          </div>
        </div>
      ),
    },
    { key: 'category', label: t('tokenizedAssets.table.class', 'Class'), sortable: false, render: (v) => <span className="ta-table-cat">{v}</span> },
    { key: 'issuer', label: t('tokenizedAssets.table.issuer', 'Issuer'), sortable: false, render: (v) => <span className="ta-table-cat">{v}</span> },
    { key: 'network', label: t('tokenizedAssets.slicer.network', 'Network'), sortable: false, render: (v) => <span className="ta-table-cat">{v}</span> },
    { key: 'tvl', label: t('tokenizedAssets.table.tvl', 'TVL'), align: 'right', format: 'currency' },
    { key: 'change_7d', label: t('tokenizedAssets.table.change7d', '7D'), align: 'right', format: 'delta', deltaLabel: '7D' },
    { key: 'change_30d', label: t('tokenizedAssets.table.change30d', '30D'), align: 'right', format: 'delta', deltaLabel: '30D' },
    {
      key: 'yield',
      label: t('tokenizedAssets.slicer.yield', 'Yield'),
      align: 'right',
      sortable: false,
      render: (v) => v == null ? <span className="ta-table-muted">--</span> : <span className="mono">{v.toFixed(2)}%</span>,
    },
    {
      key: 'risk',
      label: t('common.risk', 'Risk'),
      sortable: false,
      render: (v) => {
        const cls = v === 'Low' ? 'rsc--low' : v === 'High' ? 'rsc--high' : 'rsc--med'
        return <span className={`rsc-pill ${cls}`}>{v}</span>
      },
    },
    {
      key: 'trend',
      label: t('tokenizedAssets.table.trend30d', 'Trend (30D)'),
      align: 'right',
      sortable: false,
      format: 'spark',
      trendKey: 'change_30d',
    },
  ], [t])

  const handleRowClick = useCallback((row) => {
    onAssetOpen?.(row.slug || (row.name || '').toLowerCase().replace(/\s+/g, '-'))
  }, [onAssetOpen])

  /* Chain list — prefer overview.chainBreakdown, fall back to protocol-derived. */
  const chainList = useMemo(() => {
    if (overview?.chainBreakdown?.length) return overview.chainBreakdown
    if (!protocols?.length) return []
    const map = {}
    for (const p of protocols) {
      const chains = Array.isArray(p.chains) ? p.chains : (p.chain ? [p.chain] : [])
      if (!chains.length) continue
      // Spread TVL evenly across the protocol's chains so we don't double-count.
      const share = (p.tvl || 0) / chains.length
      for (const c of chains) {
        map[c] = (map[c] || 0) + share
      }
    }
    return Object.entries(map).map(([chain, tvl]) => ({ chain, tvl }))
  }, [overview, protocols])

  /* Chain breakdown rendered as ranked horizontal bars (better for
     comparison than a third donut, and breaks the pie-chart repetition
     across the composition row). Top 7 chains.

     2026-08-03 — palette: this is ONE metric (TVL) ranked, not a set of
     categories, so it gets a single-hue ramp that darkens with rank instead
     of the categorical rainbow. Seven unrelated hues implied seven different
     things being measured and fought the bull/bear greens elsewhere on the
     page. The categorical palette stays where it belongs — the allocation
     stack, which really is a composition of distinct classes. */
  const chainBars = useMemo(() => {
    const ramp = dayMode ? CHAIN_RAMP_DAY : CHAIN_RAMP
    return [...chainList]
      .filter(c => (c.tvl || 0) > 0)
      .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
      .slice(0, 7)
      .map((c, i) => ({
        label: c.chain || 'Unknown',
        value: c.tvl || 0,
        color: ramp[Math.min(i, ramp.length - 1)],
      }))
  }, [chainList, dayMode])

  return (
    <div className="ta-tab-content rwa-ov2">
      {/* ── SECTION 1 — MARKET HERO (full width: total + chart) ── */}
      <section className="rwa-ov2-hero">
        <RwaGlobalHero tvlHistory={tvlHistory} breakdownHistory={breakdownHistory} overview={overview} breakdown={breakdown} srwaIndex={srwaIndex} dayMode={dayMode} loading={historyLoading} />
      </section>

      {/* ── SECTION 2 — COMPOSITION (allocation · flows · chains) ── */}
      <section className="rwa-ov2-row rwa-ov2-row--composition">
        <RwaClassAllocation
          tvlHistory={tvlHistory}
          overview={overview}
          breakdown={breakdown}
          loading={loading}
          dayMode={dayMode}
        />
        <RwaNetFlows tvlHistory={tvlHistory} loading={historyLoading} />
        <section className="rcd rwa-ov2-bars-card" aria-label={t('tokenizedAssets.sections.chainBreakdown', 'Chain Breakdown')}>
          <RwaHorizontalBars
            title={t('tokenizedAssets.chainDonut.title', 'Chain Breakdown (TVL)')}
            subtitle={t('tokenizedAssets.chainDonut.subtitle', 'By tokenized value')}
            items={chainBars}
            maxItems={7}
          />
        </section>
      </section>

      {/* SECTION 3 (Active Mcap trend) was merged into the hero on 2026-08-03:
          the hero now carries timeframe pills + a By Class stacked mode, so the
          standalone chart only lives on in the mobile shell. */}

      {/* ── SECTION 4 — INTELLIGENCE: one full-width Spectre Brain card
           (2026-08-03: replaced the BrainSidebar + Editorial-primer pair,
           which rendered the same prose twice) ── */}
      <section className="rwa-ov2-row rwa-ov2-row--read">
        <RwaBrainCard tvlHistory={tvlHistory} overview={overview} loading={loading} />
      </section>

      {/* ── SECTION 5 — LEADERS (screener · top issuers) ── */}
      <section className="rwa-ov2-row rwa-ov2-row--leaders">
      <section className="rwa-cmd-screener">
        <header className="rwa-cmd-screener__head">
          <div className="rwa-cmd-screener__title-block">
            <h3 className="rwa-cmd-screener__title">{t('tokenizedAssets.sections.rwaScreener', 'RWA Screener')}</h3>
            <span className="rwa-cmd-screener__count mono">{t('tokenizedAssets.sections.resultsCount', '{{count}} results', { count: protocols?.length || 0 })}</span>
          </div>
          <div className="rwa-cmd-screener__chips">
            <TaSelect
              className={`rwa-cmd-select${filterClass !== 'all' ? ' is-active' : ''}`}
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
              ariaLabel={t('tokenizedAssets.filters.classLabel', 'Filter by class')}
              options={classOptions.map(c => ({
                value: c,
                label: c === 'all' ? t('tokenizedAssets.filters.allClasses', 'All Classes') : c,
              }))}
            />
            <TaSelect
              className={`rwa-cmd-select${filterNetwork !== 'all' ? ' is-active' : ''}`}
              value={filterNetwork}
              onChange={(e) => setFilterNetwork(e.target.value)}
              ariaLabel={t('tokenizedAssets.filters.networkLabel', 'Filter by network')}
              options={networkOptions.map(n => ({
                value: n,
                label: n === 'all' ? t('tokenizedAssets.filters.allNetworks', 'All Networks') : n,
              }))}
            />
            <TaSelect
              className={`rwa-cmd-select${filterYield !== 'all' ? ' is-active' : ''}`}
              value={filterYield}
              onChange={(e) => setFilterYield(e.target.value)}
              ariaLabel={t('tokenizedAssets.filters.yieldLabel', 'Filter by yield')}
              options={[
                { value: 'all', label: t('tokenizedAssets.filters.allYields', 'All Yields') },
                { value: 'has', label: 'With Yield' },
                { value: 'none', label: 'No Yield' },
              ]}
            />
            <TaSelect
              className={`rwa-cmd-select${filterRisk !== 'all' ? ' is-active' : ''}`}
              value={filterRisk}
              onChange={(e) => setFilterRisk(e.target.value)}
              ariaLabel={t('tokenizedAssets.filters.riskLabel', 'Filter by risk')}
              options={[
                { value: 'all', label: 'All Risk' },
                { value: 'Low', label: 'Low' },
                { value: 'Medium', label: 'Medium' },
                { value: 'High', label: 'High' },
              ]}
            />
            {filtersActive && (
              <button
                type="button"
                className="rwa-cmd-chip rwa-cmd-chip--reset"
                onClick={resetFilters}
                title={t('tokenizedAssets.filters.reset', 'Clear filters')}
              >
                Reset
              </button>
            )}
          </div>
        </header>
        <MarketShareTable
          columns={SCREENER_COLUMNS}
          rows={screenerRows}
          loading={loading}
          onRowClick={handleRowClick}
          virtualizeAfter={12}
          defaultSort={{ key: 'tvl', dir: 'desc' }}
        />
        <div className="rwa-cmd-screener__foot">
          <button type="button" className="rwa-cmd-screener__more">
            {t('tokenizedAssets.sections.viewFullScreener', 'View Full Screener')} <span aria-hidden>&rarr;</span>
          </button>
        </div>
      </section>
        {/* 2026-08-03: Top Issuers card removed — it repeated the screener's
            TVL-ranked list one column over. The rail now carries the 7D Flow
            Board (promoted from the bottom row). */}
        <RwaFlowBoard movers={movers} loading={loading} />
      </section>

      {/* ── SECTION 6 — INTEL & SOCIAL — bottom of page, IO-gated. Defers the
           pulse card's /news-rss fetch + tweets off the first-paint burst. ── */}
      <section className="rwa-ov2-row rwa-ov2-row--intel" ref={socialRef}>
        {socialInView ? (
          <Suspense fallback={<DeferSkel />}>
            <RwaPulseCard />
            <RwaTweets />
          </Suspense>
        ) : <DeferSkel />}
      </section>
    </div>
  )
}
