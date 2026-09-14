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
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import './platforms.css'

function truncate(str, len) {
  if (!str) return '--'
  return str.length > len ? str.slice(0, len) + '...' : str
}

function classOfProtocol(p) {
  const cls = classifyProtocol(p)
  if (cls === 'Treasuries') return 'treasury'
  if (cls === 'Credit') return 'credit'
  if (cls === 'Commodities') return 'commodities'
  return 'multi'
}

function slugFor(p) {
  return p.slug || (p.name || '').toLowerCase().replace(/\s+/g, '-')
}

function logoFor(p) {
  return `https://icons.llama.fi/protocols/${slugFor(p)}`
}

/* Asset-class → categorical color (matches PlatformClassMix legend). */
const CLASS_COLOR = {
  Treasuries: TA_CATEGORICAL[0],
  Credit: TA_CATEGORICAL[1],
  Commodities: TA_CATEGORICAL[2],
  'Other RWA': 'var(--ta-cat-other)',
}
function colorForClass(cls) {
  return CLASS_COLOR[cls] || 'var(--ta-cat-other)'
}

function blurbFor(p, t) {
  const name = p.name || t('tokenizedAssets.creatives.issuerSpotlight.thisPlatform', 'This platform')
  const cls = classifyProtocol(p).toLowerCase()
  if (cls.includes('treasur')) {
    return t('tokenizedAssets.creatives.issuerSpotlight.blurbTreasury',
      'Tokenized US Treasury product by {{name}} — institutional short-duration fixed income on-chain.', { name })
  }
  if (cls.includes('credit')) {
    return t('tokenizedAssets.creatives.issuerSpotlight.blurbCredit',
      'Private-credit platform issuing institutional lending pools on-chain with {{name}}-grade underwriting.', { name })
  }
  if (cls.includes('commod')) {
    return t('tokenizedAssets.creatives.issuerSpotlight.blurbCommod',
      '{{name}} brings physical commodities on-chain with custodian-backed reserves.', { name })
  }
  return t('tokenizedAssets.creatives.issuerSpotlight.blurbDefault',
    '{{name}} operates across multiple asset classes with institutional-grade tokenization.', { name })
}

function Delta({ value, withLabel }) {
  const { t } = useTranslation()
  if (value == null) return null
  const dir = value > 0.005 ? 'is-up' : value < -0.005 ? 'is-down' : 'is-flat'
  return (
    <span className={`mono ${withLabel ? 'plat-lead__delta' : 'plat-rail__delta'} ${dir}`}>
      {dir !== 'is-flat' && (
        <svg className="plat-delta-tri" viewBox="0 0 8 8" aria-hidden="true">
          <path d={dir === 'is-up' ? 'M4 1 L7 7 L1 7 Z' : 'M4 7 L1 1 L7 1 Z'} fill="currentColor" />
        </svg>
      )}
      {Math.abs(value).toFixed(2)}%{withLabel ? ` ${t('tokenizedAssets.creatives.issuerSpotlight.sevenDay', '7D')}` : ''}
    </span>
  )
}

/* Issuer logo with brand-color initial fallback. */
function IssuerLogo({ p, color, cls, fbCls }) {
  return (
    <>
      <img
        className={cls}
        src={logoFor(p)}
        alt=""
        loading="lazy"
        onError={(e) => {
          e.target.style.display = 'none'
          const sib = e.target.nextSibling
          if (sib) sib.style.display = 'inline-flex'
        }}
      />
      <span className={fbCls} style={{ display: 'none', background: color }}>
        {(p.name || '?')[0]}
      </span>
    </>
  )
}

/* ── Issuer Spotlight panel — lead card + contender rail, fills the hero
   right pane (replaces the sparse single-card carousel that left dead space). */
