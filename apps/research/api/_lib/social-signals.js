/**
 * Social signal engines — deterministic reads over an X Dash token payload.
 * Research-app copy (no cross-app imports; the trading app carries its own).
 *
 *   computeFadeSignal(input)     -> { tag: 'bearish'|'hype'|null, score, tier, reasons, thesis }
 *   computeAttentionPhase(input) -> { phase: 'ignition'|'coiling'|'exhaustion'|null, tone, score, tier, thesis }
 *   computeSignalScore(input)    -> { score 0..100, tier, parts }   (chatter quality composite)
 *
 * All pure functions, no deps. A server-side mirror lives at
 * apps/research/api/_lib/social-signals.js — keep the two in sync.
 */

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}
function clamp01(n) {
  return Math.max(0, Math.min(1, n))
}

export const FADE_LABELS = { bearish: 'Bearish', hype: 'Hype Risk' }
export const PHASE_LABELS = { ignition: 'Ignition', coiling: 'Coiling', exhaustion: 'Exhaustion' }
export const PHASE_TONE = { ignition: 'bull', coiling: 'info', exhaustion: 'warn' }

/* ── Fade / distribution risk ─────────────────────────────────────────────── */

export function computeFadeSignal(input = {}) {
  const velocity = num(input.velocityRatio)
  const mentions = num(input.mentions24h)
  const prevAvg = num(input.prevDailyAvg)
  const uniqAuthors = num(input.uniqueAuthors24h)
  const change =
    input.change24h == null || input.change24h === '' ? null : num(input.change24h)
  const qStatus = input.qualityStatus || ''
  const promo = num(input.promoShare24h)
  const cashtagOnly = num(input.cashtagOnlyShare24h)
  const clean = num(input.cleanSignal24h)
  const reasons = Array.isArray(input.qualityReasons) ? input.qualityReasons : []

  // Gate: needs a real attention spike AND enough absolute volume so a
  // 1->4 mention blip can't trip it.
  const spike = velocity >= 2 || (prevAvg > 0 && mentions >= prevAvg * 3)
  if (!spike || mentions < 10) {
    return { tag: null, score: 0, tier: 'none', reasons: [], thesis: '' }
  }

  let qRisk = 0
  const detail = []
  if (qStatus === 'quarantined') { qRisk += 0.5; detail.push('quarantined chatter') }
  else if (qStatus === 'soft_penalized') { qRisk += 0.3; detail.push('soft-penalized chatter') }
  if (promo >= 0.15) { qRisk += 0.2; detail.push(`${Math.round(promo * 100)}% promo`) }
  if (cashtagOnly >= 0.7) { qRisk += 0.2; detail.push('mostly cashtag-only posts') }
  if (clean > 0 && clean < 0.5) { qRisk += 0.15; detail.push('low clean signal') }
  if (reasons.includes('promo_language')) qRisk += 0.1
  if (reasons.includes('repeated_author_text') || reasons.includes('multi_token_tweet')) {
    qRisk += 0.1
    detail.push('shill pattern')
  }
  qRisk = Math.min(1, qRisk)

  let pRisk = 0
  if (change != null) {
    if (change <= -15) pRisk = 1
    else if (change < 0) pRisk = Math.min(1, -change / 15)
  }
  const hasDip = change != null && change <= -5

  // ORGANIC vs MANUFACTURED — unique-voice breadth is dispositive: a
  // manufactured/coordinated pump is a handful of accounts, not ~1000 distinct
  // authors. A broad crowd whose clean signal isn't terrible and isn't
  // quarantined is organic; its high cashtag-only / promo % is an excited
  // memecoin crowd, not a shill ring. Don't call a positive-price spike
  // "manufactured hype" at that breadth. ($ANSEM: 988 voices, 71% clean.)
  // Two independent organic signals, EITHER is enough: (a) hundreds of distinct
  // voices, or (b) broad CROSS-CLUSTER breadth (aixbt's tell — a manufactured
  // pump is one echo chamber; interest spread across >=3 archetypes, not just
  // trenchers, is real). Both gated on a non-terrible clean signal + not
  // quarantined so a botnet can't fake it.
  const clusterBreadth = num(input.clusterBreadth)
  const notShill = qStatus !== 'quarantined' && (clean == null || clean >= 0.5)
  const organicCrowd = notShill && (
    (uniqAuthors != null && uniqAuthors >= 400) ||
    (clusterBreadth != null && clusterBreadth >= 3)
  )

  let tag = null
  let score = 0
  if (hasDip) {
    tag = 'bearish'
    score = Math.round(100 * (0.6 * pRisk + 0.4 * qRisk))
  } else if (qRisk >= 0.4 && !organicCrowd) {
    tag = 'hype'
    score = Math.round(100 * (0.7 * qRisk + 0.3 * pRisk))
  } else {
    return { tag: null, score: 0, tier: 'none', reasons: detail, thesis: '' }
  }

  const tier = score >= 70 ? 'high' : score >= 45 ? 'med' : 'low'
  const velTxt = `${velocity.toFixed(1)}x velocity`
  const chgTxt = change != null ? `${change >= 0 ? '+' : ''}${change.toFixed(1)}% / 24h` : 'price n/a'
  const thesis = tag === 'bearish'
    ? `Loud attention (${velTxt}) but price ${chgTxt}${detail.length ? ' · ' + detail.slice(0, 2).join(', ') : ''}.`
    : `Promo-driven spike (${velTxt})${detail.length ? ' · ' + detail.slice(0, 2).join(', ') : ''} — distribution risk.`

  return { tag, score, tier, reasons: detail, thesis, change, velocity }
}

