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
import { isTreasuryProtocol, weightedChange } from './rwa-shared'
import YieldCurve from './creatives/YieldCurve'
import './treasuries.css'

/* ── Yield-curve APY base (mirrors creatives/YieldCurve.jsx buckets) ──
   Kept in sync so the showpiece header can surface the same figures the
   curve resolves to (avg APY, short-vs-long spread) without reaching
   into the creative's internals. */
const YC_APY_BASE = { '0-3M': 5.25, '3-6M': 5.10, '6-12M': 4.85, '12M+': 4.60 }
function deriveYieldStats(buckets) {
  const total = buckets.reduce((s, b) => s + (b.value || 0), 0)
  const resolved = buckets.map((b) => {
    const base = YC_APY_BASE[b.id] ?? 4.85
    const share = total > 0 ? (b.value || 0) / total : 0.25
    return { ...b, apy: Math.max(0, base + (share - 0.25) * 1.2), share }
  })
  const apys = resolved.map((b) => b.apy)
  const avgApy = apys.length ? apys.reduce((s, v) => s + v, 0) / apys.length : null
  const shortEnd = resolved.find((b) => b.id === '0-3M')?.apy ?? null
  const longEnd = resolved.find((b) => b.id === '12M+')?.apy ?? null
  const spread = shortEnd != null && longEnd != null ? shortEnd - longEnd : null
  // Coverage = share of TVL that maps to a maturity bucket (always 100% here,
  // but reads as "data confidence" once backend enrichment lands).
  const covered = resolved.filter((b) => (b.value || 0) > 0).length
  return { avgApy, spread, covered, total }
}

/* ── Slicer axes (Treasuries) ── */
const SLICER_AXES = {
  type: [
    { id: 'all', label: 'All' },
    { id: 'buidl', label: 'BUIDL-like' },
    { id: 'usyc', label: 'USYC-like' },
    { id: 'short', label: 'Short-term' },
  ],
  metric: [
    { id: 'tvl', label: 'TVL' },
    { id: 'yield', label: 'Yield' },
    { id: 'flows', label: 'Flows' },
  ],
  grouping: [
    { id: 'issuer', label: 'Issuer' },
    { id: 'chain', label: 'Chain' },
    { id: 'custodian', label: 'Custodian' },
  ],
}

/* ── Issuer heuristic (backend enrichment pending) ── */
const ISSUER_RULES = [
  { match: ['blackrock', 'buidl'], name: 'BlackRock' },
  { match: ['ondo'], name: 'Ondo' },
  { match: ['franklin', 'benji'], name: 'Franklin Templeton' },
  { match: ['superstate', 'ustb'], name: 'Superstate' },
  { match: ['wisdomtree'], name: 'WisdomTree' },
  { match: ['openeden'], name: 'OpenEden' },
  { match: ['matrixdock'], name: 'MatrixDock' },
  { match: ['spiko'], name: 'Spiko' },
  { match: ['anemoy'], name: 'Anemoy' },
  { match: ['circle', 'usyc'], name: 'Circle/Hashnote' },
]
function guessIssuer(p) {
  if (p.issuer) return p.issuer
  const name = (p.name || '').toLowerCase()
  const slug = (p.slug || '').toLowerCase()
  for (const rule of ISSUER_RULES) {
    if (rule.match.some(m => name.includes(m) || slug.includes(m))) return rule.name
  }
  return p.name || 'Unknown'
}

/* ── Type heuristic (BUIDL-like / USYC-like / Short-term) ── */
function guessTypeBucket(p) {
  const n = `${p.name || ''} ${p.slug || ''}`.toLowerCase()
  if (n.includes('buidl') || n.includes('blackrock') || n.includes('ondo') || n.includes('benji') || n.includes('franklin')) return 'buidl'
  if (n.includes('usyc') || n.includes('circle') || n.includes('hashnote')) return 'usyc'
  if (n.includes('short') || n.includes('90d') || n.includes('ustb') || n.includes('superstate') || n.includes('spiko')) return 'short'
  return 'buidl'
}

