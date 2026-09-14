/* ═══════════════════════════════════════════════
   Tokenized-Assets — shared JS tokens.
   The categorical palette lives in CSS vars (--ta-cat-*).
   These constants mirror them for use in canvas contexts.
   ═══════════════════════════════════════════════ */

// Ordered categorical palette (matches --ta-cat-N in tokenized-assets-page.css).
// Every donut / stack / legend pulls in this order.
//
export const TA_CATEGORICAL = [
  '#06B6D4', // 1 cyan
  '#10B981', // 2 bull
  '#F59E0B', // 3 amber
  '#3B82F6', // 4 blue
  '#EC4899', // 5 pink
  '#A78BFA', // 6 violet
  '#34D399', // 7 bull-bright
  '#F87171', // 8 bear-bright
]

// Day-mode flavour — one notch darker per hue so the same palette reads on
// white instead of washing out (the only addition kept from the palette pass).
export const TA_CATEGORICAL_DAY = [
  '#0891B2',
  '#059669',
  '#B45309',
  '#2563EB',
  '#BE185D',
  '#7C3AED',
  '#059669',
  '#DC2626',
]

export const TA_CAT_OTHER = 'rgba(245, 245, 247, 0.20)'
export const TA_CAT_OTHER_DAY = 'rgba(15, 23, 42, 0.20)'

// Material-type colours for the Commodities tab — a DELIBERATE exception to
// TA_CATEGORICAL (physical-asset cues: gold is gold, silver is silver, etc.).
// Single source so the JS chart + CSS pills don't drift.
export const TA_MATERIAL_COLORS = {
  Gold:                '#F5B341', // warm gold
  Silver:              '#C0C8D6', // cool slate-silver
  Platinum:            '#E5E4E2', // off-white platinum
  Palladium:           '#D9CCB8', // warm metallic
  'Carbon Credits':    '#4ADE80', // green
  'Industrial Metals': '#94A3B8', // industrial gray-blue
  Petroleum:           '#1F2937', // crude-dark
  Agricultural:        '#F59E0B', // amber (grain)
  Baskets:             '#5EEAD4', // teal (mixed) — no violet
  Unclassified:        '#64748B', // muted slate (data-quality flag)
}

export function taColor(i, isDay = false) {
  if (i == null || i < 0) return isDay ? TA_CAT_OTHER_DAY : TA_CAT_OTHER
  const ramp = isDay ? TA_CATEGORICAL_DAY : TA_CATEGORICAL
  return ramp[i % ramp.length]
}

// Assign colors in order to an array of labels.
export function assignPalette(labels) {
  return labels.map((label, i) => ({ label, color: taColor(i) }))
}

// Timeframe options for TimeframePills.
export const TA_TIMEFRAMES = [
  { id: '7D', days: 7 },
  { id: '30D', days: 30 },
  { id: '90D', days: 90 },
  { id: '1Y', days: 365 },
  { id: 'All', days: Infinity },
]

export function filterByTimeframe(series, tfId, dateKey = 'date') {
  if (!series?.length || tfId === 'All') return series
  const tf = TA_TIMEFRAMES.find(t => t.id === tfId)
  if (!tf) return series
  const cutoff = (Date.now() / 1000) - (tf.days * 86400)
  return series.filter(p => p[dateKey] >= cutoff)
}
