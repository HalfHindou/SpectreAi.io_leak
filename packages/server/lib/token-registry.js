/**
 * SINGLE SOURCE OF TRUTH for all crypto token address mappings.
 * Both server/index.js and api/codex.js must use this.
 *
 * Rules:
 * - Every token MUST have a `binanceSymbol` for Binance REST/klines fallback
 * - Tokens with DEX addresses get `address` + `networkId` for Codex
 * - Tokens without DEX addresses (XRP, ADA) get `address: null` but MUST have `binanceSymbol`
 * - `coingeckoId` is optional, used for CoinGecko fallback
 * - Stock symbols (AAPL, TSLA) are NOT in this registry — use FALLBACK_STOCK_DATA
 */

const TOKEN_REGISTRY = {
  // === MAJORS (have both Codex address AND Binance pair) ===
  'BTC': {
    address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC on Ethereum
    networkId: 1,
    binanceSymbol: 'BTCUSDT',
    coingeckoId: 'bitcoin',
    name: 'Bitcoin',
    decimals: 8,
  },
  'ETH': {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    networkId: 1,
    binanceSymbol: 'ETHUSDT',
    coingeckoId: 'ethereum',
    name: 'Ethereum',
    decimals: 18,
  },
  'SOL': {
    address: 'So11111111111111111111111111111111111111112',
    networkId: 1399811149,
    binanceSymbol: 'SOLUSDT',
    coingeckoId: 'solana',
    name: 'Solana',
    decimals: 9,
  },
  'BNB': {
    address: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52',
    networkId: 1,
    binanceSymbol: 'BNBUSDT',
    coingeckoId: 'binancecoin',
    name: 'BNB',
    decimals: 18,
  },
  'DOGE': {
    address: '0x4206931337dc273a630d328dA6441786BfaD668f',
    networkId: 1,
    binanceSymbol: 'DOGEUSDT',
    coingeckoId: 'dogecoin',
    name: 'Dogecoin',
  },

  // === CEX-ONLY MAJORS (no DEX address, Binance is primary) ===
  'XRP': {
    address: null,
    networkId: null,
    binanceSymbol: 'XRPUSDT',
    coingeckoId: 'ripple',
    name: 'XRP',
  },
  'ADA': {
    address: null,
    networkId: null,
    binanceSymbol: 'ADAUSDT',
    coingeckoId: 'cardano',
    name: 'Cardano',
  },
  'AVAX': {
    address: null,
    networkId: null,
    binanceSymbol: 'AVAXUSDT',
    coingeckoId: 'avalanche-2',
    name: 'Avalanche',
  },
  'DOT': {
    address: null,
    networkId: null,
    binanceSymbol: 'DOTUSDT',
    coingeckoId: 'polkadot',
    name: 'Polkadot',
  },
  'NEAR': {
    address: null,
    networkId: null,
    binanceSymbol: 'NEARUSDT',
    coingeckoId: 'near',
    name: 'NEAR Protocol',
  },
  'APT': {
    address: null,
    networkId: null,
    binanceSymbol: 'APTUSDT',
    coingeckoId: 'aptos',
    name: 'Aptos',
  },
  'SUI': {
    address: null,
    networkId: null,
    binanceSymbol: 'SUIUSDT',
    coingeckoId: 'sui',
    name: 'Sui',
  },
  'INJ': {
    address: null,
    networkId: null,
    binanceSymbol: 'INJUSDT',
    coingeckoId: 'injective-protocol',
    name: 'Injective',
  },
  'FET': {
    address: null,
    networkId: null,
    binanceSymbol: 'FETUSDT',
    coingeckoId: 'fetch-ai',
    name: 'Fetch.ai',
  },
  'RENDER': {
    address: null,
    networkId: null,
    binanceSymbol: 'RENDERUSDT',
    coingeckoId: 'render-token',
    name: 'Render',
  },
  'LTC': {
    address: null,
    networkId: null,
    binanceSymbol: 'LTCUSDT',
    coingeckoId: 'litecoin',
    name: 'Litecoin',
  },
  'ATOM': {
    address: null,
    networkId: null,
    binanceSymbol: 'ATOMUSDT',
    coingeckoId: 'cosmos',
    name: 'Cosmos',
  },
  'ONDO': {
    address: null,
    networkId: null,
    binanceSymbol: 'ONDOUSDT',
    coingeckoId: 'ondo-finance',
    name: 'Ondo Finance',
  },
  'TIA': {
    address: null,
    networkId: null,
    binanceSymbol: 'TIAUSDT',
    coingeckoId: 'celestia',
    name: 'Celestia',
  },
  'SEI': {
    address: null,
    networkId: null,
    binanceSymbol: 'SEIUSDT',
    coingeckoId: 'sei-network',
    name: 'Sei',
  },
  'TAO': {
    address: null,
    networkId: null,
    binanceSymbol: 'TAOUSDT',
    coingeckoId: 'bittensor',
    name: 'Bittensor',
  },

  // === DEX TOKENS (Ethereum) ===
  'SPECTRE': {
    address: '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6',
    networkId: 1,
    binanceSymbol: null,
    coingeckoId: 'spectre-ai',
    name: 'Spectre AI',
  },
  'PEPE': {
    address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
    networkId: 1,
    binanceSymbol: 'PEPEUSDT',
    coingeckoId: 'pepe',
    name: 'Pepe',
  },
  'SHIB': {
    address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
    networkId: 1,
    binanceSymbol: 'SHIBUSDT',
    coingeckoId: 'shiba-inu',
    name: 'Shiba Inu',
  },
  'FLOKI': {
    address: '0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E',
    networkId: 1,
    binanceSymbol: 'FLOKIUSDT',
    coingeckoId: 'floki',
    name: 'Floki',
  },
  'UNI': {
    address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
    networkId: 1,
    binanceSymbol: 'UNIUSDT',
    coingeckoId: 'uniswap',
    name: 'Uniswap',
  },
  'AAVE': {
    address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
    networkId: 1,
    binanceSymbol: 'AAVEUSDT',
    coingeckoId: 'aave',
    name: 'Aave',
  },
  'LINK': {
    address: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
    networkId: 1,
    binanceSymbol: 'LINKUSDT',
    coingeckoId: 'chainlink',
    name: 'Chainlink',
  },
  'GRT': {
    address: '0xc944E90C64B2c07662A292be6244BDf05Cda44a7',
    networkId: 1,
    binanceSymbol: 'GRTUSDT',
    coingeckoId: 'the-graph',
    name: 'The Graph',
  },
  'MKR': {
    address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2',
    networkId: 1,
    binanceSymbol: 'MKRUSDT',
    coingeckoId: 'maker',
    name: 'Maker',
  },
  'CRV': {
    address: '0xD533a949740bb3306d119CC777fa900bA034cd52',
    networkId: 1,
    binanceSymbol: 'CRVUSDT',
    coingeckoId: 'curve-dao-token',
    name: 'Curve DAO',
  },
  'SUSHI': {
    address: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2',
    networkId: 1,
    binanceSymbol: 'SUSHIUSDT',
    coingeckoId: 'sushi',
    name: 'SushiSwap',
  },
  'ARB': {
    address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    networkId: 42161,
    binanceSymbol: 'ARBUSDT',
    coingeckoId: 'arbitrum',
    name: 'Arbitrum',
  },
  'OP': {
    address: '0x4200000000000000000000000000000000000042',
    networkId: 10,
    binanceSymbol: 'OPUSDT',
    coingeckoId: 'optimism',
    name: 'Optimism',
  },
  'MATIC': {
    address: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0',
    networkId: 1,
    binanceSymbol: 'MATICUSDT',
    coingeckoId: 'matic-network',
    name: 'Polygon',
  },
  'PENDLE': {
    address: '0x808507121B80c02388fAd14726482e061B8da827',
    networkId: 1,
    binanceSymbol: 'PENDLEUSDT',
    coingeckoId: 'pendle',
    name: 'Pendle',
  },
  'USDT': {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    networkId: 1,
    binanceSymbol: null,
    coingeckoId: 'tether',
    name: 'Tether',
  },
  'USDC': {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    networkId: 1,
    binanceSymbol: null,
    coingeckoId: 'usd-coin',
    name: 'USD Coin',
  },

  // === SOLANA DEX TOKENS ===
  'WIF': {
    address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    networkId: 1399811149,
    binanceSymbol: 'WIFUSDT',
    coingeckoId: 'dogwifcoin',
    name: 'dogwifhat',
  },
  'BONK': {
    address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    networkId: 1399811149,
    binanceSymbol: 'BONKUSDT',
    coingeckoId: 'bonk',
    name: 'Bonk',
  },
  'MOODENG': {
    address: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY',
    networkId: 1399811149,
    binanceSymbol: null,
    coingeckoId: null,
    name: 'Moo Deng',
  },
  'PAAL': {
    address: '0x14fee680690900ba0cccfc76ad70fd1b95d10e16',
    networkId: 1,
    binanceSymbol: null,
    coingeckoId: null,
    name: 'PAAL AI',
  },
  'PALM': {
    address: '0xf1df7305E4BAB3885caB5B1e4dFC338452a67891',
    networkId: 1,
    binanceSymbol: null,
    coingeckoId: 'palm-ai',
    name: 'PaLM AI',
  },
  'ZIG': {
    address: '0xb2617246d0c6c0087f18703d576831899ca94f01',
    networkId: 1,
    binanceSymbol: null,
    coingeckoId: 'zignaly',
    name: 'ZIGChain',
  },
};

