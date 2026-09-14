/**
 * Constants for WelcomePage - extracted for maintainability.
 * Data arrays, mock data, logo maps, and SVG icon sets.
 */
import React from 'react'

/**
 * Ceiling on a believable 24h price change, in percent.
 *
 * Past ~1000x a "change" is not a move, it is a broken upstream record: the
 * provider divides by a ~0 price from 24h ago and the row comes back with
 * something like +4.641066559097224e+24% (user report 2026-07-29, $BNBSHIB on
 * the mobile Highlights strip). Same family as the `mcap > 1e14` INT64-overflow
 * sentinel already in isDustToken.
 *
 * Deliberately generous: a genuine day-one launch tops out far below this, so
 * the bound censors nothing real - it only catches arithmetic blowups.
 */
export const MAX_PLAUSIBLE_CHANGE_PCT = 100_000

export const TOP_COINS = [
  { symbol: 'BTC', name: 'Bitcoin', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', networkId: 1 },
  { symbol: 'ETH', name: 'Ethereum', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', networkId: 1 },
  { symbol: 'USDT', name: 'Tether', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', networkId: 1 },
  { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', networkId: 1 },
  { symbol: 'BNB', name: 'BNB', address: '0xBB4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', networkId: 56 },
  { symbol: 'SOL', name: 'Solana', address: 'So11111111111111111111111111111111111111112', networkId: 1399811149 },
  { symbol: 'ARB', name: 'Arbitrum', address: '0x912CE59144191C1204E64559FE8253a0e49E6548', networkId: 42161 },
  { symbol: 'OP', name: 'Optimism', address: '0x4200000000000000000000000000000000000042', networkId: 10 },
  { symbol: 'MATIC', name: 'Polygon', address: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', networkId: 1 },
  { symbol: 'AVAX', name: 'Avalanche', address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', networkId: 43114 },
  { symbol: 'LINK', name: 'Chainlink', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', networkId: 1 },
  { symbol: 'UNI', name: 'Uniswap', address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', networkId: 1 },
]

export const TOKEN_LOGOS = {
  'BTC': 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  'ETH': 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  'SOL': 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  'PEPE': 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg',
  'WIF': 'https://assets.coingecko.com/coins/images/33566/small/dogwifhat.jpg',
  'BONK': 'https://assets.coingecko.com/coins/images/28600/small/bonk.jpg',
  'SHIB': 'https://assets.coingecko.com/coins/images/11939/small/shiba.png',
  'DOGE': 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  'ARB': 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
  'OP': 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
  'MATIC': 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png',
  'AVAX': 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  'LINK': 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  'UNI': 'https://assets.coingecko.com/coins/images/12504/small/uni.jpg',
  'AAVE': 'https://assets.coingecko.com/coins/images/12645/small/AAVE.png',
  'CRV': 'https://assets.coingecko.com/coins/images/12124/small/Curve.png',
  'MKR': 'https://assets.coingecko.com/coins/images/1364/small/Mark_Maker.png',
  'LDO': 'https://assets.coingecko.com/coins/images/13573/small/Lido_DAO.png',
  'FET': 'https://assets.coingecko.com/coins/images/5681/small/Fetch.jpg',
  'RENDER': 'https://assets.coingecko.com/coins/images/11636/small/rndr.png',
  'RNDR': 'https://assets.coingecko.com/coins/images/11636/small/rndr.png',
  'TAO': 'https://assets.coingecko.com/coins/images/28452/small/ARUsPeNQ_400x400.jpeg',
  'OCEAN': 'https://assets.coingecko.com/coins/images/3687/small/ocean-protocol-logo.jpg',
  'GRT': 'https://assets.coingecko.com/coins/images/13397/small/Graph_Token.png',
  'FIL': 'https://assets.coingecko.com/coins/images/12817/small/filecoin.png',
  'INJ': 'https://assets.coingecko.com/coins/images/12882/small/Secondary_Symbol.png',
  'SUI': 'https://assets.coingecko.com/coins/images/26375/small/sui_asset.jpeg',
  'APT': 'https://assets.coingecko.com/coins/images/26455/small/aptos_round.png',
  'SEI': 'https://assets.coingecko.com/coins/images/28205/small/Sei_Logo_-_Transparent.png',
  'TIA': 'https://assets.coingecko.com/coins/images/31967/small/tia.jpg',
  'ONDO': 'https://assets.coingecko.com/coins/images/26580/small/ONDO.png',
  'JUP': 'https://assets.coingecko.com/coins/images/34188/small/jup.png',
  'PYTH': 'https://assets.coingecko.com/coins/images/31924/small/pyth.png',
  'JTO': 'https://assets.coingecko.com/coins/images/33228/small/jto.png',
  'FLOKI': 'https://assets.coingecko.com/coins/images/16746/small/PNG_image.png',
  'USDT': 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  'USDC': 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  'BNB': 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  'SPECTRE': '/round-logo.png',
  'GMX': 'https://assets.coingecko.com/coins/images/18323/small/arbit.png',
  'BRETT': 'https://s2.coinmarketcap.com/static/img/coins/64x64/29743.png',
  'BLUR': 'https://assets.coingecko.com/coins/images/28453/small/blur.png',
  'JOE': 'https://assets.coingecko.com/coins/images/17569/small/joe_200x200.png',
  'AERO': 'https://s2.coinmarketcap.com/static/img/coins/64x64/29270.png',
  'MAGIC': 'https://assets.coingecko.com/coins/images/18623/small/magic.png',
  'CAKE': 'https://assets.coingecko.com/coins/images/12632/small/pancakeswap-cake-logo_%281%29.png',
  'RAY': 'https://s2.coinmarketcap.com/static/img/coins/64x64/8526.png',
  'STX': 'https://assets.coingecko.com/coins/images/2069/small/Stacks_logo_full.png',
  'IMX': 'https://assets.coingecko.com/coins/images/17233/small/immutableX-symbol-BLK-RGB.png',
  'DOG': 'https://s2.coinmarketcap.com/static/img/coins/64x64/31340.png',
  'PEPECASH': 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg',
}

export const CHAIN_LOGOS = {
  1: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  1399811149: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  56: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  42161: 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
  137: 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png',
  43114: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  8453: 'https://s2.coinmarketcap.com/static/img/coins/64x64/27716.png',
  // Robinhood Chain has no CoinGecko/CMC coin image (it is an L2, not a coin) -
  // an inline data-URI keeps every CHAIN_LOGOS[networkId] lookup working, so the
  // row chain-badges light up without special-casing 4663 at each render site.
  4663: 'data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2024%2024%27%3E%3Ccircle%20cx%3D%2712%27%20cy%3D%2712%27%20r%3D%2712%27%20fill%3D%27%2300C805%27%2F%3E%3Cg%20transform%3D%27translate%2812%2012%29%20scale%280.62%29%20translate%28-11%20-12.5%29%27%20fill%3D%27none%27%20stroke%3D%27%2306230d%27%20stroke-width%3D%272.8%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%3E%3Cpath%20d%3D%27M20.24%2012.24a6%206%200%2000-8.49-8.49L5%2010.5V19h8.5z%27%2F%3E%3Cpath%20d%3D%27M16%208L2%2022M17.5%2015H9%27%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E',
}

// Top Coins chain filter — each chain maps to a CoinGecko ecosystem category,
// so chain filtering rides the exact same cached 250-row category machinery as
// the narrative tabs (and intersects with them client-side when both are set).
// Robinhood Chain (Arbitrum Orbit L2, launched 2026-07-01) has no CG coin logo -
// glyph mirrors the trading app's feather mark in Robinhood green.
const ROBINHOOD_CHAIN_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#00C805" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20.24 12.24a6 6 0 00-8.49-8.49L5 10.5V19h8.5z" />
    <path d="M16 8L2 22M17.5 15H9" />
  </svg>
)

export const TOPCOINS_CHAINS = [
  { id: 'all', label: 'All Chains', cg: null, logo: null },
  { id: 'ethereum', label: 'Ethereum', cg: 'ethereum-ecosystem', logo: CHAIN_LOGOS[1] },
  { id: 'solana', label: 'Solana', cg: 'solana-ecosystem', logo: CHAIN_LOGOS[1399811149] },
  { id: 'bnb', label: 'BNB Chain', cg: 'binance-smart-chain', logo: CHAIN_LOGOS[56] },
  { id: 'base', label: 'Base', cg: 'base-ecosystem', logo: CHAIN_LOGOS[8453] },
  { id: 'robinhood', label: 'Robinhood', cg: 'robinhood-ecosystem', logo: null, icon: ROBINHOOD_CHAIN_ICON },
  { id: 'arbitrum', label: 'Arbitrum', cg: 'arbitrum-ecosystem', logo: CHAIN_LOGOS[42161] },
  { id: 'avalanche', label: 'Avalanche', cg: 'avalanche-ecosystem', logo: CHAIN_LOGOS[43114] },
  { id: 'polygon', label: 'Polygon', cg: 'polygon-ecosystem', logo: CHAIN_LOGOS[137] },
  { id: 'sui', label: 'Sui', cg: 'sui-ecosystem', logo: 'https://assets.coingecko.com/coins/images/26375/small/sui-ocean-square.png' },
  { id: 'tron', label: 'Tron', cg: 'tron-ecosystem', logo: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png' },
  { id: 'ton', label: 'TON', cg: 'the-open-network-ecosystem', logo: 'https://assets.coingecko.com/coins/images/17980/small/ton_symbol.png' },
]

// On-Chain tab chain rail. Ids are Codex networkIds, EXCEPT 4663 (Robinhood
// Chain) which Codex does not index at all - useTrendingTokens routes that one
// to GeckoTerminal and merges the rows back in. Ordered by how much of the
// day's on-chain tape each chain actually carries.
export const ONCHAIN_CHAINS = [
  { id: 'all', label: 'All' },
  { id: 1, label: 'Ethereum' },
  { id: 1399811149, label: 'Solana' },
  { id: 56, label: 'BSC' },
  { id: 4663, label: 'Robinhood', icon: ROBINHOOD_CHAIN_ICON },
  { id: 8453, label: 'Base' },
  { id: 42161, label: 'Arbitrum' },
  { id: 137, label: 'Polygon' },
  { id: 43114, label: 'Avalanche' },
]

export const ONCHAIN_TIMEFRAMES = [
  { id: '5m', label: '5m' },
  { id: '1h', label: '1h' },
  { id: '4h', label: '4h' },
  { id: '24h', label: '24h' },
]

export const ONCHAIN_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'meme', label: 'Meme' },
  { id: 'dex', label: 'DEX' },
  { id: 'lending', label: 'Lending' },
  { id: 'nft', label: 'NFT' },
  { id: 'bridge', label: 'Bridge' },
  { id: 'staking', label: 'Staking' },
  { id: 'gaming', label: 'Gaming' },
]

export const PREDICTIONS_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'economy', label: 'Stocks' },
  { id: 'politics', label: 'Politics' },
  { id: 'sports', label: 'Sports' },
  { id: 'science', label: 'Science' },
  { id: 'culture', label: 'Culture' },
]

// ── AI Agents Tab ──────────────────────────────────────────
export const AI_AGENT_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'coding', label: 'Coding' },
  { id: 'trading', label: 'Trading' },
  { id: 'content', label: 'Content' },
  { id: 'research', label: 'Research' },
  { id: 'infrastructure', label: 'Infra' },
  { id: 'creative', label: 'Creative' },
]

// Agent logos — real product/company logos
export const AI_AGENT_LOGOS = {
  'Devin': 'https://avatars.githubusercontent.com/u/154814428?s=64',
  'Sweep': 'https://avatars.githubusercontent.com/u/127925974?s=64',
  'Morpheus': 'https://coin-images.coingecko.com/coins/images/37969/small/MOR200X200.png?1716327119',
  'Virtuals Protocol': 'https://coin-images.coingecko.com/coins/images/34057/small/LOGOMARK.png?1708356054',
  'Autonolas': 'https://coin-images.coingecko.com/coins/images/31099/small/OLAS-token.png?1696529930',
  'Eliza': 'https://coin-images.coingecko.com/coins/images/51090/small/AI16Z.jpg?1730027175',
  'Wordware': 'https://avatars.githubusercontent.com/u/141520203?s=64',
  'Perplexity Agent': 'https://avatars.githubusercontent.com/u/113860992?s=64',
  'Harvey': 'https://avatars.githubusercontent.com/u/119105678?s=64',
  'Aider': 'https://avatars.githubusercontent.com/u/134734811?s=64',
  'Wayfinder': 'https://coin-images.coingecko.com/coins/images/55169/small/wayfinder.jpg',
  'Midjourney Agent': 'https://avatars.githubusercontent.com/u/107738680?s=64',
  'Suno Agent': 'https://avatars.githubusercontent.com/u/143906786?s=64',
  'Fetch.ai': 'https://coin-images.coingecko.com/coins/images/5681/small/ASI.png?1719827289',
  'SingularityNET': 'https://coin-images.coingecko.com/coins/images/2138/small/singularitynet.png?1696503103',
  'Claude Code': 'https://avatars.githubusercontent.com/u/76263028?s=64',
  'GitHub Copilot': 'https://avatars.githubusercontent.com/u/131524422?s=64',
  'Cursor Agent': 'https://avatars.githubusercontent.com/u/152921498?s=64',
  'Replit Agent': 'https://avatars.githubusercontent.com/u/983194?s=64',
  'Ocean Protocol': 'https://coin-images.coingecko.com/coins/images/3687/small/ocean-protocol-logo.jpg',
  'Bittensor': 'https://coin-images.coingecko.com/coins/images/28452/small/ARUsPeNQ_400x400.jpeg',
  'Jasper': 'https://avatars.githubusercontent.com/u/85677655?s=64',
  'Runway Agent': 'https://avatars.githubusercontent.com/u/50573139?s=64',
  'Character.AI': 'https://avatars.githubusercontent.com/u/107388029?s=64',
  'Tavily': 'https://avatars.githubusercontent.com/u/131470174?s=64',
}

// 2026-05-26 beta-quality fix: removed 25-row fabricated AI agent dataset
// (revenue/x402/users/growth all made-up numbers). Empty until a real feed is wired.
export const AI_AGENTS_MOCK = []
const AI_AGENTS_MOCK_DISABLED = [
  { id: 1, name: 'Virtuals Protocol', creator: 'Virtuals', category: 'infrastructure', modelUsed: 'GPT-4o', revenue30d: 12400000, x402Payments: 68000, dailyUsers: 8500, growthPct: 124.3, status: 'active', description: 'Agent tokenization platform' },
  { id: 2, name: 'Midjourney Agent', creator: 'Midjourney', category: 'creative', modelUsed: null, revenue30d: 9800000, x402Payments: 2400, dailyUsers: 280000, growthPct: 8.2, status: 'active', description: 'Autonomous image creation' },
  { id: 3, name: 'Morpheus', creator: 'Morpheus Network', category: 'trading', modelUsed: 'DeepSeek V3', revenue30d: 8900000, x402Payments: 42000, dailyUsers: 15000, growthPct: 56.8, status: 'active', description: 'Autonomous DeFi trading agent' },
  { id: 4, name: 'Perplexity Agent', creator: 'Perplexity', category: 'research', modelUsed: 'Claude Sonnet 4.6', revenue30d: 6200000, x402Payments: 31000, dailyUsers: 120000, growthPct: 22.6, status: 'active', description: 'Deep research automation' },
  { id: 5, name: 'Harvey', creator: 'Harvey AI', category: 'research', modelUsed: 'GPT-4o', revenue30d: 5400000, x402Payments: 8200, dailyUsers: 18000, growthPct: 15.8, status: 'active', description: 'Legal research & analysis agent' },
  { id: 6, name: 'Fetch.ai', creator: 'Fetch.ai', category: 'infrastructure', modelUsed: 'Llama 4 Maverick', revenue30d: 4800000, x402Payments: 38000, dailyUsers: 12000, growthPct: 26.8, status: 'active', description: 'Autonomous economic agents' },
  { id: 7, name: 'Devin', creator: 'Cognition', category: 'coding', modelUsed: 'Claude Sonnet 4.6', revenue30d: 4200000, x402Payments: 18400, dailyUsers: 52000, growthPct: 34.2, status: 'active', description: 'Autonomous software engineer' },
  { id: 8, name: 'Claude Code', creator: 'Anthropic', category: 'coding', modelUsed: 'Claude Sonnet 4.6', revenue30d: 3800000, x402Payments: 24600, dailyUsers: 185000, growthPct: 92.4, status: 'active', description: 'Agentic coding in terminal' },
  { id: 9, name: 'Suno Agent', creator: 'Suno', category: 'creative', modelUsed: null, revenue30d: 3400000, x402Payments: 1800, dailyUsers: 95000, growthPct: 31.5, status: 'active', description: 'AI music generation agent' },
  { id: 10, name: 'Autonolas', creator: 'Valory', category: 'infrastructure', modelUsed: 'GPT-4o', revenue30d: 3100000, x402Payments: 22000, dailyUsers: 6200, growthPct: 18.4, status: 'active', description: 'Decentralized agent services' },
  { id: 11, name: 'Eliza', creator: 'ai16z', category: 'content', modelUsed: 'GPT-4o mini', revenue30d: 2800000, x402Payments: 15600, dailyUsers: 42000, growthPct: 89.2, status: 'active', description: 'Social media AI personality' },
  { id: 12, name: 'GitHub Copilot', creator: 'GitHub', category: 'coding', modelUsed: 'GPT-4o', revenue30d: 2600000, x402Payments: 5200, dailyUsers: 420000, growthPct: 12.1, status: 'active', description: 'AI pair programmer in IDE' },
  { id: 13, name: 'Bittensor', creator: 'Opentensor', category: 'infrastructure', modelUsed: 'Mixed', revenue30d: 2400000, x402Payments: 19800, dailyUsers: 6800, growthPct: 38.2, status: 'active', description: 'Decentralized AI network' },
  { id: 14, name: 'SingularityNET', creator: 'SingularityNET', category: 'infrastructure', modelUsed: 'Mixed', revenue30d: 2200000, x402Payments: 14200, dailyUsers: 8400, growthPct: -4.2, status: 'active', description: 'Decentralized AI marketplace' },
  { id: 15, name: 'Wayfinder', creator: 'Altered State Machine', category: 'trading', modelUsed: 'GPT-4o mini', revenue30d: 2100000, x402Payments: 12800, dailyUsers: 4200, growthPct: 72.4, status: 'beta', description: 'On-chain navigation agent' },
  { id: 16, name: 'Cursor Agent', creator: 'Anysphere', category: 'coding', modelUsed: 'Claude Sonnet 4.6', revenue30d: 1950000, x402Payments: 8100, dailyUsers: 310000, growthPct: 64.8, status: 'active', description: 'AI-first code editor agent' },
  { id: 17, name: 'Sweep', creator: 'Sweep AI', category: 'coding', modelUsed: 'GPT-4o', revenue30d: 1850000, x402Payments: 9200, dailyUsers: 38000, growthPct: 28.5, status: 'active', description: 'AI-powered code review & fixes' },
  { id: 18, name: 'Replit Agent', creator: 'Replit', category: 'coding', modelUsed: 'Claude Sonnet 4.6', revenue30d: 1620000, x402Payments: 6400, dailyUsers: 145000, growthPct: 44.6, status: 'active', description: 'Build apps from natural language' },
  { id: 19, name: 'Character.AI', creator: 'Character.AI', category: 'content', modelUsed: null, revenue30d: 1480000, x402Payments: 920, dailyUsers: 520000, growthPct: 6.8, status: 'active', description: 'Conversational AI characters' },
  { id: 20, name: 'Ocean Protocol', creator: 'Ocean', category: 'infrastructure', modelUsed: 'Llama 3.3 70B', revenue30d: 1350000, x402Payments: 11200, dailyUsers: 5400, growthPct: 14.2, status: 'active', description: 'Decentralized data exchange' },
  { id: 21, name: 'Tavily', creator: 'Tavily', category: 'research', modelUsed: 'GPT-4o mini', revenue30d: 1120000, x402Payments: 7800, dailyUsers: 32000, growthPct: 58.4, status: 'active', description: 'AI search API for agents' },
  { id: 22, name: 'Wordware', creator: 'Wordware AI', category: 'content', modelUsed: 'Claude Sonnet 4.6', revenue30d: 950000, x402Payments: 4800, dailyUsers: 28000, growthPct: 42.1, status: 'beta', description: 'AI content generation agent' },
  { id: 23, name: 'Runway Agent', creator: 'Runway', category: 'creative', modelUsed: null, revenue30d: 890000, x402Payments: 1200, dailyUsers: 68000, growthPct: 18.6, status: 'active', description: 'AI video generation agent' },
  { id: 24, name: 'Aider', creator: 'Paul Gauthier', category: 'coding', modelUsed: 'Claude Sonnet 4.6', revenue30d: 780000, x402Payments: 3400, dailyUsers: 65000, growthPct: 48.2, status: 'active', description: 'AI pair programming in terminal' },
  { id: 25, name: 'Jasper', creator: 'Jasper AI', category: 'content', modelUsed: 'GPT-4o', revenue30d: 720000, x402Payments: 2100, dailyUsers: 48000, growthPct: -2.8, status: 'active', description: 'Enterprise content creation' },
]

// ── AI Models Tab ─────────────────────────────
export const AI_MODEL_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'code', label: 'Code' },
  { id: 'chat', label: 'Chat' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'embedding', label: 'Embedding' },
]

