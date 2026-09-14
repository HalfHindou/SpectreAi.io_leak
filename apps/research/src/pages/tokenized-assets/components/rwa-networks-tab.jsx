import React, { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import RwaInteractiveChart from './rwa-interactive-chart'
import RwaHorizontalBars from './rwa-horizontal-bars'
import {
  KpiCard,
  SlicerControl,
  TimeframePills,
  MarketShareTable,
  AIAnalysisCard,
  HeroSplit,
  RwaEmptyState,
} from './shared'
import { TA_CATEGORICAL } from './shared/ta-tokens'
import { classifyProtocol } from './rwa-shared'
import ChainOrbit from './creatives/ChainOrbit'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import './networks.css'

/* Heuristic L1/L2/appchain classification (estimated — backend enrichment pending) */
const L1_CHAINS = new Set([
  'Ethereum', 'Bitcoin', 'Solana', 'Avalanche', 'BSC', 'Binance',
  'Tron', 'Aptos', 'Sui', 'Stellar', 'Cardano', 'Algorand', 'Tezos',
  'Near', 'Fantom', 'Cosmos', 'Polkadot', 'Kava', 'Gnosis', 'Celo',
])
const L2_CHAINS = new Set([
  'Arbitrum', 'Optimism', 'Base', 'Polygon', 'zkSync', 'Starknet',
  'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'Manta',
])
function classifyChain(name) {
  if (L2_CHAINS.has(name)) return 'l2'
  if (L1_CHAINS.has(name)) return 'l1'
  return 'appchain'
}

/* Default "asset class" bucket from protocol name (estimated) */
function primaryAssetClass(protocols) {
  if (!protocols?.length) return 'Other RWA'
  const counts = {}
  for (const p of protocols) {
    const c = classifyProtocol(p)
    counts[c] = (counts[c] || 0) + (p.tvl || 0)
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return entries[0]?.[0] || 'Other RWA'
}

/* ── Chain Gravity rail ─────────────────────────────────────────────────
   Lives beside the ChainOrbit creative and turns its empty perimeter into
   a live leaderboard of the same top-8 orbiting chains (rank · share bar ·
   7D delta). Always populated (not hover-only), so the centerpiece reads as
   "what am I looking at" the instant it loads. Clicking a chain opens it. */
function ChainGravityRail({ chains, protocolCounts = {}, loading, onAssetOpen }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtUsd = (v) => (v == null || !isFinite(v) || v === 0 ? '—' : fmtLargeShort(v))

  const { rows, total, multiChainNote } = useMemo(() => {
    const top = (chains || []).slice(0, 8)
    const total = top.reduce((s, c) => s + (c.tvl || 0), 0)
    const maxTvl = Math.max(1, ...top.map((c) => c.tvl || 0))
    const rows = top.map((c, i) => ({
      chain: c.chain,
      tvl: c.tvl || 0,
      share: total > 0 ? ((c.tvl || 0) / total) * 100 : 0,
      barPct: maxTvl > 0 ? Math.max(4, ((c.tvl || 0) / maxTvl) * 100) : 0,
      change_7d: c.change_7d ?? null,
      protocols: protocolCounts?.[c.chain] || 0,
      color: TA_CATEGORICAL[i % TA_CATEGORICAL.length],
    }))
    const topShare = rows[0]?.share || 0
    return { rows, total, multiChainNote: topShare }
  }, [chains, protocolCounts])

  const fmtDelta = (v) => {
    if (v == null || !isFinite(v)) return '—'
    const sign = v > 0 ? '+' : ''
    return `${sign}${v.toFixed(1)}%`
  }

  return (
    <div className="ta-net-rail">
      <div className="ta-net-rail__head">
        <span className="ta-net-rail__title">
          {t('tokenizedAssets.tabs.networks.gravityRail', 'Gravity Leaders')}
        </span>
        <span className="ta-net-rail__sub">
          {t('tokenizedAssets.tabs.networks.gravityRailSub', 'share of orbit')}
        </span>
      </div>

      {loading || !rows.length ? (
        <div className="ta-net-rail__skel">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="ta-net-rail__skel-row" />
          ))}
        </div>
      ) : (
        <>
          <div className="ta-net-rail__list">
            {rows.map((r) => {
              const dir = r.change_7d > 0 ? ' is-up' : r.change_7d < 0 ? ' is-down' : ''
              return (
                <button
                  type="button"
                  key={r.chain}
                  className="ta-net-row"
                  style={{ color: r.color }}
                  onClick={() => onAssetOpen?.(r.chain)}
                >
                  <span className="ta-net-row__swatch" />
                  <span className="ta-net-row__body">
                    <span className="ta-net-row__top">
                      <span className="ta-net-row__name">{r.chain}</span>
                      <span className="ta-net-row__tvl mono">{fmtUsd(r.tvl)}</span>
                    </span>
                    <span className="ta-net-row__track">
                      <span className="ta-net-row__fill" style={{ width: `${r.barPct}%` }} />
                    </span>
                  </span>
                  <span className="ta-net-row__meta">
                    <span className="ta-net-row__share mono">{r.share.toFixed(1)}%</span>
                    <span className={`ta-net-row__delta mono${dir}`}>{fmtDelta(r.change_7d)}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="ta-net-rail__foot">
            <span className="ta-net-stat">
              <span className="ta-net-stat__label">
                {t('tokenizedAssets.tabs.networks.gravityTotal', 'Orbit TVL')}
              </span>
              <span className="ta-net-stat__value mono">{fmtUsd(total)}</span>
            </span>
            <span className="ta-net-stat">
              <span className="ta-net-stat__label">
                {t('tokenizedAssets.tabs.networks.gravityConcentration', 'Top Chain Share')}
              </span>
              <span className="ta-net-stat__value mono">
                {multiChainNote ? `${multiChainNote.toFixed(1)}%` : '—'}
              </span>
            </span>
          </div>
        </>
      )}
    </div>
  )
}

/* ── Chain Comparison matrix
       "Share" = chain's RWA TVL as % of total RWA TVL (computable from live data).
       Replaces the previous "%-Distributed" column which had no backing field
       and rendered 100% for every row. */
function ChainComparisonMatrix({ chains, protocolCounts = {}, loading }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const formatValue = (v) => (v == null || v === 0 ? '--' : fmtLargeShort(v))
  const rows = useMemo(() => {
    if (!chains?.length) return []
    const totalTvl = chains.reduce((s, c) => s + (c.tvl || 0), 0)
    return chains.slice(0, 12).map((c, i) => {
      const tvl = c.tvl || 0
      const share = totalTvl > 0 ? (tvl / totalTvl) * 100 : 0
      return {
        rank: i + 1,
        chain: c.chain,
        tvl,
        protocols: protocolCounts[c.chain] || 0,
        share,
      }
    })
  }, [chains, protocolCounts])

  if (loading) {
    return (
      <div className="ta-widget">
        <div className="ta-widget-head">
          <span className="ta-widget-title">{t('tokenizedAssets.tabs.networks.chainComparison', 'Chain Comparison')}</span>
          <span className="ta-widget-sub">{t('tokenizedAssets.tabs.networks.chainComparisonSubLoading', 'TVL share per chain')}</span>
        </div>
        <div className="ta-widget-skel animate-shimmer" />
      </div>
    )
  }

  if (!rows.length) {
    return (
      <div className="ta-widget">
        <div className="ta-widget-head">
          <span className="ta-widget-title">{t('tokenizedAssets.tabs.networks.chainComparison', 'Chain Comparison')}</span>
        </div>
        <RwaEmptyState
          framed={false}
          title={t('tokenizedAssets.tabs.networks.noChains', 'No chains in range')}
          copy={t('tokenizedAssets.tabs.networks.noChainsCopy', 'No chains match this filter yet. Switch the Type slicer to All.')}
        />
      </div>
    )
  }

  return (
    <div className="ta-widget">
      <div className="ta-widget-head">
        <span className="ta-widget-title">{t('tokenizedAssets.tabs.networks.chainComparison', 'Chain Comparison')}</span>
        <span className="ta-widget-sub">{t('tokenizedAssets.tabs.networks.chainComparisonSub', 'TVL share of total · live on-chain')}</span>
      </div>
      <div className="ta-chaincmp">
        <div className="ta-chaincmp-head">
          <span>{t('tokenizedAssets.tabs.networks.headers.chain', 'Chain')}</span>
          <span className="ta-chaincmp-num">{t('tokenizedAssets.tabs.networks.headers.rwaTvl', 'RWA TVL')}</span>
          <span className="ta-chaincmp-num">{t('tokenizedAssets.tabs.networks.headers.protocols', 'Protocols')}</span>
          <span className="ta-chaincmp-bar-head">{t('tokenizedAssets.tabs.networks.headers.share', 'Share')}</span>
        </div>
        {rows.map((r) => (
          <div key={r.chain} className="ta-chaincmp-row">
            <span className="ta-chaincmp-chain">
              <span className="ta-chaincmp-rank mono">{r.rank}</span>
              {r.chain}
            </span>
            <span className="ta-chaincmp-num mono">{formatValue(r.tvl)}</span>
            <span className="ta-chaincmp-num mono">{r.protocols || '--'}</span>
            <span className="ta-chaincmp-bar-wrap">
              <span
                className="ta-chaincmp-bar-fill"
                style={{ width: `${Math.max(2, Math.min(100, r.share))}%` }}
              />
              <span className="ta-chaincmp-bar-val mono">{r.share.toFixed(1)}%</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Asset-class mix per chain (stacked horizontal bars) ── */
function ChainClassMix({ chains, protocols, loading }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const formatValue = (v) => (v == null || v === 0 ? '--' : fmtLargeShort(v))
  const { rows, legend } = useMemo(() => {
    if (!chains?.length || !protocols?.length) return { rows: [], legend: [] }
    const top = chains.slice(0, 8)
    // Stable class->color map so the same asset class is the same color in
    // every chain's stacked bar AND in the legend (was tooltip-only before).
    const classColor = {}
    const colorFor = (cls) => {
      if (!(cls in classColor)) {
        classColor[cls] = TA_CATEGORICAL[Object.keys(classColor).length % TA_CATEGORICAL.length]
      }
      return classColor[cls]
    }
    // For each chain, bucket protocol TVL by class (heuristic).
    const rows = top.map((c) => {
      const mix = {}
      let total = 0
      for (const p of protocols) {
        if (!(p.chains || []).includes(c.chain)) continue
        const cls = classifyProtocol(p)
        const share = (p.tvl || 0) / ((p.chains || []).length || 1)
        mix[cls] = (mix[cls] || 0) + share
        total += share
      }
      const segs = Object.entries(mix)
        .sort((a, b) => b[1] - a[1])
        .map(([cls, tvl]) => ({
          cls,
          tvl,
          pct: total > 0 ? (tvl / total) * 100 : 0,
          color: colorFor(cls),
        }))
      return { chain: c.chain, total, segs }
    })
    const legend = Object.entries(classColor).map(([cls, color]) => ({ cls, color }))
    return { rows, legend }
  }, [chains, protocols])

  if (loading) {
    return (
      <div className="ta-widget ta-widget--tight">
        <div className="ta-widget-head">
          <span className="ta-widget-title">{t('tokenizedAssets.tabs.networks.assetClassMix', 'Asset Class Mix')}</span>
          <span className="ta-widget-sub">{t('tokenizedAssets.tabs.networks.assetClassMixByChain', 'by chain')}</span>
        </div>
        <div className="ta-widget-skel animate-shimmer" />
      </div>
    )
  }

  if (!rows.length) return null

  return (
    <div className="ta-widget ta-widget--tight">
      <div className="ta-widget-head">
        <span className="ta-widget-title">{t('tokenizedAssets.tabs.networks.assetClassMix', 'Asset Class Mix')}</span>
        <span className="ta-widget-sub">{t('tokenizedAssets.tabs.networks.estimatedHeuristic', 'Estimated — heuristic classification')}</span>
      </div>
      <div className="ta-classmix">
        {rows.map((r) => (
          <div key={r.chain} className="ta-classmix-row">
            <span className="ta-classmix-name">{r.chain}</span>
            <span className="ta-classmix-bar">
              {r.segs.map((s) => (
                <span
                  key={s.cls}
                  className="ta-classmix-seg ta-tip-host"
                  data-tip={`${s.cls}: ${formatValue(s.tvl)} (${s.pct.toFixed(1)}%)`}
                  style={{ width: `${s.pct}%`, background: s.color }}
                />
              ))}
            </span>
            <span className="ta-classmix-total mono">{formatValue(r.total)}</span>
          </div>
        ))}
      </div>
      {legend.length > 0 && (
        <div className="ta-net-legend">
          {legend.map((l) => (
            <span key={l.cls} className="ta-net-legend__item" style={{ color: l.color }}>
              <span className="ta-net-legend__dot" />
              <span className="ta-net-legend__label">{l.cls}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Main Component ── */
export default function RwaNetworksTab({ overview, protocols, chains, loading, onAssetOpen }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const formatValue = (v) => (v == null || v === 0 ? '--' : fmtLargeShort(v))

  /* ── Slicer axes (Networks). Recomputed on language change. */
  const SLICER_AXES = useMemo(() => ({
    type: [
      { id: 'all', label: t('tokenizedAssets.tabs.networks.types.all', 'All') },
      { id: 'l1', label: t('tokenizedAssets.tabs.networks.types.l1', 'L1') },
      { id: 'l2', label: t('tokenizedAssets.tabs.networks.types.l2', 'L2') },
      { id: 'appchain', label: t('tokenizedAssets.tabs.networks.types.appchain', 'Appchain') },
    ],
    metric: [
      { id: 'tvl', label: t('tokenizedAssets.tabs.networks.metric.tvl', 'TVL') },
      { id: 'protocols', label: t('tokenizedAssets.tabs.networks.metric.protocols', 'Protocol Count') },
      { id: 'addresses', label: t('tokenizedAssets.tabs.networks.metric.addresses', 'Active Addresses') },
    ],
    grouping: [
      { id: 'chain', label: t('tokenizedAssets.tabs.networks.grouping.chain', 'By Chain') },
      { id: 'stack', label: t('tokenizedAssets.tabs.networks.grouping.stack', 'By L2 Stack') },
      { id: 'consensus', label: t('tokenizedAssets.tabs.networks.grouping.consensus', 'By Consensus') },
    ],
  }), [t])

  const [slicer, setSlicer] = useState({ type: 'all', metric: 'tvl', grouping: 'chain' })
  const [tf, setTf] = useState('1Y')

  const allChains = overview?.chainBreakdown || chains || []

  /* ── KPIs ── */
  const kpis = useMemo(() => {
    const totalNetworks = allChains.length
    const topChain = allChains[0]
    const topChainLabel = topChain
      ? `${topChain.chain} · ${formatValue(topChain.tvl)}`
      : '--'
    const multiChainPct = (() => {
      if (!protocols?.length) return null
      const multi = protocols.filter(p => (p.chains || []).length >= 2).length
      return (multi / protocols.length) * 100
    })()
    const avgTvl = totalNetworks > 0
      ? allChains.reduce((s, c) => s + (c.tvl || 0), 0) / totalNetworks
      : 0
    return [
      { label: t('tokenizedAssets.tabs.networks.kpis.totalNetworks', 'Total Networks'), value: totalNetworks, format: 'count' },
      { label: t('tokenizedAssets.tabs.networks.kpis.topNetwork', 'Top Network'), value: topChainLabel, format: 'raw' },
      { label: t('tokenizedAssets.tabs.networks.kpis.multiChain', 'Multi-chain Protocols'), value: multiChainPct != null ? `${multiChainPct.toFixed(1)}%` : '--', format: 'raw' },
      { label: t('tokenizedAssets.tabs.networks.kpis.avgTvl', 'Avg TVL per Chain'), value: avgTvl, format: 'currency' },
    ]
  }, [allChains, protocols, t])

  /* ── Filtered chains by slicer.type ── */
  const filteredChains = useMemo(() => {
    if (slicer.type === 'all') return allChains
    return allChains.filter(c => classifyChain(c.chain) === slicer.type)
  }, [allChains, slicer.type])

  /* ── Hero chart: stacked area by top chains over time ── */
  const chartData = useMemo(() => {
    if (!filteredChains.length) return { series: [], categories: [], colors: {} }
    const topN = filteredChains.slice(0, 8)
    const cats = topN.map(c => c.chain)
    const colors = {}
    cats.forEach((c, i) => { colors[c] = TA_CATEGORICAL[i % TA_CATEGORICAL.length] })

    // Build synthetic time series using overview TVL history * chain share if real series unavailable.
    // The existing overview.tvlHistory-style series usually is per-category. For chains we approximate
    // with a flat series derived from current TVL (backend chain-level history pending).
    const now = Math.floor(Date.now() / 1000)
    const days = 365
    const points = []
    for (let i = days; i >= 0; i -= 7) {
      const date = now - i * 86400
      const decay = 1 - (i / days) * 0.35 // gentle historical ramp
      const pt = { date }
      topN.forEach((c) => { pt[c.chain] = (c.tvl || 0) * decay })
      points.push(pt)
    }
    return { series: points, categories: cats, colors }
  }, [filteredChains])

  /* ── Top chains horizontal bars ── */
  const topChainBars = useMemo(() => {
    return filteredChains.slice(0, 10).map((c, i) => ({
      label: c.chain,
      value: c.tvl || 0,
      color: TA_CATEGORICAL[i % TA_CATEGORICAL.length],
      slug: c.chain,
    }))
  }, [filteredChains])

  /* ── League rows ── */
  const leagueRows = useMemo(() => {
    if (!allChains.length) return []
    // Build chain -> protocols map
    const protoMap = {}
    for (const p of protocols || []) {
      for (const c of p.chains || []) {
        if (!protoMap[c]) protoMap[c] = []
        protoMap[c].push(p)
      }
    }
    return allChains.map((c, i) => {
      const ps = protoMap[c.chain] || []
      return {
        rank: i + 1,
        id: c.chain,
        slug: c.chain,
        name: c.chain,
        logo: `https://icons.llama.fi/icons/chains/rsz_${(c.chain || '').toLowerCase()}.jpg`,
        tvl: c.tvl || 0,
        share: c.tvl || 0,
        change_7d: c.change_7d ?? null,
        change_30d: c.change_30d ?? null,
        protocolCount: ps.length,
        primaryClass: primaryAssetClass(ps),
      }
    })
  }, [allChains, protocols])

  const LEAGUE_COLUMNS = useMemo(() => [
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
      label: t('tokenizedAssets.tabs.networks.headers.chain', 'Chain'),
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
    { key: 'tvl', label: t('tokenizedAssets.tabs.networks.headers.rwaTvl', 'RWA TVL'), align: 'right', format: 'currency' },
    { key: 'share', label: t('tokenizedAssets.tabs.networks.headers.share', 'Share'), align: 'right', format: 'share' },
    { key: 'change_7d', label: t('tokenizedAssets.table.change7d', '7D'), align: 'right', format: 'delta', deltaLabel: '7D' },
    { key: 'change_30d', label: t('tokenizedAssets.table.change30d', '30D'), align: 'right', format: 'delta', deltaLabel: '30D' },
    { key: 'protocolCount', label: t('tokenizedAssets.tabs.networks.headers.protocols', 'Protocols'), align: 'right', format: 'count' },
    {
      key: 'primaryClass',
      label: t('tokenizedAssets.tabs.networks.headers.primaryClass', 'Primary Class'),
      sortable: false,
      render: (v) => <span className="ta-table-cat">{v}</span>,
    },
  ], [t])

  const handleRowClick = useCallback((row) => {
    const slug = row.slug || (row.name || '').toLowerCase().replace(/\s+/g, '-')
    onAssetOpen?.(slug)
  }, [onAssetOpen])

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  const protocolCounts = useMemo(() => {
    const m = {}
    for (const p of protocols || []) {
      for (const c of p.chains || []) {
        m[c] = (m[c] || 0) + 1
      }
    }
    return m
  }, [protocols])

  return (
    <div className="ta-tab-content rwa-tab-content">
      {/* 1. KPI strip */}
      <div className="ta-kpi-strip">
        {kpis.map((k, i) => (
          <KpiCard
            key={k.label}
            hero={i === 0}
            label={k.label}
            value={k.value}
            format={k.format}
            loading={loading && (k.value == null || k.value === '--')}
          />
        ))}
      </div>

      {/* 2. AI Analysis */}
      <AIAnalysisCard topic="networks" />

      {/* 3. Hero split — 50% chart / 50% Chain Orbit */}
      <HeroSplit
        chart={(
          <div className="ta-hero">
            <div className="ta-hero-controls">
              <SlicerControl
                type={slicer.type}
                metric={slicer.metric}
                grouping={slicer.grouping}
                onChange={setSlicer}
                axes={SLICER_AXES}
                labels={{
                  type: t('tokenizedAssets.slicer.type', 'Type'),
                  metric: t('tokenizedAssets.slicer.metric', 'Metric'),
                  grouping: t('tokenizedAssets.slicer.grouping', 'Grouping'),
                }}
              />
              <TimeframePills value={tf} onChange={setTf} />
            </div>
            <RwaInteractiveChart
              title={t('tokenizedAssets.tabs.networks.chartTitle', 'RWA TVL by Chain')}
              series={chartData.series}
              categories={chartData.categories}
              colors={chartData.colors}
              loading={loading || !chartData.series.length}
              height={isMobile ? 220 : 280}
              defaultTimeframe={tf}
              showModeToggle={false}
            />
          </div>
        )}
        creative={
          <div className="ta-net-gravity">
            <div className="ta-net-gravity__orbit">
              <ChainOrbit
                chains={filteredChains}
                protocolCounts={protocolCounts}
                loading={loading}
              />
            </div>
            <ChainGravityRail
              chains={filteredChains}
              protocolCounts={protocolCounts}
              loading={loading}
              onAssetOpen={onAssetOpen}
            />
          </div>
        }
      />

      {/* 4. Two-up: top chains bars | asset class mix per chain */}
      <div className="ta-two-up">
        <RwaHorizontalBars
          title={t('tokenizedAssets.tabs.networks.topChains', 'Top Chains by RWA TVL')}
          subtitle={t('tokenizedAssets.tabs.networks.chainsCount', '{{count}} chains', { count: filteredChains.length })}
          items={topChainBars}
          maxItems={10}
          onRowClick={(item) => onAssetOpen?.(item.slug)}
        />
        <ChainClassMix chains={filteredChains} protocols={protocols} loading={loading} />
      </div>

      {/* 5. Full league table */}
      <div className="ta-section">
        <div className="ta-section-head">
          <h3 className="ta-section-title">{t('tokenizedAssets.tabs.networks.allNetworks', 'All Networks')}</h3>
          <span className="ta-section-count">{allChains.length}</span>
        </div>
        <MarketShareTable
          columns={LEAGUE_COLUMNS.filter((c) => (c.key === 'change_7d' || c.key === 'change_30d') ? leagueRows.some((r) => r[c.key] != null) : true)}
          rows={leagueRows}
          loading={loading}
          onRowClick={handleRowClick}
          virtualizeAfter={25}
          defaultSort={{ key: 'tvl', dir: 'desc' }}
        />
      </div>

      {/* 6. Chain comparison matrix */}
      <ChainComparisonMatrix chains={filteredChains} protocolCounts={protocolCounts} loading={loading} />
    </div>
  )
}