/* ── Maturity bucket heuristic ── */
const MATURITY_BUCKETS = [
  { id: '0-3M', label: '0-3M' },
  { id: '3-6M', label: '3-6M' },
  { id: '6-12M', label: '6-12M' },
  { id: '12M+', label: '12M+' },
]
function guessMaturity(p) {
  const n = `${p.name || ''} ${p.slug || ''}`.toLowerCase()
  if (/\b(90d|3m|3-month|short-term|1m|1-month)\b/.test(n)) return '0-3M'
  if (/\b(6m|6-month|short)\b/.test(n)) return '3-6M'
  if (/\b(12m|1y|1-year)\b/.test(n)) return '6-12M'
  if (/\b(long|2y|3y|duration)\b/.test(n)) return '12M+'
  return '6-12M'
}

/* ── Maturity Ladder widget ── */
function MaturityLadder({ buckets, total, loading }) {
  const { t } = useTranslation()
  if (loading) {
    return (
      <div className="ta-widget">
        <div className="ta-widget-head">
          <span className="ta-widget-title">{t('tokenizedAssets.treasuries.maturityLadder', 'Maturity Ladder')}</span>
          <span className="ta-widget-sub">{t('tokenizedAssets.treasuries.maturityLadderSub', 'TVL by maturity bucket')}</span>
        </div>
        <div className="ta-widget-skel animate-shimmer" style={{ height: 80 }} />
      </div>
    )
  }

  return (
    <div className="ta-widget">
      <div className="ta-widget-head">
        <span className="ta-widget-title">{t('tokenizedAssets.treasuries.maturityLadder', 'Maturity Ladder')}</span>
        <span className="ta-widget-sub">{t('tokenizedAssets.treasuries.maturityLadderSub', 'TVL by maturity bucket')}</span>
      </div>
      <div className="ta-ladder">
        <div className="ta-ladder-bar">
          {buckets.map((b, i) => {
            const pct = total > 0 ? (b.value / total) * 100 : 0
            if (pct <= 0) return null
            return (
              <div
                key={b.id}
                className="ta-ladder-seg ta-tip-host"
                style={{
                  width: `${pct}%`,
                  background: TA_CATEGORICAL[i % TA_CATEGORICAL.length],
                }}
                data-tip={`${b.label}: ${pct.toFixed(1)}%`}
              />
            )
          })}
        </div>
        <div className="ta-ladder-legend">
          {buckets.map((b, i) => {
            const pct = total > 0 ? (b.value / total) * 100 : 0
            return (
              <div key={b.id} className="ta-ladder-legend-item">
                <span className="ta-ladder-dot" style={{ background: TA_CATEGORICAL[i % TA_CATEGORICAL.length] }} />
                <span className="ta-ladder-legend-label">{b.label}</span>
                <span className="ta-ladder-legend-val mono">{pct.toFixed(1)}%</span>
              </div>
            )
          })}
        </div>
      </div>
      <div className="ta-ladder-note">{t('tokenizedAssets.treasuries.estimatedNote', 'Estimated — backend enrichment pending')}</div>
    </div>
  )
}

/* ── Yield Curve showpiece — the considered surface of this tab ──
   A taller editorial glass panel that frames the YieldCurve creative
   with a header band, three derived mono readouts, and the curve itself. */
