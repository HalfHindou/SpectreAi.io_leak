/**
 * Fade signal — deterministic "is this a fading pump / bearish divergence?"
 * score for an X Dash token.
 *
 * Premise: a token with loud, accelerating X attention whose PRICE is dropping
 * and/or whose chatter is promo-driven (low quality) is distributing into hype,
 * not accumulating. We surface that as a tag so a leaderboard spike doesn't read
 * as bullish by default.
 *
 *   computeFadeSignal(input) -> { tag, score, tier, reasons, thesis, change, velocity }
 *     tag:   'bearish' | 'hype' | null
 *     score: 0..100 fade risk
 *     tier:  'high' | 'med' | 'low' | 'none'
 *
 * Pure function, no deps — duplicated in apps/research (no cross-app imports).
 */

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

export const FADE_LABELS = { bearish: 'Bearish', hype: 'Hype Risk' }

export function computeFadeSignal(input = {}) {
  const velocity = num(input.velocityRatio)
  const mentions = num(input.mentions24h)
  const prevAvg = num(input.prevDailyAvg)
  const change =
    input.change24h == null || input.change24h === '' ? null : num(input.change24h)
  const qStatus = input.qualityStatus || ''
  const promo = num(input.promoShare24h)
  const cashtagOnly = num(input.cashtagOnlyShare24h)
  const clean = num(input.cleanSignal24h)
  const reasons = Array.isArray(input.qualityReasons) ? input.qualityReasons : []

  // Gate: needs a real attention spike (acceleration OR vs its own baseline)
  // AND enough absolute volume so a 1->4 mention blip can't trip it. This is a
  // divergence signal — without the loud attention there's nothing to fade.
  const spike = velocity >= 2 || (prevAvg > 0 && mentions >= prevAvg * 3)
  if (!spike || mentions < 10) {
    return { tag: null, score: 0, tier: 'none', reasons: [], thesis: '' }
  }

  // Chatter-quality risk (promo / shill / low-specificity)
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

  // Price-weakness risk (the dip)
  let pRisk = 0
  if (change != null) {
    if (change <= -15) pRisk = 1
    else if (change < 0) pRisk = Math.min(1, -change / 15)
  }
  const hasDip = change != null && change <= -5

  let tag = null
  let score = 0
  if (hasDip) {
    // loud attention but price dropping = the divergence
    tag = 'bearish'
    score = Math.round(100 * (0.6 * pRisk + 0.4 * qRisk))
  } else if (qRisk >= 0.4) {
    // promo-driven spike, price hasn't broken (yet) = distribution risk
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

/**
 * Convenience: map a raw X Dash /token payload (+ optional 24h price change)
 * to a fade signal.
 */
export function fadeSignalFromXDash(intel, change24h) {
  const m = intel?.metrics || intel?.token?.metrics || {}
  const q = intel?.quality || intel?.token?.quality || {}
  return computeFadeSignal({
    velocityRatio: m.velocity_ratio,
    mentions24h: m.external_mentions_24h ?? m.mentions_24h,
    prevDailyAvg: m.external_mentions_prev_daily_avg,
    change24h,
    qualityStatus: q.quality_status,
    promoShare24h: q.promo_share_24h,
    cashtagOnlyShare24h: q.cashtag_only_share_24h ?? q.cashtag_signal_share_24h,
    cleanSignal24h: q.clean_signal_score_24h,
    qualityReasons: q.quality_reasons,
  })
}
