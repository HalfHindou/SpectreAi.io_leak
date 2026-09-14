/**
 * Curated KOL tier classification — shared across the KOL Radar surfaces
 * (cards, feed, signals, filters). The backend (registry.classifyTier) assigns
 * one of 's' | 'tier1' | 'tier2' | 'tier3'; S-Tier and Tier 1 carry hand-curated
 * top-KOL handles, the rest fall to a reach+signal heuristic above a 5k floor.
 */
export const TIER_META = {
  s: { key: 'kolRadar.tier.s', fallback: 'S-Tier', cls: 's' },
  tier1: { key: 'kolRadar.tier.t1', fallback: 'Tier 1', cls: 't1' },
  tier2: { key: 'kolRadar.tier.t2', fallback: 'Tier 2', cls: 't2' },
  tier3: { key: 'kolRadar.tier.t3', fallback: 'Tier 3', cls: 't3' },
}

export function tierMeta(tier) {
  return TIER_META[String(tier || '').toLowerCase()] || TIER_META.tier3
}

// Filter dropdown options (order = elite → broad).
export const TIER_FILTERS = [
  { key: 'all', fallback: 'All tiers' },
  { key: 's', fallback: 'S-Tier' },
  { key: 'tier1', fallback: 'Tier 1' },
  { key: 'tier2', fallback: 'Tier 2' },
  { key: 'tier3', fallback: 'Tier 3' },
]