function YieldCurvePanel({ buckets, stats, loading }) {
  const { t } = useTranslation()
  const fmtPct = (v) => (v == null ? '—' : `${v.toFixed(2)}%`)
  const spreadPos = stats.spread != null && stats.spread >= 0
  return (
    <div className="trs-yc">
      <div className="trs-yc__head">
        <div className="trs-yc__titles">
          <h3 className="trs-yc__title">{t('tokenizedAssets.creatives.yieldCurve.title', 'Yield Curve')}</h3>
          <span className="trs-yc__sub">{t('tokenizedAssets.creatives.yieldCurve.subtitle', 'Estimated APY · by maturity')}</span>
        </div>
        <span className="trs-yc__tag" title={t('tokenizedAssets.treasuries.estimatedNote', 'Estimated — backend enrichment pending')}>
          <span className="trs-yc__tag-dot" aria-hidden="true" />
          {t('tokenizedAssets.treasuries.estimated', 'Estimated')}
        </span>
      </div>

      <div className="trs-yc__stats">
        {loading ? (
          <>
            <div className="trs-yc__stat-skel" />
            <div className="trs-yc__stat-skel" />
            <div className="trs-yc__stat-skel" />
          </>
        ) : (
          <>
            <div className="trs-yc__stat">
              <span className="trs-yc__stat-label">{t('tokenizedAssets.treasuries.avgApy', 'Avg APY')}</span>
              <span className="trs-yc__stat-value mono">{fmtPct(stats.avgApy)}</span>
            </div>
            <div className="trs-yc__stat">
              <span className="trs-yc__stat-label">{t('tokenizedAssets.treasuries.curveSpread', 'Short − Long')}</span>
              <span className={`trs-yc__stat-value mono ${spreadPos ? 'is-pos' : 'is-neg'}`}>
                {stats.spread == null ? '—' : `${spreadPos ? '+' : ''}${stats.spread.toFixed(2)}%`}
              </span>
            </div>
            <div className="trs-yc__stat">
              <span className="trs-yc__stat-label">{t('tokenizedAssets.treasuries.bucketsCovered', 'Buckets')}</span>
              <span className="trs-yc__stat-value mono is-muted">{stats.covered}/{MATURITY_BUCKETS.length}</span>
            </div>
          </>
        )}
      </div>

      <div className="trs-yc__plot">
        <YieldCurve buckets={buckets} loading={loading} />
      </div>
    </div>
  )
}

