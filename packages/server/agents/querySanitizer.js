/**
 * Spectre Intelligence — Universal Query Sanitization Layer
 * Thin wrapper that delegates entity data to entityDatabase.js.
 *
 * Still handles:
 * - Ticker extraction and normalization (via entityDatabase)
 * - Self-query detection (via entityDatabase)
 * - Stale data risk flagging
 * - "No data found" vs "no activity" distinction
 *
 * Entity disambiguation and Perplexity prompt hardening
 * are now handled by entityResolver.js and perplexityGate.js.
 */

const db = require('./entityDatabase');

// ── SPECTRE KNOWN IDENTITIES ────────────────────────────────────────────────
// Used by the self-query response in index.js for content generation.
// This is a content template, not entity resolution data.
const SPECTRE_IDENTITIES = {
  coingeckoIds:     ['spectre-ai', 'spectre-token', 'spectre'],
  chain:            'Ethereum (ERC-20)',
  launched:         'November 2023',
  maxSupply:        10_000_000,
  supplyType:       'fixed',
  hasTokenUnlocks:  false,
  hasTeamVesting:   false,
  xHandle:          '@Spectre__AI',
  founderXHandle:   '@Sunny_Enzo',
  telegramChannel:  'telegram.me/SpectreAI',
  website:          'https://spectreai.io',

  team: [
    {
      name:     'Sunny',
      role:     'Founder & CEO',
      xHandle:  '@Sunny_Enzo',
      linkedin: null,
      bio:      'Founded Spectre AI in 2023. Building AI-powered market intelligence for crypto and stock traders.',
    },
    {
      name:     'Alaa',
      role:     'CTO',
      xHandle:  null,
      linkedin: null,
    },
    {
      name:     'Evgeniy',
      role:     'Frontend Developer',
      xHandle:  null,
      linkedin: null,
    },
  ],

  notToBe: [
    'Spectre.Ai — binary options trading platform, Cayman Islands, completely unrelated',
    'Spectral (SPEC) — zkML-focused, $29.75M raised, different project entirely',
    'Spectre Network (SPR) — blockDAG L1, different project entirely',
  ],
};

// ── STALE DATA RISK PATTERNS ────────────────────────────────────────────────
const STALE_PRONE_QUERIES = [
  /current price/i, /price of/i, /what is .* trading at/i,
  /market cap/i, /24h volume/i, /\bath\b/i, /all.time high/i,
];

// ── DATA STATES ─────────────────────────────────────────────────────────────
const DATA_STATES = {
  FOUND:          'data found and returned',
  NOT_FOUND:      'query returned no results — DO NOT interpret as "no activity"',
  UNAVAILABLE:    'source explicitly unavailable (API down, rate limited)',
  INTERNAL_ONLY:  'data exists internally, external search skipped',
};

// ── CORE FUNCTIONS (delegate to entityDatabase) ─────────────────────────────

function extractTickers(query) {
  const matches = query.match(/\$([A-Za-z]{1,10})/g) || [];
  return matches.map(t => t.replace('$', '').toUpperCase());
}

function normalizeTicker(input) {
  return db.normalizeTicker(input);
}

function rewriteTickersInQuery(query, rawTickers, resolvedTickers) {
  let rewritten = query;
  for (let i = 0; i < rawTickers.length; i++) {
    const raw = rawTickers[i];
    const resolved = resolvedTickers[i];
    if (raw !== resolved.canonical) {
      rewritten = rewritten.replace(
        new RegExp(`\\$${raw}\\b`, 'gi'),
        `$${resolved.canonical}`
      );
    }
  }
  return rewritten;
}

function isSelfQuery(query) {
  return db.isSelfQuery(query);
}

/**
 * sanitizeQuery — the main entry point.
 * Called on EVERY user query before any agent, API call, or Perplexity request.
 */