/**
 * Codex network ID -> human-readable name.
 * Used by api/codex.js to label search results.
 */
const CODEX_NETWORKS = {
  1399811149: 'Solana',
  1: 'Ethereum',
  56: 'BNB Chain',
  137: 'Polygon',
  42161: 'Arbitrum',
  8453: 'Base',
  43114: 'Avalanche',
  10: 'Optimism',
  250: 'Fantom',
  4663: 'Robinhood Chain',
};

/**
 * Canonical pricing addresses for major cryptocurrencies (wrapped versions).
 * Used in handleTokenPrices() to fetch BTC/ETH/SOL pricing by address.
 * Derived from TOKEN_REGISTRY entries that have an address.
 */
const WELL_KNOWN_TOKENS = {
  BTC: { address: TOKEN_REGISTRY.BTC.address, networkId: TOKEN_REGISTRY.BTC.networkId, name: TOKEN_REGISTRY.BTC.name },
  ETH: { address: TOKEN_REGISTRY.ETH.address, networkId: TOKEN_REGISTRY.ETH.networkId, name: TOKEN_REGISTRY.ETH.name },
  SOL: { address: TOKEN_REGISTRY.SOL.address, networkId: TOKEN_REGISTRY.SOL.networkId, name: TOKEN_REGISTRY.SOL.name },
};

