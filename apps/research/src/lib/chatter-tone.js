/**
 * chatter-tone.js — sample-based sentiment read for a token's mentions.
 *
 * X Dash ranks by MENTION VOLUME / velocity, which is direction- AND tone-blind:
 * a token can surface on a mention spike whether the crowd is bullish
 * ("accumulating, huge next week") or FUD ("rug, dead, avoid"). Price direction
 * alone does NOT tell them apart — we verified $VENA down -37% with fully
 * bullish/promotional chatter (a dip with support, not FUD). The only honest
 * FUD signal is the TONE of the speech.
 *
 * The X Dash payload carries raw tweet text but NO sentiment classification, so
 * this is a lightweight lexicon read over whatever mention sample we have —
 * explicitly SAMPLE-BASED, not a substitute for a real per-tweet classifier
 * (the proper fix is a data-lane worker emitting negative-share per token). It
 * answers one question: does the crowd around this token read bullish or is
 * there real negative/FUD chatter?
 */

// Crypto-aware term sets. Kept deliberately high-precision — a term only counts
// when it's unambiguous in a trading context.
const BULL = [
  'bullish', 'buy the dip', 'buying', 'accumulat', 'aping', 'loading', 'send it',
  'sending', 'moon', 'lfg', 'based', 'undervalued', 'gem', 'early', 'breakout',
  'holding strong', 'diamond', 'inevitable', 'on fire', 'cooking', 'printing',
  'listed on', 'now live', 'live on', 'burn', 'burned', 'staking', 'partnership',
  'shipping', 'roadmap', '100x', '10x', 'next leg', 'reversal', 'bottom is in',
  'huge', 'massive', 'runner', 'pumping',
]
const BEAR = [
  'rug', 'rugged', 'scam', 'ponzi', 'honeypot', 'is dead', 'dead coin', 'jeet',
  'jeeted', 'rekt', 'exit liquidity', 'dumping', 'dumped', 'avoid', 'stay away',
  'bearish', 'sell off', 'selloff', 'crashing', 'panic', 'down bad', 'fumbled',
  'abandoned', 'abandon', 'fake', 'honeypotted', 'get out', 'over for', 'ngmi',
  'bagholders', 'bagholder', 'liquidated', 'red flag', 'sketchy',
]

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ') // strip URLs (link spam skews term counts)
    .replace(/[@$]\w+/g, ' ')        // strip handles / cashtags
    .replace(/\s+/g, ' ')
}

function classifyOne(text) {
  const t = normalize(text)
  if (!t.trim()) return null
  let bull = 0
  let bear = 0
  for (const w of BULL) if (t.includes(w)) bull += 1
  for (const w of BEAR) if (t.includes(w)) bear += 1
  // Protective anti-scam PSAs read as "warning ... official contract" — not FUD.
  if (bear && /official (contract|token|link)|verified contract|only official/.test(t)) bear -= 1
  if (bull === 0 && bear === 0) return 'neutral'
  if (bear > bull) return 'bear'
  if (bull > bear) return 'bull'
  return 'neutral'
}

/**
 * @param {string[]} texts - tweet/mention texts
 * @returns {{ sample, bull, bear, neutral, bullShare, bearShare, tone, label } | null}
 *   tone: 'bullish' | 'mixed' | 'negative' | 'quiet'
 */
export function classifyChatter(texts) {
  const arr = Array.isArray(texts) ? texts.filter(Boolean) : []
  let bull = 0
  let bear = 0
  let neutral = 0
  for (const txt of arr) {
    const c = classifyOne(txt)
    if (c === 'bull') bull += 1
    else if (c === 'bear') bear += 1
    else if (c === 'neutral') neutral += 1
  }
  const sample = bull + bear + neutral
  if (sample === 0) return null
  const bullShare = bull / sample
  const bearShare = bear / sample
  // Tone verdict. "negative" only when bearish speech is both material AND
  // outweighs bullish — real FUD, not a lone skeptic.
  let tone = 'mixed'
  if (bearShare >= 0.25 && bear > bull) tone = 'negative'
  else if (bullShare >= 0.35 && bull >= bear) tone = 'bullish'
  else if (bull === 0 && bear === 0) tone = 'quiet'
  const label = tone === 'negative' ? 'Negative / FUD-leaning'
    : tone === 'bullish' ? 'Bullish / promotional'
    : tone === 'quiet' ? 'No clear tone'
    : 'Mixed'
  return { sample, bull, bear, neutral, bullShare, bearShare, tone, label }
}
