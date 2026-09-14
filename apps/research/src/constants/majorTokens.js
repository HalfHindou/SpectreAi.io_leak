/**
 * Major tokens configuration
 * These tokens use CoinGecko/Binance APIs instead of Codex for better reliability
 */

// Major token symbols - these get data from CoinGecko instead of Codex
export const MAJOR_SYMBOLS = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK',
  'MATIC', 'UNI', 'ATOM', 'LTC', 'ETC', 'FIL', 'ARB', 'OP', 'NEAR', 'APT',
  'SUI', 'INJ', 'TIA', 'SEI', 'AAVE', 'MKR', 'CRV', 'LDO', 'GRT', 'RENDER',
  'RNDR', 'FET', 'TAO', 'ONDO', 'JUP', 'PYTH', 'USDT', 'USDC',
  // Spectre AI token - always searchable
  'SPECTRE',
  // PaLM AI - DEX token with CoinGecko coverage (chart cgId parity)
  'PALM'
]);

// SEED ONLY — synchronous fallback for binanceCatalog.js. For runtime checks
// use hasBinancePair() / binancePairFor() from '@/services/binanceCatalog'.
export const BINANCE_MAJORS = new Set([
  '0G','1000CAT','1000CHEEMS','1000SATS','1INCH','1MBABYDOGE','2Z','A','AAVE',
  'ACE','ACH','ACM','ACT','ACX','ADA','ADX','AEVO','AGLD','AI','AIXBT','ALCX',
  'ALGO','ALICE','ALLO','ALPINE','ALT','AMP','ANIME','ANKR','APE','API3','APT',
  'AR','ARB','ARDR','ARK','ARKM','ARPA','ASR','ASTER','ASTR','AT','ATA','ATM',
  'ATOM','AUCTION','AUDIO','AVA','AVAX','AVNT','AWE','AXL','AXS','BABY','BANANA',
  'BANANAS31','BAND','BANK','BAR','BARD','BAT','BB','BCH','BEAMX','BEL','BERA',
  'BICO','BIGTIME','BIO','BLUR','BMT','BNB','BNT','BOME','BONK','BREV',
  'BROCCOLI714','BTC','BTTC','C','C98','CAKE','CATI','CELO','CELR','CETUS',
  'CFG','CFX','CGPT','CHIP','CHR','CHZ','CITY','CKB','COMP','COOKIE','COS',
  'COTI','COW','CRV','CTK','CTSI','CVC','CVX','CYBER','D','DASH','DCR','DEXE',
  'DGB','DIA','DODO','DOGE','DOGS','DOLO','DOT','DUSK','DYDX','DYM','EDEN',
  'EDU','EGLD','EIGEN','ENA','ENJ','ENS','ENSO','EPIC','ERA','ESP','ETC','ETH',
  'ETHFI','EUL','F','FARM','FET','FF','FIDA','FIL','FLOKI','FLOW','FLUX',
  'FOGO','FORM','FTT','G','GALA','GAS','GIGGLE','GLM','GLMR','GMT','GMX','GNO',
  'GNS','GPS','GRT','GTC','GUN','HAEDAL','HBAR','HEI','HEMI','HFT','HIGH',
  'HIVE','HMSTR','HOLO','HOME','HOT','HUMA','HYPER','ICP','ICX','ID','ILV',
  'IMX','INIT','INJ','IO','IOST','IOTA','IOTX','IQ','JASMY','JOE','JST','JTO',
  'JUP','JUV','KAIA','KAITO','KAT','KAVA','KERNEL','KGST','KITE','KMNO','KNC',
  'KSM','LA','LAYER','LAZIO','LDO','LINEA','LINK','LISTA','LPT','LQTY','LSK',
  'LTC','LUMIA','LUNA','LUNC','MAGIC','MANA','MANTA','MANTRA','MASK','MAV',
  'MBL','MBOX','ME','MEGA','MEME','MET','METIS','MINA','MIRA','MITO','MLN',
  'MMT','MORPHO','MOVE','MOVR','MTL','MUBARAK','NEAR','NEIRO','NEO','NEWT',
  'NEXO','NFP','NIGHT','NIL','NMR','NOM','NOT','NXPC','OG','OGN','ONDO','ONE',
  'ONG','ONT','OP','OPEN','OPN','ORCA','ORDI','OSMO','PARTI','PENDLE','PENGU',
  'PEOPLE','PEPE','PHA','PHB','PIVX','PIXEL','PLUME','PNUT','POL','POLYX',
  'POND','PORTAL','PORTO','POWR','PROM','PROVE','PSG','PUMP','PUNDIX','PYR',
  'PYTH','QI','QKC','QNT','QTUM','QUICK','RAD','RARE','RAY','RED','RENDER',
  'REQ','RESOLV','REZ','RIF','RLC','ROBO','RONIN','ROSE','RPL','RSR','RUNE',
  'RVN','S','SAGA','SAHARA','SAND','SANTOS','SAPIEN','SC','SCR','SCRT','SEI',
  'SENT','SFP','SHELL','SHIB','SIGN','SKL','SKY','SLP','SNX','SOL','SOLV',
  'SOMI','SOPH','SPELL','SPK','SSV','STEEM','STG','STO','STORJ','STRAX','STRK',
  'STX','SUI','SUN','SUPER','SUSHI','SXT','SYN','SYRUP','SYS','T','TAO','TFUEL',
  'THE','THETA','TIA','TKO','TLM','TNSR','TON','TOWNS','TRB','TREE','TRUMP',
  'TRX','TST','TURBO','TURTLE','TUT','TWT','U','UMA','UNI','USUAL','VANA',
  'VANRY','VELODROME','VET','VIC','VIRTUAL','VTHO','W','WAL','WAXP','WCT',
  'WIF','WIN','WLD','WLFI','WOO','XAI','XEC','XLM','XNO','XPL','XRP','XTZ',
  'XVG','XVS','YB','YFI','YGG','ZAMA','ZBT','ZEC','ZEN','ZIL','ZK','ZKC',
  'ZKP','ZRO','ZRX',
]);

