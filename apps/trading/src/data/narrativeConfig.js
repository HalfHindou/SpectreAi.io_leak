/**
 * Narrative/Sector Configuration
 * Extracted from SmartMoneyPulse for shared use across Discover components
 */

export const SECTORS = [
  { id: 'memes', name: 'Memes', color: '#FBBF24' },
  { id: 'defi', name: 'DeFi', color: '#60A5FA' },
  { id: 'ai', name: 'AI Agents', color: '#A78BFA' },
  { id: 'gaming', name: 'Gaming', color: '#F472B6' },
  { id: 'infra', name: 'Infrastructure', color: '#6366F1' },
  { id: 'rwa', name: 'RWA', color: '#34D399' },
  { id: 'layer2', name: 'Layer 2', color: '#22D3EE' },
  { id: 'nft', name: 'NFT/Social', color: '#FB923C' },
]

export const TOKENS_BY_SECTOR = {
  memes: ['PEPE', 'WIF', 'BONK', 'DOGE', 'SHIB', 'FLOKI', 'MYRO', 'POPCAT', 'MEW', 'BOME', 'GME', 'TRUMP', 'BIDEN'],
  defi: ['UNI', 'AAVE', 'MKR', 'COMP', 'CRV', 'SNX', 'SUSHI', '1INCH', 'BAL', 'YFI', 'LDO', 'RPL', 'FXS', 'FRAX', 'LINK', 'UMA', 'ENS', 'RUNE'],
  ai: ['FET', 'AGIX', 'OCEAN', 'RNDR', 'TAO', 'AKT', 'AI16Z', 'GPT', 'NMR', 'VAI', 'COTI', 'AI'],
  gaming: ['IMX', 'GALA', 'AXS', 'SAND', 'MANA', 'ENJ', 'GMT', 'MAGIC', 'PIXEL', 'RON', 'YGG', 'ILV', 'ALICE'],
  infra: ['ARB', 'OP', 'MATIC', 'AVAX', 'ATOM', 'DOT', 'SOL', 'ETH', 'BNB', 'FTM', 'NEAR', 'APT', 'SUI', 'TIA', 'INJ', 'SEI', 'STRK'],
  rwa: ['ONDO', 'RIO', 'TRU', 'CFG', 'GFI', 'CPOOL', 'LAND', 'PROPS', 'LABS', 'TRADE'],
  layer2: ['ARB', 'OP', 'STRK', 'MNT', 'METIS', 'BOBA', 'IMX', 'ZKSYNC', 'SCROLL', 'BLAST', 'LINEA', 'MODE'],
  nft: ['BLUR', 'APE', 'LOOKS', 'X2Y2', 'MAGIC', 'DEGEN', 'FAR', 'PUDGY', 'MAYC', 'BAYC', 'AZUKI', 'PUNKS'],
}

/**
 * Sector SVG icon paths (monoline, 24x24 viewBox)
 * Use: <svg viewBox="0 0 24 24" ...><path d={SECTOR_ICONS[sectorId]} /></svg>
 */
export const SECTOR_ICON_PATHS = {
  memes: 'M12 2a10 10 0 100 20 10 10 0 000-20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  defi: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  ai: 'M3 11h18v10a2 2 0 01-2 2H5a2 2 0 01-2-2V11zM12 2a3 3 0 110 6 3 3 0 010-6zM12 8v3M8 16h.01M16 16h.01',
  gaming: 'M2 6h20v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM6 12h4M8 10v4M15 11h.01M18 13h.01',
  infra: 'M4 4h16v6a1 1 0 01-1 1H5a1 1 0 01-1-1V4zM4 14h16v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM8 7h.01M8 17h.01',
  rwa: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01',
  layer2: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  nft: 'M3 3h18v18H3V3zM8.5 7a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM21 15l-5-5L5 21',
}

/**
 * Get tokens in a sector that match trending tokens
 * @param {string} sectorId - Sector identifier
 * @param {Array} trendingTokens - Array of trending token objects
 * @returns {Array} Matching tokens with their data
 */
export function getSectorTrendingTokens(sectorId, trendingTokens) {
  const sectorSymbols = TOKENS_BY_SECTOR[sectorId] || []
  return trendingTokens.filter(t =>
    sectorSymbols.includes(t.symbol?.toUpperCase())
  )
}

/**
 * Compute aggregate metrics for a sector
 * @param {string} sectorId - Sector identifier
 * @param {Array} trendingTokens - Array of trending token objects
 * @returns {{ avgChange: number, totalVolume: number, tokenCount: number }}
 */
export function computeSectorMetrics(sectorId, trendingTokens) {
  const matching = getSectorTrendingTokens(sectorId, trendingTokens)
  if (matching.length === 0) {
    return { avgChange: 0, totalVolume: 0, tokenCount: 0 }
  }
  const totalChange = matching.reduce((sum, t) => sum + (t.change || 0), 0)
  const totalVolume = matching.reduce((sum, t) => sum + (t.volume24h || t.volume || 0), 0)
  return {
    avgChange: totalChange / matching.length,
    totalVolume,
    tokenCount: matching.length,
  }
}
