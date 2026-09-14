/**
 * The daily-generation universe: which tokens and stocks get an analysis.
 *
 * Extracted from scheduler.js so the box worker (pm2 `spectre-newsroom`,
 * /opt/spectre-newsroom/newsroom.js) can read the SAME lists without importing
 * the scheduler — which transitively requires rwaAnalysisAgent ->
 * ../routes/rwa, an Express route module that does not exist outside the app.
 *
 * Keep this as the single definition. scheduler.js re-exports it, so nothing
 * that imported it from there has to change.
 */

// 25 tokens
const CRYPTO_TARGETS = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT',
  'UNI', 'LTC', 'SHIB', 'ARB', 'OP', 'PEPE', 'AAVE', 'MKR', 'RENDER', 'INJ',
  'SUI', 'APT', 'TIA', 'SEI', 'BONK',
];

// 27 stocks
const STOCK_TARGETS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V',
  'JNJ', 'UNH', 'HD', 'PG', 'MA', 'DIS', 'NFLX', 'PYPL', 'ADBE', 'CRM',
  'INTC', 'AMD', 'LLY', 'ORCL', 'COIN', 'PLTR', 'ARM', 'KO',
];

module.exports = { CRYPTO_TARGETS, STOCK_TARGETS };