export const AI_MODEL_PROVIDERS = [
  { id: 'all', label: 'All' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'google', label: 'Google' },
  { id: 'meta', label: 'Meta' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'xai', label: 'xAI' },
  { id: 'stability', label: 'Stability' },
  { id: 'microsoft', label: 'Microsoft' },
  { id: 'cohere', label: 'Cohere' },
  { id: 'perplexity', label: 'Perplexity' },
]

export const AI_MODEL_QUALITY_TIERS = [
  { id: 'all', label: 'All' },
  { id: 'elite', label: 'Elite 90+' },
  { id: 'high', label: 'High 80+' },
  { id: 'mid', label: 'Mid 70+' },
  { id: 'budget', label: 'Budget <70' },
]

export const PROVIDER_COLORS = {
  anthropic: '#D97757',
  openai: '#10A37F',
  google: '#4285F4',
  meta: '#0668E1',
  deepseek: '#4D6BFE',
  mistral: '#F7D046',
  xai: '#f5f5f7',
  stability: '#A855F7',
  microsoft: '#00BCF2',
  cohere: '#39594D',
  perplexity: '#20808D',
}

// Provider logos
export const AI_PROVIDER_LOGOS = {
  anthropic: 'https://avatars.githubusercontent.com/u/76263028?s=64',
  openai: 'https://avatars.githubusercontent.com/u/14957082?s=64',
  google: 'https://avatars.githubusercontent.com/u/1342004?s=64',
  meta: 'https://avatars.githubusercontent.com/u/69631?s=64',
  deepseek: 'https://avatars.githubusercontent.com/u/148330874?s=64',
  mistral: 'https://avatars.githubusercontent.com/u/132372032?s=64',
  xai: 'https://avatars.githubusercontent.com/u/144451816?s=64',
  stability: 'https://avatars.githubusercontent.com/u/100950301?s=64',
  microsoft: 'https://avatars.githubusercontent.com/u/6154722?s=64',
  cohere: 'https://avatars.githubusercontent.com/u/54850923?s=64',
  perplexity: 'https://avatars.githubusercontent.com/u/113860992?s=64',
}

