// Brand palette derived from the ZIGChain logo mark.
export const ZIG_BRAND_1 = '#3B82F6'                 // logo blue
export const ZIG_BRAND_2 = '#06B6D4'                 // logo cyan
export const ZIG_BRAND_GRADIENT = 'linear-gradient(135deg, #3B82F6 0%, #06B6D4 100%)'

// Legacy amber kept for the existing pillar; new chrome should use blue/cyan.
export const ZIG_ACCENT = 'rgb(251, 191, 36)'
export const ZIG_ACCENT_DIM = 'rgba(251, 191, 36, 0.4)'
export const ZIG_ORB = 'rgba(251, 191, 36, 0.04)'

// Round coin avatar (CoinGecko) — used in the right-rail token panel,
// watchlist tiles, and any spot where a circular ticker logo is appropriate.
export const ZIG_LOGO = 'https://coin-images.coingecko.com/coins/images/14796/small/zig.jpg?1731990265'
export const ZIG_LOGO_LG = 'https://coin-images.coingecko.com/coins/images/14796/large/zig.jpg?1731990265'
// Official horizontal ZIGChain wordmark — wave mark + white "ZIGChain"
// wordmark on a transparent background. Use this for hero panels and any
// branded section where the full identity should read at scale.
export const ZIG_WORDMARK = '/founders/zigchain-logo.png'

export const ZIG_SOCIALS = [
  { name: 'Website', url: 'https://zigchain.com/', icon: 'globe' },
  { name: 'X / Twitter', url: 'https://x.com/zigchain', icon: 'x' },
  { name: 'Telegram', url: 'https://telegram.me/ZignalyHQ', icon: 'telegram' },
  { name: 'Discord', url: 'https://discord.com/channels/486954374845956097/', icon: 'discord' },
  { name: 'Medium', url: 'https://medium.com/zignaly/', icon: 'medium' },
  { name: 'GitHub', url: 'https://github.com/ZIGChain', icon: 'github' },
  { name: 'Documentation', url: 'https://docs.zigchain.com/', icon: 'docs' },
]

// Featured video carousel — newest first. Mixes Abdul's "Access Granted"
// podcast (he hosts) with long-form interviews and the official ZIGChain
// channel highlights. Update when new episodes ship.
export const ZIG_YOUTUBE = {
  channel: 'https://www.youtube.com/@ZIGChain',
  videos: [
    { id: 'spHtaweaf7I', title: "What's Next for Crypto in 2026? — Paklaunch × Abdul Rafay Gadit", date: 'Dec 21, 2025', tag: 'Guest' },
    { id: 'dXHZKSVF1qs', title: 'Blockchain, Digital Wealth Management & Tokenized Assets Explained', date: 'Dec 5, 2025', tag: 'Guest' },
    { id: '1RjmGiBxToM', title: "90% of the World's Muslims Still Lack Access to Global Finance — Can Blockchain Fix It?", date: '2025', tag: 'Guest' },
    { id: '5x2CSqULtAw', title: 'Building Wealth Generation from Web3 — ZIGChain testnet launch', date: 'Jan 26, 2025', tag: 'Guest' },
    { id: 'uHOUiPpJ_o0', title: "Crypto, Regulation & Pakistan's Financial Future", date: '2025', tag: 'Dawn News' },
    { id: '6m6KUeUfbpc', title: 'Zignaly Announces Cosmos-Based ZIGChain & $100M Ecosystem Fund', date: 'Apr 17, 2024', tag: 'News' },
    { id: 'EWcQ4m91Ylk', title: 'ZIGChain Summit Dubai — Livestream', date: '2025', tag: 'Summit' },
    { id: '9rBJptys6s8', title: 'Why I Invested 7 Figures Into ZIGChain (Stasher Capital)', date: '2025', tag: 'Investor' },
    { id: 'lQJnADKcr8k', title: 'Building the Future of RWAs on Cosmos', date: '2025', tag: 'RWA' },
    { id: 'oDVq9EGA2HM', title: 'Bridging DeFi and Traditional Finance', date: '2025', tag: 'RWA' },
    { id: 'xUBXE9ZjNTM', title: 'The True Promise of DeFi: Real-World Assets for Everyone', date: '2025', tag: 'RWA' },
    { id: 'rZCV02haQnM', title: 'Access to RWAs Is Changing — How ZIGChain Makes It Possible', date: '2025', tag: 'RWA' },
  ],
}

