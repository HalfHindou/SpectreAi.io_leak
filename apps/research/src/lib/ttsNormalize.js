/**
 * ttsNormalize - Converts financial text into natural spoken language for TTS
 *
 * Transforms ticker symbols into full names, removes symbols,
 * and formats numbers/percentages for speech synthesis.
 *
 * Example: "BTC at $95,000 +3.5%" → "Bitcoin at ninety-five thousand, up three point five percent"
 */

// ── Symbol → Spoken Name Map ──────────────────────────────────────────────────
const TTS_SYMBOLS = {
  // Crypto (uppercase tickers → spoken names)
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana',
  XRP: 'Ripple', ADA: 'Cardano', DOGE: 'Dogecoin',
  DOT: 'Polkadot', AVAX: 'Avalanche', MATIC: 'Polygon',
  LINK: 'Chainlink', UNI: 'Uniswap', AAVE: 'Aave',
  ATOM: 'Cosmos', FIL: 'Filecoin', ARB: 'Arbitrum',
  OP: 'Optimism', APT: 'Aptos', SUI: 'Sui',
  NEAR: 'Near Protocol', FET: 'Fetch AI',
  RENDER: 'Render', INJ: 'Injective', TIA: 'Celestia',
  PEPE: 'Pepe', SHIB: 'Shiba Inu', WIF: 'Dogwifhat',
  BONK: 'Bonk', FLOKI: 'Floki',

  // Stocks (uppercase tickers → spoken names)
  AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'Nvidia',
  GOOGL: 'Alphabet', GOOG: 'Alphabet', TSLA: 'Tesla',
  AMZN: 'Amazon', META: 'Meta', NFLX: 'Netflix',
  CRM: 'Salesforce', AMD: 'A M D', INTC: 'Intel',
  ORCL: 'Oracle', ADBE: 'Adobe', PYPL: 'PayPal',
  DIS: 'Disney', BA: 'Boeing', JPM: 'J P Morgan',
  V: 'Visa', MA: 'Mastercard', WMT: 'Walmart',
  KO: 'Coca-Cola', PEP: 'Pepsi', JNJ: 'Johnson and Johnson',
  PFE: 'Pfizer', UNH: 'United Health',

  // Indices & ETFs
  SPY: 'the S and P 500',
  QQQ: 'the Nasdaq 100',
  DIA: 'the Dow Jones',
  IWM: 'the Russell 2000',
  GLD: 'the Gold ETF',
  VIX: 'the VIX',
}

// Sort by key length descending so longer tickers match first (e.g., GOOGL before GOO)
const SORTED_SYMBOLS = Object.entries(TTS_SYMBOLS)
  .sort((a, b) => b[0].length - a[0].length)

/**
 * Main normalization function
 */
export function ttsNormalize(text) {
  if (!text) return ''
  let result = text

  // 1. Replace S&P before general & replacement
  result = result.replace(/S&P\s*500/gi, 'the S and P 500')
  result = result.replace(/S&P/gi, 'the S and P')

  // 2. Replace ticker symbols with spoken names (word-boundary safe)
  for (const [sym, name] of SORTED_SYMBOLS) {
    // Only match standalone tickers, not inside words
    const regex = new RegExp(`\\b${sym}\\b`, 'g')
    result = result.replace(regex, name)
  }

  // 3. Handle percentage patterns before removing symbols
  // "+3.5%" → "up 3.5 percent"
  result = result.replace(/\+(\d+(?:\.\d+)?)\s*%/g, 'up $1 percent')
  // "-3.5%" → "down 3.5 percent"
  result = result.replace(/-(\d+(?:\.\d+)?)\s*%/g, 'down $1 percent')
  // Standalone "3.5%" → "3.5 percent"
  result = result.replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 percent')

  // 4. Handle dollar amounts
  // "$95,000" → "95,000 dollars" (keep commas for now, they help TTS pacing)
  result = result.replace(/\$(\d[\d,]*(?:\.\d+)?)/g, '$1 dollars')
  // Remove any remaining $ signs
  result = result.replace(/\$/g, '')

  // 5. Replace & with "and"
  result = result.replace(/&/g, 'and')

  // 6. Clean up dashes/bullets/markdown
  result = result.replace(/[*_~`#]/g, '')
  result = result.replace(/\s*[—–]\s*/g, ', ')
  result = result.replace(/\s*-\s*/g, ' ')

  // 7. Fix double-article from already-normalized text ("the the VIX" → "the VIX")
  result = result.replace(/\bthe the\b/gi, 'the')

  // 8. Collapse whitespace
  result = result.replace(/\s+/g, ' ').trim()

  return result
}

export default ttsNormalize
