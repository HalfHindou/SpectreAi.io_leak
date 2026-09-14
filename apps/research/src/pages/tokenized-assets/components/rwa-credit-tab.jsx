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
import { isCreditProtocol, weightedChange, hexToRgba } from './rwa-shared'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import './credit.css'

/* ── Credit type inference (heuristic). Returns canonical English keys; the
   display layer maps them through the i18n table. */
function inferCreditType(name) {
  const n = (name || '').toLowerCase()
  if (n.includes('real') || n.includes('estate') || n.includes('property')) return 'Real Estate Debt'
  if (n.includes('trade') || n.includes('invoice') || n.includes('finex')) return 'Trade Finance'
  if (n.includes('supply') || n.includes('chain-link')) return 'Supply Chain'
  if (
    n.includes('centrifuge') || n.includes('maple') || n.includes('goldfinch') ||
    n.includes('truefi') || n.includes('clearpool') || n.includes('credix')
  ) return 'SME Lending'
  return 'SME Lending'
}

/* ── Founding year guesses for vintage heatmap + radar maturity axis
   (heuristic, marked estimated) ── */
const FOUNDING_YEARS = {
  centrifuge: 2017,
  maple: 2019,
  goldfinch: 2020,
  truefi: 2020,
  clearpool: 2021,
  credix: 2021,
  'maple-finance': 2019,
  ondo: 2021,
  securitize: 2017,
}

function guessFoundingYear(name, slug) {
  const key = (slug || name || '').toLowerCase()
  for (const [k, y] of Object.entries(FOUNDING_YEARS)) {
    if (key.includes(k)) return y
  }
  return 2022 // default midpoint assumption
}

function vintageBucket(name, slug) {
  const age = new Date().getFullYear() - guessFoundingYear(name, slug)
  if (age < 1) return '<1Y'
  if (age < 2) return '1-2Y'
  if (age < 3) return '2-3Y'
  return '3Y+'
}

const VINTAGE_BUCKETS = ['<1Y', '1-2Y', '2-3Y', '3Y+']

/* ══════════════════════════════════════════
   CreditRiskRadar — readable glass risk viz
   ──────────────────────────────────────────
   Five normalized axes (0..1) across the top
   lenders, plus a composite Risk-Strength score
   shown in the dial center for the focused (or
   portfolio-aggregate) protocol. Click a lender
   chip to focus it; click again to release.
   ══════════════════════════════════════════ */

const RADAR_AXES = [
  { key: 'aum',       short: 'AUM',     long: 'AUM Scale' },
  { key: 'chains',    short: 'Reach',   long: 'Chain Reach' },
  { key: 'maturity',  short: 'Age~',    long: 'Maturity (est.)' },
  { key: 'momentum',  short: '30D',     long: '30D Momentum' },
  { key: 'stability', short: 'Stable',  long: 'Price Stability' },
]

/* Composite weighting — favours scale + stability (a "credit strength" lens). */
const SCORE_WEIGHTS = { aum: 0.28, chains: 0.16, maturity: 0.18, momentum: 0.14, stability: 0.24 }

function scoreFor(values) {
  let s = 0
  for (const ax of RADAR_AXES) s += (values[ax.key] || 0) * SCORE_WEIGHTS[ax.key]
  return Math.round(s * 100)
}

function scoreTier(score) {
  if (score >= 66) return { key: 'strong', label: 'Resilient' }
  if (score >= 42) return { key: 'mid', label: 'Balanced' }
  return { key: 'fragile', label: 'Fragile' }
}