function sanitizeQuery(rawQuery) {
  const result = {
    original:         rawQuery,
    normalized:       rawQuery,
    detectedTickers:  [],
    resolvedTickers:  [],
    queryType:        null,
    flags:            [],
    blockedSources:   [],
    preferInternal:   false,
    isSelfQuery:      false,
  };

  // STEP 1: Extract all tickers
  const rawTickers = extractTickers(rawQuery);
  result.detectedTickers = rawTickers;

  // STEP 2: Normalize all tickers (via entityDatabase)
  result.resolvedTickers = rawTickers.map(t => normalizeTicker(t));
  result.normalized = rewriteTickersInQuery(rawQuery, rawTickers, result.resolvedTickers);

  // STEP 3: Detect entity ambiguity
  for (const resolved of result.resolvedTickers) {
    if (resolved.needsDisambiguation) {
      result.flags.push({
        type:    'NEEDS_DISAMBIGUATION',
        ticker:  resolved.ticker,
        action:  'Entity resolver will handle disambiguation',
      });
    }
  }

  // STEP 4: Detect self-query (via entityDatabase)
  if (isSelfQuery(result.normalized) || isSelfQuery(rawQuery)) {
    result.queryType = 'SELF';
    result.isSelfQuery = true;
    result.preferInternal = true;
    result.blockedSources = ['perplexity', 'web_search', 'reddit', 'github'];
  }

  // STEP 5: Detect stale data risk
  if (STALE_PRONE_QUERIES.some(p => p.test(rawQuery))) {
    result.flags.push({
      type:   'STALE_DATA_RISK',
      action: 'Use internal price feed, not Perplexity, for all price/market data',
    });
    result.blockedSources.push('perplexity_for_price');
  }

  return result;
}

/**
 * buildDisambiguatedPrompt — legacy function for backward compatibility.
 * The perplexityGate now handles entity-aware prompt building.
 * This is still used by the deep mode pipeline until fully migrated.
 */
function buildDisambiguatedPrompt(query, sanitized) {
  let prompt = query;
  const notes = [];

  // ── SPECTRE-SPECIFIC DISAMBIGUATION ──
  const mentionsSpectre = /\bspectre\b|\bspect\b|\$spectre|\$spect/i.test(query);
  if (mentionsSpectre) {
    notes.push(
      `CRITICAL DISAMBIGUATION — SPECTRE / $SPECTRE / $SPECT:
The user is asking about Spectre AI (ticker: $SPECTRE, also referred to as $SPECT).
- Spectre AI is a crypto and stock market intelligence platform (website: spectreai.io, X: @Spectre__AI).
- It is an ERC-20 token on Ethereum, launched November 2023, founded by Sunny (@Sunny_Enzo).
- It is NOT a UK-registered company. "SPECTRE AI LTD" (UK Companies House No. 16445942) is a completely unrelated entity — do NOT include any information about it.
- It is NOT Spectre.Ai (binary options platform, Cayman Islands) — completely unrelated.
- It is NOT Spectral (ticker: $SPEC, zkML protocol) — different project entirely.
- It is NOT Spectre Network (ticker: $SPR, blockDAG L1) — different project entirely.
Only return information about the crypto intelligence platform Spectre AI ($SPECTRE on Ethereum).`
    );
  }

  // ── NEURAL AI-SPECIFIC DISAMBIGUATION ──
  const mentionsNeural = /\bneural\s*ai\b|\$neural\b|\bneuralai\b/i.test(query);
  if (mentionsNeural) {
    notes.push(
      `CRITICAL DISAMBIGUATION — NEURAL / $NEURAL / NEURALAI:
The user is asking about Neural AI ($NEURAL), a cryptocurrency token.
- Neural AI is an AI-powered crypto asset management platform (Twitter/X: @GoNeuralAI).
- Ticker: NEURALAI (short: NEURAL) on Binance Smart Chain (BSC).
- This is NOT about artificial neural networks, machine learning concepts, or computer science.
- This is NOT about academic AI research or neural network architectures.
Only return information about the Neural AI crypto token ($NEURAL on BSC).`
    );
  }

  if (notes.length > 0) {
    prompt = `${notes.join('\n\n')}\n\nQuery: ${query}`;
  }

  if (sanitized?.flags?.some(f => f.type === 'STALE_DATA_RISK')) {
    prompt += '\nNOTE: Do not report price or market data from cached sources. State that live price data is sourced separately.';
  }

  return prompt;
}

module.exports = {
  sanitizeQuery,
  isSelfQuery,
  normalizeTicker,
  extractTickers,
  buildDisambiguatedPrompt,
  SPECTRE_IDENTITIES,
  DATA_STATES,
};