// 2026-05-26 beta-quality fix: removed 53-row fabricated AI model dataset
// (ELO/requests/mindshare/quality all made-up). Empty until a real feed is wired.
export const AI_MODELS_MOCK = []
const AI_MODELS_MOCK_DISABLED = [
  { id: 1, name: 'Claude Opus 4.6', provider: 'anthropic', category: 'chat', elo: 1394, dailyRequests: 5800000, mindsharePct: 26.4, qualityScore: 98, costPer1M: 15.0, contextWindow: 200000, agentDemandPct: 42.6, trending: true },
  { id: 2, name: 'Claude Sonnet 4.6', provider: 'anthropic', category: 'code', elo: 1389, dailyRequests: 8200000, mindsharePct: 18.8, qualityScore: 97, costPer1M: 3.0, contextWindow: 200000, agentDemandPct: 74.8, trending: true },
  { id: 3, name: 'GPT-4o', provider: 'openai', category: 'chat', elo: 1358, dailyRequests: 3200000, mindsharePct: 11.8, qualityScore: 93, costPer1M: 5.0, contextWindow: 128000, agentDemandPct: 58.3, trending: false },
  { id: 4, name: 'Claude Haiku 3.5', provider: 'anthropic', category: 'chat', elo: 1310, dailyRequests: 7400000, mindsharePct: 9.6, qualityScore: 84, costPer1M: 0.8, contextWindow: 200000, agentDemandPct: 66.4, trending: false },
  { id: 5, name: 'DeepSeek V3', provider: 'deepseek', category: 'chat', elo: 1338, dailyRequests: 5200000, mindsharePct: 8.2, qualityScore: 89, costPer1M: 0.27, contextWindow: 128000, agentDemandPct: 61.2, trending: true },
  { id: 6, name: 'Gemini 2.0 Flash', provider: 'google', category: 'chat', elo: 1310, dailyRequests: 4800000, mindsharePct: 7.4, qualityScore: 86, costPer1M: 0.3, contextWindow: 1000000, agentDemandPct: 56.8, trending: false },
  { id: 7, name: 'GPT-4o mini', provider: 'openai', category: 'chat', elo: 1315, dailyRequests: 5600000, mindsharePct: 5.8, qualityScore: 82, costPer1M: 0.15, contextWindow: 128000, agentDemandPct: 81.6, trending: false },
  { id: 8, name: 'Gemini 2.5 Pro', provider: 'google', category: 'chat', elo: 1342, dailyRequests: 2400000, mindsharePct: 5.2, qualityScore: 91, costPer1M: 7.0, contextWindow: 1000000, agentDemandPct: 38.4, trending: true },
  { id: 9, name: 'Llama 4 Maverick', provider: 'meta', category: 'chat', elo: 1320, dailyRequests: 3100000, mindsharePct: 4.8, qualityScore: 87, costPer1M: 0.0, contextWindow: 128000, agentDemandPct: 52.4, trending: false },
  { id: 10, name: 'GPT-o3', provider: 'openai', category: 'chat', elo: 1390, dailyRequests: 980000, mindsharePct: 4.2, qualityScore: 97, costPer1M: 40.0, contextWindow: 200000, agentDemandPct: 14.2, trending: true },
  { id: 11, name: 'voyage-3', provider: 'anthropic', category: 'embedding', elo: 0, dailyRequests: 4200000, mindsharePct: 4.1, qualityScore: 92, costPer1M: 0.06, contextWindow: 32000, agentDemandPct: 64.8, trending: false },
  { id: 12, name: 'DeepSeek R1', provider: 'deepseek', category: 'code', elo: 1355, dailyRequests: 2800000, mindsharePct: 3.8, qualityScore: 91, costPer1M: 0.55, contextWindow: 64000, agentDemandPct: 42.6, trending: true },
  { id: 13, name: 'text-embedding-3-large', provider: 'openai', category: 'embedding', elo: 0, dailyRequests: 6200000, mindsharePct: 3.6, qualityScore: 90, costPer1M: 0.13, contextWindow: 8191, agentDemandPct: 72.4, trending: false },
  { id: 14, name: 'Codestral', provider: 'mistral', category: 'code', elo: 1298, dailyRequests: 1200000, mindsharePct: 2.4, qualityScore: 84, costPer1M: 1.0, contextWindow: 32000, agentDemandPct: 48.2, trending: false },
  { id: 15, name: 'Stable Diffusion 3.5', provider: 'stability', category: 'image', elo: 1265, dailyRequests: 2100000, mindsharePct: 2.2, qualityScore: 79, costPer1M: 0.0, contextWindow: 0, agentDemandPct: 6.2, trending: false },
  { id: 16, name: 'Grok-3', provider: 'xai', category: 'chat', elo: 1335, dailyRequests: 680000, mindsharePct: 2.1, qualityScore: 88, costPer1M: 5.0, contextWindow: 131072, agentDemandPct: 18.6, trending: true },
  { id: 17, name: 'DALL-E 3', provider: 'openai', category: 'image', elo: 1280, dailyRequests: 1500000, mindsharePct: 1.9, qualityScore: 82, costPer1M: 40.0, contextWindow: 0, agentDemandPct: 8.2, trending: false },
  { id: 18, name: 'Whisper v3', provider: 'openai', category: 'audio', elo: 1270, dailyRequests: 1800000, mindsharePct: 1.8, qualityScore: 90, costPer1M: 0.6, contextWindow: 0, agentDemandPct: 12.4, trending: false },
  { id: 19, name: 'Gemini 2.0 Flash Lite', provider: 'google', category: 'chat', elo: 1228, dailyRequests: 4200000, mindsharePct: 1.8, qualityScore: 76, costPer1M: 0.075, contextWindow: 1000000, agentDemandPct: 58.2, trending: false },
  { id: 20, name: 'Llama 3.3 70B', provider: 'meta', category: 'chat', elo: 1268, dailyRequests: 1800000, mindsharePct: 1.6, qualityScore: 83, costPer1M: 0.0, contextWindow: 128000, agentDemandPct: 44.8, trending: false },
  { id: 21, name: 'Gemini Embedding', provider: 'google', category: 'embedding', elo: 0, dailyRequests: 3100000, mindsharePct: 1.6, qualityScore: 88, costPer1M: 0.0, contextWindow: 3072, agentDemandPct: 54.2, trending: false },
  { id: 22, name: 'Mistral Large 2', provider: 'mistral', category: 'chat', elo: 1305, dailyRequests: 520000, mindsharePct: 1.4, qualityScore: 85, costPer1M: 3.0, contextWindow: 128000, agentDemandPct: 22.4, trending: false },
  { id: 23, name: 'Flux 1.1 Pro', provider: 'stability', category: 'image', elo: 1245, dailyRequests: 1400000, mindsharePct: 1.4, qualityScore: 84, costPer1M: 4.0, contextWindow: 0, agentDemandPct: 5.4, trending: true },
  { id: 24, name: 'Sora', provider: 'openai', category: 'video', elo: 1250, dailyRequests: 420000, mindsharePct: 1.2, qualityScore: 88, costPer1M: 150.0, contextWindow: 0, agentDemandPct: 2.4, trending: true },
  { id: 25, name: 'Mistral Small 3', provider: 'mistral', category: 'chat', elo: 1248, dailyRequests: 1200000, mindsharePct: 1.1, qualityScore: 78, costPer1M: 0.2, contextWindow: 32000, agentDemandPct: 36.8, trending: false },
  { id: 26, name: 'DeepSeek Coder V2', provider: 'deepseek', category: 'code', elo: 1292, dailyRequests: 1100000, mindsharePct: 1.0, qualityScore: 83, costPer1M: 0.14, contextWindow: 128000, agentDemandPct: 52.8, trending: false },
  { id: 27, name: 'Llama 4 Scout', provider: 'meta', category: 'chat', elo: 1288, dailyRequests: 1400000, mindsharePct: 1.0, qualityScore: 82, costPer1M: 0.0, contextWindow: 512000, agentDemandPct: 34.6, trending: true },
  { id: 28, name: 'Imagen 3', provider: 'google', category: 'image', elo: 1275, dailyRequests: 680000, mindsharePct: 0.9, qualityScore: 85, costPer1M: 20.0, contextWindow: 0, agentDemandPct: 4.8, trending: false },
  { id: 29, name: 'ElevenLabs Turbo', provider: 'stability', category: 'audio', elo: 1260, dailyRequests: 920000, mindsharePct: 0.8, qualityScore: 88, costPer1M: 2.0, contextWindow: 0, agentDemandPct: 9.6, trending: false },
  { id: 30, name: 'Qwen 2.5 72B', provider: 'meta', category: 'chat', elo: 1278, dailyRequests: 980000, mindsharePct: 0.8, qualityScore: 81, costPer1M: 0.0, contextWindow: 128000, agentDemandPct: 28.4, trending: false },
  { id: 31, name: 'Grok-2', provider: 'xai', category: 'chat', elo: 1225, dailyRequests: 420000, mindsharePct: 0.6, qualityScore: 80, costPer1M: 2.0, contextWindow: 131072, agentDemandPct: 12.8, trending: false },
  { id: 32, name: 'Veo 2', provider: 'google', category: 'video', elo: 1240, dailyRequests: 310000, mindsharePct: 0.5, qualityScore: 86, costPer1M: 120.0, contextWindow: 0, agentDemandPct: 2.8, trending: true },
  { id: 33, name: 'Pixtral Large', provider: 'mistral', category: 'image', elo: 1210, dailyRequests: 340000, mindsharePct: 0.4, qualityScore: 76, costPer1M: 2.0, contextWindow: 128000, agentDemandPct: 7.6, trending: false },
  { id: 34, name: 'Kling 2.0', provider: 'stability', category: 'video', elo: 1235, dailyRequests: 380000, mindsharePct: 0.4, qualityScore: 80, costPer1M: 80.0, contextWindow: 0, agentDemandPct: 1.8, trending: false },
  { id: 35, name: 'Runway Gen-3 Alpha', provider: 'stability', category: 'video', elo: 1220, dailyRequests: 290000, mindsharePct: 0.3, qualityScore: 82, costPer1M: 100.0, contextWindow: 0, agentDemandPct: 3.2, trending: false },
  { id: 36, name: 'Gemini 1.5 Pro', provider: 'google', category: 'chat', elo: 1295, dailyRequests: 1600000, mindsharePct: 0.9, qualityScore: 86, costPer1M: 3.5, contextWindow: 2000000, agentDemandPct: 32.4, trending: false },
  { id: 37, name: 'Gemini Nano', provider: 'google', category: 'chat', elo: 1180, dailyRequests: 6400000, mindsharePct: 0.6, qualityScore: 68, costPer1M: 0.0, contextWindow: 32000, agentDemandPct: 18.2, trending: false },
  { id: 38, name: 'Phi-4', provider: 'microsoft', category: 'code', elo: 1275, dailyRequests: 1800000, mindsharePct: 0.7, qualityScore: 80, costPer1M: 0.0, contextWindow: 16000, agentDemandPct: 38.6, trending: true },
  { id: 39, name: 'Command R+ 08-2024', provider: 'cohere', category: 'chat', elo: 1262, dailyRequests: 480000, mindsharePct: 0.3, qualityScore: 78, costPer1M: 2.5, contextWindow: 128000, agentDemandPct: 24.8, trending: false },
  { id: 40, name: 'Mixtral 8x22B', provider: 'mistral', category: 'chat', elo: 1255, dailyRequests: 620000, mindsharePct: 0.4, qualityScore: 77, costPer1M: 0.6, contextWindow: 65536, agentDemandPct: 42.2, trending: false },
  { id: 41, name: 'GPT-4 Turbo', provider: 'openai', category: 'chat', elo: 1340, dailyRequests: 1400000, mindsharePct: 0.8, qualityScore: 90, costPer1M: 10.0, contextWindow: 128000, agentDemandPct: 46.8, trending: false },
  { id: 42, name: 'Claude 3 Opus', provider: 'anthropic', category: 'chat', elo: 1325, dailyRequests: 680000, mindsharePct: 0.5, qualityScore: 92, costPer1M: 15.0, contextWindow: 200000, agentDemandPct: 18.4, trending: false },
  { id: 43, name: 'Gemini 2.0 Pro', provider: 'google', category: 'chat', elo: 1348, dailyRequests: 1200000, mindsharePct: 0.6, qualityScore: 89, costPer1M: 5.0, contextWindow: 1000000, agentDemandPct: 34.2, trending: true },
  { id: 44, name: 'Yi-Large', provider: 'meta', category: 'chat', elo: 1242, dailyRequests: 520000, mindsharePct: 0.3, qualityScore: 76, costPer1M: 0.0, contextWindow: 32768, agentDemandPct: 22.6, trending: false },
  { id: 45, name: 'Mistral Nemo 12B', provider: 'mistral', category: 'chat', elo: 1218, dailyRequests: 1600000, mindsharePct: 0.5, qualityScore: 72, costPer1M: 0.15, contextWindow: 128000, agentDemandPct: 48.4, trending: false },
  { id: 46, name: 'Llama 3.1 405B', provider: 'meta', category: 'chat', elo: 1308, dailyRequests: 440000, mindsharePct: 0.3, qualityScore: 86, costPer1M: 0.0, contextWindow: 128000, agentDemandPct: 26.8, trending: false },
  { id: 47, name: 'Midjourney v6.1', provider: 'stability', category: 'image', elo: 1290, dailyRequests: 3200000, mindsharePct: 1.2, qualityScore: 92, costPer1M: 30.0, contextWindow: 0, agentDemandPct: 3.4, trending: false },
  { id: 48, name: 'GPT-o4-mini', provider: 'openai', category: 'chat', elo: 1345, dailyRequests: 2200000, mindsharePct: 1.0, qualityScore: 88, costPer1M: 1.1, contextWindow: 200000, agentDemandPct: 72.4, trending: true },
  { id: 49, name: 'Claude Haiku 4', provider: 'anthropic', category: 'chat', elo: 1332, dailyRequests: 3800000, mindsharePct: 2.2, qualityScore: 86, costPer1M: 0.5, contextWindow: 200000, agentDemandPct: 78.2, trending: true },
  { id: 50, name: 'Recraft V3', provider: 'stability', category: 'image', elo: 1252, dailyRequests: 890000, mindsharePct: 0.4, qualityScore: 84, costPer1M: 8.0, contextWindow: 0, agentDemandPct: 4.2, trending: true },
  { id: 51, name: 'Sonar Pro', provider: 'perplexity', category: 'chat', elo: 1348, dailyRequests: 2600000, mindsharePct: 1.8, qualityScore: 90, costPer1M: 3.0, contextWindow: 200000, agentDemandPct: 38.4, trending: true },
  { id: 52, name: 'Sonar Large 32K', provider: 'perplexity', category: 'chat', elo: 1312, dailyRequests: 1400000, mindsharePct: 0.9, qualityScore: 84, costPer1M: 1.0, contextWindow: 32000, agentDemandPct: 28.6, trending: false },
  { id: 53, name: 'Sonar Small', provider: 'perplexity', category: 'chat', elo: 1258, dailyRequests: 3200000, mindsharePct: 0.6, qualityScore: 76, costPer1M: 0.2, contextWindow: 32000, agentDemandPct: 44.2, trending: false },
]