export const ZIG_CHART_WIDGET = 'https://framer.com/m/FreeCryptoChartComponent-DLBLKL.js@hG32Bj4Qs3TDkvUh9JVS'

// Fallback chain: unavatar tries multiple sources (twitter → website favicon → clearbit)
// `?fallback=false` would disable; we leave it on for max coverage.
export const PARTNER_LOGOS = {
  // Locally hosted to avoid CORS / 403 from third-party logo APIs.
  // apex-group.png: 1605-byte PNG, orange "A·" mark — confirmed via curl.
  // btcs-inc.png:   1904-byte PNG, BTCS Inc. rebranded leaf mark — confirmed via curl.
  'Apex Group': '/partners/apex-group.png',
  'Ondo Finance': 'https://coin-images.coingecko.com/coins/images/26580/small/ONDO.png?1696525355',
  'Zamanat': 'https://www.zamanathq.com/zamanat-logo-white.png',
  'Tokeny (via Apex)': 'https://unavatar.io/twitter/TokenySolutions',
  'BTCS Inc.': '/partners/btcs-inc.png',
  // Truleum: no accessible public logo. Ava component gracefully shows "T" letter avatar.
  'Truleum Ventures': null,
  // unavatar.io multi-source lookup (twitter → favicon → clearbit). Avatars
  // gracefully fall back to a letter tile if all sources 403/404.
  'Fasset': 'https://unavatar.io/fasset.com',
  'Beehive': 'https://unavatar.io/beehive.ae',
  'Zoniqx': 'https://unavatar.io/twitter/Zoniqx',
  'Taurus': 'https://unavatar.io/taurushq.com',
}

export const PROTOCOL_LOGOS = {
  'Valdora': 'https://unavatar.io/twitter/ValdoraFinance',
  'Oroswap': 'https://cdn.prod.website-files.com/67c08c75839e7a77900212c1/67e3e85fd203e356fc60b50a_logo.svg',
  'PermaPod': 'https://unavatar.io/twitter/PermaPod_xyz',
  'Zamanat': 'https://www.zamanathq.com/zamanat-logo-white.png',
  'Nawa Finance': 'https://unavatar.io/twitter/NawaFinance',
  'Zignaly': 'https://unavatar.io/twitter/Zignaly',
  'Degen Terminal': 'https://www.google.com/s2/favicons?sz=128&domain=degenterminal.com',
  'Range': 'https://www.google.com/s2/favicons?sz=128&domain=range.org',
  'ZigScan': 'https://www.google.com/s2/favicons?sz=128&domain=zigscan.org',
}

