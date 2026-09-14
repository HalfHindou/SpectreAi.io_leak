/**
 * Spectre Intelligence — Entity Resolver
 * The gate. Every query passes through resolveEntities() before any external
 * API call. If resolution fails with high confidence, the query returns a
 * disambiguation prompt to the user instead of a wrong result.
 */
const fetch = require('node-fetch');
const db = require('./entityDatabase');

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || '';
const COINGECKO_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';
const COINGECKO_HEADER_KEY = 'x-cg-pro-api-key';

// ═══════════════════════════════════════════════════════════════════════════════
// CANDIDATE EXTRACTION
// Pulls ticker symbols ($BTC) and entity names ("Neural AI") from raw queries.
// ═══════════════════════════════════════════════════════════════════════════════

// Multi-word entity names to detect in queries (longest first for greedy match)
const KNOWN_ENTITY_PHRASES = [
  'spectre ai', 'neural ai', 'zig chain', 'zigchain',
  'bitcoin cash', 'internet computer', 'near protocol',
  'fetch.ai', 'the graph', 'ondo finance', 'akash network',
  'pyth network', 'core dao', 'core scientific',
  'terra luna', 'lido dao', 'palo alto networks',
].sort((a, b) => b.length - a.length);

function extractCandidates(rawQuery) {
  const candidates = [];
  const seen = new Set();
  const q = rawQuery.trim();
  const lower = q.toLowerCase();

  // 1. Extract $TICKER symbols
  const tickerMatches = q.match(/\$([A-Za-z]{1,10})/g) || [];
  for (const t of tickerMatches) {
    const raw = t.replace('$', '').toUpperCase();
    if (!seen.has(raw)) {
      seen.add(raw);
      candidates.push({ raw, ticker: raw, name: null, source: 'ticker' });
    }
  }

  // 2. Extract known multi-word entity phrases
  //    Track individual words so step 3 doesn't re-extract them
  const matchedPhraseWords = new Set();
  for (const phrase of KNOWN_ENTITY_PHRASES) {
    if (lower.includes(phrase)) {
      const key = phrase.replace(/\s+/g, '').toUpperCase();
      if (!seen.has(key) && !seen.has(phrase.toUpperCase())) {
        seen.add(key);
        candidates.push({ raw: phrase, ticker: null, name: phrase, source: 'phrase' });
        phrase.split(/\s+/).forEach(w => matchedPhraseWords.add(w.toUpperCase()));
      }
    }
  }

  // 3. Extract single capitalized words that might be tickers
  //    Skip words that are part of an already-matched phrase (e.g. "AI" from "Neural AI")
  const words = q.split(/\s+/);
  for (const w of words) {
    const clean = w.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (clean.length >= 2 && clean.length <= 6 && !seen.has(clean) && !matchedPhraseWords.has(clean)) {
      const entity = db.lookupByTicker(clean) || db.lookupByName(w.toLowerCase());
      const isAlias = db.tickerAliases[clean] !== undefined;
      const isAmbiguous = db.getAmbiguousOptions(w.toLowerCase());
      if (entity || isAlias || isAmbiguous) {
        seen.add(clean);
        candidates.push({ raw: w, ticker: clean, name: null, source: 'word' });
      }
    }
  }

  return candidates;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CANDIDATE RESOLUTION
// For each candidate, determine confidence: confirmed, ambiguous, or unknown.
// ═══════════════════════════════════════════════════════════════════════════════

async function resolveCandidate(candidate) {
  const { raw, ticker, name } = candidate;

  // Check 1: Exact ticker match (with alias normalization)
  if (ticker) {
    const normalized = db.normalizeTicker(ticker);
    if (normalized.needsDisambiguation) {
      const options = db.getAmbiguousOptions(ticker.toLowerCase()) ||
                      db.getAmbiguousOptions(raw.toLowerCase());
      return {
        raw,
        confidence: 'ambiguous',
        options: options || [{ name: raw, hint: 'Multiple projects use this ticker — please specify' }],
      };
    }
    const entity = db.lookupByTicker(normalized.canonical);
    if (entity) {
      return { ...entity, confidence: 'confirmed', matchedBy: 'ticker' };
    }
  }

  // Check 2: Exact name match
  if (name) {
    const entity = db.lookupByName(name);
    if (entity) {
      return { ...entity, confidence: 'confirmed', matchedBy: 'name' };
    }
  }

  // Check 3: Check ambiguous names
  const ambiguousKey = (name || raw).toLowerCase();
  const ambiguousOptions = db.getAmbiguousOptions(ambiguousKey);
  if (ambiguousOptions) {
    return {
      raw,
      confidence: 'ambiguous',
      options: ambiguousOptions,
    };
  }

  // Check 4: CoinGecko search as verification (fast, authoritative)
  const cgResult = await searchCoinGecko(name || raw);
  if (cgResult) {
    db.addCachedEntity(cgResult);
    return {
      name:        cgResult.name,
      ticker:      cgResult.symbol.toUpperCase(),
      type:        'crypto',
      coingeckoId: cgResult.id,
      confidence:  'confirmed',
      matchedBy:   'coingecko',
    };
  }

  // Unknown — proceed with crypto context injection so Perplexity searches correctly
  return {
    raw,
    name: name || raw,
    confidence: 'unknown',
    type: 'crypto',
    perplexityHint: `${raw} cryptocurrency token OR blockchain project`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COINGECKO SEARCH
// Quick search to verify unknown entities before giving up.
// ═══════════════════════════════════════════════════════════════════════════════

async function searchCoinGecko(query) {
  if (!query || query.length < 2) return null;
  try {
    const url = `${COINGECKO_BASE}/search?query=${encodeURIComponent(query)}`;
    const opts = { headers: {}, signal: AbortSignal.timeout(5000) };
    if (COINGECKO_API_KEY) opts.headers[COINGECKO_HEADER_KEY] = COINGECKO_API_KEY;

    const resp = await fetch(url, opts);
    if (!resp.ok) return null;

    const data = await resp.json();
    const coins = data.coins || [];
    if (coins.length === 0) return null;

    // Find best match — exact symbol or name match gets priority
    const queryUpper = query.toUpperCase().replace(/[^A-Z]/g, '');
    const queryLower = query.toLowerCase().trim();

    // Exact symbol match
    const symbolMatch = coins.find(c => c.symbol.toUpperCase() === queryUpper);
    if (symbolMatch) return symbolMatch;

    // Exact name match
    const nameMatch = coins.find(c => c.name.toLowerCase() === queryLower);
    if (nameMatch) return nameMatch;

    // First result if it has a high market cap rank (top 500)
    const top = coins[0];
    if (top && top.market_cap_rank && top.market_cap_rank <= 500) {
      return top;
    }

    return null;
  } catch (e) {
    console.error('[entity-resolver] CoinGecko search failed:', e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * resolveEntities — the main entry point.
 * Takes a raw query, extracts entities, resolves them, returns resolution result.
 *
 * @param {string} rawQuery - The user's search query
 * @returns {{ resolved, needsDisambiguation, canProceed, isSelfQuery }}
 */
async function resolveEntities(rawQuery) {
  const candidates = extractCandidates(rawQuery);

  const resolved = [];
  const needsDisambiguation = [];

  for (const candidate of candidates) {
    const match = await resolveCandidate(candidate);

    if (match.confidence === 'confirmed') {
      resolved.push(match);
    } else if (match.confidence === 'ambiguous') {
      needsDisambiguation.push({ candidate, options: match.options });
    } else {
      // Unknown — let Perplexity find it but inject crypto context
      resolved.push(match);
    }
  }

  // Self-query detection
  const selfQuery = db.isSelfQuery(rawQuery) ||
    resolved.some(e => e.isInternal === true);

  return {
    resolved,
    needsDisambiguation,
    canProceed: needsDisambiguation.length === 0,
    isSelfQuery: selfQuery,
  };
}

/**
 * resolveKnownEntity — fast path for agents that already know the ticker/name.
 * Skips candidate extraction and CoinGecko search.
 *
 * @param {string} ticker - Known ticker symbol
 * @param {string} [name] - Optional known name
 * @returns {object} Resolved entity or minimal stub
 */
function resolveKnownEntity(ticker, name) {
  if (ticker) {
    const normalized = db.normalizeTicker(ticker);
    const entity = db.lookupByTicker(normalized.canonical);
    if (entity) return { ...entity, confidence: 'confirmed', matchedBy: 'ticker' };
  }
  if (name) {
    const entity = db.lookupByName(name);
    if (entity) return { ...entity, confidence: 'confirmed', matchedBy: 'name' };
  }
  // Not in database — return a minimal stub
  return {
    name: name || ticker,
    ticker: ticker || null,
    type: 'crypto',
    confidence: 'unknown',
    perplexityHint: `${name || ticker} cryptocurrency token`,
  };
}

module.exports = {
  resolveEntities,
  resolveKnownEntity,
  extractCandidates,
};
