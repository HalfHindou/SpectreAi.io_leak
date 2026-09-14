/**
 * SectorRotationMap - "The Rotation Desk"
 * Fidelity sector rotation meets DeFi narrative cycles.
 * Shows which narratives are in which market phase:
 *   Accumulation -> Markup -> Distribution -> Markdown
 *
 * Glass card design with phase-colored accents,
 * animated flow bars, and cinematic blur-in entrance.
 */
import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { SECTORS, SECTOR_ICON_PATHS, TOKENS_BY_SECTOR } from '../data/narrativeConfig'
import { getTokenLogo } from '../data/alphaFeedData'
import InfoTip from './InfoTip'
import './SectorRotationMap.css'

const PHASE_TIPS = {
  'Accumulation': 'Smart money is quietly buying. Prices are flat or slightly rising.',
  'Markup': 'Prices are trending up. Public interest is growing.',
  'Distribution': 'Smart money is selling into strength. Prices may be peaking.',
  'Markdown': 'Prices are declining. Weak holders are selling.',
}

const COL_TIPS = {
  'Phase': 'Current stage in the market cycle for this sector.',
  'Capital Flow': 'Net direction of money moving in or out of this sector.',
  'Volume': 'Total 7-day trading volume across all tokens in the sector.',
  'Momentum': 'Trend strength score from 0-100 for the sector.',
  'Signal': 'AI-generated intelligence note on sector positioning.',
}

/* ── Market cycle phases ── */
const PHASES = [
  { id: 'accumulation', label: 'Accumulation', color: '#10B981', desc: 'Smart money buying quietly' },
  { id: 'markup', label: 'Markup', color: '#34D399', desc: 'Trend confirmed, momentum building' },
  { id: 'distribution', label: 'Distribution', color: '#FBBF24', desc: 'Early sellers, retail entering' },
  { id: 'markdown', label: 'Markdown', color: '#EF4444', desc: 'Trend reversing, risk-off' },
]

/* ── Column headers ── */
const COLUMNS = [
  { label: 'Sector', desc: 'Narrative' },
  { label: 'Phase', desc: 'Cycle stage' },
  { label: 'Capital Flow', desc: 'Net rotation' },
  { label: 'Volume', desc: '7d net' },
  { label: 'Momentum', desc: 'Strength' },
  { label: 'Signal', desc: 'Intelligence' },
]

