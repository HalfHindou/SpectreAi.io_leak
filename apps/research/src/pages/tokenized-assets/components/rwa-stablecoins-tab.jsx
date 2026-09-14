import React, { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
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
import './stablecoins.css'

/* ── Slicer axis definitions (Stablecoins) ── */
const SLICER_AXES = {
  type: [
    { id: 'all', label: 'All' },
    { id: 'fiat', label: 'Fiat-backed' },
    { id: 'crypto', label: 'Crypto-backed' },
    { id: 'algo', label: 'Algo' },
  ],
  metric: [
    { id: 'mcap', label: 'Market Cap' },
    { id: 'volume', label: 'Transfer Vol' },
    { id: 'holders', label: 'Holders' },
  ],
  grouping: [
    { id: 'issuer', label: 'Issuer' },
    { id: 'chain', label: 'Chain' },
    { id: 'peg', label: 'Peg Currency' },
  ],
}

/* ── Peg-type heuristic (backend enrichment pending) ── */
const PEG_LABELS = { fiat: 'Fiat', crypto: 'Crypto', algo: 'Algo' }
function guessPegType(sc) {
  const name = (sc.name || '').toLowerCase()
  const sym = (sc.symbol || '').toLowerCase()
  const pt = (sc.pegType || '').toLowerCase()
  if (pt.includes('crypto')) return 'crypto'
  if (pt.includes('algo')) return 'algo'
  if (pt.includes('fiat')) return 'fiat'
  if (
    name.includes('dai') || name.includes('lusd') || name.includes('crvusd') ||
    sym === 'dai' || sym === 'lusd' || sym === 'susd' || sym === 'crvusd' || sym === 'gho'
  ) return 'crypto'
  if (
    name.includes('algo') || name.includes('frax') || name.includes('ust') ||
    name.includes('ampl') || sym === 'frax' || sym === 'ust'
  ) return 'algo'
  return 'fiat'
}

/* ── Peg target (backend enrichment pending) ── */
function guessPegTarget(sc) {
  const sym = (sc.symbol || '').toUpperCase()
  if (sym.startsWith('EUR') || sym.endsWith('EUR')) return { label: 'EUR', value: 1.08 }
  if (sym.startsWith('GBP') || sym.endsWith('GBP')) return { label: 'GBP', value: 1.25 }
  if (sym.startsWith('JPY') || sym.endsWith('JPY')) return { label: 'JPY', value: 0.0067 }
  return { label: 'USD', value: 1.0 }
}

/* ── Status helpers (single source of truth for peg tiers) ── */
function pegStatus(devPct) {
  const d = Math.abs(devPct || 0)
  if (d < 0.1) return 'good'
  if (d < 0.5) return 'warn'
  return 'bad'
}
const STATUS_VAR = {
  good: 'var(--bull)',
  warn: 'var(--amber, #F59E0B)',
  bad: 'var(--bear)',
}

/* ═══════════════════════════════════════════════════════════
   Peg Integrity Meter — a precision instrument, not a blob.
   A single $1.00 "true peg" axis runs down the center; each
   stablecoin is one lane with a marker offset from center by
   its signed deviation. Scannable in 5 seconds: anything not
   hugging the center line is drifting.
   ═══════════════════════════════════════════════════════════ */
function PegIntegrityMeter({ items = [], loading, onAssetOpen }) {
  const { t } = useTranslation()

  const { lanes, health } = useMemo(() => {
    const list = (items || [])
      .filter(it => it.price != null && it.target?.value != null)
      .slice(0, 8)
    // Symmetric scale: full-rail = 1% deviation either side. Markers clamp.
    const SCALE = 1.0
    const built = list.map((it) => {
      const target = it.target.value
      const signed = target > 0 ? ((it.price - target) / target) * 100 : 0
      const devPct = Math.abs(signed)
      const status = pegStatus(devPct)
      // Map signed deviation into 0..100 lane position (50 = perfect peg).
      const clamped = Math.max(-SCALE, Math.min(SCALE, signed))
      const pos = 50 + (clamped / SCALE) * 46 // leave 4% gutter each edge
      return { ...it, signed, devPct, status, pos }
    })
    const worst = built.reduce((m, b) => Math.max(m, b.devPct), 0)
    const stable = built.filter(b => b.status === 'good').length
    return {
      lanes: built,
      health: { worst, stable, total: built.length },
    }
  }, [items])

  const headStatus = health.worst < 0.1 ? 'good' : health.worst < 0.5 ? 'warn' : 'bad'

  return (
    <div className="ta-chart-frame sc-meter">
      <div className="ta-chart-frame__head">
        <div className="ta-chart-frame__titles">
          <h4 className="ta-chart-frame__title">{t('tokenizedAssets.stablecoins.pegStability', 'Peg Integrity')}</h4>
          <span className="ta-chart-frame__sub">{t('tokenizedAssets.stablecoins.pegStabilitySub', 'Deviation from target peg')}</span>
        </div>
        {!loading && health.total > 0 && (
          <span className={`sc-meter__health sc-status-${headStatus}`}>
            <span className="sc-meter__health-dot" />
            <span className="mono">{health.stable}/{health.total}</span>
            <span className="sc-meter__health-label">{t('tokenizedAssets.stablecoins.holding', 'holding peg')}</span>
          </span>
        )}
      </div>

      {loading ? (
        <div className="sc-meter__body">
          <div className="sc-meter__scale sc-meter__scale--skel" />
          <div className="sc-meter__lanes">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`sc-lane-skel animate-shimmer stagger-${(i % 5) + 1}`} />
            ))}
          </div>
        </div>
      ) : !lanes.length ? (
        <RwaEmptyState
          framed={false}
          title={t('tokenizedAssets.stablecoins.noPegData', 'No peg data yet')}
          copy={t('tokenizedAssets.stablecoins.noPegDataCopy', 'Live peg deviations appear here once price feeds resolve for the tracked stablecoins.')}
        />
      ) : (
        <div className="sc-meter__body">
          {/* The instrument scale: -1% … PEG … +1% */}
          <div className="sc-meter__scale" aria-hidden="true">
            <span className="sc-meter__tick sc-meter__tick--end">−1%</span>
            <span className="sc-meter__tick sc-meter__tick--mid">$1.00</span>
            <span className="sc-meter__tick sc-meter__tick--end">+1%</span>
          </div>

          <div className="sc-meter__lanes">
            {/* The center "true peg" line spans all lanes */}
            <span className="sc-meter__axis" aria-hidden="true" />
            <span className="sc-meter__band sc-meter__band--good" aria-hidden="true" />

            {lanes.map((p) => {
              const color = STATUS_VAR[p.status]
              const side = p.signed >= 0 ? 'over' : 'under'
              return (
                <button
                  type="button"
                  key={p.symbol}
                  className={`sc-lane sc-status-${p.status}`}
                  onClick={() => onAssetOpen?.(p.slug || (p.symbol || '').toLowerCase())}
                  title={t('tokenizedAssets.creatives.pegRing.dotTitle', '{{symbol}} · {{dev}}% dev', { symbol: p.symbol, dev: p.devPct.toFixed(3) })}
                >
                  <span className="sc-lane__sym">{p.symbol}</span>
                  <span className="sc-lane__track">
                    {/* stem from center to the marker */}
                    <span
                      className={`sc-lane__stem sc-lane__stem--${side}`}
                      style={{ left: `${Math.min(50, p.pos)}%`, width: `${Math.abs(p.pos - 50)}%` }}
                    />
                    <span
                      className="sc-lane__marker"
                      style={{ left: `${p.pos}%`, '--sc-marker': color }}
                    />
                  </span>
                  <span className="sc-lane__dev mono" style={{ color }}>
                    {p.devPct < 0.001 ? t('tokenizedAssets.stablecoins.perfect', 'Perfect') : `${p.signed >= 0 ? '+' : '−'}${p.devPct.toFixed(3)}%`}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="sc-meter__legend">
            <span className="sc-meter__legend-item sc-status-good"><span className="sc-meter__legend-dot" /> &lt; 0.1%</span>
            <span className="sc-meter__legend-item sc-status-warn"><span className="sc-meter__legend-dot" /> 0.1–0.5%</span>
            <span className="sc-meter__legend-item sc-status-bad"><span className="sc-meter__legend-dot" /> &gt; 0.5%</span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   Peg Stability board (bottom) — redesigned as glass cards with
   a centered deviation meter mirroring the hero instrument.
   ═══════════════════════════════════════════════════════════ */
function PegStabilityBoard({ items, loading }) {
  const { t } = useTranslation()
  const { fmtPrice } = useCurrency()

  if (loading) {
    return (
      <div className="ta-section">
        <div className="ta-section-head">
          <h3 className="ta-section-title">{t('tokenizedAssets.stablecoins.pegStability', 'Peg Stability')}</h3>
        </div>
        <div className="sc-board">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`sc-card-skel animate-shimmer stagger-${(i % 5) + 1}`} />
          ))}
        </div>
      </div>
    )
  }

  if (!items?.length) {
    return (
      <div className="ta-section">
        <div className="ta-section-head">
          <h3 className="ta-section-title">{t('tokenizedAssets.stablecoins.pegStability', 'Peg Stability')}</h3>
        </div>
        <RwaEmptyState
          title={t('tokenizedAssets.stablecoins.noPegData', 'No peg data yet')}
          copy={t('tokenizedAssets.stablecoins.noPegDataCopy', 'Live peg deviations appear here once price feeds resolve for the tracked stablecoins.')}
        />
      </div>
    )
  }

  return (
    <div className="ta-section">
      <div className="ta-section-head">
        <h3 className="ta-section-title">{t('tokenizedAssets.stablecoins.pegStability', 'Peg Stability')}</h3>
        <span className="ta-section-count">{items.length}</span>
      </div>
      <div className="sc-board">
        {items.map((it) => {
          const signed = it.target?.value > 0 ? ((it.price - it.target.value) / it.target.value) * 100 : 0
          const devPct = Math.abs(signed)
          const status = pegStatus(devPct)
          const color = STATUS_VAR[status]
          const clamped = Math.max(-1, Math.min(1, signed))
          const pos = 50 + (clamped / 1) * 46
          const side = signed >= 0 ? 'over' : 'under'
          const statusLabel = status === 'good'
            ? t('tokenizedAssets.stablecoins.stable', 'Stable')
            : status === 'warn'
              ? t('tokenizedAssets.stablecoins.watch', 'Watch')
              : t('tokenizedAssets.stablecoins.dePeg', 'De-peg')
          return (
            <div key={it.symbol} className={`ta-glass-card ta-glass-card--quiet sc-card sc-status-${status}`}>
              <div className="sc-card__head">
                <span className="sc-card__logo" aria-hidden="true">
                  {it.logo ? (
                    <img src={it.logo} alt="" loading="lazy" onError={e => { e.target.style.display = 'none' }} />
                  ) : (
                    <span className="sc-card__logo-fb">{(it.symbol || '?')[0]}</span>
                  )}
                </span>
                <div className="sc-card__ident">
                  <span className="sc-card__sym">{it.symbol}</span>
                  <span className="sc-card__target">
                    {t('tokenizedAssets.stablecoins.target', 'Target ${{value}} {{label}}', { value: it.target.value.toFixed(2), label: it.target.label })}
                  </span>
                </div>
                <span className="sc-card__pill">{statusLabel}</span>
              </div>

              <div className="sc-card__meter">
                <span className="sc-card__axis" aria-hidden="true" />
                <span
                  className={`sc-card__stem sc-card__stem--${side}`}
                  style={{ left: `${Math.min(50, pos)}%`, width: `${Math.abs(pos - 50)}%` }}
                />
                <span className="sc-card__marker" style={{ left: `${pos}%`, '--sc-marker': color }} />
              </div>

              <div className="sc-card__foot">
                <span className="sc-card__price mono">{fmtPrice ? fmtPrice(it.price) : `$${it.price.toFixed(4)}`}</span>
                <span className="sc-card__dev mono" style={{ color }}>
                  {devPct < 0.001 ? t('tokenizedAssets.stablecoins.perfect', 'Perfect') : `${signed >= 0 ? '+' : '−'}${devPct.toFixed(3)}%`}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Main tab ── */
export default function RwaStablecoinsTab({
  stablecoins,
  stablecoinHistory,
  loading,
  onAssetOpen,
}) {
  const { t } = useTranslation()
  const [slicer, setSlicer] = useState({ type: 'all', metric: 'mcap', grouping: 'issuer' })
  const [tf, setTf] = useState('1Y')

  /* Enriched stablecoins with heuristics */
  const enriched = useMemo(() => {
    if (!stablecoins?.length) return []
    return stablecoins.map((sc) => {
      const mcap = sc.circulating?.peggedUSD ?? sc.mcap ?? 0
      const pegType = guessPegType(sc)
      const target = guessPegTarget(sc)
      const price = sc.price ?? target.value
      const devPct = target.value > 0
        ? Math.abs((price - target.value) / target.value) * 100
        : 0
      const chainCirculating = sc.chainCirculating || {}
      const chains = Object.keys(chainCirculating).length || (sc.chains?.length || 1)
      return {
        ...sc,
        mcap,
        pegType,
        target,
        price,
        devPct,
        chains,
        chainCirculating,
        change_7d: sc.change_7d ?? null,
        change_30d: sc.change_30d ?? null,
      }
    }).sort((a, b) => b.mcap - a.mcap)
  }, [stablecoins])

  const filteredByType = useMemo(() => {
    if (slicer.type === 'all') return enriched
    return enriched.filter(sc => sc.pegType === slicer.type)
  }, [enriched, slicer.type])

  /* KPIs */
  const kpis = useMemo(() => {
    const totalMcap = enriched.reduce((s, sc) => s + sc.mcap, 0)

    // 30D growth — weighted
    let change30d = null
    if (enriched.length) {
      let w = 0, sum = 0
      for (const sc of enriched) {
        const c = sc.change_30d
        if (sc.mcap > 0 && c != null) { w += sc.mcap; sum += c * sc.mcap }
      }
      if (w > 0) change30d = sum / w
    }

    // Holders — use dominant issuer's holders if MAA not available
    const dominant = enriched[0]
    const holders = dominant?.holders ?? dominant?.uniqueHolders ?? null

    // Sparkline from history totals
    let spark = []
    if (stablecoinHistory?.series?.length && stablecoinHistory?.coins?.length) {
      const keys = stablecoinHistory.coins.map(c => c.symbol)
      spark = stablecoinHistory.series.slice(-30).map(pt =>
        keys.reduce((s, k) => s + (pt[k] || 0), 0)
      )
    }

    return [
      { label: t('tokenizedAssets.kpi.totalMarketCap', 'Total Market Cap'), value: totalMcap, format: 'currency', delta: change30d, spark },
      { label: t('tokenizedAssets.kpi.growth30d', '30D Growth'), value: change30d, format: 'raw', delta: null },
      { label: holders != null ? `${dominant?.symbol || ''} ${t('tokenizedAssets.kpi.holders', 'Holders')}`.trim() : t('tokenizedAssets.kpi.holders', 'Holders'), value: holders, format: 'count' },
      { label: t('tokenizedAssets.kpi.stablecoinsTracked', 'Stablecoins Tracked'), value: enriched.length, format: 'count' },
    ]
  }, [enriched, stablecoinHistory, t])

  /* Chart: top-8 stablecoins stacked area */
  const chartData = useMemo(() => {
    if (!stablecoinHistory?.series?.length || !stablecoinHistory?.coins?.length) {
      return { series: [], categories: [], colors: {} }
    }
    let coins = stablecoinHistory.coins
    // Filter coins matching peg type via heuristic
    if (slicer.type !== 'all') {
      coins = coins.filter(c => guessPegType(c) === slicer.type)
      if (!coins.length) coins = stablecoinHistory.coins
    }
    const top = coins.slice(0, 8)
    const categories = top.map(c => c.symbol)
    const colors = {}
    categories.forEach((c, i) => { colors[c] = TA_CATEGORICAL[i % TA_CATEGORICAL.length] })
    return { series: stablecoinHistory.series, categories, colors }
  }, [stablecoinHistory, slicer.type])

  /* Issuer share bars (league-style, top 10 by mcap among filtered) */
  const issuerBars = useMemo(() => {
    return filteredByType.slice(0, 10).map((sc, i) => ({
      label: sc.symbol || sc.name,
      value: sc.mcap,
      color: TA_CATEGORICAL[i % TA_CATEGORICAL.length],
      slug: sc.slug || (sc.name || '').toLowerCase().replace(/\s+/g, '-'),
    }))
  }, [filteredByType])

  /* Chain distribution */
  const chainBars = useMemo(() => {
    const chains = {}
    filteredByType.forEach(sc => {
      if (sc.chainCirculating) {
        Object.entries(sc.chainCirculating).forEach(([chain, data]) => {
          const val = data?.current?.peggedUSD ?? data?.peggedUSD ?? 0
          if (val > 0) chains[chain] = (chains[chain] || 0) + val
        })
      }
    })
    return Object.entries(chains)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map((c, i) => ({ ...c, color: TA_CATEGORICAL[i % TA_CATEGORICAL.length] }))
  }, [filteredByType])

  /* League table rows */
  const leagueRows = useMemo(() => {
    return filteredByType.map((sc, i) => ({
      rank: i + 1,
      name: sc.name || sc.symbol,
      symbol: sc.symbol,
      slug: sc.slug || (sc.name || sc.symbol || '').toLowerCase().replace(/\s+/g, '-'),
      logo: sc.logo || (sc.gecko_id ? `https://assets.coingecko.com/coins/images/${sc.gecko_id}/small.png` : null),
      pegType: sc.pegType,
      mcap: sc.mcap,
      change_7d: sc.change_7d,
      change_30d: sc.change_30d,
      devPct: sc.devPct,
    }))
  }, [filteredByType])

  /* Peg meter items (top filtered, both surfaces share the shape) */
  const pegItems = useMemo(() => {
    return filteredByType.map((sc) => ({
      symbol: sc.symbol || sc.name,
      slug: sc.slug || (sc.name || sc.symbol || '').toLowerCase().replace(/\s+/g, '-'),
      logo: sc.logo || null,
      price: sc.price,
      target: sc.target,
      devPct: sc.devPct,
    }))
  }, [filteredByType])

  const LEAGUE_COLUMNS = useMemo(() => [
    {
      key: 'rank', label: t('tokenizedAssets.table.rank', '#'), width: '44px', align: 'left', sortable: false,
      render: (v) => <span className="mono ta-table-rank">{v}</span>,
    },
    {
      key: 'name', label: t('tokenizedAssets.table.asset', 'Asset'), sortable: false,
      render: (_v, row) => (
        <div className="ta-table-logo-cell">
          <img
            className="ta-table-logo"
            src={row.logo || ''}
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
            style={{ display: row.logo ? 'none' : 'inline-flex', background: TA_CATEGORICAL[row.rank % TA_CATEGORICAL.length] }}
          >
            {(row.symbol || row.name || '?')[0]}
          </span>
          <div className="ta-table-name">
            <span className="ta-table-name-primary">{row.name}</span>
            <span className="ta-table-name-secondary">{row.symbol}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'pegType', label: t('tokenizedAssets.table.peg', 'Peg'), sortable: false,
      render: (v) => <span className={`ta-peg-pill ta-peg-pill-${v}`}>{PEG_LABELS[v] || v}</span>,
    },
    { key: 'mcap', label: t('tokenizedAssets.table.marketCap', 'Market Cap'), align: 'right', format: 'currency' },
    { key: 'change_7d', label: t('tokenizedAssets.table.change7d', '7D'), align: 'right', format: 'delta', deltaLabel: '7D' },
    { key: 'change_30d', label: t('tokenizedAssets.table.change30d', '30D'), align: 'right', format: 'delta', deltaLabel: '30D' },
    {
      key: 'devPct', label: t('tokenizedAssets.table.pegDev', 'Peg Dev'), align: 'right', sortable: true,
      render: (v) => {
        if (v == null) return <span className="ta-table-muted">--</span>
        const color = STATUS_VAR[pegStatus(v)]
        return <span className="mono" style={{ color }}>{v.toFixed(3)}%</span>
      },
    },
  ], [t])

  const handleRowClick = useCallback((row) => {
    const slug = row.slug || (row.name || '').toLowerCase().replace(/\s+/g, '-')
    onAssetOpen?.(slug)
  }, [onAssetOpen])

  const chartHeight = typeof window !== 'undefined' && window.innerWidth < 768 ? 220 : 280

  // Drop change columns that have no data for any row (stablecoin feed often
  // lacks 7D/30D mcap change) so the table isn't a wall of "—".
  const visibleColumns = useMemo(() => LEAGUE_COLUMNS.filter((c) => {
    if (c.key === 'change_7d' || c.key === 'change_30d') {
      return leagueRows.some((r) => r[c.key] != null)
    }
    return true
  }), [LEAGUE_COLUMNS, leagueRows])

  return (
    <div className="ta-tab-content">
      {/* 1. KPI strip — hide KPIs with no data (no "-- --" placeholders);
           keep all during load so skeletons still show. */}
      <div className="ta-kpi-strip">
        {(loading ? kpis : kpis.filter(k => k.value != null && !(typeof k.value === 'number' && Number.isNaN(k.value)))).map((k, i) => (
          <KpiCard
            key={k.label}
            hero={i === 0}
            label={k.label}
            value={k.format === 'raw' && k.value != null ? `${k.value >= 0 ? '+' : ''}${k.value.toFixed(2)}%` : k.value}
            format={k.format === 'raw' ? 'raw' : k.format}
            delta={k.delta}
            deltaLabel="30D"
            spark={k.spark}
            loading={loading && !k.value}
          />
        ))}
      </div>

      {/* 2. AI Analysis */}
      <AIAnalysisCard topic="stablecoins" />

      {/* 3. Hero split — 50% supply chart / 50% Peg Integrity meter */}
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
              title={t('tokenizedAssets.stablecoins.chartTitle', 'Stablecoin Supply')}
              series={chartData.series}
              categories={chartData.categories}
              colors={chartData.colors}
              loading={loading || !stablecoinHistory}
              height={chartHeight}
              defaultTimeframe={tf}
              showModeToggle={false}
            />
          </div>
        )}
        creative={
          <PegIntegrityMeter
            items={pegItems.slice(0, 8)}
            loading={loading}
            onAssetOpen={onAssetOpen}
          />
        }
      />

      {/* 4. Two-up: issuer share + chain distribution */}
      <div className="ta-two-up">
        <RwaHorizontalBars
          title={t('tokenizedAssets.sections.topIssuers', 'Top Issuers')}
          subtitle={t('tokenizedAssets.sections.totalCount', '{{count}} total', { count: filteredByType.length })}
          items={issuerBars}
          maxItems={10}
          onRowClick={(item) => onAssetOpen?.(item.slug || item.label.toLowerCase().replace(/\s+/g, '-'))}
        />
        <RwaHorizontalBars
          title={t('tokenizedAssets.sections.chainDistribution', 'Chain Distribution')}
          subtitle={t('tokenizedAssets.sections.bySupply', 'by supply')}
          items={chainBars}
          maxItems={10}
        />
      </div>

      {/* 5. Full league table */}
      <div className="ta-section">
        <div className="ta-section-head">
          <h3 className="ta-section-title">{t('tokenizedAssets.sections.allStablecoins', 'All Stablecoins')}</h3>
          <span className="ta-section-count">{filteredByType.length}</span>
        </div>
        <MarketShareTable
          columns={visibleColumns}
          rows={leagueRows}
          loading={loading}
          onRowClick={handleRowClick}
          virtualizeAfter={25}
          defaultSort={{ key: 'mcap', dir: 'desc' }}
        />
      </div>

      {/* 6. Peg Stability board — redesigned glass cards */}
      <PegStabilityBoard items={pegItems.slice(0, 12)} loading={loading} />
    </div>
  )
}