/**
 * Symbol -> { address, networkId } lookup for chart bars and similar address-keyed APIs.
 * Auto-derived from TOKEN_REGISTRY entries that have a non-null address.
 */
const KNOWN_TOKEN_ADDRESSES = (() => {
  const out = {};
  for (const [sym, info] of Object.entries(TOKEN_REGISTRY)) {
    if (info && info.address) {
      out[sym] = { address: info.address, networkId: info.networkId };
    }
  }
  return out;
})();

/**
 * Symbol -> CoinGecko ID for price/market_chart fallback when Codex fails or has no data.
 * Derived from TOKEN_REGISTRY (any entry with `coingeckoId`) plus extras for tokens
 * not currently in the registry but supported by CoinGecko.
 */
const SYMBOL_TO_COINGECKO_ID = (() => {
  const out = {};
  for (const [sym, info] of Object.entries(TOKEN_REGISTRY)) {
    if (info && info.coingeckoId) out[sym] = info.coingeckoId;
  }
  // Extras not in the canonical registry (kept for fallback parity)
  const extras = {
    TRX: 'tron',
    BCH: 'bitcoin-cash',
    LDO: 'lido-dao',
    RNDR: 'render-token',
    FIL: 'filecoin',
    JUP: 'jupiter-exchange-solana',
    JTO: 'jito-governance-token',
    PYTH: 'pyth-network',
  };
  for (const [sym, id] of Object.entries(extras)) {
    if (!out[sym]) out[sym] = id;
  }
  return out;
})();

/**
 * Popular Solana tokens — keyed by lowercase search term (symbol/name/alias).
 * Used by api/codex.js search to surface popular Solana tokens that may not
 * appear in standard Codex search results.
 */
