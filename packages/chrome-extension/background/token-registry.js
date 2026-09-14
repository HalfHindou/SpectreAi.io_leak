/**
 * Spectre AI — Token Registry (Tier 1)
 * Local registry of well-known tokens for instant resolution
 */

let registry = {};
let aliasMap = {};

/**
 * Initialize the registry from the bundled JSON
 */
export async function initRegistry() {
  try {
    const response = await fetch(chrome.runtime.getURL('registry/known-tokens.json'));
    const data = await response.json();
    registry = data.tokens || {};
    buildAliasMap();
    console.log(`[Spectre] Registry loaded: ${Object.keys(registry).length} tokens`);
  } catch (err) {
    console.error('[Spectre] Failed to load token registry:', err);
    registry = {};
  }
}

/**
 * Build alias → canonical ticker map
 */
function buildAliasMap() {
  aliasMap = {};
  for (const [ticker, token] of Object.entries(registry)) {
    if (token.aliases) {
      for (const alias of token.aliases) {
        aliasMap[alias.toUpperCase()] = ticker;
      }
    }
  }
}

/**
 * Look up a token by ticker (Tier 1 — instant, local)
 * Returns null if not found
 */
export function lookupToken(ticker) {
  const upper = ticker.toUpperCase();

  // Direct match
  if (registry[upper]) {
    return { ...registry[upper], symbol: upper };
  }

  // Alias match
  const canonical = aliasMap[upper];
  if (canonical && registry[canonical]) {
    return { ...registry[canonical], symbol: canonical, matchedAlias: upper };
  }

  return null;
}

/**
 * Get all registered tickers
 */
export function getAllTickers() {
  return Object.keys(registry);
}

/**
 * Get the raw registry object (for passing to price-cache)
 */
export function getRegistry() {
  return { ...registry };
}

/**
 * Check if ticker exists in registry
 */
export function hasToken(ticker) {
  const upper = ticker.toUpperCase();
  return !!registry[upper] || !!aliasMap[upper];
}
