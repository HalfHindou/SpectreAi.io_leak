import { SYMBOL_TO_COINGECKO_ID, MAJOR_TOKEN_INFO } from '@/constants/majorTokens'

// Reverse mapping: 'bitcoin' -> 'BTC', 'ethereum' -> 'ETH', etc.
export const COINGECKO_ID_TO_SYMBOL = {}
for (const [sym, cgId] of Object.entries(SYMBOL_TO_COINGECKO_ID)) {
  if (!COINGECKO_ID_TO_SYMBOL[cgId]) {
    COINGECKO_ID_TO_SYMBOL[cgId] = sym
  }
}

/**
 * Convert a symbol to a URL slug.
 * Priority: cgId > SYMBOL_TO_COINGECKO_ID > name-derived slug > lowercased symbol
 * Known crypto → CoinGecko ID ('BTC' → 'bitcoin')
 * Unknown with name → kebab-cased name ('PaLM AI' → 'palm-ai')
 * Stocks / unknown → lowercased symbol ('AAPL' → 'aapl')
 */
export function getTokenSlug(symbol, isStock = false, cgId = null, name = null) {
  if (!symbol) return 'bitcoin'
  if (isStock) return symbol.toLowerCase().trim()
  if (cgId) return cgId
  const upper = symbol.toUpperCase().trim()
  const fromMap = SYMBOL_TO_COINGECKO_ID[upper]
  if (fromMap) return fromMap
  // For unknown tokens, derive slug from name (matches CoinGecko ID convention)
  if (name && name.toLowerCase() !== symbol.toLowerCase()) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }
  return symbol.toLowerCase().trim()
}

/**
 * Resolve a URL slug to a symbol.
 * Known CoinGecko slug → symbol ('bitcoin' → 'BTC')
 * Known symbol → symbol ('btc' → 'BTC')
 * Unknown → uppercased slug
 */
export function resolveSlugToSymbol(slug) {
  if (!slug) return 'BTC'
  const lower = slug.toLowerCase()
  // 1. Check CoinGecko ID reverse map
  const fromCG = COINGECKO_ID_TO_SYMBOL[lower]
  if (fromCG) return fromCG
  // 2. Check if it's a known symbol directly
  const upper = slug.toUpperCase()
  if (SYMBOL_TO_COINGECKO_ID[upper] || MAJOR_TOKEN_INFO[upper]) return upper
  // 3. For hyphenated slugs (name-based like "palm-ai"), try the first part as symbol
  if (slug.includes('-')) {
    const firstPart = slug.split('-')[0].toUpperCase()
    if (SYMBOL_TO_COINGECKO_ID[firstPart] || MAJOR_TOKEN_INFO[firstPart]) return firstPart
  }
  // 4. For hyphenated lowercase slugs that look like CoinGecko IDs (e.g. "world-liberty-financial"),
  //    preserve the original case so the server can resolve via CoinGecko /coins/{id}
  if (slug.includes('-') && slug === lower) return slug
  // 5. Fallback: uppercase the slug
  return upper
}

/**
 * Returns canonical slug if redirect needed, or null.
 * e.g. 'btc' → 'bitcoin', 'ETH' → 'ethereum'
 */
export function getCanonicalSlug(slug) {
  if (!slug) return null
  const upper = slug.toUpperCase()
  const cgId = SYMBOL_TO_COINGECKO_ID[upper]
  if (cgId && slug !== cgId) return cgId
  if (COINGECKO_ID_TO_SYMBOL[slug.toLowerCase()]) return null
  return null
}