// 2026-05-26 beta-quality fix: removed fabricated 6-month ELO trend dataset.
export const AI_MODEL_ELO_TRENDS = []

export const COIN_DESCRIPTIONS = {
  BTC: 'Bitcoin - Decentralized digital currency and store of value. Launched in 2009 by Satoshi Nakamoto. Limited supply of 21 million; secures the network via proof-of-work mining.',
  ETH: 'Ethereum - Smart contract platform for decentralized applications (dApps). Created by Vitalik Buterin in 2015. Powers DeFi, NFTs, and thousands of on-chain applications.',
  SOL: 'Solana - High-performance Layer 1 blockchain for scalable dApps and low-cost transactions. Launched in 2020. Uses proof-of-history alongside proof-of-stake for throughput.',
  USDT: 'Tether - Largest stablecoin by market cap. Pegged 1:1 to the US dollar. Used for trading, remittances, and as a liquidity pair across crypto exchanges and DeFi.',
  USDC: 'USD Coin - Fully reserved US dollar-backed stablecoin by Circle. Regulated and audited; widely used in DeFi, payments, and as a settlement asset.',
  BNB: 'BNB - Native token of BNB Chain (Binance Smart Chain). Used for fees, staking, and governance. Powers the Binance ecosystem and many dApps and DeFi protocols.',
  ARB: 'Arbitrum - Layer 2 scaling solution for Ethereum. Uses optimistic rollups for fast, low-cost transactions. Native token for governance and protocol fees.',
  OP: 'Optimism - Ethereum Layer 2 using optimistic rollups. Aims for low fees and high throughput while staying secured by Ethereum. OP token used for governance.',
  MATIC: 'Polygon - Ethereum scaling and infrastructure. Sidechains and proof-of-stake chain for fast, low-cost transactions. Powers thousands of dApps and enterprises.',
  AVAX: 'Avalanche - High-throughput Layer 1 with sub-second finality. Supports custom chains and DeFi, NFTs, and enterprise apps. AVAX is used for staking and fees.',
  LINK: 'Chainlink - Decentralized oracle network supplying real-world data to smart contracts. Industry standard for price feeds, VRF, and automation across chains.',
  UNI: 'Uniswap - Leading decentralized exchange (DEX) on Ethereum. Automated market maker (AMM) protocol. UNI token used for governance and fee sharing.',
}

