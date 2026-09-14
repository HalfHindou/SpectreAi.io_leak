import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { taColor, TA_CAT_OTHER, TA_CAT_OTHER_DAY } from './shared/ta-tokens'

/**
 * RwaClassAllocation
 * Donut + legend list of asset-class share of total RWA value.
 *
 * Donut technique: SVG <circle> rings stacked at the same cx/cy with
 * stroke-dasharray = (slice% of circumference) and stroke-dashoffset
 * advancing cumulatively per slice. No third-party charting needed.
 *
 * Data source preference (Phase 2):
 *   1. `breakdown` prop — issuer-direct, full 12-category schema (preferred
 *      when present and has 8+ categories).
 *   2. `tvlHistory.series[last]` — legacy 4-category DefiLlama derivation.
 *
 * Props:
 *   breakdown:  { categories: [{ slug, name, aum_usd, share_pct }], total_aum_usd }
 *   tvlHistory: { categories, series }
 *   overview:   { totalTvl }
 *   loading: boolean
 *   onSeeAll?: () => void
 */

// Legacy 4-category labels (DefiLlama tvlHistory shape).
const DISPLAY_LABEL = {
  Treasuries: 'Bonds & Treasuries',
  Credit: 'Private Credit',
  Commodities: 'Precious Metals',
  'Other RWA': 'Other RWA',
}
// Phase 2: 12-category schema slugs from /v1/rwa/breakdown.
// Phase 3: extended to 24 slugs (8 new, 4 mapped from existing palette).
const BREAKDOWN_LABEL = {
  // Phase 2 — original 12
  'us-treasury-debt':       'US Treasury Debt',
  'non-us-government-debt': 'non-US Gov Debt',
  'asset-backed-credit':    'Asset-Backed Credit',
  'specialty-finance':      'Specialty Finance',
  'corporate-credit':       'Corporate Credit',
  'diversified-credit':     'Diversified Credit',
  'stocks':                 'Stocks',
  'active-strategies':      'Active Strategies',
  'venture-capital':        'Venture Capital',
  'private-equity':         'Private Equity',
  'real-estate':            'Real Estate',
  'commodities':            'Commodities',
  // Phase 3 — 12 new slugs
  'public-equities':         'Public Equities',
  'equity-etfs':             'Equity ETFs',
  'equity-indices':          'Equity Indices',
  'digital-assets':          'Digital Assets',
  'reinsurance':             'Reinsurance',
  'carbon-credits':          'Carbon Credits',
  'industrial-metals':       'Industrial Metals',
  'oil':                     'Oil & Gas',
  'multi-asset-rwa':          'Multi-Asset RWA',
  'commodity-baskets':        'Commodity Baskets',
  'agricultural-commodities': 'Agricultural Commodities',
  'rwa-perps-oi':             'RWA Perps OI',
}
export default function RwaClassAllocation({ tvlHistory, overview, breakdown, loading, onSeeAll, dayMode = false }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtUsd = (v) => (v == null || !isFinite(v) ? '--' : fmtLargeShort(v))

  // Decide source: breakdown wins when it has 8+ categories with positive AUM.
  const useBreakdown = useMemo(() => {
    const cats = breakdown?.categories
    if (!Array.isArray(cats)) return false
    return cats.filter(c => Number(c.aum_usd) > 0).length >= 8
  }, [breakdown])

  const slices = useMemo(() => {
    if (useBreakdown) {
      return (breakdown.categories || [])
        .map(c => {
          const label = BREAKDOWN_LABEL[c.slug] || c.name || c.slug
          return {
            key: label,
            value: Number(c.aum_usd) || 0,
          }
        })
        .filter(s => s.value > 0)
        .sort((a, b) => b.value - a.value)
    }
    // Legacy: derive from tvlHistory.series last point.
    const series = tvlHistory?.series || []
    const cats = tvlHistory?.categories || []
    if (!series.length || !cats.length) return []
    const last = series[series.length - 1]
    return cats.map(c => {
      const label = DISPLAY_LABEL[c] || c
      return {
        key: label,
        value: last[c] || 0,
      }
    }).filter(s => s.value > 0).sort((a, b) => b.value - a.value)
  }, [useBreakdown, breakdown, tvlHistory])

  // Phase 4 (2026-05-08): when there are >8 slices, roll the long tail into
  // a single "Other" slice on the donut. The legend keeps every category at
  // its real value (top 8 + Other expanded as a tooltip on hover).
  const TOP_N = 8
  const displaySlices = useMemo(() => {
    if (slices.length <= TOP_N) return slices
    const top = slices.slice(0, TOP_N)
    const tail = slices.slice(TOP_N)
    const otherValue = tail.reduce((s, x) => s + x.value, 0)
    if (otherValue <= 0) return top
    return [
      ...top,
      {
        key: t('tokenizedAssets.classAllocation.other', 'Other'),
        value: otherValue,
        _other: true,
        _members: tail, // for hover tooltip
      },
    ]
  }, [slices, t])

  // For the breakdown source, the donut total IS the issuer-direct total —
  // do not rescale to overview.totalTvl (which is DefiLlama's denominator and
  // includes much more than the issuer-direct registry).
  const sliceSum = useMemo(() => slices.reduce((s, x) => s + x.value, 0), [slices])
  const total = useBreakdown
    ? (Number(breakdown?.total_aum_usd) || sliceSum)
    : (overview?.totalTvl ?? sliceSum)

  // Legacy mode only: rescale to match the global TVL total. Breakdown mode
  // keeps slices as-is. Operates on the rolled-up displaySlices so the donut
  // and legend always agree.
  const scaledSlices = useMemo(() => {
    if (useBreakdown) return displaySlices
    if (!sliceSum || !overview?.totalTvl || sliceSum === overview.totalTvl) return displaySlices
    const k = overview.totalTvl / sliceSum
    return displaySlices.map(s => ({ ...s, value: s.value * k }))
  }, [useBreakdown, displaySlices, sliceSum, overview])

  /* 2026-08-03: the donut became a full-width stacked bar. A 140px ring inside
     a 500px card left ~9% coverage and a dead lower half, and its centre
     repeated the hero's total verbatim. The stack reads share at a glance,
     fills the card width, and speaks the same language as the ranked bars in
     the neighbouring Chain Breakdown card. */
  const segments = useMemo(() => {
    if (!total) return []
    // Colour by final sorted index from the canonical TA_CATEGORICAL palette
    // (allocation IS categorical, so a categorical palette is correct here —
    // unlike a single-metric ranked list). "Other" gets the neutral colour.
    return scaledSlices.map((s, i) => ({
      ...s,
      color: s._other ? (dayMode ? TA_CAT_OTHER_DAY : TA_CAT_OTHER) : taColor(i, dayMode),
      share: s.value / total,
    }))
  }, [scaledSlices, total, dayMode])

  // Hover links stack <-> legend: highlight one slice, dim the rest, and swap
  // the lead readout to that slice.
  const [hoverKey, setHoverKey] = useState(null)
  const activeSlice = hoverKey ? segments.find(s => s.key === hoverKey) : null
  // Lead readout: the hovered slice, else the largest class. Deliberately NOT
  // the grand total — the hero already carries that number.
  const leadSlice = activeSlice || segments[0] || null

  if (loading && !slices.length) {
    return (
      <section className="rca">
        <header className="rca__head">
          <span className="rca__title">{t('tokenizedAssets.classAllocation.title', 'Asset Class Allocation')}</span>
        </header>
        <div className="rca__body">
          <div className="rca__lead-skel animate-shimmer" />
          <div className="rca__stack-skel animate-shimmer" />
          <div className="rca__legend">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={`rca__legend-skel animate-shimmer stagger-${(i % 5) + 1}`} />
            ))}
          </div>
        </div>
      </section>
    )
  }

  if (!slices.length) {
    return (
      <section className="rca rca--empty">
        <header className="rca__head">
          <span className="rca__title">{t('tokenizedAssets.classAllocation.title', 'Asset Class Allocation')}</span>
        </header>
        <div className="rca__empty">{t('tokenizedAssets.classAllocation.empty', 'No allocation data available.')}</div>
      </section>
    )
  }

  return (
    <section className="rca" aria-label={t('tokenizedAssets.classAllocation.title', 'Asset Class Allocation')}>
      <header className="rca__head">
        <span className="rca__title">{t('tokenizedAssets.classAllocation.title', 'Asset Class Allocation')}</span>
        <span className="rca__sub">{t('tokenizedAssets.classAllocation.subtitle', 'Share of total tokenized value')}</span>
      </header>

      {leadSlice && (
        <div className="rca__lead">
          <span className="rca__lead-label">
            {activeSlice ? activeSlice.key : t('tokenizedAssets.classAllocation.largestClass', '{{name}} leads', { name: leadSlice.key })}
          </span>
          <span className="rca__lead-row">
            <span className="rca__lead-val mono">{(leadSlice.share * 100).toFixed(1)}%</span>
            <span className="rca__lead-sub mono">{fmtUsd(leadSlice.value)}</span>
          </span>
        </div>
      )}

      <div
        className="rca__stack"
        role="img"
        aria-label={segments.map(s => `${s.key} ${(s.share * 100).toFixed(1)}%`).join(', ')}
      >
        {segments.map(s => (
          <span
            key={s.key}
            className={`rca__stack-seg${hoverKey && hoverKey !== s.key ? ' is-dim' : ''}`}
            style={{ width: `${s.share * 100}%`, background: s.color }}
            onMouseEnter={() => setHoverKey(s.key)}
            onMouseLeave={() => setHoverKey(null)}
          />
        ))}
      </div>

      <ul className="rca__legend">
        {segments.map(s => {
          // For the rolled-up "Other" slice, build a hover tooltip listing the
          // members so the user can still see what's inside without bloating
          // the donut. Native `title` keeps DOM small and works on touch via
          // long-press in iOS Safari.
          const otherTitle = s._other && Array.isArray(s._members)
            ? s._members
                .map(m => `${m.key}: ${fmtUsd(m.value)}`)
                .join('\n')
            : undefined
          return (
            <li
              key={s.key}
              className={`rca__legend-row${s._other ? ' rca__legend-row--other' : ''}${hoverKey === s.key ? ' is-hover' : ''}`}
              title={otherTitle}
              onMouseEnter={() => setHoverKey(s.key)}
              onMouseLeave={() => setHoverKey(null)}
            >
              <span className="rca__dot" style={{ background: s.color }} />
              <span className="rca__name">{s.key}</span>
              <span className="rca__share mono">{(s.share * 100).toFixed(1)}%</span>
              <span className="rca__val mono">{fmtUsd(s.value)}</span>
            </li>
          )
        })}
      </ul>

      {onSeeAll && (
        <button type="button" className="rca__cta" onClick={onSeeAll}>
          {t('tokenizedAssets.classAllocation.viewAll', 'View All Classes')} <span aria-hidden>&rarr;</span>
        </button>
      )}
    </section>
  )
}
