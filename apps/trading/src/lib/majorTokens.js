/**
 * Major tokens — shared registry consumed by Header and CommandPalette.
 *
 * Source of truth was previously inlined in Header.jsx. Lifted here so the
 * new CommandPalette (Obsidian & Lime P2) can reuse the same instant local
 * typeahead set without duplicating data.
 *
 * Shape: { [SYMBOL]: { address, networkId, name } }
 *
 * Network IDs follow Codex conventions:
 *   1          Ethereum
 *   10         Optimism
 *   56         BSC
 *   137        Polygon
 *   8453       Base
 *   42161      Arbitrum
 *   1399811149 Solana
 */

export const MAJOR_TOKEN_ADDR = {
  BTC:      { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', networkId: 1, name: 'Bitcoin' },
  WBTC:     { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', networkId: 1, name: 'Wrapped Bitcoin' },
  ETH:      { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', networkId: 1, name: 'Ethereum' },
  WETH:     { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', networkId: 1, name: 'Wrapped Ether' },
  SOL:      { address: 'So11111111111111111111111111111111111111112', networkId: 1399811149, name: 'Solana' },
  USDT:     { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', networkId: 1, name: 'Tether' },
  USDC:     { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', networkId: 1, name: 'USD Coin' },
  BNB:      { address: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52', networkId: 1, name: 'BNB' },
  LINK:     { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', networkId: 1, name: 'Chainlink' },
  UNI:      { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', networkId: 1, name: 'Uniswap' },
  AAVE:     { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', networkId: 1, name: 'Aave' },
  ARB:      { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', networkId: 42161, name: 'Arbitrum' },
  DOGE:     { address: '0x4206931337dc273a630d328dA6441786BfaD668f', networkId: 1, name: 'Dogecoin' },
  AVAX:     { address: '0x85f138bfEE4ef8e540890CFb48F620571d67Eda3', networkId: 1, name: 'Avalanche' },
  PEPE:     { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', networkId: 1, name: 'Pepe' },
  SHIB:     { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', networkId: 1, name: 'Shiba Inu' },
  MATIC:    { address: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', networkId: 1, name: 'Polygon' },
  OP:       { address: '0x4200000000000000000000000000000000000042', networkId: 10, name: 'Optimism' },
  WIF:      { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', networkId: 1399811149, name: 'dogwifhat' },
  BONK:     { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', networkId: 1399811149, name: 'Bonk' },
  JUP:      { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', networkId: 1399811149, name: 'Jupiter' },
  POPCAT:   { address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', networkId: 1399811149, name: 'Popcat' },
  MEW:      { address: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', networkId: 1399811149, name: 'cat in a dogs world' },
  BOME:     { address: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82', networkId: 1399811149, name: 'BOOK OF MEME' },
  MOG:      { address: '0xaaee1a9723aadb7afa2810263653a34ba2c21c7a', networkId: 1, name: 'Mog Coin' },
  TURBO:    { address: '0xA35923162C49cF95e6BF26623385eb431ad920D3', networkId: 1, name: 'Turbo' },
  BRETT:    { address: '0x532f27101965dd16442E59d40670FaF5eBB142E4', networkId: 8453, name: 'Brett' },
  TOSHI:    { address: '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4', networkId: 8453, name: 'Toshi' },
  DEGEN:    { address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', networkId: 8453, name: 'Degen' },
  MOODENG:  { address: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', networkId: 1399811149, name: 'Moo Deng' },
  GOAT:     { address: 'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump', networkId: 1399811149, name: 'Goatseus Maximus' },
  FARTCOIN: { address: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', networkId: 1399811149, name: 'Fartcoin' },
  AI16Z:    { address: 'HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC', networkId: 1399811149, name: 'ai16z' },
  VIRTUAL:  { address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', networkId: 8453, name: 'Virtuals Protocol' },
  SPECTRE:  { address: '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6', networkId: 1, name: 'Spectre AI' },
}

/**
 * Wrapped-major CONTRACT address -> the underlying asset's CoinGecko id.
 * Lets a deep-link / reload of the wrapped contract (WBTC/WETH/WBNB/wSOL)
 * resolve to the REAL asset (Bitcoin/Ethereum/...) instead of the wrapped
 * token's own stats. Keys are lowercased.
 */
export const WRAPPED_ADDR_TO_CGID = {
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'bitcoin',     // WBTC
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'ethereum',    // WETH
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': 'binancecoin', // WBNB (BSC)
  '0xb8c77482e45f1f44de1745f52c74426c631bdd52': 'binancecoin', // BNB (legacy Ethereum ERC-20 - thin DEX pool, price real BNB from CG)
  'so11111111111111111111111111111111111111112': 'solana',     // wSOL
}

/**
 * Real ON-CHAIN large-caps we deliberately serve from CoinGecko (Markets /
 * Key-Stats / Performance panel + CG price) instead of their on-chain DEX view.
 * Unlike WRAPPED_ADDR_TO_CGID these are the asset's CANONICAL contract with deep
 * liquidity (their DEX price is already correct) - the CG panel is just the
 * better surface for an established CEX-listed coin. Pure on-chain degens
 * (MOG/TURBO/BRETT/GOAT/FARTCOIN/POPCAT/MEW/BOME/SPECTRE/...) are intentionally
 * EXCLUDED so they keep the on-chain Transactions/Holders view where the alpha
 * is. Scope confirmed with Gleb 2026-06-25 ("large-cap / CEX coins only").
 * Keys lowercased (EVM 0x + Solana base58 both lowercased for lookup only).
 * NOTE: MATIC's ERC-20 (0x7d1a..) is priced via 'polygon-ecosystem-token' (POL,
 * 1:1 post-rebrand) - 'matic-network' returns no price. WIF='dogwifcoin'.
 */
export const ONCHAIN_MAJOR_ADDR_TO_CGID = {
  '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce': 'shiba-inu',               // SHIB
  '0x6982508145454ce325ddbe47a25d4ec3d2311933': 'pepe',                    // PEPE
  '0x4206931337dc273a630d328da6441786bfad668f': 'dogecoin',                // DOGE (ETH)
  '0x514910771af9ca656af840dff83e8264ecf986ca': 'chainlink',               // LINK
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'uniswap',                 // UNI
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 'aave',                    // AAVE
  '0x85f138bfee4ef8e540890cfb48f620571d67eda3': 'avalanche-2',             // AVAX (ETH-bridged; was 4.4% off the thin pool)
  '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0': 'polygon-ecosystem-token', // MATIC/POL
  '0x912ce59144191c1204e64559fe8253a0e49e6548': 'arbitrum',                // ARB
  '0x4200000000000000000000000000000000000042': 'optimism',               // OP
  'dezxaz8z7pnrnrjjz3wxborgixca6xjnb7yab1ppb263': 'bonk',                  // BONK (SOL)
  'ekpqgsjtjmfqkz9kqansqyxrcf8fbopzlhyxdm65zcjm': 'dogwifcoin',            // WIF (SOL)
  'jupyiwryjfskupiha7hker8vutaefosybkedznsdvcn': 'jupiter-exchange-solana', // JUP (SOL)
}

/**
 * Resolve the CoinGecko id for a token IF it's a "major" we serve from
 * CoinGecko (BTC/ETH/SOL/BNB wrapped, a curated on-chain large-cap, or an
 * off-chain major whose slug is used as its address - XRP/ADA/...). Returns
 * null for ordinary on-chain DEX tokens. Single source of truth shared by
 * useTokenDetails (detail panel) + the major-coin Markets/Key-Stats/Performance
 * panel.
 */
export function resolveMajorCgId({ cgId, address } = {}) {
  if (cgId) return cgId
  const a = typeof address === 'string' ? address.toLowerCase() : ''
  if (!a) return null
  if (WRAPPED_ADDR_TO_CGID[a]) return WRAPPED_ADDR_TO_CGID[a]
  if (ONCHAIN_MAJOR_ADDR_TO_CGID[a]) return ONCHAIN_MAJOR_ADDR_TO_CGID[a]
  // Off-chain major slug used as the address (e.g. "ripple", "cardano").
  if (a.length < 32 && /^[a-z][a-z0-9-]+$/.test(a) && !a.startsWith('0x')) return a
  return null
}

/**
 * Instant local fuzzy match across MAJOR_TOKEN_ADDR.
 * Returns scored matches (highest first), capped to `limit`.
 * Zero API cost — runs on every keystroke.
 *
 * Score scale:
 *   1000 exact symbol  · 950 exact name
 *    800 symbol prefix · 700 name prefix
 *    500 symbol contains · 400 name contains
 */
export function searchLocalMajors(query, limit = 12) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []

  const matches = []
  for (const [symbol, info] of Object.entries(MAJOR_TOKEN_ADDR)) {
    const sym = symbol.toLowerCase()
    const name = (info.name || '').toLowerCase()
    let score = 0
    if (sym === q) score = 1000
    else if (name === q) score = 950
    else if (sym.startsWith(q)) score = 800
    else if (name.startsWith(q)) score = 700
    else if (sym.includes(q)) score = 500
    else if (name.includes(q)) score = 400
    if (score > 0) {
      matches.push({
        symbol,
        name: info.name,
        address: info.address,
        networkId: info.networkId,
        logo: '',
        price: 0,
        change: 0,
        _score: score,
        _source: 'local',
      })
    }
  }
  matches.sort((a, b) => b._score - a._score)
  return matches.slice(0, limit)
}
