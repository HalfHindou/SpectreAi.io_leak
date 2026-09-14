/**
 * Hype Forensics — decompose a token's X attention into ORGANIC vs ENGINEERED
 * and name the tactic. Pure functions over a tweet corpus (+ optional token
 * metrics). Built for the X Dash "Research" tab.
 *
 * The thesis (validated on Aster): manufactured hype leaves fingerprints that
 * organic hype doesn't — paste-the-brief copy across accounts, sub-1k-follower
 * amplifier rings, reward/airdrop-bait language, a few accounts owning the
 * reach, and a huge impression count with near-zero genuine engagement. Each
 * signal returns a 0..1 "manufactured" contribution + human-readable evidence,
 * and we fuse them into a 0..100 Manufactured-Hype Score.
 */

const num = (v) => {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}
const clamp01 = (x) => Math.max(0, Math.min(1, x))
const pct = (x) => `${Math.round(x * 100)}%`

const REWARD_BAIT_RE = /\b(airdrop|points?|rewards?|farm(?:ing)?|voting|vote|quest|task|campaign|giveaway|whitelist|allowlist|retweet to|rt &|rt and|tag \d|engage to earn|active every day|daily reward)\b/i

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'are', 'you', 'your', 'has', 'have', 'will', 'from', 'all', 'its'])

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9$@ ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
}

/** Repeated multi-word phrases across DISTINCT authors = paste-the-brief campaign. */
function detectCopypasta(tweets) {
  const N = 5
  const phraseAuthors = new Map() // phrase -> Set(authors)
  for (const t of tweets) {
    const w = tokenize(t.text)
    const seen = new Set()
    for (let i = 0; i + N <= w.length; i++) {
      const g = w.slice(i, i + N).join(' ')
      if (seen.has(g)) continue
      seen.add(g)
      if (!phraseAuthors.has(g)) phraseAuthors.set(g, new Set())
      phraseAuthors.get(g).add(t.username || '?')
    }
  }
  let best = null
  let bestN = 1
  for (const [g, authors] of phraseAuthors) {
    if (authors.size > bestN) { best = g; bestN = authors.size }
  }
  const authorsTotal = new Set(tweets.map((t) => t.username || '?')).size || 1
  // share of authors echoing the single most-repeated brief phrase
  const score = clamp01((bestN - 1) / Math.max(3, authorsTotal * 0.35))
  return {
    score,
    repeatAuthors: bestN,
    phrase: best,
  }
}

/**
 * @param {{tweets: Array, token?: {symbol?, name?, marketCap?}, claimedImpressions?: number}} input
 */