/* ── Sector rotation data (static fallback when dynamic `sectors` prop is empty) ── */
const ROTATION_DATA = [
  {
    sectorId: 'ai',
    phase: 'markup',
    flowDirection: 'inflow',
    flowPct: 18.4,
    weeklyChange: 12.3,
    capitalFlow: '+$142M',
    momentum: 82,
    conviction: 'High',
    topMover: 'TAO +24%',
    signal: 'Subnet expansion driving narrative. VC wallets accumulating heavily.',
    extended: {
      sectorTvl: '$4.8B',
      volume7d: '$2.1B',
      dominance: '3.2%',
      activeProjects: 48,
      insight: 'AI/compute is the highest-beta narrative this cycle. Subnet architecture on Bittensor creating real utility moats. Institutional allocation shifting from pure infrastructure to application-layer AI tokens.',
      keyTokens: [
        { symbol: 'TAO', change: '+24%', role: 'Decentralized AI compute marketplace', socials: { website: 'https://bittensor.com', x: 'https://x.com/opentensor', discord: 'https://discord.gg/bittensor' } },
        { symbol: 'FET', change: '+18%', role: 'Autonomous agents framework', socials: { website: 'https://fetch.ai', x: 'https://x.com/Fetch_ai', telegram: 'https://telegram.me/fetch_ai' } },
        { symbol: 'RNDR', change: '+12%', role: 'GPU rendering network', socials: { website: 'https://rendernetwork.com', x: 'https://x.com/rendernetwork', discord: 'https://discord.gg/rendernetwork' } },
        { symbol: 'AKT', change: '+9%', role: 'Decentralized cloud compute', socials: { website: 'https://akash.network', x: 'https://x.com/akaborrowashnet_', discord: 'https://discord.gg/akash' } },
      ],
      catalysts: [
        'OpenAI enterprise partnerships creating demand for decentralized alternatives',
        'Bittensor dTAO upgrade enabling subnet-level token economics',
        'NVIDIA earnings beat reinforcing AI infrastructure investment thesis',
      ],
      risks: [
        'AI narrative is cyclical - highly correlated to NVIDIA stock sentiment',
        'Most AI tokens lack real revenue - valuation driven by speculation',
        'Regulatory uncertainty around AI model training and data ownership',
      ],
    },
  },
  {
    sectorId: 'rwa',
    phase: 'accumulation',
    flowDirection: 'inflow',
    flowPct: 14.2,
    weeklyChange: 8.7,
    capitalFlow: '+$89M',
    momentum: 68,
    conviction: 'High',
    topMover: 'ONDO +15%',
    signal: 'BlackRock tokenization thesis gaining institutional traction.',
    extended: {
      sectorTvl: '$8.2B',
      volume7d: '$620M',
      dominance: '1.8%',
      activeProjects: 32,
      insight: 'RWA tokenization is the strongest institutional narrative. BlackRock BUIDL fund crossed $500M AUM, validating on-chain treasury products. Early accumulation phase - smart money positioning before regulatory clarity.',
      keyTokens: [
        { symbol: 'ONDO', change: '+15%', role: 'Tokenized US treasuries and money markets', socials: { website: 'https://ondo.finance', x: 'https://x.com/OndoFinance', discord: 'https://discord.gg/ondofinance' } },
        { symbol: 'CFG', change: '+8%', role: 'Real-world credit on-chain', socials: { website: 'https://centrifuge.io', x: 'https://x.com/centrifuge', discord: 'https://discord.gg/centrifuge' } },
        { symbol: 'TRU', change: '+6%', role: 'Institutional lending protocol', socials: { website: 'https://truefi.io', x: 'https://x.com/TrueFiDAO', discord: 'https://discord.gg/truefi' } },
        { symbol: 'RIO', change: '+4%', role: 'Real estate tokenization', socials: { website: 'https://realio.network', x: 'https://x.com/realaborrowio_network', telegram: 'https://telegram.me/realionetwork' } },
      ],
      catalysts: [
        'SEC tokenized securities framework expected H2 2026',
        'BlackRock BUIDL expanding to Solana and Arbitrum',
        'Traditional money market funds exploring on-chain distribution',
      ],
      risks: [
        'Regulatory timeline uncertainty - framework delays could stall momentum',
        'Yield compression if rate cuts reduce treasury product attractiveness',
        'Liquidity fragmentation across multiple RWA platforms',
      ],
    },
  },
  {
    sectorId: 'defi',
    phase: 'markup',
    flowDirection: 'inflow',
    flowPct: 11.8,
    weeklyChange: 6.4,
    capitalFlow: '+$234M',
    momentum: 74,
    conviction: 'Medium',
    topMover: 'AAVE +9%',
    signal: 'Fee switch narratives and restaking yield driving renewed interest.',
    extended: {
      sectorTvl: '$92B',
      volume7d: '$18.4B',
      dominance: '12.6%',
      activeProjects: 280,
      insight: 'DeFi renaissance driven by fee switch activations and real yield narratives. Aave and Uniswap governance proposals redirecting protocol revenue to token holders. Restaking via EigenLayer creating new yield layers.',
      keyTokens: [
        { symbol: 'AAVE', change: '+9%', role: 'Lending protocol with fee switch catalyst', socials: { website: 'https://aave.com', x: 'https://x.com/aave', discord: 'https://discord.gg/aave' } },
        { symbol: 'UNI', change: '+7%', role: 'DEX governance with fee proposal', socials: { website: 'https://uniswap.org', x: 'https://x.com/Uniswap', discord: 'https://discord.gg/uniswap' } },
        { symbol: 'MKR', change: '+5%', role: 'Stablecoin and RWA lending', socials: { website: 'https://makerdao.com', x: 'https://x.com/MakerDAO', discord: 'https://discord.gg/makerdao' } },
        { symbol: 'LDO', change: '+4%', role: 'Liquid staking dominant protocol', socials: { website: 'https://lido.fi', x: 'https://x.com/LidoFinance', discord: 'https://discord.gg/lido' } },
      ],
      catalysts: [
        'Aave fee switch vote passing - first major DeFi revenue share',
        'Uniswap v4 hooks enabling custom AMM strategies',
        'EigenLayer restaking mainnet driving TVL growth across DeFi',
      ],
      risks: [
        'Smart contract risk remains systemic across the sector',
        'Regulatory crackdown on DeFi lending and stablecoin issuance',
        'Fee switch revenue may disappoint vs token holder expectations',
      ],
    },
  },
  {
    sectorId: 'infra',
    phase: 'distribution',
    flowDirection: 'outflow',
    flowPct: -5.2,
    weeklyChange: -2.1,
    capitalFlow: '-$67M',
    momentum: 45,
    conviction: 'Low',
    topMover: 'SOL +4%',
    signal: 'Profits rotating from L1 trades into higher-beta sectors.',
    extended: {
      sectorTvl: '$180B',
      volume7d: '$42B',
      dominance: '48.2%',
      activeProjects: 120,
      insight: 'Infrastructure is the largest sector by market cap but showing distribution signals. Early investors and VCs taking profits after strong 2025 run. Capital rotating into higher-beta application-layer plays. SOL holding relative strength on Firedancer narrative.',
      keyTokens: [
        { symbol: 'SOL', change: '+4%', role: 'High-throughput consumer chain', socials: { website: 'https://solana.com', x: 'https://x.com/solana', discord: 'https://discord.gg/solana' } },
        { symbol: 'AVAX', change: '-2%', role: 'Subnet architecture for institutions', socials: { website: 'https://avax.network', x: 'https://x.com/avaborrowax', telegram: 'https://telegram.me/avalancheavax' } },
        { symbol: 'NEAR', change: '-3%', role: 'Chain abstraction and AI integration', socials: { website: 'https://near.org', x: 'https://x.com/NEARProtocol', discord: 'https://discord.gg/near' } },
        { symbol: 'APT', change: '-5%', role: 'Move-based L1 with institutional focus', socials: { website: 'https://aptoslabs.com', x: 'https://x.com/Aptos', discord: 'https://discord.gg/aptos' } },
      ],
      catalysts: [
        'Firedancer client launch could re-accelerate SOL narrative',
        'Institutional custody solutions maturing for alt-L1s',
        'Cross-chain interoperability standards reducing fragmentation',
      ],
      risks: [
        'L1 thesis becoming commoditized - hard to differentiate',
        'Token unlock schedules creating persistent sell pressure',
        'Capital rotation to application layer may persist through Q2',
      ],
    },
  },
  {
    sectorId: 'memes',
    phase: 'distribution',
    flowDirection: 'outflow',
    flowPct: -8.6,
    weeklyChange: -11.3,
    capitalFlow: '-$320M',
    momentum: 32,
    conviction: 'Low',
    topMover: 'PEPE -14%',
    signal: 'Retail exhaustion. Smart money exited 2 weeks ago.',
    extended: {
      sectorTvl: '$1.2B',
      volume7d: '$8.6B',
      dominance: '4.1%',
      activeProjects: 500,
      insight: 'Meme sector entering distribution after a parabolic Q4 2025 run. Smart money wallets reduced exposure 2 weeks before retail. Volume declining 40% week-over-week. Historical pattern suggests 60-80% drawdown before next accumulation phase.',
      keyTokens: [
        { symbol: 'PEPE', change: '-14%', role: 'Largest Ethereum meme by market cap', socials: { website: 'https://pepecoin.io', x: 'https://x.com/pepecoineth', telegram: 'https://telegram.me/pepecoineth' } },
        { symbol: 'WIF', change: '-18%', role: 'Solana meme ecosystem leader', socials: { website: 'https://dogwifcoin.org', x: 'https://x.com/dogwifcoin', telegram: 'https://telegram.me/dogwifcoin' } },
        { symbol: 'BONK', change: '-12%', role: 'Solana community meme token', socials: { website: 'https://bonkcoin.com', x: 'https://x.com/bonk_inu', discord: 'https://discord.gg/bonk' } },
        { symbol: 'DOGE', change: '-6%', role: 'Original memecoin, payment utility', socials: { website: 'https://dogecoin.com', x: 'https://x.com/dogecoin' } },
      ],
      catalysts: [
        'New meme launchpad platforms could reignite rotation',
        'Celebrity or cultural moment viral catalyst (unpredictable)',
        'Solana meme infrastructure improvements reducing rug risk',
      ],
      risks: [
        'Retail exhaustion - volume declining rapidly across meme pairs',
        'High concentration risk - whale dumps can cascade -50% in hours',
        'No fundamental value floor - drawdowns can exceed 90%',
      ],
    },
  },
  {
    sectorId: 'gaming',
    phase: 'accumulation',
    flowDirection: 'inflow',
    flowPct: 6.3,
    weeklyChange: 4.1,
    capitalFlow: '+$28M',
    momentum: 55,
    conviction: 'Medium',
    topMover: 'IMX +11%',
    signal: 'Early accumulation phase. New game launches catalyzing interest.',
    extended: {
      sectorTvl: '$2.4B',
      volume7d: '$1.1B',
      dominance: '1.4%',
      activeProjects: 85,
      insight: 'Web3 gaming entering early accumulation after 18 months of building. IMX and Ronin showing real player traction. Game launches in Q1-Q2 2026 could trigger markup phase. Smart money positioning in infrastructure plays.',
      keyTokens: [
        { symbol: 'IMX', change: '+11%', role: 'Gaming-focused L2 on Ethereum', socials: { website: 'https://immutable.com', x: 'https://x.com/Immutable', discord: 'https://discord.gg/immutable' } },
        { symbol: 'RON', change: '+8%', role: 'Ronin chain - Axie ecosystem', socials: { website: 'https://roninchain.com', x: 'https://x.com/Ronin_Network', discord: 'https://discord.gg/roninnetwork' } },
        { symbol: 'GALA', change: '+5%', role: 'Web3 gaming and entertainment', socials: { website: 'https://gala.com', x: 'https://x.com/GoGalaGames', discord: 'https://discord.gg/gala' } },
        { symbol: 'PIXEL', change: '+14%', role: 'Farm-to-earn on Ronin chain', socials: { website: 'https://pixels.xyz', x: 'https://x.com/pixels_online', discord: 'https://discord.gg/pixels' } },
      ],
      catalysts: [
        'Major AAA game launches scheduled Q1-Q2 2026',
        'IMX zk-rollup upgrades reducing gas costs for in-game assets',
        'Epic Games Store integration with blockchain game titles',
      ],
      risks: [
        'Gaming token valuations historically disconnect from player metrics',
        'User retention remains a challenge for most web3 games',
        'Macro risk - gaming tokens are high-beta discretionary assets',
      ],
    },
  },
  {
    sectorId: 'layer2',
    phase: 'markdown',
    flowDirection: 'outflow',
    flowPct: -12.4,
    weeklyChange: -8.9,
    capitalFlow: '-$180M',
    momentum: 22,
    conviction: 'Low',
    topMover: 'ARB -7%',
    signal: 'L2 thesis overcrowded. Capital rotating to app-layer plays.',
    extended: {
      sectorTvl: '$32B',
      volume7d: '$6.8B',
      dominance: '5.8%',
      activeProjects: 45,
      insight: 'Layer 2 sector in markdown phase as the "L2 summer" thesis has become overcrowded. Too many rollups competing for limited demand. Token unlocks from Arbitrum, Optimism, and Starknet creating persistent sell pressure. Consolidation likely before next cycle.',
      keyTokens: [
        { symbol: 'ARB', change: '-7%', role: 'Leading Ethereum optimistic rollup', socials: { website: 'https://arbitrum.io', x: 'https://x.com/arbitrum', discord: 'https://discord.gg/arbitrum' } },
        { symbol: 'OP', change: '-5%', role: 'Optimism Superchain ecosystem', socials: { website: 'https://optimism.io', x: 'https://x.com/Optimism', discord: 'https://discord.gg/optimism' } },
        { symbol: 'STRK', change: '-9%', role: 'Starknet zk-rollup', socials: { website: 'https://starknet.io', x: 'https://x.com/Starknet', discord: 'https://discord.gg/starknet' } },
        { symbol: 'MNT', change: '-3%', role: 'Mantle L2 with treasury backing', socials: { website: 'https://mantle.xyz', x: 'https://x.com/0xMantle', discord: 'https://discord.gg/mantle' } },
      ],
      catalysts: [
        'EIP-4844 blob space expansion reducing L2 costs further',
        'Superchain interoperability creating network effects for OP stack',
        'Based rollups narrative gaining traction as L2 differentiator',
      ],
      risks: [
        'Massive token unlocks through 2026 across ARB, OP, STRK',
        'L2 proliferation diluting value - over 50 rollups competing',
        'Revenue per L2 declining as blob space becomes abundant',
      ],
    },
  },
  {
    sectorId: 'nft',
    phase: 'accumulation',
    flowDirection: 'inflow',
    flowPct: 3.2,
    weeklyChange: 2.8,
    capitalFlow: '+$12M',
    momentum: 41,
    conviction: 'Low',
    topMover: 'BLUR +6%',
    signal: 'Bottom forming. Contrarian smart money starting to nibble.',
    extended: {
      sectorTvl: '$680M',
      volume7d: '$320M',
      dominance: '0.6%',
      activeProjects: 35,
      insight: 'NFT sector at cycle lows with most collections down 80-95% from peaks. Contrarian smart money wallets beginning to accumulate blue-chip collections. Blur marketplace dominance creating a floor for infrastructure tokens. Recovery likely tied to broader crypto market cycle.',
      keyTokens: [
        { symbol: 'BLUR', change: '+6%', role: 'NFT marketplace with trader incentives', socials: { website: 'https://blur.io', x: 'https://x.com/blur_io', discord: 'https://discord.gg/blurdao' } },
        { symbol: 'APE', change: '+3%', role: 'Bored Ape ecosystem and ApeCoin DAO', socials: { website: 'https://apecoin.com', x: 'https://x.com/apecoin', discord: 'https://discord.gg/apecoin' } },
        { symbol: 'LOOKS', change: '+2%', role: 'Community-owned NFT marketplace', socials: { website: 'https://looksrare.org', x: 'https://x.com/LooksRare', discord: 'https://discord.gg/looksrare' } },
        { symbol: 'MAGIC', change: '+5%', role: 'Treasure ecosystem gaming NFTs', socials: { website: 'https://treasure.lol', x: 'https://x.com/Treasure_DAO', discord: 'https://discord.gg/treasuredao' } },
      ],
      catalysts: [
        'Blur Season 3 airdrop and marketplace feature expansion',
        'Yuga Labs new IP launches reviving blue-chip NFT demand',
        'NFT financialization - lending, fractionalization, derivatives',
      ],
      risks: [
        'NFT market volumes remain 95% below 2022 peaks',
        'Wash trading inflating metrics on incentivized marketplaces',
        'Cultural relevance of PFP collections continues to decline',
      ],
    },
  },
]

