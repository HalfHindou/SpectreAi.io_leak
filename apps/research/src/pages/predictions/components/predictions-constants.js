/**
 * Predictions page constants
 *
 * Categories, chart intervals, colors, source identity, and formatting helpers.
 *
 * Display strings are keyed (i18n keys) - callers resolve via t(option.labelKey)
 * and call the currency-aware formatters with the user's fmtLargeShort so values
 * respect the active currency.
 */

// Category list. `id` is canonical (used by the grid filter logic) - do NOT
// translate. `labelKey` is the i18n key for the display; `defaultLabel` is the
// inline English fallback so new ids render without a locale-JSON edit.
//
// `finance` and `geopolitics` are the UI ids; the API/categorisers use
// `economy` and `politics` respectively - see CATEGORY_API_MAP below.
export const PREDICTION_CATEGORIES = [
  { id: 'trending',    labelKey: 'predictionsPage.categories.trending',    defaultLabel: 'Trending' },
  { id: 'crypto',      labelKey: 'predictionsPage.categories.crypto',      defaultLabel: 'Crypto' },
  { id: 'new',         labelKey: 'predictionsPage.categories.new',         defaultLabel: 'New' },
  { id: 'sports',      labelKey: 'predictionsPage.categories.sports',      defaultLabel: 'Sports' },
  { id: 'finance',     labelKey: 'predictionsPage.categories.finance',     defaultLabel: 'Finance' },
  { id: 'geopolitics', labelKey: 'predictionsPage.categories.geopolitics', defaultLabel: 'Geopolitics' },
  { id: 'science',     labelKey: 'predictionsPage.categories.science',     defaultLabel: 'Science' },
  { id: 'culture',     labelKey: 'predictionsPage.categories.culture',     defaultLabel: 'Culture' },
]

// The UI category id → the id the underlying APIs/categorisers actually emit.
// Polymarket's categoriser + Kalshi's mapCategory both emit `economy` and
// `politics` on each card; the editorial UI renames them to `finance`/
// `geopolitics`. usePredictionMarkets resolves a UI id through this map
// (apiCatFor) before filtering the cards, so the emitted id must stay `economy`/
// `politics` on BOTH venues or that venue's cards drop out of the tab.
export const CATEGORY_API_MAP = { finance: 'economy', geopolitics: 'politics' }

// Per-category headline + eyebrow copy. Editorial, specific, no hyperbole.
// `headlineKey`/`eyebrowKey` carry an i18n key; the inline strings are the
// English defaults (no locale-JSON edit required).
export const CATEGORY_COPY = {
  trending:    { eyebrow: 'Prediction Markets', headline: 'What the crowd is pricing.' },
  crypto:      { eyebrow: 'Crypto Predictions',  headline: "The market's bet on the market." },
  new:         { eyebrow: 'New Markets',         headline: 'Freshly listed. Not yet priced in.' },
  sports:      { eyebrow: 'Sports',              headline: 'Where the line meets the crowd.' },
  finance:     { eyebrow: 'Finance',             headline: 'Macro, priced by conviction.' },
  geopolitics: { eyebrow: 'Geopolitics',         headline: "The world's open questions." },
  science:     { eyebrow: 'Science & Tech',      headline: "Bets on what's next." },
  culture:     { eyebrow: 'Culture',             headline: 'The culture, as a probability.' },
  pulse:       { eyebrow: 'Social Pulse',        headline: 'What the timeline is moving.' },
}

// Chart interval buttons. Labels are short (1H, 1D, ALL) - kept in a key for
// completeness so locales can rename if needed.
export const CHART_INTERVALS = [
  { id: '1h',  labelKey: 'predictionsPage.intervals.1h',  fidelity: 1 },
  { id: '6h',  labelKey: 'predictionsPage.intervals.6h',  fidelity: 1 },
  { id: '1d',  labelKey: 'predictionsPage.intervals.1d',  fidelity: 5 },
  { id: '1w',  labelKey: 'predictionsPage.intervals.1w',  fidelity: 30 },
  { id: '1m',  labelKey: 'predictionsPage.intervals.1m',  fidelity: 180 },
  { id: 'all', labelKey: 'predictionsPage.intervals.all', fidelity: 720 },
]

// Used ONLY in the bubble-map legend + galaxy data-viz, never as card chrome.
// `finance`/`geopolitics` aliases resolve to the same hues as economy/politics.
export const CATEGORY_COLORS = {
  crypto: '#10B981',
  economy: '#3B82F6',
  finance: '#3B82F6',
  politics: '#EF4444',
  geopolitics: '#EF4444',
  sports: '#F59E0B',
  science: '#06B6D4',
  culture: '#EC4899',
  other: '#6B7280',
}

// Source identity hues — desaturated tints used ONLY on the source badge, the
// card image ring, and the arbitrage spotlight. Channels are space-separated so
// both `rgb(var(--src-hue))` and `rgb(... / a)` / color-mix work.
// Polymarket → cool slate-cyan. Kalshi → warm sand. Chosen to sit quietly
// against black and to NOT read as a bull/bear odds signal.
export const SOURCE_META = {
  polymarket: { id: 'polymarket', label: 'Polymarket', side: 'left',  hue: '108 140 180', url: 'https://polymarket.com', logo: 'https://unavatar.io/polymarket.com' },
  kalshi:     { id: 'kalshi',     label: 'Kalshi',     side: 'right', hue: '190 168 120', url: 'https://kalshi.com', logo: 'https://unavatar.io/kalshi.com' },
}

// Currency-aware volume/amount formatter. Caller passes fmtLargeShort from
// useCurrency so the symbol + locale grouping match the user's pick. Falls back
// to plain USD formatting if no formatter is supplied (legacy callsites).
export function formatVolume(n, fmtLargeShort) {
  if (n == null || !Number.isFinite(n)) {
    if (typeof fmtLargeShort === 'function') return fmtLargeShort(0)
    return '$0'
  }
  if (typeof fmtLargeShort === 'function') return fmtLargeShort(n)
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${Math.round(n)}`
}
