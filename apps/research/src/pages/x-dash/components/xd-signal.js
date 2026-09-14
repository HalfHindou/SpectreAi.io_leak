/**
 * X Dash - Signal Score system.
 *
 * The synthesis layer. LunarCrush has Galaxy Score, Kaito has Mindshare%,
 * Santiment has Social Dominance - ONE hero number per entity that IS the
 * verdict. Raw metrics (velocity, novelty, engagement, breadth) are the
 * breakdown BEHIND the number, not the thing the user has to assemble.
 *
 * Two scorers, same output shape { score, tier, parts }:
 *   - computeSignalScore(tokenRow)  -> a token's attention quality
 *   - computeCarrierScore(authorRow) -> a creator's IMPACT (not follower count)
 *
 * Both fuse 5 normalized 0-1 parts into a weighted 0-100 score. Quality of
 * attention is weighted over raw volume - a token shouted by 200 bots scores
 * below one carried by 30 real creators with durable engagement.
 */

/* ---------- normalization helpers ---------- */

/* Ratio metrics (velocity_ratio, novelty_ratio) are power-law: most tokens
   sit near 1.0, a few spike to 3x+. Map ~0-3 onto 0-1 with a soft knee so
   the dense band around 1.0 still spreads, and >=3x saturates near 1. */
function normRatio(value) {
  const v = Number(value || 0)
  if (v <= 0) return 0
  // 1.0x -> ~0.45, 2.0x -> ~0.72, 3.0x -> ~0.87, caps approaching 1
  return Math.max(0, Math.min(1, 1 - Math.exp(-v / 1.6)))
}

/* Engagement is heavily long-tailed (tens to hundreds of thousands).
   Log-normalize against a reference ceiling so a mid-size token still
   registers and a viral one doesn't flatten everything else. */
function normLog(value, ceiling) {
  const v = Number(value || 0)
  if (v <= 0) return 0
  const top = Math.log10(ceiling)
  const got = Math.log10(v + 1)
  return Math.max(0, Math.min(1, got / top))
}

