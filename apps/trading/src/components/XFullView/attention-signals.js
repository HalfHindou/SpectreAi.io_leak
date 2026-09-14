/**
 * Attention-lifecycle signals — deterministic "where on the attention curve is
 * this token?" labels for an X Dash row. Companion to computeFadeSignal (which
 * owns the bearish / hype RISK tags); this owns the descriptive lifecycle:
 *
 *   ignition   — organic attention accelerating AND price confirming up
 *   coiling    — organic attention building but price still quiet (attention
 *                leading price = the "front-run the catch-up" setup)
 *   exhaustion — attention rolling over after a run-up (decay / can't sustain)
 *
 * These are AWARENESS labels, not buy/sell calls — they describe the SHAPE of
 * the attention so a leaderboard spike isn't read one-dimensionally. Gated on
 * the same absolute-volume floor as the fade signal (a 1->4 mention blip can't
 * register), and promo-driven spikes are deliberately excluded — those belong
 * to fade's "hype" tag, not a clean lifecycle phase.
 *
 * Grounded in: Shiller narrative-economics epidemic curve (ignite -> peak ->
 * decay), Soros reflexivity (attention leads price), and attention half-life /
 * decay. Each is a hypothesis to measure, never a guarantee.
 *
 *   computeAttentionPhase(input) -> { phase, tone, score, tier, reasons, thesis, change, velocity }
 *     phase: 'ignition' | 'coiling' | 'exhaustion' | null
 *     tone:  'bull' | 'info' | 'warn' | null   (for badge colour)
 *     score: 0..100 strength of the read
 *     tier:  'high' | 'med' | 'low' | 'none'
 *
 * Pure function, no deps — duplicated in apps/research (no cross-app imports).
 */

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}
function clamp01(n) {
  return Math.max(0, Math.min(1, n))
}

export const PHASE_LABELS = { ignition: 'Ignition', coiling: 'Coiling', exhaustion: 'Exhaustion' }
export const PHASE_TONE = { ignition: 'bull', coiling: 'info', exhaustion: 'warn' }

const NONE = { phase: null, tone: null, score: 0, tier: 'none', reasons: [], thesis: '' }
const tierOf = (s) => (s >= 70 ? 'high' : s >= 45 ? 'med' : 'low')

