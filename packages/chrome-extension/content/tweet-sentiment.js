/**
 * Spectre AI — Tweet Sentiment Analyzer
 * Keyword-based tweet sentiment classification + alignment computation.
 * No external NLP — fast, pure heuristic approach.
 */

// ─── Keyword Lists ───────────────────────────────────────────────
const BULLISH_WORDS = [
  'pump', 'moon', 'mooning', 'bullish', 'buy', 'buying', 'long',
  'breakout', 'accumulate', 'accumulating', 'hodl', 'hold', 'holding',
  'wagmi', 'lfg', 'parabolic', 'rally', 'rallying', 'surge', 'surging',
  'gem', 'alpha', 'diamond', 'diamondhands', 'undervalued', 'cheap',
  'dip', 'btd', 'buythedip', 'rocket', 'launch', 'launching',
  'explode', 'exploding', 'massive', 'huge', 'insane', 'send',
  'sending', 'rip', 'ripping', 'fire', 'bullrun', 'supercycle',
  'green', 'gains', 'gainz', 'profit', 'winner',
];

const BEARISH_WORDS = [
  'dump', 'dumping', 'crash', 'crashing', 'short', 'shorting',
  'sell', 'selling', 'rug', 'rugged', 'rugpull', 'scam', 'scamming',
  'bearish', 'rekt', 'wrecked', 'ngmi', 'capitulation', 'capitulating',
  'bleeding', 'bleed', 'fade', 'fading', 'ponzi', 'bubble',
  'overvalued', 'overbought', 'top', 'topped', 'dead', 'dying',
  'tank', 'tanking', 'plunge', 'plunging', 'collapse', 'collapsing',
  'exit', 'exiting', 'red', 'loss', 'losing', 'bag', 'bagholder',
];

// Pre-compile regex patterns for performance (word-boundary, case-insensitive)
const bullishPatterns = BULLISH_WORDS.map(w => new RegExp(`\\b${w}\\b`, 'i'));
const bearishPatterns = BEARISH_WORDS.map(w => new RegExp(`\\b${w}\\b`, 'i'));

/**
 * Analyze tweet text for bullish/bearish/neutral sentiment.
 * @param {string} text - The tweet text to analyze
 * @returns {'bullish' | 'bearish' | 'neutral'}
 */
export function analyzeTweetSentiment(text) {
  if (!text || typeof text !== 'string') return 'neutral';

  let score = 0;
  for (const pattern of bullishPatterns) {
    if (pattern.test(text)) score++;
  }
  for (const pattern of bearishPatterns) {
    if (pattern.test(text)) score--;
  }

  if (score > 0) return 'bullish';
  if (score < 0) return 'bearish';
  return 'neutral';
}

/**
 * Walk up the DOM from a cashtag element to find the parent tweet text.
 * @param {HTMLElement} cashtagElement
 * @returns {string|null}
 */
export function getTweetText(cashtagElement) {
  let el = cashtagElement;
  for (let i = 0; i < 10 && el; i++) {
    el = el.parentElement;
    if (!el) break;
    if (el.getAttribute?.('data-testid') === 'tweetText') {
      return el.textContent || null;
    }
  }
  return null;
}

/**
 * Compute alignment between tweet sentiment and token data.
 * @param {'bullish'|'bearish'|'neutral'} tweetSentiment
 * @param {number} change24 - 24h price change percentage
 * @param {string} aiPulseState - AI pulse state (RISK_ON, RISK_OFF, EUPHORIA, NEUTRAL)
 * @returns {'agree' | 'disagree' | 'neutral'}
 */
export function computeAlignment(tweetSentiment, change24, aiPulseState) {
  if (tweetSentiment === 'neutral') return 'neutral';

  // Determine data signal direction
  const changeVal = parseFloat(change24) || 0;
  const positivePulse = ['RISK_ON', 'EUPHORIA'].includes(aiPulseState);
  const negativePulse = ['RISK_OFF'].includes(aiPulseState);

  let dataSignal = 'neutral';
  if (changeVal > 2 || (changeVal > 0 && positivePulse)) {
    dataSignal = 'positive';
  } else if (changeVal < -2 || (changeVal < 0 && negativePulse)) {
    dataSignal = 'negative';
  }

  if (dataSignal === 'neutral') return 'neutral';

  // Compare tweet vs data
  if (tweetSentiment === 'bullish' && dataSignal === 'positive') return 'agree';
  if (tweetSentiment === 'bullish' && dataSignal === 'negative') return 'disagree';
  if (tweetSentiment === 'bearish' && dataSignal === 'negative') return 'agree';
  if (tweetSentiment === 'bearish' && dataSignal === 'positive') return 'disagree';

  return 'neutral';
}
