/**
 * Alpha Intelligence Feed Data
 * AI-curated market intelligence items for briefing and feed sections
 */

export const ALPHA_FEED_ITEMS = [
  { id: 1, type: 'liquidation', headline: '$1.36B Liquidated in Market-Wide Slump', detail: 'Cascade across BTC & ETH perpetuals', severity: 'critical', tokens: [] },
  { id: 2, type: 'pump', headline: 'JELLY surged 1,325%', detail: 'Market cap: $52M → $420M in 24h', severity: 'high', tokens: ['JELLY'], change: '+1325%' },
  { id: 3, type: 'volume', headline: 'Ethereum volume +23%', detail: 'Top movers: VIRTUAL, ANDY, TAOBOT', severity: 'medium', tokens: ['VIRTUAL', 'ANDY', 'TAOBOT'] },
  { id: 4, type: 'macro', headline: 'US-China tariffs increased to 170%', detail: 'Risk-off sentiment spreading across markets', severity: 'high', tokens: [] },
  { id: 5, type: 'opportunity', headline: 'Oversold signals detected', detail: 'NEO, BILLY, KITKAT showing reversal patterns', severity: 'medium', tokens: ['NEO', 'BILLY', 'KITKAT'] },
  { id: 6, type: 'security', headline: 'GMGN platform security breach', detail: 'Trading platform compromised - assess exposure', severity: 'critical', tokens: [] },
  { id: 7, type: 'pump', headline: 'PENGU breaks all-time high', detail: 'Up 89% on NFT partnership announcement', severity: 'high', tokens: ['PENGU'], change: '+89%' },
  { id: 8, type: 'liquidation', headline: '$45M ETH long liquidated', detail: 'Position wiped at $3,240 support level', severity: 'high', tokens: ['ETH'] },
  { id: 9, type: 'macro', headline: 'Fed signals rate pause through Q2', detail: 'Risk assets rally on dovish commentary', severity: 'medium', tokens: [] },
  { id: 10, type: 'volume', headline: 'Solana DEX volume: $8.2B', detail: 'Jupiter, Raydium leading activity', severity: 'medium', tokens: ['JUP', 'RAY'] },
  { id: 11, type: 'opportunity', headline: 'AI sector accumulation detected', detail: 'Whale activity in FET, AGIX, OCEAN', severity: 'medium', tokens: ['FET', 'AGIX', 'OCEAN'] },
  { id: 12, type: 'security', headline: 'Phishing campaign targeting ARB holders', detail: 'Fake airdrop links circulating on social', severity: 'high', tokens: ['ARB'] },
  { id: 13, type: 'pump', headline: 'WIF +156% on exchange listing rumor', detail: 'Volume spike across major DEXs', severity: 'high', tokens: ['WIF'], change: '+156%' },
  { id: 14, type: 'macro', headline: 'SEC delays ETH ETF decision', detail: 'Deadline extended to March', severity: 'medium', tokens: ['ETH'] },
  { id: 15, type: 'liquidation', headline: '$280M shorts liquidated', detail: 'BTC squeeze above $99K resistance', severity: 'critical', tokens: ['BTC'] },
  { id: 16, type: 'opportunity', headline: 'RWA sector breakout forming', detail: 'ONDO, POLYX showing momentum', severity: 'medium', tokens: ['ONDO', 'POLYX'] },
  { id: 17, type: 'volume', headline: 'Base chain transactions +340%', detail: 'Weekly activity at all-time high', severity: 'high', tokens: [] },
  { id: 18, type: 'security', headline: 'Multichain bridge exploit', detail: '$2.3M drained from liquidity pools', severity: 'critical', tokens: [] },
]

/**
 * Get latest alpha items for the briefing section
 * @param {number} count - Number of items to return
 * @returns {Array} Alpha items with category metadata
 */
export function getLatestBriefingItems(count = 3) {
  // Select diverse types for the briefing - one from each major category
  const categories = ['macro', 'opportunity', 'pump']
  const selected = []
  for (const cat of categories) {
    const item = ALPHA_FEED_ITEMS.find(i => i.type === cat && !selected.includes(i))
    if (item) selected.push(item)
  }
  // Fill remaining slots
  while (selected.length < count) {
    const remaining = ALPHA_FEED_ITEMS.filter(i => !selected.includes(i))
    if (remaining.length === 0) break
    selected.push(remaining[Math.floor(Math.random() * remaining.length)])
  }
  return selected
}