// Check if a symbol is a major token
export const isMajorToken = (symbol) => {
  if (!symbol) return false;
  return MAJOR_SYMBOLS.has(symbol.toUpperCase().trim());
};

// Check if a major token has an address (needs Codex, not CoinGecko)
export const getMajorTokenAddress = (symbol) => {
  if (!symbol) return null;
  const info = MAJOR_TOKEN_INFO[symbol.toUpperCase().trim()];
  return info?.address || null;
};

// Check if a token uses CoinGecko (major token without custom address)
export const usesCoinGecko = (symbol) => {
  if (!symbol) return false;
  const upper = symbol.toUpperCase().trim();
  return MAJOR_SYMBOLS.has(upper) && !MAJOR_TOKEN_INFO[upper]?.address;
};

// CoinGecko ID mapping for major tokens
export const SYMBOL_TO_COINGECKO_ID = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  LINK: 'chainlink',
  MATIC: 'matic-network',
  UNI: 'uniswap',
  ATOM: 'cosmos',
  LTC: 'litecoin',
  ETC: 'ethereum-classic',
  FIL: 'filecoin',
  ARB: 'arbitrum',
  OP: 'optimism',
  NEAR: 'near',
  APT: 'aptos',
  SUI: 'sui',
  INJ: 'injective-protocol',
  TIA: 'celestia',
  SEI: 'sei-network',
  AAVE: 'aave',
  MKR: 'maker',
  CRV: 'curve-dao-token',
  LDO: 'lido-dao',
  GRT: 'the-graph',
  RENDER: 'render-token',
  RNDR: 'render-token',
  FET: 'fetch-ai',
  TAO: 'bittensor',
  ONDO: 'ondo-finance',
  JUP: 'jupiter-exchange-solana',
  PYTH: 'pyth-network',
  USDT: 'tether',
  USDC: 'usd-coin',
  PEPE: 'pepe',
  WIF: 'dogwifcoin',
  BONK: 'bonk',
  SHIB: 'shiba-inu',
  FLOKI: 'floki',
  SPECTRE: 'spectre-ai',
  PALM: 'palm-ai',
};