export function computeHypeForensics({ tweets = [], token = {}, claimedImpressions = 0 } = {}) {
  const sample = tweets.filter((t) => t && (t.text || t.username))
  const n = sample.length
  if (!n) {
    return { score: null, organicPct: null, signals: [], tactics: [], sampleSize: 0, confidence: 'none' }
  }

  const authors = new Set(sample.map((t) => t.username || '?'))
  const views = sample.reduce((s, t) => s + num(t.views), 0)
  const engagement = sample.reduce((s, t) => s + num(t.likes) + num(t.retweets) + num(t.replies), 0)
  const er = views > 0 ? engagement / views : null

  // 1. Engagement-rate gap — bought impressions can't fake genuine engagement.
  //    organic crypto ~0.3-1%; <0.1% with real reach = inflated/bought views.
  const erScore = er == null ? 0 : clamp01((0.005 - er) / 0.0048)
  const engagementGap = {
    key: 'engagementGap',
    label: 'Engagement-rate gap',
    weight: 0.22,
    score: er == null ? 0 : erScore,
    detail: er == null
      ? 'No impression data in sample.'
      : `${(er * 100).toFixed(2)}% engagement on ${views.toLocaleString()} impressions (organic ≈ 0.3–1%${er < 0.001 ? ' — bought-views pattern' : ''}).`,
  }

  // 2. Copypasta — paste-the-brief campaign across accounts.
  const cp = detectCopypasta(sample)
  const copypasta = {
    key: 'copypasta',
    label: 'Copy-paste campaign',
    weight: 0.20,
    score: cp.score,
    detail: cp.phrase && cp.repeatAuthors > 1
      ? `Identical brief copy across ${cp.repeatAuthors} accounts: “${cp.phrase}”.`
      : 'No shared campaign copy detected in sample.',
  }

  // 3. Amplifier quality — sub-1k / sock-account rings.
  const withFollowers = sample.filter((t) => num(t.followers) > 0)
  const tiny = withFollowers.filter((t) => num(t.followers) < 1000).length
  const tinyShare = withFollowers.length ? tiny / withFollowers.length : 0
  const amplifierQuality = {
    key: 'amplifierQuality',
    label: 'Amplifier quality',
    weight: 0.16,
    score: clamp01((tinyShare - 0.2) / 0.5),
    detail: withFollowers.length
      ? `${pct(tinyShare)} of amplifiers have <1k followers (${tiny}/${withFollowers.length}).`
      : 'No follower data in sample.',
  }

  // 4. Reward-bait — incentivized engagement (points/airdrop/voting).
  const baited = sample.filter((t) => REWARD_BAIT_RE.test(t.text || '')).length
  const baitShare = baited / n
  const rewardBait = {
    key: 'rewardBait',
    label: 'Incentivized engagement',
    weight: 0.16,
    score: clamp01((baitShare - 0.1) / 0.5),
    detail: baited
      ? `${pct(baitShare)} of posts use reward/airdrop/points/voting bait (${baited}/${n}).`
      : 'No reward-bait language detected.',
  }

  // 5. Reach concentration — a few accounts own most of the impressions (paid ring).
  const byViews = [...sample].sort((a, b) => num(b.views) - num(a.views))
  const top3Views = byViews.slice(0, 3).reduce((s, t) => s + num(t.views), 0)
  const concShare = views > 0 ? top3Views / views : 0
  const authorConcentration = {
    key: 'authorConcentration',
    label: 'Reach concentration',
    weight: 0.14,
    score: clamp01((concShare - 0.4) / 0.5),
    detail: views > 0
      ? `Top 3 accounts drive ${pct(concShare)} of all impressions (${authors.size} authors total).`
      : `${authors.size} distinct authors in sample.`,
  }

  // 6. Social ÷ on-chain divergence — huge attention, thin market (optional).
  const mcap = num(token.marketCap)
  const impressionBase = claimedImpressions || views
  let socialVsOnchain = null
  if (mcap > 0 && impressionBase > 0) {
    // impressions per $1M mcap; >~150k/$1M is attention far ahead of the market
    const ratio = impressionBase / (mcap / 1e6)
    socialVsOnchain = {
      key: 'socialVsOnchain',
      label: 'Social ≫ on-chain',
      weight: 0.12,
      score: clamp01((ratio - 80000) / 400000),
      detail: `${impressionBase.toLocaleString()} impressions against $${(mcap / 1e6).toFixed(1)}M mcap — attention ${ratio > 150000 ? 'far ahead of' : 'roughly in line with'} the market.`,
    }
  }

  const signals = [engagementGap, copypasta, amplifierQuality, rewardBait, authorConcentration]
  if (socialVsOnchain) signals.push(socialVsOnchain)

  // Combine signals into the 0-100 manufactured score. A pure weighted mean
  // dilutes a strong smoking-gun signal among the zeros — e.g. a blatant
  // sub-1k amplifier ring + reach concentration but clean engagement would
  // average out to "organic", which is wrong and contradicts the tactics we
  // flag. Blend the weighted mean with the single STRONGEST signal so clear
  // manufacturing on any one axis still moves the verdict. Forensics is about
  // catching the tactic, not averaging it away.
  const wsum = signals.reduce((s, x) => s + x.weight, 0)
  const weightedMean = signals.reduce((s, x) => s + x.score * x.weight, 0) / wsum
  const topSignal = signals.reduce((m, x) => Math.max(m, x.score), 0)
  const score = Math.round(clamp01(weightedMean * 0.62 + topSignal * 0.38) * 100)
  const organicPct = 100 - score

  // Name the tactics that actually fired (score above a meaningful threshold).
  const TACTIC = {
    copypasta: 'Paste-the-brief KOL campaign',
    rewardBait: 'Incentivized engagement farming',
    amplifierQuality: 'Sock / sub-1k amplifier ring',
    authorConcentration: 'Paid anchor-KOL concentration',
    engagementGap: 'Bought / inflated impressions',
    socialVsOnchain: 'Attention front-running the market',
  }
  const tactics = signals.filter((x) => x.score >= 0.5).map((x) => TACTIC[x.key]).filter(Boolean)

  const confidence = n >= 40 ? 'medium' : n >= 18 ? 'low' : 'very low'

  return {
    score,
    organicPct,
    verdict: score >= 66 ? 'engineered' : score >= 40 ? 'mixed' : 'organic',
    signals: signals.sort((a, b) => b.score * b.weight - a.score * a.weight),
    tactics,
    sampleSize: n,
    authors: authors.size,
    impressions: views,
    engagementRate: er,
    confidence,
  }
}

