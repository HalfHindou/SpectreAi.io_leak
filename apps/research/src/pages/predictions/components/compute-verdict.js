/**
 * computeVerdict — deterministic synthesis of a single confident read per
 * prediction market. The product's intelligence made invisible: no "AI" badge,
 * no brain icon, just a sentence that happens to be right.
 *
 * Three real inputs (all already available on the detail page):
 *   1. Market odds  — yesPct + 24h delta (oneDayPriceChange, in points).
 *   2. Social       — X-Dash velocity + KOL count (crypto) OR tweet buzz
 *                     (non-crypto), passed in as a normalized { present,
 *                     agree, buzzHigh, kolCount, velocity } descriptor.
 *   3. Whale/trade  — whaleActivity.trades / influencers, or 24h volume
 *                     velocity as a proxy.
 *
 * Output is a pure descriptor — the CALLER renders strings via t() so this
 * stays framework-free and testable:
 *   { lean, leanLabel, qualifier, qualifierKey, strength, deltaDir, deltaAbs,
 *     tone }
 *
 * The lean + qualifier + strength are DETERMINISTIC so the read never drifts
 * into hedge-everything AI slop. The prose sentence on the detail page is
 * LLM-generated when present (analysis.reasoning); the structure here is the
 * backbone it hangs on.
 */

/* lean from the leading Yes probability */
export function leanFromPct(yesPct) {
  if (yesPct >= 55) return 'yes'
  if (yesPct <= 45) return 'no'
  return 'tossup'
}

/**
 * @param {Object} args
 * @param {number} args.yesPct        leading outcome Yes %, 0-100
 * @param {number} [args.delta]       24h move in POINTS (e.g. +6 for +6pts)
 * @param {Object} [args.social]      { present, agree, buzzHigh, kolCount, velocity }
 * @param {Object} [args.whale]       { trades, influencers }
 * @param {number} [args.volVelocity] vol24h / totalVolume (0-1), thin/fat proxy
 * @param {string} [args.leadLabel]   candidate name for multi-outcome ("Hassett")
 */
export function computeVerdict({
  yesPct = 50,
  delta = 0,
  social = {},
  whale = {},
  volVelocity = null,
  leadLabel = null,
} = {}) {
  const lean = leanFromPct(yesPct)
  const deltaAbs = Math.abs(delta)
  const deltaDir = delta > 0.1 ? 'up' : delta < -0.1 ? 'down' : 'flat'

  const socialPresent = !!social.present
  const socialAgree = !!social.agree
  const buzzHigh = !!social.buzzHigh
  const kolCount = Number(social.kolCount || 0)

  // Thin = high social buzz but little real money behind it.
  const thin =
    volVelocity != null
      ? volVelocity < 0.02 && buzzHigh
      : buzzHigh && !(Number(whale.trades || 0) > 0)

  /* qualifier — the second clause that gives the read its edge.
     Order matters: confirmed (strongest) -> divergence (interesting) ->
     thin -> aligned -> quiet. */
  let qualifier = 'quiet'
  if (socialPresent && socialAgree && deltaAbs >= 3) qualifier = 'confirmed'
  else if (socialPresent && !socialAgree && buzzHigh) qualifier = 'vsSocial'
  else if (thin) qualifier = 'thin'
  else if (socialPresent && socialAgree) qualifier = 'aligned'
  else if (socialPresent && buzzHigh) qualifier = 'crowd'
  else qualifier = 'quiet'

  /* tone — drives the qualifier text color. confirmed/aligned read calm,
     vsSocial/thin read as a divergence flag (the one sanctioned amber). */
  const tone =
    qualifier === 'vsSocial' || qualifier === 'thin'
      ? 'flag'
      : qualifier === 'confirmed' || qualifier === 'aligned'
      ? 'calm'
      : 'neutral'

  /* strength 0-100: combine conviction (distance from coin-flip), momentum
     (|delta|), and social buzz percentile. Warm-white meter — measures
     conviction, not direction. */
  const conviction = Math.min(1, Math.abs(yesPct - 50) / 35) // 0..1
  const momentum = Math.min(1, deltaAbs / 12) // 0..1
  const buzz = socialPresent ? Math.min(1, (buzzHigh ? 0.7 : 0.4) + Math.min(0.3, kolCount * 0.04)) : 0.25
  let strength = Math.round((conviction * 0.45 + momentum * 0.3 + buzz * 0.25) * 100)
  // Divergence caps confidence — the crowd and timeline disagree, so don't
  // over-claim. Toss-ups also can't be high-conviction.
  if (qualifier === 'vsSocial') strength = Math.min(strength, 55)
  if (lean === 'tossup') strength = Math.min(strength, 48)
  strength = Math.max(8, Math.min(99, strength))

  return {
    lean,
    leadLabel: leadLabel || null,
    qualifier,
    deltaDir,
    deltaAbs: Number(deltaAbs.toFixed(1)),
    strength,
    tone,
    kolCount,
  }
}