/**
 * Get discovery feed items (opportunity + pump types only)
 * @param {number} count - Number of items to return
 * @returns {Array} Curated discovery items
 */
export function getDiscoveryFeedItems(count = 6) {
  return ALPHA_FEED_ITEMS
    .filter(i => i.type === 'opportunity' || i.type === 'pump')
    .slice(0, count)
}

/**
 * Filter items by category
 * @param {Array} items - Alpha items array
 * @param {string} category - Category to filter by ('all' for no filter)
 * @returns {Array} Filtered items
 */
export function filterByCategory(items, category) {
  if (category === 'all') return items
  return items.filter(i => i.type === category)
}

/**
 * Smart money signal data for the signal strip
 */
export const SMART_MONEY_SIGNALS = [
  { id: 1, type: 'accumulation', text: 'Institutional wallets accumulated $12M ETH in the last 4 hours', token: 'ETH', amount: '$12M', direction: 'bullish' },
  { id: 2, type: 'distribution', text: 'Whale wallet distributed $8.4M PEPE across 12 wallets', token: 'PEPE', amount: '$8.4M', direction: 'bearish' },
  { id: 3, type: 'accumulation', text: 'Smart money accumulated $5.2M SOL on Raydium', token: 'SOL', amount: '$5.2M', direction: 'bullish' },
  { id: 4, type: 'accumulation', text: 'VC wallets moved $18M ONDO to cold storage', token: 'ONDO', amount: '$18M', direction: 'bullish' },
  { id: 5, type: 'distribution', text: 'Early investor sold $3.1M ARB on Uniswap', token: 'ARB', amount: '$3.1M', direction: 'bearish' },
  { id: 6, type: 'accumulation', text: 'Institutional flow: $7.8M into AI sector tokens', token: 'FET', amount: '$7.8M', direction: 'bullish' },
]

/**
 * Token logo URLs for well-known tokens
 */