export function computeAttentionPhase(input = {}) {
  const velocity = num(input.velocityRatio)
  const novelty = num(input.noveltyRatio)
  const mentions = num(input.mentions24h)
  const prevAvg = num(input.prevDailyAvg)
  const uniqAuthors = num(input.uniqueAuthors24h)
  const change =
    input.change24h == null || input.change24h === '' ? null : num(input.change24h)
  const promo = num(input.promoShare24h)
  const cashtagOnly = num(input.cashtagOnlyShare24h)
  const clean = num(input.cleanSignal24h)
  const qStatus = input.qualityStatus || ''
  const reasons = Array.isArray(input.qualityReasons) ? input.qualityReasons : []

  // Absolute-volume floor (mirror fade) — no lifecycle read on thin chatter.
  if (mentions < 10) return NONE

  // Manufactured-chatter risk (same shape as fade's qRisk); organic = inverse.
  let manip = 0
  if (qStatus === 'quarantined') manip += 0.5
  else if (qStatus === 'soft_penalized') manip += 0.3
  if (promo >= 0.15) manip += 0.2
  if (cashtagOnly >= 0.7) manip += 0.2
  if (clean > 0 && clean < 0.5) manip += 0.15
  if (reasons.includes('promo_language')) manip += 0.1
  if (reasons.includes('repeated_author_text') || reasons.includes('multi_token_tweet')) manip += 0.1
  manip = Math.min(1, manip)
  const organicScore = 1 - manip // 0..1 — higher = cleaner chatter

  const spike = velocity >= 2 || (prevAvg > 0 && mentions >= prevAvg * 3)
  const cooling = (velocity > 0 && velocity < 0.9) || (prevAvg > 0 && mentions < prevAvg * 0.6)
  // Broadening authorship / fresh angles = organic spread, not a single ring.
  const broad = novelty >= 1.2 || (mentions > 0 && uniqAuthors / mentions >= 0.4)
  const attnStrength = clamp01((velocity - 2) / 6) // 2x -> 0 .. 8x -> 1
  const velTxt = `${velocity.toFixed(1)}x velocity`
  const chgTxt =
    change != null ? `${change >= 0 ? '+' : ''}${change.toFixed(1)}% / 24h` : 'price n/a'

  // EXHAUSTION — attention decelerating after a run-up. Price ran, chatter is
  // now cooling: the narrative may be past peak (the epidemic curve's decay /
  // Daley-Kendall "recovery" phase) and can struggle to hold the gain.
  if (cooling && change != null && change >= 8) {
    const decay = clamp01((0.9 - Math.min(velocity, 0.9)) / 0.9) // how cool
    const extended = clamp01(change / 60) // how far it ran
    const score = Math.round(100 * (0.6 * decay + 0.4 * extended))
    return {
      phase: 'exhaustion',
      tone: 'warn',
      score,
      tier: tierOf(score),
      reasons: ['attention cooling', `ran ${chgTxt}`],
      thesis: `Attention cooling (${velTxt}) after price ${chgTxt} — narrative may be past peak.`,
      change,
      velocity,
    }
  }

  // Ignition / coiling need a LIVE spike that is ORGANIC. Promo-driven spikes
  // are fade's "hype" territory, so bail when chatter looks manufactured.
  if (!spike || manip >= 0.3) return NONE

  // IGNITION — organic spike WITH price confirming up.
  if (change != null && change >= 5) {
    const priceConfirm = clamp01(change / 40)
    const broadBonus = broad ? 0.1 : 0
    const score = Math.round(
      100 * Math.min(1, 0.45 * organicScore + 0.3 * attnStrength + 0.15 * priceConfirm + broadBonus)
    )
    return {
      phase: 'ignition',
      tone: 'bull',
      score,
      tier: tierOf(score),
      reasons: [velTxt, broad ? 'broadening reach' : 'organic chatter', chgTxt],
      thesis: `Organic attention accelerating (${velTxt})${broad ? ', reach broadening' : ''} with price ${chgTxt}.`,
      change,
      velocity,
    }
  }

  // COILING — organic spike but price still QUIET (not up >=5, not down <=-5).
  // Attention is leading price = the "front-run the catch-up" setup. A dip
  // (<=-5) under loud attention is fade-bearish's call, so we skip it here.
  if (change == null || (change > -5 && change < 5)) {
    const broadBonus = broad ? 0.12 : 0
    const score = Math.round(
      100 * Math.min(1, 0.5 * organicScore + 0.32 * attnStrength + broadBonus)
    )
    return {
      phase: 'coiling',
      tone: 'info',
      score,
      tier: tierOf(score),
      reasons: [velTxt, broad ? 'broadening reach' : 'organic chatter', change != null ? `price ${chgTxt}` : 'price flat'],
      thesis: `Organic attention building (${velTxt})${broad ? ', reach broadening' : ''} but price still quiet (${chgTxt}) — attention leading price.`,
      change,
      velocity,
    }
  }

  return NONE
}

/**
 * Convenience: map a raw X Dash /token payload (+ optional 24h price change)
 * to an attention-lifecycle phase. Mirrors fadeSignalFromXDash.
 */
export function attentionPhaseFromXDash(intel, change24h) {
  const m = intel?.metrics || intel?.token?.metrics || {}
  const q = intel?.quality || intel?.token?.quality || {}
  return computeAttentionPhase({
    velocityRatio: m.velocity_ratio,
    noveltyRatio: m.novelty_ratio,
    mentions24h: m.external_mentions_24h ?? m.mentions_24h,
    prevDailyAvg: m.external_mentions_prev_daily_avg,
    uniqueAuthors24h: m.unique_external_authors_24h ?? m.unique_authors,
    change24h,
    promoShare24h: q.promo_share_24h,
    cashtagOnlyShare24h: q.cashtag_only_share_24h ?? q.cashtag_signal_share_24h,
    cleanSignal24h: q.clean_signal_score_24h,
    qualityStatus: q.quality_status,
    qualityReasons: q.quality_reasons,
  })
}
