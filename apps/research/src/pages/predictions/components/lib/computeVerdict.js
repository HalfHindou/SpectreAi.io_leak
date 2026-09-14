/**
 * computeVerdict — the deterministic Signal Verdict synthesis.
 *
 * One confident read per market: market odds + (optional) X social momentum +
 * (optional) volume velocity → a lean, a qualifier, a strength score, and a
 * one-sentence template. The structure is ALWAYS deterministic so it never
 * reads as hedge-everything AI slop; an LLM sentence (detail page) can replace
 * `text` while the lean/qualifier stay computed here.
 *
 * No LLM, no network. Pure function of the three inputs the grid already has.
 *
 * @param {Object} input
 * @param {number} input.yesPct        - leading-outcome yes probability (0-100)
 * @param {number} [input.delta]       - 24h change in points (oneDayPriceChange*100)
 * @param {string} [input.leadLabel]   - candidate name for multi-outcome ('' = binary)
 * @param {Object} [input.social]      - { aligns, buzzPercentile, present } 0-1
 * @param {number} [input.velocity]    - vol24h / totalVolume (0-1+), proxy for trade activity
 * @returns {{ lean, leanWord, qualifier, qualifierTone, strength, deltaSign, text }}
 */
export function computeVerdict({ yesPct = 50, delta = 0, leadLabel = '', social = null, velocity = 0 } = {}) {
  const pct = clampPct(yesPct)
  const d = Number.isFinite(delta) ? delta : 0
  const absDelta = Math.abs(d)

  // ── Lean ───────────────────────────────────────────────────────
  // Binary markets read Yes/No; multi-outcome reads the leading candidate.
  let lean // 'yes' | 'no' | 'toss'
  let leanWord
  if (pct >= 55) { lean = 'yes'; leanWord = leadLabel || 'Yes' }
  else if (pct <= 45) { lean = 'no'; leanWord = leadLabel ? leadLabel : 'No' }
  else { lean = 'toss'; leanWord = leadLabel || 'Toss-up' }

  // ── Social agreement ───────────────────────────────────────────
  const socialPresent = !!(social && social.present)
  const socialAligns = !!(social && social.aligns)
  const buzz = social && Number.isFinite(social.buzzPercentile) ? social.buzzPercentile : 0
  const thinVol = velocity > 0 && velocity < 0.02 // <2% of lifetime volume traded in 24h

  // ── Qualifier ──────────────────────────────────────────────────
  let qualifier
  let qualifierTone // 'confirm' | 'align' | 'diverge' | 'thin' | 'quiet' | 'odds'
  if (socialPresent && socialAligns && absDelta >= 3) { qualifier = 'social-confirmed'; qualifierTone = 'confirm' }
  else if (socialPresent && socialAligns) { qualifier = 'social-aligned'; qualifierTone = 'align' }
  else if (socialPresent && !socialAligns) { qualifier = 'vs social'; qualifierTone = 'diverge' }
  else if (buzz >= 0.6 && thinVol) { qualifier = 'crowd-driven, thin'; qualifierTone = 'thin' }
  else if (socialPresent && buzz < 0.2) { qualifier = 'quiet'; qualifierTone = 'quiet' }
  else { qualifier = `${pct}%`; qualifierTone = 'odds' } // odds-only fallback (no social loaded)

  // ── Strength (0-100 conviction) ────────────────────────────────
  // distance from coin-flip + momentum + buzz, capped.
  const edge = Math.min(1, Math.abs(pct - 50) / 35) // 50→0, 85+→1
  const mo = Math.min(1, absDelta / 12)
  const strength = Math.round(Math.min(100, edge * 55 + mo * 25 + buzz * 20))

  const deltaSign = d > 0 ? 'up' : d < 0 ? 'down' : 'flat'

  return {
    lean,
    leanWord,
    qualifier,
    qualifierTone,
    strength,
    deltaSign,
    delta: d,
    yesPct: pct,
    text: buildSentence({ pct, leanWord, lean, d, absDelta, deltaSign, socialPresent, socialAligns, buzz, thinVol, leadLabel }),
  }
}

function buildSentence({ pct, leanWord, lean, d, absDelta, deltaSign, socialPresent, socialAligns, buzz, thinVol, leadLabel }) {
  const subject = leadLabel ? `${leadLabel}` : 'The market'
  const verb = leadLabel ? 'leads' : (lean === 'toss' ? 'sits' : 'leans')
  const leanClause = lean === 'toss'
    ? `${subject} ${verb} near a coin-flip at ${pct}%`
    : `${subject} ${verb}${leadLabel ? '' : ` ${lean === 'yes' ? 'Yes' : 'No'}`} at ${pct}%`

  let move = ''
  if (absDelta >= 1) {
    move = `, ${deltaSign === 'up' ? 'up' : 'down'} ${Math.round(absDelta)} ${absDelta >= 2 ? 'points' : 'point'} in 24 hours`
  }

  let socialClause = ''
  if (socialPresent) {
    if (socialAligns && buzz >= 0.5) socialClause = ' Social momentum is heavy and aligned — conviction is building, not fading.'
    else if (socialAligns) socialClause = ' The timeline agrees with the price.'
    else socialClause = ' The crowd and the timeline disagree — watch for a snap.'
  } else if (thinVol) {
    socialClause = ' Volume is thin behind the move — treat the read as soft.'
  } else if (lean === 'toss') {
    socialClause = ' No edge here yet.'
  }

  return `${leanClause}${move}.${socialClause}`.trim()
}

function clampPct(n) {
  if (!Number.isFinite(n)) return 50
  return Math.max(0, Math.min(100, Math.round(n)))
}
