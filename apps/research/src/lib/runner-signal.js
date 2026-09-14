/**
 * Runner Score - an early-breakout detector for the X Dash "New" board.
 *
 * Degens want to catch potential runners EARLY: a small-cap token whose social
 * attention is accelerating hard, climbing the board, carried by a broad and
 * CLEAN crowd (not one shiller or a bot farm). "Old token that's been mentioned
 * for weeks" is the opposite of that, so age-of-listing is ignored entirely -
 * we score current behaviour.
 *
 * Score (0-100) blends five normalized factors, then applies a quality penalty
 * so manufactured/single-author pumps can't top the board on raw volume:
 *   - Acceleration  : mentions vs the token's own baseline + velocity ratio
 *   - Rank climb    : how many board positions it just gained
 *   - Early/small   : smaller market cap = more room to run (and not-yet-run)
 *   - Breadth       : how many distinct external authors are carrying it
 *   - Novelty       : fresh authors flowing in vs the same crowd repeating
 *   x quality gate  : clean-signal score, knocked down by author concentration
 *                     and promo share (pump red flags)
 *
 * Everything is derived client-side from the bootstrap row metrics so the
 * "why" is fully explainable - each signal carries the factors that lit it up.
 */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const log10 = (v) => Math.log10(Math.max(v, 1))

/* mentions growth vs the token's own prior daily average (its baseline) */
function mentionGrowth(row) {
  const now = num(row.external_mentions_24h)
  // The board is on window-scoped mentions because upstream zeroed its 24h
  // rollup, and the baseline came away with it. Report flat (1 = no change)
  // rather than the off-a-zero-base Infinity below, which would hand every
  // row a maximum acceleration factor and a 'new + loud' chip it did not earn.
  if (row.mentions_window_backfilled) return 1
  const prev = num(row.external_mentions_prev_daily_avg)
  if (prev <= 0) return now > 0 ? Infinity : 0 // brand-new / off a zero base
  return now / prev
}

export function computeRunnerScore(row) {
  const mc = num(row.market_cap)
  const vel = num(row.velocity_ratio)
  const growth = mentionGrowth(row)
  const authors = num(row.unique_external_authors_24h || row.author_count)
  const novelty = num(row.novelty_ratio)
  const clean = clamp01(num(row.quality?.clean_signal_score_24h ?? row.clean_signal_score_24h))
  const conc = clamp01(num(row.quality?.top_external_author_share_24h)) // 1 author dominating
  const promo = clamp01(num(row.quality?.promo_share_24h))
  const climbingUp = row.rank_direction === 'up'
  const rankGain = climbingUp ? num(row.rank_change_positions) : 0

  // --- factors, each 0..1 ---
  // Acceleration: take the stronger of growth-vs-baseline or the backend
  // velocity ratio, log-compressed so a 3x and a 3000x both register sanely.
  const aGrowth = growth === Infinity ? 1 : clamp01(log10(growth) / 2)      // 10x->0.5, 100x->1
  const aVel = clamp01(log10(vel) / 2.3)                                    // ~200x->1
  const accel = Math.max(aGrowth, aVel)
  // Rank climb: +200 positions in a window = max.
  const climb = clamp01(rankGain / 200)
  // Market-cap fit: small-but-not-MICRO is the sweet spot. Backtest (n=50, 72h
  // forward): micro-caps (<$3M) won only 44% (rug / dump risk) while mid-caps
  // (>$33M) won 88%; >$300M has already run. Hump centered ~$20M (log 7.3),
  // falling off below ~$2M and above ~$150M. Replaces the old monotonic
  // low-cap bonus, which the data showed was backwards.
  const lm = mc > 0 ? Math.log10(mc) : null
  const mcapFit = lm == null ? 0.4 : clamp01(1 - Math.abs(lm - 7.3) / 1.6)
  // Novelty: fresh authors flowing in vs the same crowd repeating.
  const nov = clamp01(log10(novelty) / 2)

  // Weights informed by the backtest: acceleration is the strongest durable
  // edge, then clean quality and mcap fit. Raw author breadth is DROPPED - high
  // breadth was a LATE signal (fewer callers = earlier = higher win rate), and
  // the backend setup_score had ~0 correlation so it is ignored entirely.
  const base = 0.40 * accel + 0.18 * mcapFit + 0.16 * clean + 0.16 * climb + 0.10 * nov
  // Quality gate: only the red flags that actually hurt forward returns - heavy
  // promo share and a single author dominating the mentions (bot / shill).
  // Moderate concentration was fine in the data, so only the extreme tail is cut.
  const qMult = (1 - 0.4 * promo) * (1 - 0.5 * clamp01((conc - 0.55) / 0.45))
  const score = Math.round(100 * base * Math.max(qMult, 0.45))

  // --- reasons (the "why" chips): positives first, then one red flag ---
  const pos = []
  if (growth === Infinity && num(row.external_mentions_24h) > 0) {
    pos.push({ tone: 'hot', text: 'new + loud' })
  } else if (growth >= 1.5) {
    pos.push({ tone: 'hot', text: `+${Math.round((growth - 1) * 100)}% mentions` })
  } else if (vel >= 3) {
    pos.push({ tone: 'hot', text: `${vel >= 10 ? Math.round(vel) : vel.toFixed(1)}x velocity` })
  }
  if (climb >= 0.1) pos.push({ tone: 'up', text: `+${rankGain} ranks` })
  if (mcapFit >= 0.6) pos.push({ tone: 'early', text: 'sweet-spot cap' })
  if (authors >= 3 && authors <= 14) pos.push({ tone: 'early', text: `${authors} early callers` })
  if (clean >= 0.68) pos.push({ tone: 'clean', text: `${Math.round(clean * 100)}% clean` })
  if (nov >= 0.6) pos.push({ tone: 'neutral', text: 'fresh authors' })

  const flags = []
  if (mc > 0 && mc < 2e6) flags.push({ tone: 'warn', text: 'micro-cap risk' })
  if (conc >= 0.55) flags.push({ tone: 'warn', text: `1 caller ${Math.round(conc * 100)}%` })
  else if (promo >= 0.2) flags.push({ tone: 'warn', text: `${Math.round(promo * 100)}% promo` })
  else if (clean > 0 && clean < 0.5) flags.push({ tone: 'warn', text: `${Math.round(clean * 100)}% clean` })

  const reasons = [...pos.slice(0, 3), ...flags.slice(0, 1)]

  // Tiers calibrated to the realistic score distribution (a single token rarely
  // maxes every factor): Igniting is reserved for genuine multi-factor monsters,
  // Heating is a strong live setup, Building is an early-but-real candidate.
  let tier = 'watch'
  if (score >= 62) tier = 'igniting'
  else if (score >= 48) tier = 'heating'
  else if (score >= RUNNER_MIN_SCORE) tier = 'building'

  return { score, tier, reasons: reasons.slice(0, 4) }
}

export const RUNNER_TIER_LABEL = {
  igniting: 'Igniting',
  heating: 'Heating up',
  building: 'Building',
  watch: 'Watch',
}

/* Minimum score to surface as a signal (below this is noise, not a setup). */
export const RUNNER_MIN_SCORE = 38
/* Cap: a token already this big has largely run - exclude from "early". */
export const RUNNER_MAX_MCAP = 300e6