function IssuerSpotlightPanel({ protocols, totalTvl, loading, onAssetOpen }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmt = (v) => (v == null || !isFinite(v) || v === 0 ? '—' : fmtLargeShort(v))

  const featured = useMemo(() => protocols.slice(0, 6), [protocols])
  const lead = featured[0]
  const rail = featured.slice(1)
  const maxRailTvl = Math.max(1, ...rail.map((p) => p.tvl || 0))

  return (
    <div className="plat-spot">
      <div className="plat-spot__head">
        <span className="plat-spot__title">{t('tokenizedAssets.creatives.issuerSpotlight.title', 'Issuer Spotlight')}</span>
        <span className="plat-spot__sub">
          {t('tokenizedAssets.creatives.issuerSpotlight.featuredCount', '{{count}} featured', { count: featured.length })}
        </span>
      </div>

      {loading ? (
        <>
          <div className="plat-spot__skel-lead" />
          <div className="plat-rail">
            {[0, 1, 2, 3].map((i) => <div key={i} className="plat-spot__skel-row" />)}
          </div>
        </>
      ) : !lead ? (
        <RwaEmptyState
          framed
          title={t('tokenizedAssets.tabs.platforms.spotlightEmptyTitle', 'No issuers to feature')}
          copy={t('tokenizedAssets.tabs.platforms.spotlightEmptyCopy', 'Adjust the filters above to surface tokenization platforms.')}
        />
      ) : (
        <>
          {(() => {
            const leadCls = classifyProtocol(lead)
            const leadColor = colorForClass(leadCls)
            const share = totalTvl > 0 ? ((lead.tvl || 0) / totalTvl) * 100 : 0
            return (
              <button
                type="button"
                className="plat-lead"
                style={{ '--leadcolor': leadColor }}
                onClick={() => onAssetOpen?.(slugFor(lead))}
              >
                <div className="plat-lead__top">
                  <IssuerLogo p={lead} color={leadColor} cls="plat-lead__logo" fbCls="plat-lead__logo-fb" />
                  <div className="plat-lead__idents">
                    <span className="plat-lead__rank">
                      <span className="plat-lead__rank-dot" />
                      {t('tokenizedAssets.tabs.platforms.leadIssuer', 'Lead issuer')}
                    </span>
                    <span className="plat-lead__name">{lead.name}</span>
                  </div>
                  <span className="plat-lead__pill">{leadCls}</span>
                </div>

                <div className="plat-lead__metric">
                  <span className="plat-lead__metric-label">{t('tokenizedAssets.kpi.aum', 'AUM')}</span>
                  <span className="plat-lead__metric-val mono">{fmt(lead.tvl)}</span>
                  <Delta value={lead.change_7d} withLabel />
                </div>

                <div className="plat-lead__share">
                  <div className="plat-lead__share-meta">
                    <span>{t('tokenizedAssets.tabs.platforms.marketShare', 'Market share')}</span>
                    <span><b className="mono">{share.toFixed(1)}%</b></span>
                  </div>
                  <div className="plat-lead__share-track">
                    <span className="plat-lead__share-fill" style={{ width: `${Math.min(100, Math.max(2, share))}%` }} />
                  </div>
                </div>

                <p className="plat-lead__blurb">{blurbFor(lead, t)}</p>
              </button>
            )
          })()}

          {rail.length > 0 && (
            <div className="plat-rail">
              {rail.map((p, i) => {
                const cls = classifyProtocol(p)
                const color = colorForClass(cls)
                const w = Math.max(4, ((p.tvl || 0) / maxRailTvl) * 100)
                return (
                  <button
                    type="button"
                    key={slugFor(p)}
                    className="plat-rail__row"
                    style={{ '--rowcolor': color }}
                    onClick={() => onAssetOpen?.(slugFor(p))}
                  >
                    <span className="plat-rail__rank mono">{i + 2}</span>
                    <IssuerLogo p={p} color={color} cls="plat-rail__logo" fbCls="plat-rail__logo-fb" />
                    <span className="plat-rail__body">
                      <span className="plat-rail__name">{p.name}</span>
                      <span className="plat-rail__track">
                        <span className="plat-rail__fill" style={{ width: `${w}%` }} />
                      </span>
                    </span>
                    <span className="plat-rail__nums">
                      <span className="plat-rail__tvl mono">{fmt(p.tvl)}</span>
                      <Delta value={p.change_7d} />
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ── Top-5 Concentration Bar (stacked horizontal bar widget) ── */
function Top5ConcentrationBar({ protocols, loading }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const formatValue = (v) => (v == null || v === 0 ? '--' : fmtLargeShort(v))
  const segments = useMemo(() => {
    if (!protocols?.length) return []
    const total = protocols.reduce((s, p) => s + (p.tvl || 0), 0)
    if (total <= 0) return []
    const top5 = protocols.slice(0, 5)
    const othersTvl = protocols.slice(5).reduce((s, p) => s + (p.tvl || 0), 0)
    const segs = top5.map((p, i) => ({
      label: p.name,
      tvl: p.tvl || 0,
      pct: ((p.tvl || 0) / total) * 100,
      color: TA_CATEGORICAL[i % TA_CATEGORICAL.length],
    }))
    if (othersTvl > 0) {
      segs.push({
        label: t('tokenizedAssets.tabs.platforms.others', 'Others'),
        tvl: othersTvl,
        pct: (othersTvl / total) * 100,
        color: 'var(--ta-cat-other)',
      })
    }
    return segs
  }, [protocols, t])

  if (loading) {
    return (
      <div className="ta-widget">
        <div className="ta-widget-head">
          <span className="ta-widget-title">{t('tokenizedAssets.tabs.platforms.top5Title', 'Top-5 Concentration')}</span>
          <span className="ta-widget-sub">{t('tokenizedAssets.tabs.platforms.top5Sub', 'Leading platforms vs rest of market')}</span>
        </div>
        <div className="ta-widget-skel animate-shimmer" />
      </div>
    )
  }

  if (!segments.length) return null

  return (
    <div className="ta-widget">
      <div className="ta-widget-head">
        <span className="ta-widget-title">{t('tokenizedAssets.tabs.platforms.top5Title', 'Top-5 Concentration')}</span>
        <span className="ta-widget-sub">{t('tokenizedAssets.tabs.platforms.top5Sub', 'Leading platforms vs rest of market')}</span>
      </div>
      <div className="ta-conc">
        <div className="ta-conc-bar">
          {segments.map((s) => (
            <span
              key={s.label}
              className="ta-conc-seg ta-tip-host"
              style={{ width: `${s.pct}%`, background: s.color }}
              data-tip={`${s.label}: ${formatValue(s.tvl)} · ${s.pct.toFixed(1)}%`}
            />
          ))}
        </div>
        <div className="ta-conc-legend">
          {segments.map((s) => (
            <div key={s.label} className="ta-conc-legend-row">
              <span className="ta-conc-legend-dot" style={{ background: s.color }} />
              <span className="ta-conc-legend-name">{s.label}</span>
              <span className="ta-conc-legend-val mono">{formatValue(s.tvl)}</span>
              <span className="ta-conc-legend-pct mono">{s.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Platform asset-class mix (bar width scaled to max TVL, colored by class) ── */
function PlatformClassMix({ protocols, loading }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const formatValue = (v) => (v == null || v === 0 ? '--' : fmtLargeShort(v))
  const rows = useMemo(() => {
    if (!protocols?.length) return []
    const top = protocols.slice(0, 8)
    const maxTvl = Math.max(1, ...top.map(p => p.tvl || 0))
    return top.map((p) => {
      const cls = classifyProtocol(p)
      const tvl = p.tvl || 0
      // Width reflects this platform's TVL share of the TOP platform — not 100% for all.
      const widthPct = (tvl / maxTvl) * 100
      return {
        name: p.name,
        tvl,
        segs: [
          { cls, pct: widthPct, color: TA_CATEGORICAL[0] },
        ],
      }
    })
  }, [protocols])

  if (loading) {
    return (
      <div className="ta-widget ta-widget--tight">
        <div className="ta-widget-head">
          <span className="ta-widget-title">{t('tokenizedAssets.tabs.platforms.assetClassMix', 'Asset Class Mix')}</span>
          <span className="ta-widget-sub">{t('tokenizedAssets.tabs.platforms.perPlatform', 'per platform')}</span>
        </div>
        <div className="ta-widget-skel animate-shimmer" />
      </div>
    )
  }

  if (!rows.length) {
    return (
      <div className="ta-widget ta-widget--tight">
        <div className="ta-widget-head">
          <span className="ta-widget-title">{t('tokenizedAssets.tabs.platforms.assetClassMix', 'Asset Class Mix')}</span>
          <span className="ta-widget-sub">{t('tokenizedAssets.tabs.platforms.perPlatform', 'per platform')}</span>
        </div>
        <RwaEmptyState
          framed={false}
          title={t('tokenizedAssets.tabs.platforms.mixEmptyTitle', 'No platforms to classify')}
          copy={t('tokenizedAssets.tabs.platforms.mixEmptyCopy', 'Adjust the filters to see the asset-class breakdown.')}
        />
      </div>
    )
  }

  // Which classes are actually present → drive the legend.
  const legend = [
    { cls: 'Treasuries', label: t('tokenizedAssets.tabs.platforms.types.treasury', 'Treasury') },
    { cls: 'Credit', label: t('tokenizedAssets.tabs.platforms.types.credit', 'Credit') },
    { cls: 'Commodities', label: t('tokenizedAssets.tabs.platforms.types.commodities', 'Commodities') },
    { cls: 'Other RWA', label: t('tokenizedAssets.tabs.platforms.others', 'Others') },
  ].filter((l) => rows.some((r) => r.segs[0].cls === l.cls))

  return (
    <div className="ta-widget ta-widget--tight">
      <div className="ta-widget-head">
        <span className="ta-widget-title">{t('tokenizedAssets.tabs.platforms.assetClassMix', 'Asset Class Mix')}</span>
        <span className="ta-widget-sub">{t('tokenizedAssets.tabs.platforms.estimatedHeuristic', 'Estimated — heuristic classification')}</span>
      </div>
      <div className="plat-mix">
        {rows.map((r) => {
          const cls = r.segs[0].cls
          const color = colorForClass(cls)
          return (
            <div key={r.name} className="plat-mix__row">
              <span className="plat-mix__head">
                <span className="plat-mix__name">{truncate(r.name, 20)}</span>
                <span className="plat-mix__class">{cls}</span>
              </span>
              <span className="plat-mix__total mono">{formatValue(r.tvl)}</span>
              <span className="plat-mix__track">
                <span
                  className="plat-mix__fill ta-tip-host"
                  style={{ width: `${Math.max(2, r.segs[0].pct)}%`, '--segcolor': color }}
                  data-tip={`${cls}: ${formatValue(r.tvl)}`}
                />
              </span>
            </div>
          )
        })}
        {legend.length > 1 && (
          <div className="plat-mix__legend">
            {legend.map((l) => (
              <span key={l.cls} className="plat-mix__legend-item">
                <span className="plat-mix__legend-dot" style={{ background: colorForClass(l.cls) }} />
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Main Component ── */
export default function RwaPlatformsTab({ overview, protocols, tvlHistory, loading, onAssetOpen, onProtocolClick }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const formatValue = (v) => (v == null || v === 0 ? '--' : fmtLargeShort(v))

  /* ── Slicer axes (Platforms). Built in-component for language reactivity. */
  const SLICER_AXES = useMemo(() => ({
    type: [
      { id: 'all', label: t('tokenizedAssets.tabs.platforms.types.all', 'All') },
      { id: 'treasury', label: t('tokenizedAssets.tabs.platforms.types.treasury', 'Treasury') },
      { id: 'credit', label: t('tokenizedAssets.tabs.platforms.types.credit', 'Credit') },
      { id: 'commodities', label: t('tokenizedAssets.tabs.platforms.types.commodities', 'Commodities') },
      { id: 'multi', label: t('tokenizedAssets.tabs.platforms.types.multi', 'Multi-asset') },
    ],
    metric: [
      { id: 'tvl', label: t('tokenizedAssets.tabs.platforms.metric.tvl', 'TVL') },
      { id: 'flows', label: t('tokenizedAssets.tabs.platforms.metric.flows', 'Flows') },
      { id: 'inception', label: t('tokenizedAssets.tabs.platforms.metric.inception', 'Inception') },
    ],
    grouping: [
      { id: 'issuer', label: t('tokenizedAssets.tabs.platforms.grouping.issuer', 'Issuer') },
      { id: 'jurisdiction', label: t('tokenizedAssets.tabs.platforms.grouping.jurisdiction', 'Jurisdiction') },
      { id: 'regulatory', label: t('tokenizedAssets.tabs.platforms.grouping.regulatory', 'Regulatory Framework') },
    ],
  }), [t])

  const [slicer, setSlicer] = useState({ type: 'all', metric: 'tvl', grouping: 'issuer' })
  const [tf, setTf] = useState('1Y')

  const openAsset = useCallback((slug) => {
    if (onAssetOpen) onAssetOpen(slug)
    else if (onProtocolClick) onProtocolClick(slug)
  }, [onAssetOpen, onProtocolClick])

  /* ── Sorted protocols (desc by TVL) ── */
  const sortedProtocols = useMemo(() => {
    if (!protocols?.length) return []
    return [...protocols].sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
  }, [protocols])

  /* ── Filtered by slicer.type ── */
  const filtered = useMemo(() => {
    if (slicer.type === 'all') return sortedProtocols
    return sortedProtocols.filter(p => classOfProtocol(p) === slicer.type)
  }, [sortedProtocols, slicer.type])

  /* ── KPIs ── */
  const kpis = useMemo(() => {
    const total = sortedProtocols.length
    const top = sortedProtocols[0]
    const topLabel = top ? `${top.name} · ${formatValue(top.tvl)}` : '--'
    const over100M = sortedProtocols.filter(p => (p.tvl || 0) >= 1e8).length
    const totalTvl = sortedProtocols.reduce((s, p) => s + (p.tvl || 0), 0)
    const top5Tvl = sortedProtocols.slice(0, 5).reduce((s, p) => s + (p.tvl || 0), 0)
    const concentration = totalTvl > 0 ? (top5Tvl / totalTvl) * 100 : 0
    return [
      { label: t('tokenizedAssets.tabs.platforms.kpis.totalPlatforms', 'Total Platforms'), value: total, format: 'count' },
      { label: t('tokenizedAssets.tabs.platforms.kpis.topPlatform', 'Top Platform'), value: topLabel, format: 'raw' },
      { label: t('tokenizedAssets.tabs.platforms.kpis.over100m', '> $100M TVL'), value: over100M, format: 'count' },
      { label: t('tokenizedAssets.tabs.platforms.kpis.top5Concentration', 'Top-5 Concentration'), value: `${concentration.toFixed(1)}%`, format: 'raw' },
    ]
  }, [sortedProtocols, t])

  /* ── Hero chart: stacked area by top platforms over time ──
     Strategy:
       1. If we have a real protocolSeries from /api/rwa/tvl-history AND it
          has matching protocols, build a real time-series from it.
       2. Otherwise (or if real series is empty after filtering) fall back to
          a synthetic decay curve anchored to the current TVL of the top 8.
       The synthetic fallback ALWAYS produces a chart as long as `filtered`
       has at least one platform — so we never sit on a permanent spinner. */
  const buildSyntheticSeries = (top) => {
    if (!top.length) return { series: [], categories: [], colors: {} }
    const cats = top.map(p => p.name)
    const colors = {}
    cats.forEach((c, i) => { colors[c] = TA_CATEGORICAL[i % TA_CATEGORICAL.length] })
    const now = Math.floor(Date.now() / 1000)
    const days = 365
    const points = []
    for (let i = days; i >= 0; i -= 7) {
      const decay = 1 - (i / days) * 0.35
      const pt = { date: now - i * 86400 }
      top.forEach(p => { pt[p.name] = (p.tvl || 0) * decay })
      points.push(pt)
    }
    return { series: points, categories: cats, colors, _synthetic: true }
  }

  const chartData = useMemo(() => {
    const topN = filtered.slice(0, 8)

    // Real-history path. Falls through to synthetic if no matching protocols.
    if (tvlHistory?.protocolSeries && filtered.length) {
      const allowed = new Set(filtered.map(p => p.slug || p.name))
      const protoEntries = Object.entries(tvlHistory.protocolSeries)
        .filter(([, v]) => allowed.has(v.slug) || allowed.has(v.name))
        .sort((a, b) => (b[1].currentTvl || 0) - (a[1].currentTvl || 0))
        .slice(0, 8)

      if (protoEntries.length) {
        const categories = protoEntries.map(([, v]) => v.name)
        const colors = {}
        protoEntries.forEach(([, v], i) => {
          colors[v.name] = TA_CATEGORICAL[i % TA_CATEGORICAL.length]
        })

        const dateMap = {}
        for (const [, proto] of protoEntries) {
          const sorted = [...(proto.data || [])].sort((a, b) => a.date - b.date)
          for (const point of sorted) {
            const dayKey = Math.floor(point.date / 86400) * 86400
            if (!dateMap[dayKey]) dateMap[dayKey] = { date: dayKey }
            dateMap[dayKey][proto.name] = point.tvl
          }
        }

        let series = Object.values(dateMap).sort((a, b) => a.date - b.date)
        const lastKnown = {}
        series = series.map(point => {
          const filledPt = { date: point.date }
          for (const cat of categories) {
            if (point[cat] != null) lastKnown[cat] = point[cat]
            filledPt[cat] = point[cat] ?? lastKnown[cat] ?? 0
          }
          return filledPt
        })

        if (series.length) return { series, categories, colors }
      }
    }

    // Fallback: synthetic decay from current TVL.
    return buildSyntheticSeries(topN)
  }, [tvlHistory, filtered])

  /* ── Top platforms bars ── */
  const topPlatformBars = useMemo(() => {
    return filtered.slice(0, 10).map((p, i) => ({
      label: p.name,
      value: p.tvl || 0,
      color: TA_CATEGORICAL[i % TA_CATEGORICAL.length],
      slug: p.slug || (p.name || '').toLowerCase().replace(/\s+/g, '-'),
    }))
  }, [filtered])

  /* ── League rows ── */
  const totalTvl = useMemo(
    () => filtered.reduce((s, p) => s + (p.tvl || 0), 0),
    [filtered]
  )

  const leagueRows = useMemo(() => {
    if (!filtered.length) return []
    return filtered.map((p, i) => ({
      id: p.slug || p.name,
      rank: i + 1,
      name: p.name,
      slug: p.slug || (p.name || '').toLowerCase().replace(/\s+/g, '-'),
      logo: `https://icons.llama.fi/protocols/${p.slug || (p.name || '').toLowerCase().replace(/\s+/g, '-')}`,
      primaryClass: classifyProtocol(p),
      tvl: p.tvl || 0,
      share: p.tvl || 0,
      change_7d: p.change_7d ?? null,
      change_30d: p.change_30d ?? null,
      chainCount: (p.chains || []).length,
      inception: p.inception_year || '--',
    }))
  }, [filtered])

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
      label: t('tokenizedAssets.tabs.platforms.table.platform', 'Platform'),
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
      key: 'primaryClass',
      label: t('tokenizedAssets.tabs.platforms.table.primaryClass', 'Primary Class'),
      sortable: false,
      render: (v) => <span className="ta-table-cat">{v}</span>,
    },
    { key: 'tvl', label: t('tokenizedAssets.table.tvl', 'TVL'), align: 'right', format: 'currency' },
    { key: 'share', label: t('tokenizedAssets.tabs.platforms.table.share', 'Share'), align: 'right', format: 'share' },
    { key: 'change_7d', label: t('tokenizedAssets.table.change7d', '7D'), align: 'right', format: 'delta', deltaLabel: '7D' },
    { key: 'change_30d', label: t('tokenizedAssets.table.change30d', '30D'), align: 'right', format: 'delta', deltaLabel: '30D' },
    { key: 'chainCount', label: t('tokenizedAssets.table.chains', 'Chains'), align: 'right', format: 'count' },
    {
      key: 'inception',
      label: t('tokenizedAssets.tabs.platforms.table.inception', 'Inception'),
      align: 'right',
      sortable: false,
      render: (v) => <span className="mono ta-table-muted">{v || '--'}</span>,
    },
  ], [t])

  const handleRowClick = useCallback((row) => {
    const slug = row.slug || (row.name || '').toLowerCase().replace(/\s+/g, '-')
    openAsset(slug)
  }, [openAsset])

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
            value={k.value}
            format={k.format}
            loading={loading && (k.value == null || k.value === '--')}
          />
        ))}
      </div>

      {/* 2. AI Analysis */}
      <AIAnalysisCard topic="platforms" />

      {/* 3. Hero split — 50% chart / 50% Issuer Spotlight */}
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
              title={t('tokenizedAssets.tabs.platforms.chartTitle', 'Top Platforms TVL')}
              series={chartData.series}
              categories={chartData.categories}
              colors={chartData.colors}
              loading={loading && !chartData.series.length}
              height={isMobile ? 220 : 280}
              defaultTimeframe={tf}
              showModeToggle={false}
            />
            {chartData._synthetic && chartData.series.length > 0 && (
              <span className="ta-estimated-note">{t('tokenizedAssets.tabs.platforms.estimatedCurve', 'Estimated curve — anchored to current TVL (full per-protocol history pending)')}</span>
            )}
          </div>
        )}
        creative={
          <IssuerSpotlightPanel
            protocols={filtered}
            totalTvl={totalTvl}
            loading={loading && !filtered.length}
            onAssetOpen={openAsset}
          />
        }
      />

      {/* 4. Two-up: leaderboard bars | asset-class mix */}
      <div className="ta-two-up">
        <RwaHorizontalBars
          title={t('tokenizedAssets.tabs.platforms.leaderboard', 'Platform Leaderboard')}
          subtitle={t('tokenizedAssets.tabs.platforms.platformsCount', '{{count}} platforms', { count: filtered.length })}
          items={topPlatformBars}
          maxItems={10}
          onRowClick={(item) => openAsset(item.slug)}
        />
        <PlatformClassMix protocols={filtered} loading={loading} />
      </div>

      {/* 5. Full league table */}
      <div className="ta-section">
        <div className="ta-section-head">
          <h3 className="ta-section-title">{t('tokenizedAssets.tabs.platforms.allPlatforms', 'All Platforms')}</h3>
          <span className="ta-section-count">{filtered.length}</span>
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

      {/* 6. Top-5 Concentration Bar */}
      <Top5ConcentrationBar protocols={sortedProtocols} loading={loading} />
    </div>
  )
}
