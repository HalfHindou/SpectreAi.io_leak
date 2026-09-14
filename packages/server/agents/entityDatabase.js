/**
 * Spectre Intelligence — Entity Database
 * Single source of truth for all entity data across the platform.
 *
 * Consolidates data from:
 * - querySanitizer.js (TICKER_ALIASES, KNOWN_AMBIGUITIES, SPECTRE_IDENTITIES)
 * - dataLayer.js (FOUNDER_MAP, CG_ID_MAP)
 * - index.js (SYMBOL_TO_COINGECKO_ID, FALLBACK_STOCK_DATA)
 *
 * Auto-caches entities confirmed via CoinGecko during runtime.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TICKER → CANONICAL ENTITY
// Key: normalized ticker (uppercase, no $). Value: full entity object.
// ═══════════════════════════════════════════════════════════════════════════════
const byTicker = {
  // ── SPECTRE AI (internal — self-query) ───────────────────────────────────
  'SPECTRE': {
    name:        'Spectre AI',
    ticker:      'SPECTRE',
    aliases:     ['SPECT', 'SPECTREAI'],
    type:        'crypto',
    category:    'ai-tools',
    coingeckoId: 'spectre-ai',
    chain:       'ethereum',
    website:     'https://spectreai.io',
    xHandle:     '@Spectre__AI',
    founderX:    '@Sunny_Enzo',
    launched:    'November 2023',
    maxSupply:   10_000_000,
    isInternal:  true,
    notToBe: [
      'Spectre.Ai (binary options platform, Cayman Islands) — completely unrelated',
      'Spectral SPEC (zkML protocol) — different project entirely',
      'Spectre Network SPR (blockDAG L1) — different project entirely',
      'SPECTRE AI LTD (UK Companies House No. 16445942) — unrelated UK company listing',
    ],
  },

  // ── NEURAL AI ────────────────────────────────────────────────────────────
  'NEURAL': {
    name:        'NeuralAI',
    ticker:      'NEURAL',
    aliases:     ['NEURALAI'],
    type:        'crypto',
    category:    'ai-tools,gaming',
    coingeckoId: 'neural-ai',
    chain:       'ethereum',
    website:     'https://goneural.ai',
    xHandle:     '@GoNeuralAI',
    requiresCryptoContext: true,
    notToBe: [
      'Artificial neural networks (computer science/ML concept, NOT a crypto token)',
      'Neural.love (AI art generator, unrelated)',
      'Neural Concept (engineering simulation, unrelated)',
    ],
  },

  // ── ZIGCHAIN ─────────────────────────────────────────────────────────────
  'ZIG': {
    name:        'ZigChain',
    ticker:      'ZIG',
    aliases:     ['ZIGNALY', 'ZIGCHAIN'],
    type:        'crypto',
    category:    'rwa,infrastructure',
    coingeckoId: 'zignaly',
    chain:       'cosmos',
    website:     'https://zigchain.com',
    xHandle:     '@ZigChain',
  },

  // ── MAJOR CRYPTO ─────────────────────────────────────────────────────────
  'BTC': {
    name: 'Bitcoin', ticker: 'BTC', aliases: ['BITCOIN', 'XBT', 'WBTC'],
    type: 'crypto', coingeckoId: 'bitcoin', xHandle: '@satoshi (anonymous)',
  },
  'ETH': {
    name: 'Ethereum', ticker: 'ETH', aliases: ['ETHER', 'ETH2', 'WETH'],
    type: 'crypto', coingeckoId: 'ethereum', xHandle: '@VitalikButerin',
  },
  'SOL': {
    name: 'Solana', ticker: 'SOL', aliases: ['SOLANA', 'WSOL'],
    type: 'crypto', coingeckoId: 'solana', xHandle: '@aeyakovenko + @solana',
  },
  'BNB': {
    name: 'BNB', ticker: 'BNB', aliases: ['WBNB'],
    type: 'crypto', coingeckoId: 'binancecoin', xHandle: '@binance',
  },
  'XRP': {
    name: 'XRP', ticker: 'XRP', aliases: ['RIPPLE'],
    type: 'crypto', coingeckoId: 'ripple', xHandle: '@JoelKatz + @Ripple',
  },
  'ADA': {
    name: 'Cardano', ticker: 'ADA', aliases: ['CARDANO'],
    type: 'crypto', coingeckoId: 'cardano', xHandle: '@IOHK_Charles + @Cardano',
  },
  'DOGE': {
    name: 'Dogecoin', ticker: 'DOGE', aliases: ['DOGECOIN'],
    type: 'crypto', coingeckoId: 'dogecoin', xHandle: '@BillyM2k',
  },
  'AVAX': {
    name: 'Avalanche', ticker: 'AVAX', aliases: ['AVALANCHE'],
    type: 'crypto', coingeckoId: 'avalanche-2', xHandle: '@el33th4xor + @AvaLabs',
  },
  'LINK': {
    name: 'Chainlink', ticker: 'LINK', aliases: ['CHAINLINK'],
    type: 'crypto', coingeckoId: 'chainlink', xHandle: '@SergeyNazarov + @chainlink',
  },
  'DOT': {
    name: 'Polkadot', ticker: 'DOT', aliases: ['POLKADOT'],
    type: 'crypto', coingeckoId: 'polkadot', xHandle: '@gavofyork + @Polkadot',
  },
  'POL': {
    name: 'Polygon', ticker: 'POL', aliases: ['MATIC', 'POLYGON'],
    type: 'crypto', coingeckoId: 'matic-network', xHandle: '@sandeepnailwal + @0xPolygon',
  },
  'UNI': {
    name: 'Uniswap', ticker: 'UNI', aliases: ['UNISWAP'],
    type: 'crypto', coingeckoId: 'uniswap', xHandle: '@Uniswap',
  },
  'LTC': {
    name: 'Litecoin', ticker: 'LTC', aliases: ['LITECOIN'],
    type: 'crypto', coingeckoId: 'litecoin', xHandle: '@SatoshiLite',
  },
  'SHIB': {
    name: 'Shiba Inu', ticker: 'SHIB', aliases: [],
    type: 'crypto', coingeckoId: 'shiba-inu',
  },
  'TRX': {
    name: 'TRON', ticker: 'TRX', aliases: ['TRON'],
    type: 'crypto', coingeckoId: 'tron', xHandle: '@justinsuntron',
  },
  'BCH': {
    name: 'Bitcoin Cash', ticker: 'BCH', aliases: [],
    type: 'crypto', coingeckoId: 'bitcoin-cash',
  },
  'ARB': {
    name: 'Arbitrum', ticker: 'ARB', aliases: ['ARBITRUM'],
    type: 'crypto', coingeckoId: 'arbitrum', xHandle: '@OffchainLabs + @arbitrum',
  },
  'OP': {
    name: 'Optimism', ticker: 'OP', aliases: ['OPTIMISM'],
    type: 'crypto', coingeckoId: 'optimism', xHandle: '@optimismFND',
  },
  'NEAR': {
    name: 'NEAR Protocol', ticker: 'NEAR', aliases: [],
    type: 'crypto', coingeckoId: 'near', xHandle: '@NEARProtocol',
  },
  'ATOM': {
    name: 'Cosmos', ticker: 'ATOM', aliases: ['COSMOS'],
    type: 'crypto', coingeckoId: 'cosmos', xHandle: '@jaekwon + @cosmos',
  },
  'ICP': {
    name: 'Internet Computer', ticker: 'ICP', aliases: [],
    type: 'crypto', coingeckoId: 'internet-computer', xHandle: '@dominic_w + @dfinity',
  },
  'FIL': {
    name: 'Filecoin', ticker: 'FIL', aliases: ['FILECOIN'],
    type: 'crypto', coingeckoId: 'filecoin', xHandle: '@Filecoin',
  },
  'APT': {
    name: 'Aptos', ticker: 'APT', aliases: ['APTOS'],
    type: 'crypto', coingeckoId: 'aptos', xHandle: '@AptosLabs',
  },
  'SUI': {
    name: 'Sui', ticker: 'SUI', aliases: [],
    type: 'crypto', coingeckoId: 'sui', xHandle: '@SuiNetwork + @EvanCheng_',
  },
  'SEI': {
    name: 'Sei', ticker: 'SEI', aliases: [],
    type: 'crypto', coingeckoId: 'sei-network', xHandle: '@SeiNetwork + @jayendra_jog',
  },
  'TIA': {
    name: 'Celestia', ticker: 'TIA', aliases: ['CELESTIA'],
    type: 'crypto', coingeckoId: 'celestia', xHandle: '@CelestiaOrg + @musalbas',
  },
  'INJ': {
    name: 'Injective', ticker: 'INJ', aliases: ['INJECTIVE'],
    type: 'crypto', coingeckoId: 'injective-protocol', xHandle: '@InjectiveLabs',
  },
  'HBAR': {
    name: 'Hedera', ticker: 'HBAR', aliases: ['HEDERA'],
    type: 'crypto', coingeckoId: 'hedera-hashgraph', xHandle: '@Leemon + @hedera',
  },
  'MNT': {
    name: 'Mantle', ticker: 'MNT', aliases: [],
    type: 'crypto', coingeckoId: 'mantle', xHandle: '@0xMantle',
  },
  'MKR': {
    name: 'Maker', ticker: 'MKR', aliases: [],
    type: 'crypto', coingeckoId: 'maker', xHandle: '@RuneKek + @MakerDAO',
  },
  'AAVE': {
    name: 'Aave', ticker: 'AAVE', aliases: [],
    type: 'crypto', coingeckoId: 'aave', xHandle: '@StaniKulechov + @AaveAave',
  },
  'RENDER': {
    name: 'Render', ticker: 'RENDER', aliases: ['RNDR'],
    type: 'crypto', coingeckoId: 'render-token', xHandle: '@JulesUrbach + @RenderToken',
  },
  'FET': {
    name: 'Fetch.ai', ticker: 'FET', aliases: [],
    type: 'crypto', coingeckoId: 'fetch-ai', xHandle: '@Fetch_ai + @AISFnet',
  },
  'GRT': {
    name: 'The Graph', ticker: 'GRT', aliases: [],
    type: 'crypto', coingeckoId: 'the-graph', xHandle: '@graphprotocol',
  },
  'TAO': {
    name: 'Bittensor', ticker: 'TAO', aliases: ['BITTENSOR'],
    type: 'crypto', coingeckoId: 'bittensor', xHandle: '@opentensor',
  },
  'PEPE': {
    name: 'Pepe', ticker: 'PEPE', aliases: [],
    type: 'crypto', coingeckoId: 'pepe',
  },
  'BONK': {
    name: 'Bonk', ticker: 'BONK', aliases: [],
    type: 'crypto', coingeckoId: 'bonk',
  },
  'FLOKI': {
    name: 'Floki', ticker: 'FLOKI', aliases: [],
    type: 'crypto', coingeckoId: 'floki', xHandle: '@RealFlokiInu',
  },
  'WIF': {
    name: 'dogwifhat', ticker: 'WIF', aliases: [],
    type: 'crypto', coingeckoId: 'dogwifhat',
  },
  'ONDO': {
    name: 'Ondo Finance', ticker: 'ONDO', aliases: [],
    type: 'crypto', coingeckoId: 'ondo-finance', xHandle: '@OndoFinance',
  },
  'CFG': {
    name: 'Centrifuge', ticker: 'CFG', aliases: ['CENTRIFUGE'],
    type: 'crypto', coingeckoId: 'centrifuge', xHandle: '@centrifuge',
  },
  'MPL': {
    name: 'Maple', ticker: 'MPL', aliases: ['MAPLE'],
    type: 'crypto', coingeckoId: 'maple', xHandle: '@SidPowell + @maplefinance',
  },
  'ENA': {
    name: 'Ethena', ticker: 'ENA', aliases: ['ETHENA'],
    type: 'crypto', coingeckoId: 'ethena', xHandle: '@ethena_labs',
  },
  'AKT': {
    name: 'Akash Network', ticker: 'AKT', aliases: ['AKASH'],
    type: 'crypto', coingeckoId: 'akash-network', xHandle: '@gregosuri + @akash',
  },
  'HNT': {
    name: 'Helium', ticker: 'HNT', aliases: ['HELIUM'],
    type: 'crypto', coingeckoId: 'helium', xHandle: '@helium',
  },
  'ALGO': {
    name: 'Algorand', ticker: 'ALGO', aliases: ['ALGORAND'],
    type: 'crypto', coingeckoId: 'algorand', xHandle: '@silvio_micali + @Algorand',
  },
  'USDT': {
    name: 'Tether', ticker: 'USDT', aliases: ['TETHER'],
    type: 'crypto', coingeckoId: 'tether',
  },
  'USDC': {
    name: 'USD Coin', ticker: 'USDC', aliases: [],
    type: 'crypto', coingeckoId: 'usd-coin',
  },
  'CRV': {
    name: 'Curve', ticker: 'CRV', aliases: [],
    type: 'crypto', coingeckoId: 'curve-dao-token', xHandle: '@newmichwill + @CurveFinance',
  },
  'LDO': {
    name: 'Lido DAO', ticker: 'LDO', aliases: [],
    type: 'crypto', coingeckoId: 'lido-dao', xHandle: '@LidoFinance',
  },
  'SUSHI': {
    name: 'SushiSwap', ticker: 'SUSHI', aliases: [],
    type: 'crypto', coingeckoId: 'sushiswap', xHandle: '@SushiSwap',
  },
  'IMX': {
    name: 'Immutable', ticker: 'IMX', aliases: [],
    type: 'crypto', coingeckoId: 'immutable-x', xHandle: '@Immutable',
  },
  'JUP': {
    name: 'Jupiter', ticker: 'JUP', aliases: ['JUPITER'],
    type: 'crypto', coingeckoId: 'jupiter-exchange-solana', xHandle: '@JupiterExchange + @weremeow',
  },
  'JTO': {
    name: 'Jito', ticker: 'JTO', aliases: [],
    type: 'crypto', coingeckoId: 'jito-governance-token',
  },
  'PYTH': {
    name: 'Pyth Network', ticker: 'PYTH', aliases: [],
    type: 'crypto', coingeckoId: 'pyth-network',
  },

  // ── MAJOR STOCKS ─────────────────────────────────────────────────────────
  'AAPL':  { name: 'Apple Inc.',            ticker: 'AAPL',  type: 'stock', exchange: 'NASDAQ', sector: 'Technology' },
  'MSFT':  { name: 'Microsoft Corp.',       ticker: 'MSFT',  type: 'stock', exchange: 'NASDAQ', sector: 'Technology' },
  'GOOGL': { name: 'Alphabet Inc.',         ticker: 'GOOGL', type: 'stock', exchange: 'NASDAQ', sector: 'Technology' },
  'AMZN':  { name: 'Amazon.com Inc.',       ticker: 'AMZN',  type: 'stock', exchange: 'NASDAQ', sector: 'Consumer' },
  'NVDA':  { name: 'NVIDIA Corp.',          ticker: 'NVDA',  type: 'stock', exchange: 'NASDAQ', sector: 'Technology' },
  'TSLA':  { name: 'Tesla Inc.',            ticker: 'TSLA',  type: 'stock', exchange: 'NASDAQ', sector: 'Automotive' },
  'META':  { name: 'Meta Platforms',        ticker: 'META',  type: 'stock', exchange: 'NASDAQ', sector: 'Technology' },
  'JPM':   { name: 'JPMorgan Chase',        ticker: 'JPM',   type: 'stock', exchange: 'NYSE',   sector: 'Financial' },
  'V':     { name: 'Visa Inc.',             ticker: 'V',     type: 'stock', exchange: 'NYSE',   sector: 'Financial' },
  'MA':    { name: 'Mastercard Inc.',        ticker: 'MA',    type: 'stock', exchange: 'NYSE',   sector: 'Financial' },
  'BAC':   { name: 'Bank of America',        ticker: 'BAC',   type: 'stock', exchange: 'NYSE',   sector: 'Financial' },
  'GS':    { name: 'Goldman Sachs',          ticker: 'GS',    type: 'stock', exchange: 'NYSE',   sector: 'Financial' },
  'COIN':  { name: 'Coinbase Global',        ticker: 'COIN',  type: 'stock', exchange: 'NASDAQ', sector: 'Financial' },
  'PYPL':  { name: 'PayPal Holdings',        ticker: 'PYPL',  type: 'stock', exchange: 'NASDAQ', sector: 'Financial' },
  'JNJ':   { name: 'Johnson & Johnson',      ticker: 'JNJ',   type: 'stock', exchange: 'NYSE',   sector: 'Healthcare' },
  'UNH':   { name: 'UnitedHealth Group',     ticker: 'UNH',   type: 'stock', exchange: 'NYSE',   sector: 'Healthcare' },
  'LLY':   { name: 'Eli Lilly & Co.',        ticker: 'LLY',   type: 'stock', exchange: 'NYSE',   sector: 'Healthcare' },
  'WMT':   { name: 'Walmart Inc.',           ticker: 'WMT',   type: 'stock', exchange: 'NYSE',   sector: 'Consumer' },
  'HD':    { name: 'Home Depot',             ticker: 'HD',    type: 'stock', exchange: 'NYSE',   sector: 'Consumer' },
  'PG':    { name: 'Procter & Gamble',       ticker: 'PG',    type: 'stock', exchange: 'NYSE',   sector: 'Consumer' },
  'DIS':   { name: 'Walt Disney Co.',        ticker: 'DIS',   type: 'stock', exchange: 'NYSE',   sector: 'Communication' },
  'NFLX':  { name: 'Netflix Inc.',           ticker: 'NFLX',  type: 'stock', exchange: 'NASDAQ', sector: 'Communication' },
  'XOM':   { name: 'Exxon Mobil',            ticker: 'XOM',   type: 'stock', exchange: 'NYSE',   sector: 'Energy' },
  'AMD':   { name: 'Advanced Micro Devices', ticker: 'AMD',   type: 'stock', exchange: 'NASDAQ', sector: 'Technology' },
  'INTC':  { name: 'Intel Corp.',            ticker: 'INTC',  type: 'stock', exchange: 'NASDAQ', sector: 'Technology' },
  'CRM':   { name: 'Salesforce Inc.',        ticker: 'CRM',   type: 'stock', exchange: 'NYSE',   sector: 'Technology' },
  'ORCL':  { name: 'Oracle Corp.',           ticker: 'ORCL',  type: 'stock', exchange: 'NYSE',   sector: 'Technology' },
  'ADBE':  { name: 'Adobe Inc.',             ticker: 'ADBE',  type: 'stock', exchange: 'NASDAQ', sector: 'Technology' },
  'AVGO':  { name: 'Broadcom Inc.',          ticker: 'AVGO',  type: 'stock', exchange: 'NASDAQ', sector: 'Technology' },
  'ARM':   { name: 'ARM Holdings',           ticker: 'ARM',   type: 'stock', exchange: 'NASDAQ', sector: 'Technology' },
  'SMCI':  { name: 'Super Micro Computer',   ticker: 'SMCI',  type: 'stock', exchange: 'NASDAQ', sector: 'Technology' },
  'CRWD':  { name: 'CrowdStrike',            ticker: 'CRWD',  type: 'stock', exchange: 'NASDAQ', sector: 'Technology' },
  'MU':    { name: 'Micron Technology',       ticker: 'MU',    type: 'stock', exchange: 'NASDAQ', sector: 'Technology' },
  'PANW':  { name: 'Palo Alto Networks',      ticker: 'PANW',  type: 'stock', exchange: 'NASDAQ', sector: 'Technology' },
  'NET':   { name: 'Cloudflare Inc.',         ticker: 'NET',   type: 'stock', exchange: 'NYSE',   sector: 'Technology' },
  'PLTR':  { name: 'Palantir Technologies',   ticker: 'PLTR',  type: 'stock', exchange: 'NASDAQ', sector: 'Technology' },
  'GME':   { name: 'GameStop Corp.',          ticker: 'GME',   type: 'stock', exchange: 'NYSE',   sector: 'Consumer' },
  'AMC':   { name: 'AMC Entertainment',       ticker: 'AMC',   type: 'stock', exchange: 'NYSE',   sector: 'Communication' },
  'RIVN':  { name: 'Rivian Automotive',       ticker: 'RIVN',  type: 'stock', exchange: 'NASDAQ', sector: 'Automotive' },
  'SOFI':  { name: 'SoFi Technologies',       ticker: 'SOFI',  type: 'stock', exchange: 'NASDAQ', sector: 'Financial' },
  'HOOD':  { name: 'Robinhood Markets',       ticker: 'HOOD',  type: 'stock', exchange: 'NASDAQ', sector: 'Financial' },
  'MSTR':  { name: 'MicroStrategy Inc.',      ticker: 'MSTR',  type: 'stock', exchange: 'NASDAQ', sector: 'Technology' },
  'UBER':  { name: 'Uber Technologies',       ticker: 'UBER',  type: 'stock', exchange: 'NYSE',   sector: 'Technology' },
  'SHOP':  { name: 'Shopify Inc.',            ticker: 'SHOP',  type: 'stock', exchange: 'NYSE',   sector: 'Technology' },
  'SNAP':  { name: 'Snap Inc.',               ticker: 'SNAP',  type: 'stock', exchange: 'NYSE',   sector: 'Technology' },
  'RBLX':  { name: 'Roblox Corp.',            ticker: 'RBLX',  type: 'stock', exchange: 'NYSE',   sector: 'Technology' },
  'DKNG':  { name: 'DraftKings Inc.',         ticker: 'DKNG',  type: 'stock', exchange: 'NASDAQ', sector: 'Consumer' },
  'SPOT':  { name: 'Spotify Technology',      ticker: 'SPOT',  type: 'stock', exchange: 'NYSE',   sector: 'Technology' },
  'IONQ':  { name: 'IonQ Inc.',              ticker: 'IONQ',  type: 'stock', exchange: 'NYSE',   sector: 'Technology' },

  // ── ETFs / INDICES ───────────────────────────────────────────────────────
  'SPY':  { name: 'SPDR S&P 500 ETF',     ticker: 'SPY',  type: 'stock', exchange: 'NYSE', sector: 'Index' },
  'QQQ':  { name: 'Invesco QQQ Trust',    ticker: 'QQQ',  type: 'stock', exchange: 'NASDAQ', sector: 'Index' },
  'IWM':  { name: 'iShares Russell 2000', ticker: 'IWM',  type: 'stock', exchange: 'NYSE', sector: 'Index' },
  'GLD':  { name: 'SPDR Gold Trust',      ticker: 'GLD',  type: 'stock', exchange: 'NYSE', sector: 'Commodity' },
  'SLV':  { name: 'Silver ETF',           ticker: 'SLV',  type: 'stock', exchange: 'NYSE', sector: 'Commodity' },
  'VOO':  { name: 'Vanguard S&P 500 ETF', ticker: 'VOO',  type: 'stock', exchange: 'NYSE', sector: 'Index' },
  'DIA':  { name: 'Dow Jones ETF',        ticker: 'DIA',  type: 'stock', exchange: 'NYSE', sector: 'Index' },
  'ARKK': { name: 'ARK Innovation ETF',   ticker: 'ARKK', type: 'stock', exchange: 'NYSE', sector: 'Thematic' },
};

// ═══════════════════════════════════════════════════════════════════════════════
// NAME → TICKER  (lowercase name → canonical ticker for byTicker lookup)
// ═══════════════════════════════════════════════════════════════════════════════
const byName = {
  // Spectre AI
  'spectre ai':     'SPECTRE',
  'spectreai':      'SPECTRE',
  'spectre':        'SPECTRE',
  'spect':          'SPECTRE',
  // Neural AI
  'neural ai':      'NEURAL',
  'neuralai':       'NEURAL',
  'neural':         'NEURAL',
  // ZigChain
  'zigchain':       'ZIG',
  'zignaly':        'ZIG',
  // Major crypto
  'bitcoin':        'BTC',
  'ethereum':       'ETH',
  'solana':         'SOL',
  'polygon':        'POL',
  'matic':          'POL',
  'cardano':        'ADA',
  'polkadot':       'DOT',
  'chainlink':      'LINK',
  'dogecoin':       'DOGE',
  'avalanche':      'AVAX',
  'ripple':         'XRP',
  'litecoin':       'LTC',
  'uniswap':        'UNI',
  'cosmos':         'ATOM',
  'arbitrum':       'ARB',
  'optimism':       'OP',
  'celestia':       'TIA',
  'injective':      'INJ',
  'aptos':          'APT',
  'bittensor':      'TAO',
  'filecoin':       'FIL',
  'akash':          'AKT',
  'helium':         'HNT',
  'algorand':       'ALGO',
  'centrifuge':     'CFG',
  'maple':          'MPL',
  'ethena':         'ENA',
  'render':         'RENDER',
  'jupiter':        'JUP',
  'pyth':           'PYTH',
  'hedera':         'HBAR',
  'ondo':           'ONDO',
  // Stocks
  'apple':          'AAPL',
  'microsoft':      'MSFT',
  'nvidia':         'NVDA',
  'tesla':          'TSLA',
  'amazon':         'AMZN',
  'google':         'GOOGL',
  'alphabet':       'GOOGL',
  'palantir':       'PLTR',
  'coinbase':       'COIN',
  'meta':           'META',
};

// ═══════════════════════════════════════════════════════════════════════════════
// AMBIGUOUS NAMES — Names that match multiple real entities
// Key: lowercase search term. Value: array of options for disambiguation UI.
// ═══════════════════════════════════════════════════════════════════════════════
const ambiguous = {
  'luna': [
    { name: 'Terra Luna Classic', ticker: 'LUNC', coingeckoId: 'terra-luna', hint: 'Original Terra — collapsed May 2022' },
    { name: 'Terra Luna 2.0',     ticker: 'LUNA', coingeckoId: 'terra-luna-2', hint: 'Post-collapse rebrand' },
  ],
  'core': [
    { name: 'Core DAO',        ticker: 'CORE', coingeckoId: 'coredaoorg', hint: 'BTC-aligned L1 blockchain' },
    { name: 'Core Scientific', ticker: 'CORZ', hint: 'US-listed Bitcoin miner (stock)' },
  ],
  'nova': [
    { name: 'SuperNova', ticker: 'NOVA', hint: 'Multiple projects named Nova — specify chain' },
  ],
  'swap': [
    { name: 'Multiple DEX tokens named Swap', hint: 'Specify which chain or DEX' },
  ],
  'fusion': [
    { name: 'Multiple projects named Fusion', hint: 'Specify chain or project' },
  ],
  'prime': [
    { name: 'EcoPrimeChain', ticker: 'PRIME', hint: 'Specify which Prime project' },
    { name: 'Parallel Finance', ticker: 'PRIME', hint: 'Gaming NFT protocol' },
  ],
  'atlas': [
    { name: 'Multiple projects named Atlas', hint: 'Specify chain' },
  ],
  'ai': [
    { name: 'Too generic', hint: '"AI" matches hundreds of crypto projects — specify the project name' },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// TICKER NORMALIZATION — Wrong/alias → canonical. null = needs disambiguation.
// ═══════════════════════════════════════════════════════════════════════════════
const tickerAliases = {
  // Spectre AI
  'SPECT':      'SPECTRE',
  'SPECTREAI':  'SPECTRE',

  // Neural AI
  'NEURALAI':   'NEURAL',

  // ZigChain
  'ZIGNALY':    'ZIG',
  'ZIGCHAIN':   'ZIG',

  // Wrapped / legacy
  'ETH2':   'ETH',
  'WETH':   'ETH',
  'WBTC':   'BTC',
  'WBNB':   'BNB',
  'WSOL':   'SOL',
  'MATIC':  'POL',
  'XBT':    'BTC',
  'RNDR':   'RENDER',

  // Ambiguous — null means needs disambiguation, don't auto-resolve
  'SPEC':   null,     // Spectral (zkML) — different project, no redirect
  'SPR':    null,     // Spectre Network — different project, no redirect
  'LUNA':   null,     // Could be LUNA Classic or LUNA 2.0
};

// ═══════════════════════════════════════════════════════════════════════════════
// SELF-QUERY PATTERNS — Queries about Spectre AI itself
// ═══════════════════════════════════════════════════════════════════════════════
const SELF_QUERY_PATTERNS = [
  /\$spectre\b/i,
  /\$spect\b/i,
  /\bspectre[\s-]?ai\b/i,
  /\bspectreai\.io\b/i,
  /\bspect\b.*\btoken\b/i,
  /\bspectre\b.*\btoken\b/i,
  /what is spectre\b/i,
  /tell me about spectre\b/i,
  /\bspectre\b.*\bplatform\b/i,
  /\bspectre\s+lens\b/i,
  /\bspectre\s+terminal\b/i,
  /\bspectre\s+screener\b/i,
  /\bintelligence\s+hub\b/i,
  /\bspectre\s+search\b/i,
  /\bspectre\s+vibe\b/i,
  /^spectre$/i,
  /^spectre\s*\?*$/i,
  /\babout\s+spectre\b/i,
  /\bwho\s+is\s+spectre\b/i,
  /\bwho\s+made\s+spectre\b/i,
  /\bwho\s+built\s+spectre\b/i,
  /\bspectre\b.*\bcompany\b/i,
  /\bspectre\b.*\bteam\b/i,
  /\bspectre\b.*\bfounder\b/i,
  /\bspectre\b.*\bcrypto\b/i,
  /\bcheck\s+spectre\b/i,
  /\banalyze\s+spectre\b/i,
  /\bresearch\s+spectre\b/i,
  /\bspectre\b.*\b(coin|project)\b/i,
  /\b@spectre__ai\b/i,
  /\b@sunny_enzo\b/i,
];

// ═══════════════════════════════════════════════════════════════════════════════
// LOOKUP FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize a raw ticker: resolve aliases, strip $, uppercase.
 * Returns { ticker, canonical, needsDisambiguation }
 */