export const ZIGCHAIN_STATIC = {
  token: {
    symbol: 'ZIG',
    name: 'ZIGChain',
    coingeckoId: 'zigchain',
    maxSupply: 2_000_000_000,
    circulatingSupply: 1_408_940_795,
    totalSupply: 1_953_940_795,
  },
  chain: {
    framework: 'Cosmos SDK',
    consensus: 'Tendermint BFT PoS',
    evmCompatible: true,
    languages: ['Solidity', 'CosmWasm/Rust'],
    mainnetLaunch: 'October 2025',
    chainId: 'zigchain-1',
    explorer: 'https://app.range.org/zigchain/general',
    explorerAlt: 'https://www.zigscan.org/',
    hub: 'https://hub.zigchain.com/',
    docs: 'https://docs.zigchain.com/',
    contracts: {
      ethereum: 'https://etherscan.io/token/0xb2617246d0c6c0087f18703d576831899ca94f01',
      bsc: 'https://bscscan.com/token/0x8c907e0a72c3d55627e853f4ec6a96b0c8771145',
    },
  },
  protocols: [
    { name: 'Valdora', category: 'Liquid Staking', tvlEstimate: 10_000_000, url: 'https://www.valdora.finance/', desc: 'Stake ZIG, receive stZIG liquid staking derivatives. Earn staking yields while maintaining DeFi liquidity across the ecosystem.', metrics: 'Est. $10M TVL' },
    { name: 'Oroswap', category: 'RWA DEX', tvlEstimate: 4_000_000, url: 'https://www.oroswap.org/', desc: 'AI-powered DEX with smart routing, Adaptive Concentrated Liquidity (ACL), multi-farm staking, and natural language trading.', metrics: '$106M volume · 72K wallets · 97M swaps' },
    { name: 'PermaPod', category: 'RWA Lending', tvlEstimate: 10_000_000, url: 'https://permapod.xyz', desc: 'Borrow against crypto or tokenized real estate collateral. Earn passive yields from income-generating properties verified on-chain. Halborn audited.', metrics: '$10M+ TVL · 70% avg LTV · 30+ audited contracts' },
    { name: 'Zamanat', category: 'RWA Tokenization', tvlEstimate: null, url: 'https://www.zamanathq.com/', desc: "World's first Shariah-compliant RWA tokenization platform. Bridges Islamic finance and blockchain with $3B+ in tokenized fund pipeline.", metrics: '$3B+ pipeline' },
    { name: 'Nawa Finance', category: 'Islamic DeFi', tvlEstimate: null, url: 'https://www.nawa.finance/', desc: 'Halal yield generation and lending without interest-based mechanisms. Part of ZIGChain\'s protocol-level Shariah certification layer.', metrics: 'Shariah certified' },
    { name: 'Zignaly', category: 'Wealth Mgmt', tvlEstimate: null, url: 'https://zignaly.com', desc: 'Social crypto wealth management since 2018. Copy-trade 150+ professional portfolio managers with profit-sharing — pay only on realized gains.', metrics: '600K+ users · 150+ managers' },
    { name: 'Degen Terminal', category: 'Trading Terminal', tvlEstimate: null, url: 'https://degenterminal.com', desc: 'Pro trading interface for ZIGChain markets. Advanced order types, on-chain order books, and PnL analytics for active traders.', metrics: 'ZIGChain native' },
    { name: 'Range', category: 'Validator Monitoring', tvlEstimate: null, url: 'https://app.range.org/zigchain/general', desc: 'Real-time validator health and IBC monitoring. Powers ZIGChain network observability and operator alerting.', metrics: 'Network observability' },
    { name: 'ZigScan', category: 'Block Explorer', tvlEstimate: null, url: 'https://www.zigscan.org/', desc: 'Native block explorer for ZIGChain. Search transactions, validators, IBC channels, and smart-contract activity in real time.', metrics: 'Mainnet explorer' },
  ],
  partnerships: [
    { name: 'Apex Group', role: 'Fund Administration · RWA Tokenization', stat: '$3.4T AUA', statRaw: 3_400_000_000_000, date: 'July 2025', status: 'Active' },
    { name: 'Ondo Finance', role: 'Tokenized Stocks & ETFs · Global Equities', stat: '$1.26B Mcap · $2.8B TVL', statRaw: 2_800_000_000, date: 'Jun 2026', status: 'Active' },
    { name: 'Fasset', role: 'Halal RWA Distribution · Shariah-Compliant Platform', stat: '$6B+ Annual Volume · 125 Countries', statRaw: 6_000_000_000, date: '2026', status: 'Active' },
    { name: 'Zamanat', role: "World's First Shariah RWA Platform", stat: '$3B+ Pipeline', statRaw: 3_000_000_000, date: '2025', status: 'Active' },
    { name: 'Taurus', role: 'FINMA-Regulated Custody · Backed by Deutsche Bank & Credit Suisse', stat: 'Taurus-PROTECT Institutional Custody', statRaw: null, date: 'Apr 2026', status: 'Active' },
    { name: 'Zoniqx', role: 'Institutional Tokenization · Automated Compliance', stat: 'Regulated Tokenized Markets', statRaw: null, date: 'Dec 2025', status: 'Active' },
    { name: 'Beehive', role: 'Tokenized SME Private Credit · DFSA-Regulated', stat: 'UAE Private Credit', statRaw: null, date: '2026', status: 'Active' },
    { name: 'BTCS Inc.', role: 'Institutional Strategic Allocation', stat: '$30M Commitment', statRaw: 30_000_000, date: 'Sept 2025', status: 'Active' },
    { name: 'Tokeny (via Apex)', role: 'ERC-3643 Compliance Architecture', stat: 'Digital Securities Standard', statRaw: null, date: '2025', status: 'Active' },
    { name: 'Truleum Ventures', role: 'Regulatory Design · Dubai DIFC', stat: 'First RWA Fund License', statRaw: null, date: '2025', status: 'Active' },
  ],
  ecosystem: {
    users: '600K+',
    portfolioManagers: '150+',
    tokenizedPipeline: '$3B+',
    licenses: ['FSCA (South Africa)', 'DIFC Dubai (RWA Funds)', 'MiCAR (White Paper)'],
    shariahCertified: true,
    shariahDate: 'December 2025',
  },
  rwaContext: [
    { label: 'Global RWA Market (2025)', value: '$25B+' },
    { label: 'RWA Projection (2033)', value: '$18T' },
    { label: 'Global AUM (TradFi)', value: '$128T' },
    { label: 'USDC to ZIGChain', value: '$78B+' },
    { label: 'ZIGChain DIFC License', value: 'First in MENA' },
  ],
  assetClasses: [
    { name: 'Tokenized Stocks & ETFs', via: 'Ondo Finance', desc: 'Global equities on-chain (EMEA + South Asia)' },
    { name: 'Real Estate', via: 'PermaPod', desc: 'Collateralized property assets on-chain' },
    { name: 'Private Credit', via: 'PermaPod', desc: 'Institutional credit facilities' },
    { name: 'Sports & Entertainment IP', via: 'SEGG / Sports.com', desc: 'Athlete IP · Fan stakes' },
    { name: 'Shariah-Compliant Assets', via: 'Zamanat · Nawa', desc: 'Islamic finance layer' },
  ],
  exchanges: [
    { name: 'Bybit', pair: 'ZIG/USDT', note: 'Primary' },
    { name: 'KuCoin', pair: 'ZIG/USDT', note: '20x Futures' },
    { name: 'MEXC', pair: 'ZIG/USDT', note: null },
    { name: 'Gate.io', pair: 'ZIG/USDT', note: null },
    { name: 'Kraken', pair: 'ZIG/USD', note: null },
  ],
  security: [
    { name: 'zeroShadow', role: 'Real-time Threat Detection', status: 'Active' },
    { name: 'Range', role: 'Validator Health Monitoring', status: 'Active' },
    { name: 'IBC Rate Limits', role: 'Network Protection', status: 'Active' },
  ],
  // X handles confirmed from Abdul's recent posts (@brbordallo, @ahm3dzig);
  // David is not active on X, so we point to his LinkedIn avatar via
  // unavatar.io. Abdul gets the staged portrait directly.
  team: [
    { name: 'Bartolome R. Bordallo', role: 'Co-Founder & CEO', bg: 'Ex-Fujitsu · Founded Zignaly 2018', twitter: 'brbordallo', avatar: '/founders/bartolome-bordallo.jpg' },
    { name: 'Abdul Rafay Gadit', role: 'Co-Founder · Master of Coin $ZIG', bg: 'Ex-Standard Chartered · IBA Karachi', twitter: 'ARafayGadit', avatar: '/founders/abdul-rafay.png' },
    { name: 'David Rodriguez Coronado', role: 'Co-Founder & CMO', bg: 'Growth strategist · Ex-Tractionboard', twitter: null, linkedin: 'davidrodriguezcoronado', avatar: 'https://unavatar.io/linkedin/davidrodriguezcoronado' },
    { name: 'Ahmed A. Shafi', role: 'Chief Strategy Officer', bg: 'Strategy & ecosystem expansion · Singapore', twitter: 'ahm3dzig', avatar: '/founders/ahmed-shafi.jpg' },
  ],
  funding: {
    total: '$53M+',
    rounds: [
      { round: 'Series A', amount: '$3M', lead: 'OKX Ventures', date: 'Mar 2021' },
      { round: 'Financing', amount: '$50M', lead: 'GEM Global', date: 'Mar 2022' },
    ],
    ecosystemFund: '$100M',
    defiAIFund: '$25M',
    investors: ['GEM Global ($3.4B AUM)', 'DWF Labs', 'OKX Ventures', 'Ryze Labs', 'DAO Maker', 'AU21 Capital', 'Disrupt'],
  },
  comparison: [
    { name: 'ZIGChain', symbol: 'ZIG', mcap: '$53M', tvl: '$14M', chains: '1 (+ 16 USDC)', diff: 'Shariah-certified L1', partnerships: 'Apex $3.4T · SEGG $300M', license: 'FSCA · DIFC', highlight: true },
    { name: 'Ondo Finance', symbol: 'ONDO', mcap: '$1.26B', tvl: '$2.8B', chains: 'Multi-chain', diff: 'Tokenized US Treasuries', partnerships: 'BlackRock · Morgan Stanley', license: '—' },
    { name: 'Centrifuge', symbol: 'CFG', mcap: '$133M', tvl: '$1.35B', chains: '8 networks', diff: 'Institutional fund tokenization', partnerships: 'Janus Henderson · Aave', license: '—' },
    { name: 'Maple Finance', symbol: 'SYRUP', mcap: '$307M', tvl: '$2.5B', chains: 'Ethereum', diff: 'Institutional crypto lending', partnerships: 'Institutional borrowers', license: '—' },
    { name: 'Polymesh', symbol: 'POLYX', mcap: '$50M', tvl: '—', chains: '1 (purpose-built)', diff: 'Regulated securities L1', partnerships: 'BitGo · tZERO · Republic', license: 'Built-in KYC' },
    { name: 'MANTRA', symbol: 'OM', mcap: '$66M', tvl: '—', chains: '1 (EVM)', diff: 'RWA L1 with VARA license', partnerships: 'DAMAC $1B (pre-crash)', license: 'VARA Dubai' },
  ],
  // Evergreen fallback only — shown when the live @ZIGChain feed is empty. The
  // banner tags this "FEATURED" (never "BREAKING") so a dated card can't read as
  // fresh news. Keep the eyebrow undated for the same reason.
  breakingNews: {
    eyebrow: 'Featured integration',
    headline: 'ZIGChain integrates Ondo Finance tokenized stocks & ETFs',
    summary: "Ondo's tokenized stocks and ETFs are integrating with ZIGChain, expanding access to global equities and real-world financial products across emerging markets — EMEA, South Asia, and the broader ZIGChain ecosystem.",
    metrics: [
      { label: 'Ondo TVL', value: '$2.8B' },
      { label: 'Ondo Mcap', value: '$1.26B' },
      { label: 'Reach', value: 'EMEA · S. Asia' },
    ],
    source: 'ZIGChain · Ondo Finance',
    sourceUrl: 'https://x.com/ZIGChain/status/2063986887367524780',
    ondoUrl: 'https://x.com/OndoFinance',
  },
  intelligenceFeed: [
    { headline: 'ZIGChain × Fasset — Halal RWA Distribution', summary: 'Fasset, a regulated Shariah-compliant digital-asset platform ($6B+ annual volume across 125 countries), partners with ZIGChain to bring tokenized real-world assets and halal equities to a global Muslim user base.', date: '2026', tags: ['Partnership', 'RWA', 'Shariah'], source: 'ZIGChain · Fasset', url: 'https://x.com/ZIGChain', recent: true },
    { headline: 'ZIGChain × Beehive — Tokenized SME Private Credit', summary: 'Beehive, a DFSA-regulated SME funding platform, partners with ZIGChain to explore tokenizing private credit in the UAE — bringing regulated SME financing on-chain.', date: '2026', tags: ['Partnership', 'RWA', 'Private Credit'], source: 'ZIGChain · Beehive', url: 'https://x.com/ZIGChain', recent: true },
    { headline: 'Taurus Integration Live — Institutional Custody for $ZIG', summary: 'Taurus, the FINMA-regulated Swiss custodian backed by Deutsche Bank and Credit Suisse, adds native $ZIG support to its Taurus-PROTECT platform — the first bank-grade European custodian to natively support a Shariah-compliant chain.', date: 'Apr 2026', tags: ['Custody', 'Institutional'], source: 'ZIGChain Official', url: 'https://x.com/ZIGChain', recent: true },
    { headline: 'Ondo Finance × ZIGChain — Tokenized Stocks & ETFs Go Live', summary: "Ondo's tokenized stocks and ETFs are integrating with ZIGChain, expanding access to the world's most in-demand assets across EMEA and South Asia. Ondo brings $2.8B TVL and the institutional-grade tokenization stack pioneered with BlackRock and Morgan Stanley.", date: 'Jun 8, 2026', tags: ['Partnership', 'Stocks', 'ETFs', 'RWA'], source: 'ZIGChain · Ondo Finance', url: 'https://x.com/ZIGChain', recent: true },
    { headline: 'Zoniqx × ZIGChain — Regulated Tokenized Markets', summary: "Zoniqx's institutional tokenization platform integrates with ZIGChain, enabling banks and asset managers to issue regulated tokenized assets with automated compliance. Unveiled at Abu Dhabi Finance Week.", date: 'Dec 2025', tags: ['Partnership', 'Tokenization', 'Compliance'], source: 'ZIGChain · Zoniqx', url: 'https://x.com/ZIGChain' },
    { headline: 'ZIGChain Summit Dubai 2026 — RWA Capital Keynote', summary: 'Three days of programming at the Museum of the Future on regulated tokenization, halal yield, and the $18T RWA on-ramp. Bordallo + Gadit headline; Apex, Tokeny, BlackRock attend.', date: 'May 6, 2026', tags: ['Event', 'Dubai'], source: 'ZIGChain Official', url: 'https://zigchain.com/events/dubai-2026', recent: true },
    { headline: 'ZIG Markets goes live at Dubai Summit', summary: 'New market-distribution layer announced on stage. Builders flipped the launch order — distribution-first, infra-last. Live access opens to Apex-administered funds in Q3 2026.', date: 'May 7, 2026', tags: ['Product', 'Markets'], source: 'Medium', url: 'https://medium.com/zignaly', recent: true },
    { headline: 'Tokeny x ZIGChain — ERC-3643 Securities Pipeline Active', summary: 'First on-chain regulated securities issuance via Apex completed during Summit week. $310M of tokenized credit going live across two funds.', date: 'May 5, 2026', tags: ['RWA', 'Compliance'], source: 'ZIGChain Official', url: 'https://docs.zigchain.com', recent: true },
    { headline: '$78B in USDC Now Accessible Across ZIGChain', summary: 'Cross-chain USDC integration from 16+ blockchains expands ecosystem liquidity.', date: 'Mar 13, 2026', tags: ['DeFi', 'Infrastructure'], source: 'ZIGChain Official', url: 'https://docs.zigchain.com' },
    { headline: 'ZIGLabs $100M Ecosystem Fund Deploying in 2026', summary: 'Growth capital targeting developer onboarding and dApp deployment.', date: 'Jan 2026', tags: ['Ecosystem'], source: 'ZIGChain Official', url: 'https://zigchain.com' },
    { headline: 'KuCoin Lists ZIG Futures with 20x Leverage', summary: 'Enhanced trading access as ZIG futures open to institutional participants.', date: 'Dec 22, 2025', tags: ['Exchange', 'Futures'], source: 'KuCoin', url: 'https://www.kucoin.com' },
    { headline: 'ZIGChain Earns Shariah Certification', summary: 'First Layer 1 to achieve protocol-level Shariah compliance.', date: 'Dec 2025', tags: ['Compliance', 'RWA'], source: 'ZIGChain Official', url: 'https://zigchain.com' },
    { headline: 'SEGG Media Allocates 80% of $300M Treasury to ZIG', summary: 'Nasdaq-listed SEGG begins Phase 2 tokenization of athlete IP and fan stakes.', date: 'Nov 1, 2025', tags: ['Institutional', 'RWA'], source: 'Medium', url: 'https://medium.com/zignaly' },
    { headline: 'Apex Group & ZIGChain Forge $3.4T Alliance', summary: 'First regulated on-chain fund ecosystem for RWA tokenization launches in Dubai.', date: 'Jul 25, 2025', tags: ['Partnership', 'RWA'], source: 'ZIGChain Official', url: 'https://zigchain.com' },
  ],
}