export function fadeSignalFromXDash(intel, change24h, clusterBreadth = null) {
  const m = intel?.metrics || intel?.token?.metrics || {}
  const q = intel?.quality || intel?.token?.quality || {}
  return computeFadeSignal({
    velocityRatio: m.velocity_ratio,
    mentions24h: m.external_mentions_24h ?? m.mentions_24h,
    prevDailyAvg: m.external_mentions_prev_daily_avg,
    uniqueAuthors24h: m.unique_external_authors_24h ?? m.unique_authors_24h ?? m.unique_authors,
    clusterBreadth,
    change24h,
    qualityStatus: q.quality_status,
    promoShare24h: q.promo_share_24h,
    cashtagOnlyShare24h: q.cashtag_only_share_24h ?? q.cashtag_signal_share_24h,
    cleanSignal24h: q.clean_signal_score_24h,
    qualityReasons: q.quality_reasons,
  })
}

/* ── Attention lifecycle phase ────────────────────────────────────────────── */

const PHASE_NONE = { phase: null, tone: null, score: 0, tier: 'none', reasons: [], thesis: '' }
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

  if (mentions < 10) return PHASE_NONE

  let manip = 0
  if (qStatus === 'quarantined') manip += 0.5
  else if (qStatus === 'soft_penalized') manip += 0.3
  if (promo >= 0.15) manip += 0.2
  if (cashtagOnly >= 0.7) manip += 0.2
  if (clean > 0 && clean < 0.5) manip += 0.15
  if (reasons.includes('promo_language')) manip += 0.1
  if (reasons.includes('repeated_author_text') || reasons.includes('multi_token_tweet')) manip += 0.1
  manip = Math.min(1, manip)
  const organicScore = 1 - manip

  const spike = velocity >= 2 || (prevAvg > 0 && mentions >= prevAvg * 3)
  const cooling = (velocity > 0 && velocity < 0.9) || (prevAvg > 0 && mentions < prevAvg * 0.6)
  const broad = novelty >= 1.2 || (mentions > 0 && uniqAuthors / mentions >= 0.4)
  const attnStrength = clamp01((velocity - 2) / 6)
  const velTxt = `${velocity.toFixed(1)}x velocity`
  const chgTxt =
    change != null ? `${change >= 0 ? '+' : ''}${change.toFixed(1)}% / 24h` : 'price n/a'

  if (cooling && change != null && change >= 8) {
    const decay = clamp01((0.9 - Math.min(velocity, 0.9)) / 0.9)
    const extended = clamp01(change / 60)
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

  if (!spike || manip >= 0.3) return PHASE_NONE

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

  return PHASE_NONE
}

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

/* ── Signal score — chatter quality composite (0..100) ────────────────────── */

export function computeSignalScore(input = {}) {
  // Nullable-aware: weights renormalize over the parts we actually have, so a
  // degraded feed (no clean-signal / novelty from X Dash) still yields an
  // honest score from mention telemetry instead of a zero-dragged one.
  // `coverage` (0..1) says how much of the full model the inputs covered.
  const has = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v)
    return v != null && v !== '' && Number.isFinite(n)
  }
  const WEIGHTS = { clean: 0.30, breadth: 0.24, vel: 0.18, nov: 0.14, eng: 0.14 }
  const parts = {}

  const mentions = has(input.mentions24h) ? num(input.mentions24h) : null
  const authors = has(input.uniqueAuthors24h) ? num(input.uniqueAuthors24h) : null
  if (mentions != null && mentions <= 0 && (authors ?? 0) <= 0) {
    return { score: 0, tier: 'quiet', parts: null, coverage: 0 }
  }

  if (has(input.cleanSignal24h)) parts.clean = clamp01(num(input.cleanSignal24h))
  if (mentions != null && authors != null && mentions > 0) {
    parts.breadth = clamp01(authors / Math.max(1, mentions) / 0.5)
  }
  if (has(input.velocityRatio)) parts.vel = clamp01((num(input.velocityRatio) - 0.8) / 4) // 0.8x -> 0 .. 4.8x -> 1
  if (has(input.noveltyRatio)) parts.nov = clamp01(num(input.noveltyRatio) / 2)
  if (has(input.weightedEngagement)) parts.eng = clamp01(Math.log10(Math.max(1, num(input.weightedEngagement))) / 6) // 1M weighted -> 1

  const keys = Object.keys(parts)
  if (!keys.length) return { score: 0, tier: 'quiet', parts: null, coverage: 0 }
  const wSum = keys.reduce((a, k) => a + WEIGHTS[k], 0)
  const score = Math.round((100 * keys.reduce((a, k) => a + WEIGHTS[k] * parts[k], 0)) / wSum)
  const tier = score >= 75 ? 'elite' : score >= 55 ? 'strong' : score >= 32 ? 'building' : 'quiet'
  return { score, tier, parts, coverage: wSum }
}