function CreditRiskRadar({ protocols = [], loading }) {
  const { t } = useTranslation()
  const [focus, setFocus] = useState(null) // pinned protocol name or null (portfolio)
  const [hover, setHover] = useState(null)  // hovered protocol name (preview)

  const data = useMemo(() => {
    if (!protocols?.length) return { items: [], aggregate: null }
    const top = [...protocols]
      .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
      .slice(0, 6)
    if (!top.length) return { items: [], aggregate: null }

    const maxTvl = Math.max(1, ...top.map(p => p.tvl || 0))
    const maxChains = Math.max(1, ...top.map(p => ((p.chains || []).length || 1)))
    const ages = top.map(p => new Date().getFullYear() - guessFoundingYear(p.name, p.slug))
    const maxAge = Math.max(1, ...ages)

    const items = top.map((p, i) => {
      const tvl = p.tvl || 0
      const aum = maxTvl > 1 ? Math.log10(tvl + 1) / Math.log10(maxTvl + 1) : 0
      const chains = ((p.chains || []).length || 1) / maxChains
      const maturity = ages[i] / maxAge
      const momentum = Math.max(0, Math.min(1, ((p.change_30d || 0) + 30) / 60))
      // Stability: lower 7D volatility magnitude => higher stability.
      const vol = Math.abs(p.change_7d ?? 0)
      const stability = Math.max(0, Math.min(1, 1 - vol / 40))
      const values = { aum, chains, maturity, momentum, stability }
      return {
        name: p.name,
        slug: p.slug,
        tvl,
        change_30d: p.change_30d ?? null,
        color: TA_CATEGORICAL[i % TA_CATEGORICAL.length],
        values,
        score: scoreFor(values),
      }
    })

    // Aggregate = TVL-weighted mean of each axis (the "portfolio" shape).
    const totalTvl = items.reduce((s, it) => s + (it.tvl || 0), 0) || 1
    const aggValues = {}
    for (const ax of RADAR_AXES) {
      aggValues[ax.key] = items.reduce((s, it) => s + (it.values[ax.key] * (it.tvl || 0)), 0) / totalTvl
    }
    const aggregate = { name: '__portfolio__', values: aggValues, score: scoreFor(aggValues) }

    return { items, aggregate }
  }, [protocols])

  const cx = 50, cy = 50, R = 33
  const angleFor = (i) => (-Math.PI / 2) + (i / RADAR_AXES.length) * (Math.PI * 2)
  const pointFor = (value, i) => {
    const a = angleFor(i)
    const r = R * Math.max(0, Math.min(1, value))
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
  }
  const polygonFor = (vals) => RADAR_AXES.map((ax, i) => pointFor(vals[ax.key], i).join(',')).join(' ')

  // Hover previews a lender; click pins it. Either drives the "active" shape.
  const active = hover || focus
  const focused = active ? data.items.find(it => it.name === active) : null
  const center = focused || data.aggregate
  const tier = center ? scoreTier(center.score) : null

  const toggle = (name) => setFocus(prev => (prev === name ? null : name))

  return (
    <div className="cr-radar">
      <div className="cr-radar__head">
        <div className="cr-radar__titles">
          <span className="cr-radar__title">{t('tokenizedAssets.tabs.credit.riskRadarTitle', 'Risk Radar')}</span>
          <span className="cr-radar__sub">
            {t('tokenizedAssets.tabs.credit.riskRadarSub', 'Top lenders · 5 strength axes')}
          </span>
        </div>
        {center && tier && !loading && data.items.length ? (
          <div className={`cr-radar__score cr-radar__score--${tier.key}`}>
            <span className="cr-radar__score-val mono">{center.score}</span>
            <span className="cr-radar__score-tier">{
              tier.key === 'strong'
                ? t('tokenizedAssets.tabs.credit.tierResilient', 'Resilient')
                : tier.key === 'mid'
                  ? t('tokenizedAssets.tabs.credit.tierBalanced', 'Balanced')
                  : t('tokenizedAssets.tabs.credit.tierFragile', 'Fragile')
            }</span>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="cr-radar__skel" aria-hidden="true" />
      ) : !data.items.length ? (
        <RwaEmptyState
          framed={false}
          title={t('tokenizedAssets.tabs.credit.radarEmptyTitle', 'No credit protocols in range')}
          copy={t('tokenizedAssets.tabs.credit.radarEmptyCopy', 'Risk axes appear once live lender TVL is available.')}
        />
      ) : (
        <div className="cr-radar__body">
          <div className="cr-radar__plot">
            <svg viewBox="0 0 100 100" className="cr-radar__svg" role="img" aria-label="Credit protocol risk radar">
              <defs>
                <radialGradient id="crRadarGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.05)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                </radialGradient>
                {/* Soft glow for the active lender shape */}
                <filter id="crRadarBlur" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="1.4" result="b" />
                  <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                {focused && (
                  <linearGradient id="crRadarFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={hexToRgba(focused.color, 0.42)} />
                    <stop offset="100%" stopColor={hexToRgba(focused.color, 0.10)} />
                  </linearGradient>
                )}
              </defs>
              <circle cx={cx} cy={cy} r={R + 4} fill="url(#crRadarGlow)" />

              {/* Concentric grid rings + scale ticks */}
              {[0.25, 0.5, 0.75, 1].map((level, li) => (
                <polygon
                  key={level}
                  points={RADAR_AXES.map((ax, i) => {
                    const a = angleFor(i)
                    const r = R * level
                    return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`
                  }).join(' ')}
                  className={`cr-radar__grid${li === 3 ? ' cr-radar__grid--outer' : ''}`}
                />
              ))}

              {/* Spokes + axis labels */}
              {RADAR_AXES.map((ax, i) => {
                const [x, y] = pointFor(1, i)
                const [lx, ly] = pointFor(1.18, i)
                return (
                  <g key={ax.key} className="cr-radar__axis">
                    <line x1={cx} y1={cy} x2={x} y2={y} />
                    <text x={lx} y={ly + 1.1} textAnchor="middle" className="cr-radar__axislabel">
                      {ax.short}
                    </text>
                  </g>
                )
              })}

              {/* Portfolio aggregate — the clean default shape; becomes a faint
                  dashed reference once a specific lender is active. */}
              {data.aggregate && (
                <polygon
                  points={polygonFor(data.aggregate.values)}
                  className={`cr-radar__agg${focused ? ' is-reference' : ' is-primary'}`}
                />
              )}

              {/* Active lender shape only (hover/click) — filled + glow, with
                  vertices. Keeps the radar legible instead of 6 overlaid shapes. */}
              {focused && (
                <g className="cr-radar__node is-focus" style={{ color: focused.color }}>
                  <polygon
                    points={polygonFor(focused.values)}
                    className="cr-radar__poly"
                    fill="url(#crRadarFill)"
                    filter="url(#crRadarBlur)"
                  />
                  {RADAR_AXES.map((ax, i) => {
                    const [x, y] = pointFor(focused.values[ax.key], i)
                    return <circle key={ax.key} cx={x} cy={y} r="1.4" className="cr-radar__vertex" />
                  })}
                </g>
              )}
            </svg>

            {/* Center readout overlay */}
            {center && (
              <div className="cr-radar__center">
                <span className="cr-radar__center-label">
                  {focused
                    ? focused.name
                    : t('tokenizedAssets.tabs.credit.radarPortfolio', 'Credit portfolio')}
                </span>
                <span className="cr-radar__center-score mono">{center.score}</span>
                <span className="cr-radar__center-cap">
                  {t('tokenizedAssets.tabs.credit.radarStrength', 'strength score')}
                </span>
              </div>
            )}
          </div>

          {/* Focused-protocol axis readout, else hint. Wrapped in a fixed-height
              shell so hover toggling readout<->hint never shifts the chips below
              (the shift caused a hover flicker loop). */}
          <div className="cr-radar__inspect">
          {focused ? (
            <div className="cr-radar__readout">
              {RADAR_AXES.map((ax) => (
                <div key={ax.key} className="cr-radar__metric">
                  <span className="cr-radar__metric-label">{ax.long}</span>
                  <div className="cr-radar__meter">
                    <div
                      className="cr-radar__meter-fill"
                      style={{
                        width: `${Math.round((focused.values[ax.key] || 0) * 100)}%`,
                        background: `linear-gradient(90deg, ${hexToRgba(focused.color, 0.85)} 0%, ${hexToRgba(focused.color, 0.45)} 100%)`,
                      }}
                    />
                  </div>
                  <span className="cr-radar__metric-val mono">{Math.round((focused.values[ax.key] || 0) * 100)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="cr-radar__hint">
              {t('tokenizedAssets.tabs.credit.radarHint', 'Hover a lender to preview · click to pin its strength profile.')}
            </p>
          )}
          </div>

          {/* Lender legend / focus chips */}
          <div className="cr-radar__legend">
            {data.items.map(it => {
              return (
                <button
                  type="button"
                  key={it.name}
                  onClick={() => toggle(it.name)}
                  onMouseEnter={() => setHover(it.name)}
                  onMouseLeave={() => setHover(null)}
                  className={`cr-radar__chip${focus === it.name ? ' is-active' : ''}${hover === it.name ? ' is-hover' : ''}`}
                  style={{ '--cr-chip': it.color }}
                  aria-pressed={focus === it.name}
                  title={`${it.name} · ${it.score}`}
                >
                  <span className="cr-radar__chip-dot" />
                  <span className="cr-radar__chip-label">{it.name}</span>
                  <span className="cr-radar__chip-score mono">{it.score}</span>
                </button>
              )
            })}
          </div>

          <div className="cr-radar__note">
            {t('tokenizedAssets.tabs.credit.radarNote', 'Maturity is estimated from founding-year heuristics.')}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Vintage Heatmap widget (glass-framed) ── */
function VintageHeatmap({ protocols, loading }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const formatValue = (v) => (v == null || v === 0 ? '--' : fmtLargeShort(v))
  const { topProtos, grid, maxCell } = useMemo(() => {
    if (!protocols?.length) return { topProtos: [], grid: {}, maxCell: 0 }
    const top = [...protocols].sort((a, b) => (b.tvl || 0) - (a.tvl || 0)).slice(0, 8)
    const g = {}
    let max = 0
    for (const p of top) {
      const b = vintageBucket(p.name, p.slug)
      const row = g[p.name] || { '<1Y': 0, '1-2Y': 0, '2-3Y': 0, '3Y+': 0 }
      row[b] = (row[b] || 0) + (p.tvl || 0)
      g[p.name] = row
      if (row[b] > max) max = row[b]
    }
    return { topProtos: top, grid: g, maxCell: max || 1 }
  }, [protocols])

  return (
    <div className="ta-widget cr-vintage">
      <div className="ta-widget-head">
        <div>
          <span className="ta-widget-title">{t('tokenizedAssets.tabs.credit.vintageHeatmap', 'Vintage Heatmap')}</span>
          <div className="ta-widget-sub">{t('tokenizedAssets.tabs.credit.vintageHeatmapSub', 'TVL concentration by protocol age')}</div>
        </div>
        <span className="ta-vintage-estimated">{t('tokenizedAssets.tabs.credit.estimatedNote', 'Estimated — backend enrichment pending')}</span>
      </div>
      {loading || !topProtos.length ? (
        <div className="ta-widget-skel animate-shimmer" />
      ) : (
        <div className="ta-vintage-grid">
          <div className="ta-vintage-colhead">
            <span className="ta-vintage-proto-head" />
            {VINTAGE_BUCKETS.map(b => (
              <span key={b} className="ta-vintage-bucket-head">{b}</span>
            ))}
          </div>
          {topProtos.map((p) => {
            const row = grid[p.name] || {}
            return (
              <div key={p.name} className="ta-vintage-row">
                <span className="ta-vintage-proto">{p.name}</span>
                {VINTAGE_BUCKETS.map((b) => {
                  const v = row[b] || 0
                  const intensity = v / maxCell
                  const bg = intensity > 0
                    ? `rgba(245, 158, 11, ${0.12 + intensity * 0.55})`
                    : 'rgba(255, 255, 255, 0.02)'
                  return (
                    <span
                      key={b}
                      className="ta-vintage-cell mono ta-tip-host"
                      style={{ background: bg }}
                      data-tip={`${p.name} · ${b} · ${formatValue(v)}`}
                    >
                      {v > 0 ? formatValue(v) : '—'}
                    </span>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════
   RwaCreditTab
   ══════════════════════════════════════════ */

export default function RwaCreditTab({
  protocols,
  tvlHistory,
  loading,
  dayMode,
  onAssetOpen,
}) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const formatValue = (v) => (v == null || v === 0 ? '--' : fmtLargeShort(v))

  /* ── Slicer axis definitions (Credit). Built inside the component so labels
     re-evaluate on language change. */
  const SLICER_AXES = useMemo(() => ({
    type: [
      { id: 'all', label: t('tokenizedAssets.tabs.credit.types.all', 'All') },
      { id: 'sme', label: t('tokenizedAssets.tabs.credit.types.sme', 'SME Lending') },
      { id: 'real_estate', label: t('tokenizedAssets.tabs.credit.types.realEstate', 'Real Estate Debt') },
      { id: 'trade_finance', label: t('tokenizedAssets.tabs.credit.types.tradeFinance', 'Trade Finance') },
      { id: 'supply_chain', label: t('tokenizedAssets.tabs.credit.types.supplyChain', 'Supply Chain') },
    ],
    metric: [
      { id: 'tvl', label: t('tokenizedAssets.tabs.credit.metric.tvl', 'TVL') },
      { id: 'loans', label: t('tokenizedAssets.tabs.credit.metric.loans', 'Active Loans') },
      { id: 'apy', label: t('tokenizedAssets.tabs.credit.metric.apy', 'APY') },
    ],
    grouping: [
      { id: 'platform', label: t('tokenizedAssets.tabs.credit.grouping.platform', 'Platform') },
      { id: 'chain', label: t('tokenizedAssets.tabs.credit.grouping.chain', 'Chain') },
      { id: 'borrower', label: t('tokenizedAssets.tabs.credit.grouping.borrower', 'Borrower Type') },
    ],
  }), [t])

  const [slicer, setSlicer] = useState({ type: 'all', metric: 'tvl', grouping: 'platform' })
  const [tf, setTf] = useState('1Y')

  /* ── Filter credit-only protocols ── */
  const creditProtocols = useMemo(() => {
    if (!protocols?.length) return []
    return protocols.filter(isCreditProtocol)
  }, [protocols])

  /* ── Apply slicer type filter on top of credit universe ── */
  const filteredProtocols = useMemo(() => {
    if (slicer.type === 'all') return creditProtocols
    const wantType = SLICER_AXES.type.find(t => t.id === slicer.type)?.label
    return creditProtocols.filter(p => inferCreditType(p.name) === wantType)
  }, [creditProtocols, slicer.type])

  /* ── KPIs ── */
  const kpis = useMemo(() => {
    const totalTvl = creditProtocols.reduce((s, p) => s + (p.tvl || 0), 0)
    const change30d = weightedChange(creditProtocols, 'change_30d')
    const protocolCount = creditProtocols.length
    const largest = [...creditProtocols].sort((a, b) => (b.tvl || 0) - (a.tvl || 0))[0]

    let spark = []
    if (tvlHistory?.series?.length) {
      spark = tvlHistory.series.slice(-30).map(pt => pt.Credit || 0)
    }

    return [
      { label: t('tokenizedAssets.tabs.credit.kpis.totalTvl', 'Total Credit TVL'), value: totalTvl, format: 'currency', delta: change30d, spark },
      { label: t('tokenizedAssets.tabs.credit.kpis.change30d', '30D Change'), value: change30d, format: 'raw', delta: null },
      { label: t('tokenizedAssets.tabs.credit.kpis.protocolCount', 'Protocol Count'), value: protocolCount, format: 'count' },
      {
        label: t('tokenizedAssets.tabs.credit.kpis.largestLender', 'Largest Lender'),
        value: largest?.name ? `${largest.name} · ${formatValue(largest.tvl || 0)}` : '--',
        format: 'raw',
        delta: null,
      },
    ]
  }, [creditProtocols, tvlHistory, t])

  /* ── Hero chart data (stacked area by protocol) ── */
  const chartData = useMemo(() => {
    const empty = { series: [], categories: [], colors: {} }
    if (!tvlHistory?.protocolSeries) return empty

    const creditProtos = Object.entries(tvlHistory.protocolSeries)
      .filter(([, v]) => v.category === 'Credit')
      .sort((a, b) => (b[1].currentTvl || 0) - (a[1].currentTvl || 0))
      .slice(0, 8)

    if (!creditProtos.length) {
      if (!tvlHistory?.series?.length) return empty
      return {
        series: tvlHistory.series.map(p => ({ date: p.date, Credit: p.Credit || 0 })),
        categories: ['Credit'],
        colors: { Credit: TA_CATEGORICAL[1] },
      }
    }

    const categories = creditProtos.map(([, v]) => v.name)
    const colors = {}
    categories.forEach((c, i) => { colors[c] = TA_CATEGORICAL[i % TA_CATEGORICAL.length] })

    const dateMap = {}
    for (const [, proto] of creditProtos) {
      const sd = [...proto.data].sort((a, b) => a.date - b.date)
      for (const pt of sd) {
        const dayKey = Math.floor(pt.date / 86400) * 86400
        if (!dateMap[dayKey]) dateMap[dayKey] = { date: dayKey }
        dateMap[dayKey][proto.name] = pt.tvl
      }
    }

    let series = Object.values(dateMap).sort((a, b) => a.date - b.date)
    const last = {}
    series = series.map(pt => {
      const filled = { date: pt.date }
      for (const c of categories) {
        if (pt[c] != null) last[c] = pt[c]
        filled[c] = pt[c] ?? last[c] ?? 0
      }
      return filled
    })

    return { series, categories, colors }
  }, [tvlHistory])

  /* ── Top lenders bars ── */
  const topLenders = useMemo(() => {
    if (!creditProtocols.length) return []
    return [...creditProtocols]
      .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
      .slice(0, 8)
      .map((p, i) => ({
        label: p.name,
        value: p.tvl || 0,
        color: TA_CATEGORICAL[i % TA_CATEGORICAL.length],
        slug: p.slug,
      }))
  }, [creditProtocols])

  /* ── Chain breakdown bars ── */
  const chainBars = useMemo(() => {
    const m = {}
    for (const p of creditProtocols) {
      const chains = Array.isArray(p.chains) && p.chains.length ? p.chains : (p.chain ? [p.chain] : ['Unknown'])
      // Attribute full TVL to first chain (approximation — same as Overview tab)
      const c = chains[0] || 'Unknown'
      m[c] = (m[c] || 0) + (p.tvl || 0)
    }
    return Object.entries(m)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map((c, i) => ({ ...c, color: TA_CATEGORICAL[i % TA_CATEGORICAL.length] }))
  }, [creditProtocols])

  /* ── League rows ── */
  const leagueRows = useMemo(() => {
    if (!filteredProtocols.length) return []
    return [...filteredProtocols]
      .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
      .map((p, i) => ({
        rank: i + 1,
        name: p.name,
        slug: p.slug || (p.name || '').toLowerCase().replace(/\s+/g, '-'),
        logo: `https://icons.llama.fi/protocols/${p.slug || (p.name || '').toLowerCase().replace(/\s+/g, '-')}`,
        creditType: inferCreditType(p.name),
        tvl: p.tvl || 0,
        change_7d: p.change_7d ?? null,
        change_30d: p.change_30d ?? null,
        chains: Array.isArray(p.chains) ? p.chains.join(', ') : (p.chain || '--'),
      }))
  }, [filteredProtocols])

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
      label: t('tokenizedAssets.tabs.credit.table.protocol', 'Protocol'),
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
    {
      key: 'creditType',
      label: t('tokenizedAssets.table.type', 'Type'),
      sortable: false,
      render: (v) => <span className="ta-table-cat ta-credit-type-pill">{v}</span>,
    },
    { key: 'tvl', label: t('tokenizedAssets.table.tvl', 'TVL'), align: 'right', format: 'currency' },
    { key: 'change_7d', label: t('tokenizedAssets.table.change7d', '7D'), align: 'right', format: 'delta', deltaLabel: '7D' },
    { key: 'change_30d', label: t('tokenizedAssets.table.change30d', '30D'), align: 'right', format: 'delta', deltaLabel: '30D' },
    {
      key: 'chains',
      label: t('tokenizedAssets.table.chains', 'Chains'),
      align: 'left',
      sortable: false,
      render: (v) => <span className="ta-table-chains">{v || '--'}</span>,
    },
  ], [t])

  const handleRowClick = useCallback((row) => {
    const slug = row.slug || (row.name || '').toLowerCase().replace(/\s+/g, '-')
    onAssetOpen?.(slug)
  }, [onAssetOpen])

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  return (
    <div className="ta-tab-content rwa-tab-content">
      {/* 1. KPI strip */}
      <div className="ta-kpi-strip">
        {kpis.map((k, i) => (
          <KpiCard
            key={k.label}
            hero={i === 0}
            label={k.label}
            value={k.format === 'raw' && typeof k.value === 'number' && k.value != null
              ? `${k.value >= 0 ? '+' : ''}${k.value.toFixed(2)}%`
              : k.value}
            format={k.format === 'raw' ? 'raw' : k.format}
            delta={k.delta}
            deltaLabel="30D"
            spark={k.spark}
            loading={loading && !k.value}
          />
        ))}
      </div>

      {/* 2. AI Analysis */}
      <AIAnalysisCard topic="credit" />

      {/* 3. Hero split — 50% chart / 50% Risk Radar */}
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
            {slicer.type !== 'all' && (
              <span className="ta-estimated-note">{t('tokenizedAssets.tabs.credit.typeFilterEstimated', 'Type filter is estimated from protocol names — backend enrichment pending')}</span>
            )}
            <RwaInteractiveChart
              title={t('tokenizedAssets.tabs.credit.chartTitle', 'Private Credit TVL')}
              series={chartData.series}
              categories={chartData.categories}
              colors={chartData.colors}
              loading={loading || !tvlHistory}
              height={isMobile ? 220 : 280}
              defaultTimeframe={tf}
              showModeToggle={false}
            />
          </div>
        )}
        creative={<CreditRiskRadar protocols={creditProtocols} loading={loading} />}
      />

      {/* 4. Two-up — top lenders + chain breakdown (glass-framed) */}
      <div className="ta-two-up cr-two-up">
        <div className="ta-glass-card ta-glass-card--quiet ta-glass-card--pad cr-panel">
          <RwaHorizontalBars
            title={t('tokenizedAssets.tabs.credit.topLenders', 'Top Lenders')}
            subtitle={t('tokenizedAssets.tabs.credit.protocolsCount', '{{count}} protocols', { count: creditProtocols.length })}
            items={topLenders}
            maxItems={8}
            onRowClick={(item) => onAssetOpen?.(item.slug || item.label.toLowerCase().replace(/\s+/g, '-'))}
          />
          {!loading && !topLenders.length && (
            <RwaEmptyState
              framed={false}
              title={t('tokenizedAssets.tabs.credit.lendersEmptyTitle', 'No lenders yet')}
              copy={t('tokenizedAssets.tabs.credit.lendersEmptyCopy', 'Lender rankings appear once protocol TVL is live.')}
            />
          )}
        </div>
        <div className="ta-glass-card ta-glass-card--quiet ta-glass-card--pad cr-panel">
          <RwaHorizontalBars
            title={t('tokenizedAssets.tabs.credit.chainBreakdown', 'Chain Breakdown')}
            subtitle={t('tokenizedAssets.tabs.credit.byTvl', 'by TVL')}
            items={chainBars}
            maxItems={10}
          />
          {!loading && !chainBars.length && (
            <RwaEmptyState
              framed={false}
              title={t('tokenizedAssets.tabs.credit.chainsEmptyTitle', 'No chain data')}
              copy={t('tokenizedAssets.tabs.credit.chainsEmptyCopy', 'Chain attribution appears once protocol chains are reported.')}
            />
          )}
        </div>
      </div>

      {/* 5. Full league table */}
      <div className="ta-section">
        <div className="ta-section-head">
          <h3 className="ta-section-title">{t('tokenizedAssets.tabs.credit.creditProtocols', 'Credit Protocols')}</h3>
          <span className="ta-section-count">{filteredProtocols.length}</span>
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

      {/* 6. Asset-class widget — Vintage Heatmap */}
      <VintageHeatmap protocols={creditProtocols} loading={loading} />
    </div>
  )
}