function normalizeTicker(raw) {
  const clean = raw.toUpperCase().trim().replace(/^\$/, '');
  if (tickerAliases[clean] === null) {
    return { ticker: clean, canonical: clean, needsDisambiguation: true };
  }
  const resolved = tickerAliases[clean] || clean;
  return { ticker: resolved, canonical: resolved, needsDisambiguation: false };
}

/**
 * Look up entity by ticker symbol. Checks aliases first.
 */
function lookupByTicker(symbol) {
  const { canonical, needsDisambiguation } = normalizeTicker(symbol);
  if (needsDisambiguation) return null;
  return byTicker[canonical] || null;
}

/**
 * Look up entity by project name (case insensitive).
 */
function lookupByName(name) {
  const key = name.toLowerCase().trim();
  const ticker = byName[key];
  if (!ticker) return null;
  return byTicker[ticker] || null;
}

/**
 * Get disambiguation options for a name or ticker.
 */
function getAmbiguousOptions(term) {
  const key = term.toLowerCase().trim();
  return ambiguous[key] || null;
}

/**
 * Check if a query is about Spectre AI itself.
 */
function isSelfQuery(query) {
  // Check tickers
  const tickerMatches = query.match(/\$([A-Za-z]{1,10})/g) || [];
  for (const t of tickerMatches) {
    const { canonical } = normalizeTicker(t.replace('$', ''));
    if (canonical === 'SPECTRE') return true;
  }
  // Check patterns
  return SELF_QUERY_PATTERNS.some(p => p.test(query));
}