const POPULAR_SOLANA_TOKENS = {
  'wif': { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: '$WIF', name: 'dogwifhat' },
  '$wif': { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: '$WIF', name: 'dogwifhat' },
  'dogwifhat': { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: '$WIF', name: 'dogwifhat' },
  'bonk': { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk' },
  'jup': { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter' },
  'jupiter': { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter' },
  'pyth': { address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', symbol: 'PYTH', name: 'Pyth Network' },
  'jito': { address: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', symbol: 'JTO', name: 'Jito' },
  'jto': { address: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', symbol: 'JTO', name: 'Jito' },
  'render': { address: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', symbol: 'RENDER', name: 'Render' },
  'rndr': { address: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', symbol: 'RENDER', name: 'Render' },
  'popcat': { address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', symbol: 'POPCAT', name: 'Popcat' },
  'wen': { address: 'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk', symbol: 'WEN', name: 'Wen' },
  'bome': { address: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82', symbol: 'BOME', name: 'Book of Meme' },
  'moodeng': { address: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', symbol: 'MOODENG', name: 'Moo Deng' },
  'moo deng': { address: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', symbol: 'MOODENG', name: 'Moo Deng' },
  'sol': { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Wrapped SOL' },
};

/**
 * EXTENDED_CG_TOKENS - cgId -> { symbol, name, address, networkId } for top
 * CoinGecko tokens with a canonical contract that are NOT in TOKEN_REGISTRY.
 * Used by the search-hydration maps (prod apps/trading/api/codex.js
 * _CGID_TO_KNOWN_TOKEN + dev _devCgIdToKnownToken in index.js) so Hetzner
 * /v1/search identity rows resolve to tradeable addresses without falling
 * through to Codex.
 *
 * Deliberately a SEPARATE export: TOKEN_REGISTRY entries carry a
 * binanceSymbol contract and feed price paths - these do not.
 *
 * EVERY address here was validated against CoinGecko /coins/{id} platform
 * contracts on 2026-06-10 (scripts/validate-extended-cg-tokens.mjs - 35/35
 * exact matches). A wrong address routes a real trade to a wrong contract:
 * run that script again after ANY edit to this map.
 */
const EXTENDED_CG_TOKENS = {
  'lido-dao': { symbol: 'LDO', name: 'Lido DAO', address: '0x5a98fcbea516cf06857215779fd812ca3bef1b32', networkId: 1 },
  'render-token': { symbol: 'RENDER', name: 'Render', address: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', networkId: 1399811149 },
  'jupiter-exchange-solana': { symbol: 'JUP', name: 'Jupiter', address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', networkId: 1399811149 },
  'pyth-network': { symbol: 'PYTH', name: 'Pyth Network', address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', networkId: 1399811149 },
  'jito-governance-token': { symbol: 'JTO', name: 'Jito', address: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', networkId: 1399811149 },
  'popcat': { symbol: 'POPCAT', name: 'Popcat', address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', networkId: 1399811149 },
  'book-of-meme': { symbol: 'BOME', name: 'Book of Meme', address: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82', networkId: 1399811149 },
  'ondo-finance': { symbol: 'ONDO', name: 'Ondo', address: '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3', networkId: 1 },
  'ethena': { symbol: 'ENA', name: 'Ethena', address: '0x57e114b691db790c35207b2e685d4a43181e6061', networkId: 1 },
  'worldcoin-wld': { symbol: 'WLD', name: 'Worldcoin', address: '0x163f8c2467924be0ae7b5347228cabf260318753', networkId: 1 },
  'fetch-ai': { symbol: 'FET', name: 'Artificial Superintelligence Alliance', address: '0xaea46a60368a7bd060eec7df8cba43b7ef41ad85', networkId: 1 },
  'injective-protocol': { symbol: 'INJ', name: 'Injective', address: '0xe28b3b32b6c345a34ff64674606124dd5aceca30', networkId: 1 },
  'immutable-x': { symbol: 'IMX', name: 'Immutable', address: '0xf57e7e7c23978c3caec3c3548e3d615c346e79ff', networkId: 1 },
  'havven': { symbol: 'SNX', name: 'Synthetix', address: '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', networkId: 1 },
  'compound-governance-token': { symbol: 'COMP', name: 'Compound', address: '0xc00e94cb662c3520282e6f5717214004a7f26888', networkId: 1 },
  'apecoin': { symbol: 'APE', name: 'ApeCoin', address: '0x4d224452801aced8b2f0aebe155379bb5d594381', networkId: 1 },
  'ethereum-name-service': { symbol: 'ENS', name: 'Ethereum Name Service', address: '0xc18360217d8f7ab5e7c516566761ea12ce7f9d72', networkId: 1 },
  'chiliz': { symbol: 'CHZ', name: 'Chiliz', address: '0x3506424f91fd33084466f402d5d97f05f8e3b4af', networkId: 1 },
  'the-sandbox': { symbol: 'SAND', name: 'The Sandbox', address: '0x3845badade8e6dff049820680d1f14bd3903a5d0', networkId: 1 },
  'decentraland': { symbol: 'MANA', name: 'Decentraland', address: '0x0f5d2fb29fb7d3cfee444a200298f468908cc942', networkId: 1 },
  'loopring': { symbol: 'LRC', name: 'Loopring', address: '0xbbbbca6a901c926f240b89eacb641d8aec7aeafd', networkId: 1 },
  '1inch': { symbol: '1INCH', name: '1inch', address: '0x111111111117dc0aa78b770fa6a738034120c302', networkId: 1 },
  'dai': { symbol: 'DAI', name: 'Dai', address: '0x6b175474e89094c44da98b954eedeac495271d0f', networkId: 1 },
  'wrapped-bitcoin': { symbol: 'WBTC', name: 'Wrapped Bitcoin', address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', networkId: 1 },
  'staked-ether': { symbol: 'STETH', name: 'Lido Staked Ether', address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', networkId: 1 },
  'wrapped-steth': { symbol: 'WSTETH', name: 'Wrapped stETH', address: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', networkId: 1 },
  'leo-token': { symbol: 'LEO', name: 'LEO Token', address: '0x2af5d2ad76741191d15dfe7bf6ac92d4bd912ca3', networkId: 1 },
  'okb': { symbol: 'OKB', name: 'OKB', address: '0x75231f58b43240c9718dd58b4967c5114342a86c', networkId: 1 },
  'fartcoin': { symbol: 'FARTCOIN', name: 'Fartcoin', address: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', networkId: 1399811149 },
  'pudgy-penguins': { symbol: 'PENGU', name: 'Pudgy Penguins', address: '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv', networkId: 1399811149 },
  'official-trump': { symbol: 'TRUMP', name: 'Official Trump', address: '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', networkId: 1399811149 },
  'aerodrome-finance': { symbol: 'AERO', name: 'Aerodrome Finance', address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631', networkId: 8453 },
  'based-brett': { symbol: 'BRETT', name: 'Brett', address: '0x532f27101965dd16442e59d40670faf5ebb142e4', networkId: 8453 },
  'virtual-protocol': { symbol: 'VIRTUAL', name: 'Virtuals Protocol', address: '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b', networkId: 8453 },
  'aixbt': { symbol: 'AIXBT', name: 'aixbt by Virtuals', address: '0x4f9fd6be4a90f2620860d680c0d4d5fb53d1a825', networkId: 8453 },
};

// Helpers
function getTokenInfo(symbol) {
  return TOKEN_REGISTRY[(symbol || '').toUpperCase()] || null;
}

function hasCodexAddress(symbol) {
  const info = getTokenInfo(symbol);
  return info && info.address !== null;
}

function hasBinancePair(symbol) {
  const info = getTokenInfo(symbol);
  return info && info.binanceSymbol !== null;
}

function getBinanceSymbol(symbol) {
  const info = getTokenInfo(symbol);
  return info?.binanceSymbol || null;
}

function getAllSymbols() {
  return Object.keys(TOKEN_REGISTRY);
}

function getBinanceSymbols() {
  return getAllSymbols().filter(hasBinancePair);
}

function findSymbolByAddress(address, networkId) {
  if (!address) return null;
  const addrLower = address.toLowerCase();
  for (const [sym, info] of Object.entries(TOKEN_REGISTRY)) {
    if (info && info.address && info.address.toLowerCase() === addrLower) {
      if (!info.networkId || info.networkId === parseInt(networkId)) return sym;
    }
  }
  return null;
}

module.exports = {
  TOKEN_REGISTRY,
  CODEX_NETWORKS,
  WELL_KNOWN_TOKENS,
  KNOWN_TOKEN_ADDRESSES,
  SYMBOL_TO_COINGECKO_ID,
  POPULAR_SOLANA_TOKENS,
  EXTENDED_CG_TOKENS,
  getTokenInfo,
  hasCodexAddress,
  hasBinancePair,
  getBinanceSymbol,
  getAllSymbols,
  getBinanceSymbols,
  findSymbolByAddress,
};