function clamp01(value) {
  const v = Number(value || 0)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

/* ---------- tier from score ---------- */
export function signalTier(score) {
  const s = Number(score || 0)
  if (s >= 72) return 'elite'
  if (s >= 52) return 'strong'
  if (s >= 30) return 'building'
  return 'quiet'
}

/* tier -> warm-white-leaning accent for treemap fills + pills. No neon:
   elite is brightest warm-white, quiet fades toward the void. */
export const SIGNAL_TIER_COLOR = {
  elite: '#f5f5f7',
  strong: 'rgba(245,245,247,0.74)',
  building: 'rgba(245,245,247,0.46)',
  quiet: 'rgba(245,245,247,0.24)',
}

export const SIGNAL_TIER_LABEL = {
  elite: 'Elite',
  strong: 'Strong',
  building: 'Building',
  quiet: 'Quiet',
}

/* ---------- TOKEN: computeSignalScore ----------
 *
 * Accepts either the nested bootstrap row ({ token, metrics, quality }) or
 * the flattened shape (metrics spread to top level). Pulls from metrics +
 * quality only - never fetches.
 *
 * Five parts, each 0-1:
 *   velocity    normRatio(velocity_ratio)         - is attention accelerating
 *   novelty     normRatio(novelty_ratio)          - is it fresh vs recycled
 *   cleanSignal clean_signal_score_24h (already 0-1) - is the attention real
 *   breadth     authors-per-mention ratio          - many voices vs an echo
 *   engagement  normLog(weighted_engagement_24h)   - does it actually land
 *
 * Weights (sum = 1.0): clean-signal + breadth are weighted highest because
 * quality of attention beats raw volume. Velocity/novelty are the "is it
 * moving" signal. Engagement is the smallest - it correlates with mcap and
 * we don't want big tokens to auto-win.
 *
 *   cleanSignal 0.30 | breadth 0.24 | velocity 0.18 | novelty 0.14 | engagement 0.14
 */
const TOKEN_WEIGHTS = {
  cleanSignal: 0.30,
  breadth: 0.24,
  velocity: 0.18,
  novelty: 0.14,
  engagement: 0.14,
}

export function computeSignalScore(tokenRow) {
  const row = tokenRow || {}
  const m = row.metrics || row
  const q = row.quality || row

  const mentions24h = Number(
    m.external_mentions_24h ?? m.mentions_24h ?? m.external_mentions ?? 0,
  )
  const authors24h = Number(
    m.unique_external_authors_24h ?? m.unique_authors_24h ?? m.author_count ?? 0,
  )
  const cleanSignalRaw = Number(
    q.clean_signal_score_24h ?? m.clean_signal_score_24h ?? m.clean_signal_score ?? 0,
  )
  const engagement24h = Number(
    m.external_weighted_engagement_24h ?? m.external_weighted_engagement ?? 0,
  )

  /* breadth: unique authors per mention. 1 author : 1 mention = healthy
     spread (1.0), many mentions from few authors = an echo chamber (-> 0).
     Clamp the ratio - it can technically exceed 1 on tiny samples. */
  const breadthRatio = mentions24h > 0 ? authors24h / mentions24h : 0

  const parts = {
    velocity: normRatio(m.velocity_ratio),
    novelty: normRatio(m.novelty_ratio),
    cleanSignal: clamp01(cleanSignalRaw),
    breadth: clamp01(breadthRatio),
    // 50k weighted engagement in 24h is a strong-but-not-viral ceiling
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

  return { score, tier: signalTier(score), parts }
}

/* ---------- CARRIER: computeCarrierScore ----------
 *
 * LunarCrush's CreatorRank principle: a creator's worth is IMPACT, not
 * follower count. A 4k-follower account that calls tokens early and gets
 * durable engagement out-carries a 2M-follower account that just reposts.
 *
 * Accepts either a bootstrap top_author row or a richer KOL/author row.
 * Five parts, each 0-1:
 *   engagement  normLog(total_weighted_engagement)   - do their posts land
 *   earlyHit    early_signal_hit_rate (already 0-1)  - do they call it first
 *   leadTime    inverted avg_lead_minutes            - HOW early (faster=better)
 *   reach       normLog(followers_count)             - audience, capped low
 *   volume      normLog(mention_count)               - are they actually active
 *
 * Weights (sum = 1.0): engagement + earlyHit are the impact core. leadTime
 * sharpens earlyHit. reach is deliberately the SMALLEST weight (0.12) and
 * log-capped so follower count can nudge but never dominate - that's the
 * whole point. volume keeps one-hit accounts from ranking.
 *
 *   engagement 0.32 | earlyHit 0.26 | leadTime 0.16 | volume 0.14 | reach 0.12
 */
const CARRIER_WEIGHTS = {
  engagement: 0.32,
  earlyHit: 0.26,
  leadTime: 0.16,
  volume: 0.14,
  reach: 0.12,
}

/* avg lead minutes -> 0-1, faster is better. 0 min (instant/no data) is
   neutral-low 0.5 so missing data doesn't punish; <=30min -> ~1.0;
   >=6h (360min) -> ~0. A creator who's consistently 20min early is gold. */
function normLeadMinutes(minutes) {
  const v = Number(minutes || 0)
  if (v <= 0) return 0.5 // no lead data - neutral, don't penalize
  if (v >= 360) return 0
  // linear-ish decay from 30min (1.0) to 360min (0)
  if (v <= 30) return 1
  return Math.max(0, Math.min(1, 1 - (v - 30) / 330))
}

export function computeCarrierScore(authorRow) {
  const a = authorRow || {}

  const engagement = Number(
    a.total_weighted_engagement ?? a.recent_weighted_engagement_24h ?? 0,
  )
  const earlyHitRaw = Number(
    a.early_signal_hit_rate_24h ?? a.early_signal_hit_rate_7d ?? 0,
  )
  const leadMinutes = Number(
    a.avg_lead_minutes_24h ?? a.avg_lead_minutes_7d ?? 0,
  )
  const followers = Number(a.followers_count ?? 0)
  const mentions = Number(
    a.mention_count ?? a.recent_mentions_24h ?? a.proof_mentions ?? 0,
  )

  const parts = {
    // 5k weighted engagement from one creator in-window is a strong ceiling
    engagement: normLog(engagement, 5000),
    earlyHit: clamp01(earlyHitRaw),
    leadTime: normLeadMinutes(leadMinutes),
    // 250k followers is the reach ceiling - intentionally low so reach
    // saturates fast and stops mattering past "has a real audience"
    reach: normLog(followers, 250000),
    // 25 mentions in-window is a very active carrier
    volume: normLog(mentions, 25),
  }

  const score = Math.round(
    100 * (
      parts.engagement * CARRIER_WEIGHTS.engagement
      + parts.earlyHit * CARRIER_WEIGHTS.earlyHit
      + parts.leadTime * CARRIER_WEIGHTS.leadTime
      + parts.volume * CARRIER_WEIGHTS.volume
      + parts.reach * CARRIER_WEIGHTS.reach
    ),
  )

  return { score, tier: signalTier(score), parts }
}

/* human labels for the parts breakdown bars in the drawer */
export const SIGNAL_PART_LABELS = {
  velocity: 'Velocity',
  novelty: 'Novelty',
  cleanSignal: 'Clean signal',
  breadth: 'Author breadth',
  engagement: 'Engagement',
}

export const CARRIER_PART_LABELS = {
  engagement: 'Engagement impact',
  earlyHit: 'Early-call rate',
  leadTime: 'Lead time',
  volume: 'Carry volume',
  reach: 'Audience reach',
}

/* ---------- rank-trajectory sparkline points ----------
 *
 * Build a tiny ordered series from the rank-window fields the bootstrap row
 * carries. There's no full history array - just 4-5 anchor points:
 *   opening_rank_position_window -> best/worst (as the mid envelope) ->
 *   previous_rank_position -> rank_position (now).
 *
 * Returned as y-values where HIGHER = BETTER rank (we invert: rank 1 is the
 * top of the chart). Consumers draw a line; lower rank number -> higher line.
 */
export function buildRankTrajectory(row) {
  if (!row) return []
  const open = Number(row.opening_rank_position_window)
  const best = Number(row.best_rank_position_window)
  const worst = Number(row.worst_rank_position_window)
  const prev = Number(row.previous_rank_position)
  const now = Number(row.rank_position)

  // ordered oldest -> newest; drop anything non-finite
  const seq = [open, worst, best, prev, now].filter((n) => Number.isFinite(n) && n > 0)
  if (seq.length < 2) return []

  // invert: chart Y should rise as rank improves (rank 1 = highest point).
  // normalize against the window's own min/max so the line uses full height.
  const max = Math.max(...seq)
  const min = Math.min(...seq)
  const span = max - min || 1
  return seq.map((rank) => 1 - (rank - min) / span)
}