/* ── Token navigation data (address + networkId for token page) ── */
const TOKEN_NAV_DATA = {
  // AI
  FET:   { address: '0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85', networkId: 1, name: 'Fetch.ai' },
  RNDR:  { address: '0x6De037ef9aD2725EB40118Bb1702EBb27e4Aeb24', networkId: 1, name: 'Render' },
  // RWA
  ONDO:  { address: '0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3', networkId: 1, name: 'Ondo Finance' },
  // DeFi
  AAVE:  { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', networkId: 1, name: 'Aave' },
  UNI:   { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', networkId: 1, name: 'Uniswap' },
  MKR:   { address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', networkId: 1, name: 'Maker' },
  LDO:   { address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', networkId: 1, name: 'Lido DAO' },
  // Infra
  AVAX:  { address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', networkId: 43114, name: 'Avalanche' },
  // Memes
  PEPE:  { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', networkId: 1, name: 'Pepe' },
  WIF:   { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', networkId: 1399811149, name: 'dogwifhat' },
  BONK:  { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', networkId: 1399811149, name: 'Bonk' },
  // Gaming
  IMX:   { address: '0xF57e7e7C23978C3cAEC3C3548E3D615c346e79fF', networkId: 1, name: 'Immutable' },
  GALA:  { address: '0xd1d2Eb1B1e90B638588728b4130137D262C87cae', networkId: 1, name: 'Gala' },
  MAGIC: { address: '0x539bdE0d7Dbd336b79148AA742883198BBF60342', networkId: 42161, name: 'Magic' },
  // Layer 2
  ARB:   { address: '0x912CE59144191C1D966210CbfFdCA8A9322dA97c', networkId: 42161, name: 'Arbitrum' },
  OP:    { address: '0x4200000000000000000000000000000000000042', networkId: 10, name: 'Optimism' },
  // NFT
  BLUR:  { address: '0x5283D291DBCF85356A21bA090E6db59121208b44', networkId: 1, name: 'Blur' },
  APE:   { address: '0x4d224452801ACEd8B2F0aebE155379bb5D594381', networkId: 1, name: 'ApeCoin' },
}

/* ── Social icon SVG paths ── */
const SOCIAL_ICONS = {
  website: { viewBox: '0 0 24 24', fill: false, paths: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M12 3a15.3 15.3 0 014 9 15.3 15.3 0 01-4 9 15.3 15.3 0 01-4-9 15.3 15.3 0 014-9z'] },
  x: { viewBox: '0 0 24 24', fill: true, paths: ['M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'] },
  discord: { viewBox: '0 0 24 24', fill: true, paths: ['M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z'] },
  telegram: { viewBox: '0 0 24 24', fill: true, paths: ['M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z'] },
}

/* ── Sector social links ── */
const SECTOR_SOCIALS = {
  ai: { website: 'https://bittensor.com', x: 'https://x.com/opentensor', discord: 'https://discord.gg/bittensor' },
  rwa: { website: 'https://ondo.finance', x: 'https://x.com/OndoFinance', telegram: 'https://telegram.me/OndoFinance' },
  defi: { website: 'https://defillama.com', x: 'https://x.com/DefiLlama', discord: 'https://discord.gg/defillama' },
  infra: { website: 'https://solana.com', x: 'https://x.com/solana', discord: 'https://discord.gg/solana' },
  memes: { website: 'https://www.coingecko.com/en/categories/meme-token', x: 'https://x.com/coaborrowgecko' },
  gaming: { website: 'https://www.immutable.com', x: 'https://x.com/Immutable', discord: 'https://discord.gg/immutable' },
  layer2: { website: 'https://l2beat.com', x: 'https://x.com/l2aborrowbeat', discord: 'https://discord.gg/l2beat' },
  nft: { website: 'https://blur.io', x: 'https://x.com/blur_io', discord: 'https://discord.gg/blurdao' },
}

function SectorRotationMap({ sectors, selectToken }) {
  const [selectedPhase, setSelectedPhase] = useState(null)
  const [visibleRows, setVisibleRows] = useState(new Set())
  const [selectedSector, setSelectedSector] = useState(null)
  const rowRefs = useRef({})

  // Use dynamic `sectors` when populated; otherwise fall back to the static dataset.
  const rotationData = Array.isArray(sectors) && sectors.length > 0 ? sectors : ROTATION_DATA

  // Escape key closes detail popup + body scroll lock
  useEffect(() => {
    if (!selectedSector) return
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    document.body.style.paddingRight = `${scrollbarW}px`
    const onKey = (e) => { if (e.key === 'Escape') setSelectedSector(null) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      document.body.style.paddingRight = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [selectedSector])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setVisibleRows(prev => new Set([...prev, entry.target.dataset.sector]))
          }
        })
      },
      { threshold: 0.1 }
    )
    Object.values(rowRefs.current).forEach(el => {
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [selectedPhase])

  const filtered = selectedPhase
    ? rotationData.filter(d => d.phase === selectedPhase)
    : [...rotationData].sort((a, b) => (b.flowPct || 0) - (a.flowPct || 0))

  return (
    <div className="srm">
      {/* Phase legend / filter */}
      <div className="srm-phases">
        <button
          className={`srm-phase-btn ${selectedPhase === null ? 'is-active' : ''}`}
          onClick={() => setSelectedPhase(null)}
        >
          All Phases
        </button>
        {PHASES.map(phase => (
          <button
            key={phase.id}
            className={`srm-phase-btn ${selectedPhase === phase.id ? 'is-active' : ''}`}
            onClick={() => setSelectedPhase(selectedPhase === phase.id ? null : phase.id)}
          >
            <span className="srm-phase-dot" style={{ background: phase.color, boxShadow: `0 0 6px ${phase.color}40` }} />
            {phase.label}<InfoTip text={PHASE_TIPS[phase.label]} position="bottom" />
          </button>
        ))}
      </div>

      {/* Column headers */}
      <div className="srm-col-headers">
        {COLUMNS.map((col, i) => (
          <div key={i} className="srm-col-header">
            <span className="srm-col-header-label">{col.label}{COL_TIPS[col.label] && <InfoTip text={COL_TIPS[col.label]} position="bottom" />}</span>
            <span className="srm-col-header-desc">{col.desc}</span>
          </div>
        ))}
      </div>

      {/* Rotation rows */}
      <div className="srm-list">
        {filtered.map((item, i) => {
          const sector = SECTORS.find(s => s.id === item.sectorId)
          const phase = PHASES.find(p => p.id === item.phase)
          const iconPath = SECTOR_ICON_PATHS[item.sectorId]
          const isVisible = visibleRows.has(item.sectorId)
          const flowPct = Number(item.flowPct) || 0
          const momentum = Number(item.momentum) || 0
          const barWidth = Math.min(Math.abs(flowPct) * 4, 100)

          return (
            <div
              key={item.sectorId}
              className={`srm-row ${isVisible ? 'is-visible' : ''}`}
              data-sector={item.sectorId}
              ref={el => rowRefs.current[item.sectorId] = el}
              style={{ transitionDelay: `${i * 60}ms` }}
              onClick={() => setSelectedSector(item)}
            >
              {/* Phase-colored accent edge */}
              <div
                className="srm-row-accent"
                style={{ background: `linear-gradient(90deg, transparent, ${phase?.color || '#fff'}30, transparent)` }}
              />

              {/* Sector identity */}
              <div className="srm-row-sector">
                <div className="srm-row-icon-wrap">
                  <svg className="srm-row-icon" viewBox="0 0 24 24" fill="none" stroke={sector?.color || '#fff'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d={iconPath} />
                  </svg>
                </div>
                <div className="srm-row-sector-info">
                  <span className="srm-row-sector-name">{sector?.name || item.sectorId}</span>
                  <span className="srm-row-top-mover">{item.topMover || ''}</span>
                </div>
              </div>

              {/* Phase badge */}
              <div className="srm-row-phase">
                <span
                  className="srm-row-phase-dot"
                  style={{
                    background: phase?.color,
                    boxShadow: `0 0 6px ${phase?.color}40`,
                  }}
                />
                <span className="srm-row-phase-label">{phase?.label}</span>
              </div>

              {/* Flow bar */}
              <div className="srm-row-flow">
                <div className="srm-flow-bar-container">
                  {flowPct >= 0 ? (
                    <div className="srm-flow-bar-right">
                      <div
                        className="srm-flow-bar srm-flow-bar--bull"
                        style={{
                          width: isVisible ? `${barWidth}%` : '0%',
                          transitionDelay: `${i * 60 + 200}ms`,
                        }}
                      />
                    </div>
                  ) : (
                    <div className="srm-flow-bar-left">
                      <div
                        className="srm-flow-bar srm-flow-bar--bear"
                        style={{
                          width: isVisible ? `${barWidth}%` : '0%',
                          transitionDelay: `${i * 60 + 200}ms`,
                        }}
                      />
                    </div>
                  )}
                </div>
                <span className={`srm-flow-pct ${flowPct >= 0 ? 'is-bull' : 'is-bear'}`}>
                  {flowPct >= 0 ? '+' : ''}{flowPct}%
                </span>
              </div>

              {/* Capital flow */}
              <span className={`srm-row-capital ${item.flowDirection === 'inflow' ? 'is-bull' : 'is-bear'}`}>
                {item.capitalFlow || '-'}
              </span>

              {/* Momentum gauge */}
              <div className="srm-row-momentum">
                <div className="srm-momentum-track">
                  <div
                    className="srm-momentum-fill"
                    style={{
                      width: isVisible ? `${momentum}%` : '0%',
                      background: `linear-gradient(90deg, ${momentum > 60 ? '#10B98150' : momentum > 40 ? '#FBBF2450' : '#EF444450'}, ${momentum > 60 ? '#10B981' : momentum > 40 ? '#FBBF24' : '#EF4444'})`,
                      boxShadow: isVisible ? `0 0 6px ${momentum > 60 ? '#10B98120' : momentum > 40 ? '#FBBF2420' : '#EF444420'}` : 'none',
                      transitionDelay: `${i * 60 + 300}ms`,
                    }}
                  />
                </div>
                <span className="srm-momentum-value">{momentum}</span>
              </div>

              {/* Signal text */}
              <div className="srm-row-signal">
                <svg className="srm-row-signal-icon" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <p className="srm-row-signal-text">{item.signal || ''}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Detail Popup ── */}
      {selectedSector && createPortal((() => {
        const item = selectedSector
        const ext = item.extended || {}
        const sector = SECTORS.find(s => s.id === item.sectorId)
        const phase = PHASES.find(p => p.id === item.phase)
        const iconPath = SECTOR_ICON_PATHS[item.sectorId]
        const flowPct = Number(item.flowPct) || 0
        const momentum = Number(item.momentum) || 0
        const isBull = flowPct >= 0
        const barWidth = Math.min(Math.abs(flowPct) * 4, 100)

        return (
          <div className="srm-detail-overlay" onClick={() => setSelectedSector(null)}>
            <div className="srm-detail" onClick={e => e.stopPropagation()}>
              {/* Top accent edge */}
              <div
                className="srm-detail-accent"
                style={{ background: `linear-gradient(90deg, transparent, ${phase?.color || '#fff'}40, transparent)` }}
              />
              <div className="srm-detail-edge-hl" />

              {/* Close button */}
              <button className="srm-detail-close" onClick={() => setSelectedSector(null)}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>

              {/* Header */}
              <div className="srm-detail-header">
                <div className="srm-detail-icon-wrap" style={{ borderColor: `${sector?.color || '#fff'}20` }}>
                  <svg className="srm-detail-icon" viewBox="0 0 24 24" fill="none" stroke={sector?.color || '#fff'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d={iconPath} />
                  </svg>
                </div>
                <div className="srm-detail-identity">
                  <div className="srm-detail-name-row">
                    <span className="srm-detail-name">{sector?.name || item.sectorId}</span>
                    <span className="srm-detail-phase-badge" style={{ color: phase?.color, background: `${phase?.color}15`, borderColor: `${phase?.color}20` }}>
                      <span className="srm-detail-phase-dot" style={{ background: phase?.color, boxShadow: `0 0 6px ${phase?.color}40` }} />
                      {phase?.label}
                    </span>
                  </div>
                  <div className="srm-detail-meta">
                    <span className={`srm-detail-flow ${isBull ? 'is-bull' : 'is-bear'}`}>
                      {item.capitalFlow || '-'}
                    </span>
                    {item.conviction && (
                      <span className="srm-detail-conviction" data-level={String(item.conviction).toLowerCase()}>
                        {item.conviction} Conviction
                      </span>
                    )}
                    {item.topMover && <span className="srm-detail-top-mover">{item.topMover}</span>}
                  </div>
                </div>
              </div>

              {/* Separator */}
              <div className="srm-detail-sep" />

              {/* Metrics row */}
              <div className="srm-detail-metrics">
                <div className="srm-detail-metric">
                  <span className="srm-detail-metric-label">Sector TVL</span>
                  <span className="srm-detail-metric-value">{ext.sectorTvl || '-'}</span>
                </div>
                <div className="srm-detail-metric">
                  <span className="srm-detail-metric-label">7D Volume</span>
                  <span className="srm-detail-metric-value">{ext.volume7d || '-'}</span>
                </div>
                <div className="srm-detail-metric">
                  <span className="srm-detail-metric-label">Dominance</span>
                  <span className="srm-detail-metric-value">{ext.dominance || '-'}</span>
                </div>
                <div className="srm-detail-metric">
                  <span className="srm-detail-metric-label">Projects</span>
                  <span className="srm-detail-metric-value">{ext.activeProjects ?? '-'}</span>
                </div>
              </div>

              {/* Separator */}
              <div className="srm-detail-sep" />

              {/* Two-column body */}
              <div className="srm-detail-body">
                {/* Left: Key Tokens + Flow bar */}
                <div className="srm-detail-body-left">
                  <div className="srm-detail-section">
                    <h4 className="srm-detail-section-title">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                      </svg>
                      Key Tokens
                    </h4>
                    <div className="srm-detail-tokens">
                      {(Array.isArray(ext.keyTokens) ? ext.keyTokens : []).map((t, ti) => {
                        const symbol = t.symbol || ''
                        const change = t.change || ''
                        const logo = getTokenLogo(symbol)
                        const nav = TOKEN_NAV_DATA[symbol]
                        return (
                          <div key={ti} className="srm-detail-token-row">
                            <div
                              className={`srm-detail-token-content${nav ? ' is-clickable' : ''}`}
                              onClick={() => {
                                if (nav && selectToken) {
                                  selectToken({ symbol, name: nav.name, address: nav.address, networkId: nav.networkId, logo: getTokenLogo(symbol) })
                                  setSelectedSector(null)
                                }
                              }}
                            >
                              <div className="srm-detail-token-info">
                                {logo ? (
                                  <img className="srm-detail-token-logo" src={logo} alt={symbol} />
                                ) : (
                                  <div className="srm-detail-token-logo srm-detail-token-logo--fallback">
                                    {symbol.charAt(0)}
                                  </div>
                                )}
                                <span className="srm-detail-token-symbol">{symbol}</span>
                                {change && (
                                  <span className={`srm-detail-token-change ${change.startsWith('+') ? 'is-bull' : 'is-bear'}`}>
                                    {change}
                                  </span>
                                )}
                              </div>
                              <span className="srm-detail-token-role">{t.role || ''}</span>
                            </div>
                            {t.socials && typeof t.socials === 'object' && (
                              <div className="srm-detail-token-socials">
                                {Object.entries(t.socials).map(([key, url]) => {
                                  const icon = SOCIAL_ICONS[key]
                                  if (!icon) return null
                                  return (
                                    <a key={key} className="srm-detail-token-social" href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                                      <svg viewBox={icon.viewBox} {...(icon.fill ? { fill: 'currentColor' } : { fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' })}>
                                        {icon.paths.map((d, pi) => <path key={pi} d={d} />)}
                                      </svg>
                                    </a>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Momentum + Flow summary */}
                  <div className="srm-detail-gauges">
                    <div className="srm-detail-gauge">
                      <span className="srm-detail-gauge-label">Momentum</span>
                      <div className="srm-detail-gauge-track">
                        <div
                          className="srm-detail-gauge-fill"
                          style={{
                            width: `${momentum}%`,
                            background: `linear-gradient(90deg, ${momentum > 60 ? '#10B98150' : momentum > 40 ? '#FBBF2450' : '#EF444450'}, ${momentum > 60 ? '#10B981' : momentum > 40 ? '#FBBF24' : '#EF4444'})`,
                          }}
                        />
                      </div>
                      <span className="srm-detail-gauge-value">{momentum}</span>
                    </div>
                    <div className="srm-detail-gauge">
                      <span className="srm-detail-gauge-label">Capital Flow</span>
                      <div className="srm-detail-gauge-track">
                        <div
                          className={`srm-detail-gauge-fill ${isBull ? 'is-bull' : 'is-bear'}`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                      <span className={`srm-detail-gauge-value ${isBull ? 'is-bull' : 'is-bear'}`}>
                        {isBull ? '+' : ''}{flowPct}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Insight + Catalysts + Risks */}
                <div className="srm-detail-body-right">
                  <div className="srm-detail-section">
                    <h4 className="srm-detail-section-title">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      Sector Analysis
                    </h4>
                    <p className="srm-detail-insight">{ext.insight || ''}</p>
                  </div>

                  {Array.isArray(ext.catalysts) && ext.catalysts.length > 0 && (
                    <div className="srm-detail-section">
                      <h4 className="srm-detail-section-title srm-detail-section-title--bull">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                        Catalysts
                      </h4>
                      <ul className="srm-detail-list srm-detail-list--bull">
                        {ext.catalysts.map((c, ci) => <li key={ci}>{c}</li>)}
                      </ul>
                    </div>
                  )}

                  {Array.isArray(ext.risks) && ext.risks.length > 0 && (
                    <div className="srm-detail-section">
                      <h4 className="srm-detail-section-title srm-detail-section-title--bear">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 9v4m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
                        </svg>
                        Risk Factors
                      </h4>
                      <ul className="srm-detail-list srm-detail-list--bear">
                        {ext.risks.map((r, ri) => <li key={ri}>{r}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })(), document.body)}
    </div>
  )
}

export default SectorRotationMap
