/**
 * Private Markets — page-specific constants
 *
 * Sector taxonomy, round badge palette, filter option lists.
 * Page-scoped per .claude/rules/coding-standards.md O — NOT in src/constants.
 *
 * Display strings are keyed (i18n keys) — callers resolve via t(option.labelKey)
 * and call the currency-aware formatters with the user's fmtLargeShort so values
 * respect the active currency.
 */

// Round stage → monochrome tier. Per design-system.md, chrome stays warm-white
// only — round stage is signalled by brightness, not by hue (no rainbow badges).
// Tiers map to .pm-round-early / -mid / -late CSS classes so day mode can adapt
// (inline color would be theme-blind). Brightness rises with stage maturity.
const ROUND_TIERS = {
  'Pre-Seed': 'early',
  Seed: 'early',
  Private: 'early',
  'Token Sale': 'early',
  Grant: 'early',
  'Series A': 'mid',
  'Series B': 'mid',
  'Series C': 'mid',
  Strategic: 'mid',
  Growth: 'mid',
  'Series D': 'late',
  'Series E': 'late',
  'Series F': 'late',
  'Series G': 'late',
  'Series H': 'late',
  'Treasury Allocation': 'late',
  'Pre-IPO': 'late',
  Acquisition: 'late',
}

// roundType → 'early' | 'mid' | 'late' (defaults to 'mid' for unknown stages).
export function roundBadgeTier(roundType) {
  if (!roundType) return 'mid'
  return ROUND_TIERS[roundType] || 'mid'
}

// Filter options. `value` is the canonical (English) filter string used by the
// filter logic — do NOT translate. `labelKey` is the i18n key for the display.
export const SECTOR_OPTIONS = [
  { value: 'All Sectors', labelKey: 'privateMarkets.sectors.all' },
  { value: 'AI',          labelKey: 'privateMarkets.sectors.ai' },
  { value: 'Fintech',     labelKey: 'privateMarkets.sectors.fintech' },
  { value: 'Defence',     labelKey: 'privateMarkets.sectors.defence' },
  { value: 'Robotics',    labelKey: 'privateMarkets.sectors.robotics' },
  { value: 'BioTech',     labelKey: 'privateMarkets.sectors.biotech' },
  { value: 'Climate',     labelKey: 'privateMarkets.sectors.climate' },
  { value: 'SaaS',        labelKey: 'privateMarkets.sectors.saas' },
  { value: 'Crypto',      labelKey: 'privateMarkets.sectors.crypto' },
  { value: 'Space',       labelKey: 'privateMarkets.sectors.space' },
  { value: 'Consumer',    labelKey: 'privateMarkets.sectors.consumer' },
  { value: 'Commerce',    labelKey: 'privateMarkets.sectors.commerce' },
  { value: 'Gaming',      labelKey: 'privateMarkets.sectors.gaming' },
  { value: 'Other',       labelKey: 'privateMarkets.sectors.other' },
]

export const ROUND_OPTIONS = [
  { value: 'All Rounds', labelKey: 'privateMarkets.rounds.all' },
  { value: 'Pre-Seed',   labelKey: 'privateMarkets.rounds.preSeed' },
  { value: 'Seed',       labelKey: 'privateMarkets.rounds.seed' },
  { value: 'Series A',   labelKey: 'privateMarkets.rounds.seriesA' },
  { value: 'Series B',   labelKey: 'privateMarkets.rounds.seriesB' },
  { value: 'Series C',   labelKey: 'privateMarkets.rounds.seriesC' },
  { value: 'Series D',   labelKey: 'privateMarkets.rounds.seriesD' },
  { value: 'Series E+',  labelKey: 'privateMarkets.rounds.seriesEPlus' },
  { value: 'Growth',     labelKey: 'privateMarkets.rounds.growth' },
  { value: 'Strategic',  labelKey: 'privateMarkets.rounds.strategic' },
  { value: 'Private',    labelKey: 'privateMarkets.rounds.private' },
  { value: 'Token Sale', labelKey: 'privateMarkets.rounds.tokenSale' },
  { value: 'Pre-IPO',    labelKey: 'privateMarkets.rounds.preIpo' },
]