/**
 * Add a CoinGecko-confirmed entity to the runtime cache.
 * Persists for the duration of the server process.
 */
function addCachedEntity(cgData) {
  if (!cgData || !cgData.symbol) return;
  const ticker = cgData.symbol.toUpperCase();
  // Don't overwrite hand-curated entries
  if (byTicker[ticker]) return;

  const entry = {
    name:        cgData.name,
    ticker:      ticker,
    aliases:     [],
    type:        'crypto',
    coingeckoId: cgData.id,
    chain:       cgData.asset_platform_id || null,
    website:     null,
    cachedAt:    Date.now(),
  };
  byTicker[ticker] = entry;
  if (cgData.name) {
    byName[cgData.name.toLowerCase()] = ticker;
  }
}

/**
 * Check if a ticker exists in the database (after normalization).
 */
function hasTicker(symbol) {
  const { canonical, needsDisambiguation } = normalizeTicker(symbol);
  if (needsDisambiguation) return false;
  return !!byTicker[canonical];
}

/**
 * Get the CoinGecko ID for a ticker.
 */
function getCoingeckoId(symbol) {
  const entity = lookupByTicker(symbol);
  return entity?.coingeckoId || null;
}

module.exports = {
  byTicker,
  byName,
  ambiguous,
  tickerAliases,
  SELF_QUERY_PATTERNS,
  normalizeTicker,
  lookupByTicker,
  lookupByName,
  getAmbiguousOptions,
  isSelfQuery,
  addCachedEntity,
  hasTicker,
  getCoingeckoId,
};