export const WELCOME_STOCKS = [
  { symbol: 'SPY', name: 'S&P 500 ETF', price: 483.66, change: -0.8, avatar: 'SP', change1h: -0.1, change7d: -0.4 },
  { symbol: 'JPM', name: 'JPMorgan', price: 196.58, change: -2.1, avatar: 'JP', change1h: -0.3, change7d: -1.5 },
  { symbol: 'GLD', name: 'Gold (ETF)', price: 178.42, change: 0.5, avatar: 'Au', change1h: 0.1, change7d: 0.3 },
  { symbol: 'QQQ', name: 'Nasdaq 100 ETF', price: 412.34, change: 0.2, avatar: 'QQ', change1h: 0, change7d: -0.2 },
]

// ── TA Signal SVG Icons (Spectre design language - no emoji) ──
export const TA_SIGNAL_ICONS = {
  reversalDown: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v10M4 9l4 4 4-4"/><line x1="2" y1="14" x2="14" y2="14" strokeOpacity="0.4"/></svg>,
  reversalUp: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 14V4M4 7l4-4 4 4"/><line x1="2" y1="2" x2="14" y2="2" strokeOpacity="0.4"/></svg>,
  neutral: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8h12M11 5l3 3-3 3"/></svg>,
  momentum: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2l-2 5h4l-2 5"/><path d="M7 12l-1 2"/></svg>,
  volatility: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 8 4 4 7 11 10 5 13 9 15 6"/></svg>,
  correlation: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4h5M2 12h5M9 4h5M9 12h5"/><path d="M7 4l2 8M7 12l2-8" strokeOpacity="0.35" strokeDasharray="1.5 1.5"/></svg>,
  sentiment: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10a5 5 0 0110 0"/><path d="M8 10V6"/><circle cx="8" cy="5.5" r="0.5" fill="currentColor" stroke="none"/></svg>,
  dominance: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l2-5 2 3 2-3 2 5"/><path d="M3 12h10"/></svg>,
  funding: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3v10M11 3v10"/><path d="M3 6h6M7 10h6"/></svg>,
  whale: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 9c1-3 4-5 7-5s5 2 5 4-1 4-3 4c-1 0-2-1-2-2s1-2 2-2"/><path d="M2 9c0 2 1 4 3 4"/></svg>,
}