// SIZE_OPTIONS: numeric bounds are stable. The display label is currency-aware
// (built per-render via buildSizeLabel below), so we keep no static label here.
export const SIZE_OPTIONS = [
  { id: 'all',    min: 0 },
  { id: 'seed',   min: 0,     max: 10e6 },
  { id: 'growth', min: 10e6,  max: 100e6 },
  { id: 'mega',   min: 100e6 },
]

// Build a localized, currency-aware size label for a SIZE_OPTIONS row.
// Caller supplies `t` (from useTranslation) and `fmtLargeShort` (from useCurrency).
export function buildSizeLabel(option, t, fmtLargeShort) {
  if (!option || option.id === 'all') return t('privateMarkets.sizes.any')
  if (option.min === 0 && option.max) {
    return t('privateMarkets.sizes.below', { amount: fmtLargeShort(option.max) })
  }
  if (option.min && option.max) {
    return t('privateMarkets.sizes.between', {
      min: fmtLargeShort(option.min),
      max: fmtLargeShort(option.max),
    })
  }
  if (option.min && !option.max) {
    return t('privateMarkets.sizes.above', { amount: fmtLargeShort(option.min) })
  }
  return t('privateMarkets.sizes.any')
}

export const DATE_OPTIONS = [
  { id: '24h', labelKey: 'privateMarkets.dates.day1',    hours: 24 },
  { id: '7d',  labelKey: 'privateMarkets.dates.days7',   hours: 24 * 7 },
  { id: '30d', labelKey: 'privateMarkets.dates.days30',  hours: 24 * 30 },
  { id: '90d', labelKey: 'privateMarkets.dates.days90',  hours: 24 * 90 },
  { id: 'all', labelKey: 'privateMarkets.dates.allTime', hours: null },
]

// Source badge labels → short display form. The full source string from the
// backend is the key; the value is what shows on the chip. Brand names stay
// untranslated.
export const SOURCE_LABELS = {
  Spectre: 'Spectre',
  'Spectre Curated': 'Spectre Curated',
  DeFiLlama: 'DeFiLlama',
  'SEC EDGAR': 'SEC',
  'TechCrunch Venture': 'TechCrunch',
  'Crunchbase News': 'Crunchbase',
  'Bloomberg Technology': 'Bloomberg',
}

// Currency-aware amount formatter. Caller passes fmtLargeShort from useCurrency,
// so the symbol + locale grouping match the user's pick. Falls back to "—".
export function formatAmount(usd, fmtLargeShort) {
  if (usd == null || !Number.isFinite(usd)) return '—'
  if (typeof fmtLargeShort === 'function') return fmtLargeShort(usd)
  // No formatter passed (legacy callsite). Return raw USD to avoid throwing.
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(usd >= 10e9 ? 0 : 1)}B`
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(usd >= 100e6 ? 0 : 0)}M`
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`
  return `$${usd.toFixed(0)}`
}

// "2026-04-10T…" → localized relative ("just now", "3h ago", "5d ago") or a
// short date for older items. Caller passes `t` from useTranslation so the
// short-relative strings translate; absolute fallback uses the language tag.
export function formatRelativeDate(iso, t, langTag = 'en-US') {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffH = diffMs / (1000 * 60 * 60)
  if (diffH < 1) return t ? t('privateMarkets.dates.justNow') : 'just now'
  if (diffH < 24) {
    const n = Math.floor(diffH)
    return t ? t('privateMarkets.dates.hoursAgo', { count: n }) : `${n}h ago`
  }
  const diffD = diffH / 24
  if (diffD < 7) {
    const n = Math.floor(diffD)
    return t ? t('privateMarkets.dates.daysAgo', { count: n }) : `${n}d ago`
  }
  return d.toLocaleDateString(langTag, { month: 'short', day: 'numeric' })
}

// Company name → /ventures/:slug for profile deep-link
export function companySlug(name) {
  if (!name) return null
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|ai|labs|technologies|technology)\b/gi, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