// Major token metadata for search results (static, always available)
export const MAJOR_TOKEN_INFO = {
  // Native L1 tokens — no EVM/SPL address, on-chain data unavailable
  BTC: { symbol: 'BTC', name: 'Bitcoin', network: 'Bitcoin', networkId: 0 },
  XRP: { symbol: 'XRP', name: 'XRP', network: 'XRP', networkId: 0 },
  ADA: { symbol: 'ADA', name: 'Cardano', network: 'Cardano', networkId: 0 },
  DOT: { symbol: 'DOT', name: 'Polkadot', network: 'Polkadot', networkId: 0 },
  ATOM: { symbol: 'ATOM', name: 'Cosmos', network: 'Cosmos', networkId: 0 },
  LTC: { symbol: 'LTC', name: 'Litecoin', network: 'Litecoin', networkId: 0 },
  APT: { symbol: 'APT', name: 'Aptos', network: 'Aptos', networkId: 0 },
  SUI: { symbol: 'SUI', name: 'Sui', network: 'Sui', networkId: 0 },
  INJ: { symbol: 'INJ', name: 'Injective', network: 'Injective', networkId: 0 },
  TAO: { symbol: 'TAO', name: 'Bittensor', network: 'Bittensor', networkId: 0 },
  NEAR: { symbol: 'NEAR', name: 'NEAR Protocol', network: 'NEAR', networkId: 0 },
  FET: { symbol: 'FET', name: 'Fetch.ai', network: 'Fetch.ai', networkId: 0 },
  RENDER: { symbol: 'RENDER', name: 'Render', network: 'Render', networkId: 0 },
  ONDO: { symbol: 'ONDO', name: 'Ondo Finance', network: 'Ondo', networkId: 0 },
  TIA: { symbol: 'TIA', name: 'Celestia', network: 'Celestia', networkId: 0 },
  SEI: { symbol: 'SEI', name: 'Sei', network: 'Sei', networkId: 0 },
  // ERC-20 tokens on Ethereum — on-chain data available via Codex
  ETH: { symbol: 'ETH', name: 'Ethereum', network: 'Ethereum', networkId: 1, address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
  USDT: { symbol: 'USDT', name: 'Tether', network: 'Ethereum', networkId: 1, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  USDC: { symbol: 'USDC', name: 'USD Coin', network: 'Ethereum', networkId: 1, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  LINK: { symbol: 'LINK', name: 'Chainlink', network: 'Ethereum', networkId: 1, address: '0x514910771AF9Ca656af840dff83E8264EcF986CA' },
  UNI: { symbol: 'UNI', name: 'Uniswap', network: 'Ethereum', networkId: 1, address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984' },
  AAVE: { symbol: 'AAVE', name: 'Aave', network: 'Ethereum', networkId: 1, address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9' },
  MKR: { symbol: 'MKR', name: 'Maker', network: 'Ethereum', networkId: 1, address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2' },
  PEPE: { symbol: 'PEPE', name: 'Pepe', network: 'Ethereum', networkId: 1, address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933' },
  SHIB: { symbol: 'SHIB', name: 'Shiba Inu', network: 'Ethereum', networkId: 1, address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE' },
  FLOKI: { symbol: 'FLOKI', name: 'Floki', network: 'Ethereum', networkId: 1, address: '0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E' },
  MATIC: { symbol: 'MATIC', name: 'Polygon', network: 'Ethereum', networkId: 1, address: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0' },
  DOGE: { symbol: 'DOGE', name: 'Dogecoin', network: 'Ethereum', networkId: 1, address: '0x4206931337dc273a630d328dA6441786BfaD668f' },
  BNB: { symbol: 'BNB', name: 'BNB', network: 'Ethereum', networkId: 1, address: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52' },
  AVAX: { symbol: 'AVAX', name: 'Avalanche', network: 'Avalanche', networkId: 43114 },
  // L2 tokens
  ARB: { symbol: 'ARB', name: 'Arbitrum', network: 'Arbitrum', networkId: 42161, address: '0x912CE59144191C1204E64559FE8253a0e49E6548' },
  OP: { symbol: 'OP', name: 'Optimism', network: 'Optimism', networkId: 10, address: '0x4200000000000000000000000000000000000042' },
  // Solana SPL tokens — on-chain data available via Codex
  SOL: { symbol: 'SOL', name: 'Solana', network: 'Solana', networkId: 1399811149, address: 'So11111111111111111111111111111111111111112' },
  WIF: { symbol: 'WIF', name: 'dogwifhat', network: 'Solana', networkId: 1399811149, address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
  BONK: { symbol: 'BONK', name: 'Bonk', network: 'Solana', networkId: 1399811149, address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
  JUP: { symbol: 'JUP', name: 'Jupiter', network: 'Solana', networkId: 1399811149, address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' },
  PYTH: { symbol: 'PYTH', name: 'Pyth Network', network: 'Solana', networkId: 1399811149, address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3' },
  POPCAT: { symbol: 'POPCAT', name: 'Popcat', network: 'Solana', networkId: 1399811149, address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr' },
  MEW: { symbol: 'MEW', name: 'cat in a dogs world', network: 'Solana', networkId: 1399811149, address: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5' },
  BOME: { symbol: 'BOME', name: 'BOOK OF MEME', network: 'Solana', networkId: 1399811149, address: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82' },
  MOG: { symbol: 'MOG', name: 'Mog Coin', network: 'Ethereum', networkId: 1, address: '0xaaee1a9723aadb7afa2810263653a34ba2c21c7a' },
  TURBO: { symbol: 'TURBO', name: 'Turbo', network: 'Ethereum', networkId: 1, address: '0xA35923162C49cF95e6BF26623385eb431ad920D3' },
  BRETT: { symbol: 'BRETT', name: 'Brett', network: 'Base', networkId: 8453, address: '0x532f27101965dd16442E59d40670FaF5eBB142E4' },
  TOSHI: { symbol: 'TOSHI', name: 'Toshi', network: 'Base', networkId: 8453, address: '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4' },
  DEGEN: { symbol: 'DEGEN', name: 'Degen', network: 'Base', networkId: 8453, address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed' },
  MOODENG: { symbol: 'MOODENG', name: 'Moo Deng', network: 'Solana', networkId: 1399811149, address: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY' },
  GOAT: { symbol: 'GOAT', name: 'Goatseus Maximus', network: 'Solana', networkId: 1399811149, address: 'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump' },
  FARTCOIN: { symbol: 'FARTCOIN', name: 'Fartcoin', network: 'Solana', networkId: 1399811149, address: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump' },
  AI16Z: { symbol: 'AI16Z', name: 'ai16z', network: 'Solana', networkId: 1399811149, address: 'HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC' },
  VIRTUAL: { symbol: 'VIRTUAL', name: 'Virtuals Protocol', network: 'Base', networkId: 8453, address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b' },
  // Spectre AI - our token
  SPECTRE: { symbol: 'SPECTRE', name: 'Spectre AI', network: 'Ethereum', networkId: 1, address: '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6' },
  PALM: { symbol: 'PALM', name: 'PaLM AI', network: 'Ethereum', networkId: 1, address: '0xf1df7305E4BAB3885caB5B1e4dFC338452a67891' },
};

// CoinGecko logos for major tokens
export const COINGECKO_LOGOS = {
  BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  SOL: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  BNB: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  XRP: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  ADA: 'https://assets.coingecko.com/coins/images/975/small/cardano.png',
  DOGE: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  AVAX: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  DOT: 'https://assets.coingecko.com/coins/images/12171/small/polkadot.png',
  LINK: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  MATIC: 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png',
  UNI: 'https://assets.coingecko.com/coins/images/12504/small/uni.jpg',
  ATOM: 'https://assets.coingecko.com/coins/images/1481/small/cosmos_hub.png',
  LTC: 'https://assets.coingecko.com/coins/images/2/small/litecoin.png',
  ETC: 'https://assets.coingecko.com/coins/images/453/small/ethereum-classic-logo.png',
  FIL: 'https://assets.coingecko.com/coins/images/12817/small/filecoin.png',
  ARB: 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
  OP: 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
  NEAR: 'https://assets.coingecko.com/coins/images/10365/small/near.jpg',
  APT: 'https://assets.coingecko.com/coins/images/26455/small/aptos_round.png',
  SUI: 'https://assets.coingecko.com/coins/images/26375/small/sui_asset.jpeg',
  INJ: 'https://assets.coingecko.com/coins/images/12882/small/Secondary_Symbol.png',
  TIA: 'https://assets.coingecko.com/coins/images/31967/small/tia.jpg',
  SEI: 'https://assets.coingecko.com/coins/images/28205/small/Sei_Logo_-_Transparent.png',
  AAVE: 'https://assets.coingecko.com/coins/images/12645/small/AAVE.png',
  MKR: 'https://assets.coingecko.com/coins/images/1364/small/Mark_Maker.png',
  CRV: 'https://assets.coingecko.com/coins/images/12124/small/Curve.png',
  LDO: 'https://assets.coingecko.com/coins/images/13573/small/Lido_DAO.png',
  GRT: 'https://assets.coingecko.com/coins/images/13397/small/Graph_Token.png',
  RENDER: 'https://assets.coingecko.com/coins/images/11636/small/rndr.png',
  RNDR: 'https://assets.coingecko.com/coins/images/11636/small/rndr.png',
  FET: 'https://assets.coingecko.com/coins/images/5681/small/Fetch.jpg',
  TAO: 'https://assets.coingecko.com/coins/images/28452/small/ARUsPeNQ_400x400.jpeg',
  ONDO: 'https://assets.coingecko.com/coins/images/26580/small/ONDO.png',
  JUP: 'https://assets.coingecko.com/coins/images/34188/small/jup.png',
  PYTH: 'https://assets.coingecko.com/coins/images/31924/small/pyth.png',
  PEPE: 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg',
  WIF: 'https://assets.coingecko.com/coins/images/33566/small/dogwifhat.jpg',
  BONK: 'https://assets.coingecko.com/coins/images/28600/small/bonk.jpg',
  SHIB: 'https://assets.coingecko.com/coins/images/11939/small/shiba.png',
  FLOKI: 'https://assets.coingecko.com/coins/images/16746/small/PNG_image.png',
  USDT: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  USDC: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  SPECTRE: 'https://coin-images.coingecko.com/coins/images/33066/small/logo_round_transparent.png',
  PALM: 'https://coin-images.coingecko.com/coins/images/33097/small/PALM_NEW_LOGO.png',
};

export default {
  MAJOR_SYMBOLS,
  isMajorToken,
  SYMBOL_TO_COINGECKO_ID,
  MAJOR_TOKEN_INFO,
  COINGECKO_LOGOS,
};
