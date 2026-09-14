/**
 * Signal Score — trading-side mirror of the research X Dash signal engine
 * (apps/research/src/pages/x-dash/components/xd-signal.js). Kept in sync so the
 * hero number a token shows in the trading X Dash column matches the research
 * dossier exactly. No cross-app imports are allowed, so the formula is
 * duplicated here verbatim.
 *
 * Fuses 5 normalized 0-1 parts from the X Dash metrics+quality payload into a
 * weighted 0-100 score. Quality of attention (clean signal, author breadth)
 * is weighted over raw volume — a token shouted by 200 bots scores below one
 * carried by 30 real creators with durable engagement.
 */

/* Ratio metrics (velocity_ratio, novelty_ratio) are power-law: most tokens sit
   near 1.0, a few spike to 3x+. Soft knee spreads the dense band, saturates
   near 1 past ~3x. 1.0x -> ~0.45, 2.0x -> ~0.72, 3.0x -> ~0.87. */
function normRatio(value) {
  const v = Number(value || 0)
  if (v <= 0) return 0
  return Math.max(0, Math.min(1, 1 - Math.exp(-v / 1.6)))
}

/* Engagement is long-tailed (tens to hundreds of thousands). Log-normalize
   against a reference ceiling so a mid-size token still registers. */
function normLog(value, ceiling) {
  const v = Number(value || 0)
  if (v <= 0) return 0
  const top = Math.log10(ceiling)
  const got = Math.log10(v + 1)
  return Math.max(0, Math.min(1, got / top))
}

export function clamp01(value) {
  const v = Number(value || 0)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

export function signalTier(score) {
  const s = Number(score || 0)
  if (s >= 72) return 'elite'
  if (s >= 52) return 'strong'
  if (s >= 30) return 'building'
  return 'quiet'
}

export const SIGNAL_TIER_LABEL = {
  elite: 'Elite',
  strong: 'Strong',
  building: 'Building',
  quiet: 'Quiet',
}

/* human labels for the parts breakdown bars */
export const SIGNAL_PART_LABELS = {
  velocity: 'Velocity',
  novelty: 'Novelty',
  cleanSignal: 'Clean signal',
  breadth: 'Author breadth',
  engagement: 'Engagement',
}

/* render order for the breakdown bars */
export const SIGNAL_PART_ORDER = ['velocity', 'novelty', 'cleanSignal', 'breadth', 'engagement']

/* Weights (sum = 1.0): clean-signal + breadth weighted highest because quality
   of attention beats raw volume. */
const TOKEN_WEIGHTS = {
  cleanSignal: 0.30,
  breadth: 0.24,
  velocity: 0.18,
  novelty: 0.14,
  engagement: 0.14,
}

/**
 * Accepts the X Dash token-intel payload ({ metrics, quality }, with the older
 * nested `token.metrics` / `token.quality` shapes handled too). Returns
 * { score, tier, parts, hasData } — never fetches.
 */
export function computeSignalScore(intel) {
  const row = intel || {}
  const m = row.metrics || row.token?.metrics || row
  const q = row.quality || row.token?.quality || row

  const mentions24h = Number(
    m.external_mentions_24h ?? m.mentions_24h ?? m.external_mentions ?? 0,
  )
  const authors24h = Number(
    m.unique_external_authors_24h ?? m.unique_authors_24h ?? m.author_count ?? 0,
  )
  const cleanSignalRaw = Number(
    q.clean_signal_score_24h ?? m.clean_signal_score_24h ?? q.clean_signal_score ?? m.clean_signal_score ?? 0,
  )
  const engagement24h = Number(
    m.external_weighted_engagement_24h ?? m.external_weighted_engagement ?? 0,
  )

  /* breadth: unique authors per mention. 1:1 = healthy spread, many mentions
     from few authors = an echo chamber. Clamp - can exceed 1 on tiny samples. */
  const breadthRatio = mentions24h > 0 ? authors24h / mentions24h : 0

  const parts = {
    velocity: normRatio(m.velocity_ratio),
    novelty: normRatio(m.novelty_ratio),
    cleanSignal: clamp01(cleanSignalRaw),
    breadth: clamp01(breadthRatio),
    engagement: normLog(engagement24h, 50000),
  }

  const score = Math.round(
    100 * (
      parts.cleanSignal * TOKEN_WEIGHTS.cleanSignal
      + parts.breadth * TOKEN_WEIGHTS.breadth
      + parts.velocity * TOKEN_WEIGHTS.velocity
      + parts.novelty * TOKEN_WEIGHTS.novelty
      + parts.engagement * TOKEN_WEIGHTS.engagement
    ),
  )

  // Don't render a 0 ring on a token X Dash has never seen.
  const hasData = mentions24h > 0 || engagement24h > 0 || cleanSignalRaw > 0

  return { score, tier: signalTier(score), parts, hasData }
}