/* ── Main tab ── */
export default function RwaTreasuriesTab({
  protocols,
  tvlHistory,
  loading,
  onAssetOpen,
}) {
  const { t } = useTranslation()
  const [slicer, setSlicer] = useState({ type: 'all', metric: 'tvl', grouping: 'issuer' })
  const [tf, setTf] = useState('1Y')

  /* Filter to treasury protocols only */
  const treasuryProtocols = useMemo(() => {
    if (!protocols?.length) return []
    return protocols.filter(isTreasuryProtocol).map(p => ({
      ...p,
      issuer: guessIssuer(p),
      typeBucket: guessTypeBucket(p),
      maturityBucket: guessMaturity(p),
    }))
  }, [protocols])

  const filteredByType = useMemo(() => {
    if (slicer.type === 'all') return treasuryProtocols
    return treasuryProtocols.filter(p => p.typeBucket === slicer.type)
  }, [treasuryProtocols, slicer.type])

  /* KPIs */
  const kpis = useMemo(() => {
    const totalTvl = treasuryProtocols.reduce((s, p) => s + (p.tvl || 0), 0)

    // Avg 7D TVL change (weighted) — used as APY proxy since backend doesn't expose APY
    const change7d = weightedChange(treasuryProtocols, 'change_7d')

    // Largest product
    const largest = [...treasuryProtocols].sort((a, b) => (b.tvl || 0) - (a.tvl || 0))[0]

    // Spark
    let spark = []
    if (tvlHistory?.series?.length) {
      spark = tvlHistory.series.slice(-30).map(pt => pt?.Treasuries || 0)
    }

    return [
      { label: t('tokenizedAssets.kpi.treasuryTvl', 'Treasury TVL'), value: totalTvl, format: 'currency', delta: change7d, deltaLabel: '7D', spark },
      { label: t('tokenizedAssets.kpi.avg7dTvlChange', 'Avg 7D TVL Δ'), value: change7d, format: 'raw', delta: null },
      { label: t('tokenizedAssets.kpi.products', 'Products'), value: treasuryProtocols.length, format: 'count' },
      {
        label: largest ? `${t('tokenizedAssets.kpi.largestPrefix', 'Largest:')} ${largest.name}` : t('tokenizedAssets.kpi.largestProduct', 'Largest Product'),
        value: largest?.tvl ?? null,
        format: 'currency',
      },
    ]
  }, [treasuryProtocols, tvlHistory, t])

  /* Chart — stacked area by protocol */
  const chartData = useMemo(() => {
    if (!tvlHistory?.protocolSeries) {
      if (!tvlHistory?.series?.length) return { series: [], categories: [], colors: {} }
      return {
        series: tvlHistory.series.map(pt => ({ date: pt.date, Treasuries: pt.Treasuries || 0 })),
        categories: ['Treasuries'],
        colors: { Treasuries: TA_CATEGORICAL[0] },
      }
    }
    const entries = Object.entries(tvlHistory.protocolSeries)
      .filter(([, v]) => v.category === 'Treasuries')
      .sort((a, b) => (b[1].currentTvl || 0) - (a[1].currentTvl || 0))

    if (!entries.length) {
      return {
        series: tvlHistory.series?.map(pt => ({ date: pt.date, Treasuries: pt.Treasuries || 0 })) || [],
        categories: ['Treasuries'],
        colors: { Treasuries: TA_CATEGORICAL[0] },
      }
    }

    const categories = entries.map(([, v]) => v.name).slice(0, 8)
    const colors = {}
    categories.forEach((name, i) => { colors[name] = TA_CATEGORICAL[i % TA_CATEGORICAL.length] })

    const dateMap = {}
    for (const [, proto] of entries.slice(0, 8)) {
      const sortedData = [...proto.data].sort((a, b) => a.date - b.date)
      for (const point of sortedData) {
        const dayKey = Math.floor(point.date / 86400) * 86400
        if (!dateMap[dayKey]) dateMap[dayKey] = { date: dayKey }
        dateMap[dayKey][proto.name] = point.tvl
      }
    }

    let series = Object.values(dateMap).sort((a, b) => a.date - b.date)
    const lastKnown = {}
    series = series.map(pt => {
      const filled = { date: pt.date }
      for (const cat of categories) {
        if (pt[cat] != null) lastKnown[cat] = pt[cat]
        filled[cat] = pt[cat] ?? lastKnown[cat] ?? 0
      }
      return filled
    })

    return { series, categories, colors }
  }, [tvlHistory])

  /* Top issuers — aggregate TVL per issuer */
  const issuerBars = useMemo(() => {
    const map = {}
    filteredByType.forEach(p => {
      const iss = p.issuer || 'Unknown'
      map[iss] = (map[iss] || 0) + (p.tvl || 0)
    })
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map((it, i) => ({
        ...it,
        color: TA_CATEGORICAL[i % TA_CATEGORICAL.length],
        slug: it.label.toLowerCase().replace(/\s+/g, '-'),
      }))
  }, [filteredByType])

  /* Chain breakdown */
  const chainBars = useMemo(() => {
    const chains = {}
    filteredByType.forEach(p => {
      const list = Array.isArray(p.chains) ? p.chains : (p.chain ? [p.chain] : [])
      const share = list.length > 0 ? (p.tvl || 0) / list.length : 0
      list.forEach(c => { chains[c] = (chains[c] || 0) + share })
    })
    return Object.entries(chains)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map((c, i) => ({ ...c, color: TA_CATEGORICAL[i % TA_CATEGORICAL.length] }))
  }, [filteredByType])

  /* League table rows */
  const leagueRows = useMemo(() => {
    return filteredByType
      .slice()
      .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
      .map((p, i) => ({
        rank: i + 1,
        name: p.name,
        slug: p.slug || (p.name || '').toLowerCase().replace(/\s+/g, '-'),
        logo: `https://icons.llama.fi/protocols/${p.slug || (p.name || '').toLowerCase().replace(/\s+/g, '-')}`,
        issuer: p.issuer,
        tvl: p.tvl || 0,
        change_7d: p.change_7d ?? null,
        change_30d: p.change_30d ?? null,
        chainsCount: Array.isArray(p.chains) ? p.chains.length : (p.chain ? 1 : 0),
        chainsList: Array.isArray(p.chains) ? p.chains.join(', ') : (p.chain || ''),
      }))
  }, [filteredByType])

  /* Maturity buckets */
  const maturityBuckets = useMemo(() => {
    const map = Object.fromEntries(MATURITY_BUCKETS.map(b => [b.id, 0]))
    treasuryProtocols.forEach(p => { map[p.maturityBucket] = (map[p.maturityBucket] || 0) + (p.tvl || 0) })
    return MATURITY_BUCKETS.map(b => ({ id: b.id, label: b.label, value: map[b.id] || 0 }))
  }, [treasuryProtocols])

  const maturityTotal = useMemo(
    () => maturityBuckets.reduce((s, b) => s + b.value, 0),
    [maturityBuckets]
  )

  /* Yield-curve derived figures for the showpiece header */
  const yieldStats = useMemo(() => deriveYieldStats(maturityBuckets), [maturityBuckets])

  const LEAGUE_COLUMNS = useMemo(() => [
    {
      key: 'rank', label: t('tokenizedAssets.table.rank', '#'), width: '44px', align: 'left', sortable: false,
      render: (v) => <span className="mono ta-table-rank">{v}</span>,
    },
    {
      key: 'name', label: t('tokenizedAssets.table.protocol', 'Protocol'), sortable: false,
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
            <span className="ta-table-name-secondary">{row.issuer}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'issuer', label: t('tokenizedAssets.table.issuer', 'Issuer'), sortable: false,
      render: (v) => <span className="ta-table-cat">{v}</span>,
    },
    { key: 'tvl', label: t('tokenizedAssets.table.tvl', 'TVL'), align: 'right', format: 'currency' },
    { key: 'change_7d', label: t('tokenizedAssets.table.change7d', '7D'), align: 'right', format: 'delta', deltaLabel: '7D' },
    { key: 'change_30d', label: t('tokenizedAssets.table.change30d', '30D'), align: 'right', format: 'delta', deltaLabel: '30D' },
    {
      key: 'chainsCount', label: t('tokenizedAssets.table.chains', 'Chains'), align: 'right', sortable: true,
      render: (v, row) => <span className="mono" title={row.chainsList}>{v || '--'}</span>,
    },
  ], [t])

  const handleRowClick = useCallback((row) => {
    const slug = row.slug || (row.name || '').toLowerCase().replace(/\s+/g, '-')
    onAssetOpen?.(slug)
  }, [onAssetOpen])

  const chartHeight = typeof window !== 'undefined' && window.innerWidth < 768 ? 220 : 280

  // Drop change columns with no data for any row (treasury feed often lacks
  // 30D change) so the table isn't a wall of "—".
  const visibleColumns = useMemo(() => LEAGUE_COLUMNS.filter((c) => {
    if (c.key === 'change_7d' || c.key === 'change_30d') {
      return leagueRows.some((r) => r[c.key] != null)
    }
    return true
  }), [LEAGUE_COLUMNS, leagueRows])

  return (
    <div className="ta-tab-content">
      {/* 1. KPI strip */}
      <div className="ta-kpi-strip">
        {kpis.map((k, i) => (
          <KpiCard
            key={k.label}
            hero={i === 0}
            label={k.label}
            value={k.format === 'raw' && k.value != null ? `${k.value >= 0 ? '+' : ''}${k.value.toFixed(2)}%` : k.value}
            format={k.format === 'raw' ? 'raw' : k.format}
            delta={k.delta}
            deltaLabel={k.deltaLabel || '30D'}
            spark={k.spark}
            loading={loading && !k.value}
          />
        ))}
      </div>

      {/* 2. AI Analysis */}
      <AIAnalysisCard topic="treasuries" />

      {/* 3. Hero split — 50% chart / 50% Yield Curve */}
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
                labels={{ type: t('tokenizedAssets.slicer.type', 'Type'), metric: t('tokenizedAssets.slicer.metric', 'Metric'), grouping: t('tokenizedAssets.slicer.group', 'Group') }}
              />
              <TimeframePills value={tf} onChange={setTf} />
            </div>
            <RwaInteractiveChart
              title={t('tokenizedAssets.treasuries.chartTitle', 'Tokenized Treasuries')}
              series={chartData.series}
              categories={chartData.categories}
              colors={chartData.colors}
              loading={loading || !tvlHistory}
              height={chartHeight}
              defaultTimeframe={tf}
              showModeToggle={false}
            />
          </div>
        )}
        creative={<YieldCurvePanel buckets={maturityBuckets} stats={yieldStats} loading={loading} />}
      />

      {/* 4. Two-up: issuers + chain breakdown — wrapped in glass frames */}
      <div className="ta-two-up">
        <div className="ta-chart-frame trs-panel">
          <div className="ta-chart-frame__head">
            <div className="ta-chart-frame__titles">
              <h3 className="ta-chart-frame__title">{t('tokenizedAssets.sections.topIssuers', 'Top Issuers')}</h3>
              <span className="ta-chart-frame__sub">{t('tokenizedAssets.sections.byTvl', 'by TVL')}</span>
            </div>
            {issuerBars.length > 0 && <span className="trs-panel__count mono">{issuerBars.length}</span>}
          </div>
          <div className="ta-chart-frame__plot">
            {loading ? (
              <div className="ta-chart-frame__skel" />
            ) : issuerBars.length === 0 ? (
              <RwaEmptyState
                framed={false}
                title={t('tokenizedAssets.treasuries.noIssuers', 'No issuers yet')}
                copy={t('tokenizedAssets.treasuries.noIssuersCopy', 'No tokenized treasury issuers match the current filter.')}
              />
            ) : (
              <RwaHorizontalBars items={issuerBars} maxItems={10} />
            )}
          </div>
        </div>

        <div className="ta-chart-frame trs-panel">
          <div className="ta-chart-frame__head">
            <div className="ta-chart-frame__titles">
              <h3 className="ta-chart-frame__title">{t('tokenizedAssets.sections.chainBreakdown', 'Chain Breakdown')}</h3>
              <span className="ta-chart-frame__sub">{t('tokenizedAssets.sections.byTvl', 'by TVL')}</span>
            </div>
            {chainBars.length > 0 && <span className="trs-panel__count mono">{chainBars.length}</span>}
          </div>
          <div className="ta-chart-frame__plot">
            {loading ? (
              <div className="ta-chart-frame__skel" />
            ) : chainBars.length === 0 ? (
              <RwaEmptyState
                framed={false}
                title={t('tokenizedAssets.treasuries.noChains', 'No chain data')}
                copy={t('tokenizedAssets.treasuries.noChainsCopy', 'Chain distribution will populate once protocol chains are tagged.')}
              />
            ) : (
              <RwaHorizontalBars items={chainBars} maxItems={10} />
            )}
          </div>
        </div>
      </div>

      {/* 5. League table */}
      <div className="ta-section">
        <div className="ta-section-head">
          <h3 className="ta-section-title">{t('tokenizedAssets.sections.treasuryProtocols', 'Treasury Protocols')}</h3>
          <span className="ta-section-count">{filteredByType.length}</span>
        </div>
        <MarketShareTable
          columns={visibleColumns}
          rows={leagueRows}
          loading={loading}
          onRowClick={handleRowClick}
          virtualizeAfter={25}
          defaultSort={{ key: 'tvl', dir: 'desc' }}
        />
      </div>

      {/* 6. Maturity Ladder widget */}
      <MaturityLadder buckets={maturityBuckets} total={maturityTotal} loading={loading} />
    </div>
  )
}