export function signalScoreFromXDash(intel) {
  const m = intel?.metrics || intel?.token?.metrics || {}
  const q = intel?.quality || intel?.token?.quality || {}
  return computeSignalScore({
    cleanSignal24h: q.clean_signal_score_24h,
    mentions24h: m.external_mentions_24h ?? m.mentions_24h,
    uniqueAuthors24h: m.unique_external_authors_24h ?? m.unique_authors_24h ?? m.unique_authors,
    velocityRatio: m.velocity_ratio,
    noveltyRatio: m.novelty_ratio,
    weightedEngagement: m.total_weighted_engagement ?? m.external_weighted_engagement,
  })
}

/* ── Cross-cluster breadth (aixbt-inspired) ───────────────────────────────────
 * The sharpest organic-vs-manufactured tell isn't raw mention volume — it's how
 * many distinct COMMUNITY ARCHETYPES are discussing a project. A token every
 * cluster picks up (VCs + founders + devs + researchers + traders + media +
 * trenchers) is broad, organic conviction; one stuck in a single echo chamber
 * (all trenchers/degens tweeting cashtags) is a narrow hype pocket, however
 * loud. Classify each credible X author by their BIO (free, keyword — no LLM)
 * and count distinct clusters. Mirrors aixbt's "momentum = cross-cluster
 * pickup" over one-account-one-vote volume. */
const CLUSTER_DEFS = [
  ['vc',         'VCs',         /\b(venture|ventures|vc|capital|investor|investing|angel|fund|portfolio|backing|lp|gp)\b/i],
  ['founder',    'Founders',    /\b(founder|co-?founder|ceo|cto|building @|we'?re building|running @|creator of)\b/i],
  ['developer',  'Developers',  /\b(developer|engineer|solidity|rust|smart ?contract|full-?stack|protocol|open ?source|coding|hacker)\b/i],
  ['researcher', 'Researchers', /\b(research|analyst|newsletter|substack|thesis|deep ?dive|educator|writing about|reports?)\b/i],
  ['media',      'Media',       /\b(journalist|reporter|news|media|podcast|coverage|editor|correspondent|anchor)\b/i],
  ['trader',     'Traders',     /\b(trader|trading|quant|technical analysis|scalp|swing|positions?|pnl|futures|perps?)\b/i],
  ['trencher',   'Trenchers',   /\b(degen|trenches?|ape|aping|memecoins?|shitcoins?|gambler|believer|holder|alpha|calls?|signals?|low-?caps?|gems?|100x|1000x)\b/i],
]
export const CLUSTER_LABELS = Object.assign(
  Object.fromEntries(CLUSTER_DEFS.map(([k, label]) => [k, label])),
  { kol: 'Influencers' },
)

// authors: X Dash top_authors[] (screen_name, followers_count, is_blue_verified,
// legacy_verified, description). Returns null when no credible authors.
export function computeAuthorClusters(authors) {
  if (!Array.isArray(authors) || !authors.length) return null
  const counts = {}
  let credible = 0
  for (const a of authors) {
    if (!a || a.is_self_author) continue
    const followers = Number(a.followers_count) || 0
    const verified = !!(a.is_blue_verified || a.legacy_verified)
    if (!verified && followers < 20000) continue // credible voices only
    credible++
    const bio = String(a.description || a.bio || a.user_description || '')
    let matched = false
    for (const [key, , re] of CLUSTER_DEFS) {
      if (re.test(bio)) { counts[key] = (counts[key] || 0) + 1; matched = true }
    }
    // a big verified account with a bio that reveals no archetype is a generic
    // influencer/KOL — still a distinct "who", counted separately.
    if (!matched && followers >= 100000) counts.kol = (counts.kol || 0) + 1
  }
  if (!credible) return null
  const present = Object.keys(counts)
  const breadth = present.length
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k]) => k)
  const soleTrencher = breadth <= 1 && (present[0] === 'trencher' || present[0] === 'kol')
  const tone = breadth >= 4 ? 'broad' : breadth >= 2 ? 'moderate' : soleTrencher ? 'echo' : 'narrow'
  return { breadth, present, dominant, credible, tone, counts }
}
