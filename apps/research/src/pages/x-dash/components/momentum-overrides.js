/**
 * TEMPORARY, token-scoped momentum-entry overrides.
 *
 * The X-Dash upstream serves a wrong / volatile `momentum_entry` for a few tokens.
 * Worst case: the-black-bull (ANSEM) is served its LIVE re-entry (~$90M, near the
 * top) as "first surfaced" instead of its real first appearance (~$5.85M) - which
 * turns a +438% early catch into a -65% top-buy in the UI. Until upstream serves the
 * immutable first-surfaced record consistently across /token + /bootstrap +
 * /leaderboard-bundle, we force the known-correct entry for these specific tokens.
 *
 * Scoped strictly by cg_id, so no other token is touched. entry_market_cap is an
 * immutable historical value (market cap at first Momentum Top 25 appearance), so it
 * cannot drift. We MERGE over the upstream object so its live fields (metrics, etc.)
 * survive while the corrected entry fields win - even when upstream sends a wrong
 * non-null value.
 *
 * REMOVE once upstream serves a stable, first-surfaced momentum_entry.
 * Source: reconstructed_public_momentum_ansem_20260627 (entry $5,847,740, rank 2).
 */
export const MOMENTUM_ENTRY_OVERRIDE = {
  'the-black-bull': {
    entry_market_cap: 5847740.349880813,
    entry_rank: 2,
    entered_at: '2026-06-27T15:20:00.310448+00:00',
  },
}

/**
 * Return the momentum_entry to render. For an overridden token, the corrected entry
 * fields are forced on top of whatever upstream returned (preserving its other
 * fields); for every other token the upstream value is returned unchanged.
 */
export function overrideMomentumEntry(cgId, raw) {
  const fix = cgId && MOMENTUM_ENTRY_OVERRIDE[cgId]
  if (!fix) return raw
  return raw ? { ...raw, ...fix } : fix
}

/**
 * The token drawer also reads a SEPARATE "momentum origin" tracker
 * (/api/xdash/momentum-origin/:cgId) and the card PREFERS it over the momentum entry
 * whenever it has a recorded entry market cap. For tokens we override, that origin is
 * the wrong / volatile source - it reset on a board re-entry (e.g. ANSEM records its
 * ~$90M re-entry as "first surfaced" instead of its ~$5.85M first appearance). Drop the
 * origin for those tokens so the card falls back to our corrected entry. No-op for
 * everything else. Remove alongside the entry override once upstream is fixed.
 */
export function suppressOriginIfOverridden(cgId, origin) {
  return cgId && MOMENTUM_ENTRY_OVERRIDE[cgId] ? null : origin
}