/** Build the LLM context block: the computed verdict + signals + a few exemplar tweets. */
export function buildForensicContext(forensics, token, tweets) {
  if (!forensics || forensics.score == null) return ''
  const sym = (token.symbol || '').replace(/^\$/, '').toUpperCase()
  const lines = []
  lines.push(`[SPECTRE_HYPE_FORENSICS token=$${sym}${token.name ? ` name="${token.name}"` : ''}]`)
  lines.push(`Manufactured-Hype Score: ${forensics.score}/100 (verdict: ${forensics.verdict}). Sample: ${forensics.sampleSize} tweets, ${forensics.authors} authors, ${forensics.impressions.toLocaleString()} impressions, ER ${forensics.engagementRate != null ? (forensics.engagementRate * 100).toFixed(2) + '%' : 'n/a'}. Confidence: ${forensics.confidence}.`)
  lines.push('SIGNALS (manufactured contribution 0-100 + evidence):')
  for (const s of forensics.signals) {
    lines.push(`- ${s.label} [${Math.round(s.score * 100)}]: ${s.detail}`)
  }
  if (forensics.tactics.length) lines.push(`DETECTED TACTICS: ${forensics.tactics.join('; ')}.`)
  const exemplars = [...tweets].sort((a, b) => num(b.views) + num(b.likes) * 50 - (num(a.views) + num(a.likes) * 50)).slice(0, 8)
  lines.push('EXEMPLAR POSTS (author · followers · views · likes — text):')
  for (const t of exemplars) {
    lines.push(`- @${t.username} · ${num(t.followers).toLocaleString()}f · ${num(t.views).toLocaleString()}v · ${num(t.likes)}♥ — ${String(t.text || '').replace(/\s+/g, ' ').slice(0, 180)}`)
  }
  return lines.join('\n')
}

export const FORENSIC_DIRECTIVE = (sym) =>
  `You are Spectre's social-forensics analyst. The "Manufactured-Hype Score" in the block above is Spectre's COMPUTED verdict — it is authoritative. You MUST anchor to it and MUST NOT state a different percentage anywhere (don't say "70% engineered" if the score is 41). Using ONLY the forensics block + exemplar posts, write a tight teardown of $${sym}'s X attention: (1) one line restating the verdict verbatim — "$${sym} looks <verdict> — ~<that exact score>% manufactured" — plus the single biggest driver; (2) HOW — name the concrete tactic(s) that drove the score, quoting the specific evidence (the copy, the follower/ER/concentration numbers given); (3) what the REAL organic signal underneath is, if any; (4) one line on what would move the score. Cite only the numbers/quotes given; invent nothing. No hedging filler. Lead with the verdict.`