export const TOKEN_LOGOS = {
  // --- Major L1s ---
  'BTC': 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  'WBTC': 'https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png',
  'ETH': 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  'WETH': 'https://assets.coingecko.com/coins/images/2518/small/weth.png',
  'SOL': 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  'AVAX': 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  'MATIC': 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png',
  'POL': 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png',
  'SUI': 'https://assets.coingecko.com/coins/images/26375/small/sui_asset.jpeg',
  'APT': 'https://assets.coingecko.com/coins/images/26455/small/aptos_round.png',
  'SEI': 'https://assets.coingecko.com/coins/images/28205/small/Sei_Logo_-_Transparent.png',
  'TIA': 'https://assets.coingecko.com/coins/images/31967/small/tia.jpg',
  // --- L2s ---
  'ARB': 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
  'OP': 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
  // --- Memecoins ---
  'PEPE': 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg',
  'WIF': 'https://assets.coingecko.com/coins/images/33566/small/dogwifhat.jpg',
  'BONK': 'https://assets.coingecko.com/coins/images/28600/small/bonk.jpg',
  'SHIB': 'https://assets.coingecko.com/coins/images/11939/small/shiba.png',
  'DOGE': 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  'FLOKI': 'https://assets.coingecko.com/coins/images/16746/small/PNG_image.png',
  'BRETT': 'https://assets.coingecko.com/coins/images/35529/small/1000050750.png',
  'DEGEN': 'https://assets.coingecko.com/coins/images/34515/small/android-chrome-512x512.png',
  'TOSHI': 'https://assets.coingecko.com/coins/images/31126/small/toshi.png',
  // --- DeFi Blue Chips ---
  'LINK': 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  'UNI': 'https://assets.coingecko.com/coins/images/12504/small/uni.jpg',
  'AAVE': 'https://assets.coingecko.com/coins/images/12645/small/AAVE.png',
  'CRV': 'https://assets.coingecko.com/coins/images/12124/small/Curve.png',
  'MKR': 'https://assets.coingecko.com/coins/images/1364/small/Mark_Maker.png',
  'LDO': 'https://assets.coingecko.com/coins/images/13573/small/Lido_DAO.png',
  'SNX': 'https://assets.coingecko.com/coins/images/3406/small/SNX.png',
  'COMP': 'https://assets.coingecko.com/coins/images/10775/small/COMP.png',
  'ENS': 'https://assets.coingecko.com/coins/images/19785/small/acatxTm8_400x400.jpg',
  'DYDX': 'https://assets.coingecko.com/coins/images/17500/small/hjnIm9bV.jpg',
  'MORPHO': 'https://coin-images.coingecko.com/coins/images/29837/small/Morpho-token-icon.png',
  'ETHFI': 'https://coin-images.coingecko.com/coins/images/35958/small/etherfi.jpeg',
  'RPL': 'https://assets.coingecko.com/coins/images/2090/small/rocket_pool_%28RPL%29.png',
  'GRT': 'https://assets.coingecko.com/coins/images/13397/small/Graph_Token.png',
  'ONDO': 'https://assets.coingecko.com/coins/images/26580/small/ONDO.png',
  'CAKE': 'https://assets.coingecko.com/coins/images/12632/small/pancakeswap.png',
  'XVS': 'https://assets.coingecko.com/coins/images/12677/small/venus.png',
  'ALPACA': 'https://assets.coingecko.com/coins/images/14165/small/Logo200.png',
  // --- AI / DePIN ---
  'FET': 'https://assets.coingecko.com/coins/images/5681/small/Fetch.jpg',
  'RENDER': 'https://assets.coingecko.com/coins/images/11636/small/rndr.png',
  'RNDR': 'https://assets.coingecko.com/coins/images/11636/small/rndr.png',
  'TAO': 'https://assets.coingecko.com/coins/images/28452/small/ARUsPeNQ_400x400.jpeg',
  'OCEAN': 'https://assets.coingecko.com/coins/images/3687/small/ocean-protocol-logo.jpg',
  'FIL': 'https://assets.coingecko.com/coins/images/12817/small/filecoin.png',
  'INJ': 'https://assets.coingecko.com/coins/images/12882/small/Secondary_Symbol.png',
  'PYTH': 'https://assets.coingecko.com/coins/images/31924/small/pyth.png',
  'VIRTUAL': 'https://assets.coingecko.com/coins/images/36242/small/virtual.png',
  // --- Solana DeFi ---
  'JUP': 'https://assets.coingecko.com/coins/images/34188/small/jup.png',
  'JTO': 'https://assets.coingecko.com/coins/images/33228/small/jto.png',
  'JITO': 'https://assets.coingecko.com/coins/images/33228/small/jto.png',
  'RAY': 'https://assets.coingecko.com/coins/images/13928/small/PSigc4ie_400x400.jpg',
  'ORCA': 'https://assets.coingecko.com/coins/images/17547/small/Orca_Logo.png',
  'TENSOR': 'https://assets.coingecko.com/coins/images/35972/small/tensor.jpg',
  'DRIFT': 'https://assets.coingecko.com/coins/images/36451/small/drift.png',
  'KMNO': 'https://assets.coingecko.com/coins/images/36432/small/kamino.png',
  'W': 'https://assets.coingecko.com/coins/images/35087/small/womrhole_logo_full_color_rgb_2000px%4072ppi_%281%29.png',
  // --- Arbitrum DeFi ---
  'GMX': 'https://assets.coingecko.com/coins/images/18323/small/arbit.png',
  'MAGIC': 'https://assets.coingecko.com/coins/images/18623/small/magic.png',
  'RDNT': 'https://assets.coingecko.com/coins/images/26536/small/Radiant-Logo-200x200.png',
  'GNS': 'https://assets.coingecko.com/coins/images/19737/small/logo.png',
  // --- Base DeFi ---
  'AERO': 'https://assets.coingecko.com/coins/images/31745/small/token.png',
  // --- Optimism DeFi ---
  'VELO': 'https://assets.coingecko.com/coins/images/25783/small/velo.png',
  'SONNE': 'https://assets.coingecko.com/coins/images/27573/small/sonne.png',
  // --- Polygon DeFi ---
  'QUICK': 'https://assets.coingecko.com/coins/images/13970/small/1_pOU6pBMEmiL-ZJVb0CYRjQ.png',
  'GHST': 'https://assets.coingecko.com/coins/images/12467/small/ghst-200.png',
  // --- Avalanche DeFi ---
  'JOE': 'https://assets.coingecko.com/coins/images/17569/small/JoeToken.png',
  // --- Spectre ---
  'SPECTRE': '/spectre-icon.png',
}

/**
 * Get token logo URL
 * @param {string} symbol - Token symbol
 * @returns {string|null} Logo URL or null
 */
export function getTokenLogo(symbol) {
  return TOKEN_LOGOS[symbol?.toUpperCase()] || null
}
