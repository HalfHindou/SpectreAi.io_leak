/**
 * tokenRegistry.js - Centralized Whitelist
 * Maps every analysis-ready token to the sections it appears in.
 * The global search bar queries this registry to show which sections
 * have coverage for a given token, and auto-navigates to them.
 *
 * Section keys:
 *   dealflow   - DealFlowPipeline
 *   pitchdeck  - TokenPitchDeck
 *   scorecard  - InstitutionalScorecard
 *   thesis     - AlphaThesisCards
 */

export const TOKEN_REGISTRY = [
  {
    symbol: 'SPECTRE',
    name: 'Spectre AI',
    address: '0x9Cf0ED013e67DB12cA3AF8e7506fE401aA14dAd6',
    sector: 'AI Agents',
    sections: ['dealflow', 'pitchdeck'],
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    sector: 'Infrastructure',
    sections: ['dealflow', 'scorecard'],
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    sector: 'Infrastructure',
    sections: ['dealflow', 'pitchdeck', 'scorecard', 'thesis'],
  },
  {
    symbol: 'AAVE',
    name: 'Aave',
    sector: 'DeFi',
    sections: ['dealflow', 'pitchdeck', 'scorecard', 'thesis'],
  },
  {
    symbol: 'ONDO',
    name: 'Ondo Finance',
    sector: 'RWA',
    sections: ['dealflow', 'pitchdeck', 'scorecard', 'thesis'],
  },
  {
    symbol: 'LINK',
    name: 'Chainlink',
    sector: 'Infrastructure',
    sections: ['dealflow', 'scorecard'],
  },
  {
    symbol: 'TAO',
    name: 'Bittensor',
    sector: 'AI Agents',
    sections: ['dealflow', 'scorecard', 'thesis'],
  },
  {
    symbol: 'MORPHO',
    name: 'Morpho',
    sector: 'DeFi',
    sections: ['dealflow'],
  },
  {
    symbol: 'EIGEN',
    name: 'EigenLayer',
    sector: 'Infrastructure',
    sections: ['dealflow'],
  },
  {
    symbol: 'ETHFI',
    name: 'Ether.fi',
    sector: 'DeFi',
    sections: ['dealflow'],
  },
]

/* Section display metadata */
export const SECTION_META = {
  dealflow: { label: 'Deal Room', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
  pitchdeck: { label: 'Pitch Deck', icon: 'M4 4h16v12H4zM8 20h8M12 16v4' },
  scorecard: { label: 'Scorecard', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  thesis: { label: 'Alpha Thesis', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
}

/**
 * Build registry entries from the dynamic Research Desk bundle projects, so
 * the search bar covers the live emerging-DeFi feed (not just the static
 * whitelist). Each dynamic project has Deal Flow + Scorecard coverage.
 */
export function buildRegistryFromProjects(projects) {
  if (!Array.isArray(projects)) return []
  return projects
    .filter(p => p && p.symbol)
    .map(p => ({
      symbol: p.symbol,
      name: p.name || p.symbol,
      address: p.address || null,
      sector: p.sector || p.category || 'DeFi',
      sections: ['dealflow', 'scorecard'],
      logo: p.logo || null,
    }))
}

/**
 * Merge the static whitelist with dynamic project entries, deduped by symbol
 * (dynamic wins — it carries the live logo + sector).
 */
export function mergeRegistry(dynamicEntries) {
  if (!Array.isArray(dynamicEntries) || dynamicEntries.length === 0) return TOKEN_REGISTRY
  const bySymbol = new Map()
  for (const t of TOKEN_REGISTRY) bySymbol.set(t.symbol.toUpperCase(), t)
  for (const t of dynamicEntries) bySymbol.set(t.symbol.toUpperCase(), t)
  return Array.from(bySymbol.values())
}

/**
 * Search the registry by symbol or name (case-insensitive).
 * Returns matching tokens sorted by number of sections (most coverage first).
 * Optionally pass a custom registry list (e.g. static merged with dynamic
 * bundle projects); defaults to the static whitelist.
 */
export function searchRegistry(query, registry = TOKEN_REGISTRY) {
  if (!query || query.trim().length === 0) return []
  const q = query.trim().toLowerCase()
  return (registry || TOKEN_REGISTRY)
    .filter(t =>
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      (t.address && t.address.toLowerCase().includes(q))
    )
    .sort((a, b) => b.sections.length - a.sections.length)
}

/**
 * Find a token by symbol (exact match, case-insensitive).
 */
export function findBySymbol(symbol) {
  if (!symbol) return null
  return TOKEN_REGISTRY.find(t => t.symbol.toLowerCase() === symbol.toLowerCase()) || null
}
