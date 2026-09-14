/* ═══════════════════════════════════════════════
   Tokenized-Assets — shared category-lane builder.
   Extracted from rwa-active-mcap-chart.jsx so the Overview hero's
   "By Class" mode and the Active Mcap chart share one source of truth
   for category labels, source selection and lane ranking.
   ═══════════════════════════════════════════════ */
import { taColor, TA_CAT_OTHER, TA_CAT_OTHER_DAY } from './ta-tokens'

/* ── Display labels (proprietary categorisation) ──
 * Charts accept two source shapes:
 *   (1) Legacy `tvlHistory` — 4 DefiLlama-derived categories (Treasuries,
 *       Credit, Commodities, Other RWA).
 *   (2) Phase 2 `breakdownHistory` — 12-category issuer-direct schema
 *       (us-treasury-debt, asset-backed-credit, …, commodities).
 */
export const DISPLAY_LABEL = {
  // Legacy 4-category
  Treasuries: 'Bonds & Treasuries',
  Credit: 'Private Credit',
  Commodities: 'Precious Metals',
  'Other RWA': 'Other RWA',
  // Phase 2: 12-category schema slugs
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
  // Phase 3: 12 new slugs (mirrors rwa-class-allocation.jsx)
  'public-equities':          'Public Equities',
  'equity-etfs':              'Equity ETFs',
  'equity-indices':           'Equity Indices',
  'digital-assets':           'Digital Assets',
  'reinsurance':              'Reinsurance',
  'carbon-credits':           'Carbon Credits',
  'industrial-metals':        'Industrial Metals',
  'oil':                      'Oil & Gas',
  'multi-asset-rwa':          'Multi-Asset RWA',
  'commodity-baskets':        'Commodity Baskets',
  'agricultural-commodities': 'Agricultural Commodities',
  'rwa-perps-oi':             'RWA Perps OI',
}

/* Source decision: Phase 2 breakdownHistory wins when it has 8+ categories */
export function shouldUseBreakdown(breakdownHistory) {
  const cats = breakdownHistory?.categories
  if (!Array.isArray(cats) || !breakdownHistory?.series?.length) return false
  return cats.length >= 8
}

/* ── Categories + remap ──
 * When there are more than TOP_N positive lanes, roll the long tail into a
 * single "Other" lane so charts and tooltips don't become walls of
 * micro-slivers. Ranking is by the lane's value at the latest point.
 * Returns { lanes: [{ key, color }], baseSeries: [{ date, [label]: v }] }.
 */
export function buildLanes({ tvlHistory, breakdownHistory, dayMode = false, topN = 8 }) {
  const src = shouldUseBreakdown(breakdownHistory) ? breakdownHistory : tvlHistory
  if (!src?.series?.length) return { lanes: [], baseSeries: [] }
  const srcCats = src.categories || []
  const cats = srcCats.map(c => DISPLAY_LABEL[c] || c)
  const reverseMap = Object.fromEntries(srcCats.map(c => [DISPLAY_LABEL[c] || c, c]))
  const baseSeries = src.series.map(pt => {
    const row = { date: pt.date }
    for (const c of cats) row[c] = pt[reverseMap[c]] || 0
    return row
  })
  const last = baseSeries[baseSeries.length - 1] || {}
  const ranked = cats
    .map(c => ({ key: c, latest: last[c] || 0 }))
    .sort((a, b) => b.latest - a.latest)
  const top = ranked.slice(0, topN).map(r => r.key)
  const tail = ranked.slice(topN).map(r => r.key).filter(k => (last[k] || 0) > 0)
  let lanes
  if (tail.length === 0) {
    // Value-ranked + canonical TA_CATEGORICAL by index, so lane colours match
    // the Class Allocation donut (also value-sorted) across the tab.
    lanes = ranked.map((r, i) => ({ key: r.key, color: taColor(i, dayMode) }))
  } else {
    for (const row of baseSeries) {
      let sum = 0
      for (const k of tail) sum += row[k] || 0
      row['Other'] = sum
    }
    lanes = [
      ...top.map((c, i) => ({ key: c, color: taColor(i, dayMode) })),
      { key: 'Other', color: dayMode ? TA_CAT_OTHER_DAY : TA_CAT_OTHER },
    ]
  }
  return { lanes, baseSeries }
}
